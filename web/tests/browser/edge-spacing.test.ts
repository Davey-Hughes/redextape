import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { DEFAULT_STYLE, STYLE_IDS } from '../../src/skin'
import { editorOf } from './editor-view-fixture'
import {
  buttonOf,
  chooseOption,
  clickWorkspaceItem,
  drawsEdge,
  frames,
  inspector,
  menuOfId,
  mountAt,
  paneByLeaf,
  pick,
  rect,
  rem,
  space,
  until,
} from './harness'

/**
 * NO TEXT RUN OR CONTROL SITS WITHIN 4 PX OF ITS PANE'S EDGES OR THE WINDOW'S, where it reads as clipped
 * (`docs/superpowers/specs/2026-11-14-edge-spacing-design.md`). A pane has no padding, so that its editors, tapes and
 * highlight bands run edge to edge; its rows — the header, the TM status line, a copy's value line — carry the gap
 * instead, and a row added without it fails here. What lies outside the views is held to the window's edges alone. Each
 * case asserts first that it measures something: the four views, items in each, a header wrapped at 390 px, and the
 * rows the design names, the wordmark and the strip among the items. ONE MOUNT FOR THE FILE, for the reason
 * `app.test.ts` gives.
 */

const THRESHOLD = 4

type Side = 'left' | 'right' | 'top' | 'bottom'
const SIDES: readonly Side[] = ['left', 'right', 'top', 'bottom']

type Box = { left: number; right: number; top: number; bottom: number }

type Item = { kind: 'text' | 'control'; el: Element; box: Box; label: string; cut: Record<Side, boolean> }

const CONTROLS = [
  'button',
  'select',
  'input:not([type=hidden])',
  'textarea',
  'summary',
  ...['button', 'tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'switch', 'slider'].map(
    (role) => `[role=${role}]`,
  ),
].join(', ')

/** Elements whose text is not drawn where it sits in the document, or not drawn at all. */
const UNDRAWN_TEXT = new Set(['SCRIPT', 'STYLE', 'OPTION', 'TITLE', 'NOSCRIPT', 'TEMPLATE'])

/** Whether `el` is unseen: undisplayed, invisible, transparent, for a screen reader only, or in a shut `details`. */
function unseen(el: Element): boolean {
  if (getComputedStyle(el).visibility === 'hidden') return true
  for (let e: Element | null = el; e !== null; e = e.parentElement) {
    const cs = getComputedStyle(e)
    if (cs.display === 'none' || cs.opacity === '0') return true
    if (e.classList.contains('visually-hidden') || e.classList.contains('cm-announced')) return true
    // A SHUT `details` STILL GIVES ITS CONTENT RECTS, where only its own summary is drawn.
    if (e instanceof HTMLDetailsElement && !e.open && el.closest('summary')?.parentElement !== e) return true
  }
  return false
}

/**
 * `el`'s client box: inside its border and any scrollbar. A pane scrolls, so its scrollbar is an edge that content
 * flush against it touches as it would the border.
 */
function clientEdges(el: Element): Box {
  const r = el.getBoundingClientRect()
  const left = r.left + el.clientLeft
  const top = r.top + el.clientTop
  return { left, right: left + el.clientWidth, top, bottom: top + el.clientHeight }
}

/** What of `box` is left inside every ancestor from `from` up that clips its overflow, each on the axes it clips. */
function unclipped(box: Box, from: Element | null): Box {
  const v = { ...box }
  for (let e = from; e !== null && e !== document.documentElement; e = e.parentElement) {
    const cs = getComputedStyle(e)
    const c = clientEdges(e)
    if (cs.overflowX !== 'visible') {
      v.left = Math.max(v.left, c.left)
      v.right = Math.min(v.right, c.right)
    }
    if (cs.overflowY !== 'visible') {
      v.top = Math.max(v.top, c.top)
      v.bottom = Math.min(v.bottom, c.bottom)
    }
  }
  return v
}

/**
 * `box` as an item, with the sides an overflow ancestor clips marked `cut`; `null` where the clip leaves less than a
 * pixel of it. A cut side is not measured: it is content scrolled past an edge, or cut with an ellipsis, not a layout
 * gap. A text node's clip starts at its parent, which may itself scroll it; a control's at the control's parent, since
 * a control's own overflow clips its content, not its box.
 */
function item(kind: Item['kind'], el: Element, box: Box, label: string): Item | null {
  const v = unclipped(box, kind === 'text' ? el : el.parentElement)
  if (v.right - v.left < 1 || v.bottom - v.top < 1) return null
  const cut = {
    left: v.left > box.left + 0.5,
    right: v.right < box.right - 0.5,
    top: v.top > box.top + 0.5,
    bottom: v.bottom < box.bottom - 0.5,
  }
  return { kind, el, box, label, cut }
}

/**
 * Every text run and control under `root` that is drawn, as `item` measures it. **TEXT BY ITS GLYPHS, NOT ITS BOX**: a
 * `Range` over a text node's trimmed text, the union of its client rects, since a block's box runs to its container's
 * edges whatever its text does. A control by its border box, which is what a user aims at.
 */
function itemsIn(root: Element): Item[] {
  const items: Item[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const text = n.nodeValue ?? ''
    const start = text.search(/\S/)
    const parent = n.parentElement
    if (start < 0 || parent === null || UNDRAWN_TEXT.has(parent.tagName) || parent.closest('select') !== null) continue
    if (unseen(parent)) continue
    const range = document.createRange()
    range.setStart(n, start)
    range.setEnd(n, text.trimEnd().length)
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
    if (rects.length === 0) continue
    const box = {
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    }
    const found = item('text', parent, box, text.trim().replace(/\s+/g, ' ').slice(0, 40))
    if (found !== null) items.push(found)
  }
  for (const c of root.querySelectorAll(CONTROLS)) {
    if (unseen(c)) continue
    const r = c.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const label = c.getAttribute('aria-label') ?? (c.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
    const found = item('control', c, { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, label)
    if (found !== null) items.push(found)
  }
  return items
}

/**
 * The document's edges, its whole scroll size, in the viewport's coordinates: what pushes the page wider or longer
 * meets the edge it pushed out.
 */
function documentEdges(): Box {
  const doc = document.documentElement
  return {
    left: -scrollX,
    right: Math.max(doc.scrollWidth, doc.clientWidth) - scrollX,
    top: -scrollY,
    bottom: Math.max(doc.scrollHeight, doc.clientHeight) - scrollY,
  }
}

/** The viewport's edges, inside any scrollbar: what a fixed box, an open popover, meets however long the page is. */
function viewportEdges(): Box {
  const doc = document.documentElement
  return { left: 0, right: doc.clientWidth, top: 0, bottom: doc.clientHeight }
}

/** What an item is measured from: an element's client box, the document's edges, or the viewport's. */
type Ref = Element | 'window' | 'viewport'

/** How far `item` sits in from `ref`'s `side`, to 0.1 px. */
function gap(item: Item, ref: Ref, side: Side): number {
  const edge = ref === 'window' ? documentEdges() : ref === 'viewport' ? viewportEdges() : clientEdges(ref)
  const raw = side === 'left' || side === 'top' ? item.box[side] - edge[side] : edge[side] - item.box[side]
  return Math.round(raw * 10) / 10
}

/** `el` as a short selector: its tag, and its id or its first two classes. */
function describeEl(el: Element): string {
  if (el.id !== '') return `${el.tagName.toLowerCase()}#${el.id}`
  return [el.tagName.toLowerCase(), ...[...el.classList].slice(0, 2)].join('.')
}

/** Where `item` is inside `root`: its last four elements below `root`, and a text run's words. */
function pathIn(root: Element, it: Item): string {
  const parts: string[] = []
  for (let e: Element | null = it.el; e !== null && e !== root && parts.length < 4; e = e.parentElement)
    parts.unshift(describeEl(e))
  return it.kind === 'text' ? `${parts.join(' > ')} "${it.label}"` : parts.join(' > ')
}

/** The views on the page. */
const panes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.pane')]

/** The text runs and controls drawn outside every view: the app's bar, the strip, and whatever else the page draws. */
const outsideViews = (): Item[] => itemsIn(document.body).filter((it) => it.el.closest('.pane') === null)

/** Each of `items` within `THRESHOLD` of `refs(side)` on an uncut side, as `where · path · ref side · gap`. */
function near(where: string, root: Element, items: readonly Item[], refs: (side: Side) => Ref[]): string[] {
  const out: string[] = []
  for (const it of items)
    for (const side of SIDES.filter((s) => !it.cut[s]))
      for (const ref of refs(side)) {
        const g = gap(it, ref, side)
        if (g < THRESHOLD)
          out.push(`${where} · ${pathIn(root, it)} · ${typeof ref === 'string' ? ref : 'pane'} ${side} · ${g}`)
      }
  return out
}

/**
 * Every item within `THRESHOLD` of its pane's left, right or top or of any side of the window, and every item outside
 * the views within it of the window's, as one line each. **NOT A PANE'S BOTTOM**: a pane scrolls, so where a row lands
 * against its bottom is a matter of the pane's height and scroll, not of the row's padding. The window's bottom is
 * measured, against the document's height.
 */
function contacts(): string[] {
  return [
    ...panes().flatMap((pane) =>
      near(`${pane.dataset.kind}`, pane, itemsIn(pane), (side) => (side === 'bottom' ? ['window'] : [pane, 'window'])),
    ),
    ...near('outside the views', document.body, outsideViews(), () => ['window']),
  ]
}

/** Whether some measured text run lies inside `el`. */
const textMeasuredIn = (items: readonly Item[], el: Element | null): boolean =>
  el !== null && items.some((i) => i.kind === 'text' && el.contains(i.el))

/** Assert what every case needs before its gaps mean anything: the four views, and the rows the design names. */
function assertMeasured(): Item[] {
  expect(
    panes()
      .map((p) => p.dataset.kind)
      .sort(),
    'precondition: the four views',
  ).toEqual(['lambda', 'rxm', 'source', 'tm'])
  const items = panes().flatMap((pane) => {
    const own = itemsIn(pane)
    expect(own.length, `precondition: items measured in the ${pane.dataset.kind} view`).toBeGreaterThanOrEqual(3)
    return own
  })
  const source = document.querySelector('.pane[data-kind="source"] .view-title')
  expect(textMeasuredIn(items, source), 'precondition: the source view’s title text is measured').toBe(true)
  const closes = [...document.querySelectorAll('.pane .view-close')]
  expect(closes.length, 'precondition: each view’s ✕').toBe(4)
  for (const close of closes)
    expect(
      items.some((i) => i.el === close),
      `precondition: ${close.closest<HTMLElement>('.pane')?.dataset.kind}’s ✕ is measured`,
    ).toBe(true)
  expect(textMeasuredIn(items, document.querySelector('.tm-status')), 'precondition: the TM status is measured').toBe(
    true,
  )
  const outside = outsideViews()
  expect(textMeasuredIn(outside, document.querySelector('.bar .wordmark')), 'precondition: the wordmark').toBe(true)
  expect(
    outside.some((i) => i.el.closest('.strip') !== null),
    'precondition: the strip’s items',
  ).toBe(true)
  return items
}

/** Put the window at `width` × `height` and the style at `style`, and let the page lay itself out. */
async function at(width: number, height: number, style: string): Promise<void> {
  await page.viewport(width, height)
  await until(() => innerWidth === width && innerHeight === height, `the window at ${width} × ${height}`)
  chooseOption('#style', style)
  await until(() => document.documentElement.dataset.style === style, `the style ${style}`)
  await frames()
}

/** Whether some view's header runs to more than one row: it is taller than twice its title's own line. */
const someHeaderWraps = (): boolean =>
  [...document.querySelectorAll('.view-header')].some(
    (h) => rect(h).height > 2 * rect(h.querySelector('.view-title-heading')).height,
  )

/** The panel headers drawn on the page. */
const panelHeaders = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('.panel-header')].filter((h) => !unseen(h))

/** A panel header as `view · panel`, or `app · panel` outside the views. */
const headerName = (h: Element): string =>
  `${h.closest<HTMLElement>('.pane')?.dataset.kind ?? 'app'} · ${h.closest<HTMLElement>('.panel')?.dataset.panel}`

/** Whether `it` is a control that draws a border above or below: a box the eye sees, not only its text. */
const bordered = (it: Item): boolean => {
  if (it.kind !== 'control') return false
  const s = getComputedStyle(it.el)
  return drawsEdge(s, 'Top') || drawsEdge(s, 'Bottom')
}

/** What a header case measures in each of `headers`: its text runs and its bordered controls. */
function measuredIn(headers: readonly HTMLElement[]): (h: HTMLElement) => Item[] {
  const measured = new Map(headers.map((h) => [h, itemsIn(h).filter((i) => i.kind === 'text' || bordered(i))]))
  return (h) => measured.get(h) ?? []
}

/**
 * The inner edges of `h`'s top and bottom rules, from its border box: `clientHeight` rounds to a whole pixel, and a
 * header whose actions wrap is a fraction of a pixel off one.
 */
function ruleEdges(h: Element): { top: number; bottom: number } {
  const r = rect(h)
  const s = getComputedStyle(h)
  return { top: r.top + Number.parseFloat(s.borderTopWidth), bottom: r.bottom - Number.parseFloat(s.borderBottomWidth) }
}

/** Every item `of` gives within `THRESHOLD` of its header's top or bottom rule on an uncut side, one line each. */
function nearRules(headers: readonly HTMLElement[], of: (h: HTMLElement) => Item[]): string[] {
  return headers.flatMap((h) => {
    const edge = ruleEdges(h)
    return of(h).flatMap((it) =>
      (['top', 'bottom'] as const).flatMap((side) => {
        if (it.cut[side]) return []
        const g = Math.round((side === 'top' ? it.box.top - edge.top : edge.bottom - it.box.bottom) * 10) / 10
        return g < THRESHOLD ? [`${headerName(h)} · ${pathIn(h, it)} · ${side} · ${g}`] : []
      }),
    )
  })
}

/** Whether `h` holds more than the toggle's row: its content is taller than the toggle, so its actions wrapped. */
const actionsWrap = (h: HTMLElement): boolean => {
  const edge = ruleEdges(h)
  const s = getComputedStyle(h)
  const content = edge.bottom - edge.top - Number.parseFloat(s.paddingTop) - Number.parseFloat(s.paddingBottom)
  return content > rect(h.querySelector('.panel-toggle')).height + 0.5
}

beforeAll(() => mountAt(1600, 1000), 30_000)

/**
 * A PANEL HEADER'S RULES ARE EDGES AS WELL: a bordered button against one reads as clipped. A control without a border,
 * the toggle, is measured by its text alone, since its box is an undrawn click area padded out past its text. Clearing
 * the buttons must not shrink that click area, and a header with actions and one without stay one height, so a view's
 * panels line up. THE INSPECTOR IS SHOWN FOR ITS HEADER, the one without actions: every panel in a view has a maximise.
 * AT A PHONE'S WIDTH A HEADER'S ACTIONS WRAP ONTO A ROW OF THEIR OWN, the last row the header draws, which is held to
 * the rules the same way; that header is taller than the others by the row.
 */
describe('a panel header’s rules', () => {
  /** Each of `headers` whose toggle is shorter than its name's line and `var(--space-1)` above and below it. */
  const shortToggles = (headers: readonly HTMLElement[]): string[] => {
    const padding = 2 * space('--space-1')
    return headers.flatMap((h) => {
      const toggle = rect(h.querySelector('.panel-toggle')).height
      const line = rect(h.querySelector('.panel-name')).height
      return toggle < line + padding ? [`${headerName(h)} · toggle ${toggle} · name ${line}`] : []
    })
  }

  it('keeps panel-header buttons and text 4 px from the header rules', async () => {
    await at(1600, 1000, DEFAULT_STYLE)
    clickWorkspaceItem('[data-switch="readout"][data-value="inspector"]')
    try {
      await until(() => !inspector().hidden, 'the inspector')
      await frames()
      const headers = panelHeaders()
      const of = measuredIn(headers)
      for (const h of headers) {
        const name = h.querySelector('.panel-name')
        expect(textMeasuredIn(of(h), name), `precondition: ${headerName(h)}’s name is measured`).toBe(true)
      }
      expect(
        headers.some((h) => of(h).some((i) => bordered(i) && !i.cut.top && !i.cut.bottom)),
        'precondition: a header holds a bordered button',
      ).toBe(true)
      expect(
        headers.some((h) => !of(h).some(bordered)),
        'precondition: a header holds none',
      ).toBe(true)

      expect(nearRules(headers, of)).toEqual([])
      expect(shortToggles(headers), 'every toggle as tall as its name’s line and its padding').toEqual([])

      const heights = headers.map((h) => rect(h).height)
      const listed = headers.map((h, i) => `${headerName(h)} ${heights[i]}`).join('; ')
      expect(new Set(heights).size, `every header one height: ${listed}`).toBe(1)
    } finally {
      clickWorkspaceItem('[data-switch="readout"][data-value="strip"]')
      await until(() => inspector().hidden === true, 'the strip again')
    }
  })

  /**
   * EACH HEADER IS SCROLLED INTO VIEW BEFORE IT IS MEASURED: at this width a view is short, and a header below its
   * first would be clipped by the view's scroll, leaving nothing of it to hold. Every scroll is put back after.
   */
  it('keeps them 4 px from the rules at 320 × 844, where a header’s actions wrap onto a row of their own', async () => {
    await at(320, 844, DEFAULT_STYLE)
    const headers = panelHeaders()
    const scrollers = new Set<Element>()
    for (const h of headers)
      for (let e = h.parentElement; e !== null; e = e.parentElement)
        if (e.scrollHeight > e.clientHeight) scrollers.add(e)
    const saved = [...scrollers].map((e) => [e, e.scrollTop, e.scrollLeft] as const)
    try {
      const wrapped = headers.filter(actionsWrap)
      expect(wrapped.map(headerName), 'precondition: a header’s actions wrap onto a row of their own').not.toEqual([])
      const close: string[] = []
      const held: string[] = []
      for (const h of headers) {
        h.scrollIntoView({ block: 'center' })
        const of = measuredIn([h])
        if (wrapped.includes(h) && of(h).some((i) => bordered(i) && !i.cut.top && !i.cut.bottom))
          held.push(headerName(h))
        close.push(...nearRules([h], of))
      }
      expect(held, 'precondition: each wrapped header’s bordered buttons are measured').toEqual(wrapped.map(headerName))
      expect(close).toEqual([])
      expect(shortToggles(headers), 'every toggle as tall as its name’s line and its padding').toEqual([])
    } finally {
      for (const [e, top, left] of saved) e.scrollTo(left, top)
    }
  })
})

/**
 * Every header button that opens a popover, by id: the menus `index.html` declares, and `copies ▾`'s list, which
 * `buffer-list.ts` builds beside its button.
 */
const HEADER_MENUS = ['workspace', 'buffers', 'examples', 'share', 'about', 'settings'] as const

/** `HEADER_MENUS` is kept by hand, so a menu added to the header later would go unmeasured unless held to the header. */
describe('the header menus measured', () => {
  it('are every popover a header button opens through `aria-controls`', () => {
    const opened = [...document.querySelectorAll<HTMLButtonElement>('header.bar button[aria-controls]')]
      .filter((b) => document.getElementById(b.getAttribute('aria-controls') ?? '')?.hasAttribute('popover') === true)
      .map((b) => b.id)
    expect(opened.sort(), 'the header’s popover buttons, by id').toEqual([...HEADER_MENUS].sort())
  })
})

/**
 * AN OPEN HEADER MENU STANDS CLEAR OF THE WINDOW'S EDGES WHEREVER IT OPENS, with its content inside it. Its own box is
 * measured as well as its text and controls, since a menu flush with the window's edge reads as clipped whatever its
 * padding; and a popover scrolls what overflows it, so content wider than the menu would read as cut, not as near. A
 * menu taller than its room scrolls by design: what it scrolls past its top or bottom is cut there, and not measured.
 * THE WINDOW'S EDGES ARE THE VIEWPORT'S: a popover is fixed, and where the page scrolls the document's edges lie past
 * what the window shows. Opened with the pointer, at `width` × `height` in `style`; `pre` is the case's own
 * precondition on the open menu.
 */
async function holdMenu(
  style: string,
  id: string,
  width: number,
  height: number,
  pre: (menu: HTMLElement) => void | Promise<void> = () => {},
): Promise<void> {
  await at(width, height, style)
  const menu = menuOfId(id)
  await userEvent.click(buttonOf(id))
  try {
    await until(() => menu.matches(':popover-open'), `${id}’s menu open`)
    await frames()
    expect(menu.matches(':popover-open'), 'precondition: the menu is open').toBe(true)
    const items = itemsIn(menu)
    expect(items.length, 'precondition: items measured in the menu').toBeGreaterThan(0)
    if (id === 'settings') {
      const label = document.querySelector('#format-on-blur')?.closest('label') ?? null
      expect(textMeasuredIn(items, label), 'precondition: the format checkbox’s label is measured').toBe(true)
    }
    await pre(menu)
    expect(menu.scrollWidth, 'nothing in the menu runs past its sides').toBeLessThanOrEqual(menu.clientWidth)
    const uncut = { left: false, right: false, top: false, bottom: false }
    const whole: Item = { kind: 'control', el: menu, box: rect(menu), label: id, cut: uncut }
    expect(near(`${style} · ${id}`, document.body, [whole, ...items], () => ['viewport'])).toEqual([])
  } finally {
    menu.hidePopover()
  }
}

/**
 * The windows every header menu opens in: a tall phone; the narrowest, where the widest menus are wider than the room
 * beside their buttons; one short enough that a menu can be taller than the room below its button; and two between a
 * phone and a desktop, where the buffers list is too wide to open either way from its button.
 */
const MENU_WINDOWS = [
  [390, 844],
  [320, 568],
  [390, 500],
  [480, 844],
  [600, 844],
] as const

describe('every header menu', () => {
  it.each(
    STYLE_IDS.flatMap((style) =>
      MENU_WINDOWS.flatMap(([w, h]) => HEADER_MENUS.map((id) => [style, w, h, id] as const)),
    ),
  )('in %s at %i × %i, %s’s stands 4 px from the window’s edges with its content inside it', (style, w, h, id) =>
    holdMenu(style, id, w, h),
  )
})

/**
 * A MENU TALLER THAN THE ROOM BELOW ITS BUTTON IS HELD TO THAT ROOM AND SCROLLS, and a Tab onto an item it has scrolled
 * out of sight brings the item into view, so every item stays in reach of the keyboard. The examples menu in
 * Instrument, whose bundled font wraps its descriptions the same on every machine, in a window where it is taller than
 * the room below its button. The precondition reads the content's height, which the cap leaves alone; that the menu
 * then scrolls is the cap's work, so it is asserted.
 */
describe('a header menu taller than its room', () => {
  it('scrolls inside its gutter, and a Tab brings its last item into view', () =>
    holdMenu('instrument', 'examples', 390, 420, async (menu) => {
      expect(
        menu.scrollHeight,
        'precondition: the menu’s content is taller than the room below its button',
      ).toBeGreaterThan(innerHeight - rect(buttonOf('examples')).bottom)
      expect(menu.scrollHeight, 'the menu scrolls what does not fit').toBeGreaterThan(menu.clientHeight)
      const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')]
      const last = buttons[buttons.length - 1] as HTMLButtonElement
      expect(rect(last).bottom, 'the last item starts out of sight, at least in part').toBeGreaterThan(
        clientEdges(menu).bottom + 0.5,
      )
      expect(document.activeElement, 'precondition: the menu’s first item has the focus').toBe(buttons[0])
      for (let i = 1; i < buttons.length; i += 1) await userEvent.tab()
      expect(document.activeElement, 'the Tabs reach the last item').toBe(last)
      await frames()
      const view = clientEdges(menu)
      expect(rect(last).top, 'the last item’s top is in view').toBeGreaterThanOrEqual(view.top - 0.5)
      expect(rect(last).bottom, 'the last item’s bottom is in view').toBeLessThanOrEqual(view.bottom + 0.5)
    }))
})

/**
 * Whether settings, opened at the window's present width, opens rightward from its button's left edge and reaches
 * within `var(--space-2)` of the window's end edge, so that the window, not the menu's content, sets its width.
 */
async function settingsFillsRightward(): Promise<boolean> {
  const menu = menuOfId('settings')
  buttonOf('settings').click()
  try {
    await frames()
    const box = rect(menu)
    return (
      Math.abs(box.left - rect(buttonOf('settings')).left) < 0.05 && box.right >= innerWidth - space('--space-2') - 0.5
    )
  } finally {
    menu.hidePopover()
  }
}

/** The window widths scanned for settings opening rightward, and the step between them. */
const RIGHTWARD_SCAN = { from: 240, to: 360, step: 2 } as const

/**
 * SETTINGS OPENED RIGHTWARD, its button wrapped too far left to open leftward, in Instrument: its text is in Inter,
 * and the `▾` and `◐` Inter lacks are in STIX Two Math, both of which the app ships, so its header wraps the same on
 * every machine, where Terminal's `ui-monospace` does not. The width is found here rather than fixed, so that the case
 * rests on no one width of the header's buttons: the middle of the first run of widths in `RIGHTWARD_SCAN` where
 * settings opens rightward and the window sets its width. There its gutter holds it clear.
 */
describe('the settings menu, opened rightward', () => {
  it('stands 4 px from the window’s edges in instrument, at a width where it opens rightward', async () => {
    await at(RIGHTWARD_SCAN.from, 844, 'instrument')
    const run: number[] = []
    for (let w = RIGHTWARD_SCAN.from; w <= RIGHTWARD_SCAN.to; w += RIGHTWARD_SCAN.step) {
      await page.viewport(w, 844)
      await until(() => innerWidth === w, `the window at ${w} px`)
      if (await settingsFillsRightward()) run.push(w)
      else if (run.length > 0) break
    }
    expect(run, `precondition: settings opens rightward somewhere in ${JSON.stringify(RIGHTWARD_SCAN)}`).not.toEqual([])
    const width = run[Math.floor(run.length / 2)] as number
    await holdMenu('instrument', 'settings', width, 844, (menu) => {
      expect(rect(menu).left, 'precondition: settings opens rightward from its button’s left edge').toBeCloseTo(
        rect(buttonOf('settings')).left,
        1,
      )
      expect(
        rect(menu).right,
        'precondition: the window, not its content, sets the menu’s width',
      ).toBeGreaterThanOrEqual(innerWidth - space('--space-2') - 0.5)
    })
  })
})

/**
 * How near the window's left or right edge the menu `id` opens at the window's present width with its own margins taken
 * away, where it then opens from an edge of its button: where it would stand there without its gutter, to 0.1 px as
 * `holdMenu` measures it, so that the two agree on which side of `THRESHOLD` it falls. `null` where it opens elsewhere,
 * by a fallback or the browser's shift. The margins are given back before this returns.
 */
async function gapBesideButtonWithoutGutter(id: string): Promise<number | null> {
  const menu = menuOfId(id)
  menu.style.margin = '0'
  buttonOf(id).click()
  try {
    await until(() => menu.matches(':popover-open'), `${id}’s menu open`)
    await frames()
    const box = rect(menu)
    const button = rect(buttonOf(id))
    if (Math.abs(box.left - button.left) > 0.05 && Math.abs(box.right - button.right) > 0.05) return null
    const uncut = { left: false, right: false, top: false, bottom: false }
    const whole: Item = { kind: 'control', el: menu, box, label: id, cut: uncut }
    return Math.min(gap(whole, 'viewport', 'left'), gap(whole, 'viewport', 'right'))
  } finally {
    menu.hidePopover()
    menu.style.removeProperty('margin')
  }
}

/** Each menu that takes a gutter on the side it grows towards, and the window widths scanned for it, 1 px apart. */
const GUTTER_SCANS = [
  ['about', 200, 220],
  ['buffers', 306, 330],
] as const

/**
 * A MENU THAT FITS BESIDE ITS BUTTON WITH LESS THAN `THRESHOLD` TO SPARE IS HELD CLEAR OF THE WINDOW'S EDGE BY ITS
 * GUTTER, which takes it off that placement. In Instrument, for the reason the settings case above gives: system faces
 * put the header's buttons elsewhere on each machine, so a case in another style finds such a width on some machines
 * and not on others. The width is found here: the middle of the first run of widths in the menu's scan where, its
 * margins taken away, it opens from an edge of its button within `THRESHOLD` of a side edge of the window. About's run
 * lies below 320 px, where it opens rightward from a button too near the left edge to open leftward.
 */
describe('a header menu with less than the threshold to spare beside its button', () => {
  it.each(GUTTER_SCANS)(
    '%s’s stands 4 px from the window’s edges in instrument, at a width where its gutter holds it',
    async (id, from, to) => {
      await at(from, 844, 'instrument')
      const run: number[] = []
      for (let w = from; w <= to; w += 1) {
        await page.viewport(w, 844)
        await until(() => innerWidth === w, `the window at ${w} px`)
        const gap = await gapBesideButtonWithoutGutter(id)
        if (gap !== null && gap < THRESHOLD) run.push(w)
        else if (run.length > 0) break
      }
      expect(
        run,
        `precondition: without its gutter, ${id}’s menu opens beside its button within ${THRESHOLD} px of an edge`,
      ).not.toEqual([])
      await holdMenu('instrument', id, run[Math.floor(run.length / 2)] as number, 844)
    },
  )
})

describe('every text run and control stands 4 px from its pane’s edges and the window’s', () => {
  it('at 1600 × 1000', async () => {
    await at(1600, 1000, DEFAULT_STYLE)
    assertMeasured()
    expect(contacts()).toEqual([])
  })

  // TERMINAL AS WELL AS THE DEFAULT STYLE: its monospace is wider, so its rows wrap and fill differently.
  it.each([DEFAULT_STYLE, 'terminal'])(
    'at 390 × 844 in %s, below the 30rem breakpoint, with a header wrapped onto several rows',
    async (style) => {
      await at(390, 844, style)
      expect(innerWidth, 'precondition: narrower than 30rem').toBeLessThan(30 * rem())
      expect(someHeaderWraps(), 'precondition: some view’s header wraps').toBe(true)
      assertMeasured()
      expect(contacts()).toEqual([])
    },
  )

  it('at 1600 × 1000 with a TM copy and an rxm copy, each showing its value', async () => {
    await at(1600, 1000, DEFAULT_STYLE)
    for (const leaf of ['tm-0', 'rxm-0']) {
      const pane = paneByLeaf(leaf)
      await pick(pane, 'detach')
      await until(() => editorOf(pane) !== null, `the ${leaf} copy’s editor`)
    }
    const value = (sel: string) => (document.querySelector(sel)?.textContent ?? '').startsWith('value:')
    await until(() => value('.tm-value'), 'the TM copy’s value')
    await until(() => value('.rxm-value'), 'the rxm copy’s value')
    await frames()
    const items = assertMeasured()
    for (const sel of ['.tm-value', '.rxm-value'])
      expect(textMeasuredIn(items, document.querySelector(sel)), `precondition: ${sel} is measured`).toBe(true)
    expect(contacts()).toEqual([])
  })
})
