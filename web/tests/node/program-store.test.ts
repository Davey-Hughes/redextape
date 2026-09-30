import { describe, expect, it } from 'vitest'
import { PROGRAM_VERSION, parseProgram, type StoredProgram, serializeProgram } from '../../src/program-store'

/** The encodings `main.ts` hands in, as `encodings()` lists them today. */
const ENCODINGS = ['unary', 'binary']

const PROGRAM: StoredProgram = { text: 'let x = 40;\nx + 2\n', encoding: 'binary' }

/** A raw value with `fields` merged over a valid one — the shape a hand-edit produces. */
const raw = (fields: Record<string, unknown>): string =>
  JSON.stringify({ version: PROGRAM_VERSION, ...PROGRAM, ...fields })

describe('parseProgram', () => {
  it('round-trips a program: its text, whatever it holds, and its encoding', () => {
    expect(parseProgram(serializeProgram(PROGRAM), ENCODINGS)).toEqual(PROGRAM)
    const odd: StoredProgram = { text: '', encoding: 'unary' }
    expect(parseProgram(serializeProgram(odd), ENCODINGS)).toEqual(odd)
  })

  it('writes version 1, the text and the encoding, and nothing else', () => {
    expect(JSON.parse(serializeProgram(PROGRAM))).toEqual({ version: 1, text: PROGRAM.text, encoding: 'binary' })
  })

  it('answers null for nothing stored', () => {
    expect(parseProgram(null, ENCODINGS)).toBeNull()
  })

  it('answers null for text that is not JSON, or JSON that is not an object', () => {
    expect(parseProgram('{"version": 1, "text"', ENCODINGS)).toBeNull()
    expect(parseProgram('null', ENCODINGS)).toBeNull()
    expect(parseProgram('"let x = 1"', ENCODINGS)).toBeNull()
  })

  /**
   * **A JSON ARRAY IS NOT A PROGRAM**, and what refuses it is that it has no `version`: JSON gives an array no named
   * fields, so no array can reach a check past the version's, and a check of its own could not be told apart from it.
   */
  it('answers null for a JSON array, whatever it holds', () => {
    expect(parseProgram('[]', ENCODINGS)).toBeNull()
    expect(parseProgram(JSON.stringify([PROGRAM_VERSION, PROGRAM.text, PROGRAM.encoding]), ENCODINGS)).toBeNull()
  })

  /**
   * **A FIELD IT DOES NOT KNOW IS DROPPED, NOT REFUSED.** Spec §4.3 lists what refuses a stored program, and an extra
   * field is not among them: a later shape bumps `version`, which refuses it, so an unknown field beside version 1 comes
   * from a hand-edit rather than a later version, and the program under it is still whole.
   */
  it('takes a program with fields it does not know, and drops them', () => {
    expect(parseProgram(raw({ at: 3, note: 'hand-edited' }), ENCODINGS)).toStrictEqual(PROGRAM)
  })

  it('answers null for another version, or none', () => {
    expect(parseProgram(raw({ version: 2 }), ENCODINGS)).toBeNull()
    expect(parseProgram(raw({ version: '1' }), ENCODINGS)).toBeNull()
    expect(parseProgram(JSON.stringify(PROGRAM), ENCODINGS)).toBeNull()
  })

  it('answers null for a text that is not a string', () => {
    expect(parseProgram(raw({ text: 42 }), ENCODINGS)).toBeNull()
    expect(parseProgram(raw({ text: null }), ENCODINGS)).toBeNull()
  })

  it('answers null for an encoding the build does not offer', () => {
    expect(parseProgram(raw({ encoding: 'ternary' }), ENCODINGS)).toBeNull()
    expect(parseProgram(raw({ encoding: 1 }), ENCODINGS)).toBeNull()
    expect(parseProgram(raw({ encoding: undefined }), ENCODINGS)).toBeNull()
    // THE LIST IS THE ONE HANDED IN, NOT A LIST OF ITS OWN: an encoding a build stops offering is refused.
    expect(parseProgram(raw({}), ['unary'])).toBeNull()
  })
})
