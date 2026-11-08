/**
 * The worker's record loop, written once for every leg: step a leg's cursor, post its frames a chunk at a time, and
 * stop at the leg's end, at its allowance, when a newer request replaces what it was stepping, or when a rewind takes
 * its leg back to step 0. `[continue]` records through it by `extendLeg`, and ↺ by `rewindAndRecord`.
 *
 * **HERE AND NOT IN `session-worker.ts`, WHERE THE APP CALLS IT**, for the reason `rxmRecordEnd` gives
 * (`protocol.ts`): the coverage gate cannot see the worker (its own module doc: v8 coverage does not attach to a
 * dedicated worker's context), so a branch written there moves none of the gate's numbers. **ONE LOOP RATHER THAN ONE
 * PER LEG**, which would be the same tokens but for each leg's names, so a fix — the `finally` below is one, for a race
 * over the recording flag — lands once. `tests/node/record-loop.test.ts` holds its contract.
 *
 * **WHAT DIFFERS BY LEG IS A `RecordLeg`, AND WHAT THE LOOP NEEDS OF THE WORKER IS A `RecordWorker`.** A leg and its
 * handle are type parameters, so each leg's pieces are checked against its own wasm type and its own `LegFrame`, and
 * nothing is cast back out of a union of frames. The legs are built in the worker, beside the wasm types they call.
 */
import { LEGS, perLeg } from './legs'
import type { FramesReply, Leg, LegFrame, RecordEnd, RunReply } from './protocol'
import { HISTORY_BYTES, RECORD_CHUNK } from './protocol'

/**
 * One leg's pieces, for `recordLeg`. `K` is the leg, `H` the wasm handle that carries it, and `LegFrame[K]` its frame.
 *
 * **EACH LEG'S OWN END IS ITS OWN.** A λ or TM cursor's `RunStatus` is read by `protocol.ts`'s `endOf`; an rxm
 * cursor's status by `protocol.ts`'s `rxmRecordEnd`, which names a full cap where the other two have none to name.
 */
export type RecordLeg<K extends Leg, H> = {
  /** The leg whose flag, bytes and allowance the loop spends, and which its `frames` replies carry. */
  readonly leg: K
  /**
   * The live handle, when generation `gen` still owns it and its kind has this leg; otherwise `null`.
   *
   * **ASKED AT THE DOOR AND AGAIN BEFORE EVERY CHUNK, NEVER CAPTURED.** A loop suspended at a yield can wake after
   * what it was stepping was freed, and asking again is how it sees that and returns rather than calling into a
   * freed handle.
   */
  handle(gen: number): H | null
  /** Whether the leg compiled: a leg that did not has no cursor to step. */
  available(handle: H): boolean
  /** The frame the cursor stands on now. */
  frame(handle: H): LegFrame[K]
  /** What a frame costs against the leg's allowance. */
  bytes(frame: LegFrame[K]): number
  /** Advance the cursor one step; `false` once it is finished and did not move. */
  step(handle: H): boolean
  /**
   * How the cursor's run ended, read from the leg's status. **ALSO ASKED OF A CURSOR STILL `Running`**, by
   * `extendLeg` after a `budget` stop, which must answer an end other than `capped`, and not throw, so that the stop
   * raises no cap.
   */
  end(handle: H): RecordEnd
  /** Raise the cursor's cap by what one `[continue]` grants (`EXTEND_STEPS`, and `EXTEND_CELLS` on the TM leg). */
  raise(handle: H): void
  /** Take the cursor back to step 0. */
  rewind(handle: H): void
}

/**
 * What the loop needs of the worker: its books, whether a generation still owns what is live, and its two effects.
 *
 * **THE BOOKS ARE THE WORKER'S OWN RECORDS, PASSED BY REFERENCE**, since the worker also writes them: a build resets
 * all four per leg (`resetRecording` below) and `[continue]` raises an allowance before it records further;
 * `rewindAndRecord` below raises a leg's epoch and resets the other three for it.
 */
export type RecordWorker = {
  /**
   * One loop per leg at a time: set by the loop that records the leg and cleared by it, or by a build or a rewind,
   * which hand the leg to a loop of their own.
   */
  readonly recording: Record<Leg, boolean>
  /** Bytes recorded per leg. */
  readonly recorded: Record<Leg, number>
  /** The bytes each leg may record before it stops at `budget`. */
  readonly allowance: Record<Leg, number>
  /** Each leg's epoch, raised by a rewind: a loop whose leg's epoch has moved is stepping a cursor rewound under it. */
  readonly epoch: Record<Leg, number>
  /** Whether generation `gen` still owns what is live, whatever kind it is. */
  owns(gen: number): boolean
  post(reply: RunReply): void
  /** One macrotask, so a newer request can be dispatched between chunks. */
  yieldToEventLoop(): Promise<void>
}

/**
 * Hand every leg's books to a new build: nothing recorded, a full allowance, no loop recording, and epoch 0.
 *
 * **THE `recording` FLAG IS GENERATION-SCOPED BY THIS RESET**, not by its own type: it stops two loops stepping one
 * cursor, and a loop of a superseded generation is not competing for the new one. Clearing it is safe because a
 * build's synchronous prefix runs only once every earlier loop has yielded, and a stale loop that resumes returns at
 * its own generation check without touching the flag (`recordLeg`'s doc).
 */
export function resetRecording(worker: RecordWorker): void {
  for (const leg of LEGS) {
    worker.recorded[leg] = 0
    worker.allowance[leg] = HISTORY_BYTES
    worker.recording[leg] = false
    worker.epoch[leg] = 0
  }
}

/**
 * Step-and-record one leg until it finishes, its allowance runs out, or a build or a rewind replaces what it steps.
 *
 * **RETURNS WHETHER IT RAN.** `false` is a call turned away at the door, before it set the leg's flag: a stale
 * generation, a live handle without this leg, a leg that did not compile, or a loop for this leg already in flight —
 * which is how `onRun` and a concurrent `[continue]`, or two `[continue]`s, both reach here for one generation. The
 * loop in flight posts the frames, and its caller any `result` (a rewind's posts none), so a caller turned away posts
 * none on top. `true` once the loop has run, including when a newer request or a rewind cut it short.
 *
 * **THE ALLOWANCE IS CHECKED BEFORE EACH STEP, NOT AFTER.** A leg whose allowance is spent is not stepped again, so
 * the cursor stays on the last frame recorded and `[continue]` resumes from exactly there; the recorded bytes can pass
 * the allowance by at most the last frame's.
 *
 * **ONLY THE CALL THAT STILL OWNS THIS GENERATION AND THIS EPOCH MAY CLEAR THE FLAG IT SET.** A loop that wakes after
 * being superseded or rewound returns at the chunk check with a newer generation live or its leg's epoch raised, and
 * that build or rewind has reset the flag and its own loop may have set it again; clearing unconditionally would
 * reopen the race the flag exists to close. The two checks ask what the chunk check asks, so such a loop touches
 * nothing on its way out.
 */
export async function recordLeg<K extends Leg, H>(
  leg: RecordLeg<K, H>,
  worker: RecordWorker,
  gen: number,
  emitInitial: boolean,
): Promise<boolean> {
  const held = leg.handle(gen)
  if (held === null) return false
  if (!leg.available(held)) return false
  if (worker.recording[leg.leg]) return false
  worker.recording[leg.leg] = true
  const epoch = worker.epoch[leg.leg]
  try {
    // A table by leg, so each entry takes only its own leg's reply and `tsc` checks a chunk's leg and frames together;
    // `tsc` refuses a reply generic in its leg posted straight to `worker.post`, which takes the union of replies.
    const post: { readonly [L in Leg]: (reply: FramesReply<L>) => void } = perLeg(
      () => (reply: RunReply) => worker.post(reply),
    )
    let batch: LegFrame[K][] = []
    if (emitInitial) {
      const first = leg.frame(held)
      batch.push(first)
      worker.recorded[leg.leg] += leg.bytes(first)
    }

    for (;;) {
      // Deliberate silence: superseded or rewound mid-loop. The caller who wanted these frames is gone.
      const s = leg.handle(gen)
      if (s === null || worker.epoch[leg.leg] !== epoch) return true
      let done: RecordEnd | null = null
      let n = 0
      while (n < RECORD_CHUNK) {
        if (worker.recorded[leg.leg] >= worker.allowance[leg.leg]) {
          done = 'budget'
          break
        }
        if (!leg.step(s)) {
          done = leg.end(s)
          break
        }
        const f = leg.frame(s)
        batch.push(f)
        worker.recorded[leg.leg] += leg.bytes(f)
        n += 1
      }
      post[leg.leg]({ kind: 'frames', leg: leg.leg, gen, epoch, frames: batch, done })
      batch = []
      if (done !== null) return true
      await worker.yieldToEventLoop()
    }
  } finally {
    if (worker.owns(gen) && worker.epoch[leg.leg] === epoch) worker.recording[leg.leg] = false
  }
}

/**
 * Record a leg further for `[continue]`: raise its cap when its run stopped there, then record on from the frame its
 * cursor stands on. Answers as `recordLeg` does, and turns a stale generation or a live thing without the leg away
 * before it raises anything.
 *
 * **ONLY A `capped` END IS RAISED**, the cursor's own cap (`RecordEnd`'s doc): a `budget` stop is a run still going,
 * which needs only the allowance its caller grants, and every other end is one a raise cannot resume.
 */
export async function extendLeg<K extends Leg, H>(
  leg: RecordLeg<K, H>,
  worker: RecordWorker,
  gen: number,
): Promise<boolean> {
  const held = leg.handle(gen)
  if (held === null) return false
  if (leg.end(held) === 'capped') leg.raise(held)
  return recordLeg(leg, worker, gen, false)
}

/**
 * The worker's `onRewind` for one leg: its books handed to epoch `epoch`, its cursor rewound, and its first fill
 * recorded. **`hold` RUNS BEFORE THE CURSOR GOES BACK**, so that what it reads is the part the leg stood at; it is the
 * worker's, since what it reads and keeps are the worker's.
 */
export async function rewindAndRecord<K extends Leg, H>(
  leg: RecordLeg<K, H>,
  worker: RecordWorker,
  gen: number,
  epoch: number,
  hold: () => void,
): Promise<void> {
  const held = leg.handle(gen)
  if (held === null || !leg.available(held)) return
  // A state the page cannot reach, since it raises the epoch as it posts: checked as `onExtend` checks its epoch, so
  // that it holds whoever posts it, as `tests/browser/worker.test.ts` does.
  if (epoch <= worker.epoch[leg.leg]) return
  worker.epoch[leg.leg] = epoch
  worker.recording[leg.leg] = false
  hold()
  leg.rewind(held)
  worker.recorded[leg.leg] = 0
  worker.allowance[leg.leg] = HISTORY_BYTES
  await recordLeg(leg, worker, gen, true)
}
