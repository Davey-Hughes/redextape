import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { History } from '../../src/history'
import type { Leg, RecordEnd, RunReply } from '../../src/protocol'
import type { LegState } from '../../src/sessions'
import {
  LinkPositions,
  MAX_LINK_CONTINUES,
  type PositionsDeps,
  type Short,
  shortNotice,
} from '../../src/share-positions'

/**
 * A link's positions against the replies a session worker sends (Plan 7 part 6a spec §5.4): held until the link's
 * compile says which legs exist, applied as the frames reach them, continued after the run's `result` one leg at a
 * time, and clamped where the run ends or the continues run out, every leg stopped short so far named in one notice.
 * Each leg is a real `History`, a frame a byte against a budget of `RING - 1` bytes, so a ring holds `RING` steps — the
 * frames before its newest fit its budget — and drops its oldest past them.
 */

const RING = 5
const GEN = 1

let legs: Record<Leg, LegState<number>>
let extend: Mock<PositionsDeps['extend']>
let short: Mock<PositionsDeps['short']>
let draw: Mock<PositionsDeps['draw']>
let awaiting: boolean
let positions: LinkPositions

beforeEach(() => {
  const leg = (): LegState<number> => ({
    hist: new History<number>(RING - 1),
    status: { available: true, reason: '' },
    done: null,
    playing: false,
  })
  legs = { lambda: leg(), asm: leg(), tm: leg() }
  awaiting = false
  extend = vi.fn()
  short = vi.fn()
  draw = vi.fn()
  positions = new LinkPositions({ legOf: (l) => legs[l], extend, awaitingRun: () => awaiting, short, draw })
})

/** The link's compile, with `declined` legs unavailable. */
const compiled = (declined: readonly Leg[] = [], gen = GEN): RunReply =>
  ({
    kind: 'compiled',
    gen,
    lambda: { available: !declined.includes('lambda'), reason: '' },
    asm: { available: !declined.includes('asm'), reason: '' },
    tm: { available: !declined.includes('tm'), reason: '' },
  }) as unknown as RunReply

/** Frames for steps `from` to `to` on `leg`, taken in as `replies.ts` takes them, then heard; `done` as the reply says. */
function record(leg: Leg, from: number, to: number, done: RecordEnd | null, gen = GEN): void {
  for (let step = from; step <= to; step++) legs[leg].hist.push(step, 1)
  legs[leg].done = done
  positions.onReply({ kind: `${leg}-frames`, gen, frames: [], done } as unknown as RunReply)
}

const result = (gen = GEN): void => positions.onReply({ kind: 'result', gen } as unknown as RunReply)

describe('LinkPositions', () => {
  it("gives each available leg its position once the link's compile says which exist, a declined leg's dropped", () => {
    positions.hold(GEN, { lambda: 3, tm: 2 })
    expect(legs.lambda.pending).toBeUndefined()
    positions.onReply(compiled(['tm']))
    expect(legs.lambda.pending).toBe(3)
    expect(legs.tm.pending).toBeUndefined()
    expect(legs.asm.pending).toBeUndefined()
    expect(short).not.toHaveBeenCalled()
  })

  it('seeks to the position once the frames hold one past it, mid-recording, and later frames leave it there', () => {
    positions.hold(GEN, { lambda: 3 })
    positions.onReply(compiled())
    record('lambda', 0, 1, null)
    expect(legs.lambda.hist.currentStep).toBe(0)
    expect(legs.lambda.pending).toBe(3)
    // THE POSITION IS THE NEWEST FRAME OF A RECORDING STILL GOING: a seek onto it would go on following the frontier.
    record('lambda', 2, 3, null)
    expect(legs.lambda.pending).toBe(3)
    record('lambda', 4, 4, null)
    expect(legs.lambda.hist.currentStep).toBe(3)
    expect(legs.lambda.pending).toBeUndefined()
    expect(draw).toHaveBeenCalledTimes(1)
    record('lambda', 5, 6, 'ended')
    expect(legs.lambda.hist.currentStep).toBe(3)
    expect(short).not.toHaveBeenCalled()
  })

  it('seeks to a position that is the last frame of a recording that stopped', () => {
    positions.hold(GEN, { lambda: 4 })
    positions.onReply(compiled())
    record('lambda', 0, 4, 'budget')
    expect(legs.lambda.hist.currentStep).toBe(4)
    expect(legs.lambda.pending).toBeUndefined()
    result()
    expect(extend).not.toHaveBeenCalled()
  })

  it('lands a position the ring has already dropped on its oldest kept step', () => {
    positions.hold(GEN, { lambda: 1 })
    positions.onReply(compiled())
    record('lambda', 0, 7, 'ended')
    expect(legs.lambda.hist.oldestStep).toBe(3)
    expect(legs.lambda.hist.currentStep).toBe(3)
  })

  it('clamps a position past a run that ended to its last step, and says so', () => {
    positions.hold(GEN, { lambda: 9 })
    positions.onReply(compiled())
    record('lambda', 0, 2, 'ended')
    expect(legs.lambda.hist.currentStep).toBe(2)
    expect(legs.lambda.pending).toBeUndefined()
    expect(short).toHaveBeenCalledWith([{ leg: 'lambda', wanted: 9, shown: 2, why: 'ended' }])
    result()
    expect(extend).not.toHaveBeenCalled()
  })

  it("continues a leg whose history filled, but not before the run's result", () => {
    positions.hold(GEN, { lambda: 7 })
    positions.onReply(compiled())
    record('lambda', 0, 4, 'budget')
    expect(extend).not.toHaveBeenCalled()
    result()
    expect(extend).toHaveBeenCalledTimes(1)
    expect(extend).toHaveBeenLastCalledWith('lambda')
    record('lambda', 5, 9, 'budget')
    expect(legs.lambda.hist.currentStep).toBe(7)
    result()
    expect(extend).toHaveBeenCalledTimes(1)
  })

  it('continues one leg at a time, λ then asm then TM', () => {
    positions.hold(GEN, { lambda: 7, asm: 7, tm: 7 })
    positions.onReply(compiled())
    record('lambda', 0, 4, 'budget')
    record('asm', 0, 4, 'budget')
    record('tm', 0, 4, 'capped')
    result()
    expect(extend.mock.calls).toEqual([['lambda']])
    record('lambda', 5, 9, 'budget')
    result()
    expect(extend.mock.calls).toEqual([['lambda'], ['asm']])
    record('asm', 5, 9, 'budget')
    result()
    expect(extend.mock.calls).toEqual([['lambda'], ['asm'], ['tm']])
  })

  it(`stops a leg at its furthest step after ${MAX_LINK_CONTINUES} continues, says so, and asks the next leg`, () => {
    positions.hold(GEN, { lambda: 1000, tm: 1000 })
    positions.onReply(compiled())
    record('lambda', 0, 4, 'budget')
    record('tm', 0, 4, 'budget')
    result()
    for (let n = 1; n <= MAX_LINK_CONTINUES; n++) {
      expect(extend.mock.calls.length).toBe(n)
      record('lambda', 5 * n, 5 * n + 4, 'budget')
      result()
    }
    const last = 5 * MAX_LINK_CONTINUES + 4
    expect(legs.lambda.hist.currentStep).toBe(last)
    expect(legs.lambda.pending).toBeUndefined()
    expect(short).toHaveBeenCalledWith([{ leg: 'lambda', wanted: 1000, shown: last, why: 'continues' }])
    expect(extend.mock.calls.filter(([l]) => l === 'lambda')).toHaveLength(MAX_LINK_CONTINUES)
    expect(extend).toHaveBeenLastCalledWith('tm')
  })

  it('continues nothing while the program session awaits a run', () => {
    positions.hold(GEN, { lambda: 7 })
    positions.onReply(compiled())
    record('lambda', 0, 4, 'budget')
    awaiting = true
    result()
    expect(extend).not.toHaveBeenCalled()
  })

  it('drops every position at a reply of another generation, whether held or pending', () => {
    positions.hold(GEN, { lambda: 3 })
    positions.onReply(compiled([], GEN + 1))
    expect(legs.lambda.pending).toBeUndefined()
    positions.hold(GEN, { lambda: 3 })
    positions.onReply(compiled())
    record('lambda', 0, 1, null, GEN + 1)
    expect(legs.lambda.pending).toBeUndefined()
    record('lambda', 2, 4, null)
    // WHERE THE RUN OPENED, NOT THE DROPPED POSITION'S STEP 3.
    expect(legs.lambda.hist.currentStep).toBe(0)
  })

  it('drops every position when the compile answers with no run, or the worker fails', () => {
    for (const kind of ['no-session', 'worker-error'] as const) {
      positions.hold(GEN, { asm: 3 })
      positions.onReply(compiled())
      expect(legs.asm.pending).toBe(3)
      positions.onReply({ kind, gen: GEN } as unknown as RunReply)
      expect(legs.asm.pending, kind).toBeUndefined()
    }
  })

  it("drops an earlier link's pending positions when a new link's are held", () => {
    positions.hold(GEN, { lambda: 3, asm: 3 })
    positions.onReply(compiled())
    positions.hold(GEN + 1, { tm: 2 })
    expect([legs.lambda.pending, legs.asm.pending]).toEqual([undefined, undefined])
    positions.onReply(compiled([], GEN + 1))
    expect(legs.tm.pending).toBe(2)
  })

  /**
   * **AN OPEN'S CLAMPS SHARE ONE NOTICE** (spec §5.4's note of 2026-10-01): each leg stopped short is said with every
   * one before it in the same open, so a later clamp's notice does not take an earlier one's off the line unsaid.
   */
  it('names every leg stopped short so far, the earlier with the later', () => {
    positions.hold(GEN, { lambda: 9, asm: 9 })
    positions.onReply(compiled())
    record('lambda', 0, 2, 'ended')
    expect(short).toHaveBeenLastCalledWith([{ leg: 'lambda', wanted: 9, shown: 2, why: 'ended' }])
    record('asm', 0, 3, 'ended')
    expect(short).toHaveBeenCalledTimes(2)
    expect(short).toHaveBeenLastCalledWith([
      { leg: 'lambda', wanted: 9, shown: 2, why: 'ended' },
      { leg: 'asm', wanted: 9, shown: 3, why: 'ended' },
    ])
  })

  it('names a leg the continues did not take far enough with one whose run ended', () => {
    positions.hold(GEN, { lambda: 1000, asm: 9 })
    positions.onReply(compiled())
    record('lambda', 0, 4, 'budget')
    record('asm', 0, 3, 'ended')
    result()
    for (let n = 1; n <= MAX_LINK_CONTINUES; n++) {
      record('lambda', 5 * n, 5 * n + 4, 'budget')
      result()
    }
    expect(short).toHaveBeenCalledTimes(2)
    expect(short).toHaveBeenLastCalledWith([
      { leg: 'asm', wanted: 9, shown: 3, why: 'ended' },
      { leg: 'lambda', wanted: 1000, shown: 5 * MAX_LINK_CONTINUES + 4, why: 'continues' },
    ])
  })

  it('names only the legs of the latest open', () => {
    positions.hold(GEN, { lambda: 9 })
    positions.onReply(compiled())
    record('lambda', 0, 2, 'ended')
    positions.hold(GEN + 1, { asm: 9 })
    positions.onReply(compiled([], GEN + 1))
    record('asm', 0, 3, 'ended', GEN + 1)
    expect(short).toHaveBeenLastCalledWith([{ leg: 'asm', wanted: 9, shown: 3, why: 'ended' }])
  })

  /**
   * **WHAT A SHARE CARRIES FOR A LEG STILL GOING TO ITS LINK'S STEP** (spec §5.1's note of 2026-10-01): that step,
   * held while the link's compile runs and pending on its leg after, for the compile that generation names; none for
   * any other, whose program is not the link's.
   */
  it("answers the positions not yet reached for the link's compile, held or pending", () => {
    positions.hold(GEN, { lambda: 3, tm: 2 })
    expect(positions.pendingFor(GEN)).toEqual({ lambda: 3, tm: 2 })
    positions.onReply(compiled(['tm']))
    expect(positions.pendingFor(GEN)).toEqual({ lambda: 3 })
    record('lambda', 0, 4, null)
    expect(legs.lambda.pending).toBeUndefined()
    expect(positions.pendingFor(GEN)).toEqual({})
  })

  it('answers none for another compile, or with no link held', () => {
    expect(positions.pendingFor(GEN)).toEqual({})
    positions.hold(GEN, { lambda: 3 })
    expect(positions.pendingFor(GEN + 1)).toEqual({})
    positions.onReply(compiled())
    expect(legs.lambda.pending).toBe(3)
    expect(positions.pendingFor(GEN + 1)).toEqual({})
  })

  it('hears nothing with no link held, and nothing from a λ tree', () => {
    record('lambda', 0, 4, 'budget')
    result()
    expect(extend).not.toHaveBeenCalled()
    positions.hold(GEN, { lambda: 3 })
    positions.onReply({ kind: 'lambda-tree', gen: GEN + 1 } as unknown as RunReply)
    positions.onReply(compiled())
    expect(legs.lambda.pending).toBe(3)
  })
})

/**
 * **WHAT THE OPEN'S NOTICE SAYS ABOUT THE LEGS STOPPED SHORT** (spec §5.4's note of 2026-10-01): one leg in the words
 * it had before the note; several with the same reason in one clause; mixed reasons in a clause each, the first leg's
 * first. Legs go λ, asm, TM, whatever order they stopped in.
 */
describe('shortNotice', () => {
  const ended = (leg: Short['leg'], wanted: number, shown: number): Short => ({ leg, wanted, shown, why: 'ended' })
  const continues = (leg: Short['leg'], wanted: number, shown: number): Short => ({
    leg,
    wanted,
    shown,
    why: 'continues',
  })

  it('says one leg past the end of its run as it always has', () => {
    expect(shortNotice([ended('lambda', 5000, 951)])).toBe(
      "the link's λ step 5,000 is past the end of this run — showing step 951",
    )
  })

  it(`says one leg ${MAX_LINK_CONTINUES} continues did not reach as it always has`, () => {
    expect(shortNotice([continues('lambda', 17000, 15695)])).toBe(
      "the link's λ step 17,000 is further on than 10 continues went — showing step 15,695",
    )
  })

  it('says two legs with the same reason in one clause, each with the step it shows', () => {
    expect(shortNotice([ended('asm', 100, 5), ended('lambda', 100, 7)])).toBe(
      "the link's λ step 100 and asm step 100 are past the end of this run — showing λ step 7 and asm step 5",
    )
  })

  it('says three legs with the same reason in one clause', () => {
    expect(shortNotice([ended('lambda', 100, 7), ended('asm', 100, 5), ended('tm', 9000, 2870)])).toBe(
      "the link's λ step 100, asm step 100 and TM step 9,000 are past the end of this run — " +
        'showing λ step 7, asm step 5 and TM step 2,870',
    )
  })

  it('says mixed reasons in a clause each', () => {
    expect(shortNotice([ended('asm', 500, 84), continues('lambda', 17000, 15695)])).toBe(
      "the link's λ step 17,000 is further on than 10 continues went — showing step 15,695; " +
        'its asm step 500 is past the end of this run — showing step 84',
    )
  })

  it('says mixed reasons for three legs, two of them sharing one', () => {
    expect(shortNotice([ended('asm', 500, 84), continues('lambda', 17000, 15695), continues('tm', 90000, 40261)])).toBe(
      "the link's λ step 17,000 and TM step 90,000 are further on than 10 continues went — " +
        'showing λ step 15,695 and TM step 40,261; its asm step 500 is past the end of this run — showing step 84',
    )
  })
})
