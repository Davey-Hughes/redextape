//! The fourth oracle leg: `reference == λ == multitape-TM == singletape-TM`. The multi-tape legs are
//! `three_way_oracle.rs`'s subject; this file adds the fourth and asserts it against the third by
//! TAPE IDENTITY rather than by decoded value, which is strictly stronger and needs no second decode
//! path that could drift.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::machine::{Machine, Symbol};
use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, simulate_final};
use redextape_core::tm::single_tape::{
    OVERFLOW, deinterleave, interleave, layout_collision, normalize, to_single_tape,
};
use redextape_core::tm::{EncodingKind, TM_DEFAULT_CAPS, TmRun, run_tm_described};
use redextape_core::ty::Ty;
use redextape_core::typeck::result_type;

/// Padding blocks on each side, measured against this corpus rather than guessed: `0` overflows,
/// `1` suffices for every program below, and `2` is `1` plus one block of margin. Because a head that
/// leaves the skeleton halts in `OVERFLOW` (asserted against below), an insufficient pad fails loudly
/// and names itself rather than silently truncating the tape.
///
/// This constant is not free to change without also changing what a step count measured against it
/// means: every simulated step sweeps the whole skeleton, so absolute single-tape step counts scale
/// with the TOTAL number of blocks, padding included. A blowup factor quoted without the pad it was
/// measured at is not a property of the reduction.
const PAD: usize = 2;

fn core_and_ty(src: &str) -> (Core, Ty) {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
    let prog = prog.expect("a program");
    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
    (desugar(&prog), ty)
}

/// The multi-tape machine and the initial tapes it runs on. Unary because the reduction is
/// indifferent to the encoding and unary is the cheaper of the two to build.
fn build_machine(src: &str) -> (Machine, Vec<Vec<Symbol>>) {
    let (core, ty) = core_and_ty(src);
    let d = run_tm_described(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS)
        .unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
    assert!(matches!(d.run, TmRun::Ran { .. }), "the multi-tape run must complete for {src:?}");
    let init = d.header.init(d.machine.tapes);
    (d.machine, init)
}

fn assert_single_tape_agrees(src: &str) {
    assert_single_tape_agrees_capped(src, DEFAULT_CAPS);
}

/// The same check as `assert_single_tape_agrees`, but over a caller-chosen `Caps`. Split out for
/// `the_single_tape_cost_table`: its corpus needs far more than `DEFAULT_CAPS`'s 5,000,000 steps
/// (`sum(5)` alone measures 303,610,850 single-tape steps below), and raising `DEFAULT_CAPS` itself
/// would loosen every other test in this file that relies on a runaway construction hitting its cap
/// quickly.
fn assert_single_tape_agrees_capped(src: &str, caps: Caps) {
    let (m, inits) = build_machine(src);
    // THE LAYOUT'S OWN SYMBOLS MUST NOT APPEAR IN THE DATA, and `to_single_tape`'s own refusal cannot
    // see the whole question: it reads `Machine::alphabet()`, which collects only the symbols the
    // RULES mention, so a colliding symbol living solely in an initial tape is invisible to it and
    // reproduces the corruption that refusal exists to prevent. `layout_collision` takes both.
    assert_eq!(layout_collision(&m, &inits), None, "a data symbol collides with the layout for {src:?}");
    let (want, _want_state, want_status, want_steps) = simulate_final(&m, &inits, caps);
    assert_eq!(want_status, Status::Halted, "the multi-tape run must halt for {src:?}");

    let single = to_single_tape(&m);
    let cells = interleave(&inits, m.tapes, PAD, PAD);
    let (got, got_state, got_status, got_steps) = simulate_final(&single, &[cells], caps);
    assert_eq!(got_status, Status::Halted, "the single-tape run hit a cap for {src:?}");
    assert_ne!(
        single.states[got_state as usize].name, OVERFLOW,
        "a head left the {PAD}-block skeleton for {src:?}; raise PAD"
    );
    // NOT just "it halted": a stuck state halts too and reports the same `Status`. `single_tape.rs`'s
    // `Names::entry_name` names this exact failure mode — the difference is visible only in the final
    // state's name, so assert the machine reached the state that stands for the original's ACCEPT.
    assert!(
        single.states[got_state as usize].accept,
        "halted in {}, not an accept state, for {src:?}",
        single.states[got_state as usize].name
    );

    let out = deinterleave(&got[0], m.tapes).expect("the reduced tape stays well formed");
    for (i, tape) in want.iter().enumerate() {
        let (w_cells, w_head) = tape.snapshot();
        assert_eq!(normalize(&out[i].0, out[i].1), normalize(&w_cells, w_head), "tape {i} differs for {src:?}");
    }
    assert!(got_steps > want_steps, "the reduction should cost more steps, not fewer");
}

/// Every member here MUST be a member of `native_oracle.rs`'s `FIRST_ORDER_DEMOS`
/// (`crates/redextape-native/tests/native_oracle.rs`), which is what this file's own doc claims a
/// fourth leg onto: that array's `four_way_oracle_on_the_first_order_suite_unary` already asserts
/// `reference == λ == multitape-TM == native` for every one of its entries, so a program drawn from
/// it gets `reference == λ == multitape-TM` for free and this test only has to add the fourth
/// equality, `== singletape-TM`. A program NOT in that array (the corpus used to be `"1 + 2"` and
/// `"[1, 2]"`, neither a member) gets no such thing: this leg would then establish only
/// `multitape-TM == singletape-TM`, not the four-way chain the module doc claims.
#[test]
fn the_single_tape_leg_agrees_on_small_programs() {
    for src in ["3 - 5", "if 2 > 1 { 10 } else { 20 }", "cons(1, cons(2, nil))"] {
        assert_single_tape_agrees(src);
    }
}

/// δ-steps for the same program on both machines, plus the block count the single-tape run sweeps on
/// EVERY step. The multi/single ratio is the reduction's raw cost, but `the_single_tape_cost_table`'s
/// doc comment is why that ratio alone is not comparable across runs: dividing it by `blocks` (which
/// counts padding too) is what survives a change to `PAD`.
fn step_counts(src: &str, caps: Caps) -> (u64, u64, usize) {
    let (m, inits) = build_machine(src);
    let (_want, _ws, _wstatus, multi) = simulate_final(&m, &inits, caps);
    let single_m = to_single_tape(&m);
    let cells = interleave(&inits, m.tapes, PAD, PAD);
    // Blocks bracketed by the two sentinels, `2 * m.tapes` cells apiece — the same arithmetic
    // `single_tape.rs`'s `deinterleave` uses to walk this same region back into per-tape chunks.
    let blocks = (cells.len() - 2) / (2 * m.tapes);
    let (_got, _gs, _gstatus, single) = simulate_final(&single_m, &[cells], caps);
    (multi, single, blocks)
}

/// The roadmap's actual point: "polynomial slowdown is normally a hand-wave; here step counts are
/// exact integers". This prints multi-tape steps against single-tape steps per program, so the
/// quadratic is a measured table rather than an adjective.
///
/// **THE `ratio` COLUMN IS PAD-DEPENDENT, NOT A PROPERTY OF THE REDUCTION BY ITSELF.** Every
/// simulated single-tape step sweeps the WHOLE block skeleton — both sentinels, every tape's marker,
/// every content cell, padding included — so growing `PAD` grows `ratio` for free: Task 6's review
/// measured `1 + 2` at 795,199 single-tape steps at `PAD = 64` against 88,339 at `PAD = 1`, a ~9x
/// spread produced entirely by a constant nobody meant to be measuring. `steps per multi-tape step
/// per block` divides that padding back out (by dividing by `blocks`, which counts the padding too),
/// and is the figure that is reproducible across a different `PAD`; `ratio`, `PAD` and `blocks` are
/// printed alongside it only so the run that produced `ratio` is fully named, not because `ratio`
/// itself generalizes.
#[test]
#[ignore = "slow tier: sum(5) alone costs ~300 million single-tape steps; run via cargo nextest run \
            -p redextape-core --test single_tape_oracle --run-ignored all"]
fn the_single_tape_cost_table() {
    // `sim::DEFAULT_CAPS` (5,000,000 steps) is nowhere near enough for this corpus — measured below,
    // `sum(5)` alone takes 303,610,850 single-tape steps — so `steps` is raised explicitly here,
    // rather than by editing `DEFAULT_CAPS`, which every other test in this file still relies on
    // staying small enough to catch a runaway construction quickly. `cells` stays at `DEFAULT_CAPS`'s
    // 5,000,000: the widest interleaved tape this corpus builds is a few thousand cells, so it is the
    // step count, not the tape length, that this corpus is expensive in.
    const CAPS: Caps = Caps { steps: 400_000_000, cells: DEFAULT_CAPS.cells };
    println!("PAD = {PAD} (see this test's doc: `ratio` is pad-dependent, the last column is not)");
    for src in ["1 + 2 * 3", "let x = 40; x + 2", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"] {
        let (multi, single, blocks) = step_counts(src, CAPS);
        let ratio = single as f64 / multi as f64;
        let per_block = ratio / blocks as f64;
        println!(
            "{src:60} multi {multi:>10}  single {single:>12}  ratio {ratio:>8.1}x  PAD {PAD}  blocks {blocks:>4}  steps/multi-step/block {per_block:.3}"
        );
        assert_single_tape_agrees_capped(src, CAPS);
    }
}
