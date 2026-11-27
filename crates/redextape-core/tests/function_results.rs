//! A function-typed result through every decoder. A function is reported as one opaque
//! `Value::Function`, whatever backend computed it, because no backend but the reference keeps anything
//! of it another backend could also report: λ reduces it to a term with no link back to its source, and
//! the machines to a tag the compiler numbers on its own. So each decoder is asked one thing of a
//! function: that the leg halted with a function where the type says one is.
//!
//! The `_ty` decoders the browser app calls refuse a function and the `_opaque` ones read it; both are
//! pinned here so that neither drifts into the other.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use redextape_core::desugar::desugar;
use redextape_core::lambda::{
    LambdaRun, MAX_REDUCTION_STEPS, decode, decode_lambda_ty, decode_lambda_ty_opaque, run_lambda, term,
};
use redextape_core::parser::parse;
use redextape_core::run;
use redextape_core::tm::{
    Binary, DEFAULT_CAPS as RXM_CAPS, Encoding, RxmOutcome, RxmRun, TM_DEFAULT_CAPS, TmRun, Unary, decode_rxm,
    decode_rxm_ty, decode_rxm_ty_opaque, decode_tape, decode_tape_ty, decode_tape_ty_opaque, lower_program, run_rxm,
    run_tm_fitted,
};
use redextape_core::ty::Ty;
use redextape_core::typeck::result_type;
use redextape_core::value::{Value, format_value};
use std::rc::Rc;

/// A function bare, named, bound, in a list and capturing a list, and what each result prints as.
const PROGRAMS: &[(&str, &str)] = &[
    ("|x| x + 1", "<fn>"),
    ("fn f(x) { x + 1 } f", "<fn>"),
    ("let g = |x| x; g", "<fn>"),
    ("[|x| x]", "[<fn>]"),
    ("let xs = [1, 2]; |y| head(xs) + y", "<fn>"),
];

/// `src`'s Core and its result type.
fn compile(src: &str) -> (redextape_core::core::Core, Ty) {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
    let prog = prog.expect("a program with no diagnostics parses");
    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors in {src:?}: {e:?}"));
    (desugar(&prog), ty)
}

#[test]
fn the_reference_reports_each_program_as_a_function() {
    for &(src, printed) in PROGRAMS {
        let rv = run(src).unwrap_or_else(|e| panic!("{src} did not run: {e:?}"));
        assert_eq!(format_value(&rv), printed, "{src}");
        assert_eq!(format_value(&rv.observable()), printed, "{src}, opaque");
    }
}

#[test]
fn lambda_decodes_a_function_as_the_opaque_function() {
    for &(src, _) in PROGRAMS {
        let rv = run(src).unwrap();
        let (core, ty) = compile(src);
        let LambdaRun::Reduced(nf) = run_lambda(&core, MAX_REDUCTION_STEPS) else {
            panic!("{src} did not reduce on λ")
        };
        assert_eq!(decode(&nf, &rv), Some(rv.observable()), "witness decode of {src}");
        assert_eq!(decode_lambda_ty_opaque(&nf, &ty), Some(rv.observable()), "opaque type decode of {src}");
        assert_eq!(decode_lambda_ty(&nf, &ty), None, "the browser's decoder refuses {src}");
    }
}

#[test]
fn rxm_decodes_a_function_as_the_opaque_function() {
    for &(src, _) in PROGRAMS {
        let rv = run(src).unwrap();
        let (core, ty) = compile(src);
        let program = lower_program(&core).unwrap_or_else(|e| panic!("{src} did not lower: {e:?}"));
        let RxmRun::Ran(outcome) = run_rxm(&program, RXM_CAPS) else { panic!("{src} did not halt on rxm") };
        assert_eq!(decode_rxm(&outcome, &rv), Some(rv.observable()), "witness decode of {src}");
        assert_eq!(decode_rxm_ty_opaque(&outcome, &ty), Some(rv.observable()), "opaque type decode of {src}");
        assert_eq!(decode_rxm_ty(&outcome, &ty), None, "the browser's decoder refuses {src}");
    }
}

#[test]
fn both_tm_encodings_decode_a_function_as_the_opaque_function() {
    for &(src, _) in PROGRAMS {
        let rv = run(src).unwrap();
        let (core, ty) = compile(src);
        let encodings: [&dyn Encoding; 2] = [&Unary::default(), &Binary::default()];
        for enc in encodings {
            let (tm, width) = run_tm_fitted(&core, enc, TM_DEFAULT_CAPS);
            let TmRun::Ran { tapes } = tm else { panic!("{src} did not halt on the TM: {tm:?}") };
            let enc = enc.at_width(width.expect("both encodings report a width"));
            let enc = enc.as_ref();
            assert_eq!(decode_tape(&tapes, &rv, enc), Some(rv.observable()), "witness decode of {src}");
            assert_eq!(decode_tape_ty_opaque(&tapes, &ty, enc), Some(rv.observable()), "opaque type decode of {src}");
            assert_eq!(decode_tape_ty(&tapes, &ty, enc), None, "the browser's decoder refuses {src}");
        }
    }
}

/// A function word must point at a heap cell. The cell's contents are not read, but a word that names
/// no cell is no function a run could have built, so it is the file's mismatch rather than a function.
#[test]
fn a_function_word_that_points_at_no_heap_cell_does_not_decode() {
    let ty = Ty::Fun(vec![Ty::Nat], Box::new(Ty::Nat));
    let cell = vec![(0, 0)];
    let good = RxmOutcome { result: 1, heap: cell.clone() };
    assert_eq!(decode_rxm_ty_opaque(&good, &ty), Some(Value::Function));
    for result in [0, 2, u64::MAX] {
        let bad = RxmOutcome { result, heap: cell.clone() };
        assert_eq!(decode_rxm_ty_opaque(&bad, &ty), None, "result word {result}");
        assert_eq!(decode_rxm(&bad, &Value::Function), None, "witness decode of result word {result}");
    }
}

/// A λ term the type calls a function must be an abstraction. Every closed normal form a function type
/// reduces to is one, so anything else did not come from reducing a closed program.
#[test]
fn a_lambda_term_that_is_not_an_abstraction_does_not_decode_as_a_function() {
    let ty = Ty::Fun(vec![Ty::Nat], Box::new(Ty::Nat));
    let id = term::abs("x", term::var(0));
    assert_eq!(decode_lambda_ty_opaque(&id, &ty), Some(Value::Function));
    assert_eq!(decode(&id, &Value::Function), Some(Value::Function));
    let not_abs = term::app(term::var(0), term::var(1));
    assert_eq!(decode_lambda_ty_opaque(&not_abs, &ty), None);
    assert_eq!(decode(&not_abs, &Value::Function), None);
}

/// A bare type variable names no shape to check a result against, so the opaque decoders refuse it
/// exactly as the browser's do.
#[test]
fn a_bare_type_variable_still_does_not_decode() {
    let ty = Ty::Var(0);
    let outcome = RxmOutcome { result: 1, heap: vec![(0, 0)] };
    assert_eq!(decode_rxm_ty_opaque(&outcome, &ty), None);
    assert_eq!(decode_lambda_ty_opaque(&term::abs("x", term::var(0)), &ty), None);
}

/// A box is a mutable cell, not a function, and keeps its own refusal.
#[test]
fn a_box_witness_still_does_not_decode() {
    let boxed = Value::Box(Rc::new(std::cell::RefCell::new(Value::Nat(1))));
    let outcome = RxmOutcome { result: 1, heap: vec![(0, 0)] };
    assert_eq!(decode_rxm(&outcome, &boxed), None);
    assert_eq!(decode(&term::abs("x", term::var(0)), &boxed), None);
}

/// `head` alone is a builtin used as a value. The reference reports it as a function; λ's encoding of
/// `head` diverges once reduction goes under its binders, and the machine legs have no lowering for a
/// builtin as a value. So it is the reference's alone, and the oracles leave it out.
#[test]
fn a_bare_builtin_is_a_function_on_the_reference_alone() {
    let rv = run("head").unwrap();
    assert!(matches!(rv, Value::Builtin(_)), "{rv:?}");
    assert_eq!(rv.observable(), Value::Function);
    let (core, _) = compile("head");
    assert!(matches!(run_lambda(&core, 20_000), LambdaRun::HitCap));
    assert!(lower_program(&core).is_err());
}
