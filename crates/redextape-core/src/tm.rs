//! The TM backend: Core AST -> register-assembly -> multi-tape Turing machine -> `Value`, plus a
//! round-tripping TM text form. See `docs/superpowers/specs/2026-07-22-tm-backend-design.md`.
//!
//! Part 1 (this slice): the register-assembly IR (`asm`) and Core -> asm lowering (`lower_asm`),
//! delivering the intermediate oracle `reference == asm-interpreter`.

pub mod asm;
pub mod build;
pub mod encoding;
pub mod lower_asm;
pub mod machine;
pub mod sim;
pub mod syntax;

pub use asm::{AsmOutcome, AsmRun, Caps, DEFAULT_CAPS, Instr, Program, Reg, decode_asm, print_asm, run_asm};
pub use build::{Builder, FIELD_WIDTH, HEAP, MARK, REG, RuleSpec, SEP, STACK, Slot, TAPES, WORK};
pub use encoding::{Encoding, Unary};
pub use lower_asm::{LowerError, lower_asm};
pub use machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
pub use sim::{
    Caps as TmCaps, DEFAULT_CAPS as TM_DEFAULT_CAPS, Status as TmStatus, Step, Tape, Trace, simulate, simulate_trace,
};
pub use syntax::{parse_tm, print_tm};
