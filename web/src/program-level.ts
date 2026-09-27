import type { Groups } from './state-groups'

/**
 * The state diagram's program level as data (Plan 7 part 4, spec §8 and amendments 9 and 11): which rows it
 * shows, which arcs *arcs* draws and in which lanes, and what *chips* says. Pure, so the DOM that draws it
 * (`state-diagram.ts`) holds no arithmetic a node test cannot reach.
 */

/** How the program level draws the edges between its rows: spec amendment 11's two renderings. */
export type Edges = 'arcs' | 'chips'

/** One row of the program level. Every row is `ROW_HEIGHT` tall, so the rows virtualize as the rule table's do. */
export type ProgramRow =
  /** A label from the asm listing, above the instruction it names (amendment 9). */
  | { readonly kind: 'label'; readonly name: string }
  /** One group: an instruction, a runtime routine, or a name group. */
  | { readonly kind: 'group'; readonly group: number }
  /** The current group's sub-steps, the row under it — spec §8's "opens to show its sub-steps". */
  | { readonly kind: 'steps'; readonly group: number }
  /** *Chips*' heading over the runtime routines, which *arcs* draws in a column of their own instead. */
  | { readonly kind: 'heading'; readonly name: string }

/** An arc in *arcs*' gutter: a jump or call between two rows of the listing, by group, and its lane. */
export type Arc = { readonly from: number; readonly to: number; readonly lane: number }

type Labels = readonly (readonly [string, number])[]

/**
 * The rows, in order, for `edges`, with `open`'s sub-steps under it.
 *
 * **AN INSTRUCTION'S LABELS COME FIRST**, in `labels` order, as `print_asm` prints them; a label one past the
 * last instruction is printed after it, and so drawn after it. **THE RUNTIME ROUTINES ARE ROWS ONLY IN *CHIPS*,**
 * under a `runtime` heading: *arcs* draws them in a side column, where their connectors can reach them.
 */
export function programRows(g: Groups, labels: Labels, edges: Edges, open: number | null): ProgramRow[] {
  const rows: ProgramRow[] = []
  const push = (group: number): void => {
    rows.push({ kind: 'group', group })
    if (group === open) rows.push({ kind: 'steps', group })
  }
  if (g.tier !== 'instr') {
    for (let i = 0; i < g.groups.length; i += 1) push(i)
    return rows
  }
  const at = new Map<number, string[]>()
  for (const [name, index] of labels) at.set(index, [...(at.get(index) ?? []), name])
  const listed = g.groups.filter((x) => !x.runtime).length
  for (let i = 0; i <= listed; i += 1) {
    for (const name of at.get(i) ?? []) rows.push({ kind: 'label', name })
    if (i < listed) push(i)
  }
  if (edges === 'chips' && listed < g.groups.length) {
    rows.push({ kind: 'heading', name: 'runtime' })
    for (let i = listed; i < g.groups.length; i += 1) push(i)
  }
  return rows
}

/**
 * The arcs *arcs* draws: every edge between two rows of the listing, each in the innermost lane its span leaves
 * free. A group's own `targets` already leave out fall-throughs and `overflow`, so every one of them is an arc.
 *
 * **SHORTEST SPANS TAKE THE INNERMOST LANES**, so a short jump sits beside its rows and a long call runs outside
 * it, and two arcs share a lane only where their spans do not overlap. Deterministic: ties break on the lower
 * row, then the source. The lanes are assigned once per machine, since the spans are the listing's, not the
 * run's. `map_fold`'s 107 instructions need 7 lanes (spec §14.1).
 */
export function arcsOf(g: Groups): Arc[] {
  const spans: { from: number; to: number; lo: number; hi: number }[] = []
  for (const [from, group] of g.groups.entries()) {
    if (group.runtime) continue
    for (const to of group.targets) {
      if (g.groups[to]?.runtime ?? true) continue
      spans.push({ from, to, lo: Math.min(from, to), hi: Math.max(from, to) })
    }
  }
  spans.sort((a, b) => a.hi - a.lo - (b.hi - b.lo) || a.lo - b.lo || a.from - b.from)
  const lanes: { lo: number; hi: number }[][] = []
  return spans.map(({ from, to, lo, hi }) => {
    let lane = 0
    while ((lanes[lane] ?? []).some((s) => !(hi < s.lo || lo > s.hi))) lane += 1
    const taken = lanes[lane] ?? []
    taken.push({ lo, hi })
    lanes[lane] = taken
    return { from, to, lane }
  })
}

/** What a chip calls `group`: an instruction by the first label that precedes it, when one does, else its name. */
export function chipName(g: Groups, labels: Labels, group: number): string {
  const x = g.groups[group]
  if (x === undefined) return ''
  const label = x.instr === null ? undefined : labels.find(([, index]) => index === x.instr)
  return label?.[0] ?? x.name
}

/**
 * *Chips*' text for one row: `→ skip1` for where its rules go and `← pc13 pc19` for where they come from.
 *
 * **A TARGET IS NAMED AS ITS JUMP NAMES IT** — by its label, which is what the instruction's operand says — and a
 * source by its row's own name, since nothing jumps *from* a label. In *arcs* the same text is the arcs' words
 * for a screen reader, visually hidden (amendment 11).
 */
export function chipsOf(g: Groups, labels: Labels, group: number): { readonly to: string; readonly from: string } {
  const x = g.groups[group]
  if (x === undefined) return { to: '', from: '' }
  const to = x.targets.map((t) => chipName(g, labels, t)).join(' ')
  const from = x.sources.map((s) => g.groups[s]?.name ?? '').join(' ')
  return { to: to === '' ? '' : `→ ${to}`, from: from === '' ? '' : `← ${from}` }
}
