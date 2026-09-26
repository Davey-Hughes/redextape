import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { SHELL, until } from './harness'
import { lambdaSettled } from './lambda-text'

/**
 * The λ view drawing the worker's tree end to end: the real worker, the real wasm, `draw()` asking
 * `LambdaTrees` for the displayed step (Plan 7 part 4a).
 */
const FACT3 = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfact(3)'

let view: EditorView

const term = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term')
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-leaf="lambda-0"] .term-line')]
const stepText = () => document.querySelector('[data-leaf="lambda-0"] .step')?.textContent ?? ''
const stepNumber = () => Number((stepText().match(/step ([\d,]+)/)?.[1] ?? '').replaceAll(',', ''))
const click = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')]
    .find((b) => b.textContent === label)
    ?.click()

async function settled(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the compile to settle')
  await until(() => !stepText().includes('not run'), 'the λ leg to record')
}

describe('the λ view draws the tree for the step it shows', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })

  it('lays out the displayed step’s tree, and the tree it shows is that step’s', async () => {
    await settled(FACT3)
    await until(() => rows().length > 0 && term()?.dataset.stale === undefined, 'a tree for the displayed step')
    expect(Number(term()?.dataset.step)).toBe(stepNumber())
    expect(term()?.getAttribute('role')).toBe('tree')
    expect(term()?.dataset.layout).toBe('code')
  })

  it('draws step 0 when the play head returns there, with the next redex marked', async () => {
    click('↺')
    await until(() => term()?.dataset.step === '0' && term()?.dataset.stale === undefined, 'step 0’s tree')
    expect(stepNumber()).toBe(0)
    expect(document.querySelector('[data-leaf="lambda-0"] .term .is-next-redex')).not.toBeNull()
    expect(document.querySelector('[data-leaf="lambda-0"] .term .is-contractum')).toBeNull()
  })

  it('marks the contractum once a step has been taken', async () => {
    click('▶')
    await until(() => term()?.dataset.step === '1' && term()?.dataset.stale === undefined, 'step 1’s tree')
    expect(document.querySelector('[data-leaf="lambda-0"] .term .is-contractum')).not.toBeNull()
  })

  it('keeps a view’s display in the stored workspace', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .view-menu-choice[data-value="outline"]')?.click()
    await until(() => term()?.dataset.layout === 'outline', 'the outline')
    const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}')
    expect(stored.display?.['lambda-0']?.layout).toBe('outline')
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .view-menu-choice[data-value="code"]')?.click()
    await until(() => term()?.dataset.layout === 'code', 'the code layout again')
  })

  /**
   * A RECOMPILE DOES NOT STRAND THE VIEW. `supersede()` moves the client's generation the moment a
   * keystroke schedules a compile, 300 ms before the worker hears of it; a tree asked for in that window
   * was dropped by the worker and waited on forever, so the view stayed on flat text for good. Found by
   * the tripwire below, which is the second program this file compiles; this names the mechanism.
   */
  it('draws the new program’s tree after a recompile', async () => {
    await settled('let x = 40; x + 2')
    await until(
      () => rows().length > 0 && Number(term()?.dataset.step) === stepNumber() && term()?.dataset.stale === undefined,
      'the new program’s tree',
    )
  })

  /**
   * A NEW COMPILE STARTS FROM THE AUTOMATIC FOLDS (spec §5.2). The program is rebuilt behind the same
   * session, so only the build changes. `1`'s chip opened by hand reads as its λ; the next program's `42`
   * must read as its chip again rather than inherit the opened root.
   */
  it('starts a new compile from the automatic folds', async () => {
    const chip = () => term()?.querySelector<HTMLElement>('.term-chip[data-node="0"]') ?? null
    const drawn = () =>
      rows().length > 0 && Number(term()?.dataset.step) === stepNumber() && term()?.dataset.stale === undefined
    await settled('let y = 1; y')
    await until(() => drawn() && chip()?.textContent === '1', 'the chip 1')
    chip()?.click()
    await until(() => chip() === null, 'the chip opened by hand')
    await settled('let x = 40; x + 2')
    await until(() => drawn() && chip()?.textContent === '42', 'the next program’s chip, closed again')
  })

  /**
   * THE DEPTH TRIPWIRE. A 600-element list's term is deepest near the end of its run (the wasm browser tier
   * measured 1,803). Its last step is the normal form, where the automatic policy folds the list's tail, so
   * the frontier's tree says nothing about depth: the tripwire steps back once, to a term still being reduced,
   * where the whole path to the next redex is open, and reads that redex's row nested more than a thousand
   * levels down.
   */
  it('lays out the deepest term a 600-element list reaches, the path to its redex open', async () => {
    const elems = Array(600).fill('0').join(', ')
    await settled(`[${elems}]`)
    await until(() => /^step ([\d,]+) of \1$/.test(stepText()), 'the run to record its last step and show it')
    await lambdaSettled()
    const end = stepNumber()
    click('◀')
    await until(() => stepNumber() === end - 1, 'the step before the end')
    await lambdaSettled()
    const row = term()?.querySelector('.is-next-redex')?.closest('.term-line')
    expect(Number(row?.getAttribute('aria-level'))).toBeGreaterThan(1_000)
    expect(document.querySelector('.banner')).toBeNull()
  }, 60_000)
})
