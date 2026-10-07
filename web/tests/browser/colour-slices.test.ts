import { EditorView } from '@codemirror/view'
import { afterAll, describe, expect, it } from 'vitest'
import { Parser } from 'web-tree-sitter'
import { classMapFrom, createGrammarRegistry, FIRST_SCREEN_UNITS, treeSitterColour } from '../../src/colour'
import { until } from './harness'

/**
 * **A PARSE IN SLICES, ON A REAL EDITOR AND THE REAL CLOCK.**
 *
 * `tests/node/colour.test.ts` holds what the colourer does when a parse outlasts one slice, over a stubbed view, a
 * counter for a clock and Vitest's timers. Three things there are stand-ins, and this file is where they are not: the
 * slice is timed by `performance.now`, its continuation waits on a browser timer, and the recompute the plugin asks
 * for when the tree lands goes through a mounted `EditorView` to the DOM a user reads.
 *
 * **ONE EDITOR AND NO APP, SO THAT NOTHING ELSE IS ON THE PAGE'S MAIN THREAD.** The copy of a machine that this was
 * found on mounts while two workers record, and their replies take turns with the slices: at `CPUQuota=25%` the tree
 * had not landed when both recordings ended, 13 s on. `colour-slices-fork.test.ts` is that page, and it waits for
 * nothing that comes after the mount. Here the parse is the only work there is.
 *
 * **566,779 UNITS, 57 TO 67 ms OF PARSING ON THIS MACHINE AGAINST A SLICE OF 8.** A parse of 1,518,470 units in one go
 * measured 154 to 179 ms in this tier's Chromium (2026-10-06), 8,500 to 9,900 units a millisecond. Each case asserts
 * that the parse was still pending when its first slice returned, and the rest of the case rests on that: a runner
 * that parsed this text inside one slice would fail there, by name.
 *
 * **EVERY `parse` THE PAGE MAKES IS RECORDED, BY WRAPPING `Parser.prototype.parse` BEFORE THE EDITOR EXISTS.** A call
 * with a progress callback is a slice, and one that returns `null` is a slice that did not finish the parse. What the
 * editor shows when the first slice returns is read in a microtask queued from the wrapper: that runs when the update
 * the slice ran in has returned, so the DOM is as that update left it, and before any timer, so no later slice has run.
 */

type Call = { units: number; sliced: boolean; finished: boolean }
const calls: Call[] = []
/** Run once, in a microtask, after the first slice of a parse, whether or not it finished the parse. */
let afterFirstSlice: (() => void) | null = null
const parse = Parser.prototype.parse
Parser.prototype.parse = function (this: Parser, ...args: Parameters<Parser['parse']>) {
  const tree = parse.apply(this, args)
  const call = {
    units: typeof args[0] === 'string' ? args[0].length : -1,
    sliced: args[2]?.progressCallback !== undefined,
    finished: tree !== null,
  }
  calls.push(call)
  if (call.sliced && afterFirstSlice !== null) {
    queueMicrotask(afterFirstSlice)
    afterFirstSlice = null
  }
  return tree
}
afterAll(() => {
  Parser.prototype.parse = parse
})

/** A one-tape machine of `states` states in the TM text form: three lines to a state, every line a whole item. */
const machine = (states: number): string => {
  let out =
    'tapes 1\nstart s0\nversion 1\nencoding unary\nwidth 8\nslots 1\nresult Nat\ntape 0 #________#\n\nstate halt: accept\n'
  for (let i = 0; i < states; i++) {
    const next = i + 1 < states ? `s${i + 1}` : 'halt'
    out += `state s${i}:\n  [1] -> write [_], move [R], goto ${next}\n  [_] -> write [1], move [L], goto s${i}\n`
  }
  return out
}
const STATES = 6_000
const MACHINE = machine(STATES)

/** The three TM rows these cases read, as `redextape-core`'s `capture_map` has them. */
const CLASSES = classMapFrom([
  [
    'redextape_tm',
    [
      ['keyword', 'Keyword'],
      ['label', 'Label'],
      ['label.reference', 'StateName'],
    ],
  ],
])

/** What an editor showed when the update its first slice ran in had returned. */
type AtFirstSlice = { tokens: number; landed: boolean }

describe('a parse that outlasts one slice, in a mounted editor', () => {
  const tokensOf = (view: EditorView): HTMLElement[] => [
    ...view.contentDOM.querySelectorAll<HTMLElement>('[class^="tok-"]'),
  ]
  const sliced = (): Call[] => calls.filter((c) => c.sliced && c.units === MACHINE.length)
  const landed = (): boolean => sliced().some((c) => c.finished)

  /**
   * An editor on `MACHINE`, showing its start or its end, whose first slice has run.
   *
   * **THE GRAMMAR IS HELD BACK UNTIL THE EDITOR SHOWS WHAT THE CASE WANTS IT TO.** The plugin parses when its grammar
   * arrives, and a scroll is drawn a frame after it is asked for, so an editor sent to its end at once could meet its
   * grammar on either side of that frame. `open` is what lets the registry answer.
   */
  const mounted = async (where: 'start' | 'end'): Promise<{ view: EditorView; first: AtFirstSlice }> => {
    calls.length = 0
    const failures: string[] = []
    const registry = createGrammarRegistry({
      onFailure: (id, reason) => failures.push(`${id}: ${reason}`),
      onRuntimeFailure: (reason) => failures.push(reason),
    })
    let open: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const host = document.createElement('div')
    document.body.replaceChildren(host)
    const view = new EditorView({
      doc: MACHINE,
      parent: host,
      extensions: [
        // A FIXED HEIGHT AND ITS OWN SCROLLER, so the editor draws a screen of lines and a scroll moves it.
        EditorView.theme({ '&': { height: '320px' }, '.cm-scroller': { overflow: 'auto' } }),
        treeSitterColour({
          languageId: 'redextape_tm',
          registry: { load: (id) => gate.then(() => registry.load(id)) },
          classes: () => CLASSES,
          onCeiling: (id) => failures.push(`${id}: over the ceiling`),
        }),
      ],
    })
    if (where === 'end') {
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.length) })
      await until(() => view.viewport.to === view.state.doc.length, 'the editor to show the end of the text')
    }
    expect(view.viewport.from === 0, `precondition: the editor shows the text’s ${where}`).toBe(where === 'start')
    let first: AtFirstSlice | null = null
    afterFirstSlice = () => {
      first = { tokens: tokensOf(view).length, landed: landed() }
    }
    open()
    await until(() => first !== null || failures.length > 0, 'the first slice of the parse to return')
    expect(failures, 'precondition: the grammar loaded').toEqual([])
    return { view, first: first as unknown as AtFirstSlice }
  }

  it('colours the first screen in the update its first slice runs in, and resumes one parse to its end', async () => {
    expect(MACHINE.length).toBe(566_779)
    const { view, first } = await mounted('start')
    expect(first.landed, 'precondition: the parse was pending when that update returned').toBe(false)
    expect(first.tokens).toBeGreaterThan(0)
    expect(tokensOf(view)[0]?.textContent).toBe('tapes')

    await until(landed, 'the whole parse to land')
    const runs = sliced()
    expect(runs.length, 'precondition: one slice did not parse this text').toBeGreaterThan(1)
    // ONE PARSE, RESUMED: every slice but the last returned with the parse unfinished.
    expect(runs.map((c) => c.finished)).toEqual([...runs.slice(1).map(() => false), true])
    // AND NOTHING LONGER THAN THE FIRST SCREEN'S BOUND WENT TO THE PARSER IN ONE GO.
    for (const c of calls.filter((x) => !x.sliced))
      expect(c.units, JSON.stringify(c)).toBeLessThanOrEqual(FIRST_SCREEN_UNITS)
    view.destroy()
  })

  it('shows the end of the text plain until the whole parse lands, colours it then, and keeps it coloured', async () => {
    const { view, first } = await mounted('end')
    expect(first.landed, 'precondition: the parse was pending when that update returned').toBe(false)
    // 566,779 UNITS IN IS PAST ANY FIRST SCREEN: plain, and nothing parsed in one go to make it otherwise.
    expect(first.tokens).toBe(0)
    expect(calls.filter((c) => !c.sliced)).toEqual([])

    // THE CASE DISPATCHES NOTHING FROM HERE ON, so what colours the end is the recompute the plugin asks for when its
    // tree lands. The last state's name is a `goto` target on the text's last line, which nothing but the whole tree
    // can colour.
    const last = `s${STATES - 1}`
    const target = (): HTMLElement | undefined =>
      tokensOf(view).find((t) => t.classList.contains('tok-statename') && t.textContent === last)
    await until(() => target() !== undefined, 'the last state’s name to be coloured as a `goto` target')
    expect(landed()).toBe(true)
    const token = target()
    if (token === undefined) throw new Error('the token went away between the wait and the read')
    expect(getComputedStyle(token).color).not.toBe(getComputedStyle(view.contentDOM).color)

    // **AND ONCE COLOURED IT STAYS COLOURED THROUGH A TRANSACTION OF SEVERAL CHANGES**, which has no tree to edit and
    // parses the whole text again. In slices, as this branch first had it, the tree was gone while they ran and this
    // screen went plain; in one go the update returns with it coloured. Two comment lines, on either side of the
    // screen's last lines, read back in the same task as the dispatch.
    const length = view.state.doc.length
    const above = view.state.doc.lineAt(length - 400).from
    view.dispatch({
      changes: [
        { from: above, insert: '; one\n' },
        { from: length, insert: '; two\n' },
      ],
    })
    expect(view.viewport.to, 'precondition: the editor still shows the end of the text').toBe(view.state.doc.length)
    expect(tokensOf(view).length).toBeGreaterThan(0)
    expect(target(), 'the last state’s name is still a coloured `goto` target').not.toBeUndefined()
    view.destroy()
  })
})
