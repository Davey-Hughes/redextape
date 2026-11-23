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
 * A PANEL'S HEADER IS A HANDLE FOR THE BOUNDARY ABOVE IT, where its region has one, with an open hand wherever a press
 * would drag (`data-resizes`, which `style.css` reads). A press on its title is the title's until it moves past
 * `DRAG_THRESHOLD` (`separator.ts`): the title's words are what a person aims at, and a click must stay one.
 * Its other controls' presses are theirs, and a finger's is left alone: a header is most of what a narrow view offers
 * to scroll by. The boundary takes a finger and the keys, and is the one handle above the λ term and the source editor.
 *
 * A DRAG MOVES TWO HEIGHTS AND NO OTHER, AND STORES ITS TWO REGIONS' SHARES AND NO OTHER, a pair's as their sum and
 * part (`StackRegion.partOf`). A share is a ratio, and changing two ratios alone would move every region wherever one
 * of them sat on its floor. So a gesture's first frame measures every region that has a share and makes its height in
 * pixels its share, which draws exactly what was drawn; each frame then moves pixels from one of the two to the other,
 * held where either would go under its floor. When it ends, the two regions' pixels are scaled to shares by what a
 * pixel was worth to the regions over their floors, and every other region keeps the share it had. One on its floor is
 * as tall as its floor and not its share, and stored as measured would come back taller in a view with room to show it.
 */
export type StackRegion = {
  /** The share's name in the workspace. */
  readonly name: string
  /** What the boundary beside it calls it: "rules". A function is asked again at each sync, where the name changes. */
  readonly label: string | (() => string)
  /** The element that takes the share. */
  readonly el: HTMLElement
  /**
   * The share it has with nothing stored, or `null` for a region that keeps its own height until a boundary beside
   * it is dragged: a copy's text, as tall as what it holds up to a cap, and the term map's canvas. Such a region is
   * not `data-sized`, and `style.css` gives it a share only where it is.
   */
  readonly share: number | null
  /**
   * The name of the region this one is a part of, where it is one, as a machine view's call stack is of its row in a
   * narrow view (the machine panels row after the try's design, G1). `share` is then the part, a fraction between 0
   * and 1 of that region's share, which it has to have, and what is stored under `name` is the part too. A region has
   * one part at most, and a part has none. The two divide the whole's share while both are
   * open, and either open alone takes all of it: so hiding the part gives the whole the two's height with nothing
   * stored, and a drag beside one of the two stores their sum and part again, so the other keeps its height.
   */
  readonly partOf?: string
  /**
   * The panels drawn in it as it is built: one, or none where the region has no header. `PanelStack.place` draws one
   * in another region later, as a machine view's row takes in the call stack and the heap, side by side.
   */
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
  /** The panels drawn in each region now, which `place` changes. */
  readonly #members = new Map<StackRegion, Panel[]>()
  /** What waits for the stack to hold no gesture: `whenFree`. */
  #waiting: (() => void)[] = []
  /** The region each region with `partOf` is a part of, and the part each such region has. */
  readonly #wholeOf = new Map<StackRegion, StackRegion>()
  readonly #partIn = new Map<StackRegion, StackRegion>()
  /** The share last written to each region, as its text: a write that would change nothing is not made. */
  readonly #written = new Map<StackRegion, string | null>()
  #live: Live | null = null

  constructor(regions: readonly StackRegion[], sizes: Shares, onSizes: (sizes: Shares) => void) {
    // CHECKED BEFORE ANYTHING IS DRAWN: a stack that throws has changed none of its regions' elements.
    for (const r of regions) {
      if (r.partOf === undefined) continue
      const whole = regions.find((w) => w.name === r.partOf)
      if (whole === undefined) throw new Error(`no region ${r.partOf} in this stack for ${r.name} to be a part of`)
      if (whole === r) throw new Error(`${r.name} cannot be a part of itself`)
      if (whole.partOf !== undefined) throw new Error(`${r.name} cannot be a part of ${whole.name}, a part itself`)
      const first = this.#partIn.get(whole)
      if (first !== undefined) throw new Error(`${whole.name} has two parts, ${first.name} and ${r.name}`)
      if (r.share === null || !(r.share > 0 && r.share < 1))
        throw new Error(`${r.name}'s share is its part of ${whole.name}, between 0 and 1, not ${r.share}`)
      if (whole.share === null) throw new Error(`${whole.name} has a part, ${r.name}, so it has a share of its own`)
      this.#wholeOf.set(r, whole)
      this.#partIn.set(whole, r)
    }
    this.#regions = regions
    this.#sizes = sizes
    this.#onSizes = onSizes
    const watch = new MutationObserver(() => this.sync())
    for (const r of regions) {
      this.#members.set(r, [...r.panels])
      r.el.dataset.region = r.name
      watch.observe(r.el, { attributes: true, attributeFilter: ['hidden', 'data-open'] })
      for (const p of r.panels) {
        if (p.el !== r.el) watch.observe(p.el, { attributes: true, attributeFilter: ['hidden', 'data-open'] })
        const header = p.el.querySelector<HTMLElement>(':scope > .panel-header')
        if (header !== null) {
          this.#headers.set(p, header)
          this.#handle(p, header)
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
    this.#free()
  }

  /** End a maximise, where there is one: for a view whose elements outlive what the workspace stores for it. */
  unmaximise(): void {
    this.#setMax(null)
  }

  /**
   * `panel` is drawn in the region named `region` now: its view has moved its element there. Its maximise, its header's
   * handle and the region's open state follow it, where each would otherwise go on reading the region it was built in,
   * and each boundary says its value again, which the move has changed. Throws for a name the stack has no region of.
   */
  place(panel: Panel, region: string): void {
    const to = this.#regions.find((r) => r.name === region)
    if (to === undefined) throw new Error(`no region ${region} in this stack`)
    for (const [r, panels] of this.#members) {
      const at = panels.indexOf(panel)
      if (at >= 0 && r !== to) panels.splice(at, 1)
    }
    const into = this.#members.get(to) as Panel[]
    if (!into.includes(panel)) into.push(panel)
    this.sync()
    for (const el of this.#boundaries.values()) {
      const [a, b] = [el.dataset.above, el.dataset.below].map((n) => this.#regions.find((r) => r.name === n))
      if (a !== undefined && b !== undefined) this.#say(a, b)
    }
  }

  /**
   * Run `then` once the stack holds no gesture: at once, or as the one it holds ends. For a caller about to change
   * which regions are open, which a gesture measures at its first frame and `sync` leaves alone while one is held.
   */
  whenFree(then: () => void): void {
    // A GESTURE WHOSE HANDLE HAS GONE IS OVER (`#alive`), and nothing else would end it for a caller waiting here.
    if (this.#live !== null && !this.#alive(this.#live)) this.#commit()
    if (this.#live === null) then()
    else this.#waiting.push(then)
  }

  /** Run what waited for no gesture, where none is held. */
  #free(): void {
    if (this.#live !== null) return
    const waiting = this.#waiting
    this.#waiting = []
    for (const then of waiting) then()
  }

  /** The panel that is maximised, by its `data-panel` name. */
  get maximised(): string | null {
    return this.#max?.el.dataset.panel ?? null
  }

  #isOpen(r: StackRegion): boolean {
    if (r.el.hidden) return false
    return r.panels.length === 0 || this.#panelsOf(r).some((p) => !p.el.hidden && p.isOpen())
  }

  /** The panels drawn in `r` now. */
  #panelsOf(r: StackRegion): readonly Panel[] {
    return this.#members.get(r) ?? r.panels
  }

  /** The share `r` is drawn with: its own, or for one of a pair its piece of the whole's (`StackRegion.partOf`). */
  #share(r: StackRegion): number | null {
    const whole = this.#wholeOf.get(r)
    if (whole !== undefined) {
      const all = this.#own(whole)
      return all === null ? null : all * (this.#isOpen(whole) ? this.#part(r) : 1)
    }
    const own = this.#own(r)
    const part = this.#partIn.get(r)
    if (own === null || part === undefined) return own
    return own * (this.#isOpen(part) ? 1 - this.#part(part) : 1)
  }

  /** The share stored for `r`, or the one it is built with. */
  #own(r: StackRegion): number | null {
    return this.#sizes[r.name] ?? r.share
  }

  /**
   * The fraction of its whole that the part `p` is: the stored one, or the one it is built with.
   *
   * **A STORED PART NOT BETWEEN 0 AND 1 IS READ AS THE BUILT ONE.** `workspace.ts` takes any share above 0, and a
   * link edited by hand could hold one that would leave the whole a share of nothing, or under it.
   */
  #part(p: StackRegion): number {
    const stored = this.#sizes[p.name]
    if (stored !== undefined && stored > 0 && stored < 1) return stored
    // THE CONSTRUCTOR THROWS FOR A PART BUILT WITH ANY SHARE BUT ONE BETWEEN 0 AND 1.
    return p.share as number
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
      else if (this.#panelsOf(r).includes(max)) this.#write(r, 1)
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
      // A REGION'S LABEL CAN CHANGE WITH WHAT IT HOLDS, and a boundary outlives the change.
      const name = this.#name(a, b)
      if (el.getAttribute('aria-label') !== name) el.setAttribute('aria-label', name)
      // A BOUNDARY JUST DRAWN SAYS ITS VALUE ONCE IT IS IN PLACE (`#say`), where its view is on the page to measure.
      if (el.dataset.said === undefined) {
        el.dataset.said = 'true'
        this.#say(a, b)
      }
    }
    for (const [p, button] of this.#buttons) button.setAttribute('aria-pressed', String(p === max))
    this.#syncHandles()
  }

  /**
   * Mark each header that is a handle now: one with a boundary above its region. A region's panels lie side by side,
   * so each header is along its top edge.
   */
  #syncHandles(): void {
    for (const r of this.#regions) {
      const handle = this.#above(r) !== null
      for (const p of this.#panelsOf(r)) {
        const header = this.#headers.get(p)
        if (header === undefined) continue
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

  /** Make `header`, `p`'s, a handle for the boundary above the region `p` is drawn in at the press. */
  #handle(p: Panel, header: HTMLElement): void {
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
        const control = e.target instanceof Element ? e.target.closest('button, select, input, a') : null
        // THE PANEL'S OWN TITLE AND NO OTHER CONTROL: any other button in the header is its own.
        const title = control === p.toggle
        if (control !== null && !title) return false
        const r = this.#regions.find((q) => this.#panelsOf(q).includes(p))
        const above = r !== undefined && header.dataset.resizes === 'true' ? this.#above(r) : null
        if (r === undefined || above === null) return false
        pair = [above, r]
        return title ? 'past-threshold' : true
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

  /** What the boundary between `a` and `b` is called, by the two regions' labels as they are now. */
  #name(a: StackRegion, b: StackRegion): string {
    const label = (r: StackRegion): string => (typeof r.label === 'function' ? r.label() : r.label)
    return `resize ${label(a)} and ${label(b)}`
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
    el.setAttribute('aria-label', this.#name(a, b))
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
   * read of the layout, so it is done where the value is wanted, as a boundary is drawn, at its focus, at the end
   * of a gesture and as a panel is placed, and not at every change of the view; a frame of a gesture knows the two
   * heights it has just written. A view built off the page has no heights yet, and its boundaries say the middle until
   * their focus, or until a panel is placed with the view on the page.
   */
  #say(a: StackRegion, b: StackRegion, heights?: readonly [number, number]): void {
    const el = this.#boundaries.get(`${a.name}|${b.name}`)
    if (el === undefined) return
    const [ha, hb] = heights ?? [a.el.getBoundingClientRect().height, b.el.getBoundingClientRect().height]
    if (ha + hb > 0) el.setAttribute('aria-valuenow', String(Math.round((ha / (ha + hb)) * 100)))
  }

  /**
   * Put the two sides of the boundary between `a` and `b` back to the shares they are built with.
   *
   * **THE SPLIT OF A PAIR IS THE BOUNDARY BETWEEN THE TWO'S ALONE TO PUT BACK.** On that boundary the part goes back
   * and the whole's share stays, so the regions beyond the pair do not move. On a boundary beside one of the two, the
   * region outside and the whole's share go back and the part stays: the pair's sum is that boundary's, the split is
   * not.
   */
  #reset(a: StackRegion, b: StackRegion): void {
    this.#live = null
    const part = this.#wholeOf.get(a) === b ? a : this.#wholeOf.get(b) === a ? b : null
    const gone = new Set(part !== null ? [part.name] : [a, b].map((r) => (this.#wholeOf.get(r) ?? r).name))
    const rest = Object.fromEntries(Object.entries(this.#sizes).filter(([name]) => !gone.has(name)))
    this.#sizes = rest
    this.#onSizes(rest)
    this.sync()
    this.#say(a, b)
    this.#free()
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
      // THE TWO SIDES OF THE BOUNDARY, A PAIR'S AS ITS SUM AND PART, AND NO OTHER (this module's doc). **SIX FIGURES,
      // NOT FOUR DECIMAL PLACES**: a share is a ratio at whatever size the view's other shares are, and rounded to a
      // ten-thousandth a small one would lose its ratio, or come to 0, which `workspace.ts` refuses, and the whole
      // stored workspace with it. A region is as tall as its floor at least, so no share here is nothing.
      const six = (share: number): number => Number(share.toPrecision(6))
      const drawn = new Map([
        [live.a, (live.start[0] + live.offset) * live.scale],
        [live.b, (live.start[1] - live.offset) * live.scale],
      ])
      const sizes: Record<string, number> = { ...this.#sizes }
      for (const [r, d] of drawn) {
        const whole = this.#wholeOf.get(r) ?? r
        const part = this.#partIn.get(whole)
        // A PAIR BOTH OPEN STORES ITS SUM AND ITS PART (`StackRegion.partOf`), the one of the two outside the gesture
        // at the share it is drawn with, so that it keeps its height. One of a pair open alone is drawn with the
        // whole's share, and stores its own there, leaving the part as it was.
        const v = drawn.get(whole) ?? this.#share(whole)
        const s = part === undefined ? null : (drawn.get(part) ?? this.#share(part))
        if (part === undefined || !this.#isOpen(whole) || !this.#isOpen(part) || v === null || s === null) {
          sizes[whole.name] = six(d)
          continue
        }
        sizes[whole.name] = six(v + s)
        sizes[part.name] = six(s / (v + s))
      }
      this.#sizes = sizes
      this.#onSizes(sizes)
    }
    this.sync()
    this.#say(live.a, live.b)
    this.#free()
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
