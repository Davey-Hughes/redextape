//! The Cranelift JIT driver: build a `JITModule`, drive the shared `codegen` against it, finalize,
//! and run `$main` on a big-stack thread.
//!
//! The contract is agreement with `redextape_core::tm::run_asm`: `compile_and_run(prog, caps, opt)`
//! must produce the same outcome (`Ran`/`HitCap`/`Fault`) as the asm interpreter on every `Program`,
//! at every `OptLevel` — optimization changes the code generated, never the answer. We reach it by
//! compiling **one Cranelift function per subroutine** (from `analysis::partition`) via
//! `codegen::translate_subroutine`, and threading a `*mut Runtime` (Task 2) through every function so
//! the `rt_*` host functions can perform the heap/box operations and cap checks with identical
//! semantics. This module owns only the JIT-specific concerns: registering the in-process `rt_*`
//! symbols, finalizing definitions, and transmuting + calling the finalized `$main`. The
//! `Module`-generic translation lives in `codegen` so an `ObjectModule` (AOT, Task 4) can reuse it.

use cranelift_codegen::ir::UserFuncName;
use cranelift_codegen::isa::OwnedTargetIsa;
use cranelift_codegen::settings::{self, Configurable};
use cranelift_frontend::FunctionBuilderContext;
use cranelift_jit::{JITBuilder, JITModule};
use cranelift_module::{Module, default_libcall_names};

use redextape_core::core::NodeId;
use redextape_core::tm::{Caps, LowerError, Program};

use crate::analysis::{Subroutine, partition};
use crate::codegen::{
    CodegenError, Decls, cranelift_opt_level, declare_rt, declare_subroutines, translate_subroutine, word_signature,
};
use crate::shared::{MAX_REGISTERS, native_depth_cap, param_count, reg_over_cap};
use crate::{NativeRun, OptLevel};
use redextape_native_rt::{
    RUN_STACK_SIZE, Runtime, rt_box, rt_box_get, rt_box_set, rt_cons, rt_enter, rt_faulted, rt_head, rt_is_empty,
    rt_leave, rt_tail, rt_tick,
};

/// Wrap any Cranelift/module error as a `LowerError` outcome. These paths are not expected to fire
/// for a partitioned `Program` (the label/CFG invariants are already checked by `partition`); this
/// keeps the backend total instead of unwrapping.
fn internal_error(msg: impl std::fmt::Display) -> NativeRun {
    NativeRun::LowerError(LowerError::Unsupported { node: NodeId::default(), what: format!("native codegen: {msg}") })
}

/// JIT-compile `prog` at `opt` and run it against a fresh `Runtime`, agreeing with `run_asm`.
///
/// `opt` reaches the host ISA as Cranelift's `opt_level` setting (see `codegen::cranelift_opt_level`
/// for the six-to-three collapse); it changes only how the machine code is generated, never the
/// outcome — the agreement contract holds at every level.
///
/// `partition` failures surface as `NativeRun::LowerError`. Everything else — compilation and the
/// run itself — happens on a dedicated big-stack thread (`RUN_STACK_SIZE`, a scoped thread so the
/// borrowed `prog`/`subs` need not be `'static`); its result is joined back and returned.
#[must_use]
pub fn compile_and_run(prog: &Program, caps: Caps, opt: OptLevel) -> NativeRun {
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
            .stack_size(RUN_STACK_SIZE)
            .spawn_scoped(scope, || build_and_run(prog, &subs, caps, opt))
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

/// Build the host ISA the JIT compiles against, with `opt` as its `opt_level` setting.
///
/// The ISA is built explicitly rather than via `JITBuilder::new`, which constructs its own from
/// default flags and offers no way to reach `opt_level` — which is why Cranelift ran unoptimized
/// until this was wired up. `JITBuilder::new` delegates to `with_flags(&[], ..)`, whose whole ISA
/// setup is (cranelift-jit 0.134.2, `src/backend.rs`):
///
/// ```text
///     let mut flag_builder = settings::builder();
///     for (name, value) in flags { flag_builder.set(name, value)?; }
///     // On at least AArch64, "colocated" calls use shorter-range relocations,
///     // which might not reach all definitions; we can't handle that here, so
///     // we require long-range relocation types.
///     flag_builder.set("use_colocated_libcalls", "false").unwrap();
///     flag_builder.set("is_pic", "false").unwrap();
///     let isa_builder = cranelift_native::builder().unwrap_or_else(..);
///     let isa = isa_builder.finish(settings::Flags::new(flag_builder))?;
///     Ok(Self::with_isa(isa, libcall_names))
/// ```
///
/// We reproduce exactly those two flags (dropping either would change JIT behaviour: `is_pic=false`
/// in particular is a hard requirement — `JITModule::new` asserts `!isa.flags().is_pic()`), add
/// `opt_level`, and hand the finished ISA to the same `with_isa` constructor. Building it ourselves
/// also removes `with_flags`'s two internal panics (`.unwrap()` on the flag set, `unwrap_or_else`
/// on an unsupported host): here both are `LowerError`s.
///
/// This is the JIT's ONLY ISA construction site, and it is a separate function so that
/// `tests::the_opt_level_reaches_the_jits_own_isa` can measure the code it actually emits (see
/// `build_module`'s returned byte count). The AOT driver builds its own ISA in `aot.rs`; a liveness
/// test over that one says nothing about this one.
fn host_isa(opt: OptLevel) -> Result<OwnedTargetIsa, NativeRun> {
    let mut flags = settings::builder();
    for (name, value) in
        [("use_colocated_libcalls", "false"), ("is_pic", "false"), ("opt_level", cranelift_opt_level(opt))]
    {
        flags.set(name, value).map_err(internal_error)?;
    }
    cranelift_native::builder().map_err(internal_error)?.finish(settings::Flags::new(flags)).map_err(internal_error)
}

/// Build the JIT module against `host_isa(opt)` and define every subroutine, returning the module,
/// its declarations, and the TOTAL machine-code bytes Cranelift emitted across those definitions.
///
/// The byte count exists for the liveness guard: it is measured off the compilation this function
/// just performed, through the JIT's own ISA, so if `opt` ever stops reaching `host_isa` — a
/// Cranelift version bump forcing a rewrite of the flag block, a "simplification" back to
/// `JITBuilder::new` — `O0` and `O3` start emitting the same number of bytes and
/// `tests::the_opt_level_reaches_the_jits_own_isa` fails. `build_and_run` discards it.
fn build_module(prog: &Program, subs: &[Subroutine], opt: OptLevel) -> Result<(JITModule, Decls, u64), NativeRun> {
    let mut jb = JITBuilder::with_isa(host_isa(opt)?, default_libcall_names());
    register_symbols(&mut jb);
    let mut module = JITModule::new(jb);

    // The shared, `Module`-generic codegen declares/translates against `&mut dyn Module`; a
    // `&mut JITModule` coerces automatically. A `CodegenError(m)` becomes this driver's `LowerError`.
    let rt = match declare_rt(&mut module) {
        Ok(rt) => rt,
        Err(CodegenError(m)) => return Err(internal_error(m)),
    };

    // Declare every subroutine up front so `Call` can reference callees defined later.
    let (func_ids, arity) = match declare_subroutines(&mut module, subs) {
        Ok(v) => v,
        Err(CodegenError(m)) => return Err(internal_error(m)),
    };
    let decls = Decls { rt, func_ids, arity };

    // Define each subroutine.
    let mut fbctx = FunctionBuilderContext::new();
    let mut code_bytes: u64 = 0;
    for sub in subs {
        let mut ctx = module.make_context();
        ctx.func.signature = word_signature(&module, param_count(sub));
        let fid = decls.func_ids[&sub.entry];
        ctx.func.name = UserFuncName::user(0, fid.as_u32());
        if let Err(CodegenError(m)) = translate_subroutine(&mut module, &mut ctx, &mut fbctx, prog, sub, &decls) {
            return Err(internal_error(m));
        }
        if let Err(e) = module.define_function(fid, &mut ctx) {
            return Err(internal_error(e));
        }
        // Cranelift leaves the emitted size on the context until `clear_context`, so read it here.
        // `None` cannot occur after a successful `define_function` (it is what populates
        // `compiled_code`); counting it as 0 rather than unwrapping keeps this path total.
        code_bytes =
            code_bytes.saturating_add(ctx.compiled_code().map_or(0, |cc| u64::from(cc.code_info().total_size)));
        module.clear_context(&mut ctx);
    }
    Ok((module, decls, code_bytes))
}

/// Build the module, define every subroutine, finalize, and run `$main`. Runs entirely on the
/// spawning (big-stack) thread so the non-`Send` `JITModule` never crosses a thread boundary and
/// stays alive for the duration of the call into JIT-compiled code.
fn build_and_run(prog: &Program, subs: &[Subroutine], caps: Caps, opt: OptLevel) -> NativeRun {
    let (mut module, decls, _code_bytes) = match build_module(prog, subs, opt) {
        Ok(built) => built,
        Err(run) => return run,
    };

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
    let result = main(&raw mut runtime);

    if runtime.hit_cap {
        NativeRun::HitCap
    } else {
        match runtime.fault.take() {
            Some(msg) => NativeRun::Fault(msg),
            None => NativeRun::Ran(runtime.into_outcome(result)),
        }
    }
}

#[cfg(all(test, feature = "cranelift"))]
mod tests {
    // Clippy's `allow-*-in-tests` keys (see `clippy.toml`) recognize a BARE `#[cfg(test)]` only, not
    // the feature-gated form this module needs, so the test exemption is restated here.
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use redextape_core::core::BinOp;
    use redextape_core::tm::{AsmRun, DEFAULT_CAPS, Instr, Program, Reg, run_asm};

    /// Every Cranelift opt level. The frame-size estimate behind `native_depth_cap` is calibrated
    /// against OPTIMIZED frames (Cranelift's binding case), so each level must still be checked
    /// independently — `speed` changes frame layout.
    const OPT_LEVELS: [OptLevel; 6] =
        [OptLevel::O0, OptLevel::O1, OptLevel::O2, OptLevel::O3, OptLevel::Os, OptLevel::Oz];

    /// native `compile_and_run` must agree with `run_asm` (same `Ran` outcome incl. heap, or both
    /// `Fault`, or both `HitCap`) under `caps`, compiled at `opt`.
    fn agree_caps_at(prog: Program, caps: Caps, opt: OptLevel) {
        let native = compile_and_run(&prog, caps, opt);
        match (run_asm(&prog, caps), native) {
            (AsmRun::Ran(a), NativeRun::Ran(n)) => assert_eq!(a, n, "outcome mismatch at {opt:?}"),
            (AsmRun::Fault(_), NativeRun::Fault(_)) => {}
            (AsmRun::HitCap, NativeRun::HitCap) => {}
            (a, n) => panic!("native vs asm-interp mismatch at {opt:?}:\n asm={a:?}\n native={n:?}"),
        }
    }

    /// `agree_caps_at` at the default opt level — what the public `run_native` compiles with.
    fn agree_caps(prog: Program, caps: Caps) {
        agree_caps_at(prog, caps, OptLevel::default());
    }

    fn agree(prog: Program) {
        agree_caps(prog, DEFAULT_CAPS);
    }

    /// Machine-code bytes the JIT emits for `src` at `opt`, summed over its subroutines — measured
    /// off `build_module`, i.e. through the JIT's OWN `host_isa`. Panics on a build failure (test
    /// code; a corpus this small must compile).
    fn jit_code_bytes(src: &str, opt: OptLevel) -> u64 {
        let ast = redextape_core::parser::parse(src).0.expect("fixture parses");
        let prog = crate::lower_program(&redextape_core::desugar::desugar(&ast)).expect("fixture lowers");
        let subs = partition(&prog).expect("fixture partitions");
        match build_module(&prog, &subs, opt) {
            Ok((_module, _decls, bytes)) => bytes,
            Err(run) => panic!("JIT build failed at {opt:?}: {run:?}"),
        }
    }

    #[test]
    fn the_opt_level_reaches_the_jits_own_isa() {
        // LIVENESS GUARD for `host_isa`. There are TWO Cranelift ISA construction sites — this
        // module's and `aot::emit_object`'s — and `aot::tests::the_opt_level_reaches_the_cranelift_isa`
        // covers only the other one. Without this test, replacing `cranelift_opt_level(opt)` in
        // `host_isa` with a literal `"none"` (or reverting to `JITBuilder::new`, which has no way to
        // reach `opt_level` at all) leaves the WHOLE suite green while every native oracle leg —
        // `reference == λ == TM == native`, `native == asm-interp`, the cross-backend sweep — quietly
        // goes back to validating unoptimized codegen. That silent regression is the state this
        // branch exists to end. It cannot be caught by the object-size baseline either: Cranelift's
        // optimized-vs-`none` object deltas on that corpus are 0.6-1.8%, well inside its ±10% band
        // (see `tests/size_baseline.rs`).
        //
        // The fixture is chosen for margin, not for parity with the AOT test: redundant `a + b`
        // subexpressions are exactly what `speed`'s GVN eliminates. Measured (aarch64, cranelift
        // 0.134.2): 256 B at `O0` → 228 B at every optimized level, an 11% drop. The AOT test's
        // `fn twice(x){ x + x } twice(21)` also differs here (148 → 144) but by only 4 bytes, thin
        // enough that an unrelated Cranelift change could close it and make this guard vacuous.
        //
        // Both arms of the six-to-three collapse are checked: `O3` covers `speed`, `Os` covers
        // `speed_and_size`. A failure means `opt` stopped reaching the JIT's ISA — investigate the
        // wiring; do NOT relax the assertion.
        const SRC: &str = "fn f(a,b){ let c = a + b; let d = a + b; let e = c * d; e + (a+b) } f(3,4)";
        let none = jit_code_bytes(SRC, OptLevel::O0);
        for opt in [OptLevel::O3, OptLevel::Os] {
            let optimized = jit_code_bytes(SRC, opt);
            assert_ne!(
                none, optimized,
                "opt_level did not reach the JIT's ISA (O0 and {opt:?} emitted {none} bytes each)"
            );
        }
    }

    #[test]
    fn agreement_holds_at_every_opt_level() {
        // Per-level Cranelift agreement in the DEFAULT (cranelift-only) build. Cross-level agreement
        // was otherwise asserted only in `tests/llvm_oracle.rs`, which needs an LLVM 22 toolchain, so
        // `cargo test --workspace` / `check-all.sh --no-llvm` / the CI `rust` job exercised Cranelift
        // at `OptLevel::default()` and one fat-frame shape alone. Everything else here goes through
        // `agree`, which is default-level only.
        //
        // Deliberately small programs — this runs on every `cargo test`, and 6 levels x 6 programs of
        // this size is well under a second. Between them they cover the shapes where an optimizer
        // could plausibly change the ANSWER rather than just the code: saturating arithmetic (the
        // I1 miscompile), a backward edge (the step counter), a call/return with recursion, heap
        // `rt_*` calls the optimizer cannot see through, a fault, and a cap trip.
        for opt in OPT_LEVELS {
            // Saturating add/mul: `u64::MAX + u64::MAX` and `u64::MAX * u64::MAX` must saturate at
            // every level, not wrap (I1).
            for op in [BinOp::Add, BinOp::Mul] {
                agree_caps_at(
                    Program {
                        code: vec![
                            Instr::Li(Reg::Loc(0), u64::MAX),
                            Instr::Bin(op, Reg::Rr, Reg::Loc(0), Reg::Loc(0)),
                            Instr::Halt,
                        ],
                        labels: vec![],
                    },
                    DEFAULT_CAPS,
                    opt,
                );
            }
            // A counting loop: backward edge (`rt_tick`) plus monus. rr = 50.
            agree_caps_at(
                Program {
                    code: vec![
                        Instr::Li(Reg::Loc(0), 5),
                        Instr::Li(Reg::Rr, 0),
                        Instr::Jz(Reg::Loc(0), "done".to_string()),
                        Instr::Li(Reg::Loc(1), 1),
                        Instr::Bin(BinOp::Sub, Reg::Loc(0), Reg::Loc(0), Reg::Loc(1)),
                        Instr::Li(Reg::Loc(2), 10),
                        Instr::Bin(BinOp::Add, Reg::Rr, Reg::Rr, Reg::Loc(2)),
                        Instr::Jmp("loop".to_string()),
                        Instr::Halt,
                    ],
                    labels: vec![("loop".to_string(), 2), ("done".to_string(), 8)],
                },
                DEFAULT_CAPS,
                opt,
            );
            // Recursion through `rt_enter`/`rt_leave`: sum(5) == 15.
            agree_caps_at(
                Program {
                    code: vec![
                        Instr::Li(Reg::Arg(0), 5),
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
                },
                DEFAULT_CAPS,
                opt,
            );
            // Heap: build a list and read through it — the returned heap is compared too.
            agree_caps_at(
                Program {
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
                },
                DEFAULT_CAPS,
                opt,
            );
            // Fault: head of nil must Fault (not HitCap, not a value) at every level.
            agree_caps_at(
                Program {
                    code: vec![Instr::Nil(Reg::Loc(0)), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
                    labels: vec![],
                },
                DEFAULT_CAPS,
                opt,
            );
            // Cap: an infinite loop must HitCap at every level (the step counter survives whatever
            // the optimizer does to the loop body).
            let spin = Program { code: vec![Instr::Jmp("loop".into())], labels: vec![("loop".into(), 0)] };
            agree_caps_at(spin, Caps { steps: 1000, ..DEFAULT_CAPS }, opt);
        }
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
        assert!(matches!(
            compile_and_run(&prog, Caps { steps: 1000, ..DEFAULT_CAPS }, OptLevel::default()),
            NativeRun::HitCap
        ));
    }

    #[test]
    fn infinite_recursion_hits_cap_without_stack_overflow() {
        // `$main: call $main; halt` — self-recursion that never returns. Must trip the stack-depth
        // cap (via rt_enter, before each native call) and NOT overflow the OS stack. The brief's
        // bare `[Call("f")]` has no return point for the partition's reachability walk; a trailing
        // `Halt` gives one without changing the (never-taken) behaviour.
        let prog = Program { code: vec![Instr::Call("f".into()), Instr::Halt], labels: vec![("f".into(), 0)] };
        assert!(matches!(
            compile_and_run(&prog, Caps { stack: 5000, ..DEFAULT_CAPS }, OptLevel::default()),
            NativeRun::HitCap
        ));
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
        assert!(matches!(
            compile_and_run(&prog, Caps { stack: 2000, ..DEFAULT_CAPS }, OptLevel::default()),
            NativeRun::HitCap
        ));
    }

    #[test]
    fn undefined_call_target_is_lower_error() {
        let prog = Program { code: vec![Instr::Call("missing".into()), Instr::Halt], labels: vec![] };
        assert!(matches!(compile_and_run(&prog, DEFAULT_CAPS, OptLevel::default()), NativeRun::LowerError(_)));
    }

    #[test]
    fn a_huge_register_index_is_rejected_not_a_process_abort() {
        // C1: `run_asm` scans for `Reg::Loc/Arg(n) >= MAX_REGISTERS` and faults to avoid a multi-GB
        // `Vec::resize` abort. Native must likewise reject up front (as `LowerError`) rather than
        // materialise a billion-slot `Variable` bank and abort the whole process. Before the fix
        // this aborted; after it, it returns `LowerError`.
        let prog = Program { code: vec![Instr::Li(Reg::Loc(4_000_000_000), 0), Instr::Halt], labels: vec![] };
        assert!(matches!(compile_and_run(&prog, DEFAULT_CAPS, OptLevel::default()), NativeRun::LowerError(_)));
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
        let native = compile_and_run(&prog, DEFAULT_CAPS, OptLevel::default());
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
    ///
    /// Each filler is an INDEPENDENT function of the runtime argument — `Loc(i) = Arg(0) + (i+1)`,
    /// built as `Li(Loc(i), i+1)` then `Bin(Add, Loc(i), Arg(0), Loc(i))` — and every filler is read
    /// back in `READ_PASSES` full sweeps after the self-call. **Do not "simplify" this into
    /// `Li(Loc(i), 1)`, and do not chain it into `Loc(i) = Arg(0) + Loc(i-1)` either.** Both weaker
    /// shapes hollow out the optimized legs of the totality test below. All numbers below are the
    /// `countdown` prologue's `sp` adjustment in an `aot::emit_object` object (aarch64: the
    /// `stp .., [sp, #-0x10]!` pushes plus `sub sp, sp, #imm`), at 200 fillers:
    ///
    /// | filler shape | `none` | `speed` / `speed_and_size` | ratio |
    /// | --- | ---: | ---: | ---: |
    /// | constants (`Li(Loc(i), 1)`) | 1632 B | **32 B** | 0.02x |
    /// | dependent chain (`Arg(0) + Loc(i-1)`) | 1632 B | 1648 B | 1.01x |
    /// | independent (SHIPPED) | 1632 B | **4656 B** | **2.85x** |
    ///
    /// Non-constness alone is not enough — that is what the middle row is here to record. A constant
    /// bank is rematerialized wholesale and the frame collapses to 32 bytes, making five of the six
    /// legs vacuous. A dependent chain resists rematerialization, but each `Loc(i)` dies the moment
    /// `Loc(i+1)` is computed, so almost no live ranges overlap and the optimized frame lands a
    /// rounding error above the unoptimized one — non-vacuous, yet measuring the wrong thing.
    /// INDEPENDENCE is what bites: every filler is computed from `Arg(0)` alone at entry, so all of
    /// them are simultaneously live across the self-call, regalloc2 splits their live ranges, and the
    /// optimized frame spills ~3 words per asm register against the 4 words `shared::BYTES_PER_VAR`
    /// charges. The repeated read passes matter for the same reason: 1 pass gives 3232 B, 2 gives
    /// 4576 B, and it saturates at 4656 B from 4 passes on.
    ///
    /// This is the shape `BYTES_PER_VAR`'s safety argument actually rests on (its doc's measurement
    /// table is this program at 50..3200 fillers), and Cranelift is where that argument is thinnest:
    /// optimized Cranelift frames are ~3x LARGER than unoptimized ones, the opposite direction from
    /// LLVM — whose `O1+` `mem2reg`/SROA shrink frames, making `O0` its binding case. An
    /// under-charging estimate therefore bites on optimized Cranelift first, and those are exactly
    /// the legs the weaker shapes would silence. At 200 fillers the estimate charges
    /// `(200 + 3 + 1 + 8) * 32 + 2048 = 8832` B against 4656 B actual — 1.90x headroom, and this test
    /// is what would notice if that ratio ever moved.
    ///
    /// Each `Loc(i)` is seeded by its own `Li` before being read, so no instruction here READS a
    /// `Loc` this body has not already written: `run_asm`'s `Call` leaves the caller's locals in
    /// `vm.locals`, so a callee INHERITS them, whereas the native backends give each callee a zeroed
    /// bank. This helper's program is only ever asserted to `HitCap` (never compared against
    /// `run_asm`), but keeping it inside the definite-assignment contract every `lower_asm`/`defunc`
    /// output satisfies means it stays usable in an agreement test too.
    fn fat_recursive_countdown(fillers: u32, depth: u64) -> Program {
        // Sweeps over the whole filler bank after the self-call; 4 is where the frame saturates.
        const READ_PASSES: u32 = 4;

        let zero = fillers; // Loc holding the constant 0
        let eqbit = fillers + 1; // Loc holding (n == 0)
        let one = fillers + 2; // Loc holding the constant 1
        let mut code = vec![
            Instr::Li(Reg::Arg(0), depth),   // 0  $main: n = depth
            Instr::Call("countdown".into()), // 1
            Instr::Halt,                     // 2
        ];
        // countdown: entry at index 3. `Loc(i) = n + (i+1)` — each filler a distinct runtime value
        // computed from `Arg(0)` ALONE, so none is rematerializable and all are live at once.
        for i in 0..fillers {
            code.push(Instr::Li(Reg::Loc(i), u64::from(i) + 1));
            code.push(Instr::Bin(BinOp::Add, Reg::Loc(i), Reg::Arg(0), Reg::Loc(i)));
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
        // Read every filler after the call, several sweeps over the whole bank, so they all stay live
        // ACROSS the call and their live ranges overlap each other (a real, fat spilled frame).
        for _ in 0..READ_PASSES {
            for i in 0..fillers {
                code.push(Instr::Bin(BinOp::Add, Reg::Rr, Reg::Rr, Reg::Loc(i)));
            }
        }
        code.push(Instr::Ret);
        Program { code, labels: vec![("countdown".into(), 3), ("rec".into(), rec_idx)] }
    }

    #[test]
    fn a_fat_frame_deep_recursion_returns_hitcap_at_every_opt_level() {
        // C1 (the reviewer's repro): a subroutine with a FAT native frame recursing far deeper than
        // that frame size lets the reserved stack hold. Before the fix this overflowed the JIT
        // thread's 64 MiB stack and ABORTED the whole process (uncatchable SIGABRT). The
        // frame-size-aware depth cap must instead return `HitCap` — total, no abort. That this test
        // completes in-suite (rather than killing the test process) is the proof C1 is fixed.
        //
        // Swept over every opt level because `native_depth_cap`'s per-slot estimate was calibrated on
        // UNOPTIMIZED frames: `speed`/`speed_and_size` change frame layout, and an estimate that
        // under-charges an optimized frame would let this recursion reach the real stack's end. The
        // optimized legs only MEAN anything because `fat_recursive_countdown`'s fillers are mutually
        // INDEPENDENT functions of `Arg(0)` (see its doc): constants fold away to a 32-byte frame and
        // a dependent chain barely splits any live range, whereas this shape is the one optimized
        // Cranelift blows up ~2.85x (1632 → 4656 bytes at 200 fillers) — the very ratio
        // `BYTES_PER_VAR = 32` is calibrated against. A failure here is a real totality bug in that
        // constant, not a test to loosen.
        for opt in OPT_LEVELS {
            let prog = fat_recursive_countdown(200, 100_000);
            let run = compile_and_run(&prog, DEFAULT_CAPS, opt);
            assert!(
                matches!(run, NativeRun::HitCap),
                "fat-frame deep recursion must trip the depth cap, not abort, at {opt:?}; got {run:?}"
            );
        }
    }

    /// `$main` calls `fat` ONCE; `fat` writes `fillers` locals, folds them into `Rr` and returns —
    /// a fat frame that is only one call deep, so the depth cap must never trip on it. The dual of
    /// `fat_recursive_countdown`: same fat frame, no recursion.
    fn fat_shallow_call(fillers: u32) -> Program {
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
        Program { code, labels: vec![("fat".into(), 3)] }
    }

    #[test]
    fn shallow_but_fat_frame_still_runs_to_a_value_at_every_opt_level() {
        // The frame-size-aware cap must NOT spuriously `HitCap` a non-recursive fat-frame program:
        // ~150 locals but only one call deep. Native must `Ran` the value, agreeing with `run_asm` —
        // at every opt level, since a level that made the cap too tight would show up here as a
        // spurious `HitCap` (the opposite failure mode to the deep-recursion sweep above).
        for opt in OPT_LEVELS {
            // 42 + 150*1 = 192; agree_caps_at checks native == run_asm (both Ran, same value).
            agree_caps_at(fat_shallow_call(150), DEFAULT_CAPS, opt);
        }
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
        match compile_and_run(&prog, DEFAULT_CAPS, OptLevel::default()) {
            NativeRun::Ran(o) => assert_eq!(o.result, 5050, "sum(100) should be 5050"),
            other => panic!("sum(100) must Ran(5050), got {other:?}"),
        }
        // And it agrees with the asm interpreter.
        assert!(matches!(run_asm(&prog, DEFAULT_CAPS), AsmRun::Ran(o) if o.result == 5050));
    }
}
