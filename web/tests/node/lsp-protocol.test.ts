import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { documentUri, EXTENSION_OF_LANGUAGE, isResponse, LANGUAGE_IDS, LANGUAGE_OF_PANE } from '../../src/lsp-protocol'

const LANGUAGE_RS = fileURLToPath(new URL('../../../crates/redextape-lsp/src/language.rs', import.meta.url))

describe('the language ids the client sends', () => {
  /**
   * **THE ONE CONTRACT IN PART 3 WHOSE BREACH IS SILENT.** `Language::from_language_id` answers
   * `None` for an id it does not match, and every language request then returns empty — no error, no
   * console warning, and on screen a file with no problems in it. It cost the part 3 design a round
   * of measurements that read nine times too fast.
   *
   * Read out of the Rust source rather than restated, so this fails when the server's list changes
   * rather than when someone remembers to update a copy.
   */
  it('are exactly the ids `Language::from_language_id` matches', () => {
    const rust = readFileSync(LANGUAGE_RS, 'utf8')
    const body = rust.slice(rust.indexOf('pub fn from_language_id'))
    const end = body.indexOf('\n    }')
    // Every `"id" => Some(...)` arm in the match, in source order.
    const arms = [...body.slice(0, end).matchAll(/"([a-z_]+)"\s*=>\s*Some\(/g)].map((m) => m[1])

    expect(arms.length, 'the parse found no arms — the match block has been reshaped').toBeGreaterThan(0)
    expect([...LANGUAGE_IDS].sort()).toEqual([...arms].sort())
  })

  it('cover every pane kind that has an editor, and every id has an extension', () => {
    // `PaneKind` is 'source' | 'lambda' | 'tm'. asm has no editor until part 5, so it is in
    // LANGUAGE_IDS (the server serves it) but not in LANGUAGE_OF_PANE (nothing mounts it).
    expect(Object.keys(LANGUAGE_OF_PANE).sort()).toEqual(['lambda', 'source', 'tm'])
    for (const id of Object.values(LANGUAGE_OF_PANE)) expect(LANGUAGE_IDS).toContain(id)
    for (const id of LANGUAGE_IDS) expect(EXTENSION_OF_LANGUAGE[id]).toBeTruthy()
  })
})

describe('document URIs', () => {
  it('are per view, so two views on one language are two documents', () => {
    const a = documentUri('v1', 'redextape_tm')
    const b = documentUri('v2', 'redextape_tm')
    expect(a).not.toEqual(b)
    expect(a).toBe('redextape:///view/v1.tm')
  })

  it('carry each language extension', () => {
    expect(documentUri('v1', 'redextape')).toBe('redextape:///view/v1.rxt')
    expect(documentUri('v1', 'redextape_lambda')).toBe('redextape:///view/v1.rxlambda')
    expect(documentUri('v1', 'redextape_asm')).toBe('redextape:///view/v1.asm')
  })
})

describe('isResponse', () => {
  it('splits on the presence of an id, which is what JSON-RPC uses', () => {
    expect(isResponse({ jsonrpc: '2.0', id: 1, result: null })).toBe(true)
    expect(isResponse({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: {} })).toBe(false)
  })
})
