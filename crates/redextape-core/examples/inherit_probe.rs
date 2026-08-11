//! **Why do the `None` β-steps sit outside the tags that are still alive, and would a contractum
//! -inherits rule reach them?** Successor to `none_probe.rs`, which established that 96.2% of
//! `while4`'s 397 `None` steps happen with tagged `App`s alive elsewhere in the term — a quantity,
//! not a mechanism. This probe supplies the mechanism and prices two candidate rules.
//!
//! # HOW TO RUN THIS
//!
//! ```text
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release -p redextape-core --example inherit_probe
//! ```
//!
//! **The cap is not decoration and `MemorySwapMax=0` is the load-bearing half.** An earlier
//! measurement over this family took 60 GiB of RAM and 29 GiB of swap and wedged the machine. An
//! OOM-kill or a timeout here is a RESULT to report, not something to work around by raising the cap.
//!
//! **Drives `trace::LambdaCursor`, never `reduce_trace`**, which materialises every step's term by
//! contract and is how the 60 GiB run happened.
//!
//! # WHAT THIS MEASURES
//!
//! * `[OV]` — `Owner` totals, for orientation and to prove the corpus matches `none_probe`'s.
//! * `[POS]` — every `None` step split by WHERE the live tags sit relative to the redex: inside its
//!   function subterm, inside its argument, or disjoint from it entirely. **That top-level split is
//!   two-way and exhaustive** — `Owner` is derived purely from the root→redex path, so a live tag is
//!   either inside the redex or in a subtree disjoint from it — but "disjoint" is not itself the last
//!   word: it further splits into tags alive elsewhere in the term (`disjoint`) and no tags anywhere in
//!   the term at all (`no-tags`), because a rule that only reaches tags near the redex says nothing
//!   about a term with no tags to reach in the first place. `PosBucket` carries this as three mutually
//!   exclusive outcomes (`Either`, `Disjoint`, `NoTags`), and the table adds `fn`/`arg` as independent,
//!   non-exclusive detail on `Either` alongside them.
//! * `[MACH]` — a histogram of the applied binder's name. **A HINT, NOT EVIDENCE**, and the printed
//!   header says so: `encode::church` mints `f` and `x`, `encode::diverge`'s `omega` mints `x`, and
//!   the fixpoint combinator `lower.rs` builds mints both. A name is shared by constructs with
//!   nothing else in common.
//! * `[INH]` — two contractum-inherits rules simulated against a real reducer, bracketing the family.
//!
//! Full design, including the pre-registered gate: `docs/superpowers/specs/2026-08-10-none-headroom
//! -mechanism-design.md`.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::rc::Rc;

use redextape_core::core::NodeId;
use redextape_core::lambda::reduce::Owner;
use redextape_core::lambda::term::{Node, abs, app_tagged_for_rebuild, beta};
use redextape_core::lambda::{self, Dir, LambdaTerm, MAX_REDUCTION_STEPS, Path};
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::{self, EncodingKind};
use redextape_core::{parser, trace};

fn line(s: &str) {
    println!("{s}");
    let _ = std::io::stdout().flush();
}

fn head(s: &str) {
    line("");
    line(s);
    line(&"-".repeat(s.len()));
}

fn fmt_pct(n: u64, of: u64) -> String {
    if of == 0 { "-".to_string() } else { format!("{:.1}%", 100.0 * n as f64 / of as f64) }
}

/// The four programs, **copied VERBATIM from `none_probe.rs`'s `programs()`** so the source strings
/// cannot drift between the two probes and every row here is comparable to a row already recorded.
/// `none_probe` copied them from `owner_probe` for the same reason. Examples are separate crates and
/// cannot share a helper; verbatim duplication with this note is the convention in this tree.
fn programs() -> Vec<(&'static str, &'static str)> {
    vec![
        ("while4", "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc"),
        (
            "countdown4",
            "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
        ),
        ("sum5", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"),
        (
            "map_fold",
            "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
             fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
             fn add(a, b) { a + b }\n\
             fn add1(x) { x + 1 }\n\
             fold([3, 1, 2].map(add1), 0, add)",
        ),
    ]
}

/// Number of DISTINCT allocations reachable from `t` that are a tagged `App`. **Copied verbatim from
/// `none_probe.rs`** — see `programs()` for why duplication rather than sharing.
///
/// **Physical, not logical** — deduped by `alloc_id` over an explicit worklist, the same convention
/// `term.rs`'s `max_shared_logical_size` uses: under structural sharing a term can denote an
/// astronomical logical tree from a small number of allocations, so a walk that revisits shared
/// subterms would be a hang, not a measurement. Iterative over an explicit stack, never recursive.
fn count_tagged_apps(t: &LambdaTerm) -> u64 {
    let mut seen: HashSet<usize> = HashSet::new();
    let mut stack: Vec<&LambdaTerm> = vec![t];
    let mut count = 0u64;
    while let Some(node) = stack.pop() {
        if !seen.insert(node.alloc_id()) {
            continue; // already visited this allocation; do not recount or re-walk its children
        }
        match node.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => stack.push(b),
            Node::App(f, a, _) => {
                if node.owner().is_some() {
                    count += 1;
                }
                stack.push(f);
                stack.push(a);
            }
        }
    }
    count
}

/// The subterm of `t` at `path`. Panics if the path does not match the term's shape, which is a bug
/// in the caller and not a condition to tolerate: a `Path` produced by the reducer for a term always
/// matches that term.
fn follow<'a>(t: &'a LambdaTerm, path: &[Dir]) -> &'a LambdaTerm {
    let mut cur = t;
    for d in path {
        cur = match (d, cur.node()) {
            (Dir::AppL, Node::App(f, _, _)) => f,
            (Dir::AppR, Node::App(_, a, _)) => a,
            (Dir::AbsBody, Node::Abs(_, b)) => b,
            _ => panic!("path {path:?} does not match the term's shape at {d:?}"),
        };
    }
    cur
}

/// Tagged-`App` counts reachable from a redex's function side and its argument side, in that order.
/// `redex` must be an `App` — every redex is, by construction.
fn redex_tag_counts(redex: &LambdaTerm) -> (u64, u64) {
    let Node::App(f, a, _) = redex.node() else {
        panic!("a redex is an App by construction, got {:?}", redex.node());
    };
    (count_tagged_apps(f), count_tagged_apps(a))
}

/// The three MUTUALLY EXCLUSIVE outcomes `classify_pos` can return. `fn`/`arg` are deliberately not
/// variants here: `measure` tracks those as independent, non-exclusive flags off the same two counts
/// this type's producer takes (a redex can hold a tag on both sides at once) — see `Census::pos_fn`
/// and `pos_arg`. What IS exclusive, and sums to `Census::none`, is whether the redex reaches a tag at
/// all, and if not, whether one is alive anywhere else in the term.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PosBucket {
    /// >=1 tagged `App` reachable from the redex — function side, argument side, or both.
    Either,
    /// Nothing tagged reachable from the redex, but the whole term entering the step still has a
    /// tagged `App` alive somewhere else in it.
    Disjoint,
    /// Nothing tagged reachable from the redex, and nothing tagged anywhere in the whole term either.
    NoTags,
}

/// Which `PosBucket` a step falls into, given the redex's own function-side and argument-side tag
/// counts (from `redex_tag_counts`) and the tag count of the WHOLE term entering the step (from
/// `count_tagged_apps` over the pre-step term, which includes whatever the redex itself holds).
///
/// Pure and free of `LambdaCursor`/`Census` so the decision that distinguishes `disjoint` from
/// `no_tags` — otherwise buried inside `measure`'s loop, where nothing could tell the two apart by
/// their effect on `redex_tag_counts` alone — is directly testable.
fn classify_pos(fn_tags: u64, arg_tags: u64, whole_term_tags: u64) -> PosBucket {
    if fn_tags + arg_tags > 0 {
        PosBucket::Either
    } else if whole_term_tags > 0 {
        PosBucket::Disjoint
    } else {
        PosBucket::NoTags
    }
}

/// The `n` most frequent names, most frequent first. **Ties break by name**, not by hash order: a
/// `HashMap` iterates differently run to run, and a probe whose table reorders between two runs of
/// the same code invites a reader to see a change that is not there.
fn top_names(h: &HashMap<Rc<str>, u64>, n: usize) -> Vec<(Rc<str>, u64)> {
    let mut v: Vec<(Rc<str>, u64)> = h.iter().map(|(k, c)| (Rc::clone(k), *c)).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    v.truncate(n);
    v
}

/// Parse, build the source map, lower. `None` if the program does not parse or lower — which cannot
/// happen for `programs()` and is handled rather than unwrapped so a future corpus edit degrades to a
/// missing row instead of a panic mid-table.
fn lower_program(src: &str) -> Option<(LambdaTerm, SourceMap)> {
    let (program, _) = parser::parse(src);
    let program = program?;
    let enc = EncodingKind::Unary.at(tm::MIN_FIELD_WIDTH);
    let (core, map) = SourceMap::build_from_program(&program, &*enc);
    let term = lambda::lower(&core).ok()?;
    Some((term, map))
}

/// Which contractum-inherits rule a shadow term is running. The two BRACKET the rule family: V1 is a
/// lower bound on what inheritance converts, V3 an upper bound. The intermediate rules are a family
/// nobody has enumerated, and this probe is not the place to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Variant {
    /// Conservative: tag the contractum's root if it is an untagged `App`, else nothing.
    V1,
    /// Aggressive: every untagged `App` in the contractum inherits the tag.
    V3,
}

/// Rebuild `t` with every untagged `App` carrying `o`, **PRESERVING STRUCTURAL SHARING**. An `App`
/// that already carries a tag keeps it: the nearer tag is the more precise claim, and overwriting it
/// would make an inherited tag beat a lowered one.
///
/// **THE `alloc_id` MEMO IS INSURANCE, NOT A PROVEN FIX — two separate claims, and only one is
/// established.** (1) Sharing loss without the memo is real: a plain recursive rebuild allocates a
/// fresh node per REFERENCE rather than per allocation, so one allocation reached twice comes back as
/// two distinct `alloc_id`s — pinned by `retag_all_loses_sharing_without_the_memo` below, which runs a
/// memo-less rebuild and asserts the ids diverge. (2) The blowup that loss was expected to cause on
/// THIS corpus is **not** established: a mutation that stripped the memo from this very function and
/// ran all four probe programs under the 2 GB cap completed to normal-form on every one, with
/// byte-identical output to the memoized run. These four programs evidently do not build enough
/// duplicate structure through this walk to hit the wall `max_shared_logical_size` guards against —
/// that is a fact about this corpus's redexes, not a refutation of the blowup, which is real for terms
/// this corpus does not happen to construct. The memo stays: it is cheap, it is correct per (1), and
/// removing it would be betting the next corpus looks like these four.
///
/// With the memo, each allocation is rebuilt once and re-shared, and the walk is O(physical
/// allocations): the same order as the `count_tagged_apps` walk already running per step.
///
/// Iterative over an explicit stack with a children-done marker, never recursive — a walk added to a
/// probe whose reason to exist is capped-memory safety must not risk a native stack overflow itself.
/// A node reached twice before either visit completes may be pushed twice; the memo check makes the
/// second pass a no-op and the result identical.
fn retag_all(t: &LambdaTerm, o: NodeId) -> LambdaTerm {
    let mut memo: HashMap<usize, LambdaTerm> = HashMap::new();
    let mut stack: Vec<(&LambdaTerm, bool)> = vec![(t, false)];
    while let Some((node, expanded)) = stack.pop() {
        if memo.contains_key(&node.alloc_id()) {
            continue;
        }
        if expanded {
            let rebuilt = match node.node() {
                Node::Var(_) => node.clone(),
                Node::Abs(n, b) => abs(Rc::clone(n), memo[&b.alloc_id()].clone()),
                Node::App(f, a, owner) => {
                    app_tagged_for_rebuild(memo[&f.alloc_id()].clone(), memo[&a.alloc_id()].clone(), owner.or(Some(o)))
                }
            };
            memo.insert(node.alloc_id(), rebuilt);
        } else {
            stack.push((node, true));
            match node.node() {
                Node::Var(_) => {}
                Node::Abs(_, b) => stack.push((b, false)),
                Node::App(f, a, _) => {
                    stack.push((f, false));
                    stack.push((a, false));
                }
            }
        }
    }
    memo[&t.alloc_id()].clone()
}

/// Apply the inheritance rule to a contractum. `o` is the owner of the redex just contracted; `None`
/// means the redex belonged to no construct, and **a `None` redex propagates nothing** — there is no
/// tag to inherit, and inventing one would be recomputing provenance rather than inheriting it.
///
/// `drops` counts the V1 contractions whose contractum root was not an `App`, i.e. the tags V1 had
/// nowhere to put. That count is reported, not swallowed: it is the size of V1's built-in leak.
fn inherit(t: LambdaTerm, o: Option<NodeId>, v: Variant, drops: &mut u64) -> LambdaTerm {
    let Some(o) = o else { return t };
    match v {
        Variant::V1 => match t.node() {
            Node::App(f, a, None) => app_tagged_for_rebuild(f.clone(), a.clone(), Some(o)),
            _ => {
                *drops += 1;
                t
            }
        },
        Variant::V3 => retag_all(&t, o),
    }
}

/// One leftmost-outermost β-step with the inheritance rule applied to the contractum.
///
/// **MIRRORS `reduce::reduce_step_go` EXACTLY, and the only difference is the `inherit` call.** Read
/// that function before changing this one. `enclosing` is the innermost tag on the path from the root
/// to `t`, EXCLUDING `t` itself, so the root-redex arm can prefer the redex's own tag.
///
/// Recursive, exactly as the function it mirrors is. **The caller must step a real `LambdaCursor`
/// first and call this only when that cursor advanced** — `LambdaCursor::next` applies the depth
/// guard, `depth_exceeds` is `pub(crate)` and unavailable here, and following the real cursor is how
/// this inherits the guard instead of reimplementing it.
fn shadow_step(
    t: &LambdaTerm,
    enclosing: Option<NodeId>,
    v: Variant,
    drops: &mut u64,
) -> Option<(LambdaTerm, Path, Owner)> {
    if let Node::App(f, a, owner) = t.node()
        && let Node::Abs(_, body) = f.node()
    {
        let who = match (owner, enclosing) {
            (Some(id), _) => Owner::Exact(*id),
            (None, Some(id)) => Owner::Within(id),
            (None, None) => Owner::None,
        };
        return Some((inherit(beta(body, a), who.node(), v, drops), Vec::new(), who));
    }
    match t.node() {
        Node::App(f, a, owner) => {
            let inner = (*owner).or(enclosing);
            if let Some((f2, mut path, who)) = shadow_step(f, inner, v, drops) {
                path.insert(0, Dir::AppL);
                Some((app_tagged_for_rebuild(f2, a.clone(), *owner), path, who))
            } else if let Some((a2, mut path, who)) = shadow_step(a, inner, v, drops) {
                path.insert(0, Dir::AppR);
                Some((app_tagged_for_rebuild(f.clone(), a2, *owner), path, who))
            } else {
                None
            }
        }
        Node::Abs(n, b) => shadow_step(b, enclosing, v, drops).map(|(b2, mut path, who)| {
            path.insert(0, Dir::AbsBody);
            (abs(Rc::clone(n), b2), path, who)
        }),
        Node::Var(_) => None,
    }
}

/// What one simulated rule produced over a whole run.
#[derive(Default)]
struct VariantStats {
    /// Steps whose shadow `Owner` was not `None` — the numerator of the gate's tagged rate. Equal to
    /// `exact + within`, since `Owner` has exactly three states and this is "not `None`".
    tagged: u64,
    /// Steps whose shadow `Owner` was `Exact` — the redex itself carried the tag, the STRONGER claim.
    /// A subset of `tagged`. Not read by the gate; printed in `[INH]` so a reader can see how much of
    /// `tagged` is `Exact` versus `within`, the weaker claim `within_widths` and the ceiling measure.
    exact: u64,
    /// Steps whose shadow `Owner` was `Within` — an enclosing construct carried the tag, not the redex
    /// itself. A subset of `tagged`. Equal to `within_widths.len()` whenever every resolved span's
    /// `source_span` lookup succeeds — see `within_widths`'s doc, which this count now makes assertable.
    within: u64,
    /// Steps the real reducer reported `None` and the shadow did not. A subset of `tagged`.
    converted: u64,
    /// Contractions whose contractum root was not an `App` (V1 only).
    drops: u64,
    /// M2: width of each `Owner::Within` shadow step's resolved span, as a percentage of `src.len()`.
    /// Pushed only when `SourceMap::source_span` resolves. **This is an assertable invariant, not
    /// borrowed authority**: `measure` asserts `within_widths.len() == within` for each variant before
    /// returning — the same check `owner_probe.rs`'s `Census` makes for its one un-variantized `within`
    /// — so a `source_span` miss here fails loudly instead of silently dropping a span from the M2
    /// population, exactly as it would in `owner_probe`.
    within_widths: Vec<f64>,
}

/// The value at rank `q` (0.0..=1.0) of an unsorted slice, nearest-rank: always one of `xs`'s actual
/// elements, never an interpolated value between two of them. `None` on an empty slice — a program
/// with no `Within` step has no width to report, which is a different fact from a width of zero. Same
/// convention as `owner_probe.rs`'s pair of the same name, so the two probes' medians mean the same
/// thing and are comparable.
fn percentile(xs: &[f64], q: f64) -> Option<f64> {
    if xs.is_empty() {
        return None;
    }
    let mut s = xs.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let rank = ((q * s.len() as f64).ceil() as usize).clamp(1, s.len()) - 1;
    Some(s[rank])
}

/// Median of an unsorted slice, nearest-rank (see `percentile`) — for an EVEN-length slice this is
/// the lower of the two middle values, NOT their average. `None` on an empty slice.
fn median(xs: &[f64]) -> Option<f64> {
    percentile(xs, 0.5)
}

/// One program's V1 tagged rate, by name. `None` when that program produced no row at all — which
/// the gate must treat as a FAIL rather than a skip, since a program that did not run cannot have
/// cleared a floor.
fn rate_of(rows: &[(&str, f64, Option<f64>, Option<f64>)], name: &str) -> Option<f64> {
    rows.iter().find(|(n, _, _, _)| *n == name).map(|(_, r, _, _)| *r)
}

/// The pre-registered gate's verdict, computed purely from the collected `rows` so the decision
/// `main` prints — the deliverable of this probe — is directly testable from synthetic rows instead
/// of only by a human reading the printed line. The same fix Task 2 applied by extracting
/// `classify_pos`.
///
/// **Reads ONLY `rows`' V1 fields** — index 1 (the V1 rate) and index 2 (the V1 Within median).
/// Index 3, V3's median, is never read here: V3 is printed beside V1 for comparison and must never
/// be what the verdict is computed from.
///
/// A program missing from `rows` — `rate_of` returning `None` — FAILS the floor via `is_some_and`,
/// never passes it by absence.
struct GateVerdict {
    /// `while4`'s V1 rate >= 31.1% AND `countdown4`'s >= 32.5%. Thresholds are pre-registered and
    /// not adjustable.
    floor_ok: bool,
    /// Count of rows whose V1 Within median exceeds 60% of program length.
    degenerate: usize,
    /// `degenerate <= 1`. Pre-registered and not adjustable — a program AT the ceiling still PASSES.
    ceiling_ok: bool,
}

/// Compute `GateVerdict` from the collected `(name, V1 rate, V1 Within median, V3 Within median)`
/// rows. See `GateVerdict`'s doc for what each field reads and does not read.
fn evaluate_gate(rows: &[(&str, f64, Option<f64>, Option<f64>)]) -> GateVerdict {
    let floor_ok =
        rate_of(rows, "while4").is_some_and(|r| r >= 31.1) && rate_of(rows, "countdown4").is_some_and(|r| r >= 32.5);
    let degenerate = rows.iter().filter(|(_, _, m, _)| m.is_some_and(|m| m > 60.0)).count();
    GateVerdict { floor_ok, degenerate, ceiling_ok: degenerate <= 1 }
}

/// One program's census: `[OV]`'s `Owner` totals, plus `[POS]`'s split of every `Owner::None` step by
/// where the live tags sit relative to its redex. `pos_fn`/`pos_arg` are independent flags (not
/// exclusive of each other); `pos_either`/`pos_disjoint`/`pos_no_tags` are `classify_pos`'s three
/// mutually exclusive outcomes and sum to `none`.
struct Census {
    steps: u64,
    exact: u64,
    within: u64,
    none: u64,
    /// `None` steps with >=1 tagged `App` reachable from the redex's function side.
    pos_fn: u64,
    /// `None` steps with >=1 tagged `App` reachable from the redex's argument side.
    pos_arg: u64,
    /// `None` steps with >=1 tagged `App` reachable from the redex at all — the union of the two
    /// above, and NOT their sum: a redex can hold tags on both sides.
    pos_either: u64,
    /// `None` steps with tags alive in the term but none reachable from the redex.
    pos_disjoint: u64,
    /// `None` steps with no tagged `App` anywhere in the term. `none_probe`'s "consumed" column;
    /// carried here so the four buckets sum to `none` and a reader can check that they do.
    pos_no_tags: u64,
    /// Binder name of the `Abs` applied in each `None` redex. **A HINT, NOT EVIDENCE** — see the
    /// module doc: names collide across constructs with nothing else in common.
    mach: HashMap<Rc<str>, u64>,
    /// Per-variant simulation results for V1, the conservative rule.
    v1: VariantStats,
    /// Per-variant simulation results for V3, the aggressive rule. `drops` stays zero: V3 tags every
    /// untagged `App` it touches, so there is nowhere for it to fail to place a tag.
    v3: VariantStats,
}

/// Drive one program to `MAX_REDUCTION_STEPS` over `trace::LambdaCursor`, counting `Owner` for `[OV]`
/// and, for every `Owner::None` step, classifying it into a `[POS]` bucket via `redex_tag_counts` +
/// `classify_pos` against the term ENTERING that step (see the clone below for why it must be that
/// term and not the one the step produces).
fn measure(src: &str) -> Census {
    let mut c = Census {
        steps: 0,
        exact: 0,
        within: 0,
        none: 0,
        pos_fn: 0,
        pos_arg: 0,
        pos_either: 0,
        pos_disjoint: 0,
        pos_no_tags: 0,
        mach: HashMap::new(),
        v1: VariantStats::default(),
        v3: VariantStats::default(),
    };
    let Some((term, map)) = lower_program(src) else {
        return c;
    };
    let mut real = trace::LambdaCursor::new(&term, MAX_REDUCTION_STEPS);
    let mut shadow_v1 = term.clone();
    let mut shadow_v3 = term.clone();
    loop {
        // CLONED BEFORE `next()`: the redex path indexes the term ENTERING the step. Reading
        // `term()` afterwards returns the term the step produced, in which the contracted redex no
        // longer exists and the path means something else. The clone is a refcount bump.
        let pre = real.term().clone();
        if real.next().is_none() {
            break;
        }
        c.steps += 1;
        // STEPPED AFTER THE PACEMAKER, DELIBERATELY — see `shadow_step`'s doc on the depth guard.
        let (next_v1, path_v1, owner_v1) = shadow_step(&shadow_v1, None, Variant::V1, &mut c.v1.drops)
            .expect("the real cursor advanced, so a redex exists");
        assert_eq!(
            real.last_redex().expect("a step was taken"),
            &path_v1,
            "V1 shadow diverged from the reducer at step {}: the rules change tags, never order",
            c.steps
        );
        shadow_v1 = next_v1;
        if owner_v1 != Owner::None {
            c.v1.tagged += 1;
            if real.last_owner() == Owner::None {
                c.v1.converted += 1;
            }
        }
        // Fix 1: per-variant Exact/Within, so `[INH]` can show V1's split and `within` becomes an
        // assertable population size for `within_widths` (see the assert after this loop).
        match owner_v1 {
            Owner::Exact(_) => c.v1.exact += 1,
            Owner::Within(_) => c.v1.within += 1,
            Owner::None => {}
        }
        // M2: width of the resolved span for a `Within` shadow step, as a percentage of program
        // length — same formula as `owner_probe.rs`'s `Census`, so the two probes' widths compare.
        if let Owner::Within(id) = owner_v1
            && let Some(s) = map.source_span(id)
        {
            c.v1.within_widths.push((s.end - s.start) as f64 / src.len() as f64 * 100.0);
        }
        let (next_v3, path_v3, owner_v3) = shadow_step(&shadow_v3, None, Variant::V3, &mut c.v3.drops)
            .expect("the real cursor advanced, so a redex exists");
        assert_eq!(
            real.last_redex().expect("a step was taken"),
            &path_v3,
            "V3 shadow diverged from the reducer at step {}",
            c.steps
        );
        shadow_v3 = next_v3;
        if owner_v3 != Owner::None {
            c.v3.tagged += 1;
            if real.last_owner() == Owner::None {
                c.v3.converted += 1;
            }
        }
        match owner_v3 {
            Owner::Exact(_) => c.v3.exact += 1,
            Owner::Within(_) => c.v3.within += 1,
            Owner::None => {}
        }
        if let Owner::Within(id) = owner_v3
            && let Some(s) = map.source_span(id)
        {
            c.v3.within_widths.push((s.end - s.start) as f64 / src.len() as f64 * 100.0);
        }
        match real.last_owner() {
            Owner::Exact(_) => c.exact += 1,
            Owner::Within(_) => c.within += 1,
            Owner::None => {
                c.none += 1;
                let path = real.last_redex().expect("a step was taken, so a redex path exists");
                let redex = follow(&pre, path);
                let (fn_tags, arg_tags) = redex_tag_counts(redex);
                if fn_tags > 0 {
                    c.pos_fn += 1;
                }
                if arg_tags > 0 {
                    c.pos_arg += 1;
                }
                match classify_pos(fn_tags, arg_tags, count_tagged_apps(&pre)) {
                    PosBucket::Either => c.pos_either += 1,
                    PosBucket::Disjoint => c.pos_disjoint += 1,
                    PosBucket::NoTags => c.pos_no_tags += 1,
                }
                if let Node::App(f, _, _) = redex.node()
                    && let Node::Abs(binder, _) = f.node()
                {
                    *c.mach.entry(Rc::clone(binder)).or_insert(0) += 1;
                }
            }
        }
    }
    // Fix 3: `within_widths`'s doc claims this holds, per-variant, and now it is checked rather than
    // assumed — the same shape of check `owner_probe.rs`'s `Census` makes for its single un-variantized
    // `within`. A cheap post-processing pass, not the risky β-step loop this file's module doc warns
    // about, so crashing on a violation is safe and preferred over silently reporting a narrower
    // population than the shadow actually produced.
    assert_eq!(
        c.v1.within_widths.len() as u64,
        c.v1.within,
        "V1 within_widths ({} entries) diverged from V1 within ({}) for {src:?}: SourceMap::source_span \
         returned None for some shadow Owner::Within id, which sourcemap_coverage.rs's \
         every_core_node_resolves_to_an_in_bounds_source_span says should never happen for a real term \
         — this is a genuine regression, not a corpus quirk",
        c.v1.within_widths.len(),
        c.v1.within,
    );
    assert_eq!(
        c.v3.within_widths.len() as u64,
        c.v3.within,
        "V3 within_widths ({} entries) diverged from V3 within ({}) for {src:?}: see the V1 assert above \
         for why this should never happen",
        c.v3.within_widths.len(),
        c.v3.within,
    );
    c
}

fn main() {
    line("inherit_probe — where the None steps are, and what a contractum-inherits rule would reach");
    line("  RUN UNDER: systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0");

    head("[OV] Owner totals (loop family first, then recursive)");
    line(&format!("[OV] {:<11}{:>8}{:>8}{:>8}{:>8}{:>10}", "program", "steps", "Exact", "Within", "None", "tagged%"));

    head("[POS] THE DELIVERABLE — None steps by where the live tags sit RELATIVE TO THE REDEX");
    line("  fn/arg  = >=1 tagged App reachable from the redex's function / argument side (not exclusive)");
    line("  either  = their UNION, not their sum; disjoint = tags alive but none reachable from the redex");
    line("  no-tags = no tagged App anywhere — none_probe's `consumed` column. The last three sum to None.");
    line(&format!(
        "[POS] {:<11}{:>8}{:>8}{:>8}{:>9}{:>11}{:>10}{:>10}",
        "program", "None", "fn", "arg", "either", "disjoint", "disj%", "no-tags"
    ));

    head("[MACH] A HINT, NOT EVIDENCE — binder name of the Abs applied in each None redex");
    line("  Names COLLIDE across unrelated constructs: encode::church mints `f` and `x`, diverge's");
    line("  omega mints `x`, and lower.rs's fixpoint combinator mints both. Read [POS] for the finding;");
    line("  this table only orients a reader who is about to ask WHICH machinery.");
    line(&format!("[MACH] {:<11}  {}", "program", "top 5: name=count"));

    head("[INH] Simulated contractum-inherits rules. V1 = conservative (gates); V3 = aggressive (ceiling)");
    line("  exact/within = the tagged split: exact means the redex itself carried the tag (the STRONGER");
    line("  claim); within means only an enclosing construct did. Both are subsets of tagged, and within");
    line("  is the population the Within-median columns below and the gate's ceiling are drawn from.");
    line(&format!(
        "[INH] {:<11}{:>8}{:>12}{:>10}{:>10}{:>10}{:>10}{:>10}{:>12}{:>10}{:>10}{:>10}{:>10}",
        "program",
        "steps",
        "V1 tagged",
        "V1 exact",
        "V1 within",
        "V1 conv",
        "V1 rate",
        "V1 drops",
        "V3 tagged",
        "V3 exact",
        "V3 within",
        "V3 conv",
        "V3 rate"
    ));

    // (name, V1 tagged rate, V1 Within median, V3 Within median). Collected as the loop runs so the
    // gate is evaluated once, at the end, over all four rows.
    let mut rows: Vec<(&str, f64, Option<f64>, Option<f64>)> = Vec::new();

    // Every table's row for a program is flushed immediately after that program's `measure()`
    // finishes — interleaved across tags rather than in separate passes — so a kill mid-run leaves
    // every table complete through the last finished program, never one table ahead of the others.
    // Same fix `none_probe` and `owner_probe` both already apply.
    for (name, src) in &programs() {
        let c = measure(src);
        line(&format!(
            "[OV] {:<11}{:>8}{:>8}{:>8}{:>8}{:>10}",
            name,
            c.steps,
            c.exact,
            c.within,
            c.none,
            fmt_pct(c.exact + c.within, c.steps),
        ));
        line(&format!(
            "[POS] {:<11}{:>8}{:>8}{:>8}{:>9}{:>11}{:>10}{:>10}",
            name,
            c.none,
            c.pos_fn,
            c.pos_arg,
            c.pos_either,
            c.pos_disjoint,
            fmt_pct(c.pos_disjoint, c.none),
            c.pos_no_tags,
        ));
        let top = top_names(&c.mach, 5);
        let rendered: Vec<String> = top.iter().map(|(n, k)| format!("{n}={k}")).collect();
        line(&format!("[MACH] {:<11}  {}", name, rendered.join("  ")));
        line(&format!(
            "[INH] {:<11}{:>8}{:>12}{:>10}{:>10}{:>10}{:>10}{:>10}{:>12}{:>10}{:>10}{:>10}{:>10}",
            name,
            c.steps,
            c.v1.tagged,
            c.v1.exact,
            c.v1.within,
            c.v1.converted,
            fmt_pct(c.v1.tagged, c.steps),
            c.v1.drops,
            c.v3.tagged,
            c.v3.exact,
            c.v3.within,
            c.v3.converted,
            fmt_pct(c.v3.tagged, c.steps),
        ));
        let v1_rate = if c.steps == 0 { 0.0 } else { 100.0 * c.v1.tagged as f64 / c.steps as f64 };
        rows.push((*name, v1_rate, median(&c.v1.within_widths), median(&c.v3.within_widths)));
    }

    head("[GATE] The pre-registered rule. FLOOR: V1 >= 31.1% on while4 and >= 32.5% on countdown4.");
    line("  CEILING: the count of programs with a V1 Within median > 60% must not exceed 1 (sum5 today).");
    line("  THE GATE READS V1 ONLY. V3 is the ceiling of the rule family, not the thing being admitted.");
    for (name, v1_rate, v1_med, v3_med) in &rows {
        line(&format!(
            "[GATE] {name:<11} V1 rate {:>7}   V1 Within median {:>8}   V3 Within median {:>8}",
            format!("{v1_rate:.1}%"),
            v1_med.map_or_else(|| "-".to_string(), |m| format!("{m:.1}%")),
            v3_med.map_or_else(|| "-".to_string(), |m| format!("{m:.1}%")),
        ));
    }
    // Computed by `evaluate_gate`, not inline, so the decision is directly testable from synthetic
    // rows. See its doc for the missing-program-fails-by-absence and V1-only-never-V3 guarantees.
    let GateVerdict { floor_ok, degenerate, ceiling_ok } = evaluate_gate(&rows);
    line(&format!(
        "[GATE] FLOOR {}   CEILING {} ({degenerate} degenerate, was 1)   => SLICE {}",
        if floor_ok { "PASS" } else { "FAIL" },
        if ceiling_ok { "PASS" } else { "FAIL" },
        if floor_ok && ceiling_ok { "BUILD" } else { "DO NOT BUILD" },
    ));
    // CAVEAT, not a threshold change: the ceiling has not been shown capable of FAILING for any rule
    // in this family, so CEILING PASS above is not evidence this rule keeps `Within` legible — only
    // FLOOR does the discriminating work. See §3's correction note in the design doc for the measured
    // numbers this rests on.
    line("");
    line("[GATE] CAVEAT: the ceiling is not known to be capable of failing for any rule in this family.");
    line("  It measures the WIDTH of V1's Within spans, and inheritance narrows Within rather than");
    line("  widening it — an inherited tag names the redex's own construct, which is always at least as");
    line("  near as the enclosing construct it replaces. The aggressive variant empties the category");
    line("  outright: V3 tags every App in a contractum, so a later step is Exact or None and never");
    line("  Within, leaving no population for a median (see V3 Within median above: always \"-\").");
    line("  Read FLOOR as discriminating a rule that does something from one that does nothing; CEILING");
    line("  PASS here is not evidence this rule keeps Within legible, only that it has not been shown");
    line("  otherwise.");
}

#[cfg(test)]
mod tests {
    use super::*;
    use redextape_core::lambda::Dir;
    use redextape_core::lambda::reduce::reduce_step;
    use redextape_core::lambda::term::{abs, app, app_owned, var};

    #[test]
    fn follow_navigates_each_direction() {
        // ((\x. x) 7) applied to 9  =>  App(App(Abs, Var), Var)
        let inner = app(abs("x", var(0)), var(7));
        let t = app(inner.clone(), var(9));

        assert_eq!(follow(&t, &[]).alloc_id(), t.alloc_id(), "an empty path is the root");
        assert_eq!(follow(&t, &[Dir::AppL]).alloc_id(), inner.alloc_id(), "AppL is the function side");
        assert!(matches!(follow(&t, &[Dir::AppR]).node(), Node::Var(9)), "AppR is the argument side");
        assert!(
            matches!(follow(&t, &[Dir::AppL, Dir::AppL, Dir::AbsBody]).node(), Node::Var(0)),
            "AbsBody enters the binder"
        );
    }

    #[test]
    fn a_tag_in_the_argument_classifies_as_arg_and_not_disjoint() {
        // (\x. x) (tagged 5)  — the only tagged App is inside the redex's ARGUMENT.
        let tagged_arg = app_owned(abs("y", var(0)), var(5), 42);
        let redex = app(abs("x", var(0)), tagged_arg);

        let (fn_tags, arg_tags) = redex_tag_counts(&redex);
        assert_eq!(fn_tags, 0, "the function side holds no tagged App");
        assert_eq!(arg_tags, 1, "the argument side holds exactly one");
    }

    #[test]
    fn a_tag_in_the_function_classifies_as_fn() {
        // (\x. tagged) 5  — the only tagged App is inside the redex's FUNCTION.
        let redex = app(abs("x", app_owned(abs("y", var(0)), var(1), 42)), var(5));

        let (fn_tags, arg_tags) = redex_tag_counts(&redex);
        assert_eq!(fn_tags, 1, "the function side holds exactly one tagged App");
        assert_eq!(arg_tags, 0, "the argument side holds none");
    }

    #[test]
    fn an_untagged_redex_has_zero_reachable_tag_counts() {
        // `redex_tag_counts` alone cannot tell `disjoint` (tags alive elsewhere in the term) from
        // `no_tags` (no tags anywhere) — both produce (0, 0) here. That distinction is `classify_pos`'s
        // job, exercised directly by the `classify_pos_*` tests below.
        let redex = app(abs("x", var(0)), var(5));
        let (fn_tags, arg_tags) = redex_tag_counts(&redex);
        assert_eq!(fn_tags + arg_tags, 0, "nothing tagged is reachable from this redex");
    }

    #[test]
    fn classify_pos_fn_tags_alone_is_either() {
        assert_eq!(classify_pos(1, 0, 1), PosBucket::Either, "a tag on the function side is reachable from the redex");
    }

    #[test]
    fn classify_pos_arg_tags_alone_is_either() {
        assert_eq!(classify_pos(0, 1, 1), PosBucket::Either, "a tag on the argument side is reachable from the redex");
    }

    #[test]
    fn classify_pos_redex_clear_but_term_tagged_elsewhere_is_disjoint() {
        // (0, 0) from the redex, but the whole term entering the step still has a tag alive elsewhere.
        assert_eq!(classify_pos(0, 0, 3), PosBucket::Disjoint, "tags alive in the term, none reachable from the redex");
    }

    #[test]
    fn classify_pos_nothing_tagged_anywhere_is_no_tags() {
        // (0, 0) from the redex AND zero anywhere in the whole term — this is the case a
        // disjoint/no_tags branch swap collapses into `disjoint`, and the case the old
        // `an_untagged_redex_with_no_tags_inside_is_disjoint` test could not distinguish from it.
        assert_eq!(classify_pos(0, 0, 0), PosBucket::NoTags, "no tagged App anywhere in the term");
    }

    /// Ties break by name so the printed table is stable across two runs of identical code — a
    /// `HashMap` reseeds its hasher every process, so its iteration order changes run to run.
    ///
    /// **This test cannot prove the tiebreak is present with certainty, and no test against this
    /// signature can.** `top_names` takes a `&HashMap` with the default (randomized) hasher, so there
    /// is no way to pin its iteration order from outside; changing the signature just to make this
    /// test deterministic would not be worth it for a test-only benefit. If the `.then_with(...)` name
    /// tiebreak were removed, `v.sort_by` — a STABLE sort — would leave tied entries in whatever order
    /// `HashMap::iter` produced that process, which is effectively a random permutation of the tied
    /// group. With the ten tied names below, the mutant still passes this test if that permutation
    /// happens to already be alphabetical: probability approximately `1/10! ≈ 2.8e-7`. That residual is
    /// not zero, but it is small enough to trust in practice — the honest fix is enough tied entries to
    /// make the escape negligible, not a test that claims certainty it cannot have.
    #[test]
    fn top_names_ranks_by_count_then_breaks_ties_by_name_with_negligible_residual_chance() {
        let mut h: HashMap<Rc<str>, u64> = HashMap::new();
        h.insert("hi".into(), 50); // uniquely highest count: sorts first regardless of the tiebreak
        // Ten names tied at the same count, inserted in a scrambled order so insertion order cannot
        // accidentally match the alphabetical order this test asserts.
        for name in ["j", "f", "c", "i", "a", "h", "b", "g", "d", "e"] {
            h.insert(name.into(), 5);
        }

        let top = top_names(&h, 11);
        assert_eq!(top.len(), 11, "the cap is honoured");
        assert_eq!(&*top[0].0, "hi", "the uniquely highest count sorts first regardless of the tiebreak");
        assert_eq!(top[0].1, 50);

        let expected_tied_order = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
        let actual_tied_order: Vec<&str> = top[1..].iter().map(|(n, _)| &**n).collect();
        assert_eq!(actual_tied_order, expected_tied_order, "all ten tied entries sort by name ascending");
        for (name, count) in &top[1..] {
            assert_eq!(*count, 5, "{name} kept its tied count");
        }
    }

    /// Drive a term to normal form twice — once through the real `reduce_step`, once through
    /// `shadow_step` — and assert the redex paths agree at every step. **This is the load-bearing
    /// invariant of the whole `[INH]` table**: the rules change tags, never reduction order, because
    /// `reduce_step_go` picks its redex structurally and never reads a tag.
    fn assert_paths_agree(t: &LambdaTerm, v: Variant) {
        let mut real = t.clone();
        let mut shadow = t.clone();
        let mut drops = 0u64;
        let mut step = 0u64;
        loop {
            let r = reduce_step(&real);
            let s = shadow_step(&shadow, None, v, &mut drops);
            match (r, s) {
                (None, None) => break,
                (Some((rt, rp, _)), Some((st, sp, _))) => {
                    assert_eq!(rp, sp, "shadow diverged from the reducer at step {step}");
                    real = rt;
                    shadow = st;
                    step += 1;
                }
                (r, s) => panic!(
                    "one reducer halted and the other did not at step {step}: {:?} vs {:?}",
                    r.is_some(),
                    s.is_some()
                ),
            }
        }
        assert!(step > 0, "the fixture must actually reduce, or this asserts nothing");
    }

    #[test]
    fn shadow_v1_reduces_in_the_same_order_as_the_real_reducer() {
        let (term, _map) = lower_program("let mut n = 2; while n > 0 { n = n - 1; } n").expect("fixture lowers");
        assert_paths_agree(&term, Variant::V1);
    }

    #[test]
    fn v1_tags_a_contractum_root_that_is_an_untagged_app() {
        // (\x. (x 1)) (\y. y)  tagged 42  =>  contractum root is App((\y.y), 1), untagged.
        let redex = app_owned(abs("x", app(var(0), var(1))), abs("y", var(0)), 42);
        let mut drops = 0u64;
        let (next, path, owner) = shadow_step(&redex, None, Variant::V1, &mut drops).expect("a redex exists");

        assert_eq!(path, Path::new(), "the redex is at the root");
        assert_eq!(owner, Owner::Exact(42), "the redex carried its own tag");
        assert_eq!(next.owner(), Some(42), "V1 must tag the contractum's root App");
        assert_eq!(drops, 0, "the root was an App, so nothing was dropped");
    }

    #[test]
    fn v1_drops_the_tag_when_the_contractum_root_is_not_an_app() {
        // (\x. \y. x) 7  tagged 42  =>  contractum root is an Abs. V1 has nowhere to put the tag.
        let redex = app_owned(abs("x", abs("y", var(1))), var(7), 42);
        let mut drops = 0u64;
        let (next, _path, owner) = shadow_step(&redex, None, Variant::V1, &mut drops).expect("a redex exists");

        assert_eq!(owner, Owner::Exact(42));
        assert!(matches!(next.node(), Node::Abs(_, _)), "the contractum root is an Abs");
        assert_eq!(drops, 1, "V1 must COUNT the tag it had nowhere to put");
    }

    #[test]
    fn v1_drops_the_tag_when_the_contractum_root_is_already_tagged() {
        // (\x. x) (taggedInner 1)  outer redex tagged 42, inner App tagged 7  =>  the identity's
        // body is just its bound variable, so beta substitutes the ALREADY-TAGGED inner App straight
        // into contractum root position. V1 must not overwrite tag 7 with the inherited 42: the
        // nearer, lowered tag is the more precise claim, and the inherited one has nowhere to go.
        let tagged_inner = app_owned(abs("y", var(0)), var(1), 7);
        let redex = app_owned(abs("x", var(0)), tagged_inner, 42);
        let mut drops = 0u64;
        let (next, path, owner) = shadow_step(&redex, None, Variant::V1, &mut drops).expect("a redex exists");

        assert_eq!(path, Path::new(), "the redex is at the root");
        assert_eq!(owner, Owner::Exact(42), "the redex carried its own tag");
        assert_eq!(next.owner(), Some(7), "the existing tag must survive unoverwritten");
        assert_eq!(drops, 1, "V1 must count the tag it had nowhere to put because the root was already tagged");
    }

    #[test]
    fn a_none_redex_propagates_nothing() {
        // (\x. (x 1)) (\y. y)  UNTAGGED, with no enclosing tag => Owner::None, nothing to inherit.
        let redex = app(abs("x", app(var(0), var(1))), abs("y", var(0)));
        let mut drops = 0u64;
        let (next, _path, owner) = shadow_step(&redex, None, Variant::V1, &mut drops).expect("a redex exists");

        assert_eq!(owner, Owner::None);
        assert_eq!(next.owner(), None, "there was no owner to propagate");
        assert_eq!(drops, 0, "a None redex is not a dropped tag; it is nothing to drop");
    }

    #[test]
    fn retag_all_tags_every_untagged_app_and_leaves_existing_tags_alone() {
        // App( App(\x.x, 1) [tagged 7], \y.y )  — outer App untagged, inner App already tagged 7.
        let inner = app_owned(abs("x", var(0)), var(1), 7);
        let t = app(inner, abs("y", var(0)));

        let out = retag_all(&t, 42);
        assert_eq!(out.owner(), Some(42), "the untagged outer App inherits");
        let Node::App(f, _, _) = out.node() else { panic!("shape preserved") };
        assert_eq!(f.owner(), Some(7), "an App that already had a tag KEEPS it");
    }

    #[test]
    fn retag_all_reaches_an_app_nested_two_levels_inside_another_application() {
        // t = App(mid, tagged_sibling)
        //   mid  = App(deep, 2)                — untagged, ONE level under the root
        //     deep = App(\x.x, 1)               — untagged, TWO levels under the root: the depth none
        //                                          of the other `retag_all` tests reaches. A walk that
        //                                          special-cased shallow depth — tagging only the root
        //                                          and its immediate App children, say — would still
        //                                          tag `mid` and pass every other test in this file,
        //                                          but would leave `deep` untouched.
        //   tagged_sibling = App(\y.y, 3) tagged 99 — ALREADY tagged, sitting beside `mid` at the same
        //                                          depth `deep` sits at inside `mid`. Observing this
        //                                          alongside `deep` exercises BOTH halves of the rule
        //                                          at depth: a fresh tag reaches down past shallow
        //                                          nesting, and an existing tag is left alone doing so.
        let deep = app(abs("x", var(0)), var(1));
        let mid = app(deep, var(2));
        let tagged_sibling = app_owned(abs("y", var(0)), var(3), 99);
        let t = app(mid, tagged_sibling);

        let out = retag_all(&t, 42);

        assert_eq!(out.owner(), Some(42), "the untagged root inherits");
        let deep_out = follow(&out, &[Dir::AppL, Dir::AppL]);
        assert_eq!(deep_out.owner(), Some(42), "an App nested two levels inside another App still inherits");
        let sibling_out = follow(&out, &[Dir::AppR]);
        assert_eq!(sibling_out.owner(), Some(99), "an already-tagged App elsewhere in the shape keeps its own tag");
    }

    #[test]
    fn retag_all_preserves_structural_sharing() {
        // One allocation referenced twice. After re-tagging, the two positions must STILL be one
        // allocation — a walk without the alloc_id memo rebuilds it twice and silently deep-copies
        // the DAG, which is the blowup this probe is capped against.
        let shared = app(abs("x", app(var(0), var(0))), abs("y", var(0)));
        let t = app(shared.clone(), shared.clone());

        let out = retag_all(&t, 42);
        let Node::App(l, r, _) = out.node() else { panic!("shape preserved") };
        assert_eq!(l.alloc_id(), r.alloc_id(), "the shared subterm must be rebuilt ONCE and re-shared");
    }

    /// A plain recursive rebuild with NO `alloc_id` memo — what `retag_all` would be if its memo were
    /// removed. Exists ONLY to pin the sharing-loss half of `retag_all`'s doc; it is not an alternate
    /// implementation and nothing else in this file calls it. Recursive is fine here: the fixture below
    /// is two nodes deep, and the point of this helper is to be the naive thing `retag_all` is not.
    fn retag_all_naive(t: &LambdaTerm, o: NodeId) -> LambdaTerm {
        match t.node() {
            Node::Var(_) => t.clone(),
            Node::Abs(n, b) => abs(Rc::clone(n), retag_all_naive(b, o)),
            Node::App(f, a, owner) => {
                app_tagged_for_rebuild(retag_all_naive(f, o), retag_all_naive(a, o), owner.or(Some(o)))
            }
        }
    }

    #[test]
    fn retag_all_loses_sharing_without_the_memo() {
        // Same shared-subterm fixture as `retag_all_preserves_structural_sharing`, run through the
        // memo-less rebuild instead. Pins the claim `retag_all`'s doc makes: sharing loss without the
        // memo is a real, demonstrated property of this rebuild, not a hypothetical.
        let shared = app(abs("x", app(var(0), var(0))), abs("y", var(0)));
        let t = app(shared.clone(), shared.clone());

        let out = retag_all_naive(&t, 42);
        let Node::App(l, r, _) = out.node() else { panic!("shape preserved") };
        assert_ne!(l.alloc_id(), r.alloc_id(), "without the memo, one shared subterm becomes two allocations");
    }

    #[test]
    fn retag_all_leaves_vars_and_abs_shapes_intact() {
        let t = abs("x", app(var(0), var(1)));
        let out = retag_all(&t, 42);
        let Node::Abs(name, body) = out.node() else { panic!("an Abs stays an Abs") };
        assert_eq!(&**name, "x", "the binder name is preserved");
        assert_eq!(body.owner(), Some(42), "the App inside inherits");
    }

    #[test]
    fn shadow_v3_reduces_in_the_same_order_as_the_real_reducer() {
        let (term, _map) = lower_program("let mut n = 2; while n > 0 { n = n - 1; } n").expect("fixture lowers");
        assert_paths_agree(&term, Variant::V3);
    }

    #[test]
    fn percentile_is_nearest_rank_over_sorted_values() {
        let xs = vec![10.0, 30.0, 20.0, 40.0];
        assert_eq!(percentile(&xs, 0.0), Some(10.0), "p0 is the smallest VALUE, not the first element");
        assert_eq!(percentile(&xs, 1.0), Some(40.0));
        assert_eq!(median(&xs), Some(20.0), "even length takes the lower of the two middles");
    }

    #[test]
    fn an_empty_width_list_has_no_median_rather_than_a_zero() {
        // A program with zero `Within` steps has NO span width to report, which is a different fact
        // from a width of zero. Collapsing them would print a degenerate-looking 0.0% for a program
        // that simply never reported Within.
        assert_eq!(median(&[]), None);
    }

    // --- `evaluate_gate`: the pre-registered decision itself, exercised on synthetic rows so a
    // flipped inequality, a wrong threshold, a V1/V3 swap, or a missing-program pass-by-absence
    // would fail a test here rather than only be visible to a human reading the printed line.

    #[test]
    fn floor_passes_when_both_programs_clear_their_own_threshold_by_a_wide_margin() {
        // Comfortably ABOVE each threshold, not merely past it: at 50.0% a flipped `<=` in place of
        // `>=` would turn BOTH clauses false (50.0 <= 31.1 is false, 50.0 <= 32.5 is false), so this
        // single case catches a flip on either program's comparison.
        let rows = vec![("while4", 50.0, None, None), ("countdown4", 50.0, None, None)];
        assert!(evaluate_gate(&rows).floor_ok, "both rates clear their own thresholds");
    }

    #[test]
    fn floor_fails_when_while4_is_below_its_own_threshold() {
        let rows = vec![("while4", 31.0, None, None), ("countdown4", 90.0, None, None)];
        assert!(!evaluate_gate(&rows).floor_ok, "31.0% is below while4's 31.1% floor");
    }

    #[test]
    fn floor_fails_when_countdown4_is_below_its_own_threshold() {
        let rows = vec![("while4", 90.0, None, None), ("countdown4", 32.4, None, None)];
        assert!(!evaluate_gate(&rows).floor_ok, "32.4% is below countdown4's 32.5% floor");
    }

    #[test]
    fn floor_fails_when_a_required_program_is_missing_from_rows_rather_than_passing_by_absence() {
        // `while4` never made it into `rows` — the case `rate_of` returns `None` for. A mutant that
        // treats a missing row as satisfying its threshold (e.g. `map_or(true, ..)` in place of
        // `is_some_and`) would pass here; the gate must FAIL instead.
        let rows = vec![("countdown4", 90.0, None, None)];
        assert!(!evaluate_gate(&rows).floor_ok, "a program missing from rows must fail the floor, not pass by absence");
    }

    #[test]
    fn ceiling_passes_at_exactly_one_degenerate_program() {
        // The pre-registered ceiling is `<= 1`, so exactly one degenerate program must still PASS.
        // A `< 1` mutant fails this boundary.
        let rows = vec![("while4", 90.0, Some(70.0), None), ("countdown4", 90.0, Some(10.0), None)];
        let verdict = evaluate_gate(&rows);
        assert_eq!(verdict.degenerate, 1);
        assert!(verdict.ceiling_ok, "exactly one degenerate program must still PASS the <= 1 ceiling");
    }

    #[test]
    fn ceiling_fails_at_two_degenerate_programs() {
        let rows = vec![("while4", 90.0, Some(70.0), None), ("countdown4", 90.0, Some(80.0), None)];
        let verdict = evaluate_gate(&rows);
        assert_eq!(verdict.degenerate, 2);
        assert!(!verdict.ceiling_ok, "two degenerate programs exceed the <= 1 ceiling");
    }

    #[test]
    fn ceiling_reads_v1_medians_and_never_v3s() {
        // V1's median sits at a harmless 10%; V3's sits at a degenerate 90%. THE GATE READS V1 ONLY —
        // if the ceiling ever read V3's column instead of V1's, both rows would count as degenerate
        // and the ceiling would fail. It must not.
        let rows = vec![("while4", 90.0, Some(10.0), Some(90.0)), ("countdown4", 90.0, Some(10.0), Some(90.0))];
        let verdict = evaluate_gate(&rows);
        assert_eq!(verdict.degenerate, 0, "the ceiling must count V1's median, never V3's");
        assert!(verdict.ceiling_ok);
    }
}
