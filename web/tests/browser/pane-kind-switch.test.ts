import type { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, type LayoutNode, setLeafKind } from '../../src/layout'
import { bindingKey } from '../../src/view-header'
import { parseWorkspace } from '../../src/workspace'
import {
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
 * THE HARNESS IS `SHELL` and a one-mount-per-file `beforeAll` (ES module imports are cached, so `main()` runs once per
 * page and Vitest gives each test FILE its own page), with a `beforeEach` of this file's own that undoes the tree shape
 * through `resetToFourViews` and puts the source program back, and waits for the first compile. Selectors: `aria-label`
 * for the glyph-only layout controls, and `bindingKey(leg, session)` for the title menu's items.
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
  // WIDE ENOUGH FOR ITS ADDS: at the runner's default 414 px a view is 201 px wide, and the app refuses a split that
  // leaves a view under `MIN_VIEW_PX` (`layout.ts`). The default's 896 px height is kept.
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
      // ALL FOUR VIEWS: source, λ, rxm and TM.
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
})
