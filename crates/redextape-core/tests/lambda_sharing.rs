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
/// allocation when no free index is in range) and β-fusion after it, the gate measures **28.02x against
/// 320.37x — a 11.43x spread, against the probe's 10.07x**. The two axes now agree closely.
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

    // Measured 2026-08-03. 502,146 nodes -> 17,920 distinct allocations (28.02x).
    //
    // **THE SAME SIGNATURE HAS NOW OCCURRED TWICE, AND IT IS THE SIGNATURE THAT MATTERS RATHER THAN
    // EITHER NUMBER: the node total holds to the node while the allocation count falls.** That pairing
    // is what distinguishes a REPRESENTATION change from a SEMANTIC one — an identical reduction, step
    // for step and node for node, held in less memory. A change that altered the reduction would move
    // the node total too, and none of the three did.
    //
    //   140,529 (2026-07-31)  -> 18,939 (2026-08-01), a 7.42x fall: the `maxfree` short-circuit.
    //                            `shift` and `subst` began returning their argument's allocation when
    //                            no free index is in range, instead of rebuilding a structurally
    //                            identical copy, so a β-step preserves sharing rather than
    //                            materialising the logical expansion.
    //   18,939  (2026-08-01)  -> 17,920 (2026-08-03), a further 5.4% fall: β-FUSION.
    //
    // The 7.42x figure is left attributed to the change that produced it rather than restated against
    // the new total, because nothing re-derived it — same discipline as the "NOT RE-DERIVED" note below.
    //
    // **WHY FUSION MOVED THIS NUMBER AT ALL, which was not predicted and is worth stating precisely.**
    // `beta` was `shift(-1, 0, subst(0, shift(1, 0, arg), body))`, and that closing `shift(-1, 0, ·)`
    // walked `subst`'s RESULT AS A TREE. `shift` does not memoise, so where `subst` had inserted ONE
    // shared allocation of the argument at N occurrences — its hit arm is `s.clone()`, a refcount bump —
    // the closing shift descended into each occurrence separately and rebuilt N independent copies. It
    // was flattening the DAG `subst` had just built. The fused walk never makes that pass: it inserts
    // the argument by handle and never revisits it, so the N occurrences stay one allocation, and at
    // depth 0 the result inherits the CALLER's own `arg` rather than a copy of a copy.
    //
    // The effect is bounded, which is why this is 5.4% and not a collapse. It is nil for a closed
    // argument (`shift(1, 0, arg)` is a refcount bump and the closing shift's own prune returns the
    // handle — and 88.4% of corpus β-steps have one), and nil for occurrences at DIFFERENT depths (each
    // depth needs its own lift either way).
    //
    // **WHICH OF THE TWO SUB-MECHANISMS DOMINATES WAS MEASURED, AND IT IS NOT THE OBVIOUS ONE.** An
    // earlier draft of this block said the effect "is confined to multiple occurrences at the SAME
    // depth". That is the smaller half by an order of magnitude. Switching `beta` between four modes
    // and re-running this gate isolates them:
    //
    //   three-pass                                          18,939   (4,364 on the loop gate)
    //   fused spine, three-pass argument at occurrence sites 18,939   (4,364)  <- spine contributes 0
    //   + share ONE FRESH copy across depth-0 occurrences    18,939   (4,364)  <- sharing alone: 0
    //   + inherit the caller's `arg` at depth 0 instead      18,104   (4,308)
    //   shipped fused                                        17,920   (4,305)
    //
    // So **835 of the 1,019 (82%) — and 56 of the 59 (95%) on the loop gate — is the depth-0 case,
    // where the result inherits the CALLER's own `arg` allocation. That needs only a SINGLE
    // occurrence.** Multi-occurrence sharing at the same depth is worth 184 here and 3 there, all of it
    // at depth >= 1. The spine contributes nothing: a fused walk that differs from three-pass only at
    // occurrence sites reproduces both pre-fusion pins exactly, which is also what says there is no
    // unexplained residue in this drop.
    //
    // **THE THIRD ROW IS THE ONE THAT ISOLATES THE CLAIM, AND AN EARLIER DRAFT OF THIS TABLE OMITTED
    // IT.** Without it the 835 is splittable between inheriting and depth-0 multi-occurrence sharing,
    // and the sentence above would be asserted rather than shown. Sharing N occurrences onto one FRESH
    // copy — the obvious reading of "fusion shares more" — is worth exactly nothing on both gates. What
    // pays is not making the copy at all.
    //
    // The mechanism, not this number, is pinned by
    // `term.rs::a_beta_step_shares_one_allocation_across_every_occurrence_of_an_open_argument` — and
    // that test carries a depth >= 1 fixture precisely because a depth-0-only test passes while the
    // depth >= 1 half regresses, which is how this attribution came to be checked at all.
    //
    // Every oracle in this tree passed unedited across both changes.
    //
    // The probe's across-trace 36.9x for this row (`examples/lambda_sharing_probe.rs`) is still a
    // DIFFERENT AXIS, not a target: its `distinct` is a structural hash-consing count (separately
    // built but shape-identical subterms collapse to one id), while this counts distinct `Rc`
    // allocations. Plain `Rc` cannot merge separately-built terms and this gate does not credit it.
    // The gap is now 28.02x against 36.9x rather than 3.57x against 36.9x, which says most of what
    // hash-consing was finding was sharing the reducer had destroyed rather than sharing `Rc` cannot
    // express. Fusion closed a further slice of that same gap, and for the same reason.
    //
    // NOT RE-DERIVED: the old arithmetic cross-check (this gate's ratio x the probe's within-term
    // 10.37x ≈ the probe's across-trace figure) was calibrated on the pre-fix numbers, and the
    // within-term ratio moved too. It is dropped rather than restated with new numbers, because
    // nothing here re-measured it. Run the probe if you want it back.
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

    // Measured 2026-08-03. 1,379,187 nodes -> 4,305 distinct allocations (320.37x).
    //
    // **THE NODE TOTAL IS UNCHANGED AND THE ALLOCATION COUNT FELL AGAIN** — the same
    // representation-not-semantics evidence as the `sum(5)` gate above, on the same two dates:
    //
    //   185,459 (2026-07-31) -> 4,364 (2026-08-01), a 42.5x fall: the `maxfree` short-circuit. This is
    //                           the row where the reducer was destroying the most sharing.
    //   4,364   (2026-08-01) -> 4,305 (2026-08-03), a further 1.4% fall: β-fusion, by the DAG-flattening
    //                           mechanism set out at length in the `sum(5)` block above.
    //
    // 320.37x is now within striking distance of the probe's 371.7x hash-consing figure for this row,
    // where before the short-circuit it was 7.44x against that same 371.7x.
    //
    // Fusion moves this row LESS than `sum(5)` (1.4% against 5.4%), which is consistent with the
    // mechanism rather than incidental to it — but **the reason is the depth-0 case, not the
    // same-depth multi-occurrence case**, and an earlier draft of this sentence had it the other way
    // round. The four-mode switch reported in the `sum(5)` block splits this row 56 / 3: 95% of the
    // fall is β-steps whose result inherits the CALLER's own open `arg` allocation, which needs only a
    // single occurrence, and 3 allocations are multi-occurrence sharing at depth >= 1. So what a
    // loop-desugared program makes fewer of, relative to a recursive one, is **β-steps on an open
    // argument at all** — not steps with repeated occurrences of one. A change that moved the two rows
    // in proportion would have been a different mechanism from the one diagnosed.
    //
    // THE HYPOTHESIS THIS COMMENT USED TO CARRY IS NOW SUPPORTED, having been recorded as a guess.
    // It read: "the loop body may be physically shared step to step just as the recursive spine is,
    // but being a bigger term, more of it would survive untouched per step." That is what a 42.5x drop
    // against `sum(5)`'s 7.42x says — the bigger term had more to preserve, and preserving it is
    // exactly what the short-circuit added. Still not PROVEN by this test, which counts allocations
    // rather than attributing them; it is a guess the numbers now favour instead of one they were
    // silent on.
    assert_eq!(nodes, 1_379_187, "total nodes across the trace");
    assert_eq!(seen.len(), 4_305, "distinct allocations across the trace");
}
