import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { SECOND_CLICK_MS } from '../../src/notice'
import { PROGRAM_STORAGE_KEY } from '../../src/program-store'
import { CHROMIUM } from './engine'
import {
  examplesButton,
  frames,
  hosts,
  isShown,
  noticeEl,
  noticeElText,
  presetOf,
  resultsText,
  SHELL,
  space,
  stateIdle,
  undoButton,
  until,
} from './harness'

/**
 * **A NOTICE FLOATS OVER THE PAGE, SO NOTHING ON IT MOVES** — the notice float design
 * (`docs/superpowers/specs/2026-11-17-notice-float-design.md`): the user asked that nothing shift the page
 * unexpectedly. A notice showing, being replaced and ending, and the resting sentence coming and going, leave every
 * box of the page where it was. A notice that fits the header's empty run, the room its controls leave on their row,
 * floats there with its inline end at the run's: just before `share` where `share` is on that row. A wider one ends at
 * the header's inline end instead and grows towards the inline start over `share` and the controls after it. Its
 * words pass a click through to the controls under them; its action takes a real click with nothing over it, and
 * Tab reaches it where it is drawn.
 */

/** The `DOMException` a write of the program throws, or `null` for none: how the resting sentence comes and goes. */
let refuse: string | null = null
let refused = 0
let written = 0
const passthroughSetItem = localStorage.setItem.bind(localStorage)
localStorage.setItem = (key: string, value: string): void => {
  if (key === PROGRAM_STORAGE_KEY) {
    if (refuse !== null) {
      refused += 1
      throw new DOMException('refused', refuse)
    }
    written += 1
  }
  passthroughSetItem(key, value)
}

/**
 * An edit and its write of the program: refused for `why`, adding a space, or, for `null`, going through and taking
 * that space away again, so the program reads out as before.
 */
async function write(why: string | null): Promise<void> {
  refuse = why
  const count = () => (why === null ? written : refused)
  const before = count()
  const end = view.state.doc.length
  view.dispatch({ changes: why === null ? { from: end - 1, to: end } : { from: end, insert: ' ' } })
  await until(() => count() > before, `the edit’s write${why === null ? '' : `, refused for ${why}`}`)
  await frames()
}

const menu = () => document.querySelector<HTMLElement>('#examples-menu') as HTMLElement
const item = (id: string) =>
  menu().querySelector<HTMLButtonElement>(`button[data-example="${id}"]`) as HTMLButtonElement
const title = (id: string) => EXAMPLES.find((e) => e.id === id)?.title ?? id

/** Open the example `id` from `examples ▾` with real clicks, and wait for its notice. */
async function pick(id: string): Promise<void> {
  await userEvent.click(examplesButton())
  await userEvent.click(item(id))
  await until(() => noticeElText() === `opened the example ${title(id)}`, `the notice for ${id}`)
  await frames()
}

const header = () => document.querySelector<HTMLElement>('header.bar') as HTMLElement
/** The header's empty run: the room its controls leave at the end of their row, where the notice floats. */
const run = () => header().querySelector<HTMLElement>('.bar-spacer') as HTMLElement
const shareButton = () => document.querySelector<HTMLElement>('#share') as HTMLElement
/** The header's last control: a notice too wide for the run ends on its row. */
const settingsButton = () => document.querySelector<HTMLElement>('#settings') as HTMLElement
/** The header's controls drawn, every one but the run and the notice: its menus are popovers, drawn only while open. */
const controls = (): HTMLElement[] =>
  [...header().children].filter(
    (c): c is HTMLElement =>
      c instanceof HTMLElement && !c.classList.contains('bar-spacer') && c !== noticeEl() && isShown(c),
  )
const named = (c: HTMLElement): string => c.id || c.className
const action = () => noticeEl().querySelector<HTMLElement>('.notice-action') as HTMLElement
const centreY = (r: DOMRect): number => r.top + r.height / 2

const overlaps = (a: DOMRect, b: DOMRect): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/** Every box a notice in the page's flow would move: the header and its controls, the workspace, the editor, the foot. */
function layout(): Record<string, number[]> {
  const boxes: Record<string, number[]> = {}
  const add = (name: string, el: Element | null) => {
    if (el === null) throw new Error(`no ${name} on the page`)
    const r = el.getBoundingClientRect()
    boxes[name] = [r.left, r.top, r.width, r.height]
  }
  add('header', header())
  for (const c of controls()) add(c.id || c.className, c)
  add('main', document.querySelector('main'))
  add('views', document.querySelector('#views'))
  for (const h of hosts()) add(h.dataset.leaf as string, h)
  add('editor', document.querySelector('[data-leaf="source"] .cm-editor'))
  add('strip', document.querySelector('footer.strip'))
  return boxes
}

/**
 * Wait for the readout to say `text` again, at rest. **A RUN REDRAWS THE READOUT AS IT GOES**, and the foot it sits in
 * grows and shrinks with it, taking `main` along: a box compared mid-run would be the run's movement, not the notice's.
 */
async function settledAt(text: string): Promise<void> {
  await until(() => stateIdle() && resultsText() === text, 'the readout to settle')
  await frames()
}

/** Where the notice ends: in the run, at the header's inline end, or there where `share` begins a row of its own. */
type Where = 'run' | 'end' | 'band'

/**
 * Hold the notice where the header as it is now puts it: inside the window less the gutter, its action under nothing,
 * and its inline end and its first line (the one its action sits on, or its words' when it has none) at `where`.
 * `run`: no wider than the run, it ends where the run does, the header's gap before `share`, on the run's row, and
 * covers no control. `end`: wider than the run, it ends at the header's inline end on the row of the header's last
 * control, `settings`; its action lies over no control but `settings`, and it covers no control before the run unless
 * it is wider than the room the controls after the run start on that row. `end` with `share` on the run's row; `band`
 * the same where `share` begins a row of its own and the run ends the row above it at the header's inline end.
 */
function placed(at: string, where: Where): void {
  const n = noticeEl().getBoundingClientRect()
  const r = run().getBoundingClientRect()
  const s = shareButton().getBoundingClientRect()
  const gutter = space('--space-3')
  const width = document.documentElement.clientWidth
  const end = width - gutter
  const a = noticeEl().querySelector<HTMLElement>('.notice-action')
  expect(noticeEl().hidden, `precondition, ${at}: a notice is up`).toBe(false)
  if (where === 'band') {
    expect(s.left, `precondition, ${at}: share begins its row`).toBeCloseTo(gutter, 1)
    expect(centreY(s), `precondition, ${at}: share is a row below the run`).toBeGreaterThan(r.bottom)
    expect(r.right, `precondition, ${at}: the run ends at the header’s inline end`).toBeCloseTo(end, 1)
  } else {
    expect(centreY(s), `precondition, ${at}: share is on the run’s row`).toBeCloseTo(centreY(r), 0)
  }
  let row = r
  if (where === 'run') {
    expect(n.width, `precondition, ${at}: it fits the run`).toBeLessThanOrEqual(r.width)
    const gap = Number.parseFloat(getComputedStyle(header()).columnGap)
    expect(n.right, `${at}: its inline end the header’s gap before share`).toBeCloseTo(s.left - gap, 1)
    expect(n.right, `${at}: its inline end at the run’s`).toBeCloseTo(r.right, 1)
    for (const c of controls()) {
      expect(overlaps(n, c.getBoundingClientRect()), `${at}: over ${named(c)}`).toBe(false)
    }
  } else {
    row = settingsButton().getBoundingClientRect()
    expect(n.width, `precondition, ${at}: it is wider than the run`).toBeGreaterThan(r.width)
    expect(n.right, `${at}: its inline end the header’s`).toBeCloseTo(end, 1)
    if (a !== null) {
      for (const c of controls().filter((c) => c !== settingsButton())) {
        expect(overlaps(a.getBoundingClientRect(), c.getBoundingClientRect()), `${at}: action over ${named(c)}`).toBe(
          false,
        )
      }
    }
    const before = (c: HTMLElement) => (run().compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
    const onRow = controls().filter(
      (c) => !before(c) && Math.abs(centreY(c.getBoundingClientRect()) - centreY(row)) < 1,
    )
    if (n.width <= end - Math.min(...onRow.map((c) => c.getBoundingClientRect().left))) {
      for (const c of controls().filter(before)) {
        expect(overlaps(n, c.getBoundingClientRect()), `${at}: over ${named(c)}, before the run`).toBe(false)
      }
    }
  }
  const first = (a ?? (noticeEl().querySelector<HTMLElement>('.notice-text') as HTMLElement)).getBoundingClientRect()
  if (a === null) {
    const line = Number.parseFloat(getComputedStyle(noticeEl()).lineHeight)
    expect(first.height, `precondition, ${at}: the words are one line`).toBeLessThan(1.5 * line)
  }
  expect(centreY(first), `${at}: its first line on ${where === 'run' ? 'the run’s' : 'settings’s'} row`).toBeCloseTo(
    centreY(row),
    0,
  )
  expect(n.left, `${at}: inside the window less the gutter`).toBeGreaterThanOrEqual(gutter - 0.01)
  expect(n.right, `${at}: inside the window less the gutter`).toBeLessThanOrEqual(end + 0.01)
  expect(n.top, `${at}: inside the window`).toBeGreaterThanOrEqual(0)
  expect(n.bottom, `${at}: inside the window`).toBeLessThanOrEqual(document.documentElement.clientHeight)
  if (a !== null) {
    const box = a.getBoundingClientRect()
    expect(document.elementFromPoint(box.left + box.width / 2, centreY(box)), `${at}: what lies at its action`).toBe(a)
  }
}

let view: EditorView

beforeAll(async () => {
  await page.viewport(1280, 800)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
})

/**
 * **EVERY GESTURE HERE LEAVES THE PROGRAM'S TEXT AS IT WAS**, so the readout in the foot says the same and keeps its
 * height: a program that reads out differently can change the foot's height by a fraction of a pixel, and `main` with
 * it, which would be a box moved by the program rather than by the notice. The example is opened once and waited out
 * first; after that a pick of it, its undo and an edit that adds and takes away a space change no result.
 */
describe('a notice floats over the page', () => {
  it('moves nothing when it shows, when another replaces it, and when it ends', async () => {
    await pick('fact')
    await until(() => noticeEl().hidden === true && stateIdle(), 'the first pick’s notice to end')
    await frames()
    const readout = resultsText()
    const before = layout()
    await pick('fact')
    await settledAt(readout)
    expect(noticeEl().hidden, 'precondition: the notice is up').toBe(false)
    expect(layout(), 'with the notice up').toEqual(before)
    await userEvent.click(undoButton() as HTMLButtonElement)
    await until(() => noticeElText() === 'put back the program', 'the undo’s notice over the pick’s')
    await settledAt(readout)
    expect(noticeElText(), 'precondition: the undo’s notice is up').toBe('put back the program')
    expect(layout(), 'with another notice over it').toEqual(before)
    await until(() => noticeEl().hidden === true, 'the notice to end')
    await settledAt(readout)
    expect(layout(), 'with the notice gone').toEqual(before)
  }, 40_000)

  it('moves nothing when the resting sentence comes and goes', async () => {
    const readout = resultsText()
    const before = layout()
    await write('QuotaExceededError')
    await until(() => noticeElText().includes('not being saved'), 'the resting sentence')
    await settledAt(readout)
    expect(layout(), 'with the resting sentence up').toEqual(before)
    await write(null)
    await until(() => noticeEl().hidden === true, 'the resting sentence to go')
    await settledAt(readout)
    expect(layout(), 'with the resting sentence gone').toEqual(before)
  })

  /**
   * **IN THE HEADER'S EMPTY RUN, BEFORE `share`, WHEN IT FITS; OVER THE CONTROLS AFTER IT WHEN IT DOES NOT** — the
   * user's decisions of 2026-11-17: at the top, as an overlay, in an empty spot to the left of `share` or the controls
   * with it; and, where it does not fit there, over `share` and the controls after it, its action over `settings`.
   * That end is on `settings`'s row, the controller's call: at 414 px `share` ends its row and `settings` is a row
   * below, and where `share` begins a row of its own (two bands of widths) the run ends the row above. At each place
   * the example's notice shows over the page as it was, and moves nothing.
   */
  it.for([
    { width: 1280, height: 800, preset: 'explorer', where: 'end' },
    { width: 414, height: 896, preset: 'explorer', where: 'end' },
    { width: 1600, height: 900, preset: 'explorer', where: 'run' },
    { width: 1920, height: 1080, preset: 'explorer', where: 'run' },
    { width: 375, height: 800, preset: 'explorer', where: 'end' },
    { width: 900, height: 800, preset: 'explorer', where: 'band' },
    { width: 365, height: 800, preset: 'stage', where: 'band' },
  ] as const)(
    'floats at the place it fits at $width×$height in $preset ($where), and moves nothing',
    { timeout: 30_000 },
    async (p) => {
      const at = `${p.preset} at ${p.width}×${p.height}`
      await page.viewport(p.width, p.height)
      presetOf(p.preset)
      await until(() => noticeEl().hidden === true && stateIdle(), 'any notice before to end')
      await frames()
      const readout = resultsText()
      const before = layout()
      await pick('fact')
      await settledAt(readout)
      expect(layout(), `${at}: with the notice up`).toEqual(before)
      placed(at, p.where)
      const n = noticeEl().getBoundingClientRect()
      if (p.width === 1920) {
        expect(n.width, `precondition, ${at}: the example’s notice on one line`).toBeGreaterThan(200)
      }
      if (p.width === 1280) {
        const under = controls().filter((c) => overlaps(n, c.getBoundingClientRect()))
        expect(under.length, `precondition, ${at}: it covers a control`).toBeGreaterThan(0)
        for (const c of under) {
          expect(['share', 'appearance', 'about', 'settings'], `${at}: ${named(c)} under it`).toContain(named(c))
        }
        const settings = document.querySelector('#settings') as HTMLElement
        expect(
          overlaps(action().getBoundingClientRect(), settings.getBoundingClientRect()),
          `${at}: undo over settings`,
        ).toBe(true)
      }
      if (p.width === 414) {
        expect(
          centreY(settingsButton().getBoundingClientRect()),
          `precondition, ${at}: settings is a row below share`,
        ).toBeGreaterThan(shareButton().getBoundingClientRect().bottom)
      }
      if (p.width === 375) {
        const h = header().getBoundingClientRect()
        expect(n.top, `${at}: inside the header`).toBeGreaterThanOrEqual(h.top)
        expect(n.bottom, `${at}: inside the header`).toBeLessThanOrEqual(h.bottom)
      }
      presetOf('explorer')
    },
  )

  /**
   * **IT FOLLOWS THE HEADER** as the window and the header change, with no new notice: one resting sentence stays up
   * while the window is resized and the preset's name changes the header's rows, and each case finds it where the
   * header as it is now puts it, in the run where it fits and at the header's end where it does not. On a page taller than the window, scrolled to its end, it stays where it was, in the window.
   */
  it('follows the header as the window is resized and the preset changes, and stays put on a scrolled page', async () => {
    await write('QuotaExceededError')
    await until(() => noticeElText().includes('not being saved'), 'the resting sentence')
    for (const p of [
      { width: 1600, height: 900, preset: 'explorer', where: 'end' },
      { width: 1920, height: 1080, preset: 'explorer', where: 'run' },
      { width: 1920, height: 1080, preset: 'debugger', where: 'run' },
      { width: 940, height: 800, preset: 'debugger', where: 'band' },
      { width: 375, height: 800, preset: 'explorer', where: 'end' },
      { width: 365, height: 800, preset: 'stage', where: 'band' },
      { width: 1280, height: 800, preset: 'debugger', where: 'end' },
    ] as const) {
      await page.viewport(p.width, p.height)
      presetOf(p.preset)
      // A PRESET THE WINDOW CANNOT HOLD SAYS SO in a notice of its own, over the resting sentence for its 8 s.
      await until(() => noticeElText().includes('not being saved'), 'the resting sentence on the line')
      await frames()
      placed(`${p.preset} at ${p.width}×${p.height}, the resting sentence`, p.where)
    }
    const html = document.documentElement
    expect(html.scrollHeight, 'precondition: Debugger’s inspector makes the page taller').toBeGreaterThan(
      html.clientHeight,
    )
    const unscrolled = noticeEl().getBoundingClientRect().toJSON()
    scrollTo(0, html.scrollHeight)
    await frames()
    expect(scrollY, 'precondition: the page scrolled').toBeGreaterThan(0)
    expect(noticeEl().getBoundingClientRect().toJSON(), 'scrolled to the page’s end').toEqual(unscrolled)
    scrollTo(0, 0)
    presetOf('explorer')
    await page.viewport(1280, 800)
    await write(null)
    await until(() => noticeEl().hidden === true, 'the resting sentence to go')
  }, 90_000)

  /**
   * **THE RUN'S BOX STARTS AT THE CONTROL BEFORE IT**, since the spacer gives the gap there back (`style.css`), so a
   * notice as wide as the box would sit flush against that control. A window that makes the run half a gap wider than
   * the notice shows that the gap is kept.
   */
  it('keeps the header’s gap after the control before the run', async () => {
    await pick('fact')
    const gap = Number.parseFloat(getComputedStyle(header()).columnGap)
    const wanted = noticeEl().getBoundingClientRect().width + gap / 2
    try {
      await page.viewport(Math.round(1280 + wanted - run().getBoundingClientRect().width), 800)
      await until(
        () => Math.abs(run().getBoundingClientRect().width - wanted) < 1,
        'the run half a gap wider than the notice',
      )
      await frames()
      const preceding = (c: Element) => (run().compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
      const before = [...header().children].filter((c) => preceding(c) && c.getBoundingClientRect().width > 0).at(-1)
      const b = (before as HTMLElement).getBoundingClientRect()
      const r = run().getBoundingClientRect()
      expect(centreY(b), `precondition: ${named(before as HTMLElement)} on the run’s row`).toBeCloseTo(centreY(r), 0)
      expect(noticeEl().hidden, 'precondition: the notice is up').toBe(false)
      expect(noticeEl().getBoundingClientRect().left - b.right, 'the room before the notice').toBeGreaterThanOrEqual(
        gap - 0.5,
      )
    } finally {
      await page.viewport(1280, 800)
    }
  })

  /**
   * **THE RESTING SENTENCE'S `hide` TAKES IT OFF UNTIL THE CONDITION SAYS SOMETHING ELSE**, so a sentence that can last
   * the whole session never stays over the header against the user's wish. The same condition reported again, after a
   * write that went through, keeps it off; a different one brings it back.
   */
  it('hides the resting sentence until the condition changes', async () => {
    await write('QuotaExceededError')
    await until(() => noticeElText().includes('storage for this site is full'), 'the resting sentence')
    expect(action().textContent, 'precondition: the resting sentence offers hide').toBe('hide')
    await userEvent.click(action())
    await until(() => noticeEl().hidden === true, 'hide to take the sentence off')
    await write(null)
    await write('QuotaExceededError')
    expect(noticeEl().hidden, 'the same condition reported again').toBe(true)
    await write(null)
    await write('SecurityError')
    expect(noticeElText(), 'a different condition').toContain('storage for this site is blocked')
    expect(noticeEl().hidden, 'a different condition').toBe(false)
    await write(null)
    await until(() => noticeEl().hidden === true, 'the condition to end')
  }, 30_000)

  /**
   * **A NOTICE WITH NO ACTION IS CENTRED ON THE ROW AS ONE WITH AN ACTION IS**: its words' first line is the action's
   * height, so the line it is read on is the header's row, in the run and at the header's end.
   */
  it.for([
    { width: 1920, height: 1080, where: 'run' },
    { width: 1280, height: 800, where: 'end' },
  ] as const)('centres a notice with no action on the row at $width×$height ($where)', async (p) => {
    await page.viewport(p.width, p.height)
    await until(() => noticeEl().hidden === true && stateIdle(), 'any notice before to end')
    await frames()
    await userEvent.click(document.querySelector('#workspace') as HTMLElement)
    await userEvent.click(document.querySelector('#reset-preset') as HTMLElement)
    await until(() => noticeElText() === 'Explorer reset — the default views are back', 'the reset’s notice')
    await frames()
    expect(noticeEl().querySelector('.notice-action'), 'precondition: the notice has no action').toBeNull()
    placed(`a notice with no action at ${p.width}×${p.height}`, p.where)
  })

  /**
   * **AT 1280 PX THE EXAMPLE'S NOTICE COVERS NO CONTROL BEFORE `share`** — the user's decision of 2026-11-17: it does
   * not fit the run there, and an undo over the encoding select's arrow would take a press meant for the select. A real
   * press at the arrow opens the select and leaves the example as it is.
   */
  it('lets a real click on the encoding select’s arrow reach the select at 1280 px', async () => {
    await page.viewport(1280, 800)
    await until(() => noticeEl().hidden === true && stateIdle(), 'any notice before to end')
    await pick('fact')
    await until(stateIdle, 'the pick’s run to end')
    const text = view.state.doc.toString()
    const select = document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
    const box = select.getBoundingClientRect()
    const x = box.right - 8
    const y = centreY(box)
    const hit: (Element | null)[] = []
    const record = (e: MouseEvent) => hit.push(e.target as Element)
    document.addEventListener('mousedown', record, { capture: true })
    try {
      const b = document.body.getBoundingClientRect()
      await userEvent.click(document.body, { position: { x: x - b.left, y: y - b.top } })
    } finally {
      document.removeEventListener('mousedown', record, { capture: true })
    }
    expect(hit, 'what the press at the arrow reached').toEqual([select])
    expect(document.activeElement, 'the select took the press').toBe(select)
    // FIREFOX, UNDER THE TEST DRIVER, REPORTS NO OPEN LIST THROUGH `:open` AFTER THE SAME PRESS, so there the press
    // reaching the select and its focus are what is held.
    if (CHROMIUM) expect(select.matches(':open'), 'the select’s list is open').toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(noticeElText(), 'the example’s notice, not its undo’s').toBe(`opened the example ${title('fact')}`)
    expect(view.state.doc.toString(), 'the example’s program').toBe(text)
  }, 30_000)

  /**
   * **TAB REACHES THE ACTION WHERE IT IS DRAWN**: in the run, after the encoding select and before `share`; over the
   * controls after the run, its action over `settings`, after `settings`, where a palette removed from the settings
   * menu leaves the focus, and not between the select and `share`.
   */
  it.for([
    { width: 1920, height: 1080, where: 'run' },
    { width: 1280, height: 800, where: 'end' },
  ] as const)(
    'reaches its action by Tab where it is drawn at $width×$height ($where)',
    { timeout: 30_000 },
    async (p) => {
      await page.viewport(p.width, p.height)
      await until(() => noticeEl().hidden === true && stateIdle(), 'any notice before to end')
      await pick('fact')
      placed(`the example’s notice at ${p.width}×${p.height}`, p.where)
      const encoding = document.querySelector('#encoding') as HTMLElement
      if (p.where === 'run') {
        encoding.focus()
        await userEvent.tab()
        expect(document.activeElement, 'Tab from the encoding select').toBe(action())
        await userEvent.tab()
        expect(document.activeElement, 'Tab from the action').toBe(shareButton())
      } else {
        ;(document.querySelector('#settings') as HTMLElement).focus()
        await userEvent.tab()
        expect(document.activeElement, 'Tab from settings').toBe(action())
        encoding.focus()
        await userEvent.tab()
        expect(document.activeElement, 'Tab from the encoding select').toBe(shareButton())
      }
    },
  )

  /**
   * **A DOUBLE-CLICK ON UNDO RUNS IT, AND ITS SECOND CLICK GOES NOWHERE** — the controller's call: the undo's own notice
   * takes its place, its words over `settings`, and takes clicks on them for `SECOND_CLICK_MS`, so the second click
   * opens no menu and leaves the focus where the undo put it; after that a click there reaches `settings` again.
   */
  it('swallows a double-click’s second click on the undo’s own notice at 1280 px, then lets clicks through', async () => {
    await page.viewport(1280, 800)
    await until(() => noticeEl().hidden === true && stateIdle(), 'any notice before to end')
    const text = view.state.doc.toString()
    await pick('fact')
    await until(stateIdle, 'the pick’s run to end')
    const settings = settingsButton()
    const box = action().getBoundingClientRect()
    expect(overlaps(box, settings.getBoundingClientRect()), 'precondition: the undo over settings').toBe(true)
    const b = document.body.getBoundingClientRect()
    const at = { x: box.left + box.width / 2 - b.left, y: centreY(box) - b.top }
    const clicks: number[] = []
    const record = (e: MouseEvent) => {
      if ((e.target as Element).closest('#settings') !== null) clicks.push(e.detail)
    }
    document.addEventListener('click', record, { capture: true })
    try {
      await userEvent.dblClick(action())
    } finally {
      document.removeEventListener('click', record, { capture: true })
    }
    await until(() => noticeElText() === 'put back the program', 'the undo’s own notice')
    expect(view.state.doc.toString(), 'the program the pick replaced').toBe(text)
    expect(clicks, 'clicks that reached settings').toEqual([])
    expect(settings.getAttribute('aria-expanded'), 'settings’s menu').toBe('false')
    expect(view.hasFocus, 'the focus where the undo put it').toBe(true)
    await new Promise((resolve) => setTimeout(resolve, SECOND_CLICK_MS + 100))
    expect(noticeElText(), 'precondition: the undo’s notice is still up').toBe('put back the program')
    await userEvent.click(document.body, { position: at })
    expect(settings.getAttribute('aria-expanded'), 'a click there after the second click’s time').toBe('true')
    await userEvent.keyboard('{Escape}')
    await until(() => settings.getAttribute('aria-expanded') === 'false', 'its menu to close')
  }, 30_000)

  /**
   * **ITS ACTION TAKES A REAL CLICK, AND ITS WORDS PASS ONE THROUGH** (the user's decisions of 2026-11-17): a press on
   * the words reaches the header control under them, so the notice draws over the controls without blocking them.
   */
  describe.each([
    [1280, 800],
    [375, 800],
  ] as const)('at %i×%i px', (width, height) => {
    it('runs its undo with a real click', async () => {
      await page.viewport(width, height)
      await until(() => noticeEl().hidden === true, 'any notice before to end')
      const text = view.state.doc.toString()
      await pick('fact')
      await userEvent.click(undoButton() as HTMLButtonElement)
      await until(() => noticeElText() === 'put back the program', 'the undo’s own notice')
      expect(view.state.doc.toString(), 'the program the pick replaced').toBe(text)
    }, 30_000)

    it('passes a real click on its words to the header control under them', async () => {
      await page.viewport(width, height)
      await frames()
      await pick('fact')
      await until(stateIdle, 'the pick’s run to end')
      await frames()
      const w = (noticeEl().querySelector('.notice-text') as HTMLElement).getBoundingClientRect()
      const target = controls()
        .filter((c) => c.matches('button[aria-expanded]'))
        .find((c) => overlaps(w, c.getBoundingClientRect()))
      expect(target, 'precondition: a menu’s button lies under the words').toBeDefined()
      const button = target as HTMLElement
      const c = button.getBoundingClientRect()
      const x = (Math.max(w.left, c.left) + Math.min(w.right, c.right)) / 2
      const y = (Math.max(w.top, c.top) + Math.min(w.bottom, c.bottom)) / 2
      expect(document.elementFromPoint(x, y)?.closest('button'), 'what a press on the words hits').toBe(button)
      const hit: (Element | null)[] = []
      const record = (e: MouseEvent) => hit.push((e.target as Element).closest('button'))
      document.addEventListener('click', record, { capture: true })
      try {
        // AT THE POINT, THROUGH THE PAGE'S BODY: a click aimed at the button would land on it whatever lay over it.
        const b = document.body.getBoundingClientRect()
        await userEvent.click(document.body, { position: { x: x - b.left, y: y - b.top } })
      } finally {
        document.removeEventListener('click', record, { capture: true })
      }
      expect(hit, 'what the click reached').toEqual([button])
      expect(button.getAttribute('aria-expanded'), 'the control acted').toBe('true')
      await userEvent.keyboard('{Escape}')
      await until(() => button.getAttribute('aria-expanded') === 'false', 'its menu to close')
    }, 30_000)
  })

  /**
   * **THE STRIP KEEPS ITS HEIGHT ACROSS A RUN**: the strip is the page's foot, so a strip that grew mid-run would move
   * the workspace above it. A run of the same program is an edit that adds a space and one that takes it away; the
   * strip's height is read at every change to the readout and the link sentence, wherever the preset has put them,
   * from before the first edit to after the second's run.
   */
  it.each([
    [1280, 800],
    [390, 844],
  ] as const)(
    'keeps the strip one height across a run at %i×%i px, in each preset',
    async (width, height) => {
      await page.viewport(width, height)
      const strip = document.querySelector<HTMLElement>('footer.strip') as HTMLElement
      for (const preset of ['explorer', 'debugger', 'stage']) {
        presetOf(preset)
        await until(stateIdle, `${preset}: the readout at rest`)
        await frames()
        const heights = new Set([strip.getBoundingClientRect().height])
        let ran = false
        const watch = new MutationObserver(() => {
          heights.add(strip.getBoundingClientRect().height)
          if (!stateIdle()) ran = true
        })
        for (const id of ['#results', '#link-status']) {
          watch.observe(document.querySelector(id) as Element, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          })
        }
        try {
          for (const edit of ['add', 'take'] as const) {
            ran = false
            const end = view.state.doc.length
            view.dispatch({ changes: edit === 'add' ? { from: end, insert: ' ' } : { from: end - 1, to: end } })
            await until(() => ran && stateIdle(), `${preset}: the run after the ${edit} edit`)
            await frames()
            heights.add(strip.getBoundingClientRect().height)
          }
        } finally {
          watch.disconnect()
        }
        expect([...heights], `${preset} at ${width}×${height}: the strip’s heights`).toHaveLength(1)
      }
      presetOf('explorer')
      await page.viewport(1280, 800)
    },
    40_000,
  )
})
