//! `redextape-native-rt`: the native backend's runtime — heap/box arenas plus the `extern "C"`
//! host functions that JIT-generated code (Task 4) calls for heap allocation, faults, and cap
//! checks. Semantics mirror `redextape_core::tm::asm::run_asm`'s `Cons`/`Head`/`Tail`/`IsEmpty`/
//! `Box`/`BoxGet`/`BoxSet` arms EXACTLY: 1-based heap/box pointers, `0` = nil, the same fault and
//! cap conditions. This is what lets the native backend reuse `decode_asm` and agree with the asm
//! interpreter in the oracle.
//!
//! This crate is split out from `redextape-native` (which depends on Cranelift) so its `rt_*`
//! functions can be **linked** into a standalone AOT binary without dragging Cranelift along:
//! `crate-type = ["rlib", "staticlib"]` — the JIT registers these as in-process fn pointers via the
//! rlib, while a future AOT object resolves its `rt_*` imports against `libredextape_native_rt.a`.
//! Every `rt_*` function below is `#[unsafe(no_mangle)]` so its linker symbol is the literal name
//! (`rt_cons`, `rt_head`, …) rather than a mangled Rust symbol — required for the staticlib case.

// Test code is exempt from `pedantic`, for the reason `clippy.toml` gives for the
// unwrap/expect/panic set: an assertion is a deliberate panic, and a probe that casts a `u64` step
// count to `f64` to print a ratio is not a defect. `cfg_attr` rather than the one module-level
// attribute this crate's own single inline `#[cfg(test)] mod tests` would otherwise need — under
// `--all-targets` each lib compiles twice, and `cfg(test)` holds only in the test-harness pass, so
// production warnings still surface from the other one.
#![cfg_attr(test, allow(clippy::pedantic))]

use redextape_core::tm::{AsmOutcome, Caps};
use redextape_core::ty::Ty;

/// The native backend's runtime state: heap/box arenas, step/depth counters, and fault/cap
/// flags. JIT-generated code (Task 4) holds a `*mut Runtime` for the duration of a run and calls
/// the `rt_*` host functions below for every heap/box operation and every cap check, mirroring
/// `run_asm`'s `Vm` one-for-one (`heap`/`boxes`/`steps`/`caps` are the same fields; `depth` plays
/// the role `Vm::stack.len()` plays for the stack cap, without needing the actual frame data —
/// the JIT-generated code keeps locals on the native stack instead of a `Vec<Frame>`).
pub struct Runtime {
    pub heap: Vec<(u64, u64)>,
    pub boxes: Vec<u64>,
    pub steps: u64,
    pub depth: u64,
    pub caps: Caps,
    /// The recursion-depth limit `rt_enter` trips at. Distinct from `caps.stack` because native
    /// keeps each frame's locals on the *real* OS call stack (not a `Vec<Frame>`), so the backend
    /// derives a FRAME-SIZE-AWARE cap: `min(caps.stack, safe_depth)`, where `safe_depth` is how many
    /// worst-case frames fit in the run thread's reserved stack (see `redextape_native::codegen`).
    /// This guarantees the depth cap always trips *before* the native stack overflows, for any
    /// program — no process abort. `Runtime::new` defaults it to `caps.stack` (the depth-only bound)
    /// for callers with no frame-size knowledge (e.g. this module's own unit tests below).
    pub depth_cap: u64,
    pub fault: Option<String>,
    pub hit_cap: bool,
}

impl Runtime {
    /// A runtime whose depth cap is just `caps.stack` (no frame-size awareness). Used by the
    /// `rt_*` unit tests; the JIT driver uses `with_depth_cap` instead.
    #[must_use]
    pub fn new(caps: Caps) -> Runtime {
        Runtime::with_depth_cap(caps, caps.stack)
    }

    /// A runtime whose recursion-depth limit is `depth_cap` — the frame-size-aware
    /// `min(caps.stack, safe_depth)` the JIT backend computes so `rt_enter` trips before the native
    /// stack is exhausted.
    #[must_use]
    pub fn with_depth_cap(caps: Caps, depth_cap: u64) -> Runtime {
        Runtime {
            heap: Vec::new(),
            boxes: Vec::new(),
            steps: 0,
            depth: 0,
            caps,
            depth_cap,
            fault: None,
            hit_cap: false,
        }
    }

    /// Once a fault or a cap trip has been recorded, every further faultable op is a no-op
    /// (returning `0`): the JIT-generated code branches out on `fault`/`hit_cap` after the call
    /// that set it, but may still be mid-block (e.g. an already-scheduled sibling op) before that
    /// branch executes, so the host side must not let a stale call corrupt or grow the arenas.
    fn stopped(&self) -> bool {
        self.fault.is_some() || self.hit_cap
    }

    /// Finish a run: pair the register-`rr` result word with the heap needed to decode it,
    /// mirroring `run_asm`'s `AsmRun::Ran(AsmOutcome { result: vm.rr, heap: vm.heap })`.
    #[must_use]
    pub fn into_outcome(self, result: u64) -> AsmOutcome {
        AsmOutcome { result, heap: self.heap }
    }
}

/// `rd <- cons(rh, rt)`. Mirrors `run_asm`'s `Instr::Cons` arm: cap-checks `heap.len()` against
/// `caps.heap` (matching `vm.heap.len() as u64 >= vm.caps.heap`), else pushes `(h, t)` and
/// returns the new 1-based pointer (`heap.len()` after the push).
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call (the
/// pointer the JIT-generated code was handed for this run).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rt_cons(rt: *mut Runtime, h: u64, t: u64) -> u64 {
    let rt = unsafe { &mut *rt };
    if rt.stopped() {
        return 0;
    }
    if rt.heap.len() as u64 >= rt.caps.heap {
        rt.hit_cap = true;
        return 0;
    }
    rt.heap.push((h, t));
    rt.heap.len() as u64 // 1-based
}

/// `rd <- head(rl)`. Mirrors `run_asm`'s `Instr::Head` arm: `p == 0` faults ("head of empty
/// list"); a non-null pointer past the heap end faults ("head of invalid list pointer") rather
/// than indexing out of bounds; else returns the cell's head field.
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rt_head(rt: *mut Runtime, p: u64) -> u64 {
    let rt = unsafe { &mut *rt };
    if rt.stopped() {
        return 0;
    }
    if p == 0 {
        rt.fault = Some("head of empty list".to_string());
        return 0;
    }
    // `p - 1` is a u64 heap index from the JIT-generated caller; on a 32-bit target it may not fit
    // `usize`. Rather than truncating it into a possibly-in-bounds index (which would silently
    // alias a real cell instead of faulting), `try_from`'s `Err` folds into the SAME "invalid list
    // pointer" fault an in-range-but-dangling `p` already takes via `.get()` returning `None`.
    if let Some(&(h, _)) = usize::try_from(p - 1).ok().and_then(|i| rt.heap.get(i)) {
        h
    } else {
        rt.fault = Some("head of invalid list pointer".to_string());
        0
    }
}

/// `rd <- tail(rl)`. Mirrors `run_asm`'s `Instr::Tail` arm: `p == 0` faults ("tail of empty
/// list"); a dangling pointer faults ("tail of invalid list pointer"); else returns the cell's
/// tail field.
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rt_tail(rt: *mut Runtime, p: u64) -> u64 {
    let rt = unsafe { &mut *rt };
    if rt.stopped() {
        return 0;
    }
    if p == 0 {
        rt.fault = Some("tail of empty list".to_string());
        return 0;
    }
    // See `rt_head`'s comment: `try_from`'s `Err` (32-bit targets only) folds into the same
    // "invalid list pointer" fault a dangling-but-representable `p` already takes.
    if let Some(&(_, t)) = usize::try_from(p - 1).ok().and_then(|i| rt.heap.get(i)) {
        t
    } else {
        rt.fault = Some("tail of invalid list pointer".to_string());
        0
    }
}

/// `rd <- is_empty(rl)`. Mirrors `run_asm`'s `Instr::IsEmpty` arm: `1` if `p == 0`, else `0`.
/// Never faults and never touches the heap, so it is not gated by `stopped` (there is nothing for
/// it to corrupt).
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rt_is_empty(_rt: *mut Runtime, p: u64) -> u64 {
    u64::from(p == 0)
}

/// `rd <- box(rv)`. Mirrors `run_asm`'s `Instr::Box` arm: cap-checks `boxes.len()` against
/// `caps.heap` (the box arena shares the heap cap, matching `vm.boxes.len() as u64 >=
/// vm.caps.heap`), else pushes `v` and returns the new 1-based pointer.
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rt_box(rt: *mut Runtime, v: u64) -> u64 {
    let rt = unsafe { &mut *rt };
    if rt.stopped() {
        return 0;
    }
    if rt.boxes.len() as u64 >= rt.caps.heap {
        rt.hit_cap = true;
        return 0;
    }
    rt.boxes.push(v);
    rt.boxes.len() as u64 // 1-based
}

/// `rd <- box_get(rb)`. Mirrors `run_asm`'s `Instr::BoxGet` arm: `p == 0` faults ("box_get of
/// null handle"); a dangling handle faults ("box_get of invalid handle"); else returns the box's
/// value.
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
// The two quoted fault strings above are the LITERAL fault text (asserted byte-for-byte by
// `box_get_and_set_fault_on_null_and_dangling_handles` below), not code references — an automated
// `doc_markdown` pass once backticked `box_get` inside them, which left the doc's prose matching
// the real bytes but broke the "this is a verbatim literal" convention the quotes signal. Reverted;
// this allow keeps `doc_markdown` from re-adding backticks inside the quoted text.
#[allow(clippy::doc_markdown)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rt_box_get(rt: *mut Runtime, p: u64) -> u64 {
    let rt = unsafe { &mut *rt };
    if rt.stopped() {
        return 0;
    }
    if p == 0 {
        rt.fault = Some("box_get of null handle".to_string());
        return 0;
    }
    // See `rt_head`'s comment: `try_from`'s `Err` (32-bit targets only) folds into the same
    // "invalid handle" fault a dangling-but-representable `p` already takes.
    if let Some(&v) = usize::try_from(p - 1).ok().and_then(|i| rt.boxes.get(i)) {
        v
    } else {
        rt.fault = Some("box_get of invalid handle".to_string());
        0
    }
}

/// `box_set(rb, rv)`. Mirrors `run_asm`'s `Instr::BoxSet` arm: `p == 0` faults ("box_set of null
/// handle"); a dangling handle faults ("box_set of invalid handle"); else overwrites the box in
/// place.
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
// Same corrupted-then-reverted literal as `rt_box_get`: the two quoted strings are the exact fault
// bytes (see `box_get_and_set_fault_on_null_and_dangling_handles`), not code references.
#[allow(clippy::doc_markdown)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rt_box_set(rt: *mut Runtime, p: u64, v: u64) {
    let rt = unsafe { &mut *rt };
    if rt.stopped() {
        return;
    }
    if p == 0 {
        rt.fault = Some("box_set of null handle".to_string());
        return;
    }
    // See `rt_head`'s comment: `try_from`'s `Err` (32-bit targets only) folds into the same
    // "invalid handle" fault a dangling-but-representable `p` already takes.
    match usize::try_from(p - 1).ok().and_then(|i| rt.boxes.get_mut(i)) {
        Some(slot) => *slot = v,
        None => rt.fault = Some("box_set of invalid handle".to_string()),
    }
}

/// Advance the step counter by one, mirroring `run_asm`'s per-instruction step-cap check
/// (`vm.steps`/`vm.caps.steps`). Returns `1` (a trip signal for the generated code to branch on)
/// once `steps` exceeds `caps.steps`, setting `hit_cap`; else `0`.
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rt_tick(rt: *mut Runtime) -> u64 {
    let rt = unsafe { &mut *rt };
    // If a fault (or an earlier cap) has already latched, divert immediately *without* touching
    // `hit_cap`. Otherwise a back-edge reached after a callee faulted would keep ticking `steps`
    // and eventually set `hit_cap`, and the driver (which checks `hit_cap` before `fault`) would
    // misreport a `Fault` run as `HitCap`. Returning `1` sends the generated code to its exit
    // block so the latched `fault` classification survives.
    if rt.stopped() {
        return 1;
    }
    rt.steps += 1;
    if rt.steps > rt.caps.steps {
        rt.hit_cap = true;
        return 1;
    }
    0
}

/// Enter a call frame, incrementing `depth`, mirroring `run_asm`'s `Instr::Call` stack-cap check
/// (`vm.stack.len()`/`vm.caps.stack`) — the JIT-generated code keeps locals on the native call
/// stack rather than a `Vec<Frame>`, so `depth` is the counter that stands in for `stack.len()`.
/// Returns `1` (a trip signal) once `depth` exceeds `depth_cap`, setting `hit_cap`; else `0`.
///
/// The cap is `depth_cap` (the frame-size-aware `min(caps.stack, safe_depth)` the backend supplied),
/// NOT `caps.stack` directly: a program with a fat native frame gets a proportionally shallower cap
/// so recursion trips `HitCap` *before* the real call stack overflows (a process abort). For a
/// small-frame program `depth_cap == caps.stack`, so ordinary deep recursion still runs to the full
/// reference bound.
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rt_enter(rt: *mut Runtime) -> u64 {
    let rt = unsafe { &mut *rt };
    // As in `rt_tick`: once stopped, divert without setting `hit_cap`, so a `Call` reached after a
    // callee faulted cannot mask the latched `fault` as a stack-cap `HitCap`.
    if rt.stopped() {
        return 1;
    }
    rt.depth += 1;
    if rt.depth > rt.depth_cap {
        rt.hit_cap = true;
        return 1;
    }
    0
}

/// Leave a call frame, decrementing `depth`, mirroring `run_asm`'s `Instr::Ret` popping a frame
/// off `vm.stack`. Uses `saturating_sub` so a spurious `rt_leave` (e.g. one emitted on a path the
/// matching `rt_enter` never reached) can never wrap `depth` around — defense in depth, not a case
/// the generated code is expected to hit.
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rt_leave(rt: *mut Runtime) {
    let rt = unsafe { &mut *rt };
    rt.depth = rt.depth.saturating_sub(1);
}

/// Returns `1` if the run has stopped — a fault was latched (`fault.is_some()`) or a cap was hit
/// (`hit_cap`) — else `0`. The JIT-generated code calls this once after each faultable op
/// (`Head`/`Tail`/`BoxGet`/`BoxSet`) and each allocating op (`Cons`/`Box`, which trip `hit_cap` on
/// the heap cap) and `brif`s to its shared fault/cap-exit block on a nonzero result, so a single
/// host call replaces reading both flags back through the pointer.
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rt_faulted(rt: *mut Runtime) -> u64 {
    let rt = unsafe { &*rt };
    u64::from(rt.fault.is_some() || rt.hit_cap)
}

/// Deserialize the CONFIG data blob `redextape_native::aot::emit_object` writes into an AOT
/// object's `redextape_config` data section. The byte layout is a forward contract with
/// `aot::serialize_config`/`serialize_ty` and must be read back byte-for-byte:
///
/// ```text
/// [0..8)   caps.steps  u64 LE
/// [8..16)  caps.stack  u64 LE
/// [16..24) caps.heap   u64 LE
/// [24..32) depth_cap   u64 LE
/// [32..)   Ty, tag-encoded: 0=Nat 1=Bool 2=Unit 3=List<elem follows recursively>
/// ```
pub(crate) mod config {
    use redextape_core::tm::Caps;
    use redextape_core::ty::Ty;

    fn read_u64(b: &[u8], at: usize) -> Option<u64> {
        b.get(at..at + 8)?.try_into().ok().map(u64::from_le_bytes)
    }

    fn read_ty(b: &[u8], at: &mut usize) -> Option<Ty> {
        let tag = *b.get(*at)?;
        *at += 1;
        Some(match tag {
            0 => Ty::Nat,
            1 => Ty::Bool,
            2 => Ty::Unit,
            3 => Ty::List(Box::new(read_ty(b, at)?)),
            _ => return None,
        })
    }

    /// Parse a CONFIG blob into `(caps, depth_cap, ty)`. Returns `None` on malformed input — the
    /// blob is too short for the four `u64`s plus a `Ty`, or the `Ty` carries an unrecognized tag —
    /// so the caller (`rt_run`) can turn a `None` into exit code `4` rather than panicking. Any
    /// bytes past the decoded `Ty` are tolerated and ignored (not treated as an error).
    pub fn deserialize(b: &[u8]) -> Option<(Caps, u64, Ty)> {
        let steps = read_u64(b, 0)?;
        let stack = read_u64(b, 8)?;
        let heap = read_u64(b, 16)?;
        let depth = read_u64(b, 24)?;
        let mut at = 32;
        let ty = read_ty(b, &mut at)?;
        // caps.mem has no native analog (see the JIT driver note); default it.
        Some((Caps { steps, stack, heap, mem: u64::MAX }, depth, ty))
    }
}

/// Classify + render a finished run. `outcome` is `Some` iff the run produced a value (not a
/// fault/cap). Returns the process exit code: 0 value, 2 fault, 3 cap, 4 internal/decode failure.
///
/// Two writers keep the "value → stdout; everything else → stderr" contract: the decoded value is
/// the ONLY thing written to `out` (a caller can grep `out` for the result unambiguously), while a
/// cap trip or a decode failure is a diagnostic and goes to `err`. Pure and `Write`-generic so it
/// is unit-testable without spawning a thread or capturing real stdout/stderr; `rt_run` wires in
/// the real `Runtime` and `std::io::stdout()`/`stderr()`. The fault path (which carries a `String`
/// message) is handled directly in `rt_run` instead of here, since `outcome`/`hit_cap` alone can't
/// distinguish "faulted" from "internal decode failure" — both would otherwise collapse to
/// `outcome: None`.
pub(crate) fn print_outcome(
    outcome: Option<AsmOutcome>,
    hit_cap: bool,
    ty: &Ty,
    out: &mut dyn std::io::Write,
    err: &mut dyn std::io::Write,
) -> i32 {
    if hit_cap {
        let _ = writeln!(err, "hit cap");
        return 3;
    }
    // `outcome: None` is unreachable via `rt_run` (it handles the `fault`/thread-failure cases
    // before ever calling `print_outcome`, and only ever passes `Some(outcome)` here) — kept as a
    // defensive exit-4 so `print_outcome` is total for any caller.
    let Some(o) = outcome else { return 4 };
    if let Some(v) = redextape_core::tm::decode_asm_ty(&o, ty) {
        // The value is the sole thing on `out` (stdout) — exit 0.
        let _ = writeln!(out, "{}", redextape_core::value::format_value(&v));
        0
    } else {
        // Decode failure is a diagnostic → `err` (stderr), NOT `out`, so it can't be mistaken
        // for a value by a caller grepping stdout — exit 4.
        let _ = writeln!(err, "internal: could not decode result");
        4
    }
}

/// Reserved native-stack size for a run thread — the SINGLE SOURCE OF TRUTH shared by both the JIT
/// driver (`redextape_native::jit`, which spawns its compile+run thread with this stack size) and
/// this crate's own `rt_run` (which spawns the AOT run thread with it). `redextape-native`'s
/// emit-time `codegen::native_depth_cap` computation bakes a frame-size-aware recursion-depth cap
/// into the AOT CONFIG blob sized against exactly this constant (re-exported from this crate rather
/// than duplicated, since `redextape-native` already depends on `redextape-native-rt`), so the two
/// can never drift out of sync: recursion always trips `HitCap` before the OS stack overflows,
/// whether the code is running under the JIT or as a linked AOT binary.
pub const RUN_STACK_SIZE: usize = 512 << 20;

/// The AOT binary's entry point (called by the emitted `main`). Deserializes CONFIG, runs `main_fn`
/// on a big reserved stack with the emit-time frame-size-aware `depth_cap`, then decodes + prints the
/// result and returns the process exit code. Total: deep recursion → cap (exit 3), fault → exit 2,
/// a malformed CONFIG or a run-thread failure → exit 4 — `rt_run` never panics.
///
/// # Safety
/// `main_fn` must be the finalized `$main` (`extern "C" fn(*mut Runtime) -> u64`); `config_ptr`/
/// `config_len` must describe a CONFIG blob produced by `emit_object`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rt_run(
    main_fn: extern "C" fn(*mut Runtime) -> u64,
    config_ptr: *const u8,
    config_len: u64,
) -> i32 {
    // No producer IN THIS TREE supplies `config_len` from anywhere but `aot::emit_object`'s own
    // `config.len() as i64` (see that function), baked into the emitted object as a compile-time
    // constant and widened back to u64 for this `extern "C"` signature — that blob is 32 bytes of
    // `Caps`/`depth_cap` plus a handful of `Ty` tag bytes (`aot::serialize_ty`), so it can never
    // approach `usize::MAX` from that path. This symbol is `#[unsafe(no_mangle)]` in a `staticlib`
    // built for foreign linking, though, so nothing stops an external caller from passing something
    // else: a `config_len` this cast does not represent losslessly still only reaches
    // `config::deserialize` on a short slice, which exits 4 rather than reading out of bounds.
    #[allow(clippy::cast_possible_truncation)]
    let bytes = unsafe { std::slice::from_raw_parts(config_ptr, config_len as usize) };
    let Some((caps, depth_cap, ty)) = config::deserialize(bytes) else {
        eprintln!("internal: malformed AOT config");
        return 4;
    };
    // Run on a big reserved stack so the emit-time depth_cap trips before the OS stack overflows.
    let run = std::thread::Builder::new().stack_size(RUN_STACK_SIZE).spawn(move || {
        let mut rt = Runtime::with_depth_cap(caps, depth_cap);
        let word = main_fn(&raw mut rt);
        (rt.hit_cap, rt.fault.take(), rt.into_outcome(word))
    });
    let Ok((hit_cap, fault, outcome)) = run.and_then(|h| h.join().map_err(|_| std::io::Error::other("panic"))) else {
        eprintln!("internal: AOT run thread failed");
        return 4;
    };
    if hit_cap {
        return print_outcome(None, true, &ty, &mut std::io::stdout(), &mut std::io::stderr());
    }
    if let Some(msg) = fault {
        eprintln!("fault: {msg}");
        return 2;
    }
    print_outcome(Some(outcome), false, &ty, &mut std::io::stdout(), &mut std::io::stderr())
}

#[cfg(test)]
mod tests {
    use super::*;
    use redextape_core::tm::DEFAULT_CAPS;

    fn rt() -> Runtime {
        Runtime::new(DEFAULT_CAPS)
    }

    #[test]
    fn cons_then_head_and_tail() {
        let mut r = rt();
        let p = unsafe { rt_cons(&mut r, 7, 0) }; // cons(7, nil)
        assert_eq!(p, 1);
        assert_eq!(unsafe { rt_head(&mut r, p) }, 7);
        assert_eq!(unsafe { rt_tail(&mut r, p) }, 0);
        assert_eq!(unsafe { rt_is_empty(&mut r, p) }, 0);
        assert_eq!(unsafe { rt_is_empty(&mut r, 0) }, 1);
        assert!(r.fault.is_none() && !r.hit_cap);
    }

    #[test]
    fn box_roundtrip_and_in_place_set() {
        let mut r = rt();
        let b = unsafe { rt_box(&mut r, 5) };
        assert_eq!(unsafe { rt_box_get(&mut r, b) }, 5);
        unsafe { rt_box_set(&mut r, b, 9) };
        assert_eq!(unsafe { rt_box_get(&mut r, b) }, 9);
    }

    #[test]
    fn head_of_nil_and_dangling_fault() {
        let mut r = rt();
        let _ = unsafe { rt_head(&mut r, 0) };
        assert!(r.fault.is_some());
        let mut r2 = rt();
        let _ = unsafe { rt_tail(&mut r2, 99) }; // dangling
        assert!(r2.fault.is_some());
    }

    #[test]
    fn box_get_and_set_fault_on_null_and_dangling_handles() {
        // null handle (0)
        let mut r = rt();
        let _ = unsafe { rt_box_get(&mut r, 0) };
        assert_eq!(r.fault.as_deref(), Some("box_get of null handle"));
        let mut r = rt();
        unsafe { rt_box_set(&mut r, 0, 1) };
        assert_eq!(r.fault.as_deref(), Some("box_set of null handle"));
        // dangling handle (5 into an empty box store)
        let mut r = rt();
        let _ = unsafe { rt_box_get(&mut r, 5) };
        assert_eq!(r.fault.as_deref(), Some("box_get of invalid handle"));
        let mut r = rt();
        unsafe { rt_box_set(&mut r, 5, 1) };
        assert_eq!(r.fault.as_deref(), Some("box_set of invalid handle"));
    }

    #[test]
    fn cons_and_box_trip_the_heap_cap() {
        // A `heap` cap of 1 lets the first alloc through and trips the second (matching `run_asm`).
        let mut r = Runtime::new(Caps { heap: 1, ..DEFAULT_CAPS });
        assert_eq!(unsafe { rt_cons(&mut r, 7, 0) }, 1); // fills the sole slot
        assert_eq!(unsafe { rt_cons(&mut r, 8, 0) }, 0); // trips
        assert!(r.hit_cap);

        let mut r = Runtime::new(Caps { heap: 1, ..DEFAULT_CAPS });
        assert_eq!(unsafe { rt_box(&mut r, 7) }, 1);
        assert_eq!(unsafe { rt_box(&mut r, 8) }, 0);
        assert!(r.hit_cap);
    }

    #[test]
    fn rt_faulted_reflects_fault_and_cap_flags() {
        let mut r = rt();
        assert_eq!(unsafe { rt_faulted(&mut r) }, 0);
        let _ = unsafe { rt_head(&mut r, 0) }; // latches a fault
        assert_eq!(unsafe { rt_faulted(&mut r) }, 1);
        let mut r = Runtime::new(Caps { heap: 0, ..DEFAULT_CAPS });
        let _ = unsafe { rt_cons(&mut r, 1, 0) }; // trips the heap cap
        assert_eq!(unsafe { rt_faulted(&mut r) }, 1);
    }

    #[test]
    fn tick_and_enter_divert_without_latching_hit_cap_when_already_stopped() {
        // After a fault latches, a subsequent back-edge (`rt_tick`) or `Call` (`rt_enter`) must
        // return the `1` divert signal WITHOUT setting `hit_cap`, so the driver still classifies
        // the run as `Fault`, not `HitCap` (regression for the fault-masked-as-HitCap bug).
        let mut r = rt();
        let _ = unsafe { rt_head(&mut r, 0) }; // latch a fault
        assert!(r.fault.is_some());
        let steps_before = r.steps;
        assert_eq!(unsafe { rt_tick(&mut r) }, 1);
        assert_eq!(unsafe { rt_enter(&mut r) }, 1);
        assert!(!r.hit_cap, "a latched fault must not be reclassified as a cap trip");
        assert_eq!(r.steps, steps_before, "rt_tick must not advance steps once stopped");
        assert_eq!(r.depth, 0, "rt_enter must not grow depth once stopped");
    }

    #[test]
    fn tick_and_enter_hit_their_caps() {
        let mut r = Runtime::new(Caps { steps: 3, stack: 2, ..DEFAULT_CAPS });
        for _ in 0..3 {
            assert_eq!(unsafe { rt_tick(&mut r) }, 0);
        }
        assert_eq!(unsafe { rt_tick(&mut r) }, 1); // 4th tick trips steps=3
        assert!(r.hit_cap);
        let mut r2 = Runtime::new(Caps { steps: 999, stack: 2, ..DEFAULT_CAPS });
        assert_eq!(unsafe { rt_enter(&mut r2) }, 0);
        assert_eq!(unsafe { rt_enter(&mut r2) }, 0);
        assert_eq!(unsafe { rt_enter(&mut r2) }, 1); // 3rd enter trips stack=2
    }

    #[test]
    fn config_roundtrips() {
        // Bytes must match aot::serialize_config exactly. Build them the same way here.
        let caps = Caps { steps: 10, stack: 20, heap: 30, mem: 40 };
        let mut bytes = Vec::new();
        for w in [caps.steps, caps.stack, caps.heap, 7u64] {
            bytes.extend_from_slice(&w.to_le_bytes());
        }
        bytes.push(3);
        bytes.push(0); // List<Nat>
        let (c, depth, ty) = super::config::deserialize(&bytes).unwrap();
        assert_eq!((c.steps, c.stack, c.heap), (10, 20, 30));
        assert_eq!(depth, 7);
        assert_eq!(ty, redextape_core::ty::Ty::List(Box::new(redextape_core::ty::Ty::Nat)));
    }

    #[test]
    fn print_outcome_formats_and_exit_codes() {
        use redextape_core::ty::Ty;
        // Ran → value on `out`, nothing on `err`, exit 0.
        let mut out = Vec::new();
        let mut err = Vec::new();
        let code =
            super::print_outcome(Some(AsmOutcome { result: 5, heap: vec![] }), false, &Ty::Nat, &mut out, &mut err);
        assert_eq!((code, String::from_utf8(out).unwrap()), (0, "5\n".to_string()));
        assert!(err.is_empty(), "value run must write nothing to stderr");
        // Cap → "hit cap" on `err`, nothing on `out`, exit 3.
        let mut out = Vec::new();
        let mut err = Vec::new();
        assert_eq!(super::print_outcome(None, true, &Ty::Nat, &mut out, &mut err), 3);
        assert_eq!(String::from_utf8(err).unwrap(), "hit cap\n");
        assert!(out.is_empty(), "cap trip must write nothing to stdout");
        // Fault → exit 2 (handled directly in `rt_run`, not via `print_outcome`).
    }

    #[test]
    fn print_outcome_routes_decode_failure_to_stderr_not_stdout() {
        use redextape_core::ty::Ty;
        // A `Bool` result whose word is 7 (not 0/1) fails `decode_asm_ty`. The failure is a
        // diagnostic: it must go to `err` (exit 4) and leave `out` EMPTY, so a caller grepping
        // stdout can never mistake it for a value. (This directly guards the misrouting bug.)
        let mut out = Vec::new();
        let mut err = Vec::new();
        let code =
            super::print_outcome(Some(AsmOutcome { result: 7, heap: vec![] }), false, &Ty::Bool, &mut out, &mut err);
        assert_eq!(code, 4);
        assert!(out.is_empty(), "decode failure must write NOTHING to stdout");
        assert_eq!(String::from_utf8(err).unwrap(), "internal: could not decode result\n");
    }
}
