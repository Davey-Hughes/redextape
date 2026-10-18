import type { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import {
  drag,
  drawn,
  frame,
  heightOf,
  host,
  lambdaHost,
  region,
  resetToFirstLoad,
  SHELL,
  sourcePane,
  sourceScroller,
  stateIdle,
  storedLayout,
  tmViewHost,
  toggle,
  until,
} from './harness'

/**
 * THE SHARES A DRAG LEAVES, IN THE WORKSPACE — the view layouts spec §11.4 — and the source view's two regions,
 * which only the app builds (§11.1). Through the real app, on the views a first load shows: the source beside the TM
 * view, each as tall as the window allows, so the TM view's rules and state diagram have room over their floors.
 *
 * `panel-boundaries.test.ts` has the gesture and `workspace.test.ts` what is read and written; this file has what
 * joins them: the write a gesture makes, and what a switch, a `✕`, a reload's worth of storage and a link do to it.
 * `panel-sizes-restore.test.ts` is the load.
 */

// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
localStorage.removeItem(LAYOUT_STORAGE_KEY)

/** A program with a function to list for each of sixty lines, so the outline has more to list than a view shows. */
const MANY = `${Array.from({ length: 60 }, (_, i) => `fn f${i}(n) { n }`).join('\n')}\nf0(1)\n`
/** A program whose machine has more rows at the state diagram's program level than its panel shows. */
const SUM =
  'fn sum_to(n) {\n    let mut acc = 0;\n    while n > 0 {\n        acc = acc + n;\n        n = n - 1;\n    }\n    acc\n}\nsum_to(5)\n'
/** And one with a single function and sixty blank lines, so the editor scrolls and the outline is two rows. */
const LONG = `fn only(n) { n }${'\n'.repeat(60)}only(1)\n`

let view: EditorView

type Stored = {
  panels?: Record<string, Record<string, boolean>>
  panelSizes?: Record<string, Record<string, number>>
  arrangements?: Record<string, unknown>
}
const program = async (text: string): Promise<void> => {
  if (view.state.doc.toString() === text) return
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  await until(stateIdle, 'the compile')
}

const diagramBar = (): HTMLElement =>
  tmViewHost().querySelector('[data-panel="diagram"] > .panel-header') as HTMLElement

beforeAll(async () => {
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
  await until(() => tmViewHost()?.querySelector('.state-table .state-row') != null, 'the rule table to draw')
  // THE PAGE'S FONTS FIRST: a line's height is the font's, and a floor of five lines, a header and the view's own
  // height each settle as the fonts arrive (`panel-sizes-restore-lambda.test.ts` has the figures).
  await document.fonts.ready
})

describe('a view’s shares, in the stored workspace', () => {
  // *RESET PRESET* KEEPS A TM VIEW THAT SHOWS THE PROGRAM, WITH THE SHARES IT HOLDS, as it keeps the panels it has
  // open (`pane-host.ts`'s pass 1). So what a case before dragged is put back here, by `Enter` on the boundary.
  beforeEach(async () => {
    await page.viewport(1280, 896)
    await resetToFirstLoad()
    await until(() => tmViewHost()?.querySelector('.state-table .state-row') != null, 'the rule table to draw')
    if (storedLayout<Stored>().panelSizes !== undefined) {
      ;(tmViewHost().querySelector('.panel-boundary') as HTMLElement).focus()
      await userEvent.keyboard('{Enter}')
      await frame()
    }
    expect(storedLayout<Stored>().panelSizes, 'precondition: the TM view holds no share').toBeUndefined()
    const [rules, diagram] = [heightOf(region(tmViewHost(), 'rules')), heightOf(region(tmViewHost(), 'diagram'))]
    expect(rules / diagram, 'precondition: the rules have two shares to the diagram’s one').toBeCloseTo(2, 1)
    expect(rules, 'precondition: the rules have 60 px to give over their floor of 148').toBeGreaterThan(300)
  })

  it('are written once at the end of a drag, for the view that was dragged in', async () => {
    // `localStorage` HERE IS `setup.ts`'s OWN OBJECT FOR THIS FILE, so the spy is on it and not on `Storage`'s prototype.
    const writes = vi.spyOn(localStorage, 'setItem')
    try {
      const before = heightOf(region(tmViewHost(), 'diagram'))
      await drag(tmViewHost(), diagramBar(), -60)
      expect(heightOf(region(tmViewHost(), 'diagram')), 'precondition: the drag moved the boundary').toBeCloseTo(
        before + 60,
        0,
      )
      expect(
        writes.mock.calls.filter(([key]) => key === LAYOUT_STORAGE_KEY),
        'a drag did not write the workspace exactly once',
      ).toHaveLength(1)
    } finally {
      writes.mockRestore()
    }
    const sizes = storedLayout<Stored>().panelSizes
    expect(Object.keys(sizes ?? {}), 'a share was written for another view').toEqual(['tm-0'])
    const own = sizes?.['tm-0'] ?? {}
    expect(Object.keys(own).sort()).toEqual(['diagram', 'rules'])
    expect((own.rules as number) + (own.diagram as number), 'the two shares add up to what they did').toBeCloseTo(3, 2)
    expect((own.rules as number) / (own.diagram as number)).toBeCloseTo(
      heightOf(region(tmViewHost(), 'rules')) / heightOf(region(tmViewHost(), 'diagram')),
      2,
    )
  })

  it('are kept for a view its toggle takes off the page, which comes back with them', async () => {
    await drag(tmViewHost(), diagramBar(), -60)
    const [rules, diagram] = [heightOf(region(tmViewHost(), 'rules')), heightOf(region(tmViewHost(), 'diagram'))]
    const sizes = storedLayout<Stored>().panelSizes
    await userEvent.click(toggle('tm'))
    expect(drawn(), 'precondition: the TM view is off the page').toBe('source')
    expect(storedLayout<Stored>().panelSizes, 'a view off the page lost its shares').toEqual(sizes)
    await userEvent.click(toggle('tm'))
    await frame()
    expect(drawn()).toBe('row[50](source tm-0)')
    expect(heightOf(region(tmViewHost(), 'rules'))).toBeCloseTo(rules, 0)
    expect(heightOf(region(tmViewHost(), 'diagram'))).toBeCloseTo(diagram, 0)
    expect(storedLayout<Stored>().panelSizes).toEqual(sizes)
  })

  it('are dropped with a view closed by its ✕, and the view built next under its id has none', async () => {
    await drag(tmViewHost(), diagramBar(), -60)
    expect(storedLayout<Stored>().panelSizes?.['tm-0'], 'precondition: the drag stored shares').toBeDefined()
    await userEvent.click(tmViewHost().querySelector('button.view-close') as HTMLElement)
    expect(drawn()).toBe('source')
    expect(storedLayout<Stored>().panelSizes, 'a closed view’s shares are still stored').toBeUndefined()
    await userEvent.click(toggle('tm'))
    await until(() => tmViewHost()?.querySelector('.state-table .state-row') != null, 'the new TM view to draw')
    await frame()
    expect(storedLayout<Stored>().panelSizes, 'the new view was given the closed one’s shares').toBeUndefined()
    expect(heightOf(region(tmViewHost(), 'rules')) / heightOf(region(tmViewHost(), 'diagram'))).toBeCloseTo(2, 1)
  })

  it('are put back to none by Enter on the boundary, which leaves no entry for the view', async () => {
    await drag(tmViewHost(), diagramBar(), -60)
    const boundary = tmViewHost().querySelector('.panel-boundary') as HTMLElement
    boundary.focus()
    await userEvent.keyboard('{Enter}')
    await frame()
    expect(storedLayout<Stored>().panelSizes, 'a view that holds no share still has an entry').toBeUndefined()
    expect(heightOf(region(tmViewHost(), 'rules')) / heightOf(region(tmViewHost(), 'diagram'))).toBeCloseTo(2, 1)
  })

  /**
   * *RESET PRESET* REPLACES THE WORKSPACE WHOLE and does not go through `enterTree`, which is what drops a view's
   * state at a `✕`: what it closes is dropped by `main.ts`'s `normaliseWorkspace`, at the write. Held on a λ view,
   * which the default does without, with its map opened and its boundary dragged.
   */
  it('are dropped with a view reset preset closes, and the view its toggle builds next has none', async () => {
    const openMap = async (): Promise<void> => {
      await userEvent.click(lambdaHost().querySelector('[data-panel="map"] .panel-toggle') as HTMLElement)
      await frame()
    }
    await userEvent.click(toggle('lambda'))
    await until(() => host('lambda-0')?.querySelector('.term-rows > *') != null, 'the λ view to draw')
    await openMap()
    const term = lambdaHost().querySelector('.term') as HTMLElement
    expect(heightOf(term), 'precondition: the term has 60 px to give over its floor').toBeGreaterThan(
      Number.parseFloat(getComputedStyle(term).minHeight) + 80,
    )
    await drag(lambdaHost(), lambdaHost().querySelector('[data-panel="map"] > .panel-header') as HTMLElement, -60)
    expect(
      Object.keys(storedLayout<Stored>().panelSizes?.['lambda-0'] ?? {}).sort(),
      'precondition: the drag stored shares',
    ).toEqual(['map', 'term'])
    await resetToFirstLoad()
    expect(host('lambda-0'), 'precondition: the reset closed the λ view').toBeNull()
    expect(storedLayout<Stored>().panelSizes, 'the shares of a view the reset closed are still stored').toBeUndefined()
    await userEvent.click(toggle('lambda'))
    await until(() => host('lambda-0')?.querySelector('.term-rows > *') != null, 'the new λ view to draw')
    await openMap()
    expect(region(lambdaHost(), 'map').dataset.sized, 'the new view was given the closed one’s shares').toBeUndefined()
    expect((lambdaHost().querySelector('.term-map') as HTMLElement).clientHeight).toBe(120)
  })

  /**
   * THE KEYS, IN THE THREE VIEWS THE APP BUILDS HERE (`panel-boundaries.test.ts` has them in an asm view): an arrow
   * moves the focused boundary a fiftieth of what the open regions share, the two it parts and no more, and `Enter`
   * puts both back.
   */
  it('follow a boundary moved with the keys in the TM, the λ and the source view, and Enter puts it back', async () => {
    /** One leg: `key` on the boundary between `above` and `below`, which moves it up for `ArrowUp` and down otherwise. */
    const leg = async (leaf: string, above: string, below: string, key: 'ArrowUp' | 'ArrowDown'): Promise<void> => {
      const view = host(leaf) as HTMLElement
      const boundary = view.querySelector(
        `.panel-boundary[data-above="${above}"][data-below="${below}"]`,
      ) as HTMLElement
      expect(boundary, `precondition: ${leaf} draws a boundary between ${above} and ${below}`).not.toBeNull()
      const was = { above: heightOf(region(view, above)), below: heightOf(region(view, below)) }
      const step = (key === 'ArrowUp' ? -1 : 1) * 0.02 * (was.above + was.below)
      boundary.focus()
      await userEvent.keyboard(`{${key}}`)
      await frame()
      expect(
        heightOf(region(view, above)) - was.above,
        `${leaf}: an arrow did not move the boundary a step`,
      ).toBeCloseTo(step, 0)
      expect(
        heightOf(region(view, below)) - was.below,
        `${leaf}: the region below did not answer the one above`,
      ).toBeCloseTo(-step, 0)
      expect(Object.keys(storedLayout<Stored>().panelSizes?.[leaf] ?? {}).sort(), `${leaf}: the shares stored`).toEqual(
        [above, below].sort(),
      )
      expect(document.activeElement, `${leaf}: the boundary lost the focus`).toBe(boundary)
      await userEvent.keyboard('{Enter}')
      await frame()
      expect(heightOf(region(view, above)), `${leaf}: Enter did not put the upper region back`).toBeCloseTo(
        was.above,
        0,
      )
      expect(
        storedLayout<Stored>().panelSizes?.[leaf],
        `${leaf}: a view that holds no share has an entry`,
      ).toBeUndefined()
    }
    // THE TM VIEW WHILE IT IS AS TALL AS THE WINDOW ALLOWS: beside a λ view over it, its regions are at their floors.
    await leg('tm-0', 'rules', 'diagram', 'ArrowUp')
    await userEvent.click(toggle('lambda'))
    await until(() => host('lambda-0')?.querySelector('.term-rows > *') != null, 'the λ view to draw')
    await userEvent.click(
      (host('lambda-0') as HTMLElement).querySelector('[data-panel="map"] .panel-toggle') as HTMLElement,
    )
    await frame()
    await leg('lambda-0', 'term', 'map', 'ArrowUp')
    // DOWN, IN THE SOURCE VIEW: its outline is as tall as the two rows it lists, a step over its floor of two lines.
    const outlineToggle = sourcePane().querySelector('[data-panel="outline"] .panel-toggle') as HTMLElement
    if (outlineToggle.getAttribute('aria-expanded') !== 'true') await userEvent.click(outlineToggle)
    await frame()
    await leg('source', 'outline', 'editor', 'ArrowDown')
    await userEvent.click(outlineToggle)
  })

  /**
   * **A PANEL A MAXIMISE DRAWS CLOSED WITHDRAWS WHAT IT OFFERED FOR A BODY NOBODY CAN SEE** (`panel.ts`'s `onDrawn`).
   * The state diagram's *follow current state* is offered while its rows do not follow, and only the TM view writes
   * its `hidden`; a grid draws itself again when its box changes size, which is why the rule table needs no telling.
   */
  it('withdraw a hidden panel’s offer to follow again under a maximise, and bring it back with the panel', async () => {
    const again = (): HTMLElement => tmViewHost().querySelector('.diagram-reattach') as HTMLElement
    const rows = (): HTMLElement => tmViewHost().querySelector('.program-scroll') as HTMLElement
    const button = (): HTMLElement => tmViewHost().querySelector('[data-panel="rules"] .panel-maximise') as HTMLElement
    await program(SUM)
    await until(
      () => tmViewHost().querySelectorAll('.program-row').length > 6,
      'the diagram to draw the program’s rows',
    )
    if (!again().hidden) again().click()
    await frame()
    expect(again().hidden, 'precondition: the diagram follows the run').toBe(true)
    expect(rows().scrollHeight - rows().clientHeight, 'precondition: the diagram’s rows scroll').toBeGreaterThan(60)
    rows().scrollTop = 60
    rows().dispatchEvent(new Event('scroll'))
    await until(() => !again().hidden, 'the diagram to stop following')
    await userEvent.click(button())
    await frame()
    expect(
      tmViewHost().querySelector('[data-panel="diagram"] .panel-toggle')?.getAttribute('aria-expanded'),
      'precondition: the maximise drew the diagram closed',
    ).toBe('false')
    expect(again().hidden, 'a diagram drawn closed still offers to follow').toBe(true)
    await userEvent.click(button())
    await frame()
    expect(again().hidden, 'the offer did not come back with the diagram').toBe(false)
    again().click()
  })

  it('are not written by a maximise, which a load does not bring back', async () => {
    // `localStorage` HERE IS `setup.ts`'s OWN OBJECT FOR THIS FILE, so the spy is on it and not on `Storage`'s prototype.
    const writes = vi.spyOn(localStorage, 'setItem')
    try {
      await userEvent.click(tmViewHost().querySelector('[data-panel="diagram"] .panel-maximise') as HTMLElement)
      await frame()
      expect(
        tmViewHost().querySelector('[data-panel="rules"] .panel-toggle')?.getAttribute('aria-expanded'),
        'precondition: the maximise drew the rules closed',
      ).toBe('false')
      expect(writes.mock.calls.filter(([key]) => key === LAYOUT_STORAGE_KEY)).toHaveLength(0)
    } finally {
      writes.mockRestore()
    }
    await userEvent.click(tmViewHost().querySelector('[data-panel="diagram"] .panel-maximise') as HTMLElement)
  })
})

describe('the source view’s two regions', () => {
  const editorHost = (): HTMLElement => sourcePane().querySelector('#editor') as HTMLElement
  const outline = (): HTMLElement => sourcePane().querySelector('[data-panel="outline"]') as HTMLElement
  const outlineToggle = (): HTMLElement => outline().querySelector('.panel-toggle') as HTMLElement
  const rows = (): number => outline().querySelectorAll('.outline-row').length
  const title = (): HTMLElement => sourcePane().querySelector('h2') as HTMLElement
  const setOutline = async (open: boolean): Promise<void> => {
    if ((outlineToggle().getAttribute('aria-expanded') === 'true') !== open) await userEvent.click(outlineToggle())
    await frame()
  }

  beforeEach(async () => {
    await page.viewport(1280, 896)
    await resetToFirstLoad()
    await setOutline(false)
    // WHATEVER A CASE BEFORE DRAGGED: `Enter` on the boundary, where one is drawn, puts both regions back.
    await setOutline(true)
    const boundary = sourcePane().querySelector<HTMLElement>('.panel-boundary')
    if (outline().dataset.sized !== undefined && boundary !== null) {
      boundary.focus()
      await userEvent.keyboard('{Enter}')
    }
    await setOutline(false)
  })

  it('scrolls a long program inside the editor’s own box, under a header that stays put', async () => {
    await program(LONG)
    expect(sourcePane().scrollHeight, 'the view’s own box scrolls').toBe(sourcePane().clientHeight)
    expect(
      sourceScroller().scrollHeight - sourceScroller().clientHeight,
      'precondition: the editor’s box scrolls',
    ).toBeGreaterThan(300)
    // THE EDITOR'S REGION RUNS FROM THE HEADER TO THE VIEW'S BOTTOM, and the editor fills it.
    expect(editorHost().getBoundingClientRect().bottom).toBeCloseTo(sourcePane().getBoundingClientRect().bottom, 0)
    expect(heightOf(sourceScroller())).toBeCloseTo(heightOf(editorHost()), 0)
    const top = title().getBoundingClientRect().top
    sourceScroller().scrollTop = 300
    await until(() => sourceScroller().scrollTop === 300, 'the editor to scroll')
    expect(title().getBoundingClientRect().top, 'the view’s header scrolled with its program').toBe(top)
    expect(sourcePane().scrollTop).toBe(0)
  })

  it('gives the outline its own height, up to four tenths of the view, until the boundary is dragged', async () => {
    await program(LONG)
    await setOutline(true)
    await until(() => rows() > 0, 'the outline to list the program')
    const few = heightOf(outline())
    expect(outline().dataset.sized, 'an outline nobody dragged has a share').toBeUndefined()
    expect(few, 'a short outline is as tall as what it lists').toBeLessThan(120)
    expect(sourcePane().querySelector('.panel-boundary')?.getAttribute('aria-label')).toBe('resize outline and editor')

    await program(MANY)
    await until(() => rows() >= 60, 'the outline to list sixty functions')
    await frame()
    const cap = 0.4 * sourcePane().clientHeight
    expect(heightOf(outline()), 'a long outline is not capped at four tenths of the view').toBeCloseTo(cap, 0)
    const list = outline().querySelector('.outline') as HTMLElement
    expect(list.scrollHeight, 'the outline’s list does not scroll inside the cap').toBeGreaterThan(list.clientHeight)
    expect(sourcePane().scrollHeight, 'the view scrolls').toBe(sourcePane().clientHeight)
  })

  it('gives the outline a share at a drag of the boundary, which is the one handle over a region with no header', async () => {
    await program(LONG)
    await setOutline(true)
    await until(() => rows() > 0, 'the outline to list the program')
    const [was, editorWas] = [heightOf(outline()), heightOf(editorHost())]
    const boundary = sourcePane().querySelector('.panel-boundary') as HTMLElement
    expect(getComputedStyle(boundary).cursor).toBe('grab')
    await drag(sourcePane(), boundary, 100)
    expect(heightOf(outline()), 'the outline did not take 100 px').toBeCloseTo(was + 100, 0)
    expect(heightOf(editorHost()), 'the editor did not give them').toBeCloseTo(editorWas - 100, 0)
    expect(outline().dataset.sized).toBe('true')
    expect(Object.keys(storedLayout<Stored>().panelSizes?.source ?? {}).sort()).toEqual(['editor', 'outline'])
    expect(sourcePane().scrollHeight).toBe(sourcePane().clientHeight)
  })

  it('leaves the editor its floor under a maximised outline, and puts both back after', async () => {
    await program(LONG)
    await setOutline(true)
    await until(() => rows() > 0, 'the outline to list the program')
    const [was, editorWas] = [heightOf(outline()), heightOf(editorHost())]
    const floor = Number.parseFloat(getComputedStyle(editorHost()).minHeight)
    expect(floor, 'precondition: the editor has a floor').toBeGreaterThan(60)
    const button = outline().querySelector('.panel-maximise') as HTMLElement
    await userEvent.click(button)
    await frame()
    expect(editorHost().hidden).toBe(false)
    expect(heightOf(editorHost()), 'the editor is not at its floor').toBeCloseTo(floor, 0)
    expect(heightOf(outline()), 'the outline did not take the rest').toBeGreaterThan(was + 300)
    expect(sourcePane().querySelector('.panel-boundary'), 'a boundary is drawn under a maximised panel').toBeNull()
    await userEvent.click(button)
    await frame()
    expect(heightOf(outline())).toBeCloseTo(was, 0)
    expect(heightOf(editorHost())).toBeCloseTo(editorWas, 0)
  })

  /**
   * **AN OUTLINE DRAWN OPEN BY A MAXIMISE LISTS ITS DOCUMENT.** An outline asks for its symbols when it is opened by
   * its disclosure and at each edit while it is open, and a maximise opens it by neither: the outline, closed since
   * the program before this one, filled the view with that program's list, or with nothing.
   */
  it('lists the program in an outline that is maximised while it is closed', async () => {
    await program(LONG)
    await setOutline(true)
    await until(() => rows() > 0 && rows() < 10, 'the outline to list the short program')
    await setOutline(false)
    await program(MANY)
    const button = outline().querySelector('.panel-maximise') as HTMLElement
    await userEvent.click(button)
    await frame()
    expect(outlineToggle().getAttribute('aria-expanded'), 'precondition: the maximise drew the outline open').toBe(
      'true',
    )
    await until(() => rows() >= 60, 'the maximised outline to list the sixty functions of its program')
    await userEvent.click(button)
    expect(outlineToggle().getAttribute('aria-expanded'), 'the outline is not drawn as it is stored again').toBe(
      'false',
    )
  })

  /**
   * **A BOUNDARY SAYS THE UPPER REGION'S PART OF THE TWO AS THEY ARE DRAWN.** It said the regions' shares, and 50 for
   * a region with none of its own: an outline of two rows over an editor of forty read as half the view until an
   * arrow moved it, and as half again once `Enter` put it back.
   */
  it('says how much of the two its upper region is drawn at, at rest, as it moves and once it is put back', async () => {
    await program(LONG)
    await setOutline(true)
    await until(() => rows() > 0, 'the outline to list the program')
    const boundary = sourcePane().querySelector('.panel-boundary') as HTMLElement
    const said = (): number => Number(boundary.getAttribute('aria-valuenow'))
    const part = (): number => Math.round((heightOf(outline()) / (heightOf(outline()) + heightOf(editorHost()))) * 100)
    expect(part(), 'precondition: the outline is a small part of the two').toBeLessThan(30)
    boundary.focus()
    expect(said(), 'at rest').toBe(part())
    await userEvent.keyboard('{ArrowDown}')
    await frame()
    expect(said(), 'after an arrow').toBe(part())
    await userEvent.keyboard('{Enter}')
    await frame()
    expect(said(), 'once put back').toBe(part())
  })

  /**
   * **THE SOURCE VIEW CLOSED AND SHOWN AGAIN IS AS THE WORKSPACE HAS IT.** Its `✕` drops what the workspace stores for
   * it, as any view's does, and the page keeps the view's elements for the view its toggle shows next: they kept the
   * outline open and the boundary where it was dragged, for a workspace that stored neither, and the next drag wrote
   * the dropped shares back.
   */
  it('comes back from its ✕ with its outline closed and its regions as they are built, as stored', async () => {
    await program(LONG)
    await setOutline(true)
    await until(() => rows() > 0, 'the outline to list the program')
    await drag(sourcePane(), sourcePane().querySelector('.panel-boundary') as HTMLElement, 100)
    expect(storedLayout<Stored>().panelSizes?.source, 'precondition: the drag stored shares').toBeDefined()
    expect(storedLayout<Stored>().panels?.source?.outline, 'precondition: and the outline is stored open').toBe(true)
    await userEvent.click(sourcePane().querySelector('button.view-close') as HTMLElement)
    expect(drawn(), 'precondition: the source view is closed').toBe('tm-0')
    expect(
      [storedLayout<Stored>().panelSizes, storedLayout<Stored>().panels?.source],
      'precondition: its ✕ dropped what was stored for it',
    ).toEqual([undefined, undefined])
    await userEvent.click(toggle('source'))
    await frame()
    expect(host('source'), 'precondition: the source view is shown again').not.toBeNull()
    expect(outlineToggle().getAttribute('aria-expanded'), 'the outline is open, and stored as closed').toBe('false')
    expect(outline().dataset.sized, 'the outline has a share, and none is stored').toBeUndefined()
    expect(sourcePane().querySelector('.panel-boundary'), 'a boundary is drawn under a closed outline').toBeNull()
    expect(editorHost().getBoundingClientRect().bottom).toBeCloseTo(sourcePane().getBoundingClientRect().bottom, 0)
  })
})
