//! Final tapes -> `Value`, type-directed like the rxm/lambda decoders: the reference value supplies
//! the type witness (a bare tape is ambiguous). Nat/Bool are decoded directly from the result word;
//! Nil/Cons are decoded by parsing the HEAP tape into cons cells and following the pointer chain from
//! the result word, by calling `rxm.rs`'s `decode_word`. A function's word must point at a heap cell,
//! which is not followed, so every function decodes to the same opaque `Value::Function`. Otherwise
//! `expected` is used ONLY for its shape, so a machine that computed the wrong value decodes to a
//! different `Value` (or `None`), still failing the oracle.

use std::collections::BTreeSet;

use crate::tm::build::{AT, HEAP, REG};
use crate::tm::encoding::Encoding;
use crate::tm::machine::BLANK;
use crate::tm::rxm::{DecodeFailure, MAX_DECODE_NODES, decode_word_ty};
use crate::tm::sim::Tape;
use crate::ty::Ty;
use crate::value::{Functions, Value};

/// The half of decoding that does not depend on WHAT is being decoded: the result word out of REG
/// slot 0 (`Rr`) and the cons cells out of HEAP, both read through `enc`. The two decoders below
/// share this and differ only in what they do with the pair.
fn read_result(tapes: &[Tape], enc: &dyn Encoding) -> Option<(u64, Vec<(u64, u64)>)> {
    let reg = tapes.get(REG)?.snapshot().0;
    let heap = enc.parse_heap_cells(&tapes.get(HEAP)?.snapshot().0);
    let word = enc.decode_nat(&reg, 0)?;
    Some((word, heap))
}

/// The HEAP cells a list result reaches, as `from..to` runs of the HEAP tape's `Tape::snapshot` indices,
/// ascending, adjacent cells merged into one run: the list results design lights them. `ty` says which
/// heads are lists, as it does for `decode_tape_ty`: a cell's tail is followed always, its head only under a
/// list of lists. Empty for a result that is not a list, for `nil`, and for tapes `enc` cannot read.
///
/// Cell `k` starts at the HEAP's `k`th `@`, as both encodings' `parse_heap_cells` read it, and ends at the
/// next `@` or blank. A set of the cells visited, so a cyclic heap from a file ends the walk.
#[must_use]
pub fn result_heap_runs(tapes: &[Tape], ty: &Ty, enc: &dyn Encoding) -> Vec<(usize, usize)> {
    let (Ty::List(_), Some((word, conses)), Some(tape)) = (ty, read_result(tapes, enc), tapes.get(HEAP)) else {
        return Vec::new();
    };
    let mut reached = BTreeSet::new();
    let mut todo = vec![(word, ty)];
    while let Some((w, ty)) = todo.pop() {
        let (Ty::List(elem), Some(i)) = (ty, w.checked_sub(1).and_then(|i| usize::try_from(i).ok())) else { continue };
        let Some(&(head, tail)) = conses.get(i) else { continue };
        if reached.insert(i) {
            todo.push((tail, ty));
            todo.push((head, elem));
        }
    }
    let cells = tape.snapshot().0;
    let starts: Vec<usize> = cells.iter().enumerate().filter(|&(_, &c)| c == AT).map(|(at, _)| at).collect();
    let mut runs: Vec<(usize, usize)> = Vec::new();
    for from in reached.into_iter().filter_map(|i| starts.get(i).copied()) {
        let to = cells[from + 1..].iter().position(|&c| c == AT || c == BLANK).map_or(cells.len(), |n| from + 1 + n);
        match runs.last_mut() {
            Some(run) if run.1 == from => run.1 = to,
            _ => runs.push((from, to)),
        }
    }
    runs
}

/// Decode the machine's final `tapes` to a `Value`, guided by `expected`'s SHAPE (never its contents).
/// The result word is REG slot 0 (`Rr`): a Nat/Bool value, or a list or function pointer into the HEAP.
///
/// `decode_tape_reason`'s `.ok()`, for the callers that only need to know THAT it failed.
#[must_use]
pub fn decode_tape(tapes: &[Tape], expected: &Value, enc: &dyn Encoding) -> Option<Value> {
    decode_tape_reason(tapes, expected, enc).ok()
}

/// `decode_tape`, keeping WHY a failed decode failed. `read_result` failing — a missing REG/HEAP tape,
/// or a REG field this `enc` cannot parse as a Nat — is `DecodeFailure::Mismatch`, exactly as in
/// `decode_tape_ty_reason`: a claim about the DATA, never about the budget, which is not allocated yet.
///
/// # Errors
///
/// See `DecodeFailure`'s doc for the two causes.
pub fn decode_tape_reason(tapes: &[Tape], expected: &Value, enc: &dyn Encoding) -> Result<Value, DecodeFailure> {
    let Some((word, heap)) = read_result(tapes, enc) else { return Err(DecodeFailure::Mismatch) };
    let mut budget = MAX_DECODE_NODES;
    crate::tm::rxm::decode_word(word, &heap, expected, &mut budget)
}

/// Decode the final `tapes` against a TYPE rather than a `Value` shape witness — what a reader holding
/// only a `.tm` file has, since a file records its `result` type but has no reference run.
///
/// A SIBLING of `decode_tape`, not a replacement for it (spec D6). They share the tape read above and nothing else,
/// because they disagree on purpose on a nil result under a `Cons` witness, on `Unit`, and on a function, which
/// `decode_tape` reads and this one refuses (`decode_tape_ty_opaque` reads one too). `decode_tape`'s nil strictness
/// is what makes the oracle catch a machine that returned a SHORTER list, so it cannot be expressed over this one —
/// and the reverse needs a `Value -> Ty` function that is partial, since `Value::Nil` carries no element type.
/// `rxm.rs` keeps `decode_rxm` and `decode_rxm_ty` side by side for the same reason.
///
/// Seeds a fresh `MAX_DECODE_NODES` budget for this call, same as `decode_rxm_ty` — `tapes` and `ty`
/// both come from a `.tm` FILE here, so both the heap's acyclicity (the spine loop's job) and its
/// decoded SIZE under nested types (the budget's job) are file-supplied and unchecked before this call.
///
/// `decode_tape_ty_reason`'s `.ok()` — see that function and `rxm::DecodeFailure` for why a caller
/// (`redextape-cli::run`) might want the reason a decode failed instead of just that it did.
pub fn decode_tape_ty(tapes: &[Tape], ty: &Ty, enc: &dyn Encoding) -> Option<Value> {
    decode_tape_ty_reason(tapes, ty, enc).ok()
}

/// `decode_tape_ty`, keeping WHY a failed decode failed.
///
/// `read_result` failing — a missing REG/HEAP tape, or a REG field this `enc` cannot parse as a Nat —
/// is `DecodeFailure::Mismatch`: like every other mismatch arm in `decode_word_ty`, it is a claim
/// about the DATA disagreeing with what the file's header/encoding say to expect, never about running
/// out of decode budget (`budget` is not even allocated yet at this point).
///
/// # Errors
///
/// See `DecodeFailure`'s doc for the two causes.
pub fn decode_tape_ty_reason(tapes: &[Tape], ty: &Ty, enc: &dyn Encoding) -> Result<Value, DecodeFailure> {
    let Some((word, heap)) = read_result(tapes, enc) else { return Err(DecodeFailure::Mismatch) };
    let mut budget = MAX_DECODE_NODES;
    decode_word_ty(word, &heap, ty, Functions::Refuse, &mut budget)
}

/// `decode_tape_ty`, reading a function, bare or inside a list, as the opaque `Value::Function` rather
/// than refusing it — the form every backend reports a function in, so a TM result can be compared
/// with the λ leg's and the reference's, and `run --backend tm` can print one. A separate entry point
/// rather than a change to `decode_tape_ty`, because that one's `None` is what the browser app shows
/// as undecodable.
#[must_use]
pub fn decode_tape_ty_opaque(tapes: &[Tape], ty: &Ty, enc: &dyn Encoding) -> Option<Value> {
    let (word, heap) = read_result(tapes, enc)?;
    let mut budget = MAX_DECODE_NODES;
    decode_word_ty(word, &heap, ty, Functions::Opaque, &mut budget).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::BinOp;
    use crate::tm::build::{AT, MARK, SEP, TAPES, WORK};
    use crate::tm::encoding::Unary;
    use crate::tm::lower_tm::{SlotMap, lower_tm};
    use crate::tm::rxm::{Instr, Program, Reg};
    use crate::tm::sim::{DEFAULT_CAPS as CAPS, simulate};

    /// Build [1, 2] on the TM: nil; cons(2, nil)->p1; cons(1, p1)->rr.
    fn list_one_two() -> Program {
        Program {
            code: vec![
                Instr::Nil(Reg::Loc(0)),
                Instr::Li(Reg::Loc(1), 2),
                Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(0)), // cons(2, nil)
                Instr::Li(Reg::Loc(3), 1),
                Instr::Cons(Reg::Rr, Reg::Loc(3), Reg::Loc(2)), // cons(1, p1) -> rr
                Instr::Halt,
            ],
            labels: vec![],
        }
    }

    fn run_to_tapes(prog: &Program) -> Vec<Tape> {
        let enc = Unary::default();
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
        assert_eq!(decode_tape(&tapes, &Value::Nat(0), &Unary::default()), Some(Value::Nat(5)));
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
        assert_eq!(decode_tape(&tapes, &Value::Bool(false), &Unary::default()), Some(Value::Bool(true)));
        // Same tape, a Nat witness: still decodes (to Nat(1)) — but as a DIFFERENT value, which is how
        // decode catches a machine that computed the wrong thing under a given type.
        assert_eq!(decode_tape(&tapes, &Value::Nat(9), &Unary::default()), Some(Value::Nat(1)));
    }

    #[test]
    fn non_first_class_shapes_decode_to_none() {
        let prog = Program { code: vec![Instr::Halt], labels: vec![] };
        let tapes = run_to_tapes(&prog);
        assert_eq!(decode_tape(&tapes, &Value::Unit, &Unary::default()), None);
    }

    #[test]
    fn decodes_a_constructed_list() {
        // Decode guided by a list shape.
        let prog = list_one_two();
        let tapes = run_to_tapes(&prog);
        assert_eq!(
            decode_tape(&tapes, &Value::list_of_nats(&[1, 2]), &Unary::default()),
            Some(Value::list_of_nats(&[1, 2]))
        );
    }

    #[test]
    fn decodes_nil_result() {
        let prog = Program { code: vec![Instr::Nil(Reg::Rr), Instr::Halt], labels: vec![] };
        let tapes = run_to_tapes(&prog);
        assert_eq!(decode_tape(&tapes, &Value::Nil, &Unary::default()), Some(Value::Nil));
        // A Cons witness over a nil result decodes to None (pointer 0 is not a cons).
        assert_eq!(decode_tape(&tapes, &Value::list_of_nats(&[1]), &Unary::default()), None);
    }

    /// `parse_heap_cells` splits a single `@`-delimited cell into its `(head, tail)` mark-count pair,
    /// and parses an empty heap to no cells at all. This calls `Unary::parse_heap_cells` directly, NOT
    /// `decode_tape` — for a test that goes through `decode_tape`'s dispatch to the encoding, see
    /// `decode_tape_reads_the_heap_through_the_encoding` below.
    #[test]
    fn parse_heap_cells_splits_head_and_tail() {
        let enc = Unary::default();
        // `@ 1 # 1 1` — one cons cell, head 1, tail 2 — as the unary encoding lays it out.
        let heap: Vec<char> = "@1#11".chars().collect();
        assert_eq!(enc.parse_heap_cells(&heap), vec![(1, 2)]);
        // The empty heap has no cells, at any width.
        assert_eq!(enc.parse_heap_cells(&[]), vec![]);
    }

    /// `decode_tape` must dispatch its HEAP read through `enc.parse_heap_cells`, not a hardcoded unary
    /// parser. Unlike the test above, this one calls `decode_tape` itself: a HEAP tape and a REG tape
    /// are built BY HAND (bypassing `lower_tm`/`simulate` entirely) and passed in with a `Value::Cons`
    /// shape witness, so the assertion only holds if `decode_tape`'s Cons path actually reads the HEAP
    /// through `enc` and follows the resulting pointer.
    ///
    /// LIMIT: run against ONE encoding, this cannot distinguish "decoded via `enc.parse_heap_cells`"
    /// from "decoded via a parser that happens to match `Unary`'s layout". The genuine cross-encoding
    /// proof is `tests/three_way_oracle.rs::a_binary_tape_does_not_decode_as_unary`, which decodes a
    /// binary-produced tape with `Unary` and asserts it does NOT produce the right answer.
    ///
    /// What this test adds over `decodes_a_constructed_list` above, which also dies if `decode_tape`
    /// ignores its `enc`: it hand-builds the tapes, so it isolates `decode_tape` from `lower_tm` and
    /// `simulate` — a decode failure here cannot be a compilation bug.
    #[test]
    fn decode_tape_reads_the_heap_through_the_encoding() {
        let enc = Unary::default();
        // REG: `# 1 #` -> slot 0 (Rr) = 1, a pointer to HEAP cell 1.
        let reg = Tape::new(&[SEP, MARK, SEP]);
        // HEAP: `@ 1 #` -> one cons cell at pointer 1: head 1, tail 0 (nil).
        let heap = Tape::new(&[AT, MARK, SEP]);
        let mut tapes = vec![Tape::new(&[]); TAPES];
        tapes[REG] = reg;
        tapes[HEAP] = heap;
        assert_eq!(decode_tape(&tapes, &Value::list_of_nats(&[1]), &enc), Some(Value::list_of_nats(&[1])));
    }

    /// D6: the two decoders AGREE wherever both are defined…
    #[test]
    fn the_two_decoders_agree_on_nat_bool_and_a_non_empty_list() {
        use crate::ty::Ty;
        let enc = Unary::default();

        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 2),
                Instr::Li(Reg::Loc(1), 3),
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        let t = run_to_tapes(&prog);
        assert_eq!(decode_tape(&t, &Value::Nat(0), &enc), decode_tape_ty(&t, &Ty::Nat, &enc));
        assert_eq!(decode_tape_ty(&t, &Ty::Nat, &enc), Some(Value::Nat(5)));

        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 2),
                Instr::Li(Reg::Loc(1), 2),
                Instr::Bin(BinOp::Eq, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        let t = run_to_tapes(&prog);
        assert_eq!(decode_tape(&t, &Value::Bool(false), &enc), decode_tape_ty(&t, &Ty::Bool, &enc));

        let prog = list_one_two();
        let t = run_to_tapes(&prog);
        let ty = Ty::List(Box::new(Ty::Nat));
        assert_eq!(decode_tape(&t, &Value::list_of_nats(&[1, 2]), &enc), decode_tape_ty(&t, &ty, &enc));
        assert_eq!(decode_tape_ty(&t, &ty, &enc), Some(Value::list_of_nats(&[1, 2])));
    }

    /// …and DISAGREE on three cases, on purpose. Pinning the disagreements is the point: without
    /// this test, re-expressing either decoder over the other later would pass every other test in the
    /// tree while quietly loosening the oracle's list-LENGTH check.
    #[test]
    fn the_decoders_disagree_on_nil_unit_and_functions_by_design() {
        use crate::ty::Ty;
        let enc = Unary::default();
        let t = run_to_tapes(&Program { code: vec![Instr::Nil(Reg::Rr), Instr::Halt], labels: vec![] });

        // A nil result under a one-element witness is a WRONG ANSWER the Value-directed decoder must
        // reject — that rejection is how the oracle catches a machine that returned a shorter list.
        assert_eq!(decode_tape(&t, &Value::list_of_nats(&[1]), &enc), None);
        // The Ty-directed decoder has no length to compare against; nil is a legitimate `List<Nat>`.
        assert_eq!(decode_tape_ty(&t, &Ty::List(Box::new(Ty::Nat)), &enc), Some(Value::Nil));

        // Unit is not a first-class tape value, so there is no `Value::Unit` witness to decode against…
        assert_eq!(decode_tape(&t, &Value::Unit, &enc), None);
        // …but a FILE may legitimately declare `result Unit`, and the word is then simply ignored.
        assert_eq!(decode_tape_ty(&t, &Ty::Unit, &enc), Some(Value::Unit));

        // A function, here a closure cell `cons(tag 3, nil)`: the witness decoder reads it as the
        // opaque function, the plain type decoder refuses it, and the `_opaque` one reads it.
        let closure = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 3),
                Instr::Nil(Reg::Loc(1)),
                Instr::Cons(Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        let t = run_to_tapes(&closure);
        let fun = Ty::Fun(vec![Ty::Nat], Box::new(Ty::Nat));
        assert_eq!(decode_tape(&t, &Value::Function, &enc), Some(Value::Function));
        assert_eq!(decode_tape_ty(&t, &fun, &enc), None);
        assert_eq!(decode_tape_ty_opaque(&t, &fun, &enc), Some(Value::Function));
    }

    /// A `.tm` file's initial HEAP is untrusted. A cyclic one must decode to `None`, not overflow.
    #[test]
    fn decode_tape_ty_survives_a_cyclic_heap_from_a_file() {
        use crate::ty::Ty;
        let enc = Unary::default();
        // REG: `# 1 #` -> slot 0 = pointer 1.  HEAP: `@ 1 # 1` -> cell 1 = (head 1, tail 1) — self-loop.
        let mut tapes = vec![Tape::new(&[]); TAPES];
        tapes[REG] = Tape::new(&[SEP, MARK, SEP]);
        tapes[HEAP] = Tape::new(&[AT, MARK, SEP, MARK]);
        assert_eq!(decode_tape_ty(&tapes, &Ty::List(Box::new(Ty::Nat)), &enc), None);
    }

    /// `result_heap_runs` lights the cells `rr`'s list reaches and no others, heads too under a list of
    /// lists, adjacent cells as one run, in either encoding: cell 1 and cell 4 are garbage, cells 2 and 3
    /// sit side by side, and cell 5 shares cell 2 as both its head and its tail's head. A `nil` beside a cell lights
    /// none.
    #[test]
    fn result_heap_runs_light_the_cells_the_result_reaches() {
        use crate::tm::encoding::Binary;
        use crate::ty::Ty;
        let (r0, r1, r2, r3, r4, r5) = (Reg::Loc(0), Reg::Loc(1), Reg::Loc(2), Reg::Loc(3), Reg::Loc(4), Reg::Loc(5));
        let prog = Program {
            code: vec![
                Instr::Nil(r0),
                Instr::Li(r1, 9),
                Instr::Cons(r5, r1, r0), // cell 1, garbage
                Instr::Li(r1, 1),
                Instr::Cons(r2, r1, r0), // cell 2: [1]
                Instr::Cons(r3, r2, r0), // cell 3: [[1]]
                Instr::Li(r1, 7),
                Instr::Cons(r4, r1, r5),      // cell 4, garbage
                Instr::Cons(Reg::Rr, r2, r3), // cell 5: [[1], [1]]
                Instr::Halt,
            ],
            labels: vec![],
        };
        let nested = Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))));
        let flat = Ty::List(Box::new(Ty::Nat));
        for enc in [Box::new(Unary::default()) as Box<dyn Encoding>, Box::new(Binary::default())] {
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = enc.init_reg(SlotMap::of(&prog).n_slots());
            init[WORK] = enc.init_work();
            let tapes = simulate(&lower_tm(&prog, &*enc), &init, CAPS).0;
            let heap = tapes[HEAP].snapshot().0;
            let cells = |runs: &[(usize, usize)]| -> Vec<Vec<(u64, u64)>> {
                runs.iter().map(|&(from, to)| enc.parse_heap_cells(&heap[from..to])).collect()
            };
            let runs = result_heap_runs(&tapes, &nested, &*enc);
            assert_eq!(cells(&runs), [vec![(1, 0), (2, 0)], vec![(2, 3)]]);
            // Under `List<Nat>` no head is a pointer, so cell 2 is reached by nothing.
            assert_eq!(cells(&result_heap_runs(&tapes, &flat, &*enc)), [vec![(2, 0)], vec![(2, 3)]]);
            assert!(result_heap_runs(&tapes, &Ty::Nat, &*enc).is_empty());
            if enc.heap_word_len().is_none() {
                let text: Vec<String> = runs.iter().map(|&(from, to)| heap[from..to].iter().collect()).collect();
                assert_eq!(text, ["@1#@11#", "@11#111"]);
            }
        }
        let nil = run_to_tapes(&Program {
            code: vec![Instr::Nil(r0), Instr::Li(r1, 1), Instr::Cons(r2, r1, r0), Instr::Nil(Reg::Rr), Instr::Halt],
            labels: vec![],
        });
        let heap = Unary::default().parse_heap_cells(&nil[HEAP].snapshot().0);
        assert_eq!(heap, [(1, 0)], "the premise: the heap holds a cell");
        assert!(result_heap_runs(&nil, &flat, &Unary::default()).is_empty());
    }
}
