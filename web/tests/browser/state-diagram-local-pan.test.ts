import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cdp, commands, page, userEvent } from 'vitest/browser'
import { CHROMIUM, chromiumOnly } from './engine'
import { control, diagram, frame, frames, SHELL, stateIdle, tmPane, tmStatus, until } from './harness'

/**
 * Moving the state diagram's local level in its panel like a map
 * (`docs/superpowers/specs/2026-11-16-state-diagram-tidy-design.md`, decisions 10 and 11): a mouse drag moves it both
 * ways at any size, as far as puts a corner of it at the panel's middle, a click on a node still links it, and a step
 * to a new state centres that state while a redraw around the same one centres it again unless it was moved since.
 */

/**
 * Eight states before `s`, which stack eight rows high in the column before it, and three after it in a line, with
 * names long enough to be cut: a level around `s` or the state after it is wider and taller than a 300 by 160 panel.
 * No dots in the names, so the diagram shows the local level alone.
 */
const MACHINE = `tapes 1\nstart s\n\nstate s:\n  [*] -> write [*], move [R], goto after_one_rule_on\nstate after_one_rule_on:\n  [*] -> write [*], move [R], goto after_two_rules_on\nstate after_two_rules_on:\n  [*] -> write [*], move [R], goto after_three_rules\nstate after_three_rules: accept\n${Array.from(
  { length: 8 },
  (_, i) => `state before_s_number_${i}:\n  [*] -> write [*], move [R], goto s\n`,
).join('')}`

const level = () => diagram().querySelector('.local-level') as HTMLElement
const content = () => diagram().querySelector('.local-content') as HTMLElement
const group = () => diagram().querySelector('.local-nodes') as HTMLElement
const nodes = () => [...group().querySelectorAll<HTMLElement>('.local-node')]
const nodeNamed = (name: string) => group().querySelector<HTMLElement>(`.local-node[title="${name}"]`) as HTMLElement
const editor = () => tmPane().querySelector('.term-editor .cm-content') as HTMLElement
const scroll = () => ({ left: level().scrollLeft, top: level().scrollTop })
const maxScroll = () => ({
  left: level().scrollWidth - level().clientWidth,
  top: level().scrollHeight - level().clientHeight,
})

/** The level's scrolled box, as the page sees it: inside its border. */
function viewport(): { left: number; top: number; right: number; bottom: number } {
  const box = level().getBoundingClientRect()
  const left = box.left + level().clientLeft
  const top = box.top + level().clientTop
  return { left, top, right: left + level().clientWidth, bottom: top + level().clientHeight }
}

/** The middle of the level's scrolled box. */
function middle(): { x: number; y: number } {
  const v = viewport()
  return { x: (v.left + v.right) / 2, y: (v.top + v.bottom) / 2 }
}

/** Where `el`'s centre is from the panel's middle. */
function fromMiddle(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  const m = middle()
  return { x: r.left + r.width / 2 - m.x, y: r.top + r.height / 2 - m.y }
}

/**
 * A point in the level's scrolled box with no node under it, at least `margin` px inside it: somewhere a press grabs
 * the background, with room for a drag to stay over the level.
 */
function background(margin = 10): { x: number; y: number } {
  const v = viewport()
  for (let y = v.top + margin; y < v.bottom - margin; y += 7) {
    for (let x = v.left + margin; x < v.right - margin; x += 7) {
      const under = document.elementFromPoint(x, y)
      if (under !== null && level().contains(under) && under.closest('.local-node') === null) return { x, y }
    }
  }
  throw new Error('no background in the panel')
}

/** A real mouse drag from a point of the level's background, `dx` across and `dy` down. */
async function drag(dx: number, dy: number, margin = 10): Promise<void> {
  const from = background(margin)
  const box = level().getBoundingClientRect()
  const at = { x: from.x - box.left, y: from.y - box.top }
  await userEvent.dragAndDrop(level(), level(), { sourcePosition: at, targetPosition: { x: at.x + dx, y: at.y + dy } })
  await frame()
}

/** `at`, a point in this frame, where the page that holds the frame has it: CDP's mouse is the page's. */
function onPage(at: { x: number; y: number }): { x: number; y: number } {
  const f = (window.frameElement as HTMLElement).getBoundingClientRect()
  const scale = f.width / innerWidth
  return { x: f.left + at.x * scale, y: f.top + at.y * scale }
}

/** A real mouse event at `at`, a point in this frame; a move with `held` is one with the left button down. */
const mouse = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', at: { x: number; y: number }, held = false) =>
  cdp().send('Input.dispatchMouseEvent', {
    type,
    ...onPage(at),
    button: type === 'mouseMoved' && !held ? 'none' : 'left',
    buttons: held || type === 'mousePressed' ? 1 : 0,
    clickCount: type === 'mouseMoved' ? 0 : 1,
  })

/** Make the level `width` by `height` px and wait for it to be laid out for that width. */
async function panel(width: number, height: number): Promise<void> {
  level().style.flex = 'none'
  level().style.width = `${width}px`
  level().style.height = `${height}px`
  await until(() => Number.parseFloat(content().style.width) > 0, 'the level to be laid out')
  await frames()
}

/** The level's zoom as the page draws it: a node's width on screen over the width it was laid out at. */
function zoom(): number {
  const n = nodes()[0] as HTMLElement
  return n.getBoundingClientRect().width / n.offsetWidth
}

/** The wheel's delta that zooms by `f`: a notch of 100 px down zooms out by 1.1. */
const wheelBy = (f: number) => (-100 * Math.log(f)) / Math.log(1.1)

/** Whether the drawing is larger than its panel on either axis. */
const larger = () => content().offsetWidth > level().clientWidth || content().offsetHeight > level().clientHeight

/**
 * Whether `el`'s centre is at the panel's middle on `axis`, within a pixel, or the drawing is as near as it goes with
 * the panel still covered: its edge on that side at the panel's own.
 */
function centredOrClamped(el: HTMLElement, axis: 'x' | 'y'): boolean {
  const off = fromMiddle(el)[axis]
  const k = content().getBoundingClientRect()
  const v = viewport()
  if (Math.abs(off) <= 1) return true
  return axis === 'x'
    ? (off < 0 && Math.abs(k.left - v.left) <= 1) || (off > 0 && Math.abs(k.right - v.right) <= 1)
    : (off < 0 && Math.abs(k.top - v.top) <= 1) || (off > 0 && Math.abs(k.bottom - v.bottom) <= 1)
}

beforeAll(async () => {
  await page.viewport(1280, 2400)
  document.body.innerHTML = SHELL
  const view = await (await import('../../src/main')).ready
  await until(stateIdle, 'the app to settle')
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'fn f(n) { n } f(1)' } })
  await until(stateIdle, 'the app to settle on a program')
  tmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
  await until(() => tmPane().querySelector('.term-editor .cm-content') !== null, 'the copy to mount its editor')
  const copy = (await import('@codemirror/view')).EditorView.findFromDOM(editor())
  copy?.dispatch({ changes: { from: 0, to: copy.state.doc.length, insert: MACHINE } })
  await until(() => nodes().length === 11, 'the copy to draw s, the eight states before it and the two after')
  await panel(300, 160)
})

/** A press a failed case left down would hold the next case's: released, where CDP's mouse is what pressed it. */
afterEach(async () => {
  if (CHROMIUM) await mouse('mouseReleased', background())
})

describe('a level in its panel', () => {
  it('pans with a mouse drag on its background, by the distance dragged, on both axes', async () => {
    expect(larger(), 'precondition: larger than its panel').toBe(true)
    level().scrollLeft = 60
    level().scrollTop = 40
    await frame()
    const before = scroll()
    await drag(-50, -30, 60)
    expect(Math.abs(scroll().left - (before.left + 50)), 'scrollLeft moved by the drag').toBeLessThanOrEqual(1)
    expect(Math.abs(scroll().top - (before.top + 30)), 'scrollTop moved by the drag').toBeLessThanOrEqual(1)
  })

  it('stops a drag where a corner of the drawing reaches the middle of the panel', async () => {
    // TOWARDS THE BOTTOM RIGHT, from a scroll nearly as far that way as it goes: the drag is longer than what is left.
    level().scrollLeft = 10
    level().scrollTop = 10
    await frame()
    await drag(80, 60)
    let k = content().getBoundingClientRect()
    expect(Math.abs(k.left - middle().x), 'its left edge at the middle').toBeLessThanOrEqual(1)
    expect(Math.abs(k.top - middle().y), 'its top edge at the middle').toBeLessThanOrEqual(1)
    // AND TOWARDS THE TOP LEFT.
    level().scrollLeft = maxScroll().left - 10
    level().scrollTop = maxScroll().top - 10
    await frame()
    await drag(-80, -60, 60)
    k = content().getBoundingClientRect()
    expect(Math.abs(k.right - middle().x), 'its right edge at the middle').toBeLessThanOrEqual(1)
    expect(Math.abs(k.bottom - middle().y), 'its bottom edge at the middle').toBeLessThanOrEqual(1)
  })

  it('takes a click on a node, and pans without linking or moving the tab stop from a drag that starts on one', async (ctx) => {
    chromiumOnly(ctx, 'a press held through moves is CDP’s Input.dispatchMouseEvent, which only Chromium has')
    const k = content().getBoundingClientRect()
    level().scrollLeft += k.left - viewport().left
    level().scrollTop += k.top - viewport().top
    await frame()
    const start = scroll()
    const stop = nodes().find((n) => n.tabIndex === 0)
    const first = nodeNamed('before_s_number_0')
    const second = nodeNamed('before_s_number_1')
    expect(first.getBoundingClientRect().bottom, 'precondition: on screen').toBeLessThan(viewport().bottom)
    expect(second.getBoundingClientRect().bottom, 'precondition: on screen').toBeLessThan(viewport().bottom)
    // A DRAG FROM A NODE: pressed, moved past the threshold and released.
    const r = second.getBoundingClientRect()
    const from = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    const focused = document.activeElement
    await mouse('mouseMoved', from)
    await mouse('mousePressed', from)
    await mouse('mouseMoved', { x: from.x - 20, y: from.y - 15 }, true)
    await mouse('mouseMoved', { x: from.x - 40, y: from.y - 30 }, true)
    await mouse('mouseReleased', { x: from.x - 40, y: from.y - 30 })
    await frames()
    expect(Math.abs(scroll().left - start.left - 40), 'scrollLeft moved by the drag').toBeLessThanOrEqual(1)
    expect(Math.abs(scroll().top - start.top - 30), 'scrollTop moved by the drag').toBeLessThanOrEqual(1)
    // A COPY'S NODES LINK NOTHING (`transport.ts`'s `linkState`), so what a click does here is take the tab stop and
    // the focus, in the one handler that links: a drag that did neither linked nothing.
    // `state-diagram-local-layout.test.ts` links a node of the program's own machine in a panel too narrow for it.
    expect(
      nodes().find((n) => n.tabIndex === 0),
      'the tab stop',
    ).toBe(stop)
    expect(document.activeElement, 'the focus').toBe(focused)
    // A CLICK ON A NODE STILL REACHES IT, and its press, under the threshold, pans nothing.
    level().scrollLeft = start.left
    level().scrollTop = start.top
    await frame()
    await userEvent.click(first)
    await until(() => first.tabIndex === 0, 'the clicked node to take the tab stop')
    expect(scroll()).toEqual(start)
    expect(document.activeElement, 'the focus on the clicked node').toBe(first)
  })

  it('draws no focus ring on a node a click focuses after the keyboard was used', async () => {
    await userEvent.click(editor())
    await userEvent.keyboard('{ArrowRight}')
    const k = content().getBoundingClientRect()
    level().scrollLeft += k.left - viewport().left
    level().scrollTop += k.top - viewport().top
    await frame()
    const target = nodeNamed('before_s_number_2')
    expect(target.getBoundingClientRect().bottom, 'precondition: on screen').toBeLessThan(viewport().bottom)
    await userEvent.click(target)
    await until(() => document.activeElement === target, 'the clicked node to take the focus')
    expect(getComputedStyle(target).outlineStyle, 'its outline').toBe('none')
  })

  it('takes the focus from the editor into the level, with no ring, on a click on its background', async () => {
    await userEvent.click(editor())
    await userEvent.keyboard('{ArrowRight}')
    expect(editor().contains(document.activeElement), 'precondition: the focus in the editor').toBe(true)
    const from = background()
    const box = level().getBoundingClientRect()
    await userEvent.click(level(), { position: { x: from.x - box.left, y: from.y - box.top } })
    await frame()
    const focused = document.activeElement as HTMLElement
    expect(editor().contains(focused), 'the focus out of the editor').toBe(false)
    expect(level().contains(focused), 'the focus in the level').toBe(true)
    expect(getComputedStyle(focused).outlineStyle, 'its outline').toBe('none')
  })

  it('makes no tab stop of the level itself: Tab from the control before it reaches its node', async () => {
    // THE LAST CONTROL SHOWN AHEAD OF THE LEVEL, in its panel's header.
    const before = [...diagram().querySelectorAll<HTMLElement>('button, select, [tabindex="0"]')].filter(
      (el) =>
        el.checkVisibility() &&
        !level().contains(el) &&
        (el.compareDocumentPosition(level()) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    )
    const last = before.at(-1)
    if (last === undefined) throw new Error('precondition: a control ahead of the level')
    expect(larger(), 'precondition: larger than its panel, with somewhere to scroll').toBe(true)
    last.focus()
    await userEvent.tab()
    expect(document.activeElement, 'the level’s one stop').toBe(nodes().find((n) => n.tabIndex === 0))
  })

  it('draws an open hand over the level whether or not it fits its panel, and a closed one while it is dragged', async (ctx) => {
    chromiumOnly(ctx, 'a press held through moves is CDP’s Input.dispatchMouseEvent, which only Chromium has')
    level().scrollLeft = 40
    level().scrollTop = 40
    await frame()
    expect(getComputedStyle(level()).cursor, 'at rest').toBe('grab')
    const from = background()
    await mouse('mouseMoved', from)
    await mouse('mousePressed', from)
    await mouse('mouseMoved', { x: from.x + 10, y: from.y + 10 }, true)
    await frame()
    expect(getComputedStyle(level()).cursor, 'held').toBe('grabbing')
    await mouse('mouseReleased', { x: from.x + 10, y: from.y + 10 })
    await frame()
    expect(getComputedStyle(level()).cursor, 'released').toBe('grab')
    // A PANEL BIG ENOUGH FOR THE WHOLE LEVEL, which a drag moves all the same.
    try {
      await panel(1200, 1200)
      await until(() => !larger(), 'the level to fit its panel')
      expect(getComputedStyle(level()).cursor, 'fitting its panel').toBe('grab')
    } finally {
      await panel(300, 160)
    }
  })

  it('brings a node the keyboard moves to into view', async () => {
    level().scrollLeft = maxScroll().left
    level().scrollTop = 0
    await frame()
    // FROM THE CURRENT STATE TO ONE BEFORE IT, OFF SCREEN AT THE LEFT.
    nodeNamed('s').focus({ preventScroll: true })
    const v = viewport()
    expect(nodeNamed('before_s_number_0').getBoundingClientRect().left, 'precondition: off screen').toBeLessThan(v.left)
    await userEvent.keyboard('{ArrowLeft}')
    const moved = document.activeElement as HTMLElement
    expect(moved).toBe(nodeNamed('before_s_number_0'))
    await frames()
    const r = moved.getBoundingClientRect()
    expect(r.left, 'its left edge in the panel').toBeGreaterThanOrEqual(v.left - 0.5)
    expect(r.right, 'its right edge in the panel').toBeLessThanOrEqual(v.right + 0.5)
  })

  // THESE TWO LAST: they step the run on from `s`, which the cases above are drawn around.
  it('centres the current state after a step to a new one, and again after a resize when it was not moved', async () => {
    level().scrollLeft = 0
    level().scrollTop = maxScroll().top
    await frame()
    const at = tmStatus()
    control('▶')?.click()
    await until(() => tmStatus() !== at, 'the step')
    await until(
      () => nodeNamed('after_one_rule_on')?.classList.contains('is-current'),
      'the level around the next state',
    )
    await frames()
    const current = () => nodeNamed('after_one_rule_on')
    expect(larger(), 'precondition: larger than its panel').toBe(true)
    expect(centredOrClamped(current(), 'x'), `centred across, at ${JSON.stringify(scroll())}`).toBe(true)
    expect(centredOrClamped(current(), 'y'), `centred down, at ${JSON.stringify(scroll())}`).toBe(true)
    // RESIZES WITH NOTHING MOVED SINCE. First a panel wider than the level, which spreads it to the panel's width, so a
    // centring shows it whole, where a kept scroll or a kept place for the state would leave it off to one side.
    let before = group().firstElementChild
    await panel(1000, 160)
    await until(() => group().firstElementChild !== before, 'the level to be laid out again')
    await frames()
    expect(content().offsetWidth, 'precondition: spread to the panel').toBe(level().clientWidth)
    const k = content().getBoundingClientRect()
    expect(Math.abs(k.left - viewport().left), 'its left edge at the panel’s').toBeLessThanOrEqual(1)
    expect(Math.abs(k.right - viewport().right), 'its right edge at the panel’s').toBeLessThanOrEqual(1)
    expect(centredOrClamped(current(), 'y'), `centred down again, at ${JSON.stringify(scroll())}`).toBe(true)
    // THEN ONE NARROWER THAN IT, which must not leave the state where a scroll kept from the wide panel puts it.
    before = group().firstElementChild
    await panel(240, 160)
    await until(() => group().firstElementChild !== before, 'the level to be laid out again')
    await frames()
    expect(centredOrClamped(current(), 'x'), `centred across again, at ${JSON.stringify(scroll())}`).toBe(true)
    expect(centredOrClamped(current(), 'y'), `centred down again, at ${JSON.stringify(scroll())}`).toBe(true)
  })

  it('keeps where a drag left the current state through a resize', async () => {
    const current = () => nodeNamed('after_one_rule_on')
    const from = fromMiddle(current())
    await drag(-30, -20)
    const kept = fromMiddle(current())
    expect(Math.abs(kept.x - from.x + 30) + Math.abs(kept.y - from.y + 20), 'precondition: dragged').toBeLessThan(2)
    // A PANEL WIDER THAN THE LEVEL, which spreads it, so the current state moves within the drawing: what is kept is
    // where the state is in the panel, not the scroll.
    const before = group().firstElementChild
    const was = current().offsetLeft
    await panel(1000, 170)
    await until(() => group().firstElementChild !== before, 'the level to be laid out again')
    expect(Math.abs(current().offsetLeft - was), 'precondition: the state moved in the drawing').toBeGreaterThan(20)
    await frames()
    const now = fromMiddle(current())
    expect(Math.abs(now.x - kept.x), `across, ${now.x} for ${kept.x}`).toBeLessThanOrEqual(1)
    expect(Math.abs(now.y - kept.y), `down, ${now.y} for ${kept.y}`).toBeLessThanOrEqual(1)
  })
})

describe('the zoom', () => {
  /** Where the run stands as this describe begins: the cases above stepped it from `s` to the state after it. */
  const current = () => nodes().find((n) => n.classList.contains('is-current')) as HTMLElement
  /** Whether a press of the `mouse` command is down, for `afterEach` to release. */
  let held = false

  /**
   * A real mouse event at `at`, a point in this frame, in either engine: Playwright's mouse, which a press holds. A
   * press or release of `clickCount` 2 is a double-click's second, as the system would count it.
   */
  async function press(type: 'move' | 'down' | 'up', at: { x: number; y: number }, clickCount = 1): Promise<void> {
    const p = onPage(at)
    await commands.mouse(type, p.x, p.y, clickCount)
    if (type !== 'move') held = type === 'down'
  }

  /**
   * A node wholly in the panel and off its middle, so a zoom about any point but the pointer's would move it, and the
   * wheel's pointer reaches it without scrolling it into view.
   */
  function nodeOffMiddle(): HTMLElement {
    const v = viewport()
    const found = nodes().find((n) => {
      const r = n.getBoundingClientRect()
      const off = fromMiddle(n)
      return (
        r.left > v.left && r.right < v.right && r.top > v.top && r.bottom < v.bottom && Math.hypot(off.x, off.y) > 30
      )
    })
    if (found === undefined) throw new Error('precondition: a node in the panel, off its middle')
    return found
  }

  /** Back to full size with the `0` key, from the level's tab stop. */
  async function unzoom(): Promise<void> {
    nodes()
      .find((n) => n.tabIndex === 0)
      ?.focus({ preventScroll: true })
    await userEvent.keyboard('0')
    await frames()
  }

  beforeAll(async () => {
    await panel(300, 160)
  })

  afterEach(async () => {
    if (held) await press('up', background())
    if (Math.abs(zoom() - 1) > 0.001) await unzoom()
    await panel(300, 160)
  })

  it('zooms with the wheel about the point under the pointer, in and out', async () => {
    // A PANEL LARGER THE OTHERS' HAS MORE THAN ONE NODE OFF ITS MIDDLE.
    await panel(500, 300)
    const target = nodeOffMiddle()
    // WHERE THE WHEEL WAS, AS ITS EVENT SAYS: the pointer's own place, which an engine may round.
    let at = { x: Number.NaN, y: Number.NaN }
    const heard = (e: WheelEvent) => {
      at = { x: e.clientX, y: e.clientY }
    }
    level().addEventListener('wheel', heard, { capture: true })
    try {
      for (const [f, to] of [
        [1.5, 1.5],
        [0.6, 0.9],
      ] as const) {
        // HOVERED FIRST, as the wheel's own hover would scroll the page to bring the node into view after these reads.
        await userEvent.hover(target)
        const r = target.getBoundingClientRect()
        const was = { zoom: zoom(), content: content().getBoundingClientRect() }
        await userEvent.wheel(target, { delta: { y: wheelBy(f) } })
        await frame()
        // OVER THE NODE, though not at its exact centre: an engine rounds the pointer's place in the page that holds
        // the frame, which scales it.
        expect(at.x > r.left && at.x < r.right && at.y > r.top && at.y < r.bottom, 'precondition: over the node').toBe(
          true,
        )
        expect(zoom(), `zoomed to ${to}`).toBeCloseTo(to, 2)
        // THE DRAWING'S POINT AT THE POINTER, in its own pixels, before and after: on screen within a pixel.
        const k = content().getBoundingClientRect()
        const point = { x: (at.x - was.content.left) / was.zoom, y: (at.y - was.content.top) / was.zoom }
        const now = { x: (at.x - k.left) / zoom(), y: (at.y - k.top) / zoom() }
        expect(Math.abs(now.x - point.x) * zoom(), `at ${to}, across`).toBeLessThanOrEqual(1)
        expect(Math.abs(now.y - point.y) * zoom(), `at ${to}, down`).toBeLessThanOrEqual(1)
      }
    } finally {
      level().removeEventListener('wheel', heard, { capture: true })
    }
  })

  it('zooms in to three times its size, and out to where the whole level fits, half its size, or 5%', async () => {
    await userEvent.wheel(level(), { delta: { y: wheelBy(10) } })
    await frame()
    expect(zoom(), 'in as far as it goes').toBeCloseTo(3, 3)
    // IN THIS PANEL THE WHOLE LEVEL FITS AT LESS THAN HALF ITS SIZE, so that is as far out as it goes.
    await userEvent.wheel(level(), { delta: { y: wheelBy(0.01) } })
    await frame()
    let k = content().getBoundingClientRect()
    let v = viewport()
    expect(zoom(), 'precondition: the level fits at less than half its size').toBeLessThan(0.5)
    expect(k.width, 'no wider than its panel').toBeLessThanOrEqual(v.right - v.left + 0.5)
    expect(k.height, 'no taller than its panel').toBeLessThanOrEqual(v.bottom - v.top + 0.5)
    expect(
      Math.min(v.right - v.left - k.width, v.bottom - v.top - k.height),
      'as wide or as tall as its panel',
    ).toBeLessThanOrEqual(0.5)
    // A PANEL IT FITS AT MORE THAN HALF ITS SIZE: half its size. From full size, as a zoom already past an end is kept
    // through a resize and moved no further past it.
    await unzoom()
    await panel(1200, 1200)
    await userEvent.wheel(level(), { delta: { y: wheelBy(0.01) } })
    await frame()
    expect(zoom(), 'half its size').toBeCloseTo(0.5, 3)
    k = content().getBoundingClientRect()
    v = viewport()
    expect(k.width, 'precondition: half its panel’s width or less').toBeLessThanOrEqual((v.right - v.left) / 2 + 0.5)
    expect(k.height, 'precondition: half its panel’s height or less').toBeLessThanOrEqual((v.bottom - v.top) / 2 + 0.5)
    // A PANEL SO SMALL THAT THE LEVEL FITS IT ONLY AT LESS THAN 5% OF ITS SIZE: 5%.
    await panel(24, 6)
    await userEvent.wheel(level(), { delta: { y: wheelBy(0.0001) } })
    await frame()
    expect(zoom(), '5% of its size').toBeCloseTo(0.05, 3)
  })

  it('zooms the level and not the page with Ctrl and the wheel, as a pinch sends it', async () => {
    const seen: { ctrl: boolean; stopped: boolean }[] = []
    const heard = (e: WheelEvent) => seen.push({ ctrl: e.ctrlKey, stopped: e.defaultPrevented })
    window.addEventListener('wheel', heard)
    const scale = visualViewport?.scale
    const ratio = devicePixelRatio
    try {
      await userEvent.keyboard('{Control>}')
      await userEvent.wheel(level(), { delta: { y: wheelBy(1.5) } })
    } finally {
      await userEvent.keyboard('{/Control}')
      window.removeEventListener('wheel', heard)
    }
    await frames()
    expect(seen.length, 'precondition: the wheel heard').toBeGreaterThan(0)
    expect(
      seen.every((e) => e.ctrl),
      'precondition: with Ctrl',
    ).toBe(true)
    expect(zoom(), 'the level zoomed').toBeCloseTo(1.5, 2)
    expect(
      seen.every((e) => e.stopped),
      "the browser's own zoom stopped",
    ).toBe(true)
    expect(visualViewport?.scale, 'the page unzoomed').toBe(scale)
    expect(devicePixelRatio, 'the page unzoomed').toBe(ratio)
  })

  it('does not scroll the TM view with the wheel over the level, and does over the rest of it', async () => {
    const view = level().closest('.pane') as HTMLElement
    view.style.maxHeight = '320px'
    try {
      await frames()
      expect(view.scrollHeight - view.clientHeight, 'precondition: the view scrolls').toBeGreaterThan(100)
      // THE LEVEL IN SIGHT AT THE VIEW'S FOOT, so the wheel is over it and the view can scroll up.
      level().scrollIntoView({ block: 'end' })
      await frame()
      const top = view.scrollTop
      expect(top, 'precondition: the view can scroll up').toBeGreaterThan(20)
      // AT THE TOP OF ITS SCROLL, AND ZOOMED IN ABOUT THE DRAWING'S TOP EDGE AT ITS MIDDLE, which keeps it there: a
      // wheel up that it left to the browser would find the level with nowhere to go and scroll the view.
      level().scrollTop = 0
      await frame()
      await userEvent.wheel(level(), { delta: { y: -200 } })
      await frames()
      expect(zoom(), 'precondition: the wheel reached the level').toBeGreaterThan(1)
      expect(level().scrollTop, 'precondition: the level at the top of its scroll').toBeLessThanOrEqual(1)
      expect(view.scrollTop, 'the view where it was').toBe(top)
      // FIREFOX KEEPS A RUN OF WHEEL EVENTS ON WHAT THE FIRST ONE SCROLLED until the mouse moves after a pause.
      await new Promise((r) => setTimeout(r, 200))
      const header = diagram().querySelector('.panel-header') as HTMLElement
      await userEvent.wheel(header, { delta: { y: -200 } })
      await until(() => view.scrollTop !== top, 'the wheel over the view, off the level, to scroll it')
    } finally {
      view.style.maxHeight = ''
    }
  })

  it('goes back to full size, centred on the current state, on a double-click on its background or the 0 key', async () => {
    for (const how of ['double-click', '0'] as const) {
      await userEvent.wheel(current(), { delta: { y: wheelBy(1.8) } })
      await frame()
      expect(zoom(), `precondition: zoomed, for the ${how}`).toBeCloseTo(1.8, 2)
      await drag(-25, -15)
      expect(Math.hypot(fromMiddle(current()).x, fromMiddle(current()).y), 'precondition: moved').toBeGreaterThan(10)
      const from = background()
      const box = level().getBoundingClientRect()
      if (how === 'double-click') {
        await userEvent.dblClick(level(), { position: { x: from.x - box.left, y: from.y - box.top } })
      } else {
        await userEvent.click(level(), { position: { x: from.x - box.left, y: from.y - box.top } })
        await userEvent.keyboard('0')
      }
      await frames()
      expect(zoom(), `full size, after the ${how}`).toBeCloseTo(1, 3)
      expect(centredOrClamped(current(), 'x'), `centred across, after the ${how}`).toBe(true)
      expect(centredOrClamped(current(), 'y'), `centred down, after the ${how}`).toBe(true)
    }
  })

  it('zooms in with + and =, and out with -, about the middle of the panel', async () => {
    const from = background()
    const box = level().getBoundingClientRect()
    await userEvent.click(level(), { position: { x: from.x - box.left, y: from.y - box.top } })
    expect(level().contains(document.activeElement), 'precondition: the focus in the level').toBe(true)
    const n = current()
    let was = { zoom: zoom(), off: fromMiddle(n) }
    for (const [key, by] of [
      ['+', 1.1],
      ['=', 1.1],
      ['-', 1 / 1.1],
    ] as const) {
      await userEvent.keyboard(key)
      await frame()
      const now = { zoom: zoom(), off: fromMiddle(n) }
      expect(now.zoom / was.zoom, `${key} zooms by ${by}`).toBeCloseTo(by, 3)
      // THE POINT AT THE MIDDLE STAYS THERE, so every other point moves away from it or towards it with the zoom.
      expect(Math.abs(now.off.x - was.off.x * by), `${key}, across`).toBeLessThanOrEqual(1)
      expect(Math.abs(now.off.y - was.off.y * by), `${key}, down`).toBeLessThanOrEqual(1)
      was = now
    }
  })

  it('stops a drag where a corner of the drawing reaches the middle of the panel, at half and at twice its size', async () => {
    for (const f of [0.5, 2]) {
      await userEvent.wheel(level(), { delta: { y: wheelBy(f) } })
      await frame()
      expect(zoom(), `precondition: at ${f}`).toBeCloseTo(f, 2)
      level().scrollLeft = 10
      level().scrollTop = 10
      await frame()
      await drag(80, 60)
      let k = content().getBoundingClientRect()
      expect(Math.abs(k.left - middle().x), `at ${f}, its left edge at the middle`).toBeLessThanOrEqual(1)
      expect(Math.abs(k.top - middle().y), `at ${f}, its top edge at the middle`).toBeLessThanOrEqual(1)
      level().scrollLeft = maxScroll().left - 10
      level().scrollTop = maxScroll().top - 10
      await frame()
      await drag(-80, -60, 60)
      k = content().getBoundingClientRect()
      expect(Math.abs(k.right - middle().x), `at ${f}, its right edge at the middle`).toBeLessThanOrEqual(1)
      expect(Math.abs(k.bottom - middle().y), `at ${f}, its bottom edge at the middle`).toBeLessThanOrEqual(1)
      await unzoom()
    }
  })

  it('keeps the point under the pointer through many small wheel events, as a trackpad sends', async () => {
    await panel(500, 300)
    const target = nodeOffMiddle()
    // WHERE THE POINTER, THE NODE AND THE PANEL WERE AT THE FIRST EVENT, before the level heard it. Measured from the
    // panel, which in Chromium moved a few pixels up the page during the run of events: the zoom keeps the point
    // under the pointer in the panel, and does not move the panel.
    const seen: { at: { x: number; y: number }; box: DOMRect; panel: ReturnType<typeof viewport> }[] = []
    const heard = (e: WheelEvent) => {
      seen.push({ at: { x: e.clientX, y: e.clientY }, box: target.getBoundingClientRect(), panel: viewport() })
    }
    level().addEventListener('wheel', heard, { capture: true })
    try {
      await userEvent.hover(target)
      await userEvent.wheel(target, { delta: { y: -4 }, times: 60 })
      await frame()
      const first = seen[0]
      if (first === undefined) throw new Error('precondition: the wheel heard')
      const { at, box, panel: was } = first
      expect(
        seen.every((e) => e.at.x === at.x && e.at.y === at.y),
        'precondition: the pointer did not move',
      ).toBe(true)
      expect(at.x > box.left && at.x < box.right && at.y > box.top && at.y < box.bottom, 'precondition: over it').toBe(
        true,
      )
      expect(zoom(), 'zoomed by 60 small steps').toBeCloseTo(1.1 ** 2.4, 2)
      // THE NODE'S POINT UNDER THE POINTER, as a share of its box, which scales with it: on screen within a pixel.
      const share = { x: (at.x - box.left) / box.width, y: (at.y - box.top) / box.height }
      const r = target.getBoundingClientRect()
      const v = viewport()
      expect(Math.abs(r.left + share.x * r.width - v.left - (at.x - was.left)), 'across').toBeLessThanOrEqual(1)
      expect(Math.abs(r.top + share.y * r.height - v.top - (at.y - was.top)), 'down').toBeLessThanOrEqual(1)
    } finally {
      level().removeEventListener('wheel', heard, { capture: true })
    }
  })

  it('goes on with a drag from where 0 left the level', async () => {
    await userEvent.wheel(level(), { delta: { y: wheelBy(2) } })
    await frame()
    expect(zoom(), 'precondition: zoomed').toBeCloseTo(2, 2)
    // WHERE THE POINTER WAS, AS ITS EVENTS SAY: the pointer's own place, which an engine may round.
    let at = { x: Number.NaN, y: Number.NaN }
    const heard = (e: PointerEvent) => {
      at = { x: e.clientX, y: e.clientY }
    }
    document.addEventListener('pointermove', heard, { capture: true })
    try {
      const from = background(40)
      await press('move', from)
      await press('down', from)
      await press('move', { x: from.x - 10, y: from.y - 6 })
      await frame()
      expect(level().dataset.dragging, 'precondition: panning').toBe('true')
      nodes()
        .find((n) => n.tabIndex === 0)
        ?.focus({ preventScroll: true })
      await userEvent.keyboard('0')
      await frames()
      expect(zoom(), 'precondition: full size').toBeCloseTo(1, 3)
      const was = { scroll: scroll(), at }
      await press('move', { x: from.x - 20, y: from.y - 12 })
      await frame()
      expect(at.x, 'precondition: the pointer moved').toBeLessThan(was.at.x)
      expect(
        Math.abs(scroll().left - was.scroll.left + at.x - was.at.x),
        'moved on by the drag, across',
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(scroll().top - was.scroll.top + at.y - was.at.y),
        'moved on by the drag, down',
      ).toBeLessThanOrEqual(1)
    } finally {
      document.removeEventListener('pointermove', heard, { capture: true })
    }
  })

  it('ends a press whose release does not come when it loses its capture or the window its focus', async () => {
    let id = Number.NaN
    const pressed = (e: PointerEvent) => {
      id = e.pointerId
    }
    let lost = false
    const losing = () => {
      lost = true
    }
    level().addEventListener('pointerdown', pressed)
    level().addEventListener('lostpointercapture', losing)
    try {
      // FIREFOX FIRES NO `lostpointercapture` FOR A CAPTURE THE PAGE RELEASES WHILE THE BUTTON IS HELD: none came within
      // 2 s of the release, nor by the frame after the next move.
      for (const how of CHROMIUM
        ? (['the capture lost', 'the window blurred'] as const)
        : (['the window blurred'] as const)) {
        const from = background(40)
        await press('move', from)
        await press('down', from)
        await press('move', { x: from.x - 10, y: from.y - 6 })
        await frame()
        expect(level().dataset.dragging, `precondition: panning, for ${how}`).toBe('true')
        // A DRAW THAT WAITS FOR THE PRESS: a resize, which lays the level out for its new width.
        const before = group().firstElementChild
        await panel(level().offsetWidth === 400 ? 300 : 400, 160)
        expect(group().firstElementChild, `precondition: the layout waits, for ${how}`).toBe(before)
        // THE BLUR IS THE WINDOW'S OWN EVENT, as a switch to another window sends it: moving the focus out of this frame
        // for real would take the keys the later cases type with it.
        if (how === 'the capture lost') {
          lost = false
          level().releasePointerCapture(id)
        } else {
          window.dispatchEvent(new FocusEvent('blur'))
        }
        const was = scroll()
        await press('move', { x: from.x - 30, y: from.y - 20 })
        await frame()
        expect(level().dataset.dragging, `no longer panning, after ${how}; capture lost heard: ${lost}`).toBeUndefined()
        expect(scroll(), `not moved by the pointer, after ${how}`).toEqual(was)
        await until(() => group().firstElementChild !== before, `the waiting layout, after ${how}`)
        await press('up', { x: from.x - 30, y: from.y - 20 })
        await frames()
      }
    } finally {
      level().removeEventListener('pointerdown', pressed)
      level().removeEventListener('lostpointercapture', losing)
    }
  })

  it('ends a press at a move with no button held, as after a release the page did not hear', async (ctx) => {
    if (!CHROMIUM) ctx.skip()
    const from = background(40)
    await mouse('mouseMoved', from)
    await mouse('mousePressed', from)
    await mouse('mouseMoved', { x: from.x - 30, y: from.y - 20 })
    await frame()
    expect(level().dataset.dragging, 'no pan by a pointer with no button held').toBeUndefined()
    const before = group().firstElementChild
    await panel(400, 160)
    await until(() => group().firstElementChild !== before, 'the layout, with no press to wait for')
  })

  it('does not go back to full size for a double-click either of whose presses was a drag', async () => {
    for (const [first, second, resets] of [
      ['click', 'click', true],
      ['drag', 'drag', false],
      ['drag', 'click', false],
      ['click', 'drag', false],
    ] as const) {
      const how = `${first} then ${second}`
      await userEvent.wheel(level(), { delta: { y: wheelBy(1.8) } })
      await frame()
      expect(zoom(), `precondition: zoomed, for ${how}`).toBeCloseTo(1.8, 2)
      // FROM ONE SPOT, AS THE SYSTEM COUNTS A DOUBLE-CLICK: the second press and its release count 2. A drag goes out
      // and back, so the spot is still the background for the press after it.
      const from = background(60)
      for (const [i, gesture] of [first, second].entries()) {
        await press('move', from)
        await press('down', from, i + 1)
        if (gesture === 'drag') {
          await press('move', { x: from.x - 30, y: from.y - 20 })
          await press('move', from)
        }
        await press('up', from, i + 1)
        await frames()
      }
      expect(zoom(), `after ${how}`).toBeCloseTo(resets ? 1 : 1.8, 2)
      if (!resets) await unzoom()
    }
  })

  // THESE TWO LAST: they step the run, back and on, which the cases above are drawn around.
  it('keeps the zoom through a step to a new state, which it centres at that zoom, and through a resize', async () => {
    await userEvent.wheel(level(), { delta: { y: wheelBy(1.6) } })
    await frame()
    expect(zoom(), 'precondition: zoomed').toBeCloseTo(1.6, 2)
    const was = current()
    const at = tmStatus()
    control('◀')?.click()
    await until(() => tmStatus() !== at, 'the step back')
    await until(() => current() !== undefined && current().title !== was.title, 'the level around the state before')
    await frames()
    expect(zoom(), 'after the step').toBeCloseTo(1.6, 3)
    expect(centredOrClamped(current(), 'x'), 'centred across').toBe(true)
    expect(centredOrClamped(current(), 'y'), 'centred down').toBe(true)
    const before = group().firstElementChild
    await panel(500, 200)
    await until(() => group().firstElementChild !== before, 'the level to be laid out again')
    await frames()
    expect(zoom(), 'after the resize').toBeCloseTo(1.6, 3)
  })

  it('does not move under the pointer for a step during a drag, and centres the new state after it', async () => {
    const from = background(40)
    await press('move', from)
    await press('down', from)
    await press('move', { x: from.x - 10, y: from.y - 6 })
    await frame()
    expect(level().dataset.dragging, 'precondition: panning').toBe('true')
    const dragged = scroll()
    const drawn = nodes()
    const at = tmStatus()
    control('▶')?.click()
    await until(() => tmStatus() !== at, 'the step')
    await frames()
    expect(scroll(), 'where the drag left it').toEqual(dragged)
    expect(nodes(), 'the same drawing').toEqual(drawn)
    await press('move', { x: from.x - 20, y: from.y - 12 })
    await frame()
    expect(Math.abs(scroll().left - dragged.left - 10), 'moved on by the drag, across').toBeLessThanOrEqual(1)
    expect(Math.abs(scroll().top - dragged.top - 6), 'moved on by the drag, down').toBeLessThanOrEqual(1)
    await press('up', { x: from.x - 20, y: from.y - 12 })
    await until(() => nodes()[0] !== drawn[0], 'the level around the new state')
    await frames()
    expect(centredOrClamped(current(), 'x'), 'the new state centred across').toBe(true)
    expect(centredOrClamped(current(), 'y'), 'the new state centred down').toBe(true)
  })
})
