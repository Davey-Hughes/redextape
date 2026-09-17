//! Reduced `.tm` files end to end: reduce a lowered run, print the file, parse the text back, run it under
//! the steps its own header records, and decode the program's value with nothing but the file.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use redextape_core::tm::StageKind::{Fold, SingleTape, TwoSymbol};
use redextape_core::tm::{
    EncodingKind, StageKind, TM_DEFAULT_CAPS, TmCaps, decode_reduced, parse_tm_full, print_tm_with, reduce,
    run_tm_described, simulate_final,
};

mod common;
use common::core_and_ty;

/// Reduce `src`'s lowered run through `stages`, and hold the file to the reference interpreter.
///
/// The file must parse back to the same machine and header, its run under the header's own `steps` must
/// halt in an accept state after exactly those steps, and `decode_reduced` must give the reference's value.
fn round_trip(src: &str, stages: &[StageKind]) {
    let label = format!("{src} through {stages:?}");
    let (core, ty) = core_and_ty(src);
    // `interp::eval` is this project's reference interpreter for the mini-language, run on a fixed corpus.
    let expected = redextape_core::interp::eval(&core).unwrap_or_else(|e| panic!("reference failed for {src}: {e:?}"));
    let d = run_tm_described(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS)
        .unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
    let (m, h) = reduce(&d, stages).unwrap_or_else(|e| panic!("{label}: {e:?}"));
    let text = print_tm_with(&m, &h);

    let doc = parse_tm_full(&text);
    assert!(doc.diagnostics.is_empty(), "{label}: {:?}", doc.diagnostics);
    let (parsed_m, parsed_h) = (doc.machine.expect("a machine"), doc.header.expect("a header"));
    // `assert!` rather than `assert_eq!`: a failure would print millions of rules.
    assert!(parsed_m == m, "{label}: the machine must round-trip");
    assert_eq!(parsed_h, h, "{label}: the header must round-trip");
    let r = parsed_h.reduction.as_ref().expect("a reduced header");
    let kinds: Vec<StageKind> = r.stages.iter().map(|s| s.kind()).collect();
    assert_eq!(kinds, stages, "{label}: the header records the stages that ran");

    let caps = TmCaps { steps: r.steps, cells: TM_DEFAULT_CAPS.cells };
    let (tapes, state, _status, steps) = simulate_final(&parsed_m, &parsed_h.init(parsed_m.tapes), caps);
    let halted_in = &parsed_m.states[state as usize];
    assert!(halted_in.accept, "{label}: halted in `{}`, not an accept state", halted_in.name);
    assert_eq!(steps, r.steps, "{label}: the header records the steps its run takes");
    assert_eq!(decode_reduced(&tapes, &parsed_h), Ok(expected), "{label}");
    println!("{label}: {steps} steps, {} bytes", text.len());
}

/// The fast tier's program. Its value is 2, not 0: a decode that goes wrong on a tape whose value is 0
/// reads 0 anyway, and `3 - 5` hid a header whose code had two of its symbols swapped.
const FIVE_MINUS_THREE: &str = "5 - 3";

/// The web app's browser tier pastes this file into a TM buffer, so it must be the file `reduce` writes today: a stale
/// copy would pin the web app to a format nothing produces any more.
#[test]
fn the_web_fixture_is_the_file_reduce_writes_today() {
    let (core, ty) = core_and_ty(FIVE_MINUS_THREE);
    let d = run_tm_described(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS).unwrap();
    let (m, h) = reduce(&d, &[SingleTape]).unwrap();
    let written = print_tm_with(&m, &h);
    // `assert!` rather than `assert_eq!`, for `round_trip`'s reason: a failure would print a hundred thousand bytes.
    assert!(
        include_str!("fixtures/five_minus_three_single_tape.tm") == written,
        "regenerate it: `redextape emit five-minus-three.rxt --lang tm --reduce single-tape -o \
         crates/redextape-core/tests/fixtures/five_minus_three_single_tape.tm`, from a file holding `5 - 3`"
    );
}

#[test]
fn the_fold_alone_decodes() {
    round_trip(FIVE_MINUS_THREE, &[Fold]);
}

#[test]
fn stage_one_alone_decodes() {
    round_trip(FIVE_MINUS_THREE, &[SingleTape]);
}

#[test]
fn stage_two_alone_decodes() {
    round_trip(FIVE_MINUS_THREE, &[TwoSymbol]);
}

#[test]
fn the_fold_then_stage_one_decodes() {
    round_trip(FIVE_MINUS_THREE, &[Fold, SingleTape]);
}

#[test]
fn the_fold_then_stage_two_decodes() {
    round_trip(FIVE_MINUS_THREE, &[Fold, TwoSymbol]);
}

#[test]
fn stages_one_then_two_decode() {
    round_trip(FIVE_MINUS_THREE, &[SingleTape, TwoSymbol]);
}

/// Over 1 s in debug even alone: its reduction is verified at over seven million steps, then run again from
/// the text.
#[test]
#[ignore = "slow tier: run via scripts/check-slow.sh"]
fn all_three_stages_decode() {
    round_trip(FIVE_MINUS_THREE, &[Fold, SingleTape, TwoSymbol]);
}

#[test]
#[ignore = "slow tier: run via scripts/check-slow.sh"]
fn all_three_stages_decode_on_larger_programs() {
    for src in ["cons(1, cons(2, nil))", "if 2 > 1 { 10 } else { 20 }", "1 + 2 * 3"] {
        round_trip(src, &[Fold, SingleTape, TwoSymbol]);
    }
}

#[test]
#[ignore = "slow tier: run via scripts/check-slow.sh"]
fn stage_one_decodes_on_a_recursive_sum() {
    round_trip("fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)", &[SingleTape]);
}
