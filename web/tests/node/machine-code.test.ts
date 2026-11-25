import { describe, expect, it, vi } from 'vitest'
import { MachineCode } from '../../src/machine-code'
import type { RunReply } from '../../src/protocol'
import type { McListing } from '../../src/types'

/**
 * The page's machine code store (machine code panel design §6): what it says of each target's load, which answer it
 * shows while a keystroke's compile is under way, and how many asks reach the worker. A fake port stands for the
 * program's `SessionClient`, its generation moved by hand as a keystroke and a `compiled` move it.
 */

const CODE: McListing = { target: 'x86-64', functions: [], rows: [] }
const OTHER: McListing = {
  target: 'x86-64',
  functions: [{ name: 'u0:11', label: '$main', size: 1, first_row: 0 }],
  rows: [],
}

/** A port whose generation is `gen.now`, and the store over it, compiled at generation 1 with x86-64's package in. */
function store(ready = true) {
  const gen = { now: 1 }
  const port = { gen: () => gen.now, load: vi.fn(), ask: vi.fn() }
  const mc = new MachineCode(port)
  mc.compiled(1)
  if (ready) mc.loaded('x86-64', 'ready')
  return { gen, port, mc }
}

const answer = (o: Partial<Extract<RunReply, { kind: 'mc' }>> = {}): Extract<RunReply, { kind: 'mc' }> => ({
  kind: 'mc',
  gen: 1,
  target: 'x86-64',
  listing: 'as-built',
  code: CODE,
  error: null,
  trapped: false,
  ...o,
})

describe('the page’s machine code', () => {
  it('asks once per generation, listing and target, and again for a new generation', () => {
    const { gen, port, mc } = store()
    mc.loaded('arm64', 'ready')
    mc.want('x86-64', 'as-built')
    mc.want('x86-64', 'as-built')
    mc.want('arm64', 'as-built')
    mc.want('x86-64', 'optimised')
    expect(port.ask.mock.calls).toEqual([
      ['x86-64', 'as-built'],
      ['arm64', 'as-built'],
      ['x86-64', 'optimised'],
    ])
    gen.now = 2
    mc.compiled(2)
    mc.want('x86-64', 'as-built')
    mc.want('x86-64', 'as-built')
    expect(port.ask).toHaveBeenCalledTimes(4)
  })

  it('asks nothing for a generation a keystroke claimed until its compiled comes, then asks', () => {
    const { gen, port, mc } = store()
    gen.now = 2
    mc.want('x86-64', 'as-built')
    expect(port.ask).not.toHaveBeenCalled()
    mc.compiled(2)
    mc.want('x86-64', 'as-built')
    expect(port.ask.mock.calls).toEqual([['x86-64', 'as-built']])
  })

  it('asks nothing before the first build', () => {
    const port = { gen: () => 0, load: vi.fn(), ask: vi.fn() }
    const mc = new MachineCode(port)
    mc.loaded('x86-64', 'ready')
    mc.want('x86-64', 'as-built')
    expect(port.ask).not.toHaveBeenCalled()
  })

  /** A keystroke claims its generation at once, and the listing shows the old program until the new one's `compiled`. */
  it('shows the last compiled generation’s answer until the next compiled, and none of another generation', () => {
    const { gen, mc } = store()
    mc.want('x86-64', 'as-built')
    mc.answered(answer())
    expect(mc.code('x86-64', 'as-built')).toEqual({ code: CODE })
    expect(mc.code('arm64', 'as-built')).toBeNull()
    gen.now = 2
    expect(mc.code('x86-64', 'as-built'), 'the old program’s, kept through the keystroke').toEqual({ code: CODE })
    mc.compiled(2)
    expect(mc.code('x86-64', 'as-built'), 'gone at the new compiled').toBeNull()
    mc.answered(answer())
    expect(mc.code('x86-64', 'as-built'), 'an older generation’s answer').toBeNull()
    mc.answered(answer({ gen: 2, code: OTHER }))
    expect(mc.code('x86-64', 'as-built')).toEqual({ code: OTHER })
  })

  it('keeps a decline and a trap as answers of their own', () => {
    const { mc } = store()
    mc.answered(answer({ listing: 'optimised', code: null, error: 'too deep' }))
    expect(mc.code('x86-64', 'optimised')).toEqual({ declined: 'too deep' })
    mc.answered(answer({ code: null, error: 'unreachable', trapped: true }))
    expect(mc.code('x86-64', 'as-built')).toEqual({ trapped: 'unreachable' })
  })

  it('fetches on intent once, and says loading only as it posts the load', () => {
    const { port, mc } = store(false)
    expect(mc.load('arm64')).toBe('idle')
    mc.intent('arm64')
    mc.intent('arm64')
    expect(port.load.mock.calls).toEqual([['arm64']])
    expect(mc.load('arm64')).toBe('loading')
    mc.loaded('arm64', 'ready')
    mc.intent('arm64')
    expect(port.load).toHaveBeenCalledTimes(1)
    expect(mc.load('arm64')).toBe('ready')
  })

  /** The worker answers every `mc-load`; an `mc` of a superseded run is answered by nothing, so it posts no load. */
  it('loads, never asks, while the package is not in, so no ask waits on a load', () => {
    const { port, mc } = store(false)
    mc.want('arm64', 'as-built')
    expect(port.load.mock.calls, 'a want from idle posts the load').toEqual([['arm64']])
    expect(mc.load('arm64')).toBe('loading')
    mc.want('arm64', 'as-built')
    expect(port.ask, 'no ask while it loads').not.toHaveBeenCalled()
    mc.loaded('arm64', 'ready')
    mc.want('arm64', 'as-built')
    expect(port.ask.mock.calls).toEqual([['arm64', 'as-built']])
  })

  it('asks nothing while a load has failed; Retry loads again and the ask follows the load, once', () => {
    const { port, mc } = store(false)
    mc.intent('arm64')
    mc.loaded('arm64', 'failed')
    mc.want('arm64', 'as-built')
    expect(port.ask).not.toHaveBeenCalled()
    expect(port.load, 'no load but Retry’s after a failure').toHaveBeenCalledTimes(1)
    mc.retry('arm64')
    mc.retry('arm64')
    expect(port.load, 'one Retry, one load').toHaveBeenCalledTimes(2)
    expect(mc.load('arm64')).toBe('loading')
    mc.want('arm64', 'as-built')
    expect(port.ask).not.toHaveBeenCalled()
    mc.loaded('arm64', 'ready')
    mc.want('arm64', 'as-built')
    mc.retry('arm64')
    mc.want('arm64', 'as-built')
    expect(port.ask.mock.calls).toEqual([['arm64', 'as-built']])
    expect(port.load, 'a Retry with the package in loads nothing').toHaveBeenCalledTimes(2)
  })

  it('asks for a listing switched to on the targets an open panel shows, once, and on no other', () => {
    const { port, mc } = store()
    mc.loaded('arm64', 'ready')
    // BOTH ASKED THIS GENERATION, as after a target switch or a panel closed since: only arm64 is shown now.
    mc.want('x86-64', 'as-built')
    mc.want('arm64', 'as-built')
    mc.switching('optimised', ['arm64'])
    mc.switching('optimised', ['arm64', 'arm64'])
    expect(port.ask.mock.calls).toEqual([
      ['x86-64', 'as-built'],
      ['arm64', 'as-built'],
      ['arm64', 'optimised'],
    ])
  })
})
