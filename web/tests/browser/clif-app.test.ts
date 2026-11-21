import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { compile, host, PREFIX, SHELL, until, viewMenu } from './harness'

/**
 * The CLIF view through the whole app (CLIF view design §4): a compile of `fact.rxt` reaches a CLIF view shown with
 * the view keys and 5 on the four-view page, its step controls drive it, and it says why a program has no CLIF. Each
 * fact read here is `fact.rxt`'s as built. `clif-pane.test.ts` holds the view on its own, and
 * `clif-app-failed.test.ts` a load that fails, which needs a page whose worker has not loaded the package.
 */

const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
/** `clif-package.test.ts`'s list, which the rxm leg declines, so the CLIF leg has no input to build from. */
const LIST = `[${Array.from({ length: 2048 }, (_, i) => i).join(', ')}]`
/** `measure::CORPUS`'s `loop1000000`, which the CLIF leg records chunk after chunk until its history is full. */
const LOOP = 'let mut i = 0; let mut acc = 0; while i < 1000000 { acc = acc + i; i = i + 1; } acc'

/** Each long case's own bound, past every wait in it. */
const CASE_MS = 60_000

let view: EditorView

const clif = () => host('clif-0') as HTMLElement
const rxm = () => host('rxm-0') as HTMLElement
const stepOf = (pane: HTMLElement) => pane.querySelector('.step')?.textContent ?? ''
const control = (pane: HTMLElement, label: string) =>
  [...pane.querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
const listing = () => clif().querySelector<HTMLElement>('.clif-listing') as HTMLElement
/** The CLIF listing's drawn row `row`, by its 0-based index in the listing. */
const rowAt = (row: number) => clif().querySelector<HTMLElement>(`.clif-row[aria-rowindex="${row + 1}"]`)
const pcOf = (row: HTMLElement | null) => row?.querySelector('.rxm-pc')?.textContent
const textOf = (row: HTMLElement | null) => row?.querySelector('.clif-cell')?.textContent ?? ''
/** How far `row`'s pc column starts from the row's own left edge. */
const pcOffset = (row: HTMLElement) =>
  (row.querySelector('.rxm-pc') as HTMLElement).getBoundingClientRect().left - row.getBoundingClientRect().left
const notice = () => clif().querySelector<HTMLElement>('p.clif-notice')
/** The notice's sentence, without the label of the button after it. */
const sentence = () => notice()?.firstChild?.textContent ?? ''

/**
 * Every row of the CLIF listing whose pc column reads `pc`, by its index, with that column's offset from its row's
 * left edge, in listing order: read by scrolling the listing through from its top, a few rows at a time, since it draws
 * only the rows in view.
 */
async function rowsShowing(pc: string): Promise<Map<number, number>> {
  const found = new Map<number, number>()
  const count = Number(listing().getAttribute('aria-rowcount'))
  for (let top = 0; top < count; top += 4) {
    listing().scrollTop = top * 24
    const last = Math.min(top + 3, count - 1)
    await until(() => rowAt(top) !== null && rowAt(last) !== null, `the listing to draw rows ${top} to ${last}`)
    for (const row of clif().querySelectorAll<HTMLElement>('.clif-row')) {
      if (pcOf(row) === pc) found.set(Number(row.getAttribute('aria-rowindex')) - 1, pcOffset(row))
    }
  }
  return new Map([...found].sort(([a], [b]) => a - b))
}

/** Put the CLIF listing back on the instruction about to run, where a case before scrolled it away. */
async function follow(): Promise<void> {
  const reattach = clif().querySelector<HTMLButtonElement>('.panel[data-panel="listing"] .table-reattach')
  if (reattach !== null && !reattach.hidden) await userEvent.click(reattach)
}

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await compile(view, FACT)
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a CLIF view')
  await until(() => /^step 0 of \d/.test(stepOf(clif())), 'the CLIF view to record its run')
}, 30_000)

describe('the CLIF view in the app', () => {
  it("lists the program as built, its pcs in the rxm view's form", async () => {
    await until(() => rowAt(29) !== null, 'the CLIF listing to draw')
    expect(textOf(rowAt(29)).endsWith('v1 = iconst.i64 0')).toBe(true)
    expect(pcOf(rowAt(29))).toBe('')

    // THE FIVE ROWS WHOSE SRCLOC IS 13, read from the listing as built, and no other row of it.
    const pc13 = await rowsShowing('pc13')
    expect([...pc13.keys()]).toEqual([161, 162, 165, 168, 169])
    const rxmRow = rxm().querySelector<HTMLElement>('.rxm-row:has(.rxm-pc)') as HTMLElement
    for (const [row, offset] of pc13) {
      expect(Math.abs(offset - pcOffset(rxmRow)), `row ${row}'s pc column`).toBeLessThanOrEqual(1)
    }
    await follow()
  })

  it(
    'steps to step 95 and shows values, call stack and heap',
    async () => {
      await follow()
      for (let step = 1; step <= 95; step += 1) {
        await userEvent.click(control(clif(), '▶') as HTMLButtonElement)
        await until(() => stepOf(clif()).startsWith(`step ${step} of`), `the CLIF view to reach step ${step}`)
      }
      const values = [...clif().querySelectorAll<HTMLElement>('.rxm-register')]
      expect(values).toHaveLength(17)
      const v1 = values.find((r) => r.querySelector('dt')?.textContent === 'v1')
      const dd = v1?.querySelector('dd')
      expect(dd?.firstChild?.textContent).toBe('2')
      expect(dd?.querySelector('.value-regs')?.textContent).toBe('a0')

      const frames = [...clif().querySelectorAll<HTMLElement>('.rxm-frame')]
      expect(frames).toHaveLength(4)
      expect(frames[0]?.querySelector('.rxm-callee')?.textContent).toBe('u0:12 fact.0')
      expect(clif().querySelectorAll('.rxm-cell-line')).toHaveLength(0)

      // THE FRAME'S `next`: `fact.0`'s instruction 27, row 152, lowered from pc 11.
      const next = clif().querySelector<HTMLElement>('.clif-row.is-next')
      expect(next?.getAttribute('aria-rowindex')).toBe('153')
      expect(pcOf(next)).toBe('pc11')
      expect(textOf(next).endsWith('v27 = isub.i64 v24, v26')).toBe(true)

      // AT THE RUN'S END NOTHING RUNS NEXT, though the frame still stands at its last instruction.
      await userEvent.click(clif().querySelector('.controls .to-newest') as HTMLButtonElement)
      await until(() => stepOf(clif()).startsWith('step 189 of'), "the CLIF view to reach the run's end")
      expect(clif().querySelector('.clif-row.is-next')).toBeNull()
    },
    CASE_MS,
  )

  it('offers no edit a copy', async () => {
    await userEvent.click(clif().querySelector('button.view-more') as HTMLButtonElement)
    await until(() => viewMenu(clif()).matches(':popover-open'), 'the view menu to open')
    expect(viewMenu(clif()).querySelector('button.detach')).toBeNull()
    expect(viewMenu(clif()).textContent).not.toContain('edit a copy')
    await userEvent.keyboard('{Escape}')
  })

  it('says why a program has no CLIF', async () => {
    await compile(view, LIST)
    await until(() => sentence().startsWith('No CLIF for this program: '), 'the CLIF view to say why')
    const reason = stepOf(rxm())
    expect(reason, 'precondition: the rxm view gives a reason, not a step').not.toMatch(/^step |^$/)
    expect(sentence()).toBe(`No CLIF for this program: ${reason}`)
    expect(clif().querySelectorAll('.clif-row')).toHaveLength(0)
  })

  it('says nothing is loading for a program that does not compile', async () => {
    await compile(view, FACT)
    await until(() => /^step \d/.test(stepOf(clif())), 'the CLIF view to record fact')
    await compile(view, 'let x = ;')
    await until(() => stepOf(clif()) === 'not compiled', "the CLIF view's step bar to say why")
    expect(notice(), 'the CLIF notice').toBeNull()
  })

  it(
    'keeps recording past a full history',
    async () => {
      /** The newest step recorded, the count after "of"; `NaN` for a line with no count. */
      const newest = (text: string): number => Number((text.match(/ of ([\d,]+)/)?.[1] ?? '').replaceAll(',', ''))
      await compile(view, LOOP)
      await until(() => stepOf(clif()).includes('history is full'), 'the CLIF history to fill')
      const stopped = newest(stepOf(clif()))
      expect(stopped).toBeGreaterThan(0)
      const extend = clif().querySelector<HTMLButtonElement>('.controls .extend')
      expect(extend?.hidden).toBe(false)
      expect(extend?.textContent).toBe('keep recording')
      await userEvent.click(extend as HTMLButtonElement)
      await until(() => newest(stepOf(clif())) > stopped, 'the CLIF leg to record past where it stopped')
    },
    CASE_MS,
  )
})
