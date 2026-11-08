import { describe, expect, it } from 'vitest'
import { LEGS } from '../../src/legs'
import type { FramesReply, Leg, RecordEnd, RunReply, RunRequest } from '../../src/protocol'
import type { LambdaState } from '../../src/types'
import { until } from './until'

/**
 * Post `req` to a fresh worker and collect every reply until `last` says the answer is complete, or the worker reports
 * an error, which ends every answer.
 */
function askUntil(
  req: RunRequest,
  last: (r: RunReply) => boolean,
  timeoutMs = 30_000,
): Promise<{ replies: RunReply[]; worker: Worker }> {
  const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const replies: RunReply[] = []
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error(`the worker did not finish in time; got ${replies.map((r) => r.kind).join(', ')}`))
    }, timeoutMs)
    worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
      replies.push(e.data)
      if (last(e.data) || e.data.kind === 'worker-error') {
        clearTimeout(timer)
        resolve({ replies, worker })
      }
    })
    worker.postMessage(req)
  })
}

/**
 * Collect EVERY reply for one request. The worker answers many times per request, and a helper that resolved on the
 * first message would silently test only the `compiled` reply. A program's answer ends at its `result`, or at
 * `no-session` for one that did not build; a copy never gets a `result`, so its tests ask `askUntil` for its frames'
 * end instead.
 */
function askAll(req: RunRequest, timeoutMs = 30_000): Promise<{ replies: RunReply[]; worker: Worker }> {
  return askUntil(req, (r) => r.kind === 'result' || r.kind === 'no-session', timeoutMs)
}

const run = (src: string, gen = 1, encoding = 'unary'): RunRequest => ({ kind: 'run', gen, src, encoding })

describe('session-worker', () => {
  it('drives the λ leg to a normal form and decodes the λ and TM legs', async () => {
    const { replies, worker } = await askAll(run('let x = 40; x + 2'))
    worker.terminate()
    const reply = replies.at(-1)
    expect(reply?.kind).toBe('result')
    if (reply?.kind !== 'result') return

    expect(reply.gen).toBe(1)
    expect(reply.legs.lambda.status.run).toBe('Ended')
    expect(reply.legs.lambda.state?.step).toBe(7)
    expect(reply.legs.lambda.value).toEqual({ Value: { text: '42' } })
    expect(reply.legs.tm.status.total_steps).toBe(2870)
    expect(reply.legs.tm.value).toEqual({ Value: { text: '42' } })
  })

  it('answers no-session with diagnostics for a program that does not analyze', async () => {
    const { replies, worker } = await askAll(run('let x = ;'))
    worker.terminate()
    const reply = replies.at(-1)
    expect(reply?.kind).toBe('no-session')
    if (reply?.kind !== 'no-session') return
    expect(reply.diagnostics.length).toBeGreaterThan(0)
    expect(reply.diagnostics[0]?.severity).toBe('Error')
  })

  it('still answers for the TM leg when the λ backend declines', async () => {
    const src = 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)'
    const { replies, worker } = await askAll(run(src))
    worker.terminate()
    const reply = replies.at(-1)
    expect(reply?.kind).toBe('result')
    if (reply?.kind !== 'result') return
    expect(reply.legs.lambda.status.available).toBe(false)
    expect(reply.legs.lambda.status.reason).not.toBe('')
    expect(reply.legs.tm.status.available).toBe(true)
    // The TM leg captures `n` by reference (`defunc` boxes a mutable that a closure captures), so
    // `apply0(f)` reads `n`'s value at the point `g(0)` runs — after `n = 10` — giving `0 + 10`. That
    // mutable capture is exactly why the λ leg declines this program instead.
    expect(reply.legs.tm.value).toEqual({ Value: { text: '10' } })
  })

  // `sourceSpan` is a Session method, so only the worker can turn `status.node` into a range. Without
  // this the refusal names a node the main thread has no way to look up.
  it('resolves the refused node to a source span', async () => {
    const src = 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)'
    const { replies, worker } = await askAll(run(src))
    worker.terminate()
    const reply = replies.at(-1)
    expect(reply?.kind).toBe('result')
    if (reply?.kind !== 'result') return
    expect(reply.legs.lambda.status.node).not.toBeNull()
    expect(reply.legs.lambda.declinedSpan).not.toBeNull()
    const span = reply.legs.lambda.declinedSpan
    if (!span) return
    expect(span.end).toBeGreaterThan(span.start)
    expect(span.end).toBeLessThanOrEqual(src.length)
  })

  it('carries the generation back unchanged', async () => {
    const { replies, worker } = await askAll(run('let x = 40; x + 2', 7))
    worker.terminate()
    // Every reply carries `gen`, not only the last one — checking only `replies.at(-1)` would let a
    // mutant that hardcodes the generation in one reply kind survive.
    expect(replies.every((r) => r.gen === 7)).toBe(true)
  })

  // `compile` throws by design for a name `EncodingKind::parse` rejects (`redextape-wasm`'s own
  // `compile` doc) — the reachable trigger for the whole class of thrown-session-call defects this
  // variant exists to catch.
  it('reports a thrown session call instead of going silent', async () => {
    const { replies, worker } = await askAll({ kind: 'run', gen: 1, src: 'let x = 40; x + 2', encoding: 'nonsense' })
    worker.terminate()
    const err = replies.find((r) => r.kind === 'worker-error')
    expect(err).toBeDefined()
    expect(err?.kind === 'worker-error' && err.message).toContain('encoding')
  })
})

describe('session-worker recording', () => {
  it('sends compiled first, then frames, then the result', async () => {
    const { replies, worker } = await askAll(run('let x = 40; x + 2'))
    worker.terminate()
    expect(replies[0]?.kind).toBe('compiled')
    expect(replies.at(-1)?.kind).toBe('result')
    expect(replies.some((r) => r.kind === 'frames' && r.leg === 'lambda')).toBe(true)
    expect(replies.some((r) => r.kind === 'frames' && r.leg === 'tm')).toBe(true)
  })

  it('records λ, then rxm, then TM, each in turn', async () => {
    const { replies, worker } = await askAll(
      run('let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc'),
    )
    worker.terminate()
    const legs = replies.flatMap((r) => (r.kind === 'frames' ? [r.leg] : []))
    // λ records in several replies, so a leg that started before λ finished would put its replies between two of λ's.
    expect(legs.filter((leg) => leg === 'lambda').length).toBeGreaterThan(1)
    // The legs in the order their replies arrived, each run of one leg's replies taken once.
    expect(legs.filter((leg, i) => leg !== legs[i - 1])).toEqual(['lambda', 'rxm', 'tm'])
  })

  it('records a frame per β-step plus the initial term', async () => {
    const { replies, worker } = await askAll(run('let x = 40; x + 2'))
    worker.terminate()
    const frames = replies.flatMap((r) => (r.kind === 'frames' && r.leg === 'lambda' ? r.frames : []))
    // The run is 7 β-steps, so 8 frames: step 0 through step 7.
    expect(frames.length).toBe(8)
    expect(frames[0]?.step).toBe(0)
    expect(frames.at(-1)?.step).toBe(7)
    const last = replies.filter((r) => r.kind === 'frames' && r.leg === 'lambda').at(-1)
    expect(last?.kind === 'frames' && last?.leg === 'lambda' && last.done).toBe('ended')
  })

  it('sends the TM program and its tape names once, on compiled', async () => {
    const { replies, worker } = await askAll(run('let x = 40; x + 2'))
    worker.terminate()
    const compiled = replies.find((r) => r.kind === 'compiled')
    expect(compiled?.kind === 'compiled' && compiled.programs.tm?.tapeNames).toEqual([
      'REG',
      'WORK',
      'STACK',
      'HEAP',
      'BOX',
    ])
    expect(compiled?.kind === 'compiled' && compiled.programs.tm?.program.tapes).toBe(5)
    expect(replies.filter((r) => r.kind === 'compiled').length).toBe(1)
  })

  it('records TM frames from step 0 even though compile already ran the TM leg', async () => {
    const { replies, worker } = await askAll(run('[1, 2]'))
    worker.terminate()
    const frames = replies.flatMap((r) => (r.kind === 'frames' && r.leg === 'tm' ? r.frames : []))
    expect(frames[0]?.step).toBe(0)
    expect(frames[1]?.step).toBe(1)
    expect(frames.at(-1)?.step).toBeGreaterThan(100)
  })

  // A declined λ leg must still leave a complete TM history: `Session`'s `lambdaState`, `lambdaValue`,
  // `stepLambda` and `lambdaTree` throw for a declined leg, so the worker checks `lambdaStatus().available`
  // before each (`recordLeg` in `record-loop.ts` for the recording, `session-worker.ts` for the rest).
  it('still records the TM leg when the λ backend declines', async () => {
    const src = 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)'
    const { replies, worker } = await askAll(run(src))
    worker.terminate()
    const compiled = replies.find((r) => r.kind === 'compiled')
    expect(compiled?.kind === 'compiled' && compiled.statuses.lambda.available).toBe(false)
    expect(replies.flatMap((r) => (r.kind === 'frames' && r.leg === 'lambda' ? r.frames : [])).length).toBe(0)
    expect(replies.flatMap((r) => (r.kind === 'frames' && r.leg === 'tm' ? r.frames : [])).length).toBeGreaterThan(0)
    expect(replies.at(-1)?.kind).toBe('result')
  })

  // `num200`, from `frame_cost_probe`. The mirror image: a live λ leg and a declined TM leg.
  it('still records the λ leg when the TM backend declines', async () => {
    const { replies, worker } = await askAll(run('let x = 200; x + 1'))
    worker.terminate()
    const compiled = replies.find((r) => r.kind === 'compiled')
    expect(compiled?.kind === 'compiled' && compiled.statuses.tm.available).toBe(false)
    expect(replies.flatMap((r) => (r.kind === 'frames' && r.leg === 'lambda' ? r.frames : [])).length).toBeGreaterThan(
      0,
    )
    // The mirror of the λ-declines test above, which asserts the λ `frames` are exactly 0. Here the TM
    // leg is the one declining, so the TM `frames` must be exactly 0 and `programs.tm` must be the specific
    // null value the decline guard produces, not merely absent from the reply.
    expect(replies.flatMap((r) => (r.kind === 'frames' && r.leg === 'tm' ? r.frames : [])).length).toBe(0)
    expect(compiled?.kind === 'compiled' && compiled.programs.tm).toBeNull()
    expect(replies.at(-1)?.kind).toBe('result')
  })

  it('frames are rendered at FRAME_BYTES, not the readout budget', async () => {
    // `[1, 2, 3]`'s λ frames max out at 141 characters — identical at `FRAME_BYTES` (512) and
    // `LAMBDA_BYTE_BUDGET` (65,536) alike, so that fixture cannot tell the two budgets apart.
    // `let x = 200; x + 1` renders all 8 of its λ frames at up to 1,050 characters untruncated, which
    // is over `FRAME_BYTES` and under `LAMBDA_BYTE_BUDGET` — a mutant that swapped the budget constant
    // in the record loop would leave frames longer than 512 and this test would catch it.
    const { replies, worker } = await askAll(run('let x = 200; x + 1'))
    worker.terminate()
    const frames = replies.flatMap((r) => (r.kind === 'frames' && r.leg === 'lambda' ? r.frames : []))
    expect(frames.length).toBeGreaterThan(0)
    for (const f of frames) expect(f.text.length).toBeLessThanOrEqual(512)
  })

  it('abandons a superseded run without replying for it', async () => {
    const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
    const seen: RunReply[] = []
    // Resolved on generation 1's FIRST λ `frames` reply — the moment its record loop has posted
    // one `RECORD_CHUNK` and suspended at `await yieldToEventLoop()`, still holding `recording.lambda`.
    // Posting generation 2 only after this point (not immediately, back-to-back) is what makes the
    // stale-flag race reachable: a `run` posted right away can land before the worker's wasm init
    // (`ready`) even resolves, in which case generation 1 never becomes live and never records at all.
    let resolveGen1Recording: () => void
    const gen1Recording = new Promise<void>((resolve) => {
      resolveGen1Recording = resolve
    })
    const done = new Promise<void>((resolve) => {
      worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
        seen.push(e.data)
        if (e.data.gen === 1 && e.data.kind === 'frames' && e.data.leg === 'lambda') resolveGen1Recording()
        if (e.data.gen === 2 && (e.data.kind === 'result' || e.data.kind === 'no-session')) resolve()
      })
    })
    worker.postMessage({
      kind: 'run',
      gen: 1,
      // `sum(20)`: ~1,706 β-steps, seven `RECORD_CHUNK` (256) chunks — unlike `sum(5)`, which finishes
      // inside its first chunk and never reaches `await yieldToEventLoop()` at all. Seven suspension
      // points, not one, because landing generation 2 in the single window a smaller fixture offers is
      // a race against this test's own scheduling overhead; seven windows make it reliable.
      src: 'fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(20)',
      encoding: 'unary',
    })
    await gen1Recording
    worker.postMessage({ kind: 'run', gen: 2, src: 'let x = 40; x + 2', encoding: 'unary' })
    await done
    worker.terminate()
    // Generation 2 completed, so nothing from generation 1 may arrive after it — a stale reply here
    // would mean a superseded loop kept touching a session that had been freed.
    const lastGen2 = seen.findIndex((r) => r.gen === 2 && (r.kind === 'result' || r.kind === 'no-session'))
    expect(seen.slice(lastGen2).every((r) => r.gen === 2)).toBe(true)
    expect(seen.some((r) => r.gen === 2 && r.kind === 'result')).toBe(true)
    // Generation 2 must have actually RECORDED, not merely replied. Without this the test passes
    // when gen 2's record loop is suppressed by gen 1's stale flag and `result` reports the
    // unstepped initial term as the answer.
    const gen2Frames = seen.flatMap((r) => (r.kind === 'frames' && r.leg === 'lambda' && r.gen === 2 ? r.frames : []))
    expect(gen2Frames.length).toBeGreaterThan(1)
    expect(gen2Frames.at(-1)?.step).toBeGreaterThan(0)
    const gen2Result = seen.find((r) => r.gen === 2 && r.kind === 'result')
    expect(gen2Result?.kind === 'result' && gen2Result.legs.lambda.status.run).toBe('Ended')
  })

  it('replies to extend even when the run already ended', async () => {
    const { replies: first, worker } = await askAll(run('let x = 40; x + 2'))
    const result = first.find((r) => r.kind === 'result')
    expect(result).toBeDefined()

    const replies: RunReply[] = []
    const done = new Promise<void>((resolve) => {
      worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
        replies.push(e.data)
        if (e.data.kind === 'result') resolve()
      })
    })
    // A run that ended cannot produce more frames — worth pinning in its own right — but the reply
    // must still arrive; that is the whole point of this test.
    worker.postMessage({ kind: 'extend', gen: 1, leg: 'lambda', epoch: 0 })
    await done
    worker.terminate()
    expect(
      replies.some((r) => r.kind === 'frames' && r.leg === 'lambda' && r.frames.length === 0 && r.done === 'ended'),
    ).toBe(true)
    expect(replies.some((r) => r.kind === 'result')).toBe(true)
  })
})

const recorded = (r: RunReply): boolean =>
  (r.kind === 'frames' && r.leg === 'rxm' && r.done !== null) || r.kind === 'no-session'

describe('session-worker rxm copies', () => {
  const FORTY_TWO = 'result Nat\n\n    li\trr, #42\n    halt\n'

  it('sends the program’s rxm as text on compiled, headed by its type, and null with no rxm leg', async () => {
    const { replies, worker } = await askAll(run('let x = 40; x + 2'))
    worker.terminate()
    const compiled = replies.find((r) => r.kind === 'compiled')
    expect(compiled?.kind === 'compiled' && compiled.programs.rxm?.text).toBe(
      'result Nat\n\n    li\tr0, #40\n    mov\tr1, r0\n    li\tr2, #2\n    add\trr, r1, r2\n    halt\n',
    )

    const list = `[${Array.from({ length: 2048 }, (_, i) => i).join(', ')}]`
    const declined = await askAll(run(list))
    declined.worker.terminate()
    const second = declined.replies.find((r) => r.kind === 'compiled')
    expect(second?.kind === 'compiled' && [second.statuses.rxm.available, second.programs.rxm]).toEqual([false, null])
  })

  it('builds an rxm copy, answers with its status, listing and value, then records its frames', async () => {
    const { replies, worker } = await askUntil(
      { kind: 'scratch', gen: 1, leg: 'rxm', src: FORTY_TWO, step: 0 },
      recorded,
    )
    worker.terminate()
    const [built, ...rest] = replies
    expect(built?.kind).toBe('rxm-scratch-compiled')
    if (built?.kind !== 'rxm-scratch-compiled') return
    expect(built.rxm).toEqual({ available: true, reason: '', run: 'Running', cap: null, total_steps: 2 })
    expect(built.rxmProgram).toEqual({ listing: ['li\trr, #42', 'halt'], labels: [] })
    expect(built.value).toEqual({ Value: { text: '42' } })
    const frames = rest.flatMap((r) => (r.kind === 'frames' && r.leg === 'rxm' ? r.frames : []))
    expect(frames.map((f) => [f.step, f.source_node])).toEqual([
      [0, null],
      [1, null],
      [2, null],
    ])
    expect(rest.at(-1)).toMatchObject({ kind: 'frames', leg: 'rxm', done: 'ended' })
  })

  it('refuses text with a label mistake, and names it', async () => {
    const { replies, worker } = await askUntil(
      { kind: 'scratch', gen: 1, leg: 'rxm', src: '\tjmp\tnowhere\n', step: 0 },
      recorded,
    )
    worker.terminate()
    expect(replies.map((r) => r.kind)).toEqual(['no-session'])
    expect(replies[0]?.kind === 'no-session' && replies[0].diagnostics.map((d) => d.message)).toEqual([
      'undefined label `nowhere`',
    ])
  })

  it('answers extend on an rxm copy with its frames and its value, where a session gets a result', async () => {
    const { worker } = await askUntil({ kind: 'scratch', gen: 1, leg: 'rxm', src: FORTY_TWO, step: 0 }, recorded)
    const replies: RunReply[] = []
    const done = new Promise<void>((resolve) => {
      worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
        replies.push(e.data)
        if (e.data.kind === 'rxm-value') resolve()
      })
    })
    worker.postMessage({ kind: 'extend', gen: 1, leg: 'rxm', epoch: 0 })
    await done
    worker.terminate()
    expect(replies.map((r) => [r.kind, 'leg' in r ? r.leg : null])).toEqual([
      ['frames', 'rxm'],
      ['rxm-value', null],
    ])
    expect(replies.at(-1)).toEqual({ kind: 'rxm-value', gen: 1, value: { Value: { text: '42' } } })
  })
})

/** `step-focus-recording.test.ts`'s program of that name: its TM leg stops `budget` twice before it ends. */
const LONG_SRC =
  'fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2, 4, 3, 1, 2, 4, 3, 1, 2, 4, 3, 1, 2, 4].map(add1)'

/** `LONG_SRC` over a list twice as long, whose λ leg is still unfinished after one `extend` (`LONG_SRC`'s is not). */
const LONGER_SRC = LONG_SRC.replace('].map', ', 3, 1, 2, 4, 3, 1, 2, 4, 3, 1, 2, 4, 3, 1, 2, 4].map')

/** The hidden-recording spec's example: its λ leg is refused at its first step, and its rxm leg records many chunks. */
const EXAMPLE = 'let mut n = 100000; while n > 0 { n = n - 1; } n'

/** A recording is waited on in stages of this many frames, each within `until`'s one bound. */
const STAGE = 37_000

type ResultReply = Extract<RunReply, { kind: 'result' }>

/** One TM chunk as `watch` keeps it in a long run: its epoch, its steps and its end. */
type TmChunk = { epoch: number; steps: number[]; done: RecordEnd | null }

/**
 * A worker of its own, as `askUntil` makes one, and every reply it posts, for cases that post as they go. **EVERY WAIT
 * IS `until` AT ITS DEFAULT, IN STAGES OF `STAGE` FRAMES**, so that a long recording is waited on as long as it moves
 * and a stage that records nothing fails. **A LONG RUN'S TM CHUNKS ARE KEPT AS THEIR STEPS** (`light`): a long run's
 * TM leg posts too many frames to keep whole, and a case reads them by their steps alone.
 */
function watch(light = false) {
  const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
  const replies: RunReply[] = []
  const tm: TmChunk[] = []
  let frames = 0
  let error: string | null = null
  worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
    const r = e.data
    if (r.kind === 'worker-error') error = r.message
    if (r.kind === 'frames') frames += r.frames.length
    if (r.kind === 'frames' && r.leg === 'tm')
      tm.push({ epoch: r.epoch, steps: r.frames.map((f) => f.step), done: r.done })
    replies.push(light && r.kind === 'frames' && r.leg === 'tm' ? { ...r, frames: [] } : r)
  })
  return {
    worker,
    replies,
    tm,
    post: (req: RunRequest) => worker.postMessage(req),
    /** Until `holds`, in stages; a `worker-error` ends the wait and fails it. */
    settle: async (holds: () => boolean, what: string): Promise<void> => {
      const over = () => holds() || error !== null
      for (let from = frames; !over(); from = frames) await until(() => over() || frames >= from + STAGE, what)
      if (error !== null) throw new Error(`the worker threw: ${error}`)
    },
    results: () => replies.filter((r): r is ResultReply => r.kind === 'result'),
  }
}

/** `leg`'s chunks recorded under `epoch`, in order. */
const chunks = (replies: readonly RunReply[], leg: Leg, epoch: number): FramesReply[] =>
  replies.filter((r): r is FramesReply => r.kind === 'frames' && r.leg === leg && r.epoch === epoch)

/** Whether `leg`'s recording under `epoch` has stopped. */
const stopped = (replies: readonly RunReply[], leg: Leg, epoch: number): boolean =>
  (chunks(replies, leg, epoch).at(-1)?.done ?? null) !== null

/** `leg`'s frames under `epoch` up to its first stop, and how that stop ended: a fill. */
const fill = (replies: readonly RunReply[], leg: Leg, epoch: number): { frames: unknown[]; done: RecordEnd | null } => {
  const all = chunks(replies, leg, epoch)
  const end = all.findIndex((c) => c.done !== null)
  const taken = end === -1 ? all : all.slice(0, end + 1)
  return { frames: taken.flatMap((c): unknown[] => c.frames), done: taken.at(-1)?.done ?? null }
}

/**
 * The worker's `rewind` (hidden-recording spec §5.4): a leg goes back to step 0 and records its first fill again under
 * the epoch the request carries, which every frames reply then names; a λ rewind leaves the TM leg's cursor where it
 * stood.
 */
describe('session-worker rewind', () => {
  it('rewinds each leg of a session, and each records what its first fill did', async () => {
    const w = watch()
    try {
      w.post(run('let x = 40; x + 2'))
      await w.settle(() => w.results().length === 1, 'the run’s result')
      for (const leg of LEGS) {
        w.post({ kind: 'rewind', gen: 1, leg, epoch: 1 })
        await w.settle(() => stopped(w.replies, leg, 1), `the ${leg} leg’s rewound fill to stop`)
      }
      for (const leg of LEGS) {
        const first = fill(w.replies, leg, 0)
        expect(first.frames.length, `the ${leg} leg’s first fill`).toBeGreaterThan(1)
        expect(fill(w.replies, leg, 1), `the ${leg} leg’s rewound fill`).toEqual(first)
      }
    } finally {
      w.worker.terminate()
    }
  })

  it('rewinds a λ, a TM and an rxm copy, and each records what its first fill did', async () => {
    const source = watch()
    try {
      source.post(run('let x = 40; x + 2'))
      await source.settle(() => source.results().length === 1, 'the run’s result')
    } finally {
      source.worker.terminate()
    }
    const compiled = source.replies.find((r) => r.kind === 'compiled')
    if (compiled?.kind !== 'compiled') throw new Error('the run sent no `compiled`')
    const step0 = fill(source.replies, 'lambda', 0).frames[0] as LambdaState
    // THE WHOLE TERM, NOT A CUT ONE: a frame's text is cut at `FRAME_BYTES`, and a cut text is no λ text to fork.
    const [tmSrc, rxmSrc] = [compiled.programs.tm?.text ?? null, compiled.programs.rxm?.text ?? null]
    expect([step0.cut, tmSrc === null, rxmSrc === null]).toEqual([null, false, false])
    const builds: [Leg, RunRequest][] = [
      ['lambda', { kind: 'scratch', gen: 1, leg: 'lambda', src: step0.text, step: 0 }],
      ['tm', { kind: 'scratch', gen: 1, leg: 'tm', src: tmSrc ?? '', step: 0 }],
      ['rxm', { kind: 'scratch', gen: 1, leg: 'rxm', src: rxmSrc ?? '', step: 0 }],
    ]
    for (const [leg, build] of builds) {
      const w = watch()
      try {
        w.post(build)
        await w.settle(() => stopped(w.replies, leg, 0), `the ${leg} copy’s first fill to stop`)
        w.post({ kind: 'rewind', gen: 1, leg, epoch: 1 })
        await w.settle(() => stopped(w.replies, leg, 1), `the ${leg} copy’s rewound fill to stop`)
        const first = fill(w.replies, leg, 0)
        expect(first.frames.length, `the ${leg} copy’s first fill`).toBeGreaterThan(1)
        expect(fill(w.replies, leg, 1), `the ${leg} copy’s rewound fill`).toEqual(first)
      } finally {
        w.worker.terminate()
      }
    }
  })

  /**
   * **AN `extend` OF AN OLDER EPOCH, OR A `rewind` OF NO NEWER ONE, IS ONE THE PAGE CANNOT POST** (it raises the epoch
   * as it posts the `rewind`), so only a test reaches the worker's checks. A `lambda-tree` request closes the case:
   * each `extend` of an ended leg, and a `rewind` turned away, posts all it posts before the worker takes its next
   * message, so the tree's reply comes after every one of them.
   */
  it('posts no result of its own, and an extend or a rewind the page cannot post records nothing', async () => {
    const w = watch()
    try {
      w.post(run('let x = 40; x + 2'))
      await w.settle(() => w.results().length === 1, 'the run’s result')
      const at = w.replies.length
      w.post({ kind: 'rewind', gen: 1, leg: 'lambda', epoch: 1 })
      await w.settle(() => stopped(w.replies, 'lambda', 1), 'the λ leg’s rewound fill to stop')
      w.post({ kind: 'extend', gen: 1, leg: 'lambda', epoch: 0 })
      w.post({ kind: 'extend', gen: 1, leg: 'lambda', epoch: 1 })
      w.post({ kind: 'rewind', gen: 1, leg: 'lambda', epoch: 1 })
      w.post({ kind: 'lambda-tree', gen: 1, step: 0, budget: 100 })
      await w.settle(() => w.replies.at(-1)?.kind === 'lambda-tree', 'the tree after both extends and the rewind')
      expect(
        w.replies.slice(at).map((r) => [r.kind, 'leg' in r ? r.leg : null, 'epoch' in r ? r.epoch : null]),
      ).toEqual([
        ['frames', 'lambda', 1],
        ['frames', 'lambda', 1],
        ['result', null, null],
        ['lambda-tree', null, null],
      ])
    } finally {
      w.worker.terminate()
    }
  })

  it('stops the recording a rewind replaces, and records the leg again from step 0 under the new epoch', async () => {
    const w = watch(true)
    try {
      let asked = false
      w.worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
        if (e.data.kind !== 'frames' || e.data.leg !== 'tm' || asked) return
        asked = true
        w.post({ kind: 'rewind', gen: 1, leg: 'tm', epoch: 1 })
      })
      w.post(run(LONG_SRC))
      await w.settle(() => w.tm.some((c) => c.epoch === 1 && c.done !== null), 'the TM leg’s rewound fill to stop')
      const turn = w.tm.findIndex((c) => c.epoch === 1)
      // THE REWIND LANDED DURING THE FIRST FILL: every chunk before it is that fill's, unfinished.
      expect(w.tm.slice(0, turn).every((c) => c.epoch === 0 && c.done === null)).toBe(true)
      expect(w.tm.slice(turn).every((c) => c.epoch === 1)).toBe(true)
      const steps = w.tm.slice(turn).flatMap((c) => c.steps)
      expect(steps.length).toBeGreaterThan(STAGE)
      expect(steps.findIndex((step, i) => step !== i)).toBe(-1)
      expect(w.tm.at(-1)?.done).toBe('budget')
    } finally {
      w.worker.terminate()
    }
  }, 90_000)

  it('keeps a decided λ value in the next result after a λ rewind', async () => {
    const w = watch(true)
    try {
      w.post(run(LONG_SRC))
      await w.settle(() => w.results().length === 1, 'the run’s result')
      const firstFill = fill(w.replies, 'lambda', 0)
      expect(firstFill.done).toBe('budget')
      while (chunks(w.replies, 'lambda', 0).at(-1)?.done !== 'ended') {
        const before = w.results().length
        expect(before, 'λ extends before the λ leg ends').toBeLessThan(5)
        w.post({ kind: 'extend', gen: 1, leg: 'lambda', epoch: 0 })
        await w.settle(() => w.results().length > before, 'a λ extend’s result')
      }
      const decided = w.results().at(-1)?.legs.lambda
      expect(decided?.value).toEqual({ Value: { text: '[4, 2, 3, 5, 4, 2, 3, 5, 4, 2, 3, 5, 4, 2, 3, 5]' } })

      w.post({ kind: 'rewind', gen: 1, leg: 'lambda', epoch: 1 })
      await w.settle(() => stopped(w.replies, 'lambda', 1), 'the λ leg’s rewound fill to stop')
      expect(fill(w.replies, 'lambda', 1)).toEqual(firstFill)
      const before = w.results().length
      const tmAt = w.tm.length
      const tmLast = w.tm.flatMap((c) => c.steps).at(-1) ?? Number.NaN
      w.post({ kind: 'extend', gen: 1, leg: 'tm', epoch: 0 })
      await w.settle(() => w.results().length > before, 'the TM extend’s result')
      expect(w.results().at(-1)?.legs.lambda).toEqual(decided)
      // THE λ REWIND LEFT THE TM CURSOR WHERE IT STOOD: the TM leg's recording goes on from the step after its last.
      expect(w.tm.slice(tmAt).flatMap((c) => c.steps)[0]).toBe(tmLast + 1)
    } finally {
      w.worker.terminate()
    }
  }, 90_000)

  it('drops an unfinished λ count back to the rewound recording’s in the next result', async () => {
    const w = watch(true)
    try {
      w.post(run(LONGER_SRC))
      await w.settle(() => w.results().length === 1, 'the run’s result')
      const s0 = w.results()[0]?.legs.lambda
      w.post({ kind: 'extend', gen: 1, leg: 'lambda', epoch: 0 })
      await w.settle(() => w.results().length === 2, 'the λ extend’s result')
      const s1 = w.results()[1]?.legs.lambda
      // FURTHER ON AND STILL UNFINISHED, so the drop-back below is a step back and not a value.
      expect([s0?.value, s1?.value]).toEqual(['Unfinished', 'Unfinished'])
      expect(s1?.state?.step).toBeGreaterThan(s0?.state?.step ?? Number.POSITIVE_INFINITY)

      w.post({ kind: 'rewind', gen: 1, leg: 'lambda', epoch: 1 })
      await w.settle(() => stopped(w.replies, 'lambda', 1), 'the λ leg’s rewound fill to stop')
      w.post({ kind: 'extend', gen: 1, leg: 'tm', epoch: 0 })
      await w.settle(() => w.results().length === 3, 'the TM extend’s result')
      expect(w.results()[2]?.legs.lambda).toEqual(s0)
    } finally {
      w.worker.terminate()
    }
  }, 90_000)

  /**
   * **A `result` POSTED WHILE A REWIND'S FILL RECORDS KEEPS THAT LEG'S LAST PART** (`keepInFlight`): the rewind posts
   * no `result` of its own, so a count read mid-fill would be the readout's until the next `[continue]`. Each case
   * asserts that the `result` came before the rewound fill stopped, the moment it could have read the leg mid-way.
   */
  it('keeps the λ part of the result an extend posts when a λ rewind cut its recording short', async () => {
    const w = watch(true)
    try {
      w.post(run(LONGER_SRC))
      await w.settle(() => w.results().length === 1, 'the run’s result')
      const s0 = w.results()[0]?.legs.lambda
      const at = chunks(w.replies, 'lambda', 0).length
      let asked = false
      w.worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
        if (e.data.kind !== 'frames' || e.data.leg !== 'lambda' || asked) return
        asked = true
        w.post({ kind: 'rewind', gen: 1, leg: 'lambda', epoch: 1 })
      })
      w.post({ kind: 'extend', gen: 1, leg: 'lambda', epoch: 0 })
      await w.settle(() => stopped(w.replies, 'lambda', 1) && w.results().length === 2, 'the rewound fill and a result')
      const cut = chunks(w.replies, 'lambda', 0).slice(at)
      expect(cut.length > 0 && cut.every((c) => c.done === null), 'the extend’s chunks, all cut short').toBe(true)
      const stop = w.replies.findIndex(
        (r) => r.kind === 'frames' && r.leg === 'lambda' && r.epoch === 1 && r.done !== null,
      )
      expect(w.replies.indexOf(w.results()[1] as RunReply)).toBeLessThan(stop)
      expect(fill(w.replies, 'lambda', 1)).toEqual(fill(w.replies, 'lambda', 0))
      expect(w.results()[1]?.legs.lambda).toEqual(s0)
    } finally {
      w.worker.terminate()
    }
  }, 90_000)

  it('keeps the λ part of the result another leg’s extend posts while a λ rewind records', async () => {
    const w = watch(true)
    try {
      w.post(run(LONG_SRC))
      await w.settle(() => w.results().length === 1, 'the run’s result')
      const s0 = w.results()[0]?.legs.lambda
      // AN ENDED rxm LEG: its `extend` posts its `result` before the worker takes another message.
      expect([fill(w.replies, 'lambda', 0).done, fill(w.replies, 'rxm', 0).done]).toEqual(['budget', 'ended'])
      w.post({ kind: 'rewind', gen: 1, leg: 'lambda', epoch: 1 })
      w.post({ kind: 'extend', gen: 1, leg: 'rxm', epoch: 0 })
      await w.settle(() => stopped(w.replies, 'lambda', 1) && w.results().length === 2, 'the rewound fill and a result')
      const stop = w.replies.findIndex(
        (r) => r.kind === 'frames' && r.leg === 'lambda' && r.epoch === 1 && r.done !== null,
      )
      expect(w.replies.indexOf(w.results()[1] as RunReply)).toBeLessThan(stop)
      expect(w.results()[1]?.legs.lambda).toEqual(s0)
    } finally {
      w.worker.terminate()
    }
  }, 90_000)

  /**
   * **BEFORE THE GENERATION'S FIRST `result`, THE PART KEPT IS THE ONE THE REWIND FOUND**, there being no posted one.
   * The page's path: *keep recording* at the λ fill's `budget` stop while the run's later legs still record, and ↺ once
   * that recording has dropped step 0, so that the extend the rewind cuts short posts the generation's first `result`.
   */
  it('keeps the λ part a rewind found in the generation’s first result, which the extend it cut short posts', async () => {
    const w = watch(true)
    try {
      let extended = false
      let rewound = false
      w.worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
        const r = e.data
        if (r.kind !== 'frames' || r.leg !== 'lambda' || r.epoch !== 0 || rewound) return
        if (!extended && r.done === 'budget') {
          extended = true
          w.post({ kind: 'extend', gen: 1, leg: 'lambda', epoch: 0 })
        } else if (extended) {
          rewound = true
          w.post({ kind: 'rewind', gen: 1, leg: 'lambda', epoch: 1 })
        }
      })
      w.post(run(LONGER_SRC))
      await w.settle(() => stopped(w.replies, 'lambda', 1) && w.results().length === 2, 'the rewound fill and the run')
      const [first, second] = w.results()
      const at = (r: RunReply | undefined) => w.replies.indexOf(r as RunReply)
      const tmStop = w.replies.findIndex(
        (r) => r.kind === 'frames' && r.leg === 'tm' && r.epoch === 0 && r.done !== null,
      )
      expect(at(first), 'the extend’s result, before the run’s, which waits for the TM fill').toBeLessThan(tmStop)
      const lambda = chunks(w.replies, 'lambda', 0)
      const end = lambda.findIndex((c) => c.done !== null)
      expect(lambda[end]?.done, 'precondition: the λ fill stopped at `budget`').toBe('budget')
      expect(
        lambda.slice(end + 1).every((c) => c.done === null),
        'the extend’s chunks, all cut short',
      ).toBe(true)
      const stop = w.replies.findIndex(
        (r) => r.kind === 'frames' && r.leg === 'lambda' && r.epoch === 1 && r.done !== null,
      )
      expect(at(first), 'the extend’s result, while the rewound fill records').toBeLessThan(stop)
      const cut = (lambda.flatMap((c): unknown[] => c.frames).at(-1) as LambdaState | undefined)?.step
      const refilled = (fill(w.replies, 'lambda', 1).frames.at(-1) as LambdaState | undefined)?.step
      expect(cut, 'precondition: the extend recorded past the λ fill').toBeGreaterThan(
        refilled ?? Number.POSITIVE_INFINITY,
      )
      expect({ step: first?.legs.lambda.state?.step, value: first?.legs.lambda.value }).toEqual({
        step: cut,
        value: 'Unfinished',
      })
      expect([cut, refilled], 'the run’s λ part, kept or read once the fill stopped').toContain(
        second?.legs.lambda.state?.step,
      )
    } finally {
      w.worker.terminate()
    }
  }, 90_000)

  /**
   * **EACH BUILD STARTS ITS `result`s AFRESH** (`onRun`'s prologue): the part the last generation posted, and the one a
   * rewind of it found before its first `result`, are another program's. Generation 2's first `result` comes while its
   * rxm leg records, where `keepInFlight` posts the leg's held part, so either one left over would be posted for it.
   */
  it('posts a new generation’s own rxm part in its first result, not the one the last posted or a rewind of it found', async () => {
    const w = watch(true)
    try {
      let rewound = false
      let extended = false
      w.worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
        const r = e.data
        if (r.kind === 'frames' && r.leg === 'tm' && r.gen === 1 && !rewound) {
          rewound = true
          w.post({ kind: 'rewind', gen: 1, leg: 'rxm', epoch: 1 })
        } else if (r.kind === 'frames' && r.leg === 'rxm' && r.gen === 2 && !extended) {
          extended = true
          w.post({ kind: 'extend', gen: 2, leg: 'lambda', epoch: 0 })
        }
      })
      const of = (gen: number, replies: readonly RunReply[] = w.replies) => replies.filter((r) => r.gen === gen)
      const firstResult = (gen: number) => w.results().find((r) => r.gen === gen)
      const at = (r: RunReply | undefined) => w.replies.indexOf(r as RunReply)
      w.post(run(LONG_SRC))
      await w.settle(
        () => firstResult(1) !== undefined && stopped(of(1), 'rxm', 1),
        'generation 1’s result and its rewound rxm fill',
      )
      const one = firstResult(1)
      expect(at(chunks(of(1), 'rxm', 1)[0]), 'precondition: the rxm rewind came before the first result').toBeLessThan(
        at(one),
      )
      expect(one?.legs.rxm.status.run, 'precondition: generation 1’s rxm value is decided').toBe('Ended')

      w.post(run(EXAMPLE, 2))
      await w.settle(() => firstResult(2) !== undefined, 'generation 2’s first result')
      const two = firstResult(2)
      expect(
        stopped(of(2, w.replies.slice(0, at(two))), 'rxm', 0),
        'precondition: generation 2’s rxm leg still recorded at its first result',
      ).toBe(false)
      const compiled = of(2).find((r) => r.kind === 'compiled')
      expect(
        { steps: two?.legs.rxm.status.total_steps, value: two?.legs.rxm.value },
        'generation 2’s first rxm part',
      ).toEqual({
        steps: compiled?.kind === 'compiled' ? compiled.statuses.rxm.total_steps : Number.NaN,
        value: { Value: { text: '0' } },
      })
    } finally {
      w.worker.terminate()
    }
  }, 90_000)
})
