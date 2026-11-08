import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { bindingKey } from '../../src/view-header'
import { compile, paneByLeaf, pickPreset, SHELL, segments, stageTab, until } from './harness'

/**
 * The rxm leg through the whole app (Plan 7 part 5 spec §5–§6): a compile reaches the rxm view of a four-view page,
 * the step controls drive it, the readout carries its segment, and a program one backend declines is still run by the
 * others. `rxm-pane.test.ts` holds the view on its own; this holds the wiring that feeds it.
 */

const SAMPLE = 'let x = 40; x + 2'
/** 34 ones multiplied: one multiplication past `MAX_MUL_INSTRS`, so the TM refuses the machine; rxm runs 68 instructions. */
const TOO_LARGE_FOR_TM = Array.from({ length: 34 }, () => '1').join(' * ')
/** A function passed where the first-order backends cannot follow it: λ runs it, rxm and TM decline. */
const HIGHER_ORDER = 'fn inc(x) { x + 1 } fn t(g) { g(3) } fn ap(h, y) { h(y) } t(inc) + ap(t, inc)'
const FACT3 = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'
/**
 * `upto(600)`: 8,413 instructions, whose frames carry up to eight saved frames and sixteen cells, so recording them
 * passes `HISTORY_BYTES` at about step 7,400. The TM declines it (a value too wide for the encoding) and the λ leg
 * spends its own history first, so the rxm leg is the one this waits on.
 */
const UPTO = 'fn upto(n) { if n == 0 { nil } else { cons(n, upto(n - 1)) } } upto(600)'

let view: EditorView

const rows = (leaf = 'rxm-0') => [...paneByLeaf(leaf).querySelectorAll<HTMLElement>('.rxm-row')]
const rowText = (r: HTMLElement) => r.querySelector('.rxm-cell')?.textContent ?? ''
const listing = (leaf = 'rxm-0') => paneByLeaf(leaf).querySelector<HTMLElement>('.rxm-listing') as HTMLElement
const stepOf = (leaf: string) => paneByLeaf(leaf).querySelector('.step')?.textContent ?? ''
const control = (label: string, leaf = 'rxm-0') =>
  [...paneByLeaf(leaf).querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
const register = (name: string) =>
  [...paneByLeaf('rxm-0').querySelectorAll<HTMLElement>('.rxm-register')].find(
    (r) => r.querySelector('dt')?.textContent === name,
  )

/** Pick `key` (`bindingKey(leg, session)`) through `leaf`'s title menu, as `harness.ts`'s `pickBinding` does. */
function pick(leaf: string, key: string): void {
  const title = paneByLeaf(leaf).querySelector<HTMLButtonElement>('button.view-title')
  if (title === null) throw new Error(`no title-selector on [data-leaf="${leaf}"]`)
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const item = menu?.querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`)
  if (item == null) throw new Error(`[data-leaf="${leaf}"] offers no ${key}`)
  item.click()
}

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await compile(view, SAMPLE)
})

describe('the rxm leg in the app', () => {
  it('is a view of its own, showing the program’s listing', async () => {
    await until(() => rows().length > 0, 'the rxm listing to draw')
    expect(paneByLeaf('rxm-0').dataset.kind).toBe('rxm')
    expect(paneByLeaf('rxm-0').querySelector('.view-title')?.textContent).toBe('rxm · program')
    expect(rows().map(rowText)).toEqual([
      'pc0li r0, #40',
      'pc1mov r1, r0',
      'pc2li r2, #2',
      'pc3add rr, r1, r2',
      'pc4halt',
    ])
  })

  it('records every instruction, and the readout counts them in its own segment', () => {
    // ALL FIVE RECORDED, AND THE RUN OPENS ON STEP 0, ready to step from its start.
    expect(stepOf('rxm-0')).toBe('step 0 of 5')
    expect(segments()).toContain('rxm 42 · 5 instructions')
    expect(segments().map((s) => s.split(' ')[0])).toEqual(['λ', 'rxm', 'TM'])
  })

  it('steps from the start, the listing marking what runs next and the registers what changed', async () => {
    control('↺')?.click()
    await until(() => stepOf('rxm-0').startsWith('step 0 of'), 'the rxm view to restart')
    expect(listing().querySelector('.rxm-row.is-next')?.textContent).toContain('pc0')
    control('▶')?.click()
    await until(() => stepOf('rxm-0').startsWith('step 1 of'), 'one step')
    expect(listing().querySelector('.rxm-row.is-next')?.textContent).toContain('pc1')
    const r0 = register('r0')
    expect(r0?.querySelector('dd')?.textContent).toBe('40')
    expect(r0?.classList.contains('is-changed')).toBe(true)
  })

  it('runs a program the TM refuses to build, and says why the TM declined', async () => {
    await compile(view, TOO_LARGE_FOR_TM)
    await until(() => stepOf('rxm-0') === 'step 0 of 68', 'the rxm leg to record its 68 instructions')
    expect(stepOf('tm-0')).toBe('the machine this program needs is too large to build')
    expect(segments()).toContain('rxm 1 · 68 instructions')
  })

  it('declines a program rxm cannot lower, with the reason, while λ runs it', async () => {
    await compile(view, HIGHER_ORDER)
    await until(() => stepOf('rxm-0').startsWith('the rxm backend does not support'), 'the rxm leg to decline')
    expect(rows()).toHaveLength(0)
    const rxm = segments().find((s) => s.startsWith('rxm '))
    expect(rxm).toMatch(/^rxm declined — the rxm backend does not support /)
    expect(segments().find((s) => s.startsWith('λ '))).toMatch(/^λ 8 · /)
  })
})

describe('an rxm view made after the compile', () => {
  it('is told the listing the session kept, when a view is picked onto rxm from its title', async () => {
    await compile(view, SAMPLE)
    pick('lambda-0', bindingKey('rxm', 'source'))
    await until(() => paneByLeaf('lambda-0').dataset.kind === 'rxm', 'the λ view to become an rxm view')
    await until(() => rows('lambda-0').length > 0, 'the new rxm view to draw')
    expect(rows('lambda-0').map(rowText)).toEqual(rows('rxm-0').map(rowText))
    pick('lambda-0', bindingKey('lambda', 'source'))
    await until(() => paneByLeaf('lambda-0').dataset.kind === 'lambda', 'the view to go back to λ')
  })

  it('is told the listing it missed while off the page, when the stage shows it', async () => {
    pickPreset('stage')
    stageTab('lambda-0')?.click()
    await until(() => document.querySelector('.pane[data-leaf="rxm-0"]') === null, 'the rxm view to leave the page')
    await compile(view, FACT3)
    stageTab('rxm-0')?.click()
    // fact(3): 21 instructions under 4 labels.
    await until(() => listing().getAttribute('aria-rowcount') === '25', 'the rxm view to show the new listing')
    pickPreset('explorer')
  })
})

describe('an rxm run that fills its history', () => {
  /**
   * The newest step recorded, the count after "of": `7,400` in `step 7,400 of 7,400 — history is full (oldest kept:
   * step 5)`, the line where this run's history fills. `NaN` for a line with no count.
   */
  const newest = (text: string): number => Number((text.match(/ of ([\d,]+)/)?.[1] ?? '').replaceAll(',', ''))

  /**
   * **THE RXM LEG'S `[continue]`.** A `budget` stop costs history, not the answer — `compile` already ran the program
   * to its end — so the step line offers to keep recording, and the worker grants the leg another
   * allowance from where it stopped (`session-worker.ts`'s `onExtend`).
   */
  it('keeps recording when asked, and the count recorded grows past where it stopped', async () => {
    await compile(view, UPTO)
    await until(() => stepOf('rxm-0').includes('history is full'), 'the rxm history to fill')
    const stopped = newest(stepOf('rxm-0'))
    expect(stopped, 'the run stopped short of its 8,413 instructions').toBeLessThan(8_413)
    const extend = paneByLeaf('rxm-0').querySelector<HTMLButtonElement>('.controls .extend')
    expect(extend?.hidden).toBe(false)
    expect(extend?.textContent).toBe('keep recording')
    extend?.click()
    await until(() => newest(stepOf('rxm-0')) > stopped, 'the rxm leg to record past where it stopped')
  })
})
