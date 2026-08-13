import type { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'

/**
 * **THE PICKER, ACTING** — a split creates what it was asked to create, and the closed source pane has a
 * way back that keeps the layout the user built.
 *
 * Every file beside this one drives a split as the gesture it USED to be: one click that duplicated the
 * pane it was performed on. That is still reachable — it is the `(same)` entry, first in every menu —
 * and `two-lambda-panes.test.ts`, `layout-app.test.ts`, `layout-restore.test.ts` and
 * `pane-kind-switch.test.ts` all take it, which is why their splits still produce what they always did.
 * The two claims THIS file makes are the ones only a picker can make: a split can create a pane of a leg
 * the splitting pane does not render, on a session it is not bound to, and it can create the SOURCE pane
 * — the one leaf `reset layout` was previously the only route back to, at the cost of every other pane
 * on the page.
 *
 * THE HARNESS IS `pane-kind-switch.test.ts`'s, WHICH IS `two-lambda-panes.test.ts`'s — the same shell,
 * the same one-mount-per-file `beforeAll` (ES module imports are cached, so `main()` runs once per page
 * and Vitest gives each test FILE its own page), the same `beforeEach` that undoes both drifts a test can
 * leave behind. Selectors are those files' verbatim: `.controls .detach` for the fork (the button carries
 * real text, not an `aria-label`), `aria-label` for the glyph-only layout controls, `leg\x00session` for
 * the selector's option values — `\x00` as an escape is `scripts/check-text-bytes.sh`'s rule.
 */

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
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
/** Every leaf's id paired with the `flex` `layout-view.ts` gave it — `pane-kind-switch.test.ts`'s `places`. */
const places = () =>
  [...document.querySelectorAll<HTMLElement>('[data-leaf]')].map((e) => `${e.dataset.leaf}@${e.style.flex}`)
const selectOf = (leaf: string) =>
  document.querySelector<HTMLSelectElement>(`[data-leaf="${leaf}"] .pane-binding select`)
/** The `<option>` value the pane selector encodes a `(leg, session)` pair as — `two-lambda-panes.test.ts`'s. */
const optionValue = (leg: string, id: string) => `${leg}\x00${id}`
const editorsIn = (leaf: string) => document.querySelectorAll(`[data-leaf="${leaf}"] .cm-editor`).length
const stepOf = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .step`)?.textContent ?? ''
/**
 * What a TM pane is actually showing, as three readings a blank pane cannot fake.
 *
 * ALL THREE ARE PAINTED FROM `TmPane`'s `#program`, AND THEY FAIL IN DIFFERENT DIRECTIONS. `render`
 * returns early — clearing the status line and the tape rows — when either the frame or the program is
 * `null`, so `tapes` and `status` say the pane has BOTH; `rows` is drawn from the `StateIndex` the
 * program builds and is painted whether or not a frame ever lands, so it says the machine reached the
 * pane even when the legs are empty. Counting `.cell` rather than `.tape` is deliberate: an empty tape
 * row is markup, a cell is a symbol read off a frame.
 */
const showing = (leaf: string) => ({
  tapes: [...document.querySelectorAll(`[data-leaf="${leaf}"] .tape .cell`)].map((e) => e.textContent).join(''),
  rows: document.querySelectorAll(`[data-leaf="${leaf}"] .state-row`).length,
  status: document.querySelector(`[data-leaf="${leaf}"] .tm-status`)?.textContent ?? '',
})

/**
 * Split `leaf` through its `control` menu, choosing the entry labelled `item`.
 *
 * **THE MENU IS REACHED THROUGH `aria-controls`, NOT THROUGH `[data-leaf] .pane-picker`, AND THAT IS A
 * CORRECTNESS POINT RATHER THAN A STYLE ONE.** A pane has TWO pickers — one per split control — and each
 * keeps the items it was last opened with, so a query scoped only to the pane would collect the other
 * menu's items too and could click an entry in a popover that is not even open. The invoker's own
 * `aria-controls` names exactly one menu, which is the relationship `splitControl` builds it for.
 *
 * IT THROWS WHEN THE ENTRY IS ABSENT, NAMING WHAT WAS ON OFFER. `find(...)?.click()` on a missing item is
 * a silent no-op, and every assertion after it would then describe a page nothing happened on — the same
 * hazard `pane-kind-switch.test.ts`'s `pick` records for `select.value = x`.
 */
const pickSplit = (leaf: string, control: string, item: string): void => {
  const button = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button[aria-label="${control}"]`)
  if (button === null) throw new Error(`no "${control}" control on [data-leaf="${leaf}"]`)
  button.click()
  const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
  if (menu === null) throw new Error(`the "${control}" control on ${leaf} names no menu`)
  const items = [...menu.querySelectorAll<HTMLButtonElement>('button')]
  const chosen = items.find((b) => b.textContent === item)
  if (chosen === undefined) {
    throw new Error(
      `the "${control}" menu on ${leaf} offers no "${item}" — it offers: ${items.map((b) => b.textContent).join(' | ')}`,
    )
  }
  chosen.click()
}

/** `pane-kind-switch.test.ts`'s `until`, message and all. */
async function until(predicate: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

let view: EditorView

beforeAll(async () => {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
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

describe('a split creates what the picker was asked for', () => {
  /**
   * THE PICKER'S HEADLINE: a λ pane can create a TM pane beside itself. Until this task the new leaf took
   * the kind of the leaf it was split from, so the λ count below is what makes this test fail against
   * that — asserting only `data-kind` of the new leaf would leave a "duplicate the kind" implementation
   * failing on the id it produced rather than on what it produced.
   *
   * IT ASSERTS THE PANE, NOT ONLY THE ATTRIBUTE. `.state-table` is `TmPane`'s own DOM, and the step
   * readout is painted by `draw()` from the leg the slot resolves — so a new pane showing the SAME step
   * as the TM pane the default layout ships is evidence the whole pass ran over a binding `legOf`
   * accepted, not merely that `applyLayout` wrote three letters into `dataset.kind`.
   */
  it('creates a TM pane from a λ pane, bound to the pair that was picked', async () => {
    const errors: string[] = []
    const onError = (e: ErrorEvent) => errors.push(e.message)
    window.addEventListener('error', onError)
    try {
      const before = leafIds()
      pickSplit('lambda-0', 'split left and right', 'TM · source')
      await until(() => leafIds().length === before.length + 1, 'the split to add a leaf')

      const created = leafIds().find((id) => !before.includes(id)) ?? ''
      expect(created).not.toBe('')
      expect(kindOf(created)).toBe('tm')
      expect(document.querySelector(`[data-leaf="${created}"] .state-table`)).not.toBeNull()
      // THE λ PANE WAS NOT DUPLICATED, which is what the split did before the picker existed.
      expect(lambdaLeaves()).toEqual(['lambda-0'])
      expect(selectOf(created)?.value).toBe(optionValue('tm', 'source'))
      expect(stepOf(created)).toBe(stepOf('tm-0'))
      expect(stepOf(created)).not.toBe('')
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  /**
   * **THE PANE THE PICKER CREATES SHOWS THE MACHINE THAT WAS ALREADY COMPILED — the defect that made the
   * headline above a headline about a blank rectangle.** `TmPane.setProgram` is called from the reply
   * switch and from nowhere else, so every TM pane created AFTER its session's last `compiled` reply used
   * to render no tapes, no status line and no δ-rows until something recompiled. Pre-existing, and this
   * slice is what turns it from a corner case into the primary path: a picker whose whole point is
   * creating a TM pane from a λ pane.
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
      pickSplit('lambda-0', 'split left and right', 'TM · source')
      await until(() => leafIds().length === before.length + 1, 'the split to add a leaf')

      const created = leafIds().find((id) => !before.includes(id)) ?? ''
      expect(created).not.toBe('')
      expect(kindOf(created)).toBe('tm')

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
      60_000,
    )

    const before = leafIds()
    pickSplit('lambda-0', 'split left and right', 'TM · source')
    await until(() => leafIds().length === before.length + 1, 'the split to add a leaf')
    const created = leafIds().find((id) => !before.includes(id)) ?? ''
    expect(created).not.toBe('')
    expect(kindOf(created)).toBe('tm')
    expect(showing(created)).toEqual({ tapes: '', rows: 0, status: '' })

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let y = 7; y + 1' } })
    await until(
      () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && showing(created).rows > 0,
      'the repaired program to reach the created pane',
      60_000,
    )
    expect(showing(created).tapes).toBe(showing('tm-0').tapes)
    expect(showing(created).tapes).not.toBe('')
  })

  /**
   * **THE SESSION HALF OF THE PICK, WHICH `creates a TM pane from a λ pane` CANNOT SEE.** Both panes there
   * are on the source
   * session, so an implementation that ignored `choice.session` and kept binding the new leaf to the
   * session it was split FROM — which is exactly what `splitRow` did before this task — would pass it.
   * Forking first puts the splitting pane on the λ scratchpad, so `λ · source` names a session the pane
   * performing the split is not on, and the new pane's own selector is what says which one it landed on.
   *
   * AND THE SPLITTING PANE IS ASSERTED UNMOVED: a split names the session of the leaf it CREATES, so an
   * implementation that routed the pick through a rebind would satisfy the first assertion and swap the
   * two panes' bindings behind it.
   */
  it('starts the new pane on the session that was picked, not on the one that was split', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')?.click()
    await until(() => editorsIn('lambda-0') > 0, 'the fork to mount an editor')

    const before = leafIds()
    pickSplit('lambda-0', 'split left and right', 'λ · source')
    await until(() => leafIds().length === before.length + 1, 'the split to add a leaf')

    const created = leafIds().find((id) => !before.includes(id)) ?? ''
    expect(created).not.toBe('')
    expect(kindOf(created)).toBe('lambda')
    expect(selectOf(created)?.value).toBe(optionValue('lambda', 'source'))
    expect(document.querySelector(`[data-leaf="${created}"] h2`)?.textContent).not.toContain('[detached]')
    // The pane the split was performed ON is still on the scratch — this created a pane, it did not
    // rebind one.
    expect(selectOf('lambda-0')?.value).toBe(optionValue('lambda', 'lambda-scratch'))
    expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('[detached]')
  })
})

describe('the closed source pane comes back through the picker', () => {
  /**
   * **THIS IS THE CAPABILITY `reset layout` DOES NOT PROVIDE, AND THE ASSERTIONS ARE CHOSEN TO TELL THE
   * TWO APART.** Restoring the default layout also brings the source pane back — so a test that only
   * asked whether a source leaf exists afterwards would pass against a picker that quietly called
   * `defaultLayout()`. The layout is therefore made one the default cannot produce (a fourth leaf, from a
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
      // A LAYOUT THE DEFAULT CANNOT PRODUCE — four leaves, the fourth split off the TM pane.
      const before = leafIds()
      pickSplit('tm-0', 'split top and bottom', 'TM · source (same)')
      await until(() => leafIds().length === before.length + 1, 'the TM pane to split')
      const extra = leafIds().find((id) => !before.includes(id)) ?? ''
      expect(extra).not.toBe('')

      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let z = 9; z' } })
      await until(
        () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle',
        'the edited program to compile',
        60_000,
      )
      const extraPlace = places().find((p) => p.startsWith(`${extra}@`)) ?? ''
      expect(extraPlace).not.toBe('')

      document.querySelector<HTMLButtonElement>('[data-leaf="source"] button[aria-label="close this pane"]')?.click()
      await until(() => !leafIds().includes('source'), 'the source pane to close')
      // The editor left the document with its host, rather than being destroyed — `hostFor`'s rule.
      expect(document.querySelector('#editor')).toBeNull()

      pickSplit('lambda-0', 'split top and bottom', 'source')
      await until(() => leafIds().includes('source'), 'the source pane to come back')

      expect(kindOf('source')).toBe('source')
      expect(document.querySelector('[data-leaf="source"] #editor')).not.toBeNull()
      expect(document.querySelector('[data-leaf="source"] .cm-content')?.textContent).toContain('let z = 9')
      // WHERE IT CAME BACK, AND THAT NOTHING ELSE MOVED: `reset layout` would answer
      // `['source', 'lambda-0', 'tm-0']` here, which is what this line is chosen to fail against.
      expect(leafIds()).toEqual(['lambda-0', 'source', 'tm-0', extra])
      expect(places().find((p) => p.startsWith(`${extra}@`))).toBe(extraPlace)
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  /**
   * **THE SOURCE ARM OF THE SAME RESCUE `layout-app.test.ts` PINS FOR THE MINTING ARM.** `split` ends in
   * `focusPane` now, and this branch of it names `SOURCE_LEAF` rather than a fresh id for the reason the
   * handler reuses that literal at all: the source pane's host is the one `main.ts` seeded, holding the
   * live editor. So the leaf focus should land in is the one the picker just put back, and it is the same
   * leaf the choice named.
   *
   * IT PARKS FOCUS ON THE CONTROL FIRST — `document.activeElement` is `<body>` on a page nobody has
   * clicked, so an assertion that focus is inside the source pane afterwards would pass against a no-op
   * if focus had never been anywhere else.
   */
  it('puts focus in the source pane the picker just brought back', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="source"] button[aria-label="close this pane"]')?.click()
    await until(() => !leafIds().includes('source'), 'the source pane to close')

    const control = document.querySelector<HTMLButtonElement>(
      '[data-leaf="lambda-0"] button[aria-label="split top and bottom"]',
    )
    if (control === null) throw new Error('the λ pane has no split control')
    control.focus()
    expect(document.activeElement).toBe(control)

    pickSplit('lambda-0', 'split top and bottom', 'source')
    await until(() => leafIds().includes('source'), 'the source pane to come back')

    expect(document.activeElement).not.toBe(document.body)
    const landed = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-leaf]')
    expect(landed?.dataset.leaf).toBe('source')
  })

  /**
   * THE OFFER IS CONDITIONAL, AND BOTH DIRECTIONS ARE ASSERTED ON ONE PAGE. `source` is in the menu
   * exactly when no source leaf is in the tree — `splitLeaf` throws on a second one, so an unconditional
   * entry would be a control that provably cannot work, offered anyway. The menu is built on OPEN
   * (`splitControl`'s own doc), so the second open below has to reflect a tree that changed with nothing
   * calling `update` in between.
   *
   * EXACT EQUALITY AGAINST `'source'`, NOT `includes('source')` — the source SESSION is labelled `source`
   * too, so every pair it contributes reads `λ · source` / `TM · source` and a substring test could never
   * fail. `pane-layout-controls.test.ts` records the same hazard at the control's own tier.
   */
  it('offers source only while no source leaf is in the tree', async () => {
    const labels = (leaf: string, control: string): string[] => {
      const button = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button[aria-label="${control}"]`)
      button?.click()
      const menu = document.getElementById(button?.getAttribute('aria-controls') ?? '')
      const items = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b) => b.textContent ?? '')
      ;(menu as HTMLElement | null)?.hidePopover()
      return items
    }

    expect(labels('lambda-0', 'split left and right')).not.toContain('source')

    document.querySelector<HTMLButtonElement>('[data-leaf="source"] button[aria-label="close this pane"]')?.click()
    await until(() => !leafIds().includes('source'), 'the source pane to close')

    expect(labels('lambda-0', 'split left and right')).toContain('source')
  })
})
