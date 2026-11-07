//! The lowering walk: one pass over a subroutine's rxm body that decides what each instruction
//! lowers to and in what order, and hands each operation to a `LowerSink`, the backend that spells
//! it. A backend that lowers through it takes every decision from it, so two such backends cannot
//! disagree on one.
//!
//! The walk owns what the backends must agree on: the register banks' sizes, which block a label
//! lands in, where each runtime guard goes, and the order of the reads, calls and writes inside an
//! instruction. A sink owns what each backend spells its own way: creating and ordering blocks,
//! register storage, constants, the out-of-bank read, value names, the conditional branch and
//! saturating arithmetic.
//!
//! The guards are what make a native run total: `rt_tick` before every backward `Jz`/`Jmp` (every
//! loop passes one), `rt_enter` before a `Call` reads its arguments (every recursion passes one), and
//! `rt_faulted` after every runtime call that can fault or allocate. Each leaves for the sink's exit
//! block when it returns nonzero. `rt_leave`, once the call's result is in `rr`, gives back the depth
//! `rt_enter` counted and is not a guard.

use std::collections::HashMap;

use redextape_core::core::BinOp;
use redextape_core::tm::{Instr, Program, Reg};

use crate::analysis::Subroutine;
use crate::rt_imports::RtFn;
use crate::shared::{n_arg_vars, param_count};

/// The sizes of a subroutine's register banks.
#[derive(Clone, Copy)]
pub(crate) struct Banks {
    /// How many `Arg`s arrive as function parameters; the rest of the `Arg` bank starts at `0`.
    pub(crate) params: u32,
    /// The `Arg` bank: every `Arg` the body reads or writes.
    pub(crate) args: u32,
    /// The `Loc` bank, every one starting at `0`.
    pub(crate) locals: u32,
}

/// An instruction's position in its subroutine's `body`. A sink creates one block per `body` entry,
/// in `body`'s order, so this is also the position of that instruction's block. Only the walk makes
/// one, from an index it found in `body`, so a sink may index its blocks with it.
#[derive(Clone, Copy)]
pub(crate) struct BodyPos(usize);

impl BodyPos {
    pub(crate) fn get(self) -> usize {
        self.0
    }
}

/// A program the walk cannot lower: a label, block, entry or callee that is not where `partition`
/// puts it. The message is the backend's error text.
pub(crate) struct LowerFault(pub(crate) String);

/// A backend the walk emits into. Each method appends to the block the sink is positioned in;
/// `begin` and `guard` move that position.
pub(crate) trait LowerSink {
    /// A word.
    type Value: Copy;
    /// A subroutine a `Call` can reach.
    type Callee: Copy;
    /// The walk's own faults convert into the backend's error.
    type Error: From<LowerFault>;

    /// The fault for a subroutine whose entry is not in its body, in the backend's own words.
    fn missing_entry(entry: usize) -> LowerFault;
    /// Position the sink at the start of the block at `at`. Everything the walk lowers before the next
    /// `begin`, or before `finish`, belongs to the instruction at code index `body[at]`, `body` being
    /// what the prologue got, so this is where a sink sets the per-instruction source location.
    fn begin(&mut self, at: BodyPos) -> Result<(), Self::Error>;
    /// The word in `r`; an index past its bank reads `0`, as the rxm interpreter's does.
    fn read(&mut self, r: Reg) -> Result<Self::Value, Self::Error>;
    /// Store `v` in `r`; an index past its bank stores nothing.
    fn write(&mut self, r: Reg, v: Self::Value) -> Result<(), Self::Error>;
    fn constant(&mut self, n: u64) -> Result<Self::Value, Self::Error>;
    /// `x op y` as the rxm interpreter's `eval_bin` computes it: `Add` and `Mul` saturate at
    /// `u64::MAX`, `Sub` is monus, and a comparison is unsigned and yields `0` or `1`.
    fn bin(&mut self, op: BinOp, x: Self::Value, y: Self::Value) -> Result<Self::Value, Self::Error>;
    /// Call `f`, which returns a word, on the runtime pointer followed by `words`.
    fn call_rt(&mut self, f: RtFn, words: &[Self::Value]) -> Result<Self::Value, Self::Error>;
    /// Call `f`, which returns nothing, on the runtime pointer followed by `words`.
    fn call_rt_void(&mut self, f: RtFn, words: &[Self::Value]) -> Result<(), Self::Error>;
    /// Call the guard `f` on the runtime pointer; leave for the exit block when it returns nonzero,
    /// and otherwise continue in a new block, where the sink is left positioned.
    fn guard(&mut self, f: RtFn) -> Result<(), Self::Error>;
    /// The subroutine entered at code index `entry`, if there is one.
    fn callee(&self, entry: usize) -> Option<Self::Callee>;
    /// Call `callee` on the runtime pointer followed by `args`, returning its word.
    fn call_sub(&mut self, callee: Self::Callee, args: &[Self::Value]) -> Result<Self::Value, Self::Error>;
    fn jump(&mut self, to: BodyPos) -> Result<(), Self::Error>;
    /// Branch to `target` when `cond` is `0`, and to `next` otherwise.
    fn jump_if_zero(&mut self, cond: Self::Value, target: BodyPos, next: BodyPos) -> Result<(), Self::Error>;
    fn ret(&mut self, v: Self::Value) -> Result<(), Self::Error>;
    /// Emit whatever the backend puts after the body, which belongs to no instruction.
    fn finish(self) -> Result<(), Self::Error>;
}

/// Lower `sub` through the sink `prologue` returns. `prologue` gets the bank sizes, `body` and the
/// entry instruction's position; it creates one block per `body` entry in `body`'s order, sets up
/// the banks (the first `params` `Arg`s from the parameters, every other register `0`) and
/// branches to the entry block. `arity` gives the number of `Arg`s a subroutine entered at a code
/// index takes.
pub(crate) fn lower_subroutine<S: LowerSink>(
    prog: &Program,
    sub: &Subroutine,
    arity: impl Fn(usize) -> Option<u32>,
    prologue: impl FnOnce(Banks, &[usize], BodyPos) -> Result<S, S::Error>,
) -> Result<(), S::Error> {
    let walk = Walk { prog, at: sub.body.iter().enumerate().map(|(k, &idx)| (idx, k)).collect(), arity };
    let entry = walk.at.get(&sub.entry).map(|&k| BodyPos(k)).ok_or_else(|| S::missing_entry(sub.entry))?;
    let banks = Banks { params: param_count(sub), args: n_arg_vars(prog, sub), locals: sub.n_locals };
    let mut sink = prologue(banks, &sub.body, entry)?;
    for (k, &idx) in sub.body.iter().enumerate() {
        sink.begin(BodyPos(k))?;
        let instr = prog.code.get(idx).ok_or_else(|| LowerFault(format!("index {idx} is past the end of code")))?;
        walk.instr(&mut sink, idx, instr)?;
    }
    sink.finish()
}

struct Walk<'p, A> {
    prog: &'p Program,
    /// Code index to its position in `body`.
    at: HashMap<usize, usize>,
    arity: A,
}

impl<A: Fn(usize) -> Option<u32>> Walk<'_, A> {
    fn block(&self, idx: usize) -> Result<BodyPos, LowerFault> {
        self.at.get(&idx).map(|&k| BodyPos(k)).ok_or_else(|| LowerFault(format!("no block for index {idx}")))
    }

    fn label(&self, l: &str) -> Result<usize, LowerFault> {
        self.prog.label_index(l).ok_or_else(|| LowerFault(format!("undefined label `{l}`")))
    }

    /// Lower the instruction at code index `idx`, ending its block.
    fn instr<S: LowerSink>(&self, sink: &mut S, idx: usize, instr: &Instr) -> Result<(), S::Error> {
        let next = || self.block(idx + 1);
        match instr {
            Instr::Li(rd, n) => {
                let v = sink.constant(*n)?;
                sink.write(*rd, v)?;
                sink.jump(next()?)
            }
            Instr::Mov(rd, rs) => {
                let v = sink.read(*rs)?;
                sink.write(*rd, v)?;
                sink.jump(next()?)
            }
            Instr::Nil(rd) => {
                let v = sink.constant(0)?;
                sink.write(*rd, v)?;
                sink.jump(next()?)
            }
            Instr::Bin(op, rd, ra, rb) => {
                let x = sink.read(*ra)?;
                let y = sink.read(*rb)?;
                let v = sink.bin(*op, x, y)?;
                sink.write(*rd, v)?;
                sink.jump(next()?)
            }
            Instr::Jz(r, l) => {
                let target = self.label(l)?;
                if target <= idx {
                    sink.guard(RtFn::Tick)?;
                }
                let cond = sink.read(*r)?;
                sink.jump_if_zero(cond, self.block(target)?, next()?)
            }
            Instr::Jmp(l) => {
                let target = self.label(l)?;
                if target <= idx {
                    sink.guard(RtFn::Tick)?;
                }
                sink.jump(self.block(target)?)
            }
            Instr::Call(l) => {
                let target = self.label(l)?;
                sink.guard(RtFn::Enter)?;
                let callee = sink.callee(target).ok_or_else(|| LowerFault("call to non-subroutine".into()))?;
                let n = (self.arity)(target).ok_or_else(|| LowerFault("unknown callee arity".into()))?;
                let args = (0..n).map(|i| sink.read(Reg::Arg(i))).collect::<Result<Vec<_>, _>>()?;
                let v = sink.call_sub(callee, &args)?;
                sink.write(Reg::Rr, v)?;
                // After the call, never before: an opaque call after it keeps the call out of tail
                // position, so no backend can turn a self-call into a loop. Each nested `Call` then
                // holds one real native frame, which `rt_enter` has counted; that count is what trips
                // the frame-size-aware depth cap before the native stack runs out. Before the call,
                // a tail call would recurse without growing the count: a hang, not a `HitCap`.
                sink.call_rt_void(RtFn::Leave, &[])?;
                sink.jump(next()?)
            }
            // `partition` rejects a `Halt` outside `$main`, so a `Halt` here ends `$main`, where
            // returning to the driver is stopping the program.
            Instr::Ret | Instr::Halt => {
                let v = sink.read(Reg::Rr)?;
                sink.ret(v)
            }
            Instr::Cons(rd, rh, rt) => {
                let h = sink.read(*rh)?;
                let t = sink.read(*rt)?;
                let v = sink.call_rt(RtFn::Cons, &[h, t])?;
                sink.write(*rd, v)?;
                sink.guard(RtFn::Faulted)?;
                sink.jump(next()?)
            }
            Instr::Head(rd, rs) => {
                unary(sink, RtFn::Head, *rd, *rs)?;
                sink.guard(RtFn::Faulted)?;
                sink.jump(next()?)
            }
            Instr::Tail(rd, rs) => {
                unary(sink, RtFn::Tail, *rd, *rs)?;
                sink.guard(RtFn::Faulted)?;
                sink.jump(next()?)
            }
            // `rt_is_empty` never faults, so it has no guard.
            Instr::IsEmpty(rd, rs) => {
                unary(sink, RtFn::IsEmpty, *rd, *rs)?;
                sink.jump(next()?)
            }
            Instr::Box(rd, rs) => {
                unary(sink, RtFn::Box, *rd, *rs)?;
                sink.guard(RtFn::Faulted)?;
                sink.jump(next()?)
            }
            Instr::BoxGet(rd, rs) => {
                unary(sink, RtFn::BoxGet, *rd, *rs)?;
                sink.guard(RtFn::Faulted)?;
                sink.jump(next()?)
            }
            Instr::BoxSet(rb, rv) => {
                let p = sink.read(*rb)?;
                let v = sink.read(*rv)?;
                sink.call_rt_void(RtFn::BoxSet, &[p, v])?;
                sink.guard(RtFn::Faulted)?;
                sink.jump(next()?)
            }
        }
    }
}

/// `rd = f(rs)`.
fn unary<S: LowerSink>(sink: &mut S, f: RtFn, rd: Reg, rs: Reg) -> Result<(), S::Error> {
    let v = sink.read(rs)?;
    let w = sink.call_rt(f, &[v])?;
    sink.write(rd, w)
}
