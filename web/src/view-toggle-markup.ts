// `vite.config.ts` loads this file and what it imports. Vite warns today about an import there without its file
// extension, and the config loader planned as its default will not take one.
import { HEADER_ORDER, KIND_WORD } from './layout.ts'

/**
 * THE HEADER'S `views` TOGGLES, AS THE PAGE CARRIES THEM — one button a kind, in `HEADER_ORDER`, each saying its
 * `KIND_WORD`, so a kind the tables gain has its toggle and the page cannot spell a kind another way than they do.
 *
 * **NOT PRESSED**, which is true of a page with no view built yet: `app-header.ts`'s `viewToggles` adopts them and
 * presses the ones on screen.
 */
export function viewToggleButtons(): string {
  return HEADER_ORDER.map(
    (kind) =>
      `<button type="button" class="view-toggle" data-shows="${kind}" aria-pressed="false">${KIND_WORD[kind]}</button>`,
  ).join('')
}

/**
 * What `index.html` carries where the toggles go. **A PLUGIN IN `vite.config.ts` FILLS IT, AND NOT `main.ts`**, in the
 * dev server and in the build alike: built after the wasm loads, in a header already on the page, the toggles would
 * push every control after them along as they arrived.
 */
export const VIEW_TOGGLES_SLOT = '<!-- view-toggles -->'

/** `html` with its slot replaced by the toggles, or unchanged when it has no slot. */
export function inlineViewToggles(html: string): string {
  return html.replace(VIEW_TOGGLES_SLOT, () => viewToggleButtons())
}
