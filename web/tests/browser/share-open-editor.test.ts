import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { encodeLink } from '../../src/share-link'
import { bindingKey } from '../../src/view-header'
import { serializeWorkspace } from '../../src/workspace'
import { editorOf } from './editor-view-fixture'
import {
  controlledMenu,
  fourViewWorkspace,
  lambdaPane,
  noticeText,
  readout,
  SHELL,
  stateIdle,
  undoButton,
  until,
} from './harness'

/**
 * **A PASTED LINK'S UNDO, AND THE λ COPY'S EDITOR** — Plan 7 part 6a spec §5.5: the `undo` puts back each copy's view,
 * moving it back with `moveBack`, whose first view mounts the copy's editor. The page opens on `let x = 40; x + 2`, and
 * its λ view is put on a copy, whose editor mounts there: the ordinary way a λ view shows a copy. A whole link builds
 * every view again on the program, and a λ view dropped by that rebuild hands its editor to custody, as a close does;
 * the `undo` brings the view back onto the copy with that editor in it, and not with *move the editor here*.
 *
 * Every gesture is a `userEvent` one. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

const SUM_TO = EXAMPLES.find((e) => e.id === 'sum-to')?.text ?? ''
const PROGRAM = bindingKey('lambda', 'source')

/** The binding the λ view shows, as its title records it. */
const shows = () => lambdaPane().querySelector<HTMLElement>('button.view-title')?.dataset.binding ?? ''
const more = () => lambdaPane().querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
/** Whether the λ view's `⋯` menu offers *move the editor here*, open or not. */
const offersClaim = () => controlledMenu(more()).querySelector('button.claim-editor') !== null

/** The editor is drawn inside the λ view: laid out, with a height, and within the pane's box. */
function drawnInView(ed: EditorView): void {
  const pane = lambdaPane().getBoundingClientRect()
  const box = ed.dom.getBoundingClientRect()
  expect(ed.dom.isConnected).toBe(true)
  expect(lambdaPane().contains(ed.dom)).toBe(true)
  expect(getComputedStyle(ed.dom).display).not.toBe('none')
  expect(box.height).toBeGreaterThan(0)
  expect(box.width).toBeGreaterThan(0)
  expect(box.left).toBeGreaterThanOrEqual(pane.left)
  expect(box.right).toBeLessThanOrEqual(pane.right)
  expect(box.top).toBeGreaterThanOrEqual(pane.top)
}

let view: EditorView
/** The copy, as the λ view's binding reads, and the text its editor held before the link. */
let copy = ''
let copyText = ''

beforeAll(async () => {
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => stateIdle() && readout() === 3, 'the first compile')
  await userEvent.click(more())
  await until(() => controlledMenu(more()).matches(':popover-open'), 'the λ view’s menu')
  await userEvent.click(controlledMenu(more()).querySelector<HTMLButtonElement>('button.detach') as HTMLButtonElement)
  await until(() => shows() !== PROGRAM, 'the λ view to show its copy')
  copy = shows()
  // THE COPY'S BUILD REPLY, NOT ONLY ITS TITLE: the editor mounts when `scratch-compiled` lands.
  await until(() => editorOf(lambdaPane()) !== null, 'the copy’s editor')
  copyText = editorOf(lambdaPane())?.state.doc.toString() ?? ''
})

describe('a whole link pasted over a λ view holding its copy’s editor', () => {
  it('takes the λ view onto the program, and its editor with it', async () => {
    // THE BEFORE STATE: the view shows the copy, with the copy's editor drawn in it and no *move the editor here*.
    expect(shows()).toBe(copy)
    const before = editorOf(lambdaPane())
    expect(before).not.toBeNull()
    drawnInView(before as EditorView)
    expect(offersClaim()).toBe(false)
    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')

    location.hash = await encodeLink({
      program: SUM_TO,
      encoding: 'binary',
      workspace: serializeWorkspace(fourViewWorkspace()),
      positions: {},
    })
    // ONLY THE OPEN PUTS `sum_to(5)` IN THE EDITOR, which was on `let x = 40; x + 2`.
    await until(() => view.state.doc.toString() === SUM_TO, 'the open')
    expect(noticeText()).toBe('opened a shared link')
    expect(shows()).toBe(PROGRAM)
    expect(editorOf(lambdaPane())).toBeNull()
  })

  it('puts the view back on the copy on undo, with the copy’s editor drawn in it', async () => {
    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
    expect(shows()).toBe(copy)
    await until(() => editorOf(lambdaPane()) !== null, 'the copy’s editor in its view')
    const after = editorOf(lambdaPane()) as EditorView
    expect(after.state.doc.toString()).toBe(copyText)
    drawnInView(after)
    expect(offersClaim()).toBe(false)
  })
})
