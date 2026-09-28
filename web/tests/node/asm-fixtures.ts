import type { AsmProgram, AsmState } from '../../src/types'

/**
 * `fact(3)`'s asm listing and labels, as `redextape --no-config emit fact.rxt --lang asm` prints them for
 * `fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)` — 21 instructions and 4 labels (spec §2.5). Each
 * line is `print_instr`'s, a tab between mnemonic and operands.
 */
export const FACT3: AsmProgram = {
  listing: [
    'jmp\tskip1',
    'mov\tr0, a0',
    'mov\tr2, r0',
    'li\tr3, #0',
    'cmpeq\tr1, r2, r3',
    'jz\tr1, else2',
    'li\trr, #1',
    'jmp\tendif3',
    'mov\tr4, r0',
    'mov\tr7, r0',
    'li\tr8, #1',
    'sub\tr6, r7, r8',
    'mov\ta0, r6',
    'call\tfact.0',
    'mov\tr5, rr',
    'mul\trr, r4, r5',
    'ret',
    'li\tr0, #3',
    'mov\ta0, r0',
    'call\tfact.0',
    'halt',
  ],
  labels: [
    ['fact.0', 1],
    ['else2', 8],
    ['endif3', 16],
    ['skip1', 17],
  ],
}

/**
 * A frame with nothing in it but what `over` says: step 0, `pc` 0, `rr` the value 0, no registers, no frames, an empty
 * heap. `locals_len`, `args_len`, `heap_len` and `box_len` default to what the window shows, so a fixture that windows
 * nothing need not say them.
 */
export function frameOf(over: Partial<AsmState> = {}): AsmState {
  const locals = over.locals ?? []
  const args = over.args ?? []
  const cells = over.cells ?? []
  const boxes = over.boxes ?? []
  return {
    step: 0,
    pc: 0,
    next: 0,
    rr: { word: '0', tag: 'Value' },
    written: locals.map(() => true),
    locals_len: locals.length,
    args_len: args.length,
    wrote: null,
    depth: 0,
    frames: [],
    heap_len: cells.length,
    box_len: boxes.length,
    source_node: null,
    ...over,
    locals,
    args,
    cells,
    boxes,
  }
}
