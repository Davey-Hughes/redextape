//! Final tapes -> `Value`, type-directed like the asm/lambda decoders: the reference value supplies
//! the type witness (a bare tape is ambiguous). Nat/Bool are decoded here; Nil/Cons (heap-pointer
//! following) arrive with the HEAP tape in Part 2b-2-iii. `expected` is used ONLY for its shape, so a
//! machine that computed the wrong value decodes to a different `Value` (or `None`), still failing the
//! oracle.

use crate::tm::build::REG;
use crate::tm::encoding::Encoding;
use crate::tm::sim::Tape;
use crate::value::Value;

/// Decode the machine's final `tapes` to a `Value`, guided by `expected`'s shape. The result word is
/// REG slot 0 (`Rr`). Returns `None` when the tape shape does not match the expected type.
pub fn decode_tape(tapes: &[Tape], expected: &Value, enc: &dyn Encoding) -> Option<Value> {
    let reg = tapes.get(REG)?.snapshot().0;
    match expected {
        Value::Nat(_) => enc.decode_nat(&reg, 0).map(Value::Nat),
        Value::Bool(_) => match enc.decode_nat(&reg, 0)? {
            0 => Some(Value::Bool(false)),
            1 => Some(Value::Bool(true)),
            _ => None,
        },
        // Heap-shaped results need the HEAP tape follower (Part 2b-2-iii).
        Value::Nil | Value::Cons(..) => None,
        Value::Unit | Value::Closure { .. } | Value::Builtin(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::BinOp;
    use crate::tm::asm::{Instr, Program, Reg};
    use crate::tm::build::TAPES;
    use crate::tm::encoding::Unary;
    use crate::tm::lower_tm::{SlotMap, lower_tm};
    use crate::tm::sim::{DEFAULT_CAPS as CAPS, simulate};

    fn run_to_tapes(prog: &Program) -> Vec<Tape> {
        let enc = Unary;
        let m = lower_tm(prog, &enc);
        let sm = SlotMap::of(prog);
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(sm.n_slots());
        simulate(&m, &init, CAPS).0
    }

    #[test]
    fn decodes_nat_by_expected_shape() {
        // rr = 2 + 3 = 5
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 2),
                Instr::Li(Reg::Loc(1), 3),
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        let tapes = run_to_tapes(&prog);
        assert_eq!(decode_tape(&tapes, &Value::Nat(0), &Unary), Some(Value::Nat(5)));
    }

    #[test]
    fn decodes_bool_and_catches_a_wrong_value() {
        // rr = (2 == 2) = 1  -> Bool(true).
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 2),
                Instr::Li(Reg::Loc(1), 2),
                Instr::Bin(BinOp::Eq, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        let tapes = run_to_tapes(&prog);
        assert_eq!(decode_tape(&tapes, &Value::Bool(false), &Unary), Some(Value::Bool(true)));
        // Same tape, a Nat witness: still decodes (to Nat(1)) — but as a DIFFERENT value, which is how
        // decode catches a machine that computed the wrong thing under a given type.
        assert_eq!(decode_tape(&tapes, &Value::Nat(9), &Unary), Some(Value::Nat(1)));
    }

    #[test]
    fn non_first_class_and_heap_shapes_decode_to_none() {
        let prog = Program { code: vec![Instr::Halt], labels: vec![] };
        let tapes = run_to_tapes(&prog);
        assert_eq!(decode_tape(&tapes, &Value::Unit, &Unary), None);
        assert_eq!(decode_tape(&tapes, &Value::Nil, &Unary), None); // until 2b-2-iii
    }
}
