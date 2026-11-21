import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { CLIF_MATCH, clifStopped, hearSessionWorkers, repliesOf, requestsOf, THROWN, throwing } from './clif-fixture'
import { compile, host, PREFIX, resultsText, SHELL, until } from './harness'

/**
 * A CLIF stepper that throws once its run is in the readout: the CLIF view says why, and the readout says nothing more
 * of the CLIF leg, though no `result` follows the throw. **A FILE ALONE**, for `clif-app-failed.test.ts`'s reason: the
 * session worker keeps the package it loads, so the stub must answer this page's first load.
 */

/** `clif-worker.test.ts`'s `LOOP_SHORT`, whose first fill as built stops on its budget, so the view offers to go on. */
const LOOP_SHORT = 'let mut i = 0; let mut acc = 0; while i < 600 { acc = acc + i; i = i + 1; } acc'

let ear: ReturnType<typeof hearSessionWorkers>
let view: EditorView

const clif = () => host('clif-0') as HTMLElement
/** The notice's sentence, without the label of any button after it. */
const sentence = () => clif().querySelector<HTMLElement>('p.clif-notice')?.firstChild?.textContent ?? ''
const more = () => clif().querySelector<HTMLButtonElement>('.controls button.extend')
/** Whether `el` draws a box of its own. */
const drawn = (el: HTMLElement | null) => {
  const box = el?.getBoundingClientRect()
  return box !== undefined && box.width > 0 && box.height > 0
}

beforeAll(async () => {
  ear = hearSessionWorkers()
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await compile(view, LOOP_SHORT)
}, 30_000)

afterAll(async () => {
  ear.restore()
  await commands.stubRequest(CLIF_MATCH, null)
})

it('takes the CLIF leg out of the readout when its stepper throws as a continue is asked', async () => {
  // THE STATUS ANSWERS ONCE, for the `result` after the first fill, and throws as the continue asks where the run
  // stopped.
  await commands.stubRequest(CLIF_MATCH, throwing('status', 1))
  const mark = ear.heard.length
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a CLIF view')
  await until(() => requestsOf(ear.heard.slice(mark), 'clif').length > 0, 'the clif request 5 posts')
  const epoch = requestsOf(ear.heard.slice(mark), 'clif')[0]?.epoch ?? -1
  await until(() => clifStopped(ear.heard.slice(mark), epoch), "the CLIF leg's first fill")
  await until(() => resultsText().includes('CLIF'), "the CLIF pass's result in the readout")
  expect(drawn(more()), 'precondition: the first fill stopped short, so the view offers a continue').toBe(true)

  await userEvent.click(more() as HTMLButtonElement)
  await until(() => sentence() === `No CLIF for this program: ${THROWN}`, 'the CLIF view to say what the stepper threw')
  // THE CASE'S PRECONDITION: the throw was the continue's, which posts no `result` of its own. The throw's
  // `clif-listing` and anything the continue posts after it go out in one task, so `caughtUp` is answered after them.
  const refused = ear.heard.findIndex(
    (h) => 'reply' in h && h.reply.kind === 'clif-listing' && h.reply.listing === null,
  )
  expect(refused, "precondition: the throw's clif-listing was heard").toBeGreaterThanOrEqual(0)
  await ear.caughtUp()
  expect(repliesOf(ear.heard.slice(refused), 'result'), 'precondition: no result follows the throw').toEqual([])
  expect(resultsText(), 'the readout once the stepper is dropped').not.toContain('CLIF')
}, 30_000)
