import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CUT_TEXT_SELECTORS } from '../../src/cut-text'

/**
 * EVERY TEXT THE STYLESHEET CUTS HAS A WAY TO READ WHOLE (the cut-text tooltips design): each selector of a rule that
 * declares `text-overflow: ellipsis` is watched by `cut-text.ts`, or titled by its own code, or both in part, and the
 * watcher watches nothing else. So a new cut text fails here until it is given one of the two, and a text given both
 * would show its own title and then lose it to the watcher's.
 */

const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8')

/**
 * The selectors of every innermost rule that cuts its text with an ellipsis, each run of whitespace one space. Read
 * from the text after the last `;` before the rule, as no selector holds one and a statement such as `@import` ends
 * with one.
 */
function ellipsisSelectors(text: string): Set<string> {
  const out = new Set<string>()
  for (const [, before = '', body = ''] of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(?:^|[;\s])text-overflow\s*:\s*ellipsis\b/.test(body)) continue
    for (const s of before.slice(before.lastIndexOf(';') + 1).split(',')) out.add(s.trim().replace(/\s+/g, ' '))
  }
  return out
}

/** The texts the stylesheet cuts whose own code gives them their whole text, or which are cut by design, and why. */
const TITLED: Record<string, string> = {
  '.results .segment': "its segment's title, `readout.ts`",
  'span.view-title': "the view title's, `view-header.ts`",
  '.view-title-text': "the view title's, `view-header.ts`",
  '.tm-line > .tm-state': "the state's, `tm-pane.ts`",
  '.program-count-word': 'only the unit word is cut, by design',
  '.local-node': "the node's, `state-diagram.ts`",
  '.machine-panel .panel-note': "the count's, `machine-panels.ts`",
}

/**
 * The texts whose own code titles them in part: each to the watched selector for the part it leaves untitled. A copy's
 * term has its own title (`buffer-list.ts`); a copy with no term reads `no term yet` and has none.
 */
const PART_WATCHED: Record<string, string> = {
  '.buffer-row-term': '.buffer-row-term.is-absent',
}

const cut = ellipsisSelectors(css)

describe('the watched texts', () => {
  it('names every text the stylesheet cuts with an ellipsis, as watched, as titled by its own code, or as both in part', () => {
    for (const s of [...Object.keys(TITLED), ...Object.keys(PART_WATCHED)])
      expect(cut.has(s), `precondition: the stylesheet cuts ${s}`).toBe(true)
    const named = (s: string) =>
      CUT_TEXT_SELECTORS.includes(s) ||
      Object.hasOwn(TITLED, s) ||
      (Object.hasOwn(PART_WATCHED, s) && CUT_TEXT_SELECTORS.includes(PART_WATCHED[s] ?? ''))
    expect(
      [...cut].filter((s) => !named(s)),
      'cut with an ellipsis, and neither watched nor titled',
    ).toEqual([])
  })

  it('watches no text the stylesheet does not cut, and none its own code titles', () => {
    const parts = Object.values(PART_WATCHED)
    const stray = CUT_TEXT_SELECTORS.filter(
      (s) => !(cut.has(s) || parts.includes(s)) || Object.hasOwn(TITLED, s) || Object.hasOwn(PART_WATCHED, s),
    )
    expect(stray, 'watched, and not cut or titled by its own code').toEqual([])
  })
})
