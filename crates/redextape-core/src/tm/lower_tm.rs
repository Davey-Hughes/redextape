//! asm `Program` -> multi-tape `Machine`. Control flow becomes the TM's state graph: one entry state
//! per instruction index; each instruction is a block of states (a delta-gadget) that flows from its
//! `pc` to a successor `pc`. Straight-line instructions fall through to `pc[i+1]`; `jmp`/`jz` (Task 4)
//! jump to a label's `pc`. Value gadgets come from the `Encoding` seam. Total and panic-free on any
//! `Program`. `call`/`ret` lower via STACK frames + return-tag dispatch (Part 2b-2-ii); `Nil`/`Cons`/
//! `IsEmpty` lower via the HEAP tape (Part 2b-2-iii-a); `Head`/`Tail` (Part 2b-2-iii-b) dereference a
//! pointer over the HEAP — `nil`/dangling have no value and spin to a cap (matching λ/reference).

use crate::core::BinOp;
use crate::tm::asm::{Instr, Program, Reg};
use crate::tm::build::{Builder, RuleSpec, Slot};
use crate::tm::encoding::{Encoding, stack_is_empty};
use crate::tm::machine::{Machine, StateId};

/// Upper bound on the register-field count a program may lay out on the REG tape. Mirrors
/// `asm.rs`'s `MAX_REGISTERS`: it keeps `init_reg`'s allocation bounded and every gadget's seek
/// chain finite, so `lower_tm`/`run_tm` stay total on ANY `Program` (a hand-built or fuzzed one
/// with an absurd register index routes to a defensive halt instead of panicking or aborting).
/// Far above any real first-order program's slot count.
pub(crate) const MAX_SLOTS: u32 = 100_000;

/// Bound on the local count when a program contains calls. The STACK frame gadgets
/// (`push_frame`/`pop_frame_restore`) are O(n_loc^2) states (each field-copy re-seeks from home), so
/// an absurd local count in a call-containing program would build an OOM-sized machine. Real
/// first-order programs use « this. A program that exceeds it routes to a degenerate halt (total,
/// bounded). `MAX_SLOTS` (the O(n_slots) bank/init-tape bound) stays as-is for no-call programs.
pub(crate) const MAX_FRAME_LOC: u32 = 1_000;

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

    /// The `Loc` bank size — the fields a `Call` frame saves/restores (slots `1..=n_loc`).
    /// `push_frame`/`pop_frame_restore` unroll over this compile-time count.
    pub(crate) fn n_loc(&self) -> u32 {
        self.n_loc
    }
}

/// The register operands of an instruction (for sizing the bank). Read and write operands alike.
fn instr_regs(i: &Instr) -> Vec<Reg> {
    match i {
        Instr::Li(rd, _) | Instr::Jz(rd, _) | Instr::Nil(rd) => vec![*rd],
        Instr::Mov(a, b)
        | Instr::Head(a, b)
        | Instr::Tail(a, b)
        | Instr::IsEmpty(a, b)
        | Instr::Box(a, b)
        | Instr::BoxGet(a, b)
        | Instr::BoxSet(a, b) => vec![*a, *b],
        Instr::Bin(_, a, b, c) | Instr::Cons(a, b, c) => vec![*a, *b, *c],
        Instr::Jmp(_) | Instr::Call(_) | Instr::Ret | Instr::Halt => vec![],
    }
}

/// True for the arithmetic `BinOp`s (dispatch to `enc.arith`); the rest are comparisons (`enc.compare`).
fn is_arith(op: BinOp) -> bool {
    matches!(op, BinOp::Add | BinOp::Sub | BinOp::Mul)
}

/// Lower `prog` into a `TAPES`-tape `Machine`. Total and panic-free on any `Program`.
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

    // The `Loc` bank size: how many fields each `Call` frame saves/restores (slots `1..=n_loc`).
    let n_loc = sm.n_loc();
    // Call sites in instruction order: `call_sites[c]` is the instruction index of call site `c`.
    // A `Call` pushes its ordinal `c` as the frame's return-tag; `Ret` reads it back to resume at
    // `succ(call_sites[c] + 1)` — the instruction after that `Call`.
    let call_sites: Vec<usize> =
        prog.code.iter().enumerate().filter(|(_, instr)| matches!(instr, Instr::Call(_))).map(|(idx, _)| idx).collect();
    // Instruction-index -> call-site ordinal, precomputed so the per-instruction loop reads each
    // `Call`'s tag in O(1) (entries at non-`Call` indices are unused).
    let mut call_ordinal = vec![0usize; n];
    for (c, &site) in call_sites.iter().enumerate() {
        call_ordinal[site] = c;
    }
    // The per-site return continuations: dispatching tag `c` resumes at the state after call site `c`.
    let exits: Vec<StateId> = call_sites.iter().map(|&site| succ(site + 1)).collect();

    // `push_frame`/`pop_frame_restore` are O(n_loc^2) states (each field-copy re-seeks from home).
    // They're only ever built when the program actually contains a `Call` (see `has_ret`/`ret_entry`
    // below and the `Call` arm in the per-instruction loop). Refuse an absurd local count in that case
    // *before* building any of them, so a call-containing program can't OOM the lowering.
    if !call_sites.is_empty() && n_loc > MAX_FRAME_LOC {
        return b.finish(halt);
    }

    let has_ret = prog.code.iter().any(|i| matches!(i, Instr::Ret));
    // One shared `Ret` handler (every `Ret` routes here). Built lazily, matching what the program can
    // actually reach:
    //   - no `Ret` at all: no arm ever routes here — `halt` is an unused placeholder, and no frame
    //     gadgets are built.
    //   - `Ret`s but no `Call`s: a `Ret` always sees an empty stack, so build only the empty-stack
    //     check (both branches halt — the non-empty branch is unreachable at runtime). Skips the
    //     O(n_loc^2) `pop_frame_restore`/`dispatch_tag` chain entirely.
    //   - `Call`s present: build the full handler — an empty stack halts defensively; otherwise
    //     restore the caller's `Loc` bank, then walk the return-tag through the finite dispatch chain
    //     to resume at the originating `Call`'s continuation.
    let ret_entry = if !has_ret {
        halt
    } else if call_sites.is_empty() {
        let re = b.state("ret");
        stack_is_empty(&mut b, re, halt, halt);
        re
    } else {
        let re = b.state("ret");
        let restore_start = b.state("ret.restore");
        let dispatch_start = b.state("ret.disp");
        stack_is_empty(&mut b, re, halt, restore_start);
        enc.pop_frame_restore(&mut b, restore_start, dispatch_start, n_loc);
        enc.dispatch_tag(&mut b, dispatch_start, &exits);
        re
    };

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
            Instr::Call(l) => {
                // Push a frame tagged with this call's ordinal (saving the `Loc` bank), then jump to
                // the target's entry (an unknown label defensively halts, matching `Jmp`/`Jz`).
                let c = call_ordinal[i];
                let target = prog.label_index(l).map_or(halt, &succ);
                let after = b.state(format!("call{i}.j"));
                enc.push_frame(&mut b, pc[i], after, n_loc, c as u64);
                b.add_rule(after, RuleSpec::new(), target);
            }
            // Every `Ret` funnels into the one shared handler built above.
            Instr::Ret => b.add_rule(pc[i], RuleSpec::new(), ret_entry),
            Instr::Nil(rd) => enc.write_literal(&mut b, pc[i], fall, 0, sm.slot(*rd)),
            Instr::Cons(rd, rh, rt) => enc.cons(&mut b, pc[i], fall, sm.slot(*rh), sm.slot(*rt), sm.slot(*rd)),
            Instr::IsEmpty(rd, rl) => enc.is_empty_op(&mut b, pc[i], fall, sm.slot(*rl), sm.slot(*rd)),
            Instr::Head(rd, rl) => enc.head_op(&mut b, pc[i], fall, sm.slot(*rl), sm.slot(*rd)),
            Instr::Tail(rd, rl) => enc.tail_op(&mut b, pc[i], fall, sm.slot(*rl), sm.slot(*rd)),
            Instr::Box(rd, rv) => enc.box_op(&mut b, pc[i], fall, sm.slot(*rv), sm.slot(*rd)),
            Instr::BoxGet(rd, rb) => enc.box_get_op(&mut b, pc[i], fall, sm.slot(*rb), sm.slot(*rd)),
            Instr::BoxSet(rb, rv) => enc.box_set_op(&mut b, pc[i], fall, sm.slot(*rb), sm.slot(*rv)),
        }
    }

    b.finish(pc.first().copied().unwrap_or(halt))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::BinOp;
    use crate::desugar::desugar;
    use crate::parser::parse;
    use crate::tm::asm::{Instr, Program, Reg};
    use crate::tm::build::REG;
    use crate::tm::build::TAPES;
    use crate::tm::encoding::Unary;
    use crate::tm::lower_asm::lower_asm;
    use crate::tm::sim::{Caps, DEFAULT_CAPS as CAPS, Status, simulate, simulate_trace};

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

    #[test]
    fn recursive_sum_through_the_tm() {
        // sum(n) = if n==0 {0} else { n + sum(n-1) };  sum(5) == 15.
        // Identical to asm.rs's recursive_call_preserves_locals_across_the_call.
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Arg(0), 5),
                Instr::Call("sum".to_string()),
                Instr::Halt,
                // sum:
                Instr::Mov(Reg::Loc(0), Reg::Arg(0)), // r0 = n
                Instr::Li(Reg::Loc(1), 0),
                Instr::Bin(BinOp::Eq, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
                Instr::Jz(Reg::Loc(2), "rec".to_string()),
                Instr::Li(Reg::Rr, 0),
                Instr::Ret,
                // rec:
                Instr::Li(Reg::Loc(3), 1),
                Instr::Bin(BinOp::Sub, Reg::Arg(0), Reg::Loc(0), Reg::Loc(3)), // a0 = n-1
                Instr::Call("sum".to_string()),                                // rr = sum(n-1)
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Rr),         // n + sum(n-1)
                Instr::Ret,
            ],
            labels: vec![("sum".to_string(), 3), ("rec".to_string(), 9)],
        };
        assert_eq!(run_nat(&prog), Some(15));
    }

    #[test]
    fn two_distinct_call_sites_dispatch_correctly() {
        // f(x) = x + 1;  result = f(2) + f(10) == 3 + 11 == 14. Two call sites must each resume correctly.
        // r0 staging, a0 arg; the two calls have ordinals 0 and 1 -> tags 0 and 1.
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Arg(0), 2),
                Instr::Call("f".to_string()),     // site 0 -> resume at idx 2
                Instr::Mov(Reg::Loc(0), Reg::Rr), // r0 = f(2) = 3
                Instr::Li(Reg::Arg(0), 10),
                Instr::Call("f".to_string()), // site 1 -> resume at idx 5
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Rr), // 3 + 11
                Instr::Halt,
                // f:
                Instr::Mov(Reg::Loc(1), Reg::Arg(0)), // note: distinct local from caller's r0
                Instr::Li(Reg::Loc(2), 1),
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(1), Reg::Loc(2)),
                Instr::Ret,
            ],
            labels: vec![("f".to_string(), 7)],
        };
        assert_eq!(run_nat(&prog), Some(14));
    }

    #[test]
    fn no_call_program_does_not_build_frame_gadgets() {
        // A no-Call/no-Ret program with a large local count must NOT build the O(n_loc^2) Ret handler.
        // (Before the fix this built a ~O(2000^2) machine and could OOM.)
        let prog = Program { code: vec![Instr::Li(Reg::Loc(2_000), 1), Instr::Halt], labels: vec![] };
        let m = lower_tm(&prog, &Unary);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        // One Li gadget seeking slot 2000 is O(2000); a quadratic Ret handler would be ~O(2000^2)=4M.
        assert!(m.states.len() < 50_000, "no-Call program must not build frame gadgets; got {}", m.states.len());
    }

    #[test]
    fn is_empty_of_nil_and_of_cons() {
        // is_empty(nil) == 1 ; and is_empty(cons(1,nil)) == 0.
        let nil_prog = Program {
            code: vec![Instr::Nil(Reg::Loc(0)), Instr::IsEmpty(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        };
        assert_eq!(run_nat(&nil_prog), Some(1));

        let cons_prog = Program {
            code: vec![
                Instr::Nil(Reg::Loc(0)),
                Instr::Li(Reg::Loc(1), 1),
                Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(0)), // cons(1, nil)
                Instr::IsEmpty(Reg::Rr, Reg::Loc(2)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        assert_eq!(run_nat(&cons_prog), Some(0));
    }

    #[test]
    fn head_tail_deref_reads_a_nested_element() {
        // rr = head(tail(cons(1, cons(2, nil)))) == 2. Identical to asm.rs's head_tail_deref.
        let prog = Program {
            code: vec![
                Instr::Nil(Reg::Loc(0)), // r0 = nil
                Instr::Li(Reg::Loc(1), 2),
                Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(0)), // r2 = cons(2, nil)
                Instr::Li(Reg::Loc(3), 1),
                Instr::Cons(Reg::Loc(4), Reg::Loc(3), Reg::Loc(2)), // r4 = cons(1, r2)
                Instr::Tail(Reg::Loc(5), Reg::Loc(4)),              // r5 = tail(r4) -> ptr to (2,nil)
                Instr::Head(Reg::Rr, Reg::Loc(5)),                  // rr = head(r5) = 2
                Instr::Halt,
            ],
            labels: vec![],
        };
        assert_eq!(run_nat(&prog), Some(2));
    }

    #[test]
    fn head_tail_faults_spin_to_a_cap() {
        // head(nil), tail(nil), and a dangling pointer have no runtime value: the reference faults
        // (RunError::Runtime), λ's nil-branch is Ω (no normal form). The TM matches by DIVERGING — the
        // deref's fault state spins, so under any cap the machine hits it (HitCap), never Ran. This is
        // what lets the three-way oracle (Part 2b-2-iv-a) treat all three "no value" outcomes alike.
        // A small cap keeps the test fast (the spin has no fixed point; sim runs it to the step cap).
        fn hits_cap(prog: &Program) -> bool {
            let m = lower_tm(prog, &Unary);
            assert!(m.validate().is_empty(), "{:?}", m.validate());
            let sm = SlotMap::of(prog);
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = Unary.init_reg(sm.n_slots());
            matches!(simulate(&m, &init, Caps { steps: 10_000, cells: 10_000 }).1, Status::HitCap)
        }
        // head(nil) / tail(nil): pointer 0.
        assert!(hits_cap(&Program {
            code: vec![Instr::Nil(Reg::Loc(0)), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        }));
        assert!(hits_cap(&Program {
            code: vec![Instr::Nil(Reg::Loc(0)), Instr::Tail(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        }));
        // Dangling: pointer 5 into an empty heap.
        assert!(hits_cap(&Program {
            code: vec![Instr::Li(Reg::Loc(0), 5), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        }));
    }

    #[test]
    fn call_program_with_absurd_local_count_routes_to_degenerate_halt() {
        // A Call-containing program with n_loc beyond MAX_FRAME_LOC must route to a degenerate halt,
        // not build an O(n_loc^2) machine. (Real programs use « MAX_FRAME_LOC.)
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(5_000), 1), // forces n_loc = 5001 > MAX_FRAME_LOC
                Instr::Call("f".to_string()),
                Instr::Halt,
                Instr::Ret, // f:
            ],
            labels: vec![("f".to_string(), 3)],
        };
        let m = lower_tm(&prog, &Unary);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        assert!(m.states.len() < 10_000, "must not build an O(n_loc^2) machine; got {}", m.states.len());
    }

    #[test]
    fn tm_step_count_goldens() {
        // The exact number of TM steps a small program takes — a regression guard on gadget step cost and
        // a demonstration of the unary tape's cost. Deterministic (the TM has no nondeterminism). If a
        // gadget's step cost changes, re-capture the numbers below (a deliberate re-bless).
        fn steps(src: &str) -> usize {
            let (prog, ds) = parse(src);
            assert!(ds.is_empty(), "parse errors: {ds:?}");
            let core = desugar(&prog.unwrap());
            let program = lower_asm(&core).expect("lowers");
            let m = lower_tm(&program, &Unary);
            let sm = SlotMap::of(&program);
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = Unary.init_reg(sm.n_slots());
            let trace = simulate_trace(&m, &init, CAPS);
            assert_eq!(trace.status, crate::tm::sim::Status::Halted, "demo must halt: {src}");
            trace.steps.len()
        }
        // CAPTURE the actual counts (run once, paste the real numbers). Keep the demos SMALL so the trace
        // stays cheap — avoid step-heavy recursion (sum(5) is ~178k steps).
        assert_eq!(steps("1 + 2 * 3"), 5724);
        assert_eq!(steps("if 2 > 1 { 10 } else { 20 }"), 2174);
        assert_eq!(steps("head(cons(7, nil))"), 2300);
    }

    #[test]
    fn tm_step_count_golden_higher_order() {
        // Mirrors `tm_step_count_goldens` above, but for a demo that is higher-order and so must run
        // through `defunc` before `lower_asm` (Plan 3b-1). Pins the TM step cost of the defunctionalized
        // dispatch path (a HEAP closure `cons(tag, env)`, an `$apply1` dispatcher call per list element,
        // plus the existing list/recursion gadget costs) as a regression guard, same discipline as the
        // first-order goldens above. Keep the list SMALL (2 elements) so the trace stays cheap.
        fn steps(src: &str) -> usize {
            let (prog, ds) = parse(src);
            assert!(ds.is_empty(), "parse errors: {ds:?}");
            let core = desugar(&prog.unwrap());
            let defunced = crate::tm::defunc::defunc(&core).expect("defunc succeeds");
            let program = lower_asm(&defunced).expect("defunc'd core lowers first-order");
            let m = lower_tm(&program, &Unary);
            let sm = SlotMap::of(&program);
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = Unary.init_reg(sm.n_slots());
            let trace = simulate_trace(&m, &init, CAPS);
            assert_eq!(trace.status, crate::tm::sim::Status::Halted, "demo must halt: {src}");
            trace.steps.len()
        }
        // CAPTURED (run, pasted the real number, re-ran to confirm stable/deterministic).
        assert_eq!(
            steps(
                "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
                 fn add1(x) { x + 1 } [1, 2].map(add1)"
            ),
            239_971
        );
    }

    #[test]
    fn box_program_runs_end_to_end_on_the_tm() {
        use crate::core::{Core, NodeGen};
        use crate::tm::{TM_DEFAULT_CAPS, TmRun, Unary, decode_tape, run_tm};
        // let h = $box(1) in { $box_set(h, 6); $box_get(h) } ==> 6 on the TM
        let mut g = NodeGen::default();
        let ap = |g: &mut NodeGen, n: &str, a: Vec<Core>| {
            Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), n.into())), a)
        };
        // Hoist each `vec![...]`'s `g.fresh()` args into `let` bindings before the `ap(&mut g, ...)`
        // call: passing `&mut g` as `ap`'s first argument while a `vec![Core::Nat(g.fresh(), ..), ..]`
        // literal in a later argument also needs `&mut g` is two concurrent mutable borrows of `g` —
        // the same trap Tasks 2/3 hit (a pure NodeId-order change; no semantic difference).
        let one = Core::Nat(g.fresh(), 1);
        let boxed = ap(&mut g, "$box", vec![one]);
        let h_ref_1 = Core::Var(g.fresh(), "h".into());
        let six = Core::Nat(g.fresh(), 6);
        let set = ap(&mut g, "$box_set", vec![h_ref_1, six]);
        let h_ref_2 = Core::Var(g.fresh(), "h".into());
        let get = ap(&mut g, "$box_get", vec![h_ref_2]);
        let body = Core::Seq(g.fresh(), Box::new(set), Box::new(get));
        let prog =
            Core::Let { id: g.fresh(), name: "h".into(), mutable: false, value: Box::new(boxed), body: Box::new(body) };
        let expected = crate::interp::eval(&prog).unwrap();
        assert_eq!(expected, crate::value::Value::Nat(6));
        match run_tm(&prog, &Unary, TM_DEFAULT_CAPS) {
            TmRun::Ran { tapes } => assert_eq!(decode_tape(&tapes, &expected, &Unary), Some(expected)),
            other => panic!("box program did not run on TM: {other:?}"),
        }
    }

    #[test]
    fn box_get_of_null_handle_spins_to_a_cap() {
        use crate::core::{Core, NodeGen};
        use crate::tm::{TmCaps, TmRun, Unary, run_tm};
        // $box_get(0) — a null handle. Mirrors head_tail_faults_spin_to_a_cap.
        let mut g = NodeGen::default();
        let get =
            Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), "$box_get".into())), vec![Core::Nat(g.fresh(), 0)]);
        assert!(matches!(run_tm(&get, &Unary, TmCaps { steps: 50_000, cells: 50_000 }), TmRun::HitCap));
    }
}
