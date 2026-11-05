# Hidden recording PR A: ↺ back to step 0, with a per-leg rewind — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ↺ always goes to step 0 of its own view: a seek while step 0 is kept, and otherwise a rewind of that view's
leg alone, which records the leg again from step 0 while every other view keeps its place. During a recompile it is a
seek, as today, since the new run starts from step 0 (P8). Its name is `back to step 0`. Everything else in the step
bar stays as it is today (spec §9, PR A).

**Architecture:** Each leg's cursor can go back to step 0 in Rust (`rewindLambda`, `rewindTm`, `rewindRxm` on
`Session` and on the copy that carries the leg). A leg has an epoch on the page (`LegState.epoch`) and in the worker,
both 0 at a build and raised by one per rewind. The page's ↺ raises it, clears the leg's ring and posts `{ kind:
'rewind', gen, leg, epoch }`; the worker's `rewind` arm stops that leg's recording, rewinds the cursor and records the
first fill again, and every frames reply carries the epoch it was recorded under, so each side drops the other's stale
messages for that leg alone.

**Tech stack:** Rust (`redextape-core`, `redextape-wasm`, wasm-bindgen), TypeScript, Vitest 4.1.12 node and browser
tiers (Playwright 1.64.1, Chromium and the opt-in Firefox project), Biome, cargo-nextest.

**Spec:** `docs/superpowers/specs/2026-11-03-hidden-recording-design.md`, approved by the user on 2026-11-04 ("Approved,
plan PR A"), with its line references corrected to `ec4f11a` in `6a7fda9`, and with the user's ruling on P4, the
controller's call P3 and ↺ during a recompile (P8) written into its §2, §6 and §9 by the plan's pre-flight fix round.
Section numbers below (§5.4, §7) are the spec's. PR B is not planned here.

## Global constraints

- Work only in `~/temp/redextape-hidden-recording` (branch `hidden-recording`). Never edit or build in
  `/home/davey/projects/redextape`.
- `export CARGO_TARGET_DIR=$HOME/.cache/redextape-hidden-recording-target` in every shell that builds or commits: the
  pre-commit hook's `cargo-clippy` and `web-typecheck` (`build:bindings`) are cargo builds.
- Heavy runs (the wasm, lsp-wasm and bindings builds, `cargo nextest`, `cargo llvm-cov`, `pnpm run typecheck` and
  `pnpm test`, which both run the bindings build, `test:coverage`, `build:app`, `scripts/check-all.sh`,
  `scripts/check-slow.sh`, `docker build`, a commit that touches `crates/` or `web/`) under `flock
  ~/temp/redextape-heavy.lock`; every browser run under `flock ~/temp/redextape-browser.lock`, the heavy lock outside
  the browser lock when a run needs both. Another lane shares both locks.
- Browser tabs are set with `VITEST_MAX_WORKERS=N`, never `--maxWorkers`. `-- <name>` does not scope files: name the
  files.
- Where a test claims a user path, real gestures (`userEvent`), never synthetic `.click()` or `dispatchEvent`. Setup
  that is not the claim (the views toggles in `showWideDefault`, a `.focus()` before a key press) may stay as the
  harness writes it.
- No numeric `until` timeouts in browser tests, and no wait of a file's own: every wait is `until` at its default,
  and a long recording is waited on in stages, as `step-focus-recording.test.ts`'s `stoppedPast` does.
- Sabotages run in the scratch worktree `$S` (below), never in `$W`, with `node_modules`, `pkg`, `pkg-lsp` and
  `web/bindings` COPIED from `$W`, never symlinked. Before each, save a copy of the file to `$R/sab/`; after, restore
  it from that copy, then `cmp` it with the saved copy and with `git -C $S show HEAD:<path>`. Never `git checkout` to
  restore.
- Rust: `cargo fmt --all` before committing; clippy `-D warnings` holds on every commit (the hook runs `cargo clippy
  --workspace --all-targets -- -D warnings` on a Rust change). A sabotage list runs under `cargo nextest run
  --no-fail-fast`; in zsh a package list in a variable is `${=pkgs}`.
- The pre-commit hook on every commit (the eight scans, the licence check, the comment guard, fmt and clippy on a Rust
  change, Biome and typecheck on a web one); never `--no-verify`. Format web files with `pnpm exec biome format
  --write <files>` before committing.
- A comment says why: no history, no measurements, no `file:line` in tracked source, no block over 8 counted lines of
  text, and no attribution to the user ("the user's decision") in a code comment. Rust docs use `///`, TypeScript
  docs `/** */`. If the guard reports `web/tests` over its share, raise `scripts/comment-budget.json` to the value it
  reports, in the same commit.
- The Bash tool is zsh: `noclobber` is on (write logs with `>|`), there is no word splitting, and a variable named
  `path` is `PATH`. A recursive delete of a variable's path is written `"${VAR:?}"`.
- Nothing is pushed. Each task ends in its own new commit; a fix found later is a new commit, never an amend.

The same rules are in `$R/global-constraints.md`.

## Names used below

- `W=~/temp/redextape-hidden-recording`, the worktree, at `6a7fda9` when this plan was written (main `ec4f11a` plus
  the spec's three commits). `R=~/temp/redextape-history-restart-record`, the lane record. `L=$R/logs/pr-a`, where
  every run of this plan writes its log (`>| $L/t<N>-<name>.log 2>&1; echo EXIT=$?`), and the summary lines are read
  from the log with `grep`, never by piping the run itself.
- `S=~/temp/redextape-hidden-recording-sab`, the scratch worktree Task 1 makes, with
  `CARGO_TARGET_DIR=$HOME/.cache/redextape-hidden-recording-sab-target` (that directory holds the plan's probe build,
  so its dependencies are warm). A later task moves it with `git -C $S checkout -q --detach <the task's commit>` after
  `git -C $S status --porcelain` prints nothing, and copies `pkg` from `$W` again only when `crates/` changed.
- **Browser run:** `VITEST_MAX_WORKERS=<n> flock ~/temp/redextape-browser.lock pnpm exec vitest run --project browser
  <files> >| $L/<log> 2>&1`, from `web/`; in Firefox, `REDEXTAPE_FIREFOX=1` and `--project firefox`. **Node run:**
  `pnpm exec vitest run --project node <files>`. `<files>` are paths (`tests/browser/app.test.ts`): vitest reads a
  bare name as a substring of the path, so `app` alone runs six files and `rxm-copy` two. A browser run of one file
  uses one tab whatever `VITEST_MAX_WORKERS` says, since vitest shares files, not the cases in one, among its tabs.
- `LONG_SRC` is `step-focus-recording.test.ts`'s program of that name, a 16-element `map(add1)`. `EXAMPLE` is the
  spec's example, `let mut n = 100000; while n > 0 { n = n - 1; } n`.

## What the plan rests on (probed 2026-11-04)

The probes ran in a detached worktree of `6a7fda9`, since removed. Their files, commands and logs are listed in
`$R/probes/plan-a/README.txt`; the logs are in `$R/logs/plan-a/`.

- **The Rust shapes** (`$R/probes/plan-a/rust-draft.patch`, a draft, not a spec). With the six methods, seven tests
  and the six bindings, `cargo nextest run -p redextape-wasm -p redextape-core -E 'test(probe_)'` ran 7, all passed,
  with 1,470 other tests in the two packages skipped by the filter (`rust-probe-1.log`). The fixtures and frame counts
  of Task 1 are those the draft tests asserted.
- **The sabotages fire on their tests** (`rust-sab-summary.log`): R1 fails the two TM tests (15 frames against 11,
  8 against 4), R2 the two λ tests (1,320 frames against 601: through `at(0)` the rewound run went to FACT3's end),
  R3 the two λ tests at `saved_steps` (`[0, 256, 512]` against `[0]`), R4 the two rxm tests (9 against 4).
- **Clippy** (`rust-probe-clippy*.log`): without the lib.rs bindings every new method is `dead_code`, so the bindings
  land in Task 1's commit; a 4-element `Session::tm` tuple trips `type_complexity`, and a type alias for it passes
  `cargo clippy --workspace --all-targets -- -D warnings`.
- **The record loop's epoch** (`node-probe-record-loop.log`, `node-sab-summary.log`): the draft case passed with the
  file's seven others; N1 (no per-chunk epoch check) and N2 (the `finally` clears the flag whatever the epoch) each
  fail it alone (3 posts against 2; the flag `false` against `true`).
- **The app fixture, at the base** (`browser-probe-chromium.log`, `browser-probe-firefox.log`, one tab, 1280×896,
  four views): `LONG_SRC`'s TM leg fills to `step 0 of 100,317 — history is full` in 1,542 ms (Chromium) and 2,788
  ms (Firefox). One *keep recording* takes it to `step 100,318 of 181,667 — history is full (oldest kept: step
  100,318)` in 821 / 1,722 ms. Today's ↺ then leaves the TM view on step 100,318. The rxm view, stepped by three real
  clicks to `step 3 of 594`, and the λ view, `step 0 of 1,334 — history is full`, keep their lines. Both engines
  passed.
- **The λ leg runs out** (`browser-probe-chromium-2.log`): two *keep recording*s on the λ view end it at `step 998 of
  2,316 (oldest kept: step 998)`, and the readout's λ segment goes from `λ not finished · 1,334 reductions ·
  recording stopped before the run did — the term is not finished reducing` to `λ [4, 2, 3, 5, 4, 2, 3, 5, 4, 2, 3,
  5, 4, 2, 3, 5] · 2,316 reductions`.
- **Not probed:** the rxm case's program (`EXAMPLE`; its rxm first fill is 56,588 frames in node, spec §8), the λ copy
  forked at a step (Task 1), and everything that needs PR A's page and worker.
- **What `$W` holds:** `web/node_modules` and a `pkg` built from `1b2f0cb`, whose `crates/` equal `ec4f11a`'s; no
  `pkg-lsp`, no `web/bindings`.
- **Step-focus at `ec4f11a` does not change PR A's design.** Since the spec's reading of its branch at `940295c` only a
  comment in `step-controls.ts` moved (`git diff 940295c ec4f11a -- web/src`). Its waiting rule is what plan call P4
  below extends to ↺.

## Plan calls

Choices the spec leaves to the plan, each with what it rules out.

- **P1. A TM leg keeps what its cursor was opened from**, a `TmStart` of the `Rc<Machine>`, the first configuration
  and the caps, beside the cursor (spec §5.4 names the `Rc` and the caps). The first configuration is kept too, so a
  session's leg and a header-less copy rewind by the same call. In `Session` the TM tuple gains it as a fourth element
  under a type alias, `TmLegParts`, for clippy's `type_complexity`. Ruled out: a core method that rebuilds a cursor
  from its own handle, which would add an API to `TmCursor` for one caller.
- **P2. `LambdaCheckpoints::rewind` answers `Option<LambdaCursor>`**, `None` only for checkpoints with no first, which
  `new` never builds, so no library path can panic (the workspace's rule).
- **P3. A `result` never replaces a leg's decided value with `Unfinished`.** The spec has the readout keep the λ value
  across a λ rewind because a rewind posts no `result` (§5.2, §11 call 6). In PR A, `onExtend` still posts one after
  every continue of any leg, which would read the rewound cursor and take a known value away: λ on `LONG_SRC` would go
  back to `λ not finished · 1,334 reductions · …` at the next *keep recording* of the TM view. A pure `keepDecided` in
  `protocol.ts` keeps, per leg, the part last posted when its value was decided and the new one's is `Unfinished`;
  without a rewind it changes nothing, since a cursor only moves on. Ruled out: a page-side merge, which would need
  the stored result beside the reply arm. **This is the controller's call (2026-11-04), carrying out spec §11 call
  6**, which the user approved with the spec; spec §9 records it. It keeps a *decided* value only. An unfinished λ's
  `N reductions` (`results.ts`'s `lambdaRows` reads the cursor's step) drops back after a λ ↺, at the next `result`,
  to the rewound recording's count, and that is intended: the readout reports how far the leg's recording has run,
  and ↺ records it again. Worker.test case 6 (Task 2 Step 6) shows it, and N12 (Task 3) attacks it.
  **Two more rules of P3's kind came from Task 2's review (2026-11-04, I1 and M5), the controller's call:**
  - **A `result` posted while a rewind records a leg keeps that leg's last part** (`keepInFlight`, beside
    `keepDecided`). A rewind cuts short the loop in flight, whose caller then posts a `result`, and another leg's
    continue can post one mid-fill too. Read off the rewound cursor, the λ count would be a mid-fill one (step 256
    against the fill's 1,334 at `8b9ad6d`, `$R/logs/pr-a/t2fix-red-worker.log`) that no later reply corrects, since
    the rewind posts none. Worker.test cases 7 and 8 reach the two paths a posted `result` covers; N13 attacks the
    rule. **Before the generation's first `result` there is no posted part to keep** (the fix rounds' re-read,
    2026-11-04, I1): *keep recording* at the λ fill's `budget` stop while rxm and TM still record, then ↺ once that
    recording has dropped step 0, and the extend the rewind cuts short posts the generation's first `result`. So
    `rewindAndRecord` reads the rewound leg's part before the cursor goes back (`rewoundFrom`), and `keepInFlight`
    keeps that one while no `result` has been posted. Worker.test case 9 reaches it (step 256 against the cut extend's
    1,846 at `62dee14`, `$R/logs/pr-a/fr3-red-I1-worker.log`); N17 attacks it. Ruled out: ↺ staying a seek until the
    generation's first `result`, which would change what the screen does in that window.
  - **An rxm copy's value takes `keepDecided`'s rule on the page** (`keepDecidedPart` in `replies.ts`'s `rxm-value`
    arm). A copy's value comes in `rxm-value`, not in a `result`, and a `[continue]` after a rewind reads `Unfinished`
    off a cursor back under its build's cap. The page holds the copy's reading beside that arm, as it holds no
    `result`, so the page is the simpler place here for the merge ruled out above; and a worker test would need a copy
    recorded past its build's 5,000,000-step cap. `replies.test.ts` reaches it; N15 attacks it.
- **P4. While a rewind's first frames are on their way, the leg is recording and ↺ waits for them.** This is **the
  user's ruling (2026-11-04), "`step 0 of 0…`, ↺ waits"**, recorded in spec §2 and §9. The ring is empty from the ↺
  to the first reply of the new epoch, which today would read `not run` and turn every step button off, ↺ under its
  own press, so the focus would go to the speed select. The leg reads as `rewinding` (`epoch > 0` and an empty ring);
  `recording` holds, so the step line reads `step 0 of 0…`, the form an empty ring takes in `controlState` once it is
  not cut short to `not run`; and ↺'s row in `step-controls.ts`'s table waits, as ▶'s and ⏭'s do under step-focus's
  rule, greyed with its focus kept, until the first of them comes, when it is live again. Not chosen by the user:
  `step 0…`; keeping the old window shown until the first new frame, which would leave it steppable meanwhile. The
  other step buttons are off until the first reply, ⏸ of a playing leg among them (`canPlay` is `length > 1`). Task 2
  Step 5's helper, which drops every frames reply of another epoch, relies on the ring being emptied at the press.
- **P5. The player holds a playing leg whose ring is empty**, so that ⏵ plays on from step 0 across a rewind (§6, §11
  call 4). Only a rewind empties a playing leg's ring: a recompile's `resetLegs` clears `playing` with it.
- **P6. The worker's epoch check on `extend` guards a state the page cannot reach, and a worker test reaches it.**
  The page raises a leg's epoch only when it posts `rewind`, and the worker takes messages in order, so a stale
  `extend` cannot reach the worker from the page; the check is written as this file's other guards on a state no
  caller can reach are. Worker.test case 3 posts one anyway, which only a test can, and N11 attacks the check. The
  record loop's per-chunk check, which a rewind during a recording does reach, has its tests. **A `rewind` of no newer
  epoch than the leg's is turned away on the same reasoning** (Task 2's review, M6): it would clear the flag without
  stopping the loop in flight, whose epoch has not moved, and two loops would step one cursor. Case 3 posts one too,
  and N14 attacks the check.
- **P7. The browser tests calibrate themselves:** a rewound first fill's step line must equal the line the leg's first
  fill showed (`step 0 of 100,317 — history is full` for `LONG_SRC`'s TM in the probe), not a count written into the
  test.
- **P8. ↺ rewinds only while the leg's frames are the client's generation; otherwise it is a seek, as today, even with
  step 0 dropped** (spec §6). `LegState.gen` is the generation of the frames the ring holds, which `pushFrames` sets
  from each reply it takes; `restart` rewinds while the ring is `evicted` and `leg.gen === client.gen`. Two states fail
  that test, and in both the worker would answer a `rewind` with nothing the page keeps:
  - **A recompile awaited.** The worker may already have started the new generation and would take the `rewind` for
    it, while that generation's `compiled` reply, which reaches the page after the ↺, runs `resetLegs` and puts the
    leg's epoch back to 0: the page would then drop every frame the rewind recorded, and the leg would read `not run`,
    or stay on part of a λ fill ending in `…`, until the next compile. The new generation's first fill starts from
    step 0 anyway.
  - **A copy whose last edit did not parse** (Task 2's review, I2). Every copy build starts with `dropLive()`, so a
    failed parse answers `no-session` with the worker holding nothing, while the page keeps the last good frames on
    purpose (5d-iii design §4.4) and that reply clears `awaitingRun`. A `rewind` there gets no answer, and the leg would
    read `step 0 of 0…` with ↺ waiting until an edit parses.

  `client.awaitingRun` alone tells the first state and not the second, which is why the test is the generation: during a
  recompile the client's generation is ahead of the frames too. In the app, by real gestures, Task 5's case 7 presses ↺
  in the first state (a program's keystroke, the recompile in flight) and case 8's last step in the second (the copy has
  answered its edit with `no-session`); B15 and B14 attack them. Ruled out: turning ↺ off in either state on a leg whose
  step 0 was dropped, which would change what the user sees; keeping `awaitingRun` set across a copy's `no-session`,
  which would read `— recompiling` under an edit nothing is compiling. **The same copy state leaves `extend` unanswered
  at `ec4f11a`**: ▶ at the frontier and *keep recording* there post one, through `canRecordFurther(…, awaitingRun)`, and
  the worker drops it. PR A leaves that as it is, since turning them off there changes what the user sees, and Task 7's
  entry names it. **An edit typed before the ↺ and still in its editor's debounce is sent first** (Task 4's review, M7):
  `restart` flushes the copy's editor (`EditorCustody.flush`) before the test, so that the edit claims its generation
  and ↺ seeks, as during a recompile, with nothing new on screen. Task 4's `restart` case, the pending branch, and Task
  5's case 8 hold it; T11 attacks it. **Nor can the test see an edit typed after the ↺**: ↺ on a copy, then an edit that
  does not parse before the rewind's first frames come. That build drops the rewound fill with everything else, and the
  leg reads `step 0 of 0…` with ↺ waiting until an edit parses, as a copy's first fill that such an edit cuts short
  keeps its `…` at `ec4f11a`. Task 7's entry names it too.

P3 and P5 are the controller's calls and P4 the user's ruling, all 2026-11-04; P8 was settled with them and not asked,
since the screen does what it does today. P8's second state and P3's two further rules are the controller's calls on
Task 2's review (2026-11-04), not asked for the same reason; so are P3's first-`result` rule and P8's flushed edit, on
the fix rounds' re-read and Task 4's review (2026-11-04).

## File map

| File | Task | What changes |
|---|---|---|
| `crates/redextape-core/src/trace.rs` | 1 | `LambdaCheckpoints::rewind`; one core test |
| `crates/redextape-wasm/src/session.rs` | 1 | `TmStart`, `TmLegParts`; `RxmLeg`'s program and caps; `LambdaLeg::rewind`; the six methods; eight tests |
| `crates/redextape-wasm/src/lib.rs` | 1 | `rewindLambda`, `rewindTm`, `rewindRxm` on `Session` and on the three copies |
| `crates/redextape-wasm/tests/browser.rs` | 1 | One boundary test of the six bindings; fix round 3: the declined λ leg's throw loop names all seven λ methods |
| `web/src/protocol.ts` | 2 | `rewind` request; `epoch` on `extend` and on the three frames replies; `keepDecided`; the fix round's `keepInFlight` and `keepDecidedPart`; fix round 3's `HeldLegs` |
| `web/src/record-loop.ts` | 2 | The epoch book in `RecordWorker`; `reply` takes the epoch; the per-chunk and `finally` checks |
| `web/src/session-worker.ts` | 2 | The rewind methods on the four handle types; the epoch book; `onRewind` and its epoch guard; `extend`'s epoch; `keepDecided` and `keepInFlight`; fix round 3's `rewoundFrom` |
| `web/src/session-client.ts` | 2 | `rewind(leg, epoch)`; `extend(leg, epoch)` |
| `web/src/sessions.ts` | 2, 4 | Task 2: `LegState.epoch`, reset by `resetLegs`. Task 4: `LegState.gen`; `rewindLeg`; `legControlState`'s `rewinding` |
| `web/src/main.ts`, `web/src/scratch.ts` | 2 | `epoch: 0` on the legs they build; the link positions' `extend` passes the epoch; fix round 3: `main.ts` gives the transport `custody.flush` |
| `web/src/transport.ts` | 2, 4 | Task 2: `forward` and `extend` pass the epoch. Task 4: `restart` seeks or rewinds (P8); fix round 3: it sends the copy's pending edit first (`flushEdit`) |
| `web/src/replies.ts` | 2, 4 | Task 2: the six frames arms through one helper that drops a stale epoch's reply; `onScratchReply`'s doc; the `rxm-value` arm keeps a decided value. Task 4: the helper sets `gen` (P8) |
| `web/src/controls.ts` | 4 | `LegView.rewinding`; `recording` and the step line while rewinding |
| `web/src/step-controls.ts` | 4 | ↺ named `back to step 0`; its comment; its row waits; the table's, `waits`' and `update`'s docs |
| `web/src/player.ts` | 4 | A playing leg with an empty ring holds |
| `web/help.html` | 4 | ↺ "back to step 0" |
| `web/tests/node/*` | 2, 4 | record-loop, replies, session-client, protocol, sessions, controls, player; literal sweep |
| `web/tests/browser/worker.test.ts` | 2 | The `rewind` arm end to end, per leg and per copy; the two existing `extend` posts gain `epoch: 0`; the fix round's cases 7 and 8; fix round 3's case 9; the whole-branch fix round's case 10 |
| `web/tests/browser/harness.ts` | 4, 5 | `legView`'s default gains `rewinding: false`; `tmWalk`'s doc; the whole-branch fix round: `alphaOf`, moved from `step-controls.test.ts` |
| `web/tests/browser/step-controls.test.ts` and the name sweep | 4 | ↺'s wait; the new name in 12 places; six comments; the whole-branch fix round: `alphaOf` from the harness |
| `web/tests/browser/restart-rewind.test.ts` | 5 | New: ↺ in the app by real gestures; fix round 3: ↺ inside a copy's edit's debounce; fix round 4: ↺ live at the rewind's first frames, the other views off step 0, the compile's `result` waited on, the proxy's two self-tests; the whole-branch fix round: continues after a rewind (case 3), ↺'s faint look (case 5), ↺ in P8's two states (cases 7 and 8) |
| `scripts/comment-budget.json` | 4, 5 | Only if the comment guard reports `web/tests` over its share |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | 7 | PR A's entry, last in the file |

Task 3 is Task 2's sabotages, dispatched on their own so that each fits one dispatch; it changes no file.

---

### Task 1: The six rewind methods, their bindings and their Rust tests

**Files:**
- Modify: `crates/redextape-core/src/trace.rs` (`LambdaCheckpoints`, beside `at`; its `mod tests`)
- Modify: `crates/redextape-wasm/src/session.rs` (`build_tm_leg`, `tm_leg_at`, `Session::tm` and its nine readers,
  `RxmLeg`, `LambdaLeg`, `Session`'s three legs' method groups, `TmScratch`, `RxmScratch`, `LambdaScratch`, `mod
  tests`)
- Modify: `crates/redextape-wasm/src/lib.rs` (the `Session`, `LambdaScratch`, `TmScratch` and `RxmScratch` impls)
- Modify: `crates/redextape-wasm/tests/browser.rs`

**Interfaces:**
- Produces, Rust: `LambdaCheckpoints::rewind(&mut self) -> Option<LambdaCursor>`; `Session::rewind_lambda`,
  `rewind_tm`, `rewind_rxm(&mut self) -> Result<(), SessionError>` (`LambdaAbsent`, `TmAbsent`, `RxmAbsent` for an
  absent leg); `LambdaScratch::rewind_lambda`, `TmScratch::rewind_tm`, `RxmScratch::rewind_rxm(&mut self)`.
- Produces, JS: `rewindLambda()`, `rewindTm()`, `rewindRxm()` on `Session` (throwing for an absent leg, as
  `stepTm` does) and the same name on the copy that carries the leg (never throwing), returning nothing.

- [ ] **Step 1: The builds `$W` lacks.** Under the heavy lock, from `$W/web`: `pnpm run build:lsp-wasm` and `pnpm run
  build:bindings` (`$L/t1-builds.log`), both exit 0. `$S` is made in Step 8, at this task's commit.

- [ ] **Step 2: The failing tests.** In `session.rs`'s `mod tests`, beside the λ checkpoint tests, a helper that
  records every frame from where a leg stands to its end (`frames_to_end(&mut leg, frame, step)`: the first frame,
  then one per successful step) and seven tests. The first six step a build past a cap raise, rewind, record to the
  end, and assert the frame count, the frames equal to a fresh build's (`assert_eq!` on the `Vec`s: the frame types
  derive `PartialEq`) and the status equal to the fresh build's:
  - `a_rewound_tm_leg_records_what_a_fresh_one_does`: `[1, 2, 3]` under `compile_with_caps` with `TmCaps { steps: 10,
    cells: TM_DEFAULT_CAPS.cells }`; to the cap, `raise_tm_cap(5, 0)`, 3 more steps, `rewind_tm`; 11 frames at
    `tm_state(40)`.
  - `a_rewound_tm_copy_records_what_a_fresh_one_does`: the `spin` machine of the test that drives a capped copy with
    `tm_scratch_with_caps`, under `steps: 3`; to the cap, `raise_tm_cap(4, 0)`, one step, `rewind_tm`; 4 frames.
  - `a_rewound_rxm_leg_records_what_a_fresh_one_does`: `[1, 2, 3]` under `compile_with_caps` with `rxm::Caps { steps:
    3, ..DEFAULT_CAPS }`; to the cap, `raise_rxm_cap(5)`, one step, `rewind_rxm`; 4 frames at `RXM_WHOLE`.
  - `a_rewound_rxm_copy_records_what_a_fresh_one_does`: the same program's `rxm_text()` under
    `rxm_scratch_with_caps(…, steps: 3)`; the same moves; 4 frames.
  - `a_rewound_lambda_leg_records_what_a_fresh_one_does`: `FACT3` with `cap_lambda_at(600)`; to the cap,
    `raise_lambda_cap(100)`, 50 more steps; `marks.saved_steps()` is `[0, 256, 512]` before the rewind and `[0]` after;
    601 frames at `lambda_state(512)`; and `lambda_tree(300, usize::MAX)`'s answer equals the fresh build's.
  - `a_rewound_lambda_copy_records_what_a_fresh_one_does`: `lambda_scratch` of `FACT3`'s step-0 λ text with
    `cap_lambda_at(600)`; to the cap, `raise_lambda_cap(100)`, one step; `saved_steps` `[0]` after; 601 frames.
  - `a_rewound_lambda_copy_forked_at_a_step_starts_at_that_step`: `lambda_scratch_at(<FACT3's λ text>, 300,
    usize::MAX)`; 40 steps, `rewind_lambda`; its frames to the end equal a fresh `lambda_scratch_at`'s (§5.4: "A λ
    copy forked at a step goes back to the first step it holds"). Not probed.

  Then `a_rewind_on_an_absent_leg_is_an_error`: `rewind_lambda` is `Err(LambdaAbsent)` on the declined-λ program the
  absent-leg tests use, and `rewind_tm` is `Err(TmAbsent)` on `a_declined_tm_leg_reports_why_and_refuses_its_methods`'
  2,048-element list. The module's tests have no program whose rxm leg is absent, so `rewind_rxm`'s `Err` is held by
  its type alone. In `trace.rs`'s tests, `a_rewind_keeps_the_first_checkpoint_at_its_own_cap`: a cursor on `term_of`
  of a program with more than ten β-steps under cap 5, checkpoints every 2, observed to the cap, `raise_cap(10)`, four
  more steps; `rewind()` is `Some`, `saved_steps()` is `[0]`, the cursor is at step 0, and it stops after exactly 5
  steps at `HitCap`.

  The filter `F='test(rewound) | test(a_rewind_)'` names these nine and nothing else (`test(rewind)` alone would also
  match four core tests at `ec4f11a`, `last_end_rewinds_with_the_buffer` among them). Run `cargo nextest run -p
  redextape-core -p redextape-wasm --no-fail-fast -E "$F"` (heavy lock, `$L/t1-red.log`): it does not compile (the
  methods do not exist).

- [ ] **Step 3: The core method.** `LambdaCheckpoints::rewind` truncates `saved` to its first entry and answers a clone
  of it, under the cap it was saved with (P2). Its doc says why `at(0)` would not do (it lifts the cap).

- [ ] **Step 4: The session methods.** As `$R/probes/plan-a/rust-draft.patch` drafts them:
  - `TmStart { machine: Rc<Machine>, init: Vec<Vec<Symbol>>, caps: TmCaps }` with `fn cursor(&self) ->
    TmCursor<Rc<Machine>>` (P1); `tm_leg_at` builds it and opens the cursor from it, and it and `build_tm_leg` answer
    `(TmProgram, TmCursor<Rc<Machine>>, TmStart)`. `pub(crate) type TmLegParts = (TmProgram, TmCursor<Rc<Machine>>,
    tm::TmHeader, TmStart)` and `Session::tm: Result<TmLegParts, TmDecline>`; its readers (`tm_status`, `tm_program`,
    `tm_text`, `step_tm`, `tm_state`, `tape_slice`, `raise_tm_cap`, `tm_value`, `link_index`, and the two `compile`
    arms) take the fourth element. `TmScratch` gains `start: TmStart`. The `tm` field's doc says what the fourth part
    is for in one sentence; its pairing argument stands.
  - `RxmLeg` keeps the `Rc<Program>` and the caps `run` opened its cursor with, and `fn rewind(&mut self)` opens a
    fresh `RxmCursor` from them; `total_steps` and `end` stay compile's (§5.4).
  - `LambdaLeg::rewind` replaces the cursor with the checkpoints' rewind.
  - The six public methods, each beside its leg's `raise_*_cap`, with a one-line doc ("back to step 0 under compile's
    caps", "under the build's caps", or for a λ copy "back to the first step this copy holds").

- [ ] **Step 5: The bindings, in this commit.** In `lib.rs`, `#[wasm_bindgen(js_name = rewindLambda)]`, `rewindTm`,
  `rewindRxm` beside each impl's `raise*Cap`: on `Session` returning `Result<(), JsValue>` through `err`, with the `#
  Errors` section its neighbours have; on the copies returning `()`, without one, for the reason those impls' docs give
  for their `stepTm` and `raiseTmCap`. Without them every new method is dead code under clippy (probe).

- [ ] **Step 6: The boundary test.** In `tests/browser.rs`, shaped like `a_lambda_scratch_crosses_as_a_handle_and_
  steps`: `the_rewind_bindings_cross_on_a_session_and_on_each_copy`. A session of `let x = 40; x + 2` steps each leg
  once through `call`, then `rewindLambda`, `rewindTm` and `rewindRxm`, and each leg's state reads `step` 0; a λ, a TM
  and an rxm copy (built as the module's copy tests build them) each step once, rewind, and read `step` 0.

- [ ] **Step 7: Green.**
  1. `-E "$F"` (`$L/t1-green.log`): 9 run, 9 passed.
  2. `cargo nextest run -p redextape-core -p redextape-wasm --no-fail-fast` (`$L/t1-packages.log`): 0 failed.
  3. `cargo clippy --workspace --all-targets -- -D warnings` (`$L/t1-clippy.log`): exit 0.
  4. From `$W/web`, `pnpm run build:wasm` (`$L/t1-wasm.log`): exit 0, so that Tasks 2 to 5 run against the bindings;
     then `wasm-vocabulary.test.ts`, which reads the built `pkg`, in a node run: passed.
  5. Heavy lock outside the browser lock: `scripts/check-all.sh --browser-only` (`$L/t1-boundary.log`): exit 0, and
     the log names the new boundary test as passed.

- [ ] **Step 8: Commit, then `$S` and the sabotages.** `cargo fmt --all`, then commit (heavy lock):

```
The λ, TM and rxm legs rewind to step 0 in Rust, on a session and on the copy that carries each leg, under the caps they began with and, for λ, with the later checkpoints dropped, as rewindLambda, rewindTm and rewindRxm
```

  Then `git -C $W worktree add --detach $S HEAD` and, `cp -a` (never `ln`), `$W/web/node_modules`, `$W/pkg`,
  `$W/pkg-lsp` and `$W/web/bindings` into it. In `$S`, with its own `CARGO_TARGET_DIR`, each sabotage, then `-E "$F"`
  with `--no-fail-fast` (`$L/t1-sab-<id>.log`), then the restore and its two `cmp`s:

| Id | Sabotage | Must fail |
|---|---|---|
| R1 | `TmStart::cursor` opens with `steps` 4 over the kept caps: every TM cursor then opens under other caps, a fresh build's too (`tm_leg_at` opens the first cursor through it), so the frames still equal a fresh build's and this is not §7's rewind that keeps a raised cap | the TM leg and TM copy tests, on the frame count alone |
| R1a | `Session::rewind_tm` raises the cursor it opens by 5 steps (§7's rewind that keeps a raised cap, on the session) | the TM leg test, on the frame count (16 against 11) |
| R1b | `TmScratch::rewind_tm` raises the cursor it opens by 4 steps (the same, on a copy) | the TM copy test, on the frame count (8 against 4) |
| R2 | `LambdaCheckpoints::rewind` truncates and answers `self.at(0)` (the lifted cap) | the λ leg and λ copy tests, on the count; the core test |
| R3 | `LambdaCheckpoints::rewind` answers the first entry without truncating | the λ leg and λ copy tests and the core test, at `saved_steps` |
| R4 | `RxmLeg::rewind` opens with `steps` 5 over its caps | the rxm leg and rxm copy tests |
| R5 | `TmScratch`'s binding named `rewindTM` | the boundary test (`scripts/check-all.sh --browser-only` in `$S`, both locks) |

  Each fails exactly its row (R1 to R4 measured on the draft's session tests; the core test and R5 not; R1a and R1b
  in the review's fix round, `$R/tasks/task-1-fixes.md`). `git -C $S status --porcelain` prints nothing at the end.

---

### Task 2: The epoch on both sides, and the worker's `rewind`

**Files:**
- Modify: `web/src/protocol.ts` (`RunRequest`, the three frames replies, a new `keepDecided` beside `endOf`)
- Modify: `web/src/record-loop.ts`, `web/src/session-worker.ts`, `web/src/session-client.ts`
- Modify: `web/src/sessions.ts` (`LegState`, `resetLegs`), `web/src/main.ts` (the program session's three legs; the
  link positions' `extend`), `web/src/scratch.ts` (a copy's legs), `web/src/transport.ts` (`forward`, `extend`)
- Modify: `web/src/replies.ts` (the program session's three frames arms and the copies' three; `onScratchReply`'s doc)
- Test: `web/tests/node/record-loop.test.ts`, `replies.test.ts`, `session-client.test.ts`, `protocol.test.ts`,
  `sessions.test.ts`; `web/tests/browser/worker.test.ts` (new cases, and the epoch on its two existing `extend`
  posts); every `LegState` and frames-reply literal under `web/tests`

**Interfaces:**
- Consumes: Task 1's JS methods.
- Produces: `RunRequest` gains `{ kind: 'rewind'; gen: number; leg: Leg; epoch: number }`, and `extend` gains `epoch:
  number`. `lambda-frames`, `tm-frames` and `rxm-frames` gain `epoch: number`. `keepDecided(prev: ResultLegs | null,
  next: ResultLegs): ResultLegs`, where `ResultLegs` is the `result` reply's `lambda`, `rxm` and `tm`.
  `RecordWorker.epoch: Record<Leg, number>`; `RecordLeg.reply(gen, epoch, frames, done)`. `SessionClient.rewind(leg:
  Leg, epoch: number): void` and `extend(leg: Leg, epoch: number): void`. `LegState.epoch: number`.

- [ ] **Step 1: The failing node tests.**
  - `record-loop.test.ts`: the harness gains an epoch book and the fake leg's `reply` carries the epoch. New case,
    shaped like "leaves the flag alone on its way out once a newer generation owns what is live": a loop suspended at
    its yield; the test does what the `rewind` arm does (raises `worker.epoch.rxm`, clears the flag, puts a fresh cursor
    at step 0, starts a loop with `emitInitial`); the old loop, released, posts nothing and leaves the flag set; the
    posts' `[epoch, done]` read `[0, null], [1, null], [1, 'ended']`, and the first frame of epoch 1 is step 0. The
    draft is `$R/probes/plan-a/sab/record-loop.test.ts.draft`. Three things in it are there only because the probe's
    `protocol.ts` had no epoch, and go: the `PROBE` prefix of the case's name, `as RunReply` on the fake reply, and
    `(p as { epoch: number })`.
  - `replies.test.ts`: a `tm-frames` reply for the program session and an `rxm-frames` reply for a copy whose epoch is
    not their leg's push nothing, leave `done` and draw nothing; the same replies at the leg's epoch land as today.
  - `session-client.test.ts`: `rewind` posts `{ kind: 'rewind', gen, leg, epoch }` at the live generation and nothing
    before the first build, as `tree`'s case reads; `extend` carries the epoch it is given, a non-zero one (N10).
  - `protocol.test.ts`: `keepDecided` — with `prev` `null`, `next` whole; per leg, `prev`'s part when its value is
    decided (neither `null` nor `'Unfinished'`) and `next`'s is `'Unfinished'`; `next`'s part in the three other
    pairings, one of them an undecided `prev` with an `'Unfinished'` `next` (P3's drop-back; N12); the legs are judged
    apart (λ kept while TM moves on).
  - `sessions.test.ts`: `resetLegs` puts a leg's epoch back to 0.

  Node run of those five files (`$L/t2-red.log`): the new cases fail. In `record-loop.test.ts` every case that posts
  fails, the new one among them, on a `TypeError` in the harness: the loop still calls `reply` with three arguments,
  so the fake's `frames` is the chunk's `done`. The new case's red on its own assertions is N1's and N2's (Task 3),
  which the probe measured (`logs/plan-a/node-sab-summary.log`).

- [ ] **Step 2: The wire.** In `protocol.ts`, the `rewind` request with a doc that says what the epoch is for (each
  side drops the other's stale messages for that leg alone, which a new `gen` cannot do without resetting every leg);
  `epoch` on `extend` and on the three frames replies; `keepDecided` with a doc stating its rule and why it exists in
  this file (the coverage gate cannot see the worker) — P3.

- [ ] **Step 3: The record loop.** As the probe's draft (`$R/probes/plan-a/sab/record-loop.ts.draft`): the loop reads
  its leg's epoch once it has taken the flag, returns at a chunk whose epoch has moved as silently as at a stale
  generation, clears the flag only while both its generation and its epoch still own it, and tags each post. The module
  doc's first sentence and `recordLeg`'s doc name the rewind beside the newer request. Two docs the draft keeps are
  made true: `RecordWorker`'s says a build resets "all three" books, and there are four with `epoch`, which a build
  resets per leg and a rewind for its leg (Step 4); `recording`'s says the flag is "cleared only by" its loop, and the
  four build prologues already clear it, as `onRewind` will.

- [ ] **Step 4: The worker.**
  - The four structural handle types gain the method their leg has: `rewindLambda`, `rewindTm`, `rewindRxm` on
    `Session`; `rewindLambda` on `LambdaScratchHandle`; `rewindTm` on `TmScratchHandle`; `rewindRxm` on
    `RxmScratchHandle`; all `(): void`. `RxmScratchHandle`'s doc counts "the rxm leg's six methods": with `rewindRxm`
    there are seven.
  - An `epoch` book beside `recorded` and `allowance`, reset to 0 in the four build prologues, and passed in `worker`;
    the three leg tables' `reply` carry it.
  - `onExtend` returns at once on `req.epoch !== epoch[req.leg]`, beside its generation check, with P6's reason
    (worker.test case 3 posts what reaches it).
  - `onRewind(req)`: a stale generation, a live thing without the leg (the kind guards `onExtend`'s arms use) or a leg
    that is not available answers nothing (a `Session`'s method throws for an absent leg, and a throw drops the
    session); else it sets `epoch[leg]`, clears `recording[leg]` (the loop in flight returns at its next chunk and
    leaves the flag alone), calls the rewind method, resets `recorded[leg]` to 0 and `allowance[leg]` to
    `HISTORY_BYTES`, and awaits `recordLambda`/`recordRxm`/`recordTm(req.gen, true)`. It posts no `result` (§5.2). A
    `case 'rewind'` in the listener's switch.
  - `posted`, the result legs last posted for the live generation, `null` from each build's prologue; both `result`
    posts (`onRun`, `onExtend`) post `keepDecided(posted, fresh)` and keep it as `posted`.

- [ ] **Step 5: The page, as far as the epoch goes.** `SessionClient.rewind` and `extend`'s new parameter;
  `LegState.epoch` (a doc: a count raised by each rewind and 0 at a build, and frames carrying another are a rewound
  recording's); `resetLegs` sets it to 0; `main.ts` and `scratch.ts` build their legs with `epoch: 0`, and the link
  positions' `extend` in `main.ts` passes the source session's leg epoch; `transport.ts`'s `forward` and `extend` pass
  the leg's. In `replies.ts`, the six frames arms call one helper, generic over the frame and given the leg and its
  sizer, that drops a reply whose `epoch` is not the leg's and otherwise pushes, sets `done` and draws as today.
  `onScratchReply`'s doc gives as its reason for separate frames arms that "`hist.push` closes over a different
  `LegState`", which the helper, given the leg, makes false: it says instead that the three arms share the helper and
  each passes its own leg and sizer. `replies.test.ts`'s doc of "a recording chunk redraws once per frame" says the six
  arms "are written out separately": it says instead why every case still runs for all six (each passes its own leg
  and sizer to the helper, and a wrong one is wrong in that arm alone).

  Every `LegState` literal under `web/tests` gains `epoch: 0` (at `ec4f11a`, `grep -rn "playing: false" web/tests`
  lists 16 lines in 9 files, not all of them `LegState`s: let `tsc` name them). Every frames-reply literal gains
  `epoch`: nine of them, record-loop's fake reply (Step 1), four in `replies.test.ts` and four in
  `session-client.test.ts`. `git grep -nE "kind: '(lambda|tm|rxm)-frames'" -- web/tests` lists 11 lines; the other
  two, record-loop's `Extract<>` type and a `toMatchObject` in `worker.test.ts`, need none. The two `extend` posts in
  `worker.test.ts` ("replies to extend even when the run already ended" and "answers extend on an rxm copy with its
  frames and its value, …") gain `epoch: 0`. `tsc` does not name them, since `Worker.postMessage` takes `any`, and
  without it `onExtend` drops them and both cases wait out the test timeout.

- [ ] **Step 6: The worker end to end** (`worker.test.ts`, shaped like its `session-worker recording` cases). The new
  cases make their worker as `askUntil` does and collect every reply in a listener, but wait with `until` (from
  `./until`) at its default, never with the file's own timer (`askUntil`'s `timeoutMs`), as the lane rules have it;
  the cases already there keep theirs.
  `LONG_SRC`'s fills are waited on in stages of the TM leg's frame count, as `step-focus-recording.test.ts`'s
  `stoppedPast` stages its line, and each `LONG_SRC` case carries `90_000` as its test timeout, as that file's cases
  do. Every request a case posts names its epoch.
  1. **Per leg of a session:** `let x = 40; x + 2` run to its `result`; a `rewind` of each leg at epoch 1; each leg's
     epoch-1 frames equal its epoch-0 frames, and its `done` too.
  2. **Per copy:** a λ copy (`lambda-scratch` of that program's λ text at step 0), a TM copy (`tm-scratch` of the
     `tmText` its `compiled` reply carried) and an rxm copy (`rxm-scratch` of its `rxmText`), each built, recorded and
     rewound at epoch 1: the same equality.
  3. **No `result` of its own, and a stale `extend` answers nothing (P6):** case 1's run and its λ `rewind` at
     epoch 1; once that fill has stopped, an `extend` of the λ leg at epoch 0, which the page cannot post, then one at
     epoch 1. The replies after the rewind are its fill's `lambda-frames`, then the epoch-1 extend's `lambda-frames`
     and its `result`: the only `result` after the rewind is that extend's.
  4. **A rewind during a recording:** `LONG_SRC` run, and at its first `tm-frames` reply a TM `rewind` at epoch 1,
     posted from the listener; once an epoch-1 reply has come, no epoch-0 `tm-frames` follows, and the epoch-1 frames
     run from step 0 one step at a time to a `budget` stop.
  5. **The decided value stays (P3):** `LONG_SRC` run; λ `extend`s at epoch 0 until its frames end `ended` and a
     `result` carries its value; a λ `rewind` at epoch 1, whose frames to their `budget` stop equal the run's first λ
     fill (epoch 0, from step 0 to its first `budget` stop); a TM `extend` at epoch 0; that `result`'s λ value is the
     decided one, not `'Unfinished'`.
  6. **An unfinished count drops back (P3):** `LONG_SRC` run, whose `result`'s λ part is `'Unfinished'` at step `s0`;
     one λ `extend` at epoch 0, whose `result`'s λ part is still `'Unfinished'`, at a step past `s0` (a precondition
     the case asserts); a λ `rewind` at epoch 1 and, once its fill has stopped, a TM `extend` at epoch 0: that
     `result`'s λ part is `'Unfinished'` at `s0`, the rewound recording's step, which the readout then shows as its
     count of reductions.

- [ ] **Step 7: Green.** Under the heavy lock `pnpm run typecheck` (`$L/t2-tsc.log`) exit 0; node tier `pnpm run
  test:node` (`$L/t2-node.log`) 0 failed; browser run, 2 tabs, of `tests/browser/worker.test.ts`,
  `extend-during-recompile.test.ts`, `step-focus-recording.test.ts`, `share-positions.test.ts`,
  `readout-history-full.test.ts`, `rxm-copy.test.ts`, `scratch-app.test.ts` and `app.test.ts`, each under
  `tests/browser/` (`$L/t2-browser.log`, with `--reporter=verbose --reporter=json --outputFile=$L/t2-browser.json`):
  0 failed, and each new `worker.test.ts` case's time recorded from the JSON.

- [ ] **Step 8: Commit** (heavy lock):

```
A leg carries an epoch on the page and in the worker, raised by a rewind: frames replies carry the epoch they were recorded under and each side drops the other's stale ones, the worker's rewind request records the leg's first fill again from step 0, and a later result keeps a value the rewound cursor no longer holds
```

Task 2's dispatch ends here. Its sabotages are Task 3, a dispatch of their own that starts from this commit and hands
off through the record (`$R/tasks/`), so that neither passes one dispatch's size (about 150 calls).

**Task 2's review fix round** (`$R/tasks/task-2-fixes.md`, commit `c1e79f8`) added `keepInFlight` and
`keepDecidedPart` (P3), `rewindAndRecord`'s epoch guard (P6) and two `worker.test.ts` cases: 7 "keeps the λ part of
the result an extend posts when a λ rewind cut its recording short" and 8 "keeps the λ part of the result another
leg's extend posts while a λ rewind records". Case 3 also posts a `rewind` of the leg's own epoch, and case 5 also
asserts that the TM leg's recording goes on from the step after its last once the λ leg was rewound.

**The whole-branch review's fix round** (`$R/tasks/whole-branch-fixes.md`, I2) added case 10, "posts a new
generation's own rxm part in its first result, not the one the last posted or a rewind of it found": `LONG_SRC` at
generation 1, with an rxm `rewind` at its first `tm-frames`, before the generation's first `result`, whose rxm part is
decided; then `EXAMPLE` (unary, so no TM leg) at generation 2, with a λ `extend` at its first `rxm-frames`, whose λ
leg is refused at once, so that generation 2's first `result` comes while its rxm leg records, where `keepInFlight`
posts a held part. That `result`'s rxm part is generation 2's own: the `total_steps` of generation 2's `compiled` and
`EXAMPLE`'s value, `0`, which an rxm leg's compile decides. It holds `onRun`'s reset of `posted` and of `rewoundFrom`
(N18, N19): without either, generation 1's rxm part is posted.

---

### Task 3: Task 2's sabotages

**Files:** none. Each sabotage changes a file in `$S` and is restored there; `$W` is not touched, and the task ends
without a commit, its logs and its report being what it hands on.

- [ ] **Step 1: `$S` at Task 2's fix round.** `git -C $S status --porcelain` prints nothing; then `git -C $S checkout -q
  --detach <the head holding Task 2's fix round, `c1e79f8` or a later one>`. Neither Task 2 nor its fix round changed
  anything under `crates/`, so `pkg` and `web/bindings` stay as they were built for that head's `crates/`.

- [ ] **Step 2: The sabotages**, each with the files that must fail (`$L/t3-sab-<id>.log`), and after each the
  restore and its two `cmp`s:

| Id | Sabotage | Must fail |
|---|---|---|
| N1 | The record loop's per-chunk epoch check removed | record-loop's new case (3 posts against 2); worker.test case 4 |
| N2 | The `finally` clears the flag whatever the epoch | record-loop's new case (flag `false`) |
| N3 | `replies.ts`'s helper pushes whatever the epoch | replies' new case |
| N4 | `SessionClient.rewind` posts at generation 0 too | session-client's new `rewind` case |
| N5 | `keepDecided` answers `next` | protocol's case; worker.test case 5 |
| N6 | `resetLegs` leaves the epoch | sessions' case |
| N7 | `onRewind` leaves `recorded` as it was | worker.test cases 5 and 6 (the rewound λ fill stops `budget` at its first frame); cases 1 and 2 pass, since their runs end inside one window |
| N8 | `onRewind` skips the rewind method | worker.test cases 1, 2, 4, 5 and 6 (each rewound fill starts where its leg stood, not at step 0) |
| N9 | `onRewind` posts a `result` after its fill | worker.test case 3 |
| N10 | `SessionClient.extend` posts epoch 0 whatever it is given | session-client's `extend` case |
| N11 | `onExtend`'s epoch check removed | worker.test case 3 (the stale `extend`'s frames and `result`) |
| N12 | `keepDecided` keeps `prev`'s part whenever `next`'s is `'Unfinished'`, an undecided `prev`'s too | protocol's undecided pairing; worker.test case 6 |
| N13 | The I1 fix reverted: `keepInFlight` answers `next` whatever `recording` says (`postResult` is its one caller) | protocol's "keeps the posted part of each leg still recording"; worker.test cases 7 and 8 (the `result`'s λ part is read mid-fill, step 256 at `8b9ad6d`, not the run's 1,334) |
| N14 | `rewindAndRecord`'s epoch guard removed | worker.test case 3 (the `rewind` of epoch 1 records a fill: one more `['lambda-frames', 1]` before the tree) |
| N15 | The `rxm-value` arm takes the reply's value whatever it is, without `keepDecidedPart` | replies' "keeps a decided value when a later [continue] brings Unfinished" |
| N16 | `onRewind`'s λ arm rewinds a session's TM leg too | worker.test case 5 (the TM extend after the λ rewind records from step 1, not from the step after its last) |
| N17 | Fix round 3's I1 fix reverted: `rewindAndRecord` holds no part (`holdPart`'s call removed), so a `result` before the generation's first reads the leg whole | worker.test case 9 (that `result`'s λ part is read mid-fill, step 256 at `62dee14`, not the cut extend's 1,846) |
| N18 | `onRun`'s prologue leaves `posted` (`posted = null` removed) | worker.test case 10 (generation 2's first `result` posts generation 1's rxm part: `total_steps` 594, `LONG_SRC`'s, not 1,000,008, at `8af106d`, `$R/logs/pr-a/wbf-summary.log`) |
| N19 | `onRun`'s prologue leaves `rewoundFrom` (`rewoundFrom[leg] = null` removed) | worker.test case 10 (generation 2's first `result` posts the rxm part generation 1's rewind found, 594 again) |

  A sabotage that does not fire is a finding: re-run it once, and if it still passes, report it with the case and
  why its precondition did not hold; never weaken the case to make it fire. `git -C $S status --porcelain` prints
  nothing at the end. N17 needs `$S` at fix round 3's head (`0cefa6f` or a later one), and runs with Task 4's T11.
  N18 and N19 are the whole-branch review's (I2), and run at its fix round's head. The three copy prologues reset
  `posted` and `rewoundFrom` too, but no sabotage of theirs can fire: a copy's worker sets neither, since only a
  session's `result` sets `posted` and only a session's rewind sets `rewoundFrom`, and each session has its own worker.
  The other book this branch added to `onRun`'s prologue, `epoch[leg] = 0`, is held by Task 5's file: without it,
  cases 2 and 4 to 8 time out at "the TM leg to start recording", case 1's TM rewind having left the worker's TM epoch
  at 1 under the page's 0 (at `8af106d`, the same log); no worker.test case holds it.

---

### Task 4: ↺ back to step 0 on the page

**Files:**
- Modify: `web/src/sessions.ts` (`LegState.gen` and its doc; `rewindLeg` beside `resetLegs`; `legControlState`)
- Modify: `web/src/replies.ts` (`pushFrames` sets the leg's `gen`, P8)
- Modify: `web/src/controls.ts` (`LegView`, `ControlState.recording`'s doc, `controlState`)
- Modify: `web/src/step-controls.ts` (the ↺ comment and name; the `buttons` table's ↺ row and its doc; the `waits`
  field's doc; `update`'s comment on the buttons that wait)
- Modify: `web/src/transport.ts` (`restart`), `web/src/player.ts` (`Playable`, `tick`), `web/help.html`
- Modify: `web/tests/browser/harness.ts` (`legView`'s default gains `rewinding: false`, which `controls.test.ts` and
  `step-controls.test.ts` build their `LegView`s from; `tmWalk`'s doc)
- Test: `web/tests/node/sessions.test.ts`, `controls.test.ts`, `player.test.ts`, `replies.test.ts`;
  `web/tests/browser/step-controls.test.ts`; every `LegState` literal under `web/tests` gains `gen: 0` (let `tsc` name
  them, as Task 2 did for `epoch`)
- Sweep: `back to the oldest kept step` in `step-bar`, `parked-view-surfaces`, `step-controls`, `view-strip-narrow`,
  `step-bar-narrow` and `copies-undo` (`web/tests/browser/*.test.ts`); six comments (Step 3)
- `scripts/comment-budget.json`, only if the comment guard reports `web/tests` over its share

**Interfaces:**
- Consumes: `LegState.epoch`, `SessionClient.rewind` (Task 2); `SessionClient.gen`.
- Produces: `rewindLeg(leg: LegState<unknown>): void` (raises the epoch, clears the ring and `done`);
  `LegView.rewinding: boolean`, `true` from a rewind to its first frame (`epoch > 0` and an empty ring);
  `LegState.gen: number`, the generation of the frames the ring holds, which `pushFrames` sets from each reply it
  takes (0 on a leg no frames have reached; nothing else writes it).

- [ ] **Step 1: The failing tests.**
  - `sessions.test.ts`: `rewindLeg` raises the epoch by one and empties the ring and `done`; `legControlState` of a
    rewound leg with an empty ring has `recording` true and the step line `step 0 of 0…`, and an empty leg at epoch 0
    reads `not run`. (With a frame in the ring `rewinding` changes nothing in a `ControlState`, so that half is not
    asserted.)
  - `sessions.test.ts`, beside "a step gesture on a leg with a position pending", which drives
    `createTransport({...}).events(slot)` the same way: `restart`'s four branches (P8), on a leg whose session's
    client is a `SessionClient` over `fakePort()`, so that its posts are kept. **Evicted** (a ring small enough that its
    frames evicted step 0, the leg's `gen` the client's, which a reply answered): one `rewind` posted at the leg's
    raised epoch, the ring and `done` cleared. **Kept** (nothing evicted): the head at 0, nothing posted, the epoch
    unchanged (spec §6). **Awaiting** (evicted, and a `supersede` no reply has answered): the head at the oldest kept
    step, nothing posted, the epoch unchanged. **Unparsed** (evicted, and a `supersede` that a `no-session` reply
    answered, so `awaitingRun` is false while the leg's `gen` is the generation before): the same as awaiting.
  - `replies.test.ts`, beside Task 2's epoch case and for all six frames arms (`it.each(CASES)`): a frames reply of the
    leg's epoch sets the leg's `gen` to the reply's, and one of another epoch leaves it.
  - `controls.test.ts`: a rewinding leg's state has `recording` true, `canRestart` false and the step line `step 0 of
    0…`; an empty leg not rewinding still reads `not run`; a rewinding leg during a recompile reads `step 0 of 0 —
    recompiling` with `recording` false (↺ first, then the edit, which P8 leaves possible).
  - `player.test.ts`: a playing leg whose history is empty holds through frames, still playing, and steps on once a
    frame arrives. The fake `leg(n)` gains the `length` `Playable` now reads: the ring's frame count, which stays above
    0 for the existing cases, not the steps left, or the frontier case ("stops a leg at its recorded frontier") would
    read as an empty ring and hold; the new case's leg starts with `length` 0.
  - `step-controls.test.ts`, beside "↺, when the leg becomes unavailable and only the speed select is left": a focused
    ↺ that an update turns off with `recording` true waits (`aria-disabled="true"`, focus kept, not `disabled`); the
    update after, with ↺ live, puts it back; the unavailable case is unchanged. The update is the state
    `controlState` gives a rewinding leg: every `can*` false, `recording` true, `playing` false, no `continueLabel`,
    the line `step 0 of 0…`. The case finds ↺ by its text, `↺`, so that at red it fails on the wait, not on the name
    Step 2 changes.

  Node run of the four node files (`$L/t4-red.log`) and a browser run of `tests/browser/step-controls.test.ts`
  (`$L/t4-red-browser.log`): the new cases fail, but for `restart`'s kept, awaiting and unparsed branches, which hold
  today's seek and pass at red; T7 to T9 (Step 6) are their reds.

- [ ] **Step 2: The page.**
  - `rewindLeg`, and `legControlState` passing `rewinding`.
  - `controlState` (P4): `recording` also holds while rewinding, and the empty-ring `not run` short cut does not apply
    then, so the existing line reads `step 0 of 0…`. `ControlState.recording`'s doc and `LegView.rewinding`'s say so.
  - `step-controls.ts`: the name `back to step 0` (§4.1); the comment above it says why ↺ is two operations (a seek
    while step 0 is kept, a rewind of this leg alone once it was dropped), and nothing of what the name used to be; ↺'s
    row is `waits: true`, and the table's doc says ↺ waits while a rewind it started brings the leg's first frames,
    and else hands on as it does now. That doc is at the comment guard's cap of 8 counted lines and stays at 8: the
    rewritten ↺ sentence replaces its old one ("`↺` goes off only with the history empty …"). The `waits` field's doc
    ("whether a recording carrying the head can turn it off") and `update`'s comment on the buttons that wait ("A `▶`
    OR `⏭` A RECORDING CARRYING THE HEAD TURNS OFF …") name ↺, which its own press turns off while the leg records.
  - `LegState.gen` (P8), with a doc: the generation of the frames the ring holds, which tells `restart` whether the
    worker still holds their recording. `pushFrames` sets it from a reply it pushes; nothing else writes it.
  - `transport.ts`'s `restart` (P8): with the ring `evicted` and `leg.gen === client.gen`, `rewindLeg` and
    `client.rewind(leg, epoch)`; otherwise `seek(0)` as today; then `draw()`. A comment says why both are the test:
    step 0 is kept exactly while nothing was evicted, and the worker holds the leg's recording only while its frames
    are the client's generation; during a recompile the new generation's `compiled` reply would reset the epoch under
    a rewind the worker took for it, and after a copy's edit that did not parse the worker holds nothing, though
    `awaitingRun` is false.
  - `player.ts` (P5): `Playable`'s history adds `length`; `tick` holds a leg whose history is empty: it stays playing
    and takes no step. The module doc's frontier paragraph stays true and gains that sentence.
  - `help.html`: "**↺** back to step 0". The rest of that paragraph, *keep recording* and *continue* included, stays
    (§9: PR A reverses only the ↺ name).

- [ ] **Step 3: The sweep.** Every `back to the oldest kept step` under `web/` becomes `back to step 0` (12 lines in 6
  test files at `ec4f11a`). Six comments that describe ↺ as it was are made true, and none of them keeps the words
  "oldest kept" or "oldest retained", in either case:
  1. `harness.ts`'s `tmWalk` doc: the walk starts from ↺, step 0, and its clicks after ↺ rely on ↺ being a seek, with
     nothing evicted.
  2. `scratch-app.test.ts`'s `↺ FIRST` comment: ↺ goes to step 0, and the walk after it, three synchronous clicks,
     relies on nothing being evicted, since a rewind leaves ▶ off until the first frames come. (`scratch-fork.test.ts`'s
     and `active-pane.test.ts`'s `↺`-first walks rely on the same; their comments stay true, the first pointing at
     this one.)
  3. `copies-undo.test.ts`'s fresh-run proof: its ↺ click would now show step 0 for a run that is not fresh too, so
     its proof is the regex before it, which allows no tail after the count, the one an eviction adds among them; the
     comment says so without quoting that tail, which would add a line to the grep below.
  4. `app.test.ts`'s comment above the ↺ click in "a step that loops in its own state still releases a
     source-originated link's hold on the table": ↺ goes to step 0, and the 500 synchronous ▶ clicks after it rely on
     ↺ being a seek, with nothing evicted.
  5. `step-controls.test.ts`'s doc of "a step button a state change turns off hands the focus on": "`↺` and `⏵` never
     turn themselves off" is no longer so for ↺, whose press on a leg whose step 0 was dropped empties the ring, and
     where it waits (the case Step 1 adds). Its ◀ clause, which names the oldest kept step, stays as it is on its line.
  6. `step-controls.test.ts`'s `driven` doc, "handlers move a `History` as `transport.ts`'s do": its `restart` is the
     seek alone, which is `transport.ts`'s ↺ while step 0 is kept.

  Then `grep -rn "back to the oldest kept step" web` prints nothing, and `grep -rnE "oldest (kept|retained)" web/src
  web/tests web/help.html` prints the 20 lines it prints at `ec4f11a` less the sweep's: `controls.ts`'s step line,
  `history.ts`'s four docs, `share-positions.ts`'s dropped position, and in the tests the step line's and the dropped
  position's cases (`controls`, both `share-positions`, `view-strip-narrow`, `step-bar-narrow`, `rxm-app`,
  `readout-history-full`) and `step-controls.test.ts`'s ◀ eviction. With `-i` it prints 22: those 20, and the
  uppercase comments in `history.ts` and `history.test.ts`, which are about the ring.

- [ ] **Step 4: Green.** `pnpm run typecheck` exit 0 (heavy lock, `$L/t4-tsc.log`); `pnpm run test:node` 0 failed
  (`$L/t4-node.log`); a browser run, 2 tabs, of `step-controls`, `step-bar`, `step-bar-narrow`, `view-strip-narrow`,
  `parked-view-surfaces`, `copies-undo`, `scratch-app`, `scratch-fork`, `active-pane`, `app`, `step-focus-recording`,
  `extend-focus-probe` and `running-focus`, each as `tests/browser/<name>.test.ts` (`$L/t4-browser.log`): 0 failed.

- [ ] **Step 5: Commit** (heavy lock):

```
↺ is named back to step 0 and goes there: a seek while step 0 is kept or the worker no longer holds the generation its frames came from, during a recompile or after a copy's edit that did not parse, and otherwise a rewind of its own view's leg, waiting with its focus kept until the leg's first frames come, while a playing leg plays on from step 0
```

- [ ] **Step 6: Sabotages in `$S`**, moved to this commit as Task 3 Step 1 moves it (`$L/t4-sab-<id>.log`). If this
  task has come near one dispatch's size (about 150 calls) by its commit, this step goes to a dispatch of its own, as
  Task 3 does for Task 2.

| Id | Sabotage | Must fail |
|---|---|---|
| T1 | `rewindLeg` leaves `done` | sessions' `rewindLeg` case; its `legControlState` case (with `done: 'ended'` left, `recording` is false and the line is `step 0 of 0`); the `restart` case's evicted branch |
| T2 | `recording` ignores `rewinding` | controls' case (step-controls' cases build their `ControlState` by hand) |
| T3 | The `not run` short cut applies while rewinding | controls' case, on the line |
| T4 | The player's hold removed | player's case, on `playing`, `draws` and `pending`; not on `taken`, since the case's `forward` refuses on an empty ring as `History.forward` does |
| T5 | ↺'s row `waits: false` | step-controls' wait case (the focus goes to the speed select, since the case's state has every `can*` false) |
| T6 | `restart` always seeks | sessions' `restart` case, the evicted branch |
| T7 | `restart` rewinds whenever the ring is evicted, whatever the generation | sessions' `restart` case, the awaiting and unparsed branches |
| T8 | `restart` always rewinds | sessions' `restart` case, the kept branch |
| T9 | `restart`'s test is `!client.awaitingRun`, not the generation (P8's first form) | sessions' `restart` case, the unparsed branch |
| T10 | `pushFrames` leaves `gen` | replies' `gen` case |
| T11 | `restart` sends no pending edit first (fix round 3's `flushEdit` call removed) | sessions' `restart` case, the pending branch; Task 5's case 8 (↺ rewinds, at step 0 at once after the click, where it should seek to the oldest kept step) |

  A sabotage that does not fire is a finding, as in Task 3. T11 needs `$S` at fix round 3's head, as N17 does.

---

### Task 5: ↺ in the app, by real gestures, in Chromium and Firefox

**Files:**
- Create: `web/tests/browser/restart-rewind.test.ts`
- `scripts/comment-budget.json`, only if the comment guard reports `web/tests` over its share: the setup copies about
  70 lines of `step-focus-recording.test.ts` with their docs

**Interfaces:** Consumes Tasks 1, 2 and 4. The file's setup is `step-focus-recording.test.ts`'s: the `Worker` proxy
that can hold the session workers' replies (`hold`, `release`, an `afterEach` that lets them through), `SHELL`,
`main`'s `ready`, `at`, `watch`, `STAGE` and `stoppedPast`; plus `page.viewport(1280, 896)` and `showWideDefault()`, so
all four views show. The proxy's listener also counts the `result` replies it lets reach the page (`results()` below):
the readout's λ segment comes from a `result` alone, which is a message of its own after the frames whose `done` the
step line shows, and `until` polls on a timer that can run between the two. The proxy's two self-tests are copied
with it, since this copy differs from the original (it counts `result`s and keeps each held reply's kind): a listener
the app takes back hears nothing, while replies are held or after, and once the cases are done the page has its own
`Worker` back, its prototype untouched. Each case types its own program
(`LONG_SRC` with a different number of trailing spaces, or `EXAMPLE`) so that it compiles fresh, records each view's
first-fill line before it acts (P7), and carries `90_000` as its test timeout, as `step-focus-recording.test.ts`'s
cases do: the probe's TM first fill took 1,542 ms in Chromium and 2,788 ms in Firefox and one *keep recording* 821 and
1,722 ms (`$R/logs/plan-a/browser-probe-*.log`), each case adds a rewound fill to those, the browser tier's default
test timeout is 15,000 ms, and CI's runner is slower.

- [ ] **Step 1: The cases.** Each presses with `userEvent`; the long fills are waited on in stages.
  1. **TM, only its view moves (Q1, Q2).** `LONG_SRC`; `historyFills()` right after the dispatch; *keep recording* on
     the TM view until its line names `(oldest kept: step` with no `…` (`stoppedPast`); the rxm and λ views each
     stepped to step 3 by three clicks on its ▶, since a view at step 0 on its first-fill line would land on that line
     again were another view's rewind to move it; a click on the TM ↺. The TM line becomes the first-fill line again,
     `(oldest kept:` gone; the rxm and λ lines are what they were (`step 3 of 594` and `step 3 of 1,334 — history is
     full` in fix round 4's probe), read in one `toEqual` so that a defect moving both shows both. Then, with the
     replies held, ↺ on the rxm view: at once its line is its first-fill line again (`step 0 of 594` in the probe),
     with no `…`, since its step 0 is kept and ↺ is a seek that posts nothing (spec §6); let through.
  2. **λ, and the readout keeps its value (P3).** `LONG_SRC`; `historyFills()` right after the dispatch, then (in the
     shared setup, for every case) an `until` that `results()` has risen past its count before the dispatch: the
     worker posts the compile's `result` after the frames that fill the TM history, so a count started before it
     lands would rise on it rather than on the press's; λ's *keep recording* until its run ends past an eviction (the
     line `step N of M (oldest kept: step N)`, no `…` and no stop), each press followed by an `until` that `results()`
     has risen by one; then an `until` that the readout's λ segment names its value (`λ [`), and that segment read;
     the TM and rxm views stepped to step 3, as in case 1; ↺ on the λ view: its line becomes its first-fill line
     (`step 0 of 1,334 — history is full` in the probe), and the TM and rxm lines are what they were; then *keep
     recording* on the TM view, `stoppedPast` to its stop and an `until` that `results()` has risen by one: the λ
     segment is unchanged.
  3. **rxm.** `EXAMPLE`; the rxm view's first fill, waited on in stages of `stepTextOf('rxm-0')`'s count, an rxm twin
     of `stoppedPast` (its first fill is 56,588 frames in node, spec §8); *keep recording* on the rxm view and its
     recording staged likewise to a `budget` stop whose line names `(oldest kept:`; ↺: the first-fill line again,
     waited on in the same stages. Then the rewound leg's two continues, each of which posts an `extend` at the leg's
     epoch, now 1 (the whole-branch review's I1): *keep recording*, `stoppedPast` to its stop; ⏭, and the view at its
     newest step (a precondition); ▶ there, `stoppedPast` to its stop. Each `stoppedPast` names its press, so that a
     sabotage of one shows at that wait.
  4. **⏵ plays on across a rewind (P5).** Case 1's state on a fresh compile; the speed select set to `60/s` by
     `userEvent.selectOptions`, and its value asserted, since B3 fires within the frames below only at about a step a
     frame; ⏵ clicked; replies held; ↺ clicked; `frames()`, the harness's two animation frames, twice, after which the
     TM line still reads `step 0 of 0…` (the ring empty: B3's precondition) and the play button is still named
     `pause`; replies let through; the TM line's step reaches 1 or more while the line still carries `…` (`step 1 of
     36,608…` in fix round 4's probe), with its count no more than the first-fill line's, while the button is still
     `pause` and live; then pause. The hold is what makes the ring stay empty across frames: without it the
     first frames can land before the next animation frame, and B3 would not fire. At 60/s a frame is worth about one
     step, so a player without the hold stops the leg within those frames.
  5. **↺ by the keyboard keeps its focus (P4).** Case 1's state; ↺ focused, and the focus asserted to have taken;
     replies held; Enter. While held, ↺ is the active element with `aria-disabled="true"` and the line reads `step 0
     of 0…`, and ↺'s glyph is as faint as ▶'s, which a rewinding leg's ring leaves disabled: its computed colour's alpha
     against ▶'s `opacity` (a precondition: below 1), as `step-controls.test.ts`'s case of the waiting ▶'s look reads
     them, so that "greyed" is what the screen shows (the whole-branch review's M4). Then the held replies handed over
     only up to the first `tm-frames`: once the line counts past `0 of 0`
     while it still carries `…` (`step 0 of 256…` in fix round 4's probe), ↺ is the active element, neither `disabled`
     nor `aria-disabled`, P4's second half. Let through: the first-fill line, and ↺ still the active element, live.
     Each read of the focus by name is checked against the element whose state the case reads.
  6. **↺ while the old recording still brings frames.** Case 1's state up to *keep recording*; once the line names
     `(oldest kept:` while it still carries `…` (the `…` follows the count, and the note follows the tail, so the line
     does not end in it), replies held until at least one frames reply is held; ↺ clicked; a `watch` of the TM line
     started after the click and before the release, since before the click the line carries the old recording's
     counts, past the first fill's; let through. The line settles on the first-fill line, and no line the watch saw
     has a count past it.
  7. **↺ during a recompile (P8's first state; the whole-branch review's M3).** Case 1's state up to *keep recording*;
     ⏭, the view past its oldest kept step (a precondition); the program's editor focused; replies held; a space typed
     into it, which claims the new generation at once (`compile.ts`), so the TM line reads `— recompiling` (a
     precondition); a click on the TM ↺. At once the view stands at the oldest kept step with `— recompiling`: a seek.
     Let through: the TM line becomes the first-fill line, the recompile's first fill from step 0.
  8. **↺ inside the debounce of a copy's edit that does not parse (P8; fix round 3), and after the copy answered it
     (P8's second state; the whole-branch review's M3).** The file sets the copy editors' debounce to 3 s (`vi.mock`
     of `editor-debounce`, as `copy-edit-leaving.test.ts` does). A λ copy by *edit a copy*, *keep recording* until
     its step 0 is dropped, ⏭; replies held; `)` typed into the copy's editor; a click on ↺, the line read as the
     click lands by a capture-phase listener (precondition: no `— recompiling`, the edit still unsent). At once the
     view stands at the oldest kept step with `— recompiling`; let through: the editor marks the parse error, and the
     view stays at that step, stopped, with ↺ live. Then ⏭ again, the view past the oldest kept step (a
     precondition); replies held; ↺: at once the view stands at the oldest kept step, with no `…`, since the copy's
     `no-session` left the worker holding nothing and the frames a generation behind the client. This case is the
     last of the app's: it leaves the λ view on the copy, where a later case's `compiled` would read the copy's line.

- [ ] **Step 2: Chromium.** A browser run of the file (`$L/t5-chromium.log`, with `--reporter=verbose --reporter=json
  --outputFile=$L/t5-chromium.json`): all passed, and each case's time recorded from the JSON. One file runs in one
  tab whatever `VITEST_MAX_WORKERS` says (Names), so a second tab count would repeat the run. A case that fails there
  and passes alone (`-t '<its title>'`) depends on what an earlier case left, and is fixed.

- [ ] **Step 3: Firefox.** The same in Firefox (`$L/t5-firefox.log`, JSON `$L/t5-firefox.json`). The roadmap's `####
  FIREFOX PR 1` section lists what Firefox already fails: real clicks that do not land and focus that ends on `<body>`
  under several tabs (PR 2, contention), engine differences in scroll positions and text metrics (PR 3) and the caret
  bug (PR 4). A one-file run has one tab, so none of its failures is contention. A case that fails in the file's run
  and passes alone (`-t '<its title>'`, `$L/t5-firefox-alone-<n>.log`) depends on what an earlier case left, such as
  the speed at 60/s or a leg still playing, and a case that fails alone fails on its own: both are PR A's, fixed
  before Task 6 or reported. Contention can show only in Task 6 Step 5's whole-tier run, whose rule stands. The probe
  passed case 1's path in Firefox at the base.

- [ ] **Step 4: Commit** (heavy lock):

```
Browser tests drive ↺ by real gestures in the app: the view whose step 0 was dropped goes back to it and records its first fill again while the other views keep their steps, the λ value stays in the readout, playback carries on, the keyboard focus waits on ↺, and frames still arriving from the dropped recording are dropped
```

- [ ] **Step 5: Sabotages in `$S`**, moved to this commit as Task 3 Step 1 moves it (`crates/` has not changed since
  Task 1, so `pkg` stays), each a Chromium run of the file (`$L/t5-sab-<id>.log`). If this task has come near one
  dispatch's size (about 150 calls) by its commit, this step goes to a dispatch of its own, as Task 3 does for Task 2.

| Id | Sabotage | Must fail |
|---|---|---|
| B1 | `restart` as today's `seek(0)` | cases 1 to 6: 1 to 3 at the oldest kept step, not step 0; 4 with the ring never empty and the kept recording's count; 5 with ↺ live, never `aria-disabled`; 6 never back at step 0. Cases 7 and 8 pass: each ↺ of theirs is a seek |
| B2 | `onRewind` leaves `recorded` | cases 1 to 3 and 6 on `step 0 of 0 — history is full` (`refills`, and case 2's wait for the λ first-fill line); 5 at the wait for the rewind's first frames on the line, which reads `step 0 of 0 — history is full`; 4 with the player stopped at step 0 on a one-frame ring |
| B3 | The player's hold removed | case 4 (`play` after the ↺) |
| B4 | ↺'s row `waits: false` | case 5 (the focus on the speed select) |
| B5 | The worker posts the fresh result legs, not `keepDecided`'s | case 2 (`λ not finished · 1,334 reductions · …`) |
| B6 | `replies.ts`'s helper pushes whatever the epoch | case 6 at `refills`, by a timeout: the held frames of the old recording go into the emptied ring first, so the line stops at `of` 100,317 plus those frames and never reads the first-fill line. `past` is not reached (B8 reaches it) |
| B7 | `restart` always rewinds | case 1 (the rxm line `step 0 of 0…` while the replies are held); cases 7 and 8 (the view at step 0 at once after ↺, not at the oldest kept step) |
| B8 | `rewindLeg` leaves the ring, and `pushFrames` empties it at its epoch's first chunk instead | case 6 at `past` (the old window, counting past the first fill's, shown from the ↺ to the first new chunk); 4 at the line while the first frames are held (not `step 0 of 0…`); 5 at "↺ waits" (live, the ring not empty) |
| B9 | `canRestart` as `v.length > 0 && v.done !== null`, ↺ live only once the recording is over | case 5 at "↺ at the rewind's first frames" (`aria-disabled` still `true`); case 6 at its ↺ click, ↺ being disabled while the old recording runs |
| B10 | `restart` also seeks every other leg of its session to step 0 | case 1 at "the other views after the TM rewind"; case 2 at "the other views after the λ rewind" (each at `step 0`, not `step 3`) |
| B11 | The file's copy debounce at 0 ms (`vi.mock`'s `EDITOR_DEBOUNCE_MS: 0`) | case 8 at its precondition: the line as the click lands reads `— recompiling` |
| B12 | *keep recording* (`transport.ts`'s `extend`) posts epoch 0, not the leg's | case 3 at the `stoppedPast` of *keep recording* after the rewind: the worker drops the `extend`, and the line stays on the refill's stop |
| B13 | ▶ at the frontier (`transport.ts`'s `forward`) posts epoch 0, not the leg's | case 3 at the `stoppedPast` of ▶ at its newest step after the rewind, *keep recording*'s having passed |
| B14 | `restart`'s test is `!client.awaitingRun`, not the generation (T9's change) | case 8 at its last step (the view at step 0 at once, not at the oldest kept step); case 7 passes, the recompile in flight being awaited. Sessions' unparsed branch fails too, as under T9 |
| B15 | `restart` rewinds whenever the ring is evicted, whatever the generation (T7's change) | case 7 at "the view at once after ↺" (step 0, not the oldest kept step); case 8 at its first ↺ |
| B16 | `style.css`'s waiting step button keeps its colour (`color: inherit` for the `color-mix`) | case 5 at "↺ greyed" (alpha 1, not ▶'s `opacity` 0.35); `step-controls.test.ts`'s case of the waiting ▶'s look, at its glyph |

  B6's row and B8-B11 are fix round 4's (Task 5's review: B6 cannot reach `past`; ↺ live at the first frames; the other
  views off step 0; case 8's precondition shown to fire). B11 sabotages the test, not the app: it shows that case 8
  asserts its own window. B12-B16 are the whole-branch review's fix round's (I1, M3, M4). A sabotage that does not fire
  is a finding: re-run it once, and if it still passes, report it with the case and why its precondition did not hold;
  never weaken the case to make it fire.

---

### Task 6: The whole-branch gate

**Files:** none, unless a check fails. A fix is its own commit, named for what it changes, and the checks it touches
are run again.

- [ ] **Step 1: CI's `rust` legs.** Heavy lock (and the browser lock inside it for the first):
  `scripts/check-all.sh --no-llvm` (`$L/t6-check-all.log`), exit 0; `cargo llvm-cov nextest --workspace
  --fail-under-lines 90` (`$L/t6-llvm-cov.log`), exit 0, its line figure recorded; `scripts/check-slow.sh`
  (`$L/t6-slow.log`), exit 0 with "slow tier green".
- [ ] **Step 2: The scans, from `$W`.** `scripts/check-text-bytes.sh`, `check-citations.sh`, `check-attributions.sh`,
  `check-doc-figures.sh`, `check-shared-docs.sh`, `check-colours.sh`, `check-grammar-wasm.sh` and `check-lua.sh`, each
  with `--self-test` and then without; `scripts/check-licences.sh --self-test` and without; `node
  scripts/check-comments.mjs --self-test` and `--base ec4f11a` (`$L/t6-scans.log`). Every one exits 0.
- [ ] **Step 3: CI's `web` job, in order, from `$W/web`.** Heavy lock: `pnpm install --frozen-lockfile`, `pnpm run
  build:wasm`, `pnpm run build:lsp-wasm`, `pnpm run build:bindings`; `pnpm exec biome ci --error-on-warnings`; `pnpm
  run typecheck`; `pnpm run test:coverage` under the browser lock too (`$L/t6-coverage.log`), exit 0 with its `All
  files` row (statements, branches, functions, lines) against `vite.config.ts`'s thresholds 95 / 89 / 97 / 97; `pnpm
  run build:app`.
- [ ] **Step 4: The image, once.** Heavy lock: `docker build -t redextape-pr-a .` from `$W` (`$L/t6-docker.log`), exit
  0; `docker run --rm -d -p 8099:80 --name redextape-pr-a redextape-pr-a`; it reports healthy; `/` and `/help.html`
  answer 200 and `/help.html` contains `back to step 0`; `docker rm -f redextape-pr-a`.
- [ ] **Step 5: Firefox, the whole tier once.** From `$W/web`, `flock ~/temp/redextape-browser.lock pnpm run
  test:firefox --reporter=verbose --reporter=json --outputFile=$L/t6-firefox.json >| $L/t6-firefox.log 2>&1` (the script
  sets `REDEXTAPE_FIREFOX`), then `python3 -I ~/temp/redextape-firefox-ci-record/scripts/pr1/targets.py
  $L/t6-firefox.json` (`$L/t6-firefox-targets.log`). Its T3 line lists the failures outside PR 1's base union, which was
  measured at `e9bbf67`, before step-focus's tests and PR A's existed. Each is re-run alone in one tab: one that passes
  alone is contention for Firefox PR 2; one that fails alone in a file PR A touched is PR A's and blocks; one that fails
  alone in a file PR A did not touch is run alone in `$S` at `ec4f11a`, and if it fails there too it is main's, recorded
  for the Firefox lane. The counts are recorded, not asserted.
- [ ] **Step 6: Leave `$S`.** `git -C $W worktree remove --force $S`; `git -C $W worktree list` no longer shows it.

---

### Task 7: The roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (append, last in the file)

- [ ] **Step 1: Write the entry,** after Task 6 and after the final code commit, in the shape of the entries above it: a
  `####` heading that says what PR A does, with the date, the branch `hidden-recording`, the range from `ec4f11a` to
  the last code commit, its commit count, "plus this entry"; then `#####` sections.
  - **What changed**, one bullet per task's commit with its SHA, the spec's commits (`53b7755`, `c3b300a`, `6a7fda9`
    and the pre-flight fix round's) and the plan's.
  - **The user's decisions**, Q1, Q2, the spec's approval and his ruling on P4 (all 2026-11-04 but Q1 and Q2, which
    are 2026-11-03), one line each; the controller's calls P3, with its first-`result` rule, and P5, and the settled
    P8, with its flushed edit, each named as such (fix round 3's two calls are P3's first-`result` rule and P8's
    flushed edit; spec §6 and §9 record them).
  - **WHAT THIS DID NOT CLOSE**: PR B, all of spec §9's PR B list; *keep recording*, "history is full", "(oldest kept:
    step N)" and the ten-continue cap, which PR A keeps (§9); Firefox failures Task 6 recorded as contention, for
    Firefox PR 2; the two copy states P8 names and leaves (an `extend` after an edit that did not parse, and such an
    edit during a rewind's first fill); anything Tasks 1 to 6 found and did not fix.
  - **VERIFICATION.** Every figure names its command and log: Task 1's filter and package runs, the boundary leg;
    Task 2's and 4's node and browser runs; Task 5's Chromium and Firefox runs with each case's time; Task 6's gate,
    the llvm-cov line figure, the `All files` row, the image, the Firefox T3 line; and each sabotage R1-R5, N1-N19,
    T1-T11, B1-B16 with what failed. The record is `~/temp/redextape-history-restart-record/` (`logs/pr-a/`).

- [ ] **Step 2: Check and commit.** `scripts/check-doc-figures.sh` and `scripts/check-citations.sh` pass (the hook runs
  both). Commit:

```
The roadmap's entry for hidden recording PR A: ↺ goes back to step 0 by a per-leg rewind, what it measured, and what it leaves to PR B
```

---

## Spec coverage

| Spec | Where |
|---|---|
| §5.4 the six methods, the TM `Rc` and caps, the rxm program and caps, the λ checkpoints' rewind | Task 1 Steps 3-5; P1, P2 |
| §7 Rust: per leg and copy, byte-identity, status, the three sabotages | Task 1 Step 2, R1-R4 (and R5 for the boundary) |
| §5.2 `rewind` request, `epoch` on frames and `extend`, no `result` from a rewind, the epochs' purpose | Task 2 Steps 2-5; worker.test cases 1-3; N8, N9, N11, N14; the page's `extend` after a rewind: Task 5 case 3, B12, B13 |
| §5.4 the worker's arm: epoch, loop ended, rewind, books reset, first fill with `emitInitial` | Task 2 Step 4; record-loop case; worker.test cases 4 and 5; N1, N2, N7, N8, N16 |
| §9 the first fill records one `HISTORY_BYTES` and stops at `budget` | Task 2 Step 4; Task 5 cases 1-3 (P7) |
| §11 call 6, the readout keeps the λ value; §9 an unfinished λ's count after a λ ↺ | P3; Task 2 Step 4, worker.test cases 5 and 6; Task 5 case 2; N5, N12, B5 |
| §5.2 and §9 a `result` during a rewind's fill keeps the leg's part; an rxm copy keeps a decided value | P3; Task 2's fix round, worker.test cases 7 and 8, replies' `rxm-value` case; fix round 3's worker.test case 9; N13, N15, N17; a build's fresh start: worker.test case 10, N18, N19 |
| §5.4 the page's ↺: epoch raised, ring and `done` cleared, `rewind` posted | Task 4 Steps 1-2 (the `restart` case's evicted branch); T1, T6; Task 5 case 6, B6, B8 |
| §4.1 and §9 ↺ named `back to step 0`; the comment and the help sentence | Task 4 Steps 2-3 |
| §6 ↺ with step 0 kept is a seek and posts nothing | Task 4 Step 1 (the `restart` case's kept branch), T8; Task 5 case 1 (↺ on the rxm view), B7 |
| §6 ↺ during a recompile, or on a copy whose last edit did not parse, is a seek | P8; Task 4 Step 1 (the `restart` case's awaiting and unparsed branches), T7, T9, T10; fix round 3's pending branch and Task 5's case 8, T11, B11; in the app, Task 5's cases 7 and 8, B14, B15 |
| §6 ↺ leaves ⏵ (§11 call 4) | P5; Task 4 Step 2; Task 5 case 4; T4, B3 |
| §9 and §2 the user's ruling on P4: `step 0 of 0…`, ↺ waits | P4; Task 4 Steps 1-2; Task 5 case 5; T2, T3, T5, B4, B9; its greyed look, B16 |
| §7 node test for the epoch, both sides | Task 2 Step 1 (record-loop, replies); N1-N3 |
| §7 browser: ↺ lands on step 0 and another view keeps its step; in Firefox | Task 5 cases 1-3, Steps 2-3, B10; Task 6 Step 5 |
| §7 browser sabotage: ↺ as today's `seek(0)` | B1 |
| §9 *keep recording*, "history is full", "(oldest kept)", ten continues stay | Task 4 Step 2 (help.html), Step 3 (the sweep's expected grep) |
