// The wasm boundary's wire shapes, as TypeScript.
//
// EVERY SHAPE HERE IS MEASURED, not designed: `crates/redextape-wasm/tests/browser.rs` reads each one
// out of a real browser and pins it. Two of them look wrong and are not. `total_steps` is snake_case
// because serde does not rename. A fieldless enum variant crosses as the bare variant NAME, and a
// struct variant as a one-key object — so `Decoded` is a union of two strings and two objects rather
// than a discriminated union with a `kind` field.

export type Span = { start: number; end: number }

/**
 * Every `TokenClass` variant, in the Rust enum's declaration order.
 *
 * THE ARRAY IS THE SOURCE AND THE UNION IS DERIVED FROM IT, not the other way round. Written as a
 * standalone union with a separate array beside it, the two drift the moment a variant is added — and
 * they drift into agreement with each other, which is worse than disagreeing. Deriving means a name
 * missing from this array cannot be used anywhere in the app, and the compiler says so.
 *
 * It still cannot verify itself against the RUST enum; that copy is by hand and this file's header
 * says so. `encodings()` was exported precisely because that hand-copy was avoidable for encoding
 * names. It is not avoidable here without a second export, which §6.3's scope does not carry — so the
 * residual risk is a variant added to `analysis::TokenClass` and not mirrored here, which shows up as
 * an unstyled span rather than an error. Recorded in the design spec's §12.
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

export type TokenClass = (typeof TOKEN_CLASSES)[number]

export type Classified = [Span, TokenClass][]

export type Severity = 'Error' | 'Warning'
export type Diagnostic = { span: Span; severity: Severity; message: string }

export type RunStatus = 'Running' | 'Ended' | 'Capped' | 'DepthRefused'

export type Decoded = 'Unfinished' | 'Undecodable' | { Value: { text: string } } | { Fault: { message: string } }

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

export type LambdaState = { text: string; spans: Classified; truncated: boolean; step: number }

/**
 * A decoded answer as one line of display text.
 *
 * `Undecodable` AND `Fault` ARE ANSWERS, not empty states: a normal form the decoder has no encoding
 * for is a fact about this pair of program and backend, and showing a blank field would hide it.
 */
export function decodedText(d: Decoded): string {
  if (d === 'Unfinished') return 'not finished'
  if (d === 'Undecodable') return 'no encoding for this type'
  if ('Value' in d) return d.Value.text
  return `fault: ${d.Fault.message}`
}

/**
 * A head move, as `viewmodel::move_text` prints it.
 *
 * A STRING UNION RATHER THAN AN ENUM, because `RuleView.moves` is `Vec<String>` on the Rust side —
 * the projection stringifies `Move` during `TmProgram::of`. `viewmodel::move_text` is the only
 * producer, and its three arms are exactly this union, so `L` | `R` | `S` is exhaustive.
 */
export type Move = 'L' | 'R' | 'S'

/**
 * One transition. `read`/`write` carry one entry PER TAPE, and `null` is a wildcard — `RuleSpec`
 * defaults every untouched tape to (wildcard read, unchanged write, Stay), which is what lets a
 * gadget name only the tapes it touches.
 */
export type RuleView = { read: (string | null)[]; write: (string | null)[]; moves: Move[]; next: number }

export type StateView = { name: string; accept: boolean; rules: RuleView[] }

/**
 * The machine, projected ONCE per compile and never per step. `TmProgram::of`'s doc records why:
 * the `map` demo is 3,203 states over 344,999 steps, and re-projecting per frame is the cost this
 * split exists to avoid.
 */
export type TmProgram = { states: StateView[]; alphabet: string[]; tapes: number; width: number; start: number }

/**
 * One configuration, windowed. `heads` AND `window_start` ARE BOTH MATERIALIZED-TAPE COORDINATES,
 * not window-relative ones: the head's position inside `window[i]` is `heads[i] - window_start[i]`,
 * which is `tape.ts`'s whole job and is node-tested there.
 *
 * `source_node` is honestly `null` for machine scaffolding, `defunc`-minted constructs, and any state
 * this lowering did not produce. It has no consumer until 5b.
 */
export type TmState = {
  state: number
  step: number
  heads: number[]
  window_start: number[]
  window: string[][]
  source_node: number | null
}
