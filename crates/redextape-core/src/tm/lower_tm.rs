//! asm `Program` -> multi-tape `Machine`. Control flow becomes the TM's state graph: one entry state
//! per instruction index; each instruction is a block of states (a delta-gadget) that flows from its
//! `pc` to a successor `pc`. Straight-line instructions fall through to `pc[i+1]`; `jmp`/`jz` (Task 4)
//! jump to a label's `pc`. Value gadgets come from the `Encoding` seam. Total and panic-free on any
//! `Program`. `call`/`ret` lower via STACK frames + return-tag dispatch (Part 2b-2-ii); `Nil`/`Cons`/
//! `IsEmpty` lower via the HEAP tape (Part 2b-2-iii-a); `Head`/`Tail` (Part 2b-2-iii-b) dereference a
//! pointer over the HEAP — `nil`/dangling have no value and spin to a cap (matching λ/reference).

use crate::core::BinOp;
use crate::tm::asm::{Instr, Program, Reg};
use crate::tm::build::{Builder, MAX_MACHINE_STATES, RuleSpec, Slot};
use crate::tm::encoding::{Encoding, stack_is_empty};
use crate::tm::machine::{Machine, StateId};

/// Upper bound on the register-field count a program may lay out on the REG tape. Mirrors
/// `asm.rs`'s `MAX_REGISTERS`: it keeps `init_reg`'s allocation bounded and every gadget's seek
/// chain finite, so `lower_tm`/`run_tm` stay total on ANY `Program` (a hand-built or fuzzed one
/// with an absurd register index routes to a defensive halt instead of panicking or aborting).
/// Far above any real first-order program's slot count.
pub(crate) const MAX_SLOTS: u32 = 100_000;

/// Bound on the local count when a program contains calls. The STACK frame gadgets
/// (`push_frame`/`pop_frame_restore`) are `O(n_loc^2)` states (each field-copy re-seeks from home), so
/// an absurd local count in a call-containing program would build an OOM-sized machine. Real
/// first-order programs use « this. A program that exceeds it routes to a degenerate halt (total,
/// bounded). `MAX_SLOTS` (the `O(n_slots)` bank/init-tape bound) stays as-is for no-call programs.
pub(crate) const MAX_FRAME_LOC: u32 = 1_000;

/// True when `lower_tm_mapped` will REFUSE to lay `prog` out over the `Loc` bank and return the
/// degenerate halt-immediately machine instead: a program that contains a `Call` (so the `O(n_loc^2)`
/// frame gadgets would be built) with an absurd local count.
///
/// The single definition of that condition, so a caller obliged to mirror the refusal — `attribute`,
/// which must not report a machine that never ran as a complete zero-cost execution — cannot drift
/// from the guard it mirrors.
pub(crate) fn frame_bank_unrepresentable(prog: &Program, sm: &SlotMap) -> bool {
    sm.n_loc() > MAX_FRAME_LOC && prog.code.iter().any(|i| matches!(i, Instr::Call(_)))
}

/// Upper bound on the number of `Mul` instructions a single program may contain.
///
/// `Add`/`Sub` cost O(width) states per instruction under either encoding, but `Binary::arith`'s `Mul`
/// gadget is O(width²) — measured `1.5*width^2 + 26.5*width + 13` states for the gadget alone: 143
/// states at width 4, 7,853 at the 64-cell ceiling (`MAX_FIELD_WIDTH`). A chain of `Mul`s therefore
/// grows the machine far faster than a chain of any other instruction would, so it needs its own bound
/// the way `MAX_FRAME_LOC` bounds the `Loc` bank's own `O(n_loc^2)` blowup.
///
/// This is checked UNCONDITIONALLY — not only when `enc` happens to be `Binary` — because `Unary`'s
/// per-`Mul` cost (dominated by seeking to a growing slot index, not by width) grows with the same
/// instruction count too, just more slowly: measured at width 64, a chain of 32 `Mul`s costs 616,999
/// states / ~421 MB under `Binary` and only 12,411 states / ~10 MB under `Unary`; 128 `Mul`s cost
/// 6,842,311 states / ~4.6 GB under `Binary` and 178,635 states / ~129 MB under `Unary`. `Unary` needs
/// roughly an order of magnitude more `Mul`s to reach the same danger zone, but it is not immune, so a
/// guard that fired only for `Binary` would leave that path open — see `mul_count_unrepresentable`.
///
/// 32 is far above any real program's `Mul` count (the corpus's demos and every property-test generator
/// in this workspace never exceed 2 in one program), while keeping the worst case this permits
/// (measured, at the 64-cell ceiling) to ~617k states / ~410 MB under `Binary` — well short of the
/// multi-GB territory a longer chain reaches, and comfortably inside what a single test process can
/// build without risking the abort this guard exists to prevent.
pub(crate) const MAX_MUL_INSTRS: u32 = 32;

/// True when `lower_tm_mapped` will REFUSE to build `prog`'s arithmetic gadgets and return the
/// degenerate halt-immediately machine instead: more `Mul` instructions than `MAX_MUL_INSTRS` (see its
/// doc for why the bound applies regardless of which `Encoding` ultimately runs the machine).
///
/// The single definition of that condition, mirrored for the same reason `frame_bank_unrepresentable`
/// is: a caller obliged to mirror the refusal (`attribute`, `run_tm`) cannot drift from the guard it
/// mirrors.
pub(crate) fn mul_count_unrepresentable(prog: &Program) -> bool {
    let n_mul = prog.code.iter().filter(|i| matches!(i, Instr::Bin(BinOp::Mul, ..))).count();
    // Compare in `usize` space (widen `MAX_MUL_INSTRS` up, never narrow `n_mul` down): `n_mul as u32`
    // would truncate for a `prog.code` longer than `u32::MAX`, and a truncated count could silently
    // pass this guard instead of tripping it — the exact failure this function exists to prevent.
    n_mul > MAX_MUL_INSTRS as usize
}

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

/// The shape every refusal in `lower_tm_all` returns: the degenerate halt-immediately machine, a state
/// map of all `None`s (nothing built past `b.state_count()` belongs to any instruction), the shared
/// overflow-guard state, and `true` for "refused". `b` is MOVED rather than borrowed — every call site
/// returns immediately after, including the one inside the per-instruction loop, so there is nothing
/// left for the caller to do with it. Named so the five identical two-line bodies this replaces cannot
/// drift from each other one at a time.
fn refused(b: Builder, halt: StateId, overflow: StateId) -> (Machine, Vec<Option<usize>>, StateId, bool) {
    let state_origins = vec![None; b.state_count()];
    (b.finish(halt), state_origins, overflow, true)
}

/// Lower `prog` to a Turing machine, returning the machine, its state map, the overflow-guard
/// state, and whether the layout was REFUSED: `state_origins[s]` is the `prog.code` index whose
/// gadgets built state `s`, or `None` for machine scaffolding that belongs to no single instruction
/// (the shared halt state, the call-site return-tag dispatch chain, the `Ret` handler's
/// frame-restore gadget).
///
/// An instruction's own entry state (`pc{i}`) bills that instruction, not scaffolding: it is the
/// state the machine occupies when the instruction begins, so its cost is the instruction's. The
/// `None` bucket is reserved for states that genuinely belong to no single instruction.
///
/// A REFUSED layout (the fourth element, `true`) returns the degenerate halt-immediately machine —
/// `b.finish(halt)` — and a state map of all `None`s, exactly as before refusal was reported at all.
/// Every early return in this function is a refusal; only the final return at the bottom is not.
///
/// Returned rather than stored on `Machine` deliberately: `Machine` derives `PartialEq` and the TM
/// text round-trip test asserts `parse_tm(print_tm(m)) == m`, which a side-table field would break
/// for a reason that has nothing to do with what the machine computes.
///
/// `clippy::many_single_char_names`: `b` (`Builder`), `n` (instruction count), and the `r`/`l`/`t`
/// bound in the per-instruction match are this module's terse, consistently-used names for "the
/// builder", "a register", "a label", "a jump target" — renaming them would not make the lowering
/// clearer, only longer.
#[allow(clippy::many_single_char_names)]
fn lower_tm_all(prog: &Program, enc: &dyn Encoding) -> (Machine, Vec<Option<usize>>, StateId, bool) {
    let sm = SlotMap::of(prog);
    let mut b = Builder::new();
    let n = prog.code.len();
    // The single halt (accept) state: `halt`, an out-of-range/unimplemented instruction, and falling
    // off the end all route here.
    let halt = b.accept("halt");
    // The single overflow-guard state, allocated EAGERLY next to `halt` so the origin map bills it to
    // `None` (scaffolding) rather than to whichever instruction's gadget happened to request it first.
    // Every guard rule targets this one state; see `Builder::overflow`.
    let overflow = b.overflow();
    // An absurd register index (a hand-built or fuzzed Program; real `lower_asm` output stays tiny)
    // would build a multi-million-state machine and an oversized init tape. Refuse to lay it out:
    // return a degenerate machine that halts immediately. Total, panic-free, no huge allocation.
    if sm.n_slots() > MAX_SLOTS {
        return refused(b, halt, overflow);
    }
    // Too many `Mul` instructions would build an oversized machine under EITHER encoding (see
    // `MAX_MUL_INSTRS`'s doc) — checked here, as early as `MAX_SLOTS`, since it depends on nothing built
    // below and refusing before laying out `pc` is strictly cheaper than refusing after.
    if mul_count_unrepresentable(prog) {
        return refused(b, halt, overflow);
    }
    // One `pc` entry state per instruction is a LOWER BOUND on the machine's size, so a `code`
    // longer than the ceiling cannot possibly fit and is refused before the `pc` loop below builds a
    // `format!("pc{i}")` String per instruction for a machine that is going to be thrown away.
    //
    // NOT AN ESTIMATE, which is the distinction that matters: `MAX_MACHINE_STATES` is enforced by
    // COUNTING states rather than predicting them precisely so no second copy of per-gadget cost
    // knowledge can go stale (see its doc). This is an exact lower bound on the count, so refusing on
    // it cannot reject a program the ceiling itself would have admitted. It is a fast path, not a
    // second opinion.
    if n >= MAX_MACHINE_STATES {
        return refused(b, halt, overflow);
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
    if frame_bank_unrepresentable(prog, &sm) {
        return refused(b, halt, overflow);
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

    // Everything built above this point (the halt state, the `pc` entry states, and any
    // `Ret`-handler scaffolding) starts out billed to no single instruction; the `pc` entries are
    // then re-billed to their own instruction just below.
    let mut state_origins: Vec<Option<usize>> = vec![None; b.state_count()];
    // An instruction's ENTRY state is part of that instruction's cost — it is the state the machine
    // occupies when the instruction begins, and a reader asking "what does this multiply cost?"
    // expects it counted there. The `pc` batch is allocated above, before the per-instruction loop,
    // so the loop's before/after span arithmetic alone would bill every entry state to scaffolding:
    // a systematic one-directional bias that understates EVERY construct's cost and correspondingly
    // inflates the scaffolding bucket — corrupting exactly the "cost of what the user wrote" vs
    // "cost the machinery added" split this map exists to measure. Bill them explicitly instead.
    // `get_mut` rather than indexing keeps this total: a `pc` id is always in range by construction,
    // but an out-of-range one must not panic a library path.
    for (i, &entry) in pc.iter().enumerate() {
        if let Some(origin) = state_origins.get_mut(entry as usize) {
            *origin = Some(i);
        }
    }

    for (i, instr) in prog.code.iter().enumerate() {
        // States are appended as gadgets are emitted, so the states created while lowering
        // instruction `i` are exactly those appended during this iteration.
        let before = b.state_count();
        let fall = succ(i + 1);
        match instr {
            Instr::Li(rd, v) => enc.write_literal(&mut b, pc[i], fall, *v, sm.slot(*rd)),
            Instr::Mov(rd, rs) => enc.mov(&mut b, pc[i], fall, sm.slot(*rs), sm.slot(*rd)),
            Instr::Bin(op, rd, ra, rb) if is_arith(*op) => {
                enc.arith(&mut b, pc[i], fall, *op, sm.slot(*ra), sm.slot(*rb), sm.slot(*rd));
            }
            Instr::Bin(op, rd, ra, rb) => {
                enc.compare(&mut b, pc[i], fall, *op, sm.slot(*ra), sm.slot(*rb), sm.slot(*rd));
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
        let after = b.state_count();
        for _ in before..after {
            state_origins.push(Some(i));
        }
        // The ceiling is reached MID-GADGET for any program the length pre-check waved through — 2,000
        // `Box` instructions are ~1.1M states from a 2,001-instruction program — so it is checked per
        // instruction rather than once at the end. Stopping here bounds the wasted work at one
        // instruction's worth; running on would keep attaching rules to the state-0 sentinel that
        // `Builder::state` hands back past the ceiling, growing the machine's rule count without
        // growing its state count.
        if b.overflowed() {
            return refused(b, halt, overflow);
        }
    }

    (b.finish(pc.first().copied().unwrap_or(halt)), state_origins, overflow, false)
}

/// Lower `prog` to a Turing machine, returning the machine AND its state map (see `lower_tm_all`) — or
/// `None` if the layout was REFUSED, the same four conditions `lower_tm_guarded` reports (see its doc).
///
/// `Option` RATHER THAN THE OLD BEHAVIOUR OF HANDING BACK A MAP OF ALL `None`s, for the same reason
/// `lower_tm_guarded` is `Option` rather than a bool beside a usable-looking `Machine`: a refusal that
/// merely LOOKS like an empty map is the easiest thing here to discard by accident, and this function has
/// TWO callers for which discarding it means two DIFFERENT things.
///
/// `sourcemap.rs`'s `tm_half` is one. Reading "every state maps to `None`" as "no ownership recorded" is
/// TRUE for it, and it already returns empty maps on every OTHER refusal along the same lowering path
/// (`Unsupported`-then-`defunc`-failure, `TooDeep`) — so on this `None` too it takes that same existing
/// branch. For that caller the pre-`Option` behaviour was never wrong, only implicit where it is now a
/// branch a reader can see.
///
/// `attribute.rs`'s `lower_mapped` is the other, and for it "no ownership recorded" does NOT hold:
/// simulating the degenerate machine reports `{ histogram: {}, total: 0, capped: false }` — a program
/// that RAN and cost NOTHING, which is `Attribution::unrepresentable`'s documented wrong answer. That
/// caller used to re-derive only THREE of these four conditions by hand and so had no way to see this
/// one; `Option` is what makes the state ceiling's refusal impossible to leave unhandled there.
#[must_use]
pub fn lower_tm_mapped(prog: &Program, enc: &dyn Encoding) -> Option<(Machine, Vec<Option<usize>>)> {
    let (m, origins, _, was_refused) = lower_tm_all(prog, enc);
    if was_refused { None } else { Some((m, origins)) }
}

/// Lower `prog`, returning the machine AND its overflow-guard state — or `None` if the layout was
/// REFUSED. Halting in that guard state means a value did not fit the encoding's field width; retry
/// at a wider one (`run_tm` does exactly that).
///
/// `None` MEANS NO MACHINE EXISTS, and is a different thing from the guard state entirely: one is
/// "this program is too big to lay out", the other is "this value is too wide for its field". Four
/// conditions produce it — `MAX_SLOTS`, `MAX_FRAME_LOC`, `MAX_MUL_INSTRS` and `MAX_MACHINE_STATES`.
///
/// `Option` RATHER THAN A THIRD TUPLE ELEMENT. A `bool` alongside a `Machine` that looks perfectly
/// usable is the easiest thing in this design to ignore, and ignoring it is precisely the
/// `Ran`-over-empty-tapes bug `lower_and_size`'s doc records: the degenerate machine halts
/// immediately, so a caller that skips the check gets a plausible-looking wrong answer rather than a
/// crash. `Option` makes skipping it not compile.
///
/// Returned as an artifact rather than stored on `Machine` for the same reason as the origin map:
/// `Machine` derives `PartialEq` and the TM text round-trip asserts `parse_tm(print_tm(m)) == m`, which
/// a side-table field would break for a reason unrelated to what the machine computes.
#[must_use]
pub fn lower_tm_guarded(prog: &Program, enc: &dyn Encoding) -> Option<(Machine, StateId)> {
    let (m, _, overflow, refused) = lower_tm_all(prog, enc);
    if refused { None } else { Some((m, overflow)) }
}

/// The number of REG-bank fields `prog` needs — the argument `Encoding::init_reg` expects. Public
/// because a caller laying out a bank by hand (an invariant test, a report, a visualizer) needs it and
/// `SlotMap` is crate-internal.
#[must_use]
pub fn n_slots_of(prog: &Program) -> u32 {
    SlotMap::of(prog).n_slots()
}

/// Lower `prog` into a `TAPES`-tape `Machine`. Total and panic-free on any `Program` — but NOT total
/// in the sense of reporting success. `lower_tm_all` is still the ONE lowering implementation behind
/// this, `lower_tm_guarded` and `lower_tm_mapped`, so the three cannot drift on what a machine
/// computes; they DO differ on refusal, and this is the one that hides it.
///
/// **PAST ANY OF `lower_tm_mapped`'s FOUR LAYOUT REFUSALS, THIS DOES NOT FAIL.** `Builder::state`/
/// `accept` is the one choke point every lowering function shares, so past a refusal this silently
/// returns the degenerate machine that choke point built before giving up: a halt-immediately machine
/// starting at `halt`. How many states depends on WHICH refusal fired. `MAX_SLOTS`, `MAX_MUL_INSTRS`,
/// and the `code.len()` pre-check for `MAX_MACHINE_STATES` all run before `lower_tm_all`'s `pc` loop,
/// so a refusal from any of those three returns with as few as two states (`halt`, `overflow`) —
/// nothing else laid out. `MAX_FRAME_LOC` is checked AFTER that loop, which allocates one `pc` state
/// per instruction, so ITS refusal returns `code.len() + 2` states, itself capped at the ceiling —
/// the one length where the formula does not hold is `code.len() == MAX_MACHINE_STATES - 1`, where
/// the loop's last `state` call is refused and the count lands on `MAX_MACHINE_STATES` rather than
/// one past it. That count SCALES WITH THE
/// PROGRAM, which makes it the most convincing fake measurement of the four: more so than the fixed
/// `MAX_MACHINE_STATES` a refusal caught only mid-layout, by `Builder::state`/`accept`'s own ceiling
/// check, produces. Read bare — `.states.len()`, a state count printed in a report — any of these
/// looks like a real measurement; each is the refusal `lower_tm_guarded` was built to make visible,
/// wearing the costume of a number.
///
/// Use `lower_tm_guarded` (or `lower_tm_mapped`, if the state map is also needed) when the caller
/// must know whether the layout was refused — which is every caller near the ceiling. This function
/// exists for callers that have already proven, out of band, that refusal cannot happen (a bound on
/// `prog` established elsewhere) and so have no use for the `Option`.
#[must_use]
pub fn lower_tm(prog: &Program, enc: &dyn Encoding) -> Machine {
    lower_tm_all(prog, enc).0
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
    use crate::tm::build::WORK;
    use crate::tm::encoding::{Binary, Unary};
    use crate::tm::lower_asm::lower_asm;
    use crate::tm::sim::{Caps, DEFAULT_CAPS as CAPS, Status, simulate, simulate_trace};

    /// `lower_tm_guarded` hands the overflow state back as an ARTIFACT (like `lower_tm_mapped`'s origin
    /// map), and it is billed to no instruction — it is scaffolding, allocated alongside `halt`.
    #[test]
    fn lower_tm_guarded_returns_the_overflow_state_as_scaffolding() {
        let (prog, ds) = parse("1 + 2 * 3");
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let program = lower_asm(&core).expect("lowers");

        let (m, overflow) = lower_tm_guarded(&program, &Unary::default()).expect("small demo must not be refused");
        assert!(m.states[overflow as usize].rules.is_empty());
        assert!(!m.states[overflow as usize].accept);

        let (_, origins) = lower_tm_mapped(&program, &Unary::default()).expect("small demo must not be refused");
        assert_eq!(origins[overflow as usize], None, "the guard belongs to no single instruction");

        // The unguarded entry point is the same machine.
        assert_eq!(lower_tm(&program, &Unary::default()), m);
    }

    /// Run `src` on a bank `width` cells wide and report whether it halted in the overflow guard.
    fn halts_in_overflow(src: &str, width: usize) -> bool {
        use crate::tm::sim::simulate_final;
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let program = lower_asm(&core).expect("lowers");
        let enc = Unary::at(width);
        let (m, overflow) = lower_tm_guarded(&program, &enc).expect("small demo must not be refused");
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(n_slots_of(&program));
        let (_, final_state, status, _) = simulate_final(&m, &init, CAPS);
        status == Status::Halted && final_state == overflow
    }

    /// A COMPUTED value that does not fit is caught by `append_work_to_field`'s guard — the universal
    /// REG store, reached by `mov`, `arith`, `compare`, `pop_frame_restore`, `cons`, `head`/`tail`,
    /// `is_empty` and the box ops alike. Both operands here fit a 4-cell field; only the result does not.
    ///
    /// Both overflow shapes are pinned, because one rule is claimed to cover both and they arrive at the
    /// guard differently. `v > width` reaches the trailing `#` with WORK still holding marks; `v ==
    /// width` reaches it with WORK exactly exhausted — the documented `rewind_home` miscount, and the
    /// case a guard that also read WORK would silently miss.
    #[test]
    fn a_computed_value_that_does_not_fit_is_reported() {
        assert!(halts_in_overflow("3 + 3", 4), "6 > 4: overflow with WORK still holding marks");
        assert!(halts_in_overflow("2 + 2", 4), "4 == 4: no padding blank left, WORK exactly exhausted");
        // Sufficient width: no overflow.
        assert!(!halts_in_overflow("3 + 3", 8));
        assert!(!halts_in_overflow("2 + 2", 8));
    }

    /// The two cases from the design spec that NO correctness-based test can catch. At width 4 both
    /// corrupt the REG bank and still decode to the RIGHT answer: `3 - 5` destroys the last field's
    /// trailing `#` and still returns 0; `0 + 5` merges two 4-cell fields into one 9-cell run and still
    /// returns 5. The oversized value in both is the LITERAL 5, so this is the static guard's case, not
    /// the computed-store one. The assertion is on the OUTCOME precisely because the value and even the
    /// decode succeed.
    #[test]
    fn silent_literal_corruption_is_now_reported() {
        assert!(halts_in_overflow("3 - 5", 4), "the literal 5 does not fit a 4-cell field");
        assert!(halts_in_overflow("0 + 5", 4), "the literal 5 does not fit a 4-cell field");
        assert!(!halts_in_overflow("3 - 5", 8));
        assert!(!halts_in_overflow("0 + 5", 8));
    }

    /// A literal too large for the field is known at BUILD time — `n` is a compile-time constant — so
    /// the guard is static: the instruction routes straight to the overflow state and emits no write
    /// chain at all. `41` is stored directly, so widths 4 through 32 must all report overflow.
    #[test]
    fn an_oversized_literal_is_rejected_statically() {
        for w in [4usize, 8, 16, 32] {
            assert!(halts_in_overflow("let x = 41; x", w), "41 must not fit a {w}-cell field");
        }
        assert!(!halts_in_overflow("let x = 41; x", 64));
    }

    /// The static check uses the same STRICT bound as the runtime one: a literal exactly equal to the
    /// width does not fit either.
    #[test]
    fn a_literal_exactly_equal_to_the_width_is_rejected() {
        assert!(halts_in_overflow("let x = 8; x", 8));
        assert!(!halts_in_overflow("let x = 7; x", 8));
    }

    /// The guard fires on a value that reaches the REG bank through a path OTHER than arithmetic, so
    /// the claim "every REG store funnels through `append_work_to_field`" is tested rather than argued.
    /// `mov` (a `let` binding read back) and `cons` (a heap pointer written into a field) are the two
    /// most distinct such paths.
    #[test]
    fn the_guard_covers_non_arithmetic_reg_stores() {
        assert!(halts_in_overflow("let x = 3 + 3; x", 4), "mov of an oversized value");
        assert!(!halts_in_overflow("let x = 3 + 3; x", 8));
    }

    /// As `halts_in_overflow`, but for a higher-order program that must be defunctionalized first.
    fn halts_in_overflow_defunc(src: &str, width: usize) -> bool {
        use crate::tm::sim::simulate_final;
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let defunced = crate::tm::defunc::defunc(&core).expect("defuncs");
        let program = lower_asm(&defunced).expect("lowers");
        let enc = Unary::at(width);
        let (m, overflow) = lower_tm_guarded(&program, &enc).expect("small demo must not be refused");
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(n_slots_of(&program));
        let (_, final_state, status, _) = simulate_final(&m, &init, CAPS);
        status == Status::Halted && final_state == overflow
    }

    /// A mutable-capture program at too narrow a width IS reported — but by the REG guard, not the BOX
    /// one. Every value entering a box is copied out of a register field first (`box_op` and
    /// `box_set_op` both take their value from a `Slot`), so it has already passed the REG guard at the
    /// same width: **a BOX overflow is unreachable through any lowered program.** The BOX guards are
    /// therefore defensive, against a hand-built machine or a future gadget that writes a box field
    /// from somewhere other than a register, and they are tested where they can actually fire — at the
    /// gadget level, in `encoding.rs`. This test pins the reachable half, and the comment records why
    /// it is not evidence about the BOX guard.
    #[test]
    fn a_boxing_program_at_too_narrow_a_width_is_reported() {
        let src = "let mut c = 0; fn ap(f, x) { f(x) } ap(|x| { c = c + x; c }, 5) + c";
        assert!(halts_in_overflow_defunc(src, 4), "5 does not fit a 4-cell field");
        assert!(!halts_in_overflow_defunc(src, 16));
    }

    /// Lower `prog`, run it, and decode field 0 (the `Rr` result) as a unary Nat.
    fn run_nat(prog: &Program) -> Option<u64> {
        let enc = Unary::default();
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
        let m = lower_tm(&prog, &Unary::default());
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
        let m = lower_tm(&prog, &Unary::default());
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
            let m = lower_tm(prog, &Unary::default());
            assert!(m.validate().is_empty(), "{:?}", m.validate());
            let sm = SlotMap::of(prog);
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = Unary::default().init_reg(sm.n_slots());
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
        let m = lower_tm(&prog, &Unary::default());
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        assert!(m.states.len() < 10_000, "must not build an O(n_loc^2) machine; got {}", m.states.len());
    }

    /// A chain of `n` `Mul`s: `Loc(0)=2; Loc(1)=2; Loc(2)=Loc(0)*Loc(1); Loc(3)=Loc(2)*Loc(1); ...` —
    /// the exact shape `MAX_MUL_INSTRS`'s doc measured (there via the front end on `"2 * 2 * ... * 2"`,
    /// here built directly so the test does not depend on the parser/desugarer's own instruction count).
    fn mul_chain(n: u32) -> Program {
        let mut code = vec![Instr::Li(Reg::Loc(0), 2), Instr::Li(Reg::Loc(1), 2)];
        for i in 0..n {
            code.push(Instr::Bin(BinOp::Mul, Reg::Loc(i + 2), Reg::Loc(i + 1), Reg::Loc(1)));
        }
        code.push(Instr::Halt);
        Program { code, labels: vec![] }
    }

    #[test]
    fn program_with_too_many_muls_routes_to_degenerate_halt() {
        // One MORE than MAX_MUL_INSTRS must route to a degenerate halt under EITHER encoding — not
        // build the O(width^2)-per-`Mul` machine (measured, at just one more `Mul` than the bound: on
        // the order of hundreds of thousands of states / hundreds of MB under `Binary` — see
        // `MAX_MUL_INSTRS`'s doc). The guard is unconditional on encoding, so both must degenerate.
        let prog = mul_chain(MAX_MUL_INSTRS + 1);
        for m in [lower_tm(&prog, &Unary::default()), lower_tm(&prog, &Binary::default())] {
            assert!(m.validate().is_empty(), "{:?}", m.validate());
            assert!(m.states.len() < 10_000, "must route to a degenerate halt; got {}", m.states.len());
            let (_tapes, status) = simulate(&m, &vec![Vec::new(); TAPES], CAPS);
            assert_eq!(status, Status::Halted);
        }
    }

    #[test]
    fn at_the_mul_bound_the_machine_still_builds() {
        // Exactly MAX_MUL_INSTRS `Mul`s must still lower to a genuine (non-degenerate) machine: the
        // guard's boundary must not clip a program sitting exactly at the bound.
        let prog = mul_chain(MAX_MUL_INSTRS);
        for m in [lower_tm(&prog, &Unary::default()), lower_tm(&prog, &Binary::default())] {
            assert!(m.validate().is_empty(), "{:?}", m.validate());
            assert!(m.states.len() > 100, "the boundary case must build a real machine, got {} states", m.states.len());
        }
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
            let m = lower_tm(&program, &Unary::default());
            let sm = SlotMap::of(&program);
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = Unary::default().init_reg(sm.n_slots());
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
            let m = lower_tm(&program, &Unary::default());
            let sm = SlotMap::of(&program);
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = Unary::default().init_reg(sm.n_slots());
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
    fn tm_step_count_goldens_binary() {
        // The base-2 counterpart of `tm_step_count_goldens`, above: the SAME three programs at
        // `Binary::default()` — also a 64-cell field, so this is a same-width, cross-encoding
        // comparison rather than a same-program-narrower-bank one (see `width_report.rs`'s Section D /
        // `step_survey.rs`'s Part D for the auto-fit comparison). `init[WORK]` matters here in a way it
        // never did for the unary goldens above: `Binary::init_work()` is a real fixed-width scratch
        // field, not the empty vector `Unary::init_work()` returns.
        fn steps(src: &str) -> usize {
            let (prog, ds) = parse(src);
            assert!(ds.is_empty(), "parse errors: {ds:?}");
            let core = desugar(&prog.unwrap());
            let program = lower_asm(&core).expect("lowers");
            let m = lower_tm(&program, &Binary::default());
            let sm = SlotMap::of(&program);
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = Binary::default().init_reg(sm.n_slots());
            init[WORK] = Binary::default().init_work();
            let trace = simulate_trace(&m, &init, CAPS);
            assert_eq!(trace.status, crate::tm::sim::Status::Halted, "demo must halt: {src}");
            trace.steps.len()
        }
        // CAPTURED the same way as the unary set above: run once, paste the real numbers, re-ran to
        // confirm stable/deterministic. A gadget-cost re-bless moves these too, deliberately.
        assert_eq!(steps("1 + 2 * 3"), 58393);
        assert_eq!(steps("if 2 > 1 { 10 } else { 20 }"), 2495);
        assert_eq!(steps("head(cons(7, nil))"), 3949);
    }

    #[test]
    fn tm_step_count_golden_higher_order_binary() {
        // The base-2 counterpart of `tm_step_count_golden_higher_order`, above: same demo, same defunc
        // retry, `Binary::default()` in place of `Unary::default()`.
        fn steps(src: &str) -> usize {
            let (prog, ds) = parse(src);
            assert!(ds.is_empty(), "parse errors: {ds:?}");
            let core = desugar(&prog.unwrap());
            let defunced = crate::tm::defunc::defunc(&core).expect("defunc succeeds");
            let program = lower_asm(&defunced).expect("defunc'd core lowers first-order");
            let m = lower_tm(&program, &Binary::default());
            let sm = SlotMap::of(&program);
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = Binary::default().init_reg(sm.n_slots());
            init[WORK] = Binary::default().init_work();
            let trace = simulate_trace(&m, &init, CAPS);
            assert_eq!(trace.status, crate::tm::sim::Status::Halted, "demo must halt: {src}");
            trace.steps.len()
        }
        assert_eq!(
            steps(
                "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
                 fn add1(x) { x + 1 } [1, 2].map(add1)"
            ),
            298_214
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
        match run_tm(&prog, &Unary::default(), TM_DEFAULT_CAPS) {
            TmRun::Ran { tapes } => assert_eq!(decode_tape(&tapes, &expected, &Unary::default()), Some(expected)),
            other => panic!("box program did not run on TM: {other:?}"),
        }
    }

    #[test]
    fn every_state_maps_to_the_instruction_that_built_it_or_to_scaffolding() {
        let core = desugar(&parse("fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(3)").0.unwrap());
        let prog = lower_asm(&core).expect("lowers");
        let (m, state_origins) = lower_tm_mapped(&prog, &Unary::default()).expect("small demo must not be refused");
        assert_eq!(state_origins.len(), m.states.len(), "state origins must be parallel to states");
        for (s, origin) in state_origins.iter().enumerate() {
            if let Some(idx) = origin {
                assert!(*idx < prog.code.len(), "state {s} maps to instruction {idx}, out of range");
            }
        }
        // Non-vacuity: a real program must attribute the bulk of its states to instructions, not to
        // scaffolding. Without this the test would pass against an all-`None` map.
        let attributed = state_origins.iter().filter(|o| o.is_some()).count();
        assert!(
            attributed * 2 > m.states.len(),
            "most states should belong to an instruction, got {attributed}/{}",
            m.states.len()
        );
    }

    /// Every instruction's ENTRY state (`pc{i}` — the state the machine occupies when instruction
    /// `i` begins) must bill instruction `i`, never scaffolding.
    ///
    /// Pinned separately from the non-vacuity check above, which it does NOT subsume: that check
    /// sits at ~79% and would still pass with every entry state regressed to `None` (it would only
    /// dip to ~77%). That regression is the dangerous kind — a systematic, one-directional bias
    /// that understates EVERY construct's cost and correspondingly inflates the scaffolding bucket,
    /// silently corrupting the very "cost the user wrote" vs "cost the machinery added" split this
    /// map exists to inform, while still looking entirely plausible in a report. So it gets an
    /// assertion that bites on it specifically rather than one that merely tolerates it.
    #[test]
    fn each_instructions_entry_state_bills_that_instruction() {
        let core = desugar(&parse("fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(3)").0.unwrap());
        let prog = lower_asm(&core).expect("lowers");
        let (m, state_origins) = lower_tm_mapped(&prog, &Unary::default()).expect("small demo must not be refused");
        for i in 0..prog.code.len() {
            let name = format!("pc{i}");
            let entries: Vec<usize> =
                m.states.iter().enumerate().filter(|(_, s)| s.name == name).map(|(s, _)| s).collect();
            assert_eq!(entries.len(), 1, "expected exactly one entry state named `{name}`, found {entries:?}");
            assert_eq!(
                state_origins[entries[0]],
                Some(i),
                "instruction {i}'s entry state `{name}` must bill instruction {i}, not scaffolding"
            );
        }
        // The machine begins by executing instruction 0, so its start state bills instruction 0.
        assert_eq!(state_origins[m.start as usize], Some(0), "the start state must bill instruction 0");
    }

    #[test]
    fn box_get_of_null_handle_spins_to_a_cap() {
        use crate::core::{Core, NodeGen};
        use crate::tm::{TmCaps, TmRun, Unary, run_tm};
        // $box_get(0) — a null handle. Mirrors head_tail_faults_spin_to_a_cap.
        let mut g = NodeGen::default();
        let get =
            Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), "$box_get".into())), vec![Core::Nat(g.fresh(), 0)]);
        assert!(matches!(run_tm(&get, &Unary::default(), TmCaps { steps: 50_000, cells: 50_000 }), TmRun::HitCap));
    }
}
