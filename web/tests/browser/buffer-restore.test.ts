import { beforeAll, describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY, serializeBuffers } from '../../src/buffers-store'
import { LAYOUT_STORAGE_KEY, serializeLayout } from '../../src/layout'
import { bindingKey } from '../../src/view-header'
import { storedBuffers } from './copy-text-fixture'
import { lambdaEditorDoc } from './editor-view-fixture'
import {
  buffersControl,
  fourViews,
  lambdaHeading,
  lambdaTermText,
  pickBinding,
  rowNames,
  SHELL,
  until,
} from './harness'

/**
 * **BUFFERS SURVIVING A RELOAD, THROUGH `main()`** — 5d-ii-d design §4.9.
 *
 * **A "RELOAD" CANNOT BE SIMULATED BY MOUNTING TWICE, WHICH IS WHAT SHAPES THIS WHOLE FILE.** ES module
 * imports are cached, so `main()` runs once per page and Vitest gives each test FILE its own page —
 * `app.test.ts` states the same idiom. So the restore path is exercised by SEEDING THE STORE BEFORE THE
 * SINGLE MOUNT, which is strictly better than a second mount would have been: what `main()` reads is
 * exactly the bytes a previous page load would have left, produced by the app's own `serializeBuffers`
 * rather than by a hand-written literal.
 *
 * IT SUBSTITUTES NO `Storage` OF ITS OWN — every browser test file gets one, installed in
 * `tests/browser/setup.ts` before this file's own module body runs. That file's doc carries the argument
 * in full: `localStorage` is scoped to an ORIGIN, not to a test file, and Vitest runs browser files
 * concurrently in one origin, so a payload written into the real store would be visible to every sibling
 * that mounts `main()` — `scratch-fork.test.ts`, `scratch-cap.test.ts` and the rest all assume a page that
 * has never forked. The seeding goes straight through `localStorage`, which is that per-file shim by the
 * time this line runs.
 *
 * **THE CORRUPT-PAYLOAD FALLBACK IS A SEPARATE FILE** (`buffer-restore-invalid.test.ts`) for the one
 * reason that cannot be worked around: it needs `localStorage` to hold something DIFFERENT at the moment
 * of the mount, and there is only one mount per file.
 */

/**
 * **THE STATE A PREVIOUS PAGE LOAD WOULD HAVE LEFT: two buffers, one of them bound.**
 * `scratch-1` is an orphan — forked, then the pane moved on — and `scratch-2` is what `lambda-0`
 * was showing. Seeded rather than produced by forking twice, because this file gets ONE mount and
 * the restore path is what is under test.
 *
 * BUILT WITH `serializeBuffers` RATHER THAN AS A STRING LITERAL, for `layout-restore.test.ts`'s reason:
 * the stored bytes are then exactly what the app writes, so `parseBuffers` accepting them proves
 * something about the app rather than about this file's spelling of an envelope.
 *
 * **THE THIRD BINDING IS A BINDING THE TREE MUST REFUSE.** `tm-0` is a TM leaf in `fourViews()`, and a
 * scratch buffer has exactly one leg — `lambda`, for both of these. Seeded without `main.ts`'s leaf-kind
 * guard, `applyLayout` would build a `PaneSlot('tm', 'scratch-1')` and the first `draw()` would throw
 * `session scratch-1 has no tm leg` out of `main()` itself: every test in this file would report as a
 * SKIP under one failed suite, which is what a whole page dying looks like from here. `parseBuffers`
 * cannot catch it — a binding names a leaf and a session and carries no leg (design §4.1) — so the tree
 * is the only thing that can, and this line is what makes it answer. The assertions below pin both
 * halves of the answer — `tm-0` gets no pane binding, and `scratch-1` is therefore still an orphan and
 * still asleep.
 *
 * **`scratch-2` CARRIES `collapsed: true` — 5d-ii-d design §4.7's fixture.** It is the ONE bound
 * buffer, so it is the only one whose editor this file can ever observe mounted at all; a `collapsed`
 * on the orphan `scratch-1` would assert nothing, since an orphan's editor never mounts until something
 * warms it. See the two tests near the end of this file for what rides on it.
 */
const SEEDED = serializeBuffers({
  minted: 2,
  buffers: [
    // STORED THE WAY A PAGE BEFORE PLAN 7 PART 2 WROTE THEM, so the restore's rename is exercised: the
    // rows below read `copy N` (spec §12).
    { id: 'scratch-1', label: 'λ scratch 1', text: '(\\a. a)', collapsed: false, leg: 'lambda' },
    { id: 'scratch-2', label: 'λ scratch 2', text: '(\\b. b) (\\c. c)', collapsed: true, leg: 'lambda' },
  ],
  bindings: { 'lambda-0': 'scratch-2', 'tm-0': 'scratch-1' },
})

// SEEDED BEFORE THE MOUNT, not in a `beforeEach` — `main()` reads both keys exactly once, synchronously,
// while resolving `let tree` and the restore beside it, so anything written after that read is never
// seen. The layout key is seeded rather than merely cleared so that `lambda-0` is a leaf this file can
// count on: the bindings above name it, and a tree left over from a sibling would not have it.
beforeAll(async () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(fourViews()))
  localStorage.setItem(BUFFERS_STORAGE_KEY, SEEDED)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
})

const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row')]

/**
 * Open the header's buffer list, leaving it open if it already is.
 *
 * IDEMPOTENT BECAUSE THE POPOVER SURVIVES A TEST BOUNDARY. There is one page for the file, so a second
 * bare `click()` would TOGGLE the list shut and every row query after it would answer nothing — a
 * failure that reads like a missing buffer rather than like a closed menu.
 */
async function openList(): Promise<HTMLElement[]> {
  const button = buffersControl()
  if (button === null) throw new Error('no #buffers button in the header')
  if (button.getAttribute('aria-expanded') !== 'true') button.click()
  await until(() => rows().length > 0, 'the buffer list to open')
  return rows()
}

/**
 * Close the list and open it again, answering each row's term line.
 *
 * **A ROW IS BUILT PER OPEN AND NEVER REPAINTED BY `draw()` WHILE IT IS SHOWING** — `bufferList`'s rows
 * thunk is called from `beforetoggle` (and from a temperature or delete click's own rebuild), and `draw()`
 * does not touch the list at all. So a term that arrives from a worker while the popover is open lands
 * nowhere until the popover is opened again or a click rebuilds it, and a poll that only re-read the DOM
 * would spin until it timed out against a list that was never going to change. Reopening is what a user
 * does, and it is what makes the term readable.
 */
const termsAfterReopen = (): (string | null)[] => {
  const button = buffersControl()
  if (button === null) throw new Error('no #buffers button in the header')
  if (button.getAttribute('aria-expanded') === 'true') button.click()
  button.click()
  return [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row-term')].map((e) => e.textContent)
}

describe('buffers restored from storage', () => {
  /**
   * **THE RESTORE POLICY, READ OFF THE ONE SURFACE TEMPERATURE HAS** (design §4.2): a buffer a restored
   * pane names gets a worker, and a buffer nobody is showing comes back as text with no session. That is
   * what makes the load cost exactly the workers the layout needs rather than one per stored buffer.
   *
   * **OPENING THE LIST AT ALL IS PART OF THE ASSERTION**: a row builder that reached `sessions.legOf(...)`
   * for a cold buffer would throw out of a `beforetoggle` handler — on this exact page, since a restored
   * orphan is the cheapest way to produce a cold buffer at all.
   */
  it('restores both buffers and warms only the one a pane names', async () => {
    // **THE RESTORE'S OWN WRITE OF THE BINDINGS — the one `main()`'s first `applyLayout()` makes, through
    // `pane-host.ts`'s `persistBindings()` — PINNED HERE BECAUSE HERE IS BEFORE ANY REPLY CAN LAND.**
    // On a page opened without a link, `main()`'s only `await` is `init()`, so everything from the restore
    // block through that write runs in one synchronous continuation — no worker `message` event (a
    // macrotask) is processed until `main()` returns, and the `beforeAll` above awaits exactly that
    // return. Reading `storedBuffers()` here, before this test's own first `await`, therefore reads the
    // bindings `persistBuffers()` wrote from `panes.all()` once `applyLayout()` had built the panes — a write
    // `refreshBuffers()`'s own start-up call cannot have made, since that one runs before a
    // single pane exists and always writes `bindings: {}`. The later test with a similar-looking assertion
    // (`writes a payload naming both restored buffers…`) cannot tell the two apart, because by the time IT
    // runs a `scratch-compiled` reply has already landed and persisted through that arm's own
    // `onBuffersPersist()` call to the same `persistBuffers`.
    //
    // CITED BY SYMBOL RATHER THAN BY LINE: a symbol moves with its code; a number does not.
    expect(storedBuffers()?.bindings).toEqual({ 'lambda-0': 'scratch-2' })

    const list = await openList()
    expect(list).toHaveLength(2)
    // `· paused` IS `buffer-list.ts`'s COLD MARKER and `· not shown` its no-panes one; both are true of
    // `scratch-1` and neither is true of `scratch-2`, which came back with the pane that named it.
    //
    // **`· not shown` IS ALSO THE REFUSED `tm-0` BINDING, READ OFF THE ONLY SURFACE THAT COUNTS PANES.**
    // `SEEDED` names `tm-0 → scratch-1`; a version that seeded it would either have killed the page
    // (see `SEEDED`'s own doc) or, guarded elsewhere, left this row reading `1 view`.
    expect(rowNames()).toEqual(['λ copy 1 · not shown · paused', 'λ copy 2 · 1 view'])
    // AND THE TM PANE IS ON THE SOURCE SESSION, which is what `· not shown` means from the pane's side:
    // a δ-table is rendered there, which a λ-only buffer could never have supplied.
    expect(document.querySelector('[data-leaf="tm-0"] .view-status')).toBeNull()
    expect(document.querySelector('[data-leaf="tm-0"] .view-title')?.textContent).toBe('TM · program')
  })

  /**
   * THE BOUND PANE IS ON ITS RESTORED BUFFER AND SHOWING ITS RESTORED TERM — the two halves of a
   * binding surviving, asserted separately because either can hold without the other: a pane bound to a
   * warm buffer that never rebuilt shows the `building…` placeholder forever, and a buffer rebuilt with
   * nothing pointing at it leaves this pane on the source session.
   *
   * `λc` RATHER THAN THE `\c` THE SEED IS SPELLED WITH. The parser accepts a backslash binder and the
   * PRINTER never emits one (`crates/redextape-core/src/lambda/syntax.rs`: "the printer must not emit a
   * backslash binder"), so the rendered term of `(\b. b) (\c. c)` names its binders with `λ`. The seed
   * keeps the ASCII spelling because that is what a user types.
   */
  it('the bound pane shows the restored term rather than the sample program', async () => {
    await until(() => lambdaTermText() !== '', 'the restored buffer to rebuild and produce a frame')
    // A SCRATCH SESSION, NOT THE SOURCE ONE — `copy · not linked` is the view's status for a view bound to a
    // session that can never take part in the link (5d-i design §4.5), which every buffer is and the
    // source session never is. Without this the assertion below would be satisfied by any λ term at all.
    expect(lambdaHeading()).toContain('copy · not linked')
    expect(lambdaTermText()).toContain('λc')
  })

  /**
   * **THE FULL SHAPE OF THE PERSISTED PAYLOAD, NOT THE TIMING PROOF.** By the point THIS test runs, the
   * test above it has already awaited a `scratch-compiled` reply, which persists on its own (that arm's
   * `onBuffersPersist()`, through the very same `persistBuffers` closure the restore's write calls) —
   * so this assertion would pass whether or not that write exists. The timing claim — that the restore's
   * write, not a later reply, is what put the binding in storage — is pinned in the FIRST test above
   * instead, which reads `storedBuffers()` before its own first `await` and so before any reply-driven
   * persist could have run. What this test earns its keep on is the payload's OTHER fields: both
   * restored buffer ids survive, in order, and `minted` comes back as the counter rather than the count.
   */
  it('writes a payload naming both restored buffers, with the binding read off the pane', () => {
    expect(storedBuffers()?.buffers.map((b) => b.id)).toEqual(['scratch-1', 'scratch-2'])
    // THE COUNTER, NOT THE COUNT — a page that restores two buffers and mints its next one as
    // `copy 2` would put two different terms under one name across a reload.
    expect(storedBuffers()?.minted).toBe(2)
    expect(storedBuffers()?.bindings['lambda-0']).toBe('scratch-2')
  })

  /**
   * **THE ORPHAN'S WAY BACK, THROUGH `main.ts`'s TEMPERATURE HANDLER IN THE APP.**
   * `buffer-list.test.ts` drives the control against a fixture, which pins the button and the callback;
   * what only this tier can say is that the callback reaches `ScratchBuffers.warm`, that the warm
   * rebuilds from the PERSISTED text rather than from nothing, and that the row redraws around it.
   *
   * A RESTORED COLD BUFFER IS THE SHARPEST INPUT FOR IT: its text has been through
   * `serializeBuffers`/`parseBuffers` and has never been in a worker on this page, so a `warm` that
   * rebuilt from a live session's state instead of from `text` has nothing to accidentally succeed with.
   */
  it('warming the restored orphan from its row gives it a session built from its persisted text', async () => {
    await openList()
    const warm = document.querySelector<HTMLButtonElement>('button[aria-label="resume λ copy 1 — restarts at step 0"]')
    expect(warm).not.toBeNull()
    warm?.click()

    // SYNCHRONOUS, AND THAT IS THE ASSERTION: `handleTemperature` rebuilds the rows around the caller's
    // own handler returning, so the row is already redrawn by the time this line runs. A `until` here
    // would hide a version that redrew a frame later or not at all.
    expect(rowNames()[0]).toBe('λ copy 1 · not shown')

    await until(() => termsAfterReopen()[0] !== 'no term yet', 'the warmed orphan to rebuild its term')
    // `(\a. a)` PRINTED — the identity, from the text that was in `localStorage` and nowhere else.
    expect(termsAfterReopen()[0]).toContain('λa')
    // NOTHING WAS CREATED OR ENDED BY A WARM (`refreshBuffers`'s own doc: temperature cannot move the
    // count), and the stored payload says so — a warm that had forked instead would read three here.
    expect(storedBuffers()?.buffers.map((b) => b.id)).toEqual(['scratch-1', 'scratch-2'])
  })

  /**
   * **THE RESTORE-EDITOR MOUNT ITSELF, PINNED DIRECTLY.** A restored bound buffer's editor is mounted at
   * start-up by `pane-host.ts`'s creation pass, through `mountScratchEditor`, and `main.ts`'s claim loop
   * over `restoredBindings` is belt-and-braces behind it (that loop's own doc). The collapse test below
   * waits on the same mount before it asserts the collapse; this test pins the mount itself, and what the
   * mounted editor holds.
   *
   * **THE `expect`s BELOW ASSERT WHAT THE WAIT DOES NOT IMPLY.** Restating the predicate the
   * `await until(...)` has just proved, with no `await` between them on a single-threaded page, is an
   * assertion that cannot fail: the only way to leave this test red would be the timeout, which says no
   * more than the wait already did. So what is asserted is that exactly one editor is mounted anywhere on
   * the page, and that it holds the buffer's restored term rather than some other buffer's.
   */
  it('a restored bound buffer mounts an editor onto its pane', async () => {
    await until(() => document.querySelector('[data-leaf="lambda-0"] .term-editor') !== null, 'an editor to mount')
    // EXACTLY ONE, ACROSS THE WHOLE PAGE. `SEEDED` restores two buffers and only `scratch-2` is bound, so
    // a second `.term-editor` would mean the orphan had been mounted somewhere it has no pane, or one
    // buffer's editor had been built twice — the state `LambdaPane.receiveEditor` throws on and
    // `setEditor`'s re-seed branch would absorb silently.
    expect(document.querySelectorAll('.term-editor')).toHaveLength(1)
    // AND IT HOLDS `scratch-2`'s OWN TEXT AS IT WAS STORED, read off CodeMirror rather than off the DOM's
    // text nodes, which are virtualized: `\c` is `SEEDED`'s spelling, and a reload that put the printer's
    // `λc` in its place fails here. The whole text and not a part of it, so it is not `scratch-1`'s either.
    expect(lambdaEditorDoc()).toBe('(\\b. b) (\\c. c)')
  })

  /**
   * **THE COLLAPSE STATE SURVIVES THE RELOAD IT WAS SEEDED ACROSS — 5d-ii-d design §4.7.**
   * `SEEDED`'s `scratch-2` carries `collapsed: true` (that block's own doc), and this is what proves the
   * round trip end to end rather than merely that the field parses: `ScratchBuffers.restore` puts it on
   * the `BufferState`, and `pane-host.ts`'s `mountScratchEditor` seeds the MOUNT with it, through
   * `ScratchBuffers.editorSeed`; `warm`'s build (through `main.ts`'s restore loop), once it reaches
   * `replies.ts`'s `scratch-compiled` arm, passes `LambdaPane.setEditor` the same flag
   * (`scratchpad.collapsedOf(session)`). `hidden` on the host is read here rather than toggled by this
   * test first, which is what makes this a restore assertion and not a click assertion.
   *
   * PLACED AFTER THE ORPHAN'S OWN WARM, NOT RIGHT AFTER THE TERM ASSERTION ABOVE, so that inserting it
   * does not change which test the payload assertion three above this one means by "the test above it" —
   * see that test's own doc.
   */
  it('the restored bound buffer comes back with its editor collapsed', async () => {
    await until(() => document.querySelector('[data-leaf="lambda-0"] .term-editor') !== null, 'an editor to mount')
    expect(document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor')?.hidden).toBe(true)
  })

  /**
   * **THE WRITE-BACK, THROUGH THE GESTURE A USER ACTUALLY MAKES.** `transport.ts`'s `collapse` handler
   * is the one path that can flip `scratch-2`'s stored `collapsed` back to `false` — a click on the
   * control the test above just found reading hidden (so the text panel's toggle reads
   * `aria-expanded="false"`), which is what makes this click an EXPAND.
   *
   * **WHAT IS ASSERTED IS WHAT THE WAIT CANNOT SAY**, for the reason the mount test two up gives: that
   * index 1 is the buffer this click was about (the wait indexes blindly — `buffers[1]` IS `scratch-2`
   * only by `SEEDED`'s own order, which nothing between there and here enforces), and that the SCREEN
   * agrees with the store, which is the whole content of "the write-back through the gesture a user
   * actually makes".
   */
  it('expanding it writes the new state back', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] [data-panel="text"] .panel-toggle')?.click()

    await until(() => storedBuffers()?.buffers[1]?.collapsed === false, 'the store to record the expand')

    expect(storedBuffers()?.buffers[1]?.id).toBe('scratch-2')
    expect(document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor')?.hidden).toBe(false)
  })

  /**
   * **THE FOURTH PERSIST SITE, WHICH CHANGES THE PAYLOAD WITHOUT CHANGING A
   * BUFFER** — `transport.ts`'s `rebind` handler, through the binding selector a user actually aims at.
   * Without it the stored `bindings` keep naming the session this pane was on BEFORE the pick, and the
   * next reload undoes the gesture with nothing on screen to say why.
   *
   * LAST IN THE FILE, because it is the one test that takes `lambda-0` off its restored buffer, and the
   * tests above that read that pane or its stored binding expect it on `scratch-2`.
   */
  it('a rebind moves the stored binding with the pane', async () => {
    pickBinding('lambda-0', bindingKey('lambda', 'source'))

    await until(() => storedBuffers()?.bindings['lambda-0'] === undefined, 'the stored binding to follow the pane')
    // AND THE BUFFER IS STILL THERE. Nothing ends a buffer implicitly (5d-ii-c decision 2), so a rebind
    // that dropped `scratch-2` from the payload would be an eviction wearing the name of a write.
    expect(storedBuffers()?.buffers.map((b) => b.id)).toEqual(['scratch-1', 'scratch-2'])
  })
})
