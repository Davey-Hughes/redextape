import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

/**
 * The asm leg through the whole app (Plan 7 part 5 spec §5–§6): a compile reaches the asm view in the default tree,
 * the step controls drive it, the readout carries its segment, and a program one backend declines is still run by the
 * others. `asm-pane.test.ts` holds the view on its own; this holds the wiring that feeds it.
 */

const SAMPLE = 'let x = 40; x + 2'
/** 34 ones multiplied: one multiplication past `MAX_MUL_INSTRS`, so the TM refuses the machine; asm runs 68 instructions. */
const TOO_LARGE_FOR_TM = Array.from({ length: 34 }, () => '1').join(' * ')
/** A function passed where the first-order backends cannot follow it: λ runs it, asm and TM decline. */
const HIGHER_ORDER = 'fn inc(x) { x + 1 } fn t(g) { g(3) } fn ap(h, y) { h(y) } t(inc) + ap(t, inc)'
const FACT3 = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'
/**
 * `upto(600)`: 8,413 instructions, whose frames carry up to eight saved frames and sixteen cells, so recording them
 * passes `HISTORY_BYTES` at about step 7,400 — measured against `asmFrameBytes` by stepping the same lowering in node.
 * The TM declines it (a value too wide for the encoding) and the λ leg spends its own history first, in a fifth of a
 * second, so the asm leg is the one this waits on.
 */
const UPTO = 'fn upto(n) { if n == 0 { nil } else { cons(n, upto(n - 1)) } } upto(600)'

let view: EditorView

/** A view's host — `.pane`, since in the stage each tab carries the leaf id too. */
const host = (leaf: string) => document.querySelector<HTMLElement>(`.pane[data-leaf="${leaf}"]`) as HTMLElement
const rows = (leaf = 'asm-0') => [...host(leaf).querySelectorAll<HTMLElement>('.asm-row')]
const rowText = (r: HTMLElement) => r.querySelector('.asm-cell')?.textContent ?? ''
const listing = (leaf = 'asm-0') => host(leaf).querySelector<HTMLElement>('.asm-listing') as HTMLElement
const stepOf = (leaf: string) => host(leaf).querySelector('.step')?.textContent ?? ''
const control = (label: string, leaf = 'asm-0') =>
  [...host(leaf).querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
const register = (name: string) =>
  [...host('asm-0').querySelectorAll<HTMLElement>('.asm-register')].find(
    (r) => r.querySelector('dt')?.textContent === name,
  )
const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

/** Put `src` in the editor and wait for its compile to finish recording. */
async function compile(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(() => !idle(), 'the compile to start')
  await until(idle, 'the compile to finish')
}

/** Pick `key` (`bindingKey(leg, session)`) through `leaf`'s title menu, as `pane-kind-switch.test.ts`'s `pick` does. */
function pick(leaf: string, key: string): void {
  const title = host(leaf).querySelector<HTMLButtonElement>('button.view-title')
  if (title === null) throw new Error(`no title-selector on [data-leaf="${leaf}"]`)
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const item = menu?.querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`)
  if (item == null) throw new Error(`[data-leaf="${leaf}"] offers no ${key}`)
  item.click()
}

/** Choose a workspace preset through the workspace menu, as `hidden-views.test.ts` does. */
function preset(name: 'explorer' | 'stage'): void {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  document.querySelector<HTMLButtonElement>(`#workspace-menu [data-preset="${name}"]`)?.click()
  const m = document.querySelector<HTMLElement>('#workspace-menu')
  if (m?.matches(':popover-open')) m.hidePopover()
}

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await compile(SAMPLE)
})

describe('the asm leg in the app', () => {
  it('is a view of its own in the default tree, showing the program’s listing', async () => {
    await until(() => rows().length > 0, 'the asm listing to draw')
    expect(host('asm-0').dataset.kind).toBe('asm')
    expect(host('asm-0').querySelector('.view-title')?.textContent).toBe('asm · program')
    expect(rows().map(rowText)).toEqual([
      'pc0li r0, #40',
      'pc1mov r1, r0',
      'pc2li r2, #2',
      'pc3add rr, r1, r2',
      'pc4halt',
    ])
  })

  it('records every instruction, and the readout counts them in its own segment', () => {
    expect(stepOf('asm-0')).toBe('step 5 of 5')
    expect(segments()).toContain('asm 42 · 5 instructions')
    expect(segments().map((s) => s.split(' ')[0])).toEqual(['λ', 'asm', 'TM'])
  })

  it('steps from the start, the listing marking what runs next and the registers what changed', async () => {
    control('↺')?.click()
    await until(() => stepOf('asm-0').startsWith('step 0 of'), 'the asm view to restart')
    expect(listing().querySelector('.asm-row.is-next')?.textContent).toContain('pc0')
    control('▶')?.click()
    await until(() => stepOf('asm-0').startsWith('step 1 of'), 'one step')
    expect(listing().querySelector('.asm-row.is-next')?.textContent).toContain('pc1')
    const r0 = register('r0')
    expect(r0?.querySelector('dd')?.textContent).toBe('40')
    expect(r0?.classList.contains('is-changed')).toBe(true)
  })

  it('runs a program the TM refuses to build, and says why the TM declined', async () => {
    await compile(TOO_LARGE_FOR_TM)
    await until(() => stepOf('asm-0') === 'step 68 of 68', 'the asm leg to record its 68 instructions')
    expect(stepOf('tm-0')).toBe('the machine this program needs is too large to build')
    expect(segments()).toContain('asm 1 · 68 instructions')
  })

  it('declines a program asm cannot lower, with the reason, while λ runs it', async () => {
    await compile(HIGHER_ORDER)
    await until(() => stepOf('asm-0').startsWith('the asm backend does not support'), 'the asm leg to decline')
    expect(rows()).toHaveLength(0)
    const asm = segments().find((s) => s.startsWith('asm '))
    expect(asm).toMatch(/^asm declined — the asm backend does not support /)
    expect(segments().find((s) => s.startsWith('λ '))).toMatch(/^λ 8 · /)
  })
})

describe('an asm view made after the compile', () => {
  it('is told the listing the session kept, when a view is picked onto asm from its title', async () => {
    await compile(SAMPLE)
    pick('lambda-0', bindingKey('asm', 'source'))
    await until(() => host('lambda-0').dataset.kind === 'asm', 'the λ view to become an asm view')
    await until(() => rows('lambda-0').length > 0, 'the new asm view to draw')
    expect(rows('lambda-0').map(rowText)).toEqual(rows('asm-0').map(rowText))
    pick('lambda-0', bindingKey('lambda', 'source'))
    await until(() => host('lambda-0').dataset.kind === 'lambda', 'the view to go back to λ')
  })

  it('is told the listing it missed while off the page, when the stage shows it', async () => {
    preset('stage')
    const tab = (leaf: string) => document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`)
    tab('lambda-0')?.click()
    await until(() => document.querySelector('.pane[data-leaf="asm-0"]') === null, 'the asm view to leave the page')
    await compile(FACT3)
    tab('asm-0')?.click()
    // fact(3): 21 instructions under 4 labels.
    await until(() => listing().getAttribute('aria-rowcount') === '25', 'the asm view to show the new listing')
    preset('explorer')
  })
})

describe('an asm run that fills its history', () => {
  /**
   * The newest step recorded, the count after "of": `7,400` in `step 7,400 of 7,400 — history is full (oldest kept:
   * step 5)`, the line where this run's history fills. `NaN` for a line with no count.
   */
  const newest = (text: string): number => Number((text.match(/ of ([\d,]+)/)?.[1] ?? '').replaceAll(',', ''))

  /**
   * **THE ASM LEG'S `[continue]`.** A `budget` stop costs history, not the answer — `compile` already ran the program
   * to its end — so the step line offers to keep recording, and the worker's asm arm grants the leg another
   * allowance from where it stopped (`session-worker.ts`'s `onExtend`).
   */
  it('keeps recording when asked, and the count recorded grows past where it stopped', async () => {
    await compile(UPTO)
    await until(() => stepOf('asm-0').includes('history is full'), 'the asm history to fill')
    const stopped = newest(stepOf('asm-0'))
    expect(stopped, 'the run stopped short of its 8,413 instructions').toBeLessThan(8_413)
    const extend = host('asm-0').querySelector<HTMLButtonElement>('.controls .extend')
    expect(extend?.hidden).toBe(false)
    expect(extend?.textContent).toBe('keep recording')
    extend?.click()
    await until(() => newest(stepOf('asm-0')) > stopped, 'the asm leg to record past where it stopped')
  })
})
