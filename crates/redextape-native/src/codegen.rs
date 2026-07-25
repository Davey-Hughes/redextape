//! The Module-generic Cranelift codegen: translate a register-asm `Program` into Cranelift IR by
//! calling ONLY `cranelift_module::Module` trait methods, so the same codegen drives either a
//! `JITModule` (see `jit.rs`) or an `ObjectModule` (AOT, Task 4). Every entry point here takes
//! `module: &mut dyn Module`; a concrete `&mut JITModule`/`&mut ObjectModule` coerces to it at the
//! call site.
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
use cranelift_codegen::ir::{AbiParam, Block, FuncRef, InstBuilder, Signature, Value, types};
use cranelift_frontend::{FunctionBuilder, FunctionBuilderContext, Variable};
use cranelift_module::{FuncId, Linkage, Module};

use redextape_core::core::BinOp;
use redextape_core::tm::{Instr, Program, Reg};

use crate::OptLevel;
use crate::analysis::Subroutine;
use crate::shared::{n_arg_vars, param_count};

/// A backend-agnostic codegen error: a human-readable message the driver wraps into its own outcome
/// type (`jit.rs` maps it to `NativeRun::LowerError`). Kept free of any JIT/AOT-specific type so the
/// shared codegen never names a driver's error enum.
pub(crate) struct CodegenError(pub String);

/// Build a `CodegenError` from any displayable value. The driver adds its own framing when it wraps
/// this into its outcome type, so the message here is the bare cause.
fn codegen_error(msg: impl std::fmt::Display) -> CodegenError {
    CodegenError(msg.to_string())
}

/// The single mapping from this crate's six-level `OptLevel` onto Cranelift's three-level
/// `opt_level` ISA setting. The collapse is deliberate: Cranelift exposes `none`/`speed`/
/// `speed_and_size` only, so `O1..O3` all mean `speed` and both size levels mean `speed_and_size`.
/// LLVM's finer ladder lives in `llvm::opt_level`/`llvm::pass_pipeline`; keeping both mappings
/// single-sourced is what stops the two backends from drifting apart on what a level means.
///
/// Both Cranelift drivers (`jit::build_and_run` and `aot::emit_object`) route through here, so the
/// JIT and the AOT object can never be built at different levels for the same `OptLevel`.
pub(crate) fn cranelift_opt_level(opt: OptLevel) -> &'static str {
    match opt {
        OptLevel::O0 => "none",
        OptLevel::O1 | OptLevel::O2 | OptLevel::O3 => "speed",
        OptLevel::Os | OptLevel::Oz => "speed_and_size",
    }
}

/// The host pointer type (`module.target_config().pointer_type()`), e.g. `I64` on 64-bit targets.
/// Used by the AOT driver (`aot.rs`) to build `main`/`func_addr` code; a `Module`-trait accessor so
/// it works for any backend. (The JIT driver needs no `main` shim, so it never calls this.)
pub(crate) fn pointer_type(module: &dyn Module) -> types::Type {
    module.target_config().pointer_type()
}

/// `FuncId`s of the imported `rt_*` host functions.
pub(crate) struct RtIds {
    pub(crate) cons: FuncId,
    pub(crate) head: FuncId,
    pub(crate) tail: FuncId,
    pub(crate) is_empty: FuncId,
    pub(crate) box_new: FuncId,
    pub(crate) box_get: FuncId,
    pub(crate) box_set: FuncId,
    pub(crate) tick: FuncId,
    pub(crate) enter: FuncId,
    pub(crate) leave: FuncId,
    pub(crate) faulted: FuncId,
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
    fn declare(module: &mut dyn Module, builder: &mut FunctionBuilder, ids: &RtIds) -> RtRefs {
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
pub(crate) struct Decls {
    pub(crate) rt: RtIds,
    /// entry index → the subroutine's `FuncId`.
    pub(crate) func_ids: HashMap<usize, FuncId>,
    /// entry index → the subroutine's arity (number of `Arg` params it takes).
    pub(crate) arity: HashMap<usize, u32>,
}

/// A signature `(rt_ptr: I64, arg0: I64, ..) -> I64` — all words are `I64`.
pub(crate) fn word_signature(module: &dyn Module, n_args: u32) -> Signature {
    let mut sig = module.make_signature();
    sig.params.push(AbiParam::new(types::I64)); // the hidden `*mut Runtime`
    for _ in 0..n_args {
        sig.params.push(AbiParam::new(types::I64));
    }
    sig.returns.push(AbiParam::new(types::I64));
    sig
}

/// Declare the `rt_*` imports in `module`, returning their `FuncId`s.
pub(crate) fn declare_rt(module: &mut dyn Module) -> Result<RtIds, CodegenError> {
    let mut decl = |name: &str, n_params: usize, has_ret: bool| -> Result<FuncId, CodegenError> {
        let mut sig = module.make_signature();
        for _ in 0..n_params {
            sig.params.push(AbiParam::new(types::I64));
        }
        if has_ret {
            sig.returns.push(AbiParam::new(types::I64));
        }
        module.declare_function(name, Linkage::Import, &sig).map_err(codegen_error)
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

/// Declare every subroutine up front so `Call` can reference callees defined later. Returns the
/// entry-index → `FuncId` and entry-index → arity maps that seed `Decls`. Uses only `word_signature`
/// and `module.declare_function`, so it is backend-agnostic. The paired-`HashMap` return is the
/// exact shape `Decls` and the AOT `main` both consume, so it is kept explicit rather than aliased.
#[allow(clippy::type_complexity)]
pub(crate) fn declare_subroutines(
    module: &mut dyn Module,
    subs: &[Subroutine],
) -> Result<(HashMap<usize, FuncId>, HashMap<usize, u32>), CodegenError> {
    let mut func_ids: HashMap<usize, FuncId> = HashMap::new();
    let mut arity: HashMap<usize, u32> = HashMap::new();
    for sub in subs {
        let sig = word_signature(module, param_count(sub));
        let id = module.declare_function(&sub.name, Linkage::Local, &sig).map_err(codegen_error)?;
        func_ids.insert(sub.entry, id);
        arity.insert(sub.entry, param_count(sub));
    }
    Ok((func_ids, arity))
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
pub(crate) fn translate_subroutine(
    module: &mut dyn Module,
    ctx: &mut Context,
    fbctx: &mut FunctionBuilderContext,
    prog: &Program,
    sub: &Subroutine,
    decls: &Decls,
) -> Result<(), CodegenError> {
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
        *block_for.get(&sub.entry).ok_or_else(|| codegen_error(format!("entry {} not in body", sub.entry)))?;
    builder.ins().jump(entry_target, &[]);

    // Resolve a label to the block of the index it precedes.
    let resolve = |l: &str| -> Result<usize, CodegenError> {
        prog.label_index(l).ok_or_else(|| codegen_error(format!("undefined label `{l}`")))
    };
    let block_at = |idx: usize| -> Result<Block, CodegenError> {
        block_for.get(&idx).copied().ok_or_else(|| codegen_error(format!("no block for index {idx}")))
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
                let callee = *sub_refs.get(&target).ok_or_else(|| codegen_error("call to non-subroutine"))?;
                let callee_arity = *decls.arity.get(&target).ok_or_else(|| codegen_error("unknown callee arity"))?;
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
