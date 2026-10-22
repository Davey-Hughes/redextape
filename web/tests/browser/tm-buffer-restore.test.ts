import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
// THE PASTE THE BLANK-BUFFER CASE BELOW MAKES. `?raw` is Vite's own text-import suffix
// (`node_modules/vite/client.d.ts` declares `'*?raw'` as a default-exported `string`), which is what lets
// a real, tracked `.tm` file reach this browser-tier test without a second, synthetic copy of 25,142
// characters living in this file too. `crates/` sits beside `pkg/` at the repo root, which
// `tm-fork-cost.test.ts` reads `pkg/redextape_wasm.js` from at the identical depth (`../../../`), so the
// same `server.fs.allow` entry (`vite.config.ts`'s `REPO_ROOT`) covers it.
import list_1_2 from '../../../crates/redextape-core/tests/fixtures/list_1_2.tm?raw'
import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from '../../src/buffers-store'
import { pickSessionBinding } from './binding-fixture'
import { editorViewOf } from './editor-view-fixture'
import {
  bufferRows,
  buffersButton,
  buffersMenu,
  editedToHaltImmediately,
  idle,
  SHELL,
  startStateGoesToHalt,
  storeFourViews,
  tmPaneHost,
  until,
} from './harness'

/**
 * **λ AND TM BUFFERS SURVIVE A RELOAD, END TO END — the composition check.** Node-tier tests pin the
 * `leg`-carrying payload shape (`tests/node/buffers-store.test.ts`) and the collection that reads it,
 * against a fake port (`tests/node/scratch.test.ts`); neither can see that `main.ts`'s restore loop
 * actually warms a TM buffer onto a `tm-scratch` request and a λ buffer onto a `lambda-scratch` one, or
 * that a restored TM buffer's pane comes back showing its machine. That needs a real thread and a real
 * `pkg/`, which is why this is a browser-tier file. `ScratchBuffers.warm` reading `state.leg` and the cold
 * restore policy each have a unit-level pin in `tests/node/scratch.test.ts`, and for those this file only
 * confirms the pieces fit together through `main()`. The leg check in `main.ts`'s restore loop has none,
 * since it lives inside `main()`: `buffer-restore.test.ts`'s `SEEDED` holds one direction (a `lambda`-leg
 * buffer bound to a `tm` leaf) and this file's case on a `tm`-leg buffer bound to a `lambda` leaf holds
 * the other.
 *
 * **A "RELOAD" NEEDS A GENUINELY FRESH MODULE INSTANCE OF `main.ts`, NOT A SECOND `await` ON THE SAME
 * `ready`.** `main.ts`'s `ready` is computed once, at import evaluation (`export const ready = main()`), and
 * `main` itself is not exported — so there is no function to just call again, and a second bare
 * `import('../../src/main')` from the SAME specifier returns the SAME cached module (ES module imports are
 * cached, the reason `app.test.ts` gives for mounting once). `remountApp` below gets a REAL second instance
 * anyway, by importing the module under a cache-busting query string (`?remount=N`) — Vite's dev server
 * (which is what serves modules to a Vitest browser test; nothing here is pre-bundled) keys its module graph
 * on the full specifier including the query, so a differently-queried import is a genuinely distinct module
 * realm: fresh top-level `let`s (`main.ts`'s own `leafCounter` among them), a fresh `main()` invocation, and
 * event listeners bound to the fresh DOM the OLD instance's listeners do not fire on.
 * `document.body.innerHTML` is reset to `SHELL` before every mount so the new instance queries fresh elements
 * rather than ones an earlier instance's listeners are still attached to. `localStorage` is left untouched
 * across a remount — same store, per this file's per-test-file shim (`tests/browser/setup.ts`) — which a real
 * reload keeps too.
 *
 * **`mountApp` CLEARS `localStorage` FIRST, WHICH IS WHAT MAKES EACH `it` BELOW INDEPENDENT.** The shim
 * installed in `setup.ts` is shared for this file's entire run (one page, one store), so without an
 * explicit clear the second test's "first" mount would inherit whatever the first test's buffers left
 * behind. `remountApp` does the opposite on purpose — it must NOT clear anything, since reading back
 * exactly what a previous mount wrote is the entire point of it.
 *
 * **DUPLICATING THE PANE/BUFFER HELPERS RATHER THAN IMPORTING THEM FROM A SIBLING IS DELIBERATE FOR
 * `mountApp`/`remountApp`, THE SAME REASON `tm-blank-buffer.test.ts` GIVES FOR ITS OWN MOUNT.** Each
 * browser test file gets its own page, so a shared mount would be a shared page two files could not
 * both own — that argument reaches `mountApp`/`remountApp` and stops there. `lambdaPaneHost`
 * and the rest are pure DOM queries, duplicated because nothing here is exported for another file to
 * import, not because a shared page forbids it. `SHELL`, `until`, `tmPaneHost`, `idle`, `buffersButton`,
 * `buffersMenu`, `bufferRows`, `editedToHaltImmediately` and `startStateGoesToHalt` are not part of either
 * duplication — all are imported from `tests/browser/harness.ts` — and neither are `editorViewOf` and
 * `pickSessionBinding`, imported from `tests/browser/editor-view-fixture.ts` and `tests/browser/binding-fixture.ts`.
 *
 * Section and decision citations here are the 5d-iv design's unless they name another.
 */

const lambdaPaneHost = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-leaf="lambda-0"]')
  if (el === null) throw new Error('no λ pane mounted at [data-leaf="lambda-0"]')
  return el
}

/**
 * A pane whose own text already claims to be detached, but has not yet mounted the editor that claim
 * implies — the one state a pure text-quiescence poll cannot see past.
 *
 * **WHY QUIESCENCE ALONE IS NOT ENOUGH.** A fork's click handler flips a pane's heading to
 * `copy · not linked` and names the new buffer SYNCHRONOUSLY, before any worker reply lands, and that
 * placeholder text can sit unchanged for the whole 500ms window a text-only `settleOn` requires, while the
 * worker is still mid-compile and `.term-editor` has not been built yet. `tm-scratch-fork.test.ts`'s own
 * comment on `runs the edited machine` names the general shape of this hazard ("WAIT ON THE FACT ITSELF,
 * NOT ON QUIESCENCE") for a recompile; this is the same hazard for a fork's own first mount.
 */
const detachedWithNoEditorYet = (pane: HTMLElement): boolean =>
  /copy · not linked/.test(pane.textContent ?? '') && pane.querySelector('.term-editor') === null

/**
 * Wait until `snapshot()` stops changing for 500ms AND neither pane is stuck `copy · not linked` with no
 * editor mounted yet — `tm-blank-buffer.test.ts`'s own `settleOn`, with the extra condition
 * `detachedWithNoEditorYet` exists to close.
 *
 * **SCOPED TO THE λ AND TM PANES JOINTLY, NOT TO ONE.** `tm-blank-buffer.test.ts` scopes its own version of
 * this to the TM pane alone. Watching only one leg would miss the OTHER leg still mid-flight, and watching
 * both is safe here: this file dispatches exactly one program per mount, the one test here that forks two
 * panes forks them in sequence, waiting between, and `lambda-0` and `tm-0`, both bound to a source the size
 * of `let x = 40; x + 2`, settle in well under a second either way.
 */
async function settleOn(snapshot: () => string, timeoutMs = 60_000): Promise<void> {
  const started = performance.now()
  let last = snapshot()
  let stableSince = performance.now()
  while (
    performance.now() - stableSince < 500 ||
    detachedWithNoEditorYet(tmPaneHost()) ||
    detachedWithNoEditorYet(lambdaPaneHost())
  ) {
    if (performance.now() - started > timeoutMs) throw new Error('timed out waiting for the panes to settle')
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
  lambdaPane(): HTMLElement
  editorText(pane: HTMLElement): string
  buffersButton(): HTMLButtonElement
  buffersMenu(): HTMLElement
  bufferRows(): HTMLElement[]
}

function appHandle(): App {
  return {
    compiled: () => until(idle, 'the app to settle on its source program'),
    settled: () => settleOn(() => `${tmPaneHost().textContent ?? ''}\x00${lambdaPaneHost().textContent ?? ''}`),
    tmPane: tmPaneHost,
    lambdaPane: lambdaPaneHost,
    editorText: (pane) => editorViewOf(pane).state.doc.toString(),
    buffersButton,
    buffersMenu,
    bufferRows,
  }
}

/**
 * Which cache-busted specifier the NEXT `import('../../src/main...')` should use — see this file's own
 * doc for why the query string is what makes each call a genuinely fresh module instance rather than the
 * cached one. The bare specifier is used once, for the very first mount, so a reader diffing this file
 * against a sibling's own `mountApp` sees the same first line.
 */
let remountSeq = 0
async function freshMain(): Promise<{ ready: Promise<EditorView> }> {
  const spec = remountSeq === 0 ? '../../src/main' : `../../src/main?remount=${remountSeq}`
  remountSeq += 1
  return import(/* @vite-ignore */ spec)
}

/**
 * Mount a fresh app on a fresh page whose store holds the four views alone, and load `src` into its one source
 * editor.
 */
async function mountApp(src: string): Promise<App> {
  localStorage.clear()
  // ALL FOUR VIEWS: an empty store opens on the source and TM alone.
  storeFourViews()
  document.body.innerHTML = SHELL
  const view = await (await freshMain()).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  return appHandle()
}

/** Simulate a reload: the same `localStorage`, a fresh page. See this file's own doc for the mechanism. */
async function remountApp(): Promise<App> {
  document.body.innerHTML = SHELL
  await (await freshMain()).ready
  return appHandle()
}

describe('restoring λ and TM buffers', () => {
  it('brings a warm TM buffer back showing its machine', async () => {
    const first = await mountApp('let x = 40; x + 2')
    await first.compiled()
    first.tmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await first.settled()
    const text = first.editorText(first.tmPane())
    expect(text).toContain('state ')

    const second = await remountApp()
    await second.settled()
    expect(second.editorText(second.tmPane())).toBe(text)
    expect(second.tmPane().textContent).toMatch(/copy · not linked/)
  })

  it('brings a λ buffer and a TM buffer back on their own legs', async () => {
    const first = await mountApp('let x = 40; x + 2')
    await first.compiled()
    first.lambdaPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await first.settled()
    first.tmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await first.settled()

    const second = await remountApp()
    await second.settled()
    const rows = second.bufferRows()
    expect(rows).toHaveLength(2)
    expect(second.lambdaPane().querySelector('.cm-editor')).not.toBeNull()
    expect(second.tmPane().querySelector('.cm-editor')).not.toBeNull()
  })

  /**
   * **A RESTORED COLD TM BUFFER LEAVES THE "ASLEEP" STATE WHEN WARMED.** `restore` inserts every buffer
   * cold; `main.ts` warms the ones its restored bindings name. The assertion shows the buffer's row stops
   * reporting the "asleep" state after the warm. The literal leg posted to the worker — that a TM buffer
   * spawns `tm-scratch` and not `lambda-scratch` — is pinned in `web/tests/node/scratch.test.ts` by
   * `warm re-spawns a cold tm buffer with tm-scratch, not lambda-scratch`, which reads the posted wire
   * message directly against a fake port.
   *
   * **`button.buffer-temperature`, NOT `button.temperature` — the same class of mismatch
   * `tm-blank-buffer.test.ts` names for `retire` (`buffer-list.ts`'s `bufferRow` builds
   * `temperature.className = 'buffer-temperature'`).** A selector that does not match would leave this
   * test's click a no-op and its final assertion would fail for a reason unrelated to what the test
   * claims, or — worse, on some future markup — pass without the click having reached anything.
   */
  it('warms a restored cold TM buffer onto the tm leg', async () => {
    const first = await mountApp('let x = 40; x + 2')
    await first.compiled()
    first.buffersButton().click()
    first.buffersMenu().querySelector<HTMLButtonElement>('button.new-tm')?.click()
    await first.settled()

    const second = await remountApp()
    await second.settled()
    second.buffersButton().click()
    second.buffersMenu().querySelector<HTMLButtonElement>('button.buffer-temperature')?.click()
    await second.settled()
    const row = second.bufferRows()[0]
    if (row === undefined) throw new Error('no buffer row on the restored page')
    // THE NAME LINE, NOT THE ROW: a warm row's own controls read `pause` then `delete`, which run together
    // in the row's text as `pausedelete` and would match /paused/ on a live copy.
    expect(row.querySelector('.buffer-row-name')?.textContent).not.toMatch(/paused/)
    // A LIVE ROW NAMES NO WORKER AT ALL (Plan 7 part 5 spec amendment 46) — its name line ends at its view
    // count, not at a word about its worker.
    expect(row.querySelector('.buffer-row-name')?.textContent).toMatch(/· not shown$/)
  })

  /**
   * **A `tm`-LEG BUFFER BOUND TO A `lambda` LEAF, THE MIRROR OF THE CASE `main.ts`'s RESTORE-LOOP COMMENT
   * NAMES.** `buffer-restore.test.ts`'s `SEEDED` fixture pins a `lambda`-leg buffer bound to a `tm` leaf.
   * This pins the OTHER direction, which a check on the leaf's pane kind alone does NOT refuse: `lambda-0`
   * is a λ leaf whichever leg the NAMED buffer has. Without `main.ts`'s check that the leaf and the buffer
   * agree on a leg, this payload would reach `pane-host.ts`'s `applyLayout`, which would build
   * `PaneSlot('lambda', 'scratch-1')` for a session whose only leg is `tm`, and the first `draw()` would
   * throw out of `SessionRegistry.legOf` and take the whole page down with it.
   *
   * **A HAND-BUILT PAYLOAD, NOT ONE THE APP CAN PRODUCE ON ITS OWN** — `buffers-store.ts`'s own doc on
   * `validBuffer` names the threat model directly: "the hazard is a hand-edited `localStorage` entry...
   * every rejection here is something a person could plausibly type." `parseBuffers` cannot refuse this
   * shape itself (a binding is `Record<LeafId, SessionId>` and carries no leg, by design — 5d-ii-d design
   * §4.1), so the guard has to live where the tree and the buffer's own `leg` are both in scope at once,
   * which is exactly the restore loop in `main.ts` this test is aimed at.
   *
   * `LAYOUT_STORAGE_KEY` IS NOT SEEDED HERE — the first `mountApp` call already wrote the four-view tree
   * to it (`storeFourViews`, and every `applyLayout()` call persists, `buffers-store.ts`'s own doc on why buffers get a
   * SEPARATE key states the same call chain), so `lambda-0` and `tm-0` are already the ids on record by
   * the time this test overwrites `BUFFERS_STORAGE_KEY` and remounts.
   */
  it('drops a tm-leg buffer bound to a lambda leaf rather than crashing the page on it', async () => {
    const first = await mountApp('let x = 40; x + 2')
    await first.compiled()

    localStorage.setItem(
      BUFFERS_STORAGE_KEY,
      serializeBuffers({
        minted: 1,
        buffers: [
          {
            id: 'scratch-1',
            label: 'TM scratch 1',
            leg: 'tm',
            text: 'tapes 1\nstart s\nstate s:\n  [*] -> write [*], move [S], goto halt\nstate halt: accept\n',
            collapsed: false,
          },
        ],
        bindings: { 'lambda-0': 'scratch-1' },
      }),
    )

    // THE PAGE COMING UP AT ALL IS THE FIRST ASSERTION. A restore loop without the leg check would throw out
    // of `main()`'s own first `draw()`, and `remountApp` below would never resolve `.ready` — this whole test
    // would fail with the `legOf` throw rather than reaching any `expect`.
    const second = await remountApp()
    await second.settled()

    // THE BINDING WAS DROPPED, NOT HONOURED — the λ pane is on the source session, not the tm-leg
    // buffer the corrupt payload named for it.
    expect(document.querySelector('[data-leaf="lambda-0"] .view-status')).toBeNull()
    expect(document.querySelector('[data-leaf="lambda-0"] .view-title')?.textContent).toBe('λ · program')
    // AND THE BUFFER ITSELF SURVIVES, ORPHANED AND COLD — dropping a binding is not the same as ending a
    // buffer (5d-ii-c design decision 2: nothing ends a buffer implicitly). `restore` puts every buffer back
    // cold, and nothing named this one to warm it.
    const rows = second.bufferRows()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    if (row === undefined) throw new Error('no buffer row on the restored page')
    // THE NAME LINE, NOT THE WHOLE ROW: a running row's own controls read `pause` then `delete`, and a
    // row's `textContent` runs them together as `pausedelete` — which matches `/paused/` and makes the
    // "cold" claim above unfalsifiable.
    expect(row.querySelector('.buffer-row-name')?.textContent).toBe('TM copy 1 · not shown · paused')
  })

  /**
   * **A FORK'S OWN EDIT REACHES `localStorage`.** `ScratchBuffers.recompile` writes the edit into memory
   * synchronously (`this.setText(id, src)`, ahead of posting the build), so the running pane shows the
   * edit immediately — this test's own first assertions below hold that half. The write a reload reads
   * back, `ScratchBuffers.snapshot`'s payload, which `restore` takes in, is flushed by `replies.ts`'s
   * `tm-scratch-compiled` arm calling `onBuffersPersist()`, as its λ sibling does (`scratch-compiled`'s own
   * three-guard sibling: `if (reply.text !== null) onBuffersPersist()`); an arm that mounted the recompiled
   * text and moved on would leave a reload restoring the buffer's ORIGINAL text, silently discarding the edit.
   *
   * **THIS IS `tm-scratch-fork.test.ts`'s `runs the edited machine`, CONTINUED PAST THE POINT THAT FILE
   * STOPS.** That file proves the edit reaches the running machine; it never reloads, so it cannot see
   * whether the edit reaches storage. `editedToHaltImmediately`/`startStateGoesToHalt` are the helpers it
   * uses, imported from `harness.ts`, reused rather than re-invented because the edit and the wait for it to
   * land are already proven correct there.
   */
  it("keeps a forked TM buffer's edited text after a reload", async () => {
    const first = await mountApp('let x = 40; x + 2')
    await first.compiled()
    first.tmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await first.settled()

    const original = first.editorText(first.tmPane())
    expect(original).toContain('state ')
    const { text: edited, start } = editedToHaltImmediately(original)
    const view = editorViewOf(first.tmPane())
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: edited } })
    // WAIT ON THE FACT ITSELF, NOT ON QUIESCENCE: typing changes the editor's text synchronously, well
    // before the debounced recompile ever reaches the worker, so a content-quiescence poll could resolve in
    // the gap before the edit has actually been recompiled, which here would mean reloading before
    // `tm-scratch-compiled` and its persist have run.
    await until(() => startStateGoesToHalt(first.tmPane(), start), `the δ-table to show \`${start}\` going to halt`)

    const second = await remountApp()
    await second.settled()
    expect(second.editorText(second.tmPane())).toBe(edited)
  })

  /**
   * **A BLANK BUFFER'S PASTE IS THE WORSE CASE.** Design §2 decision 1's entire stated purpose for the
   * blank-buffer gesture is *"emit a file, paste it into a pane"* — `tm_emit`'s own round trip. Without
   * `onBuffersPersist()` in `tm-scratch-compiled`, that paste would parse, run, and then a reload would
   * come back to an EMPTY buffer: there is no fork to seed `localStorage` with anything at all (unlike the
   * case above, where at least a stale ORIGINAL text would survive), so the user's pasted file would be gone.
   *
   * **`list_1_2.tm` IS THE REAL, TRACKED FIXTURE, NOT A SYNTHETIC STAND-IN** — 25,142 characters,
   * imported through Vite's own `?raw` suffix (see this file's own import comment) rather than
   * duplicated inline, so this test pastes exactly the file a user actually would.
   *
   * **THE POST-REMOUNT WAIT IS A BOUNDED `until` ON THE EDITOR MOUNTING, NOT `settled()`.** Had the
   * paste not reached `localStorage`, the restored buffer's text would be empty, so its `tmScratch('')`
   * request would never produce a machine, `tm-scratch-compiled` would never fire, and `setEditor` would
   * never mount a `.term-editor`. That pane is ALSO permanently `copy · not linked` (any scratch-bound pane
   * reads so, warm or not), so `settled()`'s own `detachedWithNoEditorYet` guard — built for a fork's
   * synchronous placeholder, this file's own doc above — would never clear either, and the helper would
   * hang for its own full internal timeout rather than failing fast. Waiting on the mount directly gives a
   * short, legible failure instead.
   */
  it("keeps a pasted blank TM buffer's text after a reload", async () => {
    const first = await mountApp('let x = 40; x + 2')
    await first.compiled()
    first.buffersButton().click()
    first.buffersMenu().querySelector<HTMLButtonElement>('button.new-tm')?.click()
    await first.settled()
    pickSessionBinding(first.tmPane(), { leg: 'tm', session: 'scratch-1' })
    await first.settled()

    const view = editorViewOf(first.tmPane())
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: list_1_2 } })
    // NOT A `.state-row` COUNT: the δ-table is VIRTUALIZED (only the ~24 rows in view exist in the DOM), so
    // its row count never reflects the machine's true size and stays ~24 whichever machine is loaded — a
    // check waiting for `list_1_2.tm`'s own 455 (146 states + 309 rules) would never resolve.
    //
    // **BUT NOT `settled()` EITHER.** It waits for 500 ms of unchanged text. The paste repaints the pane
    // synchronously, and the worker then compiles 25,142 characters with nothing further touching the DOM
    // until it answers — so the window can elapse inside that silence and hand back "settled" while the
    // buffer has not been persisted yet, after which `remountApp` below would reload a store that never
    // received the paste.
    //
    // The persist IS the fact the remount depends on, so it is what this waits for, through the app's
    // own `parseBuffers` rather than a hand-read of the JSON — a test that agrees with the app's parser
    // cannot drift from the format the app writes.
    await until(
      () =>
        parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))?.buffers.find((b) => b.id === 'scratch-1')?.text ===
        list_1_2,
      'the pasted machine to reach localStorage',
    )

    // NO SECOND `pickSessionBinding` HERE — this pane's binding was already recorded in the persisted layout
    // by the call above, so `main.ts`'s restore loop warms this buffer and rebinds `tm-0` to it on its
    // own (the SAME auto-rebind `brings a λ buffer and a TM buffer back on their own legs`, above,
    // already relies on for a forked pane, with no `pickSessionBinding` call of its own after `remountApp`).
    const second = await remountApp()
    await until(() => second.tmPane().querySelector('.term-editor') !== null, 'the restored buffer to mount its editor')
    expect(second.editorText(second.tmPane())).toBe(list_1_2)
  })
})
