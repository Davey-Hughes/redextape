import type { EditorView } from '@codemirror/view'
import INTER from '@fontsource/inter/files/inter-latin-400-normal.woff2?url'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import IS_EVEN from '../../src/examples/is-even.rxt?raw'
import { CAP_CHARS } from '../../src/local-layout'
import type { TmProgram } from '../../src/types'
import {
  controlState,
  diagram,
  diagramChoice,
  frame,
  frames,
  SHELL,
  stateIdle,
  tmPane,
  tmStatus,
  tmWalk,
  until,
  walkInParts,
} from './harness'
import { mountTmFixture } from './tm-fixture'

/**
 * How the state diagram's local level is laid out (`docs/superpowers/specs/2026-11-16-state-diagram-tidy-design.md`):
 * names cut in the middle, labels clear of the nodes, the self-loops and each other, a rule per line, the drawing
 * centred in its panel, every state kept in a panel too narrow for them, and a drag that moves a level its panel fits
 * (decision 11). Measured on the level the user's screenshot shows: `is_even(6)` under the binary encoding at step 276,
 * whose five names share their first eleven characters; and text measured again on a TM view of its own, whose names
 * are a letter each.
 */

let view: EditorView

const level = () => diagram().querySelector('.local-level') as HTMLElement
const nodes = () => [...diagram().querySelectorAll<HTMLElement>('.local-node')]
const labels = () => [...diagram().querySelectorAll<SVGTextElement>('.local-label')]
const loops = () =>
  [...diagram().querySelectorAll<SVGPathElement>('.local-edge')].filter((p) => p.dataset.from === p.dataset.to)

/**
 * The page's box of `p`'s stroke: its geometry and half the stroke's width either side, the line a reader sees. Not its
 * client rectangle, which Firefox pads by more than the stroke, and Chromium not at all.
 */
function strokeBox(p: SVGPathElement): DOMRect {
  const b = p.getBBox()
  const half = Number.parseFloat(getComputedStyle(p).strokeWidth) / 2
  const m = p.getScreenCTM()
  if (m === null) throw new Error('a path with no screen transform')
  return new DOMRect(
    m.e + (b.x - half) * m.a,
    m.f + (b.y - half) * m.d,
    (b.width + 2 * half) * m.a,
    (b.height + 2 * half) * m.d,
  )
}
const nodeOf = (state: string | undefined) =>
  diagram().querySelector<HTMLElement>(`.local-node[data-state="${state}"]`) as HTMLElement
const columns = () => nodes().map((n) => Number(n.dataset.column))
const drawing = () => diagram().querySelector('.local-drawing') as HTMLElement
const wider = () => drawing().offsetWidth > level().clientWidth

/** The level's scrolled box, as the page sees it: inside its border. */
function viewport(): { left: number; top: number; right: number; bottom: number } {
  const box = level().getBoundingClientRect()
  const left = box.left + level().clientLeft
  const top = box.top + level().clientTop
  return { left, top, right: left + level().clientWidth, bottom: top + level().clientHeight }
}

/** A point of the level's scrolled box with no node under it. */
function background(): { x: number; y: number } {
  const v = viewport()
  for (let y = v.top + 10; y < v.bottom - 10; y += 7) {
    for (let x = v.left + 10; x < v.right - 10; x += 7) {
      const under = document.elementFromPoint(x, y)
      if (under !== null && level().contains(under) && under.closest('.local-node') === null) return { x, y }
    }
  }
  throw new Error('no background in the panel')
}

/**
 * Set the viewport so the level is `width` px wide, scroll bar included: the TM view spans the row, so the level
 * narrows with the viewport pixel for pixel.
 */
async function levelWidth(width: number): Promise<void> {
  const chrome = window.innerWidth - level().offsetWidth
  await page.viewport(width + chrome, 2400)
  await until(() => level().offsetWidth === width, `the level to be ${width} px wide`)
  await frame()
}

/** Whether two boxes overlap by more than half a pixel each way: a shared edge is not a meeting. */
const meets = (a: DOMRect, b: DOMRect) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5

/** The space between what the level draws and its scrolled box's top and bottom, at its current scroll. */
function margins(): { above: number; below: number } {
  const drawn = [...nodes(), ...diagram().querySelectorAll('.local-edges > *')].map((el) => el.getBoundingClientRect())
  const box = level().getBoundingClientRect()
  const top = box.top + level().clientTop
  return {
    above: Math.min(...drawn.map((r) => r.top)) - top,
    below: top + level().clientHeight - Math.max(...drawn.map((r) => r.bottom)),
  }
}

beforeAll(async () => {
  await page.viewport(1280, 2400)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  // THE TM VIEW ALONE IN ITS ROW, as `state-diagram-local.test.ts` has it: closed through the rxm view's own `✕`.
  document.querySelector<HTMLButtonElement>('[data-leaf="rxm-0"] button.view-close')?.click()
  await until(() => document.querySelector('[data-leaf="rxm-0"]') === null, 'the rxm view to close')
  // PICKED FROM THE MENU, AS THE USER DID: a pick also sets the binary encoding, whose names the screenshot shows.
  await userEvent.click(document.querySelector('#examples') as HTMLElement)
  await userEvent.click(document.querySelector('#examples-menu [data-example="is-even"]') as HTMLElement)
  await until(() => view.state.doc.toString() === IS_EVEN && stateIdle() && tmStatus() !== '', 'is_even(6) to compile')
  tmPane().querySelector<HTMLButtonElement>('[data-panel="rules"] .panel-toggle')?.click()
})
/** 276 steps from step 0, the first in `bpf31.l2.r1.rw0`, in two hooks so neither runs long under a loaded suite. */
for (const part of walkInParts(tmWalk(tmPane, /^bpf31\.l2\.r1\.rw0 /, 'in bpf31.l2.r1.rw0', true), [140])) {
  beforeAll(part)
}
beforeAll(async () => {
  await userEvent.click(diagramChoice('local') as HTMLButtonElement)
  await until(() => nodes().some((n) => n.title === 'bpf31.l2.r1.rw0'), 'the local level around bpf31.l2.r1.rw0')
  await frames()
})

describe("the screenshot's level", () => {
  it('shows every name in full or cut in its middle, so different names read differently', () => {
    expect(tmStatus()).toMatch(/^bpf31\.l2\.r1\.rw0 /)
    const all = nodes()
    expect(all.map((n) => n.title)).toEqual([
      'bpf31.l2.r1.rw2',
      'bpf31.l2.r1.rw1',
      'bpf31.l2.r1.rw0',
      'bpf31.l2.r1.home',
      'bpf31.l2.r2.home',
    ])
    // WHAT IS DRAWN IS THE WHOLE TEXT, nothing clipped by an ellipsis of the browser's own: only then is the text
    // below what a reader sees.
    for (const n of all) expect(n.scrollWidth, n.title).toBeLessThanOrEqual(n.clientWidth)
    const shown = all.map((n) => n.textContent)
    expect(new Set(shown).size).toBe(new Set(all.map((n) => n.title)).size)
    // The full name is still the node's: on hover and as the name a screen reader reads.
    for (const n of all) expect(n.getAttribute('aria-label')).toBe(n.title)
    // AND NO BOX IS WIDER THAN THE CAP: `CAP_CHARS` characters of its own font, in a span set beside it.
    for (const n of all) {
      const cap = document.createElement('span')
      cap.style.font = getComputedStyle(n).font
      cap.style.position = 'absolute'
      cap.textContent = '0'.repeat(CAP_CHARS)
      document.body.append(cap)
      const style = getComputedStyle(n)
      const text = n.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
      expect(text, n.title).toBeLessThanOrEqual(cap.getBoundingClientRect().width + 1)
      cap.remove()
    }
  })

  it('keeps every label off the nodes, the self-loops and the other labels', () => {
    const boxes = labels().map((l) => ({ l, r: l.getBoundingClientRect() }))
    expect(boxes.length).toBe(8)
    for (const { l, r } of boxes) {
      const at = `${l.dataset.from}->${l.dataset.to}`
      for (const n of nodes()) expect(meets(r, n.getBoundingClientRect()), `${at} on node ${n.title}`).toBe(false)
      for (const p of loops()) expect(meets(r, strokeBox(p)), `${at} on loop ${p.dataset.from}`).toBe(false)
      for (const o of boxes)
        if (o.l !== l) expect(meets(r, o.r), `${at} on ${o.l.dataset.from}->${o.l.dataset.to}`).toBe(false)
    }
  })

  it("sets each self-loop's rules a line each, above its arc", () => {
    expect(loops()).toHaveLength(4)
    for (const p of loops()) {
      const label = labels().find((l) => l.dataset.from === p.dataset.from && l.dataset.to === p.dataset.to)
      const lines = [...(label?.querySelectorAll('tspan') ?? [])].map((t) => t.getBoundingClientRect())
      // Two rules each (`REG:0 L` and `REG:1 L`, or `WORK:`'s), one under the other, the lower over the arc.
      expect(lines).toHaveLength(2)
      expect(lines[1]?.top).toBeGreaterThanOrEqual(lines[0]?.bottom ?? Number.NaN)
      expect(lines[1]?.bottom).toBeLessThanOrEqual(strokeBox(p).top)
    }
  })

  it('widens the gaps between the boxes to the labels they hold', async () => {
    // NARROWER THAN THE LEVEL'S OWN WIDTH, so it scrolls sideways rather than spreading its gaps over a wider panel,
    // which would make room for any label whatever the gaps were laid out for.
    const svg = diagram().querySelector('.local-edges') as SVGSVGElement
    await page.viewport(400, 2400)
    try {
      await until(() => Number(svg.getAttribute('width')) > level().clientWidth, 'the level to be wider than its panel')
      const forward = labels().filter((l) => l.dataset.from !== l.dataset.to)
      expect(forward).toHaveLength(4)
      for (const l of forward) {
        const r = l.getBoundingClientRect()
        expect(r.left).toBeGreaterThan(nodeOf(l.dataset.from).getBoundingClientRect().right)
        expect(r.right).toBeLessThan(nodeOf(l.dataset.to).getBoundingClientRect().left)
      }
    } finally {
      await page.viewport(1280, 2400)
      await until(() => Number(svg.getAttribute('width')) === level().clientWidth, 'the level to span its panel again')
    }
  })

  it("keeps two rules each way in the screenshot's 844 px panel, and shows all of it there", async () => {
    try {
      await levelWidth(844)
      expect(columns()).toEqual([-2, -1, 0, 1, 2])
      expect(wider()).toBe(false)
      const k = drawing().getBoundingClientRect()
      expect(k.left, 'its left edge in the panel').toBeGreaterThanOrEqual(viewport().left - 0.5)
      expect(k.right, 'its right edge in the panel').toBeLessThanOrEqual(viewport().right + 0.5)
    } finally {
      await page.viewport(1280, 2400)
    }
  })

  it('keeps every state in a panel too narrow for the level, which then shows part of it', async () => {
    const group = diagram().querySelector('.local-nodes') as HTMLElement
    const wide = nodes().map((n) => [n.title, n.dataset.column])
    try {
      await levelWidth(600)
      await until(() => wider(), 'the level to be wider than its panel')
      expect(nodes().map((n) => [n.title, n.dataset.column])).toEqual(wide)
      expect(columns()).toEqual([-2, -1, 0, 1, 2])
      expect(group.getAttribute('aria-label')).toBe('states within 2 rules')
      expect(level().hasAttribute('title')).toBe(false)
      // ITS LABELS STILL CLEAR EVERYTHING, in the gaps of its five columns.
      for (const l of labels().filter((l) => l.dataset.from !== l.dataset.to)) {
        const r = l.getBoundingClientRect()
        expect(r.left).toBeGreaterThan(nodeOf(l.dataset.from).getBoundingClientRect().right)
        expect(r.right).toBeLessThan(nodeOf(l.dataset.to).getBoundingClientRect().left)
      }
      // A CLICK ON A NODE STILL LINKS IT where a press may be a drag (`state-diagram-local-pan.test.ts`).
      const near = nodes().find(
        (n) => n.dataset.column === '-1' && n.getBoundingClientRect().left > level().getBoundingClientRect().left,
      )
      await userEvent.click(near as HTMLElement)
      await until(() => near?.classList.contains('is-linked') === true, 'the clicked state to be linked')
    } finally {
      await page.viewport(1280, 2400)
    }
    await until(() => !wider(), 'the level to fit a wide panel again')
    expect(nodes().map((n) => [n.title, n.dataset.column])).toEqual(wide)
  })

  it('is centred in a panel taller than it, and centred again when the panel changes height', async () => {
    const before = level().clientHeight
    const { above, below } = margins()
    expect(above).toBeGreaterThan(20)
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1)
    // The rules panel opens above it and takes a share of the view's height.
    await userEvent.click(tmPane().querySelector('[data-panel="rules"] .panel-toggle') as HTMLElement)
    await until(() => level().clientHeight < before - 20, 'the diagram panel to shrink')
    await frame()
    const after = margins()
    expect(Math.abs(after.above - after.below)).toBeLessThanOrEqual(1)
    expect(after.above).toBeLessThan(above)
  })

  // AFTER THE CENTRING CASES: a level the user moved keeps where they left it through a resize.
  it("moves with a mouse drag in the screenshot's 844 px panel, which it fits, by the distance dragged", async () => {
    try {
      await levelWidth(844)
      expect(wider(), 'precondition: it fits across').toBe(false)
      const before = { left: level().scrollLeft, top: level().scrollTop }
      const from = background()
      const box = level().getBoundingClientRect()
      const at = { x: from.x - box.left, y: from.y - box.top }
      await userEvent.dragAndDrop(level(), level(), {
        sourcePosition: at,
        targetPosition: { x: at.x + 60, y: at.y + 20 },
      })
      await frame()
      // MOVED RIGHT AND DOWN, so scrolled back by as much: less than half the drawing's height down, which is as far as
      // it goes from the middle of a panel it fits.
      expect(Math.abs(before.left - level().scrollLeft - 60), 'across').toBeLessThanOrEqual(1)
      expect(Math.abs(before.top - level().scrollTop - 20), 'down').toBeLessThanOrEqual(1)
    } finally {
      await page.viewport(1280, 2400)
    }
  })
})

describe('a level taller than its panel', () => {
  it('scrolls from its top to its bottom', async () => {
    // THE SCREENSHOT'S LEVEL IN A PANEL HALF ITS HEIGHT.
    level().style.flex = 'none'
    level().style.height = `${Math.floor(drawing().offsetHeight / 2)}px`
    try {
      await until(() => level().scrollHeight > level().clientHeight + 40, 'the level to be taller than its panel')
      level().scrollTop = 0
      await frame()
      expect(Math.round(margins().above)).toBeGreaterThanOrEqual(0)
      level().scrollTop = level().scrollHeight
      await frame()
      expect(Math.round(margins().below)).toBeGreaterThanOrEqual(0)
    } finally {
      level().style.flex = ''
      level().style.height = ''
    }
  })
})

describe('text that measures differently after the level is laid out', () => {
  /**
   * A TM view of its own at the foot of the page, its level two states whose names are a letter each: in the fallback a
   * font rule draws them in before its face loads, a letter is as wide, within the tolerance below, as in the face the
   * level was laid out in, where a longer name would not be.
   */
  const SHORT: TmProgram = {
    states: [
      { name: 's', accept: false, rules: [{ read: [null], write: [null], moves: ['R'], next: 1 }], instr: 0 },
      { name: 't', accept: true, rules: [], instr: 1 },
    ],
    alphabet: ['_'],
    tapes: 1,
    width: 4,
    start: 0,
    listing: ['s', 't'],
    labels: [],
  }
  let host: HTMLElement
  const shortLevel = () => host.querySelector('.local-level') as HTMLElement
  const shortNodes = () => [...host.querySelectorAll<HTMLElement>('.local-node')]

  beforeAll(async () => {
    const fixture = mountTmFixture(SHORT, ['t'], { width: 600, height: 400 })
    host = fixture.host
    host.style.position = 'fixed'
    host.style.inset = 'auto 0 0 auto'
    fixture.pane.render(
      { state: 0, step: 0, heads: [0], window_start: [0], window: ['_'], source_node: null, rule: 0 },
      controlState(false, 'step 0 of 1'),
    )
    await userEvent.click(host.querySelector('[data-panel="diagram"] .diagram-mode[data-value="local"]') as HTMLElement)
    await until(() => shortNodes().length === 2, 'the level around s and t')
  })

  /** Each node whose box is not as wide as its text: text clipped, or more than two pixels of room to spare. */
  function unfitted(): string[] {
    const off: string[] = []
    for (const n of shortNodes()) {
      const range = document.createRange()
      range.selectNodeContents(n)
      const text = range.getBoundingClientRect().width
      const style = getComputedStyle(n)
      const room = n.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
      if (text > room + 0.5 || text < room - 2) off.push(`${n.title}: ${text.toFixed(1)} px of text in ${room} px`)
    }
    return off
  }

  /** Lay the level out again through its panel's width, a pixel narrower and back. */
  async function relaid(): Promise<void> {
    shortLevel().style.width = `${shortLevel().offsetWidth - 1}px`
    await frames()
    shortLevel().style.width = ''
    await frames()
  }

  it('is measured again when a web font it names arrives', async () => {
    expect(unfitted()).toEqual([])
    // A FONT THE NODES NAME BEFORE IT HAS LOADED: they draw in the fallback, as a page does before Hack arrives, and
    // the face that then loads, Inter, sets text far narrower than the fallback.
    const rule = document.createElement('style')
    rule.textContent = '.local-node { font-family: "Late Face", monospace }'
    document.head.append(rule)
    const face = new FontFace('Late Face', `url(${INTER})`)
    try {
      await frames()
      expect(unfitted()).toEqual([])
      document.fonts.add(face)
      await face.load()
      await until(() => unfitted().length === 0, 'the boxes to fit the text in the face that arrived')
      expect(getComputedStyle(shortNodes()[0] as HTMLElement).fontFamily).toMatch(/Late Face/)
    } finally {
      rule.remove()
      document.fonts.delete(face)
      await relaid()
    }
  })

  it('is measured again when the style changes', async () => {
    expect(unfitted()).toEqual([])
    // A STYLE THAT SETS THE NODES LARGER, so its text needs more room than it was laid out with.
    const rule = document.createElement('style')
    rule.textContent = ':root[data-style="terminal"] .local-node { font-size: 18px }'
    document.head.append(rule)
    const select = document.querySelector('#style') as HTMLSelectElement
    try {
      await userEvent.click(document.querySelector('#settings') as HTMLElement)
      await userEvent.selectOptions(select, 'terminal')
      await until(() => document.documentElement.dataset.style === 'terminal', 'the terminal style')
      expect(getComputedStyle(shortNodes()[0] as HTMLElement).fontSize).toBe('18px')
      await until(() => unfitted().length === 0, 'the boxes to fit the text in the new style')
    } finally {
      await userEvent.selectOptions(select, 'instrument')
      await userEvent.keyboard('{Escape}')
      rule.remove()
      await relaid()
    }
  })
})
