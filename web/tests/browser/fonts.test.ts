import { describe, expect, it } from 'vitest'

const family = (f: FontFace): string => f.family.replaceAll('"', '')

/** Whether a `FontFace.unicodeRange` — `U+X` and `U+X-Y` entries, comma-separated — includes `cp`. */
function covers(range: string, cp: number): boolean {
  return range.split(',').some((entry) => {
    const [lo, hi = lo] = entry
      .trim()
      .replace(/^u\+/i, '')
      .split('-')
      .map((h) => Number.parseInt(h, 16))
    return lo !== undefined && hi !== undefined && lo <= cp && cp <= hi
  })
}

/** The width `text` takes alone in `stack` at 100px, the browser's own layout of it. */
function advance(stack: string, text: string): number {
  const span = document.createElement('span')
  span.style.font = `400 100px ${stack}`
  span.style.whiteSpace = 'pre'
  // OUT OF `body`'s FLOW, which would stretch it to the page's width.
  span.style.position = 'absolute'
  span.textContent = text
  document.body.append(span)
  const width = span.getBoundingClientRect().width
  span.remove()
  return width
}

/**
 * Advances in em, as each face's `hmtx` table gives them. Held at 100px to half a pixel, since Chrome sets an advance
 * on a whole pixel.
 */
const STIX = { '▾': 0.676, '◐': 0.862, '↗': 0.948, '→': 0.948, '⚠': 1.546 } as const
const HACK = 1233 / 2048

/** The `size-adjust` `fonts.css` gives STIX Two Math, as a fraction: read from the loaded rule, not restated here. */
function stixSizeAdjust(): number {
  const rules = (sheet: CSSStyleSheet): CSSRule[] =>
    [...sheet.cssRules].flatMap((r) => (r instanceof CSSImportRule && r.styleSheet ? rules(r.styleSheet) : [r]))
  const face = [...document.styleSheets]
    .flatMap(rules)
    .find((r): r is CSSFontFaceRule => r instanceof CSSFontFaceRule && r.style.fontFamily.includes('STIX Two Math'))
  const value = face?.style.getPropertyValue('size-adjust') ?? ''
  if (!value.endsWith('%')) throw new Error(`STIX Two Math's size-adjust is ${JSON.stringify(value)}, not a percentage`)
  return Number.parseFloat(value) / 100
}

// `tests/browser/setup.ts` loads `style.css` into every page, and with no `data-style` the page is
// Instrument — the fallback style — so these are the faces a first visit gets.
describe('the Instrument faces', () => {
  /**
   * **THE GLYPHS NEITHER INTER NOR HACK HAS ARE STIX TWO MATH'S, AT ITS ADVANCES SCALED BY ITS `size-adjust`, FROM A
   * FILE'S FIRST MEASUREMENT.** First in the file and awaiting nothing, so it measures what a file that mounts the app
   * and reads the header at once would: were `setup.ts` not to load the face before the file runs, these would be the
   * OS's face for the few frames before the swap. In Hack's stack the face comes after Hack, so `→`, which Hack has,
   * keeps Hack's advance.
   */
  it('draws the glyphs neither face has in STIX Two Math, loaded before the file runs', () => {
    const scale = stixSizeAdjust()
    for (const [glyph, em] of Object.entries(STIX)) {
      expect(advance('var(--font-ui)', glyph), `${glyph} in Inter's stack`).toBeCloseTo(em * scale * 100, 0)
    }
    expect(advance('var(--font-mono)', '⚠'), "⚠ in Hack's stack").toBeCloseTo(STIX['⚠'] * scale * 100, 0)
    expect(advance('var(--font-mono)', '→'), "→ in Hack's stack").toBeCloseTo(HACK * 100, 0)
    expect(advance('var(--font-mono)', '▾'), "▾ in Hack's stack").toBeCloseTo(HACK * 100, 0)
  })

  // Hack's faces declare no `unicode-range`, so `fonts.load` returns them for any text: this shows the
  // face loads, not which glyphs it has.
  it('loads Hack', async () => {
    const faces = await document.fonts.load('16px "Hack"', 'λx. x')
    expect(faces.map(family)).toContain('Hack')
  })

  // Each Inter face declares its subset as a `unicode-range`, and the browser fetches only the faces
  // whose range meets the text. A face with no range meets every text, so λ would fetch the Latin face
  // too; the check on `A` fails on any face that Latin text would also fetch.
  it('fetches only the Inter subset that covers λ', async () => {
    const faces = await document.fonts.load('16px "Inter"', 'λ')
    expect(faces.map(family)).toContain('Inter')
    for (const face of faces) {
      expect(covers(face.unicodeRange, 0x3bb), face.unicodeRange).toBe(true)
      expect(covers(face.unicodeRange, 0x41), face.unicodeRange).toBe(false)
    }
  })

  it('draws a term in Hack', () => {
    const term = document.createElement('pre')
    term.className = 'term'
    term.textContent = 'λx. x'
    document.body.append(term)
    expect(getComputedStyle(term).fontFamily.replaceAll('"', '')).toMatch(/^Hack,/)
    term.remove()
  })
})
