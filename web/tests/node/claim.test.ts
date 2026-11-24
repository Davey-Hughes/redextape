import { describe, expect, it } from 'vitest'
import { type Claim, claimLive, liveHandle, type Occupant } from '../../src/claim'
import { LEGS, perLeg } from '../../src/legs'
import { HISTORY_BYTES, type Leg, type RunReply } from '../../src/protocol'
import type { RecordWorker } from '../../src/record-loop'

/**
 * `claimLive`'s and `liveHandle`'s contracts, against fakes that note every call in one log, in the order made. The
 * worker's books start set, so a claim that skipped the reset would leave them set.
 */

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

describe('liveHandle', () => {
  it("answers the session the generation asked for built, and null for another generation's or for none", () => {
    const occupants: [string, Occupant<string> | null][] = [
      ['session', { gen: 1, session: 'session' }],
      ['older session', { gen: 0, session: 'session' }],
      ['nothing', null],
    ]

    const answers = occupants.map(([name, live]) => [name, liveHandle(live, 1)])

    expect(answers).toEqual([
      ['session', 'session'],
      ['older session', null],
      ['nothing', null],
    ])
  })
})
