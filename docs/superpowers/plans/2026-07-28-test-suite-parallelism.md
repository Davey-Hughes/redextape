# Test-suite parallelism — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Cut the fast tier's wall-clock from 231.7s to roughly 20s without removing a single assertion,
by running tests in one parallel pool and by splitting the one test that serialises the whole suite.

**Architecture:** Two independent changes. First, `cargo-nextest` replaces `cargo test` as the runner in
both scripts and CI — a pure scheduling change, no test touched. Second, `tm_bank_invariant`'s
190-simulation loop is split into one `#[test]` per unit so the runner has something to parallelise,
with a cross-product guard so a split that silently drops coverage fails loudly.

**Tech Stack:** Rust (edition 2024), `cargo-nextest`, `cargo-llvm-cov`, Forgejo Actions.

## Global Constraints

- `rustfmt.toml` pins `edition = "2024"`, `max_width = 120`, `use_small_heuristics = "Max"`.
- **`main` requires LINEAR HISTORY** — `.forgejo/workflows/ci.yml`'s `linear-history` job fails any merge
  commit. Integrate by fast-forward or rebase, never `git merge --no-ff`.
- Commit style `type(scope): lower-case summary`. **No `Co-Authored-By` or "Generated with" attribution.**
- **The suite must not get faster by covering less.** Every task states how it proves coverage is
  unchanged. A speed change that quietly drops a case is strictly worse than a slow suite, and this is
  the single most likely way for this branch to go wrong.

---

## Measured baseline (2026-07-28, 12 logical CPUs / 8 performance)

| config | wall (warm) | user | parallelism |
|---|---|---|---|
| `cargo test --workspace` | **231.7s** | 322.7s | 1.39x |
| `cargo nextest run --workspace` | **135.2s** | 340.3s | 2.51x |

623 tests, identical pass set under both runners. `cargo test` runs the 22 test binaries one at a time;
only tests *within* a binary share threads. Per-test costs, from nextest:

| test | time |
|---|---|
| `tm_bank_invariant::the_reg_bank_stays_well_formed_at_every_step_and_every_width` | **131.0s** |
| `tm_bank_invariant::generated_feature_programs_never_corrupt_the_bank` | 51.2s |
| `three_way_oracle::three_way_oracle_on_the_first_order_suite` | 19.8s |
| `tm_exhaustive_bank_safety::every_seeded_two_instruction_program…` | 18.2s |
| `native_oracle::four_way_oracle_on_the_first_order_suite` | 17.9s |
| `tm_width_equivalence::the_box_tape_stays_well_formed…` | 16.3s |
| everything else | < 5s |

So after nextest, 131 of the remaining 135 seconds are ONE test, and the next tier sits at ~20s. That
tier is the floor this plan targets; going below it is a different, larger piece of work.

**Rejected, with the measurement that rejected it: optimising the test profile.**
`[profile.test] opt-level = 2` takes the suite to ~15s — a further 9x, the largest single lever
available. It was measured and then rejected, because a probe showed it disarms a guard: a recursive
5,000-cell spine walk on a 256 KiB stack SURVIVES once optimised (LLVM turns the tail call into a loop),
so the small-stack tests in `lambda/decode.rs` and `value.rs` would pass against exactly the recursive
implementations they exist to reject. Recorded here so nobody re-proposes it as free speed: it is not
free, and the price is paid in silence.

---

## Measured distribution (Task 1, 2026-07-28)

Probe over the exact cross product, timed per axis. Totals ≈ 128s, matching the 131s nextest reported.

**Per (width, encoding) — the cost is QUADRATIC in width, which decides the axis:**

| width | unary | binary | both |
|---|---|---|---|
| 4 | 0.04s | 0.44s | 0.48s |
| 8 | 1.02s | 1.19s | 2.20s |
| 16 | 3.50s | 3.73s | 7.23s |
| 32 | 11.52s | 12.82s | 24.34s |
| **64** | **46.32s** | **47.94s** | **94.26s** |

Width 64 alone is **73%** of the test. Each doubling costs ~3.4–4x, so the plan's warning was right: a
per-width split leaves a 94.3s long pole and looks like a fix.

**Per corpus program** (all widths × encodings), top 5 of 19: `map` 36.81s, mutable-capture `ap` 32.13s,
`sum(5)` 14.13s, `sub`/`ap2` 13.86s, `while` 8.43s. The remaining 14 total under 15s.

**None of the three candidate axes clears the plan's stated 20s rule:** per-width 94.26s, per-(width,
encoding) 47.94s, per-program 36.81s.

**The 20s threshold was wrong, and correcting it settles the choice.** It was set from the next tier
*outside* this file (`three_way_oracle` 19.8s, `tm_exhaustive_bank_safety` 18.2s). But the real ceiling is
*inside* it: `generated_feature_programs_never_corrupt_the_bank` is 51.2s and Task 3 deliberately may not
touch it. Any split of this test below ~51s therefore buys nothing on its own.

**Axis chosen: `(width, encoding)` — 10 tests, longest 47.94s.** It is the FEWEST tests that clear the
real ceiling, and every name says what it covers (`…_at_width_64_binary`). The finer
`(program, width, encoding)` axis would give a ~13s long pole, but 190 tests whose names carry a
meaningless program index — and it would not make the suite one second faster while the 51.2s proptest
stands.

**The condition that would change this, recorded so the next person does not re-derive it:** if Task 3
splits the generated proptest, the floor drops to this test's 47.9s and splitting width 64 further BY
PROGRAM becomes the next move. Do that only then.

Expected suite effect: fast tier ~135s → ~55s, bounded by the 51.2s proptest.

## Task 1: Establish where the 131 seconds actually go

The split axis must be chosen from data. Cost per simulation is roughly `steps x cells`, and both grow
with the field width, so the cost across widths is superlinear — a per-width split could leave a 70s
long pole and look like a fix. Measure before choosing.

**Files:**
- Create (temporary, deleted in this task): a throwaway probe

- [ ] **Step 1: Time each axis of the cross product**

`crates/redextape-core/tests/tm_bank_invariant.rs:68-112` is the test. Its loop is
`CORPUS` (19 programs) x `widths()` (`MIN_FIELD_WIDTH` doubling to `MAX_FIELD_WIDTH`) x
`encodings_at(width)` (unary, binary) = 190 simulations, each running a per-step watcher that is
`O(cells)` in the REG bank.

Write a throwaway probe (a `#[test]` in a scratch file, deleted at the end of this task) that runs the
same three nested loops and prints elapsed time per `(width, encoding)` and per corpus program. Run it
with `--nocapture`, alone, with nothing else building.

- [ ] **Step 2: Record the distribution and choose the axis**

Write the numbers into this plan file under a new "Measured distribution" heading — actual numbers, not
a summary. Then choose the split axis by this rule, in order:

1. Prefer the axis whose **longest single resulting test is under 20s** (the next-tier ceiling — going
   finer than that buys nothing until those tests are also split).
2. Among axes that satisfy (1), prefer the one producing **fewer tests**.
3. Among those, prefer the axis that gives each test a **name that says what it covers** — a reader
   seeing `…_at_width_64_binary` learns something; `…_shard_3` does not.

Candidate axes: per width (5 tests), per `(width, encoding)` (10 tests), per corpus program (19 tests).
If NO axis satisfies (1), say so and pick the best available — but then note in the plan that the
generated-proptest task below becomes the binding constraint, not this one.

- [ ] **Step 3: Delete the probe and commit the measurement**

The probe is deleted; the numbers stay in the plan.

```bash
git add docs/superpowers/plans/2026-07-28-test-suite-parallelism.md
git commit -m "docs(plan): measure where tm_bank_invariant's 131 seconds go"
```

---

## Task 2: Split the corpus invariant test along the chosen axis

**Files:**
- Modify: `crates/redextape-core/tests/tm_bank_invariant.rs:68-112`

**Interfaces:**
- Consumes: Task 1's chosen axis.
- Produces: N `#[test]` functions replacing one, plus a coverage guard.

- [ ] **Step 1: Extract the loop body into a helper, unchanged**

Move the body of `the_reg_bank_stays_well_formed_at_every_step_and_every_width` into

```rust
/// One (program, width, encoding) unit of the corpus invariant: lower, simulate, and check the REG
/// bank after EVERY step. Extracted verbatim from the single test this file used to have, so the split
/// below changes only how the units are SCHEDULED, never what any one of them asserts.
fn check_reg_bank_unit(src: &str, width: usize, name: &str, enc: &dyn Encoding) { … }
```

with the body copied exactly — same `lower_asm`/`defunc` fallback, same `simulate_watched` watcher, same
two assertions and the same failure message format (`"`{src}` at width {width} ({name}), step {step}: {why}"`).

- [ ] **Step 2: Verify the extraction changed nothing**

```bash
cargo nextest run -p redextape-core --test tm_bank_invariant
```

Expected: PASS, and the test's runtime within noise of 131s. It is still one test at this point — this
step exists to separate "extracted the body" from "split the test", so that if the split later fails,
you know which half broke it.

- [ ] **Step 3: Emit one `#[test]` per unit along the chosen axis**

Generate them with a `macro_rules!` that takes the test name and the axis value, so the body is written
once. Do NOT hand-write N near-identical functions — verbatim duplication of a logic block is a defect
this project's review rubric blocks merges over.

- [ ] **Step 4: Add the coverage guard — the point of the whole task**

A split that silently drops a width or an encoding makes the suite faster AND weaker, and every
remaining test still passes. So assert the cross product is fully covered:

```rust
/// The split above hands each (program, width, encoding) unit to a separate `#[test]` so the runner can
/// schedule them in parallel. That is only sound if the units still COVER the cross product — a split
/// that quietly dropped width 64 would make this file faster and every test in it would still pass.
///
/// So: enumerate what the split actually runs and compare it against the product of the three
/// constants. This is the test that fails if someone adds a width, an encoding or a corpus program and
/// forgets to add the matching test.
#[test]
fn the_split_covers_the_whole_cross_product() { … }
```

Implement it by having the macro also register each unit into a `const`/`static` list (or by asserting
the generated test COUNT against `CORPUS.len() * widths().len() * 2` for the chosen axis, whichever the
axis makes checkable). State in the doc comment which of the two it does and what that does NOT catch.

- [ ] **Step 5: Verify the guard catches what it claims**

Sabotage check. Temporarily delete one generated test (or one width from `widths()`), run
`the_split_covers_the_whole_cross_product`, and confirm it FAILS. Restore, confirm it passes. A coverage
guard that has never been seen to fail is not a guard.

- [ ] **Step 6: Measure and commit**

```bash
cargo nextest run -p redextape-core --test tm_bank_invariant
cargo nextest run --workspace
```

Record both the per-test times and the new whole-suite total. Commit:

```bash
git add crates/redextape-core/tests/tm_bank_invariant.rs
git commit -m "test(tm): split the corpus bank invariant so the runner can parallelise it

One #[test] ran 19 programs x 5 widths x 2 encodings in sequence — 131s, 55% of
the whole fast tier, on one core. The units are independent; only the scheduling
was serial. Same assertions, same failure messages, one test per unit, plus a
cross-product guard so a split that drops a case fails loudly instead of just
running faster."
```

---

## Task 3: The generated-program proptest — decide, do not assume

`generated_feature_programs_never_corrupt_the_bank` (`tm_bank_invariant.rs:226`) is 51.2s and becomes the
long pole once Task 2 lands. It is a `proptest!` with `cases: 48` over `arb_feature_program`, whose
strategy is a `prop_oneof!` of 6 program shapes. **Proptest runs a test's cases sequentially**, so this
is one core for 51s.

**This task is a DECISION, and the plan deliberately does not pre-make it.**

- [ ] **Step 1: Establish whether splitting preserves coverage**

The obvious move — 6 tests of 8 cases each, one per `prop_oneof!` alternative — keeps the total case
count at 48 and parallelises 6 ways. But it is **not** coverage-neutral, and the difference must be
stated rather than glossed: today's 48 cases are drawn from the union, so the count per alternative is
random (and some alternative may get 15 cases while another gets 3); a per-alternative split fixes it at
8 each. That is arguably better per-alternative coverage and definitely different. It also changes the
seeds, so an existing `.proptest-regressions` entry may no longer reproduce — check
`crates/redextape-core/tests/tm_bank_invariant.proptest-regressions` and preserve any recorded failure
as an explicit non-proptest test if the split would orphan it.

- [ ] **Step 2: Choose and record**

Either (a) split per alternative, recording the coverage change above in the test module's doc comment,
or (b) leave it at 51s and record that the fast tier's floor is therefore ~51s, not ~20s. **Both are
acceptable outcomes.** What is not acceptable is splitting it and describing the result as a free win.

If (a): the same cross-product guard discipline as Task 2 applies — assert that every `prop_oneof!`
alternative has a corresponding test, so adding a 7th shape without a test fails loudly.

- [ ] **Step 3: Commit with whichever decision was made**

---

## Task 4: Re-measure and record the result honestly

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Measure the final state**

```bash
cargo nextest run --workspace
```

Report the total, the new slowest three tests, and the parallelism ratio (`user / real`).

- [ ] **Step 2: Append a roadmap entry**

Include: the before/after numbers; that nextest was a scheduling change with no test touched; the
cross-product guard and its sabotage check; the profile-optimisation lever and **why it was rejected**
(the surviving-recursive-walk probe — this is the part a future reader will otherwise re-propose); and
the honest remaining floor with the tests that now define it.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(roadmap): record the test-suite parallelism slice"
```

---

## What this is worth, honestly

nextest is a large win for no risk — it changes scheduling, not semantics, and the pass set was verified
identical (623 tests). Task 2 is a real but bounded win whose entire risk is coverage loss, which is why
it carries a guard and a sabotage check rather than just a green suite. Task 3 may correctly conclude
"leave it alone". The rejected profile lever is the most valuable thing recorded here: it is the obvious
next idea, it is genuinely tempting on the numbers, and it is wrong for a reason that only shows up if
you go looking for it.
