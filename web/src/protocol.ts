import type { Decoded, Diagnostic, LambdaState, LambdaStatus, Span, TmProgram, TmState, TmStatus } from './types'

/**
 * The λ printer's byte budget FOR THE READOUT — the one term a user actually reads.
 *
 * Truncation is shown, not hidden — see `results.ts`. Frames use `FRAME_BYTES` instead, and the two
 * being different is a measured decision, not an oversight: see `FRAME_BYTES`.
 */
export const LAMBDA_BYTE_BUDGET = 65_536

/**
 * The λ printer's byte budget FOR A HISTORY FRAME.
 *
 * MEASURED, and the measurement moved it two orders of magnitude below the readout's budget
 * (`frame_cost_probe`, 2026-08-07). Dropping from 65,536 to 512 made rendering 10-31x faster and
 * frames ~22x smaller — `while4` went 59.67 -> 5.77 us/step and 229,528 -> 10,123 bytes/frame;
 * `list60` went 230.91 -> 7.40 us and 252,084 -> 11,464. `print_lambda_capped` short-circuits at the
 * budget, so speed and memory move together rather than trading against each other.
 *
 * The thousandth term nobody will look at does not need the budget the first one gets.
 */
export const FRAME_BYTES = 512

/**
 * The tape window's radius. MEASURED FLAT ON TIME: `TmState::window` costs 0.12-0.18 us/step at
 * radius 10 and at radius 80 alike, so this is a legibility and memory choice and nothing else.
 * 40 costs ~550 bytes a frame against 20's ~350, and the wider window is worth the 200 bytes.
 */
export const TM_RADIUS = 40

/**
 * The ring's cap, PER LEG. ~3,200 λ frames at ~10 KB, or ~58,000 TM frames at ~550 B.
 *
 * It is also what bounds RECORDING, because a step count cannot: the probe measured the λ leg at
 * 555 steps and the TM leg at 266,863 for the SAME program (`map_fold`), so one step figure would
 * mean two different things. The worker stops when it has produced this many bytes and says so.
 */
export const HISTORY_BYTES = 32 * 1024 * 1024

/**
 * Steps recorded between worker yields. At `FRAME_BYTES = 512` the λ leg renders in ~4-7 us/step, so
 * 256 steps is one abandon check per ~1.5 ms of recording.
 *
 * NOT `CHUNK_STEPS`, WHICH IS GONE. That was 50,000 β-steps between yields, correct when a chunk was
 * one `runLambda` call and wrong the moment a chunk became 50,000 renders — the yield loop would stop
 * being a yield loop and supersession could not be seen for seconds at a time.
 */
export const RECORD_CHUNK = 256

/**
 * One `(Span, TokenClass)` entry's cost, MEASURED IN THE UNITS IT IS SPENT IN: retained JS heap
 * bytes, not JSON.
 *
 * `frame-cost.test.ts` measured it in a real Chromium with a heap differential — the only way to
 * isolate one entry's cost from array overhead, string data and GC timing. Two runs step the same
 * program (`while4`, ~470 β-steps, 132,882 spans total) identically at `FRAME_BYTES`: run A pushes
 * every full `LambdaState` into a kept-alive array, run B pushes the same frames with `spans` dropped.
 * `(meanA - meanB) / totalSpans`, over three alternating A/B pairs, landed at ~52.8-52.9 bytes/span
 * across repeated runs. 60 is that figure rounded up.
 *
 * THE OLD 80 WAS AN OVER-ESTIMATE, NOT AN UNDER-ESTIMATE — the direction nobody knew until this
 * measurement. It came from ~76 bytes per span AS JSON, and JSON overstates the retained cost here:
 * `TokenClass` is one of only 14 string values, and V8 interns repeated string literals, so 132,882
 * entries share a handful of string objects instead of paying for one each. JSON has no such sharing
 * — it re-writes the literal in full on every entry — so the JSON figure counts bytes the retained
 * object never pays for.
 */
export const SPAN_BYTES = 60

/**
 * Per-frame fixed overhead: the object header and its scalar fields, before any text or cells.
 * Approximate and small — it exists so a frame is never sized at zero, not to be precise.
 */
const FRAME_OVERHEAD_BYTES = 64

/**
 * What one `[continue]` buys. Additive and saturating on the Rust side, so a caller wanting more
 * clicks again.
 */
export const EXTEND_STEPS = 100_000
export const EXTEND_CELLS = 100_000

export type Leg = 'lambda' | 'tm'

/**
 * Why recording stopped. FOUR OUTCOMES, NOT THREE, and conflating any two of them is the trap
 * `session.rs:415` names one layer in ("A SPENT `budget` IS NOT A SPENT CAP"):
 *
 *   * `ended`        — the cursor is exhausted. Nothing to continue.
 *   * `capped`       — the cursor's own cap. `[continue]` raises it.
 *   * `depth-refused`— the depth guard. `raise_cap` REFUSES to clear it, so there is no continue.
 *   * `budget`       — `HISTORY_BYTES`. The run is still `Running` and continuing costs nothing.
 */
export type RecordEnd = 'ended' | 'capped' | 'depth-refused' | 'budget'

/**
 * A λ frame's size in bytes.
 *
 * SPANS ARE ~95% OF IT, at every text budget — `frame_cost_probe` measured 261 bytes of text
 * serializing to 5,621. `LAMBDA_BYTE_BUDGET` bounds `text` and bounds `spans` not at all, which is
 * why the design's first draft was wrong about a frame's maximum size by a factor of twelve.
 */
export function lambdaFrameBytes(f: LambdaState): number {
  return FRAME_OVERHEAD_BYTES + f.text.length + f.spans.length * SPAN_BYTES
}

/** A TM frame's size in bytes. Cells dominate; the two index arrays are `heads` and `window_start`, one number per tape. */
export function tmFrameBytes(f: TmState): number {
  let cells = 0
  for (const tape of f.window) cells += tape.length
  return FRAME_OVERHEAD_BYTES + cells * 2 + f.heads.length * 8 + f.window_start.length * 8
}

export type RunRequest =
  | { kind: 'run'; gen: number; src: string; encoding: string }
  /**
   * Record further. For a `capped` leg the worker raises the cursor cap first; for a `budget` leg it
   * simply allows another `HISTORY_BYTES` and resumes.
   */
  | { kind: 'extend'; gen: number; leg: Leg }

/**
 * `declinedSpan` IS RESOLVED IN THE WORKER, not on the main thread, because `sourceSpan` is a
 * `Session` method and the handle never leaves that thread. `LambdaStatus.node` alone would be
 * useless to a renderer that cannot ask what source range it names.
 */
export type LambdaLeg = {
  status: LambdaStatus
  state: LambdaState | null
  value: Decoded | null
  declinedSpan: Span | null
}
export type TmLeg = { status: TmStatus; value: Decoded | null }

export type RunReply =
  /** The program did not analyze, so there is no session at all. */
  | { kind: 'no-session'; gen: number; diagnostics: Diagnostic[] }
  /**
   * A session exists. Sent BEFORE any recording, so the panes can mount and show their declines
   * while the legs are still being stepped.
   *
   * `tmProgram` IS SENT ONCE, HERE. It is ~123 states for `let x = 40; x + 2` and does not change
   * as the cursor moves; putting it on every frame would send it 2,870 times.
   */
  | {
      kind: 'compiled'
      gen: number
      lambda: LambdaStatus
      tm: TmStatus
      declinedSpan: Span | null
      tmProgram: TmProgram | null
      tapeNames: string[]
    }
  | { kind: 'lambda-frames'; gen: number; frames: LambdaState[]; done: RecordEnd | null }
  | { kind: 'tm-frames'; gen: number; frames: TmState[]; done: RecordEnd | null }
  /**
   * Both legs interrogated after recording finished — what `results.ts` renders. Unchanged in shape
   * from PR 3c so that module needs no edit.
   */
  | { kind: 'result'; gen: number; lambda: LambdaLeg; tm: TmLeg }
  /**
   * The worker threw. EVERY `Session` method and every free export is fallible at the `lib.rs` layer
   * — `to_value` can fail even where `session.rs` cannot — and a throw inside an `async` message
   * handler rejects it with nothing catching, so no reply is posted and the caller waits forever.
   * That is precisely the defect PR 3c shipped. This variant is what makes silence impossible: the
   * handler catches, and the caller always hears something.
   */
  | { kind: 'worker-error'; gen: number; message: string }
