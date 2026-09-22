import type { TokenClass } from './types'

/**
 * A `TokenClass` as its CSS class name.
 *
 * EVERY VARIANT GETS A RULE, and none of them is unreachable any more. An unstyled span is invisible
 * rather than loud, so a missing rule is a defect that ships quietly; `theme.test.ts` asserts the
 * stylesheet covers `TOKEN_CLASSES` in full.
 *
 * **THIS DOC USED TO SPLIT THE VARIANTS INTO WHAT `classify_source` COULD PRODUCE AND WHAT IT COULD
 * NOT, AND THAT PRODUCER NO LONGER FEEDS THIS FUNCTION.** It counted seven reachable — Ident, Nat,
 * Bool, Keyword, Operator, Punct and, since the trivia slice, Comment — against the rest, which
 * belonged to text forms nothing on screen parsed. Plan 7 part 3b deleted the `classifySource` export
 * with the decoration path it fed: the classes arrive from `capture_map.rs` now, through
 * `captureClasses()` and `colour.ts`'s `classMapFrom`, and the four committed grammars between them
 * reach every variant — `Mnemonic` and `Register` from asm, `Label`, `StateName`, `TapeSymbol` and
 * `Move` from TM, `Binder` from λ.
 *
 * The old counts had already moved once, when `lex` stopped discarding `//` comments: this read "only
 * six" and "the eight it cannot produce" until then, and `style.css`'s comment was corrected in that
 * slice while this one was not. A consumer's description of its producer goes stale the moment the
 * producer changes, and nothing in the web tier fails when it does — which is why the sentence above
 * no longer names one.
 */
export function tokenClassName(c: TokenClass): string {
  return `tok-${c.toLowerCase()}`
}
