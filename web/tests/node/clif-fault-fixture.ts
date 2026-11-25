import type { ClifListing } from '../../src/types'

/**
 * Two programs whose `cons` or box runs after a fault: a callee that faults returns to its caller, which conses or
 * boxes the 0 it got before its next guard leaves. Each names the runtime import that makes that word by its place in
 * `RtFn`'s order, which a listing spells `u0:N`: cons is 0 and box 4.
 *
 * Each has a control, the same program with a callee that does not fault, and the text the values panel reads for the
 * list or box its call then makes. At a fault's end nearly every value in `$main` reads `0`, so the fault case's `0`
 * cannot tell the call's value from its neighbours; the control's text can, so it is what shows that `madeBy` and the
 * import's place find the call's own value.
 */
export const FAULT_CASES = [
  ['a cons', 'fn f(x) { head(nil) } cons(f(0), nil)', 0, 'fn f(x) { x } cons(f(0), nil)', '#1'],
  [
    'a box',
    'fn f(x) { head(nil) } let mut v = f(0); let get = |x| v; get(0)',
    4,
    'fn f(x) { x } let mut v = f(0); let get = |x| v; get(0)',
    'box #1',
  ],
] as const

/**
 * The number of the value `$main`'s one call to runtime import `u0:${index}` sets in `listing`, read from the rows as
 * Cranelift prints them: the declaration that names the callee, `fn0 = u0:0 sig0`, and the call, `v15 = call fn0(…)`.
 * Throws unless `$main` makes that call once.
 */
export function madeBy(listing: ClifListing, index: number): number {
  const at = listing.functions.findIndex((f) => f.label === '$main')
  const rows = listing.rows.slice(listing.functions[at]?.first_row ?? 0, listing.functions[at + 1]?.first_row)
  const texts = rows.map((r) => r.text)
  const callee = texts.map((t) => new RegExp(`^fn(\\d+) = u0:${index} `).exec(t)?.[1]).find((n) => n !== undefined)
  const made = texts.flatMap((t) => new RegExp(`^v(\\d+) = call fn${callee}\\(`).exec(t)?.[1] ?? [])
  if (at < 0 || callee === undefined || made.length !== 1) {
    throw new Error(`$main calls u0:${index} ${made.length} times`)
  }
  return Number(made[0])
}
