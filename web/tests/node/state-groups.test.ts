import { describe, expect, it } from 'vitest'
import { groupStates, segmentOf, stepOf, tierOf } from '../../src/state-groups'
import type { TmProgram } from '../../src/types'
import { COMPILED, COPY, go, state } from './tm-machines'

describe('names', () => {
  it('splits a state name into its group and its sub-step', () => {
    expect(segmentOf('cmp6.m1.c.c.cwb')).toBe('cmp6')
    expect(stepOf('cmp6.m1.c.c.cwb')).toBe('m1')
    expect(segmentOf('pc4')).toBe('pc4')
    expect(stepOf('pc4')).toBe('pc4')
  })
})

describe('the three tiers (spec §7)', () => {
  it('groups by instruction when any state carries one', () => {
    expect(tierOf(COMPILED)).toBe('instr')
  })

  it('groups by name when no state does but a name has a dot', () => {
    expect(tierOf(COPY)).toBe('name')
  })

  it('does not group a machine whose names carry no dots either', () => {
    const flat: TmProgram = { ...COPY, states: [state('q0', null, 1), state('q1', null)] }
    expect(tierOf(flat)).toBe('none')
    expect(groupStates(flat).groups).toEqual([])
  })
})

describe('by instruction', () => {
  const { groups, groupOf } = groupStates(COMPILED)
  const byName = (name: string) => groups.findIndex((g) => g.name === name)

  it('gives every instruction a row, in listing order, and the runtime routines rows after them', () => {
    expect(groups.map((g) => g.name)).toEqual(['pc0', 'pc1', 'pc2', 'pc3', 'halt', 'ret', 'rf9'])
    expect(groups.map((g) => g.instr)).toEqual([0, 1, 2, 3, null, null, null])
    expect(groups.map((g) => g.runtime)).toEqual([false, false, false, false, true, true, true])
  })

  it('counts states, keeps the first for linking, and lists the sub-steps in state order', () => {
    const mov = groups[0]
    expect(mov?.count).toBe(4)
    expect(mov?.first).toBe(2)
    expect(mov?.steps).toEqual(['pc0', 'c', 'd'])
  })

  it('makes the overflow guard a badge on the rows that reach it, not a row', () => {
    expect(groupOf[1]).toBe(-1)
    expect(groups.map((g) => g.overflow)).toEqual([true, false, false, false, false, false, false])
  })

  it('keeps a call and the runtime edges, and leaves a fall-through implied', () => {
    expect(groups[0]?.targets).toEqual([]) // mov falls through to the call
    expect(groups[1]?.targets).toEqual([3]) // the call
    expect(groups[2]?.targets).toEqual([byName('halt')]) // into a runtime routine: next in index, not in rows
    expect(groups[3]?.targets).toEqual([byName('ret')])
    // A runtime routine's edge to the next runtime row is kept: those rows are not one above the other.
    expect(groups[byName('ret')]?.targets).toEqual([byName('rf9')])
    expect(groups[byName('rf9')]?.targets).toEqual([2])
  })

  it('records every edge from both ends', () => {
    expect(groups[3]?.sources).toEqual([1])
    expect(groups[2]?.sources).toEqual([byName('rf9')])
    expect(groups[byName('halt')]?.sources).toEqual([2])
  })

  it('takes a state named overflow that has rules for a working state, not the guard', () => {
    // The guard has no rule and does not accept; a machine someone wrote may name a state `overflow` too.
    const named: TmProgram = { ...COPY, states: [state('a.x', null, 1), state('overflow', null, 0)], start: 0 }
    const g = groupStates(named)
    expect(g.groups.map((x) => x.name)).toEqual(['a', 'overflow'])
    expect(g.groups[0]?.overflow).toBe(false)
  })
})

describe('by name', () => {
  const { groups } = groupStates(COPY)

  it('orders the rows by first reach from the start, so each gadget follows the entry that falls into it', () => {
    // By appearance the entries would all come first — pc0 pc1 pc2 pc3 ret rf9 mv0s1 pf2 — each far from its gadget.
    expect(groups.map((g) => g.name)).toEqual(['pc0', 'mv0s1', 'pc1', 'pf2', 'pc3', 'ret', 'rf9', 'pc2', 'halt'])
    expect(groups.every((g) => !g.runtime && g.instr === null)).toBe(true)
  })

  it('leaves every edge to the next row implied — here every edge the copy has', () => {
    expect(groups.map((g) => g.targets)).toEqual(groups.map(() => []))
  })

  it('puts a group the start never reaches after the reached ones, in the order its first state appears', () => {
    const stray: TmProgram = {
      ...COPY,
      states: [...COPY.states, { ...state('zz.a', null), rules: [go(COPY.states.length)] }, state('yy.b', null)],
    }
    const names = groupStates(stray).groups.map((g) => g.name)
    expect(names.slice(-2)).toEqual(['zz', 'yy'])
  })

  it('reorders more groups than one call can take as arguments', () => {
    // A hand-written dotted file can have a group per state; spread into one call, 150,000 names threw `RangeError`.
    const count = 150_000
    const many: TmProgram = {
      ...COPY,
      states: Array.from({ length: count }, (_, i) => state(`g${i}.a`, null, (i + 1) % count)),
      start: 0,
    }
    const { tier, groups } = groupStates(many)
    expect(tier).toBe('name')
    expect(groups).toHaveLength(count)
    expect(groups[count - 1]?.name).toBe(`g${count - 1}`)
  })
})
