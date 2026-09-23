import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LspUnavailable } from '../../src/lsp-client'
import type { LspDiagnostic } from '../../src/lsp-protocol'
import { harness, OUT } from './lsp-fake-port'

describe('starting up', () => {
  it('declares hierarchicalDocumentSymbolSupport, which the outline tree depends on', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    const init = h.port().at(0)
    expect(init.method).toBe('initialize')
    const caps = init.params.capabilities as {
      textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: boolean } }
    }
    expect(caps.textDocument.documentSymbol.hierarchicalDocumentSymbolSupport).toBe(true)
    // Without this the server answers the flat SymbolInformation[], which has no `children`.
  })

  /**
   * **THE WHOLE REASON `web/` HOLDS NO MARKDOWN RENDERER FOR A TOOLTIP.** The server renders
   * markdown only for a client that asks (`LspClient`'s own `initialize` comment states this), so
   * dropping this capability, misspelling `contentFormat`, or asking for `['markdown']` all silently
   * change what the wire carries with nothing here to catch it — the three `hover()` tests in
   * `lsp-hover.test.ts` only exercise `hover()` after startup and never read `initialize`'s params.
   */
  it('advertises plaintext-only hover, which is why no markdown renderer lives here', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    const init = h.port().at(0)
    expect(init.method).toBe('initialize')
    const caps = init.params.capabilities as { textDocument: { hover: { contentFormat: string[] } } }
    expect(caps.textDocument.hover.contentFormat).toEqual(['plaintext'])
  })

  it('queues messages until the worker says it is ready, rather than dropping them', () => {
    const h = harness()
    h.client.start()
    h.open('redextape:///view/v1.rxt', 'redextape', 'let x = 1;')
    // The module has not instantiated, so nothing has crossed yet.
    expect(h.port().sent).toHaveLength(0)

    h.port().reply({ kind: 'ready' })
    expect(h.port().methods()).toEqual(['initialize', 'initialized', 'textDocument/didOpen'])
  })
})

describe('request correlation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a request with its own response', async () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    h.open('redextape:///view/v1.rxt', 'redextape', 'let x = 1;')

    const pending = h.client.documentSymbols('redextape:///view/v1.rxt')
    const id = h.port().sentMessage('textDocument/documentSymbol').id as number
    expect(id).toBeDefined()
    h.port().reply(OUT([{ jsonrpc: '2.0', id, result: [{ name: 'fact', kind: 12 }] }]))

    await expect(pending).resolves.toEqual([{ name: 'fact', kind: 12 }])
  })

  it('drops a response whose request is not pending, rather than throwing', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    // A restarted worker can answer a request the previous instance was sent.
    expect(() => h.port().reply(OUT([{ jsonrpc: '2.0', id: 9999, result: null }]))).not.toThrow()
  })

  it('rejects a request the server answered with an error', async () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    const pending = h.client.format('redextape:///view/v1.rxt')
    const id = h.port().sentMessage('textDocument/formatting').id as number
    h.port().reply(OUT([{ jsonrpc: '2.0', id, error: { code: -32601, message: 'MethodNotFound' } }]))
    await expect(pending).rejects.toThrow('MethodNotFound')
  })
})

describe('the null-versus-empty normalisation', () => {
  /**
   * **THE DEFECT THE DESIGN SHIPPED AND A TEST CAUGHT.** `Server::formatting` builds an
   * `Option<Vec<TextEdit>>`, so a document that does not parse answers `"result": null`. The spec
   * said the server produced an empty edit list. A client that mapped over the result would throw on
   * the single most likely buffer: one being typed into.
   */
  it('turns a null formatting result into no edits', async () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    const pending = h.client.format('redextape:///view/v1.rxt')
    const id = h.port().sentMessage('textDocument/formatting').id as number
    h.port().reply(OUT([{ jsonrpc: '2.0', id, result: null }]))
    await expect(pending).resolves.toEqual([])
  })

  it('turns a null definition result into null, which is an ordinary answer', async () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    const pending = h.client.definition('redextape:///view/v1.rxt', { line: 0, character: 0 })
    const id = h.port().sentMessage('textDocument/definition').id as number
    h.port().reply(OUT([{ jsonrpc: '2.0', id, result: null }]))
    await expect(pending).resolves.toBeNull()
  })
})

describe('diagnostics', () => {
  it("routes a publishDiagnostics notification to that document's own sink", () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    h.open('redextape:///view/v1.rxt', 'redextape', 'let x = ;')
    const ds: LspDiagnostic[] = [
      {
        range: { start: { line: 0, character: 8 }, end: { line: 0, character: 9 } },
        severity: 1,
        message: 'expected an expression',
      },
    ]
    h.port().reply(
      OUT([
        {
          jsonrpc: '2.0',
          method: 'textDocument/publishDiagnostics',
          params: { uri: 'redextape:///view/v1.rxt', diagnostics: ds },
        },
      ]),
    )
    expect(h.diagnostics).toEqual([['redextape:///view/v1.rxt', ds]])
  })

  /**
   * **THE ASSERTION ABOVE PASSES WITH ONE DOCUMENT OPEN EVEN IF EVERY SINK IS CALLED.** With two
   * open, a broadcast shows up as the other document's sink firing too.
   */
  it("does not deliver one document's diagnostics to another's sink", () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    h.open('redextape:///view/v1.rxt', 'redextape', 'let x = ;')
    h.open('redextape:///view/v2.tm', 'redextape_tm', 'tapes 1\n')

    const ds: LspDiagnostic[] = [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1,
        message: 'only for v2',
      },
    ]
    h.port().reply(
      OUT([
        {
          jsonrpc: '2.0',
          method: 'textDocument/publishDiagnostics',
          params: { uri: 'redextape:///view/v2.tm', diagnostics: ds },
        },
      ]),
    )
    expect(h.diagnostics).toEqual([['redextape:///view/v2.tm', ds]])
  })

  it('drops diagnostics for a document that was closed while they were in flight', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    h.open('redextape:///view/v1.rxt', 'redextape', 'let x = ;')
    h.client.closeDocument('redextape:///view/v1.rxt')

    expect(() =>
      h.port().reply(
        OUT([
          {
            jsonrpc: '2.0',
            method: 'textDocument/publishDiagnostics',
            params: { uri: 'redextape:///view/v1.rxt', diagnostics: [] },
          },
        ]),
      ),
    ).not.toThrow()
    expect(h.diagnostics).toHaveLength(0)
  })
})

describe('documents', () => {
  it('bumps the version on every change, because textDocumentSync is Full', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    h.open('redextape:///view/v1.rxt', 'redextape', 'a')
    h.client.changeDocument('redextape:///view/v1.rxt', 'ab')
    h.client.changeDocument('redextape:///view/v1.rxt', 'abc')
    const changes = h
      .port()
      .parsed()
      .filter((m) => m.method === 'textDocument/didChange')
    expect(changes.map((c) => (c.params.textDocument as { version: number }).version)).toEqual([2, 3])
    const last = changes[1]
    if (last === undefined) throw new Error('expected two didChange messages')
    expect((last.params.contentChanges as { text: string }[])[0]?.text).toBe('abc')
  })

  it('ignores a change to a document that was never opened', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    h.client.changeDocument('redextape:///view/ghost.rxt', 'x')
    expect(h.port().methods()).not.toContain('textDocument/didChange')
  })

  it('drops a closed document from the replay set, not only from the server', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    h.open('redextape:///view/v1.rxt', 'redextape', 'a')
    expect(h.client.openDocumentCount).toBe(1)
    h.client.closeDocument('redextape:///view/v1.rxt')
    expect(h.client.openDocumentCount).toBe(0)
    // Otherwise a restart would reopen it into the new worker after its view was gone, and publish
    // diagnostics to a URI nothing routes.
  })
})

describe('when the worker dies', () => {
  it('restarts once and replays every open document as didOpen', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    h.open('redextape:///view/v1.rxt', 'redextape', 'let x = 1;')
    h.open('redextape:///view/v2.tm', 'redextape_tm', 'tapes 1\n')
    const first = h.port()

    first.crash()

    expect(first.terminated).toBe(true)
    expect(h.ports).toHaveLength(2)
    const second = h.port()
    second.reply({ kind: 'ready' })
    // A fresh server has no document, so a change would name a URI it has never seen.
    const opens = second.parsed().filter((m) => m.method === 'textDocument/didOpen')
    expect(opens.map((o) => (o.params.textDocument as { uri: string }).uri)).toEqual([
      'redextape:///view/v1.rxt',
      'redextape:///view/v2.tm',
    ])
    expect(h.client.available).toBe(true)
    expect(h.notices.some((n) => n.includes('restarted'))).toBe(true)
  })

  it('rejects every pending request rather than leaving it hanging forever', async () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    const pending = h.client.format('redextape:///view/v1.rxt')
    h.port().crash()
    await expect(pending).rejects.toBeInstanceOf(LspUnavailable)
  })

  it('stays off after a second death instead of looping', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    h.port().crash()
    h.port().reply({ kind: 'ready' })
    h.port().crash()

    expect(h.client.available).toBe(false)
    // Two workers were made; the second death makes no third.
    expect(h.ports).toHaveLength(2)
    expect(h.notices.some((n) => n.includes('off'))).toBe(true)
  })

  it('refuses new requests once it is off', async () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    h.port().crash()
    h.port().crash()
    await expect(h.client.format('redextape:///view/v1.rxt')).rejects.toBeInstanceOf(LspUnavailable)
  })
})

describe('when the module will not load at all', () => {
  it('does not restart, because a second worker would fetch the same bytes', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'failed', reason: 'fetch failed' })

    expect(h.client.available).toBe(false)
    expect(h.ports).toHaveLength(1)
    expect(h.notices.some((n) => n.includes('could not be loaded'))).toBe(true)
  })
})

describe('events from a worker that is already dead', () => {
  /**
   * **A DEAD WORKER'S LISTENERS CANNOT BE REMOVED, AND `terminate()` CANNOT UNQUEUE EVENTS ALREADY
   * DISPATCHED.** A wasm panic in `handle` throws out of the worker's message handler, and the
   * client routinely has several messages in flight, so two `error` events from one worker is the
   * ordinary shape of a panic rather than an exotic case. Before the port check this killed the
   * replacement: `ports[1].terminated === true` and `available === false` after ONE death.
   */
  it('do not terminate the healthy replacement', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    const first = h.port()

    first.crash()
    first.crash()

    expect(h.ports).toHaveLength(2)
    expect(h.port().terminated, 'the replacement was terminated by the dead worker').toBe(false)
    expect(h.client.available, 'one worker death turned the client off').toBe(true)
    expect(h.notices.filter((n) => n.includes('off'))).toHaveLength(0)
  })

  it('do not turn the client off through a stale `failed`', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    const first = h.port()
    first.crash()

    // Worker 1's module-load failure arriving after worker 2 has replaced it.
    first.reply({ kind: 'failed', reason: 'stale' })

    expect(h.client.available).toBe(true)
    expect(h.ports).toHaveLength(2)
  })
})

describe('the restart notice', () => {
  it('waits until the replacement is ready, so it is true when it is said', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    h.port().crash()

    // The replacement has been spawned but has not instantiated yet.
    expect(
      h.notices.some((n) => n.includes('back')),
      'announced before the replacement was ready',
    ).toBe(false)

    h.port().reply({ kind: 'ready' })
    expect(h.notices.some((n) => n.includes('back'))).toBe(true)
  })

  it('is never said at all when the replacement cannot load', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    h.port().crash()
    h.port().reply({ kind: 'failed', reason: 'fetch failed' })

    expect(h.notices.some((n) => n.includes('back'))).toBe(false)
    expect(h.client.available).toBe(false)
  })
})

describe('resource release', () => {
  it('terminates the worker when its module fails to load', () => {
    const h = harness()
    h.client.start()
    const only = h.port()
    only.reply({ kind: 'failed', reason: 'fetch failed' })
    // Once `#port` is null nothing can terminate it, so the thread would stay resident for the life
    // of the page.
    expect(only.terminated).toBe(true)
  })
})

describe('a malformed notification', () => {
  it('is ignored rather than thrown out of the message handler', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    // `LspNotification.params` is optional on the type; the server always sends it today.
    expect(() => h.port().reply(OUT([{ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics' }]))).not.toThrow()
    expect(h.diagnostics).toHaveLength(0)
  })
})

describe('a request made before start()', () => {
  it('rejects rather than queueing forever', async () => {
    const h = harness()
    // Deliberately no `start()`. `#send` would queue this and nothing would ever reject it.
    await expect(h.client.format('redextape:///view/v1.rxt')).rejects.toBeInstanceOf(LspUnavailable)
  })
})
