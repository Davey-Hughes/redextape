import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { compile, initSync as initPkg, type Session } from '../../../pkg/redextape_wasm.js'
import { ClifSession, initSync as initClif } from '../../../pkg-clif/redextape_clif_wasm.js'
import {
  CLIF_COPY,
  clifHeap,
  clifLeads,
  clifNotice,
  clifRows,
  clifStack,
  clifValues,
  PC_COLUMNS,
  pcColumn,
} from '../../src/clif-view'
import { CLIF_WINDOW } from '../../src/protocol'
import { frames } from '../../src/rxm-view'
import type { ClifListing, ClifRow, ClifState } from '../../src/types'
import { FACT_95 } from './clif-frames'

const ROOT = new URL('../../../', import.meta.url)
const read = (path: string): Buffer => readFileSync(fileURLToPath(new URL(path, ROOT)))
const FACT = read('web/src/examples/fact.rxt').toString('utf8')
/** A program whose listing has rows of pc 1,000 and more, whose pc column is wider than `PC_COLUMNS`. */
const LONG = `let mut a = 0; ${Array.from({ length: 400 }, (_, i) => `a = a + ${(i % 7) + 1}; `).join('')}a`
/** A program whose frame holds list cells and a box at once. */
const CELLS_AND_BOX = 'let xs = cons(1, cons(2, nil)); let mut v = 2; let get = |x| v + x; get(head(xs))'

/** `CELLS_AND_BOX` as built at step 64: 4 cells, a box, and a value that names cell 4. */
const CELLS_AND_BOX_64: ClifState = {
  step: 64,
  at: { function: 1, inst: 0 },
  next: { function: 1, inst: 0 },
  pc: null,
  values: [
    { value: 0, word: { word: '0', tag: 'Value' }, regs: [] },
    { value: 1, word: { word: '4', tag: 'List' }, regs: ['a0'] },
    { value: 2, word: { word: '1', tag: 'Value' }, regs: ['a1'] },
  ],
  values_len: 3,
  depth: 2,
  frames: [
    { function: 1, inst: 0 },
    { function: 0, inst: 63 },
  ],
  heap_len: 4,
  cells: [
    { cell: 4, head: { word: '0', tag: 'Value' }, tail: { word: '3', tag: 'List' } },
    { cell: 3, head: { word: '1', tag: 'Box' }, tail: { word: '0', tag: 'Value' } },
    { cell: 2, head: { word: '1', tag: 'Value' }, tail: { word: '1', tag: 'List' } },
    { cell: 1, head: { word: '2', tag: 'Value' }, tail: { word: '0', tag: 'Value' } },
  ],
  box_len: 1,
  boxes: [{ handle: 1, content: { word: '2', tag: 'Value' } }],
}

beforeAll(() => {
  initPkg({ module: read('pkg/redextape_wasm_bg.wasm') })
  initClif({ module: read('pkg-clif/redextape_clif_wasm_bg.wasm') })
})

/** `src`'s CLIF session as `listing`, through the real exports of both builds. */
function clif(src: string, listing: string): ClifSession {
  const { session } = compile(src, 'binary') as { session: Session | null }
  if (session === null) throw new Error(`no session for ${src}`)
  return new ClifSession(session.clifInput(), listing)
}

function listingOf(src: string, listing: string): ClifListing {
  return clif(src, listing).listing() as ClifListing
}

/** `src`'s as-built frame after `steps` steps, cut to the window the session worker asks for. */
function frameAt(src: string, steps: number): ClifState {
  const session = clif(src, 'as-built')
  for (let i = 0; i < steps; i += 1) if (!session.step()) throw new Error(`${src} ended before step ${steps}`)
  return session.state(CLIF_WINDOW) as ClifState
}

describe('the fixtures', () => {
  it('are the frames the real builds give', () => {
    expect(frameAt(FACT, 95)).toEqual(FACT_95)
    expect(frameAt(CELLS_AND_BOX, 64)).toEqual(CELLS_AND_BOX_64)
  })
})

describe('the listing', () => {
  it('lists each Inst row and makes every other row a label', () => {
    const { source } = clifRows(listingOf(FACT, 'as-built'))
    expect(source.listing).toHaveLength(59)
    expect(source.labels).toHaveLength(128)
  })

  it('puts a label before the Inst row after it, and the rows after the last one at the count', () => {
    const l = listingOf(FACT, 'as-built')
    const { labels } = clifRows(l).source
    expect(l.rows[0]?.kind, 'precondition: row 0 heads a function').toBe('Function')
    expect(labels[0]).toEqual(['0', 0])
    expect(l.rows.at(-1)?.kind, 'precondition: the last row closes a function').toBe('Close')
    expect(labels.at(-1)).toEqual([String(l.rows.length - 1), 59])
  })

  it.each(['as-built', 'optimised'])(
    "finds each ordinal's Inst row and the ordinal back from its instruction, %s",
    (listing) => {
      const l = listingOf(FACT, listing)
      const rows = clifRows(l)
      expect(rows.rowOf).toHaveLength(rows.source.listing.length)
      for (const [i, row] of rows.rowOf.entries()) {
        const r = l.rows[row]
        expect(r?.kind).toBe('Inst')
        expect(rows.source.listing[i]).toBe(r?.text)
        expect(r?.at).not.toBeNull()
        if (r?.at) expect(rows.ordinalOf(r.at)).toBe(i)
      }
    },
  )

  it('has no ordinal for an instruction of no function', () => {
    const l = listingOf(FACT, 'as-built')
    expect(clifRows(l).ordinalOf({ function: l.functions.length, inst: 0 })).toBeNull()
  })

  it.each([
    ['as-built', 5, 3],
    ['optimised', 5, 2],
  ])('finds the instructions an rxm pc was lowered to, %s', (listing, call, cmpeq) => {
    const rows = clifRows(listingOf(FACT, listing))
    expect(rows.ordinalsOfPc(13)).toHaveLength(call)
    expect(rows.ordinalsOfPc(4)).toHaveLength(cmpeq)
  })

  it("names a row's rxm pc, and nothing for a row with no srcloc", () => {
    expect(pcColumn(13)).toBe('pc13')
    expect(pcColumn(null)).toBe('')
  })
})

describe('the layouts', () => {
  /**
   * The columns each kind of `l`'s rows starts its text at under `leads`, each list sorted: an Inst row's pc column
   * is `PC_COLUMNS` wide, or as wide as its label where that is wider (`.rxm-pc`'s `min-width`), and its lead follows.
   */
  function columnsByKind(l: ClifListing, leads: readonly number[]): Record<string, number[]> {
    const by: Record<string, Set<number>> = {}
    for (const [i, r] of l.rows.entries()) {
      const pc = r.kind === 'Inst' ? Math.max(PC_COLUMNS, pcColumn(r.pc).length) : 0
      by[r.kind] = (by[r.kind] ?? new Set()).add(pc + (leads[i] ?? 0))
    }
    return Object.fromEntries(Object.entries(by).map(([kind, at]) => [kind, [...at].sort((a, b) => a - b)]))
  }

  it.each(['as-built', 'optimised'])('lays %s out exactly as Cranelift prints it in exact', (listing) => {
    const l = listingOf(FACT, listing)
    const leads = clifLeads(l, 'exact')
    // CRANELIFT'S COLUMNS: an Inst row's indent counts its pc column, which stands where Cranelift prints the srcloc
    // it pads to that indent.
    const pc = (r: ClifRow) => Math.max(PC_COLUMNS, pcColumn(r.pc).length)
    expect(leads).toEqual(l.rows.map((r) => (r.kind === 'Inst' ? Math.max(0, r.indent - pc(r)) : r.indent)))
    expect(columnsByKind(l, leads)).toEqual({
      Function: [0],
      Decl: [4],
      Blank: [0],
      Block: [32],
      Inst: [36],
      ...(listing === 'as-built' ? { Alias: [36] } : {}),
      Close: [0],
    })
  })

  it.each(['as-built', 'optimised'])(
    'lays %s out compactly: each function as Cranelift prints one with no source locations, beside the pc column',
    (listing) => {
      const l = listingOf(FACT, listing)
      expect(l.functions, 'precondition: two functions').toHaveLength(2)
      // THE GUTTER IS THE PC COLUMN AND THE SPACE AFTER IT, 6; the function line, a block header and the brace start
      // there, and the preamble, an instruction and an alias 4 further in. A blank line has no text to place, so it has
      // no lead either, and a selection copies no spaces from it.
      expect(columnsByKind(l, clifLeads(l, 'compact'))).toEqual({
        Function: [6],
        Decl: [10],
        Blank: [0],
        Block: [6],
        Inst: [10],
        ...(listing === 'as-built' ? { Alias: [10] } : {}),
        Close: [6],
      })
    },
  )

  it.each(['as-built', 'optimised'])(
    'widens the compact gutter to the widest pc, and keeps the exact columns, for a listing of pc 1,000 and more, %s',
    (listing) => {
      const l = listingOf(LONG, listing)
      const widest = Math.max(...l.rows.map((r) => pcColumn(r.pc).length))
      expect(widest, 'precondition: a label of six characters, pc1000 and more').toBe(6)
      expect(columnsByKind(l, clifLeads(l, 'compact'))).toEqual({
        Function: [7],
        Decl: [11],
        Blank: [0],
        Block: [7],
        Inst: [11],
        ...(listing === 'as-built' ? { Alias: [11] } : {}),
        Close: [7],
      })
      // CRANELIFT PADS A SRCLOC TO THE INDENT, so in exact every instruction's text starts in one column whatever its
      // label's width.
      expect(columnsByKind(l, clifLeads(l, 'exact')).Inst).toEqual([36])
    },
  )
})

describe('the values', () => {
  it('has a row per value, with its registers and no marks', () => {
    const view = clifValues(FACT_95)
    expect(view.rows).toHaveLength(17)
    expect(view.rows[1]).toEqual({ name: 'v1', text: '2', regs: ['a0'], changed: false, unwritten: false, says: [] })
    expect(view.rows[0]?.regs).toEqual([])
    expect(view.notes).toEqual([])
  })

  it('says how many values the window hides, as the rxm registers do', () => {
    const cut = (shown: number) => clifValues({ ...FACT_95, values: FACT_95.values.slice(0, shown) }).notes
    expect(cut(16)).toEqual([{ text: '+1 more value', legend: false }])
    expect(cut(15)).toEqual([{ text: '+2 more values', legend: false }])
  })
})

describe('the call stack', () => {
  it('names each frame by its function and label, top first', () => {
    const view = clifStack(FACT_95, listingOf(FACT, 'as-built'))
    expect(view.frames.map((f) => f.callee)).toEqual(['u0:12 fact.0', 'u0:12 fact.0', 'u0:12 fact.0', 'u0:11 $main'])
    expect(view.count).toBe(frames(4))
  })

  it("gives each frame its instruction's rxm pc: the running one's, and each caller's call", () => {
    const view = clifStack(FACT_95, listingOf(FACT, 'as-built'))
    expect(view.frames.map((f) => f.ret)).toEqual([pcColumn(FACT_95.pc), 'pc13', 'pc13', 'pc19'])
    expect(view.frames.map((f) => f.saved)).toEqual(['', '', '', ''])
    expect(view.notes).toEqual([])
  })

  it('says how many frames the window hides', () => {
    const view = clifStack({ ...FACT_95, frames: FACT_95.frames.slice(0, 2) }, listingOf(FACT, 'as-built'))
    expect(view.count).toBe(frames(4))
    expect(view.notes).toEqual(['+2 more'])
  })
})

describe('the heap', () => {
  it("lists the frame's cells then its boxes, in the frame's order", () => {
    const view = clifHeap(CELLS_AND_BOX_64)
    expect(view.count).toBe('4 cells · 1 box')
    expect(view.items.map((item) => (item.kind === 'line' ? [item.lead, item.body] : item.text))).toEqual([
      ['#4', '0 → #3'],
      ['#3', 'box #1 → 0'],
      ['#2', '1 → #1'],
      ['#1', '2 → 0'],
      ['box #1', '2'],
    ])
  })

  it('names the values whose list or box word is the cell or box', () => {
    const view = clifHeap(CELLS_AND_BOX_64)
    expect(view.items.map((item) => (item.kind === 'line' ? item.refs : null))).toEqual([['v1'], [], [], [], []])
  })
})

describe('the notice', () => {
  const listing: ClifListing = { functions: [], rows: [] }

  it('gives way to a listing', () => {
    expect(clifNotice('ready', { listing }, '')).toBeNull()
  })

  it('shows a listing it holds whatever the load says', () => {
    expect(clifNotice('failed', { listing }, '')).toBeNull()
  })

  it('says why a program has no CLIF', () => {
    expect(clifNotice('ready', { error: 'x' }, '')).toEqual({ kind: 'declined', text: 'x' })
    expect(CLIF_COPY.declined('x')).toBe('No clif for this program: x')
  })

  it('says a failed load failed', () => {
    expect(clifNotice('failed', null, '')).toEqual({ kind: 'failed' })
  })

  it('says nothing of the load while the leg cannot run, its step bar saying why', () => {
    expect(clifNotice('ready', null, 'not compiled')).toBeNull()
  })

  it('says it is loading until it has a listing or a reason', () => {
    expect(clifNotice('loading', null, '')).toEqual({ kind: 'loading' })
    expect(clifNotice('ready', null, '')).toEqual({ kind: 'loading' })
  })
})
