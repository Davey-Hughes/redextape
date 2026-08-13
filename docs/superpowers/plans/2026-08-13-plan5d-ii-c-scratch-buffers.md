# 5d-ii-c — N scratch buffers: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fork creates a new λ scratch buffer every time; buffers outlive the panes bound to them and survive a recompile; a header-bar list is where they are retired.

**Architecture:** `LambdaScratchpad` (one fixed id, a `has` branch that rebinds instead of creating) becomes `ScratchBuffers` (mints an id per fork, keyed operations, a `list()` for the header). The lifetime change is mostly *removal* — the recompile path stops retiring — and the new surface is one popover reusing the split picker's idiom.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), Vitest (node + browser projects), Playwright/Chromium, Biome, plain DOM — no framework.

**Design:** [`../specs/2026-08-13-plan5d-ii-c-scratch-buffers-design.md`](../specs/2026-08-13-plan5d-ii-c-scratch-buffers-design.md)

## Global Constraints

- **Nothing ends a buffer implicitly.** Not a pane close, not a recompile, not a worker error, not hitting the cap. Only an explicit retire. If a change appears to need an implicit end, the change is wrong — design decision 2.
- **`PaneSlot<K extends Leg>` is not widened; `Binding<K>.leg` gains no writer.** Unchanged from 5d-ii-b.
- **The pre-commit gate runs on every commit and must never be bypassed.** `scripts/check-text-bytes.sh` (all tracked text), `biome ci --error-on-warnings` (`^web/.*\.(js|ts|jsx|tsx|json|css)$`), `pnpm run typecheck` (`^web/.*\.(ts|tsx)$`). **Never `--no-verify`.**
- **One commit per task, after tests pass** — not two around a red test. A commit holding a test that references a not-yet-existing export fails `tsc --noEmit`. Run the red step; do not commit it.
- **No literal control bytes in source.** `pane-chrome.ts` encodes delimiters as `\x00` / `\x01` escapes and carries a comment explaining that literal bytes once made the whole file invisible to `rg`. Do not convert them, do not edit that comment.
- **Doc-comment convention `/** */`**; never `///` in `web/`.
- **Prefer count-free doc phrasings.** `pane-host.ts` states the rule: a doc that restates a count has to be re-read every time the count moves.
- **VERIFY EVERY `file:line` CITATION BEFORE YOU WRITE IT.** 5d-ii-b's closing sweep found **30 of 52 wrong**, and the design doc for THIS slice shipped its own citation-drift paragraph with drift in it. `grep` the target and read the range; a citation corrected to the wrong line is worse than a stale one, because it looks checked.
- **Grep all of `web/` — `src/` AND `tests/` — for dependants of anything you change.** Per-task file lists under-counted test dependants three times in 5d-ii-b: a caller of a changed function, tests asserting a changed *value format* (no grep for the function name reaches those), and a test exercising a deleted guard.
- **Of every assertion, ask: would this fail if the behaviour it names were removed?** Six vacuous assertions were caught in 5d-ii-b — one passed because a session's *label* made a substring check always true.
- **Test commands:** `cd web && pnpm test` · `pnpm test:node` · `pnpm test:browser` · `pnpm run typecheck`. One file: `cd web && pnpm exec vitest run --project node tests/node/scratch.test.ts` — **a bare `-- <name>` filter does not scope files**, so always name the path.
- **Coverage floors are 94/88/96/97.** Do not lower them. Task 9 re-measures.

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `web/src/scratch.ts` | modify | `LambdaScratchpad` → `ScratchBuffers`: `fork` mints, `retire(id,…)`, `list()`. |
| `web/src/sessions.ts` | modify | Doc rewrite: `SessionRegistry.add`'s duplicate-id throw no longer justified by the singleton call site. |
| `web/src/session-client.ts` | modify | Same, for `SessionPool.bind`. |
| `web/src/compile.ts` | modify | Recompile stops retiring. This is the lifetime change. |
| `web/src/replies.ts` | modify | `noSessionReply` keyed by buffer; a poisoned buffer survives. |
| `web/src/buffer-list.ts` | **create** | The header popover: rows, orphan marking, retire. |
| `web/src/main.ts` | modify | Wire the list; hold `ScratchBuffers`. |
| `web/index.html` | modify | The `[buffers]` button beside `reset layout`. |

---

## Task 1: `ScratchBuffers` — a fork mints, and the singleton's three docs are rewritten

**Files:**
- Modify: `web/src/scratch.ts`, `web/src/sessions.ts` (doc), `web/src/session-client.ts` (doc)
- Test: `web/tests/node/scratch.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BufferInfo = { readonly id: SessionId; readonly label: string }
  export class ScratchBuffers {
    fork(slot: Detachable, src: string, step: number): SessionId
    list(): readonly BufferInfo[]
  }
  ```
  `retire` and `noSessionReply` keep today's shape in this task; Task 2 re-keys them.

**The singleton is one branch — but removing it falsifies three docs.** `scratch.ts:136`'s `if (!this.#reg.has(this.#id))` is the rule. Its own doc justifies it by citing `SessionRegistry.add` and `SessionPool.bind`, **and both of those name this call site as their reason**. Locate all three by grepping for `singleton` across `web/src/`, verify each, and rewrite each in place — the throws stay correct as guards, but the reason they give for existing stops being true.

- [ ] **Step 1: Write the failing tests**

In `web/tests/node/scratch.test.ts`, reusing the file's existing registry/pool fixtures:

```ts
it('mints a new buffer per fork rather than rebinding to one', () => {
  const { buffers, pool, reg } = harness()
  const a = buffers.fork(slotA, 'x', 0)
  const b = buffers.fork(slotB, 'y', 0)
  expect(a).not.toBe(b)
  // THE SINGLETON WAS ASSERTED ON POOL SIZE (5d-i's plan required it); the assertion inverts
  // rather than disappearing.
  expect(pool.size).toBe(2)
  expect(reg.has(a)).toBe(true)
  expect(reg.has(b)).toBe(true)
})

it('seeds each buffer from its own fork rather than sharing the first seed', () => {
  // The old singleton deliberately did NOT re-seed on a second detach. With one buffer per fork
  // that rule has nothing to apply to, and each buffer must carry the text it was forked with.
  const { buffers, sent } = harness()
  buffers.fork(slotA, 'let a = 1; a', 0)
  buffers.fork(slotB, 'let b = 2; b', 3)
  expect(sent.map((m) => [m.src, m.step])).toEqual([
    ['let a = 1; a', 0],
    ['let b = 2; b', 3],
  ])
})

it('lists every live buffer with a distinct label', () => {
  const { buffers } = harness()
  buffers.fork(slotA, 'x', 0)
  buffers.fork(slotB, 'y', 0)
  const labels = buffers.list().map((b) => b.label)
  expect(new Set(labels).size).toBe(2)
  expect(labels).toEqual(['scratch 1', 'scratch 2'])
})
```

Read the file's existing fixtures first and reuse them; do not invent a parallel harness.

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && pnpm exec vitest run --project node tests/node/scratch.test.ts`
Expected: FAIL — `buffers.fork is not a function`.

- [ ] **Step 3: Implement**

Rename the class to `ScratchBuffers`. Replace `#id`/`#label` with a `Map<SessionId, BufferInfo>` and a counter. `fork` mints `scratch-${n}` / `"scratch ${n}"`, creates the session and pool entry unconditionally, rebinds the slot, and **returns the id**. Keep `scratch.ts`'s "REBINDING IS UNCONDITIONAL AND CREATION IS NOT" paragraph, rewritten: creation is now unconditional too, and that sentence's whole point moves.

- [ ] **Step 4: Rewrite the three docs**

`scratch.ts`'s own singleton paragraph, plus the two it cites. Each must state what is now true, not merely be edited. **This slice's design §3.1 predicts this exact hazard; do not be the fourth instance.**

- [ ] **Step 5: Fix call sites and run**

Run: `cd web && pnpm test:node && pnpm run typecheck`
Expected: PASS. `compile.ts` and `replies.ts` still call `retire`/`noSessionReply` with today's signature — that is Task 2's job.

- [ ] **Step 6: Commit**

```bash
git add web/src/scratch.ts web/src/sessions.ts web/src/session-client.ts web/tests/node/scratch.test.ts
git commit -m "scratch: a fork mints a buffer, and the three docs that argued for the singleton"
```

---

## Task 2: `retire(id, …)` and `list()` — keyed by buffer

**Files:**
- Modify: `web/src/scratch.ts`, `web/src/compile.ts`, `web/src/replies.ts`
- Test: `web/tests/node/scratch.test.ts`

**Interfaces:**
- Produces: `retire(id: SessionId, home: SessionId, slots: readonly Detachable[]): boolean`
- Consumes: `fork`, `list` (Task 1).

`retire` already terminates the worker and rebinds `slots` to `home`. It gains an id and stops assuming the singleton — behaviour a user sees is unchanged; what changes is what can trigger it.

- [ ] **Step 1: Write the failing tests**

```ts
it('retires one buffer and leaves its siblings running', () => {
  const { buffers, pool } = harness()
  const a = buffers.fork(slotA, 'x', 0)
  const b = buffers.fork(slotB, 'y', 0)
  expect(buffers.retire(a, SOURCE, [slotA, slotB])).toBe(true)
  expect(pool.size).toBe(1)
  expect(buffers.list().map((x) => x.id)).toEqual([b])
})

it('rebinds only the slots bound to the retired buffer', () => {
  const { buffers } = harness()
  const a = buffers.fork(slotA, 'x', 0)
  const b = buffers.fork(slotB, 'y', 0)
  buffers.retire(a, SOURCE, [slotA, slotB])
  expect(slotA.binding.session).toBe(SOURCE)
  expect(slotB.binding.session).toBe(b)   // untouched
})

it('returns false for a buffer that is not live', () => {
  const { buffers } = harness()
  expect(buffers.retire('scratch-9' as SessionId, SOURCE, [])).toBe(false)
})
```

The second test is the one that matters: a `retire` that rebound *every* slot would pass the first.

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && pnpm exec vitest run --project node tests/node/scratch.test.ts`
Expected: FAIL on arity.

- [ ] **Step 3: Implement, and update the two callers**

`compile.ts`'s recompile call and `replies.ts`'s `noSessionReply` both pass a buffer id now. **Do not change WHEN they fire in this task** — Task 3 changes the recompile behaviour and Task 4 the poison behaviour. Keeping the trigger and the key separate is what makes each reviewable.

- [ ] **Step 4: Run and commit**

Run: `cd web && pnpm test && pnpm run typecheck`

```bash
git add web/src/scratch.ts web/src/compile.ts web/src/replies.ts web/tests/node/scratch.test.ts
git commit -m "scratch: retire takes the buffer it retires"
```

---

## Task 3: A recompile stops ending buffers

**Files:**
- Modify: `web/src/compile.ts`
- Test: `web/tests/browser/scratch-buffers.test.ts` (create)

**This is the lifetime change, and it is mostly a deletion.** `compile.ts` currently calls `scratchpad.retire(sourceSession, panes.all().map((p) => p.slot))` on every successful recompile. That call goes.

**It removes a safety mechanism — design §3.4.** 5d-i made recompile the poison-recovery path, so a wedged scratch died on the next compile without the user knowing it was wedged. Nothing reclaims it now until Task 6's list exists. **Say so in the code comment where the call was**, so the gap is legible between this task and that one rather than invisible.

- [ ] **Step 1: Write the failing browser test**

Create `web/tests/browser/scratch-buffers.test.ts`, modelled on `tests/browser/scratch-fork.test.ts`'s harness — read it first and reuse its helpers and selectors.

```ts
it('keeps a buffer alive across a recompile of the source', async () => {
  const { view, src } = await mount()
  await forkInto('lambda-0', 'let a = 1; a')        // reuse the real helper name
  const before = bufferLabelOf('lambda-0')          // e.g. 'scratch 1'
  await recompileSource(view, src, 'let z = 9; z')
  await settled(view, src)
  // THE PANE IS STILL ON ITS BUFFER, and the buffer still renders its own term — not the source's.
  expect(bufferLabelOf('lambda-0')).toBe(before)
  expect(termTextOf('lambda-0')).toContain('let a = 1')
})
```

Assert on the **rendered term**, not on session count: a test that only counted sessions would pass against a buffer that survived but got re-seeded from source.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/scratch-buffers.test.ts`
Expected: FAIL — the pane rebinds to source on recompile.

- [ ] **Step 3: Remove the retire call**

Delete it, and rewrite the surrounding doc (`compile.ts:28` cites the call by name — verify that line before editing it). Record that poison recovery moves to the header list, and that between this task and Task 6 there is no reclamation path at all.

- [ ] **Step 4: Run and commit**

Run: `cd web && pnpm test && pnpm run typecheck`
Expect other browser tests to need updating — `scratch-fork.test.ts` and `scratch-rebind-editor.test.ts` both exercise the old recompile-retires behaviour. **Rewriting a test that this change breaks is the highest-risk artifact in the diff**; each rewrite must assert the new fact explicitly, and its doc must name what it used to claim.

```bash
git add web/src/compile.ts web/tests/browser
git commit -m "compile: a recompile no longer ends a buffer, and poison recovery has to move"
```

---

## Task 4: A poisoned buffer survives

**Files:**
- Modify: `web/src/replies.ts`
- Test: `web/tests/node/replies.test.ts`

`noSessionReply` currently retires the scratch when a build never succeeded. Under decision 2 the buffer survives and stays listed; the diagnostics still surface.

- [ ] **Step 1: Write the failing test**

```ts
it('keeps a buffer listed after a no-session reply rather than retiring it', () => {
  const { buffers, replies } = harness()
  const id = buffers.fork(slotA, 'bad', 0)
  replies.onScratchReply({ kind: 'no-session', session: id, diagnostics: ['boom'] })
  expect(buffers.list().map((b) => b.id)).toContain(id)
})
```

- [ ] **Step 2: Run, implement, run**

Run: `cd web && pnpm exec vitest run --project node tests/node/replies.test.ts`
Then remove the retire, keep the diagnostics path, and rerun.

- [ ] **Step 3: Commit**

```bash
git add web/src/replies.ts web/tests/node/replies.test.ts
git commit -m "replies: a buffer that failed to build is still a buffer"
```

---

## Task 5: `buffer-list.ts` — the header popover

**Files:**
- Create: `web/src/buffer-list.ts`
- Modify: `web/src/style.css`
- Test: `web/tests/browser/buffer-list.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export type BufferRow = { readonly id: SessionId; readonly label: string; readonly paneCount: number }
  export function bufferList(
    button: HTMLButtonElement,
    rows: () => readonly BufferRow[],
    onRetire: (id: SessionId) => void,
  ): { update(count: number): void }
  ```

**Reuse the split picker's idiom rather than inventing one** — read `pane-chrome.ts`'s `splitControl` first. Native `popover`, anchored to its own button by the implicit invoker anchor (no `anchor-name` needed), `aria-haspopup="menu"`, `aria-expanded` maintained on **both** toggle edges, `autofocus` on the first row (a `.focus()` inside `beforetoggle` is a silent no-op — the element is still `display: none`), and the rows built on `beforetoggle` rather than per frame.

No confirmation dialog — design §4.2. The row's pane count is the safeguard.

- [ ] **Step 1: Write the failing tests**

```ts
it('lists each buffer with its pane count, and marks an orphan', () => { /* … */ })
it('retires the row that was clicked, not the first', () => { /* … */ })
it('opens on the button and keeps aria-expanded true while open', () => { /* … */ })
it('moves focus into the list on open', () => { /* … */ })
```

The second is the discriminator: a handler wired to a captured first row would pass a one-row test.

- [ ] **Step 2-4: Run red, implement, run green, commit**

```bash
git add web/src/buffer-list.ts web/src/style.css web/tests/browser/buffer-list.test.ts
git commit -m "buffer-list: the one surface that can reach a buffer no pane is showing"
```

---

## Task 6: Wire the list, and poison recovery lands

**Files:**
- Modify: `web/src/main.ts`, `web/index.html`
- Test: `web/tests/browser/scratch-buffers.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('shows a buffer as an orphan after its last pane closes, and retires it from the list', async () => {
  const { view, src } = await mount()
  await forkInto('lambda-0', 'let a = 1; a')
  const label = bufferLabelOf('lambda-0')
  closePane('lambda-0')
  await settled(view, src)
  openBufferList()
  expect(rowFor(label)).toHaveTextContent(/orphan/)
  retireRow(label)
  await settled(view, src)
  openBufferList()
  expect(rowFor(label)).toBeNull()
})
```

- [ ] **Step 2: Add the button and wire it**

`index.html` gets `<button type="button" id="buffers" aria-label="scratch buffers">buffers</button>` beside `#restore-layout`. `main.ts` constructs `bufferList` over `ScratchBuffers.list()`, computing `paneCount` from `panes.ofSession('lambda', id).length`.

- [ ] **Step 3: Run and commit**

```bash
git add web/src/main.ts web/index.html web/tests/browser/scratch-buffers.test.ts
git commit -m "main: the buffer list reaches what no pane is showing, and poison recovery lands with it"
```

---

## Task 7: The provisional cap

**Files:**
- Modify: `web/src/scratch.ts`
- Test: `web/tests/node/scratch.test.ts`

**A constant labelled the way `layout.ts:30` labels `MIN_PANE_FRACTION`** — *a choice, not a measurement* — with the arithmetic (eight buffers = ten legs at `HISTORY_BYTES`, `protocol.ts:74`) and the one datum in evidence (three threads at 2.4153× one thread's wasm baseline). Verify both citations before writing them.

At the cap `fork` **refuses with a diagnostic naming the list**. Never evicts: decision 2's whole content is that nothing ends a buffer implicitly, and an eviction is exactly that under another name.

- [ ] **Step 1-4: Test, implement, run, commit**

```ts
it('refuses a fork at the cap rather than evicting', () => {
  const { buffers } = harness()
  for (let i = 0; i < MAX_BUFFERS; i++) buffers.fork(slotFor(i), 'x', 0)
  expect(() => buffers.fork(slotExtra, 'x', 0)).toThrow(/retire/)
  expect(buffers.list()).toHaveLength(MAX_BUFFERS)   // nothing was evicted
})
```

```bash
git commit -m "scratch: a cap that is a choice, and says so"
```

---

## Task 8: The headline — two λ panes on two different buffers

**Files:**
- Test: `web/tests/browser/scratch-buffers.test.ts`

The successor to 5d-ii-a's "two λ sessions" test, and the first time the pair list carries more than one λ scratch (design §3.2).

- [ ] **Step 1: Write it**

```ts
it('renders two different buffers side by side, reached entirely through the UI', async () => {
  const { view, src } = await mount()
  await forkInto('lambda-0', 'let a = 1; a')
  splitSameInto('lambda-0')                        // second λ pane
  await forkInto('pane-1', 'let b = 2; b')         // its own buffer
  await settled(view, src)
  expect(bufferLabelOf('lambda-0')).not.toBe(bufferLabelOf('pane-1'))
  expect(termTextOf('lambda-0')).toContain('let a = 1')
  expect(termTextOf('pane-1')).toContain('let b = 2')
  // the λ group of either pane's selector now lists both buffers plus source
  expect(lambdaOptionsOf('lambda-0')).toHaveLength(3)
})
```

**Assert on rendered terms, not labels alone** — two panes showing the same buffer under different labels would pass a label-only check.

- [ ] **Step 2-3: Run, commit**

```bash
git commit -m "two λ panes on two scratch buffers, reached entirely through the UI"
```

---

## Task 9: Measure, and write the roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, possibly `web/vite.config.ts`

- [ ] **Step 1: Measure.** `cd web && pnpm test && pnpm test:coverage && pnpm run typecheck`. **Every figure from a run performed for this entry** — this repo has shipped stale closing counts twice and corrected them twice.
- [ ] **Step 2: Decide the floors deliberately.** Formula is `floor(measured) - 1`; apply it or argue for leaving them, and write the reason beside the number either way.
- [ ] **Step 3: Write the entry**, in the style of 5d-ii-b's. It must record: decision 2 superseding 5d-i decision 5 and *why poison recovery had to move with it*; the three docs the singleton's removal falsified; **the two filings this slice corrected** (the TM pair-list obligation re-filed to 5d-iv, and `pane-chrome.ts:234` → `:305-307` across three sites); the provisional cap and that it is a choice; and 5d-ii-d's position.
- [ ] **Step 4: Commit.**

---

## Self-Review

**Spec coverage.** Design §3.1 → Task 1. §3.3 → Task 2. §3.4 → Tasks 3, 6. §4.1 → Tasks 1-2. §4.2 → Task 5. §4.3 → Tasks 3, 4, 6. §4.4 → Tasks 3, 6. §4.5 → Task 7. §5's node tier → Tasks 1, 2, 4, 7; browser tier → Tasks 3, 5, 6, 8. §6.1's filings → Task 9. No gaps.

**Type consistency.** `BufferInfo` (Task 1) is the collection's shape; `BufferRow` (Task 5) adds `paneCount`, which `ScratchBuffers` cannot know — it is computed in `main.ts` from `panes.ofSession`. Those are deliberately different types; do not merge them, or `scratch.ts` gains a `PaneCollection` dependency it has no other reason to hold.

**Known soft spots, flagged rather than hidden.**
- **Tasks 3 and 6 leave a gap on purpose.** Between them there is no way to reclaim a poisoned buffer. Task 3's comment must say so. If the tasks are split across sessions, do not ship at Task 3.
- **Task 3 will break existing browser tests** that assert recompile-retires. That is expected; the risk is rewriting them to fit rather than to assert the new fact. Each rewrite names what it used to claim.
- **Task 5's helper names are placeholders.** Read `pane-chrome.ts`'s `splitControl` and the existing scratch browser tests first; reuse real harnesses.
