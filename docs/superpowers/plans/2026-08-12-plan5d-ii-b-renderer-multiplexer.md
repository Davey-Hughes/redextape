# 5d-ii-b — the renderer multiplexer: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pane can change what it shows — its `(leg, session)` pair — in place, and the split controls create a pane of any kind instead of duplicating the one they were clicked on.

**Architecture:** `PaneSlot<K extends Leg>` is never widened. A leg change replaces the whole `PaneEntry` (slot + view) in the same host under the same `LeafId`, which `applyLayout`'s two existing passes already do for a close-then-create — so the feature is two predicate changes rather than a new code path. The pane's session selector widens to a list of `(leg, session)` pairs, because a session has at most one leg per `Leg` and the two axes are therefore not independent.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), Vitest (node + browser projects), Playwright/Chromium for the browser tier, Biome for lint/format, plain DOM — no framework.

**Design:** [`../specs/2026-08-12-plan5d-ii-b-renderer-multiplexer-design.md`](../specs/2026-08-12-plan5d-ii-b-renderer-multiplexer-design.md)

## Global Constraints

- **`PaneSlot<K extends Leg>` is not widened, and `Binding<K>`'s `leg` field gains no writer.** Design decision 1 / §3.1. If a task appears to need one, the task is wrong.
- **The pre-commit gate runs on every commit and must never be bypassed.** `scripts/check-text-bytes.sh` (all tracked text), `biome ci --error-on-warnings` (`^web/.*\.(js|ts|jsx|tsx|json|css)$`), `pnpm run typecheck` (`^web/.*\.(ts|tsx)$`). **Never use `--no-verify`.**
- **Therefore each task commits ONCE, after its tests pass — not twice around a red test.** A commit holding a test that references a not-yet-existing export fails `tsc --noEmit`, so the TDD red step is *run*, not *committed*. This is the repo's established practice, not a shortcut.
- **No literal control bytes in source.** `pane-chrome.ts` encodes delimiters as `\x00` / `\x01` escapes; `check-text-bytes.sh` enforces it. Two literal NUL bytes once made that file invisible to `rg` and `grep`. Do not "tidy" escapes into literals.
- **Doc-comment convention: `///` in Rust, `/** */` in TypeScript.** No `///` in `web/`.
- **Every new exported symbol carries a doc comment stating the argument for its shape**, matching the density of the file it lands in. This codebase records *why*, not *what*.
- **Test commands:**
  - all: `cd web && pnpm test`
  - node tier only: `cd web && pnpm test:node`
  - browser tier only: `cd web && pnpm test:browser`
  - one file: `cd web && pnpm exec vitest run --project node tests/node/layout.test.ts` — **a bare `-- <name>` filter does not scope files**, so always name the path.
  - types: `cd web && pnpm run typecheck`
- **Coverage floors are 93/87/95/96** (statements/branches/functions/lines) in `vite.config.ts`. Do not lower them. Task 12 re-measures.

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `web/src/editor-custody.ts` | **create** | `heldEditors`, `editorOwner`, `reconcileEditors`, `editorHomeFor`, claim/drop. Knows `LeafId`, `SessionId`, `LambdaEditor`. Knows nothing about the layout tree. |
| `web/src/pane-host.ts` | **create** | `hosts`/`hostFor`, `pendingBinding`, `paneEvents`, `applyLayout`, `focusPane`. Calls into custody; custody never calls back. |
| `web/src/layout.ts` | modify | `setLeafKind` added; `splitLeaf` takes the new leaf's kind. |
| `web/src/sessions.ts` | modify | `pairs()` added; `PaneView.setBindings` widens. `PaneSlot` untouched. |
| `web/src/panes.ts` | modify | `first` → `active`, plus `markActive`. |
| `web/src/pane-chrome.ts` | modify | `bindingSelect` → `paneSelect`; `layoutControls` gains the picker; `PaneChoice` and the widened `PaneEvents` members. |
| `web/src/main.ts` | modify | Shrinks by the extraction; `pane-${n}` ids; wires `focusin`. |
| `web/src/draw.ts`, `web/src/link-wiring.ts` | modify | `first` → `active` at their four call sites. |
| `web/src/style.css` | modify | The picker menu's rules. |

---

## Task 1: Extract `editor-custody.ts`

**Files:**
- Create: `web/src/editor-custody.ts`
- Modify: `web/src/main.ts` (remove the moved symbols, import the factory)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export type EditorCustody = {
    /** Take an unmounted editor into custody under the session it belongs to. */
    hold(session: SessionId, editor: LambdaEditor): void
    /** Record that `leaf` is where `session`'s editor should live. */
    claim(session: SessionId, leaf: LeafId): void
    /** Drop any claim naming `leaf` — called when a fresh pane arrives at that id. */
    dropClaimsOn(leaf: LeafId): void
    /** The pane currently showing `session`'s editor, or `undefined`. */
    homeFor(session: SessionId): LambdaPane | undefined
    /** Move held editors onto their claimed homes and retire orphans. Throws as it does today. */
    reconcile(): void
  }
  export function createEditorCustody(deps: {
    panes: PaneCollection
    sessions: SessionRegistry
  }): EditorCustody
  ```

**This is a pure move. No behaviour changes.** Do not fix, rename or simplify anything you move — a wave-1 commit that also changes what the app does is the commit that makes a later bisect useless (design §4.1). The bodies are already written in `main.ts`; carry them across verbatim, including every doc comment, and adjust only what the closure-to-parameter change forces.

- [ ] **Step 1: Read the code being moved**

Read `web/src/main.ts:395-440` (`editorOwner`, `heldEditors`) and `web/src/main.ts:749-895` (`editorHomeFor`, `reconcileEditors`). Note every symbol from `main()`'s scope that these bodies reference — that set becomes `deps` plus the closure state the module now owns.

- [ ] **Step 2: Create the module**

Create `web/src/editor-custody.ts` following `link-wiring.ts:63-69`'s shape — a factory taking `deps` and returning an API object. `heldEditors` and `editorOwner` become module-private `Map`s inside the factory. Move their doc comments with them unchanged; they are the record of three review rounds and must not be summarized.

- [ ] **Step 3: Rewrite `main.ts` to use it**

Replace the moved declarations with:

```ts
const custody = createEditorCustody({ panes, sessions })
```

Update every call site in `main.ts`. `editorOwner.set(s, id)` becomes `custody.claim(s, id)`; `editorHomeFor(s)` becomes `custody.homeFor(s)`; `reconcileEditors()` becomes `custody.reconcile()`; the `applyLayout` handover writes `custody.hold(session, held)`; `main.ts:713`'s claim-dropping loop becomes `custody.dropClaimsOn(l.id)`.

- [ ] **Step 4: Verify no behaviour changed**

Run: `cd web && pnpm run typecheck && pnpm test`
Expected: PASS, **453 passed (453) in 47 files** — the same count and the same files as before the move. A changed count means this was not a pure move.

- [ ] **Step 5: Commit**

```bash
git add web/src/editor-custody.ts web/src/main.ts
git commit -m "editor custody leaves main.ts unchanged, which is the only thing wave 1 is allowed to do"
```

---

## Task 2: Extract `pane-host.ts`

**Files:**
- Create: `web/src/pane-host.ts`
- Modify: `web/src/main.ts`

**Interfaces:**
- Consumes: `createEditorCustody` / `EditorCustody` (Task 1).
- Produces:
  ```ts
  export type PaneHost = {
    /** Reconcile panes to leaves, re-render the tree, persist it, and draw. */
    applyLayout(): void
    /** The host element for `id`, created on first request and kept forever after. */
    hostFor(id: LeafId, kind: PaneKind): HTMLElement
    /** A pane's events, including the layout gestures the pane itself cannot answer. */
    paneEvents<K extends Leg>(id: LeafId, slot: PaneSlot<K>): PaneEvents
    /** Move focus into `id`'s pane after a close. */
    focusPane(id: LeafId | null): void
    /** Pre-seed the source pane's host, which main.ts owns the contents of. */
    seedHost(id: LeafId, host: HTMLElement): void
  }
  export function createPaneHost(deps: {
    root: HTMLElement
    panes: PaneCollection
    sessions: SessionRegistry
    custody: EditorCustody
    transport: Transport
    getTree(): LayoutNode
    setTree(next: LayoutNode): void
    draw(): void
  }): PaneHost
  ```

**Another pure move.** Same rule as Task 1.

- [ ] **Step 1: Read the code being moved**

Read `web/src/main.ts:424-458` (`pendingBinding`, `hosts`, `hostFor`), `:551-596` (`paneEvents`), `:622-627` (`focusPane`), `:629-747` (`applyLayout`).

- [ ] **Step 2: Create the module**

`tree` is a `let` in `main()` that `applyLayout` reads and `paneEvents` writes. It stays in `main.ts` and crosses the boundary as the `getTree`/`setTree` pair in `deps` — **not as a mutable export**, which would be a second place the current tree lives.

`seedHost` exists for one caller: `main.ts` builds the source pane's host itself, because that host contains `#editor` and `#link-status`, which `main.ts` constructs `view` and `linkWiring` against (`main.ts:460-473`). Seeding it before `applyLayout` first runs is what lets `hostFor('source', 'source')` find it rather than build an empty section.

- [ ] **Step 3: Rewrite `main.ts` to use it**

```ts
const paneHost = createPaneHost({
  root, panes, sessions, custody, transport,
  getTree: () => tree,
  setTree: (next) => { tree = next },
  draw,
})
paneHost.seedHost('source', sourceHost)
```

Replace every bare call with its `paneHost.` form.

- [ ] **Step 4: Verify no behaviour changed**

Run: `cd web && pnpm run typecheck && pnpm test`
Expected: PASS, **453 passed (453) in 47 files**.

- [ ] **Step 5: Measure and record**

Run: `wc -l web/src/main.ts web/src/pane-host.ts web/src/editor-custody.ts`
Note the three numbers in the commit body. roadmap:5932 asked whether 1,115 lines in one file was a problem to inherit; this is the answer with evidence attached.

- [ ] **Step 6: Commit**

```bash
git add web/src/pane-host.ts web/src/main.ts
git commit -m "pane lifecycle leaves main.ts, and roadmap:5932's open question gets a number"
```

---

## Task 3: `layout.ts` — `setLeafKind`, and `splitLeaf` takes a kind

**Files:**
- Modify: `web/src/layout.ts`
- Test: `web/tests/node/layout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export function setLeafKind(root: LayoutNode, id: LeafId, kind: PaneKind): LayoutNode
  export function splitLeaf(root: LayoutNode, id: LeafId, dir: Dir, newId: LeafId, kind: PaneKind): LayoutNode
  ```

**The two `'source'` refusals are about different arguments and must not be conflated** (design §4.2a):

| function | argument | refusal |
| --- | --- | --- |
| `splitLeaf` | the leaf being split (`id`) | always, if it is `'source'` — unchanged |
| `splitLeaf` | the kind being created (`kind`) | only if a `'source'` leaf is already in the tree |
| `setLeafKind` | the target kind | **always**, even on a tree with no source leaf |
| `setLeafKind` | the leaf being changed (`id`) | always, if it is `'source'` |

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/node/layout.test.ts`:

```ts
describe('setLeafKind', () => {
  const tree = (): LayoutNode => ({
    kind: 'split',
    dir: 'row',
    sizes: [0.3, 0.7],
    children: [leaf('source', 'source'), leaf('a', 'lambda')],
  })

  it('changes the kind and touches nothing else', () => {
    const next = setLeafKind(tree(), 'a', 'tm')
    expect(leaves(next).map((l) => [l.id, l.pane])).toEqual([
      ['source', 'source'],
      ['a', 'tm'],
    ])
    // Decision 1 is that the pane keeps its place: same shape, same sizes.
    expect(next).toMatchObject({ kind: 'split', dir: 'row', sizes: [0.3, 0.7] })
  })

  it('refuses source as a target even when the tree has no source leaf', () => {
    // The condition that lets the PICKER create a source pane is exactly the condition a reader
    // expects to unlock this. Decision 4 is why it does not: a pane never becomes the source pane.
    const noSource: LayoutNode = {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leaf('a', 'lambda'), leaf('b', 'tm')],
    }
    expect(() => setLeafKind(noSource, 'a', 'source')).toThrow(/source/)
  })

  it('refuses to change the source leaf', () => {
    expect(() => setLeafKind(tree(), 'source', 'lambda')).toThrow(/source/)
  })

  it('refuses an id that is not in the tree', () => {
    expect(() => setLeafKind(tree(), 'nope', 'tm')).toThrow(/not in the tree/)
  })
})

describe('splitLeaf with an explicit kind', () => {
  const twoLeaves = (): LayoutNode => ({
    kind: 'split',
    dir: 'row',
    sizes: [0.5, 0.5],
    children: [leaf('source', 'source'), leaf('a', 'lambda')],
  })

  it('creates a leaf of the requested kind, not the split leaf’s', () => {
    const next = splitLeaf(twoLeaves(), 'a', 'row', 'b', 'tm')
    expect(leaves(next).find((l) => l.id === 'b')?.pane).toBe('tm')
  })

  it('still refuses to split the source leaf, whatever kind is requested', () => {
    expect(() => splitLeaf(twoLeaves(), 'source', 'row', 'b', 'lambda')).toThrow(/source/)
  })

  it('refuses to create a second source leaf', () => {
    expect(() => splitLeaf(twoLeaves(), 'a', 'row', 'b', 'source')).toThrow(/source/)
  })

  it('creates a source leaf when the tree has none', () => {
    const noSource: LayoutNode = {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leaf('a', 'lambda'), leaf('b', 'tm')],
    }
    const next = splitLeaf(noSource, 'a', 'row', 'c', 'source')
    expect(leaves(next).find((l) => l.id === 'c')?.pane).toBe('source')
  })
})
```

Add `setLeafKind` to the import block at the top of the file.

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && pnpm exec vitest run --project node tests/node/layout.test.ts`
Expected: FAIL — `setLeafKind is not a function`, and the `splitLeaf` calls fail typecheck on arity.

- [ ] **Step 3: Implement**

In `web/src/layout.ts`, add a helper and the new function:

```ts
/** Whether a `'source'` leaf is already in the tree — the "at most one source leaf" invariant, asked. */
function hasSource(root: LayoutNode): boolean {
  return leaves(root).some((l) => l.pane === 'source')
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
```

Change `splitLeaf`'s signature and its kind source:

```ts
export function splitLeaf(root: LayoutNode, id: LeafId, dir: Dir, newId: LeafId, kind: PaneKind): LayoutNode {
  const target = findLeaf(root, id)
  if (target === null) throw new Error(`cannot split a leaf that is not in the tree: ${id}`)
  if (target.pane === 'source') throw new Error('the source pane cannot be split: there is one editor to duplicate')
  if (kind === 'source' && hasSource(root)) throw new Error('the tree already has a source leaf')
  if (findLeaf(root, newId) !== null) throw new Error(`cannot split into an id already in the tree: ${newId}`)
  // …rewrite unchanged except the new leaf takes `kind` rather than `node.pane`
}
```

Amend `splitLeaf`'s doc comment: the paragraph beginning *"THE NEW LEAF DUPLICATES THE KIND, WHICH IS WHY THIS SLICE NEEDS NO PICKER"* (`layout.ts:87-90`) is now false and must be rewritten to state the two-refusals table above, not deleted.

- [ ] **Step 4: Fix the existing callers**

`splitLeaf`'s two call sites are in `pane-host.ts` (`splitRow`, `splitColumn`, moved there by Task 2). Pass `slot.binding.leg` for now — Task 10 replaces it with the picker's choice. Existing `layout.test.ts` `splitLeaf` calls need the fifth argument too.

- [ ] **Step 5: Run to verify they pass**

Run: `cd web && pnpm exec vitest run --project node tests/node/layout.test.ts && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/layout.ts web/src/pane-host.ts web/tests/node/layout.test.ts
git commit -m "layout: a leaf can change kind, and the two source refusals are not the same refusal"
```

---

## Task 4: `sessions.ts` — `pairs()`

**Files:**
- Modify: `web/src/sessions.ts`
- Test: `web/tests/node/sessions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type PaneOption = { readonly leg: Leg; readonly id: SessionId; readonly label: string }
  // on SessionRegistry:
  pairs(): PaneOption[]
  ```

- [ ] **Step 1: Write the failing test**

Append to `web/tests/node/sessions.test.ts` (reuse whatever registry helper the file already defines for building entries):

```ts
describe('SessionRegistry.pairs', () => {
  it('omits the pair a session has no leg for', () => {
    // THE CLAIM: an invalid (leg, session) pair is ABSENT FROM THE LIST rather than rejected when
    // selected. `legOf` throws on a binding naming a missing leg, so a selector that offered
    // (tm, scratch) would be the one way a user gesture could reach that throw.
    const reg = new SessionRegistry()
    reg.add({ id: 'source', label: 'source', detached: false, legs: { lambda: legState(), tm: legState() } })
    reg.add({ id: 'scratch-1', label: 'scratch 1', detached: true, legs: { lambda: legState() } })

    expect(reg.pairs()).toEqual([
      { leg: 'lambda', id: 'source', label: 'source' },
      { leg: 'lambda', id: 'scratch-1', label: 'scratch 1' },
      { leg: 'tm', id: 'source', label: 'source' },
    ])
  })

  it('groups by leg and keeps registration order within each', () => {
    const reg = new SessionRegistry()
    reg.add({ id: 'a', label: 'a', detached: false, legs: { lambda: legState(), tm: legState() } })
    reg.add({ id: 'b', label: 'b', detached: false, legs: { lambda: legState(), tm: legState() } })
    expect(reg.pairs().map((p) => `${p.leg}:${p.id}`)).toEqual(['lambda:a', 'lambda:b', 'tm:a', 'tm:b'])
  })
})
```

If the file has no `legState()` helper, write one that returns a minimal `LegState` — the existing `SessionEntry` fixtures in that file show the shape.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run --project node tests/node/sessions.test.ts`
Expected: FAIL — `reg.pairs is not a function`.

- [ ] **Step 3: Implement**

In `web/src/sessions.ts`, near `Leg`'s other uses:

```ts
/**
 * The two legs, in the order a selector lists them.
 *
 * A VALUE RATHER THAN A KEY WALK OVER SOME ENTRY'S `legs`, because the order must not depend on which
 * legs the first session in the registry happens to have.
 */
const LEGS = ['lambda', 'tm'] as const satisfies readonly Leg[]

/** One `(leg, session)` pair a pane may be pointed at, with the label the selector shows. */
export type PaneOption = { readonly leg: Leg; readonly id: SessionId; readonly label: string }
```

And on `SessionRegistry`, beside `options`:

```ts
/**
 * Every `(leg, session)` pair a pane may be pointed at — `options` for both legs, tagged.
 *
 * IT IS BUILT FROM `options`' OWN SOURCE OF TRUTH AND NOT FROM A SECOND TABLE. `options`' doc states
 * the property this inherits: "the legs an entry was built with ARE the answer, so the selector and
 * the resolver cannot disagree about what is bindable." Widening the selector from one axis to two is
 * exactly the change that would have made a second table tempting, and a second table is how a
 * selector comes to offer a pair `legOf` throws on.
 *
 * GROUPED BY LEG RATHER THAN BY SESSION, because that is how the control renders it — one `<optgroup>`
 * per leg. Registration order holds within each group, for `options`' reason: it falls out without a
 * comparator that would have to invent a rank.
 */
pairs(): PaneOption[] {
  const out: PaneOption[] = []
  for (const leg of LEGS) {
    for (const entry of this.#entries.values()) {
      if (entry.legs[leg] !== undefined) out.push({ leg, id: entry.id, label: entry.label })
    }
  }
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && pnpm exec vitest run --project node tests/node/sessions.test.ts && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/sessions.ts web/tests/node/sessions.test.ts
git commit -m "sessions: the pairs a pane may be pointed at, from the one table that already knows"
```

---

## Task 5: `panes.ts` — `markActive` / `active`

**Files:**
- Modify: `web/src/panes.ts`, `web/src/draw.ts:65-66`, `web/src/link-wiring.ts:92-93`
- Test: `web/tests/node/panes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  // on PaneCollection:
  markActive(id: LeafId): void
  active<K extends Leg>(leg: K): PaneEntry<K> | undefined   // replaces first()
  ```

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/node/panes.test.ts`:

```ts
describe('active', () => {
  it('falls back to insertion order when nothing is marked', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'source'))
    expect(panes.active('lambda')?.id).toBe('a')
  })

  it('returns the marked pane', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'source'))
    panes.markActive('b')
    expect(panes.active('lambda')?.id).toBe('b')
  })

  it('falls back when the marked pane was removed', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'source'))
    panes.markActive('b')
    panes.remove('b')
    expect(panes.active('lambda')?.id).toBe('a')
  })

  it('falls back when the marked leaf changed leg', () => {
    // THE KIND CHANGE. `markActive` recorded lambda -> 'b'; 'b' is now a TM pane under the same id,
    // so it is no longer an answer to "which lambda pane is active". Design §4.2c.
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'source'))
    panes.markActive('b')
    panes.remove('b')
    panes.add(tmEntry('b', 'source'))
    expect(panes.active('lambda')?.id).toBe('a')
    expect(panes.active('tm')?.id).toBe('b')
  })

  it('is undefined for a leg with no pane', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    expect(panes.active('tm')).toBeUndefined()
  })

  it('ignores a mark for an id it does not hold', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.markActive('ghost')
    expect(panes.active('lambda')?.id).toBe('a')
  })
})
```

Rename the file's three existing `first` assertions (`panes.test.ts:81`, `:83`, `:91-92`) to `active`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && pnpm exec vitest run --project node tests/node/panes.test.ts`
Expected: FAIL — `panes.active is not a function`.

- [ ] **Step 3: Implement**

In `web/src/panes.ts`, add the field and replace `first`:

```ts
  #activeByLeg = new Map<Leg, LeafId>()

  /**
   * Record that `id`'s pane is the one the user is working in.
   *
   * IT TAKES A `LeafId` AND DERIVES THE LEG, WHICH IS WHAT KEEPS THIS MODULE FREE OF THE DOM. The
   * caller is a `focusin` listener in `pane-host.ts` and knows only which host fired; the collection
   * already holds the entry that says which leg that is, so asking the caller would be asking it to
   * carry a fact this class owns.
   *
   * AN UNKNOWN ID IS IGNORED RATHER THAN THROWN ON. Focus can land in a host whose entry has already
   * been removed — a close repaints and moves focus in the same tick — and that is a race, not a
   * wiring bug.
   */
  markActive(id: LeafId): void {
    const entry = this.#entries.get(id)
    if (entry === undefined) return
    this.#activeByLeg.set(entry.slot.binding.leg, id)
  }

  /**
   * The pane on `leg` whose state the app's shared surfaces should describe.
   *
   * THIS REPLACES `first`, AND IT IS THE ANSWER TO THE QUESTION `first`'s DOC DEFERRED to this slice:
   * "which pane's state should win once several disagree". The two consumers — `draw.ts`'s
   * running-focus decoration and `link-wiring.ts`'s `detachedPanes` — drive the ONE source editor and
   * the ONE status line, so with several panes on a leg they need a pane the user can CHOOSE, and
   * clicking into one is that choice.
   *
   * PER LEG RATHER THAN ONE GLOBAL ACTIVE PANE. Clicking into the source editor must not blank out
   * which λ pane the status line is describing; the source editor is on neither leg.
   *
   * THE LEG IS RE-CHECKED RATHER THAN TRUSTED, AND THAT IS THE KIND CHANGE RATHER THAN DEFENSIVE
   * STYLE. `markActive` may have recorded `lambda -> 'pane-3'` before `pane-3` became a TM pane; the
   * entry under that id is now a different pane on a different leg.
   *
   * THE FALLBACK IS EXACTLY THE OLD `first`, so the single-pane case and the empty-leg case are
   * unchanged — including the `undefined`, which four modules once each answered privately with a
   * throw. A leg with no pane is a state, not a wiring bug.
   */
  active<K extends Leg>(leg: K): PaneEntry<K> | undefined {
    const marked = this.#activeByLeg.get(leg)
    if (marked !== undefined) {
      const entry = this.#entries.get(marked)
      if (entry !== undefined && entry.slot.binding.leg === leg) return entry as PaneEntry<K>
    }
    for (const e of this.#entries.values()) {
      if (e.slot.binding.leg === leg) return e as PaneEntry<K>
    }
    return undefined
  }
```

- [ ] **Step 4: Convert the four call sites**

`draw.ts:65-66` and `link-wiring.ts:92-93`: `panes.first(` → `panes.active(`. Update the surrounding doc comments in both files — `draw.ts:59-64` and `link-wiring.ts:80-91` each say `PaneCollection.first` is "the one place that answers this question" and `draw.ts` names the deferral explicitly. Both are now stale.

- [ ] **Step 5: Run to verify they pass**

Run: `cd web && pnpm test && pnpm run typecheck`
Expected: PASS, 453+6 tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/panes.ts web/src/draw.ts web/src/link-wiring.ts web/tests/node/panes.test.ts
git commit -m "panes: the shared surfaces follow the pane you are working in, per leg"
```

---

## Task 6: `main.ts` — leaf ids stop naming a kind

**Files:**
- Modify: `web/src/pane-host.ts` (`nextLeafId`, moved there by Task 2), `web/src/main.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `nextLeafId(): LeafId` — **no longer takes a `Leg`**.

- [ ] **Step 1: Change the minting function**

```ts
/**
 * The id a split mints for the new leaf it creates.
 *
 * `pane-${n}`, NOT `${leg}-${n}`, AND THE OLD SPELLING WAS A LIE THIS SLICE MADE VISIBLE. A leaf
 * minted as `lambda-3` that later renders a δ-table carries a name describing something it is not —
 * in the tree, in `localStorage`, and in `data-leaf`, which browser tests select on. `panes.ts:6`
 * already declares the id opaque ("a leaf's stable identity"), so the prefix was a convenience rather
 * than a fact, and a pane that can change leg is what falsifies it.
 *
 * `defaultLayout()`'s LITERAL `lambda-0` / `tm-0` ARE LEFT ALONE, for three reasons and none of them
 * is inertia: browser tests select on them, `reset layout`'s re-minting of exactly those ids is what
 * `applyLayout`'s claim-dropping line reasons about, and `seedLeafCounter` reads the digits after the
 * last `-` and does not care which word precedes them. `dataset.kind` is the truthful statement of
 * what a leaf renders.
 */
function nextLeafId(): LeafId {
  return `pane-${leafCounter++}`
}
```

- [ ] **Step 2: Update the two callers**

`splitRow` and `splitColumn` in `paneEvents` drop the `slot.binding.leg` argument.

- [ ] **Step 3: Verify**

Run: `cd web && pnpm test && pnpm run typecheck`
Expected: PASS, unchanged count. `seedLeafCounter`'s suffix parse handles both spellings, so a `localStorage` entry written by an older build still loads.

- [ ] **Step 4: Commit**

```bash
git add web/src/pane-host.ts
git commit -m "a leaf id stops naming a kind it can no longer promise"
```

---

## Task 7: `pane-chrome.ts` — the combined `(leg, session)` selector

**Files:**
- Modify: `web/src/pane-chrome.ts:389-446`, `web/src/sessions.ts` (`PaneView`, `PaneSlot.render`), `web/src/lambda-pane.ts:118`, `web/src/tm-pane.ts` (the `bindingSelect` call)
- Test: `web/tests/browser/binding-selector.test.ts`, `web/tests/node/panes.test.ts` + `sessions.test.ts` (fake updates)

**Interfaces:**
- Consumes: `PaneOption` (Task 4).
- Produces:
  ```ts
  export function paneSelect(
    title: HTMLElement,
    onPick: (choice: Binding<Leg>) => void,
  ): { update(options: readonly PaneOption[], current: Binding<Leg>): void }
  // PaneEvents.rebind widens:
  rebind(binding: Binding<Leg>): void
  // PaneView widens:
  setBindings(options: PaneOption[], current: Binding<Leg>): void
  ```

- [ ] **Step 1: Write the failing browser test**

Append to `web/tests/browser/binding-selector.test.ts`:

```ts
it('lists both legs, grouped, and omits a pair the session has no leg for', async () => {
  const { view, src } = await mount()          // reuse this file's existing harness
  await forkScratch(view, src)                 // reuse; gives a λ-only scratch session
  const select = document.querySelector<HTMLSelectElement>('[data-leaf="lambda-0"] .pane-binding select')
  expect(select).not.toBeNull()
  const groups = [...select!.querySelectorAll('optgroup')].map((g) => g.label)
  expect(groups).toEqual(['λ', 'TM'])
  const tmOptions = [...select!.querySelectorAll('optgroup:nth-of-type(2) option')].map((o) => o.textContent)
  // The scratch has no TM leg, so the pair is not in the list at all.
  expect(tmOptions).toEqual(['source'])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/binding-selector.test.ts`
Expected: FAIL — no `optgroup` elements.

- [ ] **Step 3: Rename and widen the control**

Rename `bindingSelect` to `paneSelect`. Keep all four preserved properties (design §4.3) and their doc comments verbatim:

```ts
export function paneSelect(
  title: HTMLElement,
  onPick: (choice: Binding<Leg>) => void,
): { update(options: readonly PaneOption[], current: Binding<Leg>): void } {
  const el = document.createElement('label')
  el.className = 'pane-binding'
  const caption = document.createElement('span')
  caption.className = 'pane-binding-caption'
  caption.textContent = 'shows'
  const select = document.createElement('select')
  // `change`, NOT `input` — unchanged, and its reason is unchanged: a keyboard user arrowing the list
  // would otherwise rebind and repaint the pane for every option they pass. What widening adds is that
  // each of those repaints could now also TEAR THE PANE DOWN AND REBUILD IT, so the argument that was
  // about cost is now also about the pane vanishing under the user mid-browse.
  select.addEventListener('change', () => {
    const [leg, session] = select.value.split('\x00')
    if (leg === 'lambda' || leg === 'tm') onPick({ leg, session: session ?? '' })
  })
  el.append(caption, select)
  let rendered = ''
  return {
    update(options: readonly PaneOption[], current: Binding<Leg>) {
      if (options.length < 2) {
        el.remove()
        rendered = ''
        return
      }
      // TWO DELIMITERS THAT CANNOT OCCUR IN AN ID OR A LABEL — and see the existing comment below on
      // why these are written as `\x00`/`\x01` escapes rather than literal control characters. The
      // option VALUE now uses `\x00` for the same reason the key does: it joins two fields that must
      // not be able to collide into one.
      const key = options.map((o) => `${o.leg}\x00${o.id}\x00${o.label}`).join('\x01')
      if (key !== rendered) {
        rendered = key
        const groups = new Map<Leg, HTMLOptGroupElement>()
        for (const o of options) {
          let group = groups.get(o.leg)
          if (group === undefined) {
            group = document.createElement('optgroup')
            group.label = o.leg === 'lambda' ? 'λ' : 'TM'
            groups.set(o.leg, group)
          }
          const opt = document.createElement('option')
          opt.value = `${o.leg}\x00${o.id}`
          opt.textContent = o.label
          group.append(opt)
        }
        select.replaceChildren(...groups.values())
      }
      const want = `${current.leg}\x00${current.session}`
      if (select.value !== want) select.value = want
      if (el.parentNode === null) title.after(el)
    },
  }
}
```

**Keep `pane-chrome.ts:419-429`'s comment about the escapes exactly where it is.** It is the record of the bug that made this file invisible to `rg`.

- [ ] **Step 4: Widen the two types that carry the binding**

In `sessions.ts`: `PaneView.setBindings(options: PaneOption[], current: Binding<Leg>)`, and `PaneSlot.render`'s call becomes `pane.setBindings(reg.pairs(), b)`.

In `pane-chrome.ts`, rewrite `PaneEvents.rebind`'s signature and doc (`:11-23`). The paragraph reading *"IT TAKES A `SessionId` AND NOT A `(session, leg)` PAIR"* named this slice as the thing that would change it — rewrite it in place to record that it now takes the pair, and why (§3.2: a session has at most one leg per `Leg`, so the axes are not independent and a two-control split would have to invent a fallback rule).

- [ ] **Step 5: Update the two pane constructors and the node fakes**

`lambda-pane.ts:118` and the matching line in `tm-pane.ts`: `bindingSelect(title, on.rebind)` → `paneSelect(title, on.rebind)`.

`panes.test.ts`'s `fakePane` and `sessions.test.ts`'s fakes implement `PaneView`; update their `setBindings` signatures.

- [ ] **Step 6: Run to verify**

Run: `cd web && pnpm test && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/pane-chrome.ts web/src/sessions.ts web/src/lambda-pane.ts web/src/tm-pane.ts web/tests
git commit -m "pane-chrome: one selector for the pair, because the two axes were never independent"
```

---

## Task 8: `pane-chrome.ts` — the split picker

**Files:**
- Modify: `web/src/pane-chrome.ts:515-561`, `web/src/style.css`
- Test: `web/tests/browser/pane-layout-controls.test.ts`

**Interfaces:**
- Consumes: `PaneOption` (Task 4).
- Produces:
  ```ts
  export type PaneChoice = { kind: 'source' } | { kind: Leg; session: SessionId }
  // PaneEvents:
  splitRow(choice: PaneChoice): void
  splitColumn(choice: PaneChoice): void
  // layoutControls:
  export function layoutControls(
    parent: HTMLElement,
    on: Pick<PaneEvents, 'splitRow' | 'splitColumn' | 'close'>,
    choices?: () => { options: readonly PaneOption[]; sourceAvailable: boolean; current: Binding<Leg> },
  ): { update(canClose: boolean, canSplit: boolean): void }
  ```

`choices` is optional because `main.ts`'s source pane passes `{ close }` alone and never splits (`main.ts:489-492`); a caller with no split controls has no menu to populate.

- [ ] **Step 1: Write the failing browser test**

Append to `web/tests/browser/pane-layout-controls.test.ts`:

```ts
it('opens a menu of pairs rather than splitting immediately', async () => {
  const { view, src } = await mount()                  // reuse this file's harness
  const pane = document.querySelector<HTMLElement>('[data-leaf="lambda-0"]')!
  const before = document.querySelectorAll('[data-leaf]').length
  pane.querySelector<HTMLButtonElement>('[aria-label="split left and right"]')!.click()
  // The click opens, it does not split.
  expect(document.querySelectorAll('[data-leaf]').length).toBe(before)
  const menu = pane.querySelector<HTMLElement>('.pane-picker')!
  expect(menu.matches(':popover-open')).toBe(true)
  // The pane's own pair is first, labelled as the duplicate case.
  const items = [...menu.querySelectorAll('button')].map((b) => b.textContent)
  expect(items[0]).toMatch(/same/)
})

it('offers source only when no source leaf is in the tree', async () => {
  const { view, src } = await mount()
  const pane = document.querySelector<HTMLElement>('[data-leaf="lambda-0"]')!
  const open = () => pane.querySelector<HTMLButtonElement>('[aria-label="split left and right"]')!.click()
  open()
  const labels = () => [...pane.querySelectorAll<HTMLElement>('.pane-picker button')].map((b) => b.textContent ?? '')
  expect(labels().some((l) => l.includes('source'))).toBe(false)
  pane.querySelector<HTMLElement>('.pane-picker')!.hidePopover()

  document.querySelector<HTMLButtonElement>('[data-leaf="source"] [aria-label="close this pane"]')!.click()
  open()
  expect(labels().some((l) => l.includes('source'))).toBe(true)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/pane-layout-controls.test.ts`
Expected: FAIL — no `.pane-picker` element; the first click splits.

- [ ] **Step 3: Implement the menu**

In `layoutControls`, replace each split button's direct handler with a popover pairing:

```ts
/** The `(leg, session)` a split creates, or the source pane when the tree has none. */
export type PaneChoice = { kind: 'source' } | { kind: Leg; session: SessionId }

let pickerSeq = 0

/**
 * One split control and the menu it opens.
 *
 * NATIVE `popover`, NOT A HAND-ROLLED DROPDOWN. Light dismiss, top-layer placement and Escape come
 * with the attribute; a hand-rolled menu would need a document-level click listener that has to be
 * removed when the pane closes, and a z-index negotiation with the dividers. The browser tier is
 * Chromium-only (`vite.config.ts`), so this is fully drivable in test.
 *
 * THE LIST IS BUILT ON OPEN, NOT ON EVERY FRAME. `update` below is on the per-frame path — `draw()`
 * repaints every pane on every recorded frame — so building options there would incur exactly the cost
 * `paneSelect`'s key comparison exists to avoid. A menu that is closed has no state to keep fresh,
 * which is a stronger position than the selector can take.
 */
function splitControl(
  label: string,
  glyph: string,
  fire: (choice: PaneChoice) => void,
  choices: () => { options: readonly PaneOption[]; sourceAvailable: boolean; current: Binding<Leg> },
): { button: HTMLButtonElement; menu: HTMLElement } {
  const id = `pane-picker-${pickerSeq++}`
  const menu = document.createElement('div')
  menu.className = 'pane-picker'
  menu.id = id
  menu.popover = 'auto'

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'layout-control'
  button.textContent = glyph
  button.title = label
  button.setAttribute('aria-label', label)
  button.setAttribute('aria-haspopup', 'menu')
  button.popoverTargetElement = menu

  menu.addEventListener('beforetoggle', (e) => {
    const open = (e as ToggleEvent).newState === 'open'
    button.setAttribute('aria-expanded', String(open))
    if (!open) return
    const { options, sourceAvailable, current } = choices()
    const items: HTMLButtonElement[] = []
    const add = (text: string, choice: PaneChoice) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = text
      b.addEventListener('click', () => {
        menu.hidePopover()
        fire(choice)
      })
      items.push(b)
    }
    // THE PANE'S OWN PAIR FIRST, LABELLED. Splitting used to be one click and is now two; putting the
    // common case at the top is what keeps the second click a click rather than a hunt.
    const mine = options.find((o) => o.leg === current.leg && o.id === current.session)
    if (mine !== undefined) add(`${legLabel(mine.leg)} · ${mine.label} (same)`, { kind: mine.leg, session: mine.id })
    for (const o of options) {
      if (o.leg === current.leg && o.id === current.session) continue
      add(`${legLabel(o.leg)} · ${o.label}`, { kind: o.leg, session: o.id })
    }
    if (sourceAvailable) add('source', { kind: 'source' })
    menu.replaceChildren(...items)
    items[0]?.focus()
  })

  return { button, menu }
}

const legLabel = (leg: Leg): string => (leg === 'lambda' ? 'λ' : 'TM')
```

Wire both controls in `layoutControls`, appending each `menu` beside its button, and keep the existing `update` ordering logic (`pane-chrome.ts:533-559`) — including the re-append of `close` whose comment explains that `Node.append` MOVES rather than duplicates.

When `choices` is `undefined`, build plain buttons exactly as today, so the source pane is unaffected.

- [ ] **Step 4: Style the menu**

In `web/src/style.css`, beside the existing `.controls button` rules:

```css
.pane-picker {
  border: 1px solid var(--rule);
  background: var(--bg);
  padding: 0.25rem;
  margin: 0;
  min-width: 12rem;
}
.pane-picker button {
  display: block;
  width: 100%;
  text-align: left;
}
```

Use the variables already defined at the top of the file; do not introduce new colours (design §6.3 — this slice adds controls, not hues).

- [ ] **Step 5: Run to verify**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/pane-layout-controls.test.ts && pnpm run typecheck`
Expected: PASS. Handlers are not wired to the tree yet — Task 10 does that — so `fire` is still a stub in `pane-host.ts` at this point; give it the old duplicate behaviour (`splitLeaf(tree, id, dir, newId, slot.binding.leg)`) so the suite stays green.

- [ ] **Step 6: Commit**

```bash
git add web/src/pane-chrome.ts web/src/style.css web/tests/browser/pane-layout-controls.test.ts
git commit -m "pane-chrome: split asks what to create, and a popover is what makes that free"
```

---

## Task 9: The kind change, through `applyLayout`'s two existing passes

**Files:**
- Modify: `web/src/pane-host.ts`
- Test: `web/tests/browser/pane-kind-switch.test.ts` (create)

**Interfaces:**
- Consumes: `setLeafKind` (Task 3), `pairs` (Task 4), `paneSelect` / widened `rebind` (Task 7).
- Produces: nothing new — this is wiring.

- [ ] **Step 1: Write the failing browser tests**

Create `web/tests/browser/pane-kind-switch.test.ts`. Model the harness on `tests/browser/two-lambda-panes.test.ts`, which already mounts `main()` and drives real panes.

```ts
import { expect, it } from 'vitest'
// …the same imports and `mount` / `settled` helpers two-lambda-panes.test.ts uses

it('a λ pane becomes a TM pane in place', async () => {
  const { view, src } = await mount()
  const pane = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"]')!
  const sizesBefore = [...document.querySelectorAll<HTMLElement>('[data-leaf]')].map((el) => el.style.flexGrow)

  const select = pane().querySelector<HTMLSelectElement>('.pane-binding select')!
  select.value = `tm\x00${SOURCE_SESSION}`
  select.dispatchEvent(new Event('change'))
  await settled(view, src)

  // Same leaf, different kind — decision 1.
  expect(pane()).not.toBeNull()
  expect(pane().dataset.kind).toBe('tm')
  expect(pane().querySelector('.tapes')).not.toBeNull()
  // And it kept its place and its size.
  expect([...document.querySelectorAll<HTMLElement>('[data-leaf]')].map((el) => el.style.flexGrow)).toEqual(sizesBefore)
})

it('the editor survives a kind switch', async () => {
  const { view, src } = await mount()
  // Fork a scratch into lambda-0 and type into it — reuse scratch-edit.test.ts's gesture.
  await forkScratch(view, src)
  await typeInto(document.querySelector('[data-leaf="lambda-0"] .term-editor')!, 'let y = 1; y')
  await settled(view, src)

  // Split, so a second λ pane exists bound to the same scratch.
  await splitSameInto('lambda-0')
  const survivor = document.querySelector<HTMLElement>('[data-leaf="pane-1"]')!

  // Now switch the editor-holding pane to TM.
  const select = document.querySelector<HTMLSelectElement>('[data-leaf="lambda-0"] .pane-binding select')!
  select.value = `tm\x00${SOURCE_SESSION}`
  select.dispatchEvent(new Event('change'))
  await settled(view, src)

  // THE CLAIM: the editor went into custody rather than being destroyed, and the survivor can claim it.
  const claim = survivor.querySelector<HTMLButtonElement>('.claim-editor')!
  expect(claim.hidden).toBe(false)
  claim.click()
  await settled(view, src)
  expect(survivor.querySelector('.term-editor')?.textContent).toContain('let y = 1')
})
```

Replace the placeholder helper names (`forkScratch`, `typeInto`, `splitSameInto`, `settled`, `SOURCE_SESSION`, `.claim-editor`) with the real ones those two existing files use — read `tests/browser/scratch-edit.test.ts` and `tests/browser/scratch-rebind-editor.test.ts` first and reuse their selectors verbatim rather than inventing new ones.

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/pane-kind-switch.test.ts`
Expected: FAIL — the pane keeps `data-kind="lambda"`; the second test's claim control is hidden.

- [ ] **Step 3: Widen pass 1's removal predicate**

In `applyLayout`:

```ts
    const live = new Map(leaves(tree).map((l) => [l.id, l.pane]))
    for (const p of panes.all()) {
      // TWO REASONS TO DROP AN ENTRY NOW, AND THE SECOND IS THE KIND CHANGE. A leaf that is still in
      // the tree but no longer renders what this entry renders is the same situation as a close from
      // the editor's point of view, which is why the custody handover below covers both without a
      // branch: the pane is about to stop existing either way.
      if (live.get(p.id) === p.kind) continue
      if (p.slot.binding.leg === 'lambda') {
        const held = (p.pane as LambdaPane).takeEditor()
        if (held !== null) custody.hold(p.slot.binding.session, held)
      }
      panes.remove(p.id)
    }
```

`sourceLayout.update(live.size > 1, false)` is unchanged — `live` is now a `Map` and `.size` still answers the leaf count.

- [ ] **Step 4: Rewrite `dataset.kind` in pass 2**

In the creation loop, after `const host = hostFor(l.id, l.pane)`:

```ts
      // `hostFor` SETS THIS ONCE, AT CREATION, AND A KIND CHANGE REUSES THE HOST — so this is the one
      // line that keeps `data-kind` truthful. The host's CONTENTS need no clearing: both pane
      // constructors end in `host.replaceChildren(…)`, so building the new pane empties it.
      host.dataset.kind = l.pane
```

- [ ] **Step 5: Branch the `rebind` handler**

In `paneEvents`:

```ts
      rebind: (choice: Binding<Leg>) => {
        if (choice.leg === slot.binding.leg) {
          // SAME LEG — today's path exactly, one field write and no teardown.
          slot.rebind(choice.session)
          draw()
          return
        }
        // DIFFERENT LEG — the whole entry is replaced. `pendingBinding` was built to tell a freshly
        // SPLIT leaf which session to start on and answers the identical question here, one gesture
        // earlier, for the same leaf id.
        pendingBinding.set(id, choice.session)
        setTree(setLeafKind(getTree(), id, choice.leg))
        applyLayout()
      },
```

Note `base.rebind` from `transport.events(slot)` is superseded for the cross-leg case; check `transport.ts`'s handler and keep the same-leg branch routed through it if that is where the existing `draw()` call lives.

- [ ] **Step 6: Run to verify**

Run: `cd web && pnpm test && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/pane-host.ts web/tests/browser/pane-kind-switch.test.ts
git commit -m "panes: a pane changes what it shows, through the two passes that already knew how"
```

---

## Task 10: The picker's handlers, and the source pane's way back

**Files:**
- Modify: `web/src/pane-host.ts`
- Test: `web/tests/browser/pane-picker.test.ts` (create)

**Interfaces:**
- Consumes: `PaneChoice` (Task 8), `splitLeaf(…, kind)` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Write the failing browser tests**

Create `web/tests/browser/pane-picker.test.ts`:

```ts
it('split creates a TM pane from a λ pane', async () => {
  const { view, src } = await mount()
  const pane = document.querySelector<HTMLElement>('[data-leaf="lambda-0"]')!
  pane.querySelector<HTMLButtonElement>('[aria-label="split left and right"]')!.click()
  const item = [...pane.querySelectorAll<HTMLButtonElement>('.pane-picker button')].find((b) =>
    (b.textContent ?? '').startsWith('TM'),
  )!
  item.click()
  await settled(view, src)
  expect(document.querySelector('[data-leaf="pane-1"]')?.getAttribute('data-kind')).toBe('tm')
})

it('the closed source pane comes back through the picker, with the program intact', async () => {
  const { view, src } = await mount()
  await typeInto(document.querySelector('#editor')!, 'let z = 9; z')
  await settled(view, src)

  document.querySelector<HTMLButtonElement>('[data-leaf="source"] [aria-label="close this pane"]')!.click()
  await settled(view, src)
  expect(document.querySelector('[data-leaf="source"]')).toBeNull()

  // The λ pane's picker can put it back — WITHOUT `restore default layout`, which is the whole point.
  const pane = document.querySelector<HTMLElement>('[data-leaf="lambda-0"]')!
  pane.querySelector<HTMLButtonElement>('[aria-label="split top and bottom"]')!.click()
  const item = [...pane.querySelectorAll<HTMLButtonElement>('.pane-picker button')].find(
    (b) => b.textContent === 'source',
  )!
  item.click()
  await settled(view, src)

  const back = document.querySelector<HTMLElement>('[data-leaf]:has(#editor)')!
  expect(back.dataset.kind).toBe('source')
  expect(back.querySelector('#editor')?.textContent).toContain('let z = 9')
  // And the TM pane the default layout ships is still where it was — this is not `restore default layout`.
  expect(document.querySelector('[data-leaf="tm-0"]')).not.toBeNull()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/pane-picker.test.ts`
Expected: FAIL — the new leaf duplicates the λ kind; `source` is not offered.

- [ ] **Step 3: Implement the handlers**

In `paneEvents`, replace both split handlers:

```ts
      splitRow: (choice: PaneChoice) => split('row', choice),
      splitColumn: (choice: PaneChoice) => split('column', choice),
```

with a shared body:

```ts
    /**
     * Split `id` and create the chosen pane in the new leaf.
     *
     * A `'source'` CHOICE RECORDS NO PENDING BINDING, because the source leaf has no `PaneSlot` — it
     * is chrome around the editor `main.ts` owns, which is the same statement `applyLayout`'s
     * `if (l.pane === 'source') continue` makes in the creation pass.
     */
    const split = (dir: Dir, choice: PaneChoice): void => {
      const newId = nextLeafId()
      if (choice.kind !== 'source') pendingBinding.set(newId, choice.session)
      setTree(splitLeaf(getTree(), id, dir, newId, choice.kind))
      applyLayout()
    }
```

- [ ] **Step 4: Feed the menu its choices**

Wire `layoutControls`' third argument where `LambdaPane` / `TmPane` construct it. The panes do not know the registry, so the data crosses through `PaneView.setLayoutControls`, which `draw()` already calls per frame — extend it to carry the picker's inputs, or add a sibling setter driven from the same place. Either way the source of `sourceAvailable` is:

```ts
const sourceAvailable = !leaves(getTree()).some((l) => l.pane === 'source')
```

- [ ] **Step 5: Run to verify**

Run: `cd web && pnpm test && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/pane-host.ts web/src/lambda-pane.ts web/src/tm-pane.ts web/src/draw.ts web/tests/browser/pane-picker.test.ts
git commit -m "the picker creates what it was asked for, and the source pane gets a way back that keeps your layout"
```

---

## Task 11: Focus tracking

**Files:**
- Modify: `web/src/pane-host.ts` (`hostFor`)
- Test: `web/tests/browser/active-pane.test.ts` (create)

**Interfaces:**
- Consumes: `markActive` (Task 5).
- Produces: nothing new.

- [ ] **Step 1: Write the failing browser test**

Create `web/tests/browser/active-pane.test.ts`:

```ts
it('the status line describes the pane you are working in', async () => {
  const { view, src } = await mount()
  await forkScratch(view, src)              // lambda-0 is now on a detached scratch
  await splitSameInto('lambda-0')           // pane-1, same scratch
  // Point pane-1 back at the source session, so the two panes disagree about detachment.
  const select = document.querySelector<HTMLSelectElement>('[data-leaf="pane-1"] .pane-binding select')!
  select.value = `lambda\x00${SOURCE_SESSION}`
  select.dispatchEvent(new Event('change'))
  await settled(view, src)

  const status = () => document.querySelector('#link-status')!.textContent ?? ''

  document.querySelector<HTMLElement>('[data-leaf="pane-1"] button:not([disabled])')!.focus()
  await settled(view, src)
  expect(status()).not.toMatch(/detached/)

  document.querySelector<HTMLElement>('[data-leaf="lambda-0"] button:not([disabled])')!.focus()
  await settled(view, src)
  expect(status()).toMatch(/detached/)
})
```

Check `link-status.ts` for the exact wording before asserting on it; match the real string rather than the regex above if it is more specific.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/active-pane.test.ts`
Expected: FAIL — the status line does not change; it describes whichever pane is first in insertion order.

- [ ] **Step 3: Implement**

In `hostFor`, on the creation branch only:

```ts
    const el = document.createElement('section')
    el.className = 'pane'
    el.dataset.leaf = id
    el.dataset.kind = kind
    // `focusin` RATHER THAN `focus`, BECAUSE IT BUBBLES. One listener on the section catches focus
    // landing anywhere inside the pane — including inside a CodeMirror instance, whose focusable
    // descendants this module never sees — where `focus` would need a listener per descendant and a
    // new one every time a pane's contents changed.
    //
    // ON THE CREATION BRANCH, NOT ON EVERY `hostFor` CALL. Hosts are kept forever and `hostFor` is
    // called for every leaf on every `applyLayout`, so wiring here rather than below is the difference
    // between one listener and one per layout gesture.
    el.addEventListener('focusin', () => {
      panes.markActive(id)
      draw()
    })
```

`draw()` is what repaints the status line from the newly active pane; `active`'s fallback means the call is a no-op for a leg with one pane.

- [ ] **Step 4: Run to verify**

Run: `cd web && pnpm test && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pane-host.ts web/tests/browser/active-pane.test.ts
git commit -m "the shared surfaces follow focus, which is how a user says which pane they mean"
```

---

## Task 12: Measure, and update the roadmap

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, possibly `web/vite.config.ts`

- [ ] **Step 1: Measure**

```bash
cd web && pnpm test && pnpm test:coverage && pnpm run typecheck
wc -l src/main.ts src/pane-host.ts src/editor-custody.ts
```

Record the test count, the four coverage figures, and the three line counts. **Measure against the live tree; do not copy figures forward** — 5d-iii's entry shipped stale counts and its reviewer had to correct them (roadmap:5576-5583), and 5d-ii-a's own entry carried counts that moved under it twice.

- [ ] **Step 2: Decide the floors deliberately**

`vite.config.ts`'s convention is `floor(measured) - 1`, and it is a formula rather than an obligation to re-run after every commit. Apply it if the measured figures have moved by more than the one-to-two-point margin the comment describes; leave the floors alone if the movement is noise, and **write the reason beside the number either way**. 5d-ii-a's entry records that leaving a floor at 87 across a 0.21-point drift was itself a decision.

- [ ] **Step 3: Write the roadmap entry**

Append a `#### PLAN 5d-ii-b CLOSES` entry in the style of 5d-ii-a's (roadmap:5640 onward). It must record:
- The §3.1 decision and the argument that settled it — that widening saves nothing because the view is rebuilt regardless.
- That `main.ts` left 1,115 lines behind, with the three measured numbers, closing roadmap:5932.
- The two accessibility-list additions and the one exception taken (design §6.2).
- The coverage decision from Step 2, with its argument.
- 5d-ii-c and 5d-iv keeping their filed positions.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md web/vite.config.ts
git commit -m "roadmap: 5d-ii-b closes, and main.ts's open question closes with a number"
```

---

## Self-Review

**Spec coverage.** Design §4.1 → Tasks 1-2. §4.2a → Task 3. §4.2b → Task 4. §4.2c → Task 5. §3.6 → Task 6. §4.3 → Task 7. §4.4 → Task 8. §4.5 → Tasks 9-10. §4.6 → Task 10. §4.7 → Tasks 5 and 11. §5's node tier → Tasks 3, 4, 5; browser tier → Tasks 9, 10, 11. §6.2's list additions → Task 12. No gaps.

**Type consistency.** `PaneOption` is defined in Task 4 and consumed by Tasks 7 and 8 under that name. `PaneChoice` is defined in Task 8 and consumed in Task 10. `Binding<Leg>` is the selector's payload throughout (Tasks 7, 9) and is deliberately *not* `PaneChoice` — the in-place selector never offers `source`, which is decision 4. `nextLeafId()` loses its parameter in Task 6, before Task 10 calls it.

**Known soft spots, flagged rather than hidden.**
- Task 10's Step 4 does not name the exact plumbing for the menu's choices, because whether it rides on `setLayoutControls` or a sibling setter depends on what `draw()`'s per-frame loop looks like after Task 2 moves it. Both routes are stated; the implementer picks one and records why.
- Task 9's Step 5 notes that `transport.events(slot)` may already own the `draw()` call on the same-leg path. Read `transport.ts` before writing that branch rather than adding a second one.
- Tasks 9-11's browser tests use placeholder helper names. **Read `two-lambda-panes.test.ts`, `scratch-edit.test.ts` and `scratch-rebind-editor.test.ts` first and reuse their real helpers and selectors** — inventing a parallel harness is how a green suite stops describing the app.
