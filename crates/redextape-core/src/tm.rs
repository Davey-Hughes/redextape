//! The TM backend: Core AST -> register-assembly -> multi-tape Turing machine -> `Value`, plus a
//! round-tripping TM text form. See `docs/superpowers/specs/2026-07-22-tm-backend-design.md`.
//!
//! Part 1 (this slice): the register-assembly IR (`asm`) and Core -> asm lowering (`lower_asm`),
//! delivering the intermediate oracle `reference == asm-interpreter`.

pub mod asm;
pub mod asm_syntax;
pub mod attribute;
pub mod build;
pub mod comments;
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
    AsmHeader, AsmOutcome, AsmRun, Caps, DEFAULT_CAPS, DecodeFailure, Instr, Program, Reg, decode_asm,
    decode_asm_reason, decode_asm_ty, decode_asm_ty_reason, print_asm, print_asm_mapped, print_asm_with,
    print_asm_with_mapped, run_asm,
};
pub use asm_syntax::{parse_asm, parse_asm_full};
pub use attribute::{Attribution, StepBucket, attribute, attribute_at, attribute_steps};
pub use build::{
    AT, BOX, Builder, HEAP, MARK, MAX_FIELD_WIDTH, MAX_MACHINE_STATES, MAX_TAPES, MIN_FIELD_WIDTH, REG, RuleSpec, SEP,
    STACK, Slot, TAPE_NAMES, TAPES, WORK, ZERO,
};
pub use decode::{decode_tape, decode_tape_reason, decode_tape_ty, decode_tape_ty_reason};
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
    /// A value did not fit the encoding's field width at a width that was TRIED. Distinct from
    /// `HitCap`: nothing diverged, the tape is simply too narrow, which is a property of the encoding
    /// rather than of the program's semantics.
    ///
    /// **WHICH WIDTHS WERE TRIED DEPENDS ON THE PRODUCER, AND THIS DOC USED TO ASSUME ONE OF THEM.**
    /// It read "at ANY width up to `MAX_FIELD_WIDTH`", which was true while `run_tm_fitted` and
    /// `run_tm_described` — both of which search — were the only ways to reach this variant, and became
    /// false when `run_tm_described_at` arrived: that one attempts exactly the width its caller pinned,
    /// so its `Overflow` says nothing about any other width. A consumer that reports this variant to a
    /// user must therefore name the width it actually ran at rather than `MAX_FIELD_WIDTH`, and must not
    /// suggest a remedy that only holds for the searching case — `redextape-cli`'s `emit_described`
    /// shipped exactly that wrong message once, recommending a different encoding for a program a wider
    /// field would have accepted.
    Overflow,
    /// `lower_tm` REFUSED to build a machine for this program at all. FOUR conditions produce it: an
    /// absurd register file (`lower_tm::MAX_SLOTS`), an absurd `Loc` bank in a call-containing program
    /// (`lower_tm::MAX_FRAME_LOC`), too many `Mul` instructions (`lower_tm::MAX_MUL_INSTRS`, each
    /// O(width²) states under `Binary`), or a machine that exceeds `build::MAX_MACHINE_STATES`.
    ///
    /// THE FOURTH IS NOT LIKE THE OTHER THREE. Those bound a quantity readable off the `Program`, so
    /// `lower_and_size` pre-checks them before lowering. The state count is only known once the
    /// gadgets have been laid out, so it is reported BY the lowering — see `lower_tm_guarded`.
    ///
    /// `MAX_SLOTS` in particular would also make `init_reg` allocate an oversized bank were lowering to
    /// proceed; `MAX_FRAME_LOC` and `MAX_MUL_INSTRS` would instead make `lower_tm` itself build an
    /// oversized machine (the `O(n_loc²)` frame gadgets, the `O(width²)` `Mul` gadgets) — which is
    /// exactly what the fourth condition, `MAX_MACHINE_STATES`, catches after the fact rather than
    /// before. So lowering never proceeds for any of the four: the program never ran a single step.
    ///
    /// Distinct from `HitCap`, which reports a run that started and then hit a resource cap mid-flight
    /// — a program refused here never started. Distinct from `Overflow` too: the shared `search_width`
    /// both entry points drive widens the bank and tries again on `Overflow`, and never on this. A
    /// refusal returns straight out of the search, reporting no width — nothing was fitted.
    ///
    /// **NOT NECESSARILY AT THE FIRST WIDTH, and the fourth cause is what changed that.** The three
    /// pre-checked conditions are properties of the `Program` alone, so they refuse before the width
    /// search begins and would re-refuse identically at every width — which is what made "reported
    /// once, at the first width tried" true while those three were the only causes.
    /// `MAX_MACHINE_STATES` is not such a property: a gadget's state count scales with the field
    /// width (`lower_tm::MAX_MUL_INSTRS`'s doc records `Mul` as O(width²) under `Binary`), so a
    /// program can lay out fine at `MIN_FIELD_WIDTH`, overflow its fields, and exceed the ceiling only
    /// at a wider one. Retrying wider still would be pointless in either case — a refused machine only
    /// grows with width — so `search_width` returns on the first refusal, at whatever width reached it.
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
/// `None` IF THE LAYOUT WAS REFUSED. Three of the four refusals are pre-checked by `lower_and_size`
/// and so never reach here; `MAX_MACHINE_STATES` cannot be pre-checked — it is only known once the
/// gadgets have been built — so this is where it surfaces.
///
/// Returns the machine and the initial tapes it built alongside the outcome. `run_tm_fitted` drops
/// both; `run_tm_described` keeps them, and keeping them is the point — a header whose literal tapes
/// were re-derived from its own `encoding`/`width`/`slots` fields could not disagree with them, so
/// the consistency check over it would prove nothing. This is the ONE place that builds `init` on the
/// `run_tm*` path, which is what makes the check a check. `tm/attribute.rs` builds a second `init` for
/// its own purposes; it seeds BOTH REG and WORK the same way this one does, and a test pins that under
/// both encodings, so the two `init`s cannot drift apart unnoticed.
fn attempt(
    prog: &Program,
    enc: &dyn Encoding,
    n_slots: u32,
    caps: TmCaps,
) -> Option<(TmRun, Machine, Vec<Vec<Symbol>>, u64)> {
    let (machine, overflow) = lower_tm_guarded(prog, enc)?;
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots);
    init[WORK] = enc.init_work();
    let (run, steps) = match simulate_final(&machine, &init, caps) {
        (_, s, TmStatus::Halted, n) if s == overflow => (TmRun::Overflow, n),
        (tapes, _, TmStatus::Halted, n) => (TmRun::Ran { tapes }, n),
        (_, _, TmStatus::HitCap, n) => (TmRun::HitCap, n),
    };
    Some((run, machine, init, steps))
}

/// Lower `core`, then pre-check the THREE of `lower_tm`'s FOUR layout refusals that can be settled
/// before lowering — `MAX_SLOTS` (an absurd register file, which would also drive `init_reg` into a
/// huge or aborting allocation just below), `frame_bank_unrepresentable` (an absurd `Loc` bank in a
/// call-containing program), and `mul_count_unrepresentable` (too many `Mul` instructions, each
/// O(width²) states under `Binary`). The fourth is `MAX_MACHINE_STATES` — see the third paragraph.
///
/// The single place `run_tm_fitted`/`run_tm_at` PRE-CHECK representability, so the two cannot drift
/// from each other or from the guards they mirror — the same reason `frame_bank_unrepresentable` is a
/// shared predicate rather than re-derived at each call site.
///
/// THREE OF THE FOUR REFUSALS, NOT ALL FOUR. `MAX_MACHINE_STATES` cannot be pre-checked: it bounds
/// the machine, and the machine does not exist until the gadgets are built. `attempt` reports it via
/// `lower_tm_guarded`'s `None`. Keeping these three here anyway is deliberate — `MAX_SLOTS` in
/// particular must refuse BEFORE `init_reg` lays out a bank from `n_slots`, which is an allocation
/// the state ceiling would never see.
///
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

/// The field-width ladder and the retry rule, in one definition on the library path.
///
/// Attempts `MIN_FIELD_WIDTH`, doubling, up to `MAX_FIELD_WIDTH`. `at` runs one attempt at one width
/// and answers `None` for the state-ceiling refusal (`MAX_MACHINE_STATES`, knowable only once THIS
/// width's gadgets are built). `overflowed` answers whether an outcome is the overflow guard. Answers
/// the outcome together with the width that produced it, or `None` when an attempt refused — callers
/// map that onto whatever `TooLarge` shape their own signature calls for.
///
/// **THAT REFUSAL IS NOT A CLAIM ABOUT EVERY WIDTH — only about this one and every wider one.** A
/// program can lay out and run at a narrow width, overflow its fields there, and exceed the ceiling
/// only once the search has widened to retry it (`TmRun::TooLarge`'s doc has the mechanism;
/// `guard_counterexamples.rs`'s `a_program_is_admitted_at_narrow_widths_and_refused_only_once_widened`
/// is the witness, admitted at widths 4 and 8 and refused at 16). Widening PAST a refusal is what
/// would be pointless — a refused machine only grows with width — so the search stops at the first
/// one.
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
///
/// **THE THREE `widths()` COPIES IN `tests/` AND `examples/` ARE NOT ROUTED THROUGH THIS AND MUST NOT
/// BE.** They are independent models of this ladder, and two of them carry assertions ABOUT it; making
/// them walk whatever this function says would stop those assertions being able to fail. See the doc on
/// each copy.
fn search_width<T>(mut at: impl FnMut(usize) -> Option<T>, overflowed: impl Fn(&T) -> bool) -> Option<(T, usize)> {
    let mut width = MIN_FIELD_WIDTH;
    loop {
        let got = at(width)?;
        if overflowed(&got) && width < MAX_FIELD_WIDTH {
            width = (width * 2).min(MAX_FIELD_WIDTH);
        } else {
            return Some((got, width));
        }
    }
}

/// Lower, then run at the narrowest field width that fits, reporting that width alongside the outcome.
///
/// The search is `search_width`; see its doc for why only the guard retries. Reaching the ceiling and
/// still overflowing yields `TmRun::Overflow`. An encoding reporting `field_width() == None` is
/// unbounded, so there is exactly one attempt and the reported width is `None`.
pub fn run_tm_fitted(core: &Core, enc: &dyn Encoding, caps: TmCaps) -> (TmRun, Option<usize>) {
    let (prog, sm) = match lower_and_size(core) {
        Ok(p) => p,
        Err(e) => return (e, None),
    };
    let n_slots = sm.n_slots();
    if enc.field_width().is_none() {
        return (attempt(&prog, enc, n_slots, caps).map_or(TmRun::TooLarge, |a| a.0), None);
    }
    // Matched rather than flattened through `map_or` so the state-ceiling refusal (`None` —
    // `MAX_MACHINE_STATES`, only knowable once a width's gadgets are built) can be told apart from
    // every other outcome and report `None` for "the width that was fitted" too, the same as
    // `lower_and_size`'s pre-checked refusal above returns for the other three conditions. `Some(width)`
    // there would claim a width was fitted when nothing was: `TmRun::TooLarge` means the program never
    // ran a single step, at ANY width, so no width is more "the" answer than another — reporting the
    // search's current width would just be exposing where it happened to be standing when the refusal
    // surfaced.
    match search_width(|w| attempt(&prog, &*enc.at_width(w), n_slots, caps), |a| matches!(a.0, TmRun::Overflow)) {
        None => (TmRun::TooLarge, None),
        Some((a, width)) => (a.0, Some(width)),
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
    /// FOR `Overflow` THIS IS THE LAST ATTEMPT'S COUNT. `search_width` above doubles and retries,
    /// so a program that overflows at width 8 and fits at 64 simulates four times; the count reported
    /// belongs to the run whose outcome is reported.
    pub steps: u64,
}

/// One lowering, one machine at `width`, one run, one header. No search.
///
/// The single place either public entry point builds a `DescribedRun`, so the pinned path cannot
/// drift from the fitted one.
fn describe_at(
    prog: &Program,
    n_slots: u32,
    kind: EncodingKind,
    result: Ty,
    caps: TmCaps,
    width: usize,
) -> Option<DescribedRun> {
    let fitted = kind.at(width);
    let (run, machine, init, steps) = attempt(prog, &*fitted, n_slots, caps)?;
    let tapes = init.into_iter().enumerate().collect();
    let header = TmHeader::new(kind, width, n_slots, result, tapes);
    Some(DescribedRun { run, machine, header, steps })
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
/// Shares `search_width` with `run_tm_fitted`, and has no unbounded-encoding branch: `EncodingKind`
/// names only bounded encodings, since an unbounded one has no name to write in a file.
///
/// # Errors
///
/// The error type is `TmRun` itself, not a dedicated error enum, because both failure shapes ARE
/// `TmRun` outcomes that just never reached a configuration to describe: `Err(TmRun::LowerError(_))`
/// if `core` could not be lowered to asm (see `lower_program`'s doc — an unsupported higher-order
/// construct or a too-deep program), and `Err(TmRun::TooLarge)` if `lower_tm` refused to build a
/// machine at all (`MAX_SLOTS`/`MAX_FRAME_LOC`/`MAX_MUL_INSTRS`/`MAX_MACHINE_STATES` — see
/// `TmRun::TooLarge`'s doc). Neither
/// is recoverable by retrying: the caller's only recourse is rewriting `core`. `TmRun::Overflow` and
/// `TmRun::HitCap`, by contrast, are NOT errors here — they are `Ok(DescribedRun)` results, because a
/// run that started (even one that overflowed or hit a cap) still has a configuration to describe.
//
// `result: Ty` is taken by value even though the loop below only ever `.clone()`s it. **TWO
// ALTERNATIVES WERE TRIED AND MEASURED RATHER THAN REASONED ABOUT, AND BOTH ARE WORSE.**
//
// Narrowing this parameter to `&Ty` does NOT silence the lint — it spreads it. `describe_at` would
// then take `&Ty` and clone internally, which leaves this function still flagged AND flags
// `run_tm_described_at` too: two errors where there was one. It would also churn four owning call
// sites outside this function — `emit_tm` in the CLI, `compile` in the WASM session,
// `printed_machine_with_header` in the grammar-check crate, and this crate's own tests and
// examples — for a lint's sake alone.
//
// Probing for the width with a bare `attempt` and building the `DescribedRun` once afterwards DOES
// compile clean with no allow. It pays for that by running `attempt` — the real TM simulation —
// TWICE at the winning width, where this shape runs it once per width plus a `Ty::clone`. Doubling
// simulation cost on the common no-retry path is not a free win in a crate whose own probes record
// an 8.6-million-state machine costing 6.0 GB. The clone is the cheaper of the two.
//
// So the allow is a deliberate trade, not an unexamined one. Anyone reopening it should re-measure
// rather than re-argue: the reason it stands is a cost, and costs move.
#[allow(clippy::needless_pass_by_value)]
pub fn run_tm_described(core: &Core, kind: EncodingKind, result: Ty, caps: TmCaps) -> Result<DescribedRun, TmRun> {
    let (prog, sm) = lower_and_size(core)?;
    let n_slots = sm.n_slots();
    search_width(|w| describe_at(&prog, n_slots, kind, result.clone(), caps, w), |d| matches!(d.run, TmRun::Overflow))
        .map(|(d, _)| d)
        .ok_or(TmRun::TooLarge)
}

/// `run_tm_described` at a width the caller chose, with the fitting search skipped.
///
/// **THIS CAN REFUSE A PROGRAM THE SEARCH WOULD HAVE ACCEPTED, AND THAT IS THE POINT OF ASKING FOR
/// IT.** `run_tm_described` starts at `MIN_FIELD_WIDTH` and doubles until the values fit; pinning a
/// width means the values fit there or they do not.
///
/// **`TmRun::Overflow` COMES BACK AS `Ok`, exactly as it does from `run_tm_described`** — a run that
/// started still has a configuration to describe, and the caller decides what an overflow means. It
/// is `emit`'s existing "a value does not fit this encoding's widest tape field" refusal that reads
/// it, unchanged by this function existing.
///
/// **THE WIDTH IS CHECKED BEFORE ANY WORK, AND THAT CHECK IS WHAT `run_tm_described` GETS FOR FREE
/// FROM ITS SEARCH.** The search only ever reaches `MIN_FIELD_WIDTH..=MAX_FIELD_WIDTH`; taking the
/// width from the caller removed that bound and restored nothing, so a width the encodings cannot
/// build a machine at reached `Unary::init_reg` and panicked on a capacity overflow — a library path
/// that panics, which the workspace manifest forbids outright.
///
/// # Errors
///
/// `Err(TmRun::TooLarge)` when `width` is outside `MIN_FIELD_WIDTH..=MAX_FIELD_WIDTH`, checked first
/// and before `core` is even lowered: no machine can be built at such a width, which is exactly what
/// that variant means. Then the same two as `run_tm_described`: `Err(TmRun::LowerError(_))` when
/// `core` has no asm lowering, and `Err(TmRun::TooLarge)` when `lower_tm` refuses to build a machine
/// at all.
pub fn run_tm_described_at(
    core: &Core,
    kind: EncodingKind,
    result: Ty,
    caps: TmCaps,
    width: usize,
) -> Result<DescribedRun, TmRun> {
    if !(MIN_FIELD_WIDTH..=MAX_FIELD_WIDTH).contains(&width) {
        return Err(TmRun::TooLarge);
    }
    let (prog, sm) = lower_and_size(core)?;
    describe_at(&prog, sm.n_slots(), kind, result, caps, width).ok_or(TmRun::TooLarge)
}

/// Lower then simulate ONCE, at `enc`'s own width, with no search. What the step-count goldens and the
/// attribution survey use, so their numbers stay comparable across slices even as auto-fit changes what
/// a program costs end to end.
pub fn run_tm_at(core: &Core, enc: &dyn Encoding, caps: TmCaps) -> TmRun {
    let (prog, sm) = match lower_and_size(core) {
        Ok(p) => p,
        Err(e) => return e,
    };
    attempt(&prog, enc, sm.n_slots(), caps).map_or(TmRun::TooLarge, |a| a.0)
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

    /// A program past the state ceiling must be reported as `TooLarge` and NEVER as `Ran`/`HitCap` —
    /// asserted through `attempt`, not just `lower_tm_guarded`.
    ///
    /// THIS IS THE WHOLE REASON THE REFUSAL IS PLUMBED. `lower_tm_all` answers a refusal with a
    /// degenerate machine that halts immediately; if that reached `attempt` unlabelled it would
    /// simulate, halt at a state that is not the overflow guard, and come back as `Ran` over tapes
    /// that decode to nothing — which is exactly the defect `lower_and_size`'s doc records having
    /// fixed for `MAX_SLOTS` and `MAX_FRAME_LOC`. Asserting only `lower_tm_guarded(..).is_none()`
    /// (as this test used to, identically to `guard_counterexamples.rs`'s
    /// `a_code_stream_longer_than_the_ceiling_is_refused`) does not exercise that: it would stay green
    /// even if `attempt` stopped checking the `Option` and simulated the degenerate machine anyway.
    ///
    /// `run_tm`/`run_tm_at`/`run_tm_fitted`/`run_tm_described` all take `&Core`, not `&Program`, and
    /// there is no fast route to a `Core` this large: a million-plus asm instructions from real source
    /// would need only a ~2-3 MB file (`code.len()` is a lower bound on the state count, and
    /// `state_cost_probe.rs`'s generators run ~2-3 source bytes per instruction) — but
    /// `parser::MAX_TOKENS` (100,000) caps `code.len()` at ~50,000 instructions, even for the
    /// depth-unbounded balanced-tree shape that spends its whole token budget on instructions, a
    /// ~950,000-instruction gap below `MAX_MACHINE_STATES` — the front door cannot reach this input at
    /// all, by design (see `state_cost_probe.rs`'s section A/C/F). `attempt` is the actual entry point
    /// every one of those four functions maps its `None` through — the one-line mapping below is copied
    /// verbatim from `run_tm_at` — so calling it directly here is the cheapest REAL exercise of the same
    /// classification those four callers depend on, not a substitute for it.
    ///
    /// Built as asm rather than compiled from source: `MAX_MACHINE_STATES` instructions of source would
    /// be a ~2-3 MB file that the front door refuses to parse anyway (see above), and `code.len()` alone
    /// is a lower bound on the state count, so this trips `lower_tm_all`'s cheap pre-check, allocating
    /// only the two scaffolding states (`halt`, `overflow`) before refusing.
    #[test]
    fn a_program_past_the_state_ceiling_is_too_large_not_ran() {
        use crate::tm::asm::{Instr, Program};
        use crate::tm::build::MAX_MACHINE_STATES;

        let prog = Program { code: vec![Instr::Halt; MAX_MACHINE_STATES + 1], labels: Vec::new() };
        assert!(
            lower_tm_guarded(&prog, &Unary::default()).is_none(),
            "a code stream longer than the ceiling cannot fit and must be refused, not laid out"
        );

        // NOT the end-to-end assertion: `attempt` is private, so this exercises the classification
        // `run_tm_at`/`run_tm_fitted`/`run_tm_described` all wrap, not the public entry points
        // themselves (see the doc comment above for why that is still a real exercise, not a
        // substitute). The genuinely end-to-end assertion — that `TooLarge` reaches a caller through
        // the public API — is `guard_counterexamples.rs`'s slow-tier
        // `a_program_past_the_ceiling_reaches_the_caller_as_too_large`. `.map_or(TmRun::TooLarge, |a|
        // a.0)` below is `run_tm_at`'s own mapping, reused rather than reimplemented so this cannot
        // silently test a mapping production does not use.
        let n_slots = n_slots_of(&prog);
        let run = attempt(&prog, &Unary::default(), n_slots, TM_DEFAULT_CAPS).map_or(TmRun::TooLarge, |a| a.0);
        assert!(matches!(run, TmRun::TooLarge), "a program past the ceiling must report TooLarge, got {run:?}");
    }

    /// A program the ceiling does NOT refuse still runs, and still gives the reference answer. The
    /// other half of every guard in this tree: refusing correctly is worthless if it also refuses
    /// what it should admit.
    #[test]
    fn an_ordinary_program_still_runs_under_the_ceiling() {
        let core = core_of("let x = 40; x + 2");
        let described = run_tm_described(&core, EncodingKind::Unary, Ty::Nat, TM_DEFAULT_CAPS)
            .expect("an ordinary program must not be refused");
        assert!(matches!(described.run, TmRun::Ran { .. }), "got {:?}", described.run);
    }

    /// The fitted and pinned paths agree when the pinned width is the one fitting would have chosen.
    ///
    /// This is the test that catches `describe_at` being wired into only one of the two entry
    /// points, or the two disagreeing about how a header is built.
    #[test]
    fn the_pinned_path_agrees_with_the_fitted_one_at_the_width_fitting_chose() {
        let core = desugar(&crate::parser::parse("1 + 2").0.unwrap());
        let ty = crate::ty::Ty::Nat;
        let fitted = run_tm_described(&core, EncodingKind::Unary, ty.clone(), TM_DEFAULT_CAPS).unwrap();
        let width = fitted.header.width;
        let pinned = run_tm_described_at(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS, width).unwrap();
        assert_eq!(pinned.header.width, fitted.header.width);
        assert_eq!(pinned.steps, fitted.steps, "the same machine must take the same number of steps");
    }

    /// A width too narrow for the program's values comes back as `Ok` carrying `Overflow`, NOT as an
    /// `Err`. `emit`'s refusal reads that variant, so turning it into an error here would change a
    /// user-visible message in a different crate.
    #[test]
    fn a_pinned_width_that_is_too_narrow_returns_ok_with_overflow() {
        // A value needing more than MIN_FIELD_WIDTH cells under unary, pinned at MIN_FIELD_WIDTH.
        let core = desugar(&crate::parser::parse("40 + 2").0.unwrap());
        let got = run_tm_described_at(&core, EncodingKind::Unary, crate::ty::Ty::Nat, TM_DEFAULT_CAPS, MIN_FIELD_WIDTH)
            .unwrap();
        assert!(matches!(got.run, TmRun::Overflow), "got {:?}", got.run);
        assert_eq!(got.header.width, MIN_FIELD_WIDTH, "the header records the width it was pinned to");
    }

    /// **A WIDTH OUTSIDE THE ENCODINGS' RANGE IS A `TooLarge`, NEVER A PANIC.** `usize::MAX` reached
    /// `Unary::init_reg` and aborted the process on a `capacity overflow` — the workspace manifest's
    /// "no library path may panic" rule, broken by an entry point that took the width from a caller
    /// and never bounded it. Both directions are pinned: one below `MIN_FIELD_WIDTH`, one above
    /// `MAX_FIELD_WIDTH`, and `usize::MAX` because that is the value that actually panicked.
    #[test]
    fn a_width_outside_the_encodings_range_is_refused_rather_than_panicking() {
        let core = desugar(&crate::parser::parse("1 + 2").0.unwrap());
        for width in [0, MIN_FIELD_WIDTH - 1, MAX_FIELD_WIDTH + 1, usize::MAX] {
            let got = run_tm_described_at(&core, EncodingKind::Unary, crate::ty::Ty::Nat, TM_DEFAULT_CAPS, width);
            assert!(matches!(got, Err(TmRun::TooLarge)), "width {width} must be refused, got {got:?}");
        }
    }

    /// And both bounds themselves are still admitted, so the guard above is not an off-by-one that
    /// refuses the widths the search itself uses.
    #[test]
    fn the_pinned_width_bounds_themselves_are_accepted() {
        let core = desugar(&crate::parser::parse("1 + 2").0.unwrap());
        for width in [MIN_FIELD_WIDTH, MAX_FIELD_WIDTH] {
            let got = run_tm_described_at(&core, EncodingKind::Unary, crate::ty::Ty::Nat, TM_DEFAULT_CAPS, width)
                .unwrap_or_else(|e| panic!("width {width} must be accepted, got {e:?}"));
            assert_eq!(got.header.width, width);
        }
    }

    /// The same program the pinned narrow width overflows on is accepted by the search, which is the
    /// difference the flag exists to express.
    #[test]
    fn the_search_accepts_what_a_narrow_pin_refuses() {
        let core = desugar(&crate::parser::parse("40 + 2").0.unwrap());
        let fitted = run_tm_described(&core, EncodingKind::Unary, crate::ty::Ty::Nat, TM_DEFAULT_CAPS).unwrap();
        assert!(!matches!(fitted.run, TmRun::Overflow), "the search must widen past the overflow");
        assert!(fitted.header.width > MIN_FIELD_WIDTH, "and must have actually widened");
    }

    /// THE PROPERTY THE ROADMAP FILED, PINNED END TO END THROUGH BOTH PUBLIC ENTRY POINTS RATHER THAN
    /// THROUGH THE HELPER THEY SHARE. `run_tm_fitted` and `run_tm_described` ran their own copy of the
    /// `MIN_FIELD_WIDTH`/doubling/`Overflow` search for a year and agreed by inspection; folding them
    /// onto one helper removes that axis, and this asserts what the fold is FOR. Written through the
    /// public functions on purpose: a divergence in how each one CALLS the helper is invisible to a
    /// test of the helper itself.
    ///
    /// The corpus is chosen so the search does real work. `1 + 2` fits at `MIN_FIELD_WIDTH` and never
    /// retries; `40 + 2` and `1 + 2 * 3` must widen; `head(nil)` reaches a cap rather than the overflow
    /// guard, so it exercises the early return that must NOT retry.
    #[test]
    fn the_two_entry_points_fit_the_same_width() {
        for src in ["1 + 2", "40 + 2", "1 + 2 * 3", "sum(4)", "head(nil)"] {
            let core = core_of(src);
            for (name, kind, enc) in [
                ("unary", EncodingKind::Unary, Box::new(Unary::default()) as Box<dyn Encoding>),
                ("binary", EncodingKind::Binary, Box::new(Binary::default()) as Box<dyn Encoding>),
            ] {
                let caps = TmCaps { steps: 50_000, cells: 50_000 };
                let (_, fitted) = run_tm_fitted(&core, &*enc, caps);
                let described = run_tm_described(&core, kind, crate::ty::Ty::Nat, caps);
                match (fitted, described) {
                    (Some(w), Ok(d)) => assert_eq!(w, d.header.width, "`{src}` under {name}"),
                    (None, Err(_)) => {}
                    (f, d) => panic!(
                        "`{src}` under {name}: fitted said {f:?}, described said {:?}",
                        d.map(|d| d.header.width)
                    ),
                }
            }
        }
    }
}
