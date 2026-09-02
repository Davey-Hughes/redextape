//! The data contract PR 3 renders. These are properties of the builders, not of any renderer.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use redextape_core::lambda::reduce::MAX_TERM_DEPTH;
use redextape_core::sourcemap::SourceMap;
use redextape_core::viewmodel::{LambdaState, LinkIndex, TermNode, TermTree, TmProgram, TmState};

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

#[test]
fn the_ast_returns_none_over_budget_rather_than_a_partial_tree() {
    let (term, map) = lambda_fixture(&big_list_program());
    let cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);
    let _ = &map;
    assert!(LambdaState::ast(&cursor, 4).is_none(), "a 4-node budget must refuse, not truncate");
    assert!(LambdaState::ast(&cursor, usize::MAX).is_some(), "an unreachable budget must succeed");
}

/// The arena denotes the same tree the term does, on a real lowered program rather than on a term
/// built by hand. `big_list_program()` is 200 elements — first-order, no recursion, and a logical size
/// the existing budget test above already drives with `usize::MAX`.
#[test]
fn the_arena_denotes_the_same_tree_the_term_does() {
    let (term, _map) = lambda_fixture(&big_list_program());
    let cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);
    let tree = LambdaState::ast(&cursor, usize::MAX).expect("an unreachable budget must succeed");

    if let Err(msg) = arena_matches_term(&tree, &term) {
        panic!("the arena and the term disagree on shape: {msg}");
    }
    assert_eq!(
        tree.root as usize,
        tree.nodes.len() - 1,
        "the walk builds post-order, so the root is the last node emitted"
    );

    // POST-ORDER IS A PUBLISHED CONTRACT (`viewmodel.rs`'s `TermTree` doc: "every child precedes its
    // parent"), and nothing above pins it. An arena that emitted a FORWARD index into a structurally
    // identical node would still pass the lockstep walk above, the root-is-last assertion above, and
    // the `logical_size` cross-check below -- none of those look at whether a child's index is
    // actually less than its own parent's, only at what the child eventually resolves to. Checked
    // here, iteratively, over every node.
    for (i, node) in tree.nodes.iter().enumerate() {
        match node {
            TermNode::Var(_) => {}
            TermNode::Abs(_, body) => {
                assert!(
                    (*body as usize) < i,
                    "node {i} is Abs(.., {body}): child {body} does not precede its parent at {i}"
                );
            }
            TermNode::App(f, a) => {
                assert!(
                    (*f as usize) < i,
                    "node {i} is App({f}, {a}): fn-child {f} does not precede its parent at {i}"
                );
                assert!(
                    (*a as usize) < i,
                    "node {i} is App({f}, {a}): arg-child {a} does not precede its parent at {i}"
                );
            }
        }
    }

    // `arena_matches_term` compares content per occurrence, so an arena that DEDUPLICATED a shared
    // subterm -- pointing two parents at one index -- would still pass every comparison above, since
    // both occurrences are structurally identical by construction. Nothing above checks index
    // uniqueness or the total count. `logical_size` is an independently written occurrence count for
    // the same term (walks BOTH children of every `App`, one unit per occurrence, never per
    // allocation -- see its doc in `crates/redextape-core/src/lambda/term.rs`), so cross-checking the
    // arena's length against it catches a dedup regression that the walk above cannot.
    assert_eq!(
        tree.nodes.len() as u64,
        redextape_core::lambda::term::logical_size(&term),
        "arena node count must equal the term's logical (denoted) size -- a mismatch means the arena \
         is not costing one entry per occurrence"
    );
}

/// Walk the arena and the term in lockstep, ITERATIVELY, reporting exactly where they diverge.
///
/// A RECURSIVE REBUILD WOULD REINTRODUCE THE EXACT HAZARD THE ARENA REMOVES, inside the test that
/// certifies its removal — and it would pass on every shallow program while failing on the one shape
/// that matters. This is the obvious way to write this test and it is the wrong one.
///
/// Subterms are pushed as BORROWS of the root term, which outlives the walk, so a shared DAG node is
/// visited once per occurrence — matching the arena, which holds one entry per occurrence.
///
/// Returns `Err` naming the arena index and both sides' shapes at the FIRST point of disagreement,
/// rather than `bool`: a static "disagree on shape" message gives a maintainer nothing to act on when
/// this fires on a real regression -- for instance the `App` pop-order transposition this file's own
/// `to_tree` doc warns about, in `crates/redextape-core/src/viewmodel.rs`.
fn arena_matches_term(tree: &TermTree, term: &redextape_core::lambda::term::LambdaTerm) -> Result<(), String> {
    use redextape_core::lambda::term::Node;

    // A one-line, non-recursive tag for a node on either side: the variant and any scalar payload,
    // never the subterms -- a mismatch on a 200-node fixture must not try to print the other 199.
    fn describe_term_node(n: &Node) -> String {
        match n {
            Node::Var(i) => format!("Var({i})"),
            Node::Abs(name, _) => format!("Abs({name:?}, ..)"),
            Node::App(_, _, _) => "App(.., ..)".to_string(),
        }
    }
    fn describe_arena_node(n: &TermNode) -> String {
        match n {
            TermNode::Var(i) => format!("Var({i})"),
            TermNode::Abs(name, _) => format!("Abs({name:?}, ..)"),
            TermNode::App(_, _) => "App(.., ..)".to_string(),
        }
    }

    let mut work: Vec<(u32, &redextape_core::lambda::term::LambdaTerm)> = vec![(tree.root, term)];
    while let Some((idx, t)) = work.pop() {
        let Some(node) = tree.nodes.get(idx as usize) else {
            return Err(format!("arena index {idx} is out of range (the arena has {} nodes)", tree.nodes.len()));
        };
        match (node, t.node()) {
            (TermNode::Var(i), Node::Var(j)) => {
                if i != j {
                    return Err(format!("node {idx}: arena has Var({i}), term has Var({j})"));
                }
            }
            (TermNode::Abs(name, body), Node::Abs(n2, b2)) => {
                if **name != **n2 {
                    return Err(format!("node {idx}: arena has Abs({name:?}, ..), term has Abs({n2:?}, ..)"));
                }
                work.push((*body, b2));
            }
            (TermNode::App(f, a), Node::App(f2, a2, _)) => {
                work.push((*f, f2));
                work.push((*a, a2));
            }
            (arena_node, term_node) => {
                return Err(format!(
                    "node {idx}: arena has {}, term has {}",
                    describe_arena_node(arena_node),
                    describe_term_node(term_node)
                ));
            }
        }
    }
    Ok(())
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

    // `TermTree` was not covered here before the arena, and the omission mattered: `serde_json`'s
    // DESERIALIZER recurses per level too, so a `Box`-shaped `TermNode` had two recursive paths on the
    // way out and a third on the way back in.
    let tree = LambdaState::ast(&cursor, usize::MAX).expect("the fixture fits an unreachable budget");
    let back: TermTree = serde_json::from_str(&serde_json::to_string(&tree).expect("serialize")).expect("deserialize");
    assert_eq!(tree, back);

    let (machine, init) = tm_fixture("let x = 40; x + 2");
    let p = TmProgram::of(&machine, 64);
    let back: TmProgram = serde_json::from_str(&serde_json::to_string(&p).expect("serialize")).expect("deserialize");
    assert_eq!(p, back);

    let mut c = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());
    c.by_ref().take(20).count();
    let ts = TmState::window(&c, Some(&empty_map()), 8);
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
    // THE TRAP THIS PINS. `SourceMap::build_from_program` lowers at `MIN_FIELD_WIDTH` purely to record
    // ownership; `run_tm_described` re-lowers and auto-fits a possibly different width. `node_to_tm`'s
    // StateIds therefore index a DIFFERENT machine from `TmProgram.states`. Only names agree, so
    // `tm_owner` must be built by name — the same resolution `TmState::window` performs per step.
    let src = "let x = 40; x + 2";
    let (program, diags) = redextape_core::parser::parse(src);
    let program = program.expect("the sample must parse");
    assert!(diags.is_empty(), "diagnostics: {diags:?}");
    let ty = redextape_core::typeck::result_type(&program).expect("the sample must type");
    let kind = redextape_core::tm::EncodingKind::Binary;
    let enc = kind.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, map) = SourceMap::build_from_program(&program, &*enc);

    let described = redextape_core::tm::run_tm_described(&core, kind, ty, redextape_core::tm::TM_DEFAULT_CAPS)
        .expect("the sample must lower");
    let width = described.header.width;
    let machine = std::rc::Rc::new(described.machine);
    let tm_program = TmProgram::of(&machine, width);

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
    assert!(owned > 0, "the sample must have at least one owned state, or this test proves nothing");

    // The lambda leg. The sample's every source-mapped node carries a path, and the term prints well
    // inside the budget, so every one of them must have a span.
    assert!(index.lambda_cut.is_none(), "the sample must print whole at 65,536 bytes");
    assert_eq!(index.lambda_nodes.len(), map.node_to_lambda.len());
    assert_eq!(index.source_nodes.len(), map.node_to_source.len());
    for (span, id) in &index.source_nodes {
        assert_eq!(map.source_span(*id), Some(*span));
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
    let tm_program = TmProgram::of(&machine, 64);
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
