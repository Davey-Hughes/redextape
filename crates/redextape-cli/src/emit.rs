//! `redextape emit` — compile a program to a backend text form.
//!
//! **ALL THREE TARGETS ROUND-TRIP; TWO OF THE THREE ARE ALSO EXECUTABLE.** `tm` re-parses through
//! `parse_tm_full` and `lambda` through `parse_lambda`, and `asm` through `parse_asm` — all three
//! emitted forms read back. `redextape run` executes an emitted `.tm` or `.asm` file directly; a
//! `.rxlambda` file carries no result type to decode against, so it stays read-only from the command
//! line. The asm target writes a header comment naming the function that reads it back.

use crate::input::{Input, write_atomic};
use crate::report;
use redextape_core::tm::EncodingKind;
use std::path::Path;

/// Which text form to write.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum Lang {
    /// A complete self-describing Turing machine, header included, that `redextape run` executes.
    Tm,
    /// The λ-calculus lowering of the program, which `parse_lambda` and the editor grammar read.
    Lambda,
    /// The register-machine lowering, read back by `parse_asm` and executable by `redextape run`.
    Asm,
}

/// The asm form's emitted header comment. It used to exist to declare that the file could not be
/// read back — `parse_asm` was unclaimed, and ten roadmap entries said so. It now names the function
/// that reads it, because a file that states what opens it is worth more than a bare listing —
/// `redextape run` takes the file it names, the same as it always has for a `.tm`.
const ASM_PREAMBLE: &str = "\
; Register-assembly listing, read back by `parse_asm` and run by `redextape run`.
";

/// Tape encoding for `--lang tm`. `Default` is what an omitted `--encoding` means; the flag itself
/// is an `Option` so that passing `--encoding unary` off the `tm` target is still an error.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum EncodingArg {
    /// One cell per unit. The default, and the narrower of the two: the widest field there is holds
    /// values up to 63 (measured, not supposed).
    #[default]
    Unary,
    /// Packed digits. Holds a far larger value in the same field, so it expresses programs unary
    /// refuses.
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
    encoding: Option<EncodingArg>,
    dest: Option<&Path>,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    // **`Option`, NOT A `default_value_t`, AND THAT IS THE WHOLE POINT.** Once clap fills a default
    // in, an explicitly passed `--encoding unary` and an omitted flag arrive here as the same value,
    // so the guard below used to read `encoding != EncodingArg::default()` and let
    // `--lang lambda --encoding unary` through at exit 0 while the README promised a 2.
    if lang != Lang::Tm && encoding.is_some() {
        writeln!(err, "error: `--encoding` applies to `--lang tm` only")?;
        return Ok(Outcome::ToolFailed);
    }
    let encoding = encoding.unwrap_or_default();
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
        Lang::Lambda => match redextape_core::lambda::lower(&core) {
            Ok(term) => format!("{}\n", redextape_core::lambda::print_lambda(&term)),
            Err(e) => {
                writeln!(err, "error: this program has no lambda lowering: {e:?}")?;
                return Ok(Outcome::ToolFailed);
            }
        },
        Lang::Asm => match redextape_core::tm::lower_asm(&core) {
            // A header only when the result type is one the directive can express. `parse_ty` admits
            // exactly Nat/Bool/Unit/List<T>, and `AsmHeader` must not carry anything it would reject
            // — a file whose own reader refuses its header is worse than one with no header at all.
            Ok(prog) => {
                let header = redextape_core::ty::parse_ty(&redextape_core::ty::show(&ty))
                    .map(|result| redextape_core::tm::AsmHeader { result });
                let listing = match &header {
                    Some(h) => redextape_core::tm::print_asm_with(&prog, h),
                    None => redextape_core::tm::print_asm(&prog),
                };
                format!("{ASM_PREAMBLE}{listing}")
            }
            Err(e) => {
                writeln!(err, "error: this program has no asm lowering: {e:?}")?;
                return Ok(Outcome::ToolFailed);
            }
        },
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
/// `TM_DEFAULT_CAPS`.
///
/// **`Ok` DOES NOT MEAN THE FITTING RUN SUCCEEDED**, and reading it as one wrote files that answered
/// wrongly at exit 0. `run_tm_described` returns `Ok` for every run that STARTED — `HitCap` and
/// `Overflow` included — because a header records the initial tapes and the decoding recipe, never
/// the answer, so it is complete however the run ended. Only `d.run` separates a machine that is
/// faithful from one that is not; `emit_described` is where that decision lives.
fn emit_tm(
    core: &redextape_core::core::Core,
    ty: redextape_core::ty::Ty,
    encoding: EncodingArg,
    err: &mut impl std::io::Write,
) -> std::io::Result<Option<String>> {
    match redextape_core::tm::run_tm_described(core, encoding.into(), ty, redextape_core::tm::TM_DEFAULT_CAPS) {
        Ok(d) => emit_described(&d, encoding, err),
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
        // **THE SAME SENTENCE `run --backend tm`, `--lang lambda` AND `--lang asm` USE FOR THIS EXACT
        // CONDITION.** It read "cannot build a self-describing machine … a header needs the initial
        // tapes" until the whole-branch review — one condition in two voices, and the wrong voice
        // here: nothing was built, so header construction is not what went wrong. That sentence now
        // survives only where the subject genuinely is a header that could not be assembled.
        Err(redextape_core::tm::TmRun::LowerError(e)) => {
            writeln!(err, "error: this program has no TM lowering: {e:?}")?;
            Ok(None)
        }
        // Not reachable as `run_tm_described` is written — an outcome from a run that started comes
        // back as `Ok` — and spelled out rather than caught by a `_`, so a sixth `TmRun` variant
        // fails to compile here instead of silently landing on this message.
        Err(
            other @ (redextape_core::tm::TmRun::Ran { .. }
            | redextape_core::tm::TmRun::HitCap
            | redextape_core::tm::TmRun::Overflow),
        ) => {
            writeln!(
                err,
                "error: cannot build a self-describing machine for this program: {other:?}\n  \
                 a header needs the initial tapes, which come from fitting and running the machine"
            )?;
            Ok(None)
        }
    }
}

/// **THE FITTING RUN'S OUTCOME DECIDES WHETHER THE FILE MAY BE WRITTEN AT ALL**, and the three
/// answers are genuinely different:
///
/// * `Ran` — emit, silently.
/// * `HitCap` — emit, and say so. The file describes exactly the machine that was built at the width
///   that was fitted, so it is faithful; it will simply meet the same cap when `run` simulates it.
/// * `Overflow` — REFUSE. A value did not fit the widest field this encoding has, so the machine
///   halts on truncated fields and `decode_tape_ty` reads them without complaining: the file would
///   report a wrong answer at exit 0. The program is fine and this tool cannot express it at any
///   width this encoding offers, which is exit 2 under the whose-fault-is-it rule.
fn emit_described(
    d: &redextape_core::tm::DescribedRun,
    encoding: EncodingArg,
    err: &mut impl std::io::Write,
) -> std::io::Result<Option<String>> {
    match d.run {
        redextape_core::tm::TmRun::Ran { .. } => Ok(Some(redextape_core::tm::print_tm_with(&d.machine, &d.header))),
        redextape_core::tm::TmRun::HitCap => {
            writeln!(
                err,
                "note: the fitting run did not halt within {} steps or {} tape cells (`TM_DEFAULT_CAPS`)\n  \
                 the file is written and is faithful — a header records the INITIAL tapes and the decoding \
                 recipe, never the answer —\n  \
                 but `redextape run` will meet the same cap on it and exit 1",
                redextape_core::tm::TM_DEFAULT_CAPS.steps,
                redextape_core::tm::TM_DEFAULT_CAPS.cells
            )?;
            Ok(Some(redextape_core::tm::print_tm_with(&d.machine, &d.header)))
        }
        redextape_core::tm::TmRun::Overflow => {
            let alternative = if encoding == EncodingArg::Unary {
                "`--encoding binary` holds a far larger value in the same field and may succeed where unary did not"
            } else {
                "there is no wider field; `redextape run` without `--lang tm` still evaluates the program"
            };
            writeln!(
                err,
                "error: no machine was written: a value does not fit this encoding's widest tape field \
                 ({} cells, `MAX_FIELD_WIDTH`)\n  \
                 the program is fine — but the machine would HALT on truncated fields, and `redextape run` \
                 would decode them and print a wrong answer at exit 0\n  \
                 {alternative}",
                redextape_core::tm::MAX_FIELD_WIDTH
            )?;
            Ok(None)
        }
        // `run_tm_described` answers `Err` for a program that never ran, so neither reaches here.
        // Listed rather than caught, for the reason `emit_tm`'s last arm gives.
        redextape_core::tm::TmRun::TooLarge | redextape_core::tm::TmRun::LowerError(_) => {
            writeln!(
                err,
                "error: cannot build a self-describing machine for this program: {:?}\n  \
                 a header needs the initial tapes, which come from fitting and running the machine",
                d.run
            )?;
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reaches `MAX_FIELD_WIDTH` under unary and still does not fit: `n` counts to 300 and the
    /// widest unary field holds 64 cells. The reference backend answers 300, `--backend tm` refuses
    /// with `Overflow`, and `--encoding binary` emits a machine that answers 300 — so this source
    /// separates "this encoding cannot express it" from "the program is wrong".
    const OVERFLOW_SRC: &str = "let mut i = 0; let mut n = 0; while i < 300 { n = n + 1; i = i + 1; } n";

    /// Own directory per case, for the reason `run.rs`'s `run_case` gives: parallel test threads
    /// share a process id, and a shared path makes one test read another's source.
    fn emit_case(case: &str, src: &str, lang: Lang, encoding: Option<EncodingArg>) -> (String, String, Outcome) {
        let dir = std::env::temp_dir().join(format!("rxt-emit-{}-{case}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("p.rxt");
        std::fs::write(&p, src).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let outcome = run(&Input::from_arg(&p), lang, encoding, None, &mut out, &mut err, false).unwrap();
        (String::from_utf8(out).unwrap(), String::from_utf8(err).unwrap(), outcome)
    }

    /// The emitted file must be a complete, self-describing `.tm` — the property `run` (Task 4)
    /// depends on, since a header-less file records no initial tapes.
    #[test]
    fn emitted_tm_carries_a_header_and_re_parses() {
        let (text, err, outcome) = emit_case("tm", "1 + 2", Lang::Tm, Some(EncodingArg::Unary));
        assert!(matches!(outcome, Outcome::Emitted), "stderr: {err}");
        let (machine, header, ds) = redextape_core::tm::parse_tm_full(&text);
        assert!(ds.is_empty(), "emitted TM must re-parse cleanly, got: {ds:?}");
        assert!(machine.is_some(), "emitted TM must carry a machine");
        assert!(header.is_some(), "emitted TM must carry a header, or `run` cannot use it");
    }

    #[test]
    fn the_binary_encoding_is_selectable_and_differs() {
        let (unary, _, _) = emit_case("enc-u", "1 + 2", Lang::Tm, Some(EncodingArg::Unary));
        let (binary, _, _) = emit_case("enc-b", "1 + 2", Lang::Tm, Some(EncodingArg::Binary));
        assert!(unary.contains("encoding unary"));
        assert!(binary.contains("encoding binary"));
        assert_ne!(unary, binary);
    }

    #[test]
    fn a_type_error_is_the_programs_fault() {
        let (out, err, outcome) = emit_case("type-error", "1 + true", Lang::Tm, None);
        assert_eq!(out, "");
        assert!(!err.is_empty());
        assert!(matches!(outcome, Outcome::ProgramFailed));
    }

    /// λ's first producer. The emitted text must re-parse under `parse_lambda`, which is the same
    /// standard `emit --lang tm` meets through `parse_tm_full`.
    #[test]
    fn emitted_lambda_re_parses() {
        let (text, err, outcome) = emit_case("lambda", "1 + 2", Lang::Lambda, None);
        assert!(matches!(outcome, Outcome::Emitted), "stderr: {err}");
        let (term, ds) = redextape_core::lambda::parse_lambda(&text);
        assert!(ds.is_empty(), "emitted lambda must re-parse cleanly, got: {ds:?}");
        assert!(term.is_some());
    }

    /// The asm target's round trip, which this crate could not test until `parse_asm` landed: what
    /// `emit` writes, `parse_asm` reads — preamble comment and all.
    #[test]
    fn emitted_asm_parses_back() {
        let (text, err, outcome) = emit_case("asm", "1 + 2", Lang::Asm, None);
        assert!(err.is_empty(), "no stderr: {err}");
        assert!(matches!(outcome, Outcome::Emitted), "emit succeeded");
        let (prog, ds) = redextape_core::tm::parse_asm(&text);
        assert!(ds.is_empty(), "the emitted file parses: {ds:?}");
        assert!(!prog.expect("parses").code.is_empty(), "and it is not empty");
    }

    /// **BOTH VALUES, AND `Unary` IS THE ONE THAT USED TO PASS.** The flag carried a
    /// `default_value_t`, so an explicit `--encoding unary` was indistinguishable from an omitted
    /// one and slipped through the guard at exit 0 while the README said it exited 2. A test that
    /// only ever passed `Binary` asserted half of what its name claimed.
    #[test]
    fn encoding_is_rejected_off_the_tm_target() {
        for encoding in [EncodingArg::Binary, EncodingArg::Unary] {
            let (out, err, outcome) =
                emit_case(&format!("enc-off-target-{encoding:?}"), "1 + 2", Lang::Lambda, Some(encoding));
            assert_eq!(out, "", "{encoding:?} must emit nothing");
            assert!(err.contains("--encoding"), "{encoding:?} got: {err}");
            assert!(matches!(outcome, Outcome::ToolFailed), "{encoding:?} must be ToolFailed");
        }
    }

    /// And omitting it is still fine off `tm`, which is the half the `Option` must not break.
    #[test]
    fn an_omitted_encoding_is_fine_off_the_tm_target() {
        let (out, err, outcome) = emit_case("enc-absent", "1 + 2", Lang::Asm, None);
        assert!(matches!(outcome, Outcome::Emitted), "stderr: {err}");
        assert!(!out.is_empty());
    }

    /// A program whose values do not fit the widest tape field unary has. **THE FILE MUST NOT BE
    /// WRITTEN.** `run_tm_described` still returns `Ok` here — it built a valid header for a run
    /// that started — and emitting it produced a machine that HALTS on truncated fields, so `run`
    /// decoded them, printed `0` for a program whose answer is 300, and exited 0.
    #[test]
    fn a_program_that_overflows_the_widest_field_is_refused_not_emitted() {
        let (out, err, outcome) = emit_case("overflow", OVERFLOW_SRC, Lang::Tm, Some(EncodingArg::Unary));
        assert_eq!(out, "", "no machine may be written for an overflowing program");
        assert!(err.contains("MAX_FIELD_WIDTH"), "the message must name the ceiling, got: {err}");
        assert!(err.contains("--encoding binary"), "the message must name the alternative, got: {err}");
        assert!(matches!(outcome, Outcome::ToolFailed), "the program is fine; this tool cannot express it");
    }

    /// The other half of that message, and the proof the refusal is about the ENCODING rather than
    /// the program: the same source emits a complete, re-parsable machine under `binary`.
    #[test]
    fn binary_succeeds_where_unary_overflowed() {
        let (text, err, outcome) = emit_case("overflow-binary", OVERFLOW_SRC, Lang::Tm, Some(EncodingArg::Binary));
        assert!(matches!(outcome, Outcome::Emitted), "stderr: {err}");
        let (machine, header, ds) = redextape_core::tm::parse_tm_full(&text);
        assert!(ds.is_empty(), "got: {ds:?}");
        assert!(machine.is_some() && header.is_some());
    }

    /// A capped fitting run is NOT the overflow case. The header records the initial tapes and the
    /// decoding recipe, never the answer, so the file describes exactly the machine that was built —
    /// it is emitted, exit 0, and stderr says it will meet the same cap when run.
    #[test]
    fn a_capped_fitting_run_still_emits_and_says_so() {
        let src = "let mut i = 0; let mut s = 0; while i < 30 { let mut j = 0; while j < 30 { s = 1; j = j + 1; } i = i + 1; } s";
        let (text, err, outcome) = emit_case("hitcap", src, Lang::Tm, Some(EncodingArg::Unary));
        assert!(matches!(outcome, Outcome::Emitted), "a capped fitting run still emits; stderr: {err}");
        assert!(err.starts_with("note:"), "the note must not read as an error, got: {err}");
        assert!(err.contains("TM_DEFAULT_CAPS"), "the note must name the cap, got: {err}");
        let (machine, header, ds) = redextape_core::tm::parse_tm_full(&text);
        assert!(ds.is_empty(), "the emitted file must still be a valid machine, got: {ds:?}");
        assert!(machine.is_some() && header.is_some());
    }

    /// `emit --lang asm`'s new behavior: the common path's `ty` (already computed before `match lang`)
    /// becomes a header when `parse_ty(show(ty))` round-trips. A distinct case name from
    /// `emitted_asm_parses_back`'s `"asm"` — `emit_case` keys a temp directory by case, and reusing
    /// one is a race two tests should not share even though, here, they would have written identical
    /// bytes.
    #[test]
    fn emitted_asm_carries_a_result_header() {
        let (text, err, outcome) = emit_case("asm-header", "1 + 2", Lang::Asm, None);
        assert!(err.is_empty(), "no stderr: {err}");
        assert!(matches!(outcome, Outcome::Emitted));
        assert!(text.contains("result Nat"), "the header names the result type:\n{text}");
        let (prog, header, ds) = redextape_core::tm::parse_asm_full(&text);
        assert!(ds.is_empty(), "the emitted file parses: {ds:?}");
        assert_eq!(header.map(|h| h.result), Some(redextape_core::ty::Ty::Nat));
        assert!(!prog.expect("parses").code.is_empty());
    }

    /// **NOT a function-typed fixture — `Fun` is unreachable here, and that is a real structural
    /// fact, not a shortcut.** `lower_asm` has no register representation for a function value: a bare
    /// lambda in value position (`Core::Lambda`) errors unconditionally, and a bare function name
    /// (`Core::Var` naming an `fn`) resolves against `ctx.resolve`, which only tracks local variable
    /// registers — function names live in `fn_scopes` instead, so the lookup misses and reports
    /// "unbound". Every fixture tried (`|x| x + 1`, a bare `fn` name, a `let`-bound closure) fails at
    /// `lower_asm` itself with `Unsupported`, so `Outcome::Emitted` is never reached for `Fun`.
    ///
    /// `[]` reaches the SAME outcome through the other type this task's decision names: an unresolved
    /// `Ty::Var`. Never constrained by anything else in the program, its element type stays
    /// `List<t1>` — `parse_ty` rejects `t1` exactly as it would reject a `Fun`'s arrow syntax — while
    /// `lower_asm` accepts `[]` fine (`Instr::Nil` carries no type to check). So it still emits — a
    /// listing is readable regardless — just without a header.
    #[test]
    fn a_program_with_no_expressible_result_type_emits_asm_without_a_header() {
        let (text, err, outcome) = emit_case("asm-var", "[]", Lang::Asm, None);
        assert!(matches!(outcome, Outcome::Emitted), "emitting a listing does not require a result type: {err}");
        let (_, header, ds) = redextape_core::tm::parse_asm_full(&text);
        assert!(ds.is_empty(), "{ds:?}");
        assert_eq!(header, None, "no header, because no value type could be written");
    }
}
