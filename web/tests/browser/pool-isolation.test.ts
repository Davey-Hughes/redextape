import { describe, expect, it } from 'vitest'
import type { RunReply } from '../../src/protocol'
import type { ClientPort, SessionId } from '../../src/session-client'
import { SessionPool } from '../../src/session-client'

/**
 * POOL ISOLATION — decision 3's whole claim (design §2, §4.2), which a single-worker pool fails. Everything else about
 * `SessionPool` (the map, the throw, the per-session generation) is satisfied by a pool that hands the same thread to
 * everyone; `tests/node/session-pool.test.ts` covers that logic and cannot see this.
 *
 * THE MECHANISM IS NOT A DEEP PRINT. §5 asks to "poison one session's worker with a deep print and
 * assert the other two still step", and the poison it names is the one `depth-cap.test.ts`'s
 * second case guards against: an aborted print would leave wasm-bindgen's reentrancy borrow taken,
 * and every later call on that module would throw. It is not reachable through this protocol.
 * `MAX_PRINT_DEPTH` caps every print a session makes — the two big-budget ones and the per-frame
 * `lambdaState(FRAME_BYTES)` alike — so a deep term reports a `Depth` cut instead of aborting, and a
 * test written around that mechanism would assert nothing.
 *
 * SO THIS DRIVES THE DAMAGE THAT IS REACHABLE, which is stronger than the deep print because it does not depend on
 * how deep a print the engine survives: **co-tenancy is not survivable at all.** `session-worker.ts` holds ONE live
 * session and frees it at the top of every `run` (`dropLive`, called before `compile`). Two sessions sharing a thread
 * therefore do not merely share damage — the second compile frees the first session's handle out from under a record
 * loop still posting frames for it. §4.2 names that invariant as the reason decision 3 is safe; this is that sentence
 * as an assertion.
 *
 * Section and decision citations here are the 5d-i design's unless they name another.
 */

const SOURCE: SessionId = 'source'
const SECOND: SessionId = 'second'
const THIRD: SessionId = 'third'

/**
 * A pool over REAL `session-worker.ts` threads, and every worker it has spawned in spawn order.
 *
 * `workers` IS WHAT A TEST ENDS: the pool keeps its threads for the page's life, so a test terminates each one it
 * spawned.
 */
function realPool(): { pool: SessionPool; workers: Worker[] } {
  const workers: Worker[] = []
  const pool = new SessionPool(
    (): ClientPort => {
      const w = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
      workers.push(w)
      return w
    },
    () => {},
  )
  return { pool, workers }
}

/**
 * Bind `id` and return a `run` that resolves on that session's next TERMINAL reply.
 *
 * TERMINAL IS `result`/`no-session`/`worker-error` AND NOT THE FIRST MESSAGE, the same rule
 * `worker.test.ts`'s `askAll` follows: one generation produces `compiled`, then frame batches,
 * then `result`, so a helper that resolved on the first reply would test only `compiled` and would
 * pass on a pool whose sessions never finish.
 *
 * THE TIMEOUT IS PER RUN AND NAMES ITS SESSION. Left to the `it` timeout instead, a shared-worker
 * pool fails as an anonymous 30-second stall — the failure this file exists to report would arrive
 * with no indication of which session starved, which is the whole question.
 */
function open(pool: SessionPool, id: SessionId) {
  const seen: RunReply[] = []
  let settle: ((r: RunReply) => void) | null = null
  const client = pool.bind(id, (r) => {
    seen.push(r)
    if (r.kind === 'result' || r.kind === 'no-session' || r.kind === 'worker-error') {
      const s = settle
      settle = null
      s?.(r)
    }
  })
  const run = (src: string, timeoutMs = 40_000): Promise<RunReply> =>
    new Promise<RunReply>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${id}: no terminal reply for \`${src}\` in ${timeoutMs}ms; saw [${kinds(seen)}]`)),
        timeoutMs,
      )
      settle = (r) => {
        clearTimeout(timer)
        resolve(r)
      }
      client.request(client.supersede(), src, 'unary')
    })
  return { run, seen }
}

const kinds = (rs: RunReply[]): string => rs.map((r) => r.kind).join(',')

/**
 * The λ leg's decoded answer, or a legible description of whatever arrived instead.
 *
 * A STRING RATHER THAN A NARROWED ASSERTION so a failure reads as `worker-error: null pointer passed
 * to rust` next to the expected `42`, instead of `undefined` next to `{ Value: … }`. Under a shared
 * worker the interesting information is entirely in what the wrong reply says.
 */
function answer(r: RunReply): string {
  if (r.kind === 'worker-error') return `worker-error: ${r.message}`
  if (r.kind !== 'result') return `unexpected reply: ${r.kind}`
  const v = r.legs.lambda.value
  // `typeof v === 'object'` BEFORE the `in`, because `Decoded` is not all objects — `'Unfinished'`,
  // `'Undecodable'` and `'TooLargeToPrint'` are bare string members (`types.ts`'s header records this),
  // and `in` does not narrow a union that still admits a primitive. All three fall through to the
  // `undecoded:` arm, which is the right home for them here: this helper exists to make a WRONG reply
  // legible, and "the λ leg never finished" is exactly that rather than a shape to destructure.
  return typeof v === 'object' && v !== null && 'Value' in v ? v.Value.text : `undecoded: ${JSON.stringify(v)}`
}

describe('SessionPool isolation', () => {
  // Three sessions, three programs, three answers, in flight together. Every request is
  // posted before any reply is awaited — sequencing them would let a shared worker finish each
  // session before the next one clobbered it, and pass.
  //
  // THE PROGRAMS ANSWER DIFFERENTLY ON PURPOSE. Three sessions running `let x = 40; x + 2` would all
  // report 42 even if one worker served all three by freeing the other two, so the discriminator has
  // to be the value and not the shape of the reply.
  it('runs three sessions at once and each answers for its own program', { timeout: 120_000 }, async () => {
    const { pool, workers } = realPool()
    try {
      const source = open(pool, SOURCE)
      const second = open(pool, SECOND)
      const third = open(pool, THIRD)
      expect(pool.size).toBe(3)
      // Three DISTINCT threads. The cheapest possible statement of decision 3, and the first thing a
      // shared-worker pool fails — kept above the behavioural assertions so a failure here says
      // "there is one worker" rather than leaving that to be inferred from three wrong answers.
      expect(new Set(workers).size).toBe(3)

      const [a, b, c] = await Promise.all([
        source.run('let x = 40; x + 2'),
        second.run('let x = 1; x + 2'),
        third.run('let x = 8; x + 8'),
      ])

      expect(answer(a)).toBe('42')
      expect(answer(b)).toBe('3')
      expect(answer(c)).toBe('16')
      // Each session recorded its OWN frames rather than merely receiving a correct final value: a
      // reply stream carrying another session's frames is the shared-worker failure one step before
      // it reaches the decoded answer.
      for (const s of [source, second, third]) {
        expect(s.seen.filter((r) => r.kind === 'compiled').length, kinds(s.seen)).toBe(1)
        expect(
          s.seen.some((r) => r.kind === 'frames' && r.leg === 'lambda'),
          kinds(s.seen),
        ).toBe(true)
      }
    } finally {
      for (const w of workers) w.terminate()
    }
  })
})
