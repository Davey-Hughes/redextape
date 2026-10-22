import { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
// THE PASTE THE BLANK-BUFFER CASE BELOW MAKES. `?raw` is Vite's own text-import suffix
// (`node_modules/vite/client.d.ts` declares `'*?raw'` as a default-exported `string`), which is what lets
// a real, tracked `.tm` file reach this browser-tier test without a second, synthetic copy of 25,142
// characters living in this file too. `crates/` sits beside `pkg/` at the repo root, which
// `tm-fork-cost.test.ts` reads `pkg/redextape_wasm.js` from at the identical depth (`../../../`), so the
// same `server.fs.allow` entry (`vite.config.ts`'s `REPO_ROOT`) covers it.
import list_1_2 from '../../../crates/redextape-core/tests/fixtures/list_1_2.tm?raw'
import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from '../../src/buffers-store'
import { pickSessionBinding } from './binding-fixture'
import { answered, answerTo, recordBuildReplies, replyTo, typeAnswered } from './build-reply-fixture'
import { editorViewOf } from './editor-view-fixture'
import {
  bufferRows,
  buffersButton,
  buffersMenu,
  editedToHaltImmediately,
  hear,
  idle,
  paneStepText,
  SHELL,
  segments,
  shownNoticeText,
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
 * duplication — all are imported from `tests/browser/harness.ts` — and neither are `editorViewOf`,
 * `pickSessionBinding` and `replyTo`, imported from `tests/browser/editor-view-fixture.ts`,
 * `tests/browser/binding-fixture.ts` and `tests/browser/build-reply-fixture.ts`.
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

/**
 * Wait until a build of each of `texts` is answered, listed at or after `from`, an index into `answered` taken before
 * they were asked for; a text listed twice waits for two answers.
 *
 * **A BUILD THAT LANDS WRITES THE STORE** (`replies.ts`'s compiled arms call `onBuffersPersist`), and the page it lands
 * on goes on running after the next case's `mountApp` replaces it, on the one store this file's cases share. So a
 * case whose reload builds a copy waits for that build before it ends: one still running would land after the next
 * case's `mountApp` cleared the store, and write this case's copies into it. `settled()` is no wait for it: its quiet
 * period can pass while a build is still running on a slow machine.
 */
async function buildsAnswered(from: number, ...texts: string[]): Promise<void> {
  const owed = (text: string) =>
    texts.filter((t) => t === text).length - answered.slice(from).filter((a) => a.src === text).length
  await until(() => texts.every((t) => owed(t) <= 0), 'the restored copies’ builds to be answered')
}

/** Puts `Worker`'s own `postMessage` back once this file is done: `recordBuildReplies` wraps it for the whole file. */
let unrecord = (): void => undefined
beforeAll(() => {
  unrecord = recordBuildReplies()
})
afterAll(() => unrecord())

describe('restoring λ and TM buffers', () => {
  it('brings a warm TM buffer back showing its machine', async () => {
    const first = await mountApp('let x = 40; x + 2')
    await first.compiled()
    first.tmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await first.settled()
    const text = first.editorText(first.tmPane())
    expect(text).toContain('state ')

    const from = answered.length
    const second = await remountApp()
    await second.settled()
    expect(second.editorText(second.tmPane())).toBe(text)
    expect(second.tmPane().textContent).toMatch(/copy · not linked/)
    await buildsAnswered(from, text)
  })

  it('brings a λ buffer and a TM buffer back on their own legs', async () => {
    const first = await mountApp('let x = 40; x + 2')
    await first.compiled()
    first.lambdaPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await first.settled()
    first.tmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await first.settled()
    const texts = [first.editorText(first.lambdaPane()), first.editorText(first.tmPane())]

    const from = answered.length
    const second = await remountApp()
    await second.settled()
    const rows = second.bufferRows()
    expect(rows).toHaveLength(2)
    expect(second.lambdaPane().querySelector('.cm-editor')).not.toBeNull()
    expect(second.tmPane().querySelector('.cm-editor')).not.toBeNull()
    await buildsAnswered(from, ...texts)
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
   * back, `ScratchBuffers.snapshot`'s payload, which `restore` takes in, is stored by the edit sink as the
   * edit is sent (`transport.ts`'s `editSink`), and again by `replies.ts`'s `tm-scratch-compiled` arm when
   * the build lands; a page that stored neither would leave a reload restoring the buffer's ORIGINAL text,
   * silently discarding the edit.
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

    const from = answered.length
    const second = await remountApp()
    await second.settled()
    expect(second.editorText(second.tmPane())).toBe(edited)
    await buildsAnswered(from, edited)
  })

  /**
   * **A BLANK BUFFER'S PASTE IS THE WORSE CASE.** Design §2 decision 1's entire stated purpose for the
   * blank-buffer gesture is *"emit a file, paste it into a pane"* — `tm_emit`'s own round trip. Unstored —
   * by the edit sink as it is sent, or by `tm-scratch-compiled` when it lands — that paste would parse, run,
   * and then a reload would come back to an EMPTY buffer: there is no fork to seed `localStorage` with
   * anything at all (unlike the case above, where at least a stale ORIGINAL text would survive), so the
   * user's pasted file would be gone.
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
    const pasted = answered.length
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: list_1_2 } })
    // NOT A `.state-row` COUNT: the δ-table is VIRTUALIZED (only the ~24 rows in view exist in the DOM), so
    // its row count never reflects the machine's true size and stays ~24 whichever machine is loaded — a
    // check waiting for `list_1_2.tm`'s own 455 (146 states + 309 rules) would never resolve.
    //
    // **BUT NOT `settled()` EITHER**: 500 ms of unchanged text is a fact about the pane, not about storage.
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
    // THE PASTE'S BUILD AND THE RELOAD'S: the wait above is on the store, which the edit sink writes as it sends the
    // paste, so the paste's own build can still be running too.
    await buildsAnswered(pasted, list_1_2, list_1_2)
  })

  /**
   * **TEXT THAT DOES NOT BUILD IS KEPT TOO, ON EACH LEG.** Half-typed text is an editor's ordinary state, and its
   * build answers `no-session`, which carries no text and stores nothing (`replies.ts`'s `no-session` arm), so the
   * edit is stored by the edit sink itself as the build is posted (`transport.ts`'s `editSink`). Without that write a
   * reload would bring back the text from before the edit.
   *
   * **THE WAIT IS ON THE BUILD'S ANSWER**: a failed build leaves the page as it was, so the reply is the one fact to
   * wait on (`build-reply-fixture.ts`'s own doc), and that it is `no-session` is the precondition these cases are
   * about. The restored view then marks the text where it is wrong, as `asm-copy-restore.test.ts` holds for an asm
   * copy.
   */
  async function keepsTextThatDoesNotBuild(pane: (app: App) => HTMLElement, typed: (original: string) => string) {
    const first = await mountApp('let x = 40; x + 2')
    await first.compiled()
    pane(first).querySelector<HTMLButtonElement>('button.detach')?.click()
    await first.settled()

    const text = typed(first.editorText(pane(first)))
    const view = editorViewOf(pane(first))
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    await until(() => replyTo(text) !== undefined, 'the typed text’s build to be answered')
    expect(replyTo(text), 'precondition: the typed text does not build').toBe('no-session')

    const second = await remountApp()
    await until(() => pane(second).querySelector('.term-editor') !== null, 'the restored buffer to mount its editor')
    expect(second.editorText(pane(second))).toBe(text)
    // SCROLLED TO THE END, WHERE THE TEXT GOES WRONG: an editor draws only the lines in view, and a machine's are many.
    const restored = editorViewOf(pane(second))
    restored.dispatch({ effects: EditorView.scrollIntoView(restored.state.doc.length) })
    await until(
      () => pane(second).querySelector('.cm-editor .cm-lintRange-error') !== null,
      'the restored editor to mark where the text is wrong',
    )
  }

  it("keeps a forked λ buffer's typed text that does not build after a reload", async () => {
    // AN OPEN PARENTHESIS AT THE END, which no λ term closes.
    await keepsTextThatDoesNotBuild(
      (app) => app.lambdaPane(),
      (original) => `${original} (`,
    )
  })

  it("keeps a forked TM buffer's typed text that does not build after a reload", async () => {
    // A LINE IN THE LAST STATE THAT IS NO RULE.
    await keepsTextThatDoesNotBuild(
      (app) => app.tmPane(),
      (original) => `${original}\n  garbage here\n`,
    )
  })
})

/**
 * **A COPY WHOSE TEXT HAS NEVER BUILT SAYS SO, ON ITS VIEW'S STEP LINE, ITS ROW IN THE COPIES MENU AND ITS READOUT.** A
 * reload brings back a copy whose stored text does not build in its editor, marked where it is wrong (the cases above),
 * and its build answers `no-session`, so no frame of it ever lands. Its leg then carries the reason `replies.ts`'s
 * `no-session` arm gives it, `did not build`, where `building…` would say a build is still coming after it has been
 * answered.
 *
 * **AND IT SAYS IN A NOTICE THAT IT DID NOT BUILD ONCE, NOT ONCE PER EDIT.** The reload is a fresh page, whose first
 * build of the copy is answered with a notice (Plan 7 part 5 spec, amendment 40); an edit to the copy after that shows
 * its diagnostics in its editor alone, as an edit to a copy that has built does (amendment 27). The count is of notices
 * drawn and of sentences the live region says (`harness.ts`'s `hear`), since a notice said again in the same words is
 * heard again. The edits are real key presses, each waited on until its build is answered.
 *
 * **AND THE NOTICE ENDS WHEN A BUILD OF THE COPY LANDS**, where it would go on saying the copy did not build over a
 * copy that now runs.
 *
 * **THE READOUT READS THE FOCUSED VIEW'S SESSION** (Plan 7 part 2 spec §9), so a click in the copy's editor, real
 * input, is what puts the copy's line there.
 */
describe('a copy that has never built', () => {
  const failures = (heard: readonly string[]) => heard.filter((t) => t.startsWith('the copy did not build — '))

  async function neverBuilt(
    pane: (app: App) => HTMLElement,
    name: string,
    typed: (original: string) => string,
    built: string,
  ) {
    const first = await mountApp('let x = 40; x + 2')
    await first.compiled()
    pane(first).querySelector<HTMLButtonElement>('button.detach')?.click()
    await first.settled()
    const original = first.editorText(pane(first))
    const text = typed(original)
    const view = editorViewOf(pane(first))
    let from = answered.length
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    expect(await answerTo(text, from, 'the typed text’s build'), 'precondition: it does not build').toBe('no-session')

    const ears = hear()
    from = answered.length
    const second = await remountApp()
    expect(await answerTo(text, from, 'the restored copy’s build'), 'precondition: it does not build').toBe(
      'no-session',
    )
    await until(() => pane(second).querySelector('.term-editor') !== null, 'the restored copy’s editor')
    expect(paneStepText(pane(second))).toBe('did not build')
    // ITS ROW IN THE COPIES MENU, which is built as the menu opens; closed again before the click below.
    expect(second.bufferRows().map((r) => r.querySelector('.buffer-row-term')?.textContent)).toEqual(['did not build'])
    second.buffersButton().click()

    // NEAR THE EDITOR'S TOP LEFT, NOT ITS CENTRE: a machine's lines are wider than its view, so the centre of its
    // content can lie outside the view and a click there lands on whatever is drawn at that point instead.
    const content = pane(second).querySelector('.cm-content') as HTMLElement
    await userEvent.click(content, { position: { x: 4, y: 4 } })
    await until(() => segments().some((s) => s.startsWith(name)), 'the readout to read the copy')
    expect(segments()).toEqual([`${name} · did not build`])
    // THE POINTER LEAVES THE EDITOR: the next case's mount replaces the page under it, and an editor of this page,
    // still hovered, would go on measuring text that is no longer in the document.
    await userEvent.unhover(content)
    expect(failures(ears.notices), 'the reload’s notice').toHaveLength(1)
    expect(failures(ears.said), 'the reload’s notice, said').toHaveLength(1)

    for (const key of ['y', 'z', 'w']) {
      expect(await typeAnswered(editorViewOf(pane(second)), key), 'precondition: the edit does not build').toBe(
        'no-session',
      )
    }
    expect(failures(ears.notices), 'no notice for an edit').toHaveLength(1)
    expect(failures(ears.said), 'nothing said for an edit').toHaveLength(1)
    expect(paneStepText(pane(second))).toBe('did not build')

    // A SECOND RELOAD, A FRESH PAGE AND SO A FRESH NOTICE, and the edit that makes the copy build comes well inside the
    // notice's eight seconds: the three edits above can outlast them on a slow machine, and a notice that ended by
    // itself would pass the check below without anything ending it.
    from = answered.length
    const third = await remountApp()
    expect(await answerTo(`${text}yzw`, from, 'the restored copy’s build'), 'precondition: it does not build').toBe(
      'no-session',
    )
    expect(failures(ears.notices), 'one notice from each page').toHaveLength(2)
    await until(() => pane(third).querySelector('.term-editor') !== null, 'the restored copy’s editor')
    const fixed = editorViewOf(pane(third))
    fixed.dispatch({ selection: { anchor: original.length, head: fixed.state.doc.length } })
    fixed.focus()
    await until(() => fixed.hasFocus, 'the copy’s editor to take the focus')
    expect(shownNoticeText(), 'precondition: the reload’s notice is up').toMatch(/^the copy did not build — /)
    from = answered.length
    await userEvent.keyboard('{Backspace}')
    expect(await answerTo(original, from, 'the build of the edit that fixes it'), 'precondition: it builds').toBe(built)
    expect(shownNoticeText(), 'the notice ends when the copy builds').toBe('')
    await until(() => paneStepText(pane(third)).startsWith('step 0 of '), 'the step line to read the copy’s run')
    ears.stop()
  }

  it('reads `did not build` for a restored λ copy, says so in one notice, and ends it when the copy builds', async () => {
    // TWO OPEN PARENTHESES AT THE END, which no λ term closes: a text no other case in this file types, since
    // `answerTo` matches a build by its text alone, on whichever page's worker answers it.
    await neverBuilt(
      (app) => app.lambdaPane(),
      'λ copy 1',
      (original) => `${original} ((`,
      'scratch-compiled',
    )
  })

  it('reads `did not build` for a restored TM copy, says so in one notice, and ends it when the copy builds', async () => {
    // A LINE IN THE LAST STATE THAT IS NO RULE, worded as no other case in this file words one,
    // for the λ case's reason.
    await neverBuilt(
      (app) => app.tmPane(),
      'TM copy 1',
      (original) => `${original}\n  not a rule\n`,
      'tm-scratch-compiled',
    )
  })

  /**
   * **A BLANK TM COPY HAS NEVER BUILT EITHER**: its empty text is no machine (`missing \`tapes <n>\``), so a view bound
   * to it, and its row in the copies menu, read `did not build` too. The menu's rows are built as it opens, so it is
   * closed first if the gesture left it open.
   *
   * **ITS FIRST BUILD IS ANSWERED WITH A NOTICE, AFTER THE ONE SAYING IT WAS CREATED**, as any copy's first failed
   * build is: no spec says what making a blank copy announces beyond that it was made. Edits to it say nothing more.
   */
  it('reads `did not build` for a blank TM copy, in a view of it and in its row, and says so in one notice', async () => {
    const app = await mountApp('let x = 40; x + 2')
    await app.compiled()
    const ears = hear()
    const from = answered.length
    app.buffersButton().click()
    app.buffersMenu().querySelector<HTMLButtonElement>('button.new-tm')?.click()
    expect(await answerTo('', from, 'the blank copy’s build'), 'precondition: it does not build').toBe('no-session')
    expect(ears.notices).toEqual(['TM copy 1 created', 'the copy did not build — missing `tapes <n>`'])
    pickSessionBinding(app.tmPane(), { leg: 'tm', session: 'scratch-1' })
    await until(() => app.tmPane().querySelector('.term-editor') !== null, 'the copy’s editor')
    expect(paneStepText(app.tmPane())).toBe('did not build')

    if (app.buffersButton().getAttribute('aria-expanded') === 'true') app.buffersButton().click()
    expect(app.bufferRows().map((r) => r.querySelector('.buffer-row-term')?.textContent)).toEqual(['did not build'])
    if (app.buffersButton().getAttribute('aria-expanded') === 'true') app.buffersButton().click()

    for (const key of ['x', 'y', 'z']) {
      expect(await typeAnswered(editorViewOf(app.tmPane()), key), 'precondition: the edit does not build').toBe(
        'no-session',
      )
    }
    expect(failures(ears.notices), 'no notice for an edit').toHaveLength(1)
    expect(failures(ears.said), 'nothing said for an edit').toHaveLength(1)
    ears.stop()
  })
})
