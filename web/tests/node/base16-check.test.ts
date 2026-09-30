import { describe, expect, it } from 'vitest'
import { readScheme, type Scheme } from '../../src/base16'
import {
  adjustLine,
  checkScheme,
  failureLines,
  movedColours,
  movedLine,
  passes,
  summaryLines,
} from '../../src/base16-check'
import { currentLayout, EMBER, keyed, legacyLayout, NEON, NIGHT, STUCK, TWINS } from './base16-fixtures'

/**
 * The check (Plan 7 part 6b spec §5.3), `base16-check.ts`'s, on schemes read from the fixtures: its summary, what
 * `apply adjusted` does, the failures grouped by scheme colour and the colours an adjustment moved, in words.
 */

/** The scheme `text` reads as, or a failure naming its errors. */
function read(text: string): Scheme {
  const r = readScheme(text)
  if (!r.ok) throw new Error(`did not read: ${r.errors.join('; ')}`)
  return r.scheme
}

describe('the check (spec §5.3)', () => {
  const check = (text: string) => checkScheme(read(text))

  it('says a scheme that passes passes, and offers nothing to adjust', () => {
    const c = check(currentLayout('Night', NIGHT, 'dark'))
    expect(passes(c)).toBe(true)
    expect(summaryLines(c)).toEqual(['Night · dark, from the file: every contrast check passes'])
    expect(adjustLine(c)).toBeNull()
    expect(failureLines(c)).toEqual([])
  })

  it('counts the checks a scheme fails and gives the worst, in one line', () => {
    const c = check(legacyLayout('Ember', EMBER))
    expect(passes(c)).toBe(false)
    expect(summaryLines(c)).toEqual(['Ember · dark, detected: 17 of 35 contrast checks below WCAG AA, worst 3.31:1'])
  })

  it('lists the failures grouped by scheme colour pair, in words, the furthest below its floor first', () => {
    expect(failureLines(check(legacyLayout('Ember', EMBER)))).toEqual([
      'base04 on base01: dim text, plain code and punctuation on panels and headers — 3.31:1, needs 4.5',
      'base0E on base01: accents and keywords on panels — 3.43:1, needs 4.5',
      'base08 on base01: error text on panels — 3.53:1, needs 4.5',
      'base05 on base01: text and names on panels and headers — 3.93:1, needs 4.5',
      'base04 on base00: dim text, plain code and punctuation on the page — 3.96:1, needs 4.5',
      'base0E on base00: accents and keywords on the page — 4.10:1, needs 4.5',
      'base00 on base0E: text on accents — 4.10:1, needs 4.5',
      'base08 on base00: error text on the page — 4.21:1, needs 4.5',
    ])
  })

  it('says what apply adjusted does, one line per colour it moves', () => {
    const c = check(legacyLayout('Ember', EMBER))
    expect(adjustLine(c)).toBe('apply adjusted moves 4 colours’ lightness, and every check then passes')
    expect(movedColours(c.scheme.colours, c.adjustment.tokens).map(movedLine)).toEqual([
      'base04 #7e7590 → #958ca7, as dim text, plain code and punctuation',
      'base05 #8a829a → #958ca5, as text and names',
      'base08 #c06070 → #d57382, as error text',
      'base0E #9070a0 → #a584b5, as accents and keywords',
    ])
  })

  it('says what still fails, and where, when no lightness passes', () => {
    const c = check(currentLayout('Neon', NEON, 'dark'))
    // accents fail 4.5 on panels and 3 on headers, one pair of colours: the line gives the floor it misses by most. The
    // warnings' 1.09:1 against their 3 sits below the text's 1.28:1 against 4.5, as each misses its floor by less.
    expect(failureLines(c)).toEqual([
      'base0B on base01: binders on panels — 1.03:1, needs 4.5',
      'base0C on base01: operators on panels — 1.05:1, needs 4.5',
      'base04 on base01: dim text, plain code and punctuation on panels and headers — 1.09:1, needs 4.5',
      'base05 on base01: text, the focus ring and names on panels and headers — 1.25:1, needs 4.5',
      'base0E on base01: accents and keywords on panels and headers — 1.28:1, needs 4.5',
      'base09 on base01: numbers and booleans on panels — 1.28:1, needs 4.5',
      'base0A on base01: warnings on panels and headers — 1.09:1, needs 3',
      'base08 on base01: error text on panels and headers — 1.74:1, needs 4.5',
    ])
    expect(adjustLine(c)).toBe(
      'apply adjusted moves 2 colours’ lightness; 16 checks still fail, where no lightness passes on both base00 and base01',
    )
  })

  it('names a binder too close to another colour, and says so when no lightness sets it apart', () => {
    const twins = check(currentLayout('Twins', TWINS, 'dark'))
    expect(summaryLines(twins)).toEqual([
      'Twins · dark, from the file: every contrast check passes; binders too close to 1 other colour',
    ])
    expect(failureLines(twins)).toEqual(['base0B beside base0C: binders too close to operators — 16 apart, needs 24'])
    expect(adjustLine(twins)).toBe('apply adjusted moves 1 colour’s lightness, and every check then passes')
    const stuck = check(legacyLayout('', STUCK))
    expect(summaryLines(stuck)).toEqual([
      'untitled · dark, detected: every contrast check passes; binders too close to 8 other colours',
    ])
    expect(adjustLine(stuck)).toBe(
      'apply adjusted moves no colour’s lightness; binders stay too close to 8 other colours, where no lightness sets them apart',
    )
  })

  it('notes that a base24 scheme’s eight extra colours are not used', () => {
    const extra = ['10', '11', '12', '13', '14', '15', '16', '17'].map((k) => `  base${k}: "#000000"`)
    expect(summaryLines(check(`${currentLayout('Night', NIGHT, 'dark')}${extra.join('\n')}\n`))).toEqual([
      'Night · dark, from the file: every contrast check passes',
      'base24: its eight extra colours, base10–base17, are not used',
    ])
  })

  it('reads what changed off a scheme’s own colours and the tokens applied, a token left out included', () => {
    const colours = keyed(EMBER) as Scheme['colours']
    const { tokens } = checkScheme(read(legacyLayout('Ember', EMBER))).adjustment
    const { fg, error, 'focus-ring': ring } = tokens
    expect(movedColours(colours, { fg, error, 'focus-ring': ring }).map(movedLine)).toEqual([
      'base05 #8a829a → #958ca5, as text',
      'base08 #c06070 → #d57382, as error text',
    ])
  })
})
