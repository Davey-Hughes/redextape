//! The sharing gate: `reduce_trace`'s snapshots share their subterms rather than copying them.
//!
//! DETERMINISTIC ON PURPOSE. This tree gates on counts and reports wall-clock in `examples/`
//! (`step_survey.rs`, `width_report.rs`, `lambda_sharing_probe.rs`), because a timing gate is a
//! flaky gate. The count below is machine-independent: it is a property of the reduction, not of
//! how fast the machine ran it.
//!
//! Two assertions, and the second is the one that bites:
//!
//!   1. NON-VACUITY — distinct allocations are strictly below the total node count. A representation
//!      that shares nothing fails here.
//!   2. A PINNED NUMBER, committed alongside the node total. A regression MOVES this number rather
//!      than merely staying under some threshold, which is what makes it a gate and not a smoke
//!      test. Same idiom as this tree's committed step counts.

// Test target: `clippy.toml`'s `allow-*-in-tests` keys do not reach free helpers in a `tests/`
// target, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::HashSet;

use redextape_core::desugar::desugar;
use redextape_core::lambda::term::Node;
use redextape_core::lambda::{LambdaTerm, MAX_REDUCTION_STEPS, lower, reduce_trace};
use redextape_core::parser::parse;

/// `sum(5)` — row 9 of `three_way_oracle.rs::FIRST_ORDER_DEMOS`, and the program the Plan 4 design
/// quoted its λ figures from. Chosen so this gate and that table describe the same thing.
const SUBJECT: &str = "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)";

/// `let mut n = 4; ...; while ...` — row 7 of the same corpus, and a DELIBERATELY DIFFERENT shape
/// from `sum(5)`: mutable-variable loop iteration, not recursive self-application. That is the
/// justification for a second test: a regression that broke sharing only along the loop-desugaring
/// path, and not the recursion path, would slip past a `sum(5)`-only gate.
///
/// The axis distinction still holds and is still the reason to read the two numbers separately:
/// `examples/lambda_sharing_probe.rs`'s across-trace ratio (371.7x for this row vs 36.9x for `sum(5)`,
/// a ~10x spread) comes from a structural hash-consing pass, which merges subterms that were built
/// separately but happen to be shape-identical. Plain `Rc` sharing can never do that, and this gate
/// does not credit it: what it counts is distinct `Rc` allocations.
///
/// **THE CONCLUSION THIS PARAGRAPH USED TO DRAW IS NOW FALSE, and the reversal is the point.** It read
/// ~~"on that axis the two programs are `sum(5)`'s 3.57x against this program's 7.44x — about a 2x
/// spread, not the probe's ~10x"~~, and treated that gap as the gate correcting an inflated figure.
/// Since the `maxfree` short-circuit in `term.rs` (`shift` and `subst` return their argument's
/// allocation when no free index is in range), the gate measures **26.51x against 316.04x — a 11.92x
/// spread, against the probe's 10.07x**. The two axes now agree closely.
///
/// What changed is not the measurement but the reducer: `shift` used to rebuild every node it visited,
/// so a β-step's output aliased nothing and most of what `Rc` COULD have shared was destroyed before
/// this gate ever counted it. The hash-consing figure was the better estimate of the available sharing
/// all along; the allocation count was low because the reducer was throwing sharing away, not because
/// `Rc` cannot express it.
///
/// Two rows, not five: these two paths are what this gate is meant to distinguish between, and more
/// rows would mostly repeat one of these two facts rather than test something new.
const SUBJECT_LOOP: &str = "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc";

/// Every node of `t`, walked iteratively. Recursion would overflow on a deep term, which is exactly
/// the class of term this file is about.
fn walk(t: &LambdaTerm, nodes: &mut u64, seen: &mut HashSet<usize>) {
    let mut stack = vec![t];
    while let Some(n) = stack.pop() {
        *nodes += 1;
        seen.insert(n.alloc_id());
        match n.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => stack.push(b),
            Node::App(f, a) => {
                stack.push(f);
                stack.push(a);
            }
        }
    }
}

#[test]
fn reduce_trace_shares_its_snapshots() {
    let (prog, ds) = parse(SUBJECT);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let term = lower(&desugar(&prog.unwrap())).expect("sum(5) lowers");
    let trace = reduce_trace(&term, MAX_REDUCTION_STEPS);
    // `trace` must stay alive for the rest of this function. `alloc_id()` (used in `walk`, below) is
    // an allocation address, not a structural identity: two terms sharing one are the same allocation
    // only WHILE BOTH ARE ALIVE. Once an allocation is freed, the allocator is free to hand that exact
    // address to a later, unrelated allocation, and this walk would then count two different terms as
    // "shared" by coincidence rather than by fact. Holding `trace` for the whole walk is what makes
    // the counts below mean something, not a number that happens to fall out. Rust's ownership rules
    // already enforce this here — `walk` only borrows from `trace`, it never takes ownership, so
    // nothing below can run after `trace` is gone — so this comment records why the code has to keep
    // this shape, not a hazard the reader needs to actively guard against.

    let mut nodes = 0u64;
    let mut seen = HashSet::new();
    for s in &trace.steps {
        walk(&s.term, &mut nodes, &mut seen);
    }
    walk(&trace.normal_form, &mut nodes, &mut seen);

    // 1. Non-vacuity. A representation that shares nothing has distinct == nodes.
    assert!((seen.len() as u64) < nodes, "no sharing at all: {} distinct allocations for {nodes} nodes", seen.len());

    // Measured 2026-08-01. 502,146 nodes -> 18,939 distinct allocations (26.51x).
    //
    // **THE NODE TOTAL IS UNCHANGED AND THE ALLOCATION COUNT FELL 7.42x** (was 140,529, measured
    // 2026-07-31). Those two facts together are the evidence that the `maxfree` short-circuit in
    // `term.rs` is a representation change and not a semantic one: the same reduction, step for step
    // and node for node, held in a seventh of the memory. `shift` and `subst` now return their
    // argument's allocation when no free index is in range, instead of rebuilding a structurally
    // identical copy — so a β-step preserves sharing rather than materialising the logical expansion.
    // Every oracle in this tree passed unedited across that change.
    //
    // The probe's across-trace 36.9x for this row (`examples/lambda_sharing_probe.rs`) is still a
    // DIFFERENT AXIS, not a target: its `distinct` is a structural hash-consing count (separately
    // built but shape-identical subterms collapse to one id), while this counts distinct `Rc`
    // allocations. Plain `Rc` cannot merge separately-built terms and this gate does not credit it.
    // The gap is now 26.51x against 36.9x rather than 3.57x against 36.9x, which says most of what
    // hash-consing was finding was sharing the reducer had destroyed rather than sharing `Rc` cannot
    // express.
    //
    // NOT RE-DERIVED: the old arithmetic cross-check (this gate's ratio x the probe's within-term
    // 10.37x ≈ the probe's across-trace figure) was calibrated on the pre-fix numbers, and the
    // within-term ratio moved too. It is dropped rather than restated with new numbers, because
    // nothing here re-measured it. Run the probe if you want it back.
    assert_eq!(nodes, 502_146, "total nodes across the trace");
    assert_eq!(seen.len(), 18_939, "distinct allocations across the trace");
}

#[test]
fn reduce_trace_shares_its_snapshots_for_a_loop_shaped_program() {
    let (prog, ds) = parse(SUBJECT_LOOP);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let term = lower(&desugar(&prog.unwrap())).expect("the while-loop program lowers");
    let trace = reduce_trace(&term, MAX_REDUCTION_STEPS);
    // `trace` must stay alive for the rest of this function — same reason as the identical line in
    // `reduce_trace_shares_its_snapshots`, above: `alloc_id()` is an allocation address, meaningful as
    // an identity only while both sides are alive.

    let mut nodes = 0u64;
    let mut seen = HashSet::new();
    for s in &trace.steps {
        walk(&s.term, &mut nodes, &mut seen);
    }
    walk(&trace.normal_form, &mut nodes, &mut seen);

    // 1. Non-vacuity. A representation that shares nothing has distinct == nodes.
    assert!((seen.len() as u64) < nodes, "no sharing at all: {} distinct allocations for {nodes} nodes", seen.len());

    // Measured 2026-08-01. 1,379,187 nodes -> 4,364 distinct allocations (316.04x).
    //
    // **THE NODE TOTAL IS UNCHANGED AND THE ALLOCATION COUNT FELL 42.5x** (was 185,459, measured
    // 2026-07-31) — the same representation-not-semantics evidence as the `sum(5)` gate above, and a
    // far larger drop. This is the row where the reducer was destroying the most sharing: 316.04x is
    // now within striking distance of the probe's 371.7x hash-consing figure for this row, where
    // before it was 7.44x against that same 371.7x.
    //
    // THE HYPOTHESIS THIS COMMENT USED TO CARRY IS NOW SUPPORTED, having been recorded as a guess.
    // It read: "the loop body may be physically shared step to step just as the recursive spine is,
    // but being a bigger term, more of it would survive untouched per step." That is what a 42.5x drop
    // against `sum(5)`'s 7.42x says — the bigger term had more to preserve, and preserving it is
    // exactly what the short-circuit added. Still not PROVEN by this test, which counts allocations
    // rather than attributing them; it is a guess the numbers now favour instead of one they were
    // silent on.
    assert_eq!(nodes, 1_379_187, "total nodes across the trace");
    assert_eq!(seen.len(), 4_364, "distinct allocations across the trace");
}
