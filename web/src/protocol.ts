import type { LinkIndexWire } from './link'
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
 * `frame-cost.test.ts` measures it in a real Chromium with a heap differential — the only way to
 * isolate one entry's cost from array overhead and string data. Two runs step the same program
 * (`while4`, ~470 β-steps, 132,882 spans total) identically at `FRAME_BYTES`: run A pushes every full
 * `LambdaState` into a kept-alive array, run B pushes the same frames with `spans` dropped.
 * `(meanA - meanB) / totalSpans`, over three alternating A/B pairs after one discarded warm-up pair,
 * lands at 74.08289058462897 — that value TO THE BYTE across browser restarts, because every reading
 * is taken after a forced collection and so measures retained heap rather than a GC schedule. 80 is
 * that figure rounded up.
 *
 * IT WAS 60, AND 60 UNDER-REPORTED THE RING BY ~19% (corrected 2026-08-10). That figure came from
 * this same test before it collected the heap before each reading. `usedJSHeapSize` counts live
 * objects AND garbage not yet collected, so an uncollected delta is "bytes allocated minus whatever
 * the collector happened to do in that window" — a schedule as much as a size. The SAME build
 * reported 51.9, 74.6 and 91.4 bytes/span purely by varying V8's GC flags, and in the regime where
 * nothing was collected inside the spans-dropped window it reported a NEGATIVE figure. 51.9 was the
 * reading 60 was rounded up from: low, not noisy, and low is the direction that matters, because a
 * sizer that under-reports lets the ring hold more than `HISTORY_BYTES` says it does.
 *
 * THE OLD JSON ESTIMATE WAS ~76, AND IT WAS CLOSER THAN THE ARGUMENT AGAINST IT. That argument is
 * still true as far as it goes: `TokenClass` is one of only 14 string values and V8 interns repeated
 * string literals, so 132,882 entries share a handful of string objects instead of paying for one
 * each, where JSON re-writes the literal in full every time. The sharing is real; it is just smaller
 * than the structural cost of the pair around it — a two-element array with its backing store,
 * wrapping a two-field `Span` object.
 */
export const SPAN_BYTES = 80

/**
 * One `redex_span`: a `Span` object, `{ start, end }`, and charged only by a frame that has one.
 *
 * MEASURED, not estimated, by the same forced-collection differential `SPAN_BYTES` is (2026-08-10):
 * a run retaining `redex_span` alongside `step`/`text`/`cut` against one retaining only those three
 * costs 35.1 bytes per NON-NULL span — the 264 of `while4`'s 471 frames that carry one. 40 is that
 * rounded up, the same way `SPAN_BYTES` rounds up its own measurement.
 *
 * THIS OVERLAPS `SPAN_BYTES`, DELIBERATELY. `SPAN_BYTES`'s own differential drops `redex_span`/`owner`
 * from its slim arm too (see `frame-cost.test.ts`'s `SlimFrame` comment), so its 74.08
 * bytes/span already carries ~0.45 bytes/span of this object's cost — about 127 B/frame at 282
 * spans/frame — and `lambdaFrameBytes` charges this constant again on top, ≈130 B/frame for the same
 * object. Both directions over-report, so the double-charge is safe: ~1% of a ~13 KB frame, left as is
 * rather than reconciled.
 *
 * 35 AGAINST `OWNER_BYTES`'s 16 IS NOT AN INCONSISTENCY BETWEEN THEM. This term was measured and that
 * one is a documented estimate; a two-field object cannot really cost half what a one-field object
 * does, so if anything the figure here says `OWNER_BYTES` is the low one. Left alone regardless —
 * that is one value per frame against a frame's ~10 KB, and re-tuning it is not this term's errand.
 *
 * A FRAME WITHOUT ONE IS CHARGED NOTHING, which is most frames near the start of a run: step 0 has no
 * redex at all, and a redex past the truncation cut records no span (see `LambdaState.redex_span`).
 *
 * THE REDEX **PATH** IS NOT CHARGED AT ALL, because it is not on the wire — `LambdaState.redex` is
 * `serde(skip)`ped until the tree view reads it (see that field's own doc). A `PATH_ENTRY_BYTES` term
 * lived here and charged ~74 B/frame for an array the app never received; it comes back with the field.
 */
export const REDEX_SPAN_BYTES = 40

/**
 * One `Owner`: a small tagged object (`{ Exact: number }` / `{ Within: number }`), or the interned
 * `'None'` string literal. All three cost the same under `serde-wasm-bindgen`'s externally-tagged
 * representation — one JS value, tagged or not — so this is a single flat constant rather than a
 * per-variant one. Rounded up from a bare number's retained cost to cover the wrapping object.
 */
export const OWNER_BYTES = 16

/**
 * Per-frame fixed overhead: the object header and its scalar fields, before any text or cells.
 * Approximate and small — it exists so a frame is never sized at zero, not to be precise.
 */
export const FRAME_OVERHEAD_BYTES = 64

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
  return (
    FRAME_OVERHEAD_BYTES +
    f.text.length +
    f.spans.length * SPAN_BYTES +
    (f.redex_span === null ? 0 : REDEX_SPAN_BYTES) +
    OWNER_BYTES
  )
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
      /**
       * The link index for this compile.
       *
       * NULLABLE DEFENSIVELY, NOT REACHABLY. A session-less compile emits the `no-session` variant
       * instead of `compiled`, so no producer sends `null` here today — `main.ts`'s
       * `reply.linkIndex === null ? null : new LinkIndex(reply.linkIndex)` ternary has no live path to
       * its `null` arm under the current worker. The type stays `| null` and the consumer keeps
       * checking for it anyway: a wire contract that hard-coded today's producer behavior would drop
       * the guard exactly where a future change to `compile` could reopen this path silently.
       *
       * RIDES `compiled` RATHER THAN GETTING ITS OWN MESSAGE, and eagerly rather than on first click.
       * A separate lazy fetch would spare every compile the user never clicks into — but it costs a
       * round trip into a worker measured starved for 4,679 ms during recording, and recording starts
       * the instant this message is posted. See design §4.1.
       *
       * The ten typed arrays inside are TRANSFERRED, not cloned; see the worker's `postMessage`.
       */
      linkIndex: LinkIndexWire | null
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
