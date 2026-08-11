//! A reduction-context zipper for β-reduction — the alternative to `LambdaCursor`'s root re-descent.
//!
//! **THE MEASUREMENT THIS EXISTS FOR:** `LambdaCursor::next` calls `reduce_step` from the root every
//! step, and `reduce_step` rebuilds the redex spine on the way back up — one `Rc::new` per path
//! element. That is `Σ path`: 29.2% of every allocation the reducer makes and 36.2% of fitted time,
//! the largest single allocating traversal in the corpus. This cursor carries the spine instead.
//!
//! **NAVIGATION IS ALLOCATION-FREE ON THE DESCENT AND ON SIBLING MOVES, and the reason is the
//! invariant below.** Every redex is reduced from exactly one configuration — `focus` is an `Abs` and
//! the top frame is `AppL(arg)` — reached by descending one level *past* the `App` into its function
//! side. So the `App` node itself is never constructed on the way down: whether it is a redex follows
//! from the frame tag and the focus node, and reducing it is `beta(body, arg)` directly. Moving to a
//! sibling is a handle swap. But `advance` allocates one node — via `app_tagged_for_rebuild(...)` or
//! `abs(...)` — per level it climbs past an exhausted subtree, because it needs the parent as a term to
//! continue the search from. `Rc::new` is called by `beta`, by `term()`, and by that climb in
//! `advance`, nowhere else in this file.
//!
//! Full record: `docs/superpowers/specs/2026-08-02-lambda-reduction-context-zipper-design.md`.

use std::rc::Rc;

use crate::core::NodeId;
use crate::lambda::Status;
use crate::lambda::reduce::{MAX_TERM_DEPTH, Owner};
use crate::lambda::term::{Dir, LambdaTerm, Node, Path, abs, app_tagged_for_rebuild, beta};
use crate::trace::StepEvent;

/// One level of reduction context: where the focus sits in its parent, plus the sibling the parent
/// holds. `AbsBody` carries the binder's name hint so `term()` can rebuild it exactly.
///
/// `saved_depth` is this frame's contribution to the O(1) whole-term depth accounting — see
/// `ZipperCursor::root_depth`. It is the `(add, floor)` pair in force *before* this frame was pushed,
/// restored on pop, because `max` is not invertible.
///
/// `owner` is the provenance tag of the `App` the frame decomposed. **It is stored here because the
/// `App` itself is never rebuilt on the reduction path** (see `reduce_here`), so at the moment a step is
/// reported there is no node left to read it from. It is also what every rebuild on the climb
/// (`term`, `advance`) hands back to `app_tagged_for_rebuild`: a rebuild through plain `app` would drop
/// provenance on the zipper path only, which `PartialEq` cannot see because it ignores the tag.
/// `AbsBody` decomposed an `Abs`, which carries no tag, so it has no such field.
enum Frame {
    AppL { arg: LambdaTerm, saved_depth: (u32, u32), owner: Option<NodeId> },
    AppR { fun: LambdaTerm, saved_depth: (u32, u32), owner: Option<NodeId> },
    AbsBody { name: Rc<str>, saved_depth: (u32, u32) },
}

impl Frame {
    fn dir(&self) -> Dir {
        match self {
            Frame::AppL { .. } => Dir::AppL,
            Frame::AppR { .. } => Dir::AppR,
            Frame::AbsBody { .. } => Dir::AbsBody,
        }
    }

    fn saved_depth(&self) -> (u32, u32) {
        match self {
            Frame::AppL { saved_depth, .. } | Frame::AppR { saved_depth, .. } | Frame::AbsBody { saved_depth, .. } => {
                *saved_depth
            }
        }
    }

    /// The tag of the `App` this frame decomposed, or `None` for `AbsBody`, which decomposed an `Abs`.
    ///
    /// `None` from an `AbsBody` frame and `None` from an untagged `App` frame are deliberately the same
    /// answer: `reduce_step_go`'s descent also passes `enclosing` through an `Abs` untouched, so a
    /// binder neither contributes a tag nor hides the ones above it.
    fn owner(&self) -> Option<NodeId> {
        match self {
            Frame::AppL { owner, .. } | Frame::AppR { owner, .. } => *owner,
            Frame::AbsBody { .. } => None,
        }
    }
}

/// Lazy β-reduction over an explicit reduction context. Same contract as `LambdaCursor`: one term at a
/// time, O(1) in the number of steps, `Beta` events in leftmost-outermost order.
pub struct ZipperCursor {
    focus: LambdaTerm,
    stack: Vec<Frame>,
    steps: u64,
    cap: u64,
    status: Option<Status>,
    /// Whole-term depth as `max(focus.depth() + add, floor)`. Maintained O(1) per push and pop; see
    /// `root_depth`.
    depth_add: u32,
    depth_floor: u32,
    /// Root seeks performed. **Instrumentation, and the only thing that can tell resumption from a
    /// correct-but-unoptimized restart** — the two produce identical events, identical terms and
    /// identical statuses by construction, so no observable output distinguishes them. Read by
    /// `resuming_keeps_the_context_stack_rather_than_rebuilding_it`. Test builds only, so it costs
    /// nothing shipped.
    #[cfg(test)]
    seek_calls_from_root: u32,
    /// Nodes rebuilt by `advance`'s climb — **the one place navigation allocates**, and the quantity
    /// that separates what this cursor saves from what it was projected to save. The design's ceiling
    /// is `Σ path − climbs`; without this counter a null measurement could not be attributed.
    ///
    /// **NOT `#[cfg(test)]`, unlike `seek_calls_from_root`, and not by oversight.** PART D of
    /// `examples/lambda_sharing_probe.rs` is an example rather than a test, so a gated field is
    /// invisible to it. **Counted here rather than by a global allocator hook on purpose:** `push`
    /// grows a `Vec<Frame>`, which also allocates, and a hook would fold that into the same number as
    /// the `Rc::new`s the ceiling is denominated in. The quantity the design is about is NODE
    /// allocations. If this cursor ever ships, the counter goes.
    climbs: u64,
}

impl ZipperCursor {
    #[must_use]
    pub fn new(t: &LambdaTerm, cap: u64) -> ZipperCursor {
        ZipperCursor {
            focus: t.clone(),
            stack: Vec::new(),
            steps: 0,
            cap,
            status: None,
            depth_add: 0,
            depth_floor: 0,
            #[cfg(test)]
            seek_calls_from_root: 0,
            climbs: 0,
        }
    }

    /// The whole term, rebuilt from the context stack. **On demand, never maintained** — maintaining
    /// it eagerly is precisely the cost this cursor exists to remove, so a caller that invokes this
    /// every step (as `reduce_trace` does by contract) gets no benefit from the zipper at all.
    ///
    /// **THE REBUILD IS TAG-CARRYING, AND NOTHING IN THE EQUIVALENCE GATE CAN SEE THAT.**
    /// `LambdaTerm`'s `PartialEq` ignores an `App`'s owner, so rebuilding through plain `app` here would
    /// return a term that compares equal to `LambdaCursor`'s while having silently lost every tag on the
    /// context spine — including in `reduce_to_normal_form`'s result, which is this method's shipped
    /// caller. `tests/lambda_provenance.rs`'s
    /// `the_zippers_normal_form_keeps_the_tags_the_plain_loop_keeps` is what does see it.
    #[must_use]
    pub fn term(&self) -> LambdaTerm {
        let mut t = self.focus.clone();
        for f in self.stack.iter().rev() {
            t = match f {
                Frame::AppL { arg, owner, .. } => app_tagged_for_rebuild(t, arg.clone(), *owner),
                Frame::AppR { fun, owner, .. } => app_tagged_for_rebuild(fun.clone(), t, *owner),
                Frame::AbsBody { name, .. } => abs(Rc::clone(name), t),
            };
        }
        t
    }

    /// The path from the root to the focus. The stack *is* the path, so this is a tag read per frame
    /// and no traversal — design constraint 3.
    pub fn path(&self) -> Path {
        self.stack.iter().map(Frame::dir).collect()
    }

    #[must_use]
    pub fn steps_taken(&self) -> u64 {
        self.steps
    }

    #[must_use]
    pub fn status(&self) -> Option<Status> {
        self.status
    }

    /// Nodes `advance`'s climb has rebuilt so far. See the field's doc: this is the measured half of
    /// `Σ path − climbs`, and it exists for PART D of `examples/lambda_sharing_probe.rs`.
    // Instrumentation for `lambda_sharing_probe.rs`'s PART D, not part of the cursor's contract.
    #[doc(hidden)]
    #[must_use]
    pub fn climbs(&self) -> u64 {
        self.climbs
    }

    /// Depth of the whole term, in O(1). The reconstruction `t_{i-1} = combine(frame_i, t_i)` is
    /// `max(x, sib) + 1` at every frame, and that family is closed under composition — `max(x + a, b)`
    /// composed with `max(x + 1, c)` is `max(x + (a+1), max(b, c + a))` — so the whole stack collapses
    /// to one `(add, floor)` pair maintained on push and restored on pop.
    ///
    /// **This is not an optimization, it is the depth guard's only remaining home.** `LambdaCursor`
    /// reads `self.current.depth()`, a stored field on the root handle. A zipper has no root handle
    /// between steps, and rebuilding one per step to read it would reintroduce exactly the cost this
    /// cursor removes. Dropping the guard instead is not available: it is the 2026-08-01 fix that
    /// closed the hang.
    fn root_depth(&self) -> u32 {
        self.focus.depth().saturating_add(self.depth_add).max(self.depth_floor)
    }

    /// `sib` is the sibling's depth, or 0 under a binder (`abs` adds one to its body alone).
    fn push(&mut self, make: impl FnOnce((u32, u32)) -> Frame, sib: u32, child: LambdaTerm) {
        let saved = (self.depth_add, self.depth_floor);
        self.stack.push(make(saved));
        self.depth_floor = self.depth_floor.max(sib.saturating_add(1).saturating_add(self.depth_add));
        self.depth_add = self.depth_add.saturating_add(1);
        self.focus = child;
    }

    /// Pop one frame, restoring the depth accounting and rebuilding nothing. Returns the popped frame
    /// so the caller can take its sibling. **The parent term is deliberately not reconstructed here** —
    /// `advance`'s climbing arms rebuild it when they need it, which is the one place navigation
    /// allocates.
    fn pop(&mut self) -> Option<Frame> {
        let f = self.stack.pop()?;
        let (add, floor) = f.saved_depth();
        self.depth_add = add;
        self.depth_floor = floor;
        Some(f)
    }

    /// Descend from the focus to the leftmost-outermost redex within it, leaving the invariant
    /// holding. `false` means the focus subtree is redex-free — the focus has moved down the
    /// leftmost spine to a `Var`, and the frames pushed along the way remain on the stack; `advance`
    /// relies on those frames being there to find the next unsearched subtree.
    ///
    /// **The `Move` indirection is not decoration.** `self.focus.node()` borrows `self` immutably for
    /// the whole `match` arm, and `self.push` needs it mutably — reading the shape out first ends the
    /// borrow before the move happens. Writing this as a direct `match` + `push` does not compile.
    fn descend_to_redex(&mut self) -> bool {
        enum Move {
            Stop,
            UnderBinder(Rc<str>, LambdaTerm),
            IntoFunction(LambdaTerm, LambdaTerm, Option<NodeId>),
        }
        loop {
            let mv = match self.focus.node() {
                Node::Var(_) => Move::Stop,
                Node::Abs(n, b) => Move::UnderBinder(Rc::clone(n), b.clone()),
                Node::App(f, a, owner) => Move::IntoFunction(f.clone(), a.clone(), *owner),
            };
            match mv {
                Move::Stop => return false,
                Move::UnderBinder(name, body) => {
                    self.push(|saved_depth| Frame::AbsBody { name, saved_depth }, 0, body);
                }
                Move::IntoFunction(fun, arg, owner) => {
                    let sib = arg.depth();
                    // Descend PAST the App into its function side. If `fun` is an `Abs` the invariant
                    // now holds and this App is the redex; if not, the search continues below it. The
                    // App's tag rides the frame from here: this is the one place it is read off a node,
                    // and after this the node is either contracted away or rebuilt from the frame.
                    self.push(|saved_depth| Frame::AppL { arg, saved_depth, owner }, sib, fun);
                    if matches!(self.focus.node(), Node::Abs(..)) {
                        return true;
                    }
                }
            }
        }
    }

    /// Move to the next position in leftmost-outermost order after a redex-free subtree: up to the
    /// nearest ancestor with an unsearched right child, and into it. `false` at the root.
    fn advance(&mut self) -> bool {
        while let Some(f) = self.pop() {
            match f {
                // The function side held no redex, so try the argument side. `self.focus` is the
                // function; it becomes the frame's sibling and `arg` becomes the focus. `push` does
                // the focus swap, so this must not also do it — an earlier draft used
                // `std::mem::replace` here and then read `self.focus` inside the `push` call, which
                // both double-moved and failed to borrow-check.
                //
                // The `AppR` frame decomposes THE SAME `App` node the popped `AppL` did — only the
                // side the focus sits on changes — so it inherits that frame's tag rather than
                // re-reading one from anywhere.
                Frame::AppL { arg, owner, .. } => {
                    let fun = self.focus.clone();
                    let sib = fun.depth();
                    self.push(|saved_depth| Frame::AppR { fun, saved_depth, owner }, sib, arg);
                    return true;
                }
                // Both children searched, or a binder body was: keep climbing. This DOES rebuild the
                // parent term — one allocation per level — because the search needs the parent as a
                // term to decide where to go next (into `AppR`'s sibling, or up again). Tag-carrying,
                // for `term()`'s reason: `app` here would compare equal and be silently untagged.
                Frame::AppR { fun, owner, .. } => {
                    self.climbs += 1;
                    self.focus = app_tagged_for_rebuild(fun, self.focus.clone(), owner);
                }
                Frame::AbsBody { name, .. } => {
                    self.climbs += 1;
                    self.focus = abs(name, self.focus.clone());
                }
            }
        }
        false
    }

    /// Reposition at the leftmost-outermost redex by rebuilding the root and restarting the search from
    /// the top. **Used only for the FIRST step** — `seek_resuming` handles every later one, and the
    /// difference between them is the entire optimization this cursor exists to measure.
    fn seek_from_root(&mut self) -> bool {
        #[cfg(test)]
        {
            self.seek_calls_from_root += 1;
        }
        // Rebuilt once here rather than maintained: `seek_from_root` restarts from the root by
        // definition, and Task 5 is what stops calling it every step.
        //
        // **`self.term()` MUST be called before the stack is cleared.** It folds `self.stack` to
        // rebuild the root, so it needs the stack still intact; calling it after `self.stack.clear()`
        // folds nothing and silently truncates the term to the current focus. This ordering is
        // load-bearing — getting it backwards here was the Critical finding this file's history
        // remembers.
        self.focus = self.term();
        self.stack.clear();
        self.depth_add = 0;
        self.depth_floor = 0;
        loop {
            if self.descend_to_redex() {
                return true;
            }
            if !self.advance() {
                return false;
            }
        }
    }

    /// Find the next redex **without returning to the root**, using what the previous step
    /// established: everything strictly to the left of the focus is redex-free, and a rewrite at the
    /// focus cannot have changed it.
    ///
    /// **ONLY THE IMMEDIATE PARENT CAN HAVE BECOME A REDEX, and the proof is short enough to keep
    /// here.** An ancestor `A_i` is a redex iff it is an `App` whose function child is an `Abs`. Its
    /// function child lies on the path only if the frame at `A_i` is `AppL`, in which case that child
    /// is `A_{i-1}` (or the focus, at `i = 1`). For `i >= 2`, `A_{i-1}` is whatever the NEXT frame
    /// toward the stack top — the one pushed after `A_i`'s own frame, one step closer to the focus, NOT
    /// one step closer to the root — descended through: an `App` if that frame is `AppL`/`AppR`, or an
    /// `Abs` if it is `AbsBody`.
    ///
    /// The `AppL`/`AppR` case needs one more step than "it's an `App`, not an `Abs`" to rule `A_i` out.
    /// That alone only shows `A_{i-1}` did not just BECOME an `Abs` since the last step — the
    /// "unchanged" fact above — not that `A_i` was never a redex to begin with. For `AppR` specifically:
    /// an `AppR` frame is only ever pushed by `advance`, after `descend_to_redex` already searched the
    /// `fun` it carries and found no redex there — which includes `fun` itself not being an `Abs`,
    /// because `descend_to_redex` checks exactly that the instant it pushes the `AppL` that reaches
    /// `fun`, and returns immediately if it is. So `A_{i-1}` (`= fun`) was never an `Abs`, at this step
    /// or any prior one, which is what closes the gap the "unchanged" argument alone leaves open. For
    /// `AppL`, `A_{i-1}` is `A_i`'s own function child, reached the same way, so the same reasoning
    /// applies to it too.
    ///
    /// If instead that next frame is `AbsBody`, `A_{i-1}` is an `Abs`. But an `AppL` frame pushed
    /// immediately after an `AbsBody` frame (closer to the focus, i.e. above it on the stack) would
    /// mean `A_i = App(Abs(..), _)`, which was *already* a redex before this step, so normal order
    /// would have reduced it rather than descending past it into the `Abs` body. Contradiction — this
    /// case cannot put an `AppL` frame at `A_i`. Only `i = 1` survives.
    ///
    /// **The step-1 parent check below is not merely an optimization — it is what PRESERVES the
    /// invariant this proof depends on: no `AppL` frame ever sits immediately above an `AbsBody`
    /// frame.** Remove it and the very next `descend_to_redex` call, finding the current focus (an
    /// `Abs`, precisely because step 1 didn't fire) redex-free at the top, pushes `AbsBody` onto
    /// whatever frame is already on top of the stack — which can be `AppL`, exactly the configuration
    /// the paragraph above shows cannot coexist with normal order. Once it does, this proof's premises
    /// no longer hold and the search stops finding the reduced parent, breaking normal order.
    ///
    /// So the climb is one conditional, not a scan — which is what makes resumption cheaper than the
    /// restart it replaces rather than merely different from it.
    fn seek_resuming(&mut self) -> bool {
        // 1. The parent, if the reduct just turned it into a redex. Outermore than anything inside the
        //    focus, so normal order requires taking it first.
        if matches!(self.focus.node(), Node::Abs(..)) && matches!(self.stack.last(), Some(Frame::AppL { .. })) {
            return true;
        }
        // 2. Otherwise: inside the reduct, then rightward and upward.
        loop {
            if self.descend_to_redex() {
                return true;
            }
            if !self.advance() {
                return false;
            }
        }
    }

    /// Reduce the redex the invariant points at, in place. **The `App` node is never built:** the
    /// focus is `Abs(_, body)` and the popped frame holds `arg`, which is everything `beta` needs.
    /// Returns the path to the redex `App` — the stack path *after* popping, since the `App` sits one
    /// level above the function side the invariant descends to — and the construct the step belongs to.
    ///
    /// **THE TAG COMES OFF THE POPPED FRAME, BECAUSE THE `App` IT BELONGED TO IS NEVER RECONSTRUCTED.**
    /// That is the whole reason `Frame::AppL` carries one. `reduce_step_go` reads the same tag straight
    /// off the node it is about to contract; there is no such node here.
    ///
    /// **THE ENCLOSING TAG IS READ AFTER THE POP, SO THE SCAN EXPRESSES THE RELATION RATHER THAN
    /// COINCIDING WITH IT.** `reduce_step_go`'s `enclosing` is the innermost tag STRICTLY ABOVE the
    /// redex, and after the pop the redex's own frame is gone, so a reverse walk of what remains is
    /// exactly that. **Scanning before the pop was measured and is observationally identical today** —
    /// the redex's own frame answers `Some` only when the redex is tagged, and then the `(Some(id), _)`
    /// arm below takes `Exact` without consulting `enclosing` at all; when it is untagged it answers
    /// `None` and `find_map` skips it either way. It is written this way regardless because the
    /// equivalence is a consequence of `Exact` outranking `Within` in one `match` two lines down, not of
    /// anything about the stack: reorder those arms and the pre-pop version starts reporting
    /// `Within(self)`, which is not a claim this type can make.
    ///
    /// The scan is a reverse walk of the context stack rather than a descent because a stack is what is
    /// available here — same relation, different route, which is exactly what
    /// `tests/zipper_equivalence.rs` exists to hold equal.
    fn reduce_here(&mut self) -> (Path, Owner) {
        let Node::Abs(_, body) = self.focus.node() else {
            unreachable!("the seek invariant guarantees an Abs focus");
        };
        let body = body.clone();
        let Some(Frame::AppL { arg, owner, .. }) = self.pop() else {
            unreachable!("the seek invariant guarantees an AppL top frame");
        };
        let enclosing = self.stack.iter().rev().find_map(Frame::owner);
        let who = match (owner, enclosing) {
            (Some(id), _) => Owner::Exact(id),
            (None, Some(id)) => Owner::Within(id),
            (None, None) => Owner::None,
        };
        self.focus = beta(&body, &arg);
        (self.path(), who)
    }
}

impl Iterator for ZipperCursor {
    type Item = StepEvent;

    fn next(&mut self) -> Option<StepEvent> {
        if self.status.is_some() {
            return None;
        }
        if self.steps >= self.cap {
            self.status = Some(Status::HitCap);
            return None;
        }
        // Checked BEFORE the step and the term left unreduced when it fires — the contract
        // `LambdaCursor` carries, held here by `root_depth` rather than by a stored field.
        if self.root_depth() > MAX_TERM_DEPTH {
            self.status = Some(Status::HitCap);
            return None;
        }
        // THE OPTIMIZATION, in one line. The first step has no context to resume from; every later one
        // does, and rebuilding the root to throw it away again is exactly the `Σ path` cost this cursor
        // exists to remove.
        let found = if self.steps == 0 { self.seek_from_root() } else { self.seek_resuming() };
        if !found {
            self.status = Some(Status::Normalized);
            return None;
        }
        let (redex, owner) = self.reduce_here();
        self.steps += 1;
        Some(StepEvent::Beta { redex, owner })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lambda::MAX_REDUCTION_STEPS;
    use crate::lambda::term::{abs, app, app_owned, var};

    /// The fixture is TAGGED on purpose: the redex `App` carries 11 and sits under a tagged outer `App`
    /// (5) whose function side is a bare `Var`, so the outer one is not itself a redex. The expected
    /// owner is `Exact(11)` rather than `Owner::None` — an untagged fixture would compare `None` against
    /// `None` and hold nothing about the tag at all.
    #[test]
    fn one_beta_step_matches_the_reducer_and_reports_the_app_path() {
        use crate::lambda::reduce::reduce_step;
        let t = app_owned(var(9), abs("z", app_owned(abs("x", var(0)), var(1), 11)), 5);
        let (expected_term, expected_path, expected_owner) = reduce_step(&t).expect("the term has a redex");
        assert_eq!(expected_owner, Owner::Exact(11), "the fixture must exercise a real tag, not Owner::None");

        let mut z = ZipperCursor::new(&t, MAX_REDUCTION_STEPS);
        let ev = z.next().expect("one step");
        assert_eq!(ev, StepEvent::Beta { redex: expected_path, owner: expected_owner });
        assert_eq!(z.term(), expected_term, "the zipper's term must equal the reducer's");
        assert_eq!(z.steps_taken(), 1);
    }

    #[test]
    fn the_depth_guard_fires_before_the_step_and_leaves_the_term_alone() {
        use crate::lambda::reduce::MAX_TERM_DEPTH;
        let mut deep = app(abs("x", var(0)), var(0));
        for _ in 0..=MAX_TERM_DEPTH {
            deep = abs("d", deep);
        }
        let mut z = ZipperCursor::new(&deep, 1_000);
        assert_eq!(z.next(), None, "a term past MAX_TERM_DEPTH must not be stepped");
        assert_eq!(z.status(), Some(Status::HitCap));
        assert_eq!(z.steps_taken(), 0);
        assert_eq!(z.term(), deep, "the term must be left unreduced");
    }

    /// **The boundary the test above cannot see.** `root_depth() >= MAX_TERM_DEPTH` instead of `>`
    /// passes the test above too — it only ever builds a term strictly past the limit. This fixture
    /// sits at depth EXACTLY `MAX_TERM_DEPTH`, the one point where `>` and `>=` disagree, and pins the
    /// guard to `depth_exceeds`'s `t.depth() > limit` (`reduce.rs`) rather than to a stricter relative.
    ///
    /// Same base term as the test above (`app(abs("x", var(0)), var(0))`, depth 2 — one `Abs` inside
    /// one `App`), but wrapped `MAX_TERM_DEPTH - 2` times instead of `MAX_TERM_DEPTH + 1`: each `abs`
    /// wrapper adds exactly 1 to depth, so `2 + (MAX_TERM_DEPTH - 2) = MAX_TERM_DEPTH` on the nose.
    #[test]
    fn the_depth_guard_does_not_fire_at_exactly_max_term_depth() {
        use crate::lambda::reduce::MAX_TERM_DEPTH;
        let mut deep = app(abs("x", var(0)), var(0));
        for _ in 0..(MAX_TERM_DEPTH - 2) {
            deep = abs("d", deep);
        }
        assert_eq!(deep.depth(), MAX_TERM_DEPTH, "fixture must sit exactly at the boundary");

        let mut z = ZipperCursor::new(&deep, 1_000);
        assert!(z.next().is_some(), "a term AT exactly MAX_TERM_DEPTH must still be steppable");
        assert_eq!(z.status(), None, "the guard must not fire at the boundary");
    }

    #[test]
    fn a_fresh_zipper_reconstructs_the_term_it_was_built_from() {
        let t = app(abs("x", app(var(0), var(1))), abs("y", var(0)));
        let z = ZipperCursor::new(&t, MAX_REDUCTION_STEPS);
        assert_eq!(z.term(), t, "an unmoved zipper must fold back to its input");
        assert_eq!(z.path(), Vec::<Dir>::new(), "an unmoved zipper is at the root");
        assert_eq!(z.steps_taken(), 0);
        assert_eq!(z.status(), None);
    }

    /// Positions the redex `(\x. x) y` inside `\z. ((\x. x) y)`, so the seek has to descend through an
    /// `AbsBody` and then past the `App` into its function side.
    #[test]
    fn seek_lands_on_the_leftmost_outermost_redex_with_the_invariant_holding() {
        let redex = app(abs("x", var(0)), var(1));
        let t = abs("z", redex);
        let mut z = ZipperCursor::new(&t, MAX_REDUCTION_STEPS);

        assert!(z.seek_from_root(), "the term has a redex");
        assert!(matches!(z.focus.node(), Node::Abs(..)), "focus must be the Abs of the redex");
        assert!(matches!(z.stack.last(), Some(Frame::AppL { .. })), "top frame must be AppL");
        // The path to the redex APP is the stack minus the AppL frame that reaches its function side.
        assert_eq!(z.path(), vec![Dir::AbsBody, Dir::AppL]);
        assert_eq!(z.term(), t, "seeking must not change the term");
    }

    /// **`term()`'s fold direction, which Task 1's test structurally could not reach** — it only ever
    /// had an empty stack, so a reversed fold would have passed it. Now that `descend_to_redex` can
    /// build a non-trivial stack, use it: the term is asymmetric at both levels, so folding outward
    /// from the wrong end produces a differently-nested term rather than an equal one.
    #[test]
    fn term_folds_the_context_stack_in_the_right_direction() {
        let t = abs("f", app(app(abs("x", var(0)), var(1)), var(2)));
        let mut z = ZipperCursor::new(&t, MAX_REDUCTION_STEPS);
        assert!(z.seek_from_root(), "the term has a redex");
        assert!(z.stack.len() >= 2, "the fixture must build a multi-level stack, got {}", z.stack.len());
        assert_eq!(z.term(), t, "folding a non-empty stack must reconstruct the original term");
    }

    #[test]
    fn seek_reports_normal_form_when_there_is_no_redex() {
        let t = abs("z", app(var(0), var(1)));
        let mut z = ZipperCursor::new(&t, MAX_REDUCTION_STEPS);
        assert!(!z.seek_from_root(), "a term with no redex has none to find");
        assert_eq!(z.term(), t, "a failed seek must leave the term intact");
    }

    /// **THE ONLY TEST THAT CAN SEE THE OPTIMIZATION AT ALL.** Resumption and a correct-but-unoptimized
    /// restart produce identical events, identical terms and identical statuses — that is the whole
    /// point of `zipper_equivalence.rs`, and it means the equivalence gate passes just as happily with
    /// the optimization removed. `seek_calls_from_root` is the only observable that distinguishes them,
    /// which is why it exists.
    ///
    /// The fixture reduces in several steps, so a cursor that restarted every time would count one root
    /// seek per step rather than one in total.
    #[test]
    fn resuming_keeps_the_context_stack_rather_than_rebuilding_it() {
        let t = term_of("let x = 1; let y = x + x; y * 3");
        let mut z = ZipperCursor::new(&t, MAX_REDUCTION_STEPS);
        let steps = z.by_ref().count();

        assert!(steps > 3, "the fixture must take several steps for this to mean anything, took {steps}");
        assert_eq!(
            z.seek_calls_from_root, 1,
            "only the FIRST step may start at the root; {steps} steps produced {} root seeks",
            z.seek_calls_from_root
        );
    }

    /// Lower a source program to a λ term, so a fixture can be a program rather than a hand-built term
    /// when what matters is that it takes a realistic number of steps.
    fn term_of(src: &str) -> LambdaTerm {
        let (prog, ds) = crate::parser::parse(src);
        assert!(ds.is_empty(), "fixture must parse cleanly: {ds:?}");
        crate::lambda::lower(&crate::desugar::desugar(&prog.expect("fixture must parse"))).expect("fixture must lower")
    }

    /// **Critical regression test.** Before the fix, `seek_from_root` cleared the stack before calling
    /// `term_at_root`, so a second call — made from a non-root position, exactly how a real caller
    /// uses it between reduction steps — folded an already-empty stack and silently discarded every
    /// popped frame's sibling. The term collapsed to `\x. x`, having dropped `z`'s binder and the
    /// argument `y` along with it.
    #[test]
    fn seek_from_root_rebuilds_the_whole_term_before_restarting() {
        let t = abs("z", app(abs("x", var(0)), var(1)));
        let mut z = ZipperCursor::new(&t, MAX_REDUCTION_STEPS);

        assert!(z.seek_from_root(), "the term has a redex");
        // The zipper is now away from the root — exactly the position a caller would be in when it
        // calls `seek_from_root` again to look for the next redex.
        assert!(!z.path().is_empty(), "the fixture must leave the zipper away from the root");

        assert!(z.seek_from_root(), "seeking a second time, from a non-root position, must still find it");
        assert_eq!(z.term(), t, "the whole term must survive a second seek from a non-root position");
    }

    /// Exercises the O(1) whole-term depth accounting that `root_depth` is the only remaining home
    /// for. The arithmetic itself is not under test here (it was independently verified and must not
    /// change) — only that `root_depth()` agrees with `t.depth()` at every position a caller can
    /// observe it from, and that the `(depth_add, depth_floor)` pair is all-zero exactly when the
    /// zipper is back at the root.
    #[test]
    fn root_depth_tracks_the_whole_terms_depth_at_every_position() {
        // `depth()` is 5 here, and a `push` with the `max(self.depth_floor, ...)` deleted reports 4 —
        // this fixture is chosen to make that `max` load-bearing, which the earlier flat-App fixture did
        // not.
        let t = abs("f", app(app(abs("x", var(0)), var(1)), abs("a", abs("b", abs("c", var(0))))));
        let mut z = ZipperCursor::new(&t, MAX_REDUCTION_STEPS);

        assert_eq!(z.root_depth(), t.depth(), "before seeking, the focus IS the whole term");

        assert!(z.descend_to_redex(), "the fixture has a redex");
        assert_eq!(z.root_depth(), t.depth(), "descending to the redex must not change the whole-term depth");

        assert!(z.advance(), "there is more of the term left to search after the redex position");
        assert_eq!(z.root_depth(), t.depth(), "advancing must not change the whole-term depth");

        // Drain the rest of the search by hand — mirroring `seek_from_root`'s loop without calling it
        // — until it climbs back out to the root, checking the invariant at every stop along the way.
        loop {
            z.descend_to_redex();
            assert_eq!(z.root_depth(), t.depth(), "the invariant must hold at every position, not just the redex");
            if !z.advance() {
                break;
            }
        }
        assert_eq!((z.depth_add, z.depth_floor), (0, 0), "back at the root, nothing should still be pushed");
        assert_eq!(z.term(), t, "the walk must reconstruct the original term when it returns to the root");
    }

    /// A redex nested inside another redex's ARGUMENT: `(\x. x) ((\y. y) w)`. Leftmost-outermost order
    /// must pick the OUTER redex; a leftmost-INNERMOST search would instead descend into the argument
    /// and find the inner one, which `path()` would show as a longer path than `[AppL]`.
    #[test]
    fn seek_prefers_the_outer_redex_when_one_is_nested_in_another() {
        let t = app(abs("x", var(0)), app(abs("y", var(0)), var(1)));
        let mut z = ZipperCursor::new(&t, MAX_REDUCTION_STEPS);

        assert!(z.seek_from_root(), "the term has a redex");
        assert_eq!(
            z.path(),
            vec![Dir::AppL],
            "leftmost-outermost must pick the outer redex, not the one nested in its argument"
        );
    }

    /// A redex nested inside another redex's BODY: `(\x. (\y. y) x) w`. The outer `App` is itself a
    /// redex the instant it is reached, so `descend_to_redex` must stop there rather than continue
    /// into the `Abs` body looking for the inner one.
    #[test]
    fn seek_prefers_the_outer_redex_when_nested_in_its_body() {
        let t = app(abs("x", app(abs("y", var(0)), var(0))), var(1));
        let mut z = ZipperCursor::new(&t, MAX_REDUCTION_STEPS);

        assert!(z.seek_from_root(), "the term has a redex");
        assert_eq!(
            z.path(),
            vec![Dir::AppL],
            "leftmost-outermost must pick the outer redex, not the one nested in its body"
        );
    }

    /// **THE ONLY TEST THAT CAN SEE `climbs` AT ALL.** Deleting `climbs += 1` from both arms in
    /// `advance` passes every other test in this tree — nothing else observes the counter, even though
    /// it is the quantity behind `lambda_sharing_probe.rs` PART D's "99.0% of the ceiling" measurement
    /// (`net = Σ path − climbs`). `seek_calls_from_root`, a purely diagnostic counter with no bearing on
    /// any published number, has its own dedicated test above
    /// (`resuming_keeps_the_context_stack_rather_than_rebuilding_it`); this is the same coverage for the
    /// counter that actually feeds a headline claim.
    ///
    /// `t = (v0 (\x. x)) ((\y. y) v1)`. The only redex is the right branch, `(\y. y) v1`; the left
    /// branch, `v0 (\x. x)`, holds none — `v0` is a bare `Var` (not reducible), and `\x. x` alone (not
    /// applied to anything) is not a redex either. Reaching the right branch costs exactly two climbs:
    /// `descend_to_redex` first pushes into the left branch's function side (`v0`) and finds no redex
    /// there; `advance` then swaps to the sibling `\x. x` (an `AppL` pop, which is a sibling swap, NOT a
    /// climb) and `descend_to_redex` finds no redex there either. Now BOTH of the left branch's children
    /// are exhausted, so `advance` must climb OUT of it: one climb to leave the `AbsBody` (`\x. x`
    /// itself), one more to leave the `AppR` holding `v0` (the whole left branch, `App(v0, \x. x)`) —
    /// before the outer `AppL` pop (a sibling swap into the right branch, not a climb) reaches the
    /// redex. `climbs() == 2`: one exhausted `App` in the path is not enough to force a climb out past
    /// it (a sibling swap suffices for the innermost one), so this fixture nests an `Abs` inside it to
    /// force a second.
    #[test]
    fn climbs_counts_exactly_the_frames_popped_past_an_exhausted_subtree() {
        let left = app(var(0), abs("x", var(0)));
        let right = app(abs("y", var(0)), var(1));
        let t = app(left, right);

        let mut z = ZipperCursor::new(&t, MAX_REDUCTION_STEPS);
        assert!(z.seek_from_root(), "the fixture's right branch has a redex");
        assert_eq!(z.climbs(), 2, "one climb to leave `\\x. x`, one more to leave `v0 (\\x. x)` itself");
    }
}
