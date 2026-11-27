/**
 * A CUT TEXT READS WHOLE IN THE BROWSER'S TOOLTIP, AND ONLY WHILE IT IS CUT (the cut-text tooltips design): a listing
 * row, a diagram's instruction, a machine panel's name or a value that the stylesheet cuts with an ellipsis. A frame
 * and a heap line are not cut: each goes on below where its panel is too narrow for it (the squeezed values design). A text cut where its own code gives it a title is not watched here; `tests/node/cut-text.test.ts` holds the
 * two lists to the stylesheet.
 */

/** The texts the stylesheet cuts that nothing else lets a pointer read whole. */
export const CUT_TEXT_SELECTORS: readonly string[] = [
  '.state-cell',
  '.rxm-cell',
  '.clif-cell',
  '.program-text',
  '.machine-panel .panel-name',
  '.panel[data-panel="code"] .panel-name',
  '.mc-title',
  '.rxm-register dd',
]

/** `CUT_TEXT_SELECTORS` as one selector. */
export const CUT_TEXT: string = CUT_TEXT_SELECTORS.join(', ')

/**
 * Give the watched text the pointer arrives on its whole text as its `title` where it is cut then, and take that title
 * off at the next arrival. It measures only at an arrival the browser reports, which a step can bring on a text it
 * draws under a resting pointer; one title at a time, so none outlives the pointer. One listener on `doc`, so every
 * view is covered without naming it.
 *
 * **IT RELIES ON NO CONTAINER REWRITING A WATCHED TEXT IN PLACE**: each builds a new element at every draw, so a title
 * leaves with its text. A text rewritten in place keeps its old title until the engine reports an arrival on it.
 */
export function watchCutText(doc: Document): void {
  let titled: HTMLElement | null = null
  doc.addEventListener('pointerover', (e) => {
    titled?.removeAttribute('title')
    titled = null
    const text = e.target instanceof Element ? e.target.closest<HTMLElement>(CUT_TEXT) : null
    if (text !== null && isCut(text)) {
      text.title = reads(text)
      titled = text
    }
  })
}

/**
 * `el`'s text as it reads: its parts in order, and a space where an element meets another part with none between them.
 * The stylesheet sets such parts apart, as a listing row's pc and mnemonic columns, and `textContent` would run them
 * together.
 */
function reads(el: HTMLElement): string {
  let text = ''
  let before: Node | null = null
  for (const part of el.childNodes) {
    const words = part.textContent ?? ''
    const meet = before instanceof Element || part instanceof Element
    if (meet && /\S$/.test(text) && /^\S/.test(words)) text += ' '
    text += words
    before = part
  }
  return text
}

/**
 * Whether `el` is drawn cut. Its text runs past its content box's end, where the ellipsis is drawn: read by a Range, to
 * a fraction of a pixel, since `scrollWidth` and `clientWidth` are whole pixels and read a cut of less than one as
 * none. Or its line runs past by a whole pixel, which counts generated content a Range over its text cannot: an accept
 * state's ` · accept`, whose ellipsis can draw over the end of the name before it.
 */
function isCut(el: HTMLElement): boolean {
  if (el.scrollWidth > el.clientWidth) return true
  const range = el.ownerDocument.createRange()
  range.selectNodeContents(el)
  const style = getComputedStyle(el)
  const end =
    el.getBoundingClientRect().right - Number.parseFloat(style.borderRightWidth) - Number.parseFloat(style.paddingRight)
  return range.getBoundingClientRect().right > end
}
