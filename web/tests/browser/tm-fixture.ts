import { TmPane } from '../../src/tm-pane'
import type { TmProgram } from '../../src/types'
import { inertEvents } from './harness'

/**
 * A TM view built by hand: a host `box.width` by `box.height` px at the end of the page, the view mounted in it with
 * inert events, and `program` set on it with `tapes` as its tapes' names. The caller renders each frame it shows
 * (`pane.render(frame, controls)`).
 *
 * **A STATE BILLED TO AN INSTRUCTION HAS THAT INSTRUCTION'S LINE IN THE LISTING**, as in every program the app
 * compiles, whose `instr` indexes the listing it was built from. A state billed to none, as the core builds `halt`,
 * `overflow` and the shared return handler, is a runtime routine's (`state-groups.ts`). A state billed past the
 * listing is a shape no program reaches, so it throws.
 */
export function mountTmFixture(
  program: TmProgram,
  tapes: string[],
  box: { width: number; height: number },
): { host: HTMLElement; pane: TmPane } {
  const unlisted = program.states.filter((s) => s.instr !== null && s.instr >= program.listing.length)
  if (unlisted.length > 0) {
    throw new Error(`states billed past the listing: ${unlisted.map((s) => s.name).join(', ')}`)
  }
  const host = document.createElement('section')
  host.className = 'pane'
  host.dataset.kind = 'tm'
  host.style.width = `${box.width}px`
  host.style.height = `${box.height}px`
  document.body.append(host)
  const pane = new TmPane(host, inertEvents())
  pane.setProgram(program, tapes)
  return { host, pane }
}
