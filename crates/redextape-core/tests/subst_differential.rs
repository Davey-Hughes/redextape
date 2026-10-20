//! Exhaustive differential and lemma coverage for `term.rs`'s `subst` and `shift`.
//!
//! The shipped `subst` is the thing under test; the two implementations here are REFERENCES. One is a
//! naive textbook `subst`; the other expresses a rewrite that was falsified on cost (carrying `subst`'s
//! per-binder re-shift down as one `shift(d, 0, ·)`; see below).
//!
//! `term.rs`'s `subst` carries two `maxfree` short-circuits and returns handles rather than rebuilding;
//! a naive textbook implementation that does neither is exactly the independent oracle such a function
//! needs, and having two of them — one eager, one lifted — that must both agree with it over 355,840
//! enumerated triples is stronger coverage than a one-directional check.
//!
//! **THE REWRITE IS DEAD:** it was falsified on cost (on the nested-group family it is a regression),
//! so the code that expressed it is kept only as a reference. Instrument:
//! `examples/shift_cost_probe.rs`'s census section; full statement in the perf design's §10.
//!
//! **`subst_lifted` must not be read as a benchmark.** It has neither short-circuit and its `Var(k)`
//! arm allocates. As a *reference implementation* that naivety is a virtue and it is deliberately
//! preserved; as a *cost model* it was never valid, and the census (`examples/shift_cost_probe.rs`)
//! prices `subst_at` with both short-circuits merged in instead.
//!
//! Three properties, each pinned separately because a failure in one points somewhere different:
//!
//!   1. **Shift-additivity** (`shift(a, c, shift(b, c, t)) == shift(a + b, c, t)` for `a, b >= 0`) — a
//!      property of the shipped `shift`. 53,376 cases.
//!   2. **The differential** — shipped `subst` against BOTH references, exhaustive over every `t` to 6
//!      nodes / 4 indices and every `s` to 4 nodes, `j` in `0..=3`. 355,840 triples each.
//!   3. **The sharing pins.** Structural `==` cannot tell a returned handle from a deep copy, so the
//!      differential above would pass just as happily with every short-circuit deleted. `alloc_id()` is
//!      the only thing that distinguishes them.
//!
//! **SECOND QUESTION: does the fused `beta` equal the three-pass one?** The textbook `beta` is three
//! traversals — `shift(-1, 0, subst(0, shift(1, 0, arg), body))`; the shipped `beta` is one walk that
//! carries the argument incrementally and decrements free indices in place. That walk is index
//! arithmetic whose correctness rests on a cancellation (`shift(-1, ·)` undoing the opening `+1` on the
//! substituted argument), which is exactly the kind of claim an exhaustive differential settles and an
//! example does not. `beta_three_pass` below is the three-pass formulation, kept for the same reason
//! `subst_naive` is: a differential needs a reference that does not share the optimization it checks.

// Test target: `clippy.toml`'s `allow-*-in-tests` keys reach a `#[test]` function's own body but not
// free helpers in a `tests/` target (its doc comment explains why), and the enumeration below is all
// free helpers. Exemption stated per target, same idiom as `lambda_sharing.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::collections::HashSet;
use std::rc::Rc;

use redextape_core::lambda::term::{LambdaTerm, Node, abs, app, beta, shift, subst, var};

/// Reference 1: the textbook eager `subst`, with NO short-circuit and no handle reuse — every arm
/// allocates, and the argument is re-shifted under every `Abs` whether or not the variable occurs below
/// it. It is kept as an oracle precisely because it is the naive thing: an optimized function checked
/// against a reimplementation that shares its optimizations is checked against its own bugs.
fn subst_naive(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> LambdaTerm {
    match t.node() {
        Node::Var(k) if *k == j => s.clone(),
        Node::Var(k) => var(*k),
        Node::Abs(n, b) => abs(Rc::clone(n), subst_naive(j + 1, &shift(1, 0, s), b)),
        Node::App(f, a, _) => app(subst_naive(j, s, f), subst_naive(j, s, a)),
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
        // identity — the SHIPPED function's sharing, with this reference's arm checked alongside it
        // so the two oracles stay honest about the same property.
        Node::Var(k) if *k == j => {
            if lift == 0 {
                s.clone()
            } else {
                shift(i64::from(lift), 0, s)
            }
        }
        Node::Var(k) => var(*k),
        Node::Abs(n, b) => abs(Rc::clone(n), subst_at(j + 1, lift + 1, s, b)),
        Node::App(f, a, _) => app(subst_at(j, lift, s, f), subst_at(j, lift, s, a)),
    }
}

/// `beta` as THREE PASSES — the textbook formulation `term.rs`'s `beta` doc names.
///
/// This is not dead code and it is not a duplicate: it is the reference the shipped `beta` is
/// differentiated against, and the moment it stops being spelled out here the differential compares
/// `beta` to itself. `tests/lambda_foreign_reader.rs` (its finding 5) checks the same three-pass
/// formula against the corpus, each shift sabotage-verified, which is where the confidence that THIS
/// is the right reference comes from.
fn beta_three_pass(body: &LambdaTerm, arg: &LambdaTerm) -> LambdaTerm {
    shift(-1, 0, &subst(0, &shift(1, 0, arg), body))
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
/// summary quotes the range.
const J_MAX: u32 = 3;

/// **A PROPERTY OF THE SHIPPED `shift`.**
///
///     shift(a, c, shift(b, c, t)) == shift(a + b, c, t)      for a, b >= 0
///
/// `subst_lifted`'s "`shift(1,0,·)` applied `d` times is `shift(d,0,·)`" rests on it. It is also a
/// true, cheap, exhaustively checkable invariant of a function `subst`, `beta_go` and `lambda/lower.rs`
/// all call, and it constrains `shift`'s cutoff handling in a way no other test here does.
///
/// **THE SIDE CONDITION IS LOAD-BEARING.** Stated unconditionally the lemma is FALSE:
/// `shift(-1, 0, Var 0)` trips `term.rs`'s negative-index assert, so the inner application has no value
/// to be additive with. The loop ranges `a, b` over the non-negative case exactly for that reason.
/// **The reducer has no negative shift to compose it with at all** — `beta_go` decrements free indices
/// in place rather than by calling `shift` with a negative `d`, so the excluded case is not merely
/// unexercised by this suite; **no non-test call site in `src/` produces it.** The qualifier is
/// load-bearing: `term.rs`'s own `#[cfg(test)]` module still calls `shift(-1, …)` in the two tests that
/// pin the `# Panics` contract.
///
/// Deliberate direct calls to `shift(-1, 0, ·)` in THIS file are `beta_three_pass`'s, which spells the
/// three-pass `beta` out on purpose. Not this test's: its loop ranges `a, b` over `0..=3`, so it never
/// constructs a negative shift at all — which is the whole point of the side condition above.
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
/// Exhaustive, not sampled — randomly generated de Bruijn terms almost never produce the
/// deep-binder/high-index configurations the index arithmetic actually stresses, which is the one
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
/// **This is the property the whole falsification turns on**, which is why it is pinned here
/// as well as in `term.rs`'s own unit tests: because `shift(1, 0, s)` returns `s`'s allocation whenever
/// `s` is closed, and most corpus β-steps have a closed argument, the per-binder re-shift the
/// retired rewrite existed to delete is already free. Delete the short-circuit and that stops being
/// true — so this test failing is the signal that the census's numbers no longer describe the tree.
///
/// `beta_go` performs the substitution and the decrement in ONE walk, with no second pass over
/// `subst`'s result, so what this test pins survives to be what a β-step actually produces. See the
/// design's §2.3 and `term.rs`'s
/// `a_beta_step_shares_one_allocation_across_every_occurrence_of_an_open_argument`, which pins the
/// mechanism directly, and `tests/lambda_sharing.rs`, which pins the consequence at 17,920 and 4,305
/// distinct allocations.
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

/// **THE GATE FOR β-FUSION.**
///
/// **Where a wrong index would hide.** The fused walk substitutes `shift(d, 0, arg)` at depth `d`,
/// where the three-pass form substitutes `shift(d+1, 0, arg)` and then decrements it. Those agree only
/// because the opening shift and the closing shift are an up-and-down pair that cancels — a claim about
/// arithmetic. `term.rs`'s `beta_reduces_const_application` already reaches this case once:
/// `beta(abs("y", var(1)), var(5)) == abs("y", var(6))` substitutes a free argument at `d = 1`, and a
/// mutant that substitutes `shift(d-1, 0, arg)` there fails it — the curated test is not blind to the
/// cancellation, and this differential must not be read as covering ground it misses outright. What the
/// curated test has is one instance: one `Var` argument, `d = 1`. What the enumeration has is 25,112 of
/// the 88,960 pairs — those where `maxfree(arg) > 0` with a substitution site under a binder — spread
/// over `d` up to 3 (site-depth histogram: 306 at `d=0`, 273 at `d=1`, 47 at `d=2`, 32 at `d=3`), with
/// compound arguments and multiple occurrences of the bound variable: the breadth that turns the curated
/// test's single passing case into a property instead of a coincidence. `d = 3` is the ceiling because
/// `VARS` caps the substitution depth this enumeration exercises at 3, not because binder depth runs out
/// — the generator produces binder depths past that, up to 5 at `T_NODES` (`λλλλλ.k`).
///
/// **`beta` is total on every pair here.** `subst(0, …)` replaces every free `Var(0)` before the
/// closing `shift(-1, 0, ·)` runs, so the negative-index assert is unreachable — the invariant
/// `shift`'s own doc block spells out.
#[test]
fn the_shipped_beta_agrees_with_the_three_pass_formulation_on_every_enumerated_pair() {
    let bodies = terms_up_to(T_NODES, VARS);
    let args = terms_up_to(S_NODES, VARS);
    let mut pairs = 0u64;
    for body in bodies.iter().flatten() {
        for arg in args.iter().flatten() {
            assert_eq!(
                beta(body, arg),
                beta_three_pass(body, arg),
                "β-fusion changed the answer for body {body:?} and arg {arg:?}"
            );
            pairs += 1;
        }
    }
    // The enumeration is the test; a collapsed generator would pass vacuously.
    // `the_shipped_subst_agrees_with_both_references_on_every_enumerated_triple` above guards its own
    // count the same way — `assert_eq!(triples, 355_840, …)`, an exact count, not a lower bound — and
    // this matches it: the count is deterministic (1112 bodies × 80 args).
    assert_eq!(pairs, 88_960, "the (body, arg) enumeration drifted from its expected exact count");
    println!("β-fusion differential: {pairs} (body, arg) pairs, 0 mismatches");
}

/// Every allocation-identity claim β-fusion makes, over the same 88,960 pairs — **the half the
/// differential above is blind to.**
///
/// **THIS EXISTS BECAUSE `==` CANNOT SEE SHARING.** The test above compares terms structurally, so a
/// `beta` that rebuilt every untouched subterm instead of returning its handle would pass all 88,960
/// pairs while destroying the sharing that makes a β-step cost the DAG rather than the tree it
/// denotes. This file's module doc already lists that gap as property 3 and pins it with three
/// hand-built terms; this is the exhaustive form of the same property.
///
/// Two properties, and neither is a count:
///
/// 1. **Fusion loses no inherited allocation.** Every input allocation the three-pass form handed
///    through to its result is handed through by the fused walk too. This is design §2.3: the fused
///    prune is `subst`'s prune, so the same subterms are returned by handle.
/// 2. **Fusion allocates no more fresh nodes**, on any pair.
///
/// The strict inequality on the totals is the non-vacuity guard, and it is the one that would catch the
/// whole thing being tested against itself. **The totals themselves are deliberately NOT pinned:** they
/// are derived from the generator, so pinning them would force a re-pin on any coverage change while the
/// two properties above would be untouched by one. `tests/lambda_sharing.rs` is where exact allocation
/// counts are pinned, on real programs, for real reasons.
///
/// `alloc_id()` is an address and means "identity" only while the term is alive, so `body`, `arg` and
/// both results are held for the whole of each iteration — the liveness rule `lambda_sharing.rs` spells
/// out. Nothing is compared across iterations, where a freed address could be reused.
#[test]
fn beta_fusion_inherits_every_allocation_the_three_pass_form_did_and_allocates_no_more() {
    fn alloc_ids(t: &LambdaTerm, out: &mut HashSet<usize>) {
        if !out.insert(t.alloc_id()) {
            return; // already walked; a DAG reached twice is not two allocations
        }
        match t.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => alloc_ids(b, out),
            Node::App(f, a, _) => {
                alloc_ids(f, out);
                alloc_ids(a, out);
            }
        }
    }

    let bodies = terms_up_to(T_NODES, VARS);
    let args = terms_up_to(S_NODES, VARS);
    let (mut pairs, mut lost, mut more_fresh) = (0u64, 0u64, 0u64);
    let (mut fresh_fused, mut fresh_three) = (0u64, 0u64);
    // A count localises nothing. Every other assertion in this file names the offending item, and a red
    // run here would otherwise report "on 37 pairs" with nothing to open — so the first offender of each
    // kind is carried out of the loop. The generator caps bodies at 6 nodes and arguments at 4, so
    // whatever this prints is small enough to reduce by hand.
    let (mut first_lost, mut first_more_fresh) = (None, None);

    for body in bodies.iter().flatten() {
        for arg in args.iter().flatten() {
            let fused = beta(body, arg);
            let three = beta_three_pass(body, arg);

            let mut inputs = HashSet::new();
            alloc_ids(body, &mut inputs);
            alloc_ids(arg, &mut inputs);
            let (mut f_ids, mut t_ids) = (HashSet::new(), HashSet::new());
            alloc_ids(&fused, &mut f_ids);
            alloc_ids(&three, &mut t_ids);

            // An allocation the three-pass form inherited from the input, that fusion did not.
            if t_ids.iter().any(|id| inputs.contains(id) && !f_ids.contains(id)) {
                lost += 1;
                first_lost.get_or_insert_with(|| format!("body {body:?}, arg {arg:?}"));
            }
            let (f_new, t_new) = (
                f_ids.iter().filter(|id| !inputs.contains(*id)).count() as u64,
                t_ids.iter().filter(|id| !inputs.contains(*id)).count() as u64,
            );
            if f_new > t_new {
                more_fresh += 1;
                first_more_fresh
                    .get_or_insert_with(|| format!("body {body:?}, arg {arg:?} — {f_new} fresh against {t_new}"));
            }
            fresh_fused += f_new;
            fresh_three += t_new;
            pairs += 1;
        }
    }

    assert_eq!(pairs, 88_960, "the (body, arg) enumeration drifted from its expected exact count");
    assert_eq!(
        lost,
        0,
        "fusion dropped an allocation the three-pass form inherited, on {lost} pairs; first: {}",
        first_lost.as_deref().unwrap_or("-")
    );
    assert_eq!(
        more_fresh,
        0,
        "fusion allocated MORE fresh nodes than three passes, on {more_fresh} pairs; first: {}",
        first_more_fresh.as_deref().unwrap_or("-")
    );
    // Non-vacuity. Without this the two properties above are satisfiable by comparing a function with
    // itself, which this test must not do.
    assert!(
        fresh_fused < fresh_three,
        "fusion must allocate strictly fewer fresh nodes overall: {fresh_fused} against {fresh_three}"
    );
    println!(
        "β-fusion allocation differential: {pairs} pairs, {lost} lost, {more_fresh} over-allocating, \
         {fresh_fused} fresh against {fresh_three}"
    );
}
