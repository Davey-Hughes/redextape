import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * **THE COOL → WARM → BIND ROUND TRIP, AND THE DEFECT IT USED TO END IN** — design §4.5's stated flow
 * ("warm from the header list, then bind a pane through the selector"), driven through the app.
 *
 * **WHAT THIS FILE EXISTS FOR: A WARMED BUFFER USED TO COME BACK UNEDITABLE, FOREVER** — whole-branch
 * review before merge. `ScratchBuffers.cool` rebinds every pane away from the buffer it sleeps, which is
 * the invariant the whole cold/warm split rests on, and `LambdaPane.setDetached(false)`'s teardown then
 * destroys the editor. `warm` posts a build that lands with no pane claiming a leaf, so `replies.ts`'s
 * `scratch-compiled` arm resolved `editorHome(session)` to `undefined` and mounted nothing. Binding a
 * pane back through the selector re-posted no build and claimed no leaf, and "bring the term editor to
 * this pane" is correctly withheld when `custody.hasEditor` is false — there was no editor to bring. The
 * buffer's frames rendered and its text could never be reached again, which made `cool` — "the
 * non-destructive escape from the cap", its own doc — destructive of editability. `pane-host.ts`'s
 * `mountScratchEditor` is the fix and this file is what fails without it.
 *
 * **IT DRIVES THE WHOLE SEQUENCE RATHER THAN THE LAST GESTURE, because every step before the last one is
 * what puts the app in the only state that reproduces it.** A buffer that has never been cooled always
 * has an editor somewhere — either mounted on the pane that forked it or waiting in `heldEditors` — so
 * `hasEditor` answers `true` and the claim control is offered. Cooling is what destroys the editor
 * without ending the buffer, and it is the only gesture in the app that does.
 *
 * ONE SEQUENCED `it`, for `scratch-edit.test.ts`'s reason verbatim: `beforeAll` mounts ONE app for the
 * file (ES module imports are cached, so `main()` runs once per page), the states below are ordered, and
 * three separate `it`s would each depend on the previous having actually run. Every stage asserts before
 * it acts.
 *
 * IT SEEDS NO STORAGE. Every browser test file gets its own in-memory `Storage` from
 * `tests/browser/setup.ts` before this module body runs, so this page starts with no layout and no
 * buffers — the default tree, and a fork that mints `scratch 1`.
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

/** `scratch-edit.test.ts`'s program, for its reason: it truncates at neither budget, so `✎ fork` is
 * offered at the frontier with no scrubbing needed. */
const SAMPLE = 'let x = 40; x + 2'

let view: EditorView

async function until(predicate: () => boolean, what: string, timeoutMs = 60_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const resultsText = () => document.querySelector('#results')?.textContent ?? ''
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== ''
const term = () => document.querySelector('[data-leaf="lambda-0"] .term')?.textContent ?? ''
const heading = () => document.querySelector('[data-leaf="lambda-0"] h2')?.textContent ?? ''
const editorHost = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor')
const everyEditorHost = () => [...document.querySelectorAll('.term-editor')]
const rowNames = () =>
  [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row-name')].map((e) => e.textContent)

/** `\x00` as an escape rather than the byte — `scripts/check-text-bytes.sh`'s rule. */
const optionValue = (leg: string, id: string) => `${leg}\x00${id}`

const clickLambda = (label: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')].find(
    (x) => x.textContent === label,
  )
  if (b === undefined) throw new Error(`no \`${label}\` button in the λ pane`)
  b.click()
}

/**
 * Open the header's buffer list, leaving it open if it already is — `buffer-restore.test.ts`'s helper
 * and its reason: there is one page for the file, so a second bare `click()` would toggle the list shut
 * and every row query after it would answer nothing.
 */
async function openList(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>('#buffers')
  if (button === null) throw new Error('no #buffers button in the header')
  if (button.getAttribute('aria-expanded') !== 'true') button.click()
  await until(() => rowNames().length > 0, 'the buffer list to open')
}

/**
 * Close the list if it is open.
 *
 * **A ROW IS BUILT PER OPEN AND NEVER REPAINTED WHILE IT IS SHOWING** — `bufferList`'s rows thunk runs
 * from `beforetoggle` and from a temperature click's own rebuild, and `draw()` does not touch the list
 * at all. So a pane count that changes while the popover is open lands nowhere until it is opened again,
 * and a row assertion made across a rebind has to close and reopen first. `buffer-restore.test.ts`'s
 * `termsAfterReopen` states the same fact for the term line.
 */
const closeList = () => {
  const button = document.querySelector<HTMLButtonElement>('#buffers')
  if (button === null) throw new Error('no #buffers button in the header')
  if (button.getAttribute('aria-expanded') === 'true') button.click()
}

const clickRowControl = (name: string) => {
  const b = document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
  if (b === null) throw new Error(`no \`${name}\` control in the buffer list`)
  b.click()
}

/** What the mounted editor actually holds, read off CodeMirror rather than off the DOM's text nodes,
 * which are virtualized and would answer only the visible lines. */
function editorDoc(): string {
  const host = editorHost()
  if (host === null) throw new Error('no scratch editor mounted under [data-leaf="lambda-0"]')
  const cmView = EditorView.findFromDOM(host)
  if (cmView === null) throw new Error('no CodeMirror view mounted under the editor host')
  return cmView.state.doc.toString()
}

/** A real keystroke into the scratch's own editor — `scratch-edit.test.ts`'s helper and its reason:
 * `LambdaEditor#setText` sets a `#seeding` flag for its dispatch, so it reports no edit at all. */
function typeIntoScratchEditor(text: string): void {
  const host = editorHost()
  if (host === null) throw new Error('no scratch editor mounted under [data-leaf="lambda-0"]')
  const cmView = EditorView.findFromDOM(host)
  if (cmView === null) throw new Error('no CodeMirror view mounted under the editor host')
  cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: text } })
}

describe('a cooled buffer warmed and bound to a pane again', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(idle, 'the first compile')
  })

  it('mounts an editor holding its text of record, and that editor still edits the buffer', async () => {
    // STAGE 0 — a forked buffer with an editor on the pane that made it. The text this editor holds is
    // the buffer's TEXT OF RECORD (design §4.3: `replies.ts`'s `scratch-compiled` arm writes the
    // worker's own re-derived term through `setText`), which is what every assertion below compares
    // against — captured rather than spelled, so this file asserts a round trip rather than a literal.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SAMPLE } })
    await until(idle, 'the sample program to compile')
    clickLambda('✎ fork')
    await until(() => editorHost() !== null, 'the fork to mount its editor')
    await until(() => term() !== '', 'the forked buffer to produce its first frame')
    const forked = editorDoc()
    expect(forked).not.toBe('')

    // STAGE 1 — COOL. The pane goes back to the source session and the editor comes down with it, which
    // is `setDetached(false)`'s teardown rather than anything the buffer did: the buffer is still listed
    // and still holds its text. Both halves are asserted because the defect this file exists for lives
    // between them — a buffer that survives while its editor does not.
    await openList()
    clickRowControl('cool scratch 1')
    expect(heading()).not.toContain('[detached]')
    expect(editorHost()).toBeNull()
    expect(rowNames()).toEqual(['scratch 1 — orphan — asleep'])

    // STAGE 2 — WARM. The row loses its asleep marker synchronously (`handleTemperature` rebuilds the
    // rows around the caller's handler returning), and NOTHING MOUNTS, which is correct and is asserted
    // rather than assumed: no pane is bound to this buffer, so there is no pane for an editor to mount
    // onto. This is the state the fix must not change.
    clickRowControl('warm scratch 1')
    expect(rowNames()).toEqual(['scratch 1 — orphan'])
    expect(everyEditorHost()).toHaveLength(0)
    closeList()

    // STAGE 3 — BIND, WHICH IS THE GESTURE UNDER TEST. Design §4.5's own words for what a user does
    // after a warm. Before `pane-host.ts`'s `mountScratchEditor` this produced a pane rendering the
    // buffer's frames with no editor and no control able to summon one, and the wait below is what
    // timed out.
    const select = document.querySelector<HTMLSelectElement>('[data-leaf="lambda-0"] .pane-binding select')
    if (select === null) throw new Error('no binding selector on the λ pane')
    select.value = optionValue('lambda', 'scratch-1')
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(heading()).toContain('[detached]')

    // BOUNDED BELOW VITEST'S OWN 15s `testTimeout` RATHER THAN AT THIS FILE'S 60s DEFAULT, and the
    // number is chosen so that THIS wait's message is the one a regression prints. The mount is
    // synchronous with the `change` event, so anything past a frame or two is the absence rather than a
    // slow machine — and a bound at or above the harness's own would let Vitest kill the test first,
    // producing "Test timed out" with no name for what never arrived. Measured: with `pane-host.ts`'s
    // `mountScratchEditor` reverted, this line is what fails.
    await until(() => editorHost() !== null, 'the warmed buffer to mount an editor onto its newly bound pane', 10_000)
    // ASSERTIONS THE WAIT ABOVE DOES NOT ALREADY IMPLY, which is the whole point of their being here:
    // the wait proves an editor exists, and these two prove it is the RIGHT one and the ONLY one. A
    // second mount is the failure `LambdaPane.receiveEditor` throws on and `setEditor`'s re-seed branch
    // would absorb silently, so the count is the assertion that catches it.
    expect(everyEditorHost()).toHaveLength(1)
    expect(editorDoc()).toBe(forked)

    // STAGE 4 — AND IT IS A LIVE EDITOR OVER A LIVE WORKER, which a mounted `.term-editor` cannot show
    // on its own: the box would look identical over a session `pool.unbind` had terminated, and over one
    // whose `onEdit` reached a buffer that no longer exists. A real keystroke recompiles THIS buffer
    // (`transport.ts`'s `editScratch` reads `slot.binding.session`), and the frames region moving is
    // that buffer's own thread answering.
    //
    // THE WARM'S OWN REBUILD IS AWAITED FIRST, AND IT IS AN ASSERTION RATHER THAN A SETTLING DELAY: the
    // pane was on the source session until the `change` event two statements up, so its frames region is
    // empty until this buffer's worker answers — and what it answers with is the text of record at step
    // 0, which is already a normal form here, so the pane ends up showing exactly the string the editor
    // is holding. Without this wait the `term() !== beforeEdit` below would fire on the REBUILD rather
    // than on the keystroke, and the edit would go unmeasured.
    await until(() => term() === forked, "the warmed buffer's own rebuild to reach its newly bound pane")
    const beforeEdit = term()
    typeIntoScratchEditor('(λa. a a) (λb. b)')
    await until(() => term() !== beforeEdit, 'the re-bound buffer to recompile from a keystroke')
    expect(term()).toContain('b')
    // AND NOTHING FORKED A SECOND BUFFER TO GET HERE. A fix that answered the mount by forking would
    // satisfy every assertion above and read two rows here. Reopened first, per `closeList`'s doc: the
    // rebind two stages up changed this row's pane count and no repaint reaches a list already open.
    await openList()
    expect(rowNames()).toEqual(['scratch 1 — 1 pane'])
  })
})
