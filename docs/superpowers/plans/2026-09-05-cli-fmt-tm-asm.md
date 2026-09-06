# `redextape fmt` for `.tm` and `.asm` — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `redextape fmt` formats `.tm` and `.asm` files as well as `.rxt`, preserving the comments PR A (#77) taught their parsers to keep.

**Architecture:** A new `crates/redextape-cli/src/form.rs` owns the question "which text form is this" — extension dispatch, an `is_artifact` predicate, a trial-parse sniffer for stdin, and the resolution precedence. `fmt.rs` keeps "how to format one"; `run.rs` adopts the extension table and the predicate but keeps its own resolution policy. One dispatch replaces the single hardcoded `format_with_width` call in `fmt.rs`.

**Tech Stack:** Rust edition 2024, `clap` derive, `redextape-core`'s existing parsers and printers. No new dependencies.

**Design:** [`../specs/2026-09-05-cli-fmt-tm-asm-design.md`](../specs/2026-09-05-cli-fmt-tm-asm-design.md). Follows PR A (#77) and PR B (#78), both merged; base is `7b4a1ff`.

---

## Global Constraints

- **Edition 2024**, `[lints] workspace = true`. The workspace denies `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented` in library code and runs `clippy::pedantic` as written. Test code is exempted in `clippy.toml`. Resolve warnings on their merits — an `#[allow]` needs a stated reason.
- **No library path may panic.**
- **A pre-commit hook runs `cargo fmt --all --check` and `cargo clippy --workspace --all-targets -- -D warnings` on every commit.** Never `--no-verify`. `cargo fmt` may reflow a block from this plan; that is expected — confirm it changed only whitespace.
- **Rust doc comments are `///`.** Doc comments on `ValueEnum` variants become clap's help text, so they are user-visible.
- **Exhaustive `match` on `Form` in both `run` and `fmt` — no `_` arm anywhere.** This is the structural half of the anti-divergence property: a fourth form must break both call sites at compile time. A `_` arm silently defeats it and is a defect, not a style choice.
- Never add AI/Claude attribution to anything.

---

## Verified fixtures — measured, not invented

**Every string below was run through the real parsers and printers by a throwaway probe before this plan was written, and the printed forms are byte-exact.** The previous branch's plan invented its fixtures and every one was wrong; do not retype these from memory and do not edit one to make a test pass. If a test disagrees with a fixture, report it.

```rust
/// Parses clean. Printing it changes it (one space becomes two before the trailing comment),
/// which is what lets a test tell formatting apart from a passthrough.
const TM_IN: &str = "; a machine\ntapes 1\nstart q0\n\nstate q0:\n  [a] -> write [b], move [R], goto q1 ; and a trailing one\nstate q1: accept\n";

/// TM_IN's printed form, byte-exact. Formatting THIS is a no-op — the idempotence fixture.
const TM_OUT: &str = "; a machine\ntapes 1\nstart q0\n\nstate q0:\n  [a] -> write [b], move [R], goto q1  ; and a trailing one\nstate q1: accept\n";

/// Parses clean. Printing it inserts a blank line after `result Nat` and doubles the spaces
/// before each trailing comment. Note the literal tab after `li`.
const ASM_IN: &str = "; a program\nresult Nat\nf: ; the entry\n    li\tr0, #1 ; and a trailing one\n    ret\n";

/// ASM_IN's printed form, byte-exact. The idempotence fixture.
const ASM_OUT: &str = "; a program\nresult Nat\n\nf:  ; the entry\n    li\tr0, #1  ; and a trailing one\n    ret\n";
```

**Measured properties, each of which a task below asserts:**

| property | measured |
|---|---|
| `TM_OUT != TM_IN` and `ASM_OUT != ASM_IN` | true — formatting is observable |
| `print(print(x)) == print(x)` for both | true — idempotent |
| both comments survive both forms | true |
| `TM_OUT` accepted by the asm parser | **false** |
| `ASM_OUT` accepted by the TM parser | **false** |
| `"tapes\n"` | fails both parsers (tm 2 diagnostics, asm 1) |
| `"li\n"` | fails both parsers (tm 2 diagnostics, asm 1) |

**The sniff matrix** (design §4.1), for Task 3's tests. `✓` means the front end returned a payload.

| input | tm | asm | rxt |
|---|---|---|---|
| `""` | | ✓ | ✓ |
| `"   \n\n  \n"` | | ✓ | ✓ |
| `"; just a comment\n"` | | ✓ | |
| `"    li\trr, #7\n    halt\n"` | | ✓ | |
| `TM_IN` | ✓ | | |
| `"let   x=1;\nx+1"` | | | ✓ |
| `"[1, 2, 3]"` | | | ✓ |
| `"let f = \\x. x; f 1"` | | | |

---

## Existing API — verified against the tree, do not re-derive

- **`redextape-cli` is BIN-ONLY** — its `Cargo.toml` has a `[[bin]]` named `redextape` and no
  `[lib]`. `--lib` therefore matches nothing and reports zero tests — a green result that looks
  like a passing suite. Found during Task 1.
  **`--bin redextape` WAS THE FIRST CORRECTION AND IT WAS ALSO WRONG, AND IT HID A RED BRANCH FOR
  TWO TASKS.** It runs the binary's unit tests and silently excludes everything under
  `crates/redextape-cli/tests/`, including the `trycmd` transcripts. Task 5 added `--form`, which
  changed `fmt --help`'s layout and staled `tests/cmd/fmt_help.stdout`; `cargo test -p redextape-cli`
  exited 101 from that commit onward and nothing noticed — the pre-commit hook does not run tests at
  all, and every task was verifying with a command blind to integration failures. Regenerate such a
  golden with `TRYCMD=overwrite cargo test -p redextape-cli --test cli`.
  **Verify with `cargo nextest run -p redextape-cli`**, which runs unit and integration tests
  together. A filtered command is for iterating, never for deciding a task is done.
  **A second consequence bites harder:** a plain non-test build compiles the binary, so an item
  with no production caller is dead code and `-D warnings` makes that an error — a new function
  cannot land one task before its first caller without a suppression. Use
  `#[allow(dead_code)]` **per item, never on an enclosing `impl`**: `config.rs`'s module doc
  records, from a direct probe, that such an attribute is a synthetic reachability root
  shielding everything the item reaches, transitively — on an `impl` it covers every method at
  once, so whichever gained a caller last would keep the others hidden.
  **AND IT MUST BE `allow`, NOT `expect`, WHICH IS THE OPPOSITE OF THE PREVIOUS BRANCH'S
  LESSON — MEASURED, AFTER `expect` WAS TRIED AND FAILED.** `expect` is the better tool for a
  temporarily-dead item because it expires by itself, and it cannot be used here: `cargo clippy
  --all-targets` also builds the unit-test target, where the module's own tests call the item,
  so `dead_code` never fires in that configuration, the expectation goes UNFULFILLED, and that
  is a hard error under `-D warnings`. `expect` requires the lint to fire in every configuration
  it covers. `crates/redextape-core/src/tm/asm.rs`'s `Operand::kind` is the existing precedent,
  and it uses `allow` for exactly this reason.
  **The consequence is that these allows do not expire on their own, so the task that adds the
  first caller must delete that method's.** The two methods are adopted by DIFFERENT tasks, and
  getting this wrong in either direction breaks a build:
  - `from_extension` — first called by **Task 2**, which must delete its allow.
  - `is_artifact` — first called by **Task 5**'s `--width` refusal, not by Task 2. Task 2
    pattern-matches the `Form` it already has rather than asking the predicate, because
    `from_extension` returning `Some` IS the artifact answer for a path. So `is_artifact` still
    has no production caller after Task 2, and deleting its allow then would fail the
    plain-build clippy gate.
  - `sniff` — first called by **Task 4**'s `resolve`.
  - `resolve` — allow ADDED by Task 4 and removed by **Task 5**, which is where `fmt::one` first
    calls it (Step 3). **Not Task 6**, which merely reads the `form` Task 5 already resolved.
  So Task 5 deletes TWO allows and `form.rs` should carry none afterwards.
  Each task's reviewer should confirm `git grep -n dead_code crates/redextape-cli/src/form.rs`
  no longer mentions the method that task wired up — not that the file is clean, which is only
  true after Task 5.
- `crate::input::Input` is `Path(PathBuf) | Stdin`, with `from_arg(&Path) -> Self`, `label(&self) -> String`, `read(&self) -> Result<String, InputError>`.
- `crate::cli::Command::Fmt` is `{ paths: Vec<PathBuf>, check: bool, width: Option<usize> }`.
- `main.rs` currently collapses the width with `let width = width.unwrap_or(cfg.fmt.width);` before calling `fmt::run`. **Task 5 stops that.**
- `main.rs` declares modules as bare `mod name;` — `cli`, `config`, `emit`, `fmt`, `input`, `lint`, `report`, `run`. `form` goes in alphabetical position, after `emit`.
- The `ValueEnum` pattern lives in `run.rs`: `#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum)]` on an enum defined in its own module and named from `cli.rs`. `Backend` is the model to follow.
- `run.rs`'s `Artifact` is a private 2-variant enum used in exactly five places, all inside `run()`.
- `redextape_core::tm` re-exports `parse_tm_full`, `parse_asm_full`, `print_tm_doc`, `print_asm_doc`, `TmDocument`, `AsmDocument` (PR B added the last four to that block).
- `print_tm_doc(&TmDocument) -> Option<String>`; `print_asm_doc(&AsmDocument) -> Option<String>`. `None` exactly when the document carries an error.
- **Neither the TM nor the asm parser emits a warning-severity diagnostic** — `git grep -n "Severity::Warning\|::warning(" crates/redextape-core/src/tm/` matches nothing. This is why the sniffer keys on the payload rather than on an empty diagnostics list; see design §4.

---

## File Structure

```
crates/redextape-cli/src/form.rs   NEW — Form, from_extension, is_artifact, sniff, resolve
crates/redextape-cli/src/main.rs   + mod form;   + keep width as Option
crates/redextape-cli/src/cli.rs    + form: Option<Form> on Fmt
crates/redextape-cli/src/run.rs    Artifact -> Form (5 sites, one function)
crates/redextape-cli/src/fmt.rs    the per-form dispatch, and the --width error
crates/redextape-cli/tests/        the anti-divergence table
```

---

## Task 1: `form.rs` — the type, the extension table, the predicate

**Files:** Create `crates/redextape-cli/src/form.rs`; modify `crates/redextape-cli/src/main.rs` (add `mod form;`).

**Interfaces produced:** `Form` (`Rxt | Tm | Asm`, deriving `Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum`), `Form::from_extension(&Path) -> Option<Form>`, `Form::is_artifact(self) -> bool`.

- [ ] **Step 1: Add `mod form;` to `main.rs`** in alphabetical position, after `mod emit;`.

> Do this now, not at the end. A module that is not declared is not compiled, so Step 3 would report "0 tests run" rather than the failure it is looking for.

- [ ] **Step 2: Write the failing tests** at the bottom of `form.rs`:

```rust
#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn the_extension_table_is_case_insensitive() {
        assert_eq!(Form::from_extension(Path::new("p.tm")), Some(Form::Tm));
        assert_eq!(Form::from_extension(Path::new("p.asm")), Some(Form::Asm));
        // `M.TM` is as much an artifact as `m.tm`. `run.rs` records what a byte-for-byte
        // comparison cost: an uppercase file went down the `.rxt` path and the lexer blamed a
        // valid file on the program.
        assert_eq!(Form::from_extension(Path::new("M.TM")), Some(Form::Tm));
        assert_eq!(Form::from_extension(Path::new("P.AsM")), Some(Form::Asm));

        // `.rxt` is NOT in the table: it is the fallback, not a recognised artifact extension.
        assert_eq!(Form::from_extension(Path::new("p.rxt")), None);
        assert_eq!(Form::from_extension(Path::new("p.txt")), None);
        assert_eq!(Form::from_extension(Path::new("noextension")), None);
    }

    #[test]
    fn only_the_two_compiled_forms_are_artifacts() {
        assert!(Form::Tm.is_artifact());
        assert!(Form::Asm.is_artifact());
        assert!(!Form::Rxt.is_artifact());
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

```
cargo nextest run -p redextape-cli form
```

Expected: FAIL — `Form` not defined.

- [ ] **Step 4: Write `form.rs` above the test module**

```rust
//! Which of the CLI's three text forms an input is, and nothing about what to do with one.
//!
//! **THIS MODULE ANSWERS IDENTITY, NOT BEHAVIOUR.** The formatting dispatch lives in `fmt.rs` and
//! the running dispatch in `run.rs`; keeping printers out of here is what lets `run` — a command
//! that never prints a program back — depend on it.
//!
//! **AND IT EXISTS SO THE EXTENSION TABLE IS WRITTEN ONCE.** `run` had the only copy; `fmt` needs
//! the same knowledge, and two copies of "which extension means what" is the drift this repository
//! treats as a defect rather than a style question.

use std::path::Path;

/// One of the three text forms `redextape` reads from a file.
///
/// `Rxt` is the source language; `Tm` and `Asm` are compiled output that the toolchain can also
/// read back. All three format, which is why this is a total three-way answer rather than the
/// `Option`al two-variant question `run` asks about artifacts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum Form {
    /// The source language, `.rxt`. The default when nothing else identifies the input.
    #[default]
    Rxt,
    /// A Turing machine listing, `.tm`.
    Tm,
    /// A register-assembly listing, `.asm`.
    Asm,
}

impl Form {
    /// The form a path's extension names, or `None` for anything else.
    ///
    /// **ASCII-case-insensitive, and that is not decoration.** `M.TM` is a real artifact; a
    /// byte-for-byte comparison sends it down the `.rxt` path where the lexer produces a cascade of
    /// errors blaming a perfectly valid file on the program. `run.rs` paid that once already.
    ///
    /// `.rxt` is deliberately absent: it is the fallback in `resolve`, not an entry here, so that
    /// "this extension names an artifact" and "this is the default" stay two different answers.
    #[must_use]
    pub fn from_extension(path: &Path) -> Option<Form> {
        let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
        match ext.as_str() {
            "tm" => Some(Form::Tm),
            "asm" => Some(Form::Asm),
            _ => None,
        }
    }

    /// Whether this form is already-compiled output rather than source.
    ///
    /// `run` uses it to refuse `--backend`, which is meaningless for a file that is already a
    /// machine or a program.
    #[must_use]
    pub fn is_artifact(self) -> bool {
        match self {
            Form::Tm | Form::Asm => true,
            Form::Rxt => false,
        }
    }
}
```

> The `match` in `is_artifact` names every variant rather than using `_ => false`. That is the
> structural anti-divergence property from the Global Constraints: a fourth form must fail to
> compile here.

- [ ] **Step 5: Run the tests to verify they pass**

```
cargo nextest run -p redextape-cli form
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Gate and commit**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli/src/form.rs crates/redextape-cli/src/main.rs
git commit -m "The extension table moves into a Form type, so fmt can ask what run already knew"
```

---

## Task 2: `run` adopts `Form`

**Files:** Modify `crates/redextape-cli/src/run.rs`.

**Interfaces consumed:** `Form::from_extension`. **Not `is_artifact`** — this task pattern-matches the `Form` directly, because for a path `from_extension` returning `Some` already is the artifact answer. `is_artifact` is for a `Form` that came from somewhere else, and Task 5 is its first caller.

**This task changes no behaviour.** It replaces a private enum with a shared one. `run`'s resolution path — stdin is `.rxt`, no sniffing, no `--form` — is deliberately untouched, because changing a shipped command's semantics inside a formatting change is what design §8 rejects.

- [ ] **Step 1: Delete the `Artifact` enum** and its doc comment.

- [ ] **Step 2: Replace the five use sites.** The dispatch prologue becomes:

```rust
    // ASCII-case-insensitive, because `M.TM` is a real artifact and a byte-for-byte `e == "tm"` sent
    // it down the `.rxt` path, where the lexer produced a cascade of errors and exit 1 blamed a
    // perfectly valid file on the program. The table now lives in `Form::from_extension`, which is
    // the one copy `fmt` reads too.
    let artifact = match input {
        Input::Path(p) => Form::from_extension(p),
        // Stdin carries no extension, so `run` treats it as the source language and does not
        // inspect its content. That is a deliberate choice rather than an unimplemented one:
        // executing a program guessed from its content is a different risk from formatting one,
        // and the two commands are allowed to differ here.
        Input::Stdin => None,
    };
    if let Some(kind) = artifact {
        if backend != Backend::Reference {
            let noun = match kind {
                Form::Tm => "a `.tm` file, which is already a machine",
                Form::Asm => "a `.asm` file, which is already a program",
                Form::Rxt => unreachable!("from_extension never returns Rxt"),
            };
            writeln!(err, "error: `--backend` does not apply to {noun}")?;
            return Ok(Outcome::ToolFailed);
        }
        return match kind {
            Form::Tm => run_artifact_text(&src, &label, out, err, color),
            Form::Asm => run_asm_artifact(&src, &label, out, err, color),
            Form::Rxt => unreachable!("from_extension never returns Rxt"),
        };
    }
```

> **The two `unreachable!` arms are the cost of sharing a three-way type with a two-way question, and
> they are the right trade.** `from_extension` cannot return `Rxt` — `.rxt` is not in its table, by
> design, and Task 1's test pins that. The alternative is a `_` arm, which would silently accept a
> fourth form and defeat the compile-time divergence check the Global Constraints require. This
> workspace's root `Cargo.toml` states that `unreachable!` sits outside its five restriction lints and
> is used deliberately with reasoning at the site; these two carry it.
>
> **If a reviewer proposes collapsing these into `_`, that is the property being removed** — say so
> rather than accepting it.

- [ ] **Step 3: Add the import** — `use crate::form::Form;` beside the existing `use crate::input::Input;`.

- [ ] **Step 4: Verify `run`'s behaviour is unchanged**

```
cargo nextest run -p redextape-cli
```

Expected: PASS, with `run.rs`'s existing tests — including the uppercase-extension one — untouched and green. **If any `run` test needed editing, stop:** this task was supposed to change no behaviour, and an edited expectation means it did.

- [ ] **Step 5: Gate and commit**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli/src/run.rs
git commit -m "run reads the shared extension table, and its own copy goes"
```

---

## Task 3: `Form::sniff` — the parsers, not a pattern

**Files:** Modify `crates/redextape-cli/src/form.rs`.

**Interfaces produced:** `Form::sniff(&str) -> Option<Form>`.

- [ ] **Step 1: Write the failing tests** in `form.rs`'s test module:

```rust
    // The matrix from design §4.1, measured against the real front ends before this plan was
    // written. Each row is (input, what sniff must answer).
    const MATRIX: &[(&str, Option<Form>)] = &[
        // Both degenerate rows are accepted by the asm parser AND by `.rxt`. They are the only
        // ambiguity in the matrix, and the emptiness guard is why they resolve here rather than
        // through a precedence rule invented for a file with nothing in it.
        ("", None),
        ("   \n\n  \n", None),
        ("; just a comment\n", Some(Form::Asm)),
        ("    li\trr, #7\n    halt\n", Some(Form::Asm)),
        ("result Nat\n    li\trr, #7\n    halt\n", Some(Form::Asm)),
        (TM_IN, Some(Form::Tm)),
        (TM_OUT, Some(Form::Tm)),
        (ASM_IN, Some(Form::Asm)),
        (ASM_OUT, Some(Form::Asm)),
        // Accepted by no front end at all, so the caller falls back to `.rxt` and the user gets a
        // real `.rxt` diagnostic rather than a shrug.
        ("let f = \\x. x; f 1", None),
        ("let   x=1;\nx+1", None),
        ("[1, 2, 3]", None),
    ];

    #[test]
    fn sniff_answers_every_measured_row() {
        for (src, expected) in MATRIX {
            assert_eq!(Form::sniff(src), *expected, "sniffing {src:?}");
        }
    }

    #[test]
    fn tm_and_asm_never_both_accept() {
        // They LOOK disjoint — a TM's `tapes <n>` is an unknown mnemonic to the asm parser — and
        // "looks disjoint" is a claim. This pins it over every row, so a grammar change that made
        // them overlap would redden here rather than silently making `sniff` order-dependent.
        for (src, _) in MATRIX {
            let tm = redextape_core::tm::parse_tm_full(src).machine.is_some();
            let asm = redextape_core::tm::parse_asm_full(src).program.is_some();
            assert!(!(tm && asm), "both front ends accepted {src:?}");
        }
    }
```

Declare `TM_IN`, `TM_OUT`, `ASM_IN`, `ASM_OUT` in the test module from the **Verified fixtures** section above, byte-for-byte.

- [ ] **Step 2: Run the tests to verify they fail**

```
cargo nextest run -p redextape-cli form
```

Expected: FAIL — `Form::sniff` not defined.

- [ ] **Step 3: Write `sniff`** in `impl Form`:

```rust
    /// Which form this content is, judged by asking the real front ends — or `None` when none of
    /// them claims it.
    ///
    /// **THERE IS NO PATTERN HERE, AND THAT IS THE POINT.** `plugin/redextape.lua` sniffs `.tm` and
    /// `.asm` buffers by content too, and a second pattern set in Rust would be one rule in two
    /// languages that no gate could hold in step — the two have different inputs (sixty buffer lines
    /// against whole stdin) and different fallbacks (a path test against none). Trial parsing has no
    /// rule to duplicate: the parser IS the definition of the language.
    ///
    /// **A PATTERN RULE COULD NOT HAVE BEEN WRITTEN CORRECTLY ANYWAY.** The obvious asm signal, the
    /// `result <Type>` line, is optional — a checked-in fixture `run_asm` exercises is two indented
    /// mnemonics with no header, no `result` and no label.
    ///
    /// **The payload is the test, not an empty diagnostics list.** Both document types define the
    /// payload as `None` exactly when an error was reported, so the two agree on every input today
    /// — neither parser emits a warning at all. They stop agreeing the moment one does, and a
    /// sniffer keyed to emptiness would then refuse a machine that parsed fine and merely warned.
    #[must_use]
    pub fn sniff(src: &str) -> Option<Form> {
        // The one ambiguity the matrix found: an empty or whitespace-only file is accepted by the
        // asm parser AND by `.rxt`. There is nothing to format either way, so the guard costs
        // nothing and removes the only case a precedence rule would have to arbitrate.
        if src.trim().is_empty() {
            return None;
        }
        if redextape_core::tm::parse_tm_full(src).machine.is_some() {
            return Some(Form::Tm);
        }
        if redextape_core::tm::parse_asm_full(src).program.is_some() {
            return Some(Form::Asm);
        }
        None
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```
cargo nextest run -p redextape-cli form
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Run the sabotage, and confirm it reddens**

Delete the `src.trim().is_empty()` guard.

```
cargo nextest run -p redextape-cli sniff_answers_every_measured_row
```

Expected: FAIL on the `""` row, which now answers `Some(Form::Asm)`. **If it passes, the two degenerate rows are not being exercised** — stop and fix the test before restoring. Then restore and confirm green.

- [ ] **Step 6: Gate and commit**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli/src/form.rs
git commit -m "Sniffing asks the parsers rather than matching patterns, so there is no second rule to drift"
```

---

## Task 4: `Form::resolve` — the precedence

**Files:** Modify `crates/redextape-cli/src/form.rs`.

**Interfaces produced:** `Form::resolve(&Input, Option<Form>, &str) -> Form`.

> **The signature takes the already-read source**, rather than reading it itself, because `fmt::one`
> has read the input by the time it needs a form and reading twice would be a second chance to
> disagree with itself.

- [ ] **Step 1: Write the failing tests**

```rust
    #[test]
    fn an_explicit_form_wins_over_everything() {
        // Overriding what the filename says is the whole reason the flag exists, so a mismatch is
        // not an error.
        let p = Input::Path("p.rxt".into());
        assert_eq!(Form::resolve(&p, Some(Form::Tm), TM_IN), Form::Tm);
        let t = Input::Path("p.tm".into());
        assert_eq!(Form::resolve(&t, Some(Form::Rxt), TM_IN), Form::Rxt);
        // And over sniffing.
        assert_eq!(Form::resolve(&Input::Stdin, Some(Form::Rxt), TM_IN), Form::Rxt);
    }

    #[test]
    fn a_paths_extension_decides_and_its_content_is_never_consulted() {
        // THE CONTENT HERE CONTRADICTS THE EXTENSION ON PURPOSE. A `.rxt` file whose text happens
        // to satisfy another front end must not be reformatted as a machine — that is why sniffing
        // is stdin-only, and this is the assertion that holds it.
        let p = Input::Path("p.rxt".into());
        assert_eq!(Form::resolve(&p, None, TM_IN), Form::Rxt);

        assert_eq!(Form::resolve(&Input::Path("p.tm".into()), None, ""), Form::Tm);
        assert_eq!(Form::resolve(&Input::Path("M.TM".into()), None, ""), Form::Tm);
        assert_eq!(Form::resolve(&Input::Path("p.asm".into()), None, ""), Form::Asm);
    }

    #[test]
    fn stdin_is_sniffed_and_falls_back_to_rxt() {
        assert_eq!(Form::resolve(&Input::Stdin, None, TM_IN), Form::Tm);
        assert_eq!(Form::resolve(&Input::Stdin, None, ASM_IN), Form::Asm);
        assert_eq!(Form::resolve(&Input::Stdin, None, "let   x=1;\nx+1"), Form::Rxt);
        assert_eq!(Form::resolve(&Input::Stdin, None, ""), Form::Rxt);
    }
```

- [ ] **Step 2: Run to verify they fail**

```
cargo nextest run -p redextape-cli form
```

Expected: FAIL — `Form::resolve` not defined.

- [ ] **Step 3: Write `resolve`**

```rust
    /// Which form to treat this input as.
    ///
    /// The precedence, and the reason for each step:
    ///
    /// 1. `explicit` — a `--form` the user passed. It wins over a contradicting extension, because
    ///    overriding the filename is what the flag is for.
    /// 2. The path's extension.
    /// 3. For stdin only, the content (`sniff`).
    /// 4. `Rxt`.
    ///
    /// **SNIFFING IS STDIN-ONLY, AND THAT IS A SAFETY PROPERTY.** A path with an extension has
    /// already answered the question. Restricting content inspection to the one input that carries
    /// no extension is what makes "a `.rxt` file silently reformatted as a machine" impossible
    /// rather than merely unlikely.
    #[must_use]
    pub fn resolve(input: &Input, explicit: Option<Form>, src: &str) -> Form {
        if let Some(form) = explicit {
            return form;
        }
        match input {
            Input::Path(p) => Form::from_extension(p).unwrap_or(Form::Rxt),
            Input::Stdin => Form::sniff(src).unwrap_or(Form::Rxt),
        }
    }
```

- [ ] **Step 4: Run to verify they pass**

```
cargo nextest run -p redextape-cli form
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Run the sabotage, and confirm it reddens**

Change the `Input::Path` arm to `Form::sniff(src).unwrap_or(Form::Rxt)` — sniffing paths as well as stdin.

```
cargo nextest run -p redextape-cli a_paths_extension_decides_and_its_content_is_never_consulted
```

Expected: FAIL — the `.rxt` path holding TM content now resolves to `Tm`. Restore and confirm green.

- [ ] **Step 6: Gate and commit**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli/src/form.rs
git commit -m "The precedence, and the reason a path's content is never consulted"
```

---

## Task 5: `--form` and the `--width` refusal

**Files:** Modify `crates/redextape-cli/src/cli.rs`, `crates/redextape-cli/src/main.rs`, `crates/redextape-cli/src/fmt.rs`.

- [ ] **Step 1: Add `--form` to the `Fmt` command** in `cli.rs`:

```rust
        /// Treat every input as this form, overriding both the file extension and, for standard
        /// input, the content. Without it a path is identified by its extension and standard input
        /// by what parses.
        #[arg(long, value_name = "FORM")]
        form: Option<crate::form::Form>,
```

- [ ] **Step 2: Stop collapsing the width in `main.rs`.** The `Fmt` arm currently reads:

```rust
        cli::Command::Fmt { paths, check, width } => {
            let width = width.unwrap_or(cfg.fmt.width);
```

Replace with:

```rust
        cli::Command::Fmt { paths, check, width, form } => {
            // THE `Option` SURVIVES ON PURPOSE. `fmt` refuses an explicit `--width` on a `.tm` or
            // `.asm` input, and collapsing the flag with the config default here would make every
            // such format fail on any machine that has a `redextape.toml`.
            let explicit_width = width;
            let width = width.unwrap_or(cfg.fmt.width);
```

and pass both `explicit_width` and `form` into `fmt::run`.

- [ ] **Step 3: Thread the two new arguments** through `fmt::run` into `fmt::one`, and **resolve the form inside `one`.**

`one` receives the `Option<Form>` the user passed, not a resolved form. It resolves once, immediately after reading the source and before anything else looks at the input:

```rust
    let form = Form::resolve(input, explicit_form, &src);
```

**Placement is fixed by two dependencies and there is no freedom in it.** `Form::resolve` takes the source, so it must come after `input.read()`; and the `--width` refusal in Step 5 and the formatting dispatch in Task 6 both read `form`, so it must come before either. One call, one binding, reused by both — resolving twice would be a second chance to disagree with itself, which is the reason `resolve` takes `&str` rather than reading the input for you.

**This is the first production call to `Form::resolve`, so this task deletes `resolve`'s `#[allow(dead_code)]` as well as `is_artifact`'s.** See the bin-only note in the Existing API section for why those allows exist at all.

- [ ] **Step 4: Write the failing tests** in `fmt.rs`'s test module:

```rust
    #[test]
    fn an_explicit_width_is_refused_on_an_artifact_and_the_config_default_is_not() {
        // The flag is meaningless for these two forms: their printers lay out from their own
        // content. `run` already refuses `--backend` on them rather than ignoring it, and silently
        // accepting a flag that does nothing is worse in a formatter, where the user is asking for
        // a specific shape and will believe they got it.
        let dir = redextape_test_support::ScratchDir::new("fmt-width-artifact").unwrap();
        let p = dir.join("p.tm");
        std::fs::write(&p, TM_IN).unwrap();

        let (mut out, mut err) = (Vec::new(), Vec::new());
        let outcome =
            run(&[Input::from_arg(&p)], false, Some(80), None, 80, &mut out, &mut err, false).unwrap();
        assert_eq!(outcome, Outcome::Failed);
        let err = String::from_utf8(err).unwrap();
        assert!(err.contains("`--width` does not apply"), "stderr was: {err}");
        assert!(err.contains("`.tm`"), "the message must name the form: {err}");
        // Refused means refused: the file is untouched.
        assert_eq!(std::fs::read_to_string(&p).unwrap(), TM_IN);

        // With no explicit flag, the same file formats — the config default must stay silent.
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let outcome =
            run(&[Input::from_arg(&p)], false, None, None, 80, &mut out, &mut err, false).unwrap();
        assert_eq!(outcome, Outcome::Rewritten);
        assert_eq!(std::fs::read_to_string(&p).unwrap(), TM_OUT);
    }
```

> The exact `run` signature depends on how Step 3 threaded the arguments. Use whatever Step 3
> produced; the assertions are what matter, not the argument order.

- [ ] **Step 5: Implement the refusal** in `fmt::one`, before formatting:

```rust
    if explicit_width.is_some() && form.is_artifact() {
        let noun = match form {
            Form::Tm => "a `.tm` file, which the printer lays out from its own content",
            Form::Asm => "an `.asm` file, which the printer lays out from its own content",
            Form::Rxt => unreachable!("is_artifact() is false for Rxt"),
        };
        writeln!(err, "error: `--width` does not apply to {noun}")?;
        return Ok(Outcome::Failed);
    }
```

- [ ] **Step 6: Run the tests, then the sabotage**

```
cargo test -p redextape-cli
```

Expected: PASS. Then change the guard to `if form.is_artifact()` — dropping the explicitness check — and confirm the test's second half (the config default) reddens. Restore and confirm green.

- [ ] **Step 7: Gate and commit**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli/src
git commit -m "--form overrides the filename, and an explicit --width on an artifact is refused rather than ignored"
```

---

## Task 6: the per-form formatting dispatch

> **BOUNDARY CORRECTED DURING EXECUTION — READ THIS BEFORE STARTING.** Task 5's own test asserts that
> a `.tm` file reformats to `TM_OUT`, which cannot pass without the dispatch this task was meant to
> introduce. So the dispatch **already landed in Task 5** (`2d27c29`), verified by that implementer
> building the narrow scope first and watching the assertion fail. The task boundary was wrong in this
> plan, not in the implementation.
>
> **What that changes for this task, and it is not just bookkeeping.** The dispatch arrived to satisfy
> ONE assertion and arrived **without the tests written to hold it** — none of the three named below
> existed when it was written. So it was not written test-first, and a test written now sits in front
> of code that already exists, which is the position most likely to produce a test shaped to fit the
> code rather than to constrain it.
>
> **Therefore: do not soften Step 1's tests to match what the dispatch happens to do.** Write them
> against the measured fixtures, run them, and if one fails, the dispatch is what changes. Step 5's
> sabotage stops being a formality here and becomes the main evidence, because it is the only step
> that proves these tests can fail at all.
>
> Step 3 (writing the dispatch) is already done. Verify it matches the shape below, fix it where it
> does not, and spend the effort on Steps 1, 2, 4 and 5.
>
> **THE GAP LIST, MEASURED BY TASK 5'S REVIEW RATHER THAN GUESSED.** That reviewer built a disposable
> worktree and wrote seven throwaway tests against the shipped dispatch; all seven passed, so the
> dispatch is correct and **no dispatch edits are expected — this task is tests.** What the committed
> suite does not exercise at all:
>
> | untested today | note |
> |---|---|
> | `.asm` formatting end-to-end | no test writes an `.asm` file through `run`/`one` at all |
> | idempotence, both forms | `TM_OUT`/`ASM_OUT` reformatting to `Clean` |
> | unparseable artifact left untouched, both forms | `Failed`, stderr non-empty, file byte-identical |
> | comment survival | no dedicated assertion; `.asm` comment survival untouched |
> | `--check` on `.tm`/`.asm` | `WouldChange`, file untouched, diff printed |
> | **`--form`** | **zero coverage anywhere in the tree** — a user-visible flag with no test |
> | stdin sniffing through the dispatch | `fmt_stdin.rs` covers `.rxt` content only |
>
> Steps 1–5 below cover the first four rows. **Add tests for the last three as well** — `--check` on
> an artifact, `--form` overriding an extension end-to-end, and `fmt -` with `.tm` content on stdin.
> A user-visible flag shipping with no test is the gap most likely to survive to merge, because
> nothing fails while it is missing.


**Files:** Modify `crates/redextape-cli/src/fmt.rs`.

**This is the task the slice exists for.** Everything downstream of the dispatch — `--check`, the diff, the atomic write, the stdin filter behaviour, the `Outcome` ordering — is already language-agnostic and must not change.

- [ ] **Step 1: Write the failing tests**

```rust
    #[test]
    fn comments_survive_fmt_on_both_forms() {
        // THE PAYOFF OF PR A, ASSERTED FROM THE COMMAND LINE. Before it, `print ∘ parse` over these
        // two forms deleted every comment in the file.
        for (name, input, expected) in
            [("p.tm", TM_IN, TM_OUT), ("p.asm", ASM_IN, ASM_OUT)]
        {
            let dir = redextape_test_support::ScratchDir::new(&format!("fmt-comments-{name}")).unwrap();
            let p = dir.join(name);
            std::fs::write(&p, input).unwrap();

            let (mut out, mut err) = (Vec::new(), Vec::new());
            let outcome =
                run(&[Input::from_arg(&p)], false, None, None, 80, &mut out, &mut err, false).unwrap();
            assert_eq!(outcome, Outcome::Rewritten, "{name}");

            let got = std::fs::read_to_string(&p).unwrap();
            // Byte-exact against the measured printer output. This is the assertion the INPUT
            // cannot satisfy: `expected` differs from `input`, so a formatter that wrote the buffer
            // back unchanged fails here. Substring checks alone would not — both comments appear in
            // the input verbatim.
            assert_eq!(got, expected, "{name}");
        }
    }

    #[test]
    fn formatting_an_already_formatted_file_is_clean() {
        // What stops `fmt --check` flapping in CI, and the property a formatter is for.
        for (name, formatted) in [("p.tm", TM_OUT), ("p.asm", ASM_OUT)] {
            let dir = redextape_test_support::ScratchDir::new(&format!("fmt-idem-{name}")).unwrap();
            let p = dir.join(name);
            std::fs::write(&p, formatted).unwrap();

            let (mut out, mut err) = (Vec::new(), Vec::new());
            let outcome =
                run(&[Input::from_arg(&p)], false, None, None, 80, &mut out, &mut err, false).unwrap();
            assert_eq!(outcome, Outcome::Clean, "{name} was not already formatted");
            assert_eq!(std::fs::read_to_string(&p).unwrap(), formatted, "{name}");
        }
    }

    #[test]
    fn an_unparseable_artifact_reports_and_writes_nothing() {
        for (name, src) in [("p.tm", "tapes\n"), ("p.asm", "li\n")] {
            let dir = redextape_test_support::ScratchDir::new(&format!("fmt-bad-{name}")).unwrap();
            let p = dir.join(name);
            std::fs::write(&p, src).unwrap();

            let (mut out, mut err) = (Vec::new(), Vec::new());
            let outcome =
                run(&[Input::from_arg(&p)], false, None, None, 80, &mut out, &mut err, false).unwrap();
            assert_eq!(outcome, Outcome::Failed, "{name}");
            assert!(!String::from_utf8(err).unwrap().is_empty(), "{name} reported nothing");
            // There is no partial format: a file that does not parse is left exactly as it was.
            assert_eq!(std::fs::read_to_string(&p).unwrap(), src, "{name}");
        }
    }

    #[test]
    fn an_uppercase_extension_formats_as_its_form() {
        let dir = redextape_test_support::ScratchDir::new("fmt-uppercase").unwrap();
        let p = dir.join("M.TM");
        std::fs::write(&p, TM_IN).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let outcome =
            run(&[Input::from_arg(&p)], false, None, None, 80, &mut out, &mut err, false).unwrap();
        assert_eq!(outcome, Outcome::Rewritten);
        assert_eq!(std::fs::read_to_string(&p).unwrap(), TM_OUT);
    }
```

- [ ] **Step 2: Run to verify they fail**

```
cargo test -p redextape-cli
```

Expected: FAIL — the `.tm` and `.asm` files go down the `.rxt` path and report lexer diagnostics.

- [ ] **Step 3: Replace the single `format_with_width` call** in `one` with the dispatch:

```rust
    let formatted = match form {
        Form::Rxt => match redextape_core::format_with_width(&src, width) {
            Ok(f) => f,
            Err(ds) => {
                render(err, &label, &src, &ds, color)?;
                return Ok(Outcome::Failed);
            }
        },
        // `print_tm_doc` returns `None` exactly when the document carries an error, so the `None`
        // arm and the diagnostics are one case reached two ways, not two cases.
        Form::Tm => {
            let doc = redextape_core::tm::parse_tm_full(&src);
            match redextape_core::tm::print_tm_doc(&doc) {
                Some(f) => f,
                None => {
                    render(err, &label, &src, &doc.diagnostics, color)?;
                    return Ok(Outcome::Failed);
                }
            }
        }
        Form::Asm => {
            let doc = redextape_core::tm::parse_asm_full(&src);
            match redextape_core::tm::print_asm_doc(&doc) {
                Some(f) => f,
                None => {
                    render(err, &label, &src, &doc.diagnostics, color)?;
                    return Ok(Outcome::Failed);
                }
            }
        }
    };
```

- [ ] **Step 4: Run to verify they pass**

```
cargo nextest run -p redextape-cli
```

Expected: PASS, including every pre-existing `fmt` test unchanged.

- [ ] **Step 5: Run the sabotage, and confirm it reddens**

Change the `Form::Tm` arm to return `src.clone()` — a formatter that writes the buffer back.

```
cargo test -p redextape-cli comments_survive_fmt_on_both_forms
```

Expected: FAIL. **This is the assertion the fixture's own comments could not provide** — both strings appear in the input verbatim, so only the byte-exact comparison against measured printer output catches a passthrough. Restore and confirm green.

- [ ] **Step 6: Gate and commit**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli/src/fmt.rs
git commit -m "fmt formats the two forms PR A made lossless, and the comments come back"
```

---

## Task 7: the anti-divergence table

**Files:** Create `crates/redextape-cli/tests/form_agreement.rs`.

**What this pins is narrower than "run and fmt behave the same", and the narrowness is the point.** They legitimately differ: `run` refuses `--backend` on an artifact, `fmt` formats it. A sameness assertion would either fail at once or be weakened until it asserted nothing — which is the failure mode the previous branch spent ten review rounds on.

- [ ] **Step 1: Write the test**

```rust
//! One classification, two commands, and a specified outcome for every cell.
//!
//! The structural half of this property is in the source: both `run` and `fmt` match exhaustively
//! on `Form` with no `_` arm, so a fourth form breaks both at compile time. This file is the other
//! half — that the two commands agree on WHAT a file is, while doing different things with it.

/// The classification both commands must agree on. One table, read twice.
const CLASSIFICATION: &[(&str, &str)] = &[
    ("p.tm", "tm"),
    ("M.TM", "tm"),
    ("p.asm", "asm"),
    ("P.AsM", "asm"),
    ("p.rxt", "rxt"),
    ("p.txt", "rxt"),
];

#[test]
fn run_and_fmt_classify_every_filename_the_same_way() {
    // `run` reveals its classification by refusing `--backend` on an artifact and accepting it
    // otherwise; `fmt` reveals its by refusing an explicit `--width` on an artifact. Two different
    // observable behaviours over one shared answer — which is exactly the property worth pinning,
    // since asserting the behaviours matched would be asserting something false.
    for (filename, expected) in CLASSIFICATION {
        let is_artifact = *expected != "rxt";
        assert_eq!(run_refuses_backend(filename), is_artifact, "run, {filename}");
        assert_eq!(fmt_refuses_width(filename), is_artifact, "fmt, {filename}");
    }
}
```

with two helpers that each spawn the binary via `assert_cmd` (already a dev-dependency) against a scratch file, and return whether the command refused.

- [ ] **Step 2: Run it**

```
cargo test -p redextape-cli --test form_agreement
```

Expected: PASS.

- [ ] **Step 3: Prove it discriminates**

In `run.rs`, change the `"asm"` case so `run` no longer treats `.asm` as an artifact — for instance by having its dispatch consult a local table instead of `Form::from_extension`.

Expected: `run_and_fmt_classify_every_filename_the_same_way` FAILS on the `.asm` rows. **If it passes, the test is not observing `run`'s classification** — fix it before restoring.

- [ ] **Step 4: Gate and commit**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli/tests/form_agreement.rs
git commit -m "One classification read by two commands, and a test that would notice them disagreeing"
```

---

## Task 8: the roadmap entry, the README, and the help text

**Files:** Modify `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, `README.md`.

- [ ] **Step 1: Close the open item.** Both merged LSP entries name `redextape fmt` growing `.tm`/`.asm` support as the natural follow-on. Update both, **leading with the closure** — a bullet under a WHAT STAYS OPEN heading is read by its first clause, and this file has been caught burying a `CLOSED` mid-paragraph before.

- [ ] **Step 2: Write the entry** in the file's established shape: an all-caps heading naming what shipped and what was learned, the date (2026-09-05), the branch, the commit range and count, a Design/Plan link pair, the body, WHAT STAYS OPEN, and VERIFICATION.

WHAT STAYS OPEN, from design §7:
- `.rxlambda` is not formatted, and needs its own slice giving the CLI a λ surface across subcommands rather than bolting one onto `fmt`.
- `run` gains no `--form` and no sniffing, deliberately — design §8.
- Sniffing costs up to two extra parses and the format parses again; chosen, not overlooked.

Worth recording in the body: **the sniffer is the parsers rather than a pattern set, which is why no gate is needed between it and `plugin/redextape.lua`'s Lua sniffer** — there is no shared rule to hold in step, because only one of them holds an opinion about what a `.tm` file is.

- [ ] **Step 3: Every VERIFICATION figure names its command and is measured at the branch head.**

```
git rev-list --count main..HEAD
git diff --shortstat main..HEAD
cargo nextest run --workspace
cargo nextest run -p redextape-cli
cargo llvm-cov nextest --workspace --fail-under-lines 90
```

**Write the two git figures as `main..<SHA>`, not `main..HEAD`.** The previous branch's entry had to be re-anchored because four commits landed after it was written and every count moved; a fixed range does not rot.

- [ ] **Step 4: Update the README** where `fmt` is documented — that it now takes `.tm` and `.asm`, what `--form` is for, and that `--width` applies to `.rxt` alone.

- [ ] **Step 5: Run the documentation gates**

```
scripts/check-citations.sh --self-test && scripts/check-citations.sh
scripts/check-doc-figures.sh --self-test && scripts/check-doc-figures.sh
scripts/check-shared-docs.sh --self-test && scripts/check-shared-docs.sh
scripts/check-text-bytes.sh --self-test && scripts/check-text-bytes.sh
```

- [ ] **Step 6: Commit**

```bash
git add docs README.md
git commit -m "The roadmap entry for fmt learning two forms, and the follow-on both LSP entries named is closed"
```

---

## Task 9: whole-branch verification

- [ ] **Step 1: `scripts/check-all.sh`** — expect all three tiers green. Record whether it was the full gate or a partial one; this file's history contains an entry that logged `--no-llvm --no-browser` in a way a later reader could mistake for a full run.

- [ ] **Step 2: Re-run every VERIFICATION figure at the branch head** and fix the entry if any moved.

- [ ] **Step 3: Read `git diff main...HEAD`**, looking specifically for: a `_` arm on a `Form` match (the structural property, silently removed); a test whose assertion cannot fail; a claim in a doc comment the code does not support; a second copy of the extension table.

- [ ] **Step 4: Whole-branch review** via `superpowers:requesting-code-review`, on the most capable model. Per-task greens are its precondition, not a substitute — ask of every test in the diff what single edit would make it red.

- [ ] **Step 5: Open the PR** against `main`. One long line per paragraph in the body: Forgejo renders with GFM `breaks: true`, so a hard-wrapped paragraph shows as forced line breaks — the opposite of the commit-message rule.

---

## Self-review notes

**Spec coverage.** §1 (what is missing) → Tasks 1–2. §2 (`Form`, where it lives) → Task 1, adopted in Task 2. §3 (precedence) → Task 4. §4 (the sniffer, the matrix, safety) → Task 3. §5 (`--width`) → Task 5. §6 (per-form formatting) → Task 6. §7 (what this does not do) → Task 8's WHAT STAYS OPEN. §8 (rejected approaches) → nothing to build; the `unreachable!` note in Task 2 records why the shared type is three-way. §9 (tests) → Tasks 1, 3, 4, 5, 6, 7.

**Fixtures are measured, not invented.** All four constants and every matrix row came from a probe against the real front ends before this plan was written, and the two printed forms are byte-exact. The previous branch's plan invented its fixtures and every one was wrong, which cost three tasks.

**Every task with a test has a sabotage step** naming the mutation and the expected failure. Tasks 1 and 8 do not: Task 1's assertions are direct equalities over a total function, and Task 8 is documentation whose gate is the four `check-*.sh` scripts.

**One thing deliberately left to the implementer:** the exact argument order of `fmt::run` and `fmt::one` after Task 5 threads two new values through. The tests name the assertions rather than a signature, because a plan that pins an argument order it cannot verify is a plan asserting something it has not measured.
