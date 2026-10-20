//! Measurements behind two λ guard designs, neither of which is in `lower`: the logical-size guard
//! (`docs/superpowers/specs/2026-07-31-lambda-logical-size-guard-design.md` §10) and the shared-subterm
//! guard (`docs/superpowers/specs/2026-07-31-lambda-shared-subterm-guard-design.md` §3). It is the
//! re-runnable source for three figures the shared-subterm design's table pins: the 699-element list's
//! reduction, the 46-program corpus sharing profile, and the nesting family's `max_shared` per level.
//!
//! No measurement in this file depends on either guard — that is the point of committing an instrument
//! rather than a conclusion.
//!
//! A **699-element list literal** (`deep_list(MAX_LAMBDA_LOWER_DEPTH - 1)`) is the largest list `lower`
//! admits, and the LOGICAL-SIZE design's guard would refuse it. The question is whether it is FINE — a
//! large but working program the guard should not refuse. `lower.rs`'s
//! `the_guard_admits_a_core_at_the_bound_and_refuses_only_past_it` asserts of it only `lower(&at_bound).is_ok()`.
//!
//! This probe reduces it. Three questions:
//!
//!   1. Does a 699-element list literal actually reduce to normal form? Ramped from 50 upward.
//!   2. If so, where does it stop being fine? Ramped past 699 by constructing the target `LambdaTerm`
//!      directly (see `direct_list_term`'s doc for why `lower` itself cannot go past 699).
//!   3. Among allocations referenced more than once within a term (the structural-sharing proxy for
//!      `Rc::strong_count() > 1`), what is the largest `logical_size` of any one of them? Measured
//!      for the list literal and for `blowup_probe.rs`'s nesting family at 6, 8 and 10 groups, to test
//!      the hypothesis that a big *shared* subterm — not a big term per se — is what makes reduction
//!      expensive. It is not; the shared-subterm design's §10.2 says why.
//!
//! Three further sections: a corpus profile, a per-level profile of the family, and a single-level
//! reduction check that establishes what "dangerous" means:
//!
//!   4. `corpus` — `max_shared` over every program in `FIRST_ORDER_DEMOS`. The multiplier is
//!      `lower_group` cloning the whole group term once per member, so group SIZE is what makes
//!      `max_shared` large: a *self*-recursive `fn` is a one-member group and measures the same as a
//!      non-recursive one.
//!   5. `family` — `max_shared` and `logical_size` for the nesting family at 1..=12 groups.
//!      Construction only, no reduction.
//!   6. `family-reduce <level>` — does ONE level keep stepping, hang in a single step, or stop on the
//!      depth guard? **THE HAZARD SECTION.** See its own doc comment for why it takes one level per
//!      process rather than ramping in a loop.
//!
//! `lower` refuses nothing on these grounds, so every ramp here reaches its full range.
//!
//! `lower_src` RETURNS `Option` and must not panic: a ramp that reports a refusal and keeps its
//! remaining rows is the shape that survives the next guard.
//!
//! # Safety — same rules as `blowup_probe.rs`, and for the same reason
//!
//! `reduce_trace` materializes every step by contract, so on a term of unbounded growth its memory is
//! unbounded too. This file:
//!
//!   - **Never calls `reduce_trace`.** `LambdaCursor` steps lazily; this holds exactly one term.
//!   - **Holds one term at a time.** No `Vec` of terms, no snapshot history.
//!   - **Must be run under** `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0`.
//!   - **Ramps upward** (never jumps to the largest size first) and flushes each row before computing
//!     the next, so a killed or interrupted run still reports everything established so far.
//!
//! `MemorySwapMax=0` is not decoration: the memory cap alone lets the kernel push the excess to swap,
//! which turns a bounded failure into an unbounded one.
//!
//! # How to run this
//!
//! **Every run goes under the cap**, not only the hazard section, so the habit does not depend on
//! remembering which section is the dangerous one. Sections are selected by argument and run in this
//! file's order regardless of the order given; with no argument, every section except `family-reduce`
//! runs.
//!
//! | arg | what it establishes | cost |
//! | --- | --- | --- |
//! | `q1` | a list literal reduces, through the real `lower()` pipeline, n ≤ 699 | the n=699 row is slowest |
//! | `q2a` | the 10 s crossing, between n=400 and n=699 | five reduction rows |
//! | `q2` | past 699, by direct construction — `lower` cannot reach these sizes | 60 s hard stop |
//! | `q2b` | where the list's own depth crosses `MAX_TERM_DEPTH` | construction only |
//! | `q3` | the max shared subterm: the list vs the family at 6, 8 and 10 groups | construction only |
//! | `corpus` | `max_shared` over all 46 `FIRST_ORDER_DEMOS` | construction only |
//! | `family` | `max_shared` over the family, all twelve levels | construction only |
//! | `family-reduce <level>` | whether ONE level keeps stepping | **one level per process, 20 s budget** |
//!
//! ```text
//! # every section except family-reduce
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example list_reduction_probe -p redextape-core
//!
//! # any subset of them
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example list_reduction_probe -p redextape-core -- corpus family
//!
//! # THE HAZARD SECTION — one level per invocation, ramped upward by the caller, stopping at the first
//! # level that is killed from outside or reports "did not finish in budget". This needs an EXTERNAL
//! # wall-clock kill as well as the cap, because nothing inside the process can interrupt a step once
//! # it has started. Build first, so the kill budget covers the run and not the compile.
//! cargo build --release --example list_reduction_probe -p redextape-core
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   timeout 60 ./target/release/examples/list_reduction_probe family-reduce 6
//! ```
//!
//! Nothing here is a test and nothing here is wired into CI, the same arrangement as `blowup_probe.rs`
//! and for the same reason: CI compiles examples but does not run them. It is committed so the figures
//! in both designs' tables have a re-runnable repro rather than a quoted number.
//!
//! # ALLOCATOR
//!
//! This target sets `mimalloc` as its global allocator, so a timing taken here is not comparable with one
//! taken under glibc's malloc, which is what the timings quoted in this file were. Node counts, allocation
//! counts and step counts are properties of the reduction, not of the machine, and do not depend on it.
//!
//! The reducer allocates one `Rc<Node>` per term node and frees on the same order, and glibc's layout for
//! that pattern costs real address-translation pressure.
//!
//! `mimalloc` is a `[dev-dependencies]` entry and reaches examples and tests ONLY.
//! `redextape-core`'s `[dependencies]` stays WASM-clean: `libmimalloc-sys` is C that does
//! not build for wasm32, and a library must not choose a global allocator for its consumers.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::time::Instant;

use redextape_core::desugar::desugar;
use redextape_core::lambda::MAX_REDUCTION_STEPS;
use redextape_core::lambda::encode;
use redextape_core::lambda::lower;
use redextape_core::lambda::reduce::MAX_TERM_DEPTH;
use redextape_core::lambda::term::{LambdaTerm, app, logical_size, max_shared_logical_size};
use redextape_core::parser::parse;
use redextape_core::trace::LambdaCursor;

#[path = "common/allocator.rs"]
mod allocator;
#[path = "common/demos.rs"]
mod demos;
#[path = "common/depth.rs"]
mod depth;
#[path = "common/footprint.rs"]
mod footprint;
#[path = "common/nested_groups.rs"]
mod nested_groups;
#[path = "common/text.rs"]
mod text;

use demos::FIRST_ORDER_DEMOS;
use depth::depth;
use footprint::{lower_src, peak_rss_kb, physical};
use nested_groups::nested_groups_src;
use text::{head, line};

/// Per-row wall-clock budget. A ramp stops at the first row over this.
const BUDGET_S: f64 = 10.0;

fn fmt_count(v: u64) -> String {
    if v == u64::MAX { ">=2^64 (SATURATED)".to_string() } else { format!("{v}") }
}

// --- list literals ---------------------------------------------------------------------------------

/// Source text for `[0, 1, ..., n-1]` — the same shape as `lower.rs`'s test-only `deep_list`, which is
/// `#[cfg(test)]`-private and so unreachable from an example target.
fn deep_list_src(n: usize) -> String {
    format!("[{}]", (0..n).map(|i| i.to_string()).collect::<Vec<_>>().join(", "))
}

/// The REAL pipeline: parse -> desugar -> lower. Only valid up to `n = 699`
/// (`MAX_LAMBDA_LOWER_DEPTH - 1`); past that `lower` refuses with `TooDeep` regardless of how the input
/// `Core` was constructed, because `too_deep_node` measures the Core's own nesting depth before any
/// recursive pass runs — see `direct_list_term` for how this probe gets past it.
fn lowered_list_term(n: usize) -> LambdaTerm {
    let src = deep_list_src(n);
    let (prog, ds) = parse(&src);
    assert!(ds.is_empty(), "parse errors for n={n}: {ds:?}");
    let core = desugar(&prog.expect("parses"));
    lower(&core).unwrap_or_else(|e| panic!("lower failed for n={n}: {e:?}"))
}

/// The term `lower` WOULD produce for `[0, 1, ..., n-1]`, built directly with the same combinators
/// `lower_expr`'s `Core::Apply(cons, [elem, acc])` arm and `resolve`'s `"cons"`/`"nil"` cases use
/// (`encode::cons`, `encode::nil`, `encode::church`, all `pub`) — `cons(0, cons(1, ..., cons(n-1,
/// nil)))`, built from the right exactly as the `Expr::List` arm in `desugar.rs` does.
///
/// WHY THIS BYPASSES `lower` RATHER THAN GOING THROUGH IT WITH A DIRECTLY-BUILT `Core`: a list literal
/// of `n` elements desugars to a `Core::Apply` spine of depth `n + 1` regardless of how that `Core` was
/// constructed — by the parser or by hand — and `lower_mapped`'s `too_deep_node` guard measures exactly
/// that depth, unconditionally, before any other pass runs. There is no `Core` shape denoting a
/// genuine `n`-element list literal with less nesting than `n + 1`, so for `n > 699` there is no way
/// through `lower` at all. Building the target `LambdaTerm` directly is the one way past it: it produces
/// the identical term (verified below, at `n` = 1, 5 and 50, against the real pipeline) without ever presenting
/// `lower` with a deep `Core`.
fn direct_list_term(n: u64) -> LambdaTerm {
    let mut acc = encode::nil();
    for i in (0..n).rev() {
        acc = app(app(encode::cons(), encode::church(i)), acc);
    }
    acc
}

/// Confidence check: `direct_list_term` must build the SAME term `lower` does, at a size both can
/// reach. It prints the `false` row and then asserts, so a divergence prints and then panics: every
/// row built with `direct_list_term` alone (n > 699) would otherwise be measuring something other
/// than what it claims to.
fn verify_direct_construction_matches_lower() {
    for n in [1usize, 5, 50] {
        let via_lower = lowered_list_term(n);
        let direct = direct_list_term(n as u64);
        let ok = via_lower == direct;
        line(&format!("  n={n:<4} lower()-built == direct-built: {ok}"));
        assert!(ok, "direct_list_term diverged from lower() at n={n}");
    }
}

// --- shared-subterm analysis -------------------------------------------------------------------------

// The in-degree fold is `lambda::term::max_shared_logical_size`, which is `pub` and O(physical). Its own
// doc says why it counts in-degree rather than `Rc::strong_count`: a caller retaining snapshots would
// inflate the count, and a measurement whose value changes with observers cannot gate anything.

// --- question 1 & 2: does the list reduce, and where does it stop being fine? ----------------------

/// One row: build `t`, drive a `LambdaCursor` to completion (or the cap), report steps/time/size.
/// `step_cap` is generous relative to what a list literal should need (`cons` is the only redex source;
/// two β-steps collapse each cons cell's two applied arguments, so `2n` steps normalizes an n-element
/// list if nothing else is going on) but far short of `MAX_REDUCTION_STEPS`, so a construction bug that
/// produced a genuinely divergent term reports `HitCap` in seconds rather than grinding for 5,000,000
/// steps first.
/// Returns the row's wall-clock seconds, so a ramp can decide whether to attempt the next (larger, and
/// much slower) size at all.
fn reduce_row(label: &str, t: LambdaTerm, step_cap: u64) -> f64 {
    let start_phys = physical(&t);
    let start_logical = logical_size(&t);
    let mut cursor = LambdaCursor::new(&t, step_cap);
    drop(t); // from here exactly one term is alive: the cursor's
    let t0 = Instant::now();
    while cursor.next().is_some() {}
    let dt = t0.elapsed().as_secs_f64();
    let final_phys = physical(cursor.term());
    let final_logical = logical_size(cursor.term());
    let rss = peak_rss_kb().map_or_else(|| "?".to_string(), |kb| format!("{:.1} MB", kb as f64 / 1024.0));
    line(&format!(
        "  {label:<10} start: phys={start_phys:<8} logical={:<10} | steps={:<8} {dt:>9.3}s status={:<21} | \
         final: phys={final_phys:<8} logical={:<10} | cumulative peak RSS={rss}",
        fmt_count(start_logical),
        cursor.steps_taken(),
        format!("{:?}", cursor.status()),
        fmt_count(final_logical),
    ));
    if dt > BUDGET_S {
        line(&format!("  STOP: {label} exceeded the {BUDGET_S:.0}s budget"));
    }
    dt
}

fn list_ramp_under_699() {
    head("Q1 — does a list literal actually reduce? (real lower() pipeline, n <= 699)");
    line("  cross-check: direct_list_term must equal lower()'s output at sizes both can reach");
    verify_direct_construction_matches_lower();
    line("");
    line("  step cap = 10 * n + 100 (generous over the expected 2n; HitCap is itself an answer)");
    for n in [50usize, 100, 200, 400, 699] {
        let t = lowered_list_term(n);
        reduce_row(&format!("n={n}"), t, (n as u64) * 10 + 100);
    }
}

/// Extra points BELOW 699, to pin where the ramp crosses `BUDGET_S`. All reachable through the real
/// `lower()` pipeline (no guard fight needed below 700).
fn list_ramp_crossing() {
    head(&format!("Q2a — pinning the {BUDGET_S:.0}s crossing between n=400 (6.25s) and n=699 (35.2s)"));
    for n in [450usize, 500, 550, 600, 650] {
        let t = lowered_list_term(n);
        reduce_row(&format!("n={n}"), t, (n as u64) * 10 + 100);
    }
}

/// Past 699: `direct_list_term` only (see its doc — `lower` cannot reach these sizes at all).
///
/// DELIBERATELY SHORT, because the time curve is roughly cubic in n. `HARD_STOP_S` is a second, looser
/// budget checked AFTER each row (a β-step cannot be interrupted mid-flight, so this can only stop
/// BETWEEN rows) — once a row exceeds it, the next size would cost several times more, so there is
/// nothing left to learn without a much longer run.
fn list_ramp_past_699() {
    const HARD_STOP_S: f64 = 60.0;
    head("Q2 — where does it stop being fine? (direct construction, n > 699, bypassing lower())");
    for n in [700u64, 800, 1_000] {
        let t = direct_list_term(n);
        let dt = reduce_row(&format!("n={n}"), t, n * 10 + 100);
        if dt > HARD_STOP_S {
            line(&format!("  STOP: n={n} exceeded the looser {HARD_STOP_S:.0}s hard stop; not attempting a larger n"));
            return;
        }
    }
    line("  reached the end of this ramp's fixed list without hitting the hard stop");
}

// --- question 3: the max shared-subterm hypothesis --------------------------------------------------

/// Six groups leads the ramp so the section demonstrates the contrast it exists for: the list is
/// enormous and shares nothing, the family is small and shares almost half of itself. **The contrast is
/// real, but sharing is not what makes a step expensive**; see the module doc.
fn shared_subterm_report() {
    head("Q3 — the largest logical_size among SHARED subterms (in-degree > 1)");
    line("  hypothesis: ~0 for the list (no sharing anywhere) vs huge for the nesting family");
    line("");

    let list_699 = lowered_list_term(699);
    let list_max_shared = max_shared_logical_size(&list_699);
    line(&format!(
        "  699-element list literal:  physical={:<8} logical={:<10} max-shared-subterm logical_size={}",
        physical(&list_699),
        fmt_count(logical_size(&list_699)),
        list_max_shared
    ));
    drop(list_699);

    for groups in [6u32, 8, 10] {
        let src = nested_groups_src(groups - 1); // nested_groups_src(m) yields m+1 groups
        let Some(t) = lower_src(&src) else {
            line(&format!(
                "  STOP: lower refused the nesting family at {groups} groups. Nothing bounds sharing, so this \
                 is a DEPTH refusal or a lowering change, not the expected path. Re-run `family` to see where \
                 the ramp actually stops."
            ));
            return;
        };
        let max_shared = max_shared_logical_size(&t);
        line(&format!(
            "  nesting family, {groups:>2} groups:    physical={:<8} logical={:<10} max-shared-subterm logical_size={}",
            physical(&t),
            fmt_count(logical_size(&t)),
            max_shared
        ));
    }
}

/// Where does the UNREDUCED term's own depth cross `MAX_TERM_DEPTH` (3,000)? Cheap — no reduction, just
/// construction + the O(physical) `depth` fold — so this can afford sizes past the reduction ramps above.
fn depth_probe() {
    head(&format!("Q2b — where does the list's own depth cross MAX_TERM_DEPTH={MAX_TERM_DEPTH}?"));
    for n in [699u64, 700, 800, 1000, 1250, 1499, 1500, 2000] {
        let t = direct_list_term(n);
        let d = depth(&t);
        line(&format!("  n={n:<5} depth={d:<6} exceeds MAX_TERM_DEPTH={}", d > MAX_TERM_DEPTH));
    }
}

// --- sharing data: the corpus profile & the family's danger ramp -----------------------------------
//
// Three pieces: (1) `max_shared` over every program in `three_way_oracle.rs::FIRST_ORDER_DEMOS`, to find
// the corpus ceiling; (2) `max_shared`/logical_size over the nesting family at 1..=12 groups — cheap,
// construction only, no reduction; (3) a SEPARATE, opt-in, single-level reduction-feasibility check
// (`family-reduce <level>`) driven under a hard 20s wall budget, meant to be invoked once per level by
// an external ramp (see the doc block below) so a level that hangs or gets OOM-killed cannot prevent
// reporting the levels before it — the same "flush before the next size" discipline as the rest of this
// file, just enforced by the process boundary instead of by a between-rows flush, because a single
// β-step cannot be interrupted from inside this process (see `blowup_probe.rs`'s `part_oom` doc).

/// Question A — the corpus sharing profile: `max_shared` and total `logical_size` for every program in
/// `FIRST_ORDER_DEMOS`. All 46 are small (the whole sweep is seconds), so this runs the full corpus in
/// one pass rather than ramping.
fn corpus_sharing_profile() {
    head(&format!("Corpus sharing profile — max_shared over all {} FIRST_ORDER_DEMOS", FIRST_ORDER_DEMOS.len()));
    let mut max_row: Option<(usize, u64)> = None;
    let mut zero = 0u32;
    let mut nonzero: Vec<(usize, u64)> = Vec::new();
    for (i, src) in FIRST_ORDER_DEMOS.iter().enumerate() {
        // A refusal HERE would mean the whole corpus stopped lowering, which the three-way oracle would
        // also catch — so this reports the demo and keeps going rather than stopping: which OTHER demos
        // still lower is the first thing anyone would want to know next.
        let Some(t) = lower_src(src) else {
            line(&format!("  [{i:>2}] REFUSED BY lower — the corpus is supposed to lower in full; src={src}"));
            continue;
        };
        let p = physical(&t);
        let l = logical_size(&t);
        let ms = max_shared_logical_size(&t);
        let one_line: String = src.split_whitespace().collect::<Vec<_>>().join(" ");
        line(&format!("  [{i:>2}] physical={p:<6} logical={l:<8} max_shared={ms:<8} src={one_line}"));
        if ms > 0 {
            nonzero.push((i, ms));
        } else {
            zero += 1;
        }
        if max_row.is_none_or(|(_, cur)| ms > cur) {
            max_row = Some((i, ms));
        }
    }
    line("");
    if let Some((i, ms)) = max_row {
        line(&format!(
            "  CORPUS MAX max_shared = {ms} at index [{i}]: {}",
            FIRST_ORDER_DEMOS[i].split_whitespace().collect::<Vec<_>>().join(" ")
        ));
    }
    line(&format!(
        "  distribution: {zero} of {} programs have max_shared=0; {} are non-zero: {:?}",
        FIRST_ORDER_DEMOS.len(),
        nonzero.len(),
        nonzero
    ));
}

/// Question B (first half) — the nesting family's sharing profile at 1..=12 groups. Cheap: this only
/// constructs `lower()`'s output and folds over the DAG (`logical_size`, `max_shared_logical_size`),
/// it never reduces, so unlike the reduction ramp below it does not need a per-level process boundary
/// or a wall budget.
///
/// It reaches level 12, so the L7–L12 rows in the design's §3 table are re-derivable here.
/// The early-stop branch below is for whatever bounds this family: it stops at the FIRST refusal
/// rather than skipping ahead, because `max_shared` is monotone in this family and any bound that
/// refuses one level refuses every level above it.
fn family_sharing_profile() {
    head("Family sharing profile — max_shared and logical_size, nesting family at 1..=12 groups");
    for level in 1u32..=12 {
        let src = nested_groups_src(level - 1); // nested_groups_src(m) yields m+1 groups
        let Some(t) = lower_src(&src) else {
            line(&format!(
                "  STOP: lower refused this family at {level} groups. Nothing bounds sharing, so this is a \
                 depth refusal or a lowering change. max_shared is monotone here, so every level above this \
                 one is refused too."
            ));
            return;
        };
        let p = physical(&t);
        let l = logical_size(&t);
        let ms = max_shared_logical_size(&t);
        line(&format!(
            "  groups={level:<3} src={:<6}B physical={p:<8} logical={:<24} max_shared={:<24}",
            src.len(),
            fmt_count(l),
            fmt_count(ms)
        ));
    }
}

/// Question B (second half) — does reduction complete at this ONE level, within a hard 20s wall budget?
/// Opt-in and single-level BY DESIGN: invoke once per level (`family-reduce <level>`), each invocation
/// under its own `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0` and an external
/// wall-clock kill, ramped upward by the caller, stopping at the first level that is killed from outside
/// or reports `did not finish in budget`. A single process cannot safely attempt levels 1..=12 in a loop
/// and self-enforce the 20s budget: a β-step cannot be interrupted from inside this process once started
/// (`blowup_probe.rs`'s `part_oom` doc), so the only instrument that can reliably cut a hung step off at
/// 20s is the OS, from outside. The in-process check below (between steps) is a soft, best-effort early
/// exit for the common case where many small steps land the run over budget; the external wall-clock
/// kill is what makes the budget HARD.
///
/// Step cap is `MAX_REDUCTION_STEPS` — the same cap the real pipeline (`run_lambda`) drives reduction
/// with — so `HitCap` here means what it would mean for a real program, not an artificially small probe
/// cap. `HitCap` has a second producer, the depth guard (`MAX_TERM_DEPTH`): a `HitCap` with `steps`
/// below the cap is the depth guard's.
fn family_reduce_one(level: u32) {
    const WALL_BUDGET_S: f64 = 20.0;
    // Heartbeat so a process that gets killed mid-step (OOM, or the external wall-clock kill) still
    // leaves a transcript of how far it got: every 5,000 steps OR every 2s of wall time, whichever
    // comes first, so a run of slow steps still prints. Both are checked between steps, so neither
    // prints during a single step: a run killed mid-step last printed less than 5,000 steps and 2s
    // before that step began.
    const HEARTBEAT_STEPS: u64 = 5_000;
    const HEARTBEAT_SECS: f64 = 2.0;
    let src = nested_groups_src(level - 1);
    let Some(t) = lower_src(&src) else {
        line(&format!(
            "  level={level} REFUSED at lowering time. Nothing bounds sharing, so this is a depth refusal or a \
             lowering change, not the expected path."
        ));
        return;
    };
    let start_phys = physical(&t);
    let start_logical = logical_size(&t);
    let start_max_shared = max_shared_logical_size(&t);
    line(&format!(
        "  level={level} groups={level} src={:<6}B start: phys={start_phys} logical={} max_shared={} — \
         stepping now (cap={MAX_REDUCTION_STEPS} steps, {WALL_BUDGET_S:.0}s wall budget)",
        src.len(),
        fmt_count(start_logical),
        fmt_count(start_max_shared)
    ));
    let mut cursor = LambdaCursor::new(&t, MAX_REDUCTION_STEPS);
    drop(t); // from here exactly one term is alive: the cursor's
    let t0 = Instant::now();
    let mut last_hb_steps = 0u64;
    let mut last_hb_secs = 0.0f64;
    let mut timed_out = false;
    while cursor.next().is_some() {
        let steps = cursor.steps_taken();
        let elapsed = t0.elapsed().as_secs_f64();
        if steps - last_hb_steps >= HEARTBEAT_STEPS || elapsed - last_hb_secs >= HEARTBEAT_SECS {
            last_hb_steps = steps;
            last_hb_secs = elapsed;
            let phys = physical(cursor.term());
            let rss = peak_rss_kb().map_or_else(|| "?".to_string(), |kb| format!("{:.1} MB", kb as f64 / 1024.0));
            line(&format!(
                "    ... level={level} steps={steps:<9} elapsed={elapsed:>7.3}s phys={phys:<8} peak_rss={rss}"
            ));
        }
        if elapsed > WALL_BUDGET_S {
            timed_out = true;
            break;
        }
    }
    let dt = t0.elapsed().as_secs_f64();
    let outcome = if timed_out { "did not finish in budget".to_string() } else { format!("{:?}", cursor.status()) };
    line(&format!(
        "  level={level} RESULT: {outcome}  steps={} elapsed={dt:.3}s (budget {WALL_BUDGET_S:.0}s)",
        cursor.steps_taken()
    ));
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let want = |name: &str| args.is_empty() || args.iter().any(|a| a == name);
    line("list_reduction_probe — does a 699-element list literal actually reduce?");
    line("  RUN UNDER: systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0");
    line(&format!(
        "  MAX_REDUCTION_STEPS={MAX_REDUCTION_STEPS} (family-reduce's cap; list rows use a much smaller per-row cap)"
    ));
    if let Some(pos) = args.iter().position(|a| a == "family-reduce") {
        let level: u32 = args
            .get(pos + 1)
            .unwrap_or_else(|| panic!("family-reduce needs a level argument, e.g. `family-reduce 8`"))
            .parse()
            .unwrap_or_else(|e| panic!("family-reduce level must be a u32: {e}"));
        family_reduce_one(level);
        return; // single-level, opt-in section: do not fall through to the default sections below
    }
    if want("q1") {
        list_ramp_under_699();
    }
    if want("q2a") {
        list_ramp_crossing();
    }
    if want("q2") {
        list_ramp_past_699();
    }
    if want("q2b") {
        depth_probe();
    }
    if want("q3") {
        shared_subterm_report();
    }
    if want("corpus") {
        corpus_sharing_profile();
    }
    if want("family") {
        family_sharing_profile();
    }
}
