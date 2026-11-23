import { describe, expect, it } from 'vitest'
import { arrangementFor } from '../../src/machine-row'

/**
 * The least widths of the values, call stack and heap the machine panels row design §5.1 gives each view, in px under a
 * 16px root, and the gap between two columns the after-the-try design's G2 gives: CLIF is wide from 606px and medium
 * from 362px, rxm from 880px and 584px.
 */
const CLIF = [118, 236, 236] as const
const RXM = [288, 288, 288] as const
const GAP = 8

describe('arrangementFor', () => {
  it.each([
    { view: 'CLIF', columns: CLIF, width: 900, is: 'wide' },
    { view: 'CLIF', columns: CLIF, width: 606, is: 'wide' },
    { view: 'CLIF', columns: CLIF, width: 605.99, is: 'medium' },
    { view: 'CLIF', columns: CLIF, width: 362, is: 'medium' },
    { view: 'CLIF', columns: CLIF, width: 361.99, is: 'narrow' },
    { view: 'CLIF', columns: CLIF, width: 0, is: 'narrow' },
    { view: 'rxm', columns: RXM, width: 880, is: 'wide' },
    { view: 'rxm', columns: RXM, width: 879, is: 'medium' },
    { view: 'rxm', columns: RXM, width: 584, is: 'medium' },
    { view: 'rxm', columns: RXM, width: 583, is: 'narrow' },
  ] as const)('is $is for the $view columns in $width px', ({ columns, width, is }) => {
    expect(arrangementFor(width, columns, GAP)).toBe(is)
  })
})
