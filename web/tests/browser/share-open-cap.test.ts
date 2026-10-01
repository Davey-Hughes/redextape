import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { BUFFERS_STORAGE_KEY, serializeBuffers } from '../../src/buffers-store'
import { defaultLayout, LAYOUT_STORAGE_KEY, type LayoutNode, setLeafKind, splitLeaf } from '../../src/layout'
import { MAX_WARM_BUFFERS } from '../../src/scratch'
import { encodeLink } from '../../src/share-link'
import { bindingKey } from '../../src/view-header'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **AN OPEN'S UNDO, PAST THE COPIES CAP** — Plan 7 part 6a spec §5.5: "a copy the cap refuses stays paused, and its
 * view stays on the program". A link opened whole at start-up warms no copy (§5.3), so its `undo` warms each copy it
 * moves a view back onto. The stored workspace here has one more λ view than `MAX_WARM_BUFFERS`, each bound to a copy
 * of its own: the `undo` warms as many as the cap lets it, and the last stays paused, its view on the program. ONE
 * MOUNT FOR THE FILE, for the reason every sibling gives.
 */

/** A tree of `n` λ views beside the source view, split in halves so none goes under the pane floor. */
function lambdaViews(n: number): { tree: LayoutNode; leaves: string[] } {
  let tree = setLeafKind(setLeafKind(defaultLayout(), 'asm-0', 'lambda'), 'tm-0', 'lambda')
  const leaves = ['lambda-0', 'asm-0', 'tm-0']
  for (let i = 0; leaves.length < n; i++) {
    const id = `pane-${i + 1}`
    tree = splitLeaf(tree, leaves[i] as string, i % 2 === 0 ? 'row' : 'column', id, 'lambda')
    leaves.push(id)
  }
  return { tree, leaves }
}

const { tree, leaves } = lambdaViews(MAX_WARM_BUFFERS + 1)
const copies = leaves.map((_, i) => `scratch-${i + 1}`)
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const shows = (leaf: string) =>
  document.querySelector<HTMLElement>(`[data-leaf="${leaf}"] .view-title`)?.dataset.binding ?? ''

beforeAll(async () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace({ ...defaultWorkspace(), tree, focused: 'lambda-0' }))
  localStorage.setItem(
    BUFFERS_STORAGE_KEY,
    serializeBuffers({
      minted: copies.length,
      buffers: copies.map((id, i) => ({
        id,
        label: `copy ${i + 1}`,
        text: '(λa. a)',
        collapsed: false,
        leg: 'lambda' as const,
      })),
      bindings: Object.fromEntries(leaves.map((leaf, i) => [leaf, copies[i] as string])),
    }),
  )
  const fragment = await encodeLink({
    program: 'let x = 40; x + 2',
    encoding: 'unary',
    workspace: serializeWorkspace(defaultWorkspace()),
    positions: {},
  })
  history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => idle() && noticeText() === 'opened a shared link', 'the open')
})

describe("an open's undo past the copies cap", () => {
  it('opens on the link’s workspace, with every copy still listed', () => {
    expect(document.querySelectorAll('.pane[data-leaf]').length).toBe(4)
    expect(document.querySelector('#buffers')?.textContent).toBe(`copies ${copies.length} ▾`)
  })

  it('moves back every view it can warm a copy for, and says which copy stays paused', async () => {
    await userEvent.click(undoButton() as HTMLButtonElement)
    const last = leaves.length - 1
    expect(noticeText()).toBe(
      `put back the program and the workspace — λ copy ${last + 1} paused, ${MAX_WARM_BUFFERS} copies are running`,
    )
    for (const [i, leaf] of leaves.entries()) {
      expect(shows(leaf), leaf).toBe(bindingKey('lambda', i === last ? 'source' : (copies[i] as string)))
    }
  })
})
