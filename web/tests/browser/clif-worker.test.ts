import { afterEach, describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { EXAMPLE_ENCODING, EXAMPLES } from '../../src/examples'
import { COPY_LEGS } from '../../src/legs'
import type { FramesReply, Leg, Listing, RecordEnd, RunReply, RunRequest } from '../../src/protocol'
import { CLIF_ABSENT } from '../../src/protocol'
import { THROWN, throwing } from './clif-fixture'

/**
 * The session worker's CLIF pass (CLIF view design §6, *Loading* and *Recording while shown*), heard from a real
 * worker as `worker.test.ts` hears one: a run that carries a listing loads `pkg-clif`, builds a stepper once the other
 * legs have posted their `result`, and records it from step 0; a run that carries none touches nothing of it.
 */

/** What every request for `pkg-clif` asks for: its module and its wasm. */
const MATCH = 'redextape_clif_wasm'

const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''

/** `clif-package.test.ts`'s list, which the rxm leg declines, so `clifInput()` gives no input. */
const LIST = `[${Array.from({ length: 2048 }, (_, i) => i).join(', ')}]`

/** `measure::CORPUS`'s `loop1000000`, at `n` iterations. */
const loop = (n: number): string => `let mut i = 0; let mut acc = 0; while i < ${n} { acc = acc + i; i = i + 1; } acc`

/** `measure::CORPUS`'s `loop1000000` itself, which the CLIF leg records chunk after chunk. */
const LOOP = loop(1_000_000)

/**
 * Few enough iterations that the optimised listing's run ends in its first fill, and enough that the as-built
 * listing's first fill stops on its budget.
 */
const LOOP_SHORT = loop(600)

/** Each case's own bound, past every wait in it. */
const CASE_MS = 60_000

/** A wait's bound, under `CASE_MS`, so that a reply never heard is named rather than timed out by vitest. */
const WAIT_MS = 45_000

const run = (src: string, clif: Listing | null, gen = 1): RunRequest => ({
  kind: 'run',
  gen,
  src,
  encoding: EXAMPLE_ENCODING,
  clif,
})

type Reply<K extends RunReply['kind']> = Extract<RunReply, { kind: K }>

const ofKind = <K extends RunReply['kind']>(replies: readonly RunReply[], kind: K): Reply<K>[] =>
  replies.filter((r): r is Reply<K> => r.kind === kind)

/** `leg`'s chunks for `gen`, in the order they came. */
const chunksOf = <L extends Leg>(replies: readonly RunReply[], leg: L, gen = 1): FramesReply<L>[] =>
  // `r.leg === leg` does not narrow a generic `L`.
  replies.filter((r) => r.kind === 'frames' && r.leg === leg && r.gen === gen) as FramesReply<L>[]

/** The CLIF leg's chunks recorded under `epoch`, in the order they came. */
const clifChunks = (replies: readonly RunReply[], epoch: number): FramesReply<'clif'>[] =>
  chunksOf(replies, 'clif').filter((c) => c.epoch === epoch)

/** Whether a `result` has come after the CLIF leg's last chunk under `epoch`: the CLIF pass's own. */
const passResult = (replies: readonly RunReply[], epoch: number): boolean => {
  const end = replies.findIndex((r) => r.kind === 'frames' && r.leg === 'clif' && r.epoch === epoch && r.done !== null)
  return end >= 0 && replies.slice(end).some((r) => r.kind === 'result')
}

/** How `leg`'s recording for `gen` stopped, `undefined` while no chunk has said. */
const doneOf = (replies: readonly RunReply[], leg: Leg, gen = 1): RecordEnd | undefined =>
  chunksOf(replies, leg, gen).find((c) => c.done !== null)?.done ?? undefined

/** Whether λ, rxm and TM have each stopped recording for `gen` and its `result` has come. */
const settled = (replies: readonly RunReply[], gen = 1): boolean =>
  COPY_LEGS.every((leg) => doneOf(replies, leg, gen) !== undefined) &&
  replies.some((r) => r.kind === 'result' && r.gen === gen)

/** A fresh session worker, every reply it posts, and a wait on them that names what it waited for. */
type Heard = {
  readonly worker: Worker
  readonly replies: RunReply[]
  wait(what: string, heard: (replies: readonly RunReply[]) => boolean): Promise<void>
  /**
   * Every reply the worker had posted when it took this request: a `lambda-tree` asked of `gen`, which it answers at
   * once, after what it posted before it read the request.
   */
  flush(gen?: number): Promise<void>
}

function listen(): Heard {
  const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
  const replies: RunReply[] = []
  const checks = new Set<() => void>()
  worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
    replies.push(e.data)
    for (const check of [...checks]) check()
  })
  const wait = (what: string, heard: (replies: readonly RunReply[]) => boolean): Promise<void> =>
    new Promise((resolve, reject) => {
      const settle = (error: Error | null): void => {
        checks.delete(check)
        clearTimeout(timer)
        if (error === null) resolve()
        else reject(error)
      }
      const check = (): void => {
        const failed = replies.find((r) => r.kind === 'worker-error')
        if (failed !== undefined) settle(new Error(`${what}: the worker failed: ${JSON.stringify(failed)}`))
        else if (heard(replies)) settle(null)
      }
      const timer = setTimeout(() => {
        const kinds = replies.map((r) => (r.kind === 'frames' ? `frames ${r.leg}` : r.kind)).join(', ')
        settle(new Error(`${what}: not heard in ${WAIT_MS} ms; heard ${kinds}`))
      }, WAIT_MS)
      checks.add(check)
      check()
    })
  const flush = async (gen = 1): Promise<void> => {
    const before = replies.length
    worker.postMessage({ kind: 'lambda-tree', gen, step: 0, budget: 1 } satisfies RunRequest)
    await wait('the flush', (rs) => rs.slice(before).some((r) => r.kind === 'lambda-tree'))
  }
  return { worker, replies, wait, flush }
}

/** The `clif-listing` replies that carry no listing: each a CLIF pass saying why it has none. */
const refusals = (replies: readonly RunReply[]): Reply<'clif-listing'>[] =>
  ofKind(replies, 'clif-listing').filter((r) => r.listing === null)

/** The `clif-listing` of a stepper that threw under `epoch`. */
const threw = (epoch: number): RunReply => ({ kind: 'clif-listing', gen: 1, epoch, listing: null, error: THROWN })

/** A CLIF request for generation 1. */
const clif = (epoch: number, listing: Listing | null): RunRequest => ({ kind: 'clif', gen: 1, epoch, listing })

/** `fact` run with the as-built listing until its CLIF leg has ended and every reply of the pass is in. */
async function recordedFact(s: Heard): Promise<void> {
  s.worker.postMessage(run(FACT, 'as-built'))
  await s.wait("the CLIF leg's end", (rs) => doneOf(rs, 'clif') !== undefined)
  await s.flush()
}

// AN ABORT NO REQUEST SPENT IS DROPPED AFTER EACH CASE, since it would abort the next `pkg-clif` request any later case,
// or any file in this tab, makes.
afterEach(() => commands.failRequests(MATCH, 0))

describe('the CLIF pass', () => {
  it(
    'records nothing and loads nothing for a run with no CLIF view',
    async () => {
      await commands.watchRequests('start', MATCH)
      const s = listen()
      try {
        s.worker.postMessage(run(FACT, null))
        await s.wait('λ, rxm and TM stopped, and the result', (rs) => settled(rs))
        expect(ofKind(s.replies, 'clif-load')).toEqual([])
        expect(ofKind(s.replies, 'clif-listing')).toEqual([])
        expect(chunksOf(s.replies, 'clif')).toEqual([])
        const [compiled] = ofKind(s.replies, 'compiled')
        expect(compiled?.statuses.clif.available).toBe(false)
        expect(compiled?.first.clif).toBeNull()
        const watched = await commands.watchRequests('read', MATCH)
        expect(watched?.page).toEqual([])
        expect(watched?.context).toEqual([])
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'records the CLIF leg after the result, from step 0',
    async () => {
      const s = listen()
      try {
        s.worker.postMessage(run(FACT, 'as-built'))
        await s.wait("the CLIF leg's end", (rs) => doneOf(rs, 'clif') !== undefined)
        // THE CLIF PASS POSTS ITS `result` RIGHT AFTER ITS LAST CHUNK, in the same task, so it is in by the flush.
        await s.flush()
        const [compiled] = ofKind(s.replies, 'compiled')
        expect(compiled?.statuses.clif.available).toBe(true)
        const firstResult = s.replies.findIndex((r) => r.kind === 'result')
        const firstListing = s.replies.findIndex((r) => r.kind === 'clif-listing')
        expect(firstResult).toBeGreaterThanOrEqual(0)
        expect(firstResult).toBeLessThan(firstListing)
        const [listing] = ofKind(s.replies, 'clif-listing')
        expect(listing?.error).toBeNull()
        expect(listing?.listing?.rows).toHaveLength(187)
        const chunks = chunksOf(s.replies, 'clif')
        expect(chunks.flatMap((c) => c.frames.map((f) => f.step))).toEqual(Array.from({ length: 190 }, (_, i) => i))
        expect(chunks.at(-1)?.done).toBe('ended')
        const lastChunk = s.replies.lastIndexOf(chunks.at(-1) as RunReply)
        const after = ofKind(s.replies.slice(lastChunk), 'result')
        expect(after).toHaveLength(1)
        expect(after[0]?.legs.clif).toEqual({
          status: { available: true, reason: '', run: 'Ended', cap: null, total_steps: 189 },
          value: { Value: { text: '24' } },
        })
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    "leaves the other legs' frames as they were",
    async () => {
      const without = listen()
      const shown = listen()
      try {
        without.worker.postMessage(run(FACT, null))
        shown.worker.postMessage(run(FACT, 'as-built'))
        await Promise.all([
          without.wait('λ, rxm and TM stopped, and the result', (rs) => settled(rs)),
          shown.wait("the CLIF leg's end", (rs) => settled(rs) && doneOf(rs, 'clif') !== undefined),
        ])
        const [compiledWithout] = ofKind(without.replies, 'compiled')
        const [compiledShown] = ofKind(shown.replies, 'compiled')
        for (const leg of COPY_LEGS) {
          expect(compiledShown?.first[leg], leg).toEqual(compiledWithout?.first[leg])
          expect(chunksOf(shown.replies, leg), leg).toEqual(chunksOf(without.replies, leg))
        }
      } finally {
        without.worker.terminate()
        shown.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    "says why a program has no CLIF after the run's own result, with no worker error",
    async () => {
      const s = listen()
      try {
        s.worker.postMessage(run(LIST, 'as-built'))
        await s.wait('the CLIF listing', (rs) => rs.some((r) => r.kind === 'clif-listing'))
        const [compiled] = ofKind(s.replies, 'compiled')
        const reason = compiled?.statuses.rxm.reason
        expect(reason).not.toBe('')
        expect(ofKind(s.replies, 'clif-listing')).toEqual([
          { kind: 'clif-listing', gen: 1, epoch: 0, listing: null, error: reason },
        ])
        expect(ofKind(s.replies, 'worker-error')).toEqual([])
        // THE RUN'S OWN ANSWER CAME FIRST: the λ and TM legs decline this list too, each for its own nesting guard, so
        // what the other legs ran is the `result` that says so.
        const result = s.replies.findIndex((r) => r.kind === 'result')
        expect(result).toBeGreaterThanOrEqual(0)
        expect(result).toBeLessThan(s.replies.findIndex((r) => r.kind === 'clif-listing'))
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'reports a failed load and leaves the other legs running',
    async () => {
      await commands.failRequests(MATCH, 1)
      const s = listen()
      try {
        s.worker.postMessage(run(FACT, 'as-built'))
        await s.wait("the CLIF load's answer", (rs) => rs.some((r) => r.kind === 'clif-load' && r.state !== 'loading'))
        const [started, load] = ofKind(s.replies, 'clif-load')
        expect(started?.state).toBe('loading')
        expect(load?.state).toBe('failed')
        expect(load?.error ?? '').not.toBe('')
        expect(settled(s.replies)).toBe(true)
        expect(ofKind(s.replies, 'worker-error')).toEqual([])
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'a recompile while the CLIF pass loads leaves nothing of the old generation',
    async () => {
      await commands.holdRequests(MATCH)
      const s = listen()
      try {
        try {
          s.worker.postMessage(run(FACT, 'as-built', 1))
          await s.wait("generation 1's result", (rs) => rs.some((r) => r.kind === 'result' && r.gen === 1))
          s.worker.postMessage(run(FACT, 'as-built', 2))
          await s.wait("generation 2's compiled", (rs) => rs.some((r) => r.kind === 'compiled' && r.gen === 2))
          // THE CASE'S PRECONDITION: the load generation 1's pass began is still pending, held above.
          expect(ofKind(s.replies, 'clif-load').map((r) => r.state)).toEqual(['loading'])
        } finally {
          await commands.releaseRequests()
        }
        await s.wait("generation 2's CLIF leg's end", (rs) => doneOf(rs, 'clif', 2) !== undefined)
        await s.flush(2)
        const compiled2 = s.replies.findIndex((r) => r.kind === 'compiled' && r.gen === 2)
        const stale = s.replies
          .slice(compiled2)
          .filter((r) => (r.kind === 'clif-listing' || (r.kind === 'frames' && r.leg === 'clif')) && r.gen === 1)
        expect(stale).toEqual([])
        expect(doneOf(s.replies, 'clif', 2)).toBe('ended')
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )
})

describe('the CLIF requests', () => {
  it(
    "rebuilds the listing and records again under the request's epoch",
    async () => {
      const s = listen()
      try {
        await recordedFact(s)
        const before = s.replies.length
        s.worker.postMessage(clif(1, 'optimised'))
        await s.wait("epoch 1's end", (rs) => clifChunks(rs, 1).some((c) => c.done !== null))
        await s.flush()
        const [listing] = ofKind(s.replies.slice(before), 'clif-listing')
        expect(listing?.epoch).toBe(1)
        expect(listing?.error).toBeNull()
        expect(listing?.listing?.rows).toHaveLength(155)
        const chunks = clifChunks(s.replies, 1)
        expect(chunks.flatMap((c) => c.frames.map((f) => f.step))).toEqual(Array.from({ length: 132 }, (_, i) => i))
        expect(chunks.at(-1)?.done).toBe('ended')
        const at = s.replies.indexOf(listing as RunReply)
        expect(clifChunks(s.replies.slice(at), 0)).toEqual([])
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    "builds for a request sent at compiled only once the run's result is posted",
    async () => {
      const s = listen()
      try {
        // THE PACKAGE IS IN FIRST, so a build that did not wait would be made at once, beside the run's first fills.
        s.worker.postMessage({ kind: 'clif-load', gen: 0 } satisfies RunRequest)
        await s.wait('the CLIF load', (rs) => rs.some((r) => r.kind === 'clif-load' && r.state !== 'loading'))
        s.worker.postMessage(run(FACT, null))
        await s.wait('the compiled', (rs) => rs.some((r) => r.kind === 'compiled'))
        s.worker.postMessage(clif(1, 'as-built'))
        await s.wait("epoch 1's end", (rs) => settled(rs) && clifChunks(rs, 1).some((c) => c.done !== null))
        await s.flush()
        const results = s.replies.flatMap((r, i) => (r.kind === 'result' ? [i] : []))
        const listing = s.replies.findIndex((r) => r.kind === 'clif-listing')
        const firstClif = s.replies.findIndex((r) => r.kind === 'frames' && r.leg === 'clif')
        const lastOther = s.replies.findLastIndex((r) => r.kind === 'frames' && r.leg !== 'clif')
        expect(results).toHaveLength(2)
        expect(results[0]).toBeLessThan(listing)
        expect(lastOther).toBeLessThan(firstClif)
        expect(results[1]).toBeGreaterThan(s.replies.findLastIndex((r) => r.kind === 'frames' && r.leg === 'clif'))
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'ignores a request of an epoch already taken',
    async () => {
      const s = listen()
      try {
        await recordedFact(s)
        const before = s.replies.length
        s.worker.postMessage(clif(1, 'optimised'))
        s.worker.postMessage(clif(1, 'optimised'))
        await s.wait("epoch 1's end", (rs) => clifChunks(rs, 1).some((c) => c.done !== null))
        // THE FLUSH IS READ AFTER BOTH REQUESTS, so a second build, which would post its listing as it is read, is in.
        await s.flush()
        expect(ofKind(s.replies.slice(before), 'clif-listing')).toHaveLength(1)
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'stops the old recording when it rebuilds for another listing',
    async () => {
      const s = listen()
      try {
        s.worker.postMessage(run(LOOP, 'as-built'))
        await s.wait("the CLIF leg's first chunk", (rs) => clifChunks(rs, 0).length > 0)
        s.worker.postMessage(clif(1, 'optimised'))
        await s.wait("epoch 1's end", (rs) => clifChunks(rs, 1).some((c) => c.done !== null))
        expect(
          clifChunks(s.replies, 0).every((c) => c.done === null),
          'precondition: the fill as built was cut off, not finished',
        ).toBe(true)
        const listing = s.replies.findIndex((r) => r.kind === 'clif-listing' && r.epoch === 1)
        expect(listing).toBeGreaterThanOrEqual(0)
        expect(clifChunks(s.replies.slice(listing), 0)).toEqual([])
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    "posts the new listing's CLIF part after a rebuild, not the old listing's end",
    async () => {
      const s = listen()
      try {
        s.worker.postMessage(run(LOOP_SHORT, 'optimised'))
        await s.wait("epoch 0's result", (rs) => passResult(rs, 0))
        // THE CASE'S PRECONDITION: the old listing's run ended, so the last `result` holds a decided CLIF part.
        expect(ofKind(s.replies, 'result').at(-1)?.legs.clif.status.run).toBe('Ended')
        const before = s.replies.length
        s.worker.postMessage(clif(1, 'as-built'))
        await s.wait("epoch 1's result", (rs) => passResult(rs, 1))
        expect(clifChunks(s.replies, 1).at(-1)?.done).toBe('budget')
        expect(ofKind(s.replies.slice(before), 'result').at(-1)?.legs.clif).toEqual({
          status: { available: true, reason: '', run: 'Running', cap: null, total_steps: null },
          value: 'Unfinished',
        })
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'drops the stepper for a request with no listing',
    async () => {
      const s = listen()
      try {
        s.worker.postMessage(run(LOOP, 'as-built'))
        await s.wait("the CLIF leg's first chunk", (rs) => clifChunks(rs, 0).length > 0)
        const before = s.replies.length
        s.worker.postMessage(clif(1, null))
        s.worker.postMessage({ kind: 'extend', gen: 1, leg: 'clif', epoch: 1 } satisfies RunRequest)
        await new Promise((resolve) => setTimeout(resolve, 1000))
        expect(clifChunks(s.replies, 1)).toEqual([])
        // ONE CHUNK MAY HAVE BEEN ON ITS WAY: the worker can post another while the request crosses to it.
        expect(clifChunks(s.replies.slice(before), 0).length).toBeLessThanOrEqual(1)
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'loads on intent and records nothing',
    async () => {
      await commands.watchRequests('start', MATCH)
      const s = listen()
      try {
        s.worker.postMessage({ kind: 'clif-load', gen: 0 } satisfies RunRequest)
        await s.wait('the CLIF load', (rs) => rs.some((r) => r.kind === 'clif-load' && r.state !== 'loading'))
        expect(ofKind(s.replies, 'clif-load')).toEqual([
          { kind: 'clif-load', state: 'loading' },
          { kind: 'clif-load', state: 'ready' },
        ])
        const watched = await commands.watchRequests('read', MATCH)
        expect(watched?.page.length).toBeGreaterThan(0)
        expect(ofKind(s.replies, 'frames')).toEqual([])
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'loads on the next ask after a failed load',
    async () => {
      await commands.failRequests(MATCH, 1)
      const s = listen()
      try {
        s.worker.postMessage(run(FACT, 'as-built'))
        await s.wait("the CLIF load's answer", (rs) => rs.some((r) => r.kind === 'clif-load' && r.state !== 'loading'))
        const [, failed] = ofKind(s.replies, 'clif-load')
        expect(failed?.state).toBe('failed')
        expect(settled(s.replies)).toBe(true)
        const before = s.replies.length
        s.worker.postMessage(clif(1, 'as-built'))
        await s.wait('the CLIF listing', (rs) => rs.slice(before).some((r) => r.kind === 'clif-listing'))
        expect(ofKind(s.replies.slice(before), 'clif-load')).toEqual([
          { kind: 'clif-load', state: 'loading' },
          { kind: 'clif-load', state: 'ready' },
        ])
        const [listing] = ofKind(s.replies.slice(before), 'clif-listing')
        expect(listing?.listing?.rows).toHaveLength(187)
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )
})

/**
 * A stepper that throws is dropped and the CLIF view told why, and the session and its other legs go on. **EVERY CASE
 * ENDS ON A FLUSH**: `wait` rejects on a `worker-error`, and only a live session answers the flush's `lambda-tree`.
 */
describe('a CLIF stepper that throws', () => {
  // A CASE THAT FAILS BEFORE ITS WORKER LOADS LEAVES ITS STUB, which would answer the next load, another file's too.
  afterEach(() => commands.stubRequest(MATCH, null))

  it(
    'says why when its listing throws',
    async () => {
      await commands.stubRequest(MATCH, throwing('listing', 0))
      const s = listen()
      try {
        s.worker.postMessage(run(FACT, 'as-built'))
        await s.wait('the CLIF pass to say why', (rs) => refusals(rs).length > 0)
        await s.flush()
        expect(ofKind(s.replies, 'clif-listing')).toEqual([threw(0)])
        expect(chunksOf(s.replies, 'clif')).toEqual([])
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  // `status` ANSWERS ONCE FIRST, for the recording's end, so both throw as the pass's `result` is read.
  for (const [method, after] of [
    ['value', 0],
    ['status', 1],
  ] as const)
    it(
      `posts the result with no CLIF part when its ${method} throws as the result is read`,
      async () => {
        await commands.stubRequest(MATCH, throwing(method, after))
        const s = listen()
        try {
          s.worker.postMessage(run(FACT, 'as-built'))
          await s.wait("the CLIF pass's result", (rs) => passResult(rs, 0))
          await s.flush()
          // THE CASE'S PRECONDITION: the recording reached the run's end, so the throw was not the recording's.
          expect(doneOf(s.replies, 'clif')).toBe('ended')
          expect(refusals(s.replies)).toEqual([threw(0)])
          const results = ofKind(s.replies, 'result')
          expect(results).toHaveLength(2)
          expect(s.replies.indexOf(results[1] as RunReply)).toBeGreaterThan(
            s.replies.indexOf(refusals(s.replies)[0] as RunReply),
          )
          expect(results[1]?.legs).toEqual({ ...results[0]?.legs, clif: CLIF_ABSENT })
        } finally {
          s.worker.terminate()
        }
      },
      CASE_MS,
    )

  it(
    'says why when it throws as its first fill records',
    async () => {
      await commands.stubRequest(MATCH, throwing('step', 3))
      const s = listen()
      try {
        s.worker.postMessage(run(FACT, 'as-built'))
        await s.wait('the CLIF pass to say why', (rs) => refusals(rs).length > 0)
        await s.flush()
        const listings = ofKind(s.replies, 'clif-listing')
        expect(listings).toHaveLength(2)
        expect(listings[0]?.listing?.rows).toHaveLength(187)
        expect(listings[1]).toEqual(threw(0))
        // THE THROW CAME IN THE FIRST CHUNK, which is posted whole or not at all, and no `result` follows from the
        // pass.
        expect(chunksOf(s.replies, 'clif')).toEqual([])
        expect(ofKind(s.replies, 'result')).toHaveLength(1)
        // THE STEPPER IS DROPPED: an extend finds nothing to step, where a stepper kept would throw again and say so.
        s.worker.postMessage({ kind: 'extend', gen: 1, leg: 'clif', epoch: 0 } satisfies RunRequest)
        await s.flush()
        expect(refusals(s.replies)).toHaveLength(1)
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'says why when its status throws as an extend asks where the run stopped, before it records',
    async () => {
      await commands.stubRequest(MATCH, throwing('status', 1))
      const s = listen()
      try {
        s.worker.postMessage(run(LOOP_SHORT, 'as-built'))
        await s.wait("epoch 0's result", (rs) => passResult(rs, 0))
        // THE CASE'S PRECONDITION: the fill stopped on its budget, which reads no status, so the one answer went to the
        // pass's `result` and the extend's first read throws.
        expect(doneOf(s.replies, 'clif')).toBe('budget')
        expect(refusals(s.replies)).toEqual([])
        s.worker.postMessage({ kind: 'extend', gen: 1, leg: 'clif', epoch: 0 } satisfies RunRequest)
        await s.wait('the extend to say why', (rs) => refusals(rs).length > 0)
        await s.flush()
        expect(refusals(s.replies)).toEqual([threw(0)])
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'says why when its rewind throws, before the fill is recorded again',
    async () => {
      await commands.stubRequest(MATCH, throwing('rewind', 0))
      const s = listen()
      try {
        await recordedFact(s)
        expect(refusals(s.replies)).toEqual([])
        s.worker.postMessage({ kind: 'rewind', gen: 1, leg: 'clif', epoch: 1 } satisfies RunRequest)
        await s.wait('the rewind to say why', (rs) => refusals(rs).length > 0)
        await s.flush()
        expect(refusals(s.replies)).toEqual([threw(1)])
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'posts no CLIF part in a result read while a loop is in flight on the stepper that threw',
    async () => {
      await commands.stubRequest(MATCH, throwing('status', 2))
      const s = listen()
      try {
        s.worker.postMessage(run(LOOP_SHORT, 'as-built'))
        await s.wait("epoch 0's result", (rs) => passResult(rs, 0))
        // THE CASE'S PRECONDITIONS: the last `result` holds the stepper's part, which a leg in flight keeps, and the
        // rxm leg has ended, so an extend of it records nothing and posts its `result` in the task that reads it.
        expect(ofKind(s.replies, 'result').at(-1)?.legs.clif.status.available).toBe(true)
        expect(doneOf(s.replies, 'rxm')).toBe('ended')
        const before = s.replies.length
        // THE CLIF EXTEND READS THE STATUS A SECOND TIME AND RECORDS; the rxm extend's `result` reads it a third.
        s.worker.postMessage({ kind: 'extend', gen: 1, leg: 'clif', epoch: 0 } satisfies RunRequest)
        s.worker.postMessage({ kind: 'extend', gen: 1, leg: 'rxm', epoch: 0 } satisfies RunRequest)
        await s.wait('a result after the stepper threw', (rs) => {
          const at = rs.findIndex((r) => r.kind === 'clif-listing' && r.listing === null)
          return at >= 0 && rs.slice(at).some((r) => r.kind === 'result')
        })
        await s.flush()
        const after = s.replies.slice(before)
        const refused = after.findIndex((r) => r.kind === 'clif-listing')
        expect(after[refused]).toEqual(threw(0))
        // THE CASE'S PRECONDITION: the CLIF extend's loop was in flight, a chunk posted and its end not reached.
        const chunks = clifChunks(after.slice(0, refused), 0)
        expect(chunks.length).toBeGreaterThan(0)
        expect(chunks.every((c) => c.done === null)).toBe(true)
        expect(ofKind(after.slice(refused), 'result')[0]?.legs.clif).toEqual(CLIF_ABSENT)
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )
})
