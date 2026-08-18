# Citation Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert all 55 surviving `file:line` citations in tracked source to symbol citations, finding and recording every stale one on the way, then install a gate that rejects the form.

**Architecture:** Six conversion tasks grouped by area, each self-contained and independently reviewable, followed by the gate itself and the roadmap entry. **The gate lands LAST and that ordering is the design** — a gate introduced over an unconverted tree either fails on 55 pre-existing hits or needs an allowlist, and §1.2 of the spec rejects the allowlist.

**Tech Stack:** Bash (the gate, on `scripts/check-text-bytes.sh`'s model), `pre-commit`, Forgejo Actions, plus Rust and TypeScript comments.

**Spec:** `docs/superpowers/specs/2026-08-17-citation-checker-design.md`. Read §4.1–§4.3 before Task 1.

## Global Constraints

- **The rule being installed: cite the SYMBOL, never the line.** A symbol survives every edit that does not rename it.
- **`docs/` IS OUT OF SCOPE.** Do not convert a citation in any file under `docs/`. Spec §4.2: those are dated records, and a line number in one is an observation that was true on its date. **This plan and the spec both live under `docs/` and both contain real `file:line` citations on purpose.**
- **No executable change in Tasks 1–6.** Comments only, with exactly two declared exceptions (Task 5) where a citation lives inside a string literal that is printed to a human.
- **A drift note writes the old coordinate in PROSE** — `` `desugar.rs` lines 129-140 `` — never in the banned form, or Task 7's gate fires inside the comment recording the hazard.
- **A stale citation is REPORTED, never quietly fixed.** When the cited line does not hold what the citing text claims, the correction is recorded at the site — a comment that silently starts naming something else teaches the next reader nothing about how it drifted. Spec §4.6.
- **Never `--no-verify`.** The pre-commit hook runs `cargo clippy --workspace --all-targets -- -D warnings` on any staged `.rs` and `biome ci` + `tsc --noEmit` on any staged web file. If a task's commit split is infeasible under that gate, collapse the commits and say so in the report.
- **No attribution trailers in commit messages.**
- **Every conversion keeps what the citation was arguing.** Only the coordinate changes, plus the sentence around it when the coordinate was wrong.

## The conversion procedure — IDENTICAL IN TASKS 1–6

This is the whole method. Apply it to every citation in the task's table, one at a time.

1. **Read the citing text.** What does it claim is at the cited coordinate? Write that claim down before looking.
2. **Resolve and read the cited line(s)** in the resolved path from the table.
3. **Compare, and record a verdict: ACCURATE or STALE.** Stale means the line does not hold what the citing text claims — including the case where it holds something adjacent and plausible, which is the most dangerous kind.
4. **Find the symbol that actually holds the material** the citing text is about — a `fn`, a `struct`, a `const`, a match arm named by its pattern, a test name, a heading. For an external crate, the symbol plus the pinned version (spec §3.2).
5. **Rewrite the citation to name that symbol.** Keep the surrounding argument intact.
6. **If the verdict was STALE, say so at the site** in the same doc comment, in one sentence: what it used to point at, and what was actually there.
7. **Move to the next citation.** Do not batch — a citation resolved in a hurry beside nine others is how the original 15 got written.

**A CITATION MAY NAME A LINE RANGE (`file:N-M`) OR A PAIR (`file:N,M`), AND 26 OF THE 55 DO.** It converts the same way: name the symbol, not the span. If the range genuinely covers several symbols, name the enclosing one.

**THE TABLES BELOW TRUNCATE THOSE FORMS, AND YOU MUST READ THE REAL CITATION IN THE TREE.** The corpus was built by a scan whose pattern stops at the first integer, so a citation the table shows as `desugar.rs:136` may be `desugar.rs:136,138` in the file — and that one mattered, because the claim was about a *pair* of `spans.push` calls sharing one `*span`. **Confirmed truncations: `lambda_provenance.rs:106` cites `reduce.rs:268,271`; `step_survey.rs:1236` cites `lower_asm.rs:247-250`.** Treat every table row as the coordinate to go *look at*, never as the coordinate itself.

### THE CONVERTED-CITATION WORDING — SETTLED BY TASK 1, REUSED BYTE-IDENTICALLY

The token that replaces a coordinate is:

```
`<file>`'s `<symbol>`
```

Backticked file basename, possessive `'s`, backticked symbol, **no line number**. As it stands in the tree after Task 1:

```
`session.rs`'s `Session::tm`
`types.ts`'s `LambdaState`
`parser.rs`'s `parse_block_body`
`desugar.rs`'s `lower_stmts_at`
```

Three clauses go with it, each forced by a real case rather than invented:

**(a) `<symbol>` is spelled the way its own language names it.** A Rust struct field is `Session::tm`; a match arm is named by its pattern inside its enclosing `fn`; a TypeScript type is its bare name.

**(b) Where the citing sentence already names the symbol in its own prose, the parenthetical keeps the file alone** — `` `SessionClient`'s `#gen` (`session-client.ts`) ``. The pair is still complete, just distributed across the sentence, and repeating the symbol inside its own parenthetical is noise. **This is NOT the path-only reference §4.1 rules out:** the prohibition is on a citation naming *only* a file, and here the symbol is named in the same clause, in the citing text's own words. **The test is the parenthetical: no parenthetical, no clause (b).** `` `desugar.rs`'s `lower_stmts_at`, in its `Stmt::Assign` arm `` is the plain form above with an arm named after it, not an instance of this clause — Task 1's report miscounted it as one, and this is the clause most likely to be misapplied.

**(c) A DRIFT NOTE NAMES THE OLD COORDINATE IN PROSE — `` `desugar.rs` lines 129-140 `` — NEVER `` `desugar.rs:129-140` ``.** This is load-bearing and easy to get wrong. Spec §3.3 has the gate grepping raw text, so Task 7's gate would fire on a drift note that quoted the old coordinate in the banned form — *inside the very comment recording that the form is dangerous.* Write the numbers, drop the colon.

**(d) A DRIFT NOTE NAMES THE OLD COORDINATE AND THE DELTA. IT NEVER NAMES A NEW ONE.** Added after Task 3's review found the branch quietly minting fresh line pointers inside the notes that exist to condemn them — *"that call is at 810"*, *"the guard is at 363 today"*, *"pushed it down 44 lines to 696"*. Task 2 shipped the same shape first, so this is a branch-wide correction rather than one task's slip.

**The asymmetry is the point, and it is not a style preference.** The OLD coordinate is a permanent historical fact: `lower.rs` line 611 held that call at `0844f27` and always will have. A **present-tense** coordinate is a live pointer with the full drift risk of the thing being retired — and worse than the citations this slice converts, because prose form is deliberately outside the gate (spec §4.3), so nothing will ever catch it going stale.

So a drift note carries: **the old coordinate, the delta, and the SYMBOL.** The symbol is what says where the material is now.

> **Wrong:** …`lower.rs` line 611 held that call; it is at 655 today.
> **Right:** …`lower.rs` line 611 held that call; #31 moved it 44 lines, and it is now `lower_region_body`'s `Core::Let { mutable: true }` arm.

**REPORT FORMAT, REQUIRED FOR EVERY TASK.** A table with one row per citation: the citing site, the old coordinate, the verdict, and the symbol it became. **Report the LIST, never a bare count** — 5d-ii-d's ledger recorded counts that were wrong four times running, and the list-not-count rule caught real loss twice on the branch after it.

## Per-task verification — IDENTICAL IN TASKS 1–6

- [ ] **The task's files hold zero citations afterwards:**
  ```bash
  rg -n '[A-Za-z0-9_./-]+\.(rs|ts|tsx|js|json|toml|yml|yaml|css|md|sh):[0-9]+' <the task's files>
  ```
  Expected: no output, exit 1.

- [ ] **No executable line changed.** For TypeScript, strip comments from both revisions and diff:
  ```bash
  STRIP='/^[[:space:]]*\/\*\*/{inb=1} inb{if(/\*\//) inb=0; next} /^[[:space:]]*\/\//{next} {print}'
  diff <(git show <BASE>:<FILE> | awk "$STRIP") <(awk "$STRIP" <FILE>) && echo "NO CODE CHANGED"
  ```
  For Rust, `//`, `///` and `//!` are all leading-slash lines, so the same strip works with `/^[[:space:]]*\/\//{next}` alone.

  **USE PROCESS SUBSTITUTION, NEVER TEMP FILES.** This shell runs `noclobber`: a `>` redirect onto an existing path is *silently refused*, so `diff` compares a stale snapshot and reports a **pass on a tree it never read**. That defect shipped a false pass on the web-doc-history branch and was caught by luck.

## File Structure

| file | responsibility |
| --- | --- |
| `scripts/check-citations.sh` | **new** — the gate and its `--self-test`. One detection function, used by both. |
| `.pre-commit-config.yaml` | **modify** — one hook entry, `always_run: true`, `pass_filenames: false` |
| `.forgejo/workflows/ci.yml` | **modify** — the same script invoked the same way, so local and CI cannot drift |
| 26 source files | **modify** — comments only (two string literals excepted, Task 5) |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | **modify** — closing entry (Task 8) |

---

### Task 1: `web/` — 16 citations

**Files:** `web/src/layout.ts`, `web/src/protocol.ts`, `web/src/replies.ts`, `web/src/sessions.ts`, `web/tests/browser/affordability-worker.ts`, `web/tests/browser/lambda-pane-editor.test.ts`, `web/tests/browser/pool-isolation.test.ts`, `web/tests/browser/running-focus.test.ts`, `web/tests/node/session-pool.test.ts`, `web/tests/node/sessions.test.ts`

**Interfaces:** Produces the wording every later task copies. Whatever phrasing this task settles on for a converted citation, Tasks 2–6 reuse **byte-identically**.

| citing site | cites | resolves to |
| --- | --- | --- |
| `web/src/layout.ts:133` | `session.rs:257-273` | `crates/redextape-wasm/src/session.rs` |
| `web/src/protocol.ts:284` | `session.rs:257-273` | `crates/redextape-wasm/src/session.rs` |
| `web/src/protocol.ts:332` | `session.rs:257-273` | `crates/redextape-wasm/src/session.rs` |
| `web/src/replies.ts:291` | `session.rs:257-273` | `crates/redextape-wasm/src/session.rs` |
| `web/src/sessions.ts:91` | `session-client.ts:15` | `web/src/session-client.ts` |
| `web/src/sessions.ts:205` | `session.rs:257-273` | `crates/redextape-wasm/src/session.rs` |
| `web/src/sessions.ts:328` | `session.rs:257-273` | `crates/redextape-wasm/src/session.rs` |
| `web/tests/browser/affordability-worker.ts:13` | `session.rs:257-273` | `crates/redextape-wasm/src/session.rs` |
| `web/tests/browser/lambda-pane-editor.test.ts:38` | `types.ts:83-116` | `web/src/types.ts` |
| `web/tests/browser/pool-isolation.test.ts:117` | `types.ts:51` | `web/src/types.ts` |
| `web/tests/browser/running-focus.test.ts:59` | `desugar.rs:129-140` | `crates/redextape-core/src/desugar.rs` |
| `web/tests/browser/running-focus.test.ts:61` | `desugar.rs:136` | `crates/redextape-core/src/desugar.rs` |
| `web/tests/browser/running-focus.test.ts:79` | `parser.rs:97` | `crates/redextape-core/src/parser.rs` |
| `web/tests/browser/running-focus.test.ts:81` | `desugar.rs:129-160` | `crates/redextape-core/src/desugar.rs` |
| `web/tests/node/session-pool.test.ts:9` | `session-client.ts:9-12` | `web/src/session-client.ts` |
| `web/tests/node/sessions.test.ts:546` | `session.rs:257-273` | `crates/redextape-wasm/src/session.rs` |

- [ ] **Step 1: Resolve `session.rs:257-273` once, since eight sites share it**

  The 5d-ii-d design recorded this one as verified: it *"lands precisely on the `Result`-pairing doc block whose fabricated-state cost the citing comments say it 'prices'. Accurate."* **Confirm that independently rather than inheriting it** — read the block and name the symbol it belongs to.

  ```bash
  sed -n '250,280p' crates/redextape-wasm/src/session.rs
  ```

- [ ] **Step 2: Apply the conversion procedure to all 16**

  Eight are the shared `session.rs` target and convert to the same symbol. The other eight are distinct and each needs its own resolution pass.

- [ ] **Step 3: Verify — zero citations, no code changed**

  ```bash
  rg -n '[A-Za-z0-9_./-]+\.(rs|ts|tsx|js|json|toml|yml|yaml|css|md|sh):[0-9]+' web/src web/tests
  ```
  Expected: no output.

  Then the comment-strip diff from "Per-task verification" for each of the ten files, base `HEAD` at task start.

- [ ] **Step 4: Run the affected suites**

  ```bash
  cd web && PATH="$PATH:/usr/sbin" pnpm test
  ```
  Expected: **606 passed in 63 files** — unchanged. Chrome is off-PATH in `/usr/sbin`, hence the prefix.

- [ ] **Step 5: Commit**

  ```bash
  git add web/ && git commit -F <message file>
  ```
  The message names the verdict split — how many were accurate, how many stale — and lists the stale ones.

---

### Task 1b: the two live PROSE-FORM pointers — added after Task 1's review

**Files:** Modify `web/tests/browser/buffers-quota.test.ts`, `web/src/main.ts`

**Why this task exists.** Task 1's review found that `web/tests` is free of the **colon** form, not of line pointers. A pointer written `` (`replies.ts` lines 325-341) `` rots exactly like `replies.ts:325-341`, and the gate in Task 7 cannot see it. **One of the two is already stale.**

**THE GATE IS NOT BEING EXTENDED TO THIS FORM, AND THE REASON IS MEASURED.** Tracked source holds 15 prose-form hits; only these 2 are live pointers. Six are coverage figures in `vite.config.ts` (*"THEY ARE: lines 97.99 (1513/1544)"*), one is a CI flag (`--fail-under-lines 90`), and six are **drift notes deliberately written in prose** so they do not trip the gate. A gate on this form would fire on **13 non-citations to catch 2** — the spurious-firing failure the roadmap names. Spec §4.3 records this; the residual risk is stated rather than closed.

| citing site | cites | verdict already established |
| --- | --- | --- |
| `web/tests/browser/buffers-quota.test.ts:102` | `` `replies.ts` lines 325-341 `` | **STALE by ~29 lines** |
| `web/src/main.ts:1037` | `draw.ts` *"(lines 82–83), (127) and (174)"* | accurate today, but pure line pointers |

- [ ] **Step 1: `buffers-quota.test.ts:102` — the stale one**

  The comment claims `.term-editor` mounts synchronously before `onBuffersPersist()` runs, citing `replies.ts` lines 325-341. **In `web/src/replies.ts` those calls are at 354 (`setEditor`) and 370 (`onBuffersPersist()`); lines 325-341 are comment prose about `linkIndex` nullability.** Undershoots by ~29. Convert to the symbols, and record the drift at the site per the Global Constraints — **in prose form, never as `file:line`.**

- [ ] **Step 2: `main.ts:1037` — three bare parenthetical line numbers**

  It reads `` `panes.active('tm')` (lines 82–83), `panes.all()` (127) and `panes.of('lambda')` (174) ``, pointing into `draw.ts`. The reviewer confirmed these are currently accurate. **Accurate is not the standard** — they are naked coordinates with nothing anchoring them, and the sentence already names all three symbols, so clause (b) applies: the symbols carry the reference and the numbers simply go.

- [ ] **Step 3: Verify — no colon form introduced, and no executable change**

  ```bash
  rg -n '[A-Za-z0-9_./-]+\.(rs|ts|tsx|js|json|toml|yml|yaml|css|md|sh):[0-9]+' web/src web/tests
  ```
  Expected: no output. Then the comment-strip diff for both files.

- [ ] **Step 4: Run the covering tests**

  ```bash
  cd web && PATH="$PATH:/usr/sbin" pnpm exec vitest run --project browser tests/browser/buffers-quota.test.ts
  cd web && PATH="$PATH:/usr/sbin" pnpm test
  ```

- [ ] **Step 5: Commit**

---

### Task 2: `crates/redextape-core/tests/lambda_provenance.rs` — 11 citations

**Files:** Modify `crates/redextape-core/tests/lambda_provenance.rs`

**Interfaces:** Consumes Task 1's citation wording. **This file holds one of the three confirmed-stale citations** and is the densest single file in the corpus.

| citing site | cites | resolves to |
| --- | --- | --- |
| `:106` | `reduce.rs:268,271` | `crates/redextape-core/src/lambda/reduce.rs` |
| `:161` | `desugar.rs:119-123` | `crates/redextape-core/src/desugar.rs` |
| `:475` | `lower.rs:637` | `crates/redextape-core/src/lambda/lower.rs` |
| `:478` | `lower.rs:637` | `crates/redextape-core/src/lambda/lower.rs` |
| `:567` | `core.rs:85-89` | `crates/redextape-core/src/core.rs` |
| `:627` | `lower.rs:83-86` | `crates/redextape-core/src/lambda/lower.rs` |
| `:662` | `desugar.rs:141-153` | `crates/redextape-core/src/desugar.rs` |
| `:663` | `desugar.rs:93-99` | `crates/redextape-core/src/desugar.rs` |
| `:674` | `lower.rs:566` | `crates/redextape-core/src/lambda/lower.rs` |
| `:677` | `lower.rs:1204` | `crates/redextape-core/src/lambda/lower.rs` |
| `:679` | `lower.rs:1193-1198` | `crates/redextape-core/src/lambda/lower.rs` |

- [ ] **Step 1: The known-stale one, at `:475`**

  It claims `lower_region_body`'s **`Let { mutable: false }`** arm is at `lower.rs:637`. Verified for the spec:

  ```
  636:        Core::Let { mutable: true,  id, name, value, body, .. } => {
  637:            origins.at_root(*id);
  ...
  663:        Core::Let { mutable: false, id, name, value, body, .. } => {
  664:            origins.at_root(*id);
  ```

  **So `637` is the `mutable: true` arm — the opposite one — and `mutable: false`'s tag is at `664`.** Undershoots by 27 and reads as confirmation. `:478` cites the same coordinate; resolve it on its own terms, since the two citing sentences may not be making the same claim.

  The replacement names the arm, not a line: `lower_region_body`'s `Core::Let { mutable: false }` arm. Record the drift at the site per the Global Constraints.

- [ ] **Step 2: Apply the conversion procedure to the remaining nine**

- [ ] **Step 3: Verify — zero citations, no code changed**

  ```bash
  rg -n '[A-Za-z0-9_./-]+\.(rs|ts):[0-9]+' crates/redextape-core/tests/lambda_provenance.rs
  diff <(git show HEAD:crates/redextape-core/tests/lambda_provenance.rs | awk '/^[[:space:]]*\/\//{next} {print}') \
       <(awk '/^[[:space:]]*\/\//{next} {print}' crates/redextape-core/tests/lambda_provenance.rs) && echo "NO CODE CHANGED"
  ```

- [ ] **Step 4: Run the test**

  ```bash
  cargo nextest run -p redextape-core --test lambda_provenance
  ```
  Expected: unchanged pass count.

- [ ] **Step 5: Commit** — the message lists every stale citation and what it actually pointed at.

---

### Task 3: `zipper_equivalence.rs` and `sourcemap_coverage.rs` — 9 citations

**Files:** Modify `crates/redextape-core/tests/zipper_equivalence.rs`, `crates/redextape-core/tests/sourcemap_coverage.rs`

**Interfaces:** Consumes Task 1's wording. **Holds the other two confirmed-stale citations, both on one line.**

| citing site | cites | resolves to |
| --- | --- | --- |
| `zipper_equivalence.rs:58` | `core.rs:84-89` | `crates/redextape-core/src/core.rs` |
| `zipper_equivalence.rs:77` | `three_way_oracle.rs:529` | `crates/redextape-core/tests/three_way_oracle.rs` |
| `zipper_equivalence.rs:110` | `lower.rs:611` | `crates/redextape-core/src/lambda/lower.rs` |
| `zipper_equivalence.rs:110` | `lower.rs:766` | `crates/redextape-core/src/lambda/lower.rs` |
| `zipper_equivalence.rs:272` | `lower.rs:652` | `crates/redextape-core/src/lambda/lower.rs` |
| `zipper_equivalence.rs:309` | `lower.rs:766` | `crates/redextape-core/src/lambda/lower.rs` |
| `zipper_equivalence.rs:371` | `llvm_oracle.rs:153` | `crates/redextape-native/tests/llvm_oracle.rs` |
| `zipper_equivalence.rs:376` | `three_way_oracle.rs:535` | `crates/redextape-core/tests/three_way_oracle.rs` |
| `sourcemap_coverage.rs:99` | `lower_asm.rs:321` | `crates/redextape-core/src/tm/lower_asm.rs` |

- [ ] **Step 1: The two known-stale ones, both on line 110**

  The sentence reads: *"reverting `Let { mutable: true }`'s own tag (`lower.rs:611`) or `build_while`'s root tag (`lower.rs:766`) individually still left `exact` at 49 and 50 respectively"*. Verified for the spec:

  - `lower.rs:611` is `Ok(app(abs(STORE, body), initial_store))` — the end of a different function. **`Let { mutable: true }`'s tag is at `637`.** Undershoots by 26.
  - `lower.rs:766` is a bare `}`. **`build_while` starts at `771`.** Undershoots by 5.

  **The measurement in that sentence is still good and must survive** — *"Measured 2026-08-10 … still left `exact` at 49 and 50 respectively"* is a dated observation about a real run. Only the two coordinates are wrong. `:309` cites `lower.rs:766` again and gets its own resolution.

- [ ] **Step 2: Apply the conversion procedure to the remaining seven**

- [ ] **Step 3: Verify — zero citations, no code changed** (same two commands as Task 2, per file)

- [ ] **Step 4: Run the tests**

  ```bash
  cargo nextest run -p redextape-core --test zipper_equivalence --test sourcemap_coverage
  ```

- [ ] **Step 5: Commit**

---

### Task 4: `crates/redextape-core/src/` — 5 citations

**Files:** Modify `crates/redextape-core/src/lambda/lower.rs`, `crates/redextape-core/src/lambda/term.rs`, `crates/redextape-core/src/sourcemap.rs`, `crates/redextape-core/src/viewmodel.rs`

| citing site | cites | resolves to |
| --- | --- | --- |
| `lambda/lower.rs:1241` | `lower.rs:576` | `crates/redextape-core/src/lambda/lower.rs` (itself) |
| `lambda/lower.rs:1242` | `desugar.rs:77-84` | `crates/redextape-core/src/desugar.rs` |
| `lambda/term.rs:146` | `tests/lambda_sharing.rs:73-81` | `crates/redextape-core/tests/lambda_sharing.rs` |
| `sourcemap.rs:22` | `lower_asm.rs:321` | `crates/redextape-core/src/tm/lower_asm.rs` |
| `viewmodel.rs:220` | `lambda/term.rs:482` | `crates/redextape-core/src/lambda/term.rs` |

- [ ] **Step 1: Treat `lower.rs:1241` as the highest-risk citation in the corpus**

  It is a **self-citation** — `lower.rs` citing its own line 576 from line 1241. Spec §1.1: citations undershoot because a file grows above the cited line, *"and the commonest way for that to happen is the citing commit itself."* A self-citation is that hazard at its worst, since every edit to the file is an edit above or below it. Resolve it with extra care and expect it to be wrong.

- [ ] **Step 2: Apply the conversion procedure to the other four**

- [ ] **Step 3: Verify — zero citations, no code changed**

- [ ] **Step 4: Build and test**

  ```bash
  cargo clippy -p redextape-core --all-targets -- -D warnings
  cargo nextest run -p redextape-core
  ```

- [ ] **Step 5: Commit**

---

### Task 5: `crates/redextape-core/examples/` — 10 citations, TWO OF THEM IN STRING LITERALS

**Files:** Modify `crates/redextape-core/examples/blowup_probe.rs`, `frame_cost_probe.rs`, `lambda_sharing_probe.rs`, `link_index_probe.rs`, `owner_probe.rs`, `step_survey.rs`

| citing site | cites | resolves to |
| --- | --- | --- |
| `blowup_probe.rs:355` | `reduce.rs:64-80` | `crates/redextape-core/src/lambda/reduce.rs` |
| `blowup_probe.rs:753` | `trace.rs:73` | `crates/redextape-core/src/trace.rs` |
| `blowup_probe.rs:913` | `tm.rs:104-105` | `crates/redextape-core/src/tm.rs` |
| `blowup_probe.rs:948` | `trace.rs:112` | `crates/redextape-core/src/trace.rs` |
| `frame_cost_probe.rs:60` | `web/src/protocol.ts:10` | `web/src/protocol.ts` |
| `lambda_sharing_probe.rs:1872` | `.forgejo/workflows/ci.yml:112` | `.forgejo/workflows/ci.yml` |
| `link_index_probe.rs:52` | `web/src/protocol.ts:9` | `web/src/protocol.ts` |
| `owner_probe.rs:55` | `frame_cost_probe.rs:107-133` | `crates/redextape-core/examples/frame_cost_probe.rs` |
| `step_survey.rs:365` | `lower_asm.rs:247-250` | `crates/redextape-core/src/tm/lower_asm.rs` |
| `step_survey.rs:1236` | `lower_asm.rs:247-250` | `crates/redextape-core/src/tm/lower_asm.rs` |

- [ ] **Step 1: The two string-literal citations — THE ONLY EXECUTABLE LINES THIS SLICE MAY TOUCH**

  Both are probe output read by a human, not comments:

  ```rust
  // step_survey.rs:365
  println!("    a SINGLE asm instruction each (lower_asm.rs:247-250) — no frame, no Call, no Ret. They");
  // blowup_probe.rs:355
  "transcription of reduce.rs:64-80; the cursor calls this BEFORE EVERY STEP",
  ```

  **This is why the gate greps raw text rather than parsing comments** (spec §3.3): the citing context does not change whether the number rots. Convert the text inside the literal, and **declare both in the task report** so the reviewer knows the no-code-changed check is expected to show exactly these two lines and no others.

- [ ] **Step 2: `lambda_sharing_probe.rs:1872` cites a CI job by line**

  `.forgejo/workflows/ci.yml:112` — YAML has no symbols in the Rust sense, but it has **job and step names**, which are what a reader needs and what survives a reordering of the file. Name the job (and the step, if the line is inside one).

  ```bash
  sed -n '100,120p' .forgejo/workflows/ci.yml
  ```

- [ ] **Step 3: Apply the conversion procedure to the remaining eight**

- [ ] **Step 4: Verify — zero citations; no code changed EXCEPT the two declared literals**

- [ ] **Step 5: Build the examples**

  ```bash
  cargo clippy -p redextape-core --all-targets -- -D warnings
  ```
  **Do NOT run the probes.** Several are memory-hungry measurement binaries; a probe run needs a hard cgroup cap and is not part of this slice.

- [ ] **Step 6: Commit**

---

### Task 6: `crates/redextape-wasm/` and `crates/redextape-native/` — 4 citations

**Files:** Modify `crates/redextape-wasm/src/session.rs`, `crates/redextape-wasm/tests/browser.rs`, `crates/redextape-native/src/jit.rs`

| citing site | cites | resolves to |
| --- | --- | --- |
| `redextape-wasm/src/session.rs:1602` | `trace.rs:149-152` | `crates/redextape-core/src/trace.rs` |
| `redextape-wasm/tests/browser.rs:544` | `lambda/lower.rs:36-38` | `crates/redextape-core/src/lambda/lower.rs` |
| `redextape-wasm/tests/browser.rs:636` | `docs/…/2026-08-07-termnode-arena-design.md:37` | that spec |
| `redextape-native/src/jit.rs:101` | `src/backend.rs:60-74` | **cranelift-jit 0.134.2 — not in this repo** |

- [ ] **Step 1: The external citation, `jit.rs:101`**

  The doc reads: *"`JITBuilder::new` delegates to `with_flags(&[], ..)`, whose whole ISA setup is (cranelift-jit 0.134.2, `src/backend.rs:60-74`)"*.

  **Spec §3.2: this is not an exception.** The version pin stays, the provenance stays; name `with_flags` instead of `60-74`. The doc already names the function in the same sentence, so the coordinate is the only part carrying risk and the only part that goes.

- [ ] **Step 2: The docs citation, `browser.rs:636`**

  It cites **line 37 of a dated spec**. `docs/` is out of scope *as a citation site* — but this is a source file citing INTO docs, and that pointer rots exactly like any other. Convert it to name the spec's **heading or section number**, which is what a reader needs and what survives an edit above it.

- [ ] **Step 3: Apply the conversion procedure to the other two**

- [ ] **Step 4: Verify — zero citations, no code changed**

- [ ] **Step 5: Build**

  ```bash
  cargo clippy -p redextape-wasm -p redextape-native --all-targets -- -D warnings
  ```
  **The wasm browser test is not run here** — it needs a matching chromedriver, and `wasm-pack` fetches the LATEST rather than a matching one; the mismatch presents as `404` plus `SIGKILL`, which reads like an OOM. CI runs it.

- [ ] **Step 6: Commit**

---

### Task 7: The gate

**Files:** Create `scripts/check-citations.sh`. Modify `.pre-commit-config.yaml`, `.forgejo/workflows/ci.yml`.

**Interfaces:** Consumes a fully converted tree. **This task must run only after Tasks 1–6 are complete and their verification passed** — the gate's own acceptance criterion is that it reports zero on the real tree.

- [ ] **Step 1: Confirm the tree is clean before writing the gate**

  ```bash
  rg -n '[A-Za-z0-9_./-]+\.(rs|ts|tsx|js|json|toml|yml|yaml|css|md|sh):[0-9]+' \
     $(git ls-files | rg -v '^docs/' | rg -v '\.(png|jpg|jpeg|gif|ico|webp|pdf|wasm|woff2?|ttf|otf|zip|gz|tar|bin|snap|lock)$')
  ```
  Expected: no output. **If this prints anything, STOP and report** — a task missed a citation, and the gate must not be written to accommodate it.

- [ ] **Step 2: Write `scripts/check-citations.sh`**

  Model it on `scripts/check-text-bytes.sh` — read that file first; it is 117 lines and this one is its sibling. Required properties:

  - **One detection function**, called by both the scan and `--self-test`, so the self-test exercises the real thing rather than a paraphrase that could drift into agreeing with a broken scan.
  - **Walks `git ls-files`**, skips `docs/`, skips binary files by extension. The extension list is deliberately dumb and visible — a new binary format fails this gate until someone adds it, which is the loud direction to be wrong in.
  - **`--self-test` asserts BOTH directions**: a planted citation is caught, and a clean fixture passes. A gate that only ever runs against a passing tree cannot tell you it still works.
  - **The escape hatch** (spec §4.5): a line ending `check-citations: allow` is skipped, and the run prints how many it honoured. It ships at zero.
  - **THE HEADER MAY NOT CONTAIN A REAL CITATION.** A script whose doc shows `desugar.rs:77` fails itself on the first run. Write examples as `desugar.rs:<line>`; the only real one is built at runtime inside `--self-test` and never written to a tracked file.
  - **The error message teaches the rule**, naming the symbol alternative rather than only reporting a match.

- [ ] **Step 3: Run the self-test, then the scan**

  ```bash
  scripts/check-citations.sh --self-test && scripts/check-citations.sh
  ```
  Expected: self-test passes both directions; the scan reports **0 violations, 0 honoured markers**.

- [ ] **Step 4: Prove the gate catches a real one, by planting it in a real file**

  ```bash
  # plant, scan (expect FAIL), restore, scan (expect PASS)
  ```
  **The self-test is not sufficient evidence on its own** — `check-text-bytes.sh`'s first draft passed its own scan against a planted NUL, and only a by-hand test against the real thing found it. Plant into a tracked source file, confirm a non-zero exit and a message naming the file, then `git checkout` it and confirm the scan passes again.

- [ ] **Step 5: Wire the pre-commit hook**

  ```yaml
      - id: check-citations
        name: no file:line citations in tracked source
        entry: bash -c 'scripts/check-citations.sh --self-test && scripts/check-citations.sh'
        language: system
        always_run: true
        pass_filenames: false
  ```
  `--self-test` first, then the scan — the same order and the same reason as `check-text-bytes`. Both together are about **250 ms** for this gate and **574-594 ms** for `check-text-bytes`, measured rather than described. **This line said "milliseconds" until the whole-branch review**, which is a third place the adjective stood: `5d09d0c`'s subject claimed to fix it *"in three places"* and its body names two, both of which it did fix. **That SHA read `417a219` until the re-review** — a pre-rebase object, unreachable from `main` and from this branch, written INTO the commit that existed to remap the four SHAs the rebase rewrote, and missed by it. Its message asserted *"rewrote all four"* and *"only the coordinates moved"*; both were false when written.

- [ ] **Step 6: Mirror it into CI**

  Add the same invocation beside `check-text-bytes.sh` in `.forgejo/workflows/ci.yml`, in the same job, so local and CI cannot drift. **Never make it a skippable job.**

- [ ] **Step 7: Commit**

---

### Task 8: The roadmap closing entry

**Files:** Modify `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Write the entry**

  Follow the format of the two entries above it. It must carry:

  - **The stale count and the LIST**, not a count alone — this is the slice's headline deliverable, and the only number that says whether the conversion was worth doing.
  - **Why `docs/` is a scope boundary and not an exemption**, since that is the decision most likely to be re-litigated by someone finding 849 unconverted citations.
  - **The escape-hatch count**, and the standing rule that a non-zero count without an argument beside it is a finding.
  - **What this slice could not establish** — that symbol citations are unverified, and that the gate's false-positive rate over future code is unmeasured because today's tree has zero legitimate uses of the form.
  - **Closing forward on 5d-ii-d's filed follow-up**, without editing that dated entry. The web-doc-history convention: correcting history to match the present is worse than leaving it.

- [ ] **Step 2: Verify no control bytes**

  ```bash
  scripts/check-text-bytes.sh
  ```
  A roadmap entry quoting terminal output is exactly how a stray control byte enters the tree — it has already happened once on the `dead-assertions` branch, from quoting Vitest's rendering of a NUL separator.

- [ ] **Step 3: Commit**

---

## Self-review notes

**Spec coverage.** §4.1 rule → Tasks 1–6. §4.2 scope → Global Constraints and Task 7 Step 2. §4.3 what it checks → Task 7 Step 2. §4.4 shape and self-test → Task 7 Steps 2–6. §4.5 escape hatch → Task 7 Step 2. §4.6 nothing deleted → the conversion procedure, steps 5–6. §5.4 reviewer checks the symbol is the right one → the per-task report table. §5.5 stale reported not fixed → Global Constraints.

**Ordering risk.** Task 7 depends on all of 1–6; its Step 1 is the guard that catches a miss rather than absorbing it.

**The likeliest failure mode is a conversion that names a symbol which exists but is not the one the citing text is about.** That passes the gate, passes the tests, and is a worse defect than the stale line it replaced, because it looks resolved. The per-task report exists so a reviewer can check the claim rather than the syntax; step 1 of the procedure — write down what the citing text claims *before* looking at the target — is what makes that checkable.
