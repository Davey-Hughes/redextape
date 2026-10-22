import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { AsmPanels } from '../../src/asm-pane'
import { AsmPane } from '../../src/asm-pane'
import { LambdaPane } from '../../src/lambda-pane'
import type { Shares } from '../../src/panel-stack'
import type { LambdaState } from '../../src/types'
import { FACT3, frameOf } from '../node/asm-fixtures'
import { wireOf } from '../node/tree-fixture'
import { controlState, frame, heightOf, inertEvents, panelOf, panelToggle } from './harness'

/**
 * THE MAXIMISE BUTTON ON EACH PANEL — the view layouts spec §11.3, `panel-stack.ts` and `panel.ts`'s `drawOver`.
 *
 * Pressed, its panel takes all of the view's spare height and every other panel of the view is DRAWN closed, its
 * header alone; what each one stores is not changed, which is held here by the view's `panel` event, the one thing
 * that writes a panel's state to the workspace. Held on an asm view built directly, which has four panels in three
 * regions, and on a λ view for the region that has no header to be drawn closed as.
 */

const CONTROLS = controlState(true, 'step 3 of 55')

function mount(panels: AsmPanels = {}) {
  const sizes = vi.fn<(s: Shares) => void>()
  const panel = vi.fn<(name: string, open: boolean) => void>()
  const host = document.createElement('section')
  host.className = 'pane'
  host.dataset.kind = 'asm'
  host.style.height = '900px'
  host.style.width = '1000px'
  document.body.append(host)
  const pane = new AsmPane(host, inertEvents({ panelSizes: sizes, panel }), panels)
  pane.setProgram(FACT3)
  pane.render(frameOf({ pc: 3, next: 3 }), CONTROLS)
  return { host, pane, sizes, panel }
}

const NAMES = ['listing', 'registers', 'stack', 'heap'] as const
const maximise = (host: HTMLElement, name: string) =>
  panelOf(host, name).querySelector('.panel-maximise') as HTMLButtonElement
const body = (host: HTMLElement, name: string) =>
  panelOf(host, name).querySelector(':scope > :not(.panel-header)') as HTMLElement
/** Each panel as it is drawn: open or closed, by its disclosure's `aria-expanded` and its body's `hidden`. */
const drawn = (host: HTMLElement): Record<string, boolean> =>
  Object.fromEntries(
    NAMES.map((n) => {
      const open = panelToggle(host, n).getAttribute('aria-expanded') === 'true'
      if (body(host, n).hidden === open) throw new Error(`${n}: aria-expanded and hidden disagree`)
      return [n, open]
    }),
  )
const pressed = (host: HTMLElement): string[] =>
  NAMES.filter((n) => maximise(host, n).getAttribute('aria-pressed') === 'true')
const boundaries = (host: HTMLElement) => host.querySelectorAll('.panel-boundary').length

beforeAll(async () => {
  await page.viewport(1280, 1000)
  // THE PAGE'S FONTS FIRST, ASKED FOR BY NAME, since nothing on the page has used them yet: a line's height is the
  // font's, and a floor of five lines and a header's height settle as the fonts arrive.
  await Promise.all([document.fonts.load('12px "Hack"'), document.fonts.load('12px "Inter"')])
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('a panel’s maximise button', () => {
  it('is in each panel’s header after its other actions, named for its panel, and not pressed', () => {
    const { host } = mount()
    expect(NAMES.map((n) => maximise(host, n).getAttribute('aria-label'))).toEqual([
      'maximise listing',
      'maximise registers',
      'maximise call stack',
      'maximise heap',
    ])
    for (const n of NAMES) {
      const b = maximise(host, n)
      expect(b.getAttribute('aria-pressed'), n).toBe('false')
      expect(b.title, `${n}’s tooltip`).toBe(b.getAttribute('aria-label'))
      expect(b.parentElement?.lastElementChild, `${n}’s is not the last of its actions`).toBe(b)
      expect(b.type).toBe('button')
    }
  })

  it('gives its panel the view’s spare height and draws every other panel closed, storing nothing', async () => {
    const { host, panel, sizes } = mount()
    const before = { ...drawn(host) }
    expect(before, 'precondition: all four are open').toEqual({
      listing: true,
      registers: true,
      stack: true,
      heap: true,
    })
    const was = heightOf(panelOf(host, 'heap'))
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    expect(pressed(host)).toEqual(['heap'])
    expect(drawn(host)).toEqual({ listing: false, registers: false, stack: false, heap: true })
    expect(boundaries(host), 'a boundary is drawn beside a maximised panel').toBe(0)
    // ALL OF WHAT THE VIEW HAS SPARE: the heap's panel ends at the view's bottom, and the view does not scroll.
    expect(heightOf(panelOf(host, 'heap')), 'the heap did not grow').toBeGreaterThan(was + 300)
    expect(panelOf(host, 'heap').getBoundingClientRect().bottom).toBeCloseTo(host.getBoundingClientRect().bottom, 0)
    expect(host.scrollHeight).toBe(host.clientHeight)
    for (const n of ['listing', 'registers', 'stack'])
      expect(heightOf(panelOf(host, n)), `${n} is more than its header`).toBeCloseTo(
        heightOf(panelOf(host, n).querySelector('.panel-header') as HTMLElement),
        0,
      )
    expect(panel, 'a maximise wrote a panel’s state to the workspace').not.toHaveBeenCalled()
    expect(sizes, 'a maximise wrote a share').not.toHaveBeenCalled()

    // PRESSED AGAIN, the regions are drawn as they are stored.
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    expect(pressed(host)).toEqual([])
    expect(drawn(host)).toEqual(before)
    expect(heightOf(panelOf(host, 'heap'))).toBeCloseTo(was, 0)
    expect(boundaries(host)).toBe(2)
    expect(panel).not.toHaveBeenCalled()
  })

  it('draws the listing again when a maximise that hid it ends, and does not draw into it while it is hidden', async () => {
    const { host, pane } = mount()
    const rows = () => host.querySelectorAll('.asm-listing .asm-row').length
    expect(rows(), 'precondition: the listing is drawn').toBeGreaterThan(3)
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    pane.render(frameOf({ pc: 13, next: 13 }), CONTROLS)
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    const next = host.querySelector('.asm-listing .asm-row.is-next')
    expect(next?.textContent, 'the listing was not drawn at the step the view is on').toContain('pc13')
  })

  it('moves to another panel when that one’s is pressed', async () => {
    const { host, panel } = mount()
    await userEvent.click(maximise(host, 'heap'))
    await userEvent.click(maximise(host, 'listing'))
    await frame()
    expect(pressed(host)).toEqual(['listing'])
    expect(drawn(host)).toEqual({ listing: true, registers: false, stack: false, heap: false })
    expect(panel).not.toHaveBeenCalled()
  })

  /** The registers and the call stack are one region, side by side, and each is a panel with a button of its own. */
  it('draws the call stack closed when the registers are maximised, in the row the two share', async () => {
    const { host } = mount()
    await userEvent.click(maximise(host, 'registers'))
    await frame()
    expect(drawn(host)).toEqual({ listing: false, registers: true, stack: false, heap: false })
    const row = host.querySelector('.asm-machine') as HTMLElement
    expect(heightOf(row), 'the row did not take the spare height').toBeGreaterThan(600)
    expect(heightOf(panelOf(host, 'registers')), 'the registers did not take the row’s').toBeCloseTo(heightOf(row), 0)
  })

  it('ends when another panel is opened by its own disclosure, which that panel stores', async () => {
    const { host, panel } = mount({ stack: false })
    expect(drawn(host).stack, 'precondition: the call stack is stored closed').toBe(false)
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    // THE LISTING IS STORED OPEN AND DRAWN CLOSED: a press on its disclosure opens what is drawn.
    await userEvent.click(panelToggle(host, 'listing'))
    await frame()
    expect(pressed(host), 'the maximise did not end').toEqual([])
    expect(panel).toHaveBeenCalledExactlyOnceWith('listing', true)
    // EVERY REGION AS IT IS STORED: the call stack, stored closed before the maximise, is closed after it.
    expect(drawn(host)).toEqual({ listing: true, registers: true, stack: false, heap: true })
    expect(boundaries(host)).toBe(2)
  })

  it('opens a panel that was stored closed when its disclosure is pressed under a maximise', async () => {
    const { host, panel } = mount({ stack: false })
    await userEvent.click(maximise(host, 'heap'))
    await userEvent.click(panelToggle(host, 'stack'))
    await frame()
    expect(panel).toHaveBeenCalledExactlyOnceWith('stack', true)
    expect(drawn(host)).toEqual({ listing: true, registers: true, stack: true, heap: true })
    expect(pressed(host)).toEqual([])
  })

  it('ends when the maximised panel is closed by its own disclosure', async () => {
    const { host, panel } = mount()
    await userEvent.click(maximise(host, 'heap'))
    await userEvent.click(panelToggle(host, 'heap'))
    await frame()
    expect(panel).toHaveBeenCalledExactlyOnceWith('heap', false)
    expect(pressed(host)).toEqual([])
    expect(drawn(host)).toEqual({ listing: true, registers: true, stack: true, heap: false })
  })

  it('opens a closed panel for as long as it is maximised, and closes it again after', async () => {
    const { host, panel } = mount({ heap: false })
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    expect(drawn(host)).toEqual({ listing: false, registers: false, stack: false, heap: true })
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    expect(drawn(host)).toEqual({ listing: true, registers: true, stack: true, heap: false })
    expect(panel, 'the panel’s stored state was written').not.toHaveBeenCalled()
  })

  it('keeps the keyboard’s focus on the button through a press, drawn pressed without relying on colour', async () => {
    const { host } = mount()
    maximise(host, 'heap').focus()
    await userEvent.keyboard('{Enter}')
    await frame()
    expect(pressed(host)).toEqual(['heap'])
    expect(document.activeElement).toBe(maximise(host, 'heap'))
    expect(getComputedStyle(maximise(host, 'heap')).boxShadow, 'pressed draws no bar').not.toBe('none')
    expect(getComputedStyle(maximise(host, 'listing')).boxShadow, 'not pressed draws one').toBe('none')
    await userEvent.keyboard(' ')
    await frame()
    expect(pressed(host)).toEqual([])
  })
})

describe('a maximise in a view with a region that has no header', () => {
  const frameState: LambdaState = {
    text: 'x',
    spans: new Uint8Array(),
    cut: null,
    step: 0,
    redex_span: null,
    owner: 'None',
  }
  const WIDE = `g ${Array.from({ length: 300 }, (_, i) => `(a${i} b${i})`).join(' ')}`

  /**
   * THE λ TERM HAS NOTHING TO BE DRAWN CLOSED AS, so it keeps its floor under a maximised term map and is not hidden:
   * a view of a term that showed none of it would be a view of its map alone.
   */
  it('leaves the term its floor and gives the map the rest', async () => {
    const host = document.createElement('section')
    host.className = 'pane'
    host.dataset.kind = 'lambda'
    host.style.height = '700px'
    host.style.width = '640px'
    document.body.append(host)
    const pane = new LambdaPane(host, inertEvents(), { map: true })
    pane.render(frameState, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    await frame()
    const term = host.querySelector('.term') as HTMLElement
    const map = host.querySelector('.term-map') as HTMLCanvasElement
    const floor = Number.parseFloat(getComputedStyle(term).minHeight)
    expect(floor, 'precondition: the term has a floor').toBeGreaterThan(60)
    expect(heightOf(term), 'precondition: the term is well over its floor').toBeGreaterThan(floor + 200)
    expect(map.clientHeight, 'precondition: the map is the 120 px it is built at').toBe(120)

    await userEvent.click(host.querySelector('[data-panel="map"] .panel-maximise') as HTMLElement)
    await frame()
    await frame()
    expect(term.hidden, 'the term was hidden').toBe(false)
    expect(heightOf(term), 'the term is not at its floor').toBeCloseTo(floor, 0)
    expect(term.querySelectorAll('.term-rows > *').length, 'the term draws no rows').toBeGreaterThan(0)
    expect(map.clientHeight, 'the map did not take the rest').toBeGreaterThan(400)
    expect(map.height, 'the map was not drawn at the height it has').toBe(
      Math.round(map.clientHeight * devicePixelRatio),
    )
    expect(host.scrollHeight).toBe(host.clientHeight)

    await userEvent.click(host.querySelector('[data-panel="map"] .panel-maximise') as HTMLElement)
    await frame()
    await frame()
    expect(map.clientHeight, 'the map is not back at the height it is built at').toBe(120)
    expect(map.height).toBe(Math.round(120 * devicePixelRatio))
  })

  /**
   * **A MAXIMISED PANEL TAKES ALL OF THE VIEW'S SPARE HEIGHT, WHATEVER SHARE A DRAG LEFT IT.** Under a maximise the
   * term's share is nothing, and were the map's own the one factor left to grow by, a map dragged down to a
   * quarter of a share would take a quarter of the spare height.
   */
  it('gives a maximised map the view’s spare height where a drag left it a share under 1', async () => {
    const host = document.createElement('section')
    host.className = 'pane'
    host.dataset.kind = 'lambda'
    host.style.height = '700px'
    host.style.width = '640px'
    document.body.append(host)
    const pane = new LambdaPane(host, inertEvents(), { map: true, sizes: { term: 1.75, map: 0.25 } })
    pane.render(frameState, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    await frame()
    const term = host.querySelector('.term') as HTMLElement
    const floor = Number.parseFloat(getComputedStyle(term).minHeight)
    expect(heightOf(term), 'precondition: the term has seven eighths of the two').toBeGreaterThan(400)
    await userEvent.click(host.querySelector('[data-panel="map"] .panel-maximise') as HTMLElement)
    await frame()
    await frame()
    expect(heightOf(term), 'the term is not at its floor').toBeCloseTo(floor, 0)
    expect(
      (host.querySelector('[data-panel="map"]') as HTMLElement).getBoundingClientRect().bottom,
      'the map’s panel does not reach the view’s bottom',
    ).toBeCloseTo(host.getBoundingClientRect().bottom, 0)
    expect(host.scrollHeight).toBe(host.clientHeight)
  })

  /**
   * **A MAP A MAXIMISE HID IS DRAWN AGAIN WHEN IT IS SHOWN, WHATEVER ELSE MOVED**: the λ view watches the canvas's
   * own box. The map draws nothing while its panel is drawn closed, and what usually draws it again is the term's
   * change of size. In a view too short for its floors the term is at its floor before the maximise, under it and
   * after it, and says nothing: held here on a view of a copy 260 px tall, whose text is what is maximised.
   */
  it('draws the map at the step the view is on when a maximise that hid it ends, with the term’s size unchanged', async () => {
    const host = document.createElement('section')
    host.className = 'pane'
    host.dataset.kind = 'lambda'
    host.style.height = '260px'
    host.style.width = '640px'
    document.body.append(host)
    const pane = new LambdaPane(host, inertEvents({ editSink: () => vi.fn(), collapse: vi.fn() }), { map: true })
    pane.render(frameState, CONTROLS)
    const first = wireOf(WIDE)
    pane.renderTree({ kind: 'tree', tree: first })
    pane.setEditor('g a b')
    await frame()
    await frame()
    const term = host.querySelector('.term') as HTMLElement
    const map = host.querySelector('.term-map') as HTMLCanvasElement
    const label = (n: number): string => `term map: ${n} nodes by depth`
    expect(map.getAttribute('aria-label')).toBe(label(first.kind.length))
    const floor = Number.parseFloat(getComputedStyle(term).minHeight)
    expect(heightOf(term), 'precondition: the term is at its floor').toBeCloseTo(floor, 0)

    const text = host.querySelector('[data-panel="text"] .panel-maximise') as HTMLElement
    await userEvent.click(text)
    await frame()
    await frame()
    expect(
      host.querySelector('[data-panel="map"] .panel-toggle')?.getAttribute('aria-expanded'),
      'precondition: the maximise drew the map closed',
    ).toBe('false')
    expect(heightOf(term), 'precondition: the term is at its floor under the maximise').toBeCloseTo(floor, 0)
    const second = wireOf('g (a b) (c d)')
    pane.renderTree({ kind: 'tree', tree: second })
    expect(map.getAttribute('aria-label'), 'precondition: a hidden map is not drawn').toBe(label(first.kind.length))

    await userEvent.click(text)
    await frame()
    await frame()
    expect(heightOf(term), 'precondition: the term is at its floor after it').toBeCloseTo(floor, 0)
    expect(map.getAttribute('aria-label'), 'the map shows the tree of a step the view has left').toBe(
      label(second.kind.length),
    )
  })
})
