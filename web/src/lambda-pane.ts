import type { ControlState } from './controls'
import { controlStrip, type PaneEvents } from './pane-chrome'
import { decorationRanges } from './spans'
import type { LambdaState } from './types'

export type { PaneEvents }

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

  constructor(host: HTMLElement, on: PaneEvents) {
    const title = document.createElement('h2')
    title.textContent = 'lambda'
    this.#text = document.createElement('pre')
    this.#text.className = 'term'
    this.#strip = controlStrip(on)
    host.replaceChildren(title, this.#text, this.#strip.el)
  }

  render(frame: LambdaState | null, controls: ControlState): void {
    this.#strip.update(controls)
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
