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
/// This is NOT justified by `examples/lambda_sharing_probe.rs`'s across-trace ratio (371.7x for this
/// row vs 36.9x for `sum(5)`, a ~10x spread) — that ratio is the WRONG axis for this gate. It comes
/// from the probe's structural hash-consing pass, which merges subterms that were built separately
/// but happen to be shape-identical; plain `Rc` sharing can never do that, and this gate does not
/// credit it. What this gate actually counts is distinct `Rc` allocations (the assertions below), and
/// on that axis the two programs are `sum(5)`'s 3.57x against this program's 7.44x — about a 2x
/// spread, not the probe's ~10x. Still a real difference: the two desugaring paths do share different
/// amounts of their traces, just not by the margin the across-trace number would suggest.
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

    // Measured 2026-07-31. 502,146 nodes -> 140,529 distinct allocations (3.57x). Smaller than the
    // probe's across-trace 36.9x for this row (`examples/lambda_sharing_probe.rs`) on purpose, not a
    // discrepancy: the probe's `distinct` is a structural hash-consing count (separately built but
    // shape-identical subterms collapse to one id), while this test counts distinct `Rc` allocations
    // (`alloc_id`) — what plain `Rc` sharing actually gives, a strictly weaker and smaller notion.
    // Both being > 1 confirms sharing is real at the layer each one measures.
    //
    // Cross-check, not an identity this test asserts on: the probe also reports a WITHIN-TERM ratio
    // for this row (its largest single term, 1,213 nodes -> 117 distinct, 10.37x) — a reviewer
    // reconciled the two numbers arithmetically as this gate's ratio times the probe's within-term
    // ratio: 3.57 * 10.37 ≈ 37.0, close to the probe's across-trace 36.9x above. That is only an
    // approximation (confirmed here, but it does not hold nearly as tightly for the loop program
    // below), offered as a sanity check that the two ratios aren't contradicting each other, not as a
    // proven relationship.
    assert_eq!(nodes, 502_146, "total nodes across the trace");
    assert_eq!(seen.len(), 140_529, "distinct allocations across the trace");
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

    // Measured 2026-07-31. 1,379,187 nodes -> 185,459 distinct allocations (7.44x). By the same
    // allocation-vs-structure distinction noted above (and on the doc comment for `SUBJECT_LOOP`),
    // this is smaller than the probe's 371.7x across-trace figure for this row, and larger than
    // `sum(5)`'s 3.57x here. UNVERIFIED HYPOTHESIS for that last part, not demonstrated by anything in
    // this test: the loop body may be physically shared step to step just as the recursive spine is,
    // but being a bigger term, more of it would survive untouched per step. Recorded as a guess for a
    // future reader to check, not as a fact this test establishes.
    assert_eq!(nodes, 1_379_187, "total nodes across the trace");
    assert_eq!(seen.len(), 185_459, "distinct allocations across the trace");
}
