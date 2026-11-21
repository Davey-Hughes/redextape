import type { EditorView } from '@codemirror/view'
import { beforeAll, expect, it } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { CLIF_MATCH } from './clif-fixture'
import { compile, host, PREFIX, SHELL, until } from './harness'

/**
 * A CLIF view whose package fails to load (CLIF view design §4, *Loading and failure*): it says so with a Retry, the
 * other views go on, and Retry loads it. **A FILE ALONE**: the session worker memoises a load it has made, so the
 * failure needs a page whose worker has made none, and 5 here is what makes the first request.
 */

const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''

let view: EditorView

const clif = () => host('clif-0') as HTMLElement
const rxm = () => host('rxm-0') as HTMLElement
const stepOf = (pane: HTMLElement) => pane.querySelector('.step')?.textContent ?? ''
const notice = () => clif().querySelector<HTMLElement>('p.clif-notice')
/** The notice's sentence, without the label of the button after it. */
const sentence = () => notice()?.firstChild?.textContent ?? ''
const retry = () => clif().querySelector<HTMLButtonElement>('button.clif-retry')
/** Whether `el` draws a box of its own. */
const drawn = (el: HTMLElement | null) => {
  const box = el?.getBoundingClientRect()
  return box !== undefined && box.width > 0 && box.height > 0
}

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await compile(view, FACT)
}, 30_000)

it('says the load failed, and loads on Retry', async () => {
  await commands.failRequests(CLIF_MATCH, 1)
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a CLIF view')
  await until(() => sentence() === 'CLIF could not be loaded.', 'the CLIF view to say the load failed')
  expect(drawn(notice())).toBe(true)
  expect(retry()?.textContent).toBe('Retry')
  expect(drawn(retry())).toBe(true)

  // THE RXM VIEW STILL STEPS.
  await until(() => stepOf(rxm()).startsWith('step 0 of'), 'the rxm view to stand at step 0')
  const forward = [...rxm().querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === '▶')
  await userEvent.click(forward as HTMLButtonElement)
  await until(() => stepOf(rxm()).startsWith('step 1 of'), 'the rxm view to step')

  await userEvent.click(retry() as HTMLButtonElement)
  await until(() => clif().querySelector('.clif-row') !== null, 'Retry to load the CLIF listing')
  expect(notice()).toBeNull()
}, 30_000)
