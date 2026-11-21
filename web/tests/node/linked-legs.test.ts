import { describe, expect, it } from 'vitest'
import { LEGS } from '../../src/legs'
import type { Link, LinkIndex, Pin } from '../../src/link'
import { isLinkedLeg, LINKED, LINKED_LEGS, perLinkedLeg } from '../../src/linked-legs'
import type { ClifState, RxmState, TmState } from '../../src/types'

describe('the linked legs', () => {
  it('lists every leg but λ, in the app’s order', () => {
    expect(LINKED_LEGS).toEqual(LEGS.filter((leg) => leg !== 'lambda'))
  })

  it('answers for each leg as the list does', () => {
    expect(LEGS.filter(isLinkedLeg)).toEqual(LINKED_LEGS)
  })

  it('perLinkedLeg gives each linked leg its own entry, and λ none', () => {
    expect(perLinkedLeg((leg) => `${leg} rows`)).toStrictEqual({ rxm: 'rxm rows', tm: 'tm rows', clif: 'clif rows' })
  })

  it.each<Pin | null>([
    null,
    { node: 1, origin: 'rxm', pc: 2 },
    { node: 1, origin: 'clif', pc: 2 },
    { node: 1, origin: 'source' },
    { node: 1, origin: 'tm' },
  ])('the TM rows of a link are its states whatever is pinned: %o', (pin) => {
    const l: Link = { source: null, states: [10, 11], instrs: [20, 21] }
    expect(LINKED.tm.rows(l, pin)).toBe(l.states)
  })
})

describe('the rows of a pin with a pc', () => {
  const l: Link = { source: null, states: [10, 11], instrs: [12, 13, 14] }

  it('the rxm rows of a CLIF row’s pin are its pc alone, and of any other pin the construct’s instructions', () => {
    expect(LINKED.rxm.rows(l, { node: 13, origin: 'clif', pc: 13 })).toEqual([13])
    expect(LINKED.rxm.rows(l, { node: 13, origin: 'rxm', pc: 13 })).toBe(l.instrs)
    expect(LINKED.rxm.rows(l, { node: 13, origin: 'source' })).toBe(l.instrs)
    expect(LINKED.rxm.rows(l, null)).toBe(l.instrs)
  })

  it.each<Pin['origin']>(['rxm', 'clif'])(
    'the CLIF rows of a pin from a row of the %s view are its pc alone',
    (origin) => {
      expect(LINKED.clif.rows(l, { node: 13, origin, pc: 13 })).toEqual([13])
    },
  )

  it('the CLIF rows of a construct pinned elsewhere, or of a running focus, are its instructions', () => {
    expect(LINKED.clif.rows(l, { node: 13, origin: 'source' })).toBe(l.instrs)
    expect(LINKED.clif.rows(l, null)).toBe(l.instrs)
  })
})

describe('the construct a running frame belongs to', () => {
  /** An index whose instruction 13 is node 7's, and every other instruction no construct's. */
  const index = { nodeForInstr: (pc: number) => (pc === 13 ? 7 : null) } as unknown as LinkIndex

  it('is the rxm and TM frames’ own source node', () => {
    expect(LINKED.rxm.focusNode({ source_node: 5 } as RxmState, index)).toBe(5)
    expect(LINKED.tm.focusNode({ source_node: 6 } as TmState, index)).toBe(6)
    expect(LINKED.tm.focusNode({ source_node: null } as TmState, index)).toBeNull()
  })

  it('is the owner of the rxm instruction a CLIF frame was lowered from, and none for a frame lowered from none', () => {
    expect(LINKED.clif.focusNode({ pc: 13 } as ClifState, index)).toBe(7)
    expect(LINKED.clif.focusNode({ pc: 4 } as ClifState, index)).toBeNull()
    expect(LINKED.clif.focusNode({ pc: null } as ClifState, index)).toBeNull()
  })
})
