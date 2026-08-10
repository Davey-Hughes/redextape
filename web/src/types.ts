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
 * IT IS NOW CHECKED AGAINST THE RUST ENUM, which it was not through 5a. `tokenClasses()` returns the
 * same names in the same declaration order, and `assertTokenClasses` below fails loudly at startup if
 * the two disagree. That matters more from Plan 5b on than it did before: `LinkIndex` ships span
 * classes as a `Uint8Array` of DISCRIMINANTS, so a reordering here mis-colours silently rather than
 * producing an unrecognised string.
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

export type Cut = 'Bytes' | 'Depth'

export type LambdaState = { text: string; spans: Classified; cut: Cut | null; step: number }

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
  /**
   * The index into `tmProgram().states[state].rules` of the rule ABOUT TO FIRE, or `null` when nothing
   * matches — at an accept state, at `halt`, or at a stuck configuration.
   *
   * NAMES WHAT HAPPENS NEXT, NOT WHAT PRODUCED THIS FRAME. See `viewmodel.rs`'s field doc.
   */
  rule: number | null
}

/**
 * Fail loudly if the hand-written `TOKEN_CLASSES` has drifted from the Rust enum.
 *
 * AT STARTUP, NOT IN A TEST ONLY. A test can be skipped, a CI job can be scoped out, and the failure
 * this guards is silent mis-colouring rather than a crash. Called once from `main.ts` after `init()`.
 */
export function assertTokenClasses(fromWasm: string[]): void {
  const ours = TOKEN_CLASSES.join(',')
  const theirs = fromWasm.join(',')
  if (ours !== theirs) {
    throw new Error(`TOKEN_CLASSES has drifted from the Rust enum:\n  ts:   ${ours}\n  rust: ${theirs}`)
  }
}
