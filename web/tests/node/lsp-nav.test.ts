import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { caretOf, goToDefinition, goToNextReference, type NavContext } from '../../src/lsp-nav'
import type { LspLocation, LspRange } from '../../src/lsp-protocol'

const URI = 'redextape:///view/source.rxt'

const at = (line: number, ch: number, len = 1): LspRange => ({
  start: { line, character: ch },
  end: { line, character: ch + len },
})

/**
 * **EVERY TARGET IS IN THE DOCUMENT THAT WAS ASKED ABOUT.** `Server::definition` builds its
 * `Location` from `params.text_document.uri` and `references` does the same, so there are no
 * cross-document cases to test — an earlier version of this file had two, against routing that
 * could never fire.
 */

/** A state over `doc` with the caret at `head`. No DOM, because nothing in `lsp-nav.ts` needs one. */
function stateAt(doc: string, head: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: head } })
}

function ctxFor(
  state: EditorState,
  answers: { definition?: LspLocation | null; references?: LspLocation[] },
): NavContext & { readonly said: string[]; readonly revealed: LspRange[] } {
  const said: string[] = []
  const revealed: LspRange[] = []
  return {
    uri: URI,
    state,
    said,
    revealed,
    notify: (t) => said.push(t),
    reveal: (range) => revealed.push(range),
    client: {
      definition: async () => answers.definition ?? null,
      references: async () => answers.references ?? [],
    },
  }
}

const DOC = 'fn fact(n) { fact(n - 1) }\nfact(3)\n'

describe('caretOf', () => {
  it('reports a zero-based line and a UTF-16 character within it', () => {
    // Line 1 (0-based) starts at offset 27; offset 31 is 4 characters into it.
    expect(caretOf(stateAt(DOC, 31))).toEqual({ line: 1, character: 4 })
  })
})

describe('go to definition', () => {
  it('reveals the target', async () => {
    const ctx = ctxFor(stateAt(DOC, 28), { definition: { uri: URI, range: at(0, 3, 4) } })
    await goToDefinition(ctx)
    expect(ctx.revealed).toEqual([at(0, 3, 4)])
    expect(ctx.said, 'a jump that landed says nothing').toEqual([])
  })

  /**
   * `null` is the ordinary answer for a caret on a keyword, a bracket or whitespace — most of any
   * document. A notice for it would fire constantly and teach the reader to ignore the notice line.
   */
  it('does nothing and says nothing when there is no definition', async () => {
    const ctx = ctxFor(stateAt(DOC, 0), { definition: null })
    await goToDefinition(ctx)
    expect(ctx.revealed).toEqual([])
    expect(ctx.said).toEqual([])
  })

  it('stays quiet when the server is gone, because the client already said so', async () => {
    const ctx = ctxFor(stateAt(DOC, 28), {})
    const failing: NavContext = {
      ...ctx,
      client: { ...ctx.client, definition: () => Promise.reject(new Error('gone')) },
    }
    await expect(goToDefinition(failing)).resolves.toBeUndefined()
    expect(ctx.said).toEqual([])
  })
})

describe('cycling references', () => {
  // `fact` at 0:3, its recursive call at 0:13, and the call on line 1 at 1:0.
  const THREE: LspLocation[] = [
    { uri: URI, range: at(0, 3, 4) },
    { uri: URI, range: at(0, 13, 4) },
    { uri: URI, range: at(1, 0, 4) },
  ]

  it('moves to the first reference after the caret', async () => {
    const ctx = ctxFor(stateAt(DOC, 0), { references: THREE })
    await goToNextReference(ctx)
    expect(ctx.revealed).toEqual([at(0, 3, 4)])
    expect(ctx.said).toEqual(['reference 1 of 3'])
  })

  it('walks the list on repeated presses, reading the caret rather than a remembered index', async () => {
    // Caret on the first reference: the next one is the recursive call.
    const ctx = ctxFor(stateAt(DOC, 3), { references: THREE })
    await goToNextReference(ctx)
    expect(ctx.said).toEqual(['reference 2 of 3'])
  })

  /**
   * **WRAPPING IS WHAT MAKES REPEATED PRESSES A CYCLE RATHER THAN A DEAD END**, and it is reachable
   * on the last reference in the file, which is exactly where a reader walking the list arrives.
   */
  it('wraps to the first when the caret is past the last reference', async () => {
    const ctx = ctxFor(stateAt(DOC, DOC.length), { references: THREE })
    await goToNextReference(ctx)
    expect(ctx.revealed).toEqual([at(0, 3, 4)])
    expect(ctx.said).toEqual(['reference 1 of 3'])
  })

  it('orders by position, not by the order the server sent', async () => {
    const shuffled = [THREE[2], THREE[0], THREE[1]] as LspLocation[]
    const ctx = ctxFor(stateAt(DOC, 0), { references: shuffled })
    await goToNextReference(ctx)
    expect(ctx.revealed).toEqual([at(0, 3, 4)])
  })

  it('does nothing when there are no references', async () => {
    const ctx = ctxFor(stateAt(DOC, 0), { references: [] })
    await goToNextReference(ctx)
    expect(ctx.revealed).toEqual([])
    expect(ctx.said).toEqual([])
  })
})
