//! The Cranelift JIT backend: compile a register-asm `Program` to host machine code and run it.
//!
//! The contract is agreement with `redextape_core::tm::run_asm`: `compile_and_run(prog, caps)`
//! must produce the same outcome (`Ran`/`HitCap`/`Fault`) as the asm interpreter on every
//! `Program`. We reach it by compiling **one Cranelift function per subroutine** (from
//! `analysis::partition`) and threading a `*mut Runtime` (Task 2) through every function so the
//! `rt_*` host functions can perform the heap/box operations and cap checks with identical
//! semantics.
//!
//! # The model
//! * **Registers → `Variable`s.** Each function owns one `Variable` per `Loc(i)` (init `0`), per
//!   referenced `Arg(i)` (the first `arity` from the function's params, the rest init `0`), and one
//!   for `Rr` (init `0`). The native call stack provides the asm frame convention for free: a
//!   callee's `Loc`/`Arg` are its own `Variable`s, so `Loc` is preserved across a `Call` and `Arg`
//!   is volatile, exactly as `run_asm`'s frame save/restore intends.
//! * **Blocks.** One Cranelift block per reachable body instruction, plus a prologue entry block and
//!   a single shared exit block. `Jz`/`Jmp` branch to the target index's block; fall-through jumps to
//!   the next index's block (guaranteed present in `body` by the reachability partition).
//! * **Totality.** Straight-line code always terminates. Any cycle in a lowered CFG contains a
//!   *backward* `Jz`/`Jmp` (target index ≤ current), and any unbounded recursion goes through a
//!   `Call`; we emit `rt_tick` before every backward branch and `rt_enter` at every `Call`, each of
//!   which `brif`s to the exit block once its cap trips. So an infinite loop trips the step cap and
//!   infinite recursion trips the stack-depth cap — the latter *before* the guarded native call is
//!   made, so the real call stack never overflows. The depth cap is FRAME-SIZE-AWARE
//!   (`native_depth_cap` = `min(caps.stack, safe_depth)`): a fat-frame subroutine gets a
//!   proportionally shallower cap so it `HitCap`s before exhausting the reserved 512 MiB JIT thread
//!   stack, for ANY program — never a process abort.
//!
//! # Step accounting is coarse (termination, not exact-count, parity)
//! `run_asm` charges one `steps` tick per instruction executed; native ticks only *backward edges*
//! and *calls* — enough to force any non-terminating run to trip a cap, but not an exact count. So a
//! straight-line program that `run_asm` would `HitCap` on a `steps` cap *smaller than its
//! instruction count* can still run to completion natively. This is deliberate: ticking every
//! instruction would defeat the JIT. Native guarantees **termination**, not step-count equality, and
//! the oracle compares terminating *outcomes*. Callers must therefore not pass a `steps` cap tighter
//! than a terminating program needs (use `DEFAULT_CAPS`, or a cap large enough to complete); the
//! `agree`/oracle helpers do exactly that.

use std::collections::HashMap;

use cranelift_codegen::Context;
use cranelift_codegen::ir::condcodes::IntCC;
use cranelift_codegen::ir::{AbiParam, Block, FuncRef, InstBuilder, Signature, UserFuncName, Value, types};
use cranelift_frontend::{FunctionBuilder, FunctionBuilderContext, Variable};
use cranelift_jit::{JITBuilder, JITModule};
use cranelift_module::{FuncId, Linkage, Module, default_libcall_names};

use redextape_core::core::{BinOp, NodeId};
use redextape_core::tm::{Caps, Instr, LowerError, Program, Reg};

use crate::NativeRun;
use crate::analysis::{Subroutine, for_each_operand, partition};
use crate::runtime::{
    Runtime, rt_box, rt_box_get, rt_box_set, rt_cons, rt_enter, rt_faulted, rt_head, rt_is_empty, rt_leave, rt_tail,
    rt_tick,
};

/// The JIT thread's reserved stack. This is VIRTUAL address space — only touched pages ever commit,
/// so a large reserve costs no real memory until used. A generous reserve lets NORMAL deep recursion
/// (small frames) run to the full `caps.stack` depth without an early `HitCap`, while the
/// frame-size-aware depth cap (below) keeps any FAT-frame program from ever exhausting it.
const JIT_STACK_SIZE: usize = 512 << 20;

/// Reserved off the top of `JIT_STACK_SIZE` for the outermost run frame plus host bookkeeping; the
/// recursion budget is `JIT_STACK_SIZE - STACK_MARGIN`.
const STACK_MARGIN: usize = 8 << 20;

/// Deliberately conservative bytes charged per Cranelift `Variable` when estimating a native frame.
/// The measured per-local overhead in a debug build (i64 slot + no-reg-reuse spills) is ~8–16 bytes;
/// `32` over-estimates on purpose — over-estimating yields a SHALLOWER safe depth (earlier, harmless
/// `HitCap`), whereas under-estimating risks a real stack overflow (a process abort), which is
/// unacceptable. Totality wins over tightness.
const BYTES_PER_VAR: u64 = 32;

/// Fixed per-frame overhead added on top of the per-`Variable` estimate: return address, saved
/// registers, the Cranelift prologue, and ABI slop. Also guarantees `frame_bytes >= 1`, so the
/// `safe_depth` division can never divide by zero.
const FRAME_BASE: u64 = 2048;

/// A few extra "words" folded into every subroutine's frame estimate to cover `Rr` and the temporary
/// `Variable`s codegen introduces beyond the `Loc`/`Arg` banks.
const FRAME_SLACK_WORDS: u64 = 8;

/// Upper bound on a `Reg::Loc`/`Reg::Arg` index, matching `run_asm`'s `MAX_REGISTERS` (`asm.rs`).
/// Each register becomes a `Variable`, so a bank sized to a billion-plus index would make the
/// per-function `Vec::with_capacity(n_locals)`/arg allocation attempt tens of GB, whose failure
/// aborts the whole process. We reject any such `Program` up front (see `reg_over_cap`).
const MAX_REGISTERS: u32 = 1_000_000;

/// True if any `Reg::Loc(n)`/`Reg::Arg(n)` operand anywhere in `prog` reaches `MAX_REGISTERS`.
/// `run_asm` faults on this to avoid an allocation-abort; we reject it as `LowerError` (both are
/// "not a value", so the oracle treats an over-cap register bank as out of scope). The KEY property
/// is that we never build a function for such a `Program`, so there is no multi-GB allocation.
fn reg_over_cap(prog: &Program) -> bool {
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

/// Wrap any Cranelift/module error as a `LowerError` outcome. These paths are not expected to fire
/// for a partitioned `Program` (the label/CFG invariants are already checked by `partition`); this
/// keeps the backend total instead of unwrapping.
fn internal_error(msg: impl std::fmt::Display) -> NativeRun {
    NativeRun::LowerError(LowerError::Unsupported { node: NodeId::default(), what: format!("native codegen: {msg}") })
}

/// JIT-compile `prog` and run it against a fresh `Runtime`, agreeing with `run_asm`.
///
/// `partition` failures surface as `NativeRun::LowerError`. Everything else — compilation and the
/// run itself — happens on a dedicated big-stack thread (`JIT_STACK_SIZE`, a scoped thread so the
/// borrowed `prog`/`subs` need not be `'static`); its result is joined back and returned.
pub fn compile_and_run(prog: &Program, caps: Caps) -> NativeRun {
    // Reject an absurd register index BEFORE building any function: materialising a billion-plus
    // register `Variable` bank would attempt a multi-GB allocation whose failure aborts the process.
    // `run_asm` guards the same way (returning `Fault`); we return `LowerError` (see `reg_over_cap`).
    if reg_over_cap(prog) {
        return internal_error(format!("register index exceeds MAX_REGISTERS ({MAX_REGISTERS})"));
    }
    let subs = match partition(prog) {
        Ok(subs) => subs,
        Err(e) => return NativeRun::LowerError(e),
    };
    // Run compile+execute on a dedicated big-stack thread. A spawn failure or a panic inside the
    // thread surfaces as `LowerError` rather than an `.expect` panic, so `compile_and_run` stays
    // total on every `Program`.
    std::thread::scope(|scope| {
        let handle = match std::thread::Builder::new()
            .stack_size(JIT_STACK_SIZE)
            .spawn_scoped(scope, || build_and_run(prog, &subs, caps))
        {
            Ok(handle) => handle,
            Err(e) => return internal_error(format!("spawn JIT thread: {e}")),
        };
        match handle.join() {
            Ok(run) => run,
            Err(_) => internal_error("JIT thread panicked"),
        }
    })
}

/// `FuncId`s of the imported `rt_*` host functions.
struct RtIds {
    cons: FuncId,
    head: FuncId,
    tail: FuncId,
    is_empty: FuncId,
    box_new: FuncId,
    box_get: FuncId,
    box_set: FuncId,
    tick: FuncId,
    enter: FuncId,
    leave: FuncId,
    faulted: FuncId,
}

/// The same functions imported into a specific `Function` (as `FuncRef`s ready for `call`).
struct RtRefs {
    cons: FuncRef,
    head: FuncRef,
    tail: FuncRef,
    is_empty: FuncRef,
    box_new: FuncRef,
    box_get: FuncRef,
    box_set: FuncRef,
    tick: FuncRef,
    enter: FuncRef,
    leave: FuncRef,
    faulted: FuncRef,
}

impl RtRefs {
    fn declare(module: &mut JITModule, builder: &mut FunctionBuilder, ids: &RtIds) -> RtRefs {
        RtRefs {
            cons: module.declare_func_in_func(ids.cons, builder.func),
            head: module.declare_func_in_func(ids.head, builder.func),
            tail: module.declare_func_in_func(ids.tail, builder.func),
            is_empty: module.declare_func_in_func(ids.is_empty, builder.func),
            box_new: module.declare_func_in_func(ids.box_new, builder.func),
            box_get: module.declare_func_in_func(ids.box_get, builder.func),
            box_set: module.declare_func_in_func(ids.box_set, builder.func),
            tick: module.declare_func_in_func(ids.tick, builder.func),
            enter: module.declare_func_in_func(ids.enter, builder.func),
            leave: module.declare_func_in_func(ids.leave, builder.func),
            faulted: module.declare_func_in_func(ids.faulted, builder.func),
        }
    }
}

/// Everything the per-function translation needs beyond the function itself.
struct Decls {
    rt: RtIds,
    /// entry index → the subroutine's `FuncId`.
    func_ids: HashMap<usize, FuncId>,
    /// entry index → the subroutine's arity (number of `Arg` params it takes).
    arity: HashMap<usize, u32>,
}

/// How many `Arg` params a subroutine's native function takes. The entry (`$main`, `entry == 0`) is
/// always invoked by the driver as `(rt_ptr) -> I64` with NO args, so it takes `0` regardless of the
/// `Arg`s its body reads (a hand-built `$main` reading `Arg(i)` sees the init-`0` value — an entry
/// takes no arguments); every other subroutine takes its `arity` args from the caller. Used
/// consistently for the signature, the `Call` argument count, and the from-params init below.
fn param_count(sub: &Subroutine) -> u32 {
    if sub.entry == 0 { 0 } else { sub.arity }
}

/// Number of `Arg` `Variable`s `translate_subroutine` allocates for `sub`: every `Arg(i)` its body
/// references (read OR written — a write sets up a callee's argument), floored at `param_count`.
/// Shared with the frame-size estimate (`max_frame_words`) so the two never drift: the depth cap is
/// computed from exactly the `Variable` count codegen materialises.
fn n_arg_vars(prog: &Program, sub: &Subroutine) -> u32 {
    let mut max_arg: Option<u32> = None;
    for &idx in &sub.body {
        for_each_operand(&prog.code[idx], |reg, _write| {
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
/// Native keeps each call frame's `Loc`/`Arg`/`Rr` in `Variable`s on the REAL OS call stack (not a
/// `Vec<Frame>` like the reference), so a program whose worst subroutine has many registers builds a
/// fat native frame. If the plain depth cap (`caps.stack`) let such a program recurse that deep, it
/// would overflow the JIT thread's stack — an uncatchable `SIGABRT`, violating totality. Instead we
/// bound depth by the stack budget: `max_frame_words` (the largest `n_locals + n_args` over all
/// subroutines, plus `FRAME_SLACK_WORDS`) × `BYTES_PER_VAR` + `FRAME_BASE` conservatively
/// over-estimates one native frame, and `safe_depth = budget / frame_bytes` is how many fit.
///
/// # Invariant (the totality guarantee)
/// `native_depth_cap * frame_bytes + STACK_MARGIN <= JIT_STACK_SIZE`. Integer division gives
/// `safe_depth * frame_bytes <= JIT_STACK_SIZE - STACK_MARGIN`, and `native_depth_cap <= safe_depth`,
/// so the depth cap ALWAYS trips before the native stack is exhausted — for ANY program, no process
/// abort, ever. `frame_bytes >= FRAME_BASE >= 1`, so the division never divides by zero.
fn native_depth_cap(prog: &Program, subs: &[Subroutine], caps: Caps) -> u64 {
    let max_frame_words =
        subs.iter().map(|sub| u64::from(n_arg_vars(prog, sub)) + u64::from(sub.n_locals)).max().unwrap_or(0)
            + FRAME_SLACK_WORDS;
    let frame_bytes = max_frame_words.saturating_mul(BYTES_PER_VAR).saturating_add(FRAME_BASE);
    let budget = (JIT_STACK_SIZE - STACK_MARGIN) as u64;
    let safe_depth = budget / frame_bytes;
    caps.stack.min(safe_depth)
}

/// A signature `(rt_ptr: I64, arg0: I64, ..) -> I64` — all words are `I64`.
fn word_signature(module: &JITModule, n_args: u32) -> Signature {
    let mut sig = module.make_signature();
    sig.params.push(AbiParam::new(types::I64)); // the hidden `*mut Runtime`
    for _ in 0..n_args {
        sig.params.push(AbiParam::new(types::I64));
    }
    sig.returns.push(AbiParam::new(types::I64));
    sig
}

/// Register the `rt_*` host-function addresses on a fresh `JITBuilder`.
fn register_symbols(builder: &mut JITBuilder) {
    builder.symbol("rt_cons", rt_cons as *const u8);
    builder.symbol("rt_head", rt_head as *const u8);
    builder.symbol("rt_tail", rt_tail as *const u8);
    builder.symbol("rt_is_empty", rt_is_empty as *const u8);
    builder.symbol("rt_box", rt_box as *const u8);
    builder.symbol("rt_box_get", rt_box_get as *const u8);
    builder.symbol("rt_box_set", rt_box_set as *const u8);
    builder.symbol("rt_tick", rt_tick as *const u8);
    builder.symbol("rt_enter", rt_enter as *const u8);
    builder.symbol("rt_leave", rt_leave as *const u8);
    builder.symbol("rt_faulted", rt_faulted as *const u8);
}

/// Declare the `rt_*` imports in `module`, returning their `FuncId`s.
fn declare_rt(module: &mut JITModule) -> Result<RtIds, NativeRun> {
    let mut decl = |name: &str, n_params: usize, has_ret: bool| -> Result<FuncId, NativeRun> {
        let mut sig = module.make_signature();
        for _ in 0..n_params {
            sig.params.push(AbiParam::new(types::I64));
        }
        if has_ret {
            sig.returns.push(AbiParam::new(types::I64));
        }
        module.declare_function(name, Linkage::Import, &sig).map_err(internal_error)
    };
    Ok(RtIds {
        cons: decl("rt_cons", 3, true)?,
        head: decl("rt_head", 2, true)?,
        tail: decl("rt_tail", 2, true)?,
        is_empty: decl("rt_is_empty", 2, true)?,
        box_new: decl("rt_box", 2, true)?,
        box_get: decl("rt_box_get", 2, true)?,
        box_set: decl("rt_box_set", 3, false)?,
        tick: decl("rt_tick", 1, true)?,
        enter: decl("rt_enter", 1, true)?,
        leave: decl("rt_leave", 1, false)?,
        faulted: decl("rt_faulted", 1, true)?,
    })
}

/// Build the module, define every subroutine, finalize, and run `$main`. Runs entirely on the
/// spawning (big-stack) thread so the non-`Send` `JITModule` never crosses a thread boundary and
/// stays alive for the duration of the call into JIT-compiled code.
fn build_and_run(prog: &Program, subs: &[Subroutine], caps: Caps) -> NativeRun {
    let mut jb = match JITBuilder::new(default_libcall_names()) {
        Ok(jb) => jb,
        Err(e) => return internal_error(e),
    };
    register_symbols(&mut jb);
    let mut module = JITModule::new(jb);

    let rt = match declare_rt(&mut module) {
        Ok(rt) => rt,
        Err(e) => return e,
    };

    // Declare every subroutine up front so `Call` can reference callees defined later.
    let mut func_ids: HashMap<usize, FuncId> = HashMap::new();
    let mut arity: HashMap<usize, u32> = HashMap::new();
    for sub in subs {
        let sig = word_signature(&module, param_count(sub));
        let id = match module.declare_function(&sub.name, Linkage::Local, &sig) {
            Ok(id) => id,
            Err(e) => return internal_error(e),
        };
        func_ids.insert(sub.entry, id);
        arity.insert(sub.entry, param_count(sub));
    }
    let decls = Decls { rt, func_ids, arity };

    // Define each subroutine.
    let mut fbctx = FunctionBuilderContext::new();
    for sub in subs {
        let mut ctx = module.make_context();
        ctx.func.signature = word_signature(&module, param_count(sub));
        let fid = decls.func_ids[&sub.entry];
        ctx.func.name = UserFuncName::user(0, fid.as_u32());
        if let Err(e) = translate_subroutine(&mut module, &mut ctx, &mut fbctx, prog, sub, &decls) {
            return e;
        }
        if let Err(e) = module.define_function(fid, &mut ctx) {
            return internal_error(e);
        }
        module.clear_context(&mut ctx);
    }

    if let Err(e) = module.finalize_definitions() {
        return internal_error(e);
    }

    let main_id = decls.func_ids[&0];
    let code = module.get_finalized_function(main_id);
    // SAFETY: `code` is the finalized entry point of `$main`, compiled with the module's default
    // (host C) calling convention as `(I64) -> I64`, matching `extern "C" fn(*mut Runtime) -> u64`.
    // `module` outlives this call, so the code stays mapped and executable.
    let main: extern "C" fn(*mut Runtime) -> u64 = unsafe { std::mem::transmute::<*const u8, _>(code) };

    // `caps.mem` (the reference's cap on words held across cloned `Vec<Frame>` locals) has no native
    // analog: each subroutine's `Loc`/`Arg` are fixed-size `Variable`s on the real call stack, so a
    // `Call` clones nothing. Native recursion is instead bounded by the frame-size-aware
    // `native_depth_cap` (= `min(caps.stack, safe_depth)`) via `rt_enter`'s depth counter, checked
    // before each guarded call — so a fat-frame program returns `HitCap` long before this reserved
    // stack overflows (no process abort), while small-frame recursion still runs to `caps.stack`.
    let mut runtime = Runtime::with_depth_cap(caps, native_depth_cap(prog, subs, caps));
    let result = main(&mut runtime);

    if runtime.hit_cap {
        NativeRun::HitCap
    } else {
        match runtime.fault.take() {
            Some(msg) => NativeRun::Fault(msg),
            None => NativeRun::Ran(runtime.into_outcome(result)),
        }
    }
}

/// Read register `r` as a value in the current block. Out-of-bank indices read `0`, mirroring
/// `run_asm`'s `args.get(n).unwrap_or(0)` / `locals.get(n).unwrap_or(0)` (and keeping this total).
fn read_reg(b: &mut FunctionBuilder, r: Reg, locs: &[Variable], args: &[Variable], rr: Variable) -> Value {
    match r {
        Reg::Loc(n) => match locs.get(n as usize) {
            Some(&v) => b.use_var(v),
            None => b.ins().iconst(types::I64, 0),
        },
        Reg::Arg(n) => match args.get(n as usize) {
            Some(&v) => b.use_var(v),
            None => b.ins().iconst(types::I64, 0),
        },
        Reg::Rr => b.use_var(rr),
    }
}

/// Write `val` to register `r`. Out-of-bank indices are no-ops (they never occur — the banks are
/// sized to every register the body references — but this stays panic-free defensively).
fn write_reg(b: &mut FunctionBuilder, r: Reg, val: Value, locs: &[Variable], args: &[Variable], rr: Variable) {
    match r {
        Reg::Loc(n) => {
            if let Some(&v) = locs.get(n as usize) {
                b.def_var(v, val);
            }
        }
        Reg::Arg(n) => {
            if let Some(&v) = args.get(n as usize) {
                b.def_var(v, val);
            }
        }
        Reg::Rr => b.def_var(rr, val),
    }
}

/// `icmp` then zero-extend the `i8` result to a `0`/`1` `I64`, matching `u64::from(bool)`.
fn emit_cmp(b: &mut FunctionBuilder, cc: IntCC, x: Value, y: Value) -> Value {
    let c = b.ins().icmp(cc, x, y);
    b.ins().uextend(types::I64, c)
}

/// Emit `x op y` per `run_asm`'s `eval_bin`. All words are `u64`, so: `Add`/`Mul` SATURATE at
/// `u64::MAX` on overflow (matching `saturating_add`/`saturating_mul`); `Sub` is saturating monus
/// `x - min(x, y)`; comparisons are UNSIGNED. Cranelift 0.134 has no scalar `*_sat` (those are SIMD
/// lane ops that don't lower for i64), so we detect overflow and clamp: `uadd_overflow`/
/// `umul_overflow` return `(result, overflow_flag)`, and `select(of, MAX, result)` picks `u64::MAX`
/// (`iconst(I64, -1)`) when the flag is set.
fn emit_bin(b: &mut FunctionBuilder, op: BinOp, x: Value, y: Value) -> Value {
    match op {
        BinOp::Add => {
            let (r, of) = b.ins().uadd_overflow(x, y);
            let max = b.ins().iconst(types::I64, -1); // u64::MAX
            b.ins().select(of, max, r)
        }
        BinOp::Mul => {
            let (r, of) = b.ins().umul_overflow(x, y);
            let max = b.ins().iconst(types::I64, -1); // u64::MAX
            b.ins().select(of, max, r)
        }
        BinOp::Sub => {
            let m = b.ins().umin(x, y);
            b.ins().isub(x, m)
        }
        BinOp::Eq => emit_cmp(b, IntCC::Equal, x, y),
        BinOp::Ne => emit_cmp(b, IntCC::NotEqual, x, y),
        BinOp::Lt => emit_cmp(b, IntCC::UnsignedLessThan, x, y),
        BinOp::Le => emit_cmp(b, IntCC::UnsignedLessThanOrEqual, x, y),
        BinOp::Gt => emit_cmp(b, IntCC::UnsignedGreaterThan, x, y),
        BinOp::Ge => emit_cmp(b, IntCC::UnsignedGreaterThanOrEqual, x, y),
    }
}

/// Call a `(rt) -> u64` guard (`rt_tick`/`rt_enter`/`rt_faulted`); `brif` to `exit` on a nonzero
/// signal and continue in a fresh block otherwise. The caller keeps translating in that new block.
fn emit_guard(b: &mut FunctionBuilder, guard: FuncRef, rt_ptr: Value, exit: Block) {
    let call = b.ins().call(guard, &[rt_ptr]);
    let signal = b.inst_results(call)[0];
    let cont = b.create_block();
    b.ins().brif(signal, exit, &[], cont, &[]);
    b.switch_to_block(cont);
}

/// Translate one subroutine into `ctx.func`.
fn translate_subroutine(
    module: &mut JITModule,
    ctx: &mut Context,
    fbctx: &mut FunctionBuilderContext,
    prog: &Program,
    sub: &Subroutine,
    decls: &Decls,
) -> Result<(), NativeRun> {
    let mut builder = FunctionBuilder::new(&mut ctx.func, fbctx);

    // Import the `rt_*` helpers and every subroutine (so `Call` can reference any of them).
    let rt = RtRefs::declare(module, &mut builder, &decls.rt);
    let mut sub_refs: HashMap<usize, FuncRef> = HashMap::new();
    for (&entry, &fid) in &decls.func_ids {
        sub_refs.insert(entry, module.declare_func_in_func(fid, builder.func));
    }

    // Prologue: initialise the register banks from the function params.
    let entry_block = builder.create_block();
    builder.append_block_params_for_function_params(entry_block);
    builder.switch_to_block(entry_block);
    let params: Vec<Value> = builder.block_params(entry_block).to_vec();
    let rt_ptr = params[0];

    // Size the `Arg` bank to every `Arg` the body references (read or write); the `Loc` bank to
    // `n_locals`. The first `param_count` args come from the function's params; any extra `Arg`
    // (written only to set up a callee's arguments, or every `Arg` of the entry `$main`, which the
    // driver invokes with no args) starts at `0`.
    let n_params = param_count(sub);
    let n_args = n_arg_vars(prog, sub);

    let mut arg_vars = Vec::with_capacity(n_args as usize);
    for i in 0..n_args {
        let var = builder.declare_var(types::I64);
        let init = if i < n_params { params[1 + i as usize] } else { builder.ins().iconst(types::I64, 0) };
        builder.def_var(var, init);
        arg_vars.push(var);
    }
    let mut loc_vars = Vec::with_capacity(sub.n_locals as usize);
    for _ in 0..sub.n_locals {
        let var = builder.declare_var(types::I64);
        let zero = builder.ins().iconst(types::I64, 0);
        builder.def_var(var, zero);
        loc_vars.push(var);
    }
    let rr_var = builder.declare_var(types::I64);
    let zero = builder.ins().iconst(types::I64, 0);
    builder.def_var(rr_var, zero);

    // One block per body instruction, plus a shared fault/cap exit block.
    let mut block_for: HashMap<usize, Block> = HashMap::new();
    for &idx in &sub.body {
        block_for.insert(idx, builder.create_block());
    }
    let exit_block = builder.create_block();

    let entry_target =
        *block_for.get(&sub.entry).ok_or_else(|| internal_error(format!("entry {} not in body", sub.entry)))?;
    builder.ins().jump(entry_target, &[]);

    // Resolve a label to the block of the index it precedes.
    let resolve = |l: &str| -> Result<usize, NativeRun> {
        prog.label_index(l).ok_or_else(|| internal_error(format!("undefined label `{l}`")))
    };
    let block_at = |idx: usize| -> Result<Block, NativeRun> {
        block_for.get(&idx).copied().ok_or_else(|| internal_error(format!("no block for index {idx}")))
    };

    for &idx in &sub.body {
        builder.switch_to_block(block_for[&idx]);
        let b = &mut builder;
        match &prog.code[idx] {
            Instr::Li(rd, n) => {
                let v = b.ins().iconst(types::I64, *n as i64);
                write_reg(b, *rd, v, &loc_vars, &arg_vars, rr_var);
                b.ins().jump(block_at(idx + 1)?, &[]);
            }
            Instr::Mov(rd, rs) => {
                let v = read_reg(b, *rs, &loc_vars, &arg_vars, rr_var);
                write_reg(b, *rd, v, &loc_vars, &arg_vars, rr_var);
                b.ins().jump(block_at(idx + 1)?, &[]);
            }
            Instr::Nil(rd) => {
                let v = b.ins().iconst(types::I64, 0);
                write_reg(b, *rd, v, &loc_vars, &arg_vars, rr_var);
                b.ins().jump(block_at(idx + 1)?, &[]);
            }
            Instr::Bin(op, rd, ra, rb) => {
                let x = read_reg(b, *ra, &loc_vars, &arg_vars, rr_var);
                let y = read_reg(b, *rb, &loc_vars, &arg_vars, rr_var);
                let v = emit_bin(b, *op, x, y);
                write_reg(b, *rd, v, &loc_vars, &arg_vars, rr_var);
                b.ins().jump(block_at(idx + 1)?, &[]);
            }
            Instr::Jz(r, l) => {
                let target = resolve(l)?;
                if target <= idx {
                    emit_guard(b, rt.tick, rt_ptr, exit_block); // backward edge → step cap
                }
                let cond = read_reg(b, *r, &loc_vars, &arg_vars, rr_var);
                // Jz: cond == 0 → target; else → fall through to idx + 1.
                b.ins().brif(cond, block_at(idx + 1)?, &[], block_at(target)?, &[]);
            }
            Instr::Jmp(l) => {
                let target = resolve(l)?;
                if target <= idx {
                    emit_guard(b, rt.tick, rt_ptr, exit_block); // backward edge → step cap
                }
                b.ins().jump(block_at(target)?, &[]);
            }
            Instr::Call(l) => {
                let target = resolve(l)?;
                emit_guard(b, rt.enter, rt_ptr, exit_block); // stack-depth cap, checked before the call
                let callee = *sub_refs.get(&target).ok_or_else(|| internal_error("call to non-subroutine"))?;
                let callee_arity = *decls.arity.get(&target).ok_or_else(|| internal_error("unknown callee arity"))?;
                let mut args = Vec::with_capacity(1 + callee_arity as usize);
                args.push(rt_ptr);
                for i in 0..callee_arity {
                    args.push(read_reg(b, Reg::Arg(i), &loc_vars, &arg_vars, rr_var));
                }
                let call = b.ins().call(callee, &args);
                let result = b.inst_results(call)[0];
                write_reg(b, Reg::Rr, result, &loc_vars, &arg_vars, rr_var);
                b.ins().call(rt.leave, &[rt_ptr]);
                b.ins().jump(block_at(idx + 1)?, &[]);
            }
            // `Ret` returns `rr` to the caller; `Halt` stops the whole program with `rr`. They lower
            // identically to a native `return rr` because `partition` (see `analysis.rs`) rejects any
            // NON-`$main` subroutine that contains a `Halt`, so a `Halt` here can only be `$main`'s
            // own — where "return to the driver" IS "stop the program". (`$main`'s `Ret` with the
            // native stack empty likewise returns to the driver, matching `run_asm`'s empty-stack
            // `Ret`.)
            Instr::Ret | Instr::Halt => {
                let v = read_reg(b, Reg::Rr, &loc_vars, &arg_vars, rr_var);
                b.ins().return_(&[v]);
            }
            Instr::Cons(rd, rh, rt_reg) => {
                let h = read_reg(b, *rh, &loc_vars, &arg_vars, rr_var);
                let t = read_reg(b, *rt_reg, &loc_vars, &arg_vars, rr_var);
                let call = b.ins().call(rt.cons, &[rt_ptr, h, t]);
                let v = b.inst_results(call)[0];
                write_reg(b, *rd, v, &loc_vars, &arg_vars, rr_var);
                emit_guard(b, rt.faulted, rt_ptr, exit_block); // heap cap
                b.ins().jump(block_at(idx + 1)?, &[]);
            }
            Instr::Head(rd, rl) => {
                let p = read_reg(b, *rl, &loc_vars, &arg_vars, rr_var);
                let call = b.ins().call(rt.head, &[rt_ptr, p]);
                let v = b.inst_results(call)[0];
                write_reg(b, *rd, v, &loc_vars, &arg_vars, rr_var);
                emit_guard(b, rt.faulted, rt_ptr, exit_block);
                b.ins().jump(block_at(idx + 1)?, &[]);
            }
            Instr::Tail(rd, rl) => {
                let p = read_reg(b, *rl, &loc_vars, &arg_vars, rr_var);
                let call = b.ins().call(rt.tail, &[rt_ptr, p]);
                let v = b.inst_results(call)[0];
                write_reg(b, *rd, v, &loc_vars, &arg_vars, rr_var);
                emit_guard(b, rt.faulted, rt_ptr, exit_block);
                b.ins().jump(block_at(idx + 1)?, &[]);
            }
            Instr::IsEmpty(rd, rl) => {
                let p = read_reg(b, *rl, &loc_vars, &arg_vars, rr_var);
                let call = b.ins().call(rt.is_empty, &[rt_ptr, p]);
                let v = b.inst_results(call)[0];
                write_reg(b, *rd, v, &loc_vars, &arg_vars, rr_var);
                b.ins().jump(block_at(idx + 1)?, &[]); // never faults
            }
            Instr::Box(rd, rv) => {
                let v_in = read_reg(b, *rv, &loc_vars, &arg_vars, rr_var);
                let call = b.ins().call(rt.box_new, &[rt_ptr, v_in]);
                let v = b.inst_results(call)[0];
                write_reg(b, *rd, v, &loc_vars, &arg_vars, rr_var);
                emit_guard(b, rt.faulted, rt_ptr, exit_block); // heap cap
                b.ins().jump(block_at(idx + 1)?, &[]);
            }
            Instr::BoxGet(rd, rb) => {
                let p = read_reg(b, *rb, &loc_vars, &arg_vars, rr_var);
                let call = b.ins().call(rt.box_get, &[rt_ptr, p]);
                let v = b.inst_results(call)[0];
                write_reg(b, *rd, v, &loc_vars, &arg_vars, rr_var);
                emit_guard(b, rt.faulted, rt_ptr, exit_block);
                b.ins().jump(block_at(idx + 1)?, &[]);
            }
            Instr::BoxSet(rb, rv) => {
                let p = read_reg(b, *rb, &loc_vars, &arg_vars, rr_var);
                let v = read_reg(b, *rv, &loc_vars, &arg_vars, rr_var);
                b.ins().call(rt.box_set, &[rt_ptr, p, v]);
                emit_guard(b, rt.faulted, rt_ptr, exit_block);
                b.ins().jump(block_at(idx + 1)?, &[]);
            }
        }
    }

    // The shared exit block returns a sentinel `0`; the driver classifies by the runtime flags.
    builder.switch_to_block(exit_block);
    let sentinel = builder.ins().iconst(types::I64, 0);
    builder.ins().return_(&[sentinel]);

    builder.seal_all_blocks();
    builder.finalize(module.target_config());
    Ok(())
}

#[cfg(all(test, feature = "cranelift"))]
mod tests {
    use super::*;
    use redextape_core::core::BinOp;
    use redextape_core::tm::{AsmRun, DEFAULT_CAPS, Instr, Program, Reg, run_asm};

    /// native `compile_and_run` must agree with `run_asm` (same `Ran` outcome incl. heap, or both
    /// `Fault`, or both `HitCap`) under `caps`.
    fn agree_caps(prog: Program, caps: Caps) {
        let native = compile_and_run(&prog, caps);
        match (run_asm(&prog, caps), native) {
            (AsmRun::Ran(a), NativeRun::Ran(n)) => assert_eq!(a, n, "outcome mismatch"),
            (AsmRun::Fault(_), NativeRun::Fault(_)) => {}
            (AsmRun::HitCap, NativeRun::HitCap) => {}
            (a, n) => panic!("native vs asm-interp mismatch:\n asm={a:?}\n native={n:?}"),
        }
    }

    fn agree(prog: Program) {
        agree_caps(prog, DEFAULT_CAPS);
    }

    #[test]
    fn arithmetic() {
        // rr = 2 * 3 = 6
        agree(Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 2),
                Instr::Li(Reg::Loc(1), 3),
                Instr::Bin(BinOp::Mul, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        });
    }

    #[test]
    fn straight_line_arithmetic() {
        // rr = (2 + 3) * 4 = 20
        agree(Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 2),
                Instr::Li(Reg::Loc(1), 3),
                Instr::Bin(BinOp::Add, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
                Instr::Li(Reg::Loc(3), 4),
                Instr::Bin(BinOp::Mul, Reg::Rr, Reg::Loc(2), Reg::Loc(3)),
                Instr::Halt,
            ],
            labels: vec![],
        });
    }

    #[test]
    fn monus_saturates() {
        // rr = 3 - 5 = 0 (truncated)
        agree(Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 3),
                Instr::Li(Reg::Loc(1), 5),
                Instr::Bin(BinOp::Sub, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        });
    }

    #[test]
    fn subtraction_when_it_does_not_saturate() {
        // rr = 9 - 4 = 5 (the non-truncating branch of monus)
        agree(Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 9),
                Instr::Li(Reg::Loc(1), 4),
                Instr::Bin(BinOp::Sub, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        });
    }

    #[test]
    fn branch_and_compare() {
        // if (1 == 2) rr = 10 else rr = 20  ->  20
        agree(Program {
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
        });
    }

    #[test]
    fn all_comparisons_agree() {
        // Exercise every comparison opcode against run_asm on a fixed pair (7 vs 4).
        for op in [BinOp::Eq, BinOp::Ne, BinOp::Lt, BinOp::Le, BinOp::Gt, BinOp::Ge] {
            agree(Program {
                code: vec![
                    Instr::Li(Reg::Loc(0), 7),
                    Instr::Li(Reg::Loc(1), 4),
                    Instr::Bin(op, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
                    Instr::Halt,
                ],
                labels: vec![],
            });
        }
    }

    #[test]
    fn a_counting_loop_terminates_and_agrees() {
        // r0 = 5; while r0 != 0 { r0 = r0 - 1; rr = rr + 10 }  -> rr = 50 (backward Jz + Jmp).
        agree(Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 5),
                Instr::Li(Reg::Rr, 0),
                // loop:
                Instr::Jz(Reg::Loc(0), "done".to_string()), // 2
                Instr::Li(Reg::Loc(1), 1),
                Instr::Bin(BinOp::Sub, Reg::Loc(0), Reg::Loc(0), Reg::Loc(1)),
                Instr::Li(Reg::Loc(2), 10),
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Rr, Reg::Loc(2)),
                Instr::Jmp("loop".to_string()), // 7 (backward)
                // done:
                Instr::Halt, // 8
            ],
            labels: vec![("loop".to_string(), 2), ("done".to_string(), 8)],
        });
    }

    #[test]
    fn builds_and_reads_a_list() {
        // rr = head(tail(cons(1, cons(2, nil)))) == 2
        agree(Program {
            code: vec![
                Instr::Nil(Reg::Loc(0)),
                Instr::Li(Reg::Loc(1), 2),
                Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(0)),
                Instr::Li(Reg::Loc(3), 1),
                Instr::Cons(Reg::Loc(4), Reg::Loc(3), Reg::Loc(2)),
                Instr::Tail(Reg::Loc(5), Reg::Loc(4)),
                Instr::Head(Reg::Rr, Reg::Loc(5)),
                Instr::Halt,
            ],
            labels: vec![],
        });
    }

    #[test]
    fn returns_a_list_and_its_heap_agrees() {
        // rr = cons(1, cons(2, nil)) — a heap-valued result; agree() compares the full heap too.
        agree(Program {
            code: vec![
                Instr::Nil(Reg::Loc(0)),
                Instr::Li(Reg::Loc(1), 2),
                Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(0)),
                Instr::Li(Reg::Loc(3), 1),
                Instr::Cons(Reg::Rr, Reg::Loc(3), Reg::Loc(2)),
                Instr::Halt,
            ],
            labels: vec![],
        });
    }

    #[test]
    fn is_empty_distinguishes_nil_from_cons() {
        agree(Program {
            code: vec![Instr::Nil(Reg::Loc(0)), Instr::IsEmpty(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        });
    }

    #[test]
    fn recursion_sum() {
        // sum(n) = if n==0 {0} else { n + sum(n-1) };  sum(5) == 15
        agree(Program {
            code: vec![
                Instr::Li(Reg::Arg(0), 5),
                Instr::Call("sum".to_string()),
                Instr::Halt,
                // sum:
                Instr::Mov(Reg::Loc(0), Reg::Arg(0)),
                Instr::Li(Reg::Loc(1), 0),
                Instr::Bin(BinOp::Eq, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
                Instr::Jz(Reg::Loc(2), "rec".to_string()),
                Instr::Li(Reg::Rr, 0),
                Instr::Ret,
                // rec:
                Instr::Li(Reg::Loc(3), 1),
                Instr::Bin(BinOp::Sub, Reg::Arg(0), Reg::Loc(0), Reg::Loc(3)),
                Instr::Call("sum".to_string()),
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Rr),
                Instr::Ret,
            ],
            labels: vec![("sum".to_string(), 3), ("rec".to_string(), 9)],
        });
    }

    #[test]
    fn box_roundtrip() {
        // b = box(7); box_get==7; box_set(b,9); rr = box_get(b) == 9
        agree(Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 7),
                Instr::Box(Reg::Loc(1), Reg::Loc(0)),
                Instr::BoxGet(Reg::Loc(2), Reg::Loc(1)),
                Instr::Li(Reg::Loc(3), 9),
                Instr::BoxSet(Reg::Loc(1), Reg::Loc(3)),
                Instr::BoxGet(Reg::Rr, Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        });
    }

    #[test]
    fn two_boxes_are_independent() {
        agree(Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 3),
                Instr::Box(Reg::Loc(1), Reg::Loc(0)),
                Instr::Li(Reg::Loc(2), 4),
                Instr::Box(Reg::Loc(3), Reg::Loc(2)),
                Instr::Li(Reg::Loc(4), 5),
                Instr::BoxSet(Reg::Loc(1), Reg::Loc(4)),
                Instr::BoxGet(Reg::Rr, Reg::Loc(3)),
                Instr::Halt,
            ],
            labels: vec![],
        });
    }

    #[test]
    fn head_of_nil_faults() {
        agree(Program {
            code: vec![Instr::Nil(Reg::Loc(0)), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        });
    }

    #[test]
    fn dangling_list_pointer_faults() {
        agree(Program {
            code: vec![Instr::Li(Reg::Loc(0), 5), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        });
        agree(Program {
            code: vec![Instr::Li(Reg::Loc(0), 5), Instr::Tail(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        });
    }

    #[test]
    fn box_get_of_null_and_box_set_of_dangling_fault() {
        agree(Program {
            code: vec![Instr::Li(Reg::Loc(0), 0), Instr::BoxGet(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        });
        agree(Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 5),
                Instr::Li(Reg::Loc(1), 1),
                Instr::BoxSet(Reg::Loc(0), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        });
    }

    #[test]
    fn heap_cap_stops_unbounded_cons() {
        // r0 = nil; cons; cons — with heap:1 the second cons trips the cap (both HitCap).
        agree_caps(
            Program {
                code: vec![
                    Instr::Nil(Reg::Loc(0)),
                    Instr::Cons(Reg::Loc(1), Reg::Loc(0), Reg::Loc(0)),
                    Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(1)),
                    Instr::Halt,
                ],
                labels: vec![],
            },
            Caps { heap: 1, ..DEFAULT_CAPS },
        );
    }

    #[test]
    fn infinite_loop_hits_cap() {
        let prog = Program { code: vec![Instr::Jmp("loop".into())], labels: vec![("loop".into(), 0)] };
        assert!(matches!(compile_and_run(&prog, Caps { steps: 1000, ..DEFAULT_CAPS }), NativeRun::HitCap));
    }

    #[test]
    fn infinite_recursion_hits_cap_without_stack_overflow() {
        // `$main: call $main; halt` — self-recursion that never returns. Must trip the stack-depth
        // cap (via rt_enter, before each native call) and NOT overflow the OS stack. The brief's
        // bare `[Call("f")]` has no return point for the partition's reachability walk; a trailing
        // `Halt` gives one without changing the (never-taken) behaviour.
        let prog = Program { code: vec![Instr::Call("f".into()), Instr::Halt], labels: vec![("f".into(), 0)] };
        assert!(matches!(compile_and_run(&prog, Caps { stack: 5000, ..DEFAULT_CAPS }), NativeRun::HitCap));
        // And it agrees with run_asm, which also HitCaps on the same program.
        assert!(matches!(run_asm(&prog, Caps { stack: 5000, ..DEFAULT_CAPS }), AsmRun::HitCap));
    }

    #[test]
    fn mutual_style_recursion_terminates_via_stack_cap() {
        // main: call f; halt   |   f: call f; ret   — a two-subroutine non-terminating recursion.
        let prog = Program {
            code: vec![Instr::Call("f".into()), Instr::Halt, Instr::Call("f".into()), Instr::Ret],
            labels: vec![("f".into(), 2)],
        };
        assert!(matches!(compile_and_run(&prog, Caps { stack: 2000, ..DEFAULT_CAPS }), NativeRun::HitCap));
    }

    #[test]
    fn undefined_call_target_is_lower_error() {
        let prog = Program { code: vec![Instr::Call("missing".into()), Instr::Halt], labels: vec![] };
        assert!(matches!(compile_and_run(&prog, DEFAULT_CAPS), NativeRun::LowerError(_)));
    }

    #[test]
    fn a_huge_register_index_is_rejected_not_a_process_abort() {
        // C1: `run_asm` scans for `Reg::Loc/Arg(n) >= MAX_REGISTERS` and faults to avoid a multi-GB
        // `Vec::resize` abort. Native must likewise reject up front (as `LowerError`) rather than
        // materialise a billion-slot `Variable` bank and abort the whole process. Before the fix
        // this aborted; after it, it returns `LowerError`.
        let prog = Program { code: vec![Instr::Li(Reg::Loc(4_000_000_000), 0), Instr::Halt], labels: vec![] };
        assert!(matches!(compile_and_run(&prog, DEFAULT_CAPS), NativeRun::LowerError(_)));
        // `run_asm` faults on the same program; both are "not a value" (out of oracle scope).
        assert!(matches!(run_asm(&prog, DEFAULT_CAPS), AsmRun::Fault(_)));
    }

    #[test]
    fn add_saturates_on_overflow_like_run_asm() {
        // I1: u64::MAX + u64::MAX saturates to u64::MAX (run_asm uses `saturating_add`). The old
        // wrapping `iadd` gave u64::MAX - 1, so this diverged before the fix.
        agree(Program {
            code: vec![
                Instr::Li(Reg::Loc(0), u64::MAX),
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Loc(0)),
                Instr::Halt,
            ],
            labels: vec![],
        });
    }

    #[test]
    fn mul_saturates_on_overflow_like_run_asm() {
        // I1: u64::MAX * u64::MAX saturates to u64::MAX (run_asm uses `saturating_mul`). The old
        // wrapping `imul` gave 1, so this diverged before the fix.
        agree(Program {
            code: vec![
                Instr::Li(Reg::Loc(0), u64::MAX),
                Instr::Bin(BinOp::Mul, Reg::Rr, Reg::Loc(0), Reg::Loc(0)),
                Instr::Halt,
            ],
            labels: vec![],
        });
    }

    #[test]
    fn a_faulting_callee_in_a_loop_is_fault_not_hit_cap() {
        // I2: `main` loops calling `crash`, which faults (head of nil). `run_asm` faults on the
        // first iteration. Native must ALSO report `Fault`: without the `stopped()` guard in
        // `rt_tick`/`rt_enter`, the loop's back-edge keeps ticking and eventually sets `hit_cap`,
        // masking the fault as `HitCap` (the driver checks `hit_cap` before `fault`).
        let prog = Program {
            code: vec![
                Instr::Call("crash".into()),       // 0  loop:
                Instr::Jmp("loop".into()),         // 1  (backward edge → rt_tick)
                Instr::Nil(Reg::Loc(0)),           // 2  crash:
                Instr::Head(Reg::Rr, Reg::Loc(0)), // 3  head of nil → fault
                Instr::Ret,                        // 4
            ],
            labels: vec![("loop".into(), 0), ("crash".into(), 2)],
        };
        agree_caps(prog, Caps { steps: 1000, ..DEFAULT_CAPS });
    }

    #[test]
    fn a_non_main_callee_containing_halt_is_rejected_not_miscompiled() {
        // I3: `f` (a `Call` target) contains a `Halt`, which under `run_asm` ends the whole program
        // with rr==7. The old codegen lowered `Halt` as a plain `Ret`, resuming `main` and yielding
        // the WRONG rr==99. The fix rejects a non-`$main` `Halt` at partition time → `LowerError`
        // (never `Ran(99)`).
        let prog = Program {
            code: vec![
                Instr::Call("f".into()), // 0
                Instr::Li(Reg::Rr, 99),  // 1
                Instr::Halt,             // 2
                Instr::Li(Reg::Rr, 7),   // 3  f:
                Instr::Halt,             // 4
            ],
            labels: vec![("f".into(), 3)],
        };
        let native = compile_and_run(&prog, DEFAULT_CAPS);
        assert!(matches!(native, NativeRun::LowerError(_)), "expected LowerError, got {native:?}");
    }

    #[test]
    fn main_reading_an_arg_sees_zero() {
        // M1: the entry `$main` takes no args (the driver calls it as `(rt_ptr) -> i64`); a `$main`
        // that reads `Arg(0)` must see the init-0 value, matching `run_asm` (args empty → get(0)=0),
        // not garbage from a mis-shaped multi-param signature called as a one-param fn.
        agree(Program {
            code: vec![Instr::Bin(BinOp::Add, Reg::Rr, Reg::Arg(0), Reg::Arg(0)), Instr::Halt],
            labels: vec![],
        });
    }

    /// Build a recursive `countdown(n)` whose `countdown` subroutine writes `fillers` extra `Loc`
    /// registers and reads every one of them AFTER its self-call — keeping them live across the call
    /// so codegen spills them into the frame, making a genuinely FAT native frame. It self-calls `n`
    /// times before returning. With the OLD `caps.stack` depth cap (100_000) and a 64 MiB thread, a
    /// deep run of this program overflows the native stack and aborts the process; with the
    /// frame-size-aware cap it must `HitCap` instead.
    fn fat_recursive_countdown(fillers: u32, depth: u64) -> Program {
        let zero = fillers; // Loc holding the constant 0
        let eqbit = fillers + 1; // Loc holding (n == 0)
        let one = fillers + 2; // Loc holding the constant 1
        let mut code = vec![
            Instr::Li(Reg::Arg(0), depth),   // 0  $main: n = depth
            Instr::Call("countdown".into()), // 1
            Instr::Halt,                     // 2
        ];
        // countdown: entry at index 3.
        for i in 0..fillers {
            code.push(Instr::Li(Reg::Loc(i), 1)); // write each filler
        }
        code.push(Instr::Li(Reg::Loc(zero), 0));
        code.push(Instr::Bin(BinOp::Eq, Reg::Loc(eqbit), Reg::Arg(0), Reg::Loc(zero)));
        code.push(Instr::Jz(Reg::Loc(eqbit), "rec".into())); // n != 0 → recurse
        code.push(Instr::Li(Reg::Rr, 0)); // base case: return 0
        code.push(Instr::Ret);
        let rec_idx = code.len(); // "rec:" label index
        code.push(Instr::Li(Reg::Loc(one), 1));
        code.push(Instr::Bin(BinOp::Sub, Reg::Arg(0), Reg::Arg(0), Reg::Loc(one))); // n -= 1
        code.push(Instr::Call("countdown".into()));
        for i in 0..fillers {
            // Read every filler after the call so they stay live across it (a real, fat spilled frame).
            code.push(Instr::Bin(BinOp::Add, Reg::Rr, Reg::Rr, Reg::Loc(i)));
        }
        code.push(Instr::Ret);
        Program { code, labels: vec![("countdown".into(), 3), ("rec".into(), rec_idx)] }
    }

    #[test]
    fn fat_frame_deep_recursion_returns_hitcap_not_abort() {
        // C1 (the reviewer's repro): a subroutine with a FAT native frame recursing far deeper than
        // that frame size lets the reserved stack hold. Before the fix this overflowed the JIT
        // thread's 64 MiB stack and ABORTED the whole process (uncatchable SIGABRT). The
        // frame-size-aware depth cap must instead return `HitCap` — total, no abort. That this test
        // completes in-suite (rather than killing the test process) is the proof C1 is fixed.
        let prog = fat_recursive_countdown(200, 100_000);
        let run = compile_and_run(&prog, DEFAULT_CAPS);
        assert!(matches!(run, NativeRun::HitCap), "fat-frame deep recursion must HitCap, got {run:?}");
    }

    #[test]
    fn shallow_but_fat_frame_still_runs_to_a_value() {
        // The frame-size-aware cap must NOT spuriously `HitCap` a non-recursive fat-frame program:
        // ~150 locals but only one call deep. `$main` calls `fat` once; `fat` writes 150 locals and
        // returns `Arg(0)`. Native must `Ran` the value, agreeing with `run_asm`.
        let fillers: u32 = 150;
        let mut code = vec![
            Instr::Li(Reg::Arg(0), 42), // 0  $main
            Instr::Call("fat".into()),  // 1  (rr holds fat's return afterwards)
            Instr::Halt,                // 2
        ];
        // fat: entry at index 3.
        for i in 0..fillers {
            code.push(Instr::Li(Reg::Loc(i), 1));
        }
        code.push(Instr::Mov(Reg::Rr, Reg::Arg(0))); // return the argument (42)
        for i in 0..fillers {
            code.push(Instr::Bin(BinOp::Add, Reg::Rr, Reg::Rr, Reg::Loc(i))); // fold fillers in
        }
        code.push(Instr::Ret);
        let prog = Program { code, labels: vec![("fat".into(), 3)] };
        // 42 + 150*1 = 192; agree() checks native == run_asm (both Ran, same value), never HitCap.
        agree(prog);
    }

    #[test]
    fn normal_recursion_still_runs_to_a_value() {
        // A small-frame recursion `sum(100)` must still run to `Ran(5050)`, NOT an early `HitCap`:
        // for a small frame `safe_depth` (512 MiB / a tiny frame) is far larger than `caps.stack`,
        // so `native_depth_cap == caps.stack` and depth-100 recursion is nowhere near it.
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Arg(0), 100),
                Instr::Call("sum".to_string()),
                Instr::Halt,
                // sum:
                Instr::Mov(Reg::Loc(0), Reg::Arg(0)),
                Instr::Li(Reg::Loc(1), 0),
                Instr::Bin(BinOp::Eq, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
                Instr::Jz(Reg::Loc(2), "rec".to_string()),
                Instr::Li(Reg::Rr, 0),
                Instr::Ret,
                // rec:
                Instr::Li(Reg::Loc(3), 1),
                Instr::Bin(BinOp::Sub, Reg::Arg(0), Reg::Loc(0), Reg::Loc(3)),
                Instr::Call("sum".to_string()),
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Rr),
                Instr::Ret,
            ],
            labels: vec![("sum".to_string(), 3), ("rec".to_string(), 9)],
        };
        // Native must produce the value, not HitCap.
        match compile_and_run(&prog, DEFAULT_CAPS) {
            NativeRun::Ran(o) => assert_eq!(o.result, 5050, "sum(100) should be 5050"),
            other => panic!("sum(100) must Ran(5050), got {other:?}"),
        }
        // And it agrees with the asm interpreter.
        assert!(matches!(run_asm(&prog, DEFAULT_CAPS), AsmRun::Ran(o) if o.result == 5050));
    }
}
