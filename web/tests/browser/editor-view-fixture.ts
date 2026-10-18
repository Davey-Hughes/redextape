import { EditorView } from '@codemirror/view'
import { expect } from 'vitest'
import { asmPane, editorHost, until } from './harness'

/**
 * The editor mounted in a pane and its CodeMirror view, for the files that read and edit the editor in a pane or make
 * a copy. It is kept out of `harness.ts`, which every browser file loads, because it needs `@codemirror/view` at run
 * time.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names end in
 * `.test.ts`, and this one does not.
 */

/** The host of the editor mounted in `pane`, thrown on where none is mounted. */
const editorHostOf = (pane: HTMLElement): HTMLElement => {
  const host = pane.querySelector<HTMLElement>('.term-editor')
  if (host === null) throw new Error('no editor mounted in this pane')
  return host
}

/** The CodeMirror view under `pane`'s editor host, thrown on where none is mounted. */
export const editorViewOf = (pane: HTMLElement): EditorView => {
  const view = EditorView.findFromDOM(editorHostOf(pane))
  if (view === null) throw new Error('no CodeMirror view mounted under the editor host')
  return view
}

/** The CodeMirror view of the editor mounted in `pane`, or `null` where none is; `editorViewOf` throws instead. */
export const editorOf = (pane: HTMLElement): EditorView | null => {
  const el = pane.querySelector<HTMLElement>('.term-editor')
  return el === null ? null : EditorView.findFromDOM(el)
}

/**
 * A real keystroke — as against `setText`'s seed, see `scratch-editor.test.ts`'s file doc. `missing` is the message
 * thrown where no CodeMirror view is mounted under `host`.
 */
export const typeIn = (host: HTMLElement, text: string, missing = 'no CodeMirror view mounted under host'): void => {
  const view = EditorView.findFromDOM(host)
  if (view === null) throw new Error(missing)
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
}

/** Replace the whole text of the editor in the asm view `asm-0`'s pane, thrown on where none is mounted. */
export const retypeAsm = (text: string): void => {
  const v = editorOf(asmPane())
  if (v === null) throw new Error('no editor in the asm view')
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
}

/** What the mounted editor actually holds, read off CodeMirror rather than off the DOM's text nodes,
 * which are virtualized and would answer only the visible lines. */
export function lambdaEditorDoc(): string {
  const host = editorHost()
  if (host === null) throw new Error('no scratch editor mounted under [data-leaf="lambda-0"]')
  const cmView = EditorView.findFromDOM(host)
  if (cmView === null) throw new Error('no CodeMirror view mounted under the editor host')
  return cmView.state.doc.toString()
}

/** Make a copy of what this pane shows, through the control a user has. */
export async function makeCopy(pane: HTMLElement): Promise<EditorView> {
  const button = pane.querySelector<HTMLButtonElement>('button.detach')
  if (button === null) throw new Error('this view offers no `edit a copy` control')
  expect(button.disabled, 'the fork control should be available on this machine').toBe(false)
  button.click()
  await until(() => pane.querySelector('.term-editor') !== null, 'the copy to mount its editor')
  return editorViewOf(pane)
}
