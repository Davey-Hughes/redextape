import type { LambdaTreeWire } from '../../src/protocol'

type Ast = { k: 'var'; name: string } | { k: 'abs'; name: string; body: Ast } | { k: 'app'; f: Ast; a: Ast }

/** Parse `\x. x`-style λ text (`\` or `λ`, juxtaposition, parentheses) — the printer's grammar. Test-only. */
function parse(src: string): Ast {
  const toks = src.match(/λ|\\|\(|\)|\.|[A-Za-z_][A-Za-z0-9_']*/g) ?? []
  let i = 0
  const binder = () => toks[i] === 'λ' || toks[i] === '\\'
  const term = (): Ast => {
    if (binder()) {
      i += 1
      const name = toks[i] as string
      i += 2
      return { k: 'abs', name, body: term() }
    }
    let f = atom()
    while (i < toks.length && toks[i] !== ')') f = { k: 'app', f, a: binder() ? term() : atom() }
    return f
  }
  const atom = (): Ast => {
    if (toks[i] === '(') {
      i += 1
      const t = term()
      i += 1
      return t
    }
    const name = toks[i] as string
    i += 1
    return { k: 'var', name }
  }
  return term()
}

export type FixtureOptions = {
  readonly step?: number
  /** Defaults to the first `App` whose function is an `Abs`, in pre-order — the core's rule. */
  readonly nextRedex?: number | null
  readonly contractum?: number | null
  /** Node index -> the construct it links to. */
  readonly links?: Readonly<Record<number, number>>
}

/**
 * The `LambdaTreeWire` `tree_to_js` would send for `src`: pre-order, de Bruijn indices, one entry per
 * occurrence. Names are the text's own — no freshening — and double as hints, so a fixture chooses its
 * chips by choosing its binder names.
 */
export function wireOf(src: string, o: FixtureOptions = {}): LambdaTreeWire {
  const kind: number[] = []
  const left: number[] = []
  const right: number[] = []
  const name: number[] = []
  const link: number[] = []
  const names: string[] = []
  const intern = (s: string): number => {
    const at = names.indexOf(s)
    if (at >= 0) return at
    names.push(s)
    return names.length - 1
  }
  let redex: number | null = null
  const walk = (t: Ast, scope: readonly string[]): number => {
    const me = kind.length
    kind.push(0)
    left.push(0)
    right.push(0)
    name.push(0)
    link.push(o.links?.[me] ?? 0xffff_ffff)
    if (t.k === 'var') {
      const at = scope.lastIndexOf(t.name)
      left[me] = at < 0 ? scope.length : scope.length - 1 - at
      name[me] = intern(t.name)
    } else if (t.k === 'abs') {
      kind[me] = 1
      name[me] = intern(t.name)
      left[me] = walk(t.body, [...scope, t.name])
    } else {
      kind[me] = 2
      if (redex === null && t.f.k === 'abs') redex = me
      left[me] = walk(t.f, scope)
      right[me] = walk(t.a, scope)
    }
    return me
  }
  walk(parse(src), [])
  return {
    step: o.step ?? 0,
    refused: null,
    kind: Uint8Array.from(kind),
    left: Uint32Array.from(left),
    right: Uint32Array.from(right),
    name: Uint32Array.from(name),
    hint: Uint32Array.from(name),
    link: Uint32Array.from(link),
    names,
    nextRedex: o.nextRedex === undefined ? redex : o.nextRedex,
    contractum: o.contractum ?? null,
  }
}
