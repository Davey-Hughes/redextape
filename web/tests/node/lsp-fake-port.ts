import { LspClient, type LspPort } from '../../src/lsp-client'
import type { LspDiagnostic, LspOutgoing, LspReplyMessage, LspRequestMessage } from '../../src/lsp-protocol'

/**
 * The `LspClient` fake-port harness, shared by every test file that drives the client without a
 * real worker.
 *
 * **EXTRACTED RATHER THAN DUPLICATED.** `lsp-client.test.ts` owns the lifecycle, correlation and
 * restart rules and needed this harness first; `lsp-hover.test.ts` needs the identical harness for
 * one more method, and a second `FakePort` would drift from the first the moment either one grew a
 * case the other didn't. `tests/browser/harness.ts` sets the precedent for pulling a fixture out of
 * its first test file once a second one needs it.
 *
 * **NOT COLLECTED AS A TEST** — the node project's `include` in `vite.config.ts` covers only files
 * whose names end in `.test.ts`, and this one does not.
 */

/**
 * A worker that records rather than runs — the whole reason `LspPort` is an interface and not
 * `Worker`. Every rule in `lsp-client.ts` is logic, and none of it needs a thread or wasm.
 */
export class FakePort implements LspPort {
  sent: LspRequestMessage[] = []
  terminated = false
  #onMessage: ((e: { data?: LspReplyMessage }) => void)[] = []
  #onError: (() => void)[] = []

  postMessage(m: LspRequestMessage): void {
    this.sent.push(m)
  }

  addEventListener(type: 'message' | 'error', handler: (e: { data?: LspReplyMessage }) => void): void {
    if (type === 'message') this.#onMessage.push(handler)
    else this.#onError.push(handler as unknown as () => void)
  }

  terminate(): void {
    this.terminated = true
  }

  /** Drive a reply in from the worker side. */
  reply(m: LspReplyMessage): void {
    for (const h of this.#onMessage) h({ data: m })
  }

  /** Fire the worker's `error` event — an uncaught throw on that thread. */
  crash(): void {
    for (const h of this.#onError) h()
  }

  /** Every message sent so far, parsed. */
  parsed(): { method?: string; id?: number; params: Record<string, unknown> }[] {
    return this.sent.map((m) => JSON.parse(m.json))
  }

  /** The one message with `method`, or a throw naming what was actually sent. */
  sentMessage(method: string): { method?: string; id?: number; params: Record<string, unknown> } {
    const m = this.parsed().find((x) => x.method === method)
    if (m === undefined) throw new Error(`no ${method} was sent; sent: ${this.methods().join(', ')}`)
    return m
  }

  /** The nth message sent, or a throw. */
  at(i: number): { method?: string; id?: number; params: Record<string, unknown> } {
    const m = this.parsed()[i]
    if (m === undefined) throw new Error(`no message at ${i}; sent ${this.sent.length}`)
    return m
  }

  methods(): string[] {
    return this.parsed().map((m) => m.method ?? '(response)')
  }
}

/** Build a client over a fresh port, and hand back both plus the sinks' recordings. */
export function harness() {
  const ports: FakePort[] = []
  /** Every diagnostic set any document received, tagged with the URI whose sink took it. */
  const diagnostics: [string, LspDiagnostic[]][] = []
  const notices: string[] = []
  const client = new LspClient(
    () => {
      const p = new FakePort()
      ports.push(p)
      return p
    },
    (t) => notices.push(t),
  )
  /** Open a document whose sink records under its own URI, so misrouting is visible. */
  const open = (uri: string, languageId: Parameters<typeof client.openDocument>[1], text: string): void => {
    client.openDocument(uri, languageId, text, { diagnostics: (ds) => diagnostics.push([uri, ds]) })
  }
  // `noUncheckedIndexedAccess` is on, and a test that silently reads `undefined` here would assert
  // against nothing. Throwing names the mistake at the line that made it.
  const port = (): FakePort => {
    const p = ports[ports.length - 1]
    if (p === undefined) throw new Error('no port has been spawned — call client.start() first')
    return p
  }
  return { client, ports, diagnostics, notices, port, open }
}

export const OUT = (messages: LspOutgoing[]): LspReplyMessage => ({ kind: 'out', messages })
