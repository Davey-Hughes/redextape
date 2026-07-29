//! de Bruijn lambda-terms. Indices are 0-based (0 = innermost binder). The `Abs` name hint is used
//! only when printing; equality is de Bruijn structural, so substitution is pure index arithmetic
//! (no fresh names, no capture).

#[derive(Clone, Debug)]
pub enum LambdaTerm {
    /// de Bruijn index; 0 refers to the innermost enclosing `Abs`.
    Var(u32),
    /// Abstraction with a print-only name hint and a body.
    Abs(String, Box<LambdaTerm>),
    /// Application.
    App(Box<LambdaTerm>, Box<LambdaTerm>),
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
    LambdaTerm::Var(i)
}

pub fn abs(name: impl Into<String>, body: LambdaTerm) -> LambdaTerm {
    LambdaTerm::Abs(name.into(), Box::new(body))
}

pub fn app(f: LambdaTerm, a: LambdaTerm) -> LambdaTerm {
    LambdaTerm::App(Box::new(f), Box::new(a))
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
    match t {
        LambdaTerm::Var(k) => {
            if *k >= cutoff {
                let shifted = i64::from(*k) + d;
                assert!(shifted >= 0, "shift({d}, {cutoff}) produced a negative de Bruijn index from Var({k})");
                LambdaTerm::Var(shifted as u32)
            } else {
                LambdaTerm::Var(*k)
            }
        }
        LambdaTerm::Abs(n, b) => LambdaTerm::Abs(n.clone(), Box::new(shift(d, cutoff + 1, b))),
        LambdaTerm::App(f, a) => LambdaTerm::App(Box::new(shift(d, cutoff, f)), Box::new(shift(d, cutoff, a))),
    }
}

/// Substitute `s` for the variable with index `j` in `t`.
pub fn subst(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> LambdaTerm {
    match t {
        LambdaTerm::Var(k) => {
            if *k == j {
                s.clone()
            } else {
                LambdaTerm::Var(*k)
            }
        }
        LambdaTerm::Abs(n, b) => LambdaTerm::Abs(n.clone(), Box::new(subst(j + 1, &shift(1, 0, s), b))),
        LambdaTerm::App(f, a) => LambdaTerm::App(Box::new(subst(j, s, f)), Box::new(subst(j, s, a))),
    }
}

/// β-reduce `(\. abs_body) arg`: substitute `arg` for index 0 in `abs_body`, then close the hole.
pub fn beta(abs_body: &LambdaTerm, arg: &LambdaTerm) -> LambdaTerm {
    shift(-1, 0, &subst(0, &shift(1, 0, arg), abs_body))
}

impl PartialEq for LambdaTerm {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (LambdaTerm::Var(a), LambdaTerm::Var(b)) => a == b,
            (LambdaTerm::Abs(_, a), LambdaTerm::Abs(_, b)) => a == b, // name hint ignored
            (LambdaTerm::App(f1, a1), LambdaTerm::App(f2, a2)) => f1 == f2 && a1 == a2,
            _ => false,
        }
    }
}

impl Eq for LambdaTerm {}

/// Hand-written iterative destructor: a deep term (large lowering / reduction growth) would
/// otherwise recurse once per node in the compiler-generated `drop_in_place` and abort the
/// process. Unlink the `Box` children into a worklist and drain it with bounded stack.
impl Drop for LambdaTerm {
    fn drop(&mut self) {
        let mut stack: Vec<LambdaTerm> = Vec::new();
        take_children(self, &mut stack);
        while let Some(mut node) = stack.pop() {
            take_children(&mut node, &mut stack);
        }
    }
}

fn take_children(t: &mut LambdaTerm, stack: &mut Vec<LambdaTerm>) {
    match t {
        LambdaTerm::Abs(_, b) => stack.push(*std::mem::replace(b, Box::new(LambdaTerm::Var(0)))),
        LambdaTerm::App(f, a) => {
            stack.push(*std::mem::replace(f, Box::new(LambdaTerm::Var(0))));
            stack.push(*std::mem::replace(a, Box::new(LambdaTerm::Var(0))));
        }
        LambdaTerm::Var(_) => {}
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
}
