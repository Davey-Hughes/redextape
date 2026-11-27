import { mapLegs } from './legs'
import type { LinkIndexWire } from './link'
import type {
  ClifListing,
  ClifState,
  ClifStatus,
  ClifWindow,
  Decoded,
  Diagnostic,
  LambdaState,
  LambdaStatus,
  McListing,
  McTarget,
  RunStatus,
  RxmProgram,
  RxmState,
  RxmStatus,
  RxmWindow,
  Span,
  TmProgram,
  TmState,
  TmStatus,
} from './types'

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
 * MEASURED (`frame_cost_probe`): at 512 rather than the readout's 65,536, rendering is 10-31x faster and
 * frames ~22x smaller. `print_lambda_capped` short-circuits at the budget, so speed and memory move together
 * rather than trading against each other.
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
 * How much of the rxm machine one frame carries (Plan 7 part 5 spec §5.3): the first 64 locals and 16 arguments, the
 * top 8 call frames, the newest 16 heap cells and 16 boxes, and a halt's newest 64 result cells — plus every cell or
 * box a register the frame shows points at, which `RxmState::window` adds so a back-reference always has its cell.
 *
 * **HERE, NOT IN THE CORE**: how much of the machine fits on screen is a fact about the view, and the core's view
 * model takes it as a parameter (`viewmodel.rs`'s module doc: core never picks a number).
 *
 * **EVERY CORPUS PROGRAM FITS WHOLE** (spec §2.5: at most 23 locals, 3 arguments, a call depth of 7 and 11 heap
 * cells), so the window only cuts a deep or a list-heavy run. The frame sizes these bounds produce are
 * `rxmFrameBytes`'s to charge.
 */
export const RXM_WINDOW: RxmWindow = { locals: 64, args: 16, frames: 8, cells: 16, boxes: 16, result: 64 }

/**
 * How much of a CLIF run one frame carries: the running frame's first 64 values, the top 8 call-stack entries, and the
 * newest 16 cells and 16 boxes, plus each one a value points at, and at a `Ran` end the newest 64 of the returned
 * list's cells. **`RXM_WINDOW`'S NUMBERS**, for its reason: the CLIF view shows the machine the rxm view shows,
 * lowered, so the two windows cut a run at the same depth.
 */
export const CLIF_WINDOW: ClifWindow = { values: 64, frames: 8, cells: 16, boxes: 16, result: 64 }

/**
 * The ring's cap, PER LEG. ~3,200 λ frames at ~10 KB, or ~58,000 TM frames at ~550 B.
 *
 * It is also what bounds RECORDING, because a step count cannot: a program can take far more steps
 * on its TM leg than on its λ leg, so one step figure would mean two different things. The worker
 * stops when it has produced this many bytes and says so.
 *
 * **THIS IS THE KNOB 5d-i design §4.4 NAMES — "one knob (bytes per leg)".**
 *
 * IT BOUNDS TWO DIFFERENT THINGS AT TWO DIFFERENT SITES, AND ONLY ONE OF THEM IS MEMORY.
 * `session-worker.ts`'s `allowance` bounds bytes PRODUCED — the worker posts each batch and clears
 * it, so it retains none of them. The `sessions.add` call in `main.ts` constructs the `History` rings,
 * one per leg, that bound bytes RETAINED. They happen to be the same constant, which is why one session
 * of three legs is 96 MB — but it is `main.ts`'s rings and not the worker's `allowance` that make it
 * true. The two come apart on `[continue]`: `onExtend` (`session-worker.ts`) raises the allowance to
 * `recorded + HISTORY_BYTES` every click, so production is unbounded across clicks — while the ring's
 * budget never moves, so retention stays at one `HISTORY_BYTES` per leg, and the newest frame past it
 * (`History`'s `#evict`), however many times the user continues.
 *
 * **THE UNITS ARE THE RING'S ACCOUNTING AND NOT RETAINED HEAP, AND THE λ AND TM LEGS TRADE AT DIFFERENT
 * RATES.** `tests/browser/session-memory.test.ts` reads the retained heap of a λ or TM leg's frames against
 * what its sizer charges for them, in real Chromium after forced collection:
 *
 *   * TM leg — **0.8744705880483015**: 29,342,720.67 bytes of retained heap against the 33,554,840
 *     `tmFrameBytes` charged for 75,023 frames. A tape's window is one string, charged 2 bytes a UTF-16
 *     unit, which V8 holds in one byte a character when every character is Latin-1.
 *   * λ leg — **0.19451407924488462**: 1,233,805.33 bytes against the 6,343,013 `lambdaFrameBytes`
 *     charged for 253 frames. The ring is charged 5.14 bytes for each byte it holds, because `SPAN_BYTES`
 *     is (its doc).
 *
 * A full TM ring retains 29.3 MB (the TM row above).
 *
 * `tmFrameBytes` charges nothing for the ring's own two parallel arrays — `History`'s `#frames` and
 * `#sizes` are 8 bytes an entry each, about 16 B/frame here, and more on a ring that evicts, whose arrays
 * hold up to as many evicted places again as frames kept before each cut (`History`'s `#evict`): about
 * 1.5 MB at most, against the 29.3 MB a full TM ring retains. **Left as is, and deliberately.**
 * Re-scaling the constant to make its units retained bytes would change every recording length in the
 * app on the strength of one fixture's cell geometry, and the number the design cares about — what
 * three sessions cost against one — is a RATIO, in which a per-leg accounting error that is the same
 * in both arms cancels exactly. See `DROP_HISTORY_ON_UNFOCUS` below for the measurement that used it.
 */
export const HISTORY_BYTES = 32 * 1024 * 1024

/**
 * Drop a leg's history when its pane loses focus. **`false`, and the default was MEASURED rather than
 * argued** — 5d-i design §4.4.
 *
 * THE THRESHOLD WAS PRE-REGISTERED BEFORE ANY NUMBER EXISTED: *three sessions at four legs must sit at
 * or below 2x the single-session resident figure the same harness measures today* — above that this
 * flips to `true`, and the threshold does not move: a threshold quietly retired the first time it binds
 * was never a threshold.
 *
 * **IT IS MET.** `tests/browser/session-memory.test.ts`, driving three real `session-worker.ts` threads
 * through a real `SessionPool` into real `History` rings in real Chromium, reads 1.6334 to 1.6336 for
 * three sessions at four legs against one session at two, in mean resident heap. Stripping the harness
 * page's baseline leaves what the session machinery itself adds, and there four legs is twice two legs,
 * which is design §4.4's "128 MB: 2x today, not 3x" confirmed in retained bytes instead of in budget
 * bytes; "at or below 2x" is satisfied by "at".
 *
 * **THE ONE READING THAT MISSES IS THE WASM SIDE, AND THE PLAN COUNTS LEGS WHERE IT SHOULD HAVE
 * COUNTED THREADS.** `usedJSHeapSize` is one V8 isolate's figure and a worker has its own, so the
 * harness the threshold names cannot see a worker at all — an extra worker bound and driven to a
 * result moved the main thread's heap by 11,395 bytes, which is the `Worker` handle and its client and
 * nothing else. Measured in its own units instead: the wasm module baseline is **8,454,144 bytes** and
 * decision 3 (§4.2, one worker per session) pays it **once per thread**. Added to the heap figures, it
 * puts the baseline-free reading above 2, which is a miss.
 *
 * **THAT OVERSHOOT DOES NOT FLIP THIS BOOLEAN, AND THE REASON IS NOT THAT THE THRESHOLD NAMED A
 * DIFFERENT READING.** It is that this boolean cannot reach the bytes that overshoot. Dropping an
 * unfocused pane's history frees `History` entries on the main thread; the module baseline and the session arena live
 * in a worker and are unchanged by whether the main thread kept a frame. Flipping it `true` here would apply a remedy
 * to a cost it provably cannot reduce. The remedy for three module baselines is fewer threads or one shared instance,
 * and decision 3 bought those bytes deliberately, for damage containment; whoever revisits that decision inherits this
 * number.
 *
 * **NOTHING READS THIS, AND THAT IS THE POINT OF WRITING IT DOWN.** No code drops a leg's history when
 * its pane loses focus; whatever first does inherits the decision and its evidence instead of
 * re-deriving a default from an argument.
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
 * A step is a render, so a chunk of 50,000 steps would stop the yield loop being a yield loop:
 * supersession could not be seen for seconds at a time.
 */
export const RECORD_CHUNK = 256

/**
 * One `(Span, TokenClass)` entry's cost, MEASURED IN THE UNITS IT IS SPENT IN: retained JS heap
 * bytes, not JSON.
 *
 * `frame-cost.test.ts` measures a span's cost in a real Chromium with a heap differential, after forced
 * collection, so that it measures retained heap rather than a GC schedule. 80 is 74.08, an entry's cost
 * when a frame's spans crossed as `(Span, TokenClass)` entries, rounded up: a sizer that under-reports
 * lets the ring hold more than `HISTORY_BYTES` says it does.
 *
 * **A SPAN CROSSES AS `SPAN_WIRE_BYTES` BYTES, AND HOLDS 12.56** (`frame-cost.test.ts`): the spans of a
 * frame are one `Uint8Array`. **80 IS KEPT, AND CHARGES A SPAN 6.37 TIMES WHAT IT HOLDS**: it is what
 * decides how many λ frames a history holds, and keeping it keeps that number where it was. A smaller
 * charge would hold more frames in the same `HISTORY_BYTES`; that is a change to how far back a λ view
 * can scrub, not to what a frame costs.
 */
export const SPAN_BYTES = 80

/**
 * The bytes one span takes on the wire: its start, its end and its class's index in `TOKEN_CLASSES`, a little-endian
 * `u32` each (`viewmodel.rs`'s `LambdaState.spans`). `spans.ts`'s `decorationRanges` reads them.
 */
export const SPAN_WIRE_BYTES = 12

/**
 * One `redex_span`: a `Span` object, `{ start, end }`, and charged only by a frame that has one.
 *
 * MEASURED, not estimated, by the same forced-collection differential `SPAN_BYTES` is: 35.1 bytes per
 * NON-NULL span, and 40 is that rounded up, the same way `SPAN_BYTES` rounds up its own measurement.
 *
 * THIS OVERLAPS `SPAN_BYTES`, DELIBERATELY. `SPAN_BYTES`'s own differential drops `redex_span`/`owner`
 * from its slim arm too (see `frame-cost.test.ts`'s `SlimFrame` comment; the third-arm measurement
 * behind ~0.45 is in `docs/superpowers/notes/2026-10-17-code-history-web-tests.md`, under `SlimFrame`),
 * so its 74.08 bytes/span already carries ~0.45 bytes/span of this object's cost — about 127 B/frame at 282
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
 * `serde(skip)`ped, and the tree view marks the contractum through `LambdaTree.contractum`, resolved
 * from the path in the core (see that field's own doc). It would need a charge only if the field went
 * on the wire.
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

export type Leg = 'lambda' | 'rxm' | 'tm' | 'clif'

/**
 * Every leg but CLIF: the legs a compile records at once (`record-loop.ts`'s `recordBuild`). CLIF records only while
 * shown.
 */
export type CopyLeg = Exclude<Leg, 'clif'>

/** A CLIF listing, by the name `ClifSession`'s constructor takes. */
export type Listing = 'as-built' | 'optimised'

/**
 * `v` as a listing, or `null` for anything else: how a stored or linked listing is read, so that only a name
 * `ClifSession`'s constructor takes reaches it.
 */
export const knownListing = (v: unknown): Listing | null => (v === 'as-built' || v === 'optimised' ? v : null)

/**
 * Where the page's `pkg-clif` load stands: not asked for, asked for and not yet answered, in, or failed. **THE
 * PAGE'S, NOT A GENERATION'S**, as the `clif-load` reply that settles it is: the worker keeps the package for every
 * run.
 */
export type ClifLoad = 'idle' | 'loading' | 'ready' | 'failed'

export type { McTarget } from './types'

/**
 * Every `McTarget`, as keys. **A `Record`**, so a target the bindings' union gains is a type error here until it is
 * listed, and so in every list and lookup taken from it.
 */
const MC_TARGET_KEYS: Record<McTarget, null> = { 'x86-64': null, arm64: null }

/** Every `McTarget`, in the order the panel's picker lists them. */
export const MC_TARGETS = Object.keys(MC_TARGET_KEYS) as readonly McTarget[]

/**
 * `v` as a target, or `null` for anything else: how a stored or chosen target is read, as `knownListing` reads a
 * listing, so that no other value becomes a target by default.
 */
export const knownTarget = (v: unknown): McTarget | null => MC_TARGETS.find((t) => t === v) ?? null

/**
 * The frame type each leg records, keyed by the same `Leg` the protocol already speaks.
 *
 * THIS TABLE IS WHAT MAKES ONE GENERIC RESOLVER POSSIBLE. `sessions.ts`'s `legOf` returns `LegState<LegFrame[K]>`, so
 * a `Binding<'lambda'>` resolves to `LegState<LambdaState>` and a `Binding<'tm'>` to
 * `LegState<TmState>` with no narrowing at either call site — the property `Binding`'s own doc
 * is about. Two named resolvers would be the duplication 5d-i design §3.1 refused one layer down.
 */
export type LegFrame = { lambda: LambdaState; rxm: RxmState; tm: TmState; clif: ClifState }

/**
 * Why recording stopped. FOUR OUTCOMES, NOT THREE, and conflating any two of them is the trap
 * `session.rs`'s `run_lambda` names one layer in ("A SPENT `budget` IS NOT A SPENT CAP"):
 *
 *   * `ended`        — the cursor is exhausted. Nothing to continue.
 *   * `capped`       — the cursor's own cap. `[continue]` raises it.
 *   * `depth-refused`— the depth guard. `raise_cap` REFUSES to clear it, so there is no continue.
 *   * `budget`       — `HISTORY_BYTES`. The run is still `Running` and continuing costs nothing.
 *
 * **AND THREE MORE FOR THE RXM LEG, ONE PER CAP A STEP CAP CANNOT HELP** (Plan 7 part 5 spec §8, amendment 10):
 *
 *   * `stack-full`   — the call stack reached its frame cap.
 *   * `heap-full`    — the heap reached its cell cap, or the boxes did.
 *   * `memory-full`  — the words saved across call frames reached their cap.
 *
 * Each is `depth-refused`'s case, not `capped`'s: raising the step cap leaves the machine exactly as full, so there
 * is no continue. A value of its own each, rather than one `refused` with the cap beside it, so the sentence that
 * says which cap, `controls.ts`'s `doneText`, is a switch `tsc` holds to every one.
 */
export type RecordEnd = 'ended' | 'capped' | 'depth-refused' | 'budget' | 'stack-full' | 'heap-full' | 'memory-full'

/**
 * A λ frame's size in bytes.
 *
 * SPANS ARE ~95% OF IT, at every text budget — `frame_cost_probe` measured 261 bytes of text
 * serializing to 5,621. `LAMBDA_BYTE_BUDGET` bounds `text` and bounds `spans` not at all.
 *
 * **A SPAN IS CHARGED `SPAN_BYTES` WHATEVER IT CROSSES AS**: the spans arrive as one byte string, `SPAN_WIRE_BYTES` a
 * span (`spans.ts`), and are counted in spans, so a history holds as many λ frames as it did when they crossed as
 * tuples. A charge, not what the bytes occupy.
 */
export function lambdaFrameBytes(f: LambdaState): number {
  return (
    FRAME_OVERHEAD_BYTES +
    f.text.length +
    Math.floor(f.spans.byteLength / SPAN_WIRE_BYTES) * SPAN_BYTES +
    (f.redex_span === null ? 0 : REDEX_SPAN_BYTES) +
    OWNER_BYTES
  )
}

/**
 * A TM frame's size in bytes. Cells dominate; the two index arrays are `heads` and `window_start`, one number per tape,
 * and a halt's `result` holds two numbers a run.
 *
 * **A TAPE'S WINDOW IS ONE STRING, CHARGED TWO BYTES A UTF-16 UNIT**, so a symbol outside the basic plane is charged
 * four: counted in the string's own length, rather than in cells. A charge, not what the string occupies: V8 holds a
 * Latin-1 string in one byte a character, and a full TM ring retains less than it is charged (`HISTORY_BYTES`). For
 * every symbol in the basic plane the count is the one this function gave when a window was an array of
 * one-character strings, so a history holds as many frames as it did.
 */
export function tmFrameBytes(f: TmState): number {
  let cells = 0
  for (const tape of f.window) cells += tape.length
  const runs = f.result?.length ?? 0
  return FRAME_OVERHEAD_BYTES + cells * 2 + f.heads.length * 8 + f.window_start.length * 8 + runs * 16
}

/**
 * A λ or TM cursor's `RunStatus` as a `RecordEnd`.
 *
 * **`Running` OCCURS, AND MAPS TO `ended`.** `extendLeg` asks a cursor that a `budget` stop left running, and any end
 * but `capped` is what keeps it from raising that cursor's cap; a throw would drop the session at every such
 * `[continue]`. A future `RunStatus` variant lands on `ended` too, rather than a throw: the one end that offers no
 * continue, so a variant nothing here knows cannot offer one that does nothing.
 *
 * **HERE AND NOT IN `session-worker.ts`**, where the app calls it, for `rxmRecordEnd`'s reason below.
 */
export function endOf(run: RunStatus | null): RecordEnd {
  switch (run) {
    case 'Capped':
      return 'capped'
    case 'DepthRefused':
      return 'depth-refused'
    default:
      return 'ended'
  }
}

/**
 * An rxm cursor's status as a `RecordEnd`: `ended` for a halt or a fault, and a cap named.
 *
 * **ONLY THE STEP CAP IS `capped`.** Raising the step cap resumes a run it stopped and does nothing for one the stack,
 * the heap or the saved frames stopped, so each of those is its own end with no continue (Plan 7 part 5 spec §8,
 * amendment 10). A fault is `Ended`, since the run is over, and its text is the leg's value.
 *
 * **EVERY CAP IS AN ARM, AND THERE IS NO `default`.** A cap this `switch` folded in by default would be called
 * `capped` and offered a continue that cannot resume it; with an arm per cap, a cap added to `RxmCap` is a type error
 * here (TS2366) until someone decides what it ends as. A `Capped` status naming no cap cannot occur — `RxmStatus`
 * names one exactly when the run is capped — and reads as the step cap.
 *
 * **HERE AND NOT IN `session-worker.ts`**, where the app calls it: the coverage gate cannot see the worker (that file's
 * module doc: v8 coverage does not attach to a dedicated worker's context), so a branch written there moves none of the
 * gate's numbers. `Running` occurs, at a `budget` stop, and maps to `ended` without throwing, for `endOf`'s reason: so
 * that `extendLeg` raises no cap on a run that was not capped.
 */
export function rxmRecordEnd(status: Pick<RxmStatus, 'run' | 'cap'>): RecordEnd {
  if (status.run !== 'Capped') return 'ended'
  switch (status.cap) {
    case 'Stack':
      return 'stack-full'
    case 'Heap':
      return 'heap-full'
    case 'Mem':
      return 'memory-full'
    case 'Steps':
    case null:
      return 'capped'
  }
}

/**
 * What one word of an rxm frame is charged: an `RxmWord` object, its decimal string and its tag.
 *
 * **MEASURED, AS `SPAN_BYTES` IS, AND ROUNDED UP.** `frame-cost.test.ts`'s `rxm frame cost` case keeps every frame of
 * `upto(200)` — 2,814 frames, 247,091 words — and the same frames with the words dropped, and reads the difference in
 * retained heap after a full collection: 48.23 bytes a word, the same to four places across runs. The difference
 * charges the arrays that hold the words to the words too, which errs high. 52 leaves the margin `SPAN_BYTES`
 * leaves over its own figure, and that case fails if a word ever costs more than this charges, which is the direction
 * that would let the ring keep more than `HISTORY_BYTES`.
 */
export const RXM_WORD_BYTES = 52

/**
 * What one word of a CLIF frame is charged. **A CLIF WORD COSTS MORE THAN AN RXM WORD**: each value is an object
 * holding a word object and an array of register names, and every frame carries its own call stack.
 * `frame-cost.test.ts`'s `clif frame cost` cases hold it with `CLIF_FRAME_BYTES`: they fail if a frame ever keeps more
 * than its charge, the direction that lets the ring keep more than `HISTORY_BYTES`.
 */
export const CLIF_WORD_BYTES = 60

/**
 * What a CLIF frame is charged beside its words and `FRAME_OVERHEAD_BYTES`. **THE PART OF A CLIF FRAME THAT DOES NOT
 * GROW WITH ITS WORDS** (its fields, its arrays, its `at` and `next`) outweighs what a word charge covers on a frame
 * of few values. The smallest multiple of 4 that, with `CLIF_WORD_BYTES`, leaves the `clif frame cost` cases a margin
 * on a program of few words a frame as well as on one of many.
 */
export const CLIF_FRAME_BYTES = 236

/**
 * An rxm frame's size in bytes. **WORDS DOMINATE** — `rr`, the windowed locals and arguments, each shown frame's
 * saved locals, both halves of each cell, each box's content and each cell number in a halt's `result` — and a
 * written bit is charged a byte.
 */
export function rxmFrameBytes(f: RxmState): number {
  let words = 1 + f.locals.length + f.args.length + 2 * f.cells.length + f.boxes.length + (f.result?.shown.length ?? 0)
  for (const frame of f.frames) words += frame.saved.length
  return FRAME_OVERHEAD_BYTES + words * RXM_WORD_BYTES + f.written.length
}

/**
 * A CLIF frame's size in bytes: `CLIF_WORD_BYTES` a word, for each value's word, each of its register names, each
 * call-stack entry, both halves of each cell, each box's content and each cell number in a `Ran` end's `result`.
 * **EACH REGISTER NAME AND EACH CALL-STACK ENTRY IS CHARGED AS A WORD**: left out, a frame of many named values or a
 * deep run would be undercharged, which lets the ring keep more than `HISTORY_BYTES`.
 */
export function clifFrameBytes(f: ClifState): number {
  let words = f.values.length + f.frames.length + 2 * f.cells.length + f.boxes.length + (f.result?.shown.length ?? 0)
  for (const value of f.values) words += value.regs.length
  return FRAME_OVERHEAD_BYTES + CLIF_FRAME_BYTES + words * CLIF_WORD_BYTES
}

/**
 * Each leg's charge for a frame, keyed as `LegFrame` is: what the worker spends against a leg's allowance and the page
 * charges its ring, through one entry, so that the two sides cannot charge a leg's frame differently.
 */
export const LEG_FRAME_BYTES: { readonly [K in Leg]: (frame: LegFrame[K]) => number } = {
  lambda: lambdaFrameBytes,
  rxm: rxmFrameBytes,
  tm: tmFrameBytes,
  clif: clifFrameBytes,
}

/**
 * The most λ nodes a view asks the session worker to lay out (spec §4.5). `while4`'s peak, the largest
 * in the spec's measured corpus, is 9,763; a term past this is drawn as its recorded frame text, with a
 * notice naming its size.
 */
export const LAMBDA_TREE_NODES = 20_000

/**
 * `lambdaTree(step, nodeBudget)`'s object. `redextape-wasm`'s `tree_to_js` builds it by hand, so it has
 * no generated binding and this is its one TypeScript description.
 *
 * COLUMNS, ONE TYPED ARRAY EACH, indexed by node in PRE-ORDER: node 0 is the root and a node's subtree
 * is one index range. `refused` is the term's node count when it exceeded the budget, and every column is
 * then empty. `step` is the step answered, which the worker clamps to what the run has reached.
 */
export type LambdaTreeWire = {
  readonly step: number
  readonly refused: number | null
  readonly kind: Uint8Array
  readonly left: Uint32Array
  readonly right: Uint32Array
  readonly name: Uint32Array
  readonly hint: Uint32Array
  readonly link: Uint32Array
  readonly names: readonly string[]
  readonly nextRedex: number | null
  readonly contractum: number | null
}

export type RunRequest =
  /**
   * Compile and run the source. **`width` IS PRESENT ONLY WHEN PINNED**: the field width every TM run of this compile
   * uses, one of wasm's `fieldWidths()`. Absent, wasm fits the width itself (auto), so an auto request is the same
   * message whether or not its sender knows about widths.
   */
  /**
   * `clif` is the listing a CLIF view shows, `null` when none is shown: the worker builds and records a CLIF stepper
   * only for a run that carries one, once the other legs have posted their `result`, so a compile never waits on it.
   */
  | { kind: 'run'; gen: number; src: string; encoding: string; width?: number; clif: Listing | null }
  /**
   * Record further. For a `capped` leg the worker raises the cursor cap first; for a `budget` leg it
   * simply allows another `HISTORY_BYTES` and resumes. `epoch` is the leg's, as `rewind`'s doc says.
   */
  | { kind: 'extend'; gen: number; leg: Leg; epoch: number }
  /**
   * Take one leg back to step 0 and record its first fill again (hidden-recording spec §5.4), under `epoch`, the
   * leg's count of rewinds and, for the CLIF leg, of `clif` requests, which the page raised as it posted this.
   *
   * **AN EPOCH PER LEG, BESIDE THE GENERATION.** Every frames reply carries the epoch it was recorded under, and each
   * side drops the other's messages of an older epoch for that leg alone: frames a rewind replaced, an `extend` asked
   * before it. A new `gen` cannot say that, since a generation is a build and claiming one resets every leg.
   */
  | { kind: 'rewind'; gen: number; leg: Leg; epoch: number }
  /**
   * The λ tree at `step` for the live session (spec §4.1). NOT A BUILD: it claims no generation and
   * supersedes nothing, and the worker drops a request whose generation is no longer live.
   */
  | { kind: 'lambda-tree'; gen: number; step: number; budget: number }
  /**
   * Load `pkg-clif` and record nothing: the page's intent to show a CLIF view, so that the package is in before the
   * view asks for a stepper. `gen` is the page's current generation, which only the listener's `catch` reads: the
   * load answers `clif-load`, which carries none, and a failed load is said there, never as a `worker-error`.
   */
  | { kind: 'clif-load'; gen: number }
  /**
   * Build generation `gen`'s CLIF stepper again for `listing` and record it from step 0 under `epoch`, or, with
   * `listing` `null`, drop it: a CLIF view shown after the run, the last one hidden, or the listing switched, none of
   * which recompiles. **`epoch` IS THE CLIF LEG'S, AS `rewind`'s IS**, raised by the page as it posts this, so the
   * stepper's frames of an older request are told apart, and a request of an epoch no newer than the leg's is ignored.
   */
  | { kind: 'clif'; gen: number; epoch: number; listing: Listing | null }
  /**
   * Load `target`'s machine code package and build nothing: the page's intent to show that target. Answered by an
   * `mc-load`, as `clif-load` is, whatever generation is live.
   */
  | { kind: 'mc-load'; gen: number; target: McTarget }
  /**
   * Generation `gen`'s machine code on `target` as `listing`. **NOT RECORDED AND NOT KEPT**: the package holds no
   * state, so the worker answers once from the live session's `clifInput()`, after the run's `result` and before any
   * `clif` request posted after it builds, and a request for a generation no longer live is not answered.
   */
  | { kind: 'mc'; gen: number; target: McTarget; listing: Listing }

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
/** The rxm leg's answer after recording: its status and its value — `null` for an absent leg, as TM's. */
export type RxmLeg = { status: RxmStatus; value: Decoded | null }
/**
 * The CLIF part of a `result` while no stepper is built: unavailable, no reason, nothing run. **NO REASON**, since a
 * leg not built has not been refused, and the readout gives such a leg no rows (`results.ts`'s `clifResultRows`).
 */
export const CLIF_ABSENT: RxmLeg = {
  status: { available: false, reason: '', run: null, cap: null, total_steps: null },
  value: null,
}
/**
 * The CLIF status `compiled` carries: available when the rxm leg is and a CLIF view is shown; rxm's reason otherwise.
 * **NOTHING RUN YET**, since the CLIF stepper is built after the reply, from the session `compiled` announces.
 */
export function clifCompileStatus(rxm: RxmStatus, listing: Listing | null): RxmStatus {
  return { available: rxm.available && listing !== null, reason: rxm.reason, run: null, cap: null, total_steps: null }
}

/** A built stepper's part of a `result`: its status with `available: true`, and its value. */
export function clifPart(status: ClifStatus, value: Decoded): RxmLeg {
  return { status: { available: true, reason: '', ...status }, value }
}

/**
 * Each leg's part of a `result`, keyed as `LegFrame` is. **CLIF'S IS THE RXM LEG'S SHAPE**: a `ClifStatus` is an
 * `RxmStatus` without `available` and `reason`, which the worker adds, so the readout words both alike.
 */
export type LegResult = { lambda: LambdaLeg; rxm: RxmLeg; tm: TmLeg; clif: RxmLeg }
/** Every leg's part of a `result`: what the reply carries as `legs`. */
export type ResultLegs = { [K in Leg]: LegResult[K] }

/**
 * The legs a `result` posts: `next`, except that a leg whose value `prev` had decided keeps `prev`'s part while
 * `next`'s value is `Unfinished`. `prev` is what the generation's last `result` posted, `null` before its first.
 *
 * **SO THAT A REWIND DOES NOT TAKE A KNOWN VALUE AWAY** (hidden-recording spec §11 call 6). A rewound cursor stands on
 * step 0 again, and the next `result`, posted after a `[continue]` of any leg, would read `Unfinished` off it. Without
 * a rewind a cursor only moves on, so no decided value meets an `Unfinished` after it and this changes nothing. An
 * undecided part is `next`'s, so an unfinished λ's count of reductions drops back to the rewound recording's.
 *
 * **HERE AND NOT IN `session-worker.ts`**, for `rxmRecordEnd`'s reason: the coverage gate cannot see the worker.
 */
export function keepDecided(prev: ResultLegs | null, next: ResultLegs): ResultLegs {
  if (prev === null) return next
  return mapLegs<ResultLegs>((leg) => keepDecidedPart(prev[leg], next[leg]))
}

/** `keepDecided`'s rule for one part: `prev` when its value is decided and `next`'s is `Unfinished`, else `next`. */
function keepDecidedPart<P extends { readonly value: Decoded | null }>(prev: P, next: P): P {
  return prev.value !== null && prev.value !== 'Unfinished' && next.value === 'Unfinished' ? prev : next
}

/** Each leg's part of a `result`, or `null` for a leg with none: what `keepInFlight` keeps for a leg in flight. */
export type HeldLegs = { [K in Leg]: LegResult[K] | null }

/**
 * The legs a `result` posts: `next`, except that a leg whose recording is in flight keeps its `held` part when it has
 * one, which is what the generation's last `result` posted, or before its first the part a rewind found the leg at.
 *
 * **SO THAT A REWIND'S FILL IS NOT READ MID-WAY.** A rewind posts no `result` (hidden-recording spec §5.2), so a count
 * a `result` of another request read off the rewound cursor mid-fill would stay on the readout until the next
 * `[continue]`. Any other loop in flight is a request's that posts its own `result` when it stops, which reads the leg,
 * so a leg with no part held is read as it stands.
 */
export function keepInFlight(held: HeldLegs, next: ResultLegs, recording: Readonly<Record<Leg, boolean>>): ResultLegs {
  return mapLegs<ResultLegs>((leg) => {
    const part = held[leg]
    return recording[leg] && part !== null ? part : next[leg]
  })
}

/**
 * One chunk of leg `L`'s recording. **ONE MEMBER PER LEG, EACH WITH ITS OWN LEG'S FRAMES**, so a reply narrowed by
 * `kind` passes to a function generic in its leg, which indexes `LEG_FRAME_BYTES` with `leg`, without a cast.
 */
export type FramesReply<L extends Leg = Leg> = {
  [K in L]: { kind: 'frames'; leg: K; gen: number; epoch: number; frames: LegFrame[K][]; done: RecordEnd | null }
}[L]

/**
 * Each leg's step-0 frame, as `compiled` carries it: `null` for a leg that did not compile, which has no cursor to read.
 * **THE LEG'S FIRST `frames` CHUNK STARTS AT STEP 1**, so no step reaches the page twice.
 */
export type FirstFrames = { [K in Leg]: LegFrame[K] | null }

/** Each leg's status at compile time, keyed as `LegFrame` is: what `compiled` carries as `statuses`. */
export type LegStatus = {
  lambda: LambdaStatus
  /** Unavailable only when the program does not lower, including where TM declines it (spec §5.2). */
  rxm: RxmStatus
  tm: TmStatus
  /** `clifCompileStatus`'s: whether the run asked for a CLIF stepper the rxm leg can feed. */
  clif: RxmStatus
}

/**
 * What `compiled` carries as `programs`: the program of each leg that compiles one, which its views are seeded from,
 * `null` for a leg that is unavailable. **NO λ ENTRY**, since the λ leg compiles none; keyed by these legs rather than
 * by `Leg` with a `lambda: never`, so a leg that comes to compile one is added here, and the worker's post fails `tsc`
 * until it sends it.
 */
export type LegProgram = { rxm: RxmCompiled; tm: TmCompiled; clif: ClifCompiled }

/** What a CLIF view is handed: the listing, or why there is none. `null` while it is being built. */
export type ClifCompiled =
  | {
      readonly listing: ClifListing
      /**
       * The listing `listing` is, as the worker built it. **CARRIED WITH THE ROWS, NOT READ FROM THE SWITCH**: while a
       * switch holds the old listing the switch already says the new one, and a view seeded then shows these rows.
       */
      readonly level: Listing
    }
  | { readonly error: string }

/**
 * A session's machine in the form a TM view is handed one: `compiled`'s `programs.tm`, which the session keeps as
 * `SessionEntry.programs.tm`.
 *
 * **`program` AND `tapeNames` ARE `TmPane.setProgram`'s TWO ARGUMENTS, AND THEY ARE ONE VALUE BECAUSE
 * THEY ARE ONLY MEANINGFUL TOGETHER.** `TmProgram` says `tapes: 5` and nothing about what any of them is
 * called; `tapeNames` is what `tapeRows` labels them with. Two nullable fields side by side on the entry
 * would make "a program with no names" and "names with no program" representable states that no producer
 * can produce and no consumer could render — one nullable envelope has exactly the two states the wire has.
 */
export type TmCompiled = {
  readonly program: TmProgram
  readonly tapeNames: string[]
}

/**
 * The rxm listing a session compiled, kept on its entry so that a view built after the reply is seeded from it.
 */
export type RxmCompiled = {
  /** No `states`: a `TmProgram` has every `RxmProgram` field, so without this a TM machine would pass as this one. */
  readonly program: RxmProgram & { readonly states?: never }
}

export type RunReply =
  /**
   * The program did not analyze, so there is no session at all.
   */
  | { kind: 'no-session'; gen: number; diagnostics: Diagnostic[] }
  /**
   * A session exists. Sent BEFORE any recording, so the panes can mount and show their declines
   * while the legs are still being stepped.
   *
   * **IT CARRIES EVERY VIEW'S STEP-0 PICTURE** (recompile-flash design): `first`, each leg's step-0 frame, and
   * `lambdaTree`, the λ term's step-0 tree at `LAMBDA_TREE_NODES`, `null` where the λ leg did not compile. The page
   * replaces the old program's picture with these in the one draw this reply makes; told in later messages, it could
   * paint emptied views between this one and theirs, since a browser may paint between any two.
   *
   * `programs` IS SENT ONCE, HERE. A program does not change as the cursor moves, so putting it on every
   * frame would send the same machine again with each one.
   */
  | {
      kind: 'compiled'
      gen: number
      statuses: { [K in Leg]: LegStatus[K] }
      /**
       * Each leg's program as this compile built it, `null` for a leg that built none: the page keeps it on the
       * session's entry, so a view built after this reply is seeded from it.
       */
      programs: { [K in keyof LegProgram]: LegProgram[K] | null }
      declinedSpan: Span | null
      /**
       * The link index for this compile.
       *
       * NULLABLE DEFENSIVELY, NOT REACHABLY. A session-less compile emits the `no-session` variant
       * instead of `compiled`, so no producer sends `null` here — `replies.ts`'s
       * `reply.linkIndex === null ? null : new LinkIndex(reply.linkIndex)` ternary has no live path to
       * its `null` arm. The type stays `| null` and the consumer keeps checking for it anyway: a wire
       * contract that hard-coded what its producer sends would drop the guard exactly where a future
       * change to `compile` could reopen this path silently.
       *
       * RIDES `compiled` RATHER THAN GETTING ITS OWN MESSAGE, and eagerly rather than on first click.
       * A separate lazy fetch would spare every compile the user never clicks into — but it costs a
       * round trip into a worker measured starved for 4,679 ms during recording, and recording starts
       * the instant this message is posted. See design §4.1.
       *
       * The eleven typed arrays inside are TRANSFERRED, not cloned; see the worker's `postMessage`.
       */
      linkIndex: LinkIndexWire | null
      first: FirstFrames
      /** Its columns are transferred, as `lambda-tree`'s are. */
      lambdaTree: LambdaTreeWire | null
    }
  /** One chunk of a leg's recording, under the leg's epoch when it was recorded (`rewind`'s doc). */
  | FramesReply
  /**
   * Every leg interrogated once a request's recording stopped — what `results.ts` renders. A leg still recording keeps
   * the part last posted for it, or before the generation's first `result` the part a rewind found, where there is one
   * (`keepInFlight`); one whose decided value a rewind took away keeps its last `result`'s (`keepDecided`).
   *
   * `pinned` is whether the `run` request carried a width, so whether the TM leg's `status.width` is the user's choice
   * or auto's fit: the strip marks a pinned width, since with no TM view open there is no width box to show it
   * (the TM width design, decision 23). It is carried with the result, not read from the page's width, because a
   * result on screen can be the previous compile's while a newly chosen width compiles.
   */
  | { kind: 'result'; gen: number; legs: ResultLegs; pinned: boolean }
  /**
   * Where `pkg-clif`'s load stands, posted each time a load is asked for: `loading` as one that must fetch starts, so
   * the page says it is loading only while a load is under way, then `ready` or `failed`. **NO GENERATION**: the worker
   * loads the package once and keeps it for every run after, so its state is not a generation's. **A FAILURE IS NOT A
   * `worker-error`**, which drops the session: the other legs go on, and the next ask loads again.
   */
  | { kind: 'clif-load'; state: 'loading' | 'ready' | 'failed'; error?: string }
  /**
   * The CLIF stepper's listing for generation `gen` at the CLIF leg's `epoch`, posted before its frames; or, with
   * `listing` `null`, why the leg has none: the rxm leg's refusal, the build's sentence, or what a stepper threw, which
   * can follow its listing and its frames and leaves the leg with no stepper. Not a `worker-error`, for `clif-load`'s
   * reason.
   */
  | { kind: 'clif-listing'; gen: number; epoch: number; listing: ClifListing; level: Listing; error: null }
  | { kind: 'clif-listing'; gen: number; epoch: number; listing: null; error: string }
  /** Where `target`'s machine code package's load stands, as `clif-load` says `pkg-clif`'s: no generation. */
  | { kind: 'mc-load'; target: McTarget; state: 'loading' | 'ready' | 'failed'; error?: string }
  /**
   * The answer to an `mc` request: the rows, or with `code` `null`, why there are none: the rxm leg's refusal or the
   * build's sentence, or with `trapped`, the message of the trap the package stopped on, which says nothing of the
   * program. Not a `worker-error`, for `clif-load`'s reason.
   */
  | {
      kind: 'mc'
      gen: number
      target: McTarget
      listing: Listing
      code: McListing | null
      error: string | null
      trapped: boolean
    }
  /** The answer to `lambda-tree`; `tree.step` is the step it answers, clamped to the run. */
  | { kind: 'lambda-tree'; gen: number; tree: LambdaTreeWire }
  /**
   * The worker threw. EVERY `Session` method and every free export is fallible at the `lib.rs` layer
   * — `to_value` can fail even where `session.rs` cannot — and a throw inside an `async` message
   * handler rejects it with nothing catching, so no reply is posted and the caller waits forever.
   * This variant is what makes silence impossible: the handler catches, and the caller always
   * hears something.
   */
  | { kind: 'worker-error'; gen: number; message: string }
