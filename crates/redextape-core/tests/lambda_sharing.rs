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
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::collections::HashSet;

use redextape_core::desugar::desugar;
use redextape_core::lambda::{LambdaTerm, MAX_REDUCTION_STEPS, Node, lower, reduce_trace};
use redextape_core::parser::parse;

/// `sum(5)` — row 9 of `three_way_oracle.rs::FIRST_ORDER_DEMOS`.
const SUBJECT: &str = "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)";

/// `let mut n = 4; ...; while ...` — row 7 of the same corpus, and a DELIBERATELY DIFFERENT shape
/// from `sum(5)`: mutable-variable loop iteration, not recursive self-application. That is the
/// justification for a second test: a regression that broke sharing only along the loop-desugaring
/// path, and not the recursion path, would slip past a `sum(5)`-only gate.
///
/// The two axes are read separately: `examples/lambda_sharing_probe.rs`'s across-trace ratio comes
/// from a structural hash-consing pass, which merges subterms that were built separately but happen to
/// be shape-identical. Plain `Rc` sharing can never do that, and this gate does not credit it: what it
/// counts is distinct `Rc` allocations.
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
            Node::App(f, a, _) => {
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

    // 502,146 nodes -> 17,920 distinct allocations (28.02x).
    //
    // The signature that matters is the pairing, not either number: the node total holds to the node
    // while the allocation count falls. That pairing is what distinguishes a REPRESENTATION change from
    // a SEMANTIC one — an identical reduction, step for step and node for node, held in less memory. A
    // change that altered the reduction would move the node total too.
    //
    // The mechanism, not this number, is pinned by
    // `term.rs::a_beta_step_shares_one_allocation_across_every_occurrence_of_an_open_argument`.
    //
    // The probe's across-trace ratio for this row (`examples/lambda_sharing_probe.rs`) is a
    // DIFFERENT AXIS, not a target: its `distinct` is a structural hash-consing count (separately
    // built but shape-identical subterms collapse to one id), while this counts distinct `Rc`
    // allocations. Plain `Rc` cannot merge separately-built terms and this gate does not credit it.
    assert_eq!(nodes, 502_146, "total nodes across the trace");
    assert_eq!(seen.len(), 17_920, "distinct allocations across the trace");
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

    // 1,379,187 nodes -> 4,305 distinct allocations (320.37x).
    //
    // The same signature as the `sum(5)` gate above: the node total holds while the allocation count falls.
    assert_eq!(nodes, 1_379_187, "total nodes across the trace");
    assert_eq!(seen.len(), 4_305, "distinct allocations across the trace");
}
