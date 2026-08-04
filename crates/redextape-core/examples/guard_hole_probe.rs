//! **ALL TIMINGS BELOW ARE PRE-2026-08-01 AND WILL NOT REPRODUCE.** The costs this probe was built to
//! expose were removed at the root, not guarded: `term.rs`'s `shift` was Θ(logical) and
//! sharing-destroying, and `reduce.rs`'s `depth_exceeds` walked the logical tree once per step. Both now
//! read `u32`s the constructors maintain. The counterexample below went from **19.0 s in its first
//! β-step to under a millisecond**, and the whole program normalises. See
//! `examples/shift_cost_probe.rs`.
//!
//! **The quantities are unchanged and the falsification stands** — `max_shared` is still 4, the corpus
//! maximum is still 684, and `max_shared` still collapses rather than grows. What this file establishes
//! about the two reverted guards does not depend on the timings, which is why it is corrected in place
//! rather than rewritten.
//!
//! **EXPECT THE `predicted node-copies` COLUMN TO LOOK ABSURD NOW, AND DO NOT "FIX" IT.** It is
//! `Abs(body) × |arg|`, the cost model this probe established, and it still correctly predicts what the
//! OLD `subst`/`shift` pair would copy — 773,869,551 node-copies on the n=500 two-list row. Beside it
//! that row's first β-step now reads **0.000 s**, and the ns/predicted-copy rate collapses toward zero.
//! That divergence is the fix, stated in the probe's own units: the model was never wrong about what
//! was being copied, and `shift` no longer copies it. The 23.1–23.6 ns/copy figure below is the rate
//! measured while it did.
//!
//! **The instrument that falsified `lambda/lower.rs`'s shared-subterm guard.** It asked the MIRROR
//! question the guard's own record never did. That record documents one direction of error (could a
//! legitimate program EXCEED 10,000 and be wrongly refused?). This probe asks the other — **can a
//! program pass the guard and still not return from a single β-step?** — plus the follow-on question the
//! guard's placement makes unavoidable: **does `max_shared` stay put while the term reduces, given that
//! the guard is consulted exactly once, at lowering time?**
//!
//! **Both answers were no, and `MAX_SHARED_LOGICAL_NODES` was reverted on the strength of them.** The
//! `source` section's counterexample is `let xs = [0..500); let ys = [0..500); head(xs) + head(ys)` —
//! 4,821 bytes, no recursion, no `while`, no closure — which measures `max_shared` = **4** against a
//! bound of 10,000 and **spent 19.0 s in its first β-step**; `lets` shows that cost was linear in the
//! number of let-bound lists (2.2 / 7.1 / 17.6 / 42.0 s at k = 2/4/8/16), so it is a family rather than
//! an artifact of one ceiling; and `curve` shows `max_shared` COLLAPSING rather than growing — sampled
//! after every step across six programs it is non-increasing in all six, so the lowering-time reading
//! was the peak, taken at the one moment it is maximal and destroyed by the second β-step.
//!
//! **The guard is gone; this file is kept as the re-runnable source for those figures and for the
//! 23.1–23.6 ns/node-copy rate the cost model below is calibrated on.** `MAX_SHARED_LOGICAL_NODES`
//! survives here as a transcribed HISTORICAL constant so the rows can still print the verdict the
//! reverted guard would have given — that verdict is the finding. `lower` refuses nothing on these
//! grounds today, so every section runs to its own budget rather than stopping at a refusal, and the
//! `--tm`-style "did not lower" paths in the sibling probes no longer trigger either.
//!
//! Full record: `docs/superpowers/specs/2026-07-31-lambda-shared-subterm-guard-design.md` §10.
//!
//!     systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!       cargo run --release --example guard_hole_probe -p redextape-core -- <section>…
//!
//! # The cost model this probe was written to test
//!
//! **HISTORICAL, LIKE THE TIMINGS ABOVE: `beta` no longer has this shape.** `beta(body, arg)` WAS
//! `shift(-1, 0, subst(0, shift(1, 0, arg), body))` when this model was fitted — β-fusion (2026-08-03)
//! replaced the three-pass form with one walk; see `examples/shift_cost_probe.rs`. The reasoning below
//! is kept because it is what the reverted guard was measured against, and `subst`'s `Abs` arm is still
//!
//! ```text
//! Node::Abs(n, b) => abs(Rc::clone(n), subst(j + 1, &shift(1, 0, s), b)),
//! ```
//!
//! `shift(1, 0, s)` is a FULL LOGICAL COPY of the substituted argument, and it is taken **once per
//! `Abs` node in the body — unconditionally**, before anything looks at whether the body's remaining
//! subtree mentions the variable at all. So a step's cost is
//!
//! ```text
//! |body| + (Abs nodes in body) × |arg|          (logical sizes, both factors)
//! ```
//!
//! and NOT "occurrences of the bound variable × |arg|", which is already one factor too generous and is
//! what the guard's doc comment claimed `subst` does, and not "the size of the largest shared subterm",
//! which is the quantity the guard measured. Neither factor above is a sharing property: **both are
//! large in a completely alias-free term**, whose `max_shared_logical_size` is 0.
//! `examples/lambda_sharing_probe.rs`'s PART B reached the same multiplier from the other end — it
//! attributes 86.8% of all nodes the reducer visits to `Σ abs×arg`, as its HEADLINE FINDING, on the
//! branch immediately before the guard's — so this is a re-derivation of a number that was already in
//! the tree, unconnected, while the guard was being designed against a different mechanism.
//!
//! **`Σ abs×arg` ITSELF WAS FALSIFIED ON 2026-08-02** — it is a static model of a `subst` that no longer
//! exists, over-reporting by ~1,584x since the `maxfree` short-circuits landed. That does not disturb
//! the reasoning above, which is about which FACTORS the guard should have been reading and is a claim
//! about the shape of the cost rather than its size; but a reader arriving here for the 86.8% should
//! read `shift_cost_probe.rs`'s census section first. The per-node price measured below is likewise
//! historical: it was fitted before the short-circuits.
//!
//! Measured here at **23.1–23.6 ns per predicted node-copy, constant over a 1,255x range** of predicted
//! copies, which is what makes the model a fit rather than a story.
//!
//! The corollary is what makes it a hole rather than a re-statement: the copies `subst` takes at each
//! `Abs` are TRANSIENT (each is dropped as its subtree finishes), so peak RSS is bounded by
//! `Abs-nesting-depth × |arg|`, not by the product. A step can therefore burn Θ(A × |arg|) CPU at flat
//! memory and produce an output SMALLER than its input — which is exactly the profile
//! `list_reduction_probe.rs` recorded for the nesting family at seven groups (15+ s in one step at
//! 93.6 MB peak RSS), and which no guard on a size can see.
//!
//! # Sections
//!
//! Sections are selected by argument and run in this file's order regardless of the order given.
//!
//! | arg | what it establishes | cost |
//! | --- | --- | --- |
//! | `mechanism` | one β-step's cost on HAND-BUILT alias-free terms: `max_shared` = 0, output smaller than the input, time ∝ A × \|arg\| | ~35 s, stops over budget |
//! | `source` | **the counterexample.** The same shape reached from SOURCE through parse → desugar → lower, control vs two-list at each n, with the reverted guard's verdict per row | ~30 s |
//! | `lets` | that it is a FAMILY, not one ceiling: the first step's cost is linear in the number of let-bound lists | ~70 s, stops over budget |
//! | `curve` | `max_shared_logical_size` sampled after EVERY step while real programs reduce — does the lowering-time number hold? (no: it collapses) | ~50 s |
//! | `ceiling <v>` | the largest instance `lower` accepts, at element value `v` — **deliberately over budget** | 196 s at `v` = 1500 |
//!
//! ```text
//! # every section except `ceiling`; ~3 min
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example guard_hole_probe -p redextape-core
//!
//! # any subset of them; `curve` takes an optional step cap (default 20,000)
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example guard_hole_probe -p redextape-core -- source lets curve 20000
//!
//! # THE OVER-BUDGET SECTION — one row, 196.5 s in a SINGLE β-step at n=697 (8,405 bytes of source).
//! # `ceiling` takes a required element value and is never part of the no-argument run. It needs an
//! # EXTERNAL wall-clock kill as well as the cap: nothing inside this process can interrupt a β-step
//! # once `beta` has been entered. Build first, so the kill budget covers the run and not the compile.
//! cargo build --release --example guard_hole_probe -p redextape-core
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   timeout 300 ./target/release/examples/guard_hole_probe ceiling 1500
//! ```
//!
//! # Safety — the same rules as `blowup_probe.rs` and `list_reduction_probe.rs`
//!
//! An earlier measurement on this project consumed 60 GiB of RAM and 29 GiB of swap and wedged the
//! machine. This file:
//!
//!   - **Never calls `reduce_trace`** (it materializes every step by contract). `LambdaCursor` steps
//!     lazily and holds exactly one term.
//!   - **Holds one term at a time.** No `Vec` of terms, no snapshot history.
//!   - **Must be run under** `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0`.
//!   - **Ramps upward** and flushes each row before computing the next, so a killed run still reports
//!     everything established so far. Every ramp stops at the first row over `BUDGET_S`.
//!
//! A row that OOM-kills or has to be killed from outside is a RESULT, not a failure of the probe:
//! nothing inside this process can interrupt a β-step once `beta` has been entered, which is the whole
//! point of `mechanism` and `source`. Wrap the invocation in `timeout` if you ramp past the rows
//! committed here.
//!
//! Nothing here is a test and nothing here is wired into CI — the same arrangement as the two probes
//! named above, and for the same reason: CI compiles examples (`cargo clippy --workspace
//! --all-targets`) but does not run them.
//!
//! **This file deliberately does NOT carry a copy of `FIRST_ORDER_DEMOS`.** `curve`'s rows are six
//! hand-picked programs chosen for their `max_shared` band, not a corpus sweep, so there is nothing for
//! `three_way_oracle.rs::first_order_demos_stay_synced_across_all_five_copies` to keep in sync. Keep it
//! that way: a sixth copy would have to be added to that test, and the roadmap's standing lesson is
//! about copies that do not receive corrections.
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
use std::io::Write;
use std::time::Instant;

use redextape_core::desugar::desugar;
use redextape_core::lambda::MAX_REDUCTION_STEPS;
use redextape_core::lambda::encode;
use redextape_core::lambda::lower;
use redextape_core::lambda::term::{LambdaTerm, Node, abs, app, logical_size, max_shared_logical_size};
use redextape_core::parser::parse;
use redextape_core::trace::LambdaCursor;

/// Per-row wall-clock budget. A ramp stops at the first row over this. 20 s rather than
/// `list_reduction_probe.rs`'s 10 s because the rows here are SINGLE STEPS: the interesting reading is
/// how far past a whole-program budget one step can get.
const BUDGET_S: f64 = 20.0;

/// The REVERTED guard's bound, transcribed. It is no longer in `lower.rs` and nothing enforces it;
/// every row prints its own `max_shared` against this number so a reader can see the verdict the guard
/// WOULD have given — which is the finding, not decoration. `source`'s 19.0 s row scoring 4 against
/// 10,000 is the whole falsification in one line.
const MAX_SHARED_LOGICAL_NODES: u64 = 10_000;

fn line(s: &str) {
    println!("{s}");
    let _ = std::io::stdout().flush();
}

fn head(s: &str) {
    line("");
    line(&format!("=== {s} ==="));
}

/// Peak resident-set size so far, from `/proc/self/status`'s `VmHWM`. Cumulative across the run (one
/// process, many rows), so read consecutive rows' deltas rather than a row's value in isolation.
/// Copied from `list_reduction_probe.rs`, which is not importable from another example target.
fn peak_rss_kb() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    for l in status.lines() {
        if let Some(rest) = l.strip_prefix("VmHWM:") {
            return rest.split_whitespace().next()?.parse().ok();
        }
    }
    None
}

fn rss_str() -> String {
    peak_rss_kb().map_or_else(|| "?".to_string(), |kb| format!("{:.1} MB", kb as f64 / 1024.0))
}

/// Distinct `Rc` allocations reachable from `t` — the physical size, against which `logical_size` is
/// the denoted one. Copied from `list_reduction_probe.rs`/`blowup_probe.rs` (not `pub` in either).
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
            Node::App(f, a) => {
                stack.push(f);
                stack.push(a);
            }
        }
    }
    seen.len()
}

/// `Abs` nodes in the tree this term DENOTES — the multiplier on `|arg|` in the cost model above,
/// because `subst`'s `Abs` arm re-shifts the argument once per one of these.
///
/// A DISTINCT QUANTITY FROM `logical_size`, not a local re-implementation of it: sizes come from
/// `lambda::term::logical_size` everywhere in this file, exactly as that function's `pub`-ness intends.
/// This counts one variant only, and nothing in `src/` computes it. Same shape as `logical_sizes` —
/// iterative over an explicit `(node, expanded)` stack, memoized by allocation identity, so it is
/// O(physical) and saturating rather than O(logical) and non-returning on a shared term.
fn logical_abs_count(t: &LambdaTerm) -> u64 {
    let mut counts: HashMap<usize, u64> = HashMap::new();
    let mut stack: Vec<(&LambdaTerm, bool)> = vec![(t, false)];
    while let Some((node, expanded)) = stack.pop() {
        let id = node.alloc_id();
        if counts.contains_key(&id) {
            continue;
        }
        if !expanded {
            stack.push((node, true));
            match node.node() {
                Node::Var(_) => {}
                Node::Abs(_, b) => stack.push((b, false)),
                Node::App(f, a) => {
                    stack.push((f, false));
                    stack.push((a, false));
                }
            }
            continue;
        }
        let child = |c: &LambdaTerm| counts.get(&c.alloc_id()).copied().unwrap_or(0);
        let n = match node.node() {
            Node::Var(_) => 0,
            Node::Abs(_, b) => 1u64.saturating_add(child(b)),
            Node::App(f, a) => child(f).saturating_add(child(a)),
        };
        counts.insert(id, n);
    }
    counts.get(&t.alloc_id()).copied().unwrap_or(u64::MAX)
}

fn fmt_count(v: u64) -> String {
    if v == u64::MAX { ">=2^64 (SAT)".to_string() } else { format!("{v}") }
}

/// `None` when `lower` refuses, printing the error rather than aborting. Since the shared-subterm guard
/// was reverted only `TooDeep` and the two `Unsupported` cases can fire here, and none of these sources
/// trips them — but a ramp that panics reports nothing after the panic, and that defect is exactly what
/// took `list_reduction_probe`'s documented invocation down when the guard landed.
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

/// The λ term for `[0, 1, …, n-1]`, built with the same `pub` combinators `lower` uses. Alias-free by
/// construction: every `cons`/`church` call allocates fresh nodes, so `max_shared` is 0 and physical
/// size equals logical size. Identical to `list_reduction_probe.rs::direct_list_term`, which verifies
/// the shape against the real `lower` pipeline at sizes both can reach.
fn list_term(n: u64) -> LambdaTerm {
    let mut acc = encode::nil();
    for i in (0..n).rev() {
        acc = app(app(encode::cons(), encode::church(i)), acc);
    }
    acc
}

/// Drive ONE step through `LambdaCursor` — the real reduction entry point, so the timing includes the
/// `depth_exceeds` walk the reducer actually pays, not just `beta`. Returns
/// `(seconds, stepped?, out_physical, out_logical, out_max_shared)`.
///
/// Takes `t` BY VALUE and drops it before stepping, so exactly one term is alive across the step.
fn one_step(t: LambdaTerm) -> (f64, bool, usize, u64, u64) {
    let mut cursor = LambdaCursor::new(&t, 1);
    drop(t);
    let t0 = Instant::now();
    let stepped = cursor.next().is_some();
    let dt = t0.elapsed().as_secs_f64();
    (dt, stepped, physical(cursor.term()), logical_size(cursor.term()), max_shared_logical_size(cursor.term()))
}

// --- mechanism: one β-step, hand-built, alias-free --------------------------------------------------

/// `(\x. BODY) ARG` where BODY is a closed list literal that DOES NOT MENTION `x`, and ARG is another.
/// Nothing is shared, nothing is substituted, and the output is a rebuilt copy of BODY — smaller than
/// ARG. If the cost model is right the step still costs `Abs(BODY) × |ARG|`, and this ramp shows it.
///
/// The variable's absence is the point. A guard reasoning about "duplication into every occurrence"
/// predicts this step is free.
fn mechanism() {
    head("MECHANISM — one β-step on alias-free hand-built terms; the bound variable does not occur");
    line("  t = (\\x. [0..b-1]) [0..a-1]   — max_shared(t) is 0 by construction (verified per row)");
    line("  cost model: |body| + Abs(body) × |arg|");
    line("");
    for (b, a) in [(50u64, 50u64), (100, 200), (200, 400), (400, 699), (699, 699), (699, 1400)] {
        let body = list_term(b);
        let arg = list_term(a);
        let abs_body = logical_abs_count(&body);
        let arg_logical = logical_size(&arg);
        let t = app(abs("x", body), arg);
        let shared = max_shared_logical_size(&t);
        let t_logical = logical_size(&t);
        let predicted = abs_body.saturating_mul(arg_logical);
        line(&format!(
            "  body=[0..{b}) arg=[0..{a}) | in: logical={:<10} max_shared={shared:<4} ({}) | Abs(body)={abs_body:<6} \
             |arg|={:<10} predicted node-copies={:<14}",
            fmt_count(t_logical),
            if shared > MAX_SHARED_LOGICAL_NODES { "WOULD-REFUSE" } else { "GUARD-BLIND" },
            fmt_count(arg_logical),
            fmt_count(predicted),
        ));
        let (dt, stepped, phys, logical, out_shared) = one_step(t);
        line(&format!(
            "      -> {dt:>8.3}s stepped={stepped} | out: phys={phys:<9} logical={:<10} max_shared={out_shared} \
             | {:.1} ns/predicted-copy | peak RSS={}",
            fmt_count(logical),
            if predicted == 0 { 0.0 } else { dt * 1e9 / predicted as f64 },
            rss_str(),
        ));
        if dt > BUDGET_S {
            line(&format!("  STOP: row exceeded the {BUDGET_S:.0}s budget"));
            break;
        }
    }
}

// --- source: the same shape, reached through parse → desugar → lower --------------------------------

/// Two list literals, bound with `let`, and a body that reads both. Ordinary surface syntax; nothing
/// recursive, nothing mutually recursive, no `while`.
///
/// It lowers to `(\xs. (\ys. BODY) YS) XS`, whose LEFTMOST-OUTERMOST redex is the root — so the very
/// first β-step re-shifts `XS` once per `Abs` node in `(\ys. BODY) YS`, and `YS` supplies ~6 of those
/// per element.
fn two_lists_src(n: usize) -> String {
    let items = (0..n).map(|i| i.to_string()).collect::<Vec<_>>().join(", ");
    format!("let xs = [{items}]; let ys = [{items}]; head(xs) + head(ys)")
}

/// The single-literal control: the program the withdrawn total-size guard was falsified by. Same
/// element count, one binding, so the first step has nothing large to re-shift.
fn one_list_src(n: usize) -> String {
    let items = (0..n).map(|i| i.to_string()).collect::<Vec<_>>().join(", ");
    format!("let xs = [{items}]; head(xs)")
}

fn source() {
    head("SOURCE — the counterexample: is the shape reachable through parse → desugar → lower?");
    line("  A: control    `let xs = [0..n); head(xs)`");
    line("  B: the shape  `let xs = [0..n); let ys = [0..n); head(xs) + head(ys)`");
    line("  each row lowers, prints the REVERTED guard's verdict, then takes ONE step");
    line("");
    for n in [50usize, 100, 200, 350, 500, 699] {
        let mut over_budget = false;
        for (tag, src) in [("A control ", one_list_src(n)), ("B two-list", two_lists_src(n))] {
            let Some(t) = lower_src(&src) else { continue };
            let shared = max_shared_logical_size(&t);
            let (phys_in, log_in) = (physical(&t), logical_size(&t));
            // The redex the first step will reduce is the root; its argument is the FIRST list.
            let (abs_body, arg_logical) = match t.node() {
                Node::App(f, a) => match f.node() {
                    Node::Abs(_, b) => (logical_abs_count(b), logical_size(a)),
                    _ => (0, 0),
                },
                _ => (0, 0),
            };
            let predicted = abs_body.saturating_mul(arg_logical);
            line(&format!(
                "  n={n:<4} {tag} src={:>7}B | lowered: phys={phys_in:<8} logical={:<10} max_shared={shared:<5} ({}) \
                 | Abs(body)={abs_body:<6} |arg|={:<9} predicted={}",
                src.len(),
                fmt_count(log_in),
                if shared > MAX_SHARED_LOGICAL_NODES { "WOULD-REFUSE" } else { "GUARD-BLIND" },
                fmt_count(arg_logical),
                fmt_count(predicted),
            ));
            let (dt, stepped, phys, logical, out_shared) = one_step(t);
            line(&format!(
                "      -> first step: {dt:>8.3}s stepped={stepped} | out: phys={phys:<9} logical={:<10} \
                 max_shared={out_shared} | peak RSS={}",
                fmt_count(logical),
                rss_str(),
            ));
            if dt > BUDGET_S {
                line(&format!("  STOP: n={n} {tag} exceeded the {BUDGET_S:.0}s budget in ONE STEP"));
                over_budget = true;
            }
        }
        if over_budget {
            break;
        }
    }
}

/// `k` let-bound list literals, then a body that reads all of them. The first β-step's argument is the
/// FIRST list (fixed size); its body is everything after it, so `Abs(body)` grows LINEARLY IN `k`.
///
/// This is what says the shape is a family rather than a curiosity at one ceiling: the depth budget
/// spends one `Core::Apply` level per list ELEMENT and two per `let`, so `MAX_LAMBDA_LOWER_DEPTH` = 700
/// buys either one maximal list or many medium ones, and the product `Abs(body) × |arg|` is maximized
/// well inside it.
fn many_lists_src(k: usize, n: usize) -> String {
    let items = (0..n).map(|i| i.to_string()).collect::<Vec<_>>().join(", ");
    let binds = (0..k).map(|j| format!("let x{j} = [{items}];")).collect::<Vec<_>>().join(" ");
    let reads = (0..k).map(|j| format!("head(x{j})")).collect::<Vec<_>>().join(" + ");
    format!("{binds} {reads}")
}

fn lets_ramp() {
    head("LETS — the same shape as a family: k let-bound lists, first step's cost linear in k");
    line("  `let x0 = [0..n); … let x{k-1} = [0..n); head(x0) + … + head(x{k-1})`, n = 250");
    line("");
    for k in [2usize, 4, 8, 16, 32] {
        let src = many_lists_src(k, 250);
        let Some(t) = lower_src(&src) else { continue };
        let shared = max_shared_logical_size(&t);
        let (abs_body, arg_logical) = match t.node() {
            Node::App(f, a) => match f.node() {
                Node::Abs(_, b) => (logical_abs_count(b), logical_size(a)),
                _ => (0, 0),
            },
            _ => (0, 0),
        };
        let predicted = abs_body.saturating_mul(arg_logical);
        line(&format!(
            "  k={k:<3} src={:>7}B | lowered: phys={:<9} max_shared={shared:<4} ({}) | Abs(body)={abs_body:<7} \
             |arg|={:<9} predicted={}",
            src.len(),
            physical(&t),
            if shared > MAX_SHARED_LOGICAL_NODES { "WOULD-REFUSE" } else { "GUARD-BLIND" },
            fmt_count(arg_logical),
            fmt_count(predicted),
        ));
        let (dt, stepped, phys, logical, out_shared) = one_step(t);
        line(&format!(
            "      -> first step: {dt:>8.3}s stepped={stepped} | out: phys={phys:<9} logical={:<10} \
             max_shared={out_shared} | peak RSS={}",
            fmt_count(logical),
            rss_str(),
        ));
        if dt > BUDGET_S {
            line(&format!("  STOP: k={k} exceeded the {BUDGET_S:.0}s budget in ONE STEP"));
            break;
        }
    }
}

// --- ceiling: the largest instance of the shape that `lower` still admits ---------------------------

/// The two-list program with every element the same literal `v`, so `|arg|` can be pushed up without
/// pushing the Core's nesting depth up with it: the list spine costs one `Core::Apply` level per
/// ELEMENT (`MAX_LAMBDA_LOWER_DEPTH` = 700 caps that at ~697), while a bigger element costs λ-term
/// depth only (`MAX_TERM_DEPTH` = 3,000, which the cursor checks before every step).
///
/// `Abs(body)` is ~6 per element either way — a `cons` contributes 4 binders and a Church numeral 2,
/// whatever the numeral is — so raising `v` raises the product one-for-one.
fn two_lists_flat_src(n: usize, v: u64) -> String {
    let items = vec![v.to_string(); n].join(", ");
    format!("let xs = [{items}]; let ys = [{items}]; head(xs) + head(ys)")
}

/// Quietly: does this source lower?
fn lowers(src: &str) -> Option<LambdaTerm> {
    let (prog, ds) = parse(src);
    if !ds.is_empty() {
        return None;
    }
    lower(&desugar(&prog?)).ok()
}

/// ONE row, DELIBERATELY OVER `BUDGET_S`, run last and by explicit argument: the largest instance of
/// the `source` shape that `lower` accepts. Everything is printed BEFORE the step starts, so an
/// external kill still leaves the prediction and the reverted guard's verdict on record.
///
/// Wrap in `timeout`; nothing inside this process can interrupt a β-step once `beta` is entered.
fn ceiling(v: u64) {
    head(&format!("CEILING — the largest admitted instance, element value {v} (deliberately over budget)"));
    // Descend to the largest element count `too_deep_node` still admits. Lowering is cheap next to
    // stepping, and this is the only way to state the ceiling as a fact rather than a guess.
    let mut found = None;
    for n in (600usize..=700).rev() {
        if let Some(t) = lowers(&two_lists_flat_src(n, v)) {
            found = Some((n, t));
            break;
        }
    }
    let Some((n, t)) = found else {
        line("  nothing in 600..=700 lowered — the depth guard moved; re-run `source` first");
        return;
    };
    let src_len = two_lists_flat_src(n, v).len();
    let shared = max_shared_logical_size(&t);
    let (abs_body, arg_logical) = match t.node() {
        Node::App(f, a) => match f.node() {
            Node::Abs(_, b) => (logical_abs_count(b), logical_size(a)),
            _ => (0, 0),
        },
        _ => (0, 0),
    };
    let predicted = abs_body.saturating_mul(arg_logical);
    line(&format!("  largest n that lowers = {n} ({src_len} bytes of source)"));
    line(&format!(
        "  lowered: phys={} logical={} max_shared={shared} ({}) — the reverted guard's bound was \
         {MAX_SHARED_LOGICAL_NODES}",
        physical(&t),
        fmt_count(logical_size(&t)),
        if shared > MAX_SHARED_LOGICAL_NODES { "WOULD-REFUSE" } else { "GUARD-BLIND" },
    ));
    line(&format!(
        "  first step: Abs(body)={abs_body} × |arg|={} = {} predicted node-copies; at the measured \
         23.5 ns/copy that is ~{:.0}s IN ONE STEP",
        fmt_count(arg_logical),
        fmt_count(predicted),
        predicted as f64 * 23.5e-9,
    ));
    let (dt, stepped, phys, logical, out_shared) = one_step(t);
    line(&format!(
        "      -> {dt:>8.3}s stepped={stepped} | out: phys={phys} logical={} max_shared={out_shared} | peak RSS={}",
        fmt_count(logical),
        rss_str(),
    ));
}

// --- curve: does max_shared hold while the term reduces? --------------------------------------------

/// `m+1` nested groups of two mutually recursive functions — the family whose `max_shared` sets the
/// reverted guard's bound (9,453 at 6 groups; `lower` admits every level again). COPIED from
/// `list_reduction_probe.rs`, which copied it from `blowup_probe.rs` (not `pub` in either).
fn nested_groups_src(m: u32) -> String {
    let mut body = format!("n + g{m}(n)");
    for k in (0..m).rev() {
        let j = k + 1;
        body = format!("fn f{j}(n) {{ {body} }} fn g{j}(n) {{ f{j}(n) }} g{j}(n) + g{k}(n)");
    }
    format!("fn f0(n) {{ {body} }} fn g0(n) {{ f0(n) }} g0(1)")
}

/// Reduce `t` with a `LambdaCursor`, sampling `max_shared_logical_size` of the CURRENT term every
/// `every` steps. Holds one term (the cursor's) and one sample line at a time.
///
/// The guard ran once, at lowering time. This asked whether the number it read stayed true, and it does
/// not: `max_shared` is NON-INCREASING across all six rows, so the peak is always the lowering-time
/// value. At 6 groups it reaches 0 by step 2 while individual steps are reaching ~4.2 s each by step 9.
/// A one-shot reading is taken at the single moment the quantity is largest and is destroyed by the
/// second β-step — the opposite of the monotonicity a lowering-time guard needs.
fn curve_row(label: &str, t: LambdaTerm, every: u64, step_cap: u64) {
    let start_shared = max_shared_logical_size(&t);
    let start_logical = logical_size(&t);
    let start_phys = physical(&t);
    line(&format!(
        "  {label}\n    lowered: phys={start_phys} logical={} max_shared={start_shared} ({})",
        fmt_count(start_logical),
        if start_shared > MAX_SHARED_LOGICAL_NODES { "WOULD-REFUSE" } else { "GUARD-BLIND" },
    ));
    let mut cursor = LambdaCursor::new(&t, step_cap);
    drop(t);
    let mut peak = start_shared;
    let mut samples = 0u32;
    let t0 = Instant::now();
    loop {
        if cursor.next().is_none() {
            break;
        }
        let n = cursor.steps_taken();
        if !n.is_multiple_of(every) {
            continue;
        }
        let shared = max_shared_logical_size(cursor.term());
        peak = peak.max(shared);
        // Print the first twelve samples in full, then only new peaks — a divergent program would
        // otherwise bury the answer under thousands of identical lines.
        if samples < 12 || shared > start_shared {
            line(&format!(
                "      step {n:<7} max_shared={shared:<8} phys={:<9} logical={:<12} {:>7.2}s",
                physical(cursor.term()),
                fmt_count(logical_size(cursor.term())),
                t0.elapsed().as_secs_f64(),
            ));
        }
        samples += 1;
        if t0.elapsed().as_secs_f64() > BUDGET_S {
            line(&format!("      (stopped at the {BUDGET_S:.0}s budget)"));
            break;
        }
    }
    let end_shared = max_shared_logical_size(cursor.term());
    line(&format!(
        "    after {} steps ({:?}): max_shared={end_shared} | PEAK over the run={peak} vs {start_shared} at \
         lowering | final phys={} logical={} | {:.2}s | peak RSS={}",
        cursor.steps_taken(),
        cursor.status(),
        physical(cursor.term()),
        fmt_count(logical_size(cursor.term())),
        t0.elapsed().as_secs_f64(),
        rss_str(),
    ));
    line("");
}

fn curve(step_cap: u64) {
    head("CURVE — max_shared_logical_size sampled while the term reduces");
    line("  the reverted guard read this number ONCE, at lowering time; these rows ask whether it held");
    line("  ANSWER: no — non-increasing in all six rows, so lowering time is always the peak");
    line(&format!("  step cap = {step_cap}, per-row budget = {BUDGET_S:.0}s, sampled every N steps"));
    line("");
    // Ordered smallest-first: the divergent family is last, so a killed run still has the others.
    let rows: &[(&str, String, u64)] = &[
        ("[1, 2, 3] — a corpus zero", "[1, 2, 3]".to_string(), 1),
        (
            "fn sum(n) … sum(5) — the band-6 scaffolding",
            "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)".to_string(),
            1,
        ),
        (
            "fn s0/s1/s2 … s0(4) — the CORPUS MAXIMUM (684)",
            "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \
             fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } \
             fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)"
                .to_string(),
            1,
        ),
        (
            "let mut n = 4; … while … — store-passing",
            "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc".to_string(),
            1,
        ),
        // `nested_groups_src(m)` yields m+1 groups, as `list_reduction_probe.rs` notes at its own call
        // site — so the level the reverted bound was read off (6 groups, 9,453) is `nested_groups_src(5)`.
        ("nesting family, 4 groups", nested_groups_src(3), 1),
        ("nesting family, 6 groups — the LARGEST THE GUARD ADMITTED (9,453), and divergent", nested_groups_src(5), 1),
    ];
    for (label, src, every) in rows {
        let Some(t) = lower_src(src) else {
            line(&format!("  {label}: refused by lower, skipped"));
            continue;
        };
        curve_row(label, t, *every, step_cap);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let want = |s: &str| args.is_empty() || args.iter().any(|a| a == s);
    line(&format!(
        "guard_hole_probe — MAX_SHARED_LOGICAL_NODES = {MAX_SHARED_LOGICAL_NODES} (REVERTED; this probe \
         is why — nothing enforces it), MAX_REDUCTION_STEPS = {MAX_REDUCTION_STEPS}"
    ));
    if want("mechanism") {
        mechanism();
    }
    if want("source") {
        source();
    }
    if want("lets") {
        lets_ramp();
    }
    // NOT part of the no-argument run: one row, deliberately past the budget. `ceiling <v>`.
    if args.iter().any(|a| a == "ceiling") {
        let v = args
            .iter()
            .position(|a| a == "ceiling")
            .and_then(|i| args.get(i + 1))
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        ceiling(v);
    }
    if want("curve") {
        // A cap, not `MAX_REDUCTION_STEPS`: the last row diverges by construction, and the question is
        // what `max_shared` does over a run, not how long divergence takes.
        let cap = args
            .iter()
            .position(|a| a == "curve")
            .and_then(|i| args.get(i + 1))
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(20_000);
        curve(cap);
    }
    line("");
    line(&format!("done. peak RSS={}", rss_str()));
}
