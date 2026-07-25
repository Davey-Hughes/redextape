//! Ahead-of-time object emission: compile a first-order register-asm `Program` to a host `.o`,
//! reusing the exact same `Module`-generic codegen the JIT drives (`codegen`), plus an emitted C
//! `main` entry and a CONFIG data blob.
//!
//! The object is *incomplete on its own*: its subroutines call the `rt_*` runtime helpers, which are
//! left as undefined imports to be resolved at link time against `libredextape_native_rt.a` (Task 6).
//! `main` is a tiny shim that does nothing but `return rt_run(&$main, &CONFIG, CONFIG_LEN)` — the
//! runtime's `rt_run` (Task 5) sets up a `Runtime`, calls `$main`, and prints the decoded result
//! using the `Ty` and `Caps`/`depth_cap` recorded in the CONFIG blob. Splitting the driver logic into
//! `rt_run` (rather than emitting it as Cranelift IR here) keeps this emitter small and shares one
//! run/decode path with the rest of the runtime.
//!
//! # Tier 0 debuggability
//! Subroutines are declared `Linkage::Local` (module-private) but their *names* (`$main`, each `fn`)
//! are retained in the object's symbol table — we do not strip — so a debugger/`nm` shows meaningful
//! frames. The smoke test asserts a `$main`-containing symbol survives.

use cranelift_codegen::ir::{AbiParam, InstBuilder, Signature, UserFuncName, types};
use cranelift_codegen::settings::{self, Configurable};
use cranelift_module::{DataDescription, Linkage, Module};
use cranelift_object::{ObjectBuilder, ObjectModule};

use redextape_core::tm::{Caps, Program};
use redextape_core::ty::Ty;

use crate::codegen::{self, CodegenError};
use crate::shared::{native_depth_cap, param_count, reg_over_cap};
use crate::{AotError, OptLevel};

/// Map a backend-agnostic `CodegenError` (bare cause) into this driver's `AotError::Codegen`.
fn cg(e: CodegenError) -> AotError {
    AotError::Codegen(e.0)
}

/// Append `ty`, tag-encoded, to `out`. The layout is matched byte-for-byte by
/// `redextape_native_rt::config::deserialize` (Task 5): `0=Nat 1=Bool 2=Unit 3=List<elem follows>`.
/// A non-value type (`Fun`/`Var`) has no runtime representation to print, so it is rejected as
/// `Unsupported` here — before any object is built — keeping `emit_object` total.
fn serialize_ty(ty: &Ty, out: &mut Vec<u8>) -> Result<(), AotError> {
    match ty {
        Ty::Nat => out.push(0),
        Ty::Bool => out.push(1),
        Ty::Unit => out.push(2),
        Ty::List(elem) => {
            out.push(3);
            serialize_ty(elem, out)?;
        }
        Ty::Fun(..) | Ty::Var(_) => {
            return Err(AotError::Unsupported(format!("cannot emit a program of non-value type {ty:?}")));
        }
    }
    Ok(())
}

/// Serialize the run configuration into the fixed little-endian layout the runtime reads back:
///
/// ```text
/// [0..8)   caps.steps  u64 LE
/// [8..16)  caps.stack  u64 LE
/// [16..24) caps.heap   u64 LE
/// [24..32) depth_cap   u64 LE
/// [32..)   Ty, tag-encoded (see `serialize_ty`)
/// ```
///
/// `caps.mem` is intentionally omitted: it bounds the reference interpreter's cloned-`Vec<Frame>`
/// words and has no native analog (native recursion is bounded by `depth_cap` instead — see
/// `shared::native_depth_cap`).
fn serialize_config(caps: Caps, depth_cap: u64, ty: &Ty) -> Result<Vec<u8>, AotError> {
    let mut b = Vec::new();
    for w in [caps.steps, caps.stack, caps.heap, depth_cap] {
        b.extend_from_slice(&w.to_le_bytes());
    }
    serialize_ty(ty, &mut b)?;
    Ok(b)
}

/// Compile `prog` to a host object file (`.o`) for `caps` at optimization level `opt`, recording
/// `ty` in the CONFIG blob so the standalone binary can print its result. Returns the object bytes;
/// never panics.
///
/// The object exports `main` (a shim calling `rt_run`), keeps every subroutine symbol (Tier 0
/// debuggability), defines a local `redextape_config` data object, and imports `rt_run` plus the
/// `rt_*` runtime helpers — all resolved at link time (Task 6). A non-value `ty`, an over-cap
/// register index, or a partition failure is returned as the corresponding `AotError`, not a panic.
pub fn emit_object(prog: &Program, caps: Caps, ty: &Ty, opt: OptLevel) -> Result<Vec<u8>, AotError> {
    // Reject a non-value result type up front (before building any IR) so a `Fun`/`Var` program
    // fails cleanly rather than doing codegen work it would only discard.
    serialize_ty(ty, &mut Vec::new())?;

    // Reject an absurd register index BEFORE building any function (a billion-slot `Variable` bank
    // would attempt a multi-GB allocation whose failure aborts the process). `run_asm`/the JIT guard
    // the same way; here it becomes `Unsupported` (a "not a value" outcome, out of oracle scope).
    if reg_over_cap(prog) {
        return Err(AotError::Unsupported("register index exceeds MAX_REGISTERS".into()));
    }
    let subs = crate::analysis::partition(prog).map_err(AotError::Lower)?;

    // Host ISA. `is_pic` (position-independent) is friendliest to the system linker across macOS and
    // Linux; the JIT sets it the other way (`false`, which `JITModule` requires), so each driver states
    // its own. `opt_level` goes through the SAME mapping the JIT uses (`codegen::cranelift_opt_level`),
    // so an object and a JIT run at the same `OptLevel` share both the codegen (`codegen.rs`, driven
    // identically here and in `jit.rs`) and the optimization settings; only `is_pic` differs, so the
    // emitted code is equivalent but not byte-for-byte identical (PIC changes how globals and calls
    // are addressed).
    let mut flags = settings::builder();
    flags.set("is_pic", "true").map_err(|e| AotError::Object(e.to_string()))?;
    flags.set("opt_level", codegen::cranelift_opt_level(opt)).map_err(|e| AotError::Object(e.to_string()))?;
    let isa_builder = cranelift_native::builder().map_err(|e| AotError::Object(e.to_string()))?;
    let isa = isa_builder.finish(settings::Flags::new(flags)).map_err(|e| AotError::Object(e.to_string()))?;
    let builder = ObjectBuilder::new(isa, "redextape_aot", cranelift_module::default_libcall_names())
        .map_err(|e| AotError::Object(e.to_string()))?;
    let mut module = ObjectModule::new(builder);

    // Shared codegen (byte-for-byte identical to the JIT's): declare the `rt_*` imports and every
    // subroutine, then translate + define each one.
    let rt = codegen::declare_rt(&mut module).map_err(cg)?;
    let (func_ids, arity) = codegen::declare_subroutines(&mut module, &subs).map_err(cg)?;
    let decls = codegen::Decls { rt, func_ids, arity };
    let mut fbctx = cranelift_frontend::FunctionBuilderContext::new();
    for sub in &subs {
        let mut ctx = module.make_context();
        ctx.func.signature = codegen::word_signature(&module, param_count(sub));
        let fid = decls.func_ids[&sub.entry];
        ctx.func.name = UserFuncName::user(0, fid.as_u32());
        codegen::translate_subroutine(&mut module, &mut ctx, &mut fbctx, prog, sub, &decls).map_err(cg)?;
        module.define_function(fid, &mut ctx).map_err(|e| AotError::Object(e.to_string()))?;
        module.clear_context(&mut ctx);
    }

    // CONFIG data object: `caps` + the frame-size-aware `depth_cap` + the result `ty`.
    let depth_cap = native_depth_cap(prog, &subs, caps);
    let config = serialize_config(caps, depth_cap, ty)?;
    let config_len = config.len() as i64;
    let config_id = module
        .declare_data("redextape_config", Linkage::Local, false, false)
        .map_err(|e| AotError::Object(e.to_string()))?;
    let mut dd = DataDescription::new();
    dd.define(config.into_boxed_slice());
    module.define_data(config_id, &dd).map_err(|e| AotError::Object(e.to_string()))?;

    // `main` entry: `int main(int argc, char** argv) { return rt_run(&$main, &CONFIG, CONFIG_LEN); }`.
    let ptr = codegen::pointer_type(&module);
    let mut main_sig = Signature::new(module.isa().default_call_conv());
    main_sig.params.push(AbiParam::new(types::I32)); // argc (ignored)
    main_sig.params.push(AbiParam::new(ptr)); // argv (ignored)
    main_sig.returns.push(AbiParam::new(types::I32));
    let main_id =
        module.declare_function("main", Linkage::Export, &main_sig).map_err(|e| AotError::Object(e.to_string()))?;

    // `rt_run(main_fn_ptr, config_ptr, config_len) -> i32`, an undefined import (linked in Task 6).
    let mut run_sig = Signature::new(module.isa().default_call_conv());
    run_sig.params.push(AbiParam::new(ptr)); // $main fn address
    run_sig.params.push(AbiParam::new(ptr)); // config address
    run_sig.params.push(AbiParam::new(types::I64)); // config length
    run_sig.returns.push(AbiParam::new(types::I32));
    let rt_run_id =
        module.declare_function("rt_run", Linkage::Import, &run_sig).map_err(|e| AotError::Object(e.to_string()))?;

    let mut ctx = module.make_context();
    ctx.func.signature = main_sig;
    ctx.func.name = UserFuncName::user(0, main_id.as_u32());
    {
        let mut b = cranelift_frontend::FunctionBuilder::new(&mut ctx.func, &mut fbctx);
        let blk = b.create_block();
        b.append_block_params_for_function_params(blk);
        b.switch_to_block(blk);
        b.seal_block(blk);
        // The entry subroutine is always `entry == 0` ($main); take its address for `rt_run`.
        let inner_main = module.declare_func_in_func(decls.func_ids[&0], b.func);
        let main_addr = b.ins().func_addr(ptr, inner_main);
        let config_gv = module.declare_data_in_func(config_id, b.func);
        // `declare_data_in_func` yields a `Symbol`-kind global value; `symbol_value` materialises its
        // address (Cranelift 0.134 dropped the legacy `global_value` instruction from `InstBuilder`).
        let config_addr = b.ins().symbol_value(ptr, config_gv);
        let len_val = b.ins().iconst(types::I64, config_len);
        let run_ref = module.declare_func_in_func(rt_run_id, b.func);
        let call = b.ins().call(run_ref, &[main_addr, config_addr, len_val]);
        let code = b.inst_results(call)[0];
        b.ins().return_(&[code]);
        b.finalize(module.target_config());
    }
    module.define_function(main_id, &mut ctx).map_err(|e| AotError::Object(e.to_string()))?;
    module.clear_context(&mut ctx);

    let product = module.finish();
    product.emit().map_err(|e| AotError::Object(e.to_string()))
}

// --- Linking: staticlib discovery, `cc` driver, platform-aware linker selection, strip (Task 6) ---
//
// `emit_object` above produces an *incomplete* object -- its `rt_*` calls are undefined imports.
// `link_executable` resolves them against `libredextape_native_rt.a` via the system `cc` driver,
// producing a runnable executable. This is best-effort: a missing `cc`, missing staticlib, or a
// failing link is a returned `AotError`, never a panic -- object emission is the always-works core,
// linking degrades gracefully on top of it.

/// True if `bin` is a regular file in some directory on `$PATH`, or (short-circuiting the `$PATH`
/// scan entirely) if `bin` is itself an absolute or relative path to a regular file. Without this,
/// an absolute/relative-path binary (e.g. `CC=/usr/bin/clang` or `REDEXTAPE_LINKER=/opt/ld/ld64`)
/// would spuriously fail the probe whenever `$PATH` is empty or scrubbed (a minimal/sandboxed
/// environment), even though the binary plainly exists at the given path.
fn on_path(bin: &str) -> bool {
    let path = std::path::Path::new(bin);
    if bin.contains(std::path::MAIN_SEPARATOR) {
        return path.is_file();
    }
    std::env::var_os("PATH").is_some_and(|paths| std::env::split_paths(&paths).any(|d| d.join(bin).is_file()))
}

/// Which system linker to request via `cc`.
///
/// `Auto` is platform-aware (see `selected_linker`); `Default` forces the platform's default linker
/// (no `-fuse-ld`) even where a faster one is present; `Named` pins an exact `-fuse-ld` value.
#[derive(Clone, Debug)]
pub enum LinkerChoice {
    Auto,
    Default,
    Named(String),
}

/// Options for `link_executable`.
#[derive(Clone, Debug)]
pub struct LinkOptions {
    pub linker: LinkerChoice,
    pub strip: bool,
}

impl Default for LinkOptions {
    fn default() -> Self {
        LinkOptions { linker: LinkerChoice::Auto, strip: false }
    }
}

/// Which linker to request via `-fuse-ld`, or `None` to use the platform default `cc` linker.
///
/// Env `REDEXTAPE_LINKER` overrides `LinkOptions.linker` unconditionally (including over an explicit
/// `Named` choice) on any platform; `"default"`/empty means "no `-fuse-ld` override". Absent the env
/// override, `Auto` is platform-aware: on macOS the default `ld` (ld-prime) is fastest and the other
/// fast linkers (mold/wild) don't target Mach-O, so `Auto` = default (`None`); on Linux/ELF it prefers
/// mold > wild > lld, probing `$PATH` for whichever is present, falling back to the platform default
/// if none are.
fn selected_linker(opts: &LinkOptions) -> Option<String> {
    if let Ok(v) = std::env::var("REDEXTAPE_LINKER") {
        return match v.as_str() {
            "default" | "" => None,
            other => Some(other.to_string()),
        };
    }
    match &opts.linker {
        LinkerChoice::Default => None,
        LinkerChoice::Named(n) => Some(n.clone()),
        LinkerChoice::Auto => {
            if cfg!(target_os = "macos") {
                None // ld-prime is fastest; don't override
            } else {
                ["mold", "wild", "lld"].into_iter().find(|n| on_path(n)).map(str::to_string)
            }
        }
    }
}

/// The staticlib built by `redextape-native-rt` that resolves `emit_object`'s `rt_*` imports.
const RT_STATICLIB: &str = "libredextape_native_rt.a";

/// Locate `libredextape_native_rt.a` under the cargo target directory, building
/// `redextape-native-rt` first if it isn't there yet.
///
/// The target dir is `$CARGO_TARGET_DIR` if set, else `{workspace-root}/target` where
/// workspace-root is this crate's manifest dir joined with `../..`. Prefers the `debug` profile
/// subdir over `release` (whichever exists; `debug` tried first, matching a plain `cargo build`).
/// If the staticlib is missing from both, shells out `cargo build -p redextape-native-rt` and
/// re-checks once; if it's still missing, returns `AotError::NoStaticlib`. Total: a failure to
/// locate or build the staticlib is always a returned error, never a panic.
fn locate_staticlib() -> Result<std::path::PathBuf, AotError> {
    let target_dir = std::env::var_os("CARGO_TARGET_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("target"));

    let find = || ["debug", "release"].into_iter().map(|p| target_dir.join(p).join(RT_STATICLIB)).find(|p| p.is_file());

    if let Some(p) = find() {
        return Ok(p);
    }

    // Not built yet (or cleaned): best-effort build, then re-check once. Any failure to spawn or
    // complete `cargo` here just falls through to `NoStaticlib` below -- never a panic.
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
    let _ = std::process::Command::new(cargo).args(["build", "-p", "redextape-native-rt"]).output();

    find().ok_or(AotError::NoStaticlib)
}

/// Link an emitted object (`emit_object`'s output) into a runnable executable at `out`.
///
/// Writes `obj` to a temp `.o` file next to `out`, locates the runtime staticlib (building it if
/// needed), then invokes `cc` with the selected linker (`selected_linker`); a `strip: true` option
/// adds `-Wl,-s`. If the selected non-default linker fails, falls back to one retry with the
/// platform's default linker before giving up. Best-effort: a missing `cc`/linker/staticlib or a
/// failing link is a returned `AotError` (`NoLinker`/`NoStaticlib`/`Link`), never a panic.
pub fn link_executable(obj: &[u8], out: &std::path::Path, opts: &LinkOptions) -> Result<(), AotError> {
    let cc = std::env::var("CC").unwrap_or_else(|_| "cc".to_string());
    if !on_path(&cc) {
        return Err(AotError::NoLinker);
    }
    let staticlib = locate_staticlib()?;

    // Write the object next to the output.
    let obj_path = out.with_extension("o");
    std::fs::write(&obj_path, obj).map_err(|e| AotError::Link(e.to_string()))?;

    // Try the selected linker, then fall back to the default on failure.
    let sel = selected_linker(opts);
    let sel_is_override = sel.is_some();
    let mut attempts: Vec<Option<String>> = vec![sel];
    if sel_is_override {
        attempts.push(None); // fallback to default linker
    }

    let mut last_err = String::new();
    for linker in attempts {
        let mut cmd = std::process::Command::new(&cc);
        cmd.arg(&obj_path).arg(&staticlib);
        if let Some(name) = &linker {
            cmd.arg(format!("-fuse-ld={name}"));
        }
        if opts.strip {
            cmd.arg("-Wl,-s");
        }
        // Rust staticlibs need the C runtime deps; harmless where already implied.
        if cfg!(target_os = "linux") {
            cmd.args(["-lpthread", "-ldl", "-lm"]);
        }
        cmd.arg("-o").arg(out);
        match cmd.output() {
            Ok(o) if o.status.success() => return Ok(()),
            Ok(o) => last_err = String::from_utf8_lossy(&o.stderr).into_owned(),
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(AotError::Link(last_err))
}

#[cfg(all(test, feature = "cranelift"))]
mod tests {
    use super::*;
    use cranelift_object::object::{Object, ObjectSymbol};
    use redextape_core::tm::{DEFAULT_CAPS, lower_asm};
    use redextape_core::ty::Ty;
    use redextape_core::{desugar::desugar, parser::parse};

    fn prog(src: &str) -> redextape_core::tm::Program {
        lower_asm(&desugar(&parse(src).0.unwrap())).unwrap()
    }

    #[test]
    fn emits_a_valid_object_with_main_and_rt_run() {
        let bytes = emit_object(&prog("2 + 3"), DEFAULT_CAPS, &Ty::Nat, OptLevel::default()).unwrap();
        let obj = cranelift_object::object::File::parse(&*bytes).expect("valid object");
        let syms: Vec<String> = obj.symbols().filter_map(|s| s.name().ok().map(str::to_string)).collect();
        // `main` is defined/exported; the subroutine names are present (Tier 0 debuggability);
        // rt_run is an undefined import to be linked later.
        assert!(syms.iter().any(|n| n == "main" || n == "_main"), "main symbol present: {syms:?}");
        assert!(syms.iter().any(|n| n.contains("$main")), "subroutine symbols kept: {syms:?}");
        assert!(syms.iter().any(|n| n == "rt_run" || n == "_rt_run"), "rt_run import present: {syms:?}");
    }

    #[test]
    fn rejects_a_non_value_result_type() {
        // A function-typed result has no runtime representation to print: `Unsupported`, not a panic.
        let ty = Ty::Fun(vec![Ty::Nat], Box::new(Ty::Nat));
        assert!(matches!(
            emit_object(&prog("1 + 1"), DEFAULT_CAPS, &ty, OptLevel::default()),
            Err(AotError::Unsupported(_))
        ));
    }

    #[test]
    fn the_opt_level_reaches_the_cranelift_isa() {
        // `none` and `speed` must not produce byte-identical objects for a program with obvious
        // optimization headroom. If they do, the flag never reached the ISA builder — which is exactly
        // the bug this task fixes, so without this test the wiring could silently regress.
        let p = prog("fn twice(x){ x + x } twice(21)");
        let o0 = emit_object(&p, DEFAULT_CAPS, &Ty::Nat, OptLevel::O0).expect("O0 object");
        let o3 = emit_object(&p, DEFAULT_CAPS, &Ty::Nat, OptLevel::O3).expect("O3 object");
        assert_ne!(o0, o3, "opt_level did not reach the Cranelift ISA (O0 and O3 emitted identical objects)");
    }

    #[test]
    fn config_layout_is_fixed_little_endian() {
        // The blob the runtime reads back: caps.steps/stack/heap, depth_cap, then the Ty tag(s).
        let caps = Caps { steps: 7, stack: 9, heap: 11, mem: 0 };
        let b = serialize_config(caps, 13, &Ty::List(Box::new(Ty::Nat))).unwrap();
        assert_eq!(&b[0..8], &7u64.to_le_bytes());
        assert_eq!(&b[8..16], &9u64.to_le_bytes());
        assert_eq!(&b[16..24], &11u64.to_le_bytes());
        assert_eq!(&b[24..32], &13u64.to_le_bytes());
        assert_eq!(&b[32..], &[3u8, 0u8]); // List(Nat) = tag 3 then Nat = tag 0
    }
}

/// Policy tests for linker selection (Task 6, Step 1: written to fail first -- `selected_linker`,
/// `LinkOptions`, `LinkerChoice` do not exist yet).
///
/// `REDEXTAPE_LINKER` is a process-global env var; `cargo test` runs a crate's tests in parallel
/// threads within one binary, so two tests mutating it concurrently could race and flake. Every test
/// that touches it acquires `ENV_LOCK` first via the `EnvVarGuard` RAII helper, which also removes
/// the var on drop (so it can't leak into other tests even if an assertion panics mid-test).
#[cfg(all(test, feature = "cranelift"))]
mod linker_policy_tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    // The guard is kept alive only for its `Drop` (releasing `ENV_LOCK`); its contents are never
    // read.
    struct EnvVarGuard(#[allow(dead_code)] std::sync::MutexGuard<'static, ()>);
    impl EnvVarGuard {
        fn acquire() -> Self {
            // Recover from a poisoned lock (a prior guarded test panicking) rather than propagating
            // the poison -- the guarded section's own assertions are what should fail, not this.
            EnvVarGuard(ENV_LOCK.lock().unwrap_or_else(std::sync::PoisonError::into_inner))
        }
    }
    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            // SAFETY: serialized by `ENV_LOCK` (only one guard live at a time across the process).
            unsafe { std::env::remove_var("REDEXTAPE_LINKER") };
        }
    }

    #[test]
    fn linker_env_override_wins() {
        let _guard = EnvVarGuard::acquire();
        // SAFETY: serialized by `ENV_LOCK`; no other test observes `REDEXTAPE_LINKER` concurrently.
        unsafe { std::env::set_var("REDEXTAPE_LINKER", "lld") };
        assert_eq!(selected_linker(&LinkOptions::default()), Some("lld".to_string()));
        unsafe { std::env::set_var("REDEXTAPE_LINKER", "default") };
        assert_eq!(selected_linker(&LinkOptions::default()), None); // "default" = no -fuse-ld
        unsafe { std::env::remove_var("REDEXTAPE_LINKER") };
    }

    #[test]
    fn auto_is_none_on_macos_named_is_explicit() {
        let _guard = EnvVarGuard::acquire();
        // Ensure a clean slate regardless of test order (the guard only clears on drop).
        // SAFETY: serialized by `ENV_LOCK`.
        unsafe { std::env::remove_var("REDEXTAPE_LINKER") };
        // Named always wins regardless of platform.
        let named = LinkOptions { linker: LinkerChoice::Named("mold".into()), strip: false };
        assert_eq!(selected_linker(&named), Some("mold".to_string()));
        // Auto on macOS selects the default (None); on Linux it may probe (`on_path`-dependent, not
        // asserted here to avoid depending on the test machine's installed toolchain).
        if cfg!(target_os = "macos") {
            assert_eq!(selected_linker(&LinkOptions::default()), None);
        }
    }
}
