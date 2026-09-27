import type { Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { LspPosition, LspRange, LspTextEdit } from './lsp-protocol'

/**
 * One LSP position as a CodeMirror offset.
 *
 * **NO BYTE CONVERSION, AND THAT IS THE WHOLE DIFFERENCE FROM THE `analyze` PATH THIS REPLACED.** The
 * server negotiates `positionEncoding: utf-16` at `initialize`, so `character` is already a count of
 * UTF-16 code units within the line — the unit CodeMirror counts in.
 *
 * **BOTH CLAMPS ARE LOAD-BEARING AGAINST A SERVER THAT IS AHEAD OF THE DOCUMENT.** `didChange` goes
 * out from an update listener and answers come back asynchronously, so a fast typist can delete the
 * line a message in flight refers to. `doc.line` THROWS on a line number past the end rather than
 * returning a null object, which would take out the whole worker message handler.
 */
export function offsetOf(doc: Text, pos: LspPosition): number {
  const line = doc.line(Math.min(Math.max(pos.line, 0) + 1, doc.lines))
  return Math.min(line.from + Math.max(pos.character, 0), line.to)
}

/** An LSP range as a CodeMirror `{from, to}`, never inverted. */
export function rangeOf(doc: Text, range: LspRange): { from: number; to: number } {
  const from = offsetOf(doc, range.start)
  const to = offsetOf(doc, range.end)
  return from <= to ? { from, to } : { from: to, to: from }
}

/**
 * Apply the server's edits to `view`, as one transaction.
 *
 * **ONE TRANSACTION, SO ONE UNDO STEP.** Dispatched separately, formatting a document would take as
 * many `Mod-z` presses to undo as the server sent edits — and for these it always sends one, so the
 * property matters most for the day it sends more.
 *
 * **EVERY EDIT'S RANGE IS RESOLVED AGAINST THE DOCUMENT AS IT IS NOW, WHICH IS WHY THEY GO IN ONE
 * `changes` ARRAY RATHER THAN A LOOP.** CodeMirror maps the whole set against a single starting
 * document; applied one at a time, the second edit's offsets would be read against a document the
 * first had already shifted. LSP specifies edit ranges against the original document, so the loop is
 * the wrong shape even where it happens to agree.
 *
 * `textDocumentSync` is Full and the formatter is `print ∘ parse`, so today the server sends exactly
 * one edit spanning the whole buffer — `Server::formatting`'s own comment says a range that stopped
 * short would append the formatted file to the remains of the old one.
 *
 * **NOTHING IS APPLIED IF THE DOCUMENT IS NO LONGER `asked`, the text the server held when it was
 * asked.** The answer is a round trip away, and what is typed in the meantime is not in it: applied
 * anyway, that one whole-buffer edit replaced the typing with the older text, formatted. A format
 * overtaken by typing does nothing, and asking again formats what is there now.
 */
export function applyEdits(view: EditorView, edits: LspTextEdit[], asked: Text): void {
  if (edits.length === 0 || !view.state.doc.eq(asked)) return
  const doc = view.state.doc
  view.dispatch({
    changes: edits.map((e) => ({ ...rangeOf(doc, e.range), insert: e.newText })),
  })
}

/**
 * Put the caret on `range` and scroll it into view.
 *
 * **IT SELECTS THE RANGE RATHER THAN COLLAPSING TO ITS START**, so a jump shows what it landed on.
 * The outline hands over a symbol's `selectionRange` — the name — which makes this a highlight of
 * the name rather than of the whole definition.
 *
 * **AND IT FOCUSES THE EDITOR**, because a caret in an unfocused editor is invisible: the user asked
 * to go somewhere, and arriving without the keyboard following is a jump they then have to finish by
 * hand.
 */
export function revealRange(view: EditorView, range: LspRange): void {
  const { from, to } = rangeOf(view.state.doc, range)
  view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
  view.focus()
}
