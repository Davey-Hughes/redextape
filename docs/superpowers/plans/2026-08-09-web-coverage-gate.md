# Web Coverage Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `web/` a merged node+browser coverage measurement gated in CI, and retighten the Rust line floor from 80 to 90.

**Architecture:** One root-level `test.coverage` block in `web/vite.config.ts` makes a single `vitest run --coverage` merge both Vitest projects into one report; an explicit `coverage.include` keeps untested modules in the denominator, which Vitest 4's default would not. Thresholds live in that same block and are enforced by swapping the existing `web` CI step from `pnpm test` to `pnpm run test:coverage` — no new job, because `gate` already requires `web`.

**Tech Stack:** Vitest 4.1.10, `@vitest/coverage-v8` 4.1.10, Playwright Chromium, pnpm 11.20.0, `cargo llvm-cov` + `cargo-nextest`, Forgejo Actions.

**Spec:** [`../specs/2026-08-09-web-coverage-gate-design.md`](../specs/2026-08-09-web-coverage-gate-design.md)

## Global Constraints

- **Branch:** all work lands on `web-coverage-gate`, which already exists and already carries the design commit `6ad03ab`. Do not work on `main`.
- **Never merge the PR.** Davey merges his own PRs and holds branches open to fix review findings.
- **Dependency pins are exact**, with no `^` or `~`. Every entry in `web/package.json` follows this; `@vitest/coverage-v8` must be `"4.1.10"` to match the `vitest` and `@vitest/browser` pins its `peerDependencies` demand.
- **Biome formatting** (`web/biome.json`): 2-space indent, single quotes, semicolons `asNeeded` (i.e. omitted), line width 120. Code in this plan already conforms; do not reformat it.
- **Pre-commit hooks are file-scoped.** Staging any `web/**/*.ts` fires `biome ci --error-on-warnings` and `pnpm run typecheck`. Staging `*.rs` fires `cargo fmt` and `cargo clippy -- -D warnings`. Staging only `.yml`/`.md` fires nothing. **Never use `--no-verify`.**
- **`pnpm run typecheck` requires `pkg/`** (the wasm build output, gitignored). It is present in this working tree. If it is ever missing, run `pnpm run build:wasm` from `web/` before committing TypeScript.
- **Rust floor is 90 — a chosen number, not a derived one.** Do not "improve" it to match the measurement. Spec §4.5 explains the trade.
- **All four web floors are `floor(measured) - 1`**, computed per metric from the Task 1 measurement. No number is invented.
- **Record every measured figure** in the commit message that uses it. This repository treats an unrecorded number as a claim without evidence.
- **All commands run from `/home/davey/projects/redextape`** unless a step says otherwise. `web/` commands are shown with an explicit `cd`.

---

## File Structure

| file | change | responsibility |
| --- | --- | --- |
| `web/package.json` | modify | adds the `@vitest/coverage-v8` pin and the `test:coverage` script |
| `web/vite.config.ts` | modify | the single root-level `coverage` block: provider, `include`, reporters, thresholds |
| `.gitignore` | modify | ignores the `coverage/` tree the html reporter writes |
| `.forgejo/workflows/ci.yml` | modify | `web` job runs coverage (line 643); `rust` job floor 80 → 90 (line 254) |
| `README.md` | modify | corrects the "80% line floor" claim at line 178 |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | modify | corrects the stale gate list at lines 27-28 |

No new files. No source module changes — this slice adds no tests to `web/src`, it measures what exists.

---

## Task 1: Coverage instrumentation and the baseline measurement

Delivers a working merged coverage report with **no threshold yet**, plus the four numbers Task 2 needs. Split from Task 2 because a reviewer can accept that coverage is measured honestly while rejecting the floors chosen from it.

**Files:**
- Modify: `web/package.json`
- Modify: `web/vite.config.ts` (inside the existing `test:` block, before `projects:`)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: a `pnpm run test:coverage` script in `web/package.json`; four recorded percentages (lines, functions, branches, statements) that Task 2 turns into thresholds; a recorded per-file figure for `src/session-worker.ts` that Task 2's first step resolves.

- [ ] **Step 1: Install the coverage provider**

```bash
cd /home/davey/projects/redextape/web && pnpm add -D --save-exact @vitest/coverage-v8@4.1.10
```

Expected: installs cleanly with no peer-dependency warning. A warning naming `vitest` or `@vitest/browser` means the version pin is wrong — stop and report rather than upgrading anything else.

- [ ] **Step 2: Verify the pin landed exactly**

```bash
grep -A1 '"@vitest/browser"' /home/davey/projects/redextape/web/package.json | head -4
grep '"@vitest/coverage-v8"' /home/davey/projects/redextape/web/package.json
```

Expected: `"@vitest/coverage-v8": "4.1.10"` — a bare version with no `^` or `~`. If pnpm wrote a caret, edit it to the exact string and re-run `pnpm install`.

- [ ] **Step 3: Add the `test:coverage` script**

In `web/package.json`, add one line to `"scripts"` immediately after `"test:browser"`:

```json
    "test:coverage": "vitest run --coverage"
```

Leave `"test": "vitest run"` untouched — the local fast loop must not pay for instrumentation.

- [ ] **Step 4: Add the coverage block to `web/vite.config.ts`**

Insert this inside the existing `test: {` block, immediately **before** the `projects: [` line, keeping the existing `// No \`passWithNoTests\`...` comment where it is:

```ts
    // Coverage spans BOTH projects because this block sits at the `test` root rather than inside
    // either one — a single `vitest run --coverage` merges the node and browser tiers into one
    // report. That merge is the point, not a convenience. Five modules (`main`, `tm-pane`,
    // `lambda-pane`, `pane-chrome`, `session-worker`) are DOM and worker wiring the `node` project
    // cannot execute at all, so a node-only number would have to exclude exactly the layer where a
    // regression hides best.
    //
    // v8 works here only because `instances` below is chromium-only; on any other browser Vitest
    // throws at config-resolution time rather than silently under-reporting.
    coverage: {
      provider: 'v8',
      // LOAD-BEARING, AND NOT A DEFAULT WORTH INHERITING. Vitest 4 changed `coverage.include`:
      // left unset it counts only files LOADED during the run, so a module nobody imports is absent
      // from the report rather than scored zero — and the aggregate then reads high because the
      // untested file was never counted at all. That is the one failure direction a coverage gate
      // never announces. Measured on this tree: without this line the report lists fewer files.
      include: ['src/**/*.ts'],
      // No `exclude`. Nothing is dropped for being hard to reach; anything added here later needs a
      // comment saying what was measured to justify it.
      reporter: ['text', 'html'],
    },
```

- [ ] **Step 5: Ignore the coverage output**

In `.gitignore`, extend the existing web block. Find:

```
# Web frontend
node_modules/
dist/
.vite/
*.tsbuildinfo
```

Add one line after `.vite/`:

```
coverage/
```

- [ ] **Step 6: Run coverage and record the baseline**

```bash
cd /home/davey/projects/redextape/web && pnpm run test:coverage 2>&1 | tail -45
```

Expected: both projects run (`node` and `browser`), all tests pass, and a coverage table prints with an `All files` row. **Record all four percentages from that row verbatim** — they are Task 2's only input.

Also record the `src/session-worker.ts` row. It is the §7.1 open question: if it reads at or near 0% while `tests/browser/worker.test.ts` demonstrably exercises the worker, that is an instrumentation limit, not a testing gap. Task 2 Step 1 resolves it.

- [ ] **Step 7: Verify every source module is in the denominator**

```bash
ls /home/davey/projects/redextape/web/coverage/*.ts.html | wc -l
ls /home/davey/projects/redextape/web/src/*.ts | wc -l
```

Expected: both print **25**. A lower first number means `include` is not matching and the gate would be hollow — stop and fix before continuing.

**Count the `html` reporter's per-file pages, NOT rows in the `text` table.** The first draft of this step grepped the console table and expected 25; it returns **13**, and the 12 missing files are all at 100% on all four metrics. The `text` reporter omits fully-covered files from the printed table even though `skipFull` defaults to `false`. Those files are still in the denominator — they appear in the `All files` totals and each has its own `coverage/<name>.ts.html` page. So the table is a presentation artifact and counting it measures the wrong thing.

- [ ] **Step 8: Sabotage-verify the `include` line**

Temporarily comment out `include: ['src/**/*.ts'],` in `web/vite.config.ts`, then:

```bash
cd /home/davey/projects/redextape/web && pnpm run test:coverage >/dev/null 2>&1; ls coverage/*.ts.html | wc -l
```

Count html pages here too, for the same reason Step 7 does — the `text` table omits fully-covered files and is not a denominator.

Expected: **fewer pages than the baseline** — this is Vitest 4's load-only default excluding unimported modules, and it is the whole reason Step 4's `include` exists. Record the number, and record which file disappears: measured on this tree it is `session-worker.ts`, and the statement denominator drops 1072 → 918, exactly that module's 154 statements.

**Restore the line** and re-run Step 7 to confirm 25 again. Without this check the `include` is untested config.

- [ ] **Step 9: Commit**

```bash
cd /home/davey/projects/redextape && git add web/package.json web/pnpm-lock.yaml web/vite.config.ts .gitignore && git commit
```

Write the message body with the four measured percentages from Step 6, the `session-worker.ts` figure, and the Step 8 file count. Subject line: `web: merge node+browser coverage, and stop Vitest 4 hiding untested files`.

---

## Task 2: Thresholds, the session-worker resolution, and the CI gate

Turns the measurement into an enforced floor and wires it into CI. Thresholds and CI wiring are one task because either alone is not a gate.

**Files:**
- Modify: `web/vite.config.ts` (the `coverage` block from Task 1)
- Modify: `.forgejo/workflows/ci.yml:642-643`

**Interfaces:**
- Consumes: the four percentages and the `src/session-worker.ts` figure recorded in Task 1 Step 6.
- Produces: a failing-on-regression `pnpm run test:coverage`, run by the `web` CI job. Task 5 documents the resulting behaviour.

- [ ] **Step 1: Resolve the session-worker question from Task 1's data**

Take exactly one branch, based on the `src/session-worker.ts` figure recorded in Task 1 Step 6.

**Branch A — it reports a plausible non-zero percentage.** V8 coverage reached the worker. Do nothing; it stays in the denominator. Note the figure in this task's commit message.

**Branch B — it reports 0% or near-0% despite `tests/browser/worker.test.ts` exercising the worker.** This is an instrumentation limit. Add it to the coverage block with a comment that dates the measurement:

```ts
      // MEASURED 2026-08-09, NOT ASSUMED: v8 coverage collects through CDP against the page and did
      // not attach to this module's dedicated-worker context — it reported 0% while
      // `tests/browser/worker.test.ts` exercises the worker for real. This is an instrumentation
      // gap, not a testing gap, and conflating the two is what the exclusion is documented to
      // prevent. Re-measure and delete this entry when Vitest gains worker coverage.
      exclude: ['src/session-worker.ts'],
```

If Branch B is taken, **subtract that file from the denominator before computing floors** by re-running `pnpm run test:coverage` and using the new `All files` row instead of Task 1's.

- [ ] **Step 2: Compute the four floors**

For each of lines, functions, branches and statements, from the figures now in hand:

```
floor = floor(measured) - 1
```

Worked example — a measured `92.47` gives `floor(92.47) = 92`, minus 1 = **91**. This guarantees between one and two points of margin; bare `floor(measured)` would leave as little as 0.01 on a value like `92.02` and fail on noise alone.

Compute each metric independently. They will not be equal — branches usually sits well below lines, and each gets its own floor from its own figure rather than being averaged.

- [ ] **Step 3: Add the thresholds**

In the `coverage` block in `web/vite.config.ts`, add after `reporter:`, substituting the Step 2 numbers for `NN` and the Step 1/Task 1 figures for `MM.MM`:

```ts
      // MEASURED 2026-08-09: lines MM.MM, functions MM.MM, branches MM.MM, statements MM.MM.
      // Each floor is `floor(measured) - 1` — a margin of one to two points, sized for the genuine
      // run-to-run variation in a merged browser+node report (which arm of a timing-dependent branch
      // runs is not fixed). A PR that legitimately lowers one of these raises the floor in the same
      // diff, where a reviewer sees it, rather than the floor drifting years behind the tree.
      thresholds: { lines: NN, functions: NN, branches: NN, statements: NN },
```

- [ ] **Step 4: Verify the gate passes on the unmodified tree**

```bash
cd /home/davey/projects/redextape/web && pnpm run test:coverage
echo "exit: $?"
```

Expected: `exit: 0`, with no `ERROR: Coverage for ... does not meet threshold` line. A failure here means Step 2's arithmetic is wrong — the floors must sit below the measurement.

- [ ] **Step 5: Sabotage-verify the threshold**

Raise the `lines` threshold to `100` in `web/vite.config.ts`, then:

```bash
cd /home/davey/projects/redextape/web && pnpm run test:coverage; echo "exit: $?"
```

Expected: **non-zero exit**, with a message naming `lines` and both the actual and expected percentages. Record that line. A gate that cannot fail passes too, so this is what makes the threshold real rather than decorative.

**Restore the Step 3 value** and re-run Step 4 to confirm exit 0.

- [ ] **Step 6: Wire it into CI**

In `.forgejo/workflows/ci.yml`, replace lines 642-643:

```yaml
      - name: Unit tests
        run: pnpm test
```

with:

```yaml
      # `test:coverage`, not `test` — this is the web coverage gate. Thresholds live in
      # web/vite.config.ts beside the measurement that set them. NO SEPARATE JOB AND NO `gate` EDIT
      # IS NEEDED: `gate` already lists `web` in `needs` and already requires it under has_web, so a
      # threshold failure fails this job, which fails the required check. A separate coverage job
      # would re-install Rust, wasm-pack and Chromium for a signal this job already carries, and
      # would add a `require` line to `gate` that could be forgotten — which this file records
      # having happened once, when R_WEB was dropped.
      - name: Unit tests + coverage gate
        run: pnpm run test:coverage
```

- [ ] **Step 7: Confirm the gate wiring by reading, not guessing**

```bash
cd /home/davey/projects/redextape && grep -n 'R_WEB\|require web' .forgejo/workflows/ci.yml
```

Expected: `R_WEB: ${{ needs.web.result }}` and `require web "$R_WEB"` both present, the latter inside the `if [ "$HAS_WEB" = true ]` branch. This confirms no new wiring is needed. If either is absent, stop — the assumption this task rests on is false.

- [ ] **Step 8: Commit**

```bash
cd /home/davey/projects/redextape && git add web/vite.config.ts .forgejo/workflows/ci.yml && git commit
```

Subject: `web: a coverage gate that can actually fail, wired into the job that already gates`. Body must carry the four measured figures, the four floors, the Step 5 sabotage output, and which branch of Step 1 was taken and why.

---

## Task 3: Rust floor 80 → 90

Independent of Tasks 1-2; touches a different job and a different tool.

**Files:**
- Modify: `.forgejo/workflows/ci.yml:253-254`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the measured Rust lines percentage, which Task 5 quotes in `README.md`.

- [ ] **Step 1: Measure the current tree**

```bash
cd /home/davey/projects/redextape && cargo llvm-cov nextest --workspace 2>&1 | tail -5
```

Expected: an `All files`/`TOTAL` row. Takes roughly 165s warm per the note at `ci.yml:250`. **Record the lines percentage.**

- [ ] **Step 2: Check 90 against the measurement**

If the measured lines figure is **≥ 90**, continue to Step 3.

If it is **< 90**, stop and report. That is a real coverage regression on `main`, and it is a finding to raise — not a number to tune the floor around. Do not lower the floor to accommodate it.

- [ ] **Step 3: Raise the floor and replace the comment**

In `.forgejo/workflows/ci.yml`, replace line 254:

```yaml
        run: cargo llvm-cov nextest --workspace --fail-under-lines 80   # tune the gate as the code grows
```

with, substituting the Step 1 figure for `MM.MM`:

```yaml
        # 90 IS CHOSEN, NOT DERIVED, and saying so is the point of this comment. Measured 2026-08-09:
        # MM.MM% lines. A floor at `floor(measured) - 1` would be 94; 90 was picked over that
        # deliberately, to leave room for the workspace to take on hard-to-cover surface — a new
        # backend, platform-conditional code — without a floor bump in every such PR.
        #
        # The five points of headroom are the same KIND of slack that let the previous floor sit at
        # 80 while the tree measured ~95, at half the size. That is a trade, not an oversight.
        #
        # The comment this replaces said `# tune the gate as the code grows`: an instruction with no
        # owner and no trigger, which is exactly why fifteen points accumulated unremarked. What
        # replaces it is a number with a date and a measurement beside it, so the next person to move
        # it can see what it was chosen against.
        run: cargo llvm-cov nextest --workspace --fail-under-lines 90
```

- [ ] **Step 4: Sabotage-verify the flag still gates**

Temporarily change `90` to `100`, then:

```bash
cd /home/davey/projects/redextape && cargo llvm-cov nextest --workspace --fail-under-lines 100 2>&1 | tail -3; echo "exit: ${pipestatus[1]}"
```

Expected: non-zero exit with an error naming the line coverage and the 100 threshold. Record it. This proves the flag gates; it does not prove 90 is right, which is a judgement rather than something a test settles.

**Restore `90`** in the file.

- [ ] **Step 5: Commit**

```bash
cd /home/davey/projects/redextape && git add .forgejo/workflows/ci.yml && git commit
```

Subject: `ci: the Rust line floor was 80 against a ~MM% tree, so it could not fail`. Body carries the Step 1 measurement, the Step 4 sabotage output, and the reason 90 was chosen over 94.

---

## Task 4: Correct two documents that describe a gate the tree does not have

Both claims are stale independently of this branch; §4.4 and §4.5 make them wrong in new ways too.

**Files:**
- Modify: `README.md:178`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md:27-28`

**Interfaces:**
- Consumes: the Rust figure from Task 3 Step 1; the four web floors from Task 2 Step 2.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Correct the README's floor claim**

In `README.md`, line 178 currently reads:

```
  `scripts/check-all.sh --no-llvm`, then `cargo llvm-cov nextest` against an 80% line floor),
```

Replace `80%` with `90%`:

```
  `scripts/check-all.sh --no-llvm`, then `cargo llvm-cov nextest` against a 90% line floor),
```

- [ ] **Step 2: Add coverage to the README's web-job description**

Still in `README.md`, find the `web` job's entry in the same bullet list (a few lines below 178, beginning with the backticked job name `web`). Add coverage to the list of what it runs, so the sentence names biome, typecheck, the tests **with their coverage gate**, and the build. Keep the existing sentence structure and wording style — this is a four-or-five-word insertion, not a rewrite.

- [ ] **Step 3: Correct the roadmap's gate list**

In `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, lines 27-28 currently read:

```
  - `cargo llvm-cov --workspace --all-targets --fail-under-lines 80`
  - Web job: `npx biome ci`, `npm run typecheck`, `npm test`, `npm run build`.
```

Replace both lines with:

```
  - `cargo llvm-cov nextest --workspace --fail-under-lines 90` *(was `--all-targets ... 80` — the
    runner moved to nextest at the swap recorded below, and the floor rose 2026-08-09)*
  - Web job: `pnpm exec biome ci`, `pnpm run typecheck`, `pnpm run test:coverage`, `pnpm run build:app`.
```

The npm→pnpm correction is adjacent drift being fixed because the line is rewritten anyway — spec §4.6 records that as deliberate so a reviewer seeing it in the diff knows it was not scope creep.

- [ ] **Step 4: Check no other LIVING document makes the stale claim**

```bash
cd /home/davey/projects/redextape && grep -rn "fail-under-lines 80\|80% line floor\|all-targets --fail-under" \
  README.md docs/superpowers/plans/2026-07-19-redextape-roadmap.md .forgejo/
```

Expected: **no output** after Steps 1-3.

**Do not widen this grep to all of `docs/`.** Doing so returns roughly twenty hits across dated plan and spec documents — `2026-07-19-foundation-frontend.md`, `2026-07-21-lambda-backend.md`, `2026-07-22-tm-backend-*.md`, `2026-08-04-ci-scope-filters-design.md` and others. **Those are correct and must not be touched.** Each is a dated record of what the gate was when that work was done; editing them would falsify the historical record to make a grep quiet, which is the opposite of what this repository's annotate-don't-drift convention asks for.

The distinction is tense, not location. Three documents describe the gate **as it is now** and therefore go stale: `.forgejo/workflows/ci.yml` (Task 3), `README.md` (Step 1), and the roadmap (Step 3) — the roadmap being a continuously-maintained document rather than a dated one. Everything else is history.

The one exception inside `docs/` is this slice's own spec, which quotes the old line as a before-state in a diff block. That is also correct as written.

- [ ] **Step 5: Commit**

```bash
cd /home/davey/projects/redextape && git add README.md docs/superpowers/plans/2026-07-19-redextape-roadmap.md && git commit
```

Subject: `docs: two files described an 80% floor and a runner CI stopped using`.

---

## Task 5: Push, open the PR, and measure what CI actually cost

**Files:** none modified. This task produces a PR and a measurement.

**Interfaces:**
- Consumes: all four preceding tasks.
- Produces: a PR for Davey to review and merge himself.

- [ ] **Step 1: Confirm the branch is clean and complete**

```bash
cd /home/davey/projects/redextape && git status --short && git log --oneline main..HEAD
```

Expected: no output from `status`. From `log`: the design and plan commits that predate Task 1, then exactly one commit per Task 1-4. A task with no commit means its Step "Commit" was skipped.

- [ ] **Step 2: Record the pre-change web job duration**

From the most recent `main` CI run, record the `web` job's wall-clock time. This is the baseline §7.2 compares against.

```bash
cd /home/davey/projects/redextape && tea times 2>/dev/null || echo "use the Forgejo Actions UI for the web job duration on the latest main run"
```

- [ ] **Step 3: Push and open the PR**

```bash
cd /home/davey/projects/redextape && git push -u origin web-coverage-gate
```

Then open a PR against `main` titled `web coverage gate, and a Rust floor that can fail`. The body summarises: what already existed (Rust coverage since the tier was built), the Vitest 4 `include` trap and why it made the naive gate hollow, the four measured web figures with their floors, the Rust 80 → 90 change **flagged as a chosen number with ~5 points of headroom**, the session-worker branch taken, and the two stale docs corrected.

**Do not merge.** Davey merges his own PRs.

- [ ] **Step 4: Measure the CI cost delta**

Once the PR's `web` job completes, record its wall-clock time and subtract Step 2's baseline. Report the delta.

Per spec §7.2 this is a finding to bring back, not something to absorb silently: if browser-mode instrumentation costs materially more than expected, say so with the two numbers rather than letting it show up later as unexplained CI slowdown.

- [ ] **Step 5: Confirm the gate is live end to end**

Check that `gate` passed and that the `web` job's log contains the coverage table. Report both, plus the four `All files` percentages CI measured — if they differ from the local figures in Task 1, that difference is itself worth reporting (spec §7.3 sized the margin for exactly this, and the first CI run is the real test of whether it was sized right).

---

## Self-Review

**Spec coverage.** §0's two-tier gap → Tasks 1-2 (web) and 3 (Rust). §1 decision 1 → Tasks 2, 3. Decision 2 (merged, no exclusions) → Task 1 Step 4's root-level block and absent `exclude`, with Task 2 Step 1 as the single documented exception path. Decision 3 (explicit `include`) → Task 1 Steps 4, 7, 8. Decision 4 (four global metrics) → Task 2 Step 3. Decision 5 (web `floor-1`, Rust 90) → Task 2 Step 2, Task 3 Step 3. Decision 6 (measured not invented) → Task 1 Step 6, Task 3 Step 1. Decision 7 (no new job, no `gate` edit) → Task 2 Steps 6, 7. Decision 8 (worker is an open measurement) → Task 1 Step 6, Task 2 Step 1. Decision 9 (stale docs) → Task 4. §3's trap → Task 1 Steps 4, 8. §4.1-4.3 → Task 1 Steps 1-5. §4.4 → Task 2 Step 6. §4.5 → Task 3. §4.6 → Task 4. §5's procedure → Task 1 Step 6, Task 2 Step 2, Task 3 Steps 1-2. §6's non-goals are absent from every task, which is the correct treatment. §7.1 → Task 2 Step 1. §7.2 → Task 5 Steps 2, 4. §7.3 → Task 5 Step 5. §8's six verifications → Task 1 Steps 6-8 (1, 3), Task 2 Steps 4-5, 7 (2, 5), Task 3 Steps 1, 4 (4), Task 5 Steps 4-5 (6). Nothing in the spec is unassigned.

**Placeholders.** `NN` and `MM.MM` in Tasks 2-4 are substitution points for figures that do not exist until Task 1 Step 6 and Task 3 Step 1 run, and each is accompanied by the exact command that produces it and the exact arithmetic that consumes it. Task 4 Step 2 is the one prose-only edit — it is a few words into an existing English sentence whose current text is quoted at Task 4 Step 1, and prescribing exact replacement prose for a sentence the implementer can read would be worse, not better. No step says "add error handling", "write tests for the above", or "similar to Task N".

**Type consistency.** The script name `test:coverage` is defined in Task 1 Step 3 and used identically in Task 1 Steps 6-8, Task 2 Steps 4-6, and Task 4 Step 3. The config keys `provider`, `include`, `reporter`, `exclude`, `thresholds` match Vitest's documented `coverage` options. The CI step name `Unit tests + coverage gate` appears once. `--fail-under-lines` is spelled consistently across Task 3 and Task 4.

**One risk this plan cannot remove.** Task 2's floors depend on a measurement that does not exist yet, so Task 2 cannot be reviewed for numeric correctness until Task 1 has run. That ordering is inherent to a measured gate, not an artefact of the decomposition, and it is why the two are separate tasks rather than one.
