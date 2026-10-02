import { beforeAll, describe, expect, it } from 'vitest'
import { EXAMPLE_ENCODING, EXAMPLES, type Example, type Outcome } from '../../src/examples'
import { LEGS } from '../../src/legs'
import type { Leg, RecordEnd, RunReply } from '../../src/protocol'

/**
 * **EVERY LEG OF EVERY EXAMPLE STOPS WHERE THE MANIFEST DECLARES** — Plan 7 part 6a spec §4.6, which amends umbrella
 * §5's "λ and TM agree on its value within budget". Under the app's own history budget that cannot hold for `fact(4)`
 * and `fact(12)`, whose λ legs fill their history before a value, so the manifest declares how each leg's first
 * recording stops and this holds each of those stops and the value: an example cannot rot unnoticed.
 *
 * **WHAT IS HELD IS EACH LEG'S STOP AND THE VALUE, NOT THE DESCRIPTION'S WORDS.** A description says where a leg stops
 * early, and nothing here reads it: one that no longer said what its outcomes are would pass. It is kept in step with
 * them by hand.
 *
 * **THE REAL WORKER, ONE `run` PER EXAMPLE**, as `worker.test.ts` asks it: a fresh `session-worker.ts`, the example's
 * text under the default encoding, every reply until `result`. A declined leg is one `compiled` says is unavailable;
 * an ended leg and a leg whose history fills are its last frames reply's `done`, `ended` or `budget`.
 *
 * **A FAILURE HERE CAN BE A TRUE ONE: A CHANGE IN A FRAME'S SIZE CAN FLIP A LEG'S STOP.** Measured under `binary` on
 * 2026-10-01 (spec §4.6's note of that date): `map` and `fold`'s TM records 69,008 of its 91,785 steps before its
 * history fills, 75.2% of its run, and `sum_to(5)`'s λ ends having spent 22,004,386 bytes, 65.6% of `HISTORY_BYTES`.
 * A leg that flips has its outcome in the manifest changed, and the example's description with it, by hand.
 */

type Compiled = Extract<RunReply, { kind: 'compiled' }>
type Result = Extract<RunReply, { kind: 'result' }>

/** What one run said: whether each leg was built, how each leg's first recording stopped, and the run's values. */
type Heard = { readonly compiled: Compiled; readonly done: Record<Leg, RecordEnd | null>; readonly result: Result }

/** Bounded below vitest's 30 s hook timeout, so a run that never answers is named here rather than by vitest. */
const RUN_MS = 20_000

function run(example: Example): Promise<Heard> {
  const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
  const done: Record<Leg, RecordEnd | null> = { lambda: null, asm: null, tm: null }
  let compiled: Compiled | null = null
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error(`${example.id}: no result after ${RUN_MS} ms`))
    }, RUN_MS)
    const end = (settle: () => void): void => {
      clearTimeout(timer)
      worker.terminate()
      settle()
    }
    worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
      const r = e.data
      if (r.kind === 'compiled') compiled = r
      else if (r.kind === 'lambda-frames') done.lambda = r.done
      else if (r.kind === 'asm-frames') done.asm = r.done
      else if (r.kind === 'tm-frames') done.tm = r.done
      else if (r.kind === 'result') {
        const c = compiled
        end(() =>
          c === null
            ? reject(new Error(`${example.id}: a result with no compiled`))
            : resolve({ compiled: c, done, result: r }),
        )
      } else if (r.kind === 'no-session' || r.kind === 'worker-error') {
        end(() => reject(new Error(`${example.id}: ${r.kind}`)))
      }
    })
    // A WORKER THAT FAILS TO LOAD, OR THROWS, IS NAMED BY ITS OWN ERROR, rather than by the timeout above twenty seconds
    // later. Cancelled, so the page does not report it a second time as an error nothing handled.
    worker.addEventListener('error', (e) => {
      e.preventDefault()
      const what = e instanceof ErrorEvent && e.message !== '' ? e.message : 'the worker did not load'
      end(() => reject(new Error(`${example.id}: ${what}`)))
    })
    worker.postMessage({ kind: 'run', gen: 1, src: example.text, encoding: EXAMPLE_ENCODING })
  })
}

/** How a leg's first recording stopped, in the manifest's words, or what it did instead. */
function stopOf(heard: Heard, leg: Leg): Outcome | string {
  if (!heard.compiled[leg].available) return 'declined'
  const done = heard.done[leg]
  if (done === 'ended') return 'ended'
  if (done === 'budget') return 'history-full'
  return `stopped on ${done}`
}

describe.each(EXAMPLES)('$title', (example) => {
  let heard: Heard

  beforeAll(async () => {
    heard = await run(example)
  })

  it('stops each leg where the manifest says', () => {
    expect({ lambda: stopOf(heard, 'lambda'), asm: stopOf(heard, 'asm'), tm: stopOf(heard, 'tm') }).toEqual(
      example.outcomes,
    )
  })

  it("carries the manifest's value on every leg with a value to carry", () => {
    for (const leg of LEGS) {
      const value = heard.result[leg].value
      if (example.outcomes[leg] === 'declined') expect(value, leg).toBeNull()
      // A λ LEG THAT FILLS ITS HISTORY HAS NOTHING TO HOLD: it has not reached its normal form.
      else if (leg === 'lambda' && example.outcomes[leg] === 'history-full') expect(value, leg).toBe('Unfinished')
      // AN ENDED LEG, AND A TM OR ASM LEG WHOSE HISTORY FILLS: `compile` runs those two legs to their end, so both
      // carry the run's own value, and the legs that end agree on it.
      else expect(value, leg).toEqual({ Value: { text: example.value } })
    }
  })
})
