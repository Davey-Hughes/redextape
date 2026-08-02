//! Exhaustive differential and lemma coverage for `term.rs`'s `subst` and `shift`.
//!
//! **THE SUBJECT OF THIS FILE INVERTED ON 2026-08-02, AND THAT IS THE POINT OF THE REWRITE.** It used
//! to validate a PROPOSED rewrite — carrying `subst`'s per-binder re-shift down as one `shift(d, 0, ·)`
//! — against the shipped function, on the way to shipping it. The rewrite was falsified on cost (see
//! below), so the proposal is gone and the code that expressed it is kept and **re-pointed**: the two
//! implementations here are now REFERENCES, and the shipped `subst` is the thing under test.
//!
//! That is not a salvage. It is what the file should always have been. `term.rs`'s `subst` carries two
//! `maxfree` short-circuits and returns handles rather than rebuilding; a naive textbook implementation
//! that does neither is exactly the independent oracle such a function needs, and having two of them —
//! one eager, one lifted — that must both agree with it over 355,840 enumerated triples is stronger
//! coverage than the one-directional check this file used to run.
//!
//! **WHY THE REWRITE IS DEAD, in the two numbers that killed it.** It was sized against
//! `Σ abs×arg` = 70,542,349 corpus-wide, a STATIC model (`count_abs(body) × size_of(arg)`) written
//! against a `subst` whose `Abs` arm copied unconditionally. Measured against what `subst` now
//! allocates, the same re-shift is **44,539** — a **1,584x** over-count — and `subst` in total costs
//! 68,188. That is partly because **88.4% of β-steps
//! have a closed argument** and `shift(1, 0, arg)` is a refcount bump for those. On the nested-group
//! family the rewrite measures **0.99x: a regression**, because `subst` descends only through the
//! binders on the path to an occurrence, so binders-crossed is smaller than occurrences and paying per
//! occurrence costs more than paying per binder. Instrument: `examples/shift_cost_probe.rs`'s census
//! section; full statement in the perf design's §10.
//!
//! **THE CANDIDATE WAS ALSO A STRAWMAN BY THEN, and this is why it must not be read as a benchmark.**
//! `subst_lifted` below has neither short-circuit and its `Var(k)` arm allocates, because it was
//! written against the `subst` that existed before they landed. Nobody would have shipped it as
//! written. As a *reference implementation* that naivety is a virtue and it is deliberately preserved;
//! as a *cost model* it was never valid, and the census prices the merged version instead.
//!
//! Three properties, each pinned separately because a failure in one points somewhere different:
//!
//!   1. **Shift-additivity** (`shift(a, c, shift(b, c, t)) == shift(a + b, c, t)` for `a, b >= 0`) — a
//!      property of the shipped `shift`, now standing on its own rather than as a proof obligation for
//!      a rewrite. 53,376 cases.
//!   2. **The differential** — shipped `subst` against BOTH references, exhaustive over every `t` to 6
//!      nodes / 4 indices and every `s` to 4 nodes, `j` in `0..=3`. 355,840 triples each.
//!   3. **The sharing pins.** Structural `==` cannot tell a returned handle from a deep copy, so the
//!      differential above would pass just as happily with every short-circuit deleted. `alloc_id()` is
//!      the only thing that distinguishes them.

// Test target: `clippy.toml`'s `allow-*-in-tests` keys reach a `#[test]` function's own body but not
// free helpers in a `tests/` target (its doc comment explains why), and the enumeration below is all
// free helpers. Exemption stated per target, same idiom as `lambda_sharing.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::rc::Rc;

use redextape_core::lambda::term::{LambdaTerm, Node, abs, app, shift, subst, var};

/// Reference 1: the textbook eager `subst`, with NO short-circuit and no handle reuse — every arm
/// allocates, and the argument is re-shifted under every `Abs` whether or not the variable occurs
/// below it. This is `term.rs`'s `subst` as it stood before 2026-08-01, kept as an oracle precisely
/// because it is the naive thing: an optimized function checked against a reimplementation that shares
/// its optimizations is checked against its own bugs.
fn subst_naive(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> LambdaTerm {
    match t.node() {
        Node::Var(k) if *k == j => s.clone(),
        Node::Var(k) => var(*k),
        Node::Abs(n, b) => abs(Rc::clone(n), subst_naive(j + 1, &shift(1, 0, s), b)),
        Node::App(f, a) => app(subst_naive(j, s, f), subst_naive(j, s, a)),
    }
}

/// Reference 2: the FALSIFIED rewrite, kept as a second independent oracle rather than as a proposal.
/// It defers the per-binder `shift(1, 0, s)` by carrying the accumulated lift alongside the index, so
/// the argument is shifted once per OCCURRENCE instead of once per BINDER.
///
/// **It is correct and it is not faster** — see this file's module doc. Its value here is that it
/// reaches the same answers by different index arithmetic, which is what makes agreement with it
/// evidence rather than a tautology.
fn subst_lifted(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> LambdaTerm {
    subst_at(j, 0, s, t)
}

fn subst_at(j: u32, lift: u32, s: &LambdaTerm, t: &LambdaTerm) -> LambdaTerm {
    match t.node() {
        // THE `lift == 0` CASE IS LOAD-BEARING EVEN HERE. `shift` allocates a fresh node on every arm
        // regardless of `d`, so `shift(0, 0, s)` DEEP-REBUILDS the argument where `s.clone()` is a
        // refcount bump. Structural `==` cannot see the difference, which is why
        // `the_shipped_subst_shares_the_argument_rather_than_rebuilding_it` pins it by allocation
        // identity — and note what that test is about now: the SHIPPED function's sharing, with this
        // reference's arm checked alongside it so the two oracles stay honest about the same property.
        Node::Var(k) if *k == j => {
            if lift == 0 {
                s.clone()
            } else {
                shift(i64::from(lift), 0, s)
            }
        }
        Node::Var(k) => var(*k),
        Node::Abs(n, b) => abs(Rc::clone(n), subst_at(j + 1, lift + 1, s, b)),
        Node::App(f, a) => app(subst_at(j, lift, s, f), subst_at(j, lift, s, a)),
    }
}

/// Every term of exactly `n` nodes over `vars` distinct de Bruijn indices, indexed by `n`.
///
/// Four indices rather than two: the risk the enumeration exists to cover is index arithmetic that
/// only differs when an index is large enough to be shifted and a binder is crossed, so it has to reach
/// indices above the binder depth it generates.
fn terms_up_to(max_nodes: usize, vars: u32) -> Vec<Vec<LambdaTerm>> {
    let mut by_size: Vec<Vec<LambdaTerm>> = vec![Vec::new(); max_nodes + 1];
    if max_nodes >= 1 {
        by_size[1] = (0..vars).map(var).collect();
    }
    for n in 2..=max_nodes {
        let mut out: Vec<LambdaTerm> = by_size[n - 1].iter().map(|b| abs("x", b.clone())).collect();
        for l in 1..n - 1 {
            for f in &by_size[l] {
                for a in &by_size[n - 1 - l] {
                    out.push(app(f.clone(), a.clone()));
                }
            }
        }
        by_size[n] = out;
    }
    by_size
}

const T_NODES: usize = 6;
const S_NODES: usize = 4;
const VARS: u32 = 4;
/// Highest substitution index tried. A `const` rather than a literal in the loop because the printed
/// summary quotes the range, and the two drifted apart once already (the loop read `0..4`, the summary
/// said `0..4`, and the design said `0..3` — same set, three notations).
const J_MAX: u32 = 3;

/// **A PROPERTY OF THE SHIPPED `shift`, no longer a proof obligation for anything.**
///
///     shift(a, c, shift(b, c, t)) == shift(a + b, c, t)      for a, b >= 0
///
/// It was checked here because the falsified rewrite's "`shift(1,0,·)` applied `d` times is
/// `shift(d,0,·)`" rests on it. The rewrite is dead and this is kept anyway: it is a true, cheap,
/// exhaustively checkable invariant of a function two call sites depend on, and it constrains `shift`'s
/// cutoff handling in a way no other test here does.
///
/// **THE SIDE CONDITION IS LOAD-BEARING.** Stated unconditionally the lemma is FALSE:
/// `shift(-1, 0, Var 0)` trips `term.rs`'s negative-index assert, so the inner application has no value
/// to be additive with. The loop ranges `a, b` over the non-negative case exactly for that reason. The
/// reducer's one negative shift (`beta`'s closing `shift(-1, 0, ·)`) is applied after substitution
/// finishes and is composed with nothing.
#[test]
fn shift_additivity_holds_over_every_non_negative_composition() {
    let by_size = terms_up_to(T_NODES, VARS);
    let all_t: Vec<&LambdaTerm> = by_size.iter().flatten().collect();

    let mut lemma_checks = 0u64;
    for a in 0..=3i64 {
        for b in 0..=3i64 {
            for c in 0..3u32 {
                for t in &all_t {
                    assert_eq!(
                        shift(a, c, &shift(b, c, t)),
                        shift(a + b, c, t),
                        "shift-additivity failed at a={a} b={b} cutoff={c}"
                    );
                    lemma_checks += 1;
                }
            }
        }
    }

    assert_eq!(lemma_checks, 53_376, "shift-additivity case count");
    println!("shift-additivity verified: {lemma_checks} (a,b,cutoff,t) cases, 0 violations");
}

/// **THE SHIPPED `subst` IS THE SUBJECT HERE**, checked against two independent references at once.
///
/// Exhaustive, not sampled — an earlier draft of the design recorded "200,000 random triples, offline"
/// against a harness that no longer exists, and randomly generated de Bruijn terms almost never produce
/// the deep-binder/high-index configurations the index arithmetic actually stresses, which is the one
/// thing this check exists to cover. Exhaustive enumeration to six nodes runs in well under a second
/// and covers them by construction.
///
/// Both references are checked in the same pass rather than in two tests, because the interesting
/// failure is a triple where the shipped function agrees with one and not the other: that says the
/// disagreement is in the lift arithmetic rather than in `subst` itself, and a single loop reports the
/// triple that shows it.
#[test]
fn the_shipped_subst_agrees_with_both_references_on_every_enumerated_triple() {
    let by_size = terms_up_to(T_NODES, VARS);
    let all_t: Vec<&LambdaTerm> = by_size.iter().flatten().collect();
    let all_s: Vec<&LambdaTerm> = by_size[..=S_NODES].iter().flatten().collect();

    let mut triples = 0u64;
    for j in 0..=J_MAX {
        for s in &all_s {
            for t in &all_t {
                let shipped = subst(j, s, t);
                assert_eq!(
                    shipped,
                    subst_naive(j, s, t),
                    "shipped `subst` disagrees with the eager reference at j={j}"
                );
                assert_eq!(
                    shipped,
                    subst_lifted(j, s, t),
                    "shipped `subst` disagrees with the lifted reference at j={j}"
                );
                triples += 1;
            }
        }
    }

    assert_eq!(triples, 355_840, "differential triple count");
    println!(
        "shipped `subst` verified: exhaustive differential against an eager and a lifted reference on \
         {triples} (j,s,t) triples each (all t to {T_NODES} nodes over {VARS} indices, all s to \
         {S_NODES}, j in 0..={J_MAX}), 0 mismatches"
    );
}

/// **THE SHARING PROPERTY, which the differential above cannot see.** `==` is satisfied by a deep copy,
/// so `the_shipped_subst_agrees_with_both_references_on_every_enumerated_triple` would pass just as
/// happily with every short-circuit in `term.rs` deleted — while costing a full copy of the argument at
/// every binder-free substitution site. Pinned by ALLOCATION IDENTITY, which is the only thing that
/// distinguishes the two.
///
/// **This is the property the whole 2026-08-02 falsification turns on**, which is why it is pinned here
/// as well as in `term.rs`'s own unit tests: because `shift(1, 0, s)` returns `s`'s allocation whenever
/// `s` is closed, and 88.4% of corpus β-steps have a closed argument, the per-binder re-shift the
/// retired rewrite existed to delete is already free. Delete the short-circuit and that stops being
/// true — so this test failing is the signal that the census's numbers no longer describe the tree.
///
/// AND NOTE WHAT THIS SHARING IS NOT: it does not reach a trace snapshot. `beta` closes the hole with
/// `shift(-1, 0, ·)`, whose own short-circuit cannot fire at cutoff 0 on a term with free variables, so
/// it rebuilds the reduct and discards what `subst` shared. See the design's §8 and §10.
#[test]
fn the_shipped_subst_shares_the_argument_rather_than_rebuilding_it() {
    let s = app(abs("x", var(0)), var(1));
    assert_eq!(
        subst(0, &s, &var(0)).alloc_id(),
        s.alloc_id(),
        "the shipped `subst` must SHARE the argument at an occurrence, not rebuild it"
    );
    assert_eq!(
        subst_lifted(0, &s, &var(0)).alloc_id(),
        s.alloc_id(),
        "the lifted reference's lift==0 arm must share too, or it is not a reference for this property"
    );
    assert_ne!(
        shift(0, 0, &s).alloc_id(),
        s.alloc_id(),
        "`shift(0, 0, ·)` must be shown to REBUILD — that is what makes the lift==0 arm necessary"
    );

    // The short-circuit the falsification rests on, stated as a fact about a CLOSED argument rather
    // than about a particular term: `shift(1, 0, ·)` cannot change an index that is not free, so it
    // returns the handle. `term.rs`'s unit tests pin this too; it is repeated here because this file is
    // where a reader arrives asking why the retired rewrite had nothing left to win.
    let closed = abs("x", var(0));
    assert_eq!(closed.maxfree(), 0, "the fixture must be closed for this to be the property it claims");
    assert_eq!(
        shift(1, 0, &closed).alloc_id(),
        closed.alloc_id(),
        "`shift(1, 0, ·)` on a CLOSED term must return its allocation — this is why the per-binder \
         re-shift is already free, and why carrying the lift down wins nothing"
    );
}
