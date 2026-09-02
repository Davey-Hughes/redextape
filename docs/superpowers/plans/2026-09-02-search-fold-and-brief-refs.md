# Width-search fold and brief-reference cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold two duplicate TM field-width search loops into one definition, and stop 45 comments across 27 files citing a per-task "brief" that is not in the tree.

**Architecture:** Task 1 extracts a private generic `search_width` helper in `crates/redextape-core/src/tm.rs` that owns the `MIN_FIELD_WIDTH`/doubling/`MAX_FIELD_WIDTH` ladder and the retry-only-on-`Overflow` rule; both public entry points become closures over it. Task 2 is a comment-only sweep across 27 files, no executable line changed. The two tasks write disjoint file sets and may run in parallel.

**Tech Stack:** Rust 2024 (`crates/redextape-core`), TypeScript + Vite (`web/`), pre-commit gates, `cargo nextest`.

**Spec:** [`../specs/2026-09-02-search-fold-and-brief-references-design.md`](../specs/2026-09-02-search-fold-and-brief-references-design.md). Read it before starting; it carries the arguments this plan only executes.

**Branch:** `search-fold-and-brief-refs`, already created, spec committed at `f41e63c`.

## Global Constraints

- **No behaviour change anywhere.** Every width the search chooses and every `TmRun` variant returned must be identical before and after. Task 2 changes comments only.
- **`rustfmt`: `max_width = 120`, `edition = "2024"`, `use_small_heuristics = "Max"`.** Run `cargo fmt` before every commit.
- **`clippy::pedantic` is on with no global allows and `-D warnings`.** The pre-commit hook runs it on every commit; a warning blocks the commit. Never use `--no-verify`.
- **Doc-comment convention:** `///` in Rust, `/** */` in TypeScript. Do not introduce `///` into any `.ts` file.
- **The citation gate rejects `file:line` in tracked non-`docs/` source.** Task 2's disposition 1 may cite a document by *name* (`2026-07-28-lambda-foreign-reader-and-typed-decode.md`) but never by name-plus-line.
- **`docs/` is out of scope for Task 2.** Its 33 occurrences stay. See spec §3.3.
- **Commits are serialized between the two tasks.** The pre-commit gate builds the whole workspace, so a commit taken mid-edit by the other agent gates on a tree neither intended. Commit only your own files; if the gate reports a failure in a file you did not touch, stop and report rather than fixing it.

---

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `crates/redextape-core/src/tm.rs` | 1 | The `search_width` helper, both entry points rewritten over it, the new agreement test |
| `crates/redextape-core/tests/tm_bank_invariant.rs` | 1 | One doc line on `widths()` marking it a deliberate independent model |
| `crates/redextape-core/tests/tm_width_equivalence.rs` | 1 | Same |
| `crates/redextape-core/examples/width_report.rs` | 1 | Same |
| 13 Rust files (27 sites) | 2 | Brief references dispositioned |
| 14 web files (18 sites) | 2 | Brief references dispositioned |

**Disjointness:** `crates/redextape-core/src/tm.rs` carries zero occurrences of `brief` (`grep -ic brief crates/redextape-core/src/tm.rs` → `0`), and none of `tm_bank_invariant.rs`, `tm_width_equivalence.rs`, `width_report.rs` appears in Task 2's 27-file inventory. The intersection is empty.

---

## Task 1: Fold the width search

**Files:**
- Modify: `crates/redextape-core/src/tm.rs` — add `search_width` before `run_tm_fitted` (currently at line 231); rewrite the loop bodies of `run_tm_fitted` (231) and `run_tm_described` (346); add one test to the existing `mod run_tm_tests`.
- Modify: `crates/redextape-core/tests/tm_bank_invariant.rs:65` — doc line only.
- Modify: `crates/redextape-core/tests/tm_width_equivalence.rs:38` — doc line only.
- Modify: `crates/redextape-core/examples/width_report.rs:110` — doc line only.
- Test: `crates/redextape-core/src/tm.rs`, inline `mod run_tm_tests` (already exists, has `core_of` and imports `Value`, `parse`, `desugar`).

**Interfaces:**
- Consumes: existing private `attempt(&Program, &dyn Encoding, u32, TmCaps) -> Option<(TmRun, Machine, Vec<Vec<Symbol>>, u64)>`, existing private `describe_at(&Program, u32, EncodingKind, Ty, TmCaps, usize) -> Option<DescribedRun>`, existing private `lower_and_size(&Core) -> Result<(Program, lower_tm::SlotMap), TmRun>`, and the public constants `MIN_FIELD_WIDTH` (4) and `MAX_FIELD_WIDTH`.
- Produces: private `fn search_width<T>(at: impl FnMut(usize) -> Option<T>, overflowed: impl Fn(&T) -> bool) -> Option<(T, usize)>`. Nothing outside `tm.rs` may call it; the two public signatures `run_tm_fitted` and `run_tm_described` are unchanged.

- [ ] **Step 1: Write the failing test**

Add to the end of `mod run_tm_tests` in `crates/redextape-core/src/tm.rs`, immediately before the module's closing brace:

```rust
    /// THE PROPERTY THE ROADMAP FILED, PINNED END TO END THROUGH BOTH PUBLIC ENTRY POINTS RATHER THAN
    /// THROUGH THE HELPER THEY SHARE. `run_tm_fitted` and `run_tm_described` ran their own copy of the
    /// `MIN_FIELD_WIDTH`/doubling/`Overflow` search for a year and agreed by inspection; folding them
    /// onto one helper removes that axis, and this asserts what the fold is FOR. Written through the
    /// public functions on purpose: a divergence in how each one CALLS the helper is invisible to a
    /// test of the helper itself.
    ///
    /// The corpus is chosen so the search does real work. `1 + 2` fits at `MIN_FIELD_WIDTH` and never
    /// retries; `40 + 2` and `1 + 2 * 3` must widen; `head(nil)` reaches a cap rather than the overflow
    /// guard, so it exercises the early return that must NOT retry.
    #[test]
    fn the_two_entry_points_fit_the_same_width() {
        for src in ["1 + 2", "40 + 2", "1 + 2 * 3", "sum(4)", "head(nil)"] {
            let core = core_of(src);
            for (name, kind, enc) in [
                ("unary", EncodingKind::Unary, Box::new(Unary::default()) as Box<dyn Encoding>),
                ("binary", EncodingKind::Binary, Box::new(Binary::default()) as Box<dyn Encoding>),
            ] {
                let caps = TmCaps { steps: 50_000, cells: 50_000 };
                let (_, fitted) = run_tm_fitted(&core, &*enc, caps);
                let described = run_tm_described(&core, kind, crate::ty::Ty::Nat, caps);
                match (fitted, described) {
                    (Some(w), Ok(d)) => assert_eq!(w, d.header.width, "`{src}` under {name}"),
                    (None, Err(_)) => {}
                    (f, d) => panic!("`{src}` under {name}: fitted said {f:?}, described said {:?}", d.map(|d| d.header.width)),
                }
            }
        }
    }
```

No new import is needed: `mod run_tm_tests` opens with `use super::*;`, and `Binary`, `Unary`, `Encoding` and `EncodingKind` are all `pub use`d at the top of `tm.rs`.

- [ ] **Step 2: Run the test to verify it passes BEFORE the fold**

Run: `cargo nextest run -p redextape-core the_two_entry_points_fit_the_same_width`
Expected: **PASS.** This is not a TDD red step — the two loops agree today, which is exactly what the roadmap item says. The test is a regression pin, and it must be shown green before the fold so that a red result after the fold is unambiguously the fold's fault.

- [ ] **Step 3: Prove the new test can fail, before trusting it**

Temporarily change `run_tm_described`'s retry line (currently `TmRun::Overflow if width < MAX_FIELD_WIDTH => width = (width * 2).min(MAX_FIELD_WIDTH),`) to `TmRun::Overflow if false => unreachable!(),`.

Run: `cargo nextest run -p redextape-core the_two_entry_points_fit_the_same_width`
Expected: **FAIL**, naming `40 + 2` or `1 + 2 * 3`. Revert the sabotage before continuing. A test that cannot be made to fail here is a test that would not have caught the drift it exists to catch — if it stays green, stop and report.

- [ ] **Step 4: Add the `search_width` helper**

Insert immediately above `run_tm_fitted`'s doc comment in `crates/redextape-core/src/tm.rs`:

```rust
/// The field-width ladder and the retry rule, in one definition on the library path.
///
/// Attempts `MIN_FIELD_WIDTH`, doubling, up to `MAX_FIELD_WIDTH`. `at` runs one attempt at one width
/// and answers `None` for a refusal no width can lift (`MAX_MACHINE_STATES`, knowable only once THIS
/// width's gadgets are built). `overflowed` answers whether an outcome is the overflow guard. Answers
/// the outcome together with the width that produced it, or `None` when an attempt refused — callers
/// map that onto whatever `TooLarge` shape their own signature calls for.
///
/// Only the GUARD triggers a retry, never `HitCap` (nor `TooLarge`) — a nil/dangling dereference spins
/// to a cap at every width, so retrying on caps would burn the full step budget five times over and
/// still report the same thing; a program `lower_and_size` refuses is refused independently of width,
/// so retrying it would just re-refuse it at every width up to the ceiling for no benefit. That
/// distinction is the reason the guard is a state id rather than a spin (see `Builder::overflow`).
///
/// The retries are cheap BECAUSE of the guard: a too-narrow attempt runs the correct prefix of the
/// program and then halts at its first overflowing store, so it costs less than the successful attempt
/// that follows it. Without the guard an under-sized run corrupts the bank and frequently runs away to
/// the full step cap instead, which is what made the pre-guard behaviour expensive as well as wrong.
///
/// **THE THREE `widths()` COPIES IN `tests/` AND `examples/` ARE NOT ROUTED THROUGH THIS AND MUST NOT
/// BE.** They are independent models of this ladder, and two of them carry assertions ABOUT it; making
/// them walk whatever this function says would stop those assertions being able to fail. See the doc on
/// each copy.
fn search_width<T>(mut at: impl FnMut(usize) -> Option<T>, overflowed: impl Fn(&T) -> bool) -> Option<(T, usize)> {
    let mut width = MIN_FIELD_WIDTH;
    loop {
        let got = at(width)?;
        if overflowed(&got) && width < MAX_FIELD_WIDTH {
            width = (width * 2).min(MAX_FIELD_WIDTH);
        } else {
            return Some((got, width));
        }
    }
}
```

- [ ] **Step 5: Rewrite `run_tm_fitted` over the helper**

Replace the body from `let mut width = MIN_FIELD_WIDTH;` to the end of the function with:

```rust
    // Matched rather than flattened through `map_or` so the state-ceiling refusal (`None` —
    // `MAX_MACHINE_STATES`, only knowable once a width's gadgets are built) can be told apart from
    // every other outcome and report `None` for "the width that was fitted" too, the same as
    // `lower_and_size`'s pre-checked refusal above returns for the other three conditions. `Some(width)`
    // there would claim a width was fitted when nothing was: `TmRun::TooLarge` means the program never
    // ran a single step, at ANY width, so no width is more "the" answer than another — reporting the
    // search's current width would just be exposing where it happened to be standing when the refusal
    // surfaced.
    match search_width(|w| attempt(&prog, &*enc.at_width(w), n_slots, caps), |a| matches!(a.0, TmRun::Overflow)) {
        None => (TmRun::TooLarge, None),
        Some((a, width)) => (a.0, Some(width)),
    }
```

Leave everything above it — the `lower_and_size` call, `n_slots`, and the `enc.field_width().is_none()` early return — exactly as it is. That branch never enters the search and must stay outside the helper.

From `run_tm_fitted`'s doc comment, delete the two paragraphs beginning `Only the GUARD triggers a retry` and `The retries are cheap BECAUSE of the guard` — they now live on `search_width`. Keep the first paragraph and the sentence about `field_width() == None`, and change `Attempts MIN_FIELD_WIDTH, doubling, up to MAX_FIELD_WIDTH; ...` to point at the helper: `The search is `search_width`; see its doc for why only the guard retries.`

- [ ] **Step 6: Rewrite `run_tm_described` over the helper**

Replace the body from `let mut width = MIN_FIELD_WIDTH;` to the end of the function with:

```rust
    search_width(
        |w| describe_at(&prog, n_slots, kind, result.clone(), caps, w),
        |d| matches!(d.run, TmRun::Overflow),
    )
    .map(|(d, _)| d)
    .ok_or(TmRun::TooLarge)
```

Keep the `#[allow(clippy::needless_pass_by_value)]` and the comment block above it explaining it — `result.clone()` still happens per attempt, so the measurement that comment records is still the reason.

In its doc comment, **delete the sentence** `Mirrors `run_tm_fitted`'s search — `MIN_FIELD_WIDTH`, doubling, retrying only on the overflow guard — but has no unbounded-encoding branch: `EncodingKind` names only bounded encodings, since an unbounded one has no name to write in a file.` and replace it with: `Shares `search_width` with `run_tm_fitted`, and has no unbounded-encoding branch: `EncodingKind` names only bounded encodings, since an unbounded one has no name to write in a file.` The claim about mirroring another function is the drift this task removes; there is nothing left to mirror.

- [ ] **Step 7: Run the full core suite**

Run: `cargo nextest run -p redextape-core`
Expected: PASS, with no test edited other than the one added in Step 1.

- [ ] **Step 8: Sabotage the helper twice and record what reddens**

A refactor whose suite is green before and after has demonstrated nothing. Run both, record the failing test names in the commit message, and revert each before the next.

Sabotage A — never retry. Change `if overflowed(&got) && width < MAX_FIELD_WIDTH {` to `if false {`.
Run: `cargo nextest run -p redextape-core`
Expected: FAIL, including `the_search_accepts_what_a_narrow_pin_refuses` and `the_two_entry_points_fit_the_same_width`.

Sabotage B — start at the ceiling. Change `let mut width = MIN_FIELD_WIDTH;` to `let mut width = MAX_FIELD_WIDTH;`.
Run: `cargo nextest run -p redextape-core`
Expected: FAIL, including `divergence_is_not_retried_as_an_overflow`, which asserts `Some(MIN_FIELD_WIDTH)`.

If either sabotage leaves the suite green, stop and report — the fold is unguarded and the task is not done.

- [ ] **Step 9: Mark the three `widths()` copies as deliberate**

Add one line to each doc comment. `crates/redextape-core/tests/tm_bank_invariant.rs:65` and `crates/redextape-core/tests/tm_width_equivalence.rs:38` currently read `/// Every width auto-fit can choose.`; `crates/redextape-core/examples/width_report.rs:110` reads `/// Every width auto-fit can choose, narrowest first.` Append to each, preserving its existing first line:

```rust
///
/// **A DELIBERATE INDEPENDENT MODEL OF `tm.rs`'s `search_width`, NOT A DUPLICATE TO BE FOLDED.** This
/// file asserts things ABOUT the ladder; routing it through the library's own definition would make it
/// walk whatever that definition says and stop it being able to disagree. Leave the copy.
```

The `width_report.rs` copy is an example rather than a gate, and gets the same line for the same reason: the next sibling search that greps for identical functions must find the answer at all three, not two.

- [ ] **Step 10: Format, gate, and commit**

```bash
cargo fmt
cargo nextest run -p redextape-core
git add crates/redextape-core/src/tm.rs \
        crates/redextape-core/tests/tm_bank_invariant.rs \
        crates/redextape-core/tests/tm_width_equivalence.rs \
        crates/redextape-core/examples/width_report.rs
git commit
```

The commit message must name both sabotages from Step 8 and the tests each reddened. Do not use `--no-verify`; if `cargo clippy` blocks the commit, fix the lint.

---

## Task 2: Disposition the 45 brief references

**Files:** 27, listed in full below. No executable line changes in any of them.

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing Task 1 or any later task reads.

**The rule, from spec §3.1.** Each site gets one of three dispositions, decided with the file open:

1. **Name the document** — the fact came from a plan or spec in `docs/superpowers/`; cite it by filename. Never `filename:line` (the citation gate rejects it).
2. **Drop the possessive** — the fact stands alone and the brief was only its provenance. `the brief's original 3-element literal` → `the original 3-element literal`.
3. **Reword to preserve the meaning** — the reference is load-bearing: it records that a figure, layout or method came from *outside* the implementation. Spec §3.2 defines the test. `tm_foreign_reader.rs` and `lambda_foreign_reader.rs` are where this concentrates; those two files exist to demonstrate that an independent implementer reading only doc comments reaches the same answer, and their briefs are named exactly where that independence is qualified. **Deleting one of those would make the test claim more independence than it has.**

**Replacement wording is NOT prescribed here, deliberately.** The `wire-type-generation` slice recorded five of six correction rounds landing on prose the plan or spec wrote rather than an implementer; `minor-findings-cleanup` recorded four defects written by the plan. Writing 45 replacement comments from outside the files would reproduce exactly that. Read each site, decide, write it there.

### The inventory — 45 sites, 27 files, measured at `45aa45a`

**Rust — 27 sites across 13 files:**

```
crates/redextape-cli/tests/config_cli.rs               138
crates/redextape-core/examples/lambda_sharing_probe.rs 1357 1386
crates/redextape-core/examples/none_probe.rs           62
crates/redextape-core/examples/step_survey.rs          271 324
crates/redextape-core/tests/asm_roundtrip.rs           210
crates/redextape-core/tests/lambda_foreign_reader.rs   88 94 98 144 145 146 455
crates/redextape-core/tests/lambda_provenance.rs       342
crates/redextape-core/tests/tm_foreign_reader.rs       43 45 51
crates/redextape-core/tests/viewmodel_contract.rs      912
crates/redextape-grammar-check/build.rs                30
crates/redextape-native/src/jit.rs                     697
crates/redextape-native/src/measure.rs                 54 72 78
crates/redextape-wasm/tests/browser.rs                 158 600 711
```

**Web — 18 sites across 14 files:**

```
web/src/compile.ts                          35 41
web/src/main.ts                             127
web/src/replies.ts                          69 95
web/src/session-worker.ts                   23
web/src/style.css                           67
web/tests/browser/buffers-quota.test.ts     80
web/tests/browser/lambda-pane-editor.test.ts 36
web/tests/browser/scratch-edit.test.ts      18
web/tests/browser/scratch-editor.test.ts    6 8 78
web/tests/browser/scratch-fork.test.ts      730
web/tests/browser/tm-blank-buffer.test.ts   250
web/tests/browser/tm-fork-cost.test.ts      49
web/tests/browser/tm-pane-editor.test.ts    100
web/tests/browser/worker.test.ts            66
```

Line numbers are as at `45aa45a` and are a starting index, not an authority — re-grep the file rather than trusting the number if an edit above a site has shifted it.

- [ ] **Step 1: Confirm the starting count**

Run:
```bash
git ls-files -z | grep -zv '^docs/' | grep -zv '^LICENSE.md$' \
  | xargs -0 grep -lic brief | while read -r f; do
      echo $(( $(grep -ic brief "$f") - $(grep -ic briefly "$f") )); done \
  | paste -sd+ | bc
```
Expected: `45`. If it is not 45, the tree has moved since the spec was written — re-derive the inventory before editing anything.

- [ ] **Step 2: Disposition the 13 Rust files**

Work file by file down the Rust inventory. For each site: read enough surrounding context to know what the sentence is claiming, pick a disposition, write the replacement. `grep -in brief <file> | grep -vi briefly` re-locates the sites in a file you have already edited.

Two sites need naming, because they are the ones most likely to be got wrong:
- `crates/redextape-core/tests/tm_foreign_reader.rs` lines 43, 45 and 51 are all about how much of the heap layout the independent reader derived for itself. All three are candidates for disposition 3, and the file's whole claim to being a foreign reader rests on them reading correctly afterwards.
- `crates/redextape-core/tests/lambda_foreign_reader.rs` line 94 says the brief *banned* a file. That is a fact about how the test was constructed and it has no other home — reword, do not delete.

- [ ] **Step 3: Gate and commit the Rust half**

```bash
cargo fmt
cargo clippy --all-targets -- -D warnings
scripts/check-citations.sh --self-test && scripts/check-citations.sh
git add crates/
git commit
```

Committing the two halves separately is deliberate: the Rust and web gates are different, and a reviewer can accept one half while rejecting the other.

- [ ] **Step 4: Disposition the 14 web files**

Same rule, same method. Note `web/src/style.css:67` is a CSS comment, not a doc comment — no `/** */` convention applies there, match the file's own style. The four `web/src/*.ts` sites are production source: `compile.ts` and `replies.ts` each carry two references describing a signature the brief specified and the implementation deviated from, which is disposition 3 material — the deviation is the point of the comment.

- [ ] **Step 5: Gate and commit the web half**

```bash
cd web && pnpm run typecheck && npx biome ci . ; cd ..
scripts/check-citations.sh --self-test && scripts/check-citations.sh
git add web/
git commit
```

- [ ] **Step 6: Verify the count reaches zero and `docs/` is untouched**

Run:
```bash
git ls-files -z | grep -zv '^docs/' | grep -zv '^LICENSE.md$' \
  | xargs -0 grep -lic brief | while read -r f; do
      echo $(( $(grep -ic brief "$f") - $(grep -ic briefly "$f") )); done \
  | paste -sd+ | bc
git diff --stat 45aa45a -- docs/
```
Expected: `0` for the first; the second must show only the spec and this plan, and no change to any file that existed at `45aa45a`.

If the first command errors with `bc: command not found` on an empty pipeline rather than printing `0`, that is the success case reading badly — `paste -sd+` on empty input feeds `bc` nothing. Confirm with `git ls-files -z | grep -zv '^docs/' | grep -zv '^LICENSE.md$' | xargs -0 grep -lic brief | wc -l`, which must print `0`.

---

## Task 3: Roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` — append one `####` entry at the end of the file.
- Modify: the TM-header slice's *"Still open after slice 2"* list — strike item 3 and mark it closed, matching how items 1, 2 and 4 in that same list are already struck.

**Interfaces:**
- Consumes: the sabotage results from Task 1 Step 8 and the counts from Task 2 Steps 1 and 6.
- Produces: nothing.

- [ ] **Step 1: Write the entry**

It must carry, and each figure must name the command that produced it and be re-run at the commit the entry describes:

- The class measurement: filed at 15 sites across 10 files, measured at 45 across 27 — **3.0x and 2.7x** — and that this is the third consecutive instance of the `~2x short` prediction the roadmap's own *"grep the tree for a falsified claim"* lesson makes. Name the two prior runs (6→13→14→15 and 5→8→9→17).
- That the first per-file tally taken while writing the spec was itself short, because a case-sensitive selector fed a case-insensitive count and dropped every file carrying only uppercase `BRIEF` — five of the seven `web/src/` sites.
- That the width-search filing named two copies and there were five, and that **three were deliberately not folded**, with §2.2's argument.
- Both sabotages from Task 1 Step 8 and the tests each reddened.
- **That no gate holds either result.** Spec §3.4: the brief item closes by measurement at a named commit, not by a checker. State the property — no non-`docs/` source file cites a brief — alongside whatever the count is.
- Spec §7's limit: the inventory counted the word `brief`, so the class is closed *for the spelling that was searched*. Name the search.

- [ ] **Step 2: Strike the closed roadmap item**

Item 3 of *"Still open after slice 2"* reads:

> 3. `run_tm_fitted` and `run_tm_described` each carry their own `MIN_FIELD_WIDTH`/doubling/`Overflow` retry loop. They agree today and nothing pins that they keep agreeing.

Wrap it in `~~`…`~~` and append **`CLOSED (2026-09-02, branch `search-fold-and-brief-refs`).`** plus one sentence recording that the filing said two copies and the tree had five. Items 1, 2 and 4 in that list already use this form — match it.

- [ ] **Step 3: Run the full gate and commit**

```bash
./scripts/check-all.sh
pre-commit run --all-files
git status --porcelain
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit
```

`check-all.sh` must run in its **full** form — no `--no-llvm --no-browser`. Quote its actual closing line in the entry rather than calling the run green; the two closing lines say different things and only one of them is a full gate. `git status --porcelain` must be empty when it finishes.

---

## Self-Review

**Spec coverage.** §2.1 → Task 1 Steps 4–6. §2.2 → Task 1 Step 9. §2.3 → Task 1 Steps 5–6 (doc deletions). §3.1 → Task 2's rule block. §3.2 → Task 2 Steps 2 and 4. §3.3 → Global Constraints and Task 2 Step 6's `docs/` diff check. §3.4 → Task 3 Step 1. §4 → File Structure disjointness note and Global Constraints' serialized-commit rule. §5 → Task 1 Steps 1–3, 7, 8. §6 → Task 3 Step 3. §7 → Task 3 Step 1's last bullet.

**Placeholder scan.** No TBDs. Task 2 deliberately does not prescribe replacement wording; that is spec §3.1's decision with its reason attached, not an omission — the inventory, the rule and the three dispositions are all concrete.

**Type consistency.** `search_width` has one signature, given in the Interfaces block and repeated verbatim in Step 4. `attempt` returns `Option<(TmRun, Machine, Vec<Vec<u8>>, u64)>`, so `|a| matches!(a.0, TmRun::Overflow)` reads its first field; `describe_at` returns `Option<DescribedRun>`, so `|d| matches!(d.run, TmRun::Overflow)` reads its `run` field. Both match the closures in Steps 5 and 6.
