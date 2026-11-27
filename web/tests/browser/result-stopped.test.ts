import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import {
  barTitle,
  enterWidth,
  expectStacked,
  host,
  lambdaMark,
  lambdaTerm,
  outside,
  PREFIX,
  picker,
  rgb,
  rowWordEnd,
  SHELL,
  segments,
  stateIdle,
  stepBar,
  token,
  until,
  widthShown,
} from './harness'
import { userPickWorkspace } from './user-event-fixture'

/**
 * THE RUNS THAT END WITHOUT A MARK, AND NOTHING OUTSIDE A VIEW MOVING (the return-value highlight design, *When the
 * mark shows* and its anti-goals): no view marks a leg whose recording stopped short of its run's end, a TM that
 * overflowed its field, a function's result or an earlier program's value; the mark takes each palette's colours in
 * both themes; and the step that brings a mark or takes it away moves nothing outside its view, in Explorer or in
 * Stage. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

const SUM_TO = EXAMPLES.find((e) => e.id === 'sum-to')?.text ?? ''
const FACT_12 = EXAMPLES.find((e) => e.id === 'fact-12')?.text ?? ''
const FUNCTION = '|x| x + 1'
const UNIT = 'let mut x = 0; x = 1;'
/** A program no later case runs, so the recording the cut leaves is not taken for one of theirs. */
const SHORT = 'let x = 40; x + 2'
/** `9 + 9`: 18 outgrows a 4-cell binary field, so a TM pinned at 4 halts in `overflow`; the other legs end with 18. */
const OVERFLOW = 'let a = 9; let b = 9; a + b'

/** Each long case's own bound, past every wait in it. */
const CASE_MS = 90_000

/** The views of the program, the clif view shown. */
const LEAVES = ['lambda-0', 'tm-0', 'rxm-0', 'clif-0'] as const
type Leaf = (typeof LEAVES)[number]

/** Each palette's `result` and `result-word`, light then dark: the design's table. */
const COLOURS: Readonly<Record<string, Readonly<Record<'light' | 'dark', readonly [string, string]>>>> = {
  material: { light: ['#047857', '#065f46'], dark: ['#34d399', '#34d399'] },
  paper: { light: ['#1f7a4d', '#17603c'], dark: ['#62d394', '#62d394'] },
  terminal: { light: ['#0b7a5a', '#065f46'], dark: ['#34d399', '#34d399'] },
  instrument: { light: ['#15803d', '#166534'], dark: ['#4ade80', '#4ade80'] },
  grayscale: { light: ['#464646', '#2e2e2e'], dark: ['#b9b9b9', '#d1d1d1'] },
}

let view: EditorView

/**
 * THE `result` REPLIES HELD BACK FROM THE APP while `holding`, each as the delivery to the listener it is owed to,
 * until `release`. The worker posts a run's result only once its λ, rxm and TM recordings have ended, so a view can
 * stand at the new run's end while the stored result is the last program's; holding the reply makes that order certain
 * rather than a race against the worker. `beforeAll` wraps every `message` listener added to a worker, before `main`
 * makes its workers, and `afterAll` puts `Worker`'s own methods back.
 */
const held: (() => void)[] = []
let holding = false

/**
 * THE NEXT PROGRAM'S rxm RECORDING CUT SHORT while `cutting`: its first `frames` chunk is delivered with half its
 * frames and said to have `ended`, and every later rxm chunk of that generation is dropped. The view's newest frame
 * then stands mid-run on a recording the app takes for ended, which `endOf` makes of a cursor still `Running` and
 * no program reaches on demand. Each event's fate is decided once, for every listener it is owed to.
 */
let cutting = false
let cut: number | null = null
const fates = new WeakMap<Event, Event | null>()

/** `e`, a chunk of the rxm leg's frames, as the cut delivers it, or `null` where it drops it. */
function cutShort(e: MessageEvent): Event | null {
  const data = e.data as { gen: number; frames: unknown[] }
  if (data.gen === cut) return null
  cut = data.gen
  cutting = false
  const frames = data.frames.slice(0, Math.max(1, Math.floor(data.frames.length / 2)))
  return new MessageEvent('message', { data: { ...data, frames, done: 'ended' } })
}

const listen = Worker.prototype.addEventListener
const unlisten = Worker.prototype.removeEventListener
const wrappers = new WeakMap<EventListenerOrEventListenerObject, EventListener>()

/** Hand each held reply to its listener, in the order they came, and hold no more. */
function release(): void {
  holding = false
  for (const deliver of held.splice(0)) deliver()
}

const pane = (leaf: Leaf) => host(leaf) as HTMLElement
const stepOf = (el: HTMLElement) => el.querySelector('.step')?.textContent ?? ''
const segment = (leg: string) => segments().find((s) => s.startsWith(`${leg} `)) ?? ''
const control = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
/** The step number the step line says. */
const stepNumber = (el: HTMLElement) => Number((/^step ([\d,]+)/.exec(stepOf(el))?.[1] ?? '').replaceAll(',', ''))
/** Whether the step line says the newest step recorded, the run's end or where its history filled. */
const atNewest = (el: HTMLElement) => /^step ([\d,]+) of \1( — history is full)?$/.test(stepOf(el))
/** Whether the step line says a step of a recording that has ended: no `…`, and not the last program's frame. */
const recorded = (el: HTMLElement) => /^step [\d,]+ of [\d,]+( — history is full)?$/.test(stepOf(el))

/** Every result mark `leaf` draws: a marked row, box or λ run, a word, a TM's `little-endian`, a λ node's words. */
const marksIn = (leaf: Leaf) =>
  pane(leaf).querySelectorAll('.is-result, .tm-result, .result-word, .tm-endian, [data-marks*="result:"]')
/** Whether `leaf` draws its result mark: the row, box or λ run, each view's own. */
const marked = (leaf: Leaf) =>
  pane(leaf).querySelector(leaf === 'tm-0' ? '.tm-result' : leaf === 'lambda-0' ? '.term-mark.is-result' : '.is-result')

/** The width `text` takes in `el`'s font, measured on a canvas, which draws nothing on the page. */
function textWidth(el: HTMLElement, text: string): number {
  const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
  ctx.font = getComputedStyle(el).font
  return ctx.measureText(text).width
}

/**
 * Wait for the λ view to draw the tree of the step its step line says, its own and not another step's; or, where
 * `text` allows it, the step's text, which a term too large for a tree is shown as and which marks nothing.
 */
async function treeShown(el: HTMLElement, text = false): Promise<void> {
  const step = String(stepNumber(el))
  await until(
    () =>
      (lambdaTerm()?.dataset.step === step && lambdaTerm()?.dataset.stale === undefined) ||
      (text && lambdaTerm()?.dataset.layout === 'flat'),
    `the λ view to draw step ${step}`,
  )
}

/**
 * Press `⏭` in `el`, a view or the step bar that drives `leaf`, and wait for its newest step, and for the λ view the
 * tree of it.
 */
async function toEnd(leaf: Leaf, el: HTMLElement = pane(leaf), text = false): Promise<void> {
  if (!atNewest(el)) await userEvent.click(el.querySelector('.controls .to-newest') as HTMLButtonElement)
  await until(() => atNewest(el), `${leaf} to reach its newest step`)
  if (leaf === 'lambda-0') await treeShown(el, text)
}

/** Press `◀` in `el` and wait for the step before, and for the λ view its tree. */
async function back(leaf: Leaf, el: HTMLElement = pane(leaf)): Promise<void> {
  const from = stepNumber(el)
  await userEvent.click(control(el, '◀') as HTMLButtonElement)
  await until(() => stepOf(el).startsWith(`step ${(from - 1).toLocaleString('en')} of`), `${leaf} to step back`)
  if (leaf === 'lambda-0') await treeShown(el)
}

/**
 * Put `src` in the editor, where it is not there already, and wait for every view to show its run's recording whole.
 */
async function run(src: string): Promise<void> {
  if (view.state.doc.toString() !== src) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
    await until(() => !stateIdle(), 'the compile to start')
  }
  await until(stateIdle, 'the compile to finish')
  for (const leaf of LEAVES) await until(() => recorded(pane(leaf)), `${leaf} to record its run`)
  // THE READOUT'S clif SEGMENT COMES WITH THE RESULT, which can land after the views have recorded the run.
  await until(() => segments().length === LEAVES.length, "the readout's segment of each leg")
}

/** Run `fn` in Stage, and come back to Explorer, which the other cases are laid out in, also where it fails. */
async function inStage(fn: () => Promise<void>): Promise<void> {
  await userPickWorkspace('[data-preset="stage"]')
  try {
    await fn()
  } finally {
    await userPickWorkspace('[data-preset="explorer"]')
  }
}

/** Select `leaf`'s Stage tab with the pointer, and wait for the view and the step bar that drives it. */
async function showTab(leaf: Leaf): Promise<void> {
  await userEvent.click(document.querySelector(`#views [role="tab"][data-leaf="${leaf}"]`) as HTMLElement)
  await until(() => host(leaf) !== null && barTitle() !== '', `${leaf}'s tab to show it`)
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

/** `leaf`'s result mark's edge colour and its word's, as computed: the λ run's outline, or a box's inset shadow. */
function colours(leaf: Leaf): { edge: string; word: string } {
  if (leaf === 'lambda-0') {
    const mark = pane(leaf).querySelector('.term-mark.is-result') as HTMLElement
    return { edge: getComputedStyle(mark).outlineColor, word: getComputedStyle(mark, '::after').color }
  }
  const box = marked(leaf) as HTMLElement
  const word = pane(leaf).querySelector('.result-word') as HTMLElement
  return { edge: getComputedStyle(box).boxShadow, word: getComputedStyle(word).color }
}

beforeAll(async () => {
  Worker.prototype.addEventListener = function (
    this: Worker,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (type !== 'message') {
      listen.call(this, type, listener, options)
      return
    }
    const deliver = (e: Event) => (typeof listener === 'function' ? listener.call(this, e) : listener.handleEvent(e))
    const wrapped = (e: Event) => {
      const data = (e as MessageEvent).data
      if (holding && data?.kind === 'result') held.push(() => deliver(e))
      else if (data?.kind === 'frames' && data.leg === 'rxm' && (cutting || data.gen === cut)) {
        if (!fates.has(e)) fates.set(e, cutShort(e as MessageEvent))
        const fate = fates.get(e)
        if (fate) deliver(fate)
      } else deliver(e)
    }
    wrappers.set(listener, wrapped)
    listen.call(this, type, wrapped, options)
  } as typeof listen
  Worker.prototype.removeEventListener = function (
    this: Worker,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    unlisten.call(this, type, wrappers.get(listener) ?? listener, options)
  } as typeof unlisten
  await page.viewport(1400, 1000)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(() => stateIdle() && segments().length > 0, 'the first compile')
  await userEvent.selectOptions(picker(), 'binary')
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a clif view')
}, CASE_MS)

afterAll(() => {
  release()
  Worker.prototype.addEventListener = listen
  Worker.prototype.removeEventListener = unlisten
})

describe('the runs that end without a mark', () => {
  it(
    'marks no view whose leg stopped short with a known value',
    async () => {
      await run(FACT_12)
      // THE TM RUN HAS ITS VALUE, AND ITS HISTORY FILLED FIRST; THE λ RUN STOPPED RECORDING BEFORE IT FINISHED.
      const full = /^step 0 of ([\d,]+) — history is full$/
      expect(segment('rxm'), "the readout's value").toMatch(/^rxm 479001600 /)
      expect(segment('TM'), "precondition: the TM's value").toMatch(/^TM 479001600 /)
      expect(stepOf(pane('tm-0')), "precondition: the TM's history full").toMatch(full)
      expect(segment('TM'), 'the TM segment').toContain(`history is full at ${full.exec(stepOf(pane('tm-0')))?.[1]}`)
      expect(stepOf(pane('lambda-0')), "precondition: the λ's history full").toMatch(full)
      expect(segment('λ'), 'precondition: the λ run unfinished').toContain('recording stopped before the run did')
      // THE λ LEG HAS NO VALUE HERE, SO ITS HALF IS A PRECONDITION: its view marks nothing whatever its history did.
      await toEnd('lambda-0', pane('lambda-0'), true)
      expect(stepOf(pane('lambda-0')), 'precondition: λ at its newest step').toMatch(/ — history is full$/)
      expect(marksIn('lambda-0'), 'precondition: no mark in λ, which has no value').toHaveLength(0)
      await toEnd('tm-0', pane('tm-0'), true)
      expect(stepOf(pane('tm-0')), 'tm-0 at its newest step').toMatch(/ — history is full$/)
      expect(marksIn('tm-0'), 'a mark in tm-0').toHaveLength(0)
      for (const leaf of ['rxm-0', 'clif-0'] as const) {
        await toEnd(leaf)
        expect(stepOf(pane(leaf)), `${leaf} at its run's end`).toMatch(/^step ([\d,]+) of \1$/)
        expect(marked(leaf)?.querySelector('dd')?.firstChild?.textContent, `the value ${leaf} marks`).toBe('479001600')
      }
      // AND IN STAGE, WHERE THE TM'S STATUS LINE HAS ROOM FOR `little-endian`: in Explorer the step line takes that
      // room, and REG at this step does not open on field 0's `#`, so a TM marked there would draw nothing to see.
      await inStage(async () => {
        await showTab('tm-0')
        await toEnd('tm-0', stepBar())
        expect(stepOf(stepBar()), 'the TM at its newest step in Stage').toMatch(/ — history is full$/)
        const status = pane('tm-0').querySelector('.tm-status') as HTMLElement
        const last = status.querySelector('.tm-line')?.lastElementChild as HTMLElement
        const room = status.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(status).paddingRight)
        expect(room - last.getBoundingClientRect().right, 'precondition: room for the word').toBeGreaterThan(
          textWidth(last, ' · little-endian'),
        )
        expect(marksIn('tm-0'), 'a mark in the TM in Stage').toHaveLength(0)
      })
    },
    CASE_MS,
  )

  it(
    'draws the mark in both themes in every palette',
    async () => {
      await run(SUM_TO)
      for (const leaf of LEAVES) {
        await toEnd(leaf)
        expect(marked(leaf), `precondition: ${leaf} marked`).not.toBeNull()
      }
      const palettes = [...(document.querySelector('#palette') as HTMLSelectElement).options].map((o) => o.value)
      expect(palettes, "precondition: the palettes the menu offers, the design's table").toEqual(Object.keys(COLOURS))
      const theme = document.documentElement.dataset.theme
      const [first, choice] = ['#palette', '#appearance-choice'].map(
        (s) => document.querySelector<HTMLSelectElement>(s)?.value,
      )
      for (const palette of palettes) {
        for (const appearance of ['light', 'dark'] as const) {
          await skin(palette, appearance)
          const [edge, word] = (COLOURS[palette] as Record<'light' | 'dark', readonly [string, string]>)[appearance]
          for (const leaf of LEAVES) {
            const drawn = colours(leaf)
            const where = `${leaf} in ${palette} ${appearance}`
            if (leaf === 'lambda-0') expect(drawn.edge, `the edge, ${where}`).toBe(rgb(edge))
            else expect(drawn.edge, `the edge, ${where}`).toContain(rgb(edge))
            expect(drawn.word, `the word, ${where}`).toBe(rgb(word))
          }
        }
      }
      await skin(first as string, choice as string)
      expect(document.documentElement.dataset.theme, 'the theme the case began in').toBe(theme)
    },
    CASE_MS,
  )

  it(
    'marks nothing for a function result',
    async () => {
      await run(FUNCTION)
      for (const s of segments()) expect(s, 'the readout').toContain('no encoding for this type')
      for (const leaf of LEAVES) {
        await toEnd(leaf)
        expect(stepOf(pane(leaf)), `${leaf} at its run's end`).toMatch(/^step ([\d,]+) of \1$/)
        expect(marksIn(leaf), `a mark in ${leaf}`).toHaveLength(0)
      }
      expect(lambdaMark('result'), 'a λ result mark, bar or run').toBeNull()
    },
    CASE_MS,
  )

  it(
    'marks nothing for a run that ends with ()',
    async () => {
      await run(UNIT)
      for (const s of segments()) expect(s, 'the readout').toMatch(/^\S+ \(\) /)
      for (const leaf of LEAVES) {
        await toEnd(leaf)
        expect(stepOf(pane(leaf)), `${leaf} at its run's end`).toMatch(/^step ([\d,]+) of \1$/)
      }
      // `()` IS CHURCH'S 0 IN THE λ TERM, a numeral chip the result's rule would mark but for the value it reads.
      expect(lambdaTerm()?.textContent, "precondition: the λ term, its root's chip").toBe('0')
      expect(lambdaTerm()?.querySelector('.term-chip')?.textContent, "precondition: the root's chip").toBe('0')
      // EVERY VIEW COUNTED BEFORE ANY IS JUDGED, so a mark in one view does not hide another's.
      const counts = Object.fromEntries(LEAVES.map((leaf) => [leaf, marksIn(leaf).length]))
      expect(counts, 'the marks in each view').toEqual({ 'lambda-0': 0, 'tm-0': 0, 'rxm-0': 0, 'clif-0': 0 })
      expect(lambdaMark('result'), 'a λ result mark, bar or run').toBeNull()
    },
    CASE_MS,
  )

  it(
    'marks nothing at the newest frame of a recording said to have ended before its run did',
    async () => {
      cutting = true
      await run(SHORT)
      await until(() => cut !== null, 'the rxm recording, cut short')
      expect(segment('rxm'), "precondition: the rxm leg's value").toMatch(/^rxm 42 /)
      await toEnd('rxm-0')
      expect(stepOf(pane('rxm-0')), 'precondition: rxm at its newest step').toMatch(/^step ([\d,]+) of \1$/)
      expect(pane('rxm-0').querySelector('.rxm-row.is-next'), 'precondition: an instruction still next').not.toBeNull()
      expect(marksIn('rxm-0'), 'a mark in rxm-0').toHaveLength(0)
    },
    CASE_MS,
  )

  it(
    'marks no old value on a new program',
    async () => {
      await run(SUM_TO)
      for (const leaf of LEAVES) {
        await toEnd(leaf)
        expect(marked(leaf), `precondition: ${leaf} marked at sum_to's end`).not.toBeNull()
      }
      await userEvent.click(document.querySelector('#examples') as HTMLElement)
      await userEvent.click(document.querySelector('#examples-menu button[data-example="is-even"]') as HTMLElement)
      // UNTIL EACH LEG'S RECORDING ENDS, every view that shows the new program's frames marks nothing. A view still
      // saying `recompiling` shows the old program's last frame, whose own result it may mark.
      const seen: string[] = []
      const sample = () => {
        for (const leaf of LEAVES) {
          if (stepOf(pane(leaf)).includes('recompiling')) continue
          if (marksIn(leaf).length > 0) seen.push(`${leaf} at ${stepOf(pane(leaf))}`)
        }
      }
      await until(() => {
        sample()
        return stateIdle() && segment('rxm').startsWith('rxm true ') && LEAVES.every((l) => recorded(pane(l)))
      }, "each leg to record is_even(6)'s run")
      expect(seen, 'a view marked before its own end').toEqual([])
      for (const leaf of LEAVES) await toEnd(leaf)
      expect(stepOf(pane('rxm-0')), "rxm at is_even(6)'s end").toBe('step 79 of 79')
      const chip = pane('lambda-0').querySelector('.term-mark.is-result .term-chip')
      expect(chip?.textContent, 'the λ result').toBe('true')
      for (const leaf of ['rxm-0', 'clif-0'] as const)
        expect(marked(leaf)?.querySelector('dd')?.firstChild?.textContent, `the value ${leaf} marks`).toBe('1')
      const field = [...(marked('tm-0') as HTMLElement).children].map((c) => c.textContent).join('')
      expect(field, "the TM's field 0").toBe('1000')
    },
    CASE_MS,
  )

  it(
    "marks no old value at a new program's end before its result lands",
    async () => {
      // THE LEGS THE WORKER RECORDS BEFORE IT POSTS THE RESULT; the clif leg records after it.
      const before = ['lambda-0', 'tm-0', 'rxm-0'] as const
      await run(SUM_TO)
      for (const leaf of before) {
        await toEnd(leaf)
        expect(marked(leaf), `precondition: ${leaf} marked at sum_to's end`).not.toBeNull()
      }
      holding = true
      try {
        await userEvent.click(document.querySelector('#examples') as HTMLElement)
        await userEvent.click(document.querySelector('#examples-menu button[data-example="is-even"]') as HTMLElement)
        await until(() => held.length > 0, "is_even(6)'s result, held back")
        expect(segment('rxm'), "precondition: the stored result, sum_to(5)'s").toMatch(/^rxm 15 /)
        for (const leaf of before) {
          await until(() => recorded(pane(leaf)), `${leaf} to show is_even(6)'s recording`)
          await toEnd(leaf)
          expect(stepOf(pane(leaf)), `precondition: ${leaf} at its run's end`).toMatch(/^step ([\d,]+) of \1$/)
          expect(marksIn(leaf), `a mark in ${leaf} before its own result`).toHaveLength(0)
        }
        expect(stepOf(pane('rxm-0')), "precondition: rxm at is_even(6)'s end").toBe('step 79 of 79')
        expect(segment('rxm'), 'precondition: the result, still held').toMatch(/^rxm 15 /)
      } finally {
        release()
      }
      // AND THE RESULT'S OWN DRAW MARKS THE VIEWS ALREADY AT THE END, with no step taken.
      await until(() => segment('rxm').startsWith('rxm true '), "is_even(6)'s result, let through")
      for (const leaf of before) expect(marked(leaf), `${leaf} marked once its result lands`).not.toBeNull()
    },
    CASE_MS,
  )

  it(
    'marks no TM that halted in overflow, beside an rxm view that marks the value',
    async () => {
      await run(OVERFLOW)
      await enterWidth('4')
      try {
        expect(widthShown(), 'precondition: the width pinned at 4').toBe('4')
        await until(() => segment('TM').endsWith('width 4 (pinned)'), 'the run at width 4')
        await run(OVERFLOW)
        expect(segment('TM'), "precondition: the TM's value, the overflow").toContain('outgrew the 4-cell tape field')
        expect(segment('rxm'), "precondition: the rxm leg's value").toMatch(/^rxm 18 /)
        await toEnd('tm-0')
        expect(stepOf(pane('tm-0')), 'precondition: tm-0 at its newest step').toMatch(/^step ([\d,]+) of \1$/)
        const status = pane('tm-0').querySelector('.tm-status')?.textContent ?? ''
        expect(status.split(' · ')[0], 'precondition: the TM halted in overflow').toMatch(/\boverflow\b/)
        await toEnd('rxm-0')
        expect(stepOf(pane('rxm-0')), "precondition: rxm at its run's end").toMatch(/^step ([\d,]+) of \1$/)
        expect(marked('rxm-0')?.querySelector('dd')?.firstChild?.textContent, 'the control: rxm marks 18').toBe('18')
        expect(marksIn('tm-0'), 'a mark in the TM that overflowed').toHaveLength(0)
      } finally {
        await enterWidth('auto')
        await until(() => stateIdle() && segment('TM').endsWith('width 8'), 'the run at auto again')
      }
    },
    CASE_MS,
  )
})

describe('nothing outside a view moving', () => {
  it(
    'moves nothing outside the view',
    async () => {
      await run(SUM_TO)
      for (const leaf of LEAVES) {
        await toEnd(leaf)
        expect(marked(leaf), `precondition: ${leaf} marked in Explorer`).not.toBeNull()
        const end = outside(leaf)
        await back(leaf)
        expect(marked(leaf), `precondition: ${leaf} unmarked at the step before`).toBeNull()
        expect(outside(leaf), `what is outside ${leaf} in Explorer`).toEqual(end)
      }
      await inStage(async () => {
        for (const leaf of LEAVES) {
          await showTab(leaf)
          const bar = stepBar()
          await toEnd(leaf, bar)
          expect(marked(leaf), `precondition: ${leaf} marked in Stage`).not.toBeNull()
          const end = outside(leaf)
          await back(leaf, bar)
          expect(marked(leaf), `precondition: ${leaf} unmarked at the step before in Stage`).toBeNull()
          expect(outside(leaf), `what is outside ${leaf} in Stage`).toEqual(end)
        }
      })
    },
    CASE_MS,
  )
})

describe('the root chip opened', () => {
  /**
   * THE LIST RESULTS DESIGN'S λ RULE ASKS FOR NO CHIP: a numeral's chip opened over several rows at the run's end is
   * marked as a list over several rows is, one block with the word after its first row's text.
   */
  it(
    'marks an opened root chip over several rows as one block, the word after its first row',
    async () => {
      await run(SUM_TO)
      await toEnd('lambda-0')
      const chip = pane('lambda-0').querySelector<HTMLElement>('.term-mark.is-result .term-chip[data-node="0"]')
      expect(chip?.textContent, 'precondition: the root chip marked').toBe('15')
      await userEvent.click(chip as HTMLElement)
      await until(() => (lambdaTerm()?.querySelectorAll('.term-line').length ?? 0) > 1, 'the chip to open over rows')
      expect(lambdaTerm()?.querySelector('.term-chip[data-node="0"]'), 'precondition: the root opened').toBeNull()
      const term = lambdaTerm() as HTMLElement
      const rows = [...term.querySelectorAll<HTMLElement>('.term-line')]
      expect(
        rows.map((r) => r.classList.contains('is-result-row')),
        'every row in the block',
      ).toEqual(rows.map(() => true))
      expect(lambdaMark('result'), 'a run or a bar besides the block').toBeNull()
      expect(rows[0]?.classList.contains('is-result-first'), 'the block starts on the first row').toBe(true)
      for (const [i, row] of rows.entries())
        expect(getComputedStyle(row).backgroundColor, `row ${i}'s ground`).toBe(
          token('--result-bg', 'background-color'),
        )
      expectStacked(
        rows.map((r) => r.getBoundingClientRect()),
        'row',
      )
      expect(getComputedStyle(rows[0] as HTMLElement, '::after').content, 'the word on the first row').toContain(
        '"result"',
      )
      for (const row of rows.slice(1))
        expect(getComputedStyle(row, '::after').content, 'a word on a later row').not.toContain('result')
      expect(rowWordEnd(rows[0] as HTMLElement), "the word's end, inside the view's width").toBeLessThanOrEqual(
        term.getBoundingClientRect().left + term.clientLeft + term.clientWidth,
      )
    },
    CASE_MS,
  )
})
