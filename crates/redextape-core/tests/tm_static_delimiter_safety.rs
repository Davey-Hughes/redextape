//! Rung 3: STATIC delimiter safety — a whole-execution property, checked without running anything.
//!
//! Every other layer verifies by EXECUTING: layer 3 watches the tape step by step, rung 2 does that
//! exhaustively over ~200k enumerated programs. That leaves one gap those layers cannot close by
//! construction, and rung 2 measured how big it is: **50.6% of enumerated programs use the whole step
//! budget** — they are infinite loops — so half that sweep is verified only up to the cap. Simulation
//! can only ever check a prefix of a non-terminating run.
//!
//! This layer closes exactly that gap, by checking the MACHINE instead of the run:
//!
//! > No rule of the machine can write a non-`#` symbol to a fixed-width tape while the head is on a `#`.
//!
//! If that holds for every rule, then no execution of that machine — of any length, terminating or
//! not — can destroy a delimiter. It is proven per rule, in O(rules), by inspection.
//!
//! WHAT IT DOES NOT PROVE, because the earlier framing of this rung was wrong twice and the corrections
//! belong next to the claim:
//!
//!   * NOT "correct for all inputs". The TM is a closed program: `init_reg` is an all-zero bank and
//!     every other tape starts empty, so each `(program, width)` pair has exactly ONE execution.
//!     "All inputs" was never the gap; execution LENGTH was.
//!   * NOT the whole bank skeleton. It covers the DELIMITER half. The LENGTH half — the head walking
//!     off the end of the bank and extending the tape — is not visible to a per-rule check and still
//!     rests on layer 3 and rung 2.
//!   * NOT navigation correctness. A gadget can leave the head in the wrong field without ever
//!     clobbering a `#`; this says nothing about that.
//!
//! The check is deliberately syntactic. An earlier attempt at a head-offset dataflow analysis was
//! rejected because its own soundness would become a new thing to trust, and an analyzer that reports
//! "verified" while being subtly wrong is worse than a checker that can only report what it saw. The
//! price of staying syntactic is that the gadgets must be written to suit it: three rules that used to
//! write with a WILDCARD read (`on(REG, None, Some(MARK), R)`) now read explicitly. That change is
//! step-for-step identical — same rule fires on the same configuration — which is why every step-count
//! golden is unchanged.

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{BLANK, BOX, Encoding, EncodingKind, MARK, REG, SEP, defunc, lower_asm, lower_tm_guarded};

mod common;
use common::{assert_delimiter_safe, unsafe_rules};

/// EVERY encoding. Each has its own bank with its own write sites (REG, BOX, and for some encodings
/// like `Binary`, also WORK), so a corpus that only exercises one encoding verifies nothing about the others.
fn encodings_at(width: usize) -> Vec<(&'static str, Box<dyn Encoding>)> {
    EncodingKind::ALL.iter().map(|&k| (k.name(), k.at(width))).collect()
}

/// The corpus, spanning every gadget family. Kept in step with `tm_bank_invariant.rs`.
const CORPUS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "let x = 40; x + 2",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "[1, 2, 3]",
    "head(tail(cons(1, cons(2, nil))))",
    "is_empty(cons(1, nil))",
    "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)",
    "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)",
    "let mut c = 0; fn ap(f, x) { f(x) } ap(|x| { c = c + x; c }, 5) + c",
    // Programs that DIVERGE, and are therefore the whole point of this layer: no amount of simulation
    // verifies their tails, because they have no tail.
    "head(nil)",
    "tail(nil)",
];

#[test]
fn no_machine_in_the_corpus_can_write_over_a_delimiter() {
    for src in CORPUS {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors in `{src}`: {ds:?}");
        let core = desugar(&prog.unwrap());
        let program = match lower_asm(&core) {
            Ok(p) => p,
            Err(_) => lower_asm(&defunc(&core).expect("defuncs")).expect("lowers after defunc"),
        };
        for width in [2usize, 4, 8, 64] {
            for (name, enc) in encodings_at(width) {
                let (m, _) = lower_tm_guarded(&program, &*enc);
                assert_delimiter_safe(&m, &*enc, &format!("`{src}` at width {width} ({name})"));
            }
        }
    }
}

/// The property holds for DIVERGING programs, which is the gap this layer exists to close. Stated
/// separately from the corpus sweep because it is the claim, not a sample: `head(nil)` spins forever,
/// so simulation verifies a prefix and nothing more, while this covers every state it could ever
/// reach.
#[test]
fn the_property_holds_for_programs_that_never_terminate() {
    for src in ["head(nil)", "tail(nil)", "let mut n = 1; while n > 0 { n = n + 1; } n"] {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors in `{src}`: {ds:?}");
        let core = desugar(&prog.unwrap());
        let program = lower_asm(&core).expect("lowers");
        for (name, enc) in encodings_at(4) {
            let (m, _) = lower_tm_guarded(&program, &*enc);
            assert_delimiter_safe(&m, &*enc, &format!("diverging `{src}` ({name})"));
        }
    }
}

/// NON-VACUITY: the checker must actually be capable of reporting something. Build a machine with a
/// rule that writes a MARK reading a wildcard, unshadowed — precisely the shape the three gadget
/// rewrites removed — and require it to be flagged.
///
/// Without this the whole file could be passing because `unsafe_rules` never returns anything.
#[test]
fn the_checker_flags_an_unguarded_wildcard_write() {
    use redextape_core::tm::{Builder, Move, RuleSpec};
    let mut b = Builder::new();
    let s = b.state("danger");
    let halt = b.accept("halt");
    b.add_rule(s, RuleSpec::new().on(REG, None, Some(MARK), Move::R), halt);
    let m = b.finish(s);
    let bad = unsafe_rules(&m, REG);
    assert_eq!(bad.len(), 1, "a wildcard-read MARK write must be flagged: {bad:?}");
}

/// And the two ways of being safe must both be ACCEPTED, or the checker would be trivially satisfied
/// by rejecting everything — which would make the corpus test above fail rather than pass, but only
/// after someone had already written the rules differently.
#[test]
fn the_checker_accepts_both_forms_of_safety() {
    use redextape_core::tm::{Builder, Move, RuleSpec};

    // (b) explicit non-`#` read.
    let mut b = Builder::new();
    let s = b.state("explicit");
    let halt = b.accept("halt");
    b.add_rule(s, RuleSpec::new().on(REG, Some(BLANK), Some(MARK), Move::R), halt);
    assert!(unsafe_rules(&b.finish(s), REG).is_empty(), "an explicit BLANK read is safe");

    // (c) shadowed by a preceding `#` guard that constrains no other tape.
    let mut b = Builder::new();
    let s = b.state("shadowed");
    let halt = b.accept("halt");
    let guard = b.state("overflow");
    b.add_rule(s, RuleSpec::new().on(REG, Some(SEP), None, Move::S), guard);
    b.add_rule(s, RuleSpec::new().on(REG, None, Some(MARK), Move::R), halt);
    assert!(unsafe_rules(&b.finish(s), REG).is_empty(), "a preceding `#` guard shadows the wildcard");

    // But a guard that ALSO constrains another tape does not shadow totally, so it must NOT count.
    let mut b = Builder::new();
    let s = b.state("partial");
    let halt = b.accept("halt");
    let guard = b.state("overflow");
    b.add_rule(s, RuleSpec::new().on(REG, Some(SEP), None, Move::S).on(BOX, Some(MARK), None, Move::S), guard);
    b.add_rule(s, RuleSpec::new().on(REG, None, Some(MARK), Move::R), halt);
    assert_eq!(
        unsafe_rules(&b.finish(s), REG).len(),
        1,
        "a guard constraining a second tape does not fire on every `#`, so it cannot shadow"
    );
}

/// `unsafe_rules`' clause (b) accepts ANY non-`#` read, not just symbols an encoding calls "field
/// content" — see `tests/common/mod.rs` for why the field-content-restricted version was tried and
/// rejected (it flagged `box_append_field_bin`'s legitimate `BLANK` read as unsafe). Pin that this did
/// not go too far the other way: a rule that writes a digit under a WILDCARD read — no explicit read at
/// all — must still be reported, checked against a REAL `Binary` digit (`ZERO`). Without this, a fix
/// that accidentally made clause (b) accept `rule.read[tape].is_none()` too would pass every other test
/// in this file (every real gadget, unary or binary, reads an explicit symbol) while silently no longer
/// rejecting anything.
#[test]
fn the_checker_still_flags_a_wildcard_digit_write() {
    use redextape_core::tm::{Builder, Move, RuleSpec, ZERO};
    let mut b = Builder::new();
    let s = b.state("danger");
    let halt = b.accept("halt");
    b.add_rule(s, RuleSpec::new().on(REG, None, Some(ZERO), Move::R), halt);
    let m = b.finish(s);
    let bad = unsafe_rules(&m, REG);
    assert_eq!(bad.len(), 1, "a wildcard-read digit write must still be flagged: {bad:?}");
}

/// And a read of `Some(SEP)` itself — the direct, textbook clobber — must still be reported when
/// unshadowed, under EITHER encoding's digit alphabet. This is the case clause (b) must never swallow:
/// if it ever accepted `s == SEP` as "safe", the whole checker would be vacuous for the one read that
/// actually sits on the delimiter.
#[test]
fn the_checker_still_flags_a_direct_sep_read_write() {
    use redextape_core::tm::{Builder, Move, RuleSpec, ZERO};
    let mut b = Builder::new();
    let s = b.state("clobber");
    let halt = b.accept("halt");
    b.add_rule(s, RuleSpec::new().on(REG, Some(SEP), Some(ZERO), Move::R), halt);
    let bad = unsafe_rules(&b.finish(s), REG);
    assert_eq!(bad.len(), 1, "a rule that reads `#` and writes a digit must be flagged: {bad:?}");
}
