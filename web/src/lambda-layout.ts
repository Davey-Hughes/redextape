import { type Chip, KIND_ABS, KIND_APP, KIND_VAR, type Tree } from './lambda-tree'

/** How variables are written: by name, or by de Bruijn index (spec §5.1). */
export type Vars = 'names' | 'debruijn'

/** What a token is, which decides its colour and what a click on it does. */
export type TokenKind = 'binder' | 'ident' | 'punct' | 'keyword' | 'chip' | 'fold'

/** One run of text, and the node it belongs to — every mark and every click resolves through `node`. */
export type Token = { readonly text: string; readonly kind: TokenKind; readonly node: number }

/** One laid-out line. */
export type Line = {
  /** Leading indentation, in character cells. */
  readonly indent: number
  /** The line's nesting depth, from 1 — `aria-level`, and what its indentation draws, in either layout. */
  readonly level: number
  readonly tokens: readonly Token[]
  /** The node this line's `▸`/`▾` opens or folds, or -1 when it has none. */
  readonly disclose: number
  /**
   * The head this line began as before its application took it (`codeLines`), when that head broke or is
   * folded: a second node the line can fold, which ← folds before the application. Absent otherwise.
   */
  readonly inner?: number
}

export type LayoutOptions = {
  /** Characters per line. */
  readonly width: number
  readonly vars: Vars
  /** Whether a foldable node is open. A chip-shaped node is foldable too: closed, it is its chip. */
  readonly open: (node: number) => boolean
}

/** An outline row writes a subterm this narrow or narrower inline, rather than giving it rows of its own. */
export const OUTLINE_INLINE = 48

/** Where a node sits in its parent — the printer's `Role` in `lambda/syntax.rs`, which decides parentheses. */
type Role = 'term' | 'fn' | 'arg'

type MutLine = { indent: number; level: number; tokens: Token[]; disclose: number; inner?: number }

/** The chip `i` is drawn as, or `null` when it is drawn as its λ — a chip only while it is closed. */
export function shownChip(t: Tree, i: number, o: LayoutOptions): Chip | null {
  const chip = t.chip(i)
  return chip === null || o.open(i) ? null : chip
}

/** A chip's text. A numeral's bar is CSS (`.term-chip.tok-nat`), not a combining character. */
export function chipText(c: Chip): string {
  return String(c.value)
}

function varText(t: Tree, i: number, o: LayoutOptions): string {
  return o.vars === 'names' ? t.name(i) : String(t.index(i))
}

/** Whether an `Abs` body continues its parent's binder list — `λx y.` — which only names mode writes. */
function merges(t: Tree, body: number, o: LayoutOptions): boolean {
  return o.vars === 'names' && t.kind(body) === KIND_ABS && shownChip(t, body, o) === null
}

/** The printer's parenthesization: an abstraction anywhere but a term position, an application as an argument. */
function parens(t: Tree, i: number, role: Role, o: LayoutOptions): boolean {
  if (role === 'term' || shownChip(t, i, o) !== null) return false
  const k = t.kind(i)
  return k === KIND_ABS || (k === KIND_APP && role === 'arg')
}

/**
 * Every node's width written on one line in term position, children before parents — BACKWARDS over the
 * pre-order index, so no node is ever reached before its children and nothing recurses.
 */
export function widths(t: Tree, o: LayoutOptions): Uint32Array {
  const w = new Uint32Array(t.count)
  const as = (x: number, r: Role) => (w[x] as number) + (parens(t, x, r, o) ? 2 : 0)
  for (let i = t.count - 1; i >= 0; i -= 1) {
    const chip = shownChip(t, i, o)
    if (chip !== null) {
      w[i] = chipText(chip).length
      continue
    }
    const k = t.kind(i)
    if (k === KIND_VAR) {
      w[i] = varText(t, i, o).length
    } else if (k === KIND_ABS) {
      const b = t.left(i)
      if (o.vars === 'debruijn') w[i] = 3 + (w[b] as number)
      else if (merges(t, b, o)) w[i] = t.name(i).length + 1 + (w[b] as number)
      else w[i] = 3 + t.name(i).length + (w[b] as number)
    } else {
      w[i] = as(t.left(i), 'fn') + 1 + as(t.right(i), 'arg')
    }
  }
  return w
}

/** Write `i`'s binder list — `λx y. ` by name, `λ. ` by index — and return the body it binds. */
function binders(t: Tree, i: number, o: LayoutOptions, out: Token[]): number {
  let at = i
  out.push({ text: 'λ', kind: 'binder', node: at })
  if (o.vars === 'names') {
    out.push({ text: t.name(at), kind: 'binder', node: at })
    while (merges(t, t.left(at), o)) {
      at = t.left(at)
      out.push({ text: ' ', kind: 'punct', node: at }, { text: t.name(at), kind: 'binder', node: at })
    }
  }
  out.push({ text: '. ', kind: 'punct', node: at })
  return t.left(at)
}

/** Write `i` on one line in term position. */
function inline(t: Tree, i: number, o: LayoutOptions, out: Token[]): void {
  wrapped(t, i, 'term', o, out)
}

/** What a one-line walk still has to write: a node in its role, or a token it has already made. */
type Pending = Token | { readonly node: number; readonly role: Role }

/**
 * Write `i` on one line as it stands in `role`, parenthesized where the printer would.
 *
 * **ITERATIVE, OVER AN EXPLICIT STACK, LIKE BOTH LAYOUTS.** Only a node that fits its row is written this way,
 * so its depth is bounded by the width — but by a width the caller picks, and a wide enough one is a term's
 * whole depth. Nothing here recurses, so no width can overflow it.
 */
function wrapped(t: Tree, i: number, role: Role, o: LayoutOptions, out: Token[]): void {
  const work: Pending[] = [{ node: i, role }]
  for (let w = work.pop(); w !== undefined; w = work.pop()) {
    if ('text' in w) {
      out.push(w)
      continue
    }
    const node = w.node
    if (parens(t, node, w.role, o)) {
      work.push({ text: ')', kind: 'punct', node }, { node, role: 'term' }, { text: '(', kind: 'punct', node })
      continue
    }
    const chip = shownChip(t, node, o)
    const k = t.kind(node)
    if (chip !== null) out.push({ text: chipText(chip), kind: 'chip', node })
    else if (k === KIND_VAR) out.push({ text: varText(t, node, o), kind: 'ident', node })
    else if (k === KIND_ABS) work.push({ node: binders(t, node, o, out), role: 'term' })
    else {
      work.push(
        { node: t.right(node), role: 'arg' },
        { text: ' ', kind: 'punct', node },
        { node: t.left(node), role: 'fn' },
      )
    }
  }
}

/** A folded node's one line: its binders when it has them, then `… N nodes`. */
function folded(t: Tree, i: number, o: LayoutOptions, paren: boolean): Token[] {
  const out: Token[] = []
  if (paren) out.push({ text: '(', kind: 'punct', node: i })
  if (t.kind(i) === KIND_ABS) binders(t, i, o, out)
  out.push({ text: `… ${t.size[i]} nodes`, kind: 'fold', node: i })
  if (paren) out.push({ text: ')', kind: 'punct', node: i })
  return out
}

/** An application's spine: its head and its arguments in order — `f a b c` is one head and three arguments. */
function spine(t: Tree, i: number): { head: number; args: number[] } {
  const args: number[] = []
  let head = i
  while (t.kind(head) === KIND_APP) {
    args.push(t.right(head))
    head = t.left(head)
  }
  return { head, args: args.reverse() }
}

function close(lines: MutLine[], node: number): void {
  lines[lines.length - 1]?.tokens.push({ text: ')', kind: 'punct', node })
}

/**
 * What the code layout's walk still has to do: lay out a node; give an application the row its head began
 * once that head is written; or close a parenthesis on the last row written so far.
 */
type CodeWork =
  | { readonly op: 'node'; readonly i: number; readonly indent: number; readonly level: number; readonly role: Role }
  | { readonly op: 'row'; readonly i: number; readonly start: number; readonly indent: number; readonly paren: boolean }
  | { readonly op: 'close'; readonly i: number }

/**
 * The *code* layout (spec §5.1): a subterm that fits stays on one line; one that does not writes its head
 * on the first line and its arguments indented below, and an abstraction its binders then its body.
 *
 * **A LINE CARRIES THE OUTERMOST NODE THAT STARTS ON IT.** When an application's head is itself too wide
 * and breaks, the head's first line is the application's first line too; its `▾` folds the application.
 *
 * **ITERATIVE, OVER AN EXPLICIT STACK, AS `LambdaTree::build` IS.** The automatic folds keep the whole path to
 * the next redex open, and that path can be as deep as the reducer lets a term grow: a walk that recursed once
 * per open level overflowed the call stack on `2990 + 0` one step from its end, a legal program. The stack is
 * popped in the order the recursion ran, so the lines are the ones it wrote.
 */
export function codeLines(t: Tree, o: LayoutOptions): Line[] {
  const w = widths(t, o)
  const lines: MutLine[] = []
  const work: CodeWork[] = t.count > 0 ? [{ op: 'node', i: 0, indent: 0, level: 1, role: 'term' }] : []
  for (let x = work.pop(); x !== undefined; x = work.pop()) {
    if (x.op === 'close') close(lines, x.i)
    else if (x.op === 'row') takeRow(lines, x.start, x.i, x.indent, x.paren)
    else code(t, o, w, x.i, x.indent, x.level, x.role, lines, work)
  }
  return lines
}

/** Lay out node `i`, pushing onto `work` what is left of it: its body, its head and arguments, its `)`. */
function code(
  t: Tree,
  o: LayoutOptions,
  w: Uint32Array,
  i: number,
  indent: number,
  level: number,
  role: Role,
  lines: MutLine[],
  work: CodeWork[],
): void {
  const paren = parens(t, i, role, o)
  const k = t.kind(i)
  if (indent + (w[i] as number) + (paren ? 2 : 0) <= o.width || k === KIND_VAR || shownChip(t, i, o) !== null) {
    const tokens: Token[] = []
    wrapped(t, i, role, o, tokens)
    lines.push({ indent, level, tokens, disclose: -1 })
    return
  }
  if (!o.open(i)) {
    lines.push({ indent, level, tokens: folded(t, i, o, paren), disclose: i })
    return
  }
  if (k === KIND_ABS) {
    const head: Token[] = paren ? [{ text: '(', kind: 'punct', node: i }] : []
    const body = binders(t, i, o, head)
    lines.push({ indent, level, tokens: head, disclose: i })
    if (paren) work.push({ op: 'close', i })
    work.push({ op: 'node', i: body, indent: indent + 2, level: level + 1, role: 'term' })
    return
  }
  const { head, args } = spine(t, i)
  const inner = indent + (paren ? 1 : 0)
  // PUSHED LAST-FIRST: the head, then the application's row, then each argument in order, then its `)`.
  if (paren) work.push({ op: 'close', i })
  for (let a = args.length - 1; a >= 0; a -= 1) {
    work.push({ op: 'node', i: args[a] as number, indent: indent + 2, level: level + 1, role: 'arg' })
  }
  work.push({ op: 'row', i, start: lines.length, indent, paren })
  if (inner + (w[head] as number) + (parens(t, head, 'fn', o) ? 2 : 0) <= o.width) {
    const tokens: Token[] = []
    wrapped(t, head, 'fn', o, tokens)
    lines.push({ indent: inner, level, tokens, disclose: -1 })
  } else {
    // THE HEAD'S FIRST LINE IS THE APPLICATION'S ROW, AT ITS LEVEL; the rest of a broken head nests under it.
    work.push({ op: 'node', i: head, indent: inner, level, role: 'fn' })
  }
}

/**
 * Give application `i` the row its head began on, `lines[start]`, once the head is written.
 *
 * THE APPLICATION TAKES THE LINE, AND THE HEAD'S OWN DISCLOSURE IS KEPT BESIDE IT: a head that broke or is
 * folded is still a node to fold, and without this nothing on the row named it once it was open.
 */
function takeRow(lines: MutLine[], start: number, i: number, indent: number, paren: boolean): void {
  const first = lines[start] as MutLine
  if (first.disclose >= 0) first.inner = first.disclose
  first.indent = indent
  first.disclose = i
  if (paren) first.tokens.unshift({ text: '(', kind: 'punct', node: i })
}

/**
 * The *outline* layout (spec §5.1): one row per node, children indented a level, an application's spine
 * flattened to `apply head` with its arguments as child rows. A subterm narrower than `OUTLINE_INLINE`
 * is one row, so the outline shows structure where there is structure to show.
 *
 * ITERATIVE, OVER AN EXPLICIT STACK, for `codeLines`' reason.
 */
export function outlineLines(t: Tree, o: LayoutOptions): Line[] {
  const w = widths(t, o)
  const lines: MutLine[] = []
  const work: { readonly i: number; readonly level: number }[] = t.count > 0 ? [{ i: 0, level: 1 }] : []
  for (let x = work.pop(); x !== undefined; x = work.pop()) outline(t, o, w, x.i, x.level, lines, work)
  return lines
}

/** Write node `i`'s row, pushing onto `work` the children that get rows of their own, in reverse. */
function outline(
  t: Tree,
  o: LayoutOptions,
  w: Uint32Array,
  i: number,
  level: number,
  lines: MutLine[],
  work: { readonly i: number; readonly level: number }[],
): void {
  const indent = (level - 1) * 2
  const k = t.kind(i)
  const width = w[i] as number
  if (k === KIND_VAR || shownChip(t, i, o) !== null || (width <= OUTLINE_INLINE && indent + width <= o.width)) {
    const tokens: Token[] = []
    inline(t, i, o, tokens)
    lines.push({ indent, level, tokens, disclose: -1 })
    return
  }
  if (!o.open(i)) {
    lines.push({ indent, level, tokens: folded(t, i, o, false), disclose: i })
    return
  }
  if (k === KIND_ABS) {
    const head: Token[] = []
    const body = binders(t, i, o, head)
    lines.push({ indent, level, tokens: head, disclose: i })
    work.push({ i: body, level: level + 1 })
    return
  }
  const { head, args } = spine(t, i)
  const row: Token[] = [{ text: 'apply', kind: 'keyword', node: i }]
  const headWidth = (w[head] as number) + (parens(t, head, 'fn', o) ? 2 : 0)
  const headInline = headWidth <= OUTLINE_INLINE && indent + 'apply '.length + headWidth <= o.width
  if (headInline) {
    row.push({ text: ' ', kind: 'punct', node: i })
    wrapped(t, head, 'fn', o, row)
  }
  lines.push({ indent, level, tokens: row, disclose: i })
  for (let a = args.length - 1; a >= 0; a -= 1) work.push({ i: args[a] as number, level: level + 1 })
  if (!headInline) work.push({ i: head, level: level + 1 })
}

/** A line's text, as a reader sees it. */
export function lineText(line: Line): string {
  return line.tokens.map((x) => x.text).join('')
}

/**
 * The first line showing `node`: one with a token inside its subtree, or the fold that hides it. -1 when
 * no line shows it.
 */
export function lineOf(t: Tree, lines: readonly Line[], node: number): number {
  for (const [l, line] of lines.entries()) {
    for (const tok of line.tokens) {
      if (t.contains(node, tok.node) || (tok.kind === 'fold' && t.contains(tok.node, node))) return l
    }
  }
  return -1
}
