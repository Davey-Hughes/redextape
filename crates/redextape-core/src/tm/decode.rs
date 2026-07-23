//! Final tapes -> `Value`, type-directed like the asm/lambda decoders: the reference value supplies
//! the type witness (a bare tape is ambiguous). Nat/Bool are decoded directly from the result word;
//! Nil/Cons are decoded by parsing the HEAP tape into cons cells and following the pointer chain from
//! the result word, mirroring `asm.rs`'s `decode_word`. `expected` is used ONLY for its shape, so a
//! machine that computed the wrong value decodes to a different `Value` (or `None`), still failing the
//! oracle.

use std::rc::Rc;

use crate::tm::build::{HEAP, REG};
use crate::tm::encoding::{Encoding, parse_heap_cells};
use crate::tm::sim::Tape;
use crate::value::Value;

/// Decode the machine's final `tapes` to a `Value`, guided by `expected`'s SHAPE (never its contents).
/// The result word is REG slot 0 (`Rr`): a Nat/Bool value, or a list pointer into the HEAP.
pub fn decode_tape(tapes: &[Tape], expected: &Value, enc: &dyn Encoding) -> Option<Value> {
    let reg = tapes.get(REG)?.snapshot().0;
    let heap = parse_heap_cells(&tapes.get(HEAP)?.snapshot().0);
    let word = enc.decode_nat(&reg, 0)?;
    decode_word(word, &heap, expected)
}

/// Type-directed decode of a word (Nat/Bool value or list pointer), guided by `expected`'s shape.
/// Mirrors `asm.rs::decode_word`. Terminates by STRUCTURAL RECURSION on `expected` (a finite reference
/// `Value`), so it halts regardless of heap cycles; acyclicity of the compiled heap (a cons cell's tail
/// points only at an EARLIER cell) is what makes the RESULT correct, not what makes decoding halt.
fn decode_word(word: u64, heap: &[(u64, u64)], expected: &Value) -> Option<Value> {
    match expected {
        Value::Nat(_) => Some(Value::Nat(word)),
        Value::Bool(_) => match word {
            0 => Some(Value::Bool(false)),
            1 => Some(Value::Bool(true)),
            _ => None,
        },
        Value::Nil => (word == 0).then_some(Value::Nil),
        Value::Cons(eh, et) => {
            if word == 0 {
                return None;
            }
            let &(h, t) = heap.get((word - 1) as usize)?;
            let head = decode_word(h, heap, eh)?;
            let tail = decode_word(t, heap, et)?;
            Some(Value::Cons(Rc::new(head), Rc::new(tail)))
        }
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
    fn non_first_class_shapes_decode_to_none() {
        let prog = Program { code: vec![Instr::Halt], labels: vec![] };
        let tapes = run_to_tapes(&prog);
        assert_eq!(decode_tape(&tapes, &Value::Unit, &Unary), None);
    }

    #[test]
    fn decodes_a_constructed_list() {
        // Build [1, 2] on the TM: nil; cons(2, nil)->p1; cons(1, p1)->rr. Decode guided by a list shape.
        let prog = Program {
            code: vec![
                Instr::Nil(Reg::Loc(0)),
                Instr::Li(Reg::Loc(1), 2),
                Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(0)), // cons(2, nil)
                Instr::Li(Reg::Loc(3), 1),
                Instr::Cons(Reg::Rr, Reg::Loc(3), Reg::Loc(2)), // cons(1, p1) -> rr
                Instr::Halt,
            ],
            labels: vec![],
        };
        let tapes = run_to_tapes(&prog);
        assert_eq!(decode_tape(&tapes, &Value::list_of_nats(&[1, 2]), &Unary), Some(Value::list_of_nats(&[1, 2])));
    }

    #[test]
    fn decodes_nil_result() {
        let prog = Program { code: vec![Instr::Nil(Reg::Rr), Instr::Halt], labels: vec![] };
        let tapes = run_to_tapes(&prog);
        assert_eq!(decode_tape(&tapes, &Value::Nil, &Unary), Some(Value::Nil));
        // A Cons witness over a nil result decodes to None (pointer 0 is not a cons).
        assert_eq!(decode_tape(&tapes, &Value::list_of_nats(&[1]), &Unary), None);
    }
}
