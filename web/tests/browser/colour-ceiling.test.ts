import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { COLOUR_CEILING_UNITS } from '../../src/colour'
import { SHELL, until } from './harness'

/**
 * **THE OVER-THE-CEILING NOTICE — design §10's fourth row, over the running app.**
 *
 * *A document is over the colour ceiling → that document shows uncoloured, one notice saying which;
 * diagnostics keep running.* **The row promised "no colour and no diagnostics" until the diagnostics
 * path was measured at 135.2 ms in a worker at that size** — a lag rather than a freeze — so only the
 * colour half was ever built and the row now says so deliberately.
 *
 * The notice half of that row did not exist until this file: `ColourOptions.onCeiling` was
 * declared in `colour.ts` and invoked in `#rebuild`, and NEITHER of `main.ts`'s two `treeSitterColour`
 * calls passed one, so a document past the ceiling went silently uncoloured. `tests/node/colour.test.ts`
 * drove the ceiling and passed no sink either, which is why the gap survived a green suite: an optional
 * call on `undefined` is a line v8 records as covered and a behaviour that never happens.
 *
 * **SO THIS FILE IS ABOUT THE WIRING, NOT ABOUT THE BRANCH.** The branch — decorations cleared, tree
 * dropped, reported once — is the node tier's, over a stubbed view in the suite that runs on every push.
 * What only a page can show is that `main.ts` hands the plugin a real sink and that the sink reaches the
 * notice line a user reads. Both halves are needed and neither implies the other.
 *
 * **ITS OWN FILE BECAUSE THE DOCUMENT IS 6.1 MILLION UNITS AND STAYS IN THE EDITOR.** Every browser test
 * file gets its own page; putting this in `colour.test.ts` would leave that page's source editor holding
 * this document for whatever ran next.
 *
 * **THE DOCUMENT IS ALL COMMENTS, AND THAT IS NOT DECORATION.** The source editor's update listener
 * pushes every keystroke straight to the LSP worker and schedules a compile, so the text chosen here is
 * also text those two have to chew. 61,001 short comment lines lex to trivia and parse to an empty
 * program; the same 6.1 million units as one line, or as 61,001 expression statements, would put a
 * megabyte-wide DOM line or 61,001 diagnostics between this assertion and its subject.
 *
 * **THE NOTICE IS READ SYNCHRONOUSLY AFTER THE DISPATCH, WITH NO `until` BETWEEN.** `ViewPlugin.update`
 * runs inside `EditorView.dispatch`, so the notice is on the line before that call returns — and a
 * notice is REPLACED by the next one (`notice.ts`), so anything the debounced compile says 300 ms later
 * would take the line from under a waiting assertion.
 *
 * **REAL TIMERS**, as every file in this tier: a grammar arrives over a `fetch` the plugin awaits in its
 * constructor, and a fake clock plus an awaited fetch is a deadlock rather than a slow test.
 */

/** One comment line, 100 UTF-16 units including its newline. */
const LINE = `// ${'z'.repeat(96)}\n`

/** A document one line past the ceiling: 61,001 × 100 = 6,100,100 units against a ceiling of 6,100,000. */
const OVER = LINE.repeat(Math.ceil((COLOUR_CEILING_UNITS + 1) / LINE.length))

const sourceContent = () => document.querySelector<HTMLElement>('[data-leaf="source"] .cm-content')

/** What the notice line says, or `''` while it says nothing. */
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''

describe('a document past the colour ceiling', () => {
  let view: EditorView

  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    // **WAIT FOR COLOUR, NOT FOR THE MOUNT.** `#rebuild` returns before the ceiling branch while the
    // grammar is still in flight, so a dispatch sent too early would find an editor that is uncoloured
    // for the ordinary reason and say nothing — the test would then be asserting the absence of a
    // notice it never gave the plugin a chance to send.
    await until(() => sourceContent()?.querySelector('.tok-operator') != null, 'the source editor to colour')
  })

  it('goes uncoloured and says which editor did', () => {
    expect(OVER.length).toBeGreaterThan(COLOUR_CEILING_UNITS)
    // The precondition, asserted rather than assumed: the editor IS coloured at this moment, so the
    // emptiness below is this dispatch's doing and not the state the page was already in.
    expect(sourceContent()?.querySelectorAll('.tok-operator').length).toBeGreaterThan(0)

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: OVER } })

    expect(noticeText()).toBe('source is showing uncoloured: this document is too large to colour')
    expect(sourceContent()?.querySelectorAll('[class^="tok-"]').length).toBe(0)
  })
})
