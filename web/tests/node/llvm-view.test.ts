import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { compile, initSync as initPkg, type Session } from '../../../pkg/redextape_wasm.js'
import { initSync as initLlvm, llvmIr } from '../../../pkg-llvm/redextape_llvm_wasm.js'
import { EXAMPLES } from '../../src/examples'
import { placeLabels } from '../../src/label-rows'
import { LLVM_COPY, type LlvmAnswer, llvmNotice, llvmRows } from '../../src/llvm-view'
import { RXM_WINDOW } from '../../src/protocol'
import type { LlvmLine, LlvmListing, RxmProgram, RxmState } from '../../src/types'

/**
 * **THE LLVM VIEW'S ROWS, THE LINES OF A PC AND THE BLOCK IT FOLLOWS, AND ITS WORDS, FIRST ON A MODULE WRITTEN HERE
 * AND THEN ON EVERY EXAMPLE'S, AS `pkg-llvm/` WRITES IT FROM `pkg/`'s `clifInput()`.** The examples are where the view
 * meets the pcs a run stands on, so each is stepped through `pkg/`'s rxm leg and every pc it stands on must have its
 * lines.
 */

const line = (text: string, pc: number | null = null): LlvmLine => ({ text, pc })

/**
 * Two functions, as the writer lays one out: a `prologue` with no pc, an instruction's `i<pc>` block, the `exit`, and
 * after it a `cont` block that the instruction's guard opened, away from its block.
 */
const MODULE: LlvmListing = {
  functions: [
    { name: '"$main"', label: '$main', first_line: 2 },
    { name: 'f.0', label: 'f.0', first_line: 13 },
  ],
  lines: [
    line("; ModuleID = 'redextape'"),
    line(''),
    line('define i64 @"$main"() {'),
    line('prologue:'),
    line('  br label %i0'),
    line('i0:                                               ; preds = %prologue', 0),
    line('  %r0 = call i64 @f.0()', 0),
    line('  br i1 %ovf, label %trap, label %cont', 0),
    line('exit:                                             ; preds = %cont'),
    line('  ret i64 0'),
    line('cont:                                             ; preds = %i0', 0),
    line('  br label %exit', 0),
    line('}'),
    line('define i64 @f.0() {'),
    line('i1:', 1),
    line('  ret i64 7', 1),
    line('}'),
  ],
}

describe('the rows of a module', () => {
  it("makes each line an item but a function's `define`, a label named by its line, before the next item", () => {
    const rows = llvmRows(MODULE)
    expect(rows.source.listing).toEqual(MODULE.lines.filter((l) => !l.text.startsWith('define ')).map((l) => l.text))
    expect(rows.source.labels).toEqual([
      ['2', 2],
      ['13', 12],
    ])
    expect(rows.lineOf).toEqual([0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16])
  })

  it("gives an item's pc, and none for a line with none or an item it does not have", () => {
    const rows = llvmRows(MODULE)
    expect(rows.source.listing.map((_, o) => rows.pcOf(o))).toEqual([
      null,
      null,
      null,
      null,
      0,
      0,
      0,
      null,
      null,
      0,
      0,
      null,
      1,
      1,
      null,
    ])
    expect(rows.pcOf(-1)).toBeNull()
    expect(rows.pcOf(15)).toBeNull()
    // A MODULE WHOSE LAST ITEM HAS A PC, AS `MODULE`'S HAS NOT: an ordinal before the first that wrapped round to the
    // end would read it.
    const ends = llvmRows({ functions: [], lines: [line('i0:', 0)] })
    expect(ends.pcOf(0), 'precondition: the last item has a pc').toBe(0)
    expect(ends.pcOf(-1)).toBeNull()
    expect(ends.pcOf(1)).toBeNull()
  })

  it("finds a pc's items in listing order, its `cont` block's after `exit` too, and none of a pc it lacks", () => {
    const rows = llvmRows(MODULE)
    expect(rows.ordinalsOfPc(0)).toEqual([4, 5, 6, 9, 10])
    expect(rows.ordinalsOfPc(1)).toEqual([12, 13])
    expect(rows.ordinalsOfPc(9)).toEqual([])
  })

  it("follows a pc's own block, from its first item to the last before another line, and not its `cont` block", () => {
    const rows = llvmRows(MODULE)
    expect(rows.followOf(0)).toEqual({ first: 4, last: 6 })
    expect(rows.followOf(1)).toEqual({ first: 12, last: 13 })
    expect(rows.followOf(9)).toBeNull()
  })

  it("takes a `define` from its function's `first_line`: a line no function names is an item, whatever it says", () => {
    const rows = llvmRows({
      functions: [{ name: 'f', label: 'f', first_line: 1 }],
      lines: [line("; ModuleID = 'redextape'"), line('define i64 @f() {'), line('}'), line('define i64 @g() {')],
    })
    expect(rows.source).toEqual({ listing: ["; ModuleID = 'redextape'", '}', 'define i64 @g() {'], labels: [['1', 1]] })
  })

  it('holds a module with no function as items alone', () => {
    const rows = llvmRows({ functions: [], lines: [line("; ModuleID = 'redextape'"), line('')] })
    expect(rows.source).toEqual({ listing: ["; ModuleID = 'redextape'", ''], labels: [] })
    expect(rows.followOf(0)).toBeNull()
  })
})

describe('what the view says while it has no rows', () => {
  const ir: LlvmAnswer = { ir: MODULE }

  it('says nothing over the rows, or while the leg cannot run', () => {
    expect(llvmNotice('ready', ir, '')).toBeNull()
    expect(llvmNotice('loading', null, 'not compiled')).toBeNull()
    expect(llvmNotice('failed', null, 'not compiled')).toBeNull()
  })

  it("gives the writer's refusal in its words, and a trap as the package's", () => {
    expect(llvmNotice('ready', { declined: 'it has no main' }, '')).toEqual({
      kind: 'declined',
      text: 'it has no main',
    })
    expect(llvmNotice('ready', { trapped: 'unreachable' }, '')).toEqual({ kind: 'trapped' })
  })

  it('gives an answer already received before the leg says it cannot run', () => {
    expect(llvmNotice('ready', { declined: 'it has no main' }, 'not compiled')).toEqual({
      kind: 'declined',
      text: 'it has no main',
    })
  })

  it('says the package loads, failed to, or is in and writing, while there is no answer', () => {
    expect(llvmNotice('idle', null, '')).toEqual({ kind: 'loading' })
    expect(llvmNotice('loading', null, '')).toEqual({ kind: 'loading' })
    expect(llvmNotice('failed', null, '')).toEqual({ kind: 'failed' })
    expect(llvmNotice('ready', null, '')).toEqual({ kind: 'writing' })
  })

  it('names itself llvm, as its toggle does, and puts the reason after a colon', () => {
    expect(LLVM_COPY).toEqual({
      loading: 'Loading llvm…',
      writing: 'Writing llvm…',
      failed: 'llvm could not be loaded.',
      retry: 'Retry',
      retryName: 'Retry loading llvm',
      declined: expect.any(Function),
      trapped: 'llvm could not be written: the package stopped with an error.',
    })
    expect(LLVM_COPY.declined('the reason')).toBe('No llvm for this program: the reason')
  })
})

const ROOT = new URL('../../../', import.meta.url)
const read = (path: string): Buffer => readFileSync(fileURLToPath(new URL(path, ROOT)))

beforeAll(() => {
  initPkg({ module: read('pkg/redextape_wasm_bg.wasm') })
  initLlvm({ module: read('pkg-llvm/redextape_llvm_wasm_bg.wasm') })
})

function compiled(src: string): Session {
  const { session } = compile(src, 'unary') as { session: Session | null }
  if (session === null) throw new Error(`no session for ${src}`)
  return session
}

/** A bound on the steps of an example's rxm run, far past every example's end, so a run that never ends fails. */
const STEPS = 10_000

describe.each(EXAMPLES)('example $id', ({ text: src }) => {
  const session = (): Session => compiled(src)
  const module = (s: Session): LlvmListing => llvmIr(s.clifInput()) as LlvmListing

  it('lays its items and labels out as the text, a label at each `define`, all of which the package names', () => {
    const ir = module(session())
    const rows = llvmRows(ir)
    const drawn: string[] = []
    placeLabels(
      rows.source.listing.length,
      rows.source.labels,
      (name) => drawn.push(ir.lines[Number(name)]?.text ?? `no line ${name}`),
      (i) => drawn.push(rows.source.listing[i] ?? `no item ${i}`),
    )
    expect(drawn).toEqual(ir.lines.map((l) => l.text))
    expect(rows.source.labels.map(([name]) => Number(name))).toEqual(ir.functions.map((f) => f.first_line))
    expect(ir.lines.flatMap((l, n) => (l.text.startsWith('define ') ? [n] : []))).toEqual(
      ir.functions.map((f) => f.first_line),
    )
    expect(rows.lineOf.map((n) => ir.lines[n]?.pc)).toEqual(rows.lineOf.map((_, i) => rows.pcOf(i)))
  })

  it("marks each line with a pc as that pc's, and follows each instruction's own `i<pc>` block whole", () => {
    const s = session()
    const ir = module(s)
    const rows = llvmRows(ir)
    const program = s.rxmProgram() as RxmProgram
    expect(program.listing.length, 'precondition: the rxm program has instructions').toBeGreaterThan(0)
    const marked = new Set<number>()
    for (const pc of program.listing.keys()) {
      const ordinals = rows.ordinalsOfPc(pc)
      for (const o of ordinals) {
        expect(rows.pcOf(o), `item ${o} of pc ${pc}`).toBe(pc)
        marked.add(o)
      }
      const follow = rows.followOf(pc)
      expect(follow, `pc ${pc} has a block`).not.toBeNull()
      if (follow === null) continue
      expect(ir.lines[rows.lineOf[follow.first] ?? -1]?.text).toMatch(new RegExp(`^i${pc}:`))
      for (let o = follow.first; o <= follow.last; o += 1) expect(rows.pcOf(o)).toBe(pc)
      expect(rows.pcOf(follow.last + 1), `the item after pc ${pc}'s block`).not.toBe(pc)
      expect(ordinals.slice(0, follow.last - follow.first + 1)).toEqual(
        Array.from({ length: follow.last - follow.first + 1 }, (_, i) => follow.first + i),
      )
    }
    const withPc = rows.lineOf.flatMap((n, o) => (ir.lines[n]?.pc === null ? [] : [o]))
    expect([...marked].sort((a, b) => a - b)).toEqual(withPc)
  })

  it('has lines for every pc its rxm run stands on to its halt, and a block for each instruction about to run', () => {
    const s = session()
    const rows = llvmRows(module(s))
    const status = s.rxmStatus() as { available: boolean }
    expect(status.available, 'precondition: the rxm leg runs').toBe(true)
    let steps = 0
    for (;;) {
      const frame = s.rxmState(RXM_WINDOW) as RxmState
      expect(rows.ordinalsOfPc(frame.pc), `step ${frame.step} at pc ${frame.pc}`).not.toEqual([])
      if (frame.next !== null) expect(rows.followOf(frame.next), `step ${frame.step}`).not.toBeNull()
      if (!s.stepRxm()) break
      steps += 1
      expect(steps, 'the run ends').toBeLessThan(STEPS)
    }
    expect(steps, 'precondition: the run stepped').toBeGreaterThan(0)
    expect((s.rxmStatus() as { run: unknown }).run, 'precondition: the run ended').toBe('Ended')
  })
})
