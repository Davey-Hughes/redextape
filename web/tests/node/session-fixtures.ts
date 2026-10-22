import type { Leg, RunReply, RunRequest } from '../../src/protocol'
import type { ClientPort, PoolPort } from '../../src/session-client'
import { SessionClient } from '../../src/session-client'
import type { LegFrame, PaneSlot, PaneView, SessionRegistry } from '../../src/sessions'
import type { LambdaState } from '../../src/types'

/** A `ClientPort` with no thread behind it — `SessionEntry` needs a client and nothing here posts. */
export function fakeClient(): SessionClient {
  const port: ClientPort = {
    postMessage: (_m: RunRequest) => undefined,
    addEventListener: (_t: 'message', _h: (e: { data: RunReply }) => void) => undefined,
  }
  return new SessionClient(port, () => undefined)
}

/** A λ frame whose only distinguishing feature is its text — which is the whole discriminator here. */
export const lambdaFrame = (text: string, step = 0): LambdaState => ({
  text,
  spans: new Uint8Array(),
  cut: null,
  step,
  redex_span: null,
  owner: 'None',
})

/**
 * A `PoolPort` with no thread behind it.
 *
 * THE WHOLE POINT OF `ClientPort` BEING STRUCTURAL (`session-client.ts`), one type up: the pool
 * is a map, a spawn on first bind and a `terminate` on unbind, and none of that needs a worker to
 * exercise. `terminated` is a COUNT rather than a boolean so a double-terminate is visible — the
 * failure a `has`-then-`delete` written in the wrong order would produce.
 */
export type FakePort = PoolPort & { sent: RunRequest[]; terminated: number; deliver: (r: RunReply) => void }

export function fakePort(): FakePort {
  let handler: ((e: { data: RunReply }) => void) | null = null
  const p: FakePort = {
    sent: [],
    terminated: 0,
    postMessage: (m: RunRequest) => p.sent.push(m),
    addEventListener: (_t: 'message', h: (e: { data: RunReply }) => void) => {
      handler = h
    },
    terminate: () => {
      p.terminated += 1
    },
    deliver: (r: RunReply) => handler?.({ data: r }),
  }
  return p
}

/** A `no-session` reply to the run `gen`, with no diagnostics. */
export const noSessionReply = (gen: number): RunReply => ({ kind: 'no-session', gen, diagnostics: [] })

/** `draw.ts`'s per-pane loop, for one slot: resolve once, then paint from what was resolved. */
export const paint = <K extends Leg>(reg: SessionRegistry, slot: PaneSlot<K>, pane: PaneView<LegFrame[K]>) =>
  slot.render(reg, pane, slot.resolve(reg))
