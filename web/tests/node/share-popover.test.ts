import { describe, expect, it } from 'vitest'
import { LONG_LINK, lengthLine } from '../../src/share-popover'

/**
 * **THE SHARE POPOVER'S LENGTH LINE** — Plan 7 part 6a spec §5.2, row 8, as the pure function that words it.
 * The page's own cases are `share-popover.test.ts`, in the browser.
 */

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
