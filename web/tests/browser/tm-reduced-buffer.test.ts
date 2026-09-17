import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import FIXTURE from '../../../crates/redextape-core/tests/fixtures/five_minus_three_single_tape.tm?raw'
import { SHELL, until } from './harness'

/**
 * **A REDUCED `.tm` FILE IN A TM BUFFER, THROUGH THE REAL APP** — the worker's value run, the reply that carries it,
 * the pane that shows it, and the seeding a split relies on, none of which a lower tier can reach together.
 *
 * **THE FIXTURE IS `5 - 3` REDUCED TO ONE TAPE**, checked in beside `crates/redextape-core/tests/reduced_tm_file.rs`,
 * which fails if it is no longer the file `reduce` writes. Its value is 2, not 0, so a decode that read the reduced
 * tape as a lowered one cannot pass by coincidence.
 *
 * ONE BUFFER FOR THE WHOLE FILE, minted once: every sibling browser file shares its page across tests, and buffers
 * accumulate across them by design.
 */

/**
 * A reduced file that never halts: one state that stays put forever, under a header recording `MAX_REDUCED_STEPS`,
 * 1,000,000,000. **THE COUNT HAS TO BE THE CEILING.** A release build steps some 65 million a second, so a spinner
 * recording 50,000,000 finished before the first poll could see it running; this one runs for about fifteen seconds
 * in release and far longer in a dev build.
 */
const SPINNER =
  'tapes 1\nstart go\nversion 2\nencoding unary\nwidth 4\nslots 0\nresult Nat\nreduced single-tape 5\n' +
  'steps 1000000000\n\nstate go:\n  [*] -> write [*], move [S], goto go\n'

/**
 * A headered machine that accepts after one step with 1 on its REG bank: `redextape run` prints `1`. Its whole first
 * recording ends inside one `RECORD_CHUNK`, so the worker reaches its value run without ever yielding, which is the
 * build a re-entry flag held by an older, suspended value run used to turn away.
 */
const HALTS_AT_ONCE =
  'tapes 5\nstart s\nversion 1\nencoding unary\nwidth 4\nslots 1\nresult Nat\ntape 0 #1___#\n\n' +
  'state s:\n  [* * * * *] -> write [* * * * *], move [S S S S S], goto done\nstate done: accept\n'

const leaf = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-leaf="${id}"]`)
  if (el === null) throw new Error(`no pane at [data-leaf="${id}"]`)
  return el
}
const statusOf = (id: string) => leaf(id).querySelector('.tm-status')?.textContent ?? ''
const valueLineOf = (id: string) => leaf(id).querySelector<HTMLElement>('.tm-value')

/** Replace the TM pane's editor text, the way a paste does. */
function paste(id: string, text: string): void {
  const dom = leaf(id).querySelector<HTMLElement>('.cm-editor')
  if (dom === null) throw new Error(`no editor mounted in [data-leaf="${id}"]`)
  const editor = EditorView.findFromDOM(dom)
  if (editor === null) throw new Error('the editor DOM has no view')
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } })
}

/** `pane-picker.test.ts`'s `pickSplit`, restated for the reason every browser file restates its helpers. */
function pickSplit(id: string, control: string, item: string): void {
  const button = document.querySelector<HTMLButtonElement>(`[data-leaf="${id}"] button[aria-label="${control}"]`)
  if (button === null) throw new Error(`no "${control}" control on [data-leaf="${id}"]`)
  button.click()
  const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
  const items = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
  const chosen = items.find((b) => b.textContent === item)
  if (chosen === undefined) throw new Error(`no "${item}" — offered: ${items.map((b) => b.textContent).join(' | ')}`)
  chosen.click()
}

const tmLeaves = () =>
  [...document.querySelectorAll<HTMLElement>('[data-kind="tm"]')].map((el) => el.dataset.leaf ?? '')

beforeAll(async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')

  document.querySelector<HTMLButtonElement>('#buffers')?.click()
  document.querySelector<HTMLButtonElement>('.buffer-list button.new-tm')?.click()
  const select = leaf('tm-0').querySelector<HTMLSelectElement>('.pane-binding select')
  await until(() => [...(select?.options ?? [])].some((o) => o.value === 'tm\x00scratch-1'), 'the buffer to be offered')
  if (select === null) throw new Error('no binding selector on the TM pane')
  select.value = 'tm\x00scratch-1'
  select.dispatchEvent(new Event('change'))
  await until(() => leaf('tm-0').querySelector('.cm-editor') !== null, 'the buffer editor to mount')
})

describe('a reduced file in a TM buffer', () => {
  it('says it is reduced, labels its one tape, and reads its value', async () => {
    paste('tm-0', FIXTURE)
    await until(() => valueLineOf('tm-0')?.textContent === 'value: 2', 'the value run to read 2')
    expect(statusOf('tm-0')).toContain('reduced: single-tape · 241,666 steps')
    expect([...leaf('tm-0').querySelectorAll('.tape-label')].map((e) => e.textContent)).toEqual([
      '5 tapes, interleaved',
    ])
    expect(valueLineOf('tm-0')?.getAttribute('role')).toBe('status')
    expect(valueLineOf('tm-0')?.hasAttribute('aria-busy')).toBe(false)
  })

  it('seeds a TM pane split from it with the sentence and the value', async () => {
    const before = tmLeaves()
    pickSplit('tm-0', 'split left and right', 'TM · TM scratch 1 (same)')
    await until(() => tmLeaves().length === before.length + 1, 'the split to add a TM pane')
    const created = tmLeaves().find((id) => !before.includes(id))
    if (created === undefined) throw new Error('the split added no TM pane')
    expect(statusOf(created)).toContain('reduced: single-tape · 241,666 steps')
    expect(valueLineOf(created)?.textContent).toBe('value: 2')
  })

  /**
   * **THE SECOND BUILD IS ANOTHER LONG RUN, AND IT HAS TO BE.** A stale loop that re-reads `live` would step the new
   * build's run, and the generation check at the top of each chunk is what ends it. Were the new run to end within
   * one `VALUE_CHUNK`, a loop without that check could finish it and the right value would still arrive, so this test
   * could not tell the check was gone. A second spinner outlasts the stale loop, and its own count is what only the
   * new build's loop can report.
   */
  it('lets an edit supersede a value run that is still going', async () => {
    paste('tm-0', SPINNER)
    await until(
      () => valueLineOf('tm-0')?.textContent?.endsWith('of 1,000,000,000 steps') ?? false,
      'the first spinner to report',
    )
    // BUSY WHILE IT RUNS, so a screen reader hears the settled value rather than every count on the way.
    expect(valueLineOf('tm-0')?.getAttribute('aria-busy')).toBe('true')
    paste('tm-0', SPINNER.replace('steps 1000000000', 'steps 999999999'))
    await until(
      () => valueLineOf('tm-0')?.textContent?.endsWith('of 999,999,999 steps') ?? false,
      'the second spinner to report',
    )
    // AND BACK TO THE FIXTURE, so this test does not end with a value run still spinning.
    paste('tm-0', FIXTURE)
    await until(() => valueLineOf('tm-0')?.textContent === 'value: 2', 'the fixture to read 2 again')
    expect(valueLineOf('tm-0')?.hasAttribute('aria-busy')).toBe(false)
  })

  it('reads a machine that halts at once, pasted over a value run that is still going', async () => {
    paste('tm-0', SPINNER)
    await until(
      () => valueLineOf('tm-0')?.textContent?.endsWith('of 1,000,000,000 steps') ?? false,
      'the spinner to report',
    )
    paste('tm-0', HALTS_AT_ONCE)
    await until(() => valueLineOf('tm-0')?.textContent === 'value: 1', 'the machine that halts at once to read 1')
    paste('tm-0', FIXTURE)
    await until(() => valueLineOf('tm-0')?.textContent === 'value: 2', 'the fixture to read 2 again')
  })

  it('empties a value run that was still going while the text does not build', async () => {
    paste('tm-0', SPINNER)
    await until(
      () => valueLineOf('tm-0')?.textContent?.endsWith('of 1,000,000,000 steps') ?? false,
      'the spinner to report',
    )
    paste('tm-0', 'this is not a machine\n')
    await until(() => valueLineOf('tm-0')?.textContent === '', 'the running line to empty')
    expect(valueLineOf('tm-0')?.hasAttribute('aria-busy')).toBe(false)
    paste('tm-0', FIXTURE)
    await until(() => valueLineOf('tm-0')?.textContent === 'value: 2', 'the fixture to read 2 again')
  })
})
