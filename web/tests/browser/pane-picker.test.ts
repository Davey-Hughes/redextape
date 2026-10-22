import type { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { bindingKey } from '../../src/view-header'
import {
  editorsInLeaf,
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
 * A split that duplicates the pane it was performed on is the "another view of this" entry, first in
 * the split menu, and `two-lambda-panes.test.ts`, `layout-app.test.ts`, `layout-restore.test.ts` and
 * `pane-kind-switch.test.ts` take it. The two claims THIS file makes are the ones only the split menu's
 * other entries can make: a split can create a pane of a leg the splitting pane does not render, on a
 * session it is not bound to, and it can create the SOURCE pane, which `reset preset` brings back only
 * at the cost of every other pane on the page.
 *
 * THE HARNESS IS `pane-kind-switch.test.ts`'s — `two-lambda-panes.test.ts`'s shell and one-mount-per-file
 * `beforeAll` (ES module imports are cached, so `main()` runs once per page and Vitest gives each test
 * FILE its own page), and a `beforeEach` that undoes the tree shape through `resetToFourViews` and puts
 * the source program back. Selectors are those files' verbatim: `button.detach` for the fork (the button
 * carries real text, not an `aria-label`), `aria-label` for the glyph-only layout controls, and the
 * title's `data-binding` (`bindingKey(leg, session)`) for the pair a view shows.
 */

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
    expect(showing(created)).toEqual({ tapes: '', rows: 0, status: '' })

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let y = 7; y + 1' } })
    await until(
      () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && showing(created).rows > 0,
      'the repaired program to reach the created pane',
    )
    expect(showing(created).tapes).toBe(showing('tm-0').tapes)
    expect(showing(created).tapes).not.toBe('')
  })

  /**
   * **THE SESSION HALF OF THE PICK, WHICH `creates a TM pane from a λ pane` CANNOT SEE.** Both panes there
   * are on the source session, so an implementation that ignored `choice.session` and kept binding the
   * new leaf to the session it was split FROM would pass it. Forking first puts the splitting pane on a λ
   * copy, so `λ · program` names a session the pane performing the split is not on, and the new pane's
   * own title-selector is what says which one it landed on.
   *
   * AND THE SPLITTING PANE IS ASSERTED UNMOVED: a split names the session of the leaf it CREATES, so an
   * implementation that routed the pick through a rebind would satisfy the first assertion and swap the
   * two panes' bindings behind it.
   */
  it('starts the new pane on the session that was picked, not on the one that was split', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
    await until(() => editorsInLeaf('lambda-0') > 0, 'the fork to mount an editor')
    // THE PAIR THIS FORK LANDED ON, CAPTURED BEFORE THE SPLIT. Each fork mints a name of its own (5d-ii-c
    // decision 1), and the number depends on how many forks ran earlier in this FILE (one `main()` per
    // page), so it is not a constant a test can write. Reading it here also sharpens the claim: the
    // splitting pane is unmoved from THE BUFFER IT WAS ON, not merely still on something detached.
    const buffer = titleOf('lambda-0')?.dataset.binding ?? ''
    expect(buffer).not.toBe(bindingKey('lambda', 'source'))

    const before = leafIds()
    splitVia('lambda-0', 'row', bindingKey('lambda', 'source'))
    await until(() => leafIds().length === before.length + 1, 'the split to add a leaf')

    const created = leafIds().find((id) => !before.includes(id)) ?? ''
    expect(created).not.toBe('')
    expect(leafKind(created)).toBe('lambda')
    expect(titleOf(created)?.dataset.binding).toBe(bindingKey('lambda', 'source'))
    expect(document.querySelector(`[data-leaf="${created}"] h2`)?.textContent).not.toContain('not linked')
    expect(document.querySelector(`[data-leaf="${created}"] h2`)?.textContent).toBe('λ · program')
    // The pane the split was performed ON is still on the buffer it forked — this created a pane, it
    // did not rebind one.
    expect(titleOf('lambda-0')?.dataset.binding).toBe(buffer)
    expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('copy · not linked')
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
      expect(leafIds()).toEqual(['lambda-0', 'source', 'asm-0', 'tm-0', extra])
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
