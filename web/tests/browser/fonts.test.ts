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

// `tests/browser/setup.ts` loads `style.css` into every page, and with no `data-style` the page is
// Instrument — the fallback style — so these are the faces a first visit gets.
describe('the Instrument faces', () => {
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
