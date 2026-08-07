//! Gadget-level tests for the binary `Encoding`, mirroring `tm_encoding.rs`'s role for `Unary`.
//!
//! Each test builds a tiny machine that runs ONE gadget on a freshly laid-out bank, simulates it, and
//! reads the result back with `decode_nat`. Nothing here goes through `lower_tm` or `run_tm` — those
//! arrive in Phase 3 — so a failure here localizes to a single gadget.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use redextape_core::tm::{
    BLANK, BOX, Binary, Builder, Encoding, HEAP, MARK, REG, SEP, STACK, StateId, TAPES, TM_DEFAULT_CAPS, TmStatus,
    WORK, ZERO, simulate_final,
};

/// Build a one-gadget machine over a `slots`-field bank at `width`, run it, and report every tape's
/// final contents, the accept state `body` was handed (`halt`), the OVERFLOW guard state (forced into
/// existence — see below), the state the run actually ended in, and the raw halt/cap status.
///
/// `sim::simulate`'s `Status::Halted` is returned for two different outcomes with nothing in the value
/// to tell them apart: the machine reached accept, and the machine got STUCK with no matching rule.
/// `simulate_final` additionally reports the ending state — the same tool `tm.rs::attempt` uses to tell
/// a real halt from the overflow guard — which is what lets every helper below draw that line for
/// itself instead of trusting a bare `status == Halted`.
///
/// `b.overflow()` (not `overflow_state()`) is called AFTER `body` runs so the guard state is always
/// allocated, even for a gadget under test that never itself reaches it in a given run — mirroring
/// `tm.rs::attempt`'s `lower_tm_guarded`, which does the same for exactly this reason: a caller needs a
/// stable id to compare against regardless of whether this particular run takes that path.
fn run_gadget_raw(
    width: usize,
    slots: u32,
    body: impl FnOnce(&Binary, &mut Builder, StateId, StateId),
) -> (Vec<Vec<char>>, StateId, StateId, StateId, TmStatus) {
    let enc = Binary::at(width);
    let mut b = Builder::new();
    let start = b.state("start");
    let halt = b.accept("halt");
    body(&enc, &mut b, start, halt);
    let overflow = b.overflow();
    let m = b.finish(start);
    assert!(m.validate().is_empty(), "{:?}", m.validate());
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(slots);
    init[WORK] = enc.init_work();
    let (tapes, final_state, status, _) = simulate_final(&m, &init, TM_DEFAULT_CAPS);
    (tapes.iter().map(|t| t.snapshot().0).collect(), final_state, halt, overflow, status)
}

/// Turn `run_gadget_raw`'s status into a pass/fail verdict: `true` if the run reached the accept state,
/// `false` if it hit a cap (did not halt at all), and a PANIC — naming the state it stopped in — if it
/// halted anywhere else. That panic is the fix this harness exists for: without it, a gadget that gets
/// stuck partway through reads as a passing `Halted` run, and only fails downstream if some value
/// assertion happens to notice — which, for the class of bug this guards against, it may never do.
fn require_accepted(final_state: StateId, halt: StateId, status: TmStatus) -> bool {
    match status {
        TmStatus::HitCap => false,
        TmStatus::Halted if final_state == halt => true,
        TmStatus::Halted => panic!(
            "gadget got stuck: the machine halted in state {final_state}, not the accept state {halt} -- no rule \
             matched the tapes there. `sim::simulate`'s `Halted` cannot tell this apart from reaching accept, so \
             this harness checks `simulate_final`'s reported ending state instead."
        ),
    }
}

/// Build and run a one-gadget machine, returning the final REG tape. `None` only when the run hit a
/// cap without halting at all; a halt anywhere but the accept state PANICS (see `require_accepted`) —
/// it no longer reads as success. Tests that intentionally expect a NON-accept halt (the overflow
/// guard) use `run_gadget_expect_stuck`; tests that need a tape other than REG use `run_gadget_tapes`.
fn run_gadget(
    width: usize,
    slots: u32,
    body: impl FnOnce(&Binary, &mut Builder, StateId, StateId),
) -> Option<Vec<char>> {
    let (tapes, final_state, halt, _overflow, status) = run_gadget_raw(width, slots, body);
    require_accepted(final_state, halt, status).then(|| tapes[REG].clone())
}

/// Like `run_gadget`, but returns every tape (indexable by `REG`/`WORK`/`STACK`/`HEAP`/`BOX`) for tests
/// that need to inspect more than the register bank. Same accept-state contract as `run_gadget`.
fn run_gadget_tapes(
    width: usize,
    slots: u32,
    body: impl FnOnce(&Binary, &mut Builder, StateId, StateId),
) -> Option<Vec<Vec<char>>> {
    let (tapes, final_state, halt, _overflow, status) = run_gadget_raw(width, slots, body);
    require_accepted(final_state, halt, status).then_some(tapes)
}

/// The mirror image of `run_gadget`: for the one legitimate case where a NON-accept halt is the
/// expected outcome (routing to the rule-less overflow guard), require the run to halt WITHOUT
/// reaching accept, and return the REG tape. Panics if the run instead reaches accept (the guard didn't
/// fire) or hits a cap (neither is a halt at all).
fn run_gadget_expect_stuck(
    width: usize,
    slots: u32,
    body: impl FnOnce(&Binary, &mut Builder, StateId, StateId),
) -> Vec<char> {
    let (tapes, final_state, halt, _overflow, status) = run_gadget_raw(width, slots, body);
    match status {
        TmStatus::HitCap => {
            panic!("expected the run to get stuck (e.g. the overflow guard), but it hit a cap instead")
        }
        TmStatus::Halted if final_state == halt => {
            panic!("expected the run to get stuck (e.g. the overflow guard), but it reached the accept state {halt}")
        }
        TmStatus::Halted => tapes[REG].clone(),
    }
}

/// A third outcome `run_gadget`'s pass/fail split cannot express: a gadget (like `arith`'s Add/Sub) that
/// may legitimately end EITHER at accept OR at the shared overflow guard, depending on the operands —
/// both are success, and only some third state would be a real bug. `None` on a cap; `Ok(reg)` on
/// accept; `Err(reg)` on halting AT THE KNOWN OVERFLOW STATE specifically (`final_state == overflow`,
/// not merely "any non-accept halt" — that distinction is the whole point, since the latter would
/// silently swallow a gadget stuck for an unrelated reason). Still PANICS on a halt anywhere else, so
/// this keeps `require_accepted`'s guarantee for the one case it doesn't itself classify.
fn run_gadget_or_overflow(
    width: usize,
    slots: u32,
    body: impl FnOnce(&Binary, &mut Builder, StateId, StateId),
) -> Option<Result<Vec<char>, Vec<char>>> {
    let (tapes, final_state, halt, overflow, status) = run_gadget_raw(width, slots, body);
    match status {
        TmStatus::HitCap => None,
        TmStatus::Halted if final_state == halt => Some(Ok(tapes[REG].clone())),
        TmStatus::Halted if final_state == overflow => Some(Err(tapes[REG].clone())),
        TmStatus::Halted => panic!(
            "gadget got stuck: the machine halted in state {final_state}, which is neither the accept state \
             {halt} nor the overflow guard {overflow}"
        ),
    }
}

/// A `w`-cell field is `w` digits LSB-FIRST, with no padding: value 5 at width 4 is `1010`, not
/// `0101` and not `101_`. The digit ORDER is the one thing every later gadget depends on, so it is
/// asserted against the literal tape rather than only round-tripped through `decode_nat`.
#[test]
fn a_literal_is_written_lsb_first_with_no_padding() {
    let cells = run_gadget(4, 1, |enc, b, start, halt| enc.write_literal(b, start, halt, 5, 0)).unwrap();
    assert_eq!(cells, vec![SEP, MARK, ZERO, MARK, ZERO, SEP], "5 at width 4 is 1010 LSB-first");
}

/// `decode_nat` is the inverse of `write_literal` over the whole representable range, and a `w`-cell
/// field holds `2^w` values — not `w` of them. Width 4 reaching 15 is the capability the whole slice
/// exists for: unary's 4-cell field stops at 3.
#[test]
fn write_then_decode_roundtrips_the_full_range() {
    let enc = Binary::at(4);
    for n in 0..16u64 {
        let cells = run_gadget(4, 1, |e, b, start, halt| e.write_literal(b, start, halt, n, 0)).unwrap();
        assert_eq!(enc.decode_nat(&cells, 0), Some(n), "n = {n}");
    }
}

/// A literal that does not fit is a COMPILE-TIME fact, so it emits a bare route to the shared guard
/// and no write chain at all — mirroring `Unary`'s static-guard arm. The machine halts in the
/// rule-less guard state (never reaching `halt`), so the bank is left pristine. This is the one
/// gadget test that WANTS a non-accept halt, hence `run_gadget_expect_stuck` rather than `run_gadget`.
#[test]
fn an_oversized_literal_routes_to_the_guard() {
    let cells = run_gadget_expect_stuck(4, 1, |enc, b, start, halt| enc.write_literal(b, start, halt, 16, 0));
    assert_eq!(cells, vec![SEP, ZERO, ZERO, ZERO, ZERO, SEP], "the guard must not have written anything");
}

/// `write_literal` must leave the head at home and the bank's OTHER fields untouched — the home
/// convention every gadget composes on.
#[test]
fn write_literal_leaves_neighbouring_fields_alone() {
    let cells = run_gadget(4, 3, |enc, b, start, halt| enc.write_literal(b, start, halt, 15, 1)).unwrap();
    let enc = Binary::at(4);
    assert_eq!(enc.decode_nat(&cells, 0), Some(0));
    assert_eq!(enc.decode_nat(&cells, 1), Some(15));
    assert_eq!(enc.decode_nat(&cells, 2), Some(0));
}

/// `jz` branches on the WHOLE field being zero, not on its first digit. Value 2 at width 4 is `0100`
/// — a leading ZERO — so a `jz` that only looked at the first cell (the way the unary one legitimately
/// can) would call it zero. That is the defect this test exists to catch.
#[test]
fn jz_branches_on_the_whole_field_not_the_first_digit() {
    for (v, expect_zero) in [(0u64, true), (1, false), (2, false), (8, false), (15, false)] {
        let cells = run_gadget(4, 2, |enc, b, start, halt| {
            let after = b.state("after");
            enc.write_literal(b, start, after, v, 0);
            let zero = b.state("zero");
            let nonzero = b.state("nonzero");
            enc.jz(b, after, zero, nonzero, 0);
            // Record which branch was taken in field 1: 1 = zero-branch, 2 = nonzero-branch.
            enc.write_literal(b, zero, halt, 1, 1);
            enc.write_literal(b, nonzero, halt, 2, 1);
        })
        .unwrap();
        let enc = Binary::at(4);
        let expected = if expect_zero { 1 } else { 2 };
        assert_eq!(enc.decode_nat(&cells, 1), Some(expected), "v = {v}");
    }
}

/// `mov` copies a field's value, digit for digit, bouncing through WORK because a tape has one head.
#[test]
fn mov_copies_a_field() {
    let enc = Binary::at(4);
    for v in [0u64, 1, 5, 15] {
        let cells = run_gadget(4, 2, |e, b, start, halt| {
            let after = b.state("after");
            e.write_literal(b, start, after, v, 0);
            e.mov(b, after, halt, 0, 1);
        })
        .unwrap();
        assert_eq!(enc.decode_nat(&cells, 0), Some(v), "source must be preserved");
        assert_eq!(enc.decode_nat(&cells, 1), Some(v), "v = {v}");
    }
}

/// `mov` into itself must be the identity, not a clobber — the value round-trips REG -> WORK -> REG.
#[test]
fn mov_into_self_is_identity() {
    let cells = run_gadget(4, 1, |e, b, start, halt| {
        let after = b.state("after");
        e.write_literal(b, start, after, 9, 0);
        e.mov(b, after, halt, 0, 0);
    })
    .unwrap();
    assert_eq!(Binary::at(4).decode_nat(&cells, 0), Some(9));
}

/// The bounce leaves WORK holding the value, and that is fine — but it must leave WORK's SKELETON
/// intact, because every subsequent gadget navigates it by counting `#`s. A copy that walked one cell
/// too far would eat the delimiter and desynchronize every later seek.
///
/// Routed through `run_gadget_tapes` (not a hand-rolled `simulate` call) specifically so this test
/// inherits the accept-state check: a copy that walks too far gets the machine STUCK one transition
/// before it would ever corrupt the delimiter (the phantom extra digit read has no matching rule), so
/// WORK's skeleton assertions below are structurally incapable of catching that bug class on their
/// own — only the ended-in-accept check is.
#[test]
fn mov_leaves_the_work_bank_skeleton_intact() {
    let enc = Binary::at(4);
    let tapes = run_gadget_tapes(4, 1, |e, b, start, halt| {
        let after = b.state("after");
        e.write_literal(b, start, after, 11, 0);
        e.mov(b, after, halt, 0, 0);
    })
    .expect("must reach the accept state");
    let work = &tapes[WORK];
    assert_eq!(work.len(), 6, "work bank is `#` + 4 digits + `#`");
    assert_eq!(work[0], SEP);
    assert_eq!(work[5], SEP);
    assert_eq!(enc.decode_nat(work, 0), Some(11), "the bounce left the value in W_ACC");
}

/// Run `op(a, bv)` at `width` into field 2, returning `None` if the run hit a cap. `Some(n)` covers TWO
/// distinct outcomes with the same observable value: the gadget computed `n` normally, or it routed to
/// the shared overflow guard, which leaves field 2 (a fresh `rd`, never written on that path) at its
/// `init_reg` value of 0.
///
/// `run_gadget_or_overflow` tells those two halts apart by the ACTUAL overflow state id, not a guessed
/// property of the tape — under the harness `run_gadget` uses (see its doc), a gadget-under-test
/// halting anywhere OTHER than accept or overflow still panics, so this helper cannot mistake a
/// genuinely stuck machine for "hit the guard".
fn arith(width: usize, op: redextape_core::core::BinOp, a: u64, bv: u64) -> Option<u64> {
    let enc = Binary::at(width);
    let cells = match run_gadget_or_overflow(width, 3, |e, b, start, halt| {
        let s1 = b.state("s1");
        let s2 = b.state("s2");
        e.write_literal(b, start, s1, a, 0);
        e.write_literal(b, s1, s2, bv, 1);
        e.arith(b, s2, halt, op, 0, 1, 2);
    })? {
        Ok(cells) | Err(cells) => cells,
    };
    enc.decode_nat(&cells, 2).filter(|_| cells.len() == 1 + 3 * (width + 1))
}

/// Addition across the full representable range at a small width, so every carry chain is covered by
/// construction rather than by a chosen example: `3 + 1` propagates a carry through two digits into an
/// all-zero high half, `15 + 0` takes the no-carry path, `15 + 1` carries out of the top into the guard.
///
/// (An earlier version of this comment cited `7 + 8` as the carry case. It is not one — 7 is `1110`
/// and 8 is `0001` LSB-first, so their set bits never coincide and the sum produces NO carry at any
/// digit. The sweep was always right; only the example was wrong.)
#[test]
fn add_is_exact_over_the_representable_range() {
    use redextape_core::core::BinOp::Add;
    for a in 0..16u64 {
        for bv in 0..16u64 {
            let got = arith(4, Add, a, bv);
            if a + bv < 16 {
                assert_eq!(got, Some(a + bv), "{a} + {bv}");
            } else {
                assert_eq!(got, Some(0), "{a} + {bv} must hit the guard, leaving field 2 untouched");
            }
        }
    }
}

/// Subtraction is MONUS: truncated at zero, matching `interp.rs`'s `saturating_sub`. A borrow out of
/// the top digit must zero the whole field, not wrap to 2^w - 1 — the defect a ripple that simply
/// dropped the final borrow would have.
#[test]
fn sub_is_monus_not_wrapping() {
    use redextape_core::core::BinOp::Sub;
    for a in 0..16u64 {
        for bv in 0..16u64 {
            assert_eq!(arith(4, Sub, a, bv), Some(a.saturating_sub(bv)), "{a} - {bv}");
        }
    }
}

/// The capability the slice exists for, stated as a test: a 4-cell BINARY field computes 9 + 6 = 15,
/// which a 4-cell unary field cannot represent at all (its strict bound stops at 3).
#[test]
fn a_four_cell_binary_field_beats_a_four_cell_unary_field() {
    use redextape_core::core::BinOp::Add;
    assert_eq!(arith(4, Add, 9, 6), Some(15));
}

/// Multiplication is exact over every representable product, and hits the guard on every one that is
/// not. 256 pairs at width 4 — of which 180 overflow (76 representable), so the guard path is the
/// common case here and gets more coverage than the value path.
///
/// (An earlier version of this comment cited 137 overflow. By direct enumeration the real split is
/// 180 overflow / 76 representable; only the number was wrong, the test's own `a * bv < 16` check was
/// never affected.)
#[test]
fn mul_is_exact_and_guards_what_does_not_fit() {
    use redextape_core::core::BinOp::Mul;
    for a in 0..16u64 {
        for bv in 0..16u64 {
            let got = arith(4, Mul, a, bv);
            if a * bv < 16 {
                assert_eq!(got, Some(a * bv), "{a} * {bv}");
            } else {
                assert_eq!(got, Some(0), "{a} * {bv} must hit the guard, leaving field 2 untouched");
            }
        }
    }
}

/// x * 0 and 0 * x are zero for every x — the shift-and-add loop must run its full w iterations and
/// add nothing, rather than short-circuiting into a half-built accumulator.
#[test]
fn mul_by_zero_is_zero_both_ways() {
    use redextape_core::core::BinOp::Mul;
    for x in 0..16u64 {
        assert_eq!(arith(4, Mul, x, 0), Some(0), "{x} * 0");
        assert_eq!(arith(4, Mul, 0, x), Some(0), "0 * {x}");
    }
}

/// A wider bank reaches products no unary field can hold: 200 * 200 = 40,000 needs 16 digits.
/// `100 * 100` is the program the whole slice is measured by, and this is its gadget-level form.
#[test]
fn a_wide_binary_field_computes_products_unary_cannot_represent() {
    use redextape_core::core::BinOp::Mul;
    assert_eq!(arith(16, Mul, 100, 100), Some(10_000));
    assert_eq!(arith(16, Mul, 200, 200), Some(40_000));
}

/// Every comparison over every operand pair at width 4 — 256 pairs x 6 ops. A trichotomy sweep
/// rather than a few spot checks, because the six ops are derived from two primitives and a sign
/// error in either would leave four of the six accidentally right.
#[test]
fn comparisons_are_exact_over_every_pair() {
    use redextape_core::core::BinOp::{Eq, Ge, Gt, Le, Lt, Ne};
    let enc = Binary::at(4);
    for a in 0..16u64 {
        for bv in 0..16u64 {
            for (op, want) in [(Le, a <= bv), (Lt, a < bv), (Ge, a >= bv), (Gt, a > bv), (Eq, a == bv), (Ne, a != bv)] {
                let cells = run_gadget(4, 3, |e, b, start, halt| {
                    let s1 = b.state("s1");
                    let s2 = b.state("s2");
                    e.write_literal(b, start, s1, a, 0);
                    e.write_literal(b, s1, s2, bv, 1);
                    e.compare(b, s2, halt, op, 0, 1, 2);
                })
                .expect("compare must not halt in the guard");
                assert_eq!(enc.decode_nat(&cells, 2), Some(u64::from(want)), "{a} {op:?} {bv}");
            }
        }
    }
}

/// A comparison's result is a BOOLEAN — exactly 0 or 1 — so its field must be all-zero but for at
/// most digit 0. A gadget that left a stale high digit would decode as a large number that
/// `decode_word` then rejects as a Bool, turning a comparison bug into a confusing decode failure.
///
/// `rd` is DELIBERATELY pre-loaded with 15 (`1111`) before the comparison runs. Without that, the
/// destination would be the freshly-zeroed initial bank, and the test could not tell "the write
/// cleared a dirty field" from "the field was already clean" — it would only re-confirm the cell-offset
/// arithmetic. Pre-dirtying every digit is what makes the assertion a regression guard rather than a
/// layout check.
#[test]
fn a_comparison_writes_a_clean_boolean_field() {
    use redextape_core::core::BinOp::Lt;
    let cells = run_gadget(4, 3, |e, b, start, halt| {
        let s1 = b.state("s1");
        let s2 = b.state("s2");
        let s3 = b.state("s3");
        e.write_literal(b, start, s1, 15, 0);
        e.write_literal(b, s1, s2, 3, 1);
        e.write_literal(b, s2, s3, 15, 2); // dirty every digit of the destination
        e.compare(b, s3, halt, Lt, 0, 1, 2);
    })
    .unwrap();
    // Field 2 occupies cells 11..15 (bank = `#` + 3 * (4 + 1)).
    assert_eq!(&cells[11..15], &[ZERO, ZERO, ZERO, ZERO], "15 < 3 is false, so every digit is 0");
}

/// A pushed frame is a `width`-digit field plus a `#`, so `push_frame` with a tag and two locals
/// lays down exactly 3 * (width + 1) cells — the tag at the bottom, then the locals in slot order.
/// The STACK starts completely empty (no leading `#`, unlike REG/WORK), so the frame occupies cells
/// `0..15` directly.
#[test]
fn push_frame_lays_tag_then_locals_in_slot_order() {
    let tapes = run_gadget_tapes(4, 3, |e, b, start, halt| {
        let s1 = b.state("s1");
        let s2 = b.state("s2");
        e.write_literal(b, start, s1, 3, 1);
        e.write_literal(b, s1, s2, 5, 2);
        e.push_frame(b, s2, halt, 2, 3);
    })
    .unwrap();
    let cells = &tapes[STACK];
    let field = |i: usize| -> Vec<char> { cells[i * 5..i * 5 + 4].to_vec() };
    assert_eq!(field(0), vec![MARK, MARK, ZERO, ZERO], "tag 3 at the frame bottom");
    assert_eq!(field(1), vec![MARK, MARK, ZERO, ZERO], "Loc0 = 3");
    assert_eq!(field(2), vec![MARK, ZERO, MARK, ZERO], "Loc1 = 5");
    assert_eq!(cells[4], SEP);
    assert_eq!(cells[14], SEP);
}

/// Push then pop is LIFO and lossless, and the pop must ERASE what it read — a residual frame is
/// what `stack_is_empty` catches at the oracle level, and catching it here localizes the defect.
///
/// The locals are 3 (`1100`) and 5 (`1010`), and the choice is load-bearing: a digit-order reversal in
/// `stack_pop_acc` is INVISIBLE for a palindromic value, and at width 4 there are exactly four of them
/// — 0 (`0000`), 6 (`0110`), 9 (`1001`), 15 (`1111`). Reversed, 3 becomes 12 and 5 becomes 10, so
/// either local alone exposes the defect.
///
/// This test originally used 6 and 9, on the stated grounds that 6 was non-palindromic. It is not —
/// both were palindromes, so the test named for the pop's correctness PASSED under a real reversal
/// sabotage, which only `dispatch_tag_routes_on_the_tag_value` caught, incidentally. Measured, not
/// argued: the sabotage was applied and this test stayed green.
///
/// The push-side test shares these literals. That is worth having, but note the asymmetry: `push` has
/// no analogous reversal risk, because both its walks start at the same index and advance in the same
/// direction, where `pop` deliberately parks two heads at opposite ends. Non-palindromic values there
/// guard a hypothetical, not a structural, failure mode.
#[test]
fn push_then_pop_restores_locals_and_empties_the_stack() {
    let enc = Binary::at(4);
    let tapes = run_gadget_tapes(4, 3, |e, b, start, halt| {
        let s1 = b.state("s1");
        let s2 = b.state("s2");
        let s3 = b.state("s3");
        let s3b = b.state("s3b");
        let s4 = b.state("s4");
        e.write_literal(b, start, s1, 3, 1);
        e.write_literal(b, s1, s2, 5, 2);
        e.push_frame(b, s2, s3, 2, 3);
        // Clobber both locals, then restore them from the frame.
        e.write_literal(b, s3, s3b, 0, 1);
        e.write_literal(b, s3b, s4, 0, 2);
        e.pop_frame_restore(b, s4, halt, 2);
    })
    .unwrap();
    assert_eq!(enc.decode_nat(&tapes[REG], 1), Some(3), "Loc0 restored");
    assert_eq!(enc.decode_nat(&tapes[REG], 2), Some(5), "Loc1 restored");
    let stack = &tapes[STACK];
    // `pop_frame_restore` leaves the TAG on top; only the two local fields (cells 5..) are gone.
    assert_eq!(&stack[5..], &vec![BLANK; stack.len() - 5][..], "locals erased");
}

/// `dispatch_tag` fans out on the tag's VALUE, and the value is a binary number: tag 5 must reach
/// exit 5, not exit 1 (its low digit) and not exit 2 (its digit count).
#[test]
fn dispatch_tag_routes_on_the_tag_value() {
    let enc = Binary::at(4);
    for tag in 0..6u64 {
        let tapes = run_gadget_tapes(4, 1, |e, b, start, halt| {
            let pushed = b.state("pushed");
            e.push_frame(b, start, pushed, 0, tag);
            // Six exits, each writing its own index into slot 0.
            let exits: Vec<_> = (0..6).map(|i| b.state(format!("e{i}"))).collect();
            e.dispatch_tag(b, pushed, &exits);
            for (i, &ex) in exits.iter().enumerate() {
                e.write_literal(b, ex, halt, i as u64, 0);
            }
        })
        .unwrap();
        assert_eq!(enc.decode_nat(&tapes[REG], 0), Some(tag), "tag {tag} took the wrong exit");
        assert_eq!(tapes[STACK].iter().find(|&&c| c != BLANK), None, "tag erased");
    }
}

// ---- HEAP gadgets: `cons`, `is_empty_op`, `head_op`, `tail_op`, `parse_heap_cells` ----

/// A binary cons cell is FIXED width: `@` + w digits + `#` + w digits. Two cells therefore occupy
/// exactly 2 * (2w + 2) cells, and the pointers handed back are 1 and 2 in allocation order.
#[test]
fn cons_builds_fixed_width_cells_with_sequential_pointers() {
    let enc = Binary::at(4);
    let tapes = run_gadget_tapes(4, 4, |e, b, start, halt| {
        let s1 = b.state("s1");
        let s2 = b.state("s2");
        let s3 = b.state("s3");
        e.write_literal(b, start, s1, 7, 0); // head value
        e.write_literal(b, s1, s2, 0, 1); // nil tail
        e.cons(b, s2, s3, 0, 1, 2); // p1 = cons(7, nil) -> slot 2
        e.cons(b, s3, halt, 0, 2, 3); // p2 = cons(7, p1) -> slot 3
    })
    .unwrap();
    assert_eq!(enc.decode_nat(&tapes[REG], 2), Some(1), "first cons gets pointer 1");
    assert_eq!(enc.decode_nat(&tapes[REG], 3), Some(2), "second cons gets pointer 2");
    assert_eq!(enc.parse_heap_cells(&tapes[HEAP]), vec![(7, 0), (7, 1)]);
}

/// `head_op`/`tail_op` dereference a RUNTIME pointer -- the cell index is a value, not a constant.
#[test]
fn head_and_tail_dereference_a_runtime_pointer() {
    let enc = Binary::at(4);
    for (read_tail, want) in [(false, 7u64), (true, 1u64)] {
        let tapes = run_gadget_tapes(4, 4, |e, b, start, halt| {
            let s1 = b.state("s1");
            let s2 = b.state("s2");
            let s3 = b.state("s3");
            let s4 = b.state("s4");
            e.write_literal(b, start, s1, 7, 0);
            e.write_literal(b, s1, s2, 0, 1);
            e.cons(b, s2, s3, 0, 1, 2); // p1 = cons(7, nil)
            e.cons(b, s3, s4, 0, 2, 3); // p2 = cons(7, p1)
            if read_tail {
                e.tail_op(b, s4, halt, 3, 1);
            } else {
                e.head_op(b, s4, halt, 3, 1);
            }
        })
        .unwrap_or_else(|| panic!("read_tail = {read_tail}: expected to reach accept, hit a cap instead"));
        assert_eq!(enc.decode_nat(&tapes[REG], 1), Some(want), "read_tail = {read_tail}");
    }
}

/// A nil dereference SPINS to a cap, matching lambda's Omega and the reference's Runtime error. `None`
/// here means `HitCap` -- the run never halts at all -- which IS the intended fault outcome, not a
/// failure to reach accept. It must NOT reach the overflow guard: overflow means 'retry at a wider
/// bank', and a nil deref routed there would burn a full step budget at every width on the way to
/// reporting the same thing (sabotage-verified -- see the task report).
#[test]
fn a_nil_dereference_spins_to_a_cap() {
    let result = run_gadget(4, 2, |e, b, start, halt| {
        let s1 = b.state("s1");
        e.write_literal(b, start, s1, 0, 0); // nil
        e.head_op(b, s1, halt, 0, 1);
    });
    assert_eq!(result, None, "a nil deref must spin to a cap (HitCap), not halt anywhere");
}

/// `is_empty_op` is a pointer test, and it must inspect the WHOLE pointer field: pointer 2 is `0100`
/// at width 4, whose first digit is zero.
#[test]
fn is_empty_op_tests_the_whole_pointer() {
    let enc = Binary::at(4);
    for (p, want) in [(0u64, 1u64), (1, 0), (2, 0), (8, 0)] {
        let cells = run_gadget(4, 2, |e, b, start, halt| {
            let s1 = b.state("s1");
            e.write_literal(b, start, s1, p, 0);
            e.is_empty_op(b, s1, halt, 0, 1);
        })
        .unwrap();
        assert_eq!(enc.decode_nat(&cells, 1), Some(want), "p = {p}");
    }
}

/// `tail(p2)` reads a MIDDLE cell's non-empty tail, so the deref must land on the NEXT cell's `@` (not
/// yet the true top) and still restore correctly from there -- exercising `deref_op`'s "cross the `#` +
/// tail digits, then keep skipping" restore path, which `head_and_tail_dereference_a_runtime_pointer`
/// (whose target is always the LAST cell) does not reach. Ported from
/// `Unary::tail_of_a_non_last_cell_with_a_nonempty_tail`.
#[test]
fn tail_of_a_non_last_cell_with_a_nonempty_tail() {
    let enc = Binary::at(4);
    // Heap [(7,0),(3,1),(9,0)] via cons: cons(7,nil)->p1; cons(3,p1)->p2; cons(9,nil)->p3.
    // slots: 0=7, 1=0(nil), 2=p1, 3=3, 4=p2, 5=9, 6=p3, 7=result.
    let tapes = run_gadget_tapes(4, 8, |e, b, start, halt| {
        let s1 = b.state("s1");
        let s2 = b.state("s2");
        let s3 = b.state("s3");
        let s4 = b.state("s4");
        let s5 = b.state("s5");
        let s6 = b.state("s6");
        let s7 = b.state("s7");
        e.write_literal(b, start, s1, 7, 0);
        e.write_literal(b, s1, s2, 0, 1);
        e.cons(b, s2, s3, 0, 1, 2); // p1 = (7, 0)
        e.write_literal(b, s3, s4, 3, 3);
        e.cons(b, s4, s5, 3, 2, 4); // p2 = (3, p1=1)
        e.write_literal(b, s5, s6, 9, 5);
        e.cons(b, s6, s7, 5, 1, 6); // p3 = (9, 0)
        e.tail_op(b, s7, halt, 4, 7); // tail(p2) -> slot 7
    })
    .unwrap();
    assert_eq!(enc.decode_nat(&tapes[REG], 7), Some(1));
}

/// After a successful (non-fault) deref, the HEAP head must be back at the TRUE top -- not merely the
/// boundary right after the dereferenced cell -- so a SUBSEQUENT `cons` appends a correct new cell
/// rather than corrupting an existing one. Ported from `Unary::cons_after_a_deref_keeps_the_heap_top`.
#[test]
fn cons_after_a_deref_keeps_the_heap_top() {
    let enc = Binary::at(4);
    // [1, 2]: p_inner = (2, 0); p_outer = (1, p_inner); tail(p_outer) = p_inner; then cons(9, p_inner).
    // slots: 0=2, 1=0, 2=p_inner, 3=1, 4=p_outer, 5=tail-of-p_outer, 6=9, 7=p_new, 8=head-of-p_new.
    let tapes = run_gadget_tapes(4, 9, |e, b, start, halt| {
        let s1 = b.state("s1");
        let s2 = b.state("s2");
        let s3 = b.state("s3");
        let s4 = b.state("s4");
        let s5 = b.state("s5");
        let s6 = b.state("s6");
        let s7 = b.state("s7");
        let s8 = b.state("s8");
        e.write_literal(b, start, s1, 2, 0);
        e.write_literal(b, s1, s2, 0, 1);
        e.cons(b, s2, s3, 0, 1, 2); // p_inner = (2, 0)
        e.write_literal(b, s3, s4, 1, 3);
        e.cons(b, s4, s5, 3, 2, 4); // p_outer = (1, p_inner)
        e.tail_op(b, s5, s6, 4, 5); // slot 5 = tail(p_outer) = p_inner
        e.write_literal(b, s6, s7, 9, 6);
        e.cons(b, s7, s8, 6, 5, 7); // p_new = cons(9, p_inner)
        e.head_op(b, s8, halt, 7, 8); // slot 8 = head(p_new) = 9
    })
    .unwrap();
    assert_eq!(enc.decode_nat(&tapes[REG], 8), Some(9));
}

// ---- BOX gadgets: `box_op`, `box_get_op`, `box_set_op` ----

/// Allocation hands back sequential 1-based pointers and the fields are independent.
#[test]
fn boxes_get_sequential_pointers_and_stay_independent() {
    let enc = Binary::at(4);
    let tapes = run_gadget_tapes(4, 4, |e, b, start, halt| {
        let s1 = b.state("s1");
        let s2 = b.state("s2");
        let s3 = b.state("s3");
        let s4 = b.state("s4");
        let s5 = b.state("s5");
        e.write_literal(b, start, s1, 5, 0);
        e.box_op(b, s1, s2, 0, 1); // p1 = box(5)
        e.write_literal(b, s2, s3, 12, 0);
        e.box_op(b, s3, s4, 0, 2); // p2 = box(12)
        e.box_get_op(b, s4, s5, 1, 3); // slot 3 = *p1
        e.box_get_op(b, s5, halt, 2, 0); // slot 0 = *p2
    })
    .expect("expected to reach accept, hit a cap instead");
    assert_eq!(enc.decode_nat(&tapes[REG], 1), Some(1), "first box is pointer 1");
    assert_eq!(enc.decode_nat(&tapes[REG], 2), Some(2), "second box is pointer 2");
    assert_eq!(enc.decode_nat(&tapes[REG], 3), Some(5), "*p1");
    assert_eq!(enc.decode_nat(&tapes[REG], 0), Some(12), "*p2");
}

/// `box_set_op` overwrites IN PLACE — the `#` delimiters never move — and must handle both shrinking
/// and growing the digit count, including down to zero and back up.
///
/// ON THE `the field grew` ASSERTION, which is NOT sabotage-verified and should not be described as
/// though it were. Three successively harsher mutations of `box_overwrite_field_bin`'s write loop were
/// run, and NONE made it fire:
///
///   1. bound `0..=width` — the extra step's explicit BOX digit read cannot match the blank top;
///   2. that, plus a wildcard BOX read — the extra step's `Some(w)` WORK read cannot match `W_ACC`'s
///      trailing `#`;
///   3. that, plus a wildcard WORK read — the following `back` transition's `Some(SEP)` WORK read
///      cannot match, since the head is now past the `#`.
///
/// Every one died as a stuck halt, caught by `require_accepted`, one transition before any delimiter
/// could be touched. So a "walks too far" bug in this design CANNOT manifest as corruption — four
/// independent guards stand in front of it — and this assertion is unfalsifiable for that bug class.
///
/// It is kept anyway, as a cheap structural net for a FUTURE refactor that removes those guards (a
/// content-driven rewrite of the write loop would be exactly that). But the thing actually doing the
/// work here is the accept-state check, and saying otherwise would be the same overclaim this suite
/// has now found twelve times.
#[test]
fn box_set_overwrites_in_place_in_both_directions() {
    let enc = Binary::at(4);
    for (first, second) in [(15u64, 0u64), (0, 15), (12, 3), (1, 8)] {
        let tapes = run_gadget_tapes(4, 3, |e, b, start, halt| {
            let s1 = b.state("s1");
            let s2 = b.state("s2");
            let s3 = b.state("s3");
            let s4 = b.state("s4");
            e.write_literal(b, start, s1, first, 0);
            e.box_op(b, s1, s2, 0, 1);
            e.write_literal(b, s2, s3, second, 0);
            e.box_set_op(b, s3, s4, 1, 0);
            e.box_get_op(b, s4, halt, 1, 2);
        })
        .unwrap_or_else(|| panic!("{first} -> {second}: expected to reach accept, hit a cap instead"));
        assert_eq!(enc.decode_nat(&tapes[REG], 2), Some(second), "{first} -> {second}");
        // The tape must still be exactly one field: `#` + 4 digits, then blanks.
        let bx = &tapes[BOX];
        assert_eq!(bx[0], SEP, "{first} -> {second}: the leading `#` moved");
        assert!(bx[5..].iter().all(|&c| c == BLANK), "{first} -> {second}: the field grew");
    }
}

/// A nil box pointer spins to a cap, exactly as a nil HEAP deref does. `None` here means `HitCap` — the
/// run never halts at all — which IS the intended fault outcome, not a failure to reach accept. It must
/// NOT reach the overflow guard: overflow means "retry at a wider bank", and a nil deref routed there
/// would burn a full step budget at every width on the way to reporting the same thing (see
/// `a_nil_dereference_spins_to_a_cap`, and the task report, for the HEAP analogue of this same point).
#[test]
fn a_nil_box_get_spins_to_a_cap() {
    let result = run_gadget(4, 2, |e, b, start, halt| {
        let s1 = b.state("s1");
        e.write_literal(b, start, s1, 0, 0); // nil
        e.box_get_op(b, s1, halt, 0, 1);
    });
    assert_eq!(result, None, "a nil box_get must spin to a cap (HitCap), not halt anywhere");
}

// ================================================================================================
// STRUCTURAL DECODE
//
// `decode_nat` and `parse_heap_cells` read from one delimiter to the next and never consult
// `self.width`, so an instance at ANY width reads a tape laid out at any other. That is what makes
// `decode_tape` work without being told the width the machine was lowered at — the property `Unary`
// always had and `Binary` did not.
//
// The tests below therefore assert the SAME answer across a spread of widths on ONE fixed tape. A
// width-strict decoder passes only at the tape's own width, so any single-width assertion here would
// be unfalsifiable for the property being claimed.
// ================================================================================================

/// LSB-first digits: the leftmost cell is 2^0.
fn cells(s: &str) -> Vec<char> {
    s.chars().collect()
}

/// Every width tried against a fixed tape, including widths above and below the one it was written at.
const READER_WIDTHS: [usize; 5] = [1, 2, 3, 8, 64];

#[test]
fn decode_nat_reads_a_bank_laid_out_at_any_other_width() {
    // A REG bank written at width 3: field 0 = `101` = 5, field 1 = `010` = 2.
    let bank = cells("#101#010#");
    for w in READER_WIDTHS {
        let enc = Binary::at(w);
        assert_eq!(enc.decode_nat(&bank, 0), Some(5), "reader width {w}");
        assert_eq!(enc.decode_nat(&bank, 1), Some(2), "reader width {w}");
        assert_eq!(enc.decode_nat(&bank, 2), None, "reader width {w}: no field past the trailing `#`");
    }
}

/// Structural does NOT mean permissive. A field that is not a digit run closed by a `#` is still
/// rejected, at every reader width — the property that makes a decode of a clobbered bank fail loudly
/// instead of returning a plausible number.
#[test]
fn decode_nat_still_rejects_a_malformed_field() {
    for w in READER_WIDTHS {
        let enc = Binary::at(w);
        // A foreign symbol inside the field: the digit run stops early and the next cell is not `#`.
        assert_eq!(enc.decode_nat(&cells("#1@1#"), 0), None, "reader width {w}: foreign symbol");
        // Unterminated: digits run off the end of the tape with no closing `#`.
        assert_eq!(enc.decode_nat(&cells("#101"), 0), None, "reader width {w}: no closing `#`");
        // A blank inside the field. `BLANK` is unary padding, never binary field content.
        assert_eq!(enc.decode_nat(&cells("#1_1#"), 0), None, "reader width {w}: blank in field");
    }
}

/// A field wider than 64 digits is structurally legal but only representable when its high digits are
/// all zero, so the two cases must part company. Unreachable while `MAX_FIELD_WIDTH` is 64; this pins
/// that the decoder stays total rather than panicking on a shift overflow if that ever changes.
#[test]
fn decode_nat_rejects_a_set_bit_beyond_u64_but_tolerates_high_zeros() {
    let mut wide = vec![SEP];
    wide.extend(std::iter::repeat_n(ZERO, 63));
    wide.push(MARK); // bit 63 — the highest a `u64` holds
    wide.push(SEP);
    assert_eq!(Binary::at(64).decode_nat(&wide, 0), Some(1u64 << 63));

    let mut over = wide.clone();
    over.pop(); // drop the closing `#`
    over.push(ZERO); // bit 64 — clear, so still representable
    over.push(SEP);
    assert_eq!(Binary::at(64).decode_nat(&over, 0), Some(1u64 << 63), "a clear bit past 2^63 changes nothing");

    let mut set = over.clone();
    set[65] = MARK; // bit 64 SET — not a `u64`
    assert_eq!(Binary::at(64).decode_nat(&set, 0), None, "a set bit at 2^64 is not representable");
}

#[test]
fn parse_heap_cells_reads_a_heap_laid_out_at_any_other_width() {
    // Two cons cells written at width 2: `(head 2, tail 0)` then `(head 3, tail 1)`.
    let heap = cells("_@01#00@11#10_");
    for w in READER_WIDTHS {
        assert_eq!(Binary::at(w).parse_heap_cells(&heap), vec![(2, 0), (3, 1)], "reader width {w}");
    }
}

/// The heap parser is TOTAL on a malformed tape — it yields the cells parsed so far rather than
/// panicking or inventing one — and that must not change with structural word reads.
#[test]
fn parse_heap_cells_stops_at_the_first_malformed_cell() {
    for w in READER_WIDTHS {
        let enc = Binary::at(w);
        // Second cell has no `#` between head and tail.
        assert_eq!(enc.parse_heap_cells(&cells("_@01#00@0110_")), vec![(2, 0)], "reader width {w}");
        // Truncated mid-cell: the head word runs off the end with no separator.
        assert_eq!(enc.parse_heap_cells(&cells("_@01#00@01")), vec![(2, 0)], "reader width {w}");
        // Nothing at all.
        assert_eq!(enc.parse_heap_cells(&cells("____")), vec![], "reader width {w}");
    }
}
