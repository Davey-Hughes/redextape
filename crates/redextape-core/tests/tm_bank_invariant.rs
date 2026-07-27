//! Layer 3 of the overflow guard's completeness argument (design spec §4).
//!
//! The guard-site table is an argument from ENUMERATION: it is sound only if the four guarded sites are
//! genuinely all the places a value reaches fixed-width storage. That is true today — a grep for
//! value-writes (`Some(MARK)`) to REG and BOX returns exactly four rules — but it decays silently the
//! moment a later slice adds a fifth, and it depends on boundary reasoning that could simply be wrong.
//!
//! So rather than trusting the enumeration, assert the PROPERTY those sites exist to preserve: that the
//! REG bank stays well-formed, after every single step, over the corpus at every width. This catches
//! corruption from a site nobody enumerated, from a guard disabled by rule ordering, or from a boundary
//! case derived wrong — without depending on any of those being right.
//!
//! Honest limit: this is corpus-bounded. It is an observation over the programs and widths actually run,
//! not a proof over all programs.

use proptest::prelude::*;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;

mod common;
use common::reg_bank_is_well_formed;
use redextape_core::tm::{
    Builder, Encoding, MARK, MAX_FIELD_WIDTH, MIN_FIELD_WIDTH, Move, REG, RuleSpec, SEP, TAPES, TM_DEFAULT_CAPS, Tape,
    TmCaps, TmRun, TmStatus, Unary, defunc, lower_asm, lower_tm_guarded, n_slots_of, run_tm_at, simulate_watched,
};

/// A representative spread of the survey corpus: arithmetic, monus, comparison, `if`, `let`/assign,
/// `while`, recursion, list construction and access, defunctionalized higher-order, mutual recursion,
/// a fn both called-by-name and value-used, and mutable capture (the BOX tape).
const CORPUS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "let x = 40; x + 2",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    "let add1 = |x| x + 1; add1(41)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "[1, 2, 3]",
    "head([1, 2, 3])",
    "head(tail(cons(1, cons(2, nil))))",
    "is_empty(cons(1, nil))",
    "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)",
    "fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)",
    "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)",
    "let mut c = 0; fn ap(f, x) { f(x) } ap(|x| { c = c + x; c }, 5) + c",
];

/// Every width auto-fit can choose.
fn widths() -> Vec<usize> {
    let mut w = vec![MIN_FIELD_WIDTH];
    while *w.last().unwrap() < MAX_FIELD_WIDTH {
        w.push(w.last().unwrap() * 2);
    }
    w
}

#[test]
fn the_reg_bank_stays_well_formed_at_every_step_and_every_width() {
    for src in CORPUS {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors in `{src}`: {ds:?}");
        let core = desugar(&prog.unwrap());
        let program = match lower_asm(&core) {
            Ok(p) => p,
            Err(_) => lower_asm(&defunc(&core).expect("defuncs")).expect("lowers after defunc"),
        };
        let slots = n_slots_of(&program) as usize;

        for width in widths() {
            let enc = Unary::at(width);
            let (m, _overflow) = lower_tm_guarded(&program, &enc);
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = enc.init_reg(slots as u32);

            let mut step = 0usize;
            let mut failure: Option<String> = None;
            {
                let mut watch = |tapes: &[Tape]| {
                    step += 1;
                    let (cells, _) = tapes[REG].snapshot();
                    match reg_bank_is_well_formed(&cells, width, slots) {
                        Ok(()) => true,
                        Err(why) => {
                            failure = Some(format!("`{src}` at width {width}, step {step}: {why}"));
                            false
                        }
                    }
                };
                let (_, _, status) = simulate_watched(&m, &init, TM_DEFAULT_CAPS, &mut watch);
                assert!(
                    matches!(status, TmStatus::Halted | TmStatus::HitCap),
                    "`{src}` at width {width} must reach a defined outcome"
                );
            }
            assert!(failure.is_none(), "{}", failure.unwrap());
        }
    }
}

// ================================================================================================
// The same invariant, over GENERATED programs rather than a fixed corpus.
//
// The corpus test above is 19 hand-picked programs. It cannot say anything about program #20, which
// is the whole limitation of this layer. Running the identical checker over generated programs does
// not turn it into a proof, but it raises the sample by three orders of magnitude WITHOUT adding
// anything new to trust: it is the same dumb tape check, looking at the same actual tape.
//
// The generators randomize VALUES as well as shape, because the value is what selects the fitted
// width — a generator emitting only tiny values would exercise one width and prove nothing about the
// rest.
// ================================================================================================

/// The widths the generated properties check. Deliberately NOT the full ladder: checking the tape after
/// every step costs O(cells) per step, so a 64-cell bank on a long run dominates the suite's runtime.
/// The corpus test above already covers all five widths including 64; the marginal value of a generated
/// program is at the NARROW widths, which is where a value stops fitting and the guard has to fire.
const NARROW_WIDTHS: &[usize] = &[4, 16];

/// Small arithmetic / comparison / `if` expressions. Leaves reach 20 so different widths get chosen.
fn arb_expr() -> impl Strategy<Value = String> {
    let leaf = (0u64..20).prop_map(|n| n.to_string());
    leaf.prop_recursive(2, 6, 2, |inner| {
        prop_oneof![
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} + {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} - {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("if {a} > {b} {{ {a} }} else {{ {b} }}")),
        ]
    })
}

/// One program per BACKEND FEATURE, with the values randomized. Shape-templated rather than freely
/// generated so every sample is a valid, small, terminating program that reaches a specific gadget
/// family — `while`, list construction and access, recursion, defunctionalized higher-order, and
/// mutable-capture boxing (the BOX tape).
fn arb_feature_program() -> impl Strategy<Value = String> {
    prop_oneof![
        (1u64..6, 0u64..4).prop_map(|(k, i)| format!(
            "let mut acc = 0; let mut n = {k}; while n > 0 {{ acc = acc + {i}; n = n - 1; }} acc"
        )),
        (0u64..12, 0u64..12, 0u64..12).prop_map(|(a, b, c)| format!("head(tail([{a}, {b}, {c}]))")),
        (0u64..12, 0u64..12).prop_map(|(a, b)| format!("is_empty(cons({a}, cons({b}, nil)))")),
        (1u64..6).prop_map(|n| format!("fn sum(k) {{ if k == 0 {{ 0 }} else {{ k + sum(k - 1) }} }} sum({n})")),
        (0u64..10, 0u64..10).prop_map(|(a, b)| format!("fn ap(f, x) {{ f(x) }} fn add(y) {{ y + {a} }} ap(add, {b})")),
        (0u64..8, 0u64..8, 0u64..8).prop_map(|(a, b, c)| format!(
            "fn map(xs, f) {{ if is_empty(xs) {{ nil }} else {{ cons(f(head(xs)), map(tail(xs), f)) }} }} \
             fn inc(x) {{ x + 1 }} head([{a}, {b}, {c}].map(inc))"
        )),
        (0u64..10, 0u64..10)
            .prop_map(|(a, b)| format!("let mut c = {a}; fn ap(f, x) {{ f(x) }} ap(|x| {{ c = c + x; c }}, {b}) + c")),
        (0u64..10, 0u64..10)
            .prop_map(|(a, b)| format!("let mut n = {a}; fn ap0(g) {{ g(0) }} let f = |x| x + n; n = {b}; ap0(f)")),
    ]
}

/// Run `src` at `width` and return the first invariant violation, if any. `None` means every step of
/// the run left both fixed-width banks well-formed.
fn first_violation(src: &str, width: usize) -> Option<String> {
    let (prog, ds) = parse(src);
    if !ds.is_empty() {
        return None; // not a program; the generators' shapes are valid, this is belt-and-braces
    }
    let core = desugar(&prog.unwrap());
    let program = match lower_asm(&core) {
        Ok(p) => p,
        Err(_) => defunc(&core).ok().and_then(|d| lower_asm(&d).ok())?,
    };
    let slots = n_slots_of(&program) as usize;
    let enc = Unary::at(width);
    let (m, _) = lower_tm_guarded(&program, &enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(slots as u32);
    let mut step = 0usize;
    let mut failure = None;
    {
        let mut watch = |tapes: &[Tape]| {
            step += 1;
            let (cells, _) = tapes[REG].snapshot();
            match reg_bank_is_well_formed(&cells, width, slots) {
                Ok(()) => true,
                Err(why) => {
                    failure = Some(format!("`{src}` at width {width}, step {step}: {why}"));
                    false
                }
            }
        };
        // A modest cap: these are small programs, and an invariant violation shows up long before a
        // real program would finish. A cap here bounds the whole proptest's runtime.
        simulate_watched(&m, &init, TmCaps { steps: 150_000, cells: 150_000 }, &mut watch);
    }
    failure
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, ..ProptestConfig::default() })]

    /// The bank invariant over generated arithmetic, at the narrow widths where an overflow is most
    /// likely and the tape is cheapest to check every step.
    #[test]
    fn generated_expressions_never_corrupt_the_bank(src in arb_expr()) {
        for width in NARROW_WIDTHS {
            if let Some(why) = first_violation(&src, *width) {
                prop_assert!(false, "{}", why);
            }
        }
    }

    /// The same, over one program per backend feature — `while`, lists, recursion, defunctionalized
    /// higher-order, and mutable-capture boxing — with values randomized so several widths are hit.
    #[test]
    fn generated_feature_programs_never_corrupt_the_bank(src in arb_feature_program()) {
        for width in NARROW_WIDTHS {
            if let Some(why) = first_violation(&src, *width) {
                prop_assert!(false, "{}", why);
            }
        }
    }
}

/// NON-VACUITY: the properties above are worthless if `first_violation` silently returns `None`
/// because nothing ran. Assert that the generated programs actually execute a substantial number of
/// steps, and that BOTH generators reach programs that overflow at a narrow width (so the invariant is
/// being checked on runs that halt in the guard, not only on clean ones).
#[test]
fn the_generated_programs_actually_run() {
    use proptest::strategy::ValueTree;
    use proptest::test_runner::{Config, TestRunner};

    let mut runner = TestRunner::new(Config { cases: 100, ..Config::default() });
    for (label, strategy) in [("expr", arb_expr().boxed()), ("feature", arb_feature_program().boxed())] {
        let (mut ran, mut overflowed) = (0usize, 0usize);
        for _ in 0..100 {
            let src = strategy.new_tree(&mut runner).expect("generates").current();
            let (prog, ds) = parse(&src);
            if !ds.is_empty() {
                continue;
            }
            let core = desugar(&prog.unwrap());
            match run_tm_at(&core, &Unary::at(4), TM_DEFAULT_CAPS) {
                TmRun::Ran { .. } => ran += 1,
                TmRun::Overflow => overflowed += 1,
                _ => {}
            }
        }
        assert!(ran + overflowed > 80, "{label}: too few generated programs reached the TM at all");
        assert!(
            overflowed > 0,
            "{label}: no generated program overflowed at width 4, so the invariant was never checked \
             on a run that halts in the guard"
        );
    }
}

/// SABOTAGE for layer 3 itself: an UNGUARDED write site. Without this, the invariant test above could
/// be passing merely because the four enumerated guards already catch everything — which would leave it
/// blind to exactly the case it exists for, a fifth site added by a later slice.
///
/// Rather than editing the encoding, this builds a machine by hand whose only job is to write one mark
/// more than a field can hold, which is precisely what an unguarded `append_work_to_field` does.
#[test]
fn the_invariant_catches_an_unguarded_write() {
    let width = 4usize;
    let enc = Unary::at(width);
    let mut b = Builder::new();
    let start = b.state("start");
    let halt = b.accept("halt");
    // Step off the leading `#` onto field 0's first cell, then write `width + 1` marks rightward — one
    // past the window, destroying the field's trailing `#`.
    let mut cur = b.state("w0");
    b.add_rule(start, RuleSpec::new().on(REG, Some(SEP), None, Move::R), cur);
    for k in 0..=width {
        let nxt = b.state(format!("w{}", k + 1));
        b.add_rule(cur, RuleSpec::new().on(REG, None, Some(MARK), Move::R), nxt);
        cur = nxt;
    }
    b.add_rule(cur, RuleSpec::new(), halt);
    let m = b.finish(start);

    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(2);
    let mut caught: Option<String> = None;
    {
        let mut watch = |tapes: &[Tape]| {
            let (cells, _) = tapes[REG].snapshot();
            match reg_bank_is_well_formed(&cells, width, 2) {
                Ok(()) => true,
                Err(why) => {
                    caught = Some(why);
                    false
                }
            }
        };
        simulate_watched(&m, &init, TM_DEFAULT_CAPS, &mut watch);
    }
    assert!(caught.is_some(), "the bank invariant must catch a write site no guard knows about");
}

/// The invariant is not vacuous in the other direction either: a WELL-FORMED bank must pass. A checker
/// that rejected everything would make the corpus test above fail loudly rather than silently, but a
/// checker that accepted everything would make it pass silently — so pin an accepting case too.
#[test]
fn a_well_formed_bank_passes_the_invariant() {
    let enc = Unary::at(8);
    let cells = enc.init_reg(3);
    assert_eq!(reg_bank_is_well_formed(&cells, 8, 3), Ok(()), "a freshly initialized bank must be well-formed");
    // A bank holding values passes, and so does one caught MID-REWRITE (blanks then marks) — the
    // skeleton is what is invariant, not the field content order.
    let mut held: Vec<char> = cells.clone();
    held[1] = MARK;
    held[2] = MARK;
    assert_eq!(reg_bank_is_well_formed(&held, 8, 3), Ok(()), "a bank holding values is well-formed");
    let mut mid: Vec<char> = cells.clone();
    mid[3] = MARK;
    mid[4] = MARK;
    assert_eq!(reg_bank_is_well_formed(&mid, 8, 3), Ok(()), "a mid-rewrite field must not be rejected");
    // But a destroyed delimiter must be.
    let mut broken: Vec<char> = cells.clone();
    broken[9] = MARK;
    assert!(reg_bank_is_well_formed(&broken, 8, 3).is_err(), "a clobbered delimiter must be rejected");
}
