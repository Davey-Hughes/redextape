//! The data contract PR 3 renders. These are properties of the builders, not of any renderer.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

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
        let st = TmState::window(&cursor, radius);
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
        let st = TmState::window(cursor, 2);
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
    let before_small = BYTES_ALLOCATED.load(Ordering::SeqCst);
    let _ = TmState::window(&small, 2);
    let bytes_small = BYTES_ALLOCATED.load(Ordering::SeqCst) - before_small;

    let before_large = BYTES_ALLOCATED.load(Ordering::SeqCst);
    let _ = TmState::window(&large, 2);
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
    let ts = TmState::window(&c, 8);
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
    use redextape_core::tm::{Encoding, REG, TAPES, Unary, WORK, defunc, lower_asm, lower_tm, n_slots_of};
    let (p, ds) = redextape_core::parser::parse(src);
    assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
    let core = redextape_core::desugar::desugar(&p.expect("fixture parses"));
    let prog = match lower_asm(&core) {
        Ok(p) => p,
        Err(_) => lower_asm(&defunc(&core).expect("defunc")).expect("lower"),
    };
    let enc = Unary::default();
    let m = lower_tm(&prog, &enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots_of(&prog));
    init[WORK] = enc.init_work();
    (m, init)
}

/// Same default caps `trace_equivalence.rs` drives its cursor tests with.
fn tm_caps() -> redextape_core::tm::TmCaps {
    redextape_core::tm::TM_DEFAULT_CAPS
}
