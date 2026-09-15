//! The universal-machine leg: a machine run directly and the same machine run as a guest of
//! `universal.rs`'s `universal_machine` must end in the same place — the same accept or stuck halt, then every
//! guest tape equal at its origin, then, for a compiled program, the reference interpreter's value decoded
//! from the tapes the UTM left.
//!
//! **THE CORPUS NEVER VARIES THE TAPE COUNT**: every lowered machine has five tapes. Hand-built guests of one,
//! two and three tapes, and a proptest over small generated machines, are what show the UTM reads the tape
//! count from its input.
//!
//! **TIERS FOLLOW THE DEV PROFILE**, which runs the UTM over 20 times slower than a release build. The fast tier
//! holds the compiled programs under about a second there, under the default caps; the rest are `#[ignore]`d,
//! run under `UTM_CAPS`, and `scripts/check-slow.sh` runs them in `--release`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use proptest::prelude::*;
use redextape_core::tm::machine::{Machine, Move, Rule, State, StateId, Symbol};
use redextape_core::tm::one_way::OriginSnapshot;
use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, Tape, simulate_final};
use redextape_core::tm::universal::{GuestStatus, STATE, TABLE, decode_guest, encode_guest, universal_machine};
use redextape_core::tm::{EncodingKind, TM_DEFAULT_CAPS, TmRun, decode_tape_ty, run_tm_described, run_tm_described_at};

mod common;
use common::{acyclic_machine, core_and_ty, run_with_origins};

/// The slow tier's caps: enough steps for its largest row, `sum(5)` under unary, which the UTM runs in
/// 7,315,621,686; the cells cap stays the default's, far above the 204,401 cells the largest row uses. The fast
/// tier keeps `DEFAULT_CAPS`, whose 5,000,000 steps are twice the 2,432,575 its largest compiled row takes, so a
/// UTM that never halts fails there on a cap instead of running toward these.
const UTM_CAPS: Caps = Caps { steps: 10_000_000_000, cells: DEFAULT_CAPS.cells };

/// The guest's current state id, decoded from a snapshot of [`STATE`]: the status cell, then the id's bits
/// most-significant-bit first, then a delimiter — the layout `encode_guest` in `universal.rs` lays out.
fn state_id(state: &Tape) -> u32 {
    let (cells, _) = state.snapshot();
    cells[1..].iter().take_while(|c| **c == '0' || **c == '1').fold(0u32, |acc, c| acc * 2 + u32::from(*c == '1'))
}

/// The leg over any guest, returning the guest tapes the UTM left. The UTM runs under `caps`, so a UTM that never
/// halts fails on a cap rather than running on. **The halt is asserted before the tapes**, so a UTM that stops
/// early reports the halt rather than a tape difference it caused. Prints the cost row: guest steps, UTM steps,
/// UTM steps per guest step, the encoded table's cells, and the cells the UTM's tapes end with, which is their
/// peak, since a tape never shrinks.
fn assert_utm_agrees(label: &str, m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> Vec<OriginSnapshot> {
    let (want, want_state, want_status, guest_steps) = run_with_origins(m, inits, DEFAULT_CAPS);
    assert_eq!(want_status, Status::Halted, "the direct run must halt for {label}");
    let want_accept = m.states.get(want_state as usize).is_some_and(|s| s.accept);

    let encoded = encode_guest(m, inits).unwrap_or_else(|| panic!("{label} must be encodable"));
    let (tapes, _, status, utm_steps) = simulate_final(&universal_machine(), &encoded, caps);
    assert_eq!(status, Status::Halted, "the UTM hit a cap for {label}");
    let run = decode_guest(&tapes).unwrap_or_else(|| panic!("the UTM left tapes that do not decode for {label}"));
    let want_status = if want_accept { GuestStatus::Accepted } else { GuestStatus::Stuck };
    assert_eq!(run.status, want_status, "the UTM halted differently for {label}");
    let got_state = state_id(&tapes[STATE]);
    assert_eq!(
        got_state, want_state,
        "guest state differs for {label}: UTM left state {got_state}, the direct run's final state is {want_state}"
    );
    assert_eq!(run.tapes.len(), want.len(), "tape counts differ for {label}");
    for (i, (got, want)) in run.tapes.iter().zip(&want).enumerate() {
        assert_eq!(got.trimmed(), want.trimmed(), "guest tape {i} differs for {label}");
    }

    let per_step = utm_steps as f64 / guest_steps.max(1) as f64;
    let peak: usize = tapes.iter().map(|t| t.snapshot().0.len()).sum();
    println!(
        "{label:64} guest {guest_steps:>6} steps, UTM {utm_steps:>13} steps ({per_step:>9.1} per guest step), table {:>6} cells, peak {peak:>6} cells",
        encoded[TABLE].len()
    );
    run.tapes
}

/// The leg over a compiled program, with the UTM under `caps`: the machine `run_tm_described` builds for `src`
/// under `enc` — at `width` when one is given — then, for a program that produced a value, that value decoded
/// from the UTM's tapes against the reference interpreter's.
fn assert_program_agrees(src: &str, enc: EncodingKind, width: Option<usize>, caps: Caps) {
    let (core, ty) = core_and_ty(src);
    let d = match width {
        Some(w) => run_tm_described_at(&core, enc, ty, TM_DEFAULT_CAPS, w),
        None => run_tm_described(&core, enc, ty, TM_DEFAULT_CAPS),
    }
    .unwrap_or_else(|r| panic!("{src} did not lower: {r:?}"));
    let label = format!("{src} ({enc:?})");
    let tapes = assert_utm_agrees(&label, &d.machine, &d.header.init(d.machine.tapes), caps);
    if matches!(d.run, TmRun::Ran { .. }) {
        let rebuilt: Vec<Tape> = tapes.iter().map(|s| Tape::new(&s.cells)).collect();
        // `interp::eval` is this project's reference interpreter for the mini-language `Core` built above
        // from a fixed test corpus, not a dynamic or untrusted code-execution primitive.
        let want = redextape_core::interp::eval(&core).unwrap_or_else(|e| panic!("reference failed for {src}: {e:?}"));
        assert_eq!(decode_tape_ty(&rebuilt, &d.header.result, &*d.header.encoding()), Some(want), "value for {label}");
    }
}

#[test]
fn the_universal_leg_agrees_on_small_programs() {
    assert_program_agrees("3 - 5", EncodingKind::Unary, None, DEFAULT_CAPS);
    assert_program_agrees("3 - 5", EncodingKind::Binary, None, DEFAULT_CAPS);
    assert_program_agrees("if 2 > 1 { 10 } else { 20 }", EncodingKind::Binary, None, DEFAULT_CAPS);
}

/// A lowered machine that overflows its field width halts in its rule-less `overflow` state, which is not an
/// accept, so the UTM must report the guest stuck. Pinned at width 4, where `2 + 3` cannot fit under unary.
#[test]
fn a_program_that_overflows_its_field_width_halts_stuck() {
    let (core, ty) = core_and_ty("2 + 3");
    let d = run_tm_described_at(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS, 4).expect("lowers");
    assert!(matches!(d.run, TmRun::Overflow), "the fixture must overflow: {:?}", d.run);
    assert_program_agrees("2 + 3", EncodingKind::Unary, Some(4), DEFAULT_CAPS);
}

#[test]
#[ignore = "slow tier: 2 to 7 seconds each in the dev profile; run via scripts/check-slow.sh"]
fn the_universal_leg_agrees_on_the_rest_of_the_small_programs() {
    assert_program_agrees("if 2 > 1 { 10 } else { 20 }", EncodingKind::Unary, None, UTM_CAPS);
    for enc in [EncodingKind::Unary, EncodingKind::Binary] {
        assert_program_agrees("cons(1, cons(2, nil))", enc, None, UTM_CAPS);
        assert_program_agrees("1 + 2 * 3", enc, None, UTM_CAPS);
    }
}

#[test]
#[ignore = "slow tier: 7.3 billion UTM steps under unary; run via scripts/check-slow.sh"]
fn the_universal_leg_agrees_on_sum_five() {
    for enc in [EncodingKind::Unary, EncodingKind::Binary] {
        assert_program_agrees("fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)", enc, None, UTM_CAPS);
    }
}

/// A machine of states `s0`, `s1`, … taking one rule each — read anything, then the given writes and moves —
/// and then accepting.
fn chain(tapes: usize, steps: &[(Vec<Option<Symbol>>, Vec<Move>)]) -> Machine {
    let mut states: Vec<State> = steps
        .iter()
        .enumerate()
        .map(|(i, (write, moves))| State {
            name: format!("s{i}"),
            accept: false,
            rules: vec![Rule {
                read: vec![None; tapes],
                write: write.clone(),
                moves: moves.clone(),
                next: i as StateId + 1,
            }],
        })
        .collect();
    states.push(State { name: "done".into(), accept: true, rules: vec![] });
    Machine { states, start: 0, tapes }
}

#[test]
fn one_tape_guests_agree() {
    let increment = Machine {
        tapes: 1,
        start: 0,
        states: vec![
            State {
                name: "scan".into(),
                accept: false,
                rules: vec![
                    Rule { read: vec![Some('1')], write: vec![None], moves: vec![Move::R], next: 0 },
                    Rule { read: vec![None], write: vec![Some('1')], moves: vec![Move::S], next: 1 },
                ],
            },
            State { name: "halt".into(), accept: true, rules: vec![] },
        ],
    };
    assert_utm_agrees("the incrementer", &increment, &[vec!['1', '1']], DEFAULT_CAPS);

    let left = chain(1, &[(vec![Some('a')], vec![Move::L]), (vec![Some('b')], vec![Move::L])]);
    let tapes = assert_utm_agrees("two cells left", &left, &[vec!['x']], DEFAULT_CAPS);
    assert_eq!(tapes[0].origin, 2, "the fixture must reach cell -2");

    let stuck = Machine {
        tapes: 1,
        start: 0,
        states: vec![State {
            name: "skip-a".into(),
            accept: false,
            rules: vec![Rule { read: vec![Some('a')], write: vec![None], moves: vec![Move::R], next: 0 }],
        }],
    };
    let tapes = assert_utm_agrees("stuck on b", &stuck, &[vec!['a', 'a', 'b']], DEFAULT_CAPS);
    assert_eq!(tapes[0].head, 2, "stuck on the `b`");
}

#[test]
fn two_tape_guests_agree() {
    let copy = Machine {
        tapes: 2,
        start: 0,
        states: vec![
            State {
                name: "copy".into(),
                accept: false,
                rules: vec![
                    Rule {
                        read: vec![Some('1'), None],
                        write: vec![None, Some('1')],
                        moves: vec![Move::R, Move::R],
                        next: 0,
                    },
                    Rule { read: vec![None, None], write: vec![None, None], moves: vec![Move::S, Move::L], next: 1 },
                ],
            },
            State {
                name: "mark".into(),
                accept: false,
                rules: vec![Rule {
                    read: vec![None, None],
                    write: vec![Some('x'), Some('y')],
                    moves: vec![Move::L, Move::L],
                    next: 2,
                }],
            },
            State { name: "done".into(), accept: true, rules: vec![] },
        ],
    };
    assert_utm_agrees("copy a unary number across", &copy, &[vec!['1', '1', '1']], DEFAULT_CAPS);
    let apart = chain(
        2,
        &[(vec![Some('a'), Some('b')], vec![Move::L, Move::R]), (vec![None, Some('c')], vec![Move::L, Move::L])],
    );
    let tapes = assert_utm_agrees("two tapes moving apart", &apart, &[], DEFAULT_CAPS);
    assert_eq!(tapes[0].origin, 2, "tape 0 must reach cell -2");
}

#[test]
fn three_tape_guests_agree() {
    let m = chain(
        3,
        &[
            (vec![Some('a'), Some('b'), Some('c')], vec![Move::R, Move::S, Move::L]),
            (vec![None, None, None], vec![Move::L, Move::R, Move::S]),
            (vec![None, None, Some('d')], vec![Move::S, Move::L, Move::L]),
        ],
    );
    let tapes = assert_utm_agrees("three tapes", &m, &[vec!['p'], vec![], vec!['q', 'r']], DEFAULT_CAPS);
    assert_eq!(tapes[2].origin, 2, "tape 2 must reach cell -2");
}

proptest! {
    // A failing case runs again at every shrink step, and a UTM that never halts takes each run to its cap, so
    // shrinking is also bounded at ten seconds: proptest's own bound is 1,024 runs, four times the 256 cases.
    #![proptest_config(ProptestConfig { max_shrink_time: 10_000, ..ProptestConfig::default() })]
    #[test]
    fn random_acyclic_machines_agree_with_the_universal_machine((m, inits) in acyclic_machine()) {
        assert_utm_agrees("a random acyclic machine", &m, &inits, DEFAULT_CAPS);
    }
}

/// **A GREEN PROPTEST SAYS NOTHING ABOUT WHAT IT GENERATED**, so the generator's reach is held on a fixed
/// seed: every tape count appears, and the left half is reached. Each floor is a tenth of the cases, well under
/// what the generator measured when this was written; the printed line gives the live counts.
#[test]
fn the_acyclic_generator_reaches_every_tape_count_and_the_left_half() {
    use proptest::strategy::ValueTree;
    use proptest::test_runner::TestRunner;
    let mut runner = TestRunner::deterministic();
    let strategy = acyclic_machine();
    let total = 256usize;
    let (mut by_tapes, mut crossed) = ([0usize; 4], 0usize);
    for _ in 0..total {
        let (m, inits) = strategy.new_tree(&mut runner).unwrap().current();
        by_tapes[m.tapes] += 1;
        let (snaps, _s, _status, _n) = run_with_origins(&m, &inits, DEFAULT_CAPS);
        crossed += usize::from(snaps.iter().any(|s| s.origin > 0));
    }
    println!("of {total} generated machines: {:?} with 1, 2 and 3 tapes; {crossed} reach cell -1", &by_tapes[1..]);
    for (tapes, count) in by_tapes.iter().enumerate().skip(1) {
        assert!(count * 10 >= total, "only {count} of {total} generated machines have {tapes} tapes");
    }
    assert!(crossed * 10 >= total, "only {crossed} of {total} generated machines reach cell -1");
}
