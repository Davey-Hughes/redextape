import { describe, expect, it } from 'vitest'
import {
  type Arrangements,
  CYCLE,
  combinationOf,
  cycleFrom,
  enter,
  keyOf,
  liveLeaves,
  parseKey,
  reidentified,
  shapeOf,
  toggled,
  treeKey,
} from '../../src/arrangements'
import {
  closeLeaf,
  defaultArrangement,
  HEADER_ORDER,
  insertBeside,
  KIND_ORDER,
  type LayoutNode,
  leaves,
  MAX_TREE_LEAVES,
  parseTree,
  resize,
  setLeafKind,
} from '../../src/layout'
import type { LeafId, PaneKind } from '../../src/panes'
import { defaultFocus, defaultWorkspace, parseWorkspace, serializeWorkspace } from '../../src/workspace'

/**
 * WHICH VIEWS ARE ON SCREEN AND WHAT EACH COMBINATION REMEMBERS, AS VALUES — the view layouts spec §4.
 *
 * `enter` is the one function every write of the tree goes through, so its two properties are what a user's
 * "switching is reversible" rests on; both are asserted over generated sequences as well as by hand.
 */

const of = (...kinds: PaneKind[]): LayoutNode => defaultArrangement(kinds, 'wide')
const FOUR = of(...KIND_ORDER)
const ALL = treeKey(FOUR)
/** All four views after *TM · program* is picked in the asm view's title: `asm-0` is a TM view, under its own id. */
const PICKED = setLeafKind(FOUR, 'asm-0', 'tm')

/** Every combination: the 15 sets of kinds that are not empty, each in `KIND_ORDER`. */
const COMBINATIONS: PaneKind[][] = []
for (let mask = 1; mask < 1 << KIND_ORDER.length; mask++)
  COMBINATIONS.push(KIND_ORDER.filter((_, i) => (mask & (1 << i)) !== 0))

describe('a combination and its key', () => {
  it('reads a tree’s kinds in KIND_ORDER, each once', () => {
    expect(combinationOf(FOUR)).toEqual(['source', 'lambda', 'asm', 'tm'])
    expect(combinationOf(of('tm', 'source'))).toEqual(['source', 'tm'])
    const twoLambdas = insertBeside(of('source', 'lambda'), 'lambda-0', 'row', 'pane-1', 'lambda')
    expect(combinationOf(twoLambdas)).toEqual(['source', 'lambda'])
  })

  it('spells a key as the kinds joined by +', () => {
    expect(keyOf(['source', 'tm'])).toBe('source+tm')
    expect(treeKey(FOUR)).toBe('source+lambda+asm+tm')
    expect(treeKey(of('asm'))).toBe('asm')
  })

  it('has 15 combinations, each with a key of its own that parses back to it', () => {
    expect(COMBINATIONS).toHaveLength(15)
    expect(new Set(COMBINATIONS.map(keyOf)).size).toBe(15)
    for (const kinds of COMBINATIONS) expect(parseKey(keyOf(kinds))).toEqual(kinds)
  })

  it.each([
    ['nothing', ''],
    ['an unknown kind', 'source+lisp'],
    ['a kind twice', 'source+source'],
    ['kinds out of KIND_ORDER', 'tm+source'],
    // THE ONE ORDER BESIDE IT THE APP KNOWS, which a toggle key and the live region's sentence do follow.
    ['all four kinds in the header’s order', HEADER_ORDER.join('+')],
    ['a trailing +', 'source+'],
    ['another separator', 'source,tm'],
  ])('reads %s as no key', (_what, key) => {
    expect(parseKey(key)).toBeNull()
  })
})

describe('toggled', () => {
  it('adds a kind that is missing, in KIND_ORDER, and removes one that is there', () => {
    expect(toggled(['source', 'tm'], 'lambda')).toEqual(['source', 'lambda', 'tm'])
    expect(toggled(['source', 'lambda', 'tm'], 'lambda')).toEqual(['source', 'tm'])
    // λ BEFORE ASM, WHERE THE HEADER HAS ASM FIRST: the one pair the two orders disagree about.
    expect(toggled(['source', 'asm', 'tm'], 'lambda')).toEqual(['source', 'lambda', 'asm', 'tm'])
    expect(toggled(['source', 'lambda', 'tm'], 'asm')).toEqual(['source', 'lambda', 'asm', 'tm'])
  })

  it('is empty when the only kind is toggled, which the caller refuses', () => {
    expect(toggled(['tm'], 'tm')).toEqual([])
  })
})

describe('enter', () => {
  const start = { tree: of('source', 'tm'), arrangements: {} as Arrangements }

  it('remembers the tree left under its key when the combination changes', () => {
    const next = enter(start, FOUR)
    expect(next.tree).toEqual(FOUR)
    expect(next.arrangements).toEqual({ 'source+tm': start.tree })
  })

  it('remembers nothing for an edit that keeps the combination', () => {
    const dragged = resize(start.tree, [], 0, 0.2)
    const next = enter(start, dragged)
    expect(next.tree).toEqual(dragged)
    expect(next.arrangements).toBe(start.arrangements)
    const second = insertBeside(start.tree, 'tm-0', 'row', 'pane-1', 'tm')
    expect(enter(start, second).arrangements).toBe(start.arrangements)
  })

  it('never keeps an entry under the key of the tree on screen', () => {
    const away = enter(start, FOUR)
    const back = enter(away, away.arrangements['source+tm'] as LayoutNode)
    expect(Object.keys(back.arrangements)).toEqual([treeKey(FOUR)])
    expect(back.arrangements[treeKey(back.tree)]).toBeUndefined()
  })

  /** `liveLeaves` reads which arrangement was left last from the record's order, so the order is held here. */
  it('puts the tree it leaves after every entry it keeps, so the record is in the order its trees were left', () => {
    const pair = enter(start, FOUR)
    const lambda = enter(pair, of('source', 'lambda'))
    expect(Object.keys(lambda.arrangements)).toEqual(['source+tm', 'source+lambda+asm+tm'])
    // BACK TO THE FIRST ONE LEFT, WHICH IS ON SCREEN AND SO REMEMBERED NO LONGER; left again, it is the last.
    const back = enter(lambda, lambda.arrangements['source+tm'] as LayoutNode)
    expect(Object.keys(back.arrangements)).toEqual(['source+lambda+asm+tm', 'source+lambda'])
    const again = enter(back, of('source', 'asm'))
    expect(Object.keys(again.arrangements)).toEqual(['source+lambda+asm+tm', 'source+lambda', 'source+tm'])
  })

  it('shows the tree that was left after a switch away and back', () => {
    const stacked = resize(of('source', 'tm'), [], 0, 0.2)
    const left = { tree: stacked, arrangements: {} as Arrangements }
    const away = enter(left, FOUR)
    const back = enter(away, away.arrangements[treeKey(stacked)] as LayoutNode)
    expect(back.tree).toEqual(stacked)
  })

  it('shows the tree before a ✕ when the closed kind is toggled back', () => {
    const three = resize(of('source', 'lambda', 'tm'), [], 0, 0.2)
    const closed = enter({ tree: three, arrangements: {} }, closeLeaf(three, 'lambda-0'))
    expect(treeKey(closed.tree)).toBe('source+tm')
    expect(closed.arrangements['source+lambda+tm']).toEqual(three)
  })

  it('replaces what a combination remembered when an edit lands in it', () => {
    const remembered = resize(of('source', 'tm'), [], 0, 0.3)
    const three = of('source', 'lambda', 'tm')
    const closed = enter({ tree: three, arrangements: { 'source+tm': remembered } }, closeLeaf(three, 'lambda-0'))
    expect(closed.arrangements).toEqual({ 'source+lambda+tm': three })
    expect(closed.tree).toEqual(closeLeaf(three, 'lambda-0'))
  })

  it('treats a title pick that changes the combination as any other edit that does', () => {
    const picked = setLeafKind(start.tree, 'tm-0', 'asm')
    const next = enter(start, picked)
    expect(treeKey(next.tree)).toBe('source+asm')
    expect(next.arrangements).toEqual({ 'source+tm': start.tree })
  })

  it('shows each tree as it was left, over four orders of visiting three combinations', () => {
    const stops = [of('source', 'tm'), of('source', 'lambda'), FOUR].map((t, i) => resize(t, [], 0, 0.05 * (i + 1)))
    for (const order of [
      [0, 1, 2, 0, 1, 2],
      [0, 2, 1, 2, 0, 1],
      [2, 0, 2, 1, 0, 2],
      [1, 2, 0, 0, 1, 1],
    ]) {
      let now = { tree: stops[order[0] as number] as LayoutNode, arrangements: {} as Arrangements }
      const visited = new Set([treeKey(now.tree)])
      for (const at of order.slice(1)) {
        const target = stops[at] as LayoutNode
        const key = treeKey(target)
        if (key !== treeKey(now.tree)) {
          // A COMBINATION VISITED BEFORE IS REMEMBERED, NOT REBUILT: read here, so a fallback cannot stand in for it.
          if (visited.has(key)) expect(now.arrangements[key], `order ${order.join('')} at ${at}`).toEqual(target)
          now = enter(now, now.arrangements[key] ?? target)
        }
        visited.add(key)
        expect(now.tree, `order ${order.join('')} at ${at}`).toEqual(target)
        expect(now.arrangements[treeKey(now.tree)]).toBeUndefined()
        expect(Object.keys(now.arrangements).length).toBe(visited.size - 1)
      }
    }
  })
})

/**
 * THE TWO PROPERTIES OF §4.3, AND WHAT A WORKSPACE HAS TO GO ON BEING, OVER GENERATED SEQUENCES OF SWITCHES AND EDITS
 * — spec §14 item 2.
 *
 * Each sequence makes 60 gestures, drawn by a seeded generator: a toggle, a cycle key, a `✕`, `+ view`, a pick in a
 * view's title that changes its kind, and a divider drag. A switch is made by `switched` below, which is this file's
 * copy of `main.ts`'s `switchTo`; an edit is `layout.ts`'s own function and then `enter`. After every gesture:
 *
 * - no entry is under the key of the tree on screen;
 * - every entry's key is its tree's own;
 * - the workspace is one `serializeWorkspace` writes and `parseWorkspace` reads back as it was, which refuses one of
 *   more than 64 live views;
 * - each view on screen is, by `liveLeaves`, the kind the tree on screen gives it;
 * - a switch away to each other combination and back shows the tree that was left;
 * - for each kind with one view, `✕` on it and then that kind's toggle shows the tree before the `✕`.
 *
 * And after every switch, no id the tree on screen held before it is on screen after it as another kind: the view
 * that holds an id stays the view under it, on screen or parked (§5.4).
 *
 * **THE LAST TWO OF THE SIX ARE ASKED OF THE STATE THE SEQUENCE IS IN, AND LEAVE IT THERE**: each is tried on a copy,
 * with ids of its own, and the sequence goes on from where it was.
 *
 * **TWELVE SEQUENCES START ON THE FIRST LOAD'S TWO VIEWS, AND TWELVE ON A WORKSPACE OF 60 LIVE VIEWS**, `CROWDED`.
 * From two views the most a sequence held was 19 live views, so no switch and no add was ever refused, and what this
 * doc said of the bound was held by nothing (measured 2026-10-12). From 60, both are.
 *
 * **WHAT THE SEQUENCES REACHED IS ASSERTED TOO**, in the last case, which runs every sequence itself where the cases
 * before it have not (a run of it alone, as `-t` makes one): each gesture, each of the two properties, a switch that
 * gave a leaf a new id, a state with one id under two kinds, and a switch and an add refused at the bound. A
 * generator that stopped reaching one would leave the cases above passing on less than they say. Counted over the 12
 * seeds from two views (2026-10-12): 647 gestures made of the 720 drawn, between 95 and 128 of each; 9,226 switches
 * away and back; 1,306 closes and toggles; 75 switches that gave a leaf a new id; and 571 states with an id under two
 * kinds. Over the 12 from `CROWDED`: 53 switches and 32 adds refused. The floors below are about half.
 */
describe('enter, over generated sequences of switches and edits', () => {
  type State = { readonly tree: LayoutNode; readonly arrangements: Arrangements }
  const GESTURES = ['toggle', 'cycle', 'close', 'add', 'pick', 'drag'] as const
  type Gesture = (typeof GESTURES)[number]
  const VIEW_KINDS = KIND_ORDER.filter((k) => k !== 'source')

  /** A seeded generator, so a failure names a sequence that stays the same. */
  const random = (seed: number): (() => number) => {
    let s = seed
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648
      return s / 2147483648
    }
  }

  /**
   * The workspace a switch to `target` enters and how many live views it holds, or `null` where there is no switch
   * to make: the combination on screen, or none.
   *
   * **THIS IS THE FILE'S OWN COPY OF `main.ts`'s `switchTo`**, which is wiring the node tier cannot load: the
   * arrangement the combination remembers or its default, `reidentified` against `liveLeaves` of the workspace left,
   * `enter`, and the bound asked of what `enter` answered. **SO WHAT IS HELD HERE IS THESE FOUR CALLS IN THIS ORDER,
   * AND NOT THAT `switchTo` MAKES THEM.** A `switchTo` that entered the arrangement without `reidentified`, or counted
   * the live views of another workspace, passes every case in this file; the app's own switch is held by the browser
   * tier, in `tests/browser/one-id-two-kinds.test.ts` and `live-views-bound-switch.test.ts`. Two things the copy does
   * differently: its default is a wide window's every time, where `switchTo` asks the views area for its shape, so no
   * sequence enters a tall default; and it mints the ids of a switch it then finds past the bound, where `switchTo`
   * counts with ids it does not mint.
   */
  const entering = (
    now: State,
    target: readonly PaneKind[],
    mint: () => LeafId,
  ): { readonly next: State; readonly live: number } | null => {
    const key = keyOf(target)
    if (target.length === 0 || key === treeKey(now.tree)) return null
    const held = now.arrangements[key] ?? defaultArrangement(target, 'wide')
    const next = enter(now, reidentified(held, liveLeaves(now.tree, now.arrangements), mint))
    return { next, live: liveLeaves(next.tree, next.arrangements).size }
  }
  /** The workspace after a switch to `target`, or `null` where none is made: no switch to make, or one past the bound. */
  const switched = (now: State, target: readonly PaneKind[], mint: () => LeafId): State | null => {
    const to = entering(now, target, mint)
    return to === null || to.live > MAX_TREE_LEAVES ? null : to.next
  }

  /** What a sequence reached. */
  type Reached = {
    gestures: Record<Gesture, number>
    awayAndBack: number
    closedAndToggled: number
    reidentified: number
    underTwoKinds: number
    switchesRefused: number
    addsRefused: number
  }
  const nothing = (): Reached => ({
    gestures: Object.fromEntries(GESTURES.map((g) => [g, 0])) as Record<Gesture, number>,
    awayAndBack: 0,
    closedAndToggled: 0,
    reidentified: 0,
    underTwoKinds: 0,
    switchesRefused: 0,
    addsRefused: 0,
  })
  const twoKinds = (now: State): boolean => {
    const kinds = new Map<LeafId, PaneKind>()
    return [now.tree, ...Object.values(now.arrangements)]
      .flatMap((t) => leaves(t))
      .some((l) => kinds.set(l.id, kinds.get(l.id) ?? l.pane).get(l.id) !== l.pane)
  }

  /** The six things held after every gesture, of `now`, with `what` naming the seed and the step. */
  const held = (now: State, what: string, reached: Reached): void => {
    expect(now.arrangements[treeKey(now.tree)], `${what}: an entry under the key of the tree on screen`).toBeUndefined()
    for (const [key, tree] of Object.entries(now.arrangements)) {
      expect(parseKey(key), `${what}: ${key} is no key`).not.toBeNull()
      expect(treeKey(tree), `${what}: a tree under another combination’s key`).toBe(key)
    }
    const workspace = {
      ...defaultWorkspace('wide'),
      tree: now.tree,
      arrangements: now.arrangements,
      focused: defaultFocus(now.tree),
    }
    expect(parseWorkspace(serializeWorkspace(workspace)), `${what}: the workspace does not read back`).toEqual(
      workspace,
    )
    const live = liveLeaves(now.tree, now.arrangements)
    const shown = leaves(now.tree)
    expect(
      shown.map((l) => `${l.id}:${live.get(l.id)}`),
      `${what}: liveLeaves gives a view on screen another kind than the tree on screen does`,
    ).toEqual(shown.map((l) => `${l.id}:${l.pane}`))

    let probes = 0
    const probe = (): LeafId => `probe-${probes++}`
    for (const stop of COMBINATIONS) {
      const away = switched(now, stop, probe)
      if (away === null) continue
      const back = switched(away, combinationOf(now.tree), probe)
      expect(back?.tree, `${what}: away to ${keyOf(stop)} and back`).toEqual(now.tree)
      reached.awayAndBack += 1
    }
    for (const kind of KIND_ORDER) {
      const views = shown.filter((l) => l.pane === kind)
      const only = views[0]
      if (only === undefined || views.length !== 1 || shown.length === 1) continue
      const closed = enter(now, closeLeaf(now.tree, only.id))
      const back = switched(closed, toggled(combinationOf(closed.tree), kind), probe)
      expect(back?.tree, `${what}: ✕ on the one ${kind} view, then its toggle`).toEqual(now.tree)
      reached.closedAndToggled += 1
    }
  }

  /**
   * 60 live views, two of them on screen: the first load's two views, and 58 λ views in the arrangement remembered
   * for the λ view alone, `pane-1` to `pane-58`, so the ids a sequence mints start at `pane-59`.
   */
  const CROWD = 58
  const CROWDED: State = {
    tree: of('source', 'tm'),
    arrangements: {
      lambda: {
        kind: 'split',
        dir: 'row',
        sizes: Array.from({ length: CROWD }, () => 1 / CROWD),
        children: Array.from({ length: CROWD }, (_, i) => ({ kind: 'leaf', id: `pane-${i + 1}`, pane: 'lambda' })),
      },
    },
  }
  const STARTS = {
    'the first load’s two views': { state: { tree: of('source', 'tm'), arrangements: {} } as State, minted: 0 },
    'a workspace of 60 live views': { state: CROWDED, minted: CROWD },
  }
  type Start = keyof typeof STARTS
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const SEQUENCES = (Object.keys(STARTS) as Start[]).flatMap((start) => SEEDS.map((seed) => [start, seed] as const))

  /** Each sequence run so far and what it reached, so the last case runs only the ones no case before it has. */
  const ran = new Map<string, Reached>()
  const sequence = (start: Start, seed: number): Reached => {
    const name = `${start}, seed ${seed}`
    const done = ran.get(name)
    if (done !== undefined) return done
    const reached = nothing()
    const next = random(seed)
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T
    let minted = STARTS[start].minted
    const mint = (): LeafId => `pane-${++minted}`
    let now: State = STARTS[start].state
    held(now, `${name} at the start`, reached)

    for (let step = 1; step <= 60; step++) {
      const gesture = pick(GESTURES)
      const shown = leaves(now.tree)
      const before = minted
      let made: State | null = null
      switch (gesture) {
        case 'toggle':
        case 'cycle': {
          const kinds = combinationOf(now.tree)
          const target =
            gesture === 'toggle' ? toggled(kinds, pick(KIND_ORDER)) : cycleFrom(kinds, pick([1, -1] as const))
          const to = entering(now, target, mint)
          if (to === null) break
          if (to.live > MAX_TREE_LEAVES) {
            reached.switchesRefused += 1
            break
          }
          made = to.next
          if (minted > before) reached.reidentified += 1
          const entered = new Map(leaves(made.tree).map((l) => [l.id, l.pane]))
          expect(
            shown.filter((l) => entered.has(l.id)).map((l) => `${l.id}:${entered.get(l.id)}`),
            `${name}, step ${step}: a ${gesture} put an id that was on screen back on it as another kind`,
          ).toEqual(shown.filter((l) => entered.has(l.id)).map((l) => `${l.id}:${l.pane}`))
          break
        }
        case 'close':
          if (shown.length > 1) made = enter(now, closeLeaf(now.tree, pick(shown).id))
          break
        case 'add': {
          // HELD TO THE BOUND AS `pane-host.ts`'s `admit` HOLDS IT, the source view's id counted where it is live
          // already, and to one source view a tree.
          const kind = pick(KIND_ORDER)
          if (kind === 'source' && shown.some((l) => l.pane === 'source')) break
          const live = liveLeaves(now.tree, now.arrangements)
          const adds = kind !== 'source' || !live.has('source')
          if (adds && live.size >= MAX_TREE_LEAVES) {
            reached.addsRefused += 1
            break
          }
          const id = kind === 'source' ? 'source' : mint()
          made = enter(now, insertBeside(now.tree, pick(shown).id, pick(['row', 'column'] as const), id, kind))
          break
        }
        case 'pick': {
          const views = shown.filter((l) => l.pane !== 'source')
          if (views.length === 0) break
          const view = pick(views)
          made = enter(now, setLeafKind(now.tree, view.id, pick(VIEW_KINDS.filter((k) => k !== view.pane))))
          break
        }
        case 'drag': {
          if (now.tree.kind !== 'split') break
          // EVERY DRAG IS MADE, THE CROWD'S AMONG THEM. Of the crowd's row each view is a 58th, and two of them
          // together cannot hold `MIN_PANE_FRACTION` each: `resize` answered shares of 0.1 and −0.066 there (measured
          // 2026-10-12), a tree the loader refuses, and answers the tree as it was given now. The round trip through
          // `parseWorkspace` after every gesture is what holds it here.
          made = enter(now, resize(now.tree, [], 0, pick([0.05, -0.05])))
          break
        }
      }
      if (made === null) continue
      now = made
      reached.gestures[gesture] += 1
      if (twoKinds(now)) reached.underTwoKinds += 1
      held(now, `${name}, step ${step}, after a ${gesture}`, reached)
    }
    ran.set(name, reached)
    return reached
  }

  it.each(SEQUENCES)(
    'holds the six, and each switch to its ids, over 60 gestures from %s, generated from seed %i',
    (start, seed) => {
      sequence(start, seed)
    },
  )

  it('reached every gesture, both properties, a leaf given a new id, an id under two kinds and both refusals', () => {
    const sum = (from: Start, read: (r: Reached) => number): number =>
      SEQUENCES.filter(([start]) => start === from).reduce((n, [start, seed]) => n + read(sequence(start, seed)), 0)
    const two = 'the first load’s two views'
    for (const gesture of GESTURES)
      expect(
        sum(two, (r) => r.gestures[gesture]),
        gesture,
      ).toBeGreaterThan(45)
    expect(sum(two, (r) => r.awayAndBack)).toBeGreaterThan(4500)
    expect(sum(two, (r) => r.closedAndToggled)).toBeGreaterThan(650)
    expect(sum(two, (r) => r.reidentified)).toBeGreaterThan(35)
    expect(sum(two, (r) => r.underTwoKinds)).toBeGreaterThan(280)
    // NO SEQUENCE FROM TWO VIEWS COMES NEAR THE BOUND, which is why four start beside it.
    expect(sum(two, (r) => r.switchesRefused + r.addsRefused)).toBe(0)
    const crowded = 'a workspace of 60 live views'
    expect(
      sum(crowded, (r) => r.switchesRefused),
      'switches refused at the bound',
    ).toBeGreaterThan(26)
    expect(
      sum(crowded, (r) => r.addsRefused),
      'adds refused at the bound',
    ).toBeGreaterThan(16)
  })
})

describe('the cycle', () => {
  it('has four stops: the source beside asm, λ and TM in turn, as the header has them, then all four', () => {
    expect(CYCLE.map(keyOf)).toEqual(['source+asm', 'source+lambda', 'source+tm', 'source+lambda+asm+tm'])
    for (const stop of CYCLE) expect(parseKey(keyOf(stop)), keyOf(stop)).toEqual(stop)
  })

  it('steps to the next and the previous stop, wrapping', () => {
    expect(cycleFrom(['source', 'asm'], 1)).toEqual(['source', 'lambda'])
    expect(cycleFrom(['source', 'lambda'], 1)).toEqual(['source', 'tm'])
    expect(cycleFrom(['source', 'tm'], 1)).toEqual(KIND_ORDER)
    expect(cycleFrom(KIND_ORDER, 1)).toEqual(['source', 'asm'])
    expect(cycleFrom(['source', 'asm'], -1)).toEqual(KIND_ORDER)
    expect(cycleFrom(['source', 'tm'], -1)).toEqual(['source', 'lambda'])
  })

  it('goes to the first stop forward and the last stop back from a combination that is not a stop', () => {
    expect(cycleFrom(['tm'], 1)).toEqual(['source', 'asm'])
    expect(cycleFrom(['tm'], -1)).toEqual(KIND_ORDER)
    expect(cycleFrom(['source', 'lambda', 'tm'], 1)).toEqual(['source', 'asm'])
  })
})

describe('the header’s order', () => {
  it('is source, asm, λ, TM: every kind of KIND_ORDER, each once', () => {
    expect(HEADER_ORDER).toEqual(['source', 'asm', 'lambda', 'tm'])
    expect([...HEADER_ORDER].sort()).toEqual([...KIND_ORDER].sort())
    expect(new Set(HEADER_ORDER).size).toBe(KIND_ORDER.length)
  })
})

describe('liveLeaves', () => {
  it('is the leaves of the tree on screen and of every remembered tree, each id once', () => {
    const live = liveLeaves(of('source', 'tm'), { [treeKey(FOUR)]: FOUR, lambda: of('lambda') })
    expect([...live.keys()].sort()).toEqual(['asm-0', 'lambda-0', 'source', 'tm-0'])
    expect(live.get('asm-0')).toBe('asm')
  })

  it('takes the kind the tree on screen gives an id two trees hold', () => {
    const onScreen = setLeafKind(of('source', 'tm'), 'tm-0', 'asm')
    const live = liveLeaves(onScreen, { 'source+tm': of('source', 'tm') })
    expect(live.get('tm-0')).toBe('asm')
    expect(live.size).toBe(2)
    // AND WHEREVER THE ARRANGEMENT STANDS IN THE RECORD: the tree on screen is asked first.
    const last = liveLeaves(onScreen, { asm: of('asm'), 'source+tm': of('source', 'tm') })
    expect(last.get('tm-0')).toBe('asm')
  })

  /**
   * The view off the screen is what the arrangement left last made it (spec §5.4). `PICKED` is all four with a TM
   * view picked in the asm view's title: `asm-0` is a TM view there and an asm view in `FOUR`.
   */
  it('takes, for an id only remembered trees hold, the kind of the one left last', () => {
    const pair = of('source', 'tm')
    const stale = liveLeaves(pair, { [treeKey(FOUR)]: FOUR, [treeKey(PICKED)]: PICKED })
    expect(stale.get('asm-0')).toBe('tm')
    const other = liveLeaves(pair, { [treeKey(PICKED)]: PICKED, [treeKey(FOUR)]: FOUR })
    expect(other.get('asm-0')).toBe('asm')
    expect(stale.size).toBe(4)
  })
})

/**
 * A SWITCH ENTERS A LEAF WHOSE ID IS LIVE AS ANOTHER KIND UNDER A NEW ID — spec §5.4. Each state here is reached
 * through `enter`, so which arrangement was left last is what the app would have made it.
 */
describe('reidentified', () => {
  /** A mint that counts its calls: `fresh-1`, `fresh-2`, ids no tree here holds. */
  const minting = (): { mint: () => LeafId; minted: LeafId[] } => {
    const minted: LeafId[] = []
    return {
      minted,
      mint: () => {
        minted.push(`fresh-${minted.length + 1}`)
        return minted.at(-1) as LeafId
      },
    }
  }
  const idsOf = (tree: LayoutNode): string[] => leaves(tree).map((l) => `${l.id}:${l.pane}`)
  /** The four views, then the pick: `PICKED` on screen, `FOUR` remembered, and `asm-0` under two kinds. */
  const picked = enter({ tree: FOUR, arrangements: {} }, PICKED)

  it('is the tree it was handed where no leaf’s id is live as another kind, and mints nothing', () => {
    const { mint, minted } = minting()
    const pair = { tree: of('source', 'tm'), arrangements: {} as Arrangements }
    expect(reidentified(FOUR, liveLeaves(pair.tree, pair.arrangements), mint)).toBe(FOUR)
    // A REMEMBERED TREE COMING BACK, every leaf what it was: the pair, from all four.
    const away = enter(pair, FOUR)
    const back = away.arrangements['source+tm'] as LayoutNode
    expect(reidentified(back, liveLeaves(away.tree, away.arrangements), mint)).toBe(back)
    expect(minted).toEqual([])
  })

  it('gives a default’s leaf a new id where the id is live as another kind', () => {
    const { mint, minted } = minting()
    expect(picked.arrangements, 'precondition: the tree before the pick is remembered').toEqual({ [ALL]: FOUR })
    const hidden = enter(picked, of('source', 'tm'))
    const three = of('source', 'asm', 'tm')
    const live = liveLeaves(hidden.tree, hidden.arrangements)
    expect(live.get('asm-0'), 'precondition: asm-0 is a TM view, parked').toBe('tm')
    const entered = reidentified(three, live, mint)
    expect(idsOf(entered)).toEqual(['source:source', 'fresh-1:asm', 'tm-0:tm'])
    expect(minted).toEqual(['fresh-1'])
    // THE TREE IS WHAT IT WAS BUT FOR THE ID, and what it was is left as it was.
    expect(parseTree(entered)).not.toBeNull()
    expect(JSON.stringify(entered).replace('fresh-1', 'asm-0')).toBe(JSON.stringify(three))
    expect(idsOf(three)).toEqual(['source:source', 'asm-0:asm', 'tm-0:tm'])
  })

  it('gives a remembered tree’s leaf a new id where the tree on screen has the id as another kind', () => {
    const { mint } = minting()
    const entered = reidentified(FOUR, liveLeaves(picked.tree, picked.arrangements), mint)
    expect(idsOf(entered)).toEqual(['source:source', 'fresh-1:asm', 'lambda-0:lambda', 'tm-0:tm'])
    expect(idsOf(FOUR), 'the remembered tree was changed').toEqual([
      'source:source',
      'asm-0:asm',
      'lambda-0:lambda',
      'tm-0:tm',
    ])
  })

  /**
   * With the pair on screen, `asm-0` is in two remembered trees only: an asm view in `FOUR`, and a TM view in `PICKED`,
   * which was left last and so is what the parked view is. `FOUR` is entered under a new id, and `PICKED` as it is.
   */
  it('gives a remembered tree’s leaf a new id where a tree left later has the id as another kind', () => {
    const { mint, minted } = minting()
    const hidden = enter(picked, of('source', 'tm'))
    expect(Object.keys(hidden.arrangements), 'precondition: the picked tree was left last').toEqual([
      ALL,
      treeKey(PICKED),
    ])
    expect(
      leaves(hidden.tree).map((l) => l.id),
      'precondition: the tree on screen does not hold asm-0',
    ).toEqual(['source', 'tm-0'])
    const live = liveLeaves(hidden.tree, hidden.arrangements)
    expect(idsOf(reidentified(FOUR, live, mint))).toEqual([
      'source:source',
      'fresh-1:asm',
      'lambda-0:lambda',
      'tm-0:tm',
    ])
    expect(reidentified(PICKED, live, mint), 'the tree the parked view was left in lost it').toBe(PICKED)
    expect(minted).toEqual(['fresh-1'])
  })

  /**
   * `parseTree` holds `source` to the source kind in every tree, so no workspace has it live as another. The map
   * here says it is, which only a caller's mistake could: the source leaf keeps its id all the same.
   */
  it('never gives the source leaf another id', () => {
    const { mint, minted } = minting()
    const live = new Map<LeafId, PaneKind>([
      ['source', 'lambda'],
      ['tm-0', 'asm'],
    ])
    expect(idsOf(reidentified(of('source', 'tm'), live, mint))).toEqual(['source:source', 'fresh-1:tm'])
    expect(minted).toEqual(['fresh-1'])
  })

  it('gives two such leaves an id each, and leaves a split with neither as it was', () => {
    const { mint, minted } = minting()
    // λ AND TM EACH LIVE AS AN ASM VIEW: the two on the right of all four, whose left column holds neither.
    const live = new Map<LeafId, PaneKind>([
      ['lambda-0', 'asm'],
      ['tm-0', 'asm'],
    ])
    const entered = reidentified(FOUR, live, mint)
    expect(idsOf(entered)).toEqual(['source:source', 'asm-0:asm', 'fresh-1:lambda', 'fresh-2:tm'])
    expect(new Set(minted).size).toBe(2)
    if (entered.kind !== 'split' || FOUR.kind !== 'split') throw new Error('all four views are a split')
    expect(entered.children[0], 'a split no leaf of which took an id was built again').toBe(FOUR.children[0])
    expect(entered.children[1]).not.toBe(FOUR.children[1])
  })
})

describe('shapeOf', () => {
  it('is tall for an area taller than it is wide, and wide otherwise', () => {
    expect(shapeOf({ width: 320, height: 568 })).toBe('tall')
    expect(shapeOf({ width: 1280, height: 725 })).toBe('wide')
    expect(shapeOf({ width: 500, height: 500 })).toBe('wide')
    expect(shapeOf({ width: 0, height: 0 })).toBe('wide')
  })
})
