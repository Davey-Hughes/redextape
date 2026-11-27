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
  rxmHeap,
  rxmStack,
  rxmValues,
  unwrittenLegend,
  unwrittenMeaning,
  wordText,
} from '../../src/rxm-view'
import type { RxmProgram, RxmState } from '../../src/types'
import { boxWord, FACT3, frameOf, listWord, valueWord } from './rxm-fixtures'

describe('the listing', () => {
  it('puts each instruction under its labels, as print_rxm prints them', () => {
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
    const p: RxmProgram = {
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
    expect(wordText(valueWord('42'))).toBe('42')
    expect(wordText(listWord('3'))).toBe('#3')
    expect(wordText(listWord('0'))).toBe('nil')
    expect(wordText(boxWord('2'))).toBe('box #2')
  })

  it('keeps a saturated value exact, as the decimal string it came as', () => {
    expect(wordText(valueWord('18446744073709551615'))).toBe('18446744073709551615')
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
    const s = frameOf({
      pc: 7,
      rr: listWord('2'),
      args: [valueWord('3')],
      locals: [valueWord('1'), boxWord('1')],
      written: [true, true],
    })
    expect(registerRows(s).map((r) => [r.name, r.text])).toEqual([
      ['pc', '7'],
      ['rr', '#2'],
      ['a0', '3'],
      ['r0', '1'],
      ['r1', 'box #1'],
    ])
  })

  it('mark the register the last instruction wrote, and only that one', () => {
    const s = frameOf({
      locals: [valueWord('1'), valueWord('2')],
      written: [true, true],
      args: [valueWord('0')],
      wrote: 'r1',
    })
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
      registerRows(frameOf({ args: [valueWord('0')], wrote: 'a0' }))
        .filter((r) => r.changed)
        .map((r) => r.name),
    ).toEqual(['a0'])
  })

  it('mark a local the current call has not written, and never an argument or rr', () => {
    const s = frameOf({
      depth: 1,
      args: [valueWord('2')],
      locals: [valueWord('5'), valueWord('6')],
      written: [true, false],
    })
    expect(
      registerRows(s)
        .filter((r) => r.unwritten)
        .map((r) => r.name),
    ).toEqual(['r1'])
  })

  it('say an unwritten local is left over from the caller only inside a call', () => {
    const inside = frameOf({ depth: 2, locals: [valueWord('5')], written: [false] })
    const top = frameOf({ depth: 0, locals: [valueWord('0')], written: [false] })
    expect(unwrittenMeaning(inside)).toBe('left over from caller')
    expect(unwrittenLegend(inside, registerRows(inside))).toBe('· left over from caller')
    expect(unwrittenMeaning(top)).toBe('not written yet')
    expect(unwrittenLegend(top, registerRows(top))).toBe('· not written yet')
    const written = frameOf({ depth: 2, locals: [valueWord('5')], written: [true] })
    expect(unwrittenLegend(written, registerRows(written))).toBeNull()
  })
})

describe('the heap', () => {
  it("names the registers of a cell's own tag whose word is that cell", () => {
    const s: RxmState = frameOf({
      rr: listWord('3'),
      args: [listWord('3')],
      locals: [valueWord('3'), listWord('3'), listWord('2')],
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

describe('what the panels are handed', () => {
  it('adds +N more to a frame’s saved locals past the window', () => {
    const saved = [valueWord('5'), listWord('3')]
    const stack = rxmStack(
      frameOf({
        depth: 2,
        frames: [
          { ret_pc: 14, saved, saved_len: 5 },
          { ret_pc: 20, saved, saved_len: 2 },
        ],
      }),
      FACT3,
    )
    expect(stack.frames).toEqual([
      { callee: 'fact.0', ret: '→ pc14', saved: 'r0 5 · r1 #3 · +3 more' },
      { callee: 'fact.0', ret: '→ pc20', saved: 'r0 5 · r1 #3' },
    ])
  })

  it('reads ? for a frame whose return pc follows no call, or lies past the listing', () => {
    const frameAt = (ret_pc: number) => ({ ret_pc, saved: [], saved_len: 0 })
    const stack = rxmStack(frameOf({ depth: 3, frames: [14, 1, FACT3.listing.length + 5].map(frameAt) }), FACT3)
    expect(stack.frames.map((f) => f.callee)).toEqual(['fact.0', '?', '?'])
  })

  it('counts older cells and boxes, boxes in the plural only past one', () => {
    const cells = [{ cell: 9, head: valueWord('1'), tail: listWord('8') }]
    const boxes = [{ handle: 2, content: valueWord('7') }]
    const notes = (s: RxmState) => rxmHeap(s, false).items.flatMap((item) => (item.kind === 'note' ? [item.text] : []))
    expect(notes(frameOf({ cells, heap_len: 3, boxes, box_len: 2 }))).toEqual(['+2 older', '+1 older box'])
    expect(notes(frameOf({ cells, heap_len: 1, boxes, box_len: 4 }))).toEqual(['+3 older boxes'])
    expect(notes(frameOf({ cells, heap_len: 1, boxes, box_len: 1 }))).toEqual([])
  })

  it("lights the result's cells at the run's result, and says in the older cells' note how many are the result's", () => {
    const cells = [9, 8, 3, 2].map((cell) => ({ cell, head: valueWord('1'), tail: listWord(String(cell - 1)) }))
    const frame = frameOf({ cells, heap_len: 70, result: { shown: [3, 2], len: 66 } })
    const items = (on: boolean) => rxmHeap(frame, on).items.map((i) => (i.kind === 'line' ? i.result : i.text))
    expect(items(true)).toEqual([false, false, true, true, '+66 older, 64 of them result cells'])
    expect(items(false)).toEqual([false, false, false, false, '+66 older'])
    const last = (len: number) => rxmHeap(frameOf({ cells, heap_len: 70, result: { shown: [3, 2], len } }), true).items
    expect(last(3).at(-1), 'one hidden').toEqual({ kind: 'note', text: '+66 older, 1 of them a result cell' })
    expect(last(2).at(-1), 'none hidden').toEqual({ kind: 'note', text: '+66 older' })
  })

  it('says a hidden argument and a hidden local in the singular', () => {
    const notes = (s: RxmState) => rxmValues(s, false).notes.map((note) => note.text)
    expect(notes(frameOf({ args_len: 1, locals_len: 1 }))).toEqual(['+1 more argument', '+1 more local'])
    expect(notes(frameOf({ args_len: 3, locals_len: 2 }))).toEqual(['+3 more arguments', '+2 more locals'])
  })

  it('puts rr first and marks it at the result', () => {
    const s = frameOf({ next: null, rr: valueWord('15'), args: [valueWord('5')], locals: [valueWord('0')] })
    expect(rxmValues(s, true).rows.map((r) => [r.name, r.result])).toEqual([
      ['rr', true],
      ['pc', false],
      ['a0', false],
      ['r0', false],
    ])
  })

  it('keeps the order of pc, rr, the arguments and the locals otherwise', () => {
    const s = frameOf({ next: null, rr: valueWord('15'), args: [valueWord('5')], locals: [valueWord('0')] })
    expect(rxmValues(s, false).rows.map((r) => [r.name, r.result])).toEqual([
      ['pc', false],
      ['rr', false],
      ['a0', false],
      ['r0', false],
    ])
  })
})
