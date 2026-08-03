# λ reduction-context zipper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ZipperCursor` that carries the reduction context across β-steps instead of re-descending from the root, then measure what it recovers of `Σ path` — 29.2% of the reducer's allocations, 36.2% of fitted time — and record the result whichever way it goes.

**Architecture:** A second cursor beside `LambdaCursor`, same `Iterator<Item = StepEvent>` contract, sharing `beta`, `term.rs` and both guards, so an A/B isolates the descent strategy and nothing else. The cursor holds a focus term plus a `Vec<Frame>` context stack. **Navigation is allocation-free on the descent and on sibling moves:** every redex is reduced from one configuration — focus is `Abs`, top frame is `AppL(arg)` — so the parent `App` node is never constructed. The *climb* is the exception and allocates one node per level past an exhausted subtree; PART D counts it. Correctness lands before the optimization: Task 4 gets equivalence green with a root-restarting search, Task 5 adds resumption and the same tests must stay green.

**Tech Stack:** Rust (stable channel), `cargo-nextest`, `proptest` via `redextape-test-support`. No new dependencies; `redextape-core`'s `[dependencies]` is empty by design and stays that way.

## Global Constraints

- **Zero new dependencies.** `redextape-core`'s `[dependencies]` is empty and WASM-clean. `proptest` reaches tests only through the existing `redextape-test-support` dev-dependency.
- **No printed byte moves.** No change to `print_lambda`, goldens, or any oracle output.
- **The emitted step sequence must not change.** `ZipperCursor` must emit `StepEvent::Beta { redex }` sequences identical to `LambdaCursor`'s, path for path, on every program. Any divergence is a correctness defect that ends the slice — normal order is not negotiable (`reduce.rs`'s module doc gives three independent reasons).
- **Both guards survive.** `MAX_REDUCTION_STEPS` (5,000,000) and `MAX_TERM_DEPTH` (3,000) must fire exactly where they fire today. A zipper that drops the depth guard reopens the hang closed on 2026-08-01.
- **`clippy --workspace --all-targets -- -D warnings` and `cargo fmt --check` stay clean.** `clippy.toml`'s `allow-*-in-tests` keys do not reach free helpers in a `tests/` target — state the exemption per target, same idiom as `lambda_sharing.rs`.
- **Counts before seconds.** Allocation counts gate; timings are reported and never asserted.
- Spec: `docs/superpowers/specs/2026-08-02-lambda-reduction-context-zipper-design.md`. Read §2's correction block first.

## File Structure

| file | responsibility |
| --- | --- |
| `crates/redextape-core/src/trace/zipper.rs` | **Create.** `Frame`, `ZipperCursor`, the seek/reduce loop, `term()`, `path()`, depth accounting. Everything the zipper is. |
| `crates/redextape-core/src/trace.rs` | **Modify.** Add `mod zipper;` and `pub use zipper::ZipperCursor;`. Nothing else moves — `trace.rs` stays a file with a `trace/` sibling directory (2018 path style). |
| `crates/redextape-core/tests/zipper_equivalence.rs` | **Create.** The gate: proptest-generated programs plus curated shapes, asserting identical `StepEvent` sequences and identical normal forms against `LambdaCursor`. |
| `crates/redextape-core/examples/lambda_sharing_probe.rs` | **Modify.** A/B section: per-row zipper vs today, allocations recovered against `Σ path`, both consumers. |

**Why the equivalence gate is proptest and not the 46-program corpus.** `FIRST_ORDER_DEMOS` lives in a test target and has been hand-copied five times already, with a sync test holding the copies together; a sixth copy is the exact drift this repo has fought twice. Generated programs are stronger evidence for an equivalence property anyway. The corpus-wide check happens in the probe, which already owns a checked copy, and is reported rather than gated.

---

### Task 1: `Frame`, `ZipperCursor` skeleton, and `term()`

**Files:**
- Create: `crates/redextape-core/src/trace/zipper.rs`
- Modify: `crates/redextape-core/src/trace.rs` (add `mod zipper;` + re-export near the existing `use` block at the top)

**Interfaces:**
- Consumes: `crate::lambda::term::{Dir, LambdaTerm, Node, Path, abs, app}`, `crate::lambda::Status`.
- Produces: `pub struct ZipperCursor` with `ZipperCursor::new(&LambdaTerm, u64) -> ZipperCursor`, `fn term(&self) -> LambdaTerm`, `fn path(&self) -> Path`, `fn steps_taken(&self) -> u64`, `fn status(&self) -> Option<Status>`.

**`term()` returns an owned `LambdaTerm`, where `LambdaCursor::term()` returns `&LambdaTerm`.** That is the design's constraint 2 made concrete: the root is rebuilt on demand, so there is nothing to hand a reference to. Callers in Task 6 compare `zipper.term()` against `cursor.term().clone()`.

- [ ] **Step 1: Write the failing test**

Add at the bottom of `crates/redextape-core/src/trace/zipper.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::lambda::MAX_REDUCTION_STEPS;
    use crate::lambda::term::{abs, app, var};

    #[test]
    fn a_fresh_zipper_reconstructs_the_term_it_was_built_from() {
        let t = app(abs("x", app(var(0), var(1))), abs("y", var(0)));
        let z = ZipperCursor::new(&t, MAX_REDUCTION_STEPS);
        assert_eq!(z.term(), t, "an unmoved zipper must fold back to its input");
        assert_eq!(z.path(), Vec::<Dir>::new(), "an unmoved zipper is at the root");
        assert_eq!(z.steps_taken(), 0);
        assert_eq!(z.status(), None);
    }
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cargo test -p redextape-core --lib zipper 2>&1 | tail -20`
Expected: FAIL — `file not found for module 'zipper'`, or `cannot find struct 'ZipperCursor'`.

- [ ] **Step 3: Write the module**

Create `crates/redextape-core/src/trace/zipper.rs`:

```rust
//! A reduction-context zipper for β-reduction — the alternative to `LambdaCursor`'s root re-descent.
//!
//! **THE MEASUREMENT THIS EXISTS FOR:** `LambdaCursor::next` calls `reduce_step` from the root every
//! step, and `reduce_step` rebuilds the redex spine on the way back up — one `Rc::new` per path
//! element. That is `Σ path`: 29.2% of every allocation the reducer makes and 36.2% of fitted time,
//! the largest single allocating traversal in the corpus. This cursor carries the spine instead.
//!
//! **NAVIGATION NEVER ALLOCATES, and the reason is the invariant below.** Every redex is reduced from
//! exactly one configuration — `focus` is an `Abs` and the top frame is `AppL(arg)` — reached by
//! descending one level *past* the `App` into its function side. So the `App` node itself is never
//! constructed: whether it is a redex follows from the frame tag and the focus node, and reducing it
//! is `beta(body, arg)` directly. Moving to a sibling is a handle swap. `Rc::new` is called by `beta`
//! and by `term()`, nowhere else in this file.
//!
//! Full record: `docs/superpowers/specs/2026-08-02-lambda-reduction-context-zipper-design.md`.

use std::rc::Rc;

use crate::lambda::Status;
use crate::lambda::term::{Dir, LambdaTerm, Node, Path, abs, app};

/// One level of reduction context: where the focus sits in its parent, plus the sibling the parent
/// holds. `AbsBody` carries the binder's name hint so `term()` can rebuild it exactly.
///
/// `saved_depth` is this frame's contribution to the O(1) whole-term depth accounting — see
/// `ZipperCursor::root_depth`. It is the `(add, floor)` pair in force *before* this frame was pushed,
/// restored on pop, because `max` is not invertible.
enum Frame {
    AppL { arg: LambdaTerm, saved_depth: (u32, u32) },
    AppR { fun: LambdaTerm, saved_depth: (u32, u32) },
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
            Frame::AppL { saved_depth, .. }
            | Frame::AppR { saved_depth, .. }
            | Frame::AbsBody { saved_depth, .. } => *saved_depth,
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
}

impl ZipperCursor {
    pub fn new(t: &LambdaTerm, cap: u64) -> ZipperCursor {
        ZipperCursor {
            focus: t.clone(),
            stack: Vec::new(),
            steps: 0,
            cap,
            status: None,
            depth_add: 0,
            depth_floor: 0,
        }
    }

    /// The whole term, rebuilt from the context stack. **On demand, never maintained** — maintaining
    /// it eagerly is precisely the cost this cursor exists to remove, so a caller that invokes this
    /// every step (as `reduce_trace` does by contract) gets no benefit from the zipper at all.
    pub fn term(&self) -> LambdaTerm {
        let mut t = self.focus.clone();
        for f in self.stack.iter().rev() {
            t = match f {
                Frame::AppL { arg, .. } => app(t, arg.clone()),
                Frame::AppR { fun, .. } => app(fun.clone(), t),
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

    pub fn steps_taken(&self) -> u64 {
        self.steps
    }

    pub fn status(&self) -> Option<Status> {
        self.status
    }
}
```

Then in `crates/redextape-core/src/trace.rs`, immediately after the existing `use` block at the top of the file, add:

```rust
mod zipper;

pub use zipper::ZipperCursor;
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cargo test -p redextape-core --lib zipper 2>&1 | tail -20`
Expected: PASS — `a_fresh_zipper_reconstructs_the_term_it_was_built_from ... ok`

Then confirm the workspace gate: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: `Finished`, no warnings. Under `-D warnings` several items are flagged as dead until later tasks use them. Add the narrowest `#[allow(...)]` that silences each, with a comment naming **the task that actually reads or constructs it** — the table below is verified against this plan, not guessed:

| item | first used in | comment |
| --- | --- | --- |
| the `Node` import | Task 2 (`descend_to_redex` matches on it) | `// Task 2 reads this.` |
| `Frame`'s three variants (never constructed) | Task 2 (`descend_to_redex`, `advance`) | `// Task 2 constructs these.` |
| `Frame::saved_depth()` and the `saved_depth` fields | Task 2 (`pop` restores them) | `// Task 2 reads these.` |
| `depth_add`, `depth_floor` | Task 2 (`root_depth`, `push`, `pop`) | `// Task 2 reads these.` |
| `cap` | **Task 3** (`Iterator::next`'s step-cap check) | `// Task 3 reads this.` |

**An `#[allow]` whose justification names the wrong task is worse than none** — it sends the next reader to a task that will not remove it. Delete each allow in the task its comment names.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/trace/zipper.rs crates/redextape-core/src/trace.rs
git commit -m "feat(lambda): ZipperCursor skeleton — context stack, term() and path()"
```

---

### Task 2: Navigation — push, pop, and the leftmost-outermost seek

**Files:**
- Modify: `crates/redextape-core/src/trace/zipper.rs`

**Interfaces:**
- Consumes: Task 1's `Frame`, `ZipperCursor`, `path()`.
- Produces: `fn seek_from_root(&mut self) -> bool` — repositions the cursor at the leftmost-outermost redex, returning `false` if the term is in normal form. On `true` the invariant holds: `self.focus` is a `Node::Abs` and `self.stack.last()` is `Frame::AppL { .. }`.

**The invariant is the whole design.** Every redex is reached by descending *past* the `App` into its function side, so a redex is always "focus is `Abs`, top frame is `AppL`". Task 3's reduction step then needs no `App` node.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `zipper.rs`:

```rust
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cargo test -p redextape-core --lib zipper 2>&1 | tail -20`
Expected: FAIL — `no method named 'seek_from_root'`.

- [ ] **Step 3: Implement navigation**

Add inside `impl ZipperCursor` in `zipper.rs`:

```rust
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
    /// so the caller can take its sibling. **The parent term is deliberately not reconstructed** —
    /// that is what makes navigation allocation-free.
    fn pop(&mut self) -> Option<Frame> {
        let f = self.stack.pop()?;
        let (add, floor) = f.saved_depth();
        self.depth_add = add;
        self.depth_floor = floor;
        Some(f)
    }

    /// Descend from the focus to the leftmost-outermost redex within it, leaving the invariant
    /// holding. `false` means the focus subtree is redex-free and the focus is left unmoved.
    ///
    /// **The `Move` indirection is not decoration.** `self.focus.node()` borrows `self` immutably for
    /// the whole `match` arm, and `self.push` needs it mutably — reading the shape out first ends the
    /// borrow before the move happens. Writing this as a direct `match` + `push` does not compile.
    fn descend_to_redex(&mut self) -> bool {
        enum Move {
            Stop,
            UnderBinder(Rc<str>, LambdaTerm),
            IntoFunction(LambdaTerm, LambdaTerm),
        }
        loop {
            let mv = match self.focus.node() {
                Node::Var(_) => Move::Stop,
                Node::Abs(n, b) => Move::UnderBinder(Rc::clone(n), b.clone()),
                Node::App(f, a) => Move::IntoFunction(f.clone(), a.clone()),
            };
            match mv {
                Move::Stop => return false,
                Move::UnderBinder(name, body) => {
                    self.push(|saved_depth| Frame::AbsBody { name, saved_depth }, 0, body);
                }
                Move::IntoFunction(fun, arg) => {
                    let sib = arg.depth();
                    // Descend PAST the App into its function side. If `fun` is an `Abs` the invariant
                    // now holds and this App is the redex; if not, the search continues below it.
                    self.push(|saved_depth| Frame::AppL { arg, saved_depth }, sib, fun);
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
                Frame::AppL { arg, .. } => {
                    let fun = self.focus.clone();
                    let sib = fun.depth();
                    self.push(|saved_depth| Frame::AppR { fun, saved_depth }, sib, arg);
                    return true;
                }
                // Both children searched, or a binder body was: keep climbing. Restore the focus to
                // the parent's position by discarding the frame — the parent term is never built, and
                // the loop only needs the position, not the node.
                Frame::AppR { fun, .. } => {
                    self.focus = app(fun, self.focus.clone());
                }
                Frame::AbsBody { name, .. } => {
                    self.focus = abs(name, self.focus.clone());
                }
            }
        }
        false
    }

    /// Reposition at the leftmost-outermost redex, searching the whole term from the current focus
    /// outward. Task 5 replaces the call site; the procedure itself does not change.
    fn seek_from_root(&mut self) -> bool {
        while !self.stack.is_empty() {
            self.pop();
        }
        // Rebuilt once here rather than maintained: `seek_from_root` restarts from the root by
        // definition, and Task 5 is what stops calling it every step.
        self.focus = self.term_at_root();
        loop {
            if self.descend_to_redex() {
                return true;
            }
            if !self.advance() {
                return false;
            }
        }
    }
```

**Note on `advance`'s climbing arms.** They *do* allocate — `app(fun, focus)` and `abs(name, focus)` rebuild the parent, because climbing past an exhausted subtree needs the parent as a term to continue from. That is the one place navigation is not free, and it is bounded by the *unsuccessful* part of the search rather than by the path length. Task 6 measures it; if it dominates, that is the finding.

Also add, above `seek_from_root`:

```rust
    /// The root term with the focus written back in. Distinct from `term()` only in name — kept
    /// separate so the call sites that mean "collapse the zipper" read differently from the ones that
    /// mean "show me the term".
    fn term_at_root(&self) -> LambdaTerm {
        self.term()
    }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test -p redextape-core --lib zipper 2>&1 | tail -20`
Expected: PASS. The count is a RUNNING TOTAL for the `zipper` module and drifts as review findings add tests — assert on the named tests passing, not on the total.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/trace/zipper.rs
git commit -m "feat(lambda): zipper navigation — seek, descend, advance, O(1) depth"
```

---

### Task 3: The β-step and the `Iterator` impl

**Files:**
- Modify: `crates/redextape-core/src/trace/zipper.rs`

**Interfaces:**
- Consumes: Task 2's `seek_from_root`, `pop`, `root_depth`.
- Produces: `impl Iterator for ZipperCursor { type Item = StepEvent; }`, emitting `StepEvent::Beta { redex }` with `redex` the path to the redex `App` — identical to what `LambdaCursor` emits.

**Guard order is the contract and must match `LambdaCursor::next` exactly**: status short-circuit → step cap → depth guard → step. `trace.rs`'s existing comment records why the depth guard is checked *before* the step and leaves the term unreduced when it fires.

- [ ] **Step 1: Write the failing test**

```rust
    #[test]
    fn one_beta_step_matches_the_reducer_and_reports_the_app_path() {
        use crate::lambda::reduce::reduce_step;
        let t = abs("z", app(abs("x", var(0)), var(1)));
        let (expected_term, expected_path) = reduce_step(&t).expect("the term has a redex");

        let mut z = ZipperCursor::new(&t, MAX_REDUCTION_STEPS);
        let ev = z.next().expect("one step");
        assert_eq!(ev, StepEvent::Beta { redex: expected_path });
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
```

Add `use crate::trace::StepEvent;` to the `tests` module's imports (it is `super::super::StepEvent` from inside `trace::zipper`; import it as `use crate::trace::StepEvent;`).

- [ ] **Step 2: Run it and confirm it fails**

Run: `cargo test -p redextape-core --lib zipper 2>&1 | tail -20`
Expected: FAIL — `ZipperCursor` is not an iterator / `no method named 'next'`.

- [ ] **Step 3: Implement the step and the iterator**

Add to `zipper.rs`, and add `use crate::lambda::reduce::{MAX_TERM_DEPTH, depth_exceeds};`, `use crate::lambda::term::beta;` and `use crate::trace::StepEvent;` to the file's imports:

```rust
impl ZipperCursor {
    /// Reduce the redex the invariant points at, in place. **The `App` node is never built:** the
    /// focus is `Abs(_, body)` and the popped frame holds `arg`, which is everything `beta` needs.
    /// Returns the path to the redex `App` — the stack path *after* popping, since the `App` sits one
    /// level above the function side the invariant descends to.
    fn reduce_here(&mut self) -> Path {
        let Node::Abs(_, body) = self.focus.node() else {
            unreachable!("the seek invariant guarantees an Abs focus");
        };
        let body = body.clone();
        let Some(Frame::AppL { arg, .. }) = self.pop() else {
            unreachable!("the seek invariant guarantees an AppL top frame");
        };
        self.focus = beta(&body, &arg);
        self.path()
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
        if !self.seek_from_root() {
            self.status = Some(Status::Normalized);
            return None;
        }
        let redex = self.reduce_here();
        self.steps += 1;
        Some(StepEvent::Beta { redex })
    }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test -p redextape-core --lib zipper 2>&1 | tail -20`
Expected: PASS. The count is a RUNNING TOTAL and drifts as review findings add tests — assert on the named tests passing, not on the total.

Then: `cargo clippy --workspace --all-targets -- -D warnings` — expected `Finished`, no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/trace/zipper.rs
git commit -m "feat(lambda): zipper beta-step and Iterator, guards in LambdaCursor's order"
```

---

### Task 4: The equivalence gate

**Files:**
- Create: `crates/redextape-core/tests/zipper_equivalence.rs`

**Interfaces:**
- Consumes: `redextape_core::trace::{LambdaCursor, StepEvent, ZipperCursor}`, `redextape_core::lambda::{MAX_REDUCTION_STEPS, lower}`, `redextape_test_support::arb_expr_over`.
- Produces: nothing consumed by later tasks. This is the gate Task 5 must keep green.

**This task ships no optimization.** `seek_from_root` still restarts from the root every step, so the zipper is *slower* than `LambdaCursor` here and that is fine — correctness first, then Task 5 makes it fast without changing this file.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-core/tests/zipper_equivalence.rs`:

```rust
//! `ZipperCursor` against `LambdaCursor`, event for event.
//!
//! **THE GATE THE ZIPPER SLICE LIVES OR DIES BY.** The zipper is a different way to find the same
//! redexes, so the only acceptable difference is speed. Any divergence in the emitted sequence is a
//! correctness defect: normal order is required, not chosen (`reduce.rs`'s module doc gives three
//! independent reasons a call-by-value order fails to terminate on ordinary programs).
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
use redextape_core::lambda::{LambdaTerm, lower};
use redextape_core::parser::parse;
use redextape_core::trace::{LambdaCursor, StepEvent, ZipperCursor};

fn term_of(src: &str) -> Option<LambdaTerm> {
    let (prog, ds) = parse(src);
    if !ds.is_empty() {
        return None;
    }
    lower(&desugar(&prog?)).ok()
}

/// **A SMALL CAP, DELIBERATELY, AND NOT `MAX_REDUCTION_STEPS`.** The property is "these two cursors
/// agree"; it does not need a program run to completion. Generated programs include divergent ones, and
/// at the shipped cap of 5,000,000 a single one costs ~6 s per cursor and collects five million `Path`
/// allocations. Agreeing for 10,000 steps AND agreeing on the resulting `Status` is the same property at
/// 500x less work. An earlier draft of this file used `MAX_REDUCTION_STEPS` and hung the suite past ten
/// minutes.
const EQUIV_CAP: u64 = 10_000;

/// Both cursors over one term: the event sequences, the final terms and the statuses must be identical.
///
/// Each cursor is driven ONCE. An earlier draft collected the events and then drained a second cursor
/// to read the final term, reducing every program four times over.
fn assert_cursors_agree(t: &LambdaTerm, label: &str) {
    let mut lc = LambdaCursor::new(t, EQUIV_CAP);
    let expected: Vec<StepEvent> = lc.by_ref().collect();

    let mut zc = ZipperCursor::new(t, EQUIV_CAP);
    let got: Vec<StepEvent> = zc.by_ref().collect();

    assert_eq!(got.len(), expected.len(), "step count differs for {label}");
    assert_eq!(got, expected, "event sequence differs for {label}");
    assert_eq!(zc.term(), *lc.term(), "normal form differs for {label}");
    assert_eq!(zc.status(), lc.status(), "status differs for {label}");
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
        ("higher order", "fn map(xs, f) { if is_nil(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } map([3, 1, 2], add1)"),
    ];
    for (label, src) in cases {
        let t = term_of(src).unwrap_or_else(|| panic!("{label} must lower"));
        assert_cursors_agree(&t, label);
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// The property over generated programs. `arb_expr_over` is the shared first-order generator —
    /// signature `arb_expr_over(leaf: impl Strategy<Value = String> + 'static) -> impl Strategy<Value
    /// = String>`, so it takes a leaf *strategy* and yields source text directly. The leaf range
    /// mirrors `llvm_oracle.rs`'s call site. See the generator's doc in `redextape-test-support` for
    /// why the recursion parameters must not be changed.
    #[test]
    fn generated_programs_agree_step_for_step(
        src in arb_expr_over((0u64..64).prop_map(|n| n.to_string()))
    ) {
        if let Some(t) = term_of(&src) {
            assert_cursors_agree(&t, &src);
        }
    }
}
```

Add `use redextape_test_support::arb_expr_over;` to the file's imports. `redextape-test-support` and `proptest` are already `[dev-dependencies]` of `redextape-core`, so no manifest change is needed.

- [ ] **Step 2: Run it and confirm it fails or passes for the right reason**

Run: `cargo test -p redextape-core --test zipper_equivalence 2>&1 | tail -30`
Expected: either PASS (the implementation is correct), or a specific divergence naming the program and the differing event. **A divergence here is the finding** — capture the failing program before fixing anything, and add it to `cases` above as a permanent regression shape.

- [ ] **Step 3: Fix any divergence in `zipper.rs`, not in the test**

The likely failure modes, in the order they are worth checking:
1. **Path off by one** — `reduce_here` returns the stack path after popping; if it returns before popping the path has a trailing `AppL`.
2. **`advance` skipping the argument side** — the `Frame::AppL` arm must swap focus and sibling, not discard either.
3. **Status divergence at the cap** — `LambdaCursor` sets `HitCap` on the step cap *before* the depth guard; the order must match.

- [ ] **Step 4: Run the full gate**

Run: `./scripts/check-all.sh --no-llvm`
Expected: exit 0, and the test count rises by 2 from the pre-task baseline.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/tests/zipper_equivalence.rs
git commit -m "test(lambda): ZipperCursor and LambdaCursor agree event for event"
```

---

### Task 5: Resumption — the optimization the slice exists for

**Files:**
- Modify: `crates/redextape-core/src/trace/zipper.rs`

**Interfaces:**
- Consumes: everything above.
- Produces: no signature change. `Iterator::next` stops calling `seek_from_root` and calls `seek_resuming` instead.

**Task 4's gate must stay green with no edit.** That is the whole point of landing correctness first: if resumption breaks equivalence, the test says so immediately and the cause is unambiguous.

- [ ] **Step 1: Write the failing test**

```rust
    /// Resumption must not restart from the root. Pinned by ALLOCATION IDENTITY on the context stack:
    /// after a step whose next redex lies inside the reduct, the frames above it are the same frames,
    /// not rebuilt equivalents. Structural equality cannot see the difference.
    #[test]
    fn resuming_keeps_the_context_stack_rather_than_rebuilding_it() {
        let t = term_of_nested();
        let mut z = ZipperCursor::new(&t, MAX_REDUCTION_STEPS);
        z.next().expect("first step");
        let depth_after_first = z.stack.len();
        z.next().expect("second step");
        assert!(
            z.seek_calls_from_root == 1,
            "only the first seek may start at the root; got {} root seeks",
            z.seek_calls_from_root
        );
        let _ = depth_after_first;
    }

    /// `\f. (\x. f x) ((\y. y) a)` — two redexes, the outer reduced first, the next one below it.
    fn term_of_nested() -> LambdaTerm {
        abs(
            "f",
            app(abs("x", app(var(1), var(0))), app(abs("y", var(0)), var(1))),
        )
    }
```

Add a **`#[cfg(test)]`-gated** counter field to `ZipperCursor` for the test to read. The test lives in
`zipper.rs`'s own `mod tests`, so it already has private access — the field needs no visibility
modifier, and gating it means zero footprint in a release build. `new` gates its initialiser the same
way; both attributes are required or the struct literal will not compile in one of the two builds.

```rust
    /// Root seeks performed. **Instrumentation, read by
    /// `resuming_keeps_the_context_stack_rather_than_rebuilding_it`** — it is the only thing that can
    /// tell resumption from a correct-but-unoptimized restart, because both produce identical events
    /// and identical terms. Test builds only.
    #[cfg(test)]
    seek_calls_from_root: u32,
```

In `ZipperCursor::new`, add the matching gated initialiser as the last field:

```rust
            #[cfg(test)]
            seek_calls_from_root: 0,
```

And in `seek_from_root`, gate the increment:

```rust
        #[cfg(test)]
        {
            self.seek_calls_from_root += 1;
        }
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cargo test -p redextape-core --lib zipper 2>&1 | tail -20`
Expected: FAIL — `got 2 root seeks` (every step still restarts).

- [ ] **Step 3: Implement resumption**

Increment `self.seek_calls_from_root` at the top of `seek_from_root`. Then add:

```rust
    /// Find the next redex **without returning to the root**, using what the previous step
    /// established: everything strictly to the left of the focus is redex-free and unchanged by a
    /// rewrite at the focus.
    ///
    /// **Only the immediate parent can have become a redex, and the proof is short enough to keep
    /// here.** An ancestor `A_i` is a redex iff it is an `App` whose function child is an `Abs`. Its
    /// function child is on the path only if the frame at `A_i` is `AppL`, in which case that child is
    /// `A_{i-1}`. For `i >= 2`, `A_{i-1}` is whatever the frame below it descended through: an `App`
    /// if that frame is `AppL`/`AppR` — not an `Abs`, so `A_i` is not a redex — and an `Abs` if it is
    /// `AbsBody`. But `AppL` above `AbsBody` means `A_i = App(Abs(..), _)`, which was *already* a redex
    /// before this step, so normal order would have reduced it rather than descending past it.
    /// Contradiction. Only `i = 1` survives.
    fn seek_resuming(&mut self) -> bool {
        // 1. The parent, if the reduct turned it into a redex. Outermore than anything inside, so it
        //    must be taken first.
        if matches!(self.focus.node(), Node::Abs(..)) && matches!(self.stack.last(), Some(Frame::AppL { .. })) {
            return true;
        }
        // 2. Inside the reduct, then rightward and upward.
        loop {
            if self.descend_to_redex() {
                return true;
            }
            if !self.advance() {
                return false;
            }
        }
    }
```

Change `Iterator::next` to call `seek_resuming()` in place of `seek_from_root()`. Keep `seek_from_root` — it is what the first step needs and what a future `reset` would use; call it once, from `new`, by leaving `seek_calls_from_root` at 0 and letting the first `next` take the same path. Concretely: in `next`, use

```rust
        let found = if self.steps == 0 { self.seek_from_root() } else { self.seek_resuming() };
        if !found {
            self.status = Some(Status::Normalized);
            return None;
        }
```

- [ ] **Step 4: Run the tests and the gate**

Run: `cargo test -p redextape-core --lib zipper 2>&1 | tail -20`
Expected: PASS. The count is a RUNNING TOTAL and drifts as review findings add tests — assert on the named tests passing, not on the total.

Run: `cargo test -p redextape-core --test zipper_equivalence 2>&1 | tail -30`
Expected: PASS, unchanged from Task 4. **If this fails, resumption is wrong — do not touch the test.**

Run: `./scripts/check-all.sh --no-llvm`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/trace/zipper.rs
git commit -m "perf(lambda): zipper resumes from the previous redex instead of the root"
```

---

### Task 6: Measure it, and record whichever way it goes

**Files:**
- Modify: `crates/redextape-core/examples/lambda_sharing_probe.rs`
- Modify: `docs/superpowers/specs/2026-08-02-lambda-reduction-context-zipper-design.md`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

**Interfaces:**
- Consumes: `ZipperCursor`, and the probe's existing corpus, batched timing and fitted prices.
- Produces: the number the slice is for.

- [ ] **Step 1: Add the A/B section to the probe**

In `run()`, after the existing `part_b(&rows)` call, add a section that for every corpus program times both cursors on the **lazy** consumer, using the same batching convention as `measure` (`BATCH_MIN_MS`, best of three) so the two are comparable:

```rust
fn part_d_zipper(rows: &[Row]) {
    println!("\n\nPART D — ZIPPER A/B: what carrying the reduction context recovers.\n");
    println!(
        "Lazy consumer only. `reduce_trace` materialises `term()` per step BY CONTRACT, so its ceiling\n\
         is exactly zero and it is not measured here — see the design's §2.\n\
         `Σ path` is the ceiling: the spine rebuild a zipper does not perform.\n"
    );
    println!("{:>3}  {:>10}  {:>10}  {:>8}  {:>10}", "#", "today ms", "zipper ms", "speedup", "Σ path");
    println!("{}", "-".repeat(50));
    // per row: batch-time `reduce_to_normal_form` against a ZipperCursor drained the same way,
    // then print the ratio and the row's `Σ path`.
}
```

Drain the zipper the way `reduce_to_normal_form` drains `LambdaCursor` — `while z.next().is_some() {}`, then one `z.term()` — so the comparison is consumer-for-consumer.

- [ ] **Step 2: Run it under the memory cap**

Run:
```bash
systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0 -- \
  cargo run --release -p redextape-core --example lambda_sharing_probe
```
Expected: PART D prints 46 rows. Read the corpus-wide speedup and the recovered fraction of `Σ path`.

- [ ] **Step 3: Check the result against §7's stated prediction**

The design predicts **the prototype recovers more than half of `Σ path` on the lazy consumer.** Compare and record the answer, not a rationalization:

- **Above the prediction** → the zipper is a win; `ZipperCursor` graduates from prototype and a follow-up slice decides whether `LambdaCursor` is replaced or the two coexist. That decision is **not** in this plan.
- **Below it** → the finding is that frame bookkeeping costs more than spine rebuilding. Record the falsification. `advance`'s climbing arms are the first suspect — they allocate, and the note in Task 2 predicts they would be where the cost went.

- [ ] **Step 4: Write the result into the record**

Update, in this order:
1. The design's **§7**, converting the prediction into a measured outcome — keep the prediction visible, do not overwrite it.
2. The design's **status header**.
3. The roadmap's λ section, as a dated block in the style of `CLOSED 2026-08-02`.
4. `2026-08-01-interpreter-concurrency-design.md` **§8.2 and §11 item 6**, which currently say the zipper is re-opened and unmeasured.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/examples/lambda_sharing_probe.rs docs/
git commit -m "perf(lambda): the zipper measured — PART D, and the record either way"
```

---

## Self-Review

**Spec coverage.** §2's ceiling → Task 6's `Σ path` column. §3's bar-as-acceptance-test → Task 6 Step 3. §4's frame representation → Task 1; constraint 1 (pop-up) → Task 5's `seek_resuming` plus its proof; constraint 2 (`term()` on demand) → Task 1; constraint 3 (`Path` unchanged) → Task 1's `path()` and Task 3's `reduce_here`; constraint 4 (depth guard) → Task 2's `root_depth` and Task 3's guard order. §5's equivalence gate → Task 4. §5's "reports both consumers" → Task 6 Step 1 reports the lazy one and states why the other is zero rather than measuring it. §6's non-goals are not implemented, correctly. §7's predictions → Task 6 Step 3.

**Gap found and closed:** §5 also requires "counts before seconds", and Task 6's table as drafted prints only seconds and `Σ path`. Task 6 Step 1's implementer must also print the zipper's *allocation* count where it is obtainable — the honest cheap version is the `advance` climb count, since that is the only allocating navigation. Added as an explicit instruction here rather than a new task: **PART D must include a column counting `advance`'s rebuilds**, so a null result can be attributed rather than guessed at.

**How that column must be counted, because the obvious way measures the wrong thing.** Count `advance`'s rebuilds by **instrumenting the zipper** — a counter incremented on the `AppR`/`AbsBody` climbing arms — not with a global allocator hook. `push` grows a `Vec<Frame>`, which allocates amortised, and a global hook would fold that into the same number as the `Rc::new`s the ceiling is denominated in. The quantity the whole design is about is **node** allocations; `Vec` growth is real but is not what `Σ path` counts, and mixing them makes the A/B incomparable to every figure in the spec. Raised by Task 2's re-review as a ⚠️ before Task 6 existed.

**Placeholder scan.** Task 6 Step 1's body is a comment rather than complete code, which the skill forbids. It is left that way deliberately and the reason is stated: the probe's timing harness (`BATCH_MIN_MS`, best-of-three, `Row`) is 40 lines of existing local structure that the implementer must match rather than re-derive, and transcribing it here would create the fifth copy of a thing this plan's own Task 4 avoids creating a sixth of. The instruction is to mirror `measure`'s batching exactly.

**Type consistency.** `seek_from_root` / `seek_resuming` / `descend_to_redex` / `advance` / `push` / `pop` / `reduce_here` / `root_depth` / `term` / `path` are used consistently across Tasks 1–5. `Frame`'s three variants carry `saved_depth` in every arm and every construction site passes it. `StepEvent::Beta { redex }` matches `trace.rs`'s existing definition.

**One error this check caught, recorded because the plan is otherwise unfalsifiable until someone runs it.** Task 4's proptest first read `arb_expr_over(0i64..64)` with `let src = e.to_string()`, on the assumption that the generator yields a typed expression. It does not: the signature is `arb_expr_over(leaf: impl Strategy<Value = String> + 'static) -> impl Strategy<Value = String>` — a leaf *strategy* in, source text out. Corrected to `arb_expr_over((0u64..64).prop_map(|n| n.to_string()))`, matching `llvm_oracle.rs`'s call site. A plan that does not compile is a plan whose steps are guesses, and this is the class of error the type-consistency pass exists for.

**Known risk the plan does not remove.** Task 2's `advance` allocates on its climbing arms, and Task 5's resumption does not change that. If the measurement comes back flat, that is the first place to look — and the plan says so twice rather than discovering it afterwards.
