import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

/**
 * **THE COLOURER, INSTALLED — design §11.2's colour row, over the running app rather than over a stub.**
 *
 * Three editors, three grammars, one mechanism. Each test below asserts a class that its own language's
 * table produces and no other language's does, so a class appearing in the wrong editor would be a
 * grammar reaching a language it does not describe:
 *
 * ```text
 * source  .tok-operator    Operator   `@operator` in REDEXTAPE, and in no other table
 * λ copy  .tok-binder      Binder     `@keyword.function` and `@variable.parameter` in REDEXTAPE_LAMBDA
 * TM copy .tok-statename   StateName  `@label.reference` in REDEXTAPE_TM, which asm maps to Label instead
 * ```
 *
 * **THESE ARE `golden.rs`'s WITNESSES, AND THE DISAGREEMENT WAS THE FINDING.**
 * `each_language_carries_a_class_no_other_one_does` picks `Operator`, `Binder`, `StateName` and
 * `Mnemonic`; this header used to name `tok-keyword` for the source editor and claim the three classes
 * had one capture row each. Neither half was true. Counted in `crates/redextape-core/src/capture_map.rs`,
 * `Keyword` has THREE rows — `REDEXTAPE`, `REDEXTAPE_TM` and `REDEXTAPE_ASM` all map `@keyword` to it —
 * so the source editor's assertion discriminated nothing: the last test in this file finds `tok-keyword`
 * in the source editor AND in the TM editor on the same page, which is what "no other grammar produces
 * it" was supposed to rule out. `Binder` has two rows rather than one, both λ's, which leaves the CLASS
 * unique to λ even though the row count was wrong. Only `TapeSymbol`, the row this file used for TM, was
 * as described — it is replaced anyway so all three witnesses match the Rust side's, two sides of one
 * argument rather than two arguments.
 *
 * asm has no editor until part 5, so its witness (`Mnemonic`) has no row here.
 *
 * **EVERY ASSERTION READS THE COMPUTED COLOUR AS WELL AS THE CLASS, BECAUSE A CLASS NO STYLESHEET STYLES
 * WOULD SATISFY A CLASS-ONLY ASSERTION WHILE RENDERING AS PLAIN TEXT.** `tests/browser/setup.ts` gives
 * the tester page `style.css`, so `.tok-keyword` resolves to `--tok-keyword`, `.tok-binder` to
 * `--tok-binder` and `.tok-statename` — the one neutral class of the three — to `--tok-neutral`, each
 * different from the `--fg` a `.cm-content` inherits. A missing rule, or a class the palette forgot,
 * reads here as painted === plain.
 *
 * **EVERY QUERY IS SCOPED TO A `.cm-content`, AND FOR THE λ PANE THAT IS LOAD-BEARING.** The λ pane's
 * RENDERED FRAME already emits `.tok-binder` spans, computed by the worker from the term it holds
 * (`spans.ts`'s `decorationRanges`) — a route this task does not touch and must not be mistaken for the
 * one under test. An unscoped `.tok-binder` query would pass against that frame with the editor
 * completely uncoloured. `lambda-pane.ts` is the only caller of `decorationRanges`, so the λ pane is the
 * only surface outside an editor that paints these classes; the scoping stays on all three rows anyway,
 * since which surfaces those are is not a property any of them assert.
 *
 * **REAL TIMERS.** A grammar arrives over a `fetch` the plugin awaits in its constructor; a fake clock
 * plus an awaited fetch is a deadlock, not a slow test.
 *
 * **WHAT THIS FILE CANNOT SEE: THE VIEWPORT SCOPING.** `colour.ts` queries only `view.visibleRanges`, and
 * that is a COST property, not a correctness one — querying `tree.rootNode` with no range options at all
 * leaves every test here green (measured, Task 4 step 9). Tens of thousands of decorations in one
 * `RangeSet` is a cost Task 7 measures; nothing below implies coverage of it.
 */

const resultsText = () => document.querySelector('#results')?.textContent ?? ''
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== ''

const paneOf = (leaf: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-leaf="${leaf}"]`)
  if (el === null) throw new Error(`no pane mounted at [data-leaf="${leaf}"]`)
  return el
}

/**
 * The editable surface of the one editor in `pane`, or `null` while none is mounted.
 *
 * `.cm-content`, NOT `.cm-editor`: `getComputedStyle` on the wrapper would read a box the text does not
 * inherit its colour from, and the token spans are children of the content node.
 */
const contentOf = (pane: HTMLElement): HTMLElement | null => pane.querySelector<HTMLElement>('.cm-content')

/** Fork `pane` onto a copy of what it is showing — the `⌄ copy` control both panes carry. */
const fork = (pane: HTMLElement): void => {
  const button = pane.querySelector<HTMLButtonElement>('button.detach')
  if (button === null) throw new Error('no fork control on this pane')
  button.click()
}

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

describe('the editors colour from their grammars', () => {
  // ONE MOUNT FOR THE FILE, the idiom every sibling states: ES module imports are cached, so `main()`
  // runs once per page and Vitest gives each test FILE its own page.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(idle, 'the app to compile its sample program')
  })

  it('colours the source editor from the mini-language grammar, in the palette', async () => {
    const op = await colouredIn(paneOf('source'), '.tok-operator', 'the source editor to colour an operator')
    // `let x = 40; x + 2` carries two: `=` and `+`, both in the mini-language's `@operator` set. The
    // first in document order is the one `querySelector` returns.
    expect(op.textContent).toBe('=')
  })

  it('colours a λ copy from the λ grammar, in the palette', async () => {
    fork(paneOf('lambda-0'))
    const binder = await colouredIn(paneOf('lambda-0'), '.tok-binder', 'the λ copy’s editor to colour a binder')
    // The binder head and the name it binds are both `Binder` (the λ grammar's own comment), and the
    // head is the first of the two, so this is the glyph rather than the name.
    expect(binder.textContent).toBe('λ')
  })

  it('colours a TM copy from the TM grammar, in the palette', async () => {
    fork(paneOf('tm-0'))
    const state = await colouredIn(paneOf('tm-0'), '.tok-statename', 'the TM copy’s editor to colour a state name')
    // A state name is one identifier token; asserting it is non-empty rather than naming one keeps this
    // off the lowering's choice of state names, which is not what the colourer is being asked about.
    // `@label.reference` reaches it — a `start` or `goto` TARGET, never a defining position, which the
    // TM table maps to `Label` and the asm table maps `@label.reference` to as well (design §5.2).
    expect(state.textContent).not.toBe('')
  })

  /**
   * **THE COUNTER-CLAIM, PINNED RATHER THAN ONLY WRITTEN IN THE HEADER.** `tok-keyword` was this file's
   * source-editor witness, on a sentence saying no other grammar produces it. `REDEXTAPE_TM` maps
   * `@keyword` to `Keyword` as well, so the same class is on screen in both editors at once and a
   * `.tok-keyword` query says nothing about which grammar coloured the pane it found one in. Asserting
   * that here is what keeps the header's correction from being a claim about the tables that no gate
   * reads — and what makes a future revert to `tok-keyword` fail beside the sentence explaining why.
   *
   * Both panes are already forked and coloured by the tests above; this adds no gesture of its own.
   */
  it('finds tok-keyword in two editors at once, which is why it is nobody’s witness', () => {
    expect(contentOf(paneOf('source'))?.querySelector('.tok-keyword')?.textContent).toBe('let')
    // NOT A NAMED WORD, for the reason the state name above is not one: which of the TM form's
    // keywords lands first in the viewport is the lowering's business. That one does is not.
    const tmKeyword = contentOf(paneOf('tm-0'))?.querySelector('.tok-keyword')?.textContent ?? ''
    expect(tmKeyword, 'the TM editor colours keywords of its own, from its own table’s @keyword row').not.toBe('')
  })
})
