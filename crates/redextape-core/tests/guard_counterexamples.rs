//! The two programs that falsified the two withdrawn λ blow-up guards, as executable tests.
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
