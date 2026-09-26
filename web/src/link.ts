// M2 VERDICT, decided against a threshold the design fixed BEFORE any number existed: if the median
// `Within` span exceeded 60% of program length on MORE THAN ONE corpus program, `Within` would render
// as a status line rather than a highlight (see `reduce.rs`'s `Owner` doc for what `Within` claims).
// Task 8 measured it with `crates/redextape-core/examples/owner_probe.rs` — full M1/M2 tables in the
// `PLAN 5c CLOSES` entry of `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, which carries
// the whole nine-program table. Only `sum5` crossed it: median 65.0% (every one of its 402 `Within`
// steps resolved to the SAME span — `Core::LetRec` re-tags the identical `If` body on each of the
// recursion's five unrollings, not a whole-program fallback). The next-highest median across the other
// eight programs was 29.4% — nowhere close. One program crossing is not "more than one", so
// the gate did not trip: `WITHIN` RENDERS AS A HIGHLIGHT, same as `Exact`, just visibly weaker — see
// `main.ts`'s `draw()` for the wiring and `style.css`'s `.is-focus-within` for the weaker treatment.
import type { Cut, Owner, Span } from './types'
import { ownerNode } from './types'

/**
 * `linkIndex(byteBudget)`'s wire shape: one string, one nullable cut, and ten typed arrays.
 *
 * COLUMNAR BECAUSE THE OBJECT FORM DOES NOT FIT. `list60` is 552 KB as arrays of objects against
 * ~220 KB this way, and `prog200` is 1.9 MB against ~689 KB — and the app rebuilds this on every
 * 300 ms typing pause. See `lib.rs`'s `linkIndex` and design §4.1.
 */
export type LinkIndexWire = {
  lambdaText: string
  lambdaCut: Cut | null
  lambdaSpanStart: Uint32Array
  lambdaSpanEnd: Uint32Array
  lambdaSpanClass: Uint8Array
  lambdaNodeStart: Uint32Array
  lambdaNodeEnd: Uint32Array
  lambdaNodeId: Uint32Array
  sourceNodeStart: Uint32Array
  sourceNodeEnd: Uint32Array
  sourceNodeId: Uint32Array
  tmOwner: Int32Array
}

/**
 * Where one Core node shows up: its source span and its machine states. Either may be absent, each for its
 * own reason. **NO λ LEG SINCE PLAN 7 PART 4A** — the λ view finds a construct's nodes in the tree it draws
 * (`Tree.nodesLinkedTo`), at whatever step is on screen, where this index knew only step 0's text.
 */
export type Link = { source: Span | null; states: number[] }

/**
 * The smallest span containing `byteOffset`, as an index into the three parallel arrays, or `-1`.
 *
 * A LINEAR SCAN, DELIBERATELY, and the contrast with `state-table.ts` is the point. That file binary-
 * searches because it faces 127,881 rows; this faces at most a few hundred intervals — 403 on the
 * most adversarial program measured — and they are NESTED rather than disjoint, which makes a correct
 * binary search subtler than the scan while buying nothing measurable.
 *
 * Half-open, matching `Span`: `start` is inside and `end` is not. Ties on width cannot happen for
 * distinct nodes at distinct paths, and if two spans are identical the FIRST wins, matching the
 * "keep the first" rule `sourcemap::lambda_half` and `print_lambda_linked` both already apply.
 */
function innermost(start: Uint32Array, end: Uint32Array, byteOffset: number): number {
  if (byteOffset < 0) return -1
  let best = -1
  let bestWidth = Number.POSITIVE_INFINITY
  for (let i = 0; i < start.length; i += 1) {
    const s = start[i] as number
    const e = end[i] as number
    if (byteOffset < s || byteOffset >= e) continue
    const width = e - s
    if (width < bestWidth) {
      best = i
      bestWidth = width
    }
  }
  return best
}

/**
 * One compile's link index, and the three questions a click asks of it.
 *
 * EVERYTHING HERE IS SYNCHRONOUS AND ALLOCATION-LIGHT, which is the reason the index is shipped whole
 * rather than queried across the worker. The worker is measurably starved for seconds while recording
 * frames — 5a-ii timed a 4,679 ms gap — and recording begins the instant a compile lands, which is
 * exactly when a user reads the result and clicks.
 *
 * **NOTHING HERE LINKS INTO THE λ VIEW (Plan 7 part 4a).** The view finds a construct's nodes in the tree
 * it draws, at whatever step it shows, so no caller gates a λ highlight on the play head. What this keeps
 * of the λ leg is step 0's text: `lambdaText`, the INITIAL term, which seeds a copy and is `''` when the
 * λ backend declined the program.
 */
export class LinkIndex {
  readonly lambdaText: string
  /**
   * Which limit cut `lambdaText`, or `null`. **NO READER IN THE APP SINCE PLAN 7 PART 4A**: the λ link
   * status's *truncated* read it, and that state went with the step-0 link window (spec §5.4). It and the
   * wire field behind it are left in place, an open item rather than a decision.
   */
  readonly lambdaCut: Cut | null

  #w: LinkIndexWire
  /** `node -> its ascending state ids`, derived on first ask and cached. */
  #states = new Map<number, number[]>()

  constructor(wire: LinkIndexWire) {
    this.#w = wire
    this.lambdaText = wire.lambdaText
    this.lambdaCut = wire.lambdaCut
  }

  /** The innermost source construct containing `byteOffset`, or `null`. No outward walk — see `linkFor`. */
  nodeAtSource(byteOffset: number): number | null {
    const i = innermost(this.#w.sourceNodeStart, this.#w.sourceNodeEnd, byteOffset)
    return i < 0 ? null : (this.#w.sourceNodeId[i] as number)
  }

  /** The Core node that produced state `stateId`, or `null` for scaffolding and out-of-range ids. */
  nodeForState(stateId: number): number | null {
    if (stateId < 0 || stateId >= this.#w.tmOwner.length) return null
    const owner = this.#w.tmOwner[stateId] as number
    return owner < 0 ? null : owner
  }

  /**
   * Where `node` shows up on the index's two legs: its source span and its machine states.
   *
   * NO OUTWARD WALK WHEN A LEG IS ABSENT. `sourcemap.rs` refuses to fall back to a surrounding block
   * and so does this: the walk from a transparent `let` goes Let -> Seq -> root, so "nearest enclosing
   * linkable node" would frequently mean highlighting the whole program. Measured, the TM leg is
   * absent for 18-50% of clickable nodes, so reporting the absence is the common path and the caller
   * must say so rather than show nothing.
   */
  linkFor(node: number): Link {
    return { source: this.#spanOf(node), states: this.#statesOf(node) }
  }

  #spanOf(node: number): Span | null {
    const ids = this.#w.sourceNodeId
    const start = this.#w.sourceNodeStart
    const end = this.#w.sourceNodeEnd
    for (let i = 0; i < ids.length; i += 1) {
      if (ids[i] === node) return { start: start[i] as number, end: end[i] as number }
    }
    return null
  }

  /**
   * DERIVED, NOT SHIPPED. Shipping node -> states alongside state -> node would be a second
   * representation of one association with nothing checking the two came from one lowering — the
   * object `sourcemap.rs`'s module doc refuses to create, reintroduced at the boundary.
   */
  #statesOf(node: number): number[] {
    const cached = this.#states.get(node)
    if (cached !== undefined) return cached
    const out: number[] = []
    for (let s = 0; s < this.#w.tmOwner.length; s += 1) {
      if (this.#w.tmOwner[s] === node) out.push(s)
    }
    this.#states.set(node, out)
    return out
  }
}

/** `runningFocus`'s return shape, named so `isCoincident` and callers can share it rather than re-typing it. */
export type Focus = { node: number; claim: 'exact' | 'within' }

/** The construct a click set — `main.ts`'s own `link` state, named so `isCoincident` can share the shape. */
export type Pin = { node: number; origin: 'source' | 'lambda' | 'tm' }

/**
 * The source construct the CURRENT β-step belongs to — the source pane's running focus — as a node
 * id and which claim it is, or `null` when `owner` names nothing or the index does not carry it.
 *
 * A MARKER, NOT A PIN. `owner` moves every β-step; `link` (the pin a click sets, `main.ts`'s own
 * state) only moves on a click. They are different objects and this function knows nothing about
 * `link` at all — `main.ts`'s `draw()` is where the two are compared, for the one coincidence worth
 * its own treatment. See `reduce.rs`'s `Owner` doc for why `Exact` and `Within` stay two claims rather
 * than collapsing to one.
 *
 * NULL AGAINST A STALE `index`, exactly as a click is — `index` is `null` between a keystroke and the
 * next compile's `LinkIndex`, and resolving `owner`'s node id against spans from a program that no
 * longer exists is the silently-wrong answer this project refuses everywhere else. `index` can also be
 * non-null and still stale (the first keystroke after a compile shifts every span it holds without
 * clearing it) — `link-wiring.ts`'s `linkable` flag is what catches THAT case, and the caller must consult it
 * before calling in, the same way `linkAtSourceOffset` already does for clicks.
 */
export function runningFocus(index: LinkIndex | null, owner: Owner): Focus | null {
  if (index === null || owner === 'None') return null
  const node = ownerNode(owner)
  if (node === null) return null
  // The existence check IS a `linkFor` call — `#w`'s columnar arrays are private to the class, so a
  // free function outside it has no cheaper way to ask "does this index carry this node" than the
  // same walk `linkFor` already does. `main.ts` calls `linkFor` again for the resolved span; see its
  // `draw()` for why that second call is accepted rather than folded in here — this function's return
  // shape is fixed to `{ node, claim }`, with no span, so a caller that only wants to KNOW the claim
  // (not paint it) never pays for a span it does not need.
  if (index.linkFor(node).source === null) return null
  return { node, claim: 'Exact' in owner ? 'exact' : 'within' }
}

/**
 * `TmState.source_node` as an `Owner`, for feeding `runningFocus` — always `Exact`, never `Within`.
 *
 * THE TM LEG HAS NO `Within` CONCEPT. `Owner`'s three states describe what the λ leg's descent
 * inherits — "the deepest tagged node passed so far" (design §3.4) — and `source_node` is not that
 * kind of answer at all: it is `SourceMap::tm_owner`'s already-resolved fact about the state this exact
 * configuration is in, computed once at lowering rather than accumulated over a walk. A TM state either
 * was emitted for a construct or it was not; there is no "somewhere inside it" for a machine state to
 * report, so the ambiguity `Within` exists to carry never arises on this leg.
 */
export function sourceNodeOwner(sourceNode: number | null): Owner {
  return sourceNode === null ? 'None' : { Exact: sourceNode }
}

/**
 * Whether the pin (a click, `main.ts`'s own `link`) and the running focus name the same construct —
 * "the moment the app exists to show" (`2026-08-10-plan5c-dual-focus-design.md` §4.3), given its own
 * treatment rather than left as two independently-coloured highlights landing on one span by accident.
 *
 * TRUE FOR A `Within` FOCUS TOO, DELIBERATELY. A weaker claim is still a true one about the pinned
 * construct: `Within` says the current step is happening SOMEWHERE INSIDE the pinned node, which is
 * still "the run is inside what you pinned" — not nothing. The renderer is the one place that reads
 * `claim` to draw `Exact` and `Within` differently (`main.ts`'s `draw()`, `style.css`'s
 * `.is-focus-exact`/`.is-focus-within`); coincidence itself asks a narrower question — do the two name
 * ONE node — and answering that does not require knowing which claim got there.
 */
export function isCoincident(pin: Pin | null, focus: Focus | null): boolean {
  return pin !== null && focus !== null && pin.node === focus.node
}
