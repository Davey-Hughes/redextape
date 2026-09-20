import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { MAX_WARM_BUFFERS } from '../../src/scratch'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

/**
 * **THE CAP'S REFUSAL, ON THE SURFACE A USER READS IT FROM** — design §4.5's second clause, which is
 * the one a throw does not deliver on its own.
 *
 * **THIS FILE EXISTS BECAUSE THE FIRST VERSION OF THE CAP SHIPPED HALF OF §4.5.** `fork` refused, and
 * the diagnostic it composed reached nothing: `transport.ts`'s detach handler had no `catch`, the throw
 * exited through `pane-host.ts`'s wrapper and `lambda-pane.ts`'s listener into the raw DOM dispatch
 * (`view-header.ts`'s `viewMenu`), and there is no `window` error handler anywhere in `src/` —
 * `main.ts`'s is a WORKER `error` listener, which a main-thread click never reaches. The user clicked
 * `✎ edit a copy` at the cap and got nothing at all. `tests/node/scratch.test.ts` asserted the throw and the
 * message and passed throughout, which is the point: **a message is not a diagnostic until something
 * renders it**, and only this tier can tell those apart.
 *
 * **IT DRIVES THE CAP THROUGH THE APP, WHICH IS WHY IT IS ITS OWN FILE.** Reaching the refusal means
 * `MAX_WARM_BUFFERS` real forks on one page — `${MAX_WARM_BUFFERS + 1}` live workers by the end (`MAX_WARM_BUFFERS` scratch
 * buffers plus the one source session every page always has) — and every sibling browser file
 * mounts once and shares that page across its tests, so this in any of them would leave every later
 * test running against a page at the cap. A file of its own gets a page of its own.
 *
 * **EVERY ASSERTION IS ON RENDERED TEXT** (§5), never on a control existing: the refusal is read off the
 * notice line (`#notice`, spec §11), and "nothing was evicted" is read off the header's own `copies N ▾`
 * readout rather than off `ScratchBuffers.list()`, which is not reachable from the DOM and is the node
 * tier's job.
 */

/** The title-selector of `leaf`'s view — the pair in force is its `data-binding`. */
const titleOf = (leaf: string) => document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-title`)

/** Pick `key` (`bindingKey(leg, session)`) through `leaf`'s title menu, as a user does. */
function pickBinding(leaf: string, key: string): void {
  const title = titleOf(leaf)
  if (title === null) throw new Error(`no title-selector on [data-leaf="${leaf}"]`)
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const item = menu?.querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`)
  if (item == null) {
    const offered = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b) => b.dataset.binding)
    throw new Error(`[data-leaf="${leaf}"] offers no ${JSON.stringify(key)} — offered: ${JSON.stringify(offered)}`)
  }
  item.click()
}

let view: EditorView

/** The notice line's text — where a refusal is said since Plan 7 part 2 (spec §11) — or `''` while it is hidden. */
const noticeText = () => {
  const notice = document.querySelector<HTMLElement>('#notice')
  return notice === null || notice.hidden ? '' : (notice.querySelector('.notice-text')?.textContent ?? '')
}
const noticeHidden = () => document.querySelector<HTMLElement>('#notice')?.hidden === true
const heading = () => document.querySelector('[data-leaf="lambda-0"] h2')?.textContent ?? ''
const forkButton = () => document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')
const buffersButton = () => document.querySelector<HTMLButtonElement>('#buffers')
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
  // ONE MOUNT FOR THE FILE, the idiom every sibling states: ES module imports are cached, so `main()`
  // runs once per page and Vitest gives each test FILE its own page.
  beforeAll(async () => {
    // Each browser test file gets its own in-memory `Storage` now, installed in `tests/browser/setup.ts`
    // before this file's own module body runs — this file is one of the two the old clear-on-mount
    // mitigation still let through (see that file's doc). Neither key needs clearing here any more.
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

  /**
   * THE WHOLE ARC IN ONE `it`, for `scratch-app.test.ts`'s reason: the states are ordered — there is no
   * cap to hit until `MAX_WARM_BUFFERS` buffers exist, and nothing to reclaim until the refusal has happened
   * — and one mount serves the file, so splitting them would make each stage depend on the previous
   * having run rather than on what it asserts.
   */
  it('refuses the copy past the cap with a message on the notice line, evicts nothing, and takes the fork after a retire', async () => {
    // STAGE 0 — a page that has never forked, asserted rather than assumed: the readout has to be
    // wired for the counts below to mean anything. **`copies ▾`, WITHOUT THE `0` — 5d-iv T10.** This
    // used to read `buffers 0 ▾`; `buffer-list.ts`'s `update` drops the digit at zero now, because the
    // menu this button opens is never empty any more (it offers "new TM copy"), so `main.ts` also no
    // longer sets `hidden` at zero — the previous comment here named that as the zero-count treatment.
    expect(buffersButton()?.textContent).toBe('copies ▾')
    expect(noticeText()).not.toContain('cannot make a copy')
    expect(noticeHidden()).toBe(true)

    // STAGE 1 — fill to the cap through the control, alternating with the selector that makes the pane
    // forkable again. The count is read from the header after every one: a fork that silently did
    // nothing would leave the loop asserting against a page it never changed.
    for (let n = 1; n <= MAX_WARM_BUFFERS; n++) {
      forkButton()?.click()
      expect(buffersButton()?.textContent).toBe(`copies ${n} ▾`)
      expect(heading()).toContain('copy · not linked')
      await backToSource()
    }
    expect(heading()).not.toContain('not linked')
    expect(heading()).toBe('λ · program')

    // STAGE 2 — THE REFUSAL, AND IT IS ON SCREEN. This is the assertion the first commit could not have
    // passed: the message existed as a string and nothing rendered it. `cannot make a copy — ` is
    // `ScratchBuffers.fork`'s own call-site prefix (`#refuseAtCap`'s doc has why it lives there), and
    // *pause* and *delete* in the copies menu are the way out the sentence promises.
    forkButton()?.click()

    expect(noticeText()).toContain('cannot make a copy — ')
    expect(noticeText()).toContain(`all ${MAX_WARM_BUFFERS} copies are running`)
    expect(noticeText()).toContain('pause or delete one from the copies menu')
    // **AND IT DOES NOT ENUMERATE THE BUFFERS, WHICH IS A REVERSAL — these two lines read
    // `toContain('scratch 1')` and ``toContain(`scratch ${MAX_WARM_BUFFERS}`)``.** The message named all eight
    // on the argument that it should give "an account of what is using the room". Read on a real page,
    // that account is sixty characters of `scratch 1, scratch 2, …` — a counter's output, identical in
    // shape for every buffer — standing between the diagnosis and the one actionable clause, on a
    // single-line dim readout that does not wrap. `scratch.ts`'s `fork` has the full argument; what
    // replaced the enumeration is `BufferRow.term`, which puts the distinguishing fact on the surface
    // this sentence already points at.
    //
    // ASSERTED AS AN ABSENCE, because a message that merely reordered its clauses would satisfy the
    // three lines above and leave the noise exactly where it was.
    expect(noticeText()).not.toContain('copy 1')
    expect(noticeText()).not.toContain(`copy ${MAX_WARM_BUFFERS}`)

    // STAGE 3 — NOTHING WAS EVICTED AND THE PANE DID NOT MOVE, read off the two surfaces a user has.
    // An implementation that made room by retiring the oldest buffer would satisfy STAGE 2 exactly and
    // fail here, which is the discriminator design §4.5 turns on: an eviction is decision 2's rule
    // broken under the name of a limit.
    expect(buffersButton()?.textContent).toBe(`copies ${MAX_WARM_BUFFERS} ▾`)
    expect(heading()).not.toContain('not linked')
    expect(heading()).toBe('λ · program')
    expect(forkButton()).not.toBeNull()

    // STAGE 4 — take the message's own advice. A diagnostic that names a way out and does not have one
    // is worse than no diagnostic, so the gesture it names is performed here: open the header list and
    // retire the row it named first.
    buffersButton()?.click()
    // **THE ROWS ARE TOLD APART BY THEIR TERMS, WHICH IS WHAT MAKES "AIM AT ONE ROW" A CHOICE.** Every
    // row here is `λ scratch N — orphan` on its first line and identical to its neighbours; the second
    // line is the buffer's own term, and it is the only thing on this surface a user could pick BY.
    // Asserted here rather than only in `buffer-list.test.ts` because that file's fixture supplies the
    // terms and this one gets them from `MAX_WARM_BUFFERS` real workers through `main.ts`'s join.
    const terms = [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row-term')]
    expect(terms).toHaveLength(MAX_WARM_BUFFERS)
    for (const t of terms) expect(t.textContent ?? '').not.toBe('')

    const row = document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label="delete λ copy 1"]')
    if (row === null) throw new Error('the buffer the refusal named has no row in the header list')
    row.click()
    expect(buffersButton()?.textContent).toBe(`copies ${MAX_WARM_BUFFERS - 1} ▾`)
    // **AND THE REFUSAL IS GONE THE MOMENT ITS ADVICE IS TAKEN** — replaced by the delete's own notice
    // (spec §10), so the page no longer says "all 11 … running" beside a header reading 10.
    expect(noticeText()).toBe('λ copy 1 deleted')
    expect(noticeText()).not.toContain('cannot make a copy')

    // STAGE 5 — the fork the cap refused now works, and says what it made.
    forkButton()?.click()
    expect(noticeText()).toBe(`λ copy ${MAX_WARM_BUFFERS + 1} created — this view shows it`)

    expect(heading()).toContain('copy · not linked')
    expect(buffersButton()?.textContent).toBe(`copies ${MAX_WARM_BUFFERS} ▾`)
    // THE NAME IS NOT REISSUED — `λ scratch 1` was retired and this is `λ scratch ${MAX_WARM_BUFFERS + 1}`, which is
    // `ScratchBuffers.#minted`'s contract seen from the app. The λ group is where a buffer's label
    // becomes user-visible text.
    const bound = titleOf('lambda-0')?.dataset.binding
    expect(bound).toBe(bindingKey('lambda', `scratch-${MAX_WARM_BUFFERS + 1}`))

    // STAGE 6 — **THE REFUSAL SURVIVES THE SOURCE PANE, WHICH IS DEFERRED-A11Y ITEM 12.** `#link-status`
    // used to be appended into the source pane's host, and that host ships a close control:
    // `hostFor`'s detach-not-destroy rule takes the whole subtree out of the document, `createLinkWiring`
    // holds the element it captured at construction, and every write after the close landed in a node
    // that had left the page. Nothing about the fork changes — closing the source PANE ends no session,
    // so `✎` is still offered and the cap still refuses — which is what made this the Critical STAGE 2
    // fixed, arriving again by a narrower road: the refusal composed, and reported to nobody.
    await backToSource()
    document.querySelector<HTMLButtonElement>('[data-leaf="source"] button[aria-label="close this view"]')?.click()
    expect(document.querySelector('[data-leaf="source"]')).toBeNull()
    // THE MEASUREMENT THE ITEM WAS FILED ON, INVERTED. `document.querySelector('#link-status')` returned
    // `null` here — the assertion below is the whole of the fix, and every one after it is what that
    // buys the user.
    expect(document.querySelector('#link-status')).not.toBeNull()

    // AND THE CONTROL IS STILL THERE TO HIT THE CAP WITH, asserted rather than assumed: if closing the
    // source pane withdrew `✎`, the refusal below would be unreachable and this stage would pass without
    // testing anything.
    expect(forkButton()).not.toBeNull()
    forkButton()?.click()

    expect(noticeText()).toContain('cannot make a copy — ')
    expect(noticeText()).toContain(`all ${MAX_WARM_BUFFERS} copies are running`)
    expect(buffersButton()?.textContent).toBe(`copies ${MAX_WARM_BUFFERS} ▾`)
  })
})
