import { type Extent, HEADER_ORDER, KIND_ORDER, type LayoutNode, leaves, type Shape, SOURCE_LEAF } from './layout'
import type { LeafId, PaneKind } from './panes'

/**
 * WHICH VIEWS ARE ON SCREEN, AND THE ARRANGEMENT EACH COMBINATION OF THEM REMEMBERS — the view layouts spec §4.
 *
 * A **combination** is the set of kinds a tree's leaves have, written as those kinds in `KIND_ORDER`; its **key** is
 * that list joined by `+`. `Arrangements` holds the tree last seen for every combination visited except the one on
 * screen, whose tree `main.ts` keeps.
 *
 * **THE COMBINATION ON SCREEN IS READ FROM THE TREE AND STORED NOWHERE**, for the reason `workspace.ts` gives for the
 * preset: a stored copy could disagree with what it copies. Every function here is a value in and a value out, so the
 * node tier tests all of it.
 */

/** A set of kinds that is not empty, in `KIND_ORDER`, each once. */
export type Combination = readonly PaneKind[]

/** The remembered tree of each combination visited, by key — never one under the key of the tree on screen. */
export type Arrangements = Readonly<Record<string, LayoutNode>>

/** The kinds `tree`'s leaves have, in `KIND_ORDER`. */
export function combinationOf(tree: LayoutNode): Combination {
  const held = new Set(leaves(tree).map((l) => l.pane))
  return KIND_ORDER.filter((k) => held.has(k))
}

/** A combination's key: its kinds joined by `+`, as `source+tm`. */
export function keyOf(kinds: Combination): string {
  return kinds.join('+')
}

/** The key of the combination `tree` shows. */
export function treeKey(tree: LayoutNode): string {
  return keyOf(combinationOf(tree))
}

/**
 * The combination a key spells, or `null` for a string that is not a key: an unknown kind, a kind twice, kinds out of
 * `KIND_ORDER`, or none. **ONLY THE SPELLING `keyOf` WRITES IS A KEY**, so two entries of a stored record cannot name
 * one combination.
 */
export function parseKey(key: string): Combination | null {
  const parts = key.split('+')
  const kinds = KIND_ORDER.filter((k) => parts.includes(k))
  return kinds.length > 0 && keyOf(kinds) === key ? kinds : null
}

/**
 * `kinds` with `kind` added where it is missing and removed where it is there — what pressing a kind's toggle asks
 * for. The result is empty when `kind` was the only one; the caller refuses that, since one kind of view stays.
 */
export function toggled(kinds: Combination, kind: PaneKind): PaneKind[] {
  const next = new Set(kinds)
  if (!next.delete(kind)) next.add(kind)
  return KIND_ORDER.filter((k) => next.has(k))
}

/**
 * Put `next` in force as the tree on screen — what every write of the tree but those named below goes through (spec
 * §4.3), by `main.ts`'s `enterTree`.
 *
 * **A WRITE THAT REPLACES THE WORKSPACE WHOLE DOES NOT COME HERE**: *reset preset*, an opened link's workspace and
 * its *undo*'s, and the workspace a page starts on each set the tree and what is remembered together, in `main.ts`.
 *
 * Where `next` shows another combination than the tree it replaces, the tree left is remembered under its own key
 * and the entry under `next`'s key is dropped: `next` is that combination's arrangement now. Where the combination
 * is the same, an edit in place, nothing is remembered and nothing is dropped.
 *
 * **SO A SWITCH AWAY AND BACK SHOWS THE TREE THAT WAS LEFT**, and so does `✕` on a kind's last view followed by that
 * kind's toggle: the tree before the `✕` went under the key the toggle returns to.
 *
 * **THE TREE LEFT GOES AFTER EVERY ENTRY KEPT**, so the record's order is the order its trees were left in, the last
 * one last. `liveLeaves` reads from it which arrangement had a view on the page most recently.
 */
export function enter(
  now: { readonly tree: LayoutNode; readonly arrangements: Arrangements },
  next: LayoutNode,
): { readonly tree: LayoutNode; readonly arrangements: Arrangements } {
  const before = treeKey(now.tree)
  const after = treeKey(next)
  if (before === after) return { tree: next, arrangements: now.arrangements }
  const kept = Object.fromEntries(Object.entries(now.arrangements).filter(([key]) => key !== after))
  return { tree: next, arrangements: { ...kept, [before]: now.tree } }
}

/**
 * The stops the cycle keys walk, in order: the source beside each other kind in turn, in the header's order, then all
 * four (spec §7.4). Each stop is a combination, so its kinds are in `KIND_ORDER`, where the source comes first too.
 */
export const CYCLE: readonly Combination[] = [
  ...HEADER_ORDER.filter((k) => k !== 'source').map((k): Combination => ['source', k]),
  KIND_ORDER,
]

/**
 * The stop `step` on from `kinds`, wrapping. From a combination that is not a stop, forward is the first stop and
 * back is the last.
 */
export function cycleFrom(kinds: Combination, step: 1 | -1): Combination {
  const at = CYCLE.findIndex((stop) => keyOf(stop) === keyOf(kinds))
  const from = at === -1 ? (step === 1 ? -1 : 0) : at
  return CYCLE[(from + step + CYCLE.length) % CYCLE.length] as Combination
}

/**
 * Every live view and what it is: the leaves of the tree on screen and of every remembered arrangement, each id with
 * one kind (spec §5.1).
 *
 * **ONE ID IS ONE VIEW, OF ONE KIND, THOUGH TWO TREES CAN NAME IT AS TWO** (§5.4). A pick in a view's title changes its
 * kind and keeps its id, so an arrangement off the screen can still name the id as what it used to be. The view is
 * what the tree on screen says; for a view off the screen, what the arrangement left last says, since that tree is the
 * last one that had the view on the page. `enter` puts the tree it leaves after every entry it keeps, so that
 * arrangement is the last entry holding the id, and a stored record is read back in the order it was written.
 */
export function liveLeaves(tree: LayoutNode, arrangements: Arrangements): Map<LeafId, PaneKind> {
  const live = new Map<LeafId, PaneKind>()
  for (const l of leaves(tree)) live.set(l.id, l.pane)
  const onScreen = new Set(live.keys())
  for (const remembered of Object.values(arrangements))
    for (const l of leaves(remembered)) if (!onScreen.has(l.id)) live.set(l.id, l.pane)
  return live
}

/**
 * `next` as a switch enters it: each leaf whose id is live as a view of another kind takes an id from `mint`, and
 * every other leaf keeps its own (spec §5.4). `live` is `liveLeaves` of the workspace the switch leaves, and `mint`
 * answers an id no tree holds. Where no leaf takes one, the answer is `next` itself.
 *
 * **ONE ID IS ONE PANE, AND THAT PANE IS OF THE OTHER KIND.** A remembered arrangement can name an id as the kind it
 * was before a pick in its view's title, and a combination's default names `lambda-0`, `asm-0` and `tm-0` whatever
 * those are by now. The view such a leaf named no longer exists, and a new one is built in its place either way.
 * Built under the old id, it would take that id's pane with it: `pane-host.ts`'s `applyLayout` drops a pane whose kind
 * is not its leaf's, so a TM view of a copy, parked under `asm-0`, would be destroyed by the switch that showed the
 * asm view — its editor, its place on the copy and what it had open. Under an id of its own, the new view is built
 * beside it, and the view that holds the old id stays parked like any other.
 *
 * **A PICK IN A TITLE STILL KEEPS ITS ID**: this is asked only of a tree a switch is about to enter.
 *
 * **THE SOURCE LEAF IS NEVER GIVEN ANOTHER ID.** `layout.ts`'s `SOURCE_LEAF` is the one id that is not interchangeable,
 * and `parseTree` holds it to the source kind in every tree, so it cannot be live as another.
 */
export function reidentified(next: LayoutNode, live: ReadonlyMap<LeafId, PaneKind>, mint: () => LeafId): LayoutNode {
  if (next.kind === 'leaf') {
    const is = live.get(next.id)
    return next.id === SOURCE_LEAF || is === undefined || is === next.pane ? next : { ...next, id: mint() }
  }
  const children = next.children.map((child) => reidentified(child, live, mint))
  return children.every((child, i) => child === next.children[i]) ? next : { ...next, children }
}

/** The shape of an area: `tall` where it is taller than it is wide, `wide` otherwise — a box of no size included. */
export function shapeOf(area: Extent): Shape {
  return area.height > area.width ? 'tall' : 'wide'
}
