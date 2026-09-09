# `[continue]` during a recompile — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop offering `[continue]` and a frontier `▶` during the ≥300 ms window in which the worker
will silently drop the request they send — accessibility list item 8.

**Architecture:** `SessionClient` gains `awaitingRun`, a flag derived from state it already holds that
mirrors (as a superset) the worker's own `onExtend` drop condition. `SessionPool`'s constructor takes
the repaint callback and hands it to every client it binds, so no `src/` site can claim a generation
without the panes learning. `controls.ts`'s `canRecordFurther` takes the flag, which keeps the control
strip and the frontier click handler on one gate.

**Tech Stack:** TypeScript, Vitest (node + browser projects), Biome, CodeMirror 6.

Design: [`../specs/2026-09-09-extend-during-recompile-design.md`](../specs/2026-09-09-extend-during-recompile-design.md).

## Global Constraints

- Every commit passes the pre-commit gate. For `web/` changes that means **`biome ci` and `web
  typecheck`**, so a commit that changes a signature must change every caller in the same commit.
- Biome: `lineWidth` 120, 2-space indent, **single quotes, semicolons `asNeeded`** (i.e. no trailing
  semicolons). Run `pnpm exec biome check --write .` from `web/` before committing.
- TypeScript doc comments are `/** */`, never `///`.
- **No `file:line` citations in tracked source.** The pre-commit hook `no file:line citations in
  tracked source` rejects them. Reference by symbol name in `web/src/**`; `file:line` is fine in
  `docs/`.
- Never `git commit --no-verify`.
- Vitest's `-- <name>` does not scope files. To run one file: `pnpm exec vitest run --project node
  tests/node/<file>.test.ts` from `web/`.
- Every sabotage named in a task is **run**, and its result reported — including a sabotage that does
  not fire, which is a finding rather than a step to redo.
- All commands below are run from `web/` unless the path says otherwise.

---

### Task 1: `awaitingRun`, and the repaint that makes it visible

**Files:**
- Modify: `web/src/session-client.ts` — `SessionClient` (field, getter, both write edges), `SessionPool` (constructor, `bind`)
- Modify: `web/src/main.ts:282` — the one `new SessionPool(...)` in `src/`
- Modify: `web/tests/browser/scratch-fork.test.ts:93`, `web/tests/browser/pool-isolation.test.ts:57`, `web/tests/browser/session-memory.test.ts:104`, `web/tests/node/session-pool.test.ts:42`, `web/tests/node/replies.test.ts:247`, `web/tests/node/scratch.test.ts:78` — the six test pool constructions
- Test: `web/tests/node/session-client.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SessionClient.awaitingRun: boolean` (a getter), and `new SessionPool(spawn: () => PoolPort, onSupersede: () => void)`. `SessionPool.bind(id, onReply)` keeps its existing two-parameter signature. `new SessionClient(port, onReply, onSupersede?)` — the third parameter defaults to a no-op.

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/node/session-client.test.ts`, inside the existing `describe('SessionClient', …)`
block (its `fakePort` and `reply` helpers are already in the file and are used unchanged):

```ts
  it('is not awaiting a run before anything is dispatched', () => {
    const { port } = fakePort()
    expect(new SessionClient(port, () => {}).awaitingRun).toBe(false)
  })

  it('awaits a run from the instant a generation is claimed, before anything is posted', () => {
    const { port, sent } = fakePort()
    const c = new SessionClient(port, () => {})
    c.supersede()
    expect(c.awaitingRun).toBe(true)
    expect(sent).toEqual([])
  })

  it('stops awaiting when a reply for the current generation lands', () => {
    const { port, deliver } = fakePort()
    const c = new SessionClient(port, () => {})
    c.request(c.supersede(), 'a', 'unary')
    deliver(reply(1))
    expect(c.awaitingRun).toBe(false)
  })

  // THE DEBOUNCE WINDOW ITSELF: generation 2 is claimed and not yet posted while generation 1's run
  // is still answering. Its replies must not clear the flag, or the control comes back for the run
  // that is about to be discarded — which is the whole defect.
  it('keeps awaiting when a reply for a superseded generation lands', () => {
    const { port, deliver } = fakePort()
    const c = new SessionClient(port, () => {})
    c.request(c.supersede(), 'a', 'unary')
    c.supersede()
    deliver(reply(1))
    expect(c.awaitingRun).toBe(true)
  })

  // `replies.ts` drives `draw()` off `onReply`, so a repaint that ran while the flag was still set
  // would paint the withdrawal one frame after the window it describes had already closed.
  it('clears the flag before onReply runs', () => {
    const { port, deliver } = fakePort()
    const seen: boolean[] = []
    const c = new SessionClient(port, () => seen.push(c.awaitingRun))
    c.request(c.supersede(), 'a', 'unary')
    deliver(reply(1))
    expect(seen).toEqual([false])
  })

  it('notifies on every supersede, with the flag already set', () => {
    const { port } = fakePort()
    const seen: boolean[] = []
    const c = new SessionClient(port, () => {}, () => seen.push(c.awaitingRun))
    c.supersede()
    c.supersede()
    expect(seen).toEqual([true, true])
  })
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm exec vitest run --project node tests/node/session-client.test.ts`

Expected: 6 failures. The first four report `expected undefined to be false` / `to be true` —
`awaitingRun` is not a property yet. The sixth reports `expected [] to equal [ true, true ]` — the
third constructor argument is ignored.

- [ ] **Step 3: Add the flag and the notification to `SessionClient`**

In `web/src/session-client.ts`, add the field and the callback beside `#gen` and `#port`:

```ts
export class SessionClient {
  #gen = 0
  #awaitingRun = false
  #port: ClientPort
  #onSupersede: () => void
```

Change the constructor's signature and body. The existing comment above the `if` is unchanged; only
the branch's body grows:

```ts
  constructor(port: ClientPort, onReply: (r: RunReply) => void, onSupersede: () => void = () => {}) {
    this.#port = port
    this.#onSupersede = onSupersede
    port.addEventListener('message', (e) => {
      // THE SECOND OF TWO GUARDS AGAINST THE SAME HAZARD, and both are needed. The worker abandons
      // superseded work at a chunk boundary so it does not compute results nobody wants; this drops
      // a reply that was already in flight when the next request was posted, which the worker's own
      // check cannot see. Generation 0 is "no request yet" and matches nothing.
      //
      // A GENERATION NOW PRODUCES MANY REPLIES — `compiled`, then frame batches, then `result` — so
      // this fires repeatedly and nothing here may treat any one of them as terminal.
      if (this.#gen !== 0 && e.data.gen === this.#gen) {
        // CLEARED BEFORE `onReply`, NOT AFTER. `replies.ts` drives the repaint off that call, and a
        // repaint reading the flag while it was still set would paint the withdrawal one frame after
        // the window it describes had already closed. Idempotent after the first reply of a
        // generation, which is why it is unconditional rather than guarded.
        this.#awaitingRun = false
        onReply(e.data)
      }
    })
  }

  /**
   * Whether a generation has been claimed that no reply has answered yet — which is when the worker's
   * `onExtend` drops a request addressed to the current generation, because `live.gen` is still the
   * previous one or there is no session at all.
   *
   * A SUPERSET OF THE WORKER'S DROP CONDITION RATHER THAN AN EQUALITY, and the difference is stated
   * rather than glossed. The worker sets `live.gen` when it STARTS a run and its first reply follows,
   * so between those two moments the worker would accept an extend this still answers `true` for.
   * That gap is a message queued behind a run already in flight on a single-threaded worker, so being
   * conservative there costs nothing — but the two predicates are not the same one.
   *
   * A WEDGED WORKER HOLDS THIS TRUE FOREVER, AND THAT IS THE HONEST ANSWER: an extend posted to a
   * worker that never answers would not be serviced either. Recovery is the header list's retire.
   */
  get awaitingRun(): boolean {
    return this.#awaitingRun
  }
```

In `supersede()`, keep the existing doc comment and body, and add the two lines before the `return`:

```ts
  supersede(): number {
    this.#gen += 1
    // SET AND ANNOUNCED IN THAT ORDER, because the callback repaints and must read the new value.
    this.#awaitingRun = true
    this.#onSupersede()
    return this.#gen
  }
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm exec vitest run --project node tests/node/session-client.test.ts`
Expected: PASS, with no failures. Record the passing count for the roadmap entry.

- [ ] **Step 5: Require the callback at `SessionPool`, and wire the seven construction sites**

In `web/src/session-client.ts`, add the field and widen the constructor at `:226`:

```ts
export class SessionPool {
  #spawn: () => PoolPort
  #onSupersede: () => void
  #live = new Map<SessionId, Pooled>()
```

```ts
  constructor(spawn: () => PoolPort, onSupersede: () => void) {
    this.#spawn = spawn
    this.#onSupersede = onSupersede
  }
```

Add this paragraph to the constructor's existing doc block, after the `@param spawn` paragraph:

```
   * @param onSupersede Repaint the app. Called by every client this pool makes, from `supersede()`.
   *
   * REQUIRED HERE RATHER THAN ON `bind`, AND THAT IS WHAT KEEPS `bind`'s SIGNATURE STILL. This pool
   * is the only route from `src/` to a `SessionClient`, so one required argument at one place is
   * enough for no app site to be able to claim a generation without the panes learning — while
   * `bind` keeps the two parameters its ~20 test call sites pass, one of which replaces the method
   * with a two-parameter interceptor of its own. A third argument there would be dropped silently by
   * any interceptor that was not updated by hand, which is the shape of the defect this argument
   * exists to fix.
   *
   * IT TAKES NO SESSION, UNLIKE `bind`'s `onReply`. A reply is routed to one session's legs; a
   * repaint is routed nowhere — it paints every pane — so a `SessionId` here would be a parameter
   * nothing reads.
```

In `bind`, pass it through — the only line that changes:

```ts
    const client = new SessionClient(port, onReply, this.#onSupersede)
```

Then update the seven construction sites. `web/src/main.ts:282` is the only one in `src/`, and its
argument **must be a thunk**: `draw` is declared `let draw: () => void` at `main.ts:259` and is not
assigned until `draw = createDraw({…})` at `main.ts:1119`, so a value passed at `:282` captures
`undefined` permanently. The first supersede is `compile.schedule(SAMPLE)` at `main.ts:1312`, after
the assignment, so the thunk always resolves before it is called.

```ts
  const pool = new SessionPool(() => {
    // …the existing factory body, unchanged…
  }, () => draw())
```

The six test sites take `() => {}` as their second argument — none of them has a pane to repaint:

| file | line |
|---|---|
| `web/tests/browser/scratch-fork.test.ts` | 93 |
| `web/tests/browser/pool-isolation.test.ts` | 57 |
| `web/tests/browser/session-memory.test.ts` | 104 |
| `web/tests/node/session-pool.test.ts` | 42 |
| `web/tests/node/replies.test.ts` | 247 |
| `web/tests/node/scratch.test.ts` | 78 |

Do **not** touch `bind`'s call sites, and do not touch `scratch.ts` — it obtains its client from
`this.#pool.bind(…)` and needs no config field.

- [ ] **Step 6: Verify the whole node tier and the typecheck are green**

Run: `pnpm run typecheck`
Expected: no output, exit 0.

Run: `pnpm run test:node`
Expected: PASS. Record the total passing count.

- [ ] **Step 7: Run the sabotages and report each result**

Apply each mutation, run the named command, confirm it reddens, then revert it.

| sabotage | command | must redden |
|---|---|---|
| Initialise `#awaitingRun = true` | `pnpm exec vitest run --project node tests/node/session-client.test.ts` | `is not awaiting a run before anything is dispatched` |
| Delete `this.#awaitingRun = true` from `supersede` | same | `awaits a run from the instant a generation is claimed` |
| Delete `this.#awaitingRun = false` from the listener | same | `stops awaiting when a reply for the current generation lands` |
| Move `this.#awaitingRun = false` **above** the `if`, so any reply clears it | same | `keeps awaiting when a reply for a superseded generation lands` |
| Call `this.#onSupersede()` **before** `this.#awaitingRun = true` | same | `notifies on every supersede, with the flag already set` |

- [ ] **Step 8: Commit**

```bash
cd /home/davey/projects/redextape/web && pnpm exec biome check --write . && cd /home/davey/projects/redextape
git add web/src/session-client.ts web/src/main.ts web/tests
git commit -m "A claimed generation the worker has not seen is a fact the client can answer

\`onExtend\` drops any request whose generation is not \`live.gen\`, and
\`supersede()\` claims a generation 300 ms before \`compile.ts\` posts the run for
it. \`awaitingRun\` names that window from the client side, out of the same
comparison the constructor's reply guard already makes.

\`SessionPool\`'s constructor takes the repaint and hands it to every client it
binds, so no site in \`src/\` can claim a generation without the panes learning.
\`bind\` keeps its two parameters, which is what leaves its ~20 test call sites
and \`scratch.test.ts\`'s two-parameter interceptor alone."
```

---

### Task 2: The control rule

**Files:**
- Modify: `web/src/controls.ts` — `LegView`, `canRecordFurther`, `controlState`
- Modify: `web/src/transport.ts:126` — the frontier `▶` handler
- Modify: `web/src/sessions.ts:621` — the `controlState` call in `PaneSlot.render`
- Test: `web/tests/node/controls.test.ts`

**Interfaces:**
- Consumes: `SessionClient.awaitingRun` from Task 1.
- Produces: `LegView` gains `awaitingRun: boolean`. `canRecordFurther(done: RecordEnd | null, awaitingRun: boolean): boolean` — **the arity changes**, so both callers and the test file move in this commit.

- [ ] **Step 1: Write the failing tests**

In `web/tests/node/controls.test.ts`, add `awaitingRun: false` to the `view` factory's defaults, after
`done: null`:

```ts
const view = (over: Partial<LegView> = {}): LegView => ({
  available: true,
  reason: '',
  head: 0,
  length: 1,
  oldestStep: 0,
  currentStep: 0,
  newestStep: 0,
  evicted: false,
  done: null,
  awaitingRun: false,
  ...over,
})
```

Add `false` as the second argument to the five existing `canRecordFurther` assertions at the bottom of
the file, and add a second `it` to that same `describe`:

```ts
  it('is true only for capped and budget, false for ended, depth-refused, and null', () => {
    expect(canRecordFurther('capped', false)).toBe(true)
    expect(canRecordFurther('budget', false)).toBe(true)
    expect(canRecordFurther('ended', false)).toBe(false)
    expect(canRecordFurther('depth-refused', false)).toBe(false)
    expect(canRecordFurther(null, false)).toBe(false)
  })

  // The worker drops an extend addressed to a generation it has never seen, so during the debounce
  // there is no stop reason for which recording further could achieve anything.
  it('is false for every stop reason while a claimed run is awaited', () => {
    expect(canRecordFurther('capped', true)).toBe(false)
    expect(canRecordFurther('budget', true)).toBe(false)
    expect(canRecordFurther('ended', true)).toBe(false)
    expect(canRecordFurther('depth-refused', true)).toBe(false)
    expect(canRecordFurther(null, true)).toBe(false)
  })
```

Add six tests inside the existing `describe('controlState', …)`:

```ts
  it('withdraws the continue button while the session awaits a claimed run', () => {
    const budget = view({ done: 'budget', length: 500, head: 499, awaitingRun: true })
    const capped = view({ done: 'capped', length: 500, head: 499, awaitingRun: true })
    expect(controlState(budget).continueLabel).toBeNull()
    expect(controlState(capped).continueLabel).toBeNull()
  })

  // The frontier arm dies and the recorded-history arm does not: walking frames that already exist
  // is unaffected by a generation the worker has not seen.
  it('kills a frontier ▶ while awaiting a run but keeps recorded frames walkable', () => {
    expect(controlState(view({ length: 3, head: 2, done: 'budget', awaitingRun: true })).canForward).toBe(false)
    expect(controlState(view({ length: 3, head: 1, done: 'budget', awaitingRun: true })).canForward).toBe(true)
  })

  it('says recompiling in place of the stop reason while awaiting a run', () => {
    const c = controlState(
      view({ done: 'budget', length: 500, head: 499, currentStep: 499, newestStep: 499, awaitingRun: true }),
    )
    expect(c.stepText).toBe('step 499 of 499 — recompiling')
  })

  // `…` means "this count is not final". For a superseded run it IS final — that run will record
  // nothing more whatever the new one does — so the ellipsis goes with the stop reason.
  it('drops the still-recording ellipsis while awaiting a run', () => {
    const running = view({ done: null, length: 12, head: 4, currentStep: 4, newestStep: 11 })
    expect(controlState(running).stepText).toBe('step 4 of 11…')
    expect(controlState({ ...running, awaitingRun: true }).stepText).toBe('step 4 of 11 — recompiling')
  })

  it('leaves back, play and restart alone while awaiting a run', () => {
    const c = controlState(view({ length: 3, head: 1, done: 'budget', awaitingRun: true }))
    expect(c.canBack).toBe(true)
    expect(c.canPlay).toBe(true)
    expect(c.canRestart).toBe(true)
  })

  // The app's own first compile supersedes from generation 0 with no history, and takes the
  // unavailable early return — so it never reaches the new arms and needs no special case in them.
  it('keeps an unavailable leg on its reason rather than on recompiling', () => {
    const c = controlState(view({ available: false, reason: 'not run', length: 0, awaitingRun: true }))
    expect(c.stepText).toBe('not run')
    expect(c.continueLabel).toBeNull()
    expect(c.canForward).toBe(false)
  })
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm exec vitest run --project node tests/node/controls.test.ts`

Expected: the six new `controlState` tests fail (`continueLabel` still a string, `canForward` still
`true`, `stepText` still `— history is full`), and `is false for every stop reason while a claimed run
is awaited` fails because the second argument is ignored.

- [ ] **Step 3: Widen the gate and the view**

In `web/src/controls.ts`, add the field to `LegView`, after `done`:

```ts
  /** `null` while recording is still in flight. */
  done: RecordEnd | null
  /**
   * Whether this leg's session has claimed a generation the worker has not answered — the client's
   * `awaitingRun`. Every frontier operation is dropped by the worker while it is true, so the
   * controls that send one are withdrawn rather than left to fail in silence.
   */
  awaitingRun: boolean
```

Widen `canRecordFurther`, keeping its existing doc comment and adding a paragraph to it:

```ts
/**
 * Whether asking the worker to record further could achieve anything.
 *
 * THE ONE PLACE THIS IS DECIDED. `▶` at the recorded frontier and the `[continue]` button are the
 * same operation with different labels, so they must not each carry their own idea of when it is
 * available — `depth-refused` in particular is a case where continuing provably cannot help, and a
 * second copy of that list is how one of the two ends up offering it anyway.
 *
 * `awaitingRun` IS A PARAMETER HERE RATHER THAN A CHECK INSIDE `controlState`, AND NOT BECAUSE THE
 * OTHER CALLER WOULD OTHERWISE MISBEHAVE — checked, it could not. This function's second caller is
 * the frontier `▶` click handler in `transport.ts`, and that handler cannot reach this gate's
 * `awaitingRun` half: `controlStrip` renders the forward button `disabled` whenever `canForward` is
 * false, a disabled button receives no click from a user gesture, and while `awaitingRun` holds
 * `canForward` reduces to `head < length - 1` — which is exactly the case where `hist.forward()`
 * succeeds and short-circuits before this gate is consulted. The repaint that sets the flag is
 * synchronous, so no click lands in between. Established by READING the code, not by
 * running anything: the sabotage aimed at this gate reddens nothing, which is how the reachability
 * question came to be asked at all.
 *
 * IT IS A PARAMETER ANYWAY, AND THE REASON IS THE PARAGRAPH ABOVE'S: one gate rather than two. What
 * makes the second caller's copy unreachable is a rendering decision in `pane-chrome.ts` — a module
 * this one does not own and does not get to depend on. A narrower rule here would be a second
 * opinion about the same question, held correct only by a distant file's current choice.
 */
export function canRecordFurther(done: RecordEnd | null, awaitingRun: boolean): boolean {
  return !awaitingRun && (done === 'capped' || done === 'budget')
}
```

In `controlState`, three edits. The `continueLabel` ternary keeps its existing comment above it:

```ts
  const continueLabel = !canRecordFurther(v.done, v.awaitingRun)
    ? null
    : v.done === 'capped'
      ? 'continue — raise the step cap'
      : 'keep recording'
```

The step readout:

```ts
  // `…` MEANS "THIS COUNT IS NOT FINAL", which is why `awaitingRun` drops it: the run this readout
  // describes has been superseded and will record nothing more, whatever the new one goes on to do.
  const of = v.done === null && !v.awaitingRun ? `${n(v.newestStep)}…` : n(v.newestStep)
  const oldest = v.evicted ? ` (oldest kept: step ${n(v.oldestStep)})` : ''
  // THE READOUT SAYS WHAT THE USER DID; THE FIELD NAMES WHAT IS TRUE OF THE SESSION. They are the
  // same state from the two ends, and this is the existing narration rather than a second channel.
  const tail = v.awaitingRun ? ' — recompiling' : v.done === null ? '' : doneText(v.done)
  const stepText = v.length === 0 ? 'not run' : `step ${n(v.currentStep)} of ${of}${tail}${oldest}`
```

And the returned `canForward`, keeping its existing comment:

```ts
    canForward: v.head < v.length - 1 || canRecordFurther(v.done, v.awaitingRun),
```

- [ ] **Step 4: Update both callers in the same commit**

`web/src/transport.ts`, the `forward` handler — the entry is resolved once and reused, because the
line below already needed it:

```ts
    forward: () => {
      // At the frontier `▶` means "record one more", which is the same operation as `[continue]`.
      // `canRecordFurther` is `controls.ts`'s call, not re-derived here — see its doc comment.
      const leg = slot.resolve(sessions)
      const entry = sessions.entryOf(slot.binding.session)
      if (!leg.hist.forward() && canRecordFurther(leg.done, entry.client.awaitingRun)) {
        entry.client.extend(slot.binding.leg)
      }
      draw()
    },
```

`web/src/sessions.ts`, in `PaneSlot.render`, one added property:

```ts
      controlState({
        available: leg.status.available,
        reason: leg.status.reason,
        head: leg.hist.head,
        length: leg.hist.length,
        oldestStep: leg.hist.oldestStep,
        currentStep: leg.hist.currentStep,
        newestStep: leg.hist.newestStep,
        evicted: leg.hist.evicted,
        done: leg.done,
        // PER SESSION, NOT PER LEG — the generation is the client's, and both legs of one session
        // share it. `reg` and the binding are both already in hand here.
        awaitingRun: reg.entryOf(b.session).client.awaitingRun,
      }),
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm exec vitest run --project node tests/node/controls.test.ts`
Expected: PASS.

Run: `pnpm run typecheck`
Expected: no output, exit 0.

Run: `pnpm run test:node`
Expected: PASS. Record the total.

- [ ] **Step 6: Run the sabotages and report each result**

| sabotage | must redden |
|---|---|
| `canRecordFurther` ignores `awaitingRun` (`return done === 'capped' \|\| done === 'budget'`) | `withdraws the continue button…`, `kills a frontier ▶…`, `is false for every stop reason…` |
| `tail` ignores `awaitingRun` | `says recompiling in place of the stop reason…` |
| `of` keeps its ellipsis (`v.done === null ? …`) | `drops the still-recording ellipsis while awaiting a run` |
| `canForward` drops its first disjunct | `kills a frontier ▶ while awaiting a run but keeps recorded frames walkable`, and `offers forward while frames remain ahead of the head` |
| `transport.ts` passes the literal `false` instead of `entry.client.awaitingRun` | **nothing in the node tier** — and nothing in the browser tier either. Task 3 Step 3 runs this same sabotage and reddens nothing anywhere: `forward.disabled` renders from `controlState` via `sessions.ts`, a path independent of this click handler's gate, so no tier catches it |

- [ ] **Step 7: Commit**

```bash
cd /home/davey/projects/redextape/web && pnpm exec biome check --write . && cd /home/davey/projects/redextape
git add web/src/controls.ts web/src/transport.ts web/src/sessions.ts web/tests/node/controls.test.ts
git commit -m "A control that provably cannot work is withdrawn, not left to fail in silence

\`canRecordFurther\` takes \`awaitingRun\`, so the control strip and the frontier
\`▶\` handler stay on one gate rather than two copies of the same question, held
correct only by a rendering choice in a module neither one owns. \`[continue]\`
goes away, a frontier \`▶\` goes dead, walking recorded frames is untouched, and
the step readout says \`recompiling\` in place of a stop reason that describes a
run about to be discarded — the narration this leg already had, not a second
channel.

The \`…\` goes with it: it means the count is not final, and for a superseded run
it is."
```

---

### Task 3: The browser test — the withdrawal, end to end

**Files:**
- Create: `web/tests/browser/extend-during-recompile.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2, through the DOM only.
- Produces: nothing other tasks read.

The fixture below is the one `app.test.ts` measured as reaching a `budget` stop on the TM leg: 75,025
frames in ~1.9 s, of ~129,300 δ-steps. It is the affordable route to a live `[continue]` — `capped`
needs the cursor's own 5,000,000-step cap, which no test can pay for.

- [ ] **Step 1: Write the failing test**

Create `web/tests/browser/extend-during-recompile.test.ts`:

```ts
import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <button type="button" id="buffers">buffers</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

/**
 * The fixture that reaches a `budget` stop on the TM leg, from `app.test.ts`'s own measurement:
 * ~75,025 frames in ~1.9 s. `capped` would need the cursor's 5,000,000-step cap, which is
 * unaffordable in a test, so `budget` is the only route to a live `[continue]`.
 */
const BUDGET_SRC =
  'fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2, 4].map(add1)'

let view: EditorView

async function until(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error('timed out waiting for the app')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const stepText = () => document.querySelector('[data-leaf="tm-0"] .step')?.textContent ?? ''
const extendButton = () => document.querySelector<HTMLButtonElement>('[data-leaf="tm-0"] .controls .extend')
const forwardButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="tm-0"] .controls button')].find(
    (b) => b.textContent === '▶',
  )

describe('the frontier controls during a recompile', () => {
  // ONE MOUNT FOR THE FILE, as every browser test file does: ES module imports are cached, so
  // `main()` runs once per page and Vitest gives each test file its own page.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })

  it('withdraws [continue] and a frontier ▶ for the whole window, and restores them after', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: BUDGET_SRC } })
    await until(() => stepText().includes('history is full'))
    expect(extendButton()?.hidden).toBe(false)
    expect(extendButton()?.textContent).toBe('keep recording')
    expect(forwardButton()?.disabled).toBe(false)

    // ONE CHARACTER, AND THE WITHDRAWAL IS SYNCHRONOUS. CodeMirror runs its update listeners inside
    // `dispatch`, that listener calls `schedule`, and `schedule` calls `supersede()` — which sets the
    // flag and fires the repaint before this line returns. No `until` here: a wait would hide the
    // fact that there is nothing to wait for.
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } })
    expect.soft(extendButton()?.hidden).toBe(true)
    expect.soft(stepText()).toContain('— recompiling')
    expect.soft(stepText()).not.toContain('history is full')
    expect.soft(forwardButton()?.disabled).toBe(true)

    // A trailing space changes nothing the machine does, so the new run reaches the same stop and the
    // control comes back — which is what makes the withdrawal a window rather than a one-way door.
    await until(() => stepText().includes('history is full'))
    expect(extendButton()?.hidden).toBe(false)
    expect(forwardButton()?.disabled).toBe(false)
  }, 90_000)
})
```

- [ ] **Step 2: Run it against the finished Tasks 1 and 2 and verify it passes**

Run: `pnpm exec vitest run --project browser tests/browser/extend-during-recompile.test.ts`
Expected: 1 passed.

If Chrome is not found, it is off `PATH` in `/usr/sbin` on this machine — put that on `PATH` for the
run rather than reinstalling anything.

- [ ] **Step 3: Run the sabotages and report each result**

| sabotage | must redden |
|---|---|
| `transport.ts` passes the literal `false` for `awaitingRun` | **nothing** — `forward.disabled` is rendered from `controlState` via `sessions.ts`, a path independent of the click handler's internal gate, so this sabotage cannot touch it. Run and confirmed: this is what exposed §4.1's "doomed extend" justification as false rather than as the reachable defect it claimed |
| `sessions.ts` passes the literal `false` for `awaitingRun` | all four `expect.soft` assertions inside the window, independently. Run and confirmed: `extendButton()?.hidden` (expected `true`, got `false`), both `stepText()` assertions (got `'step 75,024 of 75,024 — history is full (oldest kept: step 2)'`, so it neither contains `— recompiling` nor fails to contain `history is full`), and `forwardButton()?.disabled` (expected `true`, got `false`) — the assertion the browser tier exists to reach |
| `main.ts` passes `() => {}` instead of `() => draw()` to `new SessionPool` | every assertion inside the window. Run and confirmed: it reddened every in-window assertion — the flag is right and nothing repaints, which is §3's whole argument |

The third is the one worth reporting whatever it does: it is the only check that the repaint wiring
is load-bearing rather than incidental.

- [ ] **Step 4: Run the whole browser tier**

Run: `pnpm run test:browser`
Expected: PASS, with no regression in `app.test.ts`'s existing `[continue]` tests. Record the total.

- [ ] **Step 5: Commit**

```bash
cd /home/davey/projects/redextape/web && pnpm exec biome check --write . && cd /home/davey/projects/redextape
git add web/tests/browser/extend-during-recompile.test.ts
git commit -m "The withdrawal is synchronous, and the test asserts it without waiting

CodeMirror runs update listeners inside \`dispatch\`, so by the time the keystroke
returns the generation is claimed, the flag is set and the repaint has run. The
test asserts immediately rather than polling: a wait would hide the fact that
there is nothing to wait for.

A trailing space changes nothing the machine does, so the new run reaches the
same \`budget\` stop and the control returns — which is what makes this a window
rather than a one-way door."
```

---

### Task 4: The focus measurement

**Files:**
- Create: `web/tests/browser/extend-focus-probe.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: a finding for the roadmap entry, and focus-moving code **only if half two fires**.

Design §5 asks two separate questions, and the value is in not confusing them. Half one establishes
that the browser behaves the way accessibility item 1 recorded. Half two asks whether any user gesture
can reach that behaviour through this change.

- [ ] **Step 1: Write the measurement**

Create `web/tests/browser/extend-focus-probe.test.ts`. Browser test files in this tree are
self-contained — each declares its own shell and helpers — so this repeats them rather than importing
from Task 3's file:

```ts
import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <button type="button" id="buffers">buffers</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

/** The fixture that reaches a `budget` stop on the TM leg — see Task 3's file for the measurement. */
const BUDGET_SRC =
  'fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2, 4].map(add1)'

let view: EditorView

async function until(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error('timed out waiting for the app')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const stepText = () => document.querySelector('[data-leaf="tm-0"] .step')?.textContent ?? ''

/** The `▶` specifically. The strip's first button is `↺`, so a positional lookup would name the wrong one. */
const forwardButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="tm-0"] .controls button')].find(
    (b) => b.textContent === '▶',
  )

const mustFind = <T extends Element>(selector: string): T => {
  const el = document.querySelector<T>(selector)
  if (el === null) throw new Error(`no element for ${selector}`)
  return el
}

describe('focus when a frontier control is withdrawn', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })
```

Then the three measurements, closing the `describe` after them:

```ts
  // HALF ONE — IS THE MECHANISM REAL? Accessibility item 1 recorded that a control which hides itself
  // strands focus on `<body>`. This asserts that against the button this slice withdraws, so half two
  // below is a statement about reachability rather than about whether the hazard exists at all.
  it('hiding or disabling the focused frontier control strands focus on body', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: BUDGET_SRC } })
    await until(() => stepText().includes('history is full'))

    const extend = mustFind<HTMLButtonElement>('[data-leaf="tm-0"] .controls .extend')
    extend.focus()
    expect(document.activeElement).toBe(extend)
    extend.hidden = true
    expect(document.activeElement).toBe(document.body)
    extend.hidden = false

    // `forwardButton()`, NOT THE STRIP'S FIRST BUTTON, which is `↺`. Disabling any focused button
    // strands focus, so a positional lookup would pass while naming the wrong control.
    const forward = forwardButton()
    expect(forward).toBeDefined()
    forward?.focus()
    expect(document.activeElement).toBe(forward)
    if (forward !== undefined) forward.disabled = true
    expect(document.activeElement).toBe(document.body)
    if (forward !== undefined) forward.disabled = false
  }, 90_000)

  // HALF TWO — CAN A USER GESTURE REACH IT? Every gesture that opens the window is itself a
  // focus-bearing interaction somewhere else, so at the instant the controls are withdrawn, focus is
  // on the thing the user was touching and not on what was withdrawn.
  it('leaves focus on the gesture that opened the window, not on a withdrawn control', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: BUDGET_SRC } })
    await until(() => stepText().includes('history is full'))

    view.contentDOM.focus()
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } })
    expect(stepText()).toContain('— recompiling')
    expect(document.activeElement).toBe(view.contentDOM)
    await until(() => stepText().includes('history is full'))

    const picker = mustFind<HTMLSelectElement>('#encoding')
    picker.focus()
    picker.dispatchEvent(new Event('change'))
    expect(document.activeElement).toBe(picker)
  }, 90_000)

  // THE ONE ROUTE THAT DOES STRAND FOCUS, NAMED SO THE FINDING IS FALSIFIABLE RATHER THAN AN ABSENCE.
  // A document change dispatched while focus sits on `[continue]` reaches the hazard — and no user
  // gesture performs one: typing needs focus in the editor, and the picker needs focus on the picker.
  it('is reachable only by a programmatic dispatch, which no user gesture performs', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: BUDGET_SRC } })
    await until(() => stepText().includes('history is full'))

    const extend = mustFind<HTMLButtonElement>('[data-leaf="tm-0"] .controls .extend')
    extend.focus()
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } })
    expect(document.activeElement).toBe(document.body)
  }, 90_000)
})
```

- [ ] **Step 2: Run it and read the result rather than assuming it**

Run: `pnpm exec vitest run --project browser tests/browser/extend-focus-probe.test.ts`

Expected: 3 passed. **If the second test fails**, a user gesture does reach the hazard and this task
grows: add the focus rule — on withdrawal, move focus to the sibling control that remains, in
`pane-chrome.ts`'s `controlStrip.update` — retest, and record which gesture reached it. **Do not skip
or reshape a test to make it pass.** If half one fails instead, item 1's recorded mechanism does not
hold in this browser, which is a finding about item 1 and must be reported, not worked around.

- [ ] **Step 3: Commit**

```bash
cd /home/davey/projects/redextape/web && pnpm exec biome check --write . && cd /home/davey/projects/redextape
git add web/tests/browser/extend-focus-probe.test.ts
git commit -m "The stranding hazard is real and no gesture in this change reaches it

Accessibility item 8 invokes item 1, so this measures rather than assumes.
Hiding the focused \`[continue]\` does strand focus on \`<body>\`, and disabling a
focused \`▶\` does too — the mechanism item 1 recorded holds here. Every gesture
that opens the window is a focus-bearing interaction somewhere else, so focus is
on the editor or the picker at the instant the controls go, never on what went.

The one route that does reach it is a programmatic document dispatch, asserted
so the finding is falsifiable rather than an absence of evidence."
```

---

### Task 5: The roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` — the accessibility list's item 8, and a new closing entry at the end of the file

**Interfaces:**
- Consumes: the measured figures from Tasks 1–4.
- Produces: the entry the PR references.

- [ ] **Step 1: Strike item 8 in the accessibility list rather than deleting it**

Item 8 is at roadmap line ~1436. Follow the form item 1 already uses for a retired instance and item
10 uses for a correction: keep the original text, wrap the superseded claim in `~~…~~`, and append a
`**CLOSED 2026-09-09, PR #N.**` (the number the forge assigns when the PR is opened) paragraph naming what closed it. The two sentences elsewhere in the
list that point at item 8 must still point at something, which is why it is struck rather than
removed.

- [ ] **Step 2: Write the closing entry at the end of the roadmap**

Match the house form of the entries above it: an all-caps `####` headline naming the result **and the
branch's sharpest finding**, then the design and plan links, then the body, then `##### WHAT STAYS
OPEN`, then `##### VERIFICATION`.

The findings this branch actually produced, to be written only if they held:
- The design's own §3 was falsified by the call-site census it asked for, **before any code was
  written** — a required argument on `bind` would have had to be added by hand to a two-parameter
  interceptor in `scratch.test.ts`, where omitting it drops the callback silently. The fix reproducing
  the defect's shape inside the harness that tests it.
- Task 2's `transport.ts` sabotage reddens nothing in either tier — nothing in the node tier, and
  nothing in the browser tier either, matching Task 3 Step 3's own run of the same sabotage. Report
  that negative as what falsified design §4.1's justification for folding `awaitingRun` into
  `canRecordFurther`, not as a gap.
- Task 4's result, whichever way it came out.

`##### WHAT STAYS OPEN` must carry, at minimum:
- Items 1–7 and 9–16 of the accessibility list, and that this is one item and not the pass.
- Nothing here is announced: `stepText` is a plain `<span>` with no live region, and item 6 already
  holds that question for `#link-status`.
- `controlStrip`'s doc says the continue button is *"ADDED AND REMOVED, NEVER DISABLED"* while
  `update` sets `extend.hidden`. `hidden` does take the button out of the tab order and the
  accessibility tree, so nothing here depends on closing the gap — but the doc and the code do not say
  the same thing, and the pass should decide which one moves.
- `awaitingRun` is a superset of the worker's drop condition, not an equality (design §2.1).

- [ ] **Step 3: Re-run every figure the entry states, immediately before committing it**

No figure goes in from memory. Run each and paste the real number:

```bash
cd /home/davey/projects/redextape/web
pnpm run typecheck
pnpm run test:node
pnpm run test:browser
pnpm exec biome ci .
cd /home/davey/projects/redextape
git diff --stat d5da8c8..HEAD -- web/
```

Every VERIFICATION bullet names the command that produced it.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "Roadmap: accessibility item 8 closes"
```

- [ ] **Step 5: Open the PR**

The roadmap entry lands **before** the PR is opened. PR body paragraphs are one long line each — the
forge renders with GFM `breaks: true`, so a hard-wrapped paragraph renders as ragged lines.
