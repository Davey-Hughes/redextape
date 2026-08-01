//! λ-term sharing probe — a hash-consing DRY RUN, measured before anything is implemented.
//!
//!     cargo run --release --example lambda_sharing_probe -p redextape-core
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
use redextape_core::lambda::term::{Dir, Node, abs, app, var};
use redextape_core::lambda::{LambdaTerm, MAX_REDUCTION_STEPS, Trace, lower, reduce_to_normal_form, reduce_trace};
use redextape_core::parser::parse;

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

/// Per-step work accounting, summed over a whole trace. Units: nodes visited.
#[derive(Default)]
struct Work {
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
    /// The traversals that CONSTRUCT a node. Every node counted here is an `Rc::new` plus the write
    /// that fills it: `subst` rebuilds the body it walks, `shift` rebuilds every node it walks (both
    /// of `beta`'s, plus the per-binder re-shift of the argument), and the spine rebuild allocates one
    /// node per path element.
    ///
    /// The last term is `shift(-1, 0, …)` walking the reduct that `subst` just built: `subst` replaced
    /// `occ` variable nodes by `occ` copies of the argument, so the reduct is `body - occ + occ×arg`.
    fn alloc(&self) -> u64 {
        self.path_len
            + self.arg_size
            + self.body_size
            + self.abs_times_arg
            + (self.body_size.saturating_sub(self.occ) + self.occ_times_arg)
    }

    /// The traversals that only READ. `depth_exceeds` walks the whole term every step and returns a
    /// bool; `reduce_step`'s search walks rejected left siblings and returns a path. Neither writes a
    /// node. Split out from `alloc` above because assuming the two cost the same is a MODEL, and PART
    /// C fits both prices rather than asserting one.
    fn read(&self) -> u64 {
        self.term_size + self.scan
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
    work: Work,
}

fn measure(idx: usize, src: &str) -> Option<Row> {
    let (prog, ds) = parse(src);
    if !ds.is_empty() {
        return None;
    }
    let core = desugar(&prog.unwrap());
    let term = lower(&core).ok()?;

    // Replay cost, best of three — the same convention the Plan 4 design's tables were taken under.
    let mut replay_ms = f64::MAX;
    for _ in 0..3 {
        let t0 = Instant::now();
        let (nf, _status) = reduce_to_normal_form(&term, MAX_REDUCTION_STEPS);
        let dt = t0.elapsed().as_secs_f64() * 1000.0;
        std::hint::black_box(&nf);
        replay_ms = replay_ms.min(dt);
    }

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
        "subst rewrite check: moved to `crates/redextape-core/tests/subst_rewrite_equivalence.rs` \
         (shift-additivity lemma, exhaustive differential vs `term.rs`'s subst, and the lift==0 \
         allocation-identity pin) — run it with `cargo nextest run -p redextape-core`.\n"
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
    Counter { name: "Σ body", origin: "yes", f: |w| w.body_size },
    Counter { name: "Σ arg", origin: "NEW", f: |w| w.arg_size },
    Counter { name: "Σ occ×arg", origin: "yes", f: |w| w.occ_times_arg },
    Counter { name: "Σ abs×arg", origin: "NEW", f: |w| w.abs_times_arg },
    Counter { name: "Σ size", origin: "yes", f: |w| w.term_size },
    Counter { name: "Σ alloc", origin: "SPLIT", f: Work::alloc },
    Counter { name: "Σ read", origin: "SPLIT", f: Work::read },
    Counter { name: "Σ model", origin: "SUM", f: Work::model },
];

/// Below this many milliseconds a best-of-three `Instant` measurement carries enough cache and
/// scheduling noise that a 2x ratio means nothing; 32 of the 46 rows land there, and PART A prints
/// most of them as `0.0` or `0.1`.
///
/// EVERY STATISTIC IS STILL REPORTED OVER ALL 46 ROWS. This constant selects the subset the failure
/// test's BASELINE is taken from and the subset a row can be FLAGGED in — not the subset the table
/// shows. Answering "which programs does this explain" about 14 of them would be answering a
/// different question, and the sub-millisecond rows turn out to price at the same ns/node anyway,
/// which is itself evidence and would have been discarded by filtering them out.
const RELIABLE_MS: f64 = 1.0;

fn part_b(rows: &[Row]) {
    println!("\n\nPART B — COST: what replay actually spends, in nodes visited per trace.\n");
    println!(
        "{:>3}  {:>9}  {:>10}  {:>11}  {:>10}  {:>9}  {:>12}  {:>12}  {:>11}",
        "#", "replay ms", "Σ path", "Σ scan", "Σ body", "Σ arg", "Σ occ×arg", "Σ abs×arg", "Σ size"
    );
    println!("{}", "-".repeat(103));
    for r in rows {
        let w = &r.work;
        println!(
            "{:>3}  {:>9.3}  {:>10}  {:>11}  {:>10}  {:>9}  {:>12}  {:>12}  {:>11}",
            r.idx,
            r.replay_ms,
            w.path_len,
            w.scan,
            w.body_size,
            w.arg_size,
            w.occ_times_arg,
            w.abs_times_arg,
            w.term_size
        );
    }
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
         ({:.2} per step) and re-shifted the argument {abs_count} times ({:.1} per step), once per `Abs` node\n\
         in the body. It therefore built {:.0}x as many copies of each argument as the step had uses for it.",
        occ as f64 / steps as f64,
        abs_count as f64 / steps as f64,
        abs_count as f64 / occ.max(1) as f64
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
    let reliable: Vec<usize> = (0..rows.len()).filter(|&i| ms[i] >= RELIABLE_MS).collect();
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
        "\n`hyp?` — `yes` marks the four counters the substitution-blowup hypothesis proposed, `NEW` the\n\
         three found by reading `reduce.rs`/`term.rs` for traversals the four do not bound, `SPLIT` the\n\
         allocating/read-only partition of the whole accounting, and `SUM` its total. `spread` is\n\
         max/min of the ns-per-unit price: 1.0x is a counter that costs the same everywhere, and it is\n\
         the discriminating column — ρ stays high for any counter that merely grows with the program.\n\
         \n\
         `ns/unit m46` is the median price over ALL 46 rows. The `vs med14` column further down divides\n\
         by the median over the {} timer-reliable rows instead; the two are different baselines and are\n\
         labelled apart because an earlier draft printed both as `median`.\n\
         \n\
         `Σ scan`'s spread is not a measurement. Scan is 0 on rows whose redex path never takes an\n\
         `AppR`, and `.max(1.0)` in the price divides by 1 there rather than by 0, so the printed max/min\n\
         is an artifact of that floor. What `Σ scan` actually says is its ρ: it does not track the clock.\n\
         \n\
         The `(46)` and `({})` columns differ because below {RELIABLE_MS} ms a best-of-three `Instant`\n\
         measurement is at its resolution. Both are printed rather than only the flattering one.",
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
         COMPLETE accounting `Σ model`, with {}'s share of it alongside. `vs med14` is against the\n\
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
        "vs med14",
        format!("{} %", winner.name)
    );
    println!("{}", "-".repeat(74));
    for &i in &order {
        let u = ms[i] * 1e6 / model[i].max(1.0);
        let rel = u / med;
        let flag = if ms[i] < RELIABLE_MS {
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
    let (win_med14, _) = unit_prices(&win_vals, &reliable);
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
    let (fail14, fail46) = (win_fail(win_med14), win_fail(win_med46));
    let name_rows = |v: &[usize]| -> String {
        if v.is_empty() {
            "none".to_string()
        } else {
            v.iter().map(|&i| rows[i].idx.to_string()).collect::<Vec<_>>().join(", ")
        }
    };
    let only46: Vec<usize> = fail46.iter().copied().filter(|i| !fail14.contains(i)).collect();
    let timeable_fails: Vec<usize> = fail46.iter().copied().filter(|&i| ms[i] >= RELIABLE_MS).collect();
    println!(
        "\nTHE SAME 2x TEST, APPLIED TO {} ITSELF rather than to the `Σ model` control. Against the {}-row\n\
         median it fails on rows: {}. Against the 46-row median, additionally: {}.\n\
         Of those, the ones at or above {RELIABLE_MS} ms — where the clock can be trusted — are: {}.\n\
         The rest are below the timer's resolution, so they are named because the brief asked which rows\n\
         the counter fails on, not because they weigh against it.",
        winner.name,
        reliable.len(),
        name_rows(&fail14),
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

    // WHAT THE FIX WOULD BUY, under BOTH cost models rather than under whichever one flatters it.
    // `Σ abs×arg` becomes `Σ occ×arg` (the argument is shifted once per OCCURRENCE instead of once per
    // BINDER); nothing else in the accounting moves. Deferring the shift does not change what
    // `depth_exceeds` or the redex search walk, so `Σ read` is untouched — which is exactly why the two
    // models disagree about the result, and why the disagreement has to be reported rather than
    // resolved by preference.
    projection(rows, &reliable, &ms);
}

/// Allocating nodes a trace would cost AFTER the fix: the per-binder re-shift of the argument
/// (`Σ abs×arg`) becomes a per-occurrence one (`Σ occ×arg`), and nothing else moves.
///
/// An UPPER BOUND on the post-fix cost, not an equality: the rewrite's `lift == 0` arm returns
/// `s.clone()` — a refcount bump — so occurrences at binder depth 0 cost nothing at all. The
/// projection therefore understates the win, which is the direction a projection should err in.
fn alloc_after_fix(w: &Work) -> u64 {
    w.alloc() + w.occ_times_arg - w.abs_times_arg
}

/// What the fix would buy, priced under BOTH cost models rather than under whichever one flatters it.
/// Predictions contingent on a model — recorded, as the design says, precisely because re-running this
/// probe after the fix falsifies whichever one is wrong.
fn projection(rows: &[Row], reliable: &[usize], ms: &[f64]) {
    let t_alloc: u64 = rows.iter().map(|r| r.work.alloc()).sum();
    let t_read: u64 = rows.iter().map(|r| r.work.read()).sum();
    let t_after: u64 = rows.iter().map(alloc_after_fix_of).sum();

    let a_v: Vec<f64> = rows.iter().map(|r| r.work.alloc() as f64).collect();
    let r_v: Vec<f64> = rows.iter().map(|r| r.work.read() as f64).collect();
    let m_v: Vec<f64> = rows.iter().map(|r| r.work.model() as f64).collect();
    let c_flat = ls_one(&m_v, ms, reliable);
    let (a_ns, r_ns) = ls_two(&a_v, &r_v, ms, reliable);

    println!(
        "\nPROJECTED EFFECT OF THE FIX (`Σ abs×arg` -> `Σ occ×arg`), under BOTH cost models.\n\
         Corpus-wide the work falls {:.1}x by the flat measure ({} -> {} `Σ model` nodes) and {:.1}x by\n\
         the allocating measure ({} -> {} `Σ alloc` nodes); read-only work is untouched, which is the\n\
         whole reason the two models disagree about what happens to the outlier.\n",
        (t_alloc + t_read) as f64 / (t_after + t_read).max(1) as f64,
        t_alloc + t_read,
        t_after + t_read,
        t_alloc as f64 / t_after.max(1) as f64,
        t_alloc,
        t_after,
    );
    println!(
        "{:>4}  {:>10}  {:>9}  {:>10}  {:>9}  {:>10}",
        "#", "today ms", "flat x", "flat ms", "2-price x", "2-price ms"
    );
    println!("{}", "-".repeat(62));
    for &i in reliable {
        let w = &rows[i].work;
        let after = alloc_after_fix(w);
        println!(
            "{:>4}  {:>10.1}  {:>8.1}x  {:>10.1}  {:>8.1}x  {:>10.1}",
            rows[i].idx,
            ms[i],
            w.model() as f64 / (after + w.read()).max(1) as f64,
            c_flat * (after + w.read()) as f64,
            w.alloc() as f64 / after.max(1) as f64,
            a_ns * after as f64 + r_ns * w.read() as f64,
        );
    }

    // WHAT IS LEFT, AND WHICH TRAVERSAL IS THEN THE BIGGEST — the only forward guidance the next plan
    // gets, so it is computed here rather than inferred from the node accounting by hand. The two
    // models disagree about the answer, which is the whole reason both columns are printed: a read-only
    // traversal that is 64% of the remaining NODES is 64% of the remaining TIME only if a node costs
    // the same to read as to construct, and PART C.2 measured that it does not.
    let sum = |f: fn(&Work) -> u64| -> u64 { rows.iter().map(|r| f(&r.work)).sum() };
    let after: [(&str, &str, u64, bool); 7] = [
        ("spine rebuild", "Σ path", sum(|w| w.path_len), true),
        ("beta's opening shift", "Σ arg", sum(|w| w.arg_size), true),
        ("subst's body walk", "Σ body", sum(|w| w.body_size), true),
        ("per-occurrence shift", "Σ occ×arg", sum(|w| w.occ_times_arg), true),
        ("beta's closing shift", "Σ reduct", sum(|w| w.body_size.saturating_sub(w.occ) + w.occ_times_arg), true),
        ("depth_exceeds", "Σ size", sum(|w| w.term_size), false),
        ("redex search", "Σ scan", sum(|w| w.scan), false),
    ];
    let node_tot: u64 = after.iter().map(|&(_, _, n, _)| n).sum();
    let time_tot: f64 = after.iter().map(|&(_, _, n, al)| if al { a_ns } else { r_ns } * n as f64).sum();
    println!(
        "\nWHAT REMAINS AFTER THE FIX, and which traversal is then the largest. `nodes %` is a share of\n\
         the remaining work COUNTED IN NODES; `time % (flat)` assumes every node costs the same and is\n\
         therefore identical to it; `time % (2-price)` prices allocating and read-only nodes separately\n\
         at the rates fitted above. The two columns name DIFFERENT traversals as the largest, and that\n\
         difference is the reason PART C.2 exists.\n"
    );
    println!(
        "{:<22}{:<11}  {:>10}  {:>8}  {:>13}  {:>13}",
        "traversal", "counter", "nodes", "nodes %", "time % (flat)", "time % (2-pr)"
    );
    println!("{}", "-".repeat(84));
    for &(what, counter, n, allocating) in &after {
        let t = if allocating { a_ns } else { r_ns } * n as f64;
        let pct = 100.0 * n as f64 / node_tot.max(1) as f64;
        println!(
            "{what:<22}{counter:<11}  {n:>10}  {pct:>7.1}%  {pct:>12.1}%  {:>12.1}%{}",
            100.0 * t / time_tot,
            if allocating { "" } else { "   (read-only)" }
        );
    }
    println!(
        "\nTotal remaining: {} nodes; {:.1} ms under the flat model, {:.1} ms under the two-price one.\n\
         READ-ONLY WORK IS {:.1}% OF THE REMAINING NODES BUT {:.1}% OF THE REMAINING TIME. Stating the\n\
         first as if it were the second is the specific error this table exists to prevent.",
        node_tot,
        c_flat * node_tot as f64,
        time_tot,
        100.0 * after.iter().filter(|&&(_, _, _, al)| !al).map(|&(_, _, n, _)| n).sum::<u64>() as f64
            / node_tot.max(1) as f64,
        100.0 * after.iter().filter(|&&(_, _, _, al)| !al).map(|&(_, _, n, _)| r_ns * n as f64).sum::<f64>() / time_tot,
    );
}

/// `alloc_after_fix` behind a `&&Row`-shaped call, so the sum above reads as a `map` rather than a
/// closure that only exists to reach through the field.
fn alloc_after_fix_of(r: &Row) -> u64 {
    alloc_after_fix(&r.work)
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
         AN UNSTABLE `r` IS EXPECTED AND DOES NOT SEND YOU BACK TO THE FLAT MODEL. The leave-one-out\n\
         ranges above DO straddle zero and DO swing by more than the coefficient itself — eight runs of\n\
         this binary span -1.24 to 4.24 ns/node — and that is the corpus failing to price a nearly-free\n\
         node, not the split failing. What the conclusions depend on is the RANKING, which is monotone\n\
         in `r` and unchanged at BOTH ends of that range (`Σ reduct` leads in every one of the eight).\n\
         `a` is the coefficient they lean on, and it does not move: 35.4-36.3 ns/node. Retreating to\n\
         the flat column instead puts `depth_exceeds` back on top at 64% of nodes — the exact misreading\n\
         the two-price split exists to prevent. See the design's §10."
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
// It now lives in `crates/redextape-core/tests/subst_rewrite_equivalence.rs` as three `#[test]`s,
// which `cargo nextest run -p redextape-core` executes on every CI run. See that file for the
// candidate rewrite, the lemma, the differential and the pin, and the design's §8/§10 for why each
// exists. It is not duplicated here: two copies of an equivalence argument is exactly the kind of
// drift this branch spent its effort removing.
// ==================================================================================================
