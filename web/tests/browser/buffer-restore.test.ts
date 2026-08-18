import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from '../../src/buffers-store'
import { defaultLayout, LAYOUT_STORAGE_KEY, serializeLayout } from '../../src/layout'

/**
 * **BUFFERS SURVIVING A RELOAD, THROUGH `main()`** — design §4.9, and the only exercise of that path.
 *
 * **A "RELOAD" CANNOT BE SIMULATED BY MOUNTING TWICE, WHICH IS WHAT SHAPES THIS WHOLE FILE.** ES module
 * imports are cached, so `main()` runs once per page and Vitest gives each test FILE its own page —
 * every sibling states the same idiom. So the restore path is exercised by SEEDING THE STORE BEFORE THE
 * SINGLE MOUNT, which is strictly better than a second mount would have been: what `main()` reads is
 * exactly the bytes a previous page load would have left, produced by the app's own `serializeBuffers`
 * rather than by a hand-written literal.
 *
 * IT NO LONGER SUBSTITUTES ITS OWN `Storage` — every browser test file gets one automatically now,
 * installed in `tests/browser/setup.ts` before this file's own module body runs. That file's doc carries
 * the argument in full: `localStorage` is scoped to an ORIGIN, not to a test file, and Vitest runs
 * browser files concurrently in one origin, so a payload written into the real store would be visible to
 * every sibling that mounts `main()` — `scratch-fork.test.ts`, `scratch-cap.test.ts` and the rest all
 * assume a page that has never forked. What is left here is just the seeding, straight through
 * `localStorage`, which is that per-file shim by the time this line runs.
 *
 * **THE CORRUPT-PAYLOAD FALLBACK IS A SEPARATE FILE** (`buffer-restore-invalid.test.ts`) for the one
 * reason that cannot be worked around: it needs `localStorage` to hold something DIFFERENT at the moment
 * of the mount, and there is only one mount per file.
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
 * **THE THIRD BINDING IS A BINDING THE TREE MUST REFUSE, AND IT IS HERE BECAUSE IT KILLED THE PAGE.**
 * `tm-0` is a TM leaf in `defaultLayout()`, and a scratch buffer has exactly one leg — `lambda`. Seeded
 * without `main.ts`'s leaf-kind guard, `applyLayout` built a `PaneSlot('tm', 'scratch-1')` and the first
 * `draw()` threw `session scratch-1 has no tm leg` out of `main()` itself: every test in this file
 * reported as a SKIP under one failed suite, which is what a whole page dying looks like from here.
 * `parseBuffers` cannot catch it — the payload carries no leg (design §4.1) — so the tree is the only
 * thing that can, and this line is what makes it answer.
 *
 * **IT IS REACHABLE WITHOUT A HAND-EDITED KEY**: bind a λ pane to a buffer, switch that pane to TM
 * through the picker (which persists the TREE and not the buffers), and reload before anything else
 * writes the buffers key. The assertions below pin both halves of the answer — `tm-0` gets no pane
 * binding, and `scratch-1` is therefore still an orphan and still asleep.
 *
 * **`scratch-2` CARRIES `collapsed: true` — 5d-ii-d T9, design §4.7's fixture.** It is the ONE bound
 * buffer, so it is the only one whose editor this file can ever observe mounted at all; a `collapsed`
 * on the orphan `scratch-1` would assert nothing, since an orphan's editor never mounts until something
 * warms it. See the two tests near the end of this file for what rides on it.
 */
const SEEDED = serializeBuffers({
  minted: 2,
  buffers: [
    { id: 'scratch-1', label: 'scratch 1', text: '(\\a. a)', collapsed: false, leg: 'lambda' },
    { id: 'scratch-2', label: 'scratch 2', text: '(\\b. b) (\\c. c)', collapsed: true, leg: 'lambda' },
  ],
  bindings: { 'lambda-0': 'scratch-2', 'tm-0': 'scratch-1' },
})

async function until(predicate: () => boolean, what: string, timeoutMs = 60_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

// SEEDED BEFORE THE MOUNT, not in a `beforeEach` — `main()` reads both keys exactly once, synchronously,
// while resolving `let tree` and the restore beside it, so anything written after that read is never
// seen. The layout key is seeded rather than merely cleared so that `lambda-0` is a leaf this file can
// count on: the bindings above name it, and a tree left over from a sibling would not have it.
beforeAll(async () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(defaultLayout()))
  localStorage.setItem(BUFFERS_STORAGE_KEY, SEEDED)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
})

const buffersButton = () => document.querySelector<HTMLButtonElement>('#buffers')
const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row')]
/** What each row READS, which is what §5 requires an assertion about a buffer to be made against. */
const rowNames = (): (string | null)[] =>
  [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row-name')].map((e) => e.textContent)
const term = () => document.querySelector('[data-leaf="lambda-0"] .term')?.textContent ?? ''
const heading = () => document.querySelector('[data-leaf="lambda-0"] h2')?.textContent ?? ''
const stored = () => parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))
/** `\x00` as an escape rather than the byte — `scripts/check-text-bytes.sh`'s rule. */
const optionValue = (leg: string, id: string) => `${leg}\x00${id}`

/** What the mounted editor actually holds. Read off CodeMirror rather than off the DOM, whose text
 * nodes are virtualized and would answer only the visible lines. */
function editorDoc(): string {
  const host = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor')
  if (host === null) throw new Error('no scratch editor mounted under [data-leaf="lambda-0"]')
  const cmView = EditorView.findFromDOM(host)
  if (cmView === null) throw new Error('no CodeMirror view mounted under the editor host')
  return cmView.state.doc.toString()
}

/**
 * Open the header's buffer list, leaving it open if it already is.
 *
 * IDEMPOTENT BECAUSE THE POPOVER SURVIVES A TEST BOUNDARY. There is one page for the file, so a second
 * bare `click()` would TOGGLE the list shut and every row query after it would answer nothing — a
 * failure that reads like a missing buffer rather than like a closed menu.
 */
async function openList(): Promise<HTMLElement[]> {
  const button = buffersButton()
  if (button === null) throw new Error('no #buffers button in the header')
  if (button.getAttribute('aria-expanded') !== 'true') button.click()
  await until(() => rows().length > 0, 'the buffer list to open')
  return rows()
}

/**
 * Close the list and open it again, answering each row's term line.
 *
 * **A ROW IS BUILT PER OPEN AND NEVER REPAINTED WHILE IT IS SHOWING** — `bufferList`'s rows thunk is
 * called from `beforetoggle` (and from a temperature click's own rebuild), and `draw()` does not touch
 * the list at all. So a term that arrives from a worker while the popover is open lands nowhere until
 * the popover is opened again, and a poll that only re-read the DOM would spin until it timed out
 * against a list that was never going to change. Reopening is what a user does, and it is what makes
 * the term readable.
 */
const termsAfterReopen = (): (string | null)[] => {
  const button = buffersButton()
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
   * **OPENING THE LIST AT ALL IS PART OF THE ASSERTION.** Before this slice's T4 gave the row builder its
   * `warm` branch, a cold buffer reached an unguarded `sessions.legOf(...)` and threw out of a
   * `beforetoggle` handler — on this exact page, since a restored orphan is the cheapest way to produce
   * a cold buffer at all.
   */
  it('restores both buffers and warms only the one a pane names', async () => {
    // **THE WRITE-BACK AT THE END OF `main()` — the `persistBuffers()` immediately after the restore's
    // own `custody.claim` loop — PINNED HERE BECAUSE HERE IS BEFORE ANY REPLY CAN LAND.**
    // `main()`'s only `await` is `init()`, so everything from the restore block through that write-back
    // runs in one synchronous continuation — no worker `message` event (a
    // macrotask) is processed until `main()` returns, and the `beforeAll` above awaits exactly that
    // return. Reading `stored()` here, before this test's own first `await`, therefore reads the
    // bindings `persistBuffers()` wrote from `panes.all()` AFTER the first `applyLayout()` — a write
    // `refreshBuffers()`'s own start-up call cannot have made, since that one runs before a
    // single pane exists and always writes `bindings: {}`. Delete that final `persistBuffers()` and this
    // line sees `{}` instead of the binding below; the later test with a similar-looking assertion
    // (`writes a payload naming both restored buffers…`) cannot tell the two apart, because by the time
    // IT runs a `scratch-compiled` reply has already landed and persisted through that arm's own
    // `onBuffersPersist()` call to the same `persistBuffers`.
    //
    // CITED BY SYMBOL RATHER THAN BY LINE — the whole-branch review before merge found seven `file:line`
    // citations in this file and all seven had drifted, every one of them undershooting because the file
    // they name grew above the line they name. A symbol moves with its code; a number does not.
    expect(stored()?.bindings).toEqual({ 'lambda-0': 'scratch-2' })

    const list = await openList()
    expect(list).toHaveLength(2)
    // `— asleep` IS `buffer-list.ts`'s COLD MARKER and `— orphan` its no-panes one; both are true of
    // `scratch-1` and neither is true of `scratch-2`, which came back with the pane that named it.
    //
    // **`— orphan` IS ALSO THE REFUSED `tm-0` BINDING, READ OFF THE ONLY SURFACE THAT COUNTS PANES.**
    // `SEEDED` names `tm-0 → scratch-1`; a version that seeded it would either have killed the page
    // (it did — see `SEEDED`'s own doc) or, guarded elsewhere, left this row reading `1 pane`.
    expect(rowNames()).toEqual(['scratch 1 — orphan — asleep', 'scratch 2 — 1 pane'])
    // AND THE TM PANE IS ON THE SOURCE SESSION, which is what `— orphan` means from the pane's side:
    // a δ-table is rendered there, which a λ-only buffer could never have supplied.
    expect(document.querySelector('[data-leaf="tm-0"] .detached-badge')).toBeNull()
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
    await until(() => term() !== '', 'the restored buffer to rebuild and produce a frame')
    // A SCRATCH SESSION, NOT THE SOURCE ONE — `[detached]` is `LambdaPane`'s badge for a pane bound to a
    // session that can never take part in the link (design §4.5), which every buffer is and the source
    // session never is. Without this the assertion below would be satisfied by any λ term at all.
    expect(heading()).toContain('[detached]')
    expect(term()).toContain('λc')
  })

  /**
   * **THE FULL SHAPE OF THE PERSISTED PAYLOAD, NOT THE TIMING PROOF.** This used to claim to be "the
   * state under test" for the write-back at the end of `main()`, on the reasoning that "nothing here
   * clicks anything, deliberately". That reasoning was false: by the point THIS test runs, the test
   * above it has already awaited a `scratch-compiled` reply, which persists on its own (that arm's
   * `onBuffersPersist()`, through the very same `persistBuffers` closure `main()`'s write-back calls) —
   * so this assertion would pass whether or not that write-back exists, and a click was never what made the
   * difference. The timing claim — that the write-back, not a later reply, is what put the binding in
   * storage — is pinned in the FIRST test above instead, which reads `stored()` before its own first
   * `await` and so before any reply-driven persist could have run. What this test still earns its keep
   * on is the payload's OTHER fields: both restored buffer ids survive, in order, and `minted` comes
   * back as the counter rather than the count.
   */
  it('writes a payload naming both restored buffers, with the binding read off the pane', () => {
    expect(stored()?.buffers.map((b) => b.id)).toEqual(['scratch-1', 'scratch-2'])
    // THE COUNTER, NOT THE COUNT — a page that restores two buffers and mints its next one as
    // `scratch 2` would put two different terms under one name across a reload.
    expect(stored()?.minted).toBe(2)
    expect(stored()?.bindings['lambda-0']).toBe('scratch-2')
  })

  /**
   * **THE ORPHAN'S WAY BACK, AND THE FIRST EXERCISE OF `main.ts`'s TEMPERATURE HANDLER THROUGH THE APP.**
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
    const warm = document.querySelector<HTMLButtonElement>('button[aria-label="warm scratch 1"]')
    expect(warm).not.toBeNull()
    warm?.click()

    // SYNCHRONOUS, AND THAT IS THE ASSERTION: `handleTemperature` rebuilds the rows around the caller's
    // own handler returning, so the row is already redrawn by the time this line runs. A `until` here
    // would hide a version that redrew a frame later or not at all.
    expect(rowNames()[0]).toBe('scratch 1 — orphan')

    await until(() => termsAfterReopen()[0] !== 'no term yet', 'the warmed orphan to rebuild its term')
    // `(\a. a)` PRINTED — the identity, from the text that was in `localStorage` and nowhere else.
    expect(termsAfterReopen()[0]).toContain('λa')
    // NOTHING WAS CREATED OR ENDED BY A WARM (`refreshBuffers`'s own doc: temperature cannot move the
    // count), and the stored payload says so — a warm that had forked instead would read three here.
    expect(stored()?.buffers.map((b) => b.id)).toEqual(['scratch-1', 'scratch-2'])
  })

  /**
   * **THE RESTORE-EDITOR MOUNT ITSELF, PINNED DIRECTLY — 5d-ii-d T9 fix round 1 (review finding 7).**
   * The unplanned fix beside `paneHost.applyLayout()` in `main.ts` (the `for (const [leaf, session] of
   * restoredBindings) custody.claim(session, leaf)` loop) is what makes a restored buffer's editor mount
   * at all; before it, `editorHomeFor` answered `undefined` for every restored session and
   * `replies.ts`'s `scratch-compiled` arm silently skipped `setEditor`. Until this test its only pin was
   * the `until(...)` inside the collapse test below, which asserts a state ONE STEP past the mount and
   * would read as an unrelated timeout — "the collapse never arrived" — rather than naming the defect
   * this catches: no `.term-editor` at all.
   *
   * **THE `expect` BELOW USED TO RESTATE THE PREDICATE THE `await until(...)` HAD JUST PROVED, WHICH IS
   * AN ASSERTION THAT CANNOT FAIL — whole-branch review before merge, finding 3a.** It read
   * `expect(document.querySelector('… .term-editor')).not.toBeNull()` on the line after a wait for
   * exactly that, with no `await` between them on a single-threaded page: the only way to leave this
   * test red was the 60 s timeout, which is precisely the "reads as an unrelated timeout" outcome the
   * paragraph above says this test exists to REPLACE. What is asserted instead is what the wait does not
   * imply — that exactly one editor is mounted anywhere on the page, and that it holds the buffer's
   * restored term rather than some other buffer's. Its sibling below already did this correctly (it
   * waits for the mount and asserts the COLLAPSE), which is what made the shape visible.
   */
  it('a restored bound buffer mounts an editor onto its pane', async () => {
    await until(() => document.querySelector('[data-leaf="lambda-0"] .term-editor') !== null, 'an editor to mount')
    // EXACTLY ONE, ACROSS THE WHOLE PAGE. `SEEDED` restores two buffers and only `scratch-2` is bound, so
    // a second `.term-editor` would mean the orphan had been mounted somewhere it has no pane, or one
    // buffer's editor had been built twice — the state `LambdaPane.receiveEditor` throws on and
    // `setEditor`'s re-seed branch would absorb silently.
    expect(document.querySelectorAll('.term-editor')).toHaveLength(1)
    // AND IT HOLDS `scratch-2`'s OWN RESTORED TERM, read off CodeMirror rather than off the DOM's text
    // nodes, which are virtualized. `\c` is `SEEDED`'s spelling and `λc` is the printer's, so this is the
    // seeded string having been through a worker and back rather than a literal echoed from storage.
    expect(editorDoc()).toContain('λc')
  })

  /**
   * **THE COLLAPSE STATE SURVIVES THE RELOAD IT WAS SEEDED ACROSS — 5d-ii-d T9, design §4.7.**
   * `SEEDED`'s `scratch-2` carries `collapsed: true` (that block's own doc), and this is what proves the
   * round trip end to end rather than merely that the field parses: `ScratchBuffers.restore` puts it on
   * the `BufferState`, `warm`'s build (through `main.ts`'s restore loop) reaches `replies.ts`'s
   * `scratch-compiled` arm, and `LambdaPane.setEditor`'s second parameter — `scratchpad.collapsedOf(session)`,
   * read at that same call — is what seeds the MOUNT with it. `.is-collapsed` on the host is read here
   * rather than toggled by this test first, which is what makes this a restore assertion and not a
   * click assertion.
   *
   * PLACED AFTER THE ORPHAN'S OWN WARM, NOT RIGHT AFTER THE TERM ASSERTION ABOVE, so that inserting it
   * does not change which test the payload assertion two above this one means by "the test above it" —
   * see that test's own doc.
   */
  it('the restored bound buffer comes back with its editor collapsed', async () => {
    await until(() => document.querySelector('[data-leaf="lambda-0"] .term-editor') !== null, 'an editor to mount')
    expect(document.querySelector('[data-leaf="lambda-0"] .term-editor')?.classList.contains('is-collapsed')).toBe(true)
  })

  /**
   * **THE WRITE-BACK, THROUGH THE GESTURE A USER ACTUALLY MAKES.** `transport.ts`'s `collapse` handler
   * is the one path that can flip `scratch-2`'s stored `collapsed` back to `false` — a click on the
   * control the test above just found reading `.is-collapsed` (so `collapseButton`'s own label reads
   * "show the term editor"), which is what makes this click an EXPAND.
   *
   * **THE `expect` USED TO RESTATE THE `until` PREDICATE, WHICH IS THE SAME DEAD SHAPE finding 3a NAMES
   * TWO TESTS UP — found by sweeping this branch's own files for it rather than by review.** It read
   * `expect(stored()?.buffers[1]?.collapsed).toBe(false)` on the line after
   * `await until(() => stored()?.buffers[1]?.collapsed === false, …)`, so only a timeout could make it
   * red. What is asserted instead is what the wait cannot say: that index 1 is the buffer this click was
   * about (the wait indexes blindly — `buffers[1]` IS `scratch-2` only by `SEEDED`'s own order, which
   * nothing between there and here enforces), and that the SCREEN agrees with the store, which is the
   * whole content of "the write-back through the gesture a user actually makes".
   */
  it('expanding it writes the new state back', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .collapse')?.click()

    await until(() => stored()?.buffers[1]?.collapsed === false, 'the store to record the expand')

    expect(stored()?.buffers[1]?.id).toBe('scratch-2')
    expect(document.querySelector('[data-leaf="lambda-0"] .term-editor')?.classList.contains('is-collapsed')).toBe(
      false,
    )
  })

  /**
   * **THE FOURTH PERSIST SITE, WHICH IS THE ONLY ONE THAT CHANGES THE PAYLOAD WITHOUT CHANGING A
   * BUFFER** — `transport.ts`'s `rebind` handler, through the binding selector a user actually aims at.
   * Without it the stored `bindings` keep naming the session this pane was on BEFORE the pick, and the
   * next reload undoes the gesture with nothing on screen to say why.
   *
   * LAST IN THE FILE, because it is the one test that takes `lambda-0` off its restored buffer and every
   * test above reads that pane.
   */
  it('a rebind moves the stored binding with the pane', async () => {
    const select = document.querySelector<HTMLSelectElement>('[data-leaf="lambda-0"] .pane-binding select')
    if (select === null) throw new Error('no binding selector on the λ pane')
    select.value = optionValue('lambda', 'source')
    select.dispatchEvent(new Event('change', { bubbles: true }))

    await until(() => stored()?.bindings['lambda-0'] === undefined, 'the stored binding to follow the pane')
    // AND THE BUFFER IS STILL THERE. Nothing ends a buffer implicitly (5d-ii-c decision 2), so a rebind
    // that dropped `scratch-2` from the payload would be an eviction wearing the name of a write.
    expect(stored()?.buffers.map((b) => b.id)).toEqual(['scratch-1', 'scratch-2'])
  })
})
