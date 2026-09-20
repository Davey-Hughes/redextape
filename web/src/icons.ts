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
export type IconName =
  | 'disclose'
  | 'move-editor-here'
  | 'more'
  | 'close'
  | 'edit'
  | 'play'
  | 'pause'
  | 'sun'
  | 'moon'
  | 'settings'

/** Stroke paths on a 16×16 grid. Drawn for this app; no icon set is vendored. */
const PATHS: Readonly<Record<IconName, string>> = {
  // A chevron pointing right; a panel's style sheet rotates it down when the panel is open.
  disclose: 'M6 3.5 L10.5 8 L6 12.5',
  // An arrow landing on a line: "put it here".
  'move-editor-here': 'M8 2.5 V10 M4.5 6.5 L8 10 L11.5 6.5 M3 13.5 H13',
  // `⋯`, a view's menu. Hack, Instrument's monospace face, lacks it (part 1's roadmap entry lists `✎`;
  // `⋯` and `✕` get the same treatment so the three read as one set). Three dots: zero-length segments with
  // round caps are dots of the stroke's width, so it is drawn at stroke width 2.
  more: 'M3.5 8 h0.01 M8 8 h0.01 M12.5 8 h0.01',
  // `✕`, closing a view — drawn rather than typed, for `more`'s reason.
  close: 'M4 4 L12 12 M12 4 L4 12',
  // `✎`, editing a copy — Hack lacks it (part 1's roadmap entry).
  edit: 'M10.5 2.5 L13.5 5.5 L6 13 H3 V10 Z',
  // `⏵`: Hack lacks it (part 1's roadmap entry), and `⏸` joins it so the play toggle's two faces match.
  play: 'M5 3.5 L12.5 8 L5 12.5 Z',
  pause: 'M5.5 3.5 V12.5 M10.5 3.5 V12.5',
  // `☀` and `☾`: Hack lacks both (part 1's roadmap entry); `⚙` is drawn to match. `◐` stays text — Hack
  // draws it.
  sun: 'M8 5 A3 3 0 1 0 8 11 A3 3 0 1 0 8 5 M8 1.5 V3 M8 13 V14.5 M1.5 8 H3 M13 8 H14.5 M3.4 3.4 L4.5 4.5 M11.5 11.5 L12.6 12.6 M3.4 12.6 L4.5 11.5 M11.5 4.5 L12.6 3.4',
  moon: 'M11.5 2.5 A5.5 5.5 0 1 0 13.5 10.5 A4.5 4.5 0 0 1 11.5 2.5 Z',
  settings:
    'M8 5.75 A2.25 2.25 0 1 0 8 10.25 A2.25 2.25 0 1 0 8 5.75 M8 1.5 V3.5 M8 12.5 V14.5 M1.5 8 H3.5 M12.5 8 H14.5 M3.4 3.4 L4.8 4.8 M11.2 11.2 L12.6 12.6 M3.4 12.6 L4.8 11.2 M11.2 4.8 L12.6 3.4',
}

/** Icons drawn at a heavier stroke than the default, so they read at text size. */
const STROKE: Partial<Readonly<Record<IconName, string>>> = { more: '2' }

const SVG = 'http://www.w3.org/2000/svg'

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'icon')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  // THE NAME, STAMPED, so a test can say which icon a control is showing without comparing path data.
  svg.dataset.icon = name
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', PATHS[name])
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', STROKE[name] ?? '1.5')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.append(path)
  return svg
}
