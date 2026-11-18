import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { STEP_PAUSE_MS } from '../../src/field-width'
import {
  base16Dialog,
  diagram,
  diagramChoice,
  frames,
  isShown,
  lambdaMark,
  lambdaTerm,
  linkStatus,
  panelOf,
  rxmPane,
  SHELL,
  sourceLinked,
  stateIdle,
  stateTable,
  tmPane,
  until,
} from './harness'

/**
 * Clearing the link (`docs/superpowers/specs/2026-11-17-link-clear-design.md`): a click on empty space in a view, a
 * view showing a copy included, clears the pin and every mark of it and leaves linking on; a click that links, or on a
 * control or a view's chrome, and a press that moves more than 4 px, clear nothing; Escape clears it with the focus in
 * a view, and not in an editor or with a menu or dialog open. A click clears at once, the first of a double-click too, and
 * a Shift-click clears nothing.
 *
 * In `CAPTURE_FILES`: the local level's pan and a panel boundary's drag each take a pointer capture.
 */

const SAMPLE = 'let x = 40; x + 2'

/** A copy's machine: no dots in its names, so its diagram shows the local level alone. */
const MACHINE = `tapes 1\nstart s\n\nstate s:\n  [*] -> write [*], move [R], goto t\nstate t:\n  [*] -> write [*], move [R], goto u\nstate u: accept\n`

let view: EditorView

const rxmRow = (pc: number) =>
  [...rxmPane().querySelectorAll<HTMLElement>('.rxm-row')].find(
    (r) => r.querySelector('.rxm-pc')?.textContent === `pc${pc}`,
  ) as HTMLElement
const tmLinked = () => tmPane().querySelectorAll('.state-row.is-linked').length
const rxmLinked = () => rxmPane().querySelectorAll('.rxm-row.is-linked').length
const level = () => diagram().querySelector('.local-level') as HTMLElement
const tmShowsCopy = () => tmPane().querySelector('.term-editor') !== null

/** Whether the pin of `x + 2` is drawn everywhere it draws: the source, the λ term, the rxm listing, the rule table. */
const pinned = () =>
  sourceLinked() === 'x + 2' && rxmLinked() > 0 && lambdaMark('linked') !== null && (tmShowsCopy() || tmLinked() > 0)

/**
 * Whether nothing is pinned and nothing draws a pin: every mark gone, and the status line saying no more than that a
 * view shows a copy, which it says pinned or not.
 */
const cleared = () =>
  sourceLinked() === null &&
  rxmLinked() === 0 &&
  tmLinked() === 0 &&
  lambdaMark('linked') === null &&
  /^(.* — not linked to the program)?$/.test(linkStatus())

/** Pin `x + 2` with a real click on the rxm instruction it lowered to, and wait for every view to draw it. */
async function pin(): Promise<void> {
  await userEvent.click(rxmRow(3))
  await until(pinned, 'the pin to reach every view')
}

/** The clicks `#views` hears while `act` runs: a drag that kept the pin must have sent one, or it proves nothing. */
function clicksDuring(act: () => Promise<void>): Promise<number> {
  return heard(document.querySelector('#views') as HTMLElement, 'click', act)
}

/** A point of the page, and the element a gesture there is aimed at, which is at the point or holds what is. */
type Spot = { el: HTMLElement; x: number; y: number }

/**
 * A point in `el`, scanned from its bottom up, where the topmost element passes `empty` and does 6 px each way too:
 * the room below a list's last row before anything above it. The margin is for Firefox, whose frame is scaled, so a
 * real click can land a pixel or two from the point asked for.
 */
function pointIn(el: HTMLElement, empty: (under: Element) => boolean, what: string): Spot {
  const r = el.getBoundingClientRect()
  const ok = (x: number, y: number) => {
    const under = document.elementFromPoint(x, y)
    return under !== null && el.contains(under) && empty(under)
  }
  for (let y = r.bottom - 8; y > r.top + 8; y -= 5) {
    for (let x = r.left + 8; x < r.right - 8; x += 9) {
      if (ok(x, y) && ok(x - 6, y) && ok(x + 6, y) && ok(x, y - 6) && ok(x, y + 6)) return { el, x, y }
    }
  }
  throw new Error(`precondition: no ${what} on screen`)
}

/** Nothing a click can link or work: no row, λ line, control or chrome, at or above `under`. */
const blank = (under: Element) =>
  under.closest('[role=row], .term-line, button, [role=separator], .panel-header, .view-header, .term-map') === null

/**
 * A real click at `at`, aimed at its element: Playwright's own hit test, which can disagree with `elementFromPoint` on
 * which of the two is topmost, takes either.
 */
async function clickAt(at: Spot): Promise<void> {
  const r = at.el.getBoundingClientRect()
  await userEvent.click(at.el, { position: { x: at.x - r.left, y: at.y - r.top } })
}

/** `at`, a point in this frame, where the page that holds the frame has it: Playwright's mouse is the page's. */
function onPage(at: Spot): { x: number; y: number } {
  const f = (window.frameElement as HTMLElement).getBoundingClientRect()
  const scale = f.width / innerWidth
  return { x: f.left + at.x * scale, y: f.top + at.y * scale }
}

/**
 * A real double-click at `at`, its second press held for frames to pass between the two clicks. Playwright's mouse,
 * given the click count the system would give, so the hold leaves it a double-click to the browser.
 */
async function dblClickAt(at: Spot): Promise<void> {
  const p = onPage(at)
  await commands.mouse('down', p.x, p.y, 1)
  await commands.mouse('up', p.x, p.y, 1)
  await commands.mouse('down', p.x, p.y, 2)
  try {
    await new Promise((r) => setTimeout(r, 150))
  } finally {
    await commands.mouse('up', p.x, p.y, 2)
  }
}

/** The middle of the first tape's cell holding a symbol, past `skip` such: text a double-click selects a word of. */
function cell(skip = 0): Spot {
  let left = skip
  for (const el of tmPane().querySelectorAll<HTMLElement>('.tapes .cell')) {
    const r = el.getBoundingClientRect()
    const at = { el, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }
    if (!/\S/.test(el.textContent ?? '') || document.elementFromPoint(at.x, at.y) !== el) continue
    if (left === 0) return at
    left -= 1
  }
  throw new Error(`precondition: no ${skip + 1} tape cells with a symbol on screen`)
}

/** The pin when a frame began, or when `#views` had heard a click out, every handler of its own run. */
type Sample = { click: boolean; detail: number; pinned: boolean; cleared: boolean }

/**
 * The pin at every frame and every click `#views` hears while `act` runs, and once more when it ends: an `until` in
 * `act` can see a change before the next frame does.
 */
async function watch(act: () => Promise<void>): Promise<Sample[]> {
  const seen: Sample[] = []
  const take = (click: boolean, detail = 0) => seen.push({ click, detail, pinned: pinned(), cleared: cleared() })
  let on = true
  const frame = () => {
    if (!on) return
    take(false)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  const views = document.querySelector('#views') as HTMLElement
  const click = (e: MouseEvent) => take(true, e.detail)
  views.addEventListener('click', click)
  try {
    await act()
    take(false)
  } finally {
    on = false
    views.removeEventListener('click', click)
  }
  return seen
}

/** The samples as a line: `C` a click and `.` a frame with the pin drawn, `X` and `x` without it. */
const trace = (seen: readonly Sample[]) =>
  seen.map((s) => (s.click ? (s.pinned ? 'C' : 'X') : s.pinned ? '.' : 'x')).join('')

/** The local level's zoom as the page draws it: a node's width on screen over the width it was laid out at. */
function zoom(): number {
  const n = level().querySelector('.local-node') as HTMLElement
  return n.getBoundingClientRect().width / n.offsetWidth
}

/** Zoom the local level in by `f` with the wheel over it: a notch of 100 px up zooms in by 1.1. */
async function zoomIn(f: number): Promise<void> {
  await userEvent.wheel(level(), { delta: { y: (-100 * Math.log(f)) / Math.log(1.1) } })
  await frames()
}

/** The events of `type` that `el` hears while `act` runs. */
async function heard(el: HTMLElement, type: string, act: () => Promise<void>): Promise<number> {
  let n = 0
  const count = () => {
    n += 1
  }
  el.addEventListener(type, count)
  try {
    await act()
    await frames()
  } finally {
    el.removeEventListener(type, count)
  }
  return n
}

/** A real drag from `at` by `dx`, `dy`, aimed at its element as `clickAt`'s click is. */
async function dragFrom(at: Spot, dx: number, dy: number): Promise<void> {
  const r = at.el.getBoundingClientRect()
  const from = { x: at.x - r.left, y: at.y - r.top }
  await userEvent.dragAndDrop(at.el, at.el, {
    sourcePosition: from,
    targetPosition: { x: from.x + dx, y: from.y + dy },
  })
}

/** Put `program` in the source and wait for it to compile. */
async function load(program: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: program } })
  await until(() => !stateIdle(), 'the compile to start')
  await until(stateIdle, 'the compile to finish')
}

/** A TM view's width box, its label round it. */
const widthField = () => tmPane().querySelector('label.field-width') as HTMLLabelElement
const widthBox = () => widthField().querySelector('input') as HTMLInputElement

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await load(SAMPLE)
  await until(() => rxmRow(3) !== undefined, 'the rxm listing to draw')
})

describe('a click on empty space in a view', () => {
  // THE PROGRAM'S RULE TABLE HAS NO ROOM BELOW ITS ROWS, whose states fill it; a copy's short machine leaves some, and
  // the copy's cases below click there.
  const surfaces: { name: string; at: () => Spot }[] = [
    { name: 'the tapes', at: () => pointIn(tmPane().querySelector('.tapes') as HTMLElement, blank, 'tape') },
    { name: 'the program level of the diagram', at: () => pointIn(diagram(), blank, 'room beside the program') },
    {
      name: 'the rxm listing below its last row',
      at: () => pointIn(panelOf(rxmPane(), 'listing'), blank, 'room below the listing'),
    },
    { name: 'the rxm registers', at: () => pointIn(panelOf(rxmPane(), 'registers'), blank, 'registers') },
    { name: 'the λ term below its last line', at: () => pointIn(lambdaTerm() as HTMLElement, blank, 'room below') },
    {
      name: 'the blank beside a λ line',
      at: () => pointIn(lambdaTerm() as HTMLElement, (u) => u.classList.contains('term-line'), 'blank beside a line'),
    },
    { name: 'a tape’s cell, text a double-click selects a word of', at: () => cell() },
  ]

  it.each(surfaces)('on $name clears the pin, its marks and the source’s, and leaves linking on', async ({ at }) => {
    await pin()
    await clickAt(at())
    await until(cleared, 'every mark of the pin to go')
    // LINKING IS STILL ON: a link gesture pins again with no compile between, where an edit's clear would wait for one.
    await pin()
  })

  // TEXT OR NOT: nothing waits to see whether a second click follows.
  it.each(surfaces)('on $name clears it at once', async ({ at }) => {
    await pin()
    const seen = await watch(() => clickAt(at()))
    expect(seen.find((s) => s.click)?.cleared, `cleared by the click (${trace(seen)})`).toBe(true)
  })

  it('on a tape’s cell, at a double-click’s first click, and it stays cleared, the word selected', async () => {
    await pin()
    getSelection()?.removeAllRanges()
    const seen = await watch(async () => {
      await dblClickAt(cell())
      await frames()
    })
    const t = trace(seen)
    const details = seen.filter((s) => s.click).map((s) => s.detail)
    expect(details, 'precondition: a double-click to the browser').toEqual([1, 2])
    expect(/^\.*Xx+Xx*$/.test(t), `cleared at the first click and never drawn again (${t})`).toBe(true)
    expect(getSelection()?.toString() ?? '', 'the word the double-click selected').not.toBe('')
  })

  it('leaves the rule table where the pin scrolled it', async () => {
    await pin()
    // THE PIN WAS CLICKED IN THE RXM LISTING, so the rule table scrolled to its block and holds there.
    const top = stateTable().scrollTop
    expect(top, 'precondition: the pin scrolled the rule table').toBeGreaterThan(0)
    await clickAt(pointIn(tmPane().querySelector('.tapes') as HTMLElement, blank, 'tape'))
    await until(cleared, 'every mark of the pin to go')
    await frames()
    expect(stateTable().scrollTop, 'the rule table’s scroll').toBe(top)
  })
})

describe('what keeps the pin', () => {
  it('a click that links: a rule row', async () => {
    await pin()
    const row = tmPane().querySelector('.state-row.is-linked') as HTMLElement
    await userEvent.click(row)
    await frames()
    expect(sourceLinked(), 'the source construct the row links').not.toBeNull()
    expect(tmLinked(), 'the rule table’s linked rows').toBeGreaterThan(0)
  })

  it('a click on a view’s header or a panel’s', async () => {
    await pin()
    await clickAt(
      pointIn(tmPane().querySelector('.view-header') as HTMLElement, (u) => u.closest('button') === null, 'header'),
    )
    await clickAt(
      pointIn(
        panelOf(rxmPane(), 'registers').querySelector('.panel-header') as HTMLElement,
        (u) => u.closest('button') === null,
        'panel header',
      ),
    )
    await frames()
    expect(pinned(), 'the pin').toBe(true)
  })

  // EACH ASSERTED AS SOON AS ITS GESTURE ENDS, BEFORE A STEPPED WIDTH APPLIES (`STEP_PAUSE_MS` after the step): the
  // width applied recompiles the program, and a compile drops every pin, the rule an edit's clear keeps, not this one.
  it('a click on a TM view’s width box, on its label and on each arrow, and typing in the box', async () => {
    await pin()
    expect(isShown(widthBox()), 'precondition: the width box on the view’s bar').toBe(true)
    expect(widthBox().value, 'precondition: auto').toBe('')
    await userEvent.click(widthBox())
    expect(pinned(), 'the pin, after a click on the box').toBe(true)
    await userEvent.keyboard('9')
    expect(widthBox().value, 'precondition: typed').toBe('9')
    expect(pinned(), 'the pin, after a digit typed').toBe(true)
    await userEvent.keyboard('{Backspace}')
    await userEvent.click(widthField(), { position: { x: 3, y: widthField().getBoundingClientRect().height / 2 } })
    expect(pinned(), 'the pin, after a click on the label’s word').toBe(true)
    await userEvent.click(widthField().querySelector('.field-width-arrows .up') as HTMLElement)
    expect(widthBox().value, 'precondition: the up arrow stepped the box').not.toBe('')
    expect(pinned(), 'the pin, after a press on the up arrow').toBe(true)
    await userEvent.click(widthField().querySelector('.field-width-arrows .down') as HTMLElement)
    expect(widthBox().value, 'precondition: the down arrow stepped it back to auto').toBe('')
    expect(pinned(), 'the pin, after a press on the down arrow').toBe(true)
    // BACK AT AUTO, SO THE PAUSE ENDS WITH NOTHING TO APPLY: waited out so no later case meets it.
    await new Promise((r) => setTimeout(r, STEP_PAUSE_MS + 100))
  })

  it('a text selection dragged across the tapes', async () => {
    await pin()
    getSelection()?.removeAllRanges()
    const tapes = tmPane().querySelector('.tapes') as HTMLElement
    const clicks = await clicksDuring(() => dragFrom(pointIn(tapes, blank, 'tape'), 0, -40))
    expect(clicks, 'precondition: the drag’s release sent a click').toBeGreaterThan(0)
    expect(pinned(), 'the pin').toBe(true)
  })

  it('a click that closes a view’s menu', async () => {
    await pin()
    await userEvent.click(tmPane().querySelector('.view-more') as HTMLElement)
    await until(() => document.querySelector(':popover-open') !== null, 'the menu to open')
    const clicks = await clicksDuring(() =>
      clickAt(pointIn(tmPane().querySelector('.tapes') as HTMLElement, blank, 'tape')),
    )
    expect(document.querySelector(':popover-open'), 'precondition: the click closed the menu').toBeNull()
    expect(clicks, 'precondition: the click reached the views').toBeGreaterThan(0)
    expect(pinned(), 'the pin').toBe(true)
  })

  it('a Shift-click on the tapes, which extends a selection', async () => {
    await pin()
    await userEvent.keyboard('{Shift>}')
    try {
      const clicks = await clicksDuring(() =>
        clickAt(pointIn(tmPane().querySelector('.tapes') as HTMLElement, blank, 'tape')),
      )
      expect(clicks, 'precondition: the click reached the views').toBeGreaterThan(0)
    } finally {
      await userEvent.keyboard('{/Shift}')
    }
    expect(pinned(), 'the pin').toBe(true)
  })

  it('a panel boundary dragged', async () => {
    await pin()
    const b = tmPane().querySelector('.panel-boundary') as HTMLElement
    const r = b.getBoundingClientRect()
    const height = panelOf(tmPane(), 'rules').getBoundingClientRect().height
    const clicks = await clicksDuring(() =>
      dragFrom({ el: b, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }, 0, 30),
    )
    expect(clicks, 'precondition: the drag’s release sent a click').toBeGreaterThan(0)
    expect(panelOf(tmPane(), 'rules').getBoundingClientRect().height, 'precondition: the drag moved it').not.toBe(
      height,
    )
    expect(pinned(), 'the pin').toBe(true)
  })
})

describe('Escape', () => {
  it('clears the pin with the focus in a view', async () => {
    await pin()
    expect(document.activeElement, 'precondition: the focus on the listing the pin was clicked in').toBe(
      rxmPane().querySelector('.rxm-listing'),
    )
    await userEvent.keyboard('{Escape}')
    await until(cleared, 'every mark of the pin to go')
  })

  it('clears it with the focus on nothing', async () => {
    await pin()
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement, 'precondition: the focus on the body').toBe(document.body)
    await userEvent.keyboard('{Escape}')
    await until(cleared, 'every mark of the pin to go')
  })

  it('keeps it in the source editor', async () => {
    await pin()
    view.focus()
    await userEvent.keyboard('{Escape}')
    await frames()
    expect(pinned(), 'the pin').toBe(true)
  })

  // ONE ESCAPE DOES ONE THING, THE INNERMOST FIRST: the box's own, where it has a width typed to put back.
  it('keeps it on an Escape that puts back a width typed in a TM view’s width box', async () => {
    await pin()
    await userEvent.click(widthBox())
    await userEvent.keyboard('9')
    expect(widthBox().value, 'precondition: typed').toBe('9')
    await userEvent.keyboard('{Escape}')
    expect(widthBox().value, 'the box back at auto').toBe('')
    await frames()
    expect(pinned(), 'the pin').toBe(true)
  })

  it('clears it on an Escape in that box with nothing typed there to put back', async () => {
    await pin()
    await userEvent.click(widthBox())
    expect(widthBox().value, 'precondition: nothing typed').toBe('')
    expect(document.activeElement, 'precondition: the focus in the box').toBe(widthBox())
    await userEvent.keyboard('{Escape}')
    await until(cleared, 'every mark of the pin to go')
  })

  it('keeps it while a view’s menu is open, which it closes', async () => {
    await pin()
    await userEvent.click(tmPane().querySelector('.view-more') as HTMLElement)
    await until(() => document.querySelector(':popover-open') !== null, 'the menu to open')
    expect(tmPane().contains(document.activeElement), 'precondition: the focus in the view').toBe(true)
    await userEvent.keyboard('{Escape}')
    await until(() => document.querySelector(':popover-open') === null, 'the menu to close')
    expect(pinned(), 'the pin').toBe(true)
  })

  it('keeps it while a dialog is open, which it closes', async () => {
    await pin()
    await userEvent.click(document.querySelector('#settings') as HTMLElement)
    await userEvent.click(document.querySelector('#import-base16') as HTMLElement)
    expect(base16Dialog().open, 'precondition: the dialog open').toBe(true)
    await userEvent.keyboard('{Escape}')
    await until(() => !base16Dialog().open, 'the dialog to close')
    expect(pinned(), 'the pin').toBe(true)
  })
})

describe('a pin made outside the rxm listing', () => {
  /** A program whose rxm listing is longer than its panel, as the sample's is not. */
  const LONG = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'
  const listing = () => rxmPane().querySelector('.rxm-listing') as HTMLElement
  const tops = () => ({ rxm: listing().scrollTop, rules: stateTable().scrollTop })

  beforeAll(() => load(LONG))
  afterAll(async () => {
    await load(SAMPLE)
    await until(() => rxmRow(3) !== undefined, 'the rxm listing to draw')
  })

  it('leaves the rxm listing and the rule table where the pin scrolled them when it clears', async () => {
    const was = tops()
    view.dispatch({ selection: { anchor: LONG.lastIndexOf('3') } })
    view.focus()
    await userEvent.keyboard("{Control>}'{/Control}")
    await until(() => sourceLinked() !== null, 'the source to show the pin')
    await frames()
    const at = tops()
    // BOTH MOVED, so a clear that let them follow the run again would move them back.
    expect(at.rxm, 'precondition: the pin scrolled the rxm listing').not.toBe(was.rxm)
    expect(at.rules, 'precondition: the pin scrolled the rule table').not.toBe(was.rules)
    await clickAt(pointIn(tmPane().querySelector('.tapes') as HTMLElement, blank, 'tape'))
    await until(cleared, 'every mark of the pin to go')
    await frames()
    expect(tops(), 'where the lists are').toEqual(at)
  })
})

describe('a view showing a copy', () => {
  beforeAll(async () => {
    tmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => tmPane().querySelector('.term-editor .cm-content') !== null, 'the copy to mount its editor')
    const copy = (await import('@codemirror/view')).EditorView.findFromDOM(
      tmPane().querySelector('.term-editor .cm-content') as HTMLElement,
    )
    copy?.dispatch({ changes: { from: 0, to: copy.state.doc.length, insert: MACHINE } })
    await until(() => level().querySelectorAll('.local-node').length === 3, 'the copy to draw its three states')
  })

  const background = () => pointIn(level(), (u) => u.closest('.local-node') === null, 'background')

  it('clears the program’s pin at once on a click on its diagram’s background', async () => {
    await pin()
    const seen = await watch(() => clickAt(background()))
    expect(seen.find((s) => s.click)?.cleared, `cleared by the click (${trace(seen)})`).toBe(true)
  })

  it('clears it on a click below its rule table’s last row', async () => {
    await pin()
    await clickAt(pointIn(panelOf(tmPane(), 'rules'), blank, 'room below the rules'))
    await until(cleared, 'every mark of the pin to go')
  })

  it('clears it at once on a click on a node of its diagram, which links nothing', async () => {
    await pin()
    const seen = await watch(() => userEvent.click(level().querySelector('.local-node') as HTMLElement))
    expect(seen.find((s) => s.click)?.cleared, `cleared by the click (${trace(seen)})`).toBe(true)
  })

  it('clears it on a click on a row of its rule table, which links nothing', async () => {
    await pin()
    await userEvent.click(stateTable().querySelector('.state-row') as HTMLElement)
    await until(cleared, 'every mark of the pin to go')
  })

  it('clears it at a double-click’s first click on its diagram’s background, which moves the diagram no more', async () => {
    await zoomIn(1.5)
    expect(zoom(), 'precondition: zoomed').toBeCloseTo(1.5, 2)
    await pin()
    const at = background()
    const was = { left: level().scrollLeft, top: level().scrollTop }
    let n = 0
    const seen = await watch(async () => {
      n = await heard(level(), 'dblclick', () => dblClickAt(at))
    })
    expect(n, 'precondition: the double-click reached the level').toBe(1)
    const t = trace(seen)
    expect(/^\.*Xx+Xx*$/.test(t), `cleared at the first click and never drawn again (${t})`).toBe(true)
    expect(zoom(), 'the zoom').toBeCloseTo(1.5, 2)
    expect(Math.abs(level().scrollLeft - was.left), 'moved across').toBeLessThanOrEqual(1)
    expect(Math.abs(level().scrollTop - was.top), 'moved down').toBeLessThanOrEqual(1)
  })

  it('keeps the pin through a click on local, which puts its diagram back at full size', async () => {
    if (Math.abs(zoom() - 1.5) > 0.01) await zoomIn(1.5 / zoom())
    expect(zoom(), 'precondition: zoomed').toBeCloseTo(1.5, 2)
    await pin()
    const clicks = await clicksDuring(() => userEvent.click(diagramChoice('local') as HTMLElement))
    expect(clicks, 'precondition: the click reached the views').toBeGreaterThan(0)
    expect(zoom(), 'precondition: back at full size').toBeCloseTo(1, 3)
    expect(pinned(), 'the pin').toBe(true)
  })

  it('keeps the pin through a pan of its diagram', async () => {
    await pin()
    const before = level().scrollLeft
    const clicks = await clicksDuring(() => dragFrom(background(), -40, 0))
    expect(level().scrollLeft, 'precondition: the drag panned').not.toBe(before)
    expect(clicks, 'precondition: the drag’s release sent a click').toBeGreaterThan(0)
    expect(pinned(), 'the pin').toBe(true)
  })
})
