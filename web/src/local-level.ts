import type { RuleView, TmProgram } from './types'

/**
 * The state diagram's local level as data (Plan 7 part 4, spec §8 and amendment 10): the current state and every
 * state within `REACH` rules of it in either direction, in columns by signed distance, and the rules between them.
 *
 * **SMALL, SO IT IS REBUILT WHEN THE STATE CHANGES.** §2.3 measured a median of 5 states within 2 rules either way
 * on `fact3`, `map_fold` and `while4` alike; a state change re-lays it out, and a frame in the same state does not.
 */

/** How far the local level reaches, in rules, each way. */
export const REACH = 2

/**
 * A state on the local level, and its column: 0 for the current state, `+d` for one `d` rules ahead of it, `-d`
 * for one `d` rules behind it and not ahead of it too — a state reachable both ways takes its forward distance.
 */
export type LocalNode = { readonly state: number; readonly column: number }

/**
 * The rules from one state on the level to another, as one edge: its label names only the tapes those rules touch
 * (`reg:1 L`, "on `reg` read 1, move left"), each rule's own label once, and `next` is whether the rule about to
 * fire is among them.
 */
export type LocalEdge = { readonly from: number; readonly to: number; readonly label: string; readonly next: boolean }

export type Local = { readonly nodes: readonly LocalNode[]; readonly edges: readonly LocalEdge[] }

/**
 * Each state's predecessors — the states with a rule into it, each once. Once per machine, like the program level's
 * groups. **LINEAR**: states are visited in order, so a repeat can only be the last one pushed; `overflow` alone has
 * a predecessor in nearly every gadget, and a search of its list per rule would be quadratic in them.
 */
export function predecessors(p: TmProgram): number[][] {
  const into: number[][] = p.states.map(() => [])
  for (const [s, state] of p.states.entries()) {
    for (const rule of state.rules) {
      const list = into[rule.next]
      if (list !== undefined && list[list.length - 1] !== s) list.push(s)
    }
  }
  return into
}

/**
 * One rule's label: for each tape it touches — reads a symbol, writes one or moves — `name:read`, then `/write` if
 * it writes and the move if it moves. A tape it leaves alone is not named, so a gadget that works one tape of five
 * reads as that one tape. A rule that touches nothing at all is `*`.
 */
export function ruleLabel(rule: RuleView, names: readonly string[]): string {
  const parts: string[] = []
  for (let i = 0; i < rule.read.length; i += 1) {
    const read = rule.read[i] ?? null
    const write = rule.write[i] ?? null
    const move = rule.moves[i] ?? 'S'
    if (read === null && write === null && move === 'S') continue
    const name = names[i] ?? `tape ${i}`
    parts.push(`${name}:${read ?? '*'}${write === null ? '' : `/${write}`}${move === 'S' ? '' : ` ${move}`}`)
  }
  return parts.length === 0 ? '*' : parts.join(' ')
}

/** Breadth-first distances from `start` along `step`, up to `REACH`. */
function within(start: number, step: (s: number) => Iterable<number>): Map<number, number> {
  const dist = new Map<number, number>([[start, 0]])
  let frontier = [start]
  for (let d = 1; d <= REACH; d += 1) {
    const next: number[] = []
    for (const s of frontier) {
      for (const t of step(s)) {
        if (dist.has(t)) continue
        dist.set(t, d)
        next.push(t)
      }
    }
    frontier = next
  }
  return dist
}

/**
 * The local level around `current`. `rule` is the rule about to fire (`TmState.rule`), whose edge is marked.
 * Nodes come in column order and, within a column, by state id, so the same state always lays out the same way.
 */
export function localLevel(
  p: TmProgram,
  into: readonly (readonly number[])[],
  current: number,
  rule: number | null,
  names: readonly string[],
): Local {
  const ahead = within(current, (s) => p.states[s]?.rules.map((r) => r.next) ?? [])
  const behind = within(current, (s) => into[s] ?? [])
  const column = new Map<number, number>()
  for (const [s, d] of behind) column.set(s, -d)
  for (const [s, d] of ahead) column.set(s, d)
  const nodes = [...column.entries()]
    .map(([state, c]) => ({ state, column: c }))
    .sort((a, b) => a.column - b.column || a.state - b.state)

  const edges: LocalEdge[] = []
  for (const { state: from } of nodes) {
    const byTarget = new Map<number, { labels: string[]; next: boolean }>()
    for (const [i, r] of (p.states[from]?.rules ?? []).entries()) {
      if (!column.has(r.next)) continue
      const edge = byTarget.get(r.next) ?? { labels: [], next: false }
      const label = ruleLabel(r, names)
      if (!edge.labels.includes(label)) edge.labels.push(label)
      if (from === current && i === rule) edge.next = true
      byTarget.set(r.next, edge)
    }
    for (const [to, e] of byTarget) edges.push({ from, to, label: e.labels.join(', '), next: e.next })
  }
  return { nodes, edges }
}
