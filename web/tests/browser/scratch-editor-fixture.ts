import { EditorView } from '@codemirror/view'
import { editorHost } from './harness'

/**
 * Typing into the λ view's scratch editor, for the files that edit it. It is kept out of `harness.ts`, which every
 * browser file loads, because it needs `@codemirror/view` at run time.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names end in
 * `.test.ts`, and this one does not.
 */

/**
 * A real keystroke into the scratch's own editor, the one `editorHost` answers: `ScratchEditor#setText` sets a
 * `#seeding` flag for its dispatch (so a fork's seed is never mistaken for a keystroke), so it reports no edit at all.
 * `missing` is the message where no editor is mounted.
 */
export function typeIntoScratchEditor(
  text: string,
  missing = 'no scratch editor mounted under [data-leaf="lambda-0"]',
): void {
  const host = editorHost()
  if (host === null) throw new Error(missing)
  const cmView = EditorView.findFromDOM(host)
  if (cmView === null) throw new Error('no CodeMirror view mounted under the editor host')
  cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: text } })
}
