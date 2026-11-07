//! The Cranelift codegen: translate an rxm `Program` into Cranelift IR. `translate_subroutine`
//! reaches its callees only through `FuncImports`, so it builds the same CLIF over a
//! `cranelift_module::Module` (`define_all`, which drives a `JITModule` in `jit.rs` and an
//! `ObjectModule` in `aot.rs`) and without one (`module_free`, which needs no ISA and so builds for
//! wasm32). The `Module` half is compiled under the `cranelift` feature only.
//!
//! # The model
//! * **Registers → `Variable`s.** Each function owns one `Variable` per `Loc(i)` (init `0`), per
//!   referenced `Arg(i)` (the first `arity` from the function's params, the rest init `0`), and one
//!   for `Rr` (init `0`). The native call stack provides the rxm frame convention for free: a
//!   callee's `Loc`/`Arg` are its own `Variable`s, so `Loc` is preserved across a `Call` and `Arg`
//!   is volatile, exactly as `run_rxm`'s frame save/restore intends.
//! * **Blocks.** One Cranelift block per reachable body instruction, plus a prologue entry block and
//!   a single shared exit block. `Jz`/`Jmp` branch to the target index's block; fall-through jumps to
//!   the next index's block (guaranteed present in `body` by the reachability partition).
//! * **Source locations.** Every instruction a body instruction lowers to carries that instruction's
//!   code index as its `SourceLoc`, which links CLIF back to rxm; the prologue and the exit carry none.
//! * **Totality.** Where the guards go is the lowering walk's decision (`lower`'s module doc says
//!   why they make a run total); here each one is a call that `brif`s to the exit block when it
//!   returns nonzero. `rt_enter` trips *before* the guarded native call is made, so the real call stack
//!   never overflows. The depth cap is FRAME-SIZE-AWARE (`native_depth_cap` = `min(caps.stack, safe_depth)`):
//!   a fat-frame subroutine gets a proportionally shallower cap so it `HitCap`s before exhausting the
//!   reserved 512 MiB JIT thread stack, for ANY program — never a process abort.
//!
//! # Step accounting is coarse (termination, not exact-count, parity)
//! `run_rxm` charges one `steps` tick per instruction executed; native ticks only *backward edges*
//! and bounds *calls* by depth (`rt_enter`) — enough to force any non-terminating run to trip a
//! cap, but not an exact count. So a straight-line program that `run_rxm` would `HitCap` on a
//! `steps` cap *smaller than its instruction count* can still run to completion natively. This is
//! deliberate: ticking every instruction would defeat the JIT. Native guarantees **termination**,
//! not step-count equality, and the oracle compares terminating *outcomes*. Callers must therefore
//! not pass a `steps` cap tighter than a terminating program needs (use `DEFAULT_CAPS`, or a cap
//! large enough to complete); the `agree`/oracle helpers do exactly that.

use std::collections::HashMap;

#[cfg(feature = "cranelift")]
use cranelift_codegen::Context;
#[cfg(feature = "cranelift")]
use cranelift_codegen::ir::UserFuncName;
use cranelift_codegen::ir::condcodes::IntCC;
use cranelift_codegen::ir::{
    AbiParam, Block, FuncRef, Function, Inst, InstBuilder, Signature, SourceLoc, Value, types,
};
use cranelift_codegen::isa::TargetFrontendConfig;
#[cfg(feature = "cranelift")]
use cranelift_codegen::settings::{self, Configurable};
use cranelift_frontend::{FunctionBuilder, FunctionBuilderContext, Variable};
#[cfg(feature = "cranelift")]
use cranelift_module::{FuncId, Linkage, Module, ModuleError};

use redextape_core::core::BinOp;
use redextape_core::tm::{Program, Reg};

#[cfg(feature = "cranelift")]
use crate::OptLevel;
use crate::analysis::Subroutine;
use crate::lower::{Banks, BodyPos, LowerFault, LowerSink, lower_subroutine};
use crate::rt_imports::{PerRtFn, RtFn};
use crate::shared::param_count;

/// A backend-agnostic codegen error: a human-readable message the driver wraps into its own outcome
/// type (`jit.rs` maps it to `NativeRun::LowerError`). Kept free of any JIT/AOT-specific type so the
/// shared codegen never names a driver's error enum.
pub(crate) struct CodegenError(pub String);

/// Build a `CodegenError` from any displayable value. The driver adds its own framing when it wraps
/// this into its outcome type, so the message here is the bare cause.
#[cfg(feature = "cranelift")]
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
#[cfg(feature = "cranelift")]
pub(crate) fn cranelift_opt_level(opt: OptLevel) -> &'static str {
    match opt {
        OptLevel::O0 => "none",
        OptLevel::O1 | OptLevel::O2 | OptLevel::O3 => "speed",
        OptLevel::Os | OptLevel::Oz => "speed_and_size",
    }
}

/// The ISA flags the JIT compiles with at `opt`, which the snapshot test's fixed ISAs share. They need
/// not match `JITBuilder::with_flags`, which sets `is_pic` per architecture. With
/// `use_colocated_libcalls` and `is_pic` both `false`, every libcall and runtime import is called
/// through its absolute address, with no ±2 GiB reach limit, and `JITModule::new` accepts
/// `is_pic=false` on every host. On x86-64 that flag makes a module-local symbol's address
/// (`func_addr`, `symbol_value`) a RIP-relative `lea` the JIT cannot redirect when out of reach, so
/// the JIT's code takes none. `shared::BYTES_PER_VAR` assumes `is_pic=false` too.
#[cfg(feature = "cranelift")]
pub(crate) fn jit_flags(opt: OptLevel) -> Result<settings::Flags, settings::SetError> {
    let mut flags = settings::builder();
    for (name, value) in
        [("use_colocated_libcalls", "false"), ("is_pic", "false"), ("opt_level", cranelift_opt_level(opt))]
    {
        flags.set(name, value)?;
    }
    Ok(settings::Flags::new(flags))
}

/// The host pointer type (`module.target_config().pointer_type()`), e.g. `I64` on 64-bit targets.
/// Used by the AOT driver (`aot.rs`) to build `main`/`func_addr` code; a `Module`-trait accessor so
/// it works for any backend. (The JIT driver needs no `main` shim, so it never calls this.)
#[cfg(feature = "cranelift")]
pub(crate) fn pointer_type(module: &dyn Module) -> types::Type {
    module.target_config().pointer_type()
}

/// The `FuncId`s `define_all` declared.
#[cfg(feature = "cranelift")]
pub(crate) struct Decls {
    pub(crate) rt: PerRtFn<FuncId>,
    /// entry index → the subroutine's `FuncId`.
    pub(crate) func_ids: HashMap<usize, FuncId>,
}

/// A signature `(rt_ptr: I64, arg0: I64, ..) -> I64` — all words are `I64`.
pub(crate) fn word_signature(config: TargetFrontendConfig, n_args: u32) -> Signature {
    let mut sig = Signature::new(config.default_call_conv);
    sig.params.push(AbiParam::new(types::I64)); // the hidden `*mut Runtime`
    for _ in 0..n_args {
        sig.params.push(AbiParam::new(types::I64));
    }
    sig.returns.push(AbiParam::new(types::I64));
    sig
}

/// The signature of the runtime import `f`: the `*mut Runtime`, its word parameters, and a word
/// return unless it returns nothing.
pub(crate) fn rt_signature(config: TargetFrontendConfig, f: RtFn) -> Signature {
    let mut sig = Signature::new(config.default_call_conv);
    sig.params.push(AbiParam::new(types::I64)); // the `*mut Runtime`
    for _ in 0..f.word_params() {
        sig.params.push(AbiParam::new(types::I64));
    }
    if f.returns_word() {
        sig.returns.push(AbiParam::new(types::I64));
    }
    sig
}

/// Declare the `rt_*` imports in `module`, in `RtFn::ALL`'s order, returning their `FuncId`s.
#[cfg(feature = "cranelift")]
pub(crate) fn declare_rt(module: &mut dyn Module) -> Result<PerRtFn<FuncId>, CodegenError> {
    let mut ids = Vec::with_capacity(RtFn::ALL.len());
    for f in RtFn::ALL {
        let sig = rt_signature(module.target_config(), f);
        ids.push(module.declare_function(f.symbol(), Linkage::Import, &sig).map_err(codegen_error)?);
    }
    Ok(PerRtFn::from_fn(|f| ids[f as usize])) // `ids` is in `RtFn::ALL`'s order, which `f as usize` indexes
}

/// Declare every subroutine up front so `Call` can reference callees defined later, returning each
/// one's `FuncId` by entry index.
#[cfg(feature = "cranelift")]
pub(crate) fn declare_subroutines(
    module: &mut dyn Module,
    subs: &[Subroutine],
) -> Result<HashMap<usize, FuncId>, CodegenError> {
    let mut func_ids: HashMap<usize, FuncId> = HashMap::new();
    for sub in subs {
        let sig = word_signature(module.target_config(), param_count(sub));
        let id = module.declare_function(&sub.name, Linkage::Local, &sig).map_err(codegen_error)?;
        func_ids.insert(sub.entry, id);
    }
    Ok(func_ids)
}

/// When `define_all` hands a subroutine's `Context` to its observer.
#[cfg(feature = "cranelift")]
pub(crate) enum Stage {
    /// Translated, not yet defined: `ctx.func` is the CLIF as built.
    Built,
    /// After `define_function`, which compiles `ctx` and optimises `ctx.func` in place.
    Defined,
}

/// Why `define_all` failed. The AOT driver reports the two kinds as different `AotError`s.
#[cfg(feature = "cranelift")]
#[derive(Debug)]
pub(crate) enum DefineError {
    /// Declaring or translating failed, with `CodegenError`'s message.
    Codegen(String),
    /// `define_function` failed. Boxed, as `ModuleError` is large and this path is cold.
    Module(Box<ModuleError>),
}

#[cfg(feature = "cranelift")]
impl From<CodegenError> for DefineError {
    fn from(e: CodegenError) -> Self {
        DefineError::Codegen(e.0)
    }
}

/// Declare the `rt_*` imports and every subroutine in `module`, then translate and define each
/// subroutine in `subs`' order, handing `observe` its `FuncId` and `Context` at each `Stage`. The JIT,
/// the AOT emitter and the snapshot test all run this one loop, so the snapshots record what this loop
/// builds and compiles, for the fixed targets with the JIT's flags.
#[cfg(feature = "cranelift")]
pub(crate) fn define_all(
    module: &mut dyn Module,
    prog: &Program,
    subs: &[Subroutine],
    fbctx: &mut FunctionBuilderContext,
    mut observe: impl FnMut(Stage, FuncId, &mut Context),
) -> Result<Decls, DefineError> {
    let rt = declare_rt(module)?;
    let func_ids = declare_subroutines(module, subs)?;
    let decls = Decls { rt, func_ids };
    for sub in subs {
        let mut ctx = module.make_context();
        ctx.func.signature = word_signature(module.target_config(), param_count(sub));
        let fid = decls.func_ids[&sub.entry];
        ctx.func.name = UserFuncName::user(0, fid.as_u32());
        let mut imports = ModuleImports { module: &mut *module, decls: &decls, subs };
        translate_subroutine(&mut imports, &mut ctx.func, fbctx, prog, sub, subs)?;
        observe(Stage::Built, fid, &mut ctx);
        module.define_function(fid, &mut ctx).map_err(|e| DefineError::Module(Box::new(e)))?;
        observe(Stage::Defined, fid, &mut ctx);
        module.clear_context(&mut ctx);
    }
    Ok(decls)
}

/// Read register `r` as a value in the current block. Out-of-bank indices read `0`, mirroring the rxm
/// interpreter's `Vm::read` (behind `trace::RxmCursor`), whose `locals.get(n)` / `args.get(n)` fall back to
/// `0` (and keeping this total).
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

/// Emit `x op y` per the rxm interpreter's `eval_bin` (`trace::RxmCursor`). All words are `u64`, so:
/// `Add`/`Mul` SATURATE at `u64::MAX` on overflow (matching `saturating_add`/`saturating_mul`); `Sub` is
/// saturating monus `x - min(x, y)`; comparisons are UNSIGNED. Cranelift has no scalar `*_sat`
/// (those are SIMD lane ops that don't lower for i64), so we detect overflow and clamp: `uadd_overflow`/
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

/// The source location that links a CLIF instruction to the rxm instruction at code index `pc`. A
/// `SourceLoc` holds 31 bits and its all-ones value is the default, which links to none, so a `pc`
/// it cannot hold gets the default.
fn srcloc(pc: usize) -> SourceLoc {
    let none = SourceLoc::default();
    u32::try_from(pc).ok().filter(|&bits| bits < none.bits()).map_or(none, SourceLoc::new)
}

impl From<LowerFault> for CodegenError {
    fn from(f: LowerFault) -> Self {
        CodegenError(f.0)
    }
}

/// The Cranelift spelling of the lowering walk's operations. Registers are `Variable`s. Blocks are
/// created entry first, then one per `body` entry, then the shared exit block, whose `return` is
/// emitted last, in `finish`.
struct ClifSink<'a> {
    b: FunctionBuilder<'a>,
    config: TargetFrontendConfig,
    rt: PerRtFn<FuncRef>,
    /// entry index → that subroutine's `FuncRef` in this function.
    subs: HashMap<usize, FuncRef>,
    rt_ptr: Value,
    args: Vec<Variable>,
    locs: Vec<Variable>,
    rr: Variable,
    /// One block per `body` entry, in `body`'s order, so a `BodyPos` indexes it.
    blocks: Vec<Block>,
    /// Each `body` entry's code index as the source location its instructions carry, by `BodyPos`.
    srclocs: Vec<SourceLoc>,
    exit: Block,
}

impl<'a> ClifSink<'a> {
    /// The function's entry block: the register banks, initialised from the parameters, and the
    /// jump to the block at `entry`.
    fn prologue(
        mut b: FunctionBuilder<'a>,
        config: TargetFrontendConfig,
        rt: PerRtFn<FuncRef>,
        subs: HashMap<usize, FuncRef>,
        banks: Banks,
        body: &[usize],
        entry: BodyPos,
    ) -> Self {
        let entry_block = b.create_block();
        b.append_block_params_for_function_params(entry_block);
        b.switch_to_block(entry_block);
        let params: Vec<Value> = b.block_params(entry_block).to_vec();
        let rt_ptr = params[0];
        let mut args = Vec::with_capacity(banks.args as usize);
        for i in 0..banks.args {
            let var = b.declare_var(types::I64);
            let init = if i < banks.params { params[1 + i as usize] } else { b.ins().iconst(types::I64, 0) };
            b.def_var(var, init);
            args.push(var);
        }
        let mut locs = Vec::with_capacity(banks.locals as usize);
        for _ in 0..banks.locals {
            let var = b.declare_var(types::I64);
            let zero = b.ins().iconst(types::I64, 0);
            b.def_var(var, zero);
            locs.push(var);
        }
        let rr = b.declare_var(types::I64);
        let zero = b.ins().iconst(types::I64, 0);
        b.def_var(rr, zero);
        let blocks: Vec<Block> = (0..body.len()).map(|_| b.create_block()).collect();
        let srclocs = body.iter().copied().map(srcloc).collect();
        let exit = b.create_block();
        b.ins().jump(blocks[entry.get()], &[]);
        ClifSink { b, config, rt, subs, rt_ptr, args, locs, rr, blocks, srclocs, exit }
    }

    /// Call `callee` on the runtime pointer followed by `words`.
    fn call(&mut self, callee: FuncRef, words: &[Value]) -> Inst {
        let mut args = Vec::with_capacity(1 + words.len());
        args.push(self.rt_ptr);
        args.extend_from_slice(words);
        self.b.ins().call(callee, &args)
    }
}

impl LowerSink for ClifSink<'_> {
    type Value = Value;
    type Callee = FuncRef;
    type Error = CodegenError;

    fn missing_entry(entry: usize) -> LowerFault {
        LowerFault(format!("entry {entry} not in body"))
    }

    // The source location stays set through the blocks a guard opens, which lower the same instruction.
    fn begin(&mut self, at: BodyPos) -> Result<(), CodegenError> {
        self.b.switch_to_block(self.blocks[at.get()]);
        self.b.set_srcloc(self.srclocs[at.get()]);
        Ok(())
    }

    fn read(&mut self, r: Reg) -> Result<Value, CodegenError> {
        Ok(read_reg(&mut self.b, r, &self.locs, &self.args, self.rr))
    }

    fn write(&mut self, r: Reg, v: Value) -> Result<(), CodegenError> {
        write_reg(&mut self.b, r, v, &self.locs, &self.args, self.rr);
        Ok(())
    }

    // `iconst`'s `i64` is Cranelift's spelling of a 64-bit immediate bit pattern, not a signed value:
    // `as i64` keeps every bit of a `u64`, and a register is a plain 64-bit word with no sign.
    #[allow(clippy::cast_possible_wrap)]
    fn constant(&mut self, n: u64) -> Result<Value, CodegenError> {
        Ok(self.b.ins().iconst(types::I64, n as i64))
    }

    fn bin(&mut self, op: BinOp, x: Value, y: Value) -> Result<Value, CodegenError> {
        Ok(emit_bin(&mut self.b, op, x, y))
    }

    fn call_rt(&mut self, f: RtFn, words: &[Value]) -> Result<Value, CodegenError> {
        let call = self.call(self.rt[f], words);
        Ok(self.b.inst_results(call)[0])
    }

    fn call_rt_void(&mut self, f: RtFn, words: &[Value]) -> Result<(), CodegenError> {
        self.call(self.rt[f], words);
        Ok(())
    }

    fn guard(&mut self, f: RtFn) -> Result<(), CodegenError> {
        emit_guard(&mut self.b, self.rt[f], self.rt_ptr, self.exit);
        Ok(())
    }

    fn callee(&self, entry: usize) -> Option<FuncRef> {
        self.subs.get(&entry).copied()
    }

    fn call_sub(&mut self, callee: FuncRef, args: &[Value]) -> Result<Value, CodegenError> {
        let call = self.call(callee, args);
        Ok(self.b.inst_results(call)[0])
    }

    fn jump(&mut self, to: BodyPos) -> Result<(), CodegenError> {
        self.b.ins().jump(self.blocks[to.get()], &[]);
        Ok(())
    }

    // `brif` takes its first block on a nonzero `cond`, so `next` comes first.
    fn jump_if_zero(&mut self, cond: Value, target: BodyPos, next: BodyPos) -> Result<(), CodegenError> {
        self.b.ins().brif(cond, self.blocks[next.get()], &[], self.blocks[target.get()], &[]);
        Ok(())
    }

    fn ret(&mut self, v: Value) -> Result<(), CodegenError> {
        self.b.ins().return_(&[v]);
        Ok(())
    }

    // The shared exit block returns a sentinel `0`; the driver classifies the run by the runtime's
    // flags, which every guard that branches here has set. Every guard shares it, so it lowers no one
    // instruction and carries no source location.
    fn finish(mut self) -> Result<(), CodegenError> {
        self.b.switch_to_block(self.exit);
        self.b.set_srcloc(SourceLoc::default());
        let sentinel = self.b.ins().iconst(types::I64, 0);
        self.b.ins().return_(&[sentinel]);
        self.b.seal_all_blocks();
        self.b.finalize(self.config);
        Ok(())
    }
}

/// A function a subroutine's code can call: a runtime import, or the subroutine at this position in
/// `partition`'s order.
#[derive(Clone, Copy)]
pub(crate) enum Callee {
    Rt(RtFn),
    Sub(usize),
}

/// How `translate_subroutine` brings its callees into a function, and the target it builds for.
pub(crate) trait FuncImports {
    fn frontend_config(&self) -> TargetFrontendConfig;
    /// Import `callee` into `func`.
    fn import(&mut self, func: &mut Function, callee: Callee) -> FuncRef;
}

/// The callees `define_all` declared in `module`.
#[cfg(feature = "cranelift")]
struct ModuleImports<'a> {
    module: &'a mut dyn Module,
    decls: &'a Decls,
    subs: &'a [Subroutine],
}

#[cfg(feature = "cranelift")]
impl FuncImports for ModuleImports<'_> {
    fn frontend_config(&self) -> TargetFrontendConfig {
        self.module.target_config()
    }

    fn import(&mut self, func: &mut Function, callee: Callee) -> FuncRef {
        let id = match callee {
            Callee::Rt(f) => self.decls.rt[f],
            Callee::Sub(k) => self.decls.func_ids[&self.subs[k].entry],
        };
        self.module.declare_func_in_func(id, func)
    }
}

/// Translate `sub` into `func`: import the runtime functions and every subroutine of `subs`, so a
/// `Call` can reach any of them, then lower the body through a `ClifSink`.
pub(crate) fn translate_subroutine(
    imports: &mut impl FuncImports,
    func: &mut Function,
    fbctx: &mut FunctionBuilderContext,
    prog: &Program,
    sub: &Subroutine,
    subs: &[Subroutine],
) -> Result<(), CodegenError> {
    let builder = FunctionBuilder::new(func, fbctx);
    let rt = PerRtFn::from_fn(|f| imports.import(builder.func, Callee::Rt(f)));
    // In `subs`' order, the order they are declared in: the import order numbers the `fnN` refs, and
    // the CLIF and vcode text must be the same on every build for the snapshot gate to compare them.
    let callees: HashMap<usize, FuncRef> = subs
        .iter()
        .enumerate()
        .map(|(k, callee)| (callee.entry, imports.import(builder.func, Callee::Sub(k))))
        .collect();
    let arity: HashMap<usize, u32> = subs.iter().map(|callee| (callee.entry, param_count(callee))).collect();
    let config = imports.frontend_config();
    lower_subroutine(
        prog,
        sub,
        |entry| arity.get(&entry).copied(),
        |banks, body, entry| Ok(ClifSink::prologue(builder, config, rt, callees, banks, body, entry)),
    )
}
