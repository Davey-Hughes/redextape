//! Lazy asm stepping, and THE asm interpreter in this crate. `tm::asm::run_asm` is written over this
//! cursor, so the fetch-decode-execute loop exists once — the arrangement `TmCursor` already has with
//! the simulator. The machine state below is what `run_asm` held privately before it stepped; it moved
//! here rather than being copied, so the two cannot disagree about what an instruction does.
//!
//! **AN ASM STEP IS NOT A `StepEvent`.** `StepEvent`'s consumers end their loops on a variant they do not
//! recognise (its own test `every_step_event_variant_has_a_declared_producer` says why), and nothing
//! consumes asm steps generically beside the other two legs. So this cursor yields its own `AsmStep`.
//!
//! **THE GUARD ORDER IS `run_asm`'S SEMANTICS.** Per step: a latched status ends the run; then the step
//! cap; then fetching past the end of `code` faults; then the instruction runs, and its own cap or fault
//! ends the run before it has changed anything. Only an instruction that completes counts as a step, so a
//! run capped at exactly the steps it needs halts rather than capping — `halt` is itself a step.
//!
//! **TAGS AND WRITTEN BITS ARE FOR DISPLAY.** Registers hold untyped words, so a list pointer `3`, the
//! number `3` and a box handle `3` look the same. Each word here carries a `WordTag` saying which kind of
//! instruction made it, copied along by everything that moves the word, and each local carries a bit
//! saying whether the current frame has written it. Nothing reads either to decide what an instruction
//! does, so `run_asm`'s results cannot depend on them. `a_run_ends_the_same_whatever_its_tags_and_written_bits_say`
//! holds this over random hand-built programs; its doc says why not compiled ones.

use crate::core::BinOp;
use crate::tm::asm::{AsmOutcome, Caps, Instr, Program, Reg, instr_reg_over_cap};
use std::borrow::Borrow;

/// One executed instruction: its index in `Program::code`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AsmStep {
    pub pc: usize,
}

/// Which cap stopped a run. A UI needs the distinction: raising the step cap resumes a run capped on
/// steps and cannot help one capped on its stack, heap or saved-frame memory.
///
/// **IT TAKES THE SERDE AND TS DERIVES, AND `AsmStatus` BELOW DOES NOT.** `redextape-wasm` reports how a
/// leg's run stands in its own `RunStatus`, one vocabulary across legs; the one fact about an asm run that
/// vocabulary cannot carry is which cap stopped it, so this crosses beside it. `AsmStatus` stays a Rust
/// type: its `Faulted` text is an answer, which a boundary reports as the run's value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub enum AsmCap {
    Steps,
    Stack,
    Heap,
    Mem,
}

/// Why a run ended. `None` from `AsmCursor::status` means it has not.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AsmStatus {
    /// Ran `halt`, or `ret` with an empty call stack. The program's result is in `rr`.
    Halted,
    /// A runtime fault, with the text `AsmRun::Fault` carries. The faulting instruction did not
    /// complete, so `pc` still names it — with two exceptions, where no instruction faulted. A fetch past
    /// the end of `code` leaves `pc` on the index it tried: one past the last instruction for a run that
    /// fell through, or a label's own index for a jump to a label past the end. And the `MAX_REGISTERS`
    /// guard faults in `AsmCursor::new`, before any step, so `pc` is 0 wherever the register is.
    Faulted(String),
    /// A cap refused the instruction at `pc` before it changed anything.
    Capped(AsmCap),
}

/// Which kind of instruction made a word. `li`, arithmetic, comparisons and `isempty` make a value;
/// `cons` and `nil` make a list pointer (`nil` is the list word 0); `box` makes a box handle. Everything
/// else copies the tag of the word it moves: `mov` its source's, `head` and `tail` the tag stored with
/// that half of the cell, `box_get` the tag stored in the box. A register never written reads as a value.
///
/// For a compiled program this is exact: every word starts at one making instruction and every other
/// instruction copies. A hand-written program can use a value as a pointer; the tag then says value,
/// which is true of how the word was made.
///
/// It crosses to JavaScript on every word of `viewmodel::AsmState`, which is how the asm view decides
/// whether `3` reads as `3`, `#3` or `box #3`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub enum WordTag {
    #[default]
    Value,
    List,
    Box,
}

/// One saved call frame: where `ret` resumes, and the caller's locals — with their tags and written bits
/// — as they were at the `call`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AsmFrame {
    pub ret_pc: usize,
    pub saved_locals: Vec<u64>,
    pub saved_tags: Vec<WordTag>,
    pub saved_written: Vec<bool>,
}

/// A cons cell's head and tail, and their tags.
type TaggedCell = ((u64, u64), (WordTag, WordTag));

/// The register machine's state. Kept apart from the program so a step can borrow the program and
/// mutate the state at once.
#[derive(Clone, Debug, Default)]
struct Vm {
    locals: Vec<u64>,
    /// Parallel to `locals`, as `written` is: `write` grows all three together.
    local_tags: Vec<WordTag>,
    /// Whether the current frame has written each local. `call` clears them all; `ret` restores the
    /// caller's.
    written: Vec<bool>,
    args: Vec<u64>,
    arg_tags: Vec<WordTag>,
    rr: u64,
    rr_tag: WordTag,
    heap: Vec<(u64, u64)>,
    /// Parallel to `heap`: the tags of each cell's head and tail. Only `cons` pushes, and it pushes both.
    heap_tags: Vec<(WordTag, WordTag)>,
    boxes: Vec<u64>,
    /// Parallel to `boxes`: `box` pushes both and `box_set` writes both.
    box_tags: Vec<WordTag>,
    /// The register the instruction `exec` last ran wrote. `exec` clears it first, so it is `None` after an
    /// instruction that wrote no register and after one a fault or cap refused.
    wrote: Option<Reg>,
    stack: Vec<AsmFrame>,
    pc: usize,
    steps: u64,
    /// Running total of words held across all frames currently on `stack` (the sum of
    /// `saved_locals.len()`), tracked incrementally so `call` and `ret` stay O(1).
    saved_words: u64,
}

impl Vm {
    fn read(&self, r: Reg) -> u64 {
        match r {
            Reg::Loc(n) => self.locals.get(n as usize).copied().unwrap_or(0),
            Reg::Arg(n) => self.args.get(n as usize).copied().unwrap_or(0),
            Reg::Rr => self.rr,
        }
    }

    fn tag(&self, r: Reg) -> WordTag {
        match r {
            Reg::Loc(n) => self.local_tags.get(n as usize).copied().unwrap_or_default(),
            Reg::Arg(n) => self.arg_tags.get(n as usize).copied().unwrap_or_default(),
            Reg::Rr => self.rr_tag,
        }
    }

    fn write(&mut self, reg: Reg, word: u64, tag: WordTag) {
        match reg {
            Reg::Loc(n) => {
                let at = n as usize;
                grow_set(&mut self.locals, at, word);
                grow_set(&mut self.local_tags, at, tag);
                grow_set(&mut self.written, at, true);
            }
            Reg::Arg(n) => {
                grow_set(&mut self.args, n as usize, word);
                grow_set(&mut self.arg_tags, n as usize, tag);
            }
            Reg::Rr => {
                self.rr = word;
                self.rr_tag = tag;
            }
        }
        self.wrote = Some(reg);
    }

    /// The cell a list pointer names, with its tags. Null faults as "`op` of empty list"; a pointer past
    /// the heap's end faults as "`op` of invalid list pointer", never an index. `p` is a register word a
    /// program can set to any `u64`, so `p - 1` may not fit `usize` on a 32-bit target; `try_from` routes
    /// that case to the same fault rather than truncating into a wrong, in-range index.
    ///
    /// The heap alone decides the fault: the tags are read afterwards, with a default, so a missing tag
    /// changes what the view shows and never what the program does.
    fn cell(&self, p: u64, op: &str) -> Result<TaggedCell, AsmStatus> {
        if p == 0 {
            return Err(AsmStatus::Faulted(format!("{op} of empty list")));
        }
        let (i, cell) = usize::try_from(p - 1)
            .ok()
            .and_then(|i| Some((i, *self.heap.get(i)?)))
            .ok_or_else(|| AsmStatus::Faulted(format!("{op} of invalid list pointer")))?;
        Ok((cell, self.heap_tags.get(i).copied().unwrap_or_default()))
    }

    /// The box a handle names — its index, for the tag, and its slot — by the same rules as `cell`: null
    /// and dangling handles fault. The lookup that finds the slot is the only bounds check, and `boxes`
    /// alone decides it; the caller reads or writes the tag afterwards, and a missing tag gates nothing.
    fn box_slot(&mut self, p: u64, op: &str) -> Result<(usize, &mut u64), AsmStatus> {
        if p == 0 {
            return Err(AsmStatus::Faulted(format!("{op} of null handle")));
        }
        usize::try_from(p - 1)
            .ok()
            .and_then(|i| Some((i, self.boxes.get_mut(i)?)))
            .ok_or_else(|| AsmStatus::Faulted(format!("{op} of invalid handle")))
    }

    /// Run the instruction at `pc`. `Ok(true)` when it ended the program, `Ok(false)` when the run goes
    /// on, `Err` when a cap or fault refused it.
    ///
    /// `clippy::too_many_lines`: one arm per `Instr` variant — the length tracks the instruction set,
    /// not any one arm's complexity.
    ///
    /// `#[inline]` because `next` is this function's only caller and `run_asm` calls `next` once per
    /// instruction: the hint asks for the instruction match to be folded into that per-step loop, where it
    /// sat before this cursor existed, rather than left a call per step by the size heuristics a function
    /// this long meets. No gate holds a figure for it; its effect on `run_asm` was measured with
    /// `asmbench`, the probe in the appendix of `docs/superpowers/plans/2026-09-27-plan7-part5a-asm-core.md`.
    #[allow(clippy::too_many_lines)]
    #[inline]
    fn exec(&mut self, prog: &Program, caps: &Caps) -> Result<bool, AsmStatus> {
        self.wrote = None;
        let Some(instr) = prog.code.get(self.pc) else {
            // Falling off the end without `halt`/`ret` is a lowering invariant violation; a fault rather
            // than a panic.
            return Err(AsmStatus::Faulted("ran past end of program".to_string()));
        };
        match instr {
            Instr::Li(rd, n) => {
                self.write(*rd, *n, WordTag::Value);
                self.pc += 1;
            }
            Instr::Mov(rd, rs) => {
                let (v, t) = (self.read(*rs), self.tag(*rs));
                self.write(*rd, v, t);
                self.pc += 1;
            }
            Instr::Bin(op, rd, ra, rb) => {
                let v = eval_bin(*op, self.read(*ra), self.read(*rb));
                self.write(*rd, v, WordTag::Value);
                self.pc += 1;
            }
            Instr::Jz(r, l) => {
                if self.read(*r) == 0 {
                    self.pc = jump(prog, l)?;
                } else {
                    self.pc += 1;
                }
            }
            Instr::Jmp(l) => self.pc = jump(prog, l)?,
            Instr::Call(l) => {
                if self.stack.len() as u64 >= caps.stack {
                    return Err(AsmStatus::Capped(AsmCap::Stack));
                }
                let target = jump(prog, l)?;
                // Bound the words held across saved frames BEFORE cloning `locals`: a wide register bank
                // cloned on every self-recursive `call` can reach tens of GB well before the frame-count
                // cap fires, and an allocation failure aborts the process. Checking first means the clone
                // that would have crossed the cap is never made.
                let prospective = self.saved_words + self.locals.len() as u64;
                if prospective > caps.mem {
                    return Err(AsmStatus::Capped(AsmCap::Mem));
                }
                self.stack.push(AsmFrame {
                    ret_pc: self.pc + 1,
                    saved_locals: self.locals.clone(),
                    saved_tags: self.local_tags.clone(),
                    saved_written: self.written.clone(),
                });
                // The callee starts with nothing written. Its registers still hold the caller's words —
                // `call` does not clear them — which is what the view marks as left over.
                self.written.fill(false);
                self.saved_words = prospective;
                self.pc = target;
            }
            Instr::Ret => match self.stack.pop() {
                Some(frame) => {
                    self.saved_words -= frame.saved_locals.len() as u64;
                    self.locals = frame.saved_locals;
                    self.local_tags = frame.saved_tags;
                    self.written = frame.saved_written;
                    self.pc = frame.ret_pc;
                }
                // `ret` with an empty stack ends the program, as `halt` does.
                None => return Ok(true),
            },
            Instr::Halt => return Ok(true),
            Instr::Nil(rd) => {
                self.write(*rd, 0, WordTag::List);
                self.pc += 1;
            }
            Instr::Cons(rd, rh, rt) => {
                if self.heap.len() as u64 >= caps.heap {
                    return Err(AsmStatus::Capped(AsmCap::Heap));
                }
                let (h, t) = (self.read(*rh), self.read(*rt));
                self.heap.push((h, t));
                self.heap_tags.push((self.tag(*rh), self.tag(*rt)));
                let ptr = self.heap.len() as u64; // 1-based
                self.write(*rd, ptr, WordTag::List);
                self.pc += 1;
            }
            Instr::Head(rd, rl) => {
                let ((h, _), (th, _)) = self.cell(self.read(*rl), "head")?;
                self.write(*rd, h, th);
                self.pc += 1;
            }
            Instr::Tail(rd, rl) => {
                let ((_, t), (_, tt)) = self.cell(self.read(*rl), "tail")?;
                self.write(*rd, t, tt);
                self.pc += 1;
            }
            Instr::IsEmpty(rd, rl) => {
                let empty = u64::from(self.read(*rl) == 0);
                self.write(*rd, empty, WordTag::Value);
                self.pc += 1;
            }
            Instr::Box(rd, rv) => {
                if self.boxes.len() as u64 >= caps.heap {
                    return Err(AsmStatus::Capped(AsmCap::Heap));
                }
                let v = self.read(*rv);
                self.boxes.push(v);
                self.box_tags.push(self.tag(*rv));
                let ptr = self.boxes.len() as u64; // 1-based
                self.write(*rd, ptr, WordTag::Box);
                self.pc += 1;
            }
            Instr::BoxGet(rd, rb) => {
                let (i, v) = self.box_slot(self.read(*rb), "box_get").map(|(i, slot)| (i, *slot))?;
                let t = self.box_tags.get(i).copied().unwrap_or_default();
                self.write(*rd, v, t);
                self.pc += 1;
            }
            Instr::BoxSet(rb, rv) => {
                let (v, t) = (self.read(*rv), self.tag(*rv));
                let (i, slot) = self.box_slot(self.read(*rb), "box_set")?;
                *slot = v;
                grow_set(&mut self.box_tags, i, t);
                self.pc += 1;
            }
        }
        Ok(false)
    }
}

fn grow_set<T: Copy + Default>(v: &mut Vec<T>, i: usize, val: T) {
    if i >= v.len() {
        v.resize(i + 1, T::default());
    }
    if let Some(slot) = v.get_mut(i) {
        *slot = val;
    }
}

fn eval_bin(op: BinOp, a: u64, b: u64) -> u64 {
    match op {
        BinOp::Add => a.saturating_add(b),
        BinOp::Sub => a.saturating_sub(b), // monus
        BinOp::Mul => a.saturating_mul(b),
        BinOp::Eq => u64::from(a == b),
        BinOp::Ne => u64::from(a != b),
        BinOp::Lt => u64::from(a < b),
        BinOp::Le => u64::from(a <= b),
        BinOp::Gt => u64::from(a > b),
        BinOp::Ge => u64::from(a >= b),
    }
}

/// The index a jump or call lands on, or the fault `run_asm` has always reported for an undefined label.
fn jump(prog: &Program, label: &str) -> Result<usize, AsmStatus> {
    prog.label_index(label).ok_or_else(|| AsmStatus::Faulted(format!("undefined label `{label}`")))
}

/// Lazy asm stepping over a borrowed or owned `Program`, one instruction per `next`.
pub struct AsmCursor<P> {
    prog: P,
    vm: Vm,
    caps: Caps,
    status: Option<AsmStatus>,
}

impl<P: Borrow<Program>> AsmCursor<P> {
    /// A cursor about to run `prog`'s instruction 0.
    ///
    /// A register index at or over `MAX_REGISTERS` anywhere in `prog` faults here, before any step: an
    /// unbounded `Reg::Loc(n)` would make a write attempt a multi-GB `Vec::resize`, whose allocation
    /// failure aborts. One O(code) scan up front costs nothing per step.
    pub fn new(prog: P, caps: Caps) -> AsmCursor<P> {
        let status = prog
            .borrow()
            .code
            .iter()
            .any(instr_reg_over_cap)
            .then(|| AsmStatus::Faulted("register index exceeds MAX_REGISTERS".to_string()));
        AsmCursor { prog, vm: Vm::default(), caps, status }
    }

    /// The program being stepped.
    pub fn program(&self) -> &Program {
        self.prog.borrow()
    }

    /// The instruction about to run — or, once the run has ended, the one that halted, faulted or was
    /// capped. The two faults no instruction raised leave it elsewhere, as `AsmStatus::Faulted` says: a
    /// fetch past the end of `code` leaves the index it tried, and the `MAX_REGISTERS` guard leaves 0.
    pub fn pc(&self) -> usize {
        self.vm.pc
    }

    /// The result register: what a callee returns in, and at `halt` the program's result.
    pub fn rr(&self) -> u64 {
        self.vm.rr
    }

    /// `rr`'s tag.
    pub fn rr_tag(&self) -> WordTag {
        self.vm.rr_tag
    }

    /// The current frame's local registers `r0…`. The bank grows to reach each register written and does
    /// not shrink while a frame runs; `call` hands it to the callee as it is, and `ret` puts back the
    /// caller's as it was at the `call`, dropping any register the callee grew it by. A register past the
    /// end reads 0.
    pub fn locals(&self) -> &[u64] {
        &self.vm.locals
    }

    /// Parallel to `locals`.
    pub fn local_tags(&self) -> &[WordTag] {
        &self.vm.local_tags
    }

    /// Parallel to `locals`: whether the current frame has written each one. A local it has not written
    /// holds either a word from before the frame began — a caller's, which `call` leaves in place — or the
    /// `0` a write to a higher register filled it with when the bank grew past it. The outermost frame has
    /// no caller, so its unwritten locals are all of the second kind.
    pub fn written(&self) -> &[bool] {
        &self.vm.written
    }

    /// The argument registers `a0…`, as far as the highest one written.
    pub fn args(&self) -> &[u64] {
        &self.vm.args
    }

    /// Parallel to `args`.
    pub fn arg_tags(&self) -> &[WordTag] {
        &self.vm.arg_tags
    }

    /// The saved call frames, oldest first.
    pub fn stack(&self) -> &[AsmFrame] {
        &self.vm.stack
    }

    /// The cons cells, in allocation order; list pointer `p` names cell `p - 1`.
    pub fn heap(&self) -> &[(u64, u64)] {
        &self.vm.heap
    }

    /// Parallel to `heap`: each cell's head and tail tags.
    pub fn heap_tags(&self) -> &[(WordTag, WordTag)] {
        &self.vm.heap_tags
    }

    /// The boxes, in allocation order; handle `p` names box `p - 1`.
    pub fn boxes(&self) -> &[u64] {
        &self.vm.boxes
    }

    /// Parallel to `boxes`.
    pub fn box_tags(&self) -> &[WordTag] {
        &self.vm.box_tags
    }

    /// The register the last step wrote: `None` before any step, after one that wrote no register (a jump,
    /// `call`, `ret`, `halt` or `box_set`), and after an instruction a fault or a stack, heap or memory cap
    /// refused, which wrote nothing. A step cap refuses before any instruction runs and leaves it as the
    /// last step set it.
    pub fn wrote(&self) -> Option<Reg> {
        self.vm.wrote
    }

    /// Instructions completed. `halt` counts; a faulted or capped instruction does not.
    pub fn steps_taken(&self) -> u64 {
        self.vm.steps
    }

    /// `None` while the run may still advance; `Some` once it has ended, saying why.
    pub fn status(&self) -> Option<&AsmStatus> {
        self.status.as_ref()
    }

    /// Extend the step budget, additively and saturating, and resume a run the STEP cap stopped. A run
    /// stopped by any other cap, halted or faulted stays stopped: more steps cannot give it a deeper stack,
    /// a larger heap or a different answer.
    pub fn raise_cap(&mut self, extra_steps: u64) {
        self.caps.steps = self.caps.steps.saturating_add(extra_steps);
        if self.status == Some(AsmStatus::Capped(AsmCap::Steps)) {
            self.status = None;
        }
    }

    /// The result word and the heap a decode needs, for a caller that has driven the run to its end.
    pub fn into_outcome(self) -> AsmOutcome {
        AsmOutcome { result: self.vm.rr, heap: self.vm.heap }
    }
}

impl<P: Borrow<Program>> Iterator for AsmCursor<P> {
    type Item = AsmStep;

    fn next(&mut self) -> Option<AsmStep> {
        if self.status.is_some() {
            return None;
        }
        if self.vm.steps >= self.caps.steps {
            self.status = Some(AsmStatus::Capped(AsmCap::Steps));
            return None;
        }
        let pc = self.vm.pc;
        match self.vm.exec(self.prog.borrow(), &self.caps) {
            Ok(ended) => {
                self.vm.steps += 1;
                if ended {
                    self.status = Some(AsmStatus::Halted);
                }
                Some(AsmStep { pc })
            }
            Err(stop) => {
                self.status = Some(stop);
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::asm::DEFAULT_CAPS;

    fn label(name: &str) -> String {
        name.to_string()
    }

    /// `if 1 == 2 { rr = 10 } else { rr = 20 }`: `jz` at 3 is taken to `else` at 6, then `halt` at 7.
    fn branch() -> Program {
        Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 1),
                Instr::Li(Reg::Loc(1), 2),
                Instr::Bin(BinOp::Eq, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
                Instr::Jz(Reg::Loc(2), label("else")),
                Instr::Li(Reg::Rr, 10),
                Instr::Jmp(label("end")),
                Instr::Li(Reg::Rr, 20),
                Instr::Halt,
            ],
            labels: vec![(label("else"), 6), (label("end"), 7)],
        }
    }

    /// `sum(5)` by recursion: `a0` carries the argument and each activation copies it to `r0`, a
    /// frame-saved local. The first `call` returns to 2 and every recursive one to 12.
    fn sum5() -> Program {
        Program {
            code: vec![
                Instr::Li(Reg::Arg(0), 5),
                Instr::Call(label("sum")),
                Instr::Halt,
                Instr::Mov(Reg::Loc(0), Reg::Arg(0)),
                Instr::Li(Reg::Loc(1), 0),
                Instr::Bin(BinOp::Eq, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
                Instr::Jz(Reg::Loc(2), label("rec")),
                Instr::Li(Reg::Rr, 0),
                Instr::Ret,
                Instr::Li(Reg::Loc(3), 1),
                Instr::Bin(BinOp::Sub, Reg::Arg(0), Reg::Loc(0), Reg::Loc(3)),
                Instr::Call(label("sum")),
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Rr),
                Instr::Ret,
            ],
            labels: vec![(label("sum"), 3), (label("rec"), 9)],
        }
    }

    #[test]
    fn each_step_names_the_instruction_it_ran() {
        let mut c = AsmCursor::new(branch(), DEFAULT_CAPS);
        let pcs: Vec<usize> = c.by_ref().map(|s| s.pc).collect();
        assert_eq!(pcs, [0, 1, 2, 3, 6, 7], "the taken `jz` skips 4 and 5");
        assert_eq!(c.status(), Some(&AsmStatus::Halted));
        assert_eq!(c.steps_taken(), 6, "`halt` is a step");
        assert_eq!(c.rr(), 20);
        assert_eq!(c.pc(), 7, "a halted run keeps `pc` on its `halt`");
    }

    /// At the deepest point of `sum(5)` six frames are saved: the top-level call's, returning to 2 with no
    /// locals yet, and five recursive ones returning to 12, each holding its activation's `n` in `r0`.
    #[test]
    fn the_stack_holds_each_frames_return_and_saved_locals() {
        let mut c = AsmCursor::new(sum5(), DEFAULT_CAPS);
        let mut deepest: Vec<AsmFrame> = Vec::new();
        while c.next().is_some() {
            if c.stack().len() > deepest.len() {
                deepest = c.stack().to_vec();
            }
        }
        let rets: Vec<usize> = deepest.iter().map(|f| f.ret_pc).collect();
        assert_eq!(rets, [2, 12, 12, 12, 12, 12]);
        let saved_n: Vec<Option<u64>> = deepest.iter().map(|f| f.saved_locals.first().copied()).collect();
        assert_eq!(saved_n, [None, Some(5), Some(4), Some(3), Some(2), Some(1)]);
        assert_eq!(c.status(), Some(&AsmStatus::Halted));
        assert_eq!(c.into_outcome().result, 15);
    }

    /// A budget spent exactly is not a budget exceeded: at the step count the run needs, it halts; one
    /// fewer caps it on steps, and raising the cap by one finishes it with the same answer.
    #[test]
    fn a_run_capped_at_exactly_its_steps_halts() {
        let exact = Caps { steps: 6, ..DEFAULT_CAPS };
        let mut c = AsmCursor::new(branch(), exact);
        c.by_ref().for_each(drop);
        assert_eq!(c.status(), Some(&AsmStatus::Halted));

        let mut short = AsmCursor::new(branch(), Caps { steps: 5, ..DEFAULT_CAPS });
        short.by_ref().for_each(drop);
        assert_eq!(short.status(), Some(&AsmStatus::Capped(AsmCap::Steps)));
        assert_eq!((short.steps_taken(), short.pc()), (5, 7), "capped before `halt` ran");
        short.raise_cap(1);
        assert_eq!(short.status(), None, "a step cap is the one raising the cap resumes");
        short.by_ref().for_each(drop);
        assert_eq!((short.status(), short.rr()), (Some(&AsmStatus::Halted), 20));
    }

    /// Each cap is named, and only the step cap resumes: more steps cannot deepen a stack, grow a heap or
    /// widen the memory for saved frames.
    #[test]
    fn each_cap_is_named_and_only_the_step_cap_resumes() {
        let recurse = Program { code: vec![Instr::Call(label("f"))], labels: vec![(label("f"), 0)] };
        let wide = Program {
            code: vec![Instr::Li(Reg::Loc(1000), 1), Instr::Call(label("f"))],
            labels: vec![(label("f"), 1)],
        };
        let conses = Program {
            code: vec![
                Instr::Nil(Reg::Loc(0)),
                Instr::Cons(Reg::Loc(1), Reg::Loc(0), Reg::Loc(0)),
                Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        let boxes = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 1),
                Instr::Box(Reg::Loc(1), Reg::Loc(0)),
                Instr::Box(Reg::Loc(2), Reg::Loc(0)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        let spin = Program { code: vec![Instr::Jmp(label("l"))], labels: vec![(label("l"), 0)] };
        let cases = [
            (recurse, Caps { stack: 3, ..DEFAULT_CAPS }, AsmCap::Stack, 3, 0),
            (wide, Caps { mem: 5000, ..DEFAULT_CAPS }, AsmCap::Mem, 5, 1),
            (conses, Caps { heap: 1, ..DEFAULT_CAPS }, AsmCap::Heap, 2, 2),
            (boxes, Caps { heap: 1, ..DEFAULT_CAPS }, AsmCap::Heap, 2, 2),
            (spin, Caps { steps: 1000, ..DEFAULT_CAPS }, AsmCap::Steps, 1000, 0),
        ];
        for (prog, caps, cap, steps, pc) in cases {
            let mut c = AsmCursor::new(prog, caps);
            c.by_ref().for_each(drop);
            assert_eq!(c.status(), Some(&AsmStatus::Capped(cap)));
            assert_eq!((c.steps_taken(), c.pc()), (steps, pc), "{cap:?}: the refused instruction did not run");
            c.raise_cap(10);
            let resumed = c.status().is_none();
            assert_eq!(resumed, cap == AsmCap::Steps, "{cap:?}: only a step cap resumes");
        }
    }

    /// A fault ends the run on the instruction that faulted, which did not complete, with the text
    /// `run_asm` reports; raising the cap cannot resume it.
    #[test]
    fn a_fault_stops_on_the_faulting_instruction() {
        let prog = Program {
            code: vec![Instr::Nil(Reg::Loc(0)), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        };
        let mut c = AsmCursor::new(prog, DEFAULT_CAPS);
        let pcs: Vec<usize> = c.by_ref().map(|s| s.pc).collect();
        assert_eq!(pcs, [0]);
        assert_eq!(c.status(), Some(&AsmStatus::Faulted("head of empty list".to_string())));
        assert_eq!((c.steps_taken(), c.pc()), (1, 1));
        c.raise_cap(10);
        assert!(c.status().is_some(), "a fault is not a budget");
    }

    /// Every row of `WordTag`'s table, once. Cell 2 is hand-built with a VALUE in its tail, which no
    /// compiled program makes: `tail` must copy that tag, not assume a list. `box_set` stores a value over
    /// a list, so the `box_get` either side of it must disagree.
    #[test]
    fn every_instruction_tags_its_word_by_the_table() {
        use WordTag::{Box as B, List as L, Value as V};
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 7),
                Instr::Nil(Reg::Loc(1)),
                Instr::Cons(Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
                Instr::Cons(Reg::Loc(3), Reg::Loc(2), Reg::Loc(0)),
                Instr::Head(Reg::Loc(4), Reg::Loc(3)),
                Instr::Tail(Reg::Loc(5), Reg::Loc(3)),
                Instr::Head(Reg::Loc(6), Reg::Loc(2)),
                Instr::Tail(Reg::Loc(7), Reg::Loc(2)),
                Instr::Mov(Reg::Loc(8), Reg::Loc(4)),
                Instr::IsEmpty(Reg::Loc(9), Reg::Loc(1)),
                Instr::Bin(BinOp::Eq, Reg::Loc(10), Reg::Loc(0), Reg::Loc(0)),
                Instr::Box(Reg::Loc(11), Reg::Loc(1)),
                Instr::BoxGet(Reg::Loc(12), Reg::Loc(11)),
                Instr::BoxSet(Reg::Loc(11), Reg::Loc(0)),
                Instr::BoxGet(Reg::Rr, Reg::Loc(11)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        let mut c = AsmCursor::new(prog, DEFAULT_CAPS);
        c.by_ref().for_each(drop);
        assert_eq!(c.status(), Some(&AsmStatus::Halted));
        // One assertion over every tag, so a sabotage of any row reddens the same comparison.
        assert_eq!(
            (c.local_tags(), c.locals(), c.heap_tags(), c.box_tags(), c.rr(), c.rr_tag()),
            (
                &[V, L, L, L, L, V, V, L, L, V, V, B, L][..],
                &[7, 0, 1, 2, 1, 7, 7, 0, 1, 1, 1, 1, 0][..],
                &[(V, L), (L, V)][..],
                &[V][..],
                7,
                V
            ),
        );
    }

    /// `call` clears every written bit and leaves the words — the callee sees its caller's registers as
    /// left over — and `ret` brings the caller's bits back with its locals. `wrote` names the register
    /// each step wrote and nothing for a step that wrote none.
    #[test]
    fn call_clears_written_bits_and_ret_restores_them() {
        use WordTag::Value as V;
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 1),
                Instr::Li(Reg::Loc(1), 2),
                Instr::Call(label("f")),
                Instr::Halt,
                Instr::Li(Reg::Loc(1), 9),
                Instr::Ret,
            ],
            labels: vec![(label("f"), 4)],
        };
        let mut c = AsmCursor::new(prog, DEFAULT_CAPS);
        assert_eq!((c.written(), c.wrote()), (&[][..], None));
        c.next();
        assert_eq!(c.wrote(), Some(Reg::Loc(0)));
        c.next();
        c.next(); // call f
        assert_eq!(c.wrote(), None, "`call` writes no register");
        assert_eq!((c.locals(), c.written()), (&[1, 2][..], &[false, false][..]), "left over, none written");
        let frame = &c.stack()[0];
        assert_eq!((&frame.saved_written[..], &frame.saved_tags[..]), (&[true, true][..], &[V, V][..]));
        c.next(); // li r1, #9
        assert_eq!((c.wrote(), c.written()), (Some(Reg::Loc(1)), &[false, true][..]));
        c.next(); // ret
        assert_eq!((c.wrote(), c.locals(), c.written()), (None, &[1, 2][..], &[true, true][..]));
    }

    /// A refused instruction wrote nothing, and `wrote` says so, though the `nil` before it wrote `r0`.
    #[test]
    fn a_refused_instruction_wrote_nothing() {
        let prog = Program {
            code: vec![Instr::Nil(Reg::Loc(0)), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        };
        let mut c = AsmCursor::new(prog, DEFAULT_CAPS);
        c.by_ref().for_each(drop);
        assert!(matches!(c.status(), Some(AsmStatus::Faulted(_))));
        assert_eq!(c.wrote(), None);
    }

    /// `wrote` is `None` after each step besides `call` and `ret` that writes no register: a taken and an
    /// untaken `jz`, `box_set`, `jmp` and `halt`. Each runs straight after an `li` or `box` that did write
    /// one, so a `None` left over from an earlier step cannot pass for a cleared one; the taken jumps skip
    /// a `halt`, and the box ends up holding the 5 `box_set` stored, so each instruction did run.
    #[test]
    fn wrote_is_none_after_a_jump_box_set_and_halt() {
        let (r0, r1, r2, r3, r4) = (Reg::Loc(0), Reg::Loc(1), Reg::Loc(2), Reg::Loc(3), Reg::Loc(4));
        let prog = Program {
            code: vec![
                Instr::Li(r0, 0),
                Instr::Box(r1, r0),
                Instr::Jz(r0, label("a")),
                Instr::Halt,
                Instr::Li(r2, 5),
                Instr::BoxSet(r1, r2),
                Instr::Li(r3, 1),
                Instr::Jz(r3, label("a")),
                Instr::Li(r4, 2),
                Instr::Jmp(label("b")),
                Instr::Halt,
                Instr::Li(Reg::Rr, 7),
                Instr::Halt,
            ],
            labels: vec![(label("a"), 4), (label("b"), 11)],
        };
        let mut c = AsmCursor::new(prog, DEFAULT_CAPS);
        let (mut pcs, mut wrote) = (Vec::new(), Vec::new());
        while let Some(step) = c.next() {
            pcs.push(step.pc);
            wrote.push(c.wrote());
        }
        assert_eq!(pcs, [0, 1, 2, 4, 5, 6, 7, 8, 9, 11, 12]);
        let (s0, s1, s2, s3, s4, rr) = (Some(r0), Some(r1), Some(r2), Some(r3), Some(r4), Some(Reg::Rr));
        assert_eq!(wrote, [s0, s1, None, s2, None, s3, None, s4, None, rr, None]);
        assert_eq!((c.status(), c.boxes()), (Some(&AsmStatus::Halted), &[5][..]));
    }

    #[test]
    fn an_over_cap_register_faults_before_any_step() {
        let prog = Program { code: vec![Instr::Li(Reg::Loc(2_000_000), 1), Instr::Halt], labels: vec![] };
        let mut c = AsmCursor::new(prog, DEFAULT_CAPS);
        assert_eq!(c.next(), None);
        assert_eq!(c.status(), Some(&AsmStatus::Faulted("register index exceeds MAX_REGISTERS".to_string())));
        assert_eq!(c.steps_taken(), 0);
    }

    /// Every fault text the interpreter can produce, with the steps it completed and the `pc` it stops on.
    /// A faulting instruction names itself; a fetch past the end of `code` stops on the index it tried —
    /// one past the end for a run that fell through, the label's own index (7) for a jump past the end —
    /// and the register guard stops before any step, at 0, though the register is in instruction 1. Each
    /// dangling pointer or handle is ONE past a real cell or box, the nearest one that must fault.
    #[test]
    fn every_fault_has_its_text_and_stops_where_the_status_says() {
        let (r0, r1, r2, rr) = (Reg::Loc(0), Reg::Loc(1), Reg::Loc(2), Reg::Rr);
        let prog = |code: Vec<Instr>| Program { code, labels: vec![(label("far"), 7)] };
        let one_cell = |last: Instr| prog(vec![Instr::Nil(r1), Instr::Cons(r0, r1, r1), Instr::Li(r2, 2), last]);
        let one_box = |last: Instr| prog(vec![Instr::Box(r0, r1), Instr::Li(r2, 2), last]);
        let nowhere = label("nowhere");
        let cases = [
            ("head of empty list", prog(vec![Instr::Nil(r0), Instr::Head(rr, r0)]), 1, 1),
            ("tail of empty list", prog(vec![Instr::Nil(r0), Instr::Tail(rr, r0)]), 1, 1),
            ("head of invalid list pointer", one_cell(Instr::Head(rr, r2)), 3, 3),
            ("tail of invalid list pointer", one_cell(Instr::Tail(rr, r2)), 3, 3),
            ("box_get of null handle", prog(vec![Instr::Li(r0, 0), Instr::BoxGet(rr, r0)]), 1, 1),
            ("box_set of null handle", prog(vec![Instr::Li(r0, 0), Instr::BoxSet(r0, r1)]), 1, 1),
            ("box_get of invalid handle", one_box(Instr::BoxGet(rr, r2)), 2, 2),
            ("box_set of invalid handle", one_box(Instr::BoxSet(r2, r1)), 2, 2),
            ("undefined label `nowhere`", prog(vec![Instr::Li(r0, 0), Instr::Jz(r0, nowhere.clone())]), 1, 1),
            ("undefined label `nowhere`", prog(vec![Instr::Li(r0, 0), Instr::Jmp(nowhere.clone())]), 1, 1),
            ("undefined label `nowhere`", prog(vec![Instr::Li(r0, 0), Instr::Call(nowhere)]), 1, 1),
            ("ran past end of program", prog(vec![Instr::Li(r0, 0), Instr::Li(r1, 0)]), 2, 2),
            ("ran past end of program", prog(vec![Instr::Li(r0, 0), Instr::Jmp(label("far"))]), 2, 7),
            ("register index exceeds MAX_REGISTERS", prog(vec![Instr::Halt, Instr::Li(Reg::Arg(u32::MAX), 1)]), 0, 0),
        ];
        for (text, prog, steps, pc) in cases {
            let mut c = AsmCursor::new(prog, DEFAULT_CAPS);
            c.by_ref().for_each(drop);
            let got = (c.status(), c.steps_taken(), c.pc());
            assert_eq!(got, (Some(&AsmStatus::Faulted(text.to_string())), steps, pc), "{text}");
        }
    }

    /// `call` checks its stack cap, then its label, then the memory for saved frames. So a `call` to an
    /// undefined label on a full stack is capped, not faulted; and one to an undefined label with a wide
    /// bank and no memory to save it faults, not capped. The same `call`s to a defined label show each
    /// configuration does arm the cap it names.
    #[test]
    fn call_checks_the_stack_then_the_label_then_the_memory() {
        let run = |target: &str, caps: Caps| {
            let code = vec![Instr::Li(Reg::Loc(5), 1), Instr::Call(label(target)), Instr::Halt];
            let mut c = AsmCursor::new(Program { code, labels: vec![(label("f"), 2)] }, caps);
            c.by_ref().for_each(drop);
            c.status().cloned()
        };
        let (full_stack, no_mem) = (Caps { stack: 0, ..DEFAULT_CAPS }, Caps { mem: 0, ..DEFAULT_CAPS });
        let undefined = AsmStatus::Faulted("undefined label `nowhere`".to_string());
        assert_eq!(run("nowhere", full_stack), Some(AsmStatus::Capped(AsmCap::Stack)), "the stack before the label");
        assert_eq!(run("nowhere", no_mem), Some(undefined), "the label before the memory");
        assert_eq!(run("f", full_stack), Some(AsmStatus::Capped(AsmCap::Stack)));
        assert_eq!(run("f", no_mem), Some(AsmStatus::Capped(AsmCap::Mem)));
    }

    /// Tags ride `call` and `ret` as the words do. The caller passes a list in `a0`; the callee copies it
    /// over the caller's value in `r1` and returns it in `rr`. After `ret` the caller's own local tags are
    /// back, `a0` still says list, `rr` says list, and a `mov` out of `rr` copies that.
    #[test]
    fn tags_ride_call_and_ret_through_args_locals_and_rr() {
        use WordTag::{List as L, Value as V};
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 7),
                Instr::Li(Reg::Loc(1), 2),
                Instr::Nil(Reg::Loc(2)),
                Instr::Cons(Reg::Arg(0), Reg::Loc(0), Reg::Loc(2)),
                Instr::Call(label("f")),
                Instr::Mov(Reg::Loc(3), Reg::Rr),
                Instr::Halt,
                Instr::Mov(Reg::Loc(1), Reg::Arg(0)),
                Instr::Mov(Reg::Rr, Reg::Loc(1)),
                Instr::Ret,
            ],
            labels: vec![(label("f"), 7)],
        };
        let mut c = AsmCursor::new(prog, DEFAULT_CAPS);
        c.by_ref().take(7).for_each(drop); // up to `ret`
        assert_eq!((c.pc(), c.locals(), c.local_tags()), (9, &[7, 1, 0][..], &[V, L, L][..]), "the callee's list");
        c.next(); // ret
        assert_eq!((c.pc(), c.locals(), c.local_tags()), (5, &[7, 2, 0][..], &[V, V, L][..]), "the caller's own");
        assert_eq!((c.arg_tags(), c.rr(), c.rr_tag()), (&[L][..], 1, L));
        c.by_ref().for_each(drop);
        assert_eq!((c.status(), c.local_tags()), (Some(&AsmStatus::Halted), &[V, V, L, L][..]), "`mov` from `rr`");
    }

    /// A step cap refuses before any instruction runs, so `wrote` still names what the last step wrote.
    #[test]
    fn a_step_cap_leaves_wrote_as_the_last_step_set_it() {
        let mut c = AsmCursor::new(branch(), Caps { steps: 1, ..DEFAULT_CAPS });
        c.by_ref().for_each(drop);
        assert_eq!(c.status(), Some(&AsmStatus::Capped(AsmCap::Steps)));
        assert_eq!((c.steps_taken(), c.wrote()), (1, Some(Reg::Loc(0))));
    }

    /// The words alone decide what an instruction does. A run whose tag vectors are emptied part-way
    /// ends as an untouched run does — same status, result, heap, boxes and locals — though `head`,
    /// `tail`, `box_get` and `box_set` each then run with the tag they read or write missing: nothing
    /// pushes a heap tag again, and the first `box_get` comes before the `box_set` whose write rebuilds
    /// the box's tag. That `box_get` reads the box's 7 into `r6`; `box_set` then stores the list pointer
    /// 1 over it, so a `box_set` that skipped its write would leave `rr` at 7.
    #[test]
    fn missing_tags_change_no_word_and_no_fault() {
        let prog = || Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 7),
                Instr::Nil(Reg::Loc(1)),
                Instr::Cons(Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
                Instr::Box(Reg::Loc(3), Reg::Loc(0)),
                Instr::Head(Reg::Loc(4), Reg::Loc(2)),
                Instr::Tail(Reg::Loc(5), Reg::Loc(2)),
                Instr::BoxGet(Reg::Loc(6), Reg::Loc(3)),
                Instr::BoxSet(Reg::Loc(3), Reg::Loc(2)),
                Instr::BoxGet(Reg::Rr, Reg::Loc(3)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        let mut whole = AsmCursor::new(prog(), DEFAULT_CAPS);
        whole.by_ref().for_each(drop);
        let mut bare = AsmCursor::new(prog(), DEFAULT_CAPS);
        bare.by_ref().take(4).for_each(drop);
        bare.vm.heap_tags.clear();
        bare.vm.box_tags.clear();
        bare.by_ref().for_each(drop);
        assert_eq!((whole.status(), whole.rr(), whole.locals().get(6)), (Some(&AsmStatus::Halted), 1, Some(&7)));
        let words = |c: &AsmCursor<Program>| {
            (c.status().cloned(), c.rr(), c.heap().to_vec(), c.boxes().to_vec(), c.locals().to_vec())
        };
        assert_eq!(words(&bare), words(&whole));
    }

    use proptest::prelude::*;

    /// A register: most often one of four locals, so an instruction often reads a local an earlier one
    /// wrote, or one no earlier one did.
    fn arb_reg() -> impl Strategy<Value = Reg> {
        (0u8..8, 0u32..4).prop_map(|(kind, n)| match kind {
            0..=4 => Reg::Loc(n),
            5 | 6 => Reg::Arg(n),
            _ => Reg::Rr,
        })
    }

    /// One instruction of any of the sixteen kinds. `li`, `cons` and `box` are drawn three times as often
    /// as the rest, so that reads meet words something wrote: a register nothing wrote reads 0, which
    /// `head`, `tail`, `box_get` and `box_set` fault on. Label `d` is never defined, so a jump or call to
    /// it faults.
    fn arb_instr() -> impl Strategy<Value = Instr> {
        let label = prop::sample::select(vec!["a", "b", "c", "d"]).prop_map(str::to_string);
        let ops =
            vec![BinOp::Add, BinOp::Sub, BinOp::Mul, BinOp::Eq, BinOp::Ne, BinOp::Lt, BinOp::Le, BinOp::Gt, BinOp::Ge];
        let parts = (0u8..22, arb_reg(), arb_reg(), arb_reg(), 0u64..4, label, prop::sample::select(ops));
        parts.prop_map(|(kind, a, b, c, n, l, op)| match kind {
            0..=2 => Instr::Li(a, n),
            3 => Instr::Mov(a, b),
            4 => Instr::Bin(op, a, b, c),
            5 => Instr::Jz(a, l),
            6 => Instr::Jmp(l),
            7 => Instr::Call(l),
            8 => Instr::Ret,
            9 => Instr::Halt,
            10 => Instr::Nil(a),
            11 => Instr::IsEmpty(a, b),
            12..=14 => Instr::Cons(a, b, c),
            15 => Instr::Head(a, b),
            16 => Instr::Tail(a, b),
            17..=19 => Instr::Box(a, b),
            20 => Instr::BoxGet(a, b),
            _ => Instr::BoxSet(a, b),
        })
    }

    /// Up to 16 instructions, with labels `a`, `b` and `c` each before an index from 0 to one past the end.
    fn arb_program() -> impl Strategy<Value = Program> {
        let code = prop::collection::vec(arb_instr(), 1..=16);
        (code, prop::array::uniform3(any::<prop::sample::Index>())).prop_map(|(code, at)| {
            let labels = ["a", "b", "c"].into_iter().zip(at).map(|(l, i)| (l.to_string(), i.index(code.len() + 1)));
            Program { labels: labels.collect(), code }
        })
    }

    /// Caps small enough that every one of them stops some runs.
    fn arb_caps() -> impl Strategy<Value = Caps> {
        (1u64..300, 0u64..6, 0u64..12, 0u64..60).prop_map(|(steps, stack, heap, mem)| Caps { steps, stack, heap, mem })
    }

    /// Everything about a run that is not a tag or a written bit: how and where it ended, and every word.
    #[derive(Debug, PartialEq)]
    struct Words {
        status: Option<AsmStatus>,
        steps: u64,
        pc: usize,
        rr: u64,
        locals: Vec<u64>,
        args: Vec<u64>,
        heap: Vec<(u64, u64)>,
        boxes: Vec<u64>,
        frames: Vec<(usize, Vec<u64>)>,
    }

    fn words_of<P: Borrow<Program>>(c: &AsmCursor<P>) -> Words {
        Words {
            status: c.status().cloned(),
            steps: c.steps_taken(),
            pc: c.pc(),
            rr: c.rr(),
            locals: c.locals().to_vec(),
            args: c.args().to_vec(),
            heap: c.heap().to_vec(),
            boxes: c.boxes().to_vec(),
            frames: c.stack().iter().map(|f| (f.ret_pc, f.saved_locals.clone())).collect(),
        }
    }

    /// The tags and written bits `scramble` draws from.
    fn arb_noise() -> impl Strategy<Value = Vec<(WordTag, bool)>> {
        let tag = prop::sample::select(vec![WordTag::Value, WordTag::List, WordTag::Box]);
        prop::collection::vec((tag, any::<bool>()), 1..32)
    }

    /// Overwrite every tag and written bit `vm` holds — each local's, argument's, cell half's and box's,
    /// `rr`'s, and every saved frame's — with `noise`'s, drawn in turn and cycled, starting `turn` places
    /// in, so consecutive calls do not write the same pattern. Every vector keeps its length, so no lookup
    /// of a tag changes whether it finds one.
    fn scramble(vm: &mut Vm, noise: &[(WordTag, bool)], turn: usize) {
        let mut draw = noise.iter().copied().cycle().skip(turn % noise.len().max(1));
        let mut next = move || draw.next().unwrap_or_default();
        vm.local_tags.iter_mut().for_each(|t| *t = next().0);
        vm.written.iter_mut().for_each(|w| *w = next().1);
        vm.arg_tags.iter_mut().for_each(|t| *t = next().0);
        vm.rr_tag = next().0;
        vm.heap_tags.iter_mut().for_each(|(h, t)| (*h, *t) = (next().0, next().0));
        vm.box_tags.iter_mut().for_each(|t| *t = next().0);
        for frame in &mut vm.stack {
            frame.saved_tags.iter_mut().for_each(|t| *t = next().0);
            frame.saved_written.iter_mut().for_each(|w| *w = next().1);
        }
    }

    proptest! {
        // The case count is sized so that each gate the test's doc names fails the test on every seed
        // it was tried with, with cases to spare; lower it only after re-running each gate against the
        // new count.
        #![proptest_config(ProptestConfig { cases: 4096, ..ProptestConfig::default() })]

        /// THE DISPLAY-STATE RULE, over hand-built programs. The oracles run compiled programs, which
        /// tripped neither of two gates when each was tried — `head`, `tail`, `box_get` and `box_set`
        /// faulting on an operand not tagged a list or a box, and `mov`, `jz`, `bin` and `cons` faulting
        /// on reading a local whose written bit is clear — so the rule needs programs that use a word
        /// against its tag and read locals nothing wrote. Each program runs twice with the same caps; before
        /// every step of the second run, every tag and written bit is overwritten with arbitrary values,
        /// and the run must end as the first did, word for word. Both gates fail it, and so does a gate on
        /// `tail`, `box_get` or `box_set` alone that checks the tag only once it has found a real cell or
        /// box.
        #[test]
        fn a_run_ends_the_same_whatever_its_tags_and_written_bits_say(
            prog in arb_program(),
            caps in arb_caps(),
            noise in arb_noise(),
        ) {
            let mut plain = AsmCursor::new(&prog, caps);
            plain.by_ref().for_each(drop);
            let mut scrambled = AsmCursor::new(&prog, caps);
            for turn in 0.. {
                scramble(&mut scrambled.vm, &noise, turn);
                if scrambled.next().is_none() {
                    break;
                }
            }
            prop_assert_eq!(words_of(&scrambled), words_of(&plain));
        }
    }
}
