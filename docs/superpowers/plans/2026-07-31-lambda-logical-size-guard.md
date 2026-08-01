# λ logical-size guard — Implementation Plan

> **HANG CLOSED 2026-08-01 — READ THIS FIRST.** Everywhere below that says the hang is open, that a
> β-step does not finish, or that the next step is a guard, is **superseded**. The hang was closed by
> fixing the root cause rather than by refusing anything: `term.rs`'s `shift` was Θ(logical) and
> destroyed sharing on every β-step, and `reduce.rs`'s `depth_exceeds` walked the logical tree once per
> step. Both now read `u32`s the constructors maintain. The 512-byte program that did not finish one
> β-step in 13 minutes reduces in **7.48 s**; the two-list counterexample went from **19.0 s in its
> first β-step to under a millisecond**.
>
> **The falsifications in this document stand and are why it is kept.** The quantities are unchanged —
> `max_shared` is still 4 on the counterexample, the corpus maximum is still 684 — so the reasoning
> about *why these guards fail* is unaffected. What is stale is every wall-clock figure and every
> forward-looking "next slice". The **per-redex work budget** named as the successor was never built:
> not falsified, made unnecessary. See the λ section of
> [`2026-07-19-redextape-roadmap.md`](2026-07-19-redextape-roadmap.md) and
> `crates/redextape-core/examples/shift_cost_probe.rs`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Status: Tasks 1 and 2 landed. Task 3 was ABANDONED. The goal below was not reached.

| task | status |
| --- | --- |
| 1 — `logical_size` | **landed**, `517f15e` |
| 2 — the β-step curve and the TM check | **landed**, `1d53ed0` (+ `88a588c`, `d738bac` correcting the record and the test literals) |
| 3 — the guard | **abandoned before commit, 2026-07-31** |

**Why Task 3 was abandoned.** It was implemented exactly as specified, and running the full suite
surfaced a regression that falsifies the design's central capability claim. `lambda/lower.rs`'s
pre-existing depth-guard test builds a **699-element list literal** — chosen only to sit at the *depth*
bound — which measures **497,691 logical nodes at a logical/physical ratio of exactly 1.000x**. No
sharing at all: a large program that reduces normally. The size guard refuses it. **A bound on logical
size cannot tell sharing-induced blow-up from a program that is simply big**, and the corpus figure that
calibrated the bound was measured on a list whose largest list literal is `[1, 2, 3]`.

**The decision, made by the human: guard on sharing, not on size.** That is a new slice with its own
design. Full record, with the numbers, in the design's **§10**.

**~~The reachable hang this plan aimed at is still open.~~ ~~— CLOSED 2026-07-31 by the successor slice.~~ — OPEN AGAIN: the successor was reverted 2026-08-01, falsified by measurement (its design's §10).**
Plan: [`2026-07-31-lambda-shared-subterm-guard.md`](2026-07-31-lambda-shared-subterm-guard.md).
Design:
[`../specs/2026-07-31-lambda-shared-subterm-guard-design.md`](../specs/2026-07-31-lambda-shared-subterm-guard-design.md).
That slice made `lower` refuse a term whose largest SHARED subterm exceeded
**`MAX_SHARED_LOGICAL_NODES = 10_000`** with `LowerError::TooShared` (`1652e09`), measured by
`lambda::term::max_shared_logical_size` (`b832c89`) in O(physical). The quantity was the largest shared
subterm — **not** total size, which is what this plan guarded and what the 699-element list falsified,
and **not** the logical/physical ratio either. **It was also not the right quantity.** A step costs
`|body| + Abs(body) × |arg|` and neither factor is a sharing property, so a two-list program with no
recursion measures 4 against a bound of 10,000 while taking 19.0 s in its first β-step. The refusal was
reverted; the measurement stays.

**The abandoned implementation is not in the tree** and must not be re-applied from this plan. Nothing
below Task 2 shipped, and `MAX_LOGICAL_NODES` does not exist.

**Two figures in Task 3's text are wrong and were left standing rather than edited**, because this plan
is now a record of what was attempted: `2,007` is not the corpus maximum (it is `blowup_probe.rs`'s §2b
baseline `fn a/b/c … a(5)`, which is not in `FIRST_ORDER_DEMOS`; the real maximum is **2,173**, the
`s0`/`s1`/`s2` program the test literal already uses), and "150x under" is **138x**. Both corrected in
the design's §4, measured 2026-07-31.

---

**Goal:** ~~Refuse, at lowering time, a λ term whose logical size exceeds 300,000 nodes — closing the reachable hang where 512 bytes of ordinary source produce a β-step that does not finish.~~ **Not reached — see the status block above.**

**Architecture:** A memoized fold computes a term's *logical* size (nodes reached walking both children of every `App`) in O(*physical*) time by caching per allocation. `lower_mapped` runs it after building the term and returns a new `LowerError::TooLarge` above the bound. Nothing else changes.

**Tech Stack:** Rust (stable), `cargo-nextest`. No new dependencies; `redextape-core` stays dependency-free.

Design: [`docs/superpowers/specs/2026-07-31-lambda-logical-size-guard-design.md`](../specs/2026-07-31-lambda-logical-size-guard-design.md)

## Global Constraints

- **`redextape-core` stays dependency-free** — `cargo tree -p redextape-core --edges normal` shows only itself.
- **No printed byte may move.** Every golden, round-trip, fixture and span test passes **unedited**.
- **No library path may panic.** `[workspace.lints.clippy]` warns `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`; CI runs `-D warnings`. `clippy.toml` exempts code lexically inside `#[test]` fns and bare `#[cfg(test)]` modules only — `tests/` and `examples/` targets need a file-level `#![allow(...)]`.
- **No new `#[allow(...)]`.**
- **`Rc`, never `Arc`.**
- Test runner is **`cargo nextest run`**, never `cargo test`.
- Gate is **`scripts/check-all.sh`** (four feature configurations).
- Land with `scripts/land.sh` as one gated commit.

**Non-goals — do not "helpfully" do these** (design §8):

- **Not the `subst` rewrite.** Recorded in the structural-sharing design's §10; it is performance, this is robustness.
- **Not `lower_group`'s duplication.** Binding `group` once was *measured* not to close the blow-up — it relocates the same expansion to reduction time under call-by-name — and it moves every pinned step count and `Origins` path.
- **Not target-aware depth limits.** Nine stack-calibrated constants across eight files, needing a WASM build to calibrate. Plan 5's first task.
- **Not non-progress detection.** Recorded under Plan 5 in the roadmap.
- **No change to `MAX_TERM_DEPTH`, `MAX_LAMBDA_LOWER_DEPTH`, `MAX_EVAL_DEPTH`, `MAX_DEFUNC_DEPTH`, `shift`'s `assert!`, or the reduction strategy.**

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `crates/redextape-core/src/lambda/term.rs` | the term type and its measurements | **add `logical_size`** + tests |
| `crates/redextape-core/src/lambda/lower.rs` | Core → λ | **add `MAX_LOGICAL_NODES`, `LowerError::TooLarge`, the guard call** + tests |
| `crates/redextape-core/examples/blowup_probe.rs` | the hazard instrument | replace its private `logical()` with the shared one; add the β-step curve section |

**Task order matters.** Task 2 measures the β-step curve *past* the bound, which Task 3's guard then
refuses — so measuring must come first, or the curve becomes unmeasurable through the public API.
That is also the honest order: the bound gets chosen with the curve in hand rather than before it.
| `docs/superpowers/specs/2026-07-31-lambda-logical-size-guard-design.md` | the record | §4's margin, confirmed or moved |

**Blast radius of the new variant, verified before writing this plan:** there are **two** distinct `LowerError` types — `lambda::lower::LowerError` (`StatefulClosure`, `Unsupported`, `TooDeep`) and `tm::lower_asm::LowerError` (`Unsupported`, `TooDeep`). Every match site in `tm.rs`, `sourcemap.rs`, `tm/attribute.rs`, `tm/defunc.rs`, `examples/tm_demo.rs` and `examples/step_survey.rs` uses the **TM** one. The λ one is referenced only in `lambda/lower.rs` and `lambda.rs`, both via non-exhaustive `matches!`. **Adding a variant should compile with no other edits** — if the compiler disagrees, that is information worth reporting, not a site to patch silently.

---

### Task 1: `logical_size`

The measurement, alone and testable. The subtle part is that it must be O(*physical*) — a fold that walked logically would *be* the hang this slice exists to refuse, and would pass every test that does not specifically catch it.

**Files:**
- Modify: `crates/redextape-core/src/lambda/term.rs`

**Interfaces:**
- Consumes: `LambdaTerm::{node, alloc_id}`, `Node::{Var, Abs, App}`, `var`/`abs`/`app` — all already `pub` in `term.rs`.
- Produces: `pub fn logical_size(t: &LambdaTerm) -> u64`

- [x] **Step 1: Write the failing tests**

Append to `term.rs`'s `#[cfg(test)] mod tests`:

```rust
    /// Exact small cases, countable by eye. A tree with no sharing has logical size == node count.
    #[test]
    fn logical_size_counts_the_denoted_tree() {
        assert_eq!(logical_size(&var(0)), 1);
        assert_eq!(logical_size(&abs("x", var(0))), 2);
        assert_eq!(logical_size(&app(var(0), var(1))), 3);
        assert_eq!(logical_size(&abs("x", app(var(0), var(0)))), 4);
    }

    /// A shared child is counted ONCE PER EDGE, not once per allocation — that is the entire
    /// distinction being measured. `c = app(c.clone(), c)` applied n times is n+1 allocations
    /// denoting 2^(n+1) - 1 nodes.
    #[test]
    fn logical_size_counts_shared_subterms_once_per_edge() {
        let mut c = var(0);
        for n in 0..12u32 {
            assert_eq!(logical_size(&c), (1u64 << (n + 1)) - 1, "at depth {n}");
            c = app(c.clone(), c);
        }
    }

    /// THE ONE THAT MATTERS. The fold must be O(physical), so a term denoting 2^10001 nodes must
    /// still measure instantly. A fold that walked the logical tree would pass every test above and
    /// hang here — which is precisely the failure this whole slice exists to refuse.
    ///
    /// Saturation is the expected answer, not a defect: `u64` holds 2^64 and this denotes 2^10001.
    #[test]
    fn logical_size_is_bounded_by_allocations_not_by_logical_nodes() {
        let mut c = var(0);
        for _ in 0..10_000 {
            c = app(c.clone(), c);
        }
        assert_eq!(logical_size(&c), u64::MAX, "an astronomically large term saturates");
    }

    /// `parse_lambda` builds fresh nodes with no sharing, so a parsed term's logical size equals its
    /// allocation count. Design §9 argued this rather than testing it; this is the test.
    #[test]
    fn a_parsed_term_has_no_sharing() {
        let t = crate::lambda::parse_lambda("\\f. \\x. f (f (f x))").expect("parses");
        let mut seen = std::collections::HashSet::new();
        let mut stack = vec![&t];
        while let Some(n) = stack.pop() {
            seen.insert(n.alloc_id());
            match n.node() {
                Node::Var(_) => {}
                Node::Abs(_, b) => stack.push(b),
                Node::App(f, a) => {
                    stack.push(f);
                    stack.push(a);
                }
            }
        }
        assert_eq!(logical_size(&t), seen.len() as u64, "a parsed term must have no shared allocations");
    }
```

- [x] **Step 2: Run them and verify they fail**

Run: `cargo nextest run -p redextape-core -E 'test(logical_size) + test(a_parsed_term_has_no_sharing)'`
Expected: FAIL to compile — `cannot find function 'logical_size' in this scope`.

- [x] **Step 3: Implement the fold**

Add to `term.rs`, after `impl LambdaTerm`. Add `use std::collections::HashMap;` to the file's imports.

```rust
/// The number of nodes reached by walking BOTH children of every `App` — the size of the tree this
/// term DENOTES, as distinct from the DAG that stores it. Under structural sharing the two diverge
/// without bound: 9,541 allocations can denote 2^72 nodes.
///
/// **O(PHYSICAL), NOT O(LOGICAL), AND THAT IS THE WHOLE POINT.** Each allocation's size is computed
/// once and memoized by allocation identity, so a term denoting an astronomical number of nodes still
/// folds in microseconds. A version that walked the logical tree would BE the hang this measurement
/// exists to refuse — `logical_size_is_bounded_by_allocations_not_by_logical_nodes` is the test that
/// tells the two apart, and every other test here passes either way.
///
/// Iterative, over an explicit `(node, expanded)` stack: a walk added to prevent a stack overflow must
/// not overflow. Children are pushed after their parent's `expanded` marker, so LIFO ordering
/// guarantees every child is sized before the parent that reads it.
///
/// Saturating. The measured quantity reaches 2^72 and `u64` holds 2^64, so the result is a FLOOR:
/// exact below `u64::MAX`, and `u64::MAX` meaning "at least that much". Callers comparing against a
/// bound far below saturation are unaffected; anything wanting an exact count must check for
/// `u64::MAX` first.
pub fn logical_size(t: &LambdaTerm) -> u64 {
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
        // guard that UNDER-counts on a bug is a guard that does not guard — this fails toward
        // refusing, which is the safe direction for the one caller.
        let child_size = |c: &LambdaTerm| sizes.get(&c.alloc_id()).copied().unwrap_or(u64::MAX);
        let size = match node.node() {
            Node::Var(_) => 1,
            Node::Abs(_, b) => 1u64.saturating_add(child_size(b)),
            Node::App(f, a) => 1u64.saturating_add(child_size(f)).saturating_add(child_size(a)),
        };
        sizes.insert(id, size);
    }
    sizes.get(&t.alloc_id()).copied().unwrap_or(u64::MAX)
}
```

- [x] **Step 4: Run the tests**

Run: `cargo nextest run -p redextape-core -E 'test(logical_size) + test(a_parsed_term_has_no_sharing)'`
Expected: `4 tests run: 4 passed`

- [x] **Step 5: Prove the O(physical) test is non-vacuous**

Temporarily replace the memoization with a logical walk — delete the `if sizes.contains_key(&id) { continue; }` line **and** the `sizes.insert(id, size);` line, so nothing is ever cached.

Run: `cargo nextest run -p redextape-core -E 'test(logical_size_is_bounded)'`
Expected: it **hangs** (kill it after ~30 s). The other three still pass. That asymmetry is the proof the test discriminates. Restore both lines and confirm all four pass again. **Record the observation verbatim in your report** — if the sabotaged version completes, the test is not measuring what it claims.

- [x] **Step 6: Commit**

```bash
git add crates/redextape-core/src/lambda/term.rs
git commit -m "feat(lambda): measure a term's logical size in O(physical)

Under structural sharing a term's logical size — nodes reached walking both
children of every App — diverges without bound from its allocation count:
9,541 allocations can denote 2^72 nodes. The guard that needs this number
cannot afford to walk the tree it is measuring, so the fold memoizes per
allocation and costs O(physical).

Saturating, because the quantity exceeds u64. The result is a floor, and the
doc says so, since a caller treating u64::MAX as exact would be wrong.

The O(physical) property is pinned by its own test and verified non-vacuous by
sabotage: with memoization removed, that test hangs while the other three pass."
```

**Estimate: 45 minutes.**

---

### Task 2: Measure the β-step curve, and check the TM path

**This task must precede the guard.** Once the guard lands, `lower` refuses above the bound, so the
curve past it becomes unmeasurable through the public API. Measuring first is also the honest order:
the bound gets chosen *with* the curve rather than before it.

Design §4 records that 300,000 sits 2x under a **single** observed hang. §7 makes converting that into
a curve part of this slice. §8 requires the TM path's immunity be verified rather than asserted.

**Files:**
- Modify: `crates/redextape-core/examples/blowup_probe.rs`
- Modify: `docs/superpowers/specs/2026-07-31-lambda-logical-size-guard-design.md` (§4's margin, §8's TM claim)

**Interfaces:**
- Consumes: `logical_size(&LambdaTerm) -> u64` from Task 1.
- Produces: a confirmed or corrected value for `MAX_LOGICAL_NODES`, which Task 3 uses.

**SAFETY, AND IT IS NOT OPTIONAL.** A previous attempt at this measurement consumed 60 GiB of RAM and
29 GiB of swap and wedged the machine. The cause was `reduce_trace`, which materializes every step by
contract.

- **Never call `reduce_trace`.** Use `crate::trace::LambdaCursor`, which steps lazily.
- **Take exactly one step per level.** Hold no more than one term.
- **Run every measurement under** `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0`.
- **Ramp upward from level 1**, printing each row with an explicit flush *before* computing the next.
  Stop at the first level over a 10-second budget. A term at level 20 denotes ~2^30 nodes; jumping
  there discovers the problem the expensive way.

- [x] **Step 1: Delete the probe's private `logical()` in favour of the shared one**

`blowup_probe.rs` carries its own logical-size fold. Replace every call with
`redextape_core::lambda::term::logical_size` and delete the local copy. Two copies of one measurement
is the drift this project keeps paying for, and the probe's committed figures are what cross-checks
the survivor.

Run: `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- cargo run --release --example blowup_probe -p redextape-core`
Expected: the committed table reproduces **exactly** — 306 / 908 / 4,520 / 76,760 / 307,928 logical at
levels 1 / 2 / 4 / 8 / 10. **If any figure moved, the two folds disagreed** — report that rather than
adopting the new numbers.

- [x] **Step 2: Add the β-step curve section**

Add to `blowup_probe.rs`, and give it its own `--beta-curve` argument alongside the existing sections:

```rust
/// One CURSOR step's wall-clock against the term's logical size, up the nesting family.
/// `LambdaCursor::next` runs `depth_exceeds` over the full logical tree before every β-step, so each
/// row is the depth guard PLUS a β-step — an UPPER BOUND on the β-step, not its cost alone. Label the
/// column for that.
///
/// NEVER `reduce_trace`: it materializes every step by contract, and a previous run of this
/// measurement consumed 60 GiB of RAM and 29 GiB of swap doing exactly that. `LambdaCursor` steps
/// lazily and this holds one term at a time.
///
/// The number this exists to produce is THE LOGICAL SIZE AT WHICH ONE STEP STOPS BEING TOLERABLE.
/// `MAX_LOGICAL_NODES` is then chosen with real margin under it, rather than 2x under a single
/// observed hang.
fn beta_curve() {
    use std::io::Write;
    line("");
    line("PART D — one cursor step (depth guard + β-step), against logical size");
    line("");
    println!("{:>7}  {:>8}  {:>14}  {:>12}", "levels", "source", "logical", "cursor step");
    for levels in 1..=64usize {
        let src = nested_groups_src(levels);
        let (prog, ds) = redextape_core::parser::parse(&src);
        assert!(ds.is_empty(), "level {levels} must parse");
        let core = redextape_core::desugar::desugar(&prog.expect("parses"));
        let Ok(term) = redextape_core::lambda::lower(&core) else {
            println!("level {levels}: lower refused — stopping");
            break;
        };
        let logical = logical_size(&term);
        let t0 = Instant::now();
        let mut cursor = redextape_core::trace::LambdaCursor::new(&term, 1);
        let _ = cursor.next();
        let dt = t0.elapsed().as_secs_f64();
        println!("{levels:>7}  {:>7}B  {logical:>14}  {dt:>9.3} s", src.len());
        let _ = std::io::stdout().flush();
        if dt > 10.0 {
            println!("");
            println!("over budget at {levels} levels, {logical} logical nodes.");
            println!("choose MAX_LOGICAL_NODES with margin BELOW that figure.");
            break;
        }
    }
}
```

The family generator (`nested_groups_src`) already exists in `blowup_probe.rs` from the investigation —
reuse it, do not write a second one.

- [x] **Step 3: Run it**

Run: `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- cargo run --release --example blowup_probe -p redextape-core -- --beta-curve`
Expected: a table ending at the first level over budget. **Record the logical size at that level** — it
is the number Task 3's bound must sit under.

If the run is OOM-killed rather than exceeding the time budget, that is also an answer: report the
level and the logical size at which it died.

- [x] **Step 4: Check the TM path for the same divergence**

Design §8 claims `lower_asm`/`defunc` produce a `Vec<Instr>` with no structural sharing, so no
logical/physical divergence can exist there. **Verify it rather than repeating it.**

Run the same nesting family through `run_tm` at levels 1, 4, 8 and 12 and report what actually bounds
it — `MAX_SLOTS`, `MAX_LOWER_DEPTH`, `MAX_DEFUNC_DEPTH`, `TmRun::TooLarge`, or nothing at all. Use the
same memory cap. If the TM path turns out to have an analogous hazard, that is a finding for its own
slice — **report it, do not fix it here.**

- [x] **Step 5: Record the result in the spec**

Rewrite design §4's "The margin, stated rather than smoothed" with the measured curve: the
intolerability threshold, the real margin under it, and whether 300,000 is confirmed.

**If the measurement says 300,000 is too loose, say so plainly and stop.** Changing the constant is a
decision for the human, exactly as its original choice was — Task 3 will use whatever this task
concludes. Add the Step 4 TM finding to §8, replacing the asserted claim with the verified one.

- [x] **Step 6: Commit**

```bash
git add crates/redextape-core/examples/blowup_probe.rs docs/superpowers/specs/2026-07-31-lambda-logical-size-guard-design.md
git commit -m "measure(lambda): turn the guard's one data point into a curve

300,000 was chosen 2x under a single observed hang, which is not a margin, it
is a coincidence with one witness. This times a single beta-step up the nesting
family and reports where one stops being tolerable, so the bound is defended
the way every other constant in this tree is.

Measured before the guard exists, deliberately: once lower refuses above the
bound, the curve past it cannot be measured through the public API.

The probe's private logical-size fold is deleted in favour of the shared one.
Two copies of a measurement is the drift this project keeps paying for, and the
probe's committed figures are what cross-checks the survivor.

Also verifies rather than assumes that the TM path has no analogous
divergence."
```

**Estimate: 1.5 hours**, most of it Step 3.

---

### Task 3: The guard — ABANDONED 2026-07-31, DO NOT IMPLEMENT

**This task was carried out in full and withdrawn before commit. Its steps are left unticked and its
text left standing, as the record of what was attempted.** Steps 3, 4 and 6 worked exactly as written —
the constant, the variant and the guard call landed cleanly, and the blast-radius prediction held with
no edit required outside `lower.rs`. Step 7 is where it died: the full suite surfaced a pre-existing
depth-guard test that the size guard breaks, on a **699-element list literal at ratio 1.000x**. The
design's central capability claim is false, the decision is to guard on **sharing** instead, and that is
a new slice. See the status block at the top of this file and the design's §10.

**Three things in the steps below are known wrong and are deliberately not corrected.** The corpus test
pins `2,007`, which is neither the corpus maximum (**2,173**) nor a corpus program at all; Step 3's doc
comment repeats it; and no step anticipated the interaction with `MAX_LAMBDA_LOWER_DEPTH`, which is the
whole finding. **Anyone re-planning this must start from the design's §10, not from here.**

**Files:**
- Modify: `crates/redextape-core/src/lambda/lower.rs`

**Interfaces:**
- Consumes: `logical_size(&LambdaTerm) -> u64` (Task 1); the intolerability threshold measured in Task 2.
- Produces: `LowerError::TooLarge { node: NodeId, logical: u64 }`, `MAX_LOGICAL_NODES: u64`.

**Use the value Task 2 concluded.** The spec proposes 300,000; if Task 2's curve showed that is too
loose and the human chose a different number, use theirs and say so in your report. Every figure below
assumes 300,000 — if the bound moved, the level thresholds in the tests move with it, and you must
re-derive them from the probe's table rather than adjusting assertions until they pass.

- [ ] **Step 1: Write the failing tests**

Append to `lower.rs`'s `#[cfg(test)] mod tests`. `core_of` already exists there (`lower.rs:1176`).

Both programs are literals rather than generated, so this module does not grow a second copy of the
probe's family generator. Their logical sizes are the probe's committed figures.

**Say "groups", never "level", when regenerating these.** `blowup_probe`'s `nested_groups_src(m)`
produces **m+1** groups, so the argument and the group count are one apart, and both of these literals
were once written a level off because of it — the under-bound constant held `nested_groups_src(8)`
(9 groups, 415 B, **153,816** logical) under a doc comment claiming 76,760, which made
`the_nesting_literals_match_the_probes_figures` an assertion that could not pass. Derive replacements by
running the generator, never by hand-editing the string in place.

```rust
    /// **8 groups** of the investigation's nesting family — 369 bytes, 76,760 logical nodes. Under the
    /// bound, so it must still lower. Regenerate with `blowup_probe`'s `nested_groups_src(7)` if this
    /// ever needs updating — that function takes m and yields m+1 groups — and it is a literal here so
    /// the test module does not carry a second copy of the generator.
    const NESTED_UNDER_BOUND: &str = "fn f0(n) { fn f1(n) { fn f2(n) { fn f3(n) { fn f4(n) { fn f5(n) { fn f6(n) { fn f7(n) { n + g7(n) } fn g7(n) { f7(n) } g7(n) + g6(n) } fn g6(n) { f6(n) } g6(n) + g5(n) } fn g5(n) { f5(n) } g5(n) + g4(n) } fn g4(n) { f4(n) } g4(n) + g3(n) } fn g3(n) { f3(n) } g3(n) + g2(n) } fn g2(n) { f2(n) } g2(n) + g1(n) } fn g1(n) { f1(n) } g1(n) + g0(n) } fn g0(n) { f0(n) } g0(1)";

    /// **10 groups**, 461 bytes, 307,928 logical nodes — the smallest member of the family the guard
    /// refuses, and the first size measured overshooting a 90 s budget to ~330 s without being observed
    /// to finish. One group further (11 groups, 512 bytes, 616,152) is the documented hang, where a
    /// β-step did not return in 13 minutes at 974 MB; that step is a LATER one, not the first, which
    /// `--beta-curve` settles by timing one cursor step — the depth guard plus the first β-step — at
    /// 50 ms, an upper bound on that step. Regenerate with `nested_groups_src(9)`.
    const NESTED_OVER_BOUND: &str = "fn f0(n) { fn f1(n) { fn f2(n) { fn f3(n) { fn f4(n) { fn f5(n) { fn f6(n) { fn f7(n) { fn f8(n) { fn f9(n) { n + g9(n) } fn g9(n) { f9(n) } g9(n) + g8(n) } fn g8(n) { f8(n) } g8(n) + g7(n) } fn g7(n) { f7(n) } g7(n) + g6(n) } fn g6(n) { f6(n) } g6(n) + g5(n) } fn g5(n) { f5(n) } g5(n) + g4(n) } fn g4(n) { f4(n) } g4(n) + g3(n) } fn g3(n) { f3(n) } g3(n) + g2(n) } fn g2(n) { f2(n) } g2(n) + g1(n) } fn g1(n) { f1(n) } g1(n) + g0(n) } fn g0(n) { f0(n) } g0(1)";

    /// The two literals above must be the programs the probe measured, not merely programs of a
    /// similar shape. If these figures disagree with the probe's committed table, every bound assertion
    /// below is measuring something else — fix the literals, never the expected values.
    ///
    /// **The byte lengths are what pin `NESTED_OVER_BOUND`, and they are not decoration.**
    /// `logical_size` cannot be called on it: `lower` returns `Err` by construction, so the term never
    /// exists. Every other test below passes for ANY member of this family above the bound — including
    /// the 11-group, 512-byte literal that sat here before the group/level off-by-one was corrected.
    /// The length is the one cheap check that tells family members apart: 512 ≠ 461 and 415 ≠ 369, so
    /// both wrong literals fail here loudly instead of passing everywhere silently.
    #[test]
    fn the_nesting_literals_match_the_probes_figures() {
        assert_eq!(NESTED_UNDER_BOUND.len(), 369, "8 groups");
        assert_eq!(NESTED_OVER_BOUND.len(), 461, "10 groups");
        let under = lower(&core_of(NESTED_UNDER_BOUND)).expect("8 groups lowers");
        assert_eq!(crate::lambda::term::logical_size(&under), 76_760, "8 groups");
    }

    /// The blow-up is refused before a step is taken.
    #[test]
    fn the_blowup_repro_is_refused() {
        let err = lower(&core_of(NESTED_OVER_BOUND)).unwrap_err();
        assert!(matches!(err, LowerError::TooLarge { .. }), "got {err:?}");
    }

    /// The guard admits everything below it and refuses only above — the same shape as the depth
    /// guard's `the_guard_admits_a_core_at_the_bound_and_refuses_only_past_it`. The comparison is
    /// strictly greater, so a term of exactly `MAX_LOGICAL_NODES` lowers.
    #[test]
    fn the_size_guard_refuses_only_above_the_bound() {
        assert!(lower(&core_of(NESTED_UNDER_BOUND)).is_ok(), "8 groups, 76,760 logical, is under the bound and must lower");
        assert!(
            matches!(lower(&core_of(NESTED_OVER_BOUND)), Err(LowerError::TooLarge { .. })),
            "10 groups, 307,928 logical, is over the bound and must be refused"
        );
    }

    /// Nothing the corpus contains is newly refused. Its largest lowered term is three mutually
    /// recursive `fn`s at 2,007 logical nodes — orders of magnitude under.
    #[test]
    fn the_corpus_shape_lowers_far_under_the_bound() {
        let core = core_of(
            "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \
             fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } \
             fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)",
        );
        let term = lower(&core).expect("the corpus's largest program must lower");
        let size = crate::lambda::term::logical_size(&term);
        assert_eq!(size, 2_007, "the corpus maximum, pinned");
        assert!(size * 100 < MAX_LOGICAL_NODES, "the corpus must sit orders of magnitude under the bound");
    }

    /// The error carries the measured size, because the `node` it reports is the root rather than the
    /// offending group (design §5) and the size is the actionable half.
    #[test]
    fn too_large_reports_the_measured_size() {
        let Err(LowerError::TooLarge { logical, .. }) = lower(&core_of(NESTED_OVER_BOUND)) else {
            panic!("expected TooLarge");
        };
        assert!(logical > MAX_LOGICAL_NODES, "reported {logical}, must exceed {MAX_LOGICAL_NODES}");
    }
```

- [ ] **Step 2: Run them and verify they fail**

Run: `cargo nextest run -p redextape-core -E 'test(nesting_literals) + test(blowup_repro) + test(size_guard_refuses) + test(corpus_shape_lowers) + test(too_large_reports)'`
Expected: FAIL to compile — no `LowerError::TooLarge`, no `MAX_LOGICAL_NODES`.

- [ ] **Step 3: Add the constant and the variant**

In `lower.rs`, immediately after `MAX_LAMBDA_LOWER_DEPTH` (line 42):

```rust
/// Bounds the LOGICAL size of the term `lower` produces — nodes reached walking both children of
/// every `App`, which under structural sharing is unbounded above the allocation count.
///
/// Read off the measured curve, NOT computed from a growth law. The corpus's largest lowered term is
/// 2,007 logical nodes; the smallest program observed to hang is ~616,000 (512 bytes of nested
/// mutually recursive `fn`s, which reach a β-step that ran 13 minutes without finishing — a LATER
/// step, not the first, which on that same term is under the 50 ms `--beta-curve` measures for one
/// cursor step, depth guard included). An earlier derivation multiplied 2,007 by a doubling factor and
/// produced 1,000,000 — which lets that program straight through, because 2,007 is not one level of
/// that family, which starts at 306. Node count is the only quantity that transfers between program
/// shapes.
///
/// WHY THIS GUARD AND NOT ONE OF THE EXISTING ONES. `MAX_TERM_DEPTH` never fires — depth grows ~12 per
/// nesting level, so 3,000 is reached around level 250, at a logical ratio of 2^250.
/// `MAX_REDUCTION_STEPS` never fires either, because control never returns from `reduce_step` to
/// consult it, and neither would a wall-clock budget between steps: a measured 90 s budget produced a
/// 330-second run. Everything checked BETWEEN steps shares one blind spot, and this failure is INSIDE
/// a step.
const MAX_LOGICAL_NODES: u64 = 300_000;
```

Add to the `LowerError` enum, after `TooDeep`:

```rust
    /// The lowered term denotes more than `MAX_LOGICAL_NODES` nodes, so reducing it would not finish.
    ///
    /// Distinct from `TooDeep` on purpose, the same way `TmRun::TooLarge` is distinct from `HitCap`:
    /// `TooDeep` says the input Core nests too deeply, `TooLarge` says the OUTPUT term is too big to
    /// reduce. Different causes, and different fixes for whoever wrote the program.
    ///
    /// `node` is the root, not the offending `LetRecGroup` — the measurement runs on the λ term, and
    /// mapping a term position back to Core needs the source map, which `lower_mapped` has and `lower`
    /// does not. `logical` is the compensation, and is a saturating floor (see `logical_size`).
    TooLarge { node: NodeId, logical: u64 },
```

- [ ] **Step 4: Wire the guard into `lower_mapped`**

Replace `lower_mapped`'s final `Ok((term, origins.pairs))` (around line 210) with:

```rust
    // The SIZE guard, at the end — the deliberate mirror of `too_deep_node` at the start. Depth is a
    // property of the input Core and is knowable BEFORE lowering; size is a property of the output
    // term and is not. That is why the two sit at opposite ends of this function, and why a later
    // reader should not tidy them together.
    let logical = crate::lambda::term::logical_size(&term);
    if logical > MAX_LOGICAL_NODES {
        return Err(LowerError::TooLarge { node: core.id(), logical });
    }
    Ok((term, origins.pairs))
```

- [ ] **Step 5: Run the new tests**

Run: `cargo nextest run -p redextape-core -E 'test(nesting_literals) + test(blowup_repro) + test(size_guard_refuses) + test(corpus_shape_lowers) + test(too_large_reports)'`
Expected: `5 tests run: 5 passed`.

If `the_nesting_literals_match_the_probes_figures` or `the_corpus_shape_lowers_far_under_the_bound`
reports a size other than the pinned one, **stop and report it**. Either the literal is not the program
the probe measured, or the lowering changed. **Do not adjust the expected value to match.**

- [ ] **Step 6: Confirm the blast radius was as predicted**

Run: `cargo build --workspace --all-targets`
Expected: clean, with no edits outside `lower.rs`. The λ `LowerError` is matched only via
non-exhaustive `matches!`, so the new variant should require no arms elsewhere. **If the compiler
demands one, report where** — it means a consumer this plan did not find matches exhaustively.

- [ ] **Step 7: Run the full gate**

Run: `scripts/check-all.sh`
Expected: green across all four configurations, with **zero edited expectations**. The 46-program
oracle suite is the real corpus non-regression here — it already runs every demo through `run_lambda`,
so a guard that refused one would fail it.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/src/lambda/lower.rs
git commit -m "feat(lambda): refuse a term too large to reduce, at lowering time

512 bytes of ordinary surface syntax — eleven nested two-member mutually
recursive fn groups — lower to 616,152 logical nodes, and reducing that term
reaches a beta-step that ran 13 minutes at 974 MB without completing. It is not
the first step: one cursor step there — the depth guard plus that beta-step — is
50 ms, so the step itself is under that. The cost accrues across the run,
because a step's output can be |body| x |arg| nodes and the next step
starts from that output. lower_group clones the whole group term once per
member, which is linear in the member count and exponential once the groups
nest, because a member body is a block that may declare its own group.

Nothing existing catches it. MAX_TERM_DEPTH is reached around 250 nesting
levels, at a ratio of 2^250. MAX_REDUCTION_STEPS is never consulted, because
control never returns from reduce_step. A wall-clock budget between steps does
not help either: 90 s was measured producing a 330-second run. Everything that
runs between steps shares one blind spot, and this failure is inside a step —
which is the whole argument for guarding here rather than in the reducer.

TooLarge is a separate variant rather than a reuse of TooDeep, the same way
TmRun::TooLarge is separate from HitCap: one says the input nests too deeply,
the other says the output is too big to reduce."
```

**Estimate: 1 hour.**

---

## Where this plan stops

**It does not fix `lower_group`.** The duplication at `lower.rs:453` is the root cause, it predates structural sharing, and binding `group` once was measured *not* to close the blow-up — it relocates the same expansion to reduction time under call-by-name, and it moves every pinned step count and `Origins` path in that function. Fixing it properly is a lowering slice with its own design.

~~"This plan makes the program fail *fast and typed* instead of hanging. That is the whole
deliverable."~~ — **it does not.** Task 3 was abandoned; the program still hangs and nothing refuses it.
What this plan actually delivered is the **measurement**: `logical_size` (Task 1) and the curve plus the
TM verification (Task 2), both committed and both inputs to whatever guard comes next.

**The guard that came next landed the same day and was reverted the day after**, so the struck
sentence is true of no constant.
[`2026-07-31-lambda-shared-subterm-guard.md`](2026-07-31-lambda-shared-subterm-guard.md) shipped
`MAX_SHARED_LOGICAL_NODES = 10_000` on the largest SHARED subterm plus `LowerError::TooShared`
(`1652e09`); measurement then falsified it — a two-list program with no recursion scores 4 against that
bound and took 19.0 s in one β-step — and it was removed. ~~**The 512-byte program hangs.**~~ — **it
reduces in 7.48 s since 2026-08-01; see the banner at the top of this file.** This plan's
`MAX_LOGICAL_NODES` still does not exist and must not be re-applied, and neither must the successor's
constant. The measurement above is what it was worth: Task 1's
`logical_size` is a dependency of the successor's `max_shared_logical_size`, and Task 2's curve is what
established that a bound calibrated by timing one β-step is ~32x too loose.

**Total: roughly half a day** — of which Tasks 1 and 2 were spent as estimated and Task 3 was spent
discovering that the design it implements is wrong. That is the cheapest place this could have been
found, and it was found by running the full suite rather than the task's own five tests.
