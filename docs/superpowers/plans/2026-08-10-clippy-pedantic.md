# clippy::pedantic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `clippy::pedantic` across the workspace with no global allows, resolving all 294
production warnings on their merits and exempting test/example code.

**Architecture:** Four fix tasks land first, each clean under the *current* lint configuration, then
a fifth task turns the gate on against an already-clean tree. This inversion is forced by the
pre-commit hook — see Global Constraints.

**Tech Stack:** Rust 2024 edition, `cargo clippy`, `cargo nextest`, pre-commit.

**Spec:** `docs/superpowers/specs/2026-08-10-clippy-pedantic-design.md`

## Global Constraints

- **Baseline commit is `32e0f79`; branch is `clippy-pedantic`.** Every count below was measured
  there. Re-measure rather than trusting a count if the branch has moved.
- **The pre-commit hook runs `cargo clippy --workspace --all-targets -- -D warnings` on every commit
  touching `*.rs`.** Every commit must be clean under it. `--no-verify` is not permitted in this
  repository under any circumstance.
- **Tasks 1–4 must not add `pedantic` to `Cargo.toml`.** They verify with an explicit
  `-W clippy::pedantic` flag instead. Task 5 is the only task that edits the lint configuration.
- **No test may be edited to accommodate a lint fix.** A fix that requires a test change is a
  behaviour change; stop and raise it rather than editing the test.
- **Every `#[allow]` added must carry an adjacent comment stating why**, matching the convention in
  `Cargo.toml`'s `[workspace.lints.clippy]` block and `clippy.toml`.
- **The measurement command** (production surface only — no `--all-targets`, so no `cfg(test)`):
  ```bash
  cargo clippy --workspace --message-format=json -- -W clippy::pedantic 2>/dev/null \
    | jq -r 'select(.reason=="compiler-message") | select(.message.level=="warning")
             | .message.code.code // "none"' | sort | uniq -c | sort -rn
  ```
  Save this as a shell alias; every task's verification step uses it.

## The 294, and which task owns each

| lint | n | task |
| --- | --- | --- |
| `must_use_candidate` | 125 | 1 |
| `doc_markdown` | 13 | 1 |
| `single_match_else` (auto) | 12 | 1 |
| `semicolon_if_nothing_returned`, `map_unwrap_or`, `borrow_as_ptr` | 2 each | 1 |
| `unnested_or_patterns`, `inconsistent_struct_constructor`, `if_not_else` | 1 each | 1 |
| **Task 1 subtotal** | **159** | |
| `missing_errors_doc` | 40 | 2 |
| `cast_possible_truncation` | 40 | 3 |
| `cast_possible_wrap` | 3 | 3 |
| `cast_sign_loss` | 1 | 3 |
| **Task 3 subtotal** | **44** | |
| `match_same_arms` | 10 | 4 |
| `similar_names` | 8 | 4 |
| `too_many_lines` | 6 | 4 |
| `many_single_char_names` | 6 | 4 |
| `needless_pass_by_value` | 5 | 4 |
| `trivially_copy_pass_by_ref` | 3 | 4 |
| `single_match_else` (manual), `return_self_not_must_use`, `manual_let_else`, `items_after_statements`, `assigning_clones` | 2 each | 4 |
| `unnecessary_wraps`, `ref_option`, `missing_panics_doc` | 1 each | 4 |
| **Task 4 subtotal** | **51** | |
| | **294** | |

---

### Task 1: The machine-applicable batch

**Estimated time:** 45–90 minutes, most of it reading the diff.

**Files:** across `crates/*/src/`, chosen by clippy. Expect `redextape-core` to dominate (213 of the
294 production warnings are there).

**Interfaces:**
- Consumes: nothing.
- Produces: 125 `#[must_use]` attributes on public methods. Later tasks and `web/` see this as a
  public-API change; nothing else in this plan depends on it.

- [ ] **Step 1: Record the starting counts**

```bash
cargo clippy --workspace --message-format=json -- -W clippy::pedantic 2>/dev/null \
  | jq -r 'select(.reason=="compiler-message") | select(.message.level=="warning")
           | .message.code.code // "none"' | sort | uniq -c | sort -rn > /tmp/pedantic-before.txt
cat /tmp/pedantic-before.txt
```

Expected: 294 total, `must_use_candidate` at 125.

- [ ] **Step 2: Apply the machine-applicable suggestions**

`--fix` applies only `MachineApplicable` suggestions, which is exactly the 159. It refuses to run
with a dirty tree, so commit or stash anything outstanding first.

```bash
cargo clippy --workspace --fix --allow-staged -- -W clippy::pedantic
```

- [ ] **Step 3: Read the entire diff**

```bash
git diff --stat
git diff
```

This is the step that matters. `--fix` is not trusted here — check specifically:
- **`#[must_use]` on `redextape-wasm`'s `#[wasm_bindgen]` exports.** The attribute interacts with
  generated bindings; if any export gained one, verify `cd web && pnpm run build:wasm` still
  succeeds before continuing.
- **`doc_markdown` edits inside doc comments that contain deliberate prose.** This repo's doc
  comments are unusually long and carry measured figures; backticking a word inside a sentence is
  fine, backticking something that was prose is not.
- Revert any individual hunk you disagree with — a reverted hunk becomes Task 4's problem, which is
  correct.

- [ ] **Step 4: Verify the fix landed and nothing else broke**

```bash
cargo clippy --workspace --message-format=json -- -W clippy::pedantic 2>/dev/null \
  | jq -r 'select(.reason=="compiler-message") | select(.message.level=="warning")
           | .message.code.code // "none"' | sort | uniq -c | sort -rn
```

Expected: 135 total (or 135 + however many hunks you reverted). `must_use_candidate`, `doc_markdown`,
`semicolon_if_nothing_returned`, `map_unwrap_or`, `borrow_as_ptr`, `unnested_or_patterns`,
`inconsistent_struct_constructor` and `if_not_else` are all gone; `single_match_else` has dropped
from 14 to 2.

- [ ] **Step 5: Run the tests**

```bash
cargo nextest run --workspace
```

Expected: `871 tests run: 871 passed, 3 skipped` (count as of `32e0f79`; it may have grown).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "clippy: apply the 159 machine-applicable pedantic suggestions

cargo clippy --workspace --fix -- -W clippy::pedantic, then read in full.
125 of the 159 are #[must_use] on public methods; the rest are doc_markdown
backticks and single_match_else rewrites.

No behaviour change. The pedantic group is NOT enabled yet - see the plan for
why the fixes have to precede the config."
```

---

### Task 2: `missing_errors_doc` (40)

**Estimated time:** 1–2 hours. This is prose, not code.

**Files:**
- Modify: `crates/redextape-wasm/src/lib.rs` — 24 of the 40, at lines 36, 57, 65, 77, 91, 106, 134,
  139, 144, 150, 159, 164, 172, 180, 185, 191, 196, 202, 209, 214, 224, 232, 237, 252
- Modify: `crates/redextape-core/src/interp.rs:40,44`, `crates/redextape-core/src/lambda/lower.rs:220,226`,
  `crates/redextape-core/src/lib.rs:65`, `crates/redextape-core/src/tm/attribute.rs:231,246`,
  `crates/redextape-core/src/tm/defunc.rs:268,578`, `crates/redextape-core/src/tm/lower_asm.rs:140,152`,
  `crates/redextape-core/src/tm.rs:240`, `crates/redextape-core/src/typeck.rs:24`
- Modify: `crates/redextape-native/src/analysis.rs:139`, `crates/redextape-native/src/aot.rs:85,300`

(Line numbers are as of `32e0f79` and will shift after Task 1's edits — re-run the measurement
command to get current positions.)

**Interfaces:**
- Consumes: Task 1's tree.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add an `# Errors` section to each flagged function**

The lint wants a `# Errors` heading in the doc comment of every public function returning `Result`.
Write what the error actually means, not a restatement of the type. The repo's existing docs set the
bar — say which condition produces it and what the caller can do.

Shape to follow:

```rust
/// Compiles `source` to a Turing machine program.
///
/// # Errors
///
/// Returns `Diagnostic` when `source` fails to parse or type-check. The diagnostic carries the
/// offending `Span`; there is no partial result, so a caller cannot proceed past this.
pub fn compile(source: &str) -> Result<Program, Diagnostic> {
```

Do **not** write filler like "Returns an error if the operation fails." That satisfies the lint and
teaches nothing, and it is the failure mode this task exists to avoid.

- [ ] **Step 2: Verify the lint is clear**

```bash
cargo clippy --workspace --message-format=json -- -W clippy::pedantic 2>/dev/null \
  | jq -r 'select(.reason=="compiler-message") | select(.message.level=="warning")
           | .message.code.code // "none"' | grep -c missing_errors_doc
```

Expected: `0` (grep exits 1 when it counts zero — that is the pass condition here).

- [ ] **Step 3: Verify the docs build**

```bash
cargo doc --workspace --no-deps
```

Expected: no warnings. A malformed doc comment shows up here, not in clippy.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: an # Errors section on every public fallible function

40 sites, 24 of them in redextape-wasm's boundary layer. Each says which
condition produces the error and what the caller can do with it, rather than
restating the Result type."
```

---

### Task 3: The cast lints (44)

**Estimated time:** 2–4 hours. This is the task with real judgement in it.

**Files:**
- Modify: `crates/redextape-wasm/src/lib.rs` — 14 sites, lines 256–283, all inside `link_index`
- Modify: `crates/redextape-core/src/tm/asm.rs` — 7 sites (434, 445, 471, 483, 518, 578, 646)
- Modify: `crates/redextape-native-rt/src/lib.rs` — 5 sites (117, 142, 198, 223, 424)
- Modify: `crates/redextape-core/src/tm/build.rs:149,156`, `lambda/lower.rs:108,262`,
  `tm/lower_asm.rs:211,494`
- Modify: single sites in `crates/redextape-core/src/`: `lambda/syntax.rs:145`, `lambda/term.rs:408`
  (two lints on one line), `sourcemap.rs:165`, `tm/decode.rs:70`, `tm/lower_tm.rs:72`,
  `tm/machine.rs:76`, `tm/syntax.rs:380`, `trace.rs:333`, `viewmodel.rs:553`
- Modify: `crates/redextape-native/src/aot.rs:133`, `crates/redextape-native/src/codegen.rs:355`

**Interfaces:**
- Consumes: Task 1's tree.
- Produces: possibly new error paths where a cast becomes `try_from`. Any new `Err` variant must be
  named here if a later task touches it — none currently does.

**Each site gets exactly one of three dispositions** (spec §3):

1. **Provably in range** → `#[allow(clippy::cast_possible_truncation)]` plus a comment stating the
   bound *and where it is enforced*. A comment that merely asserts "this is fine" does not qualify.
2. **Not provably in range, failure representable** → `try_from` with a typed error, per the
   no-panic rule `[workspace.lints.clippy]` already encodes. Never `unwrap`/`expect` — those are
   denied in library code.
3. **Not provably in range, failure not representable** → this is a bug. **Stop, and report it
   rather than papering over it.** This outcome is the reason the minimal allow-list was chosen.

- [ ] **Step 1: Dispose of the `redextape-wasm` block first (14 of the 44, one attribute)**

All 14 are `usize as u32` feeding `js_sys` typed-array lengths and indices, inside `link_index`.
`redextape-wasm` executes only on `wasm32`, where `usize` *is* `u32` — the cast cannot lose bits on
the only target that runs this code. The lint fires because the crate also builds an `rlib` for the
host so `cargo test` can link it (see the `[lib]` comment in its `Cargo.toml`).

That is disposition 1, and one attribute on the function covers all 14:

```rust
    // `usize as u32` throughout: every value here is a JS typed-array length or index, and this
    // crate only ever EXECUTES on wasm32, where `usize` is `u32` and the cast is the identity. The
    // lint fires because the `rlib` leg builds for the 64-bit host so `cargo test` can link it —
    // see the `[lib]` comment in Cargo.toml. Bound: `index.lambda_spans.len()` and friends are
    // bounded by the compiled program size, which `byte_budget` already caps upstream.
    #[allow(clippy::cast_possible_truncation)]
    #[wasm_bindgen(js_name = linkIndex)]
    pub fn link_index(&self, byte_budget: usize) -> Result<JsValue, JsValue> {
```

Verify the `byte_budget` claim against `link_index`'s body before committing to this wording. If the
budget does *not* bound those lengths, the comment is wrong and the site is disposition 2.

- [ ] **Step 2: Work the remaining 30 one file at a time**

Order: `tm/asm.rs` (7), `native-rt/src/lib.rs` (5), `tm/build.rs` + `lambda/lower.rs` +
`tm/lower_asm.rs` (2 each), then the 11 singletons.

For each site, read enough surrounding code to answer "what bounds this value?" before choosing a
disposition. Record the answer in the comment. If you cannot answer it, the disposition is 3.

- [ ] **Step 3: Verify the lints are clear**

```bash
cargo clippy --workspace --message-format=json -- -W clippy::pedantic 2>/dev/null \
  | jq -r 'select(.reason=="compiler-message") | select(.message.level=="warning")
           | .message.code.code // "none"' | grep -cE 'cast_possible_truncation|cast_possible_wrap|cast_sign_loss'
```

Expected: `0`.

- [ ] **Step 4: Verify every new allow carries a reason**

```bash
grep -rn -B2 'allow(clippy::cast_' crates/*/src/
```

Expected: a `//` comment immediately above every hit. An allow without one is a plan violation.

- [ ] **Step 5: Run the full check, not just the base configuration**

The cast sites span `redextape-native` and `redextape-native-rt`, which are linted under four
different feature configurations — three of which the default pass never sees.

```bash
./scripts/check-all.sh
```

Expected: green. If LLVM is unavailable locally, `./scripts/check-all.sh --no-llvm` covers the base
tier and CI's `rust-llvm` job covers the rest.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "clippy: dispose of the 44 cast lints, one bound argument at a time

Each site is now either an allow naming the bound and where it is enforced, or
a try_from with a typed error. The 14 in redextape-wasm's link_index are one
allow: that crate only executes on wasm32, where usize is u32.

No behaviour change except where a cast became try_from, noted per site."
```

If Step 2 produced a disposition-3 site, **do not fold the bug fix into this commit.** Land the 43
others, then raise the bug separately with its own failing test.

---

### Task 4: The remainder (51)

**Estimated time:** 1–2 hours.

**Files:** spread across `crates/*/src/`. Re-run the measurement command for current positions —
Tasks 1–3 will have moved every line number.

**Interfaces:**
- Consumes: Tasks 1–3's tree.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: List what is left**

```bash
cargo clippy --workspace --message-format=json -- -W clippy::pedantic 2>/dev/null \
  | jq -r 'select(.reason=="compiler-message") | select(.message.level=="warning")
           | (.message.code.code // "none") + "  " +
             ([.message.spans[]? | select(.is_primary) | "\(.file_name):\(.line_start)"] | first)' \
  | sort
```

Expected: 51 lines — `match_same_arms` 10, `similar_names` 8, `too_many_lines` 6,
`many_single_char_names` 6, `needless_pass_by_value` 5, `trivially_copy_pass_by_ref` 3, then
`single_match_else`, `return_self_not_must_use`, `manual_let_else`, `items_after_statements` and
`assigning_clones` at 2 each, and `unnecessary_wraps`, `ref_option`, `missing_panics_doc` at 1.

- [ ] **Step 2: Fix them, deferring to the lint by default**

Most are small mechanical rewrites. `match_same_arms` is the largest family (10) and has one shape —
merge arms whose bodies are identical:

```rust
// before
match ev {
    StepEvent::Enter { .. } => self.depth += 1,
    StepEvent::Resume { .. } => self.depth += 1,
    StepEvent::Exit { .. } => self.depth -= 1,
}

// after
match ev {
    StepEvent::Enter { .. } | StepEvent::Resume { .. } => self.depth += 1,
    StepEvent::Exit { .. } => self.depth -= 1,
}
```

Merge only where the arms are genuinely the same case. Where two arms share a body *today* but
represent distinct situations that will diverge, keep them apart and `#[allow]` with that reason —
this codebase's `StepEvent` and `Owner` matches are exactly where that applies.

Three families deserve a judgement call rather than reflex compliance:

- **`too_many_lines` (6)** — the fix is to split the function, which is a real refactor and can be a
  behaviour risk. If a function is long because it is a single coherent state machine, an `#[allow]`
  with a comment saying so is the better answer. Do not split a function you do not understand.
- **`many_single_char_names` (6) / `similar_names` (8)** — in `lambda/` these are often `s`/`t` for
  terms or `i`/`j` for de Bruijn indices, which match the notation in the papers this code
  implements. Renaming to satisfy a lint would make the code *harder* to check against its source
  material; `#[allow]` with that reason is legitimate.
- **`needless_pass_by_value` (5)** — changing a public signature from `T` to `&T` is a breaking API
  change. Check callers before changing; `web/` consumes `redextape-wasm`.

- [ ] **Step 3: Verify production is clean**

```bash
cargo clippy --workspace -- -W clippy::pedantic 2>&1 | grep -c '^warning'
```

Expected: `0`.

- [ ] **Step 4: Run the tests**

```bash
cargo nextest run --workspace
```

Expected: same pass count as Task 1 Step 5. Any change means a fix altered behaviour — investigate
before committing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "clippy: clear the last 51 pedantic warnings in production code

Mostly mechanical. The allows that remain are in lambda/, where single-char
names match the notation of the source material the code implements, and on
functions that are long because they are one coherent state machine - each
says so."
```

---

### Task 5: Turn the gate on

**Estimated time:** 30–45 minutes.

**Files:**
- Modify: `Cargo.toml` — the `[workspace.lints.clippy]` block
- Modify: `crates/redextape-core/src/lib.rs`, `crates/redextape-native/src/lib.rs`,
  `crates/redextape-native-rt/src/lib.rs`, `crates/redextape-test-support/src/lib.rs`,
  `crates/redextape-wasm/src/lib.rs` — one line each
- Modify: 49 files under `crates/*/tests/` and `crates/*/examples/` that already carry
  `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]` — extend that list
- Modify: `crates/redextape-core/tests/lambda_provenance.rs` and
  `crates/redextape-core/examples/shift_cost_probe.rs` — the only two test/example files with **no**
  file-level allow; add a fresh attribute

**Interfaces:**
- Consumes: Tasks 1–4's tree, production-clean.
- Produces: the gate. From this commit on, `cargo clippy --workspace --all-targets -- -D warnings`
  enforces pedantic.

- [ ] **Step 1: Enable the group**

In `Cargo.toml`, add to `[workspace.lints.clippy]` immediately below `all = "warn"`:

```toml
# `pedantic` is enabled AS WRITTEN — no lint in it is allowed workspace-wide. Every production
# warning was resolved on its merits rather than silenced here; see
# docs/superpowers/specs/2026-08-10-clippy-pedantic-design.md for the 294 and their disposition.
#
# `priority = -1` is not load-bearing today (the five restriction lints below are in neither `all`
# nor `pedantic`, so nothing conflicts) — it is here so that adding a per-lint `allow` later WORKS
# rather than erroring. That matters more than usual: rust-toolchain.toml tracks unpinned `stable`,
# and a new stable can add a pedantic lint that reddens CI with no code change. This field is the
# one-line remedy.
pedantic = { level = "warn", priority = -1 }
```

- [ ] **Step 2: Verify `priority = -1` is accepted**

Group-priority rules have moved between Cargo versions; confirm rather than assume.

```bash
cargo metadata --format-version 1 > /dev/null && echo "manifest OK"
```

Expected: `manifest OK`. If Cargo rejects the table form, fall back to `pedantic = "warn"` and record
in the commit message that per-lint overrides will need the priority field re-added.

- [ ] **Step 3: Exempt the inline `#[cfg(test)]` modules — 5 lines**

Add as the **first** line of each of the five `crates/*/src/lib.rs`, above any existing inner
attributes:

```rust
// Test code is exempt from `pedantic`, for the reason `clippy.toml` gives for the
// unwrap/expect/panic set: an assertion is a deliberate panic, and a probe that casts a `u64` step
// count to `f64` to print a ratio is not a defect. `cfg_attr` rather than 54 module-level attributes
// — under `--all-targets` each lib compiles twice, and `cfg(test)` holds only in the test-harness
// pass, so production warnings still surface from the other one.
//
// This ALSO covers the four `#[cfg(all(test, feature = "..."))]` modules in redextape-native that
// clippy.toml's header calls out as unreachable by clippy's own in-test detection: that limitation
// is specific to clippy's `is_in_test` heuristic, and this is ordinary `cfg` evaluation.
#![cfg_attr(test, allow(clippy::pedantic))]
```

- [ ] **Step 4: Exempt the 49 test/example files that already have an allow**

```bash
cd /home/davey/projects/redextape
grep -rl '#!\[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)\]' \
  crates/*/tests/*.rs crates/*/examples/*.rs \
  | xargs sed -i 's|#!\[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)\]|#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]|'
```

Verify the count changed on exactly 49 files:

```bash
git diff --stat | tail -1
grep -rc 'clippy::pedantic' crates/*/tests/*.rs crates/*/examples/*.rs | grep -c ':1$'
```

Expected: 49 files changed; 49 files matching.

- [ ] **Step 5: Add a fresh attribute to the two files with none**

At the top of both `crates/redextape-core/tests/lambda_provenance.rs` and
`crates/redextape-core/examples/shift_cost_probe.rs`:

```rust
#![allow(clippy::pedantic)]
```

These two carry no `unwrap`/`expect`/`panic` allow because they never trip those lints — they need
only the pedantic exemption.

- [ ] **Step 6: Verify the gate is green**

This is the real acceptance test — the exact command the pre-commit hook and CI both run:

```bash
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: `Finished` with no warnings. A failure here means a test or example file was missed;
`--all-targets` is what brings them into scope.

- [ ] **Step 7: Verify all four configurations, not just the base one**

```bash
./scripts/check-all.sh
```

Expected: green across all four rows. Three of them lint `redextape-native` under feature
combinations the base pass never sees.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "clippy: enable pedantic, with test and example code exempt

No global allows - all 294 production warnings were resolved in the four
preceding commits, which is why this one can be config-only.

Two mechanisms, because the two test surfaces differ: one cfg_attr per crate
root covers all 54 inline #[cfg(test)] modules (and the four feature-gated ones
clippy's own in-test detection cannot see), while the 51 tests/ and examples/
targets need a file-level attribute each - Cargo has no per-target lint config."
```

- [ ] **Step 9: Push and open the PR**

```bash
git push -u origin clippy-pedantic
```

Then open the PR against `main`. The body should state: the 294 and their four-way split, that no
lint is allowed workspace-wide, the two exemption mechanisms, and the standing risk that unpinned
`stable` plus a large actively-extended lint group makes an unexplained red CI more likely after a
Rust release.

---

## Verification of the whole plan

After Task 5, all of the following must hold:

- [ ] `cargo clippy --workspace --all-targets -- -D warnings` is green
- [ ] `./scripts/check-all.sh` is green
- [ ] `cargo nextest run --workspace` passes with the same count as before Task 1
- [ ] `cd web && pnpm run build:wasm && pnpm run typecheck` is green — Task 1 changed the public API
      surface `web/` consumes
- [ ] No test file was edited except to add the file-level allow in Task 5
- [ ] Every `#[allow]` added anywhere in Tasks 1–5 has a comment above it giving the reason
- [ ] `git log --oneline main..clippy-pedantic` shows 6 commits: the spec, then one per task
