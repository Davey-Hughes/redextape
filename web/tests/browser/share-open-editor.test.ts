import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { encodeLink } from '../../src/share-link'
import { bindingKey } from '../../src/view-header'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A PASTED LINK'S UNDO, AND THE λ COPY'S EDITOR** — Plan 7 part 6a spec §5.5: the `undo` puts back each copy's view,
 * moving it back with `moveBack`, whose first view mounts the copy's editor. The page opens on `let x = 40; x + 2`, and
 * its λ view is put on a copy, whose editor mounts there: the ordinary way a λ view shows a copy. A whole link builds
 * every view again on the program, and a λ view dropped by that rebuild hands its editor to custody, as a close does;
 * the `undo` brings the view back onto the copy with that editor in it, and not with *move the editor here*.
 *
 * Every gesture is a `userEvent` one. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 */

const SUM_TO = EXAMPLES.find((e) => e.id === 'sum-to')?.text ?? ''
const PROGRAM = bindingKey('lambda', 'source')

const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const readout = () => [...document.querySelectorAll('#results .segment, #results .row')].length
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
const lambda = () => document.querySelector<HTMLElement>('.pane[data-leaf="lambda-0"]') as HTMLElement
/** The binding the λ view shows, as its title records it. */
const shows = () => lambda().querySelector<HTMLElement>('button.view-title')?.dataset.binding ?? ''
/** The copy's editor in the λ view, or `null` when the view holds none. */
const editor = (): EditorView | null => {
  const el = lambda().querySelector<HTMLElement>('.term-editor')
  return el === null ? null : EditorView.findFromDOM(el)
}
const menuOf = (button: HTMLElement): HTMLElement =>
  document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement
const more = () => lambda().querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
/** Whether the λ view's `⋯` menu offers *move the editor here*, open or not. */
const offersClaim = () => menuOf(more()).querySelector('button.claim-editor') !== null

/** The editor is drawn inside the λ view: laid out, with a height, and within the pane's box. */
function drawnInView(ed: EditorView): void {
  const pane = lambda().getBoundingClientRect()
  const box = ed.dom.getBoundingClientRect()
  expect(ed.dom.isConnected).toBe(true)
  expect(lambda().contains(ed.dom)).toBe(true)
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
  await until(() => idle() && readout() === 3, 'the first compile')
  await userEvent.click(more())
  await until(() => menuOf(more()).matches(':popover-open'), 'the λ view’s menu')
  await userEvent.click(menuOf(more()).querySelector<HTMLButtonElement>('button.detach') as HTMLButtonElement)
  await until(() => shows() !== PROGRAM, 'the λ view to show its copy')
  copy = shows()
  // THE COPY'S BUILD REPLY, NOT ONLY ITS TITLE: the editor mounts when `scratch-compiled` lands.
  await until(() => editor() !== null, 'the copy’s editor')
  copyText = editor()?.state.doc.toString() ?? ''
})

describe('a whole link pasted over a λ view holding its copy’s editor', () => {
  it('takes the λ view onto the program, and its editor with it', async () => {
    // THE BEFORE STATE: the view shows the copy, with the copy's editor drawn in it and no *move the editor here*.
    expect(shows()).toBe(copy)
    const before = editor()
    expect(before).not.toBeNull()
    drawnInView(before as EditorView)
    expect(offersClaim()).toBe(false)
    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')

    location.hash = await encodeLink({
      program: SUM_TO,
      encoding: 'binary',
      workspace: serializeWorkspace(defaultWorkspace()),
      positions: {},
    })
    // ONLY THE OPEN PUTS `sum_to(5)` IN THE EDITOR, which was on `let x = 40; x + 2`.
    await until(() => view.state.doc.toString() === SUM_TO, 'the open')
    expect(noticeText()).toBe('opened a shared link')
    expect(shows()).toBe(PROGRAM)
    expect(editor()).toBeNull()
  })

  it('puts the view back on the copy on undo, with the copy’s editor drawn in it', async () => {
    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
    expect(shows()).toBe(copy)
    await until(() => editor() !== null, 'the copy’s editor in its view')
    const after = editor() as EditorView
    expect(after.state.doc.toString()).toBe(copyText)
    drawnInView(after)
    expect(offersClaim()).toBe(false)
  })
})
