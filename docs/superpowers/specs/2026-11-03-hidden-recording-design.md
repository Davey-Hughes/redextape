# Hidden recording — design

The user's request (2026-11-03), after trying the step-focus branch's TM step bar `↺ ◀ ▶ ⏭ ⏵`: a way back to step 0
once early steps were dropped, and a way to let a run go on for ever while old steps are dropped. In the
brainstorm that followed he answered eight questions (Q1-Q8, §2) and approved four design sections, which are §4 to
§7 and §9 here. Reviewing this spec on 2026-11-04 he answered its four open questions (Q-a to Q-d, §2, §12).
Together they make the recording an implementation detail: the step bar steps, plays and runs, and the worker keeps
recording ahead of the play head on its own.

Code facts were read at `1b2f0cb` (#162), which `origin/main` was when fetched on 2026-11-03. The step-focus branch, not
merged, was read at `940295c`. Step-focus merged as #163 (`ec4f11a`), and PR A's plan re-read what PR A touches there:
`git diff --stat 1b2f0cb ec4f11a -- crates web/src web/help.html` names six files, of which PR A touches
`web/src/controls.ts` and `web/src/step-controls.ts`, and the line references into those two below are `ec4f11a`'s. "The
record" is `~/temp/redextape-history-restart-record/`: its `progress.md` holds the user's answers and approvals,
`facts.md` the read-only fact-finding, `probes/` the node probes and `logs/` their output. The probes load the wasm
package built from `1b2f0cb` (`wasm-pack build ../crates/redextape-wasm --release --target web`, run from `web/`) and
drive its `Session` the way the worker's record loop does (§8).

## §1 The goal, in the user's words

> "the confusing thing is the restart button after pressing 'history is full' doesn't go back to step 1, and there
> doesn't seem to be a way to do so. also there should be a way to do 'keep recording' forever and just let it execute
> while ejecting old history from memory"

And, when asked where a "forever" control should live (Q3):

> "I sort of feel like the recording thing is an implementation detail that is not that important to surface to users
> outside of documentation"

**Goals.**

- G1. ↺ always goes to step 0 of its own view, re-recording that view's leg when step 0 was dropped (Q1, Q2).
- G2. Nothing in the step bar or the readout talks about recording. The view steps, plays and runs; the help page
  explains the window of kept steps (Q3, Q4).
- G3. ⏵ plays on past the step cap for as long as a view shows its leg and it is not stopped; ▶ and ⏭ stop at the
  cap, and so does ⏵ on a leg no view shows (Q5, Q6, Q-a).
- G4. The step line shows the run's real length where it is known (Q7).
- G5. The worker records ahead of the play head on its own, so that ⏵ at the top speed of 5,000 steps/s never waits
  on the TM and rxm legs (Q8, §5.3).
- G6. The tab stays safe on λ runs that go on and on, one or several at once (Q6, Q-d, §5.5).

**Anti-goals.**

- A1. No setting and no memory control. `HISTORY_BYTES` (`web/src/protocol.ts:102`) stays the one per-leg budget.
- A2. No second ring and no snapshots: going back to step 0 drops the window the user was on (facts §2).
- A3. `RECORD_CHUNK` (256, `protocol.ts:155`) and `MAX_WARM_BUFFERS` (8, `web/src/scratch.ts:154`) are unchanged.

## §2 The user's decisions (2026-11-03 and 2026-11-04)

- Q1. "↺ goes to step 0": ↺ always means the start. If step 0 was dropped it re-records from 0 and drops the current
  window. Its tooltip is "back to step 0". Not chosen: a separate start-over control; ↺ pressed twice.
- Q2. "Only that view": ↺ rewinds only its own view's leg, and the other views keep their place. Not chosen: a
  whole-session rerun.
- Q3. Recording is an implementation detail, documented and not surfaced (his words above). ▶ and ⏵ just keep going.
- Q4. "Quiet hint": at the oldest kept step ◀ greys out and the step line adds a short note, "earlier steps dropped";
  ↺ still goes to step 0. Not chosen: nothing shown.
- Q5. ⏭ "To the end": runs to the program's end or the step cap, dropping old steps; waits greyed with its focus kept
  while it runs; a second press stops it where it got to. Not chosen: removing ⏭; keeping "newest recorded".
- Q6. "⏵ passes it, ⏭ stops": ⏵, which is watched and stoppable, plays on past the step cap, and that is the
  "forever". ⏭ and ▶ stop at the cap with "stopped at the step cap" and `continue`. λ memory may need a limit
  regardless, which this design proposes (§5.5). Not chosen: every control stops at the cap; no cap.
- Q7. "Real length": `step C of TOTAL`, TOTAL from compile's run on TM and rxm, `of 5,000,000+` when that run was
  capped; λ, which is not run ahead, shows `step C` until its end is known. Not chosen: the step alone.
- Q8. "Worker streams ahead": the worker keeps a lookahead recorded ahead of the play head on its own, with
  backpressure, a bounded message rate and its own stop; the page reads frames. Not chosen: the page asking for more
  as it plays.

He then approved the design in four sections, recorded in the record's Log: what the user sees (§4 here), the
worker's streaming (§5), the edge cases (§6), and the tests and the PR split (§7, §9). The Log records it as
"DESIGN APPROVED". Each of those sections names its approved section in its heading.

On 2026-11-04, reviewing this spec, he answered its open questions:

- Q-a. "Only while shown": ⏵ passes the step cap only while some view shows the leg. A leg playing unseen stops at
  the cap, as ▶ does, and its view says so when it comes back. Not chosen: ⏵ passes the cap whether or not the leg is
  shown.
- Q-b. "stop here": ⏭'s name and tooltip read "stop here" while it runs and "to the end" otherwise. Not chosen: "to
  the end" throughout.
- Q-c. "`step C`": a TM copy shows `step C` until its end is known, as λ does, with no run ahead at its build. Not
  chosen: a run ahead at the build, which costs the build time.
- Q-d. "Per tab, shared": one λ memory budget for all the λ workers in the tab, summed by the page, its figure
  measured in PR B. It replaces a limit of 512 MiB per worker. Not chosen: a limit per worker.

On 2026-11-04 he ruled PR A's plan call P4, "`step 0 of 0…`, ↺ waits": while a rewind's first frames are on their
way, the step line reads `step 0 of 0…` and ↺ waits, greyed with its focus kept (§9). Not chosen: `step 0…`; keeping
the old window shown until the first new frame.

## §3 What exists

- **↺** is `restart: () => { taken(slot).hist.seek(0); draw() }` (`web/src/transport.ts:268-271`). `History.seek`
  clamps to the oldest kept frame (`web/src/history.ts:119-123`), so after an eviction ↺ goes to the oldest kept step,
  never to step 0. Its name is `back to the oldest kept step` (`web/src/step-controls.ts:49-51`).
- **Recording.** `onRun` compiles, then records λ, rxm and TM in that order, each from step 0 to one `HISTORY_BYTES`
  of sizer charge (`web/src/session-worker.ts:593-595` for the order; `recordLeg`, `web/src/record-loop.ts:88-135`).
  The allowance is checked before each step, so the cursor stays on the last frame recorded. *Keep recording*,
  *continue — raise the step cap* and ▶ at the frontier all post `{ kind: 'extend', gen, leg }`
  (`protocol.ts:487`); `onExtend` grants one more `HISTORY_BYTES` from where recording stopped
  (`session-worker.ts:815`) and raises a capped cursor's cap by `EXTEND_STEPS` (100,000, `protocol.ts:227`).
- **The ring.** `History` keeps a byte budget, drops oldest-first and never drops the newest frame. A head parked on a
  frame that is dropped moves onto the oldest kept step (`history.ts:103-117`, the drag at `:110`).
- **The player** walks recorded frames in one `requestAnimationFrame` loop and stops at the frontier (`player.ts`'s
  `createPlayer`, `tick`; the rule at `web/src/player.ts:14-15`).
- **No rewind and no stop exist.** `RunRequest` has `run`, `lambda-scratch`, `tm-scratch`, `rxm-scratch`, `extend` and
  `lambda-tree` (`protocol.ts:441-492`). None of the three cursors can rewind (facts §1). A recording stops only at its
  allowance, its end, its cap, a refusal, or a newer generation (`record-loop.ts:108-110`).
- **Links** continue a leg towards its position on each `result`, one leg at a time, at most
  `MAX_LINK_CONTINUES = 10` times per leg per open (`web/src/share-positions.ts:24-25`, `#result` at `:207-219`).
- **The cursors' ingredients.** TM: `tm_leg_at` builds `TmCursor::new(machine, init, caps)` from an `Rc<Machine>`
  (`crates/redextape-wasm/src/session.rs:457-470`), and `TmCursor::machine` returns `&Machine`, not the `Rc`
  (`crates/redextape-core/src/trace.rs:321`). rxm: `RxmLeg::run` runs the program to its end, then opens a fresh
  `RxmCursor::new(program, caps)` (`session.rs:528-542`). λ: `LambdaLeg::new` pairs a `LambdaCursor` with
  `LambdaCheckpoints`, which keeps the step-0 cursor as its first entry (`session.rs:636-640`; `trace.rs:200-211`);
  `LambdaCheckpoints::at` lifts the clone's cap to `u64::MAX` (`trace.rs:233-244`).
- **Step-focus** (#163, `ec4f11a`) added `ControlState.recording`, `v.length > 0 && v.done === null &&
  !v.awaitingRun` (`web/src/controls.ts`, `controlState`), and a waiting rule in `web/src/step-controls.ts`'s
  `update`: a focused ▶ or ⏭ that a recording turns off waits as `aria-disabled` (`const waits = !live && held.waits
  && c.recording`), and `[continue]` going away as its recording starts hands the focus to ▶ (`if (c.continueLabel ===
  null && c.recording) handOff(extend, [forward])`).
- **The example's base figures** (facts §0, node, worker side): `compile` 427 ms; the TM leg's first fill 91,182
  frames in 566 ms, with compile's TM run capped at 5,000,000 steps; the rxm leg's 56,588 frames in 1,153 ms, its run
  1,000,008 steps to a halt; the λ leg refused at step 0 for depth.

## §4 What the user sees (approved §1)

### §4.1 The step bar

| control | name and tooltip | what it does |
| --- | --- | --- |
| ↺ | back to step 0 | Goes to step 0 of this view's leg. With step 0 still kept it is a seek, as today. With step 0 dropped it rewinds this leg alone: its kept steps go, it records again from step 0, and the head lands on step 0. Other views keep their place (Q1, Q2). |
| ◀ | one step back | One step back, as today, and stops ⏵. At the oldest kept step it is greyed and the step line adds `· earlier steps dropped` (Q4). |
| ▶ | one step forward | One step forward, and stops ⏵. When the next step is not recorded yet it waits, greyed with its focus kept, and takes the step when it arrives. At a cap stop it records further, as `continue` does (today's ▶ at the frontier). |
| ⏭ | to the end; stop here while it runs (Q-b) | Runs to the program's end or the step cap, dropping old steps as it goes, with the view following. While it runs it waits greyed with its focus kept, named `stop here`; a second press stops it where it got to (Q5), and its name goes back to `to the end`. Stops ⏵. At the cap: `stopped at the step cap` and `continue`. |
| ⏵ / ⏸ | play / pause | Plays at the chosen speed. At the recorded frontier it holds, with `…` on the step line, until the next step arrives. It plays past the step cap while some view shows its leg (Q6, Q-a); a leg playing in no view stops at the cap, as ▶ does, and its view shows `stopped at the step cap` and `continue` when it comes back. It stops at the program's end, a depth refusal, an rxm stack, heap or frame cap, or the λ memory limit (§5.5). |
| `continue` | continue | Shown only when the step cap stopped ▶, ⏭, the lookahead, or ⏵ on a leg no view showed. Raises the cap by `EXTEND_STEPS` and the view goes on. The only user-facing `extend` left (§5.2). |

The speed select is unchanged (1/s to 5,000/s, default 8, `web/src/workspace.ts:34-37`).

### §4.2 The step line

- **TM and rxm, a program's legs:** `step C of TOTAL`, where TOTAL is compile's `total_steps` (`TmStatus::total_steps`,
  `session.rs:216-252`; `RxmStatus::total_steps`, `:312`). When compile's run was capped, TOTAL is the cap and the line
  reads `step C of 5,000,000+`, and keeps that form past the cap while ⏵ plays on (`step 5,100,000 of 5,000,000+`). Once
  the leg's recording ends past a raised cap, TOTAL is that end.
- **λ:** `step C` until the leg's end is known, then `step C of N`.
- **Copies:** an rxm copy runs its program to its end (`RxmLeg::run`, `session.rs:1490`) and reads as rxm. A TM copy
  has no `total_steps` (`TmScratchStatus`; `web/src/tm-pane.ts:614`), so it reads as λ does, `step C` until its end
  is known, and its build runs nothing ahead (Q-c).
- **Tails**, at most one stop reason: ` …` while the head waits for a step not recorded yet; ` · earlier steps
  dropped` at the oldest kept step once steps were dropped; ` — stopped at the step cap`; the end reasons that stay
  (`depth-refused`, `stack-full`, `heap-full`, `memory-full`); the λ memory limit's (§5.5); ` — recompiling`; and a
  link's ` — going to step N from the link`. A stop reason and `continue` show once the head is on the newest kept
  step, where ▶ meets the stop, not while the lookahead holds steps before it (§11, call 12). The plan words them.
- **Removed:** `keep recording` (`controls.ts:137`), ` — history is full` (`doneText`, `controls.ts:69-86`),
  ` (oldest kept: step N)` (`controls.ts:143`), the readout strip's "history is full at N" rows for rxm and TM and the
  λ run row's `budget: 'history is full'` (`web/src/readout.ts:58-90`, `:136`). ` — spent its step budget` becomes
  ` — stopped at the step cap`.

### §4.3 The help page

`web/help.html:30-33` names ↺ "back to the oldest kept step" and offers *keep recording*. It becomes: ↺ back to step
0; and a short passage on the window: each view keeps its most recent steps, earlier ones are dropped as a run goes
on, ◀ stops at the oldest kept one, ↺ runs the view again from step 0, ⏵ plays past the step cap while a view shows
it, and ▶ and ⏭ stop at it. The plan words it.

### §4.4 The step-focus waiting rule

step-focus's `recording` is true whenever frames are in flight. Under streaming that is almost always, so a waiting ▶
would wait for ever. The rule narrows to the user's "next step not there yet":

- `ControlState.recording` is replaced by `waiting`: the head is on the newest kept frame and the leg's stream will
  record a next step (`done` is `null` and no stop is pending). In step-focus's `controlState`.
- ▶ waits when it is focused, not live, and `waiting` holds; it takes the step when the frame arrives. In
  step-focus's `step-controls.ts` `update`, `waits = !live && held.waits && c.waiting`.
- ⏭ waits while its run is in flight, `ControlState.running`, greyed by `aria-disabled` and still taking presses,
  focused or not, since its second press is the stop (Q5). Its name and tooltip read `stop here` while
  `ControlState.running` holds and `to the end` otherwise (Q-b).
- `[continue]` going away as its recording starts hands the focus to ▶ on `c.waiting`, as it does on `c.recording`
  today.
- At the run's end a waiting ▶ or ⏭ hands the focus on by its own list, which puts ◀ first for ▶ and first after ▶
  (off at the end) for ⏭ (step-focus's `buttons` table). That is §6's "halt → focus to ◀".

## §5 The worker streams ahead (approved §2)

### §5.1 Modes

Each leg of what is live (a program session's three legs, or a copy's one) is in one mode, held by the worker:

| mode | entered by | records | leaves on |
| --- | --- | --- | --- |
| `follow` | a first fill's end, a `rewind`'s first fill, a `stop`, a run reaching its `to`, a `continue` | while the lookahead is under the high mark; pauses at it; resumes when a `head` brings it under the low mark (§5.3) | `run`, `head` with `playing: true` and `shown: true`, an end |
| `play-past-cap` | `head` with `playing: true` and `shown: true` | as `follow`, and at a cap hit raises the cap by `EXTEND_STEPS` (and `EXTEND_CELLS` on TM, `protocol.ts:228`) and records on | `head` with `playing: false` or `shown: false` → `follow`; `run`; an end |
| `run` | `run` (⏭, or a link with `to`) | without pausing, to the end, the cap (never raised), `to`, or a `stop` | `stop`, `to` reached, the cap → `follow`; an end |
| `ended` | the run's end, a depth refusal, an rxm stack, heap or frame cap, the λ memory limit (a `memory-limit` request, §5.5) | nothing | `rewind` → `follow` |

A cap stop in `follow` or `run` leaves the leg in `follow` with `done: 'capped'`, which records nothing until a
`continue` or a `head` with `playing: true` and `shown: true`. So a leg that ⏵ plays while no view shows it stops at
the cap in `follow`, as ▶ does (Q-a). A `rewind` from any mode ends a run first. A newer generation (a
recompile) drops every stream, as today: the loop returns at its handle check (`record-loop.ts:108-110`).

**The first fill** after a compile, a copy's build or a `rewind` records one `HISTORY_BYTES` from step 0, as today's
does, with the head on step 0. Behind plus ahead is then one window, and the stream stays paused until the head comes
within the low mark of the frontier. This keeps the λ leg's value decided by the same recording as today
(`session-worker.ts:590-592`: "its recording is what decides its value") and the first fill's time unchanged (§11, call
3).

### §5.2 Requests and replies

Page to worker (`RunRequest`, `protocol.ts:441`):

- `{ kind: 'head'; gen: number; leg: Leg; epoch: number; step: number; playing: boolean; shown: boolean }`: where
  the leg's play head is, as an absolute step, whether ⏵ plays it, and whether some view shows it (Q-a). At most one
  per leg per animation frame, and only when one of `epoch`, `step`, `playing` or `shown` changed (§5.7).
- `{ kind: 'run'; gen: number; leg: Leg; epoch: number; to: number | null }`: ⏭ with `to: null`; a link's position
  with `to: N`.
- `{ kind: 'stop'; gen: number; leg: Leg; epoch: number }`: ends a `run`: ⏭'s second press, or ◀, ▶ or ⏵ during a
  run. ↺ needs none, since `rewind` ends a run itself.
- `{ kind: 'rewind'; gen: number; leg: Leg; epoch: number }`: rewinds the leg to step 0; `epoch` is the leg's new
  epoch.
- `{ kind: 'extend'; gen: number; leg: Leg; epoch: number }` stays, as `continue` alone: it raises the cap by
  `EXTEND_STEPS` and returns the leg to `follow`. Its allowance grant (`session-worker.ts:815`) goes.
- `{ kind: 'memory-limit'; gen: number; epoch: number }`: ends the worker's λ leg with `done: 'memory-limit'`, posted
  when the page's sum of the λ workers' memory says that leg stops (§5.5); `epoch` is the λ leg's.
- The compile request, today `{ kind: 'run'; gen; src; encoding }` (`protocol.ts:442`), becomes `{ kind: 'compile';
  gen; src; encoding }`, so that `run` is the user's word for ⏭'s request (§11, call 1).

Worker to page (`RunReply`):

- `lambda-frames`, `tm-frames` and `rxm-frames` (`protocol.ts:673-675`) gain `epoch: number` and `running: boolean`
  (the leg is in `run`). The page drops a frames reply whose `epoch` is not its leg's. `lambda-frames` also gains
  `memory: number` and `mark: number`: the worker's wasm memory after the chunk, and the leg's mark (§5.5).
- `RecordEnd` (`protocol.ts:264`) loses `budget`, which no longer stops anything the user sees, and gains
  `memory-limit` (§5.5).
- A session's `result` is posted after the first fills, as today, and again when a λ leg's recording reaches its end,
  so the results readout learns the λ value it decides. A `rewind` posts none, and the readout keeps the last value.

**Epochs.** A leg's epoch is a count on the page (`LegState`, `web/src/sessions.ts:33`) and in the worker, both 0 at
a compile and raised by one per `rewind`. Frames already posted when the worker takes a `rewind` are still in the
page's queue, and a `head` the page posted before its ↺ is still in the worker's. The epoch is what lets each side
drop the other's stale messages for that leg alone; `gen` cannot, since raising it would reset every leg.

### §5.3 The lookahead and its marks

`ahead` is the sizer charge of the frames recorded past the head's step, in the units the ring counts
(`lambdaFrameBytes`, `tmFrameBytes`, `rxmFrameBytes`, `protocol.ts:276-374`). The worker keeps the cumulative charge
at the end of each reply it posts, so `ahead` is `recorded − charge at the head's step`, to within one reply. The
marks are fractions of the window, the same for every leg:

- **High mark: `LOOKAHEAD_HIGH = HISTORY_BYTES / 4`** (8 MiB of charge).
- **Low mark: `LOOKAHEAD_LOW = HISTORY_BYTES / 8`** (4 MiB of charge).

On the example those are, from the measured charge per quarter window (§8): TM, 22,800 steps high and about
11,400 low, which ⏵ at 5,000 steps/s takes 4.6 s and 2.3 s to play; rxm, 14,150 and about 7,070, or 2.8 s and 1.4 s;
λ on `fact-12`, about 355 and 177, or 0.07 s and 0.035 s.

**Why these marks.** ⏵ reaches the frontier only if, once `ahead` falls under the low mark, the worker's new frames
take longer to reach the page than the low mark takes to play. That delay is at most one animation frame for the
`head` (the player clamps a frame to `MAX_FRAME_MS`, 100 ms, `player.ts`), one chunk of whatever leg the worker is
recording, one chunk of this leg, and the reply's transit, which is not measured. From the longest chunks measured
(§8), the delay without transit:

| case | longest chunks | delay, at most | steps ⏵ plays meanwhile |
| --- | --- | --- | --- |
| full speed, TM and rxm | 2.7 ms TM, 5.2 ms rxm | 110.4 ms | 552 |
| `CPUQuota=25%`, TM and rxm | 88.4 ms TM, 88.0 ms rxm | 276.8 ms | 1,384 |
| full speed, with a λ chunk of `fact-12` by step 2,835 | 140.6 ms λ | 245.8 ms | 1,229 |
| `CPUQuota=25%`, with that λ chunk | 883.8 ms λ | 1,072.2 ms | 5,361 |

The low mark's smallest figure, rxm's 7,070 steps, covers all four. Once resumed, the worker gains on ⏵: alone, TM
records at 236,011 to 324,367 steps/s and rxm at 95,434 to 102,855 at full speed, and at 28,527 to 45,973 and 11,775 to
23,290 under `CPUQuota=25%`. Both legs playing at 5,000 steps/s at once take 7.4 % of the worker at full speed and 60 %
of it at 25 %, from the slowest quarters (5,000/236,011 + 5,000/95,434, and 5,000/28,527 + 5,000/11,775). The gap
between the marks sets how often the worker wakes: at 5,000 steps/s TM refills an eighth of the window every 2.3 s, in
35 to 48 ms at full speed (half a quarter's 70.3 to 96.6 ms). λ can catch up, and the marks do not try to stop it:
`fact-12`'s λ records at 42,665 steps/s at first and at 2,079 by step 2,835, and ⏵ above that rate holds at the
frontier with ` …`.

**Turns.** A λ leg that cannot keep up with its play head never pauses, and its chunks are long: 140.6 ms on
`fact-12` at full speed, against about 1 ms for 256 TM frames. Taking turns chunk by chunk would cut TM to about 256
frames per 141 ms, 1,800 steps/s, and ⏵ at 5,000 would catch it. So the worker serves first a leg refilling from
under its low mark, until it reaches its high mark, round-robin by chunk among such legs; a leg in `run` and a leg
whose head waits at its frontier share what is left, one chunk a turn. `RECORD_CHUNK` is unchanged, and every chunk
still ends in a yield, so requests are taken between chunks as today.

**What is not measured.** These are worker-side figures from node. The page's side, the structured clone's
deserialisation, the ring's pushes and the draws, is not measured here. #136's page figure, 145,904 TM frames in 570
replies over 200 to 233 ms (facts §4), puts a refill of 11,400 TM frames at about 16 to 18 ms of the main thread, by
proportion. A browser on a slower machine than `CPUQuota=25%` of this one is not measured either.

### §5.4 The per-leg rewind

New `Session` methods, one per leg, and the same name on the copy that carries that leg, so the worker's leg tables call
one method per leg as they call `stepTm` and its siblings (`LAMBDA_RECORDING`, `TM_RECORDING` and `RXM_RECORDING`,
`session-worker.ts:363-452`):

- `Session::rewind_tm(&mut self) -> Result<(), SessionError>` (`rewindTm`), and `TmScratch::rewind_tm(&mut self)`. A
  fresh `TmCursor::new(machine, &header.init(machine.tapes), caps)` with compile's caps. The leg keeps an
  `Rc<Machine>` and its `TmCaps` beside the cursor, since `TmCursor::machine` hands out `&Machine` only. A raised cap
  goes back to compile's.
- `Session::rewind_rxm(&mut self) -> Result<(), SessionError>` (`rewindRxm`), and `RxmScratch::rewind_rxm(&mut self)`.
  `RxmLeg` keeps its `Rc<Program>` and caps and opens `RxmCursor::new(Rc::clone(&program), caps)`; `total_steps` and
  `end` are compile's run and do not change.
- `Session::rewind_lambda(&mut self) -> Result<(), SessionError>` (`rewindLambda`), and
  `LambdaScratch::rewind_lambda(&mut self)`. A new `LambdaCheckpoints::rewind(&mut self) -> LambdaCursor` in core drops
  every checkpoint after the first and returns a clone of the first at its own cap; `at(0)` cannot serve, because it
  lifts the cap. A λ copy forked at a step goes back to the first step it holds.

The worker's `rewind` arm sets the leg's epoch, ends its loop (the loop checks the epoch at each chunk and returns as
silently as a superseded generation does), calls the rewind method, resets the leg's `recorded`, charges and mode, and
records the first fill with `emitInitial`. The page's ↺, with step 0 dropped, raises the leg's epoch, clears its ring
and its `done`, and posts `rewind`.

### §5.5 The λ memory limit

**The budget: one per tab, `LAMBDA_MEMORY_BUDGET`, shared by every λ worker in it (Q-d).** A λ worker is one that
carries a λ leg: a program session's worker, and each λ copy's. Its memory is the `memory` of the `InitOutput` that
the worker's `init()` resolves to (`const ready = init()`, `session-worker.ts:232`), read as
`memory.buffer.byteLength`. Each leg's mark is its worker's memory when the leg last started from its first step, at a
compile, a copy's build or a `rewind`. This spec sets no figure for the budget: PR B's plan must measure it. A tab's
own memory limit in a browser, which differs by browser and device, is not measured here either.

**What the page does.**

- Each λ worker reports its memory: every `lambda-frames` reply carries `memory` and `mark` (§5.2).
- The page sums the latest report of each λ worker in the tab. A worker's report stays in the sum until the worker is
  terminated, as a copy's is when it is put to sleep or retired (`web/src/scratch.ts:484`, `:949`), since its memory
  never shrinks.
- When, on a report, the sum is over the budget and that worker's `memory` is past its `mark`, the page posts
  `memory-limit` to that worker, which ends its λ leg with `done: 'memory-limit'` (§5.2). So the leg that stops is the
  one whose recording pushes the total over, and after it any leg that records on past its own mark while the total
  stays over (§11, call 14). The worker takes the request at its next chunk's yield (§5.3), so the sum passes the
  budget by the growth of the chunks it records meanwhile.

**Why it reads the memory, against a mark.** Wasm memory never shrinks. A rewind frees the checkpoints into the
allocator, but `byteLength` stays where it was, so a limit read from the sum alone would stop the rewound leg at its
first chunk once the total is over, and ↺ would not recover. Measured (§8): after the λ leg of `fact-12` reached
957.6 MiB at step 2,311,000, a fresh session in the same instance recorded the same 2,311,000 steps again without
growing the memory by a byte. So a rewound leg reaches the step it stopped at before its worker's memory grows
again, and its mark lets it, within the shared budget: once the total is over, a λ leg records on only as far as
memory its worker already holds lets it.

**The measured growth.** On `fact-12`, the repo's λ-heavy example, recorded as the worker records it, the λ leg's
worker grew from 16.3 MiB at step 0 at 311 to 502 bytes a step, about 30 to 48 MiB per 100,000 steps, rising as the
term grows, and 428 bytes a step overall to step 2,300,000. It passed 512 MiB between steps 1,400,000 and 1,450,000,
after about 427 s of recording at 3,076 to 3,589 steps/s (§8). λ records no faster under ⏵ or ⏭, so a λ view played
or run on holds 512 MiB after about 7 minutes. Each report reads the whole instance, so a program session's TM and
rxm legs count towards the sum, and they were measured at 20.9 MiB together with the instance's baseline (§8).

**Why per tab.** A tab holds one worker per program session and up to `MAX_WARM_BUFFERS` (8) copies' workers, so a
limit per worker bounds each worker and not the tab: at 512 MiB each, nine λ legs each run for about 7 minutes would
hold about 4.5 GiB. The one budget bounds what the tab's λ workers hold together, past it only by the overshoot
above (Q-d).

The stop reads like a refusal: no `continue`, and ↺ recovers.

### §5.6 Links

A link's position for a leg becomes a `run` with `to` set to the position. On a run's first `result`, the first leg
in λ, rxm, TM order still short of its position gets that `run`; when its frames say `running: false`, the next leg
short of its position gets one, so two recordings still do not interleave (`share-positions.ts:201-206`). A run with
`to` stops at the cap and never raises it, so the cap bounds what a hand-edited link can cost, where today's bound is
the tenth continue (6a spec row 16). `MAX_LINK_CONTINUES` and `ShortOf`'s `'continues'` go; `ShortOf` gains
`'capped'`, and the notice says the link's step lies past the step cap. A gesture still drops the pending position
(`transport.ts`'s `taken`, `:207-216`). What the cap costs on the example is in §8.

### §5.7 The page's play-head reporting

A new module, `web/src/head-report.ts`, `createHeadReporter({ frame, post })`, node-tested as `player.ts` is, with
`frame` injected. `draw()`, the app's one repaint (`createDraw`, `web/src/draw.ts:67`), calls it; on the next animation
frame it posts one `head` for each leg of each live session, shown or not, whose `epoch`, `hist.currentStep`,
`playing` or `shown` changed since its last post, so a view that stops or starts showing a playing leg is reported
(Q-a). The player, the step controls and a link's seek all move the head through
`History` and then draw, so every head move is reported through this one place.

The player's `tick` (`player.ts`) changes in one place: at the frontier, a leg whose `done` is `null`, or `capped`
while some view shows it, stays playing, with its carry dropped, where today it clears `playing`. `capped` is held on a
shown leg because a `head` with `playing: true` and `shown: true` makes the worker raise the cap (§5.1). A leg no
view shows stops playing at a `capped` frontier, as at the other ends, so its view shows the cap stop and `continue`
when it comes back (Q-a).

## §6 Edge cases (approved §3)

- **A recompile** drops every stream; the new generation's first fills start from step 0, as today.
- **↺ during a ⏭ run** stops the run, then rewinds: the worker's `rewind` arm ends a run first, so one request does
  both.
- **⏭ stops ⏵; ▶ and ◀ stop ⏵.** ↺ leaves ⏵ as today's ↺ does, so a playing view plays on from step 0 (§11, call 4).
  ◀, ▶ and ⏵ during a ⏭ run stop the run first (§11, call 13).
- **At the frontier** ▶ waits, ⏵ holds, and the step line ends in ` …`.
- **At the run's end** a waiting ▶ or ⏭ hands the focus to ◀ (§4.4).
- **A depth refusal and the rxm stack, heap and frame caps** cannot be continued, as today (`controls.ts`'s
  `continueLabel`, which offers none for them).
- **The λ memory limit** stops a λ leg like a refusal, with no `continue`; ↺ recovers, since a rewind drops the
  checkpoints that hold the memory (§5.5). The budget is the tab's, so it can stop a leg that holds less than another
  (Q-d, §11 call 14).
- **`follow` never drops the head's step.** The ring holds behind plus ahead. Ahead is a whole window only after a
  first fill, when nothing more is recorded until it falls under the low mark; after that it stays under the high mark
  plus one reply, a quarter of the window, so the ring drops only frames behind the head. In `run` the head follows the
  newest frame, which the ring never drops.
- **Copies** stream in the same modes. `MAX_WARM_BUFFERS` stays 8.
- **Two legs streaming in one worker** take turns at the chunk yields (`record-loop.ts`'s `yieldToEventLoop`), a
  refilling leg first (§5.3). A λ chunk the worker is already in delays the others by its length (§8 gives the longest
  measured). A pathological λ step, like the 19.0 s
  β-step 5a cites (`docs/superpowers/specs/2026-08-07-plan5a-panes-and-history-design.md:126-128`), blocks the worker
  for as long as it takes, and ⏵ on another leg holds at its frontier with ` …` meanwhile.
- **A playing leg no view shows** passes no cap (Q-a): its `head` says `shown: false`, the worker returns it to
  `follow`, and the cap stops it there. Its head plays on to the cap stop and stops playing, and its view, when it
  comes back, shows `stopped at the step cap` and `continue`. A view that shows it again before its head reaches that
  stop, with ⏵ still playing, makes the worker raise the cap and the leg plays past it again. A raise the worker made
  while the leg was shown stands, so a leg that leaves every view after one plays on to the raised cap and stops there.
- **A background tab** gets no animation frames, so ⏵ moves no head, no `head` is posted and the worker stays paused
  at the high mark.
- **A ⏭ stopped by its second press:** the page stops following at the step shown, and frames already in flight join
  the lookahead ahead of the head.
- **A `head` or frames reply from an older epoch** is dropped by the side that receives it (§5.2).
- **The step line past the cap** reads `step C of 5,000,000+` with C over 5,000,000 (Q7's form, kept).
- **↺ with step 0 still kept** is a seek and posts nothing, as today.
- **↺ during a recompile** is a seek, as today, even with step 0 dropped. The worker may already have started the new
  generation and would take a `rewind` for it, while the page resets the leg's epoch when that generation's `compiled`
  reply lands and would then drop every frame the rewind recorded. The new generation's first fill starts from step 0
  anyway. This was settled with PR A's plan (2026-11-04) and not asked, since the screen does what it does today.
- **↺ on a copy whose last edit did not parse** is a seek too, even with step 0 dropped. Every copy build drops what
  the worker held before it parses, so after a failed parse the worker holds nothing to rewind, while the page keeps
  the last good frames (5d-iii design §4.4) and is no longer awaiting a reply. ↺ therefore rewinds only while the
  leg's frames are the generation the page last asked for, which a recompile in flight also fails. This is the
  controller's call on PR A's Task 2 review (2026-11-04), not asked, for the reason above.
- **↺ on a copy with an edit still in its editor's debounce** sends that edit first, so that it claims its generation
  and ↺ seeks, as during a recompile: a rewind would be replaced by the edit's build, and an edit that does not parse
  builds nothing to answer one. The edit goes up to one debounce earlier than it would have, a kept seek's included.
  This is the controller's call on PR A's Task 4 review (2026-11-04), not asked, since the screen shows nothing new.

## §7 Tests and sabotages (approved §4)

Each test has a sabotage that must turn it red. Sabotages run in a worktree that no dev server serves, and are undone
from a saved copy, checked with `cmp`.

**Rust** (`crates/redextape-wasm`, beside the session's tests):

- Per leg, on `Session` and on the copy that carries the leg: step past a cap raise (and, for λ, past several
  checkpoints), rewind, record M frames; they are byte-identical to a fresh build's first M frames, and the status
  (cap, run) equals the fresh build's. Sabotages: a TM rewind that keeps the raised cap; a λ rewind through `at(0)`,
  which lifts the cap; a λ rewind that keeps the later checkpoints (`saved_steps` shows them).

**Node** (`web/tests/node/`, fake legs as `record-loop.test.ts` has):

- `follow` pauses at the high mark and resumes only once a `head` brings `ahead` under the low mark. Sabotage: resume
  on any `head`.
- `run` records to the end, to the cap without raising it, to `to`, and stops on `stop`, leaving `follow`. Sabotage:
  raise the cap in `run`.
- `play-past-cap` raises the cap by `EXTEND_STEPS` at each hit and only while `playing` and `shown`; a `head` with
  `shown: false` leaves the leg to stop at the cap (Q-a). Sabotages: raise it in `follow`; ignore `shown`.
- `rewind` drops a stale epoch's frames on the page and a stale `head` in the worker, and the first frame after it is
  step 0. Sabotage: drop the epoch check on either side.
- The λ memory limit, on the page's side with two or more fake λ workers' reports: the sum over the budget stops the
  leg whose report took it over and is past its mark, and not another; a leg past its mark that records on while the
  sum stays over stops at its next report; a rewound leg reporting at its mark records on. On the worker's side,
  `memory-limit` ends the λ leg with `done: 'memory-limit'`, and after a rewind the leg records again (§5.5's rule).
  Sabotages: compare the sum to the budget alone; stop the leg that holds the most; drop a report from the sum before
  its worker is terminated.
- `controls.test.ts`: every step-line form in §4.2, and none of the removed strings; ⏭'s name `stop here` while
  `running` and `to the end` otherwise (Q-b). `player.test.ts`: ⏵ holds at the frontier while `done` is `null`, or
  `capped` on a shown leg, and stops on the other ends and at a `capped` frontier no view shows (Q-a). A `head-report`
  test: at most one `head` per leg per frame, none without a change, one on a change of `shown` alone.
  `share-positions.test.ts`: run to N, one leg at a time, short at the cap.

**Browser** (real gestures, on step-focus's harness, and in Firefox through #162's `pnpm test:firefox`):

- ↺ after steps were dropped lands on step 0 of its view, and another view of the same program keeps its step (Q2).
- ⏭ runs and its second press stops it where it got to, the focus kept on it throughout (Q5), its name `stop here`
  while it runs and `to the end` before and after (Q-b).
- ▶ at the frontier waits with its focus kept and takes the step when it arrives; Enter at a cap stop records
  further.
- ⏵ passes the step cap, and ▶ and ⏭ stop at it, on a test worker with a lowered cap, as `depth-cap-worker.ts` is for
  depth. ⏵ on a leg its view stops showing stops at the cap, and the view, shown again, says so (Q-a).
- The step line's forms, the absence of the removed words, and the help page's passage.
- Each with a sabotage, among them ↺ as today's `seek(0)` and a `waiting` that reads step-focus's `recording`.

**Probe** (PR B, outside the gates, as `probes/lambda-memory.mjs` is): its pass 2 with `rewindLambda` in place of a
fresh compile, to confirm that a real rewind reuses the freed memory as a fresh session did (§8).

## §8 Measurements

**Setup.** Node v26.12.1, and the wasm package built from `1b2f0cb` with wasm-pack 0.15.0 (`--release --target
web`). Each command ran under `flock ~/temp/redextape-heavy.lock` on a shared machine, once; each figure is from one
run. The probes import the worker's sizers and frame arguments from `web/src/protocol.ts` (node strips its types) and
step `compile`'s `Session` as `recordLeg` does: the first frame, then chunks of `RECORD_CHUNK` frames, the allowance
(here one quarter window, the high mark) checked before each step, and each chunk's structured clone timed apart, as
the worker's `postMessage` pays it. No page, no draw.

**Commands**, from the record's `probes/`, with `W=~/temp/redextape-hidden-recording`, `EX` the example and `F12`
`@$W/web/src/examples/fact-12.rxt`; `run-all.sh` runs them in this order, each into `logs/`:

- `node lookahead.mjs "$W" "$EX" binary tm,rxm,lambda 8` → `lookahead-example.log`
- `node lookahead.mjs "$W" "$F12" binary lambda,rxm,tm 8` → `lookahead-fact12.log`
- `systemd-run --user --scope -q -p CPUQuota=25% node lookahead.mjs "$W" "$EX" binary tm,rxm 8` →
  `lookahead-example-cpu25.log`
- `systemd-run --user --scope -q -p CPUQuota=25% node lookahead.mjs "$W" "$F12" binary lambda 8` →
  `lookahead-fact12-cpu25.log`
- `node lookahead.mjs "$W" "$EX" binary tm,rxm 100000`, which runs each leg to its end → `run-to-end-example.log`
- `systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0 node lambda-memory.mjs "$W" "$F12" binary 6000000
  50000 720` → `lambda-memory-fact12.log`

The example is `let mut n = 100000; while n > 0 { n = n - 1; } n` under `binary`; `fact-12` is the repo's example
`web/src/examples/fact-12.rxt`, the λ-heavy one.

**One quarter window, the high mark, eight in a row from step 0:**

| program, leg | steps a quarter | a quarter, full speed | steps/s | longest chunk | a quarter, `CPUQuota=25%` | steps/s | longest chunk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| example, TM | 22,777 to 22,823 | 70.3 to 96.6 ms | 236,011 to 324,367 | 2.7 ms | 495.4 to 799.2 ms | 28,527 to 45,973 | 88.4 ms |
| example, rxm | 14,147 to 14,150 | 137.5 to 148.3 ms | 95,434 to 102,855 | 5.2 ms | 607.4 to 1,201.4 ms | 11,775 to 23,290 | 88.0 ms |
| example, λ | refused for depth at step 0, as facts §0 found | | | | | | |
| `fact-12`, λ | 347 to 361 | 8.1 to 172.2 ms | 42,665, falling to 2,079 by step 2,835 | 140.6 ms | 19.0 to 1,005.8 ms | 18,304, falling to 356 | 883.8 ms |
| `fact-12`, TM | 18,838 to 19,156 | 106.3 to 147.2 ms | 127,965 to 180,184 | 7.7 ms | not run | | |
| `fact-12`, rxm | its whole run: 182 frames, ended at step 181 | 10.3 ms | | | not run | | |

About half of each TM quarter and more than half of each rxm quarter is the clone: for TM 27.2 to 36.2 ms of a
quarter at full speed, for rxm 75.0 to 80.4 ms.

**To the end, the worker's side of ⏭ on the example, full speed:** TM ran 5,000,000 steps to its cap in 28,862.7 ms
(220 quarters at 60,975 to 329,192 steps/s, median 184,280; longest chunk 13.7 ms). rxm ran 1,000,008 steps to its
halt in 15,125.5 ms (71 quarters at 25,379 to 104,691, median 98,006; longest chunk 17.0 ms). The same 28.9 s is what
a link whose position lies past the example's TM cap costs the worker (§5.6).

**Wasm memory on TM and rxm:** 21,889,024 bytes (20.9 MiB) after two windows of each, and the same after the runs to
the end, so neither leg's memory grew with its steps in these runs.

**The λ leg's wasm memory, `fact-12`**, under `systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0`,
recording every step's frame as the worker does (`lambdaState(FRAME_BYTES)`) and sampling every 50,000 steps. Pass 1
stopped at its 720 s limit at step 2,311,000, with the run still going, at 1,004,142,592 bytes (957.6 MiB); the cap was
not reached.

| steps | wasm memory | seconds |
| --- | --- | --- |
| 0 | 16.3 MiB | 0 |
| 100,000 | 47,906,816 (45.7 MiB) | 30.3 |
| 600,000 | 208,797,696 (199.1 MiB) | 169.4 |
| 1,000,000 | 357,433,344 (340.9 MiB) | 285.8 |
| 1,450,000 | first sample over 512 MiB | 426.9 |
| 2,000,000 | first sample over 768 MiB | 596.2 |
| 2,311,000 | 1,004,142,592 (957.6 MiB) | 720.4 |

Growth by stretch: 311 bytes a step and 3,589 steps/s over steps 50,000 to 500,000; 369 and 3,391 over 550,000 to
1,000,000; 445 and 3,076 over 1,050,000 to 1,500,000; 502 and 3,381 over 1,550,000 to 2,000,000. The figure at 600,000
steps matches the warm-copy cap lane's review session, 208,863,232 bytes at 600,000 steps (facts §3).

Pass 2 freed that session, compiled `fact-12` again in the same instance and recorded the same 2,311,000 steps:
the memory read 1,004,142,592 bytes at every sample and at the end, 763.9 s later. A fresh session frees the whole
old run where a rewind keeps the step-0 cursor, so this stands in for a rewind rather than measuring one; the PR
that adds the λ limit measures it (§7, the probe).

## §9 The PR split (approved §4)

Both PRs come after step-focus, since both change `step-controls.ts` and `controls.ts`, which it changed; it merged as
#163 (`ec4f11a`).

**PR A: ↺ to step 0, with a per-leg rewind, on today's recording UI.** Small.

- The six wasm rewind methods and their Rust tests (§5.4, §7).
- The `rewind` request and the `epoch` on frames replies and on `extend`; the worker's `rewind` arm, whose first fill
  records one `HISTORY_BYTES` and stops at `budget` as today's first fill does.
- ↺ is a seek with step 0 kept and a `rewind` without it, except during a recompile or on a copy whose last edit did
  not parse (§6); its name is
  `back to step 0`; the comment at `step-controls.ts:49-50` and the help sentence change with it.
- While a rewind's first frames are on their way the leg's ring is empty: its step line reads `step 0 of 0…`, and ↺
  waits, greyed with its focus kept, as step-focus's ▶ and ⏭ wait. This is the user's ruling on the plan's call P4
  (2026-11-04, §2).
- PR A's `extend` still posts a `result` after every continue of any leg. A later `result` keeps a λ value the leg
  had decided (§11 call 6). An unfinished λ's `N reductions` reports how far that leg's recording has run, and a λ ↺
  records the leg again from step 0, so the next `result` after it shows the rewound recording's count, which is
  lower. This is the plan's call P3, the controller's call carrying out §11 call 6 (2026-11-04). A `result` posted
  while a rewind records a leg keeps that leg's last part, so the readout never shows a count read mid-fill, and an
  rxm copy keeps a decided value against a later `continue`'s `Unfinished` the same way (P3, on Task 2's review).
  Before the generation's first `result` there is no posted part, so a rewind reads the leg's part before its cursor
  goes back, and a `result` posted while that fill records keeps the part the rewind found (P3, the controller's call
  on the fix rounds' re-read, 2026-11-04).
- Browser tests for ↺, and the node test for the epoch.
- *Keep recording*, "history is full", "(oldest kept: step N)" and the ten-continue cap all stay. PR A reverses only
  the ↺ name (§10).

**PR B: hidden recording.** The rest: the modes and `head`, `run` and `stop` (§5.1-§5.3), the compile request's
rename, the λ memory limit with its per-tab budget, whose figure PR B's plan measures (§5.5), links (§5.6), head reporting (§5.7), the step bar and step line (§4.1, §4.2), the
help page (§4.3) and the step-focus waiting rule (§4.4), with their tests.

## §10 What the design reverses

Each of these was a stated bound or decision. Each is reversed by the user's word, which replaces it, except item 4,
whose premise alone changes.

1. **`web/src/transport.ts:265`** (the `play` handler's comment): "The player stops at the frontier, so an unwatched
   run is bounded rather than forever." Replaced by Q6, Q8 and Q-a: ⏵ holds at the frontier while the worker records
   ahead, and plays past the cap while some view shows its leg. An unwatched run is still bounded, by the step cap
   rather than the frontier: a leg no view shows can still be playing, since playback stays with the leg
   (`transport.ts:262-266`), and it stops at the cap as ▶ does (Q-a). A shown leg's bounds are a press of ⏵, ▶, ◀ or
   ⏭, the program's end, a refusal, an rxm cap and the λ memory limit.
2. **`web/src/player.ts:14-15`**: "Play walks recorded frames, stops at the recorded frontier, and never asks the
   worker for more — `▶` at the frontier and *continue* do that, so play cannot run away with a cap raise nobody
   clicked." Replaced by Q6 ("⏵ passes it") and Q8 ("worker streams ahead"): the press of ⏵ is the click, and the
   worker raises the cap by `EXTEND_STEPS` at each hit while ⏵ plays a leg some view shows (Q-a). Play still asks the
   worker for nothing; its `head` reports are what the worker follows.
3. **The shared link's ten-continue cap**, `MAX_LINK_CONTINUES = 10` (`web/src/share-positions.ts:24-25`), "what stops
   a hand-edited link whose position lies past a run that never ends, which would otherwise keep a tab busy
   indefinitely" (6a spec, `docs/superpowers/specs/2026-09-29-plan7-part6a-examples-and-links-design.md:487-488`, row
   16 at `:169`). Replaced by §2's approved "links run to N bounded by the cap": the step cap, never raised by a link,
   is the bound (§5.6).
4. **5d-i §4.4's "no user-facing control"**, said of the memory policy, one knob and one boolean
   (`docs/superpowers/specs/2026-08-11-plan5d-i-session-model-design.md:295-297`): "**No user-facing config.** Three
   modes would triple the wording of *"recording stopped, history is full at step N"* for a switch nobody has evidence
   anyone wants. If a measurement later shows the policies produce experiences worth choosing between, that is when a
   control is justified." `web/src/protocol.ts:141-144` restates it over `DROP_HISTORY_ON_UNFOCUS`: "AND IT STAYS ONE
   BOOLEAN WITH NO USER-FACING CONTROL". The design adds no setting (A1), so its conclusion, no user-facing control,
   stands and only its premise changes (Q-e). The premise changes under Q3 and Q6: under Q3 the wording it weighs is gone, since the UI says nothing about recording, and under Q6 the cap's two
   policies are the user's to choose by gesture, ⏵ past it and ▶ or ⏭ stopping at it, on his word rather than a
   measurement.
5. **The ↺ naming comment, `web/src/step-controls.ts:49-51`**: "`restart` IS `hist.seek(0)`, WHICH CLAMPS TO THE
   OLDEST RETAINED FRAME — the name says what it does rather than promising a step 0 an evicted history no longer
   holds." with the name `back to the oldest kept step`, kept by Plan 7 part 2 §8
   (`docs/superpowers/specs/2026-09-19-plan7-part2-workspace-shell-design.md:220`). Replaced by Q1: ↺ is "back to step
   0" and re-records when step 0 was dropped. With it go 5a §6's "◀ stops at the oldest retained frame and names its
   step" (5a spec `:407`) and the `(oldest kept: step N)` that names it: ◀ still stops there, and by Q4 the step line
   says `· earlier steps dropped` without the number. 5a's "you can only go back where you have been" (5a spec `:136`)
   holds for ◀; ↺ is the explicit re-derivation that 5a's table ruled out only when silent.

## §11 Designer's calls

Choices the approved sections leave to the design, each with what it rules out.

1. **The compile request becomes `compile`**, so that `run` is ⏭'s request as §2's approval names it (Q-f). The
   alternative keeps the compile request's `run` and names ⏭'s something else, such as `run-to`.
2. **A per-leg epoch** on `head`, `run`, `stop`, `rewind`, `extend`, `memory-limit` and the frames replies (§5.2). A `rewound` reply
   with the page holding its reports until it arrives was the alternative; a `head` posted between the ↺ and that
   reply would still need an epoch to be told apart.
3. **The first fill is one window, as today, not the high mark** (§5.1). It keeps the λ value decided by today's
   recording and the first fill's time unchanged. A quarter-window first fill would show TM's first frame sooner, since
   λ's and rxm's fills come first (`session-worker.ts:593-595`), and would leave the λ value undecided for a λ run
   between a quarter and one window long.
4. **↺ leaves ⏵ as it is.** §6's approved list names ⏭, ▶ and ◀ as stopping ⏵ and says nothing of ↺; today's ↺ leaves
   playback alone.
5. **`continue` returns the leg to `follow`**, not to the ⏭ run that hit the cap: the head stays where it is and ▶
   steps on. ▶ at a cap stop is the same operation, as it is today, and `canRecordFurther` stays the one gate for both
   (`controls.ts:110-112`), now `!awaitingRun && done === 'capped'`.
6. **The results readout keeps the λ value across a λ rewind**, since a rewind posts no `result` (§5.2).
7. **⏭'s second press stops following at the step shown**, and frames in flight join the lookahead (§6).
8. **The λ limit reads each λ worker's wasm memory, against a mark taken at the leg's first step**, and the page sums
   the reports against the tab's one budget (§5.5, Q-d), rather than a count the Rust side keeps.
9. **The marks are fractions of the window in sizer charge, the same for every leg**, rather than step counts per
   leg, so a leg with larger frames keeps the same share of its ring ahead of the head.
10. **Turns favour a refilling leg** (§5.3), so that a λ leg that cannot keep up does not cut TM and rxm to one chunk
    per λ chunk.
11. **One place reports the head**, `head-report.ts`, called from `draw()` (§5.7), rather than each gesture posting
    its own.
12. **A stop shows where the head meets it.** The lookahead reaches the cap or a refusal before the head does, and
    today's step line names a stop as soon as `done` is set (`controlState`, `controls.ts:114-172`). Shown then, it
    would say that steps the user has not reached are recorded, which Q3 keeps out of the UI.
13. **◀, ▶ and ⏵ during a ⏭ run stop the run first**, as ↺ does (§6). §6's approved list names ⏭ stopping ⏵ and
    not the reverse; ⏵ pressed during a run plays from the step shown.
14. **The λ leg whose recording pushes the tab's sum over the budget stops**, and after it any λ leg that records on
    past its own mark while the sum stays over (§5.5). Stopping the λ leg that holds the most memory is the
    alternative ruled out: stopping a leg frees none of its worker's memory, since wasm memory never shrinks, so it
    would lower nothing and let the leg that is growing record on.

## §12 The user's answers (2026-11-04)

Q-a to Q-d are his answers; Q-e and Q-f were settled in the spec's review, not asked. §2 records Q-a to Q-d with what
was not chosen.

- **Q-a.** "Only while shown": ⏵ passes the cap only while some view shows the leg (§4.1, §5.1, §5.7, §6, §10 item 1).
- **Q-b.** "stop here": ⏭ reads "stop here" while it runs and "to the end" otherwise (§4.1, §4.4).
- **Q-c.** "`step C`": a TM copy shows `step C` until its end is known, with no run ahead at its build (§4.2).
- **Q-d.** "Per tab, shared": one λ memory budget for the tab's λ workers, its figure measured in PR B (§5.5).
- **Q-e.** The design adds no setting, so 5d-i's conclusion stands and only its premise changes (§10, item 4).
- **Q-f.** The compile request is renamed `compile` (§5.2, §11 call 1).
