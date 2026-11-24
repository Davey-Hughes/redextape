import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { moveInto } from '../../src/machine-row'
import { PanelStack, type Shares } from '../../src/panel-stack'
import { collect } from './engine'
import { boundary, frame, frames, hearLoops, panelOf, panelToggle, region, tick } from './harness'
import {
  arrangement,
  boundaryKeys,
  box,
  columnsOf,
  drawnAs,
  expectRows,
  header,
  loadViews,
  maximise,
  mount,
  resize,
  row,
  underBoundaries,
  VIEWS,
} from './machine-views'

/**
 * `machine-row.ts`, on elements built by hand and on an rxm view and a CLIF view in hosts sized by hand.
 *
 * `moveInto`, THE MOVE A MACHINE VIEW MAKES OF ITS CALL STACK AND HEAP (the machine panels row design §6.6): a button
 * inside what moves keeps the focus where the browser moves an element in place, where it has no such move, and where
 * it refuses the one asked for.
 *
 * `MachineRow`, A VIEW'S THREE ARRANGEMENTS OF ITS VALUES, CALL STACK AND HEAP (§5): where each view switches and by
 * which width, what each arrangement draws, and how each draws a closed or a maximised panel.
 *
 * AND WHAT A SWITCH KEEPS (§6.5 to §6.8): a maximise, the focus on a control that moves, a gesture until it ends, the
 * stored shares and the call stack's split, a closed heap, and the focus of a boundary it takes away.
 */

loadViews()

hearLoops(() => {
  document.body.innerHTML = ''
})

const PROTO = Element.prototype as unknown as Record<string, unknown>

/**
 * Run `body` to its end with `stand` as every element's `moveBefore`, or with none where `stand` is null, and put the
 * browser's own back whatever `body` did, so a case that fails leaves the next one the browser it began with.
 */
async function standingIn(stand: (() => void) | null, body: () => void | Promise<void>): Promise<void> {
  const kept = Object.getOwnPropertyDescriptor(PROTO, 'moveBefore')
  Reflect.deleteProperty(PROTO, 'moveBefore')
  if (stand !== null) Object.defineProperty(PROTO, 'moveBefore', { value: stand, configurable: true })
  try {
    await body()
  } finally {
    Reflect.deleteProperty(PROTO, 'moveBefore')
    if (kept !== undefined) Object.defineProperty(PROTO, 'moveBefore', kept)
  }
}

/**
 * `el` in one parent on the page, a button inside it holding the focus, and `to`, a second parent that already has a
 * child, so that last in it is not first.
 */
function fixture() {
  const from = document.createElement('div')
  const to = document.createElement('div')
  const el = document.createElement('div')
  const button = document.createElement('button')
  button.textContent = 'heap'
  el.append(button)
  from.append(el)
  to.append(document.createElement('p'))
  document.body.append(from, to)
  button.focus()
  expect(document.activeElement, 'precondition: the button holds the focus').toBe(button)
  return { to, el, button }
}

describe('moveInto', () => {
  it('keeps the focus on a button inside what it moves, with moveBefore', () => {
    expect(typeof PROTO.moveBefore, 'precondition: this browser has moveBefore').toBe('function')
    const { to, el, button } = fixture()
    moveInto(to, el)
    expect(to.lastElementChild, 'last in its new parent').toBe(el)
    expect(document.activeElement).toBe(button)
  })

  it('keeps the focus on a button inside what it moves, in a browser with no moveBefore', async () => {
    const { to, el, button } = fixture()
    await standingIn(null, () => {
      expect('moveBefore' in to, 'precondition: no element has a moveBefore').toBe(false)
      moveInto(to, el)
    })
    expect(to.lastElementChild, 'last in its new parent').toBe(el)
    expect(document.activeElement).toBe(button)
  })

  it('keeps the focus on a button inside what it moves, with a moveBefore that throws', async () => {
    const { to, el, button } = fixture()
    const refuse = vi.fn(() => {
      throw new DOMException('refused', 'HierarchyRequestError')
    })
    await standingIn(refuse, () => moveInto(to, el))
    expect(to.lastElementChild, 'last in its new parent').toBe(el)
    expect(document.activeElement).toBe(button)
    expect(refuse, 'the move was asked of moveBefore first').toHaveBeenCalledOnce()
  })

  it('appends where the parent is off the page, without throwing', () => {
    expect(typeof PROTO.moveBefore, 'precondition: this browser has moveBefore').toBe('function')
    const { el } = fixture()
    const off = document.createElement('div')
    off.append(document.createElement('p'))
    expect(off.isConnected, 'precondition: the parent is off the page').toBe(false)
    expect(() => moveInto(off, el)).not.toThrow()
    expect(off.lastElementChild, 'last in its new parent').toBe(el)
  })
})

/**
 * Each view's wide threshold under a 20 px root, in px: its three least widths and two gaps, in rem, by 20, up to the
 * next whole pixel.
 */
const WIDE_AT_20 = { rxm: 1100, clif: 758 } as const

describe.each(VIEWS)('the $kind view', (view) => {
  const widths = { narrow: view.medium - 40, medium: Math.round((view.medium + view.wide) / 2), wide: view.wide + 40 }
  const names = [view.values, 'stack', 'heap']
  /** The panels whose headers are handles for the boundary above them now. */
  const handles = (host: HTMLElement) => names.filter((n) => header(host, n).dataset.resizes === 'true')

  it('switches at each threshold one pixel either side, both ways, and draws what it chose', async () => {
    const { host } = mount(view, widths.medium)
    for (const [at, below, above] of [
      [view.medium, 'narrow', 'medium'],
      [view.wide, 'medium', 'wide'],
    ] as const) {
      for (const [w, want] of [
        [at - 1, below],
        [at, above],
        [at - 1, below],
      ] as const) {
        await resize(host, w)
        expect(arrangement(host), `at ${w} px`).toBe(want)
        expect(drawnAs(host, view.values), `drawn at ${w} px`).toBe(want)
      }
    }
  })

  it('draws the regions and boundaries of each arrangement', async () => {
    // TALL ENOUGH THAT EVERY REGION IS OVER ITS FLOOR IN EACH ARRANGEMENT, so each is drawn at its share: in narrow the
    // values' and the call stack's regions divide the row's.
    const { host } = mount(view, widths.wide, { height: 1600 })
    const height = (name: string) => region(host, name).getBoundingClientRect().height
    const [stack, heap] = [region(host, 'stack'), region(host, 'heap')]
    const hidden = () => [stack.hidden, heap.hidden]
    expect(arrangement(host), 'precondition: built wide').toBe('wide')
    expect(boundaryKeys(host)).toEqual(['listing|machine'])
    expect(hidden(), "the call stack's and the heap's regions").toEqual([true, true])
    expect(handles(host), 'wide').toEqual(names)
    // BACK TO EACH ARRANGEMENT FROM BOTH SIDES: a header's handle is read again at each switch.
    for (const want of ['medium', 'narrow', 'medium', 'wide'] as const) {
      await resize(host, widths[want])
      expect(arrangement(host), `precondition: ${want}`).toBe(want)
      expect(handles(host), want).toEqual(names)
      if (want === 'wide') {
        expect(boundaryKeys(host)).toEqual(['listing|machine'])
        expect(hidden(), "the call stack's and the heap's regions").toEqual([true, true])
        continue
      }
      if (want === 'medium') {
        expect(boundaryKeys(host)).toEqual(['listing|machine', 'machine|heap'])
        expect(hidden(), "the call stack's and the heap's regions").toEqual([true, false])
        expect(height('machine') / height('listing'), 'precondition: in medium the row is its share').toBeCloseTo(
          0.5,
          2,
        )
        continue
      }
      expect(boundaryKeys(host)).toEqual(['listing|machine', 'machine|stack', 'stack|heap'])
      expect(hidden(), "the call stack's and the heap's regions").toEqual([false, false])
      expect(
        (height('machine') + height('stack')) / height('listing'),
        "precondition: in narrow the values' and the call stack's regions are the row's share",
      ).toBeCloseTo(0.5, 2)
    }
    // WHAT IS HIDDEN STAYS HIDDEN (§6.9), asked of each region while it holds its open panel, where a `display` rule
    // matches it.
    await resize(host, widths.narrow)
    for (const [name, r] of [
      ['stack', stack],
      ['heap', heap],
    ] as const) {
      expect(r.contains(header(host, name)), `precondition: the region holds the ${name}`).toBe(true)
      expect(getComputedStyle(r).display, `precondition: the ${name}'s region is drawn`).not.toBe('none')
      r.hidden = true
      expect(getComputedStyle(r).display, `the ${name}'s region hidden by hand`).toBe('none')
      r.hidden = false
    }
    await frames()
  })

  it('names each boundary for the regions either side of it', async () => {
    const { host } = mount(view, widths.wide)
    const label = (a: string, b: string) => boundary(host, a, b)?.getAttribute('aria-label')
    expect(label('listing', 'machine')).toBe(`resize listing and ${view.values}, call stack and heap`)
    await resize(host, widths.medium)
    expect(label('listing', 'machine')).toBe(`resize listing and ${view.values} and call stack`)
    expect(label('machine', 'heap')).toBe(`resize ${view.values} and call stack and heap`)
    await resize(host, widths.narrow)
    expect(label('listing', 'machine')).toBe(`resize listing and ${view.values}`)
    expect(label('machine', 'stack')).toBe(`resize ${view.values} and call stack`)
    expect(label('stack', 'heap')).toBe('resize call stack and heap')
    await resize(host, widths.wide)
    expect(label('listing', 'machine')).toBe(`resize listing and ${view.values}, call stack and heap`)
  })

  it('is drawn in its arrangement from the first frame, built on the page, added to it, or shown', async () => {
    /** What `host` says and draws in the first frame it has a width, read after the view's own observer. */
    const first = (host: HTMLElement) =>
      new Promise<string>((resolve) => {
        // AN OBSERVER MADE AFTER THE VIEW'S IS CALLED AFTER IT, in the frame the view first has its width and before
        // that frame is painted.
        const watch = new ResizeObserver(() => {
          watch.disconnect()
          const seen = `${arrangement(host)} drawn ${drawnAs(host, view.values)}`
          // THE CASE GOES ON IN A TASK OF ITS OWN: views built inside this frame's observers would be observed late,
          // and the page would report a loop that is the case's.
          setTimeout(() => resolve(seen))
        })
        watch.observe(host)
      })
    for (const want of ['wide', 'medium', 'narrow'] as const) {
      // BUILT ON THE PAGE: chosen before anything reads the layout.
      const built = mount(view, widths[want])
      expect(arrangement(built.host), `built on the page ${want}`).toBe(want)
      expect(drawnAs(built.host, view.values)).toBe(want)
      // BUILT IN A PARKED PARENT AND SHOWN, AND BUILT OFF THE PAGE AND ADDED.
      const parked = document.createElement('div')
      parked.hidden = true
      document.body.append(parked)
      const later = mount(view, widths[want], { parent: parked })
      const added = mount(view, widths[want], { parent: null })
      const shown = first(later.host)
      parked.hidden = false
      const appended = first(added.host)
      document.body.append(added.host)
      expect(await shown, `shown ${want}`).toBe(`${want} drawn ${want}`)
      expect(await appended, `added ${want}`).toBe(`${want} drawn ${want}`)
      document.body.innerHTML = ''
    }
    // PARKED WHILE WIDE AND SHOWN NARROW: it keeps its arrangement while it has no width, and has the new one in the
    // first frame it has a width again.
    const parked = document.createElement('div')
    document.body.append(parked)
    const { host } = mount(view, widths.wide, { parent: parked })
    expect(arrangement(host), 'precondition: wide before it is parked').toBe('wide')
    parked.hidden = true
    await resize(host, widths.narrow)
    expect(arrangement(host), 'kept while parked').toBe('wide')
    const shown = first(host)
    parked.hidden = false
    expect(await shown, 'parked wide, shown narrow').toBe('narrow drawn narrow')
  })

  it('reports no ResizeObserver loop over a resize sweep, in a view short enough to scroll', async () => {
    const { host } = mount(view, 200, { height: 420 })
    expect(arrangement(host), 'precondition: it begins narrow').toBe('narrow')
    for (let w = 200; w <= view.wide + 60; w += 4) {
      host.style.width = `${w}px`
      await frame()
    }
    await frames()
    expect(arrangement(host), 'the sweep crossed both thresholds').toBe('wide')
  })

  it('keeps a closed panel at its column in every arrangement, with no gap under it in narrow', async () => {
    const { host } = mount(view, widths.wide)
    const bar = () => header(host, view.values).getBoundingClientRect().height
    await userEvent.click(panelToggle(host, view.values))
    await frame()
    const columns = columnsOf(host, view.parts)
    expect(box(host, view.values).width, 'wide').toBeCloseTo(columns[0] ?? 0, 0)
    expect(box(host, view.values).height, 'wide: its header and no more').toBeCloseTo(bar(), 1)
    await resize(host, widths.medium)
    expect(box(host, view.values).width, 'medium').toBeCloseTo(columnsOf(host, view.parts.slice(0, 2))[0] ?? 0, 0)
    expect(box(host, view.values).height, 'medium: its header and no more').toBeCloseTo(bar(), 1)
    await resize(host, widths.narrow)
    expect(boundaryKeys(host), 'narrow').toEqual(['listing|stack', 'stack|heap'])
    expect(box(host, view.values).width, 'narrow').toBeCloseTo(row(host).getBoundingClientRect().width, 0)
    expect(box(host, view.values).height, 'narrow: its header and no more').toBeCloseTo(bar(), 1)
    const margin = Number.parseFloat(getComputedStyle(region(host, 'stack')).marginBlockStart)
    expect(margin, "precondition: the call stack's region keeps the panels' spacing above itself").toBe(8)
    expect(box(host, 'stack').top - box(host, view.values).bottom, 'the call stack under a closed panel').toBeCloseTo(
      margin,
      1,
    )
    // AND ALL THREE CLOSED IN WIDE ARE THREE BARS, each its column.
    await resize(host, widths.wide)
    await userEvent.click(panelToggle(host, 'stack'))
    await userEvent.click(panelToggle(host, 'heap'))
    await frame()
    for (const [i, n] of names.entries()) {
      expect(box(host, n).width, `${n}, all closed`).toBeCloseTo(columns[i] ?? 0, 0)
      expect(box(host, n).height, `${n}, all closed`).toBeCloseTo(bar(), 1)
    }
  })

  it('draws its columns in their parts of the row at each threshold and wider, values the narrowest', async () => {
    const { host } = mount(view, view.wide)
    for (const [w, held] of [
      [view.wide, names],
      [view.wide + 300, names],
      [view.medium, names.slice(0, 2)],
      [view.wide - 1, names.slice(0, 2)],
    ] as const) {
      await resize(host, w)
      const want = columnsOf(host, view.parts.slice(0, held.length))
      for (const [i, n] of held.entries()) expect(box(host, n).width, `${n} at ${w} px`).toBeCloseTo(want[i] ?? 0, 0)
      for (const n of held) {
        expect(box(host, n).width, `${n} at ${w} px is no narrower than the first panel`).toBeGreaterThanOrEqual(
          box(host, view.values).width - 0.5,
        )
      }
    }
  })

  it('gives a maximised panel in narrow all the spare height, its closed neighbour its header', async () => {
    const { host } = mount(view, widths.narrow)
    expect(arrangement(host), 'precondition: narrow').toBe('narrow')
    expect(panelOf(host, 'stack').parentElement, 'precondition: the call stack is in its region').toBe(
      region(host, 'stack'),
    )
    await userEvent.click(maximise(host, 'stack'))
    await frame()
    for (const n of [view.values, 'listing', 'heap']) {
      expect(box(host, n).height, `${n}, drawn closed: its header and no more`).toBeCloseTo(
        header(host, n).getBoundingClientRect().height,
        1,
      )
    }
    const body = host.querySelector(`.${view.kind}-pane`) as HTMLElement
    expect(
      Math.abs(box(host, 'heap').bottom - body.getBoundingClientRect().bottom),
      "the heap's box ends at the view's bottom",
    ).toBeLessThanOrEqual(1)
  })

  it("reads its host's width less its padding and border", async () => {
    const { host } = mount(view, widths.medium)
    host.style.boxSizing = 'border-box'
    host.style.padding = '0 10px'
    host.style.border = '1px solid'
    for (const [w, want] of [
      [view.wide + 21, 'medium'],
      [view.wide + 22, 'wide'],
      [view.wide + 21, 'medium'],
    ] as const) {
      await resize(host, w)
      expect(host.getBoundingClientRect().width, 'precondition: the width set is the border box').toBe(w)
      expect(arrangement(host), `at ${w} px`).toBe(want)
      expect(drawnAs(host, view.values), `drawn at ${w} px`).toBe(want)
    }
  })

  it("takes its thresholds from the root's font size", async () => {
    const wide = WIDE_AT_20[view.kind]
    const { host } = mount(view, widths.medium)
    try {
      document.documentElement.style.fontSize = '20px'
      for (const [w, want] of [
        [wide - 1, 'medium'],
        [wide, 'wide'],
        [wide - 1, 'medium'],
      ] as const) {
        await resize(host, w)
        expect(arrangement(host), `at ${w} px`).toBe(want)
        expect(drawnAs(host, view.values), `drawn at ${w} px`).toBe(want)
      }
    } finally {
      document.documentElement.style.removeProperty('font-size')
    }
  })
  it('keeps a maximise across a switch, the region its panel is in now taking the spare height', async () => {
    // A ROW SHARE UNDER 1: the region that holds the maximised panel is written a whole factor, where its own share
    // would take that part of the spare height and no more.
    const { host } = mount(view, widths.medium, { sizes: { machine: 0.4 } })
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    const spare = region(host, 'heap').getBoundingClientRect()
    const top = row(host).getBoundingClientRect().top
    expect(spare.height, 'precondition: the maximised heap has most of the view').toBeGreaterThan(host.clientHeight / 2)
    await resize(host, widths.wide)
    expect(arrangement(host), 'precondition: wide').toBe('wide')
    expect(maximise(host, 'heap').getAttribute('aria-pressed')).toBe('true')
    expect(panelOf(host, 'stack').dataset.open, 'its neighbour in the row is drawn closed').toBe('false')
    // THE ROW HOLDS THE HEAP NOW, and reaches from where it began to where the heap's region ended.
    expect(row(host).getBoundingClientRect().top, 'the row begins where it did').toBeCloseTo(top, 1)
    expect(row(host).getBoundingClientRect().bottom, 'the row takes the spare height').toBeCloseTo(spare.bottom, 1)
    expect(box(host, 'heap').height, 'and the heap all of the row').toBeCloseTo(
      row(host).getBoundingClientRect().height,
      1,
    )
    await resize(host, widths.medium)
    expect(maximise(host, 'heap').getAttribute('aria-pressed')).toBe('true')
    expect(region(host, 'heap').getBoundingClientRect().height, "the heap's region again").toBeCloseTo(spare.height, 1)
  })

  // EACH PANEL THAT MOVES, ACROSS THE SWITCH THAT MOVES IT: the heap between medium and wide, the call stack between
  // narrow and medium.
  for (const [panel, called, out, inRow] of [
    ['heap', 'heap', 'medium', 'wide'],
    ['stack', 'call stack', 'narrow', 'medium'],
  ] as const) {
    for (const [what, control] of [
      ['toggle', panelToggle],
      ['maximise button', maximise],
    ] as const) {
      it.each([
        ['moveBefore', false],
        ['the fallback', true],
      ] as const)(`keeps the focus on the ${called}'s ${what} across a move, with %s`, async (_, without) => {
        if (!without) expect(typeof PROTO.moveBefore, 'precondition: this browser has moveBefore').toBe('function')
        const { host } = mount(view, widths[out])
        const held = control(host, panel)
        held.focus()
        expect(document.activeElement, 'precondition: it holds the focus').toBe(held)
        const across = async () => {
          if (without) expect('moveBefore' in host, 'precondition: no element has a moveBefore').toBe(false)
          await resize(host, widths[inRow])
          expect(panelOf(host, panel).parentElement, `precondition: the ${called} is in the row`).toBe(row(host))
          expect(document.activeElement, 'into the row').toBe(held)
          await resize(host, widths[out])
          expect(panelOf(host, panel).parentElement, `precondition: the ${called} is in its region`).toBe(
            region(host, panel),
          )
          expect(document.activeElement, 'out of it').toBe(held)
        }
        if (without) await standingIn(null, across)
        else await across()
      })
    }
  }

  it("hands a focused boundary the switch takes away to the heap's toggle", async () => {
    const { host } = mount(view, widths.medium)
    const taken = boundary(host, 'machine', 'heap')
    taken.focus()
    expect(document.activeElement, 'precondition: the boundary holds the focus').toBe(taken)
    await resize(host, widths.wide)
    expect(taken.isConnected, 'precondition: the switch took the boundary away').toBe(false)
    expect(document.activeElement).toBe(panelToggle(host, 'heap'))
    // AND A BOUNDARY THE SWITCH LEAVES KEEPS THE FOCUS IT HAS.
    const left = boundary(host, 'listing', 'machine')
    left.focus()
    await resize(host, widths.medium)
    expect(arrangement(host), 'precondition: medium again').toBe('medium')
    expect(document.activeElement, 'a boundary the switch leaves').toBe(left)
  })

  it('makes no switch while a gesture is held, and makes it when the gesture ends', async () => {
    const { host, sizes } = mount(view, widths.medium)
    boundary(host, 'listing', 'machine').focus()
    await userEvent.keyboard('{ArrowDown>}')
    await resize(host, widths.wide)
    expect(arrangement(host), 'under the held key').toBe('medium')
    expect(drawnAs(host, view.values), 'drawn under the held key').toBe('medium')
    await userEvent.keyboard('{/ArrowDown}')
    await frames()
    expect(sizes, 'the gesture was one').toHaveBeenCalledTimes(1)
    expect(arrangement(host), 'after its release').toBe('wide')
    expect(drawnAs(host, view.values), 'drawn after its release').toBe('wide')
    // THE WIDTH AT THE GESTURE'S END DECIDES, not the one that asked: a view narrowed and widened again under the key
    // makes no switch, and has asked the stack once, however often its width changed.
    const asked = vi.spyOn(PanelStack.prototype, 'whenFree')
    try {
      await userEvent.keyboard('{ArrowUp>}')
      await resize(host, widths.medium)
      await resize(host, widths.wide)
      expect(arrangement(host), 'under the second held key').toBe('wide')
      await resize(host, widths.narrow)
      await resize(host, widths.wide)
      expect(asked, 'one wait for the stack at a time').toHaveBeenCalledTimes(1)
      await userEvent.keyboard('{/ArrowUp}')
      await frames()
      expect(arrangement(host), 'after a release at the width it began with').toBe('wide')
      expect(drawnAs(host, view.values)).toBe('wide')
    } finally {
      asked.mockRestore()
    }
  })

  it('makes a switch that waited once its gesture is over, though nothing ended it', async () => {
    const { host, sizes } = mount(view, widths.medium)
    const held = boundary(host, 'listing', 'machine')
    held.focus()
    await userEvent.keyboard('{ArrowDown>}')
    await resize(host, widths.wide)
    expect(arrangement(host), 'precondition: the switch waits').toBe('medium')
    // THE GESTURE'S HANDLE GOES WITH NO COMMIT, as in a browser that sends a removed element no `blur`. Chromium sends
    // one first, `separator.ts` commits at it, and the stack would hold no gesture by the time the row asked.
    host.addEventListener('blur', (e) => e.stopPropagation(), true)
    held.remove()
    await userEvent.keyboard('{/ArrowDown}')
    await frames()
    expect(sizes, 'precondition: nothing committed the gesture').not.toHaveBeenCalled()
    expect(arrangement(host), 'precondition: and the switch still waits').toBe('medium')
    await resize(host, widths.wide + 20)
    expect(arrangement(host), 'at the next change of width').toBe('wide')
    expect(drawnAs(host, view.values), 'drawn at the next change of width').toBe('wide')
    expect(sizes, 'the gesture is kept as one that ended').toHaveBeenCalledTimes(1)
  })

  it('makes a switch that waited when its view left the page under the gesture and came back', async () => {
    const { host } = mount(view, widths.medium)
    boundary(host, 'listing', 'machine').focus()
    await userEvent.keyboard('{ArrowDown>}')
    await resize(host, widths.wide)
    expect(arrangement(host), 'precondition: the switch waits').toBe('medium')
    host.remove()
    await frames()
    await userEvent.keyboard('{/ArrowDown}')
    await frames()
    document.body.append(host)
    await frames()
    expect(arrangement(host), 'back on the page').toBe('wide')
    expect(drawnAs(host, view.values), 'drawn back on the page').toBe('wide')
    await resize(host, widths.narrow)
    expect(arrangement(host), 'and it goes on following its width').toBe('narrow')
  })

  it("keeps the heap's stored share in wide, and the dragged ratio of listing and row in medium", async () => {
    const { host, sizes } = mount(view, widths.wide, { sizes: { heap: 0.8 } })
    boundary(host, 'listing', 'machine').focus()
    await userEvent.keyboard('{ArrowDown}')
    await frame()
    const stored = sizes.mock.calls.at(-1)?.[0] as Shares
    expect(stored.heap, 'kept while the heap is in the row').toBe(0.8)
    expect(Object.keys(stored).sort()).toEqual(['heap', 'listing', 'machine'])
    ;(document.activeElement as HTMLElement | null)?.blur()
    await resize(host, widths.medium)
    const h = (n: string) => region(host, n).getBoundingClientRect().height
    expect(h('listing') / h('machine'), 'the dragged ratio').toBeCloseTo(
      (stored.listing ?? 0) / (stored.machine ?? 1),
      1,
    )
    expect(h('heap') / h('machine'), "the heap's stored share").toBeCloseTo(0.8 / (stored.machine ?? 1), 1)
    await resize(host, widths.wide)
    expect(sizes, 'a switch stores nothing').toHaveBeenCalledTimes(1)
  })

  it('keeps a closed heap closed across both switches', async () => {
    const { host } = mount(view, widths.wide, { panels: { heap: false } })
    const bar = () => header(host, 'heap').getBoundingClientRect().height
    const inWide = (when: string) => {
      expect(arrangement(host), `precondition: wide, ${when}`).toBe('wide')
      expect(box(host, 'heap').width, `wide, ${when}: its column`).toBeCloseTo(columnsOf(host, view.parts)[2] ?? 0, 0)
      expect(box(host, 'heap').height, `wide, ${when}: its header and no more`).toBeCloseTo(bar(), 1)
      expect(boundaryKeys(host)).toEqual(['listing|machine'])
    }
    inWide('as built')
    await resize(host, widths.medium)
    expect(arrangement(host), 'precondition: medium').toBe('medium')
    const under = row(host).getBoundingClientRect()
    expect(box(host, 'heap').top, 'medium: under the row').toBeGreaterThanOrEqual(under.bottom)
    expect(box(host, 'heap').left, 'medium: from the row’s left edge').toBeCloseTo(under.left, 1)
    expect(box(host, 'heap').width, 'medium: the row’s full width').toBeCloseTo(under.width, 1)
    expect(box(host, 'heap').height, 'medium: its header and no more').toBeCloseTo(bar(), 1)
    expect(boundaryKeys(host), 'no boundary above a closed heap').toEqual(['listing|machine'])
    await resize(host, widths.wide)
    inWide('again')
    await userEvent.click(panelToggle(host, 'heap'))
    await frame()
    expect(panelOf(host, 'heap').parentElement, 'opened in the row').toBe(row(host))
    expect(box(host, 'heap').top, 'opened along the row’s top edge').toBeCloseTo(box(host, 'stack').top, 1)
    expect(box(host, 'heap').height, 'opened, as tall as the row').toBeCloseTo(
      row(host).getBoundingClientRect().height,
      1,
    )
    expect(box(host, 'heap').height, 'precondition: and the row is taller than a header').toBeGreaterThan(4 * bar())
  })

  /** The height of the region named `name` in `host`. */
  const heightIn = (host: HTMLElement) => (name: string) => region(host, name).getBoundingClientRect().height

  /** The body of the panel named `name`, the element its toggle controls. */
  const bodyOf = (host: HTMLElement, name: string) =>
    document.getElementById(panelToggle(host, name).getAttribute('aria-controls') ?? '') as HTMLElement

  /** How far the body of the panel named `name` is over its floor, its `min-height`. */
  const overFloor = (host: HTMLElement, name: string) => {
    const body = bodyOf(host, name)
    return body.getBoundingClientRect().height - Number.parseFloat(getComputedStyle(body).minHeight)
  }

  it('begins each region right under the boundary above it, in each arrangement', async () => {
    const { host } = mount(view, widths.wide, { height: 1600 })
    for (const want of ['wide', 'medium', 'narrow'] as const) {
      await resize(host, widths[want])
      expect(arrangement(host), `precondition: ${want}`).toBe(want)
      expect(underBoundaries(host), want).toEqual(boundaryKeys(host).map((k) => `${k} 0`))
    }
  })

  // NOTHING MOVES ON A STEP (the after-the-try design's anti-goals): a step that grows or empties the call stack or
  // the first panel scrolls its body and leaves every region the height it had.
  it('moves no region on a step that draws many call stack or first panel rows, or none', async () => {
    const { host, draw } = mount(view, widths.narrow, { height: 1600 })
    expect(arrangement(host), 'precondition: narrow').toBe('narrow')
    const regions = ['listing', 'machine', 'stack', 'heap']
    const heights = () => regions.map(heightIn(host))
    const before = heights()
    for (const [step, rows] of [
      ['many call stack rows', { stack: 40, values: 0 }],
      ['none', { stack: 0, values: 0 }],
      [`many ${view.values} rows`, { stack: 0, values: 64 }],
      ['none again', { stack: 0, values: 0 }],
    ] as const) {
      draw({ depth: rows.stack, cells: 1, boxes: 0, rows })
      await frames()
      for (const [name, at, n] of [
        ['stack', 'stack', rows.stack],
        [view.values, 'machine', rows.values],
      ] as const) {
        // MANY ROWS ARE TALLER THAN THEIR WHOLE REGION WAS, so a region sized to its rows would have grown.
        const { scrollHeight, clientHeight } = bodyOf(host, name)
        if (n > 0)
          expect(scrollHeight, `precondition: ${step}, ${name}'s rows`).toBeGreaterThan(
            before[regions.indexOf(at)] ?? 0,
          )
        else
          expect(scrollHeight, `precondition: ${step}, ${name}'s rows inside its body`).toBeLessThanOrEqual(
            clientHeight,
          )
      }
      for (const [i, h] of heights().entries())
        expect(Math.abs(h - (before[i] ?? 0)), `${step}: the ${regions[i]}`).toBeLessThanOrEqual(0.5)
    }
  })

  it('splits the values and the call stack evenly with nothing stored, and gives the row in medium and wide the height the two had', async () => {
    const { host } = mount(view, widths.narrow, { height: 1600 })
    const h = heightIn(host)
    expect(arrangement(host), 'precondition: narrow').toBe('narrow')
    expect(Math.abs(h('machine') - h('stack')), 'narrow: the two the same height').toBeLessThanOrEqual(0.5)
    const pair = (h('machine') + h('stack')) / h('listing')
    const room = () => (host.querySelector(`.${view.kind}-pane`) as HTMLElement).getBoundingClientRect().height
    const narrow = { listing: h('listing'), heap: h('heap'), room: room() }
    for (const want of ['medium', 'wide'] as const) {
      await resize(host, widths[want])
      expect(arrangement(host), `precondition: ${want}`).toBe(want)
      expect(h('machine') / h('listing'), `${want}: the row the two's height`).toBeCloseTo(pair, 2)
      // IN MEDIUM THE LISTING AND THE HEAP KEEP THEIR HEIGHTS, but for their parts of the boundary narrow has and
      // medium has not. In wide the heap's region is hidden, and the listing takes its share too.
      if (want === 'wide') continue
      // GIVEN THE ROOM THEY HAD: a view's header can wrap onto more lines in narrow, and leave its regions less.
      host.style.height = `${host.getBoundingClientRect().height - (room() - narrow.room)}px`
      await frames()
      expect(room(), 'precondition: the regions have the room they had in narrow').toBeCloseTo(narrow.room, 1)
      const bar = boundary(host, 'listing', 'machine').getBoundingClientRect().height
      expect(bar, "precondition: a boundary's height").toBe(8)
      expect(Math.abs(h('listing') - narrow.listing), 'medium: the listing').toBeLessThanOrEqual(bar)
      expect(Math.abs(h('heap') - narrow.heap), 'medium: the heap').toBeLessThanOrEqual(bar)
    }
  })

  it('shows a workspace stored before the call stack had a region as it did', async () => {
    const { host } = mount(view, widths.narrow, { height: 1600, sizes: { listing: 2.5, machine: 1.1, heap: 1.3 } })
    const h = heightIn(host)
    expect(arrangement(host), 'precondition: narrow').toBe('narrow')
    for (const n of [view.values, 'stack']) {
      expect(overFloor(host, n), `precondition: the ${n}'s body is over its floor`).toBeGreaterThan(0)
    }
    expect(Math.abs(h('machine') - h('stack')), 'narrow: the two the same height').toBeLessThanOrEqual(0.5)
    expect((h('machine') + h('stack')) / h('listing'), 'narrow: the two the row').toBeCloseTo(1.1 / 2.5, 2)
    await resize(host, widths.medium)
    expect(arrangement(host), 'precondition: medium').toBe('medium')
    expect(h('machine') / h('listing'), 'medium: the row').toBeCloseTo(1.1 / 2.5, 2)
    expect(h('heap') / h('listing'), 'medium: the heap').toBeCloseTo(1.3 / 2.5, 2)
    await resize(host, widths.wide)
    expect(arrangement(host), 'precondition: wide').toBe('wide')
    expect(h('machine') / h('listing'), 'wide: the row').toBeCloseTo(1.1 / 2.5, 2)
  })

  it('stores the split a key on the boundary between the values and the call stack sets, and draws it again after medium and wide', async () => {
    const { host, sizes } = mount(view, widths.narrow, { height: 1600 })
    const h = heightIn(host)
    const split = () => h('stack') / (h('machine') + h('stack'))
    expect(arrangement(host), 'precondition: narrow').toBe('narrow')
    boundary(host, 'machine', 'stack').focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await frame()
    const stored = sizes.mock.calls.at(-1)?.[0] as Shares
    expect(Object.keys(stored).sort()).toEqual(['machine', 'stack'])
    expect(stored.machine, 'the row keeps its share').toBeCloseTo(1, 2)
    expect(stored.stack, "the call stack's part").toBeGreaterThan(0)
    expect(stored.stack, "the call stack's part").toBeLessThan(0.5)
    expect(stored.stack, 'the part drawn').toBeCloseTo(split(), 2)
    const calls = sizes.mock.calls.length
    ;(document.activeElement as HTMLElement | null)?.blur()
    for (const want of ['medium', 'wide', 'narrow'] as const) {
      await resize(host, widths[want])
      expect(arrangement(host), `precondition: ${want}`).toBe(want)
    }
    expect(split(), 'narrow again: the split').toBeCloseTo(stored.stack ?? 0, 2)
    expect(sizes, 'a switch stores nothing').toHaveBeenCalledTimes(calls)
  })

  // A SHORT VIEW (the after-the-try design's G1): at 900px tall a floor of five rows would hold the values and the call
  // stack both on it, and the boundary between them still. In narrow each keeps two.
  it('moves the boundary between the values and the call stack both ways in a short view, down to two rows of either', async () => {
    const { host, draw } = mount(view, widths.narrow, { height: 900 })
    expect(arrangement(host), 'precondition: narrow').toBe('narrow')
    draw({ depth: 12, cells: 1, boxes: 0, rows: { stack: 12, values: 64 } })
    await frames()
    const h = heightIn(host)
    boundary(host, 'machine', 'stack').focus()
    for (const [key, floor, grows] of [
      ['ArrowDown', 'stack', 'machine'],
      ['ArrowUp', 'machine', 'stack'],
    ] as const) {
      const shrinks = floor === 'stack' ? 'stack' : view.values
      const before = { listing: h('listing'), heap: h('heap'), grows: h(grows) }
      await userEvent.keyboard(`{${key}}`)
      await frame()
      expect(h(grows), `${key}: the boundary did not move`).toBeGreaterThan(before.grows + 1)
      await userEvent.keyboard(`{${key}}`.repeat(12))
      await frame()
      expectRows(host, shrinks, 2, `${key} to the floor`)
      expect(h('listing'), `${key}: the listing`).toBeCloseTo(before.listing, 0)
      expect(h('heap'), `${key}: the heap`).toBeCloseTo(before.heap, 0)
    }
  })

  // MEDIUM KEEPS FIVE ROWS (the after-the-try design's non-goals): there the call stack stands beside the first panel.
  it('keeps the values and the call stack five rows tall at the row’s floor in medium', async () => {
    const { host, draw } = mount(view, widths.medium, { height: 900 })
    expect(arrangement(host), 'precondition: medium').toBe('medium')
    draw({ depth: 12, cells: 1, boxes: 0, rows: { stack: 12, values: 64 } })
    await frames()
    const h = heightIn(host)
    const before = h('machine')
    boundary(host, 'listing', 'machine').focus()
    await userEvent.keyboard('{ArrowDown}'.repeat(20))
    await frame()
    expect(h('machine'), 'precondition: the keys moved the boundary').toBeLessThan(before - 20)
    for (const n of [view.values, 'stack']) expectRows(host, n, 5, 'medium')
  })

  it('splits a row dragged in medium by the stored part when narrow again', async () => {
    const { host, sizes } = mount(view, widths.medium, { height: 1600, sizes: { stack: 0.4 } })
    const h = heightIn(host)
    expect(arrangement(host), 'precondition: medium').toBe('medium')
    boundary(host, 'listing', 'machine').focus()
    await userEvent.keyboard('{ArrowDown}')
    await frame()
    const stored = sizes.mock.calls.at(-1)?.[0] as Shares
    expect(stored.stack, 'the part, kept').toBe(0.4)
    ;(document.activeElement as HTMLElement | null)?.blur()
    await resize(host, widths.narrow)
    expect(arrangement(host), 'precondition: narrow').toBe('narrow')
    expect(overFloor(host, 'stack'), "precondition: the call stack's body is over its floor").toBeGreaterThan(0)
    expect(h('stack') / (h('machine') + h('stack')), 'the part').toBeCloseTo(0.4, 2)
    expect((h('machine') + h('stack')) / h('listing'), 'the two the row').toBeCloseTo(
      (stored.machine ?? 0) / (stored.listing ?? 1),
      2,
    )
  })

  it("gives the open one of the values and the call stack the row's whole share in narrow", async () => {
    const { host } = mount(view, widths.narrow, { height: 1600, sizes: { stack: 0.25 } })
    const h = heightIn(host)
    expect(arrangement(host), 'precondition: narrow').toBe('narrow')
    await userEvent.click(panelToggle(host, 'stack'))
    await frame()
    expect(boundaryKeys(host), 'the call stack closed').toEqual(['listing|machine', 'machine|heap'])
    expect(box(host, 'stack').height, 'the call stack closed: its header and no more').toBeCloseTo(
      header(host, 'stack').getBoundingClientRect().height,
      1,
    )
    expect(h('machine') / h('listing'), 'the values the row').toBeCloseTo(0.5, 2)
    await userEvent.click(panelToggle(host, 'stack'))
    await userEvent.click(panelToggle(host, view.values))
    await frame()
    expect(boundaryKeys(host), 'the values closed').toEqual(['listing|stack', 'stack|heap'])
    expect(h('stack') / h('listing'), 'the call stack the row').toBeCloseTo(0.5, 2)
  })

  it("hands a focused boundary above the call stack that a switch takes away to the call stack's toggle", async () => {
    const { host } = mount(view, widths.narrow, { height: 1600 })
    /** Focus the boundary between `a` and `b` in narrow, make the view `to` wide, and answer what has the focus. */
    const across = async (a: string, b: string, to: number) => {
      await resize(host, widths.narrow)
      expect(arrangement(host), 'precondition: narrow').toBe('narrow')
      const taken = boundary(host, a, b)
      taken.focus()
      expect(document.activeElement, `precondition: ${a}|${b} holds the focus`).toBe(taken)
      await resize(host, to)
      expect(taken.isConnected, `precondition: the switch took ${a}|${b} away`).toBe(false)
      return document.activeElement
    }
    expect(await across('machine', 'stack', widths.medium), 'to medium').toBe(panelToggle(host, 'stack'))
    expect(await across('machine', 'stack', widths.wide), 'to wide in one resize').toBe(panelToggle(host, 'stack'))
    expect(await across('stack', 'heap', widths.medium), 'the heap under it').toBe(panelToggle(host, 'heap'))
    await resize(host, widths.narrow)
    await userEvent.click(panelToggle(host, view.values))
    await frame()
    expect(await across('listing', 'stack', widths.medium), 'the values closed').toBe(panelToggle(host, 'stack'))
  })

  it("hands a focused boundary a switch into narrow takes away to the heap's toggle, and one out of it to the toggle under it", async () => {
    const { host } = mount(view, widths.medium, { height: 1600 })
    /** Focus the boundary between `a` and `b`, make the view `to`, and answer what has the focus. */
    const across = async (a: string, b: string, to: 'narrow' | 'medium') => {
      const taken = boundary(host, a, b)
      taken.focus()
      expect(document.activeElement, `precondition: ${a}|${b} holds the focus`).toBe(taken)
      await resize(host, widths[to])
      expect(arrangement(host), `precondition: ${to}`).toBe(to)
      expect(taken.isConnected, `precondition: the switch took ${a}|${b} away`).toBe(false)
      return document.activeElement
    }
    expect(await across('machine', 'heap', 'narrow'), 'into narrow').toBe(panelToggle(host, 'heap'))
    expect(await across('machine', 'stack', 'medium'), 'out of narrow').toBe(panelToggle(host, 'stack'))
    await userEvent.click(panelToggle(host, view.values))
    await frame()
    expect(await across('listing', 'machine', 'narrow'), 'into narrow, the values closed').toBe(
      panelToggle(host, 'heap'),
    )
    expect(await across('listing', 'stack', 'medium'), 'out of narrow, the values closed').toBe(
      panelToggle(host, 'stack'),
    )
  })

  it('makes no switch while the boundary between the values and the call stack is held, and stores the split once at its release', async () => {
    const { host, sizes } = mount(view, widths.narrow, { height: 1600 })
    expect(arrangement(host), 'precondition: narrow').toBe('narrow')
    boundary(host, 'machine', 'stack').focus()
    await userEvent.keyboard('{ArrowDown>}')
    await resize(host, widths.medium)
    expect(arrangement(host), 'under the held key').toBe('narrow')
    expect(drawnAs(host, view.values), 'drawn under the held key').toBe('narrow')
    await userEvent.keyboard('{/ArrowDown}')
    await frames()
    expect(sizes, 'the gesture was one').toHaveBeenCalledOnce()
    expect(Object.keys(sizes.mock.calls[0]?.[0] ?? {}).sort(), 'the split stored').toEqual(['machine', 'stack'])
    expect(arrangement(host), 'after its release').toBe('medium')
    expect(drawnAs(host, view.values), 'drawn after its release').toBe('medium')
  })

  it('keeps a maximised call stack across a switch out of narrow and back', async () => {
    const { host } = mount(view, widths.narrow, { height: 1600 })
    const bar = () => header(host, view.values).getBoundingClientRect().height
    const pressed = () => maximise(host, 'stack').getAttribute('aria-pressed')
    expect(arrangement(host), 'precondition: narrow').toBe('narrow')
    await userEvent.click(maximise(host, 'stack'))
    await frame()
    await resize(host, widths.medium)
    expect(arrangement(host), 'precondition: medium').toBe('medium')
    expect(pressed(), 'medium: still pressed').toBe('true')
    expect(box(host, view.values).height, "medium: the values' header and no more").toBeCloseTo(bar(), 1)
    expect(
      Math.abs(box(host, 'stack').height - row(host).getBoundingClientRect().height),
      'medium: the call stack the whole row',
    ).toBeLessThanOrEqual(1)
    await resize(host, widths.narrow)
    expect(arrangement(host), 'precondition: narrow again').toBe('narrow')
    expect(pressed(), 'narrow: still pressed').toBe('true')
    expect(box(host, view.values).height, "narrow: the values' header and no more").toBeCloseTo(bar(), 1)
  })

  /**
   * A view built in a host of its own, and its row held weakly. **A CASE THAT IS TO SEE A ROW COLLECTED HOLDS NONE OF
   * IT ITSELF**: an async function waiting at an `await` keeps its frame, temporaries and all, so the row and its view
   * are touched only in functions that have returned.
   */
  const built = (width: number) => {
    const { host } = mount(view, width)
    return { host, replaced: new WeakRef(row(host)) }
  }

  /** Wait for a collection to have found whatever was let go before it, in a task of its own. */
  const collected = async () => {
    await tick()
    await collect()
    await tick()
  }

  // A HOST OUTLIVES ITS VIEWS: `pane-host.ts` keeps each host for the session and builds every new view into it, so a
  // row that went on following its host would be kept, with its view, for as long as the host is.
  it('lets its host go to the next view built into it, and is collected', async () => {
    const { host, replaced } = built(widths.medium)
    await frames()
    view.build(host, {}, {}, () => {})
    await frames()
    await collected()
    expect(replaced.deref(), 'the replaced row').toBeUndefined()
    await resize(host, widths.wide)
    expect(arrangement(host), 'the row built next follows the host').toBe('wide')
  })

  it("lets its host go once another kind of view is built into it, at the host's next change of size", async () => {
    /** The arrangement of the row in `host` once another kind of view is built there and the host is `width` wide. */
    const replacedAt = async (host: HTMLElement, width: number) => {
      const replaced = row(host)
      // WHAT ANOTHER KIND OF VIEW DOES TO THE HOST: each view's constructor replaces the host's children with its own.
      host.replaceChildren(document.createElement('div'))
      await resize(host, width)
      return replaced.dataset.arrangement
    }
    const { host, replaced } = built(widths.medium)
    await frames()
    expect(await replacedAt(host, widths.wide), 'the replaced row follows the host no more').toBe('medium')
    await collected()
    expect(replaced.deref(), 'the replaced row').toBeUndefined()
  })
})
