import { describe, expect, it } from 'vitest'
import { localLevel, predecessors, REACH, ruleLabel } from '../../src/local-level'
import type { RuleView, TmProgram } from '../../src/types'
import { COMPILED, state } from './tm-machines'

const rule = (over: Partial<RuleView>): RuleView => ({
  read: [null, null],
  write: [null, null],
  moves: ['S', 'S'],
  next: 0,
  ...over,
})

describe('a rule as an edge label (spec §8)', () => {
  it('names only the tapes the rule touches', () => {
    expect(ruleLabel(rule({ read: ['1', null], moves: ['L', 'S'] }), ['reg', 'work'])).toBe('reg:1 L')
    expect(ruleLabel(rule({ read: [null, '_'], write: [null, '1'] }), ['reg', 'work'])).toBe('work:_/1')
    expect(ruleLabel(rule({ moves: ['S', 'R'] }), ['reg', 'work'])).toBe('work:* R')
  })

  it('says `*` for a rule that touches no tape, and numbers a tape it has no name for', () => {
    expect(ruleLabel(rule({}), ['reg', 'work'])).toBe('*')
    expect(ruleLabel(rule({ read: ['1', null] }), [])).toBe('tape 0:1')
  })
})

/**
 * A line of states with one branch back: 0 -> 1 -> 2 -> 3 -> 4 -> 5, 2 -> 2 (a self-loop), and 4 -> 1.
 * From 2: ahead 3 (1) and 4 (2); behind 1 (1), and 0 and 4 (2) — so 4 is within reach both ways.
 */
const LINE: TmProgram = {
  ...COMPILED,
  states: [
    state('s0', null, 1),
    state('s1', null, 2),
    state('s2', null, 2, 3),
    state('s3', null, 4),
    state('s4', null, 5, 1),
    state('s5', null),
  ],
  listing: [],
  labels: [],
}

/** Two rules from the same state, `a`, into the same target, `b` — a genuine duplicate for `predecessors` to drop. */
const TWICE: TmProgram = {
  ...LINE,
  states: [
    { ...state('a', null), rules: [rule({ read: ['1', null], next: 1 }), rule({ read: ['_', null], next: 1 })] },
    state('b', null),
  ],
}

describe('the local level (spec §8, amendment 10)', () => {
  const into = predecessors(LINE)
  const twiceInto = predecessors(TWICE)

  it('lists each predecessor once', () => {
    expect(into[2]).toEqual([1, 2])
    expect(into[1]).toEqual([0, 4])
    // `LINE` has no state with two rules into the same target, so it alone cannot show a duplicate
    // dropped — `TWICE`'s state 0 has two, both into 1, and still lists 1's only predecessor once.
    expect(twiceInto[1]).toEqual([0])
  })

  it(`reaches ${REACH} rules each way, in signed columns, and a state reachable both ways takes its forward one`, () => {
    const { nodes } = localLevel(LINE, into, 2, null, [])
    expect(nodes.map((n) => [n.state, n.column])).toEqual([
      [0, -2],
      [1, -1],
      [2, 0],
      [3, 1],
      [4, 2],
    ])
  })

  it('draws the rules among them, a self-loop included, and none to a state beyond its reach', () => {
    const { edges } = localLevel(LINE, into, 2, null, [])
    const pairs = edges.map((e) => [e.from, e.to])
    expect(pairs).toEqual(
      expect.arrayContaining([
        [0, 1],
        [1, 2],
        [2, 2],
        [2, 3],
        [3, 4],
        [4, 1],
      ]),
    )
    expect(pairs).not.toContainEqual([4, 5])
    expect(edges).toHaveLength(6)
  })

  it('marks the edge of the rule about to fire, and only that one', () => {
    // State 2's rule 1 is `-> 3`.
    const { edges } = localLevel(LINE, into, 2, 1, [])
    expect(edges.filter((e) => e.next).map((e) => [e.from, e.to])).toEqual([[2, 3]])
  })

  it('joins the labels of several rules between the same two states, each once', () => {
    const { edges } = localLevel(TWICE, twiceInto, 0, null, ['reg'])
    expect(edges).toEqual([{ from: 0, to: 1, label: 'reg:1, reg:_', next: false }])
  })
})
