# CLIF view PR 2: the view — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the CLIF view design's PR 2 (§7.2): a fifth view kind, `clif`, listing the program's CLIF as built or
optimised and stepping it one CLIF instruction at a time, fetched only on intent, recorded only while shown, linked both
ways, with the header and help naming five views, and a Firefox run.

**Architecture:** The session worker loads `pkg-clif/` through one memoised `import()` the first time the page asks (intent
on the toggle, a CLIF view shown, a stored workspace or link showing one), builds a `ClifSession` from the live session's
`clifInput()` after the other legs have posted their `result`, and records it with `record-loop.ts`'s loop under its own
epoch; a `clif` request rebuilds or drops it without a recompile. The page tells the worker what it wants through one
`ClifSync` (`run.clif`, then `clif` requests). A `ClifPane` built from `MachineViewChrome`, `ListingPanel` (with a label
hook), `valuesPanel`, `callStackPanel` and `heapPanel` draws the frames, and links reach CLIF rows by srcloc through
`LINKED`, whose clicks become table-driven and whose rows receive the pin.

**Tech Stack:** TypeScript, Vite, Vitest 4 (node; browser on Playwright, Chromium and Firefox), Biome; Rust 1.100, ts-rs
12, wasm-bindgen 0.2.130, cargo-nextest; `pkg-clif/` as PR 1 (#189, `41d01d7`) built it.

**Spec:** `docs/superpowers/specs/2026-11-18-clif-view-design.md` (§4; §6 but its build wiring; §8's no fetch without
intent, recording, links and hot paths; §7.2). Rulings: `$R/plan-brief-pr2.md` (cited L1-L5, W1-W12, G1-G9). Evidence:
`$R/survey-worker.md` (A1-A8), `$R/survey-page.md` (B1-B7), `$R/probe.md` (P1-P4) with `$R/probe.diff` and
`$R/probe-files/`, and **Verified facts** below.

## Global Constraints

- **Paths.** `W=/home/davey/temp/redextape-clif-view2` (branch `clif-view-2` off `41d01d7`);
  `R=/home/davey/temp/redextape-clif-view-record/pr2`; `T=/home/davey/.cache/redextape-clif-view2-target` (every cargo and
  wasm-pack run sets `CARGO_TARGET_DIR=$T`); `B=/home/davey/temp/redextape-clif-view2-base` (Task 13, target
  `/home/davey/.cache/redextape-clif-view2-base-target`); `P=/home/davey/temp/redextape-clif-view2-probe` (read only).
  Line references are at `41d01d7`; once an earlier task edits a file, find the place by name.
- **Commands** (notation used below; each writes `>| $R/logs/<task>-<what>.log 2>&1`, then `print $?`, and the summary is
  read from the log; zsh has `noclobber`; never pipe a run through `tail`). `NODE f`: `cd $W/web && pnpm exec vitest run
  --project node tests/node/f.test.ts`. `BROWSER f`: `until ! ss -ltn | grep -q ':63315 '; do sleep 5; done` (another
  project's vitest uses that port), then `VITEST_MAX_WORKERS=2 pnpm exec vitest run --project browser
  tests/browser/f.test.ts`; scope by path, since `pnpm test:browser -- name` does not scope and `--maxWorkers` skips the
  browser projects. `FIREFOX f`: `BROWSER f` with `REDEXTAPE_FIREFOX=1` and `--project firefox` (`vite.config.ts:81-85`).
  `RUST args`: `CARGO_TARGET_DIR=$T cargo nextest run --no-fail-fast args`. `TSC`: `pnpm run typecheck`; `LINT`: `pnpm exec
  biome ci --error-on-warnings`, both in `$W/web`.
- **Commits.** The pre-commit hook runs clippy `-D warnings`, `check-comments.mjs` and the scans. Never `--no-verify` or
  `--amend`; a fix is a new commit. When the comment hook asks for a budget value, write the one it prints in that
  commit; Task 14 writes the final ones.
- **Sabotage.** `cp <file> $R/sab/<name>`, the one edit named, the named test into a log, `cp` back, `cmp`. Never `git
  checkout`, and never in a checkout a dev server serves. Record each in `$R/sabotage.md` (edit, test, failing line). **A
  sabotage that does not fire is a finding: stop and report.** One stops at the first failing assertion, so each
  load-bearing assertion gets its own.
- **Fixtures** come from Verified facts or from a run the task logs. An invented fixture value is a finding.
- **Copy and code.** "redextape" is lowercase in prose; copy is British (*optimised*); doc comments are `/** */` in
  TypeScript, `///` in Rust; comments say why (the reason, the invariant, what breaks), never history, measurements, a PR's
  story or a `file:line` (`check-citations.sh`); no ruling is attributed to the user anywhere in the tree. **DRAFT** copy is
  the user's to approve; implement it verbatim.
- **Browser tests.** Probe prints use `console.error`. Presses use `userEvent`, never a synthetic `.click()` (one hid lost
  real clicks); a press on an `aria-disabled` button needs `{ force: true }`; `userEvent.hover` scales its `position` in
  place, so pass a fresh object. A claim about what a user sees asserts geometry or computed style, not `textContent`
  alone. `pkg/`, `pkg-lsp/` and `pkg-clif/` are real directories, never symlinks.
- **The anti-goals are constraints.** `pkg/` does not change (Task 13). Nothing of `pkg-clif/` is fetched without intent.
  No existing view's behaviour changes beyond the fifth toggle and the help. A compile never waits on the CLIF leg, and λ,
  TM and rxm recording do not slow (Task 13).
- **The import is a literal**, `import('../../pkg-clif/redextape_clif_wasm.js')`: `licences-scan.test.ts` throws on a
  template-literal specifier (A8).

## Review Focus

Failure modes the design implies that no task's main test reaches, most likely first. Each has its test in the task named.

1. **A CLIF view shown while a run is in flight** (a keystroke, then key 5 inside the debounce). The run carried
   `clif: null`; the page posts the `clif` request when that run's `compiled` arrives and never before, since `resetLegs`
   zeroes the epoch a request would have raised (`sessions.ts:220-234`). The CLIF leg records for the new generation.
   Task 7.
2. **A recompile while the CLIF pass awaits the load.** The old generation's pass builds and records nothing: no `frames`
   of `leg: 'clif'` carry the old `gen` once the new `compiled` is posted. Task 5.
3. **The listing switched while the CLIF leg records a long run.** The old loop stops at its next chunk, and no frame of
   the old epoch reaches the new history. Task 10.
4. **A CLIF frame retaining more than `LEG_FRAME_BYTES.clif` charges** (a `ClifValue` is an object holding a word object
   and an array), which would let the ring pass `HISTORY_BYTES`. Task 5's `frame-cost` case.
5. **A link opened on a CLIF position past the CLIF leg's first fill, beside an rxm position past rxm's.** Both land,
   continued one at a time. Task 12.

## Departures from the brief

| Brief says | This plan does | Evidence |
|---|---|---|
| G9: help says "all five"; `pages.test.ts`'s `countWord` gains five | The cycle sentence keeps "all four"; `pages.test.ts` reads the last stop off `CYCLE`, `countWord` unchanged | G2 keeps CLIF out of the cycle, so its last stop has four kinds (`arrangements.ts:91-94`, `pages.test.ts:141-157`) |
| W4: CLIF records after `postResult` | Kept, and the CLIF pass posts a second `result` when its first fill stops | The readout's CLIF rows and `LinkPositions`' continue are driven by `result` (`share-positions.ts:203-215`); nothing waits on it |
| G5: Retry posts `clif-load`, then the `clif` request | Retry posts the `clif` request alone | Its CLIF pass loads, and a failed load forgets its promise (L1); a `clif-load` first would fetch twice |
| W12: TooDeep reads the native CLI's or `redextape-native`'s sentence | The rxm leg's sentence, `rxm_decline_reason`'s | Neither prints one: the CLI prints `LowerError`'s Debug (`emit.rs:362-363`, `run.rs:613-614`). The CLIF build raises only `Unsupported` (`module_free.rs:55-61`, `analysis.rs:50-52`) |
| W7: `ClifLeg` keeps the total of an end reached without a raise | An unraised cursor hands its end to a scout that has not ended; one `raised: bool` | `status()` and `value()` already read a scout's end (`leg.rs:121-130, 153-166`), so the length and the value both survive `rewind()` |
| Order (2): Rust and generated types in one task | Task 2 (the leg), Task 3 (the types) | A reviewer can reject the bindings script's change alone |
| G8 in task (1) | `LinkedLeg` excludes `clif` from Task 4 until Task 11 adds `LINKED.clif` | `LINKED` is mapped over `LinkedLeg` (`linked-legs.ts:29-36`), so the leg cannot join without its entry; `pin.origin === 'clif'` does not type-check before Task 4 |

## Decisions for the user

| | Ruling (the controller's unless marked) | This plan | If overturned |
|---|---|---|---|
| W1 | "Shown" is `combinationOf(tree).includes('clif')`: an unselected Stage tab counts, a pane parked by another arrangement does not | Task 7's `clifWanted` | Only `clifWanted` and its test change |
| W3 | CLIF does not wait for or build hidden-recording PR B's `head.shown` | The roadmap entry names the overlap for PR B | PR 2 waits for PR B |
| W6 | No run-ahead: the end is reported when the recording reaches it; `findEnd` is never called | The readout shows CLIF's steps only once its run has ended | Task 5 adds a chunked `findEnd` pass after the fill |
| G2 | The layout cycle stays three pairs then all four; CLIF is filtered out | Task 4 | `CYCLE` gains "source beside CLIF" and all five; help and tests follow |
| D1 | **DRAFT** copy: `KIND_GLOSS.clif` and help.html's four sentences (Task 4); the switch's labels and titles are the brief's | Task 4, Task 10 | Copy edits only |
| D2 | A CLIF build failure shows in the CLIF view only, not in the readout (the readout has CLIF rows only while a stepper runs) | Task 4's `clifRows` | `clifRows` prints a *declined* row as rxm's does |

## Verified facts

Measured 2026-11-19 in `$P` (release `pkg/` and `pkg-clif/` at `41d01d7`). The three node tests are kept in
`$R/plan-facts/`; copy one into `$P/web/tests/node/` and run `cd $P/web && pnpm exec vitest run --project node
tests/node/<name>.test.ts`; each writes its `.out` to the path on its last lines (outputs kept beside them).

| Fact | Value | Source |
|---|---|---|
| An rxm instruction that marks no optimised CLIF row | `first-order-02`, `if 2 > 1 { 10 } else { 20 }`: rxm pc 6 `li rr, #20` (owner node 4); as built rows 60 `v13 = iconst.i64 20` and 61 `jump block8(v13)  ; v13 = 20`, optimised none. Also `first-order-03` (pcs 4, 5). No web example has one: every pc of all 7 has a row in both listings | `clif-corpus-scratch`, `clif-f2-scratch` |
| `first-order-02`'s rxm listing and owners | `li r1, #2`, `li r2, #1`, `cmpgt r0, r1, r2`, `jz r0, else0`, `li rr, #10`, `jmp endif1`, `li rr, #20`, `halt`; owners `[0,1,2,5,3,5,4,5]`; optimised marks pcs 0-5 and 7 | `clif-f2-scratch` |
| `fact.rxt` listings | as built 187 rows, 59 Inst, 19 Inst with no srcloc; optimised 155, 45, 8. Functions `u0:11` `$main` (first_row 0), `u0:12` `fact.0` (63 built, 57 optimised) | `clif-facts-scratch` |
| `fact.rxt` rows per srcloc | pc 4 (`cmpeq r1, r2, r3`): 3 built, 2 optimised; pc 13 (`call fact.0`): 5 and 5. rxm owners `[16,16,4,5,6,15,7,15,8,10,11,12,13,13,13,14,16,1,2,2,16]` | `clif-f2-scratch` |
| A CLIF row with no srcloc | `fact.rxt` as built row 29, `v1 = iconst.i64 0` in `u0:11`; optimised row 29, `jump block1` | `clif-facts-scratch` |
| A frame with cells and a box (the charge fixture) | `let xs = cons(1, cons(2, nil)); let mut v = 2; let get = \|x\| v + x; get(head(xs))`, as built, step 64: 3 values, 2 frames, 4 cells, 1 box: the JSON in `$R/plan-facts/facts.out` (`FACT2 frame`). Charge `64 + (3 + 2 + 2·4 + 1) · 52 = 792` | `clif-facts-scratch` |
| A second charge fixture | `fact.rxt` as built step 95 (P4's JSON): 17 values, 4 frames, no heap: `64 + 21 · 52 = 1156` | `probe.md` P4 |
| Steps to the end | every example records whole in both listings (15 to 665 frames); `fact.rxt` 189 built, 131 optimised, value `24` | P3 |
| `ClifSession` | `listing()`, `status()`, `step()`, `state(window)`, `value()`, `rewind()`, `raiseCap(u32)`, `findEnd(u32)`, `free()`; errors thrown as strings; `u64` counts cross as numbers; `"as-built"` / `"optimised"` | A1 |
| Partition's text for an undefined call | ``call to undefined label `missing` `` (`analysis.rs:170`) | read |
| The rxm leg's TooDeep sentence | `the program nests deeper than the rxm lowering guard allows` (`session.rs:429`) | read |
| Loading | `import()` in the session worker works in dev, `vite preview` and vitest, both engines; nothing is fetched before the ask; Playwright's `page.on('request')` and `context.on('request')` see the worker's two requests in both engines | P1, P2 |
| Existing copy | `help.html:36` (the click sentence), `:40-44` (the views list, pinned by `app-header.test.ts:55-62`), `:91-99` (keys table, cycle sentence), `:116` (keys in views); `KIND_GLOSS` at `app-header.ts:352-357` | read |

## File structure

| File | Responsibility | Task |
|---|---|---|
| `web/src/{link,link-wiring,linked-legs,link-status,transport,draw}.ts` | a click's origin, the pin in `rows`, clicks from `LINKED`; CLIF's entry and focus | 1, 11 |
| `crates/redextape-clif/`, `crates/redextape-clif-wasm/src/lib.rs` | the length kept past a rewind; a refusal as a sentence; the `ts` derives | 2, 3 |
| `scripts/{build-web-bindings,check-all}.sh`, `web/src/types.ts` | generated TypeScript for the CLIF types | 3 |
| `web/src/{protocol,legs,layout,arrangements,app-header,panes,pane-host,results,…}.ts`, `web/help.html` | `'clif'` in every table, `CopyLeg`, the toggle, key 5, the help | 4 |
| `web/src/clif-loader.ts` (new), `session-worker.ts`, `record-loop.ts`, `vite.config.ts` | load, build, record and drop the stepper; `watchRequests`, `failRequests` | 5, 6 |
| `web/src/clif-sync.ts`, `clif-intent.ts` (new), `session-client.ts`, `compile.ts`, `replies.ts`, `main.ts` | what is shown, intent, history dropped when hidden | 7 |
| `web/src/clif-view.ts` (new) | rows, values, call stack, heap and notices, pure | 8 |
| `web/src/clif-pane.ts` (new in 4), `listing-panel.ts`, `machine-panels.ts`, `style.css` | the view, the label hook, `regs` | 4, 9, 11 |
| `web/src/{program-store,share-link}.ts`, `main.ts` | the listing switch, stored and linked | 10 |
| `web/src/share-positions.ts` | a link's CLIF position | 12 |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | the entry | 14 |

---

### Before Task 1: set up (no commit)

- [ ] **Step 1.** `git -C /home/davey/projects/redextape worktree add -b clif-view-2 $W 41d01d7`; `mkdir -p $R/logs $R/sab $R/gate`.
  From `$W/web`, into `$R/logs/setup.log`: `pnpm install --frozen-lockfile`, `pnpm run build:wasm`, `build:lsp-wasm`,
  `build:clif-wasm`, `build:bindings`. Expected: exit 0; `$W/pkg/`, `pkg-lsp/`, `pkg-clif/` each hold a `_bg.wasm`.
- [ ] **Step 2.** `NODE clif-package`, `TSC`, and `RUST -p redextape-clif`. Expected: all pass. Copy each summary line to
  `$R/baseline.md` with `sha256sum $W/pkg/redextape_wasm_bg.wasm` (Task 13 compares it).

### Task 1: Links take their origin and their pin, with nothing a user sees changing

Spec §6 *Links* (M1, M2). Brief G8. The CLIF arms come in Task 11; this task changes shapes only.

**Files:**
- Modify: `web/src/link.ts:186` (`InstrLeg` beside `Pin`); `web/src/link-wiring.ts:75-77`, `:194`, `:215-217`, `:251`,
  `:308-314`; `web/src/linked-legs.ts:29-72`; `web/src/transport.ts:518-546` (the rxm and TM spreads; λ's stays);
  `web/src/draw.ts:232`, `:257`; `web/src/pane-chrome.ts:199`.
- Test: `web/tests/node/link-wiring.test.ts`, `web/tests/node/linked-legs.test.ts`.

**Interfaces** (produces):

```ts
// link.ts
/** The legs whose rows are rxm instructions or name one, so whose pins carry its pc. */
export type InstrLeg = Extract<Leg, 'rxm' | 'clif'> // 'rxm' alone until Task 4 adds 'clif' to Leg
// link-wiring.ts, LinkWiring
setLinkTo(node: number | null, origin: Exclude<Pin['origin'], InstrLeg>): void
/** null: a row lowered from no rxm instruction, which clears the pin and explains nothing. */
linkInstr(pc: number | null, origin: InstrLeg): void
// linked-legs.ts, every LINKED entry
rows(l: Link, pin: Pin | null): number[]
click: { readonly event: 'linkInstr' | 'linkState'; link(w: LinkWiring, row: number | null): void }
// pane-chrome.ts, PaneEvents
linkInstr?: (pc: number | null) => void
```

- rxm: `rows: (l) => l.instrs`; `click: { event: 'linkInstr', link: (w, pc) => w.linkInstr(pc, 'rxm') }`. TM: `rows: (l) =>
  l.states`; `click: { event: 'linkState', link }` with today's `linkable`/`index` guards then `setLinkTo(nodeForState(id),
  'tm')`.
- `transport.ts`: one spread over `isLinkedLeg(slot.binding.leg)` whose member is `LINKED[leg].click.event` and whose
  handler keeps today's detached guard (a copy's row links nothing) before `click.link(linkWiring(), row)`.
- Callers pass the pin: `link-wiring.ts:194` and `:251` `link`, `draw.ts:232` `null` (running focus has no pin),
  `draw.ts:257` `linkWiring.link`.

- [ ] **Step 1: Failing tests.** `link-wiring.test.ts` (its fixture: `OWNED_PC` owned by `NODE`):
  `links.linkInstr(OWNED_PC, 'rxm')` leaves `links.link` `toStrictEqual({ node: NODE, origin: 'rxm', pc: OWNED_PC })`;
  then `links.linkInstr(null, 'rxm')` leaves `links.link` `null`, `line()` `''` (not `OWNERLESS`) and `gestures` one
  higher. `linked-legs.test.ts`: for `pin` of `null`, `{ node: 1, origin: 'rxm', pc: 2 }`, `{ node: 1, origin: 'source'
  }` and `{ node: 1, origin: 'tm' }`, `LINKED.rxm.rows(l, pin)` is `l.instrs` and `LINKED.tm.rows(l, pin)` `l.states`.
  The existing `linkInstr(OWNED_PC)` calls gain `'rxm'`.
- [ ] **Step 2: Run** `NODE link-wiring`, `NODE linked-legs`. Expected: FAIL to compile (`linkInstr` takes one argument).
- [ ] **Step 3: Implement** as Interfaces says. `linkInstr(null, origin)` is `commitLink(null, origin, false)` behind the
  same `linkable` guard.
- [ ] **Step 4: Run** the two node files, `TSC`, `LINT`, then `BROWSER` each of `rxm-link`, `link-hold`, `copy-pin`,
  `rxm-pane`, `tm-pointer`, `link-clear`, `marks`, `running-focus`. Expected: PASS, every browser file unchanged.
- [ ] **Step 5: Sabotage.**

| Edit | Must fail |
|---|---|
| `linkInstr(null, …)` commits with `noOwner` `true` | `a row lowered from no instruction…` (`line()` is OWNERLESS) |
| `LINKED.tm.click.event` is `'linkInstr'` | `link-hold`'s TM state click (the TM view's `linkState` is never set) |
| the spread's detached guard removed | `copy-pin` (a copy's row pins the program) |

- [ ] **Commit:** `A click on an rxm row or a TM state links through the leg table, records the origin it is given, and
  each leg's rows receive the pin; nothing a user sees changes`.

### Task 2: The CLIF leg keeps the length a rewind would lose, and says why it cannot be built

Brief W7, W12. Roadmap (`2026-07-19-redextape-roadmap.md:38308-38313`).

**Files:** Modify `crates/redextape-clif/src/leg.rs:39-46` (a field), `:139-142` (`step`), `:134-137` (`rewind`),
`:171-180` (`raise_cap`), `src/lib.rs` (re-export); `crates/redextape-clif-wasm/src/lib.rs:35`; tests in
`crates/redextape-clif/tests/leg.rs` and `web/tests/node/clif-package.test.ts`.

**Interfaces** (produces):
- `ClifLeg` gains `raised: bool`: set by `raise_cap` when it raises, cleared by `rewind`. `step`, when the cursor stops
  (ends or pauses) unraised and the scout is still `Scout::Running`, replaces the scout with `Scout::Ended { end, steps }`
  of the cursor's. A raised cursor's end is never handed over: it is not the run under the input's caps.
- `pub fn decline_reason(e: &LowerError) -> String` in `leg.rs`, re-exported: `Unsupported { what, .. }` gives `what`;
  `TooDeep { .. }` gives `the program nests deeper than the rxm lowering guard allows`. The wasm constructor throws
  `decline_reason(&e)` alone, without the `ClifSession: ` prefix: the page shows it after *No CLIF for this program:*.

- [ ] **Step 1: Failing tests** in `tests/leg.rs` (its helpers `leg`, `loop_src`, `step_to_stop`, `TIGHT`):
  - `a_rewind_keeps_the_length_the_cursor_found`: `FACT` (`Ty::Nat`), both listings, `find_end` never called: stepped to its
    end, `total_steps` is `Some(189)` (optimised `Some(131)`); after `rewind()`, `status() == ClifStatus { run: Running,
    cap: None, total_steps: Some(189) }` and `value() == Decoded::Value { text: "24".into() }`.
  - `a_pause_before_any_raise_is_kept`: `loop_src()` at `TIGHT`, as built: `step_to_stop` is 1,205 and `total_steps` is
    `Some(1205)`; `raise_cap(40)`, stepped to the next stop: `total_steps` is that stop's steps (above 1,205); `rewind()`:
    `total_steps == Some(1205)`.
  - `a_raised_end_is_not_the_runs_length`: `loop_src()` at `TIGHT`: `raise_cap(40)` at step 0, `step_to_stop` (above
    1,205), `rewind()`: `total_steps == None`; `step_to_stop` again is 1,205 and `total_steps == Some(1205)`.
  - `a_build_failure_is_a_sentence`: `ClifLeg::new(ClifInput { program: Program { code: vec![Instr::Call("missing".into()),
    Instr::Halt], labels: vec![] }, ty: Ty::Nat, caps: DEFAULT_CAPS }, Listing::AsBuilt)` is `Err(e)` with
    ``decline_reason(&e) == "call to undefined label `missing`"``; `decline_reason(&LowerError::TooDeep { node:
    NodeId::default() })` is the TooDeep sentence above.
  - `clif-package.test.ts`, `'says why a program has no CLIF'`: `new ClifSession({ program: { code: [{ Call: 'missing' },
    'Halt'], labels: [] }, ty: 'Nat', caps: { steps: 5_000_000, stack: 100_000, heap: 5_000_000, mem: 64_000_000 } },
    'as-built')` throws exactly ``call to undefined label `missing` ``.
- [ ] **Step 2: Run** `RUST -p redextape-clif --test leg`. Expected: all four fail (`None` where a length is now kept;
  `decline_reason` undefined).
- [ ] **Step 3: Implement** as Interfaces says; update `ClifStatus::total_steps`'s and the wasm constructor's docs.
- [ ] **Step 4: Run** `RUST -p redextape-clif`; rebuild `pkg-clif` (`pnpm run build:clif-wasm`); `NODE clif-package`.
  Expected: PASS.
- [ ] **Step 5: Sabotage.**

| Edit | Must fail |
|---|---|
| `step` never hands the cursor's end to the scout | `a_rewind_keeps_the_length…` |
| the hand-over ignores `raised` | `a_raised_end_is_not_the_runs_length` (`Some(n)`) |
| `rewind` leaves `raised` set | `a_raised_end_is_not_the_runs_length`'s last assertion (`None`) |
| the constructor keeps `format!("ClifSession: {e:?}")` | `'says why a program has no CLIF'` |

- [ ] **Gate:** `cargo fmt --all --check`; `cargo clippy --workspace --all-targets -- -D warnings`; `cargo check --target
  wasm32-unknown-unknown -p redextape-clif --lib` and `-p redextape-clif-wasm --lib`.
- [ ] **Commit:** `A CLIF leg remembers the length its cursor found when rewound, and a program it cannot build is
  refused with a sentence`.

### Task 3: The CLIF types reach TypeScript generated, as core's and wire's do

Brief G3: the mechanism is `ts-rs` derives (`scripts/build-web-bindings.sh`; core's `ts` feature), so the types are generated.

**Files:** Modify `crates/redextape-clif/Cargo.toml` (`ts-rs = { version = "12", optional = true }`; `ts =
["dep:ts-rs", "redextape-core/ts", "redextape-wire/ts"]`; `redextape-test-support` is a dev-dependency already);
`src/state.rs:15-73`, `src/listing.rs:18-67`, `src/leg.rs:26-37`; create `tests/ts_bindings.rs` (as
`crates/redextape-wire/tests/ts_bindings.rs`); `scripts/build-web-bindings.sh`; `scripts/check-all.sh:156-163` (three
legs); `web/src/types.ts` (re-exports).

**Interfaces** (produces): `web/bindings/` gains `ClifAt`, `ClifWindow`, `ClifValue`, `ClifState`, `ClifRowKind`,
`ClifRow`, `ClifFunction`, `ClifListing`, `ClifStatus`, each re-exported from `types.ts`. Every `u64` field carries
`#[cfg_attr(feature = "ts", ts(type = "number"))]` (`ClifState::step`), every `Option<u64>` `ts(type = "number |
null")` (`ClifStatus::total_steps`), as `redextape-wire`'s do.

- [ ] **Step 1: Failing test.** `tests/ts_bindings.rs` with `generated()` listing the nine and the three gates
  `no_generated_type_carries_bigint`, `assert_generated_covers_every_derive_site`, `assert_overrides_match_field_nullability`.
- [ ] **Step 2: Run** `RUST -p redextape-clif --features ts --test ts_bindings`. Expected: FAIL (no `ts` feature, no `TS` impls).
- [ ] **Step 3: Implement** the derives; the script gains a third leg, `TS_RS_EXPORT_DIR="$CLIF_DIR" cargo test -p
  redextape-clif --features ts --lib export_bindings` (`--lib`: the integration targets add nothing to export), its own
  `check_leg_produced_files`, and `check_no_leg_collisions` taken over every pair of legs, a byte-identical file dropped
  from the later leg (the clif leg writes core's `RxmWord`, `RxmCell`, `RxmBox`, `RxmCap`, `WordTag` and wire's
  `RunStatus`, `Decoded` beside its own). `check-all.sh`: `base|clippy|-p redextape-clif --features ts --all-targets`,
  `base|test|-p redextape-clif --features ts`, `base|wasm|-p redextape-clif --lib --features ts`.
- [ ] **Step 4: Run** the gate test; `pnpm run build:bindings` (time it on a warm `$T` and record the figure in
  `$R/logs/t3-bindings-time.log`); `ls $W/web/bindings/Clif*.ts` lists nine; `TSC`. Expected: PASS.
- [ ] **Step 5: Sabotage.**

| Edit | Must fail |
|---|---|
| `ClifState::step` loses its override | `no_generated_type_carries_bigint` |
| `ClifStatus::total_steps`'s override is `"number"` | `assert_overrides_match_field_nullability` |
| `ClifValue` dropped from `generated()` | `assert_generated_covers_every_derive_site` |
| the script's clif leg exports nothing (filter `export_bindingsX`) | `build:bindings` exits 1 naming `redextape-clif` |
| the collision check left at the core/wire pair | `build:bindings` exits non-zero (`mv` refuses a second `RxmWord.ts`) |

- [ ] **Gate:** as Task 2, plus `scripts/check-all.sh --list | rg clif` shows the three legs.
- [ ] **Commit:** `The CLIF types reach TypeScript generated from the Rust, as core's and wire's do`.

### Task 4: `'clif'` joins the leg and every table, with a view that says it is loading

Spec §6 *The leg*, *Header and help*. Brief G1, G2, G9, W9. After this task the header has a CLIF toggle and key 5, and
a CLIF view shows *Loading CLIF…* and nothing else; nothing loads the package yet (Task 5).

**Files** (each site from A3 and B4-B7; verify each before editing):
- Types and tables: `web/src/protocol.ts:244` (`Leg`), `:254` (`LegFrame`), `:391-395` (`LEG_FRAME_BYTES`), `:478`
  (`scratch`'s `leg`), `:512-516` (`LegResult`), `:576-589` (`LegStatus`, `LegProgram`); `web/src/legs.ts:33`;
  `web/src/layout.ts:72-113`; `web/src/arrangements.ts:91-94`; `web/src/app-header.ts:352-357`;
  `web/src/lsp-protocol.ts:94` and its readers `transport.ts:441-451`; `web/src/panes.ts:25-41`;
  `web/src/pane-host.ts:147-158`, `:170`, `:478`, `:498`; `web/src/transport.ts:22`, `:236`; `web/src/linked-legs.ts:11`;
  `web/src/results.ts:105-126`; `web/src/readout.ts:60`, `:196`; `web/src/buffer-list.ts:237`; `web/src/examples.ts:39-106`;
  `web/src/main.ts:877-885`, `:2311`; `web/src/session-worker.ts:210`, `:328`, `:424`, `:631`, `:706-708` and
  `copy-build.ts:36-57`; `web/src/record-loop.ts:181-190`; `web/src/replies.ts:198`.
- Create: `web/src/clif-pane.ts` (the placeholder `ClifPane`).
- Copy: `web/help.html:36`, `:40-44`, `:91-99`, `:116`. Tests: Step 1's list.

**Interfaces** (produces; `protocol.ts` unless named):

```ts
export type Leg = 'lambda' | 'rxm' | 'tm' | 'clif'
/** Every leg but CLIF: the legs a compile records at once and a copy can hold. CLIF records only while shown. */
export type CopyLeg = Exclude<Leg, 'clif'>
/** A CLIF listing, by the name `ClifSession`'s constructor takes. */
export type Listing = 'as-built' | 'optimised'
export type LegFrame = { lambda: LambdaState; rxm: RxmState; tm: TmState; clif: ClifState }
/** What a CLIF view is handed: the listing, or why there is none. `null` while it is being built. */
export type ClifCompiled = { readonly listing: ClifListing } | { readonly error: string }
// LegStatus.clif: RxmStatus; LegResult.clif: RxmLeg; LegProgram.clif: ClifCompiled (compiled carries null)
/** The CLIF part of a `result` while no stepper is built: unavailable, no reason, nothing run. */
export const CLIF_ABSENT: RxmLeg
export const CLIF_WINDOW: ClifWindow = { values: 64, frames: 8, cells: 16, boxes: 16 } // RXM_WINDOW's numbers
/** rxm's charge: each value's word, each call-stack entry, both halves of each cell, each box's content (W11). */
export function clifFrameBytes(f: ClifState): number // LEG_FRAME_BYTES.clif
// legs.ts
export const COPY_LEGS: readonly CopyLeg[] // LEGS without 'clif', in LEGS' order
```

- `LEG_NAME.clif = 'CLIF'` (last, so `LEGS` ends with it); `KIND_WORD.clif = 'CLIF'`; `KIND_ORDER` and `HEADER_ORDER` end
  with `clif`; `DEFAULT_LEAF.clif = 'clif-0'`; `LANGUAGE_OF_PANE` becomes `Record<PaneKind, LanguageId | null>` with
  `clif: null`; `legOfPane` gains `'clif'`; `LEG_PANELS.clif = ['listing', 'values', 'stack', 'heap']`; `holdsEditor('clif')`
  is `false`; `programFork`'s `clif` arm is `{}` (no *edit a copy*); `HISTORY_FULL_ROW.clif = true`; `main.ts`'s legs gain
  `clif: freshLeg('clif', HISTORY_BYTES, …)` and programs `clif: null`; `copyHolds` gains `case 'clif': return false`.
- `CopyLeg` narrows, rather than gaining dummy entries (W9): `ScratchOf`, `BUILD`, the `scratch` request's `leg` and
  `onScratch`, `Occupant`/`liveHandle`'s copy arm, `NO_TEXT`, `COPY_FACTS`, `EDITOR_ON_LEAVE`, `BLANK_COPY`.
- `recordBuild`'s legs are typed `{ readonly [K in CopyLeg]: RecordLeg<K, H[K]> }` and it walks `COPY_LEGS`, so the
  CLIF entry cannot reach it; `FirstFrames.clif` is `null`, since a build's reply comes before any CLIF stepper.
- `LinkedLeg = Exclude<Leg, 'lambda' | 'clif'>` until Task 11.
- `CYCLE` (G2): `HEADER_ORDER.filter((k) => k !== 'source' && k !== 'clif')` pairs, then `KIND_ORDER` without `clif`; the
  doc comment says why (a cycle key rearranges the views on screen and must not fetch the CLIF package).
- `results.ts`: `ROWS.clif = clifRows`: rxm's rows with `leg: 'clif'` and the unit `instruction`, and none while
  `status.available` is false (D2). `rxmRows`' body is shared, not copied.
- `examples.ts`: `outcomes.clif = 'ended'` for every example (P3).
- Worker (stub until Task 5): `RECORDINGS.clif`'s `handle` answers `null`; `PART.clif` is `() => CLIF_ABSENT`;
  `compiled.statuses.clif` is `CLIF_ABSENT.status`.
- `ClifPane extends MachineViewChrome`, constructed `(host, on, panels, sizes)` as `RxmPane` is (Task 9 has the types), its header word `CLIF`, its body one `p.clif-notice` reading `Loading CLIF…`.
- Copy (all **DRAFT** but the keys row, which `VIEW_KEYS` fixes):
  - `KIND_GLOSS.clif`: `"Cranelift's IR: what the native backends build from the rxm program"`.
  - `help.html:36`: *Click a token in the source, a λ token, an rxm or CLIF instruction or a machine rule, and the other
    views show the same point of the program.*
  - `help.html:40-44`: the list becomes *…: **source**, **λ**, **TM**, **rxm** and **CLIF**.* and after *…or LLVM output.*
    comes: *The CLIF view shows Cranelift's IR: what the native backends build from the rxm program, stepped one CLIF
    instruction at a time by the rules the compiled program runs by. Its **as built** and **optimised** buttons switch
    between redextape's lowering before Cranelift's passes and Cranelift's output at every opt level from O1 up, the same
    for every target. Its step cap counts loop iterations, as the compiled program's does, not instructions.*
  - The keys table gains `<tr data-key="5"><td><kbd>5</kbd></td><td>show or hide CLIF</td></tr>`; the cycle sentence
    (`:98-99`) is unchanged (G2).
  - `help.html:116`: *the machine's rules, the rxm and CLIF listings*.

- [ ] **Step 1: Failing tests.**
  - `tests/node/app-header.test.ts`: the pinned sentence becomes `"<strong>TM</strong>, <strong>rxm</strong> and
    <strong>CLIF</strong>. The rxm view shows …"` (the rest as it is); a new case `'holds each clause of the CLIF tooltip’s
    gloss'` as rxm's (`KIND_GLOSS.clif` split on `': '`, each clause in the page).
  - `tests/node/pages.test.ts:141-157`: a stop reads `all ${countWord[stop.length]}` when it is `CYCLE.at(-1)`, not when
    its length is `KIND_ORDER.length`; `countWord` stays `{ 4: 'four' }`; the keys-table case is unchanged and fails until
    the row exists.
  - `tests/node/view-keys.test.ts:49-52` gains the spelled-out `5` line.
  - `tests/node/protocol.test.ts`: `clifFrameBytes` of the `FACT2 frame` JSON (`$R/plan-facts/facts.out`, pasted as a
    fixture) is `792`, and of P4's `fact.rxt` step-95 frame `1156`.
  - `tests/node/results.test.ts`: `clifRows(CLIF_ABSENT)` is `[]`; a part with `status: { available: true, reason: '',
    run: 'Ended', cap: null, total_steps: 189 }` and `value: { Value: { text: '24' } }` gives the rows rxm's would, with
    `leg: 'clif'` (`189 instructions`, `24`).
  - `tests/browser/view-keys.test.ts`: `'toggles CLIF on 5'` beside `:189-200`, from `fourViews()`: armed then `5` shows a
    view whose header reads `CLIF`; `5` again hides it.
  - `tests/browser/clif-header.test.ts` (new): **at 1280 × 800 in the Debugger preset the five toggles sit on one row**:
    every `#views-shown button.view-toggle`'s `getBoundingClientRect().top` within 1 px of the first's, and the header's
    height equal to its height with the CLIF toggle set `display: none`. If it fails, **stop and report**: the fix is a
    layout decision for the user (`style.css:257-258`).
  - The rest of B7's list is updated to the new truth, never loosened: `arrangements.test.ts:54` and `:497-500`
    (`HEADER_ORDER` gains `clif`; `FOUR` names its four kinds), `layout.test.ts:68-91` and `:151-159` and
    `share-link.test.ts:355-358` (`defaultArrangement` called with the four kinds their literals were written for),
    `first-load-views.test.ts:129-139` (five shadows), `examples.test.ts:94-103` (checks `COPY_LEGS` until Task 5, which
    shows CLIF and restores `LEGS`).
- [ ] **Step 2: Run** `NODE app-header`, `NODE pages`, `NODE view-keys`, `NODE results`, `NODE protocol`. Expected: FAIL
  (no `clif` kind).
- [ ] **Step 3: Implement** as Interfaces says; `TSC` lists every table left.
- [ ] **Step 4: Run** `TSC`, `LINT`, `cd $W/web && pnpm exec vitest run --project node` (the node tier), then `BROWSER`
  `view-keys`, `view-toggles`, `view-toggles-first-paint`, `view-toggle-focus-ring`, `view-toggle-tooltips`,
  `first-load-views`, `terminal-header-gap`, `header-menus-narrow`, `examples`, `clif-header`, `app`. Expected: PASS.
- [ ] **Step 5: Sabotage.**

| Edit | Must fail |
|---|---|
| `CYCLE` keeps `clif` | `tests/browser/view-keys.test.ts:157-170` (`[` `[` lands on all five) and `pages.test.ts`'s cycle case |
| `KIND_GLOSS.clif`'s second clause reworded | `'holds each clause of the CLIF tooltip’s gloss'` |
| `clifRows` prints rxm's *declined* row for `CLIF_ABSENT` | `results.test.ts`'s `[]` case |
| help's key-5 row removed | `pages.test.ts` `'lists exactly the keys…'` |
| `clifFrameBytes` leaves out `frames` | `protocol.test.ts` (1156 becomes 948) |

- [ ] **Commit:** `The header gains a CLIF toggle and key 5, the help names five views, and a CLIF view says it is loading;
  the layout cycle, the default grid and stored workspaces stay as they were`.

### Task 5: The session worker records the CLIF leg after a run that shows a CLIF view

Spec §6 *Loading*, *One occupant*, *Recording while shown*. Brief L1, L2, L4, W2, W4-W6, W8, W10, W11. Worker-level: the
page posts none of this until Task 7.

**Files:**
- Create: `web/src/clif-loader.ts`, `web/tests/node/clif-loader.test.ts`, `web/tests/browser/clif-worker.test.ts`.
- Modify: `web/src/protocol.ts:462-497` (requests), `:640-830` (replies), `:391-395`; `web/src/record-loop.ts` (after
  `rewindAndRecord`, `:232-251`); `web/src/session-worker.ts:13-20` (module doc), `:85-130` (`Session` gains `clifInput():
  unknown`), `:280-284`, `:328`, `:335-372`, `:424`, `:522-612`, `:831-861`; `web/src/copy-build.ts:21-27` (doc);
  `web/vite.config.ts:187-200` (`COMMANDS`) and the `BrowserCommands` declaration beside `mouse`'s;
  `tests/node/protocol.test.ts`, `tests/node/record-loop.test.ts`, `tests/browser/frame-cost.test.ts`,
  `tests/browser/examples.test.ts`, and the five test files that post `kind: 'run'` (`rg -l "kind: 'run'" web/tests`) gain
  `clif: null`.

**Interfaces** (produces):

```ts
// protocol.ts
type RunRequest =
  | { kind: 'run'; gen: number; src: string; encoding: string; width?: number; clif: Listing | null } // null: no CLIF view
  // …the rest as they are
type RunReply =
  | { kind: 'clif-load'; state: 'ready' | 'failed'; error?: string }
  | { kind: 'clif-listing'; gen: number; epoch: number; listing: ClifListing | null; error: string | null }
  // …the rest as they are
/** The CLIF status `compiled` carries: available when the rxm leg is and a CLIF view is shown; rxm's reason otherwise. */
export function clifCompileStatus(rxm: RxmStatus, listing: Listing | null): RxmStatus
/** A built stepper's part of a `result`: its status with `available: true`, and its value. */
export function clifPart(status: ClifStatus, value: Decoded): RxmLeg
// record-loop.ts
/** A leg whose handle was just built, recorded from step 0 under `epoch`; returns at once unless `epoch` is the leg's. */
export async function recordFresh<K extends Leg, H>(leg: RecordLeg<K, H>, worker: RecordWorker, gen: number, epoch: number): Promise<void>
// clif-loader.ts
export type ClifHandle = { listing(): ClifListing; status(): ClifStatus; step(): boolean; state(w: ClifWindow): ClifState
  value(): Decoded; rewind(): void; raiseCap(extra: number): void; free(): void }
export type ClifModule = { readonly ClifSession: new (input: unknown, listing: Listing) => ClifHandle }
/** One load at a time, kept once it succeeds; a failure is forgotten, so the next call loads again. */
export function clifLoader(load: () => Promise<ClifModule>): () => Promise<ClifModule>
```

- **The worker.** `const loadClif = clifLoader(async () => …)` over the literal `import('../../pkg-clif/redextape_clif_wasm.js')`
  then its default `init()` (the probe's `loadClif`). The `Live` session arm gains `clif: { session: ClifHandle; listing:
  Listing } | null` (W8); `dropLive` frees it after the session, nulled before freed, in its own `try`, as the TM copy's
  value run; a `dropClif()` does the same for the field alone. `PART` takes the session arm (`Extract<Live, { kind:
  'session' }>`) and `PART.clif` is `CLIF_ABSENT` or `clifPart(...)`. `RECORDINGS.clif`: A3's entry, `handle` reading
  `live.clif` for `gen`, `available: () => true`, `raise: (s) => s.raiseCap(EXTEND_STEPS)` (100,000 ticks, W10).
- **The CLIF pass**, `recordClif(gen, epoch, listing)`: load (post `clif-load` `ready`, or `failed` with `String(e)` and
  return; never `worker-error`); **after every await, return unless `live` is still `gen`'s session and
  `worker.epoch.clif === epoch`**; `clifInput()` `null` posts `clif-listing` with `error: rxmStatus().reason`; the
  constructor in a `try` (a throw posts `clif-listing` with `error: String(e)`, Task 2's sentence); else set `live.clif`,
  post `clif-listing` with `listing()`, `await recordFresh(RECORDINGS.clif, worker, gen, epoch)`, then `postResult`.
- **`onRun`**: `compiled.statuses.clif = clifCompileStatus(rxm, req.clif)`, `programs.clif = null`; everything else as
  today; after `postResult`, `if (req.clif !== null) await recordClif(req.gen, 0, req.clif)` (W4).
- **Docs.** The module doc and `claimLive`'s state the rule: one session or one copy, plus, for a session, at most one CLIF
  stepper built from it and dropped with it; copy workers never load the package.
- **Commands** (`vite.config.ts` `COMMANDS`, so both engines have them): `watchRequests(op: 'start' | 'read', match:
  string)` as `$R/probe.diff` has it (its `page` and `context` lists), and `failRequests(match: string, times: number)`:
  `page.context().route((url) => url.href.includes(match), (r) => r.abort(), { times })`.

- [ ] **Step 1: Failing tests.**
  - `clif-loader.test.ts`: `'loads once for two calls'` (`load` called once, both calls resolve to one module);
    `'shares one load between calls made while it is pending'`; `'forgets a failure, so the next call loads again'`
    (first `load` rejects, second resolves; `load` called twice).
  - `protocol.test.ts`: `clifCompileStatus` of an available rxm status and `'as-built'` is
    `{ available: true, reason: '', run: null, cap: null, total_steps: null }`, with `null` `available: false`, of a declined
    one (reason `R`) `available: false, reason: R`.
  - `record-loop.test.ts`, `recordFresh`: with `epoch` below the leg's it steps nothing and posts nothing; at the leg's it
    resets `recorded` to the step-0 frame's bytes and `allowance` to `HISTORY_BYTES`, and its first chunk's first frame is
    step 0.
  - `clif-worker.test.ts` (a session worker made as `worker.test.ts` makes one; `fact.rxt`; `binary`):
    1. `'records nothing and loads nothing for a run with no CLIF view'`: `watchRequests('start', 'redextape_clif_wasm')`
       first; `run` with `clif: null`; once λ, rxm and TM have `done` and `result` has come: no `clif-load`,
       `clif-listing` or `leg: 'clif'` `frames`; `statuses.clif.available === false`; `first.clif === null`; the watch's
       `page` and `context` lists `[]`.
    2. `'records the CLIF leg after the result, from step 0'`: `clif: 'as-built'`: `statuses.clif.available`; the first
       `result` comes before the first `clif-listing`; that listing has 187 rows; the CLIF frames run 0 to 189 without a
       gap, the last chunk `done: 'ended'`; a `result` after it has `legs.clif` `{ status: { available: true, reason: '',
       run: 'Ended', cap: null, total_steps: 189 }, value: { Value: { text: '24' } } }`.
    3. `'leaves the other legs' frames as they were'`: two workers, `clif: null` and `'as-built'`: λ's, rxm's and TM's
       frames, every chunk in order, `toEqual` across the two.
    4. `'says why a program has no CLIF, and the other legs run'`: the 2,048-element list of `clif-package.test.ts`:
       `clif-listing` `{ listing: null, error: statuses.rxm.reason }` (non-empty); no `worker-error`; λ ends.
    5. `'reports a failed load and leaves the other legs running'` (L4, both engines): `failRequests('redextape_clif_wasm',
       1)` first; `clif: 'as-built'`: `clif-load` `failed` with a non-empty `error`; λ, rxm and TM end; no `worker-error`.
       **If the load succeeds (routing did not reach the worker's request), stop and report NEEDS_CONTEXT.**
    6. `'a recompile while the CLIF pass loads leaves nothing of the old generation'` (Review Focus 2): `run` gen 1 and,
       before its `result`, gen 2, both `'as-built'`: no `frames` of `leg: 'clif', gen: 1` after gen 2's `compiled`; gen 2's
       CLIF frames reach `done`.
  - `frame-cost.test.ts`, `'clif frame cost'` (Review Focus 4), shaped as its rxm case and Chromium-only as that file is:
    every CLIF frame of `map30000`'s first fill kept against the same frames emptied; retained bytes per frame at or under
    `clifFrameBytes`'s mean charge. **If it fails, stop and report**: the charge is a ruling (W11).
  - `examples.test.ts` posts `clif: 'as-built'` and checks every leg of `LEGS` again.
- [ ] **Step 2: Run** `NODE clif-loader`, `NODE protocol`, `NODE record-loop`, `BROWSER clif-worker`. Expected: FAIL to
  compile or fail (no loader, no CLIF pass).
- [ ] **Step 3: Implement** as Interfaces says.
- [ ] **Step 4: Run** the four, `BROWSER frame-cost`, `BROWSER examples`, `BROWSER worker`, `BROWSER restart-rewind`,
  `FIREFOX clif-worker`, `TSC`, `LINT`, `NODE licences-scan`. Expected: PASS.
- [ ] **Step 5: Sabotage.**

| Edit | Must fail |
|---|---|
| `void loadClif()` at the worker's top level (P2's) | test 1's watch lists |
| `onRun` runs the CLIF pass before `postResult` | test 2's order |
| the CLIF pass posts no `result` | test 2's last `result` |
| `PART.clif` always `CLIF_ABSENT` | test 2's `legs.clif` |
| a failed load posted as `worker-error` | test 5 |
| the checks after the load removed | test 6 |
| `clifLoader` keeps a rejected promise | `'forgets a failure…'` |
| `recordFresh` skips its epoch check | `record-loop.test.ts` |

  The constructor's `catch` has no λ program to reach it (every corpus program builds, Verified facts); Task 2's
  thrown-text test and review cover it. Say so in the report.
- [ ] **Commit:** `The session worker loads the CLIF package for a run that shows a CLIF view, builds a stepper once the
  other legs have posted their result, records it under its own epoch, and drops it with the session`.

### Task 6: The worker rebuilds or drops the CLIF stepper on request, and loads on intent

Spec §6 *Loading*, *Recording while shown*, *The switch* (re-records the CLIF leg alone). Brief L1, L2, L4, W2, W8.

**Files:** Modify `web/src/protocol.ts:462-497`; `web/src/session-worker.ts:831-861` (two arms) and `dropLive`'s
neighbourhood (`dropClif`); test `web/tests/browser/clif-worker.test.ts`.

**Interfaces** (produces):

```ts
type RunRequest =
  | { kind: 'clif-load' } // intent: load, record nothing
  | { kind: 'clif'; gen: number; epoch: number; listing: Listing | null } // rebuild and record from step 0, or drop
  // …the rest as Task 5 left them
```

- `clif`: returns unless `live` is `req.gen`'s session and `req.epoch > worker.epoch.clif`; sets the epoch, clears
  `recording.clif`, `dropClif()` (`live.clif` nulled, then freed in its own `try`); a `null` listing ends there, with no
  reply; else `recordClif(req.gen, req.epoch, req.listing)` (Task 5). `clif-load`: `loadClif()`, then its `clif-load` reply.

- [ ] **Step 1: Failing tests** in `clif-worker.test.ts`:
  1. `'rebuilds the listing and records again under the request's epoch'`: after Task 5's test 2, `{ kind: 'clif', gen: 1,
     epoch: 1, listing: 'optimised' }`: a `clif-listing` of epoch 1 with 155 rows, epoch-1 frames 0 to 131 `done:
     'ended'`, and no epoch-0 frame after that `clif-listing`.
  2. `'ignores a request of an epoch already taken'`: the same request twice: one `clif-listing`.
  3. `'drops the stepper for a request with no listing'`: `loop1000000` (`measure::CORPUS`'s source) with `'as-built'`;
     after its first CLIF chunk, `{ kind: 'clif', gen: 1, epoch: 1, listing: null }` then `{ kind: 'extend', gen: 1, leg:
     'clif', epoch: 1 }`: no epoch-1 frame within 1 s, at most one epoch-0 chunk after the request.
  4. `'loads on intent and records nothing'`: a fresh worker, `{ kind: 'clif-load' }` before any `run`: `clif-load`
     `ready`; the watch's `page` list non-empty; no `frames`.
  5. `'loads on the next ask after a failed load'` (L4, both engines): Task 5's test 5, then `{ kind: 'clif', gen: 1, epoch:
     1, listing: 'as-built' }`: `clif-load` `ready` and a 187-row `clif-listing`. **If it fails again (the engine keeps
     the failed import), stop and report NEEDS_CONTEXT**; no URL tricks.
- [ ] **Step 2: Run** `BROWSER clif-worker`. Expected: the five fail (no such requests).
- [ ] **Step 3: Implement** as Interfaces says.
- [ ] **Step 4: Run** `BROWSER clif-worker`, `FIREFOX clif-worker`, `TSC`, `LINT`. Expected: PASS.
- [ ] **Step 5: Sabotage.**

| Edit | Must fail |
|---|---|
| `clif` skips `dropClif()` | test 3 (the extend records) |
| the epoch check is `>=` | test 2 |
| `clif` rebuilds without raising `worker.epoch.clif` | test 1 (an epoch-0 frame after the new listing) |
| `clifLoader` keeps a rejected promise | test 5 |

- [ ] **Commit:** `The session worker rebuilds the CLIF stepper for another listing or a newly shown view, drops it for a
  hidden one, and loads the package on intent without recording`.

### Task 7: The page says when a CLIF view is shown, and fetches on intent

Spec §6 *Loading*, *Recording while shown*; §8 *No fetch without intent*, *Recording*. Brief L3, L5, W1, W2.

**Files:**
- Create: `web/src/clif-sync.ts`, `web/src/clif-intent.ts`, `web/tests/node/clif-sync.test.ts`,
  `web/tests/browser/clif-fetch.test.ts`, `web/tests/browser/clif-shown.test.ts`.
- Modify: `web/src/session-client.ts:91-130`; `web/src/compile.ts:60-90` (its deps gain `clif(): Listing | null`, read at
  post as `width` is, and the sync's `ran`, told what each run carried); `web/src/replies.ts` (`onReply`: `clif-load`, `clif-listing`, and `sync.settled()` after
  `compiled` and `no-session`); `web/src/main.ts` (near `:726-729`, `:1426`, `:1733`); `web/src/pane-chrome.ts:177-201`.

**Interfaces** (produces):

```ts
// clif-sync.ts
/** What the session worker has been told about the CLIF leg for this generation, and when to tell it again. */
export class ClifSync {
  constructor(post: (listing: Listing | null) => void)
  ran(listing: Listing | null): void // a run carrying `listing` was posted: nothing is posted until its reply
  settled(): void // its `compiled` or `no-session` came: posts what is wanted if the run carried something else
  want(listing: Listing | null): void // posts when it differs from what was sent and no run is awaited
  retry(): void // posts what is wanted again (Retry); nothing while a run is awaited or nothing is wanted
}
// clif-intent.ts
export const INTENT_MS = 150
/** `fetch` once the pointer has rested on `el` for `INTENT_MS`, or at once when `el` takes focus. */
export function watchIntent(el: HTMLElement, fetch: () => void): void
// protocol.ts
export type ClifLoad = 'idle' | 'loading' | 'ready' | 'failed'
// session-client.ts
request(gen: number, src: string, encoding: string, width: number | null, clif: Listing | null): void
clifLoad(): void // { kind: 'clif-load' }
clif(listing: Listing | null, epoch: number): void // { kind: 'clif', gen: this.gen, epoch, listing }; never before a build
// pane-chrome.ts, PaneEvents
clifLoad?: { state(): ClifLoad; retry(): void } // Task 9's pane reads it
```

- `main.ts`: `let clifListing: Listing = 'as-built'` (Task 10 stores it); `clifWanted = () =>
  combinationOf(tree).includes('clif') ? clifListing : null` (W1); `let clifLoadState: ClifLoad = 'idle'`. The sync's
  `post`: `rewindLeg` on the program session's CLIF leg (a new epoch and an emptied ring: a hidden CLIF view keeps no
  history), `programs.clif = null`, `client.clif(listing, epoch)`, `clifLoadState = 'loading'` when `listing` is set and the
  state is not `ready`, then `draw()`. `sync.want(clifWanted())` runs after every layout apply (pane-host's `applied`).
  After `viewToggles`, the CLIF toggle gets `watchIntent`, whose `fetch` posts `clifLoad()` only from `idle` or `failed`.
- `replies.ts`: `clif-load` sets `clifLoadState`; a `clif-listing` of the current generation and the CLIF leg's epoch sets
  `programs.clif` to `{ listing }` or `{ error }` (an error also sets the leg's status `{ available: false, reason: error
  }`), tells the CLIF views (`TELL`), and draws; one of another epoch is dropped.

- [ ] **Step 1: Failing tests.**
  `clif-sync.test.ts` (posts collected by the callback): `ran(null); want('as-built')` posts nothing and `settled()` then
  posts `'as-built'`; `ran(null); settled(); want('as-built'); want('as-built'); want(null)` posts `['as-built', null]`;
  `ran('as-built'); want('as-built'); settled()` posts nothing; `ran(null); settled(); want('as-built'); retry();
  want(null); retry()` posts `['as-built', 'as-built', null]`.
  `clif-fetch.test.ts` (L5; `watchRequests('start', 'redextape_clif_wasm')` before `main()`; each case reads the `page`
  list):
  1. `'fetches nothing for the default workspace'`: `resetToFirstLoad`, mount, first compile settled, 1 s more: `[]`.
  2. `'fetches once the pointer rests on the CLIF toggle'`: four views, `userEvent.hover(toggle)`, 400 ms: non-empty.
  3. `'fetches nothing for a pointer passing over it'`: hover, then at once hover the λ toggle; 400 ms: `[]`.
  4. `'fetches when the toggle takes focus'`: Tab to it (`userEvent.tab` until it is `document.activeElement`): non-empty
     within 100 ms.
  5. `'fetches at start for a stored workspace showing CLIF'`: a stored workspace with a `clif-0` leaf: the first `run`
     the session worker hears carries `clif: 'as-built'` (a `Worker` proxy, as `restart-rewind.test.ts:208-226` installs),
     and the list is non-empty once the first compile has settled.
  `clif-shown.test.ts` (the same proxy):
  1. `'key 5 records the CLIF leg from step 0, and hiding it drops its history'`: four views, the view keys then `5`: a
     `clif` request with `'as-built'` and epoch `e`, then CLIF frames of epoch `e` from step 0; `✕` on the CLIF view: a
     `clif` request with `null` and an epoch above `e`; `5` again: a third request, epoch higher again, and its frames from
     step 0.
  2. `'a CLIF view shown while a run is in flight records for that run'` (Review Focus 1): type a character into the
     source, then the view keys and `5` within 100 ms: no `clif` request is heard before that run's `compiled`, and CLIF
     frames of that generation arrive.
  3. `'+ view's CLIF item shows and records it'`: a `clif` request then frames.
- [ ] **Step 2: Run** `NODE clif-sync`, `BROWSER clif-fetch`, `BROWSER clif-shown`. Expected: FAIL (no module, nothing posted).
- [ ] **Step 3: Implement** as Interfaces says.
- [ ] **Step 4: Run** the three, `FIREFOX clif-fetch`, `BROWSER first-load`, `BROWSER workspace-restore`, `BROWSER
  view-keys`, `TSC`, `LINT`. Expected: PASS.
- [ ] **Step 5: Sabotage** (each against its own case, as P2 did):

| Edit | Must fail |
|---|---|
| `void loadClif()` at the worker's top level | `clif-fetch` 1 (Chromium and Firefox) |
| `INTENT_MS` 0 (fetch on `pointerenter`) | `clif-fetch` 3 |
| no `focus` listener | `clif-fetch` 4 |
| `compile.ts` posts `clif: null` always | `clif-fetch` 5's `run` assertion |
| `want` posts while a run is awaited | `clif-sync` 1 and `clif-shown` 2 |
| the sync's `post` skips `rewindLeg` | `clif-shown` 1 (the second epoch is not above the first) |

- [ ] **Commit:** `The page tells the session worker whether a CLIF view is shown, drops a hidden CLIF view's history, and
  fetches the CLIF package when the pointer rests on its toggle or the toggle takes focus`.

### Task 8: The CLIF view's builders, pure and node-tested

Spec §4 *Listing*, *Values*, *Call stack*, *Heap*; §6 *The pane*. Brief G4, G5's copy.

**Files:** Modify `web/src/machine-panels.ts:19-29` (`ValuesView` rows gain `readonly regs?: readonly string[]`). Create
`web/src/clif-view.ts`, `web/tests/node/clif-view.test.ts` (loads the real `pkg/` and `pkg-clif/` as
`clif-package.test.ts` does). Reads `rxm-view.ts`'s `wordText`, `frames` and `rxmHeap`'s line shapes.

**Interfaces** (produces):

```ts
export type ClifRows = {
  /** `ListingPanel.setSource`'s input: each Inst row's text, and every other row as a label named by its row index. */
  readonly source: { readonly listing: readonly string[]; readonly labels: Labels }
  /** The listing row of each instruction ordinal. */
  readonly rowOf: readonly number[]
  ordinalOf(at: ClifAt): number | null
  ordinalsOfPc(pc: number): readonly number[]
}
export function clifRows(l: ClifListing): ClifRows // built once per listing
export function pcColumn(pc: number | null): string // 'pc13'; '' for a row with no srcloc
export function clifValues(s: ClifState): ValuesView
export function clifStack(s: ClifState, l: ClifListing): StackView
export function clifHeap(s: ClifState): HeapView
export const CLIF_COPY = {
  loading: 'Loading CLIF…',
  failed: 'CLIF could not be loaded.',
  retry: 'Retry',
  declined: (why: string): string => `No CLIF for this program: ${why}`,
} as const
export type ClifNotice = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'declined'; readonly text: string }
/** What the listing area says instead of the listing, or `null` when it shows the listing. */
export function clifNotice(load: ClifLoad, program: ClifCompiled | null): ClifNotice | null
```

- Labels are placed by `placeLabels`' rule (B2): a non-Inst row sits before the Inst row after it; trailing rows at the
  count. `clifValues`: a row per value, `name` `v<value>`, `text` `wordText(word)`, `regs` the value's registers (an
  optional field this task adds to `ValuesView` rows; Task 9 draws it), not changed, not unwritten, nothing said; a `+N more` note when
  `values_len` exceeds the window, worded as rxm's. `clifStack`: `count` rxm's `frames(depth)`; each frame top first,
  `callee` `<name> <label>` from `l.functions` (`u0:12 fact.0`), `ret` the `pcColumn` of the Inst row it stands at (a
  caller's is its call), `saved` `''`. `clifHeap`: `rxmHeap`'s lines and notes, refs being the names of the values whose
  list or box word names the cell or box; lift the shared line builder out of `rxm-view.ts` only if rxm's output does not
  change. `clifNotice`: a listing gives `null`; an error `declined`; a failed load `failed`; anything else `loading`.

- [ ] **Step 1: Failing tests** (fixtures from Verified facts):
  - `clifRows` of `fact.rxt` as built: `source.listing.length` 59, `source.labels.length` 128; for every ordinal `i`,
    `l.rows[rowOf[i]].kind === 'Inst'` and `ordinalOf(l.rows[rowOf[i]].at) === i`; `ordinalsOfPc(13).length` 5 and
    `ordinalsOfPc(4).length` 3 (optimised: 5 and 2); the label `'0'` (the `Function` row) at ordinal 0 and the last label
    (the closing `}`) at ordinal 59.
  - `pcColumn(13)` is `'pc13'`, `pcColumn(null)` `''`.
  - `clifValues` of P4's step-95 frame: 17 rows; `rows[1]` `{ name: 'v1', text: '2', regs: ['a0'] }` (with the flags);
    `rows[0].regs` `[]`; no notes.
  - `clifStack` of that frame with the as-built listing: `frames.map((f) => f.callee)` is `['u0:12 fact.0', 'u0:12 fact.0',
    'u0:12 fact.0', 'u0:11 $main']` and `count` is `frames(4)`.
  - `clifHeap` of the `FACT2 frame`: four cell lines then one box line, in the frame's order; cell 4's `refs` `['v1']`.
  - `clifNotice`: `('ready', { listing })` `null`; `('ready', { error: 'x' })` `{ kind: 'declined', text: 'x' }`;
    `('failed', null)` `{ kind: 'failed' }`; `('loading', null)` and `('ready', null)` `{ kind: 'loading' }`;
    `('failed', { listing })` `null`; `CLIF_COPY.declined('x')` is `'No CLIF for this program: x'`.
- [ ] **Step 2: Run** `NODE clif-view`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** as Interfaces says.
- [ ] **Step 4: Run** `NODE clif-view`, `NODE rxm-view`, `TSC`, `LINT`. Expected: PASS.
- [ ] **Step 5: Sabotage.**

| Edit | Must fail |
|---|---|
| a label placed at the ordinal before its next Inst row | the label-placement assertions |
| `ordinalOf` keyed by `inst` alone (functions collide) | the round trip over every ordinal |
| `clifStack` names the function without its label | the callee list |
| `clifHeap` refs read from frames, not values | cell 4's refs |
| `clifNotice` checks the load before the listing | the `('failed', { listing })` case |

- [ ] **Commit:** `The CLIF view's rows, values, call stack, heap and notices are built by pure functions`.

### Task 9: The CLIF view draws the listing, the machine and its loading

Spec §4 (the listing, panels, end, loading and failure, menu); §6 *The pane*. Brief G4, G5.

**Files:** Modify `web/src/clif-pane.ts` (Task 4's placeholder), `web/src/listing-panel.ts:30-61`, `:109-140`,
`web/src/machine-panels.ts:50-80`, `web/src/pane-host.ts:478` (`SEED.clif`), `web/src/replies.ts:198` (`TELL`),
`web/src/style.css` (beside `.rxm-row`'s rules, `:1775-1865`, `:3006-3026`). Create `web/tests/browser/clif-pane.test.ts`,
`web/tests/browser/clif-app.test.ts`.

**Interfaces** (produces):

```ts
// listing-panel.ts, a constructor option
fillLabel?(name: string, cell: HTMLElement): void // absent: drawn `name:`, as the rxm view's labels are
// machine-panels.ts: Task 8's ValuesView field `regs` is drawn after the value in a `span.value-regs`; rxm rows leave it unset
// clif-pane.ts
export class ClifPane extends MachineViewChrome implements PaneView<ClifState> {
  constructor(host: HTMLElement, on: PaneEvents, panels: Partial<Record<'listing' | 'values' | 'stack' | 'heap', boolean>>,
    sizes: ConstructorParameters<typeof RxmPane>[3])
  setProgram(p: ClifCompiled | null): void
  setLink(pcs: number[], scrollTo: boolean): void // rxm pcs: marks every Inst row whose srcloc is one (Task 11 calls it)
  setFocus(pcs: number[]): void
  render(frame: ClifState | null, controls: Parameters<RxmPane['render']>[1]): void
}
```

- `ListingPanel` as `RxmPane` builds it (`rxm-pane.ts:92-103`) with `clif-listing`, `clif-spacer`, `clif-rows`,
  `clif-row`, `clif-cell` and a `clif-grid-<n>` prefix; `fillInstr` draws the `pcColumn` in rxm's `.rxm-pc` column, then
  the row's indent less the pc column, then its text; `fillLabel` draws the row's indent and text with a class per kind
  (`is-function`, `is-decl`, `is-blank`, `is-block`, `is-alias`, `is-close`); `activate(ordinal)` calls
  `on.linkInstr?.(pc)` with the Inst row's srcloc or `null`. Panels `values`, `stack` (`call stack`), `heap` as rxm's;
  a `PanelStack` of the listing (share 2), values beside stack (1) and heap (1); no text panel, no outline.
- The notice: a `p.clif-notice` (`role="status"`) at the top of the listing panel's body while `clifNotice` is not `null`,
  with `CLIF_COPY`'s words; the failure's `button.clif-retry` (`Retry`) follows its sentence and calls
  `on.clifLoad?.retry()`. End line, `[continue]` and pause come from `MachineViewChrome`'s step controls, as rxm's.
- `SEED.clif` and `TELL.clif` hand `programOf(session, 'clif')` to `setProgram`.

- [ ] **Step 1: Failing tests.**
  - `clif-pane.test.ts` (the pane alone, `fixtureHost` and `paneEvents`, `fact.rxt`'s listing from a real
    `ClifSession`): with `clifLoad.state()` `'loading'` and no program, the notice reads `Loading CLIF…` and is visible
    (a non-zero box inside the listing panel's); `'failed'`: `CLIF could not be loaded.` and a visible `Retry`, whose
    `userEvent.click` calls `retry` once; `{ error: 'x' }`: `No CLIF for this program: x`; `{ listing }`: no notice box,
    and the first row's cell text is exactly `function u0:11(i64) -> i64 system_v {` (no `:` added).
  - `clif-app.test.ts` (four views, then the view keys and `5`; `fact.rxt`):
    1. `'lists the program as built, its pcs in the rxm view's form'`: row 29 (`v1 = iconst.i64 0`) has an empty pc
       column; each of the five rows with srcloc 13 shows `pc13`, its pc column at the same offset from its row's left
       as the rxm view's `.rxm-pc` from its row's (±1 px).
    2. `'steps to step 95 and shows values, call stack and heap'`: stepped there with the step controls: 17 value entries,
       one `dt` `v1` whose `dd` reads `2` followed by `a0`; four call-stack frames, the first `u0:12 fact.0`; the
       `.is-next` row is the frame's `next` (its pc column and text).
    3. `'says the load failed, and loads on Retry'`: `failRequests('redextape_clif_wasm', 1)` before the press: the
       failure sentence and `Retry` visible, the rxm view still steps; `Retry`: the listing appears and the notice goes.
    4. `'says why a program has no CLIF'`: the 2,048-element list: `No CLIF for this program: <the rxm view's reason>`.
    5. `'offers no edit a copy'`: its `⋯` menu holds no *edit a copy* item.
    6. `'keeps recording past a full history'`: `loop1000000`'s source: the step line says the history is full and
       *keep recording* records further (the newest step grows).
- [ ] **Step 2: Run** `BROWSER clif-pane`, `BROWSER clif-app`. Expected: FAIL (placeholder pane).
- [ ] **Step 3: Implement** as Interfaces says.
- [ ] **Step 4: Run** the two, `BROWSER rxm-pane`, `BROWSER rxm-app`, `BROWSER machine-view-chrome`, `FIREFOX clif-app`,
  `TSC`, `LINT`. Expected: PASS; the rxm files unchanged (its labels still `name:`, its values without `regs`).
- [ ] **Step 5: Sabotage.**

| Edit | Must fail |
|---|---|
| `ListingPanel` ignores `fillLabel` | `clif-pane`'s first-row text |
| `regs` not drawn | `clif-app` 2 |
| the notice stays once a listing arrives | `clif-pane`'s `{ listing }` case |
| `Retry` not wired | `clif-app` 3 |
| `show` handed the frame's `at` instead of `next` | `clif-app` 2's `.is-next` (check the two differ at step 95 first) |

- [ ] **Commit:** `The CLIF view lists the program, steps it with its values, call stack and heap, and says when it is
  loading, could not load, or has no CLIF to show`.

### Task 10: The listing switch, stored and linked with the program

Spec §4 *The switch*, §6 *The switch*. Brief G6, G7.

**Files:** Modify `web/src/clif-pane.ts`; `web/src/pane-chrome.ts:177-181` and `web/src/transport.ts:54`, `:267` (as
`fieldWidth`); `web/src/main.ts` (`fieldWidth`'s places: `:699-729`, `:920-924`, `:1253-1263`, `:1931-1938`, `:2002-2007`,
`:2070-2089`, `:2234-2245`); `web/src/program-store.ts:23-64`; `web/src/share-link.ts:25-86`, `:159-185`, `:250-270`;
`web/src/compile.ts` (`persist`). Tests: `tests/node/program-store.test.ts`, `tests/node/share-link.test.ts`, new
`tests/browser/clif-switch.test.ts`.

**Interfaces** (produces):

```ts
// pane-chrome.ts, PaneEvents
clifListing?: { current(): Listing; choose(l: Listing): void }
// program-store.ts
export type StoredProgram = { readonly text: string; readonly encoding: string; readonly width: number | null; readonly listing: Listing }
// share-link.ts: SharePayload gains `listing?: 'optimised'`; OpenedLink gains `listing: Listing` beside `width`
```

- The switch: `radioGroup` (`view-header.ts:307`) with `label: 'listing'`, choices `{ value: 'as-built', label: 'as
  built', hint: () => "redextape's lowering, before Cranelift's passes" }` and `{ value: 'optimised', label: 'optimised',
  hint: () => "Cranelift's output at every opt level from O1 up, the same for every target" }` (the hints are the titles),
  prepended to `header.actions` as the TM width box is, synced on every render.
- `main.ts`: `chooseClifListing(l)` sets `clifListing`, writes the stored program, `sync.want(clifWanted())` (no
  recompile), and draws, so every CLIF view shows the choice. The stored program and a link write `listing` only when
  `'optimised'` (absent is as built, so `PROGRAM_VERSION` and `LINK_VERSION` stay 1, the width's argument); an unknown
  value reads as built, and a link's unknown value also drops `positions.clif`, as an unlisted width drops TM's
  (`share-link.ts:264-268`). Start-up, `replaceProgram` and `sharePayload` carry it where they carry `width`.

- [ ] **Step 1: Failing tests.**
  - `program-store.test.ts`: as built writes no `listing` key; optimised writes `"listing":"optimised"`; reading
    `listing: 'sideways'` or none gives `'as-built'`; `PROGRAM_VERSION` is 1.
  - `share-link.test.ts`: the exact JSON of an optimised link, beside the width cases (`:120-128`, `:306-352`), and none
    for as built; `'the frozen format of a version 1 link'` unchanged and read as built; a payload with `listing:
    'sideways'` and `positions: { clif: 9, rxm: 4 }` opens as built with `positions` `{ rxm: 4 }`.
  - `clif-switch.test.ts` (a CLIF view on `fact.rxt`; the `Worker` proxy):
    1. `'switches the listing without a recompile'`: `userEvent.click` on *optimised*: no `run` heard after it; one
       `clif` request with `'optimised'` and a higher epoch; the view at step 0 with the optimised listing (its first Inst
       row, row 29, reads `jump block1` where as built it reads `v1 = iconst.i64 0`); both buttons' `title`s are the hints; `aria-checked` moves.
    2. `'every CLIF view shows the one choice'`: a second CLIF view (split): its *optimised* is checked too.
    3. `'the choice outlives a reload'`: reload, mount: *optimised* checked, and the first `run` carries `'optimised'`.
    4. `'a switch while recording keeps nothing of the old listing'` (Review Focus 3): `loop1000000`, *optimised* after the
       first CLIF chunk: once the new frames come, the view's `.is-next` row is a row of the optimised listing (106 rows)
       and the step line counts from 0.
- [ ] **Step 2: Run** `NODE program-store`, `NODE share-link`, `BROWSER clif-switch`. Expected: FAIL.
- [ ] **Step 3: Implement** as Interfaces says.
- [ ] **Step 4: Run** the three, `BROWSER field-width`, `BROWSER share-open`, `FIREFOX clif-switch`, `TSC`, `LINT`.
  Expected: PASS.
- [ ] **Step 5: Sabotage.**

| Edit | Must fail |
|---|---|
| `chooseClifListing` calls `compile.schedule` | `clif-switch` 1 (a `run` is heard) |
| as built written as `"listing":"as-built"` | the exact-JSON cases |
| an unknown listing keeps `positions.clif` | the `sideways` case |
| the choice not written to storage | `clif-switch` 3 |
| `pushFrames`' epoch check removed | `clif-switch` 4 |

- [ ] **Commit:** `Each CLIF view's bar switches between the listing as built and optimised, re-recording the CLIF leg
  alone; the choice is stored with the program and carried by a share link`.

### Task 11: CLIF rows link both ways, and the CLIF run has a running focus

Spec §4 *Links*, §6 *Links* (M2's CLIF arms), §8 *Links*. Brief G8.

**Files:** Modify `web/src/linked-legs.ts` (`LinkedLeg` back to `Exclude<Leg, 'lambda'>`; `LINKED.clif`; rxm's `rows`;
`emits` may be `null`; a focus reader), `web/src/link-status.ts:243-247`, `web/src/draw.ts:183-191`, `web/src/clif-pane.ts`
(`setLink`, `setFocus`, `activate`). Tests: `tests/node/linked-legs.test.ts` (`:15`'s literal gains `clif`),
`tests/node/link-wiring.test.ts` (`here` literals gain `clif`), `tests/node/link-status.test.ts`, new
`tests/browser/clif-link.test.ts`.

**Interfaces** (produces; each `LINKED` entry):

```ts
/** The construct the leg's running frame belongs to, or `null`. */
focusNode(frame: LegFrame[K], index: LinkIndex): number | null // rxm, tm: frame.source_node; clif: nodeForInstr(frame.pc)
emits: string | null // null: never named in the absence clause
// clif
rows: (l, pin) => (pin?.pc !== undefined && (pin.origin === 'rxm' || pin.origin === 'clif') ? [pin.pc] : l.instrs) // rxm pcs
click: { event: 'linkInstr', link: (w, pc) => w.linkInstr(pc, 'clif') }
emits: null // §4: an optimiser's merge marks no row and needs no message
here: 'the CLIF run is here right now'
// rxm's rows become
rows: (l, pin) => (pin?.origin === 'clif' && pin.pc !== undefined ? [pin.pc] : l.instrs)
```

- `draw.ts`'s running focus reads `LINKED[leg].focusNode(frame, index)` in place of `source_node`. The CLIF pane maps the
  rxm pcs it is handed to ordinals with `ordinalsOfPc`; `activate` calls `on.linkInstr?.(srcloc ?? null)`. M3 is left
  alone.
- The listings are virtual grids, so a count of marked rows scrolls each row of the listing into view, or reads the
  pane's own marked set; `fact.rxt`'s 187 rows do not fit one window.

- [ ] **Step 1: Failing tests.**
  - `linked-legs.test.ts`: `LINKED.rxm.rows(l, { node: 13, origin: 'clif', pc: 13 })` is `[13]`, with origin `'rxm'` it is
    `l.instrs`; `LINKED.clif.rows` is `[13]` for a pin of origin `'rxm'` or `'clif'` with pc 13, and `l.instrs` for a
    source pin and for `null`.
  - `link-wiring.test.ts`: `linkInstr(OWNED_PC, 'clif')` pins `{ node: NODE, origin: 'clif', pc: OWNED_PC }` (Task 1's
    deferred sabotage fires here).
  - `link-status.test.ts`: a linked state whose `clif.emits` is false adds no clause naming CLIF rows.
  - `clif-link.test.ts` (source, rxm, TM and CLIF views; `fact.rxt` unless named; counts from Verified facts):
    1. `'a CLIF row links its rxm instruction alone'`, both listings: `userEvent.click` on a CLIF row with srcloc 13: the
       rxm view has one `.rxm-row.is-linked` (pc 13; the construct owns 12, 13 and 14); the CLIF view five
       `.clif-row.is-linked`; the source a link mark.
    2. `'an rxm instruction marks its own CLIF rows'`: rxm row pc 13: five CLIF rows (not the construct's seven); rxm row pc
       4: three as built, two optimised.
    3. `'a source construct marks the CLIF rows of its instructions'`: the construct owning pc 13: seven CLIF rows.
    4. `'an rxm instruction can mark no optimised row, and nothing says so'`: `if 2 > 1 { 10 } else { 20 }`, rxm pc 6:
       two CLIF rows as built, none optimised; the status line reads as it does with the CLIF view closed.
    5. `'a CLIF row with no srcloc clears the pin and says nothing'`: pin pc 13 first; click row 29 (`v1 = iconst.i64
       0`): no `.is-linked` row in any view; the status line empty.
    6. `'the CLIF run's focus marks its rows and meets the pin'`: pin the construct owning pc 13, step the CLIF view until
       its frame's pc is 13: its rows with srclocs 12, 13, 14 are `.is-focus`, and the status line names `the CLIF run is
       here right now`.
- [ ] **Step 2: Run** `NODE linked-legs`, `NODE link-wiring`, `NODE link-status`, `BROWSER clif-link`. Expected: FAIL.
- [ ] **Step 3: Implement** as Interfaces says.
- [ ] **Step 4: Run** the four, `BROWSER rxm-link`, `link-hold`, `running-focus`, `marks`, `link-clear`, `copy-pin`,
  `FIREFOX clif-link`, `TSC`, `LINT`. Expected: PASS.
- [ ] **Step 5: Sabotage.**

| Edit | Must fail |
|---|---|
| rxm's `rows` ignores the `clif` origin | `clif-link` 1 (three rxm rows) |
| CLIF's `rows` ignores an `rxm` pin's pc | `clif-link` 2 (seven) |
| `LINKED.clif.emits` `'CLIF rows'` | `clif-link` 4's status line and `link-status.test.ts` |
| a srcloc-less row calls `linkInstr` with the last pc | `clif-link` 5 |
| `focusNode` for CLIF `null` | `clif-link` 6 |
| `linkInstr` pins `'rxm'` whatever its origin | `link-wiring.test.ts`'s `'clif'` case |

- [ ] **Commit:** `A CLIF row links its rxm instruction and source construct, a construct or rxm instruction marks its CLIF
  rows, and the CLIF run's focus is marked and named`.

### Task 12: Share links and stored workspaces carry a CLIF view and its position

Spec §4 *Header* (a stored workspace or link showing CLIF fetches at start), §6 *The switch*. Brief G7. `Positions` and
`LinkPositions` take a new leg by `LEGS` (A7); this task proves it and fixes what does not hold.

**Files:** `web/src/share-positions.ts` and `web/src/main.ts:2070-2089` if a test needs them; tests
`tests/node/share-positions.test.ts:148`, new `tests/browser/share-open-clif.test.ts`.

- [ ] **Step 1: Failing tests.**
  - `share-positions.test.ts`: the case at `:148` becomes `'continues one leg at a time, λ then rxm then TM then CLIF'`.
  - `share-open-clif.test.ts`:
    1. `'opens a link on a CLIF view at its step and listing'`: `fact.rxt`, a workspace with a `clif-0` leaf,
       `positions: { clif: 95 }`, `listing: 'optimised'`: the first `run` carries `'optimised'`; the CLIF view lands on
       step 95 with *optimised* checked.
    2. `'a CLIF position and an rxm position past their first fills both land'` (Review Focus 5): `loop1000000`; read
       each leg's first fill from a first open (record both in `$R/logs/t11-fills.log`), then open a link with each
       position 1,000 past its fill: both views land, each continued at most `MAX_LINK_CONTINUES` times.
    3. `'a link made with a CLIF view open carries its step and listing'`: *optimised* chosen, stepped to 40: the share
       popover's link decodes to `positions.clif === 40` and `listing === 'optimised'`.
    4. `'a stored workspace with a CLIF view lists and records at start'`: the listing drawn and the step line past 0 with
       no gesture.
- [ ] **Step 2: Run** `NODE share-positions`, `BROWSER share-open-clif`. Expected: the node case fails; record which
  browser cases fail and why before changing code.
- [ ] **Step 3: Implement** only what a failing case needs.
- [ ] **Step 4: Run** the two, `BROWSER share-positions`, `BROWSER share-popover`, `BROWSER workspace-restore`,
  `FIREFOX share-open-clif`, `TSC`. Expected: PASS.
- [ ] **Step 5: Sabotage.**

| Edit | Must fail |
|---|---|
| `LinkPositions` skips `clif` at `compiled` | `share-open-clif` 1 |
| the CLIF pass posts no `result` (Task 5's) | `share-open-clif` 2 (CLIF never continues) |
| `sharePayload` leaves out the CLIF position | `share-open-clif` 3 |

- [ ] **Commit:** `A share link or stored workspace showing a CLIF view opens it at its step and listing`; if Step 3
  changed no source file, the tests alone: `Share links and stored workspaces are held to carry a CLIF view and its
  position`.

### Task 13: Measurements (no commit)

Spec §8 *Hot paths*, *Size*. Brief: on a busy machine, INCONCLUSIVE.

- [ ] **Step 1.** `git -C $W worktree add --detach $B 41d01d7`; in `$B/web`: `pnpm install --frozen-lockfile`,
  `build:wasm`, `build:clif-wasm` (its own target dir). In `$W/web` the same builds at the branch's head.
- [ ] **Step 2: Size.** `cmp $B/pkg/redextape_wasm_bg.wasm $W/pkg/redextape_wasm_bg.wasm` and both byte sizes; `gzip -9c`
  sizes of both `pkg-clif/redextape_clif_wasm_bg.wasm`. Expected: `pkg/` identical. If not, stop and report.
- [ ] **Step 3: Hot paths.** The §7.2 harness (`~/temp/redextape-ab-harness/`, its `README.md`; adapt its paths to `$R`):
  rxm recording and compile time, base `$B` against head `$W`, browser rounds in ABBA order. Before and during each round
  read `uptime`: a one-minute load average above 4 at any reading makes the round INCONCLUSIVE; stop and report (the user
  picks a quiet window).
- [ ] **Step 4.** Write `$R/measurements.md`: each figure with the command that gives it. No commit.

### Task 14: Comment budget, the full gate, the Firefox tier, the roadmap entry

**Files:** `scripts/comment-budget.json`; `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (appended).

- [ ] **Step 1: Budget.** `node scripts/check-comments.mjs --base 41d01d7`; write each value it asks for; commit `The
  comment budget records the CLIF view` if anything changed. This is the last code commit.
- [ ] **Step 2: The gate**, PR 1's (`docs/superpowers/plans/2026-11-19-clif-view-pr1-package.md`, Task 13 Step 2, items 1
  to 6) with `--base 41d01d7` and logs in `$R/gate/`, under `systemd-run --user --scope -q -p MemoryMax=16G -p
  MemorySwapMax=0`, `rustup check` first; plus `cd $W/web && VITEST_MAX_WORKERS=2 pnpm run test:browser` and
  `REDEXTAPE_FIREFOX=1 VITEST_MAX_WORKERS=2 pnpm run test:firefox` (both after the port wait). Expected: every one exits
  0. A failure stops the task and goes back to the controller.
- [ ] **Step 3: The entry**, headed as the entries above it are: *CLIF view PR 2: the view*, the date, branch
  `clif-view-2`, the range `41d01d7..<Step 1's SHA>`, the commit count, *plus this entry*. Sections: what Tasks 1-12
  changed; the departures and the user's answers to **Decisions for the user**; Task 13's figures (or INCONCLUSIVE);
  `##### WHAT THIS DID NOT CLOSE`: hidden-recording PR B's `head.shown` overlaps `run.clif` and the `clif` request (W3);
  the scout is built and never driven (W6); PR 1's review minor 3 (a list- or box-tagged 0 after a fault); the cycle
  sentence's *all four* beside five views (G2); any NEEDS_CONTEXT left open; `##### VERIFICATION`: Step 2's results,
  ending with **Every count this entry quotes, with what produces it**. Run every command before committing; correct the
  entry to what they print.
- [ ] **Step 4: Commit** `The roadmap records the CLIF view`, the diff touching this file alone.

## Spec coverage

| Design | Tasks |
|---|---|
| §4 header: fifth toggle after rxm, key 5, off by default, stored workspaces unchanged, fetch at start when shown | 4, 7, 12 |
| §4 listing: every function in order, rows as Cranelift prints them, decimal pc column, headers as label rows | 8, 9 |
| §4 switch: as built and optimised on each bar, its labelling, the CLIF leg alone re-recorded | 6, 10 |
| §4 steps, values (number, tag, register), call stack (name, label, row), heap | 8, 9 |
| §4 end, cap pause and `[continue]` as rxm's | 5 (`raise`), 9 |
| §4 links both ways, srcloc-less rows, merged instructions without a message | 1, 11 |
| §4 loading and failure with Retry, other views unaffected | 5, 6, 7, 9 |
| §4 menu without *edit a copy*; help: gloss, five views, keys 1 to 5, the switch | 4 |
| §6 the leg in every table; loading; one occupant; recording while shown; the switch; the pane | 4, 5, 6, 7, 10, 9 |
| §6 links M1, M2 (M3 left alone) | 1, 11 |
| §6 header and help, `countWord` | 4 (departure: the cycle keeps *all four*) |
| §8 no fetch without intent, each assertion sabotaged | 5, 7 |
| §8 recording: no CLIF frames while hidden, the other legs' frames unchanged | 5, 7 |
| §8 links: each direction, both listings, an rxm instruction marking no optimised row | 11 |
| §8 hot paths; size | 13 |
| §7.2 a Firefox run | 5, 6, 7, 9-12 (`FIREFOX` runs), 14 |
