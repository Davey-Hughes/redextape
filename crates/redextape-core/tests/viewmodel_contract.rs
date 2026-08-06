//! The data contract PR 3 renders. These are properties of the builders, not of any renderer.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use redextape_core::sourcemap::SourceMap;
use redextape_core::viewmodel::{LambdaState, TmProgram, TmState};

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

    let generous = LambdaState::render(&cursor, usize::MAX);
    assert!(!generous.truncated);

    let tight = LambdaState::render(&cursor, 64);
    assert!(tight.truncated, "a 64-byte budget must fire on a term printing {} bytes", generous.text.len());
    assert!(tight.text.len() < generous.text.len());
    assert!(tight.spans.iter().all(|(s, _)| s.end <= tight.text.len()), "spans must stay in the text");

    cursor.next();
    let stepped = LambdaState::render(&cursor, usize::MAX);
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

    let Some(redextape_core::trace::StepEvent::Beta { redex: first_redex }) = cursor.next() else {
        panic!("this program takes at least one beta step");
    };
    assert!(walk(&term, &first_redex).is_some(), "the first step's own redex must index the initial term");

    let mut redex = first_redex;
    for step in 2..=4 {
        let Some(redextape_core::trace::StepEvent::Beta { redex: next }) = cursor.next() else {
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
    use redextape_core::lambda::Dir;
    use redextape_core::lambda::term::Node;

    let mut cur = term;
    for dir in path {
        cur = match (dir, cur.node()) {
            (Dir::AbsBody, Node::Abs(_, body)) => body,
            (Dir::AppL, Node::App(f, _)) => f,
            (Dir::AppR, Node::App(_, a)) => a,
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
        let st = TmState::window(&cursor, &empty_map(), radius);
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
        let st = TmState::window(cursor, &empty_map(), 2);
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
    let _ = TmState::window(&small, &map, 2);
    let bytes_small = BYTES_ALLOCATED.load(Ordering::SeqCst) - before_small;

    let before_large = BYTES_ALLOCATED.load(Ordering::SeqCst);
    let _ = TmState::window(&large, &map, 2);
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
    let p = TmProgram::of(&machine, 64);
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

    let st = TmState::window(&c, &empty_map(), 4);
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
    let p = TmProgram::of(&machine, 64);
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
        let st = TmState::window(&c, &map, 2);
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
    assert_eq!(TmState::window(&c2, &empty_map(), 2).source_node, None);
}

#[test]
fn the_ast_returns_none_over_budget_rather_than_a_partial_tree() {
    let (term, map) = lambda_fixture(&big_list_program());
    let cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);
    let _ = &map;
    assert!(LambdaState::ast(&cursor, 4).is_none(), "a 4-node budget must refuse, not truncate");
    assert!(LambdaState::ast(&cursor, usize::MAX).is_some(), "an unreachable budget must succeed");
}

/// §10.4's stated outcome: the view models serialize and round-trip. Feature-gated, because serde is
/// optional and default-off — this test does not exist in a default build.
#[cfg(feature = "serde")]
#[test]
fn every_view_model_round_trips_through_json() {
    let (term, _map) = lambda_fixture("let x = 40; x + 2");
    let cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);
    let ls = LambdaState::render(&cursor, usize::MAX);
    let back: LambdaState = serde_json::from_str(&serde_json::to_string(&ls).expect("serialize")).expect("deserialize");
    assert_eq!(ls, back);

    let (machine, init) = tm_fixture("let x = 40; x + 2");
    let p = TmProgram::of(&machine, 64);
    let back: TmProgram = serde_json::from_str(&serde_json::to_string(&p).expect("serialize")).expect("deserialize");
    assert_eq!(p, back);

    let mut c = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());
    c.by_ref().take(20).count();
    let ts = TmState::window(&c, &empty_map(), 8);
    let back: TmState = serde_json::from_str(&serde_json::to_string(&ts).expect("serialize")).expect("deserialize");
    assert_eq!(ts, back);
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
