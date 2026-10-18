import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { encodeLink } from '../../src/share-link'
import { serializeWorkspace } from '../../src/workspace'
import {
  box,
  fourViewWorkspace,
  mounted,
  noticeText,
  readout,
  SHELL,
  stateIdle,
  storedLayout,
  undoButton,
  until,
} from './harness'

/**
 * **A LINK OPENED AT START-UP, WHOLE, ON A PAGE WITH NO WORKSPACE STORED, AND ITS UNDO** — Plan 7 part 6a spec §5.5 and
 * the view layouts spec §8. The link's workspace is in force from the first frame, so what storage would have opened on
 * is seen only when the open is undone: the first-load workspace, built for the views area's shape as a first visit's
 * is (`main.ts`'s `storedWorkspace`). `share-open.test.ts` holds the undo over a workspace that was stored; this is
 * the undo over none. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 *
 * **IN A WINDOW TALLER THAN IT IS WIDE**, where the first-load tree is a column and one built without the area's shape
 * is a row. **THE LINK CARRIES ALL FOUR VIEWS**, which the first load does not show, so the undo is seen to replace
 * them.
 */

// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
localStorage.removeItem(LAYOUT_STORAGE_KEY)

const LINKED = 'let y = 10; y + 5'

let view: EditorView

beforeAll(async () => {
  await page.viewport(414, 896)
  const fragment = await encodeLink({
    program: LINKED,
    encoding: 'unary',
    workspace: serializeWorkspace(fourViewWorkspace()),
    positions: {},
  })
  history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => stateIdle() && readout() > 0, 'the first compile')
})

describe('a link at start-up, whole, with no workspace stored', () => {
  it('opens on the link’s four views, in a views area taller than it is wide: the preconditions', () => {
    expect(view.state.doc.toString()).toBe(LINKED)
    expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
    expect(noticeText()).toBe('opened a shared link')
    const area = (document.querySelector('#views') as HTMLElement).getBoundingClientRect()
    expect(area.height).toBeGreaterThan(area.width)
  })

  it('puts back the first-load views on undo: the source above the TM view', async () => {
    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(noticeText()).toBe('put back the program and the workspace')
    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
    expect(mounted()).toEqual(['source', 'tm-0'])
    expect(storedLayout().tree).toEqual({
      kind: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [
        { kind: 'leaf', id: 'source', pane: 'source' },
        { kind: 'leaf', id: 'tm-0', pane: 'tm' },
      ],
    })
    const source = box('source')
    const tm = box('tm-0')
    expect(Math.abs(source.left - tm.left), 'the two views do not share a left edge').toBeLessThan(1)
    expect(source.bottom, 'the TM view does not start where the source view ends').toBeLessThanOrEqual(tm.top)
  })
})
