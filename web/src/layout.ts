import type { LeafId, PaneKind } from './panes'

export type Dir = 'row' | 'column'

/**
 * THE LAYOUT TREE — 5d-ii-a design §4.1.
 *
 * A LEAF CARRIES A `PaneKind`, NOT A `Leg`, AND NOT A SESSION. `'source'` is not a `Leg` — the source
 * pane renders an editor rather than a leg's frames — so a `Leg`-typed field could not name it. The
 * session is absent because the runtime pairing lives in `panes.ts`, keyed by `LeafId`, and that
 * absence is what keeps this module free of `SessionRegistry` and therefore testable as a value.
 *
 * **NOR IS A BINDING STORED HERE.** A binding is meaningless without the buffer it names, so the two are
 * persisted together under `redextape.buffers` (`buffers-store.ts`'s `PersistedBuffers`, 5d-ii-d design
 * §4.1): "this key is absent or garbage" then degrades to no bindings at all rather than to a tree full of
 * names nothing can resolve, and no reconciliation pass has to exist.
 *
 * EVERY OPERATION RETURNS A NEW TREE. Nothing here mutates its argument — the caller holds one tree
 * and replaces it, which is what makes an undo or a persistence write a matter of keeping the old
 * value rather than of re-deriving it.
 */
export type LayoutNode =
  | { kind: 'leaf'; id: LeafId; pane: PaneKind }
  | { kind: 'split'; dir: Dir; children: LayoutNode[]; sizes: number[] }

/**
 * The smallest fraction of its split a pane may be shrunk to by a drag.
 *
 * A FRACTION RATHER THAN A PIXEL COUNT, so this module needs no element measurements and stays
 * node-testable. `layout-view.ts` converts a pointer delta into a fraction of the split's measured
 * extent before calling `resize`, which is the one place a pixel exists.
 *
 * 0.1 STANDS FOR WIDTH, MEASURED (`pnpm test:probe:floor`, `tests/browser/pane-floor.test.ts`), not merely
 * chosen. `source`'s editor keeps mounting and running at the floor at all three window sizes the probe
 * imposes — nothing destroyed or hidden, only scrolled. λ's DEFAULT view is `.term`, a plain element with
 * `white-space: pre-wrap` — not a `ScratchEditor` at all, so it wraps instead of overflowing horizontally.
 * λ only gains `source`'s editor machinery, and by extension `source`'s measured floor behaviour, once
 * forked into a scratch buffer — a state the probe does not exercise directly, so that half is inference
 * by symmetry rather than a direct measurement.
 *
 * HEIGHT IS THE VIEW'S OWN (Plan 7 part 4's spec §9.1): a TM view's open panels share its height through
 * flex, each down to a floor, so a drag shrinks its δ table with the pane until the floors are reached, and
 * the view scrolls only below them.
 */
export const MIN_PANE_FRACTION = 0.1

/**
 * The `LeafId` of the source pane, which is a CONSTANT rather than a minted id.
 *
 * **EVERY OTHER LEAF IS INTERCHANGEABLE AND THIS ONE IS NOT.** `main.ts`'s `nextLeafId` mints
 * `pane-${n}` for anything a split creates, and which pane ends up at which id is a fact about the order
 * the user clicked in. The source leaf is the exception in kind: there is ONE editor, `main.ts` builds
 * the element that holds it and seeds it into `pane-host.ts`'s host map under this key before any layout
 * exists, and its close control is written directly against it because it has no `PaneSlot` to route a
 * gesture through. A source leaf that came back under a fresh id would be a different leaf as far as
 * every one of those is concerned — an empty pane beside a detached editor.
 *
 * EXPORTED BECAUSE A SECOND MODULE MINTS ONE: `pane-host.ts`'s split handler creates one, so "the id is
 * the same id" is a claim two files have to agree on rather than a spelling.
 */
export const SOURCE_LEAF: LeafId = 'source'

/**
 * The four kinds, in the order a combination's key spells them and a default arrangement places them: source, λ, asm,
 * TM (the view layouts spec §4.1) — the order all four views have on the page.
 *
 * **KEYED BY `PaneKind` AND THEN LISTED**: a kind left out is a type error here, and the keys are the list.
 *
 * **NOT THE HEADER'S ORDER**, which is `HEADER_ORDER` below: where a view sits in the default grid and where its
 * toggle sits in the header are two decisions, and the user made the second one differently.
 */
export const KIND_ORDER: readonly PaneKind[] = Object.keys({
  source: 0,
  lambda: 0,
  asm: 0,
  tm: 0,
} satisfies Record<PaneKind, 0>) as PaneKind[]

/**
 * The four kinds in the order the header's `views` toggles have them: source, asm, λ, TM (the user's decision,
 * 2026-10-11). The toggle keys `1` to `4`, the cycle and the sentence the live region reads follow it, so what is said
 * and pressed runs left to right across the header.
 *
 * **A SECOND LIST, SO IT IS HELD TO THE FIRST**: `tests/node/arrangements.test.ts` asserts it is `KIND_ORDER`'s kinds,
 * each once. A kind added to `PaneKind` is a type error in `KIND_ORDER`, and that test is what then asks for it here.
 */
export const HEADER_ORDER: readonly PaneKind[] = ['source', 'asm', 'lambda', 'tm']

/**
 * A kind's word where the app says it to a reader: in what its `views` toggle says in its tooltip and on the notice
 * line, in the view keys' hint, and in the sentence the live region reads after a switch, each of which reads this
 * table.
 *
 * **THE TOGGLES' LABELS ARE `index.html`'S MARKUP, WHICH READS NOTHING.** `tests/node/harness.test.ts` holds each
 * label to its word here, and `tests/node/pages.test.ts` the help page's list of the layouts the cycle keys step
 * through, so a kind spelled another way in either fails a test.
 */
export const KIND_WORD: Readonly<Record<PaneKind, string>> = { source: 'source', lambda: 'λ', asm: 'asm', tm: 'TM' }

/** Whether the views area is wider than it is tall (`wide`) or taller than it is wide (`tall`) — spec §4.4. */
export type Shape = 'wide' | 'tall'

/** The id a kind's view has in a default arrangement. */
const DEFAULT_LEAF: Readonly<Record<PaneKind, LeafId>> = {
  source: SOURCE_LEAF,
  lambda: 'lambda-0',
  asm: 'asm-0',
  tm: 'tm-0',
}

/**
 * The tree a combination of kinds shows the first time it is visited — the view layouts spec §4.4. Its leaves are
 * `kinds` in `KIND_ORDER`, whatever order they are handed in, under the default ids.
 *
 * | kinds | `wide` | `tall` |
 * | --- | --- | --- |
 * | 1 | the leaf | the leaf |
 * | 2 | a row of the two | a column of the two |
 * | 3 | a row: the first, beside a column of the other two | a column: the first, over a row of the other two |
 * | 4 | a row of two columns: source over asm, beside λ over TM | a column of two rows: source and λ, over asm and TM |
 *
 * **IN A WIDE AREA NO DIVIDER AND NO VIEW RUNS THE WHOLE WIDTH** (the user's decision, 2026-10-11): the views are
 * columns side by side, each with its own stack, so the one divider that spans the area is the vertical one and each
 * side's views are resized on their own. A tall area gets the same trees turned on their side, since there a view
 * across the width is the only view wide enough to read.
 *
 * **ALL FOUR SIT IN THE SAME CORNERS IN BOTH**: source top left, λ top right, asm bottom left, TM bottom right. What
 * differs is which pairs share a divider.
 *
 * **IT THROWS FOR NO KINDS**: a tree has a leaf or more, and every caller holds a combination, which is not empty.
 */
export function defaultArrangement(kinds: readonly PaneKind[], shape: Shape): LayoutNode {
  const pair = (dir: Dir, a: LayoutNode, b: LayoutNode): LayoutNode => ({
    kind: 'split',
    dir,
    sizes: [0.5, 0.5],
    children: [a, b],
  })
  const [a, b, c, d] = KIND_ORDER.filter((k) => kinds.includes(k)).map(
    (k): LayoutNode => ({ kind: 'leaf', id: DEFAULT_LEAF[k], pane: k }),
  )
  // ACROSS THE AREA'S LONG SIDE FIRST, THEN ALONG ITS SHORT ONE.
  const [outer, inner]: [Dir, Dir] = shape === 'tall' ? ['column', 'row'] : ['row', 'column']
  if (a === undefined) throw new Error('a default arrangement needs a kind or more')
  if (b === undefined) return a
  if (c === undefined) return pair(outer, a, b)
  if (d === undefined) return pair(outer, a, pair(inner, b, c))
  return shape === 'tall'
    ? pair('column', pair('row', a, b), pair('row', c, d))
    : pair('row', pair('column', a, c), pair('column', b, d))
}

/**
 * The arrangement a first load and `reset preset` build: the source beside the TM view (the user's decision,
 * 2026-10-11; the view layouts spec §8). It is `defaultArrangement` of those two kinds, so the two cannot disagree.
 *
 * **THE TM VIEW IS THE FIRST VIEW LEAF**, so a first load focuses it: `workspace.ts`'s `defaultFocus` takes the first
 * leaf that is not the source. **A STORED LAYOUT IS NOT MIGRATED** — it is still valid and keeps its arrangement, so
 * `LAYOUT_VERSION` does not move.
 *
 * **`shape` HAS NO DEFAULT**, so a caller that leaves the area's shape out does not compile. With a default of `wide`,
 * *reset preset* with its measurement dropped would build a row in a tall window and every test would pass.
 */
export function defaultLayout(shape: Shape): LayoutNode {
  return defaultArrangement(['source', 'tm'], shape)
}

/** Every leaf, left to right, depth first — the order panes are created and tab order follows. */
export function leaves(root: LayoutNode): { kind: 'leaf'; id: LeafId; pane: PaneKind }[] {
  if (root.kind === 'leaf') return [root]
  return root.children.flatMap(leaves)
}

function findLeaf(root: LayoutNode, id: LeafId): { kind: 'leaf'; id: LeafId; pane: PaneKind } | null {
  return leaves(root).find((l) => l.id === id) ?? null
}

/** Scale `sizes` so they sum to 1, preserving their ratios. */
function normalize(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0)
  if (total <= 0) return sizes.map(() => 1 / sizes.length)
  return sizes.map((s) => s / total)
}

/** Whether a `'source'` leaf is already in the tree — the "at most one source leaf" invariant, asked. */
function hasSource(root: LayoutNode): boolean {
  return leaves(root).some((l) => l.pane === 'source')
}

/**
 * Put a new leaf of `kind` right after the leaf `id`: as an equal share of `id`'s split when `share` is set and that
 * split runs `dir`, and otherwise in a new split of `dir` holding the two at `[0.5, 0.5]`.
 *
 * **`insertBeside`'s AND `splitLeaf`'s BODY, AND THE REFUSALS ARE THE TREE'S OWN INVARIANTS**: the leaf is in the
 * tree, at most one source leaf, since there is one editor for it to hold, and no id twice (`splitLeaf`'s own doc
 * has the argument for the last).
 *
 * **AN EQUAL SHARE KEEPS THE OTHERS' PROPORTIONS**: in a split of `n`, the new leaf takes `1/(n+1)` and each size
 * already there is multiplied by `n/(n+1)`. Sizes that summed to `1 + e` sum to `1 + e·n/(n+1)`, so a drift from 1
 * that `validate` allowed (`SIZE_EPSILON`) shrinks with each share and never grows.
 */
function insert(root: LayoutNode, id: LeafId, dir: Dir, newId: LeafId, kind: PaneKind, share: boolean): LayoutNode {
  if (findLeaf(root, id) === null) throw new Error(`cannot insert beside a leaf that is not in the tree: ${id}`)
  if (kind === 'source' && hasSource(root)) throw new Error('the tree already has a source leaf')
  if (findLeaf(root, newId) !== null) throw new Error(`cannot split into an id already in the tree: ${newId}`)

  const fresh: LayoutNode = { kind: 'leaf', id: newId, pane: kind }
  const rewrite = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'leaf') {
      if (node.id !== id) return node
      return { kind: 'split', dir, sizes: [0.5, 0.5], children: [node, fresh] }
    }
    const at = share && node.dir === dir ? node.children.findIndex((c) => c.kind === 'leaf' && c.id === id) : -1
    if (at === -1) return { ...node, children: node.children.map(rewrite) }
    const n = node.children.length
    const kept = node.sizes.map((s) => (s * n) / (n + 1))
    return {
      ...node,
      children: [...node.children.slice(0, at + 1), fresh, ...node.children.slice(at + 1)],
      sizes: [...kept.slice(0, at + 1), 1 / (n + 1), ...kept.slice(at + 1)],
    }
  }
  return rewrite(root)
}

/**
 * Put a new leaf of `kind` beside the leaf `id`: into `id`'s split as an equal share where that split runs `dir`, and
 * otherwise in a new split of `dir` holding the two at `[0.5, 0.5]` — `splitLeaf` without its refusal of the source
 * leaf as the SUBJECT, and without its halving.
 *
 * **`+ view` IS WHY THIS EXISTS** (Plan 7 part 2 spec §5). It adds the pick beside the focused view, and the
 * focused view can be the source view — or the only view, when every other has been closed. `splitLeaf`'s
 * subject refusal is about the `⋯` menu's split items, which duplicate the view they are chosen on, and there
 * is one editor, so the source view offers none; that argument says nothing about putting a DIFFERENT view
 * next to it. The other refusals are the tree's own invariants and stay: at most one source leaf, since there
 * is one editor, and no id twice (`splitLeaf`'s own doc has the argument for that one).
 *
 * **IT TAKES AN EQUAL SHARE OF THE ROW, AND DOES NOT HALVE THE VIEW** (the user's decision, 2026-10-04). A new
 * view takes the focus, so wrapping each in a new split at `[0.5, 0.5]`, as a split does, would halve the view
 * the last press made and nest the tree one split deeper per press. The view joins the row, right after the one
 * it is added beside, and the views already there keep their proportions and shrink to make room — the source
 * view too, when it shares the row. A view whose split is not a row, or that is the whole tree, is wrapped as a
 * split wraps it. `addRefusal` below is what stops a share going under `MIN_VIEW_PX`.
 */
export function insertBeside(root: LayoutNode, id: LeafId, dir: Dir, newId: LeafId, kind: PaneKind): LayoutNode {
  return insert(root, id, dir, newId, kind, true)
}

/**
 * Replace the leaf `id` with a split holding it and a new leaf of `kind`.
 *
 * `kind` IS THE CALLER'S CHOICE, NOT A COPY OF THE SPLIT LEAF'S. A caller that wants a second pane of the
 * split leaf's kind passes the same kind back — the split menu's first entry is exactly that request,
 * and it is what `pane-host.ts`'s split handler forwards here — but the tree itself does not decide.
 *
 * THIS FUNCTION HAS TWO `'source'` REFUSALS, ON TWO DIFFERENT ARGUMENTS, AND THEY ARE NOT THE SAME
 * REFUSAL (5d-ii-b design §4.2a):
 *
 * | argument | refusal |
 * | --- | --- |
 * | `id`, the leaf being split | always, if it is `'source'` |
 * | `kind`, the leaf being created | only if a `'source'` leaf is already in the tree |
 *
 * THE SUBJECT'S REFUSAL IS UNCONDITIONAL because there is one editor, so there is nothing to duplicate
 * into, and a split producing an undefined second thing is the fabricated state `session.rs`'s
 * `Session::tm` prices. The source view is offered no split control at all — this throw is the backstop
 * for a caller that got there another way, not the UI.
 *
 * THE TARGET'S REFUSAL IS CONDITIONAL, ON PURPOSE: this function must be able to CREATE a source leaf
 * — letting a closed source pane come back without discarding the whole layout is the capability that
 * needs it: `viewMenu` offers `source` exactly while the tree has none, and `pane-host.ts`'s split
 * handler makes that call with `SOURCE_LEAF` — while still enforcing "at most one source leaf" on
 * a tree that already has one. The UI's own `sourceAvailable` and this refusal ask the same question of
 * the same tree; this one is what holds when a caller does not. `setLeafKind` below refuses `'source'`
 * as a target unconditionally instead, because a pane never BECOMES the source pane; that they read as
 * the same guard is exactly why its own doc restates this table rather than pointing here.
 *
 * `newId` IS REFUSED IF IT IS ALREADY IN THE TREE. `findLeaf` resolves an id with `.find()`, so a
 * duplicate would not error — it would silently make the second leaf unreachable, present in the tree
 * but never returned. `parseTree` already treats a duplicate id as an invalid tree on load
 * (`parseWorkspace` reads every stored tree through it), so this refusal keeps the tree unable to reach
 * that state in the first place rather than only detecting it after the fact.
 *
 * **ITS LAST TWO REFUSALS ARE `insertBeside`'s**, whose body it shares once the subject passes; the table
 * above still describes what a caller of either sees.
 *
 * **A SPLIT HALVES THE VIEW IT IS CHOSEN ON, WHERE `+ view` TAKES AN EQUAL SHARE OF THE ROW**: a split is
 * this view in two, and its `⋯` menu says so. This function refuses nothing for size: `pane-host.ts`'s `admit` asks
 * `addRefusal` first, on width for either direction and on height too for a column.
 */
export function splitLeaf(root: LayoutNode, id: LeafId, dir: Dir, newId: LeafId, kind: PaneKind): LayoutNode {
  const target = findLeaf(root, id)
  if (target === null) throw new Error(`cannot split a leaf that is not in the tree: ${id}`)
  if (target.pane === 'source') throw new Error('the source pane cannot be split: there is one editor to duplicate')
  return insert(root, id, dir, newId, kind, false)
}

/**
 * Replace the kind of the leaf `id`, keeping its place, its siblings and every size.
 *
 * THIS IS WHAT MAKES A LEG CHANGE DIFFERENT FROM CLOSE-THEN-CREATE, and it is the whole of decision 1:
 * a pane that changes what it shows stays exactly where the user put it and exactly the size they made
 * it, which a close followed by a split cannot promise.
 *
 * IT REFUSES `'source'` AS A TARGET UNCONDITIONALLY, WHERE `splitLeaf` REFUSES IT ONLY WHEN ONE
 * EXISTS, and the asymmetry is deliberate rather than an oversight. `splitLeaf` is enforcing the "at
 * most one source leaf" invariant, which an empty tree satisfies; this is enforcing decision 4, which
 * says no pane ever BECOMES the source pane — there is one editor and it is chrome `main.ts` owns, not
 * a `PaneView` this tree can conjure. A reader who finds a tree with no source leaf will expect that to
 * unlock this call, so the refusal is unconditional and this paragraph is why.
 *
 * A `'source'` LEAF IS ALSO REFUSED AS THE SUBJECT: the editor would be left with no host in the tree.
 */
export function setLeafKind(root: LayoutNode, id: LeafId, kind: PaneKind): LayoutNode {
  const target = findLeaf(root, id)
  if (target === null) throw new Error(`cannot change the kind of a leaf that is not in the tree: ${id}`)
  if (target.pane === 'source') throw new Error('the source leaf cannot change kind: there is one editor')
  if (kind === 'source') throw new Error('a pane cannot become the source pane: there is one editor')

  const rewrite = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'leaf') return node.id === id ? { ...node, pane: kind } : node
    return { ...node, children: node.children.map(rewrite) }
  }
  return rewrite(root)
}

/**
 * Remove the leaf `id`, collapsing any split it leaves with a single child.
 *
 * COLLAPSE IS RECURSIVE AND IT HAS TO BE. Closing the only other child of an inner split leaves a
 * one-child split inside a one-child split, and a single collapse pass would leave the outer one. A
 * single-child split renders as a pane with an extra layer of padding and no divider — visible enough
 * to be wrong, subtle enough to survive a browser test.
 *
 * SURVIVING SIBLINGS KEEP THEIR RATIO. A split of [0.2, 0.3, 0.5] that loses its middle child becomes
 * [0.2/0.7, 0.5/0.7] rather than [0.5, 0.5] — the panes the user sized stay the relative size the user
 * made them.
 *
 * THE LAST LEAF CANNOT GO. An empty tree has no honest rendering, and `view-header.ts`'s `viewMenu` omits
 * the close control when one leaf remains, so this throw is a backstop rather than the mechanism.
 */
export function closeLeaf(root: LayoutNode, id: LeafId): LayoutNode {
  if (findLeaf(root, id) === null) throw new Error(`cannot close a leaf that is not in the tree: ${id}`)
  if (leaves(root).length === 1) throw new Error('cannot close the last leaf')

  const rewrite = (node: LayoutNode): LayoutNode | null => {
    if (node.kind === 'leaf') return node.id === id ? null : node

    const kept: LayoutNode[] = []
    const keptSizes: number[] = []
    node.children.forEach((child, i) => {
      const next = rewrite(child)
      if (next === null) return
      kept.push(next)
      keptSizes.push(node.sizes[i] ?? 1 / node.children.length)
    })

    if (kept.length === 0) return null
    if (kept.length === 1) return kept[0] ?? null
    return { ...node, children: kept, sizes: normalize(keptSizes) }
  }

  const next = rewrite(root)
  if (next === null) throw new Error('cannot close the last leaf')
  return next
}

/** The split at `path` — [] is the root, [0] its first child, [0, 1] that child's second. */
function at(root: LayoutNode, path: number[]): LayoutNode {
  let node = root
  for (const i of path) {
    if (node.kind !== 'split') throw new Error(`layout path leaves the tree at index ${i}`)
    const next = node.children[i]
    if (next === undefined) throw new Error(`layout path leaves the tree at index ${i}`)
    node = next
  }
  return node
}

/**
 * Move the boundary between children `index` and `index + 1` of the split at `path` by `delta`.
 *
 * `delta` IS A FRACTION OF THE SPLIT, NOT PIXELS — see `MIN_PANE_FRACTION`. The conversion happens in
 * `layout-view.ts` against a measured element, and it is the only pixel in the layout.
 *
 * IT CLAMPS RATHER THAN REFUSING. A drag that would take either neighbour below the floor stops at the
 * floor and keeps tracking the pointer; refusing outright would make the divider appear stuck and
 * invite a second drag in the same direction.
 *
 * ONLY THE TWO NEIGHBOURS MOVE. Everything else in the split keeps its size, which is what makes a
 * divider a divider rather than a re-layout.
 *
 * **TWO NEIGHBOURS THAT CANNOT BOTH HOLD THE FLOOR DO NOT MOVE.** Where their shares together are under two floors the
 * clamp's bounds cross: the least it may move is more than the most. That is so from a row of 11 equal views, which
 * tiles can build in an area 1,880 px wide, the Stage at any width, and a stored layout can hold. Clamped anyway, the
 * first neighbour would go to the floor whichever way the divider was dragged, and from a row of 20 the second would
 * be left a share of nothing or less: a tree `parseTree` refuses, so the next load would throw the workspace away.
 * The tree is answered as it was given.
 */
export function resize(root: LayoutNode, path: number[], index: number, delta: number): LayoutNode {
  const split = at(root, path)
  if (split.kind !== 'split') throw new Error('resize addressed a leaf')
  const a = split.sizes[index]
  const b = split.sizes[index + 1]
  if (a === undefined || b === undefined) throw new Error(`no divider at index ${index}`)
  if (a + b < 2 * MIN_PANE_FRACTION) return root

  const clamped = Math.max(MIN_PANE_FRACTION - a, Math.min(delta, b - MIN_PANE_FRACTION))
  const sizes = [...split.sizes]
  sizes[index] = a + clamped
  sizes[index + 1] = b - clamped

  const rewrite = (node: LayoutNode, rest: number[]): LayoutNode => {
    if (rest.length === 0) {
      if (node.kind !== 'split') throw new Error('resize addressed a leaf')
      return { ...node, sizes }
    }
    if (node.kind !== 'split') throw new Error('resize path leaves the tree')
    const [head, ...tail] = rest
    return {
      ...node,
      children: node.children.map((c, i) => (i === head ? rewrite(c, tail) : c)),
    }
  }
  return rewrite(root, path)
}

/**
 * The `localStorage` key the layout is stored under.
 *
 * NAMESPACED, for the reason `appearance.ts`'s `STORAGE_KEY` gives: `localStorage` is scoped to an
 * origin and not to an app, so every dev server on the same host shares one store.
 */
export const LAYOUT_STORAGE_KEY = 'redextape.layout'

/** Bumped when the stored shape changes. A mismatch falls back to the default rather than migrating. */
export const LAYOUT_VERSION = 1

/** How far the sum of a split's sizes may drift from 1 before the tree is rejected. */
export const SIZE_EPSILON = 1e-6

/**
 * The most splits a tree may have on any path from its root to a leaf; all four views' default arrangement has 2
 * (Plan 7 part 6a spec §5.3, amended 2026-10-01).
 *
 * **WHAT IT BOUNDS IS THE READING, NOT WHICH TREES PARSE.** A split has two children or more, so a tree 64 splits deep
 * has at least 65 leaves and `MAX_TREE_LEAVES` refuses it anyway. But `validate` reads a split's first child whole
 * before its second, so a tree that nests down its first children reaches no leaf until its deepest split, and the
 * leaf count cannot stop the reading. Unbounded, the recursion would throw `RangeError` on a tree a link can carry.
 * This stops it at the 65th split.
 *
 * **NO ADD CAN REACH IT**: a tree of at most `MAX_TREE_LEAVES` leaves is at most 63 splits deep, so the bound on live
 * views, which holds every add's tree to that many leaves (`pane-host.ts`'s `admit`), holds it to this one too.
 */
const MAX_TREE_DEPTH = 64

/**
 * The most leaves a tree may have; all four views' default arrangement has 4 (spec §5.3, amended 2026-10-01).
 *
 * **A LINK CAN BRING TREES THE STORE NEVER HAD**: 400 λ views took 4.4 s to open, and what a link brings is stored,
 * so every later load would build it again.
 *
 * **THE APP STOPS HERE.** `pane-host.ts`'s `admit` refuses an add that would make a 65th live view, from `+ view` and
 * from a split, in tiles and on the Stage: the views of the tree on screen, and with them the ones a remembered
 * arrangement keeps off it (`arrangements.ts`'s `liveLeaves`). A tree past the bound falls back to the default at the
 * next load. Exported so that nothing which holds the bound or says the number copies it.
 */
export const MAX_TREE_LEAVES = 64

/**
 * Whether `root` already holds `MAX_TREE_LEAVES` leaves, so an add would make a tree the loader refuses —
 * `addRefusal`'s first question.
 *
 * **IT IS THIS MODULE'S OWN REFUSAL, AND NOT WHAT HOLDS THE APP'S ADDS TO THE BOUND.** `pane-host.ts`'s `admit` counts
 * every live view, refuses at the bound, and only then asks `addRefusal`; a tree's leaves are all live views, so a
 * tree this is true of has been refused by then, in tiles and on the Stage. It answers for a caller that hands
 * `addRefusal` a tree and nothing else, which `tests/node/layout.test.ts` does.
 */
export function holdsMostLeaves(root: LayoutNode): boolean {
  return leaves(root).length >= MAX_TREE_LEAVES
}

/**
 * The narrowest a view an add makes, or shrinks, may be, in CSS pixels (the user's decision, 2026-10-04) — and, for a
 * split down, the shortest, since a split down divides height.
 *
 * **PIXELS, WHERE `MIN_PANE_FRACTION` IS A FRACTION, AND THIS MODULE STILL MEASURES NOTHING.** What a view can show
 * is a matter of pixels and not of its share: no floor on a fraction of a split refuses a half, and a view halved
 * again and again goes to 0 px. `addRefusal` is handed the tiled area's size and the dividers' width by its caller,
 * which makes the one measurement (`pane-host.ts`'s `admit`), so the arithmetic here stays a value.
 *
 * **IT GATES THE ADD GESTURES ONLY, AND ONLY IN TILES**: a divider drag keeps `MIN_PANE_FRACTION`, and a window made
 * smaller, a switch that opens the inspector (the Debugger and Stage presets, or the readout switch), a stored layout,
 * a link's layout or an undo can still show a view under it. **THE STAGE IS EXEMPT** (the user's decision, 2026-10-04):
 * a view added there is a tab and nothing on screen shrinks, so `pane-host.ts`'s `admit` holds it to the bound on live
 * views alone, and switching from the Stage to tiles can show what it added under the floor.
 */
export const MIN_VIEW_PX = 160

/** A box's two extents, in CSS pixels. */
export type Extent = { readonly width: number; readonly height: number }

/** Which extent an add divides: a row's width, a column's height. */
export type Axis = keyof Extent

/**
 * The box each leaf of `root` gets when the tree is drawn into `area`, with `gap` pixels between siblings — what
 * `layout-view.ts`'s flex boxes give it.
 *
 * **THE STYLESHEET'S ARITHMETIC, NOT A MEASUREMENT.** Each split's children have a `flex-grow` of their size, a basis
 * of 0 and no minimum, and a divider of fixed width sits between each pair, so a child gets its size's share of the
 * split's extent less its dividers — and nothing, when the dividers alone overrun it. **IT DRAWS A TREE THAT IS NOT
 * ON THE PAGE YET** — the one an add would build — which is why it is arithmetic: in tiles every view of the current
 * tree measures what this says, and the Stage, which mounts one view, is not asked (`pane-host.ts`'s `admit`).
 */
export function leafExtents(root: LayoutNode, area: Extent, gap: number): Map<LeafId, Extent> {
  const out = new Map<LeafId, Extent>()
  const walk = (node: LayoutNode, box: Extent): void => {
    if (node.kind === 'leaf') {
      out.set(node.id, box)
      return
    }
    const along = node.dir === 'row' ? box.width : box.height
    const free = Math.max(0, along - gap * (node.children.length - 1))
    node.children.forEach((child, i) => {
      const share = (node.sizes[i] ?? 0) * free
      walk(child, node.dir === 'row' ? { width: share, height: box.height } : { width: box.width, height: share })
    })
  }
  walk(root, area)
  return out
}

/**
 * Why an add is refused: the tree holds `MAX_TREE_LEAVES` already (`'full'`), a view would come out narrower than
 * `MIN_VIEW_PX` (`'narrow'`), or a split down would leave a half shorter than it (`'short'`). Narrow and short are
 * apart because their remedies are: a wider window, or a taller one.
 */
export type AddRefusal = 'full' | 'narrow' | 'short'

/**
 * Why the add `build` makes to `root` would be refused, or `null` when it may go ahead, drawn into `area` with `gap`
 * between siblings: `'full'` when the tree already holds `MAX_TREE_LEAVES`; `'narrow'` when the view it makes, or any
 * view it makes narrower, would come out under `MIN_VIEW_PX` wide; and, where `divides` is `'height'` (a split down),
 * `'short'` when either half would come out under it tall.
 *
 * **WIDTH IS HELD FOR EVERY ADD, WHATEVER IT DIVIDES** (the user's decision, 2026-10-04: "narrower than 160 px").
 * Held only along the axis the add divides, a split down of a view already under 160 px wide would make a second view
 * as narrow, unrefused. **HEIGHT IS HELD FOR A SPLIT DOWN ALONE**: it is the one add that makes a view shorter. Width
 * is asked first, so a split down short of both is said as narrow.
 *
 * **`build` IS THE ADD ITSELF** — the caller's own `insertBeside` or `splitLeaf` call, handed the new leaf's id — so
 * what is checked is what would be built, and an equal share and a halving are answered by the one function. It is
 * handed an id the tree does not hold, so a refused add mints none.
 *
 * **ONLY A VIEW THE ADD MADE, OR MADE SMALLER ALONG THE AXIS ASKED, IS COUNTED** — any such view, not only the one the
 * add is beside: `+ view` shrinks every view in the row. A view already under the floor that the add leaves alone —
 * dragged there, or drawn there by a narrower window — does not stop it, so a small view somewhere else never blocks an
 * add with room.
 *
 * **FULL BEFORE ROOM**: a wider window cannot make room under the leaf bound, so the notice names the remedy that
 * works. `'full'` is `holdsMostLeaves`' answer, whose doc has why no add the app makes is given it here.
 *
 * **TILES ONLY**: on the Stage nothing on screen shrinks, and `pane-host.ts`'s `admit` does not ask this.
 */
export function addRefusal(
  root: LayoutNode,
  build: (newId: LeafId) => LayoutNode,
  divides: Axis,
  area: Extent,
  gap: number,
): AddRefusal | null {
  if (holdsMostLeaves(root)) return 'full'
  const taken = new Set(leaves(root).map((l) => l.id))
  let probe = 'added'
  while (taken.has(probe)) probe = `${probe}'`
  const before = leafExtents(root, area, gap)
  const after = leafExtents(build(probe), area, gap)
  /** Whether a view the add made, or made smaller along `axis`, comes out under the floor along it. */
  const under = (axis: Axis): boolean =>
    [...after].some(([id, now]) => {
      const was = before.get(id)
      return (was === undefined || now[axis] < was[axis]) && now[axis] < MIN_VIEW_PX
    })
  if (under('width')) return 'narrow'
  if (divides === 'height' && under('height')) return 'short'
  return null
}

/**
 * The largest number a leaf id may carry, as `leafNumber` reads it (spec §5.3, amended 2026-10-01): a number the leaf
 * counter can step past. `main.ts`'s `seedLeafCounter` sets the counter one past the largest number in the tree, and
 * from 2^53 on adding one no longer moves it, so after `pane-1e300` or `pane-9007199254740991` the second view added
 * would mint a duplicate id, and `insertBeside` would throw out of the click. The counter moves by one a view added, so
 * a billion is a billion views added.
 */
const MAX_LEAF_NUMBER = 1_000_000_000

/**
 * The number a leaf id carries, or `null` for one that carries none: what follows its last `-`, or the whole id where
 * it has none, where `Number` reads that as a whole number.
 *
 * **`main.ts`'s `seedLeafCounter` READS IT, AND `validate` BOUNDS IT, THROUGH THIS ONE FUNCTION**, so the number the
 * bound holds is the number the counter steps past. Read through `Number`, not as decimal digits alone, because that is
 * how the counter has always read it: `pane-0x1fffffffffffff` is 2^53 − 1 to it. Every id the app has minted carries
 * one (`lambda-0`, `pane-3`) except `source`.
 */
export function leafNumber(id: LeafId): number | null {
  const n = Number(id.slice(id.lastIndexOf('-') + 1))
  return Number.isInteger(n) ? n : null
}

export function serializeLayout(root: LayoutNode): string {
  return JSON.stringify({ version: LAYOUT_VERSION, tree: root })
}

/**
 * Every `PaneKind`, as the strings a stored leaf's `pane` may hold.
 *
 * **KEYED BY `PaneKind` AND THEN LISTED, RATHER THAN WRITTEN AS A LIST.** It is typed `string[]` because
 * `validate` asks it about a string not yet known to be a kind, and a list typed that way says nothing about
 * the union; even `satisfies readonly PaneKind[]` would say only that each entry is a kind, never that each
 * kind is an entry. A kind left out here would fail `validate` for every stored layout that shows one, and a
 * layout that fails is replaced by the default without a word (`parseWorkspace`'s own doc), so a view of the new
 * kind would be lost on every reload with `tsc` green. The `satisfies` makes a missing kind a type error, and
 * the keys are the list (`legs.ts` has the class of bug). **THE LIST IS `KIND_ORDER`'s**, which is where the
 * `satisfies` is written: one keyed record, read here as strings and there as kinds.
 */
const PANE_KINDS: readonly string[] = KIND_ORDER

/**
 * Validate one node and collect its leaf ids, returning `false` on the first violation.
 *
 * IT CHECKS 5d-ii-a §4.1's INVARIANTS AND NOT ONLY THE SHAPE, WHICH IS THE WHOLE POINT. A single-child split
 * or sizes summing to 1.4 parse perfectly as JSON and then render silently wrong: a pane with wrong
 * padding, or views drawn in proportions other than the fractions their dividers report — a crash
 * would at least be reported. The hazard is a hand-edited entry, so every rejection here is
 * something a person could plausibly type.
 *
 * **AND A LINK, WHICH NO PERSON NEED HAVE TYPED** (Plan 7 part 6a spec §5.3, amended 2026-10-01): a link's workspace is
 * read here too, so the tree is bounded as well as valid. `splitsAbove` counts the splits over `node`.
 */
function validate(node: unknown, ids: Set<string>, splitsAbove: number): node is LayoutNode {
  if (typeof node !== 'object' || node === null) return false
  const n = node as Record<string, unknown>

  if (n.kind === 'leaf') {
    if (typeof n.id !== 'string' || n.id.length === 0) return false
    const number = leafNumber(n.id)
    if (number !== null && number > MAX_LEAF_NUMBER) return false
    if (typeof n.pane !== 'string' || !PANE_KINDS.includes(n.pane)) return false
    // THE SOURCE KIND AND `SOURCE_LEAF` IMPLY EACH OTHER, AND NEITHER DIRECTION IS DECORATION.
    // `parseTree`'s `sources > 1` count below says at most one leaf renders the editor; it does NOT
    // say that leaf is the one every other module means. `SOURCE_LEAF`'s own doc has the consequence:
    // a source leaf under a fresh id "would be a different leaf as far as every one of those is
    // concerned — an empty pane beside a detached editor". `pane-host.ts`'s creation pass skips the
    // source kind because `main.ts` seeds the editor's host under this key before any layout exists,
    // so `{id:'foo', pane:'source'}` reaches the `finally`'s `hostFor('foo', 'source')` and mints an
    // empty `<section>` while the real editor stays mounted in a host the tree no longer names —
    // which the count cannot catch, because one such leaf is not two.
    //
    // THE CONVERSE IS THE SAME FACT FROM THE OTHER SIDE: `{id: SOURCE_LEAF, pane: 'lambda'}` has the
    // creation pass build a `LambdaPane` INTO the host the editor already occupies. One biconditional
    // rather than two rules, because there is one pairing and it is either honoured or not.
    //
    // HERE RATHER THAN BESIDE THE COUNT, because this is a property of ONE leaf and the count is a
    // property of the tree. This function is where the per-leaf rules live and where the hazard is
    // stated: "every rejection here is something a person could plausibly type", and a hand-edited
    // `localStorage` entry is exactly how either spelling arrives.
    if ((n.id === SOURCE_LEAF) !== (n.pane === 'source')) return false
    if (ids.has(n.id)) return false
    ids.add(n.id)
    return ids.size <= MAX_TREE_LEAVES
  }

  if (n.kind !== 'split') return false
  // BEFORE ITS CHILDREN ARE READ, so a deeper tree costs no more to refuse than this split did.
  if (splitsAbove === MAX_TREE_DEPTH) return false
  if (n.dir !== 'row' && n.dir !== 'column') return false
  if (!Array.isArray(n.children) || !Array.isArray(n.sizes)) return false
  if (n.children.length < 2) return false
  if (n.children.length !== n.sizes.length) return false
  if (!n.sizes.every((s: unknown) => typeof s === 'number' && Number.isFinite(s) && s > 0)) return false
  const total = (n.sizes as number[]).reduce((a, b) => a + b, 0)
  if (Math.abs(total - 1) > SIZE_EPSILON) return false
  return n.children.every((c: unknown) => validate(c, ids, splitsAbove + 1))
}

/**
 * A bare tree, validated — `parseLayout`'s check without the envelope, for `workspace.ts`, whose version 2
 * envelope carries the same tree under different neighbours.
 *
 * THE SAME TWO RULES AND NO THIRD: every node passes `validate`, and at most one leaf is the source leaf.
 * Split out rather than duplicated because the envelope is the only thing the two formats disagree about.
 * `validate` holds the bound on depth and leaves, so the `leaves` below, which recurses, walks only a tree within it.
 */
export function parseTree(tree: unknown): LayoutNode | null {
  const ids = new Set<string>()
  if (!validate(tree, ids, 0)) return null
  const sources = leaves(tree).filter((l) => l.pane === 'source').length
  if (sources > 1) return null
  return tree
}

/**
 * The stored layout, or `null` if there is nothing usable there.
 *
 * `null` RATHER THAN A THROW OR A DEFAULT: returning a default from here would make "there was nothing
 * stored" and "what was stored was garbage" indistinguishable to a test. Failure is silent to the user
 * by 5d-ii-a design §4.4: a layout is a preference, and a banner on every load after a schema bump is
 * worse than what it reports.
 */
export function parseLayout(raw: string | null): LayoutNode | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const envelope = parsed as Record<string, unknown>
  if (envelope.version !== LAYOUT_VERSION) return null

  return parseTree(envelope.tree)
}
