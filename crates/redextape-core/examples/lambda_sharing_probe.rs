//! λ-term sharing probe — a hash-consing DRY RUN, measured before anything is implemented.
//!
//!     cargo run --release --example lambda_sharing_probe -p redextape-core
//!
//! # PART B WENT STALE ON 2026-08-01 AND WAS REPAIRED ON 2026-08-02 — READ THIS BEFORE ANY B/C FIGURE
//!
//! **The failure is worth stating before the fix, because it is the interesting half.** PART B's cost
//! counters were STATIC MODELS: `Σ abs×arg` is `count_abs(body) × size_of(arg)`, computed from the
//! trace's terms rather than by watching `subst`. When the `maxfree` short-circuits and the stored
//! `depth` landed and the reducer got three to four orders of magnitude faster, **every counter here
//! reported exactly the number it had reported the day before.** An instrument built to falsify claims
//! about cost could not detect that its own subject had changed underneath it.
//!
//! It showed up as nonsense rather than as silence, which is the only reason it was caught: only **2 of
//! 46 rows** still cleared timer resolution, the two-price fit was left fitting two parameters to two
//! points and returned **-77.04 ns/node** for read-only work, and the closing table projected
//! **-427.5 ms** of remaining time. A negative millisecond is an instrument reporting that it can no
//! longer price its corpus.
//!
//! **What the models were wrong by**, now printed by PART B itself rather than quoted here:
//! `Σ abs×arg` over-reports the re-shift `subst` performs by **~1,584x** (70,542,349 against 44,539),
//! and `Σ size` over-reports `depth_exceeds` by **~1,248x** (7,433,964 against 5,955 — it reads a
//! stored field, once per step). The headline "86.8% of the nodes the reducer visits" is a share of the
//! first and inherits its error. The fix PART C used to project at 7.0x/18.0x measures at **2.16x here
//! and 0.99x — a regression — on the nested-group family**; it is falsified and will not be built. See
//! `shift_cost_probe.rs`'s census section and the perf design's §10.
//!
//! **The repair, in three parts.** (1) Counters that MIRROR the functions — `Σ opening`, `Σ spine`,
//! `Σ reshift`, `Σ closing`, `Σ guard` — replacing the products in `alloc`/`read`. (2) The stale models
//! kept beside them as CONTROLS and entered in PART C's contest, where they lose: `Σ alloc` now prices
//! at a spread of 1.8x against `Σ abs×arg`'s 4,318x. (3) Batched timing — each replay repeated until it
//! clears `BATCH_MIN_MS` — which puts all 46 rows back above the timer and makes the two-price fit a
//! fit again (`a` stable to ~1% under leave-one-out, where it printed `0.00 to 0.00 (infx)`).
//!
//! The accounting now predicts the clock: 189,152 nodes at the fitted prices is 7.6 ms against a corpus
//! that replays in 7.4 ms.
//!
//! **What was never stale:** PART A. The sharing/interning measurement is structural — node and distinct
//! counts over the trace — and does not depend on either fix. Its own module doc already records that
//! its numbers did not move when `LambdaTerm` became `Rc`-backed.
//!
//! **THE LESSON THIS FILE IS NOW THE RECORD OF:** a counter that models a function instead of measuring
//! it has no way to notice that the function changed. Mirroring the code costs one extra `subst` per
//! step in `account` and is worth it. Where that is genuinely impossible, the counter needs a
//! sanity check against the clock that fails loudly — which is what PART C's `spread` column turned out
//! to be, and why it caught this at all.
//!
//! This exists to answer one question with data instead of intuition: **is interning (hash-consing)
//! worth more than plain `Rc` structural sharing?** It answers it WITHOUT implementing interning, by
//! running hash-consing's own algorithm — a bottom-up intern pass keyed on already-interned children —
//! offline over the terms the reducer produces today.
//!
//! IT WAS WRITTEN AGAINST THE `Box` REPRESENTATION AND ITS NUMBERS DID NOT MOVE WHEN `LambdaTerm`
//! BECAME `Rc`-BACKED, which is worth stating because the opposite is the natural guess. The traversal
//! descends into both children of every `App`, so a subterm reached twice is walked twice whether the
//! two edges are two `Box`es or two handles on one allocation: the pass measures the LOGICAL tree, and
//! structural sharing changes only how that tree is stored. Measured either side of the conversion,
//! the corpus totals are identical to the node — 7,435,004 trace nodes, 43,580 within-term nodes over
//! 2,994 distinct (14.56x). So the `share` columns still mean what they say below, and none of them is
//! evidence that `Rc` sharing is or is not working.
//!
//! TWO RATIOS COME OUT, AND ONLY ONE OF THEM DECIDES THE QUESTION FROM THIS TABLE ALONE.
//!
//!   * **across-trace** (Σ nodes over every step's term ÷ distinct subterms across all of them).
//!     This is the CEILING for sharing of any kind, and BY ITSELF IT CANNOT TELL YOU WHETHER
//!     INTERNING IS WORTH IT: `Rc` takes an unmeasured share of it, because consecutive terms differ
//!     only along the redex path and every untouched sibling is physically inherited. Where that share
//!     HAS been counted — rows 9 and 7, by `tests/lambda_sharing.rs` — `Rc` leaves a residual that
//!     interning would still collapse by 10.3x and 50.0x, so the RESIDUAL AFTER `Rc` is what
//!     discriminates. The printed number on its own does not: the other 44 rows have no allocation
//!     count, so nothing says how much of the number `Rc` has already taken.
//!
//!     CORRECTED 2026-07-31. This bullet read "`Rc` already captures the bulk of it ... proves nothing
//!     about interning" — an inference made before any `Rc` allocation existed to count. Layer 1
//!     produced them, and on the two rows now counted the conclusion did not survive. The design's §3
//!     records the correction — and note what the correction does NOT say: that a big number here
//!     justifies interning. That would be false on the 44 rows with no allocation count.
//!
//!   * **within-term** (nodes of the single largest term ÷ distinct subterms inside THAT term).
//!     This is the number that decides it. It counts subterms that are structurally identical but
//!     were BUILT SEPARATELY — which `Rc` cannot share and interning can. If this is ~1.0, interning
//!     buys nothing beyond `Rc` and the question is closed.
//!
//! WHAT THIS PROBE DOES NOT MEASURE, stated so the table is not over-read. It measures the SHARING
//! (memory) win. Interning's speed win is a separate and weaker claim: `subst`/`shift` still traverse
//! the whole abstraction body, and under de Bruijn a shifted copy carries DIFFERENT INDICES, so it is
//! a structurally new term that interning does not dedupe. A large within-term ratio justifies
//! interning on memory; it does not by itself justify it on reduction speed.
//!
//! The `ns/node` column is the cost side: the throughput of the intern pass itself, to be weighed
//! against the ~35 ns/node the reducer already pays to CONSTRUCT one — PART C.2's fitted allocating
//! price, measured below in this same run. Both figures are whole-traversal costs, walking a node and
//! paying for it, so they compare directly: the intern pass is about **1.7x** dearer per node, not the
//! ~15x that this line's earlier "~4 ns/node" (a figure nothing here ever measured) implied.
//!
//! PART B AND PART C ANSWER A DIFFERENT QUESTION AND SHARE ONLY THE CORPUS. Everything above is about
//! what interning would SAVE. PART B is about what replay currently SPENDS, and it exists because
//! PART A's `replay ms` column carries a 6.7x that node count contradicts: row 7 has more steps and
//! bigger terms than row 31 and runs 6.7x faster. It counts, per β-step, the size of every traversal
//! the reducer actually performs, and PART C checks the candidate against all 46 rows rather than the
//! two that motivated it. The answer is `Σ abs×arg` — `subst` deep-copies the argument once per `Abs`
//! NODE IN THE BODY (its `Abs` arm re-shifts it), where the step has ~1 use for it — and it is **86.8%
//! of the nodes the reducer visits**. That is neither of the two costs this file's sharing question was
//! about, and no amount of interning or memoization addresses it; see the design's §10.
//!
//! **A NODE SHARE IS NOT A TIME SHARE, AND PART C.2 IS WHERE THE DIFFERENCE IS MEASURED.** Turning one
//! into the other needs a price per node, and the obvious assumption — one price, whatever the
//! traversal was doing — is testable rather than obligatory. It fails: nodes the reducer CONSTRUCTS and
//! nodes it merely READS price about 18x apart, so `depth_exceeds`' whole-term walk is a large share of
//! the node count and a small share of the clock. PART C.2 fits both prices, prints the collinearity and
//! leave-one-out diagnostics that say whether the second parameter is earned, and PART C's closing table
//! reports the effect of the proposed fix under BOTH models rather than under the flattering one.
//!
//! TIMING-DERIVED COLUMNS ARE RUN-DEPENDENT and the tables quoted in the design are from one run.
//! `replay ms` is best-of-three, but `ns/node`, every fitted price and everything derived from them come
//! from a SINGLE pass, so they move a few percent between runs on the same machine. The structural
//! columns do not move at all. Re-derive rather than reconcile.
//!
//! The corpus is `tests/three_way_oracle.rs::FIRST_ORDER_DEMOS`, copied verbatim (an example is a
//! separate binary crate and Cargo has no supported way to share a `const` with a test target).
//! It was extracted mechanically rather than retyped: that list has drifted from hand-copying twice
//! before, as `step_survey.rs`'s module doc records. Programs the λ backend cannot lower are skipped
//! and counted, not silently dropped. The copy below is now CHECKED, by
//! `three_way_oracle.rs::first_order_demos_stay_synced_across_all_five_copies` — see its own doc
//! comment, which reads this file, and the array's, for why it took two attempts to get here.

// Example target: `clippy.toml`'s `allow-*-in-tests` keys do not reach example targets at all, so the
// exemption is stated per target. A probe that cannot build its own fixture has nothing to report.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::time::Instant;

use redextape_core::desugar::desugar;
use redextape_core::lambda::term::{Dir, Node, abs, app, shift, subst, var};
use redextape_core::lambda::{LambdaTerm, MAX_REDUCTION_STEPS, Trace, lower, reduce_trace};
use redextape_core::parser::parse;
use redextape_core::trace::{LambdaCursor, ZipperCursor};

/// Verbatim copy of `tests/three_way_oracle.rs::FIRST_ORDER_DEMOS` (comments stripped).
///
/// THIS COPY IS COVERED, and was not until the whole-branch review found it. `three_way_oracle.rs`'s
/// `first_order_demos_stay_synced_across_all_five_copies` reads this file as text and asserts its
/// literals are byte-for-byte equal to the canonical array's. It was the FIFTH copy and the last one
/// found: that test had just been extended from three to four, by a fix that enumerated the damage and
/// missed this file. Nothing here needs a by-hand diff before it is trusted.
const FIRST_ORDER_DEMOS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "if 1 == 2 { 10 } else { 20 }",
    "let x = 40; x + 2",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    "let add1 = |x| x + 1; add1(41)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    "fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))",
    "is_empty(nil)",
    "is_empty(cons(1, nil))",
    "[1, 2, 3]",
    "cons(1, cons(2, nil))",
    "head(cons(7, nil))",
    "tail(cons(7, nil))",
    "head(cons(1, cons(2, nil)))",
    "tail(cons(1, cons(2, nil)))",
    "head(tail(cons(1, cons(2, nil))))",
    "head([1, 2, 3])",
    "tail([1, 2, 3])",
    "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
    "let n = 5; fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } [1, 2, 3].map(|x| x + n)",
    "\
        fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
        fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
        fn add(a, b) { a + b }\n\
        fn add1(x) { x + 1 }\n\
        fold([3, 1, 2].map(add1), 0, add)",
    "fn ap(f, x) { f(x) } let add = |y| |z| y + z; ap(ap(add, 4), 5)",
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)",
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(5)",
    "fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)",
    "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \
     fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } \
     fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)",
    "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
     fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(4, id)",
    "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
     fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(3, id)",
    "fn ap(h,x){ h(x) } fn f(n){ ap(g, n) } fn g(n){ n + 1 } f(3)",
    "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } fn ap(g, x) { g(x) } ap(sum, 4) + sum(2)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
     fn add1(x) { x + 1 }\n\
     fn ap2(g, a, b) { g(a, b) }\n\
     head(map([1, 2], add1)) + head(ap2(map, [5, 6], add1))",
    "fn v(x) { x * 10 } fn b(x) { x + 1 } fn ap(g, x) { g(x) } ap(v, 1) + ap(b, 1) + b(5)",
    "fn b(x) { x + 1 } fn v(x) { x * 10 } fn ap(g, x) { g(x) } ap(v, 1) + ap(b, 1) + b(5)",
    "fn head(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } head(1) + ap(add1, 2)",
    "fn head(x) { x + 1 } fn ap(g, x) { g(x) } head(1) + ap(head, 2)",
    "let n = 7; fn tail(x) { x + 1 } fn ap(g, y) { g(y) } tail(3) + ap(tail, 2) + ap(|y| y + n, 5)",
    "fn nil(x) { x + 5 } fn ap(g, x) { g(x) } ap(nil, 0)",
    "fn nil(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } nil(1) + ap(add1, 2)",
    "fn cons(a, b) { a + b } fn ap2(g, a, b) { g(a, b) } cons(1, 2) + ap2(cons, 3, 4)",
];

/// Above this many nodes in one trace, the intern pass is skipped rather than run: the probe holds
/// every step's term at once (that is the cost it exists to measure), and an unbounded run would
/// trade the measurement for an OOM. Skipped rows report their node count and blank the ratios, so a
/// skip is visible in the table rather than absent from it.
const MAX_INTERN_NODES: u64 = 40_000_000;

/// A structural key over ALREADY-INTERNED children. This is what makes the pass O(1) per node
/// instead of O(subtree): by the time a node is keyed, its children are ids, not trees.
///
/// The `Abs` name hint is deliberately absent, matching `LambdaTerm`'s own `PartialEq` (`term.rs`),
/// which ignores it — equality is de Bruijn structural. An interner that distinguished name hints
/// would UNDER-report sharing relative to the equality the rest of the crate uses.
#[derive(PartialEq, Eq, Hash)]
enum Key {
    Var(u32),
    Abs(u32),
    App(u32, u32),
}

#[derive(Default)]
struct Interner {
    ids: HashMap<Key, u32>,
    next: u32,
}

impl Interner {
    fn intern(&mut self, k: Key) -> u32 {
        let fresh = self.next;
        match self.ids.entry(k) {
            Entry::Occupied(e) => *e.get(),
            Entry::Vacant(e) => {
                e.insert(fresh);
                self.next += 1;
                fresh
            }
        }
    }
}

enum Visit<'a> {
    Down(&'a LambdaTerm),
    Up(&'a LambdaTerm),
}

/// Intern every subterm of `t` bottom-up into `iv`, returning the node count.
///
/// ITERATIVE ON PURPOSE, not as a style preference: `term.rs` gives `LambdaTerm` a hand-written
/// iterative `Drop` precisely because these terms reach depths that abort a recursive walk, and a
/// probe that overflows the stack measures nothing. The explicit `Down`/`Up` stack is a post-order
/// traversal with bounded native stack.
fn intern_term(t: &LambdaTerm, iv: &mut Interner) -> u64 {
    // Node ADDRESS -> structural id. Keyed by address rather than by value because the whole tree is
    // alive for the duration of the call, so addresses are unique and stable within it.
    let mut by_addr: HashMap<*const LambdaTerm, u32> = HashMap::new();
    let mut stack = vec![Visit::Down(t)];
    let mut nodes = 0u64;
    while let Some(v) = stack.pop() {
        match v {
            Visit::Down(n) => {
                stack.push(Visit::Up(n));
                match n.node() {
                    Node::Var(_) => {}
                    Node::Abs(_, b) => stack.push(Visit::Down(b)),
                    Node::App(f, a) => {
                        stack.push(Visit::Down(f));
                        stack.push(Visit::Down(a));
                    }
                }
            }
            Visit::Up(n) => {
                nodes += 1;
                let key = match n.node() {
                    Node::Var(i) => Key::Var(*i),
                    Node::Abs(_, b) => Key::Abs(by_addr[&std::ptr::from_ref(b)]),
                    Node::App(f, a) => Key::App(by_addr[&std::ptr::from_ref(f)], by_addr[&std::ptr::from_ref(a)]),
                };
                let id = iv.intern(key);
                by_addr.insert(std::ptr::from_ref(n), id);
            }
        }
    }
    nodes
}

/// Node count alone, without interning — used to size a trace before deciding to intern it.
fn size_of(t: &LambdaTerm) -> u64 {
    let mut stack = vec![t];
    let mut n = 0u64;
    while let Some(node) = stack.pop() {
        n += 1;
        match node.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => stack.push(b),
            Node::App(f, a) => {
                stack.push(f);
                stack.push(a);
            }
        }
    }
    n
}

// ==================================================================================================
// PART B — per-step work accounting. A SEPARATE QUESTION from everything above, sharing only the
// corpus and the traces.
//
// PART A asks what interning would SAVE. PART B asks what replay currently SPENDS, because PART A's
// `replay ms` column contains a 6.7x that node count does not explain: row 7 has more steps (470 vs
// 411) and bigger terms (9,763 vs 4,898 nodes) than row 31 and runs in 180 ms against row 31's 1,203.
// Sharing did not touch it — both rows sped up ~2.5x when `LambdaTerm` became `Rc`-backed and the
// ratio between them barely moved. Whatever separates them is therefore not allocation volume.
//
// Each counter below is the size of one traversal the reducer actually performs, summed over the
// trace, in NODES VISITED. Read them as a cost model of `LambdaCursor::next`, which per step does:
//
//     depth_exceeds(term)          -> `term_size`                 (whole term, every step)
//     reduce_step's search         -> `scan` (+ `path_len`)
//     shift(1, 0, arg)             -> `arg_size`
//     subst(0, arg', body)         -> `body_size` + `abs_times_arg` + O(1) per occurrence
//     shift(-1, 0, result)         -> `body_size` + `occ_times_arg`, i.e. the reduct
//     spine rebuild                -> `path_len`
//
// THE COUNTERS ARE CHOSEN TO SEPARATE CANDIDATES, NOT TO CONFIRM ONE. If two move together across
// the corpus, neither is the answer, and PART C is what decides that rather than the eye.
//
// THEY ALSO SPLIT BY KIND, which PART C.2 needs and the list above already implies: the first two
// traversals only READ (`depth_exceeds` returns a bool, the redex search returns a path), and the rest
// CONSTRUCT a node for every node they walk. `Work::read` and `Work::alloc` are those two buckets.
// ==================================================================================================

/// Node-constructions `shift(d, cutoff, t)` performs, counted FAITHFULLY — the recursion mirrors
/// `shift`'s arm for arm and reads the stored `maxfree` for the short-circuit, and there is no memo
/// because `shift` has none. This and the two below are what made the model counters above obsolete:
/// they measure the function, where `Σ arg` / `Σ abs×arg` / `Σ occ×arg` model a function that stopped
/// existing on 2026-08-01.
fn shift_allocs(cutoff: u32, t: &LambdaTerm) -> u64 {
    if t.maxfree() <= cutoff {
        return 0;
    }
    match t.node() {
        Node::Var(_) => 1,
        Node::Abs(_, b) => 1 + shift_allocs(cutoff + 1, b),
        Node::App(f, a) => 1 + shift_allocs(cutoff, f) + shift_allocs(cutoff, a),
    }
}

/// Allocations `subst(j, s, t)` makes, as `(body spine, per-binder re-shift)`. Mirrors `term.rs`'s
/// `subst` arm for arm INCLUDING both `maxfree` short-circuits, so the `Abs` arm is charged only for
/// the binders actually descended through and the `Var` arms are charged nothing at all — both return
/// a handle.
fn subst_allocs(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> (u64, u64) {
    if t.maxfree() <= j {
        return (0, 0);
    }
    match t.node() {
        Node::Var(_) => (0, 0),
        Node::Abs(_, b) => {
            let re = shift_allocs(0, s);
            let lifted = shift(1, 0, s);
            let (spine, shifts) = subst_allocs(j + 1, &lifted, b);
            (1 + spine, re + shifts)
        }
        Node::App(f, a) => {
            let (sp1, sh1) = subst_allocs(j, s, f);
            let (sp2, sh2) = subst_allocs(j, s, a);
            (1 + sp1 + sp2, sh1 + sh2)
        }
    }
}

/// Per-step work accounting, summed over a whole trace. Units: nodes visited.
///
/// **TWO GENERATIONS OF COUNTER LIVE HERE AND THE TABLE PRINTS BOTH.** The `*_size` / `*_times_arg` /
/// `term_size` fields are the ORIGINAL static models, kept as controls: they were written against a
/// `subst` whose `Abs` arm copied unconditionally and a `depth_exceeds` that walked the whole term, and
/// they report the same numbers today that they reported before those changed. The `opening` / `spine`
/// / `reshift` / `closing` / `depth_guard` fields mirror the functions instead. Keeping both is the
/// point rather than clutter — PART C's contest now has the stale counters in it, and watching them
/// lose to the faithful ones on the same corpus is the falsification, run rather than quoted.
#[derive(Default)]
struct Work {
    /// FAITHFUL. `beta`'s opening `shift(1, 0, arg)`. Zero whenever `arg` is closed, which is 88.4% of
    /// corpus steps — the single fact that retired the `subst` lifted-shift slice.
    opening: u64,
    /// FAITHFUL. The body spine `subst` rebuilds on the way down.
    spine: u64,
    /// FAITHFUL. `subst`'s `Abs` arm, `shift(1, 0, s)` once per binder DESCENDED THROUGH — not once per
    /// `Abs` node in the body, which is what `abs_times_arg` below still counts.
    reshift: u64,
    /// FAITHFUL. `beta`'s closing `shift(-1, 0, ·)` over the term `subst` just returned. It cannot
    /// short-circuit at cutoff 0 on a term with a free variable, which is why it rebuilds the reduct.
    closing: u64,
    /// FAITHFUL, and it is 1 per step: `depth_exceeds` reads a stored field. It used to walk the whole
    /// logical expansion, which is what `term_size` counts and what 96% of the hang turned out to be.
    depth_guard: u64,
    /// Spine-rebuild work: one node constructed per path element. Should be negligible after
    /// structural sharing — a large share here would mean the sharing is not doing its job.
    path_len: u64,
    /// Redex SEARCH, which `path_len` does not bound and which nothing else here stands in for. See
    /// `redex_at`.
    scan: u64,
    /// `subst`'s traversal: the size of the abstraction body it walks, per step.
    body_size: u64,
    /// `beta`'s opening `shift(1, 0, arg)`. Also the multiplier in the two counters below, broken
    /// out so a row with a huge argument is visible as such rather than only through a product.
    arg_size: u64,
    /// SUBSTITUTION BLOWUP — the hypothesis this accounting was built to test. Every occurrence of
    /// the bound variable is replaced by a copy of the shifted argument, so this is the work `subst`
    /// does that the body size alone does not bound.
    occ_times_arg: u64,
    /// THE ARGUMENT RE-SHIFTED UNDER EVERY BINDER, which the hypothesis above does not include and
    /// which is a different quantity: `subst`'s `Abs` arm is
    ///
    ///     Node::Abs(n, b) => abs(Rc::clone(n), subst(j + 1, &shift(1, 0, s), b))
    ///
    /// so the argument is deep-copied ONCE PER `Abs` NODE IN THE BODY — not once per OCCURRENCE of
    /// the variable. A body with 60 binders and one occurrence pays 60 copies of the argument to
    /// substitute it once. `occ_times_arg` and this differ by exactly the factor `#Abs(body)/occ`,
    /// so a corpus where they move together says nothing and a corpus where they diverge decides it.
    abs_times_arg: u64,
    /// Whether `depth_exceeds`' per-step O(size) walk is implicated: its cost tracks term size, and
    /// summing it here makes that comparable against the others.
    term_size: u64,
    /// Occurrences replaced, and `Abs` nodes walked, WITHOUT the argument-size multiplier. Not
    /// columns — the two ratios that make the finding legible in one sentence: how many copies of the
    /// argument a step actually needs, against how many it makes.
    occ: u64,
    abs_count: u64,
    /// Steps whose redex was not `(\. body) arg`. That would be a defect in the trace, not a case to
    /// tolerate — but this is a probe, so it is counted and reported rather than aborting the table.
    malformed: u64,
}

impl Work {
    /// The traversals that CONSTRUCT a node, **counted rather than modelled** since 2026-08-02. Every
    /// node here is an `Rc::new` plus the write that fills it, and every term is measured by mirroring
    /// the function that performs it:
    ///
    ///     reduce_step's spine rebuild  -> path_len       (one node per path element)
    ///     beta's shift(1, 0, arg)      -> opening
    ///     subst's body rebuild         -> spine
    ///     subst's Abs arm              -> reshift
    ///     beta's shift(-1, 0, ·)       -> closing
    ///
    /// **THE PREVIOUS VERSION OF THIS FUNCTION WAS `path + arg + body + abs×arg + (body - occ +
    /// occ×arg)`**, which is the same list expressed as static products — and every one of those
    /// products over-counts now. `arg` charges a full copy of an argument that is closed 88.4% of the
    /// time; `abs×arg` charges every `Abs` in the body where `subst` descends through the ones on the
    /// path to an occurrence; `occ×arg` charges a copy per occurrence where `subst`'s `Var` arm returns
    /// a handle. Corpus-wide the old sum reports 73,806,194 against a measured 68,188-plus-reduct.
    fn alloc(&self) -> u64 {
        self.path_len + self.opening + self.spine + self.reshift + self.closing
    }

    /// The traversals that only READ. `reduce_step`'s search walks rejected left siblings and returns a
    /// path; `depth_exceeds` reads a stored `depth` and returns a bool, so it is 1 per step rather than
    /// the whole-term walk `term_size` still counts. Split out from `alloc` because assuming the two
    /// cost the same is a MODEL, and PART C fits both prices rather than asserting one.
    fn read(&self) -> u64 {
        self.depth_guard + self.scan
    }

    /// Every traversal above, summed: the total nodes the reducer visits over the whole trace.
    ///
    /// This is the COMPLETENESS CHECK on the accounting, and it is what makes any claim about a
    /// single counter falsifiable. If the counters below are the whole cost AND a node costs the same
    /// to visit however it is visited, then time divided by this is one constant — and it is the same
    /// constant for a 400-node trace and a 35,000,000-node one. If some traversal is missing from the
    /// list, the constant drifts on exactly the rows where the missing one matters, and the drift
    /// names them. PART C tests both halves of that conditional separately.
    ///
    /// KNOWN GAP, stated because this is a control described as complete: the accounting is summed
    /// over `trace.steps`, and the final `reduce_step` that finds no redex — plus the `depth_exceeds`
    /// that precedes it — happens once per program after the last step and is not counted. One extra
    /// `Σ size + Σ scan` per program against 5,955 steps' worth; negligible, and it is read-only work,
    /// which PART C prices near zero anyway. It is the only traversal known to be outside the sum.
    fn model(&self) -> u64 {
        self.alloc() + self.read()
    }
}

/// Follow `path` from `t` to the redex, returning it and what `reduce_step` SPENT getting there.
///
/// The second number is the one the four-counter hypothesis lacks. `reduce_step` finds the
/// leftmost-outermost redex by recursion, and at an `App` it tries the function side first: if that
/// side holds no redex it has already visited EVERY node of it before the argument side is tried at
/// all. So each `AppR` in the path means one entire left sibling was traversed and rejected.
/// `path_len` bounds the spine REBUILD; nothing bounds the SEARCH, and the two differ by a whole
/// subtree per `AppR`.
///
/// `None` if the path leaves the term.
fn redex_at<'a>(t: &'a LambdaTerm, path: &[Dir]) -> Option<(&'a LambdaTerm, u64)> {
    let mut cur = t;
    let mut scan = 0u64;
    for d in path {
        cur = match (d, cur.node()) {
            (Dir::AppL, Node::App(f, _)) => f,
            (Dir::AppR, Node::App(f, a)) => {
                scan += size_of(f);
                a
            }
            (Dir::AbsBody, Node::Abs(_, b)) => b,
            _ => return None,
        };
    }
    Some((cur, scan))
}

/// Occurrences of the variable bound by the enclosing binder inside `body`. The index starts at `j`
/// and increments under each `Abs`, so this counts exactly what `subst(0, …)` will replace.
/// Iterative, carrying the index alongside each node, so a deep body cannot overflow.
fn count_occurrences(body: &LambdaTerm, j: u32) -> u64 {
    let mut stack = vec![(body, j)];
    let mut n = 0u64;
    while let Some((t, k)) = stack.pop() {
        match t.node() {
            Node::Var(i) => {
                if *i == k {
                    n += 1;
                }
            }
            Node::Abs(_, b) => stack.push((b, k + 1)),
            Node::App(f, a) => {
                stack.push((f, k));
                stack.push((a, k));
            }
        }
    }
    n
}

/// `Abs` nodes in `body` — one `shift(1, 0, s)` of the whole argument apiece, per `subst`'s `Abs` arm.
fn count_abs(body: &LambdaTerm) -> u64 {
    let mut stack = vec![body];
    let mut n = 0u64;
    while let Some(t) = stack.pop() {
        match t.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => {
                n += 1;
                stack.push(b);
            }
            Node::App(f, a) => {
                stack.push(f);
                stack.push(a);
            }
        }
    }
    n
}

fn account(trace: &Trace) -> Work {
    let mut w = Work::default();
    for s in &trace.steps {
        w.path_len += s.redex.len() as u64;
        w.term_size += size_of(&s.term);
        // The redex at `s.redex` is `(\. body) arg` by construction.
        let Some((redex, scan)) = redex_at(&s.term, &s.redex) else {
            w.malformed += 1;
            continue;
        };
        let Node::App(f, arg) = redex.node() else {
            w.malformed += 1;
            continue;
        };
        let Node::Abs(_, body) = f.node() else {
            w.malformed += 1;
            continue;
        };
        let arg_nodes = size_of(arg);
        let (occ, abs_nodes) = (count_occurrences(body, 0), count_abs(body));
        w.scan += scan;
        w.body_size += size_of(body);
        w.arg_size += arg_nodes;
        w.occ += occ;
        w.abs_count += abs_nodes;
        w.occ_times_arg += occ * arg_nodes;
        w.abs_times_arg += abs_nodes * arg_nodes;

        // The faithful half, measured by replaying `beta`'s three calls and counting what each one
        // actually allocates. It costs one real `subst` per step to do this — the reduct is needed to
        // price the closing shift, and there is no way to know its size without building it — which is
        // affordable on a 46-program corpus and is the price of an instrument that measures rather
        // than models. `beta` is `shift(-1, 0, &subst(0, &shift(1, 0, arg), body))`.
        w.opening += shift_allocs(0, arg);
        let opened = shift(1, 0, arg);
        let (spine, reshift) = subst_allocs(0, &opened, body);
        w.spine += spine;
        w.reshift += reshift;
        w.closing += shift_allocs(0, &subst(0, &opened, body));
        w.depth_guard += 1;
    }
    w
}

struct Row {
    idx: usize,
    steps: usize,
    replay_ms: f64,
    trace_nodes: u64,
    trace_distinct: u32,
    max_term_nodes: u64,
    max_term_distinct: u32,
    intern_ns_per_node: f64,
    interned: bool,
    /// Wall time of the BATCH `replay_ms` was divided out of. This is what says whether the number can
    /// be trusted, and it exists because `replay_ms` alone stopped saying so: after the 2026-08-01
    /// fixes a single replay of 44 of the 46 programs finishes below the timer's resolution.
    batch_ms: f64,
    work: Work,
}

/// A replay batch runs until it has taken at least this long, and `replay_ms` is the batch divided by
/// its repetition count. Below this the clock, not the counter, is the uncertain quantity.
const BATCH_MIN_MS: f64 = 50.0;

/// Ceiling on repetitions, so a program that replays in nanoseconds cannot spin for a whole
/// `BATCH_MIN_MS` worth of them. A row that hits it is reported with a short `batch ms` and is
/// excluded from the fits by the same test as any other under-timed row.
const BATCH_MAX_REPS: u32 = 20_000;

fn measure(idx: usize, src: &str) -> Option<Row> {
    let (prog, ds) = parse(src);
    if !ds.is_empty() {
        return None;
    }
    let core = desugar(&prog.unwrap());
    let term = lower(&core).ok()?;

    // Replay cost: best of three BATCHES, each batch repeated until it clears `BATCH_MIN_MS`.
    //
    // **THIS USED TO BE BEST-OF-THREE SINGLE REPLAYS, AND THE 2026-08-01 FIXES BROKE IT.** Nothing
    // about the corpus changed; it got three to four orders of magnitude faster, and an instrument that
    // samples each program once went from timing 14 rows usably to timing 2. Everything downstream
    // degraded with it — PART C.2 was left fitting two parameters to two points and returned a
    // NEGATIVE price per read-only node, and the projection table printed negative milliseconds. That
    // is what a measurement apparatus outliving its subject looks like from the inside, and the fix is
    // to measure a batch rather than to widen the tolerances until the numbers look plausible again.
    let (replay_ms, batch_ms) = batch_best_of_three(|| {
        let nf = drain_lambda_cursor(&term);
        std::hint::black_box(&nf);
    });

    let trace = reduce_trace(&term, MAX_REDUCTION_STEPS);
    let work = account(&trace);

    // Size first, intern second: a trace too large to hold an intern table for is reported, not run.
    let mut trace_nodes = 0u64;
    let mut max_term_nodes = 0u64;
    let mut max_term_idx = 0usize;
    for (i, s) in trace.steps.iter().enumerate() {
        let n = size_of(&s.term);
        trace_nodes += n;
        if n > max_term_nodes {
            max_term_nodes = n;
            max_term_idx = i;
        }
    }
    let nf_nodes = size_of(&trace.normal_form);
    trace_nodes += nf_nodes;

    if trace_nodes > MAX_INTERN_NODES {
        return Some(Row {
            idx,
            steps: trace.steps.len(),
            replay_ms,
            batch_ms,
            trace_nodes,
            trace_distinct: 0,
            max_term_nodes,
            max_term_distinct: 0,
            intern_ns_per_node: 0.0,
            interned: false,
            work,
        });
    }

    // ACROSS-TRACE: one interner over every step's term plus the normal form. Ceiling for sharing of
    // any kind; on its own it does NOT separate Rc from interning — what does is the residual after
    // Rc, which needs an allocation count this probe does not take (module doc).
    let mut across = Interner::default();
    let t0 = Instant::now();
    for s in &trace.steps {
        intern_term(&s.term, &mut across);
    }
    intern_term(&trace.normal_form, &mut across);
    let intern_secs = t0.elapsed().as_secs_f64();

    // WITHIN-TERM: a FRESH interner over the single largest term. This is the discriminating number —
    // structurally identical subterms built separately, which Rc cannot share and interning can.
    let mut within = Interner::default();
    let largest = if max_term_nodes >= nf_nodes { &trace.steps[max_term_idx].term } else { &trace.normal_form };
    let within_nodes = intern_term(largest, &mut within);

    Some(Row {
        idx,
        steps: trace.steps.len(),
        replay_ms,
        batch_ms,
        trace_nodes,
        trace_distinct: across.next,
        max_term_nodes: within_nodes,
        max_term_distinct: within.next,
        intern_ns_per_node: if trace_nodes == 0 { 0.0 } else { intern_secs * 1e9 / trace_nodes as f64 },
        interned: true,
        work,
    })
}

fn main() {
    // Big-stack thread, the idiom this crate uses wherever deep terms are built or torn down
    // (`lib.rs`'s `drop_tests`, `decode.rs`, `tm.rs`). A probe is not exempt from the reason.
    std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(run)
        .expect("spawn the probe thread")
        .join()
        .expect("the probe thread must not overflow its stack");
}

fn run() {
    verify_interner();
    println!(
        "subst differential: `crates/redextape-core/tests/subst_differential.rs` (shift-additivity \
         lemma, exhaustive differential of the SHIPPED `subst` against an eager and a lifted \
         reference, and the allocation-identity sharing pins) — run it with `cargo nextest run -p \
         redextape-core`. The lifted rewrite it used to propose was FALSIFIED 2026-08-02: 0.99x on the \
         nested-group family. PART B's `Σ abs×arg` below is the stale model that justified it.\n"
    );
    println!(
        "λ-term sharing probe — hash-consing dry run over FIRST_ORDER_DEMOS ({} programs)\n",
        FIRST_ORDER_DEMOS.len()
    );
    println!("PART A — SHARING: what interning would save.\n");
    println!(
        "{:>3}  {:>7}  {:>9}  {:>12}  {:>10}  {:>7}  {:>10}  {:>8}  {:>8}  {:>8}",
        "#", "steps", "replay ms", "trace nodes", "distinct", "share", "max term", "distinct", "share", "ns/node"
    );
    println!("{}", "-".repeat(104));

    let mut rows = Vec::new();
    let mut skipped = 0usize;
    for (i, src) in FIRST_ORDER_DEMOS.iter().enumerate() {
        match measure(i, src) {
            Some(r) => rows.push(r),
            None => skipped += 1,
        }
    }

    for r in &rows {
        if !r.interned {
            println!(
                "{:>3}  {:>7}  {:>9.1}  {:>12}  {:>10}  {:>7}  {:>10}  {:>8}  {:>8}  {:>8}",
                r.idx, r.steps, r.replay_ms, r.trace_nodes, "(skipped)", "-", r.max_term_nodes, "-", "-", "-"
            );
            continue;
        }
        let trace_share = r.trace_nodes as f64 / f64::from(r.trace_distinct.max(1));
        let within_share = r.max_term_nodes as f64 / f64::from(r.max_term_distinct.max(1));
        println!(
            "{:>3}  {:>7}  {:>9.1}  {:>12}  {:>10}  {:>6.1}x  {:>10}  {:>8}  {:>7.2}x  {:>8.1}",
            r.idx,
            r.steps,
            r.replay_ms,
            r.trace_nodes,
            r.trace_distinct,
            trace_share,
            r.max_term_nodes,
            r.max_term_distinct,
            within_share,
            r.intern_ns_per_node
        );
    }

    let interned: Vec<&Row> = rows.iter().filter(|r| r.interned).collect();
    let tot_nodes: u64 = interned.iter().map(|r| r.trace_nodes).sum();
    let tot_within: u64 = interned.iter().map(|r| r.max_term_nodes).sum();
    let tot_within_distinct: u64 = interned.iter().map(|r| u64::from(r.max_term_distinct)).sum();

    println!("\n{} programs measured, {} skipped (λ backend cannot lower them).", rows.len(), skipped);
    println!("Total trace nodes across the corpus: {tot_nodes}");
    println!(
        "Corpus within-term: {tot_within} nodes -> {tot_within_distinct} distinct  ({:.2}x)",
        tot_within as f64 / tot_within_distinct.max(1) as f64
    );
    // THE 10.3x/50.0x BELOW ARE DERIVED, NOT MEASURED HERE, and they are the third superseded claim
    // this legend has had to be corrected for. Each is one program's pinned distinct-allocation count
    // from `tests/lambda_sharing.rs` (`seen.len()`: 140,529 on row 9, 185,459 on row 7) divided by that
    // row's own `distinct` column in the table just printed (13,590 and 3,710). Both inputs are pinned
    // constants in a different file, so either can move without this text noticing — re-derive rather
    // than trusting these two numbers if the gate is ever re-pinned. Design §3 has the full arithmetic.
    println!("\nHOW TO READ THIS:");
    println!("  `share` after `distinct` (trace)  — CEILING for all sharing, but NO verdict on its own:");
    println!("                                      Rc takes an unmeasured share. Where it was counted");
    println!("                                      (rows 9, 7 via tests/lambda_sharing.rs) the residual");
    println!("                                      after Rc is 10.3x/50.0x: THAT argues for interning.");
    println!("                                      Those two are DERIVED from that file's pinned");
    println!("                                      seen.len() over this table's `distinct` — re-derive");
    println!("                                      them if either side is ever re-pinned.");
    println!("  `share` after `distinct` (max term) — THE DISCRIMINATING NUMBER. Structurally identical");
    println!("                                      subterms built separately: Rc cannot share these,");
    println!("                                      interning can. ~1.00x means interning adds nothing.");
    println!("  `ns/node`                          — interning's cost, against the ~35 ns/node the reducer");
    println!("                                      already pays to CONSTRUCT a node (PART C.2's fitted");
    println!("                                      allocating price, below). Both are whole-traversal");
    println!("                                      costs, so they compare directly: ~1.7x, not ~15x.");

    part_b(&rows);
    part_d(&rows);
}

/// Counters, in the order the table prints them. `f` reads one off a `Work`; `origin` says whether the
/// counter is one of the four the substitution-blowup hypothesis proposed (`yes`), one found by reading
/// `reduce.rs`/`term.rs` for a traversal the four do not bound (`NEW`), an aggregate over several of
/// them (`SPLIT`), or the total (`SUM`).
struct Counter {
    name: &'static str,
    origin: &'static str,
    f: fn(&Work) -> u64,
}

const COUNTERS: &[Counter] = &[
    Counter { name: "Σ path", origin: "yes", f: |w| w.path_len },
    Counter { name: "Σ scan", origin: "NEW", f: |w| w.scan },
    Counter { name: "Σ body", origin: "STALE", f: |w| w.body_size },
    Counter { name: "Σ arg", origin: "STALE", f: |w| w.arg_size },
    Counter { name: "Σ occ×arg", origin: "STALE", f: |w| w.occ_times_arg },
    Counter { name: "Σ abs×arg", origin: "STALE", f: |w| w.abs_times_arg },
    Counter { name: "Σ size", origin: "STALE", f: |w| w.term_size },
    Counter { name: "Σ opening", origin: "TRUE", f: |w| w.opening },
    Counter { name: "Σ spine", origin: "TRUE", f: |w| w.spine },
    Counter { name: "Σ reshift", origin: "TRUE", f: |w| w.reshift },
    Counter { name: "Σ closing", origin: "TRUE", f: |w| w.closing },
    Counter { name: "Σ guard", origin: "TRUE", f: |w| w.depth_guard },
    Counter { name: "Σ alloc", origin: "SPLIT", f: Work::alloc },
    Counter { name: "Σ read", origin: "SPLIT", f: Work::read },
    Counter { name: "Σ model", origin: "SUM", f: Work::model },
];

/// A row is timer-reliable when the BATCH its `replay ms` was divided out of ran at least this long.
///
/// **THE SUBJECT OF THIS CONSTANT CHANGED ON 2026-08-02 AND THE NUMBER DELIBERATELY DID NOT.** It used
/// to test `replay ms` itself, which was one replay: below a millisecond a single `Instant` reading
/// carries enough cache and scheduling noise that a 2x ratio means nothing. That test was correct and
/// it stopped selecting anything useful — after the 2026-08-01 fixes only 2 of 46 single replays
/// cleared it, and a two-parameter fit over two points is not a measurement. Batching moved the
/// uncertainty: `replay ms` is now a batch of `BATCH_MIN_MS`-or-`BATCH_MAX_REPS` divided by its
/// repetition count, so what has to clear a millisecond is the BATCH. Essentially every row does, which
/// is the repair — the corpus can price a node again.
///
/// EVERY STATISTIC IS STILL REPORTED OVER ALL 46 ROWS. This constant selects the subset the failure
/// test's BASELINE is taken from and the subset a row can be FLAGGED in — not the subset the table
/// shows.
const RELIABLE_MS: f64 = 1.0;

fn part_b(rows: &[Row]) {
    println!("\n\nPART B — COST: what replay actually spends, in nodes visited per trace.\n");
    println!(
        "TWO GENERATIONS OF COUNTER, PRINTED SIDE BY SIDE. The `model` block is the original static\n\
         accounting — products of node counts, written against a `subst` whose `Abs` arm copied\n\
         unconditionally and a `depth_exceeds` that walked the whole term. The `measured` block mirrors\n\
         the functions as they are, short-circuits included. The models were correct when written and\n\
         are kept as controls, because PART C's contest is more useful with a known-wrong entrant in it.\n"
    );
    println!(
        "{:>3}  {:>9} | {:>10}  {:>9}  {:>12}  {:>12}  {:>11} | {:>9}  {:>9}  {:>9}  {:>9}",
        "#",
        "replay ms",
        "Σ path",
        "model:arg",
        "model:occ×arg",
        "model:abs×arg",
        "model:size",
        "opening",
        "spine",
        "reshift",
        "closing"
    );
    println!("{}", "-".repeat(125));
    for r in rows {
        let w = &r.work;
        println!(
            "{:>3}  {:>9.3} | {:>10}  {:>9}  {:>12}  {:>12}  {:>11} | {:>9}  {:>9}  {:>9}  {:>9}",
            r.idx,
            r.replay_ms,
            w.path_len,
            w.arg_size,
            w.occ_times_arg,
            w.abs_times_arg,
            w.term_size,
            w.opening,
            w.spine,
            w.reshift,
            w.closing
        );
    }

    // The headline correction, stated as a ratio rather than left for the reader to divide.
    let m_abs: u64 = rows.iter().map(|r| r.work.abs_times_arg).sum();
    let t_reshift: u64 = rows.iter().map(|r| r.work.reshift).sum();
    let m_size: u64 = rows.iter().map(|r| r.work.term_size).sum();
    let t_guard: u64 = rows.iter().map(|r| r.work.depth_guard).sum();
    println!(
        "\nMODEL AGAINST MEASUREMENT, corpus-wide:\n  \
         `Σ abs×arg` {m_abs} vs `Σ reshift` {t_reshift} — over-counts by {:.0}x\n  \
         `Σ size`    {m_size} vs `Σ guard`   {t_guard} — over-counts by {:.0}x\n\
         The first is the `subst` re-shift the retired lifted-shift slice existed to delete; the second\n\
         is `depth_exceeds`, which reads a stored field and has walked nothing since 2026-08-01.",
        m_abs as f64 / t_reshift.max(1) as f64,
        m_size as f64 / t_guard.max(1) as f64,
    );
    let malformed: u64 = rows.iter().map(|r| r.work.malformed).sum();
    println!(
        "\n{}",
        if malformed == 0 {
            "Every step's redex had the shape `(\\. body) arg`; no step was skipped by the accounting.".to_string()
        } else {
            format!("{malformed} steps did NOT have the shape `(\\. body) arg` — the accounting below is incomplete.")
        }
    );

    // The two ratios the columns above encode as products. `Σ occ×arg` and `Σ arg` sitting on top of
    // each other in the table is not a coincidence to note in passing — it says the mean occurrence
    // count is ~1, i.e. there is no substitution blowup anywhere in this corpus.
    let steps: u64 = rows.iter().map(|r| r.steps as u64).sum();
    let occ: u64 = rows.iter().map(|r| r.work.occ).sum();
    let abs_count: u64 = rows.iter().map(|r| r.work.abs_count).sum();
    println!(
        "\nOver all {steps} β-steps in the corpus, `subst` replaced {occ} occurrences of the bound variable\n\
         ({:.2} per step). The body holds {abs_count} `Abs` nodes in total ({:.1} per step), a ratio of\n\
         {:.0}:1 — and THAT RATIO IS THE ONE THAT MISLED THE RECORD FOR A DAY. It counts `Abs` nodes in\n\
         the body, not binders `subst` descends through: since the `maxfree` short-circuit, `subst`\n\
         descends only along paths to an occurrence, and the re-shift it actually performs is {:.2} per\n\
         step. Paying that once per occurrence instead — the retired lifted-shift slice — is a 0.99x\n\
         REGRESSION on the nested-group family, because occurrences outnumber binders crossed. See\n\
         `examples/shift_cost_probe.rs`'s census section and the perf design's §10.",
        occ as f64 / steps as f64,
        abs_count as f64 / steps as f64,
        abs_count as f64 / occ.max(1) as f64,
        rows.iter().map(|r| r.work.reshift).sum::<u64>() as f64 / steps.max(1) as f64,
    );

    part_c(rows);
}

/// The verification the two rows that motivated this cannot supply. A counter whose ratio between
/// rows 31 and 7 happens to land near 6.6x is one coincidence; a counter that ORDERS all 46 rows the
/// way the clock does, and costs the same nanoseconds per unit on each of them, is an explanation.
///
/// Two tests, because they fail differently. Spearman ρ asks only whether the ORDER agrees, which is
/// robust to a wrong constant factor and blind to a wrong exponent. Nanoseconds-per-unit asks whether
/// the SAME unit price buys every row, which catches the wrong exponent and is what actually
/// distinguishes a cause from a correlate.
fn part_c(rows: &[Row]) {
    let ms: Vec<f64> = rows.iter().map(|r| r.replay_ms).collect();
    let reliable: Vec<usize> = (0..rows.len()).filter(|&i| rows[i].batch_ms >= RELIABLE_MS).collect();
    let unit_prices = |vals: &[f64], idx: &[usize]| -> (f64, f64) {
        median_and_spread(&idx.iter().map(|&i| ms[i] * 1e6 / vals[i].max(1.0)).collect::<Vec<_>>())
    };

    println!("\nPART C — VERIFICATION: does a counter EXPLAIN the time, or merely rank with it?\n");
    println!(
        "{:>11}  {:>5}  {:>8}  {:>8}  {:>13}  {:>11}  {:>11}",
        "counter",
        "hyp?",
        "ρ (46)",
        format!("ρ ({})", reliable.len()),
        "ns/unit m46",
        "spread (46)",
        format!("spread ({})", reliable.len())
    );
    println!("{}", "-".repeat(77));

    let all: Vec<usize> = (0..rows.len()).collect();
    let mut best: Option<(f64, &Counter)> = None;
    for c in COUNTERS {
        let vals: Vec<f64> = rows.iter().map(|r| (c.f)(&r.work) as f64).collect();
        let rho_rel = spearman(
            &reliable.iter().map(|&i| vals[i]).collect::<Vec<_>>(),
            &reliable.iter().map(|&i| ms[i]).collect::<Vec<_>>(),
        );
        let (med, spread_all) = unit_prices(&vals, &all);
        let (_, spread_rel) = unit_prices(&vals, &reliable);
        println!(
            "{:>11}  {:>5}  {:>8.3}  {:>8.3}  {:>13.2}  {:>10.1}x  {:>10.1}x",
            c.name,
            c.origin,
            spearman(&vals, &ms),
            rho_rel,
            med,
            spread_all,
            spread_rel
        );
        // `Σ model` is excluded from the contest it is the control for: it is the SUM of the others,
        // so it wins the spread test by construction and would say nothing about which traversal is
        // the expensive one. `Σ alloc`/`Σ read` are excluded for the same reason one level down — they
        // are aggregates of several counters, and the question here is which single traversal is
        // expensive, not which bucket.
        if !matches!(c.origin, "SUM" | "SPLIT") && best.is_none_or(|(s, _)| spread_rel < s) {
            best = Some((spread_rel, c));
        }
    }

    // Unwrap: `COUNTERS` holds seven non-aggregate entries, so the loop above always assigns.
    let (_, winner) = best.unwrap();
    println!(
        "\n`hyp?` — `yes` marks a counter the substitution-blowup hypothesis proposed, `STALE` one of the\n\
         static models written against the pre-2026-08-01 `subst`/`depth_exceeds` and kept as a control,\n\
         `TRUE` one that mirrors the function as it is, `SPLIT` the allocating/read-only partition of\n\
         the whole accounting, and `SUM` its total. **THE STALE ROWS ARE IN THIS CONTEST ON PURPOSE.**\n\
         A counter that no longer describes the code should lose it, and watching one do so on the same\n\
         corpus is worth more than a sentence asserting that it would. `spread` is\n\
         max/min of the ns-per-unit price: 1.0x is a counter that costs the same everywhere, and it is\n\
         the discriminating column — ρ stays high for any counter that merely grows with the program.\n\
         \n\
         `ns/unit m46` is the median price over ALL 46 rows. The `vs med` column further down divides\n\
         by the median over the {} timer-reliable rows instead; the two are different baselines and are\n\
         labelled apart because an earlier draft printed both as `median`.\n\
         \n\
         `Σ scan`'s spread is not a measurement. Scan is 0 on rows whose redex path never takes an\n\
         `AppR`, and `.max(1.0)` in the price divides by 1 there rather than by 0, so the printed max/min\n\
         is an artifact of that floor. What `Σ scan` actually says is its ρ: it does not track the clock.\n\
         \n\
         THE TWO ρ/spread COLUMNS ARE NOW IDENTICAL, AND THAT IS A RESULT RATHER THAN A REDUNDANCY.\n\
         They are `all 46 rows` against `the timer-reliable rows`, and {} of 46 rows are reliable — the\n\
         batched timing restored the resolution that a single replay lost when the reducer got three to\n\
         four orders of magnitude faster. Between 2026-08-01 and 2026-08-02 this read `(46)` and `(2)`,\n\
         and a two-parameter fit over two points is what produced a negative price per read-only node.\n\
         The columns are kept side by side so the day they diverge again is visible.",
        reliable.len(),
        reliable.len()
    );

    two_price(rows, &reliable, &ms, winner);

    // Per-row detail over ALL 46 rows, so "the rows it does not explain" are named rather than
    // summarized. Two columns, doing two jobs: `ns/node` prices `Σ model` and so tests whether the
    // accounting is COMPLETE; the share column tests whether `Σ abs×arg` DOMINATES it. Neither alone
    // is the finding — a complete model that no single traversal dominates would point at nothing to
    // fix, and a dominant counter inside an incomplete model could be dominating a mismeasurement.
    let model: Vec<f64> = rows.iter().map(|r| r.work.model() as f64).collect();
    let share: Vec<f64> = rows.iter().map(|r| (winner.f)(&r.work) as f64 / r.work.model().max(1) as f64).collect();
    let (med, _) = unit_prices(&model, &reliable);
    let mut order: Vec<usize> = all.clone();
    order.sort_by(|&a, &b| (ms[a] / model[a].max(1.0)).partial_cmp(&(ms[b] / model[b].max(1.0))).unwrap());

    println!(
        "\nDominant traversal: {}. Below, every row — not only the timeable ones — priced against the\n\
         COMPLETE accounting `Σ model`, with {}'s share of it alongside. `vs med` is against the\n\
         median over the {} rows above {RELIABLE_MS} ms, so no amount of timer noise on the other {} can\n\
         move the baseline the failure test is measured from. (The counter table's `ns/unit m46` column\n\
         is a DIFFERENT baseline — the median over all 46 — which is why the two are named apart.)\n",
        winner.name,
        winner.name,
        reliable.len(),
        rows.len() - reliable.len()
    );
    println!(
        "{:>3}  {:>9}  {:>12}  {:>10}  {:>9}  {:>12}",
        "#",
        "replay ms",
        "Σ model",
        "ns/node",
        "vs med",
        format!("{} %", winner.name)
    );
    println!("{}", "-".repeat(74));
    for &i in &order {
        let u = ms[i] * 1e6 / model[i].max(1.0);
        let rel = u / med;
        let flag = if rows[i].batch_ms < RELIABLE_MS {
            "  (timer-limited)"
        } else if !(0.5..=2.0).contains(&rel) {
            "  <-- NOT EXPLAINED"
        } else {
            ""
        };
        println!(
            "{:>3}  {:>9.3}  {:>12}  {:>10.2}  {:>8.2}x  {:>11.0}%{}",
            rows[i].idx,
            ms[i],
            rows[i].work.model(),
            u,
            rel,
            share[i] * 100.0,
            flag
        );
    }
    let failures: Vec<usize> =
        reliable.iter().copied().filter(|&i| !(0.5..=2.0).contains(&(ms[i] * 1e6 / model[i].max(1.0) / med))).collect();

    // THE SAME 2x CRITERION, APPLIED TO THE WINNER RATHER THAN TO THE CONTROL. The table above prices
    // `Σ model`, so its failure list answers "is the accounting complete?" — a different question from
    // "which rows does the identified counter fail to explain?", which is what the brief asked. A
    // counter that is 96% of the work on one row and 16% on another cannot price the same on both, and
    // naming the rows where it does not is the honest form of the dominance claim.
    let win_vals: Vec<f64> = rows.iter().map(|r| (winner.f)(&r.work) as f64).collect();
    let (win_med_rel, _) = unit_prices(&win_vals, &reliable);
    let (win_med46, _) = unit_prices(&win_vals, &all);
    let win_fail = |base: f64| -> Vec<usize> {
        let mut v: Vec<usize> = all
            .iter()
            .copied()
            .filter(|&i| !(0.5..=2.0).contains(&(ms[i] * 1e6 / win_vals[i].max(1.0) / base)))
            .collect();
        v.sort_unstable();
        v
    };
    let (fail_rel, fail46) = (win_fail(win_med_rel), win_fail(win_med46));
    let name_rows = |v: &[usize]| -> String {
        if v.is_empty() {
            "none".to_string()
        } else {
            v.iter().map(|&i| rows[i].idx.to_string()).collect::<Vec<_>>().join(", ")
        }
    };
    let only46: Vec<usize> = fail46.iter().copied().filter(|i| !fail_rel.contains(i)).collect();
    let timeable_fails: Vec<usize> = fail46.iter().copied().filter(|&i| rows[i].batch_ms >= RELIABLE_MS).collect();
    println!(
        "\nTHE SAME 2x TEST, APPLIED TO {} ITSELF rather than to the `Σ model` control. Against the {}-row\n\
         median it fails on rows: {}. Against the 46-row median, additionally: {}.\n\
         Of those, the ones at or above {RELIABLE_MS} ms — where the clock can be trusted — are: {}.\n\
         The rest are below the timer's resolution, so they are named because the brief asked which rows\n\
         the counter fails on, not because they weigh against it.",
        winner.name,
        reliable.len(),
        name_rows(&fail_rel),
        name_rows(&only46),
        name_rows(&timeable_fails)
    );
    let tot_model: u64 = rows.iter().map(|r| r.work.model()).sum();
    let tot_winner: u64 = rows.iter().map(|r| (winner.f)(&r.work)).sum();
    let tot_alloc: u64 = rows.iter().map(|r| r.work.alloc()).sum();
    println!(
        "\nA row FAILS the explanation when its ns/node is off the median by more than 2x either way.\n\
         Failing rows above {RELIABLE_MS} ms: {}.\n\
         Rows marked `(timer-limited)` are reported and not flagged: at those times the clock, not the\n\
         counter, is the uncertain quantity — and note they price at the same ns/node anyway, over a\n\
         corpus spanning {} to {} nodes of work.\n\
         \n\
         Corpus-wide, {} is {:.1}% of `Σ model` and {:.1}% of `Σ alloc`. NODE SHARES, NOT TIME SHARES —\n\
         converting one into the other needs a price per node, and PART C.2 above is where that price is\n\
         measured rather than assumed. Under either model this counter is the dominant cost: it is the\n\
         bulk of the accounting AND the bulk of the allocating bucket — which is {:.1}% of the nodes,\n\
         not a `half`, and at the prices PART C.2 fits it is very nearly all of the time.",
        if failures.is_empty() {
            format!("none — all {} are within 2x", reliable.len())
        } else {
            failures.iter().map(|&i| format!("#{}", rows[i].idx)).collect::<Vec<_>>().join(", ")
        },
        rows.iter().map(|r| r.work.model()).min().unwrap_or(0),
        rows.iter().map(|r| r.work.model()).max().unwrap_or(0),
        winner.name,
        100.0 * tot_winner as f64 / tot_model.max(1) as f64,
        100.0 * tot_winner as f64 / tot_alloc.max(1) as f64,
        100.0 * tot_alloc as f64 / tot_model.max(1) as f64,
    );

    // WHERE THE COST IS NOW, under BOTH price models rather than under whichever one flatters it.
    //
    // **THIS USED TO BE "WHAT THE FIX WOULD BUY", AND THERE IS NO FIX.** It projected `Σ abs×arg`
    // becoming `Σ occ×arg` — the argument shifted once per OCCURRENCE instead of once per BINDER — at
    // 7.0x flat and 18.0x allocating. Both were projections from a static counter, both were recorded as
    // falsifiable predictions, and on 2026-08-02 both were falsified together: the rewrite measures at
    // 2.16x on this corpus and 0.99x — a regression — on the nested-group family. What replaces the
    // projection is the same table without the counterfactual: where the allocations actually go.
    remaining(rows, &reliable, &ms);
}

/// Where the reducer's allocations actually go, priced under both models. Forward guidance for the next
/// plan, computed rather than inferred by hand from the node accounting.
///
/// **EVERY ROW HERE IS A MEASURED TRAVERSAL, NOT A MODELLED ONE**, which is the difference between this
/// and the projection it replaces. The two models still disagree about which traversal is largest, and
/// both columns are still printed for the reason PART C.2 exists: a read-only traversal that is most of
/// the remaining NODES is most of the remaining TIME only if a node costs the same to read as to
/// construct, and that was measured to be false.
fn remaining(rows: &[Row], reliable: &[usize], ms: &[f64]) {
    let a_v: Vec<f64> = rows.iter().map(|r| r.work.alloc() as f64).collect();
    let r_v: Vec<f64> = rows.iter().map(|r| r.work.read() as f64).collect();
    let m_v: Vec<f64> = rows.iter().map(|r| r.work.model() as f64).collect();
    let c_flat = ls_one(&m_v, ms, reliable);
    let (a_ns, r_ns) = ls_two(&a_v, &r_v, ms, reliable);

    let sum = |f: fn(&Work) -> u64| -> u64 { rows.iter().map(|r| f(&r.work)).sum() };
    let where_it_goes: [(&str, &str, u64, bool); 7] = [
        ("reduce_step's spine", "Σ path", sum(|w| w.path_len), true),
        ("beta's opening shift", "Σ opening", sum(|w| w.opening), true),
        ("subst's body rebuild", "Σ spine", sum(|w| w.spine), true),
        ("subst's per-binder shift", "Σ reshift", sum(|w| w.reshift), true),
        ("beta's closing shift", "Σ closing", sum(|w| w.closing), true),
        ("depth_exceeds", "Σ guard", sum(|w| w.depth_guard), false),
        ("redex search", "Σ scan", sum(|w| w.scan), false),
    ];
    let node_tot: u64 = where_it_goes.iter().map(|&(_, _, n, _)| n).sum();
    let time_tot: f64 = where_it_goes.iter().map(|&(_, _, n, al)| if al { a_ns } else { r_ns } * n as f64).sum();
    println!(
        "\nWHERE THE ALLOCATIONS ACTUALLY GO, and which traversal is the largest. `nodes %` is a share\n\
         of the work COUNTED IN NODES; `time % (flat)` assumes every node costs the same and is\n\
         therefore identical to it; `time % (2-price)` prices allocating and read-only nodes separately\n\
         at the rates fitted above.\n"
    );
    println!(
        "{:<26}{:<11}  {:>10}  {:>8}  {:>13}  {:>13}",
        "traversal", "counter", "nodes", "nodes %", "time % (flat)", "time % (2-pr)"
    );
    println!("{}", "-".repeat(88));
    for &(what, counter, n, allocating) in &where_it_goes {
        let t = if allocating { a_ns } else { r_ns } * n as f64;
        let pct = 100.0 * n as f64 / node_tot.max(1) as f64;
        println!(
            "{what:<26}{counter:<11}  {n:>10}  {pct:>7.1}%  {pct:>12.1}%  {:>12.1}%{}",
            100.0 * t / time_tot,
            if allocating { "" } else { "   (read-only)" }
        );
    }
    // THE RANKING IS DERIVED, NOT ASSERTED, and the reason is this file's own history: the sentence
    // that used to sit here named a winner by hand, and the hand-named winner was a static model that
    // had stopped describing the code. A ranking printed from the table below it cannot go stale
    // without the table going stale first.
    let mut ranked: Vec<&(&str, &str, u64, bool)> = where_it_goes.iter().collect();
    ranked.sort_by_key(|c| std::cmp::Reverse(c.2));
    let top = ranked
        .iter()
        .take(3)
        .map(|&&(what, counter, n, _)| format!("{counter} ({what}, {:.1}%)", 100.0 * n as f64 / node_tot.max(1) as f64))
        .collect::<Vec<_>>()
        .join(", ");
    let reshift = where_it_goes.iter().find(|c| c.1 == "Σ reshift").map_or(0, |c| c.2);
    println!(
        "\nTotal: {} nodes; {:.1} ms under the flat model, {:.1} ms under the two-price one, against a\n\
         corpus that replays in {:.1} ms. Read-only work is {:.1}% of the nodes and {:.1}% of the time.\n\
         \n\
         LARGEST THREE, ranked from the table above rather than named by hand: {top}.\n\
         \n\
         AND WHAT THAT DOES *NOT* SAY ABOUT THE RETIRED LIFTED-SHIFT SLICE. `Σ reshift` is the counter\n\
         that slice was about and it is {:.1}% of this corpus's allocations — NOT negligible here, and a\n\
         reader who came for the falsification should not leave thinking it was. The rewrite would\n\
         replace those {reshift} allocations with ~7,944, a real ~19% cut. Two things sink it anyway,\n\
         and both are about magnitude rather than direction: the absolute is ~1.5 ms across all 46\n\
         programs, and on the nested-group family — the one that actually stresses the reducer — the\n\
         same rewrite measures 0.99x, a REGRESSION, because there the binders `subst` descends through\n\
         are fewer than the occurrences it would pay at. A change that is +19% on programs finishing in\n\
         microseconds and -1% on the ones that do not is not worth its blast radius. The family numbers\n\
         are in `examples/shift_cost_probe.rs`'s census section, where `Σ opening` is also the only\n\
         counter that scales with the program: 20,725 to 190,666 across eleven levels.",
        node_tot,
        c_flat * node_tot as f64,
        time_tot,
        ms.iter().sum::<f64>(),
        100.0 * where_it_goes.iter().filter(|&&(_, _, _, al)| !al).map(|&(_, _, n, _)| n).sum::<u64>() as f64
            / node_tot.max(1) as f64,
        100.0 * where_it_goes.iter().filter(|&&(_, _, _, al)| !al).map(|&(_, _, n, _)| r_ns * n as f64).sum::<f64>()
            / time_tot,
        100.0 * reshift as f64 / node_tot.max(1) as f64,
    );
}

/// PART C.2 — IS A NODE ONE PRICE, OR TWO?
///
/// The counter table's `Σ model` band is evidence for a FLAT cost model: one price per node visited,
/// however it is visited. That is an assumption built into the control, not a result taken from it, and
/// it is testable — `Σ alloc` counts nodes the reducer CONSTRUCTS (an `Rc::new` plus the write that
/// fills it) and `Σ read` counts nodes it merely LOOKS AT (`depth_exceeds`, the redex search), and
/// there is no reason those should cost the same. This fits both prices by least squares over the
/// timer-reliable rows.
///
/// WHY THE DIAGNOSTICS ARE NOT OPTIONAL, and are printed whether or not they flatter the fit. Two free
/// parameters against 14 points fit well for uninteresting reasons, and both regressors grow with
/// program size, so they may be collinear enough that the split is arithmetic rather than physics.
/// Printed alongside the coefficients: the uncentered correlation of the two regressors (this is a
/// no-intercept fit, so uncentered is the right one), the variance-inflation factor it implies, and the
/// leave-one-out range of each coefficient. **A read-only price that changes sign when one row is
/// dropped has not measured a price**, and the conclusion has to be stated against that rather than
/// against the residual alone.
fn two_price(rows: &[Row], reliable: &[usize], ms: &[f64], winner: &Counter) {
    let a_v: Vec<f64> = rows.iter().map(|r| r.work.alloc() as f64).collect();
    let r_v: Vec<f64> = rows.iter().map(|r| r.work.read() as f64).collect();
    let m_v: Vec<f64> = rows.iter().map(|r| r.work.model() as f64).collect();

    let c_flat = ls_one(&m_v, ms, reliable);
    let (a_fit, r_fit) = ls_two(&a_v, &r_v, ms, reliable);

    println!("\n\nPART C.2 — IS A NODE ONE PRICE, OR TWO? Allocating traversals against read-only ones.\n");
    println!("{:>4}  {:>10}  {:>11}  {:>8}  {:>11}  {:>8}", "#", "replay ms", "flat pred", "err", "2-price", "err");
    println!("{}", "-".repeat(60));
    let (mut worst_flat, mut worst_two) = (0.0f64, 0.0f64);
    for &i in reliable {
        let (pf, pt) = (c_flat * m_v[i], a_fit * a_v[i] + r_fit * r_v[i]);
        let (ef, et) = (pf / ms[i] - 1.0, pt / ms[i] - 1.0);
        worst_flat = worst_flat.max(ef.abs());
        worst_two = worst_two.max(et.abs());
        println!(
            "{:>4}  {:>10.3}  {:>11.3}  {:>7.1}%  {:>11.3}  {:>7.1}%",
            rows[i].idx,
            ms[i],
            pf,
            ef * 100.0,
            pt,
            et * 100.0
        );
    }

    // Uncentered, because the fit has no intercept: the quantity that governs whether the 2x2 normal
    // system is well conditioned is the cosine between the two regressor VECTORS, not between their
    // deviations from a mean the model never estimates.
    let (mut saa, mut sar, mut srr) = (0.0, 0.0, 0.0);
    for &i in reliable {
        saa += a_v[i] * a_v[i];
        sar += a_v[i] * r_v[i];
        srr += r_v[i] * r_v[i];
    }
    let rho_u = if saa > 0.0 && srr > 0.0 { sar / (saa * srr).sqrt() } else { 1.0 };
    let vif = if rho_u.abs() < 1.0 { 1.0 / (1.0 - rho_u * rho_u) } else { f64::INFINITY };

    let (mut a_lo, mut a_hi, mut r_lo, mut r_hi) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for &drop in reliable {
        let sub: Vec<usize> = reliable.iter().copied().filter(|&i| i != drop).collect();
        let (a, r) = ls_two(&a_v, &r_v, ms, &sub);
        a_lo = a_lo.min(a);
        a_hi = a_hi.max(a);
        r_lo = r_lo.min(r);
        r_hi = r_hi.max(r);
    }

    // The structural signal the two-price model predicts and the flat one does not: if allocating and
    // read-only nodes cost differently, then a row's ns-per-`Σ model`-node must move with how much of
    // that row's work is the allocating kind. Under a flat model this correlation is 0.
    let all: Vec<usize> = (0..rows.len()).collect();
    let share: Vec<f64> = rows.iter().map(|r| (winner.f)(&r.work) as f64 / r.work.model().max(1) as f64).collect();
    let price: Vec<f64> = (0..rows.len()).map(|i| ms[i] * 1e6 / m_v[i].max(1.0)).collect();
    let pick = |v: &[f64], idx: &[usize]| -> Vec<f64> { idx.iter().map(|&i| v[i]).collect() };

    let collinear = if vif > 10.0 {
        "SEVERELY collinear — treat the split as arithmetic as much as physics"
    } else if vif > 5.0 {
        "substantially collinear"
    } else {
        "not badly collinear"
    };
    println!(
        "\nfit over the {} timer-reliable rows, no intercept:\n\
         \x20 flat       ms = c·Σ model              c = {:>7.2} ns/node    worst row off by {:>5.1}%\n\
         \x20 two-price  ms = a·Σ alloc + r·Σ read   a = {:>7.2} ns/node    worst row off by {:>5.1}%\n\
         \x20                                        r = {:>7.2} ns/node\n\
         \n\
         DIAGNOSTICS — two parameters on {} points is easy to overfit, so these decide it, not the residual:\n\
         \x20 uncentered corr(Σ alloc, Σ read) = {:.4}, VIF {:.1} — {}\n\
         \x20 leave-one-out range of a: {:.2} to {:.2} ns/node  ({:.1}x)\n\
         \x20 leave-one-out range of r: {:.2} to {:.2} ns/node\n\
         \x20 corr({} share, ns per Σ model node) = {:.3} over the {} reliable rows, {:.3} over all {}\n\
         \x20   — a flat model predicts 0 here; a two-price model predicts it positive.",
        reliable.len(),
        c_flat * 1e6,
        worst_flat * 100.0,
        a_fit * 1e6,
        worst_two * 100.0,
        r_fit * 1e6,
        reliable.len(),
        rho_u,
        vif,
        collinear,
        a_lo * 1e6,
        a_hi * 1e6,
        if a_lo > 0.0 { a_hi / a_lo } else { f64::INFINITY },
        r_lo * 1e6,
        r_hi * 1e6,
        winner.name,
        pearson(&pick(&share, reliable), &pick(&price, reliable)),
        reliable.len(),
        pearson(&pick(&share, &all), &pick(&price, &all)),
        rows.len(),
    );

    // TODAY'S SPLIT AT THE FITTED PRICES — the sentence §7 needs and the one it is easiest to get
    // wrong, so it is printed rather than left to be derived from the node table by hand.
    let (n_alloc, n_read): (u64, u64) =
        rows.iter().fold((0, 0), |(a, r), row| (a + row.work.alloc(), r + row.work.read()));
    let n_size: u64 = rows.iter().map(|r| r.work.term_size).sum();
    let t_all = a_fit * n_alloc as f64 + r_fit * n_read as f64;
    println!(
        "\nTHE CORPUS AS IT STANDS, priced at the fit above rather than by node count:\n\
         \x20 read-only     {:>10} nodes  = {:>5.1}% of nodes  but {:>5.2}% of time\n\
         \x20 of which Σ size (`depth_exceeds`) {:>5.1}% of nodes  but {:>5.2}% of time\n\
         \x20 allocating    {:>10} nodes  = {:>5.1}% of nodes  and {:>5.2}% of time",
        n_read,
        100.0 * n_read as f64 / (n_alloc + n_read).max(1) as f64,
        100.0 * r_fit * n_read as f64 / t_all,
        100.0 * n_size as f64 / (n_alloc + n_read).max(1) as f64,
        100.0 * r_fit * n_size as f64 / t_all,
        n_alloc,
        100.0 * n_alloc as f64 / (n_alloc + n_read).max(1) as f64,
        100.0 * a_fit * n_alloc as f64 / t_all,
    );

    let read_verdict = if r_fit < 0.0 {
        "`r` fits NEGATIVE. That is not a price. Read it as 'read-only work is too cheap for this corpus\n\
         to separate from noise', never as 'reading a node saves time'."
    } else if r_fit * 5.0 < a_fit {
        "`r` fits at under a fifth of `a`: on this corpus a node that is only read costs much less than a\n\
         node that is constructed."
    } else {
        "`r` and `a` fit within a factor of five of each other, so the flat model's single price is not\n\
         badly wrong and the extra parameter buys little."
    };
    println!(
        "\n{read_verdict}\n\
         \n\
         WHAT THIS CHANGES DOWNSTREAM, which is why it is measured rather than assumed. If `r` is near\n\
         zero, a NODE share of a read-only counter is NOT a TIME share of it: `Σ size` can be a large\n\
         fraction of `Σ model` and still be a negligible fraction of the clock. Any claim that\n\
         `depth_exceeds` is 'the largest remaining cost' after the substitution fix is a claim about\n\
         TIME and must be derived under the price that fits, not read off the node accounting.\n\
         \n\
         AN UNSTABLE `r` IS EXPECTED AND DOES NOT SEND YOU BACK TO THE FLAT MODEL. It is the corpus\n\
         failing to price a nearly-free node, not the split failing, and since 2026-08-02 there is less\n\
         read-only work than ever to price: `depth_exceeds` reads a stored field, so `Σ read` is now\n\
         essentially `Σ scan` alone. What the conclusions depend on is `a`, which the leave-one-out\n\
         range above shows is stable to within a few percent — and note what changed to make that true.\n\
         Until the timing was batched, this fit ran over TWO rows, `a`'s leave-one-out range printed as\n\
         `0.00 to 0.00 (infx)` because dropping either row left one point, and `r` came out at -77\n\
         ns/node. A degenerate fit is not a small-sample fit; it is not a fit. See the design's §10."
    );
}

/// Least-squares slope through the origin: the `c` minimizing `Σ (y - c·x)²` over `idx`.
fn ls_one(x: &[f64], y: &[f64], idx: &[usize]) -> f64 {
    let (mut sxx, mut sxy) = (0.0, 0.0);
    for &i in idx {
        sxx += x[i] * x[i];
        sxy += x[i] * y[i];
    }
    if sxx == 0.0 { 0.0 } else { sxy / sxx }
}

/// Least-squares fit of `y ≈ a·p + b·q` with no intercept, over `idx`. Returns `(a, b)`.
///
/// Solved from the 2x2 normal equations directly rather than through a matrix library: this crate takes
/// no dependencies, and a 2x2 solve is four lines. A singular system — one regressor identically zero,
/// or the two exactly proportional — returns `(0, 0)` rather than a NaN, and the caller's collinearity
/// diagnostic is what makes that visible instead of silently plausible.
fn ls_two(p: &[f64], q: &[f64], y: &[f64], idx: &[usize]) -> (f64, f64) {
    let (mut spp, mut spq, mut sqq, mut spy, mut sqy) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for &i in idx {
        spp += p[i] * p[i];
        spq += p[i] * q[i];
        sqq += q[i] * q[i];
        spy += p[i] * y[i];
        sqy += q[i] * y[i];
    }
    let det = spp * sqq - spq * spq;
    if det == 0.0 {
        return (0.0, 0.0);
    }
    ((spy * sqq - sqy * spq) / det, (spp * sqy - spq * spy) / det)
}

/// Median and max/min of a sample. `spread` is `f64::INFINITY` for an empty sample rather than a
/// panic; a counter that is zero everywhere is `1.0` (`max(1.0)` at the call sites keeps the ratio
/// finite), which reads as "explains nothing" exactly as it should.
fn median_and_spread(v: &[f64]) -> (f64, f64) {
    if v.is_empty() {
        return (0.0, f64::INFINITY);
    }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let med = if s.len().is_multiple_of(2) { (s[s.len() / 2 - 1] + s[s.len() / 2]) / 2.0 } else { s[s.len() / 2] };
    let lo = s[0];
    (med, if lo > 0.0 { s[s.len() - 1] / lo } else { f64::INFINITY })
}

/// Spearman rank correlation. Ties take the average rank, so the 32 sub-millisecond rows — which sit
/// on top of each other once the timer's resolution is accounted for — cannot inflate it.
fn spearman(xs: &[f64], ys: &[f64]) -> f64 {
    pearson(&ranks(xs), &ranks(ys))
}

fn ranks(v: &[f64]) -> Vec<f64> {
    let mut order: Vec<usize> = (0..v.len()).collect();
    order.sort_by(|&a, &b| v[a].partial_cmp(&v[b]).unwrap());
    let mut out = vec![0.0; v.len()];
    let mut i = 0;
    while i < order.len() {
        let mut j = i;
        while j + 1 < order.len() && v[order[j + 1]] == v[order[i]] {
            j += 1;
        }
        let avg = (i + j) as f64 / 2.0 + 1.0;
        for &k in &order[i..=j] {
            out[k] = avg;
        }
        i = j + 1;
    }
    out
}

fn pearson(a: &[f64], b: &[f64]) -> f64 {
    if a.is_empty() {
        return 0.0;
    }
    let n = a.len() as f64;
    let (ma, mb) = (a.iter().sum::<f64>() / n, b.iter().sum::<f64>() / n);
    let mut num = 0.0;
    let (mut va, mut vb) = (0.0, 0.0);
    for (x, y) in a.iter().zip(b) {
        num += (x - ma) * (y - mb);
        va += (x - ma) * (x - ma);
        vb += (y - mb) * (y - mb);
    }
    if va == 0.0 || vb == 0.0 { 0.0 } else { num / (va * vb).sqrt() }
}

/// INDEPENDENT CHECK ON THE INTERNER, because the table's headline claim (a 9,763-node term holding
/// ~150 distinct subterms) is load-bearing for a design decision and a silently wrong interner would
/// produce exactly that shape. Two checks, deliberately different in kind:
///
///   1. A hand-built term whose distinct count is countable by eye.
///   2. An O(n²) recount of the same subterms using `LambdaTerm`'s OWN `PartialEq` — no hashing, no
///      ids, no shared code with `intern_term` beyond the traversal. Run only on small terms, since
///      it is quadratic.
///
/// If these disagree the table is void, so this runs before it and aborts rather than warning.
fn collect_subterms<'a>(t: &'a LambdaTerm, out: &mut Vec<&'a LambdaTerm>) {
    let mut stack = vec![t];
    while let Some(n) = stack.pop() {
        out.push(n);
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

/// Distinct-subterm count by pairwise `PartialEq`. Quadratic; small terms only.
///
/// `contains` rather than a hand-written `any`: it routes through the SAME `LambdaTerm: PartialEq`
/// either way, which is the whole point of this recount — no hashing, no ids, nothing shared with
/// `intern_term` but the traversal.
fn distinct_by_eq(t: &LambdaTerm) -> usize {
    let mut all = Vec::new();
    collect_subterms(t, &mut all);
    let mut uniq: Vec<&LambdaTerm> = Vec::new();
    for s in all {
        if !uniq.contains(&s) {
            uniq.push(s);
        }
    }
    uniq.len()
}

fn verify_interner() {
    // (\x. x) (\x. x): 5 nodes — App, two Abs, two Var — but only 3 DISTINCT: Var(0), Abs(Var 0), App.
    let id = abs("x", var(0));
    let t = app(id.clone(), id.clone());
    let mut iv = Interner::default();
    let n = intern_term(&t, &mut iv);
    assert_eq!(n, 5, "hand-built term should have 5 nodes");
    assert_eq!(iv.next, 3, "hand-built term should have 3 distinct subterms");
    assert_eq!(distinct_by_eq(&t), 3, "the PartialEq recount must agree");

    // Name hints must NOT split a class: `\x. x` and `\y. y` are equal under `LambdaTerm: PartialEq`.
    let t2 = app(abs("x", var(0)), abs("y", var(0)));
    let mut iv2 = Interner::default();
    intern_term(&t2, &mut iv2);
    assert_eq!(iv2.next, 3, "name hints must be ignored, matching PartialEq");

    // Distinct subterms must NOT collapse when they differ: \x. x  vs  \x. \y. x
    let t3 = app(abs("x", var(0)), abs("x", abs("y", var(1))));
    let mut iv3 = Interner::default();
    intern_term(&t3, &mut iv3);
    assert_eq!(iv3.next as usize, distinct_by_eq(&t3), "non-vacuous: differing subterms stay distinct");
    assert!(iv3.next > 3, "these two abstractions are NOT equal, so the count must exceed the id case");

    // Now the real thing: recount real reduction terms with PartialEq and require exact agreement.
    let mut checked = 0usize;
    for src in FIRST_ORDER_DEMOS {
        let (prog, ds) = parse(src);
        if !ds.is_empty() {
            continue;
        }
        let Ok(term) = lower(&desugar(&prog.unwrap())) else { continue };
        let trace = reduce_trace(&term, MAX_REDUCTION_STEPS);
        // The LARGEST term under the quadratic budget, so the check bites on real reduction shapes
        // rather than only on trivial ones.
        let Some(big) = trace.steps.iter().map(|s| &s.term).filter(|t| size_of(t) <= 1200).max_by_key(|t| size_of(t))
        else {
            continue;
        };
        let mut iv = Interner::default();
        intern_term(big, &mut iv);
        let by_eq = distinct_by_eq(big);
        assert_eq!(iv.next as usize, by_eq, "interner disagrees with PartialEq on a real term: {src}");
        checked += 1;
    }
    println!("interner verified: 4 hand-built cases + {checked} real reduction terms recounted by PartialEq");
}

// ==================================================================================================
// THE PROPOSED `subst` REWRITE'S VALIDATION MOVED OUT OF THIS FILE.
//
// It used to live here — `subst_lifted`/`subst_at` (the candidate rewrite §10 records), an exhaustive
// differential against `subst` in `src/`, the shift-additivity lemma the rewrite depends on, and a
// `lift == 0` allocation-identity pin — and it ran on every MANUAL `cargo run --example
// lambda_sharing_probe`. That turned out to be weaker evidence than it sounds: CI compiles this
// example (`.forgejo/workflows/ci.yml:112`, `cargo clippy --workspace --all-targets`) but never RUNS
// it, so the check that makes the rewrite safe to act on gated nothing automatically.
//
// It now lives in `crates/redextape-core/tests/subst_differential.rs` as three `#[test]`s,
// which `cargo nextest run -p redextape-core` executes on every CI run. It is not duplicated here: two
// copies of an equivalence argument is exactly the kind of drift this branch spent its effort removing.
//
// **AND ITS SUBJECT INVERTED ON 2026-08-02.** The candidate rewrite was falsified on cost — 0.99x on
// the nested-group family, against a `Σ abs×arg` that over-reports by ~1,584x — so `subst_lifted` is
// no longer a proposal. It and a new eager `subst_naive` are now REFERENCES, and the shipped `subst` is
// the subject: the same 355,840 triples, checked against two independent implementations instead of
// one. See that file's module doc, and the design's §8/§10.
// ==================================================================================================

/// Time one closure, batched: repeat until the batch clears `BATCH_MIN_MS`, divide by the repetition
/// count, take the best of three. Used by both `measure` (the corpus replay cost) and PART D (the A/B
/// timing), so the two are directly comparable — one batching implementation rather than two copies
/// held together by a comment, which is the drift pattern this tree has fought before.
///
/// Returns `(per_rep_ms, batch_ms)`: the per-repetition time (what callers usually want) alongside the
/// raw wall time of the batch that produced the winning per-rep figure — `measure` needs both, to also
/// report whether that batch cleared `BATCH_MIN_MS`.
fn batch_best_of_three(mut run_once: impl FnMut()) -> (f64, f64) {
    let mut best_per_rep = f64::MAX;
    let mut best_batch_ms = 0.0f64;
    for _ in 0..3 {
        let mut reps = 0u32;
        let t0 = Instant::now();
        let dt = loop {
            run_once();
            reps += 1;
            let dt = t0.elapsed().as_secs_f64() * 1000.0;
            if dt >= BATCH_MIN_MS || reps >= BATCH_MAX_REPS {
                break dt;
            }
        };
        let per_rep = dt / f64::from(reps);
        if per_rep < best_per_rep {
            best_per_rep = per_rep;
            best_batch_ms = dt;
        }
    }
    (best_per_rep, best_batch_ms)
}

/// PART D — the reduction-context zipper, measured against the cursor it would replace.
///
/// **LAZY CONSUMER ONLY, and that is not a convenience.** `reduce_trace` materialises `term()` every
/// step BY CONTRACT, so the spine is rebuilt per step whatever the reducer does internally and its
/// ceiling is exactly zero. Measuring it would produce a number that says nothing about the zipper.
/// What is timed here is `reduce_to_normal_form`'s shape: drain the cursor, read the term once at the
/// end — the same shape the UI's `LambdaCursor` path has.
///
/// `Σ path` is the ceiling: the spine rebuild the zipper does not perform. `climbs` is what it pays
/// back — `advance` rebuilding a parent per level climbed past an exhausted subtree, the one place
/// zipper navigation allocates. The design's ceiling is `Σ path − climbs`, and until this table existed
/// nobody had the second term.
fn part_d(rows: &[Row]) {
    println!("\n\nPART D — ZIPPER A/B: what carrying the reduction context actually recovers.\n");
    println!(
        "Lazy consumer only. `reduce_trace` materialises `term()` per step BY CONTRACT, so its ceiling\n\
         is exactly zero and it is not measured here — see the design's §2.\n\
         `Σ path` is the ceiling (spine rebuilds avoided); `climbs` is what `advance` pays back.\n"
    );
    println!(
        "{:>3}  {:>10}  {:>10}  {:>9}  {:>10}  {:>9}  {:>9}",
        "#", "today ms", "zipper ms", "speedup", "Σ path", "climbs", "net"
    );
    println!("{}", "-".repeat(70));

    let (mut t_today, mut t_zip, mut t_path, mut t_climb) = (0.0f64, 0.0f64, 0u64, 0u64);
    for r in rows {
        let Some(term) = term_of_demo(r.idx) else { continue };

        let (today, _) = batch_best_of_three(|| {
            let nf = drain_lambda_cursor(&term);
            std::hint::black_box(&nf);
        });
        let (zip, _) = batch_best_of_three(|| {
            let mut z = ZipperCursor::new(&term, MAX_REDUCTION_STEPS);
            while z.next().is_some() {}
            std::hint::black_box(z.term());
        });

        // One un-timed run purely to read the climb counter.
        let mut counted = ZipperCursor::new(&term, MAX_REDUCTION_STEPS);
        while counted.next().is_some() {}
        let climbs = counted.climbs();

        let path = r.work.path_len;
        let net = path as i64 - climbs as i64;
        t_today += today;
        t_zip += zip;
        t_path += path;
        t_climb += climbs;
        println!(
            "{:>3}  {:>10.3}  {:>10.3}  {:>8.2}x  {:>10}  {:>9}  {:>9}",
            r.idx,
            today,
            zip,
            today / zip.max(f64::MIN_POSITIVE),
            path,
            climbs,
            net
        );
    }

    let net = t_path as i64 - t_climb as i64;
    println!(
        "\nCORPUS TOTAL: today {t_today:.3} ms, zipper {t_zip:.3} ms — {:.2}x.\n\
         Ceiling `Σ path` = {t_path}; `climbs` = {t_climb}; net node saving = {net} \
         ({:.1}% of the ceiling).\n\
         \n\
         READ THE NET COLUMN, NOT THE CEILING. The design projected the zipper would recover `Σ path`\n\
         in full and was corrected mid-slice when the climb turned out to allocate; this is the number\n\
         that correction was waiting for. A net far below the ceiling means the climb is the cost, which\n\
         is exactly where the plan said to look first.",
        t_today / t_zip.max(f64::MIN_POSITIVE),
        100.0 * net as f64 / t_path.max(1) as f64,
    );
}

/// Re-lower one corpus program by index. PART A/B keep only counts per row, not the terms.
fn term_of_demo(idx: usize) -> Option<LambdaTerm> {
    let (prog, ds) = parse(FIRST_ORDER_DEMOS.get(idx)?);
    if !ds.is_empty() {
        return None;
    }
    lower(&desugar(&prog?)).ok()
}

/// Drain `LambdaCursor` to normal form and read the term once — what `reduce_to_normal_form` did
/// before it was wired to `ZipperCursor`.
///
/// **THE PROBE MUST NAME ITS CURSOR EXPLICITLY, and this helper is why.** PART B's counters and PART
/// C's fitted prices describe `LambdaCursor`'s traversals. If the baseline kept calling
/// `reduce_to_normal_form`, the moment that function switched cursors every timing here would silently
/// become the zipper's while every counter still described the old reducer — a model describing one
/// thing and a clock measuring another, which is precisely the failure this file was repaired for on
/// 2026-08-02. PART D would also have compared the zipper against itself.
fn drain_lambda_cursor(term: &LambdaTerm) -> LambdaTerm {
    let mut c = LambdaCursor::new(term, MAX_REDUCTION_STEPS);
    while c.next().is_some() {}
    c.term().clone()
}
