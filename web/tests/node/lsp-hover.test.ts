import { describe, expect, it } from 'vitest'
import type { LspHover } from '../../src/lsp-protocol'
import { harness, OUT } from './lsp-fake-port'

const URI = 'redextape:///view/v1.rxt'
const POSITION = { line: 2, character: 5 }

describe('hover', () => {
  /**
   * **THE PARAMS ARE CHECKED, NOT JUST THAT SOMETHING WAS SENT.** A client that sent
   * `textDocument/hover` with the wrong shape — `position` at the top level instead of nested, or
   * `uri` under the wrong key — would still pass a test that only checked the method name.
   */
  it('sends textDocument/hover with the document uri and cursor position', () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    // Not awaited: this test is about what crosses the wire, not what the promise resolves to.
    void h.client.hover(URI, POSITION)
    const sent = h.port().sentMessage('textDocument/hover')
    expect(sent.params).toEqual({ textDocument: { uri: URI }, position: POSITION })
  })

  /**
   * `null` is the ordinary answer for a cursor on whitespace or a keyword, not a failure.
   *
   * **GRABBING THE ID OFF `sentMessage` IS WHAT KEEPS THIS FROM PASSING A CLIENT THAT NEVER SENDS
   * THE REQUEST AT ALL.** `sentMessage` throws if `textDocument/hover` was never posted, so a
   * `hover()` that silently returned `null` without going to the wire would fail here before the
   * `resolves.toBeNull()` assertion is ever reached.
   */
  it('turns a null hover result into null, rather than throwing', async () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    const pending = h.client.hover(URI, POSITION)
    const id = h.port().sentMessage('textDocument/hover').id as number
    h.port().reply(OUT([{ jsonrpc: '2.0', id, result: null }]))
    await expect(pending).resolves.toBeNull()
  })

  /**
   * **DISTINCT FROM THE NULL CASE ABOVE**, because a `hover()` that ignored the response and always
   * resolved `null` would pass that test but not this one.
   */
  it('resolves a hover result to the contents the server sent', async () => {
    const h = harness()
    h.client.start()
    h.port().reply({ kind: 'ready' })
    const pending = h.client.hover(URI, POSITION)
    const id = h.port().sentMessage('textDocument/hover').id as number
    const hover: LspHover = {
      contents: { kind: 'plaintext', value: 'fn fact(n: Int) -> Int' },
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } },
    }
    h.port().reply(OUT([{ jsonrpc: '2.0', id, result: hover }]))
    await expect(pending).resolves.toEqual(hover)
  })
})
