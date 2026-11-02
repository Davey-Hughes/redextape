import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import { page } from 'vitest/browser'
import sumTo from '../../src/examples/sum-to.rxt?raw'
import { LANES, NARROW_LANES } from '../../src/lambda-body'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import {
  barPieces,
  barRows,
  drawsEdge,
  frames,
  lambdaControl,
  lambdaMark,
  lambdaStepText,
  lambdaTerm,
  markStart,
  SHELL,
  stateIdle,
  stripWidth,
  until,
  wordEdges,
} from './harness'
import { lambdaSettled } from './lambda-text'

/**
 * The λ view drawing the worker's tree end to end: the real worker, the real wasm, `draw()` asking
 * `LambdaTrees` for the displayed step (Plan 7 part 4 spec §4).
 */
const FACT3 = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfact(3)'

let view: EditorView

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-leaf="lambda-0"] .term-line')]
const stepNumber = () => Number((lambdaStepText().match(/step ([\d,]+)/)?.[1] ?? '').replaceAll(',', ''))
/** `⏭`: the λ view to its newest recorded step. A run opens on step 0 (`History`). */
const toNewest = () =>
  document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button.to-newest')?.click()

async function settled(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(stateIdle, 'the compile to settle')
  await until(() => !lambdaStepText().includes('not run'), 'the λ leg to record')
}

describe('the λ view draws the tree for the step it shows', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })

  it('lays out the displayed step’s tree, and the tree it shows is that step’s', async () => {
    await settled(FACT3)
    await until(() => rows().length > 0 && lambdaTerm()?.dataset.stale === undefined, 'a tree for the displayed step')
    expect(Number(lambdaTerm()?.dataset.step)).toBe(stepNumber())
    expect(lambdaTerm()?.getAttribute('role')).toBe('tree')
    expect(lambdaTerm()?.dataset.layout).toBe('code')
  })

  it('draws step 0 when the play head returns there, with the next redex marked', async () => {
    toNewest()
    await until(
      () =>
        stepNumber() > 0 &&
        lambdaTerm()?.dataset.step === String(stepNumber()) &&
        lambdaTerm()?.dataset.stale === undefined,
      'the newest step’s tree',
    )
    lambdaControl('↺')
    await until(() => lambdaTerm()?.dataset.step === '0' && lambdaTerm()?.dataset.stale === undefined, 'step 0’s tree')
    expect(stepNumber()).toBe(0)
    expect(lambdaMark('next-redex')).not.toBeNull()
    expect(lambdaMark('contractum')).toBeNull()
  })

  it('marks the contractum once a step has been taken', async () => {
    lambdaControl('▶')
    await until(() => lambdaTerm()?.dataset.step === '1' && lambdaTerm()?.dataset.stale === undefined, 'step 1’s tree')
    expect(lambdaMark('contractum')).not.toBeNull()
  })

  it('keeps a view’s display in the stored workspace', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .view-menu-choice[data-value="outline"]')?.click()
    await until(() => lambdaTerm()?.dataset.layout === 'outline', 'the outline')
    const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}')
    expect(stored.display?.['lambda-0']?.layout).toBe('outline')
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .view-menu-choice[data-value="code"]')?.click()
    await until(() => lambdaTerm()?.dataset.layout === 'code', 'the code layout again')
  })

  /**
   * A RECOMPILE DOES NOT STRAND THE VIEW. `supersede()` moves the client's generation the moment a
   * keystroke schedules a compile, 300 ms before the worker hears of it; a tree asked for in that window,
   * dropped by the worker, would be waited on forever, and the view would stay on flat text for good.
   */
  it('draws the new program’s tree after a recompile', async () => {
    await settled('let x = 40; x + 2')
    await until(
      () =>
        rows().length > 0 &&
        Number(lambdaTerm()?.dataset.step) === stepNumber() &&
        lambdaTerm()?.dataset.stale === undefined,
      'the new program’s tree',
    )
  })

  /**
   * A NEW COMPILE STARTS FROM THE AUTOMATIC FOLDS (spec §5.2). The program is rebuilt behind the same
   * session, so only the build changes. `1`'s chip opened by hand reads as its λ; the next program's `42`
   * must read as its chip again rather than inherit the opened root.
   */
  it('starts a new compile from the automatic folds', async () => {
    const chip = () => lambdaTerm()?.querySelector<HTMLElement>('.term-chip[data-node="0"]') ?? null
    const drawn = () =>
      rows().length > 0 &&
      Number(lambdaTerm()?.dataset.step) === stepNumber() &&
      lambdaTerm()?.dataset.stale === undefined
    await settled('let y = 1; y')
    // THE NORMAL FORM'S CHIP, AT THE NEWEST STEP.
    toNewest()
    await until(() => drawn() && chip()?.textContent === '1', 'the chip 1')
    chip()?.click()
    await until(() => chip() === null, 'the chip opened by hand')
    await settled('let x = 40; x + 2')
    toNewest()
    await until(() => drawn() && chip()?.textContent === '42', 'the next program’s chip, closed again')
  })

  /**
   * A MARK ON THE WHOLE TERM: at step 0 the next redex is the root, and a link on the root covers it too. Drawn
   * round every word, the two would box the whole term. Its scrolls stop the view following, so it follows again.
   */
  it('marks a linked root at step 0 with a bar piece on each drawn row, every fold open, and boxes no word', async () => {
    onTestFinished(() => document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .term-reattach')?.click())
    await settled(sumTo)
    await until(() => lambdaTerm()?.dataset.step === '0' && lambdaTerm()?.dataset.stale === undefined, 'step 0')
    const term = lambdaTerm() as HTMLElement
    const lambda = [...term.querySelectorAll<HTMLElement>('.term-line [data-node]')].find((k) => k.textContent === 'λ')
    lambda?.click()
    await until(() => barPieces(term, 'linked').length > 0, 'the root linked')
    const shut = () => term.querySelector<HTMLElement>('.term-fold, .term-gutter[data-open="false"]')
    term.scrollTop = 0
    await frames()
    for (let n = 0; n < 1_000; n += 1) {
      const fold = shut()
      if (fold !== null) {
        fold.click()
        await until(() => !fold.isConnected, 'the fold opened')
      } else if (term.scrollTop + term.clientHeight >= term.scrollHeight - 1) break
      else {
        term.scrollTop += term.clientHeight
        await frames()
      }
    }
    const lines = Number(rows()[0]?.getAttribute('aria-setsize'))
    for (const end of [0, term.scrollHeight]) {
      term.scrollTop = end
      await frames()
      const drawn = rows().map((r) => Number(r.dataset.line))
      expect(shut(), 'precondition: every fold open').toBeNull()
      expect(drawn.length, 'precondition: rows are left undrawn').toBeLessThan(lines)
      expect(drawn.includes(end === 0 ? 0 : lines - 1), 'precondition: the scrolled-to end is drawn').toBe(true)
      expect(barRows(term, 'next-redex', stripWidth(term))).toEqual(drawn)
      expect(barRows(term, 'linked', stripWidth(term))).toEqual(drawn)
      expect(wordEdges(term)).toEqual([])
    }
    const last = barPieces(term, 'linked').at(-1) as Element
    expect(drawsEdge(getComputedStyle(last), 'Bottom'), 'the bracket closes').toBe(true)
  })

  /**
   * THE DEPTH TRIPWIRE. A 600-element list's term is deepest near the end of its run. Its last step is the
   * normal form, where the automatic policy folds the list's tail, so the frontier's tree says nothing about
   * depth: the tripwire steps back once, to a term still being reduced, where the whole path to the next redex
   * is open, and reads that redex's row nested more than a thousand levels down.
   */
  it('lays out the deepest term a 600-element list reaches, the path to its redex open', async () => {
    const elems = Array(600).fill('0').join(', ')
    await settled(`[${elems}]`)
    await until(() => /^step [\d,]+ of [\d,]+$/.test(lambdaStepText()), 'the run to record its last step')
    toNewest()
    await until(() => /^step ([\d,]+) of \1$/.test(lambdaStepText()), 'the run’s last step shown')
    await lambdaSettled()
    const end = stepNumber()
    lambdaControl('◀')
    await until(() => stepNumber() === end - 1, 'the step before the end')
    await lambdaSettled()
    const row = lambdaTerm()?.querySelector(markStart('next-redex'))?.closest('.term-line')
    expect(Number(row?.getAttribute('aria-level'))).toBeGreaterThan(1_000)
    expect(document.querySelector('.banner')).toBeNull()
  }, 60_000)

  /**
   * THE FIRST THING A PHONE SHOWS: the default program at step 0, its folds automatic. At 390x844 the λ pane scrolls
   * down; a headless browser draws it no scrollbar, and the term's first row fits beside either strip. A desktop
   * browser's scrollbar on the pane makes the term narrower, and the wide strip pushes that row past it. So the term
   * is then sized to the widest the wide strip would push the row and its gutter past, where the narrow strip must
   * keep them in view.
   */
  it('draws the default program’s first step at 390x844 with its first row in view beside the narrow strip, in a term the wide strip would push it past', async () => {
    const [w, h] = [innerWidth, innerHeight]
    onTestFinished(() => page.viewport(w, h))
    await settled(sumTo)
    await page.viewport(390, 844)
    await until(() => innerWidth === 390 && innerHeight === 844, 'the 390x844 viewport')
    await until(() => lambdaTerm()?.dataset.step === '0' && lambdaTerm()?.dataset.stale === undefined, 'step 0’s tree')
    await frames()
    const term = lambdaTerm() as HTMLElement
    expect(rows()[0]?.textContent, 'precondition: the first row').toBe('(λsum_to. sum_to 5)')
    const pane = term.closest('.pane') as HTMLElement
    expect(pane.scrollHeight, 'precondition: the λ pane scrolls down').toBeGreaterThan(pane.clientHeight)
    expect(stripWidth(term), 'precondition: the narrow strip').toBe(NARROW_LANES)
    expect(term.scrollWidth - term.clientWidth, 'sideways scroll').toBe(0)
    const style = term.getAttribute('style')
    onTestFinished(() => {
      if (style === null) term.removeAttribute('style')
      else term.setAttribute('style', style)
    })
    const words = () =>
      [...(rows()[0] as HTMLElement).querySelectorAll('[data-node]:not(.term-gutter)')].map((k) =>
        k.getBoundingClientRect(),
      )
    const ch = (Math.max(...words().map((b) => b.right)) - Math.min(...words().map((b) => b.left))) / 19
    Object.assign(term.style, { flex: 'none', width: `${Math.ceil(LANES + 21 * ch) - 1}px` })
    await frames()
    const end = Math.max(...words().map((b) => b.right)) - term.getBoundingClientRect().left - term.clientLeft
    expect(stripWidth(term), 'the strip in the sized term').toBe(NARROW_LANES)
    expect(end - NARROW_LANES + LANES, 'precondition: the wide strip would push the row past').toBeGreaterThan(
      term.clientWidth,
    )
    expect(term.scrollWidth - term.clientWidth, 'sideways scroll in the sized term').toBe(0)
  })
})
