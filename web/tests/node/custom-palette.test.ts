import { describe, expect, it } from 'vitest'
import { mapScheme } from '../../src/base16'
import { CONTRAST_FLOORS, contrastRatio, groundOf } from '../../src/contrast'
import {
  CUSTOM_PALETTE_VERSION,
  type CustomPalette,
  halfTokens,
  parseCustomPalette,
  serializeCustomPalette,
  withHalf,
  withoutHalf,
} from '../../src/custom-palette'
import { adjustedHalf, beforeResult, CLOSING, DAY, NIGHT, storedHalf } from './base16-fixtures'

const NIGHT_HALF = storedHalf('Night', NIGHT)
const DAY_HALF = storedHalf('Day', DAY)

/** The stored JSON for `{ light: DAY_HALF, dark: NIGHT_HALF }`, with `edit` applied to its parsed form first. */
function stored(edit: (json: Record<string, unknown>) => void = () => {}): string {
  const json = JSON.parse(serializeCustomPalette({ light: DAY_HALF, dark: NIGHT_HALF })) as Record<string, unknown>
  edit(json)
  return JSON.stringify(json)
}

const darkHalf = (json: Record<string, unknown>) => json.dark as Record<string, unknown>

describe('the custom palette store (Plan 7 part 6b spec §7.1)', () => {
  it('reads back what it wrote, both halves and one', () => {
    expect(parseCustomPalette(stored())).toEqual({ light: DAY_HALF, dark: NIGHT_HALF })
    expect(parseCustomPalette(serializeCustomPalette({ dark: NIGHT_HALF }))).toEqual({ dark: NIGHT_HALF })
    expect(JSON.parse(stored()).version).toBe(CUSTOM_PALETTE_VERSION)
  })

  it('has no palette with neither half, by its type as by its store', () => {
    // @ts-expect-error — `CustomPalette` needs a half: a store with none is no store (spec §7.1), and reads as `null`.
    const neither: CustomPalette = {}
    expect(parseCustomPalette(serializeCustomPalette(neither))).toBeNull()
  })

  it('reads nothing stored, and a store with no half, as nothing imported', () => {
    expect(parseCustomPalette(null)).toBeNull()
    expect(parseCustomPalette(JSON.stringify({ version: CUSTOM_PALETTE_VERSION }))).toBeNull()
  })

  it.each([
    ['text that is not JSON', () => '{"version": 1, "dark":'],
    ['a value that is not an object', () => '"dark"'],
    ['another version', () => stored((j) => (j.version = 2))],
    ['a half that is not an object', () => stored((j) => (j.light = 'Day'))],
    ['a half that is null', () => stored((j) => (j.light = null))],
    ['a name that is not a string', () => stored((j) => (darkHalf(j).name = 7))],
    [
      'colours without one of the sixteen',
      () => stored((j) => delete (darkHalf(j).colours as Record<string, string>).base0C),
    ],
    [
      'a colour that is not lowercase #rrggbb',
      () => stored((j) => ((darkHalf(j).colours as Record<string, string>).base05 = '#C8C3D8')),
    ],
    ['an adjusted that is not a boolean', () => stored((j) => (darkHalf(j).adjusted = 'yes'))],
    ['tokens that are not an object', () => stored((j) => (darkHalf(j).tokens = null))],
    ['tokens that are an array', () => stored((j) => (darkHalf(j).tokens = []))],
    [
      'a token that is not lowercase #rrggbb',
      () => stored((j) => ((darkHalf(j).tokens as Record<string, string>).fg = 'white')),
    ],
  ])('refuses the whole store for %s', (_, raw) => {
    expect(parseCustomPalette(raw())).toBeNull()
  })

  it('keeps a half that lacks a token, and drops a token name it does not know', () => {
    const raw = stored((j) => {
      const tokens = darkHalf(j).tokens as Record<string, string>
      delete tokens['tok-binder']
      tokens['tok-retired'] = 'not even a colour'
    })
    const { 'tok-binder': _, ...rest } = NIGHT_HALF.tokens
    expect(parseCustomPalette(raw)?.dark?.tokens).toEqual(rest)
  })

  it('completes a half stored before the result tokens from its colours', () => {
    const day = beforeResult(storedHalf('Day', DAY))
    const closing = beforeResult(adjustedHalf('Closing', CLOSING, 'dark'))
    expect([day.tokens.result, closing.tokens['result-word']]).toEqual([undefined, undefined])
    const dayTokens = halfTokens(day)
    expect([dayTokens.result, dayTokens['result-word']]).toEqual([DAY[11], DAY[11]])
    const closingTokens = halfTokens(closing)
    expect(closingTokens.result).toBe(CLOSING[11])
    expect(closingTokens['result-word']).not.toBe(CLOSING[11])
    for (const f of CONTRAST_FLOORS.filter(([fg]) => fg === 'result-word')) {
      expect(contrastRatio(closingTokens['result-word'], groundOf(closingTokens, f))).toBeGreaterThanOrEqual(4.5)
    }
    expect(closingTokens).toEqual(adjustedHalf('Closing', CLOSING, 'dark').tokens)
    expect(dayTokens).toMatchObject(day.tokens)
    expect(closingTokens).toMatchObject(closing.tokens)
  })

  it('completes an unadjusted half from its colours alone, though its word fails a floor', () => {
    const half = beforeResult(storedHalf('Closing', CLOSING))
    const applied = mapScheme(half.colours)
    expect(
      CONTRAST_FLOORS.filter(([fg]) => fg === 'result-word').some(
        (f) => contrastRatio(applied['result-word'], groundOf(applied, f)) < f[2],
      ),
      "precondition: Closing's word, base0B, fails a floor an adjustment would move it to meet",
    ).toBe(true)
    const tokens = halfTokens(half)
    expect([tokens.result, tokens['result-word']], 'the result tokens, base0B as mapped').toEqual([
      CLOSING[11],
      CLOSING[11],
    ])
  })

  it('replaces one half on an import and keeps the other', () => {
    const next = storedHalf('Next', NIGHT)
    expect(withHalf({ light: DAY_HALF, dark: NIGHT_HALF }, 'dark', next)).toEqual({ light: DAY_HALF, dark: next })
    expect(withHalf(null, 'light', DAY_HALF)).toEqual({ light: DAY_HALF })
  })

  it('removes either half and keeps the other, and removing the last leaves nothing to store', () => {
    expect(withoutHalf({ light: DAY_HALF, dark: NIGHT_HALF }, 'light')).toEqual({ dark: NIGHT_HALF })
    expect(withoutHalf({ light: DAY_HALF, dark: NIGHT_HALF }, 'dark')).toEqual({ light: DAY_HALF })
    expect(withoutHalf({ dark: NIGHT_HALF }, 'dark')).toBeNull()
  })
})
