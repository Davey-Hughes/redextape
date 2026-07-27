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
pub mod lower_asm;
pub mod lower_tm;
pub mod machine;
pub mod sim;
pub mod syntax;

pub use asm::{
    AsmOutcome, AsmRun, Caps, DEFAULT_CAPS, Instr, Program, Reg, decode_asm, decode_asm_ty, print_asm, run_asm,
};
pub use attribute::{Attribution, StepBucket, attribute, attribute_at, attribute_steps};
pub use build::{
    AT, BOX, Builder, HEAP, MARK, MAX_FIELD_WIDTH, MIN_FIELD_WIDTH, REG, RuleSpec, SEP, STACK, Slot, TAPES, WORK,
};
pub use decode::decode_tape;
pub use defunc::{defunc, defunc_mapped};
pub use encoding::{Encoding, Unary};
pub use lower_asm::{LowerError, lower_asm, lower_asm_mapped};
pub use lower_tm::{lower_tm, lower_tm_guarded, lower_tm_mapped, n_slots_of};
pub use machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
pub use sim::{
    Caps as TmCaps, DEFAULT_CAPS as TM_DEFAULT_CAPS, Status as TmStatus, Step, Tape, Trace, Watcher, simulate,
    simulate_counts, simulate_final, simulate_trace, simulate_watched,
};
pub use syntax::{parse_tm, print_tm};

use crate::core::Core;
// `Encoding`, `lower_asm`, `LowerError`, `lower_tm`, `simulate`, `Tape`, `TmCaps`, `TmStatus`, `REG`,
// and `TAPES` are all already in scope via this module's existing `pub use` re-exports.

/// The outcome of lowering + simulating a program through the TM backend. Decoding to a `Value` is a
/// separate, type-directed step (`decode_tape`), because bare tapes are ambiguous. Mirrors `LambdaRun`.
#[derive(Clone, Debug)]
pub enum TmRun {
    /// Simulated to a halt. Decode the final tapes against an expected value's shape (`decode_tape`).
    Ran { tapes: Vec<Tape> },
    /// The simulation hit a step / tape-cells cap.
    HitCap,
    /// A value did not fit the encoding's field width at ANY width up to `MAX_FIELD_WIDTH` — the
    /// program is not representable on this tape. Distinct from `HitCap`: nothing diverged, the tape is
    /// simply too narrow, which is a property of the encoding rather than of the program's semantics.
    Overflow,
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
pub fn run_tm(core: &Core, enc: &dyn Encoding, caps: TmCaps) -> TmRun {
    run_tm_fitted(core, enc, caps).0
}

/// One attempt at `enc`'s own width: lower, lay out the bank, simulate, and classify the halt.
fn attempt(prog: &Program, enc: &dyn Encoding, n_slots: u32, caps: TmCaps) -> TmRun {
    let (machine, overflow) = lower_tm_guarded(prog, enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots);
    match simulate_final(&machine, &init, caps) {
        (_, s, TmStatus::Halted) if s == overflow => TmRun::Overflow,
        (tapes, _, TmStatus::Halted) => TmRun::Ran { tapes },
        (_, _, TmStatus::HitCap) => TmRun::HitCap,
    }
}

/// Lower, then run at the narrowest field width that fits, reporting that width alongside the outcome.
///
/// Attempts `MIN_FIELD_WIDTH`, doubling, up to `MAX_FIELD_WIDTH`; an attempt that halts in the overflow
/// guard is retried one width wider, and anything else is the answer. Reaching the ceiling and still
/// overflowing yields `TmRun::Overflow`. An encoding reporting `field_width() == None` is unbounded, so
/// there is exactly one attempt and the reported width is `None`.
///
/// Only the GUARD triggers a retry, never `HitCap` — a nil/dangling dereference spins to a cap at every
/// width, so retrying on caps would burn the full step budget five times over and still report the same
/// thing. That distinction is the reason the guard is a state id rather than a spin (see
/// `Builder::overflow`).
///
/// The retries are cheap BECAUSE of the guard: a too-narrow attempt runs the correct prefix of the
/// program and then halts at its first overflowing store, so it costs less than the successful attempt
/// that follows it. Without the guard an under-sized run corrupts the bank and frequently runs away to
/// the full step cap instead, which is what made the pre-guard behaviour expensive as well as wrong.
pub fn run_tm_fitted(core: &Core, enc: &dyn Encoding, caps: TmCaps) -> (TmRun, Option<usize>) {
    let prog = match lower_program(core) {
        Ok(p) => p,
        Err(e) => return (TmRun::LowerError(e), None),
    };
    let n_slots = lower_tm::n_slots_of(&prog);
    // Mirrors `lower_tm`'s own guard: an absurd register index would drive `init_reg` into a huge or
    // aborting allocation. An unrepresentable program is a resource-cap outcome, not a panic.
    if n_slots > crate::tm::lower_tm::MAX_SLOTS {
        return (TmRun::HitCap, None);
    }
    if enc.field_width().is_none() {
        return (attempt(&prog, enc, n_slots, caps), None);
    }
    let mut width = MIN_FIELD_WIDTH;
    loop {
        let fitted = enc.at_width(width);
        match attempt(&prog, &*fitted, n_slots, caps) {
            TmRun::Overflow if width < MAX_FIELD_WIDTH => width = (width * 2).min(MAX_FIELD_WIDTH),
            other => return (other, Some(width)),
        }
    }
}

/// Lower then simulate ONCE, at `enc`'s own width, with no search. What the step-count goldens and the
/// attribution survey use, so their numbers stay comparable across slices even as auto-fit changes what
/// a program costs end to end.
pub fn run_tm_at(core: &Core, enc: &dyn Encoding, caps: TmCaps) -> TmRun {
    let prog = match lower_program(core) {
        Ok(p) => p,
        Err(e) => return TmRun::LowerError(e),
    };
    let n_slots = lower_tm::n_slots_of(&prog);
    if n_slots > crate::tm::lower_tm::MAX_SLOTS {
        return TmRun::HitCap;
    }
    attempt(&prog, enc, n_slots, caps)
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

    /// A value the tape cannot represent at ANY width up to the ceiling is now REPORTED. Before the
    /// guard this silently miscompiled: the bank was corrupted and a wrong answer came back.
    #[test]
    fn a_value_beyond_the_ceiling_reports_overflow() {
        assert!(matches!(run_tm(&core_of("100 * 100"), &Unary::default(), TM_DEFAULT_CAPS), TmRun::Overflow));
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
                    TmRun::LowerError(_) | TmRun::HitCap | TmRun::Overflow => {}
                    TmRun::Ran { .. } => panic!("expected LowerError or HitCap for a 40k-deep list literal"),
                }
            })
            .unwrap()
            .join()
            .unwrap();
    }
}
