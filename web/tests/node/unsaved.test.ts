import { describe, expect, it } from 'vitest'
import { createUnsaved, refusalOf, unsavedLine } from '../../src/unsaved'

const FULL = 'not being saved — this browser’s storage for this site is full'
const BLOCKED = 'not being saved — this browser’s storage for this site is blocked'

describe('unsavedLine', () => {
  it('names whichever store is failing, and both when both are', () => {
    expect(unsavedLine(false, false, 'full')).toBeNull()
    expect(unsavedLine(true, false, 'full')).toBe(`the program is ${FULL}`)
    expect(unsavedLine(true, true, 'full')).toBe(`the program and copies are ${FULL}`)
  })

  it('says what it always said while only the copies fail', () => {
    expect(unsavedLine(false, true, 'full')).toBe(
      'copies are not being saved — this browser’s storage for this site is full',
    )
  })

  it('says the storage is blocked, not full, where the browser does not let the site store', () => {
    expect(unsavedLine(true, false, 'blocked')).toBe(`the program is ${BLOCKED}`)
    expect(unsavedLine(false, true, 'blocked')).toBe(`copies are ${BLOCKED}`)
    expect(unsavedLine(true, true, 'blocked')).toBe(`the program and copies are ${BLOCKED}`)
    expect(unsavedLine(false, false, 'blocked')).toBeNull()
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
  it('hands the whole sentence on at every call, and a success takes back only its own half', () => {
    const lines: (string | null)[] = []
    const unsaved = createUnsaved((line) => lines.push(line))
    unsaved.refused('program', 'full')
    unsaved.refused('copies', 'full')
    unsaved.saved('program')
    unsaved.saved('copies')
    expect(lines).toEqual([`the program is ${FULL}`, `the program and copies are ${FULL}`, `copies are ${FULL}`, null])
  })

  /** A CALL THAT CHANGES NOTHING STILL HANDS THE SENTENCE ON, which is what "at every call" means. */
  it('leaves a failing store failing when the other one saves', () => {
    const lines: (string | null)[] = []
    const unsaved = createUnsaved((line) => lines.push(line))
    unsaved.refused('copies', 'full')
    unsaved.saved('program')
    expect(lines).toEqual([`copies are ${FULL}`, `copies are ${FULL}`])
  })

  it('gives the latest refusal’s cause, for both halves', () => {
    const lines: (string | null)[] = []
    const unsaved = createUnsaved((line) => lines.push(line))
    unsaved.refused('program', 'blocked')
    unsaved.refused('copies', 'blocked')
    unsaved.saved('program')
    unsaved.refused('program', 'full')
    expect(lines).toEqual([
      `the program is ${BLOCKED}`,
      `the program and copies are ${BLOCKED}`,
      `copies are ${BLOCKED}`,
      `the program and copies are ${FULL}`,
    ])
  })
})
