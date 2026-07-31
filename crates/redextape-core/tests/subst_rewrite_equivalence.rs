//! Exhaustive validation of the `subst` rewrite §10 of the Plan 4 design proposes — NOT the shipped
//! `subst` (`crates/redextape-core/src/lambda/term.rs:118-132`), which this file leaves untouched. It
//! is the differential and the lemma that make the rewrite safe to act on, moved out of
//! `examples/lambda_sharing_probe.rs` into a target `cargo nextest run` actually executes.
//!
//! **WHY THIS MOVED.** CI compiles examples (`.forgejo/workflows/ci.yml:112`,
//! `cargo clippy --workspace --all-targets`) but never RUNS one: the test step (`:128`) is
//! `cargo llvm-cov nextest --workspace`, which does not execute example targets at all, and the only
//! `cargo run --example` in the whole workflow is `opt_report` (`:228`), a different crate. So while
//! this check lived in the probe, the evidence that the rewrite is safe was verified once per manual
//! `cargo run --example lambda_sharing_probe`, not on every push. As a `#[test]` it runs on every
//! `cargo nextest run -p redextape-core`, i.e. every CI run. See the design's §8 and §10.
//!
//! **THE CANDIDATE LIVES HERE, NOT IN `src/`.** `subst_at`/`subst_lifted` below are the proposed
//! rewrite, not an alternate shipped implementation: `term.rs`'s `subst` is unchanged, and this file
//! exists to prove the two agree before anyone acts on that proposal. Duplicating this candidate in
//! both the probe and a test target would let them drift, so the probe no longer carries a copy of
//! it — see its module doc for the pointer back to here.
//!
//! Three properties, each pinned separately because a failure in one points somewhere different:
//!
//!   1. **Shift-additivity lemma** (`shift(a, c, shift(b, c, t)) == shift(a + b, c, t)` for `a, b >=
//!      0`) — the identity that makes "defer the per-binder shift and accumulate it as `lift`" TRUE
//!      rather than merely plausible. 53,376 cases.
//!   2. **The differential** — `subst_lifted` (this file) against `subst` (`term.rs`) — exhaustive
//!      over every `t` to 6 nodes / 4 indices and every `s` to 4 nodes, `j` in `0..=3`. 355,840
//!      triples.
//!   3. **The `lift == 0` allocation-identity pin.** Structural `==` cannot tell `s.clone()` (a
//!      refcount bump) apart from `shift(0, 0, s)` (a deep rebuild) — both produce an equal term — so
//!      property 2 alone would pass just as happily with the arm deleted. `alloc_id()` is the only
//!      thing that distinguishes them, which is why the pin exists and why it uses identity rather
//!      than equality.

// Test target: `clippy.toml`'s `allow-*-in-tests` keys reach a `#[test]` function's own body but not
// free helpers in a `tests/` target (its doc comment explains why), and the enumeration below is all
// free helpers. Exemption stated per target, same idiom as `lambda_sharing.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::rc::Rc;

use redextape_core::lambda::term::{LambdaTerm, Node, abs, app, shift, subst, var};

/// The rewrite §10 records. Defers the per-binder `shift(1, 0, s)` to the substitution site by
/// carrying the accumulated lift alongside the index, so the argument is copied once per OCCURRENCE
/// instead of once per BINDER. A candidate under test, not the shipped `subst` — see the module doc.
fn subst_lifted(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> LambdaTerm {
    subst_at(j, 0, s, t)
}

fn subst_at(j: u32, lift: u32, s: &LambdaTerm, t: &LambdaTerm) -> LambdaTerm {
    match t.node() {
        // THE `lift == 0` CASE IS LOAD-BEARING, NOT A MICRO-OPTIMIZATION, AND MUST NOT BE "SIMPLIFIED"
        // BACK OUT. `shift` allocates a fresh node on every arm regardless of `d`, so `shift(0, 0, s)`
        // DEEP-REBUILDS the argument — whereas `s.clone()` is a refcount bump. Substituting into a body
        // with no binders costs 0 today (`term.rs`'s `Var` arm is `s.clone()`) and would cost `|arg|`
        // without this arm: a strict REGRESSION at exactly those sites, and one that discards the
        // structural-sharing property this whole slice exists to establish. Every substitution into an
        // occurrence at binder depth 0 goes through here.
        //
        // `the_lift_zero_arm_shares_the_argument_rather_than_rebuilding_it`, below, pins this by
        // allocation identity, so deleting the arm fails a check rather than quietly costing a deep
        // copy.
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
/// Four indices rather than two: the rewrite's whole risk is the `lift` arithmetic, which only differs
/// from the original when an index is large enough to be shifted and a binder is crossed, so the
/// enumeration has to reach indices above the binder depth it generates.
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

/// **THE SHIFT-ADDITIVITY LEMMA IS WHAT MAKES THE REWRITE TRUE RATHER THAN PLAUSIBLE.** The argument
/// for deferring the shift is "`shift(1,0,·)` applied `d` times is `shift(d,0,·)`", and that is a
/// consequence of
///
///     shift(a, c, shift(b, c, t)) == shift(a + b, c, t)      for a, b >= 0
///
/// which is checked here directly. **THE SIDE CONDITION IS LOAD-BEARING.** Stated unconditionally the
/// lemma is FALSE: `shift(-1, 0, Var 0)` trips `term.rs`'s negative-index assert, so the inner
/// application has no value to be additive with. Nothing is lost by it — the rewrite accumulates
/// `lift` upward through `Abs`, so every shift it composes has `d = 1`, and the loop below ranges `a,
/// b` over the non-negative case exactly because that is the whole of what the induction needs. The
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

/// The proof obligation the rewrite rests on, and the exhaustive differential check that the rewrite
/// meets it. Exhaustive, not sampled — an earlier draft of the design recorded "200,000 random
/// triples, offline" against a harness that no longer exists, and randomly generated de Bruijn terms
/// almost never produce the deep-binder/high-index configurations the `lift` arithmetic actually
/// stresses, which is the one thing this check exists to cover. Exhaustive enumeration to six nodes
/// runs in well under a second and covers them by construction.
#[test]
fn subst_lifted_agrees_with_subst_on_every_enumerated_triple() {
    let by_size = terms_up_to(T_NODES, VARS);
    let all_t: Vec<&LambdaTerm> = by_size.iter().flatten().collect();
    let all_s: Vec<&LambdaTerm> = by_size[..=S_NODES].iter().flatten().collect();

    let mut triples = 0u64;
    for j in 0..=J_MAX {
        for s in &all_s {
            for t in &all_t {
                assert_eq!(subst(j, s, t), subst_lifted(j, s, t), "subst rewrite disagrees at j={j}");
                triples += 1;
            }
        }
    }

    assert_eq!(triples, 355_840, "differential triple count");
    println!(
        "subst rewrite verified: exhaustive differential vs term.rs's subst on {triples} (j,s,t) \
         triples (all t to {T_NODES} nodes over {VARS} indices, all s to {S_NODES}, j in 0..={J_MAX}), \
         0 mismatches"
    );
}

/// THE SHARING PROPERTY, which structural equality above cannot see. `==` is satisfied by a deep copy,
/// so `subst_lifted_agrees_with_subst_on_every_enumerated_triple` would pass just as happily with
/// `shift(0, 0, s)` in the `lift == 0` arm — while costing a full copy of the argument at every
/// binder-free substitution site. Pinned by ALLOCATION IDENTITY, which is the only thing that
/// distinguishes the two.
///
/// AND NOTE WHAT THIS SHARING IS NOT: it does not reach a trace snapshot. `beta` closes the hole with
/// `shift(-1, 0, ·)`, and `shift` has no sharing-preserving arm — all three of its arms allocate — so
/// it rebuilds the whole reduct and discards everything `subst` shared. The rewrite's win is an
/// allocation-count reduction INSIDE one call, not a sharing win visible to `lambda_sharing.rs`, whose
/// pinned counts do not move. See the design's §8 and §10.
///
/// A gate on this test's own bite: comment out the `if lift == 0 { s.clone() }` arm above (replacing
/// it with the general `shift(i64::from(lift), 0, s)` unconditionally) and this test is the one that
/// fails — `subst_lifted_agrees_with_subst_on_every_enumerated_triple` still passes, because `==`
/// cannot see the difference.
#[test]
fn the_lift_zero_arm_shares_the_argument_rather_than_rebuilding_it() {
    let s = app(abs("x", var(0)), var(1));
    let bumped = subst_lifted(0, &s, &var(0));
    assert_eq!(bumped.alloc_id(), s.alloc_id(), "the rewrite's lift==0 arm must SHARE the argument, not rebuild it");
    assert_eq!(subst(0, &s, &var(0)).alloc_id(), s.alloc_id(), "today's `subst` shares here, so the rewrite must too");
    assert_ne!(
        shift(0, 0, &s).alloc_id(),
        s.alloc_id(),
        "`shift(0, 0, ·)` must be shown to REBUILD — that is the whole reason the lift==0 arm exists"
    );
}
