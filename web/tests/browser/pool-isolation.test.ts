import { describe, expect, it } from 'vitest'
import type { RunReply } from '../../src/protocol'
import type { PoolPort, SessionId } from '../../src/session-client'
import { SessionPool } from '../../src/session-client'

/**
 * POOL ISOLATION — decision 3's whole claim (design §2, §4.2), and the one test in this slice that a
 * single-worker pool fails. Everything else about `SessionPool` (the map, the throw, the idempotent
 * unbind, the per-session generation) is satisfied by a pool that hands the same thread to everyone;
 * `tests/node/session-pool.test.ts` covers that logic and cannot see this.
 *
 * THE MECHANISM IS NOT A DEEP PRINT, AND THAT IS A FINDING RATHER THAN A SUBSTITUTION. The plan and
 * §5 both ask for "poison one session's worker with a deep print and assert the other sessions still
 * step", and the poison they name was real — `depth-cap.test.ts`'s second case is the 2026-08-09
 * repro, where an aborted print left wasm-bindgen's reentrancy borrow taken and every later call on
 * that module threw. **IT IS NO LONGER REACHABLE THROUGH THIS PROTOCOL, BECAUSE PR #25 CLOSED IT.**
 * `MAX_PRINT_DEPTH` caps every print a session makes — the two big-budget ones and the per-frame
 * `lambdaState(FRAME_BYTES)` alike — so a deep term reports a `Depth` cut instead of aborting.
 * `session-worker.ts`'s `dropLive` already says so in as many words: "there is no longer an honest way
 * to make `free()` throw through normal input".
 *
 * MEASURED BEFORE BELIEVING IT (2026-08-11), because a design doc asserting a hazard is not evidence
 * the hazard is gone: a real `session-worker.ts` driven with `let x = N; x + 1` at N = 1,500, 2,000
 * and 2,900 answered `compiled / lambda-frames / result` with the λ leg `Ended` at step 7 every time,
 * and the SAME worker then ran `let x = 40; x + 2` to a correct `result` immediately afterwards.
 * Three depths, three fresh workers, no poison and no degradation. A test written around that
 * mechanism would assert nothing.
 *
 * SO THIS DRIVES THE DAMAGE THAT IS REACHABLE, in two halves, and both are stronger than the deep
 * print because neither depends on an engine measurement:
 *
 *   1. **Co-tenancy is not survivable at all.** `session-worker.ts` holds ONE live session and frees
 *      it at the top of every `run` (`dropLive`, called before `compile`). Two sessions sharing a
 *      thread therefore do not merely share damage — the second compile frees the first session's
 *      handle out from under a record loop still posting frames for it. §4.2 names that invariant as
 *      the reason decision 3 is safe; this is that sentence as an assertion.
 *   2. **The cure has to be local.** `terminate` + respawn is the only fix for both findings in
 *      `SessionPool`'s doc — a poisoned module cannot be asked to clean itself up, since `free()`
 *      throws too. On a shared thread the cure is worse than the damage: terminating the scratchpad
 *      takes the source session with it, which is precisely §4.3's retire path killing the thing it is
 *      supposed to return the user to. (That path was recompile-from-source until 5d-ii-c decision 2;
 *      the retire is what terminates a worker, and the trigger is now the control §4.4 ships.)
 */

const SOURCE: SessionId = 'source'
const LAMBDA_SCRATCH: SessionId = 'lambda-scratch'
const TM_SCRATCH: SessionId = 'tm-scratch'

/**
 * A pool over REAL `session-worker.ts` threads, and every worker it has spawned in spawn order.
 *
 * `workers` IS APPEND-ONLY: a terminated worker stays in the list so a test can assert that a later
 * bind produced a NEW thread rather than handing back the dead one.
 */
function realPool(): { pool: SessionPool; workers: Worker[] } {
  const workers: Worker[] = []
  const pool = new SessionPool((): PoolPort => {
    const w = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
    workers.push(w)
    return w
  })
  return { pool, workers }
}

/**
 * Bind `id` and return a `run` that resolves on that session's next TERMINAL reply.
 *
 * TERMINAL IS `result`/`no-session`/`worker-error` AND NOT THE FIRST MESSAGE, the same rule
 * `worker.test.ts`'s `askAll` follows: one generation now produces `compiled`, then frame batches,
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
  const v = r.lambda.value
  // `typeof v === 'object'` BEFORE the `in`, because `Decoded` is not all objects — `'Unfinished'` and
  // `'Undecodable'` are bare string members (`types.ts:51`), and `in` does not narrow a union that
  // still admits a primitive. Both string members fall through to the `undecoded:` arm, which is the
  // right home for them here: this helper exists to make a WRONG reply legible, and "the λ leg never
  // finished" is exactly that rather than a shape to destructure.
  return typeof v === 'object' && v !== null && 'Value' in v ? v.Value.text : `undecoded: ${JSON.stringify(v)}`
}

describe('SessionPool isolation', () => {
  // HALF ONE: three sessions, three programs, three answers, in flight together. Every request is
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
      const lambdaScratch = open(pool, LAMBDA_SCRATCH)
      const tmScratch = open(pool, TM_SCRATCH)
      expect(pool.size).toBe(3)
      // Three DISTINCT threads. The cheapest possible statement of decision 3, and the first thing a
      // shared-worker pool fails — kept above the behavioural assertions so a failure here says
      // "there is one worker" rather than leaving that to be inferred from three wrong answers.
      expect(new Set(workers).size).toBe(3)

      const [a, b, c] = await Promise.all([
        source.run('let x = 40; x + 2'),
        lambdaScratch.run('let x = 1; x + 2'),
        tmScratch.run('let x = 8; x + 8'),
      ])

      expect(answer(a)).toBe('42')
      expect(answer(b)).toBe('3')
      expect(answer(c)).toBe('16')
      // Each session recorded its OWN frames rather than merely receiving a correct final value: a
      // reply stream carrying another session's frames is the shared-worker failure one step before
      // it reaches the decoded answer.
      for (const s of [source, lambdaScratch, tmScratch]) {
        expect(s.seen.filter((r) => r.kind === 'compiled').length, kinds(s.seen)).toBe(1)
        expect(
          s.seen.some((r) => r.kind === 'lambda-frames'),
          kinds(s.seen),
        ).toBe(true)
      }
    } finally {
      for (const id of [SOURCE, LAMBDA_SCRATCH, TM_SCRATCH]) pool.unbind(id)
    }
  })

  // HALF TWO: the cure is local. `terminate` is the only recovery from a poisoned module (see this
  // file's header and `SessionPool`'s doc), and §4.3 fires it from a retire — so a pool where
  // terminating one session stops the others has no recovery path at all, it has a way to kill the
  // app. (This read "on every recompile-from-source", which 5d-ii-c decision 2 ended; a poisoned
  // buffer is now reclaimed by an explicit retire rather than by the next keystroke.)
  //
  // THE SURVIVORS MUST STEP AFTER THE TERMINATE, NOT MERELY BE LISTED. `pool.size` and `pool.has`
  // both stay correct on a shared worker: the map entry survives, the thread under it does not. Only
  // a fresh run through the surviving sessions can tell those apart, which is why each one compiles a
  // DIFFERENT program afterwards and is checked for its own new answer.
  it('terminating one session leaves the others stepping', { timeout: 120_000 }, async () => {
    const { pool, workers } = realPool()
    try {
      const source = open(pool, SOURCE)
      const lambdaScratch = open(pool, LAMBDA_SCRATCH)
      const tmScratch = open(pool, TM_SCRATCH)

      // Everyone healthy first, so a later failure cannot be blamed on a session that never worked.
      expect(answer(await lambdaScratch.run('let x = 1; x + 1'))).toBe('2')

      pool.unbind(LAMBDA_SCRATCH)
      expect(pool.size).toBe(2)
      expect(pool.has(LAMBDA_SCRATCH)).toBe(false)

      const [a, c] = await Promise.all([source.run('let x = 2; x + 3'), tmScratch.run('let x = 9; x + 1')])
      expect(answer(a)).toBe('5')
      expect(answer(c)).toBe('10')

      // AND THE RESPAWN HALF, which is the other side of §4.2's "terminate + respawn resets both":
      // the id is free again and binding it gets a working thread, not the terminated one.
      const reborn = open(pool, LAMBDA_SCRATCH)
      expect(answer(await reborn.run('let x = 20; x + 1'))).toBe('21')
      expect(workers.length).toBe(4)
      expect(new Set(workers).size).toBe(4)
    } finally {
      for (const id of [SOURCE, LAMBDA_SCRATCH, TM_SCRATCH]) pool.unbind(id)
    }
  })
})
