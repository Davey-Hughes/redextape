# 5d-ii-a — the layout tree: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app's panes a recursive split tree — split horizontally and vertically, drag- and keyboard-resizable dividers, close, and an arrangement that survives a reload — and in doing so make "two λ panes on two λ sessions" a state `main()` can reach.

**Architecture:** Three waves. Waves 1–2 decompose `main()` (`main.ts:62-1127`) into five factory modules and then replace its two singleton pane consts with a keyed collection; both are behaviour-preserving and add no tests. Wave 3 adds `layout.ts` (a DOM-free tree model), `layout-view.ts` (its rendering, dividers and drag/keyboard resize), the pane chrome controls, and `localStorage` persistence with invariant-checking validation.

**Tech Stack:** TypeScript 7.0.2, Vite 8, Vitest 4 (two projects: `node` and `browser`/Playwright-chromium), CodeMirror 6, Biome 2.5.7.

**Design:** [`../specs/2026-08-12-plan5d-ii-a-layout-tree-design.md`](../specs/2026-08-12-plan5d-ii-a-layout-tree-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Coverage gate, and `functions` is the one that will trip.** `vite.config.ts` sets `thresholds: { lines: 94, functions: 93, branches: 85, statements: 92 }` and its own comment computes the margin: **three new untested functions fail the build** (135/146 → 92.47%). Every task that adds a module adds its tests in the same task. Never defer tests to a later task.
- **The pre-commit gate runs on every commit** — control-byte check, `cargo fmt`, `cargo clippy`, `biome ci`, `web typecheck`. **Never `--no-verify`.** If a commit split is infeasible because an intermediate state fails the gate, collapse the commits and say so in the task report.
- **`exactOptionalPropertyTypes` is on.** `{ x: undefined }` does not satisfy `{ x?: T }`. Absence is real absence.
- **Doc comments in TypeScript are `/** */`, never `///`.** `///` is inert in TS and the repo has had it before.
- **No attribution in commit messages.** No `Co-Authored-By`, no `Generated with`.
- **No new colour-carried state.** The accessibility list is at eight items with three aggravations. This slice adds controls, not hues.
- **Test commands**, run from `web/`:
  - `pnpm test:node` — the node project
  - `pnpm test:browser` — the browser project (Playwright chromium, headless)
  - `pnpm test` — both
  - `pnpm typecheck` — `tsc --noEmit`
  - `pnpm test:coverage` — both, with the gate
- **`pnpm test:node -- <name>` DOES NOT SCOPE TO A FILE, and the failure is silent.** Measured 2026-08-12: `pnpm test:node -- sessions` runs **21 files / 262 tests**; `pnpm exec vitest run --project node tests/node/sessions.test.ts` runs **1 file / 11 tests**. The `--` terminates pnpm's argument parsing and vitest never sees the filter, so a run that looks scoped is the whole suite and a "N passed" expectation is measured against the wrong denominator. **Always pass the test file path positionally to `pnpm exec vitest run`**, as every command in this plan now does.
- **Browser-tier runs bind a port and must not overlap.** Two concurrent `--project browser` runs in one tree collide. Node-tier runs are ~270 ms and stateless, so they may overlap.

### Assertion strength — added mid-execution, after two tasks failed the same way

**AN ASSERTION ON THE SIGN OR THE EXISTENCE OF A VALUE IS NOT A TEST OF A COMPUTATION.** Two tasks in this plan shipped test suites that were green against broken code, independently and for the same underlying reason:

- **Task 10** asserted a drag reported a delta `> 0`. Dropping the pixel-to-fraction division so it reported `80` instead of `0.1` left all eight tests green. Writing the magnitude assertion then exposed a **real layout bug** — every split box collapsing to 12px — that the suite had never been able to see.
- **Task 11** asserted controls were absent after `update(…, false)`. Every test built a fresh instance whose default state was already "absent", so deleting the removal code entirely left all five tests green. The feature's headline behaviour had no coverage.

The rules that follow, binding on every remaining task:

1. **Assert the value, not its sign or its presence.** If a function computes a number, the test names the number. Geometry is known in these tests — the container is sized by the test itself — so the expected fraction is always computable.
2. **A test of a state TRANSITION must perform the transition.** Asserting an end state that the initial state already satisfies proves nothing. Mount, then remove, then assert.
3. **Before running any mutation, confirm the mutated line is reachable by the test you expect to fail.** A mutation to code behind a memoisation guard the test never trips is dead code, and "the test still passed" then means nothing at all.

### The wave 1–2 test rule

Waves 1 and 2 **add no tests**. The existing 371-test suite is the assertion that the extraction preserved behaviour. An existing test may be edited, but only within this boundary:

| may change | may not change |
|---|---|
| **import paths** — a symbol moved from `main.ts` to `link-wiring.ts` | **any assertion** — `expect`, `toBe`, `toEqual`, the value under test |
| **setup and construction** — a thing built inline now comes from a factory | **the set of tests** — nothing deleted, skipped, or renamed away |
| | **waits and timing** — no new or lengthened `until`/`settled` calls |

**A wave-1 or wave-2 commit whose test diff touches an assertion is a commit that stopped being a refactor.** Stop and find what moved. Timing is listed separately because it is the one that would look reasonable: the roadmap records `settled()`'s invariant being false and the flakes that followed (roadmap:1602-1651), and reaching for a longer wait is how a real ordering change gets absorbed into the suite instead of reported by it.

**Every such edit is named in its commit message with its category** — `test edits: imports only (5 files)` — so review asks "are these all imports and setup", not "did anything change in eleven files".

---

# Wave 1 — behaviour-preserving extraction

Five modules out of `main()`. Panes stay singletons; no behaviour changes.

**EVERY `main.ts` LINE NUMBER IN WAVE 1 IS PRE-EXTRACTION AND DRIFTS AS THE WAVE PROCEEDS.** They were
taken against `main.ts` at 1,135 lines; Task 1 alone took it to 967. **Locate code by name, never by
the line numbers in this plan** — they are a reading aid for the reviewer, not an address. Task 1
reported the drift and worked by name; every later task should assume the same.

**Cycles are broken with thunks, not with import order.** Every one of these clusters calls `draw()`, and `draw()` calls into several of them. Each factory takes the callbacks it needs as `() => void` parameters resolved at call time, so `main()` can construct them in any order and wire the thunks after. This is the same shape `SessionPool` already uses for its worker factory (`main.ts:675`).

---

### Task 1: Extract `link-wiring.ts`

**Files:**
- Create: `web/src/link-wiring.ts`
- Modify: `web/src/main.ts:220-237` (the four `let`s), `web/src/main.ts:348-480` (five functions), and every call site of those five
- Test: none — wave 1 rule

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export type LinkWiring = {
    setIndex(index: LinkIndex | null): void
    get linkable(): boolean
    get link(): Pin | null
    clearLink(): void
    setForkFailed(reason: string | null): void
    get forkFailed(): string | null
    lambdaLinkState(lambdaSpan: Span | null): LambdaLinkState
    lambdaLinkWindow(l: Link | null): LambdaWindow | null
    drawLink(l: Link | null, focusCoincident: boolean): void
    setLinkTo(node: number | null, origin: 'source' | 'lambda' | 'tm'): void
    linkAtSourceOffset(byteOffset: number): void
  }

  export function createLinkWiring(deps: {
    view: () => EditorView
    statusHost: HTMLElement
    sessions: SessionRegistry
    lambdaSlot: PaneSlot<'lambda'>
    tmSlot: PaneSlot<'tm'>
    lambdaPane: LambdaPane
    tmPane: TmPane
    draw: () => void
  }): LinkWiring
  ```

- [ ] **Step 1: Record the baseline**

Run from `web/`:

```bash
pnpm test 2>&1 | tail -5
```

Expected: 371 passed. Write the exact number into the task report — every later step compares against it.

- [ ] **Step 2: Create the module with the four state variables and the five functions moved verbatim**

Create `web/src/link-wiring.ts`. Move, without editing their bodies:

- `index`, `linkable`, `link`, `forkFailed` (`main.ts:220-222`, `:237`) — they become closure state inside `createLinkWiring`, reached through the accessors above.
- `lambdaLinkState` (`main.ts:348-372`)
- `drawLink` (`main.ts:374-418`)
- `lambdaLinkWindow` (`main.ts:420-434`)
- `setLinkTo` (`main.ts:436-461`)
- `linkAtSourceOffset` (`main.ts:463-480`)

`view` is a thunk because `main.ts:134` declares `let view: EditorView` and assigns it later; a value parameter would capture `undefined`. `draw` is a thunk because `setLinkTo` calls it and `draw()` calls `drawLink`.

Head the file with a doc comment stating what it owns and why the four `let`s moved together:

```ts
/**
 * THE LINK STATE AND EVERYTHING THAT READS IT — the cluster `main.ts` held as four `let`s visible to a
 * thousand lines.
 *
 * `index`, `linkable`, `link` and `forkFailed` are one fact in four variables: what the current
 * compile's link index is, whether it exists, what is pinned, and why a fork was refused. Nothing
 * outside this module writes any of them now, which is the whole point of the extraction — the
 * previous shape let any of `main()`'s thousand lines assign `link` and left the reader to find out
 * which ones did.
 *
 * `view` AND `draw` ARE THUNKS, NOT VALUES, AND THAT IS FORCED RATHER THAN STYLISTIC. `main.ts`
 * declares `let view: EditorView` and assigns it after this module is constructed, so a value
 * parameter would capture `undefined`; and `draw()` calls `drawLink` while `setLinkTo` calls `draw`,
 * so one of the two directions has to be late-bound. This is the same shape `SessionPool` already
 * uses for its worker factory.
 */
```

- [ ] **Step 3: Rewire `main.ts`**

Construct it after the panes exist (`main.ts:752`):

```ts
const linkWiring = createLinkWiring({
  view: () => view,
  statusHost: linkStatusHost,
  sessions,
  lambdaSlot,
  tmSlot,
  lambdaPane,
  tmPane,
  draw: () => draw(),
})
```

Replace every read of `index` / `linkable` / `link` / `forkFailed` with the accessor, and every call of the five functions with `linkWiring.<name>`. `index = new LinkIndex(...)` becomes `linkWiring.setIndex(new LinkIndex(...))`; `index = null` becomes `linkWiring.setIndex(null)`; `link = null` becomes `linkWiring.clearLink()`.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: no output, exit 0. A `TS2454` ("used before assigned") means a thunk was passed as a value — fix the call site, not the type.

- [ ] **Step 5: Run the full suite**

```bash
pnpm test 2>&1 | tail -5
```

Expected: the exact number from Step 1, all passing. **If any test needs editing, check it against the wave 1–2 table before touching it.** An assertion change means stop.

- [ ] **Step 6: Commit**

```bash
git add web/src/link-wiring.ts web/src/main.ts
git commit -m "$(cat <<'EOF'
link-wiring: the four `let`s that were visible to a thousand lines

`index`, `linkable`, `link` and `forkFailed` are one fact in four variables,
and `main()` let any of its 1,065 lines assign them. They are now one module's
closure state reached through accessors, with the five functions that read them
moved verbatim beside them.

`view` and `draw` are thunks rather than values because both are forced: `view`
is assigned after this module is constructed, and `draw()` calls `drawLink`
while `setLinkTo` calls `draw`, so one direction has to be late-bound.

Behaviour-preserving. 371/371, no test edits.
EOF
)"
```

---

### Task 2: Extract `draw.ts`

**Files:**
- Create: `web/src/draw.ts`
- Modify: `web/src/main.ts` — the `draw` function (`const draw = () => {` … ), locate by name
- Test: none — wave 1 rule

**`detachedPanes` IS NOT IN THIS TASK, correcting what this plan first said.** Task 1 found it had
exactly one caller — `drawLink` — so leaving it in `main.ts` would have been dead code failing
`biome`'s unused-variable check, and it moved into `link-wiring.ts` as an unexported helper. It is
there now (`link-wiring.ts:83`, called at `:167`). Do not move it again.

**Interfaces:**
- Consumes: `LinkWiring` from Task 1.
- Produces:
  ```ts
  export function createDraw(deps: {
    sessions: SessionRegistry
    lambdaSlot: PaneSlot<'lambda'>
    tmSlot: PaneSlot<'tm'>
    lambdaPane: LambdaPane
    tmPane: TmPane
    links: LinkWiring
  }): () => void
  ```

- [ ] **Step 1: Move `draw` verbatim into the factory**

Create `web/src/draw.ts`. The function moves unedited.

**Preserve the ordering comments exactly.** `main.ts:268` and `:280` record that `tmPane.setFocus` must run *before* `tmSlot.render` or `#drawTable` builds every row against the previous frame's focus and immediately rebuilds them. That comment is load-bearing and must survive the move with its reasoning intact.

Head the file:

```ts
/**
 * ONE FRAME, PAINTED ONCE — the per-frame pass that runs on every recorded frame during playback.
 *
 * THE ORDER INSIDE IT IS LOAD-BEARING AND THE COMMENTS SAYING SO MOVED WITH IT. `tmPane.setFocus`
 * runs before `tmSlot.render` because `TmPane`'s `#drawTable` runs unconditionally on every render,
 * so a focus handed over afterwards would build every row against the previous frame's value and
 * rebuild them all on the next call. Read the inline notes before reordering anything here.
 */
```

- [ ] **Step 2: Rewire `main.ts`**

```ts
const draw = createDraw({ sessions, lambdaSlot, tmSlot, lambdaPane, tmPane, links: linkWiring })
```

`draw` must be declared *before* `linkWiring` reads it through its thunk at call time — which it is, because the thunk is `() => draw()` and is only invoked after `main()` finishes wiring. If TypeScript complains about use-before-declaration, hoist with `let draw: () => void` and assign.

- [ ] **Step 3: Typecheck and run the suite**

```bash
pnpm typecheck && pnpm test 2>&1 | tail -5
```

Expected: no typecheck output; the Step-1 baseline count from Task 1, all passing.

- [ ] **Step 4: Commit**

```bash
git add web/src/draw.ts web/src/main.ts
git commit -m "$(cat <<'EOF'
draw: the per-frame pass, and the ordering notes that had to survive it

`draw` moves verbatim. The comments at the old :268 and :280
move with them unedited: `tmPane.setFocus` runs before `tmSlot.render` because
`#drawTable` runs unconditionally on every render, so a focus handed over after
it builds every row against the previous frame and rebuilds them next call.

Behaviour-preserving. 371/371, no test edits.
EOF
)"
```

---

### Task 3: Extract `transport.ts`

**Files:**
- Create: `web/src/transport.ts`
- Modify: `web/src/main.ts:482-500` (`play`), `web/src/main.ts:502-673` (`events`)
- Test: none — wave 1 rule

**Interfaces:**
- Consumes: `createDraw`'s return from Task 2.
- Produces:
  ```ts
  export function createTransport(deps: {
    sessions: SessionRegistry
    scratchpad: LambdaScratchpad
    draw: () => void
    schedule: () => void
  }): {
    play<T>(leg: LegState<T>): void
    events<K extends Leg>(slot: PaneSlot<K>): PaneEvents
  }
  ```

- [ ] **Step 1: Move `play` and `events` verbatim**

Create `web/src/transport.ts`. Both move unedited.

**`events` keeps its generic parameter `<K extends Leg>`.** Widening it to `Leg` here would collapse `Binding<K>`'s type property — the decision `sessions.ts:337-344` reserves for 5d-ii-b. Do not touch it.

Preserve the comment at `main.ts:502-511` about `controlStrip` wiring each `addEventListener` exactly once.

- [ ] **Step 2: Rewire `main.ts`**

```ts
const transport = createTransport({ sessions, scratchpad, draw, schedule: () => schedule(view.state.doc.toString()) })
```

Then `new LambdaPane(lambdaHost, transport.events(lambdaSlot))` and `new TmPane(tmHost, transport.events(tmSlot))`.

**Ordering problem, and it is real:** `transport` is needed to construct the panes, but Task 1's `linkWiring` and Task 2's `draw` both take the panes as values. Resolve it by constructing in this order — `transport` (with `draw` as a thunk `() => draw()`), then the panes, then `draw`, then `linkWiring` — and hoisting `draw` as `let draw: () => void`. Do not resolve it by passing panes as thunks; that pushes lateness into two more modules to avoid it in one.

- [ ] **Step 3: Typecheck and run the suite**

```bash
pnpm typecheck && pnpm test 2>&1 | tail -5
```

Expected: no typecheck output; the baseline count, all passing.

- [ ] **Step 4: Commit**

```bash
git add web/src/transport.ts web/src/main.ts
git commit -m "$(cat <<'EOF'
transport: play and the per-slot control handlers

`events` keeps its `<K extends Leg>` parameter. Widening it to `Leg` is the
decision sessions.ts:337-344 reserves for 5d-ii-b, and doing it here as a
side effect of moving a function is exactly the field-write that doc warns
against.

Construction order is now transport -> panes -> draw -> link-wiring, with
`draw` hoisted, because transport is needed to build the panes and the other
two take the panes as values.

Behaviour-preserving. 371/371, no test edits.
EOF
)"
```

---

### Task 4: Extract `replies.ts`

**Files:**
- Create: `web/src/replies.ts`
- Modify: `web/src/main.ts:767-870` (`onReply`), `web/src/main.ts:872-978` (`onScratchReply`)
- Test: none — wave 1 rule

**Interfaces:**
- Consumes: `LinkWiring` (Task 1), `draw` (Task 2).
- Produces:
  ```ts
  export function createReplies(deps: {
    sessions: SessionRegistry
    scratchpad: LambdaScratchpad
    results: HTMLElement
    root: HTMLElement
    view: () => EditorView
    lambdaSlot: PaneSlot<'lambda'>
    tmSlot: PaneSlot<'tm'>
    lambdaPane: LambdaPane
    tmPane: TmPane
    links: LinkWiring
    draw: () => void
    renderRows: (host: HTMLElement, rows: Row[]) => void
  }): {
    onReply(session: SessionId, reply: RunReply): void
    onScratchReply(session: SessionId, reply: RunReply): void
  }
  ```

- [ ] **Step 1: Move both handlers verbatim**

Create `web/src/replies.ts`. Both switch statements move unedited, with every inline comment.

**`renderRows` is injected rather than imported** because `main.ts:36-60` defines it locally over `results.ts`'s `Row`. If it has no other caller — check `grep -n 'renderRows' web/src/main.ts` — move it into `replies.ts` and drop it from the deps object instead. Prefer moving it; an injected function with one implementation is a parameter pretending to be a choice.

- [ ] **Step 2: Rewire `main.ts`**

```ts
const replies = createReplies({ sessions, scratchpad, results, root, view: () => view, lambdaSlot, tmSlot, lambdaPane, tmPane, links: linkWiring, draw })
```

The pool's `onReply` callback (`main.ts:675`) and the scratchpad's now delegate to `replies.onReply` / `replies.onScratchReply`.

- [ ] **Step 3: Typecheck and run the suite**

```bash
pnpm typecheck && pnpm test 2>&1 | tail -5
```

Expected: no typecheck output; the baseline count, all passing.

- [ ] **Step 4: Commit**

```bash
git add web/src/replies.ts web/src/main.ts
git commit -m "$(cat <<'EOF'
replies: the two reply switches, moved whole

`onReply` and `onScratchReply` move unedited, comments included. `renderRows`
moves with them rather than being injected — it had one caller, and a parameter
with one possible value is a choice that is not one.

Behaviour-preserving. 371/371, no test edits.
EOF
)"
```

---

### Task 5: Extract `compile.ts`

**Files:**
- Create: `web/src/compile.ts`
- Modify: `web/src/main.ts:980-1030` (`schedule`, the debounce timer, the picker listener)
- Test: none — wave 1 rule

**Interfaces:**
- Consumes: `LinkWiring` (Task 1), `draw` (Task 2).
- Produces:
  ```ts
  export function createCompile(deps: {
    sessions: SessionRegistry
    scratchpad: LambdaScratchpad
    results: HTMLElement
    picker: HTMLSelectElement
    view: () => EditorView
    lambdaPane: LambdaPane
    tmPane: TmPane
    links: LinkWiring
    draw: () => void
  }): { schedule(src: string): void }
  ```

- [ ] **Step 1: Move `schedule`, its `timer`, and the picker listener**

Create `web/src/compile.ts`. `DEBOUNCE_MS` (`main.ts:28`) moves with them; it has no other reader.

**`supersede()` semantics must not change.** `schedule` claims the generation synchronously at dispatch, which is what closed the `settled()` flake (roadmap:1602-1608). Moving the function must not reorder the `supersede` call relative to the `setTimeout`.

- [ ] **Step 2: Rewire `main.ts`**

```ts
const compile = createCompile({ sessions, scratchpad, results, picker, view: () => view, lambdaPane, tmPane, links: linkWiring, draw })
```

`transport`'s `schedule` thunk from Task 3 now resolves to `compile.schedule(view.state.doc.toString())`.

- [ ] **Step 3: Typecheck and run the suite**

```bash
pnpm typecheck && pnpm test 2>&1 | tail -5
```

Expected: no typecheck output; the baseline count, all passing. **`settled()`-dependent tests are the ones to watch here.** A flake in this step is a real ordering change, not a flaky suite — re-run once to confirm, then investigate rather than retry.

- [ ] **Step 4: Verify `main.ts` shrank as intended**

```bash
wc -l web/src/main.ts
```

Expected: roughly 250–300 lines. If it is still over 400, a cluster was left behind — name which one in the task report rather than starting a sixth extraction.

- [ ] **Step 5: Commit**

```bash
git add web/src/compile.ts web/src/main.ts
git commit -m "$(cat <<'EOF'
compile: the debounce pipeline, and the supersede order that had to survive

`schedule`, its timer, DEBOUNCE_MS and the encoding picker's listener move
together. The `supersede()` call keeps its position relative to the setTimeout:
claiming the generation synchronously at dispatch is what closed the settled()
flake (roadmap:1602-1608), and reordering it while moving the function would
reopen it silently.

Wave 1 complete. main.ts is now wiring.

Behaviour-preserving. 371/371, no test edits.
EOF
)"
```

---

# Wave 2 — the collection

---

### Task 6: `panes.ts` — the keyed pane collection

**Files:**
- Create: `web/src/panes.ts`
- Test: `web/tests/node/panes.test.ts`

**Interfaces:**
- Consumes: `PaneView`, `PaneSlot`, `SessionRegistry`, `Binding` from `sessions.ts`.
- Produces:
  ```ts
  export type LeafId = string

  export type PaneKind = 'source' | 'lambda' | 'tm'

  export type PaneEntry<K extends Leg> = {
    readonly id: LeafId
    readonly kind: PaneKind
    readonly slot: PaneSlot<K>
    readonly pane: PaneView<LegFrame[K]>
    readonly host: HTMLElement
  }

  export class PaneCollection {
    get size(): number
    add<K extends Leg>(entry: PaneEntry<K>): void
    remove(id: LeafId): void
    get(id: LeafId): PaneEntry<Leg> | undefined
    of<K extends Leg>(leg: K): PaneEntry<K>[]
    ofSession<K extends Leg>(leg: K, session: SessionId): PaneEntry<K>[]
    all(): PaneEntry<Leg>[]
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `web/tests/node/panes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ControlState } from '../../src/controls'
import { PaneCollection, type PaneEntry } from '../../src/panes'
import type { SessionId } from '../../src/session-client'
import type { BindingOption, PaneView } from '../../src/sessions'
import { PaneSlot } from '../../src/sessions'
import type { LambdaState, TmState } from '../../src/types'

/**
 * THE COLLECTION, DRIVEN WITHOUT A DOM — the container that replaces `main.ts`'s two pane consts.
 *
 * The claim under test is that `of` and `ofSession` select by leg AND by binding, because that is
 * what turns `tmPane.setProgram(x)` into a loop that reaches every TM pane on the session whose
 * worker sent the reply and no others. A collection that returned everything would still make the
 * app work today, with two panes, and would silently repaint the wrong session's pane the moment a
 * third existed.
 */

function fakePane<T>(): PaneView<T> & { frames: (T | null)[] } {
  const frames: (T | null)[] = []
  return {
    frames,
    render(frame: T | null, _c: ControlState) {
      frames.push(frame)
    },
    setBindings(_o: BindingOption[], _c: SessionId) {},
    setDetached(_d: boolean) {},
  }
}

/** A host with no document behind it — the collection stores the reference and never touches it. */
const fakeHost = () => ({}) as HTMLElement

function lambdaEntry(id: string, session: SessionId): PaneEntry<'lambda'> {
  return { id, kind: 'lambda', slot: new PaneSlot('lambda', session), pane: fakePane<LambdaState>(), host: fakeHost() }
}

function tmEntry(id: string, session: SessionId): PaneEntry<'tm'> {
  return { id, kind: 'tm', slot: new PaneSlot('tm', session), pane: fakePane<TmState>(), host: fakeHost() }
}

describe('PaneCollection', () => {
  it('selects by leg', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'source'))
    panes.add(tmEntry('c', 'source'))

    expect(panes.of('lambda').map((p) => p.id)).toEqual(['a', 'b'])
    expect(panes.of('tm').map((p) => p.id)).toEqual(['c'])
  })

  it('selects by leg AND session, which is what stops one session repainting another', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'lambda-scratch'))

    expect(panes.ofSession('lambda', 'source').map((p) => p.id)).toEqual(['a'])
    expect(panes.ofSession('lambda', 'lambda-scratch').map((p) => p.id)).toEqual(['b'])
  })

  it('follows a rebind rather than caching the binding it was added with', () => {
    const panes = new PaneCollection()
    const entry = lambdaEntry('a', 'source')
    panes.add(entry)
    expect(panes.ofSession('lambda', 'lambda-scratch')).toEqual([])

    entry.slot.rebind('lambda-scratch')

    expect(panes.ofSession('lambda', 'source')).toEqual([])
    expect(panes.ofSession('lambda', 'lambda-scratch').map((p) => p.id)).toEqual(['a'])
  })

  it('throws on a duplicate id, mirroring SessionRegistry.add', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    expect(() => panes.add(lambdaEntry('a', 'source'))).toThrow(/already/)
  })

  it('is idempotent on remove, mirroring SessionRegistry.remove', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.remove('a')
    expect(() => panes.remove('a')).not.toThrow()
    expect(panes.size).toBe(0)
  })

  it('iterates in insertion order', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('c', 'source'))
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'source'))
    expect(panes.all().map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })

  it('returns a registered pane by its id', () => {
    const panes = new PaneCollection()
    const entry = lambdaEntry('a', 'source')
    panes.add(entry)
    expect(panes.get('a')).toBe(entry)
  })

  it('returns undefined for an unknown id', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    expect(panes.get('unknown')).toBeUndefined()
  })

  it('stops returning a pane after remove', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    expect(panes.get('a')).toBeDefined()
    panes.remove('a')
    expect(panes.get('a')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm exec vitest run --project node tests/node/panes.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../src/panes'`.

- [ ] **Step 3: Write the implementation**

Create `web/src/panes.ts`:

```ts
import type { Leg } from './protocol'
import type { SessionId } from './session-client'
import type { LegFrame, PaneSlot, PaneView } from './sessions'

/** A leaf's stable identity — the key shared by the layout tree, the DOM and persistence. */
export type LeafId = string

/**
 * What a leaf renders.
 *
 * NOT A `Leg`, BECAUSE `'source'` IS NOT ONE. The source pane renders an editor rather than a leg's
 * frames, so a `Leg`-typed field could not name it. `'lambda'` and `'tm'` coincide with `Leg`'s
 * members and are deliberately not aliased to it — the day a pane kind exists that is not a leg, this
 * type extends and `Leg` does not.
 */
export type PaneKind = 'source' | 'lambda' | 'tm'

/**
 * One live pane: its leaf identity, what it renders, the slot that resolves its binding, the view
 * itself and the element it is mounted in.
 *
 * PARAMETERISED BY THE LEG, so `of('lambda')` yields entries whose `pane` is a `PaneView<LambdaState>`
 * and whose `slot` is a `PaneSlot<'lambda'>` — the property `Binding<K>` exists to protect
 * (`sessions.ts:110-124`), carried through the collection rather than lost at its boundary.
 */
export type PaneEntry<K extends Leg> = {
  readonly id: LeafId
  readonly kind: PaneKind
  readonly slot: PaneSlot<K>
  readonly pane: PaneView<LegFrame[K]>
  readonly host: HTMLElement
}

/**
 * THE PANE COLLECTION — what replaces `main.ts`'s `lambdaPane` and `tmPane` consts.
 *
 * Thirty call sites assumed exactly one pane of each leg. The question every one of them was really
 * asking is "which panes should this reply repaint", and the answer is a pair: the leg the reply is
 * about, and the session whose worker sent it. `ofSession` is that question; `of` is the half of it
 * that predates sessions.
 *
 * IT READS THE BINDING THROUGH THE SLOT ON EVERY CALL RATHER THAN INDEXING BY SESSION. A
 * `Map<SessionId, …>` would be a second copy of a fact `PaneSlot` already owns, and `rebind` would
 * have to remember to update it — the two-places-to-be-wrong failure `sessions.ts:8-16` refuses one
 * type up. The cost is a linear scan of a collection whose size is the number of panes on screen.
 *
 * INSERTION ORDER IS ITERATION ORDER, matching `SessionRegistry`'s `Map` for the same reason: it
 * falls out without a comparator that would have to invent a rank.
 */
export class PaneCollection {
  #entries = new Map<LeafId, PaneEntry<Leg>>()

  get size(): number {
    return this.#entries.size
  }

  /**
   * Register a pane.
   *
   * THROWS ON AN ID ALREADY HELD, mirroring `SessionRegistry.add` and `SessionPool.bind`. A pane owns
   * a mounted DOM subtree, so replacing one silently would strand an element nothing can reach.
   */
  add<K extends Leg>(entry: PaneEntry<K>): void {
    if (this.#entries.has(entry.id)) throw new Error(`pane is already in the collection: ${entry.id}`)
    this.#entries.set(entry.id, entry as PaneEntry<Leg>)
  }

  /** Forget `id`. Idempotent, mirroring `SessionRegistry.remove`: a second call asks for a state already true. */
  remove(id: LeafId): void {
    this.#entries.delete(id)
  }

  get(id: LeafId): PaneEntry<Leg> | undefined {
    return this.#entries.get(id)
  }

  /** Every pane rendering `leg`, in insertion order. */
  of<K extends Leg>(leg: K): PaneEntry<K>[] {
    const out: PaneEntry<K>[] = []
    for (const e of this.#entries.values()) {
      if (e.slot.binding.leg === leg) out.push(e as PaneEntry<K>)
    }
    return out
  }

  /** Every pane rendering `leg` AND bound to `session` — the question a reply handler is asking. */
  ofSession<K extends Leg>(leg: K, session: SessionId): PaneEntry<K>[] {
    const out: PaneEntry<K>[] = []
    for (const e of this.#entries.values()) {
      if (e.slot.binding.leg === leg && e.slot.binding.session === session) out.push(e as PaneEntry<K>)
    }
    return out
  }

  all(): PaneEntry<Leg>[] {
    return [...this.#entries.values()]
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run --project node tests/node/panes.test.ts 2>&1 | tail -10
```

Expected: 9 passed.

- [ ] **Step 5: Verify the tests can fail**

Temporarily change `ofSession` to ignore its `session` argument (return `this.of(leg)`), re-run, and confirm **"selects by leg AND session"** and **"follows a rebind"** both fail. Restore. Record both failure messages in the task report.

This step is not optional. 5d-iii shipped three tests that passed vacuously (roadmap:5595-5601) and this is the standing correction.

- [ ] **Step 6: Commit**

```bash
git add web/src/panes.ts web/tests/node/panes.test.ts
git commit -m "$(cat <<'EOF'
panes: the collection thirty call sites needed something to iterate

`of(leg)` and `ofSession(leg, session)` are the question every one of those
sites was really asking — which panes should this reply repaint. The binding is
read through the slot on every call rather than indexed by session: a
Map<SessionId, ...> would be a second copy of a fact PaneSlot already owns, and
rebind would have to remember to update it.

Both selectors verified capable of failing by making `ofSession` ignore its
session argument and watching two tests go red.
EOF
)"
```

---

### Task 7: Convert the thirty call sites to the collection

**Files:**
- Modify: `web/src/main.ts`, `web/src/draw.ts`, `web/src/replies.ts`, `web/src/link-wiring.ts`, `web/src/compile.ts`, `web/src/transport.ts`
- Test: none — wave 1–2 rule

**Interfaces:**
- Consumes: `PaneCollection` (Task 6).
- Produces: every wave-1 factory now takes `panes: PaneCollection` in place of `lambdaPane` / `tmPane` / `lambdaSlot` / `tmSlot`.

- [ ] **Step 1: Replace the deps in all five factories**

In each of `draw.ts`, `replies.ts`, `link-wiring.ts`, `compile.ts`, `transport.ts`: drop `lambdaPane`, `tmPane`, `lambdaSlot`, `tmSlot` from the deps object and add `panes: PaneCollection`.

- [ ] **Step 2: Convert each site to an iteration**

The patterns, exhaustively:

```ts
// per-session, in a reply handler where `session` is the parameter:
tmPane.setProgram(reply.tmProgram, reply.tapeNames)
for (const p of panes.ofSession('tm', session)) p.pane.setProgram(reply.tmProgram, reply.tapeNames)

// per-leg, where the app-wide link state changed and every pane on that leg follows:
lambdaPane.renderLink(win)
for (const p of panes.of('lambda')) p.pane.renderLink(win)

tmPane.setFocus(states)
for (const p of panes.of('tm')) p.pane.setFocus(states)

// the draw pass, over every pane rather than exactly two:
for (const p of panes.all()) {
  const leg = p.slot.resolve(sessions)
  if (p.slot.binding.leg === 'tm') p.pane.setFocus(tmFocusLink?.states ?? [])  // BEFORE render — see draw.ts
  p.slot.render(sessions, p.pane, leg)
}
```

**`setProgram`, `setEditor` and `setDiagnostics` are per-SESSION. `renderLink`, `setFocus` and `setLink` are per-LEG.** Getting this wrong is the bug this task exists to avoid: a per-session call fanned out per-leg repaints a scratch pane with the source session's program. Check each site against which handler it is in — if the enclosing function takes a `session` parameter, it is per-session.

**`setEditor` keeps exactly one target for now.** `replies.ts` calls it on the pane that forked. Wave 3 Task 12 generalizes it to the editor-moves rule; converting it here to "every bound pane" would ship the desync §4.3 rejects, briefly, in a commit that claims to be behaviour-preserving.

- [ ] **Step 3: Build the two panes into the collection in `main.ts`**

```ts
const panes = new PaneCollection()
panes.add({ id: 'lambda-0', kind: 'lambda', slot: lambdaSlot, pane: lambdaPane, host: lambdaHost })
panes.add({ id: 'tm-0', kind: 'tm', slot: tmSlot, pane: tmPane, host: tmHost })
```

Still two panes, still the same two hosts. Only the route to them changed.

- [ ] **Step 4: Typecheck and run the suite**

```bash
pnpm typecheck && pnpm test 2>&1 | tail -5
```

Expected: no typecheck output; the baseline count, all passing.

- [ ] **Step 5: Prove a missed site would have been caught**

Temporarily change one `ofSession('tm', session)` to `of('tm')` and run `pnpm test:browser`. If nothing fails, the suite does not currently distinguish the two — **record that in the task report as a known gap**, because it means Step 2's correctness rests on review rather than on the suite. Restore either way.

- [ ] **Step 6: Commit**

```bash
git add web/src/
git commit -m "$(cat <<'EOF'
panes: route thirty call sites through the collection

Still two panes and the same two hosts; only the route changed. The split that
matters is per-SESSION (setProgram, setEditor, setDiagnostics) versus per-LEG
(renderLink, setFocus, setLink) — fanning a per-session call out per leg would
repaint a scratch pane with the source session's program, which is the bug this
task exists to avoid and which no test currently catches.

setEditor keeps one target. Generalising it to every bound pane is the
editor-moves rule in wave 3, and doing it here would ship the desync design
4.3 rejects inside a commit claiming to be behaviour-preserving.

Wave 2 complete. Behaviour-preserving, 371/371, no test edits.
EOF
)"
```

---

# Wave 3 — the layout

---

### Task 8: `layout.ts` — the tree model

**Files:**
- Create: `web/src/layout.ts`
- Test: `web/tests/node/layout.test.ts`

**Interfaces:**
- Consumes: `LeafId`, `PaneKind` from `panes.ts` (Task 6).
- Produces:
  ```ts
  export type Dir = 'row' | 'column'
  export type LayoutNode =
    | { kind: 'leaf'; id: LeafId; pane: PaneKind }
    | { kind: 'split'; dir: Dir; children: LayoutNode[]; sizes: number[] }

  export const MIN_PANE_FRACTION: number
  export function defaultLayout(): LayoutNode
  export function leaves(root: LayoutNode): { kind: 'leaf'; id: LeafId; pane: PaneKind }[]
  export function splitLeaf(root: LayoutNode, id: LeafId, dir: Dir, newId: LeafId): LayoutNode
  export function closeLeaf(root: LayoutNode, id: LeafId): LayoutNode
  export function resize(root: LayoutNode, path: number[], index: number, delta: number): LayoutNode
  ```

- [ ] **Step 1: Write the failing test**

Create `web/tests/node/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  closeLeaf,
  defaultLayout,
  type LayoutNode,
  leaves,
  MIN_PANE_FRACTION,
  resize,
  splitLeaf,
} from '../../src/layout'

/**
 * THE TREE MODEL, WITH NO DOM ANYWHERE — every invariant design §4.1 states, asserted as a value.
 *
 * The reason this tier exists at all is that a layout bug is invisible in a browser until it is
 * grotesque: a single-child split renders as a pane with slightly wrong padding, and sizes that do
 * not sum to 1 render as a gap. Both are values here.
 */

const leaf = (id: string, pane: 'source' | 'lambda' | 'tm'): LayoutNode => ({ kind: 'leaf', id, pane })

describe('defaultLayout', () => {
  it('reproduces the arrangement index.html ships', () => {
    expect(defaultLayout()).toEqual({
      kind: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [
        { kind: 'split', dir: 'row', sizes: [0.5, 0.5], children: [leaf('source', 'source'), leaf('lambda-0', 'lambda')] },
        leaf('tm-0', 'tm'),
      ],
    })
  })
})

describe('splitLeaf', () => {
  it('replaces the leaf with a split holding it and a duplicate of its kind', () => {
    const tree = splitLeaf(leaf('lambda-0', 'lambda'), 'lambda-0', 'row', 'lambda-1')
    expect(tree).toEqual({
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leaf('lambda-0', 'lambda'), leaf('lambda-1', 'lambda')],
    })
  })

  it('splits a nested leaf without disturbing its siblings', () => {
    const tree = splitLeaf(defaultLayout(), 'tm-0', 'column', 'tm-1')
    expect(leaves(tree).map((l) => l.id)).toEqual(['source', 'lambda-0', 'tm-0', 'tm-1'])
  })

  it('refuses to split the source leaf, because there is no second editor to duplicate', () => {
    expect(() => splitLeaf(defaultLayout(), 'source', 'row', 'source-1')).toThrow(/source/)
  })

  it('throws on an unknown leaf rather than returning the tree unchanged', () => {
    expect(() => splitLeaf(defaultLayout(), 'nope', 'row', 'x')).toThrow(/nope/)
  })
})

describe('closeLeaf', () => {
  it('collapses a split left with one child into that child', () => {
    const tree = splitLeaf(leaf('lambda-0', 'lambda'), 'lambda-0', 'row', 'lambda-1')
    expect(closeLeaf(tree, 'lambda-1')).toEqual(leaf('lambda-0', 'lambda'))
  })

  it('collapses recursively so no single-child spine survives', () => {
    // column[ row[source, lambda-0], tm-0 ] -> close source, close lambda-0 -> leaf(tm-0)
    const afterSource = closeLeaf(defaultLayout(), 'source')
    expect(afterSource).toEqual({
      kind: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [leaf('lambda-0', 'lambda'), leaf('tm-0', 'tm')],
    })
    expect(closeLeaf(afterSource, 'lambda-0')).toEqual(leaf('tm-0', 'tm'))
  })

  it('refuses to close the last leaf', () => {
    expect(() => closeLeaf(leaf('tm-0', 'tm'), 'tm-0')).toThrow(/last/)
  })

  it('renormalizes the sizes of the split it left', () => {
    const three: LayoutNode = {
      kind: 'split',
      dir: 'row',
      sizes: [0.2, 0.3, 0.5],
      children: [leaf('a', 'lambda'), leaf('b', 'lambda'), leaf('c', 'tm')],
    }
    const after = closeLeaf(three, 'b')
    expect(after.kind).toBe('split')
    if (after.kind !== 'split') throw new Error('unreachable')
    expect(after.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
    // The survivors keep their RATIO: 0.2 : 0.5 becomes 0.2/0.7 : 0.5/0.7.
    expect(after.sizes[0]).toBeCloseTo(0.2 / 0.7, 10)
  })
})

describe('resize', () => {
  const pair: LayoutNode = {
    kind: 'split',
    dir: 'row',
    sizes: [0.5, 0.5],
    children: [leaf('a', 'lambda'), leaf('b', 'tm')],
  }

  it('moves the boundary between two children and keeps the sum at 1', () => {
    const after = resize(pair, [], 0, 0.1)
    if (after.kind !== 'split') throw new Error('unreachable')
    expect(after.sizes).toEqual([0.6, 0.4])
  })

  it('clamps rather than shrinking a pane below the minimum', () => {
    const after = resize(pair, [], 0, 0.9)
    if (after.kind !== 'split') throw new Error('unreachable')
    expect(after.sizes[1]).toBeCloseTo(MIN_PANE_FRACTION, 10)
    expect(after.sizes[0]).toBeCloseTo(1 - MIN_PANE_FRACTION, 10)
  })

  it('clamps in the other direction too', () => {
    const after = resize(pair, [], 0, -0.9)
    if (after.kind !== 'split') throw new Error('unreachable')
    expect(after.sizes[0]).toBeCloseTo(MIN_PANE_FRACTION, 10)
  })

  it('resizes a nested split addressed by path', () => {
    const after = resize(defaultLayout(), [0], 0, 0.1)
    if (after.kind !== 'split') throw new Error('unreachable')
    const inner = after.children[0]
    if (inner?.kind !== 'split') throw new Error('unreachable')
    expect(inner.sizes).toEqual([0.6, 0.4])
  })
})

describe('immutability', () => {
  it('never mutates the tree it was given', () => {
    const before = defaultLayout()
    const snapshot = structuredClone(before)
    splitLeaf(before, 'tm-0', 'row', 'tm-1')
    closeLeaf(before, 'source')
    resize(before, [], 0, 0.2)
    expect(before).toEqual(snapshot)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm exec vitest run --project node tests/node/layout.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../src/layout'`.

- [ ] **Step 3: Write the implementation**

Create `web/src/layout.ts`:

```ts
import type { LeafId, PaneKind } from './panes'

export type Dir = 'row' | 'column'

/**
 * THE LAYOUT TREE — design §4.1.
 *
 * A LEAF CARRIES A `PaneKind`, NOT A `Leg`, AND NOT A SESSION. `'source'` is not a `Leg` — the source
 * pane renders an editor rather than a leg's frames — so a `Leg`-typed field could not name it. The
 * session is absent because no binding is persistable (design §3.3: no scratch survives a reload, so a
 * stored binding has exactly one value that could ever resolve) and because the runtime pairing lives
 * in `panes.ts`, keyed by `LeafId`. That absence is what keeps this module free of `SessionRegistry`
 * and therefore testable as a value.
 *
 * EVERY OPERATION RETURNS A NEW TREE. Nothing here mutates its argument — the caller holds one tree
 * and replaces it, which is what makes an undo or a persistence write a matter of keeping the old
 * value rather than of re-deriving it.
 */
export type LayoutNode =
  | { kind: 'leaf'; id: LeafId; pane: PaneKind }
  | { kind: 'split'; dir: Dir; children: LayoutNode[]; sizes: number[] }

/**
 * The smallest fraction of its split a pane may be shrunk to by a drag.
 *
 * A FRACTION RATHER THAN A PIXEL COUNT, so this module needs no element measurements and stays
 * node-testable. `layout-view.ts` converts a pointer delta into a fraction of the split's measured
 * extent before calling `resize`, which is the one place a pixel exists.
 *
 * 0.1 IS A CHOICE, NOT A MEASUREMENT, and is recorded as such: at a 1,200px window a 10% floor is
 * ~120px, which is wider than the δ-table's narrowest column and about four characters of λ text.
 * Nothing was measured to pick it; if a pane turns out to be unusable at the floor, the number moves.
 */
export const MIN_PANE_FRACTION = 0.1

/**
 * The arrangement `index.html` ships, as a tree — design §4.1.
 *
 * Two columns holding source and λ, with TM spanning beneath them, which is `style.css:209-211`'s grid
 * plus `style.css:215-216`'s `.pane.wide`. A user who never touches a divider sees no change, which is
 * why this exact shape rather than a tidier one.
 */
export function defaultLayout(): LayoutNode {
  return {
    kind: 'split',
    dir: 'column',
    sizes: [0.5, 0.5],
    children: [
      {
        kind: 'split',
        dir: 'row',
        sizes: [0.5, 0.5],
        children: [
          { kind: 'leaf', id: 'source', pane: 'source' },
          { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
        ],
      },
      { kind: 'leaf', id: 'tm-0', pane: 'tm' },
    ],
  }
}

/** Every leaf, left to right, depth first — the order panes are created and tab order follows. */
export function leaves(root: LayoutNode): { kind: 'leaf'; id: LeafId; pane: PaneKind }[] {
  if (root.kind === 'leaf') return [root]
  return root.children.flatMap(leaves)
}

function findLeaf(root: LayoutNode, id: LeafId): { kind: 'leaf'; id: LeafId; pane: PaneKind } | null {
  return leaves(root).find((l) => l.id === id) ?? null
}

/** Scale `sizes` so they sum to 1, preserving their ratios. */
function normalize(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0)
  if (total <= 0) return sizes.map(() => 1 / sizes.length)
  return sizes.map((s) => s / total)
}

/**
 * Replace the leaf `id` with a split holding it and a new leaf of the same kind.
 *
 * THE NEW LEAF DUPLICATES THE KIND, WHICH IS WHY THIS SLICE NEEDS NO PICKER. Splitting the λ pane
 * gives a second λ pane, which the binding selector 5d-i shipped can then point at a scratch — and
 * that is "two λ sessions side by side" with `PaneSlot<K>` untouched. Creating a pane of a DIFFERENT
 * kind is 5d-ii-b.
 *
 * THE SOURCE LEAF IS REFUSED RATHER THAN SPECIAL-CASED INTO SOMETHING. There is one editor, so there
 * is nothing to duplicate into, and a split producing an undefined second thing is the fabricated
 * state `session.rs:257-273` prices. `layout-view.ts` does not render a split control on the source
 * pane at all — this throw is the backstop for a caller that got there another way, not the UI.
 */
export function splitLeaf(root: LayoutNode, id: LeafId, dir: Dir, newId: LeafId): LayoutNode {
  const target = findLeaf(root, id)
  if (target === null) throw new Error(`cannot split a leaf that is not in the tree: ${id}`)
  if (target.pane === 'source') throw new Error('the source pane cannot be split: there is one editor to duplicate')

  const rewrite = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'leaf') {
      if (node.id !== id) return node
      return {
        kind: 'split',
        dir,
        sizes: [0.5, 0.5],
        children: [node, { kind: 'leaf', id: newId, pane: node.pane }],
      }
    }
    return { ...node, children: node.children.map(rewrite) }
  }
  return rewrite(root)
}

/**
 * Remove the leaf `id`, collapsing any split it leaves with a single child.
 *
 * COLLAPSE IS RECURSIVE AND IT HAS TO BE. Closing the only other child of an inner split leaves a
 * one-child split inside a one-child split, and a single collapse pass would leave the outer one. A
 * single-child split renders as a pane with an extra layer of padding and no divider — visible enough
 * to be wrong, subtle enough to survive a browser test.
 *
 * SURVIVING SIBLINGS KEEP THEIR RATIO. A split of [0.2, 0.3, 0.5] that loses its middle child becomes
 * [0.2/0.7, 0.5/0.7] rather than [0.5, 0.5] — the panes the user sized stay the relative size the user
 * made them.
 *
 * THE LAST LEAF CANNOT GO. An empty tree has no honest rendering, and `layout-view.ts` omits the close
 * control when one leaf remains, so this throw is a backstop rather than the mechanism.
 */
export function closeLeaf(root: LayoutNode, id: LeafId): LayoutNode {
  if (findLeaf(root, id) === null) throw new Error(`cannot close a leaf that is not in the tree: ${id}`)
  if (leaves(root).length === 1) throw new Error('cannot close the last leaf')

  const rewrite = (node: LayoutNode): LayoutNode | null => {
    if (node.kind === 'leaf') return node.id === id ? null : node

    const kept: LayoutNode[] = []
    const keptSizes: number[] = []
    node.children.forEach((child, i) => {
      const next = rewrite(child)
      if (next === null) return
      kept.push(next)
      keptSizes.push(node.sizes[i] ?? 1 / node.children.length)
    })

    if (kept.length === 0) return null
    if (kept.length === 1) return kept[0] ?? null
    return { ...node, children: kept, sizes: normalize(keptSizes) }
  }

  const next = rewrite(root)
  if (next === null) throw new Error('cannot close the last leaf')
  return next
}

/** The split at `path` — [] is the root, [0] its first child, [0, 1] that child's second. */
function at(root: LayoutNode, path: number[]): LayoutNode {
  let node = root
  for (const i of path) {
    if (node.kind !== 'split') throw new Error(`layout path leaves the tree at index ${i}`)
    const next = node.children[i]
    if (next === undefined) throw new Error(`layout path leaves the tree at index ${i}`)
    node = next
  }
  return node
}

/**
 * Move the boundary between children `index` and `index + 1` of the split at `path` by `delta`.
 *
 * `delta` IS A FRACTION OF THE SPLIT, NOT PIXELS — see `MIN_PANE_FRACTION`. The conversion happens in
 * `layout-view.ts` against a measured element, and it is the only pixel in the layout.
 *
 * IT CLAMPS RATHER THAN REFUSING. A drag that would take either neighbour below the floor stops at the
 * floor and keeps tracking the pointer; refusing outright would make the divider appear stuck and
 * invite a second drag in the same direction.
 *
 * ONLY THE TWO NEIGHBOURS MOVE. Everything else in the split keeps its size, which is what makes a
 * divider a divider rather than a re-layout.
 */
export function resize(root: LayoutNode, path: number[], index: number, delta: number): LayoutNode {
  const split = at(root, path)
  if (split.kind !== 'split') throw new Error('resize addressed a leaf')
  const a = split.sizes[index]
  const b = split.sizes[index + 1]
  if (a === undefined || b === undefined) throw new Error(`no divider at index ${index}`)

  const clamped = Math.max(MIN_PANE_FRACTION - a, Math.min(delta, b - MIN_PANE_FRACTION))
  const sizes = [...split.sizes]
  sizes[index] = a + clamped
  sizes[index + 1] = b - clamped

  const rewrite = (node: LayoutNode, rest: number[]): LayoutNode => {
    if (rest.length === 0) {
      if (node.kind !== 'split') throw new Error('resize addressed a leaf')
      return { ...node, sizes }
    }
    if (node.kind !== 'split') throw new Error('resize path leaves the tree')
    const [head, ...tail] = rest
    return {
      ...node,
      children: node.children.map((c, i) => (i === head ? rewrite(c, tail) : c)),
    }
  }
  return rewrite(root, path)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run --project node tests/node/layout.test.ts 2>&1 | tail -10
```

Expected: 14 passed.

- [ ] **Step 5: Verify the tests can fail**

Three mutations, each run and then reverted. Record every failure message in the task report:

1. In `closeLeaf`, change `if (kept.length === 1) return kept[0] ?? null` to `if (kept.length === 1) return { ...node, children: kept, sizes: [1] }`. Expect **"collapses a split left with one child"** and **"collapses recursively"** to fail.
2. In `closeLeaf`, replace `normalize(keptSizes)` with `keptSizes`. Expect **"renormalizes the sizes"** to fail.
3. In `resize`, drop the `Math.max`/`Math.min` clamp. Expect both **"clamps"** tests to fail.

- [ ] **Step 6: Commit**

```bash
git add web/src/layout.ts web/tests/node/layout.test.ts
git commit -m "$(cat <<'EOF'
layout: the tree model, as a value with no DOM in it

A leaf carries a PaneKind rather than a Leg — 'source' is not a leg — and no
session, because design 3.3 establishes no binding is persistable and the
runtime pairing lives in panes.ts. That absence is what keeps this module free
of SessionRegistry and assertable as a value, which matters because a layout
bug is invisible in a browser until it is grotesque: a single-child split
renders as slightly wrong padding.

Collapse is recursive because one pass leaves the outer split when an inner one
empties. Surviving siblings keep their ratio rather than being reset to equal
shares. resize clamps and keeps tracking rather than refusing, so a divider
never appears stuck.

MIN_PANE_FRACTION = 0.1 is recorded as a choice, not a measurement.

All three behaviours verified capable of failing: collapse, renormalize, clamp.
EOF
)"
```

---

### Task 9: `parseLayout` / `serializeLayout` — persistence with invariant validation

**Files:**
- Modify: `web/src/layout.ts`
- Test: `web/tests/node/layout.test.ts` (extend)

**Interfaces:**
- Consumes: `LayoutNode`, `defaultLayout` (Task 8).
- Produces:
  ```ts
  export const LAYOUT_STORAGE_KEY = 'redextape.layout'
  export const LAYOUT_VERSION = 1
  export function serializeLayout(root: LayoutNode): string
  export function parseLayout(raw: string | null): LayoutNode | null
  ```

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/node/layout.test.ts`:

```ts
import { defaultLayout as dl, LAYOUT_VERSION, parseLayout, serializeLayout } from '../../src/layout'

/**
 * VALIDATION IS THE WORK HERE, NOT PARSING — design §4.4.
 *
 * `localStorage` is user-editable, so a value that passes a shallow shape check but violates §4.1
 * crashes inside the renderer on load, which is strictly worse than falling back. Every case below is
 * a hand-written malformed value rather than a mutation of a good one, because a hand-edited entry is
 * the hazard being defended against.
 */
describe('parseLayout', () => {
  const wrap = (tree: unknown) => JSON.stringify({ version: LAYOUT_VERSION, tree })

  it('round-trips a tree it serialized', () => {
    expect(parseLayout(serializeLayout(dl()))).toEqual(dl())
  })

  it('returns null for absent storage', () => {
    expect(parseLayout(null)).toBeNull()
  })

  it('returns null for text that is not JSON', () => {
    expect(parseLayout('{oh no')).toBeNull()
  })

  it('returns null for a wrong version', () => {
    expect(parseLayout(JSON.stringify({ version: 99, tree: dl() }))).toBeNull()
  })

  it('returns null for a missing version', () => {
    expect(parseLayout(JSON.stringify({ tree: dl() }))).toBeNull()
  })

  it('returns null for an unknown pane kind', () => {
    expect(parseLayout(wrap({ kind: 'leaf', id: 'a', pane: 'quantum' }))).toBeNull()
  })

  it('returns null for non-array children', () => {
    expect(parseLayout(wrap({ kind: 'split', dir: 'row', children: 'nope', sizes: [1] }))).toBeNull()
  })

  it('returns null for a split with fewer than two children', () => {
    expect(parseLayout(wrap({ kind: 'split', dir: 'row', children: [{ kind: 'leaf', id: 'a', pane: 'tm' }], sizes: [1] }))).toBeNull()
  })

  it('returns null when sizes and children disagree in length', () => {
    expect(
      parseLayout(
        wrap({
          kind: 'split',
          dir: 'row',
          children: [{ kind: 'leaf', id: 'a', pane: 'tm' }, { kind: 'leaf', id: 'b', pane: 'tm' }],
          sizes: [0.5],
        }),
      ),
    ).toBeNull()
  })

  it('returns null when sizes do not sum to 1', () => {
    expect(
      parseLayout(
        wrap({
          kind: 'split',
          dir: 'row',
          children: [{ kind: 'leaf', id: 'a', pane: 'tm' }, { kind: 'leaf', id: 'b', pane: 'tm' }],
          sizes: [0.5, 0.9],
        }),
      ),
    ).toBeNull()
  })

  it('returns null for duplicate leaf ids', () => {
    expect(
      parseLayout(
        wrap({
          kind: 'split',
          dir: 'row',
          children: [{ kind: 'leaf', id: 'a', pane: 'tm' }, { kind: 'leaf', id: 'a', pane: 'lambda' }],
          sizes: [0.5, 0.5],
        }),
      ),
    ).toBeNull()
  })

  it('returns null for more than one source leaf', () => {
    expect(
      parseLayout(
        wrap({
          kind: 'split',
          dir: 'row',
          children: [{ kind: 'leaf', id: 'a', pane: 'source' }, { kind: 'leaf', id: 'b', pane: 'source' }],
          sizes: [0.5, 0.5],
        }),
      ),
    ).toBeNull()
  })

  it('returns null for an unknown split direction', () => {
    expect(
      parseLayout(
        wrap({
          kind: 'split',
          dir: 'diagonal',
          children: [{ kind: 'leaf', id: 'a', pane: 'tm' }, { kind: 'leaf', id: 'b', pane: 'tm' }],
          sizes: [0.5, 0.5],
        }),
      ),
    ).toBeNull()
  })

  it('accepts a tree with no source leaf, because closing it is legal', () => {
    const noSource = wrap({
      kind: 'split',
      dir: 'row',
      children: [{ kind: 'leaf', id: 'a', pane: 'lambda' }, { kind: 'leaf', id: 'b', pane: 'tm' }],
      sizes: [0.5, 0.5],
    })
    expect(parseLayout(noSource)).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm exec vitest run --project node tests/node/layout.test.ts 2>&1 | tail -20
```

Expected: FAIL — `parseLayout is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `web/src/layout.ts`:

```ts
/**
 * The `localStorage` key the layout is stored under.
 *
 * NAMESPACED, for the reason `appearance.ts:10-12` gives: `localStorage` is scoped to an origin and
 * not to an app, so every dev server on the same host shares one store.
 */
export const LAYOUT_STORAGE_KEY = 'redextape.layout'

/** Bumped when the stored shape changes. A mismatch falls back to the default rather than migrating. */
export const LAYOUT_VERSION = 1

/** How far the sum of a split's sizes may drift from 1 before the tree is rejected. */
const SIZE_EPSILON = 1e-6

export function serializeLayout(root: LayoutNode): string {
  return JSON.stringify({ version: LAYOUT_VERSION, tree: root })
}

const PANE_KINDS: readonly string[] = ['source', 'lambda', 'tm']

/**
 * Validate one node and collect its leaf ids, returning `false` on the first violation.
 *
 * IT CHECKS §4.1's INVARIANTS AND NOT ONLY THE SHAPE, WHICH IS THE WHOLE POINT. A single-child split
 * or sizes summing to 1.4 parse perfectly as JSON and then render as a pane with wrong padding or a
 * gap where a divider should be — a crash would at least be reported. The hazard is a hand-edited
 * entry, so every rejection here is something a person could plausibly type.
 */
function validate(node: unknown, ids: Set<string>): node is LayoutNode {
  if (typeof node !== 'object' || node === null) return false
  const n = node as Record<string, unknown>

  if (n.kind === 'leaf') {
    if (typeof n.id !== 'string' || n.id.length === 0) return false
    if (typeof n.pane !== 'string' || !PANE_KINDS.includes(n.pane)) return false
    if (ids.has(n.id)) return false
    ids.add(n.id)
    return true
  }

  if (n.kind !== 'split') return false
  if (n.dir !== 'row' && n.dir !== 'column') return false
  if (!Array.isArray(n.children) || !Array.isArray(n.sizes)) return false
  if (n.children.length < 2) return false
  if (n.children.length !== n.sizes.length) return false
  if (!n.sizes.every((s: unknown) => typeof s === 'number' && Number.isFinite(s) && s > 0)) return false
  const total = (n.sizes as number[]).reduce((a, b) => a + b, 0)
  if (Math.abs(total - 1) > SIZE_EPSILON) return false
  return n.children.every((c: unknown) => validate(c, ids))
}

/**
 * The stored layout, or `null` if there is nothing usable there.
 *
 * `null` RATHER THAN A THROW OR A DEFAULT. The caller already knows what the default is
 * (`defaultLayout()`), and returning it from here would make "there was nothing stored" and "what was
 * stored was garbage" indistinguishable to a test. Failure is silent to the user by design §4.4: a
 * layout is a preference, and a banner on every load after a schema bump is worse than what it
 * reports.
 */
export function parseLayout(raw: string | null): LayoutNode | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const envelope = parsed as Record<string, unknown>
  if (envelope.version !== LAYOUT_VERSION) return null

  const ids = new Set<string>()
  const tree = envelope.tree
  if (!validate(tree, ids)) return null

  const sources = leaves(tree).filter((l) => l.pane === 'source').length
  if (sources > 1) return null

  return tree
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run --project node tests/node/layout.test.ts 2>&1 | tail -10
```

Expected: 28 passed (14 from Task 8 plus 14 here).

- [ ] **Step 5: Verify the validator can fail**

Replace `validate`'s body with `return true` and re-run. Expect **every** rejection test to fail while the round-trip and `null` cases still pass — that contrast is what proves the tests target validation rather than parsing. Restore and record the count in the task report.

- [ ] **Step 6: Commit**

```bash
git add web/src/layout.ts web/tests/node/layout.test.ts
git commit -m "$(cat <<'EOF'
layout: persistence, and the validation that is the actual work

parseLayout checks 4.1's invariants rather than the shape. localStorage is
user-editable, and a single-child split or sizes summing to 1.4 parse perfectly
as JSON before rendering as wrong padding or a gap — a crash would at least be
reported. Every rejection is something a person could plausibly type.

It returns null rather than the default so that "nothing stored" and "garbage
stored" stay distinguishable to a test.

Validator verified capable of failing: with its body replaced by `return true`
every rejection test goes red while round-trip and null stay green.
EOF
)"
```

---

### Task 10: `layout-view.ts` — rendering, dividers, drag and keyboard resize

**Files:**
- Create: `web/src/layout-view.ts`
- Modify: `web/src/style.css`
- Test: `web/tests/browser/layout-view.test.ts`

**Interfaces:**
- Consumes: `LayoutNode`, `Dir`, `resize`, `leaves` (Tasks 8–9); `LeafId` (Task 6).
- Produces:
  ```ts
  export function renderLayout(
    root: HTMLElement,
    tree: LayoutNode,
    hosts: Map<LeafId, HTMLElement>,
    onResize: (path: number[], index: number, delta: number) => void,
  ): void
  ```

- [ ] **Step 1: Write the failing test**

Create `web/tests/browser/layout-view.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { defaultLayout, type LayoutNode } from '../../src/layout'
import { renderLayout } from '../../src/layout-view'

/**
 * THE TREE AS DOM — geometry, dividers, and the keyboard path design §6.2 refuses to defer.
 *
 * A drag-only divider makes the whole layout mouse-only, which is a different class of gap from an
 * unannounced state change, so the arrow-key path is asserted here rather than added to the standing
 * accessibility list.
 */

let root: HTMLElement
const hosts = new Map<string, HTMLElement>()

function host(id: string): HTMLElement {
  const el = document.createElement('section')
  el.dataset.leaf = id
  hosts.set(id, el)
  return el
}

beforeEach(() => {
  document.body.innerHTML = ''
  hosts.clear()
  root = document.createElement('main')
  root.style.width = '800px'
  root.style.height = '600px'
  document.body.append(root)
  for (const id of ['source', 'lambda-0', 'tm-0']) host(id)
})

describe('renderLayout', () => {
  it('mounts every leaf host in tree order', () => {
    renderLayout(root, defaultLayout(), hosts, () => {})
    const mounted = [...root.querySelectorAll('[data-leaf]')].map((e) => (e as HTMLElement).dataset.leaf)
    expect(mounted).toEqual(['source', 'lambda-0', 'tm-0'])
  })

  it('mounts the same host element rather than a copy, so pane state survives a re-render', () => {
    renderLayout(root, defaultLayout(), hosts, () => {})
    const first = root.querySelector('[data-leaf="lambda-0"]')
    renderLayout(root, defaultLayout(), hosts, () => {})
    expect(root.querySelector('[data-leaf="lambda-0"]')).toBe(first)
  })

  it('puts one divider between each pair of siblings', () => {
    renderLayout(root, defaultLayout(), hosts, () => {})
    // column[ row[source, lambda], tm ] -> one divider inside the row, one in the column.
    expect(root.querySelectorAll('[role="separator"]').length).toBe(2)
  })

  it('gives every divider the separator semantics a keyboard user needs', () => {
    renderLayout(root, defaultLayout(), hosts, () => {})
    for (const d of root.querySelectorAll('[role="separator"]')) {
      expect(d.getAttribute('aria-orientation')).toMatch(/^(horizontal|vertical)$/)
      expect(d.getAttribute('aria-valuenow')).not.toBeNull()
      expect(d.getAttribute('aria-valuemin')).not.toBeNull()
      expect(d.getAttribute('aria-valuemax')).not.toBeNull()
      expect((d as HTMLElement).tabIndex).toBe(0)
    }
  })

  it('reports a resize when a divider is dragged', () => {
    const calls: { path: number[]; index: number; delta: number }[] = []
    renderLayout(root, defaultLayout(), hosts, (path, index, delta) => calls.push({ path, index, delta }))
    const divider = root.querySelector('[role="separator"][aria-orientation="vertical"]') as HTMLElement

    divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 400, clientY: 300, pointerId: 1 }))
    divider.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 480, clientY: 300, pointerId: 1 }))
    divider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 480, clientY: 300, pointerId: 1 }))

    expect(calls.length).toBeGreaterThan(0)
    expect(calls[calls.length - 1]?.delta).toBeGreaterThan(0)
  })

  it('reports a resize from the arrow keys, so the layout is not mouse-only', () => {
    const calls: { path: number[]; index: number; delta: number }[] = []
    renderLayout(root, defaultLayout(), hosts, (path, index, delta) => calls.push({ path, index, delta }))
    const divider = root.querySelector('[role="separator"][aria-orientation="vertical"]') as HTMLElement

    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(calls.at(-1)?.delta).toBeGreaterThan(0)

    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(calls.at(-1)?.delta).toBeLessThan(0)
  })

  it('addresses a nested divider by its path', () => {
    const calls: { path: number[]; index: number }[] = []
    renderLayout(root, defaultLayout(), hosts, (path, index) => calls.push({ path, index }))
    // The vertical divider is inside children[0]; the horizontal one is at the root.
    const vertical = root.querySelector('[role="separator"][aria-orientation="vertical"]') as HTMLElement
    const horizontal = root.querySelector('[role="separator"][aria-orientation="horizontal"]') as HTMLElement

    vertical.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(calls.at(-1)?.path).toEqual([0])

    horizontal.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(calls.at(-1)?.path).toEqual([])
  })

  it('renders a single leaf with no divider at all', () => {
    const solo: LayoutNode = { kind: 'leaf', id: 'tm-0', pane: 'tm' }
    renderLayout(root, solo, hosts, () => {})
    expect(root.querySelectorAll('[role="separator"]').length).toBe(0)
    expect(root.querySelector('[data-leaf="tm-0"]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm exec vitest run --project browser tests/browser/layout-view.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../src/layout-view'`.

- [ ] **Step 3: Write the implementation**

Create `web/src/layout-view.ts`:

```ts
import type { Dir, LayoutNode } from './layout'
import { MIN_PANE_FRACTION } from './layout'
import type { LeafId } from './panes'

/** How far one arrow-key press moves a divider, as a fraction of its split. */
const KEY_STEP = 0.02

/**
 * THE TREE, AS DOM — nested flex containers with a divider between every pair of siblings.
 *
 * FLEX RATHER THAN GRID, and the reason is the divider. A grid would need its track list rewritten on
 * every resize and the dividers placed in tracks of their own, so a two-pane split would be a
 * three-track grid whose middle track is not a pane. Flex lets a divider be a sibling with a fixed
 * basis and each pane a `flex-grow` equal to its fraction, which is one number per pane and no
 * bookkeeping about which track is which.
 *
 * HOSTS ARE MOVED, NEVER REBUILT. `renderLayout` appends the caller's existing elements, so a re-render
 * relocates a live pane — CodeMirror instance, scroll position and all — rather than replacing it.
 * That is what makes design §4.3's detach-not-destroy rule hold for free at this layer: nothing here
 * ever calls `remove()` on a host or creates one.
 *
 * DIVIDERS ARE KEYBOARD-OPERABLE, WHICH IS A DELIBERATE EXCEPTION TO PLAN 5's DEFERRED ACCESSIBILITY
 * PASS (design §6.2). A drag-only divider does not merely fail to announce itself — it makes the
 * entire layout unreachable without a pointer, which is a different class of gap from the
 * colour-carried states on that list.
 */
export function renderLayout(
  root: HTMLElement,
  tree: LayoutNode,
  hosts: Map<LeafId, HTMLElement>,
  onResize: (path: number[], index: number, delta: number) => void,
): void {
  // Detach children without destroying them — `replaceChildren()` with no arguments removes every
  // child, and the hosts we are about to re-append are held by the caller's map, so nothing is lost.
  root.replaceChildren()
  root.append(build(tree, [], hosts, onResize))
}

function build(
  node: LayoutNode,
  path: number[],
  hosts: Map<LeafId, HTMLElement>,
  onResize: (path: number[], index: number, delta: number) => void,
): HTMLElement {
  if (node.kind === 'leaf') {
    const host = hosts.get(node.id)
    if (host === undefined) throw new Error(`layout names a leaf with no host: ${node.id}`)
    host.style.flex = '1 1 0'
    host.style.minWidth = '0'
    host.style.minHeight = '0'
    return host
  }

  const box = document.createElement('div')
  box.className = 'layout-split'
  box.dataset.dir = node.dir
  box.style.display = 'flex'
  box.style.flexDirection = node.dir === 'row' ? 'row' : 'column'
  box.style.flex = '1 1 0'
  box.style.minWidth = '0'
  box.style.minHeight = '0'

  node.children.forEach((child, i) => {
    const el = build(child, [...path, i], hosts, onResize)
    el.style.flex = `${node.sizes[i] ?? 1 / node.children.length} 1 0`
    box.append(el)
    if (i < node.children.length - 1) {
      box.append(divider(box, node.dir, path, i, node.sizes[i] ?? 0, onResize))
    }
  })

  return box
}

/**
 * One divider: a real focusable `separator` that reports a FRACTION, never pixels.
 *
 * THE PIXEL-TO-FRACTION CONVERSION IS THE ONLY PIXEL IN THE LAYOUT, and it lives here rather than in
 * `layout.ts` so that model stays node-testable. The denominator is the split box's measured extent
 * along its own axis, read at pointerdown rather than cached, because a window resize between renders
 * would otherwise scale every drag by a stale number.
 */
function divider(
  box: HTMLElement,
  dir: Dir,
  path: number[],
  index: number,
  size: number,
  onResize: (path: number[], index: number, delta: number) => void,
): HTMLElement {
  const el = document.createElement('div')
  el.className = 'layout-divider'
  el.setAttribute('role', 'separator')
  // A `row` split stacks its children horizontally, so the divider between them is a VERTICAL line —
  // and `aria-orientation` on a separator names the separator's own orientation, not the flow's.
  el.setAttribute('aria-orientation', dir === 'row' ? 'vertical' : 'horizontal')
  el.setAttribute('aria-valuenow', String(Math.round(size * 100)))
  el.setAttribute('aria-valuemin', String(Math.round(MIN_PANE_FRACTION * 100)))
  el.setAttribute('aria-valuemax', String(Math.round((1 - MIN_PANE_FRACTION) * 100)))
  el.setAttribute('aria-label', dir === 'row' ? 'resize panes left and right' : 'resize panes up and down')
  el.tabIndex = 0

  const extent = () => (dir === 'row' ? box.getBoundingClientRect().width : box.getBoundingClientRect().height)

  let dragging = false
  let last = 0

  el.addEventListener('pointerdown', (e) => {
    dragging = true
    last = dir === 'row' ? e.clientX : e.clientY
    el.setPointerCapture(e.pointerId)
    e.preventDefault()
  })

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const now = dir === 'row' ? e.clientX : e.clientY
    const span = extent()
    if (span > 0) onResize(path, index, (now - last) / span)
    last = now
  })

  const stop = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  }
  el.addEventListener('pointerup', stop)
  el.addEventListener('pointercancel', stop)

  // THE KEYBOARD PATH — design §6.2's first exception. `Home`/`End` are deliberately absent: they
  // would mean "collapse this pane to its floor", which is a thing the close control already says
  // better and unambiguously.
  el.addEventListener('keydown', (e) => {
    const forward = dir === 'row' ? 'ArrowRight' : 'ArrowDown'
    const back = dir === 'row' ? 'ArrowLeft' : 'ArrowUp'
    if (e.key === forward) onResize(path, index, KEY_STEP)
    else if (e.key === back) onResize(path, index, -KEY_STEP)
    else return
    e.preventDefault()
  })

  return el
}
```

- [ ] **Step 4: Add the divider styles**

Append to `web/src/style.css`:

```css
/* The layout tree's containers and dividers.

   `main` STOPS BEING A GRID HERE. `style.css:209-211`'s two-column grid and `.pane.wide`'s
   `grid-column: 1 / -1` described a fixed four-section arrangement; the tree supplies its own nested
   flex boxes and sizes every pane with `flex-grow`, so a grid on the container would fight it. The
   default tree reproduces the old arrangement exactly, so nothing about the shipped layout changes.

   `align-items: stretch` IS NOT REDUNDANT, AND OMITTING IT SHIPPED A BROKEN LAYOUT ONCE. Two rules
   with the SAME selector do not replace one another — their declarations MERGE property by property.
   So the older `main { display: grid; … align-items: start }` keeps contributing everything this
   block does not explicitly override: `display` was overridden, `align-items: start` was not, and
   every `.layout-split` collapsed to 12px instead of filling its container. Eight passing tests could
   not see it, because none of them measured a real distance.

   AUDIT THE WHOLE OLD RULE, NOT JUST THE PROPERTY THAT HAPPENED TO BE MEASURED. Every declaration in
   the grid-era `main` block is still in force here unless named. Read it and override each one that
   affects flex layout, rather than fixing them one bug at a time. */
main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  align-items: stretch;
}

.layout-divider {
  flex: 0 0 var(--divider-size, 4px);
  background: var(--rule);
  /* `background-clip` plus a transparent border gives a 4px visual line with a 12px hit target,
     which is the difference between a divider you can grab and one you chase. */
  border: 4px solid transparent;
  background-clip: content-box;
  box-sizing: content-box;
}

.layout-split[data-dir='row'] > .layout-divider {
  cursor: col-resize;
}

.layout-split[data-dir='column'] > .layout-divider {
  cursor: row-resize;
}

/* THE ONLY FOCUS-VISIBLE RULE IN THE STYLESHEET, and it is here rather than as part of the deferred
   accessibility pass because a divider that takes focus with no ring is a control a keyboard user
   cannot locate — item 5 of that list is about rings nobody specified, and this would be a ring
   nobody could have. */
.layout-divider:focus-visible {
  outline: 2px solid var(--fg);
  outline-offset: -2px;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm exec vitest run --project browser tests/browser/layout-view.test.ts 2>&1 | tail -10
```

Expected: 8 passed.

- [ ] **Step 6: Verify the tests can fail**

Two mutations, each run and reverted, both recorded in the task report:

1. Delete the `keydown` listener. Expect **"reports a resize from the arrow keys"** and **"addresses a nested divider by its path"** to fail.
2. In `build`, replace `return host` for a leaf with `return host.cloneNode(true) as HTMLElement`. Expect **"mounts the same host element rather than a copy"** to fail — this is the test standing behind §4.3's detach-not-destroy rule at this layer, so it must be shown capable of catching a rebuild.

- [ ] **Step 7: Commit**

```bash
git add web/src/layout-view.ts web/src/style.css web/tests/browser/layout-view.test.ts
git commit -m "$(cat <<'EOF'
layout-view: the tree as nested flex, with dividers that take a keyboard

Flex rather than grid because of the divider: a grid needs its track list
rewritten on every resize with the dividers in tracks of their own, so a
two-pane split becomes a three-track grid whose middle track is not a pane.
Flex makes a divider a sibling and a pane's size one flex-grow number.

Hosts are moved, never rebuilt — nothing here calls remove() on a host or
creates one — so design 4.3's detach-not-destroy rule holds at this layer for
free, and the test that pins it is verified against a cloneNode mutation.

Dividers are keyboard-operable and carry a focus ring. Both are deliberate
exceptions to the deferred a11y pass (design 6.2): a drag-only divider makes
the whole layout unreachable without a pointer, and a focusable control with no
ring cannot be located at all. That is inoperability, not unannounced
semantics.

`main` stops being a grid; the default tree reproduces the shipped arrangement.
EOF
)"
```

---

### Task 11: Pane chrome — split, close, and focus after close

**Files:**
- Modify: `web/src/pane-chrome.ts`, `web/src/lambda-pane.ts`, `web/src/tm-pane.ts`, `web/src/style.css`
- Test: `web/tests/browser/pane-layout-controls.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 8–10 directly — this task only emits events.
- Produces: three new optional members on `PaneEvents`:
  ```ts
  splitRow?: () => void
  splitColumn?: () => void
  close?: () => void
  ```
  and `export function layoutControls(parent: HTMLElement, on: PaneEvents): { update(canClose: boolean, canSplit: boolean): void }`

- [ ] **Step 1: Write the failing test**

Create `web/tests/browser/pane-layout-controls.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { layoutControls } from '../../src/pane-chrome'
import type { PaneEvents } from '../../src/pane-chrome'

/**
 * THE LAYOUT CONTROLS, AND THE ABSENCES THAT ARE THE DESIGN.
 *
 * Both "cannot" cases are asserted as REMOVAL rather than as `disabled`, per the accessibility list's
 * item 1 — a control that provably cannot work should not be offered. The source pane has no split
 * because there is one editor to duplicate; the last leaf has no close because an empty tree has no
 * rendering.
 */

const noop = () => {}
const events = (over: Partial<PaneEvents> = {}): PaneEvents => ({
  back: noop,
  forward: noop,
  play: noop,
  restart: noop,
  extend: noop,
  rebind: noop,
  ...over,
})

let parent: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  parent = document.createElement('div')
  document.body.append(parent)
})

const buttons = () => [...parent.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))

describe('layoutControls', () => {
  it('offers split and close when both are possible', () => {
    layoutControls(parent, events()).update(true, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom', 'close this pane'])
  })

  it('REMOVES the split controls rather than disabling them when splitting is impossible', () => {
    layoutControls(parent, events()).update(true, false)
    expect(buttons()).toEqual(['close this pane'])
    expect(parent.querySelectorAll('button[disabled]').length).toBe(0)
  })

  it('REMOVES the close control rather than disabling it when this is the last leaf', () => {
    layoutControls(parent, events()).update(false, true)
    expect(buttons()).toEqual(['split left and right', 'split top and bottom'])
    expect(parent.querySelectorAll('button[disabled]').length).toBe(0)
  })

  it('reports each gesture exactly once per click', () => {
    const seen: string[] = []
    const c = layoutControls(
      parent,
      events({
        splitRow: () => seen.push('row'),
        splitColumn: () => seen.push('column'),
        close: () => seen.push('close'),
      }),
    )
    c.update(true, true)
    for (const b of parent.querySelectorAll('button')) (b as HTMLButtonElement).click()
    expect(seen).toEqual(['row', 'column', 'close'])
  })

  it('does not rewire its handlers when update is called again', () => {
    const seen: string[] = []
    const c = layoutControls(parent, events({ close: () => seen.push('close') }))
    c.update(true, true)
    c.update(true, true)
    c.update(true, true)
    const close = parent.querySelector('button[aria-label="close this pane"]') as HTMLButtonElement
    close.click()
    expect(seen).toEqual(['close'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm exec vitest run --project browser tests/browser/pane-layout-controls.test.ts 2>&1 | tail -20
```

Expected: FAIL — `layoutControls is not a function`.

- [ ] **Step 3: Extend `PaneEvents` and add `layoutControls`**

In `web/src/pane-chrome.ts`, add to `PaneEvents`:

```ts
  /**
   * This pane's split and close gestures — 5d-ii-a.
   *
   * OPTIONAL, LIKE `detach` AND UNLIKE `rebind`, and the same test applies: a pane has these handlers
   * when it has the affordance. A pane rendered outside a layout tree — which is every pane in
   * `binding-selector.test.ts` and in `tests/node/sessions.test.ts` — has no tree to split.
   *
   * THEY CARRY NOTHING. A pane knows it was asked to split; it does not know its own `LeafId`, its
   * path in the tree, or whether it is the last leaf. `main.ts` holds the tree and answers all three,
   * which keeps the pane classes free of the layout entirely — the same division `rebind` already
   * makes by taking a `SessionId` and not a binding.
   */
  splitRow?: () => void
  splitColumn?: () => void
  close?: () => void
```

Then add the control factory:

```ts
/**
 * The split and close controls on a pane's chrome — 5d-ii-a.
 *
 * BUILT ONCE, ADDED AND REMOVED, NEVER DISABLED — the idiom `detachedBadge` and `detachButton` already
 * state, and here it carries the design's two absences. The source pane offers no split because there
 * is one editor to duplicate into, and the last remaining leaf offers no close because an empty tree
 * has no honest rendering. Both are the accessibility list's item 1: a control that provably cannot
 * work should not be offered, which is why neither is a greyed button.
 *
 * HANDLERS ARE WIRED IN THE CONSTRUCTOR AND NEVER REWIRED, because `update` is on the per-frame path —
 * `draw()` repaints every pane on every recorded frame — and re-adding a listener sixty times a second
 * is how one click becomes sixty.
 */
export function layoutControls(
  parent: HTMLElement,
  on: PaneEvents,
): { update(canClose: boolean, canSplit: boolean): void } {
  const mk = (label: string, glyph: string, handler?: () => void) => {
    const b = button(glyph, label, () => handler?.())
    b.setAttribute('aria-label', label)
    b.className = 'layout-control'
    return b
  }

  const splitRow = mk('split left and right', '⇥', on.splitRow)
  const splitColumn = mk('split top and bottom', '⤓', on.splitColumn)
  const close = mk('close this pane', '×', on.close)

  let shownClose = false
  let shownSplit = false

  return {
    update(canClose: boolean, canSplit: boolean) {
      if (canSplit !== shownSplit) {
        shownSplit = canSplit
        if (canSplit) parent.append(splitRow, splitColumn)
        else {
          splitRow.remove()
          splitColumn.remove()
        }
      }
      if (canClose !== shownClose) {
        shownClose = canClose
        if (canClose) parent.append(close)
        else close.remove()
      }
      // ORDER IS RESTORED ON EVERY CALL, BECAUSE `append` MOVES RATHER THAN COPIES. Re-adding the
      // splits while `close` is already mounted puts them AFTER it, so a pane whose split-eligibility
      // toggles ends up with its controls in the wrong order. Re-appending `close` last is the whole
      // fix; it is a no-op when `close` is absent.
      if (shownClose) parent.append(close)
    },
  }
}
```

**THE ORDERING LINE ABOVE IS LOAD-BEARING AND THE FIRST DRAFT OF THIS PLAN OMITTED IT**, which produced a Critical finding. `update(true, true)` must yield split-row, split-column, close in that DOM order, and `append` moving an existing node means a `canSplit` toggle silently reorders them.

**THE TESTS IN STEP 1 ARE NOT SUFFICIENT AND MUST BE EXTENDED — this is the more important correction.** Every test there constructs a FRESH instance and makes ONE transition from its default state. `shownSplit` and `shownClose` both start `false`, so a test asserting "the split controls are absent" passes because they were **never added** — the `.remove()` branch never executes. Measured: deleting both `.remove()` calls left all five tests green. Add, and verify each by mutation:

1. **A toggle-order test** — `update(true,true)` → `update(true,false)` → `update(true,true)`, asserting the full order. Reverting the re-append line must turn it red.
2. **Removal-after-showing tests** — `update(true,true)` THEN `update(true,false)`, and separately THEN `update(false,true)`, asserting the controls are gone having first been present. Deleting both `.remove()` calls must turn these red while the original five stay green; that contrast is the proof.
3. **Pane-level tests** — construct a real `LambdaPane` and a real `TmPane`, call `setLayoutControls` on each, and assert the controls appear in THAT pane's own DOM. Without these, both new public methods have zero call sites. Follow `tests/browser/binding-selector.test.ts` for how this codebase builds a real pane in a test.

**Before running any mutation, confirm the mutated line is reachable by the test you expect to fail.** This task's original mutation — swapping `remove()` for `disabled = true` — edited a line the pinned test never executes, and therefore proved nothing.

- [ ] **Step 4: Mount the controls on both panes**

In `lambda-pane.ts` and `tm-pane.ts`, construct `layoutControls(this.#strip.el, on)` beside the existing chrome and expose:

```ts
  /**
   * Which layout gestures this pane currently offers.
   *
   * DRIVEN FROM `main.ts`'s DRAW PASS, not from the pane, because both answers are facts about the
   * TREE — whether this is the last leaf, and whether this pane's kind may be duplicated — and the
   * pane holds neither. Same division as `setBindings`, which takes the options rather than computing
   * them.
   */
  setLayoutControls(canClose: boolean, canSplit: boolean): void {
    this.#layout.update(canClose, canSplit)
  }
```

Add `setLayoutControls` to `PaneView<T>` in `sessions.ts` — **and update the two existing fakes** in `tests/node/sessions.test.ts` and `tests/node/panes.test.ts` to satisfy it. That is a setup edit under the wave rule, not an assertion change; name it in the commit.

- [ ] **Step 5: Add the control styles**

Append to `web/src/style.css`:

```css
/* Same treatment as `.controls button` — chrome, not a new visual language. */
.layout-control {
  font: inherit;
  font-family: var(--font-mono);
  padding: 0.1em 0.45em;
  border-radius: var(--radius);
  border: 1px solid var(--fg-dim);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm exec vitest run --project browser tests/browser/pane-layout-controls.test.ts 2>&1 | tail -10 && pnpm test 2>&1 | tail -5
```

Expected: 5 passed in the new file; the whole suite green.

- [ ] **Step 7: Verify the absences can fail**

Change `update` so `canSplit === false` sets `splitRow.disabled = true` instead of removing the buttons. Re-run and confirm **"REMOVES the split controls rather than disabling them"** fails. Restore, record the message.

That test is the only thing standing behind item 1's principle in this slice, and a test for an absence is exactly the kind that passes vacuously.

- [ ] **Step 8: Commit**

```bash
git add web/src/pane-chrome.ts web/src/lambda-pane.ts web/src/tm-pane.ts web/src/sessions.ts web/src/style.css web/tests/
git commit -m "$(cat <<'EOF'
pane-chrome: split and close, and the two absences that are the design

The source pane offers no split because there is one editor to duplicate into,
and the last leaf offers no close because an empty tree has no rendering. Both
are removals rather than disabled buttons — the accessibility list's item 1,
which is also why detachedBadge and detachButton already work this way.

The handlers carry nothing. A pane knows it was asked to split; it does not
know its LeafId, its path, or whether it is the last leaf. main.ts holds the
tree and answers all three, which is the same division rebind already makes by
taking a SessionId rather than a binding.

Handlers are wired once and never rewired: update is on the per-frame path, and
re-adding a listener sixty times a second is how one click becomes sixty.

test edits: setup only — two PaneView fakes gain setLayoutControls.

Absence verified capable of failing: switching removal to `disabled` turns the
removal test red.
EOF
)"
```

---

### Task 12: Wire the tree into `main.ts`

**Files:**
- Modify: `web/src/main.ts`, `web/index.html`, `web/src/replies.ts`, `web/src/draw.ts`
- Test: `web/tests/browser/layout-app.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–11.
- Produces: the app holds `let tree: LayoutNode`, a `Map<LeafId, HTMLElement>` of hosts, and `applyLayout()` which reconciles panes to leaves, re-renders, and persists.

- [ ] **Step 1: Write the failing test**

Create `web/tests/browser/layout-app.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { ready } from '../../src/main'

/**
 * THE TREE, DRIVEN THROUGH THE APP — the state `main()` could not reach before this slice.
 *
 * `sessions.ts:180-184` recorded the gap in as many words: "the app has ONE λ pane, so two panes on
 * two λ sessions is still unperformable through it", which is why `binding-selector.test.ts` builds
 * its panes by hand. This file is what closes that, and the two-terms assertion below is the reason
 * the slice is sequenced first.
 */

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)
const panes = () => [...document.querySelectorAll('[data-leaf]')].map((e) => (e as HTMLElement).dataset.leaf)
const splitRowOn = (leaf: string) =>
  document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button[aria-label="split left and right"]`)

beforeEach(async () => {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
  await ready
})

describe('the layout tree in the app', () => {
  it('starts in the arrangement index.html used to ship', () => {
    expect(panes()).toEqual(['source', 'lambda-0', 'tm-0'])
    expect($('#results')).not.toBeNull()
  })

  it('keeps the results pane outside the tree', () => {
    expect($('#results')?.closest('[data-leaf]')).toBeNull()
  })

  it('splitting a λ pane produces a second λ pane', () => {
    splitRowOn('lambda-0')?.click()
    expect(panes().filter((p) => p?.startsWith('lambda')).length).toBe(2)
  })

  it('offers no split control on the source pane', () => {
    expect(splitRowOn('source')).toBeNull()
  })

  it('closing a pane moves focus to the pane that grew, rather than to the body', () => {
    splitRowOn('lambda-0')?.click()
    const second = panes().filter((p) => p?.startsWith('lambda'))[1]
    const close = document.querySelector<HTMLButtonElement>(`[data-leaf="${second}"] button[aria-label="close this pane"]`)
    close?.click()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.closest('[data-leaf]')).not.toBeNull()
  })

  it('persists the tree and restores it', () => {
    splitRowOn('lambda-0')?.click()
    const after = panes()
    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).not.toBeNull()
    // The stored value describes what is on screen — a reload is asserted in the round-trip unit
    // test; here the claim is that the write happened and matches.
    const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}')
    const ids: string[] = []
    const walk = (n: { kind: string; id?: string; children?: unknown[] }) => {
      if (n.kind === 'leaf' && n.id !== undefined) ids.push(n.id)
      for (const c of n.children ?? []) walk(c as never)
    }
    walk(stored.tree)
    expect(ids).toEqual(after)
  })

  // NO "FALLS BACK ON GARBAGE" TEST HERE, DELIBERATELY. `main()` runs once per page and cannot be
  // re-run with a different `localStorage`, so any in-page version of that test would have to call
  // `parseLayout` directly — which is Task 9's fourteen cases, restated in a file that cannot reach
  // the wiring it claims to cover. A test that re-asserts another tier's unit is a test that passes
  // for a reason unrelated to its name. The fallback expression itself
  // (`parseLayout(...) ?? defaultLayout()`) is one line and is reviewed, not tested.
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm exec vitest run --project browser tests/browser/layout-app.test.ts 2>&1 | tail -20
```

Expected: FAIL — no `[data-leaf]` elements exist.

- [ ] **Step 3: Strip the fixed sections from `index.html`**

Replace the `<main>` block with an empty container; the tree builds everything inside it, and `#results` moves out as a sibling:

```html
    <main></main>
    <section id="results" class="pane results"></section>
```

**`#source`, `#lambda` and `#tm` disappear from the HTML.** `main.ts` creates each host, so `main.ts:63-70`'s `querySelector` calls for them go too — but `#editor`, `#link-status`, `#results`, `#encoding` and `#appearance` stay, and their mount-point check stays with them.

- [ ] **Step 4: Build hosts and reconcile in `main.ts`**

```ts
/**
 * The host element for `id`, created on first request and kept forever after.
 *
 * KEPT RATHER THAN REBUILT, WHICH IS DESIGN §4.3's DETACH-NOT-DESTROY RULE AT THE APP LAYER. Program
 * text is not persisted anywhere, so a host rebuilt on close would take the CodeMirror instance —
 * and the user's program — with it. `renderLayout` only ever appends, so a host that leaves the tree
 * is simply not appended and its live view waits in this map.
 */
const hosts = new Map<LeafId, HTMLElement>()
const hostFor = (id: LeafId, kind: PaneKind): HTMLElement => {
  const existing = hosts.get(id)
  if (existing !== undefined) return existing
  const el = document.createElement('section')
  el.className = 'pane'
  el.dataset.leaf = id
  el.dataset.kind = kind
  hosts.set(id, el)
  return el
}

let tree: LayoutNode = parseLayout(readLayoutStorage()) ?? defaultLayout()

/**
 * Reconcile panes to leaves, re-render the tree, and persist it.
 *
 * PANES ARE CREATED AND REMOVED HERE AND NOWHERE ELSE, so "which panes exist" has exactly one answer
 * and it is derived from the tree rather than tracked alongside it.
 *
 * IT DOES NOT DESTROY A REMOVED PANE'S HOST — see `hostFor`. A closed pane's element leaves the DOM
 * and its entry leaves the collection; the element itself, and any CodeMirror instance inside it,
 * stays in `hosts` and is remounted intact if the leaf returns.
 */
const applyLayout = (): void => {
  const live = new Set(leaves(tree).map((l) => l.id))
  for (const p of panes.all()) if (!live.has(p.id)) panes.remove(p.id)

  for (const l of leaves(tree)) {
    if (panes.get(l.id) !== undefined) continue
    if (l.pane === 'source') continue // the source pane is chrome inside its host, not a PaneView
    const host = hostFor(l.id, l.pane)
    if (l.pane === 'lambda') {
      const slot = new PaneSlot('lambda', SOURCE_SESSION)
      panes.add({ id: l.id, kind: 'lambda', slot, pane: new LambdaPane(host, paneEvents(l.id, slot)), host })
    } else {
      const slot = new PaneSlot('tm', SOURCE_SESSION)
      panes.add({ id: l.id, kind: 'tm', slot, pane: new TmPane(host, paneEvents(l.id, slot)), host })
    }
  }

  for (const l of leaves(tree)) hostFor(l.id, l.pane)
  renderLayout(root, tree, hosts, (path, index, delta) => {
    tree = resize(tree, path, index, delta)
    applyLayout()
  })
  writeLayoutStorage(serializeLayout(tree))
  draw()
}
```

`paneEvents(id, slot)` is `transport.events(slot)` plus the three layout handlers:

```ts
/**
 * A pane's events, including the layout gestures the pane itself cannot answer.
 *
 * THE LEAF ID IS CLOSED OVER HERE RATHER THAN PASSED THROUGH THE PANE, which is why `PaneEvents`'s
 * three new members take no arguments. A pane does not know its place in the tree and does not need
 * to; this closure is the one place that pairs a pane with its leaf.
 */
const paneEvents = <K extends Leg>(id: LeafId, slot: PaneSlot<K>): PaneEvents => ({
  ...transport.events(slot),
  splitRow: () => {
    tree = splitLeaf(tree, id, 'row', nextLeafId(slot.binding.leg))
    applyLayout()
  },
  splitColumn: () => {
    tree = splitLeaf(tree, id, 'column', nextLeafId(slot.binding.leg))
    applyLayout()
  },
  close: () => {
    const grew = neighbourOf(tree, id)
    tree = closeLeaf(tree, id)
    applyLayout()
    focusPane(grew)
  },
})
```

`nextLeafId(leg)` returns `` `${leg}-${counter++}` `` from a module-level counter. `neighbourOf(tree, id)` returns the `LeafId` of the sibling that will absorb the closed pane's space — the previous leaf in `leaves(tree)` order, or the next if the closed one was first.

**`focusPane` is design §6.2's second exception and must not be dropped:**

```ts
/**
 * Move focus into `id`'s pane after a close.
 *
 * THE ACCESSIBILITY LIST'S ITEM 1, AGGRAVATED PAST EVERYTHING ON IT AND THEREFORE FIXED HERE RATHER
 * THAN FILED. That item's measured instance is `tm-pane.ts`'s reattach, which strands focus on
 * `<body>` after a click; `[continue]` shares the idiom but survives its own click in the common case
 * because `controls.ts` keeps the button when a run hits `budget` again. A close control removes the
 * clicked element UNCONDITIONALLY, every time, so leaving this would add the list's worst instance in
 * the same slice that writes the list.
 *
 * IT TARGETS THE PANE THAT GREW, NOT THE FIRST FOCUSABLE THING ON THE PAGE. The space the closed pane
 * occupied is now that pane's, so it is where the user is looking.
 */
const focusPane = (id: LeafId | null): void => {
  if (id === null) return
  const host = hosts.get(id)
  const target = host?.querySelector<HTMLElement>('button, select, [tabindex]')
  target?.focus()
}
```

- [ ] **Step 5: Drive the layout controls from the draw pass**

In `draw.ts`, inside the per-pane loop:

```ts
p.pane.setLayoutControls(leafCount > 1, p.kind !== 'source')
```

`leafCount` comes in as a dep — `leaves: () => number` — because `draw.ts` must not import `layout.ts` and hold a second opinion about the tree.

- [ ] **Step 6: Add the `restore default layout` control**

In `index.html`'s header, beside `#appearance`:

```html
      <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
```

In `main.ts`:

```ts
restoreLayoutButton.addEventListener('click', () => {
  tree = defaultLayout()
  applyLayout()
})
```

**It does not clear `hosts`.** A source pane closed and then restored comes back with its editor and its text, which is the whole reason `hostFor` memoizes.

- [ ] **Step 7: Run the tests**

```bash
pnpm exec vitest run --project browser tests/browser/layout-app.test.ts 2>&1 | tail -10 && pnpm test 2>&1 | tail -5
```

Expected: 6 passed in the new file; the whole suite green.

**Existing browser tests will need import and setup edits** — anything that did `document.querySelector('#lambda')` now wants `[data-leaf="lambda-0"]`. That is a setup edit under the wave rule. **If any test's assertion changes, stop**: it means the reconciliation changed behaviour rather than the selector.

- [ ] **Step 8: Verify focus-after-close can fail**

Delete the `focusPane(grew)` call, re-run, and confirm **"closing a pane moves focus to the pane that grew"** fails with `document.activeElement` being `<body>`. Restore and record the message — this reproduces the exact measurement the accessibility list's item 1 reports.

- [ ] **Step 9: Commit**

```bash
git add web/src/main.ts web/index.html web/src/draw.ts web/src/replies.ts web/tests/
git commit -m "$(cat <<'EOF'
main: the tree drives the panes, and index.html stops declaring them

#source, #lambda and #tm are gone from the HTML; applyLayout derives which
panes exist from the leaves and is the only place that creates or removes one,
so "which panes exist" has one answer instead of two that can disagree.

hostFor memoizes, and that IS design 4.3's detach-not-destroy rule at the app
layer: program text is not persisted anywhere, so a host rebuilt on close would
take the CodeMirror instance and the user's program with it. renderLayout only
appends, so a host that leaves the tree waits in the map with its view alive.

focusPane is the a11y list's item 1 fixed rather than filed. Its measured
instance strands focus on <body> after a click; [continue] shares the idiom but
survives its own click in the common case. A close control removes the clicked
element unconditionally, every time, so this would have been the list's worst
instance written in the same slice as the list. Verified capable of failing:
deleting the call reproduces activeElement === body exactly.

test edits: setup only — #lambda becomes [data-leaf="lambda-0"] and friends.
EOF
)"
```

---

### Task 13: The headline tests — two λ sessions, the moving editor, the surviving program

**Files:**
- Create: `web/tests/browser/two-lambda-panes.test.ts`
- Modify: `web/src/main.ts` (the editor-moves rule), `web/src/replies.ts`
- Test: as above

**Interfaces:**
- Consumes: everything.
- Produces: `setEditor` is driven by a per-scratch owner rather than by a single pane const.

- [ ] **Step 1: Write the failing test**

Create `web/tests/browser/two-lambda-panes.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { ready } from '../../src/main'

/**
 * TWO λ PANES ON TWO λ SESSIONS, THROUGH THE APP — the claim 5d-i could assert only with
 * hand-built panes.
 *
 * `sessions.ts:180-184` and `binding-selector.test.ts`'s own header both record why that was: "this
 * app has ONE λ pane, so two panes side by side on two λ sessions is still not a state `main()` can
 * reach". Neither file is wrong and neither is superseded — they assert the resolution and the
 * rendering. This one asserts that a user can GET there, which is the property the layout tree adds
 * and the reason 5d-ii-a is sequenced ahead of the multiplexer.
 */

const leafIds = () => [...document.querySelectorAll('[data-leaf]')].map((e) => (e as HTMLElement).dataset.leaf ?? '')
const lambdaLeaves = () => leafIds().filter((id) => id.startsWith('lambda'))
const textOf = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .term`)?.textContent ?? ''
const btn = (leaf: string, label: string) =>
  document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button[aria-label="${label}"]`)
const selectOf = (leaf: string) => document.querySelector<HTMLSelectElement>(`[data-leaf="${leaf}"] .pane-binding select`)

const until = async (p: () => boolean, ms = 5000) => {
  const start = performance.now()
  while (!p()) {
    if (performance.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

beforeEach(async () => {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
  await ready
})

describe('two λ panes on two λ sessions', () => {
  it('renders two different terms at the same time, reached entirely through the UI', async () => {
    // 1. Fork the source-derived λ pane into a scratch — 5d-iii's existing control.
    const fork = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button[aria-label*="fork"]')
    fork?.click()
    await until(() => document.querySelectorAll('[data-leaf="lambda-0"] .term-editor').length > 0)

    // 2. Split it — the control this slice adds.
    btn('lambda-0', 'split left and right')?.click()
    await until(() => lambdaLeaves().length === 2)
    const [first, second] = lambdaLeaves()

    // 3. Point the new pane back at the source session — 5d-i's selector.
    const sel = selectOf(second ?? '')
    if (sel === null || sel === undefined) throw new Error('the split pane has no binding selector')
    sel.value = 'source'
    sel.dispatchEvent(new Event('change', { bubbles: true }))

    // 4. Edit the scratch so the two sessions genuinely differ.
    const editor = document.querySelector<HTMLElement>(`[data-leaf="${first}"] .cm-content`)
    if (editor === null) throw new Error('the forked pane has no editor')
    editor.focus()
    editor.textContent = 'λf.λx. f x'
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }))

    await until(() => textOf(first ?? '') !== textOf(second ?? '') && textOf(second ?? '') !== '')

    expect(textOf(first ?? '')).not.toBe(textOf(second ?? ''))
    expect(textOf(first ?? '')).not.toBe('')
    expect(textOf(second ?? '')).not.toBe('')
  })

  it('moves the one editor rather than mounting a second', async () => {
    const fork = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button[aria-label*="fork"]')
    fork?.click()
    await until(() => document.querySelectorAll('.cm-editor').length > 1)

    btn('lambda-0', 'split left and right')?.click()
    await until(() => lambdaLeaves().length === 2)
    const [first, second] = lambdaLeaves()

    // Both panes are on the scratch; only one holds the editor.
    const editorsIn = (leaf: string) => document.querySelectorAll(`[data-leaf="${leaf}"] .cm-editor`).length
    expect(editorsIn(first ?? '')).toBe(1)
    expect(editorsIn(second ?? '')).toBe(0)

    // Asking the other pane for it MOVES it.
    btn(second ?? '', 'show the term editor')?.click()
    await until(() => editorsIn(second ?? '') === 1)
    expect(editorsIn(first ?? '')).toBe(0)
    expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(1)
  })

  it('keeps the program when the source pane is closed and restored', async () => {
    const cm = document.querySelector<HTMLElement>('[data-leaf="source"] .cm-content')
    if (cm === null) throw new Error('no source editor')
    const before = cm.textContent ?? ''
    expect(before.length).toBeGreaterThan(0)

    btn('source', 'close this pane')?.click()
    await until(() => !leafIds().includes('source'))

    document.querySelector<HTMLButtonElement>('#restore-layout')?.click()
    await until(() => leafIds().includes('source'))

    expect(document.querySelector('[data-leaf="source"] .cm-content')?.textContent).toBe(before)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm exec vitest run --project browser tests/browser/two-lambda-panes.test.ts 2>&1 | tail -20
```

Expected: FAIL — the split produces a second pane but the editor mounts on both, or `show the term editor` does not move it.

- [ ] **Step 3: Implement the editor-moves rule**

In `main.ts`, hold the owner per scratch session and mount there:

```ts
/**
 * Which pane currently holds each scratch session's editor — design §4.3.
 *
 * ONE `EditorView` PER SCRATCH, MOUNTED WHEREVER IT WAS LAST ASKED FOR. Not one instance per pane
 * with a policy keeping copies in step: two uncoordinated CodeMirror instances over one buffer
 * desynchronize between debounces and resolve last-write-wins at recompile, which is a control that
 * provably cannot work, offered anyway. Moving the live view makes that state unrepresentable rather
 * than policed, and cursor, selection and undo survive because nothing is destroyed.
 *
 * CLOSING THE HOLDER UNMOUNTS WITHOUT REASSIGNING. The scratch is a session and no pane's death
 * retires one; the next pane to ask re-mounts the same view. Relocating on close would put the editor
 * somewhere the user did not put it, which is the state design §4.2 refuses movement for.
 */
const editorOwner = new Map<SessionId, LeafId>()
```

`replies.ts`'s `scratch-compiled` case calls `setEditor` on `panes.get(editorOwner.get(session))` rather than on a const, and the `show the term editor` control sets `editorOwner` for that pane's session and calls `applyLayout()`.

- [ ] **Step 4: Run the tests**

```bash
pnpm exec vitest run --project browser tests/browser/two-lambda-panes.test.ts 2>&1 | tail -10 && pnpm test 2>&1 | tail -5
```

Expected: 3 passed in the new file; the whole suite green.

- [ ] **Step 5: Verify all three can fail**

Each mutation run and reverted, each message recorded:

1. In `paneEvents`, make `splitRow` a no-op. Expect **"renders two different terms"** to time out.
2. Make `show the term editor` mount a second editor instead of moving the view. Expect **"moves the one editor"** to fail on `document.querySelectorAll('.term-editor .cm-editor').length`.
3. In `hostFor`, always build a fresh element instead of memoizing. Expect **"keeps the program"** to fail.

Mutation 3 is the important one: it is the only test standing between this slice and silently deleting a user's program on a pane close.

- [ ] **Step 6: Commit**

```bash
git add web/src/main.ts web/src/replies.ts web/tests/browser/two-lambda-panes.test.ts
git commit -m "$(cat <<'EOF'
two λ panes on two λ sessions, reached entirely through the UI

The claim 5d-i could only assert with hand-built panes. sessions.ts:180-184 and
binding-selector.test.ts both record why: "this app has ONE λ pane, so two
panes side by side on two λ sessions is still not a state main() can reach".
Neither is superseded — they assert the resolution and the rendering; this
asserts that a user can get there.

The editor is one EditorView per scratch that MOVES. Two uncoordinated
CodeMirror instances over one buffer desynchronize between debounces and
resolve last-write-wins, so moving the live view makes that unrepresentable
rather than policed. Closing the holder unmounts without reassigning: the
scratch is a session, no pane's death retires one, and relocating on close puts
the editor somewhere nobody put it.

All three verified capable of failing. The one that matters: with hostFor
rebuilding instead of memoizing, "keeps the program" goes red — that test is
the only thing between a pane close and silently deleting the user's program.
EOF
)"
```

---

### Task 14: Coverage, the roadmap entry, and the PR

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Run the full suite with coverage**

```bash
pnpm test:coverage 2>&1 | tail -25
```

Expected: all four thresholds met — `lines 94, functions 93, branches 85, statements 92`. **`functions` is the one that will trip**; `vite.config.ts` computes that three new untested functions fail the build. If it fails, the missing functions are named in the report — write tests for them in this task rather than lowering a floor.

- [ ] **Step 2: Record the real numbers**

Write the four measured percentages and the test count into the task report. They go into the roadmap entry, and they must be this run's figures — 5d-iii's entry shipped stale counts and had to be corrected by its own reviewer (roadmap:5576-5583).

- [ ] **Step 3: Write the roadmap entry**

Add a `#### PLAN 5d-ii-a CLOSES` section to the Plan 5 log, after the 5d-iii entry. It must state:

- What shipped, in one paragraph, with the design and plan links.
- **The measured coverage and test count from Step 2.**
- **What this slice could not establish** — matching the two siblings' own sections:
  - Whether anyone can *work* in a split layout. Nobody has arranged panes for a real task; every claim is about DOM, geometry and counts.
  - Whether `MIN_PANE_FRACTION = 0.1` is usable. It is a choice, not a measurement, and `layout.ts` says so.
  - Whether the per-session/per-leg split in Task 7 is complete. **Record Task 7 Step 5's finding**: if the suite could not catch a `ofSession` → `of` substitution, say so plainly — it means thirty conversions rest on review.
- **The accessibility list updates** — add the four unannounced controls and the wholesale rebuild as new items, and record the two exceptions taken (keyboard dividers, focus-after-close) with their reasons, so a later reader sees they were decided rather than overlooked.
- **5d-ii-b and 5d-ii-c named with positions**, per the design's §6.1.

- [ ] **Step 4: Commit and open the PR**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "$(cat <<'EOF'
roadmap: 5d-ii-a closes, with the three things it could not establish

Coverage and test counts are this run's figures, not the ones written while the
branch was in flight — 5d-iii's entry shipped stale numbers and its own
reviewer had to correct them.

The a11y list gains four unannounced controls and one wholesale rebuild, and
records the two exceptions this slice took rather than deferred, so a later
reader sees they were decided.
EOF
)"

git push -u origin plan5d-ii-a
tea pr create --repo davey/redextape --title "5d-ii-a: the layout tree — panes become a structure, and two λ sessions become reachable"
```

- [ ] **Step 5: Verify CI**

Watch the run to green. Note that the `docker` job never runs on a PR, so any Dockerfile change would land untested — this branch touches none, so there is nothing to build locally.

---

## Self-Review

**Spec coverage.** Every section maps to a task: §4.1 model → Task 8; §4.2 split/close rules → Tasks 8 and 11; §4.3 editor-moves and detach-not-destroy → Tasks 12 and 13; §4.4 persistence and validation → Task 9; §4.5 three waves → Tasks 1–7 and 8–13; §5 testing → Tasks 6, 8–13; §6.1 naming -b and -c → Task 14; §6.2 a11y exceptions and additions → Tasks 10, 12, 14.

**Two spec items that needed a task and now have one:** the `restore default layout` control (§4.2) is Task 12 Step 6, and `focusPane` (§6.2) is Task 12 Step 4 with its failure verified in Step 8.

**Type consistency.** `LeafId` and `PaneKind` are defined in `panes.ts` (Task 6) and imported by `layout.ts` (Task 8) — not redefined. `LayoutNode` is the tree node everywhere; `PaneEntry<K>` the collection's element. `of` / `ofSession` keep those names in Tasks 6, 7 and 12. `setLayoutControls(canClose, canSplit)` has the same argument order in Tasks 11 and 12.

**One known gap, recorded rather than papered over.** Task 7 converts thirty call sites by hand and Step 5 exists to find out whether the suite can catch a per-session/per-leg mix-up. If it cannot, that is reported in Task 14's roadmap entry rather than left as an assumption that review caught everything.
