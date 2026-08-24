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
    /// The tree-walking interpreter, and the only backend that can answer for every program that
    /// evaluates — a program whose value is a function prints as `<non-value>` rather than failing.
    #[default]
    Reference,
    /// Lower to the λ-calculus, reduce, and decode the normal form back to a value. The decode is
    /// directed by the program's type and covers Nat, Bool, Unit and List<T>; a function-typed
    /// result has no encoding at all and exits 2 (the program is fine — use `reference`).
    Lambda,
    /// Lower to a Turing machine, simulate it, and decode the final tapes. Same type-directed limit
    /// as `lambda`: a tape encodes Nat, Bool, Unit and List<T>, and a function-typed result exits 2.
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
    // ASCII-case-insensitive, because `M.TM` is a real artifact and a byte-for-byte `e == "tm"` sent
    // it down the `.rxt` path, where the lexer produced a cascade of errors and exit 1 blamed a
    // perfectly valid file on the program.
    let is_artifact = matches!(input, Input::Path(p) if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("tm")));
    if is_artifact {
        if backend != Backend::Reference {
            writeln!(err, "error: `--backend` does not apply to a `.tm` file, which is already a machine")?;
            return Ok(Outcome::ToolFailed);
        }
        return run_artifact_text(&src, &label, out, err, color);
    }
    match backend {
        Backend::Reference => run_reference(&src, &label, out, err, color),
        Backend::Lambda => run_lambda_backend(&src, &label, out, err, color),
        Backend::Tm => run_tm_backend(&src, &label, out, err, color),
    }
}

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
    let (tapes, status) = redextape_core::tm::simulate(&machine, &init, redextape_core::tm::TM_DEFAULT_CAPS);
    if status == redextape_core::tm::TmStatus::HitCap {
        writeln!(
            err,
            "error: the machine did not halt within {} steps or {} tape cells (`TM_DEFAULT_CAPS`)",
            redextape_core::tm::TM_DEFAULT_CAPS.steps,
            redextape_core::tm::TM_DEFAULT_CAPS.cells
        )?;
        return Ok(Outcome::ProgramFailed);
    }
    if let Some(v) = redextape_core::tm::decode_tape_ty(&tapes, &header.result, &*enc) {
        writeln!(out, "{}", redextape_core::value::format_value(&v))?;
        Ok(Outcome::Ran)
    } else {
        // **EXIT 1 HERE AND EXIT 2 IN `run_tm_backend`, ON THE SAME EXPRESSION, DELIBERATELY.** There
        // the type comes from the PROGRAM's own inference, so a function-typed result is a question
        // this tool cannot answer about a program that is fine — code 2. Here it comes from the
        // FILE's header, and `HeaderParts::directive` (D5) already refuses a `result` that is not a
        // value type, so a function type cannot reach this line: every failure that can means the
        // file's tapes disagree with the type the file itself declares. That is the file's fault.
        writeln!(
            err,
            "error: `{label}`'s tapes do not decode as `{}`\n  \
             the file is inconsistent: its header declares that result type and its tapes do not hold one",
            redextape_core::ty::show(&header.result)
        )?;
        Ok(Outcome::ProgramFailed)
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
            if let Some(v) = redextape_core::lambda::decode_lambda_ty(&nf, &ty) {
                writeln!(out, "{}", format_value(&v))?;
                Ok(Outcome::Ran)
            } else {
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
    let (outcome, _width) = redextape_core::tm::run_tm_fitted(&core, &enc, redextape_core::tm::TM_DEFAULT_CAPS);
    match outcome {
        redextape_core::tm::TmRun::Ran { tapes } => {
            if let Some(v) = redextape_core::tm::decode_tape_ty(&tapes, &ty, &enc) {
                writeln!(out, "{}", format_value(&v))?;
                Ok(Outcome::Ran)
            } else {
                // Code 2, where `run_artifact_text` answers 1 on the same expression — that asymmetry
                // is deliberate and its reasoning is written out at that site.
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

#[cfg(test)]
mod tests {
    use super::*;

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

    /// A hand-written machine whose start state loops forever (self-transition, no accept state ever
    /// reached): `simulate` returns `Status::HitCap` once it exhausts `TM_DEFAULT_CAPS`, and that must
    /// be handled BEFORE decoding — a capped run is the program's fault (Design's own exit-code rule:
    /// exit 1 means the program, exit 2 means the tool), not a "tapes don't decode" tool limitation.
    #[test]
    fn a_capped_tm_artifact_is_the_programs_fault_not_a_decode_failure() {
        let text = "tapes 1\nstart loop\nversion 1\nencoding unary\nwidth 1\nslots 0\nresult Nat\n\n\
                    state loop:\n  \
                    [*] -> write [*], move [S], goto loop\n";
        let (out, err, outcome) = run_case("hitcap", "m.tm", text, Backend::Reference);
        assert_eq!(out, "", "a capped run must print no value");
        assert!(err.contains("did not halt"), "stderr must name the cap, not the result type, got: {err}");
        assert!(!err.contains("decode"), "stderr must not blame decoding, got: {err}");
        assert!(matches!(outcome, Outcome::ProgramFailed), "a capped run is the program's fault");
    }

    /// `M.TM` is as much an artifact as `m.tm`. The dispatch tested `e == "tm"` byte-for-byte, so an
    /// uppercase extension fell through to the `.rxt` lexer: exit 1 and a cascade of parse errors,
    /// which claims a valid file is a broken program.
    #[test]
    fn an_uppercase_tm_extension_is_still_an_artifact() {
        let text = include_str!("../../redextape-core/tests/fixtures/list_1_2.tm");
        let (out, err, outcome) = run_case("uppercase-ext", "M.TM", text, Backend::Reference);
        assert_eq!(out, "[1, 2]\n", "stderr: {err}");
        assert!(matches!(outcome, Outcome::Ran));
    }

    /// **THE FILE'S FAULT, NOT THE TOOL'S.** A header's `result` is a promise about the tapes, and
    /// `HeaderParts::directive` (D5) already refuses a `result` that is not a value type — so the
    /// only decode failure reachable on this path is a file whose tapes disagree with the type it
    /// declares itself. This machine accepts immediately, leaving a blank tape that is no `Nat`.
    #[test]
    fn tapes_that_contradict_the_headers_own_result_type_are_the_files_fault() {
        let text = "tapes 1\nstart s\nversion 1\nencoding unary\nwidth 4\nslots 0\nresult Nat\n\n\
                    state s: accept\n";
        let (out, err, outcome) = run_case("decode-mismatch", "m.tm", text, Backend::Reference);
        assert_eq!(out, "");
        assert!(err.contains("its header declares"), "the message must blame the file, got: {err}");
        assert!(matches!(outcome, Outcome::ProgramFailed), "a self-contradicting file is exit 1, not 2");
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
}
