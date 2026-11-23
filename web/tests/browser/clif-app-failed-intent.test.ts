import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { CLIF_MATCH, hearSessionWorkers, repliesOf, requestsOf } from './clif-fixture'
import { compile, host, PREFIX, SHELL, toggle, until } from './harness'

/**
 * A load the CLIF toggle asks for after one that failed (CLIF view design §4, *Loading and failure*): the view shown
 * says the load failed, the pointer comes to rest on the toggle, and the listing follows the load that rest asks for,
 * as it follows Retry. **A FILE ALONE**, for `clif-app-failed.test.ts`'s reason: the failure needs a page whose worker
 * has made no load, and the load after it is kept, so no other case can come before or after this one.
 */

const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''

let ear: ReturnType<typeof hearSessionWorkers>
let view: EditorView

const clif = () => host('clif-0') as HTMLElement
const notice = () => clif().querySelector<HTMLElement>('p.clif-notice')
/** The notice's sentence, without the label of the button after it. */
const sentence = () => notice()?.firstChild?.textContent ?? ''
const retry = () => clif().querySelector<HTMLButtonElement>('button.clif-retry')
const row = () => clif().querySelector<HTMLElement>('.clif-row')
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
  await compile(view, FACT)
}, 30_000)

afterAll(() => ear.restore())

it('lists the program once a load the toggle asks for follows a failed one', async () => {
  await commands.failRequests(CLIF_MATCH, 1)
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a CLIF view')
  await until(() => sentence() === 'clif could not be loaded.', 'the CLIF view to say the load failed')
  expect(drawn(retry()), 'precondition: the failed view offers Retry').toBe(true)

  const mark = ear.heard.length
  await userEvent.hover(toggle('clif'))
  await until(
    () => requestsOf(ear.heard.slice(mark), 'clif-load').length > 0,
    'the rest on the toggle to ask for a load',
  )
  await until(
    () => repliesOf(ear.heard.slice(mark), 'clif-load').some((r) => r.state === 'ready'),
    'the load the toggle asked for to answer ready',
  )
  // **THE LOAD IS IN, SO A VIEW STILL SAYING IT LOADS SAYS IT OF NOTHING**, and offers no Retry to end it.
  await until(() => sentence() !== 'Loading clif…', 'the loading notice to end once the load it names is in')
  await until(() => row() !== null, 'the CLIF listing to follow the load')
  expect(drawn(row())).toBe(true)
  expect(notice()).toBeNull()
  // **THE LOAD IS ASKED FOR BEFORE THE LISTING** (`askClifLoad`), so the worker starts it first and the listing's own
  // load shares it or follows it. Asked the other way round, the two share one fetch here and the listing comes all
  // the same, so only the order of the posts shows it.
  const asked = ear.heard
    .slice(mark)
    .flatMap((h) =>
      'request' in h && (h.request.kind === 'clif-load' || h.request.kind === 'clif') ? [h.request.kind] : [],
    )
  expect(asked, 'what the rest on the toggle asked the worker for, in order').toEqual(['clif-load', 'clif'])
}, 30_000)
