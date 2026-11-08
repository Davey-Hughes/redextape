import { describe, expect, it } from 'vitest'
import { buildCopy, type Claim, type CopyBuild, claimLive, liveHandle, type Occupant } from '../../src/copy-build'
import { LEGS, perLeg } from '../../src/legs'
import { HISTORY_BYTES, type Leg, type RunReply, rxmRecordEnd } from '../../src/protocol'
import type { RecordLeg, RecordWorker } from '../../src/record-loop'
import type { Diagnostic } from '../../src/types'
import { FACT3, frameOf, rxmSnapshot } from './rxm-fixtures'

/**
 * `claimLive`'s, `buildCopy`'s and `liveHandle`'s contracts, against fakes that note every call in one log, in the
 * order made. The copy is an rxm copy over a cursor that is nothing but a step count, as `record-loop.test.ts`'s is,
 * and the worker's books start set, so a build that skipped the reset would find its leg's loop already recording.
 */

/** A cursor that runs `length` steps and then ends. */
type Cursor = { at: number; readonly length: number }

/** What a build makes: a copy with a name the log can show. */
type Copy = { readonly name: string; readonly cursor: Cursor }

/** Every leg's four books, as `set` leaves them. */
const SET = { recorded: 5, allowance: 7, recording: true, epoch: 2 }

/** Every leg's four books, as a reset leaves them. */
const RESET = { recorded: 0, allowance: HISTORY_BYTES, recording: false, epoch: 0 }

/** A worker whose books are `SET` for every leg, posting into `log` and `posts`. */
function setWorker(log: string[], posts: RunReply[], owns: (gen: number) => boolean): RecordWorker {
  return {
    recorded: perLeg(() => SET.recorded),
    allowance: perLeg(() => SET.allowance),
    recording: perLeg(() => SET.recording),
    epoch: perLeg(() => SET.epoch),
    owns,
    post: (reply) => {
      posts.push(reply)
      log.push(reply.kind === 'frames' ? `frames ${reply.frames.map((f) => f.step)} ${reply.done}` : reply.kind)
    },
    yieldToEventLoop: () => Promise.resolve(),
  }
}

/** One leg's books, read back in `SET`'s shape. */
const booksOf = (worker: RecordWorker, leg: Leg) => ({
  recorded: worker.recorded[leg],
  allowance: worker.allowance[leg],
  recording: worker.recording[leg],
  epoch: worker.epoch[leg],
})

/** Which of `SET` and `RESET` every leg's books are, or `mixed`. */
function booksState(worker: RecordWorker): string {
  const all = (books: typeof SET) => LEGS.every((leg) => JSON.stringify(booksOf(worker, leg)) === JSON.stringify(books))
  return all(SET) ? 'set' : all(RESET) ? 'reset' : 'mixed'
}

/** The fake's compiled reply for the copy named `name`: its value is that name, so another copy's reply differs. */
const compiledOf = (gen: number, name: string): Extract<RunReply, { kind: 'rxm-scratch-compiled' }> => ({
  kind: 'rxm-scratch-compiled',
  gen,
  rxm: rxmSnapshot('Ended').status,
  rxmProgram: FACT3,
  value: { Value: { text: name } },
})

type Harness = {
  log: string[]
  posts: RunReply[]
  occupant: { current: { gen: number; copy: Copy } | null }
  worker: RecordWorker
  /** Build a copy for generation 1, while `latest` says which generation is newest. */
  build(latest?: number): Promise<void>
}

/**
 * A worker holding an old copy of generation 0, whose next build makes `made`, a two-step copy unless a test passes
 * `null`, with `diagnostics` beside it.
 */
function harness(made: Copy | null = copyOf('copy', 2), diagnostics: Diagnostic[] = []): Harness {
  const log: string[] = []
  const posts: RunReply[] = []
  const occupant: Harness['occupant'] = { current: { gen: 0, copy: copyOf('old', 1) } }
  const worker = setWorker(log, posts, (gen) => occupant.current?.gen === gen)
  const claim: Claim = {
    ready: Promise.resolve(),
    dropLive: () => {
      log.push(`drop ${occupant.current?.copy.name ?? 'nothing'}`)
      occupant.current = null
    },
    forgetResult: () => log.push('forget'),
  }
  const copyBuild: CopyBuild<'rxm', Copy> = {
    build: (src, step) => {
      log.push(`build ${src} at ${step} over ${occupant.current?.copy.name ?? 'nothing'}`)
      return { made, diagnostics }
    },
    free: (copy) => log.push(`free ${copy.name}`),
    // This and `compiled` read with `?.`, so that a build that went on with nothing made fails at an assertion
    // rather than here.
    occupy: (gen, copy) => {
      log.push(`occupy ${copy?.name ?? 'nothing'}`)
      occupant.current = { gen, copy }
    },
    compiled: (gen, copy) => compiledOf(gen, copy?.name ?? 'nothing'),
    after: async (gen) => {
      log.push(`after ${gen}`)
    },
  }
  const record: RecordLeg<'rxm', Cursor> = {
    leg: 'rxm',
    handle: (gen) => (occupant.current?.gen === gen ? (occupant.current.copy?.cursor ?? null) : null),
    available: () => true,
    frame: (c) => frameOf({ step: c.at }),
    bytes: () => 10,
    step: (c) => {
      if (c.at >= c.length) return false
      c.at += 1
      return true
    },
    end: (c) => rxmRecordEnd({ run: c.at >= c.length ? 'Ended' : 'Running', cap: null }),
    raise: () => {
      throw new Error('a build raised a cap')
    },
    rewind: () => {
      throw new Error('a build rewound a cursor')
    },
  }
  return {
    log,
    posts,
    occupant,
    worker,
    build: (latest = 1) => buildCopy(copyBuild, record, claim, () => latest, worker, { gen: 1, src: 'text', step: 3 }),
  }
}

function copyOf(name: string, length: number): Copy {
  return { name, cursor: { at: 0, length } }
}

describe('claimLive', () => {
  it("waits for the module, then drops the occupant, resets every leg's books and forgets the result", async () => {
    const log: string[] = []
    const worker = setWorker(log, [], () => true)
    let open = (): void => {}
    const claim: Claim = {
      ready: new Promise<void>((resolve) => {
        open = resolve
      }),
      dropLive: () => log.push(`drop, books ${booksState(worker)}`),
      forgetResult: () => log.push(`forget, books ${booksState(worker)}`),
    }

    const claimed = claimLive(claim, worker)
    await Promise.resolve()
    expect(log).toEqual([])
    open()
    await claimed

    expect(log).toEqual(['drop, books set', 'forget, books reset'])
    for (const leg of LEGS) expect(booksOf(worker, leg)).toEqual(RESET)
  })
})

describe('buildCopy', () => {
  it('drops the old occupant before the build runs', async () => {
    const h = harness()

    await h.build()

    expect(h.log.slice(0, 3)).toEqual(['drop old', 'forget', 'build text at 3 over nothing'])
  })

  it("posts a refused build's diagnostics as no-session, and occupies, frees and records nothing", async () => {
    const diagnostic: Diagnostic = { span: { start: 0, end: 4 }, severity: 'Error', message: 'no such label' }
    const h = harness(null, [diagnostic])

    await h.build()

    expect(h.log).toEqual(['drop old', 'forget', 'build text at 3 over nothing', 'no-session'])
    expect(h.posts).toEqual([{ kind: 'no-session', gen: 1, diagnostics: [diagnostic] }])
    expect(h.occupant.current).toBeNull()
  })

  it('frees a build a newer generation superseded, and posts and occupies nothing', async () => {
    const copy = copyOf('copy', 2)
    const h = harness(copy)

    await h.build(2)

    expect(h.log).toEqual(['drop old', 'forget', 'build text at 3 over nothing', 'free copy'])
    expect(h.posts).toEqual([])
    expect(h.occupant.current).toBeNull()
    expect(copy.cursor.at).toBe(0)
  })

  it('occupies, posts the compiled reply, records the first frames from step 0, then runs after', async () => {
    const copy = copyOf('copy', 2)
    const h = harness(copy)

    await h.build()

    expect(h.log).toEqual([
      'drop old',
      'forget',
      'build text at 3 over nothing',
      'occupy copy',
      'rxm-scratch-compiled',
      'frames 0,1,2 ended',
      'after 1',
    ])
    expect(h.posts[0]).toEqual(compiledOf(1, 'copy'))
    expect(h.occupant.current).toEqual({ gen: 1, copy })
    expect(h.worker.recorded.rxm).toBe(30)
    expect(h.worker.recording.rxm).toBe(false)
  })
})

describe('liveHandle', () => {
  it("answers the session for every leg, a copy for its own leg alone, and null for another generation's", () => {
    type Handles = Record<Leg, string>
    const copy = (gen: number, leg: Leg): Occupant<string, Handles> => ({
      gen,
      kind: 'scratch',
      leg,
      session: `${leg} copy`,
    })
    const occupants: [string, Occupant<string, Handles> | null][] = [
      ['session', { gen: 1, kind: 'session', session: 'session' }],
      ...LEGS.map((leg): [string, Occupant<string, Handles>] => [`${leg} copy`, copy(1, leg)]),
      ['older session', { gen: 0, kind: 'session', session: 'session' }],
      ['older tm copy', copy(0, 'tm')],
      ['nothing', null],
    ]

    const answers = occupants.map(([name, live]) => [name, LEGS.map((leg) => liveHandle(live, leg, 1))])

    expect(answers).toEqual([
      ['session', ['session', 'session', 'session']],
      ['lambda copy', ['lambda copy', null, null]],
      ['rxm copy', [null, 'rxm copy', null]],
      ['tm copy', [null, null, 'tm copy']],
      ['older session', [null, null, null]],
      ['older tm copy', [null, null, null]],
      ['nothing', [null, null, null]],
    ])
  })
})
