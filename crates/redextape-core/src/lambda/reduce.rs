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

use crate::lambda::term::{Dir, LambdaTerm, Path, beta};

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

/// True if `t` has any subterm deeper than `limit`. Iterative (explicit stack) and early-exits at
/// the limit, so it is bounded work and cannot itself overflow on a deep term.
fn depth_exceeds(t: &LambdaTerm, limit: u32) -> bool {
    let mut stack: Vec<(&LambdaTerm, u32)> = vec![(t, 0)];
    while let Some((node, d)) = stack.pop() {
        if d > limit {
            return true;
        }
        match node {
            LambdaTerm::Var(_) => {}
            LambdaTerm::Abs(_, b) => stack.push((b, d + 1)),
            LambdaTerm::App(f, a) => {
                stack.push((f, d + 1));
                stack.push((a, d + 1));
            }
        }
    }
    false
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
    if let LambdaTerm::App(f, a) = t
        && let LambdaTerm::Abs(_, body) = f.as_ref()
    {
        return Some((beta(body, a), Vec::new()));
    }
    match t {
        LambdaTerm::App(f, a) => {
            // Try the function side first (leftmost), then the argument.
            if let Some((f2, mut path)) = reduce_step(f) {
                path.insert(0, Dir::AppL);
                Some((LambdaTerm::App(Box::new(f2), a.clone()), path))
            } else if let Some((a2, mut path)) = reduce_step(a) {
                path.insert(0, Dir::AppR);
                Some((LambdaTerm::App(f.clone(), Box::new(a2)), path))
            } else {
                None
            }
        }
        LambdaTerm::Abs(n, b) => reduce_step(b).map(|(b2, mut path)| {
            path.insert(0, Dir::AbsBody);
            (LambdaTerm::Abs(n.clone(), Box::new(b2)), path)
        }),
        LambdaTerm::Var(_) => None,
    }
}

/// Reduce to normal form (or the cap), recording every step and its redex path.
pub fn reduce_trace(t: &LambdaTerm, cap: u64) -> Trace {
    let mut current = t.clone();
    let mut steps = Vec::new();
    let mut n = 0u64;
    while n < cap {
        if depth_exceeds(&current, MAX_TERM_DEPTH) {
            return Trace { steps, normal_form: current, status: Status::HitCap };
        }
        match reduce_step(&current) {
            Some((next, redex)) => {
                steps.push(Step { term: current.clone(), redex });
                current = next;
                n += 1;
            }
            None => return Trace { steps, normal_form: current, status: Status::Normalized },
        }
    }
    Trace { steps, normal_form: current, status: Status::HitCap }
}

/// Reduce to normal form (or the cap) without retaining the intermediate steps.
pub fn reduce_to_normal_form(t: &LambdaTerm, cap: u64) -> (LambdaTerm, Status) {
    let mut current = t.clone();
    let mut n = 0u64;
    while n < cap {
        if depth_exceeds(&current, MAX_TERM_DEPTH) {
            return (current, Status::HitCap);
        }
        match reduce_step(&current) {
            Some((next, _)) => {
                current = next;
                n += 1;
            }
            None => return (current, Status::Normalized),
        }
    }
    (current, Status::HitCap)
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
