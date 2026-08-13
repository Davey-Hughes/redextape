import type { Move, TmProgram, TmState } from './types'

/** One table row. A state and a rule are both rows because `virtual-list.ts` needs a fixed row height. */
export type Row =
  | { kind: 'state'; id: number; name: string; accept: boolean }
  | {
      kind: 'rule'
      stateId: number
      ruleIndex: number
      read: (string | null)[]
      write: (string | null)[]
      moves: Move[]
      next: number
    }

/**
 * A prefix-sum index over `TmProgram`, and the resolution of a row number across it.
 *
 * NOT A FLATTENED ARRAY, AND THE MEASUREMENT IS WHY. `list60` is 33,699 states and 94,182 rules —
 * 127,881 rows (design §3.1) — so materializing one object per row is 12-25 MB to hold a list of which
 * ~40 are on screen, duplicating fields `tmProgram` is already holding. `rowStart` is one `Int32Array`
 * of 33,699 entries instead: 135 KB, and a row resolves by binary search.
 *
 * BUILT ONCE PER COMPILE, never per step, which is the property `tmProgram` already has and for the
 * same reason (`protocol.ts`'s `compiled` reply: "`tmProgram` IS SENT ONCE, HERE"). Only the highlight
 * moves.
 */
export class StateIndex {
  #program: TmProgram
  /** `#rowStart[s]` is the row index of state `s`'s HEADER row. Its rules follow it. */
  #rowStart: Int32Array
  #rowCount: number

  constructor(program: TmProgram) {
    this.#program = program
    this.#rowStart = new Int32Array(program.states.length)
    let acc = 0
    for (let s = 0; s < program.states.length; s += 1) {
      this.#rowStart[s] = acc
      acc += 1 + (program.states[s]?.rules.length ?? 0)
    }
    this.#rowCount = acc
  }

  get rowCount(): number {
    return this.#rowCount
  }

  rowOfState(s: number): number {
    return this.#rowStart[s] ?? 0
  }

  /** The row at `i`, or `null` when `i` is outside the table. Never clamps — a clamp would draw a real row for a bad index. */
  row(i: number): Row | null {
    if (i < 0 || i >= this.#rowCount) return null
    const s = this.#stateAt(i)
    const start = this.#rowStart[s] ?? 0
    const state = this.#program.states[s]
    if (state === undefined) return null
    if (i === start) return { kind: 'state', id: s, name: state.name, accept: state.accept }
    const ruleIndex = i - start - 1
    const r = state.rules[ruleIndex]
    if (r === undefined) return null
    return { kind: 'rule', stateId: s, ruleIndex, read: r.read, write: r.write, moves: r.moves, next: r.next }
  }

  /** The largest `s` with `rowStart[s] <= i`. `rowStart` is non-decreasing by construction, so this is a binary search. */
  #stateAt(i: number): number {
    let lo = 0
    let hi = this.#rowStart.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((this.#rowStart[mid] ?? 0) <= i) lo = mid
      else hi = mid - 1
    }
    return lo
  }
}

/**
 * Which rows the current frame highlights.
 *
 * `ruleRow` is `-1` when `frame.rule` is null — at an accept state, at `halt`, or stuck. That is a real
 * answer about the run rather than a missing one, so it is a distinguishable value rather than an
 * absent field.
 */
export function highlight(index: StateIndex, frame: TmState | null): { stateRow: number; ruleRow: number } | null {
  if (frame === null) return null
  const stateRow = index.rowOfState(frame.state)
  return { stateRow, ruleRow: frame.rule === null ? -1 : stateRow + 1 + frame.rule }
}

/**
 * Every row a link highlights: each linked state's header row and all of its rule rows.
 *
 * A SET RATHER THAN A RANGE, because a node's state block is not contiguous — `node_to_tm` collects
 * whichever states a lowering emitted for one construct, and a lowering interleaves constructs. The
 * set is built once per link, not per draw: `list60` is 35,715 states, so a per-row scan over the
 * block would be O(visible x block) on every scroll.
 *
 * A STATE ID PAST THE END CONTRIBUTES NOTHING rather than a clamped row. `StateIndex.rowOfState`
 * clamps to 0, which would silently light the first state — the same no-fallback rule `tm_owner`
 * follows one layer in.
 */
export function linkedRows(index: StateIndex, states: number[]): Set<number> {
  const out = new Set<number>()
  for (const s of states) {
    const start = index.rowOfState(s)
    const header = index.row(start)
    if (header === null || header.kind !== 'state' || header.id !== s) continue
    out.add(start)
    for (let i = start + 1; ; i += 1) {
      const row = index.row(i)
      if (row === null || row.kind !== 'rule' || row.stateId !== s) break
      out.add(i)
    }
  }
  return out
}

/**
 * Which rows the RUNNING FOCUS marks: the state HEADER of each state in `states`, and none of its
 * rules.
 *
 * HEADERS ONLY, UNLIKE `linkedRows`'S FULL BLOCK — this is the one place the two diverge. The pin is a
 * click, a deliberate "look here" that earns the full block, rules included, because a user asked to
 * inspect it. The running focus moves every δ-step instead — `transport.ts`'s `PLAY_MS` plays back at up to
 * 8 fps — and repainting dozens of rule rows on every frame is a flicker nobody asked for. The header
 * alone answers "which construct is the machine working on right now" without competing for attention
 * with `highlight()`'s `is-current`/`is-firing`, which already marks the single row the machine is
 * literally sitting on.
 *
 * EMPTY IS THE COMMON CASE, NOT AN EDGE ONE. Measured, the TM leg's coverage runs 50-82% of
 * source-mapped nodes — see `link-status.ts`'s own doc on the absence being routine — so a focus naming
 * a node with no TM block arrives here as `states: []`, and an empty `Set` is the unremarkable, correct
 * answer for it, exactly as `linkedRows` already gives the pin.
 */
export function focusedRows(index: StateIndex, states: number[]): Set<number> {
  const out = new Set<number>()
  for (const s of states) {
    const row = index.rowOfState(s)
    const header = index.row(row)
    if (header !== null && header.kind === 'state' && header.id === s) out.add(row)
  }
  return out
}

/** The table's row height in pixels. Must match `.state-row`'s height in `style.css`. */
export const ROW_HEIGHT = 24

/**
 * Where to scroll so `row`'s MIDDLE sits at the viewport's middle, clamped into the document.
 *
 * PURE ARITHMETIC, DELIBERATELY PULLED OUT OF `Follow`. `TmPane.setLink`'s link-driven scroll wants the
 * exact same centring `Follow.targetScrollTop` computes for its own following-driven scroll — the two
 * already drifted once, when `setLink`'s copy was written without the `+ Math.floor(rowHeight / 2)` term
 * this has, and centred a row's TOP edge where this centres its MIDDLE. Sharing the formula is what
 * keeps a link scroll and a follow scroll agreeing on what "centred" means.
 *
 * NOT `Follow.targetScrollTop` ITSELF, because that also asks whether the table is following, and
 * `setLink`'s scroll must NOT consult that — see its own doc for why a link click scrolls regardless of
 * `Follow`'s state. `targetScrollTop` below is now a thin following-gated wrapper around this.
 */
export function centredScrollTop(row: number, rowHeight: number, viewportHeight: number, totalHeight: number): number {
  const centred = row * rowHeight - Math.floor(viewportHeight / 2) + Math.floor(rowHeight / 2)
  return Math.max(0, Math.min(centred, Math.max(0, totalHeight - viewportHeight)))
}

/**
 * How far an echoed `scroll` event may land from the position this code requested and still count as
 * that echo rather than user intent. Half a row: a browser may land a fractional pixel off when it
 * services the write, and rounding across the write and the readback can accumulate that far without
 * the movement having been a real, intentional scroll.
 */
const ECHO_TOLERANCE = ROW_HEIGHT / 2

/**
 * Whether the table tracks the machine, and where it should scroll to when it does.
 *
 * THE MODEL IS `history.ts`'s `#following`, deliberately — the table and the play head are the same
 * idea about the same run, and a second idiom for it would be a second set of bugs. 5a-i's reviews
 * found both of that field's: a clamped movement that left the flag set, and an unguarded clear that
 * detached against an empty pane.
 *
 * THE TRAP HERE IS DIFFERENT AND IS THIS FILE'S OWN. Following writes `scrollTop`, the browser fires a
 * `scroll` event for that write, and a handler that treats every event as user intent detaches on the
 * first frame it ever follows. `#expected` is what distinguishes the echo of our own write from a
 * user's scroll; `ECHO_TOLERANCE` is half a row because a browser may land a fractional pixel off.
 *
 * `#expected` is NOT CONSUMED BY A MATCH. A single programmatic write can produce more than one
 * `scroll` event — smooth scrolling, a layout reflow, a browser that does not coalesce — and if the
 * first echo cleared `#expected`, the second would fall into the detach branch: the exact failure this
 * class exists to prevent, reintroduced one layer down. Instead `#expected` is superseded only by the
 * next `onProgrammaticScroll` (a new write in flight) or by a scroll outside the tolerance (a real
 * detach). The deliberate consequence: a user scroll landing within the tolerance of the last
 * requested position no longer detaches either, while still following. That is a sub-half-row
 * movement — indistinguishable in size from an echo — and treating it as "they barely moved" rather
 * than "they took control" is the considered trade-off, not an oversight.
 */
export class Follow {
  #following = true
  #expected: number | null = null

  get following(): boolean {
    return this.#following
  }

  attach(): void {
    this.#following = true
  }

  /** Record a scrollTop this code is about to write, so its echo is not read as user intent. */
  onProgrammaticScroll(top: number): void {
    this.#expected = top
  }

  onScroll(top: number): void {
    if (this.#expected !== null && Math.abs(top - this.#expected) <= ECHO_TOLERANCE) {
      return
    }
    this.#expected = null
    this.#following = false
  }

  /** Where to scroll so `stateRow` is centred, or `null` when not following. Clamped into the document. */
  targetScrollTop(stateRow: number, rowHeight: number, viewportHeight: number, totalHeight: number): number | null {
    if (!this.#following) return null
    return centredScrollTop(stateRow, rowHeight, viewportHeight, totalHeight)
  }
}
