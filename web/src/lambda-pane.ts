import type { ControlState } from './controls'
import type { LambdaWindow } from './lambda-window'
import { controlStrip, type PaneEvents } from './pane-chrome'
import { byteIndexAt, byteToIndex, decorationRanges, indexToByte } from './spans'
import type { LambdaState } from './types'

export type { PaneEvents }

function ellipsis(): HTMLElement {
  const el = document.createElement('span')
  el.className = 'truncated'
  el.textContent = ' … '
  return el
}

/**
 * The λ pane: the term as text, syntax-coloured by the same token classes the source pane uses.
 *
 * TRUNCATION IS SHOWN, NOT HIDDEN. `frame_cost_probe` measured a history frame's budget at 512
 * bytes, two orders below the readout's, so most non-trivial terms WILL truncate here — and a
 * truncated printed term is a prefix of the real one rather than a lie about its shape, which is why
 * showing it beats hiding it. `results.ts` still prints the full normal form at 64 KiB.
 */
export class LambdaPane {
  #text: HTMLElement
  #strip: ReturnType<typeof controlStrip>
  #frame: LambdaState | null = null
  #link: LambdaWindow | null = null

  constructor(host: HTMLElement, on: PaneEvents) {
    const title = document.createElement('h2')
    title.textContent = 'lambda'
    this.#text = document.createElement('pre')
    this.#text.className = 'term'
    this.#strip = controlStrip(on)
    host.replaceChildren(title, this.#text, this.#strip.el)

    // λ TEXT -> SOURCE, the third direction. Delegated from the `<pre>` rather than bound per token,
    // because tokens are recreated on every draw. `data-at` carries the token's byte offset in the
    // FULL `lambdaText` (see `#redraw`), so the handler needs no knowledge of the window's slice.
    //
    // ONLY THE WINDOW IS CLICKABLE. A frame view has no `data-at` on anything — its text is printed at
    // `FRAME_BYTES` from a term the index's coordinates do not describe — so a click there finds no
    // attribute and does nothing, which is the correct answer rather than a guard.
    this.#text.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const at = target.dataset.at
      if (at === undefined) return
      const byteOffset = Number.parseInt(at, 10)
      if (Number.isNaN(byteOffset)) return
      on.linkLambda?.(byteOffset)
    })
  }

  render(frame: LambdaState | null, controls: ControlState): void {
    this.#strip.update(controls)
    this.#frame = frame
    this.#redraw()
  }

  /**
   * Show a window onto the step-0 term around a linked construct, or `null` to go back to the frame.
   *
   * THE LINK VIEW REPLACES THE FRAME VIEW RATHER THAN OVERLAYING IT, because they are two different
   * texts: a frame is printed at `FRAME_BYTES` (512) and this at `LAMBDA_BYTE_BUDGET` (65,536). A
   * highlight computed against one and drawn on the other would land on arbitrary characters.
   */
  renderLink(win: LambdaWindow | null): void {
    /**
     * GUARDS THE NO-OP CASE: when no link was active and none becomes active, both the state
     * assignment and the redraw are unnecessary. This skips the redundant per-frame rebuild that
     * occurs on every playback tick (because `draw()` calls both `render()` and `renderLink()`,
     * each of which rebuilds the DOM). The remaining duplicate rebuild happens once per click,
     * when a link IS set and then cleared, and is left for a future API revision that merges the
     * two methods.
     */
    if (win === null && this.#link === null) return
    this.#link = win
    this.#redraw()
  }

  #redraw(): void {
    if (this.#link !== null) {
      const w = this.#link
      const ranges = decorationRanges(w.spans, w.text)
      const map = byteToIndex(w.text)
      // The INVERSE map, built once per render rather than per token. Encoding `text.slice(0, i)` per
      // token would be O(n^2) over a window that can be tens of kilobytes.
      const back = indexToByte(w.text)
      const targetFrom = byteIndexAt(map, w.target.start)
      const targetTo = byteIndexAt(map, w.target.end)
      const out: Node[] = []
      if (w.clippedHead) out.push(ellipsis())
      let at = 0
      for (const r of ranges) {
        if (r.from < at) continue
        if (r.from > at) out.push(document.createTextNode(w.text.slice(at, r.from)))
        const el = document.createElement('span')
        // FLAT, NOT NESTED. Every token inside the target range also carries `is-linked`; a wrapper
        // element would have to handle spans straddling the target's edges, and there is no need —
        // the edges are token boundaries by construction (see `lambdaWindow`).
        el.className = r.from >= targetFrom && r.to <= targetTo ? `${r.className} is-linked` : r.className
        // THE THIRD DIRECTION'S ONLY REQUIREMENT. `nodeAtLambda` speaks BYTE offsets into the full
        // `lambdaText`, and a click gives a DOM element — so each token carries the byte offset it
        // began at, in whole-text coordinates. Computed here rather than derived from the DOM at click
        // time, because the window is a slice and the offsets are not the ones on screen.
        el.dataset.at = String(w.origin + (back[r.from] ?? 0))
        el.textContent = w.text.slice(r.from, r.to)
        out.push(el)
        at = r.to
      }
      if (at < w.text.length) out.push(document.createTextNode(w.text.slice(at)))
      if (w.clippedTail) out.push(ellipsis())
      this.#text.replaceChildren(...out)
      return
    }

    const frame = this.#frame
    if (frame === null) {
      this.#text.replaceChildren()
      return
    }
    // Spans arrive as byte offsets into THIS frame's own text, so nothing here can be a keystroke
    // behind the way the source pane's can be — but `decorationRanges` sorts, clamps, and converts
    // byte offsets to UTF-16 indices anyway, and reusing it means one implementation of those rules
    // rather than two. `λ` is 2 bytes and 1 UTF-16 code unit, so the conversion is not optional here:
    // it fires on every term with a binder, not only on non-ASCII source.
    const ranges = decorationRanges(frame.spans, frame.text)
    const out: Node[] = []
    let at = 0
    for (const r of ranges) {
      if (r.from < at) continue
      if (r.from > at) out.push(document.createTextNode(frame.text.slice(at, r.from)))
      const el = document.createElement('span')
      el.className = r.className
      el.textContent = frame.text.slice(r.from, r.to)
      out.push(el)
      at = r.to
    }
    if (at < frame.text.length) out.push(document.createTextNode(frame.text.slice(at)))
    if (frame.truncated) {
      const more = document.createElement('span')
      more.className = 'truncated'
      more.textContent = ' … truncated'
      out.push(more)
    }
    this.#text.replaceChildren(...out)
  }
}
