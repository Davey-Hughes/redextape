//! The TM backend: Core AST -> register-assembly -> multi-tape Turing machine -> `Value`, plus a
//! round-tripping TM text form. See `docs/superpowers/specs/2026-07-22-tm-backend-design.md`.
//!
//! Part 1 (this slice): the register-assembly IR (`asm`) and Core -> asm lowering (`lower_asm`),
//! delivering the intermediate oracle `reference == asm-interpreter`.

pub mod asm;
pub mod build;
pub mod decode;
pub mod encoding;
pub mod lower_asm;
pub mod lower_tm;
pub mod machine;
pub mod sim;
pub mod syntax;

pub use asm::{AsmOutcome, AsmRun, Caps, DEFAULT_CAPS, Instr, Program, Reg, decode_asm, print_asm, run_asm};
pub use build::{Builder, FIELD_WIDTH, HEAP, MARK, REG, RuleSpec, SEP, STACK, Slot, TAPES, WORK};
pub use decode::decode_tape;
pub use encoding::{Encoding, Unary};
pub use lower_asm::{LowerError, lower_asm};
pub use lower_tm::lower_tm;
pub use machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
pub use sim::{
    Caps as TmCaps, DEFAULT_CAPS as TM_DEFAULT_CAPS, Status as TmStatus, Step, Tape, Trace, simulate, simulate_trace,
};
pub use syntax::{parse_tm, print_tm};

use crate::core::Core;
use crate::tm::lower_tm::SlotMap;
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
    /// The program could not be lowered to asm (e.g. a higher-order use).
    LowerError(LowerError),
}

/// Lower (`lower_asm` -> `lower_tm`) then simulate. The convenience entry point for the oracle and
/// later plans; `enc` selects the numeric encoding (the v1 `Unary`). Panic-free and bounded by `caps`.
pub fn run_tm(core: &Core, enc: &dyn Encoding, caps: TmCaps) -> TmRun {
    let prog = match lower_asm(core) {
        Ok(p) => p,
        Err(e) => return TmRun::LowerError(e),
    };
    let machine = lower_tm(&prog, enc);
    let sm = SlotMap::of(&prog);
    // Mirrors `lower_tm`'s own guard: an absurd register index would drive `init_reg` into a huge or
    // aborting allocation. An unrepresentable program is a resource-cap outcome, not a panic.
    if sm.n_slots() > crate::tm::lower_tm::MAX_SLOTS {
        return TmRun::HitCap;
    }
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(sm.n_slots());
    match simulate(&machine, &init, caps) {
        (tapes, TmStatus::Halted) => TmRun::Ran { tapes },
        (_tapes, TmStatus::HitCap) => TmRun::HitCap,
    }
}

#[cfg(test)]
mod run_tm_tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::parser::parse;
    use crate::value::Value;

    fn tm_value(src: &str) -> Value {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let expected = crate::run(src).expect("reference run failed");
        match run_tm(&core, &Unary, TM_DEFAULT_CAPS) {
            TmRun::Ran { tapes } => decode_tape(&tapes, &expected, &Unary).expect("decode failed"),
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
}
