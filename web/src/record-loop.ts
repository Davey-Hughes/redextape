/**
 * The worker's record loop, written once for every leg: step a leg's cursor, post its frames a chunk at a time, and
 * stop at the leg's end, at its allowance, or when a newer request replaces what it was stepping.
 *
 * **HERE AND NOT IN `session-worker.ts`, WHERE ITS ONLY CALLERS ARE**, for `asmRecordEnd`'s and `forkable`'s reason
 * (`protocol.ts`): the worker is outside the coverage gate and no test imports it (its own module doc), so a decision
 * written there is a decision nothing holds. The loop was written there once per leg — λ, TM, then asm — the same
 * tokens but for each leg's names, and it has needed fixing before: the `finally` below is the fix for a race over the
 * recording flag. The next fix would have had to land three times, with nothing to say whether it had.
 * `tests/node/record-loop.test.ts` holds its contract.
 *
 * **WHAT DIFFERS BY LEG IS A `RecordLeg`, AND WHAT THE LOOP NEEDS OF THE WORKER IS A `RecordWorker`.** A leg's handle
 * and frame are type parameters, so each leg's pieces are checked against its own wasm type and its own reply, and
 * nothing is cast back out of a union of frames. The legs are built in the worker, beside the wasm types they call.
 */
import type { Leg, RecordEnd, RunReply } from './protocol'
import { RECORD_CHUNK } from './protocol'

/**
 * One leg's pieces, for `recordLeg`. `H` is the wasm handle that carries the leg and `F` the frame it renders.
 *
 * **EACH LEG'S OWN END IS ITS OWN.** A λ or TM cursor's `RunStatus` is read by `protocol.ts`'s `endOf`; an asm
 * cursor's status by `protocol.ts`'s `asmRecordEnd`, which names a full cap where the other two have none to name.
 */
export type RecordLeg<H, F> = {
  /** The leg whose flag, bytes and allowance the loop spends. */
  readonly leg: Leg
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
  frame(handle: H): F
  /** What a frame costs against the leg's allowance. */
  bytes(frame: F): number
  /** Advance the cursor one step; `false` once it is finished and did not move. */
  step(handle: H): boolean
  /** How a finished cursor's run ended, read from the leg's status. */
  end(handle: H): RecordEnd
  /** The leg's `*-frames` reply, carrying one chunk. */
  reply(gen: number, frames: F[], done: RecordEnd | null): RunReply
}

/**
 * What the loop needs of the worker: its books, whether a generation still owns what is live, and its two effects.
 *
 * **THE BOOKS ARE THE WORKER'S OWN RECORDS, PASSED BY REFERENCE**, since the worker also writes them: a build resets
 * all three per leg, and `[continue]` raises an allowance before it records further.
 */
export type RecordWorker = {
  /** One loop per leg at a time: set by the loop that records the leg, and cleared only by it. */
  readonly recording: Record<Leg, boolean>
  /** Bytes recorded per leg. */
  readonly recorded: Record<Leg, number>
  /** The bytes each leg may record before it stops at `budget`. */
  readonly allowance: Record<Leg, number>
  /** Whether generation `gen` still owns what is live, whatever kind it is. */
  owns(gen: number): boolean
  post(reply: RunReply): void
  /** One macrotask, so a newer request can be dispatched between chunks. */
  yieldToEventLoop(): Promise<void>
}

/**
 * Step-and-record one leg until it finishes, its allowance runs out, or a newer request replaces what it steps.
 *
 * **RETURNS WHETHER IT RAN.** `false` is a call turned away at the door, before it set the leg's flag: a stale
 * generation, a live handle without this leg, a leg that did not compile, or a loop for this leg already in flight —
 * which is how `onRun` and a concurrent `[continue]`, or two `[continue]`s, both reach here for one generation. The
 * loop in flight posts the frames and its own caller the `result`, so a caller turned away must not post one on top.
 * `true` once the loop has run, including when a newer request replaced its handle mid-way.
 *
 * **THE ALLOWANCE IS CHECKED BEFORE EACH STEP, NOT AFTER.** A leg whose allowance is spent is not stepped again, so
 * the cursor stays on the last frame recorded and `[continue]` resumes from exactly there; the recorded bytes can pass
 * the allowance by at most the last frame's.
 *
 * **ONLY THE CALL THAT STILL OWNS THIS GENERATION MAY CLEAR THE FLAG IT SET.** A loop that wakes after being
 * superseded returns at the handle check with a newer generation live, and that generation's build has reset the flag
 * and its own loop may have set it again; clearing unconditionally would reopen the race the flag exists to close.
 * The ownership check is the same question the handle check asks of the generation, so a superseded loop touches
 * nothing on its way out.
 */
export async function recordLeg<H, F>(
  leg: RecordLeg<H, F>,
  worker: RecordWorker,
  gen: number,
  emitInitial: boolean,
): Promise<boolean> {
  const held = leg.handle(gen)
  if (held === null) return false
  if (!leg.available(held)) return false
  if (worker.recording[leg.leg]) return false
  worker.recording[leg.leg] = true
  try {
    let batch: F[] = []
    if (emitInitial) {
      const first = leg.frame(held)
      batch.push(first)
      worker.recorded[leg.leg] += leg.bytes(first)
    }

    for (;;) {
      // Deliberate silence: superseded mid-loop. The caller who wanted these frames is gone.
      const s = leg.handle(gen)
      if (s === null) return true
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
      worker.post(leg.reply(gen, batch, done))
      batch = []
      if (done !== null) return true
      await worker.yieldToEventLoop()
    }
  } finally {
    if (worker.owns(gen)) worker.recording[leg.leg] = false
  }
}
