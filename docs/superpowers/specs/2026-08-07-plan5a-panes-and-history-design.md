# Plan 5a — the three panes, and a history you can scrub

Status: design, 2026-08-07.
Roadmap: [`../plans/2026-07-19-redextape-roadmap.md`](../plans/2026-07-19-redextape-roadmap.md) § "Plan 5".
Predecessor: [`2026-08-07-web-app-first-consumer-design.md`](2026-08-07-web-app-first-consumer-design.md) (PR 3c).
Master design: [`2026-07-19-tm-lambda-visualizer-design.md`](2026-07-19-tm-lambda-visualizer-design.md) §§6.1, 6.4, 7.1.

---

## 0. Why this slice, and why now

**Plan 5 is not one plan, and saying so is this document's first job.** The roadmap's Plan 5 bullet
bundles five subsystems — panes, renderers, click-linking, dual-focus highlight, detach-on-edit, and
per-run caps — and one of them is blocked on a problem the project deliberately left open. Surveying it
produced this decomposition:

| slice | what | new Rust? |
| --- | --- | --- |
| **5a** | §6.1's layout, the λ and TM panes, step controls, scrubbable history, §6.4's caps affordance | one small export |
| 5b | §6.2 part 1 — static click-linking: click a source construct, highlight its λ span and TM state-block | yes, small |
| 5c | §6.2 part 2 — dual-focus highlight while running | yes, research |
| 5d | §7.1 — editable λ / TM panes, detach, recompile-from-source | yes |
| 5e | TM non-progress detection (roadmap's entry under Plan 5) | yes, optional |

**5c is where the blockage is, and it is worth stating here so nobody schedules it by accident.**
§6.2's dual focus wants each interpreter to report the Core node it is currently working on. The TM
half exists — `TmState.source_node`, resolved through `SourceMap::tm_owner`. The λ half **shipped and
was removed** (`viewmodel.rs:36-55`): `node_to_lambda` records paths root-relative into the *initial*
lowered term, normal-order reduction contracts root redexes, so at step N > 1 the path indexes a
structurally different tree. Measured on `let x = 40; x + 2`, all seven steps reported the same node,
`let x = 40;`, and `x + 2` was never named. The field was removed rather than left `None` because a
value that is sometimes silently wrong tells a consumer nothing is wrong at all. Restoring it needs a
coordinate system that survives reduction, which is research, not renderer work.

**5a is what is buildable now.** Almost everything it needs shipped in PR #14 and has never been called:
`tmState(radius)`, `tapeSlice`, `tmProgram()`, `lambdaState(byte_budget)`, `lambdaAst(node_budget)`,
`stepLambda`, `stepTm`, `raiseLambdaCap`, `raiseTmCap`. PR 3c built the first consumer and used none of
the stepping surface — its scope was one source pane and a plain-text results readout.

**It also settles a verdict deferred twice.** PR #15 expected PR 3c to say whether the arena `TermNode`
became is the shape a renderer wants; PR 3c could not, because its scope had no λ pane, and building a
throwaway consumer to have an opinion would not have been evidence about a real one. 5a-ii's tree view
is that real consumer.

---

## 1. Decisions taken

| # | decision | § |
| --- | --- | --- |
| 1 | Plan 5 splits into 5a–5e; this document is 5a only | §0 |
| 2 | **Reverse stepping is recorded frames**, not cursor snapshots and not replay | §3.1 |
| 3 | The frame store is **byte-budgeted**; a frame is up to 781 KB and ~95% of it is `spans` | §3.2 |
| 3a | **`FRAME_BYTES = 512`**, separate from `LAMBDA_BYTE_BUDGET`'s 65,536 — measured, 10-31× faster | §3.2, §8 |
| 4 | Frames **stream to the main thread**; the main thread owns history and the play head | §3.3 |
| 5 | The λ leg **steps-and-records to a recording budget** on compile, rather than `drive()`-ing | §3.4 |
| 6 | The recording budget, the chunk budget and the cursor cap are **three different things** | §3.5 |
| 7 | The Session **outlives its message**, so `[continue]` can resume it | §3.6 |
| 8 | The λ pane renders **text, with a structural tree toggle** — `lambdaAst`'s first consumer | §4.2, §4.3 |
| 9 | The TM pane renders **five tape rows, a status line, and a virtualized state table** with a toggle | §4.4, §4.5 |
| 10 | **A ninth export, `tapeNames()`**, so five tape labels cannot drift from `build.rs` | §5 |
| 11 | **No framework.** Plain DOM + CM6, as PR 3c shipped and never wrote down | §9 |
| 12 | Lands as **two PRs**, 5a-i and 5a-ii | §10 |

---

## 2. Module boundaries

```
web/src/
├─ main.ts             wiring, layout mount points          CHANGED
├─ protocol.ts         wire types + budgets                 CHANGED (streaming)
├─ session-client.ts   generation guard                     CHANGED (many replies per gen)
├─ session-worker.ts   Session owner, record loops          CHANGED (lifecycle)
├─ types.ts            wasm wire shapes                     CHANGED (+5 shapes)
├─ history.ts          byte-budgeted ring + play head       NEW   5a-i
├─ controls.ts         ◀ ▶ ⏵ ↺, step readout, playback      NEW   5a-i
├─ tape.ts             one tape row from a window           NEW   5a-i
├─ lambda-pane.ts      λ text view                          NEW   5a-i
├─ tm-pane.ts          five tapes + status line             NEW   5a-i
├─ pane-chrome.ts      ◀ ▶ ⏵ ↺ strip, shared by both panes  NEW   5a-i
├─ banner.ts           load-failure surface                 NEW   5a-i
├─ format.ts           shared count formatting (`n()`)      NEW   5a-i
├─ virtual-list.ts     fixed-row windowing                  NEW   5a-ii
├─ state-table.ts      146+ states, current highlighted     NEW   5a-ii
├─ tree.ts             λ structural view from TermTree      NEW   5a-ii
├─ highlight.ts        source spans + decline mark          CHANGED (byte→UTF-16 conversion)
├─ lint.ts             analyze → CM6 diagnostics            CHANGED (passes doc text, not length)
├─ diagnostics.ts      span clamping                        CHANGED (byte→UTF-16 conversion)
├─ results.ts          the plain-text readout               CHANGED (`Running` gets a row)
├─ spans.ts            span → decoration                    CHANGED (`byteToIndex`, `byteIndexAt`)
├─ theme.ts            token class → CSS class              unchanged
└─ style.css           + layout, panes, tape, table         CHANGED
```

`history.ts`, `controls.ts`, `tape.ts`, `virtual-list.ts` and `tree.ts` are **pure logic with no DOM
dependency** and are node-tested. The `-pane` modules own DOM and are browser-tested. That split is
what keeps the fast tier meaningful; PR 3c's node tier is 38 tests over 6 files precisely because its
logic modules were kept DOM-free.

`types.ts` gains `TmState`, `TmProgram`, `StateView`, `RuleView`, `TermTree` and `TermNode`, mirroring
`viewmodel.rs`. Its existing header rule holds: every shape is **measured** against
`crates/redextape-wasm/tests/browser.rs`, not designed. `TermNode` is a serde enum with three variants
carrying payloads, so it crosses as a one-key object per variant (`{Var: n}`, `{Abs: [name, body]}`,
`{App: [f, x]}`) — the plan must pin the real shape from a browser test before `tree.ts` is written,
exactly as PR 3c pinned `Decoded`.

---

## 3. The history model

### 3.1 Why recorded frames, and not the two obvious alternatives

Both cursors are **forward-only**: `LambdaCursor` and `TmCursor` expose `next`, `steps_taken`,
`status` and `raise_cap`, with no rewind and no reset (`trace.rs:48-253`). So ◀ has to be built out of
something. Three candidates, and the measurements decide between them.

**Cursor snapshots.** `LambdaTerm` is `(Rc<Node>, u32, u32)` — a handle (`term.rs:37`), so cloning a λ
cursor is an `Rc` bump and nearly free. The TM side is the opposite: `trace.rs`'s own module doc
records that copying every tape per step measures **3,488 bytes/step and 592.9 MB for `sum(5)`**, and
that measurement is *why* the lazy cursor exists at all. Snapshots would therefore need a per-leg
checkpoint policy with two sets of constants, plus `Clone` derived on both cursors (neither has it
today; all their fields do), plus `seekLambda`/`seekTm` exports and a history layer inside `Session`.
That is a Rust slice wearing a UI slice's clothes.

**Replay from step 0.** No memory at all, and honest. Rejected on the λ side by a number already on the
record: this project has measured a **19.0 s single β-step** (roadmap, the shared-subterm guard's
falsification table). A backward click that can take nineteen seconds is not a backward click.

**Recorded frames — taken.** Stepping forward calls `stepLambda()` / `stepTm()` and keeps the
`LambdaState` / `TmState` the step produced. ◀ replays a kept frame: no wasm call, no cursor, no
replay. It adds no Rust on the stepping path — §5's export is about tape *labels*, not history — and,
the point that decides it, **each frame is already bounded by the budget its export takes.** `lambdaState(byte_budget)` truncates; `tmState(radius)` windows. The raw
3,488-bytes-per-step figure is the cost of a *tape copy*, not of a radius-bounded window.

Its one limit, stated rather than smoothed: **you can only go back where you have been.** There is no
forward seek past the recorded frontier. For a stepper this is not a limitation, it is the definition.

### 3.2 Byte-budgeted, not count-budgeted — and `LAMBDA_BYTE_BUDGET` does not bound a frame

Measured by `examples/frame_cost_probe.rs`, 2026-08-07, under `MemoryMax=2G MemorySwapMax=0`.

**This section's first draft said "one λ frame can therefore be 64 KB", reasoning from
`LAMBDA_BYTE_BUDGET = 65_536` (`protocol.ts:10`). That was wrong, and the probe was written to check
it.** The budget caps `text`. A `LambdaState` also carries `spans: Vec<(Span, TokenClass)>`, one entry
per token, which that budget does not bound at all. Serialized, the largest frame the probe produced at
the web's own budget was **781,038 bytes for `while4`** — 12× the figure this section claimed, and the
average across its 470 steps was **229,528**.

**Spans are ~95% of a frame, at every budget.** At a 512-byte text budget the frames are still ~10 KB;
`sample`'s 261 bytes of text serialize to 5,621. So the ring buffer's accounting must count spans, and
a count-capped ring would have been wrong by a further order of magnitude beyond the argument
originally given for byte-capping.

**The open question this section left to a measurement is answered, decisively: yes, history frames
want a much smaller budget than the readout does.** Dropping `FRAME_BYTES` from 65,536 to 512:

| program | render µs/step | frame bytes (avg) |
| --- | --- | --- |
| `while4` | 59.67 → **5.77** (10×) | 229,528 → **10,123** (23×) |
| `countdown4` | 49.55 → **3.82** (13×) | 204,018 → **10,152** (20×) |
| `list60` | 230.91 → **7.40** (31×) | 252,084 → **11,464** (22×) |

Truncation is exactly where the time goes — `print_lambda_capped` short-circuits properly, so a small
budget buys speed and memory together rather than trading one for the other. **`FRAME_BYTES = 512`,
separate from `LAMBDA_BYTE_BUDGET`'s 65,536, which stays as it is for the one term a user reads.**

`history.ts` therefore caps **bytes**, and the step at which eviction begins is a measured consequence
rather than a constant. The UI must be able to say what the oldest retained step is, because §6's
contract for scrubbing past the eviction point depends on it.

**Considered and not taken: a compact span encoding.** Flat `[start, end, classIdx]` triples would be
~12 bytes per span against JSON's ~76, cutting a 512-byte-budget frame from ~10 KB to ~1.5 KB. It needs
a second `lambdaState` shape in Rust and it is not needed: at ~10 KB a frame, a 32 MB ring holds ~3,200
frames, which is more scrubbing than any of the measured programs produces. Recorded so the next reader
knows the lever exists.

**Every byte figure in this section is a JSON size from this Rust probe, not retained JS heap** — a
later browser measurement (Task 12/13) found the real retained cost is ~52.8 bytes/span against this
section's own ~76-byte JSON estimate, because V8 interns the fourteen `TokenClass` string literals that
JSON rewrites in full each time; the "~95% of a frame is spans" conclusion survives, but the absolute
figures above do not say which unit they are in, and now this sentence does.

### 3.3 Streaming, and where history lives

The worker posts a **batch of frames at each yield boundary**; the main thread accumulates them and
owns the play head. ◀ ▶ ⏵ ↺ are then array arithmetic — no wasm call, no `postMessage`, no round trip
in the hot path of the feature this slice exists for.

The batching is not new machinery. `drive()`'s existing yield-abandon loop (`session-worker.ts:52-59`)
becomes yield-abandon-**and-post**; the generation check that already guards supersession guards this
unchanged. Progressive display falls out for free — step 1 is on screen while step 900 is still being
computed.

`session-client.ts` changes shape: today it delivers **one** reply per generation (`if (this.#gen !== 0
&& e.data.gen === this.#gen)`), and now a generation produces many. The staleness rule is unchanged;
what changes is that the callback fires repeatedly and the client must not treat a batch as terminal.

**Considered: the worker owning history and the main thread pulling frame N.** Main-thread memory stays
flat and the ring sits next to the thing producing it. Rejected because ⏵ playback would become ~60
`postMessage` round trips per second, each copying a frame — putting the round trip in exactly the
interaction that must feel immediate.

### 3.4 What happens on compile

`compile()` **already runs the whole TM leg** (`session-worker.ts:89`); that is where `total_steps`
comes from, and the TM *cursor* is a separate thing sitting at step 0. So TM stepping is available the
moment a program compiles, and the change on that leg is purely that somebody now steps it.

The λ leg changes materially. Today `drive()` spends the cursor to completion in `CHUNK_STEPS` chunks
and yields nothing per step, so there is nothing to record. Instead:

```
loop {
  if (!session.stepLambda()) break            // cursor exhausted
  frames.push(session.lambdaState(FRAME_BYTES))
  if (recorded % RECORD_CHUNK === 0) { post(batch); await yield; if (superseded) return }
  if (recorded >= RECORD_BUDGET) { post(batch, {reason: 'record-budget'}); break }
}
```

Under the budget the user gets the answer *and* a complete scrubbable history — `let x = 40; x + 2` is
seven steps. Over it, the readout says "still running — hit N steps [continue]", which **is** §6.4's
caps affordance. The history budget and the caps affordance are one mechanism rather than two.

**The TM leg records through the same loop, and it means something different there.** `stepTm()` /
`tmState(radius)` replace `stepLambda()` / `lambdaState()` and the shape is identical — but the TM run
already *finished* during `compile()`, so stepping the cursor is replaying a run whose answer is
already known. Recording the TM therefore cannot change what the readout says; hitting `RECORD_BUDGET`
on the TM leg costs history and nothing else. On the λ leg it costs the answer. The two legs share a
loop and not a consequence, and the UI must not describe them as if they did.

The regression this accepts, named plainly: **a program needing more than `RECORD_BUDGET` steps no
longer shows an instant λ answer.** PR 3c's readout drove to completion; this one stops to keep a
history. Whether that trade is right is a `RECORD_BUDGET` question, and `RECORD_BUDGET` is a
measurement (§8).

### 3.5 Three budgets, and they are not the same thing

`session.rs:415` already names this trap one layer in: *"A SPENT `budget` IS NOT A SPENT CAP.
Exhausting `budget` leaves the run `Running`; only the cursor's own cap yields `Capped` … folding them
together would offer 'continue' on a run that has merely"* exhausted a chunk. 5a introduces a **third**
budget and must not conflate it with either:

| budget | who owns it | exhausting it means | continue costs |
| --- | --- | --- | --- |
| `RECORD_CHUNK` | the worker's yield loop | time to check for supersession | nothing; internal |
| `RECORD_BUDGET` | this slice | history is as long as we chose to keep | nothing; step further |
| the cursor cap | `LambdaCursor` / `TmCursor` | the run is `Capped` | `raiseLambdaCap` / `raiseTmCap` |

Three different sentences in the UI, not one. A run stopped by `RECORD_BUDGET` is still `Running` and
continuing is free; a `Capped` run needs its cap raised; and a `DepthRefused` run (§6) cannot be
continued at all.

### 3.6 The Session lifecycle — the riskiest edit in the slice

Today `session.free()` runs at the end of every request (`session-worker.ts:116`). `[continue]` needs
the Session to still exist, so the worker holds **at most one live Session**, freed when a newer
generation supersedes it and on page teardown.

PR 3c's review already flagged a transient two-session window during rapid supersession: a new
request's `compile()` can run while an older, still-driving session has not yet reached its
yield-triggered abandon check. ~~Keeping sessions alive across messages **lengthens** that window from
"until the next yield" to "until the next compile completes". Still bounded at two, because `compile()`
blocks the worker and the old handler cannot wake during it~~ — **measured 2026-08-08: the window
closed to strictly zero instead of widening.** `onRun` calls `dropLive()` before `compile()` runs, so
two `Session` handles are never simultaneously live (`session-worker.ts`'s module doc;
`docs/superpowers/plans/2026-07-19-redextape-roadmap.md:3467-3472`) — but the plan must place the
`free()` explicitly and a test must prove no handle leaks across a supersession.

---

## 4. The panes

### 4.1 Layout

§6.1's arrangement: source and λ side by side, TM across the bottom. Panes are resizable only insofar
as CSS grid gives it for free; a drag-to-resize splitter is not in this slice.

`--step-2`, `--space-4` and `--radius` were declared in PR 3c's `style.css` and consumed by nothing,
kept as "the design's stated foundation for the next plan". This is the next plan. If they are still
unused when 5a-ii lands, they should be deleted rather than carried a second time.

### 4.2 The λ pane — text

Renders `lambdaState().text` with its `Classified` spans through the same `theme.ts` token classes the
source pane uses, so the two panes read as one system. `truncated` is **shown, not hidden** — the
budget is a fact about what you are looking at.

Read-only in 5a. Editing a derived pane is §7.1's detach semantics, which is 5d.

### 4.3 The λ pane — structural tree (5a-ii)

A toggle switches the pane between text and a tree built from `lambdaAst(node_budget)`'s `TermTree`.
This is the arena's first real consumer and therefore the evidence PR #15 asked for.

`nodes` is in **post-order** — every child precedes its parent, and `root` is always `nodes.len() - 1`,
stored anyway so a consumer never encodes that convention (`viewmodel.rs:139-144`). The renderer walks
from `root` down through indices; **nothing derived on it may recurse**, which is the whole reason the
arena exists — a wasm trap does not unwind, so a deep recursive walk poisons the module rather than
returning an error.

`ast` returns `None` for two independent reasons — the node budget refusing, or the arena's own `u32`
index space overflowing first — and a consumer cannot tell them apart. The pane shows "too large to
draw" for both, which is honest, and the plan should not invent a distinction the boundary does not
make.

**Scale is the design problem, not the drawing.** This language lowers naturals to Church numerals, so
`40` alone is ~83 nodes (`λf.λx.` + 40 applications + 41 variables) before anything else in the
program. The tree needs collapsing — subtrees closed by default past a depth, expandable — or it is
unreadable on the first example in the app.

### 4.4 The TM pane — five tapes and a status line

`TAPES = 5` (`build.rs:10`), named `REG`, `WORK`, `STACK`, `HEAP`, `BOX` (`build.rs:22-26`). §6.1's
mockup shows one tape row; the real thing is five, and showing all five at once is the point — you
cannot see `STACK` move while `REG` is read otherwise.

Each row renders `tmState(radius)`'s `window[i]`, with the head marker at `heads[i] -
window_start[i]`. **Both are materialized-tape coordinates, not window-relative ones**
(`viewmodel.rs:108-115`); getting that relation wrong puts the head in the wrong cell, and it is
node-testable arithmetic, so it is node-tested.

The status line reads `state`, `step`, and the fitted `width`. The state *name* comes from
`tmProgram().states[id].name` — so the pane needs `tmProgram()` even in 5a-i, where the table does not
ship.

`tapeSlice(tape, from, to)` exists for scrolling a tape beyond the window. **Not used in 5a**: the
window follows the head, which is what a stepper wants, and free tape scrolling has no consumer until
someone wants to inspect a region the head has left. Recorded so the next reader knows it was
considered rather than missed.

### 4.5 The TM pane — the state table (5a-ii)

The δ function, laid out: one row per state with its rules underneath, current state highlighted and
scrolled into view. This is the same content as a `.tm` file —
`crates/redextape-core/tests/fixtures/list_1_2.tm` is what it looks like for the program `[1, 2]`.

**That fixture is also the scale measurement: 146 states, 464 lines, for a two-element list literal.**
Rebuilt unvirtualized every step that is thousands of DOM nodes per frame, so `virtual-list.ts` renders
only the visible rows — fixed row height, offset arithmetic, no library.

**The table is toggleable, and the toggle is both the feature and the fallback.** It is included on the
explicit understanding that it may prove cluttered or slow; if it does, the honest outcomes are
"default-closed" or "cut to 5f", not a row cap. A table showing 60 of 146 states is a visible lie about
the machine, which this project treats as worse than an absent feature.

The state names are legible structure, not noise — `pc0…pc5` are program counters, `wl1s2.s.sk0` is a
write-literal gadget, `cons5.h.c.cwb` is a cons gadget — and that legibility is what 5b's click-linking
will land a highlight on. The table is built here because it is part of §6.1's pane; its second
consumer arrives in 5b.

### 4.6 Controls

`↺` restart, `◀` back, `▶` forward, `⏵` play, and a step readout. Playback is a main-thread
`setInterval` loop over recorded frames at a fixed 120 ms (`main.ts`'s `PLAY_MS`), no speed control; it
never touches wasm.

`▶` past the recorded frontier is the one control that does: it asks the worker for more. That makes
`▶` and `[continue]` the same operation with different labels, and the plan should implement them once.

Which controls are live in which run status is a state machine, it is where §6's `DepthRefused` trap
lives, and it is node-tested with no DOM.

---

## 5. The ninth export: `tapeNames()`

Five unlabeled tape rows are unreadable. Hard-coding `["REG","WORK","STACK","HEAP","BOX"]` in
TypeScript would reintroduce, one language over, exactly the drift `encodings()` was exported to
prevent — and worse, because not even the Rust compiler is watching a TypeScript array.

`tapeNames()` returns the lowering's convention from `build.rs`'s own constants. **It must be honest
about its limit, and the limit is real:** those names describe machines *this compiler* produced.
`Machine::tapes` is a runtime field, `parse_tm` accepts a hand-written machine declaring any count up
to `MAX_TAPES = 64` (`build.rs:20`), and 5d will introduce exactly such machines. So the pane labels
tape *i* with `names[i]` when one exists and `tape i` otherwise, and the export's doc says so rather
than implying five names describe every machine.

**This is what puts 5a-i under the pre-commit clippy `-D warnings` gate**, so the Rust half must be
complete and clean in whatever commit contains it — the same constraint PR 3c's §11 recorded.

It closes one instance of the hand-copy class. It does **not** close the class: `TokenClass` is still
copied by hand into `types.ts` with nothing checking it against `analysis::TokenClass`, and
`tokenClasses()` remains deferred to whichever slice first needs it (§11).

---

## 6. Error handling

Eight states. Two are traps rather than cases.

| state | behaviour |
| --- | --- |
| analysis failed (`no-session`) | **history cleared**, panes read "not compiled", lint markers stay. Stale frames from the last good compile must not survive under a broken program |
| λ declined | λ pane shows `status.reason`, `declinedSpan` decorates the source (works today), λ controls disabled — **TM stays steppable** |
| TM declined | mirror image; λ stays steppable |
| `Capped` | "still running — hit N steps [continue]"; continue raises the cursor cap and resumes recording |
| `DepthRefused` | **trap.** The continue affordance is *absent*, not disabled-looking. `LambdaCursor::raise_cap` refuses to clear `depth_capped` (`trace.rs:98`, `session.rs:76-77`) — raising the cap provably cannot help, so offering it is a lie the UI would be telling on the backend's behalf |
| recording budget spent | **trap.** Not a cap (§3.5). The run is still `Running`, continuing is free, and the wording must differ from `Capped`'s |
| scrubbed back past eviction | ◀ stops at the oldest retained frame and names its step. The alternatives are lying about where you are or silently re-deriving at a cost the user did not ask for |
| **worker or wasm fails to load** | a banner. PR 3c named this gap and deferred it to a ticket; without it the failure mode is a blank page and a console message |

The λ-declined row deserves its emphasis: **that exact case is what hid PR 3c's worst defect.** The
worker never replied at all for a λ-refusing program, because `run_lambda` answers
`Err(SessionError::LambdaAbsent)` and the binding raises it as a thrown exception. Every test with a
healthy λ leg passed. 5a doubles the number of throwing call sites, so the plan must enumerate which
`Session` methods return `Result` and guard each, the way PR 3c's Task 9 review did.

---

## 7. Testing

**Node tier — pure logic, no DOM.** `history` (byte budgeting, the eviction boundary, head clamping,
pushing after a scrub-back), `virtual-list` windowing math, tape-row math (the `heads[i] -
window_start[i]` relation), tree layout and collapsing, and the controls state machine — which buttons
are live in which status, which is where the `DepthRefused` trap lives.

**Browser tier — real Chromium.** This tier found four defects in PR 3c, and **every one was in the
plan rather than the implementation**. Cases:

1. Compile, step forward, step back — the pane text matches what it showed the first time.
2. Playback runs and halts at the frontier rather than spinning.
3. `[continue]` past a cap actually extends the run and appends frames.
4. **A λ-declining program leaves the TM steppable** — the defect class that hid last time.
5. Tree and table toggles, including that toggling does not lose the play head.
6. Scrubbing into the eviction boundary reports the oldest retained step.
7. No `Session` handle leaks across a rapid supersession (§3.6).

**A measurement, not a test — and it gates the design.** See §8.

---

## 8. Budgets — measured, 2026-08-07

`examples/frame_cost_probe.rs`, run under `systemd-run --user --scope -q -p MemoryMax=2G -p
MemorySwapMax=0`. Nine programs: six rows of `three_way_oracle.rs`'s `FIRST_ORDER_DEMOS` as
calibration, and three written to defeat the bound — `num200`, `list20`, `list60` — because the
roadmap's standing lesson is that a representative corpus cannot falsify.

**Every byte figure below is the JSON size this Rust probe measured, not retained JS heap** — a later
browser measurement (Task 12/13) found the real retained cost per span is ~52.8 bytes against the
~76-byte JSON estimate elsewhere in this document, because V8 interns the fourteen `TokenClass` string
literals that JSON rewrites in full, so the figures below overstate what a browser actually retains
even though the proportion they establish — §3.2's "~95% of a frame is spans" — still holds.

### What it found

**1. Rendering dominates stepping on the λ leg, by 1.1× to 105×.** At the web's 65,536-byte budget
`while4` steps in 0.62 µs and renders in 65.66 µs. The recording model's cost is `lambdaState()`, not
`stepLambda()` — so the budget that controls `lambdaState()` is the only lever that matters, which is
§3.2's subject.

**2. `FRAME_BYTES = 512` — 10-31× faster and ~22× smaller than 65,536.** §3.2, with the table.

**3. The TM leg is three orders of magnitude cheaper and needs no tuning.** Render is **0.12–0.18
µs/step** and a frame is **~300–800 bytes**, against λ's tens of µs and tens of KB. The radius sweep is
flat on time — 0.12 µs at radius 10 and at radius 80 — so **`TM_RADIUS` is a legibility and memory
choice, free on speed.** `TM_RADIUS = 40` (~550 bytes/frame) rather than 20; the wider window is worth
more than the 200 bytes.

**4. The TM's binding constraint is step COUNT, and it is severe.** Per-frame cost is negligible; the
runs are not. `map_fold` takes **266,863 δ-steps** and `list60` **2,172,796** — at ~410 bytes a frame
that is **109 MB** and **890 MB** of history for two programs from the demo suite. On the λ leg the
same programs run 555 and 120 β-steps. **`RECORD_BUDGET` is doing almost nothing on the λ leg and
everything on the TM leg**, which inverts the assumption §3.4's loop was written under.

**5. `compile()` is 0.21–75.44 ms.** PR 3c's open risk 1, unmeasured for two slices, closed: `list2`
0.21 ms, `sample` 0.40 ms, `map_fold` 19.48 ms, `list60` 75.44 ms. Fast enough that §10's
terminate-on-supersede stays rejected — the note in PR 3c's §10 said to reconsider "if `compile()` is
ever measured long enough that abandoning only at a chunk boundary is too coarse", and 75 ms is not.

### The constants

| constant | value | basis |
| --- | --- | --- |
| `FRAME_BYTES` | 512 | §3.2's table; 10-31× faster, ~22× smaller |
| `TM_RADIUS` | 40 | flat on time; ~550 bytes/frame |
| `HISTORY_BYTES` | 32 MB per leg | ~3,200 λ frames at ~10 KB; ~58,000 TM frames at ~550 B |
| `RECORD_BUDGET` | derived from `HISTORY_BYTES` | see below |
| `RECORD_CHUNK` | 256 steps | one abandon check per ~1.5 ms of λ recording at `FRAME_BYTES = 512` |
| `LAMBDA_TREE_NODES` | unmeasured | 5a-ii; `lambdaAst` was not exercised by this probe |

**`RECORD_BUDGET` should not be a step count.** Finding 4 is why: 20,000 steps is nothing on the λ leg
and 8 MB on the TM leg, so a single figure means two different things. The budget that actually bounds
both is `HISTORY_BYTES`, and recording stops when the ring would evict its own first frame —
"recording stopped, history is full at step N" rather than a step constant nobody can interpret. A step
figure survives only as a cheap guard against a pathological λ program whose frames are tiny.

### Still unmeasured

**The browser half.** `render_us` is the Rust cost. The real path adds `serde_wasm_bindgen::to_value`
(a JS object per frame, and per *span* — finding 2's 95% applies there too and probably worse, since a
JS object costs more than its JSON) and a structured clone through `postMessage`. The probe's numbers
say the Rust half is affordable at `FRAME_BYTES = 512`; they do not say the boundary is. **5a-i must
measure a frame's round trip in real Chromium before `HISTORY_BYTES` is final.**

**`lambdaAst`.** No consumer until 5a-ii, and its budget is unmeasured for the same reason.

---

## 9. Considered and not taken

**A framework.** The roadmap's Plan 5 bullet still says "Vite + React + TypeScript" from before PR 3c
chose otherwise; PR 3c shipped plain DOM + CM6 in 795 lines and never recorded the decision. Recorded
now: **no framework.** Every frame is bounded data, per-step re-render of a small subtree is what plain
DOM does well, and the one genuinely hard piece — a fixed-row-height virtual list, ~40 lines — is the
same work under any framework. React would additionally have to be reconciled with CM6, which manages
its own DOM and does not want to be a React child.

**A signals micro-layer.** ~1 KB, no VDOM, CM6 untouched. Rejected as a third paradigm in a file that
already has CM6's state effects, for wins that are small when each pane has one writer.

**Cursor snapshots in Rust, and replay-from-zero.** §3.1.

**The worker owning history.** §3.3.

**`tapeSlice`-driven free tape scrolling.** §4.4 — no consumer until someone wants to inspect a region
the head has left.

**A row cap on the state table instead of virtualization.** §4.5 — a visible lie about the machine.

**Closing `TokenClass`'s drift with a `tokenClasses()` export.** In scope for cheapness, out of scope
for discipline: this slice needs `tapeNames()` and does not need `tokenClasses()`, and exporting on
speculation is how §12 lists grow. Deferred, again, and the deferral is the risk (§11).

---

## 10. Landing order

**5a-i** — layout, λ text pane, TM five tapes + status line, `history.ts`, `controls.ts`, the caps
affordance, the load-failure banner, `tapeNames()`, and the worker's lifecycle and streaming changes.

**5a-ii** — the λ structural tree and the virtualized state table.

The split is clean because 5a-ii holds exactly the two pieces flagged as cut candidates and 5a-i
depends on neither. It differs deliberately from PR 3c's §11 reasoning — that slice was one PR because
its pieces were not independently useful, and here two of them are independently *droppable*, which is
the same test read from the other end.

Within 5a-i the order is forced: `protocol.ts` before both sides of it, `types.ts`'s new shapes pinned
by a browser test before anything consumes them, `history.ts` before `controls.ts`, and `tapeNames()`
complete and clippy-clean in its own commit because of the pre-commit gate.

---

## 11. Open risks

1. ~~**Per-frame cost is unmeasured and could invalidate the recording model.**~~ — **measured
   2026-08-07** (§8). It did not invalidate the model; it moved `FRAME_BYTES` by two orders of
   magnitude and falsified §3.2's frame-size claim. **What replaces it: the TM leg's history is bounded
   by step count, not frame cost** (finding 4), and `map_fold` — a demo-suite row, not an adversarial
   program — wants 109 MB of TM history. If `HISTORY_BYTES` is set too low the TM pane's scrubbable
   window becomes a small tail of a long run, which is a UX problem this design has not solved.
2. ~~**`compile()`'s wall-clock is still unmeasured**~~ — **measured 2026-08-07**: 0.21–75.44 ms (§8).
   PR 3c's open risk 1 is closed and its terminate-on-supersede note stays resolved as rejected.
3. ~~**The boundary cost of a frame is still unmeasured.**~~ — **measured 2026-08-08: 0.063 ms/frame,
   18,103 bytes/frame** (`web/tests/browser/frame-cost.test.ts`, real Chromium, Task 12). §8's last
   section named `serde_wasm_bindgen` plus a structured clone per frame as the half that could still
   make this expensive, and worried finding 2's 95%-is-spans result would land harder in JS objects
   than in JSON. It did not: recording a frame per step at the boundary is cheap in a real browser,
   consistent with the Rust probe's 4-7 µs/step prediction plus `serde_wasm_bindgen`'s per-span
   object-construction overhead. `HISTORY_BYTES` and `RECORD_CHUNK` need no revisiting on this
   evidence.
4. ~~**The two-session window widens** (§3.6) from "until the next yield" to "until the next
   compile".~~ — **measured 2026-08-08: it closed rather than widened** (§3.6). `onRun` calls
   `dropLive()` before `compile()` runs, so two `Session` handles are never simultaneously live — the
   window PR 3c's review flagged strictly zero rather than merely bounded (`session-worker.ts`'s
   module doc; `docs/superpowers/plans/2026-07-19-redextape-roadmap.md:3467-3472`).
5. **The virtualized table may be cluttered or slow.** Explicitly an evaluate-and-maybe-cut item; the
   toggle is the fallback and §4.5 names the two honest outcomes.
6. **`TokenClass`'s hand-copy drift survives another slice.** A variant added to `analysis::TokenClass`
   and not mirrored in `types.ts` arrives as an unstyled span rather than an error.
7. **The λ tree meets Church numerals immediately** — ~83 nodes for the literal `40`. If collapsing is
   not enough, the tree is a worse view than the text and 5a-ii should say so rather than ship it.
8. **`RECORD_BUDGET` trades the instant λ answer for a history.** §3.4. Softened by §8: the λ leg's
   step counts are small (555 for `map_fold`, 120 for `list60`), so the programs measured here would
   all record to completion. The risk is real only for a λ run in the thousands of steps, and none of
   the demo suite is.
9. **`num200` declines the TM leg with `Overflow`** — `let x = 200; x + 1` under `Unary`, found by the
   probe. Not a defect: it is a one-leg session, exactly the asymmetric case §6 says the panes must
   handle, and it is now a known program to test that path with.

---

## 12. What this slice settles, and what it hands on

**Settled:** whether an arena is the shape a renderer wants (§4.3), by building the renderer rather
than by reasoning about it. If the answer is no, the arena design's §9.3 deletion question **reopens**
rather than staying settled by this slice's silence — which is what PR #15 asked for and PR 3c could
not supply.

**Handed on:** 5b gets a state table to land a highlight on and a λ pane to highlight a span in. 5c
still needs a λ redex→source coordinate system that survives reduction, and nothing here builds one.
5d gets the pane chrome it will make editable, and inherits the question of what `tapeNames()` should
say about a hand-written machine.
