// The wasm boundary's wire shapes, as TypeScript.
//
// EVERY SHAPE HERE IS MEASURED, not designed: `crates/redextape-wasm/tests/browser.rs` reads each one
// out of a real browser and pins it. Two of them look wrong and are not. `total_steps` is snake_case
// because serde does not rename. A fieldless enum variant crosses as the bare variant NAME, and a
// struct variant as a one-key object — so `Decoded` is a union of two strings and two objects rather
// than a discriminated union with a `kind` field.
//
// TYPES RE-EXPORTED FROM `../bindings/` ARE GENERATED FROM THE RUST DECLARATION and are not edited
// here — `pnpm run build:bindings` writes them. The directory is gitignored, so there is no
// committed copy to go stale.
//
// THE MIGRATION IS PARTIAL AND THIS COMMENT TRACKS IT. Every type re-exported from `../bindings/`
// above is generated from its Rust declaration. The types still DECLARED below are the ones
// `redextape-wasm` owns; they agree with their Rust counterparts only by someone remembering to,
// and PR 3 is what moves them. `Classified` is not waiting for a PR — it is a structural alias over
// two generated types, with no Rust declaration to derive from, and stays here permanently.

import type { Owner } from '../bindings/Owner'
import type { Span } from '../bindings/Span'
import type { TokenClass } from '../bindings/TokenClass'

export type { Cut } from '../bindings/Cut'
export type { Diagnostic } from '../bindings/Diagnostic'
export type { LambdaState } from '../bindings/LambdaState'
export type { Move } from '../bindings/Move'
export type { RuleView } from '../bindings/RuleView'
export type { Severity } from '../bindings/Severity'
export type { StateView } from '../bindings/StateView'
export type { TmProgram } from '../bindings/TmProgram'
export type { TmState } from '../bindings/TmState'
export type { Owner, Span, TokenClass }

/**
 * Every `TokenClass` variant, in the Rust enum's declaration order.
 *
 * THE UNION NO LONGER DERIVES FROM THIS ARRAY. Before generation, `TokenClass` was
 * `(typeof TOKEN_CLASSES)[number]`, so a name missing from the array could not be used anywhere in the
 * app — the array was the source. `TokenClass` is now generated from the Rust enum
 * (`../bindings/TokenClass`), and this array is an independent runtime value: a generated *type*
 * cannot supply an array, and this one is read in `link.ts`'s `lambdaSpans` getter to turn a
 * `Uint8Array` discriminant into a class name. Written as a standalone array with a separately-sourced union
 * beside it, the two drift the moment a variant is added on the Rust side and not here — which is
 * exactly the shape the pin below exists to close, now that neither derives from the other.
 *
 * THE PIN BELOW FIRES AT `pnpm typecheck` AND AT CI'S `web` JOB, in both directions: a name this array
 * is missing, and a name this array has that the union does not. See the pin's own comment for the
 * error each direction produces. IT DOES NOT RELIABLY FIRE AT THE PRE-COMMIT HOOK: `web-typecheck` is
 * scoped `files: ^web/.*\.(ts|tsx)$`, so a commit that adds a variant on the Rust side and touches no
 * `.ts`/`.tsx` file — the exact drift this pin exists to catch — never runs that hook locally; CI's
 * `web` job still catches it once the commit is pushed.
 *
 * THE PIN IS EARLIER THAN `assertTokenClasses` BELOW, NOT STRONGER, AND NEITHER SUBSUMES THE OTHER.
 * The pin compares this array against `../bindings/TokenClass.ts`, a FILE ON DISK — a tree where
 * `build:bindings` has not been re-run since a Rust edit satisfies the pin while still being wrong.
 * `assertTokenClasses` compares this array against the LOADED WASM MODULE at startup, via
 * `tokenClasses()`, and is the only one of the two that can see that class of staleness. THE PIN IS
 * ALSO SET-BASED AND BLIND TO ORDER: `Missing`/`Extra` below are `Exclude<...>` over the two SETS of
 * names, so swapping two entries in this array still typechecks — see `assertTokenClasses`'s own
 * comment for the check that does see a reorder, and why that matters more from Plan 5b on. Keep both;
 * each catches a disagreement the other cannot.
 */
export const TOKEN_CLASSES = [
  'Ident',
  'Nat',
  'Bool',
  'Keyword',
  'Operator',
  'Punct',
  'Comment',
  'Binder',
  'Mnemonic',
  'Register',
  'Label',
  'StateName',
  'TapeSymbol',
  'Move',
] as const

// Pins `TOKEN_CLASSES` to the generated `TokenClass` union in both directions (see the doc comment
// above `TOKEN_CLASSES`). `Missing` is non-empty when the array lacks a name the union has; `Extra` is
// non-empty when the array has a name the union does not. `Assert` only accepts `never`, so either
// one being non-empty fails `pnpm typecheck` and names the offending member in the error.
type Missing = Exclude<TokenClass, (typeof TOKEN_CLASSES)[number]>
type Extra = Exclude<(typeof TOKEN_CLASSES)[number], TokenClass>
type Assert<T extends never> = T
type _NoneMissing = Assert<Missing>
type _NoneExtra = Assert<Extra>

export type Classified = [Span, TokenClass][]

export type RunStatus = 'Running' | 'Ended' | 'Capped' | 'DepthRefused'

export type Decoded =
  | 'Unfinished'
  | 'Undecodable'
  | 'TooLargeToPrint'
  | { Value: { text: string } }
  | { Fault: { message: string } }

export type LambdaStatus = {
  available: boolean
  reason: string
  node: number | null
  run: RunStatus | null
}

export type TmStatus = {
  available: boolean
  reason: string
  width: number | null
  run: RunStatus | null
  total_steps: number | null
}

/**
 * A `TmScratch`'s status — **five fields, and the missing one is the point**.
 *
 * NO `total_steps`. `Session.tmStatus` reports one from the run `compile` performed; a scratch is
 * stepped rather than described-run, so any value here would be invented. The Rust side pins this by
 * an exhaustive destructuring, so a sixth field fails to compile there with `E0027` — this type is the
 * wire's copy of that shape and must be edited in step with it.
 *
 * `header` IS THE FIELD `TmStatus` HAS NO COUNTERPART FOR. `false` means the text carried no header,
 * so the machine runs from blank tapes at `MIN_FIELD_WIDTH` — explicitly not an error, and a fact the
 * pane must surface rather than let the user assume they are watching the machine they pasted.
 *
 * `width` AND `run` ARE NOT `| null`, WHICH IS THE SAME ARGUMENT AS `TmStatus`'S NULLABILITY IN THE
 * OTHER DIRECTION. `TmStatus`'s pair is nullable because a `Session` can decline the TM leg entirely —
 * `available: false` with nothing behind it. A `TmScratch` has no such leg to decline: it is built from
 * text that already parsed to a machine (`TmScratchStatus` in `crates/redextape-wasm/src/session.rs`,
 * and its own doc there), so `width` and `run` are always answerable and an `Option` around either
 * would be a state no worker can produce. See that Rust struct for the argument in full.
 */
export type TmScratchStatus = {
  available: boolean
  reason: string
  width: number
  run: RunStatus
  header: boolean
}

/** The `NodeId` under either claim, or `null`. A consumer that renders the two claims differently must match on the variant instead of calling this. */
export function ownerNode(o: Owner): number | null {
  if (o === 'None') return null
  return 'Exact' in o ? o.Exact : o.Within
}

/**
 * A decoded answer as one line of display text.
 *
 * `Undecodable` AND `Fault` ARE ANSWERS, not empty states: a normal form the decoder has no encoding
 * for is a fact about this pair of program and backend, and showing a blank field would hide it.
 *
 * `TooLargeToPrint` IS A THIRD ANSWER, AND IT IS NOT `Undecodable`. The decode SUCCEEDED; what failed
 * is rendering it. A decoded value is an `Rc` DAG whose PRINTED size is its LOGICAL size, so an
 * ordinary `tails`-shaped result is small in memory and astronomically large as text — the Rust side
 * refuses past `MAX_PRINT_NODES` rather than walking it. Saying "no encoding for this type" here
 * would blame the program for a limit of the printer.
 *
 * **THE ORDER OF THE STRING CHECKS IS LOAD-BEARING.** Every bare-string variant must be tested before
 * the `'Value' in d` line: `in` throws a `TypeError` on a string primitive, so an unhandled string
 * variant crashes this function rather than falling through to the `Fault` arm. That is not
 * hypothetical — `TooLargeToPrint` was added on the Rust side first, and until this union learned
 * about it, reaching that state would have thrown here.
 */
export function decodedText(d: Decoded): string {
  if (d === 'Unfinished') return 'not finished'
  if (d === 'Undecodable') return 'no encoding for this type'
  if (d === 'TooLargeToPrint') return 'value too large to print'
  if ('Value' in d) return d.Value.text
  return `fault: ${d.Fault.message}`
}

/**
 * Fail loudly if the hand-written `TOKEN_CLASSES` has drifted from the Rust enum.
 *
 * AT STARTUP, NOT IN A TEST ONLY. A test can be skipped, a CI job can be scoped out, and the failure
 * this guards is silent mis-colouring rather than a crash. Called once from `main.ts` after `init()`.
 *
 * THIS IS THE CHECK THAT CATCHES A REORDER, NOT THE PIN ABOVE. It joins both arrays into strings and
 * compares them (`ours !== theirs`, below), so it is sensitive to ORDER — unlike the compile-time pin
 * above `TOKEN_CLASSES`, which is set-based (`Exclude<...>`) and typechecks clean if two names swap
 * places. That matters more from Plan 5b on than it did before: `LinkIndex` ships span classes as a
 * `Uint8Array` of DISCRIMINANTS, so a reordering here mis-colours silently rather than producing an
 * unrecognised string, and this runtime check is what stands between that and shipping.
 */
export function assertTokenClasses(fromWasm: string[]): void {
  const ours = TOKEN_CLASSES.join(',')
  const theirs = fromWasm.join(',')
  if (ours !== theirs) {
    throw new Error(`TOKEN_CLASSES has drifted from the Rust enum:\n  ts:   ${ours}\n  rust: ${theirs}`)
  }
}
