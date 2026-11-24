import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { DEBOUNCE_MS } from '../../src/compile'
import { EXAMPLES } from '../../src/examples'
import type { Listing } from '../../src/protocol'
import { clifChunks, clifStopped, hearSessionWorkers, requestsOf, sleep } from './clif-fixture'
import { examplesButton, frames, host, noticeText, PREFIX, SHELL, stateIdle, undoButton, until } from './harness'

/**
 * **THE LISTING SWITCH ON A CLIF VIEW'S BAR** (CLIF view design §4 and §6, *The switch*): heard between the page and
 * its session worker, a choice re-records the CLIF leg alone from step 0, every CLIF view shows it, it is stored with
 * the program, and a switch while the leg records keeps nothing of the listing it leaves. Each listing fact is
 * `fact.rxt`'s as the CLIF probe read it, but for `loop1000000`'s optimised row count.
 */

const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
/** `measure::CORPUS`'s `loop1000000`, which the CLIF leg records chunk after chunk for seconds. */
const LOOP = 'let mut i = 0; let mut acc = 0; while i < 1000000 { acc = acc + i; i = i + 1; } acc'

/** Each choice's title, which says what the listing is. */
const HINTS: { readonly [L in Listing]: string } = {
  'as-built': "redextape's lowering, before Cranelift's passes",
  optimised: "Cranelift's output at every opt level from O1 up, the same for every target",
}

let ear: ReturnType<typeof hearSessionWorkers>
let view: EditorView

/**
 * Mount the app, its first compile settled. **A RELOAD IS A FRESH `main` ON THE SAME STORE**: a query string gives a
 * new module instance, and `localStorage` is left as the first instance wrote it.
 */
let mounts = 0
async function mount(): Promise<EditorView> {
  const spec = mounts === 0 ? '../../src/main' : `../../src/main?remount=${mounts}`
  mounts += 1
  document.body.innerHTML = SHELL
  const ready: EditorView = await (await import(/* @vite-ignore */ spec)).ready
  await until(stateIdle, 'the first compile')
  return ready
}

beforeAll(async () => {
  ear = hearSessionWorkers()
  await page.viewport(1280, 1600)
  view = await mount()
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: FACT } })
  await until(() => !stateIdle(), 'the compile to start')
  await until(stateIdle, 'the compile to finish')
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a CLIF view')
  await until(() => /^step 0 of \d/.test(stepOf(clif())), 'the CLIF view to record its run')
  await until(() => rowAt(clif(), 29) !== null, 'the CLIF listing to draw')
}, 30_000)

afterAll(() => ear.restore())

const clif = (leaf = 'clif-0') => host(leaf) as HTMLElement
const stepOf = (pane: HTMLElement) => pane.querySelector('.step')?.textContent ?? ''
/** The CLIF views on the page, in the order the page holds them. */
const clifViews = () => [...document.querySelectorAll<HTMLElement>('#views [data-kind="clif"]')]
/** `pane`'s choice of `listing` on its bar. */
const choice = (pane: HTMLElement, listing: Listing) =>
  pane.querySelector<HTMLButtonElement>(`.view-actions [role="radiogroup"] button[data-value="${listing}"]`)
const checked = (pane: HTMLElement, listing: Listing) => choice(pane, listing)?.getAttribute('aria-checked')
/** The CLIF listing's drawn row `row`, by its 0-based index in the listing. */
const rowAt = (pane: HTMLElement, row: number) =>
  pane.querySelector<HTMLElement>(`.clif-row[aria-rowindex="${row + 1}"]`)
const textOf = (row: HTMLElement | null) => row?.querySelector('.clif-cell')?.textContent ?? ''
const rowCount = (pane: HTMLElement) => pane.querySelector('.clif-listing')?.getAttribute('aria-rowcount')

/** The `clif` requests posted since `mark`, an index into what was heard. */
const clifAsked = (mark: number) => requestsOf(ear.heard.slice(mark), 'clif')
/** The next `clif` request posted since `mark`, once there is one. */
async function nextClif(mark: number, what: string) {
  await until(() => clifAsked(mark).length > 0, what)
  return clifAsked(mark)[0] as NonNullable<ReturnType<typeof clifAsked>[number]>
}

/** Split `leaf` into another view of it through its `⋯` menu, pressed as a user presses. */
async function splitSame(leaf: string): Promise<void> {
  const more = clif(leaf).querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
  await userEvent.click(more)
  const menu = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement
  await userEvent.click(menu.querySelector('button.view-split[data-dir="row"]') as HTMLElement)
  await userEvent.click(menu.querySelector('.view-menu-pairs button[data-same]') as HTMLElement)
}

describe('the listing switch', () => {
  it('switches the listing without a recompile', async () => {
    expect(checked(clif(), 'as-built'), 'precondition: the view opens as built').toBe('true')
    expect(textOf(rowAt(clif(), 29)).endsWith('v1 = iconst.i64 0'), 'precondition: row 29 as built').toBe(true)
    const before = requestsOf(ear.heard, 'clif').at(-1)?.epoch ?? 0
    const mark = ear.heard.length
    await userEvent.click(choice(clif(), 'optimised') as HTMLButtonElement)
    await until(
      () => /^step 0 of \d/.test(stepOf(clif())) && textOf(rowAt(clif(), 29)).endsWith('jump block1'),
      'the CLIF view to show the optimised listing at step 0',
    )
    // PAST THE DEBOUNCE A RECOMPILE WOULD POST ITS RUN AFTER.
    await sleep(DEBOUNCE_MS * 2)
    expect(requestsOf(ear.heard.slice(mark), 'run'), 'the runs posted since the press').toEqual([])
    const asked = clifAsked(mark)
    expect(asked.map((r) => r.listing)).toEqual(['optimised'])
    expect(asked[0]?.epoch, 'its epoch, above the one the view was showing').toBeGreaterThan(before)
    await until(() => clifStopped(ear.heard.slice(mark), asked[0]?.epoch ?? -1), "the CLIF leg's new recording")
    expect(stepOf(clif())).toMatch(/^step 0 of \d/)
    expect(textOf(rowAt(clif(), 29)).endsWith('jump block1')).toBe(true)
    expect(checked(clif(), 'optimised')).toBe('true')
    expect(checked(clif(), 'as-built')).toBe('false')
    expect(choice(clif(), 'as-built')?.title).toBe(HINTS['as-built'])
    expect(choice(clif(), 'optimised')?.title).toBe(HINTS.optimised)
  })

  it('every CLIF view shows the one choice', async () => {
    await splitSame('clif-0')
    await until(() => clifViews().length === 2, 'a second CLIF view')
    const second = clifViews().find((v) => v !== clif()) as HTMLElement
    expect(checked(second, 'optimised')).toBe('true')
    expect(checked(second, 'as-built')).toBe('false')
  })

  it('the choice outlives a reload', async () => {
    const mark = ear.heard.length
    view = await mount()
    await until(() => host('clif-0') !== null, 'the CLIF view the workspace kept')
    expect(checked(clif(), 'optimised')).toBe('true')
    expect(requestsOf(ear.heard.slice(mark), 'run')[0]?.clif).toBe('optimised')
  })

  it('a switch while recording keeps nothing of the old listing', async () => {
    await userEvent.click(choice(clif(), 'as-built') as HTMLButtonElement)
    await until(() => checked(clif(), 'as-built') === 'true', 'the view to show as built')
    const typed = ear.heard.length
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: LOOP } })
    await until(() => requestsOf(ear.heard.slice(typed), 'run').length > 0, "the loop's run")
    expect(requestsOf(ear.heard.slice(typed), 'run')[0]?.clif, 'precondition: the run records as built').toBe(
      'as-built',
    )
    await until(() => clifChunks(ear.heard.slice(typed), 0).length > 0, "the first CLIF chunk of the loop's run")
    const pressed = ear.heard.length
    await userEvent.click(choice(clif(), 'optimised') as HTMLButtonElement)
    const asked = await nextClif(pressed, 'the clif request the press posts')
    expect(asked.listing).toBe('optimised')
    await until(() => clifChunks(ear.heard.slice(pressed), asked.epoch).length > 0, 'the optimised frames')
    expect(
      clifChunks(ear.heard.slice(pressed), 0).length,
      'precondition: a chunk of the listing as built came after the press',
    ).toBeGreaterThan(0)
    await frames()
    // THE STEP LINE COUNTS THE FRAMES THE RING HOLDS, SO IT READS `step 0` WHATEVER FRAME CAME FIRST: the row about to
    // run tells the optimised listing's step 0, its `jump block1` at `aria-rowindex` 28, from a frame of the run as
    // built, which stands in the loop's body.
    expect(rowCount(clif())).toBe('106')
    const next = clif().querySelector<HTMLElement>('.clif-row.is-next')
    expect(next?.getAttribute('aria-rowindex'), 'the row about to run').toBe('28')
    expect(textOf(next).endsWith('jump block1')).toBe(true)
    expect(stepOf(clif())).toMatch(/^step 0 of \d/)
  }, 60_000)

  /**
   * **A PICK'S UNDO GOES AT A LISTING CHOSEN**, as at a width chosen: it would put back the listing the pick replaced.
   */
  it('withdraws a picked example’s undo', async () => {
    await userEvent.click(examplesButton())
    await userEvent.click(document.querySelector('#examples-menu button[data-example="fact"]') as HTMLElement)
    expect(undoButton()?.textContent).toBe('undo')
    await until(stateIdle, 'the example’s compile')
    expect(checked(clif(), 'as-built'), 'precondition: the pick opens as built').toBe('true')
    await userEvent.click(choice(clif(), 'optimised') as HTMLButtonElement)
    expect(checked(clif(), 'optimised'), 'precondition: the press chose optimised').toBe('true')
    expect(undoButton()).toBeNull()
    expect(noticeText()).toBe('')
  })
})
