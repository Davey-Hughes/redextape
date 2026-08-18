import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { MAX_WARM_BUFFERS } from '../../src/scratch'

/**
 * **THE BLANK-BUFFER GESTURE'S OWN CAP REFUSAL, ON THE SURFACE A USER READS IT FROM** — the mirror
 * `scratch-cap.test.ts`'s own file doc says the fork gesture needed and the blank-buffer gesture did
 * not yet have. That file drives the `catch (e) { if (!(e instanceof BufferCapReached)) throw e; … }`
 * arm in `main.ts`'s fork handler past `MAX_WARM_BUFFERS`; the sibling arm in `main.ts`'s `onNewTm`
 * handler (the fifth argument `bufferList` is constructed with) is reached from `ScratchBuffers.
 * forkBlank` instead of `fork`, and nothing before this file drove it — the four lines inside it
 * (`if (!(e instanceof BufferCapReached)) throw e`, `linkWiring.setForkFailed(e.message)`, `draw()`,
 * `return`) had zero coverage.
 *
 * **THE REASON THAT MATTERS IS THE SAME REASON `scratch-cap.test.ts` GIVES.** `tests/node/scratch.
 * test.ts` already asserts `forkBlank`'s own throw and message; a message is not a diagnostic until
 * something renders it, and only a real DOM click through `main.ts`'s wiring can tell those apart. This
 * repo has taken a Critical finding on exactly that gap once already (`scratch-cap.test.ts`'s own doc:
 * "the user clicked ✎ fork at the cap and got nothing at all"), for the fork gesture; this is the
 * mirror for the blank-buffer one.
 *
 * **ITS OWN FILE, FOR `scratch-cap.test.ts`'s OWN REASON.** Reaching this refusal means `MAX_WARM_
 * BUFFERS` real blank buffers minted on one page, and every sibling browser file mounts once and shares
 * that page across its tests — landing this in `tm-blank-buffer.test.ts` would leave every test after it
 * in that file running against a page already at the cap. A file of its own gets a page of its own.
 *
 * **EVERY ASSERTION IS ON RENDERED TEXT OR ON A STRUCTURAL COUNT, NEVER ON `ScratchBuffers.list()`
 * DIRECTLY** (§5, and the same standard `scratch-cap.test.ts` holds itself to): the refusal is read off
 * `#link-status`, and "nothing was minted" is read off both the header's own `buffers N ▾` readout and
 * the open menu's own `.buffer-row` count, so a fix that moved one without the other would still fail.
 */

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <button type="button" id="buffers">buffers</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

let view: EditorView

async function until(predicate: () => boolean, what: string, timeoutMs = 60_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const statusLine = () => document.querySelector('#link-status')?.textContent ?? ''
const buffersButton = () => document.querySelector<HTMLButtonElement>('#buffers')

/**
 * Open the header's buffer list if it is not already open, and click "new TM buffer" — the gesture
 * `tm-blank-buffer.test.ts`'s own tests use, repeated here past the cap.
 *
 * **REOPENED EVERY TIME, NOT CACHED**, for `buffer-list.ts`'s own reason `scratch-cap.test.ts`'s
 * `backToSource` and `two-lambda-panes.test.ts`'s `retireEveryBuffer` both state: the control this
 * clicks hides the popover before it fires (`buffer-list.ts`'s own click handler), so the menu is
 * closed again by the time this returns and the next call has to reopen it.
 */
function clickNewTm(): void {
  const button = buffersButton()
  if (button === null) throw new Error('no #buffers control in the header')
  if (button.getAttribute('aria-expanded') !== 'true') button.click()
  const newTm = document.querySelector<HTMLButtonElement>('.buffer-list button.new-tm')
  if (newTm === null) throw new Error('no "new TM buffer" control in the open list')
  newTm.click()
}

/** The open list's own row count — reopened first, `clickNewTm`'s own reason: a closed list keeps
 * whatever it last rendered. */
const bufferRowCount = (): number => {
  const button = buffersButton()
  if (button === null) throw new Error('no #buffers control in the header')
  if (button.getAttribute('aria-expanded') !== 'true') button.click()
  return document.querySelectorAll('.buffer-list .buffer-row').length
}

describe('the buffer cap, from the blank-buffer control that hits it', () => {
  // ONE MOUNT FOR THE FILE, the idiom every sibling states: ES module imports are cached, so `main()`
  // runs once per page and Vitest gives each test FILE its own page.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(
      () =>
        document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
        (document.querySelector('#results')?.textContent ?? '') !== '',
      'the first compile',
    )
  })

  it('refuses a blank TM buffer past the cap with a message on the status line, and mints nothing', async () => {
    // STAGE 0 — a page that has never minted, asserted rather than assumed.
    expect(buffersButton()?.textContent).toBe('buffers ▾')
    expect(statusLine()).not.toContain('scratch buffers are live')

    // STAGE 1 — fill to the cap through "new TM buffer" alone. Unlike the fork gesture this needs no
    // pane and no alternation with a rebind: `forkBlank` mints and binds nothing (`ScratchBuffers.
    // forkBlank`'s own doc), so every one of these leaves every existing pane exactly where it was.
    for (let n = 1; n <= MAX_WARM_BUFFERS; n++) {
      clickNewTm()
      expect(buffersButton()?.textContent).toBe(`buffers ${n} ▾`)
    }

    // STAGE 2 — THE REFUSAL, AND IT IS ON SCREEN. Before `main.ts`'s `onNewTm` catch arm existed to
    // render it, this would have thrown out of a click handler (`ScratchBuffers.forkBlank`'s own
    // `#refuseAtCap`) with nothing on `#link-status` to show for it — the same failure mode
    // `scratch-cap.test.ts`'s file doc records for the fork gesture, reached through the other door.
    clickNewTm()
    expect(statusLine()).toContain(`all ${MAX_WARM_BUFFERS} scratch buffers are live`)
    expect(statusLine()).toContain('retire or cool one from the buffers list in the header')
    // NO `fork failed — ` PREFIX, UNLIKE THE FORK REFUSAL — `ScratchBuffers.forkBlank` calls
    // `#refuseAtCap('')`, not `#refuseAtCap('fork failed — ')` the way `fork` does; this control is not
    // a fork and its own refusal does not borrow that gesture's words.
    expect(statusLine()).not.toContain('fork failed')

    // STAGE 3 — NOTHING WAS MINTED, read off two surfaces that would disagree if the catch arm fell
    // through to the success path (or ran a second mint) instead of returning: the header's own count
    // and the menu's own rows.
    expect(buffersButton()?.textContent).toBe(`buffers ${MAX_WARM_BUFFERS} ▾`)
    expect(bufferRowCount()).toBe(MAX_WARM_BUFFERS)
  })
})
