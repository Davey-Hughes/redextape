import { describe, expect, it } from 'vitest'
import {
  KIND_GLOSS,
  NARROW_WINDOW,
  NARROW_WINDOW_REM,
  shownSentence,
  toggleSentence,
  toggleTitle,
} from '../../src/app-header'
import { readRelative } from './read-fixture'

/**
 * THE HEADER'S TWO SENTENCES ABOUT THE VIEWS — the view layouts spec §6: what a `views` toggle says of the views it
 * stands for, and what the live region is told a switch shows. Each is a function of its arguments alone, so the
 * words are held here and the browser tier holds that the page says them.
 */

describe('toggleSentence', () => {
  it('says one view of a kind as the view', () => {
    expect(toggleSentence('tm', 1, 'shown')).toBe('hide the TM view')
    expect(toggleSentence('lambda', 1, 'hidden')).toBe('show the λ view')
    expect(toggleSentence('source', 1, 'only')).toBe('the source view is the only one shown — one view stays')
  })

  /**
   * A toggle hides or shows every view of its kind, so two are said as two. **AND WHAT STAYS IS THEN ONE KIND OF VIEW,
   * NOT ONE VIEW**: the singular's reason, word for word, would be said of two views that both stay.
   */
  it('says two views of a kind with their number, and as the only ones shown, where one kind of view stays', () => {
    expect(toggleSentence('tm', 2, 'shown')).toBe('hide the 2 TM views')
    expect(toggleSentence('rxm', 3, 'hidden')).toBe('show the 3 rxm views')
    expect(toggleSentence('tm', 2, 'only')).toBe('the 2 TM views are the only ones shown — one kind of view stays')
    expect(toggleSentence('lambda', 3, 'only')).toBe('the 3 λ views are the only ones shown — one kind of view stays')
  })
})

/** What the rxm toggle's tooltip says the view is, under the sentence of what a press does. */
const RXM_IS = "redextape's register machine: the IR between the source and the Turing machine"

describe('toggleTitle', () => {
  it('is the sentence alone for the source, λ and TM toggles', () => {
    expect(toggleTitle('source', 1, 'only')).toBe('the source view is the only one shown — one view stays')
    expect(toggleTitle('lambda', 1, 'hidden')).toBe('show the λ view')
    expect(toggleTitle('tm', 2, 'shown')).toBe('hide the 2 TM views')
  })

  it('says under the sentence, for rxm, what the view is: redextape’s register machine, between the source and the TM', () => {
    expect(toggleTitle('rxm', 1, 'hidden')).toBe(`show the rxm view\n${RXM_IS}`)
    expect(toggleTitle('rxm', 2, 'shown')).toBe(`hide the 2 rxm views\n${RXM_IS}`)
    expect(toggleTitle('rxm', 1, 'only')).toBe(`the rxm view is the only one shown — one view stays\n${RXM_IS}`)
  })
})

describe('the help page', () => {
  it('says what the rxm view is where it names the views', () => {
    expect(readRelative('../../help.html').replace(/\s+/g, ' ')).toContain(
      "<strong>λ</strong> and <strong>TM</strong>. The rxm view shows redextape's register machine, the IR between" +
        " the source and the Turing machine: its control flow becomes the machine's states, and its registers, stack" +
        " and heap become the machine's tapes. A software interpreter steps it, and it is not x86, ARM, WebAssembly" +
        ' or LLVM output. Each combination of views keeps its own arrangement,',
    )
  })

  it('holds each clause of the rxm tooltip’s gloss, so the page and the tooltip say one thing', () => {
    const help = readRelative('../../help.html').replace(/\s+/g, ' ')
    expect(KIND_GLOSS.rxm).not.toBeNull()
    for (const clause of String(KIND_GLOSS.rxm).split(': ')) expect(help).toContain(clause)
  })
})

describe('shownSentence', () => {
  it('says one kind alone, two with and, and more with commas, in the header’s order', () => {
    expect(shownSentence(['tm'])).toBe('showing TM')
    expect(shownSentence(['tm', 'source'])).toBe('showing source and TM')
    expect(shownSentence(['tm', 'lambda', 'source'])).toBe('showing source, λ and TM')
    expect(shownSentence(['tm', 'lambda', 'rxm', 'source'])).toBe('showing source, rxm, λ and TM')
  })
})

/**
 * **THE WIDTH THAT HIDES THE TOGGLES IS WRITTEN THREE TIMES**, in a module, a stylesheet and a page, and neither of
 * the last two can import the first (`NARROW_WINDOW`'s doc). The last two are read as text here.
 */
describe('the window too narrow for the views toggles', () => {
  it('is one query in main.ts’s attribute and in the stylesheet’s rule', () => {
    expect(NARROW_WINDOW).toBe(`(max-width: ${NARROW_WINDOW_REM}rem)`)
    const rules = [
      ...readRelative('../../src/style.css').matchAll(
        /@media ([^{]+?) \{\s*\.views-shown \{\s*display: none;\s*\}\s*\}/g,
      ),
    ].map(([, query]) => query)
    expect(rules, 'the media rule that hides .views-shown').toEqual([NARROW_WINDOW])
  })

  /** A rem is 16 px at a browser's default text size, which is the size the page gives the width at. */
  it('is the width the help page gives a reader, in pixels', () => {
    expect(readRelative('../../help.html').replace(/\s+/g, ' ')).toContain(
      `A window about ${NARROW_WINDOW_REM * 16} px wide or narrower, at the browser's usual text size, has no room for the buttons;`,
    )
  })
})
