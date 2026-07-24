//! The native backend's runtime: heap/box arenas plus the `extern "C"` host functions the
//! JIT-generated code (Task 4) calls for heap allocation, faults, and cap checks. Semantics
//! mirror `redextape_core::tm::asm::run_asm`'s `Cons`/`Head`/`Tail`/`IsEmpty`/`Box`/`BoxGet`/
//! `BoxSet` arms EXACTLY: 1-based heap/box pointers, `0` = nil, the same fault and cap
//! conditions. This is what lets the native backend reuse `decode_asm` and agree with the asm
//! interpreter in the oracle.

use redextape_core::tm::{AsmOutcome, Caps};

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
    /// worst-case frames fit in the JIT thread's reserved stack (see `cranelift_backend`). This
    /// guarantees the depth cap always trips *before* the native stack overflows, for any program —
    /// no process abort. `Runtime::new` defaults it to `caps.stack` (the depth-only bound) for
    /// callers with no frame-size knowledge (e.g. `runtime.rs` unit tests).
    pub depth_cap: u64,
    pub fault: Option<String>,
    pub hit_cap: bool,
}

impl Runtime {
    /// A runtime whose depth cap is just `caps.stack` (no frame-size awareness). Used by the
    /// `rt_*` unit tests; the JIT driver uses `with_depth_cap` instead.
    pub fn new(caps: Caps) -> Runtime {
        Runtime::with_depth_cap(caps, caps.stack)
    }

    /// A runtime whose recursion-depth limit is `depth_cap` — the frame-size-aware
    /// `min(caps.stack, safe_depth)` the JIT backend computes so `rt_enter` trips before the native
    /// stack is exhausted.
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
pub unsafe extern "C" fn rt_head(rt: *mut Runtime, p: u64) -> u64 {
    let rt = unsafe { &mut *rt };
    if rt.stopped() {
        return 0;
    }
    if p == 0 {
        rt.fault = Some("head of empty list".to_string());
        return 0;
    }
    match rt.heap.get((p - 1) as usize) {
        Some(&(h, _)) => h,
        None => {
            rt.fault = Some("head of invalid list pointer".to_string());
            0
        }
    }
}

/// `rd <- tail(rl)`. Mirrors `run_asm`'s `Instr::Tail` arm: `p == 0` faults ("tail of empty
/// list"); a dangling pointer faults ("tail of invalid list pointer"); else returns the cell's
/// tail field.
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
pub unsafe extern "C" fn rt_tail(rt: *mut Runtime, p: u64) -> u64 {
    let rt = unsafe { &mut *rt };
    if rt.stopped() {
        return 0;
    }
    if p == 0 {
        rt.fault = Some("tail of empty list".to_string());
        return 0;
    }
    match rt.heap.get((p - 1) as usize) {
        Some(&(_, t)) => t,
        None => {
            rt.fault = Some("tail of invalid list pointer".to_string());
            0
        }
    }
}

/// `rd <- is_empty(rl)`. Mirrors `run_asm`'s `Instr::IsEmpty` arm: `1` if `p == 0`, else `0`.
/// Never faults and never touches the heap, so it is not gated by `stopped` (there is nothing for
/// it to corrupt).
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
pub unsafe extern "C" fn rt_is_empty(_rt: *mut Runtime, p: u64) -> u64 {
    u64::from(p == 0)
}

/// `rd <- box(rv)`. Mirrors `run_asm`'s `Instr::Box` arm: cap-checks `boxes.len()` against
/// `caps.heap` (the box arena shares the heap cap, matching `vm.boxes.len() as u64 >=
/// vm.caps.heap`), else pushes `v` and returns the new 1-based pointer.
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
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
pub unsafe extern "C" fn rt_box_get(rt: *mut Runtime, p: u64) -> u64 {
    let rt = unsafe { &mut *rt };
    if rt.stopped() {
        return 0;
    }
    if p == 0 {
        rt.fault = Some("box_get of null handle".to_string());
        return 0;
    }
    match rt.boxes.get((p - 1) as usize) {
        Some(&v) => v,
        None => {
            rt.fault = Some("box_get of invalid handle".to_string());
            0
        }
    }
}

/// `box_set(rb, rv)`. Mirrors `run_asm`'s `Instr::BoxSet` arm: `p == 0` faults ("box_set of null
/// handle"); a dangling handle faults ("box_set of invalid handle"); else overwrites the box in
/// place.
///
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
pub unsafe extern "C" fn rt_box_set(rt: *mut Runtime, p: u64, v: u64) {
    let rt = unsafe { &mut *rt };
    if rt.stopped() {
        return;
    }
    if p == 0 {
        rt.fault = Some("box_set of null handle".to_string());
        return;
    }
    match rt.boxes.get_mut((p - 1) as usize) {
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
pub unsafe extern "C" fn rt_faulted(rt: *mut Runtime) -> u64 {
    let rt = unsafe { &*rt };
    u64::from(rt.fault.is_some() || rt.hit_cap)
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
}
