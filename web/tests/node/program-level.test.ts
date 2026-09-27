import { describe, expect, it } from 'vitest'
import { arcsOf, chipName, chipsOf, programRows } from '../../src/program-level'
import { groupStates } from '../../src/state-groups'
import type { TmProgram } from '../../src/types'
import { COMPILED, COPY, state } from './tm-machines'

const compiled = groupStates(COMPILED)
const LABELS = COMPILED.labels

/** A row as a word, so a whole layout reads as one line: `L:skip`, `pc3`, `steps:pc1`, `H:runtime`. */
const shown =
  (g = compiled) =>
  (r: ReturnType<typeof programRows>[number]) =>
    r.kind === 'label'
      ? `L:${r.name}`
      : r.kind === 'heading'
        ? `H:${r.name}`
        : r.kind === 'steps'
          ? `steps:${g.groups[r.group]?.name}`
          : (g.groups[r.group]?.name ?? '?')

describe('the rows', () => {
  it("puts a label above the instruction it names, and leaves the runtime routines to *arcs*' side column", () => {
    expect(programRows(compiled, LABELS, 'arcs', null).map(shown())).toEqual(['pc0', 'pc1', 'pc2', 'L:f', 'pc3'])
  })

  it('draws the runtime routines as rows under a heading in *chips*', () => {
    expect(programRows(compiled, LABELS, 'chips', null).map(shown())).toEqual([
      'pc0',
      'pc1',
      'pc2',
      'L:f',
      'pc3',
      'H:runtime',
      'halt',
      'ret',
      'rf9',
    ])
  })

  it('opens the current group onto a row of its sub-steps, under it', () => {
    expect(programRows(compiled, LABELS, 'arcs', 1).map(shown())).toEqual([
      'pc0',
      'pc1',
      'steps:pc1',
      'pc2',
      'L:f',
      'pc3',
    ])
  })

  it('prints a label one past the last instruction after it, as `print_asm` does', () => {
    const trailing = [['end', 4]] as const
    expect(programRows(compiled, trailing, 'arcs', null).map(shown()).at(-1)).toBe('L:end')
  })

  it('draws every name group as a row, in order, and no labels, without instructions to hang them on', () => {
    const copy = groupStates(COPY)
    expect(programRows(copy, [], 'arcs', null).map(shown(copy))).toEqual(copy.groups.map((g) => g.name))
  })
})

describe("*arcs*' lanes", () => {
  it('draws every edge between two listing rows, and none to a runtime routine', () => {
    // The call, pc1 -> pc3; pc2 -> halt and pc3 -> ret go to runtime routines, and pc0 -> pc1 falls through.
    expect(arcsOf(compiled)).toEqual([{ from: 1, to: 3, lane: 0 }])
  })

  /**
   * Four instructions: pc0 jumps to pc3, pc2 back to pc1, and pc3 halts — spans 0..3 and 1..2, which overlap.
   * States in the lowering's order: entries first.
   */
  const OVERLAPPING: TmProgram = {
    ...COMPILED,
    states: [
      state('halt', null),
      state('overflow', null),
      state('pc0', 0, 5),
      state('pc1', 1, 4),
      state('pc2', 2, 3),
      state('pc3', 3, 0),
    ],
  }

  it('gives the shortest span the innermost lane, and a lane to each overlapping span', () => {
    const arcs = arcsOf(groupStates(OVERLAPPING))
    expect(arcs.find((a) => a.from === 2)?.lane).toBe(0)
    expect(arcs.find((a) => a.from === 0)?.lane).toBe(1)
  })

  it('lets spans that do not overlap share a lane', () => {
    // Four instructions, each jumping back one: 1 -> 0 and 3 -> 2 are two arcs whose spans do not overlap.
    const p: TmProgram = {
      ...COMPILED,
      states: [
        state('halt', null),
        state('overflow', null),
        state('pc0', 0, 3),
        state('pc1', 1, 2),
        state('pc2', 2, 5),
        state('pc3', 3, 4),
      ],
    }
    const arcs = arcsOf(groupStates(p))
    expect(arcs.map((a) => [a.from, a.to, a.lane])).toEqual([
      [1, 0, 0],
      [3, 2, 0],
    ])
  })
})

describe("*chips*' text", () => {
  it('names a target by the label its jump names, and a source by its row', () => {
    // pc1's `call f` goes to pc3, which the label `f` names.
    expect(chipName(compiled, LABELS, 3)).toBe('f')
    expect(chipsOf(compiled, LABELS, 1)).toEqual({ to: '→ f', from: '' })
    expect(chipsOf(compiled, LABELS, 3)).toEqual({ to: '→ ret', from: '← pc1' })
  })

  it('says nothing for a row with no edge but a fall-through', () => {
    expect(chipsOf(compiled, LABELS, 0)).toEqual({ to: '', from: '' })
  })

  it('reads a runtime routine as a row like any other', () => {
    const ret = compiled.groups.findIndex((g) => g.name === 'ret')
    expect(chipsOf(compiled, LABELS, ret)).toEqual({ to: '→ rf9', from: '← pc3' })
  })
})
