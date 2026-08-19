import type { TokenClass } from './types'

/**
 * A `TokenClass` as its CSS class name.
 *
 * EVERY VARIANT GETS A RULE, including the seven the source pane cannot produce.
 * `classify_source` reaches seven — Ident, Nat, Bool, Keyword, Operator, Punct and, since the trivia
 * slice, Comment — and the rest belong to the λ and asm/TM text forms that Plan 5 renders. They are
 * styled anyway because an unstyled span is invisible rather than loud, so a missing rule is a defect
 * that ships quietly. `theme.test.ts` asserts the stylesheet covers `TOKEN_CLASSES` in full.
 *
 * The counts moved when `lex` stopped discarding `//` comments: this read "only six" and "the eight
 * it cannot produce" until then. `style.css`'s own comment was corrected in the same slice and this
 * one was not — a consumer's description of a producer goes stale the moment the producer gains a
 * case, and nothing in the web tier fails when it does.
 */
export function tokenClassName(c: TokenClass): string {
  return `tok-${c.toLowerCase()}`
}
