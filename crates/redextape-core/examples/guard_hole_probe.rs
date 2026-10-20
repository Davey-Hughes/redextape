//! **Do not "fix" the `predicted node-copies` column.** It is `Abs(body) × |arg|`, the cost model this
//! probe tests, and it predicts what the OLD `subst`/`shift` pair would copy. Beside it a row's first
//! β-step reads near zero, and the ns/predicted-copy rate collapses toward zero, because the shipped
//! `shift` does not make those copies. The 23.1–23.6 ns/copy figure below is the OLD pair's rate.
//!
//! **This probe asks the MIRROR question of `lambda/lower.rs`'s reverted shared-subterm guard.** The
//! guard's own record documents one direction of error (could a legitimate program EXCEED 10,000 and be
//! wrongly refused?); this asks the other — **can a program pass the guard and still not return from a
//! single β-step?** — plus the follow-on question the guard's placement makes unavoidable: **does
//! `max_shared` stay put while the term reduces, given that the guard is consulted exactly once, at
//! lowering time?**
//!
//! **The first answer is yes for the OLD `subst`/`shift` pair (`source`) and the second is no (`curve`),
//! which is why `lower.rs` has no `MAX_SHARED_LOGICAL_NODES`.** `MAX_SHARED_LOGICAL_NODES` is here as a
//! transcribed constant so the rows can print the verdict the reverted guard would have given — that
//! verdict is the finding. `lower` refuses nothing on these grounds, so every section runs to its own
//! budget rather than stopping at a refusal, and the `--tm`-style "did not lower" paths in the sibling
//! probes do not trigger either.
//!
//! Full record: `docs/superpowers/specs/2026-07-31-lambda-shared-subterm-guard-design.md` §10.
//!
//!     systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!       cargo run --release --example guard_hole_probe -p redextape-core -- <section>…
//!
//! # The cost model this probe tests
//!
//! **This model is of the three-pass `beta`, `shift(-1, 0, subst(0, shift(1, 0, arg), body))`; the
//! shipped `beta` is one walk.** See `examples/shift_cost_probe.rs`. `subst`'s `Abs` arm is
//!
//! ```text
//! Node::Abs(n, b) => abs(Rc::clone(n), subst(j + 1, &shift(1, 0, s), b)),
//! ```
//!
//! Without the `maxfree` short-circuits, `shift(1, 0, s)` is a FULL LOGICAL COPY of the substituted
//! argument, taken **once per `Abs` node in the body — unconditionally**, before anything looks at
//! whether the body's remaining subtree mentions the variable at all. So a step's cost is
//!
//! ```text
//! |body| + (Abs nodes in body) × |arg|          (logical sizes, both factors)
//! ```
//!
//! and NOT "occurrences of the bound variable × |arg|", which is already one factor too generous, and
//! not "the size of the largest shared subterm", which is the quantity the guard measured. Neither factor
//! above is a sharing property: **both are large in a completely alias-free term**, whose
//! `max_shared_logical_size` is 0. `examples/lambda_sharing_probe.rs`'s PART B reached the same
//! multiplier, `Σ abs×arg`, from the other end.
//!
//! `Σ abs×arg` is itself a static model of a `subst` without the `maxfree` short-circuit (see
//! `shift_cost_probe.rs`'s census section). That does not disturb the reasoning above, which is
//! about which FACTORS the guard should have been reading and is a claim about the shape of the
//! cost rather than its size. The per-node price measured below is likewise the OLD pair's.
//!
//! Measured here at **23.1–23.6 ns per predicted node-copy, constant over a 1,255x range** of predicted
//! copies, which is what makes the model a fit rather than a story.
//!
//! The corollary is what makes it a hole rather than a re-statement: the copies the model's `subst` takes
//! at each `Abs` are TRANSIENT (each is dropped as its subtree finishes), so peak RSS is bounded by
//! `Abs-nesting-depth × |arg|`, not by the product. A step can therefore burn Θ(A × |arg|) CPU at flat
//! memory and produce an output SMALLER than its input — a profile no guard on a size can see.
//!
//! # Sections
//!
//! Sections are selected by argument and run in this file's order regardless of the order given.
//!
//! - `mechanism`: one β-step's cost on HAND-BUILT alias-free terms: `max_shared` = 0, output smaller
//!   than the input, time ∝ A × |arg|
//! - `source`: **the counterexample.** The same shape reached from SOURCE through parse → desugar →
//!   lower, control vs two-list at each n, with the reverted guard's verdict per row
//! - `lets`: that it is a FAMILY, not one ceiling: the first step's cost is linear in the number of
//!   let-bound lists
//! - `curve`: `max_shared_logical_size` sampled after EVERY step while real programs reduce — does the
//!   lowering-time number hold? (no: it collapses)
//! - `ceiling <v>`: the largest instance `lower` accepts, at element value `v` — not held to `BUDGET_S`
//!
//! ```text
//! # every section except `ceiling`
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example guard_hole_probe -p redextape-core
//!
//! # any subset of them; `curve` takes an optional step cap (default 20,000)
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example guard_hole_probe -p redextape-core -- source lets curve 20000
//!
//! # THE UNBUDGETED SECTION — one row, a SINGLE β-step at the largest instance `lower` accepts.
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
//! This file:
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
//! `three_way_oracle.rs::first_order_demos_stay_synced_across_every_copy` to keep in sync. Keep it
//! that way: another copy would have to be added to that test, and the roadmap's standing lesson is
//! about copies that do not receive corrections.
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

use std::collections::HashMap;
use std::time::Instant;

use redextape_core::desugar::desugar;
use redextape_core::lambda::MAX_REDUCTION_STEPS;
use redextape_core::lambda::encode;
use redextape_core::lambda::lower;
use redextape_core::lambda::term::{LambdaTerm, Node, abs, app, logical_size, max_shared_logical_size};
use redextape_core::parser::parse;
use redextape_core::trace::LambdaCursor;

#[path = "common/allocator.rs"]
mod allocator;
#[path = "common/footprint.rs"]
mod footprint;
#[path = "common/nested_groups.rs"]
mod nested_groups;
#[path = "common/text.rs"]
mod text;

use footprint::{lower_src, peak_rss_kb, physical};
use nested_groups::nested_groups_src;
use text::{head, line};

/// Per-row wall-clock budget. A ramp stops at the first row over this. 20 s rather than
/// `list_reduction_probe.rs`'s 10 s because the rows here are SINGLE STEPS: the interesting reading is
/// how far past a whole-program budget one step can get.
const BUDGET_S: f64 = 20.0;

/// The REVERTED guard's bound, transcribed. It is not in `lower.rs` and nothing enforces it;
/// every row prints its own `max_shared` against this number so a reader can see the verdict the guard
/// WOULD have given — which is the finding, not decoration.
const MAX_SHARED_LOGICAL_NODES: u64 = 10_000;

fn rss_str() -> String {
    peak_rss_kb().map_or_else(|| "?".to_string(), |kb| format!("{:.1} MB", kb as f64 / 1024.0))
}

/// `Abs` nodes in the tree this term DENOTES — the multiplier on `|arg|` in the cost model above,
/// because the cost model's `subst` re-shifts the argument once per one of these.
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
                Node::App(f, a, _) => {
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
            Node::App(f, a, _) => child(f).saturating_add(child(a)),
        };
        counts.insert(id, n);
    }
    counts.get(&t.alloc_id()).copied().unwrap_or(u64::MAX)
}

fn fmt_count(v: u64) -> String {
    if v == u64::MAX { ">=2^64 (SAT)".to_string() } else { format!("{v}") }
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
/// `depth_exceeds` check the reducer actually pays, not just `beta`. Returns
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
/// It lowers to `(\xs. (\ys. BODY) YS) XS`, whose LEFTMOST-OUTERMOST redex is the root — so under the
/// cost model, the very first β-step re-shifts `XS` once per `Abs` node in `(\ys. BODY) YS`, and `YS`
/// supplies ~6 of those per element.
fn two_lists_src(n: usize) -> String {
    let items = (0..n).map(|i| i.to_string()).collect::<Vec<_>>().join(", ");
    format!("let xs = [{items}]; let ys = [{items}]; head(xs) + head(ys)")
}

/// The single-literal control. Same element count, one binding, so the first step has nothing large
/// to re-shift.
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
                Node::App(f, a, _) => match f.node() {
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
            Node::App(f, a, _) => match f.node() {
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

/// ONE row, NOT HELD TO `BUDGET_S`, run last and by explicit argument: the largest instance of
/// the `source` shape that `lower` accepts. Everything is printed BEFORE the step starts, so an
/// external kill still leaves the prediction and the reverted guard's verdict on record.
///
/// Wrap in `timeout`; nothing inside this process can interrupt a β-step once `beta` is entered.
fn ceiling(v: u64) {
    head(&format!("CEILING — the largest admitted instance, element value {v} (not held to the budget)"));
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
        Node::App(f, a, _) => match f.node() {
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

/// Reduce `t` with a `LambdaCursor`, sampling `max_shared_logical_size` of the CURRENT term every
/// `every` steps. Holds one term (the cursor's) and one sample line at a time.
///
/// A lowering-time guard reads `max_shared` once; this samples it while the term reduces, to check
/// whether that reading stays true.
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
        "guard_hole_probe — MAX_SHARED_LOGICAL_NODES = {MAX_SHARED_LOGICAL_NODES} (REVERTED; nothing \
         enforces it), MAX_REDUCTION_STEPS = {MAX_REDUCTION_STEPS}"
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
    // NOT part of the no-argument run: one row, not held to the budget. `ceiling <v>`.
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
