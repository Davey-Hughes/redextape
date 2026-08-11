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
//! from source. The generated half (the proptest below) is covered by `lower.rs` tagging `BinOp` and
//! `If`, the only constructs `arb_expr_over` emits. The curated half additionally runs a region-path
//! loop shape whose tags come from five other `lower.rs` arms entirely — `Let { mutable: true }` (both
//! arms), `Seq`, the region `If`, and `build_while`'s own root — none of which the generator can ever
//! produce. The census assertions below hold both halves of that fact rather than assume it.
//!
//! Proptest rather than the 46-program corpus, deliberately. `FIRST_ORDER_DEMOS` lives in a test
//! target and has been hand-copied five times with a sync test holding the copies together; a sixth
//! copy is the drift this tree has fought twice. Generated programs are stronger evidence for an
//! equivalence property anyway. The corpus-wide check lives in `examples/lambda_sharing_probe.rs`,
//! which already owns a checked copy, and is reported rather than gated.

// Test target: `clippy.toml`'s `allow-*-in-tests` keys do not reach free helpers in a `tests/` target,
// so the exemption is stated per target — same idiom as `lambda_sharing.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::collections::BTreeSet;

use proptest::prelude::*;
use redextape_core::core::{Core, NodeId};
use redextape_core::desugar::desugar;
use redextape_core::lambda::reduce::Owner;
use redextape_core::lambda::term::{abs, app, var};
use redextape_core::lambda::{LambdaTerm, Status, lower};
use redextape_core::parser::parse;
use redextape_core::trace::{LambdaCursor, StepEvent, ZipperCursor};
use redextape_test_support::arb_expr_over;

/// The desugared `Core` a source string lowers from, kept separate from `term_of` so a caller can
/// walk `Core` for a construct's own `NodeId` (`ids_where`, below) without re-parsing — the same
/// split `lambda_provenance.rs` uses (`SourceMap::build_from_program` then a separate `lower` call).
fn core_of(src: &str) -> Option<Core> {
    let (prog, ds) = parse(src);
    if !ds.is_empty() {
        return None;
    }
    Some(desugar(&prog?))
}

fn term_of(src: &str) -> Option<LambdaTerm> {
    lower(&core_of(src)?).ok()
}

/// The `NodeId` of every `Core` node satisfying `pred`, over the whole tree. Iterative with an
/// explicit worklist, and it MUST stay that way: `Core::for_each_child`'s doc (`core.rs:84-89`) states
/// that a long statement spine can be tens of thousands of nodes deep and that recursive traversal of
/// it "aborts the process with an uncatchable stack overflow", and that `for_each_child` "must never
/// call itself" for exactly that reason — a recursive caller here would defeat the point. Mirrors
/// `find_id` in `lambda_provenance.rs`, generalized to collect every match instead of the first.
fn ids_where(core: &Core, pred: &dyn Fn(&Core) -> bool) -> BTreeSet<NodeId> {
    let mut out = BTreeSet::new();
    let mut stack = vec![core];
    while let Some(n) = stack.pop() {
        if pred(n) {
            out.insert(n.id());
        }
        n.for_each_child(&mut |c| stack.push(c));
    }
    out
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
/// terms here are LOWERED from source. The generated programs are tagged by `lower.rs`'s `BinOp` and
/// `If` arms — the two constructs `arb_expr_over` generates — at their own root `App`, so they are
/// tagged in the way real programs are. The curated shapes below go further: the region-path loop shape
/// is tagged by five other `lower.rs` arms on the store-passing path (`Let { mutable: true }`, `Seq`,
/// the region `If`, `build_while`'s own root) that no generated program ever reaches. The assertions
/// below are what hold that true rather than assumed.
///
/// Measured 2026-08-10: the six curated programs emit 115 `Exact`, 522 `Within` and 228 `None`, and the
/// smallest program the generator can produce that steps at all — `(0 + 0)` — emits 1, 1 and 4. So the
/// gate does see the field; these assertions are what will say so if lowering ever stops tagging.
///
/// `exact_ids` and `within_ids` exist because a bare count cannot name what it counted. A floor like
/// `exact > 30` stays green as long as the SUM across every tagged construct clears it, whichever
/// construct actually supplied the tags — so it goes blind the moment one construct loses its tag as
/// long as the others keep the total up. Measured 2026-08-10: reverting `Let { mutable: true }`'s own
/// tag (`lower.rs:611`) or `build_while`'s root tag (`lower.rs:766`) individually still left `exact` at
/// 49 and 50 respectively, both comfortably above such a floor. Recording each event's own `NodeId` is
/// what lets an assertion be about ONE construct rather than the sum of all of them.
#[derive(Default, Debug)]
struct OwnerCensus {
    exact: usize,
    within: usize,
    none: usize,
    /// The `NodeId` of every construct that was the contracted redex's OWN tag (`Owner::Exact`) in
    /// this run — a set, not a count, so a caller can check one construct's presence directly.
    exact_ids: BTreeSet<NodeId>,
    /// The `NodeId` of every construct reached instead by `ZipperCursor`'s reverse context-stack scan
    /// (`Owner::Within`) — the innermost enclosing tag, not the redex's own.
    within_ids: BTreeSet<NodeId>,
}

impl OwnerCensus {
    fn observe(&mut self, events: &[StepEvent]) {
        for e in events {
            match e {
                StepEvent::Beta { owner: Owner::Exact(id), .. } => {
                    self.exact += 1;
                    self.exact_ids.insert(*id);
                }
                StepEvent::Beta { owner: Owner::Within(id), .. } => {
                    self.within += 1;
                    self.within_ids.insert(*id);
                }
                StepEvent::Beta { owner: Owner::None, .. } => self.none += 1,
                StepEvent::Delta { .. } => panic!("a lambda cursor emitted a Delta event"),
            }
        }
    }

    fn merge(&mut self, other: OwnerCensus) {
        self.exact += other.exact;
        self.within += other.within;
        self.none += other.none;
        self.exact_ids.extend(other.exact_ids);
        self.within_ids.extend(other.within_ids);
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
    // variants must actually occur across these six curated shapes, because the two mistakes worth
    // catching produce different symptoms: dropping the redex's own tag turns `Exact` into `Within` or
    // `None`, and dropping the context scan turns `Within` into `None`. A gate that only ever saw
    // `None` on both sides would pass against either.
    //
    // **ASSERTED HERE, BEFORE THE REGION-PATH LOOP CENSUS BELOW IS MERGED IN — NOT AFTER.** The
    // per-construct assertions below (`ids_where` plus `loop_census.exact_ids`/`within_ids`) already
    // require the loop shape to produce both `Exact` and `Within` on its own. If these two asserts ran
    // after `census.merge(loop_census)` instead, that stronger per-construct guard would make them
    // unfalsifiable: reverting every `lower_expr` tagging site (`BinOp`, `If`, the `Apply` spine,
    // `Let`, `LetRec`) — i.e. exactly the state that would make "the owner comparison is vacuous"
    // true — leaves hundreds of region-path `Exact`/`Within` events in the merged total, so both
    // asserts would stay green while the six functional shapes above tagged nothing at all.
    assert!(
        census.exact > 0,
        "none of the six curated shapes produced Owner::Exact; the owner comparison is vacuous: {census:?}"
    );
    assert!(
        census.within > 0,
        "none of the six curated shapes produced Owner::Within; the owner comparison is vacuous: {census:?}"
    );

    // THE REGION PATH, WHICH NOTHING IN THIS FILE REACHED BEFORE. The six shapes above are all
    // functional, and `arb_expr_over` emits only `+`, monus `-`, `>`, `==` and `if` over integer
    // leaves — so `while`, `let mut` and assignment were never executed by the strongest gate in the
    // crate. That matters beyond coverage arithmetic: `ZipperCursor` derives `Owner` from a reverse
    // scan of its context stack where `reduce_step_go` carries it down a descent, and `build_while`'s
    // `fix`-based spine is deeper and differently shaped than anything the six above produce. Two
    // routes to one answer diverge, if they diverge at all, exactly there.
    //
    // BOUND SEPARATELY RATHER THAN ADDED TO `cases` because Task 4 asserts this shape's own census:
    // merged into the total, a region path reporting `None` for every step would hide behind the
    // hundreds of `Exact`/`Within` the functional shapes already supply.
    let loop_src = "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc";
    let loop_core = core_of(loop_src).expect("the loop shape must parse and desugar");
    let loop_t = lower(&loop_core).unwrap_or_else(|_| panic!("the loop shape must lower"));
    let loop_census = assert_cursors_agree(&loop_t, "mutation and a loop");

    // THE REGION PATH'S OWN CENSUS, ASSERTED ALONE. Merged into the total it would be invisible: the
    // six functional shapes already supply hundreds of `Exact` and `Within`, so a region path that
    // reported `None` for every step would leave `census.exact > 0` and `census.within > 0` green.
    //
    // **WHAT THIS FIXTURE ACTUALLY CONTAINS, AND WHERE ITS SURVIVING `Exact` EVENTS ACTUALLY COME
    // FROM.** An earlier version of this assertion was `exact > 30`, justified by a comment claiming
    // `let mut`, `while`'s own root `App` (`build_while`) "and region `if` each tag independently of
    // `Seq`". Both halves of that claim were wrong. There is no `Core::If` anywhere in this fixture —
    // it has no `if` at all, only `Let { mutable: true }` (twice), the `Seq` joining the loop to its
    // continuation, and the `While` itself. And measured directly: reverting only `Seq`'s own tag
    // (`lower.rs:652`) drops `exact` from 51 to 22 — but 19 of those 22 SURVIVING `Exact` events come
    // from `lower_expr`'s `BinOp` arm (the functional path this fixture's `acc + 1`, `n - 1` and
    // `n > 0` also go through), not from any region construct at all; only 3 of 22 are region-path
    // `Exact` events. A floor between 22 and 51 mostly measures whether `BinOp` is still tagged, which
    // no revert here ever touches — and reverting `Let { mutable: true }` or `build_while`'s own root
    // tag individually left `exact` at 49 and 50, both comfortably clear of a floor that also has to
    // sit below 51. A count cannot distinguish "the construct I care about lost its tag" from "an
    // unrelated construct is still tagged"; only naming each construct's own `NodeId` and checking it
    // directly can. `ids_where` plus the loop below do that instead, one construct at a time.
    for (what, pred) in [
        ("while", &(|c: &Core| matches!(c, Core::While(..))) as &dyn Fn(&Core) -> bool),
        ("let mut", &|c: &Core| matches!(c, Core::Let { mutable: true, .. })),
        ("statement sequence", &|c: &Core| matches!(c, Core::Seq(..))),
    ] {
        let ids = ids_where(&loop_core, pred);
        assert!(!ids.is_empty(), "the loop fixture must contain a {what}");
        for id in ids {
            assert!(
                loop_census.exact_ids.contains(&id),
                "no step in the loop shape was attributed to the {what} at node {id}: the \
                 store-passing spine's tag for it never reached a redex. Owners seen: {:?}",
                loop_census.exact_ids
            );
        }
    }

    // **THE OTHER FAILURE SHAPE, NAMED SEPARATELY.** `OwnerCensus`'s doc (and this file's module doc)
    // distinguish two ways this gate can go blind: a dropped OWN tag turns `Exact` into `Within` or
    // `None` (what the loop above catches), and a dropped CONTEXT SCAN turns `Within` into `None` —
    // `ZipperCursor::reduce_here`'s reverse walk of its context stack is exactly that scan, and nothing
    // above exercises it. `While` is the one construct in this fixture whose `Within` presence is
    // stable enough to anchor on: its root `App` encloses the entire loop body, so a redex deep inside
    // that no nearer `Let`/`Seq` tag covers reports `Owner::Within(while_id)` instead of `Owner::None`
    // — measured at HEAD, `within_ids` is exactly `{while_id}` plus the fixture's three `BinOp` ids;
    // `Let { mutable: true }`'s and `Seq`'s own ids never appear there AT ALL, at HEAD or under any of
    // the three reverts below, because every step this fixture attributes to them is `Exact`, never the
    // *enclosing* tag for a deeper redex — so there is no `Within` presence to assert for either one.
    // Losing `build_while`'s own root tag (`lower.rs:766`) removes `while_id` from every `App` in the
    // term, so it can no longer be named by EITHER an exact contraction or a context scan — the one
    // mutation this fixture can drive that breaks both symptoms from the same root cause, and (checked
    // directly) `within_ids` stays exactly `{while_id, ...the three BinOp ids}` under the other two
    // reverts (`Seq`, `Let { mutable: true }`), so `While`'s `Within` presence is not an artifact of
    // whichever revert happened to be active when it was measured.
    let while_ids = ids_where(&loop_core, &|c: &Core| matches!(c, Core::While(..)));
    assert!(!while_ids.is_empty(), "the loop fixture must contain a while");
    for id in while_ids {
        assert!(
            loop_census.within_ids.contains(&id),
            "no step in the loop shape reached the while at node {id} through ZipperCursor's reverse \
             context scan (Owner::Within): the while's tag never showed up as an enclosing tag for any \
             step. Owners seen: {:?}",
            loop_census.within_ids
        );
    }

    // Folded in for completeness, not for a vacuity check: the six-shape floor above already ran
    // before this merge, on purpose (see that assert's comment), and the loop shape's own tags are
    // guarded directly by the per-`NodeId` assertions above rather than by a floor on the merged total.
    census.merge(loop_census);

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
