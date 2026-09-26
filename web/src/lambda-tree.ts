import type { LambdaTreeWire } from './protocol'

/** `LambdaTreeWire.kind`'s values — `redextape-core`'s `viewmodel::tree::KIND_*`. */
export const KIND_VAR = 0
export const KIND_ABS = 1
export const KIND_APP = 2
/** `LambdaTreeWire.link`'s "no construct" — `viewmodel::tree::NO_LINK`, `u32::MAX`. */
export const NO_LINK = 0xffff_ffff

/** A subterm the view draws abbreviated (spec §5.2). */
export type Chip =
  | { readonly kind: 'numeral'; readonly value: number }
  | { readonly kind: 'bool'; readonly value: boolean }

/**
 * A `LambdaTreeWire` plus what every consumer derives from it once: each node's parent, depth and
 * subtree size, all in two passes and neither recursive.
 *
 * **PRE-ORDER MAKES A SUBTREE ONE INDEX RANGE.** Node `i`'s subtree is exactly `[i, i + size[i])`, so
 * "is this token inside the redex" is two comparisons — which is how every mark in the view is drawn,
 * and how the icicle places a node.
 */
export class Tree {
  readonly wire: LambdaTreeWire
  readonly count: number
  readonly parent: Int32Array
  readonly depth: Uint32Array
  readonly size: Uint32Array
  readonly maxDepth: number
  #keys = new Map<number, string>()
  /** `nodesLinkedTo`'s last answer, and the construct it was for. */
  #linked: { readonly id: number; readonly nodes: readonly number[] } | null = null

  constructor(wire: LambdaTreeWire) {
    this.wire = wire
    const n = wire.kind.length
    this.count = n
    this.parent = new Int32Array(n).fill(-1)
    this.depth = new Uint32Array(n)
    this.size = new Uint32Array(n)
    let maxDepth = 0
    // FORWARD: a parent precedes its children, so its depth is final before they are reached.
    for (let i = 0; i < n; i += 1) {
      const k = wire.kind[i]
      if (k === KIND_VAR) continue
      const d = (this.depth[i] as number) + 1
      const l = wire.left[i] as number
      this.parent[l] = i
      this.depth[l] = d
      if (k === KIND_APP) {
        const r = wire.right[i] as number
        this.parent[r] = i
        this.depth[r] = d
      }
      if (d > maxDepth) maxDepth = d
    }
    // BACKWARD: children follow their parent, so their sizes are final before it is reached.
    for (let i = n - 1; i >= 0; i -= 1) {
      const k = wire.kind[i]
      let s = 1
      if (k !== KIND_VAR) s += this.size[wire.left[i] as number] as number
      if (k === KIND_APP) s += this.size[wire.right[i] as number] as number
      this.size[i] = s
    }
    this.maxDepth = maxDepth
  }

  kind(i: number): number {
    return this.wire.kind[i] as number
  }

  /** An `Abs`'s body or an `App`'s function. */
  left(i: number): number {
    return this.wire.left[i] as number
  }

  /** An `App`'s argument. */
  right(i: number): number {
    return this.wire.right[i] as number
  }

  /** A `Var`'s de Bruijn index. */
  index(i: number): number {
    return this.wire.left[i] as number
  }

  /** The name the printer writes: a binder's freshened name, or a variable's binder's. */
  name(i: number): string {
    return this.wire.names[this.wire.name[i] as number] ?? ''
  }

  /** A binder's raw hint, before freshening — what chips are read by. */
  hint(i: number): string {
    return this.wire.names[this.wire.hint[i] as number] ?? ''
  }

  link(i: number): number {
    return this.wire.link[i] as number
  }

  contains(i: number, j: number): boolean {
    return j >= i && j < i + (this.size[i] as number)
  }

  /**
   * The path from the root to `i`, one letter per edge — `L`, `R`, `B` for the core's `AppL`, `AppR`,
   * `AbsBody`. A fold is keyed by this, because a node's INDEX moves whenever anything before it in
   * pre-order changes size, and its path does not (spec §5.2).
   *
   * **A KEY IS ITS PARENT'S PLUS ONE LETTER.** The walk goes up only to the nearest node already keyed — the
   * root's key is `''` — and writes each key below it on the way back down. A layout asks for every open node
   * on a path, top down, so each ask adds one letter; walking to the root for each cost the path's depth per
   * node, which on a path thousands deep was most of a layout's time.
   */
  key(i: number): string {
    const cached = this.#keys.get(i)
    if (cached !== undefined) return cached
    const below: number[] = []
    let key = ''
    for (let at = i; at > 0; at = this.parent[at] as number) {
      const known = this.#keys.get(at)
      if (known !== undefined) {
        key = known
        break
      }
      below.push(at)
    }
    for (let b = below.length - 1; b >= 0; b -= 1) {
      const n = below[b] as number
      const p = this.parent[n] as number
      key += this.kind(p) === KIND_ABS ? 'B' : this.left(p) === n ? 'L' : 'R'
      this.#keys.set(n, key)
    }
    return key
  }

  /** The construct `i` belongs to: its own link, or its nearest linked ancestor's — the innermost. */
  linkedAncestor(i: number): number | null {
    for (let at = i; at >= 0; at = this.parent[at] as number) {
      const l = this.link(at)
      if (l !== NO_LINK) return l
    }
    return null
  }

  /**
   * Every node that carries construct `id`, ascending.
   *
   * **THE LAST ANSWER IS KEPT.** A λ view asks for its pin's nodes more than once a frame — to mark them,
   * and to say whether there are any — and each walk is over every node. The array is shared, so it is
   * read-only.
   */
  nodesLinkedTo(id: number): readonly number[] {
    if (this.#linked?.id === id) return this.#linked.nodes
    const out: number[] = []
    for (let i = 0; i < this.count; i += 1) if (this.wire.link[i] === id) out.push(i)
    this.#linked = { id, nodes: out }
    return out
  }

  /**
   * The chip `i` is, if any: a Church numeral under binders hinted `f` and `x`, or a boolean under `t` and
   * `f` (spec §5.2). **THE HINT IS THE ONLY THING THAT TELLS `false` FROM `0`** — `λt. λf. f` and
   * `λf. λx. x` are one term — and lowering always writes each with its own pair.
   *
   * **A HINT'S TRAILING DIGITS ARE IGNORED.** Freshening is print-time only, so a lowered term's hints never
   * carry them — but a copy is built by re-parsing printed text, and there the printed, freshened names
   * (`x0`) ARE the hints. Without this a numeral in any copy whose printer had freshened its binders would
   * never read as a chip (found by the prototype's `scratch-app` run).
   */
  chip(i: number): Chip | null {
    if (this.kind(i) !== KIND_ABS) return null
    const inner = this.left(i)
    if (this.kind(inner) !== KIND_ABS) return null
    const outer = this.hint(i).replace(/\d+$/, '')
    const second = this.hint(inner).replace(/\d+$/, '')
    let body = this.left(inner)
    if (outer === 't' && second === 'f') {
      return this.kind(body) === KIND_VAR ? { kind: 'bool', value: this.index(body) === 1 } : null
    }
    if (outer !== 'f' || second !== 'x') return null
    let n = 0
    while (this.kind(body) === KIND_APP) {
      const fn = this.left(body)
      if (this.kind(fn) !== KIND_VAR || this.index(fn) !== 1) return null
      n += 1
      body = this.right(body)
    }
    return this.kind(body) === KIND_VAR && this.index(body) === 0 ? { kind: 'numeral', value: n } : null
  }
}
