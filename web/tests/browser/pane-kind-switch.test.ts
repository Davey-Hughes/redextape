import { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, type LayoutNode, setLeafKind } from '../../src/layout'
import { bindingKey } from '../../src/view-header'
import { parseWorkspace } from '../../src/workspace'
import {
  editorsInLeaf,
  lambdaLeaves,
  leafIds,
  leafKind,
  pickBinding,
  places,
  resetToFourViews,
  SHELL,
  showing,
  splitSame,
  stateIdle,
  stepTextOf,
  termOf,
  titleOf,
  until,
} from './harness'

/**
 * **A PANE CHANGES WHAT IT SHOWS, IN PLACE** — decision 1's headline capability, driven entirely
 * through the pane's own binding selector.
 *
 * The axis this file drives, the LEG, is the one `PaneSlot<K>` deliberately cannot carry — a slot's leg
 * has no writer, so a leg change is the replacement of a whole `PaneEntry` under an unchanged `LeafId`,
 * performed by `applyLayout`'s two passes rather than by anything in the slot.
 *
 * THE HARNESS IS `two-lambda-panes.test.ts`'s shell and one-mount-per-file `beforeAll` (ES module
 * imports are cached, so `main()` runs once per page and Vitest gives each test FILE its own page), with
 * a `beforeEach` of this file's own that undoes the tree shape through `resetToFourViews` and puts the
 * source program back. That file's doc has the argument for each, including why the first compile has to
 * be waited for before any fork click can land. Selectors are that file's verbatim: `button.detach` for
 * the fork (the button carries real text, not an `aria-label`), `aria-label` for the glyph-only layout
 * controls, and `bindingKey(leg, session)` for the title menu's items.
 *
 * **KINDS ARE READ FROM `data-kind`, AND THAT IS THE POINT OF THE ATTRIBUTE RATHER THAN A CONVENIENCE
 * HERE.** `hostFor` writes it once when it mints a host and a kind change REUSES that host, so
 * `applyLayout`'s rewrite of it is the only thing keeping it true — a test that inferred a pane's kind
 * from its leaf id would be reading a string `nextLeafId` does not spell from the kind.
 *
 * Section and decision citations here are the 5d-ii-b design's unless they name another.
 */

const storedTree = (): LayoutNode | null => parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.tree ?? null

let view: EditorView

beforeAll(async () => {
  // Each browser test file gets its own in-memory `Storage`, installed in `tests/browser/setup.ts` before
  // this file's own module body runs — see that file's doc for why clearing a shared key was not enough —
  // so neither key needs clearing here.
  // WIDE ENOUGH FOR ITS ADDS: at the runner's default 414 px a view is 201 px wide, and the app refuses a split or a
  // `+ view` that leaves a view under `MIN_VIEW_PX` (`layout.ts`). The default's 896 px height is kept.
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
})

beforeEach(async () => {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
  await resetToFourViews()
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(
    () =>
      document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
      // ALL FOUR VIEWS: source, λ, asm and TM.
      leafIds().length === 4 &&
      lambdaLeaves().length === 1,
    'all four views on a settled source program',
  )
})

describe('a pane changes which leg it renders', () => {
  /**
   * DECISION 1 ITSELF: the pane keeps its leaf id, its place among its siblings and its size, which is
   * exactly what a close followed by a split cannot promise.
   *
   * IT SPLITS FIRST, SO THE TREE IS UNEVEN BEFORE THE SWITCH. On the four-view tree every leaf has the
   * same `flex`, so "the sizes did not change" would hold for an implementation that dropped the leaf and
   * appended a fresh one at the end of its row. One split makes the switched leaf's size 0.5 inside an
   * inner split — a shape a rebuild cannot arrive at by accident, and one whose collapse `closeLeaf` would
   * perform is visible in both the DOM order and the persisted tree.
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
      // Both splits below exist to give the switched pane a NEIGHBOUR, which is what makes the tree uneven enough
      // for "kept its place and its size" to be a claim — what the neighbour shows is not what either test is about,
      // so the duplicate case is the right entry here.
      splitSame('lambda-0', 'row')
      await until(() => lambdaLeaves().length === 2, 'the split to produce a second λ pane')

      const placesBefore = places()
      const treeBefore = storedTree()
      const lambdaStep = stepTextOf('lambda-0')
      // THROWN AT THE SITE RATHER THAN CAST AWAY BELOW. `setLeafKind` needs a `LayoutNode`, and a
      // `?? ({} as LayoutNode)` fallback would be dead code whose deadness depended on an `expect` three
      // lines up — the reader has to prove the assertion runs first to know the cast never does.
      if (treeBefore === null) throw new Error('applyLayout persisted no tree before the switch')
      expect(leafKind('lambda-0')).toBe('lambda')
      expect(termOf('lambda-0')).not.toBe('')
      expect(lambdaStep).not.toBe('')

      pickBinding('lambda-0', bindingKey('tm', 'source'))
      await until(() => leafKind('lambda-0') === 'tm', 'the λ pane to become a TM pane')

      // THE HOST WAS REBUILT, NOT RELABELLED. `.state-table` is `TmPane`'s and `.term` is
      // `LambdaPane`'s, so the two together say the contents changed with the attribute.
      expect(document.querySelector('[data-leaf="lambda-0"] .state-table')).not.toBeNull()
      expect(document.querySelector('[data-leaf="lambda-0"] .term')).toBeNull()

      // SAME LEAF, SAME PLACE, SAME SIZE — decision 1.
      expect(places()).toEqual(placesBefore)
      expect(storedTree()).toEqual(setLeafKind(treeBefore, 'lambda-0', 'tm'))

      // AND IT IS SHOWING THE PAIR THAT WAS PICKED, RESOLVED.
      expect(titleOf('lambda-0')?.dataset.binding).toBe(bindingKey('tm', 'source'))
      expect(stepTextOf('lambda-0')).toBe(stepTextOf('tm-0'))
      expect(stepTextOf('lambda-0')).not.toBe(lambdaStep)
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  /**
   * **THE OTHER CREATION PATH.** A cross-leg pick drops the leaf's entry and builds a new `TmPane` under
   * the unchanged id, so the pane it produces is as new as one a split creates — and outside the reply
   * switch, `TmPane.setProgram` is called only by the seeding (`tm-seed.ts`), so without it both would
   * arrive blank. The test above asserts this pane resolves its new binding (`.step`, painted from the
   * leg); nothing there asks whether the MACHINE reached it, and every assertion in it holds of a pane
   * showing no tapes, no status line and no δ-rows at all.
   *
   * IT ASSERTS AGAINST `tm-0`, WHICH NEVER MOVED. That pane was on screen when the `compiled` reply
   * landed and was pushed the program directly; equal tapes and an equal status line are what say the
   * switched pane was seeded with the same machine at the same frame rather than with anything non-empty.
   * `showing`'s own doc has the rest; `pane-picker.test.ts` says why the δ-row count is not compared.
   */
  it('renders the program compiled before the switch, in the pane the switch created', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      expect(showing('tm-0').rows).toBeGreaterThan(0)

      pickBinding('lambda-0', bindingKey('tm', 'source'))
      await until(() => leafKind('lambda-0') === 'tm', 'the λ pane to become a TM pane')

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
   * **THE EDITOR SURVIVES A KIND CHANGE, WHICH IS THE CUSTODY PATH REACHED THROUGH A GESTURE OTHER THAN A
   * CLOSE.** `applyLayout`'s pass 1 hands a departing λ pane's editor to `custody.hold` before
   * `panes.remove` makes the pane unreachable. A kind change removes the same entry as a close does, for a
   * different reason, and the handover has to cover both — which is why the predicate sits ABOVE the
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
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
      await until(() => editorsInLeaf('lambda-0') > 0, 'the fork to mount an editor')
      splitSame('lambda-0', 'row')
      await until(() => lambdaLeaves().length === 2, 'the split to produce a second λ pane')
      const survivor = lambdaLeaves().find((id) => id !== 'lambda-0') ?? ''
      expect(survivor).not.toBe('')
      expect(editorsInLeaf('lambda-0')).toBe(1)
      expect(editorsInLeaf(survivor)).toBe(0)

      const hostBefore = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .cm-content')
      if (hostBefore === null) throw new Error('the forked pane has no editor host')
      const viewBefore = EditorView.findFromDOM(hostBefore)
      if (viewBefore === null) throw new Error('no CodeMirror view mounted under the forked pane')
      const cursorAt = viewBefore.state.doc.length
      viewBefore.dispatch({ selection: { anchor: cursorAt } })

      // THE SWITCH, ON THE PANE THAT IS HOLDING THE EDITOR.
      pickBinding('lambda-0', bindingKey('tm', 'source'))
      await until(() => leafKind('lambda-0') === 'tm', 'the editor-holding λ pane to become a TM pane')

      // MOUNTED NOWHERE, DESTROYED NOWHERE — in custody, which no surface shows directly. The
      // observable is that the page holds no mounted scratch editor at all while the source editor is
      // untouched.
      expect(document.querySelectorAll('.term-editor .cm-editor').length).toBe(0)
      expect(document.querySelectorAll('.cm-editor').length).toBe(1)

      const claim = document.querySelector<HTMLButtonElement>(`[data-leaf="${survivor}"] button.claim-editor`)
      expect(claim).not.toBeNull()
      claim?.click()
      await until(() => editorsInLeaf(survivor) === 1, 'the survivor to claim the held editor')

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
   * **THE CONTROL THE PICK WAS MADE WITH IS DESTROYED BY THE PICK.** `applyLayout` reaches the incoming
   * pane's `host.replaceChildren(…)`, which takes the title-selector the user is operating with it; with
   * nothing putting focus anywhere afterwards, a keyboard user who arrowed to a TM pair and pressed Enter
   * would be left on `<body>`, one Tab away from the top of the document. `close` answers this with a
   * `focusPane` on the view next to the closed one; this arm answers it with `focusPane(id)`, the same
   * leaf, because the pane did not go anywhere — only its contents changed.
   *
   * IT FOCUSES THE TITLE-SELECTOR FIRST, WHICH IS THE HALF THAT MAKES THIS A TEST RATHER THAN A GESTURE.
   * `document.activeElement` is `<body>` on a page nobody has clicked, so an assertion that focus is
   * inside the pane afterwards would pass against a no-op if focus had never been anywhere else.
   * Parking it on the control that is about to be destroyed is what makes the "not `<body>`" assertion
   * mean the rescue ran.
   *
   * IT ASSERTS THE LEAF, NOT MERELY "SOMEWHERE IN THE TREE": focus landing in a NEIGHBOUR would satisfy
   * that weaker assertion while moving the user somewhere they did not ask to be. Here the leaf is the
   * pane itself; `layout-app.test.ts`'s close case names the pane that took the closed one's space.
   */
  it('puts focus back in the pane whose control the switch destroyed', async () => {
    const title = titleOf('lambda-0')
    if (title === null) throw new Error('the λ view has no title-selector')
    title.focus()
    expect(document.activeElement).toBe(title)

    pickBinding('lambda-0', bindingKey('tm', 'source'))
    await until(() => leafKind('lambda-0') === 'tm', 'the λ pane to become a TM pane')

    expect(document.activeElement).not.toBe(document.body)
    const landed = (document.activeElement as HTMLElement | null)?.closest('[data-leaf]')
    expect((landed as HTMLElement | null)?.dataset.leaf).toBe('lambda-0')
    // THE OLD CONTROL IS GONE, WHICH IS WHY THIS NEEDED AN ANSWER AT ALL — a rescue that had merely
    // kept the same element alive would satisfy every assertion above and none of decision 1's.
    expect(document.activeElement).not.toBe(title)
    expect(title.isConnected).toBe(false)
  })

  /**
   * **THREE CLICKS: COMPILE, FORK THE λ PANE, THEN PICK THE BUFFER'S OWN `λ · …` ENTRY ON THE TM PANE.**
   * `PaneSlot.render` pushes `pairs()` to every pane, so a TM pane's selector genuinely lists a λ-only
   * session. A handler that took the session half and kept the slot's leg would mint `{ leg: 'tm',
   * session: <the buffer> }` — which `legOf` throws on, inside `draw.ts`'s per-pane loop, which has no
   * `try`/`catch`: not one dropped frame but every frame after it. A guard there that refused the pick
   * would make it a silent no-op. The pick is acted on one layer up, where the layout tree is: the leaf
   * changes kind and the entry is rebuilt on the leg that was picked. The node tier cannot drive that —
   * `pane-host.ts` needs a DOM and a tree.
   *
   * IT DRIVES A SECOND FRAME AFTER THE SWITCH RATHER THAN STOPPING AT THE DOM. A wedged loop throws on
   * EVERY LATER frame, so a test that asserted only the state right after the pick would pass on a render
   * loop that was already dead.
   */
  it('acts on a cross-leg pick from the TM side instead of wedging the render loop', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
      await until(() => editorsInLeaf('lambda-0') > 0, 'the fork to register a scratch buffer')
      expect(leafKind('tm-0')).toBe('tm')

      // THE PAIR THE FORK PRODUCED, READ OFF THE PANE THAT PERFORMED IT. A fork mints `scratch-N`
      // (5d-ii-c decision 1), and the number depends on how many forks this FILE ran before this test (one
      // `main()` per page), so it cannot be written down; the pane that just forked is where the app itself
      // records it. `pickBinding` throws if the value it is handed is not in the target selector, which is
      // what keeps this from silently picking nothing.
      const buffer = titleOf('lambda-0')?.dataset.binding ?? ''
      expect(buffer).not.toBe(bindingKey('lambda', 'source'))

      pickBinding('tm-0', buffer)
      await until(() => leafKind('tm-0') === 'lambda', 'the TM pane to become a λ pane on the buffer')

      expect(titleOf('tm-0')?.dataset.binding).toBe(buffer)
      expect(document.querySelector('[data-leaf="tm-0"] h2')?.textContent).toContain('copy · not linked')
      await until(() => termOf('tm-0') !== '', "the scratch's own term to paint in the switched pane")
      // TWO λ PANES ON THE SCRATCH AND NO TM PANE AT ALL, which is a legal state — `draw.ts` and
      // `link-wiring.ts` answer an empty leg with `undefined` rather than a throw.
      expect(lambdaLeaves().sort()).toEqual(['lambda-0', 'tm-0'])
      expect(document.querySelectorAll('[data-kind="tm"]').length).toBe(0)

      // A SECOND FRAME, WHICH IS THE WHOLE POINT OF THE STAGE — a wedged loop throws on EVERY later frame.
      // **NOT `◀` ON THE SWITCHED PANE**: the buffer's run opens on its step 0 (`History`), so `canBack` is
      // false and the click is a silent no-op.
      //
      // **AND NOT A SOURCE KEYSTROKE EITHER.** A keystroke ends no buffer (5d-ii-c design §4.3's table), so
      // it moves nothing and there would be nothing to observe. AN EDIT OF THE BUFFER drives the same
      // per-pane loop `draw.ts` would throw in, and shows the switched pane following the buffer's OWN later
      // frames, on a binding it acquired through a cross-leg pick.
      const scratchTerm = termOf('tm-0')
      expect(stepTextOf('tm-0')).not.toBe('')
      const editorHost = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .cm-content')
      if (editorHost === null) throw new Error('the forked pane has no editor host')
      const bufferView = EditorView.findFromDOM(editorHost)
      if (bufferView === null) throw new Error('no CodeMirror view mounted under the forked pane')
      bufferView.dispatch({ changes: { from: 0, to: bufferView.state.doc.length, insert: '(λu. u) (λw. w)' } })
      await until(
        () => termOf('tm-0') !== scratchTerm && termOf('tm-0') !== '',
        "the switched pane to repaint on the buffer's own new frames",
      )
      // Both λ panes resolve the one buffer's λ leg, so the two showing the same term is that repaint
      // having reached this pane rather than only the one holding the editor.
      expect(termOf('tm-0')).toBe(termOf('lambda-0'))
      expect(document.querySelector('[data-leaf="tm-0"] h2')?.textContent).toContain('copy · not linked')

      // AND THE KEYSTROKE PATH, which reaches `link-wiring.ts` from the source editor's own update
      // listener without going through `draw.ts` first — the other entry point the throw could be
      // reached from. The switched pane is still on the buffer afterwards, which is 5d-ii-c decision 2 (a
      // keystroke ends no buffer) read on a pane bound through a cross-leg pick.
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' + 0' } })
      await until(stateIdle, 'the source recompile to settle')
      expect(titleOf('tm-0')?.dataset.binding).toBe(buffer)
      expect(document.querySelector('[data-leaf="tm-0"] h2')?.textContent).toContain('copy · not linked')
      expect(termOf('tm-0')).toBe(termOf('lambda-0'))
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })
})
