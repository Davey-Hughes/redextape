import { describe, expect, it } from 'vitest'
import { asmRecordEnd, RECORD_CHUNK, type RecordEnd, type RunReply } from '../../src/protocol'
import { type RecordLeg, type RecordWorker, recordLeg } from '../../src/record-loop'
import type { AsmState, AsmStatus } from '../../src/types'
import { frameOf } from './asm-fixtures'

/**
 * `recordLeg`'s contract, against a fake leg and a fake worker. The fake leg is an asm leg — its frames are
 * `AsmState`s and its end is `asmRecordEnd` — over a cursor that is nothing but a step count: it runs `length` steps
 * and then finishes as `finish` says, and each frame is the step the cursor stands on, so a run of frames that skips a
 * step shows as a gap.
 */

type Status = Pick<AsmStatus, 'run' | 'cap'>

/** A cursor: where it stands, how far it runs, how it finishes, and how many times it was asked to step. */
type Cursor = { at: number; readonly length: number; readonly finish: Status; stepCalls: number }

const cursor = (length: number, finish: Status = { run: 'Ended', cap: null }): Cursor => ({
  at: 0,
  length,
  finish,
  stepCalls: 0,
})

/** What is live: the generation that owns it, and whether its kind carries the leg and the leg compiled. */
type Live = { gen: number; cursor: Cursor; hasLeg: boolean; available: boolean }

const FRAME_BYTES = 10

const fakeLeg = (live: { current: Live }): RecordLeg<Cursor, AsmState> => ({
  leg: 'asm',
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
  end: (c) => asmRecordEnd(c.at >= c.length ? c.finish : { run: 'Running', cap: null }),
  reply: (gen, frames, done) => ({ kind: 'asm-frames', gen, frames, done }),
})

type Harness = {
  live: { current: Live }
  worker: RecordWorker
  /** Every post and every yield, in order: a post as its frame count, a yield as where the cursor stood. */
  events: string[]
  posts: Extract<RunReply, { kind: 'asm-frames' }>[]
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
    recording: { lambda: false, asm: false, tm: false },
    recorded: { lambda: 0, asm: 0, tm: 0 },
    allowance: { lambda: allowance, asm: allowance, tm: allowance },
    owns: (gen) => live.current.gen === gen,
    post: (reply) => {
      if (reply.kind !== 'asm-frames') throw new Error(`the asm leg posted a ${reply.kind}`)
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
    expect(h.worker.recorded.asm).toBe(30)
  })

  it('loses no step across a `budget` stop: recording further resumes on the next frame', async () => {
    const h = harness(live(1, cursor(100)), 25)
    const leg = fakeLeg(h.live)
    await recordLeg(leg, h.worker, 1, true)
    // What `onExtend` does before it records further.
    h.worker.allowance.asm = h.worker.recorded.asm + 25
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
      expect(h.worker.recording.asm).toBe(false)
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
    expect(h.worker.recording.asm).toBe(true)

    // `onRun`'s loop suspended at a yield, and a `[continue]` for the same generation arrives.
    expect(await recordLeg(leg, h.worker, 1, false)).toBe(false)
    expect(h.events).toHaveLength(2)
    expect(h.worker.recording.asm).toBe(true)

    h.release()
    expect(await first).toBe(true)
    expect(h.posts.map((p) => p.done)).toEqual([null, 'ended'])
    expect(stepsOf(h.posts)).toEqual(Array.from({ length: RECORD_CHUNK + 6 }, (_, i) => i))
    // The loop that set the flag, finishing while its generation owns what is live, clears it.
    expect(h.worker.recording.asm).toBe(false)
  })

  it('leaves the flag alone on its way out once a newer generation owns what is live', async () => {
    const h = harness(live(1, cursor(RECORD_CHUNK + 5)))
    h.gate()
    const leg = fakeLeg(h.live)
    const stale = recordLeg(leg, h.worker, 1, true)
    expect(h.worker.recording.asm).toBe(true)

    // A newer build replaces what is live and resets the flag, as `onRun` does, and its own loop sets it again and
    // suspends at its first yield.
    h.live.current = live(2, cursor(RECORD_CHUNK + 5))
    h.worker.recording.asm = false
    const fresh = recordLeg(leg, h.worker, 2, true)
    expect(h.worker.recording.asm).toBe(true)
    expect(h.posts).toHaveLength(2)

    // The superseded loop wakes, finds its generation gone, and returns without posting — and without clearing the
    // flag the newer loop holds.
    h.release()
    expect(await stale).toBe(true)
    expect(h.posts).toHaveLength(2)
    expect(h.worker.recording.asm).toBe(true)

    // So a third call for the newer generation is still refused while the newer loop runs.
    expect(await recordLeg(leg, h.worker, 2, false)).toBe(false)

    h.release()
    expect(await fresh).toBe(true)
    expect(h.posts.map((p) => [p.gen, p.done])).toEqual([
      [1, null],
      [2, null],
      [2, 'ended'],
    ])
    expect(h.worker.recording.asm).toBe(false)
  })
})
