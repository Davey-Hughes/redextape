import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
// THE SECOND REPRO'S OWN PASTE — CRITICAL 1, whole-branch review before merge. `?raw` is Vite's own
// text-import suffix (`node_modules/vite/client.d.ts` declares `'*?raw'` as a default-exported
// `string`), which is what lets a real, tracked `.tm` file reach this browser-tier test without a
// second, synthetic copy of 25,142 characters living in this file too. `crates/` sits beside `pkg/` at
// the repo root this file's own sibling `tm-fork-cost.test.ts` already reads `pkg/redextape_wasm.js`
// from at the identical depth (`../../../`), so the same `server.fs.allow` entry (`vite.config.ts`'s
// `REPO_ROOT`) already covers it.
import list_1_2 from '../../../crates/redextape-core/tests/fixtures/list_1_2.tm?raw'
import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from '../../src/buffers-store'
import type { Leg } from '../../src/protocol'
import type { SessionId } from '../../src/session-client'

/**
 * **BOTH LEGS SURVIVE A RELOAD, END TO END — 5d-iv Task 11, the composition check.** Task 6 pinned the
 * `leg`-carrying payload shape in the node tier and Task 5 pinned the collection that reads it, each
 * against a fake port; neither can see that `main.ts`'s restore loop actually warms a TM buffer onto a
 * `tm-scratch` request and a λ buffer onto a `lambda-scratch` one, or that a restored TM buffer's pane
 * comes back showing its machine. That needs a real thread and a real `pkg/`, which is why this is a
 * browser-tier file — and why it is a COMPOSITION check rather than the sole proof of anything: every
 * fact it touches (the leg-aware restore filter, `ScratchBuffers.warm` reading `state.leg`, the cold
 * restore policy) already has a unit-level pin, and this file's job is only to confirm those pieces
 * still fit together through `main()`.
 *
 * **A "RELOAD" NEEDS A GENUINELY FRESH MODULE INSTANCE OF `main.ts`, NOT A SECOND `await` ON THE SAME
 * `ready`.** `main.ts`'s `ready` is computed once, at import evaluation (`export const ready = main()`),
 * and `main` itself is not exported — so there is no function to just call again, and a second bare
 * `import('../../src/main')` from the SAME specifier returns the SAME cached module (ES module imports
 * are cached; this is the reason every sibling in this directory gives for why "each browser test file
 * gets its own page" and mounts exactly once). `remountApp` below gets a REAL second instance anyway, by
 * importing the module under a cache-busting query string (`?remount=N`) — Vite's dev server (which is
 * what serves modules to a Vitest browser test; nothing here is pre-bundled) keys its module graph on
 * the full specifier including the query, so a differently-queried import is a genuinely distinct module
 * realm: fresh top-level `let`s (`main.ts`'s own `leafCounter` among them), a fresh `main()` invocation,
 * and — proven directly below, not assumed — event listeners bound to the fresh DOM the OLD instance's
 * listeners do not fire on. `document.body.innerHTML` is reset to `SHELL` before every mount so the new
 * instance queries fresh elements rather than ones an earlier instance's listeners are still attached to.
 * `localStorage` is left untouched across a remount — same store, per this file's per-test-file shim
 * (`tests/browser/setup.ts`) — which is the one thing a real reload keeps too.
 *
 * **`mountApp` CLEARS `localStorage` FIRST, WHICH IS WHAT MAKES EACH `it` BELOW INDEPENDENT.** The shim
 * installed in `setup.ts` is shared for this file's entire run (one page, one store), so without an
 * explicit clear the second test's "first" mount would inherit whatever the first test's buffers left
 * behind. `remountApp` does the opposite on purpose — it must NOT clear anything, since reading back
 * exactly what a previous mount wrote is the entire point of it.
 *
 * **DUPLICATING `SHELL` AND THE PANE/BUFFER HELPERS RATHER THAN IMPORTING THEM FROM A SIBLING, THE
 * STANDING IDIOM `tm-blank-buffer.test.ts` STATES AT LENGTH.** Every browser test file gets its own page
 * and nothing here is exported for another file to import; `tmPaneHost`/`lambdaPaneHost` are this file's
 * own, mirroring `tm-scratch-fork.test.ts`'s and `tm-blank-buffer.test.ts`'s.
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

const lambdaPaneHost = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-leaf="lambda-0"]')
  if (el === null) throw new Error('no λ pane mounted at [data-leaf="lambda-0"]')
  return el
}

const editorHostOf = (pane: HTMLElement): HTMLElement => {
  const host = pane.querySelector<HTMLElement>('.term-editor')
  if (host === null) throw new Error('no editor mounted in this pane')
  return host
}

const editorViewOf = (pane: HTMLElement): EditorView => {
  const view = EditorView.findFromDOM(editorHostOf(pane))
  if (view === null) throw new Error('no CodeMirror view mounted under the editor host')
  return view
}

const buffersButton = (): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>('#buffers')
  if (el === null) throw new Error('no #buffers control in the header')
  return el
}

const buffersMenu = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('.buffer-list')
  if (el === null) throw new Error('no .buffer-list popover beside #buffers')
  return el
}

/** Every row the list currently holds, forcing the list open first — `tm-blank-buffer.test.ts`'s own
 * `bufferRows` and its own reason: a closed list keeps whatever it last rendered. */
const bufferRows = (): HTMLElement[] => {
  const button = buffersButton()
  if (button.getAttribute('aria-expanded') !== 'true') button.click()
  return [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row')]
}

/** `\x00` as an escape rather than the byte — `tm-blank-buffer.test.ts`'s own `optionValue`, duplicated
 * here for the same reason this file duplicates every other page helper (this file's own doc). */
const optionValue = (leg: Leg, id: SessionId) => `${leg}\x00${id}`

/** Rebind `pane`'s own selector to `(leg, session)` through the control a user has, not a direct write
 * to whatever `main.ts` holds underneath it — `tm-blank-buffer.test.ts`'s own `pickBinding`. */
const pickBinding = (pane: HTMLElement, target: { leg: Leg; session: SessionId }): void => {
  const select = pane.querySelector<HTMLSelectElement>('.pane-binding select')
  if (select === null) throw new Error('no binding selector on this pane')
  select.value = optionValue(target.leg, target.session)
  select.dispatchEvent(new Event('change'))
}

/**
 * Rewrite the start state's rule list to a single unconditional jump to `halt`, and hand back the name
 * that state was edited under — `tm-scratch-fork.test.ts`'s own `editedToHaltImmediately`, duplicated
 * rather than imported (this file's own doc on why every page helper here is its own copy). Reused for
 * the SECOND composition this file's Task 11 fix round adds: an edit surviving a reload needs a real
 * edit, not merely a reload of what a fork already seeded, and this is the smallest one already proven
 * to reach a running machine.
 */
function editedToHaltImmediately(text: string): { text: string; start: string } {
  const start = /^start (\S+)$/m.exec(text)?.[1]
  if (start === undefined) throw new Error('emitted text has no `start` directive')
  const tapes = Number(/^tapes (\d+)$/m.exec(text)?.[1])
  if (!Number.isInteger(tapes)) throw new Error('emitted text has no `tapes` directive')
  const wild = Array.from({ length: tapes }, () => '*').join(' ')
  const stay = Array.from({ length: tapes }, () => 'S').join(' ')
  const rule = `  [${wild}] -> write [${wild}], move [${stay}], goto halt`
  const lines = text.split('\n')
  const at = lines.indexOf(`state ${start}:`)
  if (at < 0) throw new Error(`no block for the start state \`${start}\``)
  let end = at + 1
  while ((lines[end] ?? '').startsWith('  ')) end++
  return { text: [...lines.slice(0, at + 1), rule, ...lines.slice(end)].join('\n'), start }
}

/**
 * Whether the δ-table's rendered rows show `state`'s own header immediately followed by exactly the
 * rule `editedToHaltImmediately` wrote — `tm-scratch-fork.test.ts`'s own `startStateGoesToHalt`,
 * duplicated for the reason its own doc gives: the fact worth waiting on and asserting, immune to both
 * the always-true `/halt/i` (`state halt: accept` is in the δ-table regardless of the edit) and to
 * content quiescence racing the debounced recompile.
 */
function startStateGoesToHalt(pane: HTMLElement, start: string): boolean {
  const rows = [...pane.querySelectorAll<HTMLElement>('.state-row')]
  const at = rows.findIndex((el) => el.classList.contains('is-state') && el.textContent === start)
  const rule = at < 0 ? undefined : rows[at + 1]
  if (rule === undefined || !rule.classList.contains('is-rule')) return false
  return /→ halt$/.test(rule.textContent ?? '')
}

/**
 * A pane whose own text already claims to be detached, but has not yet mounted the editor that claim
 * implies — the one state a pure text-quiescence poll cannot see past.
 *
 * **WHY QUIESCENCE ALONE IS NOT ENOUGH, MEASURED RATHER THAN ASSUMED.** A fork's click handler flips a
 * pane's heading to `[detached]` and names the new buffer SYNCHRONOUSLY, before any worker reply lands
 * — checked directly against an earlier draft of this file: `brings a warm TM buffer back showing its
 * machine`, below, failed intermittently with "no editor mounted in this pane" because that synchronous
 * placeholder text can sit unchanged for the whole 500ms window a text-only `settleOn` requires, while
 * the worker is still mid-compile and `.term-editor` has not been built yet.
 * `tm-scratch-fork.test.ts`'s own comment on `runs the edited machine` names the general shape of this
 * hazard ("WAIT ON THE FACT ITSELF, NOT ON QUIESCENCE") for a recompile; this is the same hazard for a
 * fork's own first mount.
 */
const detachedWithNoEditorYet = (pane: HTMLElement): boolean =>
  /detached/i.test(pane.textContent ?? '') && pane.querySelector('.term-editor') === null

/**
 * Wait until `snapshot()` stops changing for 500ms AND neither pane is stuck `[detached]` with no
 * editor mounted yet — `tm-scratch-fork.test.ts`'s own `settleOn`, with the extra condition
 * `detachedWithNoEditorYet` exists to close.
 *
 * **SCOPED TO BOTH LEGS' PANES JOINTLY, NOT TO ONE, AND MEASURED RATHER THAN ASSUMED SAFE.** Both
 * `tm-scratch-fork.test.ts` and `tm-blank-buffer.test.ts` scope their own version of this to the TM pane
 * alone, because in those files `lambda-0` stays bound to the source session across several DIFFERENT
 * programs dispatched into one page and a whole-page poll would catch it mid-transition between tests.
 * Neither hazard applies here: this file dispatches exactly one program per mount and both `mountApp`
 * tests that touch two panes fork them in sequence, waiting between. Watching only one leg would miss
 * the OTHER leg still mid-flight — checked directly rather than reasoned about, since `lambda-0` and
 * `tm-0` while both still bound to the small `SAMPLE`-sized source settle in well under a second either
 * way (measured with a throwaway probe against `'let x = 40; x + 2'` before this file was written).
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
 * against every sibling's own `mountApp` sees the same first line.
 */
let remountSeq = 0
async function freshMain(): Promise<{ ready: Promise<EditorView> }> {
  const spec = remountSeq === 0 ? '../../src/main' : `../../src/main?remount=${remountSeq}`
  remountSeq += 1
  return import(/* @vite-ignore */ spec)
}

/** Mount a fresh app on a fresh page with an empty store, and load `src` into its one source editor. */
async function mountApp(src: string): Promise<App> {
  localStorage.clear()
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

describe('restoring buffers on both legs', () => {
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
    expect(second.tmPane().textContent).toMatch(/detached/i)
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
   * `tm-blank-buffer.test.ts` found and named for `retire` (`buffer-list.ts`'s `bufferRow` builds
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
    expect(row.textContent).not.toMatch(/asleep/i)
  })

  /**
   * **THE DEFECT THIS TASK CLOSES, AND THE MIRROR OF THE ONE `main.ts`'s RESTORE-LOOP COMMENT ALREADY
   * NAMES.** `buffer-restore.test.ts`'s `SEEDED` fixture pins a `lambda`-leg buffer bound to a `tm` leaf
   * — refused today by the leaf-kind check `l.pane === 'lambda'` already sitting in the restore loop.
   * This pins the OTHER direction, which that same check does NOT refuse: a `tm`-leg buffer bound to a
   * `lambda` leaf. `lambdaLeaves.has('lambda-0')` is true regardless of which leg the NAMED buffer
   * actually has, so — before the fix in `main.ts` this test drives — this exact payload reaches
   * `pane-host.ts`'s `applyLayout`, which builds `PaneSlot('lambda', 'scratch-1')` for a session whose
   * only leg is `tm`, and the first `draw()` throws out of `SessionRegistry.legOf` and takes the whole
   * page down with it — reported, not reasoned about: see this task's own report for the verbatim
   * failure text captured against the unfixed source.
   *
   * **A HAND-BUILT PAYLOAD, NOT ONE THE APP CAN PRODUCE ON ITS OWN** — `buffers-store.ts`'s own doc on
   * `validBuffer` names the threat model directly: "the hazard is a hand-edited `localStorage` entry...
   * every rejection here is something a person could plausibly type." `parseBuffers` cannot refuse this
   * shape itself (a binding is `Record<LeafId, SessionId>` and carries no leg, by design — §4.1), so the
   * guard has to live where the tree and the buffer's own `leg` are both in scope at once, which is
   * exactly the restore loop in `main.ts` this test is aimed at.
   *
   * `LAYOUT_STORAGE_KEY` IS NOT SEEDED HERE — the first `mountApp` call already wrote the default tree
   * to it (every `applyLayout()` call persists, `buffers-store.ts`'s own doc on why buffers get a
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

    // THE PAGE COMING UP AT ALL IS THE FIRST ASSERTION. An unfixed restore loop throws out of `main()`'s
    // own first `draw()`, and `remountApp` below never resolves `.ready` — this whole test fails with
    // the `legOf` throw rather than reaching any `expect`, which is the failure this fix closes.
    const second = await remountApp()
    await second.settled()

    // THE BINDING WAS DROPPED, NOT HONOURED — the λ pane is on the source session, not the tm-leg
    // buffer the corrupt payload named for it.
    expect(document.querySelector('[data-leaf="lambda-0"] .detached-badge')).toBeNull()
    // AND THE BUFFER ITSELF SURVIVES, ORPHANED AND COLD — dropping a binding is not the same as ending a
    // buffer (design decision 2: nothing ends a buffer implicitly). `restore` puts every buffer back
    // cold, and nothing named this one to warm it.
    const rows = second.bufferRows()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    if (row === undefined) throw new Error('no buffer row on the restored page')
    expect(row.textContent).toMatch(/orphan/i)
    expect(row.textContent).toMatch(/asleep/i)
  })

  /**
   * **CRITICAL 1, FIRST REPRO — A FORK'S OWN EDIT NEVER REACHES `localStorage`, whole-branch review
   * before merge.** `replies.ts`'s `tm-scratch-compiled` arm mounts the recompiled text and moves on;
   * it never calls `onBuffersPersist()`, unlike its λ sibling (`scratch-compiled`'s own three-guard
   * sibling: `if (reply.text !== null) onBuffersPersist()`). `ScratchBuffers.recompile` writes the
   * edit into memory synchronously (`this.setText(id, src)`, ahead of posting the build), so the
   * running pane shows the edit immediately — this test's own first assertions below reproduce that
   * half — but nothing ever flushes the write this file's own `warm`/`snapshot` read back on a reload,
   * so a reload restores the buffer's ORIGINAL text, silently discarding the edit.
   *
   * **THIS IS `tm-scratch-fork.test.ts`'s `runs the edited machine`, CONTINUED PAST THE POINT THAT FILE
   * STOPS.** That file proves the edit reaches the running machine; it never reloads, so it cannot see
   * whether the edit reaches storage. `editedToHaltImmediately`/`startStateGoesToHalt` are its own
   * helpers, duplicated here per this file's stated idiom, reused rather than re-invented because the
   * edit and the wait for it to land are already proven correct there.
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
    // WAIT ON THE FACT ITSELF, NOT ON QUIESCENCE — `tm-scratch-fork.test.ts`'s own reason: typing
    // changes the editor's text synchronously, well before the debounced recompile ever reaches the
    // worker, so a content-quiescence poll could resolve in the gap before the edit has actually been
    // recompiled — which here would mean reloading before `tm-scratch-compiled` (and, once fixed, its
    // persist) has even run.
    await until(() => startStateGoesToHalt(first.tmPane(), start), `the δ-table to show \`${start}\` going to halt`)

    const second = await remountApp()
    await second.settled()
    expect(second.editorText(second.tmPane())).toBe(edited)
  })

  /**
   * **CRITICAL 1, SECOND REPRO — A BLANK BUFFER'S PASTE IS THE WORSE CASE, whole-branch review before
   * merge.** Design §2 decision 1's entire stated purpose for the blank-buffer gesture is *"emit a
   * file, paste it into a pane"* — `tm_emit`'s own round trip. Without `onBuffersPersist()` in
   * `tm-scratch-compiled`, that paste parses, runs, and then a reload comes back to an EMPTY buffer:
   * there was never a fork to seed `localStorage` with anything at all (unlike the first repro above,
   * where at least a stale ORIGINAL text survives), so the user's pasted file is simply gone.
   *
   * **`list_1_2.tm` IS THE REAL, TRACKED FIXTURE, NOT A SYNTHETIC STAND-IN** — 25,142 characters,
   * imported through Vite's own `?raw` suffix (see this file's own import comment) rather than
   * duplicated inline, so this test pastes exactly the file a user actually would.
   *
   * **THE POST-REMOUNT WAIT IS A BOUNDED `until` ON THE EDITOR MOUNTING, NOT `settled()` —
   * measured, not assumed.** Against the unfixed source the restored buffer's text is empty
   * (`localStorage` never got the paste), so its `tmScratch('')` request never produces a machine,
   * `tm-scratch-compiled` never fires, and `setEditor` never mounts a `.term-editor`. That pane is
   * ALSO permanently `[detached]` (any scratch-bound pane reads so, warm or not), so `settled()`'s own
   * `detachedWithNoEditorYet` guard — built for a fork's synchronous placeholder, this file's own doc
   * above — never clears either, and the shared helper hangs for its own full internal timeout rather
   * than failing fast. Waiting on the mount directly gives a short, legible failure instead.
   */
  it("keeps a pasted blank TM buffer's text after a reload", async () => {
    const first = await mountApp('let x = 40; x + 2')
    await first.compiled()
    first.buffersButton().click()
    first.buffersMenu().querySelector<HTMLButtonElement>('button.new-tm')?.click()
    await first.settled()
    pickBinding(first.tmPane(), { leg: 'tm', session: 'scratch-1' })
    await first.settled()

    const view = editorViewOf(first.tmPane())
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: list_1_2 } })
    // NOT A `.state-row` COUNT, and that half of the older reasoning here still stands: the δ-table is
    // VIRTUALIZED (accessibility list item 3, "only the ~24 rows in view exist in the DOM"), so its row
    // count never reflects the machine's true size and stays ~24 whichever machine is loaded — a check
    // waiting for `list_1_2.tm`'s own 455 (146 states + 309 rules) never resolves.
    //
    // **BUT NOT `settled()` EITHER, WHICH CORRECTS WHAT STOOD HERE.** That call waited for 500 ms of
    // unchanged text. The paste repaints the pane synchronously, and the worker then compiles 25,142
    // characters with nothing further touching the DOM until it answers — so the window can elapse
    // inside that silence and hand back "settled" while the buffer has not been persisted yet, after
    // which `remountApp` below reloads a store that never received the paste. MEASURED by bisecting the
    // window against this test: 150 ms fails, 300 ms passes, so the shipped 500 ms carried a margin of
    // only about 2-3x — the same order as the margin that actually reddened CI in
    // `tm-scratch-fork.test.ts` (run 229), whose `forkEditorMounted` doc has that story.
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

    // NO SECOND `pickBinding` HERE — this pane's binding was already recorded in the persisted layout
    // by the call above, so `main.ts`'s restore loop warms this buffer and rebinds `tm-0` to it on its
    // own (the SAME auto-rebind `brings a λ buffer and a TM buffer back on their own legs`, above,
    // already relies on for a forked pane, with no `pickBinding` call of its own after `remountApp`).
    const second = await remountApp()
    await until(
      () => second.tmPane().querySelector('.term-editor') !== null,
      'the restored buffer to mount its editor',
      10_000,
    )
    expect(second.editorText(second.tmPane())).toBe(list_1_2)
  })
})
