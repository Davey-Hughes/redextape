import { mapLegs } from './legs'
import type { LinkIndexWire } from './link'
import type {
  Decoded,
  Diagnostic,
  LambdaState,
  LambdaStatus,
  RunStatus,
  RxmProgram,
  RxmState,
  RxmStatus,
  RxmWindow,
  Span,
  TmProgram,
  TmScratchStatus,
  TmState,
  TmStatus,
  ValueRun,
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
 * top 8 call frames, and the newest 16 heap cells and 16 boxes — plus every cell or box a register the frame shows
 * points at, which `RxmState::window` adds so a back-reference always has its cell.
 *
 * **HERE, NOT IN THE CORE**: how much of the machine fits on screen is a fact about the view, and the core's view
 * model takes it as a parameter (`viewmodel.rs`'s module doc: core never picks a number).
 *
 * **EVERY CORPUS PROGRAM FITS WHOLE** (spec §2.5: at most 23 locals, 3 arguments, a call depth of 7 and 11 heap
 * cells), so the window only cuts a deep or a list-heavy run. The frame sizes these bounds produce are
 * `rxmFrameBytes`'s to charge.
 */
export const RXM_WINDOW: RxmWindow = { locals: 64, args: 16, frames: 8, cells: 16, boxes: 16 }

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
 * A full TM ring retains 29.3 MB (the TM row above), and a full λ ring 7.9 MB (the source λ ring at exhaustion
 * that `buffer-affordability.test.ts`'s first case prints).
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
 * unfocused pane's history frees `History` entries on the main thread; the module baseline and the
 * session arena live in a worker and are unchanged by whether the main thread kept a frame. Flipping
 * it `true` here would apply a remedy to a cost it provably cannot reduce — the same standard §4.5
 * applies to a linking affordance in a detached pane. The remedy for three module baselines is fewer
 * threads or one shared instance, and decision 3 bought those bytes deliberately, for damage
 * containment; whoever revisits that decision inherits this number.
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

/**
 * Steps a TM buffer's value run takes between yields, so an edit waits at most one chunk to supersede it.
 *
 * **MEASURED, NOT CHOSEN.** `web/tests/browser/tm-buffer-cost.test.ts` measures the step rate this is set from, and
 * one command runs that probe:
 *
 *     cd web && pnpm run test:probe:tm-buffer
 *
 * On `let x = 40; x + 2` reduced through `single-tape`, fifteen chunks of 500,000 steps took 7.6 ms at the median
 * and 7.8 ms at most. One more doubling measured 15.2 ms at the median, past the 10 ms the design allows a chunk.
 */
export const VALUE_CHUNK = 500_000

export type Leg = 'lambda' | 'rxm' | 'tm'

/**
 * The frame type each leg records, keyed by the same `Leg` the protocol already speaks.
 *
 * THIS TABLE IS WHAT MAKES ONE GENERIC RESOLVER POSSIBLE. `sessions.ts`'s `legOf` returns `LegState<LegFrame[K]>`, so
 * a `Binding<'lambda'>` resolves to `LegState<LambdaState>` and a `Binding<'tm'>` to
 * `LegState<TmState>` with no narrowing at either call site — the property `Binding`'s own doc
 * is about. Two named resolvers would be the duplication 5d-i design §3.1 refused one layer down.
 */
export type LegFrame = { lambda: LambdaState; rxm: RxmState; tm: TmState }

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
 * is no continue. A value of its own each, rather than one `refused` with the cap beside it, so the sentences that
 * say which cap — `controls.ts`'s `doneText`, `readout.ts`'s `STOPPED` — are switches `tsc` holds to every one.
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
 * A TM frame's size in bytes. Cells dominate; the two index arrays are `heads` and `window_start`, one number per tape.
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
  return FRAME_OVERHEAD_BYTES + cells * 2 + f.heads.length * 8 + f.window_start.length * 8
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
 * **HERE AND NOT IN `session-worker.ts`**, where the app calls it, as `forkable` is (its call site there says why):
 * the coverage gate cannot see the worker (that file's module doc: v8 coverage does not attach to a dedicated worker's
 * context), so a branch written there moves none of the gate's numbers. `Running` occurs, at a `budget` stop, and maps
 * to `ended` without throwing, for `endOf`'s reason: so that `extendLeg` raises no cap on a run that was not capped.
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
 * An rxm frame's size in bytes. **WORDS DOMINATE** — `rr`, the windowed locals and arguments, each shown frame's
 * saved locals, both halves of each cell and each box's content — and a written bit is charged a byte.
 */
export function rxmFrameBytes(f: RxmState): number {
  let words = 1 + f.locals.length + f.args.length + 2 * f.cells.length + f.boxes.length
  for (const frame of f.frames) words += frame.saved.length
  return FRAME_OVERHEAD_BYTES + words * RXM_WORD_BYTES + f.written.length
}

/**
 * Each leg's charge for a frame, keyed as `LegFrame` is: what the worker spends against a leg's allowance and the page
 * charges its ring, through one entry, so that the two sides cannot charge a leg's frame differently.
 */
export const LEG_FRAME_BYTES: { readonly [K in Leg]: (frame: LegFrame[K]) => number } = {
  lambda: lambdaFrameBytes,
  rxm: rxmFrameBytes,
  tm: tmFrameBytes,
}

/**
 * The largest machine, in δ rules, that may be opened in an editor.
 *
 * **MEASURED, NOT CHOSEN.** Emit, structured clone, `tmScratch` parse and the editor's mount were priced
 * across the corpus (`tm-fork-cost.test.ts`); this is the largest round count whose four costs total
 * under the 250 ms an initiated gesture may take. `list20` is **11,802 rules** and clears it; `list60`
 * is **94,182** and does not. **Those are RULE counts**, not lines or δ-table rows: a row is a state or
 * a rule, and `list60`'s 33,699 states + 94,182 rules make 127,881 rows.
 *
 * **RULES RATHER THAN BYTES, BECAUSE THE COUNT IS ANSWERABLE BEFORE ANYTHING IS EMITTED.** `TmProgram`
 * is projected once per compile and both threads hold it, so the refusal costs a reduce rather than a
 * 7.8 MB allocation that is then discarded. Bytes per rule is stable at 55-61 across a 280x range, so
 * a rule bound is a byte bound within about ten percent.
 *
 * **AND IT IS A REFUSAL, NEVER A TRUNCATION, WHICH IS WHERE THIS DIVERGES FROM `LAMBDA_BYTE_BUDGET`.**
 * A truncated term is still a readable term and that budget trims and shows it. A truncated `.tm` file
 * is not a machine: it either fails to parse or parses into a different one, missing its tail states.
 */
export const MAX_FORK_RULES = 50_000

/** How many δ rules a projected machine has, summed across its states. */
export function ruleCount(p: TmProgram): number {
  return p.states.reduce((n, s) => n + s.rules.length, 0)
}

/**
 * Whether this machine may be forked into an editable buffer.
 *
 * A TYPE PREDICATE, so a caller that passes the check has a non-null `TmProgram` without a second
 * check. A declined leg has no `TmProgram`, and every consumer would otherwise repeat the null test
 * beside this one.
 */
export function forkable(p: TmProgram | null): p is TmProgram {
  return p !== null && ruleCount(p) <= MAX_FORK_RULES
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
  | { kind: 'run'; gen: number; src: string; encoding: string }
  /**
   * Build a copy of `leg` from that leg's TEXT and record it: a λ fork (5d-i design §4.3), a TM copy (5d-iv design
   * §4.4) or an rxm copy (Plan 7 part 5 spec §7). A `ScratchBuffers` buffer sends the leg it was minted on.
   *
   * **`step` IS READ FOR λ ALONE**: the frame a λ pane was showing, to which the worker reduces `src`, the source's
   * step-0 term, before forking (5d-iii design §4.1); an edit sends 0, the text being the term. A machine's text IS its
   * program, run from its first configuration, so a TM or rxm copy has no step to replay to. **NO `encoding`**: a λ
   * copy has no `ty` to decode against (5d-i decision 2), and a TM or rxm copy decodes by its own header.
   */
  | { kind: 'scratch'; gen: number; leg: Leg; src: string; step: number }
  /**
   * Record further. For a `capped` leg the worker raises the cursor cap first; for a `budget` leg it
   * simply allows another `HISTORY_BYTES` and resumes. `epoch` is the leg's, as `rewind`'s doc says.
   */
  | { kind: 'extend'; gen: number; leg: Leg; epoch: number }
  /**
   * Take one leg back to step 0 and record its first fill again (hidden-recording spec §5.4), under `epoch`, the
   * leg's count of rewinds, which the page raised as it posted this.
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
/** Each leg's part of a `result`, keyed as `LegFrame` is. */
export type LegResult = { lambda: LambdaLeg; rxm: RxmLeg; tm: TmLeg }
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

/**
 * `keepDecided`'s rule for one part: `prev` when its value is decided and `next`'s is `Unfinished`, else `next`. An rxm
 * copy's reading takes it too (`replies.ts`'s `rxm-value` arm), since a copy's value comes in no `result`.
 */
export function keepDecidedPart<P extends { readonly value: Decoded | null }>(prev: P, next: P): P {
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

/** Each leg's status at compile time, keyed as `LegFrame` is: what `compiled` carries as `statuses`. */
export type LegStatus = {
  lambda: LambdaStatus
  /** Unavailable only when the program does not lower, including where TM declines it (spec §5.2). */
  rxm: RxmStatus
  tm: TmStatus
}

/**
 * What `compiled` carries as `programs`: the program of each leg that compiles one, which its views are seeded from,
 * `null` for a leg that is unavailable. **NO λ ENTRY**, since the λ leg compiles none; keyed by these legs rather than
 * by `Leg` with a `lambda: never`, so a leg that comes to compile one is added here, and the worker's post fails `tsc`
 * until it sends it.
 */
export type LegProgram = { rxm: RxmCompiled; tm: TmCompiled }

/**
 * A session's machine in the form a TM view is handed one: `compiled`'s `programs.tm`, which the session keeps as
 * `SessionEntry.programs.tm`. A TM copy's entry holds one built from its own reply.
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
  /**
   * The machine as `.tm` text, or `null` when it is over `MAX_FORK_RULES`, when the program's result type is a
   * function (`tmResultDecodable` is `false`), which a `.tm` header's `result` line cannot name, and on a TM copy,
   * which offers no copy of itself. **`null` IS THE ONLY FACT BEHIND *WHETHER* THE CONTROL IS OFFERED**: a second
   * encoding of one fact is how a control comes to be offered for a fork that cannot happen.
   *
   * **BESIDE `program` BECAUSE `TmPane.setForkAvailable`'s decision (5d-iv design §4.3) needs it the moment a TM pane
   * exists**, and a view built after the reply is seeded from the entry. Not a second nullable envelope: a machine
   * can exist and still have no text.
   */
  readonly text: string | null
  /**
   * Whether the program's result type has a decoding a `.tm` header's `result` line can name — `false` only for a
   * function-valued program (`ty::is_decodable`'s answer, `redextape-core`). **READ ONLY WHEN `text` IS `null`**, to
   * tell "the type has no decoding" apart from "the machine is over `MAX_FORK_RULES`":
   * `CopyEditor.setForkAvailable`'s third argument, worded into *edit a copy*'s disabled reason by `#refreshDetach`.
   */
  readonly tmResultDecodable: boolean
}

/**
 * The rxm listing a session compiled, and the text *edit a copy* seeds a copy from — `TmCompiled`'s shape for the rxm
 * leg, and for its reason: the view that offers a copy needs both, and a view built after the reply is seeded from
 * the session's entry.
 */
export type RxmCompiled = {
  /** No `states`: a `TmProgram` has every `RxmProgram` field, so without this a TM machine would pass as this one. */
  readonly program: RxmProgram & { readonly states?: never }
  /**
   * The program as `.rxm` text, or `null` on a copy, which offers no copy of itself, and for text longer than
   * `session.rs`'s `MAX_SCRATCH_RXM_BYTES`, which no copy could build. As with `TmCompiled.text`, `null` is the only
   * fact behind a refusal: the view words its reason from the listing's instruction count.
   *
   * **NO `tmResultDecodable` BESIDE IT.** A function-valued program's rxm text is still `Some`, headerless
   * (`RxmHeader::for_type` answers `None` and `rxm_text` falls back to `print_rxm`): the rxm leg's header is
   * optional, unlike TM's, so it has no such refusal to word.
   */
  readonly text: string | null
}

export type RunReply =
  /**
   * The program did not analyze, so there is no session at all.
   *
   * SHARED WITH THE `scratch` REQUEST, WHICH IS A REUSE AND NOT A STRETCH. `lambdaScratch(src)`
   * answers `{ diagnostics, scratch: null }` for text that did not parse, and "there is nothing to
   * step, and here is why" is the same claim this variant already makes for a program that did not
   * analyze — same shape, same consumer obligation (clear the panes, show the diagnostics). A second
   * `no-scratch` variant would be two names for one state, which is what a renderer then has to switch
   * on twice.
   */
  | { kind: 'no-session'; gen: number; diagnostics: Diagnostic[] }
  /**
   * A λ scratchpad exists — `compiled`'s counterpart for a session with ONE leg and no compile behind
   * it (5d-i design §4.1, §4.3).
   *
   * A SEPARATE VARIANT RATHER THAN `compiled` WITH FIVE NULLS, and that is 5d-i decision 2 restated on
   * the wire. `compiled` carries a TM status, a machine, its tape names, `declinedSpan` and `linkIndex`; a
   * `LambdaScratch` has no TM leg, no `SourceMap` and no `ty`, so every one of those would be a
   * fabricated field on a message about a session that provably cannot have them — the shape §3.3
   * refuses at the type level and `session.rs`'s `Session::tm` prices. A consumer that receives this one
   * cannot even ask the wrong question.
   *
   * NO `result` EVER FOLLOWS IT, unlike `compiled`. `result` carries `lambdaLeg(session).value`, which
   * reads `lambdaValue` — the method §3.3 puts off this type. The frames and their `RecordEnd` are the
   * whole answer for a scratchpad; there is no decoded value to arrive later.
   *
   * **`text` IS THE STRING THAT BUILT THE SCRATCH.** The editor is seeded from it rather than from a
   * second print that could disagree, which is what keeps the box, the scratch's step 0 and the term
   * the user forked one object instead of three that agree until they do not. For a build at step 0 —
   * an edit, a paused copy resumed — that string is the request's own `src`, as it was typed, unless it
   * is longer than the byte budget; past step 0, and for text over the budget, it is the worker's print
   * of the term (`session.rs`'s `lambda_scratch_at`).
   *
   * **IT IS NULLABLE DEFENSIVELY AND IS NEVER `null` ON THIS REPLY.** The type mirrors
   * `session::ForkedAt`, where `scratch` and `text` are one fact — null together or neither. But
   * `copy-build.ts`'s `buildCopy` posts `no-session` and returns once `scratch` is null, so the only path
   * that reaches `scratch-compiled` has already proved both are present. **Unparseable text and a
   * term over budget do not arrive here as a null `text`; they do not arrive here at all** — they
   * take `no-session`, which carries the diagnostics and has no `text` field. A reader hunting for a
   * live null case on this variant will not find one.
   */
  | { kind: 'scratch-compiled'; gen: number; lambda: LambdaStatus; text: string | null }
  /**
   * A TM scratch was built — 5d-iv design §4.4, and `scratch-compiled`'s counterpart rather than a
   * widening of it.
   *
   * **A SEPARATE ARM BECAUSE THE PAYLOADS SHARE NO FIELD.** `scratch-compiled` carries a
   * `LambdaStatus` and the text the fork was built from; this carries a `TmScratchStatus` — no
   * `total_steps` — and a machine. Folding them would put a union inside the arm and a switch in every
   * consumer to open it.
   *
   * **`tmProgram` IS NOT NULLABLE HERE, WHERE `compiled`'s `programs.tm` IS.** A `TmScratch` exists only for text
   * that parsed to a machine, so the δ-table always has a program to render; text that did not parse
   * takes `no-session`, carrying the diagnostics, exactly as it does for λ.
   *
   * **AND THERE IS NO `text` ECHO.** λ needs one because the worker computes the term at step k and
   * the main thread has never seen it. Here the main thread SENT the text, so echoing it would return
   * up to `MAX_FORK_RULES` rules of string to the sender that already holds it.
   */
  | { kind: 'tm-scratch-compiled'; gen: number; tm: TmScratchStatus; tmProgram: TmProgram; tapeNames: string[] }
  /**
   * How far a TM buffer's value run has got, and its value once it has finished — posted after every chunk.
   *
   * **ONLY FOR A FILE WITH A HEADER.** `tmScratch` builds a value run for no other, because decoding needs the
   * header's `result` type, and a buffer with no header never hears this reply.
   *
   * `value` IS `Unfinished` WHILE `run.run` IS `Running`, so a consumer can render either field alone.
   */
  | { kind: 'tm-value'; gen: number; run: ValueRun; value: Decoded }
  /**
   * An rxm copy was built: its status, its listing and its value — `tm-scratch-compiled`'s counterpart.
   *
   * **THE VALUE COMES WITH THE BUILD**, where a TM copy's streams in on `tm-value`: `rxmScratch` runs the program to
   * its end before it answers, as `compile` does (spec amendment 26). `rxm` is the same `RxmStatus` `compiled`
   * carries, since every field of it is true of a copy. No `text` echo, for `tm-scratch-compiled`'s reason: the main
   * thread sent the text.
   */
  | { kind: 'rxm-scratch-compiled'; gen: number; rxm: RxmStatus; rxmProgram: RxmProgram; value: Decoded }
  /**
   * An rxm copy's value after a `[continue]` — where a compiled session's arrives in `result`, which a copy never
   * gets. Only a step cap can be continued, so this changes a value only for a copy whose build that cap stopped: a
   * raise past it can decide the value, and after a rewind the cursor is under it again and reads `Unfinished`, which
   * the page keeps a decided value against (`keepDecidedPart`).
   */
  | { kind: 'rxm-value'; gen: number; value: Decoded }
  /**
   * A session exists. Sent BEFORE any recording, so the panes can mount and show their declines
   * while the legs are still being stepped.
   *
   * `programs` IS SENT ONCE, HERE. A program does not change as the cursor moves, so putting it on every
   * frame would send the same machine again with each one.
   */
  | {
      kind: 'compiled'
      gen: number
      statuses: { [K in Leg]: LegStatus[K] }
      /**
       * Sent eagerly, with each program's text, for `linkIndex`'s reason below: a lazy fetch on the first *edit a copy*
       * costs a round trip into a worker that is recording, which is when a user reaches for one. `MAX_FORK_RULES` and
       * `session.rs`'s `MAX_SCRATCH_RXM_BYTES` bound the texts, which is what makes that affordable.
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
    }
  /** One chunk of a leg's recording, under the leg's epoch when it was recorded (`rewind`'s doc). */
  | FramesReply
  /**
   * Every leg interrogated once a request's recording stopped — what `results.ts` renders. A leg still recording keeps
   * the part last posted for it, or before the generation's first `result` the part a rewind found, where there is one
   * (`keepInFlight`); one whose decided value a rewind took away keeps its last `result`'s (`keepDecided`).
   */
  | { kind: 'result'; gen: number; legs: ResultLegs }
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
