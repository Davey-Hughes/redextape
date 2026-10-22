import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { MAX_WARM_BUFFERS } from '../../src/scratch'
import { buffersControl, idle, SHELL, shownNoticeText, until } from './harness'

/**
 * **THE BLANK-BUFFER GESTURE'S OWN CAP REFUSAL, ON THE SURFACE A USER READS IT FROM** — the mirror of
 * `scratch-cap.test.ts`, which drives the `catch (e) { if (!(e instanceof BufferCapReached)) throw e; … }`
 * arm in `transport.ts`'s `forkCopy` past `MAX_WARM_BUFFERS`. The sibling arm in the `onNew` handler
 * `bufferList` is constructed with, its fifth argument, is reached from `ScratchBuffers.forkBlank` instead
 * of `fork`, and this file drives it.
 *
 * **THE REASON THAT MATTERS IS THE SAME REASON `scratch-cap.test.ts` GIVES.** `tests/node/scratch.test.ts`
 * asserts that `forkBlank` throws `BufferCapReached` at the cap, and not what its message says; a message
 * is not a diagnostic until something renders it, and only a real DOM click through `main.ts`'s wiring can
 * tell those apart.
 *
 * **ITS OWN FILE, FOR `scratch-cap.test.ts`'s OWN REASON.** Reaching this refusal means `MAX_WARM_BUFFERS`
 * real blank buffers minted on one page, and `tm-blank-buffer.test.ts` mounts once and shares that page
 * across its tests — landing this there would leave every test after it in that file running against a
 * page already at the cap. A file of its own gets a page of its own.
 *
 * **EVERY ASSERTION IS ON RENDERED TEXT OR ON A STRUCTURAL COUNT, NEVER ON `ScratchBuffers.list()`
 * DIRECTLY** (§5, and the same standard `scratch-cap.test.ts` holds itself to): the refusal is read off
 * the notice line (`#notice`, spec §11), and "nothing was minted" is read off both the header's own
 * `copies N ▾` readout and the open menu's own `.buffer-row` count, so a fix that moved one without the
 * other would still fail.
 */

let view: EditorView

/**
 * Open the copies menu if it is not already open, and click *new TM copy* — the gesture
 * `tm-blank-buffer.test.ts`'s own tests use, repeated here past the cap.
 *
 * **REOPENED EVERY TIME, NOT CACHED**: the control this clicks hides the popover before it fires
 * (`buffer-list.ts`'s own click handler), so the menu is closed again by the time this returns and the
 * next call has to reopen it.
 */
function clickNewTm(): void {
  const button = buffersControl()
  if (button === null) throw new Error('no #buffers control in the header')
  if (button.getAttribute('aria-expanded') !== 'true') button.click()
  const newTm = document.querySelector<HTMLButtonElement>('.buffer-list button.new-tm')
  if (newTm === null) throw new Error('no "new TM copy" control in the open list')
  newTm.click()
}

/** The open list's own row count — reopened first, since `bufferList` builds the rows on `beforetoggle`:
 * a closed list keeps whatever it last rendered. */
const bufferRowCount = (): number => {
  const button = buffersControl()
  if (button === null) throw new Error('no #buffers control in the header')
  if (button.getAttribute('aria-expanded') !== 'true') button.click()
  return document.querySelectorAll('.buffer-list .buffer-row').length
}

describe('the buffer cap, from the blank-buffer control that hits it', () => {
  // ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives: ES module imports are cached, so `main()`
  // runs once per page and Vitest gives each test FILE its own page.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(idle, 'the first compile')
  })

  it('refuses a blank TM buffer past the cap with a message on the notice line, and mints nothing', async () => {
    // STAGE 0 — a page that has never minted, asserted rather than assumed.
    expect(buffersControl()?.textContent).toBe('copies ▾')
    expect(shownNoticeText()).not.toContain('copies are running')
    expect(document.querySelector<HTMLElement>('#notice')?.hidden).toBe(true)

    // STAGE 1 — fill to the cap through "new TM copy" alone. Unlike the fork gesture this needs no
    // pane and no alternation with a rebind: `forkBlank` mints and binds nothing (`ScratchBuffers.
    // forkBlank`'s own doc), so every one of these leaves every existing pane exactly where it was.
    for (let n = 1; n <= MAX_WARM_BUFFERS; n++) {
      clickNewTm()
      expect(buffersControl()?.textContent).toBe(`copies ${n} ▾`)
    }

    // STAGE 2 — THE REFUSAL, AND IT IS ON SCREEN. Without the `onNew` handler's catch arm to render it,
    // this would throw out of a click handler (`ScratchBuffers.forkBlank`'s own `#refuseAtCap`) with
    // nothing on the notice line to show for it — the failure `scratch-cap.test.ts`'s file doc gives for
    // the fork gesture, reached through the other door.
    clickNewTm()
    expect(shownNoticeText()).toContain(`all ${MAX_WARM_BUFFERS} copies are running`)
    expect(shownNoticeText()).toContain('pause or delete one from the copies menu')
    // NO `cannot make a copy — ` PREFIX, UNLIKE THE COPY REFUSAL — `ScratchBuffers.forkBlank` calls
    // `#refuseAtCap('')`, not `#refuseAtCap('cannot make a copy — ')` the way `fork` does; this control
    // is not a copy of anything and its own refusal does not borrow that gesture's words.
    expect(shownNoticeText()).not.toContain('cannot make a copy')
    expect(shownNoticeText()).toMatch(/^all \d+ copies are running/)

    // STAGE 3 — NOTHING WAS MINTED, read off two surfaces that would disagree if the catch arm fell
    // through to the success path (or ran a second mint) instead of returning: the header's own count
    // and the menu's own rows.
    expect(buffersControl()?.textContent).toBe(`copies ${MAX_WARM_BUFFERS} ▾`)
    expect(bufferRowCount()).toBe(MAX_WARM_BUFFERS)
  })
})
