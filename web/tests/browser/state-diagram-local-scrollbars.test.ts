import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { TmProgram } from '../../src/types'
import { controlState, diagram, diagramChoice, frame, until } from './harness'
import { mountTmFixture } from './tm-fixture'

/**
 * The state diagram's local level under classic scroll bars, which take their width out of the box they scroll:
 * `SCROLLBAR_FILES` in vite.config.ts runs this file in a Chromium that draws them. The level's height depends on the
 * width it is spread over, so the width it is laid out for must not be one a vertical scroll bar takes or gives back,
 * and the level draws no scroll bar at all (`docs/superpowers/specs/2026-11-16-state-diagram-tidy-design.md`,
 * decision 11).
 */

/**
 * A rule on the one tape: what it reads, what it writes (`*` keeps the cell), how the head moves and the state it goes
 * to, by index.
 */
const rule = (read: string, write: string, move: 'L' | 'R' | 'S', next: number) => ({
  read: [read],
  write: [write === '*' ? null : write],
  moves: [move],
  next,
})

/** Ten states, `s` and `q1` to `q9` at their own indices, each an instruction of its own, listed by its name. */
const MACHINE: TmProgram = {
  states: [
    [rule('0', '1', 'S', 7), rule('1', '1', 'S', 5), rule('#', '0', 'S', 9)],
    [rule('0', '*', 'L', 9)],
    [rule('0', '*', 'S', 0)],
    [rule('0', '0', 'S', 4), rule('1', '0', 'S', 1)],
    [rule('0', '0', 'L', 1), rule('1', '1', 'R', 8), rule('#', '*', 'R', 9)],
    [rule('0', '*', 'S', 2), rule('1', '0', 'L', 6), rule('#', '*', 'R', 5)],
    [rule('0', '1', 'L', 8), rule('1', '0', 'L', 1), rule('#', '*', 'S', 4)],
    [rule('0', '1', 'L', 9), rule('1', '0', 'L', 3)],
    [rule('0', '*', 'R', 9), rule('1', '1', 'R', 7), rule('#', '1', 'R', 9)],
    [rule('0', '0', 'S', 5), rule('1', '0', 'L', 1), rule('#', '1', 'S', 3)],
  ].map((rules, i) => ({ name: i === 0 ? 's' : `q${i}`, accept: false, rules, instr: i })),
  alphabet: ['_', '0', '1', '#'],
  tapes: 1,
  width: 4,
  start: 0,
  listing: ['s', ...Array.from({ length: 9 }, (_, i) => `q${i + 1}`)],
  labels: [],
}

const level = () => diagram().querySelector('.local-level') as HTMLElement
/** The whole drawing, at the size it was laid out at. */
const drawing = () => diagram().querySelector('.local-drawing') as HTMLElement
const group = () => diagram().querySelector('.local-nodes') as HTMLElement

/** How many times the level has been laid out: each layout builds its nodes anew. */
let layouts = 0
/**
 * The page's `ResizeObserver loop` errors: a level laid out again in the frame a scroll bar came or went reports one,
 * and the browser goes on, so a loop that settles in a few frames shows here and nowhere else.
 */
const loops: string[] = []

/** A classic scroll bar's width in this browser: what a box that always scrolls loses to it. */
function scrollBar(): number {
  const box = document.createElement('div')
  box.style.cssText = 'position: absolute; width: 100px; height: 100px; overflow: scroll'
  document.body.append(box)
  const width = box.offsetWidth - box.clientWidth
  box.remove()
  return width
}

/** Make the level `width` px wide, scroll bar included, and `height` px tall, and wait for it to be laid out again. */
async function resize(width: number, height = 2000): Promise<void> {
  const before = layouts
  level().style.flex = 'none'
  level().style.height = `${height}px`
  level().style.width = `${width}px`
  await until(() => layouts > before, `the level laid out again at ${width} px`)
}

beforeAll(async () => {
  await page.viewport(1280, 2400)
  const { host, pane } = mountTmFixture(MACHINE, ['t'], { width: 1280, height: 2000 })
  // NAMED AS THE APP'S FIRST TM VIEW IS, so the harness's readers of that view's diagram read this one.
  host.dataset.leaf = 'tm-0'
  // ON ITS START, `s`, READING A BLANK, WHICH NO RULE OF `s` READS.
  pane.render(
    { state: 0, step: 0, heads: [0], window_start: [0], window: ['_'], source_node: null, rule: null, result: null },
    controlState(false, 'step 0 of 0', false, false, false),
  )
  await userEvent.click(diagramChoice('local') as HTMLButtonElement)
  await until(() => group().querySelector('.local-node[title="s"]') !== null, 'the level around s')
  new MutationObserver(() => {
    layouts += 1
  }).observe(group(), { childList: true })
  window.addEventListener('error', (e) => {
    if (String(e.message).includes('ResizeObserver loop')) loops.push(e.message)
  })
})

afterEach(() => {
  level().style.flex = ''
  level().style.width = ''
  level().style.height = ''
  expect(loops.splice(0), 'ResizeObserver loop errors in this test').toEqual([])
})

describe('under classic scroll bars', () => {
  it('lays itself out once in a panel where a vertical scroll bar would come and go with the width it takes', async () => {
    const bar = scrollBar()
    expect(bar, 'classic scroll bars, which take width').toBeGreaterThanOrEqual(10)
    // THE LEVEL'S HEIGHT AT EACH WIDTH IT IS SPREAD OVER, in a panel too tall to scroll, from the narrowest that holds
    // it: where its labels fall on its sloping lines, and so how tall its rows stand, depends on the spread.
    await resize(200)
    const natural = Number.parseFloat(drawing().style.width)
    await resize(560)
    const gutter = level().offsetWidth - level().clientWidth
    const height = new Map<number, number>()
    for (let spread = natural; spread <= natural + 150; spread += 1) {
      await resize(spread + gutter)
      expect(drawing().style.width).toBe(`${spread}px`)
      height.set(spread, Number.parseFloat(drawing().style.height))
    }
    // A PANEL THAT FITS THE LEVEL SPREAD OVER A SCROLL BAR LESS THAN ITS WIDTH, BUT NOT SPREAD OVER ALL OF IT: a level
    // spread over the width it has without a scroll bar would overflow, gain one, fit, lose it, and so on.
    const wide = [...height.keys()].find(
      (s) => (height.get(s) ?? 0) > Math.ceil(height.get(s - bar) ?? Number.POSITIVE_INFINITY) + 0.5,
    )
    expect(wide, 'a width at which the level is taller than at a scroll bar less').toBeDefined()
    const tall = Math.ceil(height.get((wide ?? 0) - bar) ?? 0)
    await resize(wide ?? 0, tall)
    for (let i = 0; i < 5; i += 1) await frame()
    const settled = layouts
    for (let i = 0; i < 30; i += 1) await frame()
    expect(layouts - settled, 'layouts over 30 frames').toBe(0)
    // AND LAID OUT FOR THE WIDTH IT HAS: not left spread over a width a scroll bar took or gave back.
    expect(drawing().style.width).toBe(`${level().clientWidth}px`)
  })

  it('draws no scroll bar, even where it is larger than its panel both ways', async () => {
    await resize(200, 100)
    expect(drawing().offsetWidth, 'precondition: wider than its panel').toBeGreaterThan(level().clientWidth)
    expect(drawing().offsetHeight, 'precondition: taller than its panel').toBeGreaterThan(level().clientHeight)
    expect(level().offsetWidth - level().clientWidth, 'the room a vertical scroll bar takes').toBe(0)
    expect(level().offsetHeight - level().clientHeight, 'the room a horizontal scroll bar takes').toBe(0)
  })

  it('has the same width to lay itself out in whether it overflows or fits', async () => {
    // WHAT KEEPS A SCROLL BAR FROM CHANGING ITS SPREAD, AND SO ITS HEIGHT, at any width: a loop needs a
    // level whose height crosses its panel's as the bar comes and goes, which a fixture finds only where it happens
    // to, but no loop can start where the width stays put. A panel far too short for the level, and one far too tall.
    await resize(560)
    const widths: number[] = []
    for (const panel of [40, 2000]) {
      level().style.height = `${panel}px`
      for (let i = 0; i < 3; i += 1) await frame()
      expect(drawing().offsetHeight > level().clientHeight, `${panel} px tall overflows`).toBe(panel === 40)
      widths.push(level().clientWidth)
    }
    expect(widths[0], 'the width it is laid out for, overflowing and fitting').toBe(widths[1])
  })
})
