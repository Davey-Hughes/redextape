//! asm `Program` -> multi-tape `Machine`. Control flow becomes the TM's state graph: one entry state
//! per instruction index; each instruction is a block of states (a delta-gadget) that flows from its
//! `pc` to a successor `pc`. Straight-line instructions fall through to `pc[i+1]`; `jmp`/`jz` (Task 4)
//! jump to a label's `pc`. Value gadgets come from the `Encoding` seam. Total and panic-free on any
//! `Program`. `call`/`ret` and the heap ops are Parts 2b-2-ii/iii; here they defensively halt.

use crate::core::BinOp;
use crate::tm::asm::{Instr, Program, Reg};
use crate::tm::build::{Builder, RuleSpec, Slot};
use crate::tm::encoding::Encoding;
use crate::tm::machine::{Machine, StateId};

/// Upper bound on the register-field count a program may lay out on the REG tape. Mirrors
/// `asm.rs`'s `MAX_REGISTERS`: it keeps `init_reg`'s allocation bounded and every gadget's seek
/// chain finite, so `lower_tm`/`run_tm` stay total on ANY `Program` (a hand-built or fuzzed one
/// with an absurd register index routes to a defensive halt instead of panicking or aborting).
/// Far above any real first-order program's slot count.
pub(crate) const MAX_SLOTS: u32 = 100_000;

/// Maps the asm register file onto REG-tape fields. Layout: slot 0 = `Rr` (the result), then the
/// `Loc` bank, then the `Arg` bank. Distinct registers -> distinct slots, so `lower_asm`'s
/// "`ra`/`rb` fresh, `!= dst`" invariant carries to the `rd != ra, rb` slot precondition for free.
pub(crate) struct SlotMap {
    n_loc: u32,
    n_arg: u32,
}

impl SlotMap {
    pub(crate) fn of(prog: &Program) -> SlotMap {
        let mut n_loc = 0;
        let mut n_arg = 0;
        for instr in &prog.code {
            for r in instr_regs(instr) {
                match r {
                    Reg::Loc(k) => n_loc = n_loc.max(k.saturating_add(1)),
                    Reg::Arg(k) => n_arg = n_arg.max(k.saturating_add(1)),
                    Reg::Rr => {}
                }
            }
        }
        SlotMap { n_loc, n_arg }
    }

    pub(crate) fn slot(&self, r: Reg) -> Slot {
        match r {
            Reg::Rr => 0,
            Reg::Loc(k) => 1u32.saturating_add(k),
            Reg::Arg(k) => 1u32.saturating_add(self.n_loc).saturating_add(k),
        }
    }

    /// Total REG-tape slots: `Rr` + the `Loc` bank + the `Arg` bank. Sizes `run_tm`'s initial REG tape.
    pub(crate) fn n_slots(&self) -> u32 {
        1u32.saturating_add(self.n_loc).saturating_add(self.n_arg)
    }
}

/// The register operands of an instruction (for sizing the bank). Read and write operands alike.
fn instr_regs(i: &Instr) -> Vec<Reg> {
    match i {
        Instr::Li(rd, _) | Instr::Jz(rd, _) | Instr::Nil(rd) => vec![*rd],
        Instr::Mov(a, b) | Instr::Head(a, b) | Instr::Tail(a, b) | Instr::IsEmpty(a, b) => vec![*a, *b],
        Instr::Bin(_, a, b, c) | Instr::Cons(a, b, c) => vec![*a, *b, *c],
        Instr::Jmp(_) | Instr::Call(_) | Instr::Ret | Instr::Halt => vec![],
    }
}

/// True for the arithmetic `BinOp`s (dispatch to `enc.arith`); the rest are comparisons (`enc.compare`).
fn is_arith(op: BinOp) -> bool {
    matches!(op, BinOp::Add | BinOp::Sub | BinOp::Mul)
}

/// Lower `prog` into a 4-tape `Machine`. Total and panic-free on any `Program`.
pub fn lower_tm(prog: &Program, enc: &dyn Encoding) -> Machine {
    let sm = SlotMap::of(prog);
    let mut b = Builder::new();
    let n = prog.code.len();
    // The single halt (accept) state: `halt`, an out-of-range/unimplemented instruction, and falling
    // off the end all route here.
    let halt = b.accept("halt");
    // An absurd register index (a hand-built or fuzzed Program; real `lower_asm` output stays tiny)
    // would build a multi-million-state machine and an oversized init tape. Refuse to lay it out:
    // return a degenerate machine that halts immediately. Total, panic-free, no huge allocation.
    if sm.n_slots() > MAX_SLOTS {
        return b.finish(halt);
    }
    // One entry state per instruction index. `pc[i]` means "about to execute instruction i".
    let pc: Vec<StateId> = (0..n).map(|i| b.state(format!("pc{i}"))).collect();
    // Successor entry for a (possibly past-the-end) instruction index.
    let succ = |k: usize| if k < n { pc[k] } else { halt };

    for (i, instr) in prog.code.iter().enumerate() {
        let fall = succ(i + 1);
        match instr {
            Instr::Li(rd, v) => enc.write_literal(&mut b, pc[i], fall, *v, sm.slot(*rd)),
            Instr::Mov(rd, rs) => enc.mov(&mut b, pc[i], fall, sm.slot(*rs), sm.slot(*rd)),
            Instr::Bin(op, rd, ra, rb) if is_arith(*op) => {
                enc.arith(&mut b, pc[i], fall, *op, sm.slot(*ra), sm.slot(*rb), sm.slot(*rd))
            }
            Instr::Bin(op, rd, ra, rb) => {
                enc.compare(&mut b, pc[i], fall, *op, sm.slot(*ra), sm.slot(*rb), sm.slot(*rd))
            }
            Instr::Halt => b.add_rule(pc[i], RuleSpec::new(), halt),
            Instr::Jmp(l) => {
                let t = prog.label_index(l).map_or(halt, &succ);
                b.add_rule(pc[i], RuleSpec::new(), t);
            }
            Instr::Jz(r, l) => {
                let t = prog.label_index(l).map_or(halt, &succ);
                // jz jumps to the label when the field is ZERO; otherwise falls through.
                enc.jz(&mut b, pc[i], t, fall, sm.slot(*r));
            }
            // 2b-2-ii/iii replace these — defensively halt for now (never fed to this slice's tests).
            Instr::Call(_)
            | Instr::Ret
            | Instr::Nil(_)
            | Instr::Cons(..)
            | Instr::Head(..)
            | Instr::Tail(..)
            | Instr::IsEmpty(..) => b.add_rule(pc[i], RuleSpec::new(), halt),
        }
    }

    b.finish(pc.first().copied().unwrap_or(halt))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::BinOp;
    use crate::tm::asm::{Instr, Program, Reg};
    use crate::tm::build::REG;
    use crate::tm::build::TAPES;
    use crate::tm::encoding::Unary;
    use crate::tm::sim::{DEFAULT_CAPS as CAPS, Status, simulate};

    /// Lower `prog`, run it, and decode field 0 (the `Rr` result) as a unary Nat.
    fn run_nat(prog: &Program) -> Option<u64> {
        let enc = Unary;
        let m = lower_tm(prog, &enc);
        assert!(m.validate().is_empty(), "invalid machine: {:?}", m.validate());
        let sm = SlotMap::of(prog);
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(sm.n_slots());
        let (tapes, status) = simulate(&m, &init, CAPS);
        assert_eq!(status, Status::Halted, "machine did not halt");
        enc.decode_nat(&tapes[REG].snapshot().0, 0)
    }

    #[test]
    fn straight_line_arithmetic() {
        // rr = (2 + 3) * 4 = 20  (identical to asm.rs's evaluates_straight_line_arithmetic)
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 2),
                Instr::Li(Reg::Loc(1), 3),
                Instr::Bin(BinOp::Add, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
                Instr::Li(Reg::Loc(3), 4),
                Instr::Bin(BinOp::Mul, Reg::Rr, Reg::Loc(2), Reg::Loc(3)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        assert_eq!(run_nat(&prog), Some(20));
    }

    #[test]
    fn monus_and_mov() {
        // r0=3; r1=5; r2 = 3 - 5 = 0; rr = r2. Exercises Sub + Mov.
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 3),
                Instr::Li(Reg::Loc(1), 5),
                Instr::Bin(BinOp::Sub, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
                Instr::Mov(Reg::Rr, Reg::Loc(2)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        assert_eq!(run_nat(&prog), Some(0));
    }

    #[test]
    fn slot_map_layout() {
        let prog = Program {
            code: vec![Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Arg(1)), Instr::Halt],
            labels: vec![],
        };
        let sm = SlotMap::of(&prog);
        assert_eq!(sm.slot(Reg::Rr), 0);
        assert_eq!(sm.slot(Reg::Loc(0)), 1);
        // n_loc = 1 (Loc(0)), so Arg(1) sits at 1 + 1 + 1 = 3; n_slots = 1 + 1 + 2 = 4.
        assert_eq!(sm.slot(Reg::Arg(1)), 3);
        assert_eq!(sm.n_slots(), 4);
    }

    #[test]
    fn jz_and_jmp_branch() {
        // if (1 == 2) rr=10 else rr=20  ->  20 (mirrors asm.rs's jz_and_jmp_branch)
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 1),
                Instr::Li(Reg::Loc(1), 2),
                Instr::Bin(BinOp::Eq, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)), // 0 (false)
                Instr::Jz(Reg::Loc(2), "else".to_string()),
                Instr::Li(Reg::Rr, 10),
                Instr::Jmp("end".to_string()),
                Instr::Li(Reg::Rr, 20), // else:
                Instr::Halt,            // end:
            ],
            labels: vec![("else".to_string(), 6), ("end".to_string(), 7)],
        };
        assert_eq!(run_nat(&prog), Some(20));
    }

    #[test]
    fn while_loop_counts_down() {
        // n=3; acc=0; while n>0 { acc=acc+1; n=n-1 }; rr=acc == 3.
        // r0=n, r1=acc, r2=cond, r3=one.
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 3),                                     // 0: n = 3
                Instr::Li(Reg::Loc(1), 0),                                     // 1: acc = 0
                Instr::Li(Reg::Loc(3), 0),                                     // 2: zero (for the compare)
                Instr::Bin(BinOp::Gt, Reg::Loc(2), Reg::Loc(0), Reg::Loc(3)),  // 3: cond = n > 0   (top:)
                Instr::Jz(Reg::Loc(2), "done".to_string()),                    // 4: if !cond -> done
                Instr::Li(Reg::Loc(4), 1),                                     // 5: one = 1
                Instr::Bin(BinOp::Add, Reg::Loc(1), Reg::Loc(1), Reg::Loc(4)), // 6: acc = acc + 1
                Instr::Bin(BinOp::Sub, Reg::Loc(0), Reg::Loc(0), Reg::Loc(4)), // 7: n = n - 1
                Instr::Jmp("top".to_string()),                                 // 8: -> top
                Instr::Mov(Reg::Rr, Reg::Loc(1)),                              // 9: rr = acc   (done:)
                Instr::Halt,                                                   // 10
            ],
            labels: vec![("top".to_string(), 3), ("done".to_string(), 9)],
        };
        assert_eq!(run_nat(&prog), Some(3));
    }

    #[test]
    fn lower_tm_is_total_on_an_absurd_register_index() {
        // A hand-built Program with a huge register index must not panic or abort during lowering;
        // it routes to a degenerate halt machine (real `lower_asm` never emits such indices).
        let prog = Program { code: vec![Instr::Li(Reg::Loc(u32::MAX), 1), Instr::Halt], labels: vec![] };
        let m = lower_tm(&prog, &Unary);
        assert!(m.validate().is_empty(), "degenerate machine must be valid: {:?}", m.validate());
        // And it simulates to a halt (does not hang / panic).
        let (_tapes, status) = simulate(&m, &vec![Vec::new(); TAPES], CAPS);
        assert_eq!(status, Status::Halted);
    }
}
