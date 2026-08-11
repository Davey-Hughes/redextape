//! The LLVM (inkwell) native codegen backend — a second native path behind the `Codegen` seam.
//! Reuses the shared runtime (`rt_*`), `analysis::partition`, the frame-size-aware depth cap, and the
//! `Runtime`/decode/totality machinery; only the asm->LLVM-IR walk is new (mirrors `codegen`).
//!
//! # The model (deliberately the same shape as `codegen.rs`, arm for arm)
//! * **Registers → entry-block `alloca`s.** Each LLVM function owns one `i64` slot per `Loc(i)` (init
//!   `0`), per referenced `Arg(i)` (the first `param_count` from the function's params, the rest init
//!   `0`), and one for `Rr` (init `0`). Cranelift's `Variable`s are SSA-with-a-frontend; LLVM's
//!   equivalent at IR-build time is a stack slot the `mem2reg`/SROA pass promotes back into SSA. The
//!   native call stack therefore provides the asm frame convention for free: a callee's `Loc`/`Arg`
//!   are its own slots, so `Loc` is preserved across a `Call` and `Arg` is volatile, exactly as
//!   `run_asm`'s frame save/restore intends. Every `alloca` lives in the function's `prologue` block
//!   (never in a loop), so a frame's size is fixed no matter how long the function runs.
//! * **Blocks.** One `BasicBlock` per reachable body instruction, plus the `prologue` and a single
//!   shared `exit` block. `Jz`/`Jmp` branch to the target index's block; fall-through branches to the
//!   next index's block (guaranteed present in `body` by the reachability partition).
//! * **Totality.** Identical to the Cranelift backend: `rt_tick` before every backward `Jz`/`Jmp`
//!   (so any loop trips the step cap) and `rt_enter` at every `Call`, *before* the guarded call is
//!   made (so infinite recursion trips the frame-size-aware `native_depth_cap` while the real call
//!   stack still has room — never a process abort). Each guard `br`s to the shared `exit` block once
//!   its signal is nonzero.
//! * **Step accounting is COARSE** (termination parity, not exact-step parity), exactly as for
//!   Cranelift. `run_asm` charges one `steps` tick per instruction executed; native ticks only
//!   *backward edges* and *calls* — enough to force any non-terminating run to trip a cap, but not
//!   an exact count, because ticking every instruction would defeat the point of compiling. So a
//!   straight-line program that `run_asm` would `HitCap` on a `steps` cap *smaller than its
//!   instruction count* can still run to completion natively; callers must not pass a `steps` cap
//!   tighter than a terminating program needs (`DEFAULT_CAPS`, or larger, is what the oracle uses).
//!   Native guarantees **termination**, not step-count equality, and the oracle compares terminating
//!   *outcomes*. (Spelled out here rather than cross-referenced: under
//!   `--no-default-features --features llvm` the Cranelift module is not compiled at all, so a
//!   "see `codegen.rs`" pointer would name a module that does not exist in that config's rustdoc.)
//! * **Heap/box.** Lists and boxes live in the host `Runtime`'s arenas, exactly as for Cranelift:
//!   each `Cons`/`Head`/`Tail`/`IsEmpty`/`Box`/`BoxGet`/`BoxSet` is a call to the matching `rt_*`
//!   host function, so the pointer representation (1-based, `0` = nil) and every fault/cap condition
//!   are `run_asm`'s by construction rather than by reimplementation. Each op that can fault or trip
//!   the heap cap is followed by an `rt_faulted` guard (the same `br exit` pattern as the cap
//!   guards), so a latched fault short-circuits to the driver's `Fault`/`HitCap` classification
//!   instead of running on with a bogus `0`. (`Nil` needs no call at all: it is a pure register write
//!   of `0`.)
//! * **Agreement.** `compile_and_run` must produce the same `NativeRun` outcome as `run_asm` and as
//!   the Cranelift JIT on every `Program`: `Add`/`Mul` SATURATE at `u64::MAX` (via
//!   `llvm.uadd.sat.i64` and `llvm.umul.with.overflow.i64` + `select`, NOT wrapping `add`/`mul`),
//!   `Sub` is monus (`llvm.usub.sat.i64`), and every comparison is UNSIGNED.

use std::collections::HashMap;
use std::sync::OnceLock;

use inkwell::attributes::{Attribute, AttributeLoc};
use inkwell::basic_block::BasicBlock;
use inkwell::builder::Builder;
use inkwell::context::Context;
use inkwell::execution_engine::{ExecutionEngine, JitFunction};
use inkwell::intrinsics::Intrinsic;
use inkwell::module::{Linkage, Module};
use inkwell::passes::PassBuilderOptions;
use inkwell::targets::{CodeModel, FileType, InitializationConfig, RelocMode, Target, TargetMachine};
use inkwell::types::BasicMetadataTypeEnum;
use inkwell::values::{BasicMetadataValueEnum, BasicValueEnum, FunctionValue, IntValue, PointerValue};
use inkwell::{AddressSpace, IntPredicate, OptimizationLevel};

use redextape_core::core::{BinOp, NodeId};
use redextape_core::tm::{Caps, Instr, LowerError, Program, Reg};
use redextape_native_rt::{
    RUN_STACK_SIZE, Runtime, rt_box, rt_box_get, rt_box_set, rt_cons, rt_enter, rt_faulted, rt_head, rt_is_empty,
    rt_leave, rt_tail, rt_tick,
};

use crate::analysis::{Subroutine, partition};
use crate::shared::{MAX_REGISTERS, n_arg_vars, native_depth_cap, param_count, reg_over_cap};
use crate::{NativeRun, OptLevel};

/// Wrap any inkwell/LLVM/JIT failure as a `LowerError` outcome. None of these paths is expected to
/// fire for a partitioned `Program` (the label/CFG invariants are already checked by `partition`);
/// they exist so the backend stays TOTAL instead of unwrapping. Mirrors `jit::internal_error`.
fn internal_error(msg: impl std::fmt::Display) -> NativeRun {
    NativeRun::LowerError(LowerError::Unsupported { node: NodeId::default(), what: format!("llvm codegen: {msg}") })
}

/// A codegen failure while building IR: a human-readable cause the driver wraps into `NativeRun`.
/// The IR walk returns `Result<_, IrError>` everywhere rather than unwrapping, so a malformed
/// `Program` (or an inkwell builder error) becomes a `LowerError`, never a panic.
type IrError = String;

/// Adapt any displayable inkwell error (`BuilderError`, `LLVMString`, ...) into an `IrError`.
fn ir_err(e: impl std::fmt::Display) -> IrError {
    e.to_string()
}

/// Translate the crate-level `OptLevel` into an LLVM optimization level. ONE mapping, used for BOTH
/// knobs `opt` drives — the `TargetMachine` (which supplies the IR pass pipeline its target model and
/// is also what MCJIT compiles through) and the `ExecutionEngine`'s codegen level — so the two can
/// never disagree about what `-O2` means. `None`/`Less`/`Default`/`Aggressive` are LLVM's
/// `-O0`/`-O1`/`-O2`/`-O3`.
///
/// `Os`/`Oz` both map to `Default` (`-O2`) DELIBERATELY, not by oversight: inkwell's codegen
/// `OptimizationLevel` is LLVM's four-point `CodeGenOptLevel` enum, which has no size variant at all
/// (in LLVM proper, `-Os`/`-Oz` are a *pipeline* plus per-function attributes, and clang drives their
/// codegen at the `-O2`-equivalent level — `CodeGenOpt::Default` — for exactly this reason). The size
/// preference reaches codegen through the `optsize`/`minsize` function attributes instead; see
/// `size_attributes`.
fn opt_level(opt: OptLevel) -> OptimizationLevel {
    match opt {
        OptLevel::O0 => OptimizationLevel::None,
        OptLevel::O1 => OptimizationLevel::Less,
        OptLevel::O2 | OptLevel::Os | OptLevel::Oz => OptimizationLevel::Default,
        OptLevel::O3 => OptimizationLevel::Aggressive,
    }
}

/// The new-pass-manager pipeline string for `opt`, or `None` at `O0` (where the pipeline is skipped
/// entirely — `default<O0>` is not a no-op, it still runs the always-inliner and the coroutine
/// passes, and `O0` is meant to be the *unoptimized* leg the differential compares against).
/// `default<O_>` is LLVM's stable textual spelling of the same pipeline `clang -O_` builds — size
/// levels included: `default<Os>`/`default<Oz>` are what `clang -Os`/`-Oz` construct.
///
/// Deliberately NOT here: the `lto-pre-link<O_>`/`lto<O_>` pipelines. This backend builds a single
/// module and JITs it in-process, so there is no second translation unit for LTO to link against.
fn pass_pipeline(opt: OptLevel) -> Option<&'static str> {
    match opt {
        OptLevel::O0 => None,
        OptLevel::O1 => Some("default<O1>"),
        OptLevel::O2 => Some("default<O2>"),
        OptLevel::O3 => Some("default<O3>"),
        OptLevel::Os => Some("default<Os>"),
        OptLevel::Oz => Some("default<Oz>"),
    }
}

/// The function attributes that carry `opt`'s SIZE preference, by LLVM attribute name.
///
/// The pipeline string is only half of `-Os`/`-Oz`. The other half is per-function: the inliner's
/// threshold, the loop unroller, the vectorizer and the backend all read `optsize`/`minsize` off the
/// individual function rather than off the pipeline, so a `default<Oz>` run over functions carrying
/// neither attribute gets a fraction of the intended effect.
///
/// The mapping is exactly what clang emits, verified rather than assumed — on the pinned LLVM 22.1,
/// `clang -Os -S -emit-llvm` puts `optsize` in the function's attribute group, `clang -Oz` puts
/// `minsize` AND `optsize`, and `-O0`..`-O3` put neither.
fn size_attributes(opt: OptLevel) -> &'static [&'static str] {
    match opt {
        OptLevel::O0 | OptLevel::O1 | OptLevel::O2 | OptLevel::O3 => &[],
        OptLevel::Os => &["optsize"],
        OptLevel::Oz => &["minsize", "optsize"],
    }
}

/// Attach `size_attributes(opt)` to every DEFINED function in `module`.
///
/// Scope — only functions with a body, i.e. the subroutines this module owns. The `rt_*` imports and
/// the `llvm.*` intrinsics are bare declarations of code defined elsewhere; decorating them would be
/// asserting a size preference about a definition this module does not have.
///
/// Ordering — this runs while the module is still being built, so every attribute is in place before
/// `run_passes` (which is the only order that works: the pipeline READS these). It is also the only
/// order that is SAFE. The `default<O_>` pipelines delete functions — `globaldce` drops the unused
/// `rt_*` declarations and any subroutine the inliner fully folded away — so a `FunctionValue`
/// captured before the pass run may be dangling after it. Nothing here retains a handle: the
/// `FunctionValue`s are obtained from `module.get_functions()` and used within this call, and it
/// returns before any pass runs. (Same hazard `map_rt_symbols` documents, resolved the same way:
/// never carry a handle across `run_passes`.)
///
/// A name LLVM does not recognise yields kind id `0` from `get_named_enum_kind_id`, which would
/// silently create a bogus attribute nothing reads. That is reported as an error rather than skipped,
/// so an attribute renamed out from under us fails loudly instead of quietly disabling `-Os`/`-Oz`.
fn apply_size_attributes<'ctx>(ctx: &'ctx Context, module: &Module<'ctx>, opt: OptLevel) -> Result<(), IrError> {
    let names = size_attributes(opt);
    if names.is_empty() {
        return Ok(());
    }
    let mut attrs = Vec::with_capacity(names.len());
    for name in names {
        let kind = Attribute::get_named_enum_kind_id(name);
        if kind == 0 {
            return Err(format!("LLVM does not recognise the `{name}` function attribute"));
        }
        attrs.push(ctx.create_enum_attribute(kind, 0));
    }
    for func in module.get_functions().filter(|f| f.count_basic_blocks() > 0) {
        for attr in &attrs {
            func.add_attribute(AttributeLoc::Function, *attr);
        }
    }
    Ok(())
}

/// `Target::initialize_native` once per process instead of once per compile.
///
/// The `OnceLock` is MEMOIZATION, not synchronisation. Registration is already thread-safe in the
/// pinned inkwell 0.9: `targets.rs` defines a global `TARGET_LOCK: RwLock<()>` and
/// `initialize_native` takes `TARGET_LOCK.write()` around every init step — including when it is
/// called from inside `Module::create_jit_execution_engine`, which invokes it unconditionally on the
/// module's behalf. So there is no race here to close and nothing upstream that needs fixing. What
/// the `OnceLock` buys is that the (cheap, but not free) registration and its `Result` are computed
/// once per process rather than once per compile, and that a registration FAILURE surfaces as an
/// `IrError` from our own code path — where every caller already threads it into `NativeRun`.
fn init_native_target() -> Result<(), IrError> {
    static INIT: OnceLock<Result<(), String>> = OnceLock::new();
    INIT.get_or_init(|| Target::initialize_native(&InitializationConfig::default())).clone()
}

/// The host `TargetMachine`, built at `opt`'s codegen level. ONE machine per compile serves both
/// purposes it is needed for: supplying the module's data layout before any IR is built, and giving
/// the IR pass pipeline (`run_passes`) its target model. It is deliberately not cached across
/// compiles — `TargetMachine` wraps a raw LLVM handle that is neither `Send` nor `Sync`, and each
/// compile wants its own `opt` level anyway.
fn host_target_machine(opt: OptLevel) -> Result<TargetMachine, IrError> {
    init_native_target()?;
    let triple = TargetMachine::get_default_triple();
    let target = Target::from_triple(&triple).map_err(ir_err)?;
    target
        .create_target_machine(
            &triple,
            &TargetMachine::get_host_cpu_name().to_string_lossy(),
            &TargetMachine::get_host_cpu_features().to_string_lossy(),
            opt_level(opt),
            RelocMode::Default,
            CodeModel::JITDefault,
        )
        .ok_or_else(|| "could not create a target machine for the host".to_string())
}

/// Point the module at the host target BEFORE any IR is built. LLVM bakes an alignment into every
/// `alloca`/`load`/`store` at construction time from the module's current data layout, so a module
/// left with LLVM's empty default layout (where `i64` has ABI alignment 4) emits under-aligned
/// memory operations that survive into codegen even though the JIT later attaches the real layout.
/// Setting the host triple + data layout up front makes the register slots naturally aligned, and is
/// also what lets the IR pass pipeline reason about the target at all (`mem2reg`/SROA promoting the
/// register banks, the cost model behind inlining and unrolling).
fn set_host_target(module: &Module<'_>, machine: &TargetMachine) {
    // Both taken FROM the machine, so the module the pass pipeline sees can never describe a
    // different target than the machine that pipeline (and MCJIT) reasons with.
    module.set_triple(&machine.get_triple());
    module.set_data_layout(&machine.get_target_data().get_data_layout());
}

/// Run the `-O1`/`-O2`/`-O3` IR pass pipeline over the built module (a no-op at `O0`).
///
/// This is the knob that actually OPTIMIZES: `opt_level` alone only tells MCJIT how hard to work in
/// instruction selection, which leaves the register banks as `alloca` traffic and the block-per-asm
/// -instruction CFG intact. `default<O_>` promotes the banks into SSA (`mem2reg`/SROA), folds the
/// constants the asm lowering leaves behind, and collapses the CFG.
///
/// Every guard the totality argument rests on survives this by construction, not by luck: `rt_tick`
/// / `rt_enter` / `rt_faulted` are opaque external declarations, so no pass may assume them
/// side-effect-free, reorder them past each other, or delete the `br exit` edges they feed. The
/// `llvm-O0 == llvm-O1..O3` differential is what checks that claim empirically.
fn optimize(module: &Module<'_>, machine: &TargetMachine, opt: OptLevel) -> Result<(), IrError> {
    match pass_pipeline(opt) {
        None => Ok(()),
        Some(pipeline) => module.run_passes(pipeline, machine, PassBuilderOptions::create()).map_err(ir_err),
    }
}

/// The `rt_*` host functions this backend imports, as LLVM declarations — the same set
/// `codegen::RtIds` imports for Cranelift, so both backends drive one shared runtime.
struct RtFns<'ctx> {
    /// `rt_cons(rt, h, t) -> u64` — allocates a cell; returns its 1-based pointer.
    cons: FunctionValue<'ctx>,
    /// `rt_head(rt, p) -> u64` — faults on a nil/dangling pointer.
    head: FunctionValue<'ctx>,
    /// `rt_tail(rt, p) -> u64` — faults on a nil/dangling pointer.
    tail: FunctionValue<'ctx>,
    /// `rt_is_empty(rt, p) -> u64` — `1` iff `p == 0`; never faults.
    is_empty: FunctionValue<'ctx>,
    /// `rt_box(rt, v) -> u64` — allocates a box; returns its 1-based handle.
    box_new: FunctionValue<'ctx>,
    /// `rt_box_get(rt, p) -> u64` — faults on a null/dangling handle.
    box_get: FunctionValue<'ctx>,
    /// `rt_box_set(rt, p, v)` — in-place write; faults on a null/dangling handle. Returns void.
    box_set: FunctionValue<'ctx>,
    /// `rt_tick(rt) -> u64` — step cap, called before every backward branch.
    tick: FunctionValue<'ctx>,
    /// `rt_enter(rt) -> u64` — stack-depth cap, called *before* every `Call`.
    enter: FunctionValue<'ctx>,
    /// `rt_leave(rt)` — pops the depth counter after a `Call` returns.
    leave: FunctionValue<'ctx>,
    /// `rt_faulted(rt) -> u64` — `1` once a fault or a cap has latched; the guard emitted after every
    /// faultable/allocating heap op.
    faulted: FunctionValue<'ctx>,
}

/// Declare the `rt_*` imports. Their LLVM types must match the `extern "C"` signatures in
/// `redextape_native_rt` exactly — the JIT binds these by ADDRESS (see `map_rt_symbols`), so a
/// mismatched declaration would be a silent ABI miscompile rather than a link error. The
/// `*mut Runtime` is always the leading parameter; `rt_leave`/`rt_box_set` return void and every
/// other import returns `i64`.
fn declare_rt<'ctx>(ctx: &'ctx Context, module: &Module<'ctx>) -> RtFns<'ctx> {
    let ptr = ctx.ptr_type(AddressSpace::default());
    let i64t = ctx.i64_type();
    let guard_ty = i64t.fn_type(&[ptr.into()], false); // (rt) -> i64
    let leave_ty = ctx.void_type().fn_type(&[ptr.into()], false); // (rt)
    let word1_ty = i64t.fn_type(&[ptr.into(), i64t.into()], false); // (rt, w) -> i64
    let word2_ty = i64t.fn_type(&[ptr.into(), i64t.into(), i64t.into()], false); // (rt, w, w) -> i64
    let set_ty = ctx.void_type().fn_type(&[ptr.into(), i64t.into(), i64t.into()], false); // (rt, w, w)
    RtFns {
        cons: module.add_function("rt_cons", word2_ty, Some(Linkage::External)),
        head: module.add_function("rt_head", word1_ty, Some(Linkage::External)),
        tail: module.add_function("rt_tail", word1_ty, Some(Linkage::External)),
        is_empty: module.add_function("rt_is_empty", word1_ty, Some(Linkage::External)),
        box_new: module.add_function("rt_box", word1_ty, Some(Linkage::External)),
        box_get: module.add_function("rt_box_get", word1_ty, Some(Linkage::External)),
        box_set: module.add_function("rt_box_set", set_ty, Some(Linkage::External)),
        tick: module.add_function("rt_tick", guard_ty, Some(Linkage::External)),
        enter: module.add_function("rt_enter", guard_ty, Some(Linkage::External)),
        leave: module.add_function("rt_leave", leave_ty, Some(Linkage::External)),
        faulted: module.add_function("rt_faulted", guard_ty, Some(Linkage::External)),
    }
}

/// Every `rt_*` import as (LLVM name, in-process address of the Rust function implementing it).
/// These names must match the ones `declare_rt` adds to the module, or the import would resolve to
/// nothing and the JIT would call address `0` — `every_rt_import_is_mapped` is the test that pins
/// the two lists together.
fn rt_symbols() -> [(&'static str, usize); 11] {
    [
        ("rt_cons", rt_cons as *const u8 as usize),
        ("rt_head", rt_head as *const u8 as usize),
        ("rt_tail", rt_tail as *const u8 as usize),
        ("rt_is_empty", rt_is_empty as *const u8 as usize),
        ("rt_box", rt_box as *const u8 as usize),
        ("rt_box_get", rt_box_get as *const u8 as usize),
        ("rt_box_set", rt_box_set as *const u8 as usize),
        ("rt_tick", rt_tick as *const u8 as usize),
        ("rt_enter", rt_enter as *const u8 as usize),
        ("rt_leave", rt_leave as *const u8 as usize),
        ("rt_faulted", rt_faulted as *const u8 as usize),
    ]
}

/// Bind each surviving `rt_*` declaration to the address of the Rust function that implements it —
/// the inkwell analog of `jit::register_symbols`. Binding by handle (rather than relying on the
/// JIT's process-wide `dlsym` fallback) keeps resolution of the `rt_*` imports independent of
/// whether the host binary exports its `#[unsafe(no_mangle)]` symbols dynamically.
///
/// That claim is scoped to the `rt_*` imports specifically, not to the module's imports as a whole:
/// at `O2`/`O3` loop-idiom recognition may in principle synthesize an `llvm.memcpy`/`llvm.memset`,
/// which lowers to a libc call that appears in neither `declare_rt` nor `rt_symbols` and would fall
/// back to `dlsym`. Negligible in practice — the emitted IR has no memory-copy idiom to recognize
/// (the register banks are scalar `alloca`s the pipeline promotes away) — but the module's import
/// set is not provably closed, so the guarantee is stated only over the imports we do declare.
///
/// The handle is re-fetched from the POST-pass module by name rather than reusing the `FunctionValue`
/// `declare_rt` returned: the `default<O_>` pipeline may delete a declaration that ended up unused
/// (`globaldce`/`strip-dead-prototypes`), which would leave that captured handle dangling and make
/// mapping it undefined behaviour. A name lookup maps exactly the imports still in the module — and
/// the ones that are gone are, by construction, the ones nothing calls. The lookup cannot collide
/// with a subroutine of the same name because `declare_rt` runs FIRST, so `add_function` uniquifies
/// the subroutine's name (`rt_cons.1`), never the import's.
fn map_rt_symbols(ee: &ExecutionEngine<'_>, module: &Module<'_>) {
    for (name, addr) in rt_symbols() {
        if let Some(f) = module.get_function(name) {
            ee.add_global_mapping(&f, addr);
        }
    }
}

/// The intrinsics the SATURATING arithmetic arms lower to. `run_asm`'s `eval_bin` uses
/// `saturating_add`/`saturating_mul` and monus, so plain `add`/`mul`/`sub` (which WRAP) would
/// disagree with the reference on overflow — the exact bug the Cranelift backend shipped once and
/// had to fix, so it is a known trap rather than a hypothetical.
///
/// **The optimizer legitimately UN-saturates these, and that is fine.** In the `O3` IR for `sum`,
/// `llvm.usub.sat(n, 1)` comes out as a plain wrapping `add i64 %n, -1` — correct, because the
/// dominating `icmp eq %n, 0` on the branch to that block proves `n >= 1`, where monus and wrapping
/// subtraction coincide. The consequence worth recording: "grep the optimized IR for `.sat`" is NOT
/// a valid way to check the saturating-arithmetic invariant, at any level above `O0`. Only the
/// differential is — see `add_and_mul_saturate_rather_than_wrap`, which pins the boundary values
/// against `run_asm` at every opt level rather than inspecting the IR.
struct SatFns<'ctx> {
    /// `llvm.uadd.sat.i64` — clamps to `u64::MAX`, matching `u64::saturating_add`.
    add: FunctionValue<'ctx>,
    /// `llvm.usub.sat.i64` — clamps to `0`, i.e. monus, matching `run_asm`'s `x - min(x, y)`.
    sub: FunctionValue<'ctx>,
    /// `llvm.umul.with.overflow.i64` → `{i64, i1}`. LLVM has **no** scalar `llvm.umul.sat` (the only
    /// saturating multiply is the fixed-point `llvm.umul.fix.sat`, which takes an extra scale
    /// operand), so `Mul` clamps via the overflow flag: `select(ovf, u64::MAX, product)` — precisely
    /// what `codegen::emit_bin` does with Cranelift's `umul_overflow` + `select`.
    mul_ovf: FunctionValue<'ctx>,
}

/// Declare the overloaded arithmetic intrinsics at `i64`. `Intrinsic::find` resolves the intrinsic
/// id by name and `get_declaration` instantiates the overload; both return `Option`, so a
/// missing/renamed intrinsic is an `IrError`, never an unwrap.
fn declare_sat<'ctx>(ctx: &'ctx Context, module: &Module<'ctx>) -> Result<SatFns<'ctx>, IrError> {
    let i64t = ctx.i64_type();
    let get = |name: &str| -> Result<FunctionValue<'ctx>, IrError> {
        Intrinsic::find(name)
            .ok_or_else(|| format!("unknown LLVM intrinsic `{name}`"))?
            .get_declaration(module, &[i64t.into()])
            .ok_or_else(|| format!("could not declare `{name}` at i64"))
    };
    Ok(SatFns { add: get("llvm.uadd.sat")?, sub: get("llvm.usub.sat")?, mul_ovf: get("llvm.umul.with.overflow")? })
}

/// `x * y` clamped to `u64::MAX` on overflow. `llvm.umul.with.overflow.i64` returns a `{i64, i1}`
/// pair; extract both fields and `select` `u64::MAX` when the overflow bit is set.
fn emit_saturating_mul<'ctx>(
    ctx: &'ctx Context,
    b: &Builder<'ctx>,
    sat: &SatFns<'ctx>,
    x: IntValue<'ctx>,
    y: IntValue<'ctx>,
) -> Result<IntValue<'ctx>, IrError> {
    let call = b.build_call(sat.mul_ovf, &[x.into(), y.into()], "mulo").map_err(ir_err)?;
    let pair = match call.try_as_basic_value().basic() {
        Some(BasicValueEnum::StructValue(s)) => s,
        other => return Err(format!("umul.with.overflow did not yield a struct: {other:?}")),
    };
    let field = |i: u32, name: &str| -> Result<IntValue<'ctx>, IrError> {
        match b.build_extract_value(pair, i, name).map_err(ir_err)? {
            BasicValueEnum::IntValue(v) => Ok(v),
            other => Err(format!("umul.with.overflow field {i} is not an integer: {other:?}")),
        }
    };
    let product = field(0, "prod")?;
    let overflowed = field(1, "ovf")?;
    match b.build_select(overflowed, ctx.i64_type().const_all_ones(), product, "smul").map_err(ir_err)? {
        BasicValueEnum::IntValue(v) => Ok(v),
        other => Err(format!("saturating multiply select is not an integer: {other:?}")),
    }
}

/// Everything the per-subroutine translation needs beyond the subroutine itself: the imported
/// helpers plus every subroutine's `FunctionValue` and arity (so a `Call` can reference a callee
/// defined later). Mirrors `codegen::Decls`.
struct Decls<'ctx> {
    rt: RtFns<'ctx>,
    sat: SatFns<'ctx>,
    /// entry index → the subroutine's LLVM function.
    funcs: HashMap<usize, FunctionValue<'ctx>>,
    /// entry index → how many `i64` argument params that function takes (`param_count`).
    arity: HashMap<usize, u32>,
}

/// The per-function state the instruction walk reads: the function itself, its hidden `*mut Runtime`
/// param, the three register banks (as `alloca` slots), the shared exit block, and the body-index →
/// block map. Immutable once the prologue is built.
struct Fun<'ctx> {
    func: FunctionValue<'ctx>,
    rt_ptr: PointerValue<'ctx>,
    args: Vec<PointerValue<'ctx>>,
    locs: Vec<PointerValue<'ctx>>,
    rr: PointerValue<'ctx>,
    exit: BasicBlock<'ctx>,
    blocks: HashMap<usize, BasicBlock<'ctx>>,
}

/// The block compiled for body index `idx`. Absent only for a malformed `Program` whose control flow
/// leaves the partitioned body, which `partition` already rejects — so this is defensive.
fn block_at<'ctx>(f: &Fun<'ctx>, idx: usize) -> Result<BasicBlock<'ctx>, IrError> {
    f.blocks.get(&idx).copied().ok_or_else(|| format!("no block for index {idx}"))
}

/// Load one `i64` from a register slot.
fn load_i64<'ctx>(ctx: &'ctx Context, b: &Builder<'ctx>, slot: PointerValue<'ctx>) -> Result<IntValue<'ctx>, IrError> {
    match b.build_load(ctx.i64_type(), slot, "r").map_err(ir_err)? {
        BasicValueEnum::IntValue(v) => Ok(v),
        other => Err(format!("register slot did not load as an i64: {other:?}")),
    }
}

/// Read register `r`. Out-of-bank indices read `0`, mirroring `run_asm`'s
/// `args.get(n).unwrap_or(0)` / `locals.get(n).unwrap_or(0)` (and `codegen::read_reg`).
fn read_reg<'ctx>(ctx: &'ctx Context, b: &Builder<'ctx>, f: &Fun<'ctx>, r: Reg) -> Result<IntValue<'ctx>, IrError> {
    let slot = match r {
        Reg::Loc(n) => f.locs.get(n as usize).copied(),
        Reg::Arg(n) => f.args.get(n as usize).copied(),
        Reg::Rr => Some(f.rr),
    };
    match slot {
        Some(p) => load_i64(ctx, b, p),
        None => Ok(ctx.i64_type().const_zero()),
    }
}

/// Write `val` to register `r`. Out-of-bank indices are no-ops (they never occur — the banks are
/// sized to every register the body references — but this stays panic-free defensively).
fn write_reg<'ctx>(b: &Builder<'ctx>, f: &Fun<'ctx>, r: Reg, val: IntValue<'ctx>) -> Result<(), IrError> {
    let slot = match r {
        Reg::Loc(n) => f.locs.get(n as usize).copied(),
        Reg::Arg(n) => f.args.get(n as usize).copied(),
        Reg::Rr => Some(f.rr),
    };
    if let Some(p) = slot {
        b.build_store(p, val).map_err(ir_err)?;
    }
    Ok(())
}

/// `call` a function whose LLVM return type is `i64`, yielding the result as an `IntValue`. Every
/// call site here (the guards, the saturating intrinsics, a subroutine `Call`) is declared
/// `i64`-returning, so a non-integer result means the declaration and the call disagree — reported
/// rather than `into_int_value()`-panicked.
fn call_i64<'ctx>(
    b: &Builder<'ctx>,
    callee: FunctionValue<'ctx>,
    args: &[BasicMetadataValueEnum<'ctx>],
    name: &str,
) -> Result<IntValue<'ctx>, IrError> {
    let call = b.build_call(callee, args, name).map_err(ir_err)?;
    match call.try_as_basic_value().basic() {
        Some(BasicValueEnum::IntValue(v)) => Ok(v),
        other => Err(format!("call to `{}` did not yield an i64: {other:?}", callee.get_name().to_string_lossy())),
    }
}

/// `icmp` then zero-extend the `i1` result to a `0`/`1` `i64`, matching `u64::from(bool)` (and
/// `codegen::emit_cmp`).
fn emit_cmp<'ctx>(
    ctx: &'ctx Context,
    b: &Builder<'ctx>,
    pred: IntPredicate,
    x: IntValue<'ctx>,
    y: IntValue<'ctx>,
) -> Result<IntValue<'ctx>, IrError> {
    let bit = b.build_int_compare(pred, x, y, "cmp").map_err(ir_err)?;
    b.build_int_z_extend(bit, ctx.i64_type(), "cmpw").map_err(ir_err)
}

/// Emit `x op y` per `run_asm`'s `eval_bin`, mirroring `codegen::emit_bin` arm for arm. All words are
/// `u64`, so: `Add`/`Mul` SATURATE at `u64::MAX` on overflow; `Sub` is saturating monus; comparisons
/// are UNSIGNED. The saturating arms are intrinsic calls (see `SatFns`), *never* plain `add`/`mul`.
fn emit_bin<'ctx>(
    ctx: &'ctx Context,
    b: &Builder<'ctx>,
    sat: &SatFns<'ctx>,
    op: BinOp,
    x: IntValue<'ctx>,
    y: IntValue<'ctx>,
) -> Result<IntValue<'ctx>, IrError> {
    match op {
        BinOp::Add => call_i64(b, sat.add, &[x.into(), y.into()], "sadd"),
        BinOp::Sub => call_i64(b, sat.sub, &[x.into(), y.into()], "ssub"),
        BinOp::Mul => emit_saturating_mul(ctx, b, sat, x, y),
        BinOp::Eq => emit_cmp(ctx, b, IntPredicate::EQ, x, y),
        BinOp::Ne => emit_cmp(ctx, b, IntPredicate::NE, x, y),
        BinOp::Lt => emit_cmp(ctx, b, IntPredicate::ULT, x, y),
        BinOp::Le => emit_cmp(ctx, b, IntPredicate::ULE, x, y),
        BinOp::Gt => emit_cmp(ctx, b, IntPredicate::UGT, x, y),
        BinOp::Ge => emit_cmp(ctx, b, IntPredicate::UGE, x, y),
    }
}

/// Call a `(rt) -> u64` guard (`rt_tick`/`rt_enter`/`rt_faulted`) and branch to the shared `exit`
/// block on a nonzero signal, continuing in a fresh `cont` block otherwise — the inkwell analog of
/// `codegen::emit_guard`. The caller keeps translating in `cont` (the builder is left positioned
/// there).
fn emit_guard<'ctx>(
    ctx: &'ctx Context,
    b: &Builder<'ctx>,
    f: &Fun<'ctx>,
    guard: FunctionValue<'ctx>,
) -> Result<(), IrError> {
    let signal = call_i64(b, guard, &[f.rt_ptr.into()], "guard")?;
    let trip = b.build_int_compare(IntPredicate::NE, signal, ctx.i64_type().const_zero(), "trip").map_err(ir_err)?;
    let cont = ctx.append_basic_block(f.func, "cont");
    b.build_conditional_branch(trip, f.exit, cont).map_err(ir_err)?;
    b.position_at_end(cont);
    Ok(())
}

/// Build the prologue: the register-bank `alloca`s (all in one block, so a frame is fixed-size), the
/// `exit` block's `ret`, and the branch into the subroutine's entry block. Returns the `Fun` the
/// instruction walk reads.
fn build_prologue<'ctx>(
    ctx: &'ctx Context,
    b: &Builder<'ctx>,
    prog: &Program,
    sub: &Subroutine,
    func: FunctionValue<'ctx>,
) -> Result<Fun<'ctx>, IrError> {
    let i64t = ctx.i64_type();
    let prologue = ctx.append_basic_block(func, "prologue");
    let mut blocks: HashMap<usize, BasicBlock<'ctx>> = HashMap::with_capacity(sub.body.len());
    for &idx in &sub.body {
        blocks.insert(idx, ctx.append_basic_block(func, &format!("i{idx}")));
    }
    let exit = ctx.append_basic_block(func, "exit");

    b.position_at_end(prologue);
    let Some(BasicValueEnum::PointerValue(rt_ptr)) = func.get_nth_param(0) else {
        return Err(format!("subroutine `{}` has no `*mut Runtime` parameter", sub.name));
    };

    // Size the `Arg` bank to every `Arg` the body references (read or write); the `Loc` bank to
    // `n_locals`. The first `param_count` args come from the function's params; any extra `Arg`
    // (written only to set up a callee's arguments, or every `Arg` of the entry `$main`, which the
    // driver invokes with no args) starts at `0`. Identical to `codegen::translate_subroutine`.
    let n_params = param_count(sub);
    let n_args = n_arg_vars(prog, sub);
    let mut args = Vec::with_capacity(n_args as usize);
    for i in 0..n_args {
        let slot = b.build_alloca(i64t, &format!("a{i}")).map_err(ir_err)?;
        let init = if i < n_params {
            match func.get_nth_param(i + 1) {
                Some(BasicValueEnum::IntValue(v)) => v,
                _ => return Err(format!("subroutine `{}` parameter {} is not an i64", sub.name, i + 1)),
            }
        } else {
            i64t.const_zero()
        };
        b.build_store(slot, init).map_err(ir_err)?;
        args.push(slot);
    }
    let mut locs = Vec::with_capacity(sub.n_locals as usize);
    for i in 0..sub.n_locals {
        let slot = b.build_alloca(i64t, &format!("l{i}")).map_err(ir_err)?;
        b.build_store(slot, i64t.const_zero()).map_err(ir_err)?;
        locs.push(slot);
    }
    let rr = b.build_alloca(i64t, "rr").map_err(ir_err)?;
    b.build_store(rr, i64t.const_zero()).map_err(ir_err)?;

    let f = Fun { func, rt_ptr, args, locs, rr, exit, blocks };

    // The shared exit block returns a sentinel `0`; the driver classifies by the runtime flags. It is
    // only ever reached with `hit_cap` or `fault` already latched (every guard that branches here
    // returns nonzero exactly then), so its return value is never the program's result.
    b.position_at_end(exit);
    b.build_return(Some(&i64t.const_zero())).map_err(ir_err)?;

    b.position_at_end(prologue);
    b.build_unconditional_branch(block_at(&f, sub.entry)?).map_err(ir_err)?;
    Ok(f)
}

/// Translate one subroutine into `func`'s body — the inkwell analog of
/// `codegen::translate_subroutine`, arm for arm.
// Same shape, same reasoning as `codegen::translate_subroutine`: one coherent state machine (a
// single `match instr` over every `Instr` variant, each arm emitting that opcode's IR against the
// shared `f`/`b`/`decls` state above the loop), not several concerns bundled together — splitting
// it would scatter that shared state across multiple signatures without shrinking what a reader
// holds at once.
#[allow(clippy::too_many_lines)]
// `h`/`t`/`p`/`v`/`x`/`y`/`l`/`r`/`f`/`b` follow the SAME compiler-codegen convention as
// `codegen::translate_subroutine` and `run_asm`'s own `Instr` arms (head/tail/pointer/value/
// left-operand/right-operand/label/register/function/builder) — arm-for-arm identical to the
// Cranelift version, which reads the same way.
#[allow(clippy::many_single_char_names)]
fn translate_subroutine<'ctx>(
    ctx: &'ctx Context,
    b: &Builder<'ctx>,
    prog: &Program,
    sub: &Subroutine,
    func: FunctionValue<'ctx>,
    decls: &Decls<'ctx>,
) -> Result<(), IrError> {
    let i64t = ctx.i64_type();
    let f = build_prologue(ctx, b, prog, sub, func)?;
    let resolve =
        |l: &str| -> Result<usize, IrError> { prog.label_index(l).ok_or_else(|| format!("undefined label `{l}`")) };

    for &idx in &sub.body {
        b.position_at_end(block_at(&f, idx)?);
        let instr = prog.code.get(idx).ok_or_else(|| format!("index {idx} is past the end of code"))?;
        match instr {
            Instr::Li(rd, n) => {
                write_reg(b, &f, *rd, i64t.const_int(*n, false))?;
                b.build_unconditional_branch(block_at(&f, idx + 1)?).map_err(ir_err)?;
            }
            Instr::Mov(rd, rs) => {
                let v = read_reg(ctx, b, &f, *rs)?;
                write_reg(b, &f, *rd, v)?;
                b.build_unconditional_branch(block_at(&f, idx + 1)?).map_err(ir_err)?;
            }
            // `Nil` is a plain register write of the nil pointer (`0`) — no host call, no fault.
            Instr::Nil(rd) => {
                write_reg(b, &f, *rd, i64t.const_zero())?;
                b.build_unconditional_branch(block_at(&f, idx + 1)?).map_err(ir_err)?;
            }
            Instr::Bin(op, rd, ra, rb) => {
                let x = read_reg(ctx, b, &f, *ra)?;
                let y = read_reg(ctx, b, &f, *rb)?;
                let v = emit_bin(ctx, b, &decls.sat, *op, x, y)?;
                write_reg(b, &f, *rd, v)?;
                b.build_unconditional_branch(block_at(&f, idx + 1)?).map_err(ir_err)?;
            }
            Instr::Jz(r, l) => {
                let target = resolve(l)?;
                if target <= idx {
                    emit_guard(ctx, b, &f, decls.rt.tick)?; // backward edge → step cap
                }
                let cond = read_reg(ctx, b, &f, *r)?;
                // Jz: cond == 0 → target; else → fall through to idx + 1.
                let is_zero = b.build_int_compare(IntPredicate::EQ, cond, i64t.const_zero(), "jz").map_err(ir_err)?;
                b.build_conditional_branch(is_zero, block_at(&f, target)?, block_at(&f, idx + 1)?).map_err(ir_err)?;
            }
            Instr::Jmp(l) => {
                let target = resolve(l)?;
                if target <= idx {
                    emit_guard(ctx, b, &f, decls.rt.tick)?; // backward edge → step cap
                }
                b.build_unconditional_branch(block_at(&f, target)?).map_err(ir_err)?;
            }
            Instr::Call(l) => {
                let target = resolve(l)?;
                emit_guard(ctx, b, &f, decls.rt.enter)?; // stack-depth cap, checked before the call
                let callee = *decls.funcs.get(&target).ok_or("call to non-subroutine")?;
                let callee_arity = *decls.arity.get(&target).ok_or("unknown callee arity")?;
                let mut argv: Vec<BasicMetadataValueEnum<'ctx>> = Vec::with_capacity(1 + callee_arity as usize);
                argv.push(f.rt_ptr.into());
                for i in 0..callee_arity {
                    argv.push(read_reg(ctx, b, &f, Reg::Arg(i))?.into());
                }
                let result = call_i64(b, callee, &argv, "call")?;
                write_reg(b, &f, Reg::Rr, result)?;
                // `rt_leave`'s placement AFTER the call is load-bearing for TOTALITY, not merely for
                // balancing the depth counter — and the optimized IR is easy to misread on this
                // point. The pipeline does mark this call `tail`, but LLVM's `tail` marker only means
                // "the callee does not access the caller's stack frame"; it is NOT `musttail` and it
                // is not tail-call optimization. No TCO can fire here, because `rt_leave` (an opaque
                // external call) is always emitted after the call, so the call is never in tail
                // position and the native frame is never reused. That is what makes "each nested
                // `Call` costs one real frame, which `rt_enter` has already counted" true — the whole
                // argument that the frame-size-aware `native_depth_cap` trips before the OS stack is
                // exhausted. Emitting `rt_leave` BEFORE the call would put a self-call in tail
                // position and let TCO turn unbounded recursion into a loop whose depth counter never
                // grows: no stack overflow, but no `HitCap` either — a hang, which is just as much a
                // totality violation.
                b.build_call(decls.rt.leave, &[f.rt_ptr.into()], "leave").map_err(ir_err)?;
                b.build_unconditional_branch(block_at(&f, idx + 1)?).map_err(ir_err)?;
            }
            // `Ret` returns `rr` to the caller; `Halt` stops the whole program with `rr`. They lower
            // identically to a native `return rr` because `partition` rejects any NON-`$main`
            // subroutine that contains a `Halt`, so a `Halt` here can only be `$main`'s own — where
            // "return to the driver" IS "stop the program". (Same reasoning as `codegen.rs`.)
            Instr::Ret | Instr::Halt => {
                let v = read_reg(ctx, b, &f, Reg::Rr)?;
                b.build_return(Some(&v)).map_err(ir_err)?;
            }
            // The heap/box arms below each mirror `codegen.rs`'s Cranelift arm exactly: the same
            // `rt_*` call with the same arguments in the same order, the destination written from the
            // call's result, and — for every op that can fault or trip the heap cap — an `rt_faulted`
            // guard emitted at the same point (after the write, before the fall-through branch).
            Instr::Cons(rd, rh, rt_reg) => {
                let h = read_reg(ctx, b, &f, *rh)?;
                let t = read_reg(ctx, b, &f, *rt_reg)?;
                let v = call_i64(b, decls.rt.cons, &[f.rt_ptr.into(), h.into(), t.into()], "cons")?;
                write_reg(b, &f, *rd, v)?;
                emit_guard(ctx, b, &f, decls.rt.faulted)?; // heap cap
                b.build_unconditional_branch(block_at(&f, idx + 1)?).map_err(ir_err)?;
            }
            Instr::Head(rd, rl) => {
                let p = read_reg(ctx, b, &f, *rl)?;
                let v = call_i64(b, decls.rt.head, &[f.rt_ptr.into(), p.into()], "head")?;
                write_reg(b, &f, *rd, v)?;
                emit_guard(ctx, b, &f, decls.rt.faulted)?; // nil / dangling pointer
                b.build_unconditional_branch(block_at(&f, idx + 1)?).map_err(ir_err)?;
            }
            Instr::Tail(rd, rl) => {
                let p = read_reg(ctx, b, &f, *rl)?;
                let v = call_i64(b, decls.rt.tail, &[f.rt_ptr.into(), p.into()], "tail")?;
                write_reg(b, &f, *rd, v)?;
                emit_guard(ctx, b, &f, decls.rt.faulted)?; // nil / dangling pointer
                b.build_unconditional_branch(block_at(&f, idx + 1)?).map_err(ir_err)?;
            }
            Instr::IsEmpty(rd, rl) => {
                let p = read_reg(ctx, b, &f, *rl)?;
                let v = call_i64(b, decls.rt.is_empty, &[f.rt_ptr.into(), p.into()], "isempty")?;
                write_reg(b, &f, *rd, v)?;
                b.build_unconditional_branch(block_at(&f, idx + 1)?).map_err(ir_err)?; // never faults
            }
            Instr::Box(rd, rv) => {
                let v_in = read_reg(ctx, b, &f, *rv)?;
                let v = call_i64(b, decls.rt.box_new, &[f.rt_ptr.into(), v_in.into()], "box")?;
                write_reg(b, &f, *rd, v)?;
                emit_guard(ctx, b, &f, decls.rt.faulted)?; // heap cap
                b.build_unconditional_branch(block_at(&f, idx + 1)?).map_err(ir_err)?;
            }
            Instr::BoxGet(rd, rb) => {
                let p = read_reg(ctx, b, &f, *rb)?;
                let v = call_i64(b, decls.rt.box_get, &[f.rt_ptr.into(), p.into()], "boxget")?;
                write_reg(b, &f, *rd, v)?;
                emit_guard(ctx, b, &f, decls.rt.faulted)?; // null / dangling handle
                b.build_unconditional_branch(block_at(&f, idx + 1)?).map_err(ir_err)?;
            }
            // `rt_box_set` returns void: there is no result to write, only the guard.
            Instr::BoxSet(rb, rv) => {
                let p = read_reg(ctx, b, &f, *rb)?;
                let v = read_reg(ctx, b, &f, *rv)?;
                b.build_call(decls.rt.box_set, &[f.rt_ptr.into(), p.into(), v.into()], "boxset").map_err(ir_err)?;
                emit_guard(ctx, b, &f, decls.rt.faulted)?; // null / dangling handle
                b.build_unconditional_branch(block_at(&f, idx + 1)?).map_err(ir_err)?;
            }
        }
    }
    Ok(())
}

/// Declare one LLVM function per subroutine up front so a `Call` can reference a callee defined
/// later. Signature: `i64 (ptr rt, i64 arg0, ..)` with `param_count(sub)` argument words — the exact
/// convention `codegen::word_signature` establishes for the Cranelift backend. Returns the
/// entry-index → function and entry-index → arity maps.
#[allow(clippy::type_complexity)]
fn declare_subroutines<'ctx>(
    ctx: &'ctx Context,
    module: &Module<'ctx>,
    subs: &[Subroutine],
) -> (HashMap<usize, FunctionValue<'ctx>>, HashMap<usize, u32>) {
    let i64t = ctx.i64_type();
    let ptr = ctx.ptr_type(AddressSpace::default());
    let mut funcs = HashMap::with_capacity(subs.len());
    let mut arity = HashMap::with_capacity(subs.len());
    for sub in subs {
        let n = param_count(sub);
        let mut params: Vec<BasicMetadataTypeEnum<'ctx>> = Vec::with_capacity(1 + n as usize);
        params.push(ptr.into());
        params.extend(std::iter::repeat_n(BasicMetadataTypeEnum::from(i64t), n as usize));
        // Only the ENTRY needs external linkage — it is the one function the driver looks up in the
        // execution engine by name. Every other subroutine is module-private (`codegen.rs` declares
        // all of them `Linkage::Local` for the same reason), and saying so is not cosmetic: external
        // linkage means "some unknown caller outside this module may call this", which forbids
        // `globaldce` from deleting a subroutine the inliner has already folded into all its callers,
        // and blocks every signature-changing interprocedural pass (argument promotion,
        // dead-argument elimination, function specialisation) on a backend whose whole point is real
        // `-O3`. `Private` rather than `Internal` because these names need not appear in the emitted
        // symbol table at all.
        let linkage = if sub.entry == 0 { Linkage::External } else { Linkage::Private };
        funcs.insert(sub.entry, module.add_function(&sub.name, i64t.fn_type(&params, false), Some(linkage)));
        arity.insert(sub.entry, n);
    }
    (funcs, arity)
}

/// Compile `prog` to LLVM IR at `opt`, JIT it, and run against a fresh `Runtime`.
///
/// Agreement contract: the same `NativeRun` outcome (`Ran`/`HitCap`/`Fault`) as `run_asm` and as the
/// Cranelift JIT, for every `Program`. `partition` failures and any inkwell/JIT failure surface as
/// `NativeRun::LowerError`; nothing here panics. Everything after the up-front `Program` checks runs
/// on a dedicated big-stack thread (`RUN_STACK_SIZE`, a scoped thread so the borrowed `prog`/`subs`
/// need not be `'static`) — both because the generated code recurses on that stack up to the
/// frame-size-aware depth cap, and because inkwell's `Context`/`ExecutionEngine` are not `Send`, so
/// the module must be built *and* run on one thread.
#[must_use]
pub fn compile_and_run(prog: &Program, caps: Caps, opt: OptLevel) -> NativeRun {
    // Reject an absurd register index BEFORE building any function: materialising a billion-plus
    // register bank would attempt a multi-GB allocation whose failure aborts the process. Identical
    // to the Cranelift driver's guard (see `shared::reg_over_cap`).
    if reg_over_cap(prog) {
        return internal_error(format!("register index exceeds MAX_REGISTERS ({MAX_REGISTERS})"));
    }
    let subs = match partition(prog) {
        Ok(subs) => subs,
        Err(e) => return NativeRun::LowerError(e),
    };
    let depth_cap = native_depth_cap(prog, &subs, caps);
    std::thread::scope(|scope| {
        let handle = match std::thread::Builder::new()
            .stack_size(RUN_STACK_SIZE)
            .spawn_scoped(scope, || build_and_run(prog, &subs, caps, depth_cap, opt))
        {
            Ok(handle) => handle,
            Err(e) => return internal_error(format!("spawn LLVM thread: {e}")),
        };
        match handle.join() {
            Ok(run) => run,
            Err(_) => internal_error("LLVM thread panicked"),
        }
    })
}

/// Build and verify the whole module: the host target, the `rt_*`/intrinsic imports, one LLVM
/// function per subroutine, and every subroutine's body. Returns the module plus the name LLVM
/// actually gave the entry function (`entry == 0`, nominally `"$main"` — `add_function` uniquifies
/// on a name clash, so reading it back is what keeps the later lookup correct for an adversarial
/// `Program` whose labels collide). The name is read here, BEFORE any pass runs, but stays valid
/// after: the entry keeps external linkage, so no pass may rename or delete it.
///
/// Split out of `build_and_run` so the IR is observable between "built" and "optimized" — which is
/// how `the_o3_pipeline_actually_transforms_the_ir` proves the pipeline is doing real work rather
/// than passing the differential by doing nothing.
fn build_module<'ctx>(
    ctx: &'ctx Context,
    machine: &TargetMachine,
    prog: &Program,
    subs: &[Subroutine],
    opt: OptLevel,
) -> Result<(Module<'ctx>, String), IrError> {
    let module = ctx.create_module("redextape");
    let builder = ctx.create_builder();
    set_host_target(&module, machine);

    let rt = declare_rt(ctx, &module);
    let sat = declare_sat(ctx, &module)?;
    let (funcs, arity) = declare_subroutines(ctx, &module, subs);
    let decls = Decls { rt, sat, funcs, arity };

    for sub in subs {
        let Some(&func) = decls.funcs.get(&sub.entry) else {
            return Err(format!("subroutine `{}` was not declared", sub.name));
        };
        translate_subroutine(ctx, &builder, prog, sub, func, &decls)?;
    }

    // `-Os`/`-Oz`'s per-function half, attached here — while the module is still being built, hence
    // necessarily before `run_passes` reads it, and without any handle outliving this call.
    apply_size_attributes(ctx, &module, opt)?;

    // Catch malformed IR here (a loud `LowerError`) rather than letting the optimizer or codegen hit
    // it later, where the diagnostic would be far less obviously ours.
    module.verify().map_err(|e| format!("invalid IR: {e}"))?;

    let entry_func = decls.funcs.get(&0).ok_or("no entry subroutine")?;
    let entry_name = entry_func.get_name().to_string_lossy().into_owned();
    Ok((module, entry_name))
}

/// Build the module, optimize it at `opt`, JIT it, and run `$main`. Runs entirely on the spawning
/// (big-stack) thread so the non-`Send` `Context`/`ExecutionEngine` never cross a thread boundary and
/// stay alive for the duration of the call into JIT-compiled code.
///
/// `opt` drives BOTH LLVM knobs: the IR pass pipeline (`optimize`) and the codegen level the
/// `TargetMachine`/`ExecutionEngine` are built at (`opt_level`). The agreement contract holds at
/// every level — see `o0_equals_o3` and the per-level totality tests.
fn build_and_run(prog: &Program, subs: &[Subroutine], caps: Caps, depth_cap: u64, opt: OptLevel) -> NativeRun {
    let ctx = Context::create();
    let machine = match host_target_machine(opt) {
        Ok(m) => m,
        Err(m) => return internal_error(m),
    };
    let (module, entry_name) = match build_module(&ctx, &machine, prog, subs, opt) {
        Ok(built) => built,
        Err(m) => return internal_error(m),
    };

    // Knob 1: the IR pass pipeline, run on the finished module and BEFORE the execution engine takes
    // it over (MCJIT compiles the module it is handed, so a later `run_passes` would be too late).
    if let Err(m) = optimize(&module, &machine, opt) {
        return internal_error(m);
    }

    // Knob 2: the codegen level MCJIT compiles at. The `rt_*` address bindings go on the engine
    // afterwards, resolved against the post-pass module.
    let ee = match module.create_jit_execution_engine(opt_level(opt)) {
        Ok(ee) => ee,
        Err(e) => return internal_error(e),
    };
    map_rt_symbols(&ee, &module);

    // SAFETY: `$main` was emitted as `i64 (ptr)` with the C calling convention, matching
    // `extern "C" fn(*mut Runtime) -> u64`; `ee` outlives the call, so the code stays mapped.
    let main: JitFunction<'_, unsafe extern "C" fn(*mut Runtime) -> u64> = match unsafe { ee.get_function(&entry_name) }
    {
        Ok(f) => f,
        Err(e) => return internal_error(format!("resolving `{entry_name}`: {e}")),
    };

    // `caps.mem` has no native analog (see the Cranelift driver's note): each subroutine's
    // `Loc`/`Arg` are fixed-size stack slots, so a `Call` clones nothing. Native recursion is bounded
    // by the frame-size-aware `depth_cap` via `rt_enter`, checked before each guarded call.
    let mut runtime = Runtime::with_depth_cap(caps, depth_cap);
    // `&raw mut`, not `&mut runtime`, so no intermediate mutable reference is materialized just to
    // decay to the raw pointer `main`'s `*mut Runtime` parameter expects — same convention
    // `redextape_native_rt::rt_run` uses for the identical Cranelift-side call.
    let result = unsafe { main.call(&raw mut runtime) };

    if runtime.hit_cap {
        NativeRun::HitCap
    } else {
        match runtime.fault.take() {
            Some(msg) => NativeRun::Fault(msg),
            None => NativeRun::Ran(runtime.into_outcome(result)),
        }
    }
}

/// Emit `prog` as a native object file at `opt`, for MEASUREMENT ONLY. This is deliberately NOT an
/// AOT path: there is no linking step, no `rt_run` driver, and no CONFIG blob (contrast
/// `aot::emit_object`, which builds one). The `rt_*` imports are left as unresolved external
/// declarations in the returned bytes — an object file can name symbols it does not define; only a
/// linker would need to resolve them, and this function never invokes one. It exists purely so the
/// LLVM backend can be sized in the SAME UNIT as Cranelift's `aot::emit_object` — object bytes —
/// since LLVM's only other size proxy (`instruction_count`, used by the differential tests above) is
/// an IR metric, not comparable across backends. Even so, an LLVM object's byte count is only
/// meaningful compared against ANOTHER LLVM object at a different `opt`: object-format and
/// symbol-table overhead differ from Cranelift's, so a cross-backend byte comparison is not.
///
/// Composes exactly what `build_and_run` does up to (not including) the JIT step:
/// `host_target_machine` picks the codegen level, `build_module` builds, decorates
/// (`apply_size_attributes`) and verifies the IR, `optimize` runs the `-O1`..`-Oz` pass pipeline
/// over the SAME module, and `write_to_memory_buffer` asks the SAME `TargetMachine` to emit the
/// post-pass module as a real object rather than JIT-compiling it. That is also why no
/// `FunctionValue` handle is at risk here: `build_module` returns only the entry's NAME (a `String`),
/// nothing below reads a handle obtained before `optimize`, and the `default<O_>` pipeline deleting
/// dead functions (the hazard `apply_size_attributes` documents) has nothing to dangle.
///
/// `caps` is accepted only for signature parity with `compile_and_run`/`aot::emit_object` (and so a
/// future AOT-via-LLVM CONFIG blob could reuse this function's shape without a signature change) —
/// it has NO effect on the emitted object. Every cap, including the frame-size-aware `depth_cap`
/// derived from it, is threaded through the `Runtime` the compiled code is CALLED with
/// (`Runtime::with_depth_cap`, above) rather than baked into the IR; this function never constructs
/// a `Runtime` at all, so there is nothing here for `caps` to reach.
///
/// # Errors
/// Returns `Err(String)` — a human-readable message, not a typed variant, matching this function's
/// measurement-only status (contrast `aot::emit_object`'s `AotError`) — when: `prog` has a register
/// index at or past `MAX_REGISTERS`; `partition` cannot make `prog`'s subroutines disjoint;
/// `host_target_machine` cannot describe the host ISA; `build_module` fails to declare, translate,
/// or verify the IR; `optimize` fails to run the pass pipeline; or the `TargetMachine` fails to emit
/// the post-pass module as an object. None of these are transient — a caller cannot usefully retry
/// with the same `prog`/`opt`.
pub fn object_bytes(prog: &Program, _caps: Caps, opt: OptLevel) -> Result<Vec<u8>, String> {
    if reg_over_cap(prog) {
        return Err(format!("register index exceeds MAX_REGISTERS ({MAX_REGISTERS})"));
    }
    let subs = partition(prog).map_err(|e| format!("{e:?}"))?;
    let machine = host_target_machine(opt)?;
    let ctx = Context::create();
    let (module, _entry_name) = build_module(&ctx, &machine, prog, &subs, opt)?;
    optimize(&module, &machine, opt)?;
    machine.write_to_memory_buffer(&module, FileType::Object).map(|buf| buf.as_slice().to_vec()).map_err(ir_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use redextape_core::tm::{AsmRun, DEFAULT_CAPS, decode_asm, lower_asm, run_asm};
    use redextape_core::{desugar::desugar, parser::parse, run, value::Value};

    /// Every level `OptLevel` offers, the size-oriented ones included. The agreement contract is
    /// "same outcome as `run_asm` and as Cranelift on every `Program`, at EVERY opt level", so every
    /// test that pins an outcome — a value, a fault, a cap trip — sweeps this rather than checking
    /// `O0` and hoping.
    const OPT_LEVELS: [OptLevel; 6] =
        [OptLevel::O0, OptLevel::O1, OptLevel::O2, OptLevel::O3, OptLevel::Os, OptLevel::Oz];

    fn llvm_value(src: &str) -> Value {
        let core = desugar(&parse(src).0.unwrap());
        // Reuse the crate's own lowering template (direct first, `defunc` only for a higher-order
        // `Unsupported`) rather than re-deriving it, so a higher-order source like `map` reaches the
        // backend exactly as `run_native_with` would deliver it.
        let prog = crate::lower_program(&core).unwrap();
        let expected = run(src).unwrap();
        match compile_and_run(&prog, DEFAULT_CAPS, OptLevel::O0) {
            NativeRun::Ran(o) => decode_asm(&o, &expected).expect("decode"),
            other => panic!("llvm did not run {src}: {other:?}"),
        }
    }

    /// The LLVM backend must agree with the asm interpreter on a hand-built `Program`: same `Ran`
    /// outcome, or both `Fault`, or both `HitCap`. Mirrors `jit::tests::agree_caps`.
    fn agree_caps(prog: Program, caps: Caps, opt: OptLevel) {
        let native = compile_and_run(&prog, caps, opt);
        match (run_asm(&prog, caps), native) {
            (AsmRun::Ran(a), NativeRun::Ran(n)) => assert_eq!(a, n, "outcome mismatch"),
            (AsmRun::Fault(_), NativeRun::Fault(_)) => {}
            (AsmRun::HitCap, NativeRun::HitCap) => {}
            (a, n) => panic!("llvm vs asm-interp mismatch:\n asm={a:?}\n llvm={n:?}"),
        }
    }

    fn agree(prog: Program) {
        agree_caps(prog, DEFAULT_CAPS, OptLevel::O0);
    }

    /// `agree_caps` at every opt level — the form every totality/guard test uses, because the
    /// optimizer is exactly what could disturb the `rt_*` guard calls and their `br exit` edges.
    fn agree_at_every_opt_level(prog: &Program, caps: Caps) {
        for opt in OPT_LEVELS {
            agree_caps(prog.clone(), caps, opt);
        }
    }

    #[test]
    fn arithmetic_and_control_flow() {
        assert_eq!(llvm_value("1 + 2 * 3"), Value::Nat(7));
        assert_eq!(llvm_value("3 - 5"), Value::Nat(0)); // monus saturates
        assert_eq!(llvm_value("if 2 > 1 { 10 } else { 20 }"), Value::Nat(10));
        assert_eq!(llvm_value("fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(5)"), Value::Nat(15));
        assert_eq!(llvm_value("100 * 100"), Value::Nat(10_000)); // beyond FIELD_WIDTH
    }

    #[test]
    fn heap_and_higher_order() {
        assert_eq!(llvm_value("head(tail([1, 2, 3]))"), Value::Nat(2));
        assert_eq!(llvm_value("[1,2,3]"), Value::list_of_nats(&[1, 2, 3]));
        // Higher-order: `lower_asm` rejects `map` as `Unsupported`, so this only reaches the backend
        // via `defunc` — which lowers the closure to `Cons`/`Head`/`Tail` heap ops plus a dispatcher.
        assert_eq!(
            llvm_value(
                "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} \
                 head([5,6].map(add1))"
            ),
            Value::Nat(6)
        );
    }

    #[test]
    fn nil_access_faults_at_every_opt_level() {
        // `head(nil)` is first-order, so it lowers directly (no `defunc`); the fault is latched by
        // `rt_head` and must reach the driver as `Fault`, not a silently-successful run. At `O1+`
        // this is also the check that the optimizer did not treat the `rt_head` call as removable
        // (it returns a value nothing but the guard consumes) or fold away its `rt_faulted` guard.
        let core = desugar(&parse("head(nil)").0.unwrap());
        let prog = lower_asm(&core).unwrap();
        for opt in OPT_LEVELS {
            let run = compile_and_run(&prog, DEFAULT_CAPS, opt);
            assert!(matches!(run, NativeRun::Fault(_)), "head(nil) at {opt:?} must Fault, got {run:?}");
        }
    }

    #[test]
    fn a_spin_hits_the_cap_at_every_opt_level() {
        // A spin trips the depth cap → HitCap (totality), no heap needed. Sweeping opt levels
        // matters here: `spin(n) = spin(n)` is a self tail-call, and turning it into a loop (or
        // deleting it as a side-effect-free infinite recursion) would change the outcome — the
        // `rt_enter` guard is what makes both illegal.
        let core = desugar(&parse("fn spin(n){ spin(n) } spin(0)").0.unwrap());
        let prog = lower_asm(&core).unwrap();
        for opt in OPT_LEVELS {
            let run = compile_and_run(&prog, DEFAULT_CAPS, opt);
            assert!(matches!(run, NativeRun::HitCap), "spin at {opt:?} must HitCap, got {run:?}");
        }
    }

    /// `rr = x op y` for two immediate operands — the shape every arithmetic/comparison boundary
    /// case below is pinned with.
    fn bin_prog(op: BinOp, x: u64, y: u64) -> Program {
        Program {
            code: vec![
                Instr::Li(Reg::Loc(0), x),
                Instr::Li(Reg::Loc(1), y),
                Instr::Bin(op, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        }
    }

    #[test]
    fn add_and_mul_saturate_rather_than_wrap() {
        // The known trap: saturating intrinsics, NOT plain `add`/`mul`. `u64::MAX + u64::MAX` must be
        // `u64::MAX` (wrapping gives `u64::MAX - 1`) and `u64::MAX * u64::MAX` must be `u64::MAX`
        // (wrapping gives 1). `agree_at_every_opt_level` compares against `run_asm`'s saturating
        // semantics.
        //
        // Swept over EVERY opt level, not just `O0`: the saturating intrinsics are precisely what
        // the pipeline rewrites most (`default<O3>` is observed turning `llvm.usub.sat` back into a
        // plain wrapping `add` wherever a dominating compare proves the operand in range), so
        // `O0`-only coverage would leave the interesting half of the claim unchecked — on the one
        // arm the Cranelift backend already shipped a wrap-instead-of-saturate bug on.
        const TWO40: u64 = 1 << 40;
        let cases = [
            (BinOp::Add, u64::MAX, u64::MAX), // wrapping would give u64::MAX - 1
            (BinOp::Add, u64::MAX, 1),        // wrapping would give 0
            (BinOp::Mul, u64::MAX, u64::MAX), // wrapping would give 1
            (BinOp::Mul, TWO40, TWO40),       // overflows with NEITHER operand at the boundary
            (BinOp::Sub, 0, u64::MAX),        // monus clamps at 0; wrapping would give 1
            (BinOp::Sub, u64::MAX, 1),        // and the non-clamping direction still computes
        ];
        for (op, x, y) in cases {
            agree_at_every_opt_level(&bin_prog(op, x, y), DEFAULT_CAPS);
        }
        // And directly, so a broken `agree_at_every_opt_level` can't hide it.
        for opt in OPT_LEVELS {
            for (op, x, y, want) in [
                (BinOp::Mul, u64::MAX, u64::MAX, u64::MAX),
                (BinOp::Add, u64::MAX, u64::MAX, u64::MAX),
                (BinOp::Sub, 0, u64::MAX, 0),
            ] {
                match compile_and_run(&bin_prog(op, x, y), DEFAULT_CAPS, opt) {
                    NativeRun::Ran(o) => assert_eq!(o.result, want, "{op:?} {x} {y} at {opt:?} must saturate"),
                    other => panic!("expected a value for {op:?} {x} {y} at {opt:?}, got {other:?}"),
                }
            }
        }
    }

    #[test]
    fn every_comparison_is_unsigned_and_agrees() {
        // 7 vs 4, and three pairings at the `u64::MAX` boundary — any of the latter would flip
        // Lt/Le/Gt/Ge if the compare were SIGNED (`u64::MAX` is `-1` as an i64). Swept over every
        // opt level for the same reason the saturating arms are: `instcombine` rewrites comparisons
        // aggressively (canonicalising predicates, folding them into selects), and a signedness slip
        // introduced by a pass would be invisible at `O0`.
        for (x, y) in [(7u64, 4u64), (u64::MAX, 1u64), (0u64, u64::MAX), (u64::MAX, u64::MAX)] {
            for op in [BinOp::Eq, BinOp::Ne, BinOp::Lt, BinOp::Le, BinOp::Gt, BinOp::Ge] {
                agree_at_every_opt_level(&bin_prog(op, x, y), DEFAULT_CAPS);
            }
        }
    }

    #[test]
    fn a_counting_loop_terminates_and_agrees() {
        // r0 = 5; while r0 != 0 { r0 -= 1; rr += 10 } -> 50. Exercises both backward edges (Jz + Jmp).
        agree(Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 5),
                Instr::Li(Reg::Rr, 0),
                Instr::Jz(Reg::Loc(0), "done".to_string()), // 2  loop:
                Instr::Li(Reg::Loc(1), 1),
                Instr::Bin(BinOp::Sub, Reg::Loc(0), Reg::Loc(0), Reg::Loc(1)),
                Instr::Li(Reg::Loc(2), 10),
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Rr, Reg::Loc(2)),
                Instr::Jmp("loop".to_string()), // 7 (backward)
                Instr::Halt,                    // 8  done:
            ],
            labels: vec![("loop".to_string(), 2), ("done".to_string(), 8)],
        });
    }

    #[test]
    fn an_infinite_loop_hits_the_step_cap_at_every_opt_level() {
        // The bare `loop: jmp loop`. LLVM is allowed to delete a provably-infinite loop only when it
        // is side-effect-free and the function is `mustprogress`; the `rt_tick` call on the backward
        // edge is neither optional nor removable, so every level must still trip the step cap.
        let prog = Program { code: vec![Instr::Jmp("loop".into())], labels: vec![("loop".into(), 0)] };
        let caps = Caps { steps: 1000, ..DEFAULT_CAPS };
        for opt in OPT_LEVELS {
            let run = compile_and_run(&prog, caps, opt);
            assert!(matches!(run, NativeRun::HitCap), "infinite loop at {opt:?} must HitCap, got {run:?}");
        }
    }

    #[test]
    fn main_reading_an_arg_sees_zero() {
        // The entry `$main` takes no args (the driver calls it as `(rt_ptr) -> i64`); a `$main` that
        // reads `Arg(0)` must see the init-0 value, matching `run_asm`.
        agree(Program {
            code: vec![Instr::Bin(BinOp::Add, Reg::Rr, Reg::Arg(0), Reg::Arg(0)), Instr::Halt],
            labels: vec![],
        });
    }

    #[test]
    fn recursion_keeps_loc_and_makes_arg_volatile() {
        // sum(n) = if n==0 {0} else { n + sum(n-1) }; sum(5) == 15. `Loc(0)` must survive the
        // recursive call (the callee has its own bank) while `Arg(0)` is set up for the callee.
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
    fn deep_recursion_hits_the_cap_instead_of_overflowing_the_stack() {
        // `$main: call $main; halt` — self-recursion that never returns. Must trip the stack-depth
        // cap (via `rt_enter`, before each native call) and NOT abort the process, at every opt
        // level (higher levels are free to inline or tail-call the self-recursion, which changes the
        // frame layout the cap is calibrated against).
        let prog = Program { code: vec![Instr::Call("f".into()), Instr::Halt], labels: vec![("f".into(), 0)] };
        let caps = Caps { stack: 5000, ..DEFAULT_CAPS };
        for opt in OPT_LEVELS {
            let run = compile_and_run(&prog, caps, opt);
            assert!(matches!(run, NativeRun::HitCap), "runaway recursion at {opt:?} must HitCap, got {run:?}");
        }
        assert!(matches!(run_asm(&prog, caps), AsmRun::HitCap));
    }

    /// A recursive `countdown(n)` whose subroutine writes `fillers` extra `Loc` registers and reads
    /// every one of them AFTER its self-call, keeping them live across the call so the native frame
    /// is genuinely FAT. Deliberately DIFFERS in shape from `jit::tests::fat_recursive_countdown` now:
    /// that fixture uses mutually INDEPENDENT fillers (`Loc(i) = Arg(0) + (i+1)`, each derived from
    /// `Arg(0)` alone), because that is what makes optimized Cranelift frames grow (live-range
    /// splitting spills every independently-live value, ~2.85x at 200 fillers). This fixture instead
    /// keeps the DEPENDENT saturating chain below (`Loc(i) = Arg(0) + Loc(i-1)`), which barely grows
    /// under optimization (~1.01x) and so would not exercise Cranelift's growth — but that is fine
    /// here because LLVM's binding case is `O0`, not its optimized levels: every register slot is
    /// still its own entry-block `alloca` at `O0` regardless of chain shape, while `O1+`'s
    /// `mem2reg`/SROA promote them into SSA and shrink the frame instead. That is the CURRENT
    /// rationale, not an established measurement: a follow-up is filed to actually measure this
    /// fixture's frame at `O0` vs `O3` and confirm or retract it.
    ///
    /// Each filler is DERIVED from `Arg(0)` rather than being a constant: `Loc(0) = Arg(0) +
    /// Arg(0)`, then `Loc(i) = Arg(0) + Loc(i-1)` — a chain of *saturating* adds (`llvm.uadd.sat`,
    /// which is not associative, so no pass may reassociate the chain into one multiply) whose
    /// elements are all distinct runtime values. A bank of constants would const-fold away at `O1+`,
    /// leaving a 32-byte frame and making every non-`O0` leg of the totality test below vacuous: the
    /// `BYTES_PER_VAR` frame ESTIMATE would then be exercised at `O0` only, which is not what that
    /// test claims.
    ///
    /// The chain is seeded from `Arg(0)` (not from `Loc(0)`'s own init-`0` value) so that no
    /// instruction here READS a `Loc` this body has not already written: `run_asm`'s `Call` clones
    /// the caller's locals into the saved frame and leaves `vm.locals` in place, so a callee
    /// INHERITS the caller's `Loc` values, whereas both native backends give the callee a zeroed
    /// bank. The same divergence class applies to `Rr`, not just `Loc`: `$main: li rr, 1; call g;
    /// halt` with `g: ret` (a callee that `Ret`s without ever writing `Rr`) yields `run_asm` → `1`
    /// (the interpreter's `Rr` is one global VM register) vs. both native backends → `0` (each
    /// compiled function owns its own `Rr` slot, zero-initialised).
    ///
    /// This is not merely an internal quirk: `redextape_native::llvm::compile_and_run` and
    /// `jit::compile_and_run` are both `pub` and take a `Program`, so a hand-built `Program` reaching
    /// this divergence is public-API-reachable. What actually keeps every oracle leg from tripping
    /// over it is narrower and was verified by a definite-assignment dataflow analysis over 30 real
    /// programs (recursion, mutual list recursion, `while` loops, heap `cons`/`head`/`tail`,
    /// higher-order `map`/`fold`, currying, immutable capture, mutable capture via boxing): no
    /// `Program` produced by `lower_asm`/`defunc` ever reads a `Loc` or `Rr` before writing it on
    /// every path, so the two backends' initial values never actually differ for real output.
    /// (`Arg` is structurally immune for a different reason: `analysis::partition` sets `arity =
    /// max_arg_read + 1`, so every `Arg` a body reads is a parameter by construction.) A hand-built
    /// body that read an unwritten `Loc`/`Rr` would be outside that contract, and this helper is a
    /// test fixture, not the place to litigate it.
    fn fat_recursive_countdown(fillers: u32, depth: u64) -> Program {
        let (zero, eqbit, one) = (fillers, fillers + 1, fillers + 2);
        let mut code = vec![
            Instr::Li(Reg::Arg(0), depth),   // 0  $main
            Instr::Call("countdown".into()), // 1
            Instr::Halt,                     // 2
        ];
        for i in 0..fillers {
            // countdown: entry at index 3. The chain runs `2n, 3n, 4n, ...` — every element a
            // distinct runtime value, none of them a constant, and every operand already written.
            let prev = if i == 0 { Reg::Arg(0) } else { Reg::Loc(i - 1) };
            code.push(Instr::Bin(BinOp::Add, Reg::Loc(i), Reg::Arg(0), prev));
        }
        code.push(Instr::Li(Reg::Loc(zero), 0));
        code.push(Instr::Bin(BinOp::Eq, Reg::Loc(eqbit), Reg::Arg(0), Reg::Loc(zero)));
        code.push(Instr::Jz(Reg::Loc(eqbit), "rec".into()));
        code.push(Instr::Li(Reg::Rr, 0));
        code.push(Instr::Ret);
        let rec_idx = code.len();
        code.push(Instr::Li(Reg::Loc(one), 1));
        code.push(Instr::Bin(BinOp::Sub, Reg::Arg(0), Reg::Arg(0), Reg::Loc(one)));
        code.push(Instr::Call("countdown".into()));
        for i in 0..fillers {
            code.push(Instr::Bin(BinOp::Add, Reg::Rr, Reg::Rr, Reg::Loc(i))); // keep fillers live
        }
        code.push(Instr::Ret);
        Program { code, labels: vec![("countdown".into(), 3), ("rec".into(), rec_idx)] }
    }

    #[test]
    fn a_fat_frame_deep_recursion_returns_hitcap_not_a_process_abort() {
        // Totality, the cardinal rule: a fat-frame subroutine recursing far deeper than that frame
        // size lets the reserved 512 MiB run stack hold must `HitCap`, never overflow the OS stack
        // (an uncatchable abort). That this test COMPLETES in-suite is the proof.
        //
        // Swept over every opt level on purpose: `shared::native_depth_cap`'s `BYTES_PER_VAR` was
        // calibrated against CRANELIFT frames, and LLVM's differ per level (`O0` spills every
        // register bank slot; `O1+` promotes them to SSA and may inline). A failure here would be a
        // real totality bug in the constant, not a test to loosen. The `O1+` legs only MEAN anything
        // because `fat_recursive_countdown`'s fillers are derived from `Arg(0)` (see its doc) — a
        // bank of constants would fold away and leave those legs testing a thin frame.
        let prog = fat_recursive_countdown(200, 100_000);
        for opt in OPT_LEVELS {
            let run = compile_and_run(&prog, DEFAULT_CAPS, opt);
            assert!(matches!(run, NativeRun::HitCap), "fat-frame deep recursion at {opt:?} must HitCap, got {run:?}");
        }
    }

    #[test]
    fn a_shallow_but_fat_frame_still_runs_to_a_value() {
        // The converse: the frame-size-aware cap must not spuriously `HitCap` a shallow fat-frame
        // program. 150 locals, recursion depth 2 → a real value, agreeing with `run_asm`.
        agree_at_every_opt_level(&fat_recursive_countdown(150, 2), DEFAULT_CAPS);
    }

    #[test]
    fn a_huge_register_index_is_rejected_not_a_process_abort() {
        let prog = Program { code: vec![Instr::Li(Reg::Loc(4_000_000_000), 0), Instr::Halt], labels: vec![] };
        assert!(matches!(compile_and_run(&prog, DEFAULT_CAPS, OptLevel::O0), NativeRun::LowerError(_)));
    }

    #[test]
    fn an_undefined_call_target_is_a_lower_error() {
        let prog = Program { code: vec![Instr::Call("missing".into()), Instr::Halt], labels: vec![] };
        assert!(matches!(compile_and_run(&prog, DEFAULT_CAPS, OptLevel::O0), NativeRun::LowerError(_)));
    }

    #[test]
    fn builds_and_reads_a_list() {
        // rr = head(tail(cons(1, cons(2, nil)))) == 2. Also the first test that actually EXECUTES
        // `Nil` (rather than pairing it with an unimplemented op).
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
        // rr = cons(1, cons(2, nil)) — a heap-valued result, so `agree` compares the whole arena
        // (pointer numbering included), not just the result word.
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
        agree(Program {
            code: vec![
                Instr::Nil(Reg::Loc(0)),
                Instr::Cons(Reg::Loc(1), Reg::Loc(0), Reg::Loc(0)),
                Instr::IsEmpty(Reg::Rr, Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        });
    }

    #[test]
    fn boxes_round_trip_and_stay_independent_at_every_opt_level() {
        // b0 = box(3); b1 = box(4); box_set(b0, 5); rr = box_get(b0) + box_get(b1) == 5 + 4 == 9.
        // `rr` depends on BOTH halves: on the `box_set` having landed (5, not 3) and on `b1` being
        // untouched by it (4). And `rt_box_set` is a VOID call whose result is unused, so running at
        // every opt level is where an optimizer that wrongly took the `rt_*` imports for
        // side-effect-free would surface as a wrong answer rather than as dead code nobody notices.
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 3),
                Instr::Box(Reg::Loc(1), Reg::Loc(0)),
                Instr::Li(Reg::Loc(2), 4),
                Instr::Box(Reg::Loc(3), Reg::Loc(2)),
                Instr::Li(Reg::Loc(4), 5),
                Instr::BoxSet(Reg::Loc(1), Reg::Loc(4)),
                Instr::BoxGet(Reg::Loc(5), Reg::Loc(1)),
                Instr::BoxGet(Reg::Loc(6), Reg::Loc(3)),
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(5), Reg::Loc(6)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        for opt in OPT_LEVELS {
            agree_caps(prog.clone(), DEFAULT_CAPS, opt);
            match compile_and_run(&prog, DEFAULT_CAPS, opt) {
                NativeRun::Ran(o) => assert_eq!(o.result, 9, "box round-trip at {opt:?}"),
                other => panic!("box round-trip at {opt:?} must Ran(9), got {other:?}"),
            }
        }
    }

    #[test]
    fn every_heap_fault_agrees_with_the_interpreter() {
        // Each of these latches a fault in the runtime; the `rt_faulted` guard after the op must
        // divert to the exit block so the driver reports `Fault` — the classification `agree` checks.
        // head/tail of nil, head/tail of a dangling pointer, box_get of null AND of a dangling
        // handle, box_set of null AND of a dangling handle: all EIGHT faulting `rt_*` conditions the
        // walk emits a guard for — at every opt level, since a `Fault` here is only visible if the
        // optimizer kept both the faulting call and its guard.
        for op in [Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Tail(Reg::Rr, Reg::Loc(0))] {
            agree_at_every_opt_level(
                &Program { code: vec![Instr::Nil(Reg::Loc(0)), op.clone(), Instr::Halt], labels: vec![] },
                DEFAULT_CAPS,
            );
            agree_at_every_opt_level(
                &Program { code: vec![Instr::Li(Reg::Loc(0), 5), op, Instr::Halt], labels: vec![] },
                DEFAULT_CAPS,
            );
        }
        // `box_get`: handle `0` is NULL, handle `5` against an empty box arena is DANGLING — two
        // distinct conditions inside `rt_box_get`, each with its own message.
        for handle in [0u64, 5] {
            agree_at_every_opt_level(
                &Program {
                    code: vec![Instr::Li(Reg::Loc(0), handle), Instr::BoxGet(Reg::Rr, Reg::Loc(0)), Instr::Halt],
                    labels: vec![],
                },
                DEFAULT_CAPS,
            );
        }
        // `box_set`: the same two conditions inside `rt_box_set`, which returns VOID — so here the
        // `rt_faulted` guard is the ONLY thing that can turn the fault into a `Fault` outcome (there
        // is no result register whose value could betray it).
        for handle in [0u64, 5] {
            agree_at_every_opt_level(
                &Program {
                    code: vec![
                        Instr::Li(Reg::Loc(0), handle),
                        Instr::Li(Reg::Loc(1), 1),
                        Instr::BoxSet(Reg::Loc(0), Reg::Loc(1)),
                        Instr::Halt,
                    ],
                    labels: vec![],
                },
                DEFAULT_CAPS,
            );
        }
    }

    /// The name-uniquification premise the `rt_*` re-fetch in `map_rt_symbols` rests on, pinned:
    /// `declare_rt` runs BEFORE `declare_subroutines`, so a user subroutine whose label collides
    /// with an import gets uniquified (`rt_cons` → `rt_cons.1`) and the import keeps the bare name.
    /// Without that ordering the by-name lookup would bind a HOST function's address onto a user
    /// subroutine — a silent miscompile, and precisely the UB the re-fetch was introduced to avoid.
    /// The premise lived only in a doc comment, so a future reordering could break it silently.
    #[test]
    fn a_subroutine_named_like_an_import_does_not_hijack_it() {
        // `$main: arg0 = 6; call <name>; halt` / `<name>: rr = arg0 + arg0; ret` — 12, only if the
        // call really reached the user subroutine and not some host `rt_*` (or libc) address.
        for name in
            ["rt_cons", "rt_enter", "rt_faulted", "rt_leave", "$main", "main", "memcpy", "memset", "malloc", "free"]
        {
            let prog = Program {
                code: vec![
                    Instr::Li(Reg::Arg(0), 6),
                    Instr::Call(name.to_string()),
                    Instr::Halt,
                    Instr::Bin(BinOp::Add, Reg::Rr, Reg::Arg(0), Reg::Arg(0)),
                    Instr::Ret,
                ],
                labels: vec![(name.to_string(), 3)],
            };
            for opt in OPT_LEVELS {
                agree_caps(prog.clone(), DEFAULT_CAPS, opt);
                match compile_and_run(&prog, DEFAULT_CAPS, opt) {
                    NativeRun::Ran(o) => assert_eq!(o.result, 12, "subroutine `{name}` at {opt:?}"),
                    other => panic!("subroutine `{name}` at {opt:?} must Ran(12), got {other:?}"),
                }
            }
        }
    }

    /// The structural half of the same premise, checked directly on the module rather than through
    /// behaviour: with a subroutine named `rt_cons`, the bare `rt_cons` symbol must still be the
    /// IMPORT (a declaration with no body), and the subroutine must have been renamed.
    #[test]
    fn an_import_keeps_its_bare_name_when_a_subroutine_collides() {
        let ctx = Context::create();
        let module = ctx.create_module("collide");
        let rt = declare_rt(&ctx, &module);
        let subs = [Subroutine {
            name: "rt_cons".to_string(),
            entry: 3,
            body: vec![3],
            arity: 1,
            n_locals: 0,
            internal_labels: vec![],
        }];
        let (funcs, _arity) = declare_subroutines(&ctx, &module, &subs);
        let sub_fn = funcs[&3];
        assert_ne!(sub_fn, rt.cons, "the subroutine must not BE the import");
        assert_ne!(sub_fn.get_name().to_string_lossy(), "rt_cons", "the subroutine must have been uniquified");
        assert_eq!(
            module.get_function("rt_cons"),
            Some(rt.cons),
            "the bare name must still resolve to the import `map_rt_symbols` binds by address"
        );
    }

    #[test]
    fn the_heap_cap_stops_unbounded_allocation() {
        // With `heap: 1` the second allocation trips the cap in `rt_cons`/`rt_box` (setting
        // `hit_cap`, not `fault`), and the same `rt_faulted` guard diverts — both must `HitCap`,
        // at every opt level.
        agree_at_every_opt_level(
            &Program {
                code: vec![
                    Instr::Nil(Reg::Loc(0)),
                    Instr::Cons(Reg::Loc(1), Reg::Loc(0), Reg::Loc(0)),
                    Instr::Cons(Reg::Rr, Reg::Loc(1), Reg::Loc(1)),
                    Instr::Halt,
                ],
                labels: vec![],
            },
            Caps { heap: 1, ..DEFAULT_CAPS },
        );
        agree_at_every_opt_level(
            &Program {
                code: vec![
                    Instr::Li(Reg::Loc(0), 7),
                    Instr::Box(Reg::Loc(1), Reg::Loc(0)),
                    Instr::Box(Reg::Rr, Reg::Loc(0)),
                    Instr::Halt,
                ],
                labels: vec![],
            },
            Caps { heap: 1, ..DEFAULT_CAPS },
        );
    }

    #[test]
    fn every_opt_level_agrees_with_the_interpreter() {
        // `opt` drives both LLVM knobs (IR pass pipeline + codegen level). This is the register-asm
        // -level smoke check that raising the level does not change outcomes; `o0_equals_o3` is the
        // same claim over real source programs.
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Arg(0), 10),
                Instr::Call("sum".to_string()),
                Instr::Halt,
                Instr::Mov(Reg::Loc(0), Reg::Arg(0)),
                Instr::Li(Reg::Loc(1), 0),
                Instr::Bin(BinOp::Eq, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
                Instr::Jz(Reg::Loc(2), "rec".to_string()),
                Instr::Li(Reg::Rr, 0),
                Instr::Ret,
                Instr::Li(Reg::Loc(3), 1),
                Instr::Bin(BinOp::Sub, Reg::Arg(0), Reg::Loc(0), Reg::Loc(3)),
                Instr::Call("sum".to_string()),
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Rr),
                Instr::Ret,
            ],
            labels: vec![("sum".to_string(), 3), ("rec".to_string(), 9)],
        };
        for opt in OPT_LEVELS {
            agree_caps(prog.clone(), DEFAULT_CAPS, opt);
            match compile_and_run(&prog, DEFAULT_CAPS, opt) {
                NativeRun::Ran(o) => assert_eq!(o.result, 55, "sum(10) at {opt:?}"),
                other => panic!("sum(10) at {opt:?} must Ran(55), got {other:?}"),
            }
        }
    }

    /// THE HEADLINE of this slice: the optimizer must not change what a program MEANS.
    ///
    /// For each source program, compile it at every opt level and decode each result. All four must
    /// decode to the same `Value`, and that `Value` must be the reference interpreter's — so this is
    /// simultaneously an `O0 == O1 == O2 == O3` differential and a `native == reference` oracle leg.
    /// Because `default<O3>` really does rewrite this IR (see
    /// `the_o3_pipeline_actually_transforms_the_ir`), the agreement is evidence about the optimizer
    /// rather than a tautology.
    #[test]
    fn o0_equals_o3() {
        let progs = [
            "1 + 2 * 3",
            "if 2 > 1 { 10 } else { 20 }",
            "fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(20)",
            "head(tail([1, 2, 3]))",
            "100 * 100",
            "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} \
             head([5,6].map(add1))",
            // A heap-VALUED result, so the comparison covers the whole decoded list (pointer
            // numbering included), not just the result word.
            "[1, 2, 3]",
            // A loop, so the `rt_tick` backward-edge guard is exercised under the optimizer too.
            "fn count(n, acc){ if n == 0 { acc } else { count(n - 1, acc + n) } } count(50, 0)",
        ];
        for src in progs {
            let core = desugar(&parse(src).0.unwrap());
            let prog = crate::lower_program(&core).unwrap();
            let expected = run(src).unwrap();
            let mut decoded = Vec::new();
            for opt in OPT_LEVELS {
                match compile_and_run(&prog, DEFAULT_CAPS, opt) {
                    NativeRun::Ran(o) => decoded.push((opt, decode_asm(&o, &expected).expect("decode"))),
                    other => panic!("{src} at {opt:?}: {other:?}"),
                }
            }
            for (opt, value) in &decoded {
                assert_eq!(value, &expected, "{src} at {opt:?} disagrees with the reference");
            }
        }
    }

    /// Total instructions across every function in `module` — the coarse "did the optimizer do
    /// anything" metric used below.
    fn instruction_count(module: &Module<'_>) -> usize {
        let mut n = 0;
        for func in module.get_functions() {
            for bb in func.get_basic_blocks() {
                let mut instr = bb.get_first_instruction();
                while let Some(i) = instr {
                    n += 1;
                    instr = i.get_next_instruction();
                }
            }
        }
        n
    }

    /// Build the module for `src` exactly as the driver does, and return it with its target machine.
    fn built_module<'ctx>(ctx: &'ctx Context, src: &str, opt: OptLevel) -> (Module<'ctx>, TargetMachine) {
        let core = desugar(&parse(src).0.unwrap());
        let prog = crate::lower_program(&core).unwrap();
        let subs = partition(&prog).unwrap();
        let machine = host_target_machine(opt).expect("host target machine");
        let (module, _entry) = build_module(ctx, &machine, &prog, &subs, opt).expect("build module");
        (module, machine)
    }

    /// The evidence that `o0_equals_o3` is not passing because `O3` quietly does nothing — the exact
    /// failure mode a differential against a no-op optimizer has. Compares the IR either side of
    /// `run_passes`: the register banks (entry-block `alloca`s, the whole reason this backend's
    /// `Fun` is shaped the way it is) must be promoted away by `mem2reg`/SROA, the instruction count
    /// must drop, and the result must still verify.
    #[test]
    fn the_o3_pipeline_actually_transforms_the_ir() {
        let ctx = Context::create();
        let (module, machine) =
            built_module(&ctx, "fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(20)", OptLevel::O3);
        let before = instruction_count(&module);
        assert!(module.print_to_string().to_string().contains("alloca"), "the built IR keeps registers in allocas");

        optimize(&module, &machine, OptLevel::O3).expect("run_passes");

        let after_ir = module.print_to_string().to_string();
        let after = instruction_count(&module);
        assert!(after < before, "default<O3> must shrink the IR, but it went {before} -> {after}");
        assert!(!after_ir.contains("alloca"), "mem2reg/SROA must promote every register slot:\n{after_ir}");
        assert!(module.verify().is_ok(), "the optimized IR must still verify");
        // And the concrete reason `map_rt_symbols` re-fetches its handles by name: this program
        // calls neither `rt_cons` nor any other heap import, and the pipeline DELETES the unused
        // declarations. A `FunctionValue` captured before `run_passes` would be dangling here, so
        // mapping it on the execution engine would be undefined behaviour rather than a no-op.
        assert!(module.get_function("rt_cons").is_none(), "default<O3> drops unused rt_* declarations");
        assert!(module.get_function("rt_enter").is_some(), "the called imports must survive");
    }

    /// Every function in `module` that has a BODY (as opposed to a bare `declare`d import), by name.
    fn defined_functions(module: &Module<'_>) -> Vec<String> {
        module
            .get_functions()
            .filter(|f| f.count_basic_blocks() > 0)
            .map(|f| f.get_name().to_string_lossy().into_owned())
            .collect()
    }

    /// What `Linkage::Private` on non-entry subroutines actually buys, made observable: a subroutine
    /// the inliner folds into its only caller is then DELETED. Under external linkage `globaldce`
    /// must assume an unknown outside caller and keep the now-dead definition — so this is the test
    /// that would catch a regression back to external linkage for the whole subroutine set.
    #[test]
    fn a_fully_inlined_subroutine_is_deleted_at_o3() {
        let ctx = Context::create();
        let (module, machine) = built_module(&ctx, "fn twice(x){ x + x } twice(21)", OptLevel::O3);
        let before = defined_functions(&module);
        assert_eq!(before.len(), 2, "the built module defines `$main` and `twice`, got {before:?}");

        optimize(&module, &machine, OptLevel::O3).expect("run_passes");

        let after = defined_functions(&module);
        assert_eq!(after, vec!["$main".to_string()], "only the entry may survive full inlining, got {after:?}");
        // The entry itself keeps external linkage precisely so this cannot happen to IT — the driver
        // resolves it by name after the pipeline has run.
        let entry = module.get_function("$main").expect("the entry survives");
        assert_eq!(entry.get_linkage(), Linkage::External, "the entry must stay externally linked");
    }

    #[test]
    fn a_subroutine_call_still_agrees_at_every_opt_level() {
        // The companion to `a_fully_inlined_subroutine_is_deleted_at_o3`: deleting the inlined
        // callee must not change the ANSWER. `twice(21) == 42` at every level, decoded and compared
        // against the reference interpreter.
        let src = "fn twice(x){ x + x } twice(21)";
        let core = desugar(&parse(src).0.unwrap());
        let prog = crate::lower_program(&core).unwrap();
        let expected = run(src).unwrap();
        for opt in OPT_LEVELS {
            agree_caps(prog.clone(), DEFAULT_CAPS, opt);
            match compile_and_run(&prog, DEFAULT_CAPS, opt) {
                NativeRun::Ran(o) => assert_eq!(decode_asm(&o, &expected).expect("decode"), Value::Nat(42)),
                other => panic!("twice(21) at {opt:?} must Ran(42), got {other:?}"),
            }
        }
    }

    /// The fixture for the size-effect measurement below: a counted loop inside a subroutine reached
    /// from two call sites. LOOP UNROLLING is the lever that actually separates the levels for this
    /// backend — the speed pipelines peel the iterations out at both sites, `Os` backs off, and `Oz`
    /// backs off further still, so this fixture separates all THREE of `O3`/`Os`/`Oz` rather than
    /// merely putting the size levels somewhere below `O3`.
    ///
    /// Inlining, the other obvious lever, does NOT separate the levels for this backend: the emitted
    /// callees are either recursive (which the inliner declines everywhere) or single-call-site
    /// (which even `Oz` inlines, on the last-call-to-static bonus). Measured — a straight-line callee
    /// at two and at four call sites came out identical at all of `O2`/`O3`/`Os`/`Oz`.
    ///
    /// The loop cannot simply be folded away despite the program being closed: `rt_tick` is an opaque
    /// external call the lowering emits before every backward branch, so the iterations are
    /// observable and must survive.
    const SIZE_FIXTURE: &str =
        "fn f(n){ let mut acc = 0; while n > 0 { acc = acc + n; n = n - 1; } acc } fn g(a){ f(a) + f(a+1) } g(6)";

    /// Build `src` at `opt`, run `opt`'s pipeline over it, and report the surviving instruction
    /// count. The whole driver path up to (but not including) the JIT — so what is measured is what
    /// the execution engine would actually be handed.
    fn optimized_instruction_count(src: &str, opt: OptLevel) -> usize {
        let ctx = Context::create();
        let (module, machine) = built_module(&ctx, src, opt);
        optimize(&module, &machine, opt).expect("run_passes");
        assert!(module.verify().is_ok(), "the optimized IR must still verify at {opt:?}");
        instruction_count(&module)
    }

    /// The evidence that `Os`/`Oz` are REAL levels rather than aliases that pass the differential
    /// vacuously — the exact failure mode a newly added opt level has, and the reason a "does it
    /// compile" test would be worthless here. Four strict inequalities, each pinning a distinct way
    /// the levels could have collapsed into an existing one:
    ///
    /// - `Oz < O3` and `Os < O3`: the size pipelines really do produce a smaller module.
    /// - `Oz < O2`: `opt_level` maps `Os`/`Oz` onto the SAME codegen level as `O2`, so if the size
    ///   levels were just `O2` wearing a different name they would tie here.
    /// - `Oz < Os`: the two size levels are distinct from each other, not one knob spelled twice.
    ///   This is the one VERSION-FRAGILE assertion of the four: it rests on LLVM's loop unroller
    ///   treating `minsize` more aggressively than `optsize` — a cost-model threshold, not a
    ///   guarantee — with a measured margin of only 6 instructions (`Os` 38, `Oz` 32). If a future
    ///   LLVM upgrade closes that gap and turns this line red, relax `oz < os` alone to `<=`;
    ///   `the_size_levels_attach_their_attributes_to_defined_functions_only` independently pins `Os`
    ///   (`optsize`) and `Oz` (`minsize`+`optsize`) as structurally distinct, so `Oz < Os` is not the
    ///   only thing keeping the two levels apart. The other three inequalities are NOT soft in this
    ///   way — one of those breaking is a real regression, not a threshold shift.
    ///
    /// Measured on the pinned LLVM 22.1: `O2` 61, `O3` 61, `Os` 38, `Oz` 32. Suppressing only the
    /// `optsize`/`minsize` attributes (leaving `default<Os>`/`default<Oz>` in place) puts `Os` back
    /// at 61 and `Oz` at 63 — the pipeline string ALONE buys nothing here, and this test fails
    /// without `apply_size_attributes`. That is what makes the attribute half load-bearing rather
    /// than decorative, and the concrete reason those attributes must be attached before
    /// `run_passes` rather than merely before codegen.
    #[test]
    fn the_size_pipelines_produce_strictly_smaller_ir_than_the_speed_pipelines() {
        let o2 = optimized_instruction_count(SIZE_FIXTURE, OptLevel::O2);
        let o3 = optimized_instruction_count(SIZE_FIXTURE, OptLevel::O3);
        let os = optimized_instruction_count(SIZE_FIXTURE, OptLevel::Os);
        let oz = optimized_instruction_count(SIZE_FIXTURE, OptLevel::Oz);
        assert!(oz < o3, "default<Oz> must shrink the IR relative to default<O3>, got Oz={oz} vs O3={o3}");
        assert!(os < o3, "default<Os> must shrink the IR relative to default<O3>, got Os={os} vs O3={o3}");
        assert!(oz < o2, "the size preference must do more than default<O2>, got Oz={oz} vs O2={o2}");
        assert!(oz < os, "default<Oz> must be strictly smaller than default<Os>, got Oz={oz} vs Os={os}");
    }

    /// The other half of the size levels (the pipeline string is only one of the two knobs): the
    /// `optsize`/`minsize` function attributes must actually be ON the defined subroutines BEFORE the
    /// pipeline runs, since that is where the inliner/unroller/vectorizer read the size preference
    /// from. Matches what `clang -Os`/`-Oz` emit: `-Os` sets `optsize`, `-Oz` sets `minsize` AND
    /// `optsize`, `-O0`..`-O3` set neither. The `rt_*` imports must stay untouched — this module
    /// declares them but does not own their definitions.
    #[test]
    fn the_size_levels_attach_their_attributes_to_defined_functions_only() {
        for (opt, expected) in [
            (OptLevel::O0, &[][..]),
            (OptLevel::O1, &[][..]),
            (OptLevel::O2, &[][..]),
            (OptLevel::O3, &[][..]),
            (OptLevel::Os, &["optsize"][..]),
            (OptLevel::Oz, &["minsize", "optsize"][..]),
        ] {
            let ctx = Context::create();
            let (module, _machine) = built_module(&ctx, "fn twice(x){ x + x } twice(21)", opt);
            let defined: Vec<_> = module.get_functions().filter(|f| f.count_basic_blocks() > 0).collect();
            assert_eq!(defined.len(), 2, "the fixture defines `$main` and `twice` at {opt:?}");
            for name in ["optsize", "minsize"] {
                let kind = Attribute::get_named_enum_kind_id(name);
                assert_ne!(kind, 0, "LLVM must know the `{name}` attribute");
                let want = expected.contains(&name);
                for f in &defined {
                    let has = f.get_enum_attribute(AttributeLoc::Function, kind).is_some();
                    assert_eq!(has, want, "`{name}` on `{}` at {opt:?}", f.get_name().to_string_lossy());
                }
                // The imports are somebody else's functions; we may not decorate them.
                let import = module.get_function("rt_tick").expect("rt_tick is declared");
                assert!(
                    import.get_enum_attribute(AttributeLoc::Function, kind).is_none(),
                    "`{name}` must not be attached to the `rt_tick` import at {opt:?}"
                );
            }
        }
    }

    /// The converse: `O0` is the *unoptimized* leg the differential compares against, so it must
    /// leave the IR byte-for-byte alone (`pass_pipeline` returns `None` rather than running
    /// `default<O0>`, which is not a no-op).
    #[test]
    fn o0_leaves_the_ir_alone() {
        let ctx = Context::create();
        let (module, machine) =
            built_module(&ctx, "fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(20)", OptLevel::O0);
        let before = module.print_to_string().to_string();
        optimize(&module, &machine, OptLevel::O0).expect("no-op pipeline");
        assert_eq!(module.print_to_string().to_string(), before, "O0 must not touch the IR");
    }

    /// The `rt_symbols` table and `declare_rt` must name the same imports: a name in the table that
    /// `declare_rt` never adds would silently go unmapped, and the JIT would call address `0`.
    #[test]
    fn every_rt_import_is_mapped() {
        let ctx = Context::create();
        let module = ctx.create_module("rt-names");
        declare_rt(&ctx, &module);
        for (name, addr) in rt_symbols() {
            assert!(module.get_function(name).is_some(), "`{name}` is in rt_symbols but not declared");
            assert_ne!(addr, 0, "`{name}` has a null host address");
        }
        assert_eq!(module.get_functions().count(), rt_symbols().len(), "declare_rt added an unmapped import");
    }

    /// `object_bytes` must emit a real, host-recognisable object file, and `Oz` must actually shrink
    /// it relative to `O0` — the same shrink-under-size-pressure evidence
    /// `the_size_pipelines_produce_strictly_smaller_ir_than_the_speed_pipelines` gives the IR, but
    /// here on the artifact this function exists to measure.
    #[test]
    fn object_bytes_emits_a_real_object_that_shrinks_under_oz() {
        let core = desugar(&parse("fn twice(x){ x + x } twice(21)").0.unwrap());
        let prog = crate::lower_program(&core).unwrap();
        let o0 = object_bytes(&prog, DEFAULT_CAPS, OptLevel::O0).expect("O0 object");
        let oz = object_bytes(&prog, DEFAULT_CAPS, OptLevel::Oz).expect("Oz object");
        // Mach-O 64-bit magic (0xFEEDFACF, little-endian) or ELF magic, depending on host.
        assert!(o0.len() > 64, "object is implausibly small: {} bytes", o0.len());
        assert!(&o0[..4] == b"\xcf\xfa\xed\xfe" || &o0[..4] == b"\x7fELF", "not a recognizable object file");
        assert_ne!(o0, oz, "O0 and Oz produced byte-identical objects");
    }
}

#[cfg(test)]
mod smoke {
    use inkwell::OptimizationLevel;
    use inkwell::context::Context;

    #[test]
    fn inkwell_jits_and_runs_a_trivial_function() {
        let ctx = Context::create();
        let module = ctx.create_module("smoke");
        let builder = ctx.create_builder();
        let i64t = ctx.i64_type();
        let fnty = i64t.fn_type(&[i64t.into(), i64t.into()], false);
        let func = module.add_function("add", fnty, None);
        let entry = ctx.append_basic_block(func, "entry");
        builder.position_at_end(entry);
        let a = func.get_nth_param(0).unwrap().into_int_value();
        let b = func.get_nth_param(1).unwrap().into_int_value();
        let sum = builder.build_int_add(a, b, "sum").unwrap();
        builder.build_return(Some(&sum)).unwrap();

        let ee = module.create_jit_execution_engine(OptimizationLevel::None).unwrap();
        // SAFETY: signature matches the IR we just built.
        let add: inkwell::execution_engine::JitFunction<unsafe extern "C" fn(u64, u64) -> u64> =
            unsafe { ee.get_function("add") }.unwrap();
        assert_eq!(unsafe { add.call(2, 3) }, 5);
    }
}
