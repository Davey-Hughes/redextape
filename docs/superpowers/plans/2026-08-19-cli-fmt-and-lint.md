# `redextape-cli` — `fmt` and `lint` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the workspace's first binary — `redextape fmt` and `redextape lint` — and give
`Severity::Warning` its first producer.

**Architecture:** A new host-only bin crate `redextape-cli` consumes `redextape_core::format` and
`redextape_core::analyze`. All diagnostic rendering funnels through one module (`report.rs`) so the two
commands cannot drift into two looks. The two new lint rules live in `redextape-core`, not the CLI,
because `analyze` is what emits diagnostics and the CLI is only one of its two consumers — the web is
the other, and it already handles the `Warning` severity.

**Tech Stack:** Rust 2024, `clap` 4 (derive), `ariadne` 0.6, `similar` 3, `trycmd` 1, `assert_cmd` 2.

**Design:** [`../specs/2026-08-19-cli-fmt-and-lint-design.md`](../specs/2026-08-19-cli-fmt-and-lint-design.md).
Read §5 and §5.2 before Task 2.

## Global Constraints

- **No `file:line` citations in `crates/**`.** `scripts/check-citations.sh` runs on every commit and
  rejects them. Cite the symbol: `` `typeck.rs`'s `Binding` ``, never `` typeck.rs:48 ``. `docs/` is out
  of scope and MAY use them.
- **No panics in library or binary code.** `[workspace.lints.clippy]` denies `unwrap_used`,
  `expect_used`, `panic`, `todo`, `unimplemented` under CI's `-D warnings`. Test code is exempt via
  `clippy.toml`'s three `allow-*-in-tests` keys, which reach code lexically inside a `#[test]` fn or a
  `#[cfg(test)]` module. **This INCLUDES a `#[test]` fn in a `tests/` integration target** — an earlier
  draft of this line claimed otherwise and mandated a file-level allow that Task 1's review proved
  suppressed nothing. `clippy.toml`'s carve-out is for a FREE HELPER outside any `#[test]` fn, which is
  in neither place. Add a file-level `#![allow(...)]` to a `tests/` file only when it grows such a
  helper AND clippy actually fails without it — verify by deleting the line and re-running, never by
  assuming.
- **`clippy::pedantic` is on as written.** No blanket `allow` at crate level.
- **rustfmt:** `max_width = 120`, `use_small_heuristics = "Max"`. Run `cargo fmt --all` before commit.
- **Every commit must pass the pre-commit hooks:** control bytes, citations, `cargo fmt --all --check`,
  `cargo clippy --workspace --all-targets -- -D warnings`. A task whose commit split would leave clippy
  red must be collapsed into one commit — never `--no-verify`.
- **Coverage floor is 90% lines**, `cargo llvm-cov nextest --workspace --fail-under-lines 90`.
- **Test names are sentences.** The tree's convention is
  `comment_anchoring_catches_the_two_defects_it_was_written_for`, not `test_anchoring`.

---

## File Structure

**New crate `crates/redextape-cli/`:**

| File | Responsibility |
| --- | --- |
| `Cargo.toml` | manifest; `[[bin]] name = "redextape"` |
| `src/main.rs` | dispatch only; maps an outcome to an `ExitCode` |
| `src/cli.rs` | `clap` derive structs; no logic |
| `src/input.rs` | `-` vs path, reading, atomic write-back |
| `src/report.rs` | `Diagnostic` → ariadne; the ONLY module that knows ariadne exists |
| `src/fmt.rs` | the `fmt` command |
| `src/lint.rs` | the `lint` command |
| `tests/cli.rs` | `trycmd` entry point |
| `tests/cmd/*.toml`, `tests/cmd/*.stdout` | golden transcripts |

**Modified in `crates/redextape-core/`:**

| File | Change |
| --- | --- |
| `src/diagnostic.rs` | add `Diagnostic::warning` constructor |
| `src/lints.rs` | NEW — the two rules and their scope walk |
| `src/lib.rs` | `pub mod lints;` and call it from `analyze` |

**Modified at the root:** `Cargo.toml` (workspace member).

---

## Task 1: Crate scaffold and `redextape --version`

**Files:**
- Create: `crates/redextape-cli/Cargo.toml`, `crates/redextape-cli/src/main.rs`, `crates/redextape-cli/src/cli.rs`
- Modify: `Cargo.toml` (workspace `members`)
- Test: `crates/redextape-cli/tests/version.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `cli::Cli` (a `clap::Parser`) with `cli::Command::{Fmt, Lint}`; binary named `redextape`.

- [ ] **Step 1: Add the crate to the workspace**

Edit the root `Cargo.toml`, adding one line to `members` in alphabetical position:

```toml
members = [
    "crates/redextape-cli",
    "crates/redextape-core",
    "crates/redextape-native",
    "crates/redextape-native-rt",
    "crates/redextape-test-support",
    "crates/redextape-wasm",
]
```

- [ ] **Step 2: Write the manifest**

Create `crates/redextape-cli/Cargo.toml`:

```toml
[package]
name = "redextape-cli"
version = "0.0.0"
edition.workspace = true
license.workspace = true
repository.workspace = true
publish = false

# The package is `redextape-cli`; the command a user types is `redextape`.
[[bin]]
name = "redextape"
path = "src/main.rs"

[lints]
workspace = true

[dependencies]
redextape-core = { path = "../redextape-core" }
clap = { version = "4", features = ["derive"] }
ariadne = "0.6"
similar = "3"

[dev-dependencies]
assert_cmd = "2"
trycmd = "1"
```

- [ ] **Step 3: Write the clap surface**

Create `crates/redextape-cli/src/cli.rs`:

```rust
//! The `clap` surface. Declarations only — every decision lives in the command modules, so this file
//! stays readable as a description of what the binary accepts.

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "redextape", version, about = "The redextape mini-language toolchain")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    /// Format source files in place.
    Fmt {
        /// Files to format. `-` reads standard input and writes standard output.
        #[arg(required = true)]
        paths: Vec<PathBuf>,
        /// Print a diff instead of rewriting; exit 1 if anything would change.
        #[arg(long)]
        check: bool,
    },
    /// Report parse, type and lint diagnostics.
    Lint {
        /// Files to check. `-` reads standard input.
        #[arg(required = true)]
        paths: Vec<PathBuf>,
    },
}
```

- [ ] **Step 4: Write a `main` that parses and exits**

Create `crates/redextape-cli/src/main.rs`:

```rust
//! `redextape` — the command line front end for `redextape-core`.
//!
//! `main` does dispatch and nothing else: each command module returns an outcome, and the only job
//! here is turning that outcome into a process exit code. The three codes are 0 (success), 1 (the
//! check failed — a file would be rewritten, or a diagnostic was an error) and 2 (the work could not
//! be done at all), which is also `clap`'s own code for a bad argument list.

mod cli;

use clap::Parser;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args = cli::Cli::parse();
    match args.command {
        cli::Command::Fmt { .. } | cli::Command::Lint { .. } => ExitCode::SUCCESS,
    }
}
```

- [ ] **Step 5: Write the failing test**

Create `crates/redextape-cli/tests/version.rs`:

```rust
//! The binary exists, is named `redextape`, and reports the workspace version.

use assert_cmd::Command;

#[test]
fn the_binary_is_named_redextape_and_reports_a_version() {
    let out = Command::cargo_bin("redextape").unwrap().arg("--version").output().unwrap();
    assert!(out.status.success(), "--version must exit 0");
    let text = String::from_utf8(out.stdout).unwrap();
    assert!(text.starts_with("redextape "), "expected `redextape <version>`, got {text:?}");
}

#[test]
fn a_subcommand_is_required() {
    let out = Command::cargo_bin("redextape").unwrap().output().unwrap();
    assert_eq!(out.status.code(), Some(2), "clap reports a missing subcommand as exit 2");
}
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cargo nextest run -p redextape-cli`
Expected: FAIL — the crate does not compile yet, or `cargo_bin` cannot find `redextape`.

- [ ] **Step 7: Run the test to verify it passes**

Run: `cargo nextest run -p redextape-cli`
Expected: PASS, 2 tests.

- [ ] **Step 8: Verify the gates**

Run: `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings`
Expected: no warnings. `main`'s match arms are deliberately trivial and will be filled in Task 5.

- [ ] **Step 9: Commit**

```bash
git add Cargo.toml crates/redextape-cli
git commit -m "cli: the crate, the binary name, and a version to print"
```

---

## Task 2: `Diagnostic::warning` and the `unused_mut` rule

**Files:**
- Modify: `crates/redextape-core/src/diagnostic.rs`
- Create: `crates/redextape-core/src/lints.rs`
- Modify: `crates/redextape-core/src/lib.rs`

**Interfaces:**
- Consumes: `ast::{Block, Expr, Program, Stmt}`, `diagnostic::Diagnostic`, `span::Span`.
- Produces: `Diagnostic::warning(span, message) -> Diagnostic`; `lints::check(&Program) -> Vec<Diagnostic>`.

**Read first:** design §5 and §5.2. The blast radius is real and the triage rule is not optional.

- [ ] **Step 1: Add the `warning` constructor**

In `crates/redextape-core/src/diagnostic.rs`, beside the existing `error`:

```rust
    /// A `Severity::Warning` diagnostic. Warnings never block compilation: `analyze` sets `core` from
    /// the presence of an ERROR, so a program that only warns still desugars, runs, and lowers.
    pub fn warning(span: Span, message: impl Into<String>) -> Self {
        Diagnostic { span, severity: Severity::Warning, message: message.into() }
    }
```

- [ ] **Step 2: Write the failing test**

Create `crates/redextape-core/src/lints.rs` with ONLY this test module for now:

```rust
//! Lint rules over the surface AST.
//!
//! These are the first producers of `Severity::Warning` in the crate. The variant was declared,
//! matched and unreachable until this module existed — the same shape of gap `TokenClass::Comment`
//! carried until the printer slice gave it a producer.
//!
//! Both rules are syntactic and run only on a program with no error-severity diagnostic, so they never
//! add noise to a file that is already broken.

#[cfg(test)]
mod tests {
    use crate::diagnostic::Severity;

    #[test]
    fn a_mut_binding_that_is_never_assigned_warns() {
        let ds = crate::analyze("let mut x = 1; x + 1").diagnostics;
        assert_eq!(ds.len(), 1, "expected exactly one diagnostic, got {ds:?}");
        assert_eq!(ds[0].severity, Severity::Warning);
        assert!(ds[0].message.contains("does not need to be mutable"), "got {:?}", ds[0].message);
    }

    #[test]
    fn a_mut_binding_that_is_assigned_does_not_warn() {
        let ds = crate::analyze("let mut x = 1; x = 2; x + 1").diagnostics;
        assert!(ds.is_empty(), "an assigned `mut` is used as intended: {ds:?}");
    }

    #[test]
    fn an_immutable_binding_never_triggers_the_mut_rule() {
        let ds = crate::analyze("let x = 1; x + 1").diagnostics;
        assert!(ds.is_empty(), "{ds:?}");
    }

    #[test]
    fn the_rule_reads_the_innermost_binding_when_a_name_is_shadowed() {
        // The inner `mut y` is assigned; the OUTER `mut y` never is, so exactly one warning fires and
        // it names the outer binding's span, which starts at offset 0.
        let ds = crate::analyze("let mut y = 1; { let mut y = 2; y = 3; y }; y").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert_eq!(ds[0].span.start, 0, "the OUTER binding is the unassigned one: {ds:?}");
    }

    #[test]
    fn lints_do_not_run_on_a_program_that_already_has_an_error() {
        // `nope` is unbound. That is an error, and a broken program must not also be nagged.
        let ds = crate::analyze("let mut x = 1; nope").diagnostics;
        assert!(ds.iter().all(|d| d.severity == Severity::Error), "no warnings beside an error: {ds:?}");
    }
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo nextest run -p redextape-core lints`
Expected: FAIL — `lints` is not declared in `lib.rs`, so the module does not compile.

- [ ] **Step 4: Write the scope walk**

Add above the test module in `crates/redextape-core/src/lints.rs`:

```rust
use crate::ast::{Block, Expr, Program, Stmt};
use crate::diagnostic::Diagnostic;
use crate::span::Span;

/// One binding, live while the walk is inside the block that introduced it.
///
/// `linted` is false for a binding this module does not report on — a function parameter or a lambda
/// parameter. They are pushed anyway, because a parameter SHADOWS an outer binding and leaving it out
/// would credit the outer one with a use it never had.
struct Local {
    name: String,
    span: Span,
    mutable: bool,
    used: bool,
    assigned: bool,
    linted: bool,
}

#[derive(Default)]
struct Lints {
    scope: Vec<Local>,
    out: Vec<Diagnostic>,
}

/// Every binding this program declares and does not use.
///
/// Diagnostics come back ordered by span so the CLI and the editor both render them in source order.
#[must_use]
pub fn check(program: &Program) -> Vec<Diagnostic> {
    let mut l = Lints::default();
    l.block(&program.block);
    l.out.sort_by_key(|d| d.span.start);
    l.out
}

impl Lints {
    fn block(&mut self, b: &Block) {
        let mark = self.scope.len();
        for s in &b.stmts {
            self.stmt(s);
        }
        if let Some(tail) = &b.tail {
            self.expr(tail);
        }
        self.close(mark);
    }

    /// Drop every binding introduced since `mark`, reporting the ones nothing used.
    fn close(&mut self, mark: usize) {
        while self.scope.len() > mark {
            let Some(l) = self.scope.pop() else { break };
            if !l.linted {
                continue;
            }
            if l.mutable && !l.assigned {
                self.out.push(Diagnostic::warning(
                    l.span,
                    format!("variable `{}` does not need to be mutable", l.name),
                ));
            }
        }
    }

    /// Mark the INNERMOST binding of `name`. Later pushes shadow earlier ones, so the search runs
    /// from the top of the stack down.
    fn mark_use(&mut self, name: &str) {
        if let Some(l) = self.scope.iter_mut().rev().find(|l| l.name == name) {
            l.used = true;
        }
    }

    fn mark_assign(&mut self, name: &str) {
        if let Some(l) = self.scope.iter_mut().rev().find(|l| l.name == name) {
            l.assigned = true;
        }
    }

    fn stmt(&mut self, s: &Stmt) {
        match s {
            // The value is inferred in the scope BEFORE the binding exists, so it is walked first.
            Stmt::Let { name, mutable, value, span } => {
                self.expr(value);
                self.scope.push(Local {
                    name: name.clone(),
                    span: *span,
                    mutable: *mutable,
                    used: false,
                    assigned: false,
                    linted: true,
                });
            }
            // An assignment is not a READ. `let mut x = 1; x = 2;` never reads `x`, and both rules
            // should say so independently — this is the behaviour rustc has for the same shapes.
            Stmt::Assign { target, value, .. } => {
                self.expr(value);
                self.mark_assign(target);
            }
            Stmt::Fn { params, body, .. } => {
                let mark = self.scope.len();
                for p in params {
                    self.push_param(p);
                }
                self.block(body);
                self.close(mark);
            }
            Stmt::While { cond, body, .. } => {
                self.expr(cond);
                self.block(body);
            }
            Stmt::Expr(e) => self.expr(e),
        }
    }

    /// A parameter shadows but is never reported. See `Local::linted`.
    fn push_param(&mut self, name: &str) {
        self.scope.push(Local {
            name: name.to_string(),
            span: Span { start: 0, end: 0 },
            mutable: false,
            used: false,
            assigned: false,
            linted: false,
        });
    }

    fn expr(&mut self, e: &Expr) {
        match e {
            Expr::Nat { .. } | Expr::Bool { .. } => {}
            Expr::Var { name, .. } => self.mark_use(name),
            Expr::List { items, .. } => {
                for i in items {
                    self.expr(i);
                }
            }
            Expr::Binary { lhs, rhs, .. } => {
                self.expr(lhs);
                self.expr(rhs);
            }
            Expr::If { cond, then_blk, else_blk, .. } => {
                self.expr(cond);
                self.block(then_blk);
                self.block(else_blk);
            }
            Expr::Block { block, .. } => self.block(block),
            Expr::Lambda { params, body, .. } => {
                let mark = self.scope.len();
                for p in params {
                    self.push_param(p);
                }
                self.expr(body);
                self.close(mark);
            }
            Expr::Call { callee, args, .. } => {
                self.expr(callee);
                for a in args {
                    self.expr(a);
                }
            }
            Expr::Method { recv, args, .. } => {
                self.expr(recv);
                for a in args {
                    self.expr(a);
                }
            }
        }
    }
}
```

- [ ] **Step 5: Declare the module and call it from `analyze`**

In `crates/redextape-core/src/lib.rs`, add `pub mod lints;` in alphabetical position among the module
declarations. Then change `analyze`'s body so lints run only on an otherwise-clean program:

```rust
pub fn analyze(src: &str) -> Analysis {
    let (program, mut diagnostics) = parser::parse(src);
    let Some(program) = program else {
        return Analysis { diagnostics, core: None };
    };
    diagnostics.extend(typeck::typecheck(&program));
    let has_error = diagnostics.iter().any(|d| d.severity == Severity::Error);
    // Lints run only on a program that is otherwise clean. A file with a type error does not also
    // need to be told one of its bindings is unused — and it keeps the blast radius of these rules to
    // programs that previously reported NOTHING, which is the set the tree's `is_empty()` assertions
    // are about.
    if !has_error {
        diagnostics.extend(lints::check(&program));
    }
    let core = if has_error { None } else { Some(desugar::desugar(&program)) };
    Analysis { diagnostics, core }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cargo nextest run -p redextape-core lints`
Expected: PASS, 5 tests.

- [ ] **Step 7: Find the fallout**

Run: `cargo nextest run --workspace 2>&1 | tail -40`

Expected: some of the 19 `diagnostics.is_empty()` assertions in `typeck.rs`, `lib.rs` and
`redextape-wasm/src/session.rs` now fail.

- [ ] **Step 8: Triage each failure, one at a time**

**This is the step design §5.2 exists for. Do not batch-edit fixtures.** For each failure, decide which
of two things is true and record it in the commit message:

1. **The test program genuinely has a `let mut` that is never assigned.** The rule is right. Fix the
   FIXTURE — drop the `mut`, since the program never needed it.
2. **The rule fired where it should not.** The rule is wrong. Fix `lints.rs` and add the shape to its
   test module.

A blanket rewrite that does not distinguish these converts a real defect into a passing test.

- [ ] **Step 9: Run the full suite**

Run: `cargo nextest run --workspace`
Expected: PASS, no failures.

- [ ] **Step 10: Verify the gates**

Run: `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 11: Commit**

```bash
git add crates/redextape-core
git commit -m "core: \`Severity::Warning\` gets its first producer, and it is \`unused_mut\`"
```

---

## Task 3: The `unused_variable` rule and the `_` exemption

**Files:**
- Modify: `crates/redextape-core/src/lints.rs`

**Interfaces:**
- Consumes: everything Task 2 produced.
- Produces: no new signatures — `check` gains a second rule.

- [ ] **Step 1: Write the failing test**

Add to `lints.rs`'s test module:

```rust
    #[test]
    fn a_binding_that_is_never_read_warns() {
        let ds = crate::analyze("let x = 1; 2").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains("unused variable"), "got {:?}", ds[0].message);
    }

    #[test]
    fn an_underscore_name_is_exempt() {
        let ds = crate::analyze("let _x = 1; 2").diagnostics;
        assert!(ds.is_empty(), "a leading underscore suppresses the rule: {ds:?}");
    }

    #[test]
    fn a_bare_underscore_is_exempt_too() {
        let ds = crate::analyze("let _ = 1; 2").diagnostics;
        assert!(ds.is_empty(), "{ds:?}");
    }

    #[test]
    fn assigning_to_a_binding_is_not_reading_it() {
        // Both rules fire independently and both are right: `x` is assigned (so it needs `mut`) and
        // never read (so it is unused).
        let ds = crate::analyze("let mut x = 1; x = 2; 3").diagnostics;
        assert_eq!(ds.len(), 1, "only the unused-variable rule fires: {ds:?}");
        assert!(ds[0].message.contains("unused variable"), "got {:?}", ds[0].message);
    }

    #[test]
    fn a_shadowed_binding_is_reported_when_only_the_inner_one_is_read() {
        let ds = crate::analyze("let z = 1; { let z = 2; z }").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert_eq!(ds[0].span.start, 0, "the OUTER `z` is the unread one: {ds:?}");
    }

    #[test]
    fn a_lambda_parameter_is_not_reported() {
        let ds = crate::analyze("let f = |a| 1; f(2)").diagnostics;
        assert!(ds.is_empty(), "parameters are out of scope for these rules: {ds:?}");
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo nextest run -p redextape-core lints`
Expected: FAIL — `a_binding_that_is_never_read_warns` gets 0 diagnostics, expected 1.

- [ ] **Step 3: Add the rule**

In `lints.rs`'s `close`, add the second report AFTER the `unused_mut` block, inside the same
`if !l.linted { continue }` guard:

```rust
            if !l.used && !l.name.starts_with('_') {
                self.out.push(Diagnostic::warning(l.span, format!("unused variable: `{}`", l.name)));
            }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo nextest run -p redextape-core lints`
Expected: PASS, 11 tests.

- [ ] **Step 5: Find and triage the fallout**

Run: `cargo nextest run --workspace 2>&1 | tail -40`

Triage each failure by Task 2 Step 8's two-way rule. For this rule the fixture fix is usually renaming
the binding to `_name`, which is what the exemption is for — but only where the binding is genuinely
meant to be unused. Where a test program declares a binding it MEANT to read, the missing read is the
finding, not the warning.

- [ ] **Step 6: Run the full suite and the gates**

Run: `cargo nextest run --workspace && cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS, no warnings.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core
git commit -m "core: a binding nothing reads is a warning, and \`_\` says you meant it"
```

---

## Task 4: `input.rs` — stdin, paths, and the failures a CLI must survive

**Files:**
- Create: `crates/redextape-cli/src/input.rs`
- Modify: `crates/redextape-cli/src/main.rs` (add `mod input;`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `input::Input` (`from_arg`, `label`, `read`), `input::InputError` (implements `Display`),
  and `input::write_atomic(path, contents) -> std::io::Result<()>`.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-cli/src/input.rs` with only a test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn a_single_dash_means_standard_input() {
        assert!(matches!(Input::from_arg(Path::new("-")), Input::Stdin));
        assert!(matches!(Input::from_arg(Path::new("a.rxt")), Input::Path(_)));
    }

    #[test]
    fn stdin_is_labelled_so_a_diagnostic_can_name_it() {
        assert_eq!(Input::Stdin.label(), "<stdin>");
        assert_eq!(Input::from_arg(Path::new("a.rxt")).label(), "a.rxt");
    }

    #[test]
    fn a_missing_file_is_an_error_and_not_a_panic() {
        let e = Input::from_arg(Path::new("does/not/exist.rxt")).read().unwrap_err();
        assert!(e.to_string().contains("does/not/exist.rxt"), "the message names the file: {e}");
    }

    #[test]
    fn a_directory_is_an_error_and_not_a_panic() {
        let e = Input::from_arg(Path::new(".")).read().unwrap_err();
        assert!(!e.to_string().is_empty());
    }

    #[test]
    fn non_utf8_bytes_are_reported_rather_than_lossily_decoded() {
        let dir = std::env::temp_dir().join("redextape-cli-nonutf8");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("bad.rxt");
        std::fs::write(&p, [0xff, 0xfe, 0x00]).unwrap();
        let e = Input::from_arg(&p).read().unwrap_err();
        assert!(e.to_string().contains("not valid UTF-8"), "got {e}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_atomic_write_replaces_the_file_contents() {
        let dir = std::env::temp_dir().join("redextape-cli-atomic");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("out.rxt");
        std::fs::write(&p, "old").unwrap();
        write_atomic(&p, "new").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "new");
        std::fs::remove_dir_all(&dir).ok();
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo nextest run -p redextape-cli input`
Expected: FAIL to compile — `Input` and `write_atomic` do not exist.

- [ ] **Step 3: Write the implementation**

Add above the test module in `input.rs`:

```rust
//! Where source text comes from and where it goes back to.
//!
//! Every failure a real invocation can hit lives here — a missing file, a directory where a file was
//! expected, bytes that are not UTF-8 — because each has to produce a message and an exit code rather
//! than a panic. The crate denies `unwrap`, and this is the module that would otherwise want one.

use std::fmt;
use std::io::Read;
use std::path::{Path, PathBuf};

/// One resolved input.
pub enum Input {
    Path(PathBuf),
    Stdin,
}

/// Why an input could not be read. `Display` is the message the user sees on stderr.
pub enum InputError {
    Io { label: String, err: std::io::Error },
    NotUtf8 { label: String },
}

impl fmt::Display for InputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InputError::Io { label, err } => write!(f, "cannot read `{label}`: {err}"),
            InputError::NotUtf8 { label } => write!(f, "`{label}` is not valid UTF-8"),
        }
    }
}

impl Input {
    /// `-` is standard input. Everything else is a path, including a path that does not exist — that
    /// is `read`'s problem to report, not this function's to guess at.
    #[must_use]
    pub fn from_arg(p: &Path) -> Self {
        if p.as_os_str() == "-" { Input::Stdin } else { Input::Path(p.to_path_buf()) }
    }

    /// What a diagnostic calls this input.
    #[must_use]
    pub fn label(&self) -> String {
        match self {
            Input::Path(p) => p.display().to_string(),
            Input::Stdin => "<stdin>".to_string(),
        }
    }

    /// Read the whole input as UTF-8.
    ///
    /// # Errors
    ///
    /// `InputError::Io` if the path cannot be opened or read (missing, a directory, unreadable), and
    /// `InputError::NotUtf8` if the bytes are not valid UTF-8. A source file is text; decoding it
    /// lossily would hand the parser bytes the author never wrote.
    pub fn read(&self) -> Result<String, InputError> {
        let label = self.label();
        let mut bytes = Vec::new();
        match self {
            Input::Stdin => {
                std::io::stdin().read_to_end(&mut bytes).map_err(|err| InputError::Io { label: label.clone(), err })?;
            }
            Input::Path(p) => {
                bytes = std::fs::read(p).map_err(|err| InputError::Io { label: label.clone(), err })?;
            }
        }
        String::from_utf8(bytes).map_err(|_| InputError::NotUtf8 { label })
    }
}

/// Replace `path`'s contents, atomically.
///
/// Write a sibling temporary and rename over the target. A formatter killed between opening and
/// closing a file must not leave a truncated source file behind, and rename within one directory is
/// the cheapest guarantee against that. The temporary is a sibling rather than in the system temp
/// directory because rename across filesystems is not atomic and may not be permitted at all.
///
/// # Errors
///
/// Any `std::io::Error` from creating, writing or renaming the temporary.
pub fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path.file_name().map_or_else(|| std::ffi::OsString::from("out"), std::ffi::OsStr::to_os_string);
    let mut tmp = name;
    tmp.push(".redextape-tmp");
    let tmp = dir.join(tmp);
    std::fs::write(&tmp, contents)?;
    std::fs::rename(&tmp, path)
}
```

- [ ] **Step 4: Declare the module**

In `crates/redextape-cli/src/main.rs`, add `mod input;` beside `mod cli;`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo nextest run -p redextape-cli input`
Expected: PASS, 6 tests.

- [ ] **Step 6: Verify the gates**

Run: `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings`
Expected: no warnings. Note `#[cfg(test)] mod tests` is exempt from the panic lints, which is why the
tests may use `unwrap`.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-cli
git commit -m "cli: where source comes from, and every way that can fail"
```

---

## Task 5: `report.rs` — one diagnostic look for both commands

**Files:**
- Create: `crates/redextape-cli/src/report.rs`
- Modify: `crates/redextape-cli/src/main.rs` (add `mod report;`)

**Interfaces:**
- Consumes: `redextape_core::{Diagnostic, Severity}`.
- Produces: `report::render(w: &mut impl Write, label: &str, src: &str, ds: &[Diagnostic], color: bool) -> std::io::Result<()>`.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-cli/src/report.rs` with only a test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_error_renders_with_its_source_line_and_the_word_error() {
        let src = "let x = ;";
        let ds = redextape_core::analyze(src).diagnostics;
        assert!(!ds.is_empty(), "this program must not parse");
        let mut buf = Vec::new();
        render(&mut buf, "a.rxt", src, &ds, false).unwrap();
        let text = String::from_utf8(buf).unwrap();
        assert!(text.contains("Error"), "got {text}");
        assert!(text.contains("a.rxt"), "the label names the file: {text}");
    }

    #[test]
    fn a_warning_renders_as_a_warning_and_not_as_an_error() {
        let src = "let mut x = 1; x + 1";
        let ds = redextape_core::analyze(src).diagnostics;
        assert_eq!(ds.len(), 1, "expected the unused-mut warning: {ds:?}");
        let mut buf = Vec::new();
        render(&mut buf, "a.rxt", src, &ds, false).unwrap();
        let text = String::from_utf8(buf).unwrap();
        assert!(text.contains("Warning"), "got {text}");
    }

    #[test]
    fn colour_off_emits_no_ansi_escapes_so_a_golden_test_is_stable() {
        let src = "let mut x = 1; x + 1";
        let ds = redextape_core::analyze(src).diagnostics;
        let mut buf = Vec::new();
        render(&mut buf, "a.rxt", src, &ds, false).unwrap();
        assert!(!buf.contains(&0x1b), "no ESC byte may appear with colour off");
    }

    #[test]
    fn a_span_late_in_a_multibyte_file_lands_on_the_right_line() {
        // The label offsets are BYTES. A file with a multi-byte character before the diagnostic is
        // where a character-indexed renderer would drift, so this is the shape that catches it.
        //
        // TWO THINGS THIS TEST GOT WRONG IN AN EARLIER DRAFT, both found by implementing it. The
        // multi-byte character was carried in a STRING LITERAL, and this language has no string
        // syntax at all — `TokenKind` has `Nat` and `Ident` and no `Str` — so the quotes produced
        // three lexer errors, and `analyze` skips the lint pass whenever any error-severity
        // diagnostic exists, so the warning this test is about never fired. A `//` comment carries
        // the multi-byte bytes with no diagnostic. And asserting only `contains("a.rxt")` pinned
        // NOTHING: it passes under `IndexType::Char` too. Assert the exact rendered column.
        let src = "// π\nlet mut x = 1; x + 1";
        let ds = redextape_core::analyze(src).diagnostics;
        assert_eq!(ds.len(), 1, "expected the unused-mut warning on line 2: {ds:?}");
        let mut buf = Vec::new();
        render(&mut buf, "a.rxt", src, &ds, false).unwrap();
        let text = String::from_utf8(buf).unwrap();
        // Under `IndexType::Char` this renders `a.rxt:2:2` — verified by flipping it.
        assert!(text.contains("a.rxt:2:1"), "got {text}");
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo nextest run -p redextape-cli report`
Expected: FAIL to compile — `render` does not exist.

- [ ] **Step 3: Write the implementation**

Add above the test module in `report.rs`:

```rust
//! `Diagnostic` to the terminal, through ariadne.
//!
//! THE ONLY MODULE THAT KNOWS ARIADNE EXISTS. `fmt`'s parse errors and `lint`'s analysis diagnostics
//! both render here, which is what stops the two commands from growing two different diagnostic looks.
//!
//! `IndexType::Byte` is not optional. `Span` is byte offsets everywhere in this workspace, and
//! ariadne's default is CHARACTER offsets — a file with one multi-byte character before a diagnostic
//! would silently underline the wrong span.

use ariadne::{Config, IndexType, Label, Report, ReportKind, Source};
use redextape_core::{Diagnostic, Severity};

/// Render every diagnostic against `src`, labelled `label`.
///
/// # Errors
///
/// Any `std::io::Error` from writing to `w`.
pub fn render(
    w: &mut impl std::io::Write,
    label: &str,
    src: &str,
    ds: &[Diagnostic],
    color: bool,
) -> std::io::Result<()> {
    let config = Config::default().with_index_type(IndexType::Byte).with_color(color);
    for d in ds {
        let kind = match d.severity {
            Severity::Error => ReportKind::Error,
            Severity::Warning => ReportKind::Warning,
        };
        let span = (label, d.span.start..d.span.end);
        Report::build(kind, span.clone())
            .with_config(config)
            .with_message(&d.message)
            .with_label(Label::new(span).with_message(&d.message))
            .finish()
            .write((label, Source::from(src)), &mut *w)?;
    }
    Ok(())
}

/// Whether to colour: a terminal that has not opted out.
///
/// `NO_COLOR` is honoured at any value, per the convention's own rule that presence is what counts.
#[must_use]
pub fn should_color() -> bool {
    std::env::var_os("NO_COLOR").is_none() && std::io::IsTerminal::is_terminal(&std::io::stderr())
}
```

**This call was compiled and run against ariadne 0.6.0 before the plan was written**, not transcribed
from documentation. Verified output for a two-diagnostic render with `color = false`:

```
Error: bad thing
   ╭─[ a.rxt:1:5 ]
   │
 1 │ let x = 1;
   │     ┬
   │     ╰── bad thing
───╯
Warning: warn thing
```

So `Error:` and `Warning:` are the exact words the tests above assert on, `a.rxt:1:5` is the label
form, and **the buffer contained no ESC byte**, which is what makes the Task 9 goldens stable.

- [ ] **Step 4: Declare the module**

In `crates/redextape-cli/src/main.rs`, add `mod report;`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo nextest run -p redextape-cli report`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verify the gates and commit**

```bash
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli
git commit -m "cli: one diagnostic look, and byte offsets are why it needs saying"
```

---

## Task 6: `fmt` — stdin, files in place, and the file that must not be touched

**Files:**
- Create: `crates/redextape-cli/src/fmt.rs`
- Modify: `crates/redextape-cli/src/main.rs`

**Interfaces:**
- Consumes: `input::{Input, write_atomic}`, `report::render`, `redextape_core::format`.
- Produces: `fmt::Outcome` (`Clean` < `Rewritten` < `WouldChange` < `Failed`, ordered by derived `Ord`),
  `fmt::run(inputs, check, out, err, color) -> std::io::Result<Outcome>`.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-cli/src/fmt.rs` with only a test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn tmpdir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("redextape-fmt-{name}"));
        std::fs::remove_dir_all(&d).ok();
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_file_that_needs_formatting_is_rewritten_in_place() {
        let d = tmpdir("rewrite");
        let p = d.join("a.rxt");
        std::fs::write(&p, "let   x=1;\nx+1").unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Rewritten), "got {got:?}");
        let after = std::fs::read_to_string(&p).unwrap();
        assert_eq!(after, redextape_core::format("let   x=1;\nx+1").unwrap());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn formatting_twice_changes_nothing_the_second_time() {
        let d = tmpdir("idempotent");
        let p = d.join("a.rxt");
        std::fs::write(&p, "let   x=1;\nx+1").unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        run(&[Input::from_arg(&p)], false, &mut out, &mut err, false).unwrap();
        let once = std::fs::read_to_string(&p).unwrap();
        let got = run(&[Input::from_arg(&p)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Clean), "the second run has nothing to do: {got:?}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), once);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn a_file_that_does_not_parse_is_left_exactly_as_it_was() {
        let d = tmpdir("broken");
        let p = d.join("bad.rxt");
        let original = "let x = ;";
        std::fs::write(&p, original).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Failed), "got {got:?}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), original, "THE FILE MUST NOT BE TOUCHED");
        assert!(!err.is_empty(), "the diagnostic goes to stderr");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn one_bad_file_does_not_stop_the_others_and_the_worst_outcome_wins() {
        let d = tmpdir("multi");
        let bad = d.join("bad.rxt");
        let good = d.join("good.rxt");
        std::fs::write(&bad, "let x = ;").unwrap();
        std::fs::write(&good, "let   y=2;\ny+1").unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got =
            run(&[Input::from_arg(&bad), Input::from_arg(&good)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Failed), "the worst outcome wins: {got:?}");
        assert_eq!(std::fs::read_to_string(&good).unwrap(), redextape_core::format("let   y=2;\ny+1").unwrap());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn a_missing_file_reports_and_does_not_panic() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(Path::new("nope.rxt"))], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Failed));
        assert!(String::from_utf8(err).unwrap().contains("nope.rxt"));
    }

    #[test]
    fn the_variant_order_is_the_severity_order() {
        // `max` IS the merge rule, and it is correct only while the variants are declared worst-last.
        // Reordering the enum would silently invert every multi-file exit code, so it is pinned here
        // rather than left to the derive.
        assert!(Outcome::Clean < Outcome::Rewritten);
        assert!(Outcome::Rewritten < Outcome::WouldChange);
        assert!(Outcome::WouldChange < Outcome::Failed);
        assert_eq!(Outcome::Clean.max(Outcome::Failed), Outcome::Failed);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo nextest run -p redextape-cli fmt`
Expected: FAIL to compile — `run` and `Outcome` do not exist.

- [ ] **Step 3: Write the implementation**

Add above the test module in `fmt.rs`:

```rust
//! `redextape fmt` — the canonical `print ∘ parse` formatter.
//!
//! Two rules this module exists to keep. **A file that does not parse is never written**, which is
//! `redextape_core::format`'s own contract and the only safe thing to do with source the printer
//! cannot round-trip. And **one bad input does not stop the others**: a repo-wide invocation that
//! aborts on the first broken file is useless, so every input is processed and the exit code reports
//! the worst outcome seen.

use crate::input::{Input, write_atomic};
use crate::report::render;

/// What a `fmt` run did.
///
/// **VARIANT ORDER IS LOAD-BEARING.** `Ord` is derived, and a derived `Ord` on a fieldless enum
/// ranks by DECLARATION order — so `a.max(b)` is exactly "the worse of the two" and there is no
/// hand-written rank table to fall out of step with the variants. Declare any new variant in
/// severity position, and see `the_variant_order_is_the_severity_order` below, which pins it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Outcome {
    /// Every input was already formatted.
    Clean,
    /// At least one file was rewritten, and nothing failed.
    Rewritten,
    /// `--check` only: at least one file would be rewritten.
    WouldChange,
    /// At least one input could not be read, or did not parse.
    Failed,
}

/// Format every input.
///
/// # Errors
///
/// Any `std::io::Error` from writing to `out` or `err`. A failure to read or parse an INPUT is not an
/// error here — it is reported and folded into the returned `Outcome`.
pub fn run(
    inputs: &[Input],
    check: bool,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    let mut worst = Outcome::Clean;
    for input in inputs {
        worst = worst.max(one(input, check, out, err, color)?);
    }
    Ok(worst)
}

fn one(
    input: &Input,
    check: bool,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    let label = input.label();
    let src = match input.read() {
        Ok(s) => s,
        Err(e) => {
            writeln!(err, "{e}")?;
            return Ok(Outcome::Failed);
        }
    };
    let formatted = match redextape_core::format(&src) {
        Ok(f) => f,
        Err(ds) => {
            render(err, &label, &src, &ds, color)?;
            return Ok(Outcome::Failed);
        }
    };
    match input {
        // `--check` MEANS ONE THING ON EVERY INPUT: print a diff, write nothing, exit 1 if it would
        // change. Two earlier drafts got this wrong in two different ways — the first returned
        // `Clean` here, so `cat f | redextape fmt --check -` exited 0 on input that would change; the
        // second fixed the exit code but kept printing the full reformatted source, so
        // `redextape fmt --check - > out.rxt` quietly produced a reformatted file while `--help`
        // promised a diff and "writes nothing".
        //
        // The "pipelines keep working" argument that motivated printing source is already served by
        // plain `redextape fmt -`, which still emits source. Nobody pipes `--check` output onward.
        // Checked rather than asserted: rustfmt prints a diff here, black prints nothing at all, and
        // prettier prints a filename — NONE of them dumps reformatted source, contrary to a claim
        // this plan carried for two tasks.
        Input::Stdin if check => {
            if formatted == src {
                return Ok(Outcome::Clean);
            }
            write!(out, "{}", diff(&label, &src, &formatted))?;
            Ok(Outcome::WouldChange)
        }
        Input::Stdin => {
            write!(out, "{formatted}")?;
            Ok(Outcome::Clean)
        }
        Input::Path(p) => {
            if formatted == src {
                return Ok(Outcome::Clean);
            }
            if check {
                return Ok(Outcome::WouldChange);
            }
            write_atomic(p, &formatted)?;
            Ok(Outcome::Rewritten)
        }
    }
}
```

- [ ] **Step 4: Wire it into `main`**

Replace `main.rs`'s body:

```rust
mod cli;
mod fmt;
mod input;
mod report;

use clap::Parser;
use input::Input;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args = cli::Cli::parse();
    let color = report::should_color();
    let (mut out, mut err) = (std::io::stdout(), std::io::stderr());
    match args.command {
        cli::Command::Fmt { paths, check } => {
            let inputs: Vec<Input> = paths.iter().map(|p| Input::from_arg(p)).collect();
            match fmt::run(&inputs, check, &mut out, &mut err, color) {
                Ok(fmt::Outcome::Clean | fmt::Outcome::Rewritten) => ExitCode::SUCCESS,
                Ok(fmt::Outcome::WouldChange) => ExitCode::from(1),
                Ok(fmt::Outcome::Failed) => ExitCode::from(2),
                Err(e) => {
                    let _ = writeln!(std::io::stderr(), "{e}");
                    ExitCode::from(2)
                }
            }
        }
        cli::Command::Lint { .. } => ExitCode::SUCCESS,
    }
}
```

Add `use std::io::Write;` at the top so `writeln!` resolves on `Stderr`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo nextest run -p redextape-cli`
Expected: PASS, all tests.

- [ ] **Step 6: Remove BOTH `dead_code` allows — this task is what retires them**

Task 4 shipped `input.rs`, and Task 5 shipped `report.rs`, each with a module-level
`#![allow(dead_code, reason = "...")]`, because a bin crate has no external consumer and `pub` does not
exempt an item from `dead_code` there. Both name the first real call site as their removal point, and
`fmt` is that call site for both — it uses `Input`, `write_atomic` AND `render`.

Delete the whole `#![allow(...)]` block from **both files**, then run:

`cargo clippy --workspace --all-targets -- -D warnings`

Expected: clean. If anything in either file is still reported dead, that item has NO caller even after
`fmt` — do not re-add the allow to hide it. Either `fmt` should be calling it and does not, or the item
is genuinely unused and should be deleted. Say which in the commit message.

`report.rs`'s `should_color` is the one to watch: `fmt` reaches it through `main`, not through
`fmt::run`, so confirm `main` actually calls it rather than passing a hardcoded flag.

- [ ] **Step 7: Try it by hand**

```bash
printf 'let   x=1;\nx+1' | cargo run -q -p redextape-cli --bin redextape -- fmt -
```
Expected: canonically formatted source on stdout, exit 0.

- [ ] **Step 8: Verify the gates and commit**

```bash
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli
git commit -m "cli: \`fmt\` writes in place, atomically, and never writes a file it could not parse"
```

---

## Task 7: `fmt --check` and its unified diff

**Files:**
- Modify: `crates/redextape-cli/src/fmt.rs`

**Interfaces:**
- Consumes: `similar::TextDiff`.
- Produces: `fmt::diff(label, before, after) -> String`; `run`'s `check` path now writes a diff.

- [ ] **Step 1: Write the failing test**

Add to `fmt.rs`'s test module:

```rust
    #[test]
    fn check_on_a_clean_file_says_nothing_and_writes_nothing() {
        let d = tmpdir("check-clean");
        let p = d.join("a.rxt");
        let clean = redextape_core::format("let x = 1;\nx + 1").unwrap();
        std::fs::write(&p, &clean).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], true, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Clean), "got {got:?}");
        assert!(out.is_empty() && err.is_empty(), "a clean --check is silent");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn check_on_a_dirty_file_prints_a_diff_and_leaves_the_file_alone() {
        let d = tmpdir("check-dirty");
        let p = d.join("a.rxt");
        let original = "let   x=1;\nx+1";
        std::fs::write(&p, original).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], true, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::WouldChange), "got {got:?}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), original, "--check writes NOTHING");
        let text = String::from_utf8(out).unwrap();
        assert!(text.contains("--- "), "a unified diff has a before header: {text}");
        assert!(text.contains("+++ "), "and an after header: {text}");
        assert!(text.contains(&format!("{}", p.display())), "both headers name the real path: {text}");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn the_diff_names_the_real_path_and_never_the_temporary() {
        let d = tmpdir("check-names");
        let p = d.join("a.rxt");
        std::fs::write(&p, "let   x=1;\nx+1").unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        run(&[Input::from_arg(&p)], true, &mut out, &mut err, false).unwrap();
        let text = String::from_utf8(out).unwrap();
        assert!(!text.contains(".redextape-tmp"), "the temporary file is an implementation detail: {text}");
        std::fs::remove_dir_all(&d).ok();
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo nextest run -p redextape-cli check`
Expected: FAIL — `check_on_a_dirty_file_prints_a_diff...` finds `out` empty.

- [ ] **Step 3: Add the diff**

Add to `fmt.rs`:

```rust
/// A unified diff from `before` to `after`, headed with the real path on both sides.
///
/// Both headers name the file the user passed, never the sibling temporary `write_atomic` uses — the
/// temporary is an implementation detail and a diff header is user-visible.
#[must_use]
pub fn diff(label: &str, before: &str, after: &str) -> String {
    let d = similar::TextDiff::from_lines(before, after);
    d.unified_diff().header(&format!("{label} (before)"), &format!("{label} (after)")).to_string()
}
```

Then in `one`, replace the `if check { return Ok(Outcome::WouldChange); }` line with:

```rust
            if check {
                write!(out, "{}", diff(&label, &src, &formatted))?;
                return Ok(Outcome::WouldChange);
            }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo nextest run -p redextape-cli`
Expected: PASS, all tests.

- [ ] **Step 5: Verify the gates and commit**

```bash
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli
git commit -m "cli: \`--check\` says what it would change, not just that it would"
```

---

## Task 8: `lint`

**Files:**
- Create: `crates/redextape-cli/src/lint.rs`
- Modify: `crates/redextape-cli/src/main.rs`

**Interfaces:**
- Consumes: `input::Input`, `report::render`, `redextape_core::analyze`.
- Produces: `lint::Outcome` (`Clean` < `Warned` < `Errored` < `Failed`, ordered by derived `Ord`),
  `lint::run(inputs, out, err, color)`.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-cli/src/lint.rs` with only a test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::Input;
    use std::path::Path;

    fn write(name: &str, src: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("redextape-lint-{name}"));
        std::fs::remove_dir_all(&d).ok();
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("a.rxt");
        std::fs::write(&p, src).unwrap();
        p
    }

    #[test]
    fn a_clean_program_reports_nothing() {
        let p = write("clean", "let x = 1;\nx + 1");
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Clean), "got {got:?}");
        assert!(err.is_empty(), "nothing to say: {:?}", String::from_utf8_lossy(&err));
    }

    #[test]
    fn a_warning_is_reported_but_does_not_fail_the_run() {
        let p = write("warn", "let mut x = 1;\nx + 1");
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Warned), "a warning is not a failure: {got:?}");
        assert!(String::from_utf8(err).unwrap().contains("Warning"));
    }

    #[test]
    fn an_error_fails_the_run() {
        let p = write("err", "let x = ;");
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Errored), "got {got:?}");
    }

    #[test]
    fn a_missing_file_reports_and_does_not_panic() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(Path::new("nope.rxt"))], &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Failed), "got {got:?}");
    }

    #[test]
    fn the_variant_order_is_the_severity_order() {
        // Same reason as `fmt::Outcome`'s test of the same name: `max` is the merge rule and the
        // declaration order is what makes it right.
        assert!(Outcome::Clean < Outcome::Warned);
        assert!(Outcome::Warned < Outcome::Errored);
        assert!(Outcome::Errored < Outcome::Failed);
        assert_eq!(Outcome::Clean.max(Outcome::Errored), Outcome::Errored);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo nextest run -p redextape-cli lint`
Expected: FAIL to compile — `run` and `Outcome` do not exist.

- [ ] **Step 3: Write the implementation**

Add above the test module in `lint.rs`:

```rust
//! `redextape lint` — every static diagnostic `analyze` produces, rendered.
//!
//! A STATIC CHECKER, NOT A RUNNER: `Analysis::core` is ignored entirely. Warnings are reported and do
//! not fail the run — making them fatal is a `--deny-warnings` flag and no consumer has asked for one.

use crate::input::Input;
use crate::report::render;
use redextape_core::Severity;

/// What a `lint` run found.
///
/// **VARIANT ORDER IS LOAD-BEARING**, for the same reason `fmt::Outcome`'s is: derived `Ord` on a
/// fieldless enum ranks by declaration order, so `a.max(b)` is "the worse of the two" with no rank
/// table to maintain. `the_variant_order_is_the_severity_order` below pins it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Outcome {
    Clean,
    Warned,
    Errored,
    Failed,
}

/// Check every input.
///
/// # Errors
///
/// Any `std::io::Error` from writing to `out` or `err`.
pub fn run(
    inputs: &[Input],
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    // `lint` writes diagnostics to stderr only — stdout stays clean so `redextape lint a.rxt > /dev/null`
    // still shows you the findings. The parameter is kept so both commands have one call shape.
    let _ = out;
    let mut worst = Outcome::Clean;
    for input in inputs {
        let label = input.label();
        let src = match input.read() {
            Ok(s) => s,
            Err(e) => {
                writeln!(err, "{e}")?;
                worst = worst.max(Outcome::Failed);
                continue;
            }
        };
        let ds = redextape_core::analyze(&src).diagnostics;
        render(err, &label, &src, &ds, color)?;
        let this = if ds.iter().any(|d| d.severity == Severity::Error) {
            Outcome::Errored
        } else if ds.is_empty() {
            Outcome::Clean
        } else {
            Outcome::Warned
        };
        worst = worst.max(this);
    }
    Ok(worst)
}
```

- [ ] **Step 4: Wire it into `main`**

Replace the `cli::Command::Lint { .. } => ExitCode::SUCCESS,` arm:

```rust
        cli::Command::Lint { paths } => {
            let inputs: Vec<Input> = paths.iter().map(|p| Input::from_arg(p)).collect();
            match lint::run(&inputs, &mut out, &mut err, color) {
                Ok(lint::Outcome::Clean | lint::Outcome::Warned) => ExitCode::SUCCESS,
                Ok(lint::Outcome::Errored) => ExitCode::from(1),
                Ok(lint::Outcome::Failed) => ExitCode::from(2),
                Err(e) => {
                    let _ = writeln!(std::io::stderr(), "{e}");
                    ExitCode::from(2)
                }
            }
        }
```

Add `mod lint;` to the module list.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo nextest run -p redextape-cli`
Expected: PASS, all tests.

- [ ] **Step 6: Verify the gates and commit**

```bash
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli
git commit -m "cli: \`lint\`, and a warning that does not fail the run"
```

---

## Task 9: The `trycmd` golden suite

**Files:**
- Create: `crates/redextape-cli/tests/cli.rs`, `crates/redextape-cli/tests/cmd/*.toml`,
  `crates/redextape-cli/tests/cmd/*.rxt`

**Interfaces:**
- Consumes: the finished binary.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the trycmd entry point**

Create `crates/redextape-cli/tests/cli.rs`:

```rust
//! End-to-end transcripts: argv in, stdout/stderr/exit-code out.
//!
//! The unit tests in each command module call `run` directly with a buffer. These run the real
//! binary, which is the only place `main`'s exit-code mapping and `clap`'s own errors are exercised.
//!
//! NO file-level `allow` here: `clippy.toml`'s in-tests exemption already covers a `#[test]` fn in an
//! integration target. If a free helper is added to this file and clippy then fails, add the narrowest
//! allow that fixes it — and confirm it is load-bearing by deleting it and re-running.

#[test]
fn cli_transcripts() {
    trycmd::TestCases::new().default_bin_name("redextape").case("tests/cmd/*.toml");
}
```

- [ ] **Step 2: Add the fixtures and transcripts**

Create `crates/redextape-cli/tests/cmd/fmt_stdin.toml`:

```toml
bin.name = "redextape"
args = ["fmt", "-"]
stdin = "let   x=1;\nx+1"
status.code = 0
```

Create `crates/redextape-cli/tests/cmd/lint_error.toml`:

```toml
bin.name = "redextape"
args = ["lint", "broken.rxt"]
status.code = 1
```

Create `crates/redextape-cli/tests/cmd/broken.rxt`:

```
let x = ;
```

Create `crates/redextape-cli/tests/cmd/lint_missing_file.toml`:

```toml
bin.name = "redextape"
args = ["lint", "no-such-file.rxt"]
status.code = 2
```

Create `crates/redextape-cli/tests/cmd/no_subcommand.toml`:

```toml
bin.name = "redextape"
args = []
status.code = 2
```

- [ ] **Step 3: Generate the golden output**

Run: `TRYCMD=overwrite cargo nextest run -p redextape-cli cli_transcripts`

This writes the `.stdout`/`.stderr` files beside each `.toml`.

- [ ] **Step 4: READ every generated golden before trusting it**

Run: `cat crates/redextape-cli/tests/cmd/*.stdout crates/redextape-cli/tests/cmd/*.stderr`

**A golden file generated from the code it tests asserts only that the code did not change — it does
not assert the code is right.** Read each one and confirm it is the output you intended: the right
severity word, the right span underlined, the right exit code. Fix the code, not the golden, where it
is not.

- [ ] **Step 5: Run the suite without the overwrite flag**

Run: `cargo nextest run -p redextape-cli`
Expected: PASS, all tests including the transcripts.

- [ ] **Step 6: Verify the gates and commit**

```bash
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli
git commit -m "tests: the binary's own transcripts, read before they were trusted"
```

---

## Task 10: Coverage, the full gate, and the docs

**Files:**
- Create: `crates/redextape-cli/README.md`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`
- Modify: `web/src/highlight.ts` (one doc-comment sentence)

- [ ] **Step 1: Run the coverage gate**

Run: `cargo llvm-cov nextest --workspace --fail-under-lines 90`
Expected: PASS, at or above 90%. If the CLI drags it under, add unit tests for the uncovered branches —
`merge`'s ranking and the `InputError` `Display` arms are the usual gaps.

- [ ] **Step 2: Run the full gate**

Run: `scripts/check-all.sh --no-llvm --no-browser`
Expected: every leg green. Neither skipped tier is touched by this branch — record that in the closing
entry rather than implying full coverage.

- [ ] **Step 3: Write the crate README**

Create `crates/redextape-cli/README.md`:

```markdown
# `redextape` — the command line front end

    redextape fmt foo.rxt            rewrite in place
    redextape fmt --check src/*.rxt  diff what would change; write nothing
    redextape fmt -                  stdin to stdout
    redextape lint foo.rxt           parse, type and lint diagnostics

Exit codes: `0` success, `1` the check failed (a file would be rewritten, or a diagnostic was an
error), `2` the work could not be done (unreadable input, unparseable source, bad arguments).

`fmt` is exactly `print ∘ parse` — `redextape_core::format`. A file that does not parse is reported
and left untouched.

`lint` reports errors and two warnings: a `let mut` that is never assigned, and a binding that is never
read. Name a binding `_x` to say you meant it.
```

- [ ] **Step 4: Correct `highlight.ts`'s overstated rule**

In `web/src/highlight.ts`, the doc comment says a grammar is *"forbidden outright"*. The roadmap forbids
two AUTHORITATIVE grammars and permits a highlighting-only lane. Replace that sentence with:

```
 * A Lezer grammar would be a second AUTHORITATIVE grammar for this language, which the roadmap's
 * tree-sitter entry rules out — it permits a highlighting-only lane, but a CodeMirror language package
 * is not that lane. And it would be redundant, because `classify_source` already ships and already
 * returns the spans.
```

- [ ] **Step 5: Write the roadmap closing entry**

Append a `####` entry to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` in the Plan 6 section,
following the house shape of every closing entry above it. It must state:

- What closed: Plan 6's first half; `redextape_core::format` has a caller.
- What `Severity::Warning` was before this branch (declared, matched, never constructed) and what gave
  it a producer.
- **The fixture triage result from Tasks 2 and 3, by number:** how many of the 19 `is_empty()`
  assertions actually fired, and for each, which of the two triage outcomes it got. That number is the
  branch's most transferable finding and must not be summarized as "fixed the tests".
- The measured figures: `cargo nextest run --workspace` test count, and the `llvm-cov` percentage.
- **What this did not close:** `run`/`emit`, `parse_asm`, `--deny-warnings`, a config file, more lint
  rules.
- **The tree-sitter correction:** the roadmap's own entry defers the grammar until Plan 5 "wants
  in-browser editing"; Plan 5 exists and decided it did not. The driver is external editors. Update
  that entry's **When:** clause in place and fix the lane to highlighting-only.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-cli/README.md docs web/src/highlight.ts
git commit -m "roadmap, docs: Plan 6's first half closes, and the tree-sitter trigger was overtaken"
```

- [ ] **Step 7: Open the PR**

```bash
git push -u origin cli-fmt-and-lint
```

Then open a PR against `main`. The body follows the house shape: what closed, what was falsified or
corrected, what was found that was never a task, and where the residual risk is.

---

## Self-Review

**Spec coverage.** §1 → Task 2 (the verified gap). §2 → Task 1 (layout, lints, no-serde).
§3.1 → Tasks 6, 7. §3.2 → Task 8. §4 → Task 5. §5 → Tasks 2, 3. §5.1 → verified in design, no code
needed — nothing in `web/` changes for it. §5.2 → Tasks 2 Step 8 and 3 Step 5. §6 → Tasks 6 Step 4 and
8 Step 4. §7 → Tasks 4–8's Interfaces blocks. §8 → Tasks 6–9. §9 → no code. §10 → Task 10 Steps 4–5.
§11 → Task 7 (the diff header names the real path).

**Type consistency.** `Outcome` is deliberately declared twice, once per command module, with different
variants — `fmt::Outcome` has `Rewritten`/`WouldChange`, `lint::Outcome` has `Warned`/`Errored`. They
are never mixed: `main` matches each under its module path. Neither carries a `merge` function: both
derive `Ord` and use `a.max(b)`, because a derived `Ord` on a fieldless enum ranks by declaration
order and the variants are already declared worst-last. Each module pins that with
`the_variant_order_is_the_severity_order`, so a later reordering fails a test rather than silently
inverting an exit code.

**Dependency versions were resolved, not assumed**, against the registry on 2026-08-19: `clap` 4.6.6,
`ariadne` 0.6.0, `similar` 3.2.0, `trycmd` 1.2.1, `assert_cmd` 2.2.2. Every one declares MSRV 1.85 or
none; this repo tracks stable, at 1.97.1. The manifest in Task 1 pins majors (`"4"`, `"0.6"`, `"3"`,
`"1"`, `"2"`), which is the tree's existing convention.

**The one risk this plan started with is closed.** Task 5's ariadne call and Task 7's `similar` call
were both compiled and run before this plan was finished, so neither is transcribed from documentation.
`similar` is at **3.x, not the 2.x that a reader may remember** — `"3"` in the manifest is deliberate.
