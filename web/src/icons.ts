/**
 * Inline SVG icons, keyed by MEANING, not by shape (Plan 7 part 1, spec §9).
 *
 * WHY NOT CHARACTERS. A control glyph (▸ ◀ ✕ ⌄ …) is drawn by whichever face has it, and the faces
 * differ: Inter has none of them and Hack lacks several (✕, ⌃ and ⏵ among them) — measured on their font files — while Paper
 * and Terminal draw with whatever faces the OS has. A glyph the face lacks falls back to a symbol face of
 * the OS's, so the same control could look different from one style or machine to the next. And one glyph
 * did two jobs: `⌄` was both "show the editor" and "bring the editor here". A name per meaning is what
 * makes the umbrella design's rule 2 (one glyph, one meaning) something the code enforces: two meanings
 * are two names.
 *
 * Each icon is decorative — `aria-hidden`, not focusable — and drawn in `currentColor`, so it follows
 * the palette and the text beside it. The control it sits in carries the accessible name.
 */
export type IconName = 'disclose' | 'move-editor-here'

/** Stroke paths on a 16×16 grid. Drawn for this app; no icon set is vendored. */
const PATHS: Readonly<Record<IconName, string>> = {
  // A chevron pointing right; a panel's style sheet rotates it down when the panel is open.
  disclose: 'M6 3.5 L10.5 8 L6 12.5',
  // An arrow landing on a line: "put it here".
  'move-editor-here': 'M8 2.5 V10 M4.5 6.5 L8 10 L11.5 6.5 M3 13.5 H13',
}

const SVG = 'http://www.w3.org/2000/svg'

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'icon')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', PATHS[name])
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.5')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.append(path)
  return svg
}
