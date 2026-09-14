//! The sixth oracle leg: `multitape-TM == one-way-TM`, on programs whose earlier equalities
//! `native_oracle.rs`'s `FIRST_ORDER_DEMOS` suite already asserts. Compared per tape relative to the
//! ORIGIN, not with `single_tape.rs`'s `normalize`: the tapes that cross into the left half include
//! tapes that end all blank, where `normalize` keeps no head position.
//!
//! Also: the deep excursions no lowered demo machine makes, the fold composed with the alphabet
//! reduction, the certificate that stages 1 and 2 already never step left of cell 0, and the slow-tier
//! cost table.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use proptest::prelude::*;
use redextape_core::tm::EncodingKind;
use redextape_core::tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
use redextape_core::tm::one_way::{LEFT_END, OriginSnapshot, to_one_way, unzigzag, zigzag};
use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, Tape, simulate_final, simulate_watched};
use redextape_core::tm::single_tape::{LEFT, deinterleave, interleave, layout_collision, normalize, to_single_tape};
use redextape_core::tm::two_symbol::{Code, bitify, to_two_symbol, unbitify};

mod common;
use common::build_machine;

/// Run `m` and record where each tape's origin ends up in its final snapshot.
///
/// **A TAPE GROWS ON ITS LEFT EXACTLY WHEN, AFTER A STEP, IT IS LONGER AND ITS HEAD IS AT INDEX 0.** A
/// step moves a head at most one cell, so a tape grows by at most one; growth on the right leaves the
/// head at index 1 or beyond. The count of left growths is the origin's index. `slice(0, usize::MAX)`
/// is the tape's length, O(tape) per step — affordable for machines that halt in thousands of steps,
/// which is every machine this file runs through it.
fn run_with_origins(m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> (Vec<OriginSnapshot>, StateId, Status, u64) {
    let mut len: Vec<usize> = (0..m.tapes).map(|i| inits.get(i).map_or(1, |t| t.len().max(1))).collect();
    let mut grown = vec![0usize; m.tapes];
    let mut steps = 0u64;
    let (tapes, state, status) = {
        let mut watch = |tapes: &[Tape]| {
            steps += 1;
            for (i, t) in tapes.iter().enumerate() {
                let l = t.slice(0, usize::MAX).len();
                if l > len[i] && t.head_index() == 0 {
                    grown[i] += l - len[i];
                }
                len[i] = l;
            }
            true
        };
        simulate_watched(m, inits, caps, &mut watch)
    };
    let snaps = tapes
        .iter()
        .zip(&grown)
        .map(|(t, &origin)| {
            let (cells, head) = t.snapshot();
            OriginSnapshot { cells, head, origin }
        })
        .collect();
    (snaps, state, status, steps)
}

struct Outcome {
    want: Vec<OriginSnapshot>,
    want_steps: u64,
    got_steps: u64,
    want_accept: bool,
    got_accept: bool,
}

/// The leg, over any machine and its tapes. **The certificate is asserted before the status**, so a
/// construction that walks off the left end and then runs to a cap reports the certificate, not the cap.
fn assert_fold_agrees(label: &str, m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> Outcome {
    let (want, want_state, want_status, want_steps) = run_with_origins(m, inits, caps);
    assert_eq!(want_status, Status::Halted, "the source run must halt for {label}");

    let folded = to_one_way(m);
    assert_eq!(folded.validate(), Vec::<String>::new(), "the folded machine must be well formed for {label}");
    let cells = zigzag(inits, m.tapes).expect("no initial tape holds LEFT_END");
    let (got, got_state, got_status, got_steps) = simulate_final(&folded, &cells, caps);
    assert_eq!(got.len(), want.len(), "tape counts differ for {label}");
    let back: Vec<OriginSnapshot> = got
        .iter()
        .enumerate()
        .map(|(i, t)| {
            unzigzag(t)
                .unwrap_or_else(|| panic!("tape {i} of {label}: stepped left of cell 0, or is not a folded tape"))
        })
        .collect();
    assert_eq!(got_status, Status::Halted, "the folded run hit a cap for {label}");
    for (i, (w, g)) in want.iter().zip(&back).enumerate() {
        assert_eq!(g.trimmed(), w.trimmed(), "tape {i} differs for {label}");
    }
    Outcome {
        want_accept: m.states.get(want_state as usize).is_some_and(|s| s.accept),
        got_accept: folded.states.get(got_state as usize).is_some_and(|s| s.accept),
        want,
        want_steps,
        got_steps,
    }
}

const TAPE_NAMES: [&str; 5] = ["reg", "work", "stack", "heap", "box"];

/// Every member is a member of `native_oracle.rs`'s `FIRST_ORDER_DEMOS`, whose four-way oracle supplies
/// the earlier equalities, and the same four programs `two_symbol_oracle.rs` runs.
const CORPUS: &[&str] = &[
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "cons(1, cons(2, nil))",
    "fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))",
];

#[test]
fn the_one_way_leg_agrees_on_small_programs() {
    let mut cases: Vec<(&str, EncodingKind)> = CORPUS.iter().map(|s| (*s, EncodingKind::Unary)).collect();
    cases.push(("cons(1, cons(2, nil))", EncodingKind::Binary));
    for (src, enc) in cases {
        let (m, inits) = build_machine(src, enc);
        assert_eq!(m.tapes, TAPE_NAMES.len(), "the tape names below would silently truncate");
        let label = format!("{src} ({enc:?})");
        let out = assert_fold_agrees(&label, &m, &inits, DEFAULT_CAPS);
        assert!(out.got_accept, "the folded run must halt in an accept for {label}");
        assert!(out.want_accept, "and so must the source run, for {label}");
        let left: Vec<String> = out
            .want
            .iter()
            .zip(TAPE_NAMES)
            .filter(|(s, _)| s.origin > 0)
            .map(|(s, name)| {
                let ends = if s.cells.iter().all(|c| *c == BLANK) { "ends blank" } else { "ends non-blank" };
                format!("{name} to -{} ({ends})", s.origin)
            })
            .collect();
        println!("{label:84} left of cell 0: {}", left.join(", "));
        assert!(!left.is_empty(), "no tape of {label} went left of cell 0, so this leg's crossings are vacuous for it");
    }
}

/// A one-tape machine taking `steps` in order — each a wildcard read, an optional write and a move — then
/// accepting.
fn walk(steps: &[(Option<Symbol>, Move)]) -> Machine {
    let mut states: Vec<State> = steps
        .iter()
        .enumerate()
        .map(|(k, (write, mv))| State {
            name: format!("s{k}"),
            accept: false,
            rules: vec![Rule { read: vec![None], write: vec![*write], moves: vec![*mv], next: (k + 1) as StateId }],
        })
        .collect();
    states.push(State { name: "done".into(), accept: true, rules: vec![] });
    Machine { states, start: 0, tapes: 1 }
}

#[test]
fn the_origin_watcher_counts_left_growth_and_nothing_else() {
    let lr = walk(&[
        (None, Move::L),
        (None, Move::L),
        (None, Move::L),
        (None, Move::R),
        (None, Move::R),
        (None, Move::R),
        (None, Move::R),
        (None, Move::R),
    ]);
    let (snaps, _s, status, steps) = run_with_origins(&lr, &[vec!['a', 'b']], DEFAULT_CAPS);
    assert_eq!((status, steps), (Status::Halted, 8));
    assert_eq!((snaps[0].origin, snaps[0].head), (3, 5), "three cells grown on the left; the head ends on cell 2");

    let r = walk(&[(None, Move::R), (None, Move::R), (None, Move::R)]);
    let (snaps, _s, status, _n) = run_with_origins(&r, &[vec!['a']], DEFAULT_CAPS);
    assert_eq!(status, Status::Halted);
    assert_eq!((snaps[0].origin, snaps[0].head), (0, 3), "growth on the right is not growth on the left");
}

/// The roadmap's point: "polynomial slowdown is normally a hand-wave; here step counts are exact
/// integers". **TWO PREDICTIONS THIS TESTS**, both from the spec: folded steps come to about twice the
/// source's, and the ratio does not grow with tape length, because the fold is local — no move costs more
/// than three physical steps — where stage 1's every step sweeps the whole tape. `longest tape` is printed
/// so the second prediction is read off the table rather than asserted in prose.
#[test]
#[ignore = "slow tier: run via cargo nextest run -p redextape-core --test one_way_oracle --run-ignored all"]
fn the_one_way_cost_table() {
    for src in ["1 + 2 * 3", "let x = 40; x + 2", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"] {
        for enc in [EncodingKind::Unary, EncodingKind::Binary] {
            let (m, inits) = build_machine(src, enc);
            let label = format!("{src} ({enc:?})");
            let out = assert_fold_agrees(&label, &m, &inits, DEFAULT_CAPS);
            let lefty = (0..m.tapes)
                .filter(|&i| m.states.iter().flat_map(|s| &s.rules).any(|r| r.moves.get(i) == Some(&Move::L)))
                .count();
            let longest = out.want.iter().map(|s| s.cells.len()).max().unwrap_or(0);
            let ratio = out.got_steps as f64 / out.want_steps as f64;
            println!(
                "{label:80} tapes with L {lefty}  longest tape {longest:>4}  source {:>7}  folded {:>8}  ratio {ratio:.3}x",
                out.want_steps, out.got_steps
            );
        }
    }
}

/// **NO LOWERED DEMO MACHINE GOES BELOW CELL -1**, so the corpus cannot tell a correct fold from one that
/// is right only one cell deep. Five cells left writing `x`, then eight right writing `y`, crossing the
/// origin in both directions.
#[test]
fn a_five_cell_excursion_left_and_back_agrees() {
    let x = Some('x');
    let y = Some('y');
    let mut steps = vec![(x, Move::L); 5];
    steps.extend(vec![(y, Move::R); 8]);
    let m = walk(&steps);
    let out = assert_fold_agrees("depth 5", &m, &[vec!['a', 'b']], DEFAULT_CAPS);
    assert_eq!(out.want[0].origin, 5, "the fixture must actually reach cell -5");
    assert!(out.want_accept && out.got_accept);
}

/// Both tapes cross the origin inside ONE rule, in both directions, so both side bits flip at once and the
/// chain has to carry the first flip into the second tape's move. Distinct writes on every step make a
/// misplaced head show up as a misplaced symbol.
#[test]
fn two_tapes_crossing_the_origin_in_one_rule_agree() {
    let step = |w0: Symbol, m0: Move, w1: Symbol, m1: Move, next: StateId| Rule {
        read: vec![None, None],
        write: vec![Some(w0), Some(w1)],
        moves: vec![m0, m1],
        next,
    };
    let state = |name: &str, rule: Rule| State { name: name.into(), accept: false, rules: vec![rule] };
    let m = Machine {
        states: vec![
            state("s0", step('a', Move::L, 'b', Move::L, 1)),
            state("s1", step('c', Move::R, 'd', Move::L, 2)),
            state("s2", step('e', Move::L, 'f', Move::R, 3)),
            state("s3", step('g', Move::R, 'h', Move::R, 4)),
            State { name: "done".into(), accept: true, rules: vec![] },
        ],
        start: 0,
        tapes: 2,
    };
    let out = assert_fold_agrees("two tapes crossing together", &m, &[vec!['p'], vec!['q']], DEFAULT_CAPS);
    assert_eq!((out.want[0].origin, out.want[1].origin), (1, 2), "the fixture must take tape 0 to -1 and tape 1 to -2");
    assert!(out.want_accept && out.got_accept);
}

/// Random machines whose rules only ever target a higher-numbered state, so every run halts within as
/// many steps as there are states. Moves lean left, since the left half is what this exists to reach.
fn acyclic_machine() -> impl Strategy<Value = (Machine, Vec<Vec<Symbol>>)> {
    (1usize..=3, 2usize..=12).prop_flat_map(|(tapes, n)| {
        let sym = prop::sample::select(vec!['a', 'b', BLANK]);
        let read = prop::option::of(sym.clone());
        let write = prop::option::of(sym.clone());
        let mv = prop::sample::select(vec![Move::L, Move::L, Move::R, Move::S]);
        let rule = (
            prop::collection::vec(read, tapes),
            prop::collection::vec(write, tapes),
            prop::collection::vec(mv, tapes),
            any::<prop::sample::Index>(),
        );
        let states = prop::collection::vec(prop::collection::vec(rule, 1..=3), n);
        let inits = prop::collection::vec(prop::collection::vec(sym, 0..4), tapes);
        (states, inits).prop_map(move |(states, inits)| {
            let mut built: Vec<State> = states
                .into_iter()
                .enumerate()
                .map(|(i, rules)| State {
                    name: format!("s{i}"),
                    accept: false,
                    rules: rules
                        .into_iter()
                        .map(|(read, write, moves, target)| Rule {
                            read,
                            write,
                            moves,
                            next: (i + 1 + target.index(n - i)) as StateId,
                        })
                        .collect(),
                })
                .collect();
            built.push(State { name: "done".into(), accept: true, rules: vec![] });
            (Machine { states: built, start: 0, tapes }, inits)
        })
    })
}

proptest! {
    #[test]
    fn random_acyclic_machines_agree_with_their_fold((m, inits) in acyclic_machine()) {
        let out = assert_fold_agrees("a random acyclic machine", &m, &inits, DEFAULT_CAPS);
        // NOT leg 6's accept requirement: a random machine can legitimately halt stuck.
        prop_assert_eq!(out.want_accept, out.got_accept);
    }
}

/// **A GREEN PROPTEST SAYS NOTHING ABOUT HOW DEEP IT WENT**, so the generator's reach is measured on a
/// fixed seed and held. The floor is a tenth of the cases reaching cell -2, set well under what the
/// generator measured when this was written, so it trips when the generator stops reaching depth rather
/// than on a small change in the mix; the printed line gives the live counts.
#[test]
fn the_acyclic_generator_reaches_deep_excursions() {
    use proptest::strategy::ValueTree;
    use proptest::test_runner::TestRunner;
    let mut runner = TestRunner::deterministic();
    let strategy = acyclic_machine();
    let (mut deep, mut crossed, total) = (0usize, 0usize, 256usize);
    for _ in 0..total {
        let (m, inits) = strategy.new_tree(&mut runner).unwrap().current();
        let (snaps, _s, _status, _n) = run_with_origins(&m, &inits, DEFAULT_CAPS);
        let depth = snaps.iter().map(|s| s.origin).max().unwrap_or(0);
        crossed += usize::from(depth >= 1);
        deep += usize::from(depth >= 2);
    }
    println!("of {total} generated machines: {crossed} reach cell -1, {deep} reach cell -2 or beyond");
    assert!(
        deep * 10 >= total,
        "only {deep} of {total} generated machines reach cell -2: the depth this proptest exists for is gone"
    );
}

/// **FOLD, THEN THE ALPHABET REDUCTION: MULTI-TAPE, TWO SYMBOLS, NEVER LEFT OF CELL 0.** Stage 2's leg
/// assertions over the folded machine — its tapes always hold `LEFT_END` at cell 0, so `normalize`'s
/// all-blank blind spot cannot arise here — and the certificate that every reduced tape still starts
/// with `LEFT_END`'s pattern. Sound because stage 2 moves in whole `k`-cell strides and neither stage
/// writes `LEFT_END`.
#[test]
fn the_fold_composes_with_the_alphabet_reduction_and_stays_right() {
    for src in CORPUS {
        let (m, inits) = build_machine(src, EncodingKind::Unary);
        let folded = to_one_way(&m);
        let cells = zigzag(&inits, m.tapes).expect("no initial tape holds LEFT_END");
        let code = Code::new(&folded, &cells);
        let reduced = to_two_symbol(&folded, &code);
        assert_eq!(reduced.validate(), Vec::<String>::new(), "for {src:?}");
        assert_eq!(reduced.alphabet().len(), 2, "two symbols, for {src:?}");
        assert_eq!(reduced.tapes, m.tapes, "neither stage changes the tape count, for {src:?}");
        let bits = bitify(&cells, &code).expect("the code was built from these tapes");
        let (want, _ws, want_status, want_steps) = simulate_final(&folded, &cells, DEFAULT_CAPS);
        assert_eq!(want_status, Status::Halted, "the folded run must halt for {src:?}");
        let (got, got_state, got_status, got_steps) = simulate_final(&reduced, &bits, DEFAULT_CAPS);
        let pattern = code.pattern(LEFT_END).expect("the code covers the marker");
        for (i, t) in got.iter().enumerate() {
            assert_eq!(t.slice(0, code.bits()), pattern, "tape {i} of {src:?} stepped left of cell 0");
        }
        assert_eq!(got_status, Status::Halted, "the reduced run hit a cap for {src:?}");
        assert!(
            reduced.states[got_state as usize].accept,
            "halted in `{}` for {src:?}",
            reduced.states[got_state as usize].name
        );
        for (i, tape) in want.iter().enumerate() {
            let (back, head) = unbitify(&got[i], &code).unwrap_or_else(|| panic!("tape {i} misaligned for {src:?}"));
            let (w_cells, w_head) = tape.snapshot();
            assert_eq!(normalize(&back, head), normalize(&w_cells, w_head), "tape {i} differs for {src:?}");
        }
        println!("{src:72} k {} folded steps {want_steps:>8} reduced steps {got_steps:>9}", code.bits());
    }
}

/// Padding blocks for a stage 1 image, matching `two_symbol_oracle.rs`'s `PAD`.
const PAD: usize = 2;

/// **THE REGRESSION GATE ON THE FINDING THAT RESHAPED STAGE 3.** Stage 1's `<` sentinel already keeps
/// every head of the composed canonical machine at or right of cell 0; this holds it there. Sound
/// because stage 1 never writes `<` and stage 2 strides whole blocks, so a left excursion would put some
/// other block — or the all-zero block — at cell 0.
#[test]
fn stages_one_and_two_never_step_left_of_cell_zero() {
    const CAPS: Caps = Caps { steps: 2_000_000_000, cells: DEFAULT_CAPS.cells };
    let src = "3 - 5";
    let (m, inits) = build_machine(src, EncodingKind::Unary);
    assert_eq!(layout_collision(&m, &inits), None);
    let single = to_single_tape(&m);
    let cells = vec![interleave(&inits, m.tapes, PAD, PAD)];
    let code = Code::new(&single, &cells);
    let canonical = to_two_symbol(&single, &code);
    let bits = bitify(&cells, &code).expect("the code was built from these tapes");
    let (got, state, status, steps) = simulate_final(&canonical, &bits, CAPS);
    let pattern = code.pattern(LEFT).expect("the code covers the sentinel");
    assert_eq!(got[0].slice(0, code.bits()), pattern, "the canonical machine stepped left of cell 0");
    assert_eq!(status, Status::Halted);
    assert!(canonical.states[state as usize].accept, "halted in `{}`", canonical.states[state as usize].name);
    println!("{src}: k {} steps {steps} pattern(<) {pattern:?}", code.bits());
}

/// **ALL THREE STAGES: ONE TAPE, ONE HEAD, TWO SYMBOLS, ONE-WAY** — the roadmap's literal punchline.
///
/// **IN THIS ORDER STAGE 1 BOUNDS THE TAPE ANYWAY**, so this run shows the stages COMPOSE and is not
/// evidence the fold works: `the_one_way_leg_agrees_on_small_programs` (which covers this same program),
/// `a_five_cell_excursion_left_and_back_agrees` and `random_acyclic_machines_agree_with_their_fold` are.
/// The chain here is checked a stage at a time — folded run against stage 1's image, stage 1's image
/// against stage 2's — and each comparison can use `normalize` safely, because every tape it sees starts
/// with a non-blank marker (`LEFT_END` on a folded tape, `<` on stage 1's), so `normalize` always has an
/// anchor to keep the head against.
///
/// **NO LEFT PADDING, ON PURPOSE.** A folded machine never visits a cell left of its marker, so stage 1's
/// skeleton needs no block left of the one holding physical cell 0; one block on the right was measured to
/// suffice for this program.
#[test]
#[ignore = "slow tier: run via cargo nextest run -p redextape-core --test one_way_oracle --run-ignored all"]
fn all_three_stages_compose_into_one_tape_two_symbols_one_way() {
    const CAPS: Caps = Caps { steps: 100_000_000, cells: DEFAULT_CAPS.cells };
    let src = "3 - 5";
    let (m, inits) = build_machine(src, EncodingKind::Unary);
    let folded = to_one_way(&m);
    let z = zigzag(&inits, m.tapes).expect("no initial tape holds LEFT_END");
    assert_eq!(layout_collision(&folded, &z), None, "the fold's marker collides with stage 1's layout");
    let single = to_single_tape(&folded);
    let cells = vec![interleave(&z, folded.tapes, 0, 1)];
    let code = Code::new(&single, &cells);
    let canonical = to_two_symbol(&single, &code);
    assert_eq!(canonical.validate(), Vec::<String>::new());
    assert_eq!(canonical.tapes, 1, "one tape");
    assert_eq!(canonical.alphabet().len(), 2, "two symbols");
    let bits = bitify(&cells, &code).expect("the code was built from these tapes");

    let (got, state, status, steps) = simulate_final(&canonical, &bits, CAPS);
    let pattern = code.pattern(LEFT).expect("the code covers the sentinel");
    assert_eq!(got[0].slice(0, code.bits()), pattern, "the composed machine stepped left of cell 0");
    assert_eq!(status, Status::Halted, "the composed run hit a cap");
    assert!(canonical.states[state as usize].accept, "halted in `{}`", canonical.states[state as usize].name);

    let (folded_tapes, _fs, folded_status, folded_steps) = simulate_final(&folded, &z, CAPS);
    assert_eq!(folded_status, Status::Halted);
    let (single_tapes, single_state, single_status, single_steps) = simulate_final(&single, &cells, CAPS);
    assert_eq!(single_status, Status::Halted);
    assert!(
        single.states[single_state as usize].accept,
        "stage 1 halted in `{}`",
        single.states[single_state as usize].name
    );
    let out = deinterleave(&single_tapes[0], folded.tapes).expect("stage 1's image stays well formed");
    for (i, tape) in folded_tapes.iter().enumerate() {
        let (f_cells, f_head) = tape.snapshot();
        assert_eq!(normalize(&out[i].0, out[i].1), normalize(&f_cells, f_head), "stage 1 differs on tape {i}");
    }
    let (back, head) = unbitify(&got[0], &code).expect("stage 2's image stays aligned");
    let (s_cells, s_head) = single_tapes[0].snapshot();
    assert_eq!(normalize(&back, head), normalize(&s_cells, s_head), "stage 2 differs");
    println!(
        "{src}: folded {folded_steps} steps, stage 1 {single_steps}, all three {steps} (k {}, {} states)",
        code.bits(),
        canonical.states.len()
    );
}
