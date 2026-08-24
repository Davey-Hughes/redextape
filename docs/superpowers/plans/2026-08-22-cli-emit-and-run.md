# `redextape run` and `redextape emit` — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** give the CLI two subcommands — `run`, which executes a `.rxt` program on a chosen backend or simulates a `.tm` artifact, and `emit`, which compiles a program to the TM, λ or asm text form.

**Architecture:** two new command modules beside `fmt.rs` and `lint.rs`, following the same shape those already have — each exports an `Outcome` enum and a `run(..) -> std::io::Result<Outcome>` that writes through `&mut impl Write`, and `main.rs` maps the outcome to an exit code. No new semantics: every pipeline already runs in a test or an example. `redextape-core` is not modified.

**Tech Stack:** unchanged — `clap` 4 (derive), `ariadne` (diagnostics), `similar` (diffs, unused here), `trycmd` and `assert_cmd` for transcripts.

**Design:** [`../specs/2026-08-22-cli-emit-and-run-design.md`](../specs/2026-08-22-cli-emit-and-run-design.md). Every figure and signature below was read from the tree at `193225a` on 2026-08-22.

## Global Constraints

Every task's requirements implicitly include all of these.

- **`crates/redextape-core` is NOT modified.** If a task seems to need a core change, stop and report — the design's scope boundary is that this slice adds a surface, not semantics.
- **Exit codes are 0, 1, 2 and nothing else.** `main.rs` documents them: 0 success, 1 the check failed, 2 the work could not be done at all (also `clap`'s code for a bad argument list). The rule this slice applies: **1 means the program is at fault, 2 means the tool could not answer.**
- **Library code may not panic.** `[workspace.lints.clippy]` warns `unwrap_used`/`expect_used`/`panic`/`todo`/`unimplemented` plus `pedantic`, and CI makes warnings fatal. `clippy.toml` exempts those only inside a `#[test]` fn or `#[cfg(test)]` module — `src/*.rs` is neither. Integration tests in `tests/` may unwrap freely.
- **A pre-commit hook runs on every commit** — `cargo fmt --check`, `cargo clippy -- -D warnings`, a C0-control-byte scan, a `file:line` citation scan. NEVER `--no-verify`. If the hook makes a commit split infeasible, collapse the split and say so.
- **No `file:line` citations in tracked source outside `docs/`** — cite symbols by name. **No C0 control bytes** except TAB, LF, CR.
- **Never call `reduce_trace`.** `run_lambda` reduces without tracing and is the only λ entry point this slice uses. A λ measurement that traces has previously cost this machine 60 GiB of RAM and all of swap.
- **One path per invocation.** `fmt` and `lint` take `Vec<PathBuf>`; `run` and `emit` take a single `PathBuf`. You run one program and you emit one artifact.

---

## What the tree already gives you, read at `193225a`

**Do not reach for `analyze` on the λ or TM paths.** `analyze(src) -> Analysis` returns `{ diagnostics, core }` and **no `Program`**, but `typeck::result_type` takes a `&Program`. Both non-reference backends need a result type to decode against, so they must go:

```rust
let (program, diagnostics) = redextape_core::parser::parse(src);
let Some(program) = program else { /* static failure */ };
let ty = redextape_core::typeck::result_type(&program);      // Result<Ty, Vec<Diagnostic>>
let core = redextape_core::desugar::desugar(&program);
```

That is the same order `examples/regen_fixtures.rs` uses. `--backend reference` does not need the type and can call `redextape_core::run(src)` directly.

**Signatures you will call, all verified:**

| function | signature |
|---|---|
| `redextape_core::run` | `(&str) -> Result<Value, RunError>` |
| `RunError` | `Static(Vec<Diagnostic>)` \| `Runtime(RuntimeError)` |
| `value::format_value` | `(&Value) -> String` |
| `typeck::result_type` | `(&Program) -> Result<Ty, Vec<Diagnostic>>` |
| `lambda::lower` | `(&Core) -> Result<LambdaTerm, LowerError>` |
| `lambda::run_lambda` | `(&Core, u64) -> LambdaRun` |
| `LambdaRun` | `Reduced(LambdaTerm)` \| `HitCap` \| `LowerError(LowerError)` |
| `lambda::decode_lambda_ty` | `(&LambdaTerm, &Ty) -> Option<Value>` |
| `lambda::print_lambda` | `(&LambdaTerm) -> String` |
| `lambda::MAX_REDUCTION_STEPS` | `u64` |
| `tm::run_tm_fitted` | `(&Core, &dyn Encoding, TmCaps) -> (TmRun, Option<usize>)` |
| `TmRun` | `Ran { tapes }` \| `HitCap` \| `Overflow` \| `TooLarge` \| `LowerError(LowerError)` |
| `tm::decode_tape_ty` | `(&[Tape], &Ty, &dyn Encoding) -> Option<Value>` |
| `tm::run_tm_described` | `(&Core, EncodingKind, Ty, TmCaps) -> Result<DescribedRun, TmRun>` |
| `tm::print_tm_with` | `(&Machine, &TmHeader) -> String` |
| `tm::parse_tm_full` | `(&str) -> (Option<Machine>, Option<TmHeader>, Vec<Diagnostic>)` |
| `tm::simulate` | `(&Machine, &[Vec<Symbol>], Caps) -> (Vec<Tape>, Status)` |
| `TmHeader::init` | `(&self, n_tapes: usize) -> Vec<Vec<Symbol>>` — `tapes` is private; this is the way in |
| `TmHeader` fields | `encoding: EncodingKind`, `width: usize`, `slots: u32`, `result: Ty` — all public |
| `RuntimeError` | `{ pub message: String }`, **no `Display`** — read the field |
| `EncodingKind::at` | `(self, width: usize) -> Box<dyn Encoding>` |
| `tm::lower_asm` | `(&Core) -> Result<Program, LowerError>` |
| `tm::print_asm` | `(&Program) -> String` |
| `tm::TM_DEFAULT_CAPS` | `Caps { steps: 5_000_000, cells: 5_000_000 }` |

**`redextape-cli` is BIN-ONLY** — its `Cargo.toml` declares `[[bin]]` and no `[lib]`, so
`cargo test -p redextape-cli --lib` fails with no targets. Use `--bin redextape` to run the module
tests, or plain `cargo test -p redextape-cli` for everything including the transcripts.

**The CLI's own reuse surface:**

- `input::Input::from_arg(&Path) -> Input` (`-` is stdin), `.read() -> Result<String, InputError>`, `.label() -> String`, `input::write_atomic(&Path, &str) -> io::Result<()>`.
- `report::render(&mut impl Write, label, src, &[Diagnostic], color) -> io::Result<()>`, `report::should_color() -> bool`.
- `fmt::run`'s shape is the model: `pub fn run(inputs: &[Input], .., out: &mut impl Write, err: &mut impl Write, color: bool) -> std::io::Result<Outcome>`.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `crates/redextape-cli/src/run.rs` | the `run` subcommand — extension dispatch, three backends, decode |
| `crates/redextape-cli/src/emit.rs` | the `emit` subcommand — three target forms |
| `crates/redextape-cli/tests/cmd/run_*.toml` + goldens | `run` transcripts |
| `crates/redextape-cli/tests/cmd/emit_*.toml` + goldens | `emit` transcripts |

**Modified:**

| Path | Change |
|---|---|
| `crates/redextape-cli/src/cli.rs` | two new `Command` variants |
| `crates/redextape-cli/src/main.rs` | two new outcome→exit-code arms, two `mod` lines |
| `crates/redextape-cli/README.md` | the two new subcommands |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | the closing entry |

---

## Task 1: `run` on a `.rxt` file, reference backend only

**Files:**
- Create: `crates/redextape-cli/src/run.rs`
- Modify: `crates/redextape-cli/src/cli.rs`, `crates/redextape-cli/src/main.rs`
- Test: `crates/redextape-cli/src/run.rs` (module tests), `crates/redextape-cli/tests/cmd/run_value.toml` and goldens

**Interfaces:**
- Consumes: `input::Input`, `report::render`, `redextape_core::{run, RunError}`, `redextape_core::value::format_value`.
- Produces: `pub enum Outcome { Ran, ProgramFailed, ToolFailed }` and `pub fn run(input: &Input, backend: Backend, out: &mut impl std::io::Write, err: &mut impl std::io::Write, color: bool) -> std::io::Result<Outcome>`; `pub enum Backend { Reference, Lambda, Tm }` with `Reference` as `Default`. Tasks 2–4 extend `run` without changing this signature.

**The three outcomes map to the three exit codes and nothing else.** `Ran` → 0, `ProgramFailed` → 1, `ToolFailed` → 2. Task 2 adds no variants; it adds arms that pick among these three.

- [ ] **Step 1: Add the `clap` variant**

In `crates/redextape-cli/src/cli.rs`, add to `enum Command`:

```rust
    /// Run a program and print its value.
    Run {
        /// The file to run. `.rxt` is a program; `.tm` is a machine. `-` reads standard input as a program.
        path: PathBuf,
        /// Which backend evaluates a `.rxt` program. Rejected for a `.tm` file, which is already a machine.
        #[arg(long, value_enum, default_value_t = crate::run::Backend::Reference)]
        backend: crate::run::Backend,
    },
```

- [ ] **Step 2: Write the failing test**

Create `crates/redextape-cli/src/run.rs` with only this test module at first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// **EVERY TEST GETS ITS OWN DIRECTORY, KEYED BY `case`.** `cargo test` runs the tests in one
    /// binary on parallel threads, so they share a process id — a single shared path would let one
    /// test read another's source. That fails intermittently rather than outright, which is worse
    /// than a broken test. `filename` carries the extension, because Task 4 dispatches on it.
    ///
    /// This is the only helper in this module; Tasks 2 and 4 parameterise it rather than adding
    /// near-identical copies.
    fn run_case(case: &str, filename: &str, src: &str, backend: Backend) -> (String, String, Outcome) {
        let dir = std::env::temp_dir().join(format!("rxt-cli-{}-{case}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(filename);
        std::fs::write(&p, src).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let outcome = run(&Input::from_arg(&p), backend, &mut out, &mut err, false).unwrap();
        (String::from_utf8(out).unwrap(), String::from_utf8(err).unwrap(), outcome)
    }

    #[test]
    fn a_value_program_prints_its_value_and_reports_ran() {
        let (out, err, outcome) = run_case("value", "p.rxt", "1 + 2", Backend::Reference);
        assert_eq!(out, "3\n");
        assert_eq!(err, "");
        assert!(matches!(outcome, Outcome::Ran));
    }

    #[test]
    fn a_type_error_is_the_programs_fault() {
        let (out, err, outcome) = run_case("type-error", "p.rxt", "1 + true", Backend::Reference);
        assert_eq!(out, "");
        assert!(!err.is_empty(), "a static failure must explain itself on stderr");
        assert!(matches!(outcome, Outcome::ProgramFailed));
    }

    #[test]
    fn a_runtime_fault_is_also_the_programs_fault() {
        let (out, err, outcome) = run_case("fault", "p.rxt", "head(nil)", Backend::Reference);
        assert_eq!(out, "");
        assert!(!err.is_empty());
        assert!(matches!(outcome, Outcome::ProgramFailed));
    }

    /// `format_value` renders a closure as `<non-value>`, which is a RESULT rather than a failure:
    /// the program evaluated, and the mini-language can produce a value no text form encodes.
    #[test]
    fn a_function_typed_program_runs_and_prints_non_value() {
        let (out, _err, outcome) = run_case("closure", "p.rxt", "|x| x + 1", Backend::Reference);
        assert_eq!(out, "<non-value>\n");
        assert!(matches!(outcome, Outcome::Ran));
    }
}
```

- [ ] **Step 3: Run it and confirm it fails to compile**

```bash
cargo test -p redextape-cli --bin redextape 2>&1 | tail -5
```

Expected: `cannot find type Outcome`, `cannot find function run`.

- [ ] **Step 4: Write the implementation**

Above the test module in `crates/redextape-cli/src/run.rs`:

```rust
//! `redextape run` — execute a program and print its value.
//!
//! **THE EXIT-CODE RULE IS "WHOSE FAULT IS IT".** `Outcome::ProgramFailed` (exit 1) means the input
//! is at fault: it did not parse, did not typecheck, or ran and faulted. `Outcome::ToolFailed`
//! (exit 2) means this tool could not answer a question about a perfectly good program — a backend
//! that cannot lower it, a result type with no encoding, or an unreadable file. Collapsing the two
//! would tell a script the program failed when it did not.

use crate::input::Input;
use crate::report;
use redextape_core::RunError;
use redextape_core::value::format_value;

/// Which evaluator runs a `.rxt` program. A `.tm` file is already a machine and takes none of these.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum Backend {
    /// The reference tree-walker. The only backend that can produce a result for every program that
    /// evaluates — see the module doc on `Lambda`/`Tm` and their type-directed decoders.
    #[default]
    Reference,
    Lambda,
    Tm,
}

/// What happened, in exactly the three shapes `main` maps to exit codes.
pub enum Outcome {
    /// Ran and printed a value.
    Ran,
    /// The input is at fault — did not parse, did not typecheck, or faulted while running.
    ProgramFailed,
    /// This tool could not answer. The program may be perfectly good.
    ToolFailed,
}

/// Run `input` on `backend` and print the value to `out`.
///
/// # Errors
///
/// Only `io::Error` from writing to `out`/`err`. Every failure of the program or of this tool is an
/// `Outcome`, not an `Err` — an unreadable file is `ToolFailed` with a message, not a propagated
/// error, so `main` has one place that decides exit codes.
pub fn run(
    input: &Input,
    backend: Backend,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    let src = match input.read() {
        Ok(s) => s,
        Err(e) => {
            writeln!(err, "{e}")?;
            return Ok(Outcome::ToolFailed);
        }
    };
    let label = input.label();
    match backend {
        Backend::Reference => run_reference(&src, &label, out, err, color),
        // Task 2 replaces this arm.
        Backend::Lambda | Backend::Tm => {
            writeln!(err, "error: `--backend {backend:?}` is not implemented yet")?;
            Ok(Outcome::ToolFailed)
        }
    }
}

fn run_reference(
    src: &str,
    label: &str,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    match redextape_core::run(src) {
        Ok(v) => {
            writeln!(out, "{}", format_value(&v))?;
            Ok(Outcome::Ran)
        }
        Err(RunError::Static(ds)) => {
            report::render(err, label, src, &ds, color)?;
            Ok(Outcome::ProgramFailed)
        }
        // `RuntimeError` is a struct with a public `message: String` and NO `Display` impl, so
        // `{e}` does not compile and `{e:?}` would print the struct wrapper. Read the field.
        Err(RunError::Runtime(e)) => {
            writeln!(err, "error: {}", e.message)?;
            Ok(Outcome::ProgramFailed)
        }
    }
}
```

Add `mod run;` to `crates/redextape-cli/src/main.rs` beside the other `mod` lines, and the dispatch arm:

```rust
        cli::Command::Run { path, backend } => {
            let input = Input::from_arg(&path);
            match run::run(&input, backend, &mut out, &mut err, color) {
                Ok(run::Outcome::Ran) => ExitCode::SUCCESS,
                Ok(run::Outcome::ProgramFailed) => ExitCode::from(1),
                Ok(run::Outcome::ToolFailed) => ExitCode::from(2),
                Err(e) => {
                    let _ = writeln!(err, "{e}");
                    ExitCode::from(2)
                }
            }
        }
```

- [ ] **Step 5: Run the tests**

```bash
cargo test -p redextape-cli --bin redextape 2>&1 | tail -5
```

Expected: the 4 new `run::tests` pass. **Do not expect a total of 4** — `--bin redextape` runs every unit test in the binary, including `fmt`, `lint`, `input` and `report`'s, so the headline number is far larger and grows each task. Check the names you added, not the total.

- [ ] **Step 6: Add the transcript**

`crates/redextape-cli/tests/cmd/run_value.toml`:

```toml
bin.name = "redextape"
args = ["run", "p.rxt"]
fs.sandbox = true
```

`crates/redextape-cli/tests/cmd/run_value.in/p.rxt`:

```
1 + 2
```

`crates/redextape-cli/tests/cmd/run_value.stdout`:

```
3
```

`crates/redextape-cli/tests/cmd/run_value.stderr` — empty file.

- [ ] **Step 7: Run the transcripts**

```bash
cargo test -p redextape-cli --test cli 2>&1 | tail -5
```

Expected: pass. If `trycmd` reports a missing `.out` directory, note that `fs.sandbox = true` requires the `.in` directory to exist and creates `.out` from it on first run — check the existing `fmt_rewrite.*` case for the exact layout before changing anything.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-cli/
git commit -m "cli: `run` executes a program on the reference backend"
```

---

## Task 2: `--backend lambda` and `--backend tm`

**Files:**
- Modify: `crates/redextape-cli/src/run.rs`
- Test: `crates/redextape-cli/src/run.rs` module tests, `tests/cmd/run_backends.toml`

**Interfaces:**
- Consumes: Task 1's `Backend`, `Outcome`, `run`.
- Produces: no new public names. `run`'s `Lambda`/`Tm` arm becomes real.

**The pipeline both backends share**, and the reason neither can use `analyze`:

```rust
let (program, diagnostics) = redextape_core::parser::parse(src);
let Some(program) = program else { /* ProgramFailed, render diagnostics */ };
let ty = match redextape_core::typeck::result_type(&program) {
    Ok(t) => t,
    Err(ds) => { /* ProgramFailed, render ds */ }
};
let core = redextape_core::desugar::desugar(&program);
```

`analyze` returns `{ diagnostics, core }` and no `Program`, and `result_type` needs the `Program`.

- [ ] **Step 1: Write the failing tests**

Add to `run.rs`'s test module:

```rust
    /// The oracle, as a test: three backends, one answer. This is the property the whole project is
    /// built on, and until now nothing outside `redextape-core`'s own tests asserted it.
    #[test]
    fn all_three_backends_agree_on_a_value_program() {
        for backend in [Backend::Reference, Backend::Lambda, Backend::Tm] {
            let (out, err, outcome) = run_case(&format!("agree-nat-{backend:?}"), "p.rxt", "1 + 2", backend);
            assert_eq!(out, "3\n", "{backend:?} disagreed; stderr was: {err}");
            assert!(matches!(outcome, Outcome::Ran), "{backend:?} did not run");
        }
    }

    #[test]
    fn all_three_backends_agree_on_a_list_program() {
        for backend in [Backend::Reference, Backend::Lambda, Backend::Tm] {
            let (out, err, outcome) = run_case(&format!("agree-list-{backend:?}"), "p.rxt", "[1, 2, 3]", backend);
            assert_eq!(out, "[1, 2, 3]\n", "{backend:?} disagreed; stderr was: {err}");
            assert!(matches!(outcome, Outcome::Ran));
        }
    }

    /// Design §6. `|x| x + 1` types as `(Nat) -> Nat`; both non-reference decoders refuse `Ty::Fun`,
    /// while the reference interpreter evaluates it and prints `<non-value>`. The program is fine —
    /// this tool cannot answer that question about it — so it is `ToolFailed`, not `ProgramFailed`.
    #[test]
    fn a_function_typed_result_is_the_tools_limit_not_the_programs_fault() {
        for backend in [Backend::Lambda, Backend::Tm] {
            let (out, err, outcome) = run_case(&format!("closure-{backend:?}"), "p.rxt", "|x| x + 1", backend);
            assert_eq!(out, "", "{backend:?} must print no value");
            assert!(err.contains("decode"), "{backend:?} must say it cannot decode, got: {err}");
            assert!(matches!(outcome, Outcome::ToolFailed), "{backend:?} must be ToolFailed");
        }
    }
```

- [ ] **Step 2: Run and confirm failure**

```bash
cargo test -p redextape-cli --bin redextape 2>&1 | tail -8
```

Expected: the three new tests fail — the two agreement tests because the arm is a stub, and the asymmetry test because stderr says "not implemented yet" rather than naming decode.

- [ ] **Step 3: Implement both backends**

Replace `run`'s stub arm with `Backend::Lambda => run_lambda_backend(..)`, `Backend::Tm => run_tm_backend(..)`, and add:

```rust
/// Parse, typecheck and desugar, returning the `Core` and the result type both non-reference
/// backends need. `analyze` cannot serve here: it hands back a `Core` and no `Program`, and
/// `result_type` takes a `&Program`.
fn analyzed(
    src: &str,
    label: &str,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Option<(redextape_core::core::Core, redextape_core::ty::Ty)>> {
    let (program, diagnostics) = redextape_core::parser::parse(src);
    let Some(program) = program else {
        report::render(err, label, src, &diagnostics, color)?;
        return Ok(None);
    };
    let ty = match redextape_core::typeck::result_type(&program) {
        Ok(t) => t,
        Err(ds) => {
            report::render(err, label, src, &ds, color)?;
            return Ok(None);
        }
    };
    Ok(Some((redextape_core::desugar::desugar(&program), ty)))
}

fn run_lambda_backend(
    src: &str,
    label: &str,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    let Some((core, ty)) = analyzed(src, label, err, color)? else { return Ok(Outcome::ProgramFailed) };
    match redextape_core::lambda::run_lambda(&core, redextape_core::lambda::MAX_REDUCTION_STEPS) {
        redextape_core::lambda::LambdaRun::Reduced(nf) => {
            match redextape_core::lambda::decode_lambda_ty(&nf, &ty) {
                Some(v) => {
                    writeln!(out, "{}", format_value(&v))?;
                    Ok(Outcome::Ran)
                }
                None => {
                    writeln!(
                        err,
                        "error: `--backend lambda` cannot decode a result of type `{}`\n  \
                         the encodings cover Nat, Bool, Unit and List<T>; this type has none\n  \
                         `--backend reference` will evaluate it",
                        redextape_core::ty::show(&ty)
                    )?;
                    Ok(Outcome::ToolFailed)
                }
            }
        }
        redextape_core::lambda::LambdaRun::HitCap => {
            writeln!(
                err,
                "error: reduction did not finish within {} steps (`MAX_REDUCTION_STEPS`)",
                redextape_core::lambda::MAX_REDUCTION_STEPS
            )?;
            Ok(Outcome::ProgramFailed)
        }
        redextape_core::lambda::LambdaRun::LowerError(e) => {
            writeln!(err, "error: this program has no lambda lowering: {e:?}")?;
            Ok(Outcome::ToolFailed)
        }
    }
}

fn run_tm_backend(
    src: &str,
    label: &str,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    let Some((core, ty)) = analyzed(src, label, err, color)? else { return Ok(Outcome::ProgramFailed) };
    let enc = redextape_core::tm::Unary::default();
    let (outcome, _width) =
        redextape_core::tm::run_tm_fitted(&core, &enc, redextape_core::tm::TM_DEFAULT_CAPS);
    match outcome {
        redextape_core::tm::TmRun::Ran { tapes } => {
            match redextape_core::tm::decode_tape_ty(&tapes, &ty, &enc) {
                Some(v) => {
                    writeln!(out, "{}", format_value(&v))?;
                    Ok(Outcome::Ran)
                }
                None => {
                    writeln!(
                        err,
                        "error: `--backend tm` cannot decode a result of type `{}`\n  \
                         a tape encodes Nat, Bool, Unit and List<T>; this type has none\n  \
                         `--backend reference` will evaluate it",
                        redextape_core::ty::show(&ty)
                    )?;
                    Ok(Outcome::ToolFailed)
                }
            }
        }
        redextape_core::tm::TmRun::HitCap => {
            writeln!(
                err,
                "error: the machine did not halt within {} steps or {} tape cells (`TM_DEFAULT_CAPS`)",
                redextape_core::tm::TM_DEFAULT_CAPS.steps,
                redextape_core::tm::TM_DEFAULT_CAPS.cells
            )?;
            Ok(Outcome::ProgramFailed)
        }
        redextape_core::tm::TmRun::Overflow => {
            writeln!(err, "error: a value exceeded the widest tape field this encoding has")?;
            Ok(Outcome::ProgramFailed)
        }
        // Design §9.1. The ceiling is `MAX_MACHINE_STATES`; a balanced expression tree reaches it
        // from about 6 KB of source, and the allocation before refusal is roughly 700 MB.
        redextape_core::tm::TmRun::TooLarge => {
            writeln!(
                err,
                "error: this program lowers to more than {} TM states\n  \
                 the ceiling is `MAX_MACHINE_STATES`; a balanced expression tree reaches it from \
                 about 6 KB of source\n  try `--backend reference`, or a smaller program",
                redextape_core::tm::MAX_MACHINE_STATES
            )?;
            Ok(Outcome::ToolFailed)
        }
        redextape_core::tm::TmRun::LowerError(e) => {
            writeln!(err, "error: this program has no TM lowering: {e:?}")?;
            Ok(Outcome::ToolFailed)
        }
    }
}
```

`Unary::default()` is `MAX_FIELD_WIDTH`; `run_tm_fitted` narrows it per program and reports the width it settled on, which this command does not print.

- [ ] **Step 4: Run the tests**

```bash
cargo test -p redextape-cli --bin redextape 2>&1 | tail -5
```

Expected: the 3 new tests pass, alongside Task 1's 4. Check the names, not the crate total — see Task 1 Step 5.

**If `all_three_backends_agree_on_a_list_program` fails on the `Tm` arm**, read the reported stderr before changing anything: `[1, 2, 3]` lowers and decodes in `redextape-core`'s own oracle, so a failure here is this module wiring the decoder wrongly — most likely passing a different `Encoding` instance to `decode_tape_ty` than to `run_tm_fitted`.

- [ ] **Step 5: Add the agreement transcript**

`tests/cmd/run_backends.toml`:

```toml
bin.name = "redextape"
args = ["run", "p.rxt", "--backend", "tm"]
fs.sandbox = true
```

with `run_backends.in/p.rxt` containing `[1, 2, 3]`, `run_backends.stdout` containing `[1, 2, 3]`, and an empty `run_backends.stderr`.

- [ ] **Step 6: Run everything and commit**

```bash
cargo test -p redextape-cli 2>&1 | tail -5
git add crates/redextape-cli/
git commit -m "cli: --backend puts the oracle's three agreeing evaluators behind one flag"
```

---

## Task 3: `emit --lang tm`

**Files:**
- Create: `crates/redextape-cli/src/emit.rs`
- Modify: `crates/redextape-cli/src/cli.rs`, `crates/redextape-cli/src/main.rs`
- Test: `crates/redextape-cli/src/emit.rs` module tests, `tests/cmd/emit_tm.toml`

**Interfaces:**
- Consumes: `input::Input`, `input::write_atomic`, `report::render`.
- Produces: `pub enum Lang { Tm, Lambda, Asm }`, `pub enum Outcome { Emitted, ProgramFailed, ToolFailed }`, and `pub fn run(input: &Input, lang: Lang, encoding: EncodingArg, dest: Option<&Path>, out: &mut impl Write, err: &mut impl Write, color: bool) -> std::io::Result<Outcome>`. `pub enum EncodingArg { Unary, Binary }` with `Unary` as `Default`. Task 4 adds the `Lambda` and `Asm` arms without changing this signature.

- [ ] **Step 1: Add the `clap` variant**

```rust
    /// Compile a program to a backend text form.
    Emit {
        /// The program to compile. `-` reads standard input.
        path: PathBuf,
        /// Which text form to write.
        #[arg(long, value_enum)]
        lang: crate::emit::Lang,
        /// Tape encoding. `--lang tm` only.
        #[arg(long, value_enum, default_value_t = crate::emit::EncodingArg::Unary)]
        encoding: crate::emit::EncodingArg,
        /// Write here instead of standard output.
        #[arg(short = 'o', long)]
        out: Option<PathBuf>,
    },
```

- [ ] **Step 2: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Own directory per case, for the reason `run.rs`'s `run_case` gives: parallel test threads
    /// share a process id, and a shared path makes one test read another's source.
    fn emit_case(case: &str, src: &str, lang: Lang, encoding: EncodingArg) -> (String, String, Outcome) {
        let dir = std::env::temp_dir().join(format!("rxt-emit-{}-{case}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("p.rxt");
        std::fs::write(&p, src).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let outcome =
            run(&Input::from_arg(&p), lang, encoding, None, &mut out, &mut err, false).unwrap();
        (String::from_utf8(out).unwrap(), String::from_utf8(err).unwrap(), outcome)
    }

    /// The emitted file must be a complete, self-describing `.tm` — the property `run` (Task 4)
    /// depends on, since a header-less file records no initial tapes.
    #[test]
    fn emitted_tm_carries_a_header_and_re_parses() {
        let (text, err, outcome) = emit_case("tm", "1 + 2", Lang::Tm, EncodingArg::Unary);
        assert!(matches!(outcome, Outcome::Emitted), "stderr: {err}");
        let (machine, header, ds) = redextape_core::tm::parse_tm_full(&text);
        assert!(ds.is_empty(), "emitted TM must re-parse cleanly, got: {ds:?}");
        assert!(machine.is_some(), "emitted TM must carry a machine");
        assert!(header.is_some(), "emitted TM must carry a header, or `run` cannot use it");
    }

    #[test]
    fn the_binary_encoding_is_selectable_and_differs() {
        let (unary, _, _) = emit_case("enc-u", "1 + 2", Lang::Tm, EncodingArg::Unary);
        let (binary, _, _) = emit_case("enc-b", "1 + 2", Lang::Tm, EncodingArg::Binary);
        assert!(unary.contains("encoding unary"));
        assert!(binary.contains("encoding binary"));
        assert_ne!(unary, binary);
    }

    #[test]
    fn a_type_error_is_the_programs_fault() {
        let (out, err, outcome) = emit_case("type-error", "1 + true", Lang::Tm, EncodingArg::Unary);
        assert_eq!(out, "");
        assert!(!err.is_empty());
        assert!(matches!(outcome, Outcome::ProgramFailed));
    }
}
```

- [ ] **Step 3: Run and confirm it fails to compile**

```bash
cargo test -p redextape-cli --bin redextape 2>&1 | tail -5
```

- [ ] **Step 4: Implement**

```rust
//! `redextape emit` — compile a program to a backend text form.
//!
//! **TWO OF THE THREE TARGETS ROUND-TRIP AND ONE DOES NOT.** `tm` re-parses through
//! `parse_tm_full` and `lambda` through `parse_lambda`. `asm` cannot: `parse_asm` is unclaimed, so
//! nothing — including this program — can read an emitted `.asm` back. That target writes a header
//! comment saying so, which is the whole mitigation.

use crate::input::{Input, write_atomic};
use crate::report;
use redextape_core::tm::EncodingKind;
use std::path::Path;

/// Which text form to write.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum Lang {
    Tm,
    Lambda,
    Asm,
}

/// Tape encoding for `--lang tm`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum EncodingArg {
    #[default]
    Unary,
    Binary,
}

impl From<EncodingArg> for EncodingKind {
    fn from(a: EncodingArg) -> Self {
        match a {
            EncodingArg::Unary => EncodingKind::Unary,
            EncodingArg::Binary => EncodingKind::Binary,
        }
    }
}

pub enum Outcome {
    Emitted,
    ProgramFailed,
    ToolFailed,
}

/// Compile `input` to `lang` and write it to `dest`, or to `out` when `dest` is `None`.
///
/// # Errors
///
/// Only `io::Error` from writing. Program and tool failures are `Outcome`s — see `run.rs`'s module
/// doc for the whose-fault-is-it rule both commands share.
pub fn run(
    input: &Input,
    lang: Lang,
    encoding: EncodingArg,
    dest: Option<&Path>,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    if lang != Lang::Tm && encoding != EncodingArg::default() {
        writeln!(err, "error: `--encoding` applies to `--lang tm` only")?;
        return Ok(Outcome::ToolFailed);
    }
    let src = match input.read() {
        Ok(s) => s,
        Err(e) => {
            writeln!(err, "{e}")?;
            return Ok(Outcome::ToolFailed);
        }
    };
    let label = input.label();
    let (program, diagnostics) = redextape_core::parser::parse(&src);
    let Some(program) = program else {
        report::render(err, &label, &src, &diagnostics, color)?;
        return Ok(Outcome::ProgramFailed);
    };
    let ty = match redextape_core::typeck::result_type(&program) {
        Ok(t) => t,
        Err(ds) => {
            report::render(err, &label, &src, &ds, color)?;
            return Ok(Outcome::ProgramFailed);
        }
    };
    let core = redextape_core::desugar::desugar(&program);
    let text = match lang {
        Lang::Tm => match emit_tm(&core, ty, encoding, err)? {
            Some(t) => t,
            None => return Ok(Outcome::ToolFailed),
        },
        // Task 4 replaces these.
        Lang::Lambda | Lang::Asm => {
            writeln!(err, "error: `--lang {lang:?}` is not implemented yet")?;
            return Ok(Outcome::ToolFailed);
        }
    };
    match dest {
        Some(p) => write_atomic(p, &text)?,
        None => write!(out, "{text}")?,
    }
    Ok(Outcome::Emitted)
}

/// `run_tm_described` rather than `lower_tm`, because only it produces a `TmHeader` — and a `.tm`
/// file without one records the transition function and the start state but not the initial tapes,
/// which is exactly what `run` needs to execute it. The cost is that it SIMULATES, under
/// `TM_DEFAULT_CAPS`; a program that caps here has not failed to compile, and says so.
fn emit_tm(
    core: &redextape_core::core::Core,
    ty: redextape_core::ty::Ty,
    encoding: EncodingArg,
    err: &mut impl std::io::Write,
) -> std::io::Result<Option<String>> {
    match redextape_core::tm::run_tm_described(
        core,
        encoding.into(),
        ty,
        redextape_core::tm::TM_DEFAULT_CAPS,
    ) {
        Ok(d) => Ok(Some(redextape_core::tm::print_tm_with(&d.machine, &d.header))),
        Err(redextape_core::tm::TmRun::TooLarge) => {
            writeln!(
                err,
                "error: this program lowers to more than {} TM states\n  \
                 the ceiling is `MAX_MACHINE_STATES`; a balanced expression tree reaches it from \
                 about 6 KB of source",
                redextape_core::tm::MAX_MACHINE_STATES
            )?;
            Ok(None)
        }
        Err(other) => {
            writeln!(
                err,
                "error: cannot build a self-describing machine for this program: {other:?}\n  \
                 a header needs the initial tapes, which come from fitting and running the machine"
            )?;
            Ok(None)
        }
    }
}
```

Add `mod emit;` and the `main.rs` arm mapping `Emitted` → 0, `ProgramFailed` → 1, `ToolFailed` → 2.

- [ ] **Step 5: Run the tests**

```bash
cargo test -p redextape-cli --bin redextape 2>&1 | tail -5
```

Expected: the 3 new `emit::tests` pass. Check the names, not the crate total — see Task 1 Step 5.

- [ ] **Step 6: Add the transcript and commit**

`tests/cmd/emit_tm.toml` with `args = ["emit", "p.rxt", "--lang", "tm"]`, `emit_tm.in/p.rxt` containing `1 + 2`, and `emit_tm.stdout` holding the emitted file verbatim. **Generate that golden by running the binary, then read it before committing** — a golden nobody read is a snapshot of whatever the code did.

```bash
cargo test -p redextape-cli 2>&1 | tail -5
git add crates/redextape-cli/
git commit -m "cli: `emit --lang tm` writes a self-describing machine"
```

---

## Task 4: `run` on a `.tm` artifact, and the round-trip

**Files:**
- Modify: `crates/redextape-cli/src/run.rs`, `crates/redextape-cli/src/cli.rs`
- Test: `crates/redextape-cli/src/run.rs` module tests, `tests/cmd/run_artifact.toml`, `tests/cmd/roundtrip.toml`

**Interfaces:**
- Consumes: Task 1's `run`, Task 3's `emit`.
- Produces: no new public names.

**`run` now dispatches on the extension.** `.tm` takes the artifact path; everything else is a program. Passing `--backend` with a `.tm` file is an error — the artifact *is* a machine.

- [ ] **Step 1: Write the failing tests**

**Reuse Task 1's `run_case`** — it already takes the filename, which is what the extension dispatch reads. Do not add a second helper.

```rust
    /// The checked-in fixture is a real 464-line machine written by `examples/regen_fixtures.rs`
    /// through the same printer `emit` uses, so this asserts the artifact path without depending on
    /// `emit` being correct.
    #[test]
    fn a_checked_in_tm_fixture_runs_to_its_value() {
        let text = include_str!("../../redextape-core/tests/fixtures/list_1_2.tm");
        let (out, err, outcome) = run_case("fixture", "m.tm", text, Backend::Reference);
        assert_eq!(out, "[1, 2]\n", "stderr: {err}");
        assert!(matches!(outcome, Outcome::Ran));
    }

    #[test]
    fn a_header_less_tm_cannot_be_run_and_says_why() {
        // `print_tm` (no header) records the transition function and start state and no tapes.
        let text = "tapes 1\nstart s\n\nstate s: accept\n";
        let (out, err, outcome) = run_case("headerless", "m.tm", text, Backend::Reference);
        assert_eq!(out, "");
        assert!(err.contains("header"), "the message must name the missing header, got: {err}");
        assert!(matches!(outcome, Outcome::ToolFailed));
    }
```

- [ ] **Step 2: Run and confirm failure**

```bash
cargo test -p redextape-cli --bin redextape 2>&1 | tail -8
```

Expected: both fail — the fixture is currently read as a program and does not parse as `.rxt`.

- [ ] **Step 3: Implement the dispatch**

In `run`, after reading `src`, branch before choosing a backend:

```rust
    let is_artifact = matches!(input, Input::Path(p) if p.extension().is_some_and(|e| e == "tm"));
    if is_artifact {
        if backend != Backend::Reference {
            writeln!(err, "error: `--backend` does not apply to a `.tm` file, which is already a machine")?;
            return Ok(Outcome::ToolFailed);
        }
        return run_artifact_text(&src, &label, out, err, color);
    }
```

and add:

```rust
/// Simulate a `.tm` file. **The header is what makes this possible**: `TmHeader::init` builds the
/// initial tapes and the header's `result` type is what `decode_tape_ty` decodes against, so a
/// header-less file cannot be run even though it parses perfectly.
fn run_artifact_text(
    src: &str,
    label: &str,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    let (machine, header, ds) = redextape_core::tm::parse_tm_full(src);
    if !ds.is_empty() {
        report::render(err, label, src, &ds, color)?;
        return Ok(Outcome::ProgramFailed);
    }
    let Some(machine) = machine else {
        writeln!(err, "error: `{label}` carries no machine")?;
        return Ok(Outcome::ProgramFailed);
    };
    let Some(header) = header else {
        writeln!(
            err,
            "error: `{label}` has no header\n  \
             a `.tm` file without one records the transition function and the start state but not \
             the initial tapes, so there is nothing to run\n  \
             re-emit it with `redextape emit --lang tm`, which always writes a header"
        )?;
        return Ok(Outcome::ToolFailed);
    };
    let enc = header.encoding.at(header.width);
    let init = header.init(machine.tapes);
    let (tapes, _status) =
        redextape_core::tm::simulate(&machine, &init, redextape_core::tm::TM_DEFAULT_CAPS);
    match redextape_core::tm::decode_tape_ty(&tapes, &header.result, &*enc) {
        Some(v) => {
            writeln!(out, "{}", redextape_core::value::format_value(&v))?;
            Ok(Outcome::Ran)
        }
        None => {
            writeln!(err, "error: the final tapes do not decode as `{}`", redextape_core::ty::show(&header.result))?;
            Ok(Outcome::ToolFailed)
        }
    }
}
```

`TmHeader`'s `encoding`, `width`, `slots` and `result` are all public fields — checked, so no accessor hunt is needed. Its `tapes` field is private, which is why the initial tapes come from the public `init(n_tapes)` rather than from the field.

- [ ] **Step 4: Run the tests**

```bash
cargo test -p redextape-cli --bin redextape 2>&1 | tail -5
```

Expected: the 2 new artifact tests pass. Check the names, not the crate total — see Task 1 Step 5.

- [ ] **Step 5: Add the round-trip transcript — the point of the whole slice**

`tests/cmd/roundtrip.toml`:

```toml
bin.name = "redextape"
args = ["run", "p.tm"]
fs.sandbox = true
```

with `roundtrip.in/p.tm` being the file `emit --lang tm` produces for `[1, 2, 3]` (generate it, read it, commit it) and `roundtrip.stdout` containing `[1, 2, 3]`.

Add a `tests/` integration test that runs both commands in sequence:

```rust
/// `emit` then `run` is the oracle expressed as two shell commands: a program compiled all the way
/// to a Turing machine, written to a file, read back by a parser that shares no code with the
/// compiler, simulated, and decoded to the same value the tree-walker gives.
#[test]
fn emit_then_run_reproduces_the_reference_answer() {
    let dir = std::env::temp_dir().join("rxt-roundtrip");
    std::fs::create_dir_all(&dir).unwrap();
    let src = dir.join("p.rxt");
    let art = dir.join("p.tm");
    std::fs::write(&src, "[1, 2, 3]").unwrap();

    assert_cmd::Command::cargo_bin("redextape")
        .unwrap()
        .args(["emit", src.to_str().unwrap(), "--lang", "tm", "-o", art.to_str().unwrap()])
        .assert()
        .success();

    assert_cmd::Command::cargo_bin("redextape")
        .unwrap()
        .args(["run", art.to_str().unwrap()])
        .assert()
        .success()
        .stdout("[1, 2, 3]\n");
}
```

- [ ] **Step 6: Run everything and commit**

```bash
cargo test -p redextape-cli 2>&1 | tail -5
git add crates/redextape-cli/
git commit -m "cli: `run` simulates a .tm artifact, and emit-then-run is the oracle in a shell"
```

---

## Task 5: `emit --lang lambda` and `--lang asm`

**Files:**
- Modify: `crates/redextape-cli/src/emit.rs`
- Test: `crates/redextape-cli/src/emit.rs` module tests, `tests/cmd/emit_lambda.toml`, `tests/cmd/emit_asm.toml`

**Interfaces:**
- Consumes: Task 3's `run`, `Lang`, `Outcome`.
- Produces: no new public names.

**`--lang lambda` is the first thing in this project's history to write a λ file.** `rxlambda` appears in exactly three tracked files — a plan, the λ grammar's README and its `tree-sitter.json` — and in no code. PR 2 shipped an editor grammar for an extension nothing could produce; this closes that.

- [ ] **Step 1: Write the failing tests**

```rust
    /// λ's first producer. The emitted text must re-parse under `parse_lambda`, which is the same
    /// standard `emit --lang tm` meets through `parse_tm_full`.
    #[test]
    fn emitted_lambda_re_parses() {
        let (text, err, outcome) = emit_case("lambda", "1 + 2", Lang::Lambda, EncodingArg::Unary);
        assert!(matches!(outcome, Outcome::Emitted), "stderr: {err}");
        let (term, ds) = redextape_core::lambda::parse_lambda(&text);
        assert!(ds.is_empty(), "emitted lambda must re-parse cleanly, got: {ds:?}");
        assert!(term.is_some());
    }

    /// The asm target has NO round-trip test and cannot have one — `parse_asm` is unclaimed. What is
    /// testable is that the file says so, which is the entire mitigation.
    #[test]
    fn emitted_asm_declares_that_it_cannot_be_read_back() {
        let (text, err, outcome) = emit_case("asm", "1 + 2", Lang::Asm, EncodingArg::Unary);
        assert!(matches!(outcome, Outcome::Emitted), "stderr: {err}");
        assert!(text.starts_with("; This file cannot be read back."), "got: {}", &text[..80.min(text.len())]);
        assert!(text.contains("parse_asm"), "the comment must name the missing function");
    }

    #[test]
    fn encoding_is_rejected_off_the_tm_target() {
        let (_out, err, outcome) = emit_case("enc-off-target", "1 + 2", Lang::Lambda, EncodingArg::Binary);
        assert!(err.contains("--encoding"), "got: {err}");
        assert!(matches!(outcome, Outcome::ToolFailed));
    }
```

- [ ] **Step 2: Run and confirm failure**

```bash
cargo test -p redextape-cli --bin redextape 2>&1 | tail -8
```

- [ ] **Step 3: Implement both arms**

Replace the stub arm in `run`:

```rust
        Lang::Lambda => match redextape_core::lambda::lower(&core) {
            Ok(term) => format!("{}\n", redextape_core::lambda::print_lambda(&term)),
            Err(e) => {
                writeln!(err, "error: this program has no lambda lowering: {e:?}")?;
                return Ok(Outcome::ToolFailed);
            }
        },
        Lang::Asm => match redextape_core::tm::lower_asm(&core) {
            Ok(prog) => format!("{ASM_PREAMBLE}{}", redextape_core::tm::print_asm(&prog)),
            Err(e) => {
                writeln!(err, "error: this program has no asm lowering: {e:?}")?;
                return Ok(Outcome::ToolFailed);
            }
        },
```

and add the constant beside `Lang`:

```rust
/// **THE ONE EMITTED FORM THAT CANNOT BE READ BACK**, and the file says so rather than leaving a
/// reader to discover it. `parse_asm` was promised by Plan 3's key interfaces and never landed;
/// four consecutive roadmap entries have recorded it as unclaimed. Emitting into that gap was a
/// deliberate choice — a user-facing artifact that admits the gap is more likely to close it than a
/// fifth prose mention — and this comment is the whole mitigation.
const ASM_PREAMBLE: &str = "\
; This file cannot be read back. `parse_asm` is unclaimed — nothing, including
; redextape itself, can parse the asm text form. Emitted for reading only.
";
```

**Keep the `result_type` call even though only the `Tm` arm consumes `ty`.** It is not dead: a program that does not typecheck must fail as `ProgramFailed` before any lowering runs, and dropping the call would hand a type error to a lowering that assumes a typed program. It also raises no unused-variable warning, because one match arm does use it.

- [ ] **Step 4: Run the tests**

```bash
cargo test -p redextape-cli --bin redextape 2>&1 | tail -5
```

Expected: the 3 new tests pass. Check the names, not the crate total — see Task 1 Step 5.

- [ ] **Step 5: Add both transcripts**

`tests/cmd/emit_lambda.toml` and `tests/cmd/emit_asm.toml`, each with a `.in/p.rxt` of `1 + 2` and a `.stdout` generated from the binary and read before committing.

- [ ] **Step 6: Commit**

```bash
cargo test -p redextape-cli 2>&1 | tail -5
git add crates/redextape-cli/
git commit -m "cli: `emit --lang lambda` is this project's first lambda-file producer; asm admits it cannot be read back"
```

---

## Task 6: README and the roadmap entry

**Files:**
- Modify: `crates/redextape-cli/README.md`, `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Update the CLI README** with both subcommands: `run`'s extension dispatch and `--backend`, `emit`'s three targets, the exit-code rule, and the two asymmetries a user will otherwise meet as bugs — that `--backend lambda|tm` cannot decode a function-typed result, and that `--lang asm` writes a file nothing can read back.

- [ ] **Step 2: Write the roadmap entry.** Read the last two `####` entries first and match their shape. Cover at minimum: that `emit` then `run` is the four-way oracle expressed as two shell commands and the first time it is visible outside Rust; that `--lang lambda` is the first λ-file producer in the project's history, closing a gap where an editor grammar existed for an extension nothing could produce; the type-directed decode asymmetry and why it is `ToolFailed` rather than `ProgramFailed`; and the asm target as a deliberate emission into an open gap.

- [ ] **Step 3: MEASURE THE FIGURES AT PR TIME, AND FILL THEM BEFORE THE MERGE.**

PR 1 of the tree-sitter slice lost four figures and PR 2 lost three by writing them before the whole-branch review landed its commits. PR 3 left them as placeholders instead — and then **merged with the placeholders live**, which took a follow-up PR to fix. The entry for that one now says the rule: **filling the placeholders is part of the merge, not work that follows it.** Placeholder text is the only part of an entry a reader cannot interpret at all.

So: write the prose now, take every number from the commit CI passes on, and do not merge until they are in.

```bash
git rev-list --count <base>..<final>
cargo nextest run --workspace                  # 1125 passed / 8 skipped at the branch point
cargo nextest run -p redextape-cli              # the number to beat
scripts/check-all.sh --no-llvm --no-browser     # quote its own PARTIAL line
```

- [ ] **Step 4: Commit and open the PR.** Do not merge — Davey reviews and merges his own PRs, and holds branches to fix findings rather than landing and following up.

---

## Self-Review

**Spec coverage.** §2's file structure → Tasks 1, 3. §3's extension dispatch → Task 4; its `--backend` → Tasks 1–2; its `.rxlambda` exclusion is enforced by the dispatch being `.tm`-only and needs no code. §4's three targets → Tasks 3, 5; the asm preamble → Task 5. §5's exit-code table → the `Outcome` enums in Tasks 1 and 3, with every `TmRun` and `LambdaRun` variant given an arm in Task 2. §6's asymmetry → Task 2's `a_function_typed_result_is_the_tools_limit_not_the_programs_fault`. §7's non-closures are stated, not built. §8's three test layers → module tests in every task, transcripts in Tasks 1–5, the round-trip in Task 4. §9.1's ceiling → Task 2's `TooLarge` arm and Task 3's. §10's exclusions appear nowhere, which is correct.

**Type consistency.** `Backend` and `run::Outcome` are defined in Task 1 and used unchanged in 2 and 4. `Lang`, `EncodingArg` and `emit::Outcome` are defined in Task 3 and used unchanged in 5. Both `run` functions keep the `(input, .., out, err, color) -> io::Result<Outcome>` shape `fmt::run` established. `EncodingArg` converts to `EncodingKind` through one `From` impl rather than being matched twice.

**Two things this plan tells the implementer to stop rather than work around**, because both would breach the Global Constraints: a missing `Display` on `RuntimeError` (use `{e:?}`), and private fields on `TmHeader` (use its accessors). Neither may be fixed by editing `redextape-core`.

**One deliberate absence.** `--lang asm` has no round-trip test in any task, and Task 5 says so in the test name and the doc comment. The suite will carry a gap shaped exactly like `parse_asm`, which is better than the same gap living only in prose.
