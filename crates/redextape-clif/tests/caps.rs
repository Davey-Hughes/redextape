// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
//! Caps that pause a run: a pause stands at the call a cap refused, a call whose frame would take the
//! run's frames past `caps.mem` is refused before it pushes, and a paused run continued under raised caps
//! ends where a fresh run under those caps does.

// Each test target uses its own part of the shared helpers.
#[allow(dead_code)]
mod common;

use common::{FRAME_MEMORY_LIST, TIGHT, agrees, corpus, program_of, short};
use cranelift_codegen::ir::{ExternalName, Function, Inst, InstructionData};
use redextape_clif::{ClifAt, ClifEnd, ClifWindow, FRAME_BYTES_PER_VALUE, Stepper};
use redextape_core::tm::{Caps, DEFAULT_CAPS, Program};
use redextape_core::trace::RxmCap;
use redextape_native::{Listing, OptLevel, RtFn, build_listing, jit};

const LISTINGS: [Listing; 2] = [Listing::AsBuilt, Listing::Optimised];
/// `TIGHT` with its steps, stack and heap caps doubled.
const DOUBLE: Caps = Caps { steps: 80, stack: 12, heap: 8, mem: DEFAULT_CAPS.mem };
const WINDOW: ClifWindow = ClifWindow { values: 64, frames: 8, cells: 16, boxes: 16 };
const FACT: &str = include_str!("../../../web/src/examples/fact.rxt");
/// Per listing, the least `caps.mem` `fact.rxt` runs under, which its five `fact` frames fill, and the
/// steps it takes.
const FACT_RUNS: [(Listing, u64, u64); 2] = [(Listing::AsBuilt, 6930, 189), (Listing::Optimised, 7260, 131)];
/// Programs `TIGHT` pauses at each runtime cap with both the steps and the depth count non-zero, so that an
/// undo of a count other than the refused call's own shows. None of the corpus's pauses has both: its steps
/// pause is in main, and its stack and heap pauses come before any tick.
const BOTH_COUNTS: [(&str, &str, RxmCap); 3] = [
    ("spin", "fn spin(n) { let mut i = 0; while i < n { i = i + 1; } i } spin(100)", RxmCap::Steps),
    (
        "down",
        "fn down(n) { let mut i = 0; while i < 2 { i = i + 1; } if n == 0 { 0 } else { down(n - 1) } } down(100)",
        RxmCap::Stack,
    ),
    (
        "build",
        "fn build(n) { let mut i = 0; let mut xs = nil; while i < n { xs = cons(i, xs); i = i + 1; } xs } build(10)",
        RxmCap::Heap,
    ),
];

/// What a run's runtime holds: its caps as `(steps, stack, heap, mem)` and its depth cap, its steps and
/// depth counts, its cells and boxes, and its stops.
type Held = ((u64, u64, u64, u64), u64, u64, u64, usize, usize, bool, Option<String>);

/// What `stepper`'s runtime holds.
fn held(stepper: &Stepper<'_>) -> Held {
    let rt = stepper.runtime();
    let caps = (rt.caps.steps, rt.caps.stack, rt.caps.heap, rt.caps.mem);
    let heap = rt.heap();
    (caps, rt.depth_cap, rt.steps, rt.depth, heap.cells().len(), heap.boxes().len(), rt.hit_cap, rt.fault.clone())
}

/// The corpus programs `TIGHT` pauses as built: 14, which `agreement.rs` names by cap.
fn paused_at_tight() -> Vec<(String, Program)> {
    let paused: Vec<(String, Program)> = corpus()
        .into_iter()
        .filter(|(_, prog)| {
            let funcs = build_listing(prog, Listing::AsBuilt).unwrap();
            let mut stepper = Stepper::new(&funcs, TIGHT);
            stepper.run(u64::MAX);
            matches!(stepper.status(), Some(ClifEnd::Capped(_)))
        })
        .collect();
    assert_eq!(paused.len(), 14, "the programs TIGHT pauses");
    paused
}

/// `funcs` run under `caps` until it ends, which must be a pause: the stepper, standing at it.
fn pause<'f>(funcs: &'f [Function], caps: Caps, name: &str) -> Stepper<'f> {
    let mut stepper = Stepper::new(funcs, caps);
    stepper.run(u64::MAX);
    assert!(matches!(stepper.status(), Some(ClifEnd::Capped(_))), "{name}: {}", short(&stepper.status()));
    stepper
}

/// What `continue_like_fresh` saw: the cap the run paused at, what its runtime held there, and its end.
struct Continued {
    cap: RxmCap,
    at_pause: Held,
    end: ClifEnd,
    steps: u64,
}

/// `funcs` paused under `low`, then raised to `high` and run on, beside a fresh run under `high`. Once raised,
/// the paused run stands where the fresh one stands after as many steps, its runtime holding the same, so
/// the refused call is not counted twice; run on, both end alike after as many steps.
fn continue_like_fresh(funcs: &[Function], low: Caps, high: Caps, name: &str) -> Continued {
    let mut paused = pause(funcs, low, name);
    let Some(&ClifEnd::Capped(cap)) = paused.status() else { unreachable!() };
    let at_pause = held(&paused);
    let steps = paused.steps_taken();
    paused.raise_caps(high);
    assert_eq!(paused.status(), None, "{name}: still ended once raised");
    let mut fresh = Stepper::new(funcs, high);
    assert_eq!(fresh.run(steps), steps, "{name}: the fresh run");
    assert_eq!(
        (paused.at(), held(&paused)),
        (fresh.at(), held(&fresh)),
        "{name}: raised, against a fresh run at step {steps}"
    );
    paused.run(u64::MAX);
    fresh.run(u64::MAX);
    let end = paused.status().unwrap().clone();
    assert!(
        (Some(&end), paused.steps_taken()) == (fresh.status(), fresh.steps_taken()),
        "{name}: {} after {}; fresh {} after {}",
        short(&end),
        paused.steps_taken(),
        short(&fresh.status()),
        fresh.steps_taken()
    );
    Continued { cap, at_pause, end, steps: paused.steps_taken() }
}

/// The user-name index of the function the call at `at` in `funcs` calls: an `RtFn` index for a runtime
/// import, and a subroutine's index past them.
fn callee_index(funcs: &[Function], at: ClifAt) -> u32 {
    let func = &funcs[at.function as usize];
    let InstructionData::Call { func_ref, .. } = func.dfg.insts[Inst::from_u32(at.inst)] else {
        panic!("{at:?} is no call");
    };
    let ExternalName::User(name) = func.dfg.ext_funcs[func_ref].name else {
        panic!("{at:?} calls no user function");
    };
    func.params.user_named_funcs()[name].index
}

#[test]
fn frame_bytes_per_value_is_measured() {
    assert_eq!(FRAME_BYTES_PER_VALUE, 33);
}

/// `fact.rxt`'s fifth `fact` frame fills its least `caps.mem`: a byte less refuses the call that would push
/// it, so the run stands at that call with main's and four `fact` frames.
#[test]
fn the_frame_memory_cap_stops_a_call_before_it_pushes() {
    let prog = program_of(FACT, FACT);
    for (listing, least, steps) in FACT_RUNS {
        let name = listing.name();
        let funcs = build_listing(&prog, listing).unwrap();
        let mut ran = Stepper::new(&funcs, Caps { mem: least, ..DEFAULT_CAPS });
        ran.run(u64::MAX);
        let Some(ClifEnd::Ran(outcome)) = ran.status() else { panic!("{name}: {}", short(&ran.status())) };
        assert_eq!((outcome.result, ran.steps_taken()), (24, steps), "{name}");
        let mut stopped = Stepper::new(&funcs, Caps { mem: least - 1, ..DEFAULT_CAPS });
        stopped.run(u64::MAX);
        assert_eq!(stopped.status(), Some(&ClifEnd::Capped(RxmCap::Mem)), "{name}");
        assert_eq!(stopped.state(WINDOW).depth, 5, "{name}");
        assert_eq!(callee_index(&funcs, stopped.at()), 12, "{name}: the call of fact, u0:12");
        assert!(!stopped.step(), "{name}: a step at the pause");
    }
}

/// A returned call's frame no longer counts: two `fact` chains, one after the other, run under the least
/// `caps.mem` one chain runs under, and stop a byte below it.
#[test]
fn a_returned_frame_no_longer_counts() {
    let src = FACT.replace("\nfact(4)", "\nfact(4) + fact(4)");
    let prog = program_of(&src, &src);
    for (listing, least, _) in FACT_RUNS {
        let name = listing.name();
        let funcs = build_listing(&prog, listing).unwrap();
        let mut ran = Stepper::new(&funcs, Caps { mem: least, ..DEFAULT_CAPS });
        ran.run(u64::MAX);
        let Some(ClifEnd::Ran(outcome)) = ran.status() else { panic!("{name}: {}", short(&ran.status())) };
        assert_eq!(outcome.result, 48, "{name}");
        let mut stopped = Stepper::new(&funcs, Caps { mem: least - 1, ..DEFAULT_CAPS });
        stopped.run(u64::MAX);
        assert_eq!(stopped.status(), Some(&ClifEnd::Capped(RxmCap::Mem)), "{name}");
    }
}

/// Away from a pause a raise installs the caps and nothing else: a run that has ended stays ended, and a
/// run raised before a cap stops it goes on as a fresh run under the raised caps.
#[test]
fn raising_caps_elsewhere_changes_only_the_caps() {
    let corpus = corpus();
    let program = |key: &str| corpus.iter().find(|(k, _)| k == key).unwrap().1.clone();
    for key in ["example-fact", "fault-00"] {
        let prog = program(key);
        for listing in LISTINGS {
            let name = format!("{key} {}", listing.name());
            let funcs = build_listing(&prog, listing).unwrap();
            let mut stepper = Stepper::new(&funcs, DEFAULT_CAPS);
            stepper.run(u64::MAX);
            let (end, steps) = (stepper.status().cloned(), stepper.steps_taken());
            assert!(matches!(end, Some(ClifEnd::Ran(_) | ClifEnd::Fault { .. })), "{name}: {}", short(&end));
            stepper.raise_caps(DOUBLE);
            assert_eq!(stepper.status(), end.as_ref(), "{name}");
            assert!(!stepper.step(), "{name}: a step after the end");
            assert_eq!(stepper.steps_taken(), steps, "{name}");
            assert_eq!(held(&stepper).0, (DOUBLE.steps, DOUBLE.stack, DOUBLE.heap, DOUBLE.mem), "{name}");
        }
    }
    let prog = program("measure-loop1000000");
    for listing in LISTINGS {
        let funcs = build_listing(&prog, listing).unwrap();
        let mut raised = Stepper::new(&funcs, TIGHT);
        assert_eq!(raised.run(100), 100);
        raised.raise_caps(DOUBLE);
        raised.run(u64::MAX);
        let mut fresh = Stepper::new(&funcs, DOUBLE);
        fresh.run(u64::MAX);
        assert_eq!(fresh.status(), Some(&ClifEnd::Capped(RxmCap::Steps)), "{}", listing.name());
        assert_eq!(
            (raised.status(), raised.steps_taken()),
            (fresh.status(), fresh.steps_taken()),
            "{}",
            listing.name()
        );
    }
}

/// Each runtime cap's pause stands at a call of the import that cap refuses.
#[test]
fn a_pause_stands_at_the_call_that_tripped() {
    let mut steps_capped = Vec::new();
    for (key, prog) in paused_at_tight() {
        for listing in LISTINGS {
            let name = format!("{key} {}", listing.name());
            let funcs = build_listing(&prog, listing).unwrap();
            let stepper = pause(&funcs, TIGHT, &name);
            let refusing: &[RtFn] = match stepper.status() {
                Some(ClifEnd::Capped(RxmCap::Steps)) => {
                    steps_capped.push(name.clone());
                    &[RtFn::Tick]
                }
                Some(ClifEnd::Capped(RxmCap::Stack)) => &[RtFn::Enter],
                Some(ClifEnd::Capped(RxmCap::Heap)) => &[RtFn::Cons, RtFn::Box],
                other => panic!("{name}: {other:?}"),
            };
            let callee = callee_index(&funcs, stepper.at());
            assert!(refusing.iter().any(|&import| import as u32 == callee), "{name}: calls u0:{callee}");
        }
    }
    assert_eq!(steps_capped, ["measure-loop1000000 as-built", "measure-loop1000000 optimised"]);
    assert_eq!(RtFn::Tick as u32, 7);
}

#[test]
fn continuing_from_a_pause_reaches_where_a_fresh_run_does() {
    for (key, prog) in paused_at_tight() {
        for listing in LISTINGS {
            let funcs = build_listing(&prog, listing).unwrap();
            continue_like_fresh(&funcs, TIGHT, DOUBLE, &format!("{key} {}", listing.name()));
        }
    }
    let prog = program_of(FACT, FACT);
    for (listing, least, steps) in FACT_RUNS {
        let funcs = build_listing(&prog, listing).unwrap();
        let low = Caps { mem: least - 1, ..DEFAULT_CAPS };
        let name = format!("fact.rxt {}", listing.name());
        let continued = continue_like_fresh(&funcs, low, Caps { mem: least, ..DEFAULT_CAPS }, &name);
        assert_eq!(continued.cap, RxmCap::Mem, "{}", listing.name());
        assert!(matches!(continued.end, ClifEnd::Ran(_)), "{}: {}", listing.name(), short(&continued.end));
        assert_eq!(continued.steps, steps, "{}", listing.name());
    }
}

/// A raise undoes the refused call's own count and no other: each runtime cap's pause here holds both the
/// steps and the depth count, which `continue_like_fresh` checks against a fresh run.
#[test]
fn continuing_undoes_only_the_refused_calls_count() {
    for (key, src, cap) in BOTH_COUNTS {
        let prog = program_of(key, src);
        for listing in LISTINGS {
            let name = format!("{key} {}", listing.name());
            let continued = continue_like_fresh(&build_listing(&prog, listing).unwrap(), TIGHT, DOUBLE, &name);
            assert_eq!(continued.cap, cap, "{name}");
            let (_, _, steps, depth, ..) = continued.at_pause;
            assert!(steps > 0 && depth > 0, "{name}: steps {steps}, depth {depth} at the pause");
        }
    }
}

#[test]
#[ignore = "slow tier: runs the measure programs on from a pause to their default-caps end; run via scripts/check-slow.sh"]
fn continuing_from_tight_caps_reaches_the_jits_default_end() {
    for (key, prog) in paused_at_tight() {
        let jit = jit::compile_and_run(&prog, DEFAULT_CAPS, OptLevel::O0);
        for listing in LISTINGS {
            let name = format!("{key} {}", listing.name());
            let funcs = build_listing(&prog, listing).unwrap();
            let mut stepper = pause(&funcs, TIGHT, &name);
            stepper.raise_caps(DEFAULT_CAPS);
            stepper.run(u64::MAX);
            let end = stepper.status().unwrap();
            if FRAME_MEMORY_LIST.contains(&key.as_str()) {
                assert_eq!(end, &ClifEnd::Capped(RxmCap::Mem), "{name}");
            } else {
                assert!(agrees(end, &jit), "{name}: {}; the JIT {}", short(end), short(&jit));
            }
        }
    }
}
