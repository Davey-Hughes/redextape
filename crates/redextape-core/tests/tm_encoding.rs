//! Part 2b-1 substrate: the unary gadgets compose into a multi-step computation on a genuine simulated
//! multi-tape TM. Part 2b-2's `lower_tm` produces machines of exactly this shape from register-assembly.

use redextape_core::core::BinOp;
use redextape_core::tm::machine::{BLANK, Symbol};
use redextape_core::tm::{
    Builder, Encoding, MAX_FIELD_WIDTH, REG, SEP, TAPES, TM_DEFAULT_CAPS, TmStatus, Unary, simulate,
};

/// An all-zero fixed-width register bank of `fields` fields: `#` then `MAX_FIELD_WIDTH` blanks + `#`, repeated.
fn zero_bank(fields: usize) -> Vec<Symbol> {
    let mut bank = vec![SEP];
    for _ in 0..fields {
        bank.extend(std::iter::repeat_n(BLANK, MAX_FIELD_WIDTH));
        bank.push(SEP);
    }
    bank
}

#[test]
fn gadgets_compose_into_a_multi_step_computation() {
    // (3 + 2) * 2 == 10, in a 4-field bank: s0=3, s1=2, s2=(s0+s1), s3=(s2*s1).
    let enc = Unary::default();
    let mut b = Builder::new();
    let halt = b.accept("halt");
    // build back-to-front: mul(s2,s1)->s3 ; add(s0,s1)->s2 ; lit s1=2 ; lit s0=3
    let mul = b.state("mul");
    enc.arith(&mut b, mul, halt, BinOp::Mul, 2, 1, 3);
    let add = b.state("add");
    enc.arith(&mut b, add, mul, BinOp::Add, 0, 1, 2);
    let l1 = b.state("l1");
    enc.write_literal(&mut b, l1, add, 2, 1);
    let l0 = b.state("l0");
    enc.write_literal(&mut b, l0, l1, 3, 0);
    let m = b.finish(l0);
    assert!(m.validate().is_empty(), "{:?}", m.validate());

    let mut init = vec![Vec::<Symbol>::new(); TAPES];
    init[REG] = zero_bank(4);
    let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
    assert_eq!(status, TmStatus::Halted);
    assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 3), Some(10));
}

#[test]
fn gadgets_compose_with_a_trailing_comparison() {
    // (3 + 2) * 2 == 10, then compare s3 == 10 (a literal in s4) -> s5 holds the boolean `1`.
    let enc = Unary::default();
    let mut b = Builder::new();
    let halt = b.accept("halt");
    // build back-to-front: eq(s3,s4)->s5 ; lit s4=10 ; mul(s2,s1)->s3 ; add(s0,s1)->s2 ; lit s1=2 ; lit s0=3
    let eq = b.state("eq");
    enc.compare(&mut b, eq, halt, BinOp::Eq, 3, 4, 5);
    let l4 = b.state("l4");
    enc.write_literal(&mut b, l4, eq, 10, 4);
    let mul = b.state("mul");
    enc.arith(&mut b, mul, l4, BinOp::Mul, 2, 1, 3);
    let add = b.state("add");
    enc.arith(&mut b, add, mul, BinOp::Add, 0, 1, 2);
    let l1 = b.state("l1");
    enc.write_literal(&mut b, l1, add, 2, 1);
    let l0 = b.state("l0");
    enc.write_literal(&mut b, l0, l1, 3, 0);
    let m = b.finish(l0);
    assert!(m.validate().is_empty(), "{:?}", m.validate());

    let mut init = vec![Vec::<Symbol>::new(); TAPES];
    init[REG] = zero_bank(6);
    let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
    assert_eq!(status, TmStatus::Halted);
    let cells = &tapes[REG].snapshot().0;
    assert_eq!(enc.decode_nat(cells, 3), Some(10));
    assert_eq!(enc.decode_nat(cells, 5), Some(1)); // 10 == 10 -> true
}
