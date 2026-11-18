import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { drawn, mountAt, storedLayout } from './harness'
import { clickToggle } from './user-event-fixture'

/**
 * **A STORED WORKSPACE DOES NOT HANG ON THE ORDER OF THE HEADER'S TOGGLES.** Its remembered arrangements are keyed by
 * `KIND_ORDER` (`arrangements.ts`'s `keyOf`), and `HEADER_ORDER` is a second list free to move, so the toggles can be
 * put in another order without one visitor's layout changing.
 *
 * **THE RECORD IS WRITTEN OUT AND NOT BUILT WITH `serializeWorkspace`**: built by the code under test, its keys would
 * follow any change to how a key is spelled, and the record a returning visitor's browser holds cannot.
 *
 * **THE CASES ARE A SEQUENCE ON ONE PAGE**, since `main()` reads storage once. Each starts by asserting what the one
 * before left, and each reaches its arrangement by the toggles, which go to a combination whatever order they are in.
 */

type Stored = { arrangements?: Record<string, unknown>; focused?: string }

const leaf = (id: string, pane: string): unknown => ({ kind: 'leaf', id, pane })
const split = (dir: string, sizes: number[], children: unknown[]): unknown => ({ kind: 'split', dir, sizes, children })

const STORED = JSON.stringify({
  version: 2,
  tree: split('row', [0.3, 0.7], [leaf('source', 'source'), leaf('rxm-0', 'rxm')]),
  switches: { steps: 'view', views: 'tiles', readout: 'strip' },
  speed: 8,
  focused: 'rxm-0',
  panels: {},
  inspector: true,
  display: {},
  tmDisplay: {},
  arrangements: {
    'source+tm': split('row', [0.7, 0.3], [leaf('source', 'source'), leaf('tm-0', 'tm')]),
    'source+lambda+rxm+tm': split(
      'row',
      [0.4, 0.6],
      [
        split('column', [0.35, 0.65], [leaf('source', 'source'), leaf('rxm-0', 'rxm')]),
        split('column', [0.6, 0.4], [leaf('lambda-0', 'lambda'), leaf('tm-0', 'tm')]),
      ],
    ),
  },
})

describe('a workspace stored with two arrangements remembered', () => {
  beforeAll(async () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, STORED)
    await mountAt(1280, 896)
  })

  it('opens on the tree it was stored with, and remembers both arrangements still', () => {
    expect(drawn()).toBe('row[30](source rxm-0)')
    expect(Object.keys(storedLayout<Stored>().arrangements ?? {})).toEqual(['source+tm', 'source+lambda+rxm+tm'])
  })

  it('brings all four views back as they were left', async () => {
    expect(drawn(), 'precondition: the tree it was stored with').toBe('row[30](source rxm-0)')
    await clickToggle('lambda')
    await clickToggle('tm')
    expect(drawn()).toBe('row[40](column[35](source rxm-0) column[60](lambda-0 tm-0))')
    // Read after the toggles, whose switch wrote the record again: before one, this is the fixture's own text.
    expect(storedLayout<Stored>().focused).toBe('rxm-0')
  })

  it('brings the source beside the TM view back as it was left', async () => {
    expect(drawn(), 'precondition: all four views').toBe('row[40](column[35](source rxm-0) column[60](lambda-0 tm-0))')
    await clickToggle('rxm')
    await clickToggle('lambda')
    expect(drawn()).toBe('row[70](source tm-0)')
  })
})
