import { describe, expect, it } from 'vitest'
import { mapScheme, type Scheme } from '../../src/base16'
import { adjustVariant, hexToOklch, type Oklch, oklchToHex, someLuminancePasses } from '../../src/base16-adjust'
import { binderClashes, CONTRAST_FLOORS, contrastRatio, relativeLuminance } from '../../src/contrast'
import type { ColourToken, Variant } from '../../src/palettes'
import { BOXED, CLOSING, DAY, EMBER, keyed, NARROW, NEON, NIGHT, STUCK, TWINS } from './base16-fixtures'

/**
 * `apply adjusted` (Plan 7 part 6b spec §6), on schemes written for the tests: `EMBER` fails 17 floors and every one
 * can be fixed, `TWINS` passes every floor with its binder too close to its operators, and `NEON`'s base01 is a
 * bright green no text colour meets 4.5 on beside a dark base00.
 */

const mapped = (colours: readonly string[]): Variant => mapScheme(keyed(colours) as Scheme['colours'])

/** Every floor `v` fails, as `fg on bg`. */
const failing = (v: Variant): string[] =>
  CONTRAST_FLOORS.filter(([fg, bg, floor]) => contrastRatio(v[fg], v[bg]) < floor).map(([fg, bg]) => `${fg} on ${bg}`)

/** Whether `hex`, as token `t` in `v`, meets every floor `t` has and, for `tok-binder`, stands apart. */
const holds = (v: Variant, t: ColourToken, hex: string): boolean =>
  CONTRAST_FLOORS.every(([fg, bg, floor]) => fg !== t || contrastRatio(hex, v[bg]) >= floor) &&
  (t !== 'tok-binder' || binderClashes({ ...v, [t]: hex }).length === 0)

const SURFACES = ['bg', 'bg-raised', 'bg-chrome', 'rule'] as const

const degrees = (radians: number): number => {
  const d = Math.abs((radians * 180) / Math.PI) % 360
  return d > 180 ? 360 - d : d
}

describe('OKLCH (spec §6.1)', () => {
  // CSS Color 4's own worked value for sRGB red, `oklch(62.8% 0.2577 29.23)`, rather than one this module computed.
  it('gives the published value for sRGB red', () => {
    const red = hexToOklch('#ff0000')
    expect(red.L).toBeCloseTo(0.628, 3)
    expect(red.C).toBeCloseTo(0.2577, 3)
    expect(degrees(red.h)).toBeCloseTo(29.23, 1)
  })

  // ONE PARSER FOR EVERY COLOUR, `contrast.ts`'s: a shorthand or a name read here would come out as `NaN`, not refused.
  it('refuses anything but #rrggbb, as relativeLuminance does', () => {
    for (const bad of ['#fff', 'fff', '#ffffffff', '#GGGGGG', '#FFFFFF', 'red', '']) {
      expect(() => hexToOklch(bad), bad).toThrow(/#rrggbb/)
    }
  })

  it('gives back every fixture colour it is given', () => {
    for (const hex of [...NIGHT, ...EMBER, ...NEON]) expect(oklchToHex(hexToOklch(hex))).toBe(hex)
  })

  it('brings a colour outside sRGB inside by reducing its chroma, its lightness and hue kept', () => {
    const wanted = { L: 0.9, C: 0.3, h: hexToOklch('#ff0000').h }
    const got = hexToOklch(oklchToHex(wanted))
    expect(got.C).toBeLessThan(0.1)
    expect(got.L).toBeCloseTo(0.9, 2)
    expect(degrees(got.h - wanted.h)).toBeLessThan(4)
  })

  // THE LARGEST CHROMA THAT IS INSIDE, NOT JUST ONE THAT IS: a colour on the edge of sRGB has a channel at its limit,
  // full on the light side and empty on the dark, where any chroma short of the edge leaves every channel inside it.
  it('reduces the chroma no further than the edge of sRGB, on the light side and the dark', () => {
    const h = hexToOklch('#ff0000').h
    const channels = (hex: string): string[] => [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
    expect(channels(oklchToHex({ L: 0.9, C: 0.3, h }))).toContain('ff')
    expect(channels(oklchToHex({ L: 0.3, C: 0.3, h }))).toContain('00')
  })
})

describe('adjustVariant (spec §6.2–§6.4)', () => {
  it('meets every floor and the binder rule, on the values it would store', () => {
    expect(failing(mapped(EMBER)).length).toBe(17)
    for (const colours of [EMBER, TWINS]) {
      const { tokens } = adjustVariant(mapped(colours))
      expect(failing(tokens)).toEqual([])
      expect(binderClashes(tokens)).toEqual([])
    }
  })

  it('moves no surface', () => {
    for (const colours of [EMBER, TWINS, NEON]) {
      const v = mapped(colours)
      const { tokens } = adjustVariant(v)
      for (const s of SURFACES) expect(tokens[s], s).toBe(v[s])
    }
  })

  // NO SURFACE MOVES BECAUSE THIS MODULE HOLDS THEM, not because `CONTRAST_FLOORS` happens to name none as a
  // foreground: here a table does, beside a tighter floor for text that shows the table was taken.
  it('moves no surface, even under a floor table that names one as a foreground', () => {
    const v = mapped(EMBER)
    const floors = [...CONTRAST_FLOORS, ['bg-raised', 'bg', 4.5], ['rule', 'bg', 3], ['fg', 'bg', 7]] as const
    expect(contrastRatio(v['bg-raised'], v.bg)).toBeLessThan(4.5)
    const { tokens, moved } = adjustVariant(v, floors)
    expect(contrastRatio(tokens.fg, v.bg)).toBeGreaterThanOrEqual(7)
    for (const s of SURFACES) expect(tokens[s], s).toBe(v[s])
    expect(moved.map((m) => m.token)).not.toContain('bg-raised')
  })

  it("keeps each moved colour's hue within 4° of its own", () => {
    let seen = 0
    for (const colours of [EMBER, TWINS, NEON]) {
      for (const m of adjustVariant(mapped(colours)).moved) {
        const [from, to] = [hexToOklch(m.from), hexToOklch(m.to)]
        // A near-grey's hue is noise: 0.03 of chroma is where the spec's measurement drew the line.
        if (from.C < 0.03 || to.C < 0.03) continue
        seen++
        expect(degrees(to.h - from.h), `${m.token} ${m.from} → ${m.to}`).toBeLessThan(4)
      }
    }
    expect(seen).toBeGreaterThan(8)
  })

  it('moves each colour just enough: a lightness 0.005 nearer its own fails', () => {
    for (const colours of [EMBER, TWINS]) {
      const v = mapped(colours)
      const { tokens, moved } = adjustVariant(v)
      expect(moved.length).toBeGreaterThan(0)
      for (const m of moved) {
        const from = hexToOklch(m.from)
        const L = hexToOklch(m.to).L
        const nearer = oklchToHex({ ...from, L: L - Math.sign(L - from.L) * 0.005 })
        expect(holds(tokens, m.token, m.to), `${m.token} at ${m.to}`).toBe(true)
        expect(holds(tokens, m.token, nearer), `${m.token} at ${nearer}, nearer ${m.from}`).toBe(false)
      }
    }
  })

  it('moves each token alone, so tokens from one scheme colour can end apart', () => {
    const { tokens, moved } = adjustVariant(mapped(EMBER))
    expect(moved.map((m) => m.token)).toEqual([
      'fg',
      'fg-dim',
      'accent',
      'error',
      'tok-neutral',
      'tok-keyword',
      'tok-ident',
      'tok-punct',
    ])
    // `focus-ring` shares base05 with `fg`, and its 3:1 floors already held.
    expect(tokens['focus-ring']).toBe(EMBER[5])
    expect(tokens.fg).not.toBe(EMBER[5])
  })

  it('checks on-accent against the accent the first pass ended with, so it need not move', () => {
    const v = mapped(EMBER)
    expect(contrastRatio(v['on-accent'], v.accent)).toBeLessThan(4.5)
    const { tokens } = adjustVariant(v)
    expect(tokens['on-accent']).toBe(v['on-accent'])
    expect(contrastRatio(tokens['on-accent'], tokens.accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('moves a binder that sits too close the shorter way, until it stands apart', () => {
    const v = mapped(TWINS)
    expect(binderClashes(v)).toEqual([{ token: 'tok-operator', apart: 16 }])
    expect(adjustVariant(v).moved).toEqual([{ token: 'tok-binder', from: '#78c8b8', to: '#70c0b0' }])
  })

  it('moves a binder that clashes only with where another token moved to, until it stands apart from that', () => {
    const v = mapped(CLOSING)
    expect(binderClashes(v)).toEqual([])
    const { tokens, moved } = adjustVariant(v)
    expect(moved.map((m) => m.token)).toEqual(['tok-operator', 'tok-binder'])
    expect(binderClashes({ ...tokens, 'tok-binder': v['tok-binder'] })).toEqual([{ token: 'tok-operator', apart: 13 }])
    expect(binderClashes(tokens)).toEqual([])
    expect(failing(tokens)).toEqual([])
  })

  it('keeps a binder no lightness sets apart from where the others moved to, and names it', () => {
    const v = mapped(BOXED)
    expect(binderClashes(v)).toEqual([])
    expect(failing(v)).not.toContain('tok-binder on bg')
    const { tokens, unfixed } = adjustVariant(v)
    expect(unfixed).toEqual([{ token: 'tok-binder', rule: 'binder' }])
    expect(tokens['tok-binder']).toBe(v['tok-binder'])
    expect(binderClashes(tokens).map((c) => c.token)).toEqual([
      'fg',
      'fg-dim',
      'accent',
      'error',
      'tok-neutral',
      'tok-keyword',
      'tok-ident',
      'tok-nat',
      'tok-bool',
      'tok-operator',
      'tok-punct',
    ])
    expect(failing(tokens)).toEqual([])
  })

  // BOTH ARE SO, AND THE CHECK SAYS BOTH: the floors in the line about what still fails, the binder in its own.
  it('names a binder that fails its floors and clashes twice, its floors first and then the binder rule', () => {
    const v = mapped(NEON.map((c, i) => (i === 11 ? NEON[12] : c)))
    expect(adjustVariant(v).unfixed.filter((u) => u.token === 'tok-binder')).toEqual([
      { token: 'tok-binder', rule: 'floors' },
      { token: 'tok-binder', rule: 'binder' },
    ])
  })

  // A BINDER MOVED FOR ITS FLOORS, THEN HELD TO THE BINDER RULE AND NAMED FOR IT, KEEPS WHERE THE FLOORS MOVED IT: its
  // walk for the binder rule began there. `BOXED` with its binder in the same dark grey as the rest.
  it('keeps a binder named for the binder rule at the value its walk began from, the one its floors moved it to', () => {
    const v = mapped(BOXED.map((c, i) => (i === 11 ? '#202020' : c)))
    const { tokens, moved, unfixed } = adjustVariant(v)
    expect(unfixed).toEqual([{ token: 'tok-binder', rule: 'binder' }])
    expect(moved.find((m) => m.token === 'tok-binder')).toEqual({ token: 'tok-binder', from: '#202020', to: '#757575' })
    expect(holds(tokens, 'tok-binder', tokens['tok-binder'])).toBe(false)
    expect(failing(tokens)).toEqual([])
  })

  it('keeps each token no lightness can fix at its own value, adjusts the rest, and names what is left', () => {
    const v = mapped(NEON)
    const { tokens, moved, unfixed } = adjustVariant(v)
    expect(unfixed.map((u) => `${u.token} ${u.rule}`)).toEqual([
      'fg floors',
      'fg-dim floors',
      'accent floors',
      'error floors',
      'tok-neutral floors',
      'tok-keyword floors',
      'tok-ident floors',
      'tok-nat floors',
      'tok-bool floors',
      'tok-operator floors',
      'tok-punct floors',
      'tok-binder floors',
    ])
    for (const u of unfixed) expect(tokens[u.token], u.token).toBe(v[u.token])
    expect(moved.map((m) => m.token)).toEqual(['focus-ring', 'warn'])
    expect(failing(tokens).filter((f) => f.startsWith('focus-ring') || f.startsWith('warn'))).toEqual([])
  })

  it('finds a passing lightness in a band narrower than one step of the walk', () => {
    const v = mapped(NARROW)
    const { tokens, unfixed } = adjustVariant(v)
    expect(unfixed.map((u) => `${u.token} ${u.rule}`)).toEqual([
      'fg floors',
      'fg-dim floors',
      'accent floors',
      'error floors',
      'tok-neutral floors',
      'tok-keyword floors',
      'tok-ident floors',
      'tok-nat floors',
      'tok-bool floors',
      'tok-operator floors',
      'tok-punct floors',
      'tok-binder floors',
    ])
    // THE NEAREST PASSING COLOUR, AT ITS OWN HUE: warnings from `#e8c878` at lightness 0.843 to 0.466.
    expect([tokens.warn, tokens['focus-ring']]).toEqual(['#6f5600', '#5b5769'])
    for (const t of ['warn', 'focus-ring'] as const) {
      expect(holds(tokens, t, tokens[t]), `${t} at ${tokens[t]}`).toBe(true)
      expect(degrees(hexToOklch(tokens[t]).h - hexToOklch(v[t]).h), t).toBeLessThan(4)
    }
  })

  // `NIGHT` on `#101010` under `#b3b3b3`: the band the walk steps over holds two colours for each, and the nearer wins.
  it('takes, of the colours the fine scan finds, the one nearest its own lightness', () => {
    const v = mapped(NIGHT.map((c, i) => (i === 0 ? '#101010' : i === 1 ? '#b3b3b3' : c)))
    const { tokens } = adjustVariant(v)
    expect([tokens.warn, tokens['focus-ring']]).toEqual(['#785c00', '#625d70'])
  })

  it('moves nothing in a scheme that passes', () => {
    expect(adjustVariant(mapped(NIGHT))).toEqual({ tokens: mapped(NIGHT), moved: [], unfixed: [] })
  })
})

/**
 * WHERE NO LUMINANCE MEETS A TOKEN'S FLOORS, NO COLOUR CAN, and the adjustment asks no lightness at all: the check
 * that says so, against luminances the WCAG formula gives by hand.
 */
describe('the luminances that meet a set of floors', () => {
  const black = relativeLuminance('#000000')
  const panel = relativeLuminance('#aaaaaa')

  it('are none for 4.5:1 on both black and #aaaaaa, which needs a luminance at least 0.175 and at most 0.050', () => {
    expect(someLuminancePasses([[black, 4.5]])).toBe(true)
    expect(someLuminancePasses([[panel, 4.5]])).toBe(true)
    expect(
      someLuminancePasses([
        [black, 4.5],
        [panel, 4.5],
      ]),
    ).toBe(false)
  })

  // `NARROW`'s warnings: 3:1 on both holds from luminance 0.100 up to (0.402 + 0.05) / 3 − 0.05, about 0.101.
  it('are some for 3:1 on both, in a band a thousandth wide, and none once a floor moves it past the other', () => {
    expect(
      someLuminancePasses([
        [black, 3],
        [panel, 3],
      ]),
    ).toBe(true)
    expect(
      someLuminancePasses([
        [black, 3.02],
        [panel, 3.02],
      ]),
    ).toBe(false)
  })

  it('include one that meets a floor exactly, and the ends, 0 and 1', () => {
    expect(someLuminancePasses([[black, 21]])).toBe(true)
    expect(someLuminancePasses([[relativeLuminance('#ffffff'), 21]])).toBe(true)
    expect(someLuminancePasses([[black, 21.001]])).toBe(false)
  })
})

/**
 * **NO TOKEN IS CALLED UNFIXABLE THAT SOME LIGHTNESS FIXES** (spec §6.4). Every lightness from 0 to 1 in steps of
 * 1/10,000, at the token's own hue and chroma and rounded, is held to what the token had to meet; for a token the
 * adjustment names, none may pass. The schemes are the fixtures, `NIGHT` on greys where a passing band is narrower
 * than one step of the walk, and schemes of random colours.
 */
describe('what apply adjusted cannot fix', () => {
  /** Each colour a lightness scan of `from` rounds to, once: what "some lightness" can give, at its hue. */
  const scans = new Map<string, readonly string[]>()
  const scan = (hex: string): readonly string[] => {
    const from: Oklch = hexToOklch(hex)
    const seen = scans.get(hex) ?? [
      ...new Set(Array.from({ length: 10_001 }, (_, i) => oklchToHex({ ...from, L: i / 10_000 }))),
    ]
    scans.set(hex, seen)
    return seen
  }

  /** A seeded generator, so a failure names a scheme that stays the same. */
  const random = (seed: number): (() => string) => {
    let s = seed
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648
      return `#${Math.floor((s / 2147483648) * 0x1000000)
        .toString(16)
        .padStart(6, '0')}`
    }
  }
  const grey = (n: number): string => `#${n.toString(16).padStart(2, '0').repeat(3)}`

  const schemes: [string, readonly string[]][] = [
    ...Object.entries({ NIGHT, DAY, EMBER, NEON, TWINS, STUCK, CLOSING, BOXED, NARROW }),
    ['BOXED, its binder in the dark grey too', BOXED.map((c, i) => (i === 11 ? '#202020' : c))],
    // WHERE THE WALK STEPPED OVER A BAND: black under `#ababab`, `#0c0c0c` under `#b1b1b1` (a warning's band 0.0002
    // wide), `#101010` under `#b3b3b3`, `#202020` under `#c2c2c2`; and where no band is there at all for warnings and
    // the focus ring: `#101010` under `#aaaaaa`, `#202020` under `#b4b4b4`.
    ...[
      [0x00, 0xab],
      [0x0c, 0xb1],
      [0x10, 0xaa],
      [0x10, 0xb3],
      [0x20, 0xb4],
      [0x20, 0xc2],
    ].map(([page = 0, panels = 0]): [string, readonly string[]] => [
      `NIGHT on ${grey(page)} and ${grey(panels)}`,
      NIGHT.map((c, i) => (i === 0 ? grey(page) : i === 1 ? grey(panels) : c)),
    ]),
    ...[1, 2, 3, 4, 5].map((seed): [string, readonly string[]] => {
      const next = random(seed)
      return [`random ${seed}`, Array.from({ length: 16 }, next)]
    }),
  ]

  it('names only tokens no lightness on a fine scan fixes, and every other token passes on its stored value', () => {
    let named = 0
    for (const [label, colours] of schemes) {
      const v = mapped(colours)
      const { tokens, unfixed } = adjustVariant(v)
      for (const { token, rule } of unfixed) {
        named++
        const meets = (hex: string): boolean =>
          CONTRAST_FLOORS.every(([fg, bg, floor]) => fg !== token || contrastRatio(hex, tokens[bg]) >= floor)
        // EACH KEEPS THE VALUE ITS WALK BEGAN FROM: its own, or, for a binder held to the binder rule, the value its
        // floors moved it to, which then meets them. The scan is from that value, at its hue and chroma.
        const began = tokens[token]
        if (rule === 'floors' || !meets(began)) expect(began, `${label}: ${token} keeps its own value`).toBe(v[token])
        const ok = rule === 'binder' ? (hex: string) => holds(tokens, token, hex) : meets
        expect(scan(began).find(ok), `${label}: ${token} ${rule}`).toBeUndefined()
      }
      const unfixable = new Set(unfixed.map((u) => u.token))
      const passing = failing(tokens).filter((f) => !unfixable.has(f.split(' on ')[0] as ColourToken))
      expect(passing, label).toEqual([])
    }
    expect(named).toBeGreaterThan(100)
  })
})
