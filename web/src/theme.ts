import type { TokenClass } from './types'

/**
 * A `TokenClass` as its CSS class name.
 *
 * EVERY VARIANT GETS A RULE. An unstyled span is invisible rather than loud, so a missing rule is a defect
 * that ships quietly; `theme.test.ts` asserts the stylesheet covers `TOKEN_CLASSES` in full.
 *
 * The classes arrive from `capture_map.rs`, through `captureClasses()` and `colour.ts`'s `classMapFrom`, and
 * the four committed grammars between them reach every variant — `Mnemonic` and `Register` from asm, `Label`,
 * `StateName`, `TapeSymbol` and `Move` from TM, `Binder` from λ.
 *
 * That paragraph describes the producer, and goes stale the moment the producer changes with nothing in the
 * web tier failing, which is why the rule above does not rest on it: every variant gets a rule whether or not
 * a grammar reaches it.
 */
export function tokenClassName(c: TokenClass): string {
  return `tok-${c.toLowerCase()}`
}
