import { describe, expect, it } from 'vitest'
import { copiesLine, LONG_LINK, lengthLine } from '../../src/share-popover'

/**
 * **THE SHARE POPOVER'S TWO LINES** — Plan 7 part 6a spec §5.2, rows 8 and 14, as the pure functions that word them.
 * The page's own cases are `share-popover.test.ts`, in the browser.
 */

describe('the line naming the views a link opens on the program', () => {
  it('is null where no view shows a copy', () => {
    expect(copiesLine([])).toBeNull()
  })

  it('names one view in the singular', () => {
    expect(copiesLine(['λ · copy 1'])).toBe('copies are not included — the λ · copy 1 view will open on the program')
  })

  it('lists two with `and`, and more with commas and a last `and`', () => {
    expect(copiesLine(['λ · copy 1', 'asm · copy 2'])).toBe(
      'copies are not included — the λ · copy 1 and asm · copy 2 views will open on the program',
    )
    expect(copiesLine(['λ · copy 1', 'asm · copy 2', 'TM · copy 3'])).toBe(
      'copies are not included — the λ · copy 1, asm · copy 2 and TM · copy 3 views will open on the program',
    )
  })

  /** A TITLE IS A COPY'S, NOT A VIEW'S: views of one copy are named once, with how many of them there are. */
  it('names two views of one copy as `both`', () => {
    expect(copiesLine(['λ · copy 1', 'λ · copy 1'])).toBe(
      'copies are not included — both λ · copy 1 views will open on the program',
    )
  })

  it('names three or more views of one copy as `all N`', () => {
    expect(copiesLine(['λ · copy 1', 'λ · copy 1', 'λ · copy 1'])).toBe(
      'copies are not included — all 3 λ · copy 1 views will open on the program',
    )
    expect(copiesLine(['λ · copy 1', 'λ · copy 1', 'λ · copy 1', 'λ · copy 1'])).toBe(
      'copies are not included — all 4 λ · copy 1 views will open on the program',
    )
  })

  it('groups a mix by copy, in the order each is first seen', () => {
    expect(copiesLine(['asm · copy 2', 'λ · copy 1', 'λ · copy 1'])).toBe(
      'copies are not included — the asm · copy 2 view and both λ · copy 1 views will open on the program',
    )
    expect(copiesLine(['λ · copy 1', 'asm · copy 2', 'λ · copy 1'])).toBe(
      'copies are not included — both λ · copy 1 views and the asm · copy 2 view will open on the program',
    )
  })
})

describe('the line saying a link is long', () => {
  it('is null at exactly 2,000 characters, and says so from 2,001', () => {
    expect(LONG_LINK).toBe(2000)
    expect(lengthLine('x'.repeat(2000))).toBeNull()
    expect(lengthLine('x'.repeat(2001))).toBe(
      'this link is 2,001 characters long — some chat and mail apps cut links past 2,000',
    )
  })

  it('is null for a short link', () => {
    expect(lengthLine('x')).toBeNull()
  })
})
