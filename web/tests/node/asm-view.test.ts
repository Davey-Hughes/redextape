import { describe, expect, it } from 'vitest'
import {
  backRefs,
  calleeOf,
  frames,
  heapSummary,
  instrParts,
  listingRows,
  registerRows,
  rowsOfPcs,
  unwrittenLegend,
  unwrittenMeaning,
  wordText,
} from '../../src/asm-view'
import type { AsmProgram, AsmState, AsmWord } from '../../src/types'
import { FACT3, frameOf } from './asm-fixtures'

const v = (word: string): AsmWord => ({ word, tag: 'Value' })
const l = (word: string): AsmWord => ({ word, tag: 'List' })
const b = (word: string): AsmWord => ({ word, tag: 'Box' })

describe('the listing', () => {
  it('puts each instruction under its labels, as print_asm prints them', () => {
    const rows = listingRows(FACT3)
    // 21 instructions and 4 labels: `fact.0` above pc1, `else2` above pc8, `endif3` above pc16, `skip1` above pc17.
    expect(rows).toHaveLength(25)
    expect(rows.slice(0, 3)).toEqual([
      { kind: 'instr', pc: 0 },
      { kind: 'label', name: 'fact.0' },
      { kind: 'instr', pc: 1 },
    ])
    expect(rows.slice(18, 22)).toEqual([
      { kind: 'label', name: 'endif3' },
      { kind: 'instr', pc: 16 },
      { kind: 'label', name: 'skip1' },
      { kind: 'instr', pc: 17 },
    ])
  })

  it('draws a label past the last instruction after it, and two labels on one instruction in labels order', () => {
    const p: AsmProgram = {
      listing: ['halt'],
      labels: [
        ['b', 0],
        ['a', 0],
        ['end', 1],
      ],
    }
    expect(listingRows(p)).toEqual([
      { kind: 'label', name: 'b' },
      { kind: 'label', name: 'a' },
      { kind: 'instr', pc: 0 },
      { kind: 'label', name: 'end' },
    ])
  })

  it("finds each instruction's row", () => {
    const rowOf = rowsOfPcs(listingRows(FACT3))
    expect(rowOf[0]).toBe(0)
    expect(rowOf[1]).toBe(2)
    expect(rowOf[20]).toBe(24)
    expect(rowOf).toHaveLength(21)
  })

  it("splits an instruction at the listing's tab, and leaves one with no operands whole", () => {
    expect(instrParts('jz\tr1, else2')).toEqual({ mnemonic: 'jz', operands: 'r1, else2' })
    expect(instrParts('halt')).toEqual({ mnemonic: 'halt', operands: '' })
  })
})

describe('a word', () => {
  it('reads by its tag: a value in decimal, a list as its cell or nil, a box as its handle', () => {
    expect(wordText(v('42'))).toBe('42')
    expect(wordText(l('3'))).toBe('#3')
    expect(wordText(l('0'))).toBe('nil')
    expect(wordText(b('2'))).toBe('box #2')
  })

  it('keeps a saturated value exact, as the decimal string it came as', () => {
    expect(wordText(v('18446744073709551615'))).toBe('18446744073709551615')
  })
})

describe('a call frame', () => {
  it('names the function the call before its return pc named', () => {
    // pc13 is `call fact.0`, so a frame returning to pc14 was called by it.
    expect(calleeOf(FACT3, 14)).toBe('fact.0')
    expect(calleeOf(FACT3, 20)).toBe('fact.0')
  })

  it('names nothing when the instruction before its return pc is not a call', () => {
    expect(calleeOf(FACT3, 15)).toBeNull()
    expect(calleeOf(FACT3, 0)).toBeNull()
  })
})

describe('the registers', () => {
  it('list pc, rr, the arguments and the locals in that order, each read by its tag', () => {
    const s = frameOf({ pc: 7, rr: l('2'), args: [v('3')], locals: [v('1'), b('1')], written: [true, true] })
    expect(registerRows(s).map((r) => [r.name, r.text])).toEqual([
      ['pc', '7'],
      ['rr', '#2'],
      ['a0', '3'],
      ['r0', '1'],
      ['r1', 'box #1'],
    ])
  })

  it('mark the register the last instruction wrote, and only that one', () => {
    const s = frameOf({ locals: [v('1'), v('2')], written: [true, true], args: [v('0')], wrote: 'r1' })
    expect(
      registerRows(s)
        .filter((r) => r.changed)
        .map((r) => r.name),
    ).toEqual(['r1'])
    expect(
      registerRows(frameOf({ wrote: 'rr' }))
        .filter((r) => r.changed)
        .map((r) => r.name),
    ).toEqual(['rr'])
    expect(
      registerRows(frameOf({ args: [v('0')], wrote: 'a0' }))
        .filter((r) => r.changed)
        .map((r) => r.name),
    ).toEqual(['a0'])
  })

  it('mark a local the current call has not written, and never an argument or rr', () => {
    const s = frameOf({ depth: 1, args: [v('2')], locals: [v('5'), v('6')], written: [true, false] })
    expect(
      registerRows(s)
        .filter((r) => r.unwritten)
        .map((r) => r.name),
    ).toEqual(['r1'])
  })

  it('say an unwritten local is left over from the caller only inside a call', () => {
    const inside = frameOf({ depth: 2, locals: [v('5')], written: [false] })
    const top = frameOf({ depth: 0, locals: [v('0')], written: [false] })
    expect(unwrittenMeaning(inside)).toBe('left over from caller')
    expect(unwrittenLegend(inside, registerRows(inside))).toBe('· left over from caller')
    expect(unwrittenMeaning(top)).toBe('not written yet')
    expect(unwrittenLegend(top, registerRows(top))).toBe('· not written yet')
    const written = frameOf({ depth: 2, locals: [v('5')], written: [true] })
    expect(unwrittenLegend(written, registerRows(written))).toBeNull()
  })
})

describe('the heap', () => {
  it("names the registers of a cell's own tag whose word is that cell", () => {
    const s: AsmState = frameOf({
      rr: l('3'),
      args: [l('3')],
      locals: [v('3'), l('3'), l('2')],
      written: [true, true, true],
    })
    expect(backRefs(s, 3, 'List')).toEqual(['rr', 'a0', 'r1'])
    expect(backRefs(s, 2, 'List')).toEqual(['r2'])
    expect(backRefs(s, 3, 'Box')).toEqual([])
  })

  it('counts cells, and boxes only when there are some', () => {
    expect(heapSummary(frameOf({ heap_len: 57, box_len: 2 }))).toBe('57 cells · 2 boxes')
    expect(heapSummary(frameOf({ heap_len: 1, box_len: 1 }))).toBe('1 cell · 1 box')
    expect(heapSummary(frameOf({ heap_len: 0, box_len: 0 }))).toBe('0 cells')
  })

  it('counts frames', () => {
    expect(frames(1)).toBe('1 frame')
    expect(frames(1001)).toBe('1,001 frames')
  })
})
