# 5d-ii-d — Persisted Buffers and the Measured Cap: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** λ scratch buffers survive a page reload, and the cap that bounds them becomes a measured number that counts worker threads rather than buffer records.

**Architecture:** A new `redextape.buffers` localStorage key holds buffer text, labels, the mint counter and the pane→buffer bindings; `redextape.layout` is untouched. Restore warms a buffer only when a restored pane names it, which makes *cold* buffers — a record with no session — a new state that `ScratchBuffers` owns and one call site in `main.ts` must branch on. The cap moves from counting buffers to counting live workers, and a browser-tier probe driving N real threads derives its value against a pre-registered 512 MiB page budget.

**Tech Stack:** TypeScript, Vite, Vitest (node tier + browser tier on real Chromium via Playwright), CodeMirror 6, Rust/wasm via `pkg/` (not modified by this plan).

**Design spec:** `docs/superpowers/specs/2026-08-16-plan5d-ii-d-persisted-buffers-design.md`. Every task below cites the section it implements. Read the spec section before starting a task.

## Global Constraints

- **All work is in `web/`.** No Rust changes. `crates/` and `pkg/` are read-only for this plan.
- **`redextape.layout` stays at `version: 1`.** Nothing in this plan bumps it (spec §4.1).
- **`sessions.ts` is not modified by this plan** (spec §4.2). If a task seems to need it, stop and re-read the spec.
- **THE PRE-COMMIT GATE MAKES "COMMIT THE FAILING TEST" INFEASIBLE FOR NEW EXPORTS, AND THE STEPS BELOW ARE COLLAPSED ACCORDINGLY.** `.pre-commit-config.yaml`'s `web typecheck` hook runs `tsc --noEmit` on any staged `web/**/*.ts`, tests included. A test importing a symbol that does not exist yet fails typecheck, so the commit is rejected. Tasks below therefore **write the test, run it red, implement, run it green, and commit once**. Never pass `--no-verify`.
- **Run tests from `web/`:** `cd web && pnpm test`. Single file: `pnpm test <path>`. The browser tier is real Chromium and **only one lane may run it at a time** — if another agent or another repo's vitest is running, wait.
- **Coverage floors are 95 / 89 / 97 / 97** (statements / branches / functions / lines), set in `web/vite.config.ts`. `pnpm test:coverage` must clear all four before the branch is done.
- **Doc comments are `/** */` in TypeScript**, never `///`.
- **Commit messages: no attribution trailers.** No `Co-Authored-By`, no `Generated with`.
- **Baseline at branch point:** `pnpm test` → **547 passed in 56 files** on `main` at `560d465`. Record the new count when the branch closes; do not carry this one forward as if it were fresh.

## File Structure

| file | responsibility | task |
| --- | --- | --- |
| `web/src/buffers-store.ts` *(create)* | The persisted format: `serializeBuffers`, `parseBuffers`, `BUFFERS_STORAGE_KEY`, `BUFFERS_VERSION`. Pure value module — no DOM, no registry, no pool. | 1 |
| `web/src/scratch.ts` *(modify)* | Cold/warm lifecycle: `mint`/`warm`/`cool`, `warm` on `BufferInfo`, text of record, `restore`, `snapshot`. | 2, 3, 5, 8, 9 |
| `web/src/buffer-list.ts` *(modify)* | A row renders its temperature and offers `warm` or `cool` beside `retire`. | 4 |
| `web/src/main.ts` *(modify)* | The composition root: guarded read/write of the new key, the restore sequence, the row-builder branch, the quota report. | 4, 5, 6, 9 |
| `web/src/replies.ts` *(modify)* | `scratch-compiled` records the buffer's text and seeds the collapse state. | 3, 5, 9 |
| `web/src/transport.ts` *(modify)* | A rebind persists; the collapse gesture reaches the buffer that owns it. | 5, 9 |
| `web/src/pane-chrome.ts` *(modify)* | `PaneEvents.collapse`, and the falsified reasoning on `collapseButton`. | 9 |
| `web/src/lambda-pane.ts` *(modify)* | Forwards the collapse toggle; mounts an editor already collapsed. | 9 |
| `web/tests/node/buffers-store.test.ts` *(create)* | Every rejection in §4.1, each as a payload a person could type. | 1 |
| `web/tests/node/scratch.test.ts` *(modify)* | Cold/warm lifecycle over a real registry and pool with fake ports. | 2, 3, 5, 8 |
| `web/tests/node/replies.test.ts` *(modify)* | `scratch-compiled` records the built term. | 3 |
| `web/tests/browser/buffer-list.test.ts` *(modify)* | A row's temperature, and which control it offers. | 4 |
| `web/tests/browser/buffer-restore.test.ts` *(create)* | A seeded payload restores; the list opens; the app writes one back. | 5, 9 |
| `web/tests/browser/buffer-restore-invalid.test.ts` *(create)* | A corrupt payload falls back to no buffers. Separate file — one mount each. | 5 |
| `web/tests/browser/buffers-quota.test.ts` *(create)* | A refused write reports once. Separate file — its shim throws from mount. | 6 |
| `web/tests/browser/buffer-affordability.test.ts` *(create)* | The probe. Console output is the deliverable. | 7 |
| `web/tests/browser/affordability-worker.ts` *(create)* | Test-only worker reporting its own wasm linear memory. | 7 |

**THREE BROWSER FILES RATHER THAN ONE, AND IT IS FORCED RATHER THAN FASTIDIOUS.** ES module imports are cached, so `main()` runs once per page and Vitest gives each test *file* its own page — every browser test in this repo mounts the app exactly once. Restore, corrupt-restore and quota each need `localStorage` to hold something different *at the moment of that single mount*, so they cannot share one.

---

### Task 1: The persisted format

Implements spec §4.1. A pure value module with no dependencies on the app — the same shape `layout.ts` has, and testable the same way.

**Files:**
- Create: `web/src/buffers-store.ts`
- Test: `web/tests/node/buffers-store.test.ts`

**Interfaces:**
- Consumes: `SessionId` from `./session-client`, `LeafId` from `./panes` (both are `string` aliases).
- Produces:
  - `BUFFERS_STORAGE_KEY = 'redextape.buffers'`
  - `BUFFERS_VERSION = 1`
  - `type PersistedBuffer = { id: SessionId; label: string; text: string; collapsed: boolean }`
  - `type PersistedBuffers = { minted: number; buffers: PersistedBuffer[]; bindings: Record<LeafId, SessionId> }`
  - `serializeBuffers(value: PersistedBuffers): string`
  - `parseBuffers(raw: string | null): PersistedBuffers | null`

- [ ] **Step 1: Write the test file**

Create `web/tests/node/buffers-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { type PersistedBuffers, parseBuffers, serializeBuffers } from '../../src/buffers-store'

/** A valid payload, used as the base every rejection below mutates one field of. */
const VALID: PersistedBuffers = {
  minted: 2,
  buffers: [
    { id: 'scratch-1', label: 'scratch 1', text: '(\\x. x)', collapsed: false },
    { id: 'scratch-2', label: 'scratch 2', text: '(\\y. y) (\\z. z)', collapsed: true },
  ],
  bindings: { 'lambda-0': 'scratch-1' },
}

/** Build a raw string with `envelope` merged over a valid one — the shape a hand-edit produces. */
function raw(envelope: Record<string, unknown>): string {
  return JSON.stringify({ version: 1, ...VALID, ...envelope })
}

describe('parseBuffers', () => {
  it('round-trips a valid payload', () => {
    expect(parseBuffers(serializeBuffers(VALID))).toEqual(VALID)
  })

  it('answers null for nothing stored', () => {
    expect(parseBuffers(null)).toBeNull()
  })

  it('answers null for text that is not JSON', () => {
    expect(parseBuffers('{not json')).toBeNull()
  })

  it('answers null for a wrong version', () => {
    expect(parseBuffers(JSON.stringify({ version: 2, ...VALID }))).toBeNull()
  })

  it('answers null for a missing version', () => {
    expect(parseBuffers(JSON.stringify(VALID))).toBeNull()
  })

  it('answers null when buffers is not an array', () => {
    expect(parseBuffers(raw({ buffers: {} }))).toBeNull()
  })

  it('answers null for a duplicate id', () => {
    expect(
      parseBuffers(
        raw({
          buffers: [VALID.buffers[0], { ...VALID.buffers[1], id: 'scratch-1' }],
        }),
      ),
    ).toBeNull()
  })

  // THE COLLISION `#minted`'s DOC EXISTS TO PREVENT: a counter below an id it already holds lets the
  // next fork mint `scratch-2` while a live `scratch-2` is on the page.
  it('answers null when minted is below an id the payload already claims', () => {
    expect(parseBuffers(raw({ minted: 1 }))).toBeNull()
  })

  it('accepts a minted above every id, which a retire produces', () => {
    expect(parseBuffers(raw({ minted: 9 }))).not.toBeNull()
  })

  it('answers null for a non-string text', () => {
    expect(parseBuffers(raw({ buffers: [{ ...VALID.buffers[0], text: 42 }] }))).toBeNull()
  })

  it('answers null for a non-boolean collapsed', () => {
    expect(parseBuffers(raw({ buffers: [{ ...VALID.buffers[0], collapsed: 'yes' }] }))).toBeNull()
  })

  it('answers null for a binding naming no buffer in the same payload', () => {
    expect(parseBuffers(raw({ bindings: { 'lambda-0': 'scratch-7' } }))).toBeNull()
  })

  it('accepts two leaves bound to one buffer, which two panes on one buffer produce', () => {
    expect(parseBuffers(raw({ bindings: { 'lambda-0': 'scratch-1', 'pane-3': 'scratch-1' } }))).not.toBeNull()
  })

  // NO TEXT CAP, AND THIS TEST IS THE DECISION (design §4.1): the quota is the bound, not a number
  // invented here, and a user may legitimately type a term longer than any constant would allow.
  it('accepts a very long term', () => {
    const long = 'x'.repeat(200_000)
    expect(parseBuffers(raw({ buffers: [{ ...VALID.buffers[0], text: long }] }))?.buffers[0]?.text).toBe(long)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

Run: `cd web && pnpm test tests/node/buffers-store.test.ts`

Expected: FAIL — `Failed to resolve import "../../src/buffers-store"`. If it fails for any other reason, stop and read the error.

- [ ] **Step 3: Write `web/src/buffers-store.ts`**

```ts
import type { LeafId } from './panes'
import type { SessionId } from './session-client'

/**
 * The `localStorage` key the scratch buffers are stored under.
 *
 * NAMESPACED, for the reason `appearance.ts:10-12` gives and `layout.ts` repeats: `localStorage` is
 * scoped to an origin and not to an app, so every dev server on the same host shares one store.
 *
 * A SECOND KEY RATHER THAN A FIELD IN `redextape.layout`, AND THE REASON IS A MEASUREMENT RATHER THAN
 * TASTE (design §3.1). `layout-view.ts:150` binds `pointermove` and reaches
 * `writeLayoutStorage(serializeLayout(...))` (`pane-host.ts:741`) from it, so the layout payload is
 * re-serialised and written synchronously at pointer rate for the length of a divider drag. A fork's
 * seed is printed at `LAMBDA_BYTE_BUDGET` — 65,536 bytes — so buffer text behind that key would put a
 * few hundred kilobytes through `JSON.stringify` sixty times a second. Two keys keeps the layout write
 * exactly as cheap as it is today and needs no change to that path.
 */
export const BUFFERS_STORAGE_KEY = 'redextape.buffers'

/** Bumped when the stored shape changes. A mismatch falls back to nothing rather than migrating. */
export const BUFFERS_VERSION = 1

/** One buffer as it survives a reload: what it is called, what it holds, and how it was displayed. */
export type PersistedBuffer = {
  id: SessionId
  label: string
  text: string
  collapsed: boolean
}

/**
 * Everything about buffers that survives a reload.
 *
 * **THE BINDINGS LIVE HERE AND NOT WITH THE TREE, WHICH IS WHAT REMOVES A REPAIR PASS** (design §4.1).
 * A binding is meaningless without the buffer it names, so co-locating them makes "this key is absent
 * or garbage" degrade to *no bindings at all* — every pane on the source session, which is today's
 * behaviour exactly, reached without a line of reconciliation. The other direction needs nothing
 * either: a binding naming a leaf the restored tree does not hold is simply never read, because the
 * consumer (`pane-host.ts`'s `pendingBinding`) iterates the tree's leaves.
 *
 * `minted` IS THE COUNTER AND NOT THE COUNT. `ScratchBuffers.#minted` only ever goes up, so that a
 * retired buffer's name is never reissued; restoring the COUNT instead would hand `scratch 2` to a
 * second, different term the first time a user retires and re-forks across a reload.
 */
export type PersistedBuffers = {
  minted: number
  buffers: PersistedBuffer[]
  bindings: Record<LeafId, SessionId>
}

export function serializeBuffers(value: PersistedBuffers): string {
  return JSON.stringify({ version: BUFFERS_VERSION, ...value })
}

/** The trailing number in `scratch-7`, or `null` for an id this app did not mint. */
function mintedIndex(id: string): number | null {
  const m = /^scratch-(\d+)$/.exec(id)
  if (m === null) return null
  return Number(m[1])
}

/**
 * Validate one buffer entry, collecting its id.
 *
 * IT CHECKS INVARIANTS AND NOT ONLY SHAPE, which is `layout.ts`'s `validate` rule restated: the hazard
 * is a hand-edited `localStorage` entry, so every rejection here is something a person could plausibly
 * type, and a payload that parses as JSON and then violates an invariant crashes inside the app rather
 * than falling back.
 *
 * **THERE IS NO TEXT-LENGTH REJECTION, AND THE ABSENCE IS A DECISION** (design §4.1). The quota is the
 * real bound and the browser is what enforces it; a second number would have to justify itself against
 * a user who legitimately typed a longer term. Duplicate ids and a stale `minted` are rejected because
 * they make the app produce a WRONG state; a long term does not.
 */
function validBuffer(node: unknown, ids: Set<string>): node is PersistedBuffer {
  if (typeof node !== 'object' || node === null) return false
  const n = node as Record<string, unknown>
  if (typeof n.id !== 'string' || n.id.length === 0) return false
  if (typeof n.label !== 'string' || n.label.length === 0) return false
  if (typeof n.text !== 'string') return false
  if (typeof n.collapsed !== 'boolean') return false
  if (ids.has(n.id)) return false
  ids.add(n.id)
  return true
}

/**
 * The stored buffers, or `null` if there is nothing usable there.
 *
 * `null` RATHER THAN A THROW OR A DEFAULT, mirroring `parseLayout`: the caller already knows what
 * "no buffers" looks like, and returning it from here would make "there was nothing stored" and "what
 * was stored was garbage" indistinguishable to a test.
 *
 * A FAILED READ IS SILENT, ALSO MIRRORING `parseLayout` — it is indistinguishable from a first visit,
 * and a banner on every load after a schema bump is worse than what it reports. A failed WRITE is not
 * silent; see `main.ts`'s writer for why the two differ (design §4.8).
 */
export function parseBuffers(raw: string | null): PersistedBuffers | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const envelope = parsed as Record<string, unknown>
  if (envelope.version !== BUFFERS_VERSION) return null

  if (typeof envelope.minted !== 'number' || !Number.isInteger(envelope.minted) || envelope.minted < 0) return null
  if (!Array.isArray(envelope.buffers)) return null

  const ids = new Set<string>()
  const buffers: PersistedBuffer[] = []
  for (const b of envelope.buffers) {
    if (!validBuffer(b, ids)) return null
    buffers.push(b)
  }

  // THE COUNTER MUST DOMINATE EVERY NAME IT CLAIMS TO HAVE MINTED. Below that, the next fork mints an
  // id a live buffer already holds, and `SessionRegistry.add`/`SessionPool.bind` both throw on it —
  // a wiring bug produced by a hand-edited preference, which is the class this function refuses.
  for (const b of buffers) {
    const n = mintedIndex(b.id)
    if (n === null || n > envelope.minted) return null
  }

  if (typeof envelope.bindings !== 'object' || envelope.bindings === null || Array.isArray(envelope.bindings)) {
    return null
  }
  const bindings: Record<LeafId, SessionId> = {}
  for (const [leaf, session] of Object.entries(envelope.bindings as Record<string, unknown>)) {
    if (typeof session !== 'string' || !ids.has(session)) return null
    bindings[leaf] = session
  }

  return { minted: envelope.minted, buffers, bindings }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd web && pnpm test tests/node/buffers-store.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/buffers-store.ts web/tests/node/buffers-store.test.ts
git commit -m "5d-ii-d T1: the persisted buffer format, validated for invariants rather than shape

A second localStorage key rather than a field in redextape.layout, because
layout-view.ts:150 writes the layout on every pointermove and buffer text
behind that key would be re-serialized at pointer rate.

Bindings ride with the buffers: a binding is meaningless without the buffer
it names, so a corrupt key degrades to no bindings at all, which is today's
behaviour, with no cross-key reconciliation."
```

---

### Task 2: Cold and warm buffers

Implements spec §4.2. `fork` splits into mint + warm; `cool` is warm's inverse; `retire` learns that a cold buffer has no registry entry to remove.

**Files:**
- Modify: `web/src/scratch.ts`
- Test: `web/tests/node/scratch.test.ts`

**Interfaces:**
- Consumes: Task 1's module is **not** used here — this task is the in-memory model only.
- Produces, on `ScratchBuffers`:
  - `BufferInfo` gains `readonly warm: boolean`
  - `warm(id: SessionId): void` — spawn a worker for a cold buffer and post its text. Throws `BufferCapReached` at the cap; throws a plain `Error` for an unknown id.
  - `cool(id: SessionId, home: SessionId, slots: readonly Detachable[]): boolean` — rebind its panes to `home`, terminate the worker, keep the record. Answers whether anything changed. **The signature matches `retire`'s, and the rebind is why** — see the method's doc below for the claim this replaced.
  - `warmCount(): number`
  - `fork` and `retire` keep their existing signatures.

- [ ] **Step 1: Read the existing test file's harness**

Run: `cd web && sed -n '1,60p' tests/node/scratch.test.ts`

It builds a real `SessionRegistry` and a real `SessionPool` over recording fake ports. Reuse that harness exactly; do not invent a second one.

- [ ] **Step 2: Append these tests to `web/tests/node/scratch.test.ts`**

Use the file's existing helper names for building the harness (read in step 1) — the block below names them `harness()`, `buffers`, `slot()`; rename to match what is already there.

> **SUPERSEDED IN PART, 2026-08-16.** The `cool(id)` calls in this block predate the signature change to `cool(id, home, slots)` (see this task's `cool` doc, and the ledger entry recording the reversal). The committed tests pass `(id, 'source', [])` where no pane is bound, and the block gained a case asserting that cooling a buffer with a bound pane leaves that pane on `home`. Left as written rather than rewritten, because the code that shipped is the record and this block is what it was written from.

```ts
describe('cold and warm buffers', () => {
  it('cool terminates the worker and keeps the record', () => {
    const h = harness()
    const id = h.buffers.fork(slot(), '(\\x. x)', 0)
    expect(h.pool.has(id)).toBe(true)

    expect(h.buffers.cool(id)).toBe(true)

    // THE RECORD SURVIVES AND THE THREAD DOES NOT — the whole content of a cool.
    expect(h.buffers.list().map((b) => b.id)).toEqual([id])
    expect(h.buffers.list()[0]?.warm).toBe(false)
    expect(h.pool.has(id)).toBe(false)
    expect(h.registry.has(id)).toBe(false)
  })

  it('cool answers false for a buffer that is already cold', () => {
    const h = harness()
    const id = h.buffers.fork(slot(), '(\\x. x)', 0)
    h.buffers.cool(id)
    expect(h.buffers.cool(id)).toBe(false)
  })

  it('warm gives a cold buffer a worker again and posts its text', () => {
    const h = harness()
    const id = h.buffers.fork(slot(), '(\\x. x)', 0)
    h.buffers.cool(id)

    h.buffers.warm(id)

    expect(h.pool.has(id)).toBe(true)
    expect(h.registry.has(id)).toBe(true)
    expect(h.buffers.list()[0]?.warm).toBe(true)
  })

  // AT STEP 0, NOT AT THE STEP THE FORK USED. The text IS the term after a build, which is what
  // `recompile` already means; there is nothing to replay to.
  it('warm posts the buffer text at step 0', () => {
    const h = harness()
    const id = h.buffers.fork(slot(), 'seed-text', 3)
    h.buffers.setText(id, 'the-term')
    h.buffers.cool(id)
    h.ports.length = 0

    h.buffers.warm(id)

    expect(h.lastScratchPost()).toEqual({ src: 'the-term', step: 0 })
  })

  it('warm throws for an id that is not a buffer', () => {
    const h = harness()
    expect(() => h.buffers.warm('scratch-9')).toThrow(/not a buffer/)
  })

  it('retire ends a cold buffer without touching the registry', () => {
    const h = harness()
    const id = h.buffers.fork(slot(), '(\\x. x)', 0)
    h.buffers.cool(id)

    expect(h.buffers.retire(id, 'source', [])).toBe(true)
    expect(h.buffers.list()).toEqual([])
  })

  it('retire rebinds a cold buffer’s panes home, same as a warm one', () => {
    const h = harness()
    const s = slot()
    const id = h.buffers.fork(s, '(\\x. x)', 0)
    h.buffers.cool(id)

    h.buffers.retire(id, 'source', [s])

    expect(s.binding.session).toBe('source')
  })

  it('warmCount counts threads and not records', () => {
    const h = harness()
    const a = h.buffers.fork(slot(), 'a', 0)
    h.buffers.fork(slot(), 'b', 0)
    expect(h.buffers.warmCount()).toBe(2)

    h.buffers.cool(a)

    expect(h.buffers.warmCount()).toBe(1)
    expect(h.buffers.list()).toHaveLength(2)
  })
})
```

- [ ] **Step 3: Run and confirm red**

Run: `cd web && pnpm test tests/node/scratch.test.ts`
Expected: FAIL — `buffers.cool is not a function`, and `setText`/`warmCount` likewise. (`setText` is Task 3's; it is used here only as a fixture and must be added in this task as a plain setter so these tests can run. Its call sites arrive in Task 3.)

- [ ] **Step 4: Implement in `web/src/scratch.ts`**

4a. Change `BufferInfo` and add the text of record to the private map. Replace the `BufferInfo` type and the `#buffers` field:

```ts
export type BufferInfo = { readonly id: SessionId; readonly label: string; readonly warm: boolean }

/** What this class holds per buffer — `BufferInfo` plus the two facts no surface outside renders. */
type BufferState = { readonly id: SessionId; readonly label: string; text: string; warm: boolean }
```

and change the field's type to `#buffers = new Map<SessionId, BufferState>()`, keeping its existing doc and adding:

```
   * **A RECORD MAY OUTLIVE ITS SESSION NOW, WHICH FALSIFIES A SENTENCE THIS DOC USED TO RELY ON.**
   * `main.ts`'s row builder justified an unguarded `legOf` with "a buffer is in `#buffers` and in the
   * registry together or in neither". A cold buffer is in this map and in neither container behind
   * `legOf`, by construction (design §4.2), and `SessionRegistry.entryOf` throws for an id it does not
   * hold. That call site branches on `warm` now; this map is where the fact lives.
```

4b. Extract `fork`'s tail into `warm`, and have `fork` call it:

```ts
  fork(slot: Detachable, src: string, step: number): SessionId {
    if (this.warmCount() >= MAX_BUFFERS) {
      throw new BufferCapReached(
        `all ${MAX_BUFFERS} scratch buffers are live; retire or cool one from the buffers list in the header to make room`,
      )
    }
    this.#minted += 1
    const id: SessionId = `scratch-${this.#minted}`
    this.#buffers.set(id, { id, label: `scratch ${this.#minted}`, text: src, warm: false })
    this.#spawn(id, src, step)
    slot.rebind(id)
    return id
  }

  /**
   * Give a cold buffer a worker again and rebuild it from its text.
   *
   * **AT STEP 0, WHERE `fork` PASSES THE STEP THE PANE WAS SHOWING.** After a build the text IS the
   * term — which is exactly what `recompile` already means and why it posts 0 — so there is nothing to
   * replay to. A restored buffer therefore comes back at the head of a fresh run rather than where its
   * play head was, and the ring it had is gone: that is the cost design §4.5 weighs when it declines to
   * auto-cool an orphan.
   *
   * THROWS FOR AN UNKNOWN ID rather than answering `false` like `cool` does. A cool asks for a state
   * that may already be true; a warm names a buffer whose text this class is being asked to rebuild,
   * and there is no honest rebuild of a buffer that does not exist.
   */
  warm(id: SessionId): void {
    const state = this.#buffers.get(id)
    if (state === undefined) throw new Error(`not a buffer: ${id}`)
    if (state.warm) return
    if (this.warmCount() >= MAX_BUFFERS) {
      throw new BufferCapReached(
        `all ${MAX_BUFFERS} scratch buffers are live; retire or cool one from the buffers list in the header to make room`,
      )
    }
    this.#spawn(id, state.text, 0)
  }

  /**
   * Put buffer `id` to sleep: terminate its worker, forget its session, keep its text. Answers
   * whether anything changed.
   *
   * **THE NON-DESTRUCTIVE ESCAPE FROM THE CAP, AND THAT IS WHY IT EXISTS** (design §4.5). With the cap
   * counting threads, a user who reaches it would otherwise have exactly one way out — an explicit
   * retire, which ends a buffer and its text. A cap that never evicts but leaves no other exit would
   * destroy work by omission, which is 5d-ii-c decision 2 defeated rather than honoured.
   *
   * IT IS `retire` WITHOUT THE FORGETTING, AND THE ORDER IS THE SAME ONE `retire`'s DOC ARGUES FOR:
   * panes, legs, registry, pool.
   *
   * **PANES ARE REBOUND, EXACTLY AS `retire` REBINDS THEM — AND THIS PARAGRAPH USED TO SAY THE
   * OPPOSITE.** It read: *"Panes are NOT rebound — a pane bound to a cooled buffer keeps naming it,
   * which is what makes warming it again put the pane back in front of its own term."* That is
   * unimplementable and was caught in review before it shipped. Cooling removes the registry entry, and
   * `retire`'s own doc already records the consequence — *"`legOf` and `entryOf` throw for a session the
   * registry does not hold, and `draw()` resolves through both, so a slot still pointing at a removed
   * entry is an exception on the next frame rather than a blank pane"*. A pane left naming a cooled
   * buffer strands its slot: `draw()` throws on the next frame, and typing into its editor reaches
   * `recompile`, which throws through the same `entryOf`.
   *
   * **THE INVARIANT THAT BUYS IS THE ONE EVERY OTHER COLD-BUFFER HAZARD REDUCES TO: A COLD BUFFER HAS
   * NO PANES BOUND TO IT.** It makes `recompile`-on-a-cold-buffer unreachable rather than guarded, and
   * it matches the restore policy from the other end — orphans are exactly the buffers that come back
   * cold (design §4.2). What is lost is the sentence above's convenience: warming does not put a pane
   * back in front of its term by itself. Warm from the header list, then bind a pane to it through the
   * selector — which is the flow design §4.2 already settled when it made the list temperature's one
   * surface.
   */
  cool(id: SessionId, home: SessionId, slots: readonly Detachable[]): boolean {
    const state = this.#buffers.get(id)
    if (state === undefined || !state.warm) return false
    for (const slot of slots) {
      if (slot.binding.session === id) slot.rebind(home)
    }
    resetLegs(this.#reg.entryOf(id).legs, null, null, 'not compiled')
    this.#reg.remove(id)
    this.#pool.unbind(id)
    state.warm = false
    return true
  }

  /** How many buffers hold a worker — the quantity `MAX_BUFFERS` bounds (design §4.4). */
  warmCount(): number {
    let n = 0
    for (const b of this.#buffers.values()) if (b.warm) n += 1
    return n
  }

  /** Record the term buffer `id` now holds. Task 3 wires its two call sites. */
  setText(id: SessionId, text: string): void {
    const state = this.#buffers.get(id)
    if (state !== undefined) state.text = text
  }
```

4c. Add the private `#spawn` holding what was `fork`'s body — bind the client, add the registry entry, post. Move `fork`'s existing comments with it verbatim; they describe these lines:

```ts
  /** Bind a worker, register the session, and post the build. The half of `fork` a `warm` repeats. */
  #spawn(id: SessionId, src: string, step: number): void {
    const client = this.#pool.bind(id, (reply) => this.#onReply(id, reply))
    this.#reg.add({
      id,
      label: this.#buffers.get(id)?.label ?? id,
      detached: true,
      client,
      legs: {
        lambda: {
          hist: new History<LambdaState>(this.#bytes),
          status: { available: false, reason: 'building…' },
          done: null,
          timer: null,
        },
      },
      tmProgram: null,
    })
    const state = this.#buffers.get(id)
    if (state !== undefined) state.warm = true
    client.scratch(client.supersede(), src, step)
  }
```

4d. Give `retire` a temperature branch — replace its two mutation lines:

```ts
    // COLD BUFFERS HAVE NO ENTRY AND NO THREAD, so the panes/legs/registry/pool half of a retire is
    // exactly what `cool` already does — INCLUDING THE REBIND, which is why `retire` no longer carries
    // a loop of its own. `cool` answers `false` for a cold buffer AFTER rebinding, which is what makes
    // this one line correct for both temperatures rather than two branches saying the same thing twice.
    this.cool(id, home, slots)
    this.#buffers.delete(id)
```

4e. Update `list()` to project `warm`:

```ts
  list(): readonly BufferInfo[] {
    return [...this.#buffers.values()].map((b) => ({ id: b.id, label: b.label, warm: b.warm }))
  }
```

- [ ] **Step 5: Run and confirm green**

Run: `cd web && pnpm test tests/node/scratch.test.ts`
Expected: PASS — the existing tests plus the eight new ones.

- [ ] **Step 6: Run the whole suite — this task changes a type three files read**

Run: `cd web && pnpm test && pnpm run typecheck`
Expected: PASS. If `main.ts` fails to typecheck on `BufferInfo` gaining a field, that is Task 4's work arriving early — add `warm: b.warm` to nothing yet, and instead confirm the failure is only in the row builder's object literal. Fix by leaving the literal alone (extra fields on `BufferInfo` do not break its consumers; a missing one would).

- [ ] **Step 7: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/scratch.ts web/tests/node/scratch.test.ts
git commit -m "5d-ii-d T2: a buffer may be cold — a record that outlives its session

fork splits into mint + warm; cool is warm's inverse, terminating the thread
and keeping the text. The cap counts threads via warmCount(), so a cooled
buffer stops spending against it.

cool exists because the cap counting threads would otherwise leave retire as
the only escape from it, which destroys work — the outcome 5d-ii-c decision 2
exists to prevent."
```

---

### Task 3: The text of record

Implements spec §4.3. `setText` gains its two real callers.

**Files:**
- Modify: `web/src/replies.ts` (the `scratch-compiled` arm, `:285`)
- Modify: `web/src/scratch.ts` (`recompile`)
- Test: `web/tests/node/scratch.test.ts`, `web/tests/node/replies.test.ts`

**Interfaces:**
- Consumes: `ScratchBuffers.setText(id, text)` from Task 2.
- Produces: nothing new. After this task, `list()`'s buffers always hold the term last built or last typed.

- [ ] **Step 1: Add the tests**

Append to `web/tests/node/scratch.test.ts`:

```ts
it('recompile records the text it posts', () => {
  const h = harness()
  const id = h.buffers.fork(slot(), 'seed', 0)
  h.buffers.recompile(id, 'typed-term')
  // `cool(id, home, slots)` — the signature gained `home`/`slots` mid-slice; see Task 2's `cool` doc.
  // An empty slots array is honest here: this harness binds no panes.
  h.buffers.cool(id, 'source', [])
  h.ports.length = 0

  h.buffers.warm(id)

  expect(h.lastScratchPost()).toEqual({ src: 'typed-term', step: 0 })
})
```

In `web/tests/node/replies.test.ts`, add a case to the `scratch-compiled` group — match the file's existing harness for building `createReplies`:

```ts
it('records the built term as the buffer’s text', () => {
  const h = repliesHarness()
  h.buffers.fork(slot(), 'seed', 0)
  h.onScratchReply('scratch-1', {
    kind: 'scratch-compiled',
    gen: 1,
    lambda: { available: true, reason: '' },
    text: 'built-term',
  })
  expect(h.buffers.textOf('scratch-1')).toBe('built-term')
})
```

`textOf` does not exist. Rather than add an accessor for a test, assert it the way Task 2's tests do — cool, clear the recorded posts, warm, and read what was posted:

```ts
it('records the built term as the buffer’s text', () => {
  const h = repliesHarness()
  h.buffers.fork(slot(), 'seed', 0)
  h.onScratchReply('scratch-1', {
    kind: 'scratch-compiled',
    gen: 1,
    lambda: { available: true, reason: '' },
    text: 'built-term',
  })

  h.buffers.cool('scratch-1', 'source', [])
  h.ports.length = 0
  h.buffers.warm('scratch-1')

  expect(h.lastScratchPost()).toEqual({ src: 'built-term', step: 0 })
})
```

- [ ] **Step 2: Run and confirm red**

Run: `cd web && pnpm test tests/node/scratch.test.ts tests/node/replies.test.ts`
Expected: FAIL — both assert `seed` where the test wants the recorded term.

- [ ] **Step 3: Implement**

3a. In `web/src/scratch.ts`, inside `recompile`, after the membership check:

```ts
    // THE TEXT OF RECORD, WRITTEN AT THE POINT IT BECOMES TRUE (design §4.3). This is the user's own
    // text; the other writer is `replies.ts`'s `scratch-compiled` arm, which carries the worker's
    // answer for a fork. Two writers, both already-existing call sites, and no third.
    this.setText(id, src)
```

3b. In `web/src/replies.ts`'s `scratch-compiled` arm, beside the existing `setEditor` call:

```ts
        // **THE BUFFER'S TEXT OF RECORD (design §4.3), AND IT IS NOT `setEditor`'s ARGUMENT BY
        // COINCIDENCE.** For a fork, the term the worker derived at the requested step is the first
        // moment this app knows what the buffer holds — `ScratchBuffers.fork` posts the SOURCE's
        // step-0 text and a step, and the worker re-derives between them. Recording it here rather
        // than reading it back off the `LambdaEditor` later is what lets a buffer whose editor was
        // never mounted — a fork whose build failed, or one custody retired — still be persisted.
        if (reply.text !== null) scratchpad.setText(session, reply.text)
```

- [ ] **Step 4: Run and confirm green**

Run: `cd web && pnpm test tests/node/scratch.test.ts tests/node/replies.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/scratch.ts web/src/replies.ts web/tests/node/scratch.test.ts web/tests/node/replies.test.ts
git commit -m "5d-ii-d T3: the buffer's text of record, written at its two true moments

scratch-compiled carries the term the worker derived for a fork; recompile
carries the term the user typed. Recorded in ScratchBuffers rather than read
back off the LambdaEditor, so a buffer whose editor was never mounted — a
failed fork, or one custody retired — still has a term to persist."
```

---

### Task 4: The buffer list learns about temperature

Implements spec §4.2 and closes §3.2's crash. **This is the task the spec calls the finding that outranks the feature** — until it lands, opening the list on a page holding a cold buffer throws from a click handler.

**Files:**
- Modify: `web/src/buffer-list.ts` (`BufferRow`, `bufferRow`)
- Modify: `web/src/main.ts` (the row builder at `:619-645`, the retire handler)
- Test: `web/tests/browser/buffer-list.test.ts`

**Interfaces:**
- Consumes: `BufferInfo.warm` and `ScratchBuffers.warm`/`cool` from Task 2.
- Produces:
  - `BufferRow` gains `readonly warm: boolean`
  - `bufferList`'s third parameter becomes `onRetire: (id: SessionId) => void`, and a **fourth** is added: `onTemperature: (id: SessionId, warm: boolean) => void`

- [ ] **Step 1: Add the tests to `web/tests/browser/buffer-list.test.ts`**

Match the file's existing fixture style for rows.

```ts
it('a cold row offers warm and not cool', async () => {
  const h = mount([{ id: 'scratch-1', label: 'scratch 1', paneCount: 0, term: null, warm: false }])
  await h.open()
  expect(h.row(0).textContent).toContain('asleep')
  expect(h.button(0, 'warm')).not.toBeNull()
  expect(h.button(0, 'cool')).toBeNull()
})

it('a warm row offers cool and not warm', async () => {
  const h = mount([{ id: 'scratch-1', label: 'scratch 1', paneCount: 1, term: '(\\x. x)', warm: true }])
  await h.open()
  expect(h.button(0, 'cool')).not.toBeNull()
  expect(h.button(0, 'warm')).toBeNull()
})

it('clicking warm reports the id and the temperature asked for', async () => {
  const seen: [string, boolean][] = []
  const h = mount([{ id: 'scratch-1', label: 'scratch 1', paneCount: 0, term: null, warm: false }], {
    onTemperature: (id, warm) => seen.push([id, warm]),
  })
  await h.open()
  h.button(0, 'warm')?.click()
  expect(seen).toEqual([['scratch-1', true]])
})

// A COLD BUFFER HAS NO SESSION, so a row must not claim it holds a term it cannot read.
it('a cold row says it is asleep rather than showing no term', async () => {
  const h = mount([{ id: 'scratch-1', label: 'scratch 1', paneCount: 0, term: null, warm: false }])
  await h.open()
  expect(h.row(0).textContent).not.toContain('no term')
})
```

- [ ] **Step 2: Run and confirm red**

Run: `cd web && pnpm test tests/browser/buffer-list.test.ts`
Expected: FAIL — `warm` is not a property of the fixture type, and `onTemperature` is not a parameter.

- [ ] **Step 3: Implement in `web/src/buffer-list.ts`**

3a. Add to `BufferRow`:

```ts
  /**
   * Whether this buffer holds a worker.
   *
   * **A COLD BUFFER IS TEXT AND A NAME, AND NOTHING THIS MODULE CAN ASK ABOUT** (design §4.2). It has
   * no session, so `term` is necessarily `null` for one — and that `null` means something different
   * from the one a warm buffer produces. A warm buffer with no term is a fork that has not answered or
   * never will; a cold one simply is not running. The row says which, because "no term" under a name
   * reads as a fault where "asleep" reads as a state.
   */
  readonly warm: boolean
```

3b. In `bufferRow`, render the state and pick the control. The row already builds a retire button; add beside it:

```ts
  const temperature = document.createElement('button')
  temperature.type = 'button'
  // ADDED AND REMOVED, NEVER DISABLED — `pane-chrome.ts`'s stated idiom, and the same standard: a
  // control that provably cannot work should not be offered. There is no `cool` for a cold buffer.
  temperature.textContent = row.warm ? 'cool' : 'warm'
  temperature.addEventListener('click', () => onTemperature(row.id, !row.warm))
```

and include `row.warm ? '' : ' — asleep'` in the row's own text alongside the existing `orphan` marker.

3c. Widen the signature:

```ts
export function bufferList(
  button: HTMLButtonElement,
  rows: () => readonly BufferRow[],
  onRetire: (id: SessionId) => void,
  onTemperature: (id: SessionId, warm: boolean) => void,
): { update(count: number): void } {
```

- [ ] **Step 4: Fix `main.ts`'s row builder — this is §3.2's crash**

Replace the `term:` property and its `legOf CANNOT THROW HERE` doc block with:

```ts
        /**
         * **`legOf` IS ASKED ONLY FOR A WARM BUFFER, AND THIS BRANCH IS WHY THE PARAGRAPH THAT USED TO
         * BE HERE IS GONE.** It read: *"`legOf` CANNOT THROW HERE, AND THE REASON IS THE GOVERNING RULE
         * RATHER THAN AN ASSUMPTION: a buffer is in `#buffers` and in the registry together or in
         * neither, because `#reg.remove` and `#buffers.delete` appear exactly once in `src/` and both
         * are inside `retire`."* 5d-ii-d design §4.2 makes that false by construction — a cold buffer is
         * in `#buffers` and in neither container — and `SessionRegistry.entryOf` throws for an id it
         * does not hold (`sessions.ts:250-254`, deliberately: a session the registry lacks "is a wiring
         * bug, not a state the UI has an honest rendering for"). Unbranched, the first open of this list
         * on a page that restored an orphan threw out of a `beforetoggle` handler, which is a click.
         *
         * **THE BRANCH IS ON `warm` AND NOT ON A `try`.** A cold buffer is a state this app produces
         * on purpose, so asking and catching would be treating a designed state as an exception — and
         * it would also swallow the genuine wiring bug the throw exists to report.
         */
        term: b.warm ? sessions.legOf({ session: b.id, leg: 'lambda' }).hist.current?.text ?? null : null,
        warm: b.warm,
```

Then add the fourth argument to the `bufferList(...)` call:

```ts
    (id, warm) => {
      /**
       * **WARMING CAN BE REFUSED AND COOLING CANNOT**, so only one arm has a catch. `ScratchBuffers.warm`
       * raises `BufferCapReached` at the cap for the same reason `fork` does, and it reports through the
       * same field and the same surface — `link-wiring.ts`'s `forkFailed`, rendered by `link-status.ts`.
       * A bare `catch` would swallow `SessionRegistry.add`'s and `SessionPool.bind`'s guards, which are
       * wiring bugs; `instanceof` is what keeps a refusal a refusal.
       */
      try {
        if (warm) scratchpad.warm(id)
        // **THE SLOTS ARGUMENT IS WHAT MAKES THE INVARIANT TRUE, AND THIS IS ITS ONLY REAL CALL SITE.**
        // `cool` rebinds every pane on the buffer it sleeps, so "a cold buffer has no panes bound to it"
        // is a property of what this line passes, not of `ScratchBuffers`. Hand it the same set the
        // retire handler twenty lines below hands `retire` — every slot on the page — because a partial
        // set strands exactly the panes it omits: `entryOf` throws for a session the registry no longer
        // holds, and `draw()` resolves through it on the next frame.
        else scratchpad.cool(id, SOURCE_SESSION, panes.all().map((p) => p.slot))
      } catch (e) {
        if (!(e instanceof BufferCapReached)) throw e
        linkWiring.setForkFailed(e.message)
        draw()
        return
      }
      linkWiring.setForkFailed(null)
      try {
        custody.reconcile()
      } finally {
        refreshBuffers()
        draw()
      }
    },
```

Import `BufferCapReached` in `main.ts` if it is not already imported.

- [ ] **Step 5: Run and confirm green**

Run: `cd web && pnpm test tests/browser/buffer-list.test.ts && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 6: Run the whole suite**

Run: `cd web && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/buffer-list.ts web/src/main.ts web/tests/browser/buffer-list.test.ts
git commit -m "5d-ii-d T4: the buffer list branches on temperature, closing a live crash site

main.ts's row builder called legOf on the authority of 'a buffer is in
#buffers and in the registry together or in neither'. Cold buffers falsify
that by construction, and entryOf throws — so opening the list on a page
holding a cooled or restored orphan threw out of a beforetoggle handler.

A cold row says 'asleep' rather than showing no term, and offers warm where a
warm row offers cool."
```

---

### Task 5: Persistence and restore

Implements spec §4.1, §4.9. The feature.

**Files:**
- Modify: `web/src/scratch.ts` (`snapshot`, `restore`)
- Modify: `web/src/main.ts` (guarded reader/writer, the restore sequence, the persist calls)
- Modify: `web/src/pane-host.ts` (expose seeding `pendingBinding`)
- Test: `web/tests/browser/buffer-restore.test.ts` *(create)*, `web/tests/node/scratch.test.ts`

**Interfaces:**
- Consumes: `serializeBuffers`, `parseBuffers`, `PersistedBuffers` (Task 1); `warm`, `cool`, `setText` (Tasks 2–3).
- Produces:
  - `ScratchBuffers.snapshot(bindings: Record<LeafId, SessionId>): PersistedBuffers`
  - `ScratchBuffers.restore(value: PersistedBuffers): void` — inserts every buffer **cold** and sets the mint counter.
  - `PaneHost.seedBinding(leaf: LeafId, session: SessionId): void`

- [ ] **Step 1: Add the node tests for snapshot/restore**

Append to `web/tests/node/scratch.test.ts`:

```ts
describe('snapshot and restore', () => {
  it('round-trips buffers through a snapshot', () => {
    const h = harness()
    const a = h.buffers.fork(slot(), 'a', 0)
    h.buffers.setText(a, 'term-a')

    const snap = h.buffers.snapshot({ 'lambda-0': a })
    const fresh = harness()
    fresh.buffers.restore(snap)

    expect(fresh.buffers.list()).toEqual([{ id: a, label: 'scratch 1', warm: false }])
  })

  // EVERY RESTORED BUFFER IS COLD. Warming is the app's decision, taken per pane in main.ts.
  it('restores every buffer cold, spawning nothing', () => {
    const h = harness()
    h.buffers.fork(slot(), 'a', 0)
    const snap = h.buffers.snapshot({})

    const fresh = harness()
    fresh.buffers.restore(snap)

    expect(fresh.pool.size).toBe(0)
    expect(fresh.buffers.warmCount()).toBe(0)
  })

  // THE COUNTER, NOT THE COUNT — a restored page must not reissue a retired buffer's name.
  it('a fork after a restore mints past every restored id', () => {
    const h = harness()
    h.buffers.fork(slot(), 'a', 0)
    h.buffers.fork(slot(), 'b', 0)
    const snap = h.buffers.snapshot({})

    const fresh = harness()
    fresh.buffers.restore(snap)
    const next = fresh.buffers.fork(slot(), 'c', 0)

    expect(next).toBe('scratch-3')
  })

  it('a restored buffer warms from its persisted text', () => {
    const h = harness()
    const a = h.buffers.fork(slot(), 'seed', 0)
    h.buffers.setText(a, 'persisted-term')
    const snap = h.buffers.snapshot({})

    const fresh = harness()
    fresh.buffers.restore(snap)
    fresh.buffers.warm(a)

    expect(fresh.lastScratchPost()).toEqual({ src: 'persisted-term', step: 0 })
  })
})
```

- [ ] **Step 2: Run and confirm red**

Run: `cd web && pnpm test tests/node/scratch.test.ts`
Expected: FAIL — `snapshot is not a function`.

- [ ] **Step 3: Implement `snapshot`/`restore` in `web/src/scratch.ts`**

Add the imports these need at the top of the file — `PersistedBuffers` from `./buffers-store` and `LeafId` from `./panes`, both type-only:

```ts
import type { PersistedBuffers } from './buffers-store'
import type { LeafId } from './panes'
```

```ts
  /**
   * Everything about these buffers that survives a reload, with `bindings` supplied by the caller.
   *
   * **THE BINDINGS ARE A PARAMETER BECAUSE THIS CLASS DOES NOT KNOW WHAT A PANE IS**, which is the
   * same line `BufferInfo` draws and the reason `main.ts` computes `paneCount` rather than this file.
   * `PaneCollection` answers which leaf is on which session; this answers what the sessions hold.
   */
  snapshot(bindings: Record<LeafId, SessionId>): PersistedBuffers {
    return {
      minted: this.#minted,
      buffers: [...this.#buffers.values()].map((b) => ({
        id: b.id,
        label: b.label,
        text: b.text,
        collapsed: b.collapsed,
      })),
      bindings,
    }
  }

  /**
   * Insert every buffer in `value` as COLD and set the mint counter — design §4.9 steps 1–2.
   *
   * **NOTHING SPAWNS HERE, AND THAT IS THE RESTORE POLICY RATHER THAN AN OPTIMISATION** (design §4.2).
   * Which buffers deserve a thread is a question about which PANES came back, which this class cannot
   * see; `main.ts` warms the ones its restored bindings name and leaves the orphans asleep.
   *
   * `#minted` TAKES THE STORED COUNTER RATHER THAN THE RESTORED COUNT. A page that forked three
   * buffers and retired two persists `minted: 3` and one buffer, and reissuing `scratch 2` for the
   * next fork would put two different terms under one name across a reload — the exact thing `#minted`
   * only ever counting up exists to prevent.
   */
  restore(value: PersistedBuffers): void {
    this.#minted = value.minted
    for (const b of value.buffers) {
      this.#buffers.set(b.id, { id: b.id, label: b.label, text: b.text, collapsed: b.collapsed, warm: false })
    }
  }
```

`collapsed` is added to `BufferState` here as a plain field defaulting to `false` in `fork`; Task 9 gives it its writer and reader.

- [ ] **Step 4: Add `seedBinding` to `web/src/pane-host.ts`**

In the returned object, beside `seedHost`:

```ts
    /**
     * Record that `leaf` should start on `session`, for a leaf that has no pane yet.
     *
     * **THIS IS `pendingBinding` ANSWERING THE QUESTION IT WAS BUILT FOR, ONE PAGE LOAD EARLIER**
     * (5d-ii-d design §3.3). That map exists to tell a freshly split leaf which session to start on; a
     * RESTORED leaf asks the identical question about an id the tree already holds, and the creation
     * pass's `pendingBinding.get(l.id) ?? SOURCE_SESSION` is already the right answer for every way a
     * restore can fail — a leaf the tree no longer holds, a buffer that failed validation, a buffer the
     * cap would not let warm. No second mechanism, and no repair pass.
     *
     * SEEDED BEFORE THE FIRST `applyLayout()`, for the same reason and at the same moment as
     * `seedLeafCounter`: it is the one point at which ids the app did not mint itself enter.
     */
    seedBinding(leaf: LeafId, session: SessionId): void {
      pendingBinding.set(leaf, session)
    },
```

and add it to the `PaneHost` type.

- [ ] **Step 5: Wire `main.ts`**

5a. Beside `readLayoutStorage`/`writeLayoutStorage`, add the guarded pair. **The writer reports, which is design §4.8 and is where it differs from the layout writer** — the report itself lands in Task 6, so this step leaves a named hook rather than a silent catch:

```ts
  const readBuffersStorage = (): string | null => {
    try {
      return localStorage.getItem(BUFFERS_STORAGE_KEY)
    } catch {
      return null
    }
  }
  /**
   * **THIS WRITER REPORTS WHERE `writeLayoutStorage` SWALLOWS, AND THE ASYMMETRY IS DESIGN §4.8.**
   * That one's comment reads "the layout still works for the rest of this page load, it just will not
   * survive a reload" — a fair trade for a preference. A buffer is WORK, and a user told nothing finds
   * out at the next reload, by absence. `reportStorageFailure` is Task 6's; until then this catch is
   * still silent and is marked as unfinished rather than left looking deliberate.
   */
  const writeBuffersStorage = (raw: string): void => {
    try {
      localStorage.setItem(BUFFERS_STORAGE_KEY, raw)
    } catch {
      reportStorageFailure()
    }
  }
```

5b. Add the persist call, invoked at every moment the payload would change:

```ts
  /**
   * Write the buffers to storage — called at every moment the payload would say something different,
   * and at no others: a fork, a retire, a warm, a cool, a recorded term, and a rebind.
   *
   * THE BINDINGS ARE READ OFF THE PANES AT WRITE TIME rather than tracked separately, because
   * `PaneCollection` already holds them and a second copy is a second thing to be wrong — the same
   * argument `panes.ts` makes for reading bindings through the slot instead of indexing by session.
   */
  const persistBuffers = (): void => {
    const bindings: Record<LeafId, SessionId> = {}
    for (const p of panes.all()) {
      if (p.slot.binding.session !== SOURCE_SESSION) bindings[p.id] = p.slot.binding.session
    }
    writeBuffersStorage(serializeBuffers(scratchpad.snapshot(bindings)))
  }
```

Call `persistBuffers()` from exactly these four sites — named rather than described, because "wherever the payload changes" is the kind of instruction that produces a missed one:

1. **The end of `refreshBuffers()`** in `main.ts`. Its own doc says it is "called at the two moments that number can change, a fork and a retire, and at no other", which is two of the four for free.
2. **The temperature handler** added in Task 4, on both arms — a warm and a cool each change what the payload says.
3. **`onScratchReply`'s `scratch-compiled` arm**, via a new `onBuffersPersist` dependency threaded into `createReplies` alongside its existing ones. This is the text-of-record write from Task 3; without this site a term the user typed is in memory and never in storage.
4. **`transport.ts`'s `rebind` handler** (`:178`), via the same dependency, because a pane moving between sessions changes `bindings` while changing no buffer.

**NOT FROM `draw()`.** It runs per frame during playback, and `JSON.stringify` over every buffer's text sixty times a second is precisely the cost §3.1 split the keys to avoid — reintroduced on a different path.

5c. The restore sequence, placed immediately after `seedLeafCounter(tree)`:

```ts
  /**
   * **RESTORE ORDER — design §4.9, and the order is load-bearing.** Buffers first so that every id a
   * binding could name exists; bindings second, into `pendingBinding`, which the first `applyLayout()`
   * below reads; warming third and last, because it happens per PANE and no pane exists yet.
   *
   * HERE, BESIDE `seedLeafCounter`, FOR ITS REASON: this is the one moment ids the app did not mint
   * itself can enter, and both restores are exactly that.
   */
  const restoredBuffers = parseBuffers(readBuffersStorage())
  if (restoredBuffers !== null) {
    scratchpad.restore(restoredBuffers)
    for (const [leaf, session] of Object.entries(restoredBuffers.bindings)) {
      paneHost.seedBinding(leaf, session)
    }
  }
```

**This block must be placed after `paneHost` is constructed**, since it calls `seedBinding` — move it below the `createPaneHost({...})` call and above `paneHost.seedHost(SOURCE_LEAF, sourceHost)`.

5d. Warm the bound buffers, immediately before the first `applyLayout()`:

```ts
  // **WARM BOUND, COLD ORPHANS — design §4.2's restore policy, and the cap is what makes it a `try`.**
  // A cap that dropped between releases can leave a restored page naming more warm buffers than it may
  // now hold. Refusing is the honest answer (nothing is evicted); the pane falls through to
  // `SOURCE_SESSION` by the creation pass's own `??`, and the buffer stays cold and stays listed, which
  // is exactly the state the header list exists to make reachable.
  if (restoredBuffers !== null) {
    for (const session of new Set(Object.values(restoredBuffers.bindings))) {
      try {
        scratchpad.warm(session)
      } catch (e) {
        if (!(e instanceof BufferCapReached)) throw e
        linkWiring.setForkFailed(e.message)
      }
    }
  }
```

- [ ] **Step 6: Write the browser test**

**READ `tests/browser/layout-restore.test.ts` IN FULL FIRST.** It is the only existing test of a restore-from-storage path through `main()`, and it establishes two constraints this test must obey:

- **ONE MOUNT PER FILE.** ES module imports are cached, so `main()` runs once per page and Vitest gives each test *file* its own page. **A "reload" cannot be simulated by mounting twice.** The restore path is exercised by *seeding the store before the single mount* — which is strictly better, because it tests exactly the bytes a previous page load would have left.
- **A PRIVATE `Storage` SHIM, NOT THE REAL `localStorage`.** It is scoped to an origin and Vitest runs browser files concurrently in one origin, so writing the shared store is visible to every sibling that mounts `main()` — and siblings clearing the key mid-run is the same race from the other side. Copy that file's `cell`/`shim` block and its `Object.defineProperty(window, 'localStorage', ...)` install verbatim.

Create `web/tests/browser/buffer-restore.test.ts`. Both claims — that the app *restores* a payload and that it *writes* one — live in one mount, in this order:

```ts
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from '../../src/buffers-store'
import { LAYOUT_STORAGE_KEY, defaultLayout, serializeLayout } from '../../src/layout'

// SHELL, cell, shim and the localStorage install: copied from `layout-restore.test.ts`. See its doc
// for why the shim is forced rather than fastidious.

/**
 * **THE STATE A PREVIOUS PAGE LOAD WOULD HAVE LEFT: two buffers, one of them bound.**
 * `scratch-1` is an orphan — forked, then the pane moved on — and `scratch-2` is what `lambda-0`
 * was showing. Seeded rather than produced by forking twice, because this file gets ONE mount and
 * the restore path is what is under test.
 */
const SEEDED = serializeBuffers({
  minted: 2,
  buffers: [
    { id: 'scratch-1', label: 'scratch 1', text: '(\\a. a)', collapsed: false },
    { id: 'scratch-2', label: 'scratch 2', text: '(\\b. b) (\\c. c)', collapsed: false },
  ],
  bindings: { 'lambda-0': 'scratch-2' },
})

beforeAll(async () => {
  document.body.innerHTML = SHELL
  shim.setItem(LAYOUT_STORAGE_KEY, serializeLayout(defaultLayout()))
  shim.setItem(BUFFERS_STORAGE_KEY, SEEDED)
  const { main } = await import('../../src/main')
  await main()
})

const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.buffer-list [role="menuitem"], .buffer-list li')]

async function openList(): Promise<HTMLElement[]> {
  document.querySelector<HTMLButtonElement>('#buffers')?.click()
  await until(() => rows().length > 0, 'the buffer list to open')
  return rows()
}

describe('buffers restored from storage', () => {
  it('restores both buffers and warms only the one a pane names', async () => {
    const list = await openList()
    expect(list).toHaveLength(2)
    expect(list[0]?.textContent).toContain('asleep')       // scratch-1, orphaned
    expect(list[1]?.textContent).not.toContain('asleep')   // scratch-2, bound and therefore warmed
  })

  // **THE ASSERTION §3.2's FINDING EARNS.** Before Task 4, `openList()` above threw out of a
  // `beforetoggle` handler on this exact page — a cold buffer reaching an unguarded `legOf`.
  it('the bound pane shows the restored term rather than the sample program', async () => {
    await until(() => document.querySelector('[data-leaf="lambda-0"] .term')?.textContent !== '', 'a term')
    expect(document.querySelector('[data-leaf="lambda-0"] .term')?.textContent).toContain('\\c')
  })

  it('writes a payload naming every buffer, including one forked after the restore', async () => {
    const list = await openList()
    // Warm the orphan from its own row — the only surface temperature has (design §4.2).
    list[0]?.querySelector<HTMLButtonElement>('button')?.click()

    await until(() => {
      const stored = parseBuffers(shim.getItem(BUFFERS_STORAGE_KEY))
      return stored?.buffers.length === 2
    }, 'the store to name both buffers')

    const stored = parseBuffers(shim.getItem(BUFFERS_STORAGE_KEY))
    expect(stored?.minted).toBe(2)
    expect(stored?.bindings['lambda-0']).toBe('scratch-2')
  })
})
```

A second file covers the corrupt-payload fallback, because it needs a *different* seeded value and therefore a different mount. Create `web/tests/browser/buffer-restore-invalid.test.ts` with the same shim, seeding `shim.setItem(BUFFERS_STORAGE_KEY, '{"version":1,"minted":"lots"}')`, and assert:

```ts
it('a corrupt buffers key leaves the page with no buffers and every pane on source', async () => {
  // THE BUTTON IS HIDDEN AT ZERO BUFFERS — `main.ts`'s `refreshBuffers` — which is the assertion.
  expect(document.querySelector<HTMLButtonElement>('#buffers')?.hidden).toBe(true)
  expect(document.querySelector('[data-leaf="lambda-0"] .detached')).toBeNull()
})
```

- [ ] **Step 7: Run and iterate to green**

Run: `cd web && pnpm test tests/browser/buffer-restore.test.ts tests/browser/buffer-restore-invalid.test.ts`

The browser tier is real Chromium — confirm no other vitest process is running first. Expected: PASS.

- [ ] **Step 8: Run the whole suite**

Run: `cd web && pnpm test && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/scratch.ts web/src/main.ts web/src/pane-host.ts web/src/replies.ts web/src/transport.ts web/tests/node/scratch.test.ts web/tests/browser/buffer-restore.test.ts web/tests/browser/buffer-restore-invalid.test.ts
git commit -m "5d-ii-d T5: buffers survive a reload — warm bound, cold orphans

A restored binding is the question pendingBinding was built for, one page load
earlier, so restore seeds that map and the creation pass's existing
?? SOURCE_SESSION is already the right answer for every way a restore can fail.

Buffers restore cold; main.ts warms the ones its restored bindings name. A cap
that dropped between releases refuses the excess, which stays cold and listed
rather than being evicted."
```

---

### Task 5b: One `Storage` per browser test file

**ADDED DURING EXECUTION, 2026-08-16, by the project owner's decision.** Not in the plan's first draft, and the reason it exists is worth keeping: Task 5 made **every** browser test file that mounts the app write `redextape.buffers` unconditionally at start-up (`refreshBuffers()` runs before any pane exists). Before it, only the files that forked a buffer wrote that key.

**`localStorage` is scoped to an ORIGIN, and Vitest runs browser files concurrently in one origin.** So one file's write is visible to every sibling that mounts `main()`. Task 5 mitigated this by having 14 files clear the key in their own setup, and two flakes were reproduced before that mitigation landed (`scratch-cap`, `link-truncated`).

**THE MITIGATION LEAVES A RACE, AND THE WINDOW IS THE WIDEST ONE IN `main()`, NOT THE NARROWEST.** `main()` awaits `init()` — a wasm fetch and instantiation — and the storage reads sit *after* that await. So the gap between a sibling's `removeItem()` and its own read spans the entire wasm load. Clearing a shared key cannot close that; only not sharing the key can.

**Files:**
- Modify: `web/tests/browser/setup.ts` — already wired as `setupFiles` for the browser project (`vite.config.ts:262`), so this needs no new plumbing
- Modify: every browser test file that currently clears a storage key in its own setup (~14), and the three that install a private shim
- Test: the existing browser tier is the test — it must stay green with the per-file clears removed

**Interfaces:**
- Consumes: nothing new.
- Produces: a per-file in-memory `Storage` installed on `window` before any test module body runs, so each file's `localStorage` is its own.

- [ ] **Step 1: Read the three existing shim copies**

Run: `cd web && rg -ln 'cell = new Map' tests/browser/`

`layout-restore.test.ts`, `buffer-restore.test.ts` and `buffer-restore-invalid.test.ts` each carry a ~16-line `cell`/`shim` block, duplicated verbatim. `layout-restore.test.ts`'s doc carries the full argument for why the shim is forced rather than fastidious — **read it, and move that argument to `setup.ts` rather than re-deriving it.** It is the record of why this exists.

- [ ] **Step 2: Install the shim in `web/tests/browser/setup.ts`**

One in-memory `Storage` per file, installed on `window` before any test module body runs. It must be a complete `Storage` — `length`, `clear`, `getItem`, `key`, `removeItem`, `setItem` — because `appearance.ts` reads and writes through it during `main()`.

The doc comment carries: that `localStorage` is origin-scoped and Vitest runs files concurrently in one origin; that the race window is the `await init()` wasm load, so clearing a shared key cannot close it; and that two flakes were reproduced under the clearing mitigation this replaces.

- [ ] **Step 3: Delete what it replaces**

Remove the per-file clears and the three duplicated shim blocks. **Each deletion is a claim that the shim covers that case — check it rather than assuming**, in particular the three files that seed a value *before* mounting: they must seed into the shim, and the shim must already be installed when their module body runs.

Rewrite, do not delete, any doc comment explaining why a file cleared a key: the reason it did is the reason this task exists, and the comment should now point at `setup.ts`.

- [ ] **Step 4: Run the browser tier repeatedly**

Run: `cd web && pnpm test tests/browser/` — **at least five times**, confirming the same count each run.

A single green run is not evidence here: the defect being fixed is non-deterministic, and the two flakes it caused were themselves intermittent. Report every run's count.

- [ ] **Step 5: Full suite, then commit**

Run: `cd web && pnpm test && pnpm run typecheck`

```bash
cd /home/davey/projects/redextape
git add web/tests/browser/
git commit -m "5d-ii-d T5b: one Storage per browser test file, not one per origin

Task 5 made every mounting file write redextape.buffers at start-up, so one
file's write became visible to every sibling. Clearing the key per file was
the mitigation and it leaves a race: main() awaits init(), a wasm fetch, and
the storage reads sit after that await — so the gap between a sibling's
removeItem() and its own read spans the whole wasm load.

Clearing a shared key cannot close that window. Not sharing the key can."
```

---

### Task 6: The quota report

Implements spec §4.8. Small, and separated because it is the one place this slice deliberately breaks symmetry with the layout writer.

**Files:**
- Modify: `web/src/main.ts`
- Test: `web/tests/browser/buffers-quota.test.ts` *(create)*

**Interfaces:**
- Consumes: `linkWiring.setForkFailed` — the same `#link-status` field the cap refusal uses.
- Produces: `reportStorageFailure()` in `main()`, referenced by Task 5's `writeBuffersStorage`.

- [ ] **Step 1: Add the test**

**ITS OWN FILE, FOR THE ONE-MOUNT-PER-FILE REASON TASK 5 STEP 6 RECORDS.** It needs a `shim` whose
`setItem` throws from the moment the app mounts, which is a different store than any other file wants.

Create `web/tests/browser/buffers-quota.test.ts` with `layout-restore.test.ts`'s shim, modified so the
buffers key throws:

```ts
let refuseWrites = false
const shim: Storage = {
  // ...the rest copied from `layout-restore.test.ts`...
  setItem: (k: string, v: string) => {
    // ONLY THE BUFFERS KEY REFUSES. A shim that threw for everything would take `appearance.ts` and
    // the layout writer down with it, and the claim here is about one writer's policy, not about a
    // browser with no storage at all.
    if (refuseWrites && k === BUFFERS_STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError')
    cell.set(k, v)
  },
}

const linkStatus = (): string => document.querySelector('#link-status')?.textContent ?? ''

describe('a full store', () => {
  it('reports once, and the report survives further writes', async () => {
    refuseWrites = true

    // Fork, which persists and therefore fails.
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .detach')?.click()
    await until(() => linkStatus().includes('not being saved'), 'the storage report')

    const first = linkStatus()

    // A second failing write must not restate it — the message is unchanged, not appended to.
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .detach')?.click()
    await new Promise((r) => setTimeout(r, 50))

    expect(linkStatus()).toBe(first)
    expect(linkStatus().match(/not being saved/g)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run and confirm red**

Run: `cd web && pnpm test tests/browser/buffers-quota.test.ts`
Expected: FAIL — no such message.

- [ ] **Step 3: Implement in `web/src/main.ts`**

```ts
  /**
   * Whether the quota failure has already been reported on this page load.
   *
   * **ONCE PER PAGE LOAD, NOT ONCE PER WRITE** (design §4.8). The buffers write sits behind the
   * editor's 300 ms debounce, so a user typing into a full store would otherwise get the same line
   * rewritten every 300 ms — which reads as a fault in the app rather than a fact about the browser,
   * and which would keep overwriting the fork refusals and running-focus reports that share this
   * surface. Once is enough: the condition does not un-happen within a page load, and the user's
   * remedy (clear storage, retire buffers) is outside the app.
   */
  let storageFailureReported = false
  /**
   * Say that buffers are no longer being saved.
   *
   * **`#link-status` RATHER THAN A BANNER**, because it is the surface that already carries the other
   * things this app has to tell a user about a gesture that did not produce a visible change — a
   * refused fork, a refused warm — and `banner.ts` is the wasm-load and worker-spawn failure surface,
   * which this is not. The wording says the CONSEQUENCE and not the cause: `QuotaExceededError` is
   * true and useless, and what the user needs to know is that closing the tab now loses work.
   */
  const reportStorageFailure = (): void => {
    if (storageFailureReported) return
    storageFailureReported = true
    linkWiring.setForkFailed('buffers are not being saved — this browser’s storage for this site is full')
    draw()
  }
```

Place it above `writeBuffersStorage` so the reference resolves.

- [ ] **Step 4: Run and confirm green**

Run: `cd web && pnpm test tests/browser/buffers-quota.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/main.ts web/tests/browser/buffers-quota.test.ts
git commit -m "5d-ii-d T6: a failed buffers write reports, where a failed layout write does not

A layout is a preference and a buffer is work. Once per page load rather than
once per write, because the write sits behind the editor's 300ms debounce and
a line rewritten every 300ms reads as a fault in the app."
```

---

### Task 7: The affordability probe

Implements spec §4.6 and §3.5. **A measurement, not a gate** — its assertions catch a broken measurement and never the threshold.

**Files:**
- Create: `web/tests/browser/affordability-worker.ts`
- Create: `web/tests/browser/buffer-affordability.test.ts`

**Interfaces:**
- Consumes: `pkg/redextape_wasm.js` (`init`, `lambdaScratch`), `FRAME_BYTES`, `HISTORY_BYTES`, `lambdaFrameBytes` from `src/protocol`, `History` from `src/history`.
- Produces: console output only. No `src/` changes; Task 8 consumes the number by hand.

- [ ] **Step 1: Read the harness this reuses**

Run: `cd web && sed -n '1,120p' tests/browser/session-memory.test.ts` and `cat tests/browser/depth-cap-worker.ts`

Reuse `requireHeapHarness`, the forced-collection discipline, the discarded warm-up and the alternating rounds exactly. Do not re-derive why `--enable-precise-memory-info` and `--js-flags=--expose-gc` are needed; that argument lives in `frame-cost.test.ts`.

- [ ] **Step 2: Write the probe worker**

Create `web/tests/browser/affordability-worker.ts`:

```ts
// A worker that holds ONE λ scratch and reports its own wasm linear memory.
//
// **IT EXISTS BECAUSE A WORKER'S MEMORY CANNOT BE READ FROM OUTSIDE IT** (5d-ii-d design §3.5).
// `usedJSHeapSize` is one V8 isolate's figure and a worker has its own;
// `performance.measureUserAgentSpecificMemory` would cross isolates and is `undefined` here because
// Vitest's server is not cross-origin isolated. `session-memory.test.ts` answered that by reading ONE
// main-thread module instance and reasoning about threads arithmetically — which is exactly the
// arithmetic a cap would be derived from, so a cap needs the real N-thread reading instead.
//
// A TEST-ONLY WORKER, ON `depth-cap-worker.ts`'s PRECEDENT, so no message kind is added to
// `protocol.ts` for a measurement's benefit — a request no surface can produce is the fabricated-state
// shape `session.rs:257-273` prices.
import init, { lambdaScratch } from '../../../pkg/redextape_wasm.js'

type Scratch = { stepLambda(): boolean; lambdaState(b: number): unknown }

let ready: Promise<{ memory: WebAssembly.Memory }> | null = null
let held: Scratch | null = null

self.addEventListener('message', async (e: MessageEvent<{ src: string; steps: number; frameBytes: number }>) => {
  const { src, steps, frameBytes } = e.data
  if (!ready) ready = init() as Promise<{ memory: WebAssembly.Memory }>
  const out = await ready

  const { scratch } = lambdaScratch(src) as { scratch: Scratch | null }
  if (!scratch) {
    ;(self as unknown as Worker).postMessage({ outcome: 'no-scratch' })
    return
  }
  let n = 0
  while (n < steps && scratch.stepLambda()) {
    scratch.lambdaState(frameBytes)
    n += 1
  }
  // HELD, NOT FREED — the measurement is of a buffer a user is looking at, which is one that has not
  // been dropped. A freed handle would report the module baseline and nothing else.
  held = scratch
  ;(self as unknown as Worker).postMessage({ outcome: 'ok', steps: n, wasmBytes: out.memory.buffer.byteLength })
})

export {}
```

- [ ] **Step 3: Write the probe**

Create `web/tests/browser/buffer-affordability.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { History } from '../../src/history'
import { FRAME_BYTES, HISTORY_BYTES, lambdaFrameBytes } from '../../src/protocol'
import type { LambdaState } from '../../src/types'

/**
 * 5d-ii-d — THE WORKER-AFFORDABILITY PROBE. Design §4.6.
 *
 * **THE THRESHOLD, PRE-REGISTERED BEFORE ANY NUMBER EXISTED** (design §4.6): *a page at the cap, with
 * every warm buffer holding a real term and its ring driven to exhaustion, must sit at or below
 * 512 MiB — main-thread resident heap plus summed per-thread wasm linear memory. The cap is the largest
 * count that satisfies it. The threshold does not move.*
 *
 * **A MEASUREMENT, NOT A GATE**, exactly as `session-memory.test.ts` says of itself: every assertion
 * below is a loose sanity bound chosen to catch a BROKEN measurement — a zero delta, a run that
 * recorded nothing, a reading in the wrong units — and none of them pins a measured figure or encodes
 * the threshold. A probe that fails the build the first time a browser update moves a heap reading two
 * percent is retired within a week, which is the fate #28 records for a threshold quietly relaxed.
 * The console output IS the deliverable; the number it chose is written where the constant lives.
 */
const BUDGET_BYTES = 512 * 1024 * 1024

/** See `frame-cost.test.ts`'s type of the same name for why this is local and not in `types.ts`. */
type MemoryPerformance = Performance & { memory?: { usedJSHeapSize: number } }
type GlobalWithGc = typeof globalThis & { gc?: () => void }

const heapNow = (): number => (performance as MemoryPerformance).memory?.usedJSHeapSize ?? 0

/** `session-memory.test.ts`'s guard, verbatim in intent: a probe that silently reads zeros is worse than no probe. */
function requireHeapHarness(): () => void {
  if (!(performance as MemoryPerformance).memory) {
    throw new Error('BLOCKED: performance.memory is unavailable in this browser — cannot measure heap size')
  }
  if (heapNow() === 0) {
    throw new Error('BLOCKED: performance.memory.usedJSHeapSize reads 0 — cannot measure heap size')
  }
  const collect = (globalThis as GlobalWithGc).gc
  if (typeof collect !== 'function') {
    throw new Error('BLOCKED: globalThis.gc is unavailable — launch Chromium with --js-flags=--expose-gc')
  }
  return collect
}

/** A term that reduces for a long time — the ring is what is being priced, so it has to be spent. */
const TERM = '(\\f. (\\x. f (x x)) (\\x. f (x x))) (\\g. \\n. g n)'

/** Spawn `n` probe workers, drive each, and answer their summed wasm memory. */
async function wasmBytesFor(n: number): Promise<number> {
  const workers = Array.from(
    { length: n },
    () => new Worker(new URL('./affordability-worker.ts', import.meta.url), { type: 'module' }),
  )
  try {
    const readings = await Promise.all(
      workers.map(
        (w) =>
          new Promise<number>((resolve, reject) => {
            w.addEventListener('message', (e: MessageEvent<{ outcome: string; wasmBytes?: number }>) => {
              if (e.data.outcome !== 'ok') {
                reject(new Error(`BLOCKED: probe worker answered ${e.data.outcome}`))
                return
              }
              resolve(e.data.wasmBytes ?? 0)
            })
            w.addEventListener('error', () => reject(new Error('BLOCKED: probe worker failed to load')))
            w.postMessage({ src: TERM, steps: 20_000, frameBytes: FRAME_BYTES })
          }),
      ),
    )
    return readings.reduce((a, b) => a + b, 0)
  } finally {
    for (const w of workers) w.terminate()
  }
}

/** Fill `n` rings to `HISTORY_BYTES` on the main thread and answer the resident heap they cost. */
function ringBytesFor(n: number, collect: () => void): number {
  collect()
  const before = heapNow()
  const rings: History<LambdaState>[] = []
  for (let i = 0; i < n; i += 1) {
    const ring = new History<LambdaState>(HISTORY_BYTES)
    let charged = 0
    let step = 0
    while (charged < HISTORY_BYTES) {
      const frame: LambdaState = { text: `term-${step}`, spans: [], step }
      ring.push(frame, lambdaFrameBytes(frame))
      charged += lambdaFrameBytes(frame)
      step += 1
    }
    rings.push(ring)
  }
  collect()
  const after = heapNow()
  // HELD ACROSS THE READING, then released by the caller dropping the array.
  void rings.length
  return after - before
}

describe('worker affordability', () => {
  it('measures what a warm buffer costs, and derives the cap from the pre-registered budget', async () => {
    const collect = requireHeapHarness()

    const points: { n: number; wasm: number; rings: number; total: number }[] = []
    for (const n of [1, 2, 4]) {
      const wasm = await wasmBytesFor(n)
      const rings = ringBytesFor(n, collect)
      points.push({ n, wasm, rings, total: wasm + rings })
      console.log(`n=${n}  wasm=${wasm}  rings=${rings}  total=${wasm + rings}`)
    }

    const first = points[0]
    const last = points[points.length - 1]
    if (first === undefined || last === undefined) throw new Error('BLOCKED: no points measured')

    // MARGINAL COST FROM THE TWO ENDS rather than a fit, because three points do not earn a regression
    // and the honest question is what each ADDITIONAL buffer costs.
    const marginal = (last.total - first.total) / (last.n - first.n)
    const derived = Math.floor((BUDGET_BYTES - first.total + marginal) / marginal)
    console.log(`marginal per buffer: ${marginal}  derived cap: ${derived}`)

    // LOOSE SANITY BOUNDS ONLY — these catch a measurement that did not happen, never the threshold.
    expect(first.wasm).toBeGreaterThan(1_000_000)
    expect(marginal).toBeGreaterThan(0)
    expect(derived).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 4: Run the probe and record its output**

Run: `cd web && pnpm test tests/browser/buffer-affordability.test.ts`

Confirm no other vitest process is running on the machine first — this file measures memory, and 5d-ii-b's and 5d-ii-c's entries both recorded that an unrelated vitest process was resident during their runs.

Run it **three times**. Record every line of console output; the run-to-run spread is part of the finding, not noise to discard.

- [ ] **Step 5: Commit**

```bash
cd /home/davey/projects/redextape
git add web/tests/browser/affordability-worker.ts web/tests/browser/buffer-affordability.test.ts
git commit -m "5d-ii-d T7: the affordability probe — N real threads, not one instance times N

A worker's wasm memory cannot be read from outside it and
measureUserAgentSpecificMemory is unavailable without cross-origin isolation,
so session-memory.test.ts read one main-thread instance and multiplied. That
arithmetic is what a cap would be derived from, so this drives N real threads
through a test-only worker on depth-cap-worker.ts's precedent.

Threshold pre-registered before any number: 512 MiB for a page at the cap with
every ring spent. Assertions are sanity bounds, never the threshold."
```

---

### Task 8: The measured cap

Implements spec §4.4. Consumes Task 7's numbers.

**Files:**
- Modify: `web/src/scratch.ts` (`MAX_BUFFERS` → `MAX_WARM_BUFFERS`)
- Modify: every importer — find with `rg -l MAX_BUFFERS web/`
- Test: `web/tests/node/scratch.test.ts`, `web/tests/browser/scratch-cap.test.ts`

**Interfaces:**
- Consumes: the derived cap from Task 7's console output.
- Produces: `MAX_WARM_BUFFERS` replacing `MAX_BUFFERS`. `BufferCapReached` unchanged in kind.

- [ ] **Step 1: Rename, and set the number**

Rename the constant everywhere. **The rename is the point** — every current reader believes it bounds buffers, and it now bounds threads.

Replace its doc entirely. The old one argues for a choice; this one reports a measurement. Include: the derived figure, the three runs' spread, the marginal per-buffer cost, and the threshold verbatim. State whether the number went up or down from eight and say so plainly.

If the derived cap is **below 2**, stop: `tests/browser/two-lambda-panes.test.ts` forks twice inside single tests and needs at least two. Report that and do not proceed — a cap that breaks an existing property is a finding, not a number to ship.

- [ ] **Step 2: Verify at the derived count**

Add a fourth point to Task 7's probe at `n = <derived>` and re-run. **This is what keeps the cap a measurement rather than an extrapolation**, and it is where a non-linearity would show. Record the reading in the constant's doc.

If the measured total at the derived N exceeds the budget, lower the cap until it does not, and record both numbers — the derived and the verified — with the discrepancy named.

- [ ] **Step 3: Update the tests that spell the cap**

Run: `cd web && rg -n 'MAX_BUFFERS' tests/`

They import the constant rather than a literal, so they follow it. Confirm `tests/browser/scratch-cap.test.ts` still exercises the refusal at the new number, and that its refusal-message assertion matches the wording Task 2 changed (`retire or cool one`).

- [ ] **Step 4: Run everything**

Run: `cd web && pnpm test && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/scratch.ts web/tests/
git commit -m "5d-ii-d T8: MAX_BUFFERS becomes MAX_WARM_BUFFERS, and the number is measured

The rename is the point: every reader of the old name believed it bounded
buffers, and it bounds threads now. The figure is derived from the probe
against the pre-registered 512 MiB budget and then re-measured at the derived
count, so it is a measurement rather than an extrapolation."
```

---

### Task 9: Collapse state, per buffer

Implements spec §4.7. Answers the question `pane-chrome.ts:314-316` has now passed on twice.

**Files:**
- Modify: `web/src/pane-chrome.ts` (`PaneEvents` gains `collapse`; `collapseButton`'s falsified doc)
- Modify: `web/src/transport.ts` (`events(slot)` supplies it, `:105`)
- Modify: `web/src/lambda-pane.ts` (`:192` reports the toggle onward)
- Modify: `web/src/main.ts` (seed the initial state when an editor mounts)
- Modify: `web/src/scratch.ts` (`setCollapsed`, `collapsedOf` — the `collapsed` field landed in Task 5)
- Test: `web/tests/browser/buffer-restore.test.ts`

**`PaneEvents` LIVES IN `pane-chrome.ts`, NOT `sessions.ts`** (`transport.ts:3` imports it from there), so this task does not touch the file the Global Constraints put off limits.

**Interfaces:**
- Consumes: `PersistedBuffer.collapsed` (Task 1), `BufferState.collapsed` (Task 5).
- Produces:
  - `PaneEvents` gains `collapse?: (collapsed: boolean) => void`
  - `ScratchBuffers.setCollapsed(id: SessionId, collapsed: boolean): void`
  - `ScratchBuffers.collapsedOf(id: SessionId): boolean`

- [ ] **Step 1: Add the test**

Extend Task 5's seeded payload — **one mount per file, so this rides on the payload already there** rather than mounting again. In `web/tests/browser/buffer-restore.test.ts`, change `SEEDED`'s second buffer to `collapsed: true`, then add:

```ts
it('the restored bound buffer comes back with its editor collapsed', async () => {
  await until(() => document.querySelector('[data-leaf="lambda-0"] .term-editor') !== null, 'an editor')
  expect(document.querySelector('[data-leaf="lambda-0"] .term-editor')?.classList.contains('is-collapsed')).toBe(true)
})

it('expanding it writes the new state back', async () => {
  document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .collapse')?.click()

  await until(() => parseBuffers(shim.getItem(BUFFERS_STORAGE_KEY))?.buffers[1]?.collapsed === false, 'the store')

  expect(parseBuffers(shim.getItem(BUFFERS_STORAGE_KEY))?.buffers[1]?.collapsed).toBe(false)
})
```

- [ ] **Step 2: Run and confirm red**

Run: `cd web && pnpm test tests/browser/buffer-restore.test.ts`
Expected: FAIL — the restored editor is expanded, and nothing writes the flag back.

- [ ] **Step 3: Implement**

3a. `ScratchBuffers` gains the pair:

```ts
  /** Remember whether buffer `id`'s editor is collapsed — design §4.7. */
  setCollapsed(id: SessionId, collapsed: boolean): void {
    const state = this.#buffers.get(id)
    if (state !== undefined) state.collapsed = collapsed
  }

  /** Whether buffer `id`'s editor was collapsed. `false` for an id that is not a buffer. */
  collapsedOf(id: SessionId): boolean {
    return this.#buffers.get(id)?.collapsed ?? false
  }
```

3b. Replace the falsified paragraph in `pane-chrome.ts`'s `collapseButton` doc. It currently reads *"Design §4.2 is explicit that this cannot be read as a feature: 'THE STATE IS NOT PERSISTED... a persisted collapse preference would outlive every session it described' — a scratch is retired and replaced, not resumed, so there is no session for a remembered collapse to describe."* Replace with:

```
 * **THE STATE IS PERSISTED NOW, PER BUFFER, AND THE PARAGRAPH THAT USED TO BE HERE IS WHY IT TOOK
 * THREE SLICES.** It read: *"a persisted collapse preference would outlive every session it described
 * — a scratch is retired and replaced, not resumed, so there is no session for a remembered collapse
 * to describe."* 5d-ii-c made buffers resumable and falsified the premise without answering the
 * question; 5d-ii-d §4.7 answers it. **PER BUFFER AND NOT PER PANE**, because the editor MOVES: a
 * collapse remembered against a leaf would describe whichever buffer landed there next, which is the
 * same class of error the reviewer caught on this control once already, when a remounted editor came
 * back reading "show the term editor" over an editor that was already showing. The flag rides with the
 * term, and the reset below still fires on an unmount — a buffer that comes back collapsed is told so
 * by its own record, not by a flag that survived in a closure.
```

3c. Give the toggle somewhere to go. In `web/src/pane-chrome.ts`, add to `PaneEvents`:

```ts
  /**
   * This pane's editor was collapsed or expanded.
   *
   * OPTIONAL, LIKE `detach` AND `showEditor` BESIDE IT, because a TM pane has no editor to collapse
   * and a handler it can never fire is a parameter pretending to be a capability.
   *
   * IT REPORTS THE GESTURE AND DOES NOT PERFORM IT. `collapseButton`'s own callback still toggles
   * `.is-collapsed` on the editor host — the presentation is unchanged and stays local — and this is
   * the app being told, so it can record the state against the BUFFER (5d-ii-d §4.7) rather than
   * against the pane the editor happens to be mounted in today.
   */
  collapse?: (collapsed: boolean) => void
```

In `web/src/transport.ts`'s `events(slot)` (`:105`), supply it — the session is in scope there, which is the whole reason this route rather than a callback threaded through `pane-host.ts`:

```ts
    collapse: (collapsed: boolean) => {
      // NO `draw()`. The class toggle already happened in the pane and nothing else on screen depends
      // on this flag — `deps.onBuffersPersist()` is the entire consequence, which is Task 5's writer.
      scratchpad.setCollapsed(slot.binding.session, collapsed)
      onBuffersPersist()
    },
```

In `web/src/lambda-pane.ts:192`, forward it:

```ts
    this.#collapse = collapseButton(this.#strip.el, (collapsed) => {
      this.#editorHost.classList.toggle('is-collapsed', collapsed)
      on.collapse?.(collapsed)
    })
```

3d. Seed the initial state where the editor is mounted. `LambdaPane.setEditor` sets `#editorHost.className = 'term-editor'` with no `.is-collapsed` — which is what makes a restored buffer come back expanded. Add a parameter rather than a second method, so the class assignment stays in one place:

```ts
  setEditor(text: string | null, collapsed = false): void {
    // ...existing body, with the class assignment becoming:
    this.#editorHost.className = collapsed ? 'term-editor is-collapsed' : 'term-editor'
    // ...and the existing `this.#collapse.update(true)` unchanged.
  }
```

Its caller is `replies.ts`'s `scratch-compiled` arm, which already has the session in scope:

```ts
        home?.setEditor(reply.text, scratchpad.collapsedOf(session))
```

**`collapseButton`'s OWN `collapsed` FLAG MUST AGREE WITH THE CLASS IT ARRIVES WITH.** The control resets that flag on unmount (its own doc records the review that found it reading the previous pane's state); a mount that arrives already collapsed needs the button to say "show the term editor". Pass the initial state into `collapseButton`'s `update` call on the same path, or the label names a state the host contradicts — which is the exact fault that doc block was written for.

- [ ] **Step 4: Run and confirm green**

Run: `cd web && pnpm test tests/browser/buffer-restore.test.ts tests/browser/pane-chrome-collapse.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and coverage**

Run: `cd web && pnpm test && pnpm run typecheck && pnpm test:coverage`
Expected: PASS, and all four coverage figures at or above 95 / 89 / 97 / 97. If any is below, add tests for the uncovered paths whose failure costs most — do not lower a floor.

- [ ] **Step 6: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/pane-chrome.ts web/src/lambda-pane.ts web/src/transport.ts web/src/replies.ts web/src/main.ts web/src/scratch.ts web/tests/browser/buffer-restore.test.ts
git commit -m "5d-ii-d T9: the collapse state is remembered, per buffer

pane-chrome.ts declined to persist it because 'a scratch is retired and
replaced, not resumed'. 5d-ii-c made buffers resumable and falsified that
without answering it; this answers it.

Per buffer and not per pane, because the editor moves: a collapse remembered
against a leaf would describe whichever buffer landed there next."
```

---

## Closing the branch

- [ ] Run `pnpm test` and record the count and file count. Do **not** carry forward the 547/56 baseline as if freshly measured — this repo has shipped a stale closing count twice and corrected it twice.
- [ ] Run `pnpm test:coverage` and record all four figures.
- [ ] Run `wc -l src/scratch.ts src/main.ts src/buffers-store.ts src/buffer-list.ts` and record against `560d465`.
- [ ] Write the roadmap closing entry in `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, including: the measured cap and its three-run spread, whether the threshold moved the number up or down from eight, §3.2's crash as the finding that outranks the feature, and a **what this slice could not establish** section.
- [ ] Add the two accessibility items from spec §6.3 to the standing list in the roadmap, with their instances. **Verify their CONTENT after writing, not only their presence** — 5d-ii-c's entry claimed an item it had only checked existed, and two clauses describing its opposite survived.
