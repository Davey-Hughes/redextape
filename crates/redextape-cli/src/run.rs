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

/// Which already-compiled form a path names. A source file is neither.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Artifact {
    Tm,
    Asm,
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
    let artifact = match input {
        Input::Path(p) => p.extension().and_then(|e| {
            let e = e.to_string_lossy().to_ascii_lowercase();
            match e.as_str() {
                "tm" => Some(Artifact::Tm),
                "asm" => Some(Artifact::Asm),
                _ => None,
            }
        }),
        Input::Stdin => None,
    };
    if let Some(kind) = artifact {
        if backend != Backend::Reference {
            let noun = match kind {
                Artifact::Tm => "a `.tm` file, which is already a machine",
                Artifact::Asm => "a `.asm` file, which is already a program",
            };
            writeln!(err, "error: `--backend` does not apply to {noun}")?;
            return Ok(Outcome::ToolFailed);
        }
        return match kind {
            Artifact::Tm => run_artifact_text(&src, &label, out, err, color),
            Artifact::Asm => run_asm_artifact(&src, &label, out, err, color),
        };
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
    let doc = redextape_core::tm::parse_tm_full(src);
    if !doc.diagnostics.is_empty() {
        report::render(err, label, src, &doc.diagnostics, color)?;
        return Ok(Outcome::ProgramFailed);
    }
    let Some(machine) = doc.machine else {
        writeln!(err, "error: `{label}` carries no machine")?;
        return Ok(Outcome::ProgramFailed);
    };
    let Some(header) = doc.header else {
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
    // **TWO CAUSES REACH THIS DECODE, WITH OPPOSITE FAULT ATTRIBUTIONS — SEE `DecodeFailure`.** An
    // earlier revision of this comment argued every failure here was the file's fault, on the strength
    // of `HeaderParts::directive` (D5) already refusing a `result` that is not a value type — true, but
    // not the whole story: `MAX_DECODE_NODES` bounds how many `Value` nodes a single decode may build
    // (nested list types multiply the count; see that constant's doc), and a completely TRUTHFUL header
    // can still exhaust it. So there are two causes, not one: `DecodeFailure::Mismatch` — the tapes
    // disagree with the type the file itself declares — is the file's fault, exit 1, unchanged from
    // before. `DecodeFailure::BudgetExhausted` is this tool's limit on an otherwise-good file, exit 2 —
    // the SAME distinction `run_asm_artifact` draws for the identical two causes on the `.asm` form; the
    // two runners used to give it opposite, and each individually wrong, treatments (see that function's
    // doc).
    report_tm_decode(
        redextape_core::tm::decode_tape_ty_reason(&tapes, &header.result, &*enc),
        label,
        &header.result,
        out,
        err,
    )
}

/// `run_artifact_text`'s final `match`, on the two `DecodeFailure` causes — extracted so the MAPPING
/// (which message, which `Outcome`) can be pinned directly, without paying for a decode that actually
/// reaches `BudgetExhausted`. See `an_asm_artifact_that_exhausts_the_decode_budget_is_the_tools_limit`'s
/// doc (the `.asm` sibling test) for what that would now cost and why this seam exists instead.
fn report_tm_decode(
    result: Result<redextape_core::value::Value, redextape_core::tm::DecodeFailure>,
    label: &str,
    result_ty: &redextape_core::ty::Ty,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
) -> std::io::Result<Outcome> {
    match result {
        Ok(v) => {
            if let Some(text) = redextape_core::value::format_value_capped(&v, redextape_core::value::MAX_PRINT_NODES) {
                writeln!(out, "{text}")?;
                Ok(Outcome::Ran)
            } else {
                writeln!(
                    err,
                    "error: `{label}`'s tapes decoded to a value, but it is too large to print\n  \
                     `MAX_PRINT_NODES` limits how many nodes a printed value may walk; the decoded \
                     value may be entirely valid — this is the tool's limit, not the file's"
                )?;
                Ok(Outcome::ToolFailed)
            }
        }
        Err(redextape_core::tm::DecodeFailure::Mismatch) => {
            writeln!(
                err,
                "error: `{label}`'s tapes do not decode as `{}`\n  \
                 the file is inconsistent: its header declares that result type and its tapes do not hold one",
                redextape_core::ty::show(result_ty)
            )?;
            Ok(Outcome::ProgramFailed)
        }
        Err(redextape_core::tm::DecodeFailure::BudgetExhausted) => {
            writeln!(
                err,
                "error: `{label}`'s tapes ran out of decode budget before finishing\n  \
                 `MAX_DECODE_NODES` limits how many values a single decode may build; the header's \
                 declared result type may be entirely truthful — this is the tool's limit, not the file's"
            )?;
            Ok(Outcome::ToolFailed)
        }
    }
}

/// Run a `.asm` artifact: parse, validate, require a header, execute, decode.
///
/// **The header check precedes the run, and the ordering is the interesting part.** A header-less
/// `.tm` has nothing to RUN — its header carries the initial tapes — so refusing early is forced
/// there. A header-less `.asm` is fully runnable; what it lacks is a way to NAME its answer. Running
/// first would spend up to `DEFAULT_CAPS.steps` reaching a value this function must then decline to
/// print, so the check moves ahead of the work it would waste.
///
/// **On the parallel with `run_artifact_text`, which is deliberate and not shared.** The two runners
/// have the same shape — parse, reject diagnostics, unwrap, require a header, execute, decode — and
/// about ten lines of that preamble read alike. They are NOT factored together: `parse_tm_full` and
/// `parse_asm_full` return different types, `simulate` and `run_asm` have different outcome shapes,
/// and `TmHeader` carries four fields where `AsmHeader` carries one. A shared helper would have to
/// abstract over two functions agreeing on nothing but their arity, to save ten lines that will
/// diverge further when either form gains a directive.
///
/// **What this cannot get wrong, and does not guard against:** `AsmOutcome` lives *inside*
/// `AsmRun::Ran`, so a capped run has no outcome to decode — unlike the `.tm` path, where `simulate`
/// once returned tapes and status separately and a capped run still had tapes a decoder could read.
/// Here the type itself makes a `HitCap` printing a value unrepresentable, so there is no redundant
/// guard to add before the `match` below.
///
/// **THE FINAL DECODE HAS TWO FAILURE CAUSES WITH OPPOSITE FAULT ATTRIBUTIONS, MIRRORING
/// `run_artifact_text`'s.** A `result` directive that lies about what `rr` (and the heap it may point
/// into) actually hold is `DecodeFailure::Mismatch` — the file's own fault: exit 1, naming the file.
/// `MAX_DECODE_NODES` exhaustion on an otherwise-truthful header is `DecodeFailure::BudgetExhausted` —
/// this tool's limit: exit 2, naming the budget, never the type. `emit`'s own output can reach the
/// second cause on a completely honest header: a program that nests list types over a large,
/// heavily-shared heap (see `MAX_DECODE_NODES`'s doc on the `tails`-shaped sharing that makes this
/// cheap to reach) can exhaust the budget without the type or the file being at fault in any way. An
/// earlier revision of this function gave the whole decode ONE treatment — always `ToolFailed`, always
/// "does not decode as `Ty`" — which was backwards for a lying header and right only by coincidence for
/// a budget exhaustion; `run_artifact_text` had the opposite bug, always blaming the file. Both runners
/// are now driven by the SAME `DecodeFailure` rather than guessing an answer from which artifact form
/// asked.
fn run_asm_artifact(
    src: &str,
    label: &str,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    let doc = redextape_core::tm::parse_asm_full(src);
    let (program, header, ds) = (doc.program, doc.header, doc.diagnostics);
    if !ds.is_empty() {
        report::render(err, label, src, &ds, color)?;
        return Ok(Outcome::ProgramFailed);
    }
    let Some(program) = program else {
        writeln!(err, "error: `{label}` carries no program")?;
        return Ok(Outcome::ProgramFailed);
    };
    let errs = program.validate();
    if !errs.is_empty() {
        for e in &errs {
            writeln!(err, "error: `{label}`: {e}")?;
        }
        return Ok(Outcome::ProgramFailed);
    }
    let Some(header) = header else {
        writeln!(
            err,
            "error: `{label}` has no `result` directive\n  \
             the listing is a valid program and would run, but nothing declares the type of its \
             answer, so there is no way to print one\n  \
             re-emit it with `redextape emit --lang asm`, which writes a header whenever the \
             program's result type can be expressed"
        )?;
        return Ok(Outcome::ToolFailed);
    };
    match redextape_core::tm::run_asm(&program, redextape_core::tm::DEFAULT_CAPS) {
        redextape_core::tm::AsmRun::Ran(outcome) => report_asm_decode(
            redextape_core::tm::decode_asm_ty_reason(&outcome, &header.result),
            label,
            &header.result,
            out,
            err,
        ),
        redextape_core::tm::AsmRun::HitCap => {
            writeln!(err, "error: `{label}` did not halt within the default step, stack or heap budget")?;
            Ok(Outcome::ProgramFailed)
        }
        redextape_core::tm::AsmRun::Fault(m) => {
            writeln!(err, "error: `{label}` faulted: {m}")?;
            Ok(Outcome::ProgramFailed)
        }
    }
}

/// `run_asm_artifact`'s inner `match`, on the two `DecodeFailure` causes — the `.asm` sibling of
/// `report_tm_decode`; see its doc for why this is a separate function instead of a real decode.
fn report_asm_decode(
    result: Result<redextape_core::value::Value, redextape_core::tm::DecodeFailure>,
    label: &str,
    result_ty: &redextape_core::ty::Ty,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
) -> std::io::Result<Outcome> {
    match result {
        Ok(v) => {
            if let Some(text) = redextape_core::value::format_value_capped(&v, redextape_core::value::MAX_PRINT_NODES) {
                writeln!(out, "{text}")?;
                Ok(Outcome::Ran)
            } else {
                writeln!(
                    err,
                    "error: `{label}` ran and decoded to a value, but it is too large to print\n  \
                     `MAX_PRINT_NODES` limits how many nodes a printed value may walk; the decoded \
                     value may be entirely valid — this is the tool's limit, not the file's"
                )?;
                Ok(Outcome::ToolFailed)
            }
        }
        Err(redextape_core::tm::DecodeFailure::Mismatch) => {
            writeln!(
                err,
                "error: `{label}` ran, but its result does not decode as `{}`\n  \
                 the file is inconsistent: its header declares that result type and the value \
                 computed does not hold one",
                redextape_core::ty::show(result_ty)
            )?;
            Ok(Outcome::ProgramFailed)
        }
        Err(redextape_core::tm::DecodeFailure::BudgetExhausted) => {
            writeln!(
                err,
                "error: `{label}` ran, but decoding its result ran out of decode budget before \
                 finishing\n  \
                 `MAX_DECODE_NODES` limits how many values a single decode may build; the \
                 declared result type may be entirely truthful — this is the tool's limit, not \
                 the file's"
            )?;
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
        Ok(v) => print_reference_value(&v, label, out, err),
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

/// `run_reference`'s "value in hand, print or refuse" step — extracted, like `report_tm_decode` and
/// `report_asm_decode` above, so the too-large-to-print branch can be driven directly from a `Value`
/// fixture in a test rather than by running a program that builds one; this task's safety note
/// forbids constructing a `tails`-shaped result via a running program, and this function needs
/// nothing but a `Value` to test.
///
/// **PROVEN reachable, and the most urgent of the three sites this fix pass caps — `Backend::Reference`
/// is `#[default]`, so this is what `redextape run` does with no flags at all.** It runs the
/// tree-walking interpreter under `interp::DEFAULT_BUDGET` = 5,000,000 steps. `interp.rs`'s
/// `Builtin::Tail` is `Ok((**t).clone())` — an `Rc` clone, O(1), no allocation — structurally the SAME
/// sharing mechanism as the asm VM's `Instr::Tail` this branch's decode-side fix was built around.
/// `nil`/`cons`/`tail`/`is_empty` are ordinary prelude builtins, and `while` iterates via a real Rust
/// loop without accumulating against `MAX_EVAL_DEPTH`, so an ordinary non-recursive `tails`-style
/// program builds an `m`-suffix shared value in O(m) interpreter steps. The quadratic breakeven
/// against `MAX_PRINT_NODES` is `m` ~= 4,471 (`m^2 + m + 1` ~= 20,000,000) — three to four orders of
/// magnitude below what 5,000,000 steps reach — so before this fix, `redextape run tails.rxt` with no
/// flags would hang on the uncapped `format_value` walk.
fn print_reference_value(
    v: &redextape_core::value::Value,
    label: &str,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
) -> std::io::Result<Outcome> {
    if let Some(text) = redextape_core::value::format_value_capped(v, redextape_core::value::MAX_PRINT_NODES) {
        writeln!(out, "{text}")?;
        Ok(Outcome::Ran)
    } else {
        writeln!(
            err,
            "error: `{label}` ran and computed a value, but it is too large to print\n  \
             `MAX_PRINT_NODES` limits how many nodes a printed value may walk; the computed \
             value may be entirely valid — this is the tool's limit, not the program's"
        )?;
        Ok(Outcome::ToolFailed)
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
                print_lambda_value(&v, label, out, err)
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

/// `run_lambda_backend`'s "decoded value in hand, print or refuse" step — see
/// `print_reference_value`'s doc for why this is its own function rather than inline code.
///
/// **Mechanism present, unaddressed — capped precautionarily, not because reaching the cap here is
/// proven.** `decode_lambda_ty`'s own doc argues no decode budget is needed because a normal form is
/// "a finite tree already in memory" — true of the walk `decode_lambda_ty` itself performs, but
/// `lambda/term.rs`'s `subst` shares rather than copies (`Node::Var(k) if *k == j => s.clone()`, a
/// refcount bump), and that module's own doc calls `LambdaTerm` "STRUCTURALLY SHARED, AND THAT IS THE
/// POINT" — the same graph-reduction mechanism `Instr::Tail` uses, at the term level rather than the
/// heap level. Whether that mechanism can build a normal form whose decoded `Value` is logically
/// enormous, the way a `.tm`/`.asm` heap can, has never been derived either way; this cap exists
/// because that bound is UNESTABLISHED, not because a program reaching it is known.
fn print_lambda_value(
    v: &redextape_core::value::Value,
    label: &str,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
) -> std::io::Result<Outcome> {
    if let Some(text) = redextape_core::value::format_value_capped(v, redextape_core::value::MAX_PRINT_NODES) {
        writeln!(out, "{text}")?;
        Ok(Outcome::Ran)
    } else {
        writeln!(
            err,
            "error: `--backend lambda` decoded `{label}` to a value, but it is too large to print\n  \
             `MAX_PRINT_NODES` limits how many nodes a printed value may walk; the decoded \
             value may be entirely valid — this is the tool's limit, not the program's"
        )?;
        Ok(Outcome::ToolFailed)
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
                print_tm_value(&v, label, out, err)
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

/// `run_tm_backend`'s "decoded value in hand, print or refuse" step — see `print_reference_value`'s
/// doc for why this is its own function rather than inline code.
///
/// **Unresolved, not shown safe — capped precautionarily.** `decode_tape_ty` calls the identical
/// memoized `decode_word_ty` the two artifact seams (`report_tm_decode`/`report_asm_decode` above)
/// already route through this same cap, and `TM_DEFAULT_CAPS` bounds the TAPE, not the decoded
/// value's LOGICAL size — the same category error `MAX_PRINT_NODES` exists to correct in the first
/// place. This path lowers under `Unary`, where heap addresses are themselves unary-coded, which MAY
/// limit the practically reachable size — but nobody has derived that bound, and "unverified" is not
/// "safe": this is capped on the strength of the shared decode mechanism, not on a proof that this
/// call site cannot reach the cap.
fn print_tm_value(
    v: &redextape_core::value::Value,
    label: &str,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
) -> std::io::Result<Outcome> {
    if let Some(text) = redextape_core::value::format_value_capped(v, redextape_core::value::MAX_PRINT_NODES) {
        writeln!(out, "{text}")?;
        Ok(Outcome::Ran)
    } else {
        writeln!(
            err,
            "error: `--backend tm` decoded `{label}` to a value, but it is too large to print\n  \
             `MAX_PRINT_NODES` limits how many nodes a printed value may walk; the decoded \
             value may be entirely valid — this is the tool's limit, not the program's"
        )?;
        Ok(Outcome::ToolFailed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use redextape_core::value::Value;
    use std::rc::Rc;

    /// The shape Task 11's own `value::tests` fixture uses: 64 levels of self-sharing, 65
    /// allocations, 2^64 logical nodes — small enough to build here, but far too large for
    /// `format_value_capped` to walk within `MAX_PRINT_NODES`. Never fed to the UNCAPPED
    /// `format_value`; all five seam functions below (`report_tm_decode`, `report_asm_decode`,
    /// `print_reference_value`, `print_lambda_value`, `print_tm_value`) route this through the
    /// cap only.
    fn tiny_but_logically_enormous_dag() -> Value {
        let mut v = Value::Cons(Rc::new(Value::Nat(1)), Rc::new(Value::Nil));
        for _ in 0..64 {
            let shared = Rc::new(v);
            v = Value::Cons(Rc::clone(&shared), Rc::new(Value::Cons(shared, Rc::new(Value::Nil))));
        }
        v
    }

    /// **EVERY TEST GETS ITS OWN `redextape_test_support::ScratchDir`, KEYED BY `case`.** `cargo test`
    /// runs the tests in one binary on parallel threads, so they share a process id — a single shared
    /// path would let one test read another's source. That fails intermittently rather than outright,
    /// which is worse than a broken test. `filename` carries the extension, because Task 4 dispatches
    /// on it. The directory is done with (its content already read into `out`/`err`/`outcome`) by the
    /// time this function returns, so it is safe to remove it right here.
    ///
    /// This is the only helper in this module; Tasks 2 and 4 parameterise it rather than adding
    /// near-identical copies.
    fn run_case(case: &str, filename: &str, src: &str, backend: Backend) -> (String, String, Outcome) {
        let dir = redextape_test_support::ScratchDir::new(&format!("cli-{case}")).unwrap();
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

    #[test]
    fn an_asm_artifact_runs_and_prints_its_value() {
        let (out, err, outcome) =
            run_case("asm-ok", "p.asm", "result Nat\n\n    li\trr, #7\n    halt\n", Backend::Reference);
        assert!(err.is_empty(), "no stderr: {err}");
        assert!(matches!(outcome, Outcome::Ran));
        assert_eq!(out.trim(), "7");
    }

    #[test]
    fn a_header_less_asm_artifact_is_refused_before_it_runs() {
        let (out, err, outcome) = run_case("asm-nohdr", "p.asm", "    li\trr, #7\n    halt\n", Backend::Reference);
        assert!(out.is_empty(), "nothing is printed: {out}");
        assert!(matches!(outcome, Outcome::ToolFailed), "exit 2 — the tool cannot answer");
        assert!(err.contains("result"), "the message names what is missing: {err}");
        assert!(err.contains("emit --lang asm"), "and how to get one: {err}");
    }

    #[test]
    fn backend_does_not_apply_to_an_asm_artifact() {
        let (_, err, outcome) = run_case("asm-backend", "p.asm", "result Nat\n\n    halt\n", Backend::Lambda);
        assert!(matches!(outcome, Outcome::ToolFailed));
        assert!(err.contains("--backend"), "{err}");
    }

    #[test]
    fn an_invalid_asm_artifact_reports_validation_rather_than_running() {
        let (_, err, outcome) = run_case("asm-bad", "p.asm", "result Nat\n\n    jmp\tnowhere\n", Backend::Reference);
        assert!(matches!(outcome, Outcome::ProgramFailed), "the FILE is at fault: exit 1");
        assert!(err.contains("nowhere"), "the message names the undefined label: {err}");
    }

    // ---- `DecodeFailure`'s two causes, on both artifact forms (four cases) ----
    //
    // `Mismatch` (the file's fault, exit 1) and `BudgetExhausted` (the tool's limit, exit 2) used to be
    // conflated on the `.asm` path (always `ToolFailed`) and on the `.tm` path (always `ProgramFailed`
    // — the pre-existing bug `decode_tape_ty_reason` also fixes). These four tests pin the corrected,
    // SYMMETRIC behaviour: both runners now give the same cause the same exit code and an honest
    // message.

    /// MISMATCH, `.asm` form. `result Bool` over a machine that leaves `rr = 7` (not `0`/`1`) is a
    /// header that lies about its own program: the FILE's fault, exit 1.
    #[test]
    fn an_asm_artifact_with_a_lying_header_is_the_files_fault() {
        let (out, err, outcome) =
            run_case("asm-lying-header", "p.asm", "result Bool\n\n    li\trr, #7\n    halt\n", Backend::Reference);
        assert!(out.is_empty(), "a mismatched decode must print no value: {out}");
        assert!(matches!(outcome, Outcome::ProgramFailed), "the file's fault: exit 1");
        assert!(err.contains("does not decode"), "{err}");
        assert!(err.contains("file is inconsistent"), "the message must blame the file, got: {err}");
        assert!(
            err.contains("as `Bool`"),
            "the interpolated result_ty parameter must actually reach the message, got: {err}"
        );
    }

    /// BUDGET, `.asm` form — calls `report_asm_decode` directly rather than driving a real decode to
    /// `BudgetExhausted`. **What that would cost now, and why this test does not pay it:** before the
    /// `(pointer, depth)` memo, a heap of `n` cells sharing one spine across two nesting levels reached
    /// `MAX_DECODE_NODES` at `n = 6000` (`n² + n + 1` nodes from `n` cells). The memo collapses that
    /// case to linear regardless of the order the outer spine's heads arrive in — both PASS 1 and PASS 2
    /// stop at a memo hit mid-spine, not only at nil (see `decode_word_ty`'s doc on `budget`), so
    /// neither the favorable (longest-suffix-first, `tails`-shaped) order nor the adversarial
    /// (increasing) order Task 3's review once used as a counterexample reaches the budget cheaply — see
    /// `a_nested_type_over_a_shared_spine_decodes_instead_of_refusing`'s own doc, which now pins both.
    /// Reaching `MAX_DECODE_NODES` this way instead needs sharing spread ACROSS all `MAX_TY_DEPTH`
    /// nesting depths, which takes roughly 312,000 heap cells. Measured directly on commit `a148c6c`,
    /// where the fixture this test used before the extraction to `report_asm_decode` still exists
    /// (320,000 cells, sharing spread across all 64 `MAX_TY_DEPTH` levels): decoding it aborts with
    /// `memory allocation ... failed` under both a 2 GiB and a 4 GiB `ulimit -v`, and only completes at
    /// 8 GiB, in ~15s per test. That is unaffordable for the fast tier and marginal even for the slow
    /// one run at default (concurrent) thread count. Reaching `BudgetExhausted` at all means `spend` ran
    /// `MAX_DECODE_NODES` = 20,000,000 times, so ~20,000,000 live `Value` nodes (roughly 1 GB) exist at
    /// the moment of refusal regardless of how few heap cells built them — that memory cost is inherent
    /// to reaching the budget at all, not a property of this particular fixture's cell count. So the
    /// fixture is gone rather than shrunk: shrinking the CELL COUNT would not have shrunk that memory
    /// cost.
    ///
    /// **What this costs:** the end-to-end path — a real file whose decode actually exhausts
    /// `MAX_DECODE_NODES` — is no longer exercised anywhere in CI. This test now pins only the mapping
    /// from `DecodeFailure::BudgetExhausted` to this message and to `Outcome::ToolFailed`; it says
    /// nothing about whether the decoder can still be driven to return that error at all.
    #[test]
    fn an_asm_artifact_that_exhausts_the_decode_budget_is_the_tools_limit() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let outcome = report_asm_decode(
            Err(redextape_core::tm::DecodeFailure::BudgetExhausted),
            "p.asm",
            &redextape_core::ty::Ty::List(Box::new(redextape_core::ty::Ty::Nat)),
            &mut out,
            &mut err,
        )
        .unwrap();
        let err = String::from_utf8(err).unwrap();
        assert!(out.is_empty(), "a budget-exhausted decode must print no value");
        assert!(matches!(outcome, Outcome::ToolFailed), "the tool's limit, not the program's: exit 2");
        assert!(
            err.contains("ran, but decoding its result ran out of decode budget"),
            "the message must be this SITE's own wording, not merged with the `.tm` site's, got: {err}"
        );
        assert!(!err.contains("List<Nat>"), "the message must not blame the type, got: {err}");
    }

    /// Task 11: a value can be SMALL in memory (65 allocations) and logically enormous (2^64 nodes)
    /// once the decoder memoizes, and `format_value`'s tree walk would not return on it — see
    /// `MAX_PRINT_NODES`'s doc. `report_asm_decode` must refuse via the capped printer rather than
    /// calling the uncapped one, so this passes the fixture straight to `Ok(v)` and asserts the
    /// tool's-limit exit path, exactly as the `BudgetExhausted` sibling test above does for the
    /// decode side of the same guard.
    #[test]
    fn an_asm_artifact_whose_value_is_too_large_to_print_is_the_tools_limit() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let outcome = report_asm_decode(
            Ok(tiny_but_logically_enormous_dag()),
            "p.asm",
            &redextape_core::ty::Ty::List(Box::new(redextape_core::ty::Ty::Nat)),
            &mut out,
            &mut err,
        )
        .unwrap();
        let err = String::from_utf8(err).unwrap();
        assert!(out.is_empty(), "a too-large-to-print value must print no output");
        assert!(matches!(outcome, Outcome::ToolFailed), "the tool's limit, not the program's: exit 2");
        assert!(
            err.contains("too large to print"),
            "the message must say the value decoded but is too large to print, got: {err}"
        );
        assert!(err.contains("MAX_PRINT_NODES"), "the message must name the tool's own limit, got: {err}");
        assert!(!err.contains("List<Nat>"), "the message must not blame the type, got: {err}");
    }

    /// MISMATCH, `.tm` form. Exercises the `Ty::Bool` mismatch arm specifically (word `7` is not
    /// `0`/`1`) with a full `tapes 5` layout — unlike
    /// `tapes_that_contradict_the_headers_own_result_type_are_the_files_fault` above, whose `slots 0`
    /// makes `read_result` itself fail (a missing REG field) rather than reaching `Ty::Bool`'s own
    /// mismatch check.
    #[test]
    fn a_tm_artifact_with_a_lying_bool_header_is_the_files_fault() {
        let text = "tapes 5\nstart s\nversion 1\nencoding unary\nwidth 4\nslots 1\nresult Bool\n\
                     tape 0 #1111111#\n\nstate s: accept\n";
        let (out, err, outcome) = run_case("tm-lying-bool", "m.tm", text, Backend::Reference);
        assert!(out.is_empty(), "a mismatched decode must print no value: {out}");
        assert!(matches!(outcome, Outcome::ProgramFailed), "the file's fault: exit 1");
        assert!(err.contains("its header declares"), "the message must blame the file, got: {err}");
        assert!(
            err.contains("as `Bool`"),
            "the interpolated result_ty parameter must actually reach the message, got: {err}"
        );
    }

    /// BUDGET, `.tm` form — the `.tm` sibling of the `.asm` case above: calls `report_tm_decode`
    /// directly with `Err(DecodeFailure::BudgetExhausted)` rather than driving a real decode there. See
    /// that test's doc for why: the memo now collapses a spine reached from any suffix, regardless of
    /// order, so reaching `MAX_DECODE_NODES` needs sharing spread across all `MAX_TY_DEPTH` depths
    /// instead — roughly 312,000 heap cells, measured directly on commit `a148c6c`, which aborts under a
    /// 2 GiB or 4 GiB `ulimit -v`, completing only at 8 GiB — because reaching the budget at all means
    /// ~20,000,000 live `Value` nodes exist at that moment, not because of the fixture's own cell count.
    ///
    /// **What this costs:** as with the `.asm` case, the end-to-end path — a real `.tm` file whose
    /// decode actually exhausts `MAX_DECODE_NODES` — is no longer exercised anywhere in CI. This test
    /// pins only the mapping from `DecodeFailure::BudgetExhausted` to this message and to
    /// `Outcome::ToolFailed`, not the threshold itself.
    #[test]
    fn a_tm_artifact_that_exhausts_the_decode_budget_is_the_tools_limit() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let outcome = report_tm_decode(
            Err(redextape_core::tm::DecodeFailure::BudgetExhausted),
            "m.tm",
            &redextape_core::ty::Ty::List(Box::new(redextape_core::ty::Ty::Nat)),
            &mut out,
            &mut err,
        )
        .unwrap();
        let err = String::from_utf8(err).unwrap();
        assert!(out.is_empty(), "a budget-exhausted decode must print no value");
        assert!(matches!(outcome, Outcome::ToolFailed), "the tool's limit, not the program's: exit 2");
        assert!(
            err.contains("tapes ran out of decode budget"),
            "the message must be this SITE's own wording, not merged with the `.asm` site's, got: {err}"
        );
        assert!(!err.contains("List<Nat>"), "the message must not blame the type, got: {err}");
    }

    /// Task 11, `.tm` sibling of `an_asm_artifact_whose_value_is_too_large_to_print_is_the_tools_limit`
    /// above — see that test's doc.
    #[test]
    fn a_tm_artifact_whose_value_is_too_large_to_print_is_the_tools_limit() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let outcome = report_tm_decode(
            Ok(tiny_but_logically_enormous_dag()),
            "m.tm",
            &redextape_core::ty::Ty::List(Box::new(redextape_core::ty::Ty::Nat)),
            &mut out,
            &mut err,
        )
        .unwrap();
        let err = String::from_utf8(err).unwrap();
        assert!(out.is_empty(), "a too-large-to-print value must print no output");
        assert!(matches!(outcome, Outcome::ToolFailed), "the tool's limit, not the program's: exit 2");
        assert!(
            err.contains("too large to print"),
            "the message must say the value decoded but is too large to print, got: {err}"
        );
        assert!(err.contains("MAX_PRINT_NODES"), "the message must name the tool's own limit, got: {err}");
        assert!(!err.contains("List<Nat>"), "the message must not blame the type, got: {err}");
    }

    // ---- Fix pass: the three sites Task 11 left uncapped (`run_reference`, `run_lambda_backend`,
    // `run_tm_backend`) — see `print_reference_value`, `print_lambda_value` and `print_tm_value`'s own
    // docs for the evidence behind capping each. Each test below drives the seam function directly
    // with the same 65-allocation/2^64-logical-node fixture the two artifact-seam tests above use,
    // for the same reason those do: this task's safety note forbids running a program that BUILDS a
    // `tails`-shaped result, so the fixture is handed straight to `Ok`/`Some` rather than produced by
    // evaluating source.

    /// `run_reference` sibling of `an_asm_artifact_whose_value_is_too_large_to_print_is_the_tools_limit`
    /// above. Of the three sites this fix pass caps, this is the one PROVEN reachable — see
    /// `print_reference_value`'s doc: `Backend::Reference` is `#[default]`, so a program building this
    /// shape needs no flag at all, and hits this exact refusal today rather than hanging.
    #[test]
    fn a_reference_run_whose_value_is_too_large_to_print_is_the_tools_limit() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let outcome = print_reference_value(&tiny_but_logically_enormous_dag(), "p.rxt", &mut out, &mut err).unwrap();
        let err = String::from_utf8(err).unwrap();
        assert!(out.is_empty(), "a too-large-to-print value must print no output");
        assert!(matches!(outcome, Outcome::ToolFailed), "the tool's limit, not the program's: exit 2");
        assert!(
            err.contains("too large to print"),
            "the message must say the value was computed but is too large to print, got: {err}"
        );
        assert!(err.contains("MAX_PRINT_NODES"), "the message must name the tool's own limit, got: {err}");
    }

    /// `run_lambda_backend` sibling of the test above. See `print_lambda_value`'s doc: this site is
    /// capped precautionarily, because no bound on a lambda normal form's decoded logical size has
    /// been established — not because a program reaching this refusal via `--backend lambda` is known.
    #[test]
    fn a_lambda_run_whose_value_is_too_large_to_print_is_the_tools_limit() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let outcome = print_lambda_value(&tiny_but_logically_enormous_dag(), "p.rxt", &mut out, &mut err).unwrap();
        let err = String::from_utf8(err).unwrap();
        assert!(out.is_empty(), "a too-large-to-print value must print no output");
        assert!(matches!(outcome, Outcome::ToolFailed), "the tool's limit, not the program's: exit 2");
        assert!(
            err.contains("too large to print"),
            "the message must say the value was decoded but is too large to print, got: {err}"
        );
        assert!(err.contains("MAX_PRINT_NODES"), "the message must name the tool's own limit, got: {err}");
    }

    /// `run_tm_backend` sibling of the test above. See `print_tm_value`'s doc: `decode_tape_ty` calls
    /// the same memoized `decode_word_ty` the `.tm` artifact seam above already caps, so this site is
    /// capped on that shared mechanism rather than on a derivation that this call site itself reaches
    /// the cap.
    #[test]
    fn a_tm_run_whose_value_is_too_large_to_print_is_the_tools_limit() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let outcome = print_tm_value(&tiny_but_logically_enormous_dag(), "p.rxt", &mut out, &mut err).unwrap();
        let err = String::from_utf8(err).unwrap();
        assert!(out.is_empty(), "a too-large-to-print value must print no output");
        assert!(matches!(outcome, Outcome::ToolFailed), "the tool's limit, not the program's: exit 2");
        assert!(
            err.contains("too large to print"),
            "the message must say the value was decoded but is too large to print, got: {err}"
        );
        assert!(err.contains("MAX_PRINT_NODES"), "the message must name the tool's own limit, got: {err}");
    }
}
