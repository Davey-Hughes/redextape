import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * **A COMPILE WITH NO MACHINE DRAWS NOTHING OVER THE EMPTY DIAGRAM.** `StateDiagram.setProgram(null)`
 * clears the rows, but `#draw`'s `groups === null` branch returns before `#drawArcs` runs — the one place
 * that resizes the gutter SVG to the listing's own size. Left alone, the gutter keeps the LAST machine's
 * paths and dimensions, extending the scrollable region past a spacer that is now 0px tall: a scroll range
 * with nothing in it, reached by every edit that leaves the source not compiling.
 *
 * **THE WINDOW IS SCROLLED FIRST, SO THE LEFTOVER SHOWS AT ANY DIAGRAM HEIGHT.** Unscrolled, the gutter's
 * `top` is `0`, and an unsized SVG's box — 150 px tall — reaches past only a diagram shorter than that: this
 * file's, 120 px at 1280×900, but not one of 150 px or more. Stepping back onto `pc20`, near the listing's
 * end, centres that row and leaves the gutter's `top` well down the old listing — where the leftover box, if
 * not itself sized to nothing, still reaches past the diagram's own height once the spacer has emptied under
 * it.
 */

let view: EditorView

const FACT3 = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'
const HALF_TYPED = 'fn fact(n) { if n == '

const pane = () => document.querySelector('[data-leaf="tm-0"]') as HTMLElement
const diagram = () => pane().querySelector('[data-panel="diagram"]') as HTMLElement
const grid = () => diagram().querySelector('.program-scroll') as HTMLElement
const gutter = () => diagram().querySelector('.program-gutter') as HTMLElement
const rows = () => [...diagram().querySelectorAll<HTMLElement>('.program-row')]
const control = (label: string) =>
  [...pane().querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
const currentRowName = () => diagram().querySelector('.program-row[aria-current="step"] .program-name')?.textContent
const gutterTop = () => Number.parseFloat(gutter().style.top || '0')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const choice = (value: string) =>
  [...diagram().querySelectorAll<HTMLButtonElement>('.diagram-mode')].find((b) => b.dataset.value === value)
/** Whether an element is drawn: `hidden` is not enough, since an author `display` can outrank it. */
const drawn = (sel: string) => getComputedStyle(diagram().querySelector(sel) as HTMLElement).display !== 'none'

async function compile(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(() => !idle(), 'the compile to start')
  await until(idle, 'the compile to finish')
}

beforeAll(async () => {
  await page.viewport(1280, 900)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await compile(FACT3)
  await until(() => rows().length > 0, 'the diagram to draw fact(3)')
})

describe('the state diagram with no machine to draw', () => {
  it('leaves no arc and no scroll range once the source no longer compiles, with the window already scrolled', async () => {
    control('◀')?.click()
    await until(() => currentRowName() === 'pc20', 'the machine to step back onto pc20')
    // THE PRECONDITION: the window is scrolled, so a leftover box positioned at its old offset has
    // somewhere to extend the scroll range to, if it is not itself sized to nothing.
    expect(gutterTop()).toBeGreaterThan(0)
    await compile(HALF_TYPED)
    await until(() => rows().length === 0, 'the diagram to clear its rows')
    // A SECOND PRECONDITION: the program level is what the assertions below name, so it has to be the one
    // actually drawn — a machine with no program to group by is not what "no machine at all" means (spec
    // §7 and §8), and the level shown with neither is whichever was stored, not forced to `local`.
    expect(drawn('.program-level')).toBe(true)
    expect(diagram().querySelectorAll('.program-gutter path')).toHaveLength(0)
    expect(grid().scrollHeight).toBeLessThanOrEqual(grid().clientHeight)
  })

  it('keeps the stored level shown, and arcs | chips enabled, with no machine to disable them for', async () => {
    // Still on `HALF_TYPED` from the case above: no machine, so no groups and no tier — not §7's third
    // tier, which is a machine that has one. `program` was never disabled for `tm-0`, since its source
    // failing to compile is not a machine with no program level either — `tm-0` is the view bound to
    // that source, not a copy of anything.
    expect(choice('program')?.getAttribute('aria-checked')).toBe('true')
    expect(choice('program')?.disabled).toBe(false)
    expect(choice('arcs')?.disabled).toBe(false)
    choice('local')?.click()
    expect(choice('local')?.getAttribute('aria-checked')).toBe('true')
    choice('program')?.click()
    expect(choice('program')?.getAttribute('aria-checked')).toBe('true')
    expect(drawn('.program-level')).toBe(true)
  })

  it('hands the focus to the local level itself when a compile empties it while a node held it', async () => {
    // A real machine this time, so there is a node to focus.
    await compile(FACT3)
    await until(() => rows().length > 0, 'the diagram to redraw fact(3)')
    control('↺')?.click()
    choice('local')?.click()
    await until(() => diagram().querySelectorAll('.local-node').length > 0, 'the local level to draw')
    const node = diagram().querySelector<HTMLElement>('.local-node[tabindex="0"]') as HTMLElement
    node.focus()
    expect(document.activeElement).toBe(node)
    await compile(HALF_TYPED)
    await until(() => diagram().querySelectorAll('.local-node').length === 0, 'the local level to empty')
    // NOT DROPPED TO THE PAGE: the node that held the tab stop is gone, so `#focusShown`'s local branch
    // falls back to the level's own container, which is focusable for exactly this.
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(diagram().querySelector('.local-nodes'))
  })

  it('hands the focus to the grid when a recompile builds again the runtime box that held it', async () => {
    choice('program')?.click()
    await compile(FACT3)
    await until(() => rows().length > 0, 'the diagram to redraw fact(3)')
    const box = diagram().querySelector<HTMLElement>('.program-box[tabindex="0"]') as HTMLElement
    box.focus()
    expect(document.activeElement).toBe(box)
    // A recompile the focus did not come from: an edit that arrived while the reader was in the diagram.
    await compile(FACT3.replace('fact(3)', 'fact(2)'))
    await until(
      () => !box.isConnected && diagram().querySelector('.program-box') !== null,
      'the boxes to be built again',
    )
    expect(document.activeElement).toBe(grid())
  })
})
