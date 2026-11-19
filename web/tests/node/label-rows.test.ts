import { describe, expect, it } from 'vitest'
import { type Labels, placeLabels } from '../../src/label-rows'
import { programRows } from '../../src/program-level'
import { listingRows } from '../../src/rxm-view'
import { groupStates } from '../../src/state-groups'
import type { TmProgram } from '../../src/types'
import { COMPILED, state } from './tm-machines'

/** What `placeLabels` calls, in order, as words: `L:name` for a label and `#2` for an item. */
function placed(count: number, labels: Labels): string[] {
  const out: string[] = []
  placeLabels(
    count,
    labels,
    (name) => out.push(`L:${name}`),
    (index) => out.push(`#${index}`),
  )
  return out
}

describe('placeLabels', () => {
  it('puts an item’s labels before it, in labels order', () => {
    const labels = [
      ['b', 1],
      ['c', 0],
      ['a', 1],
    ] as const
    expect(placed(2, labels)).toEqual(['L:c', '#0', 'L:b', 'L:a', '#1'])
  })

  it('puts a label at count after the last item', () => {
    expect(placed(2, [['end', 2]])).toEqual(['#0', '#1', 'L:end'])
  })

  it('drops a label past count', () => {
    expect(placed(2, [['gone', 3]])).toEqual(['#0', '#1'])
  })

  it('places a label at 0 when there are no items', () => {
    expect(placed(0, [['only', 0]])).toEqual(['L:only'])
  })
})

/** Three instructions with every state billed to one, so no group is a runtime routine. */
const NO_RUNTIME: TmProgram = {
  ...COMPILED,
  states: [state('pc0', 0, 1), state('pc1', 1, 2), state('pc2', 2)],
  start: 0,
  listing: ['mov\tr0, a0', 'mov\tr1, r0', 'ret'],
  labels: [],
}

/** The label sets the two callers are compared over, for a program of `count` listed groups. */
const labelSets = (count: number): [string, number][][] => [
  [],
  [
    ['b', 1],
    ['a', 1],
  ],
  [['end', count]],
  [['gone', count + 1]],
]

describe('the two callers', () => {
  it('places labels the same way for the listing and the instruction tier’s rows', () => {
    for (const [program, hasRuntime] of [
      [NO_RUNTIME, false],
      [COMPILED, true],
    ] as const) {
      const groups = groupStates(program)
      expect(groups.tier).toBe('instr')
      expect(groups.groups.some((g) => g.runtime)).toBe(hasRuntime)
      const count = groups.groups.filter((g) => !g.runtime).length
      const listing = program.listing.slice(0, count)
      for (const labels of labelSets(count)) {
        const fromListing = listingRows({ listing, labels }).map((r) =>
          r.kind === 'label' ? `L:${r.name}` : `#${r.pc}`,
        )
        const fromProgram = programRows(groups, labels, 'arcs', null).map((r) =>
          r.kind === 'label' ? `L:${r.name}` : r.kind === 'group' ? `#${r.group}` : `?${r.kind}`,
        )
        expect(fromProgram, JSON.stringify({ hasRuntime, labels })).toEqual(fromListing)
      }
    }
  })
})
