/**
 * THE PRE-PAINT SCRIPT — applies the stored appearance, style and palette BEFORE first paint, on every page the site
 * serves. `main.ts` does this too (`appearance.ts`'s `applyAppearance`, `skin.ts`'s `applySkin`), but a module script
 * always runs after the page has already painted once — waiting for it would show the wrong theme for one frame on
 * every load, then snap to the right one.
 *
 * **ONE COPY, INLINED BY THE BUILD.** Each page's `<head>` holds `PREPAINT_SLOT`, and a plugin in `vite.config.ts`
 * replaces it with this script inside a classic `<script>`, in the dev server and in the build alike. It cannot
 * be imported at run time, since importing a module would reintroduce exactly the delay it exists to avoid; so it
 * carries its own copies of the keys, the style ids and the cache pattern, and `prepaint.test.ts` holds each to
 * `skin.ts`/`palettes.ts`.
 *
 * `try/catch` because `localStorage` throws in some privacy modes, and a thrown error here must not block the rest of
 * the page from loading. The cached palette is applied only if every declaration in it sets a custom property to a
 * `light-dark(#hex, #hex)` pair (`palettes.ts`'s `PALETTE_CSS_PATTERN`), so nothing else in storage can reach the
 * `style` attribute.
 */
export const PREPAINT: string = `
try {
  var v = localStorage.getItem('redextape.appearance')
  if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v)
} catch {}
try {
  var s = localStorage.getItem('redextape.style')
  if (s === 'paper' || s === 'terminal' || s === 'instrument') document.documentElement.setAttribute('data-style', s)
  var c = localStorage.getItem('redextape.palette.css')
  if (c && /^(--[a-z0-9-]+: light-dark\\(#[0-9a-f]{6}, #[0-9a-f]{6}\\); ?)+$/.test(c)) document.documentElement.setAttribute('style', c)
} catch {}
`

/** What each page's `<head>` carries where the script goes. */
export const PREPAINT_SLOT = '<!-- prepaint -->'

/** `html` with its slot replaced by the script, or unchanged when it has no slot. */
export function inlinePrepaint(html: string): string {
  return html.replace(PREPAINT_SLOT, () => `<script>${PREPAINT}</script>`)
}
