//! Correctness properties of the VARIABLE field width itself, as distinct from the overflow guard.
//!
//! `tm_bank_invariant.rs` checks that the REG bank is never corrupted. This file checks the four things
//! that everything built on top of variable widths will depend on, each of which was previously either
//! argued or covered only by a handful of hand-picked programs:
//!
//!   1. AUTO-FIT IS ANSWER-PRESERVING. `run_tm` (which now searches) must agree with `run_tm_at(64)`
//!      (which does not) and with the reference, over randomly generated programs whose values span the
//!      whole representable range — so the retry path is actually taken at every width.
//!   2. THE BOX TAPE stays well-formed at every step, the same property `tm_bank_invariant.rs` asserts
//!      for REG. `box_overwrite_field` was restructured from content-driven to a counted chain in this
//!      slice, so it is the gadget with the most recent structural change and the least coverage.
//!   3. EVERY WIDTH IS TOTAL, not just the five powers of two auto-fit happens to try. `Unary::at`
//!      accepts any `usize`, and later work (a visualizer, the binary encoding) will pass others.
//!   4. NARROWER IS NEVER MORE WORK. `run_tm_fitted` returns `HitCap` from the FIRST attempt without
//!      retrying wider, which is only sound if a run that caps at a narrow width would also cap at
//!      every wider one. That is an argument about monotonicity; this measures it.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use proptest::prelude::*;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::run;
use redextape_core::tm::{
    BLANK, BOX, Binary, Encoding, EncodingKind, MARK, MAX_FIELD_WIDTH, MIN_FIELD_WIDTH, REG, SEP, TAPES,
    TM_DEFAULT_CAPS, Tape, TmCaps, TmRun, TmStatus, Unary, WORK, ZERO, decode_tape, defunc, lower_asm,
    lower_tm_guarded, n_slots_of, run_tm, run_tm_at, run_tm_fitted, simulate_counts, simulate_watched,
};

mod common;
use common::box_tape_is_well_formed;

/// Every width auto-fit can choose.
fn widths() -> Vec<usize> {
    let mut w = vec![MIN_FIELD_WIDTH];
    while *w.last().unwrap() < MAX_FIELD_WIDTH {
        w.push(w.last().unwrap() * 2);
    }
    w
}

/// EVERY encoding. This file's properties must hold for each, tested at its OWN default (`MAX_FIELD_WIDTH`)
/// width — the width `run_tm_at`/`run_tm` pin to when no explicit width is given.
fn encodings() -> Vec<(&'static str, Box<dyn Encoding>)> {
    // `at(MAX_FIELD_WIDTH)`, not a default: identical to `{Unary,Binary}::default()` today, and stated
    // explicitly so a future encoding whose default differs cannot silently re-width this test.
    EncodingKind::ALL.iter().map(|&k| (k.name(), k.at(MAX_FIELD_WIDTH))).collect()
}

/// EVERY encoding at a given width — used where the property is checked at every rung of `widths()`
/// rather than only at the default.
fn encodings_at(width: usize) -> Vec<(&'static str, Box<dyn Encoding>)> {
    EncodingKind::ALL.iter().map(|&k| (k.name(), k.at(width))).collect()
}

// ================================================================================================
// 1. Auto-fit is answer-preserving
// ================================================================================================

/// Arithmetic whose values SPAN the representable range rather than staying tiny, so that auto-fit
/// actually exercises its retry loop at every width — and sometimes runs off the ceiling entirely.
///
/// `arb_tm_safe_expr` in `three_way_oracle.rs` is deliberately bounded so every value stays « 64; that
/// makes it a poor test of a search whose whole job is to find the right width, because every program
/// would fit at 8 on the first attempt. Leaves here reach 70, above `MAX_FIELD_WIDTH`, so `Overflow` is
/// a reachable outcome and must be reported identically by both entry points.
fn arb_wide_ranging_expr() -> impl Strategy<Value = String> {
    let leaf = (0u64..70).prop_map(|n| n.to_string());
    leaf.prop_recursive(3, 8, 3, |inner| {
        prop_oneof![
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} + {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} - {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("if {a} > {b} {{ {a} }} else {{ {b} }}")),
            (inner.clone(), inner).prop_map(|(a, b)| format!("if {a} == {b} {{ 1 }} else {{ 0 }}")),
        ]
    })
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 400, ..ProptestConfig::default() })]

    /// The property everything else will rest on: SEARCHING FOR A WIDTH DOES NOT CHANGE THE ANSWER.
    /// `run_tm` auto-fits, `run_tm_at(64)` does not, and for every program they must reach the same
    /// outcome — the same value, or `Overflow` from both, or `HitCap` from both. The reference is
    /// checked too, so this is not merely two TM paths agreeing with each other.
    #[test]
    fn auto_fit_agrees_with_a_pinned_wide_run(src in arb_wide_ranging_expr()) {
        let (prog, ds) = parse(&src);
        prop_assume!(ds.is_empty());
        let core = desugar(&prog.unwrap());
        let reference = run(&src);

        for (name, enc) in encodings() {
            let enc = enc.as_ref();
            let (auto, width) = run_tm_fitted(&core, enc, TM_DEFAULT_CAPS);
            let pinned = run_tm_at(&core, enc, TM_DEFAULT_CAPS);

            match (&auto, &pinned) {
                (TmRun::Ran { tapes: a }, TmRun::Ran { tapes: p }) => {
                    let rv = reference.as_ref().expect("a program that runs on the TM must run on the reference").clone();
                    // Decode the AUTO tapes at the width ACTUALLY FITTED (`enc.at_width`), not `enc`'s
                    // own default. Once required — `Binary`'s decode was width-strict, so a tape fitted
                    // narrower than 64 decoded to `None` under a 64-cell `Binary` — and now redundant,
                    // both decoders being structural. Kept because THIS suite is where `at_width` is the
                    // subject: dropping it would decode both runs through the same instance and stop
                    // exercising the re-instantiation the comparison is about.
                    let w = width.expect("a bounded encoding always reports a width");
                    let fitted = enc.at_width(w);
                    let from_auto = decode_tape(a, &rv, fitted.as_ref());
                    // The PINNED run always executes at `enc`'s own (`MAX_FIELD_WIDTH`) width, so `enc`
                    // itself is the right decode encoding here.
                    let from_pinned = decode_tape(p, &rv, enc);
                    prop_assert_eq!(&from_auto, &Some(rv.clone()), "{}: auto-fit disagreed with the reference: {}", name, src);
                    prop_assert_eq!(&from_auto, &from_pinned, "{}: auto-fit and pinned-64 disagreed: {}", name, src);
                    // A value that fits must have been found at or below the ceiling.
                    prop_assert!(w <= MAX_FIELD_WIDTH, "{}: fitted width {} exceeds the ceiling for {}", name, w, src);
                }
                (TmRun::Overflow, TmRun::Overflow) => {
                    // Both refuse, which is the agreement this test is about. Deliberately NOT asserted
                    // here: that the reference's RESULT exceeds the ceiling. It often does not — the first
                    // counterexample this generator produced was `(0 + if 64 == 0 { 1 } else { 0 })`, whose
                    // result is 0 but whose literal `64` must be stored in a field to be compared, and 64
                    // does not fit a 64-cell field (the bound is strict). The fitted width is set by the
                    // largest value ever STORED, never by the answer. See
                    // `overflow_is_driven_by_stored_values_not_the_result`.
                    let _ = &reference;
                }
                (TmRun::HitCap, TmRun::HitCap) => {}
                (a, p) => prop_assert!(false, "{}: auto-fit and pinned-64 reached different outcomes for {}:\n  auto={:?}\n  pinned={:?}", name, src, a, p),
            }
        }
    }

    /// The fitted width is MINIMAL among the widths tried: the program must overflow one step narrower.
    /// Without this, a search that always returned 64 would pass every correctness test above while
    /// delivering none of the point of the slice.
    #[test]
    fn the_fitted_width_is_the_narrowest_that_works(src in arb_wide_ranging_expr()) {
        let (prog, ds) = parse(&src);
        prop_assume!(ds.is_empty());
        let core = desugar(&prog.unwrap());
        for (name, enc) in encodings() {
            let (outcome, width) = run_tm_fitted(&core, enc.as_ref(), TM_DEFAULT_CAPS);
            if !matches!(outcome, TmRun::Ran { .. }) {
                continue;
            }
            let w = width.expect("a bounded encoding always reports a width");
            if w > MIN_FIELD_WIDTH {
                let narrower = run_tm_at(&core, enc.at_width(w / 2).as_ref(), TM_DEFAULT_CAPS);
                prop_assert!(
                    matches!(narrower, TmRun::Overflow),
                    "{}: fitted width {} for {} is not minimal — it also runs at {}", name, w, src, w / 2
                );
            }
        }
    }
}

/// Drive `strategy` `n` times through `enc`'s auto-fit and report the distinct fitted widths seen, how
/// many ran, and how many overflowed.
fn probe_search(enc: &dyn Encoding, n: u32) -> (std::collections::BTreeSet<usize>, usize, usize) {
    use proptest::strategy::ValueTree;
    use proptest::test_runner::{Config, TestRunner};

    let mut runner = TestRunner::new(Config { cases: n, ..Config::default() });
    let strategy = arb_wide_ranging_expr();
    let mut widths_seen = std::collections::BTreeSet::new();
    let (mut overflows, mut ran) = (0usize, 0usize);
    for _ in 0..n {
        let src = strategy.new_tree(&mut runner).expect("generates").current();
        let (prog, ds) = parse(&src);
        if !ds.is_empty() {
            continue;
        }
        let core = desugar(&prog.unwrap());
        match run_tm_fitted(&core, enc, TM_DEFAULT_CAPS) {
            (TmRun::Ran { .. }, Some(w)) => {
                widths_seen.insert(w);
                ran += 1;
            }
            (TmRun::Overflow, _) => overflows += 1,
            _ => {}
        }
    }
    (widths_seen, ran, overflows)
}

/// NON-VACUITY for `arb_wide_ranging_expr` under UNARY: the properties above are only worth anything if
/// the generator actually drives auto-fit through its retry loop and off its ceiling. A generator whose
/// every program fitted at width 4 on the first attempt would pass both properties while testing
/// nothing about searching.
///
/// Asserts the generator reaches at least three distinct fitted widths AND produces some `Overflow`s,
/// over a fixed sample so the check is deterministic.
///
/// UNARY ONLY — measured, not assumed. Under `Binary` this generator (leaves 0..70, depth 3, size 8)
/// never produces a value needing more than an 8-cell field: a fixed 300-sample probe gave
/// `ran=300 overflows=0 widths_seen={4, 8}`, for every seed tried. That is not under-sampling — it is
/// structural. Unary's bound is `v < width`, so a leaf of 70 already exceeds even the 64-cell ceiling
/// (capacity 64), which is exactly why `Overflow` and wide widths are reachable for unary with this
/// generator. Binary's bound is `v < 2^width`, so the 64-cell ceiling has capacity 2^64 — a value in the
/// hundreds (the largest this generator's shape can produce) cannot come remotely close. Reusing the
/// SAME generator to make the SAME claim for binary would need leaves in the quintillions, which is not
/// what this generator is for; see `the_wide_ranging_generator_for_binary` below for the honest,
/// weaker claim this generator CAN support for binary.
#[test]
fn the_wide_ranging_generator_actually_exercises_the_search() {
    let (widths_seen, ran, overflows) = probe_search(&Unary::default(), 300);
    assert!(ran > 50, "generator produced too few running programs to be meaningful: {ran}");
    assert!(
        widths_seen.len() >= 3,
        "the generator must drive auto-fit to several different widths, saw only {widths_seen:?}"
    );
    assert!(widths_seen.iter().any(|&w| w > MIN_FIELD_WIDTH), "no program ever needed a retry: {widths_seen:?}");
    assert!(overflows > 0, "the generator never reached the ceiling, so the Overflow arm is untested");
}

/// The honest binary counterpart to the test above: `arb_wide_ranging_expr` cannot drive binary's
/// search off its ceiling (see that test's doc for the measured reason), but it DOES still drive it
/// through more than one width — the retry path from 4 is genuinely taken, just never very far — which
/// is the part of `auto_fit_agrees_with_a_pinned_wide_run`'s binary coverage this pins as non-vacuous.
#[test]
fn the_wide_ranging_generator_for_binary_reaches_more_than_one_width() {
    let (widths_seen, ran, overflows) = probe_search(&Binary::default(), 300);
    assert!(ran > 250, "generator produced too few running binary programs to be meaningful: {ran}");
    assert!(
        widths_seen.len() >= 2,
        "the generator must drive binary auto-fit past width 4 at least sometimes, saw only {widths_seen:?}"
    );
    // NOT asserted: `overflows > 0` or `widths_seen.len() >= 3` — measured false for this generator
    // under binary (see the doc above), and not a defect.
    let _ = overflows;
}

/// The fitted width is set by the largest value ever STORED IN A FIELD, not by the program's result.
/// Found by the proptest above rather than anticipated, and worth its own case because it is the most
/// natural wrong mental model of what auto-fit does — and because a reader debugging an unexpected
/// `Overflow` will look at the answer first.
///
/// Each program below produces a SMALL result from a LARGE intermediate or literal, so a width chosen
/// from the answer would be far too narrow.
///
/// UNARY-ONLY, deliberately, and this file's discipline is to say why rather than leave the gap
/// unexplained. The programs are built around values that overflow a 64-CELL unary field (64 itself
/// does not fit, since the bound is strict). Under `Binary` a 64-cell field holds `2^64`, so the same
/// literals fit comfortably and the test would assert nothing — a binary version needs operands near
/// `2^64`, which is a different test with different programs, not this one parameterized.
#[test]
fn overflow_is_driven_by_stored_values_not_the_result() {
    // Result 0, but the literal 64 must be stored to compare it — and 64 does not fit 64 cells.
    let core = desugar(&parse("if 64 == 0 { 1 } else { 0 }").0.expect("parses"));
    assert!(matches!(run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS), TmRun::Overflow));

    // Result 0, intermediate 60: needs a 64-cell field despite answering 0.
    let core = desugar(&parse("60 - 60").0.expect("parses"));
    let (outcome, width) = run_tm_fitted(&core, &Unary::default(), TM_DEFAULT_CAPS);
    assert!(matches!(outcome, TmRun::Ran { .. }));
    assert_eq!(width, Some(64), "the intermediate 60 sets the width, not the answer 0");

    // Result 1, intermediate 30: width comes from 30, not from 1.
    let core = desugar(&parse("if 30 > 29 { 1 } else { 0 }").0.expect("parses"));
    let (_, width) = run_tm_fitted(&core, &Unary::default(), TM_DEFAULT_CAPS);
    assert_eq!(width, Some(32), "the operands set the width, not the 0/1 answer");
}

// ================================================================================================
// 2. The BOX tape stays well-formed at every step
// ================================================================================================

/// Programs that exercise the BOX tape: mutable capture, which is the only thing that allocates one.
const BOX_CORPUS: &[&str] = &[
    "let mut c = 0; fn ap(f, x) { f(x) } ap(|x| { c = c + x; c }, 5) + c",
    "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 3; apply0(f)",
    "let mut c = 0; fn twice(g) { g(0); g(0); } let bump = |x| { c = c + 1; c }; twice(bump); c",
    "let mut a = 1; let mut b = 2; fn ap(f, x) { f(x) } ap(|x| { a = a + x; b = b + a; b }, 2) + a + b",
];

// NOTE: this file used to define its OWN private `box_tape_is_well_formed(cells, width)` here,
// hardcoding `MARK`/`BLANK` — a second copy of `tests/common/mod.rs::box_tape_is_well_formed`, which
// takes `enc: &dyn Encoding` and was already generalized for `Binary`. Two copies of the same skeleton
// check is exactly the situation `common/mod.rs` exists to avoid (see its own module doc), so this file
// now imports the shared one (`use common::box_tape_is_well_formed;`, above) instead of reimplementing
// it a second time under `Binary`'s alphabet.

#[test]
fn the_box_tape_stays_well_formed_at_every_step_and_every_width() {
    for src in BOX_CORPUS {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors in `{src}`: {ds:?}");
        let core = desugar(&prog.unwrap());
        let program = lower_asm(&defunc(&core).expect("defuncs")).expect("lowers after defunc");
        for width in widths() {
            for (name, enc) in encodings_at(width) {
                let enc = enc.as_ref();
                let (m, _) = lower_tm_guarded(&program, enc);
                let mut init = vec![Vec::new(); TAPES];
                init[REG] = enc.init_reg(n_slots_of(&program));
                init[WORK] = enc.init_work();
                let mut step = 0usize;
                let mut failure: Option<String> = None;
                {
                    let mut watch = |tapes: &[Tape]| {
                        step += 1;
                        let (cells, _) = tapes[BOX].snapshot();
                        match box_tape_is_well_formed(&cells, enc) {
                            Ok(()) => true,
                            Err(why) => {
                                failure = Some(format!("`{src}` at width {width} ({name}), step {step}: {why}"));
                                false
                            }
                        }
                    };
                    simulate_watched(&m, &init, TM_DEFAULT_CAPS, &mut watch);
                }
                assert!(failure.is_none(), "{}", failure.unwrap());
            }
        }
    }
}

/// The BOX checker is not vacuous: a tape with a mark where the top's blanks belong must be rejected.
#[test]
fn the_box_checker_rejects_a_spill_past_the_last_field() {
    let width = 4usize;
    let enc = Unary::at(width);
    // One well-formed field, then a stray mark in the top — exactly the shape a content-driven
    // overrun of the LAST field would produce, which is why the gadget is counted.
    let good: Vec<char> = vec![SEP, MARK, MARK, BLANK, BLANK];
    assert_eq!(box_tape_is_well_formed(&good, &enc), Ok(()));
    let spilled: Vec<char> = vec![SEP, MARK, MARK, BLANK, BLANK, MARK];
    assert!(box_tape_is_well_formed(&spilled, &enc).is_err(), "a spill into the top must be rejected");
    // And an empty box is well-formed.
    assert_eq!(box_tape_is_well_formed(&[], &enc), Ok(()));
    assert_eq!(box_tape_is_well_formed(&[BLANK, BLANK], &enc), Ok(()));
}

/// The shared checker's CONTENT clause is generic over the encoding (`common::box_tape_is_well_formed`
/// takes `enc: &dyn Encoding`, generalized from this file's own former private copy). A `ZERO` digit is
/// legal `Binary` content but not `Unary` content, so the same BOX tape must be ACCEPTED under `Binary`
/// and REJECTED under `Unary` — the claim the unary-only test above cannot make on its own.
#[test]
fn the_box_checker_accepts_binary_digit_content_and_rejects_it_under_unary() {
    let enc = Binary::at(2);
    // One field holding "01" (LSB-first digits), then the blank top.
    let good: Vec<char> = vec![SEP, ZERO, MARK, BLANK, BLANK];
    assert_eq!(box_tape_is_well_formed(&good, &enc), Ok(()));
    assert!(
        box_tape_is_well_formed(&good, &Unary::at(4)).is_err(),
        "a `ZERO` digit is not unary field content, so the same tape must be rejected under `Unary`"
    );
}

// ================================================================================================
// 3. Every width is total
// ================================================================================================

/// `Unary::at` accepts any `usize`, and auto-fit only ever tries five powers of two. A visualizer
/// sizing to a value, or the binary encoding's own search, will pass others — including degenerate
/// ones. Every width must reach a DEFINED outcome: no panic, no hang, no wrong answer.
///
/// Width 0 and 1 are the interesting degenerates. At width 0 no value is representable at all (the
/// bound is strict, so even 0 needs one padding cell); at width 1 only the value 0 is. Both must
/// report `Overflow` rather than looping or corrupting.
#[test]
fn every_field_width_reaches_a_defined_outcome() {
    const PROGRAMS: &[&str] = &[
        "1 + 2 * 3",
        "let x = 5; x + 1",
        "[1, 2, 3]",
        "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(4)",
        "let mut c = 0; fn ap(f, x) { f(x) } ap(|x| { c = c + x; c }, 3) + c",
    ];
    // Powers of two, non-powers of two, degenerates, and one far above the usual ceiling.
    const ODD_WIDTHS: &[usize] = &[0, 1, 2, 3, 5, 7, 9, 13, 31, 33, 64, 65, 100];
    for src in PROGRAMS {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors in `{src}`: {ds:?}");
        let core = desugar(&prog.unwrap());
        let reference = run(src).expect("reference runs");
        for &w in ODD_WIDTHS {
            // A modest cap so a hypothetical hang shows up as a failed test rather than a hung suite.
            let caps = TmCaps { steps: 3_000_000, cells: 3_000_000 };
            for (name, enc) in encodings_at(w) {
                match run_tm_at(&core, enc.as_ref(), caps) {
                    TmRun::Ran { tapes } => {
                        assert_eq!(
                            decode_tape(&tapes, &reference, enc.as_ref()),
                            Some(reference.clone()),
                            "`{src}` ({name}) RAN at width {w} but decoded to the wrong value — a width \
                             that completes must be correct, not merely defined"
                        );
                    }
                    TmRun::Overflow | TmRun::HitCap => {}
                    TmRun::TooLarge => panic!(
                        "`{src}` ({name}) was refused as too large to lower at width {w} — every PROGRAMS \
                         entry here is small, so this refusal must be a bug, not a real layout limit"
                    ),
                    TmRun::LowerError(e) => panic!("`{src}` ({name}) failed to lower at width {w}: {e:?}"),
                }
            }
        }
    }
}

/// The degenerate widths specifically: no value fits at 0, and only `0` fits at 1. Stated as its own
/// test because "reaches a defined outcome" above would be satisfied by an implementation that ran
/// them and returned nonsense.
#[test]
fn degenerate_widths_refuse_rather_than_miscompute() {
    let core = desugar(&parse("1 + 2").0.expect("parses"));
    for w in [0usize, 1, 2] {
        assert!(
            matches!(run_tm_at(&core, &Unary::at(w), TM_DEFAULT_CAPS), TmRun::Overflow),
            "`1 + 2` = 3 must not fit a {w}-cell field"
        );
    }
    // Width 4 is the narrowest that holds 3.
    assert!(matches!(run_tm_at(&core, &Unary::at(4), TM_DEFAULT_CAPS), TmRun::Ran { .. }));

    // At width 1 the only representable value is 0, and a program producing it must still work.
    let zero = desugar(&parse("3 - 5").0.expect("parses"));
    assert!(
        matches!(run_tm_at(&zero, &Unary::at(1), TM_DEFAULT_CAPS), TmRun::Overflow),
        "the literals 3 and 5 do not fit a 1-cell field even though the RESULT is 0"
    );
}

/// The same shape of property, for BINARY — but the boundary VALUES differ, because capacity is
/// `2^width` rather than `width`. `1 + 2` = 3 needs `2^w > 3`, so it overflows through width 1
/// (capacity 2) and first succeeds at width 2 (capacity 4) — not width 4, `Unary`'s boundary above.
#[test]
fn degenerate_widths_refuse_rather_than_miscompute_binary() {
    let core = desugar(&parse("1 + 2").0.expect("parses"));
    for w in [0usize, 1] {
        assert!(
            matches!(run_tm_at(&core, &Binary::at(w), TM_DEFAULT_CAPS), TmRun::Overflow),
            "`1 + 2` = 3 must not fit a {w}-cell binary field (capacity {})",
            1u64 << w
        );
    }
    // Width 2 is the narrowest binary field that holds 3 (capacity 4).
    assert!(matches!(run_tm_at(&core, &Binary::at(2), TM_DEFAULT_CAPS), TmRun::Ran { .. }));

    // At width 0 the only representable value is 0 (capacity 1); the literals 3 and 5 do not fit even
    // though the RESULT of `3 - 5` (monus) is 0.
    let zero = desugar(&parse("3 - 5").0.expect("parses"));
    assert!(
        matches!(run_tm_at(&zero, &Binary::at(0), TM_DEFAULT_CAPS), TmRun::Overflow),
        "the literals 3 and 5 do not fit a 0-cell binary field even though the RESULT is 0"
    );
}

// ================================================================================================
// 4. Narrower is never more work
// ================================================================================================

/// `run_tm_fitted` returns `HitCap` from the first attempt WITHOUT retrying at a wider width. That is
/// only sound if a run that caps narrow would also cap wide — i.e. if step count is non-decreasing in
/// the width. The affine fit `a + b*W` with `b >= 0` says it should be; this measures it, because the
/// whole retry policy is built on it and a counterexample would mean auto-fit reports `HitCap` for a
/// program that a wider bank would have completed.
#[test]
fn step_count_is_non_decreasing_in_the_field_width() {
    const PROGRAMS: &[&str] = &[
        "1 + 2 * 3",
        "3 - 5",
        "if 2 > 1 { 10 } else { 20 }",
        "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
        "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
        "[1, 2, 3]",
        "head(tail(cons(1, cons(2, nil))))",
        "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
        "let mut c = 0; fn ap(f, x) { f(x) } ap(|x| { c = c + x; c }, 5) + c",
    ];
    for src in PROGRAMS {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors in `{src}`: {ds:?}");
        let core = desugar(&prog.unwrap());
        let program = match lower_asm(&core) {
            Ok(p) => p,
            Err(_) => lower_asm(&defunc(&core).expect("defuncs")).expect("lowers after defunc"),
        };
        for &kind in EncodingKind::ALL {
            let name = kind.name();
            let mut previous: Option<(usize, u64)> = None;
            let mut compared = 0usize;
            for width in widths() {
                let enc = kind.at(width);
                // Only compare widths at which the program actually completes: a narrower run that halts
                // in the guard stopped early by design and says nothing about monotonicity.
                if !matches!(run_tm_at(&core, enc.as_ref(), TM_DEFAULT_CAPS), TmRun::Ran { .. }) {
                    continue;
                }
                let (m, _) = lower_tm_guarded(&program, enc.as_ref());
                let mut init = vec![Vec::new(); TAPES];
                init[REG] = enc.init_reg(n_slots_of(&program));
                init[WORK] = enc.init_work();
                let (counts, status) = simulate_counts(&m, &init, TM_DEFAULT_CAPS);
                assert_eq!(status, TmStatus::Halted, "`{src}` ({name}) must complete at width {width}");
                let steps: u64 = counts.iter().sum();
                if let Some((pw, ps)) = previous {
                    compared += 1;
                    assert!(
                        steps >= ps,
                        "`{src}` ({name}) costs FEWER steps at width {width} ({steps}) than at {pw} ({ps}) — \
                         auto-fit's early `HitCap` return assumes this cannot happen"
                    );
                }
                previous = Some((width, steps));
            }
            // Non-vacuity: a program that completes at only ONE width makes zero comparisons and would
            // pass this test without testing anything.
            assert!(
                compared >= 2,
                "`{src}` ({name}) compared only {compared} width pair(s) — too few to show monotonicity"
            );
        }
    }
}

/// The consequence of monotonicity that auto-fit actually relies on, stated end to end: a program that
/// caps does so at EVERY width, so returning `HitCap` from the first attempt loses nothing.
#[test]
fn a_capping_program_caps_at_every_width() {
    let core = desugar(&parse("head(nil)").0.expect("parses"));
    let caps = TmCaps { steps: 30_000, cells: 30_000 };
    for width in widths() {
        for (name, enc) in encodings_at(width) {
            assert!(
                matches!(run_tm_at(&core, enc.as_ref(), caps), TmRun::HitCap),
                "{name}: head(nil) must spin to a cap at width {width}, not overflow or return"
            );
        }
    }
    // And auto-fit reports it from the narrowest attempt without climbing, for both encodings.
    for (name, enc) in encodings() {
        let (outcome, width) = run_tm_fitted(&core, enc.as_ref(), caps);
        assert!(matches!(outcome, TmRun::HitCap), "{name}");
        assert_eq!(width, Some(MIN_FIELD_WIDTH), "{name}");
    }
}

/// A sanity check that `run_tm` and `run_tm_at` are not accidentally the same function: they must
/// differ on a program whose values do not fit the narrowest width.
#[test]
fn run_tm_and_run_tm_at_are_genuinely_different_entry_points() {
    let core = desugar(&parse("let x = 40; x + 2").0.expect("parses"));
    for (name, enc) in encodings_at(MIN_FIELD_WIDTH) {
        assert!(matches!(run_tm_at(&core, enc.as_ref(), TM_DEFAULT_CAPS), TmRun::Overflow), "{name}");
    }
    for (name, enc) in encodings() {
        assert!(matches!(run_tm(&core, enc.as_ref(), TM_DEFAULT_CAPS), TmRun::Ran { .. }), "{name}");
    }
}
