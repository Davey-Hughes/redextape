import type { Tree } from './lambda-tree'

/** A subterm larger than this starts folded, unless the next redex is inside it (spec §5.2). */
export const AUTO_FOLD_NODES = 200

/**
 * Whether node `i` starts open: a chip never, so a numeral reads as its value — the root included, which
 * is what a finished run's `42` is; the root otherwise always; anything holding the next redex, so the path
 * to it is always drawn; anything else while it is small.
 *
 * **THE CHIP TEST COMES FIRST.** Asked about the root first, every finished numeric run would draw its
 * answer as `λf x. f (f (f …` instead of its value. A chip can never hold the next redex — it is a normal
 * form — so asking it first costs the redex rule nothing.
 */
export function autoOpen(t: Tree, i: number): boolean {
  if (t.chip(i) !== null) return false
  if (i === 0) return true
  const r = t.wire.nextRedex
  if (r !== null && t.contains(i, r)) return true
  return (t.size[i] as number) <= AUTO_FOLD_NODES
}

/**
 * One view's folds: the automatic policy or expand all, and whatever the user opened or folded by hand.
 *
 * **AN OVERRIDE IS KEYED BY PATH, NOT BY NODE INDEX.** An index moves whenever anything earlier in
 * pre-order changes size; a path names the same position in the next step's term unless that step
 * rewrote it. A β-step rewrites only its redex's subtree, so stepping by one drops the overrides under
 * that step's contractum and keeps every other (spec §5.2). Across a jump of several steps the view does
 * not know the intermediate redexes and keeps any override whose path still resolves — the imprecision
 * the spec accepts rather than a replay it would pay for.
 */
export class Folds {
  #overrides = new Map<string, boolean>()
  #expandAll = false
  #step: number | null = null
  #version = 0

  /** Bumped whenever the set of open nodes may have changed — a layout cache keys on it. */
  get version(): number {
    return this.#version
  }

  /**
   * Whether every node but a chip starts open, in place of `autoOpen` (the expand-all spec). A MODE AND
   * NOT A ONE-OFF OPENING, so what a later step builds opens too: it changes the default the overrides sit on, and
   * `advance` hands a contractum that default as it always has.
   *
   * **A CHIP STAYS CLOSED UNDER IT**, because a numeral's or boolean's value is the readable form of it; a click
   * still opens one, as an override.
   */
  get expandAll(): boolean {
    return this.#expandAll
  }

  /**
   * Turn expand all on or off. **EITHER WAY THE OVERRIDES GO:** turned on, a node folded by hand before would stay
   * folded and "everything opens" would not hold; turned off, it is "reset folds".
   */
  setExpandAll(on: boolean): void {
    this.#expandAll = on
    this.#overrides.clear()
    this.#version += 1
  }

  isOpen(t: Tree, i: number): boolean {
    // NO PATH WITHOUT AN OVERRIDE TO MATCH IT: under expand all the layout asks about every node of a new `Tree` each
    // step, and building and hashing a path costs its depth, so a deep term would pay its whole depth sum per step.
    const o = this.#overrides.size === 0 ? undefined : this.#overrides.get(t.key(i))
    return o ?? (this.#expandAll ? t.chip(i) === null : autoOpen(t, i))
  }

  toggle(t: Tree, i: number): void {
    this.#overrides.set(t.key(i), !this.isOpen(t, i))
    this.#version += 1
  }

  /** Called with every tree the view draws. One step on from the last, it drops what that step rewrote. */
  advance(t: Tree): void {
    const step = t.wire.step
    if (step === this.#step) return
    const c = t.wire.contractum
    if (this.#step !== null && step === this.#step + 1 && c !== null) {
      const under = t.key(c)
      for (const k of [...this.#overrides.keys()]) if (k.startsWith(under)) this.#overrides.delete(k)
    }
    this.#step = step
    this.#version += 1
  }

  /** Open every closed ancestor of `i`, so a line shows it — what a term-map click asks for. */
  reveal(t: Tree, i: number): void {
    let changed = false
    for (let at = t.parent[i] as number; at >= 0; at = t.parent[at] as number) {
      if (!this.isOpen(t, at)) {
        this.#overrides.set(t.key(at), true)
        changed = true
      }
    }
    if (changed) this.#version += 1
  }

  /** "reset folds": back to the automatic policy, expand all off and no overrides. */
  reset(): void {
    this.setExpandAll(false)
  }

  /**
   * A different term — a new build or another session's. Its paths name nothing the old term's did, so the
   * overrides go; expand all is the user's choice of how to see a term, not a fact about this one, so it stays.
   */
  newTerm(): void {
    this.#overrides.clear()
    this.#version += 1
  }
}
