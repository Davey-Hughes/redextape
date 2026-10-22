import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { MAX_WARM_BUFFERS } from '../../src/scratch'
import { bindingKey } from '../../src/view-header'
import {
  buffersControl,
  forkButton,
  idle,
  lambdaHeading,
  pickBinding,
  SHELL,
  shownNoticeText,
  titleOf,
  until,
} from './harness'

/**
 * **THE CAP'S REFUSAL, ON THE SURFACE A USER READS IT FROM** — design §4.5's second clause, which is
 * the one a throw does not deliver on its own.
 *
 * **A MESSAGE IS NOT A DIAGNOSTIC UNTIL SOMETHING RENDERS IT**, and only this tier can tell those apart.
 * `tests/node/scratch.test.ts` asserts the throw and the message, and would pass on a `fork` whose
 * refusal reached nothing: an uncaught throw out of the click that forks would exit into the raw DOM
 * dispatch (`view-header.ts`'s `viewMenu`), and there is no `window` error handler anywhere in `src/` —
 * `main.ts`'s is a WORKER `error` listener, which a main-thread click never reaches.
 *
 * **IT DRIVES THE CAP THROUGH THE APP, WHICH IS WHY IT IS ITS OWN FILE.** Reaching the refusal means
 * `MAX_WARM_BUFFERS` real forks on one page — `${MAX_WARM_BUFFERS + 1}` live workers by the end
 * (`MAX_WARM_BUFFERS` scratch buffers plus the one source session every page always has) — and a browser
 * file's tests share its one page, so this in another file would leave every later test there running
 * against a page at the cap. A file of its own gets a page of its own.
 *
 * **EVERY ASSERTION IS ON RENDERED TEXT** (§5), never on a control existing: the refusal is read off the
 * notice line (`#notice`, spec §11), and "nothing was evicted" is read off the header's own `copies N ▾`
 * readout rather than off `ScratchBuffers.list()`, which is not reachable from the DOM and is the node
 * tier's job.
 */

let view: EditorView

const noticeHidden = () => document.querySelector<HTMLElement>('#notice')?.hidden === true
/**
 * Put the λ pane back on the source session, which is what makes it forkable again.
 *
 * **A COPY IS MADE FROM A VIEW OF THE PROGRAM, AND A VIEW ALREADY SHOWING A COPY OFFERS NO *edit a
 * copy*** (`LambdaPane.#refreshDetach`'s `!this.#detached` gate), so reaching the cap means alternating
 * a copy with this. It is the same gesture `two-lambda-panes.test.ts`'s reset uses and the same one a
 * user has: the title-selector.
 * The buffer left behind stays live — nothing ends a buffer implicitly (decision 2) — which is exactly
 * how `MAX_WARM_BUFFERS` of them accumulate.
 */
async function backToSource(): Promise<void> {
  pickBinding('lambda-0', bindingKey('lambda', 'source'))
  await until(() => forkButton() !== null, 'the fork control to come back with the source binding')
}

describe('the buffer cap, from the control that hits it', () => {
  // ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives: ES module imports are cached, so `main()`
  // runs once per page and Vitest gives each test FILE its own page.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(idle, 'the first compile')
  })

  /**
   * THE WHOLE ARC IN ONE `it`, for `scratch-app.test.ts`'s reason: the states are ordered — there is no
   * cap to hit until `MAX_WARM_BUFFERS` buffers exist, and nothing to reclaim until the refusal has happened
   * — and one mount serves the file, so splitting them would make each stage depend on the previous
   * having run rather than on what it asserts.
   */
  it('refuses the copy past the cap with a message on the notice line, evicts nothing, and takes the fork after a retire', async () => {
    // STAGE 0 — a page that has never forked, asserted rather than assumed: the readout has to be
    // wired for the counts below to mean anything. **`copies ▾`, WITHOUT THE `0`**: `buffer-list.ts`'s
    // `update` drops the digit at zero, because the menu this button opens is never empty (it offers
    // "new TM copy").
    expect(buffersControl()?.textContent).toBe('copies ▾')
    expect(shownNoticeText()).not.toContain('cannot make a copy')
    expect(noticeHidden()).toBe(true)

    // STAGE 1 — fill to the cap through the control, alternating with the selector that makes the pane
    // forkable again. The count is read from the header after every one: a fork that silently did
    // nothing would leave the loop asserting against a page it never changed.
    for (let n = 1; n <= MAX_WARM_BUFFERS; n++) {
      forkButton()?.click()
      expect(buffersControl()?.textContent).toBe(`copies ${n} ▾`)
      expect(lambdaHeading()).toContain('copy · not linked')
      await backToSource()
    }
    expect(lambdaHeading()).not.toContain('not linked')
    expect(lambdaHeading()).toBe('λ · program')

    // STAGE 2 — THE REFUSAL, AND IT IS ON SCREEN. `cannot make a copy — ` is `ScratchBuffers.fork`'s
    // own call-site prefix (`#refuseAtCap`'s doc has why it lives there), and *pause* and *delete* in
    // the copies menu are the way out the sentence promises.
    forkButton()?.click()

    expect(shownNoticeText()).toContain('cannot make a copy — ')
    expect(shownNoticeText()).toContain(`all ${MAX_WARM_BUFFERS} copies are running`)
    expect(shownNoticeText()).toContain('pause or delete one from the copies menu')
    // **AND IT DOES NOT ENUMERATE THE BUFFERS** (`scratch.ts`'s `fork` has why): on a single-line dim
    // readout that does not wrap, a list of names shaped like a counter's output would stand between the
    // diagnosis and the one actionable clause. `BufferRow.term` puts the distinguishing fact on the
    // surface this sentence points at instead.
    //
    // ASSERTED AS AN ABSENCE, because a message that merely reordered its clauses would satisfy the
    // three lines above and leave the noise exactly where it was.
    expect(shownNoticeText()).not.toContain('copy 1')
    expect(shownNoticeText()).not.toContain(`copy ${MAX_WARM_BUFFERS}`)

    // STAGE 3 — NOTHING WAS EVICTED AND THE PANE DID NOT MOVE, read off the two surfaces a user has.
    // An implementation that made room by retiring the oldest buffer would satisfy STAGE 2 exactly and
    // fail here, which is the discriminator design §4.5 turns on: an eviction is decision 2's rule
    // broken under the name of a limit.
    expect(buffersControl()?.textContent).toBe(`copies ${MAX_WARM_BUFFERS} ▾`)
    expect(lambdaHeading()).not.toContain('not linked')
    expect(lambdaHeading()).toBe('λ · program')
    expect(forkButton()).not.toBeNull()

    // STAGE 4 — take the message's own advice. A diagnostic that names a way out and does not have one
    // is worse than no diagnostic, so the gesture it names is performed here: open the header list and
    // delete `λ copy 1`'s row.
    buffersControl()?.click()
    // **THE ROWS ARE TOLD APART BY THEIR TERMS, WHICH IS WHAT MAKES "AIM AT ONE ROW" A CHOICE.** Every
    // row here is `λ copy N · not shown` on its first line, alike but for its counter; the second line is
    // the buffer's own term, and it is what a user would pick a row BY.
    // Asserted here rather than only in `buffer-list.test.ts` because that file's fixture supplies the
    // terms and this one gets them from `MAX_WARM_BUFFERS` real workers through `main.ts`'s join.
    const terms = [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row-term')]
    expect(terms).toHaveLength(MAX_WARM_BUFFERS)
    for (const t of terms) expect(t.textContent ?? '').not.toBe('')

    const row = document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label="delete λ copy 1"]')
    if (row === null) throw new Error('λ copy 1 has no row in the header list')
    row.click()
    expect(buffersControl()?.textContent).toBe(`copies ${MAX_WARM_BUFFERS - 1} ▾`)
    // **AND THE REFUSAL IS GONE THE MOMENT ITS ADVICE IS TAKEN** — replaced by the delete's own notice
    // (spec §10), so the page does not say "all `MAX_WARM_BUFFERS` … running" beside a header
    // reading one fewer.
    expect(shownNoticeText()).toBe('λ copy 1 deleted')
    expect(shownNoticeText()).not.toContain('cannot make a copy')

    // STAGE 5 — the fork the cap refused now works, and says what it made.
    forkButton()?.click()
    expect(shownNoticeText()).toBe(`λ copy ${MAX_WARM_BUFFERS + 1} created — this view shows it`)

    expect(lambdaHeading()).toContain('copy · not linked')
    expect(buffersControl()?.textContent).toBe(`copies ${MAX_WARM_BUFFERS} ▾`)
    // THE NAME IS NOT REISSUED — `λ copy 1` was deleted and this is `λ copy ${MAX_WARM_BUFFERS + 1}`, which is
    // `ScratchBuffers.#minted`'s contract seen from the app. The λ group is where a buffer's label
    // becomes user-visible text.
    const bound = titleOf('lambda-0')?.dataset.binding
    expect(bound).toBe(bindingKey('lambda', `scratch-${MAX_WARM_BUFFERS + 1}`))

    // STAGE 6 — **THE REFUSAL SURVIVES THE SOURCE PANE** (deferred-a11y item 12). The source pane's host
    // ships a close control, and `hostFor`'s detach-not-destroy rule takes the whole subtree out of the
    // document, so a `#link-status` appended into that host would leave the page with the pane while
    // `createLinkWiring` held the element it captured at construction, and every write after the close
    // would land in a node that had left the page. Nothing about the fork changes — closing the source
    // PANE ends no session, so `✎` is still offered and the cap still refuses — so the refusal would be
    // composed, and reported to nobody.
    await backToSource()
    document.querySelector<HTMLButtonElement>('[data-leaf="source"] button[aria-label="close this view"]')?.click()
    expect(document.querySelector('[data-leaf="source"]')).toBeNull()
    // `#link-status` IS STILL IN THE DOCUMENT AFTER THE CLOSE, and every assertion after this one is what
    // that buys the user.
    expect(document.querySelector('#link-status')).not.toBeNull()

    // AND THE CONTROL IS STILL THERE TO HIT THE CAP WITH, asserted rather than assumed: if closing the
    // source pane withdrew `✎`, the refusal below would be unreachable and this stage would pass without
    // testing anything.
    expect(forkButton()).not.toBeNull()
    forkButton()?.click()

    expect(shownNoticeText()).toContain('cannot make a copy — ')
    expect(shownNoticeText()).toContain(`all ${MAX_WARM_BUFFERS} copies are running`)
    expect(buffersControl()?.textContent).toBe(`copies ${MAX_WARM_BUFFERS} ▾`)
  })
})
