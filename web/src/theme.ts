import type { TokenClass } from './types'

/**
 * A `TokenClass` as its CSS class name.
 *
 * EVERY VARIANT GETS A RULE. An unstyled span is invisible rather than loud, so a missing rule is a defect
 * that ships quietly; `theme.test.ts` asserts the stylesheet covers `TOKEN_CLASSES` in full.
 *
 * The source editor's classes arrive from `capture_map.rs`, through `captureClasses()` and `colour.ts`'s
 * `classMapFrom`, the λ view's from its printer's spans and `lambda-body.ts`. Neither gives `Mnemonic`, `Register`,
 * `Label`, `StateName`, `TapeSymbol` or `Move`: only the TM and rxm grammars do, and the app loads neither.
 *
 * That paragraph describes the producer, and goes stale the moment the producer changes with nothing in the
 * web tier failing, which is why the rule above does not rest on it: every variant gets a rule whether or not
 * a grammar reaches it.
 */
export function tokenClassName(c: TokenClass): string {
  return `tok-${c.toLowerCase()}`
}
