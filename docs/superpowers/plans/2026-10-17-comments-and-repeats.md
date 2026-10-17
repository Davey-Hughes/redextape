# Comments and repeats: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut every code comment down to its why, moving the history and measurements it carries into the docs or dropping them, and combine the repeated code the 2026-10-17 audit found in the probes and the tests. Nothing the code does changes.

**Architecture:** Comment work runs extract → decide → apply → verify, using the tools in `.superpowers/sdd/comment-pass/` (gitignored, never committed). `worklist.py` lists the comment blocks worth looking at, one chunk per task. The agent writes one decisions file, `apply.py` applies it, and `check_comment_only.py` proves the code stream is byte-identical. Combining code is ordinary refactoring, proven by clippy, unchanged test counts, `coverage_diff.py`, and one hand-applied defect per new helper.

**Tech Stack:** Python 3 (tools), Rust (cargo nextest, cargo-llvm-cov, clippy pedantic), TypeScript (vitest node + browser projects, biome, tsc).

## Global Constraints

- **The comment rule (the user, 2026-10-17):** a comment holds the why: the reason, the invariant, what breaks if it changes. History (what the code used to do, how a defect was found, a struck-out earlier reason, a PR's story) and measurements come out of comments, "moved to docs" or "dropped too … either way they should be moved out of comments." A comment may point at a doc section or an issue number; it does not retell it.
- **Trim level the user chose:** "drop history, keep why". Example (taiyaku, `derive.rs`): 9 lines became 6 by deleting "this function used to make four: …" and keeping the reason, the invariant and the O-number.
- **Comment-only commits:** in Parts C and D every commit leaves `python3 .superpowers/sdd/comment-pass/check_comment_only.py <base>` at exit 0, where `<base>` is the commit the branch was cut from.
- **Moved text is copied verbatim** (comment markers stripped, nothing reworded) into `docs/superpowers/notes/2026-10-17-code-history-<area>.md`; `apply.py` writes the entry headings.
- **Doctests and these doc sections stay:** fenced code inside comments, and `# Errors`, `# Panics`, `# Safety` and `# Examples` sections. Clippy pedantic (`missing_errors_doc`, `missing_panics_doc`) and rustdoc depend on them. Every doc comment on a public item keeps at least its first sentence.
- **Replacement text adds no fact the original did not state,** and backticks every identifier (`clippy::doc_markdown`).
- **Never `--no-verify`.** The pre-commit hooks (fmt, `cargo clippy --workspace --all-targets -- -D warnings`, biome, tsc, the `check-*.sh` gates) run on every commit.
- **No `#[allow(dead_code)]`** to make a shared module compile (see the `dead-code-allow-shields-its-callees` memory).
- **One subagent task finishes in under ~150 calls;** a comment chunk is at most 150 blocks.
- **`web/node_modules` follows the checked-out lockfile.** Run `pnpm -C web install` after switching branches.
- **PRs:** one line per paragraph in the body (Forgejo hard-wraps), the squash template omits the description, and the user merges.

## Decisions (approved by the user as written, 2026-10-17)

1. **Where moved text goes:** one notes file per area, `docs/superpowers/notes/2026-10-17-code-history-<area>.md`, with areas `probes`, `core`, `core-tests`, `wasm-native`, `cli-lsp-support`, `scripts-ci`, `web-src` and `web-tests`.
2. **Models:** comment chunks implemented and task-reviewed on Sonnet, the checker being the proof that no code moved; one whole-PR review on Opus per PR; Parts A and B implemented on Opus.
3. **The tools stay uncommitted** in `.superpowers/sdd/comment-pass/`. They are instruments for this pass, and taiyaku gets a copy for its turn.
4. **Four PRs, in order:** A (probes) → B (test helpers) → C (comments in `crates/`, `scripts/`, `.forgejo/`) → D (comments in `web/`). Combining comes before trimming, so no comment gets trimmed in code that is about to move. One session per PR.
5. **Rough cost guess (not a measurement):** $150–300 for all four PRs at the model mix in item 2.

## The tools (built 2026-10-17; read each one's docstring)

| Tool | Does |
|---|---|
| `lexer.py` | Comment, string and code spans for Rust, TS/JS/TSX, CSS, and whole-line `#` comments for shell/YAML/TOML |
| `worklist.py OUT PATH… --max-blocks 150` | Lists the blocks flagged for history, measurement, or 11+ lines, as `OUT-01.md/.json`, `OUT-02…` |
| `apply.py WL.json DECISIONS.md [--dry-run]` | Applies `delete`/`replace` (+ optional `move`) decisions, finding each block by its exact text |
| `check_comment_only.py [BASE]` / `--self-test` | Exit 0 only if every changed source file keeps its code stream and doctest fences, and only `docs/**.md` else changed |
| `clones.py REPO OUT.json` | Repeated 6-line blocks (literals normalised), ranked |
| `coverage_diff.py A.lcov ROOT_A B.lcov ROOT_B` | Exit 0 only if every production file covers the same lines before and after |

`check_comment_only.py --self-test` passes 31/31. A trial on copies of `redextape-lsp/src/lib.rs` and `web/src/pane-host.ts` applied a replace with a move and a delete, verified clean, and failed on a deliberate one-character code change.

---

## Part A: PR 1, the probes share their copies

Branch `probe-support` from main.

### Task A1: move the byte-identical probe helpers into `examples/common/`

**Files:**
- Create: `crates/redextape-core/examples/common/demos.rs`, `common/text.rs`, `common/sourcemap_setup.rs`, `common/survey.rs` (names may follow what each file ends up holding; each file holds only items every includer uses)
- Modify: the probes named below, under `crates/redextape-core/examples/`

**Interfaces:**
- Produces: each shared file is included with `#[path = "common/<name>.rs"] mod <name>;` and its items are `pub(crate)`.

The candidates, from `clones.py` at `82dc507`:

| What | Copies |
|---|---|
| `const FIRST_ORDER_DEMOS` (byte-identical, md5 `7a40b8dd`) | `concurrency_probe.rs`, `lambda_sharing_probe.rs`, `list_reduction_probe.rs`, `state_cost_probe.rs` (`step_survey.rs` holds a different list: leave it) |
| `fn line` and the helpers after it (44 lines) | `blowup_probe.rs`, `guard_hole_probe.rs`, `list_reduction_probe.rs` |
| `fn nested_groups_src` (14 lines) | `blowup_probe.rs`, `guard_hole_probe.rs`, `list_reduction_probe.rs`, `shift_cost_probe.rs` |
| the `SourceMap` setup (16 lines) | `inherit_probe.rs`, `none_probe.rs`, `owner_probe.rs` |
| `fn steps_at`, `fn measure` | `step_survey.rs`, `width_report.rs` |
| the 30-line sum block | `lambda_sharing_probe.rs`, `shift_cost_probe.rs` |

- [ ] **Step 1: Prove each candidate's copies are byte-identical.** For each row, extract every copy with `sed -n 'A,Bp' FILE > /tmp/…` (in the session scratchpad) and `diff` them pairwise. A copy that differs, even in one character, stays where it is; note it in the commit message.
- [ ] **Step 2: Create the shared files** by moving one identical copy, comments included, into each `common/*.rs`. Group items so that every probe including a file uses every item in it. Split a file rather than allow dead code.
- [ ] **Step 3: Replace each copy** with the `#[path = …] mod …;` line and a `use` of the items. Delete the copy. A comment elsewhere that cites a moved item by its old file now names the wrong one; `check-attributions.sh` (a commit hook) flags it, and the citation is changed to name the `common/` file.
- [ ] **Step 4: Verify.**
  Run: `cargo clippy -p redextape-core --examples -- -D warnings && cargo build -p redextape-core --examples --release`
  Expected: both exit 0. The moved items are byte-identical, so no probe needs a run.
- [ ] **Step 5: Hand-applied defect.** Change one character in `FIRST_ORDER_DEMOS` in `common/demos.rs`, run `git diff --stat`, and confirm only the shared file changed. That proves the four probes now read one copy. Revert it.
- [ ] **Step 6: Commit** (hooks run):
  `git commit -m "The probes share one copy of their demo list and text helpers under examples/common/, where each carried its own"`
- [ ] **Step 7: Gate and PR.** Run `scripts/check-all.sh > <scratch>/gate.log 2>&1; echo "exit=$?"` and quote the exit line. Then push and open the PR only on the user's yes.

---

## Part B: PR 2, test helpers

Branch `test-helpers` from main after PR 1 merges.

### Task B1: baselines on main

**Files:** none in the repository. From the repo root, with `W=.superpowers/sdd/comment-pass` and `mkdir -p $W/b-baseline`, outputs go to `$W/b-baseline/`.

- [ ] **Step 1: Test counts.**
  Run: `cargo nextest list --workspace --message-format oneline > $W/b-baseline/nextest.txt && pnpm -C web exec vitest list > $W/b-baseline/vitest.txt`
  Expected: both exit 0. Record `wc -l` of each in `progress.md`.
- [ ] **Step 2: Coverage.**
  Run: `cargo llvm-cov nextest --workspace --lcov --output-path $W/b-baseline/rust.lcov` and `pnpm -C web exec vitest run --coverage --coverage.reporter=lcov --coverage.reportsDirectory=../$W/b-baseline/web`
  Expected: both exit 0; `rust.lcov` and `web/lcov.info` exist. These are the same suites CI runs: `cargo llvm-cov nextest --workspace` and `vitest run --coverage`, which merges the node and browser tiers.

### Task B2: Rust test helpers

**Files (the clusters, from `clones.py` at `82dc507`):**

| Cluster | Copies | Helper goes in |
|---|---|---|
| a TM machine literal (`start: N, …`, 14 lines) | 9 in `tm/syntax.rs`, `tm/machine.rs`, `tm/sim.rs`, `tm/single_tape.rs` | `crates/redextape-core/src/tm/test_fixtures.rs`, declared `#[cfg(test)] pub(crate) mod test_fixtures;` in `tm/mod.rs` |
| 11 lines | 4 in `tm/asm.rs`, `tm/lower_tm.rs`, `tm/decode.rs` | the same file |
| 11 lines | 5 in `tm/machine.rs`, `tm/sim.rs`, `tm/universal.rs`, `tests/trace_equivalence.rs` | `test_fixtures.rs` for the unit-test copies; the integration-test copy uses `crates/redextape-core/tests/common/` |
| 15 and 7 lines | 5 and 7 in `tm/encoding/unary.rs` | that file's test module |
| 10 lines | 5 in `tm/single_tape.rs` | that file's test module |
| 6 lines | 5 in `lambda/syntax.rs` | that file's test module |
| 7 lines | 6 in `redextape-cli/src/fmt.rs` | that file's test module |
| 6 and 11 lines | 6 and 3 in `redextape-test-support/src/ts_derive_scan.rs` | that file's test module |
| 26 lines | `redextape-core/tests/ts_bindings.rs`, `redextape-wasm/tests/ts_bindings.rs` | `redextape-test-support` (both crates already dev-depend on it) |
| 21 lines | `tests/asm_comments.rs`, `tests/tm_comments.rs` | `crates/redextape-core/tests/common/` |
| 7 lines | 4 in `tests/lambda_provenance.rs` | that file |

Regenerate the exact locations with `python3 .superpowers/sdd/comment-pass/clones.py . <scratch>/clones.json` and read them from the JSON. Line numbers there are the tree's at the time of the run.

- [ ] **Step 1: One cluster at a time,** extract the helper. Each copy's differing values become parameters. A copy whose shape differs, and is not just different literals, stays.
- [ ] **Step 2: After each cluster,** run that crate's tests: `cargo nextest run -p <crate>`. Expected: PASS, with the same test count as the baseline for that crate.
- [ ] **Step 3: Hand-applied defect, once per helper.** Break the helper (for example, return the wrong field) and confirm that at least one test from each former copy fails. Revert it. Record the failing test names in `progress.md`. A helper whose break no test notices means that copy's tests never depended on it; report that, don't hide it.
- [ ] **Step 4: Commit per cluster or per file** (hooks run), with a message in the repo's style saying what now shares what.

### Task B3: browser test helpers

**Files:** `web/tests/browser/harness.ts` (the existing shared fixtures) and the test files below.

| Cluster | Copies |
|---|---|
| `function splitVia(leaf, dir, pick)` (42 lines) | `active-pane`, `two-lambda-panes`, `pane-picker`, `tm-reduced-buffer` |
| the `describe` preamble (8 lines) | 7 files incl. `first-load-views`, `first-load-views-tall`, `four-views-fixture`, `scroll-kept-moved-editor`, `source-close-remembered` |
| `const titleOf` (12 lines) | `active-pane`, `buffer-cool-warm`, `buffer-restore`, `buffers-quota` |
| the `Worker.prototype.addEventListener` listener (13 lines) | `link-hold`, `tm-scratch-fork`, `readout-history-held`, `share-positions` |
| `const CONTROLS` (22 lines) | `asm-pane`, `panel-boundaries`, `panel-maximise` |
| 21 lines | `lambda-pane-editor`, `panel-regions`, `term-map`, `tm-pane-editor` |
| 18 and 11 lines | `tm-scratch-fork`, `tm-blank-buffer`, `tm-buffer-restore`; `editor-custody`, `scratch-fork` |
| 43 + 27 + 27 lines | `share-open-hashchange-encoding` and `-binary`: shared setup moves to a new `web/tests/browser/share-open-hashchange-fixture.ts`; both test files stay |

- [ ] **Step 1: One cluster at a time,** move the helper into `harness.ts` (or the new fixture file) and import it.
- [ ] **Step 2: After each cluster,** run: `pnpm -C web exec vitest run --project browser <the changed files>`. Expected: PASS, same test count.
- [ ] **Step 3: Hand-applied defect, once per helper,** exactly as in B2 Step 3.
- [ ] **Step 4: Commit per cluster** (hooks run).

### Task B4: prove the part

- [ ] **Step 1:** Repeat B1's commands on the branch, with `$W/b-after/` in place of `$W/b-baseline/`.
- [ ] **Step 2:** Test counts. Run: `diff <(sort $W/b-baseline/nextest.txt) <(sort $W/b-after/nextest.txt)` and the same for `vitest.txt`. Expected: the only differences are tests that moved file, and their number equals the baseline's.
- [ ] **Step 3:** Coverage. Run: `python3 $W/coverage_diff.py $W/b-baseline/rust.lcov <checkout B1 ran in> $W/b-after/rust.lcov <checkout B4 ran in>` and the same for `web/lcov.info`. Expected: exit 0, `0 differ`.
- [ ] **Step 4:** Gate (`scripts/check-all.sh`, log, quote the exit line), then PR on the user's yes.

---

## Part C: PR 3, comments in `crates/`, `scripts/`, `.forgejo/`

Branch `comments-crates` from main after PR 2 merges.

### Task C0: cut the chunks

- [ ] **Step 1:** From the repo root, run each line below (`W=.superpowers/sdd/comment-pass`). Use `--first-id` so ids never repeat across areas:

```bash
python3 $W/worklist.py $W/c/core       crates/redextape-core/src --max-blocks 150 --first-id 1
python3 $W/worklist.py $W/c/core-tests crates/redextape-core/tests --max-blocks 150 --first-id 1001
python3 $W/worklist.py $W/c/probes     crates/redextape-core/examples --max-blocks 150 --first-id 2001
python3 $W/worklist.py $W/c/wasm-native crates/redextape-wasm crates/redextape-native crates/redextape-native-rt --max-blocks 150 --first-id 3001
python3 $W/worklist.py $W/c/cli-lsp-support crates/redextape-cli crates/redextape-lsp crates/redextape-lsp-wasm crates/redextape-test-support crates/redextape-grammar-check --max-blocks 150 --first-id 4001
python3 $W/worklist.py $W/c/scripts-ci scripts .forgejo --max-blocks 150 --first-id 5001
```

  Expected at `82dc507` (Part A changes `probes`): about 377, 172, 102, 148, 146 and 92 blocks, so about nine chunks. List every chunk in `progress.md` as a task.

### Task C-chunk: one chunk (repeat for every chunk C0 listed)

**Files:**
- Modify: the source files the chunk names
- Create or append: `docs/superpowers/notes/2026-10-17-code-history-<area>.md`
- Create (not committed): `.superpowers/sdd/comment-pass/c/<chunk>-decisions.md`

- [ ] **Step 1: Read the chunk's `.md`.** Each block shows its text and the code it sits above. Read more of the file with `sed -n` only when a block cannot be judged from what is shown.
- [ ] **Step 2: Decide each block.**
  - **Keep** (write nothing) when it is all why: the reason, the invariant, what breaks if it changes, a safety argument.
  - **Delete** when nothing in it is why.
  - **Replace** when it mixes: delete the history and measurement sentences, rejoining what remains with the fewest words. Add no fact.
  - **Move** (a fence on a delete or replace) when a future editor could need the removed text to judge a change: the measurement behind a constant, a rejected alternative and why it failed, a defect's mechanism. **Drop** it when it only records that something happened: who found it, which review or lane, the old wording, a superseded number. When the comment cites a spec or plan that already holds the text, drop it and keep the pointer.
  - A number that is the reason for the constant right below stays, as one short clause; the story of how it was measured moves.
  - Keep `# Errors`, `# Panics`, `# Safety`, `# Examples`, every fenced block, and the first sentence of a public item's doc.
  - Shouting (ALL CAPS, bold) may go; the claim it carried stays.

  Worked example (the trial, `redextape-lsp/src/lib.rs`, 7 lines → 3, history moved):

````text
## B0004 replace
~~~~
            // A name nothing defines still has other mentions, and the index holds them:
            // with no binding, every occurrence of the name is a reference, including the one
            // under the cursor, so `include_declaration` has nothing to include and is not consulted.
~~~~
~~~~ move docs/superpowers/notes/2026-10-17-code-history-cli-lsp-support.md
This used to short-circuit on `definition_of(i)?` and answer `null`, which tells someone hunting every `jmp nowhere` still to fix that the name under their cursor is not a name — in exactly the mid-edit state `nav.rs`'s module doc calls the moment navigation is worth most.
~~~~
````

- [ ] **Step 3: Write `c/<chunk>-decisions.md`** in that format: one `## Bnnnn delete|replace` section per changed block; kept blocks get no section.
- [ ] **Step 4: Apply.**
  Run: `python3 $W/apply.py $W/c/<chunk>.json $W/c/<chunk>-decisions.md --dry-run`, then without `--dry-run`.
  Expected: `changed N blocks in M files; K moved to docs`. A "no longer in" stop means the file changed since the chunk was cut: re-cut that area's chunks and redo.
- [ ] **Step 5: Verify.**
  Run: `python3 $W/check_comment_only.py <base>`
  Expected: exit 0, `… changed only in comments; comment lines X -> Y`, and the notes file listed under `docs:`.
- [ ] **Step 6: Commit** (hooks run; clippy pedantic catches a lost `# Errors` or an unbackticked name):
  `git commit -m "Comments in <area> keep their why; the history and measurements they carried are in docs/superpowers/notes/2026-10-17-code-history-<area>.md or gone"`
- [ ] **Step 7: Task review** (fresh reviewer, the chunk's diff only: `git diff HEAD~1 -- . ':!docs'` and the notes file's new entries). The reviewer checks four things: no why, invariant, guard or safety argument was lost; moved text is verbatim; a replacement states nothing new; nothing dropped is something a future editor needs. Fixes go back to the same implementer.

### Task C-end: the part

- [ ] **Step 1:** `python3 $W/check_comment_only.py <base>` over the whole branch: exit 0.
- [ ] **Step 2:** Whole-PR review (Opus) of a sample: every tenth changed block across all chunks, plus every block the task reviews flagged.
- [ ] **Step 3:** Gate (`scripts/check-all.sh`, log, quote the exit line), PR body short, then PR on the user's yes.

---

## Part D: PR 4, comments in `web/`

Branch `comments-web` from main after PR 3 merges. The same tasks as Part C, with these chunks:

```bash
python3 $W/worklist.py $W/d/web-src   web/src web/vite.config.ts web/scripts --max-blocks 150 --first-id 6001
python3 $W/worklist.py $W/d/web-tests web/tests --max-blocks 150 --first-id 7001
```

Expected at `82dc507`: about 607 and 733 blocks, so about five and five chunks; Part B changes `web-tests`. Notes go to `docs/superpowers/notes/2026-10-17-code-history-web-src.md` and `…-web-tests.md`. In TSX, a JSX comment `{/* … */}` that is deleted goes with its braces; the checker counts the container as part of the comment.

Run Task C-chunk's seven steps for every chunk, then Task C-end's three steps for the part, with `d/` in place of `c/`.
