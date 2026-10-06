import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { DIVIDER_PX } from '../../src/layout-view'
import { parseWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **AT A PHONE'S WIDTH THE INSPECTOR STACKS UNDER THE VIEWS** — the user's decisions of 2026-10-05. At the header's
 * breakpoint, 480 px and under, while the inspector is on the page, `main` is a column: the views full width on top,
 * the inspector full width under them, one 1 px rule between them, its header's. An open inspector is at most 40% of
 * `main`'s height and its rows scroll inside it; a closed one is its header line. `main` is at least 15rem tall:
 * above that the page grows neither taller nor wider, and below it the page scrolls, as it did side by side. Side by
 * side, the inspector kept 288 px at every width, so at 390 px in Debugger `#views` was 102 px and each default view 45
 * px wide, and on the Stage the tab strip was 102 px.
 *
 * **WHERE IT DOES NOT STACK NOTHING MOVES**: every box is held to what `53ecbfa` drew, measured there before the change
 * — in Debugger and on the Stage, open and closed, at 1280×800 and 481×800; and, at a phone's width, in Explorer and on
 * the Stage with the strip readout, the two layouts with no inspector, at 390×844, 320×568, 320×400 and 320×320.
 *
 * Every gesture is real input (`userEvent`). ONE MOUNT FOR THE FILE, for the reason every sibling gives; each case
 * starts by setting its page size and its workspace, chosen afresh or settled, and opening or closing the inspector,
 * and asserts that state before it measures, so none depends on what the case before it left.
 */

type Preset = 'debugger' | 'stage' | 'explorer'
/** A workspace a case runs in: a preset, or a preset with the readout switch moved, which the menu calls `custom`. */
type Workspace = Preset | 'stage-strip' | 'explorer-inspector'
/** A box as `[left, top, width, height]`, in CSS pixels. */
type Box = readonly [number, number, number, number]

const q = (sel: string) => document.querySelector<HTMLElement>(sel) as HTMLElement
const box = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return [r.left, r.top, r.width, r.height]
}
const bottom = (el: Element) => el.getBoundingClientRect().bottom
const main = () => q('main')
const views = () => q('#views')
const inspector = () => q('#inspector')
const header = () => q('#inspector .panel-header')
const body = () => q('#inspector .inspector-body')
const toggle = () => q('#inspector .panel-toggle') as HTMLButtonElement
const stepBar = () => q('#step-bar')
const isOpen = () => toggle().getAttribute('aria-expanded') === 'true'
/** The view hosts on the page — every `[data-leaf]` under `#views` but a Stage's tabs, which carry one too. */
const hosts = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')].filter((el) => el.getAttribute('role') !== 'tab')
const workspaceMenu = () => q('#workspace-menu')
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const stored = () => parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))
/** `main`'s minimum height, as the page resolves it. */
const minimum = () => Number.parseFloat(getComputedStyle(main()).minHeight)
const name = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${[...el.classList].join('.')}`

/** Each workspace: its preset, the readout switch it moves, the name the workspace button gives it, its inspector. */
const WORKSPACES: Readonly<
  Record<Workspace, { preset: Preset; readout?: 'strip' | 'inspector'; name: string; inspector: boolean }>
> = {
  debugger: { preset: 'debugger', name: 'Debugger', inspector: true },
  stage: { preset: 'stage', name: 'Stage', inspector: true },
  explorer: { preset: 'explorer', name: 'Explorer', inspector: false },
  'stage-strip': { preset: 'stage', readout: 'strip', name: 'custom', inspector: false },
  'explorer-inspector': { preset: 'explorer', readout: 'inspector', name: 'custom', inspector: true },
}

/** Pick `selector` from the workspace menu with the pointer, and shut the menu, which a pick leaves open. */
async function pick(selector: string): Promise<void> {
  if (workspaceMenu().matches(':popover-open')) await userEvent.keyboard('{Escape}')
  await userEvent.click(q('#workspace'))
  await until(() => workspaceMenu().matches(':popover-open'), 'the workspace menu')
  await userEvent.click(workspaceMenu().querySelector(selector) as HTMLElement)
  if (workspaceMenu().matches(':popover-open')) await userEvent.keyboard('{Escape}')
}

/**
 * Put the page in workspace `w`, **CHOSEN AFRESH, SO THE NOTICE LINE IS UP**: the last pick says so on the notice line
 * for 8 s, and the line is a box above `main`. Picking what is already in force says nothing, so another preset is
 * picked first.
 */
async function choose(w: Workspace): Promise<void> {
  const { preset, readout } = WORKSPACES[w]
  await pick(`[data-preset="${preset === 'explorer' ? 'debugger' : 'explorer'}"]`)
  await pick(`[data-preset="${preset}"]`)
  if (readout !== undefined) await pick(`[data-switch="readout"][data-value="${readout}"]`)
}

/** Put the page in workspace `w` and wait the notice line out, in a hook: what a user sees 8 s after the pick. */
async function settle(w: Workspace): Promise<void> {
  await choose(w)
  await until(() => q('#notice').hidden === true, 'the notice line to go')
}

/** Press the inspector's toggle with the pointer until it is `open`. */
async function setOpen(open: boolean): Promise<void> {
  if (isOpen() !== open) await userEvent.click(toggle())
  expect(isOpen(), `precondition: the inspector is ${open ? 'open' : 'closed'}`).toBe(open)
}

/**
 * Put the page at `width` by `height` in workspace `w` with the inspector `open` or closed (`null`: not on the page),
 * the notice line `up` (`w` chosen afresh) or `gone` (`w` settled by the caller's hook) — and **ASSERT THAT STATE**
 * before anything is measured.
 */
async function at(
  w: Workspace,
  width: number,
  height: number,
  open: boolean | null,
  notice: 'up' | 'gone' = 'up',
): Promise<void> {
  await page.viewport(width, height)
  if (notice === 'up') await choose(w)
  expect(innerWidth, 'precondition: the page’s width').toBe(width)
  expect(innerHeight, 'precondition: the page’s height').toBe(height)
  const { name: called, inspector: shown } = WORKSPACES[w]
  expect(q('#workspace').textContent?.replace('▾', '').trim(), 'precondition: the workspace').toBe(called)
  if (notice === 'up')
    expect(noticeText().startsWith(`${called} — `), `precondition: the pick’s notice is up: ${noticeText()}`).toBe(true)
  else expect(q('#notice').hidden, 'precondition: the notice line is gone').toBe(true)
  expect(inspector().hidden, `precondition: the inspector is ${shown ? '' : 'not '}on the page`).toBe(!shown)
  if (open !== null) await setOpen(open)
  if (WORKSPACES[w].preset === 'stage')
    expect(
      hosts().map((h) => h.dataset.leaf),
      'precondition: the Stage shows λ',
    ).toEqual(['lambda-0'])
  else expect(hosts().length, 'precondition: the default four views').toBe(4)
}

/**
 * The lines drawn between the views and the inspector, as `[box, px]`: the bottom border of each box that makes up
 * `#views` — `#views`, its splits, dividers and Stage, and each view's own box — that ends where the inspector starts,
 * and the top border of the inspector, its panel and its header; each border that draws, with a width, a style and a
 * colour that is not transparent. **ONE LINE, 1 PX, THE HEADER'S** — the user's decision; the inspector's own top
 * border beside it made 2 px. What a view draws inside its box is the view's: in Explorer with the readout switch at
 * `inspector`, closed, at 390×844, the asm view's `registers` panel header ends on that edge, and its own 1 px bottom
 * border lies on the rule there.
 */
function rulesBetween(): [string, number][] {
  const edge = box(inspector())[1]
  const drawn = (el: Element, side: 'Top' | 'Bottom'): number => {
    const s = getComputedStyle(el)
    const px = Number.parseFloat(s[`border${side}Width`])
    const colour = s[`border${side}Color`]
    const clear = colour === 'transparent' || /^rgba\(.*,\s*0\)$/.test(colour)
    return s[`border${side}Style`] === 'none' || clear ? 0 : px
  }
  const out: [string, number][] = []
  const frame = [views(), ...views().querySelectorAll('*')].filter(
    (el) => el.parentElement?.closest('[data-leaf]') == null,
  )
  for (const el of frame) {
    const r = el.getBoundingClientRect()
    if (r.height > 0 && Math.abs(r.bottom - edge) <= 0.5 && drawn(el, 'Bottom') > 0)
      out.push([name(el), drawn(el, 'Bottom')])
  }
  for (const el of [inspector(), q('#inspector > .panel'), header()])
    if (Math.abs(el.getBoundingClientRect().top - edge) <= 0.5 && drawn(el, 'Top') > 0)
      out.push([name(el), drawn(el, 'Top')])
  return out
}

/**
 * Every box under `main` with an area that no scroll container inside `main` clips — what can be drawn past `main`. A
 * scroll container is counted, and what it holds is not: it clips that to its own box.
 */
function drawnInMain(): Element[] {
  const out: Element[] = []
  const walk = (el: Element): void => {
    for (const child of el.children) {
      const r = child.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) out.push(child)
      const s = getComputedStyle(child)
      if (s.overflowX === 'visible' && s.overflowY === 'visible') walk(child)
    }
  }
  walk(main())
  return out
}

beforeAll(async () => {
  await page.viewport(1280, 800)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => q('#results').dataset.state === 'idle', 'the first compile')
})

/** The phone sizes the stacked cases run at, and 480 px, the breakpoint's own width, where the rule still holds. */
const PHONES = [
  [390, 844],
  [320, 568],
  [480, 800],
] as const

/**
 * The stacked inspector's geometry, open or closed, in workspace `w` at a page `width` by `height` above `main`'s
 * minimum. Every assertion is soft, so a red run names each property that fails; the wheel's wait comes last, because
 * a wait that never ends throws.
 */
async function holdStacked(w: Workspace, width: number, height: number, open: boolean): Promise<void> {
  const [mx, my, mw, mh] = box(main())
  const [vx, vy, vw, vh] = box(views())
  const [ix, iy, iw, ih] = box(inspector())
  expect.soft(Math.abs(vx - mx), '#views’ left against main’s').toBeLessThanOrEqual(1)
  expect.soft(Math.abs(vw - mw), `#views’ width, ${vw}, against main’s, ${mw}`).toBeLessThanOrEqual(1)
  expect.soft(Math.abs(vy - my), '#views’ top against main’s').toBeLessThanOrEqual(1)
  expect.soft(iy, 'the inspector’s top, under #views’ bottom').toBeGreaterThanOrEqual(vy + vh - 0.5)
  expect.soft(Math.abs(ix - mx), 'the inspector’s left against main’s').toBeLessThanOrEqual(1)
  expect.soft(Math.abs(iw - mw), `the inspector’s width, ${iw}, against main’s, ${mw}`).toBeLessThanOrEqual(1)
  expect.soft(iy + ih, 'the inspector’s bottom, inside main').toBeLessThanOrEqual(my + mh + 0.5)
  const rules = rulesBetween()
  expect.soft(box(header())[0] - ix, 'the inspector’s side, where it draws no rule').toBeCloseTo(0, 1)
  expect
    .soft(rules, `the lines between the views and the inspector: ${JSON.stringify(rules)}`)
    .toEqual([['div.panel-header', 1]])
  expect.soft(mh, `main’s height, above its minimum, ${minimum()}`).toBeGreaterThan(minimum())
  expect.soft(document.documentElement.scrollWidth, 'the page’s scroll width').toBeLessThanOrEqual(width)
  expect.soft(document.documentElement.scrollHeight, 'the page’s scroll height').toBeLessThanOrEqual(height)
  if (WORKSPACES[w].preset === 'stage')
    expect.soft(Math.abs(box(q('.stage-tabs'))[2] - mw), 'the tab strip’s width').toBeLessThanOrEqual(1)
  else
    for (const h of hosts())
      expect
        .soft(Math.abs(box(h)[2] - (mw - DIVIDER_PX) / 2), `${h.dataset.leaf}’s width, ${box(h)[2]}`)
        .toBeLessThanOrEqual(0.5)
  if (!open) {
    expect
      .soft(Math.abs(ih - box(header())[3]), `the closed inspector’s height, ${ih}, against its header’s`)
      .toBeLessThanOrEqual(0.5)
    expect.soft(Math.abs(vh + ih - mh), `#views’ height, ${vh}, and the inspector’s fill main’s`).toBeLessThanOrEqual(1)
    return
  }
  expect.soft(ih, `the open inspector’s height against 40% of main’s, ${mh}`).toBeLessThanOrEqual(0.4 * mh + 0.5)

  // THE ROWS SCROLL INSIDE IT, UNDER A REAL WHEEL: they overflow the body, and a wheel over them takes the body to its
  // end — so the last row is in view — while the inspector and the page stay where they were. Rows that do not
  // overflow have already failed above, and a wheel over them would only wait out `until`.
  const rows = body()
  const overflows = rows.scrollHeight > rows.clientHeight
  expect.soft(overflows, `the rows overflow the inspector: ${rows.scrollHeight} in ${rows.clientHeight}`).toBe(true)
  if (!overflows) return
  const before = box(inspector())
  await userEvent.wheel(rows, { delta: { y: rows.scrollHeight } })
  await until(() => rows.scrollTop + rows.clientHeight >= rows.scrollHeight - 1, 'the rows’ end, under the wheel')
  expect.soft(box(inspector()), 'the inspector, after its rows scrolled').toEqual(before)
  expect.soft(scrollY, 'the page’s scroll').toBe(0)
  rows.scrollTop = 0
}

describe('at a phone’s width the inspector stacks under the views', () => {
  /**
   * **ITS OPEN AND CLOSED STATE WORKS AS IT DOES SIDE BY SIDE**: the toggle, pressed at 390 px, closes the inspector to
   * its header and the workspace stores that, and pressed again opens it to the height it had and stores that. **FIRST
   * IN THE FILE**, so the height it had is the one the page opened with, before any press closed and reopened it: a
   * reopening that left the rows hidden would otherwise be compared with itself.
   */
  it('closes and opens with its toggle at 390 px, and the workspace keeps the state', async () => {
    await at('debugger', 390, 844, true)
    const open = box(inspector())[3]
    await userEvent.click(toggle())
    expect(isOpen(), 'the first press closed it').toBe(false)
    expect(stored()?.inspector, 'the workspace stored the inspector closed').toBe(false)
    expect.soft(box(inspector())[3], 'closed, shorter than open').toBeLessThan(open)
    expect.soft(Math.abs(box(inspector())[3] - box(header())[3]), 'closed, its header alone').toBeLessThan(0.5)
    await userEvent.click(toggle())
    expect(isOpen(), 'the second press opened it').toBe(true)
    expect(stored()?.inspector, 'the workspace stored the inspector open').toBe(true)
    expect.soft(box(inspector())[3], 'open again, as tall as before').toBeCloseTo(open, 1)
  })

  /**
   * **THE VIEWS ARE `main`'S WIDTH, AND THE INSPECTOR IS UNDER THEM AND AS WIDE.** On `53ecbfa` at 390 px in Debugger
   * `#views` was 102 px wide and each default view 45 px, beside a 288 px inspector; under the stack each view is as
   * wide as Explorer's at the same width, `main`'s width less one divider, halved. **AN OPEN INSPECTOR IS AT MOST 40%
   * OF `main`'S HEIGHT AND SCROLLS ITS OWN ROWS**: the rows overflow it at every size here, and a real wheel over them
   * takes them to their end, moving neither the inspector nor the page. **A CLOSED ONE IS ITS HEADER LINE**, and the
   * views take the rest of `main`: the cap is on an open inspector's height, not a share of `main` that a closed one
   * would leave empty. At each of these sizes, with this file's program and the pick's notice up, `main` is above its
   * minimum and the page does not scroll; on `53ecbfa` at 320×568 the open inspector's rows made the page 819 px tall.
   */
  describe.each(['debugger', 'stage'] as const)('in %s', (p) => {
    describe.each(['open', 'closed'] as const)('%s', (state) => {
      it.each(PHONES)('at %i×%i px', async (width, height) => {
        await at(p, width, height, state === 'open')
        await holdStacked(p, width, height, state === 'open')
      })
    })
  })

  /**
   * **THE READOUT SWITCH STACKS IT TOO**: Explorer with the readout at `inspector` puts the inspector on the page as
   * the two presets do, and at 390 px it stacks under Explorer's four views.
   */
  it.each(['open', 'closed'] as const)(
    'in explorer with the readout switch at inspector, %s, at 390×844 px',
    async (state) => {
      await at('explorer-inspector', 390, 844, state === 'open')
      await holdStacked('explorer-inspector', 390, 844, state === 'open')
    },
  )
})

/**
 * Every box `53ecbfa` drew, as `[left, top, width, height]`, measured there before the change with the preset's
 * notice up: `main`, `#views`, the inspector, its header and (open) its body, the Stage's tab strip, and each view on
 * the page.
 */
const BEFORE: Readonly<Record<string, Readonly<Record<string, Box>>>> = {
  'debugger@1280x800 open': {
    main: [0, 74.5, 1280, 678.5],
    views: [0, 74.5, 992, 678.5],
    inspector: [992, 74.5, 288, 678.5],
    header: [993, 74.5, 287, 28],
    body: [993, 102.5, 287, 650.5],
    source: [0, 74.5, 490, 333.25],
    'lambda-0': [502, 74.5, 490, 333.25],
    'asm-0': [0, 419.75, 490, 333.25],
    'tm-0': [502, 419.75, 490, 333.25],
  },
  'debugger@1280x800 closed': {
    main: [0, 74.5, 1280, 678.5],
    views: [0, 74.5, 992, 678.5],
    inspector: [992, 74.5, 288, 678.5],
    header: [993, 74.5, 287, 28],
    source: [0, 74.5, 490, 333.25],
    'lambda-0': [502, 74.5, 490, 333.25],
    'asm-0': [0, 419.75, 490, 333.25],
    'tm-0': [502, 419.75, 490, 333.25],
  },
  'debugger@481x800 open': {
    main: [0, 164.5, 481, 588.5],
    views: [0, 164.5, 193, 588.5],
    inspector: [193, 164.5, 288, 588.5],
    header: [194, 164.5, 287, 28],
    body: [194, 192.5, 287, 560.5],
    source: [0, 164.5, 90.5, 288.25],
    'lambda-0': [102.5, 164.5, 90.5, 288.25],
    'asm-0': [0, 464.75, 90.5, 288.25],
    'tm-0': [102.5, 464.75, 90.5, 288.25],
  },
  'debugger@481x800 closed': {
    main: [0, 164.5, 481, 588.5],
    views: [0, 164.5, 193, 588.5],
    inspector: [193, 164.5, 288, 588.5],
    header: [194, 164.5, 287, 28],
    source: [0, 164.5, 90.5, 288.25],
    'lambda-0': [102.5, 164.5, 90.5, 288.25],
    'asm-0': [0, 464.75, 90.5, 288.25],
    'tm-0': [102.5, 464.75, 90.5, 288.25],
  },
  'stage@1280x800 open': {
    main: [0, 74.5, 1280, 678.5],
    views: [0, 74.5, 992, 678.5],
    inspector: [992, 74.5, 288, 678.5],
    header: [993, 74.5, 287, 28],
    body: [993, 102.5, 287, 650.5],
    tabs: [0, 74.5, 992, 30.5],
    'lambda-0': [0, 105, 992, 648],
  },
  'stage@1280x800 closed': {
    main: [0, 74.5, 1280, 678.5],
    views: [0, 74.5, 992, 678.5],
    inspector: [992, 74.5, 288, 678.5],
    header: [993, 74.5, 287, 28],
    tabs: [0, 74.5, 992, 30.5],
    'lambda-0': [0, 105, 992, 648],
  },
  'stage@481x800 open': {
    main: [0, 164.5, 481, 588.5],
    views: [0, 164.5, 193, 588.5],
    inspector: [193, 164.5, 288, 588.5],
    header: [194, 164.5, 287, 28],
    body: [194, 192.5, 287, 560.5],
    tabs: [0, 164.5, 193, 50],
    'lambda-0': [0, 214.5, 193, 538.5],
  },
  'stage@481x800 closed': {
    main: [0, 164.5, 481, 588.5],
    views: [0, 164.5, 193, 588.5],
    inspector: [193, 164.5, 288, 588.5],
    header: [194, 164.5, 287, 28],
    tabs: [0, 164.5, 193, 50],
    'lambda-0': [0, 214.5, 193, 538.5],
  },
  'explorer@390x844': {
    main: [0, 164.5, 390, 610.25],
    views: [0, 164.5, 390, 610.25],
    source: [0, 164.5, 189, 299.125],
    'lambda-0': [201, 164.5, 189, 299.125],
    'asm-0': [0, 475.625, 189, 299.125],
    'tm-0': [201, 475.625, 189, 299.125],
  },
  'explorer@320x568': {
    main: [0, 229, 320, 246.25],
    views: [0, 229, 320, 246.25],
    source: [0, 229, 154, 117.125],
    'lambda-0': [166, 229, 154, 117.125],
    'asm-0': [0, 358.125, 154, 117.125],
    'tm-0': [166, 358.125, 154, 117.125],
  },
}

/** The boxes `BEFORE` names, as the page draws them now. */
function boxesNow(open: boolean | null): Record<string, Box> {
  const now: Record<string, Box> = { main: box(main()), views: box(views()) }
  if (open !== null) {
    now.inspector = box(inspector())
    now.header = box(header())
    if (open) now.body = box(body())
  }
  const tabs = document.querySelector('.stage-tabs')
  if (tabs !== null) now.tabs = box(tabs)
  for (const h of hosts()) now[h.dataset.leaf as string] = box(h)
  return now
}

/** Each of `now`'s boxes against `want`'s, every edge to 0.5 px, soft, so a red run names each box that moved. */
function holdBoxes(now: Record<string, Box>, want: Readonly<Record<string, Box>>): void {
  expect(Object.keys(now).sort(), 'the boxes on the page').toEqual(Object.keys(want).sort())
  for (const [name, w] of Object.entries(want)) {
    const n = now[name] as Box
    const moved = n.some((v, i) => Math.abs(v - (w[i] as number)) > 0.5)
    expect.soft(moved ? n : w, `${name}: [left, top, width, height]`).toEqual(w)
  }
}

describe('nothing moves where the inspector does not stack: at 481 px and wider, and in explorer', () => {
  describe.each(['debugger', 'stage'] as const)('in %s', (p) => {
    it.each([
      [1280, 800, 'open'],
      [1280, 800, 'closed'],
      [481, 800, 'open'],
      [481, 800, 'closed'],
    ] as const)('at %i×%i px, %s, every box is where 53ecbfa drew it', async (width, height, state) => {
      await at(p, width, height, state === 'open')
      holdBoxes(boxesNow(state === 'open'), BEFORE[`${p}@${width}x${height} ${state}`] ?? {})
    })
  })

  /** **EXPLORER, WHOSE INSPECTOR IS HIDDEN, DOES NOT MOVE AT A PHONE'S WIDTH.** */
  it.each([
    [390, 844],
    [320, 568],
  ] as const)('in explorer at %i×%i px, every box is where 53ecbfa drew it', async (width, height) => {
    await at('explorer', width, height, null)
    holdBoxes(boxesNow(null), BEFORE[`explorer@${width}x${height}`] ?? {})
  })
})

/**
 * The short pages the stacked cases run at, each with whether `main` is at its minimum there in Debugger and on the
 * Stage, by the notice: measured, `main` would be 199.63 px at 320×500 with the notice up and 247.63 with it gone, so
 * 320×500 is the one short page above 15rem.
 */
const SHORT_STACKED = [
  [320, 500, 'up', true],
  [320, 400, 'up', true],
  [320, 320, 'up', true],
  [320, 500, 'gone', false],
  [320, 400, 'gone', true],
  [320, 320, 'gone', true],
] as const

/** The short pages the no-inspector layouts are held at. */
const SHORT = [
  [320, 400, 'up'],
  [320, 320, 'up'],
  [320, 400, 'gone'],
  [320, 320, 'gone'],
] as const

/** `main`'s minimum at a phone's width, the user's decision: 15rem, in pixels as the page resolves a rem. */
const MINIMUM = () => 15 * Number.parseFloat(getComputedStyle(document.documentElement).fontSize)

/**
 * The whole lines of a view's content it shows below its header: the distinct tops of the text-bearing boxes under `h`
 * and outside its header that lie wholly between the header's bottom and the bottom of the part of `h` on the page.
 */
function linesShown(h: HTMLElement): number {
  const head = h.querySelector('.view-header') as HTMLElement
  const floor = Math.min(bottom(h), bottom(views()))
  const tops = [...h.querySelectorAll<HTMLElement>('*')]
    .filter((el) => !head.contains(el) && el.children.length === 0 && (el.textContent ?? '').trim() !== '')
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.height > 0 && r.top >= bottom(head) - 0.5 && r.bottom <= floor + 0.5)
    .map((r) => Math.round(r.top))
  return new Set(tops).size
}

/**
 * The stacked inspector, open or closed, on a short page. **NOTHING IN `main` IS DRAWN PAST THE STEP BAR'S TOP**; the
 * inspector's header is whole, and so is a view's — on the Stage the shown view's, in tiles some view's — and **SOME
 * VIEW SHOWS A WHOLE LINE OF ITS CONTENT BELOW ITS HEADER**, the user's reason for 15rem. Where the case says `main` is
 * at its minimum it is 15rem and the page scrolls; where it says above, the page does not.
 */
function holdShort(p: 'debugger' | 'stage', open: boolean, atMinimum: boolean): void {
  const [, , , mh] = box(main())
  const [, , , ih] = box(inspector())
  const past = drawnInMain()
    .filter((el) => bottom(el) > box(stepBar())[1] + 0.5)
    .map(name)
  expect.soft(past, 'boxes in main drawn past the step bar’s top').toEqual([])
  expect.soft(Math.abs(mh - minimum()) <= 0.5, `main at its minimum: ${mh} against ${minimum()}`).toBe(atMinimum)
  if (atMinimum) {
    expect.soft(mh, 'main at its minimum, 15rem').toBeCloseTo(MINIMUM(), 1)
    expect
      .soft(document.documentElement.scrollHeight, 'the page’s scroll height, main at its minimum')
      .toBeGreaterThan(innerHeight)
  } else
    expect
      .soft(document.documentElement.scrollHeight, 'the page’s scroll height, main above its minimum')
      .toBeLessThanOrEqual(innerHeight)
  expect.soft(bottom(header()), 'the inspector’s header, whole').toBeLessThanOrEqual(bottom(inspector()) + 0.5)
  const headerWhole = (h: HTMLElement) =>
    bottom(h.querySelector('.view-header') as Element) <= Math.min(bottom(h), bottom(views())) + 0.5
  if (p === 'stage') expect.soft(headerWhole(hosts()[0] as HTMLElement), 'the shown view’s header, whole').toBe(true)
  else expect.soft(hosts().some(headerWhole), 'a view’s header, whole').toBe(true)
  const lines = hosts().map(linesShown)
  expect
    .soft(Math.max(...lines), `whole lines of content below a view’s header, by view: ${JSON.stringify(lines)}`)
    .toBeGreaterThanOrEqual(1)
  if (open) {
    expect.soft(ih, 'the open inspector, taller than its header').toBeGreaterThan(box(header())[3] + 0.5)
    expect.soft(ih, `the open inspector’s height against 40% of main’s, ${mh}`).toBeLessThanOrEqual(0.4 * mh + 0.5)
  } else
    expect
      .soft(Math.abs(ih - box(header())[3]), `the closed inspector’s height, ${ih}, against its header’s`)
      .toBeLessThanOrEqual(0.5)
}

/**
 * The boxes a short page draws with no inspector: `main`, `#views`, the Stage's tab strip, each view, the step bar and
 * the strip when on the page, and the page's own scroll size as `[0, 0, width, height]`.
 */
function pageBoxes(): Record<string, Box> {
  const now = boxesNow(null)
  if (!stepBar().hidden) now.step = box(stepBar())
  const strip = q('footer.strip')
  if (!strip.hidden) now.strip = box(strip)
  now.page = [0, 0, document.documentElement.scrollWidth, document.documentElement.scrollHeight]
  return now
}

/**
 * Every box `53ecbfa` drew on a short page with no inspector, measured there before the change by a probe with
 * `pageBoxes`, the notice up or gone.
 */
const SHORT_BEFORE: Readonly<Record<string, Readonly<Record<string, Box>>>> = {
  'stage-strip@320x400 up': {
    main: [0, 229, 320, 50],
    views: [0, 229, 320, 50],
    tabs: [0, 229, 320, 50],
    'lambda-0': [0, 279, 320, 0],
    step: [0, 279, 320, 62.375],
    strip: [0, 341.375, 320, 92.75],
    page: [0, 0, 320, 434],
  },
  'stage-strip@320x320 up': {
    main: [0, 229, 320, 50],
    views: [0, 229, 320, 50],
    tabs: [0, 229, 320, 50],
    'lambda-0': [0, 279, 320, 0],
    step: [0, 279, 320, 62.375],
    strip: [0, 341.375, 320, 92.75],
    page: [0, 0, 320, 434],
  },
  'stage-strip@320x400 gone': {
    main: [0, 181, 320, 63.875],
    views: [0, 181, 320, 63.875],
    tabs: [0, 181, 320, 50],
    'lambda-0': [0, 231, 320, 13.875],
    step: [0, 244.875, 320, 62.375],
    strip: [0, 307.25, 320, 92.75],
    page: [0, 0, 320, 400],
  },
  'stage-strip@320x320 gone': {
    main: [0, 181, 320, 50],
    views: [0, 181, 320, 50],
    tabs: [0, 181, 320, 50],
    'lambda-0': [0, 231, 320, 0],
    step: [0, 231, 320, 62.375],
    strip: [0, 293.375, 320, 92.75],
    page: [0, 0, 320, 386],
  },
  'explorer@320x400 up': {
    main: [0, 229, 320, 78.25],
    views: [0, 229, 320, 78.25],
    source: [0, 229, 154, 33.125],
    'lambda-0': [166, 229, 154, 33.125],
    'asm-0': [0, 274.125, 154, 33.125],
    'tm-0': [166, 274.125, 154, 33.125],
    strip: [0, 307.25, 320, 92.75],
    page: [0, 0, 320, 400],
  },
  'explorer@320x320 up': {
    main: [0, 229, 320, 0],
    views: [0, 229, 320, 0],
    source: [0, 229, 154, 0],
    'lambda-0': [166, 229, 154, 0],
    'asm-0': [0, 241, 154, 0],
    'tm-0': [166, 241, 154, 0],
    strip: [0, 229, 320, 92.75],
    page: [0, 0, 320, 322],
  },
  'explorer@320x400 gone': {
    main: [0, 181, 320, 126.25],
    views: [0, 181, 320, 126.25],
    source: [0, 181, 154, 57.125],
    'lambda-0': [166, 181, 154, 57.125],
    'asm-0': [0, 250.125, 154, 57.125],
    'tm-0': [166, 250.125, 154, 57.125],
    strip: [0, 307.25, 320, 92.75],
    page: [0, 0, 320, 400],
  },
  'explorer@320x320 gone': {
    main: [0, 181, 320, 46.25],
    views: [0, 181, 320, 46.25],
    source: [0, 181, 154, 17.125],
    'lambda-0': [166, 181, 154, 17.125],
    'asm-0': [0, 210.125, 154, 17.125],
    'tm-0': [166, 210.125, 154, 17.125],
    strip: [0, 227.25, 320, 92.75],
    page: [0, 0, 320, 320],
  },
}

/**
 * One short-page case: the inspector closed at a roomy height first, the page made short, the inspector checked closed,
 * its toggle pressed with the pointer, and the inspector checked open. **CLOSED BEFORE THE PAGE IS SHORT** because a
 * press on a toggle that something else covers waits, and the notice line goes while it does, which would measure the
 * page with the notice gone in a case about it up. **THE TOGGLE IS ASKED FIRST**: what lies at its centre must be the
 * toggle, and the notice line must be as it was after the press.
 */
async function shortCase(
  p: 'debugger' | 'stage',
  width: number,
  height: number,
  notice: 'up' | 'gone',
  atMinimum: boolean,
): Promise<void> {
  scrollTo(0, 0)
  await at(p, width, 844, false, notice)
  await page.viewport(width, height)
  expect(innerHeight, 'precondition: the page’s height').toBe(height)
  expect(q('#notice').hidden, `precondition: the notice line ${notice}`).toBe(notice === 'gone')
  holdShort(p, false, atMinimum)
  toggle().scrollIntoView({ block: 'nearest' })
  const t = toggle().getBoundingClientRect()
  const hit = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2)
  expect
    .soft(hit !== null && toggle().contains(hit), `what lies at the toggle’s centre: ${hit && name(hit)}`)
    .toBe(true)
  await userEvent.click(toggle())
  expect(isOpen(), 'the toggle opened it').toBe(true)
  expect(q('#notice').hidden, `precondition: the notice line still ${notice} after the press`).toBe(notice === 'gone')
  holdShort(p, true, atMinimum)
}

describe('on a short page', () => {
  /**
   * **`main` IS AT LEAST 15REM TALL, AND BELOW THAT THE PAGE SCROLLS** — the user's decision of 2026-10-05, for pages
   * 480 px wide or less and too short for the views and the inspector, as a desktop page zoomed in or a split window
   * can be, so that a short page shows more of its views than their headers. **WHAT IS HELD IS THAT SOME VIEW SHOWS A
   * WHOLE LINE OF ITS CONTENT**, not that each does: measured at 320 px wide with `main` at 240 px, Debugger's four
   * views show 1, 0, 0 and 0 whole lines with the inspector open, the three with headers on two rows having 12.22 px
   * under them, and 3, 1, 1 and 1 with it closed. With no minimum, `main` was what the page left over, so at 320×320
   * with the notice gone the cap cut a closed inspector to 27.05 px and its header ran into the step bar; with the
   * notice up an open one was 7.84 px. Each case is `shortCase`'s.
   */
  describe.each(['debugger', 'stage'] as const)('in %s', (p) => {
    it.each(SHORT_STACKED.filter(([, , notice]) => notice === 'up'))(
      'at %i×%i px, the notice %s',
      async (width, height, notice, atMinimum) => {
        await shortCase(p, width, height, notice, atMinimum)
      },
    )

    describe('the notice gone', () => {
      beforeAll(async () => {
        scrollTo(0, 0)
        await page.viewport(320, 400)
        await settle(p)
      })
      it.each(SHORT_STACKED.filter(([, , notice]) => notice === 'gone'))(
        'at %i×%i px, the notice %s',
        async (width, height, notice, atMinimum) => {
          await shortCase(p, width, height, notice, atMinimum)
        },
      )
    })
  })

  /**
   * **WITH NO INSPECTOR NOTHING MOVES ON A SHORT PAGE EITHER**: the stacking rule asks for an inspector on the page.
   * The review found `main`'s basis of 0 squeezing the Stage with the strip readout at 320×400 to 15.88 px, its tab
   * strip run onto the step bar, where `53ecbfa` drew it 50 px tall and scrolled the page.
   */
  describe.each(['stage-strip', 'explorer'] as const)('in %s, with no inspector', (w) => {
    it.each(SHORT.filter(([, , notice]) => notice === 'up'))(
      'at %i×%i px, the notice %s, every box is where 53ecbfa drew it',
      async (width, height, notice) => {
        scrollTo(0, 0)
        await at(w, width, height, null, notice)
        holdBoxes(pageBoxes(), SHORT_BEFORE[`${w}@${width}x${height} ${notice}`] ?? {})
      },
    )

    describe('the notice gone', () => {
      beforeAll(async () => {
        scrollTo(0, 0)
        await page.viewport(320, 400)
        await settle(w)
      })
      it.each(SHORT.filter(([, , notice]) => notice === 'gone'))(
        'at %i×%i px, the notice %s, every box is where 53ecbfa drew it',
        async (width, height, notice) => {
          scrollTo(0, 0)
          await at(w, width, height, null, notice)
          holdBoxes(pageBoxes(), SHORT_BEFORE[`${w}@${width}x${height} ${notice}`] ?? {})
        },
      )
    })
  })
})
