import type { Tree } from './lambda-tree'

/** A subterm larger than this starts folded, unless the next redex is inside it (spec §5.2). */
export const AUTO_FOLD_NODES = 200

/**
 * Whether node `i` starts open: a chip never, so a numeral reads as its value — the root included, which
 * is what a finished run's `42` is; the root otherwise always; anything holding the next redex, so the path
 * to it is always drawn; anything else while it is small.
 *
 * **THE CHIP TEST COMES FIRST.** The prototype asked about the root first, and every finished numeric
 * run drew its answer as `λf x. f (f (f …` instead of its value. A chip can never hold the next redex —
 * it is a normal form — so asking it first costs the redex rule nothing.
 */
export function autoOpen(t: Tree, i: number): boolean {
  if (t.chip(i) !== null) return false
  if (i === 0) return true
  const r = t.wire.nextRedex
  if (r !== null && t.contains(i, r)) return true
  return (t.size[i] as number) <= AUTO_FOLD_NODES
}

/**
 * One view's folds: the automatic policy, and whatever the user opened or folded by hand.
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
  #step: number | null = null
  #version = 0

  /** Bumped whenever the set of open nodes may have changed — a layout cache keys on it. */
  get version(): number {
    return this.#version
  }

  isOpen(t: Tree, i: number): boolean {
    return this.#overrides.get(t.key(i)) ?? autoOpen(t, i)
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

  reset(): void {
    this.#overrides.clear()
    this.#version += 1
  }
}
