import type { EditorView } from '@codemirror/view'
import { expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { until } from './harness'

/**
 * *Format on blur*, counted: the format requests the app posts to a worker, and a real leave of an editor that one
 * is asked by, for the files that hold a gesture to leaving an editor's text as it was typed.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names end in
 * `.test.ts`, and this one does not.
 */

/**
 * The document of each format request posted to a worker, in order, once `recordFormats` has wrapped `Worker`'s own
 * `postMessage`. The language server is sent each message as `{ kind: 'msg', json }` (`lsp-protocol.ts`'s
 * `LspRequestMessage`), the JSON-RPC message already a string.
 */
export const formats: string[] = []

/** Wrap `Worker`'s own `postMessage` so that each format request is added to `formats`: called before the app mounts. */
export function recordFormats(): void {
  const post = Worker.prototype.postMessage
  Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]): void {
    const sent = message as { kind?: unknown; json?: unknown } | null
    if (sent?.kind === 'msg' && typeof sent.json === 'string') {
      const rpc = JSON.parse(sent.json) as { method?: string; params?: { textDocument?: { uri?: string } } }
      if (rpc.method === 'textDocument/formatting') formats.push(rpc.params?.textDocument?.uri ?? '')
    }
    ;(post as (...args: unknown[]) => void).apply(this, [message, ...rest])
  }
}

/**
 * Put `messy` in `editor` with the focus in it, leave it with a pointer press on the wordmark, and hold that the
 * leave asked for a format and the text changed. Answers the text the server left.
 */
export async function formatsOnALeave(editor: EditorView, messy: string): Promise<string> {
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: messy } })
  editor.focus()
  await until(() => editor.hasFocus, 'the editor to take the focus')
  const before = formats.length
  await userEvent.click(document.querySelector('.wordmark') as HTMLElement)
  expect(formats.length, 'precondition: a real leave asks for a format').toBe(before + 1)
  await until(() => editor.state.doc.toString() !== messy, 'the text to be formatted when the editor is left')
  return editor.state.doc.toString()
}
