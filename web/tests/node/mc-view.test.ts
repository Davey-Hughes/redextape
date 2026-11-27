import { describe, expect, it } from 'vitest'
import { CLIF_COPY } from '../../src/clif-view'
import { MC_COPY, mcFunctionLine, mcLine, mcNotice, mcOffset, mcRows, mcTitle } from '../../src/mc-view'
import type { ClifCompiled } from '../../src/protocol'
import type { McListing, McRow } from '../../src/types'
import { LEG_DISPLAY, mcDisplay } from '../../src/workspace'

const inst = (offset: number, pc: number | null, text: string, more: Partial<McRow> = {}): McRow => ({
  kind: 'Inst',
  function: 0,
  offset,
  bytes: '4889e5',
  pc,
  text,
  intel: null,
  callee: null,
  ...more,
})

const CODE: McListing = {
  target: 'x86-64',
  functions: [
    { name: 'u0:11', label: '$main', size: 8, first_row: 0 },
    { name: 'u0:12', label: 'fact.0', size: 1, first_row: 4 },
  ],
  rows: [
    { ...inst(0, null, ''), kind: 'Function', bytes: '' },
    inst(0, null, 'pushq %rbp', { intel: 'push rbp' }),
    inst(1, 3, 'callq 0x6', { callee: 'u0:12 fact.0', intel: 'call 0x6' }),
    { ...inst(0, null, ''), kind: 'Blank', function: 1, bytes: '' },
    { ...inst(0, null, ''), kind: 'Function', function: 1, bytes: '' },
    inst(0, 3, 'retq', { function: 1, intel: 'ret' }),
  ],
}

describe('the machine code rows', () => {
  it('makes the Inst rows instructions and every other row a label before the next', () => {
    const rows = mcRows(CODE)
    expect(rows.source.listing).toEqual(['pushq %rbp', 'callq 0x6', 'retq'])
    expect(rows.source.labels).toEqual([
      ['0', 0],
      ['3', 2],
      ['4', 2],
    ])
    expect(rows.rowOf).toEqual([1, 2, 5])
  })

  it('finds every machine instruction of a pc, in listing order, and none of a pc it lacks', () => {
    const rows = mcRows(CODE)
    expect(rows.ordinalsOfPc(3)).toEqual([1, 2])
    expect(rows.ordinalsOfPc(9)).toEqual([])
  })

  it('reads an instruction in the syntax asked for, an arm64 one in its one syntax', () => {
    const row = CODE.rows[2] as McRow
    expect(mcLine(row, 'att', false)).toEqual({
      offset: '0001',
      pc: 'pc3',
      bytes: '',
      text: 'callq 0x6',
      callee: '; u0:12 fact.0',
    })
    expect(mcLine(row, 'intel', true)).toMatchObject({ text: 'call 0x6', bytes: '48 89 e5' })
    expect(mcLine(inst(0, null, 'ret'), 'intel', false)).toMatchObject({ text: 'ret', pc: '', callee: '' })
  })

  it('names a function as the call stack does, with its size', () => {
    expect(mcFunctionLine(CODE, 0)).toBe('u0:11 $main  8 bytes')
    expect(mcFunctionLine(CODE, 1)).toBe('u0:12 fact.0  1 byte')
    expect(mcFunctionLine(CODE, 2)).toBe('')
  })

  it('pads an offset to four hex digits', () => {
    expect(mcOffset(0x1a)).toBe('001a')
    expect(mcOffset(0x12345)).toBe('12345')
  })

  it('titles the panel with the target and the listing in the words of the view’s choice', () => {
    expect(mcTitle('x86-64', 'as-built')).toBe('x86-64 · as built')
    expect(mcTitle('arm64', 'optimised')).toBe('arm64 · optimised')
  })

  it('says what it shows instead of rows beside a listing, the answer first', () => {
    const listed = { listing: { rows: [] } } as unknown as ClifCompiled
    expect(mcNotice('ready', { code: CODE }, listed, '')).toBeNull()
    expect(mcNotice('failed', { declined: 'too deep' }, listed, '')).toEqual({ kind: 'declined', text: 'too deep' })
    expect(mcNotice('ready', { trapped: 'unreachable' }, listed, '')).toEqual({ kind: 'trapped' })
    expect(mcNotice('failed', null, listed, '')).toEqual({ kind: 'failed' })
    expect(mcNotice('ready', null, listed, '')).toEqual({ kind: 'building' })
    expect(mcNotice('idle', null, listed, '')).toEqual({ kind: 'loading' })
    expect(mcNotice('loading', null, listed, '')).toEqual({ kind: 'loading' })
  })

  it('says what the listing says where the view has none', () => {
    const declined: ClifCompiled = { error: 'the program nests too deep' }
    expect(mcNotice('ready', null, declined, '')).toEqual({ kind: 'declined', text: 'the program nests too deep' })
    expect(mcNotice('ready', { code: CODE }, declined, '')).toEqual({
      kind: 'declined',
      text: 'the program nests too deep',
    })
    expect(mcNotice('ready', { code: CODE }, null, 'not compiled')).toBeNull()
    expect(mcNotice('ready', { code: CODE }, null, '')).toEqual({ kind: 'building' })
    expect(mcNotice('failed', null, null, '')).toEqual({ kind: 'failed' })
  })

  it('reads a trap as no decline of the program', () => {
    expect(MC_COPY.trapped).not.toContain('No machine code for this program')
    expect(MC_COPY.trapped).not.toContain('unreachable')
  })

  /**
   * **TWO RETRIES CAN SHARE A CLIF VIEW**, its own and its machine code panel's, when both packages failed to load, so
   * each is named for what it loads; and each name starts with the word the button shows, so a spoken "click Retry"
   * still finds them.
   */
  it('names its Retry apart from the clif notice’s, starting with the word both show', () => {
    expect(MC_COPY.retryName).toBe('Retry loading machine code')
    expect(CLIF_COPY.retryName).toBe('Retry loading clif')
    for (const copy of [MC_COPY, CLIF_COPY]) expect(copy.retryName.startsWith(`${copy.retry} `)).toBe(true)
  })
})

describe('a CLIF view’s machine code settings', () => {
  it('default to x86-64 in AT&T syntax without bytes', () => {
    expect(mcDisplay({ layout: 'compact' })).toEqual({ target: 'x86-64', syntax: 'att', bytes: false })
  })

  it('are read back as stored, and a malformed one is refused', () => {
    const { parse } = LEG_DISPLAY.clif
    expect(parse({ layout: 'exact' })).toEqual({ layout: 'exact' })
    expect(parse({ layout: 'exact', target: 'arm64', syntax: 'intel', bytes: true })).toEqual({
      layout: 'exact',
      target: 'arm64',
      syntax: 'intel',
      bytes: true,
    })
    expect(parse({ layout: 'exact', target: 'riscv' })).toBeNull()
    expect(parse({ layout: 'exact', syntax: 'masm' })).toBeNull()
    expect(parse({ layout: 'exact', bytes: 'yes' })).toBeNull()
  })
})
