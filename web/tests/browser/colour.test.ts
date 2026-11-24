import { beforeAll, describe, expect, it } from 'vitest'
import { idle, paneOrThrow, SHELL, until } from './harness'

/**
 * **THE COLOURER, INSTALLED — design §11.2's colour row, over the running app rather than over a stub.**
 *
 * The source editor is coloured from its own grammar's table, and the case below asserts a class that table
 * produces:
 *
 * ```text
 * source   .tok-operator    Operator   `@operator` in REDEXTAPE
 * ```
 *
 * **THIS IS ONE OF `golden.rs`'s WITNESSES**: `each_language_carries_a_class_no_other_one_does` picks `Operator`
 * among its four.
 *
 * **THE ASSERTION READS THE COMPUTED COLOUR AS WELL AS THE CLASS, BECAUSE A CLASS NO STYLESHEET STYLES WOULD SATISFY A
 * CLASS-ONLY ASSERTION WHILE RENDERING AS PLAIN TEXT.** `tests/browser/setup.ts` gives the tester page `style.css`,
 * so `.tok-operator` resolves to `--tok-operator`, which differs from the `--fg` a `.cm-content` inherits. A
 * missing rule, or a class the palette forgot, reads here as painted === plain.
 *
 * `.cm-content`, NOT `.cm-editor`: `getComputedStyle` on the wrapper would read a box the text does not
 * inherit its colour from, and the token spans are children of the content node.
 *
 * **REAL TIMERS.** A grammar arrives over a `fetch` the plugin awaits in its constructor; a fake clock
 * plus an awaited fetch is a deadlock, not a slow test.
 *
 * **WHAT THIS FILE CANNOT SEE: THE VIEWPORT SCOPING.** `colour.ts` queries only `view.visibleRanges`, and
 * that is a COST property, not a correctness one — querying `tree.rootNode` with no range options at all
 * would leave every test here green. Tens of thousands of decorations in one `RangeSet` is a cost;
 * nothing below implies coverage of it.
 */
const contentOf = (pane: HTMLElement): HTMLElement | null => pane.querySelector<HTMLElement>('.cm-content')

/**
 * Assert that `selector` is painted inside `pane`'s editor, and that its colour is not the editor's own
 * body colour. Returns the element, so a caller can also say what its text is.
 */
async function colouredIn(pane: HTMLElement, selector: string, what: string): Promise<HTMLElement> {
  await until(() => contentOf(pane)?.querySelector(selector) != null, what)
  const content = contentOf(pane)
  if (content === null) throw new Error('the editor went away between the wait and the read')
  const token = content.querySelector<HTMLElement>(selector)
  if (token === null) throw new Error(`no ${selector} in this editor`)
  expect(getComputedStyle(token).color).not.toBe(getComputedStyle(content).color)
  return token
}

describe('the source editor colours from its grammar', () => {
  // ONE MOUNT FOR THE FILE, the idiom `app.test.ts` states: ES module imports are cached, so `main()`
  // runs once per page and Vitest gives each test FILE its own page.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(idle, 'the app to compile its sample program')
  })

  it('colours the source editor from the mini-language grammar, in the palette', async () => {
    const op = await colouredIn(paneOrThrow('source'), '.tok-operator', 'the source editor to colour an operator')
    // `let x = 40; x + 2` carries two: `=` and `+`, both in the mini-language's `@operator` set. The
    // first in document order is the one `querySelector` returns.
    expect(op.textContent).toBe('=')
  })
})
