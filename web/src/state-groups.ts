import type { TmProgram } from './types'

/**
 * How a machine's states group into the state diagram's program level (Plan 7 part 4, spec §7): by the rxm
 * instruction each was built for. Every machine the app shows is a compiled program, whose states carry `instr`
 * from the map the session built at the width its run fitted (spec amendment 14); a state built for no
 * instruction is a runtime routine's, grouped by the first segment of its name.
 */

/** One row of the program level: one instruction or one runtime routine. */
export type Group = {
  /** `pc4` for an instruction — the name its entry state carries — and a runtime routine's first name segment. */
  readonly name: string
  /** The instruction's line of `TmProgram.listing`, or `null` for a runtime routine. */
  readonly instr: number | null
  /**
   * A routine billed to no instruction — the shared return handler, `halt` — which *arcs* draws in a side column
   * and *chips* under a `runtime` heading.
   */
  readonly runtime: boolean
  /** How many states the group holds. */
  readonly count: number
  /** The group's lowest state id: what a click on its row links, as a click on that state's row would. */
  readonly first: number
  /** The second segments of its states' names, each once, in state order — the sub-steps (`m1 z1 pk …`). */
  readonly steps: readonly string[]
  /** Whether any of its rules goes to `overflow`: spec §8's ⚠ badge, drawn in place of an edge. */
  readonly overflow: boolean
  /** The groups its rules go to, by index, ascending — every edge but a fall-through and one into `overflow`. */
  readonly targets: readonly number[]
  /** The groups whose rules come to it, by index, ascending, under the same two exclusions. */
  readonly sources: readonly number[]
}

export type Groups = {
  /** In row order: the instructions in listing order and then the runtime routines. */
  readonly groups: readonly Group[]
  /**
   * `groupOf[state]` is the state's group, or `-1` for the `overflow` state, which is a badge on the rows that
   * reach it rather than a row of its own.
   */
  readonly groupOf: Int32Array
}

/**
 * The overflow guard: the state `Builder::overflow` builds in the core. **THE NAME ALONE TELLS IT**: the core
 * reserves `overflow` for that state (`OVERFLOW_STATE`), and no lowering gives the name to any other.
 */
function isGuard(state: TmProgram['states'][number]): boolean {
  return state.name === 'overflow'
}

/** A state's first name segment: `cmp6` for `cmp6.m1.c.c.cwb`, the whole name when it has no dot. */
export function segmentOf(name: string): string {
  const dot = name.indexOf('.')
  return dot < 0 ? name : name.slice(0, dot)
}

/** A state's sub-step: its second name segment, or the whole name when it has none (`pc4`, `halt`). */
export function stepOf(name: string): string {
  const parts = name.split('.')
  return parts[1] ?? name
}

/**
 * Group `p`'s states into rows, and gather the edges between rows.
 *
 * **O(STATES + RULES), ONCE PER COMPILE.** `list150` under binary is 197,265 states (spec §14.1), and this runs
 * when a machine arrives, never per step.
 *
 * **AN INSTRUCTION ALWAYS HAS A ROW**, in listing order, so a row's index is its instruction's line — which is what
 * lets `listing[g]` and the arcs' spans be read straight off a group index. The runtime rows follow them, in the
 * order their first state appears.
 *
 * **A FALL-THROUGH IS NOT AN EDGE HERE**: a rule into the very next row is implied by row order (spec amendment
 * 11). Neither is a rule into `overflow`, which sets its row's `overflow` badge instead.
 */
export function groupStates(p: TmProgram): Groups {
  const groupOf = new Int32Array(p.states.length).fill(-1)
  const names: string[] = []
  const instrs: (number | null)[] = []
  const runtime: boolean[] = []
  const byKey = new Map<string, number>()
  for (let i = 0; i < p.listing.length; i += 1) {
    names.push(`pc${i}`)
    instrs.push(i)
    runtime.push(false)
  }
  for (const [s, state] of p.states.entries()) {
    if (isGuard(state)) continue
    if (state.instr !== null && state.instr < p.listing.length) {
      groupOf[s] = state.instr
      continue
    }
    const key = segmentOf(state.name)
    let g = byKey.get(key)
    if (g === undefined) {
      g = names.length
      byKey.set(key, g)
      names.push(key)
      instrs.push(null)
      runtime.push(true)
    }
    groupOf[s] = g
  }

  const n = names.length
  const count = new Array<number>(n).fill(0)
  const first = new Array<number>(n).fill(-1)
  const steps: Set<string>[] = Array.from({ length: n }, () => new Set())
  const overflow = new Array<boolean>(n).fill(false)
  const targets: Set<number>[] = Array.from({ length: n }, () => new Set())
  const sources: Set<number>[] = Array.from({ length: n }, () => new Set())
  const overflowState = p.states.findIndex(isGuard)
  for (const [s, state] of p.states.entries()) {
    const g = groupOf[s] as number
    if (g < 0) continue
    count[g] = (count[g] as number) + 1
    if (first[g] === -1) first[g] = s
    ;(steps[g] as Set<string>).add(stepOf(state.name))
    for (const rule of state.rules) {
      if (rule.next === overflowState) {
        overflow[g] = true
        continue
      }
      const h = groupOf[rule.next] ?? -1
      if (h < 0 || h === g) continue
      // A FALL-THROUGH ONLY BETWEEN ROWS THAT SIT ONE ABOVE THE OTHER: the last instruction's row is not above the
      // first runtime routine's — *arcs* draws the routines in a column of their own, *chips* under a heading.
      if (h === g + 1 && !(runtime[g] ?? false) && !(runtime[h] ?? false)) continue
      ;(targets[g] as Set<number>).add(h)
      ;(sources[h] as Set<number>).add(g)
    }
  }

  const ascending = (set: Set<number>) => [...set].sort((a, b) => a - b)
  const groups: Group[] = names.map((name, g) => ({
    name,
    instr: instrs[g] ?? null,
    runtime: runtime[g] ?? false,
    count: count[g] ?? 0,
    first: first[g] ?? -1,
    steps: [...(steps[g] as Set<string>)],
    overflow: overflow[g] ?? false,
    targets: ascending(targets[g] as Set<number>),
    sources: ascending(sources[g] as Set<number>),
  }))
  return { groups, groupOf }
}
