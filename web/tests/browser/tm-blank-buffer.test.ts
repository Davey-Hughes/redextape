import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import type { Leg } from '../../src/protocol'
import type { SessionId } from '../../src/session-client'
import { pickSessionBinding } from './binding-fixture'
import { bufferRows, buffersButton, buffersMenu, idle, SHELL, tmPaneHost, until } from './harness'

/**
 * **THE SECOND GESTURE — 5d-iv design §4.7.** The fork detaches a pane onto a copy of what it was showing
 * and is refused above `MAX_FORK_RULES`; this is the OTHER door, always available, for a user who has
 * nothing on screen to fork from and wants somewhere to paste a `.tm` file `tm_emit` produced:
 * `scratch.ts`'s `ScratchBuffers.forkBlank`.
 *
 * **`mountApp` IS THIS FILE'S OWN, NOT `tm-scratch-fork.test.ts`'S, EVEN THOUGH THE IDLE POLL IS
 * IDENTICAL.** That file's helper has no route to the buffers button, the popover, a row count or the
 * binding selector. Duplicating the MOUNT rather than importing it is deliberate: each browser test file
 * gets its own page (`main()` runs once per module load), so a shared mount would be a shared page two
 * files could not both own. That argument reaches the mount and stops there — `SHELL` and `until` are an
 * inert string and a pure poll helper, share no page, and live in `tests/browser/harness.ts`.
 *
 * ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives: ES module imports are cached, so `main()`
 * runs once per page and Vitest gives each test FILE its own page. Each `it` below calls `mountApp`
 * again; only the first call actually imports `../../src/main` and the rest reuse the page, loading a
 * fresh source program the way `tm-scratch-fork.test.ts`'s own `mountApp` does.
 *
 * **NOTHING HERE RETIRES A BUFFER BETWEEN TESTS, SO THEY ACCUMULATE — AND THE THIRD TEST'S HARD-CODED
 * `scratch-1` DEPENDS ON THAT.** The second test mints the first buffer this file ever mints, which
 * `ScratchBuffers.#minted` names `scratch-1`; the third test mints a second of its own (unused, left
 * orphan) and then binds the TM pane to `scratch-1` — the SECOND test's buffer, still live, not the
 * one it just minted. A reset between tests would retire that buffer out from under the third test's own
 * assertion, so there is deliberately none. The fourth test therefore retires every buffer the open list
 * shows, not only the one it mints.
 */

/**
 * Every mounted view's current binding, keyed by leaf id — read off the title-selector's own
 * `data-binding` rather than tracked separately, so `it('mints a warm TM buffer...')`'s "nothing
 * rebound" claim is a fact about the DOM rather than about a value this file kept on the side.
 *
 * A LEAF WITH NO TITLE-SELECTOR CONTRIBUTES NOTHING: the source view's title is plain text, and a view
 * with one pair on offer shows its title as plain text too.
 */
const paneBindings = (): Record<string, string> => {
  const bindings: Record<string, string> = {}
  for (const pane of document.querySelectorAll<HTMLElement>('[data-leaf]')) {
    const leaf = pane.dataset.leaf
    const title = pane.querySelector<HTMLButtonElement>('button.view-title')
    if (leaf !== undefined && title !== null) bindings[leaf] = title.dataset.binding ?? ''
  }
  return bindings
}

/** Wait until the TM pane's own text stops changing. */
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
 * (`main()` runs once per page) and reusing the already-mounted page on every later one.
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
    pickBinding: pickSessionBinding,
  }
}

describe('the blank TM buffer', () => {
  /**
   * **THE MENU OPENS WITH NO BUFFERS AT ALL**, which is precisely when a user wants this control; a buffer
   * test that forks first cannot see whether it does.
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
   * **RETIRING THE LAST BUFFER DOES NOT STRAND FOCUS**, because the button does not disappear at zero buffers.
   *
   * **IT RETIRES EVERY BUFFER THE PAGE HOLDS, COUNTED OFF THE OPEN LIST.** This file's own buffers
   * accumulate across its tests by design (this file's own doc), so retiring only the buffer this test
   * mints would leave earlier ones live and never reach the state this test's name describes: the test
   * would pass on a build that hid the button at zero (`buffersButton.hidden = live === 0`).
   *
   * **`button.buffer-delete`, NOT `button.retire`** — `buffer-list.ts`'s `bufferRow` gives the delete
   * control the class `buffer-delete`; `.retire` matches nothing, and a query that finds nothing here
   * would still pass this test on a build where the last copy was never actually deleted.
   *
   * **`.focus()` BEFORE EVERY OPEN.** A bare scripted `.click()` does not focus its target in this tier
   * (`scratch-buffers.test.ts`'s own STAGE 2 comment: "a pointer press focuses the button and so does
   * Enter on a tabbed-to one," neither of which a synthetic `.click()` is), so without this the popover's
   * hide algorithm has nothing recorded as "focus was inside the popover" to hand back, and
   * `document.activeElement` is `<body>` both before and after a retire: the final assertion would fail on
   * a build with nothing wrong. It is the same precondition `scratch-buffers.test.ts`'s own STAGE 3
   * assertion depends on, repeated here before every retire in the loop rather than only the last.
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
      const row = app.buffersMenu().querySelector<HTMLButtonElement>('button.buffer-delete')
      if (row === null) throw new Error('the open list has rows left to retire but no retire control')
      row.click()
      await app.settled()
    }

    expect(app.bufferRows()).toHaveLength(0)
    expect(app.buffersButton().hidden).toBe(false)
    expect(document.activeElement).toBe(app.buffersButton())
  })
})
