//! Church `Nat` and Scott `Bool`/`List` encodings as closed de Bruijn lambda-terms, plus the
//! arithmetic, comparison, and list combinators the lowering uses. Behavioral correctness (these
//! reduce to the right normal forms) is covered in `reduce.rs`'s tests.
//!
//! THESE COMBINATORS REQUIRE NORMAL-ORDER REDUCTION, and the sharpest reason is defined right here:
//! `head`/`tail` pass a deliberately non-normalizing term (`diverge()`) as their `nil` branch on EVERY
//! call, so an applicative-order reducer evaluates it even for a non-empty list and hangs on
//! `head(cons(7, nil))` — a correct program. The Scott booleans below are the other half of a second
//! reason: `lower.rs` hands them both `if` branches unthunked, so call-by-value evaluates the branch not
//! taken. `reduce.rs`'s module doc states the requirement in full, with the third reason (the
//! call-by-name fixpoint combinator) and why confluence does not excuse it.
//!
//! THE ENCODINGS COLLIDE, so a normal form CANNOT be decoded without a result type supplied from
//! outside. This is a property of the encodings, not a shortcoming of any particular decoder, and it
//! holds for an independent implementation exactly as it holds for ours:
//!
//!   * `tru()` (`\t.\f. t`) and `nil()` (`\n.\c. n`) are the SAME de Bruijn term, `Abs(Abs(Var 1))`.
//!   * `fls()` (`\t.\f. f`) and `church(0)` (`\f.\x. x`) are both `Abs(Abs(Var 0))`.
//!
//! The collision propagates through structure rather than staying at the leaves: a one-element Scott
//! list holding either one is a single term, so `[0]` and `[false]` are indistinguishable, and so is
//! every larger structure built over them. Nothing recoverable from a printed or reduced term says
//! which was meant. A reader handed only a normal form is therefore not merely inconvenienced — it
//! has strictly insufficient information, and must be told the result type by its caller.

use crate::core::BinOp;
use crate::lambda::term::{LambdaTerm, abs, app, var};

/// Church numeral `n` = `\f.\x. fⁿ x`.
#[must_use]
pub fn church(n: u64) -> LambdaTerm {
    let mut body = var(0); // x
    for _ in 0..n {
        body = app(var(1), body); // f (…)
    }
    abs("f", abs("x", body))
}

/// `succ = \n.\f.\x. f (n f x)`
#[must_use]
pub fn succ() -> LambdaTerm {
    abs("n", abs("f", abs("x", app(var(1), app(app(var(2), var(1)), var(0))))))
}

/// `plus = \m.\n.\f.\x. m f (n f x)`
#[must_use]
pub fn plus() -> LambdaTerm {
    abs("m", abs("n", abs("f", abs("x", app(app(var(3), var(1)), app(app(var(2), var(1)), var(0)))))))
}

/// `mult = \m.\n.\f. m (n f)`
#[must_use]
pub fn mult() -> LambdaTerm {
    abs("m", abs("n", abs("f", app(var(2), app(var(1), var(0))))))
}

/// `pred = \n.\f.\x. n (\g.\h. h (g f)) (\u. x) (\u. u)`  (standard Church predecessor)
#[must_use]
pub fn pred() -> LambdaTerm {
    abs(
        "n",
        abs(
            "f",
            abs(
                "x",
                app(
                    app(app(var(2), abs("g", abs("h", app(var(0), app(var(1), var(3)))))), abs("u", var(1))),
                    abs("u", var(0)),
                ),
            ),
        ),
    )
}

/// `monus = \m.\n. n pred m`  (truncated subtraction: apply `pred` `n` times to `m`).
#[must_use]
pub fn monus() -> LambdaTerm {
    abs("m", abs("n", app(app(var(0), pred()), var(1))))
}

/// `is_zero = \n. n (\x. false) true`
#[must_use]
pub fn is_zero() -> LambdaTerm {
    abs("n", app(app(var(0), abs("x", fls())), tru()))
}

/// Scott/Church `true = \t.\f. t`.
#[must_use]
pub fn tru() -> LambdaTerm {
    abs("t", abs("f", var(1)))
}

/// Scott/Church `false = \t.\f. f`.
#[must_use]
pub fn fls() -> LambdaTerm {
    abs("t", abs("f", var(0)))
}

/// `not = \b. b false true`
#[must_use]
pub fn not() -> LambdaTerm {
    abs("b", app(app(var(0), fls()), tru()))
}

/// `and = \a.\b. a b false`
#[must_use]
pub fn and() -> LambdaTerm {
    abs("a", abs("b", app(app(var(1), var(0)), fls())))
}

/// Scott `nil = \n.\c. n`.
#[must_use]
pub fn nil() -> LambdaTerm {
    abs("n", abs("c", var(1)))
}

/// Scott `cons = \h.\t.\n.\c. c h t`.
#[must_use]
pub fn cons() -> LambdaTerm {
    abs("h", abs("t", abs("n", abs("c", app(app(var(0), var(3)), var(2))))))
}

/// `head = \l. l DIVERGE (\h.\t. h)` — the `nil` branch is an arbitrary closed term; the
/// interpreter's `head(nil)` is a runtime error, and the oracle only compares programs that do not
/// evaluate it. Use `\h.\t. h` for the cons branch.
#[must_use]
pub fn head() -> LambdaTerm {
    abs("l", app(app(var(0), diverge()), abs("h", abs("t", var(1)))))
}

/// `tail = \l. l DIVERGE (\h.\t. t)`
#[must_use]
pub fn tail() -> LambdaTerm {
    abs("l", app(app(var(0), diverge()), abs("h", abs("t", var(0)))))
}

/// `is_empty = \l. l true (\h.\t. false)`
#[must_use]
pub fn is_empty() -> LambdaTerm {
    abs("l", app(app(var(0), tru()), abs("h", abs("t", fls()))))
}

/// A closed non-normalizing term used as the `nil` branch of `head`/`tail`. Never selected by a
/// well-typed program that does not take `head`/`tail` of an empty list.
fn diverge() -> LambdaTerm {
    // (\x. x x) (\x. x x)
    let omega = abs("x", app(var(0), var(0)));
    app(omega.clone(), omega)
}

/// Comparison combinators on Church numerals -> Scott bool. `le m n = is_zero (monus m n)`.
fn le() -> LambdaTerm {
    abs("m", abs("n", app(is_zero(), app(app(monus(), var(1)), var(0)))))
}

/// `eq m n = and (le m n) (le n m)`
fn eq() -> LambdaTerm {
    abs("m", abs("n", app(app(and(), app(app(le(), var(1)), var(0))), app(app(le(), var(0)), var(1)))))
}

/// The lambda-term implementing a Core binary operator.
#[must_use]
pub fn binop(op: BinOp) -> LambdaTerm {
    match op {
        BinOp::Add => plus(),
        BinOp::Sub => monus(),
        BinOp::Mul => mult(),
        BinOp::Eq => eq(),
        BinOp::Ne => abs("m", abs("n", app(not(), app(app(eq(), var(1)), var(0))))),
        BinOp::Lt => abs("m", abs("n", app(app(le(), app(succ(), var(1))), var(0)))), // m+1 <= n
        BinOp::Le => le(),
        BinOp::Gt => abs("m", abs("n", app(app(le(), app(succ(), var(0))), var(1)))), // n+1 <= m
        BinOp::Ge => abs("m", abs("n", app(app(le(), var(0)), var(1)))),              // n <= m
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn church_zero_and_two_have_the_right_shape() {
        // 0 = \f.\x. x
        assert_eq!(church(0), abs("f", abs("x", var(0))));
        // 2 = \f.\x. f (f x)
        assert_eq!(church(2), abs("f", abs("x", app(var(1), app(var(1), var(0))))));
    }

    #[test]
    fn scott_booleans_have_the_right_shape() {
        // true = \t.\f. t ; false = \t.\f. f
        assert_eq!(tru(), abs("t", abs("f", var(1))));
        assert_eq!(fls(), abs("t", abs("f", var(0))));
    }

    #[test]
    fn scott_nil_and_cons_have_the_right_shape() {
        // nil = \n.\c. n ; cons = \h.\t.\n.\c. c h t
        assert_eq!(nil(), abs("n", abs("c", var(1))));
        assert_eq!(cons(), abs("h", abs("t", abs("n", abs("c", app(app(var(0), var(3)), var(2)))))));
    }

    #[test]
    fn binop_dispatches_arith_and_comparison() {
        use crate::core::BinOp;
        // Smoke: every operator produces some closed term without panicking.
        for op in [BinOp::Add, BinOp::Sub, BinOp::Mul, BinOp::Eq, BinOp::Ne, BinOp::Lt, BinOp::Le, BinOp::Gt, BinOp::Ge]
        {
            let _ = binop(op);
        }
    }
}
