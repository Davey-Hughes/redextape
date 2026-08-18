import type { LeafId, PaneKind } from './panes'

export type Dir = 'row' | 'column'

/**
 * THE LAYOUT TREE — design §4.1.
 *
 * A LEAF CARRIES A `PaneKind`, NOT A `Leg`, AND NOT A SESSION. `'source'` is not a `Leg` — the source
 * pane renders an editor rather than a leg's frames — so a `Leg`-typed field could not name it. The
 * session is absent because the runtime pairing lives in `panes.ts`, keyed by `LeafId`, and that
 * absence is what keeps this module free of `SessionRegistry` and therefore testable as a value.
 *
 * **THE OTHER HALF OF THAT SENTENCE IS SPENT, AND THE CONCLUSION SURVIVES IT.** It read "no binding is
 * persistable (design §3.3: no scratch survives a reload, so a stored binding has exactly one value
 * that could ever resolve)". 5d-ii-d makes scratch buffers survive a reload, so a stored binding now
 * has as many resolvable values as there are buffers — but it still does not belong HERE. A binding is
 * meaningless without the buffer it names, so the two are persisted together under
 * `redextape.buffers` (`buffers-store.ts`'s `PersistedBuffers`, design §4.1): "this key is absent or
 * garbage" then degrades to no bindings at all rather than to a tree full of names nothing can
 * resolve, and no reconciliation pass has to exist. `redextape.layout` stays at `version: 1` because
 * this shape did not change — which is the practical dividend of having kept the session out of it.
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
 * 0.1 IS A CHOICE, NOT A MEASUREMENT, and is recorded as such: at a 1,200px window a 10% floor is
 * ~120px, which is wider than the δ-table's narrowest column and about four characters of λ text.
 * Nothing was measured to pick it; if a pane turns out to be unusable at the floor, the number moves.
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
 * EXPORTED NOW THAT A SECOND MODULE MINTS ONE. It was a literal in `defaultLayout()` below and three
 * more in `main.ts` while the only source leaf was the one a fresh page shipped; `pane-host.ts`'s split
 * handler creating one through the picker is what made "the id is the same id" a claim two files have to
 * agree on rather than a spelling.
 */
export const SOURCE_LEAF: LeafId = 'source'

/**
 * The arrangement `index.html` ships, as a tree — design §4.1.
 *
 * Two columns holding source and λ, with TM spanning beneath them — the same visual shape a two-column
 * CSS grid with a spanning `.pane.wide` row once produced, before the layout tree replaced both. Nothing
 * in `style.css` names this arrangement anymore: `main`'s one remaining rule just sets up a flex column
 * for whatever tree is mounted, and the shape here comes entirely from this tree's own nesting (an outer
 * column split holding a row split of source/λ above the TM leaf) and its `sizes`, which `layout-view.ts`
 * turns into each host's `flex-grow`. A user who never touches a divider sees no change, which is why
 * this exact shape rather than a tidier one.
 */
export function defaultLayout(): LayoutNode {
  return {
    kind: 'split',
    dir: 'column',
    sizes: [0.5, 0.5],
    children: [
      {
        kind: 'split',
        dir: 'row',
        sizes: [0.5, 0.5],
        children: [
          { kind: 'leaf', id: SOURCE_LEAF, pane: 'source' },
          { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
        ],
      },
      { kind: 'leaf', id: 'tm-0', pane: 'tm' },
    ],
  }
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
 * Replace the leaf `id` with a split holding it and a new leaf of `kind`.
 *
 * `kind` IS THE CALLER'S CHOICE, NOT A COPY OF THE SPLIT LEAF'S. It used to be: splitting the λ pane
 * gave a second λ pane, which the binding selector 5d-i shipped could then point at a scratch, and
 * that was "two λ sessions side by side" with `PaneSlot<K>` untouched. A caller that still wants that
 * passes the same kind back — the picker's first entry, labelled `(same)`, is exactly that request, and
 * it is what `pane-host.ts`'s split handler forwards here — but the tree itself no longer decides.
 *
 * THIS FUNCTION HAS TWO `'source'` REFUSALS, ON TWO DIFFERENT ARGUMENTS, AND THEY ARE NOT THE SAME
 * REFUSAL (design §4.2a):
 *
 * | argument | refusal |
 * | --- | --- |
 * | `id`, the leaf being split | always, if it is `'source'` — unchanged from before this kind existed |
 * | `kind`, the leaf being created | only if a `'source'` leaf is already in the tree |
 *
 * THE SUBJECT'S REFUSAL IS UNCONDITIONAL because there is one editor, so there is nothing to duplicate
 * into, and a split producing an undefined second thing is the fabricated state `session.rs`'s
 * `Session::tm` prices. `layout-view.ts` does not render a split control on the source pane at all — this throw is
 * the backstop for a caller that got there another way, not the UI.
 *
 * THE TARGET'S REFUSAL IS CONDITIONAL, ON PURPOSE: this function must be able to CREATE a source leaf
 * — letting a closed source pane come back without discarding the whole layout is the capability that
 * needs it, and it has shipped: `pane-chrome.ts`'s picker offers `source` exactly while the tree has
 * none, and `pane-host.ts`'s split handler makes that call with `SOURCE_LEAF` — while still enforcing
 * "at most one source leaf" on a tree that already has one. The UI's own `sourceAvailable` and this
 * refusal ask the same question of the same tree; this one is what holds when a caller does not.
 * `setLeafKind` below refuses `'source'` as a target unconditionally instead, because a pane never
 * BECOMES the source pane; that they read as the same guard is exactly why its own doc restates this
 * table rather than pointing here.
 *
 * `newId` IS REFUSED IF IT IS ALREADY IN THE TREE. `findLeaf` resolves an id with `.find()`, so a
 * duplicate would not error — it would silently make the second leaf unreachable, present in the tree
 * but never returned. `parseLayout` already treats a duplicate id as an invalid tree on load, so this
 * refusal keeps the tree unable to reach that state in the first place rather than only detecting it
 * after the fact.
 */
export function splitLeaf(root: LayoutNode, id: LeafId, dir: Dir, newId: LeafId, kind: PaneKind): LayoutNode {
  const target = findLeaf(root, id)
  if (target === null) throw new Error(`cannot split a leaf that is not in the tree: ${id}`)
  if (target.pane === 'source') throw new Error('the source pane cannot be split: there is one editor to duplicate')
  if (kind === 'source' && hasSource(root)) throw new Error('the tree already has a source leaf')
  if (findLeaf(root, newId) !== null) throw new Error(`cannot split into an id already in the tree: ${newId}`)

  const rewrite = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'leaf') {
      if (node.id !== id) return node
      return {
        kind: 'split',
        dir,
        sizes: [0.5, 0.5],
        children: [node, { kind: 'leaf', id: newId, pane: kind }],
      }
    }
    return { ...node, children: node.children.map(rewrite) }
  }
  return rewrite(root)
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
 * A `'source'` LEAF IS ALSO REFUSED AS THE SUBJECT, for `splitLeaf`'s reason one line up: the editor
 * would be left with no host in the tree.
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
 * THE LAST LEAF CANNOT GO. An empty tree has no honest rendering, and `layout-view.ts` omits the close
 * control when one leaf remains, so this throw is a backstop rather than the mechanism.
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
 */
export function resize(root: LayoutNode, path: number[], index: number, delta: number): LayoutNode {
  const split = at(root, path)
  if (split.kind !== 'split') throw new Error('resize addressed a leaf')
  const a = split.sizes[index]
  const b = split.sizes[index + 1]
  if (a === undefined || b === undefined) throw new Error(`no divider at index ${index}`)

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
const SIZE_EPSILON = 1e-6

export function serializeLayout(root: LayoutNode): string {
  return JSON.stringify({ version: LAYOUT_VERSION, tree: root })
}

const PANE_KINDS: readonly string[] = ['source', 'lambda', 'tm']

/**
 * Validate one node and collect its leaf ids, returning `false` on the first violation.
 *
 * IT CHECKS §4.1's INVARIANTS AND NOT ONLY THE SHAPE, WHICH IS THE WHOLE POINT. A single-child split
 * or sizes summing to 1.4 parse perfectly as JSON and then render as a pane with wrong padding or a
 * gap where a divider should be — a crash would at least be reported. The hazard is a hand-edited
 * entry, so every rejection here is something a person could plausibly type.
 */
function validate(node: unknown, ids: Set<string>): node is LayoutNode {
  if (typeof node !== 'object' || node === null) return false
  const n = node as Record<string, unknown>

  if (n.kind === 'leaf') {
    if (typeof n.id !== 'string' || n.id.length === 0) return false
    if (typeof n.pane !== 'string' || !PANE_KINDS.includes(n.pane)) return false
    // THE SOURCE KIND AND `SOURCE_LEAF` IMPLY EACH OTHER, AND NEITHER DIRECTION IS DECORATION.
    // `parseLayout`'s `sources > 1` count below says at most one leaf renders the editor; it does NOT
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
    return true
  }

  if (n.kind !== 'split') return false
  if (n.dir !== 'row' && n.dir !== 'column') return false
  if (!Array.isArray(n.children) || !Array.isArray(n.sizes)) return false
  if (n.children.length < 2) return false
  if (n.children.length !== n.sizes.length) return false
  if (!n.sizes.every((s: unknown) => typeof s === 'number' && Number.isFinite(s) && s > 0)) return false
  const total = (n.sizes as number[]).reduce((a, b) => a + b, 0)
  if (Math.abs(total - 1) > SIZE_EPSILON) return false
  return n.children.every((c: unknown) => validate(c, ids))
}

/**
 * The stored layout, or `null` if there is nothing usable there.
 *
 * `null` RATHER THAN A THROW OR A DEFAULT. The caller already knows what the default is
 * (`defaultLayout()`), and returning it from here would make "there was nothing stored" and "what was
 * stored was garbage" indistinguishable to a test. Failure is silent to the user by design §4.4: a
 * layout is a preference, and a banner on every load after a schema bump is worse than what it
 * reports.
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

  const ids = new Set<string>()
  const tree = envelope.tree
  if (!validate(tree, ids)) return null

  const sources = leaves(tree).filter((l) => l.pane === 'source').length
  if (sources > 1) return null

  return tree
}
