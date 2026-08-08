//! The TM backend: Core AST -> register-assembly -> multi-tape Turing machine -> `Value`, plus a
//! round-tripping TM text form. See `docs/superpowers/specs/2026-07-22-tm-backend-design.md`.
//!
//! Part 1 (this slice): the register-assembly IR (`asm`) and Core -> asm lowering (`lower_asm`),
//! delivering the intermediate oracle `reference == asm-interpreter`.

pub mod asm;
pub mod attribute;
pub mod build;
pub mod decode;
pub mod defunc;
pub mod encoding;
pub mod header;
pub mod lower_asm;
pub mod lower_tm;
pub mod machine;
pub mod sim;
pub mod syntax;

pub use asm::{
    AsmOutcome, AsmRun, Caps, DEFAULT_CAPS, Instr, Program, Reg, decode_asm, decode_asm_ty, print_asm,
    print_asm_mapped, run_asm,
};
pub use attribute::{Attribution, StepBucket, attribute, attribute_at, attribute_steps};
pub use build::{
    AT, BOX, Builder, HEAP, MARK, MAX_FIELD_WIDTH, MAX_TAPES, MIN_FIELD_WIDTH, REG, RuleSpec, SEP, STACK, Slot,
    TAPE_NAMES, TAPES, WORK, ZERO,
};
pub use decode::{decode_tape, decode_tape_ty};
pub use defunc::{defunc, defunc_mapped};
pub use encoding::{Binary, Encoding, Unary};
pub use header::{EncodingKind, HEADER_VERSION, TmHeader};
pub use lower_asm::{LowerError, lower_asm, lower_asm_mapped};
pub use lower_tm::{lower_tm, lower_tm_guarded, lower_tm_mapped, n_slots_of};
pub use machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
pub use sim::{
    Caps as TmCaps, DEFAULT_CAPS as TM_DEFAULT_CAPS, Status as TmStatus, Step, Tape, Trace, Watcher, simulate,
    simulate_counts, simulate_final, simulate_trace, simulate_watched,
};
pub use syntax::{parse_tm, parse_tm_full, print_tm, print_tm_mapped, print_tm_with, print_tm_with_mapped};

use crate::core::Core;
use crate::ty::Ty;
// `Encoding`, `lower_asm`, `LowerError`, `lower_tm`, `simulate`, `Tape`, `TmCaps`, `TmStatus`, `REG`,
// and `TAPES` are all already in scope via this module's existing `pub use` re-exports.

/// The outcome of lowering + simulating a program through the TM backend. Decoding to a `Value` is a
/// separate, type-directed step (`decode_tape`), because bare tapes are ambiguous. Mirrors `LambdaRun`.
#[derive(Clone, Debug)]
pub enum TmRun {
    /// Simulated to a halt. Decode the final tapes against an expected value's shape (`decode_tape`).
    ///
    /// Any instance of the encoding decodes these tapes — the width the machine was lowered at does not
    /// have to reach the decoder. Both encodings read STRUCTURALLY, from one delimiter to the next, so a
    /// tape auto-fitted to 4 cells decodes correctly under a 64-cell instance. (`Unary` always did;
    /// `Binary` was width-strict until the structural-decode change, which is why callers used to have
    /// to thread `run_tm_fitted`'s reported width into a matching `Binary::at(..)`.)
    Ran { tapes: Vec<Tape> },
    /// The simulation hit a step / tape-cells cap.
    HitCap,
    /// A value did not fit the encoding's field width at ANY width up to `MAX_FIELD_WIDTH` — the
    /// program is not representable on this tape. Distinct from `HitCap`: nothing diverged, the tape is
    /// simply too narrow, which is a property of the encoding rather than of the program's semantics.
    Overflow,
    /// `lower_tm` REFUSED to build a machine for this program at all — an absurd register file
    /// (`lower_tm::MAX_SLOTS`), an absurd `Loc` bank in a call-containing program
    /// (`lower_tm::MAX_FRAME_LOC`), or too many `Mul` instructions (`lower_tm::MAX_MUL_INSTRS`, each
    /// O(width²) states under `Binary`). Any of the three would make `lower_tm` build (or `init_reg`
    /// allocate) an oversized machine were lowering to proceed, so lowering never proceeds: the program
    /// never ran a single step.
    ///
    /// Distinct from `HitCap`, which reports a run that started and then hit a resource cap mid-flight
    /// — a program refused here never started. Distinct from `Overflow` too: `run_tm_fitted`'s retry
    /// loop widens the bank and tries again on `Overflow`, which would be actively wrong for this case
    /// (the same too-large program would simply be re-lowered, and re-refused, at every width up to the
    /// ceiling). `TooLarge` is reported once, at the first width tried, with no retry.
    TooLarge,
    /// The program could not be lowered to asm (e.g. a higher-order use).
    LowerError(LowerError),
}

/// Lower `core` to asm, trying direct (first-order) lowering before defunctionalizing.
///
/// `lower_asm` is tried FIRST, not just as a fast path: `defunc`'s top-level peeling only recognizes a
/// `fn`-chain (`LetRec`-with-`Lambda`), not a directly-applied, call-only `let f = |params| body; ...`
/// binding — a shape `lower_asm` already lowers directly (a named call-only lambda binding, Task 3b's
/// contract test `directly_applied_lambda_is_a_named_subroutine`). Defunctionalizing such a program
/// first would wrongly reject it (`defunc` treats any bare `Lambda` in `Let`'s value position as a
/// higher-order value-use, since only its `LetRec` peel special-cases a call-only function binding),
/// regressing a first-order demo (`"let add1 = |x| x + 1; add1(41)"`) from `Ran` to `LowerError`. So:
/// try the program as first-order Core unchanged, and only defunctionalize -- rewriting higher-order
/// Core (a function value, e.g. `map`/`fold`'s callback argument) into the first-order subset -- when
/// the direct attempt rejects the program as higher-order.
///
/// Only `LowerError::Unsupported` triggers the `defunc` retry. `LowerError::TooDeep` (the deep-Core
/// stack-safety guard) is returned immediately instead: retrying a `TooDeep` rejection through
/// `defunc` would replay the same (or a structurally similar) deep Core through `defunc`'s own
/// recursive passes. `defunc` is now total on any depth (see `defunc::MAX_DEFUNC_DEPTH`), so this is no
/// longer required for safety, but it stays narrow anyway: `TooDeep` is never a signal that
/// defunctionalizing would help, so retrying it is redundant work at best.
fn lower_program(core: &Core) -> Result<Program, LowerError> {
    match lower_asm(core) {
        Ok(p) => return Ok(p),
        Err(LowerError::Unsupported { .. }) => {}
        Err(e @ LowerError::TooDeep { .. }) => return Err(e),
    }
    let defunced = defunc(core)?;
    lower_asm(&defunced)
}

/// Lower (`lower_asm`, defunctionalizing first if needed -> `lower_tm`) then simulate. The convenience
/// entry point for the oracle and later plans; `enc` selects the numeric encoding (the v1 `Unary`).
/// Panic-free and bounded by `caps`.
///
/// Discards the width auto-fit settled on, which is fine for decoding — see `TmRun::Ran` — since both
/// encodings decode structurally. Use `run_tm_fitted` when the width itself is the interesting output
/// (a size report, a step-count comparison across widths).
pub fn run_tm(core: &Core, enc: &dyn Encoding, caps: TmCaps) -> TmRun {
    run_tm_fitted(core, enc, caps).0
}

/// One attempt at `enc`'s own width: lower, lay out the bank, simulate, and classify the halt.
///
/// Returns the machine and the initial tapes it built alongside the outcome. `run_tm_fitted` drops
/// both; `run_tm_described` keeps them, and keeping them is the point — a header whose literal tapes
/// were re-derived from its own `encoding`/`width`/`slots` fields could not disagree with them, so
/// the consistency check over it would prove nothing. This is the ONE place that builds `init` on the
/// `run_tm*` path, which is what makes the check a check. `tm/attribute.rs` builds a second `init` for
/// its own purposes, setting only REG and never calling `init_work()` — harmless under `Unary`, where
/// `init_work` returns empty regardless, but whether that omission is sound under `Binary` is a real
/// open question, filed separately rather than answered here.
fn attempt(prog: &Program, enc: &dyn Encoding, n_slots: u32, caps: TmCaps) -> (TmRun, Machine, Vec<Vec<Symbol>>, u64) {
    let (machine, overflow) = lower_tm_guarded(prog, enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots);
    init[WORK] = enc.init_work();
    let (run, steps) = match simulate_final(&machine, &init, caps) {
        (_, s, TmStatus::Halted, n) if s == overflow => (TmRun::Overflow, n),
        (tapes, _, TmStatus::Halted, n) => (TmRun::Ran { tapes }, n),
        (_, _, TmStatus::HitCap, n) => (TmRun::HitCap, n),
    };
    (run, machine, init, steps)
}

/// Lower `core`, then check ALL THREE of `lower_tm`'s layout refusals — `MAX_SLOTS` (an absurd register
/// file, which would also drive `init_reg` into a huge or aborting allocation just below),
/// `frame_bank_unrepresentable` (an absurd `Loc` bank in a call-containing program), and
/// `mul_count_unrepresentable` (too many `Mul` instructions, each O(width²) states under `Binary`).
///
/// The single place `run_tm_fitted`/`run_tm_at` decide "is this program representable at all", so the
/// two cannot drift from each other or from the guards they mirror — the same reason
/// `frame_bank_unrepresentable` itself is a shared predicate rather than re-derived at each call site.
/// A refused program is reported as `TmRun::TooLarge`: it never took a step, so it must not come back
/// as `Ran` over tapes that decode to nothing (`MAX_SLOTS`'s and `MAX_FRAME_LOC`'s old behaviour) or as
/// `HitCap` (which claims a run started and then hit a resource cap mid-flight).
fn lower_and_size(core: &Core) -> Result<(Program, lower_tm::SlotMap), TmRun> {
    let prog = lower_program(core).map_err(TmRun::LowerError)?;
    let sm = lower_tm::SlotMap::of(&prog);
    if sm.n_slots() > crate::tm::lower_tm::MAX_SLOTS
        || lower_tm::frame_bank_unrepresentable(&prog, &sm)
        || lower_tm::mul_count_unrepresentable(&prog)
    {
        return Err(TmRun::TooLarge);
    }
    Ok((prog, sm))
}

/// Lower, then run at the narrowest field width that fits, reporting that width alongside the outcome.
///
/// Attempts `MIN_FIELD_WIDTH`, doubling, up to `MAX_FIELD_WIDTH`; an attempt that halts in the overflow
/// guard is retried one width wider, and anything else is the answer. Reaching the ceiling and still
/// overflowing yields `TmRun::Overflow`. An encoding reporting `field_width() == None` is unbounded, so
/// there is exactly one attempt and the reported width is `None`.
///
/// Only the GUARD triggers a retry, never `HitCap` (nor `TooLarge`) — a nil/dangling dereference spins
/// to a cap at every width, so retrying on caps would burn the full step budget five times over and
/// still report the same thing; a program `lower_and_size` refuses is refused independently of width,
/// so retrying it would just re-refuse it at every width up to the ceiling for no benefit. That
/// distinction is the reason the guard is a state id rather than a spin (see `Builder::overflow`).
///
/// The retries are cheap BECAUSE of the guard: a too-narrow attempt runs the correct prefix of the
/// program and then halts at its first overflowing store, so it costs less than the successful attempt
/// that follows it. Without the guard an under-sized run corrupts the bank and frequently runs away to
/// the full step cap instead, which is what made the pre-guard behaviour expensive as well as wrong.
pub fn run_tm_fitted(core: &Core, enc: &dyn Encoding, caps: TmCaps) -> (TmRun, Option<usize>) {
    let (prog, sm) = match lower_and_size(core) {
        Ok(p) => p,
        Err(e) => return (e, None),
    };
    let n_slots = sm.n_slots();
    if enc.field_width().is_none() {
        return (attempt(&prog, enc, n_slots, caps).0, None);
    }
    let mut width = MIN_FIELD_WIDTH;
    loop {
        let fitted = enc.at_width(width);
        match attempt(&prog, &*fitted, n_slots, caps).0 {
            TmRun::Overflow if width < MAX_FIELD_WIDTH => width = (width * 2).min(MAX_FIELD_WIDTH),
            other => return (other, Some(width)),
        }
    }
}

/// A run together with everything needed to write it down: the machine, and the header describing the
/// very configuration it was run from.
#[derive(Clone, Debug)]
pub struct DescribedRun {
    /// What happened.
    pub run: TmRun,
    /// The machine that ran. `print_tm_with(&machine, &header)` is a complete, self-describing file.
    pub machine: Machine,
    /// The recipe AND the literal initial tapes, captured from the configuration `simulate` was
    /// handed — not re-derived from the recipe, which is what makes the consistency check a check.
    pub header: TmHeader,
    /// δ-steps taken by the run `run` describes.
    ///
    /// ON `DescribedRun` RATHER THAN ON `TmRun::Ran`, and the reason is not only that `Ran` is
    /// destructured at 52 sites. `run_tm_described` answers `Err` for a program that never ran, so a
    /// `DescribedRun` always describes a run that STARTED — including `HitCap` and `Overflow`, both
    /// of which have step counts and would have nowhere to put them if the field hung off `Ran`.
    ///
    /// FOR `Overflow` THIS IS THE LAST ATTEMPT'S COUNT. The width search below doubles and retries,
    /// so a program that overflows at width 8 and fits at 64 simulates four times; the count reported
    /// belongs to the run whose outcome is reported.
    pub steps: u64,
}

/// Lower, auto-fit the width, run — and return the machine and header that together form a complete
/// `.tm` file for that run.
///
/// `result` is the program's top-level type (`typeck::result_type`), which the caller supplies
/// because this function takes `Core` and typing happens on the AST.
///
/// `Err` for a program that never ran (`LowerError` / `TooLarge`): there is no configuration to
/// describe, so there is no honest header to return.
///
/// Mirrors `run_tm_fitted`'s search — `MIN_FIELD_WIDTH`, doubling, retrying only on the overflow
/// guard — but has no unbounded-encoding branch: `EncodingKind` names only bounded encodings, since
/// an unbounded one has no name to write in a file.
pub fn run_tm_described(core: &Core, kind: EncodingKind, result: Ty, caps: TmCaps) -> Result<DescribedRun, TmRun> {
    let (prog, sm) = lower_and_size(core)?;
    let n_slots = sm.n_slots();
    let mut width = MIN_FIELD_WIDTH;
    loop {
        let fitted = kind.at(width);
        let (run, machine, init, steps) = attempt(&prog, &*fitted, n_slots, caps);
        match run {
            TmRun::Overflow if width < MAX_FIELD_WIDTH => width = (width * 2).min(MAX_FIELD_WIDTH),
            run => {
                let tapes = init.into_iter().enumerate().collect();
                let header = TmHeader::new(kind, width, n_slots, result, tapes);
                return Ok(DescribedRun { run, machine, header, steps });
            }
        }
    }
}

/// Lower then simulate ONCE, at `enc`'s own width, with no search. What the step-count goldens and the
/// attribution survey use, so their numbers stay comparable across slices even as auto-fit changes what
/// a program costs end to end.
pub fn run_tm_at(core: &Core, enc: &dyn Encoding, caps: TmCaps) -> TmRun {
    let (prog, sm) = match lower_and_size(core) {
        Ok(p) => p,
        Err(e) => return e,
    };
    attempt(&prog, enc, sm.n_slots(), caps).0
}

#[cfg(test)]
mod run_tm_tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::parser::parse;
    use crate::value::Value;

    fn core_of(src: &str) -> Core {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        desugar(&prog.unwrap())
    }

    /// Auto-fit settles on the narrowest power-of-two width at which nothing overflows, and the answer
    /// is the one the default 64-wide bank gives. The WIDTHS are the interesting assertion: a program
    /// storing 7 must not be run on a 64-cell bank.
    #[test]
    fn run_tm_auto_fits_the_width_per_program() {
        fn fitted(src: &str) -> (Value, Option<usize>) {
            let core = core_of(src);
            let expected = crate::run(src).expect("reference run failed");
            let (run, width) = run_tm_fitted(&core, &Unary::default(), TM_DEFAULT_CAPS);
            match run {
                TmRun::Ran { tapes } => (decode_tape(&tapes, &expected, &Unary::default()).expect("decode"), width),
                other => panic!("tm did not run: {other:?}"),
            }
        }
        assert_eq!(fitted("1 + 2 * 3"), (Value::Nat(7), Some(8)));
        assert_eq!(fitted("3 - 5"), (Value::Nat(0), Some(8)));
        assert_eq!(fitted("let x = 40; x + 2"), (Value::Nat(42), Some(64)));
        assert_eq!(fitted("[1, 2, 3]"), (Value::list_of_nats(&[1, 2, 3]), Some(4)));
    }

    /// A tape decodes to the same value under an encoding instance of ANY width, for both encodings.
    ///
    /// This is the property `Binary` used to lack. Its decode required a field to close exactly at the
    /// instance's own `width`, so a tape auto-fitted to 4 or 8 cells decoded to `None` under
    /// `Binary::default()` (64) and every caller had to thread the fitted width from `run_tm_fitted`
    /// into a matching `Binary::at(..)`. Both decoders are structural now — they read one delimiter to
    /// the next — so the width the machine was lowered at no longer has to reach the decoder at all.
    ///
    /// Three things keep this from passing vacuously:
    ///
    ///   * The programs fit BELOW 64, asserted rather than assumed. At 64 a strict decoder and a
    ///     structural one agree, so a corpus that all fitted at the ceiling would prove nothing.
    ///   * Reader widths run in BOTH directions from the fitted one, including widths NARROWER than the
    ///     tape was laid out at. That is not decoration, and it is sabotage-verified: adding a ONE-SIDED
    ///     width dependence to `Binary::decode_nat` (`if n > self.width { return None }`) is accepted by
    ///     the default reader (64) AND by the fitted reader (8), and is caught ONLY by `read at 4`.
    ///   * The corpus reaches the HEAP (`[20, 25, 30]`, `head(tail(..))`) and the STACK (`sum`), so
    ///     `parse_heap_cells` and its pointer chain are covered too, not just `decode_nat` on slot 0.
    ///
    /// THE VALUES ARE LOAD-BEARING and were nearly wrong. An earlier corpus (`1 + 2 * 3`, `[1, 2, 3]`,
    /// `sum(4)`) fitted BINARY at 4 for every program — `MIN_FIELD_WIDTH`, the narrowest width there is
    /// — so `MIN_FIELD_WIDTH` in the reader list was never actually narrower than the tape, and the
    /// narrower direction went unexercised for the very encoding this test exists for. Measured, not
    /// assumed. Values in [16, 31] are what put unary at 32 and binary at 8 simultaneously, and the
    /// `MIN_FIELD_WIDTH < width` assertion below is what stops a future edit from losing that again.
    #[test]
    fn a_tape_decodes_the_same_at_every_reader_width() {
        for src in [
            "20 + 5",
            "[20, 25, 30]",
            "head(tail([20, 25, 30]))",
            "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(6)",
        ] {
            let core = core_of(src);
            let expected = crate::run(src).expect("reference run failed");
            for enc in [&Unary::default() as &dyn Encoding, &Binary::default()] {
                let (run, width) = run_tm_fitted(&core, enc, TM_DEFAULT_CAPS);
                let TmRun::Ran { tapes } = run else { panic!("`{src}` did not run: {run:?}") };
                let width = width.expect("a bounded encoding reports a fitted width");
                // Both bounds are non-vacuity guards, in opposite directions: at the ceiling a strict
                // decoder and a structural one agree, and at the floor no reader below is available.
                assert!(width < MAX_FIELD_WIDTH, "`{src}` fitted to {width}: at the ceiling this proves nothing");
                assert!(MIN_FIELD_WIDTH < width, "`{src}` fitted to {width}: no reader is narrower than the tape");
                // The DEFAULT instance (64 cells), NOT `enc.at_width(width)`.
                assert_eq!(
                    decode_tape(&tapes, &expected, enc),
                    Some(expected.clone()),
                    "`{src}`: default reader, tape written at {width}"
                );
                // Then widths above AND below the one the tape was actually laid out at.
                for reader in [MIN_FIELD_WIDTH, width, width * 2, MAX_FIELD_WIDTH] {
                    let at = enc.at_width(reader);
                    assert_eq!(
                        decode_tape(&tapes, &expected, at.as_ref()),
                        Some(expected.clone()),
                        "`{src}`: written at {width}, read at {reader}"
                    );
                }
            }
        }
    }

    /// A value the tape cannot represent at ANY width up to the ceiling is now REPORTED. Before the
    /// guard this silently miscompiled: the bank was corrupted and a wrong answer came back.
    #[test]
    fn a_value_beyond_the_ceiling_reports_overflow() {
        assert!(matches!(run_tm(&core_of("100 * 100"), &Unary::default(), TM_DEFAULT_CAPS), TmRun::Overflow));
    }

    /// Fix 1: a program with more `Mul`s than `lower_tm::MAX_MUL_INSTRS` must be reported as
    /// `TooLarge` through `run_tm`/`run_tm_at`/`run_tm_fitted` alike — never `Ran` (the machine
    /// `lower_tm` refuses to build cannot have simulated to a value) and never retried as `Overflow`
    /// (which would just re-refuse the same program at every width up to the ceiling).
    #[test]
    fn too_many_muls_is_reported_as_too_large_not_ran_or_overflow() {
        let src = vec!["2"; crate::tm::lower_tm::MAX_MUL_INSTRS as usize + 2].join(" * ");
        let core = core_of(&src);
        assert!(matches!(run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS), TmRun::TooLarge));
        assert!(matches!(run_tm(&core, &Binary::default(), TM_DEFAULT_CAPS), TmRun::TooLarge));
        assert!(matches!(run_tm_at(&core, &Unary::default(), TM_DEFAULT_CAPS), TmRun::TooLarge));
        let (fitted, width) = run_tm_fitted(&core, &Binary::default(), TM_DEFAULT_CAPS);
        assert!(matches!(fitted, TmRun::TooLarge), "got {fitted:?}");
        assert_eq!(width, None, "a refused program was never fitted to any width");
    }

    /// Fix 2 (roadmap "TM bank-safety" item 1): `run_tm` used to guard only `MAX_SLOTS`, so a
    /// call-containing program whose `Loc` bank `lower_tm` refuses to lay out (`MAX_FRAME_LOC`) came
    /// back as `Ran` over tapes that decode to nothing, instead of a resource outcome. It must now
    /// mirror `frame_bank_unrepresentable` and report `TooLarge`, exactly as `attribute` already does
    /// (see `attribute.rs`'s `a_program_too_wide_for_the_frame_bank_reports_that_nothing_ran`).
    #[test]
    fn a_frame_bank_too_wide_to_lay_out_is_too_large_not_ran() {
        const N: usize = 1_100; // > MAX_FRAME_LOC (1,000) locals in a function that contains a call.
        let params: String = (0..N).map(|i| format!("p{i}, ")).collect();
        let src = format!("fn g(y) {{ y }} fn f({params}n) {{ g(n) }} f({}3)", "1, ".repeat(N));
        let core = core_of(&src);
        assert!(matches!(run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS), TmRun::TooLarge));
        assert!(matches!(run_tm_at(&core, &Unary::default(), TM_DEFAULT_CAPS), TmRun::TooLarge));
        assert!(matches!(run_tm_fitted(&core, &Unary::default(), TM_DEFAULT_CAPS).0, TmRun::TooLarge));
    }

    /// `run_tm_at` does NOT search: it runs once at the encoding's own width, which is what the step
    /// goldens and the attribution survey need in order to stay comparable across slices.
    #[test]
    fn run_tm_at_pins_the_width() {
        let core = core_of("1 + 2 * 3");
        assert!(matches!(run_tm_at(&core, &Unary::at(4), TM_DEFAULT_CAPS), TmRun::Overflow));
        assert!(matches!(run_tm_at(&core, &Unary::at(8), TM_DEFAULT_CAPS), TmRun::Ran { .. }));
    }

    /// Divergence must NOT be mistaken for a too-narrow field and retried: `head(nil)` spins to a cap at
    /// every width, so auto-fit must report that from the FIRST attempt rather than climbing to 64 and
    /// burning a full step budget at each width on the way.
    #[test]
    fn divergence_is_not_retried_as_an_overflow() {
        let core = core_of("head(nil)");
        let (run, width) = run_tm_fitted(&core, &Unary::default(), TmCaps { steps: 50_000, cells: 50_000 });
        assert!(matches!(run, TmRun::HitCap), "a deref fault spins to a cap, it does not overflow");
        assert_eq!(width, Some(MIN_FIELD_WIDTH), "and it must not have been retried at a wider bank");
    }

    fn tm_value(src: &str) -> Value {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let expected = crate::run(src).expect("reference run failed");
        match run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS) {
            TmRun::Ran { tapes } => decode_tape(&tapes, &expected, &Unary::default()).expect("decode failed"),
            other => panic!("tm did not run: {other:?}"),
        }
    }

    #[test]
    fn run_tm_on_control_flow_programs() {
        assert_eq!(tm_value("1 + 2 * 3"), Value::Nat(7));
        assert_eq!(tm_value("3 - 5"), Value::Nat(0));
        assert_eq!(tm_value("if 2 > 1 { 10 } else { 20 }"), Value::Nat(10));
        assert_eq!(tm_value("let x = 40; x + 2"), Value::Nat(42));
        assert_eq!(
            tm_value("let mut n = 3; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc"),
            Value::Nat(3)
        );
    }

    /// Plan 3b-1: `run_tm` now defunctionalizes a higher-order program (a function received as a
    /// value) before lowering, instead of returning `LowerError` for it.
    #[test]
    fn run_tm_defunctionalizes_higher_order_programs() {
        assert_eq!(tm_value("fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)"), Value::Nat(6));
        assert_eq!(
            tm_value(
                "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
                 fn add1(x) { x + 1 }\n\
                 [3, 1, 2].map(add1)"
            ),
            Value::list_of_nats(&[4, 2, 3])
        );
    }

    /// A directly-applied, call-only `let`-bound lambda must still run on the TM after wiring
    /// `defunc` in: `lower_program` tries direct `lower_asm` first precisely so this (a shape
    /// `defunc`'s `LetRec`-only peel does not recognize) does not regress to `LowerError`.
    #[test]
    fn run_tm_still_handles_a_directly_applied_let_bound_lambda() {
        assert_eq!(tm_value("let add1 = |x| x + 1; add1(41)"), Value::Nat(42));
    }

    /// Regression for the totality bug: a deep FIRST-order program (a huge list literal desugars to a
    /// ~40,000-deep `cons`/`Apply` spine) must make `run_tm` return cleanly, never crash the process.
    /// Before this fix, `lower_program` retried EVERY `LowerError` from `lower_asm` -- including
    /// `TooDeep` -- through `defunc`, whose unguarded recursion then overflowed the native stack (a
    /// SIGABRT, not a `TmRun`). Mirrors `asm_oracle.rs::deep_list_literal_lowers_without_overflowing`
    /// but end-to-end through `run_tm`. Run on an explicit 8 MiB thread -- the production stack size
    /// `lower_asm::MAX_LOWER_DEPTH` / `defunc::MAX_DEFUNC_DEPTH` are tuned against (see that doc
    /// comment for why a smaller test thread would overflow before either guard fires; do NOT shrink
    /// this).
    #[test]
    fn run_tm_deep_list_literal_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(8 * 1024 * 1024)
            .spawn(|| {
                let src = format!("[{}]", vec!["1"; 40_000].join(", "));
                let (prog, ds) = parse(&src);
                assert!(ds.is_empty(), "parse errors: {ds:?}");
                let core = desugar(&prog.unwrap());
                match run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS) {
                    TmRun::LowerError(_) | TmRun::HitCap | TmRun::Overflow | TmRun::TooLarge => {}
                    TmRun::Ran { .. } => panic!("expected LowerError or HitCap for a 40k-deep list literal"),
                }
            })
            .unwrap()
            .join()
            .unwrap();
    }

    /// `attempt` initializes WORK from the encoding, and for unary that must be EMPTY — the same tape
    /// unary gadgets have always started from. This pins the "no behaviour change" half of adding the
    /// method: a non-empty unary WORK would shift every step count in the goldens.
    #[test]
    fn unary_starts_with_an_empty_work_tape() {
        assert_eq!(Unary::default().init_work(), Vec::<Symbol>::new());
        assert_eq!(Unary::at(4).init_work(), Vec::<Symbol>::new());
    }

    /// `DescribedRun.steps` is the δ-count of the run whose outcome `run` reports — the number a UI
    /// shows as "2,870 steps" and uses as the denominator of a progress bar.
    ///
    /// PINNED AGAINST THE CURSOR, not against a literal alone. The same machine driven through a
    /// `TmCursor` must reach the same total, because the product will read one number from the fitting
    /// run and drive the other from the cursor, and two sources for one number is a drift hazard.
    #[test]
    fn described_run_reports_the_step_count_the_cursor_reaches() {
        use crate::trace::TmCursor;

        let (program, _) = crate::parser::parse("let x = 40; x + 2");
        let program = program.expect("parses");
        let ty = crate::typeck::result_type(&program).expect("typechecks");
        let core = crate::desugar::desugar(&program);

        let d = run_tm_described(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS).expect("runs");
        assert!(matches!(d.run, TmRun::Ran { .. }), "this program halts, got {:?}", d.run);
        assert_eq!(d.steps, 2870, "the pinned δ-count for `let x = 40; x + 2` under Unary");

        let init = d.header.init(d.machine.tapes);
        let mut cursor = TmCursor::new(&d.machine, &init, TM_DEFAULT_CAPS);
        while cursor.next().is_some() {}
        assert_eq!(cursor.steps_taken(), d.steps, "the fitting run and the cursor must not drift");
    }
}
