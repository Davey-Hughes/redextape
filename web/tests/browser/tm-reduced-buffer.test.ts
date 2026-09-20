import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import FIXTURE from '../../../crates/redextape-core/tests/fixtures/five_minus_three_single_tape.tm?raw'
import { VALUE_CHUNK } from '../../src/protocol'
import { bindingKey } from '../../src/view-header'
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

const tmLeaves = () =>
  [...document.querySelectorAll<HTMLElement>('[data-kind="tm"]')].map((el) => el.dataset.leaf ?? '')

/**
 * Split `leaf` through its `⋯` menu, as a user does: `pick` is `'same'` (another view of this), `'source'`,
 * or a `bindingKey(leg, session)` — `pane-picker.test.ts`'s `splitVia`, restated for the reason every
 * browser file restates its helpers.
 */
function splitVia(leaf: string, dir: 'row' | 'column', pick: string): void {
  const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-more`)
  if (more === null) throw new Error(`no view menu on [data-leaf="${leaf}"]`)
  more.click()
  const menu = document.getElementById(more.getAttribute('aria-controls') ?? '')
  menu?.querySelector<HTMLButtonElement>(`button.view-split[data-dir="${dir}"]`)?.click()
  const selector =
    pick === 'same' ? 'button[data-same]' : pick === 'source' ? 'button[data-source]' : `button[data-binding="${pick}"]`
  const item = menu?.querySelector<HTMLButtonElement>(`.view-menu-pairs ${selector}`)
  if (item == null) {
    const offered = [...(menu?.querySelectorAll<HTMLButtonElement>('.view-menu-pairs button') ?? [])].map(
      (b) => b.textContent,
    )
    throw new Error(`[data-leaf="${leaf}"] offers no ${pick} to split into — offered: ${offered.join(' | ')}`)
  }
  item.click()
}

beforeAll(async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')

  document.querySelector<HTMLButtonElement>('#buffers')?.click()
  document.querySelector<HTMLButtonElement>('.buffer-list button.new-tm')?.click()
  const title = leaf('tm-0').querySelector<HTMLButtonElement>('button.view-title')
  if (title === null) throw new Error('no title-selector on the TM view')
  const item = () =>
    document
      .getElementById(title.getAttribute('aria-controls') ?? '')
      ?.querySelector<HTMLButtonElement>(`button[data-binding="${bindingKey('tm', 'scratch-1')}"]`)
  // THE MENU IS BUILT ON OPEN, so the wait opens it and reads it; a closed menu has no items to offer.
  await until(() => {
    const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
    if (menu?.matches(':popover-open') === true) menu.hidePopover()
    title.click()
    return item() != null
  }, 'the buffer to be offered')
  item()?.click()
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
    splitVia('tm-0', 'row', 'same')
    await until(() => tmLeaves().length === before.length + 1, 'the split to add a TM pane')
    const created = tmLeaves().find((id) => !before.includes(id))
    if (created === undefined) throw new Error('the split added no TM pane')
    expect(statusOf(created)).toContain('reduced: single-tape · 241,666 steps')
    expect(valueLineOf(created)?.textContent).toBe('value: 2')
  })

  /**
   * **ONE WHOLE RECORDING PER SCOPE.** `runValueLoop` starts only once a build's first recording has ended, so every
   * wait here on a spinner or on the fixture is a whole recording: measured on 2026-09-19, 1.5 to 2.2 s unconstrained
   * and 3.4 to 6.0 s under a 75% CPU quota. The supersession test once waited on three in one body, and on the slower
   * of the two CI runners Vitest's 15,000 ms cap fired before any of the three could fail under its own name, the case
   * `until`'s doc in `harness.ts` warns of: its bound holds per wait, and Vitest's per test. So the spinner starts in
   * `beforeEach` and the fixture comes back in `afterEach`, each under its own hook timeout, and no body below waits on
   * more than one recording.
   *
   * **THE SEQUENCE IS THE ONE EACH TEST USED TO RUN ITSELF.** Every test still pastes over a spinner whose value run
   * has reported and leaves the fixture settled for the next, so none of them depends on which ran before it.
   */
  describe('over a spinner whose value run is still going', () => {
    beforeEach(async () => {
      paste('tm-0', SPINNER)
      await until(
        () => valueLineOf('tm-0')?.textContent?.endsWith('of 1,000,000,000 steps') ?? false,
        'the spinner to report',
      )
    })

    // AND BACK TO THE FIXTURE, so no test ends with a value run still spinning. Every test here starts from a busy
    // line, so every one is also held to a settled value clearing it.
    afterEach(async () => {
      paste('tm-0', FIXTURE)
      await until(() => valueLineOf('tm-0')?.textContent === 'value: 2', 'the fixture to read 2 again')
      expect(valueLineOf('tm-0')?.hasAttribute('aria-busy')).toBe(false)
    })

    /**
     * **THE SECOND BUILD IS ANOTHER LONG RUN, AND ITS FIRST COUNT IS THE EVIDENCE.** A stale loop that re-reads `live`
     * would step the new build's run, and the generation check at the top of each chunk is what ends it. Without the
     * check, the stale loop takes one `VALUE_CHUNK` of the new run at every yield of the new build's first recording,
     * all before the new build's own loop starts, so that loop's first report is hundreds of millions of steps in: the
     * pane's first count read 799,500,000 with the check removed. With it, nothing steps the new run before its own
     * loop, and the first report is exactly one `VALUE_CHUNK`. Were the new run to end within one chunk, a loop without
     * the check could finish it and the first report would be the right value, so the test could not tell.
     *
     * **OBSERVED, NOT SAMPLED, AS `running-focus.test.ts`'s playback test is and for its reason.** A poll lands on
     * whichever count is current, and with the check in place a poll's first sighting of a spinner read as high as
     * 98,500,000. Each `#drawValue` replaces the line's text node, so the nodes a record adds are the lines in the order
     * the pane wrote them. The wait alone was once the evidence, and it was not enough: without the check the new
     * build's first report came 9.2 to 9.3 s after the paste on an unconstrained machine, inside `until`'s bound, and
     * this test passed.
     */
    it('lets an edit supersede a value run that is still going', async () => {
      // BUSY WHILE IT RUNS, so a screen reader hears the settled value rather than every count on the way.
      expect(valueLineOf('tm-0')?.getAttribute('aria-busy')).toBe('true')
      const line = valueLineOf('tm-0')
      if (line === null) throw new Error('no value line on [data-leaf="tm-0"]')
      const counts: number[] = []
      const observer = new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes) {
            const count = /running · ([\d,]+) of 999,999,999 steps$/.exec(node.textContent ?? '')?.[1]
            if (count !== undefined) counts.push(Number(count.replaceAll(',', '')))
          }
      })
      observer.observe(line, { childList: true })
      paste('tm-0', SPINNER.replace('steps 1000000000', 'steps 999999999'))
      await until(() => counts.length > 0, 'the second spinner to report')
      observer.disconnect()
      expect(counts[0], "the new build's first report, after its own loop's first chunk and nothing else").toBe(
        VALUE_CHUNK,
      )
    })

    it('reads a machine that halts at once, pasted over a value run that is still going', async () => {
      paste('tm-0', HALTS_AT_ONCE)
      await until(() => valueLineOf('tm-0')?.textContent === 'value: 1', 'the machine that halts at once to read 1')
    })

    it('empties a value run that was still going while the text does not build', async () => {
      paste('tm-0', 'this is not a machine\n')
      await until(() => valueLineOf('tm-0')?.textContent === '', 'the running line to empty')
      expect(valueLineOf('tm-0')?.hasAttribute('aria-busy')).toBe(false)
    })
  })
})
