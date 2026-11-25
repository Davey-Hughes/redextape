import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import init, { compile as build } from '../../../pkg/redextape_wasm.js'
import initClif, { ClifSession } from '../../../pkg-clif/redextape_clif_wasm.js'
import type { ClifListing } from '../../src/types'
import { FAULT_CASES, madeBy } from '../node/clif-fault-fixture'
import { compile, host, PREFIX, SHELL, until } from './harness'

/**
 * A CLIF run that a fault stopped, read at its end in the app's values panel. The runtime has stopped when the
 * caller's `cons` or box runs, so that call allocates nothing and its word is a plain 0, as every read in the same
 * state is. Each case's control, the same call with no fault before it, reads as the list or box it makes on the row
 * the fault case reads, which shows that row is the call's own. The controls run after the fault cases, so a fault
 * case cannot pass on a `0` that a control's run left in the panel.
 */

let view: EditorView

const clif = () => host('clif-0') as HTMLElement
const stepOf = () => clif().querySelector('.step')?.textContent ?? ''
/** The values panel's rows by value name, each text without the registers after it. */
const values = (): Map<string, string> =>
  new Map(
    [...clif().querySelectorAll<HTMLElement>('.rxm-register')].map((r) => [
      r.querySelector('dt')?.textContent ?? '',
      r.querySelector('dd')?.firstChild?.textContent ?? '',
    ]),
  )

/** The name of the value `src`'s as-built listing, the one the CLIF view opens on, sets with runtime import `index`. */
function madeIn(src: string, index: number): string {
  const { session } = build(src, 'unary') as { session: { clifInput(): unknown; free(): void } | null }
  if (session === null) throw new Error(`no session for ${src}`)
  const stepper = new ClifSession(session.clifInput(), 'as-built')
  const made = `v${madeBy(stepper.listing() as ClifListing, index)}`
  stepper.free()
  session.free()
  return made
}

/** `src` put into the editor, built, and its CLIF run stepped to its end: the values panel's rows there. */
async function shownAtEnd(src: string): Promise<Map<string, string>> {
  await compile(view, src)
  await until(() => /^step 0 of \d/.test(stepOf()), 'the CLIF view to record the run')
  await userEvent.click(clif().querySelector('.controls .to-newest') as HTMLButtonElement)
  await until(() => /^step (\d+) of \1\b/.test(stepOf()), "the CLIF view to reach the run's end")
  return values()
}

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await init()
  await initClif()
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a CLIF view')
}, 30_000)

describe('a CLIF run a fault stopped', () => {
  it.each(FAULT_CASES)('shows %s made after the fault as a plain 0', async (_, src, index) => {
    const made = madeIn(src, index)
    const shown = await shownAtEnd(src)
    expect(shown.has(made), `precondition: the values panel shows ${made}`).toBe(true)
    expect(shown.get(made), `${made}, the value the call set`).toBe('0')
  })
})

describe('the same call with no fault before it', () => {
  it.each(FAULT_CASES)(
    'shows %s as the list or box it made, on the row the fault case reads',
    async (_, src, index, control, text) => {
      const made = madeIn(control, index)
      expect(made, 'the row the fault case reads').toBe(madeIn(src, index))
      const shown = await shownAtEnd(control)
      expect(shown.get(made), `${made}, the value the call set`).toBe(text)
    },
  )
})
