import type { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { bindingKey } from '../../src/view-header'
import {
  lambdaLeaves,
  leafIds,
  leafKind,
  places,
  resetToFourViews,
  SHELL,
  showing,
  splitVia,
  stateIdle,
  stepTextOf,
  titleOf,
  until,
} from './harness'

/**
 * **THE SPLIT MENU, ACTING** — a split creates what it was asked to create, and the closed source pane has a
 * way back that keeps the layout the user built.
 *
 * A split that duplicates the pane it was performed on is the "another view of this" entry, first in the split menu,
 * and `layout-app.test.ts`, `layout-restore.test.ts` and `pane-kind-switch.test.ts` take it. The two claims THIS file
 * makes are the ones only the split menu's other entries can make: a split can create a pane of a leg the splitting
 * pane does not render, and it can create the SOURCE pane, which `reset preset` brings back only at the cost of every
 * other pane on the page. The last case holds that cost's other half: the pane `reset preset` brings back still holds
 * the program.
 *
 * THE HARNESS IS `pane-kind-switch.test.ts`'s — `SHELL` and a one-mount-per-file `beforeAll` (ES module imports are
 * cached, so `main()` runs once per page and Vitest gives each test FILE its own page), and a `beforeEach` that undoes
 * the tree shape through `resetToFourViews` and puts the source program back. Selectors are those files' verbatim:
 * `aria-label` for the glyph-only layout controls, and the title's `data-binding` (`bindingKey(leg, session)`) for the
 * pair a view shows.
 */

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

describe('a split creates what the split menu was asked for', () => {
  /**
   * THE SPLIT MENU'S HEADLINE: a λ pane can create a TM pane beside itself. The λ count below is what makes
   * this test fail against a split that gave the new leaf the kind of the leaf it was split from —
   * asserting only `data-kind` of the new leaf would leave a "duplicate the kind" implementation failing
   * on the id it produced rather than on what it produced.
   *
   * IT ASSERTS THE PANE, NOT ONLY THE ATTRIBUTE. `.state-table` is `TmPane`'s own DOM, and the step
   * readout is painted by `draw()` from the leg the slot resolves — so a new pane showing the SAME step
   * as the TM pane the default layout ships is evidence the whole pass ran over a binding `legOf`
   * accepted, not merely that `applyLayout` wrote `tm` into `dataset.kind`.
   */
  it('creates a TM pane from a λ pane, bound to the pair that was picked', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      const before = leafIds()
      splitVia('lambda-0', 'row', bindingKey('tm', 'source'))
      await until(() => leafIds().length === before.length + 1, 'the split to add a leaf')

      const created = leafIds().find((id) => !before.includes(id)) ?? ''
      expect(created).not.toBe('')
      expect(leafKind(created)).toBe('tm')
      expect(document.querySelector(`[data-leaf="${created}"] .state-table`)).not.toBeNull()
      // THE λ PANE WAS NOT DUPLICATED.
      expect(lambdaLeaves()).toEqual(['lambda-0'])
      expect(titleOf(created)?.dataset.binding).toBe(bindingKey('tm', 'source'))
      expect(stepTextOf(created)).toBe(stepTextOf('tm-0'))
      expect(stepTextOf(created)).not.toBe('')
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  /**
   * **THE PANE THE SPLIT MENU CREATES SHOWS THE MACHINE THAT WAS ALREADY COMPILED.** Outside the reply
   * switch, `TmPane.setProgram` is called only by the seeding (`tm-seed.ts`), so without it every TM
   * pane created AFTER its session's last `compiled` reply would render no tapes, no status line and no
   * δ-rows until something recompiled — and creating a TM pane from a λ pane is the split menu's headline.
   *
   * **IT ASSERTS CONTENT, NOT `.state-table`.** `creates a TM pane from a λ pane` asserts that element is
   * present, which it is on an empty pane too — `TmPane`'s constructor builds it before any program exists. `showing`'s
   * three readings are the ones a blank pane cannot produce; its own doc says which part of the paint each
   * comes from and why the three fail in different directions.
   *
   * **AND IT COMPARES AGAINST THE PANE THAT HAS BEEN OPEN SINCE THE COMPILE.** `tm-0` was on screen when
   * the `compiled` reply landed and was pushed the program directly, so equal tapes and an equal status
   * line say the created pane was seeded with the SAME machine at the SAME frame rather than with
   * something merely non-empty. The δ-row count is deliberately not compared: the table is virtualized
   * against each pane's own height, and these two panes are different sizes.
   */
  it('renders the program the session already compiled, in the TM pane the split created', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      const before = leafIds()
      splitVia('lambda-0', 'row', bindingKey('tm', 'source'))
      await until(() => leafIds().length === before.length + 1, 'the split to add a leaf')

      const created = leafIds().find((id) => !before.includes(id)) ?? ''
      expect(created).not.toBe('')
      expect(leafKind(created)).toBe('tm')

      const shown = showing(created)
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
   * **A SESSION WITH NOTHING COMPILED SEEDS NOTHING, AND THE PANE IS EMPTY RATHER THAN STALE.** The
   * retention is cleared by the same replies that clear every TM pane on the session — `no-session` here,
   * whose own arm says stale frames must not survive a broken program — so a created pane matches the
   * panes already on screen instead of showing a machine none of them is showing.
   *
   * **THE δ-ROWS ARE WHERE THIS IS VISIBLE AT ALL, WHICH IS WHY THE ASSERTION IS NOT MERELY THE TAPES.**
   * A failed compile empties the legs, so any TM pane paints no tapes and no status line whether or not a
   * machine is retained — but the δ-table is drawn from the program alone and would go on listing the
   * previous program's states under a pane with nothing running in it.
   *
   * **IT RECOMPILES AT THE END, AND WITHOUT THAT THE TEST WOULD PASS ON A PANE THAT NEVER WORKS.** Every
   * assertion above is satisfied by a pane wired to nothing at all; the source edit is what says the pane
   * created during the outage is a live member of the session's fan-out.
   */
  it('creates an empty TM pane when the last compile produced no machine', async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = ;' } })
    await until(
      () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && showing('tm-0').rows === 0,
      'the broken program to empty the TM pane',
    )

    const before = leafIds()
    splitVia('lambda-0', 'row', bindingKey('tm', 'source'))
    await until(() => leafIds().length === before.length + 1, 'the split to add a leaf')
    const created = leafIds().find((id) => !before.includes(id)) ?? ''
    expect(created).not.toBe('')
    expect(leafKind(created)).toBe('tm')
    // THE STATUS LINE HOLDS THE VIEW'S STEP TEXT, which says why the leg cannot step before it has a frame.
    expect(showing(created)).toEqual({ tapes: '', rows: 0, status: 'not compiled' })

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let y = 7; y + 1' } })
    await until(
      () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && showing(created).rows > 0,
      'the repaired program to reach the created pane',
    )
    expect(showing(created).tapes).toBe(showing('tm-0').tapes)
    expect(showing(created).tapes).not.toBe('')
  })
})

describe('a page whose last λ view is closed', () => {
  /**
   * **A LEG WITH NO VIEW IS A LEGAL STATE.** `closeLeaf` refuses only the last leaf in the TREE, so a page's last λ
   * view can be closed, and `draw.ts` and `link-wiring.ts` must not throw on an empty λ leg. A throw there would
   * persist: `applyLayout` writes the tree to `localStorage` before it calls `draw()`, so the λ-less arrangement would
   * be committed and a reload would come straight back to the dead app.
   *
   * IT DRIVES BOTH ENTRY POINTS, because they are reachable independently and one fix could plausibly miss either.
   * `draw()` is the per-frame path (the TM transport below); `link-wiring.ts` is reached from the source editor's own
   * `updateListener` on every keystroke, through `drawLink`, per leg, with no λ view to ask.
   */
  it('keeps working after the last λ view is closed, rather than throwing on every frame', async () => {
    // UNHANDLED ERRORS ARE COLLECTED, NOT INFERRED FROM A GREEN ASSERTION. A throw inside a click handler or a
    // CodeMirror update listener does not reject anything this test awaits — it surfaces as an `error` event on
    // `window` and nothing else, so a test that only checked the DOM afterwards could pass while the app was throwing
    // on every frame behind it.
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      await userEvent.click(
        document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-close') as HTMLButtonElement,
      )
      await until(() => lambdaLeaves().length === 0, 'the last λ view to close')
      expect(leafIds()).toEqual(['source', 'rxm-0', 'tm-0'])

      // THE PER-FRAME PATH, DRIVEN ON PURPOSE AND ASSERTED ON ITS OUTPUT. A step of the TM view runs `draw()` — the
      // function that would throw — and its step text is painted by that same pass, so a changed step text is
      // evidence the repaint happened rather than evidence nothing crashed. `▶` RATHER THAN `◀`: a run opens on step
      // 0 (`History`), so back is disabled and a press on it changes nothing.
      const before = stepTextOf('tm-0')
      expect(before).not.toBe('')
      const forward = [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="tm-0"] .controls button')].find(
        (b) => b.textContent === '▶',
      )
      await userEvent.click(forward as HTMLButtonElement)
      await until(() => stepTextOf('tm-0') !== before, 'the TM view’s step to move')

      // THE KEYSTROKE PATH, which reaches `link-wiring.ts` without going through `draw.ts` first.
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' + 0' } })
      await until(stateIdle, 'the edited program to compile')

      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })
})

describe('the closed source pane comes back through the split menu', () => {
  /**
   * **THIS IS THE CAPABILITY `reset preset` DOES NOT PROVIDE, AND THE ASSERTIONS ARE CHOSEN TO TELL THE
   * TWO APART.** Restoring the default layout also brings the source pane back — so a test that only
   * asked whether a source leaf exists afterwards would pass against a split menu that quietly called
   * `defaultLayout()`. The layout is therefore made one the default cannot produce (a fifth leaf, from a
   * split of the TM pane) before the source pane is closed, and the whole leaf list is asserted after it
   * returns: the extra pane is still there, in its place, at the size it had.
   *
   * THE EDITOR IS THE OTHER HALF. `hostFor`'s detach-not-destroy rule keeps the source host — and the
   * CodeMirror instance inside it — alive while its leaf is out of the tree, which is what makes the
   * program survive; a returning leaf that minted a fresh id would get a fresh, EMPTY host instead, and
   * `#editor` would still be detached from the document with the user's program in it. `#editor` is
   * asserted absent while the pane is closed for exactly that reason: it is what makes its return
   * meaningful rather than a re-query of something that never left.
   */
  it('brings back the program and leaves the rest of the layout standing', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      // A LAYOUT THE DEFAULT CANNOT PRODUCE — five leaves, the fifth split off the TM pane.
      const before = leafIds()
      splitVia('tm-0', 'column', 'same')
      await until(() => leafIds().length === before.length + 1, 'the TM pane to split')
      const extra = leafIds().find((id) => !before.includes(id)) ?? ''
      expect(extra).not.toBe('')

      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let z = 9; z' } })
      await until(stateIdle, 'the edited program to compile')
      const extraPlace = places().find((p) => p.startsWith(`${extra}@`)) ?? ''
      expect(extraPlace).not.toBe('')

      document.querySelector<HTMLButtonElement>('[data-leaf="source"] button[aria-label="close this view"]')?.click()
      await until(() => !leafIds().includes('source'), 'the source pane to close')
      // The editor left the document with its host, rather than being destroyed — `hostFor`'s rule.
      expect(document.querySelector('#editor')).toBeNull()

      splitVia('lambda-0', 'column', 'source')
      await until(() => leafIds().includes('source'), 'the source pane to come back')

      expect(leafKind('source')).toBe('source')
      expect(document.querySelector('[data-leaf="source"] #editor')).not.toBeNull()
      expect(document.querySelector('[data-leaf="source"] .cm-content')?.textContent).toContain('let z = 9')
      // WHERE IT CAME BACK, AND THAT NOTHING ELSE MOVED: `reset preset` would answer
      // `['source', 'tm-0']` here, which is what this line is chosen to fail against.
      expect(leafIds()).toEqual(['lambda-0', 'source', 'rxm-0', 'tm-0', extra])
      expect(places().find((p) => p.startsWith(`${extra}@`))).toBe(extraPlace)
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  /**
   * **THE SOURCE ARM OF THE SAME RESCUE `layout-app.test.ts` PINS FOR THE MINTING ARM.** `split` ends in
   * `focusPane`, and this branch of it names `SOURCE_LEAF` rather than a fresh id for the reason the
   * handler reuses that literal at all: the source pane's host is the one `main.ts` seeded, holding the
   * live editor. So the leaf focus should land in is the one the split menu just put back, and it is the
   * same leaf the choice named.
   *
   * IT PARKS FOCUS ON THE CONTROL FIRST — `document.activeElement` is `<body>` on a page nobody has
   * clicked, so an assertion that focus is inside the source pane afterwards would pass against a no-op
   * if focus had never been anywhere else.
   */
  it('puts focus in the source pane the split menu just brought back', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="source"] button[aria-label="close this view"]')?.click()
    await until(() => !leafIds().includes('source'), 'the source pane to close')

    const control = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-more')
    if (control === null) throw new Error('the λ view has no ⋯ menu')
    control.focus()
    expect(document.activeElement).toBe(control)

    splitVia('lambda-0', 'column', 'source')
    await until(() => leafIds().includes('source'), 'the source pane to come back')

    expect(document.activeElement).not.toBe(document.body)
    const landed = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-leaf]')
    expect(landed?.dataset.leaf).toBe('source')
  })

  /**
   * THE OFFER IS CONDITIONAL, AND BOTH DIRECTIONS ARE ASSERTED ON ONE PAGE. `source` is in the menu
   * exactly when no source leaf is in the tree — `splitLeaf` throws on a second one, so an unconditional
   * entry would be a control that provably cannot work, offered anyway. The pair list is built when a
   * split is chosen, from `choices()` (`viewMenu`'s own doc), so the last open below has to reflect a
   * tree that changed with nothing calling `update` in between.
   *
   * EXACT EQUALITY AGAINST `'source'`, NOT A SUBSTRING TEST. `toContain` on an array compares whole
   * elements, and the source VIEW's entry is the one label that reads exactly `source`. A substring test
   * could never fail while a pair's label held `source` (as `λ · source` would), and the whole-element
   * comparison is what keeps the assertion able to fail whatever the pairs are called.
   */
  it('offers source only while no source leaf is in the tree', async () => {
    const labels = (leaf: string, dir: 'row' | 'column'): string[] => {
      const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-more`)
      more?.click()
      const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
      menu?.querySelector<HTMLButtonElement>(`button.view-split[data-dir="${dir}"]`)?.click()
      const items = [...(menu?.querySelectorAll<HTMLButtonElement>('.view-menu-pairs button') ?? [])].map(
        (b) => b.textContent ?? '',
      )
      menu?.hidePopover()
      return items
    }

    expect(labels('lambda-0', 'row')).not.toContain('source')
    expect(labels('lambda-0', 'row')).toContain('TM · program')

    document.querySelector<HTMLButtonElement>('[data-leaf="source"] button[aria-label="close this view"]')?.click()
    await until(() => !leafIds().includes('source'), 'the source pane to close')

    expect(labels('lambda-0', 'row')).toContain('source')
  })
})

describe('the closed source pane comes back through reset preset', () => {
  /**
   * **THE PROGRAM IS STILL IN IT.** `reset preset` builds `defaultLayout()`'s tree, whose source leaf is the
   * `SOURCE_LEAF` literal, so `hostFor` hands back the host the editor waited in while its leaf was out of the tree.
   * A source leaf built on a fresh host would come back with an empty editor and the program out of reach.
   */
  it('keeps the program when the source pane is closed and restored', async () => {
    const cm = document.querySelector<HTMLElement>('[data-leaf="source"] .cm-content')
    if (cm === null) throw new Error('no source editor')
    const before = cm.textContent ?? ''
    expect(before.length).toBeGreaterThan(0)

    document.querySelector<HTMLButtonElement>('[data-leaf="source"] button[aria-label="close this view"]')?.click()
    await until(() => !leafIds().includes('source'), 'the source pane to close')

    await resetToFourViews()
    await until(() => leafIds().includes('source'), 'reset preset to bring the source pane back')

    expect(document.querySelector('[data-leaf="source"] .cm-content')?.textContent).toBe(before)
  })
})
