import type { TmProgram } from './types'

/**
 * How a machine's states group into the state diagram's program level (Plan 7 part 4, spec §7): by the asm
 * instruction each was built for, by the first segment of its name, or not at all.
 *
 * **CHOSEN PER MACHINE, BY WHAT THE MACHINE CARRIES.** A compiled program's states carry `instr`, from the map
 * the session built at the width its run fitted (spec amendment 14). A copy or a reduced file has no map, so its
 * states carry none — but a compiled machine's names are hierarchical (`cmp6.m1.c.c.cwb`), so the first segment
 * still groups one gadget's states. A machine with neither has no program level (`none`).
 */
export type Tier = 'instr' | 'name' | 'none'

/** One row of the program level: one instruction, one runtime routine, or one name group. */
export type Group = {
  /** `pc4` for an instruction — the name its entry state carries — and the first name segment otherwise. */
  readonly name: string
  /** The instruction's line of `TmProgram.listing`, or `null` for a runtime routine and for any name group. */
  readonly instr: number | null
  /**
   * A routine billed to no instruction — the shared return handler, `halt` — which *arcs* draws in a side column
   * and *chips* under a `runtime` heading. Only the `instr` tier has them: without instructions there is nothing
   * for a routine to be outside of.
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
  readonly tier: Tier
  /**
   * In row order: the instructions in listing order and then the runtime routines; or the name groups in the order
   * the machine first reaches them from its start (`groupStates`' doc says why).
   */
  readonly groups: readonly Group[]
  /**
   * `groupOf[state]` is the state's group, or `-1` for the `overflow` state, which is a badge on the rows that
   * reach it rather than a row of its own.
   */
  readonly groupOf: Int32Array
}

/**
 * The overflow guard: the state `Builder::overflow` builds in the core — named `overflow`, with no rule, not
 * accepting. **ALL THREE, NOT THE NAME ALONE**: a machine someone wrote may name a working state `overflow`, and that
 * one is a row like any other.
 */
function isGuard(state: TmProgram['states'][number]): boolean {
  return state.name === 'overflow' && state.rules.length === 0 && !state.accept
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

/** Which tier `p` groups by: instructions if any state carries one, names if any name has a dot, else none. */
export function tierOf(p: TmProgram): Tier {
  if (p.states.some((s) => s.instr !== null)) return 'instr'
  if (p.states.some((s) => s.name.includes('.'))) return 'name'
  return 'none'
}

/**
 * Group `p`'s states into rows, and gather the edges between rows.
 *
 * **O(STATES + RULES), ONCE PER COMPILE.** `list150` under binary is 197,265 states (spec §14.1), and this runs
 * when a machine arrives, never per step.
 *
 * **AN INSTRUCTION ALWAYS HAS A ROW**, in listing order, so a row's index in the `instr` tier is its instruction's
 * line — which is what lets `listing[g]` and the arcs' spans be read straight off a group index. The runtime rows
 * follow them, in the order their first state appears.
 *
 * **A FALL-THROUGH IS NOT AN EDGE HERE**: a rule into the very next row is implied by row order (spec amendment
 * 11), in either tier. Neither is a rule into `overflow`, which sets its row's `overflow` badge instead.
 *
 * **NAME GROUPS ARE ORDERED BY FIRST REACH FROM THE START STATE**, depth first, rules in order, and any group the
 * start does not reach follows in the order its first state appears. The lowering allocates every instruction's
 * entry state (`pcN`) before any gadget, so ordered by appearance a copy of `fact(3)` put all 21 entries above all
 * their gadgets and joined each to its own with a long arc: 48 arcs over its 45 rows, where the instruction tier
 * draws 5. Ordered by reach, each gadget follows the entry that falls into it, that edge is a fall-through again,
 * and the same copy draws 9 (spec amendment 15).
 */
export function groupStates(p: TmProgram): Groups {
  const tier = tierOf(p)
  const groupOf = new Int32Array(p.states.length).fill(-1)
  if (tier === 'none') return { tier, groups: [], groupOf }

  const names: string[] = []
  const instrs: (number | null)[] = []
  const runtime: boolean[] = []
  const byKey = new Map<string, number>()
  if (tier === 'instr') {
    for (let i = 0; i < p.listing.length; i += 1) {
      names.push(`pc${i}`)
      instrs.push(i)
      runtime.push(false)
    }
  }
  for (const [s, state] of p.states.entries()) {
    if (isGuard(state)) continue
    if (tier === 'instr' && state.instr !== null && state.instr < p.listing.length) {
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
      runtime.push(tier === 'instr')
    }
    groupOf[s] = g
  }
  // `instrs` and `runtime` are not permuted with `names`: in the name tier no state carries `instr`, so all are alike.
  if (tier === 'name') reorderByReach(p, names, groupOf)

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
  return { tier, groups, groupOf }
}

/**
 * Put `names` in the order the machine first reaches each group from `p.start`, depth first and rules in order, the
 * unreached after them as they were, and renumber `groupOf` to match. In place.
 */
function reorderByReach(p: TmProgram, names: string[], groupOf: Int32Array): void {
  const next: Set<number>[] = names.map(() => new Set())
  for (const [s, state] of p.states.entries()) {
    const g = groupOf[s] ?? -1
    if (g < 0) continue
    for (const rule of state.rules) {
      const h = groupOf[rule.next] ?? -1
      if (h >= 0 && h !== g) (next[g] as Set<number>).add(h)
    }
  }
  const order: number[] = []
  const seen = new Set<number>()
  const start = groupOf[p.start] ?? -1
  const stack = start < 0 ? [] : [start]
  while (stack.length > 0) {
    const g = stack.pop() as number
    if (seen.has(g)) continue
    seen.add(g)
    order.push(g)
    // Pushed in reverse, so the first rule's target is visited first.
    for (const h of [...(next[g] as Set<number>)].reverse()) if (!seen.has(h)) stack.push(h)
  }
  for (let g = 0; g < names.length; g += 1) if (!seen.has(g)) order.push(g)
  const rank = new Int32Array(names.length)
  for (const [i, g] of order.entries()) rank[g] = i
  const renamed = order.map((g) => names[g] as string)
  // A LOOP, NOT `splice(0, n, ...renamed)`: a spread passes every name as an argument, and a hand-written dotted file
  // can have a group per state — 150,000 of them threw `RangeError`.
  for (const [i, name] of renamed.entries()) names[i] = name
  for (let s = 0; s < groupOf.length; s += 1) {
    const g = groupOf[s] as number
    if (g >= 0) groupOf[s] = rank[g] as number
  }
}
