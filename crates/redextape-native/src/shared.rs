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
/// Measurements, both backends (this constant now underwrites TWO frame layouts at SIX opt levels
/// each, so tightening it means clearing all of them):
/// * Cranelift at `opt_level=none`: ~8–16 bytes per local (i64 slot + no-reg-reuse spills).
/// * Cranelift at `speed`/`speed_and_size` — **the binding case for Cranelift, and LARGER than
///   `none`**: read out of the emitted prologue's `sp` adjustment for a recursive subroutine whose
///   every local is a non-rematerializable function of the argument and is live across the
///   self-call. Frames measured (aarch64, `sub sp` + saved-register pushes), unoptimized → optimized:
///   50 locals `432 → 832`, 100 `832 → 2368`, 200 `1632 → 4656`, 400 `3232 → 9376`,
///   800 `6432 → 18976`, 1600 `12832 → 38192`, 3200 `25632 → 76592`. Optimization roughly TRIPLES
///   the frame (live-range splitting spills more distinct values than there are asm registers), and
///   the ratio converges from below to **~3.0 words per asm register** — bounded, not growing.
/// * LLVM, a 203-local frame (`8832` bytes charged): ~1680 bytes actual, and the opt level barely
///   moves it — by under 2%, in a direction that is SHAPE-dependent rather than structural. Measured
///   the same way (aarch64, `objdump` over `llvm::object_bytes` output, the `countdown` prologue),
///   200 fillers unless noted:
///
///   | filler shape | `O0` | `O1`/`O2`/`O3`/`Os`/`Oz` |
///   | --- | ---: | ---: |
///   | independent (the shape `jit.rs`'s totality sweep ships) | 1680 B | **1712 B** (+1.9%) |
///   | dependent chain (the `llvm.rs` fixture) | 1680 B | 1648 B (−1.9%) |
///   | independent, 800 fillers | 6480 B | **6512 B** (+0.5%) |
///
///   An earlier revision of this doc asserted that LLVM's `O1+` is always *smaller* (`mem2reg`/SROA
///   promoting the register banks into SSA) and concluded that `O0` was LLVM's binding case. The
///   first row falsifies it: `O1+` is LARGER for the independent shape, and the shrink held only for
///   the fixture `llvm.rs` happens to use. That is the same "optimization only shrinks frames"
///   reasoning the Cranelift row above already disproves — do not reintroduce it. No safety
///   consequence either way: LLVM sits at ~8 bytes per register slot against the 32 charged
///   (4.3–5.2x headroom) at EVERY level, nowhere near binding.
///
/// **Cranelift at `speed`/`speed_and_size` is therefore the binding case for BOTH backends** — the
/// fattest frame measured anywhere, at any level, on either backend.
///
/// The numbers above were read off AOT objects (`aot::emit_object`, the path `objdump` can read) and
/// transfer to the JIT verbatim: emitting with `is_pic=false` — the JIT's exact flag, see
/// `jit::host_isa` — produces byte-identical `countdown` prologues (`sub sp` of `0x600` at `none`,
/// `0x11d0` at `speed`, `0x49c0` at 800 fillers, each plus 96 B of saved-register pushes, i.e. the
/// 1632 / 4656 / 18976 B rows above) and identical object sizes. There is no separate JIT
/// calibration to keep in sync with this one.
///
/// `32` = 4 words charged per register slot, against the ~3.0 words optimized Cranelift was measured
/// to use: the margin is ~4.8x at 50 locals and converges to ~1.33x for thousands. It over-estimates
/// on purpose — over-estimating yields a SHALLOWER safe depth (earlier, harmless `HitCap`), whereas
/// under-estimating risks a real stack overflow (a process abort), which is unacceptable. Totality
/// wins over tightness, so this must not be tightened toward the measured numbers.
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
/// `Program` alone, and `BYTES_PER_VAR` is calibrated (see its doc) against **Cranelift at
/// `speed`/`speed_and_size` — the binding case for both backends**, where live-range splitting
/// spills ~3x what `none` does, i.e. ~3.0 words per asm register against the 4 charged. LLVM is
/// nowhere near binding at any level: ~8 bytes per slot against 32 charged, with under 2% variation
/// between its levels (in a shape-dependent direction — `O1+` is not uniformly smaller; see
/// `BYTES_PER_VAR`). Inlining, where a backend does it, preserves the bytes-per-`rt_enter` ratio. So
/// a level the constant was not measured at cannot make the bound unsafe — but tightening the
/// constant toward either backend's measurement would.
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
