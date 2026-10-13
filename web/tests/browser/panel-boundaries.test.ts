import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { AsmPanels } from '../../src/asm-pane'
import { AsmPane } from '../../src/asm-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import { BOUNDARY_KEY_STEP, type Shares } from '../../src/panel-stack'
import { FACT3, frameOf } from '../node/asm-fixtures'

/**
 * THE BOUNDARIES BETWEEN A VIEW'S REGIONS, AND THE HEADER THAT IS A HANDLE FOR ONE — the view layouts spec §11.2,
 * `panel-stack.ts`. Held on an asm view built directly, as `asm-pane.test.ts` builds one: it has three regions on a
 * view of the program, the listing, the row of registers and call stack, and the heap, so a drag has a region that
 * must NOT move. `panel-maximise.test.ts` has the maximise button and `panel-sizes-stored.test.ts` the workspace.
 *
 * **EVERY DRAG IS THE DRIVER'S OWN WHERE ONE MOVE IS ENOUGH** (`userEvent.dragAndDrop`: a press, a move, a release).
 * Three cases need more than the driver gives and make their own pointer events, and each says so: a pointer that
 * overshoots a floor and comes back, a finger, and a press that is held.
 */

const CONTROLS = {
  canRestart: true,
  canBack: true,
  canForward: true,
  canToNewest: true,
  canPlay: true,
  playing: false,
  stepText: 'step 3 of 55',
  continueLabel: null,
}

function events(over: Partial<PaneEvents> = {}): PaneEvents {
  return {
    back: vi.fn(),
    forward: vi.fn(),
    toNewest: vi.fn(),
    play: vi.fn(),
    restart: vi.fn(),
    extend: vi.fn(),
    speed: () => 8,
    setSpeed: vi.fn(),
    rebind: vi.fn(),
    ...over,
  }
}

/** A view of `FACT3` in a host `height` by `width`, on the page, with a frame drawn. */
function mount(
  o: { height?: number; width?: number; panels?: AsmPanels; sizes?: Shares; on?: Partial<PaneEvents> } = {},
) {
  const sizes = vi.fn<(s: Shares) => void>()
  const panel = vi.fn<(name: string, open: boolean) => void>()
  const host = document.createElement('section')
  host.className = 'pane'
  host.dataset.kind = 'asm'
  host.style.height = `${o.height ?? 900}px`
  host.style.width = `${o.width ?? 1000}px`
  document.body.append(host)
  const pane = new AsmPane(host, events({ panelSizes: sizes, panel, ...o.on }), o.panels ?? {}, o.sizes ?? {})
  pane.setProgram(FACT3)
  pane.render(frameOf({ pc: 3, next: 3 }), CONTROLS)
  return { host, pane, sizes, panel }
}

const region = (host: HTMLElement, name: string) => host.querySelector(`[data-region="${name}"]`) as HTMLElement
const height = (host: HTMLElement, name: string) => region(host, name).getBoundingClientRect().height
const heights = (host: HTMLElement) => ({
  listing: height(host, 'listing'),
  machine: height(host, 'machine'),
  heap: height(host, 'heap'),
})
const boundaries = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.panel-boundary')]
const boundary = (host: HTMLElement, above: string, below: string) =>
  host.querySelector(`.panel-boundary[data-above="${above}"][data-below="${below}"]`) as HTMLElement
const panelOf = (host: HTMLElement, name: string) => host.querySelector(`[data-panel="${name}"]`) as HTMLElement
const header = (host: HTMLElement, name: string) => panelOf(host, name).querySelector('.panel-header') as HTMLElement
const toggle = (host: HTMLElement, name: string) => panelOf(host, name).querySelector('.panel-toggle') as HTMLElement
const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))
/** The last shares a gesture reported. */
const last = (sizes: ReturnType<typeof vi.fn>): Shares => sizes.mock.calls.at(-1)?.[0] as Shares

/**
 * A real drag: a press at the middle of `handle`'s empty part and a release `dy` pixels down from it (up, for a
 * negative `dy`), measured against the host so the driver has one element to aim both ends at.
 */
async function drag(host: HTMLElement, handle: HTMLElement, dy: number): Promise<void> {
  const [h, area] = [handle.getBoundingClientRect(), host.getBoundingClientRect()]
  const x = h.left - area.left + h.width / 2
  const y = h.top - area.top + h.height / 2
  await userEvent.dragAndDrop(host, host, { sourcePosition: { x, y }, targetPosition: { x, y: y + dy } })
  await frame()
}

/** A pointer event of this file's own making on `el`, at `y`, for what the driver's one-move drag cannot do. */
const fire = (el: HTMLElement, type: string, y: number, pointerType = 'mouse'): void => {
  const box = el.getBoundingClientRect()
  el.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      bubbles: true,
      cancelable: true,
      clientX: box.left + box.width / 2,
      clientY: y,
      isPrimary: true,
      button: 0,
      pointerType,
    }),
  )
}
const middle = (el: HTMLElement): number => el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2

// A VIEWPORT AS WIDE AND AS TALL AS A VIEW: a real press aimed past the page's edge lands on nothing.
beforeAll(async () => {
  await page.viewport(1280, 1000)
  // THE PAGE'S FONTS FIRST, ASKED FOR BY NAME, since nothing on the page has used them yet: a line's height is the
  // font's, and a floor of five lines and a header's height settle as the fonts arrive.
  await Promise.all([document.fonts.load('12px "Hack"'), document.fonts.load('12px "Inter"')])
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the boundaries of a view', () => {
  it('are drawn under each open region that has an open region below it, and named for the two', () => {
    const { host } = mount()
    expect(boundaries(host).map((b) => b.getAttribute('aria-label'))).toEqual([
      'resize listing and registers and call stack',
      'resize registers and call stack and heap',
    ])
    for (const b of boundaries(host)) {
      expect(b.getAttribute('role')).toBe('separator')
      expect(b.getAttribute('aria-orientation')).toBe('horizontal')
      expect(b.tabIndex).toBe(0)
      expect(b.getAttribute('aria-valuemin')).toBe('0')
      expect(b.getAttribute('aria-valuemax')).toBe('100')
    }
    // DIRECTLY UNDER THE UPPER REGION, and as tall as the gap the lower one kept above itself, which it takes.
    expect(boundary(host, 'listing', 'machine').previousElementSibling).toBe(region(host, 'listing'))
    expect(boundary(host, 'machine', 'heap').previousElementSibling).toBe(region(host, 'machine'))
    expect(boundary(host, 'listing', 'machine').getBoundingClientRect().height).toBe(8)
    expect(
      region(host, 'machine').getBoundingClientRect().top - region(host, 'listing').getBoundingClientRect().bottom,
      'the boundary is the whole of what parts the two regions',
    ).toBe(8)
    // THE UPPER REGION'S PART OF THE TWO, from the shares they are built with: the listing's two of three, and an
    // even half for the row and the heap.
    expect(boundary(host, 'listing', 'machine').getAttribute('aria-valuenow')).toBe('67')
    expect(boundary(host, 'machine', 'heap').getAttribute('aria-valuenow')).toBe('50')
  })

  it('share the view as the stylesheet fixed it before one could be dragged: two, one and one', () => {
    const { host } = mount()
    const h = heights(host)
    expect(h.listing / h.machine, 'the listing is twice the row').toBeCloseTo(2, 1)
    expect(h.machine, 'the row and the heap are even').toBeCloseTo(h.heap, 0)
    expect(host.scrollHeight, 'precondition: the view does not scroll').toBe(host.clientHeight)
  })

  it('skip a closed region, and are drawn beside it again once it is open', async () => {
    const { host } = mount()
    await userEvent.click(toggle(host, 'registers'))
    expect(boundaries(host), 'one of the row’s two panels is still open').toHaveLength(2)
    await userEvent.click(toggle(host, 'stack'))
    await frame()
    expect(boundaries(host).map((b) => b.getAttribute('aria-label'))).toEqual(['resize listing and heap'])
    expect(boundary(host, 'listing', 'heap').previousElementSibling, 'under the upper of the two').toBe(
      region(host, 'listing'),
    )
    await userEvent.click(toggle(host, 'heap'))
    await frame()
    expect(boundaries(host), 'one open region has nothing to be parted from').toHaveLength(0)
    await userEvent.click(toggle(host, 'heap'))
    await userEvent.click(toggle(host, 'stack'))
    await frame()
    expect(boundaries(host)).toHaveLength(2)
  })

  it('draw nothing at rest or under the pointer, and a line for the keyboard’s focus', async () => {
    const { host } = mount()
    const b = boundary(host, 'listing', 'machine')
    expect(getComputedStyle(b, '::before').content, 'at rest').toBe('none')
    await userEvent.hover(b)
    expect(getComputedStyle(b, '::before').content, 'under the pointer').toBe('none')
    expect(getComputedStyle(b).cursor, 'the pointer is what says it can be held').toBe('grab')
    toggle(host, 'listing').focus()
    // `Tab` FROM THE LISTING'S LAST CONTROL: its maximise button, the last thing in its header.
    ;(panelOf(host, 'listing').querySelector('.panel-maximise') as HTMLElement).focus()
    await userEvent.keyboard('{Tab}')
    // THE LISTING'S GRID IS THE NEXT STOP, THEN THE BOUNDARY.
    if (document.activeElement !== b) await userEvent.keyboard('{Tab}')
    expect(document.activeElement, 'precondition: Tab reaches the boundary').toBe(b)
    expect(b.matches(':focus-visible'), 'precondition: a key’s focus').toBe(true)
    expect(getComputedStyle(b, '::before').content, 'under the keyboard’s focus').not.toBe('none')
    expect(getComputedStyle(b, '::before').height).toBe('2px')
  })
})

describe('a drag of a boundary', () => {
  it('moves the two regions it parts and no other, and the view does not grow', async () => {
    const { host, sizes } = mount()
    const before = heights(host)
    await drag(host, boundary(host, 'machine', 'heap'), -60)
    const after = heights(host)
    expect(after.machine, 'the row above gave 60 px').toBeCloseTo(before.machine - 60, 0)
    expect(after.heap, 'the heap below took them').toBeCloseTo(before.heap + 60, 0)
    expect(after.listing, 'the listing, which the boundary does not part, moved').toBeCloseTo(before.listing, 1)
    expect(host.scrollHeight, 'the view grew').toBe(host.clientHeight)
    // ONE REPORT A GESTURE, with a share for each of the two regions it parted and for no other, adding up to what
    // the two had: one and one.
    expect(sizes).toHaveBeenCalledTimes(1)
    const s = last(sizes)
    expect(Object.keys(s).sort()).toEqual(['heap', 'machine'])
    expect((s.machine as number) + (s.heap as number)).toBeCloseTo(2, 2)
    expect((s.heap as number) / (s.machine as number)).toBeCloseTo(after.heap / after.machine, 2)
  })

  it('stops where a neighbour would go under its floor of five rows', async () => {
    const { host } = mount()
    const body = panelOf(host, 'heap').querySelector('.asm-heap') as HTMLElement
    const floor = Number.parseFloat(getComputedStyle(body).minHeight)
    expect(floor, 'precondition: the heap’s body has a floor').toBeGreaterThan(50)
    expect(body.getBoundingClientRect().height, 'precondition: and is over it').toBeGreaterThan(floor + 50)
    const before = heights(host)
    await drag(host, boundary(host, 'machine', 'heap'), 600)
    expect(body.getBoundingClientRect().height, 'the heap’s body is not at its floor').toBeCloseTo(floor, 0)
    const after = heights(host)
    expect(after.machine + after.heap, 'the two regions’ heights do not add up to what they did').toBeCloseTo(
      before.machine + before.heap,
      0,
    )
    expect(after.listing, 'a drag past the floor took from a region it does not part').toBeCloseTo(before.listing, 1)
    expect(host.scrollHeight, 'the view grew').toBe(host.clientHeight)
  })

  /**
   * **A DRAG THAT COULD NOT MOVE ITS BOUNDARY WRITES NOTHING.** A gesture's first frame gives every open region its
   * measured height as its share, and in a view too short for its floors those are the floors': committed, they
   * replaced two, one and one with the floors' ratio, for the next view tall enough to show the difference.
   */
  it('writes nothing where neither neighbour has room to give, and leaves the shares as they are built', async () => {
    const { host, sizes } = mount({ height: 360 })
    const shares = () => ['listing', 'machine', 'heap'].map((n) => region(host, n).style.getPropertyValue('--share'))
    expect(host.scrollHeight, 'precondition: the view is too short for its floors, and scrolls').toBeGreaterThan(
      host.clientHeight,
    )
    expect(shares(), 'precondition: the shares the regions are built with').toEqual(['2', '1', '1'])
    const before = heights(host)
    await drag(host, boundary(host, 'listing', 'machine'), -40)
    expect(heights(host), 'a boundary between two regions on their floors moved').toEqual(before)
    expect(sizes, 'a drag that moved nothing stored shares').not.toHaveBeenCalled()
    expect(shares(), 'the regions were left the heights the gesture measured as their shares').toEqual(['2', '1', '1'])
    // AND THE SAME FOR THE KEYS: a step into a floor is no step.
    boundary(host, 'listing', 'machine').focus()
    await userEvent.keyboard('{ArrowUp}')
    await frame()
    expect(sizes, 'a key that moved nothing stored shares').not.toHaveBeenCalled()
    expect(shares()).toEqual(['2', '1', '1'])
  })

  /**
   * **A DRAG STORES THE TWO REGIONS IT PARTS, AND LEAVES EVERY OTHER REGION THE SHARE IT HAD.** In a view 500 px tall
   * the row and the heap are on their floors and the listing has room over its own. A drag between the listing and
   * the row moves those two; the heap is on its floor before it and after it, at the share it is built with. With
   * every open region given its measured height as its share, the heap's floor was stored as its share, to show as a
   * taller heap in the next view tall enough for the difference.
   */
  it('stores a share for the two regions it parts and for no other, one on its floor among them', async () => {
    const { host, sizes } = mount({ height: 500 })
    const body = panelOf(host, 'heap').querySelector('.asm-heap') as HTMLElement
    const floor = Number.parseFloat(getComputedStyle(body).minHeight)
    expect(body.getBoundingClientRect().height, 'precondition: the heap is on its floor').toBeCloseTo(floor, 0)
    expect(host.scrollHeight, 'precondition: the view does not scroll').toBe(host.clientHeight)
    const before = heights(host)
    expect(before.listing, 'precondition: the listing has 40 px to give over its floor').toBeGreaterThan(148 + 40)
    await drag(host, boundary(host, 'listing', 'machine'), -30)
    const after = heights(host)
    expect(after.listing, 'precondition: the drag moved the boundary').toBeCloseTo(before.listing - 30, 0)
    expect(after.machine).toBeCloseTo(before.machine + 30, 0)
    expect(after.heap, 'the heap moved').toBeCloseTo(before.heap, 1)
    expect(Object.keys(last(sizes)).sort(), 'a region the boundary does not part was given a share').toEqual([
      'listing',
      'machine',
    ])
    expect(
      region(host, 'heap').style.getPropertyValue('--share'),
      'the heap is not at the share it is built with',
    ).toBe('1')
    expect(host.scrollHeight, 'the view grew').toBe(host.clientHeight)
  })

  /**
   * **THE TWO SHARES A DRAG STORES ARE IN THE MEASURE OF THE REGIONS THAT WERE OVER THEIR FLOORS.** In a view 575 px
   * tall, with the row stored at half a share, the row is on its floor and the listing and the heap are over theirs,
   * sharing what the row leaves two to one. A drag between the listing and the row leaves the heap exactly where it
   * was only if the two new shares are worth what the heap's is: a pixel is worth what the listing and the heap say,
   * and not what the row's floor would add to them.
   */
  it('leaves a region over its floor exactly where it was, where one of the two it parts began on its floor', async () => {
    const { host, sizes } = mount({ height: 575, sizes: { machine: 0.5 } })
    const body = (name: string, sel: string) => panelOf(host, name).querySelector(sel) as HTMLElement
    const over = (el: HTMLElement) =>
      el.getBoundingClientRect().height - Number.parseFloat(getComputedStyle(el).minHeight)
    expect(over(body('registers', '.asm-registers')), 'precondition: the row is on its floor').toBeCloseTo(0, 0)
    expect(over(body('heap', '.asm-heap')), 'precondition: the heap is over its floor').toBeGreaterThan(5)
    expect(over(body('listing', '.asm-listing')), 'precondition: the listing has 40 px to give').toBeGreaterThan(40)
    expect(host.scrollHeight, 'precondition: the view does not scroll').toBe(host.clientHeight)
    const before = heights(host)
    await drag(host, boundary(host, 'listing', 'machine'), -30)
    await frame()
    const after = heights(host)
    expect(after.listing, 'precondition: the drag moved the boundary').toBeCloseTo(before.listing - 30, 0)
    expect(after.machine).toBeCloseTo(before.machine + 30, 0)
    expect(after.heap, 'the heap moved as the drag ended').toBeCloseTo(before.heap, 1)
    expect(Object.keys(last(sizes)).sort()).toEqual(['listing', 'machine'])
  })

  /**
   * **A STORED SHARE KEEPS ITS RATIO HOWEVER SMALL THE VIEW'S SHARES ARE, AND IS NEVER 0**, which `workspace.ts`
   * refuses, and the whole stored workspace with it. Rounded to a ten-thousandth, the heap's share here came to
   * nothing, and the three regions' to 2, 1 and 1 of a ten-thousandth: the heap left its floor as the drag ended.
   */
  it('stores a share that keeps its ratio, and is not 0, however small the shares it starts from', async () => {
    const { host, sizes } = mount({ height: 1700, sizes: { listing: 0.0001, machine: 0.0001, heap: 0.0001 } })
    const before = heights(host)
    expect(before.heap, 'precondition: three even shares draw three even regions').toBeCloseTo(before.listing, 0)
    // THIS FILE'S OWN POINTER EVENTS: in a view this tall the boundary is below the window, where the driver's
    // pointer cannot press it.
    const b = boundary(host, 'machine', 'heap')
    const y = middle(b)
    fire(b, 'pointerdown', y)
    fire(b, 'pointermove', y + 2000)
    await frame()
    fire(b, 'pointerup', y + 2000)
    await frame()
    const floor = Number.parseFloat(
      getComputedStyle(panelOf(host, 'heap').querySelector('.asm-heap') as HTMLElement).minHeight,
    )
    expect(
      (panelOf(host, 'heap').querySelector('.asm-heap') as HTMLElement).getBoundingClientRect().height,
      'the heap is not on its floor once the drag has ended',
    ).toBeCloseTo(floor, 0)
    const stored = last(sizes)
    expect(
      (stored.machine as number) / (stored.heap as number),
      'the two shares’ ratio is not the two heights’',
    ).toBeCloseTo(heights(host).machine / heights(host).heap, 1)
    for (const [name, share] of Object.entries(stored)) {
      expect(share, `${name}’s share`).toBeGreaterThan(0)
      expect(Number.isFinite(share), `${name}’s share is finite`).toBe(true)
    }
  })

  /**
   * **A GESTURE ON ANOTHER BOUNDARY ENDS THE ONE BEFORE IT.** An arrow key held on one boundary is a gesture until
   * its release, and a press on another boundary's header moves no focus, so nothing ends the first. The second was
   * then given the first's measurements: the heights of the listing and the row, written to the row and the heap.
   */
  it('ends a key’s gesture on one boundary when another boundary is dragged, and moves the right two regions', async () => {
    const { host, sizes } = mount()
    const before = heights(host)
    const shared = before.listing + before.machine + before.heap
    const step = BOUNDARY_KEY_STEP * shared
    const first = boundary(host, 'listing', 'machine')
    first.focus()
    // HELD: a `keydown` and no `keyup`.
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await frame()
    expect(heights(host).listing, 'precondition: the held key moved the first boundary a step').toBeCloseTo(
      before.listing + step,
      0,
    )
    const second = boundary(host, 'machine', 'heap')
    const y = middle(second)
    fire(second, 'pointerdown', y)
    fire(second, 'pointermove', y - 30)
    await frame()
    fire(second, 'pointerup', y - 30)
    await frame()
    const after = heights(host)
    expect(after.listing, 'the listing, which the second boundary does not part, moved').toBeCloseTo(
      before.listing + step,
      0,
    )
    expect(after.heap, 'the heap did not take 30 px').toBeCloseTo(before.heap + 30, 0)
    expect(after.machine, 'the row did not give a step to the listing and 30 px to the heap').toBeCloseTo(
      before.machine - step - 30,
      0,
    )
    expect(sizes, 'each gesture reports once').toHaveBeenCalledTimes(2)
    first.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }))
  })

  /**
   * **A GESTURE ENDS AT ITS POINTER'S RELEASE, WHEREVER THAT LANDS.** A view taken off the page under a press takes
   * the pointer's capture with it, put back or not, and the release goes to whatever is under the pointer: the
   * boundary heard none and the stack went on holding the gesture. With one held it draws no boundary and writes no
   * share, so the view kept the boundaries it had, whatever was opened or closed after. **A KEY'S GESTURE DOES NOT
   * GET THERE IN THIS BROWSER**: a focused boundary hears its `blur` while it is still on the page, and commits
   * (measured in the tests' Chromium, 2026-10-13, for a removal, a `replaceChildren` and a move to another parent).
   */
  it('does not go on holding a pointer’s gesture whose view left the page under the press', async () => {
    const { host, sizes } = mount()
    const before = heights(host)
    const b = boundary(host, 'machine', 'heap')
    const y = middle(b)
    fire(b, 'pointerdown', y)
    fire(b, 'pointermove', y - 30)
    await frame()
    expect(heights(host).heap, 'precondition: the drag is under way').toBeCloseTo(before.heap + 30, 0)
    const parent = host.parentElement as HTMLElement
    host.remove()
    await frame()
    parent.append(host)
    await frame()
    // THE RELEASE, ON THE PAGE'S BODY: the boundary no longer holds the pointer.
    document.body.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: 1, bubbles: true, isPrimary: true, button: 0, pointerType: 'mouse' }),
    )
    await frame()
    await userEvent.click(toggle(host, 'heap'))
    await frame()
    expect(
      boundaries(host).map((x) => x.getAttribute('aria-label')),
      'the boundary beside a region closed since is still drawn',
    ).toEqual(['resize listing and registers and call stack'])
    expect(b.dataset.dragging, 'the boundary is still drawn held').toBeUndefined()
    // WHAT THE DRAG HAD MOVED IS KEPT, as a drag that ends is: one report, of the two regions it parted.
    expect(sizes).toHaveBeenCalledTimes(1)
    expect(Object.keys(last(sizes)).sort()).toEqual(['heap', 'machine'])
  })

  /**
   * **A POINTER THAT OVERSHOOTS A FLOOR HAS TO COME ALL THE WAY BACK BEFORE THE BOUNDARY FOLLOWS IT.** Held with this
   * file's own pointer events, since the driver's drag is one move. With the two kept as one number, the boundary
   * left the floor the moment the pointer turned, 2,000 px away from it.
   */
  it('follows a pointer that overshot a floor only once it is back', async () => {
    const { host } = mount()
    const b = boundary(host, 'machine', 'heap')
    const before = heights(host)
    const y = middle(b)
    fire(b, 'pointerdown', y)
    fire(b, 'pointermove', y - 2000)
    await frame()
    const atFloor = heights(host)
    expect(atFloor.machine, 'precondition: the row above reached its floor').toBeLessThan(before.machine - 20)
    fire(b, 'pointermove', y - 1000)
    await frame()
    expect(heights(host).machine, 'the boundary left the floor with the pointer still past it').toBeCloseTo(
      atFloor.machine,
      1,
    )
    fire(b, 'pointermove', y - 10)
    await frame()
    expect(heights(host).machine, 'the boundary is not 10 px from where the press was').toBeCloseTo(
      before.machine - 10,
      0,
    )
    fire(b, 'pointerup', y - 10)
  })
})

describe('a panel’s header, as the handle for the boundary above it', () => {
  it('says so with the pointer where a boundary lies above it, and nowhere else', async () => {
    const { host } = mount()
    expect(header(host, 'listing').dataset.resizes, 'the first region has no boundary above').toBeUndefined()
    expect(getComputedStyle(header(host, 'listing')).cursor).not.toBe('grab')
    for (const name of ['registers', 'stack', 'heap']) {
      expect(header(host, name).dataset.resizes, name).toBe('true')
      expect(getComputedStyle(header(host, name)).cursor, name).toBe('grab')
      // EACH CONTROL ON THE BAR KEEPS ITS OWN POINTER.
      expect(getComputedStyle(toggle(host, name)).cursor, `${name}’s disclosure`).toBe('pointer')
    }
    // CLOSED, THE HEAP TAKES NO SHARE AND HAS NO BOUNDARY ABOVE IT.
    await userEvent.click(toggle(host, 'heap'))
    await frame()
    expect(header(host, 'heap').dataset.resizes, 'a closed region’s header').toBeUndefined()
  })

  it('drags that boundary by a real press on the bar’s empty part', async () => {
    const { host, sizes } = mount()
    const before = heights(host)
    await drag(host, header(host, 'heap'), -60)
    const after = heights(host)
    expect(after.heap, 'the heap did not take 60 px').toBeCloseTo(before.heap + 60, 0)
    expect(after.machine).toBeCloseTo(before.machine - 60, 0)
    expect(after.listing).toBeCloseTo(before.listing, 1)
    expect(sizes).toHaveBeenCalledTimes(1)
  })

  it('leaves a press on one of its controls to the control', async () => {
    const { host, sizes, panel } = mount()
    const before = heights(host)
    // A REAL CLICK ON THE DISCLOSURE: the panel closes, and nothing was dragged.
    await userEvent.click(toggle(host, 'heap'))
    expect(panel).toHaveBeenCalledExactlyOnceWith('heap', false)
    await userEvent.click(toggle(host, 'heap'))
    await frame()
    expect(heights(host), 'a click on the disclosure moved a boundary').toEqual(before)
    // AND A REAL DRAG THAT STARTS ON IT moves nothing: the press was the button's.
    const [t, area] = [toggle(host, 'heap').getBoundingClientRect(), host.getBoundingClientRect()]
    const at = { x: t.left - area.left + t.width / 2, y: t.top - area.top + t.height / 2 }
    await userEvent.dragAndDrop(host, host, { sourcePosition: { ...at }, targetPosition: { x: at.x, y: at.y - 60 } })
    await frame()
    expect(heights(host), 'a drag begun on the disclosure moved a boundary').toEqual(before)
    expect(sizes).not.toHaveBeenCalled()
  })

  /** A finger's press on a bar is left alone: a header is most of what a narrow view offers to scroll by. */
  it('leaves a finger’s press alone, which the boundary itself takes', async () => {
    const { host, sizes } = mount()
    const before = heights(host)
    const bar = header(host, 'heap')
    const y = middle(bar)
    fire(bar, 'pointerdown', y, 'touch')
    fire(bar, 'pointermove', y - 60, 'touch')
    await frame()
    fire(bar, 'pointerup', y - 60, 'touch')
    expect(heights(host), 'a finger on the bar dragged').toEqual(before)
    expect(bar.dataset.dragging, 'the bar is drawn held').toBeUndefined()
    expect(sizes).not.toHaveBeenCalled()
    const b = boundary(host, 'machine', 'heap')
    expect(getComputedStyle(b).touchAction, 'the boundary leaves a finger’s drag to the gesture').toBe('none')
    fire(b, 'pointerdown', middle(b), 'touch')
    fire(b, 'pointermove', middle(b) - 60, 'touch')
    await frame()
    expect(heights(host).heap, 'a finger on the boundary did not drag').toBeCloseTo(before.heap + 60, 0)
    fire(b, 'pointerup', middle(b), 'touch')
  })

  /** An open hand over a handle, and a closed one from the press to the release: `data-dragging`. */
  it('draws an open hand at rest and a closed one while it is held', async () => {
    const { host } = mount()
    for (const el of [header(host, 'heap'), boundary(host, 'machine', 'heap')]) {
      expect(getComputedStyle(el).cursor, 'at rest').toBe('grab')
      const y = middle(el)
      fire(el, 'pointerdown', y)
      expect(el.dataset.dragging, 'from the press').toBe('true')
      expect(getComputedStyle(el).cursor, 'held').toBe('grabbing')
      fire(el, 'pointerup', y)
      expect(el.dataset.dragging, 'after the release').toBeUndefined()
      expect(getComputedStyle(el).cursor, 'released').toBe('grab')
    }
  })

  it('puts the two regions back to the shares they are built with at a double click on the bar', async () => {
    const { host, sizes } = mount()
    const before = heights(host)
    await drag(host, header(host, 'heap'), -60)
    expect(heights(host).heap, 'precondition: the drag moved the boundary').toBeGreaterThan(before.heap + 50)
    await userEvent.dblClick(header(host, 'heap'))
    await frame()
    expect(heights(host).heap).toBeCloseTo(before.heap, 0)
    expect(heights(host).machine).toBeCloseTo(before.machine, 0)
    // THE TWO HOLD NO SHARE OF THEIR OWN AGAIN, and the listing never had one stored.
    expect(Object.keys(last(sizes))).toEqual([])
  })

  /**
   * IN A NARROW VIEW THE CALL STACK WRAPS UNDER THE REGISTERS, and its header is then in the middle of the row's
   * region, not along the boundary above it.
   */
  it('is not a handle on a panel that has wrapped under the one beside it', async () => {
    const { host } = mount({ width: 420, height: 1100 })
    await frame()
    const [r, s] = [panelOf(host, 'registers'), panelOf(host, 'stack')]
    expect(s.getBoundingClientRect().top, 'precondition: the call stack is under the registers').toBeGreaterThan(
      r.getBoundingClientRect().bottom - 1,
    )
    expect(header(host, 'registers').dataset.resizes).toBe('true')
    expect(header(host, 'stack').dataset.resizes, 'the wrapped panel’s header').toBeUndefined()
    const before = heights(host)
    await drag(host, header(host, 'stack'), -40)
    expect(heights(host), 'a drag of the wrapped panel’s header moved a boundary').toEqual(before)
  })
})

describe('a boundary moved with the keys', () => {
  it('moves by a step a press, and reports once for a key held down', async () => {
    const { host, sizes } = mount()
    const b = boundary(host, 'machine', 'heap')
    const before = heights(host)
    const shared = before.listing + before.machine + before.heap
    b.focus()
    await userEvent.keyboard('{ArrowUp}')
    await frame()
    expect(heights(host).heap, 'one press is not one step').toBeCloseTo(before.heap + BOUNDARY_KEY_STEP * shared, 0)
    expect(sizes, 'a press and its release are one gesture').toHaveBeenCalledTimes(1)
    // HELD: three repeats and one release.
    await userEvent.keyboard('{ArrowDown>3/}')
    await frame()
    expect(heights(host).heap).toBeCloseTo(before.heap - 2 * BOUNDARY_KEY_STEP * shared, 0)
    expect(sizes, 'a held key reported at each repeat').toHaveBeenCalledTimes(2)
    expect(document.activeElement, 'the boundary lost the focus').toBe(b)
    expect(b.getAttribute('aria-valuenow'), 'the value did not follow the keys').not.toBe('50')
  })

  it('goes back to the shares the two regions are built with at Enter', async () => {
    const { host, sizes } = mount()
    const b = boundary(host, 'machine', 'heap')
    const before = heights(host)
    b.focus()
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    await frame()
    expect(heights(host).heap, 'precondition: the keys moved the boundary').toBeGreaterThan(before.heap + 20)
    await userEvent.keyboard('{Enter}')
    await frame()
    expect(heights(host).heap).toBeCloseTo(before.heap, 0)
    expect(Object.keys(last(sizes))).toEqual([])
    expect(b.getAttribute('aria-valuenow')).toBe('50')
    expect(document.activeElement, 'the reset took the focus from the boundary').toBe(b)
  })

  it('and at a double click on the boundary itself', async () => {
    const { host } = mount()
    const b = boundary(host, 'machine', 'heap')
    const before = heights(host)
    await drag(host, b, -60)
    expect(heights(host).heap, 'precondition: the drag moved the boundary').toBeGreaterThan(before.heap + 50)
    await userEvent.dblClick(boundary(host, 'machine', 'heap'))
    await frame()
    expect(heights(host).heap).toBeCloseTo(before.heap, 0)
  })
})

describe('a view built with shares', () => {
  /**
   * **THE REGIONS THAT ARE OPEN FILL THE VIEW, WHATEVER THEIR SHARES ADD UP TO.** A share goes to `flex-grow`, and
   * where the factors of the growing items add up to less than 1 they take that much of the spare height and leave
   * the rest: a region that a drag left a share of a half, alone once the others were closed, took half its view.
   */
  it('fills the view with the one region left open, where its share is under 1', async () => {
    const { host } = mount({ sizes: { listing: 0.5, machine: 2.5 } })
    await userEvent.click(toggle(host, 'registers'))
    await userEvent.click(toggle(host, 'stack'))
    await userEvent.click(toggle(host, 'heap'))
    await frame()
    expect(boundaries(host), 'precondition: the listing is the one open region').toHaveLength(0)
    const [heap, view] = [panelOf(host, 'heap').getBoundingClientRect(), host.getBoundingClientRect()]
    expect(heap.bottom, 'the closed panels under the listing do not end at the view’s bottom').toBeCloseTo(
      view.bottom,
      0,
    )
    expect(height(host, 'listing'), 'the listing did not take the spare height').toBeGreaterThan(600)
  })

  it('draws each region at the share the workspace holds for it, and the others as they are built', () => {
    const { host } = mount({ sizes: { listing: 1, machine: 2 } })
    const h = heights(host)
    expect(h.machine / h.listing, 'the row is not twice the listing').toBeCloseTo(2, 1)
    expect(h.heap, 'the heap, with no share stored, is not the one it is built with').toBeCloseTo(h.listing, 0)
    expect(boundary(host, 'listing', 'machine').getAttribute('aria-valuenow')).toBe('33')
  })
})
