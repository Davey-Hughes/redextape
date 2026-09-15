//! The counter-machine leg of the oracle.
//!
//! Each corpus program's stage 1 image is compiled to a three-counter program and run accelerated. It must
//! halt in the state the Turing machine simulator halts in, leave the tape the simulator leaves, and read
//! back to the value the reference interpreter computes.
//!
//! Programs small enough to run literally are held to more: the lowered machines of `1` and `1 + 1`,
//! compiled to eleven counters, must agree literal against accelerated at every macro entry, and the
//! accelerated run must halt in the state, leave the tapes, and empty the scratch counter the same way the
//! Turing machine simulator does. No stage 1 image is small enough — `3 - 5`'s stands for about 10^380
//! literal steps.
//!
//! **THE TIERS ARE MEASURED.** A test is in the fast tier when it ran in under 1 s in the debug build `cargo nextest`
//! runs, timed on its own, and in the slow tier otherwise; every slow-tier test ran in under 60 s in the release
//! build `scripts/check-slow.sh` runs.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use redextape_core::counter::accel::{Caps, End, check_literal_agreement, run_accelerated};
use redextape_core::counter::compile::{compile, scratch};
use redextape_core::counter::nat::{Divisor, Nat};
use redextape_core::counter::program::{Macro, Program, move_steps};
use redextape_core::counter::readback;
use redextape_core::tm::sim::{Caps as TmCaps, Status, simulate_final};
use redextape_core::tm::single_tape::{interleave, layout_collision, normalize, to_single_tape};
use redextape_core::tm::{EncodingKind, TM_DEFAULT_CAPS, TmRun, run_tm_described};

mod common;
use common::{build_machine, core_and_ty};

/// The oracles' padding blocks on each side of a stage 1 image.
const PAD: usize = 2;
const CAPS: Caps = Caps { macros: 2_000_000_000, bits: 1 << 22 };
const TM_CAPS: TmCaps = TmCaps { steps: 2_000_000_000, cells: 50_000_000 };

/// Run `src`'s stage 1 image as a counter program and hold it to the simulator and the reference.
fn agrees_at_stage_one(src: &str) {
    let (core, ty) = core_and_ty(src);
    // `interp::eval` is this project's reference interpreter for the mini-language `Core` AST built above from
    // a fixed corpus — not a dynamic or untrusted code-execution primitive.
    let reference = redextape_core::interp::eval(&core).unwrap_or_else(|e| panic!("reference failed for {src}: {e:?}"));
    let d = run_tm_described(&core, EncodingKind::Unary, ty.clone(), TM_DEFAULT_CAPS)
        .unwrap_or_else(|e| panic!("{src}: {e:?}"));
    assert!(matches!(d.run, TmRun::Ran { .. }), "{src}: the lowered machine must complete");
    let inits = d.header.init(d.machine.tapes);
    assert_eq!(layout_collision(&d.machine, &inits), None, "{src}");
    let single = to_single_tape(&d.machine);
    let cells = vec![interleave(&inits, d.machine.tapes, PAD, PAD)];
    let (want, want_state, status, _) = simulate_final(&single, &cells, TM_CAPS);
    assert_eq!(status, Status::Halted, "{src}: the stage 1 image must halt");

    let c = compile(&single, &cells).unwrap_or_else(|e| panic!("{src}: {e:?}"));
    let run = run_accelerated(&c.program, c.counters, CAPS).unwrap();
    let End::Stopped { at } = run.end else { panic!("{src}: {:?}", run.end) };
    let Macro::Stop { state, head } = &c.program.macros[at] else { panic!("{src}: stopped on a non-Stop") };
    assert_eq!(*state, want_state, "{src}: halting state");
    assert!(run.counters[scratch(1)].is_zero(), "{src}: scratch must be empty at a Stop");

    let tapes = readback::tapes(&run.counters, head, &c.symbols).unwrap();
    let (cells_want, head_want) = want[0].snapshot();
    assert_eq!(normalize(&tapes[0].0, tapes[0].1), normalize(&cells_want, head_want), "{src}: tape");
    let value = readback::value(&tapes[0].0, d.machine.tapes, &ty, &*d.header.encoding());
    assert_eq!(value, Some(reference), "{src}: value");
    println!(
        "{src}: {} moves, largest counter {} bits, about 2^{} literal steps computed",
        run.macros,
        run.largest_bits,
        run.steps.bits()
    );
}

#[test]
fn three_minus_five_runs_as_a_counter_machine() {
    agrees_at_stage_one("3 - 5");
}

#[test]
fn a_conditional_runs_as_a_counter_machine() {
    agrees_at_stage_one("if 2 > 1 { 10 } else { 20 }");
}

#[test]
fn a_list_runs_as_a_counter_machine() {
    agrees_at_stage_one("cons(1, cons(2, nil))");
}

#[test]
fn arithmetic_runs_as_a_counter_machine() {
    agrees_at_stage_one("1 + 2 * 3");
}

#[test]
#[ignore = "slow tier: over 1 s in a debug build when this leg was planned; run via scripts/check-slow.sh"]
fn a_call_runs_as_a_counter_machine() {
    agrees_at_stage_one("fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))");
}

#[test]
#[ignore = "slow tier: over 1 s in a debug build when this leg was planned; run via scripts/check-slow.sh"]
fn a_binding_runs_as_a_counter_machine() {
    agrees_at_stage_one("let x = 40; x + 2");
}

#[test]
#[ignore = "slow tier: over 1 s in a debug build when this leg was planned; run via scripts/check-slow.sh"]
fn recursion_runs_as_a_counter_machine() {
    agrees_at_stage_one("fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)");
}

/// Compile `src`'s lowered machine, and require its literal expansion and its accelerated run to agree as
/// `check_literal_agreement` defines agreeing: on where they stop, the steps, the counters and the trace of
/// macro entries. Also require of the accelerated run what the Turing machine simulator does: the same
/// halting state, the same tapes, and an empty scratch counter. Returns the literal step count.
fn literal_and_accelerated_agree(src: &str) -> u64 {
    let (m, inits) = build_machine(src, EncodingKind::Unary);
    let c = compile(&m, &inits).unwrap_or_else(|e| panic!("{src}: {e:?}"));
    let (run, steps) =
        check_literal_agreement(&c.program, &c.counters, CAPS, 2_000_000_000).unwrap_or_else(|e| panic!("{src}: {e}"));

    let (want, want_state, status, _) = simulate_final(&m, &inits, TM_CAPS);
    assert_eq!(status, Status::Halted, "{src}: the lowered machine must halt");
    let End::Stopped { at } = run.end else { panic!("{src}: {:?}", run.end) };
    let Macro::Stop { state, head } = &c.program.macros[at] else { panic!("{src}: stopped on a non-Stop") };
    assert_eq!(*state, want_state, "{src}: halting state");
    assert!(run.counters[scratch(m.tapes)].is_zero(), "{src}: scratch must be empty at a Stop");

    let tapes = readback::tapes(&run.counters, head, &c.symbols).unwrap();
    assert_eq!(tapes.len(), want.len(), "{src}: tape count");
    for (i, ((cells, h), tape)) in tapes.iter().zip(&want).enumerate() {
        let (wc, wh) = tape.snapshot();
        assert_eq!(normalize(cells, *h), normalize(&wc, wh), "{src}: tape {i}");
    }
    steps
}

#[test]
fn a_lowered_literal_agrees_literally() {
    let steps = literal_and_accelerated_agree("1");
    println!("1 lowered: {steps} literal steps");
}

#[test]
#[ignore = "slow tier: over 1 s in a debug build when this leg was planned; run via scripts/check-slow.sh"]
fn a_lowered_sum_agrees_literally() {
    let steps = literal_and_accelerated_agree("1 + 1");
    println!("1 + 1 lowered: {steps} literal steps");
}

/// Compile `src`'s stage 1 image, as `agrees_at_stage_one` does, and return its program and its initial
/// counters.
fn stage_one_program(src: &str) -> (Program, Vec<Nat>) {
    let (core, ty) = core_and_ty(src);
    let d =
        run_tm_described(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS).unwrap_or_else(|e| panic!("{src}: {e:?}"));
    assert!(matches!(d.run, TmRun::Ran { .. }), "{src}: the lowered machine must complete");
    let inits = d.header.init(d.machine.tapes);
    let single = to_single_tape(&d.machine);
    let cells = vec![interleave(&inits, d.machine.tapes, PAD, PAD)];
    let c = compile(&single, &cells).unwrap_or_else(|e| panic!("{src}: {e:?}"));
    (c.program, c.counters)
}

/// Replay `p`'s macros from `counters`, tallying literal steps by `move_steps` alone, over plain `Nat`
/// counters holding their full value at every step — no digit buffering, no `Buffers` code. Returns where it
/// stopped, the steps, and the counters.
fn unbuffered_run(p: &Program, mut counters: Vec<Nat>) -> (End, Nat, Vec<Nat>) {
    let by_base = Divisor::new(p.base).unwrap_or_else(|| panic!("bad base {}", p.base));
    let mut pc = p.start;
    let mut steps = Nat::zero();
    let end = loop {
        let Macro::Move { push, pop, s, exits } = &p.macros[pc] else {
            break if matches!(p.macros[pc], Macro::Spin) { End::Spun { at: pc } } else { End::Stopped { at: pc } };
        };
        let mut popped = std::mem::take(&mut counters[*pop]);
        let digit = popped.div_rem(&by_base);
        let mut pushed = std::mem::take(&mut counters[*push]);
        steps.add(&move_steps(p.base, *s, &pushed, &popped, digit).unwrap_or_else(|| panic!("base {}", p.base)));
        pushed.mul_add(p.base, *s);
        counters[*push] = pushed;
        counters[*pop] = popped;
        pc = exits[usize::try_from(digit).unwrap_or_else(|_| panic!("digit {digit} not a usize"))];
    };
    (end, steps, counters)
}

/// **THE COST IS MEASURED.** An independent reference for the four fast stage 1 images the oracle runs above:
/// replay the compiled program's macros with `unbuffered_run` — plain `Nat` counters and `move_steps` alone,
/// no `Buffers` code — and require it to agree with the accelerated (buffered) run on the steps, the
/// counters, and the macro each stops in. **THIS RAN SLOWER THAN PLANNED.** A whole-branch review's probe of
/// the same check ran in about 1.78 s wall in a debug build; this one ran in about 5.2 s in this workspace's
/// unoptimized dev profile (`cargo nextest`, timed on its own), over this file's 1 s bound, so it is in the slow
/// tier. The two largest images dominate — `if`'s at
/// 1.5M moves up to 2855 bits and `1 + 2 * 3`'s at 1.6M moves up to 1956 bits — because unbuffered `Nat`
/// arithmetic is O(moves · bits), which buffering exists to avoid. If a future change makes it slower still,
/// say so here.
#[test]
#[ignore = "slow tier: about 5.2 s in a debug build, timed on its own; run via scripts/check-slow.sh"]
fn an_unbuffered_tally_matches_the_buffered_run_on_fast_stage_one_images() {
    for src in ["3 - 5", "if 2 > 1 { 10 } else { 20 }", "cons(1, cons(2, nil))", "1 + 2 * 3"] {
        let (program, counters) = stage_one_program(src);
        let fast = run_accelerated(&program, counters.clone(), CAPS).unwrap_or_else(|e| panic!("{src}: {e:?}"));
        let (end, steps, plain_counters) = unbuffered_run(&program, counters);
        assert_eq!(end, fast.end, "{src}: stop macro");
        assert_eq!(steps, fast.steps, "{src}: steps");
        assert_eq!(plain_counters, fast.counters, "{src}: counters");
    }
}
