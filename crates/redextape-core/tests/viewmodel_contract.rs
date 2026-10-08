//! The data contract PR 3 renders. These are properties of the builders, not of any renderer.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use redextape_core::core::BinOp;
use redextape_core::lambda::reduce::MAX_TERM_DEPTH;
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::asm::{Instr, Program, Reg, print_instr};
use redextape_core::trace::{AsmCursor, AsmStatus, WordTag};
use redextape_core::viewmodel::{AsmProgram, AsmState, AsmWindow, AsmWord, LambdaState, LinkIndex, TmProgram, TmState};

/// Counts bytes requested through the global allocator, so a test can measure what a call actually
/// allocates instead of timing it. Scoped to this one integration test binary: each file under
/// `tests/` is its own crate and its own process image, and cargo-nextest — this repository's
/// FAST-TIER runner (`scripts/check-all.sh`) — gives every test its own OS process, so under nextest
/// `BYTES_ALLOCATED` never mixes bookkeeping across tests.
///
/// NOT TRUE OF EVERY RUNNER THIS REPOSITORY USES, THOUGH: CI's `rust-slow` job runs
/// `scripts/check-slow.sh`, which drives `cargo test --release --workspace`, sharing one process
/// across every non-`#[ignore]`d test in this binary at default thread parallelism. This test is not
/// `#[ignore]`d, so `check-slow.sh --all` would run it alongside others in that shared process; it
/// escapes today only because the bare `check-slow.sh` invocation (no `--all`) passes `--ignored`,
/// filtering it out. The allocation assertion below is therefore a BOUND, not an exact-equality
/// delta: a concurrent allocation landing inside the measurement window can only push `bytes_large`
/// up, and the margin between what the fix allocates (~12 bytes) and the 4KiB bound is wide enough to
/// absorb that, so the assertion no longer depends on which runner drives it.
struct CountingAlloc;

static BYTES_ALLOCATED: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for CountingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        BYTES_ALLOCATED.fetch_add(layout.size(), Ordering::SeqCst);
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: CountingAlloc = CountingAlloc;

#[test]
fn the_byte_budget_is_honoured_and_truncation_is_reported_exactly() {
    let (term, _map) = lambda_fixture(&big_list_program());
    let mut cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);

    let generous = LambdaState::render(&cursor, usize::MAX, MAX_TERM_DEPTH);
    assert!(generous.cut.is_none());

    let tight = LambdaState::render(&cursor, 64, MAX_TERM_DEPTH);
    assert!(tight.cut.is_some(), "a 64-byte budget must fire on a term printing {} bytes", generous.text.len());
    assert!(tight.text.len() < generous.text.len());
    assert!(tight.spans.iter().all(|(s, _)| s.end <= tight.text.len()), "spans must stay in the text");

    cursor.next();
    let stepped = LambdaState::render(&cursor, usize::MAX, MAX_TERM_DEPTH);
    assert_eq!(stepped.step, 1, "step must track the cursor");
}

/// `LambdaState` no longer has a `source_node` field, so this is not a test of that field — it is a
/// test of the underlying fact that made it unshippable: `SourceMap::node_to_lambda` records paths
/// root-relative into the INITIAL lowered term, but a `Beta` event's redex path at step N indexes the
/// term BEFORE step N — a structurally different tree once N > 1, since normal-order reduction
/// contracts root redexes. `owning_node` (deleted) never surfaced this because it compared `redex`
/// against recorded paths as plain `Vec<Dir>` prefixes, never checking whether `redex` was walkable in
/// any real term at all — so this test checks that directly instead, against the initial term itself.
///
/// STEPS 2 AND 3 ARE NOT ENOUGH TO SHOW THIS, ON THIS FIXTURE. Their redex paths are short (length 1
/// and 0) and happen to still walk into the initial term by coincidence — a short path is a valid walk
/// into almost any term with that much `App`/`Abs` structure near its root, regardless of whether it
/// means anything. Checked by instrumenting a scratch build of this cursor against this exact fixture:
/// step 4's redex path (length 3) is the first one where the walk provably fails, which is the property
/// this test needs — not "eventually diverges" but "is not, in general, a coordinate into the map's
/// term."
#[test]
fn a_later_steps_redex_path_is_not_a_coordinate_into_the_initial_term() {
    // `term` is the initial lowered term -- exactly what `SourceMap::node_to_lambda` (returned
    // alongside it by `lambda_fixture`, built from the same `core`) records its paths against.
    // `LambdaCursor::new` only borrows it, so it stays in scope as that fixed coordinate space to
    // check every redex path against, even once the cursor itself has stepped past it.
    let (term, _map) = lambda_fixture("let x = 40; x + 2");
    let mut cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);

    let Some(redextape_core::trace::StepEvent::Beta { redex: first_redex, .. }) = cursor.next() else {
        panic!("this program takes at least one beta step");
    };
    assert!(walk(&term, &first_redex).is_some(), "the first step's own redex must index the initial term");

    let mut redex = first_redex;
    for step in 2..=4 {
        let Some(redextape_core::trace::StepEvent::Beta { redex: next, .. }) = cursor.next() else {
            panic!("this program takes at least {step} beta steps");
        };
        redex = next;
    }
    assert!(
        walk(&term, &redex).is_none(),
        "step 4's redex path must not resolve against the initial term -- if it does, this fixture no \
         longer demonstrates the coordinate system `source_node` relied on going stale, and needs a \
         program that steps deep enough that it still does"
    );
}

/// Walks `path` into `term`, `Dir` by `Dir`, returning `None` the moment a step has nowhere to go --
/// exactly the check `owning_node` never performed, because it only ever tested path PREFIXES against
/// `redex` as plain `Vec<Dir>`s, never whether `redex` itself still lands inside a real term.
fn walk(term: &redextape_core::lambda::LambdaTerm, path: &[redextape_core::lambda::Dir]) -> Option<()> {
    use redextape_core::lambda::{Dir, Node};

    let mut cur = term;
    for dir in path {
        cur = match (dir, cur.node()) {
            (Dir::AbsBody, Node::Abs(_, body)) => body,
            (Dir::AppL, Node::App(f, _, _)) => f,
            (Dir::AppR, Node::App(_, a, _)) => a,
            _ => return None,
        };
    }
    Some(())
}

#[test]
fn the_window_is_bounded_by_its_radius_and_clamped_at_tape_ends() {
    let (machine, init) = tm_fixture("let x = 40; x + 2");
    let mut cursor = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());
    cursor.by_ref().take(50).count();

    for radius in [0usize, 1, 8] {
        let st = TmState::window(&cursor, Some(&empty_map()), radius);
        assert_eq!(st.window.len(), machine.tapes, "one window per tape");
        for w in &st.window {
            assert!(w.len() <= 2 * radius + 1, "radius {radius} yielded {} cells", w.len());
        }
        assert_eq!(st.heads.len(), machine.tapes);
    }
}

#[test]
fn the_window_costs_the_same_regardless_of_how_large_the_tape_has_grown() {
    // A one-tape machine that moves right forever, touching a new blank cell every step -- the
    // simplest way to materialize a tape of a controlled, large size without going through the
    // compiler pipeline. Mirrors `sim`'s own `spin` test fixture, which this file cannot import:
    // integration tests are separate crates and cannot see one another's `#[cfg(test)]` items.
    use redextape_core::tm::{Machine, Move, Rule, State, TmCaps};
    use redextape_core::trace::TmCursor;

    fn spin_right() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![State {
                name: "go".into(),
                accept: false,
                rules: vec![Rule { read: vec![None], write: vec![None], moves: vec![Move::R], next: 0 }],
            }],
        }
    }

    let caps = TmCaps { steps: u64::MAX, cells: u64::MAX };
    let small_machine = spin_right();
    let mut small = TmCursor::new(&small_machine, &[], caps);
    small.by_ref().take(1_000).count();
    let large_machine = spin_right();
    let mut large = TmCursor::new(&large_machine, &[], caps);
    large.by_ref().take(200_000).count();

    // The observable contract: bounded regardless of tape size. This alone does NOT prove the fix --
    // the buggy `snapshot`-based implementation this pins against also produced a correctly bounded
    // slice, just after paying to clone the whole tape first. It is a regression guard on the SHAPE of
    // the result; the allocation check below is what pins the COST.
    for cursor in [&small, &large] {
        let st = TmState::window(cursor, Some(&empty_map()), 2);
        assert_eq!(st.window.len(), 1, "one window per tape");
        for w in &st.window {
            assert!(w.len() <= 5, "radius 2 must yield at most 5 cells, got {}", w.len());
        }
    }
    // Confirms the fixture really did materialize the claimed tape sizes -- via `snapshot`, the one
    // place in this test allowed to pay its O(tape) cost, since here it exists only to corroborate the
    // fixture rather than to be the thing under test.
    assert!(small.tapes()[0].snapshot().0.len() >= 1_000, "fixture did not materialize the claimed tape");
    assert!(large.tapes()[0].snapshot().0.len() >= 200_000, "fixture did not materialize the claimed tape");

    // What the length check above cannot distinguish: O(radius) allocation vs. O(tape) allocation that
    // happens to still slice down to a bounded result. Measured directly through `CountingAlloc` (this
    // binary's `#[global_allocator]`, declared near the top of this file) rather than by timing --
    // this repository has recorded enough measurement mistakes already that a wall-clock assertion in
    // a test would be another one.
    // Built BEFORE the first reading, not inside either window: whatever `SourceMap::default()` costs
    // is not what this test measures, and charging it to `bytes_small` alone would make the two
    // readings answer different questions.
    let map = empty_map();

    let before_small = BYTES_ALLOCATED.load(Ordering::SeqCst);
    let _ = TmState::window(&small, Some(&map), 2);
    let bytes_small = BYTES_ALLOCATED.load(Ordering::SeqCst) - before_small;

    let before_large = BYTES_ALLOCATED.load(Ordering::SeqCst);
    let _ = TmState::window(&large, Some(&map), 2);
    let bytes_large = BYTES_ALLOCATED.load(Ordering::SeqCst) - before_large;

    // A bound, not `assert_eq!(bytes_small, bytes_large)`: `BYTES_ALLOCATED` is a process-wide
    // `AtomicUsize`, and under a runner that shares this binary's process across threads (see the
    // `#[global_allocator]` doc above), a concurrent test's allocation landing inside this window
    // would be charged to `bytes_large` and break an exact-equality delta without this test's own
    // behaviour having changed at all. A bound has the same discriminating power against the bug this
    // pins -- the pre-fix `snapshot`-based path allocated ~800,000 bytes here (200,000 cells * 4,
    // since `Symbol = char`) against the fix's ~12 -- with roughly 66,000x of margin to spare.
    assert!(
        bytes_large < 4096,
        "sanity bound: a radius-2, one-tape window should allocate well under 4KiB regardless of how \
         large the tape behind it has grown, got {bytes_large}"
    );
    assert!(
        bytes_small < 4096,
        "sanity bound: a radius-2, one-tape window should allocate well under 4KiB, got {bytes_small}"
    );
}

#[test]
fn tm_program_projects_the_machine_and_agrees_with_its_alphabet() {
    let (machine, _) = tm_fixture("let x = 40; x + 2");
    let p = TmProgram::of(&machine, 64, None);
    assert_eq!(p.states.len(), machine.states.len());
    assert_eq!(p.tapes, machine.tapes);
    assert_eq!(p.width, 64);
    assert_eq!(p.alphabet, machine.alphabet(), "the projection must not re-derive the alphabet");
}

/// `tapeSlice(tape, from, to)` needs a public operation in the coordinate space `TmState` defines.
/// Before this, the only public accessor was `Tape::snapshot`, whose O(tape) clone is exactly what
/// `TmState::window` was changed to stop paying — a scrolling renderer calling it per drag would
/// reintroduce the cost one layer out.
#[test]
fn a_tape_can_be_sliced_in_the_same_coordinates_the_window_reports() {
    let (machine, init) = tm_fixture("let x = 40; x + 2");
    let mut c = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());
    c.by_ref().take(50).count();

    let st = TmState::window(&c, Some(&empty_map()), 4);
    let tape0 = &c.tapes()[0];

    // The window is the slice its own coordinates name.
    let via_slice = tape0.slice(st.window_start[0], st.window_start[0] + st.window[0].len());
    assert_eq!(via_slice, st.window[0], "slice and window must agree in the same space");

    // The head sits where the window says.
    assert_eq!(tape0.head_index(), st.heads[0], "head_index is the coordinate window_start counts from");

    // A slice spanning the whole tape agrees with `snapshot`, the one other materialization. This is
    // what catches a missed reversal on the `right` stack: a window of radius 4 around a head sitting
    // near a tape end can be short enough on one side that a transposition still produces the same
    // cells, whereas the full extent cannot.
    let (whole, head) = tape0.snapshot();
    assert_eq!(tape0.slice(0, usize::MAX), whole, "a slice of everything is the snapshot");
    assert_eq!(head, tape0.head_index(), "snapshot and head_index count in the same space");

    // Every sub-range of a bounded band AROUND THE HEAD agrees with the same sub-range of `snapshot`,
    // which pins the mapping cell by cell rather than only at the ends: `slice` has a distinct arm for
    // the `left` stack, the head, and the (reversed) `right` stack, and a band straddling the head is
    // what makes ranges that hit one arm, two, or all three all occur. Bounded rather than exhaustive
    // over the whole tape because this fixture's REG bank is thousands of cells and the check is
    // quadratic — 41 cells is enough to cover every arm and every boundary between them.
    let lo = head.saturating_sub(20);
    let hi = (head + 21).min(whole.len());
    for from in lo..hi {
        for to in from..=hi {
            assert_eq!(tape0.slice(from, to), whole[from..to], "slice({from}, {to}) must match the snapshot");
        }
    }

    // Out-of-range is clamped, not a panic.
    assert!(tape0.slice(0, usize::MAX).len() >= st.window[0].len());
    assert!(tape0.slice(usize::MAX, usize::MAX).is_empty(), "a start past the end yields nothing");
    assert!(tape0.slice(5, 2).is_empty(), "an inverted range yields nothing rather than panicking");
}

/// `tmProgram()` is where a renderer learns the machine's shape, and the entry state is part of it.
#[test]
fn tm_program_reports_the_machines_start_state() {
    let (machine, _) = tm_fixture("let x = 40; x + 2");
    let p = TmProgram::of(&machine, 64, None);
    assert_eq!(p.start, machine.start);
    assert!(p.states.get(p.start as usize).is_some(), "the entry state must name a state that exists");
}

/// §6.2's dual-focus highlight needs the Core node the current TM state came from. The map resolves
/// it by the state's printed NAME, which is why `window` needs the map — `tm_owner` takes a name.
#[test]
fn tm_state_resolves_its_source_node_through_the_map() {
    let (program, core, map, machine, init) = tm_fixture_with_map("let x = 40; x + 2");
    let _ = (&program, &core);
    let mut c = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());

    let mut saw_some = false;
    for _ in 0..200 {
        let st = TmState::window(&c, Some(&map), 2);
        if st.source_node.is_some() {
            saw_some = true;
            break;
        }
        if c.next().is_none() {
            break;
        }
    }
    assert!(saw_some, "at least one visited state should belong to a Core node");

    // A map with no TM leg resolves nothing — the map says nothing where the lowering said nothing.
    let mut c2 = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());
    c2.by_ref().take(10).count();
    assert_eq!(TmState::window(&c2, Some(&empty_map()), 2).source_node, None);
}

/// **`window` TAKES `Option<&SourceMap>`, AND `None` MUST DECIDE `source_node` AND NOTHING ELSE.** 5d-i
/// §3.1: a `TmScratch` is a machine typed straight into a pane, never lowered from a Core, so it has no
/// map to pass — but it renders from this same function every frame, and everything else the frame
/// carries (the window, the heads, the rule about to fire) is a fact about the machine that a missing
/// map has no business touching.
///
/// **THE WHOLE STRUCT IS ASSERTED, NOT JUST `source_node`.** That is what makes this discriminating
/// rather than a smoke test: the alternative §3.1 rejected — a second `window_unmapped` constructor —
/// would duplicate the window/heads/rule computation, and the failure mode of a duplicate is the two
/// copies drifting on one of those fields while `source_node` still looks right. Struct-update syntax
/// is used so the equality covers fields this test does not know the names of; a field added to
/// `TmState` later is covered the day it is added.
///
/// THE FIXTURE IS STEPPED TO A STATE THAT ACTUALLY RESOLVES, and the `is_some` assertion is
/// load-bearing: against a state with no owner both arms answer `None` and the test would pass while
/// proving nothing — the same trap `tm_state_resolves_its_source_node_through_the_map` above steps past.
#[test]
fn an_absent_map_zeroes_the_source_node_and_leaves_every_other_field_alone() {
    let (_program, _core, map, machine, init) = tm_fixture_with_map("let x = 40; x + 2");
    let mut c = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());

    let mut steps = 0;
    while TmState::window(&c, Some(&map), 3).source_node.is_none() {
        assert!(c.next().is_some(), "the fixture halted before reaching an owned state");
        steps += 1;
        assert!(steps < 200, "no owned state within 200 steps; the fixture no longer discriminates");
    }

    let mapped = TmState::window(&c, Some(&map), 3);
    let unmapped = TmState::window(&c, None, 3);

    assert!(mapped.source_node.is_some(), "the loop above exited on an owned state, or it proves nothing");
    assert_eq!(unmapped.source_node, None, "no map, no owner — and no fallback to a nearby state");
    assert_eq!(
        unmapped,
        TmState { source_node: None, ..mapped.clone() },
        "the map decides `source_node` and nothing else: {mapped:?} vs {unmapped:?}"
    );
}

/// §10.4's stated outcome: the view models serialize and round-trip. Feature-gated, because serde is
/// optional and default-off — this test does not exist in a default build.
#[cfg(feature = "serde")]
#[test]
fn every_view_model_round_trips_through_json() {
    let (term, _map) = lambda_fixture("let x = 40; x + 2");
    let cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);
    let ls = LambdaState::render(&cursor, usize::MAX, MAX_TERM_DEPTH);
    let back: LambdaState = serde_json::from_str(&serde_json::to_string(&ls).expect("serialize")).expect("deserialize");
    assert_eq!(ls, back);

    let (machine, init) = tm_fixture("let x = 40; x + 2");
    let p = TmProgram::of(&machine, 64, None);
    let back: TmProgram = serde_json::from_str(&serde_json::to_string(&p).expect("serialize")).expect("deserialize");
    assert_eq!(p, back);

    let mut c = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());
    c.by_ref().take(20).count();
    let ts = TmState::window(&c, Some(&empty_map()), 8);
    let back: TmState = serde_json::from_str(&serde_json::to_string(&ts).expect("serialize")).expect("deserialize");
    assert_eq!(ts, back);
}

/// **A TM FRAME PUTS EACH TAPE'S WINDOW ON THE WIRE AS ONE STRING, AND READS ONE BACK AS CELLS.** The web app records a
/// TM leg a frame a step, and `window` as an array of one-character strings a tape was most of what a frame cost to
/// build in the worker and to copy across to the page. The Rust type keeps a cell a `Symbol`; only what serde writes
/// changes.
///
/// A SYMBOL OUTSIDE THE BASIC PLANE, ON PURPOSE: `𝟙` is one `char` and two UTF-16 units, so a reader that indexed the
/// string by unit would find two cells where the tape has one. The text form accepts it (`symbol_representable`), so a
/// copy's machine can write it.
#[cfg(feature = "serde")]
#[test]
fn a_tm_frame_puts_each_tapes_window_on_the_wire_as_one_string() {
    let (machine, ds) =
        redextape_core::tm::parse_tm("tapes 2\nstart s\n\nstate s:\n  [_ *] -> write [𝟙 *], move [R S], goto s\n");
    assert!(ds.is_empty(), "the fixture parses: {ds:?}");
    let machine = machine.expect("a machine");
    let mut c = redextape_core::trace::TmCursor::new(&machine, &[vec![], vec!['a', 'b']], tm_caps());
    c.by_ref().take(3).count();
    let ts = TmState::window(&c, None, 4);
    assert_eq!(ts.window[0], vec!['𝟙', '𝟙', '𝟙', '_'], "precondition: three marks written and the head past them");

    let wire = serde_json::to_value(&ts).expect("serialize");
    assert_eq!(wire["window"], serde_json::json!(["𝟙𝟙𝟙_", "ab"]));
    let back: TmState = serde_json::from_value(wire).expect("deserialize");
    assert_eq!(back, ts);
}

/// A flat 200-element list, then `head` of it — a sizeable first-order term with no recursion, big
/// enough for a byte or node budget to bite and small enough for an unreachable one not to.
///
/// NOT LITERALLY `[0..200)`: this parser has no range-literal syntax (list literals are only
/// comma-separated `[a, b, c]`), which `lambda/syntax.rs`'s `capped_printing_stops_at_the_budget_and_says_so`
/// already hit and documented for the identical shape. This builds the same program the same way.
fn big_list_program() -> String {
    let items = (0..200).map(|i| i.to_string()).collect::<Vec<_>>().join(", ");
    format!("let xs = [{items}]; head(xs)")
}

fn lambda_fixture(src: &str) -> (redextape_core::lambda::LambdaTerm, redextape_core::sourcemap::SourceMap) {
    let (program, _) = redextape_core::parser::parse(src);
    let program = program.expect("fixture parses");
    let enc = redextape_core::tm::encoding::Unary::at(64);
    let (core, map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &enc);
    (redextape_core::lambda::lower(&core).expect("fixture lowers"), map)
}

/// Mirrors `trace_equivalence.rs`'s `machine_and_init` deliberately, rather than inventing a second
/// lowering path: integration tests are separate crates and cannot import one another's helpers, so
/// this four-line body is copied, not reinvented.
fn tm_fixture(src: &str) -> (redextape_core::tm::Machine, Vec<Vec<redextape_core::tm::Symbol>>) {
    let (_, _, _, m, init) = tm_fixture_with_map(src);
    (m, init)
}

/// `tm_fixture` plus the `Program`, `Core` and `SourceMap` the same source produces.
///
/// THE MACHINE IS LOWERED FROM THE MAP'S OWN `Core`, WHICH IS WHAT MAKES THE RESOLUTION TEST A TEST.
/// `SourceMap`'s TM leg keys on the PRINTED NAME of each state in the machine `lower_tm_mapped` built
/// while the map was being built, and `tm_owner` has deliberately no fallback to a similarly-spelled
/// state. Lowering a separately-desugared `Core` here would risk a machine whose names the map has no
/// claim on, and `source_node` would then be `None` everywhere for a reason that has nothing to do
/// with the code under test. `desugar` is `desugar_mapped(..).0`, so routing the plain `tm_fixture`
/// through this one changes no existing fixture's `Core`.
fn tm_fixture_with_map(
    src: &str,
) -> (
    redextape_core::ast::Program,
    redextape_core::core::Core,
    SourceMap,
    redextape_core::tm::Machine,
    Vec<Vec<redextape_core::tm::Symbol>>,
) {
    use redextape_core::tm::{Encoding, REG, TAPES, Unary, WORK, defunc, lower_asm, lower_tm, n_slots_of};
    let (p, ds) = redextape_core::parser::parse(src);
    assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
    let program = p.expect("fixture parses");
    let enc = Unary::default();
    let (core, map) = SourceMap::build_from_program(&program, &enc);
    let prog = match lower_asm(&core) {
        Ok(p) => p,
        Err(_) => lower_asm(&defunc(&core).expect("defunc")).expect("lower"),
    };
    let m = lower_tm(&prog, &enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots_of(&prog));
    init[WORK] = enc.init_work();
    (program, core, map, m, init)
}

/// A map with no legs at all — what `TmState::window` must resolve nothing against.
fn empty_map() -> SourceMap {
    SourceMap::default()
}

/// Same default caps `trace_equivalence.rs` drives its cursor tests with.
fn tm_caps() -> redextape_core::tm::TmCaps {
    redextape_core::tm::TM_DEFAULT_CAPS
}

/// `TmState.rule` NAMES WHAT HAPPENS NEXT, and this ties it to the simulator rather than to a second
/// reading of the matcher. `window` is built AFTER a step, so its tapes and its `state` are post-step
/// and the rule it reports is the transition the following step will take.
///
/// Both directions are asserted, because only one of them is the interesting failure: `Some` must
/// predict the next state, and `None` must mean the machine is genuinely stuck. A field that answered
/// `None` everywhere would pass a one-directional test while silently disabling the whole feature.
#[test]
fn rule_names_the_transition_the_next_step_actually_takes() {
    let (machine, init) = tm_fixture("let x = 40; x + 2");
    let mut cursor = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());

    let mut checked = 0usize;
    loop {
        let before = TmState::window(&cursor, Some(&empty_map()), 2);
        match before.rule {
            Some(idx) => {
                let state = &machine.states[before.state as usize];
                let expected = state.rules[idx].next;
                // THIS ASSERTION IS SOUND ONLY BECAUSE THE FIXTURE STAYS WELL UNDER `TM_DEFAULT_CAPS`.
                // `viewmodel.rs`'s doc on `rule` is explicit that `Some` does not promise `next()` will
                // step: `TmCursor::next` checks the step/cell caps BEFORE matching a rule, so at a spent
                // cap this field can name a transition the very next call will refuse with `HitCap`
                // instead of taking. `tm_caps()` here is `TM_DEFAULT_CAPS` and this program halts in a
                // few thousand steps, nowhere near it, so that leg of the field's contract never gets a
                // chance to fire. Tightening the caps, or growing the fixture to approach them, would
                // make this `assert!` fail while `rule`'s own doc is still correct — not a regression in
                // the field, a fixture that has outgrown the bound it was implicitly relying on.
                assert!(cursor.next().is_some(), "a rule matched but the cursor would not advance");
                let after = TmState::window(&cursor, Some(&empty_map()), 2);
                assert_eq!(
                    after.state, expected,
                    "step {}: rule {idx} of `{}` says next = {expected}, machine went to {}",
                    before.step, state.name, after.state
                );
                checked += 1;
            }
            None => {
                assert!(cursor.next().is_none(), "no rule matched but the machine stepped anyway");
                break;
            }
        }
    }
    assert!(checked > 100, "fixture exercised only {checked} transitions; it must exercise the field");
}

#[test]
fn link_index_resolves_tm_owners_by_name_at_the_width_the_run_fitted() {
    // THE TRAP THIS PINS. `run_tm_described` auto-fits the width, and state NAMES depend on the width: a
    // map built at any other width resolves only the names both machines happen to share. So the map is
    // built at the width the run fitted, as `compile` builds it, and `tm_owner` is built by name — the
    // same resolution `TmState::window` performs per step. At width 4 this sample resolved 77 of its 110
    // billed states under binary; at the fitted width every one resolves.
    let src = "let x = 40; x + 2";
    let (program, diags) = redextape_core::parser::parse(src);
    let program = program.expect("the sample must parse");
    assert!(diags.is_empty(), "diagnostics: {diags:?}");
    let ty = redextape_core::typeck::result_type(&program).expect("the sample must type");
    let kind = redextape_core::tm::EncodingKind::Binary;
    let described = redextape_core::tm::run_tm_described(
        &redextape_core::desugar::desugar(&program),
        kind,
        ty,
        redextape_core::tm::TM_DEFAULT_CAPS,
    )
    .expect("the sample must lower");
    let width = described.header.width;
    assert!(width > redextape_core::tm::MIN_FIELD_WIDTH, "the run must widen, or the trap is not set");
    let (core, map) = SourceMap::build_from_program(&program, &*kind.at(width));
    let machine = std::rc::Rc::new(described.machine);
    let tm_program = TmProgram::of(&machine, width, Some(&map));

    let term = redextape_core::lambda::lower(&core).expect("the sample must lower to lambda");
    let index = LinkIndex::build(Some(&term), Some(&tm_program), &map, 65_536, MAX_TERM_DEPTH);

    assert_eq!(index.tm_owner.len(), tm_program.states.len(), "one slot per state, dense");
    let mut owned = 0;
    for (s, state) in tm_program.states.iter().enumerate() {
        let expected = map.tm_owner(&state.name).map_or(-1, |n| n as i32);
        assert_eq!(index.tm_owner[s], expected, "state {s} ({})", state.name);
        if expected >= 0 {
            owned += 1;
        }
    }
    // A first-order program has no `defunc`-minted construct, so every state its run bills to an
    // instruction has an owner. `owned > 0` alone passed with a third of them missing.
    let billed = tm_program.states.iter().filter(|s| s.instr.is_some()).count();
    assert!(billed > 100, "the sample bills {billed} states; it must bill enough to pin anything");
    assert_eq!(owned, billed, "every billed state of the sample resolves an owner");

    // The lambda leg. The sample's every source-mapped node carries a path, and the term prints well
    // inside the budget, so every one of them must have a span.
    assert!(index.lambda_cut.is_none(), "the sample must print whole at 65,536 bytes");
    assert_eq!(index.lambda_nodes.len(), map.node_to_lambda.len());
    assert_eq!(index.source_nodes.len(), map.node_to_source.len());
    for (span, id) in &index.source_nodes {
        assert_eq!(map.source_span(*id), Some(*span));
    }
}

/// The asm column carries `SourceMap::asm_owner` one slot per instruction, `-1` where there is no owner,
/// and needs neither a term nor a machine: it is built with both legs absent. `fact` owns every
/// instruction; `map` lowers through `defunc`, and 17 of its 54 instructions come from nodes `defunc`
/// minted, so the column holds `-1` for exactly those.
#[test]
fn link_index_carries_each_instructions_owner_without_a_machine() {
    let fact_src = "fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)";
    let map_src = "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
                   map([3, 1, 2], |x| x + 1)";
    for (src, unowned) in [(fact_src, 0), (map_src, 17)] {
        let (program, diags) = redextape_core::parser::parse(src);
        assert!(diags.is_empty(), "diagnostics in {src:?}: {diags:?}");
        let (_, map) = SourceMap::build_from_program(&program.expect("parsed"), &redextape_core::tm::Unary::default());
        assert!(!map.asm_owner.is_empty(), "{src:?} lowers to asm");
        let index = LinkIndex::build(None, None, &map, 65_536, MAX_TERM_DEPTH);
        let expected: Vec<i32> = map.asm_owner.iter().map(|o| o.map_or(-1, |n| n as i32)).collect();
        assert_eq!(index.asm_owner, expected, "{src:?}");
        assert_eq!(index.asm_owner.iter().filter(|o| **o == -1).count(), unowned, "{src:?}'s unowned instructions");
    }
}

#[test]
fn link_index_is_total_over_a_declined_leg() {
    // Both halves are optional and neither absence may abort. A `None` term gives empty lambda legs;
    // a `None` program gives an empty `tm_owner`. `SourceMap::build` already behaves this way over a
    // backend that declines, and the index must not be the place that stops being total.
    let map = SourceMap::default();
    let index = LinkIndex::build(None, None, &map, 65_536, MAX_TERM_DEPTH);
    assert_eq!(index.lambda_text, "");
    assert!(index.lambda_spans.is_empty());
    assert!(index.lambda_cut.is_none());
    assert!(index.lambda_nodes.is_empty());
    assert!(index.source_nodes.is_empty());
    assert!(index.tm_owner.is_empty());
    assert!(index.asm_owner.is_empty());
}

/// THE MIXED CASE THE TEST ABOVE CANNOT SEE: it only ever passes `None` for BOTH legs at once, which a
/// refactor that joined the two matches inside `LinkIndex::build` behind one shared condition (e.g.
/// "empty unless both are present") would still pass. `term` and `program` are matched independently
/// there and share no condition — this pins the lambda-only half of that independence permanently.
#[test]
fn link_index_is_total_when_only_the_lambda_leg_is_present() {
    let (term, map) = lambda_fixture("let x = 40; x + 2");
    let index = LinkIndex::build(Some(&term), None, &map, 65_536, MAX_TERM_DEPTH);
    assert!(!index.lambda_text.is_empty(), "a present term must still print, with no TM program at all");
    assert!(!index.lambda_nodes.is_empty(), "a present term must still map nodes, with no TM program at all");
    assert!(index.tm_owner.is_empty(), "no program means no owner array, not one fabricated to match");
}

/// THE OTHER HALF OF THE MIXED CASE above: a `TmProgram` with no λ term at all, standing in for a λ
/// decline over a program the TM backend still accepted.
#[test]
fn link_index_is_total_when_only_the_tm_leg_is_present() {
    let (_, _, map, machine, _) = tm_fixture_with_map("let x = 40; x + 2");
    let tm_program = TmProgram::of(&machine, 64, None);
    let index = LinkIndex::build(None, Some(&tm_program), &map, 65_536, MAX_TERM_DEPTH);
    assert_eq!(index.lambda_text, "", "no term means no lambda text, not one fabricated to match");
    assert!(index.lambda_nodes.is_empty());
    assert!(!index.tm_owner.is_empty(), "a present program must still build an owner array, with no term at all");
}

#[test]
fn a_rendered_frame_carries_the_step_that_produced_it() {
    let (program, _) = redextape_core::parser::parse("let x = 40; x + 2");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, _map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("lowers");
    let mut c = redextape_core::trace::LambdaCursor::new(&term, 1000);

    let at_zero = redextape_core::viewmodel::LambdaState::render(&c, 65536, 1000);
    assert_eq!(at_zero.step, 0);
    assert!(at_zero.redex.is_none(), "step 0 precedes any contraction");
    assert_eq!(at_zero.owner, redextape_core::lambda::reduce::Owner::None);

    c.next().expect("at least one step");
    let after = redextape_core::viewmodel::LambdaState::render(&c, 65536, 1000);
    assert_eq!(after.step, 1);
    assert!(after.redex.is_some(), "a frame after a step must name the redex it contracted");
    // Pins `render`'s owner forwarding: step 0's `Owner::None` (asserted above) is also what a
    // hardcoded `owner: Owner::None` would produce, so that assertion alone cannot tell forwarding
    // from a stub. This step's owner is `Exact(4)` on this fixture — anything but `None` — so
    // comparing against the cursor's own `last_owner()` genuinely fails under a hardcode.
    assert_eq!(after.owner, c.last_owner(), "render must forward the cursor's owner, not fabricate one");
}

/// The case `node_to_lambda` could never answer, and the reason it was deleted:
/// `viewmodel_contract.rs` already pins that all seven steps of this program reported `let x = 40;`
/// and `x + 2` was never named. At least one step must now name `x + 2`.
#[test]
fn some_step_of_the_sample_program_names_the_addition() {
    let (program, _) = redextape_core::parser::parse("let x = 40; x + 2");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("lowers");

    let plus_span = {
        let mut found = None;
        let mut c = redextape_core::trace::LambdaCursor::new(&term, 5_000);
        while c.next().is_some() {
            if let Some(id) = c.last_owner().node()
                && let Some(span) = map.source_span(id)
                && &"let x = 40; x + 2"[span.start..span.end] == "x + 2"
            {
                found = Some(span);
                break;
            }
        }
        found
    };
    assert!(plus_span.is_some(), "no step ever named `x + 2` — the defect node_to_lambda was deleted for");
}

/// Spec §8.6. A `Within` answer must name a construct that genuinely CONTAINS an `Exact` answer's,
/// or "innermost enclosing" is not what the harvest computes.
///
/// NOT THE SLICE'S CANONICAL `let x = 40; x + 2` — DELIBERATELY. That fixture has only two tagged
/// constructs (`Let` and one `BinOp`), and every `Within` answer it produces is immediately followed,
/// in the very next step, by an `Exact` answer of the SAME id — "the same descent" collapsing to a
/// same-id self-match. A prior version of this test asserted only span containment (ids ignored) and
/// still passed against that fixture with a wrong-but-real hardcoded `Owner::Within` (verified by
/// injecting `Owner::Within(4)` in place of the computed id in `reduce_step_go` and rerunning: still
/// green), because id 4 was independently a valid `Exact` answer elsewhere in the same trace. With only
/// two tagged constructs, any id the harvest could report — right or wrong — coincides with one of the
/// two `Exact` ids, so a span-only check cannot tell "the innermost enclosing tag" from "some tag that
/// happens to appear somewhere in this trace".
///
/// `let x = 1; x + (2 + 3)` nests a second `BinOp` inside the first's argument, giving three distinct
/// tagged constructs — `Let`, the outer `+`, the inner `+` — with the outer `+`'s source span strictly
/// containing the inner `+`'s. The trace produces `Within(outer)` while the outer `+`'s own
/// (not-yet-contracted) App is the innermost tagged ancestor of an untagged redex, and separately
/// `Exact(inner)` once the inner `+`'s own App is itself contracted: two DIFFERENT ids, one properly
/// inside the other, which `let x = 40; x + 2` had no way to produce. Proven below, not just argued by
/// fixture selection: rebuilding the same hardcoded-`Within` regression against THIS fixture makes the
/// strengthened assertion below fail (the id-blind one above it still passes, by the same self-match
/// loophole).
#[test]
fn a_within_span_strictly_contains_an_exact_span_from_the_same_descent() {
    let (program, _) = redextape_core::parser::parse("let x = 1; x + (2 + 3)");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("lowers");

    // Carries the owning id alongside the span, unlike the version this replaces — the id is what lets
    // the strengthened check below tell a genuine cross-construct containment from a same-id self-match.
    let mut exact: Vec<(u32, redextape_core::span::Span)> = Vec::new();
    let mut within: Vec<(u32, redextape_core::span::Span)> = Vec::new();
    let mut c = redextape_core::trace::LambdaCursor::new(&term, 5_000);
    while c.next().is_some() {
        match c.last_owner() {
            redextape_core::lambda::reduce::Owner::Exact(id) => {
                if let Some(s) = map.source_span(id) {
                    exact.push((id, s));
                }
            }
            redextape_core::lambda::reduce::Owner::Within(id) => {
                if let Some(s) = map.source_span(id) {
                    within.push((id, s));
                }
            }
            redextape_core::lambda::reduce::Owner::None => {}
        }
    }

    assert!(!exact.is_empty(), "no Exact answer on the sample program");
    assert!(
        !within.is_empty(),
        "no Within answer on the sample program — the fixture no longer exercises the enclosing case"
    );

    // Baseline sanity, kept from the version this replaces: every Within span must contain SOME Exact
    // span (self allowed). A Within naming a span disjoint from every Exact answer is obviously broken,
    // even though (see the doc above) this alone cannot catch a wrong-but-real owner.
    for (_, w) in &within {
        assert!(
            exact.iter().any(|(_, e)| w.start <= e.start && e.end <= w.end),
            "a Within span at {w:?} contains no Exact span at all — the enclosing relation is wrong"
        );
    }

    // THE PROPERTY THE OLD FIXTURE COULD NOT EXERCISE: at least one Within answer must STRICTLY contain
    // an Exact answer belonging to a DIFFERENT construct — not merely itself under a later step. This
    // checks that a `Within` answer strictly contains a DIFFERENT construct's `Exact` answer somewhere
    // in the trace; it is existential over the whole trace, not a per-step innermost-ness check, so it
    // does NOT rule out an outermost-enclosing regression on a fixture (like this one) where the outer
    // construct's span also happens to strictly contain the inner one's. It is, however, what a
    // hardcoded wrong owner cannot satisfy by accident the way it can satisfy the id-blind check above.
    let genuine_cross_containment = within.iter().any(|(w_id, w)| {
        exact.iter().any(|(e_id, e)| {
            e_id != w_id && w.start <= e.start && e.end <= w.end && (w.start < e.start || e.end < w.end)
        })
    });
    assert!(
        genuine_cross_containment,
        "no Within answer strictly contains a DIFFERENT construct's Exact answer — this fixture does not \
         exercise 'innermost enclosing' as distinct from a same-id self-match"
    );
}

/// Task 10, Step 1's own failing test. `f.redex_span` is left unconstrained when it is `None` —
/// weak on its own (a version of `render` that never populates the field would still pass this) — so
/// `a_frame_locates_its_own_redex_at_the_exact_span_the_walk_recorded` immediately below pins the
/// dimension this one does not: that the field is actually populated, and with the right bytes.
#[test]
fn a_frame_locates_its_own_redex_in_its_own_text() {
    use redextape_core::lambda::term::{abs, app_owned, var};

    let t = app_owned(abs("x", var(0)), var(3), 7);
    let mut c = redextape_core::trace::LambdaCursor::new(&t, 100);
    c.next().expect("one step");
    let f = redextape_core::viewmodel::LambdaState::render(&c, 65536, 1000);
    // The span must index THIS frame's text, not the previous one's.
    if let Some(span) = f.redex_span {
        assert!(span.end <= f.text.len(), "the redex span must index this frame's own text");
    }
}

/// A UTF-8 case, because 5b's worst bug was byte offsets sliced as UTF-16 indices and every fixture
/// that could have caught it was pure ASCII — on the one function whose input is GUARANTEED to
/// contain `λ`.
///
/// LIKE THE TEST ABOVE, THE CHAR-BOUNDARY CHECKS ARE GATED ON `Some` — kept as specified so this test
/// still runs under a `render` that never populates the field. `redex_span_pinpoints_a_bound_occurrence_
/// under_a_binder` below is what makes `Some` itself part of what is checked, on a fixture built for
/// exactly this: a redex whose span sits AFTER a printed `λ` binder, so a byte/UTF-16 conflation
/// anywhere in the pipeline that feeds this span would put it at the wrong offset rather than merely
/// off by a fixed amount at the very start of the string.
#[test]
fn the_redex_span_is_in_bytes_over_text_containing_lambdas() {
    use redextape_core::lambda::term::{abs, app, app_owned, var};

    let t = app_owned(abs("f", abs("x", app(var(1), var(0)))), abs("y", var(0)), 1);
    let mut c = redextape_core::trace::LambdaCursor::new(&t, 100);
    c.next().expect("one step");
    let f = redextape_core::viewmodel::LambdaState::render(&c, 65536, 1000);
    assert!(f.text.contains('λ'), "this fixture must exercise multi-byte characters");
    if let Some(span) = f.redex_span {
        assert!(f.text.is_char_boundary(span.start), "span.start split a character");
        assert!(f.text.is_char_boundary(span.end), "span.end split a character");
    }
}

/// THE DIMENSION `a_frame_locates_its_own_redex_in_its_own_text` CANNOT SEE — the pairing that test's
/// own doc names from the other side: that `redex_span` is actually populated, not merely
/// well-formed when present. A `render` that always leaves the field `None` — the exact regression
/// `viewmodel.rs`'s former `NO redex FIELD, DELIBERATELY` header warns against reintroducing one field
/// over — passes `a_frame_locates_its_own_redex_in_its_own_text` above outright (its assertion is
/// inside an `if let Some`) while failing this one.
///
/// The redex is the whole term here (`app_owned`'s own root), so the recorded span must be the ENTIRE
/// printed text — measured via a scratch probe against this exact fixture (`?3`, span `0..2`) before
/// being hard-coded here, rather than assumed.
///
/// AND THE TEXT IT COVERS IS THE CONTRACTUM, NOT THE REDEX, which is worth naming because the field's
/// name does not: the redex was `(λx. x) ?3`, the path to it was the root, and `?3` is what the step
/// PRODUCED at that root. `redex_span` is a redex's PATH resolved against the POST-step term (see the
/// field's own doc), so on every frame the highlighted text is the step's result.
#[test]
fn a_frame_locates_its_own_redex_at_the_exact_span_the_walk_recorded() {
    use redextape_core::lambda::term::{abs, app_owned, var};

    let t = app_owned(abs("x", var(0)), var(3), 7);
    let mut c = redextape_core::trace::LambdaCursor::new(&t, 100);
    c.next().expect("one step");
    let f = redextape_core::viewmodel::LambdaState::render(&c, 65536, 1000);
    assert_eq!(f.text, "?3", "pins the fixture itself, so a future edit to it is visible here too");
    assert_eq!(
        f.redex_span,
        Some(redextape_core::span::Span::new(0, f.text.len())),
        "the redex was the whole term (a root path), so its contractum is the whole printed text"
    );
}

/// THE STRONGEST VERSION OF THE UTF-8 CASE: an INTERIOR redex (path `[AbsBody]`, not the trivial root
/// path `[]` every other test in this file uses), whose span sits AFTER a printed `λ` binder in this
/// frame's own text — `λx. x`, where the second `x` (byte 5..6) is what step 2 of
/// `(λf. λx. f x) (λy. y)` LEFT BEHIND: the redex at `[AbsBody]` was `(λy. y) x`, and `x` is its
/// contractum. (`λx. x` is a normal form; nothing further contracts here. `redex_span` is a redex's
/// PATH resolved against the POST-step term, so the text it covers is always the step's result — see
/// the field's own doc.) A root-path span always starts at byte 0, which cannot distinguish a correct
/// byte offset from a UTF-16 code-unit count that happens to agree at zero; this fixture can, because
/// the printer has already written a 2-byte, 1-UTF-16-unit `λ` before the span starts; a byte/UTF-16
/// conflation anywhere in the pipeline that produced this span would land it one unit short of byte 5
/// (or clip a character while trying). Measured via the same scratch-probe
/// discipline as the test above, over TWO real β-steps of this exact fixture, before being hard-coded.
#[test]
fn redex_span_pinpoints_a_bound_occurrence_under_a_binder() {
    use redextape_core::lambda::term::{abs, app, app_owned, var};

    let t = app_owned(abs("f", abs("x", app(var(1), var(0)))), abs("y", var(0)), 1);
    let mut c = redextape_core::trace::LambdaCursor::new(&t, 100);
    c.next().expect("step 1: contracts the whole term (a root redex, uninteresting for this test)");
    let ev2 = c.next().expect("step 2: contracts the redex under the binder");
    assert_eq!(
        ev2,
        redextape_core::trace::StepEvent::Beta {
            redex: vec![redextape_core::lambda::Dir::AbsBody],
            owner: redextape_core::lambda::reduce::Owner::None,
        },
        "pins the fixture's own shape, so a future edit to it is visible here too"
    );
    let f = redextape_core::viewmodel::LambdaState::render(&c, 65536, 1000);
    assert_eq!(f.text, "λx. x", "pins the fixture itself, so a future edit to it is visible here too");
    let span = f.redex_span.expect("an interior redex within budget and depth must resolve to a span");
    assert!(f.text.is_char_boundary(span.start), "span.start split a character");
    assert!(f.text.is_char_boundary(span.end), "span.end split a character");
    assert_eq!(&f.text[span.start..span.end], "x", "the span must name the bound occurrence, not the λ before it");
    assert_eq!(
        span,
        redextape_core::span::Span::new(5, 6),
        "byte 5, not UTF-16 index 5 -- they coincide here only because there is exactly one multi-byte character ahead of the span, and only for the START -- see the doc above"
    );
}

/// `redex_span` MUST NOT REPORT A SPAN PAST THE TRUNCATION CUT. `print_lambda_linked`'s own contract
/// ("A NODE PAST THE TRUNCATION CUT RECORDS NOTHING") is exactly what a caller needs here: a frame
/// budget of 512 bytes (`FRAME_BYTES`, `web/src/protocol.ts`) truncates most non-trivial terms, and a
/// `redex_span` clamped to the cut point instead of dropped would tell a renderer "the redex ends
/// here", which is false — the walk never reached it. Measured directly: at `byte_budget = 64` on
/// `big_list_program()`'s first step, the redex is the WHOLE term (a root path, like the tests above),
/// so if this field ever clamped instead of dropping, it would report `Some(Span { start: 0, end: 64
/// })` here rather than `None`, which is what makes this fixture a real discriminator and not a
/// vacuous truth.
#[test]
fn redex_span_is_none_when_the_step_it_names_falls_past_the_truncation_cut() {
    let (term, _map) = lambda_fixture(&big_list_program());
    let mut cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);
    cursor.next().expect("this program takes at least one step");

    let f = redextape_core::viewmodel::LambdaState::render(&cursor, 64, MAX_TERM_DEPTH);
    assert!(f.cut.is_some(), "a 64-byte budget must truncate this fixture");
    assert!(f.redex_span.is_none(), "a redex past the cut must not report a clamped or stale span");
}

/// `redex_span` MUST NOT BE HARDCODED `Some`, EITHER — the mirror image of the truncation test above,
/// and the same dimension `a_rendered_frame_carries_the_step_that_produced_it` already checks for
/// `redex` itself. Step 0 precedes any contraction, so there is nothing for a genuine implementation to
/// name; a stub that always reports SOME span regardless of the cursor's own state would still pass
/// every other test in this file (none of them render step 0), and only this one would catch it.
#[test]
fn redex_span_is_none_before_any_step() {
    let (term, _map) = lambda_fixture("let x = 40; x + 2");
    let c = redextape_core::trace::LambdaCursor::new(&term, 1_000);
    let f = redextape_core::viewmodel::LambdaState::render(&c, 65536, MAX_TERM_DEPTH);
    assert_eq!(f.step, 0);
    assert!(f.redex_span.is_none(), "step 0 precedes any contraction; there is no redex to locate");
}

// --- the asm leg ---------------------------------------------------------------------------------------

/// A window no program below reaches, so a frame built with it carries the whole machine.
const WHOLE: AsmWindow = AsmWindow { locals: 64, args: 16, frames: 8, cells: 16, boxes: 16 };

fn asm_label(name: &str) -> String {
    name.to_string()
}

/// Each word's decimal text, in order.
fn asm_words(ws: &[AsmWord]) -> Vec<&str> {
    ws.iter().map(|w| w.word.as_str()).collect()
}

/// Each word's tag, in order.
fn asm_tags(ws: &[AsmWord]) -> Vec<WordTag> {
    ws.iter().map(|w| w.tag).collect()
}

fn asm_word(word: &str, tag: WordTag) -> AsmWord {
    AsmWord { word: word.to_string(), tag }
}

/// `fact(3)`, the sample `sourcemap.rs`'s owner tests measure their rows on.
const ASM_FACT: &str = "fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)";

/// `ASM_FACT`'s program and the map built from its source, the program being the one `tm::lower_program`
/// returns for the map's own `Core` — the program `SourceMap::asm_owner` indexes.
fn asm_fact() -> (Program, SourceMap) {
    let (p, ds) = redextape_core::parser::parse(ASM_FACT);
    assert!(ds.is_empty(), "{ds:?}");
    let (core, map) = SourceMap::build_from_program(&p.expect("parses"), &redextape_core::tm::Unary::default());
    (redextape_core::tm::lower_program(&core).expect("lowers"), map)
}

/// Every list the frame carries stops at its bound and reports the length it was cut from, and each bound
/// cuts its own list: the five are distinct (5, 3, 2, 4, 1), so a bound read from the wrong field fails. The
/// program writes 13 locals and 7 arguments, allocates 6 cells and 4 boxes, and recurses until 6 frames are
/// saved, then halts in the deepest. Every register it names holds a value or the newest cell or box, so no
/// register pulls an older one in and the cells and boxes are the plain newest windows. A window larger than
/// all of it carries all of it, so the lengths are not the bounds read back.
#[test]
fn every_asm_list_stops_at_its_bound_and_reports_its_length() {
    let (loc, arg) = (Reg::Loc, Reg::Arg);
    let mut code: Vec<Instr> = (0..12).map(|i| Instr::Li(loc(i), u64::from(i))).collect();
    code.extend((0..6).map(|i| Instr::Li(arg(i), 100 + u64::from(i))));
    code.push(Instr::Li(arg(6), 5)); // the recursion's counter
    code.extend((0..6).map(|_| Instr::Cons(Reg::Rr, loc(1), loc(2))));
    code.extend((0..4).map(|_| Instr::Box(Reg::Rr, loc(3))));
    code.push(Instr::Li(loc(12), 1));
    code.push(Instr::Call(asm_label("f")));
    let f = code.len();
    code.push(Instr::Jz(arg(6), asm_label("stop")));
    code.push(Instr::Bin(BinOp::Sub, arg(6), arg(6), loc(12)));
    code.push(Instr::Call(asm_label("f")));
    let stop = code.len();
    code.push(Instr::Halt);
    let prog = Program { code, labels: vec![(asm_label("f"), f), (asm_label("stop"), stop)] };
    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
    c.by_ref().for_each(drop);
    assert_eq!(c.status(), Some(&AsmStatus::Halted));

    let narrow = AsmState::window(&c, None, AsmWindow { locals: 5, args: 3, frames: 2, cells: 4, boxes: 1 });
    assert_eq!(
        (asm_words(&narrow.locals), narrow.written.len(), narrow.locals_len),
        (vec!["0", "1", "2", "3", "4"], 5, 13)
    );
    assert_eq!((asm_words(&narrow.args), narrow.args_len), (vec!["100", "101", "102"], 7));
    assert_eq!((narrow.frames.len(), narrow.depth), (2, 6));
    for frame in &narrow.frames {
        assert_eq!((asm_words(&frame.saved), frame.saved_len), (vec!["0", "1", "2", "3", "4"], 13));
    }
    let cells: Vec<usize> = narrow.cells.iter().map(|c| c.cell).collect();
    assert_eq!((cells, narrow.heap_len), (vec![6, 5, 4, 3], 6));
    let boxes: Vec<usize> = narrow.boxes.iter().map(|b| b.handle).collect();
    assert_eq!((boxes, narrow.box_len), (vec![4], 4));

    let whole = AsmState::window(&c, None, WHOLE);
    let lens = (whole.locals.len(), whole.written.len(), whole.args.len(), whole.frames.len());
    assert_eq!(lens, (13, 13, 7, 6));
    assert!(whole.frames.iter().all(|f| f.saved.len() == 13));
    assert_eq!((whole.cells.len(), whole.boxes.len()), (6, 4));
}

/// Each word carries its tag into the frame — in the locals, an argument, `rr`, a saved frame, a cell's head
/// and tail, and a box — and the words and tags stay paired: the program makes a value, the list word `nil`,
/// a list and a box, copies the list to `a0` and the box to `rr`, and calls, so the frame is read inside the
/// callee with the caller's bank saved. Every one of the three tags appears where the table says.
#[test]
fn every_word_in_an_asm_frame_carries_its_tag() {
    use WordTag::{Box as B, List as L, Value as V};
    let (r0, r1, r2, r3) = (Reg::Loc(0), Reg::Loc(1), Reg::Loc(2), Reg::Loc(3));
    let prog = Program {
        code: vec![
            Instr::Li(r0, 7),
            Instr::Nil(r1),
            Instr::Cons(r2, r0, r1),
            Instr::Box(r3, r2),
            Instr::Mov(Reg::Arg(0), r2),
            Instr::Mov(Reg::Rr, r3),
            Instr::Call(asm_label("f")),
            Instr::Halt,
        ],
        labels: vec![(asm_label("f"), 7)],
    };
    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
    c.by_ref().take(7).for_each(drop);
    let st = AsmState::window(&c, None, WHOLE);
    assert_eq!((asm_words(&st.locals), asm_tags(&st.locals)), (vec!["7", "0", "1", "1"], vec![V, L, L, B]));
    assert_eq!((asm_words(&st.args), asm_tags(&st.args)), (vec!["1"], vec![L]));
    assert_eq!(st.rr, asm_word("1", B));
    let saved = &st.frames[0].saved;
    assert_eq!((asm_words(saved), asm_tags(saved)), (vec!["7", "0", "1", "1"], vec![V, L, L, B]));
    let cell = &st.cells[0];
    assert_eq!((cell.cell, &cell.head, &cell.tail), (1, &asm_word("7", V), &asm_word("0", L)));
    assert_eq!((st.boxes[0].handle, &st.boxes[0].content), (1, &asm_word("1", L)));
}

/// A word travels as its exact decimal text, however large: `mul` saturates 2^32 · 2^32 to `u64::MAX`, and
/// 2^53 + 1 is the first integer a JS number cannot hold, which a conversion through `f64` would round to
/// ...992. `AsmWord`'s doc says why the wire needs the string.
#[test]
fn an_asm_word_is_its_exact_decimal_text_up_to_a_saturated_u64() {
    let (r0, r1, r2) = (Reg::Loc(0), Reg::Loc(1), Reg::Loc(2));
    let prog = Program {
        code: vec![
            Instr::Li(r0, 1 << 32),
            Instr::Bin(BinOp::Mul, r1, r0, r0),
            Instr::Li(r2, (1 << 53) + 1),
            Instr::Mov(Reg::Rr, r1),
            Instr::Halt,
        ],
        labels: vec![],
    };
    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
    c.by_ref().for_each(drop);
    let st = AsmState::window(&c, None, WHOLE);
    assert_eq!(asm_words(&st.locals), ["4294967296", "18446744073709551615", "9007199254740993"]);
    assert_eq!(st.rr.word, u64::MAX.to_string());
}

/// Frames come top first, each with the caller's locals as they stood at its `call`. `sum(5)` by recursion,
/// the fixture `asm_cursor.rs`'s stack test uses: at its deepest the stack holds the top-level call's frame,
/// returning to 2 with no locals yet, and five recursive ones returning to 12, each saving its activation's
/// `n` in `r0` — so top first reads `n` 1, 2, 3, 4, 5 and then the empty bank. A window of three keeps the
/// three nearest the running instruction, which oldest first would have dropped.
#[test]
fn asm_frames_come_top_first_with_the_locals_saved_at_each_call() {
    let (r0, r1, r2, r3, a0) = (Reg::Loc(0), Reg::Loc(1), Reg::Loc(2), Reg::Loc(3), Reg::Arg(0));
    let sum5 = Program {
        code: vec![
            Instr::Li(a0, 5),
            Instr::Call(asm_label("sum")),
            Instr::Halt,
            Instr::Mov(r0, a0),
            Instr::Li(r1, 0),
            Instr::Bin(BinOp::Eq, r2, r0, r1),
            Instr::Jz(r2, asm_label("rec")),
            Instr::Li(Reg::Rr, 0),
            Instr::Ret,
            Instr::Li(r3, 1),
            Instr::Bin(BinOp::Sub, a0, r0, r3),
            Instr::Call(asm_label("sum")),
            Instr::Bin(BinOp::Add, Reg::Rr, r0, Reg::Rr),
            Instr::Ret,
        ],
        labels: vec![(asm_label("sum"), 3), (asm_label("rec"), 9)],
    };
    let mut c = AsmCursor::new(&sum5, redextape_core::tm::asm::DEFAULT_CAPS);
    while c.stack().len() < 6 {
        assert!(c.next().is_some(), "sum(5) saves six frames before it returns");
    }
    let saved_n = |st: &AsmState| -> Vec<Option<String>> {
        st.frames.iter().map(|f| f.saved.first().map(|w| w.word.clone())).collect()
    };
    let whole = AsmState::window(&c, None, WHOLE);
    let rets: Vec<usize> = whole.frames.iter().map(|f| f.ret_pc).collect();
    assert_eq!(rets, [12, 12, 12, 12, 12, 2]);
    let n = |s: &str| Some(s.to_string());
    assert_eq!(saved_n(&whole), [n("1"), n("2"), n("3"), n("4"), n("5"), None]);

    let top3 = AsmState::window(&c, None, AsmWindow { frames: 3, ..WHOLE });
    assert_eq!((saved_n(&top3), top3.depth), (vec![n("1"), n("2"), n("3")], 6));
}

/// Cells come newest first, with every cell a list register on screen points at, once. The program builds
/// six cells: `r1` keeps the first, `a0` the third, `r3` ends on the sixth, and `r6` holds the second but sits
/// past a five-local window; `r4` holds the VALUE 2 and `r0` is `nil`. So a window of the two newest shows
/// cells 6 and 5, plus 3 and 1 for `a0` and `r1` — not 2, which only a value and an off-screen register
/// name — and with no arguments on screen, not 3 either.
#[test]
fn asm_cells_come_newest_first_with_every_cell_a_list_register_names() {
    use WordTag::{List as L, Value as V};
    let (r0, r1, r2, r3, r4, r6, a0) =
        (Reg::Loc(0), Reg::Loc(1), Reg::Loc(2), Reg::Loc(3), Reg::Loc(4), Reg::Loc(6), Reg::Arg(0));
    let prog = Program {
        code: vec![
            Instr::Nil(r0),
            Instr::Li(r2, 5),
            Instr::Cons(r1, r2, r0),
            Instr::Cons(r3, r2, r1),
            Instr::Mov(r6, r3),
            Instr::Cons(a0, r2, r3),
            Instr::Cons(r3, r2, a0),
            Instr::Cons(r3, r2, r3),
            Instr::Cons(r3, r2, r3),
            Instr::Li(r4, 2),
            Instr::Halt,
        ],
        labels: vec![],
    };
    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
    c.by_ref().for_each(drop);
    let window = AsmWindow { locals: 5, args: 1, frames: 0, cells: 2, boxes: 0 };
    let st = AsmState::window(&c, None, window);
    let cells: Vec<usize> = st.cells.iter().map(|c| c.cell).collect();
    assert_eq!((cells, st.heap_len), (vec![6, 5, 3, 1], 6));
    let first = st.cells.last().expect("cell 1 is shown");
    assert_eq!((&first.head, &first.tail), (&asm_word("5", V), &asm_word("0", L)));

    let no_args = AsmState::window(&c, None, AsmWindow { args: 0, ..window });
    assert_eq!(no_args.cells.iter().map(|c| c.cell).collect::<Vec<_>>(), [6, 5, 1]);
}

/// Boxes by the same rule: newest first, with every box a box register on screen names. `r1` keeps box 1 and
/// `rr` box 2, `r2` ends on box 4, and `r3` holds the VALUE 1. A window of the newest box shows 4, plus 2
/// and 1 for `rr` and `r1`.
#[test]
fn asm_boxes_come_newest_first_with_every_box_a_box_register_names() {
    let (r0, r1, r2, r3) = (Reg::Loc(0), Reg::Loc(1), Reg::Loc(2), Reg::Loc(3));
    let prog = Program {
        code: vec![
            Instr::Li(r0, 7),
            Instr::Box(r1, r0),
            Instr::Box(r2, r0),
            Instr::Mov(Reg::Rr, r2),
            Instr::Box(r2, r0),
            Instr::Box(r2, r0),
            Instr::Li(r3, 1),
            Instr::Halt,
        ],
        labels: vec![],
    };
    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
    c.by_ref().for_each(drop);
    let st = AsmState::window(&c, None, AsmWindow { boxes: 1, ..WHOLE });
    let boxes: Vec<usize> = st.boxes.iter().map(|b| b.handle).collect();
    assert_eq!((boxes, st.box_len), (vec![4, 2, 1], 4));
    assert!(st.boxes.iter().all(|b| b.content == asm_word("7", WordTag::Value)));
}

/// `wrote` names the register each step wrote, spelled as the listing spells it, and `None` before the first
/// step and after one that wrote none; `written` is the current frame's bits, cleared by `call` and restored
/// by `ret`; `step` and `pc` follow the cursor. One row per frame, from step 0 to the halt.
#[test]
fn an_asm_frame_names_the_register_its_step_wrote_and_the_locals_its_frame_wrote() {
    let prog = Program {
        code: vec![
            Instr::Li(Reg::Loc(0), 1),
            Instr::Li(Reg::Arg(0), 2),
            Instr::Call(asm_label("f")),
            Instr::Li(Reg::Rr, 3),
            Instr::Halt,
            Instr::Li(Reg::Loc(1), 9),
            Instr::Ret,
        ],
        labels: vec![(asm_label("f"), 5)],
    };
    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
    let mut rows = Vec::new();
    loop {
        let st = AsmState::window(&c, None, WHOLE);
        rows.push((st.step, st.pc, st.wrote, st.written));
        if c.next().is_none() {
            break;
        }
    }
    let name = |s: &str| Some(s.to_string());
    let (t, f) = (true, false);
    assert_eq!(
        rows,
        [
            (0, 0, None, vec![]),
            (1, 1, name("r0"), vec![t]),
            (2, 2, name("a0"), vec![t]),
            (3, 5, None, vec![f]),
            (4, 6, name("r1"), vec![f, t]),
            (5, 3, None, vec![t]),
            (6, 4, name("rr"), vec![t]),
            (7, 4, None, vec![t]),
        ]
    );
}

/// `next` is the instruction about to run while the run can go on and `None` once it has ended. A taken
/// `jz` moves it past the `li` it skips; after `halt` it is `None` though `pc` stays on the `halt`; at a step
/// cap it is the instruction the raised cap will run, and so at a stack cap, which no raise will move; and
/// after a fault — `head` of `nil` — it is `None` though `pc` names the `head`.
#[test]
fn an_asm_frames_next_is_the_instruction_about_to_run_until_the_run_ends() {
    use redextape_core::tm::asm::{Caps, DEFAULT_CAPS};
    let skip = Program {
        code: vec![
            Instr::Li(Reg::Loc(0), 0),
            Instr::Jz(Reg::Loc(0), asm_label("end")),
            Instr::Li(Reg::Rr, 9),
            Instr::Halt,
        ],
        labels: vec![(asm_label("end"), 3)],
    };
    let mut c = AsmCursor::new(&skip, DEFAULT_CAPS);
    let mut rows = Vec::new();
    loop {
        let st = AsmState::window(&c, None, WHOLE);
        rows.push((st.pc, st.next));
        if c.next().is_none() {
            break;
        }
    }
    assert_eq!(rows, [(0, Some(0)), (1, Some(1)), (3, Some(3)), (3, None)]);

    let mut capped = AsmCursor::new(&skip, Caps { steps: 2, ..DEFAULT_CAPS });
    capped.by_ref().for_each(drop);
    assert_eq!(capped.status(), Some(&AsmStatus::Capped(redextape_core::trace::AsmCap::Steps)));
    let st = AsmState::window(&capped, None, WHOLE);
    assert_eq!((st.pc, st.next), (3, Some(3)), "a paused run's next instruction is the one a raise runs");

    let call = Program { code: vec![Instr::Call(asm_label("f"))], labels: vec![(asm_label("f"), 0)] };
    let mut refused = AsmCursor::new(&call, Caps { stack: 0, ..DEFAULT_CAPS });
    refused.by_ref().for_each(drop);
    assert_eq!(refused.status(), Some(&AsmStatus::Capped(redextape_core::trace::AsmCap::Stack)));
    assert_eq!(AsmState::window(&refused, None, WHOLE).next, Some(0), "the call the stack cap refused");

    let faults =
        Program { code: vec![Instr::Nil(Reg::Loc(0)), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt], labels: vec![] };
    let mut c = AsmCursor::new(&faults, DEFAULT_CAPS);
    c.by_ref().for_each(drop);
    assert_eq!(c.status(), Some(&AsmStatus::Faulted("head of empty list".to_string())));
    let st = AsmState::window(&c, None, WHOLE);
    assert_eq!((st.pc, st.next), (1, None), "the faulting `head` will never run");
}

/// `source_node` is the owner of the instruction about to run, through a real map built from the program's
/// source, and the assertions compare the owner's SOURCE TEXT, not the map's answer read back: `ASM_FACT`'s
/// instruction 4 is its `n == 0`, 11 its `n - 1` and 17 its literal `3`, the rows `sourcemap.rs`'s
/// `each_instruction_is_owned_by_the_construct_that_emitted_it` measured. With no map the owner is `None` and
/// nothing else in the frame changes; a `pc` past the program's end, where a fetch faulted, has no owner
/// rather than an index out of bounds.
#[test]
fn an_asm_frames_source_node_is_the_owner_of_the_instruction_about_to_run() {
    let (prog, map) = asm_fact();
    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
    let mut seen = std::collections::BTreeMap::new();
    loop {
        let st = AsmState::window(&c, Some(&map), WHOLE);
        let text = st.source_node.and_then(|n| map.source_span(n)).map(|s| &ASM_FACT[s.start..s.end]);
        seen.entry(st.pc).or_insert(text);
        if st.pc == 11 {
            assert!(st.source_node.is_some(), "the loop is at an owned instruction, or the next line proves nothing");
            let unmapped = AsmState::window(&c, None, WHOLE);
            assert_eq!(unmapped, AsmState { source_node: None, ..st }, "the map decides `source_node` alone");
        }
        if c.next().is_none() {
            break;
        }
    }
    let at = |pc: usize| seen.get(&pc).copied().flatten();
    assert_eq!((at(4), at(11), at(17)), (Some("n == 0"), Some("n - 1"), Some("3")));

    let falls_off = Program { code: vec![Instr::Li(Reg::Loc(0), 0)], labels: vec![] };
    let owns_one = SourceMap { asm_owner: vec![Some(7)], ..SourceMap::default() };
    let mut c = AsmCursor::new(&falls_off, redextape_core::tm::asm::DEFAULT_CAPS);
    assert_eq!(AsmState::window(&c, Some(&owns_one), WHOLE).source_node, Some(7));
    c.by_ref().for_each(drop);
    assert_eq!(c.status(), Some(&AsmStatus::Faulted("ran past end of program".to_string())));
    let past = AsmState::window(&c, Some(&owns_one), WHOLE);
    assert_eq!((past.pc, past.source_node), (1, None));
}

/// `AsmProgram` is `print_instr`'s line for every instruction and the program's own labels — the same text
/// the TM view's `TmProgram.listing` is built from, which the map's `tm_listing` holds for this program. Line
/// 4 is pinned as text, so a listing that disagreed with the printer in every line alike still fails.
#[test]
fn asm_program_is_the_printers_listing_and_the_programs_labels() {
    let (prog, map) = asm_fact();
    let p = AsmProgram::of(&prog);
    assert_eq!(p.listing, prog.code.iter().map(print_instr).collect::<Vec<_>>());
    assert_eq!(p.listing.get(4).map(String::as_str), Some("cmpeq\tr1, r2, r3"));
    assert!(!prog.labels.is_empty(), "`fact` has labels, or the next line compares two empty lists");
    assert_eq!(p.labels, prog.labels);
    assert_eq!((&p.listing, &p.labels), (&map.tm_listing, &map.tm_labels), "the two views list one program");
}

/// A word crosses as a JSON string and a tag as its variant's name — the wire form `AsmWord`'s doc argues
/// for, in the serializer this crate controls; `redextape-wasm`'s browser tests read it through the one the
/// app uses. The frame, the program and the window each round-trip.
#[cfg(feature = "serde")]
#[test]
fn an_asm_frame_crosses_as_json_with_words_as_strings() {
    let (prog, map) = asm_fact();
    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
    c.by_ref().take(30).for_each(drop);
    let st = AsmState::window(&c, Some(&map), WHOLE);
    let json = serde_json::to_value(&st).expect("serialize");
    assert_eq!(json["rr"]["word"], serde_json::Value::String(st.rr.word.clone()), "a word is a string");
    assert_eq!(json["rr"]["tag"], serde_json::Value::String("Value".to_string()), "a tag is its variant's name");
    let back: AsmState = serde_json::from_value(json).expect("deserialize");
    assert_eq!(back, st);

    let p = AsmProgram::of(&prog);
    let back: AsmProgram = serde_json::from_str(&serde_json::to_string(&p).expect("serialize")).expect("deserialize");
    assert_eq!(back, p);
    let w: AsmWindow = serde_json::from_str(r#"{"locals":1,"args":2,"frames":3,"cells":4,"boxes":5}"#).expect("parse");
    assert_eq!(w, AsmWindow { locals: 1, args: 2, frames: 3, cells: 4, boxes: 5 });
}
