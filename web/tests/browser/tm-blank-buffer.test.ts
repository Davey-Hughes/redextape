import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import type { Leg } from '../../src/protocol'
import type { SessionId } from '../../src/session-client'

/**
 * **THE SECOND GESTURE — 5d-iv Task 10, design §4.7.** Task 9 wired the fork, which detaches a pane onto
 * a copy of what it was showing and is refused above `MAX_FORK_RULES`; this is the OTHER door, always
 * available, for a user who has nothing on screen to fork from and wants somewhere to paste a `.tm` file
 * `tm_emit` produced. `scratch.ts`'s `ScratchBuffers.forkBlank` is the collection-side half, landed in
 * Task 5 with nothing in `src/` calling it — this file is what calls it.
 *
 * **`mountApp` IS THIS FILE'S OWN, NOT `tm-scratch-fork.test.ts`'s, EVEN THOUGH THE SHELL AND THE IDLE
 * POLL ARE IDENTICAL.** That file's helper has no route to the buffers button, the popover, a row count
 * or the binding selector — nothing here needed them before this task existed to test. Duplicating the
 * shell rather than importing it is the standing idiom every sibling in this directory states: each
 * browser test file gets its own page (`main()` runs once per module load), so there is nothing to
 * import FROM — a shared mount would be a shared page two files could not both own.
 *
 * ONE MOUNT FOR THE FILE, the same reason every sibling gives: ES module imports are cached, so `main()`
 * runs once per page and Vitest gives each test FILE its own page. Each `it` below calls `mountApp`
 * again; only the first call actually imports `../../src/main` and the rest reuse the page, loading a
 * fresh source program the way `tm-scratch-fork.test.ts`'s own `mountApp` does.
 *
 * **NOTHING HERE RETIRES A BUFFER BETWEEN TESTS, SO THEY ACCUMULATE — AND THE THIRD TEST'S HARD-CODED
 * `scratch-1` DEPENDS ON THAT.** The second test mints the first buffer this file ever mints, which
 * `ScratchBuffers.#minted` names `scratch-1`; the third test mints a second of its own (unused, left
 * orphan) and then binds the TM pane to `scratch-1` — the SECOND test's buffer, still live, not the
 * one it just minted. A reset between tests would retire that buffer out from under the third test's own
 * assertion, so there is deliberately none. The fourth test's retire click therefore lands on whichever
 * buffer is OLDEST at that point (`ScratchBuffers.list`'s own doc: "every live buffer, oldest first"),
 * not necessarily the one it just minted — its claim is that the control survives a retire and keeps
 * focus, which holds regardless of how many buffers remain after the click.
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

async function until(predicate: () => boolean, what: string, timeoutMs = 60_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const resultsText = () => document.querySelector('#results')?.textContent ?? ''
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== ''

const tmPaneHost = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-leaf="tm-0"]')
  if (el === null) throw new Error('no TM pane mounted at [data-leaf="tm-0"]')
  return el
}

/**
 * The header's buffers button — thrown rather than optional-chained past, the same standard
 * `tmPaneHost` sets: every test below needs the real element to act on, and a silent `null` here would
 * turn a missing mount point into a `TypeError` several lines away from where the mount actually failed.
 */
const buffersButton = (): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>('#buffers')
  if (el === null) throw new Error('no #buffers control in the header')
  return el
}

/**
 * The popover `bufferList` appends beside `#buffers` — present once `bufferList` has run at all
 * (`main.ts` constructs it unconditionally now, per this task: the button is never withheld), whether or
 * not it is currently open.
 */
const buffersMenu = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('.buffer-list')
  if (el === null) throw new Error('no .buffer-list popover beside #buffers')
  return el
}

/**
 * Every row the list currently holds — elements rather than text, since `it('mints a warm TM
 * buffer...')`'s only claim is the COUNT.
 *
 * **FORCES THE LIST OPEN FIRST, THE WAY `buffer-restore.test.ts`'s OWN `openList` DOES, AND FOR THE
 * SAME REASON.** `bufferList`'s rows are built on `beforetoggle` — a closed list keeps whatever it last
 * rendered, which can predate a mint that happened while it was shut (`buffer-list.ts`'s own doc: "A
 * closed list has no state to keep fresh"). The "new TM buffer" control dismisses the popover before it
 * mints (`buffer-list.ts`'s own click handler, mirroring `retire`'s), so every mint in this file leaves
 * the list closed on stale rows; reading it without reopening would answer what the list showed BEFORE
 * the mint, not what it holds now.
 */
const bufferRows = (): HTMLElement[] => {
  const button = buffersButton()
  if (button.getAttribute('aria-expanded') !== 'true') button.click()
  return [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row')]
}

/** `\x00` as an escape rather than the byte — `scripts/check-text-bytes.sh`'s rule, and the pane
 * selector's own `(leg, session)` encoding, spelled out here rather than imported so this pins the DOM
 * contract instead of agreeing with whatever `pane-chrome.ts` currently does. */
const optionValue = (leg: Leg, id: SessionId) => `${leg}\x00${id}`

/**
 * Every mounted pane's current binding, keyed by leaf id — read off the selector's own encoded value
 * rather than tracked separately, so `it('mints a warm TM buffer...')`'s "nothing rebound" claim is a
 * fact about the DOM rather than about a value this file kept on the side.
 *
 * A LEAF WITH NO SELECTOR CONTRIBUTES NOTHING, which is `paneSelect`'s own below-two-options
 * self-removal (`pane-chrome.ts`) rather than a gap here: the source leaf, before anything has forked
 * or minted, offers no selector at all.
 */
const paneBindings = (): Record<string, string> => {
  const bindings: Record<string, string> = {}
  for (const pane of document.querySelectorAll<HTMLElement>('[data-leaf]')) {
    const leaf = pane.dataset.leaf
    const select = pane.querySelector<HTMLSelectElement>('.pane-binding select')
    if (leaf !== undefined && select !== null) bindings[leaf] = select.value
  }
  return bindings
}

/** Rebind `pane`'s own selector to `(leg, session)` — the gesture a user makes through the control,
 * not a direct write to whatever `main.ts` holds underneath it. */
const pickBinding = (pane: HTMLElement, target: { leg: Leg; session: SessionId }): void => {
  const select = pane.querySelector<HTMLSelectElement>('.pane-binding select')
  if (select === null) throw new Error('no binding selector on this pane')
  select.value = optionValue(target.leg, target.session)
  select.dispatchEvent(new Event('change'))
}

/** Wait until the TM pane's own text stops changing — `tm-scratch-fork.test.ts`'s own `settleOn`,
 * scoped the same way and for the same reason: the source session keeps recording its own λ leg
 * throughout, which would starve a document-wide quiescence check of ever settling. */
async function settleOn(snapshot: () => string, timeoutMs = 60_000): Promise<void> {
  const started = performance.now()
  let last = snapshot()
  let stableSince = performance.now()
  while (performance.now() - stableSince < 500) {
    if (performance.now() - started > timeoutMs) throw new Error('timed out waiting for the TM pane to settle')
    await new Promise((r) => setTimeout(r, 30))
    const now = snapshot()
    if (now !== last) {
      last = now
      stableSince = performance.now()
    }
  }
}

type App = {
  compiled(): Promise<void>
  settled(): Promise<void>
  tmPane(): HTMLElement
  buffersButton(): HTMLButtonElement
  buffersMenu(): HTMLElement
  bufferRows(): HTMLElement[]
  paneBindings(): Record<string, string>
  pickBinding(pane: HTMLElement, target: { leg: Leg; session: SessionId }): void
}

let view: EditorView
let mounted = false

/**
 * Load `src` into the app's one source editor, mounting the app itself on the first call in this file
 * (`main()` runs once per page) and reusing the already-mounted page on every later one — the idiom
 * every sibling in this directory states.
 */
async function mountApp(src: string): Promise<App> {
  if (!mounted) {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    mounted = true
  }
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })

  return {
    compiled: () => until(idle, `the app to settle on \`${src}\``),
    settled: () => settleOn(() => tmPaneHost().textContent ?? ''),
    tmPane: tmPaneHost,
    buffersButton,
    buffersMenu,
    bufferRows,
    paneBindings,
    pickBinding,
  }
}

describe('the blank TM buffer', () => {
  /**
   * **THE HOLE THIS TASK EXISTS TO CLOSE.** Every other buffer test forks first, so none of them can
   * see that the menu is unreachable at zero — which is precisely when a user wants this control.
   */
  it('opens the buffers menu with no buffers at all', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    const button = app.buffersButton()
    expect(button.hidden).toBe(false)
    button.click()
    expect(app.buffersMenu().querySelector('button.new-tm')).not.toBeNull()
  })

  it('mints a warm TM buffer and binds no pane to it', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    const boundBefore = app.paneBindings()
    app.buffersButton().click()
    app.buffersMenu().querySelector<HTMLButtonElement>('button.new-tm')?.click()
    await app.settled()
    expect(app.bufferRows()).toHaveLength(1)
    expect(app.paneBindings()).toEqual(boundBefore)
  })

  it('binds a TM pane to it through the binding selector', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    app.buffersButton().click()
    app.buffersMenu().querySelector<HTMLButtonElement>('button.new-tm')?.click()
    await app.settled()
    app.pickBinding(app.tmPane(), { leg: 'tm', session: 'scratch-1' })
    await app.settled()
    expect(app.tmPane().querySelector('.cm-editor')).not.toBeNull()
  })

  /**
   * **RETIRING THE LAST BUFFER NO LONGER STRANDS FOCUS**, because the button no longer disappears —
   * accessibility list item 1, one instance retired. Pinned so a future re-hide is caught.
   *
   * **THIS TEST DID NOT REACH ZERO BUFFERS UNTIL THIS ROUND, EVEN THOUGH ITS NAME AND THE PARAGRAPH
   * ABOVE ALWAYS SAID IT DID — a fix-round finding.** `buffersButton.hidden = live === 0` was
   * reintroduced by hand and this test still passed, because this file's own buffers accumulate across
   * its tests by design (this file's own doc) and this test used to retire only the buffer it had just
   * minted: by the time it ran, two buffers from earlier tests were already live (`scratch-1`, bound to
   * the TM pane by the previous test, and `scratch-2`, that same test's own orphan), so one retire left
   * two live, not zero — the state this test's name describes was never actually reached. The real
   * regression guard was `scratch-buffers.test.ts`'s own STAGE 3, which does retire down to zero and
   * does fail when the bug is reintroduced. Fixed here by retiring every buffer the page holds, counted
   * off the open list rather than assumed, so the state this test drives to is the state it claims to.
   *
   * **`button.buffer-retire`, NOT `button.retire`** — `buffer-list.ts`'s `bufferRow` gives the retire
   * control the class `buffer-retire`; `.retire` matches nothing, and a query that finds nothing here
   * would still pass this test on a build where the last buffer was never actually retired.
   *
   * **`.focus()` BEFORE EVERY OPEN, WHICH THE BRIEF'S OWN TEST CODE DID NOT CALL FOR — VERIFIED
   * AGAINST THE TREE RATHER THAN TAKEN ON FAITH.** A bare scripted `.click()` does not focus its target
   * in this tier (`scratch-buffers.test.ts`'s own STAGE 2 comment: "a pointer press focuses the button
   * and so does Enter on a tabbed-to one," neither of which a synthetic `.click()` is), so without this
   * the popover's hide algorithm has nothing recorded as "focus was inside the popover" to hand back —
   * `document.activeElement` is `<body>` both before and after a retire, which would pass the final
   * assertion for no reason connected to the fix. Measured on the single-retire version of this test: it
   * failed on exactly that line, on the fully fixed source, until the explicit `.focus()` was added — the
   * same precondition `scratch-buffers.test.ts`'s own STAGE 3 assertion depends on, repeated here before
   * every retire in the loop rather than only the last.
   */
  it('keeps focus on the buffers button when the last buffer is retired', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    app.buffersButton().click()
    app.buffersMenu().querySelector<HTMLButtonElement>('button.new-tm')?.click()
    await app.settled()

    // RETIRE EVERY BUFFER ON THE PAGE, NOT ONLY THE ONE JUST MINTED — read off the open list rather
    // than assumed, since this file's own buffers accumulate across tests (this file's own doc) and by
    // this test there are already two live before the mint above.
    const toRetire = app.bufferRows().length
    for (let n = 0; n < toRetire; n++) {
      app.buffersButton().focus()
      if (app.buffersButton().getAttribute('aria-expanded') !== 'true') app.buffersButton().click()
      const row = app.buffersMenu().querySelector<HTMLButtonElement>('button.buffer-retire')
      if (row === null) throw new Error('the open list has rows left to retire but no retire control')
      row.click()
      await app.settled()
    }

    expect(app.bufferRows()).toHaveLength(0)
    expect(app.buffersButton().hidden).toBe(false)
    expect(document.activeElement).toBe(app.buffersButton())
  })
})
