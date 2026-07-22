//! Type-directed decode of a normal-form lambda-term back to a `Value`, guided by the expected
//! value's shape. Necessary because the encodings overlap: `church(0)` and Scott `false` are the
//! same de Bruijn term (`\.\. 0`), as are `nil` and `true` (`\.\. 1`), and `[0]` is
//! indistinguishable from `[false]`. `expected` (the reference result) says how to read `nf`.

use crate::lambda::term::LambdaTerm;
use crate::value::Value;
use std::rc::Rc;

/// Decode a normal-form term to a `Value`, guided by the type/shape of `expected`. Returns the
/// actual decoded value (equal to `expected` iff the lambda computed the right answer), or `None`
/// if `nf` doesn't match the expected shape.
pub fn decode(nf: &LambdaTerm, expected: &Value) -> Option<Value> {
    match expected {
        Value::Nat(_) => decode_church(nf).map(Value::Nat),
        Value::Bool(_) => decode_bool(nf).map(Value::Bool),
        Value::Nil => decode_nil(nf),
        Value::Cons(h, t) => decode_cons(nf, h, t),
        // No first-class encoded value to compare against.
        Value::Unit | Value::Closure { .. } | Value::Builtin(_) => None,
    }
}

/// Church numeral `\f.\x. f (f … x)` -> the count of `f`-applications. `f` is index 1, `x` is 0.
fn decode_church(t: &LambdaTerm) -> Option<u64> {
    let LambdaTerm::Abs(_, outer) = t else { return None };
    let LambdaTerm::Abs(_, body_box) = outer.as_ref() else { return None };
    let mut body = body_box.as_ref();
    let mut count = 0u64;
    loop {
        match body {
            LambdaTerm::Var(0) => return Some(count), // reached x
            LambdaTerm::App(f, a) => {
                // must be `f (…)` where f is Var(1)
                if !matches!(f.as_ref(), LambdaTerm::Var(1)) {
                    return None;
                }
                count += 1;
                body = a.as_ref();
            }
            _ => return None,
        }
    }
}

/// Scott bool `\t.\f. t` (true) or `\t.\f. f` (false). `t` is index 1, `f` is index 0.
fn decode_bool(t: &LambdaTerm) -> Option<bool> {
    let LambdaTerm::Abs(_, outer) = t else { return None };
    let LambdaTerm::Abs(_, body) = outer.as_ref() else { return None };
    match body.as_ref() {
        LambdaTerm::Var(1) => Some(true),
        LambdaTerm::Var(0) => Some(false),
        _ => None,
    }
}

/// Scott `nil = \n.\c. n` (`Abs(_, Abs(_, Var(1)))`).
fn decode_nil(t: &LambdaTerm) -> Option<Value> {
    let LambdaTerm::Abs(_, outer) = t else { return None };
    let LambdaTerm::Abs(_, body) = outer.as_ref() else { return None };
    match body.as_ref() {
        LambdaTerm::Var(1) => Some(Value::Nil),
        _ => None,
    }
}

/// Scott `cons = \n.\c. c H T` (`Abs(_, Abs(_, App(App(Var(0), H), T)))`). Decode `H`/`T` guided by
/// the expected head/tail values.
fn decode_cons(t: &LambdaTerm, exp_h: &Value, exp_t: &Value) -> Option<Value> {
    let LambdaTerm::Abs(_, outer) = t else { return None };
    let LambdaTerm::Abs(_, body) = outer.as_ref() else { return None };
    let LambdaTerm::App(ca, t_term) = body.as_ref() else { return None };
    // ca must be `c H`, i.e. App(Var(0), H)
    let LambdaTerm::App(c, h_term) = ca.as_ref() else { return None };
    if !matches!(c.as_ref(), LambdaTerm::Var(0)) {
        return None;
    }
    // H and T are closed subterms (don't reference n/c); decode them directly, guided by expected.
    let head = decode(h_term, exp_h)?;
    let tail = decode(t_term, exp_t)?;
    Some(Value::Cons(Rc::new(head), Rc::new(tail)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lambda::encode::*;
    use crate::lambda::reduce::{MAX_REDUCTION_STEPS, reduce_to_normal_form};
    use crate::lambda::term::{LambdaTerm, abs, app, var};

    fn decode_nf(t: LambdaTerm, expected: &Value) -> Option<Value> {
        let (nf, _) = reduce_to_normal_form(&t, MAX_REDUCTION_STEPS);
        decode(&nf, expected)
    }

    #[test]
    fn decodes_church_numerals() {
        assert_eq!(decode(&church(0), &Value::Nat(0)), Some(Value::Nat(0)));
        assert_eq!(decode(&church(5), &Value::Nat(5)), Some(Value::Nat(5)));
        // Uses `expected` only for its TYPE: a wrong numeral still decodes to its actual value.
        assert_eq!(decode(&church(3), &Value::Nat(5)), Some(Value::Nat(3)));
    }

    #[test]
    fn overlapping_encodings_resolve_by_expected_shape() {
        // `false` and `church(0)` are the SAME term; the expectation disambiguates.
        assert_eq!(decode(&fls(), &Value::Bool(false)), Some(Value::Bool(false)));
        assert_eq!(decode(&tru(), &Value::Bool(true)), Some(Value::Bool(true)));
        // The identical term decodes as Nat(0) under a Nat expectation and Bool(false) under Bool:
        assert_eq!(decode(&church(0), &Value::Nat(0)), Some(Value::Nat(0)));
        assert_eq!(decode(&church(0), &Value::Bool(false)), Some(Value::Bool(false)));
    }

    #[test]
    fn decodes_scott_lists() {
        assert_eq!(decode(&nil(), &Value::Nil), Some(Value::Nil));
        // cons 1 (cons 2 nil), reduced, decodes (guided by [1,2]) to the value list [1, 2].
        let list = app(app(cons(), church(1)), app(app(cons(), church(2)), nil()));
        assert_eq!(decode_nf(list, &Value::list_of_nats(&[1, 2])), Some(Value::list_of_nats(&[1, 2])));
    }

    #[test]
    fn wrong_shape_decodes_to_none() {
        // A residual function under any expectation -> None.
        // A term with only one abstraction (not two) fails the Church numeral pattern.
        assert_eq!(decode(&abs("x", var(0)), &Value::Nat(0)), None);
        // A length mismatch: term is a 2-element list, expectation is 1-element -> None.
        let two = app(app(cons(), church(1)), app(app(cons(), church(2)), nil()));
        assert_eq!(decode_nf(two, &Value::list_of_nats(&[9])), None);
        // Two binders present but the body is not a valid numeral/bool/nil/cons shape: `\x.\y. y y`.
        // Must be None under every expectation (exercises each decoder's non-conforming-body arm).
        let residual = abs("x", abs("y", app(var(0), var(0))));
        assert_eq!(decode(&residual, &Value::Nat(0)), None);
        assert_eq!(decode(&residual, &Value::Bool(true)), None);
        assert_eq!(decode(&residual, &Value::Nil), None);
        assert_eq!(
            decode(&residual, &Value::Cons(std::rc::Rc::new(Value::Nat(0)), std::rc::Rc::new(Value::Nil))),
            None
        );
    }

    use proptest::prelude::*;

    proptest! {
        #[test]
        fn church_round_trips(n in 0u64..200) {
            prop_assert_eq!(decode(&church(n), &Value::Nat(n)), Some(Value::Nat(n)));
        }

        #[test]
        fn nat_list_round_trips(ns in proptest::collection::vec(0u64..50, 0..8)) {
            // build cons(n0, cons(n1, ... nil)), reduce, decode (guided by the expected list).
            let mut term = nil();
            for &n in ns.iter().rev() {
                term = app(app(cons(), church(n)), term);
            }
            let (nf, _) = reduce_to_normal_form(&term, MAX_REDUCTION_STEPS);
            let expected = Value::list_of_nats(&ns);
            prop_assert_eq!(decode(&nf, &expected), Some(expected.clone()));
        }
    }
}
