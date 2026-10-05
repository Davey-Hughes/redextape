import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { EXAMPLE_ENCODING } from '../../src/examples'
import { PROGRAM_STORAGE_KEY, serializeProgram } from '../../src/program-store'
import { encodeLink } from '../../src/share-link'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A LINK AT START-UP WHOSE TREE IS 6,000 SPLITS DEEP** — Plan 7 part 6a spec §5.3, amended 2026-10-01. Before the
 * bound on a tree, this link threw out of `decodeLink` before the fragment was cleared: `main()` rejected with no views,
 * no editor and nothing said, and every reload of the address did it again. Its program opens alone now, in the stored
 * workspace, and the fragment is cleared. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 *
 * **THE LINK CARRIES `unary` OVER A PROGRAM STORED UNDER `binary`, SO A START-UP THAT TOOK THE DEFAULT ENCODING, OR
 * STORAGE'S, IN PLACE OF THE LINK'S FAILS THE FIRST CASE.** `binary` is both of those. It cannot fail a start-up that
 * left the picker on its first option, which is `unary` too: with two encodings, one value differs from some wrong
 * sources and equals another. `share-open.test.ts` is the other half, a link carrying `binary` over a program stored
 * under `unary`, which fails that one and cannot fail a start-up that took the default.
 */

const DEPTH = 6000
/** Not the stored program, so the one on the page is told apart from it. */
const PROGRAM = 'let y = 1; y + 2'
/** The text `setup.ts` stores for every file, stored here under `binary`, the encoding the link does not carry. */
const STORED = { text: 'let x = 40; x + 2', encoding: 'binary' }

/**
 * `depth` splits deep down each split's second child, whose first child is a λ leaf, as `+ view` nested views until
 * 2026-10-04.
 */
function deepTree(depth: number): unknown {
  let node: unknown = { kind: 'leaf', id: `pane-${depth}`, pane: 'lambda' }
  for (let i = depth - 1; i >= 1; i--)
    node = {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [{ kind: 'leaf', id: `pane-${i}`, pane: 'lambda' }, node],
    }
  return {
    kind: 'split',
    dir: 'row',
    sizes: [0.5, 0.5],
    children: [{ kind: 'leaf', id: 'source', pane: 'source' }, node],
  }
}

const leafIds = () => [...document.querySelectorAll<HTMLElement>('main [data-leaf]')].map((el) => el.dataset.leaf ?? '')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const readout = () => [...document.querySelectorAll('#results .segment, #results .row')].length

let view: EditorView

beforeAll(async () => {
  const workspace = JSON.stringify({
    ...JSON.parse(serializeWorkspace(defaultWorkspace())),
    tree: deepTree(DEPTH),
    focused: 'pane-1',
  })
  localStorage.setItem(PROGRAM_STORAGE_KEY, serializeProgram(STORED))
  const fragment = await encodeLink({ program: PROGRAM, encoding: 'unary', workspace, positions: {} })
  history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => idle() && readout() > 0, 'the first compile')
})

describe('a link at start-up whose tree is 6,000 splits deep', () => {
  it('opens its program alone, under its encoding, in the default views', () => {
    expect(view.state.doc.toString()).toBe(PROGRAM)
    // WHAT THE LINK'S ENCODING IS TOLD APART FROM: were `unary` the default encoding, this case would hold nothing.
    expect(EXAMPLE_ENCODING, 'precondition: unary is not the default encoding').not.toBe('unary')
    expect(document.querySelector<HTMLSelectElement>('#encoding')?.value).toBe('unary')
    expect(leafIds()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
  })

  it('says what was left out, with an undo, and clears the fragment', () => {
    expect(document.querySelector('#notice .notice-text')?.textContent).toBe(
      "opened a shared link's program — its workspace and step positions were left out",
    )
    expect(document.querySelector('#notice button.notice-action')?.textContent).toBe('undo')
    expect(location.hash).toBe('')
  })
})
