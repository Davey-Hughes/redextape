import { describe, expect, it } from 'vitest'
import { BASE16_MAPPING, detectVariant, mapScheme, readScheme, type Scheme } from '../../src/base16'
import { COLOUR_TOKENS } from '../../src/palettes'
import { currentLayout, DAY, keyed, legacyLayout, NIGHT } from './base16-fixtures'

/** The scheme `text` reads as, or a failure naming its errors. */
function read(text: string): Scheme {
  const r = readScheme(text)
  if (!r.ok) throw new Error(`did not read: ${r.errors.join('; ')}`)
  return r.scheme
}

/** The errors `text` reads as, or a failure if it reads. */
function errors(text: string): readonly string[] {
  const r = readScheme(text)
  if (r.ok) throw new Error('read, where it should not have')
  return r.errors
}

/** `NIGHT` in the legacy layout with line `base${key}` replaced by `line`, or removed for `null`. */
const withLine = (key: string, line: string | null): string =>
  legacyLayout('Night', NIGHT)
    .split('\n')
    .flatMap((l) => (l.startsWith(`base${key}:`) ? (line === null ? [] : [line]) : [l]))
    .join('\n')

describe('readScheme — the two published layouts (Plan 7 part 6b spec §4.1)', () => {
  it('reads the current layout: name, variant, and the colours under palette:', () => {
    const s = read(currentLayout('Night', NIGHT, 'dark'))
    expect(s).toEqual({ name: 'Night', colours: keyed(NIGHT), variant: 'dark', variantFrom: 'file', base24: false })
  })

  it('reads the legacy layout: scheme, and the colours at the top level as bare hex', () => {
    const s = read(legacyLayout('Day', DAY))
    expect(s).toEqual({ name: 'Day', colours: keyed(DAY), variant: 'light', variantFrom: 'detected', base24: false })
  })

  it('reads a colour with or without #, in double, single or no quotes, in either case, as lowercase #rrggbb', () => {
    const text = [
      'palette:',
      '  base00: "#1F1D2B"',
      "  base01: '2b2838'",
      '  base02: #3A3649',
      '  base03: 5b5670',
      ...NIGHT.slice(4).map((c, i) => `  base0${(i + 4).toString(16).toUpperCase()}: "${c}"`),
    ].join('\n')
    expect(read(text).colours).toEqual(keyed(NIGHT))
  })

  it('reads a bare #rrggbb as that colour, where YAML reads a comment', () => {
    expect(read(withLine('00', 'base00: #1f1d2b')).colours.base00).toBe('#1f1d2b')
  })

  it('reads either layout with CRLF line endings as with LF', () => {
    for (const text of [currentLayout('Night', NIGHT, 'dark'), legacyLayout('Day', DAY)]) {
      expect(read(text.replaceAll('\n', '\r\n'))).toEqual(read(text))
    }
  })

  it('reads the last digit of a key in either case', () => {
    expect(read(withLine('0F', 'base0f: "d0a080"')).colours.base0F).toBe('#d0a080')
  })

  it('skips full-line, tab-led and trailing comments', () => {
    const text = [
      '# Night, for the tests',
      '\t# base00: "ffffff" — a comment, not a colour',
      withLine('00', 'base00: "1f1d2b" # the page').replace('base01: "2b2838"', 'base01: 2b2838 # panels'),
    ].join('\n')
    const s = read(text)
    expect(s.colours.base00).toBe('#1f1d2b')
    expect(s.colours.base01).toBe('#2b2838')
  })

  it('reads name over scheme, and unescapes a quoted one', () => {
    expect(read(`name: "Say \\"when\\" \\\\ now"\n${legacyLayout('Night', NIGHT)}`).name).toBe('Say "when" \\ now')
    expect(read(`name: 'It''s night'\n${legacyLayout('Night', NIGHT)}`).name).toBe("It's night")
    expect(read(legacyLayout('Night', NIGHT).replace('scheme: "Night"', 'author: "x"')).name).toBe('')
  })

  it('reads name and variant at the top level only', () => {
    const text = `${currentLayout('Night', NIGHT)}  name: "nested"\n  variant: "light"\n`
    const s = read(text)
    expect(s.name).toBe('Night')
    expect(s.variantFrom).toBe('detected')
  })

  it('marks a scheme base24 when it carries base10–base17, and reads its first sixteen as base16', () => {
    const extra = ['10', '11', '12', '13', '14', '15', '16', '17'].map((k) => `  base${k}: "#000000"`)
    const s = read(`${currentLayout('Night', NIGHT, 'dark')}${extra.join('\n')}\n`)
    expect(s.base24).toBe(true)
    expect(s.colours).toEqual(keyed(NIGHT))
  })
})

describe('readScheme — errors, each naming its key (spec §4.2)', () => {
  it('names every missing key', () => {
    expect(errors(withLine('03', null).replace(/base0C:.*\n/, ''))).toEqual(['base03 is missing', 'base0C is missing'])
  })

  it('names every value that is not a colour, quoting it', () => {
    expect(errors(withLine('03', 'base03: "#12345"').replace('base07: "f2f0f7"', 'base07: white'))).toEqual([
      'base03 is not a colour: "#12345"',
      'base07 is not a colour: "white"',
    ])
  })

  it('names a key given twice, whatever the case of its last digit', () => {
    expect(errors(`${legacyLayout('Night', NIGHT)}base05: "c8c3d8"\nbase0f: "d0a080"\n`)).toEqual([
      'base05 is given twice',
      'base0F is given twice',
    ])
  })

  it('reads an anchor or an alias as a value that is not a colour', () => {
    expect(errors(withLine('05', 'base05: *fg'))).toEqual(['base05 is not a colour: "*fg"'])
    expect(errors(withLine('05', 'base05: &fg "c8c3d8"'))).toEqual(['base05 is not a colour: "&fg \\"c8c3d8\\""'])
  })

  it('says one thing of text with no base16 colour in it: empty, TOML, JSON or a flow mapping', () => {
    const toml = 'name = "Night"\n[palette]\nbase00 = "#1f1d2b"\nbase01 = "#2b2838"\n'
    const json = JSON.stringify({ name: 'Night', palette: keyed(NIGHT) }, null, 2)
    const flow = `name: Night\npalette: {base00: "1f1d2b", base01: "2b2838"}\n`
    for (const text of ['', toml, json, flow]) expect(errors(text)).toEqual(['no base16 colours found'])
  })
})

describe('the variant (spec §4.4)', () => {
  it('is dark when base00 is darker than base05, and light otherwise', () => {
    expect(detectVariant(keyed(NIGHT) as Scheme['colours'])).toBe('dark')
    expect(detectVariant(keyed(DAY) as Scheme['colours'])).toBe('light')
    expect(read(legacyLayout('Night', NIGHT)).variant).toBe('dark')
  })

  it('is what the file says when that is light or dark, in any case, over what the colours say', () => {
    const s = read(currentLayout('Night', NIGHT, 'Light'))
    expect(s.variant).toBe('light')
    expect(s.variantFrom).toBe('file')
  })

  it('is detected when the file says anything else', () => {
    const s = read(currentLayout('Day', DAY, 'dim'))
    expect(s.variant).toBe('light')
    expect(s.variantFrom).toBe('detected')
  })
})

describe('the mapping (spec §5.1)', () => {
  it('gives every token the scheme colour the table names', () => {
    expect(BASE16_MAPPING).toEqual({
      bg: 'base00',
      'on-accent': 'base00',
      'bg-raised': 'base01',
      'bg-chrome': 'base01',
      rule: 'base02',
      'fg-dim': 'base04',
      'tok-neutral': 'base04',
      'tok-punct': 'base04',
      fg: 'base05',
      'tok-ident': 'base05',
      'focus-ring': 'base05',
      error: 'base08',
      'tok-nat': 'base09',
      'tok-bool': 'base09',
      warn: 'base0A',
      'tok-binder': 'base0B',
      'tok-operator': 'base0C',
      accent: 'base0E',
      'tok-keyword': 'base0E',
    })
  })

  it('maps a scheme onto every token', () => {
    const v = mapScheme(read(legacyLayout('Night', NIGHT)).colours)
    expect(Object.keys(v).sort()).toEqual([...COLOUR_TOKENS].sort())
    expect([v.bg, v['bg-raised'], v.fg, v.error, v['tok-binder']]).toEqual([
      '#1f1d2b',
      '#2b2838',
      '#c8c3d8',
      '#e8707a',
      '#90d090',
    ])
  })
})
