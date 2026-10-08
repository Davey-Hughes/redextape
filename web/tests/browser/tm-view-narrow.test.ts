import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { SHELL, until } from './harness'

/**
 * **THE TM VIEW ON A PHONE'S SCREEN** — Explorer at 320px and 390px, on `sum_to(5)`, the example a first visit opens,
 * picked from `examples ▾` (every browser file starts on `let x = 40; x + 2`, `setup.ts`), with the state diagram open
 * at its program level, drawn as arcs, and its runtime column beside the rows. The view scrolled sideways: at 390px its
 * `scrollWidth` was 209 against a `clientWidth` of 189, because the diagram panel's header never wrapped, so its
 * actions (*program | local* and *arcs | chips*) ran to x = 409.92, and at 320px the runtime column (`.program-side`,
 * 11rem) ran to x = 342 as well. Every panel header squeezed what it held instead: the panel's name on two lines, each
 * choice of a radio group on a line of its own, `follow current state` on three. And the column took the rows' room:
 * they were 13px wide at 390px and 0px at 320px. (The 189px and the 154px of a 320px page are the browser tier's:
 * headless, it draws no scrollbar.)
 *
 * What is held is that at a phone's width no box in the TM view lies past its edge, but those inside a box that scrolls
 * by design (`SCROLLS`); that no box clips text it did not clip before; that every panel header in Explorer, the TM
 * view's and every other view's, lies inside its view, its name on one line, each radio group's choices on one row, and
 * each action clickable without a sideways scroll; and that the program level's rows take its whole width, while the
 * runtime column, its connectors drawn whole and meeting their rows, is a sideways scroll of the level away. That last
 * is the user's choice (2026-10-05), over stacking the column under the rows and over letting it shrink, and for a
 * level narrower than 14rem only (the user's second choice, after the review, the same day; the third, on 2026-10-06,
 * kept the rule on the level's width, so a TM view under 224px in a desktop's window has it too). So in the desktop
 * layouts where the level is wider but the rows are squeezed (Debugger at 1024px, a split view at 1280px) the level
 * does not scroll and its rows and column are where `53ecbfa` drew them. A row's count draws its number whole or not at
 * all, and cuts only its unit, with an ellipsis, where a count cut as one text read as another number (`53 states` as
 * `5.`). At a desktop's width every panel header in Explorer is one row, as before, and the TM view's panels are where
 * `53ecbfa` drew them. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 */

let view: EditorView
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const buttonOf = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`) as HTMLButtonElement
const menuOf = (id: string) => document.getElementById(buttonOf(id).getAttribute('aria-controls') ?? '') as HTMLElement
const shown = (el: Element) => el.getClientRects().length > 0
const paneOf = (leaf: string) => document.querySelector<HTMLElement>(`[data-leaf="${leaf}"]`) as HTMLElement
const tm = () => paneOf('tm-0')
const panelOf = (leaf: string, name: string) =>
  paneOf(leaf).querySelector<HTMLElement>(`.panel[data-panel="${name}"]`) as HTMLElement
const diagram = () => panelOf('tm-0', 'diagram')
const level = () => diagram().querySelector<HTMLElement>('.program-level') as HTMLElement
const programScroll = () => diagram().querySelector<HTMLElement>('.program-scroll') as HTMLElement
const side = () => diagram().querySelector<HTMLElement>('.program-side') as HTMLElement
const table = () => panelOf('tm-0', 'rules').querySelector<HTMLElement>('.state-table') as HTMLElement
const diagramReattach = () => diagram().querySelector<HTMLButtonElement>('.diagram-reattach') as HTMLButtonElement
const tableReattach = () =>
  panelOf('tm-0', 'rules').querySelector<HTMLButtonElement>('.table-reattach') as HTMLButtonElement
const choice = (value: string) =>
  diagram().querySelector<HTMLButtonElement>(`.diagram-mode[data-value="${value}"]`) as HTMLButtonElement
/** The TM view's own step control labelled `label` (`step-controls.ts`), in its strip. */
const control = (label: string) =>
  tm().querySelector<HTMLButtonElement>(`.view-steps .controls button[aria-label="${label}"]`) as HTMLButtonElement
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
/** Every TM view on the page, in its order. */
const tmViews = () => [...document.querySelectorAll<HTMLElement>('.pane[data-kind="tm"]')]

/**
 * **EVERY PANEL EXPLORER DRAWS ON `sum_to(5)`, BY VIEW AND NAME**, in the page's order. `.panel-header` and
 * `.panel-actions` are every panel's (`panel.ts`), so a rule that fits the TM view's headers is held against all of
 * them. The text panel of a copy and the outline of a TM or asm copy are not drawn here: no view holds a copy.
 */
const PANELS = [
  ['source', 'outline'],
  ['lambda-0', 'map'],
  ['asm-0', 'listing'],
  ['asm-0', 'registers'],
  ['asm-0', 'stack'],
  ['asm-0', 'heap'],
  ['tm-0', 'rules'],
  ['tm-0', 'diagram'],
] as const

/**
 * **THE BOXES THAT SCROLL BY DESIGN**, whose contents may lie past the view's edge: each tape's cells, the rule table,
 * the diagram's grid and its local level; and the diagram's program level, which on a level narrower than 14rem holds
 * its rows at the level's width and the runtime column past them, a sideways scroll away (`style.css`' container query
 * on `.state-diagram`), where it cannot sit beside them without taking their room. What that scroll must reach is held
 * by its own case; that a wider level does not scroll, by the in-between layouts'. An SVG clips
 * its own drawing (an icon, the arcs' gutter, the runtime column's connectors), and the speed select draws its own
 * option; each such box is held itself, and only what is inside it is skipped. Any other box that clips is a box that
 * hides what runs past it, and is a failure.
 */
const SCROLLS = '.cells, .state-table, .program-level, .program-scroll, .local-level, svg, select'

/** The outermost box strictly between `el` and `root` that clips or scrolls: it decides what of `el` shows. */
function clipOf(el: Element, root: Element): Element | null {
  let clip: Element | null = null
  for (let a = el.parentElement; a !== null && a !== root; a = a.parentElement) {
    const style = getComputedStyle(a)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') clip = a
  }
  return clip
}

/** A box by what it is: its tag, its first class, its value or its text's start. */
function nameOf(el: Element): string {
  const cls = el.getAttribute('class')?.trim().split(/\s+/)[0]
  const value = el instanceof HTMLElement && el.dataset.value !== undefined ? `[${el.dataset.value}]` : ''
  const text = (el.textContent ?? '').trim().slice(0, 24)
  return `${el.tagName.toLowerCase()}${cls === undefined ? '' : `.${cls}`}${value}${text === '' ? '' : ` “${text}”`}`
}

/** The pane's padding box across: where its content may lie without the pane scrolling sideways. */
const innerOf = (pane: HTMLElement): { readonly left: number; readonly right: number } => {
  const left = pane.getBoundingClientRect().left + pane.clientLeft
  return { left, right: left + pane.clientWidth }
}

/**
 * **EVERY BOX OF A VIEW, AND WHERE EACH STANDS**: `held`, each box drawn outside every box that clips or scrolls,
 * which must lie inside the view, and `strays`, each box inside a clipping box that does not scroll by design
 * (`SCROLLS`). A box inside one that does is neither: what of it shows is that box's to decide.
 */
function boxesOf(pane: HTMLElement): { held: Element[]; strays: Element[] } {
  const held: Element[] = []
  const strays: Element[] = []
  for (const el of pane.querySelectorAll('*')) {
    if (!shown(el)) continue
    const clip = clipOf(el, pane)
    if (clip === null) held.push(el)
    else if (!clip.matches(SCROLLS)) strays.push(el)
  }
  return { held, strays }
}

/** The boxes a panel's header draws: the header, the toggle, the name, the actions, and each box in them. */
function headerBoxes(panel: HTMLElement): HTMLElement[] {
  const header = panel.querySelector<HTMLElement>(':scope > .panel-header') as HTMLElement
  return [
    header,
    ...header.querySelectorAll<HTMLElement>('.panel-toggle, .panel-name, .panel-actions, .panel-actions *'),
  ]
    .filter((el) => el instanceof HTMLElement)
    .filter(shown)
}

/**
 * **NOTHING IN A PANEL'S HEADER HIDES TEXT: NO BOX OVERFLOWS, ACROSS OR DOWN** — `view-strip-narrow.test.ts`'
 * `hidesNothing`, for the same reason: whatever its `overflow`, a box can cut only what runs past it, so an ellipsis
 * and a clipped row each show as a `scrollWidth` or `scrollHeight` over the box's `clientWidth` or `clientHeight`.
 */
function hidesNothing(leaf: string, name: string): void {
  for (const el of headerBoxes(panelOf(leaf, name))) {
    expect.soft(el.scrollWidth, `${leaf} ${name}: ${nameOf(el)}’s scroll width`).toBeLessThanOrEqual(el.clientWidth)
    expect.soft(el.scrollHeight, `${leaf} ${name}: ${nameOf(el)}’s scroll height`).toBeLessThanOrEqual(el.clientHeight)
  }
}

/** How many lines a box's text is set on: one per distinct top among its text's line boxes. */
const linesOf = (el: Element): number => {
  const range = document.createRange()
  range.selectNodeContents(el)
  return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
}
const centreOf = (el: Element): number => {
  const box = el.getBoundingClientRect()
  return (box.top + box.bottom) / 2
}
/** The width a panel's header gives a row of its own: its content box, measured from the header, not the row. */
const roomOf = (panel: HTMLElement): number => {
  const header = panel.querySelector<HTMLElement>(':scope > .panel-header') as HTMLElement
  const style = getComputedStyle(header)
  return header.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
}

/**
 * **EACH CONNECTOR SVG'S DRAWING LIES INSIDE ITS OWN BOX**: each of its paths' boxes, in its own units, against its
 * own width and height, to 0.5px, so a column narrower than the lanes `#drawLinks` lays out fails here. The arcs'
 * gutter is held across only: an arc whose span crosses the window is drawn from rows above or below it and clipped by
 * the gutter's own box, by design (`StateDiagram`'s doc).
 */
function drawingsInside(tag: string): void {
  for (const svg of diagram().querySelectorAll<SVGSVGElement>('svg.program-links, svg.program-gutter')) {
    if (!shown(svg)) continue
    const box = svg.getBoundingClientRect()
    const name = `${tag}: ${svg.getAttribute('class')}`
    for (const path of svg.querySelectorAll<SVGGraphicsElement>('path')) {
      const b = path.getBBox()
      expect.soft(b.x, `${name}: a path’s left`).toBeGreaterThanOrEqual(-0.5)
      expect.soft(b.x + b.width, `${name}: a path’s right, against ${box.width}`).toBeLessThanOrEqual(box.width + 0.5)
      if (svg.classList.contains('program-gutter')) continue
      expect.soft(b.y, `${name}: a path’s top`).toBeGreaterThanOrEqual(-0.5)
      expect
        .soft(b.y + b.height, `${name}: a path’s bottom, against ${box.height}`)
        .toBeLessThanOrEqual(box.height + 0.5)
    }
  }
}

/**
 * Each runtime connector the column draws (`#drawLinks`), by what it joins: `box↔box`, between two routines; or, from a
 * row into a routine or out of one back to a row, the row it meets, named by the drawn row whose vertical centre is at
 * the connector's end, to 0.5px, or `null` where no drawn row's is.
 */
function linksOf(): string[] {
  const svg = diagram().querySelector<SVGSVGElement>('svg.program-links') as SVGSVGElement
  const top = svg.getBoundingClientRect().top
  const rows = [...programScroll().querySelectorAll<HTMLElement>('.program-row')]
  const rowAt = (y: number): string | null => {
    const row = rows.find((r) => Math.abs(centreOf(r) - (top + y)) <= 0.5)
    return row?.querySelector('.program-name')?.textContent ?? null
  }
  return [...svg.querySelectorAll('path')].map((path) => {
    const d = path.getAttribute('d') ?? ''
    const into = /^M0 (-?[\d.]+) /.exec(d)
    const out = / V(-?[\d.]+) H3 /.exec(d)
    if (into !== null) return `${rowAt(Number(into[1]))} → a routine`
    if (out !== null) return `a routine → ${rowAt(Number(out[1]))}`
    return 'box↔box'
  })
}

/** Wait until `read` gives the same value for six frames running, for a scroll that may animate; at most 240 frames. */
async function steady(read: () => number): Promise<number> {
  let last = read()
  for (let same = 0, n = 0; same < 6 && n < 240; n += 1) {
    await frame()
    const now = read()
    same = now === last ? same + 1 : 0
    last = now
  }
  return last
}

/**
 * **PUT EVERY SCROLL BACK, BOTH WAYS**: each view's, the program level's and the page's. A case that scrolled something
 * sideways leaves the next one's precondition failing instead of its property: on `53ecbfa`, where the level does not
 * scroll, the wheel at 320px scrolled the TM view 55px sideways, and the 390px case stopped on its precondition.
 */
function home(): void {
  for (const [leaf] of PANELS) paneOf(leaf).scrollTo(0, 0)
  level().scrollTo(0, 0)
  scrollTo(0, 0)
}

/** Put the workspace on `preset`, by the menu's own buttons. */
const presetOf = (preset: string): void => {
  buttonOf('workspace').click()
  menuOf('workspace').querySelector<HTMLButtonElement>(`[data-preset="${preset}"]`)?.click()
  if (menuOf('workspace').matches(':popover-open')) menuOf('workspace').hidePopover()
}
const explorer = (): void => presetOf('explorer')
/** The workspace menu's *reset preset*: the preset's default views, one TM view among them. */
const resetPreset = (): void => {
  buttonOf('workspace').click()
  buttonOf('reset-preset').click()
  if (menuOf('workspace').matches(':popover-open')) menuOf('workspace').hidePopover()
}
/** Split the TM view right into a second view of the same kind, by its `⋯` menu, with the pointer. */
async function splitTm(): Promise<void> {
  const more = tm().querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
  await userEvent.click(more)
  const menu = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement
  await until(() => menu.matches(':popover-open'), 'the TM view’s menu')
  await userEvent.click(menu.querySelector('button.view-split[data-dir="row"]') as HTMLElement)
  await until(() => menu.querySelector('button[data-same]') !== null, 'the split’s choices')
  await userEvent.click(menu.querySelector('button[data-same]') as HTMLElement)
  await until(() => tmViews().length === 2, 'two TM views')
}
/**
 * The TM leg's step, read off its view's line once it is recording the program on the page: `-1` while the line still
 * says `recompiling` over the last program's count, or `not run`.
 */
const recorded = (): number => {
  const line = stepOf('tm-0')
  if (!line.startsWith('step ') || line.includes('recompiling')) return -1
  return Number((/[\d,]+/.exec(line)?.[0] ?? '').replaceAll(',', ''))
}
/**
 * Pick `id` from `examples ▾` at 1280px in Explorer and wait for its run's result, so nothing on the page moves while
 * it is measured: its text in the editor, the λ and TM lines leaving the last program's, then the TM leg recording,
 * past each of `marks` steps, and the result.
 *
 * **A WAIT FOR EACH STRETCH OF A LONG RUN, EACH WITH ITS OWN NAME AND ITS OWN 10S**, as `view-strip-narrow.test.ts`
 * splits its two. `map and fold`'s TM leg records 69,008 steps, and under a 25% CPU quota one wait from its lines to
 * its result took 9,001, 9,394 and 9,600ms of the 10,000 (2026-10-06). A run that ends before a mark passes that
 * wait by its result.
 */
async function pick(id: string, marks: readonly number[]): Promise<void> {
  await page.viewport(1280, 800)
  explorer()
  const text = EXAMPLES.find((e) => e.id === id)?.text ?? ''
  const before = { lambda: stepOf('lambda-0'), tm: stepOf('tm-0') }
  await userEvent.click(buttonOf('examples'))
  await userEvent.click(menuOf('examples').querySelector(`button[data-example="${id}"]`) as HTMLElement)
  await until(() => view.state.doc.toString() === text, `${id}’s text in the editor`)
  await until(() => stepOf('lambda-0') !== before.lambda && stepOf('tm-0') !== before.tm, `${id}’s lines`)
  await until(() => idle() || recorded() >= 0, `${id}’s TM leg recording`)
  for (const mark of marks) await until(() => idle() || recorded() >= mark, `${id}’s TM leg past step ${mark}`)
  await until(idle, `${id}’s run to its result`)
}

/**
 * Detach or re-attach both of the TM view's grids: a scroll of each detaches its following and draws its panel's
 * *follow current …* action, and that action's own click re-attaches it and takes the action away.
 */
async function following(detached: boolean): Promise<void> {
  if (detached) {
    for (const box of [programScroll(), table()]) box.scrollTop = box.scrollTop === 0 ? box.scrollHeight : 0
    await until(() => shown(diagramReattach()) && shown(tableReattach()), 'both grids to detach')
  } else {
    if (shown(diagramReattach())) diagramReattach().click()
    if (shown(tableReattach())) tableReattach().click()
    await until(() => !shown(diagramReattach()) && !shown(tableReattach()), 'both grids to follow again')
  }
}

const SUM_TO = EXAMPLES.find((e) => e.id === 'sum-to')?.text ?? ''
const stepOf = (leaf: string) => paneOf(leaf).querySelector('.view-steps .step')?.textContent ?? ''

/**
 * Mount, and pick `sum_to(5)` from `examples ▾`; wait for its text in the editor, then for the λ and TM views' lines
 * to leave the ones `let x = 40; x + 2` drew, then for the run's result, so nothing on the page moves while it is
 * measured. **THREE WAITS, NOT ONE**, each with its own name and its own 10s, for the reason
 * `view-strip-narrow.test.ts` gives for its two.
 */
beforeAll(async () => {
  await page.viewport(1280, 800)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(idle, 'the first compile')
  const before = { lambda: stepOf('lambda-0'), tm: stepOf('tm-0') }
  await userEvent.click(buttonOf('examples'))
  await userEvent.click(menuOf('examples').querySelector('button[data-example="sum-to"]') as HTMLElement)
  await until(() => view.state.doc.toString() === SUM_TO, 'sum_to(5)’s text in the editor')
  await until(
    () => stepOf('lambda-0') !== before.lambda && stepOf('tm-0') !== before.tm,
    'sum_to(5)’s lines in the λ and TM views',
  )
  await until(idle, 'sum_to(5)’s run to its result')
  // **EVERY VIEW TO ITS NEWEST STEP, BY ITS `⏭`**: a run opens on step 0 (`History`), and these cases measure the page
  // at the run's end, where they were written to.
  for (const leaf of ['lambda-0', 'asm-0', 'tm-0']) {
    await userEvent.click(paneOf(leaf).querySelector('.view-steps button.to-newest') as HTMLElement)
  }
  await until(() => /^step ([\d,]+) of \1$/.test(stepOf('tm-0')), 'the TM view on its newest step')
})

/** The TM view's width at each page width: half of Explorer's two columns, less the gap between them. */
const VIEW: Readonly<Record<number, number>> = { 320: 154, 390: 189, 1280: 634 }
const viewOf = (width: number): number => VIEW[width] ?? Number.NaN

/**
 * Put the page at `width` by `height` in Explorer, both grids `detached` or following, and **ASSERT THE STATE THE CASE
 * MEANS TO MEASURE** before it measures anything: the page's width and the preset; `sum_to(5)` in the source view and
 * its run ended; every panel Explorer draws, by view and name; the TM view at its width and not scrolled; the state
 * diagram open at its program level in arcs, with its runtime column drawn; and the *follow current …* actions drawn
 * or not, as asked.
 */
async function at(width: number, height: number, detached: boolean): Promise<void> {
  explorer()
  await page.viewport(width, height)
  await following(detached)
  expect(innerWidth, 'precondition: the page’s width').toBe(width)
  expect(buttonOf('workspace').textContent, 'precondition: the preset').toMatch(/^explorer/i)
  expect(SUM_TO, 'precondition: the example’s text').toContain('sum_to(5)')
  expect(view.state.doc.toString(), 'precondition: the example').toBe(SUM_TO)
  const ended = /^step ([\d,]+) of ([\d,]+)$/.exec(stepOf('tm-0'))
  expect(ended, `precondition: the TM view’s line, ${stepOf('tm-0')}`).not.toBeNull()
  expect(ended?.[1], `precondition: the TM run ended, ${stepOf('tm-0')}`).toBe(ended?.[2])
  expect(idle(), 'precondition: the run has its result').toBe(true)
  expect(
    [...document.querySelectorAll<HTMLElement>('.panel')]
      .filter(shown)
      .map((p) => [p.closest<HTMLElement>('[data-leaf]')?.dataset.leaf, p.dataset.panel]),
    'precondition: the panels Explorer draws',
  ).toEqual(PANELS.map(([leaf, name]) => [leaf, name]))
  expect(tm().clientWidth, 'precondition: the TM view’s width').toBe(VIEW[width])
  for (const [leaf] of PANELS) expect(paneOf(leaf).scrollLeft, `precondition: ${leaf} not scrolled sideways`).toBe(0)
  expect(diagram().dataset.open, 'precondition: the state diagram is open').toBe('true')
  expect(choice('program').getAttribute('aria-checked'), 'precondition: its program level').toBe('true')
  expect(choice('arcs').getAttribute('aria-checked'), 'precondition: drawn as arcs').toBe('true')
  expect(level().scrollLeft, 'precondition: the program level not scrolled sideways').toBe(0)
  expect(shown(side()), 'precondition: the runtime column is drawn').toBe(true)
  expect(side().querySelectorAll('.program-box').length, 'precondition: the runtime column’s boxes').toBe(5)
  expect(shown(diagramReattach()), `precondition: follow current state ${detached ? '' : 'not '}drawn`).toBe(detached)
  expect(shown(tableReattach()), `precondition: follow current rule ${detached ? '' : 'not '}drawn`).toBe(detached)
}

const PHONES = [
  [320, 568, false],
  [390, 844, false],
  [320, 568, true],
  [390, 844, true],
] as const

describe('the TM view, on sum_to(5)', () => {
  /**
   * **NO BOX IN THE TM VIEW LIES PAST ITS EDGE, AND NONE CLIPS TEXT.** The view first, since a view wider than its
   * page column is what scrolled; then every box it draws outside a box that scrolls by design (`boxesOf`), against
   * the view's padding box (`left + clientWidth`). A box inside a clipping box that does not scroll by design is a
   * failure by itself (`strays`), and so is a clipping box, other than those, whose content runs past it.
   *
   * **EVERY PANEL HEADER IN EXPLORER LIES INSIDE ITS VIEW AND SQUEEZES NOTHING.** Each box in it inside the view and
   * hiding no text (`hidesNothing`); the panel's name on one line; each radio group's choices on one row; and an action
   * set on more than one line only on a row of its own, as wide as the header's content box (`roomOf`), where at 320px
   * `follow current state` and `follow current rule` are wider than the 138px a row has and wrap. **EVERY CONTROL IN A
   * PANEL HEADER CAN BE CLICKED WITHOUT A SIDEWAYS SCROLL**: `elementFromPoint` at its centre is the control, once its
   * view and then the page are scrolled vertically to it.
   *
   * **THE PROGRAM LEVEL'S ROWS TAKE ITS WHOLE WIDTH**, 154px and 189px, where the runtime column beside them left them
   * 0px and 13px; **EACH CONNECTOR SVG'S DRAWING LIES INSIDE ITS BOX** (`drawingsInside`); and the level, which
   * scrolls sideways, **NEVER SCROLLS DOWN**: its `overflow-x` makes its `overflow-y` `auto` too, and its two children
   * stretch to its height, so only the grid inside it scrolls the rows.
   *
   * **EVERY GEOMETRY ASSERTION IS SOFT, EVERY PRECONDITION HARD**, here and at 1280px, so a red run names each
   * property that fails while a case whose state is not the one it means to measure stops before it measures anything.
   */
  it.each(PHONES)(
    'at %i by %i px, with the grids detached: %s, no box runs past the view',
    async (width, height, detached) => {
      try {
        await at(width, height, detached)
        expect.soft(document.documentElement.scrollWidth, 'the page’s scroll width').toBeLessThanOrEqual(innerWidth)
        expect.soft(tm().scrollWidth, 'the TM view’s scroll width').toBeLessThanOrEqual(tm().clientWidth)
        const inner = innerOf(tm())
        const { held, strays } = boxesOf(tm())
        expect.soft(strays.map(nameOf), 'boxes inside a box that clips and does not scroll by design').toEqual([])
        const rows = programScroll().getBoundingClientRect().width
        expect
          .soft(
            Math.abs(rows - viewOf(width)),
            `the program rows’ width, ${rows}px against the level’s ${viewOf(width)}px`,
          )
          .toBeLessThanOrEqual(0.5)
        expect.soft(level().scrollHeight, 'the program level’s scroll height').toBeLessThanOrEqual(level().clientHeight)
        drawingsInside(`${width}px`)
        for (const el of held) {
          const box = el.getBoundingClientRect()
          expect.soft(box.left, `${nameOf(el)}’s left`).toBeGreaterThanOrEqual(inner.left)
          expect.soft(box.right, `${nameOf(el)}’s right`).toBeLessThanOrEqual(inner.right)
          if (!(el instanceof HTMLElement) || el.matches(SCROLLS)) continue
          const style = getComputedStyle(el)
          if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
          expect.soft(el.scrollWidth, `${nameOf(el)} clips across`).toBeLessThanOrEqual(el.clientWidth)
          expect.soft(el.scrollHeight, `${nameOf(el)} clips down`).toBeLessThanOrEqual(el.clientHeight)
        }
        for (const [leaf, name] of PANELS) {
          const panel = panelOf(leaf, name)
          const viewInner = innerOf(paneOf(leaf))
          hidesNothing(leaf, name)
          for (const el of headerBoxes(panel)) {
            const box = el.getBoundingClientRect()
            expect.soft(box.left, `${leaf} ${name}: ${nameOf(el)}’s left`).toBeGreaterThanOrEqual(viewInner.left)
            expect.soft(box.right, `${leaf} ${name}: ${nameOf(el)}’s right`).toBeLessThanOrEqual(viewInner.right)
          }
          const label = panel.querySelector('.panel-name') as HTMLElement
          expect.soft(linesOf(label), `${leaf} ${name}: the name’s lines`).toBe(1)
          for (const group of panel.querySelectorAll<HTMLElement>('.panel-actions [role="radiogroup"]')) {
            const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')]
            const centres = new Set(radios.map((r) => Math.round(centreOf(r))))
            expect.soft(centres.size, `${leaf} ${name}: ${group.getAttribute('aria-label')}’s rows`).toBe(1)
          }
          for (const action of panel.querySelectorAll<HTMLElement>(
            '.panel-actions button, .panel-actions .panel-note',
          )) {
            if (!shown(action)) continue
            const wide = action.getBoundingClientRect().width
            const said = `${nameOf(action)} on ${linesOf(action)} lines, ${wide}px wide in a ${roomOf(panel)}px row`
            expect.soft(linesOf(action) === 1 || wide >= roomOf(panel) - 0.5, `${leaf} ${name}: ${said}`).toBe(true)
          }
        }
        for (const [leaf, name] of PANELS) {
          const pane = paneOf(leaf)
          for (const control of panelOf(leaf, name).querySelectorAll<HTMLElement>('.panel-header button')) {
            if (!shown(control)) continue
            // VERTICALLY ONLY, the view and then the page: `elementFromPoint` sees only what is in the viewport.
            const below = control.getBoundingClientRect().bottom - (pane.getBoundingClientRect().top + pane.clientTop)
            if (below > pane.clientHeight) pane.scrollTop += below - pane.clientHeight
            const above = control.getBoundingClientRect().top - (pane.getBoundingClientRect().top + pane.clientTop)
            if (above < 0) pane.scrollTop += above
            const box = control.getBoundingClientRect()
            if (box.bottom > innerHeight) scrollTo(0, scrollY + box.bottom - innerHeight)
            if (control.getBoundingClientRect().top < 0) scrollTo(0, scrollY + control.getBoundingClientRect().top)
            expect(pane.scrollLeft, 'precondition: the view is not scrolled sideways').toBe(0)
            expect(scrollX, 'precondition: the page is not scrolled sideways').toBe(0)
            const at = control.getBoundingClientRect()
            const hit = document.elementFromPoint((at.left + at.right) / 2, (at.top + at.bottom) / 2)
            expect
              .soft(hit !== null && control.contains(hit), `${leaf} ${name}: what lies at ${nameOf(control)}’s centre`)
              .toBe(true)
          }
        }
      } finally {
        home()
      }
    },
  )

  /**
   * **AT A DESKTOP'S WIDTH EVERY PANEL HEADER IN EXPLORER IS ONE ROW, AS BEFORE**: 28px tall, `53ecbfa`'s height for
   * each of them at 1280px, with every box in it on the toggle's vertical centre, to 1px, and hiding no text; with both
   * grids detached too, where the *follow current …* actions join their rows.
   */
  it.each([false, true])('at 1280 px, with the grids detached: %s, every panel header is one row', async (detached) => {
    await at(1280, 800, detached)
    for (const [leaf, name] of PANELS) {
      const panel = panelOf(leaf, name)
      const header = panel.querySelector(':scope > .panel-header') as HTMLElement
      const toggle = panel.querySelector('.panel-toggle') as HTMLElement
      expect.soft(header.getBoundingClientRect().height, `${leaf} ${name}: the header’s height`).toBe(28)
      hidesNothing(leaf, name)
      for (const el of headerBoxes(panel)) {
        expect
          .soft(Math.abs(centreOf(el) - centreOf(toggle)), `${leaf} ${name}: ${nameOf(el)} on the toggle’s row`)
          .toBeLessThan(1)
      }
    }
  })

  /**
   * **AT 1280PX THE TM VIEW'S PANELS ARE WHERE `53ecbfa` DREW THEM**: each box of the rule table's panel and the state
   * diagram's — the header, the toggle, the name, the actions, each radio group and choice, the body, the program
   * level, its grid, its runtime column and each of the column's boxes — at its left, top, width and height against the
   * view's top-left corner, to 0.5px, as a throwaway probe measured them on `53ecbfa` (2026-10-05). The view is
   * 634px wide at x = 646. The figures are the web fonts', which the browser tier loads.
   */
  it('at 1280 px, the TM view’s panels are where 53ecbfa drew them', async () => {
    await at(1280, 800, false)
    expect(tm().scrollTop, 'precondition: the TM view is not scrolled').toBe(0)
    const origin = tm().getBoundingClientRect()
    expect(origin.left, 'precondition: the TM view’s left').toBe(646)
    const rules = panelOf('tm-0', 'rules')
    const d = diagram()
    const boxes = [...side().querySelectorAll<HTMLElement>('.program-box')]
    const WHERE: [string, Element | null, [number, number, number, number]][] = [
      ['the rules panel', rules, [0, 226, 634, 148]],
      ['its header', rules.querySelector('.panel-header'), [0, 226, 634, 28]],
      ['its toggle', rules.querySelector('.panel-toggle'), [8, 227, 57.41, 26]],
      ['its name', rules.querySelector('.panel-name'), [24, 231, 41.41, 18]],
      ['the rule table', table(), [0, 254, 634, 120]],
      ['the diagram panel', d, [0, 382, 634, 148]],
      ['its header', d.querySelector('.panel-header'), [0, 382, 634, 28]],
      ['its toggle', d.querySelector('.panel-toggle'), [8, 383, 118.25, 26]],
      ['its name', d.querySelector('.panel-name'), [24, 387, 102.25, 18]],
      ['its actions', d.querySelector('.panel-actions'), [419.88, 384.81, 206.13, 22.38]],
      ['program | local', d.querySelector('[role="radiogroup"][aria-label="level"]'), [419.88, 384.81, 109.56, 22.38]],
      ['program', choice('program'), [419.88, 384.81, 61.78, 22.38]],
      ['local', choice('local'), [481.66, 384.81, 47.78, 22.38]],
      ['arcs | chips', d.querySelector('[role="radiogroup"][aria-label="edges"]'), [537.44, 384.81, 88.56, 22.38]],
      ['arcs', choice('arcs'), [537.44, 384.81, 40.78, 22.38]],
      ['chips', choice('chips'), [578.22, 384.81, 47.78, 22.38]],
      ['the diagram', d.querySelector('.state-diagram'), [0, 410, 634, 120]],
      ['the program level', d.querySelector('.program-level'), [0, 410, 634, 120]],
      ['its grid', programScroll(), [0, 410, 458, 120]],
      ['the runtime column', side(), [458, 410, 176, 120]],
      ...boxes.map((b, k): [string, Element, [number, number, number, number]] => [
        `the runtime box ${b.firstElementChild?.textContent}`,
        b,
        [505, 411 + 24 * k, 104, 22],
      ]),
    ]
    expect.soft(level().scrollWidth, 'the program level’s scroll width').toBeLessThanOrEqual(level().clientWidth)
    expect.soft(level().scrollHeight, 'the program level’s scroll height').toBeLessThanOrEqual(level().clientHeight)
    drawingsInside('1280px')
    for (const [what, el, [left, top, w, h]] of WHERE) {
      expect(el, `precondition: ${what} is drawn`).not.toBeNull()
      const box = (el as Element).getBoundingClientRect()
      expect
        .soft(Math.abs(box.left - origin.left - left), `${what}’s left, ${box.left - origin.left}`)
        .toBeLessThanOrEqual(0.5)
      expect
        .soft(Math.abs(box.top - origin.top - top), `${what}’s top, ${box.top - origin.top}`)
        .toBeLessThanOrEqual(0.5)
      expect.soft(Math.abs(box.width - w), `${what}’s width, ${box.width}`).toBeLessThanOrEqual(0.5)
      expect.soft(Math.abs(box.height - h), `${what}’s height, ${box.height}`).toBeLessThanOrEqual(0.5)
    }
  })

  /**
   * **AT A PHONE'S WIDTH THE RUNTIME COLUMN IS A SIDEWAYS SCROLL OF THE PROGRAM LEVEL AWAY, BY A REAL WHEEL.** The
   * level is wider inside than it is (`scrollWidth` 330 and 365 against 154 and 189); a wheel turned sideways over it,
   * real input through the provider (`userEvent.wheel`, which moves the pointer onto the level and turns Playwright's
   * mouse wheel), scrolls the level to its end, and not the view, which must not scroll sideways at all; and there the
   * column's right edge and each of its boxes lie inside the level's padding box, and `elementFromPoint` at a box's
   * centre is that box. Not the column's left edge: at 320px the column, 176px, is wider than the level, 154px, so at
   * the level's end the first 22px of the lanes that run from the rows lie left of it, and no scroll shows all of it.
   * A level that clips instead of scrolling (`overflow-x: hidden`) cannot be scrolled by a wheel, and fails here.
   */
  it.each([
    [320, 568],
    [390, 844],
  ] as const)(
    'at %i by %i px, the runtime column is a sideways scroll of the program level away',
    async (width, height) => {
      try {
        await at(width, height, false)
        const box = level()
        expect.soft(box.scrollWidth, 'the program level’s scroll width').toBeGreaterThan(box.clientWidth)
        await userEvent.wheel(box, { delta: { x: 400 } })
        const end = box.scrollWidth - box.clientWidth
        const left = await steady(() => box.scrollLeft)
        expect.soft(left, `the program level’s scroll, against its end at ${end}`).toBeGreaterThanOrEqual(end - 1)
        expect.soft(tm().scrollLeft, 'the TM view’s sideways scroll').toBe(0)
        expect.soft(scrollX, 'the page’s sideways scroll').toBe(0)
        const inside = box.getBoundingClientRect().left + box.clientLeft
        const edge = inside + box.clientWidth
        const column = side().getBoundingClientRect()
        expect
          .soft(column.right, `the runtime column’s right, against the level’s ${edge}`)
          .toBeLessThanOrEqual(edge + 0.5)
        for (const b of side().querySelectorAll<HTMLElement>('.program-box')) {
          const at = b.getBoundingClientRect()
          expect.soft(at.left, `${nameOf(b)}’s left`).toBeGreaterThanOrEqual(inside - 0.5)
          expect.soft(at.right, `${nameOf(b)}’s right`).toBeLessThanOrEqual(edge + 0.5)
        }
        const first = side().querySelector('.program-box') as HTMLElement
        const spot = first.getBoundingClientRect()
        expect(spot.bottom <= innerHeight && spot.top >= 0, 'precondition: the first box is in the viewport').toBe(true)
        const hit = document.elementFromPoint((spot.left + spot.right) / 2, (spot.top + spot.bottom) / 2)
        expect.soft(hit !== null && first.contains(hit), `what lies at ${nameOf(first)}’s centre`).toBe(true)
      } finally {
        home()
      }
    },
  )

  /**
   * **A WIDER LEVEL, IN A DESKTOP'S LAYOUT, DOES NOT SCROLL, AND ITS ROWS AND COLUMN ARE WHERE `53ecbfa` DREW THEM**,
   * though its rows are squeezed beside the column: the sideways scroll is a narrow level's only, one under 14rem (the
   * user's choice after the review, 2026-10-05). Three layouts from the review's table, each with every TM view's level
   * wider than 14rem and narrower than the 26rem that rows and column need side by side: Debugger at 1024 by 768px, its
   * one TM view 362px wide; and the TM view split right at 1280 by 800px, by its `⋯` menu, in Explorer, two views 311px
   * wide, and in Debugger, two views 239px wide, the narrowest level the first review measured in a desktop's layout.
   * For each view: the level's padding box the view's, its content no wider (`scrollWidth`), its `overflow-x`
   * `visible`, its top at its panel header's bottom and its height 120px; the rows at the view's left, `view − 176`px
   * wide; the column right after them, 176px wide; and each runtime box 47px into the column, 104px wide, a row apart
   * from 1px below the level's top. The figures are a throwaway probe's on `53ecbfa`'s stylesheet (2026-10-05). The
   * header above the level is not held here: in the split views it wraps where `53ecbfa` set the name on two lines.
   */
  it.each([
    { name: 'Debugger at 1024 px', preset: 'debugger', width: 1024, height: 768, split: false, views: [[374, 362]] },
    {
      name: 'Explorer at 1280 px, split',
      preset: 'explorer',
      width: 1280,
      height: 800,
      split: true,
      views: [
        [646, 311],
        [969, 311],
      ],
    },
    {
      name: 'Debugger at 1280 px, split',
      preset: 'debugger',
      width: 1280,
      height: 800,
      split: true,
      views: [
        [502, 239],
        [753, 239],
      ],
    },
  ] as const)('$name, the level does not scroll and is drawn as on 53ecbfa', async (layout) => {
    try {
      presetOf(layout.preset)
      await page.viewport(layout.width, layout.height)
      if (layout.split) {
        resetPreset()
        await frame()
        await splitTm()
      }
      await until(
        () => tmViews().every((pane) => pane.querySelectorAll('.program-box').length === 5),
        'each TM view’s runtime column',
      )
      await frame()
      await frame()
      expect(innerWidth, 'precondition: the page’s width').toBe(layout.width)
      expect(buttonOf('workspace').textContent?.toLowerCase(), 'precondition: the preset').toContain(layout.preset)
      expect(view.state.doc.toString(), 'precondition: the example').toBe(SUM_TO)
      expect(
        tmViews().map((pane) => [Math.round(pane.getBoundingClientRect().left), pane.clientWidth]),
        'precondition: the TM views, left and width',
      ).toEqual(layout.views.map(([left, width]) => [left, width]))
      for (const pane of tmViews()) {
        const name = `${layout.name}, the view at ${Math.round(pane.getBoundingClientRect().left)}`
        const panel = pane.querySelector<HTMLElement>('.panel[data-panel="diagram"]') as HTMLElement
        expect(panel.dataset.open, `precondition: ${name}: its diagram open`).toBe('true')
        const mode = (value: string) =>
          panel.querySelector(`.diagram-mode[data-value="${value}"]`)?.getAttribute('aria-checked')
        expect([mode('program'), mode('arcs')], `precondition: ${name}: its program level, in arcs`).toEqual([
          'true',
          'true',
        ])
        const box = pane.querySelector<HTMLElement>('.program-level') as HTMLElement
        const header = panel.querySelector(':scope > .panel-header') as HTMLElement
        const left = pane.getBoundingClientRect().left + pane.clientLeft
        const room = pane.clientWidth - 176
        const at = (el: Element) => el.getBoundingClientRect()
        expect.soft(at(box).left - left, `${name}: the level’s left`).toBe(0)
        expect.soft(box.clientWidth, `${name}: the level’s width`).toBe(pane.clientWidth)
        expect.soft(box.scrollWidth, `${name}: the level’s scroll width`).toBeLessThanOrEqual(box.clientWidth)
        expect.soft(getComputedStyle(box).overflowX, `${name}: the level’s overflow-x`).toBe('visible')
        expect.soft(at(box).top - at(header).bottom, `${name}: the level under its header`).toBe(0)
        expect.soft(at(box).height, `${name}: the level’s height`).toBe(120)
        const rows = pane.querySelector('.program-scroll') as HTMLElement
        const column = pane.querySelector('.program-side') as HTMLElement
        expect.soft([at(rows).left - left, at(rows).width], `${name}: the rows, left and width`).toEqual([0, room])
        expect
          .soft([at(column).left - left, at(column).width], `${name}: the column, left and width`)
          .toEqual([room, 176])
        for (const [k, b] of [...column.querySelectorAll('.program-box')].entries()) {
          expect
            .soft([at(b).left - left, at(b).width, at(b).top - at(box).top], `${name}: runtime box ${k}`)
            .toEqual([room + 47, 104, 1 + 24 * k])
        }
      }
    } finally {
      if (layout.split) {
        resetPreset()
        await until(() => tmViews().length === 1, 'one TM view again')
      }
      home()
    }
  })

  /**
   * **EVERY RUNTIME CONNECTOR IS DRAWN AT A PHONE'S WIDTH AS AT A DESKTOP'S, AND EACH ONE FROM OR TO A ROW MEETS IT.**
   * One step back from the run's end the machine is in `pc23`, the grid follows it to the same window at every width,
   * and the column draws 8 connectors there: six between routines, and one into a routine from `pc23` and one out of a
   * routine back to it (`linksOf`). A column that sat anywhere but beside the rows could draw neither of those two to
   * its row. The window first at 1280px, then the same window, the grid scrolled as far, at 390px and 320px.
   *
   * **ONE STEP BACK, NOT 400 FORWARD.** The case first stepped from the start to step 400, where `pc22` is current and
   * the window is this one, and took 5,867 to 10,093ms of its 15,000 over four runs under a 25% CPU quota (2026-10-05
   * and 06), its 400 clicks alone 1,093ms unloaded. The step is taken forward again after, so the run is ended for
   * whatever comes next.
   */
  it('one step back from the end, every runtime connector is drawn at 390 and 320 px as at 1280 px', async () => {
    await at(1280, 800, false)
    const steps = (): number[] => (stepOf('tm-0').match(/[\d,]+/g) ?? []).map((n) => Number(n.replaceAll(',', '')))
    const [, total] = steps()
    try {
      control('one step back').click()
      await until(() => steps()[0] === (total ?? 0) - 1, 'the TM leg one step back from its end')
      await frame()
      await frame()
      const current = () =>
        programScroll().querySelector('.program-row[aria-current="step"] .program-name')?.textContent
      expect(current(), 'precondition: the current row').toBe('pc23')
      expect(shown(diagramReattach()), 'precondition: the grid follows').toBe(false)
      const wide = { links: linksOf(), scroll: programScroll().scrollTop, height: programScroll().clientHeight }
      expect(wide.links, 'precondition: the connectors at 1280px').toEqual([
        'pc23 → a routine',
        ...Array(6).fill('box↔box'),
        'a routine → pc23',
      ])
      for (const [width, height] of [
        [390, 844],
        [320, 568],
      ] as const) {
        explorer()
        await page.viewport(width, height)
        await frame()
        await frame()
        expect(innerWidth, 'precondition: the page’s width').toBe(width)
        expect(steps()[0], 'precondition: still one step back').toBe((total ?? 0) - 1)
        expect.soft(current(), `${width}px: the current row`).toBe('pc23')
        expect.soft(programScroll().scrollTop, `${width}px: the grid follows to the same window`).toBe(wide.scroll)
        expect.soft(programScroll().clientHeight, `${width}px: the grid’s height`).toBe(wide.height)
        expect.soft(linksOf(), `${width}px: the connectors in the window`).toEqual(wide.links)
        drawingsInside(`${width}px, one step back`)
      }
    } finally {
      control('one step forward').click()
      await until(() => steps()[0] === total, 'the TM leg at its end again')
      home()
    }
  })
})

/** A box's four edges, in the page's coordinates. */
type Edges = { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }

/**
 * **THE LAYOUT BOX OF CHARACTERS `from` TO `to` OF A BOX'S TEXT**, across its text nodes, as a `Range` over them
 * measures it: where the glyphs are laid out, whether or not a box clips them there. It reads the text as the DOM
 * gives it, `79 states`, so it measures the number of a count built as one text node as it does one built of spans.
 */
function glyphsOf(el: Element, from: number, to: number): DOMRect {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let at = 0
  let started = false
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (!started && from < at + length) {
      range.setStart(node, from - at)
      started = true
    }
    if (started && to <= at + length) {
      range.setEnd(node, to - at)
      break
    }
    at += length
  }
  return range.getBoundingClientRect()
}

/** The element whose text node holds character `at` of `el`'s text. */
function holderOf(el: Element, at: number): Element {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let seen = 0
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (at < seen + length) return node.parentElement ?? el
    seen += length
  }
  return el
}

/** `from` and each box around it, up to and with `stop`. */
function upTo(from: Element, stop: Element): Element[] {
  const chain: Element[] = []
  for (let a: Element | null = from; a !== null; a = a.parentElement) {
    chain.push(a)
    if (a === stop) break
  }
  return chain
}

/**
 * **WHAT SHOWS OF ANYTHING INSIDE `from`**: the padding boxes of `from` and of each box around it up to `stop` that
 * clips (any `overflow` but `visible`), intersected. Empty, its right at or left of its left or its bottom at or above
 * its top, where one of them has no width or lies wholly past another.
 */
function windowOf(from: Element, stop: Element): Edges {
  const edges = { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity }
  for (const a of upTo(from, stop)) {
    const style = getComputedStyle(a)
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
    const box = a.getBoundingClientRect()
    edges.left = Math.max(edges.left, box.left + a.clientLeft)
    edges.right = Math.min(edges.right, box.left + a.clientLeft + a.clientWidth)
    edges.top = Math.max(edges.top, box.top + a.clientTop)
    edges.bottom = Math.min(edges.bottom, box.top + a.clientTop + a.clientHeight)
  }
  return edges
}

/** Glyphs against what shows of them, to 0.5px: all of them, none of them, or a part. */
function drawnOf(glyphs: DOMRect, shows: Edges): 'whole' | 'part' | 'none' {
  const past =
    glyphs.right <= shows.left + 0.5 ||
    glyphs.left >= shows.right - 0.5 ||
    glyphs.bottom <= shows.top + 0.5 ||
    glyphs.top >= shows.bottom - 0.5
  if (past) return 'none'
  const inside =
    glyphs.left >= shows.left - 0.5 &&
    glyphs.right <= shows.right + 0.5 &&
    glyphs.top >= shows.top - 0.5 &&
    glyphs.bottom <= shows.bottom + 0.5
  return inside ? 'whole' : 'part'
}

/** A layout a sweep puts the page in: the preset, the page's size, and whether the TM view is split right. */
type Layout = {
  readonly preset: string
  readonly width: number
  readonly height: number
  readonly split: boolean
  readonly views: readonly (readonly [number, number])[]
}
/** What a count draws: all of it, its number and a cut unit, its number alone, or nothing. */
type Draws = 'whole' | 'cut' | 'number' | 'none'
const DRAWS: Readonly<Record<Draws, string>> = {
  whole: 'all of it',
  cut: 'its number and a cut unit',
  number: 'its number alone',
  none: 'nothing',
}
/**
 * One sweep of the program level's rows: a layout by its name, the rendering, how many rows carry a count, how many
 * of those a ⚠, and what the rows WITHOUT a ⚠ must draw of their counts.
 */
type Sweep = {
  readonly name: string
  readonly edges: 'arcs' | 'chips'
  readonly rows: number
  readonly warned: number
  readonly drawn: Readonly<Record<Draws, number>>
}
/** Where each swept layout puts the page, and the TM views it must then draw, each by its left and its width. */
const LAYOUTS: Readonly<Record<string, Layout>> = {
  'Explorer at 320 px': { preset: 'explorer', width: 320, height: 568, split: false, views: [[166, 154]] },
  'Explorer at 390 px': { preset: 'explorer', width: 390, height: 844, split: false, views: [[201, 189]] },
  'Explorer at 1280 px, split': {
    preset: 'explorer',
    width: 1280,
    height: 800,
    split: true,
    views: [
      [646, 311],
      [969, 311],
    ],
  },
  'Debugger at 1024 px': { preset: 'debugger', width: 1024, height: 768, split: false, views: [[374, 362]] },
}

/**
 * **WHAT A COUNT MAY DRAW IN THE ROOM ITS ROW LEAVES IT**: all of it where the room is its text's width; its number and
 * a cut unit down to the number and two characters, a space and the ellipsis; its number alone down to the number; and
 * nothing in less. To 0.5px, within which either side of a threshold passes, but for the first: a count with its whole
 * width draws all of it.
 */
function mayDraw(room: number, number: number, unit: number, character: number): Draws[] {
  if (room >= number + unit - 0.5) return ['whole']
  const may: Draws[] = []
  if (room >= number + 2 * character - 0.5) may.push('cut')
  if (room >= number - 0.5 && room < number + 2 * character + 0.5) may.push('number')
  if (room < number + 0.5) may.push('none')
  return may
}

/**
 * **A ROW'S COUNT DRAWS ITS NUMBER WHOLE OR NOT AT ALL, AND CUTS ONLY ITS UNIT, WITH AN ELLIPSIS.** A row's cell clips
 * (`overflow: hidden`), and a count of `flex: none` ran past it and lost its last characters, its digits too. Cut as
 * one text with an ellipsis it read as another number: the browser draws a line's first character whatever its box
 * and clips the ellipsis after it, so at 320px `map and fold`'s `53 states`, in a box of 9px, read `5.`, and
 * `fact(4)`'s `317 states`, in one of 27px, `31…` (screenshots, 2026-10-06). And not at a phone's width only: in
 * Explorer at 1280px with the TM view split right, `fact(4)`'s `49 states` read `4.`.
 *
 * **WHAT IS HELD IS GLYPHS AGAINST THE BOXES THAT CLIP THEM**, for every row the program level draws, its grid scrolled
 * a window at a time. The number's glyphs, a `Range` over the digits the count's text starts with (`glyphsOf`), lie
 * wholly inside what shows of them (`windowOf`, up to the row's cell), and inside the count's own box, or wholly
 * outside it: never across its edge. No box around a drawn number that ends in an ellipsis, its content overflowing it,
 * leaves less than a character's width after the number: the ellipsis takes that width from the end of what its box
 * shows, and replaces characters a `Range` still measures in place, which is how `31…` was drawn with all three digits'
 * boxes inside the count's. The unit's glyphs, the rest of the text, are whole, or not drawn, or cut by a box of
 * `overflow-x: hidden` and `text-overflow: ellipsis`, the innermost clipping box they run past, with at least two
 * characters' width of them showing, a space and the ellipsis, where less would clip the ellipsis itself. And a count
 * that does not draw its number draws nothing. The count's text is a number and `state` or `states` in the DOM,
 * whatever is drawn of it.
 *
 * **EVERY COUNT DRAWS WHAT ITS ROOM ALLOWS, NO LESS** (`mayDraw`): all of it in its text's width, its number and a cut
 * unit down to the number and two characters, its number alone down to the number, and nothing in less, where the room
 * is what its row leaves it, from where its box starts to where that ends or the cell cuts it. The properties above say
 * what must not show, and a count that hid whenever its whole text did not fit would pass them all; it fails this one,
 * row by row.
 *
 * **EACH LAYOUT'S TALLY IS HELD TOO, OF ITS ROWS WITHOUT A ⚠, SO NONE PASSES ON NOTHING**: how many of them draw their
 * count whole, with the unit cut, as the number alone, and not at all, as this file measured them on the web fonts and
 * on the machines these two programs compile to (2026-10-06): a change to either moves them. At 390px `map and fold`
 * draws 97 counts with the unit cut, `53 st…`, and in Debugger at 1024px 97, `53 s…`. Two programs, since their rows
 * differ in what they leave a count: `fact(4)` at 320px draws 15 numbers alone, `map and fold`, with the widest arcs'
 * gutter (75px), 14, each of one digit, and 83 counts not at all. In *arcs* and in *chips*, whose rows hold their chips
 * before their count.
 *
 * **A ROW WITH A ⚠ IS HELD ROW BY ROW AND NOT TALLIED, SINCE ITS ⚠ IS AS WIDE AS THE MACHINE'S FONTS MAKE IT.** The ⚠
 * is U+26A0, which neither web font has, so a system font draws it. Where this was written the generic `monospace` at
 * the end of the rows' font list is Noto Sans Mono, which lacks it too, and the browser falls back to DejaVu Sans,
 * whose ⚠ is 11px wide. In CI's image, `node:26-bookworm`, `monospace` is DejaVu Sans Mono, which has it: 7.2px wide on
 * a machine made to choose it, where each such row leaves its count 3.8px more. At 390px three of `map and fold`'s ten
 * rows with a ⚠, those with a two-digit number, then have the two characters a cut unit needs; this file's first run on
 * CI failed on a tally that held all ten as the number alone, 100 for 97 with the unit cut and 7 for 10 alone, and so
 * did a run here on that font (2026-10-06). Every glyph of a row without a ⚠ is Hack's, by a throwaway probe of the
 * fonts the browser drew each with, and those rows' tallies are the same under both ⚠s and under one forced to 3, 7, 9,
 * 13, 15 and 19px. So of the rows with a ⚠ only their number is held, 2 and 10, the compiled program's; what they draw
 * is held by the properties above, and said on the console beside the tallies, with the ⚠'s width and a digit's. **THE
 * ROWS' FONT IS A PRECONDITION**: Hack loaded, in the hook, and first in the rows' font list, in each case, since a
 * page that could not load it would fail on its tallies with nothing to say why.
 *
 * **THE EXAMPLE IS PICKED IN A HOOK, AND EACH LAYOUT IS A CASE**: under a 25% CPU quota `map and fold`'s pick and two
 * sweeps in one case took 11,582ms of a case's 15,000 (2026-10-06). Its pick waits past two marks, a third and two
 * thirds of the TM leg's 69,008 steps (`pick`). **LAST IN THE FILE**: they open other programs.
 */
const COUNTED: readonly {
  readonly title: string
  readonly id: string
  readonly marks: readonly number[]
  readonly sweeps: readonly Sweep[]
}[] = [
  {
    title: 'fact(4)',
    id: 'fact',
    marks: [],
    sweeps: [
      {
        name: 'Explorer at 320 px',
        edges: 'arcs',
        rows: 21,
        warned: 2,
        drawn: { whole: 0, cut: 4, number: 15, none: 0 },
      },
      {
        name: 'Explorer at 320 px',
        edges: 'chips',
        rows: 26,
        warned: 2,
        drawn: { whole: 8, cut: 2, number: 4, none: 10 },
      },
      {
        name: 'Explorer at 390 px',
        edges: 'arcs',
        rows: 21,
        warned: 2,
        drawn: { whole: 4, cut: 15, number: 0, none: 0 },
      },
      {
        name: 'Explorer at 390 px',
        edges: 'chips',
        rows: 26,
        warned: 2,
        drawn: { whole: 11, cut: 6, number: 3, none: 4 },
      },
      {
        name: 'Explorer at 1280 px, split',
        edges: 'arcs',
        rows: 21,
        warned: 2,
        drawn: { whole: 0, cut: 0, number: 4, none: 15 },
      },
    ],
  },
  {
    title: 'map and fold',
    id: 'map-fold',
    marks: [23_000, 46_000],
    sweeps: [
      {
        name: 'Explorer at 320 px',
        edges: 'arcs',
        rows: 107,
        warned: 10,
        drawn: { whole: 0, cut: 0, number: 14, none: 83 },
      },
      {
        name: 'Explorer at 320 px',
        edges: 'chips',
        rows: 112,
        warned: 10,
        drawn: { whole: 61, cut: 1, number: 11, none: 29 },
      },
      {
        name: 'Explorer at 390 px',
        edges: 'arcs',
        rows: 107,
        warned: 10,
        drawn: { whole: 0, cut: 97, number: 0, none: 0 },
      },
      {
        name: 'Explorer at 390 px',
        edges: 'chips',
        rows: 112,
        warned: 10,
        drawn: { whole: 63, cut: 22, number: 5, none: 12 },
      },
      {
        name: 'Debugger at 1024 px',
        edges: 'arcs',
        rows: 107,
        warned: 10,
        drawn: { whole: 0, cut: 97, number: 0, none: 0 },
      },
    ],
  },
]

describe.each(COUNTED)('the program level’s counts, on $title', ({ id, marks, sweeps }) => {
  beforeAll(async () => {
    await pick(id, marks)
    // THE TALLIES ARE HACK'S: the rows are set in it, and a page that could not load it would draw them in a system
    // font, of other widths.
    const faces = await document.fonts.load('12px "Hack"', '0123456789 states')
    expect(
      faces.map((face) => face.family.replaceAll('"', '')),
      'precondition: Hack, the rows’ font, is loaded',
    ).toContain('Hack')
  })

  it.each(sweeps)(
    '$name in $edges, a count draws its number whole or not at all, and cuts only its unit',
    async (sweep) => {
      const layout = LAYOUTS[sweep.name] as Layout
      try {
        presetOf(layout.preset)
        await page.viewport(layout.width, layout.height)
        if (layout.split) {
          resetPreset()
          await frame()
          await splitTm()
        }
        choice(sweep.edges).click()
        await until(
          () => choice(sweep.edges).getAttribute('aria-checked') === 'true',
          `the diagram drawn as ${sweep.edges}`,
        )
        await frame()
        await frame()
        expect(innerWidth, 'precondition: the page’s width').toBe(layout.width)
        expect(buttonOf('workspace').textContent?.toLowerCase(), 'precondition: the preset').toContain(layout.preset)
        expect(view.state.doc.toString(), 'precondition: the example').toBe(EXAMPLES.find((e) => e.id === id)?.text)
        expect(idle(), 'precondition: the run has its result').toBe(true)
        expect(
          tmViews().map((pane) => [Math.round(pane.getBoundingClientRect().left), pane.clientWidth]),
          'precondition: the TM views, left and width',
        ).toEqual(layout.views.map(([left, width]) => [left, width]))
        expect(diagram().dataset.open, 'precondition: the state diagram is open').toBe('true')
        expect(choice('program').getAttribute('aria-checked'), 'precondition: its program level').toBe('true')
        expect(level().scrollLeft, 'precondition: the program level not scrolled sideways').toBe(0)
        const grid = programScroll()
        expect(
          getComputedStyle(grid).fontFamily.replaceAll('"', ''),
          'precondition: the rows are set in Hack first',
        ).toMatch(/^Hack,/)
        const seen = new Set<string>()
        /** What the rows without a ⚠ draw of their counts, and what the rows with one do: held, and only said. */
        const drawn: Record<Draws, number> = { whole: 0, cut: 0, number: 0, none: 0 }
        const flagged: Record<Draws, number> = { whole: 0, cut: 0, number: 0, none: 0 }
        let warned = 0
        let digit = Number.NaN
        let sign = Number.NaN
        const amiss: string[] = []
        const reworded: string[] = []
        const inPart: string[] = []
        const outside: string[] = []
        const dotted: string[] = []
        const headless: string[] = []
        const bare: string[] = []
        const cramped: string[] = []
        for (let top = 0; ; top += grid.clientHeight) {
          grid.scrollTop = top
          await frame()
          await frame()
          for (const row of grid.querySelectorAll<HTMLElement>('.program-row')) {
            const count = row.querySelector<HTMLElement>('.program-count')
            const cell = row.querySelector<HTMLElement>('.program-cell')
            if (count === null || cell === null) continue
            // ONCE A ROW, not once a window: the grid draws a row in each window that overlaps it.
            const key = row.getAttribute('aria-rowindex') ?? ''
            if (seen.has(key)) continue
            seen.add(key)
            const text = count.textContent ?? ''
            const name = `${row.querySelector('.program-name')?.textContent} “${text}”`
            const digits = /^\d+(?= states?$)/.exec(text)?.[0].length ?? 0
            if (digits === 0) {
              reworded.push(name)
              continue
            }
            const number = glyphsOf(count, 0, digits)
            const numberShows = windowOf(holderOf(count, 0), cell)
            const n = drawnOf(number, numberShows)
            const unit = glyphsOf(count, digits, text.length)
            const word = holderOf(count, digits)
            const unitShows = windowOf(word, cell)
            const u = drawnOf(unit, unitShows)
            const said = `${name}, its number at ${number.left} to ${number.right}`
            if (n === 'part') inPart.push(`${said}, in what shows from ${numberShows.left} to ${numberShows.right}`)
            const box = count.getBoundingClientRect()
            if (n === 'whole' && (number.left < box.left - 0.5 || number.right > box.right + 0.5))
              outside.push(`${said}, its count’s box ${box.left} to ${box.right}`)
            const character = number.width / digits
            for (const a of upTo(holderOf(count, 0), cell)) {
              if (n === 'none' || getComputedStyle(a).textOverflow !== 'ellipsis') continue
              if (a.scrollWidth <= a.clientWidth) continue
              const after = a.getBoundingClientRect().left + a.clientLeft + a.clientWidth - number.right
              if (after < character - 0.5)
                dotted.push(`${name}, ${after}px after its number in ${nameOf(a)}, an ellipsis ${character}px`)
            }
            if (n === 'none' && u !== 'none') headless.push(`${name}, its unit at ${unit.left} to ${unit.right}`)
            if (u === 'part') {
              // THE BOX THAT CUTS THE UNIT is the innermost one that clips and that its glyphs run past.
              const cutter = upTo(word, cell).find(
                (a) =>
                  getComputedStyle(a).overflowX !== 'visible' &&
                  a.getBoundingClientRect().left + a.clientLeft + a.clientWidth < unit.right - 0.5,
              )
              const style = getComputedStyle(cutter ?? cell)
              if (style.overflowX !== 'hidden' || style.textOverflow !== 'ellipsis')
                bare.push(
                  `${name}, by ${nameOf(cutter ?? cell)}, overflow-x ${style.overflowX}, text-overflow ${style.textOverflow}`,
                )
              const room = Math.min(unit.right, unitShows.right) - Math.max(unit.left, unitShows.left)
              if (room < 2 * character - 0.5)
                cramped.push(`${name}, ${room}px of its unit showing, a character ${character}px`)
            }
            // THE ROOM THE ROW LEAVES THE COUNT: from where its box starts to where that ends or the cell cuts it.
            const edge = cell.getBoundingClientRect().left + cell.clientLeft + cell.clientWidth
            const room = Math.max(0, Math.min(box.right, edge) - box.left)
            const warn = row.querySelector('.program-warn')
            digit = character
            if (warn !== null) {
              warned += 1
              sign = warn.getBoundingClientRect().width
            }
            // A number drawn in part is none of the four, and has failed above.
            if (n === 'part') continue
            const draws: Draws = n === 'none' ? 'none' : u === 'whole' ? 'whole' : u === 'part' ? 'cut' : 'number'
            const may = mayDraw(room, number.width, unit.width, character)
            if (!may.includes(draws))
              amiss.push(
                `${name} draws ${DRAWS[draws]} in ${room}px, where it may draw ${may.map((d) => DRAWS[d]).join(' or ')}`,
              )
            ;(warn === null ? drawn : flagged)[draws] += 1
          }
          if (top + grid.clientHeight >= grid.scrollHeight) break
        }
        // SAID, NOT HELD: what the rows with a ⚠ draw, and how wide this machine's ⚠ and digit are, for whoever reads a
        // failure on another machine.
        const said = {
          on: id,
          layout: sweep.name,
          edges: sweep.edges,
          rows: seen.size,
          warned,
          drawn,
          flagged,
          digit,
          sign,
        }
        console.error(`COUNTS ${JSON.stringify(said)}`)
        expect(seen.size, 'precondition: every row with a count, swept').toBe(sweep.rows)
        expect(warned, 'precondition: the rows among them that carry a ⚠').toBe(sweep.warned)
        expect.soft(reworded, 'counts whose text is not a number and `state` or `states`').toEqual([])
        expect.soft(inPart, 'numbers drawn in part').toEqual([])
        expect.soft(outside, 'numbers drawn outside their count’s box').toEqual([])
        expect.soft(dotted, 'numbers an ellipsis takes digits of').toEqual([])
        expect.soft(headless, 'units drawn without their number').toEqual([])
        expect.soft(bare, 'units cut without an ellipsis').toEqual([])
        expect.soft(cramped, 'units cut with no room for the ellipsis').toEqual([])
        expect.soft(amiss, 'counts that do not draw what their room allows').toEqual([])
        const rows = `in the rows without a ⚠, a digit ${digit}px wide`
        expect.soft(drawn.whole, `counts drawn whole, ${rows}`).toBe(sweep.drawn.whole)
        expect.soft(drawn.cut, `counts drawn with the unit cut, ${rows}`).toBe(sweep.drawn.cut)
        expect.soft(drawn.number, `counts drawn as the number alone, ${rows}`).toBe(sweep.drawn.number)
        expect.soft(drawn.none, `counts not drawn, ${rows}`).toBe(sweep.drawn.none)
      } finally {
        programScroll().scrollTop = 0
        choice('arcs').click()
        await until(() => choice('arcs').getAttribute('aria-checked') === 'true', 'the diagram drawn as arcs again')
        if (shown(diagramReattach())) diagramReattach().click()
        if (layout.split) {
          resetPreset()
          await until(() => tmViews().length === 1, 'one TM view again')
        }
        home()
      }
    },
  )
})
