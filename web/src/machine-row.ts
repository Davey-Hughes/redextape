import type { Panel } from './panel'
import type { PanelStack, StackRegion } from './panel-stack'

/**
 * How a machine view lays out its values, call stack and heap (the machine panels row design §5): in **wide** the three
 * side by side in one row; in **medium** the values beside the call stack and the heap under them; in **narrow** the
 * three in a column.
 */
export type Arrangement = 'wide' | 'medium' | 'narrow'

/**
 * The arrangement of a row `width` px wide whose values, call stack and heap are each at least `columns` px wide,
 * `gap` px apart: wide where all three and two gaps fit, medium where the first two and one gap do.
 */
export function arrangementFor(width: number, columns: readonly [number, number, number], gap: number): Arrangement {
  const [values, stack, heap] = columns
  if (width >= values + stack + heap + 2 * gap) return 'wide'
  if (width >= values + stack + gap) return 'medium'
  return 'narrow'
}

export type MachineRowOptions = {
  readonly values: Panel
  readonly stack: Panel
  readonly heap: Panel
  /**
   * The least width of the values, the call stack and the heap in the row, in rem: what each one's content and header
   * need to read (design §5.1). The thresholds come from them, and so do the columns' proportions at any width the row
   * has (`--column`, `style.css`), so the arrangement chosen always has room for the columns drawn.
   */
  readonly columns: readonly [number, number, number]
}

type Movable = ParentNode & { moveBefore?: (node: Node, child: Node | null) => void }

/**
 * Put `el` last in `parent`, the focus staying where it was inside `el`: `moveBefore` moves an element without taking
 * it off the page, and where a browser has none, or refuses the move, the element is appended and the focus it held is
 * given back (design §6.6).
 */
export function moveInto(parent: HTMLElement, el: HTMLElement): void {
  const movable = parent as Movable
  if (typeof movable.moveBefore === 'function') {
    try {
      movable.moveBefore(el, null)
      return
    } catch {
      // A MOVE THE BROWSER REFUSES, AS ONE INTO A PARENT OFF THE PAGE, IS MADE BY APPENDING, below.
    }
  }
  const focused = document.activeElement
  const held = focused instanceof HTMLElement && el.contains(focused) ? focused : null
  parent.append(el)
  if (held !== null && document.activeElement !== held) held.focus({ preventScroll: true })
}

/**
 * The observer that follows each host, the row of the machine view built into it last: an observer of the host is kept
 * for as long as the host is, and keeps the row it calls with it. A host's entry is the one observer connected to it.
 */
const following = new WeakMap<HTMLElement, ResizeObserver>()

/**
 * The values, call stack and heap of a machine view, in the arrangement its view's width has room for. The row holds
 * the values in narrow, the call stack too in medium and the heap too in wide; a panel it does not hold is in a region
 * of its own.
 *
 * **A PANEL MOVES AND ITS REGION STAYS.** A region whose panel is in the row is `hidden`, which `PanelStack` reads as
 * closed: the boundary above it goes, and the heap's stored share waits for its region's return (design §5.3). The
 * call stack's region is a part of the row's (`StackRegion.partOf`, the after-the-try design's G1), so hidden it gives
 * the row the height the two had together: a switch stores nothing.
 *
 * **THE ROW NEVER WRAPS**, so what is drawn cannot differ from what was chosen here.
 */
export class MachineRow {
  /** The row: `style.css`'s `.rxm-machine`, its `data-arrangement` the arrangement chosen. */
  readonly el: HTMLDivElement
  /** The call stack's own region, `.machine-stack`: it holds the call stack in narrow, and is `hidden` otherwise. */
  readonly stackRegion: HTMLDivElement
  /** The heap's own region, `.machine-heap`: it holds the heap in medium and narrow, and is `hidden` in wide. */
  readonly heapRegion: HTMLDivElement
  /**
   * The row, the call stack's region and the heap's region, for the view's `PanelStack`, in that order. The row is
   * built with the values alone and takes in the call stack and the heap by `PanelStack.place`; the call stack's
   * region is a part of the row's, its share the call stack's part of the two's, an even split where none is stored.
   */
  readonly regions: readonly [StackRegion, StackRegion, StackRegion]
  readonly #o: MachineRowOptions
  /** Narrow until a width says otherwise: what the constructor builds, each panel in its own region. */
  #arrangement: Arrangement = 'narrow'
  #host: HTMLElement | null = null
  #stack: PanelStack | null = null
  /** Whether a switch waits for the stack to hold no gesture: one wait at a time, however often the width changes. */
  #waiting = false

  /**
   * Built in narrow, each panel in a region of its own and no region hidden: `PanelStack` reads a panel as drawn in
   * the region it is built in, and gives each region the handle and the closed state of the panels built in it. So the
   * row takes in the call stack and the heap by `place`, as every switch does, and `follow` makes the first switch
   * before the first frame (design §6.1).
   */
  constructor(o: MachineRowOptions) {
    this.#o = o
    this.el = document.createElement('div')
    this.el.className = 'rxm-machine'
    this.el.dataset.arrangement = this.#arrangement
    this.el.append(o.values.el)
    this.stackRegion = document.createElement('div')
    this.stackRegion.className = 'machine-stack'
    this.stackRegion.append(o.stack.el)
    this.heapRegion = document.createElement('div')
    this.heapRegion.className = 'machine-heap'
    this.heapRegion.append(o.heap.el)
    for (const [i, p] of [o.values, o.stack, o.heap].entries()) p.el.style.setProperty('--column', String(o.columns[i]))
    const name = (p: Panel): string => p.toggle.textContent ?? ''
    this.regions = [
      {
        name: 'machine',
        // THE BOUNDARY ABOVE THE ROW NAMES WHAT THE ROW HOLDS NOW (design §5.3): "a", "a and b", "a, b and c".
        label: () => {
          const held = this.#inRow().map(name)
          const last = held.pop() ?? ''
          return held.length === 0 ? last : `${held.join(', ')} and ${last}`
        },
        el: this.el,
        share: 1,
        panels: [o.values],
        bodies: () =>
          this.#inRow()
            .filter((p) => p.isOpen())
            .map((p) => p.body),
      },
      {
        name: 'stack',
        label: name(o.stack),
        el: this.stackRegion,
        share: 0.5,
        partOf: 'machine',
        panels: [o.stack],
        bodies: () => [o.stack.body],
      },
      {
        name: 'heap',
        label: name(o.heap),
        el: this.heapRegion,
        share: 1,
        panels: [o.heap],
        bodies: () => [o.heap.body],
      },
    ]
  }

  get arrangement(): Arrangement {
    return this.#arrangement
  }

  /**
   * Choose the arrangement from `host`'s width from now on, `stack` being the one built on `regions`: at once where
   * `host` is on the page, so a view built there is drawn in its arrangement from its first frame (design §6.1), and in
   * each frame its box changes, before that frame is painted, or as the gesture `stack` holds then ends (§6.7).
   */
  follow(host: HTMLElement, stack: PanelStack): void {
    this.#host = host
    this.#stack = stack
    // **A HOST OUTLIVES ITS VIEWS**: `pane-host.ts` keeps each for the session and builds every new view into it. So a
    // row lets its host go when the next machine view built there follows it, and, where another kind of view was
    // built there, at the host's first change of size after; a row that went on following would be kept, with its
    // view, for as long as the host is.
    following.get(host)?.disconnect()
    const observer = new ResizeObserver(() => {
      if (host.contains(this.el)) {
        this.#fit()
        return
      }
      observer.disconnect()
      following.delete(host)
    })
    following.set(host, observer)
    observer.observe(host, { box: 'border-box' })
    this.#fit()
  }

  /** The panels the row holds now. */
  #inRow(): readonly Panel[] {
    const o = this.#o
    if (this.#arrangement === 'narrow') return [o.values]
    return this.#arrangement === 'medium' ? [o.values, o.stack] : [o.values, o.stack, o.heap]
  }

  /**
   * The width the row is laid out in: the view's border box, less its padding and border (design §5.4). **NOT THE
   * ROW'S OWN**: nothing the view shows changes the view's box, so no step, compile or scroll bar switches the
   * arrangement, and moving the heap cannot resize what `follow` observes, which the browser would report as a
   * `ResizeObserver` loop (§6.2, §6.3).
   */
  #width(host: HTMLElement): number {
    const css = getComputedStyle(host)
    const edges = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'] as const
    return host.getBoundingClientRect().width - edges.reduce((sum, k) => sum + (Number.parseFloat(css[k]) || 0), 0)
  }

  /** The arrangement `host`'s width has room for now. */
  #chosen(host: HTMLElement): Arrangement {
    const width = this.#width(host)
    // A VIEW OFF THE PAGE, PARKED, OR ON A STAGE TAB NOT SHOWN HAS NO WIDTH TO CHOOSE BY, and keeps its arrangement.
    if (!(width > 0)) return this.#arrangement
    // THE ROOT'S FONT SIZE AND THE ROW'S GAP ARE READ AT EACH DECISION: the least widths are rem and the gap is the
    // stylesheet's, so a threshold is where the stylesheet's columns fit, whatever size a person's text is.
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    const gap = Number.parseFloat(getComputedStyle(this.el).columnGap)
    const [v, s, h] = this.#o.columns
    return arrangementFor(width, [v * rem, s * rem, h * rem], gap)
  }

  #fit(): void {
    const host = this.#host
    const stack = this.#stack
    if (host === null || stack === null) return
    if (this.#waiting) {
      // A GESTURE WHOSE HANDLE HAS LEFT THE PAGE IS OVER, AND THE STACK LEARNS IT ONLY WHEN IT IS ASKED: a browser that
      // sends a removed boundary no `blur` commits nothing, and a row that asked nothing while it waited would keep its
      // arrangement at every width from then on. `sync` does nothing under a gesture still being made.
      stack.sync()
      return
    }
    if (this.#chosen(host) === this.#arrangement) return
    // NO SWITCH UNDER A GESTURE (design §6.7): a gesture measures its two regions at its first frame, and a switch
    // would open or close a region under it. **THE WIDTH IS READ AGAIN ONCE THE STACK IS FREE**, which is at once
    // where it holds no gesture: the view may have been resized again while the switch waited.
    this.#waiting = true
    stack.whenFree(() => {
      this.#waiting = false
      const next = this.#chosen(host)
      if (next !== this.#arrangement) this.#apply(next, stack)
    })
  }

  #apply(next: Arrangement, stack: PanelStack): void {
    const o = this.#o
    this.#arrangement = next
    this.el.dataset.arrangement = next
    const inRow = this.#inRow()
    const focused = document.activeElement
    const boundary = focused instanceof HTMLElement && focused.classList.contains('panel-boundary') ? focused : null
    const moved: [Panel, string][] = []
    // INTO THE ROW THE CALL STACK BEFORE THE HEAP, so the row holds its panels in their columns' order. A REGION IS
    // SHOWN BEFORE ITS PANEL MOVES INTO IT, AND HIDDEN AFTER ITS PANEL LEAVES: where the move is an append, the focus
    // is given back after it, and an element in a hidden region cannot take it (design §6.6).
    for (const [p, region, name] of [
      [o.stack, this.stackRegion, 'stack'],
      [o.heap, this.heapRegion, 'heap'],
    ] as const) {
      const into = inRow.includes(p)
      if ((p.el.parentElement === this.el) === into) continue
      if (!into) region.hidden = false
      moveInto(into ? this.el : region, p.el)
      if (into) region.hidden = true
      moved.push([p, into ? 'machine' : name])
    }
    for (const [p, region] of moved) stack.place(p, region)
    // A FOCUSED BOUNDARY THE SWITCH TOOK OFF THE PAGE HANDS THE FOCUS TO A TOGGLE, where it would otherwise fall to the
    // page's body (design §6.6): the call stack's where the boundary was above the call stack's region (the
    // after-the-try design's G1), and the heap's otherwise, into narrow too, where the heap has not moved.
    if (boundary === null || boundary.isConnected) return
    const to = boundary.dataset.below === 'stack' ? o.stack : o.heap
    to.toggle.focus({ preventScroll: true })
  }
}
