//! `ZipperCursor` against `LambdaCursor`, event for event.
//!
//! **THE GATE THE ZIPPER SLICE LIVES OR DIES BY.** The zipper is a different way to find the same
//! redexes, so the only acceptable difference is speed. Any divergence in the emitted sequence is a
//! correctness defect: normal order is required, not chosen (`reduce.rs`'s module doc gives three
//! independent reasons a call-by-value order fails to terminate on ordinary programs).
//!
//! **SINCE `StepEvent::Beta` GAINED `owner`, THAT IS PART OF WHAT IS COMPARED — AND `OwnerCensus` IS
//! WHAT STOPS THAT FROM BEING A LIE.** The two cursors compute the owner by genuinely different means
//! (`reduce_step_go` carries the enclosing tag down a root→redex descent; `ZipperCursor::reduce_here`
//! reads it off the popped frame and scans the context stack), so holding them equal is worth as much
//! as holding their redex paths equal — but only over terms that carry tags. Over untagged terms both
//! sides say `Owner::None` and the comparison passes while proving nothing. The terms here are lowered
//! from source and `lower.rs` tags `BinOp` and `If`, the only constructs `arb_expr_over` emits;
//! the census assertions below hold that fact rather than assume it.
//!
//! Proptest rather than the 46-program corpus, deliberately. `FIRST_ORDER_DEMOS` lives in a test
//! target and has been hand-copied five times with a sync test holding the copies together; a sixth
//! copy is the drift this tree has fought twice. Generated programs are stronger evidence for an
//! equivalence property anyway. The corpus-wide check lives in `examples/lambda_sharing_probe.rs`,
//! which already owns a checked copy, and is reported rather than gated.

// Test target: `clippy.toml`'s `allow-*-in-tests` keys do not reach free helpers in a `tests/` target,
// so the exemption is stated per target — same idiom as `lambda_sharing.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use proptest::prelude::*;
use redextape_core::desugar::desugar;
use redextape_core::lambda::reduce::Owner;
use redextape_core::lambda::term::{abs, app, var};
use redextape_core::lambda::{LambdaTerm, Status, lower};
use redextape_core::parser::parse;
use redextape_core::trace::{LambdaCursor, StepEvent, ZipperCursor};
use redextape_test_support::arb_expr_over;

fn term_of(src: &str) -> Option<LambdaTerm> {
    let (prog, ds) = parse(src);
    if !ds.is_empty() {
        return None;
    }
    lower(&desugar(&prog?)).ok()
}

/// **NOT `MAX_REDUCTION_STEPS`, and not because the generated programs need it.** `arb_expr_over`
/// generates only `+`, monus `-`, `>`, `==` and `if` over integer leaves — no recursion, no functions,
/// no loops (`three_way_oracle.rs:529`'s doc on this same generator: "every generated program terminates
/// to a value"). Verified directly: raising this cap to 5,000,000 still runs the proptest below in
/// 0.22 s with 0 of 262 generated programs capping. **This cap exists for the four CURATED capping
/// cases in `curated_shapes_agree_step_for_step` below** — terms and programs built to diverge or
/// recurse unboundedly — so they hit a small, cheap bound instead of running to `MAX_REDUCTION_STEPS`.
/// The property under test is "these two cursors agree": on the emitted `StepEvent` sequence, on the
/// resulting term, AND on the resulting `Status` — `Some(Normalized)` for the six terminating shapes
/// and every generated program, `Some(HitCap)` for the four capping cases, and never a case where the
/// two cursors' statuses disagree.
const EQUIV_CAP: u64 = 10_000;

/// How many events of each `Owner` variant a run emitted.
///
/// **THIS IS THE ANTI-VACUITY INSTRUMENT FOR THE HALF OF THIS GATE THAT LOOKS FREE.** When
/// `StepEvent::Beta` gained `owner`, this file's comparison started covering it without a line of new
/// test code — but *only* if the terms under test carry provenance tags at all. Over untagged terms
/// every event on both sides is `Owner::None`, the comparison is trivially satisfied, and the strongest
/// gate in the crate would silently prove nothing about the newest field in the type it compares. The
/// terms here are LOWERED from source, and `lower.rs` tags `BinOp` and `If` — the two constructs
/// `arb_expr_over` generates — at their own root `App`, so they are tagged in the way real programs are.
/// The assertions below are what hold that true rather than assumed.
///
/// Measured 2026-08-10: the six curated programs emit 115 `Exact`, 522 `Within` and 228 `None`, and the
/// smallest program the generator can produce that steps at all — `(0 + 0)` — emits 1, 1 and 4. So the
/// gate does see the field; these assertions are what will say so if lowering ever stops tagging.
#[derive(Default, Debug)]
struct OwnerCensus {
    exact: usize,
    within: usize,
    none: usize,
}

impl OwnerCensus {
    fn observe(&mut self, events: &[StepEvent]) {
        for e in events {
            match e {
                StepEvent::Beta { owner: Owner::Exact(_), .. } => self.exact += 1,
                StepEvent::Beta { owner: Owner::Within(_), .. } => self.within += 1,
                StepEvent::Beta { owner: Owner::None, .. } => self.none += 1,
                StepEvent::Delta { .. } => panic!("a lambda cursor emitted a Delta event"),
            }
        }
    }

    fn merge(&mut self, other: OwnerCensus) {
        self.exact += other.exact;
        self.within += other.within;
        self.none += other.none;
    }

    fn total(&self) -> usize {
        self.exact + self.within + self.none
    }

    fn tagged(&self) -> usize {
        self.exact + self.within
    }
}

/// Both cursors over one term at an explicit cap: the event sequences, the final terms and the statuses
/// must be identical. Returns the agreed `Status` so a caller that built a term specifically to hit the
/// cap can assert it actually did (rather than, say, quietly normalizing before the cap and testing
/// nothing new), and the `Owner` census of the agreed sequence so a caller can check the comparison
/// was not vacuous on that field.
///
/// Each cursor is driven ONCE. An earlier draft collected the events and then drained a second cursor
/// to read the final term, reducing every program four times over.
fn assert_cursors_agree_at(t: &LambdaTerm, label: &str, cap: u64) -> (Option<Status>, OwnerCensus) {
    let mut lc = LambdaCursor::new(t, cap);
    let expected: Vec<StepEvent> = lc.by_ref().collect();

    let mut zc = ZipperCursor::new(t, cap);
    let got: Vec<StepEvent> = zc.by_ref().collect();

    assert_eq!(got.len(), expected.len(), "step count differs for {label}");
    assert_eq!(got, expected, "event sequence differs for {label}");
    assert_eq!(zc.term(), *lc.term(), "normal form differs for {label}");
    assert_eq!(zc.status(), lc.status(), "status differs for {label}");

    // The last step's owner must also be reachable from the cursor itself, and must be the one the
    // last event carried — `LambdaCursor` stores it because the redex `App` is gone by the time a
    // caller could ask. Checked here rather than in a test of its own so every shape in this file
    // covers it.
    if let Some(StepEvent::Beta { redex, owner }) = expected.last() {
        assert_eq!(lc.last_owner(), *owner, "last_owner disagrees with the last event for {label}");
        assert_eq!(lc.last_redex(), Some(redex), "last_redex disagrees with the last event for {label}");
    }

    let mut census = OwnerCensus::default();
    census.observe(&got);
    (zc.status(), census)
}

/// `assert_cursors_agree_at` at `EQUIV_CAP` — what every terminating shape (curated and generated)
/// uses, since none of them come close to it.
fn assert_cursors_agree(t: &LambdaTerm, label: &str) -> OwnerCensus {
    assert_cursors_agree_at(t, label, EQUIV_CAP).1
}

/// Shapes chosen for what they exercise, not for coverage: a redex that moves UP after a step (the
/// case a descent-only cache gets wrong), one that moves down, nested binders, and a program whose
/// reduction is long enough that resumption has somewhere to go wrong.
#[test]
fn curated_shapes_agree_step_for_step() {
    let cases = [
        ("arithmetic", "1 + 2 * 3"),
        ("let chain", "let x = 1; let y = x + x; y * 3"),
        ("conditional", "if 2 > 1 { 10 } else { 20 }"),
        ("recursion", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"),
        ("list", "let xs = [1, 2, 3]; head(xs)"),
        (
            "higher order",
            "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
        ),
    ];
    let mut census = OwnerCensus::default();
    for (label, src) in cases {
        let t = term_of(src).unwrap_or_else(|| panic!("{label} must lower"));
        census.merge(assert_cursors_agree(&t, label));
    }

    // **THE HALF OF THIS GATE THAT WOULD OTHERWISE BE ASSUMED.** See `OwnerCensus`. Both tagged
    // variants must actually occur across these six programs, because the two mistakes worth catching
    // produce different symptoms: dropping the redex's own tag turns `Exact` into `Within` or `None`,
    // and dropping the context scan turns `Within` into `None`. A gate that only ever saw `None` on
    // both sides would pass against either.
    assert!(census.exact > 0, "no curated shape produced Owner::Exact; the owner comparison is vacuous: {census:?}");
    assert!(census.within > 0, "no curated shape produced Owner::Within; the owner comparison is vacuous: {census:?}");

    // Capping cases. `EQUIV_CAP` never fires on the six shapes above or on any generated program (see
    // `EQUIV_CAP`'s doc) — everything else in this file terminates. These four are built specifically
    // to make the cap fire, so the "agree on `Status`" half of the property has coverage beyond
    // `Some(Normalized)` compared with itself.

    // Pure divergence: `(\x. x x)(\x. x x)` never normalizes, so any cap must fire on it.
    let omega_component = abs("x", app(var(0), var(0)));
    let omega = app(omega_component.clone(), omega_component.clone());
    let (status, _) = assert_cursors_agree_at(&omega, "omega divergence", 50);
    assert_eq!(status, Some(Status::HitCap), "pure divergence must hit the cap, not normalize");

    // `\k. v1 ((\x. x x)(\x. x x))` — the diverging redex sits in an `App`'s ARGUMENT position, under a
    // live outer binder. Leftmost-outermost order descends past `v1` (not a redex: a bare `Var`) into
    // the omega term before it ever hits the cap, so the stack still holds `[AbsBody, AppR, ...]` at
    // every capping step — NON-EMPTY. `EQUIV_CAP` on the six shapes and the generated corpus is a
    // vacuous check at the root (both cursors report `Some(Normalized)` trivially, and `zc.term()` is
    // only ever compared with an empty stack); this case is what makes `zc.term()`'s fold exercised
    // from a non-root position at integration level, matching `term_folds_the_context_stack_in_the_
    // right_direction`'s unit-level coverage of the same fold in `zipper.rs`.
    let under_binder = abs("k", app(var(1), omega));
    let (status, _) = assert_cursors_agree_at(&under_binder, "divergence under a live binder", 37);
    assert_eq!(status, Some(Status::HitCap), "divergence under a binder must hit the cap, not normalize");

    // Unbounded recursion through a real program, at two different caps — both must still agree.
    let recursive_call = term_of("fn f(n) { f(n) } f(1)").expect("recursive call must lower");
    let (status, _) = assert_cursors_agree_at(&recursive_call, "unbounded recursion (cap 400)", 400);
    assert_eq!(status, Some(Status::HitCap), "unbounded recursion must hit the cap, not normalize");
    let (status, _) = assert_cursors_agree_at(&recursive_call, "unbounded recursion (cap 137)", 137);
    assert_eq!(status, Some(Status::HitCap), "unbounded recursion must hit the cap, not normalize");
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// The property over generated programs. `arb_expr_over` is the shared first-order generator —
    /// signature `arb_expr_over(leaf: impl Strategy<Value = String> + 'static) -> impl Strategy<Value
    /// = String>`, so it takes a leaf *strategy* and yields source text directly.
    ///
    /// **The leaf range (`0u64..8`) was chosen by measurement, not to mirror any call site — it does
    /// NOT mirror `llvm_oracle.rs:153`'s `(0u64..1000)`.** Arithmetic here runs on CHURCH NUMERALS, so
    /// cost scales with the numeral's VALUE; which redex normal order picks next depends only on the
    /// term's structure, never on the magnitude of a leaf, so a narrower range changes nothing about
    /// what this test exercises. Measured in release: `0u64..8` runs this proptest in 0.22 s;
    /// `0u64..64` takes >110 s; `0u64..1000` takes >5 min. This range in fact mirrors
    /// `three_way_oracle.rs:535`'s `arb_tm_safe_expr`, which lands on the same bound for an unrelated
    /// reason — TM fixed-width-field safety — irrelevant to this file. A future editor "restoring" a
    /// wider range on the belief that it should match `llvm_oracle.rs` will hang this suite. See the
    /// generator's doc in `redextape-test-support` for why the recursion parameters must not be changed
    /// either.
    #[test]
    fn generated_programs_agree_step_for_step(
        src in arb_expr_over((0u64..8).prop_map(|n| n.to_string()))
    ) {
        if let Some(t) = term_of(&src) {
            let census = assert_cursors_agree(&t, &src);
            // **PER CASE, NOT ACCUMULATED, AND IT HOLDS FOR A STRUCTURAL REASON.** `arb_expr_over`
            // emits `+`, monus `-`, `>`, `==` and `if` over integer leaves. A program that is a bare
            // leaf lowers to a Church numeral with no redex and takes no step at all — nothing to
            // attribute. Every other generated program has a `BinOp` or `If` at its root, which
            // `lower.rs` tags at its own root `App`, so the first redex is that node or lies beneath
            // it and cannot report `Owner::None`. Later steps legitimately can, once the tagged root
            // has itself been contracted away — hence "at least one", not "all".
            prop_assert!(
                census.total() == 0 || census.tagged() > 0,
                "{src:?} stepped {} times without a single tagged owner — the owner half of this \
                 gate is vacuous on it: {census:?}",
                census.total()
            );
        }
    }
}
