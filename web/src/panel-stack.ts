import { icon } from './icons'
import type { Panel } from './panel'
import { pointerDrag, separatorGesture } from './separator'

/**
 * THE REGIONS OF A VIEW THAT SHARE ITS HEIGHT, the boundaries between them, and the maximise button on each panel
 * (the view layouts spec §11).
 *
 * A REGION IS A FLEX ITEM OF THE VIEW'S COLUMN WITH A SHARE. `style.css` gives an open region
 * `flex: var(--share) 1 0`, so the open regions divide what the view's fixed parts leave in proportion to their
 * shares, each down to its body's floor. This module writes `--share` and nothing else of the layout: the default a
 * region is built with, or the share the workspace stores for it.
 *
 * **WHAT IS WRITTEN IS THE SHARES' RATIO, NEVER A FACTOR UNDER 1.** `--share` is a `flex-grow`, and where the factors
 * of the items that grow add up to less than 1 they take that much of the spare height and leave the rest. A drag can
 * leave a region any share above nothing, and closing its neighbours can leave it alone: a region with a share of a
 * half would take half its view, and a maximised term map with a quarter a quarter. So the open regions' shares are
 * written scaled, the least of them as 1.
 *
 * A BOUNDARY IS DRAWN BETWEEN TWO OPEN REGIONS WITH NO OPEN REGION BETWEEN THEM, directly under the upper one. A
 * closed region's header, or a part of the view that keeps its own height, can lie between the two, and moves with
 * the boundary.
 *
 * A PANEL'S HEADER IS A HANDLE FOR THE BOUNDARY ABOVE IT, where its region has one: the bar is what a pointer finds,
 * and it shows an open hand wherever a press would drag (`data-resizes`, which `style.css` reads). A press on one of
 * the header's own controls is that control's. A finger's press is left alone too: a header is most of what a narrow
 * view offers to scroll by, and the boundary itself takes a finger. The boundary stays the keyboard's, and the one
 * handle above a region that has no header, the λ term and the source editor.
 *
 * A DRAG MOVES TWO HEIGHTS AND NO OTHER, AND STORES TWO SHARES AND NO OTHER. A share is a ratio, and changing two
 * ratios alone would move every region wherever one of them sat on its floor. So a gesture's first frame measures
 * every region that has a share and makes its height in pixels its share, which draws exactly what was drawn; each
 * frame then moves pixels from one of the two to the other, held where either would go under its floor. When it ends,
 * the two regions' pixels are scaled to shares by what a pixel was worth to the regions that were over their floors,
 * and every other region is written the share it had. One on its floor has a height that is its floor's and not its
 * share's, and stored as measured it would come back taller in the next view with room to show it.
 */
export type StackRegion = {
  /** The share's name in the workspace. */
  readonly name: string
  /** What the boundary beside it calls it: "rules". */
  readonly label: string
  /** The element that takes the share. */
  readonly el: HTMLElement
  /**
   * The share it has with nothing stored, or `null` for a region that keeps its own height until a boundary beside
   * it is dragged: a copy's text, as tall as what it holds up to a cap, and the term map's canvas. Such a region is
   * not `data-sized`, and `style.css` gives it a share only where it is.
   */
  readonly share: number | null
  /** The panels drawn in it: one, the asm view's two side by side, or none where the region has no header. */
  readonly panels: readonly Panel[]
  /** The elements whose `min-height` is the region's floor. Asked at each gesture, since a view can swap one. */
  readonly bodies: () => readonly HTMLElement[]
}

/** A view's stored shares, by region name. */
export type Shares = Readonly<Record<string, number>>

/** How far one arrow press moves a boundary, as a fraction of the height the open regions share. */
export const BOUNDARY_KEY_STEP = 0.02

type Live = {
  /** The two regions the gesture's boundary parts, and the handle it is made on: the boundary, or a header. */
  readonly a: StackRegion
  readonly b: StackRegion
  readonly by: HTMLElement
  /** The two regions' heights when the gesture began, and their floors. */
  readonly start: readonly [number, number]
  readonly floor: readonly [number, number]
  /** The height the open regions share, which an arrow key's step is a part of. */
  readonly span: number
  /** What one pixel is worth in shares. */
  readonly scale: number
  /**
   * How far the pointer has gone from where the gesture began, in pixels, and how far the boundary has: the first
   * held to what the floors allow. A pointer that overshoots a floor has to come all the way back before the boundary
   * follows it, so the two are kept apart; an arrow key has no position to come back from, and steps from the second.
   */
  pointer: number
  offset: number
}

export class PanelStack {
  readonly #regions: readonly StackRegion[]
  readonly #onSizes: (sizes: Shares) => void
  #sizes: Shares
  #max: Panel | null = null
  readonly #boundaries = new Map<string, HTMLElement>()
  readonly #buttons = new Map<Panel, HTMLButtonElement>()
  readonly #headers = new Map<Panel, HTMLElement>()
  /** The share last written to each region, as its text: a write that would change nothing is not made. */
  readonly #written = new Map<StackRegion, string | null>()
  #live: Live | null = null

  constructor(regions: readonly StackRegion[], sizes: Shares, onSizes: (sizes: Shares) => void) {
    this.#regions = regions
    this.#sizes = sizes
    this.#onSizes = onSizes
    const watch = new MutationObserver(() => this.sync())
    for (const r of regions) {
      r.el.dataset.region = r.name
      watch.observe(r.el, { attributes: true, attributeFilter: ['hidden', 'data-open'] })
      // TWO PANELS SIDE BY SIDE WRAP ONE UNDER THE OTHER IN A NARROW VIEW, and only a header along the region's top
      // edge is at its boundary: which ones are is read again whenever the region's box changes. The headers alone:
      // a view that changes size changes no share.
      if (r.panels.length > 1) new ResizeObserver(() => this.#syncHandles()).observe(r.el)
      for (const p of r.panels) {
        if (p.el !== r.el) watch.observe(p.el, { attributes: true, attributeFilter: ['hidden', 'data-open'] })
        const header = p.el.querySelector<HTMLElement>(':scope > .panel-header')
        if (header !== null) {
          this.#headers.set(p, header)
          this.#handle(r, header)
        }
        this.#buttons.set(p, this.#maximise(p))
        // A GESTURE ON ANY DISCLOSURE ENDS A MAXIMISE (spec §11.3): opening another region does, and so does closing
        // the maximised one. The panel has already stored what the press drew.
        p.onGesture(() => this.#setMax(null))
      }
    }
    this.sync()
  }

  /** The shares the workspace holds now: a link opened, its undo, or a view closed and shown again. */
  setSizes(sizes: Shares): void {
    this.#live = null
    this.#sizes = sizes
    this.sync()
  }

  /** End a maximise, where there is one: for a view whose elements outlive what the workspace stores for it. */
  unmaximise(): void {
    this.#setMax(null)
  }

  /** The panel that is maximised, by its `data-panel` name. */
  get maximised(): string | null {
    return this.#max?.el.dataset.panel ?? null
  }

  #isOpen(r: StackRegion): boolean {
    if (r.el.hidden) return false
    return r.panels.length === 0 || r.panels.some((p) => !p.el.hidden && p.isOpen())
  }

  #share(r: StackRegion): number | null {
    return this.#sizes[r.name] ?? r.share
  }

  /**
   * Whether the gesture the stack holds is still being made: its handle on the page, and either held by a pointer
   * (`separator.ts`'s `data-dragging`) or holding the focus a key reached it by.
   *
   * **A GESTURE THAT IS NOT IS OVER, WHATEVER TOLD NOBODY.** While the stack holds a gesture it draws no boundary and
   * writes no share, so one held for good would freeze the view's regions as they were. A view that leaves the page
   * for good takes its handles with it. And a browser that blurs a separator after it has left the page gets no
   * commit from `separator.ts`, which commits nothing for a separator off the page; the tests' Chromium blurs it first.
   */
  #alive(live: Live): boolean {
    if (!live.by.isConnected) return false
    return live.by.dataset.dragging !== undefined || document.activeElement === live.by
  }

  /** Write every region's share, and draw the boundaries the open regions call for. */
  sync(): void {
    if (this.#live !== null) {
      if (this.#alive(this.#live)) return
      // WHAT IT HAD MOVED IS KEPT, as a gesture that ends is. `#commit` comes back here once it holds none.
      this.#commit()
      return
    }
    // A MAXIMISE ENDS WHEN ITS PANEL LEAVES THE VIEW: a copy's text panel is hidden when its editor is taken down,
    // and every other panel would then be drawn closed for a panel nobody could see, with no pressed button to press.
    if (this.#max?.el.hidden === true) {
      this.#setMax(null)
      return
    }
    const max = this.#max
    const open = this.#regions.filter((r) => this.#isOpen(r))
    // THE LEAST SHARE AMONG THE OPEN REGIONS IS WRITTEN AS 1, and the rest in proportion (this module's doc).
    let least = Number.POSITIVE_INFINITY
    for (const r of open) {
      const s = this.#share(r)
      if (s !== null && s > 0) least = Math.min(least, s)
    }
    const up = least < 1 ? 1 / least : 1
    for (const r of this.#regions) {
      const own = this.#share(r)
      if (max === null) this.#write(r, own === null ? null : own * up)
      // UNDER A MAXIMISE A REGION WITH NO HEADER KEEPS ITS FLOOR AND NO MORE: it has nothing to be drawn closed as.
      else if (r.panels.length === 0) this.#write(r, 0)
      // AND THE MAXIMISED PANEL'S REGION IS THE ONE THAT GROWS, by a whole factor, whatever share it has or has not.
      else if (r.panels.includes(max)) this.#write(r, 1)
      else this.#write(r, own)
    }
    const want = new Map<string, [StackRegion, StackRegion]>()
    if (max === null) {
      for (let i = 0; i + 1 < open.length; i++) {
        const a = open[i] as StackRegion
        const b = open[i + 1] as StackRegion
        want.set(`${a.name}|${b.name}`, [a, b])
      }
    }
    for (const [key, el] of this.#boundaries) {
      if (want.has(key)) continue
      el.remove()
      this.#boundaries.delete(key)
    }
    for (const [key, [a, b]] of want) {
      let el = this.#boundaries.get(key)
      if (el === undefined) {
        el = this.#boundary(a, b)
        this.#boundaries.set(key, el)
      }
      if (a.el.nextElementSibling !== el) a.el.after(el)
      // A BOUNDARY JUST DRAWN SAYS ITS VALUE ONCE IT IS IN PLACE (`#say`), where its view is on the page to measure.
      if (el.dataset.said === undefined) {
        el.dataset.said = 'true'
        this.#say(a, b)
      }
    }
    for (const [p, button] of this.#buttons) button.setAttribute('aria-pressed', String(p === max))
    this.#syncHandles()
  }

  /** Mark each header that is a handle now: one with a boundary above its region, along the region's top edge. */
  #syncHandles(): void {
    for (const r of this.#regions) {
      const above = this.#above(r)
      for (const p of r.panels) {
        const header = this.#headers.get(p)
        if (header === undefined) continue
        const handle = above !== null && this.#atTop(r, p)
        if (handle === (header.dataset.resizes === 'true')) continue
        if (handle) header.dataset.resizes = 'true'
        else delete header.dataset.resizes
      }
    }
  }

  /** The region the boundary above `r` parts it from, or `null` where no boundary is drawn above it. */
  #above(r: StackRegion): StackRegion | null {
    for (const a of this.#regions) if (this.#boundaries.has(`${a.name}|${r.name}`)) return a
    return null
  }

  /** Whether `p`'s header lies along the top edge of its region, which a wrapped second panel's does not. */
  #atTop(r: StackRegion, p: Panel): boolean {
    if (r.panels.length < 2) return true
    return p.el.getBoundingClientRect().top - r.el.getBoundingClientRect().top < 4
  }

  /** Make `header`, a panel's of the region `r`, a handle for the boundary above `r`. */
  #handle(r: StackRegion, header: HTMLElement): void {
    let pair: [StackRegion, StackRegion] | null = null
    pointerDrag(
      header,
      'y',
      {
        drag: (px) => {
          if (pair === null) return
          const live = this.#begin(pair[0], pair[1], header)
          if (live === null) return
          live.pointer += px
          this.#moveTo(live, live.pointer)
        },
        commit: () => this.#commit(),
        reset: () => {
          if (pair !== null) this.#reset(pair[0], pair[1])
        },
      },
      (e) => {
        if (e.button !== 0 || (e instanceof PointerEvent && e.pointerType === 'touch')) return false
        if (e.target instanceof Element && e.target.closest('button, select, input, a') !== null) return false
        const above = header.dataset.resizes === 'true' ? this.#above(r) : null
        if (above === null) return false
        pair = [above, r]
        return true
      },
    )
  }

  #write(r: StackRegion, share: number | null): void {
    const text = share === null ? null : String(share)
    if (this.#written.has(r) && this.#written.get(r) === text) return
    this.#written.set(r, text)
    if (text === null) {
      r.el.style.removeProperty('--share')
      delete r.el.dataset.sized
      return
    }
    r.el.style.setProperty('--share', text)
    r.el.dataset.sized = 'true'
  }

  #boundary(a: StackRegion, b: StackRegion): HTMLElement {
    const el = document.createElement('div')
    el.className = 'panel-boundary'
    el.dataset.above = a.name
    el.dataset.below = b.name
    el.setAttribute('role', 'separator')
    el.setAttribute('aria-orientation', 'horizontal')
    el.setAttribute('aria-valuemin', '0')
    el.setAttribute('aria-valuemax', '100')
    // THE MIDDLE, UNTIL IT IS ASKED: `#say` measures at the focus, which is when anything reads it.
    el.setAttribute('aria-valuenow', '50')
    el.setAttribute('aria-label', `resize ${a.label} and ${b.label}`)
    el.tabIndex = 0
    el.addEventListener('focus', () => this.#say(a, b))
    separatorGesture(el, 'y', {
      drag: (px) => {
        const live = this.#begin(a, b, el)
        if (live === null) return
        live.pointer += px
        this.#moveTo(live, live.pointer)
      },
      step: (sign) => {
        const live = this.#begin(a, b, el)
        if (live === null) return
        this.#moveTo(live, live.offset + sign * BOUNDARY_KEY_STEP * live.span)
        live.pointer = live.offset
      },
      commit: () => this.#commit(),
      reset: () => this.#reset(a, b),
    })
    return el
  }

  /**
   * Say, on the boundary between `a` and `b`, how much of the two the upper one is drawn at: `aria-valuenow`.
   *
   * **AS DRAWN, NOT AS SHARED.** The shares say it only while both regions are over their floors, and a region that
   * keeps its own height has none: an outline of two rows over an editor of forty would read as 50. Measuring is a
   * read of the layout, so it is done where the value is wanted, as a boundary is drawn, at its focus and at the end
   * of a gesture, and not at every change of the view; a frame of a gesture knows the two heights it has just written.
   * A view built off the page has no heights yet, and its boundaries say the middle until their focus.
   */
  #say(a: StackRegion, b: StackRegion, heights?: readonly [number, number]): void {
    const el = this.#boundaries.get(`${a.name}|${b.name}`)
    if (el === undefined) return
    const [ha, hb] = heights ?? [a.el.getBoundingClientRect().height, b.el.getBoundingClientRect().height]
    if (ha + hb > 0) el.setAttribute('aria-valuenow', String(Math.round((ha / (ha + hb)) * 100)))
  }

  /** Put both regions back to the shares they are built with. */
  #reset(a: StackRegion, b: StackRegion): void {
    this.#live = null
    const { [a.name]: _a, [b.name]: _b, ...rest } = this.#sizes
    this.#sizes = rest
    this.#onSizes(rest)
    this.sync()
    this.#say(a, b)
  }

  /** How far `r`'s height is over its floor: what its bodies have over their own `min-height`, the least of them. */
  #slack(r: StackRegion): number {
    // TWO BODIES SIDE BY SIDE REACH THEIR FLOORS TOGETHER; the one with less to give is the one that stops a drag.
    let slack = Number.POSITIVE_INFINITY
    for (const body of r.bodies()) {
      if (body.hidden) continue
      const min = Number.parseFloat(getComputedStyle(body).minHeight)
      slack = Math.min(slack, body.getBoundingClientRect().height - (Number.isFinite(min) ? min : 0))
    }
    return Number.isFinite(slack) ? Math.max(0, slack) : 0
  }

  /** The gesture's measurements, taken once, at its first frame. `by` is the handle the gesture is made on. */
  #begin(a: StackRegion, b: StackRegion, by: HTMLElement): Live | null {
    if (this.#live !== null) {
      if (this.#live.by === by && this.#alive(this.#live)) return this.#live
      // A GESTURE ON ANOTHER HANDLE ENDS THE ONE BEFORE IT. An arrow key held on one boundary is a gesture until its
      // release, and a press on another boundary's header moves no focus: without this, the second gesture would be
      // given the first's measurements, and write the heights of the first's two regions to its own.
      this.#commit()
    }
    const open = this.#regions.filter((r) => this.#isOpen(r))
    const upper = open.indexOf(a)
    if (upper < 0 || open[upper + 1] !== b) return null
    // EVERY REGION THAT FLEXES TAKES ITS OWN HEIGHT AS ITS SHARE: those with a share, and the two of the boundary,
    // either of which may have kept its own height until now. Measured first and written second; a region's floor is
    // read third, since for one that kept its own height it is its body's `min-height` as a region with a share.
    const flexing = open.filter((r) => r === a || r === b || this.#share(r) !== null)
    const heights = new Map(open.map((r) => [r, r.el.getBoundingClientRect().height]))
    const span = [...heights.values()].reduce((sum, h) => sum + h, 0)
    if (!(span > 0)) return null
    // WHAT A PIXEL IS WORTH IS WHAT THE REGIONS OVER THEIR FLOORS SAY: their shares over their pixels. One on its
    // floor is as tall as its floor, whatever its share. With none over its floor, every region that has a share
    // says it; and with none of those, the boundary's two regions come to a share of 1 each between them.
    const worth = (among: readonly StackRegion[]): number | null => {
      let [shares, pixels] = [0, 0]
      for (const r of among) {
        const s = this.#share(r)
        if (s === null) continue
        shares += s
        pixels += heights.get(r) as number
      }
      return shares > 0 && pixels > 0 ? shares / pixels : null
    }
    const scale =
      worth(flexing.filter((r) => this.#slack(r) > 0.5)) ??
      worth(flexing) ??
      2 / ((heights.get(a) as number) + (heights.get(b) as number))
    for (const r of flexing) this.#write(r, heights.get(r) as number)
    const start: [number, number] = [heights.get(a) as number, heights.get(b) as number]
    this.#live = {
      a,
      b,
      by,
      start,
      floor: [start[0] - this.#slack(a), start[1] - this.#slack(b)],
      span,
      scale,
      pointer: 0,
      offset: 0,
    }
    return this.#live
  }

  /** Put the boundary `to` pixels from where the gesture began, or as near as the two floors allow. */
  #moveTo(live: Live, to: number): void {
    const up = live.start[0] - live.floor[0]
    const down = live.start[1] - live.floor[1]
    live.offset = Math.min(Math.max(to, -Math.max(0, up)), Math.max(0, down))
    const ha = live.start[0] + live.offset
    const hb = live.start[1] - live.offset
    this.#write(live.a, ha)
    this.#write(live.b, hb)
    this.#say(live.a, live.b, [ha, hb])
  }

  #commit(): void {
    const live = this.#live
    if (live === null) return
    this.#live = null
    // A GESTURE THAT LEFT THE BOUNDARY WHERE IT WAS WRITES NOTHING, and the regions go back to the shares they had:
    // two on their floors are as tall as their floors, and a press and a move between them would store the floors'
    // ratio as their shares, for the next view tall enough to show it.
    if (live.offset !== 0) {
      // THE TWO REGIONS OF THE BOUNDARY, AND NO OTHER (this module's doc). **SIX FIGURES, NOT FOUR DECIMAL PLACES**:
      // a share is a ratio at whatever size the view's other shares are, and rounded to a ten-thousandth a small one
      // would lose its ratio, or come to 0, which `workspace.ts` refuses, and the whole stored workspace with it. A
      // region is as tall as its floor at least, so no share here is nothing.
      const share = (px: number): number => Number((px * live.scale).toPrecision(6))
      const sizes: Record<string, number> = {
        ...this.#sizes,
        [live.a.name]: share(live.start[0] + live.offset),
        [live.b.name]: share(live.start[1] - live.offset),
      }
      this.#sizes = sizes
      this.#onSizes(sizes)
    }
    this.sync()
    this.#say(live.a, live.b)
  }

  #maximise(p: Panel): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'panel-maximise'
    const name = `maximise ${p.toggle.textContent ?? ''}`.trim()
    button.setAttribute('aria-label', name)
    button.title = name
    button.setAttribute('aria-pressed', 'false')
    button.append(icon('maximise'))
    button.addEventListener('click', () => this.#setMax(this.#max === p ? null : p))
    p.actions.append(button)
    return button
  }

  #setMax(p: Panel | null): void {
    if (p === this.#max) return
    this.#max = p
    for (const r of this.#regions) for (const q of r.panels) q.drawOver(p === null ? null : q === p)
    this.sync()
  }
}
