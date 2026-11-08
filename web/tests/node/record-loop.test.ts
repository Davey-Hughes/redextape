import { describe, expect, it } from 'vitest'
import { LEGS } from '../../src/legs'
import { endOf, type FramesReply, HISTORY_BYTES, RECORD_CHUNK, type RecordEnd, rxmRecordEnd } from '../../src/protocol'
import {
  extendLeg,
  type RecordLeg,
  type RecordWorker,
  recordLeg,
  resetRecording,
  rewindAndRecord,
} from '../../src/record-loop'
import type { RxmStatus } from '../../src/types'
import { frameOf } from './rxm-fixtures'

/**
 * `recordLeg`'s, `extendLeg`'s and `rewindAndRecord`'s contracts, against a fake leg and a fake worker. The fake leg
 * is an rxm leg — its frames are `RxmState`s and its end is `rxmRecordEnd` — over a cursor that is nothing but a step
 * count: it runs `length` steps and then finishes as `finish` says, and each frame is the step the cursor stands on,
 * so a run of frames that skips a step shows as a gap.
 */

type Status = Pick<RxmStatus, 'run' | 'cap'>

/** A cursor: where it stands, how far it runs, how it finishes, and how many times it was asked to step. */
type Cursor = { at: number; length: number; readonly finish: Status; stepCalls: number }

const cursor = (length: number, finish: Status = { run: 'Ended', cap: null }): Cursor => ({
  at: 0,
  length,
  finish,
  stepCalls: 0,
})

/** What is live: the generation that owns it, and whether its kind carries the leg and the leg compiled. */
type Live = { gen: number; cursor: Cursor; hasLeg: boolean; available: boolean }

const FRAME_BYTES = 10

const fakeLeg = (live: { current: Live }): RecordLeg<'rxm', Cursor> => ({
  leg: 'rxm',
  handle: (gen) => (live.current.gen === gen && live.current.hasLeg ? live.current.cursor : null),
  available: () => live.current.available,
  frame: (c) => frameOf({ step: c.at }),
  bytes: () => FRAME_BYTES,
  step: (c) => {
    c.stepCalls += 1
    if (c.at >= c.length) return false
    c.at += 1
    return true
  },
  // The status reads `Running` until the cursor has run its length, as a real cursor's does.
  end: (c) => rxmRecordEnd(c.at >= c.length ? c.finish : { run: 'Running', cap: null }),
  // `recordLeg` neither raises a cap nor rewinds a cursor: its callers do, before it runs.
  raise: () => {
    throw new Error('recordLeg raised a cap')
  },
  rewind: () => {
    throw new Error('recordLeg rewound a cursor')
  },
})

type Harness = {
  live: { current: Live }
  worker: RecordWorker
  /** Every post and every yield, in order: a post as its frame count, a yield as where the cursor stood. */
  events: string[]
  posts: FramesReply<'rxm'>[]
  /** Make every yield wait until `release` lets it go, so a test can act while a loop is suspended. */
  gate(): void
  /** Let the oldest waiting yield go. */
  release(): void
}

function harness(first: Live, allowance = Number.POSITIVE_INFINITY): Harness {
  const live = { current: first }
  const events: string[] = []
  const posts: Harness['posts'] = []
  const waiting: (() => void)[] = []
  let gated = false
  const worker: RecordWorker = {
    recording: { lambda: false, rxm: false, tm: false },
    recorded: { lambda: 0, rxm: 0, tm: 0 },
    allowance: { lambda: allowance, rxm: allowance, tm: allowance },
    epoch: { lambda: 0, rxm: 0, tm: 0 },
    owns: (gen) => live.current.gen === gen,
    post: (reply) => {
      if (reply.kind !== 'frames' || reply.leg !== 'rxm') throw new Error(`the rxm leg posted a ${reply.kind}`)
      posts.push(reply)
      events.push(`post ${reply.frames.length}`)
    },
    yieldToEventLoop: () => {
      events.push(`yield at ${live.current.cursor.at}`)
      return gated ? new Promise<void>((resolve) => waiting.push(resolve)) : Promise.resolve()
    },
  }
  return {
    live,
    worker,
    events,
    posts,
    gate: () => {
      gated = true
    },
    release: () => waiting.shift()?.(),
  }
}

const live = (gen: number, c: Cursor): Live => ({ gen, cursor: c, hasLeg: true, available: true })

/** Every step a run of posts carried, in order. */
const stepsOf = (posts: Harness['posts']): number[] => posts.flatMap((p) => p.frames.map((f) => f.step))

/** `fakeLeg` whose `rewind` notes itself in the harness's events, with the step the cursor stood on, and goes to 0. */
const rewindingLeg = (h: Harness): RecordLeg<'rxm', Cursor> => ({
  ...fakeLeg(h.live),
  rewind: (c) => {
    h.events.push(`rewind from ${c.at}`)
    c.at = 0
  },
})

/** A rewind's `hold`, which notes itself in the harness's events with the step the cursor stands on as it runs. */
const holding = (h: Harness) => (): void => {
  h.events.push(`hold at ${h.live.current.cursor.at}`)
}

describe('resetRecording', () => {
  it("hands every leg's four books to a new build, and posts and yields nothing", () => {
    const h = harness(live(1, cursor(3)))
    for (const leg of LEGS) {
      h.worker.recorded[leg] = 5
      h.worker.allowance[leg] = 7
      h.worker.recording[leg] = true
      h.worker.epoch[leg] = 2
    }

    resetRecording(h.worker)

    const each = <T>(value: T) => ({ lambda: value, rxm: value, tm: value })
    const { recorded, allowance, recording, epoch } = h.worker
    expect({ recorded, allowance, recording, epoch }).toEqual({
      recorded: each(0),
      allowance: each(HISTORY_BYTES),
      recording: each(false),
      epoch: each(0),
    })
    expect(h.events).toEqual([])
  })
})

describe('recordLeg', () => {
  it('posts a chunk of frames at a time and yields between chunks, never after the last', async () => {
    const h = harness(live(1, cursor(2 * RECORD_CHUNK + 10)))
    expect(await recordLeg(fakeLeg(h.live), h.worker, 1, true)).toBe(true)
    // The first chunk carries the frame the cursor started on as well as its `RECORD_CHUNK` steps.
    expect(h.events).toEqual([
      `post ${RECORD_CHUNK + 1}`,
      `yield at ${RECORD_CHUNK}`,
      `post ${RECORD_CHUNK}`,
      `yield at ${2 * RECORD_CHUNK}`,
      'post 10',
    ])
    expect(h.posts.map((p) => p.done)).toEqual([null, null, 'ended'])
    expect(stepsOf(h.posts)).toEqual(Array.from({ length: 2 * RECORD_CHUNK + 11 }, (_, i) => i))
  })

  it('stops before stepping once the allowance is spent, and says `budget`', async () => {
    // 25 bytes of 10-byte frames: the third frame takes the books to 30, past the allowance, and no fourth step is
    // taken — even though the fourth would have found the run over.
    const h = harness(live(1, cursor(3)), 25)
    expect(await recordLeg(fakeLeg(h.live), h.worker, 1, false)).toBe(true)
    expect(h.live.current.cursor.stepCalls).toBe(3)
    expect(h.posts.map((p) => p.done)).toEqual(['budget'])
    expect(stepsOf(h.posts)).toEqual([1, 2, 3])
    expect(h.worker.recorded.rxm).toBe(30)
  })

  it('loses no step across a `budget` stop: recording further resumes on the next frame', async () => {
    const h = harness(live(1, cursor(100)), 25)
    const leg = fakeLeg(h.live)
    await recordLeg(leg, h.worker, 1, true)
    // What `onExtend` does before it records further.
    h.worker.allowance.rxm = h.worker.recorded.rxm + 25
    await recordLeg(leg, h.worker, 1, false)
    expect(h.posts.map((p) => p.done)).toEqual(['budget', 'budget'])
    expect(stepsOf(h.posts)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it("reports the leg's end as the leg's own rule reads its status", async () => {
    const ends: [Status, RecordEnd][] = [
      [{ run: 'Ended', cap: null }, 'ended'],
      [{ run: 'Capped', cap: 'Steps' }, 'capped'],
      [{ run: 'Capped', cap: 'Stack' }, 'stack-full'],
      [{ run: 'Capped', cap: 'Heap' }, 'heap-full'],
      [{ run: 'Capped', cap: 'Mem' }, 'memory-full'],
    ]
    for (const [finish, end] of ends) {
      const h = harness(live(1, cursor(5, finish)))
      await recordLeg(fakeLeg(h.live), h.worker, 1, true)
      expect(h.posts.map((p) => p.done)).toEqual([end])
      expect(stepsOf(h.posts)).toEqual([0, 1, 2, 3, 4, 5])
    }
  })

  it('turns a call away at the door for a stale generation, a live thing without the leg, or a leg not compiled', async () => {
    for (const current of [
      live(2, cursor(5)),
      { ...live(1, cursor(5)), hasLeg: false },
      { ...live(1, cursor(5)), available: false },
    ]) {
      const h = harness(current)
      expect(await recordLeg(fakeLeg(h.live), h.worker, 1, true)).toBe(false)
      // A rewind has the same door, and is turned away before it raises the leg's epoch or holds its part.
      await rewindAndRecord(rewindingLeg(h), h.worker, 1, 1, holding(h))
      expect(h.worker.epoch.rxm).toBe(0)
      expect(h.worker.recording.rxm).toBe(false)
      expect(h.events).toEqual([])
      expect(h.live.current.cursor.stepCalls).toBe(0)
    }
  })

  it('refuses a second call for a leg already recording: it posts nothing, and the first loop keeps the flag', async () => {
    const h = harness(live(1, cursor(RECORD_CHUNK + 5)))
    h.gate()
    const leg = fakeLeg(h.live)
    const first = recordLeg(leg, h.worker, 1, true)
    expect(h.events).toEqual([`post ${RECORD_CHUNK + 1}`, `yield at ${RECORD_CHUNK}`])
    expect(h.worker.recording.rxm).toBe(true)

    // `onRun`'s loop suspended at a yield, and a `[continue]` for the same generation arrives.
    expect(await recordLeg(leg, h.worker, 1, false)).toBe(false)
    expect(h.events).toHaveLength(2)
    expect(h.worker.recording.rxm).toBe(true)

    h.release()
    expect(await first).toBe(true)
    expect(h.posts.map((p) => p.done)).toEqual([null, 'ended'])
    expect(stepsOf(h.posts)).toEqual(Array.from({ length: RECORD_CHUNK + 6 }, (_, i) => i))
    // The loop that set the flag, finishing while its generation owns what is live, clears it.
    expect(h.worker.recording.rxm).toBe(false)
  })

  it('leaves the flag alone on its way out once a newer generation owns what is live', async () => {
    const h = harness(live(1, cursor(RECORD_CHUNK + 5)))
    h.gate()
    const leg = fakeLeg(h.live)
    const stale = recordLeg(leg, h.worker, 1, true)
    expect(h.worker.recording.rxm).toBe(true)

    // A newer build replaces what is live and resets the flag, as `onRun` does, and its own loop sets it again and
    // suspends at its first yield.
    h.live.current = live(2, cursor(RECORD_CHUNK + 5))
    h.worker.recording.rxm = false
    const fresh = recordLeg(leg, h.worker, 2, true)
    expect(h.worker.recording.rxm).toBe(true)
    expect(h.posts).toHaveLength(2)

    // The superseded loop wakes, finds its generation gone, and returns without posting — and without clearing the
    // flag the newer loop holds.
    h.release()
    expect(await stale).toBe(true)
    expect(h.posts).toHaveLength(2)
    expect(h.worker.recording.rxm).toBe(true)

    // So a third call for the newer generation is still refused while the newer loop runs.
    expect(await recordLeg(leg, h.worker, 2, false)).toBe(false)

    h.release()
    expect(await fresh).toBe(true)
    expect(h.posts.map((p) => [p.gen, p.done])).toEqual([
      [1, null],
      [2, null],
      [2, 'ended'],
    ])
    expect(h.worker.recording.rxm).toBe(false)
  })

  it('stops a loop whose leg was rewound under it, leaves the flag to the new loop, and tags each post with its epoch', async () => {
    const h = harness(live(1, cursor(RECORD_CHUNK + 5)))
    h.gate()
    const leg = rewindingLeg(h)
    const stale = recordLeg(leg, h.worker, 1, false)
    expect(h.posts).toHaveLength(1)

    // The rewind holds the part the cursor stands on before it takes the cursor back, then records the first fill.
    const fresh = rewindAndRecord(leg, h.worker, 1, 1, holding(h))
    expect(h.events).toEqual([
      `post ${RECORD_CHUNK}`,
      `yield at ${RECORD_CHUNK}`,
      `hold at ${RECORD_CHUNK}`,
      `rewind from ${RECORD_CHUNK}`,
      `post ${RECORD_CHUNK + 1}`,
      `yield at ${RECORD_CHUNK}`,
    ])
    expect(h.posts).toHaveLength(2)

    h.release()
    expect(await stale).toBe(true)
    expect(h.posts).toHaveLength(2)
    expect(h.worker.recording.rxm).toBe(true)

    h.release()
    await fresh
    expect(h.posts.map((p) => [p.epoch, p.done])).toEqual([
      [0, null],
      [1, null],
      [1, 'ended'],
    ])
    expect(h.posts[1]?.frames[0]?.step).toBe(0)
    expect(h.worker.recording.rxm).toBe(false)

    // A rewind to an epoch no newer than the leg's is turned away: it holds, rewinds and records nothing.
    const seen = h.events.length
    const refused = rewindAndRecord(leg, h.worker, 1, 1, holding(h))
    expect(h.events).toHaveLength(seen)
    await refused
  })
})

/** How many more steps a raised cap lets the fake's cursor run. */
const RAISE = 3

/**
 * `fakeLeg` whose run ends as `end` says, and whose `raise` notes the handle it was given in `raises`, notes itself in
 * the harness's events, and lets what is live run `RAISE` steps further: so a case sees whether a cap was raised, on
 * what, and whether before the recording posted.
 */
const raisingLeg = (h: Harness, end: RecordEnd, raises: unknown[]): RecordLeg<'rxm', Cursor> => ({
  ...fakeLeg(h.live),
  end: () => end,
  raise: (c) => {
    raises.push(c)
    h.events.push('raise')
    h.live.current.cursor.length += RAISE
  },
})

/** A cursor that has run its length and stands on its last step, as one does once its recording stopped. */
const stopped = (): Cursor => ({ ...cursor(5), at: 5 })

describe('extendLeg', () => {
  it('raises a `capped` run once, on the live handle, before it records on from the frame the cursor stands on', async () => {
    const c = stopped()
    const h = harness(live(1, c))
    const raises: unknown[] = []
    expect(await extendLeg(raisingLeg(h, 'capped', raises), h.worker, 1)).toBe(true)
    expect(raises).toHaveLength(1)
    expect(raises[0]).toBe(c)
    expect(h.events).toEqual(['raise', `post ${RAISE}`])
    expect(stepsOf(h.posts)).toEqual([6, 7, 8])
  })

  it('raises nothing at a `budget` stop, where the cursor still reads `Running`, and records on from the next frame', async () => {
    // Through the mappings the legs read a real status by: `fakeLeg`'s own `end` is rxm's, and `endOf` is λ's and TM's.
    for (const mapping of ['rxmRecordEnd', 'endOf'] as const) {
      const h = harness(live(1, cursor(100)), 25)
      const raises: Cursor[] = []
      const own = fakeLeg(h.live)
      const leg: RecordLeg<'rxm', Cursor> = {
        ...own,
        end: mapping === 'endOf' ? (c) => endOf(c.at >= c.length ? 'Ended' : 'Running') : own.end,
        raise: (c) => {
          raises.push(c)
        },
      }
      await recordLeg(leg, h.worker, 1, true)
      // What `onExtend` does before it records further.
      h.worker.allowance.rxm = h.worker.recorded.rxm + 25
      expect(await extendLeg(leg, h.worker, 1)).toBe(true)
      expect(raises, mapping).toEqual([])
      expect(h.posts.map((p) => p.done)).toEqual(['budget', 'budget'])
      expect(stepsOf(h.posts)).toEqual([0, 1, 2, 3, 4, 5])
    }
  })

  it.each<RecordEnd>(['ended', 'depth-refused', 'stack-full', 'heap-full', 'memory-full'])(
    'raises nothing for the end `%s`, and records on',
    async (end) => {
      const h = harness(live(1, stopped()))
      const raises: unknown[] = []
      expect(await extendLeg(raisingLeg(h, end, raises), h.worker, 1)).toBe(true)
      expect(raises).toEqual([])
      expect(h.events).toEqual(['post 0'])
      expect(h.posts.map((p) => p.done)).toEqual([end])
    },
  )

  it('turns a live thing without the leg away, and raises nothing', async () => {
    const h = harness({ ...live(1, stopped()), hasLeg: false })
    const raises: unknown[] = []
    expect(await extendLeg(raisingLeg(h, 'capped', raises), h.worker, 1)).toBe(false)
    expect(raises).toEqual([])
    expect(h.events).toEqual([])
  })
})
