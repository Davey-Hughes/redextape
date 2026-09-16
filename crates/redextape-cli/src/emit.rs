//! `redextape emit` — compile a program to a backend text form.
//!
//! **ALL THREE TARGETS ROUND-TRIP; TWO OF THE THREE ARE ALSO EXECUTABLE.** `tm` re-parses through
//! `parse_tm_full` and `lambda` through `parse_lambda`, and `asm` through `parse_asm` — all three
//! emitted forms read back. `redextape run` executes an emitted `.tm` or `.asm` file directly; a
//! `.rxlambda` file carries no result type to decode against, so it stays read-only from the command
//! line. The asm target writes a header comment naming the function that reads it back.

use crate::input::{Input, write_atomic};
use crate::report;
use redextape_core::tm::{EncodingKind, ReduceError, StageKind};
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
///
/// `Deserialize` is what lets `redextape.toml`'s `emit.encoding` name the same two values the flag
/// does. `rename_all` makes the TOML spellings `"unary"` and `"binary"`, matching what `clap` prints
/// in `--help`: one set of names for a user to learn, not two.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum, serde::Deserialize)]
#[serde(rename_all = "lowercase", deny_unknown_fields)]
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

/// The `[emit]` defaults a flag may override. Two values rather than a `&Config` so this module
/// still knows nothing about the config file's shape or how it was discovered.
#[derive(Clone, Copy, Debug, Default)]
pub struct Defaults {
    pub encoding: EncodingArg,
    pub field_width: usize,
}

/// The TM field width in effect, and — when it was pinned — WHICH setting pinned it.
///
/// **THE NUMBER ALONE IS NOT ENOUGH, WHICH IS THE WHOLE REASON THIS IS NOT A `usize`.** `4` reaches
/// `emit_tm` identically whether it was typed as `--field-width 4` or read from a config file's
/// `emit.field-width`, and the two users need different sentences: one can drop a flag they just
/// typed, the other has to be told a file they may not have written is in effect at all. A refusal
/// that names neither — which is what shipped — sends both of them looking at `--encoding` instead.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Width {
    /// No pin. The fitting search runs: `MIN_FIELD_WIDTH`, doubling, to at most `MAX_FIELD_WIDTH`.
    AutoFit,
    /// `--field-width N` was typed, with `N` not the auto-fit sentinel.
    Flag(usize),
    /// No flag, and the config file's `emit.field-width` is not the auto-fit sentinel.
    Config(usize),
}

impl Width {
    /// Flag > config > default, with `0` from EITHER side meaning auto-fit — the sentinel is a
    /// value of the setting, not an absence of it, so `--field-width 0` is a request for the search
    /// and not a pin at zero.
    fn resolve(flag: Option<usize>, configured: usize) -> Self {
        match (flag, configured) {
            (Some(0), _) | (None, 0) => Width::AutoFit,
            (Some(n), _) => Width::Flag(n),
            (None, n) => Width::Config(n),
        }
    }
}

/// What `emit` was asked for: the flags as the user typed them, and the defaults to fall back on.
///
/// **THE FLAGS STAY `Option` AND THE DEFAULTS ARE PLAIN VALUES, AND THAT SEPARATION IS THE WHOLE
/// POINT OF THIS STRUCT.** `run`'s guard has to distinguish "the user typed `--encoding`" from "a
/// value is in effect", and merging the two before the guard is the bug design §7 is about. Keeping
/// them in different fields makes the wrong version hard to write by accident.
#[derive(Clone, Copy, Debug, Default)]
pub struct Options<'a> {
    /// `--encoding`, or `None` when it was not passed.
    pub encoding: Option<EncodingArg>,
    /// `--field-width`, or `None` when it was not passed.
    pub field_width: Option<usize>,
    /// `--reduce`'s list as typed, or `None` when it was not passed. It has no config key.
    pub reduce: Option<&'a str>,
    /// `[emit]` from `redextape.toml`, or `Defaults::default()` under `--no-config`.
    pub defaults: Defaults,
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
    opts: Options<'_>,
    dest: Option<&Path>,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    // **`Option`, NOT A `default_value_t`, AND THAT IS THE WHOLE POINT.** Once clap fills a default
    // in, an explicitly passed `--encoding unary` and an omitted flag arrive here as the same value,
    // so the guard below used to read `encoding != EncodingArg::default()` and let
    // `--lang lambda --encoding unary` through at exit 0 while the README promised a 2.
    //
    // **THE CONFIG LAYER CAN RE-ENTER THAT SAME BUG ONE LEVEL UP, AND THIS IS WHERE IT DOES NOT.**
    // Both guards test whether the FLAG was typed. A config-set value merged in before them would
    // make `emit --lang lambda` exit 2 for every user whose repository configures an encoding — a
    // config file must never trip THIS GUARD on a command line that used to work. Design §7.
    //
    // Scoped to the guard, and deliberately not the absolute it used to be stated as: a config file
    // CAN make a previously-working command line fail, and `emit.field-width` is how. Pinning a
    // width refuses programs auto-fit accepts — that is the point of the key — so `field-width = 4`
    // turns a working `emit --lang tm` into an exit 2, and the refusal names the key so the cause is
    // visible. What must never happen is a refusal about a flag nobody typed, which is this branch.
    if lang != Lang::Tm {
        if opts.encoding.is_some() {
            writeln!(err, "error: `--encoding` applies to `--lang tm` only")?;
            return Ok(Outcome::ToolFailed);
        }
        if opts.field_width.is_some() {
            writeln!(err, "error: `--field-width` applies to `--lang tm` only")?;
            return Ok(Outcome::ToolFailed);
        }
        if opts.reduce.is_some() {
            writeln!(err, "error: `--reduce` applies to `--lang tm` only")?;
            return Ok(Outcome::ToolFailed);
        }
    }
    // AFTER the guard, never before. See the comment above and design §7.
    let encoding = opts.encoding.unwrap_or(opts.defaults.encoding);
    let width = Width::resolve(opts.field_width, opts.defaults.field_width);
    // Before the input is read, so a list that can never be valid costs nothing: the same reason `main`
    // range-checks `--field-width` before any work.
    let stages = match opts.reduce {
        None => None,
        Some(list) => {
            let Some(stages) = stage_list(list) else {
                writeln!(
                    err,
                    "error: `--reduce` takes stages from `fold, single-tape, two-symbol`, comma-separated, in \
                     that order and each at most once; got `{list}`"
                )?;
                return Ok(Outcome::ToolFailed);
            };
            Some(stages)
        }
    };
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
        Lang::Tm => match emit_tm(&core, ty, encoding, width, stages.as_deref(), err)? {
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
///
/// `stages` is `--reduce`'s parsed list. The machine is still fitted and run first, since a reduction
/// starts from that run and is checked against its value; `emit_reduced` decides what is written.
fn emit_tm(
    core: &redextape_core::core::Core,
    ty: redextape_core::ty::Ty,
    encoding: EncodingArg,
    width: Width,
    stages: Option<&[StageKind]>,
    err: &mut impl std::io::Write,
) -> std::io::Result<Option<String>> {
    // `AutoFit` is the fitting search, which is what this command has always done. A pin skips the
    // search, which can refuse a program the search would have accepted — the whole reason to ask
    // for it, and the reason `Width` carries where the pin came from rather than just its value.
    let described = match width {
        Width::AutoFit => {
            redextape_core::tm::run_tm_described(core, encoding.into(), ty, redextape_core::tm::TM_DEFAULT_CAPS)
        }
        Width::Flag(n) | Width::Config(n) => {
            redextape_core::tm::run_tm_described_at(core, encoding.into(), ty, redextape_core::tm::TM_DEFAULT_CAPS, n)
        }
    };
    match described {
        Ok(d) => match stages {
            Some(stages) => emit_reduced(&d, stages, encoding, width, err),
            None => emit_described(&d, encoding, width, err),
        },
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
/// * `Overflow` — REFUSE. A value did not fit the field the machine was actually built with, so the
///   machine halts on truncated fields and `decode_tape_ty` reads them without complaining: the file
///   would report a wrong answer at exit 0. Exit 2 under the whose-fault-is-it rule either way — the
///   program is fine — but the two width paths overflow for DIFFERENT reasons and must say so.
///
/// **THE PINNED PATH USED TO SPEAK THE AUTO-FIT PATH'S SENTENCE, AND EVERY CLAUSE OF IT WAS FALSE
/// THERE.** Under auto-fit the search really did reach `MAX_FIELD_WIDTH`, so "this encoding's widest
/// tape field (64 cells)" is what was tried and `--encoding binary` is the remedy worth naming.
/// Under a pin, 64 was never attempted; the width tried is the one that was pinned, and the setting
/// that pinned it is what the message has to name — `--field-width` when it was typed,
/// `emit.field-width` when a config file supplied it and the user typed nothing at all. Measured on
/// `40 + 2`: `--field-width 4` refuses under BOTH encodings, and `--encoding binary --field-width 8`
/// emits at exit 0 — so on the pinned path the encoding suggestion was not merely unhelpful, it
/// pointed away from the one setting that actually caused the refusal.
fn emit_described(
    d: &redextape_core::tm::DescribedRun,
    encoding: EncodingArg,
    width: Width,
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
            let (lo, hi) = (redextape_core::tm::MIN_FIELD_WIDTH, redextape_core::tm::MAX_FIELD_WIDTH);
            // The auto-fit clause is unchanged, byte for byte: there the search DID reach the
            // ceiling, so naming it is true and naming the encoding is the useful remedy. See this
            // function's doc for why the pinned arms say something else entirely.
            let (what, remedy) = match width {
                Width::AutoFit => (
                    format!("this encoding's widest tape field ({hi} cells, `MAX_FIELD_WIDTH`)"),
                    if encoding == EncodingArg::Unary {
                        "`--encoding binary` holds a far larger value in the same field and may succeed where unary did not".to_owned()
                    } else {
                        "there is no wider field; `redextape run` without `--lang tm` still evaluates the program"
                            .to_owned()
                    },
                ),
                Width::Flag(n) => (
                    format!("a {n}-cell tape field, which is where `--field-width {n}` pinned it"),
                    format!(
                        "raise `--field-width`, or drop it and let the search fit one: auto-fit starts at {lo} cells and doubles to at most {hi} (`MAX_FIELD_WIDTH`)"
                    ),
                ),
                Width::Config(n) => (
                    format!(
                        "a {n}-cell tape field, which is where the config file's `emit.field-width = {n}` pinned it"
                    ),
                    format!(
                        "raise `emit.field-width`, set it to 0 to auto-fit, or override it for this run with `--field-width`: auto-fit starts at {lo} cells and doubles to at most {hi} (`MAX_FIELD_WIDTH`)"
                    ),
                ),
            };
            writeln!(
                err,
                "error: no machine was written: a value does not fit {what}\n  \
                 the program is fine — but the machine would HALT on truncated fields, and `redextape run` \
                 would decode them and print a wrong answer at exit 0\n  \
                 {remedy}"
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

/// `emit_described` under `--reduce`. **ONLY A FITTING RUN THAT FINISHED IS REDUCED**, because a reduction
/// is checked against the value the lowered machine computes: an overflow is refused exactly as it is
/// without `--reduce`, and a capped run, which `emit_described` would write, writes nothing here.
fn emit_reduced(
    d: &redextape_core::tm::DescribedRun,
    stages: &[StageKind],
    encoding: EncodingArg,
    width: Width,
    err: &mut impl std::io::Write,
) -> std::io::Result<Option<String>> {
    match d.run {
        redextape_core::tm::TmRun::Ran { .. } => {}
        redextape_core::tm::TmRun::HitCap => {
            writeln!(
                err,
                "error: no reduced machine was written: the fitting run did not halt within {} steps or {} tape \
                 cells (`TM_DEFAULT_CAPS`)\n  a reduction is checked against the value the machine computes, and \
                 this run computed none",
                redextape_core::tm::TM_DEFAULT_CAPS.steps,
                redextape_core::tm::TM_DEFAULT_CAPS.cells
            )?;
            return Ok(None);
        }
        redextape_core::tm::TmRun::Overflow
        | redextape_core::tm::TmRun::TooLarge
        | redextape_core::tm::TmRun::LowerError(_) => return emit_described(d, encoding, width, err),
    }
    match redextape_core::tm::reduce(d, stages) {
        Ok((machine, header)) => Ok(Some(redextape_core::tm::print_tm_with(&machine, &header))),
        Err(e) => {
            writeln!(err, "error: no reduced machine was written: {}", reduce_refusal(&e))?;
            Ok(None)
        }
    }
}

/// `--reduce`'s list: stage names separated by commas, with spaces around a comma allowed, or `None` unless
/// every name is a stage and the list is one `is_stage_list` admits.
fn stage_list(list: &str) -> Option<Vec<StageKind>> {
    let stages = list.split(',').map(|s| StageKind::parse(s.trim())).collect::<Option<Vec<_>>>()?;
    redextape_core::tm::is_stage_list(&stages).then_some(stages)
}

/// Why `reduce` wrote nothing, as `emit` says it. Every variant is spelled out, so a new one fails to compile
/// here rather than arriving as a `Debug` dump.
fn reduce_refusal(e: &ReduceError) -> String {
    match e {
        // **EACH REFUSAL NAME GETS ITS OWN EXPLANATION, NOT THE STATE CEILING'S.** `name` is one of
        // `reduction.rs`'s five `pub const` refusals, and only `TOO_MANY_STATES` is ever about that
        // ceiling — a left-end collision, an uncovered alphabet or a tape count told to look at a
        // state count is a cause pointing at the wrong mechanism. Matched on the `&str` value rather
        // than the stage that raises it, since `ReduceError::Refused` carries only the name by the
        // time it reaches here. The wildcard keeps the match total: an unrecognized name still gets a
        // sentence, not a panic, if `reduction.rs` ever grows a sixth refusal this arm has not learned.
        ReduceError::Refused(name) => {
            use redextape_core::tm::reduction::{
                ALPHABET_COLLISION, CODE_DOES_NOT_COVER_ALPHABET, LEFT_END_COLLISION, TOO_MANY_STATES, TOO_MANY_TAPES,
            };
            let cause = match *name {
                // `single_tape.rs`'s `to_single_tape_within`, `two_symbol.rs`'s `to_two_symbol_within`
                // and `one_way.rs`'s `to_one_way_within` all refuse under this name, at their own
                // `StateTable`'s ceiling — the one mechanism this explanation was written for.
                TOO_MANY_STATES => format!(
                    "each stage builds at most `MAX_MACHINE_STATES` ({}) states, and refuses a machine it cannot \
                     represent",
                    redextape_core::tm::MAX_MACHINE_STATES
                ),
                // `single_tape.rs`'s `to_single_tape_within`: past `MAX_ENCODABLE_TAPES`, the layout's
                // per-tape head markers would wrap into each other and into its own reserved symbols.
                TOO_MANY_TAPES => format!(
                    "the single-tape layout names each tape with its own marker, and covers at most \
                     `MAX_ENCODABLE_TAPES` ({}) tapes",
                    redextape_core::tm::single_tape::MAX_ENCODABLE_TAPES
                ),
                // `single_tape.rs`'s `layout_collision`: the machine's alphabet, or an initial tape, uses
                // a symbol (a head marker, or `BLANK`/`LEFT`/`RIGHT`) the single-tape layout reserves for
                // itself.
                ALPHABET_COLLISION => "the machine's alphabet, or an initial tape, uses a symbol the single-tape \
                                        layout reserves for its own markers"
                    .to_owned(),
                // `two_symbol.rs`'s `uncovered_symbol`: the `Code` built for this machine has no pattern
                // for one of the symbols in its alphabet, so that symbol has no two-symbol encoding.
                CODE_DOES_NOT_COVER_ALPHABET => {
                    "the code built for this machine has no pattern for one of the symbols in its alphabet".to_owned()
                }
                // `one_way.rs`'s `left_end_collision`: the machine's alphabet already uses `LEFT_END`, the
                // marker the fold plants at the tape's left end, so the fold cannot tell its own marker
                // from the machine's.
                LEFT_END_COLLISION => "the machine's alphabet already uses the marker the fold plants at the \
                                        tape's left end"
                    .to_owned(),
                _ => "this name is not one of core's five documented refusals".to_owned(),
            };
            format!("a stage refused this machine, with `{name}`\n  {cause}")
        }
        ReduceError::LayoutCollision(s) => {
            format!("the symbol `{s}` on this machine or its tapes is one the single-tape layout reserves")
        }
        ReduceError::Layout => "an initial tape cannot be laid out for the reduction".to_owned(),
        // `reduced_file.rs`'s `reduce_within` raises this from four places, and the variant carries no
        // way to tell them apart, so the message names all four rather than blame the step ceiling for
        // a run that never reached it: `pads` (the measuring run), then the step count, the accept
        // check and the value comparison.
        ReduceError::Unverified => format!(
            "the reduction was not verified within {} steps (`MAX_REDUCED_STEPS`): the machine the \
             single-tape stage measures its skeleton from did not halt, or the reduced machine took no \
             step, stopped outside an accept state, or its tapes did not decode to the program's value",
            redextape_core::tm::MAX_REDUCED_STEPS
        ),
        // `run` parses the list and `emit_reduced` checks the run before `reduce` is called, so neither
        // reaches here; they are spelled out for the reason this function's doc gives.
        ReduceError::StageList => "the stage list is not `fold, single-tape, two-symbol` in order".to_owned(),
        ReduceError::NotRan => "the fitting run did not finish".to_owned(),
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

    /// Own `redextape_test_support::ScratchDir` per case, for the reason `run.rs`'s `run_case` gives:
    /// parallel test threads share a process id, and a shared path makes one test read another's
    /// source. The directory is fully done with by the time this function returns (its content has
    /// already been read into `out`/`err`/`outcome`), so it is safe for `dir` to go out of scope, and
    /// be removed, right here rather than surviving into the caller.
    ///
    /// Takes a whole `Options` so the flag and the config default can be set INDEPENDENTLY — which
    /// is the distinction the pinned refusal message now draws, and which `emit_case`'s
    /// encoding-only shape cannot express.
    fn emit_opts(case: &str, src: &str, lang: Lang, opts: Options) -> (String, String, Outcome) {
        let dir = redextape_test_support::ScratchDir::new(&format!("emit-{case}")).unwrap();
        let p = dir.join("p.rxt");
        std::fs::write(&p, src).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let outcome = run(&Input::from_arg(&p), lang, opts, None, &mut out, &mut err, false).unwrap();
        (String::from_utf8(out).unwrap(), String::from_utf8(err).unwrap(), outcome)
    }

    /// `emit_opts`, but with a real `dest` path instead of `None` — every other failure-path test above
    /// passes `dest: None`, so the brief's "no file is written" was only ever checked against empty
    /// stdout, which every failure produces regardless of whether something was written to a path
    /// nobody gave it. `dest` lives outside the input's own `ScratchDir` so a caller can inspect it, and
    /// possibly pre-populate it, after this returns.
    fn emit_opts_to(case: &str, src: &str, lang: Lang, opts: Options, dest: &Path) -> (String, Outcome) {
        let dir = redextape_test_support::ScratchDir::new(&format!("emit-{case}")).unwrap();
        let p = dir.join("p.rxt");
        std::fs::write(&p, src).unwrap();
        let mut out = Vec::new();
        let mut err = Vec::new();
        let outcome = run(&Input::from_arg(&p), lang, opts, Some(dest), &mut out, &mut err, false).unwrap();
        assert!(out.is_empty(), "stdout must stay empty once a destination path is given");
        (String::from_utf8(err).unwrap(), outcome)
    }

    /// The common case: no width anywhere, so every existing test still exercises auto-fit.
    fn emit_case(case: &str, src: &str, lang: Lang, encoding: Option<EncodingArg>) -> (String, String, Outcome) {
        emit_opts(case, src, lang, Options { encoding, field_width: None, reduce: None, defaults: Defaults::default() })
    }

    /// Values needing more than four cells under unary, so a pin at 4 overflows. The same source
    /// `config_cli.rs` drives the flag case through the real binary with.
    const PIN_SRC: &str = "40 + 2\n";

    /// The sentinel from either side is auto-fit, and the flag beats the config — a flag `0`
    /// included, which is the only way to ask for the search back for one invocation.
    #[test]
    fn the_width_resolves_flag_over_config_with_zero_meaning_auto_fit() {
        assert_eq!(Width::resolve(None, 0), Width::AutoFit, "nothing set anywhere");
        assert_eq!(Width::resolve(Some(0), 0), Width::AutoFit);
        assert_eq!(Width::resolve(Some(0), 8), Width::AutoFit, "a flag 0 must beat a config pin");
        assert_eq!(Width::resolve(Some(8), 0), Width::Flag(8));
        assert_eq!(Width::resolve(Some(8), 16), Width::Flag(8), "flag beats config");
        assert_eq!(Width::resolve(None, 16), Width::Config(16));
    }

    /// **THE PINNED REFUSAL NAMES THE WIDTH THAT WAS TRIED, NOT ONE THAT NEVER WAS.** The shipped
    /// message said the value did not fit "the widest tape field (64 cells, `MAX_FIELD_WIDTH`)"
    /// while the field was 4, then suggested `--encoding binary` — measured, that does not lift a
    /// pin: `--encoding binary --field-width 4` refuses the same program, and
    /// `--encoding binary --field-width 8` emits.
    #[test]
    fn a_pinned_overflow_names_the_width_tried_and_the_flag_that_pinned_it() {
        let opts = Options { encoding: None, field_width: Some(4), reduce: None, defaults: Defaults::default() };
        let (out, err, outcome) = emit_opts("pin-flag", PIN_SRC, Lang::Tm, opts);
        assert_eq!(out, "", "an overflowing program writes no machine, pinned or not");
        assert!(matches!(outcome, Outcome::ToolFailed));
        assert!(err.contains("a 4-cell tape field"), "the width actually tried must be named: {err}");
        assert!(err.contains("`--field-width 4` pinned it"), "and the setting that chose it: {err}");
        assert!(err.contains("raise `--field-width`"), "and a remedy that works: {err}");
        assert!(!err.contains("widest tape field"), "64 was never attempted, so it must not be blamed: {err}");
        assert!(!err.contains("--encoding binary"), "the encoding is not what pinned the width: {err}");
    }

    /// The config case is the worse one: the user typed no flag at all, so a message naming
    /// `--field-width` would point at something absent from their command line.
    #[test]
    fn a_config_pinned_overflow_names_the_key_rather_than_a_flag_nobody_typed() {
        let opts = Options {
            encoding: None,
            field_width: None,
            reduce: None,
            defaults: Defaults { encoding: EncodingArg::Unary, field_width: 4 },
        };
        let (out, err, outcome) = emit_opts("pin-config", PIN_SRC, Lang::Tm, opts);
        assert_eq!(out, "");
        assert!(matches!(outcome, Outcome::ToolFailed));
        assert!(err.contains("a 4-cell tape field"), "the width actually tried: {err}");
        assert!(err.contains("`emit.field-width = 4`"), "and the KEY, since no flag was typed: {err}");
        assert!(!err.contains("`--field-width 4` pinned it"), "no flag was typed, so none may be blamed: {err}");
        assert!(!err.contains("widest tape field"), "64 was never attempted: {err}");
    }

    /// The emitted file must be a complete, self-describing `.tm` — the property `run` (Task 4)
    /// depends on, since a header-less file records no initial tapes.
    #[test]
    fn emitted_tm_carries_a_header_and_re_parses() {
        let (text, err, outcome) = emit_case("tm", "1 + 2", Lang::Tm, Some(EncodingArg::Unary));
        assert!(matches!(outcome, Outcome::Emitted), "stderr: {err}");
        let doc = redextape_core::tm::parse_tm_full(&text);
        assert!(doc.diagnostics.is_empty(), "emitted TM must re-parse cleanly, got: {:?}", doc.diagnostics);
        assert!(doc.machine.is_some(), "emitted TM must carry a machine");
        assert!(doc.header.is_some(), "emitted TM must carry a header, or `run` cannot use it");
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
        let doc = redextape_core::tm::parse_tm_full(&text);
        assert!(doc.diagnostics.is_empty(), "got: {:?}", doc.diagnostics);
        assert!(doc.machine.is_some() && doc.header.is_some());
    }

    /// A program whose fitting run hits `TM_DEFAULT_CAPS` without overflowing.
    const CAPPED_SRC: &str =
        "let mut i = 0; let mut s = 0; while i < 30 { let mut j = 0; while j < 30 { s = 1; j = j + 1; } i = i + 1; } s";

    /// A capped fitting run is NOT the overflow case. The header records the initial tapes and the
    /// decoding recipe, never the answer, so the file describes exactly the machine that was built —
    /// it is emitted, exit 0, and stderr says it will meet the same cap when run.
    #[test]
    fn a_capped_fitting_run_still_emits_and_says_so() {
        let (text, err, outcome) = emit_case("hitcap", CAPPED_SRC, Lang::Tm, Some(EncodingArg::Unary));
        assert!(matches!(outcome, Outcome::Emitted), "a capped fitting run still emits; stderr: {err}");
        assert!(err.starts_with("note:"), "the note must not read as an error, got: {err}");
        assert!(err.contains("TM_DEFAULT_CAPS"), "the note must name the cap, got: {err}");
        let doc = redextape_core::tm::parse_tm_full(&text);
        assert!(
            doc.diagnostics.is_empty(),
            "the emitted file must still be a valid machine, got: {:?}",
            doc.diagnostics
        );
        assert!(doc.machine.is_some() && doc.header.is_some());
    }

    /// `--reduce` as typed, with nothing else set.
    fn reduce_opts(list: &str) -> Options<'_> {
        Options { encoding: None, field_width: None, reduce: Some(list), defaults: Defaults::default() }
    }

    #[test]
    fn reduce_is_rejected_off_the_tm_target() {
        for lang in [Lang::Lambda, Lang::Asm] {
            let (out, err, outcome) =
                emit_opts(&format!("reduce-off-target-{lang:?}"), "1 + 2", lang, reduce_opts("fold"));
            assert_eq!(out, "", "{lang:?}");
            assert_eq!(err, "error: `--reduce` applies to `--lang tm` only\n", "{lang:?}");
            assert!(matches!(outcome, Outcome::ToolFailed), "{lang:?}");
        }
    }

    /// **`StageKind::parse` MATCHES EXACTLY, CASE INCLUDED, AND NOTHING SAID SO.** `Fold`, `FOLD` and
    /// `single -tape` are not `is_stage_list`'s `fold, single-tape, two-symbol` under any looser
    /// reading of `header.rs`'s `StageKind::parse` — an exact, case-sensitive `==` against `name()` —
    /// so all three are refused the same as an unknown stage, and now pinned rather than left implicit.
    #[test]
    fn a_stage_list_that_is_empty_out_of_order_repeated_or_unknown_is_refused_naming_the_order() {
        for (i, list) in
            ["", "single-tape,fold", "fold,fold", "fold,unfold", "Fold", "FOLD", "single -tape"].into_iter().enumerate()
        {
            let (out, err, outcome) = emit_opts(&format!("reduce-list-{i}"), "1 + 2", Lang::Tm, reduce_opts(list));
            assert_eq!(out, "", "{list:?}");
            let want = format!(
                "error: `--reduce` takes stages from `fold, single-tape, two-symbol`, comma-separated, in that \
                 order and each at most once; got `{list}`\n"
            );
            assert_eq!(err, want, "{list:?}");
            assert!(matches!(outcome, Outcome::ToolFailed), "{list:?}");
        }
    }

    #[test]
    fn a_stage_list_allows_spaces_around_its_commas() {
        let all = vec![StageKind::Fold, StageKind::SingleTape, StageKind::TwoSymbol];
        assert_eq!(stage_list(" fold , single-tape,two-symbol "), Some(all));
    }

    /// A reduction is checked against the value the fitting run computed, so a capped fitting run, which
    /// `emit` writes without `--reduce`, writes nothing with it.
    ///
    /// The run's outcome is set to `HitCap` by hand: a program that really reaches `TM_DEFAULT_CAPS` takes
    /// over a second in a debug build, and `emit_reduced` reads nothing of the run but its outcome here.
    #[test]
    fn a_capped_fitting_run_is_not_reduced() {
        let (program, _) = redextape_core::parser::parse("1 + 2");
        let core = redextape_core::desugar::desugar(&program.unwrap());
        let mut d = redextape_core::tm::run_tm_described(
            &core,
            EncodingKind::Unary,
            redextape_core::ty::Ty::Nat,
            redextape_core::tm::TM_DEFAULT_CAPS,
        )
        .unwrap();
        d.run = redextape_core::tm::TmRun::HitCap;
        let mut err = Vec::new();
        let written = emit_reduced(&d, &[StageKind::Fold], EncodingArg::Unary, Width::AutoFit, &mut err).unwrap();
        let err = String::from_utf8(err).unwrap();
        assert_eq!(written, None, "no file");
        assert!(err.starts_with("error: no reduced machine was written: the fitting run did not halt"), "{err}");
    }

    /// **A `ReduceError` IS AN ERROR, AND NO FILE IS WRITTEN — THE BRIEF'S OWN WORDS.** Every other
    /// `--reduce` failure test above runs with `dest: None`, so their "no file" check only ever
    /// observed empty stdout, which a failure produces either way. This is the deepest failure a real
    /// compiled program reaches under `--reduce`: past every argument check (unlike
    /// `reduce_is_rejected_off_the_tm_target` and the stage-list test above, both refused before the
    /// input is even read), through parsing, type-checking, desugaring and the actual fitting TM run,
    /// which is where this source's `Overflow` comes from. A genuine `ReduceError::Refused` /
    /// `Layout` / `Unverified` needs a hand-built `Machine` to trigger for real —
    /// `reduced_file.rs`'s own tests reach for `run_of`/`walk`/`bank` fixtures for exactly that reason
    /// — so this program is the closest a real `.rxt` source gets to the producer.
    #[test]
    fn an_overflowing_program_is_refused_under_reduce_as_it_is_without() {
        let (out, err, outcome) = emit_opts("reduce-overflow", OVERFLOW_SRC, Lang::Tm, reduce_opts("fold"));
        let (_, plain, _) = emit_case("reduce-overflow-plain", OVERFLOW_SRC, Lang::Tm, None);
        assert_eq!(out, "");
        assert_eq!(err, plain, "the same refusal, word for word");
        assert!(matches!(outcome, Outcome::ToolFailed));

        // No file is written when none was there.
        let dir = redextape_test_support::ScratchDir::new("reduce-overflow-dest").unwrap();
        let dest = dir.join("out.tm");
        let (err, outcome) = emit_opts_to("reduce-overflow-dest", OVERFLOW_SRC, Lang::Tm, reduce_opts("fold"), &dest);
        assert_eq!(err, plain, "the same refusal with a real output path given");
        assert!(matches!(outcome, Outcome::ToolFailed));
        assert!(!dest.exists(), "a ReduceError must write no file, but one exists at {}", dest.display());

        // A file already there is left exactly as it was — not deleted, and not overwritten.
        std::fs::write(&dest, "sentinel\n").unwrap();
        let (err, outcome) = emit_opts_to("reduce-overflow-dest-2", OVERFLOW_SRC, Lang::Tm, reduce_opts("fold"), &dest);
        assert_eq!(err, plain, "the same refusal again, with a file already at the destination");
        assert!(matches!(outcome, Outcome::ToolFailed));
        assert_eq!(
            std::fs::read_to_string(&dest).unwrap(),
            "sentinel\n",
            "a file already at the destination must be left untouched"
        );
    }

    /// **EVERY ONE OF CORE'S FIVE REFUSAL NAMES GETS ITS OWN CAUSE, AND ONLY `too-many-states` MAY
    /// BLAME THE STATE CEILING.** The shipped message named every refusal and then explained the
    /// ceiling regardless of which one it was — true only of `TOO_MANY_STATES` — so a left-end
    /// collision or an uncovered alphabet sent a reader to look at a state count. Each of the five
    /// cases below asserts its own explanation's substance, not only that a name appears, and the
    /// final loop over all five re-confirms that `MAX_MACHINE_STATES` shows up in exactly one message.
    ///
    /// The block after it pins the same property for `Unverified`, which is one variant over four
    /// causes: the whole-branch review found the fix above had swept `Refused` and left this sibling
    /// blaming the step ceiling for a measuring run that never reached it.
    #[test]
    fn every_reduce_refusal_names_its_cause() {
        use redextape_core::tm::reduction::{
            ALPHABET_COLLISION, CODE_DOES_NOT_COVER_ALPHABET, LEFT_END_COLLISION, TOO_MANY_STATES, TOO_MANY_TAPES,
        };
        for (e, cause) in [
            (ReduceError::LayoutCollision('a'), "the symbol `a`"),
            (ReduceError::Layout, "cannot be laid out"),
            (ReduceError::Unverified, "within 1000000000 steps"),
            (ReduceError::StageList, "not `fold, single-tape, two-symbol` in order"),
            (ReduceError::NotRan, "did not finish"),
        ] {
            let said = reduce_refusal(&e);
            assert!(said.contains(cause), "{e:?}: {said}");
        }
        for (name, explains) in [
            (TOO_MANY_STATES, "MAX_MACHINE_STATES"),
            (TOO_MANY_TAPES, "MAX_ENCODABLE_TAPES"),
            (ALPHABET_COLLISION, "reserves for its own markers"),
            (CODE_DOES_NOT_COVER_ALPHABET, "no pattern for one of the symbols"),
            (LEFT_END_COLLISION, "plants at the tape's left end"),
        ] {
            let said = reduce_refusal(&ReduceError::Refused(name));
            assert!(said.contains(&format!("with `{name}`")), "{name}: {said}");
            assert!(said.contains(explains), "{name} must carry its own explanation: {said}");
            assert_eq!(
                said.contains("MAX_MACHINE_STATES"),
                name == TOO_MANY_STATES,
                "only `too-many-states` may blame the state ceiling: {said}"
            );
        }

        // `Unverified` is the same defect one variant further along: `reduce_within` raises it from FOUR
        // places and the variant cannot say which, so the message has to name all four. The misses are
        // collected rather than asserted one at a time, so a run reports every cause that went missing
        // instead of stopping at the first.
        let said = reduce_refusal(&ReduceError::Unverified);
        let missing: Vec<&str> = [
            "measures its skeleton from did not halt",
            "took no step",
            "stopped outside an accept state",
            "did not decode to the program's value",
        ]
        .into_iter()
        .filter(|cause| !said.contains(cause))
        .collect();
        assert!(missing.is_empty(), "`Unverified` must name all four causes; missing {missing:?}:\n  {said}");
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
        let doc = redextape_core::tm::parse_asm_full(&text);
        let (prog, header, ds) = (doc.program, doc.header, doc.diagnostics);
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
        let doc = redextape_core::tm::parse_asm_full(&text);
        let (header, ds) = (doc.header, doc.diagnostics);
        assert!(ds.is_empty(), "{ds:?}");
        assert_eq!(header, None, "no header, because no value type could be written");
    }
}
