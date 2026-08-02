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
//! normal form whenever one exists. So correct prior knowledge points the wrong way exactly where these
//! docs were silent, and the symptom — hitting the step cap — reads as "the cap is too low" rather than
//! "the strategy is wrong".
//!
//! The three mechanisms are listed rather than summarized because they are what a later optimization
//! pass would have to retire before relaxing the requirement: thunking the `if` branches retires (1),
//! thunking `head`/`tail`'s nil branch retires (3), and switching to Z retires (2). Until all three are
//! retired, none of them may be assumed.

use crate::lambda::term::{Dir, LambdaTerm, Node, Path, abs, app, beta};

/// Default reduction step cap. High enough for the demo suite, low enough to fail fast instead of
/// hanging. Mirrors the interpreter's `DEFAULT_BUDGET` philosophy.
pub const MAX_REDUCTION_STEPS: u64 = 5_000_000;

/// Bounds the depth of any term the reducer traverses. `reduce_step` (and `beta`'s `shift`/`subst`)
/// recurse once per term node, so a value whose Church/Scott encoding is very deep (a large `Nat` or
/// a long list) would otherwise overflow the native stack instead of failing cleanly. Once a term
/// exceeds this depth the reducer returns `HitCap` instead of calling `reduce_step` on it. Effective
/// only when the running thread's stack is large enough (WASM shadow-stack sizing is a Plan 4
/// follow-up).
pub const MAX_TERM_DEPTH: u32 = 3_000;

/// True if the tree `t` denotes is deeper than `limit`. **O(1) since 2026-08-01** — `LambdaTerm::depth`
/// is a construction-time invariant, so this reads a `u32` and compares it.
///
/// WHY THE GUARD EXISTS AT ALL: `reduce_step` (and `beta`'s `shift`/`subst`) recurse once per term node,
/// so a value whose Church/Scott encoding is very deep would overflow the native stack instead of
/// failing cleanly. The quantity that matters is therefore the DENOTED depth — the longest path — which
/// is what a recursive descent actually follows.
///
/// **THIS USED TO BE A WALK, AND THAT WALK WAS 96% OF THE REDUCER'S TIME.** It pushed an explicit stack
/// and descended into both children of every `App` without asking whether they were one allocation, so
/// it visited each allocation once per EDGE reaching it — the LOGICAL expansion. That is the same bug
/// class as the `shift` fix one file over, and it survived it: with `shift` fixed, the nested-group
/// family's reduction still doubled per level, and sampling showed **187.6 s of level 11's 195.7 s was
/// this function**. Carrying `depth` on the handle took that level to 7.48 s and made the whole ramp
/// FLAT — 7.5–9.0 s at every level from 1 to 11, against a logical size growing 306 → 616,152.
///
/// **Memoizing the walk by allocation was measured and rejected.** It gives the same answer in
/// O(physical), but costs a `HashMap` per call, and at eleven levels that is a flat ~24 s of pure
/// allocation overhead across ~105,000 calls — a net LOSS at the small end (25.1 s against the walk's
/// 11.6 s at level 7), which is where the ordinary corpus lives. A number the constructors already know
/// is free at both ends. `examples/shift_cost_probe.rs` has the table.
///
/// THE HISTORY THIS REPLACES, kept because the shape it warned about is real and someone will
/// reintroduce it. The walk's early exit bounded *depth*, not *work*: thirty nested `App(c, c)` levels
/// is 30 allocations and 2^30 logical nodes, and it returned `false` on all of them after walking every
/// one. That was called "merely unreached — nothing in the corpus builds one" until 2026-07-31, which
/// was true of the corpus and false as a guarantee: `lower_group` clones the whole group term once per
/// member and the factor nests, so `examples/blowup_probe.rs` reaches 1,644 allocations holding 616,152
/// logical nodes (375x) from **512 bytes**. Nothing in this file fired on it — the term's depth was 141
/// against `MAX_TERM_DEPTH` = 3,000 — and `MAX_REDUCTION_STEPS` was never consulted, because control did
/// not return from `reduce_step`. Every one of those numbers is still true of the term; none of them is
/// still true of the cost.
///
/// **THE HANG IS CLOSED, AND NOT BY A GUARD — BY FIXING `shift` (2026-08-01).** What no longer holds is
/// the conclusion this block used to end on.
///
/// ~~"THE HANG IS OPEN. NOTHING REFUSES THESE SIZES."~~ — and before that,
/// ~~"the sizes at which one step does not return are refused before reduction ever starts"~~. The
/// first was true when written; the second never was. Both are superseded: nothing refuses these sizes
/// now either, because **nothing needs to**. A single β-step returns.
///
/// The diagnosis in the middle of that block was right and pointed one level too shallow. `subst`'s
/// `Var` arm is `s.clone()` (an `Rc` bump — occurrences are FREE) while its `Abs` arm re-shifted the
/// whole argument once per `Abs` node in the body, unconditionally: a step cost
/// **`|body| + Abs(body) × |arg|`**, at 23.1–23.6 ns/node-copy over a 1,255x range. What that account
/// left implicit is WHY `|arg|` was the logical number rather than the physical one. `shift` rebuilt
/// every node it visited, so it was Θ(logical) AND it destroyed sharing — `shift(App(c, c))` recursed
/// twice and produced two copies of `c`. `lower_group`'s duplication only writes the promise; `shift`
/// was what cashed it, on every step.
///
/// `term.rs` now carries a `maxfree` per handle (highest free index + 1; 0 means closed), maintained in
/// O(1) by the constructors, and both `shift` and `subst` return their argument's ALLOCATION when it
/// cannot be affected. The counterexample that killed the shared-subterm guard —
/// `let xs = [0..500); let ys = [0..500); head(xs) + head(ys)`, 4,821 bytes, `max_shared` = 4 — went
/// from **19.0 s in its first β-step to 0.002 s**. The 512-byte nested-group program that did not
/// finish one β-step in 13 minutes at 974 MB then ran 105,607 steps in 195.7 s under a 2 GiB cap.
///
/// **AND THEN THIS FUNCTION WAS 96% OF WHAT WAS LEFT** — see the top of this comment. With `depth`
/// stored too, that same program is **7.48 s**, the two-list counterexample is under a millisecond, and
/// the ramp is flat across all eleven levels. Instrument: `examples/shift_cost_probe.rs`.
///
/// **THE PER-REDEX WORK BUDGET WAS NOT BUILT, and this is the record of why it was not needed.** The
/// roadmap's next λ slice was `logical_abs_count(body) × logical_size(arg)` checked in
/// `LambdaCursor::next` before the step it prices. That design is sound and its reasoning survives —
/// it prices the measured cost model rather than a proxy, and it checks per step. It was overtaken:
/// the quantity it was going to bound is no longer large, because `|arg|` is no longer paid logically.
/// A guard sized against the pre-fix numbers would be calibrated against costs inflated up to ~9,500x
/// on these programs. If one is wanted later it must be re-measured from scratch.
///
/// **WHAT IS STILL OPEN, stated because "the hang is closed" will be read as covering more than it
/// does.** Divergence is untouched and was never this slice's to solve — the nested-group family has no
/// base case, so "terminates" above means it reaches a cap in bounded time, not that it computes an
/// answer. The cap it reaches is **this function's**, not the step cap: `MAX_TERM_DEPTH` fires at
/// 105,607 steps against a `MAX_REDUCTION_STEPS` of 5,000,000, because the family grows deep as it
/// diverges. Both are reachable now only because control returns from each step, which is the whole
/// change.
///
/// **THE RAMP BEING FLAT IS A FACT ABOUT THIS FAMILY, NOT A COMPLEXITY CLAIM.** What the two fixes
/// removed is cost that scaled with the LOGICAL size while the physical size stayed small — which is
/// exactly what this family is built to exhibit. A program whose physical size genuinely grows still
/// pays for it, and `subst` still rebuilds the spine of whatever it descends into. ~~The older next
/// target — carrying `subst`'s per-binder re-shift down as one `shift(d, 0, ·)`, with an additivity
/// lemma already verified in the perf design — is untouched and still available.~~
///
/// **THE OLDER NEXT TARGET IS FALSIFIED TOO — 2026-08-02, by the same short-circuit that closed the
/// hang.** Priced against what `subst` NOW allocates it is not a win but a **0.99x loss** on this
/// family at every level, and 1.00x on both counterexamples. The quantity it deletes is 5,696
/// allocations across 105,607 β-steps — 0.05 per step, against a model that priced it at 44 copies of
/// the argument per step. It inverts because `subst` descends only through the binders ON THE PATH TO
/// AN OCCURRENCE, so binders-crossed is now smaller than occurrences and paying per occurrence costs
/// more than paying per binder. Instrument: `examples/shift_cost_probe.rs`'s census section, which
/// mirrors `subst` arm for arm rather than modelling it; full statement in the perf design's §10.
///
/// **What that leaves as the largest measured λ cost, neither of which any proposal so far addresses:**
/// the body spine `subst` rebuilds (60–90% of its allocations), and `beta`'s own opening
/// `shift(1, 0, arg)` — the only quantity on this family that still scales with it, 20,725 → 190,666
/// allocations across levels 1 to 11 while everything else is flat or falling.
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

/// Perform one leftmost-outermost β-step. Returns the reduced term and the path to the redex, or
/// `None` if `t` is already in normal form.
pub fn reduce_step(t: &LambdaTerm) -> Option<(LambdaTerm, Path)> {
    // Redex at the root: (\. body) arg
    if let Node::App(f, a) = t.node()
        && let Node::Abs(_, body) = f.node()
    {
        return Some((beta(body, a), Vec::new()));
    }
    match t.node() {
        Node::App(f, a) => {
            // Try the function side first (leftmost), then the argument. Both `clone`s below are
            // refcount bumps; under `Box` they deep-copied the untouched sibling at every level of
            // the path, which is the cost this representation exists to remove.
            if let Some((f2, mut path)) = reduce_step(f) {
                path.insert(0, Dir::AppL);
                Some((app(f2, a.clone()), path))
            } else if let Some((a2, mut path)) = reduce_step(a) {
                path.insert(0, Dir::AppR);
                Some((app(f.clone(), a2), path))
            } else {
                None
            }
        }
        Node::Abs(n, b) => reduce_step(b).map(|(b2, mut path)| {
            path.insert(0, Dir::AbsBody);
            (abs(std::rc::Rc::clone(n), b2), path)
        }),
        Node::Var(_) => None,
    }
}

/// Reduce to normal form (or the cap), recording every step and its redex path. Materializes a
/// snapshot per step BY CONTRACT — this is the API that promises the full history; `trace::LambdaCursor`
/// is the O(1) alternative for callers that only walk forward. The stepping itself lives in the cursor,
/// so there is one β-reduction loop in this crate rather than two that must be kept in agreement.
pub fn reduce_trace(t: &LambdaTerm, cap: u64) -> Trace {
    let mut cursor = crate::trace::LambdaCursor::new(t, cap);
    let mut steps = Vec::new();
    loop {
        // The term BEFORE this step — `next` replaces it, so it cannot be read afterwards.
        let before = cursor.term().clone();
        match cursor.next() {
            Some(crate::trace::StepEvent::Beta { redex }) => steps.push(Step { term: before, redex }),
            // Unreachable in practice: a `LambdaCursor` only ever emits `Beta`. Stopping here returns a
            // well-formed partial trace if that ever changes, rather than panicking on a library path.
            Some(_) => break,
            None => break,
        }
    }
    // `None` only if the loop broke on an event a `LambdaCursor` cannot emit; the run is over either way.
    let status = cursor.status().unwrap_or(Status::Normalized);
    Trace { steps, normal_form: cursor.term().clone(), status }
}

/// Reduce to normal form (or the cap) without retaining the intermediate steps. Drives a
/// `trace::LambdaCursor` to exhaustion and discards the redex paths, so this shares the same
/// cap-then-depth-then-step guard order as `reduce_trace` rather than a second copy of it.
pub fn reduce_to_normal_form(t: &LambdaTerm, cap: u64) -> (LambdaTerm, Status) {
    let mut cursor = crate::trace::LambdaCursor::new(t, cap);
    while cursor.next().is_some() {}
    let status = cursor.status().unwrap_or(Status::Normalized);
    (cursor.term().clone(), status)
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
        let (_, path) = reduce_step(&t).expect("a redex exists");
        assert_eq!(path, vec![Dir::AppR, Dir::AbsBody]);
    }
}
