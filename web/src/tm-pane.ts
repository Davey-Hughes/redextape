import type { ControlState } from './controls'
import { n } from './format'
import { controlStrip, type PaneEvents } from './pane-chrome'
import { tapeRows } from './tape'
import type { TmProgram, TmState } from './types'

/**
 * The TM pane: five tape rows and a status line.
 *
 * FIVE ROWS, NOT ONE. §6.1's mockup shows a single tape; the lowering emits `TAPES = 5` and showing
 * them together is the point — you cannot watch STACK move while REG is read otherwise.
 *
 * THE STATE TABLE IS 5a-ii, not here. It needs virtualization (146 states for `[1, 2]`) and its
 * second consumer is 5b's click-linking; the status line names the current state in the meantime,
 * which is what `tmProgram().states[id].name` is read for.
 */
export class TmPane {
  #status: HTMLElement
  #tapes: HTMLElement
  #strip: ReturnType<typeof controlStrip>
  #program: TmProgram | null = null
  #names: string[] = []

  constructor(host: HTMLElement, on: PaneEvents) {
    const title = document.createElement('h2')
    title.textContent = 'turing machine'
    this.#status = document.createElement('div')
    this.#status.className = 'tm-status'
    this.#tapes = document.createElement('div')
    this.#tapes.className = 'tapes'
    this.#strip = controlStrip(on)
    host.replaceChildren(title, this.#status, this.#tapes, this.#strip.el)
  }

  /**
   * Set once per compile. `TmProgram` is ~123 states for `let x = 40; x + 2` and does not change as
   * the cursor moves, which is what the `TmProgram`/`TmState` split exists for.
   */
  setProgram(p: TmProgram | null, names: string[]): void {
    this.#program = p
    this.#names = names
  }

  render(frame: TmState | null, controls: ControlState): void {
    this.#strip.update(controls)
    if (frame === null || this.#program === null) {
      this.#status.textContent = ''
      this.#tapes.replaceChildren()
      return
    }

    // A `StateId` past the end yields no name rather than an index nobody can read — the same
    // no-fallback rule `TmState::source_node` follows one layer in.
    const name = this.#program.states[frame.state]?.name ?? `state ${frame.state}`
    this.#status.textContent = `${name} · width ${n(this.#program.width)}`

    this.#tapes.replaceChildren(
      ...tapeRows(frame, this.#names).map((row) => {
        const el = document.createElement('div')
        el.className = 'tape'
        const label = document.createElement('span')
        label.className = 'tape-label'
        label.textContent = row.label
        const cells = document.createElement('span')
        cells.className = 'cells'
        cells.append(
          ...row.cells.map((c, i) => {
            const cell = document.createElement('span')
            cell.className = i === row.headIndex && row.headInWindow ? 'cell head' : 'cell'
            cell.textContent = c
            return cell
          }),
        )
        el.append(label, cells)
        return el
      }),
    )
  }
}
