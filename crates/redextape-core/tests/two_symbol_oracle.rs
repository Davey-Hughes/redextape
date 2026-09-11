//! The fifth oracle leg: `reference == λ == multitape-TM == singletape-TM == two-symbol-TM`. The
//! first three are `three_way_oracle.rs`'s and `native_oracle.rs`'s subject and the fourth is
//! `single_tape_oracle.rs`'s; this file adds the fifth, and asserts it on tape contents and head
//! position rather than on a decoded value — it needs no second decode path that could drift, and
//! it is stronger than a decoded-value comparison only for the tapes that end non-blank. How much of
//! the corpus that is gets counted, not claimed here:
//! `the_leg_reports_how_many_of_its_tape_comparisons_discriminate` prints it.
//!
//! **THE COMPARISON IS `single_tape::normalize`, AND ITS DOCUMENTED WEAKNESS IS INHERITED WHOLE.**
//! Reusing it is deliberate — one trimmer means the two reductions' legs cannot disagree about what
//! "the same tape" means — but on an ALL-BLANK tape it discards the head position, so every
//! assertion below is satisfied by any head on either side whenever that tape ends all blank, which
//! most tapes in this corpus do. That is an instrument weakness, not a construction defect: nothing
//! in `to_two_symbol`, `bitify` or `unbitify` loses head information, only this comparison does.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::build::MAX_MACHINE_STATES;
use redextape_core::tm::machine::{BLANK, Machine, Symbol};
use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, Tape, simulate_final};
use redextape_core::tm::single_tape::{interleave, layout_collision, normalize, to_single_tape};
use redextape_core::tm::two_symbol::{Code, bitify, to_two_symbol, unbitify};
use redextape_core::tm::{EncodingKind, TM_DEFAULT_CAPS, TmRun, run_tm_described};
use redextape_core::ty::Ty;
use redextape_core::typeck::result_type;
use std::collections::BTreeSet;

/// Padding blocks per side for the single-tape image, matching `single_tape_oracle.rs`'s `PAD`.
const PAD: usize = 2;

fn core_and_ty(src: &str) -> (Core, Ty) {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
    let prog = prog.expect("a program");
    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
    (desugar(&prog), ty)
}

fn build_machine(src: &str, enc: EncodingKind) -> (Machine, Vec<Vec<Symbol>>) {
    let (core, ty) = core_and_ty(src);
    let d = run_tm_described(&core, enc, ty, TM_DEFAULT_CAPS).unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
    assert!(matches!(d.run, TmRun::Ran { .. }), "the source machine must complete for {src:?}");
    let init = d.header.init(d.machine.tapes);
    (d.machine, init)
}

/// The leg itself, over an arbitrary machine and its tapes, so Task 7 can point it at a single-tape
/// image without a second copy of the assertions.
fn assert_two_symbol_agrees(label: &str, m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> (u64, u64) {
    let code = Code::new(m, inits);
    let (want, _ws, want_status, want_steps) = simulate_final(m, inits, caps);
    assert_eq!(want_status, Status::Halted, "the source run must halt for {label}");

    let reduced = to_two_symbol(m, &code);
    assert_eq!(reduced.validate(), Vec::<String>::new(), "the reduced machine must be well formed for {label}");
    assert_eq!(reduced.alphabet().len(), 2, "the whole point: two symbols, for {label}");
    let cells = bitify(inits, &code).expect("the code was built from these tapes");
    let (got, got_state, got_status, got_steps) = simulate_final(&reduced, &cells, caps);
    assert_eq!(got_status, Status::Halted, "the reduced run hit a cap for {label}");
    // NOT just "it halted": a stuck state halts too and reports the same `Status`. The difference is
    // visible only in the final state's accept flag, which is the gap stage 1's Task 6 review found
    // by sabotaging `entry_name` and watching its strongest leg stay green.
    assert!(
        reduced.states[got_state as usize].accept,
        "halted in `{}`, not an accept, for {label}",
        reduced.states[got_state as usize].name
    );

    for (i, tape) in want.iter().enumerate() {
        let (back, head) = unbitify(&got[i], &code).unwrap_or_else(|| panic!("tape {i} misaligned for {label}"));
        let (w_cells, w_head) = tape.snapshot();
        assert_eq!(normalize(&back, head), normalize(&w_cells, w_head), "tape {i} differs for {label}");
    }
    assert!(got_steps > want_steps, "the reduction should cost more steps, not fewer, for {label}");
    (want_steps, got_steps)
}

/// Which of a run's tapes (`REG, WORK, STACK, HEAP, BOX`, in `build.rs`'s tape order) end non-blank,
/// named rather than merely counted.
///
/// **`single_tape::normalize` DISCARDS THE HEAD ON AN ALL-BLANK TAPE**, so comparing two all-blank
/// tapes succeeds for ANY pair of head positions. These machines have five tapes and these programs
/// are small, so a leg reporting "tape identity" without naming which tapes are actually live reports
/// a stronger property than it holds.
fn live_tapes(want: &[Tape]) -> Vec<&'static str> {
    const NAMES: [&str; 5] = ["reg", "work", "stack", "heap", "box"];
    assert_eq!(
        want.len(),
        NAMES.len(),
        "the machine's tape count and this name list must agree, or `zip` below silently truncates"
    );
    want.iter().zip(NAMES).filter(|(t, _)| t.snapshot().0.iter().any(|c| *c != BLANK)).map(|(_, name)| name).collect()
}

/// Every member MUST be a member of `native_oracle.rs`'s `FIRST_ORDER_DEMOS`
/// (`crates/redextape-native/tests/native_oracle.rs`) — that array's four-way oracle already asserts
/// `reference == λ == multitape-TM == native` for each, so a program drawn from it gets the earlier
/// equalities for free and this leg only adds the fifth. A non-member would establish
/// `multitape-TM == two-symbol-TM` and nothing else.
///
/// The fourth member is the only one that declares and calls a `fn`, and so the only one whose
/// lowering emits the stack-frame gadgets — `encoding.rs`'s `Encoding::push_frame` and
/// `Encoding::pop_frame_restore`, which `lower_tm.rs` emits only for a program containing
/// `Instr::Call`, where `cons`/`nil`/`head`/`tail` lower through dedicated builtin instructions
/// instead.
///
/// **IT WAS ADDED FOR A REASON THAT TURNED OUT TO BE FALSE**: that it would leave the STACK tape
/// non-blank. `return` pops the frame before the machine halts, so that tape ends blank here exactly
/// as it does in the other three, and the per-tape measurement below is what falsified it.
///
/// **NOTHING IN THIS FILE ENFORCES THE REASON IT IS HERE NOW.** The per-program floor asserts only
/// that some tape discriminates a head position; it would pass identically if `Instr::Call` lowering
/// never ran at all. Enforcing it would mean lowering the program a second time to inspect its asm,
/// which this leg does not do.
const CORPUS: &[&str] = &[
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "cons(1, cons(2, nil))",
    "fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))",
];

#[test]
fn the_two_symbol_leg_agrees_on_small_programs() {
    for src in CORPUS {
        let (m, inits) = build_machine(src, EncodingKind::Unary);
        assert_two_symbol_agrees(src, &m, &inits, DEFAULT_CAPS);
    }
}

/// **HOW MUCH OF THE FIFTH LEG'S TAPE-IDENTITY CLAIM IS REAL.** Named rather than asserted in prose:
/// a tape that ends all blank compares equal under any pair of head positions, so only the live tapes
/// discriminate one. The floor is per-program, not corpus-wide — a corpus-wide floor is satisfied by
/// any one member carrying every live tape, so it can stay green while a single member's comparisons
/// are entirely vacuous. A per-program floor cannot: it fails on the member that goes vacuous, not on
/// the corpus as a whole.
#[test]
fn the_leg_reports_how_many_of_its_tape_comparisons_discriminate() {
    for src in CORPUS {
        let (m, inits) = build_machine(src, EncodingKind::Unary);
        let (want, _ws, status, _steps) = simulate_final(&m, &inits, DEFAULT_CAPS);
        assert_eq!(status, Status::Halted, "the source run must halt for {src:?}");
        let live = live_tapes(&want);
        println!("{src:60} live tapes: {}", if live.is_empty() { "(none)".to_string() } else { live.join(", ") });
        assert!(
            !live.is_empty(),
            "no tape discriminates a head position for {src:?}; its comparisons are entirely vacuous"
        );
    }
}

/// **THE ONE AXIS THAT MOVES `k`.** `EncodingKind::Binary` makes the tape ALPHABET larger, not
/// smaller — `#@_01` against unary's `#@_` — so `cons(1, cons(2, nil))` needs 3 bits per symbol
/// where unary needs 2. The roadmap asks whether the oracle runs the product of its axes or a
/// diagonal; this is a diagonal with one deliberate off-axis point, not a product.
#[test]
fn the_leg_holds_where_the_encoding_widens_the_alphabet() {
    let src = "cons(1, cons(2, nil))";
    let (unary, u_inits) = build_machine(src, EncodingKind::Unary);
    let (binary, b_inits) = build_machine(src, EncodingKind::Binary);
    let u_bits = Code::new(&unary, &u_inits).bits();
    let b_bits = Code::new(&binary, &b_inits).bits();
    assert!(b_bits > u_bits, "binary must widen the alphabet here: {u_bits} -> {b_bits}");
    assert_two_symbol_agrees(&format!("{src} (binary)"), &binary, &b_inits, DEFAULT_CAPS);
}

/// **THE CONCRETE CASE FOR `Code::new` TAKING THE INITIAL TAPES.** `interleave` writes a marker for
/// EVERY tape in `0..k`, whether that tape's rules mention it or not, so a single-tape image runs on
/// a tape carrying symbols its rules never name. `Machine::alphabet()` cannot see them.
///
/// **BOTH PROGRAMS STILL NEED 4 BITS EITHER WAY, SO NEITHER WOULD CATCH A `Code` BUILT FROM THE
/// RULES ALONE** — which is why the sabotage below exists rather than trust in this corpus.
#[test]
fn the_composed_machine_needs_more_symbols_than_its_rules_name() {
    for (src, rules_only, with_inits) in [("1 + 2 * 3", 9, 15), ("cons(1, cons(2, nil))", 12, 16)] {
        let (m, inits) = build_machine(src, EncodingKind::Unary);
        assert_eq!(layout_collision(&m, &inits), None, "a data symbol collides with stage 1's layout for {src:?}");
        let single = to_single_tape(&m);
        let cells = interleave(&inits, m.tapes, PAD, PAD);
        let named: BTreeSet<Symbol> = single.alphabet().into_iter().collect();
        let mut reachable = named.clone();
        reachable.extend(cells.iter().copied());
        reachable.insert(BLANK);
        assert_eq!(named.len(), rules_only, "symbols the rules of {src:?}'s image name");
        assert_eq!(reachable.len(), with_inits, "symbols that can reach {src:?}'s image's tape");
        assert_eq!(Code::new(&single, &[cells]).symbols().len(), with_inits, "Code::new must see all of them");
    }
}

/// **ONE TAPE, ONE HEAD, TWO SYMBOLS** — stage 1 composed with stage 2, which is the roadmap's
/// stated reason to do the alphabet reduction second. Only stage 3's one-way fold is missing.
///
/// This asserts the SHAPE, which is cheap. `the_composed_machine_runs` asserts that it computes the
/// same thing, which is not.
#[test]
fn the_composed_machine_is_one_tape_over_two_symbols() {
    for src in ["3 - 5", "if 2 > 1 { 10 } else { 20 }", "cons(1, cons(2, nil))"] {
        let (m, inits) = build_machine(src, EncodingKind::Unary);
        assert_eq!(layout_collision(&m, &inits), None, "a data symbol collides with stage 1's layout for {src:?}");
        let single = to_single_tape(&m);
        let cells = vec![interleave(&inits, m.tapes, PAD, PAD)];
        let code = Code::new(&single, &cells);
        let canonical = to_two_symbol(&single, &code);
        assert_eq!(canonical.validate(), Vec::<String>::new(), "for {src:?}");
        assert_eq!(canonical.tapes, 1, "one tape, for {src:?}");
        assert_eq!(canonical.alphabet().len(), 2, "two symbols, for {src:?}");
        assert!(canonical.states.len() < MAX_MACHINE_STATES, "over MAX_MACHINE_STATES for {src:?}");
        println!(
            "{src:40} k={} states={} (from {} single-tape, {} original)",
            code.bits(),
            canonical.states.len(),
            single.states.len(),
            m.states.len()
        );
    }
}

/// The composed machine actually computing the same thing. **The corpus is ONE program and the
/// smallest one available**, because this is stage 1's step count multiplied by stage 2's and stage
/// 1's own cost table needed 400,000,000 steps for programs of this size.
///
/// **THIS TEST'S RATIO IS NOT COMPARABLE TO `the_two_symbol_cost_table`'s.** Its source is the
/// single-tape IMAGE, whose step count is already inflated quadratically, not an original machine.
/// Two figures both spelled "steps per source step" can measure different regimes, and these two do.
/// Do not read them as one constant, and do not quote them side by side.
///
/// **RUNS IN THE NORMAL TIER, NOT THE SLOW ONE THIS FILE'S OTHER RATIO TESTS LIVE IN.** The note
/// above restricts the corpus to the smallest program available exactly to hold down THIS test's own
/// step count; having done that, the leg below is cheap enough for the normal tier despite composing
/// two constructions' costs. It belongs there for a reason those other tests don't share: `inits`
/// changes the resulting `Code` for the composed leg — asserted directly below — because `interleave`
/// writes a marker for every tape whether that tape's rules mention it or not, so the composed image's
/// alphabet reaches symbols only `inits` carries. The same comparison on this test's own RAW machine
/// agrees regardless of `inits` (also asserted below): a raw machine's rules already name every symbol
/// its own inits carry. That is the hazard `Code::new`'s `inits` argument exists to cover, and the
/// only other place IN THIS FILE a `Code` built without it would be caught is the counting test
/// `the_composed_machine_needs_more_symbols_than_its_rules_name` above, which checks symbol counts but
/// never runs the machine — this is the live gate.
#[test]
fn the_composed_machine_runs() {
    const CAPS: Caps = Caps { steps: 2_000_000_000, cells: DEFAULT_CAPS.cells };
    let src = "3 - 5";
    let (m, inits) = build_machine(src, EncodingKind::Unary);
    assert_eq!(layout_collision(&m, &inits), None, "a data symbol collides with stage 1's layout");
    assert_eq!(
        Code::new(&m, &[]),
        Code::new(&m, &inits),
        "a raw machine's rules already name every symbol its own inits carry"
    );
    let single = to_single_tape(&m);
    let cells = vec![interleave(&inits, m.tapes, PAD, PAD)];
    assert_ne!(
        Code::new(&single, &[]),
        Code::new(&single, &cells),
        "interleave's markers reach the composed image's alphabet only through inits"
    );
    let (want, got) = assert_two_symbol_agrees(&format!("{src} (composed)"), &single, &cells, CAPS);
    println!("{src:40} single-tape {want:>12}  composed {got:>14}  ratio {:.2}x", got as f64 / want as f64);
}

/// The roadmap's actual point: "polynomial slowdown is normally a hand-wave; here step counts are
/// exact integers". **`k` IS NAMED IN EVERY ROW**, because a blowup quoted without the block width
/// it was measured at is not a property of the reduction — the same trap stage 1's cost table fell
/// into with its padding constant, where a raw ratio spanning 4.98× across three programs was
/// measuring `PAD` rather than the construction.
///
/// **THE PREDICTION THIS TABLE TESTS:** unlike stage 1, this reduction is LOCAL — a head moves at
/// most `k` cells to read, `k` back to rewind and `k` to move — so the per-step cost should be `O(k)`
/// and INDEPENDENT of tape length, where stage 1's every step sweeps the whole tape. If that holds,
/// the ratio column is near-constant across programs of very different tape lengths.
///
/// **WHAT THIS TABLE SHOWS, AND WHAT IT DOES NOT.** Every row shares the SAME `k`, so the `ratio/k`
/// column divides its rows by one constant and CANNOT demonstrate that the cost scales with the block
/// width. What it does demonstrate is the property this reduction was predicted to have: the blowup
/// is independent of TAPE LENGTH, because a head never leaves a `k`-cell neighbourhood. The corpus's
/// source step counts differ by orders of magnitude and the raw ratio barely moves — which is what
/// the single-tape reduction, sweeping its whole tape on every step, could not do.
#[test]
#[ignore = "slow tier: run via cargo nextest run -p redextape-core --test two_symbol_oracle --run-ignored all"]
fn the_two_symbol_cost_table() {
    const CAPS: Caps = Caps { steps: 400_000_000, cells: DEFAULT_CAPS.cells };
    let mut bits_seen: Vec<usize> = Vec::new();
    for src in ["1 + 2 * 3", "let x = 40; x + 2", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"] {
        for enc in [EncodingKind::Unary, EncodingKind::Binary] {
            let (m, inits) = build_machine(src, enc);
            let code = Code::new(&m, &inits);
            bits_seen.push(code.bits());
            let (want, got) = assert_two_symbol_agrees(&format!("{src} ({enc:?})"), &m, &inits, CAPS);
            let ratio = got as f64 / want as f64;
            println!(
                "{src:60} {enc:>6?}  k {}  source {want:>10}  two-symbol {got:>12}  ratio {ratio:>7.2}x  ratio/k {:>6.2}",
                code.bits(),
                ratio / code.bits() as f64
            );
        }
    }
    assert!(
        bits_seen.iter().all(|&b| b == bits_seen[0]),
        "the doc above's claim that this table's ratio/k column CANNOT demonstrate cost scaling with k \
         holds only because every row shares the same k; that premise just broke: {bits_seen:?}"
    );
}
