// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
//! The frame a view reads from a CLIF run: the running frame's values with their tags and registers, the
//! call stack top first, and the heap the shown values reach.

// Each test target uses its own part of the shared helpers.
#[allow(dead_code)]
mod common;

use common::{TIGHT, corpus, program_of};
use cranelift_codegen::ir::{ExternalName, Function, Inst, InstructionData};
use redextape_clif::{ClifAt, ClifEnd, ClifState, ClifWindow, Stepper};
use redextape_core::tm::DEFAULT_CAPS;
use redextape_core::trace::WordTag;
use redextape_core::viewmodel::{RxmBox, RxmCell, RxmWord};
use redextape_native::{Listing, RtFn, build_listing};

const LISTINGS: [Listing; 2] = [Listing::AsBuilt, Listing::Optimised];
const WINDOW: ClifWindow = ClifWindow { values: 64, frames: 8, cells: 16, boxes: 16 };
// Cuts the corpus's runs reach, so that cutting is tested.
const NARROW: ClifWindow = ClifWindow { values: 2, frames: 2, cells: 16, boxes: 16 };
const FACT: &str = include_str!("../../../web/src/examples/fact.rxt");

/// `src`, a λ program, built as `listing`.
fn build(src: &str, listing: Listing) -> Vec<Function> {
    build_listing(&program_of(src, src), listing).unwrap()
}

/// The result of the one call `func` makes to runtime import `import`.
fn result_of_call(func: &Function, import: RtFn) -> u32 {
    let calls: Vec<_> = func
        .layout
        .blocks()
        .flat_map(|block| func.layout.block_insts(block))
        .filter(|&inst| match func.dfg.insts[inst] {
            InstructionData::Call { func_ref, .. } => match func.dfg.ext_funcs[func_ref].name {
                ExternalName::User(name) => func.params.user_named_funcs()[name].index == import as u32,
                _ => false,
            },
            _ => false,
        })
        .collect();
    assert_eq!(calls.len(), 1, "{} calls {import:?} {} times", func.name, calls.len());
    func.dfg.inst_results(calls[0])[0].as_u32()
}

/// `src` built as `listing` and run to its end, which must be `Ran`: the state there.
fn ran(src: &str, listing: Listing) -> ClifState {
    let funcs = build(src, listing);
    let mut stepper = Stepper::new(&funcs, DEFAULT_CAPS);
    stepper.run(u64::MAX);
    assert!(matches!(stepper.status(), Some(ClifEnd::Ran(_))), "{src} {}: {:?}", listing.name(), stepper.status());
    stepper.state(WINDOW)
}

/// `stepper`'s state after steps until `until` holds of it; fails if the run ends first.
fn step_until(stepper: &mut Stepper<'_>, until: impl Fn(&ClifState) -> bool) -> ClifState {
    loop {
        let state = stepper.state(WINDOW);
        if until(&state) {
            return state;
        }
        assert!(stepper.step(), "the run ended at step {} with {:?}", state.step, stepper.status());
    }
}

#[test]
fn tags_follow_the_runtime_calls() {
    for listing in LISTINGS {
        let src = "head(cons(cons(7, nil), nil))";
        let funcs = build(src, listing);
        let state = ran(src, listing);
        let cells = [
            RxmCell { cell: 2, head: RxmWord::of(1, WordTag::List), tail: RxmWord::of(0, WordTag::Value) },
            RxmCell { cell: 1, head: RxmWord::of(7, WordTag::Value), tail: RxmWord::of(0, WordTag::Value) },
        ];
        assert_eq!(state.cells, cells, "{}", listing.name());
        // The inner `cons` returns a list word 1 as well, so the `rt_head` result is named by its value.
        let head = result_of_call(&funcs[0], RtFn::Head);
        let read = state.values.iter().find(|v| v.value == head);
        assert_eq!(read.map(|v| &v.word), Some(&RxmWord::of(1, WordTag::List)), "{}", listing.name());
    }
}

#[test]
fn tags_cross_block_parameters() {
    let src = "let xs = if 1 == 1 { cons(7, nil) } else { nil }; head(cons(xs, nil))";
    let cells = ran(src, Listing::AsBuilt).cells;
    let cell = cells.iter().find(|c| c.cell == 2).unwrap();
    assert_eq!(cell.head, RxmWord::of(1, WordTag::List));
}

#[test]
fn a_tail_takes_the_tag_its_cell_stores() {
    for listing in LISTINGS {
        let src = "tail(cons(1, cons(7, nil)))";
        let funcs = build(src, listing);
        let state = ran(src, listing);
        let tail = result_of_call(&funcs[0], RtFn::Tail);
        let read = state.values.iter().find(|v| v.value == tail);
        assert_eq!(read.map(|v| &v.word), Some(&RxmWord::of(1, WordTag::List)), "{}", listing.name());
    }
}

/// `make`'s list reaches `main` through its call's result, and `wrap` through its parameter.
#[test]
fn tags_cross_calls() {
    for listing in LISTINGS {
        let state = ran("fn wrap(xs) { cons(xs, nil) } fn make(n) { cons(n, nil) } wrap(make(7))", listing);
        assert_eq!(state.heap_len, 2, "{}", listing.name());
        let wrapped = RxmCell { cell: 2, head: RxmWord::of(1, WordTag::List), tail: RxmWord::of(0, WordTag::Value) };
        assert_eq!(state.cells.first(), Some(&wrapped), "{}", listing.name());
    }
}

/// The closure's capture boxes `v`: the box stores the list's tag, `v = ..` replaces it, a read returns it,
/// and the handle is a box word.
#[test]
fn tags_follow_boxes() {
    let cases = [
        ("let mut v = cons(7, nil); let get = |x| v; cons(get(0), nil)", 1),
        ("let mut v = cons(7, nil); let get = |x| v; v = cons(8, nil); cons(get(0), nil)", 4),
    ];
    for (src, list) in cases {
        for listing in LISTINGS {
            let state = ran(src, listing);
            let name = format!("{src} {}", listing.name());
            assert_eq!(state.box_len, 1, "{name}");
            assert_eq!(state.boxes, [RxmBox { handle: 1, content: RxmWord::of(list, WordTag::List) }], "{name}");
            assert!(state.values.iter().any(|v| v.word == RxmWord::of(1, WordTag::Box)), "{name}: {:?}", state.values);
            // The newest cell is the program's `cons(get(0), nil)`.
            assert_eq!(state.cells.first().map(|c| &c.head), Some(&RxmWord::of(list, WordTag::List)), "{name}");
        }
    }
}

#[test]
fn frames_read_top_first() {
    let funcs = build(FACT, Listing::AsBuilt);
    let mut stepper = Stepper::new(&funcs, DEFAULT_CAPS);
    let state = step_until(&mut stepper, |state| state.depth == 3);
    assert_eq!(state.frames.len(), 3);
    assert_eq!(state.frames[0], state.at);
    assert_eq!(state.frames[1].function, 1);
    assert_eq!(state.frames[2].function, 0);
}

#[test]
fn values_carry_their_registers() {
    let funcs = build(FACT, Listing::AsBuilt);
    let mut stepper = Stepper::new(&funcs, DEFAULT_CAPS);
    let start = stepper.state(WINDOW);
    let main = &funcs[0];
    let entry = main.layout.entry_block().unwrap();
    let first = main.layout.first_inst(entry).unwrap();
    assert_eq!(start.at, ClifAt { function: 0, inst: first.as_u32() });
    assert_eq!(start.next, Some(start.at));
    let params: Vec<u32> = main.dfg.block_params(entry).iter().map(|v| v.as_u32()).collect();
    assert_eq!(start.values.iter().map(|v| v.value).collect::<Vec<_>>(), params, "main's one parameter");
    assert_eq!(start.values_len, 1);

    let state = step_until(&mut stepper, |state| state.at.function == 1);
    assert!(state.values.iter().any(|v| v.regs.iter().any(|r| r == "a0") && v.word.word == "4"), "{:?}", state.values);
}

/// Every step's state builds without reading a value the run has not set, which `Frame::get` would panic
/// on, and is cut to the window.
#[test]
fn the_state_reads_only_set_values_at_every_step() {
    for (key, prog) in corpus().into_iter().filter(|(key, _)| !key.starts_with("measure-")) {
        for listing in LISTINGS {
            let funcs = build_listing(&prog, listing).unwrap();
            let mut stepper = Stepper::new(&funcs, TIGHT);
            let name = format!("{key} {}", listing.name());
            loop {
                let state = stepper.state(WINDOW);
                let at = format!("{name} step {}", state.step);
                assert_eq!(state.step, stepper.steps_taken(), "{at}");
                let numbers: Vec<u32> = state.values.iter().map(|v| v.value).collect();
                assert!(numbers.windows(2).all(|w| w[0] < w[1]), "{at}: {numbers:?}");
                assert!(state.values.len() <= WINDOW.values.min(state.values_len), "{at}");
                assert_eq!(state.frames.len(), state.depth.min(WINDOW.frames), "{at}");
                let func = &funcs[state.at.function as usize];
                let loc = func.srcloc(Inst::from_u32(state.at.inst));
                assert_eq!(state.pc, (!loc.is_default()).then(|| loc.bits()), "{at}");
                let narrow = stepper.state(NARROW);
                assert_eq!(narrow.values_len, state.values_len, "{at}");
                assert_eq!(narrow.values[..], state.values[..state.values_len.min(NARROW.values)], "{at}");
                assert_eq!(narrow.frames[..], state.frames[..state.depth.min(NARROW.frames)], "{at}");
                if !stepper.step() {
                    break;
                }
                assert_eq!(state.next, Some(state.at), "{at}: the run went on");
            }
            let state = stepper.state(WINDOW);
            let next = match stepper.status() {
                Some(ClifEnd::Capped(_)) => Some(state.at),
                _ => None,
            };
            assert_eq!(state.next, next, "{name}: {:?}", stepper.status());
        }
    }
}
