import { describe, expect, it } from 'vitest'
import {
  forgetCopies,
  PROGRAM_VERSION,
  parseProgram,
  type StoredProgram,
  serializeProgram,
} from '../../src/program-store'
import { hostileStorage, memoryStorage } from './storage-fixture'

/** The encodings `main.ts` hands in, as `encodings()` lists them today. */
const ENCODINGS = ['unary', 'binary']

/** The widths `main.ts` hands in, as `fieldWidths()` lists them today. */
const WIDTHS = Array.from({ length: 64 }, (_, i) => i + 1)

const PROGRAM: StoredProgram = { text: 'let x = 40;\nx + 2\n', encoding: 'binary', width: null, listing: 'as-built' }

/** A raw value with `fields` merged over a valid one, at auto — the shape a hand-edit produces. */
const raw = (fields: Record<string, unknown>): string =>
  JSON.stringify({ version: PROGRAM_VERSION, text: PROGRAM.text, encoding: PROGRAM.encoding, ...fields })

describe('parseProgram', () => {
  it('round-trips a program: its text, whatever it holds, its encoding, its width and its listing', () => {
    expect(parseProgram(serializeProgram(PROGRAM), ENCODINGS, WIDTHS)).toEqual(PROGRAM)
    const odd: StoredProgram = { text: '', encoding: 'unary', width: null, listing: 'as-built' }
    expect(parseProgram(serializeProgram(odd), ENCODINGS, WIDTHS)).toEqual(odd)
    for (const width of [4, 8, 64]) {
      const pinned: StoredProgram = { ...PROGRAM, width }
      expect(parseProgram(serializeProgram(pinned), ENCODINGS, WIDTHS), `width ${width}`).toEqual(pinned)
    }
    const optimised: StoredProgram = { ...PROGRAM, width: 8, listing: 'optimised' }
    expect(parseProgram(serializeProgram(optimised), ENCODINGS, WIDTHS)).toEqual(optimised)
  })

  it('writes version 1, the text and the encoding, and nothing else', () => {
    expect(JSON.parse(serializeProgram(PROGRAM))).toEqual({ version: 1, text: PROGRAM.text, encoding: 'binary' })
  })

  /**
   * **AN AUTO PROGRAM IS STORED WITH NO `width` KEY** (the TM width design, decision 14), so it is the version-1
   * payload every build at this version reads as this program: the literal is that payload. A width left out is
   * auto, as `null` is.
   */
  it('stores auto with no width key, and a pinned width beside the encoding', () => {
    const auto = '{"version":1,"text":"let x = 40;\\nx + 2\\n","encoding":"binary"}'
    expect(serializeProgram(PROGRAM)).toBe(auto)
    expect(serializeProgram({ text: PROGRAM.text, encoding: 'binary' })).toBe(auto)
    expect(serializeProgram({ ...PROGRAM, width: 8 })).toBe(
      '{"version":1,"text":"let x = 40;\\nx + 2\\n","encoding":"binary","width":8}',
    )
  })

  it('reads a program stored with no width as auto', () => {
    expect(parseProgram(raw({}), ENCODINGS, WIDTHS)).toStrictEqual(PROGRAM)
  })

  /**
   * **A PROGRAM AS BUILT IS STORED WITH NO `listing` KEY**, as auto is stored with no `width`, so it is the version-1
   * payload every build at this version reads as this program, and `PROGRAM_VERSION` stays 1. Optimised sits after the
   * width.
   */
  it('stores as built with no listing key, and optimised after the width', () => {
    expect(PROGRAM_VERSION).toBe(1)
    expect(serializeProgram(PROGRAM)).toBe('{"version":1,"text":"let x = 40;\\nx + 2\\n","encoding":"binary"}')
    expect(serializeProgram({ ...PROGRAM, listing: 'optimised' })).toBe(
      '{"version":1,"text":"let x = 40;\\nx + 2\\n","encoding":"binary","listing":"optimised"}',
    )
    expect(serializeProgram({ ...PROGRAM, width: 8, listing: 'optimised' })).toBe(
      '{"version":1,"text":"let x = 40;\\nx + 2\\n","encoding":"binary","width":8,"listing":"optimised"}',
    )
  })

  it('reads a program stored as optimised as optimised', () => {
    expect(parseProgram(raw({ listing: 'optimised' }), ENCODINGS, WIDTHS)).toStrictEqual({
      ...PROGRAM,
      listing: 'optimised',
    })
  })

  /**
   * **A LISTING IT DOES NOT KNOW READS AS BUILT, AND REFUSES NOTHING**, as a width it does not list reads as auto:
   * refusing the program would lose its text over a field that only says which listing its CLIF views show.
   */
  it('reads a listing it does not know, or none, as built, and keeps the text and the encoding', () => {
    expect(parseProgram(raw({}), ENCODINGS, WIDTHS)?.listing).toBe('as-built')
    for (const listing of [
      'sideways',
      'as built',
      'Optimised',
      null,
      true,
      1,
      ['optimised'],
      { listing: 'optimised' },
    ]) {
      expect(parseProgram(raw({ listing }), ENCODINGS, WIDTHS), JSON.stringify(listing)).toStrictEqual(PROGRAM)
    }
  })

  /**
   * **A WIDTH IT DOES NOT LIST READS AS AUTO, AND THE PROGRAM IS KEPT** (decision 15): refusing it would lose the text
   * for a field a hand-edit or another build wrote. Only an integer `widths` lists is a width: wasm-bindgen's `u32`
   * glue would turn `16.7`, `2 ** 32 + 16` and `"8"` into widths before Rust's own check could refuse them.
   */
  it('reads a width it does not list as auto, and keeps the text and the encoding', () => {
    for (const width of [65, 0, -8, 16.7, 2 ** 32 + 16, '8', null, true, [8], { width: 8 }]) {
      expect(parseProgram(raw({ width }), ENCODINGS, WIDTHS), JSON.stringify(width)).toStrictEqual(PROGRAM)
    }
    // THE LIST IS THE ONE HANDED IN, NOT A RANGE OF ITS OWN: a width a build stops offering reads as auto.
    expect(parseProgram(raw({ width: 8 }), ENCODINGS, [4, 16])).toStrictEqual(PROGRAM)
  })

  it('answers null for nothing stored', () => {
    expect(parseProgram(null, ENCODINGS, WIDTHS)).toBeNull()
  })

  it('answers null for text that is not JSON, or JSON that is not an object', () => {
    expect(parseProgram('{"version": 1, "text"', ENCODINGS, WIDTHS)).toBeNull()
    expect(parseProgram('null', ENCODINGS, WIDTHS)).toBeNull()
    expect(parseProgram('"let x = 1"', ENCODINGS, WIDTHS)).toBeNull()
  })

  /**
   * **A JSON ARRAY IS NOT A PROGRAM**, and what refuses it is that it has no `version`: JSON gives an array no named
   * fields, so no array can reach a check past the version's, and a check of its own could not be told apart from it.
   */
  it('answers null for a JSON array, whatever it holds', () => {
    expect(parseProgram('[]', ENCODINGS, WIDTHS)).toBeNull()
    expect(
      parseProgram(JSON.stringify([PROGRAM_VERSION, PROGRAM.text, PROGRAM.encoding]), ENCODINGS, WIDTHS),
    ).toBeNull()
  })

  /**
   * **A FIELD IT DOES NOT KNOW IS DROPPED, NOT REFUSED.** Spec §4.3 lists what refuses a stored program, and an extra
   * field is not among them: a later shape bumps `version`, which refuses it, so an unknown field beside version 1 comes
   * from a hand-edit rather than a later version, and the program under it is still whole.
   */
  it('takes a program with fields it does not know, and drops them', () => {
    expect(parseProgram(raw({ at: 3, note: 'hand-edited' }), ENCODINGS, WIDTHS)).toStrictEqual(PROGRAM)
  })

  it('answers null for another version, or none', () => {
    expect(parseProgram(raw({ version: 2 }), ENCODINGS, WIDTHS)).toBeNull()
    expect(parseProgram(raw({ version: '1' }), ENCODINGS, WIDTHS)).toBeNull()
    expect(
      parseProgram(JSON.stringify({ text: PROGRAM.text, encoding: PROGRAM.encoding }), ENCODINGS, WIDTHS),
    ).toBeNull()
  })

  it('answers null for a text that is not a string', () => {
    expect(parseProgram(raw({ text: 42 }), ENCODINGS, WIDTHS)).toBeNull()
    expect(parseProgram(raw({ text: null }), ENCODINGS, WIDTHS)).toBeNull()
  })

  it('answers null for an encoding the build does not offer', () => {
    expect(parseProgram(raw({ encoding: 'ternary' }), ENCODINGS, WIDTHS)).toBeNull()
    expect(parseProgram(raw({ encoding: 1 }), ENCODINGS, WIDTHS)).toBeNull()
    expect(parseProgram(raw({ encoding: undefined }), ENCODINGS, WIDTHS)).toBeNull()
    // THE LIST IS THE ONE HANDED IN, NOT A LIST OF ITS OWN: an encoding a build stops offering is refused.
    expect(parseProgram(raw({}), ['unary'], WIDTHS)).toBeNull()
  })
})

describe('forgetCopies', () => {
  it('removes redextape.buffers and leaves every other key', () => {
    const store = memoryStorage({ 'redextape.buffers': '{}', 'redextape.program': 'p', 'redextape.layout': 'l' })
    forgetCopies(store)
    expect(store.getItem('redextape.buffers')).toBeNull()
    expect([store.getItem('redextape.program'), store.getItem('redextape.layout')]).toEqual(['p', 'l'])
  })

  it('returns quietly when the storage refuses', () => {
    expect(() => forgetCopies(hostileStorage())).not.toThrow()
  })
})
