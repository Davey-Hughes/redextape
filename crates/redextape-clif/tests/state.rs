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
use cranelift_codegen::ir::{ExternalName, Function, Inst, InstructionData, Opcode};
use redextape_clif::{ClifAt, ClifEnd, ClifState, ClifValue, ClifWindow, Stepper};
use redextape_core::tm::{Caps, DEFAULT_CAPS, Program};
use redextape_core::trace::{RxmCap, WordTag};
use redextape_core::viewmodel::{RxmBox, RxmCell, RxmWord};
use redextape_native::{Listing, RtFn, build_listing};

const LISTINGS: [Listing; 2] = [Listing::AsBuilt, Listing::Optimised];
const WINDOW: ClifWindow = ClifWindow { values: 64, frames: 8, cells: 16, boxes: 16 };
// Cuts the corpus's runs reach, so that cutting is tested.
const NARROW: ClifWindow = ClifWindow { values: 2, frames: 2, cells: 16, boxes: 16 };
// A window no run's values reach, so its `values` are every value the running frame has set.
const EVERY: ClifWindow = ClifWindow { values: usize::MAX, ..WINDOW };
const FACT: &str = include_str!("../../../web/src/examples/fact.rxt");
const FACT_12: &str = include_str!("../../../web/src/examples/fact-12.rxt");
const IS_EVEN: &str = include_str!("../../../web/src/examples/is-even.rxt");
const SUM_TO: &str = include_str!("../../../web/src/examples/sum-to.rxt");

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

/// The value main's `return` at `at` names, read from the listing, its aliases followed, and whether
/// the operand was an alias.
fn return_operand(funcs: &[Function], at: ClifAt) -> (u32, bool) {
    assert_eq!(at.function, 0, "the run ended outside main");
    let main = &funcs[0];
    let inst = Inst::from_u32(at.inst);
    assert_eq!(main.dfg.insts[inst].opcode(), Opcode::Return, "{inst} is not a return");
    let operand = main.dfg.inst_args(inst)[0];
    let resolved = main.dfg.resolve_aliases(operand);
    (resolved.as_u32(), resolved != operand)
}

/// Checks `state`, a `Ran` end's frame cut to `window` values, against `set`, every value the frame has
/// set: `values` holds the returned value's row, ascends and fits the window, and where the first `window`
/// set values miss the returned one, it is the first `window - 1` and then its row. True when they missed it.
fn assert_the_window_holds_the_returned_value(set: &[ClifValue], state: &ClifState, window: usize, at: &str) -> bool {
    let returned = state.returned.unwrap_or_else(|| panic!("{at}: no returned value"));
    let row = set.iter().find(|v| v.value == returned).unwrap_or_else(|| panic!("{at}: v{returned} is not set"));
    let numbers: Vec<u32> = state.values.iter().map(|v| v.value).collect();
    assert!(numbers.contains(&returned), "{at}: v{returned} is not in {numbers:?}");
    assert!(numbers.windows(2).all(|w| w[0] < w[1]), "{at}: {numbers:?}");
    assert!(state.values.len() <= window, "{at}: {numbers:?}");
    let first = &set[..set.len().min(window)];
    let missed = !first.contains(row);
    if missed {
        assert_eq!(state.values[..window - 1], first[..window - 1], "{at}");
        assert_eq!(state.values.last(), Some(row), "{at}");
    } else {
        assert_eq!(state.values[..], first[..], "{at}");
    }
    missed
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

/// A callee that faults returns to its caller, which runs on to its next guard, so the caller's `cons` or
/// box runs after the fault. The runtime then returns 0 without allocating, a plain number, as a read in
/// the same state is. Every case's word is read in both listings before one assertion holds them all, so a
/// failure shows each case and listing that fails rather than stopping at the first.
#[test]
fn a_cons_or_box_after_a_fault_is_a_plain_number() {
    let cases = [
        ("fn f(x) { head(nil) } cons(f(0), nil)", RtFn::Cons),
        ("fn f(x) { head(nil) } let mut v = f(0); let get = |x| v; get(0)", RtFn::Box),
    ];
    let mut made = Vec::new();
    for (src, import) in cases {
        for listing in LISTINGS {
            let name = format!("{src} {}", listing.name());
            let funcs = build(src, listing);
            let mut stepper = Stepper::new(&funcs, DEFAULT_CAPS);
            stepper.run(u64::MAX);
            assert!(matches!(stepper.status(), Some(ClifEnd::Fault { .. })), "{name}: {:?}", stepper.status());
            let state = stepper.state(WINDOW);
            assert_eq!((state.heap_len, state.box_len), (0, 0), "{name}: nothing was allocated");
            let value = result_of_call(&funcs[0], import);
            let word = state.values.into_iter().find(|v| v.value == value).map(|v| v.word);
            made.push((name, word));
        }
    }
    let plain: Vec<_> = made.iter().map(|(name, _)| (name.clone(), Some(RxmWord::of(0, WordTag::Value)))).collect();
    assert_eq!(made, plain);
}

/// The heap cap refuses a `cons` or box before the call sets its value, so the run pauses at the call
/// with that value unset. `Stepper::raise_caps` clears the runtime's stop, and the call runs again on the
/// next step; the run has not stopped then, so the word it makes is a list or box, not the plain 0 a
/// stopped run makes. Every case's word is read in both listings before one assertion holds them all.
#[test]
fn a_cons_or_box_repeated_after_a_heap_pause_is_a_list_or_box() {
    let cases = [
        ("fn f(x) { x } cons(f(0), nil)", RtFn::Cons, RxmWord::of(1, WordTag::List)),
        ("fn f(x) { x } let mut v = f(0); let get = |x| v; get(0)", RtFn::Box, RxmWord::of(1, WordTag::Box)),
    ];
    let no_heap = Caps { heap: 0, ..DEFAULT_CAPS };
    let mut made = Vec::new();
    let mut want = Vec::new();
    for (src, import, word) in cases {
        for listing in LISTINGS {
            let name = format!("{src} {}", listing.name());
            let funcs = build(src, listing);
            let value = result_of_call(&funcs[0], import);
            let mut stepper = Stepper::new(&funcs, no_heap);
            stepper.run(u64::MAX);
            assert_eq!(stepper.status(), Some(&ClifEnd::Capped(RxmCap::Heap)), "{name}");
            let unset = stepper.state(WINDOW).values.iter().all(|v| v.value != value);
            assert!(unset, "{name}: the refused call set v{value}");
            stepper.raise_caps(DEFAULT_CAPS);
            assert!(stepper.step(), "{name}: the repeat ended the run with {:?}", stepper.status());
            let state = stepper.state(WINDOW);
            made.push((name.clone(), state.values.into_iter().find(|v| v.value == value).map(|v| v.word)));
            want.push((name, Some(word.clone())));
        }
    }
    assert_eq!(made, want);
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
                if matches!(stepper.status(), Some(ClifEnd::Ran(_))) {
                    let set = stepper.state(EVERY).values;
                    assert_the_window_holds_the_returned_value(&set, &narrow, NARROW.values, &at);
                } else {
                    assert_eq!(narrow.values[..], state.values[..state.values_len.min(NARROW.values)], "{at}");
                }
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

/// At a `Ran` end `returned` is the value main's `return` names, through its aliases, and `values` holds
/// it with the run's result; before the end, and at a `Fault` end, there is none.
#[test]
fn the_returned_value_is_main_s_return_operand_with_aliases_followed() {
    let runs = [
        (SUM_TO, RxmWord::of(15, WordTag::Value)),
        (FACT_12, RxmWord::of(479_001_600, WordTag::Value)),
        (IS_EVEN, RxmWord::of(1, WordTag::Value)),
        ("[1, 2]", RxmWord::of(2, WordTag::List)),
    ];
    let mut aliased = 0;
    for (src, word) in runs {
        for listing in LISTINGS {
            let name = format!("{} {}", src.lines().last().unwrap(), listing.name());
            let funcs = build(src, listing);
            let mut stepper = Stepper::new(&funcs, DEFAULT_CAPS);
            while stepper.status().is_none() {
                assert_eq!(stepper.state(WINDOW).returned, None, "{name} step {}", stepper.steps_taken());
                stepper.step();
            }
            assert!(matches!(stepper.status(), Some(ClifEnd::Ran(_))), "{name}: {:?}", stepper.status());
            let state = stepper.state(WINDOW);
            let (operand, alias) = return_operand(&funcs, state.at);
            aliased += usize::from(alias);
            assert_eq!(state.returned, Some(operand), "{name}");
            let row = state.values.iter().find(|v| v.value == operand);
            assert_eq!(row.map(|v| &v.word), Some(&word), "{name}: {:?}", state.values);
        }
    }
    // Without a run that returns an alias this case would pass without `resolve_aliases`: sum_to(5) as built
    // returns `v9`, an alias of `v8`.
    assert!(aliased > 0, "no run returned an alias");
    assert_eq!(ran(SUM_TO, Listing::AsBuilt).returned, Some(8));

    for listing in LISTINGS {
        let funcs = build("head([])", listing);
        let mut stepper = Stepper::new(&funcs, DEFAULT_CAPS);
        stepper.run(u64::MAX);
        let name = format!("head([]) {}", listing.name());
        assert!(matches!(stepper.status(), Some(ClifEnd::Fault { .. })), "{name}: {:?}", stepper.status());
        assert_eq!(stepper.state(WINDOW).returned, None, "{name}");
    }
}

/// At a `Ran` end the values window holds the returned value however few values it shows, and the cells
/// hold the cell a returned list points at.
#[test]
fn the_values_window_holds_the_returned_value() {
    let mut programs: Vec<(String, Program)> = vec![("[1, 2]".to_string(), program_of("[1, 2]", "[1, 2]"))];
    programs.extend(corpus().into_iter().filter(|(key, _)| !key.starts_with("measure-")));
    let (mut missed, mut lists) = (0, 0);
    for (key, prog) in programs {
        for listing in LISTINGS {
            let funcs = build_listing(&prog, listing).unwrap();
            let mut stepper = Stepper::new(&funcs, DEFAULT_CAPS);
            stepper.run(u64::MAX);
            let Some(ClifEnd::Ran(outcome)) = stepper.status() else { continue };
            let result = outcome.result;
            let set = stepper.state(EVERY).values;
            for window in [NARROW, WINDOW] {
                let at = format!("{key} {} under {} values", listing.name(), window.values);
                let state = stepper.state(window);
                let missed_here = assert_the_window_holds_the_returned_value(&set, &state, window.values, &at);
                missed += usize::from(missed_here && window.values == NARROW.values);
            }
            // With no newest cells the window's cells are only those its words point at.
            let state = stepper.state(ClifWindow { cells: 0, ..NARROW });
            let returned = state.values.iter().find(|v| Some(v.value) == state.returned).unwrap();
            if returned.word.tag == WordTag::List && result != 0 {
                let cells: Vec<u64> = state.cells.iter().map(|c| c.cell as u64).collect();
                assert!(cells.contains(&result), "{key} {}: #{result} not in {cells:?}", listing.name());
                lists += usize::from(!set[..set.len().min(NARROW.values)].contains(returned));
            }
        }
    }
    // Without a returned value past the first two, and a list's past them, this case would pass on a window that
    // never moved the returned row.
    assert!(missed > 0, "every returned value was among the first {}", NARROW.values);
    assert!(lists > 0, "no run returned a list past the first {} values", NARROW.values);
}
