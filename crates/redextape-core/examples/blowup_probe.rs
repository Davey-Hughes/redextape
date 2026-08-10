//! Logical-vs-physical blow-up probe for the `Rc`-backed `LambdaTerm`. This is a HAZARD
//! DEMONSTRATOR, not a benchmark: its `oom` section is built to reach the size at which the reducer
//! stops making progress, and it does. Read the "how to run this" block below before running it.
//!
//! `LambdaTerm` is `struct LambdaTerm(Rc<Node>)`, so one allocation can be reached by more than one
//! edge. Every consumer in this crate that walks a term walks the LOGICAL expansion — it descends into
//! both children of every `App` without asking whether they are one allocation — so a term whose
//! logical size exceeds its physical size costs the walker the LOGICAL number. `reduce.rs`'s
//! `depth_exceeds` used to call that shape "impossible under `Box`, merely unreached by the current
//! corpus". This probe measured both halves of that claim, and **the second half was false**:
//!
//!   * PART 1 — the hazard exists at all. `c = app(c.clone(), c)`, n times: n+1 allocations,
//!     2^(n+1)-1 logical nodes. Which consumers pay the logical number, and at which n do they cross
//!     a 2-second budget? ANSWER: all of them but two. `depth_exceeds` crosses at n = 30,
//!     `LambdaCursor::next` at n = 29, `c == d` (separately built, so `ptr_eq` cannot fire) at n = 30,
//!     `print_lambda` produces 2.10 MB at n = 19. The two that are immune are `c == c.clone()` (one
//!     pointer comparison at any n) and `drop` — n = 10,000, a term of 2^10001 logical nodes, freed in
//!     175 µs, which is `Drop`'s Θ(physical) claim demonstrated rather than argued.
//!   * PART 2 — is the shape reachable from a source program? The only path a user controls is
//!     parse -> desugar -> Core -> `lower` -> reduce, so this ramps a family of source programs and
//!     measures the ratio of the term `lower` returns. ANSWER: REACHABLE, from 512 bytes. The
//!     multiplier is `lower_group`'s `group.clone()` — it clones the whole group term once per member of a
//!     mutually recursive `fn` group — and it NESTS, because a member's body is a block that can
//!     declare its own group. 512 bytes lowers in ~196 µs to 1,644 allocations holding 616,152
//!     logical nodes (375x), and reducing that term reaches a β-step that did not finish in 13
//!     minutes at 974 MB. No guard fires: depth 141 against `MAX_TERM_DEPTH` = 3,000, and
//!     `MAX_REDUCTION_STEPS` is never consulted because control does not return from `reduce_step`.
//!
//!     THAT STEP IS NOT THE FIRST ONE, which this file used to say it was. `--beta-curve` (PART D)
//!     times exactly one CURSOR step per size — `depth_exceeds` over the full logical tree, then one
//!     β-step — and gets **50 ms** at those same 616,152 nodes, which makes 50 ms an UPPER BOUND on
//!     that β-step rather than its cost alone; the first step is cheap at every size the family
//!     reaches. The cost accrues ACROSS the run, because a step's output can be |body| x |arg| and the
//!     next step starts from that. Correcting it matters because any guard sized from this curve is
//!     sized against the wrong one otherwise — which is how the first attempt went wrong, and no
//!     guard is in the tree to be sized today. See PART D's doc comment.
//!
//! `lower` REFUSES NOTHING HERE, AND THAT SENTENCE IS A CORRECTION. Between `1652e09` and the revert
//! below it did: `MAX_SHARED_LOGICAL_NODES` = 10,000 on the largest SHARED subterm cut this family off
//! at seven groups, and every λ-side section that ramps it through `lower_src` (2c, 2d, 2e, `step`,
//! `oom`, `--beta-curve`) stopped there printing `lower error: TooShared { .. }`. **That guard was
//! falsified by measurement and reverted** — the mechanism it named is not what `subst` does, and
//! `let xs = [0..500); let ys = [0..500); head(xs) + head(ys)` scores 4 against its bound of 10,000 while
//! spending 19.0 s in one β-step (`examples/guard_hole_probe.rs`, and the design's §10). So every ramp
//! here runs to its own budget again, and `lower` still refuses nothing. The `--tm` section was never
//! affected either way — it goes through `lower_asm`, not `lower`.
//!
//! **~~"the hang this probe demonstrates is open"~~ — CLOSED 2026-08-01, and this probe's own `step`
//! section is what identified the cause.** See the next paragraph, then `examples/shift_cost_probe.rs`.
//! Every LOWERING figure here is unchanged and still re-reachable: `lower` builds the same term it
//! always did, so PART 2's ratios, the 512-byte / 1,644-allocation / 616,152-logical row, and the
//! `--beta-curve` sizes all still hold. What changed is what REDUCING one costs.
//!
//! WHAT THE `step` SECTION IS FOR, since it looks redundant next to `oom`. It showed that reduction
//! cannot COMPOUND the ratio — it MATERIALIZES it: `beta`'s closing `shift(-1, 0, ..)` rebuilt every
//! node it visited, so a β-step's output aliased nothing, and the within-term ratio was exactly 1.00x
//! after ≥6 steps from starting ratios up to 114x. The compact term was never small; it was a promise
//! to allocate, and the reducer kept it.
//!
//! **THAT WAS THE ROOT CAUSE, RECORDED HERE AS A SYMPTOM FOR A DAY BEFORE ANYONE READ IT THAT WAY.**
//! "a β-step's output aliases nothing" is not a fact about β-reduction; it is a fact about a `shift`
//! that rebuilt unconditionally — Θ(logical) rather than Θ(physical), and sharing-destroying, since
//! `shift(App(c, c))` recursed twice and built two copies of `c`. `lower_group`'s duplication only
//! writes the promise; `shift` was what cashed it, on every step. `term.rs` now carries a `maxfree` per
//! handle and both `shift` and `subst` return their argument's ALLOCATION when no free index is in
//! range. **RE-RUN THIS SECTION: the 1.00x figure above is the pre-fix measurement and is not expected
//! to reproduce.** The two-list counterexample went from 19.0 s in its first β-step to 0.002 s, and the
//! 512-byte program that did not finish one β-step in 13 minutes ran 105,607 steps in 195.7 s.
//!
//! **`depth_exceeds` was then 96% of what remained** — 187.6 s of that 195.7 s — for the same reason
//! one function over: it walked the logical expansion, once per step. `LambdaTerm` now carries `depth`
//! beside `maxfree`, so that guard is a `u32` comparison. The same program is **7.48 s**, and the ramp
//! is FLAT at 7.5–9.0 s across all eleven levels. **`--beta-curve`'s timings are all pre-fix**; the
//! sizes it reports are unchanged, since `lower` builds the same term it always did.
//!
//! MEASURED WITHOUT MATERIALIZING ANYTHING. Sizes come from `lambda::term::logical_size`, a memoized
//! fold over the DAG, O(one visit per allocation) — NOT a walk of the logical tree — so the ratio of a
//! term with 2^40 logical nodes is computed in microseconds and the process never holds more than the
//! term itself. The timed ramps are the only place a logical walk actually runs, and each stops at the
//! first size over budget. Measuring the natural way — walking it — is the very thing that is
//! exponential.
//!
//! THAT FOLD USED TO LIVE HERE, in `f64`, and was deleted when the shared `u64` one landed. Two copies
//! of one measurement is drift waiting to happen, and this target's committed figures — 306 / 908 /
//! 4,520 / 76,760 / 307,928 logical at 1 / 2 / 4 / 8 / 10 nesting levels — are what cross-checked the
//! survivor when the local copy went. The shared fold SATURATES at `u64::MAX` where the `f64` one kept
//! approximating, so this family's rows past ~56 levels now read `>=2^64 (SATURATED)` rather than
//! `5.552e21 (2^72.2)`. That is a floor reported as a floor, not a regression: see `fmt_count`.
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
//! # part1 + part2, the sections that are allocation-bounded by construction; ~40 s
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example blowup_probe -p redextape-core
//!
//! # cursor-driven stepping, node-ceilinged; ~2 min
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example blowup_probe -p redextape-core -- step
//!
//! # ONE CURSOR step (depth guard + β-step) per level, against logical size. Measured 2026-07-31: it
//! # does not reach the 10 s budget — it is OOM-KILLED at 16 levels (19,726,040 logical), inside a
//! # single step, having done 15 levels in under a second each. The kill is the result; the cap is
//! # what makes it a bounded one. ~3 s.
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example blowup_probe -p redextape-core -- --beta-curve
//!
//! # the same family through the TM backend, to check it has no analogous hazard; ~1 min
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example blowup_probe -p redextape-core -- --tm
//!
//! # the failure boundary. RUNS FOR AS LONG AS YOU LET IT and holds ~1 GB from ten levels on. A single
//! # β-step used to not finish there; since 2026-08-01 it does, and the wall has moved out rather than
//! # gone away — this section ramps until something gives. Never run this without the cap.
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example blowup_probe -p redextape-core -- oom
//! ```
//!
//! `MemorySwapMax=0` is not decoration. The cap alone lets the kernel push the excess to swap, which
//! turns a bounded failure into an unbounded one — and did: an earlier version of this investigation
//! consumed **60 GiB of RAM and 29 GiB of swap** before it was stopped by hand.
//!
//! `reduce_trace` IS NEVER CALLED HERE and MUST NOT BE ADDED. That 60/29 GiB run is what calling it
//! costs: `reduce_trace` materializes every step's term by contract (592.9 MB for `sum(5)`, per the
//! Plan 4 design), and on a term of this shape each of those terms is itself unbounded, so the cgroup
//! cap has nothing to bite on before the machine does. `trace::LambdaCursor` is the O(1) stepper, and
//! it is what the `step` and `oom` sections use.
//!
//! Nothing here is a test and nothing here is wired into CI: CI compiles examples
//! (`cargo clippy --workspace --all-targets`) and does not run them, which for this target is the
//! intended arrangement rather than a gap. It is committed so the finding in the design's §10 has a
//! re-runnable repro instead of a quoted number.
//!
//! # ALLOCATOR — READ THIS BEFORE TRUSTING ANY TIMING ABOVE
//!
//! **This target has set `mimalloc` as its global allocator since 2026-08-04. Every timing recorded
//! in this file above this note was measured under glibc's malloc and is NOT comparable to a run
//! made today.** Counts are: node counts, allocation counts and step counts are properties of the
//! reduction, not of the machine, and did not move. Seconds, ms and ns did.
//!
//! It is here for a measured reason rather than a preference. The reducer allocates one `Rc<Node>`
//! per term node and frees on the same order, and glibc's layout for that pattern costs real
//! address-translation pressure: on the nested-group family, swapping ONLY the allocator took L1
//! DTLB misses from 1.20e9 to 0.92e9 for the three-pass `beta` and from 1.83e9 to 0.93e9 for the
//! fused one, with the wall clock following at ~9% and ~16%. That is also how the β-fusion family
//! regression was explained — it was glibc's layout, not the reducer's work.
//!
//! `mimalloc` is a `[dev-dependencies]` entry and reaches examples and tests ONLY.
//! `redextape-core`'s `[dependencies]` stays empty and WASM-clean: `libmimalloc-sys` is C that does
//! not build for wasm32, and a library must not choose a global allocator for its consumers.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

#[cfg(not(target_arch = "wasm32"))]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

use std::collections::{HashMap, HashSet};
use std::hint::black_box;
use std::io::Write;
use std::time::Instant;

use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::lambda::reduce::MAX_TERM_DEPTH;
use redextape_core::lambda::term::{LambdaTerm, Node, app, logical_size, var};
use redextape_core::lambda::{MAX_REDUCTION_STEPS, lower, parse_lambda, print_lambda};
use redextape_core::parser::parse;
use redextape_core::tm::{LowerError, TM_DEFAULT_CAPS, TmCaps, TmRun, Unary, defunc, lower_asm, n_slots_of, run_tm};
use redextape_core::trace::LambdaCursor;

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

fn line(s: &str) {
    println!("{s}");
    let _ = std::io::stdout().flush();
}

fn head(s: &str) {
    line("");
    line(&format!("=== {s} ==="));
}

// --- measurement primitives (both O(one visit per allocation), neither walks the logical tree) ---

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

/// Maximum nesting depth, memoized over the DAG the same way. This is what `MAX_TERM_DEPTH` bounds —
/// and the point of measuring it here is that it is a DIFFERENT quantity from logical size, so a term
/// can sit far under the depth limit while its logical size is astronomical.
fn depth(t: &LambdaTerm) -> u32 {
    let mut memo: HashMap<usize, u32> = HashMap::new();
    let mut stack: Vec<(&LambdaTerm, bool)> = vec![(t, false)];
    while let Some((n, folded)) = stack.pop() {
        let id = n.alloc_id();
        if memo.contains_key(&id) {
            continue;
        }
        if !folded {
            stack.push((n, true));
            match n.node() {
                Node::Var(_) => {}
                Node::Abs(_, b) => stack.push((b, false)),
                Node::App(f, a, _) => {
                    stack.push((f, false));
                    stack.push((a, false));
                }
            }
            continue;
        }
        let d = match n.node() {
            Node::Var(_) => 0,
            Node::Abs(_, b) => 1 + memo.get(&b.alloc_id()).copied().unwrap_or(0),
            Node::App(f, a, _) => {
                1 + memo.get(&f.alloc_id()).copied().unwrap_or(0).max(memo.get(&a.alloc_id()).copied().unwrap_or(0))
            }
        };
        memo.insert(id, d);
    }
    memo.get(&t.alloc_id()).copied().unwrap_or(0)
}

/// A TRANSCRIPTION of `lambda::reduce::depth_exceeds`, which is `pub(crate)` and so unreachable from
/// an example target. Kept character-for-character equivalent on purpose: this is the function
/// `trace::LambdaCursor` calls BEFORE EVERY STEP, so what it costs is what a run costs before its
/// first β-step. The `LambdaCursor` ramp below measures the real one end-to-end as a cross-check.
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

    ramp(
        "depth_exceeds(t, MAX_TERM_DEPTH)",
        "transcription of reduce.rs:64-80; the cursor calls this BEFORE EVERY STEP",
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

/// `m+1` nested groups of two mutually recursive functions. Each level's pair is declared INSIDE the
/// previous level's `f`, which is what makes the nesting compose: `lower_group` clones `group` once
/// per member, and `group` contains every member's lowered value.
fn nested_groups_src(m: u32) -> String {
    let mut body = format!("n + g{m}(n)");
    for k in (0..m).rev() {
        let j = k + 1;
        body = format!("fn f{j}(n) {{ {body} }} fn g{j}(n) {{ f{j}(n) }} g{j}(n) + g{k}(n)");
    }
    format!("fn f0(n) {{ {body} }} fn g0(n) {{ f0(n) }} g0(1)")
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
    line("--- 2b: the corpus baseline (the terms `lower` returns today) ---");
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
    line("--- 2d: what that costs the consumer that runs first ---");
    ramp(
        "depth_exceeds on lower()'s output",
        "the cursor's pre-step guard, on the term from 2c; this runs BEFORE any β-step",
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
/// MEASURED 2026-07-31: it does NOT get OOM-killed, which is what it was built expecting. Up to `m`=9
/// (ten nested groups, 307,928 logical) it survives a 2 GiB cgroup; at `m`=10 (eleven groups, 616,152
/// logical) a β-step had not returned after 13 minutes, with peak RSS at 974 MB and creeping ~1 MB per
/// 40 s — the reducer allocates and frees gigabyte-scale terms inside one `reduce_step` rather than
/// accumulating toward a limit. The failure this section actually finds is a hang, not an allocation
/// failure. Stop it by hand.
///
/// THE STUCK STEP IS NOT THE FIRST. `--beta-curve` times one CURSOR step — the depth guard plus the
/// first β-step, so an upper bound on that β-step alone — and gets 50 ms at `m`=10's 616,152 nodes,
/// and 0.85 s at 9,862,872. This section is stuck because it has already
/// taken steps, each of which materializes what the last one denoted. `m` here counts from 0, so
/// `m`=k is k+1 groups and is level k+1 in PART D's and the design's tables; the two indexings are one
/// apart and that has already caused one misreading.
///
/// NOTHING IN-PROCESS COULD BOUND THIS AS MEASURED HERE, which is why the bound was external. A β-step's
/// output WAS `shift(-1, 0, subst(0, shift(1, 0, arg), body))` — every occurrence of the bound variable
/// in `body` was replaced by `arg` and the whole result was then deep-copied by the outer `shift`, so ONE
/// step could produce on the order of |body| x |arg| LOGICAL nodes as real allocations. **Both the
/// `maxfree` short-circuit (2026-08-01) and β-fusion (2026-08-03) have since removed that outer
/// deep-copy — see `examples/shift_cost_probe.rs` — so this section's own hang is not expected to
/// reproduce.** It survives as the re-runnable source for the LOWERING figures, which are unchanged
/// and still reachable — the RSS and timing figures above it ARE the hang (974 MB, 13 minutes without
/// returning), so a section that no longer hangs cannot re-produce those. What changed is what
/// REDUCING one of these terms costs, which is the line this file's own header already draws.
/// **The "not expected" is a prediction, not a measurement** — refuting it means an unbounded reduction
/// run, which this repo's λ-measurement rule requires a hard cgroup cap for, and nothing here has run
/// one. A guard
/// that checked the
/// term's size between steps would therefore be reading a number that says nothing about what the next
/// step is about to allocate. `part_step`'s node ceiling is honest only because it runs at sizes where
/// the product is small.
///
/// So: run this under `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0`. Each `m`
/// prints its "before" line and flushes it BEFORE stepping, so the transcript names the size that is
/// stuck (or that died) whether or not the process survives to report it. The wall budget below is
/// checked BETWEEN steps and so overshoots badly — 90 s produced a 330 s run at `m`=9. That
/// overshoot is a measurement, not a bug in the harness: it is what "a step cannot be interrupted"
/// looks like from outside.
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
/// NEVER `reduce_trace`: it materializes every step's term by contract, and a previous run of this
/// measurement consumed 60 GiB of RAM and 29 GiB of swap doing exactly that. `LambdaCursor` steps
/// lazily, and this holds ONE term at a time — the cursor's, which is the only one alive once the
/// local handle is dropped below.
///
/// The number this exists to produce is THE LOGICAL SIZE AT WHICH ONE β-STEP STOPS BEING TOLERABLE.
/// It was produced FOR THE WITHDRAWN TOTAL-SIZE GUARD, whose `MAX_LOGICAL_NODES` = 300,000 was to be
/// chosen with real margin under it rather than 2x under a single observed hang. **That constant was
/// withdrawn and is not in the tree.** Its successor, `MAX_SHARED_LOGICAL_NODES` = 10,000 on the largest
/// SHARED subterm, landed and was then **reverted after measurement falsified it** — a different
/// quantity again, which this curve also does not measure and could not have calibrated. **THE TREE NOW
/// ENFORCES NO BOUND OF EITHER KIND.** Every figure below is kept as the record of what a one-step curve
/// does and does not establish; none of it is a margin against anything.
///
/// WHAT THE LAST COLUMN ACTUALLY TIMES is one CURSOR step, not one β-step alone. `LambdaCursor::next`
/// ran `depth_exceeds` over the full logical tree before every step (`trace.rs:73`) and did not
/// short-circuit at these depths — 141 against `MAX_TERM_DEPTH` = 3,000 — so every row was the depth
/// guard PLUS a β-step, and each row was an UPPER BOUND on its β-step rather than that step's cost.
///
/// **ALL OF THAT IS PRE-2026-08-01. `depth_exceeds` IS NOW O(1)** — `LambdaTerm` carries `depth` as a
/// construction-time invariant, so the guard is a `u32` comparison and contributes nothing measurable.
/// Each row is now the β-step alone rather than an upper bound on it. **Re-run before quoting any
/// timing here.**
///
/// THE DERIVATION THIS REPLACES, kept because it is the arithmetic someone will want if they re-derive
/// the split. The guard's share was put at ~2%, DERIVED rather than measured, from `reduce.rs`'s
/// Θ(logical) rate of ~1.4 ns/node: at 616,152 nodes that is ~0.9 ms against a 50 ms row, and the same
/// ~2% came out at every other row (0.4 ms / 22 ms at 307,928; 14 ms / 847 ms at 9,862,872).
///
/// **AND ~2% WAS WRONG BY A FACTOR OF ~48 FOR THE RUN AS A WHOLE, which is the lesson.** It is right
/// for ONE step on the terms this section builds, and the section only ever times one step. Measured
/// across a full reduction of the same family, `depth_exceeds` was **96%** of the time (187.6 s of
/// 195.7 s at eleven levels) — because the guard is Θ(logical) per step while a single early step is
/// cheap, so a per-step share says nothing about the run. That is the same error as sizing a guard from
/// a one-step curve, recorded two paragraphs down.
///
/// MEASURED 2026-07-31, under `MemoryMax=2G MemorySwapMax=0`: the 10 s budget is never reached. One
/// cursor step is 0.022 s at 307,928 logical nodes, 0.847 s at 9,862,872, and at 19,726,040 (16
/// levels) the process is OOM-KILLED inside that one step. **The wall this measurement finds is
/// memory, not time**, and it is 65.75x above the withdrawn total-size guard's `MAX_LOGICAL_NODES` =
/// 300,000 (19,726,040 / 300,000) — arithmetic about a bound that no longer exists, kept because the
/// paragraph below is about what that ratio does NOT mean.
///
/// **DO NOT READ THAT AS 65.75x OF MARGIN, AND THIS IS THE WHOLE TRAP.** This section times the FIRST
/// step, whose cost is set by the term `lower` handed over. The hang a guard would exist to prevent is a
/// LATER step, whose cost is set by what earlier steps have already materialized: a step's output can
/// be |body| x |arg|, and the next step starts from that output. `part_oom` reduces rather than
/// single-steps, and it hangs at 616,152 — a size this section clears in 50 ms. So a bound derived
/// from this curve alone would be **32x too loose against the size that actually hangs**
/// (19,726,040 / 616,152 = 32.0), in exactly the way §4 of the design records the first attempt being
/// wrong: a growth number transferred from the wrong base. The 65.75x above is the same wall measured
/// against that withdrawn 300,000-node total-size bound instead; both are right, and the denominator
/// has to be said or the two read as a disagreement. Neither denominator was ever
/// `MAX_SHARED_LOGICAL_NODES` either: 10,000 bounded the largest shared subterm, not the whole term, so
/// dividing this wall by it would have been a third base and a meaningless one — and that bound has
/// since been reverted, so there is no live constant this curve is a margin against at all.
///
/// `levels` counts GROUPS, so level k is `nested_groups_src(k - 1)` — the same indexing as 2c above
/// and as the design's §4 table, which is what makes this curve and that table one measurement instead
/// of two. Each row is flushed BEFORE the next level is built, because the level that never returns is
/// the one that would have been printed next: an interrupted run still reports everything it
/// established — which is how the OOM-killed run above still reports 15 levels.
fn beta_curve() {
    head("PART D — one cursor step (depth guard + β-step), against logical size");
    line(&format!("  cursor cap 1 step, {BETA_BUDGET_S:.0}s budget per level; no snapshots, one term alive at a time"));
    line("  last column is ONE CURSOR STEP. Since 2026-08-01 depth_exceeds is O(1) — LambdaTerm carries");
    line("  `depth` as a construction-time invariant — so the row is the β-step alone. It used to walk");
    line("  the full logical tree first, making each row an UPPER BOUND on its step; the doc comment on");
    line("  this function has that history and the ~2%-per-step figure that went with it.");
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
            line("  THAT FIGURE SIZED THE WITHDRAWN TOTAL-SIZE GUARD (MAX_LOGICAL_NODES = 300,000), which is");
            line("  NOT in the tree. Its successor (MAX_SHARED_LOGICAL_NODES = 10,000, on the largest SHARED");
            line("  subterm) landed and was REVERTED after measurement falsified it. NOTHING BOUNDS THIS TODAY,");
            line("  and this curve neither measures nor sizes whatever replaces it — see guard_hole_probe.rs.");
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
/// MEASURED 2026-07-31: **the family is LINEAR on this side.** `lower_asm` succeeds directly at every
/// level (`defunc` is never reached, so `MAX_DEFUNC_DEPTH` is not what bounds this), emitting 18 / 69 /
/// 137 / 205 instructions at 1 / 4 / 8 / 12 levels — ~17 per level against the λ side's doubling — with
/// 3 labels per level and `slots` FLAT at 6-7, four orders under `MAX_SLOTS`. No refusal fires: not
/// `MAX_SLOTS`, not `TmRun::TooLarge`, not either 580-deep bound. What bounds it is `TmCaps::steps`,
/// reported as `HitCap` after ~70 ms, and this family is genuinely non-terminating (`f0` calls `g0`
/// calls `f0`), so `HitCap` is the correct answer rather than a shortfall.
///
/// THAT ATTRIBUTION IS MEASURED, NOT INFERRED, and it could not have been inferred from the rows
/// above: `HitCap` is returned for the step cap and the live-cell cap alike, and at 14 ns/step the
/// cell cap was every bit as plausible. The `WHICH CAP` block below raises one cap at a time. Measured
/// 2026-07-31 at 8 levels: cells raised to 500,000,000 still caps in **0.070 s**, unchanged from the
/// default, so that is the STEP cap. Steps raised to 500,000,000 with cells left at 5,000,000 caps
/// only after **3.7 s or more**, an order of magnitude later, so the cell cap is not what ends the
/// default run. Which of the two ended the raised-step-cap run is not distinguished and does not need
/// to be; the two walls are that far apart, so the attribution is not a knife edge.
///
/// WHY 5,000,000 STEPS CANNOT TOUCH 500,000,000 CELLS, since that is what makes the first row a step
/// cap and the mechanism was left unstated. One step applies one rule; `sim::apply` writes and moves
/// EVERY tape once, and `Tape::step` extends a tape by at most one cell (a move onto an empty side
/// materializes one `BLANK`). The machine has `build::TAPES` = 5 tapes, and the cap is on the SUM
/// across tapes (`trace.rs`'s `total: usize = self.tapes.iter().map(Tape::cells).sum()`), not per
/// tape — which is the version that has to be checked, since a per-tape argument would be five times
/// weaker than the cap it is defending. Total live cells therefore grow by at most 5 per step, so
/// 5,000,000 steps reach at most ~25,000,000 cells: **20x under 500,000,000.** Real headroom, not a
/// coincidence, but it is 20x rather than unbounded and the number belongs on the page.
///
/// THE TIMINGS DO NOT REPRODUCE, ONLY THE SEPARATION DOES. Seven runs on 2026-07-31 on a 32-core box
/// under background load gave 3.73 / 3.73 / 4.57 / 7.66 / 7.69 / 10.62 / 10.74 s for the
/// raised-step-cap row, against 0.067–0.52 s for the default row in the same run — a ratio anywhere
/// from 15x to 114x. The tight cluster at 3.73 s is what a quiet box gives, and the paired default row
/// is at its own 0.070 s floor there, so **3.77 s is best read as a FLOOR on that row rather than as
/// its value.** Nothing here leans on the ratio: the attribution needs only that the raised-step-cap
/// run is far longer than the default, which every one of the seven runs shows.
///
/// **The structural reason the step cap works here and not there** is worth keeping, because it is the
/// same sentence as the λ guard's motivation read backwards: a TM transition is O(1), so a cap counted
/// between steps bites within one step's worth of overshoot. A β-step is unbounded and uninterruptible,
/// so `MAX_REDUCTION_STEPS` is never even consulted. Same idea of a cap; opposite outcome, because the
/// unit being counted is bounded on one side and not on the other.
fn tm_check() {
    /// Transcribed from `lower_tm::MAX_SLOTS`, which is `pub(crate)` and so unreachable from an example
    /// target — the same reason `depth_exceeds` above is a transcription rather than a call.
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
            //
            // THE CATCH-ALL THIS REPLACED DID NOT REPRODUCE IT. `Err(e) =>` fell into `defunc` on
            // `TooDeep` as well, which `lower_program` returns IMMEDIATELY (`tm.rs:104-105`) — so on a
            // `TooDeep` program this line would have printed a `defunc` path `run_tm` never took.
            // Unreachable at these levels, since `lower_asm` succeeds directly at every one; corrected
            // in the code rather than in the comment because the comment's claim is the one worth
            // keeping, and a hazard demonstrator's transcript must not be able to say something false.
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
    // and `HitCap` is the answer for the step cap AND for the live-cell cap — `trace.rs:112` records
    // the two as "genuinely interchangeable: both return `HitCap` with no side effect on either path".
    // The classified outcome printed above therefore names the wall without naming which wall, and
    // 5,000,000 steps in ~70 ms is 14 ns/step, which makes 5,000,000 live cells at least as plausible.
    //
    // RAISING ONE CAP AT A TIME SEPARATES THEM. Under a raised cells cap the tape cannot be what
    // stops the run, so a `HitCap` there is the step cap; under a raised step cap it is the cell cap.
    // If both still cap, both are reachable, and the shorter of the two times is the one the default
    // run stops at — a run under both caps stops at whichever arrives first.
    //
    // NEITHER VARIANT LIFTS A CAP, AND THAT IS DELIBERATE. `steps: u64::MAX` is the obvious way to
    // write the first one and is not safe here: this family does not halt, so a run with no step cap
    // returns only if the tape reaches the 5,000,000-cell cap. That is a FINITE target rather than
    // unbounded growth — the condition is weaker than "grows without bound", which this comment used
    // to claim — but it is still a proposition about this family's tape behaviour that nothing here
    // has established, so the argument for not lifting the cap is unchanged. Each cap is raised 100x
    // instead. Both variants terminate by construction — 500,000,000 steps is ~7 s at the 14 ns/step
    // above, and 5,000,000 cells still bounds the tape's memory.
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
    // Opt-in. Named for what it was BUILT expecting — an OOM kill at the size that answers the
    // question — and kept under that name because the transcripts and the design's §10 use it. What
    // it actually finds is a hang: see `part_oom`'s doc comment.
    if args.iter().any(|a| a == "oom") {
        part_oom();
    }
    // Opt-in: this one ENDS in the hang it is measuring, by construction.
    if args.iter().any(|a| a == "--beta-curve") {
        beta_curve();
    }
    if args.iter().any(|a| a == "--tm") {
        tm_check();
    }
}
