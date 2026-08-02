# λ shared-subterm guard — Implementation Plan

**Status: EXECUTED IN FULL, THEN PARTLY REVERTED.** All three tasks landed 2026-07-31 — Task 1 `b832c89`, Task 2 `1652e09`, Task 3 `4ed627b` — exactly as written; nothing was skipped or deferred, and the constants and expected values were unchanged from the plan. **Task 2's guard was then falsified by measurement and reverted (2026-08-01).** `MAX_SHARED_LOGICAL_NODES`, `LowerError::TooShared`, the guard call and its two refusal tests are out of the tree; Task 1's `max_shared_logical_size` and Task 3's instrument stay, and two of Task 2's tests stay reworded to measure rather than gate. **Do not re-apply Task 2 from this plan.** The falsification is the design's **§10**: a two-list program with no recursion scores 4 against the bound of 10,000 and takes 19.0 s in its first β-step, because a step costs `|body| + Abs(body) × |arg|` and neither factor is a sharing property. This plan is a record of what was built, not a description of the tree.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refuse, at lowering time, a λ term containing a shared subterm larger than 10,000 logical nodes — closing the reachable hang without refusing the large *unshared* programs the previous size guard rejected.

**Architecture:** One DAG walk computes each allocation's in-degree; the maximum `logical_size` among allocations with in-degree > 1 is the guard's quantity. `lower_mapped` runs it after building the term and returns `LowerError::TooShared` above the bound.

**Tech Stack:** Rust (stable), `cargo-nextest`. No new dependencies; `redextape-core` stays dependency-free.

Design: [`docs/superpowers/specs/2026-07-31-lambda-shared-subterm-guard-design.md`](../specs/2026-07-31-lambda-shared-subterm-guard-design.md)

## Global Constraints

- **`redextape-core` stays dependency-free** — `cargo tree -p redextape-core --edges normal` shows only itself.
- **No printed byte may move.** Every golden, round-trip, fixture and span test passes **unedited**. A failing expectation is a defect in the change, never an expectation to adjust.
- **No library path may panic.** `[workspace.lints.clippy]` warns `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`; CI runs `-D warnings`. `clippy.toml` exempts code lexically inside `#[test]` fns and bare `#[cfg(test)]` modules only — `tests/` and `examples/` targets need a file-level `#![allow(...)]`.
- **No new `#[allow(...)]`.** **`Rc`, never `Arc`.**
- **`MAX_SHARED_LOGICAL_NODES = 10_000`**, comparison **strictly greater** (`> bound` refuses), matching `MAX_LAMBDA_LOWER_DEPTH`'s convention.
- Test runner is **`cargo nextest run`**, never `cargo test`. Gate is **`scripts/check-all.sh`** (four configurations).
- Branch is `lambda-logical-size-guard` (it already carries the measurement and the falsification record); land with `scripts/land.sh`.

**Non-goals — do not "helpfully" do these** (design §6):

- **Not divergence.** The nesting family is non-terminating at *every* level; L1–L6 still step forever until `MAX_REDUCTION_STEPS`, and that is correct. This guard refuses only cases where a *single step* hangs.
- **Not slow-but-terminating.** The 699-element list takes 35 s and must still lower.
- **Not `lower_group`'s duplication** (the root cause — binding `group` once was measured *not* to close the blow-up).
- **Not target-aware limits** (Plan 5), **not the TM path** (measured linear).
- **No change** to `MAX_TERM_DEPTH`, `MAX_LAMBDA_LOWER_DEPTH`, `MAX_EVAL_DEPTH`, `MAX_DEFUNC_DEPTH`, `shift`'s `assert!`, or the reduction strategy.

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `crates/redextape-core/src/lambda/term.rs` | the term type and its measurements | **add `max_shared_logical_size`**, refactor `logical_size` onto a shared helper |
| `crates/redextape-core/src/lambda/lower.rs` | Core → λ | **add `MAX_SHARED_LOGICAL_NODES`, `LowerError::TooShared`, the guard call** |
| `crates/redextape-core/examples/list_reduction_probe.rs` | the instrument behind the spec's numbers | **commit it** (currently untracked) |

**A performance point the spec does not cover, and the reason Task 1 refactors.** The obvious implementation calls `logical_size` once per shared node. `logical_size` memoizes *per call*, so k shared nodes cost O(k × physical) — quadratic. Task 1 therefore extracts the memoized fold into a private `logical_sizes(t) -> HashMap<usize, u64>`, makes `logical_size` a one-line consumer of it, and has `max_shared_logical_size` look up rather than re-fold. One pass, O(physical), and the two public functions cannot drift because there is one fold.

**Blast radius of the new variant, verified:** there are two distinct `LowerError` types. `lambda::lower::LowerError` is referenced only in `lambda/lower.rs` and `lambda.rs`, both via non-exhaustive `matches!`; every match site in `tm.rs`, `sourcemap.rs`, `tm/attribute.rs`, `tm/defunc.rs` and the examples uses the **TM** one. Adding a variant should compile with no other edits — **report it if the compiler disagrees**, rather than patching silently.

---

### Task 1: `max_shared_logical_size`

**Status: DONE — landed as `b832c89`** ("feat(lambda): measure the largest shared subterm, in O(physical)"), all seven steps as written. `logical_size` moved onto the shared memoized fold, so the two measurements cannot drift.

**Files:**
- Modify: `crates/redextape-core/src/lambda/term.rs`

**Interfaces:**
- Consumes: `LambdaTerm::{node, alloc_id}`, `Node::{Var, Abs, App}`, `var`/`abs`/`app`, existing `logical_size`.
- Produces: `pub fn max_shared_logical_size(t: &LambdaTerm) -> u64`

- [x] **Step 1: Write the failing tests**

Append to `term.rs`'s `#[cfg(test)] mod tests`:

```rust
    /// An unshared term has no shared subterm at all, so the answer is 0 — not "small", zero. That is
    /// what makes the guard SILENT on large unshared programs rather than merely lenient toward them,
    /// and it is the property the previous logical-size guard lacked.
    #[test]
    fn an_unshared_term_has_no_shared_subterm() {
        assert_eq!(max_shared_logical_size(&var(0)), 0);
        assert_eq!(max_shared_logical_size(&abs("x", var(0))), 0);
        assert_eq!(max_shared_logical_size(&app(var(0), var(1))), 0);
        // Structurally identical but SEPARATELY BUILT children are two allocations, not one.
        assert_eq!(max_shared_logical_size(&app(abs("x", var(0)), abs("x", var(0)))), 0);
    }

    /// One allocation referenced twice is shared, and it is reported at its FULL logical size — the
    /// quantity `subst` pays per occurrence it substitutes into.
    #[test]
    fn a_subterm_referenced_twice_is_reported_at_full_size() {
        let c = abs("x", app(var(0), var(0))); // logical size 4
        assert_eq!(logical_size(&c), 4);
        assert_eq!(max_shared_logical_size(&app(c.clone(), c)), 4);
    }

    /// The MAXIMUM over shared subterms, not the first or the sum. A small shared node must not mask a
    /// large one.
    #[test]
    fn the_largest_shared_subterm_wins() {
        let small = abs("s", var(0)); // 2
        let large = abs("l", app(app(var(0), var(0)), app(var(0), var(0)))); // 8
        assert_eq!(logical_size(&small), 2);
        assert_eq!(logical_size(&large), 8);
        let t = app(app(small.clone(), small), app(large.clone(), large));
        assert_eq!(max_shared_logical_size(&t), 8);
    }

    /// THE ONE THAT MATTERS. Like `logical_size`, this must be O(PHYSICAL). A term denoting 2^10001
    /// nodes is 10,001 allocations, every one of them shared — so a version that re-folds per shared
    /// node is quadratic, and one that walks logically never returns. Both pass every test above.
    #[test]
    fn max_shared_is_bounded_by_allocations_not_by_logical_nodes() {
        let mut c = var(0);
        for _ in 0..10_000 {
            c = app(c.clone(), c);
        }
        // Every level shares its child with itself, so the largest shared subterm is the one directly
        // below the root — saturating, exactly as `logical_size` does.
        assert_eq!(max_shared_logical_size(&c), u64::MAX);
    }
```

- [x] **Step 2: Run them and verify they fail**

Run: `cargo nextest run -p redextape-core -E 'test(unshared_term) + test(referenced_twice) + test(largest_shared) + test(max_shared_is_bounded)'`
Expected: FAIL to compile — `cannot find function 'max_shared_logical_size'`.

- [x] **Step 3: Extract the memoized fold, so there is one of it**

Replace `term.rs`'s existing `pub fn logical_size` body with a consumer of a new private helper. Keep the existing doc comment on `logical_size` — only its body changes.

```rust
/// Every allocation's logical size, memoized by allocation identity — the single fold behind both
/// `logical_size` and `max_shared_logical_size`, so the two cannot drift and neither pays O(physical)
/// more than once.
///
/// Iterative, over an explicit `(node, expanded)` stack: a walk added to prevent a stack overflow must
/// not overflow. Children are pushed after their parent's `expanded` marker, so LIFO ordering
/// guarantees every child is sized before the parent that reads it. Saturating, because the measured
/// quantity reaches 2^72 and `u64` holds 2^64.
fn logical_sizes(t: &LambdaTerm) -> HashMap<usize, u64> {
    let mut sizes: HashMap<usize, u64> = HashMap::new();
    let mut stack: Vec<(&LambdaTerm, bool)> = vec![(t, false)];
    while let Some((node, expanded)) = stack.pop() {
        let id = node.alloc_id();
        if sizes.contains_key(&id) {
            continue;
        }
        if !expanded {
            stack.push((node, true));
            match node.node() {
                Node::Var(_) => {}
                Node::Abs(_, b) => stack.push((b, false)),
                Node::App(f, a) => {
                    stack.push((f, false));
                    stack.push((a, false));
                }
            }
            continue;
        }
        // `child_size` cannot miss: the LIFO order above sizes every child before its parent's
        // `expanded` entry is popped. `u64::MAX` rather than `0` on the impossible branch because a
        // guard that UNDER-counts on a bug is a guard that does not guard — this fails toward refusing.
        let child_size = |c: &LambdaTerm| sizes.get(&c.alloc_id()).copied().unwrap_or(u64::MAX);
        let size = match node.node() {
            Node::Var(_) => 1,
            Node::Abs(_, b) => 1u64.saturating_add(child_size(b)),
            Node::App(f, a) => 1u64.saturating_add(child_size(f)).saturating_add(child_size(a)),
        };
        sizes.insert(id, size);
    }
    sizes
}
```

Then `logical_size`'s body becomes exactly:

```rust
    logical_sizes(t).get(&t.alloc_id()).copied().unwrap_or(u64::MAX)
```

- [x] **Step 4: Add the in-degree walk and the new function**

```rust
/// The largest logical size among subterms this term references MORE THAN ONCE.
///
/// **IN-DEGREE, NOT `Rc::strong_count`, and this is load-bearing.** In-degree counts references from
/// within this term. `strong_count` counts every live handle anywhere, so a caller retaining
/// snapshots — which `reduce_trace` does by contract — would inflate it, and the answer would depend
/// on who happened to be holding the term. A measurement whose value changes with observers cannot
/// gate anything.
///
/// Returns **0** when nothing is shared. That is the answer for every unshared term however large,
/// which is exactly why this replaced a guard on total size: a 699-element list literal is ~497,691
/// logical nodes, reduces cleanly in 1,398 steps, and scores 0 here.
///
/// O(PHYSICAL): one walk for in-degree, one memoized fold for sizes, then a lookup per shared node.
/// Calling `logical_size` per shared node instead would be O(shared x physical) — quadratic on exactly
/// the terms this exists to judge.
pub fn max_shared_logical_size(t: &LambdaTerm) -> u64 {
    let mut indeg: HashMap<usize, u32> = HashMap::new();
    let mut expanded: HashSet<usize> = HashSet::new();
    let mut stack: Vec<&LambdaTerm> = vec![t];
    while let Some(node) = stack.pop() {
        if !expanded.insert(node.alloc_id()) {
            continue; // already expanded; its outgoing edges were counted then
        }
        // Written out rather than via a closure: a closure capturing `indeg` mutably would hold that
        // borrow across the `stack.push` calls in the same arm, which is a needless fight with the
        // borrow checker in code whose whole job is to be obviously correct.
        match node.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => {
                *indeg.entry(b.alloc_id()).or_insert(0) += 1;
                stack.push(b);
            }
            Node::App(f, a) => {
                *indeg.entry(f.alloc_id()).or_insert(0) += 1;
                *indeg.entry(a.alloc_id()).or_insert(0) += 1;
                stack.push(f);
                stack.push(a);
            }
        }
    }
    let sizes = logical_sizes(t);
    indeg
        .iter()
        .filter(|(_, &c)| c > 1)
        .filter_map(|(id, _)| sizes.get(id).copied())
        .max()
        .unwrap_or(0)
}
```

Add `use std::collections::HashSet;` to `term.rs`'s imports if it is not already there.

**Note on the root:** it is never counted as shared. Nothing inside a term references its own root — terms are built bottom-up and acyclic — so the root's in-degree is 0 and it never reaches the `> 1` filter. That is correct: refusing a term because *it* is large is the withdrawn guard.

- [x] **Step 5: Run the tests**

Run: `cargo nextest run -p redextape-core -E 'test(unshared_term) + test(referenced_twice) + test(largest_shared) + test(max_shared_is_bounded)'`
Expected: `4 tests run: 4 passed`

- [x] **Step 6: Prove the O(physical) test discriminates**

Sabotage the memoization so the size fold walks logically: in `logical_sizes`, delete **only** the line `if sizes.contains_key(&id) { continue; }`, keeping `sizes.insert(id, size);`. That keeps every returned value *correct* while removing the sharing short-circuit, which is precisely "walks the logical tree".

Run: `cargo nextest run -p redextape-core -E 'test(max_shared_is_bounded)'`
Expected: it **hangs** — kill it after ~30 s. The other three still pass, because their terms are tiny. Restore the line and confirm all four pass.

**Record the observation verbatim in your report.** If the sabotaged version completes, the test does not discriminate and that is a finding.

- [x] **Step 7: Verify no regression and commit**

Run: `cargo nextest run -p redextape-core` (expect 631 + 4 = 635 passed, 3 skipped), then `cargo fmt --check` and `cargo clippy --workspace --all-targets -- -D warnings`.

```bash
git add crates/redextape-core/src/lambda/term.rs
git commit -m "feat(lambda): measure the largest shared subterm, in O(physical)

The quantity that separates a large working term from a large pathological one.
subst copies a shared subterm into every occurrence of the variable, so a big
SHARED subterm makes a single beta-step expensive while a big unshared term is
merely large — which is why a guard on total size refused a 699-element list
that reduces cleanly.

In-degree rather than Rc::strong_count: strong_count counts every live handle,
so a caller retaining snapshots would inflate it and the answer would depend on
who was holding the term.

The memoized fold moves into a shared helper so logical_size and this cannot
drift, and so the new function costs one pass rather than one per shared node —
which would be quadratic on exactly the terms it exists to judge."
```

**Estimate: 1 hour.**

---

### Task 2: The guard

**Status: DONE, THEN REVERTED.** Landed as `1652e09` ("feat(lambda): refuse a term whose shared subterm would hang a step"), all eight steps as written, and the blast radius held — the new variant compiled with no other edits. **Removed 2026-08-01 after measurement falsified the design (§10).** `MAX_SHARED_LOGICAL_NODES` and `LowerError::TooShared` are no longer in `lambda/lower.rs`, and neither is the guard call at the tail of `lower_mapped`. The two tests below that assert refusal are gone; the two that assert a `max_shared` value survive, reworded. **Nothing in this task is to be re-applied.**

**Files:**
- Modify: `crates/redextape-core/src/lambda/lower.rs`

**Interfaces:**
- Consumes: `max_shared_logical_size(&LambdaTerm) -> u64` from Task 1.
- Produces: `LowerError::TooShared { node: NodeId, max_shared: u64 }`, `MAX_SHARED_LOGICAL_NODES: u64 = 10_000`.

- [x] **Step 1: Write the failing tests**

Append to `lower.rs`'s `#[cfg(test)] mod tests`. `core_of` already exists there (`lower.rs:1176`), as does `deep_list`.

```rust
    /// **The program that killed the previous design.** A 699-element list literal is ~497,691 logical
    /// nodes with NO sharing, and it reduces cleanly (1,398 steps, 35 s). The withdrawn logical-size
    /// guard refused it; this one must not, and its `max_shared` must be exactly 0.
    #[test]
    fn a_large_unshared_list_still_lowers() {
        let big = deep_list(MAX_LAMBDA_LOWER_DEPTH as usize - 1);
        let term = lower(&big).expect("a 699-element list must still lower");
        assert_eq!(
            crate::lambda::term::max_shared_logical_size(&term),
            0,
            "a list literal shares nothing; if this is non-zero the lowering changed"
        );
    }

    /// `m+1` nested groups of two mutually recursive functions — the family from `blowup_probe.rs`.
    /// COPIED rather than imported: an example's items are not importable from a unit test.
    fn nested_groups_src(m: u32) -> String {
        let mut body = format!("n + g{m}(n)");
        for k in (0..m).rev() {
            let j = k + 1;
            body = format!("fn f{j}(n) {{ {body} }} fn g{j}(n) {{ f{j}(n) }} g{j}(n) + g{k}(n)");
        }
        format!("fn f0(n) {{ {body} }} fn g0(n) {{ f0(n) }} g0(1)")
    }

    /// The measured boundary, pinned from BOTH sides. Level 6 is the largest observed to step steadily;
    /// level 7 is the smallest where a single step hangs (100% CPU for 15+ s at only 93.6 MB — the hang
    /// is computational, not memory). `nested_groups_src(n)` builds n+1 groups, so these are 6 and 7.
    #[test]
    fn the_guard_refuses_at_the_measured_boundary() {
        let safe = lower(&core_of(&nested_groups_src(5))).expect("6 groups must lower");
        assert_eq!(crate::lambda::term::max_shared_logical_size(&safe), 9_453, "6 groups, pinned");

        let err = lower(&core_of(&nested_groups_src(6))).unwrap_err();
        assert!(matches!(err, LowerError::TooShared { .. }), "7 groups must be refused, got {err:?}");
    }

    /// Nothing in the corpus is newly refused. Its largest `max_shared` is 684 — the three-way mutual
    /// recursion at index 31 of `FIRST_ORDER_DEMOS` — which is 14.6x under the bound.
    #[test]
    fn the_corpus_maximum_is_far_under_the_bound() {
        let core = core_of(
            "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \
             fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } \
             fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)",
        );
        let term = lower(&core).expect("the corpus maximum must lower");
        let shared = crate::lambda::term::max_shared_logical_size(&term);
        assert_eq!(shared, 684, "the corpus maximum, pinned");
        assert!(shared * 10 < MAX_SHARED_LOGICAL_NODES, "the corpus must sit an order of magnitude under");
    }

    /// The error carries the measured figure, because `node` is the root rather than the offending
    /// group and the size is the actionable half.
    #[test]
    fn too_shared_reports_the_measured_size() {
        let Err(LowerError::TooShared { max_shared, .. }) = lower(&core_of(&nested_groups_src(6))) else {
            panic!("expected TooShared");
        };
        assert!(max_shared > MAX_SHARED_LOGICAL_NODES, "reported {max_shared}, must exceed the bound");
    }
```

- [x] **Step 2: Run them and verify they fail**

Run: `cargo nextest run -p redextape-core -E 'test(large_unshared_list) + test(measured_boundary) + test(corpus_maximum) + test(too_shared_reports)'`
Expected: FAIL to compile — no `LowerError::TooShared`, no `MAX_SHARED_LOGICAL_NODES`.

- [x] **Step 3: Add the constant and the variant**

In `lower.rs`, immediately after `MAX_LAMBDA_LOWER_DEPTH` (line 42):

```rust
/// Bounds the largest SHARED subterm of the term `lower` produces — not the term's total size.
///
/// A guard on total size was tried and withdrawn: it refused a 699-element list literal (~497,691
/// logical nodes, no sharing) that reduces cleanly in 1,398 steps. Size is a symptom. The mechanism is
/// duplication — `subst` copies a shared subterm into every occurrence of the variable — so a large
/// SHARED subterm makes one β-step expensive while a large unshared term is merely large.
///
/// Read off a measured gap. Across all 46 `FIRST_ORDER_DEMOS` the maximum is 684 (twelve are zero, and
/// the jump to 400–684 tracks exactly the demos with a recursive cycle, mutual recursion being the only
/// construct here that shares at all). The largest case observed stepping steadily is 9,453; the
/// smallest where one step hangs is 19,085. 10,000 sits in that gap, where nothing of either kind was
/// observed, and 14.6x above the corpus.
///
/// STRICTLY GREATER, so a term whose largest shared subterm is exactly 10,000 lowers. Every bound in
/// `[9,453, 19,085)` accepts and refuses the same programs; 10,000 is an ordinary member, not a special
/// point.
///
/// THIS IS NOT A HALTING ORACLE. The nesting family diverges at every level, and levels 1–6 still step
/// forever until `MAX_REDUCTION_STEPS`. That is correct — divergence is the step cap's job. This guard
/// refuses only the cases where a SINGLE STEP does not return.
const MAX_SHARED_LOGICAL_NODES: u64 = 10_000;
```

**The corpus parenthesis in that doc comment is WRONG and was corrected in the tree after the
whole-branch review**, left standing above because this plan is the record of what was written. Both
halves fail, and the instrument committed in this same slice is what falsified them: **34 of the 46
share something**, in three bands — **4** for the seven `head`/`tail` programs, which have *no*
recursive cycle; **400–684** for the five with a *mutually* recursive group of ≥ 2 members; **6** for
the twenty-two remaining programs declaring a `fn` or a `while`. A self-recursive `fn sum` measures
**6**, not 400–684,
because the multiplier is group SIZE — `lower_group` clones the group term once per member, and a
one-member group costs the same as a non-recursive one. Shipped text: `lambda/lower.rs`'s
`MAX_SHARED_LOGICAL_NODES` doc. Measurement: `list_reduction_probe corpus`.

Add to the `LowerError` enum, after `TooDeep`:

```rust
    /// The lowered term contains a shared subterm larger than `MAX_SHARED_LOGICAL_NODES`, so one
    /// β-step substituting it would not return.
    ///
    /// Named for the cause, and deliberately NOT `TooLarge` — a withdrawn guard used that name for a
    /// total-size bound, and reusing it would blur the distinction this one exists to draw. Distinct
    /// from `TooDeep` for the reason `TmRun::TooLarge` is distinct from `HitCap`: a refused program
    /// never took a step and must not be reported as one that started and hit a cap.
    ///
    /// `node` is the root, not the offending `LetRecGroup` — the measurement runs on the λ term, and
    /// mapping a term position back to Core needs the source map, which `lower_mapped` has and `lower`
    /// does not. `max_shared` is the compensation and is the actionable number.
    TooShared { node: NodeId, max_shared: u64 },
```

- [x] **Step 4: Wire the guard into `lower_mapped`**

Replace `lower_mapped`'s final `Ok((term, origins.pairs))` (around line 210) with:

```rust
    // The SHARING guard, at the end — the deliberate mirror of `too_deep_node` at the start. Depth is a
    // property of the input Core and is knowable BEFORE lowering; sharing is a property of the output
    // term and is not. That is why the two sit at opposite ends of this function, and why a later
    // reader should not tidy them together.
    let max_shared = crate::lambda::term::max_shared_logical_size(&term);
    if max_shared > MAX_SHARED_LOGICAL_NODES {
        return Err(LowerError::TooShared { node: core.id(), max_shared });
    }
    Ok((term, origins.pairs))
```

- [x] **Step 5: Run the new tests**

Run: `cargo nextest run -p redextape-core -E 'test(large_unshared_list) + test(measured_boundary) + test(corpus_maximum) + test(too_shared_reports)'`
Expected: `4 tests run: 4 passed`.

**If any pinned figure disagrees — 0, 9,453, or 684 — stop and report it.** Either the lowering changed or the measurement disagrees with the instrument. **Do not adjust the expected value to match.**

- [x] **Step 6: Confirm the blast radius**

Run: `cargo build --workspace --all-targets`
Expected: clean, no edits outside `lower.rs`. The λ `LowerError` is matched only via non-exhaustive `matches!`. **If the compiler demands an arm anywhere, report where.**

- [x] **Step 7: Run the full gate**

Run: `scripts/check-all.sh`
Expected: green across all four configurations, **zero edited expectations**. The 46-program oracle suite is the real corpus non-regression — it already runs every demo through `run_lambda`, so a guard refusing one would fail it.

- [x] **Step 8: Commit**

```bash
git add crates/redextape-core/src/lambda/lower.rs
git commit -m "feat(lambda): refuse a term whose shared subterm would hang a step

512 bytes of nested mutually recursive fn groups lower to a term whose
reduction reaches a step that does not return — measured at level 7, one step
at 100% CPU for 15+ seconds at only 93.6 MB peak, so the hang is computational
rather than memory. Nothing existing catches it: MAX_TERM_DEPTH is reached
around level 250, and MAX_REDUCTION_STEPS is never consulted because control
never returns from reduce_step.

A guard on total logical size was tried first and withdrawn, because it refused
a 699-element list literal that reduces cleanly. Size is a symptom; the
mechanism is duplication of a shared subterm, and guarding on that separates
the two cases almost binarily — 0 for the list, 19,085 for the smallest
dangerous nesting level.

The bound sits in a measured gap: the corpus maximum is 684, the largest case
that steps steadily is 9,453, and the smallest that hangs is 19,085.

TooShared is named for the cause and deliberately not TooLarge, which was the
withdrawn guard's name."
```

**Estimate: 1 hour.**

---

### Task 3: Commit the instrument and close the record

**Status: DONE — landed as `4ed627b`** ("docs(lambda): commit the sharing instrument and close the record"), all five steps as written. §9's open questions stayed open, as the step said.

**Files:**
- Add: `crates/redextape-core/examples/list_reduction_probe.rs` (currently untracked)
- Modify: `docs/superpowers/specs/2026-07-31-lambda-shared-subterm-guard-design.md` (status)
- Modify: `docs/superpowers/specs/2026-07-31-lambda-logical-size-guard-design.md` (point at its successor)
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

**Interfaces:** none — documentation and an example target.

- [x] **Step 1: Commit the instrument**

`crates/redextape-core/examples/list_reduction_probe.rs` is untracked and is the only re-runnable source for three figures the spec pins: the 699-element list's reduction (1,398 steps, 35 s, 215 MB), the 46-program corpus sharing profile (max 684 at index 31), and the family's `max_shared` per level. **A recorded finding whose repro cannot be re-run is the "non-re-runnable evidence" defect this project has already flagged twice.**

Give it a module doc in the house style: what it demonstrates, how to run each section, and the safety rules — every run under `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0`, never `reduce_trace`, one term alive at a time. An earlier measurement on this project consumed 60 GiB of RAM and 29 GiB of swap.

It duplicates `nested_groups_src` from `blowup_probe.rs` (not `pub` there, so not importable) and its own copy says so. **Leave that as it is** — the duplication is documented at both sites, and de-duplicating it means making an example's items public, which is a change with no other consumer.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --check`
Expected: clean. **Do not run its hazard sections.**

- [x] **Step 2: Update the new spec's status**

Change the shared-subterm design's status line to record that it is implemented, naming the two commits. Tick nothing else — the open questions in §9 stay open.

- [x] **Step 3: Point the withdrawn spec at its successor**

`docs/superpowers/specs/2026-07-31-lambda-logical-size-guard-design.md` records a design that was implemented and falsified. Add a line at the top pointing to the shared-subterm design as what replaced it and why in one sentence, so a reader landing on the withdrawn document is not left following it.

- [x] **Step 4: Update the roadmap**

The roadmap entry currently routes the next λ slice at a *sharing-based* guard, with the falsification as the reason. Record that it landed, what the bound is, and — explicitly — **what it does not close**: divergence (still the step cap's job), slow-but-terminating programs (the 35-second list, Plan 5's caps affordance), and `lower_group`'s duplication (the root cause, still unfixed).

Also record the two facts the measurement turned up that nothing else in the tree knows: level 7's hang is **computational, not memory**, and `MAX_TERM_DEPTH` already bounds large list literals mid-reduction at n≈800 because reduction grows a list's depth to ~4n where its static depth is 2n+2.

- [x] **Step 5: Verify and commit**

Run: `cargo nextest run -p redextape-core` (expect 639 passed, 3 skipped), `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`.

```bash
git add crates/redextape-core/examples/list_reduction_probe.rs docs/
git commit -m "docs(lambda): commit the sharing instrument and close the record

The probe is the only re-runnable source for three figures the spec pins: the
699-element list's reduction, the corpus sharing profile, and the family's
max_shared per level. A recorded finding whose repro cannot be re-run is the
non-re-runnable-evidence defect this project has flagged twice already.

The roadmap records what the guard does NOT close, because a guard named for
sharing will otherwise be read as covering divergence, which remains the step
cap's job, and the root cause in lower_group, which is still unfixed."
```

**Estimate: 45 minutes.**

---

## Where this plan stops

**It does not fix `lower_group`.** Its `group.clone()` is the root cause and predates structural sharing. Binding `group` once was measured *not* to close the blow-up — it relocates the same expansion to reduction time under call-by-name, and moves every pinned step count and `Origins` path in that function. That is a lowering slice with its own design.

~~"This plan makes the program fail **fast and typed** rather than hanging, without refusing the large unshared programs the previous attempt rejected."~~ — **it does not**, and the second half is the trap rather than the achievement. Task 2 was reverted 2026-08-01; the program still hangs and nothing refuses it. Not refusing large *unshared* programs is exactly what makes this guard blind: the 4,821-byte two-list counterexample is a large unshared program that takes 19.0 s in one β-step, so the property this sentence claims as a virtue is the reason the bound cannot see it. What the plan actually delivered is Task 1's `max_shared_logical_size` and Task 3's instrument. (The sibling plan, [`2026-07-31-lambda-logical-size-guard.md`](2026-07-31-lambda-logical-size-guard.md), strikes its identical sentence; this one was missed until the 2026-08-01 sweep.)

**Total: roughly three hours.**
