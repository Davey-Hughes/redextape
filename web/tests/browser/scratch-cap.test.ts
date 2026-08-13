import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { MAX_BUFFERS } from '../../src/scratch'

/**
 * **THE CAP'S REFUSAL, ON THE SURFACE A USER READS IT FROM** — design §4.5's second clause, which is
 * the one a throw does not deliver on its own.
 *
 * **THIS FILE EXISTS BECAUSE THE FIRST VERSION OF THE CAP SHIPPED HALF OF §4.5.** `fork` refused, and
 * the diagnostic it composed reached nothing: `transport.ts`'s detach handler had no `catch`, the throw
 * exited through `pane-host.ts`'s wrapper and `lambda-pane.ts`'s listener into the raw DOM dispatch
 * (`pane-chrome.ts`'s `detachButton`), and there is no `window` error handler anywhere in `src/` —
 * `main.ts`'s is a WORKER `error` listener, which a main-thread click never reaches. The user clicked
 * `✎ fork` at the cap and got nothing at all. `tests/node/scratch.test.ts` asserted the throw and the
 * message and passed throughout, which is the point: **a message is not a diagnostic until something
 * renders it**, and only this tier can tell those apart.
 *
 * **IT DRIVES THE CAP THROUGH THE APP, WHICH IS WHY IT IS ITS OWN FILE.** Reaching the refusal means
 * `MAX_BUFFERS` real forks on one page — nine live workers by the end — and every sibling browser file
 * mounts once and shares that page across its tests, so this in any of them would leave every later
 * test running against a page at the cap. A file of its own gets a page of its own.
 *
 * **EVERY ASSERTION IS ON RENDERED TEXT** (§5), never on a control existing: the refusal is read off
 * `#link-status`, and "nothing was evicted" is read off the header's own `buffers N ▾` readout rather
 * than off `ScratchBuffers.list()`, which is not reachable from the DOM and is the node tier's job.
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
const heading = () => document.querySelector('[data-leaf="lambda-0"] h2')?.textContent ?? ''
const forkButton = () => document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')
const buffersButton = () => document.querySelector<HTMLButtonElement>('#buffers')
/** `\x00` as an escape rather than the byte — `scripts/check-text-bytes.sh`'s rule, and the pane
 * selector's own `(leg, session)` encoding spelled out rather than imported, so this pins the DOM
 * contract instead of agreeing with whatever `pane-chrome.ts` currently does. */
const optionValue = (leg: string, id: string) => `${leg}\x00${id}`

/**
 * Put the λ pane back on the source session, which is what makes it forkable again.
 *
 * **A FORK LEAVES THE PANE DETACHED AND A DETACHED PANE OFFERS NO FORK** (`LambdaPane.#refreshDetach`'s
 * `!this.#detached` gate), so reaching the cap means alternating a fork with this. It is the same
 * gesture `two-lambda-panes.test.ts`'s reset uses and the same one a user has: the binding selector.
 * The buffer left behind stays live — nothing ends a buffer implicitly (decision 2) — which is exactly
 * how eight of them accumulate.
 */
async function backToSource(): Promise<void> {
  const select = document.querySelector<HTMLSelectElement>('[data-leaf="lambda-0"] .pane-binding select')
  if (select === null) throw new Error('no binding selector on the λ pane')
  select.value = optionValue('lambda', 'source')
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await until(() => forkButton() !== null, 'the fork control to come back with the source binding')
}

describe('the buffer cap, from the control that hits it', () => {
  // ONE MOUNT FOR THE FILE, the idiom every sibling states: ES module imports are cached, so `main()`
  // runs once per page and Vitest gives each test FILE its own page. The layout key is shared across the
  // whole browser tier and `main()` reads it once while resolving `let tree`, so it is cleared before
  // the import rather than in a hook that would run after it.
  beforeAll(async () => {
    localStorage.removeItem(LAYOUT_STORAGE_KEY)
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
   * cap to hit until `MAX_BUFFERS` buffers exist, and nothing to reclaim until the refusal has happened
   * — and one mount serves the file, so splitting them would make each stage depend on the previous
   * having run rather than on what it asserts.
   */
  it('refuses the fork past the cap with a message on the status line, evicts nothing, and takes the fork after a retire', async () => {
    // STAGE 0 — a page that has never forked, asserted rather than assumed: the readout has to be
    // wired for the counts below to mean anything, and `hidden` is `main.ts`'s treatment of zero.
    expect(buffersButton()?.textContent).toBe('buffers 0 ▾')
    expect(statusLine()).not.toContain('fork failed')

    // STAGE 1 — fill to the cap through the control, alternating with the selector that makes the pane
    // forkable again. The count is read from the header after every one: a fork that silently did
    // nothing would leave the loop asserting against a page it never changed.
    for (let n = 1; n <= MAX_BUFFERS; n++) {
      forkButton()?.click()
      expect(buffersButton()?.textContent).toBe(`buffers ${n} ▾`)
      expect(heading()).toContain('[detached]')
      await backToSource()
    }
    expect(heading()).not.toContain('[detached]')

    // STAGE 2 — THE REFUSAL, AND IT IS ON SCREEN. This is the assertion the first commit could not have
    // passed: the message existed as a string and nothing rendered it. `fork failed — ` is
    // `link-status.ts`'s own prefix, the buffers named are the rows the header list offers a retire on,
    // and `retire` is the way out the sentence promises.
    forkButton()?.click()

    expect(statusLine()).toContain('fork failed — ')
    expect(statusLine()).toContain(`all ${MAX_BUFFERS} scratch buffers are live`)
    expect(statusLine()).toContain('retire one from the buffers list in the header')
    // **AND IT DOES NOT ENUMERATE THE BUFFERS, WHICH IS A REVERSAL — these two lines read
    // `toContain('scratch 1')` and ``toContain(`scratch ${MAX_BUFFERS}`)``.** The message named all eight
    // on the argument that it should give "an account of what is using the room". Read on a real page,
    // that account is sixty characters of `scratch 1, scratch 2, …` — a counter's output, identical in
    // shape for every buffer — standing between the diagnosis and the one actionable clause, on a
    // single-line dim readout that does not wrap. `scratch.ts`'s `fork` has the full argument; what
    // replaced the enumeration is `BufferRow.term`, which puts the distinguishing fact on the surface
    // this sentence already points at.
    //
    // ASSERTED AS AN ABSENCE, because a message that merely reordered its clauses would satisfy the
    // three lines above and leave the noise exactly where it was.
    expect(statusLine()).not.toContain('scratch 1')
    expect(statusLine()).not.toContain(`scratch ${MAX_BUFFERS}`)

    // STAGE 3 — NOTHING WAS EVICTED AND THE PANE DID NOT MOVE, read off the two surfaces a user has.
    // An implementation that made room by retiring the oldest buffer would satisfy STAGE 2 exactly and
    // fail here, which is the discriminator design §4.5 turns on: an eviction is decision 2's rule
    // broken under the name of a limit.
    expect(buffersButton()?.textContent).toBe(`buffers ${MAX_BUFFERS} ▾`)
    expect(heading()).not.toContain('[detached]')
    expect(forkButton()).not.toBeNull()

    // STAGE 4 — take the message's own advice. A diagnostic that names a way out and does not have one
    // is worse than no diagnostic, so the gesture it names is performed here: open the header list and
    // retire the row it named first.
    buffersButton()?.click()
    // **THE ROWS ARE TOLD APART BY THEIR TERMS, WHICH IS WHAT MAKES "AIM AT ONE ROW" A CHOICE.** Every
    // row here is `scratch N — orphan` on its first line and identical to its neighbours; the second
    // line is the buffer's own term, and it is the only thing on this surface a user could pick BY.
    // Asserted here rather than only in `buffer-list.test.ts` because that file's fixture supplies the
    // terms and this one gets them from eight real workers through `main.ts`'s join.
    const terms = [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row-term')]
    expect(terms).toHaveLength(MAX_BUFFERS)
    for (const t of terms) expect(t.textContent ?? '').not.toBe('')

    const row = document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label="retire scratch 1"]')
    if (row === null) throw new Error('the buffer the refusal named has no row in the header list')
    row.click()
    expect(buffersButton()?.textContent).toBe(`buffers ${MAX_BUFFERS - 1} ▾`)
    // **AND THE REFUSAL IS GONE THE MOMENT ITS ADVICE IS TAKEN.** It used to survive the retire and clear
    // only on the next successful fork, so the page said "all 8 scratch buffers are live" while the
    // header above it read `buffers 7 ▾` — two surfaces disagreeing about the one number the sentence is
    // about, with the stale one being the instruction. Found by driving the app; `main.ts`'s retire
    // handler is where the clear went.
    expect(statusLine()).not.toContain('fork failed')

    // STAGE 5 — the fork the cap refused now works, and **the refusal clears with it**. The clear lives
    // on `transport.ts`'s success path; deleting it leaves `fork failed — all 8 …` sitting on the status
    // line of a page that has just forked successfully, which is this line's failure.
    forkButton()?.click()

    expect(statusLine()).not.toContain('fork failed')
    expect(heading()).toContain('[detached]')
    expect(buffersButton()?.textContent).toBe(`buffers ${MAX_BUFFERS} ▾`)
    // THE NAME IS NOT REISSUED — `scratch 1` was retired and this is `scratch 9`, which is
    // `ScratchBuffers.#minted`'s contract seen from the app. The λ group is where a buffer's label
    // becomes user-visible text.
    const bound = document.querySelector<HTMLSelectElement>('[data-leaf="lambda-0"] .pane-binding select')?.value
    expect(bound).toBe(optionValue('lambda', `scratch-${MAX_BUFFERS + 1}`))

    // STAGE 6 — **THE REFUSAL SURVIVES THE SOURCE PANE, WHICH IS DEFERRED-A11Y ITEM 12.** `#link-status`
    // used to be appended into the source pane's host, and that host ships a close control:
    // `hostFor`'s detach-not-destroy rule takes the whole subtree out of the document, `createLinkWiring`
    // holds the element it captured at construction, and every write after the close landed in a node
    // that had left the page. Nothing about the fork changes — closing the source PANE ends no session,
    // so `✎` is still offered and the cap still refuses — which is what made this the Critical STAGE 2
    // fixed, arriving again by a narrower road: the refusal composed, and reported to nobody.
    await backToSource()
    document.querySelector<HTMLButtonElement>('[data-leaf="source"] button[aria-label="close this pane"]')?.click()
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

    expect(statusLine()).toContain('fork failed — ')
    expect(statusLine()).toContain(`all ${MAX_BUFFERS} scratch buffers are live`)
    expect(buffersButton()?.textContent).toBe(`buffers ${MAX_BUFFERS} ▾`)
  })
})
