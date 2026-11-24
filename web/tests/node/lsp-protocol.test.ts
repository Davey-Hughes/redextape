import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { documentUri, EXTENSION_OF_LANGUAGE, isResponse, LANGUAGE_IDS } from '../../src/lsp-protocol'

const LANGUAGE_RS = fileURLToPath(new URL('../../../crates/redextape-lsp/src/language.rs', import.meta.url))

describe('the language ids the client sends', () => {
  /**
   * **A CONTRACT WHOSE BREACH IS SILENT.** `Language::from_language_id` answers `None` for an id it
   * does not match, and every language request then returns empty — no error, no console warning,
   * and on screen a file with no problems in it.
   *
   * Read out of the Rust source rather than restated, so this fails when the server's list changes
   * rather than when someone remembers to update a copy. **A SUBSET, NOT AN EQUALITY**: the server
   * matches the languages of every grammar the repository ships, and the app sends only the source's.
   */
  it('are each an id `Language::from_language_id` matches', () => {
    const rust = readFileSync(LANGUAGE_RS, 'utf8')
    const body = rust.slice(rust.indexOf('pub fn from_language_id'))
    const end = body.indexOf('\n    }')
    // Every `"id" => Some(...)` arm in the match, in source order.
    const arms = [...body.slice(0, end).matchAll(/"([a-z_]+)"\s*=>\s*Some\(/g)].map((m) => m[1])

    expect(arms.length, 'the parse found no arms — the match block has been reshaped').toBeGreaterThan(0)
    expect(arms).toEqual(expect.arrayContaining([...LANGUAGE_IDS]))
  })

  it('each have an extension', () => {
    for (const id of LANGUAGE_IDS) expect(EXTENSION_OF_LANGUAGE[id]).toBeTruthy()
  })
})

describe('document URIs', () => {
  it('are per view, so two views on one language are two documents', () => {
    expect(documentUri('v1', 'redextape')).not.toEqual(documentUri('v2', 'redextape'))
  })

  it('carry the language extension', () => {
    expect(documentUri('v1', 'redextape')).toBe('redextape:///view/v1.rxt')
  })
})

describe('isResponse', () => {
  it('splits on the presence of an id, which is what JSON-RPC uses', () => {
    expect(isResponse({ jsonrpc: '2.0', id: 1, result: null })).toBe(true)
    expect(isResponse({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: {} })).toBe(false)
  })
})
