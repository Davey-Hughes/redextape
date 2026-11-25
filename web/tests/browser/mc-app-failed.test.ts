import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { hearSessionWorkers } from './clif-fixture'
import { compile, host, PREFIX, SHELL, until } from './harness'
import { codePanelOf, codeRows, mcLoads } from './mc-fixture'

/**
 * A machine code panel whose package fails to load (machine code panel design §4, *Loading and failure*): it says so
 * with a Retry, and Retry loads it, the panel saying it is loading while the package comes, then showing its rows.
 * **A FILE ALONE**, for `clif-app-failed.test.ts`'s reason: the session worker keeps a package it has loaded, so the
 * failure needs a page whose worker has loaded none, and opening the panel here is what makes the first request.
 */

/** What every request for x86-64's package asks for. */
const X86 = 'pkg-mc-x86-64/redextape_mc_wasm'

const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''

let ear: ReturnType<typeof hearSessionWorkers>
let view: EditorView

const clif = () => host('clif-0') as HTMLElement
const notice = () => codePanelOf(clif()).querySelector<HTMLElement>('.mc-notice')
/** The notice's sentence, without the label of the button after it. */
const sentence = () => notice()?.firstChild?.textContent ?? ''
const retry = () => codePanelOf(clif()).querySelector<HTMLButtonElement>('.mc-retry')
/** Whether `el` draws a box of its own, and is not made invisible. */
const drawn = (el: HTMLElement | null) => {
  const box = el?.getBoundingClientRect()
  return (
    el !== null && box !== undefined && box.width > 0 && box.height > 0 && getComputedStyle(el).visibility === 'visible'
  )
}

beforeAll(async () => {
  ear = hearSessionWorkers()
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await compile(view, FACT)
}, 30_000)

// THE HOLD AND THE ABORT ARE DROPPED IF NO REQUEST SPENT THEM, since either would keep back or abort the next x86-64
// request any file in this tab makes.
afterAll(async () => {
  ear.restore()
  await commands.releaseRequests()
  await commands.failRequests(X86, 0)
})

it('says the load failed, and on Retry says it is loading, then shows the rows', async () => {
  expect(
    mcLoads(ear.heard),
    'precondition: no machine code load was asked for or started before the failure was armed',
  ).toEqual([])
  await commands.failRequests(X86, 1)
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a clif view')
  await until(() => clif().querySelector('.clif-row.is-next') !== null, 'the clif view at its step 0')
  await userEvent.click(codePanelOf(clif()).querySelector('.panel-toggle') as HTMLElement)
  await until(() => sentence() === 'machine code could not be loaded.', 'the panel to say the load failed')
  expect(drawn(notice()), 'the notice drawn').toBe(true)
  expect(retry()?.textContent).toBe('Retry')
  expect(drawn(retry()), 'Retry drawn').toBe(true)
  expect(codeRows(clif()), 'rows beside the failure').toEqual([])

  // HELD, so that the panel's word for the load under way is certainly drawn, not raced.
  await commands.holdRequests(X86)
  await userEvent.click(retry() as HTMLButtonElement)
  await until(() => sentence() === 'Loading machine code…', 'the panel to say it is loading')
  expect(drawn(notice()), 'the loading notice drawn').toBe(true)
  expect(retry(), 'Retry while loading').toBeNull()
  await commands.releaseRequests()
  await until(() => codeRows(clif()).length > 0, 'Retry to load the package and the panel to show rows')
  expect(notice(), 'a notice beside the rows').toBeNull()
  expect(drawn(codeRows(clif())[0] ?? null), 'a row drawn').toBe(true)
}, 30_000)
