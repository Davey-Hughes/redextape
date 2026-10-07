import { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Parser } from 'web-tree-sitter'
import { FIRST_SCREEN_UNITS } from '../../src/colour'
import { SHELL, until } from './harness'

/**
 * **THE COPY OF A 7,353-STATE MACHINE, WHOSE EDITOR HELD THE PAGE WHILE ITS TEXT WAS PARSED.**
 *
 * *Edit a copy* on the TM view of `BIG` mounts an editor on the machine's text, 1,518,470 units under the `unary`
 * encoding this tier's setup stores, and the colourer parsed all of it inside the update that first needed a tree:
 * 194 to 208 ms in this tier's Chromium with the program and then the copy recording, and from the mount the page
 * ran no timer for 232 to 249 ms and drew no frame for 216 to 232 ms, in five runs (2026-10-06). `colour.ts`'s
 * `PARSE_SLICE_MS` has what replaced that, and `tests/node/colour.test.ts` holds it.
 *
 * **THIS FILE IS THE GESTURE: THE SAME PROGRAM, COPIED AS SOON AS ITS FORK CONTROL IS OFFERED**, which today is while
 * its own run is still recording. It asserts what is true at the moment the copy's text first reaches the parser, and
 * waits for nothing after it.
 *
 * **IT DOES NOT WAIT FOR THE WHOLE TREE, AND THAT IS A MEASUREMENT.** The slices take turns with the replies of two
 * recording workers, and at `CPUQuota=25%`, which puts the browser and both workers on a quarter of one core, the tree
 * had not landed when both recordings ended, 13 s after the fork. `colour-slices.test.ts` waits for a tree to land,
 * on a page where the parse is the only work.
 *
 * **EVERY `parse` THE PAGE MAKES IS RECORDED**, as `colour-slices.test.ts` records them and for its reason; its header
 * has why the editor is read in a microtask queued from the wrapper.
 */

/** `tm-scratch-fork.test.ts`'s `BIG`: a λ leg of 555 steps and a machine of 7,353 states and 18,499 rules. */
const BIG = `fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }
fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }
fn add(a, b) { a + b }
fn add1(x) { x + 1 }
fold([3, 1, 2].map(add1), 0, add)`

type Call = { units: number; sliced: boolean; finished: boolean }
const calls: Call[] = []
/** Run once, in a microtask, after the first parse of a text longer than the first screen's bound. */
let afterFirstLong: (() => void) | null = null
const parse = Parser.prototype.parse
Parser.prototype.parse = function (this: Parser, ...args: Parameters<Parser['parse']>) {
  const tree = parse.apply(this, args)
  const call = {
    units: typeof args[0] === 'string' ? args[0].length : -1,
    sliced: args[2]?.progressCallback !== undefined,
    finished: tree !== null,
  }
  calls.push(call)
  if (call.units > FIRST_SCREEN_UNITS && afterFirstLong !== null) {
    queueMicrotask(afterFirstLong)
    afterFirstLong = null
  }
  return tree
}
afterAll(() => {
  Parser.prototype.parse = parse
})

const tmPane = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-leaf="tm-0"]')
  if (el === null) throw new Error('no TM pane mounted at [data-leaf="tm-0"]')
  return el
}
/** The copy's editor as it stood when the update that first parsed its text returned. */
type Seen = { tokens: string[]; calls: Call[] }

/**
 * **THREE WAITS IN THREE PLACES: THE HOOK, AND A CASE EACH.** As one case this took 7,396 to 9,093 ms in three runs
 * alone at `CPUQuota=25%` (2026-10-06), against Vitest's 15 s for a case: the program's compile to the fork control,
 * the copy's build to its editor, and the grammar's arrival to the first parse. In the three runs after the split, at
 * the same quota, the two cases took 4,300 to 4,903 ms and 2,805 to 5,100 ms; a fourth read 5,303 and 2,302. The
 * second case is the first's next stage and reads what it left.
 */
describe('the copy of a machine too long to parse in one slice', () => {
  let seen: Seen | null = null
  const detach = () => tmPane().querySelector<HTMLButtonElement>('button.detach')

  beforeAll(async () => {
    document.body.innerHTML = SHELL
    const view: EditorView = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: BIG } })
    await until(() => detach()?.disabled === false, 'the fork control to become available')
  })

  it('mounts the copy’s editor', async () => {
    afterFirstLong = () => {
      const content = tmPane().querySelector<HTMLElement>('.cm-content')
      seen = {
        tokens: [...(content?.querySelectorAll<HTMLElement>('[class^="tok-"]') ?? [])].map((t) => t.textContent ?? ''),
        calls: calls.filter((c) => c.units > FIRST_SCREEN_UNITS),
      }
    }
    detach()?.click()
    await until(() => tmPane().querySelector('.cm-editor') !== null, "the copy's own editor to mount")
    expect(tmPane().textContent).toMatch(/copy · not linked/)
  })

  it('is coloured on its first screen when the first slice of its parse returns, and is never parsed in one go', async () => {
    await until(() => seen !== null, "the copy's text to reach the parser")
    const then = seen as unknown as Seen
    const host = tmPane().querySelector<HTMLElement>('.term-editor')
    const units = (host === null ? null : EditorView.findFromDOM(host))?.state.doc.length ?? -1
    // 1,518,470 UNDER `unary`, WHICH THIS TIER'S SETUP STORES, and 1,906,914 under `binary`: either is the property's.
    expect(units, 'precondition: the copy’s text is longer than a first screen').toBeGreaterThan(FIRST_SCREEN_UNITS)

    // ONE CALL ON THE WHOLE TEXT BY THEN, AND IT IS A SLICE THAT DID NOT FINISH. In one go it read
    // `{ sliced: false, finished: true }`, with the page held until it returned.
    expect(then.calls).toEqual([{ units, sliced: true, finished: false }])
    // AND THE FIRST SCREEN IS ALREADY DRAWN IN COLOUR, from a parse of its own lines: the machine's first word first.
    expect(then.tokens.length).toBeGreaterThan(0)
    expect(then.tokens[0]).toBe('tapes')
    // NOTHING LONGER THAN THE FIRST SCREEN'S BOUND WENT TO THE PARSER IN ONE GO ON THIS PAGE, then or since.
    for (const c of calls.filter((x) => !x.sliced))
      expect(c.units, JSON.stringify(c)).toBeLessThanOrEqual(FIRST_SCREEN_UNITS)
  })
})
