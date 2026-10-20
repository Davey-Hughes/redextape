//! Normal-order (leftmost-outermost) β-reduction over de Bruijn terms, tracking the redex path per
//! step. A step cap bounds non-terminating reduction (returns a partial trace + `HitCap`).
//!
//! NORMAL ORDER IS REQUIRED, NOT A CHOICE THIS IMPLEMENTATION MADE. Any reducer for the terms this
//! backend emits — ours, or an independent one reading `print_lambda` output — must reduce
//! leftmost-outermost. An applicative-order (call-by-value) reducer does not merely take a different
//! route to the same answer: it fails to terminate on ordinary programs, for three independent reasons,
//! each of which is sufficient on its own.
//!
//! 1. **Conditionals are unthunked.** `lower.rs` lowers `Core::If` to `app(app(cond, then), else)`,
//!    handing a Scott boolean both branches as bare arguments. Call-by-value evaluates both before the
//!    selection can discard one, so `fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } }` recurses
//!    unconditionally and its base case can never stop it. `if_only_reduces_the_taken_branch` below
//!    pins the property this depends on for THIS reducer.
//! 2. **The fixpoint combinator is the call-by-name Y**, `\f. (\x. f (x x)) (\x. f (x x))` (`lower.rs`'s
//!    `fix`). Call-by-value must reduce the argument `x x` before applying, and that regenerates the
//!    same redex forever. Call-by-value needs the Z combinator instead; the two are not interchangeable,
//!    and nothing in an emitted term marks which one it was built for.
//! 3. **`head`/`tail` pass Ω unconditionally.** `encode.rs` defines `head = \l. l DIVERGE (\h.\t. h)`
//!    with `DIVERGE = (\x. x x) (\x. x x)`. Normal order never selects that argument for a non-empty
//!    list; call-by-value evaluates it before applying `l` at all, so even `head(cons(7, nil))`
//!    diverges.
//!
//! WHY THIS NEEDS SAYING, given that it looks like it follows from theory. β-reduction is confluent
//! (Church–Rosser), so any two reduction sequences that DO reach normal forms reach the same one. An
//! implementer who knows that can correctly conclude the order does not change the answer — and then
//! incorrectly conclude the order does not matter. Confluence is about UNIQUENESS. REACHABILITY is the
//! separate standardization/normalization result, and that is the one saying normal order reaches a
//! normal form whenever one exists. So correct prior knowledge points the wrong way here, and the
//! symptom — hitting the step cap — reads as "the cap is too low" rather than "the strategy is wrong".
//!
//! The three mechanisms are listed rather than summarized because they are what a later optimization
//! pass would have to retire before relaxing the requirement: thunking the `if` branches retires (1),
//! thunking `head`/`tail`'s nil branch retires (3), and switching to Z retires (2). Until all three are
//! retired, none of them may be assumed.

use crate::core::NodeId;
use crate::lambda::term::{Dir, LambdaTerm, Node, Path, abs, app_tagged_for_rebuild, beta};

/// Default reduction step cap. High enough for the demo suite, low enough to fail fast instead of
/// hanging. Mirrors the interpreter's `DEFAULT_BUDGET` philosophy.
pub const MAX_REDUCTION_STEPS: u64 = 5_000_000;

/// Bounds the depth of any term the reducer traverses. `reduce_step` (and `beta`'s `shift`/`subst`)
/// recurse once per term node, so a value whose Church/Scott encoding is very deep (a large `Nat` or
/// a long list) would otherwise overflow the native stack instead of failing cleanly. Once a term
/// exceeds this depth the reducer returns `HitCap` instead of calling `reduce_step` on it. Effective
/// only when the running thread's stack is large enough. The WASM shadow stack is not the relevant
/// stack, and `-zstack-size` cannot help: on that target the stack a deep term exhausts when
/// printed is V8's own engine call stack, which no module can size. The printer's bound is
/// `redextape_wasm::session::MAX_PRINT_DEPTH`; this constant is the reducer's.
pub const MAX_TERM_DEPTH: u32 = 3_000;

/// True if the tree `t` denotes is deeper than `limit`. **O(1)**: `LambdaTerm::depth`
/// is a construction-time invariant, so this reads a `u32` and compares it.
///
/// Why the guard exists at all: `reduce_step` (and `beta`'s `shift`/`subst`) recurse once per term node,
/// so a value whose Church/Scott encoding is very deep would overflow the native stack instead of
/// failing cleanly. The quantity that matters is therefore the DENOTED depth — the longest path — which
/// is what a recursive descent actually follows.
///
/// The depth is stored on the handle rather than found by a walk. A walk that descends both children of every
/// `App` visits each allocation once per EDGE reaching it, the logical expansion, and its early exit bounds
/// depth, not work. Memoizing the walk by allocation costs a `HashMap` per call, a net LOSS at the small end,
/// which is where the ordinary corpus lives. A number the constructors already know is free at both ends.
pub(crate) fn depth_exceeds(t: &LambdaTerm, limit: u32) -> bool {
    t.depth() > limit
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Normalized,
    HitCap,
}

#[derive(Clone, Debug)]
pub struct Step {
    /// The term *before* this step.
    pub term: LambdaTerm,
    /// Path to the redex reduced in this step.
    pub redex: Path,
}

#[derive(Clone, Debug)]
pub struct Trace {
    pub steps: Vec<Step>,
    pub normal_form: LambdaTerm,
    pub status: Status,
}

/// Which source construct a β-step belongs to.
///
/// **Three states, not two.** `Exact` and `Within` are different claims — *this step IS that
/// construct* against *this step is somewhere inside it* — and a consumer given one flag cannot tell
/// them apart. A single-signal consumer is right to refuse the containment shape
/// (`docs/superpowers/specs/2026-08-08-plan5b-click-linking-design.md`, on the TM leg). Two different
/// kinds of object must not collapse into one.
///
/// **`Within` IS A CLAIM ABOUT THE REDUCT'S STRUCTURE, NOT THE LOWERING'S.** After N substitutions the
/// innermost tagged `App` enclosing the redex is a node of the reduct. That is a true statement and a
/// DIFFERENT relation from the one `node_to_lambda` expressed; a consumer must not read it as "this
/// construct is being evaluated now".
///
/// **`None` IS COMMON AND CORRECT.** `encode.rs` mints every Church/Scott combinator untagged, so
/// reducing `40 + 2` is overwhelmingly work inside `plus` and two numerals — code with no source
/// construct at all. There is no repair for that and none should be attempted.
///
/// **TWO MORE THINGS THIS CANNOT SAY, stated here because a consumer will otherwise assume it can.**
///
/// It names a construct, NOT A LOCATION. Substitution copies: `subst` returns `s.clone()` per
/// occurrence, and N occurrences share one allocation. So one construct's nodes exist at many
/// positions in the reduct at once. *"The construct being worked on is X"* is honest; *"and X is
/// here"* is not, because X is now everywhere the substitution put it.
///
/// It cannot tell an iteration from its predecessor. `Core::LetRec` copies the tagged body on every
/// unrolling, so all forty iterations of a forty-iteration loop report the same `NodeId`. That is
/// *correct* and it is *not what someone watching a loop wants*. An iteration counter is a different
/// feature and is deliberately not here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub enum Owner {
    /// The contracted `App` carried this construct's own tag.
    Exact(NodeId),
    /// It did not; this is the innermost enclosing construct that did.
    Within(NodeId),
    /// Neither the redex nor any ancestor on the path carried a tag.
    None,
}

impl Owner {
    /// The `NodeId` under either claim, for a consumer that only needs to know WHICH construct.
    /// A consumer that renders the two differently must match on the variant instead.
    #[must_use]
    pub fn node(&self) -> Option<NodeId> {
        match self {
            Owner::Exact(id) | Owner::Within(id) => Some(*id),
            Owner::None => None,
        }
    }
}

/// Perform one leftmost-outermost β-step. Returns the reduced term, the path to the redex, and the
/// source construct the step belongs to, or `None` if `t` is already in normal form.
///
/// **THE OWNER IS HARVESTED FROM A DESCENT THAT ALREADY HAPPENS.** This function walks root→redex
/// regardless; carrying "the innermost tagged node passed so far" down that walk costs one
/// `Option<NodeId>` copy per level. There is no second traversal and no allocation.
#[must_use]
pub fn reduce_step(t: &LambdaTerm) -> Option<(LambdaTerm, Path, Owner)> {
    reduce_step_go(t, None)
}

/// `enclosing` is the innermost tag on the path from the root to `t`, EXCLUDING `t` itself — so the
/// root-redex arm can prefer the redex's own tag without the two being confused.
fn reduce_step_go(t: &LambdaTerm, enclosing: Option<NodeId>) -> Option<(LambdaTerm, Path, Owner)> {
    // Redex at the root: (\. body) arg
    if let Node::App(f, a, owner) = t.node()
        && let Node::Abs(_, body) = f.node()
    {
        let who = match (owner, enclosing) {
            (Some(id), _) => Owner::Exact(*id),
            (None, Some(id)) => Owner::Within(id),
            (None, None) => Owner::None,
        };
        return Some((beta(body, a), Vec::new(), who));
    }
    match t.node() {
        Node::App(f, a, owner) => {
            // Descending THROUGH a tagged App makes it the innermost enclosing tag for everything
            // below. `or` and not `or_else`-with-swapped-operands: the node we are passing through is
            // nearer than anything above it.
            let inner = (*owner).or(enclosing);
            // Try the function side first (leftmost), then the argument. Both `clone`s below are
            // refcount bumps; under `Box` they would deep-copy the untouched sibling at every level of
            // the path, which is the cost this representation exists to remove.
            if let Some((f2, mut path, who)) = reduce_step_go(f, inner) {
                path.insert(0, Dir::AppL);
                Some((app_tagged_for_rebuild(f2, a.clone(), *owner), path, who))
            } else if let Some((a2, mut path, who)) = reduce_step_go(a, inner) {
                path.insert(0, Dir::AppR);
                Some((app_tagged_for_rebuild(f.clone(), a2, *owner), path, who))
            } else {
                None
            }
        }
        // An `Abs` carries no tag, so `enclosing` passes through untouched.
        Node::Abs(n, b) => reduce_step_go(b, enclosing).map(|(b2, mut path, who)| {
            path.insert(0, Dir::AbsBody);
            (abs(std::rc::Rc::clone(n), b2), path, who)
        }),
        Node::Var(_) => None,
    }
}

/// Reduce to normal form (or the cap), recording every step and its redex path. Materializes a
/// snapshot per step BY CONTRACT — this is the API that promises the full history; `trace::LambdaCursor`
/// is the O(1) alternative for callers that only walk forward.
///
/// **This drives `LambdaCursor`, and it is the one consumer that should.** `reduce_to_normal_form`
/// uses `ZipperCursor`; this function cannot take its win. The zipper's saving is the per-step spine
/// rebuild, and it is only a saving for a caller that reads the term ONCE. Calling `cursor.term()`
/// every step — which is this function's entire promise — makes the zipper fold its context stack per
/// step, paying the same cost back with frame bookkeeping on top.
///
/// **There are two β-reduction loops in this crate,** and they are kept in agreement mechanically:
/// `tests/zipper_equivalence.rs` asserts identical `StepEvent` sequences, identical terms and identical
/// statuses across 256 generated programs and its curated cases. Without that gate, nothing holds the two
/// loops in agreement.
#[must_use]
pub fn reduce_trace(t: &LambdaTerm, cap: u64) -> Trace {
    let mut cursor = crate::trace::LambdaCursor::new(t, cap);
    let mut steps = Vec::new();
    loop {
        // The term BEFORE this step — `next` replaces it, so it cannot be read afterwards.
        let before = cursor.term().clone();
        match cursor.next() {
            // The owner is deliberately dropped here, and the binding is named rather than elided so
            // that stays a decision rather than an oversight. `Step` is the materialized-history API;
            // design §3.5 puts the owner on the EVENT and on `LambdaState`, and the live-highlight
            // consumer reads `LambdaCursor::last_owner`, which is why that accessor exists. Widening
            // `Step` too would add a field with no reader.
            Some(crate::trace::StepEvent::Beta { redex, owner: _ }) => steps.push(Step { term: before, redex }),
            // Unreachable in practice: a `LambdaCursor` only ever emits `Beta`. Stopping here returns a
            // well-formed partial trace if that ever changes, rather than panicking on a library path.
            // Kept apart from `None`'s arm rather than merged, even though both `break` today: this one
            // is "an event kind `LambdaCursor` doesn't currently emit" (a forward-compat safety net),
            // `None`'s is "the cursor is genuinely done" — different situations that share a body only
            // by accident of `LambdaCursor` emitting one variant today.
            #[allow(clippy::match_same_arms)]
            Some(_) => break,
            None => break,
        }
    }
    // `None` only if the loop broke on an event a `LambdaCursor` cannot emit; the run is over either way.
    let status = cursor.status().unwrap_or(Status::Normalized);
    Trace { steps, normal_form: cursor.term().clone(), status }
}

/// Reduce to normal form (or the cap) without retaining the intermediate steps. Drives a cursor to
/// exhaustion and discards the redex paths, so this shares the same cap-then-depth-then-step guard
/// order as `reduce_trace` rather than a second copy of it.
///
/// **THIS DRIVES `ZipperCursor`, WHERE `reduce_trace` DRIVES `LambdaCursor`, AND THE SPLIT IS THE
/// WHOLE POINT.** A zipper carries the reduction context across steps instead of re-descending from
/// the root, which removes the spine rebuild `reduce_step` pays per step. It can only do that for a
/// caller that reads the term ONCE, at the end. `reduce_trace` materialises `cursor.term()` every
/// step by contract, so under a zipper it would fold the context stack per step and pay the same cost
/// back with frame bookkeeping on top — measurably worse, not merely neutral. Routing by consumer
/// rather than replacing one with the other is what captures the win without taking the regression.
///
/// **The two cursors are held to being interchangeable, not assumed to be.**
/// `tests/zipper_equivalence.rs` asserts identical `StepEvent` sequences, identical terms and
/// identical statuses over 256 generated programs and its curated terminating and capping cases.
/// Any divergence is a correctness defect, not a performance trade — normal order is required, not
/// chosen (see this module's own doc comment for the three independent reasons).
///
/// Full record: `docs/superpowers/specs/2026-08-02-lambda-reduction-context-zipper-design.md`.
#[must_use]
pub fn reduce_to_normal_form(t: &LambdaTerm, cap: u64) -> (LambdaTerm, Status) {
    let mut cursor = crate::trace::ZipperCursor::new(t, cap);
    while cursor.next().is_some() {}
    let status = cursor.status().unwrap_or(Status::Normalized);
    (cursor.term(), status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lambda::encode::*;
    use crate::lambda::term::{abs, app, var};

    fn nf(t: &LambdaTerm) -> LambdaTerm {
        let (n, status) = reduce_to_normal_form(t, MAX_REDUCTION_STEPS);
        assert!(matches!(status, Status::Normalized), "expected normalization");
        n
    }

    #[test]
    fn identity_application_reduces() {
        let t = app(abs("x", var(0)), abs("y", var(0)));
        assert_eq!(nf(&t), abs("y", var(0)));
    }

    #[test]
    fn church_arithmetic_normalizes() {
        assert_eq!(nf(&app(app(plus(), church(2)), church(3))), church(5));
        assert_eq!(nf(&app(app(mult(), church(2)), church(3))), church(6));
        assert_eq!(nf(&app(pred(), church(4))), church(3));
        // monus is truncated: 3 - 5 = 0
        assert_eq!(nf(&app(app(monus(), church(3)), church(5))), church(0));
    }

    #[test]
    fn comparisons_normalize_to_booleans() {
        use crate::core::BinOp;
        assert_eq!(nf(&app(app(binop(BinOp::Lt), church(1)), church(2))), tru());
        assert_eq!(nf(&app(app(binop(BinOp::Le), church(2)), church(2))), tru());
        assert_eq!(nf(&app(app(binop(BinOp::Eq), church(2)), church(3))), fls());
        assert_eq!(nf(&app(app(binop(BinOp::Ge), church(3)), church(1))), tru());
    }

    #[test]
    fn scott_list_operations_normalize() {
        // is_empty nil -> true ; is_empty (cons 1 nil) -> false
        assert_eq!(nf(&app(is_empty(), nil())), tru());
        let one_list = app(app(cons(), church(1)), nil());
        assert_eq!(nf(&app(is_empty(), one_list.clone())), fls());
        // head (cons 7 nil) -> 7
        let seven_list = app(app(cons(), church(7)), nil());
        assert_eq!(nf(&app(head(), seven_list)), church(7));
    }

    #[test]
    fn if_only_reduces_the_taken_branch() {
        // true A B -> A, even if B diverges: normal order never touches B.
        let omega = abs("x", app(var(0), var(0)));
        let diverge = app(omega.clone(), omega);
        let t = app(app(tru(), church(1)), diverge);
        assert_eq!(nf(&t), church(1));
    }

    #[test]
    fn non_termination_hits_the_cap() {
        let omega = abs("x", app(var(0), var(0)));
        let t = app(omega.clone(), omega);
        let (_, status) = reduce_to_normal_form(&t, 1000);
        assert!(matches!(status, Status::HitCap));
    }

    #[test]
    fn trace_records_the_first_redex_path() {
        // (\x.x) ((\y.y) z) — leftmost-outermost redex is the OUTER application (root).
        let inner = app(abs("y", var(0)), var(9));
        let t = app(abs("x", var(0)), inner);
        let step = reduce_step(&t).expect("a redex exists");
        assert_eq!(step.1, Vec::<Dir>::new()); // redex at the root
    }

    #[test]
    fn reduce_trace_records_every_step() {
        // (\x. x) ((\y. y) z): normal order reduces the OUTER redex first, then the inner one.
        let t = app(abs("x", var(0)), app(abs("y", var(0)), var(2)));
        let trace = reduce_trace(&t, MAX_REDUCTION_STEPS);
        assert!(matches!(trace.status, Status::Normalized));
        assert_eq!(trace.steps.len(), 2, "expected two beta-steps");
        // Each Step.term is the term BEFORE that step; the first is the original.
        assert_eq!(trace.steps[0].term, t);
        // The recorded normal form agrees with the no-trace reducer.
        let (nf, _) = reduce_to_normal_form(&t, MAX_REDUCTION_STEPS);
        assert_eq!(trace.normal_form, nf);
    }

    #[test]
    fn deep_term_hits_the_cap_instead_of_overflowing() {
        // A term far deeper than MAX_TERM_DEPTH must yield HitCap, not a native stack overflow.
        let deep = church(MAX_TERM_DEPTH as u64 + 5000);
        let (_, status) = reduce_to_normal_form(&deep, MAX_REDUCTION_STEPS);
        assert!(matches!(status, Status::HitCap), "expected HitCap for a very deep term");
    }

    #[test]
    fn non_trivial_redex_path() {
        // free_var (\x. (\z. z) w): the leftmost-outermost redex is under the argument's Abs body.
        let t = app(var(1), abs("x", app(abs("z", var(0)), var(2))));
        let (_, path, _owner) = reduce_step(&t).expect("a redex exists");
        assert_eq!(path, vec![Dir::AppR, Dir::AbsBody]);
    }
}
