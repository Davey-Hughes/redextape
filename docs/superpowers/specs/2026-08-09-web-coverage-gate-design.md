# Web coverage measurement and a CI gate — design

Status: design, 2026-08-09.
Touches: `web/package.json`, `web/vite.config.ts`, `.gitignore`, `.forgejo/workflows/ci.yml`,
`README.md`, `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`.
Predecessor: [`2026-08-04-ci-scope-filters-design.md`](2026-08-04-ci-scope-filters-design.md) — the job
split this design wires into.

---

## 0. Why this slice, and what is actually missing

The request was "add test coverage checking and a CI gate". **Half of it already exists**, and finding
that out changed the shape of the work.

| tier | measured? | gated? | where |
| --- | --- | --- | --- |
| Rust workspace | yes — `cargo llvm-cov nextest --workspace` | yes — `--fail-under-lines 80` | `ci.yml:254` |
| `web/` TypeScript | **no** | **no** | `ci.yml:643` runs `pnpm test`, nothing else |

So the gap is the TypeScript tier, which has 25 source modules under `web/src` and no coverage
instrumentation of any kind — no `@vitest/coverage-v8` dependency, no `test.coverage` block in
`vite.config.ts`, no threshold, no CI step.

**The Rust gate has a second, quieter problem.** Its floor is 80 while the tree measures ≈95.5% — fifteen
points of dead slack. A floor that far under reality cannot fail; it is decoration that reads as a
guarantee. The trailing comment on that line, `# tune the gate as the code grows`, is the instruction
that was never carried out, and leaving it in place would schedule the same drift again.

**What this slice is not.** It is not a per-file threshold regime (§6). It is not a coverage-reporting
service, badge, or PR comment (§6). It does not touch the Rust doctest gap, which `ci.yml` already
documents as nightly-only and out of reach (§6).

---

## 1. Decisions taken

| # | decision | § |
| --- | --- | --- |
| 1 | Both tiers are in scope: web gets a gate, **and the Rust floor is retightened** | §4.5 |
| 2 | The web number **merges the `node` and `browser` projects** — no file is excluded for being browser-only | §4.2 |
| 3 | `coverage.include` is **set explicitly**, because Vitest 4's default makes untested files invisible | §3 |
| 4 | A **single global threshold on all four metrics** (lines, functions, branches, statements) | §4.2 |
| 5 | Web floors sit **one point under the measured baseline**; the **Rust floor is 90, chosen not derived** | §5 |
| 6 | Web thresholds are **derived from a measurement taken during implementation**, never invented here | §5 |
| 9 | Two **stale coverage claims in `README.md` and the roadmap** are corrected in the same PR | §4.6 |
| 7 | **No new CI job and no `gate` edit** — the existing `web` job carries it | §4.4 |
| 8 | Whether Web Worker code is instrumented is **an open measurement**, not an assumption | §7.1 |

---

## 2. What the two projects can and cannot reach

`web/vite.config.ts` defines two Vitest projects: `node` (jsdom-free, `tests/node/**`) and `browser`
(Playwright Chromium, `tests/browser/**`).

Matching `web/src/*.ts` against `web/tests/node/*.test.ts` by name, **seven of twenty-five modules have no
dedicated node test**: `format`, `lambda-pane`, `lint`, `main`, `pane-chrome`, `session-worker`, `tm-pane`.

That list is not a backlog. Five of them — `main`, `tm-pane`, `lambda-pane`, `pane-chrome`,
`session-worker` — are DOM and worker wiring that cannot execute under the `node` project at all. They are
exercised, but only by the browser tier.

**This is what forces decision 2.** A node-only coverage number would have to exclude those five to be
gateable, and an excluded file is one the gate can never speak about — precisely the wiring layer where a
regression is easiest to ship unnoticed. Merging the projects keeps them in the denominator and lets the
browser tests earn their credit.

Merging is available rather than aspirational: `@vitest/coverage-v8` supports browser mode when the
browser is Chromium-based, and `vite.config.ts` already pins `instances: [{ browser: 'chromium' }]`. On any
other browser Vitest throws at config-resolution time rather than silently under-reporting.

---

## 3. The Vitest 4 `include` trap

**Vitest 4 changed the default meaning of `coverage.include`. Unset, only files that were loaded during
the test run are counted.** `include` has no default value in `coverageConfigDefaults`; when the user
leaves it undefined it stays undefined, and the report covers what the tests happened to import.

A module nobody imports is therefore **absent from the report, not scored zero**. `lint.ts` has no node
test; under the default it would contribute nothing to the denominator and the aggregate would read high
because the untested file was never counted, not because it was tested.

A gate built on that default measures the wrong thing in the one direction that never fails loudly. So:

```ts
include: ['src/**/*.ts'],
```

This single line is the load-bearing part of the config, and the reason gets a comment in the file rather
than only living here.

---

## 4. The design

### 4.1 `web/package.json`

Add the provider, pinned exactly, matching the style of every other entry in `devDependencies`:

```json
"@vitest/coverage-v8": "4.1.10"
```

`4.1.10` is not a guess: that version's `peerDependencies` are `vitest@4.1.10` and `@vitest/browser@4.1.10`,
both of which are the versions already pinned in this file. A mismatched provider is a peer-dependency
failure at install time, which is the good failure.

Add one script:

```json
"test:coverage": "vitest run --coverage"
```

`pnpm test` stays as it is, so the local fast loop is unchanged and does not pay for instrumentation.

### 4.2 `web/vite.config.ts`

One `test.coverage` block at the **root** of the config, not inside either project. Root-level is what
makes a single `vitest run` produce one merged report spanning both projects; per-project blocks would
produce two reports and two thresholds to keep in step.

```ts
coverage: {
  provider: 'v8',
  include: ['src/**/*.ts'],        // see §3 — the default counts only loaded files
  reporter: ['text', 'html'],
  thresholds: { lines: N, functions: N, branches: N, statements: N },   // N per §5, one per metric
},
```

`reporter`: `text` writes the table into the CI log so a failure is legible without downloading an
artifact; `html` is for local investigation. No `lcov` — nothing consumes it (§6).

No `exclude` list. That is decision 2 restated as config: the absence of an exclude list is the property
being preserved, and anything added to it later needs to say what was measured to justify it.

### 4.3 `.gitignore`

Add `coverage/`. It is not currently ignored, and the `html` reporter writes `web/coverage/` — a tree
that would otherwise be swept in by `git add -A`. The existing `dist/` and `.vitest-attachments/` entries
are the precedent and the new entry sits with them.

### 4.4 CI wiring — `ci.yml:643`

```diff
       - name: Unit tests
-        run: pnpm test
+        run: pnpm run test:coverage
```

**No new job, and no edit to `gate`.** `gate` already lists `web` in `needs` and already requires it under
`has_web == true`, so a threshold failure fails the `web` job, which fails `gate`, which is the required
status. Adding a separate coverage job would mean a second Rust+wasm-pack+Chromium install for no signal
the `web` job cannot carry, and a new `require` line in `gate` that could be forgotten — the failure mode
that file already documents having hit once, when `R_WEB` was dropped from the gate's env.

The step name changes from `Unit tests` to something that says coverage is now part of it, so a red run
names what it was doing.

### 4.5 Rust floor — `ci.yml:254`

```diff
-        run: cargo llvm-cov nextest --workspace --fail-under-lines 80   # tune the gate as the code grows
+        run: cargo llvm-cov nextest --workspace --fail-under-lines 90
```

**90 is a chosen number, not a derived one, and this section says so rather than dressing it as a
measurement.** §5's `floor(measured) - 1` rule would give 94 on the ≈95.5% the surrounding comment
records. 90 was picked deliberately over that, and the trade is worth stating plainly: it leaves roughly
five points of headroom, which is the same *kind* of slack §0 criticises in the 80 floor, at half the
size. What it buys is room for the Rust workspace to take on hard-to-cover surface — new backends, new
platform-conditional code — without a floor bump in every such PR.

The current figure still gets **measured** during implementation (§5 step 3) rather than trusted from the
comment: 95.52% was recorded before the arena slice and Plan 5b landed, and it describes a tree that no
longer exists. The measurement is what confirms 90 is actually below the tree — a floor above it would
fail the build on the first run, which is the one failure mode this choice could produce.

The `# tune the gate as the code grows` comment is **replaced, not kept**. It is an instruction with no
owner and no trigger, and it is why the floor sat fifteen points stale. The replacement records what 90
is: a deliberate headroom allowance with a date and a measured figure beside it, so the next person to
consider moving it can see what it was chosen against instead of inferring a policy that was never
written down.

### 4.6 Two documents that currently describe a gate the tree does not have

Both were found by grep while writing this design, and both go stale the moment §4.4 and §4.5 land. They
are corrected in the same PR, because a doc that describes CI is only load-bearing if it is true.

**`README.md:178`** says the `rust` job runs `cargo llvm-cov nextest` *"against an 80% line floor"*. After
§4.5 that is 90. The same bullet list also needs the `web` job's entry to mention coverage.

**Roadmap `2026-07-19-redextape-roadmap.md:27`** is stale in two ways that predate this slice:

```
cargo llvm-cov --workspace --all-targets --fail-under-lines 80
```

The runner has been `nextest`, not `--all-targets`, since the swap the roadmap itself records at line
2659 — so this line names a command CI does not run, with a floor CI will no longer use. Line 28 has the
same problem one tier over: it lists the web job as `npx biome ci`, `npm run typecheck`, `npm test`,
`npm run build`, and this repository uses **pnpm**.

**The npm→pnpm correction is adjacent drift, fixed because the line is being rewritten anyway**, not
scope discovered and quietly widened. It is called out here so a reviewer seeing it in the diff knows it
was deliberate.

---

## 5. How the thresholds get set

**No web threshold appears in this document.** The four web floors are outputs of a measurement taken in
the implementation; the Rust floor is the fixed choice recorded in §4.5.

1. Install `@vitest/coverage-v8`, add the config from §4.2 with thresholds omitted, run
   `pnpm run test:coverage`. Record all four percentages.
2. Set each web floor to `floor(measured) - 1`.
3. Run `cargo llvm-cov nextest --workspace` on the current tree. Record the lines percentage. **This is a
   check on 90, not an input to it** — it confirms the chosen floor sits below the tree.
4. Set the Rust floor to **90** (§4.5). If step 3 comes back under 90, stop and report: that is a real
   coverage regression on `main` and it is a finding, not a number to tune around.

**`floor(measured) - 1` guarantees a margin between one and two points**, and that property is the reason
for the shape rather than the arithmetic being incidental: bare `floor(measured)` leaves as little as
0.01 of a point on a value like 95.02, which would fail on noise alone.

That margin absorbs the genuine nondeterminism in a merged browser+node report — which arm of a
timing-dependent branch runs is not fixed run to run — without opening the kind of gap that let 80 stand
while the tree measured 95.5. If step 1 shows the four web metrics are far apart (branches materially
below lines is the usual shape), each still gets its own floor from its own measurement; they are not
averaged into one number.

**The measured figures get written into the tree**, in the commit message and in a comment beside the
thresholds, so the next person to move these numbers can see what they were and when.

---

## 6. Non-goals

- **Per-file thresholds.** `thresholds.perFile` fails a thin new file on the day it is added and answers
  with a list of per-file overrides — a maintenance surface bigger than the rot it prevents. The aggregate
  is what the Rust tier already gates on; matching it keeps one mental model.
- **A ratchet (`thresholds.autoUpdate`).** It rewrites the config file during a test run, which means CI
  either commits to the tree or reports a dirty one. Rejected for the mechanism, not the goal — §4.5's
  replacement comment pursues the same end through review instead of automation.
- **Coverage reporting to an external service, badges, or PR comments.** Nothing consumes them here and
  each is a new integration to keep alive.
- **Rust doctest coverage.** `cargo llvm-cov --doctests` is nightly-only; `ci.yml` already records this and
  records that the one doctest in `ty::show` is executed by `check-all.sh` even though it is not
  instrumented. Unchanged by this slice.
- **Coverage on the `rust-slow`, `rust-llvm` or `rust-browser` tiers.** Those jobs exist to run configs the
  `rust` job does not; instrumenting them would multiply cost for a number that is already gated once.

---

## 7. Risks

### 7.1 `session-worker.ts` runs in a Web Worker

V8 coverage in browser mode collects through CDP against the page. Whether it attaches to a dedicated
worker context is **not established here and must not be assumed**. If step 1 of §5 reports
`session-worker.ts` at or near 0% while its behaviour is demonstrably exercised by `tests/browser`, that is
an instrumentation gap, not a testing gap, and the two must not be conflated.

The resolution is decided **after** the measurement, and only two outcomes are acceptable: the file stays
in the denominator and the floor absorbs it, or it is excluded with a comment recording that the exclusion
is an instrumentation limit that was measured on a named date. An exclusion with no such comment is the
thing §4.2 exists to prevent.

### 7.2 Wall-clock cost on the `web` job

The `web` job already installs Rust, `wasm-pack`, pnpm dependencies and Chromium before it runs a test.
Instrumenting the browser project adds to that. **The delta gets measured and reported** rather than
landing as unexplained CI slowdown; if it is large enough to matter, that is a finding to bring back, not
something to absorb silently.

### 7.3 The threshold could fail on first CI run even though it passed locally

Local and CI runs can disagree — different Chromium build, different core count feeding
`processingConcurrency`. The one-point margin in §5 is sized for this, but the first CI run after the
change is the real test of it, and a failure there means the margin was wrong, not that the design was.

---

## 8. How this gets verified

Passing is not evidence a gate works; a gate that cannot fail passes too. Each of these is run and its
output recorded:

1. **`pnpm run test:coverage` passes** on the unmodified tree, with all four metrics above their floors.
2. **Sabotage the web gate:** raise one threshold above the measured value, confirm the run fails and names
   the metric, revert. Without this the threshold is untested config.
3. **Sabotage the `include` fix:** delete a node test file, confirm coverage *drops* rather than staying
   flat. This is what proves §3 — under the Vitest 4 default the number would not move, because the now
   unimported module would leave the denominator with it.
4. **Sabotage the Rust floor:** raise `--fail-under-lines` above the value measured in §5 step 3, confirm
   failure, revert to 90. This proves the flag still gates; it does not prove 90 is the right number,
   which is a judgement (§4.5) rather than something a test can settle.
5. **`gate` still reflects the web job:** confirm by reading that a failing `web` job produces a failing
   `gate`, which follows from the existing `require web "$R_WEB"` under `has_web` — no new wiring, so no
   new path to test, but the claim is checked rather than assumed.
6. **Full `web` job green in CI** on the PR, with the coverage table visible in the log and the wall-clock
   delta from §7.2 recorded.
