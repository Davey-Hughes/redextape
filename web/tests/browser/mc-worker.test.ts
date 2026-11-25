import { afterEach, describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { EXAMPLE_ENCODING, EXAMPLES } from '../../src/examples'
import type { Listing, McTarget, RunReply, RunRequest } from '../../src/protocol'

/**
 * The session worker's machine code requests (machine code panel design §6, *Loading* and *Building*), heard from a
 * real worker as `clif-worker.test.ts` hears its CLIF pass: an `mc-load` says where a package's load stands and
 * builds nothing; an `mc` of the live generation is answered once, after the run's `result`, with the rows, a decline
 * in the lowering's words, or a trap that says it is one; a `clif` request taken while an `mc`'s package is still
 * loading does not wait for it, and one taken after an `mc` whose package is in lists after that `mc`'s answer; an `mc`
 * of a generation no longer live is answered by nothing.
 */

/**
 * x86-64's package: its module and its wasm, the module asked for first. **ONE MATCH FOR EVERY PLAN**: a context's
 * route for one match lets its request go without asking a route for another (`vite.config.ts`'s `planFor`).
 */
const MATCH = 'pkg-mc-x86-64/redextape_mc_wasm'

const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
/** `clif-worker.test.ts`'s list, which the rxm leg declines, so `clifInput()` gives no input. */
const LIST = `[${Array.from({ length: 2048 }, (_, i) => i).join(', ')}]`

/** Each case's own bound, past every wait in it. */
const CASE_MS = 60_000
/** A wait's bound, under `CASE_MS`, so that a reply never heard is named rather than timed out by vitest. */
const WAIT_MS = 45_000

/** A module served for x86-64's: the package itself, loaded under another URL, whose `machineCode` traps. */
const TRAPPING = `
const real = await import(new URL('?real', import.meta.url).href)
export default real.default
export function machineCode() {
  throw new WebAssembly.RuntimeError('unreachable')
}
`

const run = (src: string, clif: Listing | null, gen = 1): RunRequest => ({
  kind: 'run',
  gen,
  src,
  encoding: EXAMPLE_ENCODING,
  clif,
})
const load = (target: McTarget = 'x86-64'): RunRequest => ({ kind: 'mc-load', gen: 1, target })
const mc = (gen = 1, listing: Listing = 'as-built', target: McTarget = 'x86-64'): RunRequest => ({
  kind: 'mc',
  gen,
  target,
  listing,
})

type Reply<K extends RunReply['kind']> = Extract<RunReply, { kind: K }>
const ofKind = <K extends RunReply['kind']>(replies: readonly RunReply[], kind: K): Reply<K>[] =>
  replies.filter((r): r is Reply<K> => r.kind === kind)

/** A fresh session worker, every reply it posts, a wait on them that names what it waited for, and a flush. */
function listen() {
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
        settle(new Error(`${what}: not heard in ${WAIT_MS} ms; heard ${replies.map((r) => r.kind).join(', ')}`))
      }, WAIT_MS)
      checks.add(check)
      check()
    })
  /** Every reply posted before the worker took this: a `lambda-tree` of `gen`, which it answers at once. */
  const flush = async (gen = 1): Promise<void> => {
    const before = replies.length
    worker.postMessage({ kind: 'lambda-tree', gen, step: 0, budget: 1 } satisfies RunRequest)
    await wait('the flush', (rs) => rs.slice(before).some((r) => r.kind === 'lambda-tree'))
  }
  return { worker, replies, wait, flush }
}

const answered =
  (gen = 1) =>
  (rs: readonly RunReply[]) =>
    rs.some((r) => r.kind === 'mc' && r.gen === gen)
const compiled =
  (gen = 1) =>
  (rs: readonly RunReply[]) =>
    rs.some((r) => r.kind === 'compiled' && r.gen === gen)
const loadSaid = (rs: readonly RunReply[]) => rs.some((r) => r.kind === 'mc-load' && r.state !== 'loading')

describe('the machine code requests', () => {
  // A CASE THAT FAILS BEFORE ITS WORKER LOADS LEAVES ITS STUB OR ITS ABORT, which would answer or abort the next load,
  // another file's too.
  afterEach(async () => {
    await commands.stubRequest(MATCH, null)
    await commands.failRequests(MATCH, 0)
  })

  it(
    'answers an mc of the live generation once, after the run’s result, with its rows',
    async () => {
      const s = listen()
      try {
        s.worker.postMessage(run(FACT, null))
        s.worker.postMessage(load())
        await s.wait('the compile', compiled())
        s.worker.postMessage(mc())
        await s.wait('the mc answer', answered())
        await s.flush()
        const [reply, ...more] = ofKind(s.replies, 'mc')
        expect(more, 'one answer').toEqual([])
        expect(reply?.code?.rows.length ?? 0, 'rows').toBeGreaterThan(0)
        expect(reply?.trapped).toBe(false)
        const result = s.replies.findIndex((r) => r.kind === 'result')
        expect(result, 'the run’s result').toBeGreaterThanOrEqual(0)
        expect(s.replies.indexOf(reply as RunReply), 'the answer after the result').toBeGreaterThan(result)
        expect(ofKind(s.replies, 'mc-load').map((r) => r.state)).not.toContain('failed')
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'answers no mc of a generation no longer live, and the live one’s',
    async () => {
      const s = listen()
      try {
        s.worker.postMessage(run(FACT, null, 1))
        s.worker.postMessage(load())
        await s.wait('the load', loadSaid)
        s.worker.postMessage(run(FACT, null, 2))
        await s.wait('generation 2’s compile', compiled(2))
        s.worker.postMessage(mc(1))
        s.worker.postMessage(mc(2))
        await s.wait('generation 2’s answer', answered(2))
        await s.flush(2)
        expect(ofKind(s.replies, 'mc').map((r) => r.gen)).toEqual([2])
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'says a failed load, and answers nothing for an mc whose load failed',
    async () => {
      await commands.failRequests(MATCH, 1)
      const s = listen()
      try {
        s.worker.postMessage(run(FACT, null))
        await s.wait('the compile', compiled())
        s.worker.postMessage(mc())
        await s.wait('the failed load', loadSaid)
        await s.flush()
        const said = ofKind(s.replies, 'mc-load')
        expect(said.map((r) => r.state)).toEqual(['loading', 'failed'])
        expect(said[1]?.error ?? '', 'the failure says why').not.toBe('')
        expect(ofKind(s.replies, 'mc'), 'no answer').toEqual([])
        expect(ofKind(s.replies, 'worker-error')).toEqual([])
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'loads on the mc-load Retry posts after a failed one, and then answers',
    async () => {
      await commands.failRequests(MATCH, 1)
      const s = listen()
      try {
        s.worker.postMessage(run(FACT, null))
        s.worker.postMessage(load())
        await s.wait('the failed load', loadSaid)
        s.worker.postMessage(load())
        await s.wait('the second load', (rs) => ofKind(rs, 'mc-load').some((r) => r.state === 'ready'))
        expect(ofKind(s.replies, 'mc-load').map((r) => r.state)).toEqual(['loading', 'failed', 'loading', 'ready'])
        await s.wait('the compile', compiled())
        s.worker.postMessage(mc())
        await s.wait('the mc answer', answered())
        expect(ofKind(s.replies, 'mc')[0]?.code?.rows.length ?? 0).toBeGreaterThan(0)
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'answers a program the lowering declines with the decline’s words, as the clif pass does',
    async () => {
      const s = listen()
      try {
        s.worker.postMessage(run(LIST, 'as-built'))
        s.worker.postMessage(load())
        await s.wait('the compile', compiled())
        s.worker.postMessage(mc())
        await s.wait('the mc answer', answered())
        await s.wait('the clif pass’s refusal', (rs) => rs.some((r) => r.kind === 'clif-listing'))
        const reply = ofKind(s.replies, 'mc')[0]
        const refusal = ofKind(s.replies, 'clif-listing')[0]
        expect(refusal?.listing, 'precondition: the clif pass declines it').toBeNull()
        expect(reply?.code).toBeNull()
        expect(reply?.trapped).toBe(false)
        expect(reply?.error ?? '').not.toBe('')
        expect(reply?.error).toBe(refusal?.error)
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  it(
    'answers a trap as a trap, not as the program’s decline, and goes on',
    async () => {
      await commands.stubRequest(MATCH, TRAPPING)
      const s = listen()
      try {
        s.worker.postMessage(run(FACT, null))
        s.worker.postMessage(load())
        await s.wait('the compile', compiled())
        s.worker.postMessage(mc())
        await s.wait('the mc answer', answered())
        await s.flush()
        const reply = ofKind(s.replies, 'mc')[0]
        expect(reply?.code).toBeNull()
        expect(reply?.trapped, 'the answer says it trapped').toBe(true)
        expect(reply?.error).toBe('unreachable')
        expect(ofKind(s.replies, 'worker-error')).toEqual([])
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  /**
   * Held, the package's fetch keeps the `mc` waiting for its package while the `clif` request after it is taken: the
   * listing ships today, and must never wait on a download.
   */
  it(
    'answers a clif request taken while an mc’s package is still loading without waiting for that package',
    async () => {
      const s = listen()
      try {
        s.worker.postMessage(run(FACT, 'as-built'))
        await s.wait('the as-built listing', (rs) => rs.some((r) => r.kind === 'clif-listing'))
        await commands.holdRequests(MATCH)
        try {
          s.worker.postMessage(mc(1, 'optimised'))
          s.worker.postMessage({ kind: 'clif', gen: 1, epoch: 1, listing: 'optimised' } satisfies RunRequest)
          await s.wait('the optimised listing', (rs) => rs.some((r) => r.kind === 'clif-listing' && r.epoch === 1))
          expect(
            ofKind(s.replies, 'mc-load').map((r) => r.state),
            'precondition: the package still loading as the listing came',
          ).toEqual(['loading'])
        } finally {
          await commands.releaseRequests()
        }
        await s.wait('the mc answer once the package is in', answered())
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )

  /**
   * **A SWITCHED LISTING'S CODE LANDS BEFORE THE LISTING** (§6, *Building*): the page asks for the code first, on a
   * target whose package is in, so that the panel changes in the frame the listing does. Taken before the run's
   * `result`, both requests wait on it, and from the `result` on only the `clif` request's wait for the `mc` taken
   * before it (`onMc`) keeps that order; taken after the `result`, the `mc` is answered in the task that took it.
   * fact's λ leg fills its history between `compiled` and `result`, the time these requests are taken in. **THE WAIT
   * TAKEN AWAY IS SEEN ONLY ONCE THE `mc`'S PATH FROM THE `result` IS THE LONGER**: while the two are as long, the order
   * the worker took them in keeps the `mc` first.
   */
  it(
    'answers an mc whose package is in before the listing of a clif request taken after it, both before the run’s result',
    async () => {
      const s = listen()
      try {
        s.worker.postMessage(run(FACT, 'as-built', 1))
        s.worker.postMessage(load())
        await s.wait('the as-built listing', (rs) => rs.some((r) => r.kind === 'clif-listing'))
        await s.wait('the load', loadSaid)
        s.worker.postMessage(run(FACT, null, 2))
        await s.wait('generation 2’s compile', compiled(2))
        // POSTED IN THE TASK THAT HEARD `compiled`. The `lambda-tree` is answered as it is taken, so where its answer
        // falls says whether the two before it were taken before the run's `result`.
        const sent = s.replies.length
        s.worker.postMessage(mc(2, 'optimised'))
        s.worker.postMessage({ kind: 'clif', gen: 2, epoch: 1, listing: 'optimised' } satisfies RunRequest)
        s.worker.postMessage({ kind: 'lambda-tree', gen: 2, step: 0, budget: 1 } satisfies RunRequest)
        await s.wait('the optimised listing', (rs) =>
          rs.some((r) => r.kind === 'clif-listing' && r.gen === 2 && r.epoch === 1),
        )
        await s.wait('the mc answer', answered(2))
        const after = s.replies.slice(sent)
        const at = (heard: (r: RunReply) => boolean): number => after.findIndex(heard)
        const result = at((r) => r.kind === 'result' && r.gen === 2)
        expect(
          ofKind(after, 'mc-load').map((r) => r.state),
          'precondition: x86-64’s package in as the mc was taken',
        ).toEqual(['ready'])
        expect(
          ofKind(after, 'clif-load').map((r) => r.state),
          'precondition: pkg-clif in as the clif request was taken',
        ).toEqual(['ready'])
        expect(result, 'precondition: the run’s result').toBeGreaterThanOrEqual(0)
        expect(
          at((r) => r.kind === 'lambda-tree'),
          'precondition: the mc and the clif request taken before the run’s result',
        ).toBeLessThan(result)
        expect(
          at((r) => r.kind === 'mc'),
          'the mc answered before the listing',
        ).toBeLessThan(at((r) => r.kind === 'clif-listing' && r.epoch === 1))
      } finally {
        s.worker.terminate()
      }
    },
    CASE_MS,
  )
})
