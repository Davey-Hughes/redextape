//! Counterexamples to guards proposed in this tree, as executable tests: the two programs that
//! falsified the two withdrawn λ blow-up guards, and — below them — a third, non-λ subject that
//! still stands.
//!
//! Three BOUNDS have been proposed for one hazard — a single β-step that runs for seconds. Two were
//! built and measurement killed both, each to a specific, small, working program; the third is the
//! per-redex work budget that has not been built yet, and this file is the gate it has to clear.
//! (The design records count a *third falsification* as well, which is a different tally: the
//! structural-sharing design's claim that the hazard was unreachable. That one had no counterexample
//! program to commit — it fell to a family that had to be written — so it has no test here.)
//! Until this file
//! existed those programs lived only in `examples/` probes and in the design records' prose, so the
//! next person to propose a bound on **total size** or on **sharing** would have found out in review,
//! if at all. Now the evidence runs in CI.
//!
//! | withdrawn design | the bound it wanted | what refutes it, below |
//! | --- | --- | --- |
//! | total logical size (`2026-07-31-lambda-logical-size-guard-design.md`, its §10) | `logical_size(&term) > 300,000` refuses | `a_699_element_list_is_half_a_million_unshared_nodes_and_lowers` |
//! | largest shared subterm (`2026-07-31-lambda-shared-subterm-guard-design.md`, its §10) | `max_shared_logical_size(&term) > 10,000` refuses | `two_list_literals_score_four_shared_nodes_and_lower` |
//!
//! **A THIRD SUBJECT, AND NOT A λ ONE: `tm::build::MAX_MACHINE_STATES`.** The rows below it are the
//! same shape of evidence pointing the other way. The two λ guards were *proposals killed by
//! counterexample*; the state ceiling *exists*, and what needs pinning is that it sits between two
//! measured programs — above the worst demo this project ships (49,135 states) and below the
//! balanced arithmetic tree that OOMs (8,595,317 states from 6 KB of source). A guard is only as
//! good as both of its sides, which is what this file is for either way.
//!
//! **The two refutations pull in opposite directions, which is the point.** One program is huge and
//! must be admitted; the other is cheap by the sharing measure and must be refused. Any *total-size*
//! bound low enough to catch the hazard refuses the first. Any *sharing* bound high enough to admit
//! the corpus admits the second. A future proposal has to clear both, and this file is where it finds
//! that out.
//!
//! **WHAT THIS FILE PINS, AND WHAT IT DELIBERATELY DOES NOT.** Every assertion here is a *count* —
//! logical size, physical size, largest shared subterm, source length. All four are deterministic and
//! machine-independent, properties of the lowering rather than of how fast the machine ran it. The
//! costs that actually falsified the designs are **wall-clock seconds**, and they are quoted in the
//! doc comments below and asserted nowhere: a timing gate is a flaky gate, and this tree's standing
//! practice is to gate on counts and report seconds from `examples/`. Re-derive the timings with
//! `cargo run --release --example guard_hole_probe` (read its header first — several of its sections
//! are deliberately expensive) or `--example list_reduction_probe`.
//!
//! Neither guard exists. Nothing here calls `lower` expecting a refusal; both programs lower, and
//! that both lower is half of what each one proves.
//!
//! **Runtime, measured rather than hoped for: ~1.97 s for the file** in the unoptimized profile the
//! gate uses (the two tests run in parallel under `cargo nextest`, ~1.94 s each), **~0.21 s
//! optimized.** Building and lowering the programs is not what costs — that is ~0.1 ms and ~20 ms
//! respectively for either one. The rest is three O(physical) folds over ~500,000 `Rc` allocations,
//! hash-dominated and ~11x slower without optimization. That cost is itself part of the record: the
//! shared-subterm design's §9 measures `max_shared_logical_size` at 92.6 ms optimized on exactly the
//! first program below, against a `lower()` of 9.7 ms — so the folds asserted here ARE the ~90 ms
//! that section is about, paid in a debug build. Nothing is shrinkable without dropping a pin: the
//! sizes are the falsification, and 699 and 500 are the two element counts that make these programs
//! the specific counterexamples they are.

// Test target: `clippy.toml`'s `allow-*-in-tests` keys do not reach free helpers in a `tests/`
// target, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::collections::HashSet;

use redextape_core::desugar::desugar;
use redextape_core::lambda::lower;
use redextape_core::lambda::term::{LambdaTerm, Node, logical_size, max_shared_logical_size};
use redextape_core::parser::parse;
use redextape_core::tm::asm::{Instr, Program, Reg};
use redextape_core::tm::build::MAX_MACHINE_STATES;
use redextape_core::tm::{
    Binary, EncodingKind, TM_DEFAULT_CAPS, TmRun, Unary, defunc, lower_asm, lower_tm, lower_tm_guarded, run_tm_at,
    run_tm_described, run_tm_fitted,
};
use redextape_core::ty::Ty;

/// `parse` -> `desugar` -> `lower`, panicking on anything that is not a clean lowering.
///
/// The panic messages name the program's LENGTH rather than its text: both inputs here are kilobytes
/// of comma-separated integers, and a failure that dumps 4,821 bytes of list literal into the test
/// output buries the diagnostic that explains it. Same reasoning as `lower.rs`'s own `core_of`.
fn lower_src(src: &str) -> LambdaTerm {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in a {}-byte program: {ds:?}", src.len());
    let core = desugar(&prog.expect("a program with no diagnostics parses"));
    lower(&core).unwrap_or_else(|e| panic!("a {}-byte program must lower, got {e:?}", src.len()))
}

/// Distinct `Rc` allocations reachable from `t` — the PHYSICAL size, against which `logical_size` is
/// the size of the tree the term denotes. Their ratio is the sharing factor, and both counterexamples
/// below are pinned at 1.000x: they are trees, not DAGs.
///
/// Not a re-implementation of `logical_size`, which counts the denoted tree and is `pub`; this counts
/// storage and has no public equivalent. The same fold appears in `blowup_probe.rs`,
/// `list_reduction_probe.rs` and `guard_hole_probe.rs`, none of which can export it — an `examples/`
/// target is not importable. Iterative because a 699-element list is ~1,400 levels deep and a
/// recursive walk over it would overflow the stack this test exists to reason about.
///
/// `alloc_id()` is an allocation address, an identity only while the allocation is live. `t` is
/// borrowed for the whole walk, so nothing here can observe a freed address being reused — the same
/// constraint `lambda_sharing.rs` states at greater length, where the term under walk is a trace that
/// has to be held alive deliberately.
fn physical_size(t: &LambdaTerm) -> u64 {
    let mut seen: HashSet<usize> = HashSet::new();
    let mut stack: Vec<&LambdaTerm> = vec![t];
    while let Some(n) = stack.pop() {
        if !seen.insert(n.alloc_id()) {
            continue;
        }
        match n.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => stack.push(b),
            Node::App(f, a, _) => {
                stack.push(f);
                stack.push(a);
            }
        }
    }
    seen.len() as u64
}

/// `[0, 1, …, n-1]` as source. The source equivalent of `lower.rs`'s test-only `deep_list`, which is
/// private to that module's `#[cfg(test)]` block and unreachable from an integration target.
fn list_src(n: usize) -> String {
    format!("[{}]", (0..n).map(|i| i.to_string()).collect::<Vec<_>>().join(", "))
}

/// 699 = `MAX_LAMBDA_LOWER_DEPTH - 1`, the largest list literal `lower` accepts. The constant is
/// private to `lambda::lower` (it is 700), so this restates the value rather than importing it; if
/// the depth bound ever moves, `lower.rs`'s `the_guard_admits_a_core_at_the_bound_and_refuses_only_past_it`
/// fails first and points here.
const LARGEST_ADMITTED_LIST: usize = 699;

/// **The program that killed the TOTAL-SIZE guard** (`2026-07-31-lambda-logical-size-guard-design.md`,
/// withdrawn in its own §10).
///
/// That design refused any term whose `logical_size` exceeded 300,000, on the stated grounds that
/// "every such program observed so far does not terminate anyway". This is a 3,385-byte list literal —
/// `[0, 1, …, 698]`, the largest the depth guard admits — and it is a counterexample to the grounds
/// rather than to the arithmetic. It measures **497,691 logical nodes**, 1.66x over that bound, it
/// lowers, and it reduces cleanly to a normal form in 1,398 steps. The guard's first refusal would
/// have been a working program.
///
/// **The ratio is what makes it unanswerable, not the size.** Logical and physical size are pinned
/// EQUAL below: 497,691 allocations denoting 497,691 nodes, a sharing factor of exactly 1.000x. A list
/// literal shares nothing, so there is no DAG-vs-tree gap to exploit — no bound on total size can
/// admit this program and still refuse the nesting family, because the family's blow-up is *smaller*
/// on this axis. `logical_size` returns one number for both and cannot tell them apart.
///
/// It is not fast: ~35 s to reduce, and the cost grows ~n³. But it terminates in bounded memory, which
/// makes it a UX problem and not a hazard, and refusing it at lowering time is a capability loss.
///
/// `max_shared` is 0 here, and that is pinned by `lower.rs`'s
/// `a_large_unshared_list_measures_zero_shared_nodes` as well. Kept in both places on purpose: there
/// it is one number beside the depth guard that built the program, here it is the third leg of a
/// falsification — the successor design was blind to this program too, for the reason the next test
/// makes general.
#[test]
fn a_699_element_list_is_half_a_million_unshared_nodes_and_lowers() {
    let src = list_src(LARGEST_ADMITTED_LIST);
    assert_eq!(src.len(), 3_385, "the program's source size");

    let term = lower_src(&src);

    // Measured 2026-08-01. The withdrawn bound was 300,000, so this working program is 1.66x over it.
    assert_eq!(logical_size(&term), 497_691, "logical nodes in the 699-element list");

    // Exactly 1.000x. Not "approximately": a list literal is a tree, so every denoted node is a real
    // allocation and the two counts are the same integer. If these ever differ, the LOWERING started
    // sharing and every number in this file is describing a different program.
    assert_eq!(physical_size(&term), 497_691, "allocations — equal to the logical count, so 1.000x");

    // 0, not merely small. The successor guard measured sharing, and this program has none at all; it
    // is invisible to that guard in kind rather than in degree.
    assert_eq!(max_shared_logical_size(&term), 0, "a list literal shares nothing");
}

/// `let xs = […]; let ys = […]; head(xs) + head(ys)` — the counterexample `guard_hole_probe.rs`'s
/// `source` section is built around.
fn two_list_src(n: usize) -> String {
    let items = (0..n).map(|i| i.to_string()).collect::<Vec<_>>().join(", ");
    format!("let xs = [{items}]; let ys = [{items}]; head(xs) + head(ys)")
}

/// **The program that killed the SHARED-SUBTERM guard** (`2026-07-31-lambda-shared-subterm-guard-design.md`,
/// withdrawn in its own §10).
///
/// ```text
/// let xs = [0, 1, …, 499];
/// let ys = [0, 1, …, 499];
/// head(xs) + head(ys)
/// ```
///
/// That design refused any term whose largest shared subterm exceeded 10,000 logical nodes, calibrated
/// against a corpus whose maximum is 684. This program is **4,821 bytes with no recursion, no `while`,
/// no closure and no mutual-recursion group** — nothing that design identifies as a source of sharing
/// at all. It scores **`max_shared` = 4**, it lowers, and **its first β-step took 19.0 seconds**.
/// 2,500x under a bound meant to catch exactly this cost. The gap is not near any threshold: no
/// constant admits the corpus's 684 and refuses this 4.
///
/// **THE 19 SECONDS ARE PROSE HERE, DELIBERATELY, AND THAT DECISION IS WHY THIS TEST STILL PASSES.**
/// They were the falsifying fact and they were not asserted, because they are neither deterministic nor
/// cheap — a timing assertion would be a flaky gate. Since 2026-08-01 that step is **under a
/// millisecond** and the whole program normalises in well under one: `term.rs`'s `shift` was Θ(logical)
/// and sharing-destroying, and fixing it removed the cost this guard was supposed to refuse. **A timing
/// assertion here would now be failing for a good reason, which is the worst kind of red gate.**
///
/// What IS asserted is the number the guard would have read, which is deterministic, still 4, and
/// **still falsifies the design** — the guard is blind to this program in kind, not in degree, and that
/// was never a claim about how long it took. Re-derive the current timings with
/// `cargo run --release --example shift_cost_probe`; `examples/guard_hole_probe.rs` remains the
/// instrument for the guard's verdict per row, with its own timings marked as pre-fix.
///
/// **The single-list control is why this is decisive.** `let xs = [0, …, 499]; head(xs)` — same
/// element count, same lowering path, one binding instead of two — took **0.043 s** and scores 0.
/// 442x apart in cost, and the guard's quantity is 4 against 0. It is a family, not a ceiling
/// artifact: ramping the number of let-bound lists at fixed element count cost 2.2 / 7.1 / 17.6 /
/// 42.0 s at k = 2 / 4 / 8 / 16, linear in k, with `max_shared` pinned at 4 throughout. **All five
/// timings are pre-2026-08-01; the `max_shared` values are not, and they are what the argument rests
/// on.**
///
/// **Why sharing was the wrong quantity.** A β-step cost `|body| + Abs(body) x |arg|`: `subst`'s
/// `Var` arm is an `Rc` bump and is free, while its `Abs` arm took `shift(1, 0, s)` — a full logical
/// copy of the argument — once per `Abs` node in the body, unconditionally, before anything checked
/// whether the variable occurs there. Neither factor is a sharing property; both are large in a term
/// that aliases nothing.
///
/// **That account was one level too shallow, and the missing level is what closed the hang.** It does
/// not say why `|arg|` was the LOGICAL size rather than the physical one. `shift` rebuilt every node it
/// visited — Θ(logical), and sharing-destroying, since `shift(App(c, c))` recursed twice. Both `shift`
/// and `subst` now return their argument's allocation when no free index is in range, so the `Abs` arm
/// no longer builds that copy and the whole cost model collapses on these programs. This program lowers to `(\xs. (\ys. BODY) YS) XS`, whose leftmost-outermost
/// redex is the root, so the first step re-shifts the whole of `XS` once per `Abs` in `(\ys. BODY) YS`
/// — and `YS` supplies ~6 of those per element.
///
/// The size pins below are that argument as a measurement: 513,053 allocations denoting 513,061
/// nodes, a ratio of 1.000x. **The program is enormous and almost perfectly unshared**, and the
/// guard's whole input is the 8-node gap between those two figures.
#[test]
fn two_list_literals_score_four_shared_nodes_and_lower() {
    let src = two_list_src(500);
    assert_eq!(src.len(), 4_821, "the program's source size");

    let term = lower_src(&src);

    // Measured 2026-08-01. THE FALSIFICATION, in one integer: the withdrawn bound was 10,000, the
    // corpus maximum it was calibrated against is 684, and this 19-second program reads 4.
    assert_eq!(max_shared_logical_size(&term), 4, "the largest shared subterm — 2,500x under the withdrawn bound");

    // Why 4 is so small: there is almost nothing to share. 513,061 denoted nodes over 513,053
    // allocations is 1.000x, within 8 nodes of a tree. A guard on sharing has no signal to read on a
    // term this shape, however expensive stepping it turns out to be.
    assert_eq!(logical_size(&term), 513_061, "logical nodes in the two-list program");
    assert_eq!(physical_size(&term), 513_053, "allocations — 8 fewer than the logical count, so 1.000x");
}

/// Source to `Core`, through the same front end `run_tm_described` uses.
fn core_of(src: &str) -> redextape_core::core::Core {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
    desugar(&prog.expect("parse produced no program"))
}

/// `n` leaves, balanced, so depth is log2(n) and `lower_asm`'s `MAX_LOWER_DEPTH` never fires. Shared
/// by the two tests below rather than defined in each: they assert opposite outcomes about the SAME
/// shape at different sizes, so a copy that drifted would silently stop testing the pair.
fn balanced(lo: usize, hi: usize) -> String {
    if hi - lo <= 1 {
        return "1".into();
    }
    let mid = (lo + hi) / 2;
    format!("({} + {})", balanced(lo, mid), balanced(mid, hi))
}

/// `Core` to asm, reproducing `lower_program`'s own order: direct, then `defunc` on an unsupported
/// higher-order construct. Reproduced rather than called because `lower_program` is private.
fn asm_of(src: &str) -> redextape_core::tm::asm::Program {
    let core = core_of(src);
    lower_asm(&core).or_else(|_| defunc(&core).and_then(|d| lower_asm(&d))).expect("program must lower to asm")
}

/// THE WORST PROGRAM THIS PROJECT SHIPS must still lower, with room to spare.
///
/// `MAX_MACHINE_STATES` is the first guard in this tree that a REAL program comes anywhere near, so
/// "never rejects a legitimate program" has to be a test. This is the largest member of
/// `native_oracle.rs`'s `FIRST_ORDER_DEMOS`: 97 tokens, and 49,135 states under `Binary` — 4.9% of
/// the ceiling.
///
/// **A prior version of this test used a different, smaller member of that array (38,070 states)
/// under the mistaken belief that it was the largest.** It was not: `FIRST_ORDER_DEMOS` has 46
/// entries and this file only ever hand-copies one of them, so nothing here re-checks that the
/// hand-copy is still the true maximum. THAT is a different question from whether the SOURCE array
/// has drifted, which `tests/three_way_oracle.rs`'s
/// `first_order_demos_stay_synced_across_all_seven_copies` now checks —
/// `crates/redextape-core/examples/state_cost_probe.rs`'s section G is one of its seven tracked
/// copies, so section G's own array cannot silently go stale. Whether `WORST_SHIPPED_DEMO` here is
/// still that array's max is still a manual step: section G lowers the whole array and prints every
/// member's state count sorted descending — re-run it after `FIRST_ORDER_DEMOS` changes and update
/// `WORST_SHIPPED_DEMO` if the maximum moves.
///
/// THE ASSERTION IS THE RELATION, NOT THE LITERAL. A gadget change that moves the count is fine; a
/// change that puts the shipped demo within 10x of the ceiling is not, and is the thing worth being
/// told about — either the ceiling is too low or a gadget regressed by an order of magnitude.
#[test]
fn the_worst_shipped_demo_lowers_far_below_the_state_ceiling() {
    const WORST_SHIPPED_DEMO: &str = "\
        fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
        fn add1(x) { x + 1 }\n\
        fn ap2(g, a, b) { g(a, b) }\n\
        head(map([1, 2], add1)) + head(ap2(map, [5, 6], add1))";

    let prog = asm_of(WORST_SHIPPED_DEMO);
    let (machine, _) =
        lower_tm_guarded(&prog, &Binary::default()).expect("the worst program this project ships must not be refused");

    assert!(
        machine.states.len() * 10 < MAX_MACHINE_STATES,
        "the shipped map+ap2 demo needs {} states against a ceiling of {MAX_MACHINE_STATES}; \
         a shipped demo within 10x of the ceiling means the ceiling is too low or a gadget regressed",
        machine.states.len()
    );
}

/// A `code` stream longer than the ceiling is a machine larger than the ceiling, because
/// `lower_tm_all` allocates one `pc` entry state per instruction unconditionally — refused here by
/// `lower_tm.rs`'s length pre-check (`if n >= MAX_MACHINE_STATES`) before the `pc` loop runs, so this
/// refusal costs exactly two states (`halt`, `overflow`) — the same figure `lower_tm.rs`'s own doc
/// gives for its pre-checked refusals.
///
/// WHAT THIS TEST PINS, AND HOW. The assertion that `lower_tm_guarded` returns `None` only pins the
/// REFUSAL, not the MECHANISM: `None` is consistent with either "refused by the cheap pre-check,
/// nothing laid out" or "refused later, after the `pc` loop drove `Builder` to its own
/// `MAX_MACHINE_STATES` cap". `Builder`'s internal state count IS observable from outside
/// `lower_tm_all`, though, through the public `lower_tm` — the unguarded entry point — so the second
/// `assert_eq!` below pins the mechanism too: exactly two states means the pre-check fired before the
/// `pc` loop ever ran. Deleting the pre-check turns that assertion red (`lower_tm(&prog,
/// &Unary::default()).states.len()` reads `MAX_MACHINE_STATES` then, not 2) — verified by hand, not
/// left as an unasserted claim.
///
/// It stays fast-tier either way. Even without the pre-check, `n = MAX_MACHINE_STATES + 1`
/// instructions hits `Builder`'s own ceiling after allocating the SAME ~90 MB `build.rs`'s
/// `the_builder_stops_at_the_state_ceiling_and_reports_it` costs — nowhere near the ~727 MB the
/// gadget-expansion case below needs, because `Instr::Halt`'s gadget is one rule on an already-built
/// `pc` state, not a multi-state expansion. The pre-check is what makes this test allocate almost
/// nothing today (two states, not a million); it is not what makes it fast-tier.
#[test]
fn a_code_stream_longer_than_the_ceiling_is_refused() {
    let prog = Program { code: vec![Instr::Halt; MAX_MACHINE_STATES + 1], labels: Vec::new() };
    assert!(
        lower_tm_guarded(&prog, &Unary::default()).is_none(),
        "one pc state per instruction is a lower bound, so this cannot fit and must be refused"
    );
    assert_eq!(
        lower_tm(&prog, &Unary::default()).states.len(),
        2,
        "refused by the cheap length pre-check, before the pc loop lays out anything"
    );
}

/// THE CASE THE LENGTH PRE-CHECK CANNOT CATCH, and the reason `lower_tm_all` checks `overflowed()`
/// once per instruction rather than once at the end: 4,000 instructions is nowhere near the ceiling,
/// but `Box` costs ~571 states each under `Binary`, so the machine is ~2.3M — past it.
///
/// SLOW TIER because tripping the ceiling by expansion means allocating a ceiling's worth of real
/// states first: ~727 MB at the measured 727 bytes a state. The pre-check case above costs nothing
/// and stays in the merge gate; this one is the mechanism, and it is checked where minutes are
/// affordable.
#[test]
#[ignore = "slow tier: allocates ~MAX_MACHINE_STATES real states (~727 MB); run via scripts/check-slow.sh"]
fn a_short_program_whose_gadgets_exceed_the_ceiling_is_refused() {
    let mut code = vec![Instr::Li(Reg::Loc(1), 1)];
    code.extend(std::iter::repeat_n(Instr::Box(Reg::Loc(2), Reg::Loc(1)), 4_000));
    code.push(Instr::Halt);
    let prog = Program { code, labels: Vec::new() };

    assert!(
        lower_tm_guarded(&prog, &Binary::default()).is_none(),
        "4,000 Box gadgets at ~571 states each exceed MAX_MACHINE_STATES; the per-instruction \
         overflowed() check is what must catch it, since the length pre-check waves 4,002 through"
    );
}

/// THE TWO SIDES OF THE LINE, from source rather than hand-built asm — the shape that made this a
/// live defect rather than a latent one.
///
/// A BALANCED expression tree is depth-log, so `lower_asm`'s `MAX_LOWER_DEPTH` never fires and the
/// whole token budget turns into instructions AND slots, which multiply: growth is about
/// O(code.len()^1.9). Left-nested shapes hit the depth guard at ~580 and never get here, which is
/// why `code.len()` LOOKED bounded at 3,472 and why this went unnoticed.
///
/// 1,022 tokens builds 575,861 states (398 MB) and must be ADMITTED — it works today. 4,094 tokens
/// builds 8,595,317 states (6.0 GB) and must be REFUSED — it is fatal in wasm32, and at 16,382 tokens
/// the same shape was killed by `SIGKILL` under an 8 GB budget.
///
/// `balanced`'s ARGUMENT IS A LEAF COUNT, NOT A TOKEN COUNT OR A `code.len()`. The figures above are
/// keyed to `code.len()` in the design doc's own table (512 and 2,048 respectively), which for this
/// shape is `2 * leaves` (one `Li` per leaf, one `Bin` per internal node, one shared `Halt`) — so the
/// leaf counts that reproduce them are HALF those figures: 256 and 1,024. Measured directly against
/// this exact helper: `balanced(0, 256)` lowers to `code.len() == 512`, `n_slots == 511`, and exactly
/// 575,861 states under `Binary` — confirming the figures above describe THESE leaf counts, not 512
/// and 2,048.
///
/// SLOW TIER: the admitted half alone is 398 MB.
#[test]
#[ignore = "slow tier: builds a ~400 MB machine; run via scripts/check-slow.sh"]
fn the_balanced_tree_is_admitted_below_the_ceiling_and_refused_above_it() {
    let admitted = asm_of(&balanced(0, 256));
    let (machine, _) = lower_tm_guarded(&admitted, &Binary::default())
        .expect("1,022 tokens builds 575,861 states, under the ceiling — it must still lower");
    assert!(machine.states.len() < MAX_MACHINE_STATES);
    // Drop the 398 MB admitted machine before building the refused one below: left alive, it would
    // stay resident while the refusal allocates its own ~727 MB (a ceiling's worth of real states
    // before `overflowed()` trips), peaking this one test near 1.13 GB instead of ~727 MB.
    drop(machine);

    let refused = asm_of(&balanced(0, 1_024));
    assert!(
        lower_tm_guarded(&refused, &Binary::default()).is_none(),
        "4,094 tokens builds 8,595,317 states (6.0 GB) and must be refused — this is the program \
         that made the gap a live OOM reachable from the editor, not a latent cast hazard"
    );
}

/// THE END-TO-END ASSERTION, and the one that would have caught the bug this slice's Task 3 exists
/// to prevent: the refusal must arrive at the caller as `TooLarge` and NEVER as `Ran`.
///
/// `lower_tm_guarded` returning `None` (asserted above) is only half of it. `lower_tm_all` answers a
/// refusal with a machine that HALTS IMMEDIATELY, so a version of this that failed to plumb the
/// refusal out would simulate that machine, halt at a state that is not the overflow guard, and come
/// back as `Ran` over tapes that decode to nothing — a plausible-looking wrong answer rather than a
/// crash. That is the defect `lower_and_size`'s doc records having fixed for `MAX_SLOTS` and
/// `MAX_FRAME_LOC`, reachable again through the one guard it cannot pre-check.
///
/// `TooLarge` is what reaches the user as "the machine this program needs is too large to build"
/// (`redextape-wasm`'s `session.rs`), so this also pins that the UI is told the truth.
///
/// SLOW TIER for the same reason as the pair above — the refused program builds a ceiling's worth of
/// states before the per-instruction check stops it.
#[test]
#[ignore = "slow tier: builds a ceiling's worth of states before refusing; run via scripts/check-slow.sh"]
fn a_program_past_the_ceiling_reaches_the_caller_as_too_large() {
    let core = core_of(&balanced(0, 1_024));
    let outcome = run_tm_described(&core, EncodingKind::Binary, Ty::Nat, TM_DEFAULT_CAPS);
    assert!(
        matches!(outcome, Err(TmRun::TooLarge)),
        "a refused program must never come back as Ran over tapes that decode to nothing; got {:?}",
        outcome.map(|d| d.run)
    );
}

/// SOURCE for the width-straddling witness `TmRun::TooLarge`'s doc and the design doc's §3.3b both
/// describe: `300` then 32 `* 2`s then 194 `+ 1`s. Ordinary precedence left-associates the `* 2`
/// chain first, so this is `(300 * 2^32) + 194`, not a flat left-to-right fold.
///
/// **454 asm instructions**, matching the design doc's count: `lower_asm.rs`'s own test doc records
/// that `2 * 3` lowers to two `Li`s and a `Bin` — the FIRST literal on each side needs loading, but a
/// chained step's left operand is already sitting in a register from the step before it, so each
/// subsequent `* 2` or `+ 1` costs one `Li` (the new literal) plus one `Bin`. That is 1 (`Li 300`) +
/// 32 x 2 (`* 2`) + 194 x 2 (`+ 1`) + 1 (`Halt`) = 454.
fn width_straddling_witness_src() -> String {
    let mut s = String::from("300");
    for _ in 0..32 {
        s.push_str(" * 2");
    }
    for _ in 0..194 {
        s.push_str(" + 1");
    }
    s
}

/// **THE LATER-WIDTH REFUSAL, WITNESSED — `TmRun::TooLarge`'s doc claims a refusal can first surface
/// at a width other than the first one tried, and until this test the claim lived only in prose.**
///
/// `MAX_SLOTS`, `MAX_FRAME_LOC` and `MAX_MUL_INSTRS` are properties of the `Program` alone and refuse
/// identically at every width, so `run_tm_fitted`'s width search used to always report a refusal (if
/// any) on its FIRST attempt. `MAX_MACHINE_STATES` broke that: a `Binary`-encoded machine's state
/// count scales with the field width (`lower_tm::MAX_MUL_INSTRS`'s doc measures `Mul` alone as
/// O(width^2)), so a program can lay out fine and run at a narrow width, overflow its value there,
/// and exceed the ceiling only once the search widens to retry it.
///
/// **THE BRANCH'S OWN END-TO-END TEST DOES NOT REACH THIS.**
/// `the_balanced_tree_is_admitted_below_the_ceiling_and_refused_above_it` refuses at every width it
/// is asked to fit, including `MIN_FIELD_WIDTH` — the FIRST width tried — so it cannot tell "refused
/// immediately" apart from "refused only once widened". This witness can, because it straddles: its
/// VALUE overflows a narrow `Binary` field (unremarkable — `Overflow`, not a refusal) while its
/// MACHINE stays under the ceiling at widths 4 and 8 and only exceeds it once `run_tm_fitted` widens
/// to 16 — the state cost growing with width, not the value's own size, is what trips `TooLarge` here.
///
/// SLOW TIER: the refusing attempt (width 16) allocates a ceiling's worth of real states — the same
/// ~727 MB class of cost as the other ceiling tests above — before `overflowed()` catches it.
#[test]
#[ignore = "slow tier: the refusing width (16) allocates a ceiling's worth of states (~727 MB); run via scripts/check-slow.sh"]
fn a_program_is_admitted_at_narrow_widths_and_refused_only_once_widened() {
    let core = core_of(&width_straddling_witness_src());

    // Narrower than the refusing width: lays out and RUNS — the value overflows a field this narrow,
    // which is `Overflow`, not `TooLarge`. Pins that the SAME program is admitted here, so the later
    // refusal below is a width effect on the MACHINE, not a property of the program by itself.
    assert!(
        matches!(run_tm_at(&core, &Binary::at(4), TM_DEFAULT_CAPS), TmRun::Overflow),
        "width 4 must lay out and run, overflowing on the value — not be refused as TooLarge"
    );
    assert!(
        matches!(run_tm_at(&core, &Binary::at(8), TM_DEFAULT_CAPS), TmRun::Overflow),
        "width 8 must lay out and run too — the refusal below must not be the first width tried"
    );

    // `run_tm_fitted` itself: doubles 4 -> 8 -> 16 on `Overflow`, and it is the THIRD attempt where
    // the widened machine — not the value — exceeds `MAX_MACHINE_STATES`. `TooLarge`, and no width is
    // reported, because the program never fit at any of them.
    let (run, width) = run_tm_fitted(&core, &Binary::default(), TM_DEFAULT_CAPS);
    assert!(matches!(run, TmRun::TooLarge), "the widened machine must exceed MAX_MACHINE_STATES, got {run:?}");
    assert_eq!(width, None, "a refused program was never fitted to any width");
}
