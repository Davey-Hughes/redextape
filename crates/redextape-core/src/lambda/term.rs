//! de Bruijn lambda-terms. Indices are 0-based (0 = innermost binder). The `Abs` name hint is used
//! only when printing; equality is de Bruijn structural, so substitution is pure index arithmetic
//! (no fresh names, no capture).
//!
//! STRUCTURALLY SHARED, AND THAT IS THE POINT. `LambdaTerm` is a handle around one `Rc<Node>`, so
//! cloning ANY term at ANY level — including the root — is a refcount bump rather than a deep copy.
//! The reducer's spine rebuild (`reduce.rs`) was measured deep-cloning the untouched sibling subtree
//! at every level of the redex path; that is what this representation removes. See
//! `docs/superpowers/specs/2026-07-30-lambda-structural-sharing-design.md`.

use std::rc::Rc;

/// A lambda-term. One `Rc` per node; `.node()` reaches the variant.
#[derive(Clone, Debug)]
pub struct LambdaTerm(Rc<Node>);

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
    /// Application.
    App(LambdaTerm, LambdaTerm),
}

impl LambdaTerm {
    /// The variant. Deliberately a method rather than a `Deref` impl: the indirection stays visible
    /// at every match site instead of being inferred, in exactly the code that most needs to read
    /// literally.
    pub fn node(&self) -> &Node {
        &self.0
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
    pub fn alloc_id(&self) -> usize {
        Rc::as_ptr(&self.0) as usize
    }
}

/// A direction into a `LambdaTerm`; a `Path` locates a subterm (e.g. the reduced redex).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dir {
    AppL,
    AppR,
    AbsBody,
}

pub type Path = Vec<Dir>;

pub fn var(i: u32) -> LambdaTerm {
    LambdaTerm(Rc::new(Node::Var(i)))
}

pub fn abs(name: impl Into<Rc<str>>, body: LambdaTerm) -> LambdaTerm {
    LambdaTerm(Rc::new(Node::Abs(name.into(), body)))
}

pub fn app(f: LambdaTerm, a: LambdaTerm) -> LambdaTerm {
    LambdaTerm(Rc::new(Node::App(f, a)))
}

/// Shift the free variables of `t` (those with index >= `cutoff`) by `d`.
///
/// # Panics
///
/// If a shifted index would go negative. `d` is signed and only `beta` ever passes a negative one
/// (`shift(-1, 0, …)`, to close the hole after substituting), so this can only fire when a `Var(0)`
/// survives to that call — which `subst(0, …)` is supposed to have replaced. **Panicking is the point:
/// the arithmetic was `(i64::from(*k) + d) as u32`, which WRAPS a negative result to a huge index, so
/// the failure mode was a term full of dangling references that reduces to a wrong answer rather than
/// to an error. A miscompile is worse than a crash.**
///
/// The invariant that keeps this unreachable from compiled output is not local to either function: it
/// holds because `subst`'s `j + 1` and this function's `cutoff + 1` step in lockstep under `Abs`, so
/// the index `subst` replaces is exactly the one this call would decrement. Two functions agreeing by
/// construction is precisely the kind of coupling a refactor breaks silently, which is why the check is
/// unconditional rather than a `debug_assert!`. Measured cost in release: none — five runs put the
/// guarded version's range around the unguarded one (0.2078–0.2191s vs 0.2123–0.2151s for 2,000 shifts
/// over a 400-deep term), i.e. below run-to-run noise.
pub fn shift(d: i64, cutoff: u32, t: &LambdaTerm) -> LambdaTerm {
    match t.node() {
        Node::Var(k) => {
            if *k >= cutoff {
                let shifted = i64::from(*k) + d;
                assert!(shifted >= 0, "shift({d}, {cutoff}) produced a negative de Bruijn index from Var({k})");
                var(shifted as u32)
            } else {
                var(*k)
            }
        }
        Node::Abs(n, b) => abs(Rc::clone(n), shift(d, cutoff + 1, b)),
        Node::App(f, a) => app(shift(d, cutoff, f), shift(d, cutoff, a)),
    }
}

/// Substitute `s` for the variable with index `j` in `t`.
pub fn subst(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> LambdaTerm {
    match t.node() {
        Node::Var(k) => {
            if *k == j {
                // A refcount bump, where under `Box` this deep-copied the whole substituted argument
                // once per occurrence. That single line is a large share of the win.
                s.clone()
            } else {
                var(*k)
            }
        }
        Node::Abs(n, b) => abs(Rc::clone(n), subst(j + 1, &shift(1, 0, s), b)),
        Node::App(f, a) => app(subst(j, s, f), subst(j, s, a)),
    }
}

/// β-reduce `(\. abs_body) arg`: substitute `arg` for index 0 in `abs_body`, then close the hole.
pub fn beta(abs_body: &LambdaTerm, arg: &LambdaTerm) -> LambdaTerm {
    shift(-1, 0, &subst(0, &shift(1, 0, arg), abs_body))
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
            (Node::App(f1, a1), Node::App(f2, a2)) => f1 == f2 && a1 == a2,
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
                Node::App(f, a) => {
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
                    Node::App(f, a) => {
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

        let (next, _path) = reduce_step(&t).expect("a redex exists");
        let Node::App(_, inherited) = next.node() else { panic!("expected an App at the root") };
        assert_eq!(
            inherited.alloc_id(),
            sibling.alloc_id(),
            "the untouched sibling must be inherited by identity, not rebuilt"
        );
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
                Node::App(f, a) => {
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
}
