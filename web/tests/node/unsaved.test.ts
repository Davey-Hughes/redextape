import { describe, expect, it } from 'vitest'
import { createUnsaved, refusalOf, unsavedLine } from '../../src/unsaved'

const FULL = 'not being saved — this browser’s storage for this site is full'
const BLOCKED = 'not being saved — this browser’s storage for this site is blocked'

describe('unsavedLine', () => {
  it('names the program and says the storage is full', () => {
    expect(unsavedLine('full')).toBe(`the program is ${FULL}`)
  })

  it('says the storage is blocked, not full, where the browser does not let the site store', () => {
    expect(unsavedLine('blocked')).toBe(`the program is ${BLOCKED}`)
  })
})

describe('refusalOf', () => {
  it('reads a quota error as full storage', () => {
    expect(refusalOf(new DOMException('quota', 'QuotaExceededError'))).toBe('full')
  })

  it('reads anything else a write throws as storage the browser withholds', () => {
    // WHERE SITE DATA IS BLOCKED, thrown by the write or by the `localStorage` getter before it.
    expect(refusalOf(new DOMException('denied', 'SecurityError'))).toBe('blocked')
    expect(refusalOf(new TypeError("Cannot read properties of null (reading 'setItem')"))).toBe('blocked')
    // THE EXCEPTION'S NAME TELLS THEM APART, NOT A MESSAGE THAT MENTIONS ONE.
    expect(refusalOf(new Error('QuotaExceededError'))).toBe('blocked')
  })
})

describe('createUnsaved', () => {
  /** A CALL THAT CHANGES NOTHING STILL HANDS THE SENTENCE ON, which is what "at every call" means. */
  it('hands the whole sentence on at every call, and a success takes it back', () => {
    const lines: (string | null)[] = []
    const unsaved = createUnsaved((line) => lines.push(line))
    unsaved.refused('full')
    unsaved.refused('full')
    unsaved.saved()
    expect(lines).toEqual([`the program is ${FULL}`, `the program is ${FULL}`, null])
  })

  it('gives the latest refusal’s cause', () => {
    const lines: (string | null)[] = []
    const unsaved = createUnsaved((line) => lines.push(line))
    unsaved.refused('blocked')
    unsaved.saved()
    unsaved.refused('full')
    expect(lines).toEqual([`the program is ${BLOCKED}`, null, `the program is ${FULL}`])
  })
})
