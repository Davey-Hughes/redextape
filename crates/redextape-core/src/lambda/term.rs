//! de Bruijn lambda-terms. Indices are 0-based (0 = innermost binder). The `Abs` name hint is used
//! only when printing; equality is de Bruijn structural, so substitution is pure index arithmetic
//! (no fresh names, no capture).
//!
//! STRUCTURALLY SHARED, AND THAT IS THE POINT. `LambdaTerm` is a handle around one `Rc<Node>`, so
//! cloning ANY term at ANY level — including the root — is a refcount bump rather than a deep copy.
//! The reducer's spine rebuild (`reduce.rs`) was measured deep-cloning the untouched sibling subtree
//! at every level of the redex path; that is what this representation removes. See
//! `docs/superpowers/specs/2026-07-30-lambda-structural-sharing-design.md`.

use std::collections::HashMap;
use std::collections::HashSet;
use std::rc::Rc;

use crate::core::NodeId;

/// A lambda-term. One `Rc` per node; `.node()` reaches the variant.
///
/// Two `u32`s ride alongside the pointer, both maintained as CONSTRUCTION-TIME INVARIANTS by `var` /
/// `abs` / `app` in O(1) and never recomputed by a walk:
///
///   * `maxfree` — the highest free de Bruijn index in this term, plus one, so **0 means closed**.
///   * `depth` — the length of the longest path to a leaf, i.e. the depth of the tree this term
///     DENOTES.
///
/// **THE SECOND IS NOT DERIVABLE CHEAPLY ANY OTHER WAY, which is the whole reason it is stored.** Under
/// structural sharing a term's denoted depth is a property of the DAG's longest path, and the obvious
/// implementation — walk the term, track the running depth — visits each allocation once per EDGE
/// reaching it, so 10,001 allocations denoting 2^10001 nodes take exponential time to measure. That is
/// what `reduce.rs`'s `depth_exceeds` used to do, once per β-step; it was **96% of the reduction time**
/// on the nested-group family at eleven levels (187.6 s of 195.7 s) and it doubled per level. Memoizing
/// the walk by allocation fixes the growth but costs a `HashMap` per call, which is a net LOSS on the
/// small terms the ordinary corpus reduces. Carrying the number is O(1) at both ends.
///
/// They ride on the HANDLE rather than inside the `Node`, which keeps `Drop`, `PartialEq` and every
/// existing walker untouched: the `Rc` is still an `Rc<Node>`. Two handles to the same allocation always
/// carry the same numbers, since both are functions of the node.
#[derive(Clone, Debug)]
pub struct LambdaTerm(Rc<Node>, u32, u32);

/// The shape of a term. `pub` because five modules in `src/` match on it; a private inner enum would
/// need a parallel view type for no gain.
///
/// DELIBERATELY WITHOUT A `Drop` IMPL, which is load-bearing rather than incidental: `LambdaTerm`'s
/// destructor takes a `Node` out of its `Rc` by value and moves the children onto a worklist, and
/// moving a field out of a type that implements `Drop` does not compile. See that `Drop`.
#[derive(Debug)]
pub enum Node {
    /// de Bruijn index; 0 refers to the innermost enclosing `Abs`.
    Var(u32),
    /// Abstraction with a print-only name hint and a body.
    ///
    /// `Rc<str>`, not `String`: the hint is print-only and `PartialEq` ignores it, so a `String`
    /// would make every clone allocate — defeating the point at the root, which is cloned once per
    /// step by `reduce_trace`. `abs` takes `impl Into<Rc<str>>`, which accepts `&str` and `String`
    /// alike, so no call site changed.
    Abs(Rc<str>, LambdaTerm),
    /// Application, with the source construct it was lowered from.
    ///
    /// **THE TAG IS INHERITED, NEVER RECOMPUTED.** Reduction creates no node ex nihilo — every
    /// constructor call on the reduction path rebuilds a node corresponding to exactly one input node
    /// (design §2.1 tabulates all ten sites) — so a tag written once at lowering remains well-defined
    /// after any number of β-steps. That is the whole difference from `node_to_lambda`, whose paths
    /// were *positional* and went stale after one contraction.
    ///
    /// **IT COSTS NOTHING — ON A 64-BIT HOST.** `Option<NodeId>` here leaves `size_of::<Node>()`
    /// unchanged from what it would be without the tag, because the compiler packs it into the
    /// discriminant word's padding there — measured, and pinned by the `const _` below. That specific
    /// packing does NOT hold on wasm32 (also measured: `Option<NodeId>` costs 4 real bytes there, see
    /// the `const _`'s doc), so "costs nothing" is a 64-bit-host claim, not a universal one. Putting the
    /// tag on the `LambdaTerm` handle instead, which the two existing `u32`s suggest by analogy, costs
    /// 16 bytes per node and 8 per handle on a 64-bit host — worse on every target measured so far.
    App(LambdaTerm, LambdaTerm, Option<NodeId>),
}

/// The shape `Node` would have WITHOUT the provenance tag. Exists only so the assertion below can
/// state the property the design actually measured — that the tag is free — rather than a magic
/// number. `#[cfg]`-gated alongside that assertion: see its doc for why the comparison this type
/// exists for is not portable across targets.
#[cfg(target_pointer_width = "64")]
#[allow(dead_code, reason = "constructed nowhere; exists only to be measured by the assertion below")]
enum NodeUntagged {
    Var(u32),
    Abs(Rc<str>, LambdaTerm),
    App(LambdaTerm, LambdaTerm),
}

/// **THE TAG MUST STAY FREE — ON A 64-BIT HOST.** `Option<NodeId>` on `App` was measured (design §2.2)
/// to pack into the discriminant word's padding there, leaving `Node` exactly the size it would be
/// without the tag at all (`NodeUntagged`, above, built for exactly this comparison rather than a
/// literal byte count). That packing is NOT free on wasm32, which `redextape-wasm` compiles this crate
/// to for the browser app: a bare `u32` field costs 4 bytes there (4-byte pointer alignment leaves no
/// padding to absorb it, unlike the 8-byte alignment a 64-bit host's pointer fields impose), so
/// `Option<NodeId>` genuinely grows `App` by 4 bytes on that target — measured `Node` 32 bytes vs.
/// `NodeUntagged` 28. The assertion is therefore gated to the one case design §2.2 actually measured
/// and the only one it can honestly promise, rather than asserting a cross-target equality that does
/// not hold and would make every wasm32 build fail.
///
/// This mirror-equality assertion alone is WEAKER than the flat `== 40` it replaced: it proves the tag
/// is free RELATIVE to `NodeUntagged`, but `NodeUntagged` moves in lockstep with `Node` — a field added
/// anywhere on `LambdaTerm` (the handle both types embed) grows both equally, and this assertion would
/// stay green straight through it. The absolute-size assertion below is what still catches that: it
/// pins `Node` itself, the property the flat `40` originally existed for (`Node` is a type "prone to
/// 375x logical blow-up" under structural sharing, so any unplanned growth compounds). Together: one
/// assertion for "the tag is free", one for "`Node` has not grown at all" — both host-only, because
/// wasm32's 4-byte pointers make every figure here different from the 64-bit numbers pinned below.
#[cfg(target_pointer_width = "64")]
const _: () = assert!(std::mem::size_of::<Node>() == std::mem::size_of::<NodeUntagged>());

/// See the doc above: this is the second, independent guarantee — `Node` itself has not grown, not just
/// that the tag is free relative to a comparison type that would grow right alongside it. 64-bit-host
/// only, like its sibling.
#[cfg(target_pointer_width = "64")]
const _: () = assert!(std::mem::size_of::<Node>() == 40);

impl LambdaTerm {
    /// The variant. Deliberately a method rather than a `Deref` impl: the indirection stays visible
    /// at every match site instead of being inferred, in exactly the code that most needs to read
    /// literally.
    #[must_use]
    pub fn node(&self) -> &Node {
        &self.0
    }

    /// The source construct this node was lowered from, if it is a tagged `App`.
    ///
    /// `None` for `Var`, `Abs`, and any `App` that no source construct owns — which is most of them in
    /// a real program, because `encode.rs` mints every combinator untagged. See design §5.1: `None` is
    /// the correct answer there, not a gap.
    #[must_use]
    pub fn owner(&self) -> Option<NodeId> {
        match self.node() {
            Node::App(_, _, owner) => *owner,
            Node::Var(_) | Node::Abs(_, _) => None,
        }
    }

    /// Allocation identity. Two terms sharing this ARE the same allocation WHILE BOTH ARE ALIVE, which
    /// is what makes structural sharing OBSERVABLE to a test rather than merely assumed from the type.
    /// Returns `usize` rather than a raw pointer so nothing can dereference it.
    ///
    /// THE LIVENESS QUALIFIER IS NOT A PEDANTRY. This is an allocation address, not a structural
    /// identity: once an allocation is freed the allocator may hand that exact address to a later,
    /// unrelated one, so an id compared against a term that has since died can match by coincidence
    /// rather than by fact. Any caller collecting these across a walk must keep the terms alive for the
    /// whole walk. `tests/lambda_sharing.rs:73-81` argues that hazard at length for the sharing gate,
    /// which is the in-tree consumer that depends on it.
    #[must_use]
    pub fn alloc_id(&self) -> usize {
        Rc::as_ptr(&self.0) as usize
    }

    /// The highest free de Bruijn index in this term, **plus one** — so `0` means the term is closed.
    /// Maintained in O(1) by the three constructors, never recomputed by a walk.
    ///
    /// The off-by-one encoding is what makes both short-circuits a single comparison rather than an
    /// `Option` match: `shift(d, cutoff, t)` is the identity exactly when `maxfree(t) <= cutoff`, and
    /// `subst(j, s, t)` is the identity exactly when `maxfree(t) <= j`. A plain "highest index" would
    /// need a separate "has no free variable" case for both.
    #[must_use]
    pub fn maxfree(&self) -> u32 {
        self.1
    }

    /// The depth of the tree this term DENOTES — the longest path from here to a leaf. O(1): the
    /// constructors carry it up, so this reads a field rather than walking anything.
    ///
    /// Saturating at `u32::MAX`, which is a FLOOR rather than a value: exact below the ceiling, and
    /// "at least that much" at it. A wrapping version would report a tiny depth for an enormous term
    /// and the guard reading it would admit exactly what it exists to refuse.
    #[must_use]
    pub fn depth(&self) -> u32 {
        self.2
    }
}

/// The number of nodes reached by walking BOTH children of every `App` — the size of the tree this
/// term DENOTES, as distinct from the DAG that stores it. Under structural sharing the two diverge
/// without bound: 9,541 allocations can denote 2^72 nodes.
///
/// **O(PHYSICAL), NOT O(LOGICAL), AND THAT IS THE WHOLE POINT.** Each allocation's size is computed
/// once and memoized by allocation identity, so a term denoting an astronomical number of nodes still
/// folds in microseconds. A version that walked the logical tree would BE the hang this measurement
/// exists to refuse — `logical_size_is_bounded_by_allocations_not_by_logical_nodes` is the test that
/// tells the two apart, and every other test here passes either way.
///
/// Iterative, over an explicit `(node, expanded)` stack: a walk added to prevent a stack overflow must
/// not overflow. Children are pushed after their parent's `expanded` marker, so LIFO ordering
/// guarantees every child is sized before the parent that reads it.
///
/// Saturating. The measured quantity reaches 2^72 and `u64` holds 2^64, so the result is a FLOOR:
/// exact below `u64::MAX`, and `u64::MAX` meaning "at least that much". Callers comparing against a
/// bound far below saturation are unaffected; anything wanting an exact count must check for
/// `u64::MAX` first.
#[must_use]
pub fn logical_size(t: &LambdaTerm) -> u64 {
    logical_sizes(t).get(&t.alloc_id()).copied().unwrap_or(u64::MAX)
}

/// Every allocation's logical size, memoized by allocation identity — the single fold behind both
/// `logical_size` and `max_shared_logical_size`, so the two cannot drift and neither pays O(physical)
/// more than once.
///
/// Iterative, over an explicit `(node, expanded)` stack: a walk added to prevent a stack overflow must
/// not overflow. Children are pushed after their parent's `expanded` marker, so LIFO ordering
/// guarantees every child is sized before the parent that reads it. Saturating, because the measured
/// quantity reaches 2^72 and `u64` holds 2^64.
fn logical_sizes(t: &LambdaTerm) -> HashMap<usize, u64> {
    let mut sizes: HashMap<usize, u64> = HashMap::new();
    let mut stack: Vec<(&LambdaTerm, bool)> = vec![(t, false)];
    while let Some((node, expanded)) = stack.pop() {
        let id = node.alloc_id();
        if sizes.contains_key(&id) {
            continue;
        }
        if !expanded {
            stack.push((node, true));
            match node.node() {
                Node::Var(_) => {}
                Node::Abs(_, b) => stack.push((b, false)),
                Node::App(f, a, _) => {
                    stack.push((f, false));
                    stack.push((a, false));
                }
            }
            continue;
        }
        // `child_size` cannot miss: the LIFO order above sizes every child before its parent's
        // `expanded` entry is popped. `u64::MAX` rather than `0` on the impossible branch because a
        // guard that UNDER-counts on a bug is a guard that does not guard — this fails toward refusing.
        let child_size = |c: &LambdaTerm| sizes.get(&c.alloc_id()).copied().unwrap_or(u64::MAX);
        let size = match node.node() {
            Node::Var(_) => 1,
            Node::Abs(_, b) => 1u64.saturating_add(child_size(b)),
            Node::App(f, a, _) => 1u64.saturating_add(child_size(f)).saturating_add(child_size(a)),
        };
        sizes.insert(id, size);
    }
    sizes
}

/// The largest logical size among subterms this term references MORE THAN ONCE.
///
/// **IN-DEGREE, NOT `Rc::strong_count`, and this is load-bearing.** In-degree counts references from
/// within this term. `strong_count` counts every live handle anywhere, so a caller retaining
/// snapshots — which `reduce_trace` does by contract — would inflate it, and the answer would depend
/// on who happened to be holding the term. A measurement whose value changes with observers cannot
/// gate anything.
///
/// Returns **0** when nothing is shared. That is the answer for every unshared term however large:
/// a 699-element list literal is ~497,691 logical nodes, reduces cleanly in 1,398 steps, and scores
/// 0 here. That property is why a guard on *sharing* was written to replace a guard on *total size* —
/// and then why it failed, since a term can be huge, unshared, and still cost 19 s in one β-step.
///
/// **A MEASUREMENT, NOT A GUARD, AND IT HAS NO IN-LIBRARY CALLER.** The guard that read it
/// (`MAX_SHARED_LOGICAL_NODES`, `LowerError::TooShared`) was reverted; nothing in `src/` calls this
/// today. It is kept `pub` deliberately, as the measurement surface the `examples/` probes and any
/// future guard need — an `examples/` target cannot reach a private item, and the investigation that
/// falsified the guard ran entirely through this function. Callers: `tests/guard_counterexamples.rs`,
/// `examples/guard_hole_probe.rs`, `examples/list_reduction_probe.rs`.
///
/// O(PHYSICAL): one walk for in-degree, one memoized fold for sizes, then a lookup per shared node.
/// Calling `logical_size` per shared node instead would be O(shared x physical) — quadratic on exactly
/// the terms this exists to measure. **Cost is stated in PHYSICAL size on purpose:** 92.6 ms optimized
/// on that 497,691-allocation list, against a `lower()` of 9.7 ms. "O(physical)" is the expensive case
/// for a term at a 1.000x ratio, not the cheap one.
#[must_use]
pub fn max_shared_logical_size(t: &LambdaTerm) -> u64 {
    let mut indeg: HashMap<usize, u32> = HashMap::new();
    let mut expanded: HashSet<usize> = HashSet::new();
    let mut stack: Vec<&LambdaTerm> = vec![t];
    while let Some(node) = stack.pop() {
        if !expanded.insert(node.alloc_id()) {
            continue; // already expanded; its outgoing edges were counted then
        }
        // Written out rather than via a closure: a closure capturing `indeg` mutably would hold that
        // borrow across the `stack.push` calls in the same arm, which is a needless fight with the
        // borrow checker in code whose whole job is to be obviously correct.
        match node.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => {
                *indeg.entry(b.alloc_id()).or_insert(0) += 1;
                stack.push(b);
            }
            Node::App(f, a, _) => {
                *indeg.entry(f.alloc_id()).or_insert(0) += 1;
                *indeg.entry(a.alloc_id()).or_insert(0) += 1;
                stack.push(f);
                stack.push(a);
            }
        }
    }
    let sizes = logical_sizes(t);
    indeg.iter().filter(|&(_, &c)| c > 1).filter_map(|(id, _)| sizes.get(id).copied()).max().unwrap_or(0)
}

/// A direction into a `LambdaTerm`; a `Path` locates a subterm (e.g. the reduced redex).
///
/// `Ord` is derived so a `Path` (`Vec<Dir>`) can key a `BTreeMap` — `print_lambda_linked` inverts a
/// `NodeId -> Path` map into a path-keyed lookup while walking. The ordering it induces (`AppL < AppR
/// < AbsBody`, declaration order) is otherwise arbitrary: nothing depends on how paths compare, only
/// on equality-based lookup.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Dir {
    AppL,
    AppR,
    AbsBody,
}

pub type Path = Vec<Dir>;

#[must_use]
pub fn var(i: u32) -> LambdaTerm {
    // `saturating_add` rather than `+ 1`: a `Var(u32::MAX)` is unreachable from lowering, and
    // saturating there fails toward "has a free variable", which is the side that does more work
    // rather than less. An overflow panic in a constructor would be the wrong trade.
    LambdaTerm(Rc::new(Node::Var(i)), i.saturating_add(1), 0)
}

pub fn abs(name: impl Into<Rc<str>>, body: LambdaTerm) -> LambdaTerm {
    // The binder consumes index 0, so every free index in the body is one lower out here. Saturating
    // is exact rather than defensive: a closed body is `0` and stays `0`.
    let maxfree = body.maxfree().saturating_sub(1);
    let depth = body.depth().saturating_add(1);
    LambdaTerm(Rc::new(Node::Abs(name.into(), body)), maxfree, depth)
}

#[must_use]
pub fn app(f: LambdaTerm, a: LambdaTerm) -> LambdaTerm {
    app_tagged(f, a, None)
}

/// `app`, carrying the Core node this application was lowered from.
///
/// Used only by `lower.rs`, and only at the sites where the `App` being built IS a Core node's own
/// root. `encode.rs` deliberately does not call this: a Church numeral's internal applications belong
/// to no source construct, and tagging them with the numeral's own id would claim they do.
#[must_use]
pub fn app_owned(f: LambdaTerm, a: LambdaTerm, owner: NodeId) -> LambdaTerm {
    app_tagged(f, a, Some(owner))
}

/// Rebuild an `App` carrying a tag that is already in hand. **This is the spine-rebuild constructor**,
/// used by `reduce_step` where `app_tagged`'s privacy does not reach; `shift`/`subst`/`beta_go` use
/// `app_tagged` directly because they live in this module.
#[must_use]
pub fn app_tagged_for_rebuild(f: LambdaTerm, a: LambdaTerm, owner: Option<NodeId>) -> LambdaTerm {
    app_tagged(f, a, owner)
}

/// The shared body. Private, because a caller passing `None` explicitly should call `app`, and the
/// two public constructors exist so the call sites read as tagged or untagged at a glance.
///
/// **ALSO THE PROPAGATION CONSTRUCTOR.** `shift`, `subst` and `beta_go` call this with the tag of the
/// node they are rebuilding, which is what makes the tag survive β. A rebuild that called `app`
/// instead would silently drop provenance on exactly the path this design exists to follow.
fn app_tagged(f: LambdaTerm, a: LambdaTerm, owner: Option<NodeId>) -> LambdaTerm {
    let maxfree = f.maxfree().max(a.maxfree());
    // The DEEPER child, not the sum: depth is the longest path, not a size.
    let depth = f.depth().max(a.depth()).saturating_add(1);
    LambdaTerm(Rc::new(Node::App(f, a, owner)), maxfree, depth)
}

/// Shift the free variables of `t` (those with index >= `cutoff`) by `d`.
///
/// # Panics
///
/// If a shifted index would go negative, **or if it would exceed `u32::MAX`.** `d` is signed and
/// `k: u32` (`Var`'s payload) carries no ceiling of its own, so both ends are checked.
///
/// **As of β-fusion (2026-08-03) NO NON-TEST CALL SITE IN THIS CRATE PASSES A NEGATIVE `d`.** `beta`'s
/// closing `shift(-1, 0, …)` was the only such caller; `beta_go` decrements in place, at `k > j >= 0`,
/// so the case is now impossible by branch rather than by check. **The qualifier is exact rather than
/// defensive** — this file's own `#[cfg(test)]` module still calls `shift(-1, 0, &var(0))`,
/// `shift(-1, 0, &var(3))` and `shift(-1, 5, &var(0))`, in
/// `shift_panics_instead_of_wrapping_to_a_dangling_index` and
/// `a_negative_shift_that_stays_in_range_is_fine`, which are precisely the tests that keep this
/// `# Panics` contract honest. A doc that said "nothing" would be falsified by `grep` from inside the
/// same file.
///
/// **THE UPPER BOUND — the public-API survey this doc used to defer.** `shift` is `pub`
/// (`redextape_core::lambda::term::shift`), and so is `var`, so an external caller can build
/// `var(u32::MAX)` directly and pass it here with no in-crate guard in between. Before this check, the
/// arithmetic was `(i64::from(*k) + d) as u32`: for `k = u32::MAX, d = 1` that computes
/// `4_294_967_296i64 as u32`, which WRAPS to `0` — a *different, wrong, silently-accepted* index rather
/// than a failure. The survey found no caller, in `src/`, `tests/*.rs` or `examples/*.rs`, that comes
/// anywhere near this boundary: every real `d` is in `{-1, 0, 1, 2, 3}` and every real `k` comes from a
/// lowered or hand-built term far below `u32::MAX`. **Narrowing `d`'s type would not have closed this
/// on its own** — the overflow is reachable from `k` alone (`var(u32::MAX)` plus `d = 1`) regardless of
/// what type bound `d` carries, because `Var`'s `u32` payload has no ceiling either. So the fix is the
/// same shape as the lower-bound check: prove the range, then convert with `u32::try_from` rather than
/// `as u32` — `cast_sign_loss`/`cast_possible_truncation` fire on the CAST EXPRESSION itself and do
/// **not** do value-range analysis on a preceding `assert!` (confirmed: pedantic still flagged the old
/// `as u32` cast with only the lower-bound assert in place). `unreachable!` in the `Err` arm rather than
/// `unwrap`/`expect` (denied in library code) or `panic!` (also denied): both asserts above already
/// proved `shifted` is in `0..=u32::MAX`, so that arm cannot run — it exists only so the conversion
/// typechecks without an `as` cast, and it still fails LOUD rather than silently if that ever changes.
///
/// **The asserts and the signed `d` stay, and not out of caution:** `shift` is `pub`,
/// `tests/subst_differential.rs` passes negative `d` deliberately, and the failure this guards is a
/// term full of dangling references that reduces to a wrong answer. A miscompile is worse than a crash.
///
/// **The lockstep argument the lower bound used to rest on is now internal to `beta_go`, not to this
/// function's relationship with `subst`.** Before fusion, `subst`'s `j + 1` and this function's
/// `cutoff + 1` stepped together under `Abs`, so the index `subst` replaced was exactly the one `beta`'s
/// closing call would decrement — two functions agreeing by construction, which a refactor could break
/// silently. `beta_go` now carries that same pairing (its own `j + 1` against `shift(1, 0, s)`) inside
/// one function, guarded by its own unconditional `assert!(*k > j, …)`. What keeps THIS function's
/// negative-index panic unreachable from compiled output is simpler and no longer a two-function
/// argument: nothing in `src/` calls `shift` with a negative `d` at all. Both checks stay unconditional
/// rather than `debug_assert!`, because `shift` is `pub` and a refactor can reintroduce a caller
/// silently. Measured cost in release of the lower-bound check alone: none — five runs put the guarded
/// version's range around the unguarded one (0.2078–0.2191s vs 0.2123–0.2151s for 2,000 shifts over a
/// 400-deep term), i.e. below run-to-run noise; the upper-bound check is the same shape of comparison
/// and is not expected to differ.
#[must_use]
pub fn shift(d: i64, cutoff: u32, t: &LambdaTerm) -> LambdaTerm {
    // Every free index in `t` is below `cutoff`, so no index is in range and this call is the
    // identity. Returning the handle preserves the ALLOCATION, which is the half that matters: the
    // rebuilt copy was always structurally equal, so `==` never noticed, and the cost stayed invisible
    // while sharing was silently destroyed on every β-step. See
    // `a_beta_step_is_bounded_by_allocations_not_by_logical_nodes`.
    if t.maxfree() <= cutoff {
        return t.clone();
    }
    match t.node() {
        // NO `else` ARM, AND THE SHORT-CIRCUIT ABOVE IS WHY. `maxfree(Var(k))` is `k + 1`, so this line
        // is reached only when `k + 1 > cutoff` — that is, `k >= cutoff` unconditionally. The
        // `else { var(*k) }` this used to carry became dead the moment the short-circuit landed, and
        // coverage confirmed it: a branch that cannot run is worse than no branch, because it reads as
        // a case someone considered.
        Node::Var(k) => {
            debug_assert!(
                *k >= cutoff,
                "the maxfree short-circuit should have returned for Var({k}) at cutoff {cutoff}"
            );
            let shifted = i64::from(*k) + d;
            assert!(shifted >= 0, "shift({d}, {cutoff}) produced a negative de Bruijn index from Var({k})");
            assert!(
                shifted <= i64::from(u32::MAX),
                "shift({d}, {cutoff}) produced a de Bruijn index above u32::MAX from Var({k})"
            );
            // `u32::try_from`, not `as u32`: see this function's doc for why the cast lints do not
            // see the two asserts above. `unreachable!` in the `Err` arm cannot fire — both asserts
            // already proved `shifted` is in `0..=u32::MAX` — and exists only so this typechecks
            // without an `as` cast, failing loud rather than silently if that ever stops holding.
            //
            // THE DUPLICATED RANGE CHECK IS DELIBERATE AND FORCED, not an oversight. The asserts and
            // the `try_from` test the same `0..=u32::MAX`. Neither mechanism can be dropped: without
            // the asserts the `Err` arm becomes reachable, so `unreachable!` would be a lie and the
            // descriptive message would have to move into `panic!`/`expect`, both denied by
            // `[workspace.lints.clippy]`; without the `try_from` an `as` cast remains, which
            // `pedantic` flags and which this fix was explicitly not permitted to `#[allow]`.
            //
            // Note what that leaves: `assert!` and `unreachable!` are panics in a `pub` library
            // path, and the manifest's five deny-lints reach NEITHER macro — so the "no library path
            // may panic" rule stated there is not mechanically enforced at this site. Closing that
            // for real means `shift` returning a typed `Err`, which ripples through `lower.rs` into
            // `redextape-wasm` and `redextape-native` for a boundary no real caller reaches. Left
            // open deliberately; see docs/superpowers/specs/2026-08-10-clippy-pedantic-design.md.
            var(u32::try_from(shifted).unwrap_or_else(|_| unreachable!("shift bound already checked above")))
        }
        Node::Abs(n, b) => abs(Rc::clone(n), shift(d, cutoff + 1, b)),
        Node::App(f, a, owner) => app_tagged(shift(d, cutoff, f), shift(d, cutoff, a), *owner),
    }
}

/// Substitute `s` for the variable with index `j` in `t`.
///
/// `j`/`s`/`t`, and the `k`/`n`/`b`/`f`/`a` the match arms below bind, are this module's standing
/// notation for de Bruijn substitution (`s` for the substituted term, `t` for the target, `j`/`k` for
/// indices) — the same letters the papers this module implements use. Renaming them to satisfy
/// `many_single_char_names` would make the code harder to check against that source material.
#[allow(clippy::many_single_char_names)]
#[must_use]
pub fn subst(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> LambdaTerm {
    // Index `j` cannot occur free in `t`, so there is nothing to replace.
    //
    // THIS CHECK IS ALSO WHAT STOPS THE `Abs` ARM SHIFTING FOR NOTHING, and that ordering is the
    // whole point rather than a side effect. That arm's `&shift(1, 0, s)` is an argument expression,
    // so Rust evaluates it BEFORE the recursive call that would discover the variable is absent —
    // which is exactly the "copies the whole argument once per `Abs` node in the body,
    // unconditionally" cost. Checking here, at the top, happens before that argument is built.
    //
    // For `t = Abs(_, b)` the condition is the same one the recursive call would apply: `maxfree(t)`
    // is `maxfree(b) - 1`, so `maxfree(t) <= j` iff `maxfree(b) <= j + 1`. Nothing is checked twice
    // and nothing is missed.
    if t.maxfree() <= j {
        return t.clone();
    }
    match t.node() {
        Node::Var(k) => {
            if *k == j {
                // A refcount bump, where under `Box` this deep-copied the whole substituted argument
                // once per occurrence. That single line is a large share of the win.
                s.clone()
            } else {
                // `k > j` here — `k < j` short-circuits above — so this variable is untouched and the
                // term is its own answer. `t.clone()` rather than `var(*k)`: the rebuilt node was
                // structurally identical, so this changes nothing except that it stops allocating.
                t.clone()
            }
        }
        Node::Abs(n, b) => abs(Rc::clone(n), subst(j + 1, &shift(1, 0, s), b)),
        Node::App(f, a, owner) => app_tagged(subst(j, s, f), subst(j, s, a), *owner),
    }
}

/// β-reduce `(\. abs_body) arg`: substitute `arg` for index 0 in `abs_body` and close the hole, in ONE
/// walk.
///
/// **This was three walks until 2026-08-03** — `shift(-1, 0, subst(0, shift(1, 0, arg), body))`, the
/// textbook de Bruijn formulation — and `Σ opening + Σ closing` was 18.0% of every allocation the
/// reducer made. The opening shift and the closing shift are an up-and-down pair that cancels on the
/// substituted argument: three passes build `shift(d+1, 0, arg)` at binder depth `d` and then decrement
/// it, where `beta_go` carries `shift(d, 0, arg)` and never builds the `+1`.
///
/// **The per-binder re-shift is deliberately NOT fused away, and WHICH quantity is smaller depends on
/// the corpus — do not read the family's answer as the general one.** Paying `shift(·, 0, arg)` once
/// per OCCURRENCE instead of once per binder crossed measures **1.5x worse on the nested-group family**
/// (`Σ reshift` 5,921 against `Σ per_occ` 8,881) and **5.6x BETTER on the 46-program corpus**
/// (`Σ reshift` 44,539 against `Σ per_occ` 7,944). The direction is not forced: `subst`'s `maxfree`
/// short-circuit descends only through the binders on the path to an occurrence, and whether that
/// leaves binders-crossed above or below occurrence-count is a property of the terms, not of the
/// algorithm.
///
/// The incremental form is kept anyway — it leaves `Σ reshift` untouched and so inherits none of the
/// falsified lifted-shift slice's risk, which is the reason of the two that does not depend on a
/// corpus. ~~binders crossed is the SMALLER quantity~~ was the first form of this comment and is the
/// family-only overgeneralisation the same branch struck from three other files; this copy, in shipped
/// library source, was missed until the whole-branch review. See
/// `docs/superpowers/specs/2026-08-02-lambda-beta-fusion-design.md`.
///
/// Equivalence to the three-pass form is exhaustive, not exemplary:
/// `tests/subst_differential.rs::the_shipped_beta_agrees_with_the_three_pass_formulation_on_every_enumerated_pair`.
#[must_use]
pub fn beta(abs_body: &LambdaTerm, arg: &LambdaTerm) -> LambdaTerm {
    // `arg`, NOT `shift(1, 0, arg)` — see the doc above.
    beta_go(abs_body, 0, arg)
}

/// One walk of `beta`: substitute `s` for index `j`, decrement every free index above `j`.
///
/// `s` is `arg` lifted by `j`, maintained by the `Abs` arm exactly as `subst`'s is — which is why
/// `Σ reshift` is unchanged by fusion, and `shift(1, 0, s)` short-circuits to a refcount bump on the
/// 88.4% of corpus steps whose argument is closed either way.
///
/// Same single-letter notation as `subst` (`j`/`s`/`t`, plus the match arms' `k`/`n`/`b`/`f`/`a`) for
/// the same reason: it matches the papers this module implements.
#[allow(clippy::many_single_char_names)]
fn beta_go(t: &LambdaTerm, j: u32, s: &LambdaTerm) -> LambdaTerm {
    // `subst`'s short-circuit, and simultaneously the closing shift's: every free index in `t` is below
    // `j`, so there is nothing to substitute AND nothing to decrement. Returning the handle preserves
    // the ALLOCATION, which is what `a_beta_step_is_bounded_by_allocations_not_by_logical_nodes` pins.
    if t.maxfree() <= j {
        return t.clone();
    }
    match t.node() {
        // NO THIRD ARM, and the argument is `shift`'s verbatim: `maxfree(Var(k))` is `k + 1`, so this
        // is reached only when `k + 1 > j`, i.e. `k >= j` unconditionally. `k < j` cannot arrive here.
        Node::Var(k) => {
            if *k == j {
                // A refcount bump. `subst`'s hit arm, unchanged.
                s.clone()
            } else {
                // `k > j`, hence `k >= 1`, so the subtraction cannot underflow — by the branch rather
                // than by a check. This is the node the closing `shift(-1, 0, ·)` used to allocate.
                //
                // **THE CHECK IS UNCONDITIONAL, AND THAT IS `shift`'s POLICY RATHER THAN CAUTION HERE.**
                // A `debug_assert!` was the first shape of this and it is the trade `shift`'s own doc
                // block explicitly refuses: this workspace sets no `[profile]` overrides, so a release
                // build has neither debug assertions nor overflow checks, and a `k < j` arriving from a
                // wrong `maxfree` would WRAP to `u32::MAX` — a term full of dangling references that
                // reduces to a wrong answer, rather than an error. A miscompile is worse than a crash,
                // and `shift` measured its equivalent unconditional check at below run-to-run noise.
                //
                // The invariant it guards is not local: `maxfree(Var(k))` is `k + 1`, so the prune above
                // returns for every `k < j` — including at the `saturating_add` ceiling, where
                // `maxfree` saturates at `u32::MAX` and the prune still fires for any `j` below it.
                // That reasoning spans two functions, which is exactly when a check earns its keep.
                // Asserting `*k > j` rather than `*k != 0` on purpose: `checked_sub` would catch only
                // the underflow at `k == 0` and would silently emit a wrong index for any other
                // `k < j`. The branch invariant is the thing worth guarding, and it implies `k >= 1`.
                assert!(*k > j, "beta_go reached Var({k}) at index {j}; the maxfree prune should have returned");
                var(*k - 1)
            }
        }
        Node::Abs(n, b) => abs(Rc::clone(n), beta_go(b, j + 1, &shift(1, 0, s))),
        Node::App(f, a, owner) => app_tagged(beta_go(f, j, s), beta_go(a, j, s), *owner),
    }
}

impl PartialEq for LambdaTerm {
    fn eq(&self, other: &Self) -> bool {
        // Pointer equality implies structural equality: an allocation cannot differ from itself.
        // This is the fast path structural sharing exists to enable — after a β-step, most of the
        // new term IS the old term, so most comparisons short-circuit at the first node.
        // Three tests below split that claim, because no one of them carries it alone.
        // `ptr_eq_short_circuits_without_changing_the_answer` proves AGREEMENT — the fast path never
        // disagrees with the structural walk it bypasses — but it clones hand-built terms, so it says
        // nothing about whether the reducer ever produces the shape. What proves FIRING on real terms
        // is `a_beta_step_inherits_the_untouched_sibling_allocation` (one β-step physically inherits
        // its untouched sibling) and `a_real_multi_step_reduction_still_shares_allocations_across_steps`
        // (the same over a whole `reduce_trace` of Church `2 + 3`, so it is not an artifact of a
        // minimal example).
        if Rc::ptr_eq(&self.0, &other.0) {
            return true;
        }
        match (self.node(), other.node()) {
            (Node::Var(a), Node::Var(b)) => a == b,
            (Node::Abs(_, a), Node::Abs(_, b)) => a == b, // name hint ignored
            (Node::App(f1, a1, _), Node::App(f2, a2, _)) => f1 == f2 && a1 == a2, // owner ignored
            _ => false,
        }
    }
}

impl Eq for LambdaTerm {}

/// Hand-written iterative destructor: a deep term (large lowering / reduction growth) would otherwise
/// recurse once per node in the compiler-generated `drop_in_place` and abort the process.
///
/// THE FIRST GUARD IS WHAT STRUCTURAL SHARING ADDS, and it is the whole difference from the `Box`
/// version. Dropping a handle is a decrement; only the LAST handle frees anything, so every other
/// drop must leave the term completely alone. `Rc::get_mut` below enforces that on its own, which
/// makes this check redundant for CORRECTNESS and load-bearing for COST: the overwhelmingly common
/// drop in the reducer is of a clone that is not the last one, and without this it would allocate a
/// placeholder and walk an empty worklist every time.
///
/// THE SECOND GUARD IS WHAT MAKES THIS TERMINATE AT ALL. `blank` is itself a `Var` handle, so its own
/// drop re-enters this function; allocating the placeholder before checking for a leaf recurses
/// forever on the placeholder alone — the very first `drop(var(0))` overflows the stack. A `Var` has
/// no children, so returning early leaves the compiler's field glue nothing to descend into.
///
/// ON `LambdaTerm`, NOT ON `Node`, and the two are not interchangeable. A `Node`-level `Drop` cannot
/// keep the placeholder to itself: every node taken off the worklist is then a `Node` value whose own
/// destructor runs when the iteration ends, so each one allocates a placeholder of its own (O(nodes),
/// which is what the `Box` version cost) and the placeholder's own teardown re-enters the same
/// destructor. Keeping `Node` free of `Drop` is also what lets `Rc::into_inner`'s result be
/// destructured BY VALUE below — moving a field out of a `Drop` type does not compile.
///
/// So `blank` is allocated ONCE per teardown and cloned (a refcount bump) into the ROOT's child slots
/// only; below the root nothing is replaced at all, because the children move straight out of the
/// returned `Node` onto the worklist. `into_inner` returning `Some` exactly when the popped handle was
/// the last one is also what keeps a SHARED graph iterative: the earlier handles decrement to `None`,
/// and the one that finally reaches zero continues this same loop instead of recursing through glue.
impl Drop for LambdaTerm {
    fn drop(&mut self) {
        if Rc::strong_count(&self.0) != 1 {
            return;
        }
        if matches!(*self.0, Node::Var(_)) {
            return;
        }
        let blank = var(0);
        let mut stack: Vec<LambdaTerm> = Vec::new();
        // Unlink the root's children so the drop glue that runs after this function returns has
        // nothing to descend into. `get_mut` is `Some`: the strong count is 1 (checked above) and no
        // `Weak` handle to a term is ever created.
        if let Some(root) = Rc::get_mut(&mut self.0) {
            match root {
                Node::Abs(_, b) => stack.push(std::mem::replace(b, blank.clone())),
                Node::App(f, a, _) => {
                    stack.push(std::mem::replace(f, blank.clone()));
                    stack.push(std::mem::replace(a, blank.clone()));
                }
                Node::Var(_) => {}
            }
        }
        while let Some(mut t) = stack.pop() {
            // Swap the placeholder in and consume the `Rc` that comes out: `LambdaTerm` implements
            // `Drop`, so `t.0` cannot be moved out of it directly. `t` is left holding `blank`, whose
            // strong count exceeds one for as long as this function runs, so dropping `t` at the end
            // of the iteration takes the first guard's early return.
            let rc = std::mem::replace(&mut t.0, Rc::clone(&blank.0));
            if let Some(node) = Rc::into_inner(rc) {
                match node {
                    Node::Abs(_, b) => stack.push(b),
                    Node::App(f, a, _) => {
                        stack.push(f);
                        stack.push(a);
                    }
                    Node::Var(_) => {}
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_is_untagged_and_app_owned_carries_its_node() {
        let plain = app(abs("x", var(0)), var(0));
        assert_eq!(plain.owner(), None, "`app` must not invent a provenance tag");

        let tagged = app_owned(abs("x", var(0)), var(0), 7);
        assert_eq!(tagged.owner(), Some(7), "`app_owned` must carry the NodeId it was given");

        // A non-App node has no owner and must not pretend otherwise.
        assert_eq!(var(0).owner(), None);
        assert_eq!(abs("x", var(0)).owner(), None);
    }

    #[test]
    fn alpha_equality_ignores_name_hints() {
        // \x. x  ==  \y. y   (both are Abs(_, Var(0)))
        assert_eq!(abs("x", var(0)), abs("y", var(0)));
        // \x. x  !=  \x. \y. x
        assert_ne!(abs("x", var(0)), abs("x", abs("y", var(1))));
    }

    #[test]
    fn shift_adjusts_free_but_not_bound_vars() {
        // shift(1, 0, \.0 1) == \.0 2   (0 is bound, 1 is free -> becomes 2)
        let t = abs("x", app(var(0), var(1)));
        assert_eq!(shift(1, 0, &t), abs("x", app(var(0), var(2))));
    }

    #[test]
    fn beta_reduces_identity_application() {
        // (\x. x) (\y. y)  ->  \y. y
        let id = abs("y", var(0));
        let redex_body = var(0); // body of (\x. x)
        assert_eq!(beta(&redex_body, &id), id);
    }

    /// The guard in `shift` fires rather than wrapping. Unreachable from compiled output — the lowering
    /// emits closed terms and `parse_lambda` rejects free variables — but `shift` is `pub`, so a caller
    /// can reach it directly, and this is what makes the guard falsifiable rather than decorative.
    ///
    /// Without it, `(i64::from(0) + -1) as u32` is 4_294_967_295: a dangling index that reduces on to a
    /// wrong answer instead of failing. Deleting the `assert!` makes this test the only thing in the
    /// tree that notices.
    #[test]
    #[should_panic(expected = "negative de Bruijn index")]
    fn shift_panics_instead_of_wrapping_to_a_dangling_index() {
        let _ = shift(-1, 0, &var(0));
    }

    /// The neighbouring case must still work: a negative shift that stays non-negative is ordinary and
    /// is what `beta` relies on, so the guard must not be over-tight.
    #[test]
    fn a_negative_shift_that_stays_in_range_is_fine() {
        assert_eq!(shift(-1, 0, &var(3)), var(2));
        // Below the cutoff the index is bound, so it is untouched and cannot go negative.
        assert_eq!(shift(-1, 5, &var(0)), var(0));
    }

    /// **THE UPPER-BOUND SIBLING OF `shift_panics_instead_of_wrapping_to_a_dangling_index`, AND THE ONE
    /// THAT DEMONSTRATES THE FIX RATHER THAN THE PRE-EXISTING GUARD.** `var` is `pub` with no ceiling on
    /// its `u32` payload, and `shift` is `pub`, so an external caller can build `var(u32::MAX)` directly
    /// and shift it past `u32::MAX` with nothing in between to stop it.
    ///
    /// Before the upper-bound `assert!` this test is pinning, the arithmetic was
    /// `(i64::from(u32::MAX) + 1) as u32` — `4_294_967_296i64 as u32`, which truncates to `0`. That is
    /// `Var(0)`, a DIFFERENT and WRONG index accepted silently, not a failure: this test fails (does not
    /// panic) against that code, which is what proves it exercises the boundary rather than merely
    /// restating that ordinary shifts still work.
    #[test]
    #[should_panic(expected = "above u32::MAX")]
    fn shift_panics_instead_of_wrapping_a_de_bruijn_index_above_u32_max() {
        let _ = shift(1, 0, &var(u32::MAX));
    }

    /// The neighbouring case must still work: landing EXACTLY on `u32::MAX` is in range and must not
    /// panic, so the new upper-bound guard must not be off-by-one in the tight direction.
    #[test]
    fn a_shift_that_lands_exactly_on_u32_max_is_fine() {
        assert_eq!(shift(0, 0, &var(u32::MAX)), var(u32::MAX));
    }

    /// **THE UNDERFLOW IS UNREACHABLE BY BRANCH AND ENFORCED BY CHECK, AND THIS IS WHAT REACHES THE
    /// BRANCH AT ALL.** `beta_go` reaches `var(*k - 1)` only when `k > j >= 0`, so `k >= 1` and the
    /// subtraction cannot underflow — that much is structural. But structural is a property of the code
    /// as written, not of the code as edited, so the arm also carries an unconditional
    /// `assert!(*k > j, …)`: this workspace sets no `[profile]` overrides, and in release a wrong
    /// `maxfree` would otherwise wrap to `u32::MAX` with neither debug assertions nor overflow checks to
    /// stop it. That is the same trade `shift`'s own doc block makes and for the same stated reason —
    /// "a miscompile is worse than a crash".
    ///
    /// ~~Fusion does not weaken that guarantee; it makes it structural.~~ **Corrected 2026-08-03:** the
    /// first version of this arm used a `debug_assert!` and that sentence was written for it, which made
    /// the guarantee weaker in release than the `shift` call it replaced rather than stronger.
    ///
    /// ~~What this test contributes is that it is the only case in the suite that reaches `k = j + 1`.~~
    /// **Corrected again, same day, and the second correction was checked rather than reasoned:**
    /// making the decrement arm panic on `k == j + 1` fails **15 tests across 7 targets** — the lib
    /// target's `lower::arithmetic_matches_the_reference`, `lower::recursion_via_fix`,
    /// `reduce::church_arithmetic_normalizes`,
    /// `trace::lambda_cursor_emits_the_same_redex_paths_as_reduce_trace` and this one; both β tests in
    /// `tests/subst_differential.rs`; every oracle (`three_way_oracle`'s three,
    /// `lambda_oracle`'s two, the two `four_way_oracle` rows); `zipper_equivalence`'s two; and
    /// `lambda_sharing`'s `reduce_trace_shares_its_snapshots`. **The count was wrong twice before
    /// this** — "five in the lib target" was measured with `cargo test`'s default fail-fast, which
    /// stops at the first failing target, so it was a floor reported as a total. Run it with
    /// `--no-fail-fast` or do not quote a number. What is true is narrower: **this is the only test that
    /// reaches the case deliberately and in isolation.** The corpus tests reach it incidentally, so a
    /// break in the decrement arm fails them for reasons that take a trace to localise, where this one
    /// names the case in its title. That is the whole of its value, and it is worth having.
    #[test]
    fn beta_decrements_a_free_index_directly_above_the_binder() {
        // Body `\y. (0 1)` under the redex binder: index 1 is the binder's own variable seen from inside
        // `y`, and index 2 is one above it — the `k = j + 1` case at `j = 1`.
        let body = abs("y", app(var(1), var(2)));
        let arg = var(7);
        assert_eq!(beta(&body, &arg), abs("y", app(var(7 + 1), var(1))));
    }

    #[test]
    fn beta_reduces_const_application() {
        // (\x. \y. x) a  ->  \y. a   (a is a free var, index 0 outside)
        let body = abs("y", var(1)); // \y. x  where x is index 1
        let arg = var(5);
        // substituting arg for the outer binder: \y. (shifted arg)
        assert_eq!(beta(&body, &arg), abs("y", var(6)));
    }

    /// The `ptr_eq` short-circuit fires on real reduction output, and agrees with the structural
    /// answer wherever both apply. Two halves, because either alone is worthless: a fast path that
    /// never fires is dead code, and one that fires but disagrees is a miscompile.
    #[test]
    fn ptr_eq_short_circuits_without_changing_the_answer() {
        // Shared: the SAME allocation on both sides. Structurally equal too, so the fast path and
        // the slow path must agree.
        let shared = abs("x", app(var(0), var(1)));
        let a = shared.clone();
        let b = shared.clone();
        assert_eq!(a.alloc_id(), b.alloc_id(), "clone must share the allocation, not copy it");
        assert_eq!(a, b);

        // Structurally equal but SEPARATELY BUILT: different allocations, so the fast path cannot
        // fire and the structural walk must still say equal. This is the case interning would
        // collapse and `Rc` cannot.
        let c = abs("x", app(var(0), var(1)));
        assert_ne!(shared.alloc_id(), c.alloc_id(), "separately built terms are separate allocations");
        assert_eq!(shared, c);

        // Different terms stay different — the fast path must not make everything equal.
        assert_ne!(shared, abs("x", app(var(1), var(0))));
    }

    /// A β-step physically inherits the untouched sibling: that is the property the whole
    /// representation exists for, and it is what makes the `ptr_eq` path fire in the reducer rather
    /// than only in a hand-built test.
    #[test]
    fn a_beta_step_inherits_the_untouched_sibling_allocation() {
        use crate::lambda::reduce::reduce_step;
        // ((\x. x) y) sibling — the redex is on the LEFT, so `sibling` must survive by identity.
        let sibling = abs("s", app(var(0), var(0)));
        let redex = app(abs("x", var(0)), var(7));
        let t = app(redex, sibling.clone());

        let (next, _path, _owner) = reduce_step(&t).expect("a redex exists");
        let Node::App(_, inherited, _) = next.node() else { panic!("expected an App at the root") };
        assert_eq!(
            inherited.alloc_id(),
            sibling.alloc_id(),
            "the untouched sibling must be inherited by identity, not rebuilt"
        );
    }

    /// **THE MECHANISM BEHIND β-FUSION'S SHARING WIN, PINNED AS A MECHANISM RATHER THAN AS A NUMBER.**
    /// `tests/lambda_sharing.rs` pins the consequence — 17,920 and 4,305 distinct allocations — but a
    /// pinned count says only that something moved, not what. This says what: N occurrences of the bound
    /// variable at ONE binder depth must come back as N handles on ONE allocation.
    ///
    /// The three-pass `beta` this replaced could not do that. Its closing `shift(-1, 0, ·)` walked
    /// `subst`'s result as a TREE — `shift` does not memoise — so it descended into each of the N
    /// occurrences separately and rebuilt N independent copies, flattening the DAG `subst` had just
    /// built. Restoring `shift(-1, 0, &subst(0, &shift(1, 0, arg), abs_body))` turns this test RED,
    /// which is the only reason to trust it: the counts in `lambda_sharing.rs` would also move, but
    /// they would not say why.
    ///
    /// THE ARGUMENT MUST BE OPEN AND THE ASSERT BELOW ENFORCES IT. For a CLOSED argument both
    /// formulations share — `shift(1, 0, arg)` is a refcount bump and the closing shift's own `maxfree`
    /// prune returns the handle — so the same test written with a closed argument passes against both
    /// and pins nothing at all.
    #[test]
    fn a_beta_step_shares_one_allocation_across_every_occurrence_of_an_open_argument() {
        use crate::lambda::reduce::reduce_step;
        // OPEN: free indices 3, 4 and 5 survive the step, so neither shift can short-circuit on it.
        let arg = app(var(3), app(var(4), var(5)));
        assert!(arg.maxfree() > 0, "an open argument is the whole point — a closed one pins nothing");

        // (\x. x x) arg — two occurrences of index 0, both at binder depth 0.
        let t = app(abs("x", app(var(0), var(0))), arg.clone());
        let (next, _path, _owner) = reduce_step(&t).expect("a redex exists");

        let Node::App(l, r, _) = next.node() else { panic!("expected an App at the root") };
        assert_eq!(
            l.alloc_id(),
            r.alloc_id(),
            "both occurrences must be handles on ONE allocation, not two structurally equal copies"
        );
        // And that one allocation is the CALLER's own `arg`, not a copy of a copy: at depth 0 the fused
        // walk hands `arg` straight through, where three passes shifted it up and back down again.
        assert_eq!(l.alloc_id(), arg.alloc_id(), "the argument must be inherited by identity, not rebuilt");

        // The step is still the right term — sharing that changed the answer would be a miscompile.
        assert_eq!(next, app(arg.clone(), arg.clone()));

        // ------------------------------------------------------------------------------------------
        // **AND THE SAME PROPERTY AT BINDER DEPTH >= 1, WHICH IS A SEPARATE CLAIM AND THE ONE A
        // DEPTH-0-ONLY TEST MISSES.** The two assertions above are not independent at depth 0 —
        // inheriting `arg` by identity implies the two occurrences agree — so alone they pin only the
        // handing-through, and a `beta` that shares at depth 0 while rebuilding once per occurrence
        // deeper passes every other unit test in this file while moving
        // `tests/lambda_sharing.rs`'s gates by 184 and 3 allocations. That variant was built and run;
        // this block is what catches it.
        //
        // At depth >= 1 the substituted term is NOT `arg` — it is `shift(1, 0, arg)`, which the `Abs`
        // arm builds once and then hands to both occurrences. So the claim inverts: the two must be one
        // allocation, and that allocation must NOT be `arg`. Three passes fail this because the closing
        // `shift(-1, 1, ·)` descends into each occurrence separately and rebuilds each.
        let deep = app(abs("x", abs("y", app(var(1), var(1)))), arg.clone());
        let (next_deep, _path, _owner) = reduce_step(&deep).expect("a redex exists");

        let Node::Abs(_, inner) = next_deep.node() else { panic!("expected an Abs at the root") };
        let Node::App(dl, dr, _) = inner.node() else { panic!("expected an App under the binder") };
        assert_eq!(
            dl.alloc_id(),
            dr.alloc_id(),
            "under a binder the two occurrences must still be ONE allocation, not one lift apiece"
        );
        assert_ne!(
            dl.alloc_id(),
            arg.alloc_id(),
            "at depth >= 1 the shared allocation is the LIFTED argument — identity with `arg` here \
             would mean the lift was skipped, which is a wrong answer rather than better sharing"
        );
        assert_eq!(next_deep, abs("y", app(shift(1, 0, &arg), shift(1, 0, &arg))));
    }

    /// The prior test pins the mechanism on one hand-built redex; this pins it over a full
    /// `reduce_trace` of a real multi-step program — Church `2 + 3`, the same term `reduce.rs`'s own
    /// `church_arithmetic_normalizes` reduces — so the property is not an artifact of a minimal example.
    ///
    /// Not every step qualifies: a step only has a sibling to inherit where its redex path passes
    /// through an `App` (`AppL`/`AppR`), because that is the only node shape with two children. A path
    /// of only `AbsBody`s (an `Abs` has one child) or the empty path (the whole term is the redex, so
    /// nothing survives it) has no sibling to check, and this corpus program hits both: step 3 below is
    /// `[AbsBody, AbsBody]`, discovered by running this test before this comment existed.
    #[test]
    fn a_real_multi_step_reduction_still_shares_allocations_across_steps() {
        use crate::lambda::encode::{church, plus};
        use crate::lambda::reduce::{MAX_REDUCTION_STEPS, reduce_trace};
        use std::collections::HashSet;

        fn alloc_ids(t: &LambdaTerm, out: &mut HashSet<usize>) {
            out.insert(t.alloc_id());
            match t.node() {
                Node::Var(_) => {}
                Node::Abs(_, b) => alloc_ids(b, out),
                Node::App(f, a, _) => {
                    alloc_ids(f, out);
                    alloc_ids(a, out);
                }
            }
        }

        let t = app(app(plus(), church(2)), church(3));
        let trace = reduce_trace(&t, MAX_REDUCTION_STEPS);
        assert!(trace.steps.len() > 1, "a multi-step reduction is the whole point of this test");

        let mut inheriting_steps = 0usize;
        let mut app_branching_steps = 0usize;
        for (i, step) in trace.steps.iter().enumerate() {
            if !step.redex.iter().any(|d| matches!(d, Dir::AppL | Dir::AppR)) {
                continue; // no App branch on the path to this redex, so no sibling exists to inherit
            }
            app_branching_steps += 1;
            let after = trace.steps.get(i + 1).map_or(&trace.normal_form, |s| &s.term);
            let mut before_ids = HashSet::new();
            alloc_ids(&step.term, &mut before_ids);
            let mut after_ids = HashSet::new();
            alloc_ids(after, &mut after_ids);
            if before_ids.intersection(&after_ids).next().is_some() {
                inheriting_steps += 1;
            }
        }
        assert!(app_branching_steps > 0, "expected at least one step whose redex path branches through an App");
        assert_eq!(
            inheriting_steps, app_branching_steps,
            "every step whose redex path passes through an App must inherit at least one allocation \
             from its predecessor — that shared allocation is exactly what makes `==` take the \
             `ptr_eq` path"
        );
    }

    /// Exact small cases, countable by eye. A tree with no sharing has logical size == node count.
    #[test]
    fn logical_size_counts_the_denoted_tree() {
        assert_eq!(logical_size(&var(0)), 1);
        assert_eq!(logical_size(&abs("x", var(0))), 2);
        assert_eq!(logical_size(&app(var(0), var(1))), 3);
        assert_eq!(logical_size(&abs("x", app(var(0), var(0)))), 4);
    }

    /// A shared child is counted ONCE PER EDGE, not once per allocation — that is the entire
    /// distinction being measured. `c = app(c.clone(), c)` applied n times is n+1 allocations
    /// denoting 2^(n+1) - 1 nodes.
    #[test]
    fn logical_size_counts_shared_subterms_once_per_edge() {
        let mut c = var(0);
        for n in 0..12u32 {
            assert_eq!(logical_size(&c), (1u64 << (n + 1)) - 1, "at depth {n}");
            c = app(c.clone(), c);
        }
    }

    /// THE ONE THAT MATTERS. The fold must be O(physical), so a term denoting 2^10001 nodes must
    /// still measure instantly. A fold that walked the logical tree would pass every test above and
    /// hang here — which is precisely the failure this whole slice exists to refuse.
    ///
    /// Saturation is the expected answer, not a defect: `u64` holds 2^64 and this denotes 2^10001.
    #[test]
    fn logical_size_is_bounded_by_allocations_not_by_logical_nodes() {
        let mut c = var(0);
        for _ in 0..10_000 {
            c = app(c.clone(), c);
        }
        assert_eq!(logical_size(&c), u64::MAX, "an astronomically large term saturates");
    }

    /// `parse_lambda` builds fresh nodes with no sharing, so a parsed term's logical size equals its
    /// allocation count. Design §9 argued this rather than testing it; this is the test.
    #[test]
    fn a_parsed_term_has_no_sharing() {
        let (t, ds) = crate::lambda::parse_lambda("\\f. \\x. f (f (f x))");
        assert!(ds.is_empty(), "diagnostics: {ds:?}");
        let t = t.expect("parses");
        let mut seen = std::collections::HashSet::new();
        let mut stack = vec![&t];
        while let Some(n) = stack.pop() {
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
        assert_eq!(logical_size(&t), seen.len() as u64, "a parsed term must have no shared allocations");
    }

    /// An unshared term has no shared subterm at all, so the answer is 0 — not "small", zero. Written
    /// when a guard read this number, where it was what made that guard SILENT on large unshared
    /// programs rather than merely lenient toward them. **Both guards are gone**, and zero-not-small
    /// is now the property that killed the second one: the 699-element list and the 4,821-byte
    /// two-list program are both essentially unshared, so a bound here cannot see either of them.
    /// See `crates/redextape-core/tests/guard_counterexamples.rs`.
    #[test]
    fn an_unshared_term_has_no_shared_subterm() {
        assert_eq!(max_shared_logical_size(&var(0)), 0);
        assert_eq!(max_shared_logical_size(&abs("x", var(0))), 0);
        assert_eq!(max_shared_logical_size(&app(var(0), var(1))), 0);
        // Structurally identical but SEPARATELY BUILT children are two allocations, not one.
        assert_eq!(max_shared_logical_size(&app(abs("x", var(0)), abs("x", var(0)))), 0);
    }

    /// One allocation referenced twice is shared, and it is reported at its FULL logical size —
    /// because that is what this measurement is defined to report, an in-degree > 1 allocation counted
    /// once at its whole denoted size.
    ///
    /// ~~"the quantity `subst` pays per occurrence it substitutes into"~~ — **that was the reason
    /// given, and it is false.** `subst`'s `Var` arm is `s.clone()`, a refcount bump, so occurrences
    /// are FREE; its `Abs` arm re-shifts the whole argument once per `Abs` node in the body,
    /// unconditionally. A β-step costs `|body| + Abs(body) × |arg|` and this number is neither factor.
    /// The assertion below is unchanged and still correct — only its justification was wrong. Record:
    /// `docs/superpowers/specs/2026-07-31-lambda-shared-subterm-guard-design.md` §10.2.
    #[test]
    fn a_subterm_referenced_twice_is_reported_at_full_size() {
        let c = abs("x", app(var(0), var(0))); // logical size 4
        assert_eq!(logical_size(&c), 4);
        assert_eq!(max_shared_logical_size(&app(c.clone(), c)), 4);
    }

    /// The MAXIMUM over shared subterms, not the first or the sum. A small shared node must not mask a
    /// large one.
    #[test]
    fn the_largest_shared_subterm_wins() {
        let small = abs("s", var(0)); // 2
        let large = abs("l", app(app(var(0), var(0)), app(var(0), var(0)))); // 8
        assert_eq!(logical_size(&small), 2);
        assert_eq!(logical_size(&large), 8);
        let t = app(app(small.clone(), small), app(large.clone(), large));
        assert_eq!(max_shared_logical_size(&t), 8);
    }

    /// THE ONE THAT MATTERS. Like `logical_size`, this must be O(PHYSICAL). A term denoting 2^10001
    /// nodes is 10,001 allocations, every one of them shared — so a version that re-folds per shared
    /// node is quadratic, and one that walks logically never returns. Both pass every test above.
    #[test]
    fn max_shared_is_bounded_by_allocations_not_by_logical_nodes() {
        let mut c = var(0);
        for _ in 0..10_000 {
            c = app(c.clone(), c);
        }
        // Every level shares its child with itself, so the largest shared subterm is the one directly
        // below the root — saturating, exactly as `logical_size` does.
        assert_eq!(max_shared_logical_size(&c), u64::MAX);
    }

    /// Distinct allocations reachable from `t`. Local to the tests: `examples/blowup_probe.rs` has the
    /// same walk, but an `examples/` target and a unit test cannot share a private helper.
    fn physical(t: &LambdaTerm) -> usize {
        let mut seen: HashSet<usize> = HashSet::new();
        let mut stack: Vec<&LambdaTerm> = vec![t];
        while let Some(n) = stack.pop() {
            if !seen.insert(n.alloc_id()) {
                continue;
            }
            match n.node() {
                Node::Var(_) => {}
                Node::Abs(_, b) => stack.push(b),
                Node::App(f, a, _) => {
                    stack.push(f);
                    stack.push(a);
                }
            }
        }
        seen.len()
    }

    /// `shift` is the IDENTITY on a term with no free index at or above the cutoff, so it must return
    /// that term's allocation rather than a copy of it.
    ///
    /// Stated on `alloc_id` rather than on `==`, because `==` passed the whole time: the rebuilt copy
    /// is structurally equal to what it replaced, which is exactly why this cost stayed invisible. A
    /// closed term is the common case in compiled output — every encoded value, every lowered
    /// function — and `beta` shifts its argument on every single β-step.
    #[test]
    fn shift_of_a_closed_term_returns_the_same_allocation() {
        let closed = abs("x", abs("y", app(var(1), var(0))));
        assert_eq!(shift(1, 0, &closed).alloc_id(), closed.alloc_id());
        // Also at a cutoff above the free indices, which is the general form of the same fact.
        let free_at_2 = abs("x", var(3)); // one free index, 2 once the binder is accounted for
        assert_eq!(shift(1, 3, &free_at_2).alloc_id(), free_at_2.alloc_id());
    }

    /// The neighbouring case must still move: a free index AT the cutoff is shifted, so the result is
    /// a different term and necessarily a different allocation. Without this, "return `t` always"
    /// passes the test above.
    #[test]
    fn shift_still_moves_a_free_index_at_the_cutoff() {
        assert_eq!(shift(1, 0, &var(0)), var(1));
        // Under the binder the cutoff is 2, so `Var(2)` is free and moves; `Var(1)` would not.
        assert_eq!(shift(2, 1, &abs("x", var(2))), abs("x", var(4)));
    }

    /// `subst` has nothing to do when the index it replaces cannot occur, and must say so by returning
    /// the same allocation. `maxfree(t) <= j` is the test: every free index in `t` is below `j`.
    #[test]
    fn subst_of_an_absent_index_returns_the_same_allocation() {
        let target = abs("x", app(var(0), var(1))); // free index 0 outside the binder
        let s = abs("s", var(0));
        // Index 1 does not occur free in `target`, so this is a no-op.
        assert_eq!(subst(1, &s, &target).alloc_id(), target.alloc_id());
    }

    /// The neighbouring case: an index that DOES occur is replaced.
    #[test]
    fn subst_still_replaces_an_index_that_occurs() {
        let s = abs("s", var(0));
        assert_eq!(subst(0, &s, &var(0)), s);
        assert_eq!(subst(0, &s, &app(var(0), var(1))), app(s.clone(), var(1)));
    }

    /// `depth` must be O(1) to read and O(PHYSICAL) to establish — a term denoting 2^10001 nodes is
    /// 10,001 allocations, and anything that walks the denoted tree to find its depth never returns.
    ///
    /// Written as a construction-time invariant rather than a walk, exactly like `maxfree`: `var` is 0,
    /// `abs` is one more than its body, `app` is one more than its deeper child. The 10,000-level term
    /// below is built in a loop, so the assertion is on the value the constructors carried up, not on
    /// anything this test recomputes. Same shape as
    /// `max_shared_is_bounded_by_allocations_not_by_logical_nodes`, and for the same reason.
    #[test]
    fn depth_is_bounded_by_allocations_not_by_logical_nodes() {
        assert_eq!(var(0).depth(), 0);
        assert_eq!(abs("x", var(0)).depth(), 1);
        // `app` takes the DEEPER child, not the sum: depth is the longest path, not a size.
        assert_eq!(app(var(0), abs("x", abs("y", var(0)))).depth(), 3);

        let mut c = var(0);
        for _ in 0..10_000 {
            c = app(c.clone(), c);
        }
        assert_eq!(c.depth(), 10_000, "one level per `app`, however much each level is shared");
    }

    /// Saturating rather than wrapping, for the same reason `logical_size` saturates: a depth past
    /// `u32::MAX` is a floor, and a guard that WRAPS reads a tiny number for an enormous term and
    /// admits it. Unreachable in practice — 4 billion nested binders cannot be allocated — so this
    /// pins the arithmetic directly rather than by building one.
    #[test]
    fn depth_saturates_instead_of_wrapping() {
        let deep = var(0);
        // Reach into the invariant the only way a test can: build up from a handle claiming to be at
        // the ceiling. `abs` must not roll this over to 0.
        let at_ceiling = LambdaTerm(Rc::clone(&deep.0), deep.maxfree(), u32::MAX);
        assert_eq!(abs("x", at_ceiling).depth(), u32::MAX);
    }

    /// THE ONE THE HANG TURNS ON. A β-step must cost the DAG, not the tree it denotes.
    ///
    /// `beta` was `shift(-1, 0, subst(0, shift(1, 0, arg), body))`, when the hang was diagnosed, and all
    /// three of those rebuilt every node they visited — so handing it a closed argument of 19 allocations
    /// denoting 262,144 nodes
    /// materialised all 262,144. That is the mechanism behind the open hang: `lower_group` writes a
    /// term whose logical size runs 375x ahead of its physical size, and the reducer cashes the promise
    /// on the first step that touches it. `examples/blowup_probe.rs` recorded the symptom — "a β-step's
    /// output aliases nothing, and the within-term ratio is exactly 1.00x after ≥6 steps" — without
    /// naming this as the cause.
    #[test]
    fn a_beta_step_is_bounded_by_allocations_not_by_logical_nodes() {
        // Closed: 20 allocations denoting 786,431 nodes — a ratio of 39,321x.
        let mut arg = abs("x", var(0));
        for _ in 0..18 {
            arg = app(arg.clone(), arg);
        }
        assert_eq!(physical(&arg), 20);
        assert_eq!(logical_size(&arg), 786_431);

        // (\f. f) arg — the body is one `Var(0)`, so the step is a substitution and nothing else.
        let out = beta(&var(0), &arg);
        assert_eq!(out, arg, "the answer must not change");
        assert_eq!(out.alloc_id(), arg.alloc_id(), "and it must BE the argument, not a copy of it");
        assert_eq!(physical(&out), 20, "a β-step must not materialise the logical expansion");
    }
}
