import { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY, type LayoutNode, parseLayout, setLeafKind } from '../../src/layout'

/**
 * **A PANE CHANGES WHAT IT SHOWS, IN PLACE** — decision 1's headline capability, driven entirely
 * through the pane's own binding selector.
 *
 * Every file beside this one asserts what a pane does while its LEG stays fixed:
 * `two-lambda-panes.test.ts` moves the session axis and the editor between panes,
 * `scratch-rebind-editor.test.ts` moves the session axis away from a scratch. The axis this file adds
 * is the one `PaneSlot<K>` deliberately cannot carry — a slot's leg has no writer, so a leg change is
 * the replacement of a whole `PaneEntry` under an unchanged `LeafId`, performed by `applyLayout`'s two
 * existing passes rather than by anything in the slot.
 *
 * THE HARNESS IS `two-lambda-panes.test.ts`'s, DELIBERATELY UNMODIFIED — the same shell, the same
 * one-mount-per-file `beforeAll` (ES module imports are cached, so `main()` runs once per page and
 * Vitest gives each test FILE its own page), and a `beforeEach` that undoes the tree shape through
 * `reset layout` and puts the source program back. Its own doc has the argument for each, including why
 * the first compile has to be waited for before any fork click can land. **THE SECOND HALF OF THAT
 * SENTENCE USED TO READ "a live scratchpad, through a source recompile"**, which stopped being true
 * with 5d-ii-c decision 2: a keystroke ends no buffer, so a buffer a test forks outlives it. Only the
 * last test here forks, and nothing runs after it — where `two-lambda-panes.test.ts`, whose every test
 * forks, rebinds its λ panes back to `source` explicitly for exactly this reason. Selectors are that file's verbatim: `.controls .detach` for the
 * fork (the button carries real text, not an `aria-label`), `aria-label` for the glyph-only layout
 * controls, and `leg\x00session` for the selector's option values — `\x00` as an escape is
 * `scripts/check-text-bytes.sh`'s rule.
 *
 * **KINDS ARE READ FROM `data-kind`, AND THAT IS THE POINT OF THE ATTRIBUTE RATHER THAN A CONVENIENCE
 * HERE.** `hostFor` writes it once when it mints a host and a kind change REUSES that host, so
 * `applyLayout`'s rewrite of it is the only thing keeping it true — a test that inferred a pane's kind
 * from its leaf id would be reading a string `nextLeafId` stopped spelling for exactly this reason.
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

const leafIds = () => [...document.querySelectorAll<HTMLElement>('[data-leaf]')].map((e) => e.dataset.leaf ?? '')
const lambdaLeaves = () =>
  [...document.querySelectorAll<HTMLElement>('[data-kind="lambda"]')].map((e) => e.dataset.leaf ?? '')
const kindOf = (leaf: string) => document.querySelector<HTMLElement>(`[data-leaf="${leaf}"]`)?.dataset.kind ?? ''
/**
 * Every leaf's id paired with the `flex` `layout-view.ts` gave it, in document order — "where each pane
 * is and how big it is", as one comparable value.
 *
 * THE ID IS IN IT BECAUSE THE ORDER IS HALF THE CLAIM. `renderLayout` only ever appends, so a pane
 * rebuilt as a fresh leaf rather than changed in place would arrive at the END of its parent split with
 * a size the divider positions no longer describe; comparing bare sizes would call that arrangement
 * equal to this one whenever the sizes happen to match.
 */
const places = () =>
  [...document.querySelectorAll<HTMLElement>('[data-leaf]')].map((e) => `${e.dataset.leaf}@${e.style.flex}`)
const btn = (leaf: string, label: string) =>
  document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button[aria-label="${label}"]`)
/**
 * Split `leaf` into a second pane of the same kind on the same session — `two-lambda-panes.test.ts`'s
 * `splitSame`, verbatim, and its doc carries the argument: the split control opens a picker now, whose
 * first entry is the pane's own pair labelled `(same)`, so the gesture that used to be one click is two
 * and still means what it meant. Both splits below exist to give the switched pane a NEIGHBOUR, which is
 * what makes the tree uneven enough for "kept its place and its size" to be a claim — what the neighbour
 * shows is not what either test is about, so the duplicate case is the right entry here.
 */
const splitSame = (leaf: string, control: string): void => {
  const button = btn(leaf, control)
  if (button === null) throw new Error(`no "${control}" control on [data-leaf="${leaf}"]`)
  button.click()
  const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
  const first = menu?.querySelector<HTMLButtonElement>('button') ?? null
  if (first === null || !(first.textContent ?? '').endsWith('(same)')) {
    throw new Error(`${leaf}'s "${control}" menu does not start with the duplicate case: ${first?.textContent}`)
  }
  first.click()
}
const selectOf = (leaf: string) =>
  document.querySelector<HTMLSelectElement>(`[data-leaf="${leaf}"] .pane-binding select`)
/** The `<option>` value the pane selector encodes a `(leg, session)` pair as — `two-lambda-panes.test.ts`'s. */
const optionValue = (leg: string, id: string) => `${leg}\x00${id}`
const editorsIn = (leaf: string) => document.querySelectorAll(`[data-leaf="${leaf}"] .cm-editor`).length
const termOf = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .term`)?.textContent ?? ''
/**
 * What a TM pane is actually showing — `pane-picker.test.ts`'s `showing`, verbatim, and its doc carries
 * the argument for the three readings and for counting `.cell` rather than `.tape`.
 */
const showing = (leaf: string) => ({
  tapes: [...document.querySelectorAll(`[data-leaf="${leaf}"] .tape .cell`)].map((e) => e.textContent).join(''),
  rows: document.querySelectorAll(`[data-leaf="${leaf}"] .state-row`).length,
  status: document.querySelector(`[data-leaf="${leaf}"] .tm-status`)?.textContent ?? '',
})
const stepOf = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .step`)?.textContent ?? ''
const storedTree = (): LayoutNode | null => parseLayout(localStorage.getItem(LAYOUT_STORAGE_KEY))

/**
 * Pick a `(leg, session)` pair in `leaf`'s binding selector, through the real `<select>`.
 *
 * **IT ASSERTS THE OPTION WAS THERE, WHICH IS NOT PEDANTRY** — `select.value = x` for an option the
 * list does not hold silently leaves the value at `''`, and the `change` handler then splits an empty
 * string and reports a pair naming no session. Every assertion in every test below would go on passing
 * against a pick that never happened. `two-lambda-panes.test.ts` records the same hazard at the one
 * place it sets a value.
 */
const pick = (leaf: string, value: string): void => {
  const select = selectOf(leaf)
  if (select === null) throw new Error(`no binding selector on [data-leaf="${leaf}"]`)
  select.value = value
  if (select.value !== value) throw new Error(`the selector on ${leaf} does not offer \`${value}\``)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * `scratch-rebind-editor.test.ts`'s `until`, message and all — a timeout that names what it was waiting
 * for is the difference between a legible red run and a bare "timed out". THREE SECONDS RATHER THAN
 * SIXTY, so this fires inside Vitest's own 5 s test timeout and the failure carries the predicate's
 * name instead of the runner's.
 */
async function until(predicate: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

let view: EditorView

beforeAll(async () => {
  // Each browser test file gets its own in-memory `Storage` now, installed in `tests/browser/setup.ts`
  // before this file's own module body runs — see that file's doc for why clearing a shared key was not
  // enough. Neither key needs clearing here any more.
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(
    () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle',
    'the first compile',
    60_000,
  )
})

beforeEach(async () => {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
  document.querySelector<HTMLButtonElement>('#restore-layout')?.click()
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(
    () =>
      document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
      leafIds().length === 3 &&
      lambdaLeaves().length === 1,
    'the default layout on a settled source program',
    60_000,
  )
})

describe('a pane changes which leg it renders', () => {
  /**
   * DECISION 1 ITSELF: the pane keeps its leaf id, its place among its siblings and its size, which is
   * exactly what a close followed by a split cannot promise.
   *
   * IT SPLITS FIRST, SO THE TREE IS UNEVEN BEFORE THE SWITCH. On the shipped three-pane row every leaf
   * has the same `flex`, so "the sizes did not change" would hold for an implementation that dropped the
   * leaf and appended a fresh one at the end of the row. One split makes the switched leaf's size 0.5
   * inside an inner split while its neighbours are a third of the outer one — a shape a rebuild cannot
   * arrive at by accident, and one whose collapse `closeLeaf` would perform is visible in both the DOM
   * order and the persisted tree.
   *
   * THE PERSISTED TREE IS COMPARED AGAINST `setLeafKind` OF THE OLD ONE, not against a hand-written
   * literal. That is decision 1 spelled as an equation — "the tree afterwards is the tree before with
   * ONE field changed" — and `setLeafKind` is a pure function of `layout.ts` that `tests/node/layout.test.ts`
   * pins independently, so this is an oracle rather than a circular restatement of what `applyLayout` did.
   *
   * **AND IT ASSERTS THE PANE RESOLVES ITS NEW BINDING, WHICH IS THE HALF A `data-kind` CHECK CANNOT
   * SEE.** `.step` is painted by `draw()` from the leg the slot resolves, so a switched pane showing the
   * TM leg's step count — the same one the untouched TM pane shows, and NOT the λ count it showed a
   * moment ago — is evidence the whole pass ran over a binding `legOf` accepted.
   */
  it('a λ pane becomes a TM pane in place, keeping its leaf id, its place and its size', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      splitSame('lambda-0', 'split left and right')
      await until(() => lambdaLeaves().length === 2, 'the split to produce a second λ pane')

      const placesBefore = places()
      const treeBefore = storedTree()
      const lambdaStep = stepOf('lambda-0')
      // THROWN AT THE SITE RATHER THAN CAST AWAY BELOW. `setLeafKind` needs a `LayoutNode`, and a
      // `?? ({} as LayoutNode)` fallback would be dead code whose deadness depended on an `expect` three
      // lines up — the reader has to prove the assertion runs first to know the cast never does.
      if (treeBefore === null) throw new Error('applyLayout persisted no tree before the switch')
      expect(kindOf('lambda-0')).toBe('lambda')
      expect(termOf('lambda-0')).not.toBe('')
      expect(lambdaStep).not.toBe('')

      pick('lambda-0', optionValue('tm', 'source'))
      await until(() => kindOf('lambda-0') === 'tm', 'the λ pane to become a TM pane')

      // THE HOST WAS REBUILT, NOT RELABELLED. `.state-table` is `TmPane`'s and `.term` is
      // `LambdaPane`'s, so the two together say the contents changed with the attribute.
      expect(document.querySelector('[data-leaf="lambda-0"] .state-table')).not.toBeNull()
      expect(document.querySelector('[data-leaf="lambda-0"] .term')).toBeNull()

      // SAME LEAF, SAME PLACE, SAME SIZE — decision 1.
      expect(places()).toEqual(placesBefore)
      expect(storedTree()).toEqual(setLeafKind(treeBefore, 'lambda-0', 'tm'))

      // AND IT IS SHOWING THE PAIR THAT WAS PICKED, RESOLVED.
      expect(selectOf('lambda-0')?.value).toBe(optionValue('tm', 'source'))
      expect(stepOf('lambda-0')).toBe(stepOf('tm-0'))
      expect(stepOf('lambda-0')).not.toBe(lambdaStep)
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  /**
   * **THE OTHER CREATION PATH, AND IT HAD THE SAME HOLE.** A cross-leg pick drops the leaf's entry and
   * builds a new `TmPane` under the unchanged id, so the pane it produces is as new as one a split
   * creates — and `TmPane.setProgram` is called from the reply switch and from nowhere else, so before
   * the seeding both arrived blank. The test above asserts this pane resolves its new binding (`.step`,
   * painted from the leg); nothing there asks whether the MACHINE reached it, and every assertion in it
   * holds of a pane showing no tapes, no status line and no δ-rows at all.
   *
   * IT ASSERTS AGAINST `tm-0`, WHICH NEVER MOVED. That pane was on screen when the `compiled` reply
   * landed and was pushed the program directly; equal tapes and an equal status line are what say the
   * switched pane was seeded with the same machine at the same frame rather than with anything non-empty.
   * `showing`'s own doc has the rest, including why the δ-row count is not compared.
   */
  it('renders the program compiled before the switch, in the pane the switch created', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      expect(showing('tm-0').rows).toBeGreaterThan(0)

      pick('lambda-0', optionValue('tm', 'source'))
      await until(() => kindOf('lambda-0') === 'tm', 'the λ pane to become a TM pane')

      const shown = showing('lambda-0')
      expect(shown.tapes).not.toBe('')
      expect(shown.rows).toBeGreaterThan(0)
      expect(shown.status).toContain('width')
      expect(shown.tapes).toBe(showing('tm-0').tapes)
      expect(shown.status).toBe(showing('tm-0').status)
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  /**
   * **THE EDITOR SURVIVES A KIND CHANGE, WHICH IS THE CUSTODY PATH REACHED THROUGH A GESTURE THAT DID
   * NOT EXIST WHEN IT WAS WRITTEN.** `applyLayout`'s pass 1 hands a departing λ pane's editor to
   * `custody.hold` before `panes.remove` makes the pane unreachable; every test that drove that path
   * before this one closed the pane to trigger it. A kind change removes the same entry for a different
   * reason, and the handover has to cover both — which is why the widened predicate sits ABOVE the
   * handover rather than beside it.
   *
   * IT ASSERTS IDENTITY, NOT A COUNT, for `two-lambda-panes.test.ts`'s reason: destroying the view and
   * building a fresh one seeded with the same text produces identical `.cm-editor` counts at every step.
   * `EditorView.findFromDOM` plus a cursor parked away from position 0 — where a freshly constructed
   * `EditorState` always starts — is what a rebuild fails.
   *
   * THE SURVIVOR'S CLAIM CONTROL IS ASSERTED TO BE OFFERED **AND** TO WORK. Either half alone passes
   * against the failure this guards: the button is offered whenever a detached pane holds no editor, so
   * an editor destroyed by the switch rather than taken into custody would leave it offered and inert —
   * the exact "control that provably cannot work, offered anyway" the custody machinery exists to
   * prevent.
   */
  it('carries the editor into custody when the pane holding it changes leg', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')?.click()
      await until(() => editorsIn('lambda-0') > 0, 'the fork to mount an editor')
      splitSame('lambda-0', 'split left and right')
      await until(() => lambdaLeaves().length === 2, 'the split to produce a second λ pane')
      const survivor = lambdaLeaves().find((id) => id !== 'lambda-0') ?? ''
      expect(survivor).not.toBe('')
      expect(editorsIn('lambda-0')).toBe(1)
      expect(editorsIn(survivor)).toBe(0)

      const hostBefore = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .cm-content')
      if (hostBefore === null) throw new Error('the forked pane has no editor host')
      const viewBefore = EditorView.findFromDOM(hostBefore)
      if (viewBefore === null) throw new Error('no CodeMirror view mounted under the forked pane')
      const cursorAt = viewBefore.state.doc.length
      viewBefore.dispatch({ selection: { anchor: cursorAt } })

      // THE SWITCH, ON THE PANE THAT IS HOLDING THE EDITOR.
      pick('lambda-0', optionValue('tm', 'source'))
      await until(() => kindOf('lambda-0') === 'tm', 'the editor-holding λ pane to become a TM pane')

      // MOUNTED NOWHERE, DESTROYED NOWHERE — in custody, which no surface shows directly. The
      // observable is that the page holds no mounted scratch editor at all while the source editor is
      // untouched.
      expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(0)
      expect(document.querySelectorAll('.cm-editor').length).toBe(1)

      const claim = btn(survivor, 'bring the term editor to this pane')
      expect(claim).not.toBeNull()
      claim?.click()
      await until(() => editorsIn(survivor) === 1, 'the survivor to claim the held editor')

      const hostAfter = document.querySelector<HTMLElement>(`[data-leaf="${survivor}"] .cm-content`)
      if (hostAfter === null) throw new Error('the claiming pane has no editor host')
      const viewAfter = EditorView.findFromDOM(hostAfter)
      expect(viewAfter).toBe(viewBefore)
      expect(viewAfter?.state.selection.main.head).toBe(cursorAt)
      // THE SAME ONE, IN ONE PLACE — a hand-back that duplicated rather than relocated satisfies every
      // assertion above except this one.
      expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(1)
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  /**
   * **THE CONTROL THE PICK WAS MADE WITH IS DESTROYED BY THE PICK — IMPORTANT FINDING, REVIEW OF THE
   * COMMIT THAT ADDED THE CROSS-LEG ARM.** `applyLayout` reaches the incoming pane's
   * `host.replaceChildren(…)`, which takes the `<select>` the user is operating with it, and nothing
   * put focus anywhere afterwards: a keyboard user who arrowed to a TM pair and pressed Enter was left
   * on `<body>`, one Tab away from the top of the document. `close` answered exactly this with
   * `focusPane(grew)`; this arm answers it with `focusPane(id)`, the same leaf, because the pane did
   * not go anywhere — only its contents changed.
   *
   * IT FOCUSES THE `<select>` FIRST, WHICH IS THE HALF THAT MAKES THIS A TEST RATHER THAN A GESTURE.
   * `document.activeElement` is `<body>` on a page nobody has clicked, so an assertion that focus is
   * inside the pane afterwards would pass against a no-op if focus had never been anywhere else.
   * Parking it on the control that is about to be destroyed is what makes the "not `<body>`" assertion
   * mean the rescue ran.
   *
   * IT ASSERTS THE LEAF, NOT MERELY "SOMEWHERE IN THE TREE" — `layout-app.test.ts`'s close-path test
   * takes the weaker form because a close has no pane of its own to return to, and this one does. Focus
   * landing in a NEIGHBOUR would satisfy that weaker assertion while moving the user somewhere they did
   * not ask to be.
   */
  it('puts focus back in the pane whose control the switch destroyed', async () => {
    const select = selectOf('lambda-0')
    if (select === null) throw new Error('the λ pane has no binding selector')
    select.focus()
    expect(document.activeElement).toBe(select)

    pick('lambda-0', optionValue('tm', 'source'))
    await until(() => kindOf('lambda-0') === 'tm', 'the λ pane to become a TM pane')

    expect(document.activeElement).not.toBe(document.body)
    const landed = (document.activeElement as HTMLElement | null)?.closest('[data-leaf]')
    expect((landed as HTMLElement | null)?.dataset.leaf).toBe('lambda-0')
    // THE OLD CONTROL IS GONE, WHICH IS WHY THIS NEEDED AN ANSWER AT ALL — a rescue that had merely
    // kept the same element alive would satisfy every assertion above and none of decision 1's.
    expect(document.activeElement).not.toBe(select)
    expect(select.isConnected).toBe(false)
  })

  /**
   * **THE CRITICAL'S OWN THREE CLICKS, WHOSE ANSWER CHANGED FROM "REFUSE" TO "FOLLOW".** Compile, fork
   * the λ pane, then pick the buffer's own `λ · …` entry on the TM pane: `PaneSlot.render` pushes
   * `pairs()` to every pane, so a TM pane's selector genuinely lists a λ-only session. `transport.ts`'s
   * handler used to take the session half and keep the slot's leg, minting `{ leg: 'tm', session: <the
   * buffer> }` —
   * which `legOf` throws on, inside `draw.ts`'s per-pane loop, which has no `try`/`catch`: not one
   * dropped frame but every frame after it. A guard in that handler then made the pick a silent no-op.
   *
   * **THIS FILE IS WHERE THAT GUARD'S CLAIM MOVED TO, AND `tests/node/sessions.test.ts` NO LONGER MAKES
   * IT.** The pick is acted on now, one layer up, where the layout tree is: the leaf changes kind and
   * the entry is rebuilt on the leg that was picked. The node tier cannot drive that — `pane-host.ts`
   * needs a DOM and a tree — so the cross-leg half of that test moved here, to the same three clicks it
   * described, with the outcome inverted.
   *
   * IT DRIVES A SECOND FRAME AFTER THE SWITCH RATHER THAN STOPPING AT THE DOM. The Critical's signature
   * was that EVERY LATER frame threw, so a test that asserted only the state right after the pick would
   * pass on a render loop that was already dead — `◀` on the switched pane's own transport strip runs
   * `draw()` again, and a changed step readout is evidence it completed.
   */
  it('acts on a cross-leg pick from the TM side instead of wedging the render loop', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')?.click()
      await until(() => editorsIn('lambda-0') > 0, 'the fork to register a scratch buffer')
      expect(kindOf('tm-0')).toBe('tm')

      // THE PAIR THE FORK PRODUCED, READ OFF THE PANE THAT PERFORMED IT. This test picked the literal
      // `optionValue('lambda', 'lambda-scratch')` — 5d-i's one fixed scratch id — and 5d-ii-c decision 1
      // mints `scratch-N` per fork instead. The number depends on how many forks this FILE ran before
      // this test (one `main()` per page), so it cannot be written down; the pane that just forked is
      // where the app itself records it. `pick` throws if the value it is handed is not in the target
      // selector, which is what keeps this from silently picking nothing.
      const buffer = selectOf('lambda-0')?.value ?? ''
      expect(buffer).not.toBe(optionValue('lambda', 'source'))

      pick('tm-0', buffer)
      await until(() => kindOf('tm-0') === 'lambda', 'the TM pane to become a λ pane on the buffer')

      expect(selectOf('tm-0')?.value).toBe(buffer)
      expect(document.querySelector('[data-leaf="tm-0"] h2')?.textContent).toContain('[detached]')
      await until(() => termOf('tm-0') !== '', "the scratch's own term to paint in the switched pane")
      // TWO λ PANES ON THE SCRATCH AND NO TM PANE AT ALL, which is a legal state — `draw.ts` and
      // `link-wiring.ts` answer an empty leg with `undefined` rather than a throw.
      expect(lambdaLeaves().sort()).toEqual(['lambda-0', 'tm-0'])
      expect(document.querySelectorAll('[data-kind="tm"]').length).toBe(0)

      // A SECOND FRAME, WHICH IS THE WHOLE POINT OF THE STAGE — the Critical's signature was that EVERY
      // later frame threw. **NOT `◀` ON THE SWITCHED PANE, WHICH IS WHAT THIS WAS UNTIL IT WAS RUN**:
      // the fork seeds the buffer from the λ pane's CURRENT step, and that pane was at the frontier, so
      // the buffer's own run is a single frame — `canBack` is false and the click is a silent no-op.
      //
      // **AND NOT A SOURCE KEYSTROKE EITHER, WHICH IS WHAT IT WAS UNTIL 5d-ii-c DECISION 2.** That
      // keystroke used to retire the buffer, so the switched pane was rebound to `source` and repainted
      // from a session it was never built for — this stage asserted exactly that, ending on
      // `not.toContain('[detached]')` and on both λ panes showing the source's own leg. A keystroke ends
      // no buffer now (design §4.3's table), so it moves nothing and there would be nothing to observe.
      // AN EDIT OF THE BUFFER drives the same per-pane loop `draw.ts` threw in, and says something the
      // retire could not: the switched pane follows the buffer's OWN later frames, on a binding it
      // acquired through a cross-leg pick.
      const scratchTerm = termOf('tm-0')
      expect(stepOf('tm-0')).not.toBe('')
      const editorHost = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .cm-content')
      if (editorHost === null) throw new Error('the forked pane has no editor host')
      const bufferView = EditorView.findFromDOM(editorHost)
      if (bufferView === null) throw new Error('no CodeMirror view mounted under the forked pane')
      bufferView.dispatch({ changes: { from: 0, to: bufferView.state.doc.length, insert: '(λu. u) (λw. w)' } })
      await until(
        () => termOf('tm-0') !== scratchTerm && termOf('tm-0') !== '',
        "the switched pane to repaint on the buffer's own new frames",
        10_000,
      )
      // Both λ panes resolve the one buffer's λ leg, so the two showing the same term is that repaint
      // having reached this pane rather than only the one holding the editor.
      expect(termOf('tm-0')).toBe(termOf('lambda-0'))
      expect(document.querySelector('[data-leaf="tm-0"] h2')?.textContent).toContain('[detached]')

      // AND THE KEYSTROKE PATH, which reaches `link-wiring.ts` from the source editor's own update
      // listener without going through `draw.ts` first — the other entry point the Critical could be
      // reached from. The switched pane is still on the buffer afterwards, which is decision 2 read on
      // the pane the Critical was about.
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' + 0' } })
      await until(
        () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle',
        'the source recompile to settle',
        10_000,
      )
      expect(selectOf('tm-0')?.value).toBe(buffer)
      expect(document.querySelector('[data-leaf="tm-0"] h2')?.textContent).toContain('[detached]')
      expect(termOf('tm-0')).toBe(termOf('lambda-0'))
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })
})
