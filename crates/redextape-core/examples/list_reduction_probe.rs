//! Falsification check for the abandoned λ logical-size guard
//! (`docs/superpowers/specs/2026-07-31-lambda-logical-size-guard-design.md` §10), and then the
//! threshold-setting measurement for the guard that replaced it
//! (`docs/superpowers/specs/2026-07-31-lambda-shared-subterm-guard-design.md` §3). It is the
//! re-runnable source for three figures that design's table pins: the 699-element list's reduction, the
//! 46-program corpus sharing profile, and the nesting family's `max_shared` per level.
//!
//! **BOTH GUARDS ARE GONE.** The logical-size one was abandoned before commit; the shared-subterm one
//! landed and was reverted after `examples/guard_hole_probe.rs` falsified it. Every measurement in this
//! file survived both — that is the point of committing an instrument rather than a conclusion — and the
//! hazard the file demonstrates is open. See the note before "Safety" below.
//!
//! The LOGICAL-SIZE design was withdrawn because a PRE-EXISTING test — `lower.rs`'s
//! `the_guard_admits_a_core_at_the_bound_and_refuses_only_past_it` — builds a **699-element list
//! literal** (`deep_list(MAX_LAMBDA_LOWER_DEPTH - 1)`) that measures 497,691 logical nodes at a
//! logical/physical ratio of exactly 1.000x, and the guard refused it. The falsification's premise is
//! that this program is FINE — a large but working program the guard should not refuse. **Nobody had
//! ever reduced it**; the pre-existing test only asserts `lower(&at_bound).is_ok()`.
//!
//! This probe reduces it. Three questions:
//!
//!   1. Does a 699-element list literal actually reduce to normal form? Ramped from 50 upward.
//!   2. If so, where does it stop being fine? Ramped past 699 by constructing the target `LambdaTerm`
//!      directly (see `direct_list_term`'s doc for why `lower` itself cannot go past 699).
//!   3. Among allocations referenced more than once within a term (the structural-sharing proxy for
//!      `Rc::strong_count() > 1` — see `ref_counts`'s doc for why that proxy, not the count itself, is
//!      what this file can observe), what is the largest `logical_size` of any one of them? Measured
//!      for the list literal and for `blowup_probe.rs`'s nesting family at 6, 8 and 10 groups, to test
//!      the hypothesis that a big *shared* subterm — not a big term per se — is what makes reduction
//!      expensive (because `subst` duplicates a shared subterm into every occurrence it substitutes
//!      into, where an unshared subterm of the same size is copied once, by construction).
//!      **THE PARENTHESIS IS WRONG AND THE HYPOTHESIS WITH IT** — `subst`'s `Var` arm is `s.clone()`,
//!      an `Rc` bump, so occurrences are FREE; it is the `Abs` arm that copies, once per binder in the
//!      body, whether or not the variable occurs. See the note after section 6. **The measurements
//!      themselves stand** — what was falsified is the reading taken off them.
//!
//! Those three killed the old design. **Three further sections set the new one's bound**, added once
//! the answer to question 3 turned out to be the discriminator — a corpus profile, a per-level profile
//! of the family, and a single-level reduction check that establishes what "dangerous" means:
//!
//!   4. `corpus` — `max_shared` over every program in `FIRST_ORDER_DEMOS`. ANSWER: the maximum is
//!      **684**, at index 31 (`fn s0/s1/s2 … s0(4)`); **twelve of the 46 measure zero** and the other
//!      **34 share something**, in three bands. 4 for the seven `head`/`tail` programs, 400–684 for the
//!      five with a mutual-recursion group of **two or more members**, and 6 for the twenty-two
//!      remaining programs that declare a `fn` or a `while` (the recursive-binding scaffolding, whether
//!      or not anything actually recurses). Only the middle band is large, and group SIZE is why: the multiplier is
//!      `lower_group` cloning the whole group term once per member, so a *self*-recursive `fn` is a
//!      one-member group and measures 6, the same as a non-recursive one. The twelve zeros are the
//!      programs with none of those three constructs — not "everything without a recursive cycle".
//!   5. `family` — `max_shared` and `logical_size` for the nesting family at 1..=12 groups.
//!      Construction only, no reduction. ANSWER: **9,453** at 6 groups, **19,085** at 7, roughly
//!      doubling per level after that.
//!   6. `family-reduce <level>` — does ONE level keep stepping, or does a single step hang? **THE
//!      HAZARD SECTION.** ANSWER: level 6 steps steadily; level 7 pegged one core at 100% for 15+
//!      seconds inside a single step, at a peak RSS of only **93.6 MB**, and had to be killed from
//!      outside — the hang is computational, not memory. See its own doc comment for why it takes one
//!      level per process rather than ramping in a loop.
//!
//! THE GUARD THIS PROBE CALIBRATED WAS REVERTED, AND EVERY RAMP HERE REACHES ITS FULL RANGE AGAIN.
//! Between `1652e09` and the revert, `lambda/lower.rs`'s `MAX_SHARED_LOGICAL_NODES` = 10,000 refused a
//! term whose largest SHARED subterm exceeded it, so `q3`, `family` and `family-reduce` stopped at seven
//! groups printing `lower error: TooShared { .. }`. **Measurement then falsified the guard.** The
//! mechanism it was calibrated against is not the one `subst` implements, and a program with no
//! recursion at all — `let xs = [0..500); let ys = [0..500); head(xs) + head(ys)`, 4,821 bytes — measures
//! `max_shared` = 4 against that bound of 10,000 while spending 19.0 s in its FIRST β-step — **a
//! pre-2026-08-01 timing; that step is now under a millisecond, see `examples/shift_cost_probe.rs`. The
//! score of 4 is unchanged, so the falsification stands.** Instrument:
//! `examples/guard_hole_probe.rs`; record: the shared-subterm design's §10. So the figures above at
//! seven groups and beyond are **live measurements again, not a pre-guard record**. ~~"`family-reduce 7`
//! is once more the hazard this file warns about"~~ — **no longer true as of 2026-08-01: it reduces.**
//! Every WALL-CLOCK figure in this file predates the `shift` and `depth` fixes and will not reproduce;
//! every SIZE and STEP COUNT is unaffected, because `lower` builds the same term it always did and the
//! reductions take the same steps.
//!
//! `lower_src` RETURNS `Option` ANYWAY and must not go back to panicking. It used to `panic!` on `Err`,
//! which killed the documented no-argument invocation below at `q3` — before `corpus` or `family` ran at
//! all — so the headline command in this very doc block aborted. Nothing refuses these programs today,
//! but a ramp that reports a refusal and keeps its remaining rows is the shape that survives the next
//! guard as well as this one.
//!
//! # Safety — same rules as `blowup_probe.rs`, and for the same reason
//!
//! An earlier measurement on this project consumed 60 GiB of RAM and 29 GiB of swap and wedged the
//! machine, from calling `reduce_trace` (which materializes every step by contract) on a term of
//! unbounded growth. This file:
//!
//!   - **Never calls `reduce_trace`.** `LambdaCursor` steps lazily; this holds exactly one term.
//!   - **Holds one term at a time.** No `Vec` of terms, no snapshot history.
//!   - **Must be run under** `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0`.
//!   - **Ramps upward** (never jumps to the largest size first) and flushes each row before computing
//!     the next, so a killed or interrupted run still reports everything established so far.
//!
//! `MemorySwapMax=0` is not decoration: the memory cap alone lets the kernel push the excess to swap,
//! which turns a bounded failure into an unbounded one — and did, in the 60/29 GiB run above.
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
//! | `q1` | a list literal reduces, through the real `lower()` pipeline, n ≤ 699 | the n=699 row alone is 35 s |
//! | `q2a` | the 10 s crossing, between n=400 (6.25 s) and n=699 (35.2 s) | five reduction rows |
//! | `q2` | past 699, by direct construction — `lower` cannot reach these sizes | ~cubic in n; 60 s hard stop |
//! | `q2b` | where the list's own depth crosses `MAX_TERM_DEPTH` | construction only |
//! | `q3` | the max shared subterm: the list vs the family at 6, 8 and 10 groups | construction only |
//! | `corpus` | `max_shared` over all 46 `FIRST_ORDER_DEMOS` | construction only |
//! | `family` | `max_shared` over the family, all twelve levels | construction only |
//! | `family-reduce <level>` | whether ONE level keeps stepping | **hangs at level 7 — see below** |
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
//! # level that does not report Normalized. Level 7 does NOT return: a single β-step runs at 100% CPU
//! # without finishing, so this needs an EXTERNAL wall-clock kill as well as the cap, because nothing
//! # inside the process can interrupt a step once it has started. Build first, so the kill budget
//! # covers the run and not the compile.
//! cargo build --release --example list_reduction_probe -p redextape-core
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   timeout 60 ./target/release/examples/list_reduction_probe family-reduce 6
//! ```
//!
//! Nothing here is a test and nothing here is wired into CI, the same arrangement as `blowup_probe.rs`
//! and for the same reason: CI compiles examples but does not run them. It is committed so the figures
//! in both designs' tables have a re-runnable repro rather than a quoted number.
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

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

#[cfg(not(target_arch = "wasm32"))]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::time::Instant;

use redextape_core::desugar::desugar;
use redextape_core::lambda::encode;
use redextape_core::lambda::lower;
use redextape_core::lambda::term::{LambdaTerm, Node, app, logical_size, max_shared_logical_size};
use redextape_core::lambda::{MAX_REDUCTION_STEPS, Status};
use redextape_core::parser::parse;
use redextape_core::trace::LambdaCursor;

/// Per-row wall-clock budget. A ramp stops at the first row over this.
const BUDGET_S: f64 = 10.0;

fn line(s: &str) {
    println!("{s}");
    let _ = std::io::stdout().flush();
}

fn head(s: &str) {
    line("");
    line(&format!("=== {s} ==="));
}

/// Peak resident-set size recorded for this process so far, from `/proc/self/status`'s `VmHWM`
/// (kernel-maintained high-water mark, not a value this probe computes). Cumulative across the whole
/// run, not per-row — since every row runs in this same process, later rows fold in earlier ones — so
/// read consecutive rows' deltas, not each row's value in isolation.
fn peak_rss_kb() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    for l in status.lines() {
        if let Some(rest) = l.strip_prefix("VmHWM:") {
            return rest.split_whitespace().next()?.parse().ok();
        }
    }
    None
}

/// Distinct `Rc` allocations reachable from `t`. Copied from `blowup_probe.rs::physical` (not `pub`
/// there, so not importable) — the standard O(one-visit-per-allocation) walk over the DAG.
fn physical(t: &LambdaTerm) -> usize {
    let mut seen: HashSet<usize> = HashSet::new();
    let mut stack: Vec<&LambdaTerm> = vec![t];
    while let Some(n) = stack.pop() {
        if !seen.insert(n.alloc_id()) {
            continue;
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

/// Maximum nesting depth, memoized over the DAG — copied from `blowup_probe.rs::depth` (not `pub`
/// there either). This is the quantity `MAX_TERM_DEPTH` (reduce.rs, 3,000) bounds; added after Q2's
/// ramp showed `HitCap` appear at n=800 with fewer steps than a full normalization needs, which is
/// `LambdaCursor`'s depth guard firing mid-run, not the step cap.
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
/// nil)))`, built from the right exactly as `desugar.rs`'s `Expr::List` arm does.
///
/// WHY THIS BYPASSES `lower` RATHER THAN GOING THROUGH IT WITH A DIRECTLY-BUILT `Core`: a list literal
/// of `n` elements desugars to a `Core::Apply` spine of depth `n + 1` regardless of how that `Core` was
/// constructed — by the parser or by hand — and `lower_mapped`'s `too_deep_node` guard measures exactly
/// that depth, unconditionally, before any other pass runs. There is no `Core` shape denoting a
/// genuine `n`-element list literal with less nesting than `n + 1`, so for `n > 699` there is no way
/// through `lower` at all — matching the task's own anticipation ("you may need to construct the Core
/// directly... if you cannot get past 699 without fighting another guard, say so and stop"). Building
/// the target `LambdaTerm` directly is the one way past it: it produces the identical term (verified
/// below, at `n = 699`, against the real pipeline) without ever presenting `lower` with a deep `Core`.
fn direct_list_term(n: u64) -> LambdaTerm {
    let mut acc = encode::nil();
    for i in (0..n).rev() {
        acc = app(app(encode::cons(), encode::church(i)), acc);
    }
    acc
}

/// Confidence check: `direct_list_term` must build the SAME term `lower` does, at a size both can
/// reach. If this ever prints a mismatch, every row built with `direct_list_term` alone (n > 699) is
/// measuring something other than what it claims to.
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

// THE IN-DEGREE FOLD USED TO LIVE HERE, as a local `ref_counts` + `max_shared_logical_size` pair that
// called `logical_size` once per shared node — O(shared x physical). It went the way `blowup_probe.rs`'s
// local `logical()` fold went, and for the same reason: `lambda::term::max_shared_logical_size` is `pub`
// and O(physical), so two copies of one measurement is drift waiting to happen and the local one was the
// slower copy besides. That function's own doc carries what this comment used to argue — in-degree
// rather than `Rc::strong_count`, because a caller retaining snapshots would inflate the count and a
// measurement whose value changes with observers cannot gate anything.

/// `m+1` nested groups of two mutually recursive functions. COPIED from `blowup_probe.rs` (not `pub`
/// there, so not importable) — do not fork this definition; if it ever needs to change, change both
/// copies or delete this one and hand-embed the two literals this file actually needs.
fn nested_groups_src(m: u32) -> String {
    let mut body = format!("n + g{m}(n)");
    for k in (0..m).rev() {
        let j = k + 1;
        body = format!("fn f{j}(n) {{ {body} }} fn g{j}(n) {{ f{j}(n) }} g{j}(n) + g{k}(n)");
    }
    format!("fn f0(n) {{ {body} }} fn g0(n) {{ f0(n) }} g0(1)")
}

/// `None` when `lower` REFUSES the program, printing the error rather than aborting the process — the
/// same shape as `blowup_probe.rs::lower_src`, and for the same reason. While `1652e09`'s shared-subterm
/// guard was in the tree this file's own nesting family was refused from seven groups on, and a `panic!`
/// here made the documented no-argument invocation die at `q3` before `corpus` or `family` ever ran.
/// That guard has been reverted and nothing refuses these programs today, but the shape stays: a ramp
/// that reports a refusal still reports every level below it, and a ramp that panics reports nothing
/// after it.
fn lower_src(src: &str) -> Option<LambdaTerm> {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.expect("parses"));
    match lower(&core) {
        Ok(t) => Some(t),
        Err(e) => {
            line(&format!("  lower error: {e:?}"));
            None
        }
    }
}

// --- question 1 & 2: does the list reduce, and where does it stop being fine? ----------------------

/// One row: build `t`, drive a `LambdaCursor` to completion (or the cap), report steps/time/size.
/// `STEP_CAP` is generous relative to what a list literal should need (`cons` is the only redex source;
/// two β-steps collapse each cons cell's two applied arguments, so `2n` steps normalizes an n-element
/// list if nothing else is going on) but far short of `MAX_REDUCTION_STEPS`, so a construction bug that
/// produced a genuinely divergent term reports `HitCap` in seconds rather than grinding for 5,000,000
/// steps first.
/// Returns the row's wall-clock seconds, so a ramp can decide whether to attempt the next (larger, and
/// on this family's observed cubic-ish growth, much slower) size at all.
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
    line("  step cap = 10 * n (generous over the expected 2n; HitCap is itself an answer)");
    for n in [50usize, 100, 200, 400, 699] {
        let t = lowered_list_term(n);
        reduce_row(&format!("n={n}"), t, (n as u64) * 10 + 100);
    }
}

/// Extra points BELOW 699, added after the fixed 50/100/200/400/699 ramp showed n=699 already taking
/// 35 s — over `BUDGET_S` — while n=400 took 6.25 s: the crossing is somewhere in (400, 699], not past
/// it. All reachable through the real `lower()` pipeline (no guard fight needed below 700).
fn list_ramp_crossing() {
    head("Q2a — pinning the 10s crossing between n=400 (6.25s) and n=699 (35.2s)");
    for n in [450usize, 500, 550, 600, 650] {
        let t = lowered_list_term(n);
        reduce_row(&format!("n={n}"), t, (n as u64) * 10 + 100);
    }
}

/// Past 699: `direct_list_term` only (see its doc — `lower` cannot reach these sizes at all).
///
/// DELIBERATELY SHORT. By n=699 the row already took 35 s against a 10 s budget, on a roughly cubic
/// time curve (0.014 s / 0.101 s / 0.747 s / 6.254 s / 35.209 s at n = 50/100/200/400/699 — each ~2x n
/// costs ~7-8x time). Extrapolating that curve, n=1000 costs roughly 100 s and n=2000 roughly 800 s
/// (13 min); this ramp stops well short of finding out the hard way. `HARD_STOP_S` is a second, looser
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

/// RAMPS UPWARD THROUGH ALL THREE LEVELS AGAIN. The two levels this section was written around — 8 and
/// 10 groups (38,349 and 153,933) — were unreachable between `1652e09` and the shared-subterm guard's
/// revert, and are live measurements once more. Six groups leads the ramp so the section still
/// demonstrates the contrast it exists for: the list is enormous and shares nothing, the family is small
/// and shares almost half of itself. **That contrast is real and the conclusion drawn from it was not** —
/// sharing is not what makes a step expensive; see the module doc.
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
                "  STOP: lower refused the nesting family at {groups} groups. Nothing bounds sharing today — the \
                 shared-subterm guard was reverted — so this is a DEPTH refusal or a lowering change, not the \
                 expected path. Re-run `family` to see where the ramp actually stops."
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
/// construction + the O(physical) `depth` fold — so this can afford a finer sweep than the reduction
/// ramps above.
fn depth_probe() {
    const MAX_TERM_DEPTH: u32 = 3_000; // reduce.rs's constant; pub(crate), so transcribed, not imported
    head("Q2b — where does the list's own depth cross MAX_TERM_DEPTH=3000?");
    for n in [699u64, 700, 750, 800, 850, 900, 1000] {
        let t = direct_list_term(n);
        let d = depth(&t);
        line(&format!("  n={n:<5} depth={d:<6} exceeds MAX_TERM_DEPTH={}", d > MAX_TERM_DEPTH));
    }
}

// --- threshold-setting data: the corpus sharing profile & the family's danger ramp -----------------
//
// Added for the λ shared-subterm guard's threshold-setting measurement (sharing-profile.md). Three
// pieces: (1) `max_shared` over every program in `three_way_oracle.rs::FIRST_ORDER_DEMOS`, to find the
// corpus ceiling; (2) `max_shared`/logical_size over the nesting family at 1..=12 groups — cheap,
// construction only, no reduction; (3) a SEPARATE, opt-in, single-level reduction-feasibility check
// (`family-reduce <level>`) driven under a hard 20s wall budget, meant to be invoked once per level by
// an external ramp (see the doc block below) so a level that hangs or gets OOM-killed cannot prevent
// reporting the levels before it — the same "flush before the next size" discipline as the rest of this
// file, just enforced by the process boundary instead of by a between-rows flush, because a single
// β-step cannot be interrupted from inside this process (see `blowup_probe.rs`'s `part_oom` doc).

/// Verbatim copy of `tests/three_way_oracle.rs::FIRST_ORDER_DEMOS`, itself copied into
/// `examples/step_survey.rs` and `redextape-native/tests/native_oracle.rs` — copied from
/// `step_survey.rs`'s verified-synced copy rather than retyped from the canonical file, so this is a
/// copy of a copy known equal to the canonical, not a fresh transcription.
///
/// THIS COPY IS COVERED, and was not when it was committed. `three_way_oracle.rs`'s
/// `first_order_demos_stay_synced_across_all_five_copies` reads this file as text and asserts its
/// literals are byte-for-byte equal to the canonical array's; the test previously covered three copies
/// and this comment claimed it covered this one. The claim was made true rather than softened — the
/// check is textual and path-based, so a probe that CI never runs is as checkable as a test target.
/// Nothing here needs a by-hand diff before it is trusted.
///
/// FIVE, NOT FOUR: extending that test to cover this file left `examples/lambda_sharing_probe.rs`'s
/// copy still uncovered, found by the whole-branch review. See the test's own doc for the count.
const FIRST_ORDER_DEMOS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "if 1 == 2 { 10 } else { 20 }",
    "let x = 40; x + 2",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    "let add1 = |x| x + 1; add1(41)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    "fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))",
    "is_empty(nil)",
    "is_empty(cons(1, nil))",
    "[1, 2, 3]",
    "cons(1, cons(2, nil))",
    "head(cons(7, nil))",
    "tail(cons(7, nil))",
    "head(cons(1, cons(2, nil)))",
    "tail(cons(1, cons(2, nil)))",
    "head(tail(cons(1, cons(2, nil))))",
    "head([1, 2, 3])",
    "tail([1, 2, 3])",
    "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
    "let n = 5; fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } [1, 2, 3].map(|x| x + n)",
    "\
        fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
        fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
        fn add(a, b) { a + b }\n\
        fn add1(x) { x + 1 }\n\
        fold([3, 1, 2].map(add1), 0, add)",
    "fn ap(f, x) { f(x) } let add = |y| |z| y + z; ap(ap(add, 4), 5)",
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)",
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(5)",
    "fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)",
    "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \
     fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } \
     fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)",
    "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
     fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(4, id)",
    "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
     fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(3, id)",
    "fn ap(h,x){ h(x) } fn f(n){ ap(g, n) } fn g(n){ n + 1 } f(3)",
    "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } fn ap(g, x) { g(x) } ap(sum, 4) + sum(2)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
     fn add1(x) { x + 1 }\n\
     fn ap2(g, a, b) { g(a, b) }\n\
     head(map([1, 2], add1)) + head(ap2(map, [5, 6], add1))",
    "fn v(x) { x * 10 } fn b(x) { x + 1 } fn ap(g, x) { g(x) } ap(v, 1) + ap(b, 1) + b(5)",
    "fn b(x) { x + 1 } fn v(x) { x * 10 } fn ap(g, x) { g(x) } ap(v, 1) + ap(b, 1) + b(5)",
    "fn head(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } head(1) + ap(add1, 2)",
    "fn head(x) { x + 1 } fn ap(g, x) { g(x) } head(1) + ap(head, 2)",
    "let n = 7; fn tail(x) { x + 1 } fn ap(g, y) { g(y) } tail(3) + ap(tail, 2) + ap(|y| y + n, 5)",
    "fn nil(x) { x + 5 } fn ap(g, x) { g(x) } ap(nil, 0)",
    "fn nil(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } nil(1) + ap(add1, 2)",
    "fn cons(a, b) { a + b } fn ap2(g, a, b) { g(a, b) } cons(1, 2) + ap2(cons, 3, 4)",
];

/// Question A — the corpus sharing profile that sets the bound: `max_shared` and total `logical_size`
/// for every program in `FIRST_ORDER_DEMOS`. All 46 are small (the whole sweep is seconds), so this
/// runs the full corpus in one pass rather than ramping.
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
/// IT REACHES 12 AGAIN. Between `1652e09` and the shared-subterm guard's revert this ramp printed levels
/// 1–6 and stopped, because `lower` refused the family from seven groups on; that guard is gone, so the
/// L7–L12 rows in the design's §3 table are re-derivable here rather than quoted from a pre-guard run.
/// The early-stop branch below is kept for whatever bounds this next: it stops at the FIRST refusal
/// rather than skipping ahead, because `max_shared` is monotone in this family and any bound that
/// refuses one level refuses every level above it.
fn family_sharing_profile() {
    head("Family sharing profile — max_shared and logical_size, nesting family at 1..=12 groups");
    for level in 1u32..=12 {
        let src = nested_groups_src(level - 1); // nested_groups_src(m) yields m+1 groups
        let Some(t) = lower_src(&src) else {
            line(&format!(
                "  STOP: lower refused this family at {level} groups. Nothing bounds sharing today (the \
                 shared-subterm guard was reverted), so this is a depth refusal or a lowering change. \
                 max_shared is monotone here, so every level above this one is refused too."
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
/// wall-clock kill, ramped upward by the caller, stopping at the first level that does not report
/// `Normalized`. A single process cannot safely attempt levels 1..=12 in a loop and self-enforce the 20s
/// budget: a β-step cannot be interrupted from inside this process once started (`blowup_probe.rs`'s
/// `part_oom` doc — a step's cost is `|body| x |arg|`, allocated inside one `reduce_step` call), so the
/// only instrument that can reliably cut a hung step off at 20s is the OS, from outside. The in-process
/// check below (between steps) is a soft, best-effort early exit for the common case where many small
/// steps land the run over budget; the external wall-clock kill is what makes the budget HARD.
///
/// Step cap is `MAX_REDUCTION_STEPS` — the same cap the real pipeline (`run_lambda`) drives reduction
/// with — so `HitCap` here means what it would mean for a real program, not an artificially small probe
/// cap.
fn family_reduce_one(level: u32) {
    const WALL_BUDGET_S: f64 = 20.0;
    // Heartbeat so a process that gets killed mid-step (OOM, or the external wall-clock kill) still
    // leaves a transcript of how far it got: every 5,000 steps OR every 2s of wall time, whichever
    // comes first — steps alone would print nothing if a single step is what hangs, and time alone
    // would flood the log at this family's fast levels (100K+ steps/20s at level 1).
    const HEARTBEAT_STEPS: u64 = 5_000;
    const HEARTBEAT_SECS: f64 = 2.0;
    let src = nested_groups_src(level - 1);
    let Some(t) = lower_src(&src) else {
        line(&format!(
            "  level={level} REFUSED at lowering time. Nothing bounds sharing today — the shared-subterm guard \
             was reverted — so this is a depth refusal or a lowering change, not the expected path. THE HAZARD \
             THIS SECTION DEMONSTRATES IS OPEN: at level 7 a single β-step does not return."
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
    line("list_reduction_probe — does the falsifying 699-element list literal actually reduce?");
    line("  RUN UNDER: systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0");
    line(&format!(
        "  MAX_REDUCTION_STEPS={MAX_REDUCTION_STEPS} (not used directly; rows use a much smaller per-row cap)"
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
    let _ = Status::Normalized; // keep the import honest if a section above is skipped by args
}
