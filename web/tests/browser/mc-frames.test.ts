import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import type { Listing, RunReply } from '../../src/protocol'
import { hearSessionWorkers, repliesOf } from './clif-fixture'
import { everyFrame, host, hostKind, PREFIX, pickBinding, SHELL, stateIdle, until } from './harness'

/**
 * **THE MACHINE CODE PANEL CHANGES WITH THE LISTING, NOT BEFORE IT AND NOT AFTER** (machine code panel design §4,
 * *When there is none*): through a keystroke's compile, no frame shows the old program's listing beside a panel that
 * has dropped the old program's code; through a listing switch, every frame shows the old listing beside the old code
 * or the new listing beside the new code. Each frame is read as the user reads it: how many rows the listing has, and
 * how many the panel has, or what it says instead. Each program and listing has a row count of its own in both.
 */

const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
/** `FACT` with one more addition in `$main`: more clif rows and more machine code rows. */
const FACT_PLUS = `${FACT.trimEnd()} + 1\n`
/** Each long case's own bound, past every wait in it. */
const CASE_MS = 60_000

let ear: ReturnType<typeof hearSessionWorkers>
let view: EditorView

const clif = () => host('clif-0') as HTMLElement
const code = () => clif().querySelector<HTMLElement>('.panel[data-panel="code"]') as HTMLElement
const choice = (listing: Listing) =>
  clif().querySelector<HTMLButtonElement>(`.view-actions [role="radiogroup"] button[data-value="${listing}"]`)

/** What a box of rows shows: its row count while it draws rows, else `none`. */
const rowsOf = (box: HTMLElement | null): string =>
  box !== null && box.querySelector('.clif-row') !== null ? `rows ${box.getAttribute('aria-rowcount')}` : 'none'

/** What the listing and the panel show in one frame: each one's rows, or the panel's words instead. */
function seen(): { readonly listing: string; readonly panel: string } {
  const notice = code().querySelector<HTMLElement>('.mc-notice')
  return {
    listing: rowsOf(clif().querySelector<HTMLElement>('[data-panel="listing"] .clif-listing')),
    panel: notice?.isConnected ? `says ${notice.textContent}` : rowsOf(code().querySelector('.mc-listing')),
  }
}

/** Put `text` in the editor and wait for its compile. */
async function program(text: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  await until(() => !stateIdle(), 'the compile to start')
  await until(stateIdle, 'the compile to finish')
}

/** Both the listing and the panel showing rows, and the same rows for a few frames. */
async function settled(): Promise<{ readonly listing: string; readonly panel: string }> {
  let last = ''
  let same = 0
  await until(() => {
    const now = seen()
    const key = `${now.listing} | ${now.panel}`
    same = key === last ? same + 1 : 0
    last = key
    return now.listing !== 'none' && now.panel.startsWith('rows') && same >= 5
  }, 'the listing and the panel to show rows and settle')
  return seen()
}

beforeAll(async () => {
  ear = hearSessionWorkers()
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
  await program(FACT)
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a clif view')
  await until(() => repliesOf(ear.heard, 'clif-listing').length > 0, 'the listing')
  await userEvent.click(code().querySelector('.panel-toggle') as HTMLElement)
  await settled()
}, 60_000)

afterAll(() => ear.restore())

describe('the machine code panel', () => {
  it(
    'keeps the old program’s code while the listing shows the old program, through a keystroke’s compile',
    async () => {
      const before = await settled()
      const frames = everyFrame(seen)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: FACT_PLUS } })
      await until(() => seen().listing !== before.listing, 'the new listing')
      const after = await settled()
      frames.stop()
      expect(after.listing, 'precondition: the new program’s listing has rows of its own').not.toBe(before.listing)
      expect(after.panel, 'precondition: the new program’s code has rows of its own').not.toBe(before.panel)
      const dropped = frames.seen.filter((f) => f.listing === before.listing && f.panel !== before.panel)
      expect(dropped, 'frames with the old listing beside anything but its code').toEqual([])
      const early = frames.seen.filter((f) => f.listing !== after.listing && f.panel === after.panel)
      expect(early, 'frames with the new code beside anything but its listing').toEqual([])
    },
    CASE_MS,
  )

  it('changes in the frame the listing changes in, through a listing switch', async () => {
    const before = await settled()
    const frames = everyFrame(seen)
    await userEvent.click(choice('optimised') as HTMLButtonElement)
    await until(() => seen().listing !== before.listing, 'the optimised listing')
    const after = await settled()
    frames.stop()
    expect(after.listing, 'precondition: the optimised listing has rows of its own').not.toBe(before.listing)
    expect(after.panel, 'precondition: the optimised code has rows of its own').not.toBe(before.panel)
    const apart = frames.seen.filter(
      (f) =>
        (f.listing === before.listing) !== (f.panel === before.panel) ||
        (f.listing === after.listing) !== (f.panel === after.panel),
    )
    expect(apart, 'frames where the listing and the panel show different listings').toEqual([])
  })

  /**
   * **THE WORKER'S REPLIES ARE KEPT FROM THE PAGE FROM THE PRESS, BUT FOR THE NEW LISTING'S CODE**, so the switch holds
   * the old listing with that code in, however long the gestures take; the rxm view is then made a clif view, a view
   * seeded from the listing the switch holds. The code is asked for at the press unless this generation has it already.
   */
  it(
    'shows the old listing’s code and title in a clif view built while a switch holds the old listing',
    async () => {
      const before = await settled()
      const from: Listing = choice('optimised')?.getAttribute('aria-checked') === 'true' ? 'optimised' : 'as-built'
      const to: Listing = from === 'optimised' ? 'as-built' : 'optimised'
      const title = (view: HTMLElement) => view.querySelector('[data-panel="code"] .mc-title')?.textContent ?? ''
      const was = title(clif())
      ear.hold()
      try {
        await userEvent.click(choice(to) as HTMLButtonElement)
        await until(() => ear.kept().some((r) => r.kind === 'clif-listing'), 'the new listing, kept')
        const code = (r: RunReply) => r.kind === 'mc' && r.listing === to
        if (ear.kept().some(code)) await ear.release(code)
        pickBinding('rxm-0', 'clif:source')
        await until(() => hostKind('rxm-0') === 'clif', 'the rxm view to be a clif view')
        const built = host('rxm-0') as HTMLElement
        const panel = built.querySelector<HTMLElement>('[data-panel="code"]') as HTMLElement
        await userEvent.click(panel.querySelector('.panel-toggle') as HTMLElement)
        await until(() => panel.querySelector('.mc-listing .clif-row') !== null, 'the built view’s panel to show rows')
        expect(
          rowsOf(built.querySelector('[data-panel="listing"] .clif-listing')),
          'precondition: the switch still holds the old listing, in the view built',
        ).toBe(before.listing)
        expect(title(built), 'the title').toBe(was)
        expect(rowsOf(panel.querySelector('.mc-listing')), 'the code').toBe(before.panel)
      } finally {
        await ear.release()
      }
    },
    CASE_MS,
  )
})
