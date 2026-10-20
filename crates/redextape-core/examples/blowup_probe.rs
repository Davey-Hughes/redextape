//! Logical-vs-physical blow-up probe for the `Rc`-backed `LambdaTerm`. This is a hazard demonstrator, not a
//! benchmark: its `oom` section is built to look for the size at which the reducer stops making progress.
//! Read the "how to run this" block below before running it.
//!
//! `LambdaTerm` is `struct LambdaTerm(Rc<Node>)`, so one allocation can be reached by more than one
//! edge. Every consumer in this crate that walks a term walks the LOGICAL expansion — it descends into
//! both children of every `App` without asking whether they are one allocation — so a term whose
//! logical size exceeds its physical size costs the walker the LOGICAL number.
//!
//!   * PART 1 — the hazard exists at all. `c = app(c.clone(), c)`, n times: n+1 allocations,
//!     2^(n+1)-1 logical nodes. Which consumers pay the logical number, and at which n do they cross
//!     a 2-second budget? The two that do not pay it are `c == c.clone()` (one pointer comparison at any
//!     n) and `drop`, which is Θ(physical).
//!   * PART 2 — is the shape reachable from a source program? The only path a user controls is
//!     parse -> desugar -> Core -> `lower` -> reduce, so this ramps a family of source programs and
//!     measures the ratio of the term `lower` returns. The multiplier is `lower_group`'s `group.clone()` —
//!     it clones the whole group term once per member of a mutually recursive `fn` group — and it NESTS,
//!     because a member's body is a block that can declare its own group.
//!
//! `lower` refuses no term for its logical size, so every ramp here runs to its own budget. Why `lower`
//! has no shared-subterm guard is in `examples/guard_hole_probe.rs` and the design's §10. The `--tm`
//! section goes through `lower_asm`, not `lower`.
//!
//! MEASURED WITHOUT MATERIALIZING ANYTHING. Sizes come from `lambda::term::logical_size`, a memoized
//! fold over the DAG, O(one visit per allocation) — NOT a walk of the logical tree — so the ratio of a
//! term with 2^40 logical nodes is computed in microseconds and the process never holds more than the
//! term itself. The timed ramps are the only place a logical walk actually runs, and each stops at the
//! first size over budget. Measuring the natural way — walking it — is the very thing that is
//! exponential.
//!
//! That fold SATURATES at `u64::MAX`, so this family's rows past ~56 levels read
//! `>=2^64 (SATURATED)`: a floor reported as a floor. See `fmt_count`.
//!
//! EVERY RAMP STEPS BY ONE. A size parameter that doubles the work per increment cannot be bisected:
//! the first jump past the budget is also the one that never returns. Each row is flushed before the
//! next size is computed, so an interrupted run still reports everything it established.
//!
//! # How to run this
//!
//! EVERY RUN GOES UNDER A CGROUP CAP. Not just `oom` — all of them, so the habit does not depend on
//! remembering which section is the dangerous one:
//!
//! ```text
//! # part1 + part2, the sections that are allocation-bounded by construction
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example blowup_probe -p redextape-core
//!
//! # cursor-driven stepping, node-ceilinged
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example blowup_probe -p redextape-core -- step
//!
//! # ONE CURSOR step (depth guard + β-step) per level, against logical size. An OOM kill is a
//! # result; the cap is what makes it a bounded one.
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example blowup_probe -p redextape-core -- --beta-curve
//!
//! # the same family through the TM backend, to check it has no analogous hazard
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example blowup_probe -p redextape-core -- --tm
//!
//! # the failure boundary. RUNS FOR AS LONG AS YOU LET IT. This section ramps until something
//! # gives. Never run this without the cap.
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example blowup_probe -p redextape-core -- oom
//! ```
//!
//! `MemorySwapMax=0` is not decoration. The cap alone lets the kernel push the excess to swap, which
//! turns a bounded failure into an unbounded one.
//!
//! `reduce_trace` IS NEVER CALLED HERE and MUST NOT BE ADDED: it materializes every step's term by
//! contract (the Plan 4 design), and on a term of this shape each of those terms is itself unbounded,
//! so the cgroup cap has nothing to bite on before the machine does.
//! `trace::LambdaCursor` is the O(1) stepper, and it is what the `step` and `oom` sections use.
//!
//! Nothing here is a test and nothing here is wired into CI: CI compiles examples
//! (`cargo clippy --workspace --all-targets`) and does not run them, which for this target is the
//! intended arrangement rather than a gap. It is committed so the finding in the design's §10 has a
//! re-runnable repro instead of a quoted number.
//!
//! # ALLOCATOR
//!
//! This target sets `mimalloc` as its global allocator, so a timing taken here is not comparable with one
//! taken under glibc's malloc. Node counts, allocation counts and step counts are properties of the
//! reduction, not of the machine, and do not depend on it.
//!
//! The reducer allocates one `Rc<Node>` per term node and frees on the same order, and glibc's layout for
//! that pattern costs real address-translation pressure.
//!
//! `mimalloc` is a `[dev-dependencies]` entry and reaches examples and tests ONLY.
//! `redextape-core`'s `[dependencies]` stays WASM-clean: `libmimalloc-sys` is C that does
//! not build for wasm32, and a library must not choose a global allocator for its consumers.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::collections::HashSet;
use std::hint::black_box;
use std::time::Instant;

use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::lambda::reduce::MAX_TERM_DEPTH;
use redextape_core::lambda::term::{LambdaTerm, Node, app, logical_size, var};
use redextape_core::lambda::{MAX_REDUCTION_STEPS, lower, parse_lambda, print_lambda};
use redextape_core::parser::parse;
use redextape_core::tm::{LowerError, TM_DEFAULT_CAPS, TmCaps, TmRun, Unary, defunc, lower_asm, n_slots_of, run_tm};
use redextape_core::trace::LambdaCursor;

#[path = "common/allocator.rs"]
mod allocator;
#[path = "common/depth.rs"]
mod depth;
#[path = "common/nested_groups.rs"]
mod nested_groups;
#[path = "common/text.rs"]
mod text;

use depth::depth;
use nested_groups::nested_groups_src;
use text::{head, line};

/// Per-size wall-clock budget. A ramp stops at the FIRST size that exceeds it — the next size would
/// double the work, so "one more, to be sure" is exactly the step that does not return.
const BUDGET_S: f64 = 2.0;

/// Per-level budget for the β-step curve, which is slower per point than every other ramp here and so
/// gets its own. CHECKED AFTER THE STEP, because a β-step cannot be interrupted from outside it — the
/// level that crosses this budget is therefore the last row printed, and the level after it is the one
/// that does not return. That overshoot is the measurement, not a defect in the harness.
const BETA_BUDGET_S: f64 = 10.0;

/// Hard ceiling on every ramp. At n=64 the doubling chain has 2^65 logical nodes; nothing that walks
/// it logically can finish, so a ramp that reaches this bound has proved its consumer does not.
const MAX_N: u32 = 64;

/// Stop the `print_lambda` ramp once its output passes this. Output is proportional to LOGICAL size,
/// so the next size is twice this and nothing here may be allowed to reach for a gigabyte.
const MAX_PRINT_BYTES: usize = 1 << 20;

// --- measurement primitives (`physical` and `depth`: O(one visit per allocation), neither walks the logical tree) ---

/// Distinct `Rc` allocations reachable from `t`. `t` is borrowed for the whole walk, so every
/// `alloc_id()` compared here belongs to a live allocation (see `LambdaTerm::alloc_id`'s doc).
fn physical(t: &LambdaTerm) -> usize {
    let mut seen: HashSet<usize> = HashSet::new();
    let mut stack: Vec<&LambdaTerm> = vec![t];
    while let Some(n) = stack.pop() {
        if !seen.insert(n.alloc_id()) {
            continue; // already counted this allocation; its subtree is counted with it
        }
        match n.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => stack.push(b),
            Node::App(f, a, _) => {
                stack.push(f);
                stack.push(a);
            }
        }
    }
    seen.len()
}

/// The logical-tree walk a depth check does without a stored depth. `lambda::reduce::depth_exceeds`,
/// which `trace::LambdaCursor` calls BEFORE EVERY STEP, is a `u32` compare against the stored depth,
/// and is `pub(crate)` and so unreachable from an example target. The `LambdaCursor` ramp below
/// measures the real one end-to-end as a cross-check.
fn depth_exceeds(t: &LambdaTerm, limit: u32) -> bool {
    let mut stack: Vec<(&LambdaTerm, u32)> = vec![(t, 0)];
    while let Some((node, d)) = stack.pop() {
        if d > limit {
            return true;
        }
        match node.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => stack.push((b, d + 1)),
            Node::App(f, a, _) => {
                stack.push((f, d + 1));
                stack.push((a, d + 1));
            }
        }
    }
    false
}

/// Render a `logical_size` result. `u64::MAX` is a FLOOR, not a count — the shared fold saturates
/// there — so it prints as saturation rather than as a number a reader could quote. The family below
/// crosses `u64` at about 56 nesting levels, so this is reached in ordinary use of this target rather
/// than only in principle.
fn fmt_count(v: u64) -> String {
    if v == u64::MAX {
        ">=2^64 (SATURATED)".to_string()
    } else if v < 1_000_000_000_000_000 {
        format!("{v}")
    } else {
        format!("{:.3e} (2^{:.1})", v as f64, (v as f64).log2())
    }
}

/// The logical/physical ratio, or a floor on it once the logical measurement has saturated. A
/// saturated ratio printed as a bare number is a `u64::MAX` artefact wearing a measurement's clothes.
fn fmt_ratio(l: u64, p: usize) -> String {
    let r = l as f64 / p as f64;
    if l == u64::MAX { format!(">={r:.2}x") } else { format!("{r:.2}x") }
}

/// Run `f` at sizes 1, 2, 3, … Each row is flushed before the next size is computed, and the ramp
/// stops at the first size over budget (or when `f` reports its own guard). `f` returns the time it
/// wants judged on, so construction cost is never counted against the consumer being measured.
fn ramp(label: &str, note: &str, mut f: impl FnMut(u32) -> (f64, String, bool)) {
    line("");
    line(&format!("--- {label} ---"));
    line(&format!("    {note}"));
    for n in 1..=MAX_N {
        let (secs, row, guard) = f(n);
        line(&format!("  n={n:<4} {secs:>11.6}s  {row}"));
        if secs > BUDGET_S {
            line(&format!("  STOP: n={n} exceeded the {BUDGET_S:.0}s budget; n={} would be twice that", n + 1));
            return;
        }
        if guard {
            line(&format!("  STOP: n={n} hit this ramp's own guard"));
            return;
        }
    }
    line(&format!("  STOP: reached MAX_N={MAX_N} without exceeding the budget"));
}

// --- part 1: the hand-built doubling chain -------------------------------------------------------

/// `c = app(c.clone(), c)`, n times. n+1 allocations; 2^(n+1)-1 logical nodes. O(n) memory to build
/// and to hold — the whole point is that the physical object is tiny.
fn doubling_chain(n: u32) -> LambdaTerm {
    let mut c = var(0);
    for _ in 0..n {
        c = app(c.clone(), c);
    }
    c
}

fn part1() {
    head("PART 1 — the hazard, hand-built");
    let c = doubling_chain(20);
    line(&format!(
        "  shape check at n=20: physical={} logical={} depth={} (expected 21 / 2097151 / 20)",
        physical(&c),
        fmt_count(logical_size(&c)),
        depth(&c)
    ));
    drop(c);

    // The walk above is the thing measured; `reduce.rs` runs a `u32` compare.
    ramp(
        "depth_exceeds(t, MAX_TERM_DEPTH)",
        "this example's logical-tree walk; the cursor's own check, `reduce.rs`'s `depth_exceeds`, reads a stored depth",
        |n| {
            let c = doubling_chain(n);
            let t0 = Instant::now();
            let over = black_box(depth_exceeds(&c, MAX_TERM_DEPTH));
            let secs = t0.elapsed().as_secs_f64();
            (secs, format!("physical={:<5} logical={:<22} exceeds={over}", n + 1, fmt_count(logical_size(&c))), false)
        },
    );

    ramp(
        "LambdaCursor::next() — the real pipeline",
        "depth guard + reduce_step; the chain has no redex, so this allocates nothing and returns None",
        |n| {
            let c = doubling_chain(n);
            let mut cur = LambdaCursor::new(&c, MAX_REDUCTION_STEPS);
            let t0 = Instant::now();
            let ev = black_box(cur.next());
            let secs = t0.elapsed().as_secs_f64();
            (secs, format!("event={:?} status={:?} steps={}", ev, cur.status(), cur.steps_taken()), false)
        },
    );

    ramp(
        "c == c.clone() — the ptr_eq fast path",
        "PartialEq's Rc::ptr_eq short-circuit; both sides are ONE allocation, so this must fire at the root",
        |n| {
            let c = doubling_chain(n);
            let d = c.clone();
            let t0 = Instant::now();
            let eq = black_box(c == d);
            let secs = t0.elapsed().as_secs_f64();
            (secs, format!("eq={eq} (same allocation)"), false)
        },
    );

    ramp(
        "c == d — structurally equal, separately built",
        "the ptr_eq path cannot fire; PartialEq's structural match walks both logical trees",
        |n| {
            let c = doubling_chain(n);
            let d = doubling_chain(n);
            let t0 = Instant::now();
            let eq = black_box(c == d);
            let secs = t0.elapsed().as_secs_f64();
            (secs, format!("eq={eq} (distinct allocations, {} + {} of them)", n + 1, n + 1), false)
        },
    );

    ramp(
        "print_lambda(&c)",
        &format!("output is proportional to LOGICAL size; this ramp stops at {MAX_PRINT_BYTES} bytes of output"),
        |n| {
            let c = doubling_chain(n);
            let t0 = Instant::now();
            let s = print_lambda(&c);
            let secs = t0.elapsed().as_secs_f64();
            let bytes = s.len();
            drop(s);
            (secs, format!("output={bytes} bytes for {} allocations", n + 1), bytes > MAX_PRINT_BYTES)
        },
    );

    ramp("drop(c)", "impl Drop for LambdaTerm, claimed to be the ONE traversal bounded by allocation count", |n| {
        let c = doubling_chain(n);
        let t0 = Instant::now();
        drop(black_box(c));
        let secs = t0.elapsed().as_secs_f64();
        (secs, format!("{} allocations freed", n + 1), false)
    });

    // The ramp above only reaches n=64. If `Drop` walked the logical tree, THIS would not return:
    // 2^1001 nodes. It returning at all is the claim's evidence; the time is the shape of it.
    for n in [100u32, 1_000, 10_000] {
        let c = doubling_chain(n);
        let phys = physical(&c);
        let t0 = Instant::now();
        drop(c);
        line(&format!("  drop at n={n:<6} {:>11.6}s  physical={phys} logical=2^{}", t0.elapsed().as_secs_f64(), n + 1));
    }
}

// --- part 2: reachability from a source program --------------------------------------------------

/// parse -> typecheck -> desugar: the front half both backends share. Split out so the λ sections and
/// the TM section below drive the SAME `Core` rather than two pipelines that could quietly differ.
fn core_of(src: &str) -> Option<Core> {
    let (prog, ds) = parse(src);
    if !ds.is_empty() {
        line(&format!("  parse errors: {ds:?}"));
        return None;
    }
    let prog = prog?;
    let diags = redextape_core::typeck::typecheck(&prog);
    if diags.iter().any(|d| d.severity == redextape_core::Severity::Error) {
        line(&format!("  type errors: {diags:?}"));
        return None;
    }
    Some(desugar(&prog))
}

fn lower_src(src: &str) -> Option<LambdaTerm> {
    match lower(&core_of(src)?) {
        Ok(t) => Some(t),
        Err(e) => {
            line(&format!("  lower error: {e:?}"));
            None
        }
    }
}

fn report(label: &str, t: &LambdaTerm) {
    let (p, l, d) = (physical(t), logical_size(t), depth(t));
    line(&format!(
        "  {label:<44} physical={p:<9} logical={:<24} ratio={:>13} depth={d}",
        fmt_count(l),
        fmt_ratio(l, p)
    ));
}

fn part2() {
    head("PART 2 — reachability from source");

    line("");
    line("--- 2a: does parse_lambda introduce sharing? ---");
    for src in ["(\\x. x x) (\\x. x x)", "\\f. (\\x. f (x x)) (\\x. f (x x))", "\\a. \\b. a (a (a b))"] {
        let (t, ds) = parse_lambda(src);
        match t {
            Some(t) => report(&format!("parse_lambda {src:?}"), &t),
            None => line(&format!("  parse_lambda {src:?} failed: {ds:?}")),
        }
    }
    // Round trip: printing a shared term materializes the sharing, and re-parsing it gives a term
    // with as many allocations as the printed text has nodes. This is the sharing hazard's inverse
    // and the reason a printed term is not a cheap way to carry one.
    // Closed (the chain's leaf is `var(0)`, so a binder over it is what makes the text re-parseable —
    // `print_lambda` renders a free index as `?0`, which is deliberately not an identifier).
    let c = redextape_core::lambda::term::abs("x", doubling_chain(8));
    report("hand-built doubling chain, n=8, closed", &c);
    let text = print_lambda(&c);
    let (round, _) = parse_lambda(&text);
    match round {
        Some(r) => report(&format!("  ... printed ({} bytes) and re-parsed", text.len()), &r),
        None => line("  round-trip parse failed"),
    }

    line("");
    line("--- 2b: the corpus baseline (the terms `lower` returns) ---");
    let corpus = [
        ("sum(5)", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"),
        ("while loop", "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc"),
        ("1 + 2 * 3", "1 + 2 * 3"),
        (
            "two mutually recursive fns",
            "fn even(n) { if n == 0 { 1 } else { odd(n - 1) } } fn odd(n) { if n == 0 { 0 } else { even(n - 1) } } even(4)",
        ),
        (
            "three mutually recursive fns",
            "fn a(n) { if n == 0 { 1 } else { b(n - 1) } } fn b(n) { if n == 0 { 2 } else { c(n - 1) } } fn c(n) { if n == 0 { 3 } else { a(n - 1) } } a(5)",
        ),
        (
            "three mutable variables",
            "let mut a = 1; let mut b = 2; let mut c = 3; a = b + c; b = a + c; c = a + b; a = b + c; a",
        ),
    ];
    for (label, src) in corpus {
        match lower_src(src) {
            Some(t) => report(label, &t),
            None => line(&format!("  {label}: did not lower")),
        }
    }

    line("");
    line("--- 2c: nested mutually recursive groups, ramped ---");
    line(&format!("    m=1 source: {}", nested_groups_src(1)));
    ramp(
        "logical/physical of lower()'s output",
        "n = number of NESTED groups; each level is a 2-member SCC declared inside the previous level's `f`",
        |n| {
            let src = nested_groups_src(n - 1);
            let t0 = Instant::now();
            let t = lower_src(&src);
            let secs = t0.elapsed().as_secs_f64();
            match t {
                Some(t) => {
                    let (p, l, d) = (physical(&t), logical_size(&t), depth(&t));
                    (
                        secs,
                        format!(
                            "src={:<7}B physical={p:<8} logical={:<24} ratio={:>13} depth={d}",
                            src.len(),
                            fmt_count(l),
                            fmt_ratio(l, p)
                        ),
                        false,
                    )
                }
                None => (secs, "did not lower".to_string(), true),
            }
        },
    );

    line("");
    line("--- 2d: what a logical-tree depth walk costs on that term ---");
    ramp(
        "depth_exceeds on lower()'s output",
        "this example's logical-tree walk, on the term from 2c; the cursor's own guard reads a stored depth",
        |n| {
            let Some(t) = lower_src(&nested_groups_src(n - 1)) else {
                return (0.0, "did not lower".to_string(), true);
            };
            let l = logical_size(&t);
            let t0 = Instant::now();
            let over = black_box(depth_exceeds(&t, MAX_TERM_DEPTH));
            let secs = t0.elapsed().as_secs_f64();
            (secs, format!("logical={:<24} exceeds={over}", fmt_count(l)), false)
        },
    );

    line("");
    line("--- 2e: and what it costs the printer ---");
    ramp(
        "print_lambda on lower()'s output",
        &format!("stops at {MAX_PRINT_BYTES} bytes of output — the next size doubles it"),
        |n| {
            let Some(t) = lower_src(&nested_groups_src(n - 1)) else {
                return (0.0, "did not lower".to_string(), true);
            };
            let t0 = Instant::now();
            let s = print_lambda(&t);
            let secs = t0.elapsed().as_secs_f64();
            let bytes = s.len();
            drop(s);
            (secs, format!("output={bytes} bytes"), bytes > MAX_PRINT_BYTES)
        },
    );
}

// --- opt-in: drive a cursor, bounded by an explicit node ceiling ----------------------------------

/// The only section that reduces anything. Bounded three ways: the term is only stepped when its
/// logical size is under `LOGICAL_CEILING`, the walk stops the moment the CURRENT term passes
/// `NODE_CEILING` allocations, and the step count is capped. One term is held at a time — the cursor
/// holds exactly one by construction, and nothing here keeps a snapshot.
fn part_step() {
    const LOGICAL_CEILING: u64 = 200_000;
    const NODE_CEILING: usize = 1_000_000;
    const STEP_CAP: u64 = 2_000;

    head("STEP — driving a LambdaCursor over the reachable shape");
    line(&format!(
        "  bounds: logical<{LOGICAL_CEILING} to start, stop at {NODE_CEILING} live allocations or {STEP_CAP} steps"
    ));
    for m in 0..12u32 {
        let Some(t) = lower_src(&nested_groups_src(m)) else { break };
        let l = logical_size(&t);
        if l > LOGICAL_CEILING {
            line(&format!("  m={m}: logical={} over the ceiling — not stepped", fmt_count(l)));
            break;
        }
        let start_phys = physical(&t);
        let mut cur = LambdaCursor::new(&t, STEP_CAP);
        let t0 = Instant::now();
        let mut steps = 0u64;
        let mut peak = start_phys;
        while cur.next().is_some() {
            steps += 1;
            if steps.is_multiple_of(16) {
                let p = physical(cur.term());
                peak = peak.max(p);
                if p > NODE_CEILING {
                    break;
                }
            }
            if t0.elapsed().as_secs_f64() > BUDGET_S {
                break;
            }
        }
        let final_logical = logical_size(cur.term());
        let final_phys = physical(cur.term());
        line(&format!(
            "  m={m:<3} {:>9.4}s steps={steps:<6} start: phys={start_phys} logical={} | end: phys={final_phys} logical={} ratio={} peak_phys={peak} status={:?}",
            t0.elapsed().as_secs_f64(),
            fmt_count(l),
            fmt_count(final_logical),
            fmt_ratio(final_logical, final_phys),
            cur.status()
        ));
    }
}

/// Where the ordinary `lower` -> reduce path stops making progress. Opt-in, and the ONLY section with
/// no bound of its own on what one step may do.
///
/// `m` here counts from 0, so `m`=k is k+1 groups and is level k+1 in PART D's and the design's tables;
/// the two indexings are one apart.
///
/// **The hang this section looks for is not expected to reproduce** (its `part_oom` entry in
/// `docs/superpowers/notes/2026-10-17-code-history-probes.md`): with the `maxfree` short-circuit and
/// β-fusion, `beta` has no outer deep-copy to let one step produce on the order of |body| x |arg| LOGICAL
/// nodes as real allocations — see `examples/shift_cost_probe.rs`. This section is the re-runnable source
/// for the LOWERING figures. **The "not expected" is a prediction, not a measurement** — refuting it means
/// an unbounded reduction run, which this repo's λ-measurement rule requires a hard cgroup cap for.
/// `part_step`'s node ceiling is honest only because it runs at sizes where that product is small.
///
/// So: run this under `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0`. Each `m`
/// prints its "before" line and flushes it BEFORE stepping, so the transcript names the size that is
/// stuck (or that died) whether or not the process survives to report it. The wall budget below is
/// checked BETWEEN steps and so can overshoot badly; that is not a bug in the harness, it is what "a
/// step cannot be interrupted" looks like from outside.
fn part_oom() {
    const STEP_CAP: u64 = 1_000;
    const WALL_S: f64 = 90.0;

    head("OOM — where lower + reduce stops making progress");
    line(&format!("  cursor cap {STEP_CAP} steps, {WALL_S:.0}s per size; no snapshots, one term alive at a time"));
    for m in 0..12u32 {
        let src = nested_groups_src(m);
        let Some(t) = lower_src(&src) else { break };
        line(&format!(
            "  m={m:<3} src={:<5}B start: phys={} logical={} — stepping now",
            src.len(),
            physical(&t),
            fmt_count(logical_size(&t))
        ));
        let mut cur = LambdaCursor::new(&t, STEP_CAP);
        drop(t);
        let t0 = Instant::now();
        let mut steps = 0u64;
        while cur.next().is_some() {
            steps += 1;
            if t0.elapsed().as_secs_f64() > WALL_S {
                break;
            }
        }
        // Deliberately does NOT measure the final term: counting its allocations needs a set as large
        // as the term, which at these sizes is itself a second copy of the problem.
        line(&format!(
            "  m={m:<3} survived  {:>9.3}s steps={steps} status={:?}",
            t0.elapsed().as_secs_f64(),
            cur.status()
        ));
    }
}

// --- part D: what ONE β-step costs, against logical size -----------------------------------------

/// One β-step's wall-clock against the term's logical size, up the nesting family.
///
/// NEVER `reduce_trace`: it materializes every step's term by contract. `LambdaCursor` steps lazily,
/// and this holds ONE term at a time — the cursor's, which is the only one alive once the local handle
/// is dropped below.
///
/// The number this exists to produce is THE LOGICAL SIZE AT WHICH ONE β-STEP STOPS BEING TOLERABLE. No
/// guard in the tree bounds a term's size, so this curve is not a margin against anything.
///
/// The last column times one CURSOR step: `LambdaCursor::next` runs `depth_exceeds` before every step
/// (`trace.rs`). `LambdaTerm` carries `depth` as a construction-time invariant, so that guard is a `u32`
/// comparison and each row is in effect the β-step alone.
///
/// **Do not read this curve as a margin.** This section times the FIRST step, whose cost is set by the
/// term `lower` handed over. The hang a guard would exist to prevent is a LATER step, whose cost is set by
/// what earlier steps have already materialized: a step's output can be |body| x |arg|, and the next step
/// starts from that output, and `part_oom` reduces rather than single-steps. So a bound derived from
/// this curve alone would be calibrated against the wrong step: a growth number transferred from the
/// wrong base (the design's §4).
///
/// `levels` counts GROUPS, so level k is `nested_groups_src(k - 1)` — the same indexing as 2c above
/// and as the design's §4 table, which is what makes this curve and that table one measurement instead
/// of two. Each row is flushed BEFORE the next level is built, because the level that never returns is
/// the one that would have been printed next: an interrupted run still reports everything it established.
fn beta_curve() {
    head("PART D — one cursor step (depth guard + β-step), against logical size");
    line(&format!("  cursor cap 1 step, {BETA_BUDGET_S:.0}s budget per level; no snapshots, one term alive at a time"));
    line("  last column is ONE CURSOR STEP. depth_exceeds is O(1) — LambdaTerm carries `depth` as a");
    line("  construction-time invariant — so the row is the β-step alone.");
    line("");
    line(&format!("  {:>6}  {:>8}  {:>20}  {:>12}", "levels", "source", "logical", "cursor step"));
    for levels in 1..=MAX_N {
        let src = nested_groups_src(levels - 1);
        let Some(term) = lower_src(&src) else {
            line(&format!("  level {levels}: did not lower — stopping"));
            return;
        };
        let logical = logical_size(&term);
        let mut cursor = LambdaCursor::new(&term, 1);
        drop(term); // the cursor cloned it; from here exactly one term is alive
        let t0 = Instant::now();
        let _ = black_box(cursor.next());
        let dt = t0.elapsed().as_secs_f64();
        line(&format!("  {levels:>6}  {:>7}B  {:>20}  {dt:>10.3} s", src.len(), fmt_count(logical)));
        if dt > BETA_BUDGET_S {
            line("");
            line(&format!("  over budget at {levels} levels, {logical} logical nodes."));
            line("  NOTHING BOUNDS THIS, and this curve neither measures nor sizes a guard that would —");
            line("  see guard_hole_probe.rs.");
            return;
        }
    }
}

// --- part E: the same family through the TM backend ----------------------------------------------

/// What actually bounds the SAME family on the TM side. The λ guard's design asserts the TM path
/// cannot diverge the same way, because `lower_asm` / `defunc` produce a `Vec<Instr>` with no
/// structural sharing. This checks it rather than repeating it.
///
/// The STRUCTURAL half is settled by reading the types, and is written down here so the reading is not
/// re-done: `asm::Instr` is a flat enum over `Reg` / `u64` / `String` with no self-reference,
/// `asm::Program` is a `Vec<Instr>` plus a label table, and `core::Core` on the way in is `Box`-owned.
/// Nothing on that path holds an `Rc`, so a program's physical size IS its logical size and there is no
/// ratio to measure.
///
/// WHICH IS WHY THIS PRINTS `code.len()`. The absence of sharing rules out the λ path's failure — a
/// tiny object that silently denotes an astronomical one — but it does NOT rule out the instruction
/// stream itself growing exponentially in this family. That would be a different hazard with a
/// different shape: allocation proportional to what is actually built, failing loudly at lowering time
/// rather than hanging inside one step. Only a measurement tells the two apart.
///
/// The family is LINEAR on this side: `lower_asm` succeeds directly at every level (`defunc` is never
/// reached, so `MAX_DEFUNC_DEPTH` is not what bounds this), with `slots` FLAT at 6-7 and four orders under
/// `MAX_SLOTS`. No refusal fires: not `MAX_SLOTS`, not `TmRun::TooLarge`, not either 580-deep bound.
/// What bounds it is `TmCaps::steps`, reported as `HitCap`, and this family is genuinely non-terminating
/// (`f0` calls `g0` calls `f0`), so `HitCap` is the correct answer rather than a shortfall.
///
/// `HitCap` is returned for the step cap and the live-cell cap alike, so that attribution cannot be
/// inferred from the rows above. The `WHICH CAP` block below raises one cap at a time.
///
/// WHY 5,000,000 STEPS CANNOT TOUCH 500,000,000 CELLS, which is what makes the first row a step cap. One
/// step applies one rule; `sim::apply` writes and moves EVERY tape once, and `Tape::step` extends a tape
/// by at most one cell (a move onto an empty side materializes one `BLANK`). The machine has
/// `build::TAPES` = 5 tapes, and the cap is on the SUM across tapes (`trace.rs`'s `total: usize =
/// self.tapes.iter().map(Tape::cells).sum()`), not per tape — which is the version that has to be checked,
/// since a per-tape argument would be five times weaker than the cap it is defending. Total live cells
/// therefore grow by at most 5 per step, so 5,000,000 steps reach at most ~25,000,000 cells: **20x under
/// 500,000,000.** Real headroom, not a coincidence, but it is 20x rather than unbounded.
///
/// The attribution needs only that the raised-step-cap run is far longer than the default run.
///
/// **The structural reason the step cap works here** is the λ guard's motivation read backwards: a TM
/// transition is O(1), so a cap counted between steps bites within one step's worth of overshoot. A
/// β-step is unbounded and uninterruptible. The unit being counted is bounded on one side and not on
/// the other.
fn tm_check() {
    /// Transcribed from `lower_tm::MAX_SLOTS`, which is `pub(crate)` and so unreachable from an example target.
    const MAX_SLOTS: u32 = 100_000;

    head("TM — the same family through lower_asm / defunc / run_tm");
    line(&format!(
        "  caps: {} steps, {} cells, Unary; MAX_SLOTS={MAX_SLOTS} (lower_asm/defunc's own depth bound is 580)",
        TM_DEFAULT_CAPS.steps, TM_DEFAULT_CAPS.cells
    ));
    for levels in [1u32, 4, 8, 12] {
        let src = nested_groups_src(levels - 1);
        let Some(core) = core_of(&src) else { break };
        let t0 = Instant::now();
        let lowered = match lower_asm(&core) {
            Ok(p) => format!("lower_asm ok: code={} labels={} slots={}", p.code.len(), p.labels.len(), n_slots_of(&p)),
            // `lower_program`'s own order, matched on the SAME variant it matches on: direct first,
            // `defunc` only on `Unsupported`. Reproduced rather than short-circuited, so what this
            // reports is what `run_tm` below actually did.
            Err(e @ LowerError::Unsupported { .. }) => match defunc(&core).and_then(|d| lower_asm(&d)) {
                Ok(p) => format!(
                    "lower_asm {e:?} -> defunc ok: code={} labels={} slots={}",
                    p.code.len(),
                    p.labels.len(),
                    n_slots_of(&p)
                ),
                Err(e2) => format!("lower_asm {e:?} -> defunc {e2:?}"),
            },
            Err(e @ LowerError::TooDeep { .. }) => {
                format!("lower_asm {e:?} (returned directly, as lower_program does)")
            }
        };
        let lower_s = t0.elapsed().as_secs_f64();
        line(&format!("  levels={levels:<3} src={:<5}B {lower_s:>9.4}s  {lowered}", src.len()));

        let t1 = Instant::now();
        // Tapes are bounded by the cells cap but still far too large to print, so the outcome is
        // classified rather than `{:?}`-ed.
        let outcome = match run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS) {
            TmRun::Ran { tapes } => format!("Ran ({} tapes)", tapes.len()),
            TmRun::HitCap => "HitCap".to_string(),
            TmRun::Overflow => "Overflow".to_string(),
            TmRun::TooLarge => "TooLarge".to_string(),
            TmRun::LowerError(e) => format!("LowerError({e:?})"),
        };
        line(&format!("  levels={levels:<3}                {:>9.4}s  run_tm -> {outcome}", t1.elapsed().as_secs_f64()));
    }

    // WHICH cap returned `HitCap`, because nothing above can say. `TmStatus` has exactly two variants
    // and `HitCap` is the answer for the step cap AND for the live-cell cap — `trace.rs`'s `TmCursor`
    // records the two as "genuinely interchangeable: both return `HitCap` with no side effect on
    // either path".
    //
    // The classified outcome printed above therefore names the wall without naming which wall.
    //
    // RAISING ONE CAP AT A TIME SEPARATES THEM. Under a raised cells cap the tape cannot be what
    // stops the run, so a `HitCap` there is the step cap; under a raised step cap it is the cell cap.
    // If both still cap, both are reachable, and the shorter of the two times is the one the default
    // run stops at — a run under both caps stops at whichever arrives first.
    //
    // NEITHER VARIANT LIFTS A CAP, AND THAT IS DELIBERATE. `steps: u64::MAX` is the obvious way to
    // write the first one and is not safe here: this family does not halt, so a run with no step cap
    // returns only if the tape reaches the 5,000,000-cell cap. That is a FINITE target rather than
    // unbounded growth, but it is still a proposition about this family's tape behaviour that nothing
    // here has established, so neither cap is lifted. Each cap is raised 100x instead: both variants
    // terminate by construction, and 5,000,000 cells still bounds the tape's memory.
    line("");
    line("  WHICH CAP: one cap raised 100x at a time, neither lifted (both variants still terminate)");
    let level = 8u32;
    if let Some(core) = core_of(&nested_groups_src(level - 1)) {
        for (label, caps) in [
            ("cells x100 (steps 5,000,000, cells 500,000,000)", TmCaps { steps: 5_000_000, cells: 500_000_000 }),
            ("steps x100 (steps 500,000,000, cells 5,000,000)", TmCaps { steps: 500_000_000, cells: 5_000_000 }),
        ] {
            let t = Instant::now();
            let outcome = match run_tm(&core, &Unary::default(), caps) {
                TmRun::Ran { tapes } => format!("Ran ({} tapes)", tapes.len()),
                TmRun::HitCap => "HitCap".to_string(),
                TmRun::Overflow => "Overflow".to_string(),
                TmRun::TooLarge => "TooLarge".to_string(),
                TmRun::LowerError(e) => format!("LowerError({e:?})"),
            };
            line(&format!("  levels={level:<3} {label:<48} {:>9.4}s  run_tm -> {outcome}", t.elapsed().as_secs_f64()));
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let want = |name: &str| args.is_empty() || args.iter().any(|a| a == name);
    line("blowup_probe — logical vs physical size of an Rc-backed LambdaTerm");
    line(&format!("  MAX_TERM_DEPTH={MAX_TERM_DEPTH}, per-size budget={BUDGET_S}s, ramp ceiling n={MAX_N}"));
    // What a "node" costs, so a node count can be read as memory: one `Rc` allocation is the `Node`
    // plus the strong and weak counts `Rc` stores ahead of it.
    let node = std::mem::size_of::<Node>();
    line(&format!("  size_of::<Node>()={node}B; one Rc allocation is {node}+16={}B", node + 16));
    // Printed, not only documented. This target is a hazard demonstrator and the transcript is the
    // artifact people keep; a transcript that does not carry the running condition invites a re-run
    // without it.
    line("  RUN EVERY SECTION UNDER: systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0");
    if want("part1") {
        part1();
    }
    if want("part2") {
        part2();
    }
    // Opt-in only: this is the one section that allocates in proportion to what it discovers.
    if args.iter().any(|a| a == "step") {
        part_step();
    }
    // Opt-in. Named `oom` because the transcripts and the design's §10 use that name.
    if args.iter().any(|a| a == "oom") {
        part_oom();
    }
    // Opt-in: it ramps until one cursor step is over budget, and a step cannot be interrupted.
    if args.iter().any(|a| a == "--beta-curve") {
        beta_curve();
    }
    if args.iter().any(|a| a == "--tm") {
        tm_check();
    }
}
