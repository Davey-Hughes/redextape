//! Part 2b-1 substrate: the unary gadgets compose into a multi-step computation on a genuine simulated
//! multi-tape TM. Part 2b-2's `lower_tm` produces machines of exactly this shape from register-assembly.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use redextape_core::core::BinOp;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::machine::{BLANK, StateId, Symbol};
use std::sync::atomic::{AtomicUsize, Ordering};

use redextape_core::tm::{
    Builder, Encoding, MAX_FIELD_WIDTH, REG, SEP, Slot, TAPES, TM_DEFAULT_CAPS, TmRun, TmStatus, Unary, decode_tape,
    run_tm_fitted, simulate,
};
use redextape_core::value::Value;

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

/// An encoding reporting `field_width() == None` declares itself UNBOUNDED, and `run_tm_fitted` must
/// then make exactly ONE attempt with no width search and report `None` as the fitted width.
///
/// That branch has never been executed. Roadmap item 4 predicted the binary encoding would exercise
/// it for free; it does not, because Binary is bounded. This mock is what actually covers it —
/// delegating every gadget to `Unary::default()` so only the width REPORTING differs.
#[derive(Debug)]
struct Unbounded(Unary);

/// How many times ANY `Unbounded::at_width` has been called. `run_tm_fitted`'s search loop calls
/// `enc.at_width(w)` once per attempt; its unbounded early-return calls it never. Counting is what
/// turns "no search happened" from an inference about which branch must have run into an OBSERVATION
/// of the search's own mechanism — the distinction this branch has had to make fourteen times.
static AT_WIDTH_CALLS: AtomicUsize = AtomicUsize::new(0);

impl Encoding for Unbounded {
    fn write_literal(&self, b: &mut Builder, entry: StateId, exit: StateId, n: u64, rd: Slot) {
        self.0.write_literal(b, entry, exit, n, rd);
    }
    fn arith(&self, b: &mut Builder, entry: StateId, exit: StateId, op: BinOp, ra: Slot, rb: Slot, rd: Slot) {
        self.0.arith(b, entry, exit, op, ra, rb, rd);
    }
    fn compare(&self, b: &mut Builder, entry: StateId, exit: StateId, op: BinOp, ra: Slot, rb: Slot, rd: Slot) {
        self.0.compare(b, entry, exit, op, ra, rb, rd);
    }
    fn decode_nat(&self, reg_cells: &[Symbol], slot: Slot) -> Option<u64> {
        self.0.decode_nat(reg_cells, slot)
    }
    fn field_width(&self) -> Option<usize> {
        None
    }
    fn field_symbols(&self) -> &'static [Symbol] {
        self.0.field_symbols()
    }
    fn parse_heap_cells(&self, cells: &[Symbol]) -> Vec<(u64, u64)> {
        self.0.parse_heap_cells(cells)
    }
    fn heap_word_len(&self) -> Option<usize> {
        self.0.heap_word_len()
    }
    fn at_width(&self, _width: usize) -> Box<dyn Encoding> {
        AT_WIDTH_CALLS.fetch_add(1, Ordering::Relaxed);
        Box::new(Unbounded(self.0))
    }
    fn init_reg(&self, slots: u32) -> Vec<Symbol> {
        self.0.init_reg(slots)
    }
    fn init_work(&self) -> Vec<Symbol> {
        self.0.init_work()
    }
    fn mov(&self, b: &mut Builder, entry: StateId, exit: StateId, rs: Slot, rd: Slot) {
        self.0.mov(b, entry, exit, rs, rd);
    }
    fn jz(&self, b: &mut Builder, entry: StateId, if_zero: StateId, if_nonzero: StateId, r: Slot) {
        self.0.jz(b, entry, if_zero, if_nonzero, r);
    }
    fn push_frame(&self, b: &mut Builder, entry: StateId, exit: StateId, n_loc: u32, tag: u64) {
        self.0.push_frame(b, entry, exit, n_loc, tag);
    }
    fn pop_frame_restore(&self, b: &mut Builder, entry: StateId, exit: StateId, n_loc: u32) {
        self.0.pop_frame_restore(b, entry, exit, n_loc);
    }
    fn dispatch_tag(&self, b: &mut Builder, entry: StateId, exits: &[StateId]) {
        self.0.dispatch_tag(b, entry, exits);
    }
    fn cons(&self, b: &mut Builder, entry: StateId, exit: StateId, rh: Slot, rt: Slot, rd: Slot) {
        self.0.cons(b, entry, exit, rh, rt, rd);
    }
    fn is_empty_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot) {
        self.0.is_empty_op(b, entry, exit, rl, rd);
    }
    fn head_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot) {
        self.0.head_op(b, entry, exit, rl, rd);
    }
    fn tail_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot) {
        self.0.tail_op(b, entry, exit, rl, rd);
    }
    fn box_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rv: Slot, rd: Slot) {
        self.0.box_op(b, entry, exit, rv, rd);
    }
    fn box_get_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rb: Slot, rd: Slot) {
        self.0.box_get_op(b, entry, exit, rb, rd);
    }
    fn box_set_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rb: Slot, rv: Slot) {
        self.0.box_set_op(b, entry, exit, rb, rv);
    }
}

#[test]
fn an_unbounded_encoding_makes_exactly_one_attempt() {
    let (prog, ds) = parse("1 + 2 * 3");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let (run, width) = run_tm_fitted(&core, &Unbounded(Unary::default()), TM_DEFAULT_CAPS);
    assert_eq!(width, None, "an unbounded encoding reports no fitted width");
    let TmRun::Ran { tapes } = run else { panic!("expected a value: {run:?}") };
    assert_eq!(decode_tape(&tapes, &Value::Nat(0), &Unary::default()), Some(Value::Nat(7)));
}

/// The unbounded branch must NOT retry. A program that overflows the delegate's 64-cell field comes
/// back as `Overflow` from the single attempt, rather than looping — which is the specific behaviour
/// the `is_none()` early return exists to produce.
#[test]
fn an_unbounded_encoding_does_not_search_on_overflow() {
    let (prog, ds) = parse("100 * 100");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let before = AT_WIDTH_CALLS.load(Ordering::Relaxed);
    let (run, width) = run_tm_fitted(&core, &Unbounded(Unary::default()), TM_DEFAULT_CAPS);
    // Asserted FIRST, deliberately. This is the DIRECT evidence that no search ran — it observes the
    // search's own mechanism, where `width == None` below only says which branch was taken, from which
    // "one attempt" follows by code structure rather than by observation. Ordering matters because the
    // width assertion would otherwise fire first and this one would never be reached, leaving it
    // unproven: checked by making the mock report bounded, which fires THIS assertion with 5 calls
    // (widths 4, 8, 16, 32, 64) rather than the width one.
    assert_eq!(
        AT_WIDTH_CALLS.load(Ordering::Relaxed) - before,
        0,
        "run_tm_fitted called at_width, so it searched rather than making a single attempt"
    );
    assert!(matches!(run, TmRun::Overflow), "one attempt, then report: {run:?}");
    assert_eq!(width, None, "an unbounded encoding reports no fitted width");
}
