import type { TokenClass } from './types'

/**
 * A `TokenClass` as its CSS class name.
 *
 * EVERY VARIANT GETS A RULE, including the eight this slice's source pane cannot produce.
 * `classify_source` reaches only six — Ident, Nat, Bool, Keyword, Operator, Punct — and the rest
 * belong to the λ and asm/TM text forms that Plan 5 renders. They are styled anyway because an
 * unstyled span is invisible rather than loud, so a missing rule is a defect that ships quietly.
 * `theme.test.ts` asserts the stylesheet covers `TOKEN_CLASSES` in full.
 */
export function tokenClassName(c: TokenClass): string {
  return `tok-${c.toLowerCase()}`
}
