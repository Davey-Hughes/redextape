import type { LeafId } from './panes'
import type { Leg } from './protocol'
import type { SessionId } from './session-client'

/**
 * The `localStorage` key the scratch buffers are stored under.
 *
 * NAMESPACED, for the reason `appearance.ts`'s `STORAGE_KEY` gives and `layout.ts` repeats:
 * `localStorage` is scoped to an origin and not to an app, so every dev server on the same host shares
 * one store.
 *
 * A SECOND KEY RATHER THAN A FIELD IN `redextape.layout`, AND THE REASON IS A MEASUREMENT RATHER THAN
 * TASTE (design §3.1). `layout-view.ts`'s `divider` binds `pointermove` to `ResizeHandlers.resize`,
 * which touches only the dragged split's `sizes` and never persists — that is what makes a drag's
 * frames cheap. It is `pointerup`, calling `ResizeHandlers.commit`, that reaches `pane-host.ts`'s
 * `applyLayout` — ending in `writeLayoutStorage(serializeLayout(getTree()))` — once per gesture, and
 * every other layout change (a split, a close, a rebind, `reset layout`) reaches the same writer just
 * as directly. A fork's seed is printed at `LAMBDA_BYTE_BUDGET` — 65,536 bytes — so buffer text behind
 * that key would put a few hundred kilobytes through `JSON.stringify` on every one of those ordinary
 * gestures, not only a drag. Two keys keeps the layout write exactly as cheap as it is today and needs
 * no change to that path.
 */
export const BUFFERS_STORAGE_KEY = 'redextape.buffers'

/**
 * Bumped when the stored shape changes. A mismatch falls back to nothing rather than migrating.
 *
 * **2, AS OF 5d-iv T5** — `PersistedBuffer` gained `leg`, a field a `version: 1` payload never wrote.
 * Refusing one under `parseBuffers`' own rule (this file's own doc: "a failed read is silent... it is
 * indistinguishable from a first visit") is what a stale-shape payload gets, same as any other
 * pre-existing hazard this function refuses rather than migrates.
 */
export const BUFFERS_VERSION = 2

/**
 * One buffer as it survives a reload: what it is called, what it holds, how it was displayed, and
 * which leg its session was built on.
 *
 * `leg` RIDES THIS RECORD RATHER THAN `bindings` — `bindings: Record<LeafId, SessionId>` says which
 * BUFFER a leaf was on, and a leaf's own leg is a fact about the TREE (`layout.ts`), not about the
 * buffer; this field is the fact `restore` needs to rebuild the right kind of session for a buffer
 * BEFORE any leaf's binding is even read.
 */
export type PersistedBuffer = {
  id: SessionId
  label: string
  text: string
  collapsed: boolean
  leg: Leg
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
  if (n.leg !== 'lambda' && n.leg !== 'tm') return false
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
