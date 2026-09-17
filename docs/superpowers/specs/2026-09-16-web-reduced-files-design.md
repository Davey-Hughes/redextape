# TM buffers run reduced files — design

> **Roadmap:** closes the first of the four things `reduced-tm-files` (#95, `bbc35ba`) left open, recorded in its
> entry as "full web support for reduced files is its own slice" (`docs/superpowers/plans/2026-07-19-redextape-roadmap.md`,
> the entry headed *A REDUCED `.tm` FILE RUNS AND DECODES FROM THE FILE ALONE*), and named in that branch's spec
> as the deferred "plain layout for reduced files" (`docs/superpowers/specs/2026-09-14-reduced-tm-files-design.md`,
> its decisions table).
>
> Line numbers below were taken at `bbc35ba` and may move; symbols are named so they can be found again.

## What this delivers

- **A TM buffer shows a reduced file truthfully.** The status line names the stages and the recorded step count,
  and a file reduced to one tape is labelled as the interleaved tapes it is, not as `REG`.
- **A TM buffer reads a headered file's value** — `version 1` and `version 2` alike — from a run that never records
  a frame and that an edit can supersede mid-way.
- **The CLI and the web decide a run's value in one function**, so they cannot drift apart.
- **A TM buffer refuses to build text over a measured size**, with the size named, before parsing it.

## Decisions, made 2026-09-15 and 2026-09-16

| question | chosen | not chosen, and why |
| --- | --- | --- |
| What must a user be able to do? | Run a reduced file and read its value, as `redextape run` does. | **Display only:** the scratch pane would still decode nothing for any file. **Also produce one in the browser:** a new control and a verification run in the worker, roughly doubling the slice. |
| How does a buffer get through its header's step count? | A second, frame-less run, advanced in chunks that yield to the event loop. | **One uninterruptible run at build:** every debounced edit to a reduced file would block the worker for the whole run. **The same run under a browser ceiling:** refuses `sum(5)` through stage 1 (298,696,070 steps) outright. |
| Where does the value run live? | Beside the watching cursor, which is untouched. | **Fast-forward the watching cursor:** the file could no longer be watched from its start, and `[continue]` would change meaning on every buffer. |
| Where do the header checks live? | One core function both the CLI and wasm call. | **Reimplemented in `session.rs`:** two copies that must agree, the shape the attribution and citation gates keep catching after the fact. |
| Which files must a buffer handle? | Whatever fits under a measured size ceiling; larger text is refused with its size named. | **Everything the CLI writes:** full-pipeline files reach 37.9 MB and would need a non-editor view, lazy program transfer and non-copying storage. **A fixed stage rule:** refuses files that fit. |
| What budget sets the ceiling? | 250 ms, the budget `MAX_FORK_RULES` was measured against. | **2 s for a paste:** the app would carry two gesture budgets that have to be explained side by side. |
| Where does the value appear? | A line in the TM pane itself. | **`#results`:** it belongs to the source program's compile, and a buffer deliberately has none (`web/src/main.ts:306`). Several TM buffers can be open in several panes. |

## What was checked before designing

### What `redextape run` does with a reduced file

`crates/redextape-cli/src/run.rs:117`, `run_artifact_text`, does four things beyond decoding a lowered file:

1. it runs under the header's recorded step count, with `TM_DEFAULT_CAPS`' cell cap;
2. a capped run gets a sentence naming whose count it was;
3. a reduced run must halt in an accept state, and the halting state is named when it does not;
4. it decodes with `decode_reduced` (`crates/redextape-core/src/tm/reduced_file.rs:158`), which undoes the stages
   and decodes a header with no reduction exactly as `decode_tape_ty_reason` does.

Two unit tests pin those messages on hand-built machines: `run.rs:778` (a 10-step walker whose header records 5)
and `run.rs:797` (a stuck start state).

### What a TM buffer does with one today

- **It keeps the header and builds from it.** `tm_scratch_with_caps` (`crates/redextape-wasm/src/session.rs:1246`)
  hands a parsed header to `build_tm_leg`, the same function a compiled program's leg is built with.
- **It runs at `TM_DEFAULT_CAPS`**, 5,000,000 steps. `3 - 5` through all three stages records 7,007,238.
- **It records every step it runs as a frame** (`web/src/session-worker.ts`, `recordTm`), charged against a 32 MiB
  allowance that `[continue]` renews and that also raises the cursor's cap by `EXTEND_STEPS` (100,000). Watching is
  not a way to reach a value millions of steps away.
- **It decodes no value.** `TmScratch` has no `tm_value`; only `Session` does, and `Session::tm_value`
  (`session.rs:841`) reads the final tapes of the run `compile` already performed, not the cursor. The scratch
  reply posts no `result` (`session-worker.ts:645`).
- **It labels every tape from a fixed list.** The scratch arm takes the program-independent `tapeNames()` export
  (`web/src/replies.ts:433`), which is `REG, WORK, STACK, HEAP, BOX` (`crates/redextape-core/src/tm/build.rs:38`),
  so a one-tape reduced file's tape reads `REG`.
- **The status line knows one header fact:** `header: false` gets the headerless sentence (`web/src/tm-pane.ts:690`).
  Nothing names a stage list or a recorded step count.

### Why a second cursor needs no agreement test with the simulator

`sim::run`, the one implementation behind `simulate`, `simulate_final` and their siblings, is written over
`TmCursor` (`crates/redextape-core/src/trace.rs:182`). A cursor stepped to its end is `simulate_final`, including
the accept-before-cap order that makes a budget spent exactly read `Halted` rather than `HitCap`.

### Sizes of reduced files

Release CLI at `bbc35ba`, one command per row:
`redextape emit <file>.rxt --lang tm --reduce <stages> -o <out>`, with bytes from `stat -c %s`, states from
`grep -c '^state '`, and steps from the header's `steps` line.

| program | stages | bytes | states | recorded steps |
| --- | --- | --- | --- | --- |
| `3 - 5` | fold | 87,957 | 614 | 508 |
| `3 - 5` | single-tape | 103,028 | 904 | 233,796 |
| `3 - 5` | two-symbol | 79,480 | 729 | 1,689 |
| `3 - 5` | single-tape, two-symbol | 1,516,707 | 18,433 | 1,964,881 |
| `3 - 5` | fold, single-tape, two-symbol | 11,571,215 | 137,532 | 7,007,238 |
| `5 - 3` | single-tape | 103,028 | 904 | 241,666 |
| `1 + 2 * 3` | fold | 282,332 | 1,893 | 2,041 |
| `1 + 2 * 3` | single-tape | 291,468 | 2,504 | 1,508,688 |
| `1 + 2 * 3` | two-symbol | 223,734 | 2,011 | 7,161 |
| `1 + 2 * 3` | single-tape, two-symbol | 4,341,300 | 51,783 | 12,681,273 |
| `1 + 2 * 3` | fold, single-tape, two-symbol | 37,923,527 | 442,992 | 45,085,521 |

`redextape run` on the `5 - 3` single-tape file prints `2` and exits 0.

### Budgets already in the web app

`MAX_FORK_RULES` (`web/src/protocol.ts:297`, 50,000) is **measured, not chosen**: the largest machine whose emit,
structured clone and `tmScratch` parse total under "the 250 ms an initiated gesture may take". Buffers persist to
`localStorage` with **no text-length rejection, by decision** (`web/src/buffers-store.ts:91`); a quota failure is
reported once per page load (`web/src/main.ts:526`). This design changes neither.

## Components

### 1. Core: one decision for a run's value

In `tm/reduced_file.rs`, beside `decode_reduced`, re-exported from `tm`:

```rust
/// The caps a headered file runs under: its recorded step count when it is reduced, `TM_DEFAULT_CAPS`'
/// steps otherwise, and `TM_DEFAULT_CAPS`' cells either way.
pub fn run_caps(h: &TmHeader) -> TmCaps

/// Why a finished run under a header has no value.
pub enum RunFailure {
    /// The run stopped at a cap. A caller words it from `h.reduction`.
    HitCap,
    /// A reduced run halted outside an accept state. Never produced for a header with no reduction.
    NotAccept(StateId),
    /// `decode_reduced` refused, for either of `DecodeFailure`'s two causes.
    Decode(DecodeFailure),
}

/// A finished run's value under `h`: the cap check, the accept check for a reduced header, then
/// `decode_reduced`.
pub fn value_of_run(m: &Machine, h: &TmHeader, tapes: &[Tape], state: StateId, status: TmStatus)
    -> Result<Value, RunFailure>
```

**Two functions, not one that also simulates,** because the web steps a cursor in chunks and could not call a
function that runs the machine itself. The checks run in `run_artifact_text`'s order.

### 2. CLI

`run_artifact_text` becomes `run_caps` → `simulate_final` → `value_of_run`, with a `match` that maps each
`RunFailure` onto the sentence and `Outcome` it produces today: `HitCap` chooses between the default and reduced
sentences on `header.reduction`, `NotAccept` names the state, and `Decode` goes to `report_tm_decode` unchanged.
**No message, exit code or snapshot changes.**

### 3. wasm: the value run, a handle of its own

**Amended 2026-09-16, before any code.** The first version of this section put `runValue` and `tmValue` on
`TmScratch`, with `tmValue` answering `null` for a headerless file. That is the shape the 5d-i session-model
design's **decision 2** rejects: a method that needs a result type does not exist on a scratch rather than existing
and declining. The decision is pinned twice in `crates/redextape-wasm/tests/browser.rs`, at compile time by the
`scratch_methods_that_must_not_exist` module and at run time by the loop asserting `tmValue` is `undefined` on a
scratch. Davey chose to keep the decision and move the value run onto a handle of its own. Both pins stay unedited.

**`tmScratch(src)` answers `{ diagnostics, scratch, value }`.** `value` is a new wasm class, **`TmValueRun`**, present
exactly when `scratch` is present AND the file has a header, and `null` otherwise, which is the same
absence-at-construction shape `scratch: null` already uses for text that does not parse. On the Rust side,
`session::tm_scratch` returns the pair through a TM-specific result type rather than widening `Scratched<T>`,
which `lambda_scratch` shares.

`TmValueRun` (`crates/redextape-wasm/src/session.rs`, exported from `lib.rs`) owns:

- **a `TmCursor<Rc<Machine>>`** built from `h.init(m.tapes)` at `run_caps(h)`, sharing the scratch cursor's
  `Rc<Machine>`, and the `TmHeader` it decodes under. Nothing runs at build, so building still costs one parse.
- **`run(budget) -> ValueRun`**, exported as `run`: advance up to `budget` steps.
  `ValueRun { run: RunStatus, steps, cap }`; `run` is the existing `RunStatus` (`Running`, `Ended` or `Capped`;
  never `DepthRefused`).
- **`value() -> Decoded`**, exported as `value`: `Unfinished` while running, and otherwise `value_of_run` mapped
  onto the existing `Decoded`:

  | `value_of_run` | `Decoded` |
  | --- | --- |
  | `Ok(v)` | `Value` or `TooLargeToPrint`, through `decoded_value`, the one capped print |
  | `HitCap` | `Fault`, naming the count: "did not halt within the 7,007,238 steps its header records" for a reduced file, `TM_DEFAULT_CAPS`' steps and cells otherwise |
  | `NotAccept(s)` | `Fault`, naming the state |
  | `Decode(Mismatch)` | `Undecodable` |
  | `Decode(BudgetExhausted)` | `Fault`, worded as this tool's limit rather than the file's fault |

  **No new `Decoded` variant.** The decision is shared with the CLI; the wording is not, because the CLI's sentences
  carry a file label and hints a pane has no use for.
- **No raise, and now by construction.** `TmValueRun` has no counterpart to `raiseTmCap`, and `raiseTmCap` lives on
  `TmScratch`, which does not hold this cursor: a reduced file's recorded count is its contract, and running out of it
  is the file's fault.

On `TmScratch`, which gains no value method:

- **`tape_names() -> Vec<String>`**, exported as `tapeNames`: `TAPE_NAMES` when the stage list has no single-tape
  stage (lowered, fold, two-symbol, or both, since tape `i` is still lowered tape `i`, encoded), and one label
  `"{k} tapes, interleaved"` when it has one, with `k` from `Stage::SingleTape { k }`. A headerless file has no stage
  list and keeps `TAPE_NAMES`, as today.

`TmScratchStatus` gains **`reduction: Option<ReductionStatus>`**, `ReductionStatus { stages: Vec<String>, steps }`,
where `stages` are `StageKind::name()`s. It is the sixth field the type's own doc (`session.rs:1157`) says the
exhaustive destructuring at `session.rs:2299` exists to catch. Every `u64` crossing the boundary here takes
`ts(type = "number")`, the override `TmStatus::total_steps` records the reason for.

### 4. wasm: the size ceiling

`tm_scratch_with_caps` checks `src.len()` against **`MAX_SCRATCH_TM_BYTES`** before calling `parse_tm_full`. Over it,
the scratch is `None` and the one diagnostic, spanning line 1, reads:

> this file is 11,571,215 bytes; a TM buffer builds files up to N bytes — `redextape run` has no such limit

It rides the existing `no-session` reply, so it reaches the same surface as a parse error, with no new UI and no
new wire kind. The constant lives in the wasm crate, and the CLI is untouched.

**That surface, measured 2026-09-16** in the browser tier on `bbc35ba`'s code with a throwaway probe: every TM buffer
build failure lands on `#link-status` as `fork failed — <message>`, whether the buffer had a good build before
(`fork failed — unknown goto target \`nowhere\``) or not, and a freshly minted blank buffer reads
`fork failed — missing \`tapes <n>\`` at once. The TM editor's gutter shows nothing in either case. `replies.ts`'s
`no-session` arm routes every TM buffer to its "phantom" branch, because `noSessionReply` asks whether the buffer's
λ leg ever recorded a frame, which a TM buffer's never does. So the refusal will be visible, and worded
"fork failed" when nothing was forked, like every other TM buffer error; see *Not in scope*.

**N is measured, not chosen** (see *For the plan to measure*). Its doc carries the readings, the machine, the commit
and the probe that produced them, in `MAX_FORK_RULES`' style. It applies to every TM buffer, since cost tracks size
and not header version, and a restored buffer over it now refuses on restore.

### 5. Worker

In `web/src/session-worker.ts`:

1. `onTmScratch`'s `tm-scratch-compiled` reply gains `tapeNames: string[]` from `scratch.tapeNames()`. The doc
   comment above `onTmScratch` that says the reply carries no `tapeNames` is corrected in the same change.
2. The `tm-scratch` arm of `Live` gains `value: TmValueRunHandle | null`, and `dropLive` frees it beside the scratch,
   under the same nulled-before-freed, never-throws rule.
3. After `await recordTm(gen, true)` returns, a new `runValueLoop(gen)` repeats: check `live?.gen !== gen` or a null
   `value` (exit silently) → `value.run(VALUE_CHUNK)` → post `{ kind: 'tm-value', gen, run, value }` → stop unless
   `run` is `Running` → `yieldToEventLoop()`. A `running.value` flag rejects re-entry, as `recording.tm` does for
   `recordTm`.
4. `[continue]`, arriving during a value run, interleaves at the yields and reaches only the watching cursor.

`VALUE_CHUNK` lives in `web/src/protocol.ts` and is set from a measured wasm step rate so that one chunk takes about
10 ms, which bounds how long an edit waits to supersede a run.

### 6. Main thread and pane

- **`web/src/replies.ts`:** the scratch arm uses the reply's `tapeNames` in place of the fixed export. A new
  `tm-value` arm stores `{ run, value }` on the buffer's session entry and fans it out to `pane.setScratchValue`, the
  same store-then-fan-out `storeAndSetProgram` uses, so a pane bound later is seeded with it.
- **`web/src/tm-pane.ts`:**
  - `#drawStatus` gains a third half beside the headerless sentence:
    `reduced: fold, single-tape, two-symbol · 7,007,238 steps`.
  - A value line under the status, written only by a new `#drawValue`, following the setter-plus-refresher shape
    the Task 8 Critical fix established for `#drawStatus`:

    | state | text |
    | --- | --- |
    | running | `value: running · 3,200,000 of 7,007,238 steps` |
    | ended with `Value` | `value: 2` |
    | ended otherwise | `decodedText(value)` alone: `no encoding for this type`, `value too large to print`, or `fault: …` |
    | headerless | no line |

    `decodedText` (`web/src/types.ts:130`) is the formatter `#results` already uses, so a value reads the same on
    both surfaces.

  - **The line is created with `role="status"`.** This is not the deferred accessibility pass. A live-updating line
    with no announcement would be a new instance of standing-list item 6 (`#link-status`), and a slice that adds to
    that list resets the pass's own trigger (the roadmap entry *THE PASS IS UNBLOCKED AND DELIBERATELY STILL NOT
    TAKEN*).

## Testing

### Fixture

**One checked-in file:** `5 - 3` reduced through `single-tape` (103,028 bytes, 241,666 steps, value `2`). Its value
is not zero, so a wrong decode cannot pass by coincidence — #95's first sabotage row stayed green for exactly that
reason, on a program whose value was 0; it exercises the interleaved label and runs across many
value chunks. A core test regenerates it with `reduce` and `print_tm_with` and asserts byte equality, so a stale
fixture fails. Every other test builds its machine in the test, through `reduce` or as the CLI's hand-written
walker and stuck-state texts.

### By tier

| tier | pins |
| --- | --- |
| core, fast | `run_caps` for a lowered and a reduced header; `value_of_run` answering each `RunFailure` variant and a value |
| CLI | **nothing new.** Every existing `run.rs` test and `tests/cmd` snapshot passes unedited, which is the evidence that no message or exit code moved |
| wasm session, native | fold, single-tape and two-symbol each decode to the reference value; a reduced text whose `steps` line is the exact count gives a value and one less gives `Fault`; the stuck-state text gives `Fault` naming the state; a headerless file builds a scratch and no value run; `run` in chunks of 1, 7, 1,000 and unbounded reach one answer; running the value run out leaves the scratch's cursor at step 0; `tapeNames` for each stage list; `reduction` in the exhaustive destructure; **the ceiling's property:** the largest passing corpus file builds and the smallest failing one is refused |
| wasm browser | `tmScratch` answers `value: null` beside a headerless scratch and a `TmValueRun` beside a headered one; `ValueRun` and `ReductionStatus` cross as numbers, beside `all_three_legs_agree_across_the_boundary`; **both decision-2 pins pass unedited** |
| web node | a `tm-value` reply is stored on its entry and reaches a pane bound afterwards; the value line's text for each state |
| web browser | pasting the fixture into a blank TM buffer shows `reduced: single-tape · 241,666 steps`, the label `5 tapes, interleaved`, `value: 2`, and a value line with `role="status"`; editing a walker that declares `steps 50000000` mid-run resets the line, and no `tm-value` from the superseded build lands |

### Sabotages, each with the test that must go red

| # | sabotage | must go red |
| --- | --- | --- |
| S1 | `value_of_run` skips the accept check | `run.rs:797`'s stuck-state test; the wasm stuck-state test |
| S2 | `run_caps` ignores `reduction` | `run.rs:778`'s walker test; the wasm exact-count test |
| S3 | the value run decodes with `decode_tape_ty` | the wasm per-stage tests; the browser `value: 2` |
| S4 | `tape_names` ignores the single-tape stage | the wasm label test; the browser label |
| S5 | `runValueLoop` drops its `gen` check | the browser supersession test — **predicted, not shown.** The main thread already drops a reply whose `gen` is stale (`web/src/session-client.ts:31`), so a stale loop's posts never render; the sabotage is visible only through what the stale loop does to the NEW build's run (holding `running.value`, or stepping the new scratch). The plan runs S5 before any task relies on this row, and if it stays green, the row is re-planned against the worker directly |
| S6 | the size check moves after `parse_tm_full` | a wasm test giving text that is both oversized and unparseable, which must get the size diagnostic |
| S7 | the value line loses `role="status"` | the browser attribute assertion |
| S8 | `TmValueRun` steps the scratch's own cursor instead of a second one | the wasm test that runs the value run out and asserts the scratch's `tm_state` is still at step 0 |
| S9 | `tmValue` is added to `TmScratch` after all | `tests/browser.rs`'s `scratch_methods_that_must_not_exist` fails to compile, and its run-time `undefined` loop fails |

A sabotage that stays green is recorded as a finding in the roadmap entry, not re-aimed until it fires.

## Not in scope

- producing a reduced file in the browser
- the accessibility pass, beyond the one `role="status"` above
- the editor's own cost of holding a large paste: if the probe finds the editor breaks before the build does, that
  is filed, not fixed here
- re-measuring `MAX_FORK_RULES` against the linear parser, which stays its own slice
- `reduce`'s weak value check for `result Unit`
- the `fork failed —` wording on every TM buffer build failure, and the TM editor gutter never showing a diagnostic,
  both measured above and both older than this slice
- any change to `Session`, the watching cursor, `[continue]`, forking, the δ table or buffer storage — including
  `Session::tm_value` still answering `Undecodable` for both of `DecodeFailure`'s causes, where a buffer's value now
  tells them apart

## For the plan to measure

1. **The wasm step rate,** for `VALUE_CHUNK`: a release wasm build stepping the fixture's value run in the browser
   tier. Native `simulate` measured 126 M steps/s at `78ebea6`; nothing here assumes the wasm figure.
2. **The ceiling,** for `MAX_SCRATCH_TM_BYTES`: paste each file in the size table above into a blank TM buffer in the
   browser tier, plus intermediate sizes wherever the break falls between two rows, and record per file:
   1. the editor accepting the paste, as a main-thread long task;
   2. the text's structured clone to the worker;
   3. `tmScratch`'s parse;
   4. `tmProgram`'s structured clone back.

   N is the largest file whose 2 + 3 + 4 total under 250 ms: `MAX_FORK_RULES`' three costs, with emit replaced by
   the program's return trip. Stage 1 is reported beside it and does not set N, for the reason under *Not in scope*.
3. **Whether the fixture loads into a browser test** as a Vite `?raw` import from wherever it is checked in, before a
   task depends on it.
4. **How long `recordTm`'s first allowance takes on the fixture,** since the value run starts after it; if the
   value's first appearance waits noticeably on recording, the plan says so rather than reordering silently.
