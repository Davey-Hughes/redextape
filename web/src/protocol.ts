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
 *
 * **THIS IS THE KNOB design §4.4 NAMES — "one knob (bytes per leg)" — AND 5d-i T9 DID NOT MOVE IT.**
 * That task was a measurement; what it measured is below, and it changes what the number means
 * without changing the number.
 *
 * IT BOUNDS TWO DIFFERENT THINGS AT TWO DIFFERENT SITES, AND ONLY ONE OF THEM IS MEMORY.
 * `session-worker.ts:97`'s `allowance` bounds bytes PRODUCED — the worker posts each batch and clears
 * it, so it retains none of them. `main.ts:653`/`:659` construct the two `History` rings that bound
 * bytes RETAINED. They happen to be the same constant, which is why the plan's "one session is
 * already 64 MB" is true, but it is `main.ts`'s two rings and not `session-worker.ts:97` that make it
 * true. The two come apart on `[continue]`: `onExtend` (`session-worker.ts:422`) raises the allowance
 * to `recorded + HISTORY_BYTES` every click, so production is unbounded across clicks — while the
 * ring's budget never moves, so retention stays at one `HISTORY_BYTES` per leg however many times the
 * user continues.
 *
 * **THE UNITS ARE THE RING'S ACCOUNTING AND NOT RETAINED HEAP, AND THE TWO LEGS TRADE AT DIFFERENT
 * RATES.** Measured 2026-08-11 by `tests/browser/session-memory.test.ts`, real Chromium, forced
 * collection before every reading, one discarded warm-up and three alternating rounds:
 *
 *   * λ leg — **1.071921708710566**: 6,799,213.33 bytes of retained heap against the 6,343,013
 *     `lambdaFrameBytes` charged for the same 253 frames. `SPAN_BYTES` being rounded up (80 against a
 *     measured 74.08) is most of what keeps this honest.
 *   * TM leg — **2.045480413555839**: 68,635,768 bytes of retained heap against the 33,554,840
 *     `tmFrameBytes` charged for 75,023 retained frames of 75,025 pushed. So a TM leg that actually
 *     spends this budget costs ~68.6 MB of heap for a 33.55 MB allowance. The TM figure reproduced to
 *     the byte across four runs; the λ one varied by ~6,600 bytes in 6.8 million.
 *
 * `tmFrameBytes` (`:258`) charges 2 bytes a cell for a `window: string[][]` whose cells are
 * one-character JS strings, and charges nothing for the per-tape array headers around them or for the
 * ring's own two parallel arrays — `History`'s `#frames` and `#sizes` are 8 bytes an entry each, about
 * 16 B/frame here by arithmetic rather than by separate measurement. **Left as is, and deliberately.**
 * Re-scaling the constant to make its units retained bytes would change every recording length in the
 * app on the strength of one fixture's cell geometry, and the number the design cares about — what
 * three sessions cost against one — is a RATIO, in which a per-leg accounting error that is the same
 * in both arms cancels exactly. See `DROP_HISTORY_ON_UNFOCUS` below for the measurement that used it.
 */
export const HISTORY_BYTES = 32 * 1024 * 1024

/**
 * Drop a leg's history when its pane loses focus. **`false`, and the default was MEASURED rather than
 * argued** — design §4.4, plan 5d-i T9.
 *
 * THE THRESHOLD WAS PRE-REGISTERED BEFORE ANY NUMBER EXISTED: *three sessions at four legs must sit at
 * or below 2x the single-session resident figure the same harness measures today* — above that this
 * flips to `true`, and the threshold does not move. #28's entry is why that sentence was written down
 * first: a threshold quietly retired the first time it binds was never a threshold.
 *
 * **IT IS MET. 1.8160189425298086**, measured 2026-08-11 by `tests/browser/session-memory.test.ts` in
 * real Chromium under `vite.config.ts:150`'s two flags, driving three real `session-worker.ts` threads
 * through a real `SessionPool` into real `History` rings. Mean resident heap over three alternating
 * rounds after one discarded warm-up pair: **92,435,664.67 bytes** for one session at two legs against
 * **167,864,918** for three sessions at four. Round-by-round, one session / three sessions:
 * 92,414,610 / 167,854,526, then 92,441,666 / 167,875,654, then 92,450,718 / 167,864,574. An earlier
 * run of the same file read 1.816478530039582 on a page baseline 46,565 bytes lower — the ratio moves
 * with that baseline and the next paragraph says why.
 *
 * THE PLAN'S ARITHMETIC HELD ON THE HISTORIES, AND THE MEASUREMENT IS WHY THAT IS NOW A FACT RATHER
 * THAN A COUNT. Stripping the harness page's ~17.0 MB baseline leaves what the session machinery
 * itself adds — 75,421,530.67 bytes against 150,836,014.67, a ratio of **1.99990656956171**. Four legs
 * is twice two legs to five significant figures, which is design §4.4's "128 MB: 2x today, not 3x"
 * confirmed in retained bytes instead of in budget bytes. **THE BASELINE-FREE READING HAS NO SIGN AT
 * THIS PRECISION** and that is stated rather than smoothed: four runs of this probe read
 * 2.000012445644004, 1.999953682804821, 1.9999763640919819 and 1.99990656956171 — one of them above 2
 * — straddling it by under a kilobyte in 150 MB while the round-to-round spread of the single-session
 * figure alone is ~7,700 bytes. "At or below 2x" is satisfied by "at", so the verdict is the same on
 * either reading, which is the only reason it was safe to name one.
 *
 * **THE ONE READING THAT MISSES IS THE WASM SIDE, AND THE PLAN COUNTS LEGS WHERE IT SHOULD HAVE
 * COUNTED THREADS.** `usedJSHeapSize` is one V8 isolate's figure and a worker has its own, so the
 * harness the threshold names cannot see a worker at all — an extra worker bound and driven to a
 * result moved the main thread's heap by 11,395 bytes, which is the `Worker` handle and its client and
 * nothing else. Measured in its own units instead: the wasm module baseline is **8,454,144 bytes** and
 * decision 3 (§4.2, one worker per session) pays it **once per thread**. One worker holding a `Session`
 * for the probe fixture is 11,993,088 bytes; three workers holding that `Session`, a `LambdaScratch`
 * (65,536) and a `TmScratch` (0, absorbed by the previous page) are 28,966,912 — a ratio of
 * **2.4153005464480874**. Added to the heap figures: 1.884843254120645 against the resident reading
 * the threshold names, and **2.0568976838107504** against the baseline-free one, which is a miss.
 *
 * **THAT OVERSHOOT DOES NOT FLIP THIS BOOLEAN, AND THE REASON IS NOT THAT THE THRESHOLD NAMED A
 * DIFFERENT READING.** It is that this boolean cannot reach the bytes that overshoot. Dropping an
 * unfocused pane's history frees `History` entries on the main thread; the module baseline and the
 * session arena live in a worker and are unchanged by whether the main thread kept a frame. Flipping
 * it `true` here would apply a remedy to a cost it provably cannot reduce — the same standard §4.5
 * applies to a linking affordance in a detached pane. The remedy for three module baselines is fewer
 * threads or one shared instance, and decision 3 bought those bytes deliberately, for damage
 * containment; whoever revisits that decision inherits this number.
 *
 * **NOTHING READS THIS YET, AND THAT IS THE POINT OF WRITING IT DOWN.** There is no pane-focus model
 * in the tree — 5c's "focus" is the running redex, not a pane — so the behaviour this gates belongs to
 * whichever task first has an unfocus event. What T9 owed was the decision and its evidence, so that
 * task inherits both instead of re-deriving a default from an argument.
 *
 * **AND IT STAYS ONE BOOLEAN WITH NO USER-FACING CONTROL** (§4.4). Three modes would triple the
 * wording of *"recording stopped, history is full at step N"* for a switch nobody has evidence anyone
 * wants. A control is justified when a measurement shows the policies produce experiences worth
 * choosing between, and this one does not.
 */
export const DROP_HISTORY_ON_UNFOCUS = false

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
   * Build a λ scratchpad from λ TEXT and record its reduction — design §4.3's fork, and **the message
   * plan T7 recorded as the thing standing between the binding model and a second session**: "a
   * `LambdaScratch` session needs a worker message `session-worker.ts` does not have, and creating one
   * on edit is §4.3 = T8."
   *
   * NO `encoding`, UNLIKE `run`, AND THAT IS DECISION 2 ARRIVING ON THE WIRE. An encoding says how a
   * VALUE is decoded, decoding is type-directed, and a `LambdaScratch` has no `ty` to decode against —
   * §3.3 puts `lambdaValue` off the type entirely rather than leaving it to decline. A scratch is
   * stepped and watched, not evaluated, so an `encoding` field here would be a parameter with no
   * reader on either side.
   *
   * λ ONLY, AND A `tm-scratch` VARIANT IS ABSENT BECAUSE NOTHING COULD SEND IT. §4.1's `TmScratch`
   * exists at the boundary (plan T3, `tmScratch(src)` is exported and typed) but the app holds no TM
   * TEXT anywhere: the TM pane renders a δ-table projected from a compiled program, not the `.tm`
   * source that would have built one. A request kind no surface can produce is the fabricated-state
   * shape `session.rs:257-273` records the cost of, so the variant lands with the surface that can
   * send it. See `LambdaScratchpad`'s doc in `scratch.ts` for the same line drawn on the session side.
   *
   * **`step` IS WHICH FRAME THE PANE WAS SHOWING, AND THE WORKER REPLAYS TO IT** (design §4.1). It is
   * not an offset into `src`: `src` is the SOURCE session's step-0 term at `LAMBDA_BYTE_BUDGET`, and
   * `step` says how far to reduce it before forking. An edit posts `step: 0`, because the text in the
   * box IS the term — which is why editing needs no message of its own.
   */
  | { kind: 'lambda-scratch'; gen: number; src: string; step: number }
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
  /**
   * The program did not analyze, so there is no session at all.
   *
   * SHARED WITH THE `lambda-scratch` REQUEST, WHICH IS A REUSE AND NOT A STRETCH. `lambdaScratch(src)`
   * answers `{ diagnostics, scratch: null }` for text that did not parse, and "there is nothing to
   * step, and here is why" is the same claim this variant already makes for a program that did not
   * analyze — same shape, same consumer obligation (clear the panes, show the diagnostics). A second
   * `no-scratch` variant would be two names for one state, which is what a renderer then has to switch
   * on twice.
   */
  | { kind: 'no-session'; gen: number; diagnostics: Diagnostic[] }
  /**
   * A λ scratchpad exists — `compiled`'s counterpart for a session with ONE leg and no compile behind
   * it (design §4.1, §4.3).
   *
   * A SEPARATE VARIANT RATHER THAN `compiled` WITH FIVE NULLS, and that is decision 2 restated on the
   * wire. `compiled` carries `tm`, `tmProgram`, `tapeNames`, `declinedSpan` and `linkIndex`; a
   * `LambdaScratch` has no TM leg, no `SourceMap` and no `ty`, so every one of those would be a
   * fabricated field on a message about a session that provably cannot have them — the shape §3.3
   * refuses at the type level and `session.rs:257-273` prices. A consumer that receives this one
   * cannot even ask the wrong question.
   *
   * NO `result` EVER FOLLOWS IT, unlike `compiled`. `result` carries `lambdaLeg(session).value`, which
   * reads `lambdaValue` — the method §3.3 puts off this type. The frames and their `RecordEnd` are the
   * whole answer for a scratchpad; there is no decoded value to arrive later.
   *
   * **`text` IS THE STRING THAT BUILT THE SCRATCH.** The editor is seeded from it rather than from a
   * second print that could disagree, which is what keeps the box, the scratch's step 0 and the term
   * the user forked one object instead of three that agree until they do not.
   *
   * **IT IS NULLABLE DEFENSIVELY AND IS NEVER `null` ON THIS REPLY, and the distinction is worth
   * stating because an earlier version of this comment got it wrong.** The type mirrors
   * `session::ForkedAt`, where `scratch` and `text` are one fact — null together or neither. But
   * `onLambdaScratch` posts `no-session` and returns the moment `scratch` is null, so the only path
   * that reaches `scratch-compiled` has already proved both are present. **Unparseable text and a
   * term over budget do not arrive here as a null `text`; they do not arrive here at all** — they
   * take `no-session`, which carries the diagnostics and has no `text` field. A reader hunting for a
   * live null case on this variant will not find one.
   */
  | { kind: 'scratch-compiled'; gen: number; lambda: LambdaStatus; text: string | null }
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
