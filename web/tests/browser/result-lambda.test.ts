import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { CONTRAST_FLOORS, contrastRatio } from '../../src/contrast'
import { EXAMPLES } from '../../src/examples'
import { codeLines, type Line } from '../../src/lambda-layout'
import { Tree } from '../../src/lambda-tree'
import { type FixtureOptions, wireOf } from '../node/tree-fixture'
import { compile, host, lambdaMark, lambdaTerm, outside, SHELL, segments, token, until } from './harness'
import { mountLambdaBody } from './lambda-body-fixture'

/**
 * THE RESULT IN THE λ VIEW (the return-value highlight design, goals 1 and 2): at the last step of a run that finished
 * with a Nat or a Bool, the root's chip in the result's ground and edge with the word `result` after it, said as a mark
 * where the node starts, and at the step before nothing; a list's root on one row is marked the same way (the list
 * results design). The view the app builds, then a body built by hand for what the app cannot pin.
 */

const SUM_TO = EXAMPLES.find((e) => e.id === 'sum-to')?.text ?? ''
const IS_EVEN = EXAMPLES.find((e) => e.id === 'is-even')?.text ?? ''

/** Each long case's own bound, past every wait in it. */
const CASE_MS = 60_000
/** The class of the bodies built by hand, which each case removes. */
const FIXTURE = 'result-lambda-fixture'

let view: EditorView

const lam = () => host('lambda-0') as HTMLElement
const stepOf = (pane: HTMLElement) => pane.querySelector('.step')?.textContent ?? ''
const control = (pane: HTMLElement, label: string) =>
  [...pane.querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
/** The runs a λ term marks as the result. */
const marked = (where: Element | null) => [...(where?.querySelectorAll<HTMLElement>('.term-mark.is-result') ?? [])]

/** Whether the step line says the last step. */
const atEnd = (pane: HTMLElement) => /^step ([\d,]+) of \1$/.test(stepOf(pane))

/** Wait for the λ view to draw the tree of `step`, its own and not another step's shown meanwhile. */
async function treeAt(step: number): Promise<void> {
  await until(
    () => lambdaTerm()?.dataset.step === String(step) && lambdaTerm()?.dataset.stale === undefined,
    `the λ view to draw step ${step}'s tree`,
  )
}

/** The step number the step line says. */
const stepNumber = (pane: HTMLElement) => Number((/^step ([\d,]+)/.exec(stepOf(pane))?.[1] ?? '').replaceAll(',', ''))

/** Press `⏭`, which a view at its last step disables, and wait for the last step's tree. */
async function toEnd(pane: HTMLElement): Promise<void> {
  if (!atEnd(pane)) await userEvent.click(pane.querySelector('.controls .to-newest') as HTMLButtonElement)
  await until(() => atEnd(pane), "the view to reach its run's end")
  await treeAt(stepNumber(pane))
}

/** Press `◀` and wait for the tree of the step before the one the view was on. */
async function back(pane: HTMLElement): Promise<void> {
  const from = stepNumber(pane)
  await userEvent.click(control(pane, '◀') as HTMLButtonElement)
  await treeAt(from - 1)
}

/** Put `src` in the editor and wait for the λ view to record its run, from step 0. */
async function run(src: string, value: string): Promise<void> {
  await compile(view, src)
  await until(() => segments().some((s) => s.startsWith(`λ ${value} `)), "the readout's λ value")
  await until(() => /^step 0 of [\d,]+$/.test(stepOf(lam())), 'the λ view to record its run')
}

/** The floor `contrast.ts` holds the result word to, on the result's tint. */
const WORD_FLOOR = CONTRAST_FLOORS.find(([fg]) => fg === 'result-word')?.[2] ?? Number.NaN

/** One pixel, to composite colours on as the page does and read back the colour drawn. */
const pixel = (() => {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  return canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
})()

/**
 * `colours` painted in order on a clear pixel, each over the one before, and what is drawn: `#rrggbb` and its alpha.
 */
function painted(colours: readonly string[]): { hex: string; alpha: number } {
  pixel.clearRect(0, 0, 1, 1)
  for (const colour of colours) {
    // A colour the canvas cannot read leaves the last fill in place, which would be measured as if it were drawn.
    pixel.fillStyle = '#010203'
    pixel.fillStyle = colour
    if (pixel.fillStyle === '#010203') throw new Error(`a colour the canvas does not read: ${colour}`)
    pixel.fillRect(0, 0, 1, 1)
  }
  const [r = 0, g = 0, b = 0, alpha = 0] = pixel.getImageData(0, 0, 1, 1).data
  return { hex: `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`, alpha }
}

/** `list` cut at its commas outside parentheses, each part trimmed. */
function topLevel(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++
    else if (list[i] === ')') depth--
    else if (list[i] === ',' && depth === 0) {
      parts.push(list.slice(from, i).trim())
      from = i + 1
    }
  }
  return [...parts, list.slice(from).trim()]
}

/**
 * The grounds `el` draws, bottom first: its background colour, then its image's layers, each a gradient of one colour.
 */
function groundsOf(el: Element): string[] {
  const s = getComputedStyle(el)
  const layers = topLevel(s.backgroundImage).filter((layer) => layer !== 'none')
  return [
    s.backgroundColor,
    ...layers.reverse().map((layer) => {
      const stops = topLevel(/^linear-gradient\((.*)\)$/.exec(layer)?.[1] ?? '')
      if (stops.length !== 2 || stops[0] !== stops[1]) throw new Error(`not a ground of one colour: ${layer}`)
      return stops[0] as string
    }),
  ]
}

/** The colour drawn under `el`'s text: its grounds over its ancestors', from the nearest opaque one up. */
function groundUnder(el: Element): string {
  const layers: string[] = []
  for (let e: Element | null = el; e !== null; e = e.parentElement) {
    layers.unshift(...groundsOf(e))
    if (painted([getComputedStyle(e).backgroundColor]).alpha === 255) return painted(layers).hex
  }
  throw new Error('no opaque ground under the mark')
}

/**
 * Choose a palette and an appearance from the settings menu with the pointer, and wait for the page to take them: the
 * appearance's theme, which `system` leaves unset.
 */
async function skin(palette: string, appearance: string): Promise<void> {
  const theme = appearance === 'system' ? undefined : appearance
  const settings = document.querySelector<HTMLElement>('#settings') as HTMLElement
  await userEvent.click(settings)
  await userEvent.selectOptions(document.querySelector('#palette') as HTMLSelectElement, palette)
  await userEvent.selectOptions(document.querySelector('#appearance-choice') as HTMLSelectElement, appearance)
  await userEvent.click(settings)
  await until(() => document.documentElement.dataset.theme === theme, `the page in ${theme}`)
}

/**
 * Each palette and theme in which the result word reads below its floor on the ground drawn under the mark `markOf`
 * finds, with the ratio it reads at, by `contrast.ts`'s own measure; the page's palette and appearance put back after.
 */
async function belowFloor(markOf: () => Element | undefined): Promise<string[]> {
  const select = (s: string) => document.querySelector(s) as HTMLSelectElement
  const [palette, appearance] = [select('#palette').value, select('#appearance-choice').value]
  const below: string[] = []
  try {
    for (const p of [...select('#palette').options].map((o) => o.value)) {
      for (const a of ['light', 'dark']) {
        await skin(p, a)
        const mark = markOf() as Element
        const word = painted([getComputedStyle(mark, '::after').color])
        expect(word.alpha, `precondition: the word opaque in ${p} ${a}`).toBe(255)
        const ratio = contrastRatio(word.hex, groundUnder(mark))
        if (!(ratio >= WORD_FLOOR)) below.push(`${p} ${a} ${ratio.toFixed(2)}`)
      }
    }
  } finally {
    await skin(palette, appearance)
  }
  return below
}

/** Church's 2, and its lines with the numeral closed to its chip, on one row. */
function two(o: FixtureOptions = {}): { tree: Tree; lines: Line[] } {
  const tree = new Tree(wireOf('\\f. \\x. f (f x)', o))
  return { tree, lines: codeLines(tree, { width: 80, vars: 'names', open: (i) => tree.chip(i) === null }) }
}

afterEach(() => {
  for (const el of document.querySelectorAll(`.${FIXTURE}`)) el.remove()
})

beforeAll(async () => {
  await page.viewport(1400, 1000)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await run(SUM_TO, '15')
}, CASE_MS)

describe('the result in the λ view the app builds', () => {
  it(
    "marks the root chip at the λ view's last step, and not at the step before",
    async () => {
      await toEnd(lam())
      expect(stepOf(lam())).toBe('step 951 of 951')
      const marks = marked(lambdaTerm())
      expect(marks, 'the runs marked').toHaveLength(1)
      const mark = marks[0] as HTMLElement
      expect(mark.querySelector('.term-chip')?.textContent, 'the chip it holds').toBe('15')
      expect((mark.querySelector('[data-node]') as HTMLElement).dataset.marks, 'the words where it starts').toContain(
        'result:',
      )
      expect(getComputedStyle(mark, '::after').content, 'the word after it').toContain('"result"')
      const s = getComputedStyle(mark)
      expect(s.outlineStyle, 'the edge').toBe('solid')
      expect(s.outlineColor, "the edge's colour").toBe(token('--result'))
      expect(s.backgroundColor, 'the ground').toBe(token('--result-bg', 'background-color'))
      expect(lambdaTerm()?.textContent, "the term's text: the term alone").toBe('15')
      const end = outside('lambda-0')

      await back(lam())
      expect(marked(lambdaTerm()), 'the runs marked at the step before').toEqual([])
      expect(outside('lambda-0'), 'what is outside the view').toEqual(end)
      await toEnd(lam())
      expect(marked(lambdaTerm()), 'the runs marked at the end again').toHaveLength(1)
    },
    CASE_MS,
  )

  it(
    "marks a Bool root that is also the contractum, the word on the result's ground alone",
    async () => {
      await run(IS_EVEN, 'true')
      await toEnd(lam())
      const marks = marked(lambdaTerm())
      expect(marks, 'the runs marked').toHaveLength(1)
      const mark = marks[0] as HTMLElement
      expect(mark.querySelector('.term-chip')?.textContent, 'the chip it holds').toBe('true')
      expect(mark.classList.contains('is-contractum'), 'precondition: the root is the contractum').toBe(true)
      // THE WORD'S FLOOR IS MET ON THE RESULT'S TINT OVER THE SURFACE, so that is the ground drawn under it here too.
      expect(await belowFloor(() => marked(lambdaTerm())[0]), 'where the word reads below its floor').toEqual([])
      const s = getComputedStyle(mark)
      expect(s.backgroundImage, 'a ground laid over it').toBe('none')
      expect(s.backgroundColor, "the result's ground").toBe(token('--result-bg', 'background-color'))
      expect(s.boxShadow, "the contractum's underline").toContain(token('--tok-operator'))
      expect(s.outlineColor, "the result's edge").toBe(token('--result'))
    },
    CASE_MS,
  )

  it(
    'marks a list root on one row as it marks a number',
    async () => {
      await run('[1, 2]', '[1, 2]')
      await toEnd(lam())
      expect(lambdaTerm()?.querySelectorAll('.term-line'), 'precondition: the root on one row').toHaveLength(1)
      expect(lambdaMark('result')?.classList.contains('term-bar'), 'a bar').toBe(false)
      const marks = marked(lambdaTerm())
      expect(marks, 'the runs marked').toHaveLength(1)
      const mark = marks[0] as HTMLElement
      expect(mark.textContent, 'the term it holds: all of it').toBe(lambdaTerm()?.textContent)
      expect(getComputedStyle(mark, '::after').content, 'the word after it').toContain('"result"')
      expect(getComputedStyle(mark).outlineColor, 'the edge').toBe(token('--result'))
      expect(getComputedStyle(mark).backgroundColor, 'the ground').toBe(token('--result-bg', 'background-color'))
    },
    CASE_MS,
  )
})

describe('the result in a λ body built by hand', () => {
  it(
    "keeps the link's box when the root is pinned, the word on the result's ground alone",
    async () => {
      const { body } = mountLambdaBody(FIXTURE)
      const { tree, lines } = two()
      body.showTree(tree, lines, false, [0], false, true)
      const marks = marked(body.el)
      expect(marks, 'the runs marked').toHaveLength(1)
      const mark = marks[0] as HTMLElement
      expect(mark.classList.contains('is-linked'), 'precondition: the run, linked too').toBe(true)
      expect(await belowFloor(() => marked(body.el)[0]), 'where the word reads below its floor').toEqual([])
      const s = getComputedStyle(mark)
      expect(s.boxShadow, "the link's edge").toContain(token('--link-edge'))
      expect(s.outlineColor, "the result's edge").toBe(token('--result'))
      expect(s.backgroundImage, 'a ground laid over it').toBe('none')
      expect(s.backgroundColor, "the result's ground").toBe(token('--result-bg', 'background-color'))
    },
    CASE_MS,
  )

  it(
    "keeps the link's box and the contractum's underline when the root is both, the word on the result's ground alone",
    async () => {
      const { body } = mountLambdaBody(FIXTURE)
      const { tree, lines } = two({ contractum: 0 })
      body.showTree(tree, lines, false, [0], false, true)
      const marks = marked(body.el)
      expect(marks, 'the runs marked').toHaveLength(1)
      const mark = marks[0] as HTMLElement
      expect(
        ['is-linked', 'is-contractum'].map((c) => mark.classList.contains(c)),
        'precondition: the run, linked and the contractum too',
      ).toEqual([true, true])
      expect(await belowFloor(() => marked(body.el)[0]), 'where the word reads below its floor').toEqual([])
      const s = getComputedStyle(mark)
      expect(s.boxShadow, "the link's edge").toContain(token('--link-edge'))
      expect(s.boxShadow, "the contractum's underline").toContain(token('--tok-operator'))
      expect(s.outlineColor, "the result's edge").toBe(token('--result'))
      expect(s.backgroundImage, 'a ground laid over it').toBe('none')
      expect(s.backgroundColor, "the result's ground").toBe(token('--result-bg', 'background-color'))
    },
    CASE_MS,
  )

  it('draws the mark when only the result changes', () => {
    const { body } = mountLambdaBody(FIXTURE)
    const { tree, lines } = two()
    const linked: number[] = []
    body.showTree(tree, lines, false, linked, false)
    expect(marked(body.el), 'precondition: no mark').toEqual([])
    body.showTree(tree, lines, false, linked, false, true)
    expect(marked(body.el), 'the runs marked').toHaveLength(1)
  })
})
