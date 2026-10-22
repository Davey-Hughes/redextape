import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import {
  fourViews,
  host,
  live,
  mountAt,
  mounted,
  pickPreset,
  resetToFourViews,
  showFourViews,
  storedLayout,
  tabLeaves,
  until,
} from './harness'

/**
 * THE FOUR-VIEW FIXTURES — `harness.ts`'s `showFourViews` and `resetToFourViews`, which the files written against a
 * four-view page call. What each leaves on the page, and in storage, is what those files start from, so it is held
 * here: the tree, what is remembered, what the live region says, which views are new, where the focus is, and the
 * window. And `showFourViews` is held to its refusal: it throws, with the arrangement it found, where the toggles end
 * on any tree but `fourViews()`.
 *
 * The page opens as a first visit's does, on the source beside the TM view, so the fixture's first call has the λ and
 * the asm view to bring. **THE CASES RUN IN ORDER ON ONE PAGE**, each from the state the one before left, and each
 * asserts that state first.
 */

// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
localStorage.removeItem(LAYOUT_STORAGE_KEY)

const FOUR = ['source', 'lambda-0', 'asm-0', 'tm-0']
const ROWS = 'column[50](row[50](source lambda-0) row[50](asm-0 tm-0))'
const COLUMNS = 'row[50](column[50](source asm-0) column[50](lambda-0 tm-0))'

const toggle = (kind: string): void =>
  document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`)?.click()
type Stored = { tree: unknown; focused: string; arrangements?: Record<string, unknown> }
/** The view the keyboard focus is in. */
const focusedView = (): string | undefined =>
  document.activeElement?.closest<HTMLElement>('#views [data-leaf]')?.dataset.leaf
/** The pane a view's host holds: a view built again is another element in the host the one before it had. */
const pane = (leaf: string): Element | null => host(leaf)?.firstElementChild ?? null

/** The window's width at each `resize` the page has heard. */
const widths: number[] = []

describe('the four-view fixtures', () => {
  beforeAll(async () => {
    await mountAt(1280, 896)
    window.addEventListener('resize', () => widths.push(window.innerWidth))
  })

  it('showFourViews ends on fourViews(), in the window it started in, having resized it twice', async () => {
    expect(mounted(), 'precondition: the first-load views').toEqual(['source', 'tm-0'])
    expect(storedLayout<Stored>().arrangements, 'precondition: nothing is remembered').toBeUndefined()
    await showFourViews()
    expect(mounted()).toEqual(FOUR)
    expect(storedLayout<Stored>().tree).toEqual(fourViews())
    expect([window.innerWidth, window.innerHeight]).toEqual([1280, 896])
    await until(() => widths.length >= 2, 'both resizes to be heard')
    expect(widths).toEqual([320, 1280])
  })

  it('leaves two arrangements remembered, the live region on what is shown, and the focus in the λ view', () => {
    expect(Object.keys(storedLayout<Stored>().arrangements ?? {})).toEqual(['source+tm', 'source+lambda+tm'])
    expect(live()).toBe('showing source, asm, λ and TM')
    expect(focusedView()).toBe('lambda-0')
    expect(storedLayout<Stored>().focused).toBe('lambda-0')
  })

  it('resetToFourViews builds the λ and the asm view new and keeps the TM view, from a reset that focused it', async () => {
    expect(mounted(), 'precondition: all four views').toEqual(FOUR)
    const before = { lambda: pane('lambda-0'), asm: pane('asm-0'), tm: pane('tm-0') }
    expect([before.lambda, before.asm, before.tm], 'precondition: each view has a pane').not.toContain(null)
    // THE FIXTURE'S FIRST HALF BY ITSELF, FOR WHAT IT LEAVES BEFORE THE SECOND MOVES IT.
    document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
    expect(mounted()).toEqual(['source', 'tm-0'])
    expect(storedLayout<Stored>().arrangements, 'the reset remembered an arrangement').toBeUndefined()
    expect(storedLayout<Stored>().focused).toBe('tm-0')
    expect(focusedView()).toBe('tm-0')
    await resetToFourViews()
    expect(storedLayout<Stored>().tree).toEqual(fourViews())
    expect(Object.keys(storedLayout<Stored>().arrangements ?? {})).toEqual(['source+tm', 'source+lambda+tm'])
    expect(pane('tm-0'), 'the TM view was built again').toBe(before.tm)
    expect(pane('lambda-0'), 'the λ view is the one the reset closed').not.toBe(before.lambda)
    expect(pane('asm-0'), 'the asm view is the one the reset closed').not.toBe(before.asm)
    expect(focusedView()).toBe('lambda-0')
  })

  /**
   * **WHERE THE TOGGLES END ON ANOTHER TREE**: all four views were shown once in this wide window, so that
   * combination remembers two columns of two, and the toggles show what is remembered.
   */
  it('showFourViews throws, naming what it found, where all four are remembered in another arrangement', async () => {
    document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
    toggle('lambda')
    toggle('asm')
    expect(
      storedLayout<Stored>().tree,
      'precondition: a wide window’s default for all four is not fourViews()',
    ).not.toEqual(fourViews())
    toggle('asm')
    toggle('lambda')
    expect(mounted(), 'precondition: the source beside the TM view again').toEqual(['source', 'tm-0'])
    expect(Object.keys(storedLayout<Stored>().arrangements ?? {}), 'precondition: all four are remembered').toContain(
      'source+lambda+asm+tm',
    )
    let thrown = ''
    await showFourViews().catch((e: unknown) => {
      thrown = e instanceof Error ? e.message : String(e)
    })
    expect(thrown).toBe(`showFourViews left the page on ${COLUMNS}, and not on ${ROWS}`)
    expect([window.innerWidth, window.innerHeight], 'the window was not put back before the throw').toEqual([1280, 896])
  })

  it('holds the tabs’ order in Stage, where the page draws no tree', async () => {
    pickPreset('stage')
    expect(tabLeaves(), 'precondition: the Stage, on the columns the case above left').toEqual([
      'source',
      'asm-0',
      'lambda-0',
      'tm-0',
    ])
    document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
    toggle('lambda')
    toggle('asm')
    toggle('asm')
    toggle('lambda')
    expect(tabLeaves(), 'precondition: the source and the TM view, as tabs').toEqual(['source', 'tm-0'])
    let thrown = ''
    await showFourViews().catch((e: unknown) => {
      thrown = e instanceof Error ? e.message : String(e)
    })
    expect(thrown).toBe(
      'showFourViews left the page on stage(source asm-0 lambda-0 tm-0), and not on stage(source lambda-0 asm-0 tm-0)',
    )
    await resetToFourViews()
    expect(tabLeaves()).toEqual(FOUR)
    expect(storedLayout<Stored>().tree).toEqual(fourViews())
  })
})
