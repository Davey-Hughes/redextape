//! Type-directed decode of a normal-form lambda-term back to a `Value`, guided by the expected
//! value's shape. Necessary because the encodings overlap: `church(0)` and Scott `false` are the
//! same de Bruijn term (`\.\. 0`), as are `nil` and `true` (`\.\. 1`), and `[0]` is
//! indistinguishable from `[false]`. `expected` (the reference result) says how to read `nf`.

use crate::lambda::term::{LambdaTerm, Node};
use crate::ty::Ty;
use crate::value::Value;
use std::rc::Rc;

/// Decode a normal-form term to a `Value`, guided by the type/shape of `expected`. Returns the
/// actual decoded value (equal to `expected` iff the lambda computed the right answer), or `None`
/// if `nf` doesn't match the expected shape.
///
/// DEPTH. `decode_cons` destructures `nf` before it consults `expected`, and descends only where BOTH
/// `nf` is cons-shaped and `expected` is `Value::Cons`. So the depth is
/// `min(expected's spine length, nf's own cons nesting)` — not either one alone. It is `nf` that makes
/// that bound small: whichever producer built it capped its depth (`reduce.rs`'s `MAX_TERM_DEPTH` =
/// 3,000, `syntax.rs`'s `MAX_PARSE_DEPTH` = 256), and a Scott cell is four term nodes, so a reduced or
/// parsed normal form bottoms out around 750 frames. That is safe on a normal stack, which is why this
/// recursion is left recursive.
///
/// Do NOT restate that as "bounded by the `Value` the caller already holds, so it needs no guard": a
/// caller-held `Cons` spine is bounded only by the step budget — millions of cells — which is exactly
/// the premise that makes `value.rs`'s `Drop`, `PartialEq` and `Debug` all walk it iteratively. The
/// binding half of the `min` is the term, and only for terms some producer built.
///
/// `decode_lambda_ty` walks its spine ITERATIVELY, and the contrast is narrower than "it lacks a guard
/// `decode` has": both are ultimately bounded by `nf`. Being new code, it could drop the
/// data-proportional axis outright for no cost, which beats justifying a bound — and it survives a term
/// built DIRECTLY, past every producer cap, as a result (its own spine test builds a 5,000-cell one).
pub fn decode(nf: &LambdaTerm, expected: &Value) -> Option<Value> {
    match expected {
        Value::Nat(_) => decode_church(nf).map(Value::Nat),
        Value::Bool(_) => decode_bool(nf).map(Value::Bool),
        Value::Nil => decode_nil(nf),
        Value::Cons(h, t) => decode_cons(nf, h, t),
        // No first-class encoded value to compare against.
        Value::Unit | Value::Closure { .. } | Value::Builtin(_) | Value::Box(_) => None,
    }
}

/// Decode a normal form against a TYPE rather than a `Value` shape witness — what a reader holding
/// only printed λ text has, since a bare normal form is ambiguous (`church(0)` and `false` are the
/// same term) and there is no reference run to disambiguate it.
///
/// A SIBLING of `decode`, not a replacement for it. They disagree on two cases on purpose: nil under a
/// `Cons` witness, and `Unit`. `decode`'s strictness there is what makes the oracle catch a backend
/// that returned a SHORTER list than the reference, so it cannot be expressed over this one — and the
/// reverse needs a `Value -> Ty` function that is partial, since `Value::Nil` carries no recoverable
/// element type. `tm::decode` and `asm` keep their two decoders side by side for the same reason.
///
/// Unlike the TM pair there is nothing to share: both take the term directly, with no analogue of
/// `read_result`'s tape read.
pub fn decode_lambda_ty(nf: &LambdaTerm, ty: &Ty) -> Option<Value> {
    match ty {
        Ty::Nat => decode_church(nf).map(Value::Nat),
        Ty::Bool => decode_bool(nf).map(Value::Bool),
        // No encoding to read: `Unit` types statements (`while`, assignment), and a program of that
        // type has no value. Declaring it is legitimate, so the normal form is ignored, not rejected.
        Ty::Unit => Some(Value::Unit),
        Ty::List(elem) => decode_list_ty(nf, elem),
        // Well-formed but not first-class values, exactly as `ty::parse_ty` refuses them.
        Ty::Fun(..) | Ty::Var(_) => None,
    }
}

/// Scott list under an element type: `nil = \n.\c. n`, `cons H T = \n.\c. c H T`.
///
/// ITERATIVE over the spine, recursive only into HEADS. That is what bounds decode depth by the TYPE's
/// nesting instead of the list's length — the one axis here that grows with the data. No node budget is
/// needed on top (`tm::decode_tape_ty` needs one because the TM heap is a GRAPH whose cells address each
/// other; a λ normal form is a finite tree already in memory, so every walk terminates by construction).
fn decode_list_ty(nf: &LambdaTerm, elem: &Ty) -> Option<Value> {
    let mut heads: Vec<Value> = Vec::new();
    let mut cur = nf;
    loop {
        let Node::Abs(_, outer) = cur.node() else { return None };
        let Node::Abs(_, body) = outer.node() else { return None };
        match body.node() {
            Node::Var(1) => break, // nil
            Node::App(ca, t_term, _) => {
                let Node::App(c, h_term, _) = ca.node() else { return None };
                if !matches!(c.node(), Node::Var(0)) {
                    return None;
                }
                heads.push(decode_lambda_ty(h_term, elem)?);
                cur = t_term;
            }
            _ => return None,
        }
    }
    let mut acc = Value::Nil;
    for h in heads.into_iter().rev() {
        acc = Value::Cons(Rc::new(h), Rc::new(acc));
    }
    Some(acc)
}

/// Church numeral `\f.\x. f (f … x)` -> the count of `f`-applications. `f` is index 1, `x` is 0.
fn decode_church(t: &LambdaTerm) -> Option<u64> {
    let Node::Abs(_, outer) = t.node() else { return None };
    let Node::Abs(_, body_term) = outer.node() else { return None };
    let mut body = body_term;
    let mut count = 0u64;
    loop {
        match body.node() {
            Node::Var(0) => return Some(count), // reached x
            Node::App(f, a, _) => {
                // must be `f (…)` where f is Var(1)
                if !matches!(f.node(), Node::Var(1)) {
                    return None;
                }
                count += 1;
                body = a;
            }
            _ => return None,
        }
    }
}

/// Scott bool `\t.\f. t` (true) or `\t.\f. f` (false). `t` is index 1, `f` is index 0.
fn decode_bool(t: &LambdaTerm) -> Option<bool> {
    let Node::Abs(_, outer) = t.node() else { return None };
    let Node::Abs(_, body) = outer.node() else { return None };
    match body.node() {
        Node::Var(1) => Some(true),
        Node::Var(0) => Some(false),
        _ => None,
    }
}

/// Scott `nil = \n.\c. n` (`Abs(_, Abs(_, Var(1)))`).
fn decode_nil(t: &LambdaTerm) -> Option<Value> {
    let Node::Abs(_, outer) = t.node() else { return None };
    let Node::Abs(_, body) = outer.node() else { return None };
    match body.node() {
        Node::Var(1) => Some(Value::Nil),
        _ => None,
    }
}

/// Scott `cons = \n.\c. c H T` (`Abs(_, Abs(_, App(App(Var(0), H), T)))`). Decode `H`/`T` guided by
/// the expected head/tail values.
fn decode_cons(t: &LambdaTerm, exp_h: &Value, exp_t: &Value) -> Option<Value> {
    let Node::Abs(_, outer) = t.node() else { return None };
    let Node::Abs(_, body) = outer.node() else { return None };
    let Node::App(ca, t_term, _) = body.node() else { return None };
    // ca must be `c H`, i.e. App(Var(0), H)
    let Node::App(c, h_term, _) = ca.node() else { return None };
    if !matches!(c.node(), Node::Var(0)) {
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

    use crate::ty::Ty;

    /// A1: the two decoders AGREE wherever both are defined. `decode` is Value-directed (it needs a
    /// reference run); `decode_lambda_ty` is Ty-directed (all a reader of printed text can have).
    #[test]
    fn the_two_decoders_agree_on_nat_bool_and_a_non_empty_list() {
        assert_eq!(decode(&church(5), &Value::Nat(0)), decode_lambda_ty(&church(5), &Ty::Nat));
        assert_eq!(decode_lambda_ty(&church(5), &Ty::Nat), Some(Value::Nat(5)));

        assert_eq!(decode(&tru(), &Value::Bool(false)), decode_lambda_ty(&tru(), &Ty::Bool));
        assert_eq!(decode_lambda_ty(&fls(), &Ty::Bool), Some(Value::Bool(false)));

        let list = app(app(cons(), church(1)), app(app(cons(), church(2)), nil()));
        let (nf, _) = reduce_to_normal_form(&list, MAX_REDUCTION_STEPS);
        let ty = Ty::List(Box::new(Ty::Nat));
        assert_eq!(decode(&nf, &Value::list_of_nats(&[1, 2])), decode_lambda_ty(&nf, &ty));
        assert_eq!(decode_lambda_ty(&nf, &ty), Some(Value::list_of_nats(&[1, 2])));
    }

    /// …and DISAGREE on exactly two cases, on purpose (spec A1, mirroring `tm::decode`'s D6). Pinning the
    /// disagreements is the point: without this test, re-expressing either decoder over the other later
    /// would pass every other test in the tree while quietly loosening the oracle's list-LENGTH check.
    #[test]
    fn the_two_decoders_disagree_on_nil_and_unit_by_design() {
        // A nil normal form under a one-element witness is a WRONG ANSWER the Value-directed decoder must
        // reject — that rejection is how the oracle catches a backend that returned a SHORTER list.
        assert_eq!(decode(&nil(), &Value::list_of_nats(&[1])), None);
        // The Ty-directed decoder has no length to compare against; nil is a legitimate `List<Nat>`.
        assert_eq!(decode_lambda_ty(&nil(), &Ty::List(Box::new(Ty::Nat))), Some(Value::Nil));

        // `Value::Unit` is an internal statement result with no encoding, so there is nothing to decode
        // against it…
        assert_eq!(decode(&church(0), &Value::Unit), None);
        // …but a caller holding `typeck::result_type`'s answer may legitimately have `Ty::Unit` (a
        // `while`-tailed program), and the normal form is then simply ignored.
        assert_eq!(decode_lambda_ty(&church(0), &Ty::Unit), Some(Value::Unit));
    }

    /// Types that are well-formed but not first-class values decode to `None` — the same call that
    /// `ty::parse_ty` makes, and for the same reason: refuse them where they are named rather than let
    /// them read as a silent decode failure.
    #[test]
    fn function_and_variable_types_decode_to_none() {
        let id = abs("x", var(0));
        assert_eq!(decode_lambda_ty(&id, &Ty::Fun(vec![Ty::Nat], Box::new(Ty::Nat))), None);
        assert_eq!(decode_lambda_ty(&id, &Ty::Var(0)), None);
    }

    /// Build the NORMAL FORM of a Scott list directly, bypassing the reducer: `cons H T` normalizes to
    /// `\n.\c. c H T` with `H`/`T` unshifted, because both are closed. Direct construction is the point —
    /// `reduce_to_normal_form` refuses any term deeper than `MAX_TERM_DEPTH` (3,000) and a 5,000-cell list
    /// is ~20,000 deep, so reduction CANNOT produce this term. A `pub` decoder handed a term from anywhere
    /// else — a parser, another tool, a test — must still survive it.
    fn scott_list_nf(ns: &[u64]) -> LambdaTerm {
        let mut acc = nil();
        for &n in ns.iter().rev() {
            acc = abs("n", abs("c", app(app(var(0), church(n)), acc)));
        }
        acc
    }

    /// Flatten a decoded `List<Nat>` into a plain `Vec<u64>`, walking the spine ITERATIVELY.
    ///
    /// The test below exists to prove ONE thing: that `decode_lambda_ty`'s spine walk is iterative.
    /// Comparing two 5,000-element `Value`s with `assert_eq!` would instead route the assertion through
    /// `Value`'s own `PartialEq` (`value.rs`) — a separate walk with its own, separately-decided depth
    /// behaviour. Extracting through this loop keeps the assertion pointed at the one subject the test's
    /// name claims, independent of whatever that separate walk does.
    fn nat_list_to_vec(v: &Value) -> Option<Vec<u64>> {
        let mut out = Vec::new();
        let mut cur = v;
        loop {
            match cur {
                Value::Nil => return Some(out),
                Value::Cons(h, t) => {
                    let Value::Nat(n) = h.as_ref() else { return None };
                    out.push(*n);
                    cur = t.as_ref();
                }
                _ => return None,
            }
        }
    }

    /// A2: `decode_lambda_ty` walks the list SPINE iteratively, so its recursion depth is the TYPE's
    /// nesting (`List<List<Nat>>` is 2), never the list's length. `decode` is left recursive because its
    /// depth is bounded by `nf`'s own cons nesting, which every producer caps — see `decode`'s DEPTH
    /// block, and note that the directly-built term below deliberately steps outside those caps.
    ///
    /// Run on a deliberately small 256 KiB stack, which a spine-recursive decoder cannot survive at 5,000
    /// cells. NOTE THE FAILURE MODE: a Rust stack overflow aborts the test process, so a regression here
    /// shows up as "test binary crashed", not as a red assertion.
    ///
    /// The assertion extracts through `nat_list_to_vec` rather than comparing two `Value`s directly with
    /// `assert_eq!`: routing through an explicit local walk keeps the assertion pointed at that one
    /// subject — `decode_lambda_ty`'s own spine walk — regardless of what depth behaviour `Value`'s own
    /// `PartialEq` (`value.rs`) happens to have. Extracting to a `Vec<u64>` first keeps this test
    /// independent of that separate question, in either direction.
    ///
    /// The decode AND its assertion both run inside the thread: `Value` holds `Rc`s, so it is not
    /// `Send` — and since `LambdaTerm` became `Rc`-backed, neither is the term. `Vec<u64>` is, so
    /// `ns` is moved in and both the term and the expected list are built there.
    ///
    /// WIDER THAN IT WAS, stated rather than glossed. The term used to be built on the main thread
    /// so only the DECODE was measured against the small stack; it now also covers construction and
    /// teardown. That is acceptable because `scott_list_nf` builds with an iterative loop and
    /// `LambdaTerm`'s `Drop` is iterative by contract — but it means a failure here no longer points
    /// at the decode alone, and the 256 KiB below was re-measured with construction included rather
    /// than inherited: it still passes unchanged.
    #[test]
    fn decode_lambda_ty_is_iterative_over_the_list_spine() {
        let ns: Vec<u64> = (0..5_000).map(|i| i % 10).collect();
        std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(move || {
                let term = scott_list_nf(&ns);
                let decoded = decode_lambda_ty(&term, &Ty::List(Box::new(Ty::Nat))).expect("a 5,000-cell list decodes");
                assert_eq!(nat_list_to_vec(&decoded), Some(ns));
            })
            .expect("spawn a small-stack thread")
            .join()
            .expect("the decode thread must not overflow its stack");
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
