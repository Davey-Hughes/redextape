import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { chooseStyle, frame, host, mountAt, toggle, until } from './harness'

/**
 * **EVERY VIEW'S NAME RENDERS AS IT IS WRITTEN, ON ITS TOGGLE AND IN ITS TITLE, IN EVERY STYLE**: `clif` lowercase, as
 * `rxm` is, and `λ` never `Λ`. What a reader sees is the rendered text, which `textContent` does not give: a view's
 * title sits in a `.pane h2`, which carries the style's `--label-transform`, and that is `uppercase` in Instrument.
 * So each name is read with `innerText`, which applies `text-transform`, and its own computed `text-transform` is held
 * to `none` beside it, which says the same in an engine whose `innerText` left the transform out. Each style first
 * asserts what the heading around the titles computes to, so that in Instrument the source view's title would read
 * `SOURCE` without `.view-title`'s `text-transform: none`; the other titles are buttons, which keep their case.
 */

const STYLES = ['instrument', 'paper', 'terminal'] as const
/** `.pane h2`'s `text-transform` in each style: Instrument's labels are uppercased, the others' are not. */
const HEADING_CASE = { instrument: 'uppercase', paper: 'none', terminal: 'none' } as const

/** The toggles' words in `HEADER_ORDER`, and each view's title, as the page writes them. */
const TOGGLES = { source: 'source', lambda: 'λ', tm: 'TM', rxm: 'rxm', clif: 'clif' } as const
const TITLES = {
  source: 'source',
  'lambda-0': 'λ · program',
  'tm-0': 'TM · program',
  'rxm-0': 'rxm · program',
  'clif-0': 'clif · program',
} as const

/** The element holding the view `leaf`'s title text: a picker's `.view-title-text`, or the source view's plain title. */
const titleOf = (leaf: string): HTMLElement =>
  (host(leaf)?.querySelector('.view-title-text') ?? host(leaf)?.querySelector('.view-title')) as HTMLElement

beforeAll(async () => {
  await mountAt(1280, 800)
  await userEvent.click(toggle('clif'))
  await until(() => host('clif-0') !== null, 'the clif toggle to show a CLIF view')
}, 30_000)

describe.each(STYLES)('in %s', (style) => {
  beforeAll(async () => {
    await chooseStyle(style)
    await frame()
  }, 30_000)

  it('draws each toggle and each view title as its text, clif lowercase as rxm is', () => {
    expect(document.documentElement.dataset.style, 'precondition: the style').toBe(style)
    const heading = titleOf('clif-0').closest('h2') as HTMLElement
    expect(getComputedStyle(heading).textTransform, "precondition: the titles' heading").toBe(HEADING_CASE[style])
    // EACH NAME'S ASSERTIONS ARE SOFT: a broken rule or word reports every name it breaks, not only the first.
    for (const [kind, word] of Object.entries(TOGGLES)) {
      // DRAWN, OR `innerText` IS `textContent` and reads no `text-transform` at all.
      expect(toggle(kind).checkVisibility(), `precondition: the ${kind} toggle is drawn`).toBe(true)
      expect.soft(getComputedStyle(toggle(kind)).textTransform, `the ${kind} toggle's case`).toBe('none')
      // biome-ignore lint/performance/useDomNodeTextContent: only innerText applies the toggle's text-transform
      expect.soft(toggle(kind).innerText, `the ${kind} toggle`).toBe(word)
    }
    for (const [leaf, title] of Object.entries(TITLES)) {
      expect(titleOf(leaf).checkVisibility(), `precondition: the ${leaf} title is drawn`).toBe(true)
      expect.soft(getComputedStyle(titleOf(leaf)).textTransform, `the ${leaf} title's case`).toBe('none')
      // biome-ignore lint/performance/useDomNodeTextContent: only innerText applies the title's text-transform
      expect.soft(titleOf(leaf).innerText, `the ${leaf} title`).toBe(title)
    }
  })
})
