//! Codegen-agnostic preparation shared by the Cranelift and LLVM backends: the register-cap guard,
//! subroutine arity, and the frame-size-aware recursion-depth cap. No codegen-library types here —
//! only `Program`/`Subroutine` analysis — so both backends (and neither-needs-the-other) reuse it.

use redextape_core::tm::{Caps, Program, Reg};
use redextape_native_rt::RUN_STACK_SIZE;

use crate::analysis::{Subroutine, for_each_operand};

/// Reserved off the top of `RUN_STACK_SIZE` (the crate-neutral run-thread stack size, defined once
/// in `redextape_native_rt` and shared by both the JIT thread here and the AOT run thread in
/// `rt_run`, so the two can never drift) for the outermost run frame plus host bookkeeping; the
/// recursion budget is `RUN_STACK_SIZE - STACK_MARGIN`.
const STACK_MARGIN: usize = 8 << 20;

/// Deliberately conservative bytes charged per register slot when estimating a native frame — one
/// Cranelift `Variable`, or one LLVM entry-block `alloca`, depending on the backend.
///
/// Measurements, both backends (this constant now underwrites TWO frame layouts, so tightening it
/// means clearing BOTH):
/// * Cranelift, debug build (i64 slot + no-reg-reuse spills): ~8–16 bytes per local.
/// * LLVM at `O0`, a 203-local frame (`8832` bytes charged): ~1680 bytes actual. `O1+` is
///   *smaller* still (`mem2reg`/SROA promote the register banks into SSA and the register allocator
///   keeps most of them in machine registers), so **`O0` is the binding case** for LLVM.
///
/// `32` over-estimates on purpose — over-estimating yields a SHALLOWER safe depth (earlier, harmless
/// `HitCap`), whereas under-estimating risks a real stack overflow (a process abort), which is
/// unacceptable. Totality wins over tightness.
///
/// Inlining does not break the estimate even though it makes one native frame hold several
/// subroutines' worth of slots: inlining a call also inlines that callee's own `rt_enter`, so the
/// bytes-per-`rt_enter` ratio is preserved — a frame that is `k` merged frames deep also charges the
/// depth counter `k` times before recursing again.
const BYTES_PER_VAR: u64 = 32;

/// Fixed per-frame overhead added on top of the per-slot estimate: return address, saved registers,
/// the backend's prologue (Cranelift's, or the one LLVM's register allocator emits), and ABI slop.
/// Also guarantees `frame_bytes >= 1`, so the `safe_depth` division can never divide by zero.
const FRAME_BASE: u64 = 2048;

/// A few extra "words" folded into every subroutine's frame estimate to cover `Rr` and the temporary
/// `Variable`s codegen introduces beyond the `Loc`/`Arg` banks.
const FRAME_SLACK_WORDS: u64 = 8;

/// Upper bound on a `Reg::Loc`/`Reg::Arg` index, matching `run_asm`'s `MAX_REGISTERS` (`asm.rs`).
/// Each register becomes a `Variable`, so a bank sized to a billion-plus index would make the
/// per-function `Vec::with_capacity(n_locals)`/arg allocation attempt tens of GB, whose failure
/// aborts the whole process. We reject any such `Program` up front (see `reg_over_cap`).
pub(crate) const MAX_REGISTERS: u32 = 1_000_000;

/// True if any `Reg::Loc(n)`/`Reg::Arg(n)` operand anywhere in `prog` reaches `MAX_REGISTERS`.
/// `run_asm` faults on this to avoid an allocation-abort; we reject it as `LowerError` (both are
/// "not a value", so the oracle treats an over-cap register bank as out of scope). The KEY property
/// is that we never build a function for such a `Program`, so there is no multi-GB allocation.
pub(crate) fn reg_over_cap(prog: &Program) -> bool {
    prog.code.iter().any(|instr| {
        let mut over = false;
        for_each_operand(instr, |reg, _write| {
            if let Reg::Loc(n) | Reg::Arg(n) = reg {
                over |= n >= MAX_REGISTERS;
            }
        });
        over
    })
}

/// How many `Arg` params a subroutine's native function takes. The entry (`$main`, `entry == 0`) is
/// always invoked by the driver as `(rt_ptr) -> I64` with NO args, so it takes `0` regardless of the
/// `Arg`s its body reads (a hand-built `$main` reading `Arg(i)` sees the init-`0` value — an entry
/// takes no arguments); every other subroutine takes its `arity` args from the caller. Used
/// consistently for the signature, the `Call` argument count, and the from-params init below.
pub(crate) fn param_count(sub: &Subroutine) -> u32 {
    if sub.entry == 0 { 0 } else { sub.arity }
}

/// Number of `Arg` `Variable`s `translate_subroutine` allocates for `sub`: every `Arg(i)` its body
/// references (read OR written — a write sets up a callee's argument), floored at `param_count`.
/// Shared with the frame-size estimate (`max_frame_words`) so the two never drift: the depth cap is
/// computed from exactly the `Variable` count codegen materialises.
pub(crate) fn n_arg_vars(prog: &Program, sub: &Subroutine) -> u32 {
    let mut max_arg: Option<u32> = None;
    // `.get()` rather than `prog.code[idx]`: `analysis::reachable_from` only records indices it
    // successfully read, so `sub.body` can never be out of range — but the panic-free style is
    // uniform across this crate, and a bounds panic here would be a totality violation.
    for instr in sub.body.iter().filter_map(|&idx| prog.code.get(idx)) {
        for_each_operand(instr, |reg, _write| {
            if let Reg::Arg(n) = reg {
                max_arg = Some(max_arg.map_or(n, |m| m.max(n)));
            }
        });
    }
    max_arg.map_or(0, |m| m + 1).max(param_count(sub))
}

/// The frame-size-aware recursion-depth cap: `min(caps.stack, safe_depth)`, where `safe_depth` is
/// how many worst-case native frames fit in the reserved recursion budget.
///
/// Native keeps each call frame's `Loc`/`Arg`/`Rr` on the REAL OS call stack (not a `Vec<Frame>`
/// like the reference) — as Cranelift `Variable`s, or as LLVM entry-block `alloca`s — so a program
/// whose worst subroutine has many registers builds a fat native frame. If the plain depth cap
/// (`caps.stack`) let such a program recurse that deep, it would overflow the run thread's stack —
/// an uncatchable `SIGABRT`, violating totality. Instead we bound depth by the stack budget:
/// `max_frame_words` (the largest `n_locals + n_args` over all subroutines, plus
/// `FRAME_SLACK_WORDS`) × `BYTES_PER_VAR` + `FRAME_BASE` conservatively over-estimates one native
/// frame, and `safe_depth = budget / frame_bytes` is how many fit.
///
/// The estimate is BACKEND- and OPT-LEVEL-agnostic by construction: it is computed from the ASM
/// `Program` alone, and `BYTES_PER_VAR` is calibrated (see its doc) against the largest frame either
/// backend was measured to build — LLVM at `O0`, which spills every register slot. `O1+` only ever
/// shrinks frames, and inlining preserves the bytes-per-`rt_enter` ratio, so a level the constant
/// was not measured at cannot make the bound unsafe.
///
/// This cap is computed at EMIT time (both for the JIT, immediately before running, and for AOT,
/// baked into the CONFIG blob `emit_object` writes) against `RUN_STACK_SIZE` — the same constant the
/// run thread is spawned with, whether that's the JIT's thread (`jit.rs`) or the AOT binary's thread
/// (`redextape_native_rt::rt_run`). Both import `RUN_STACK_SIZE` from `redextape_native_rt` rather
/// than each declaring its own duplicate stack-size literal, so the invariant below can never be
/// violated by the two drifting out of sync.
///
/// # Invariant (the totality guarantee)
/// `native_depth_cap * frame_bytes + STACK_MARGIN <= RUN_STACK_SIZE`. Integer division gives
/// `safe_depth * frame_bytes <= RUN_STACK_SIZE - STACK_MARGIN`, and `native_depth_cap <= safe_depth`,
/// so the depth cap ALWAYS trips before the native stack is exhausted — for ANY program, no process
/// abort, ever. `frame_bytes >= FRAME_BASE >= 1`, so the division never divides by zero.
pub(crate) fn native_depth_cap(prog: &Program, subs: &[Subroutine], caps: Caps) -> u64 {
    let max_frame_words =
        subs.iter().map(|sub| u64::from(n_arg_vars(prog, sub)) + u64::from(sub.n_locals)).max().unwrap_or(0)
            + FRAME_SLACK_WORDS;
    let frame_bytes = max_frame_words.saturating_mul(BYTES_PER_VAR).saturating_add(FRAME_BASE);
    let budget = (RUN_STACK_SIZE - STACK_MARGIN) as u64;
    let safe_depth = budget / frame_bytes;
    caps.stack.min(safe_depth)
}
