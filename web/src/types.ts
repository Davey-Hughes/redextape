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
// THE MIGRATION IS PARTIAL AND THIS COMMENT TRACKS IT. `Span` is generated; every other type below is
// still declared by hand and still agrees with its Rust counterpart only by someone remembering to.
// Two more PRs move the remaining seventeen.

import type { Span } from '../bindings/Span'

export type { Span }

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

export type Cut = 'Bytes' | 'Depth'

/**
 * Which source construct a β-step belongs to.
 *
 * Three states rather than two, and the renderer must keep them apart: `Exact` says this step IS that
 * construct, `Within` says only that it happened somewhere inside it. Collapsing them would re-adopt
 * the shape 5b refused on the TM leg, where "nearest enclosing linkable node" frequently means
 * "highlight the entire program".
 *
 * `'None'` is common and correct — most of a λ term is Church/Scott encoding, which belongs to no
 * source construct at all.
 */
export type Owner = 'None' | { Exact: number } | { Within: number }

export type LambdaState = {
  text: string
  spans: Classified
  cut: Cut | null
  step: number
  /**
   * The byte span IN `text`, ABOVE — i.e. in THIS frame's own text — of the redex this frame's own step
   * contracted. `null` when there is no redex (step 0) or its subterm fell past the truncation cut (see
   * `Cut`) — never a span clamped to where the print stopped.
   *
   * THE PATH BEHIND IT IS NOT ON THE WIRE. `LambdaState.redex` exists on the Rust type and is
   * `serde(skip)`ped there (see its own doc): the span is resolved on the Rust side, by the same walk
   * that prints `text`, and only the span crosses. A structural consumer — the planned `TermTree` view,
   * which has no text to index into — is what would bring the path across; a renderer of `text` does not
   * need it.
   *
   * RESOLVED AGAINST THE TERM THIS FRAME HOLDS, which is what makes it trustworthy where 5b's deleted
   * `node_to_lambda`-derived `source_node` was not: that field's span was fixed once, against the
   * INITIAL term, and went stale the moment reduction contracted a root redex. `redex_span` is computed
   * fresh every frame, from the redex path walked against `text`'s own print, so it never outlives the
   * frame it was computed for.
   *
   * NAMED FOR THE REDEX, BUT WHAT IT COVERS IS THE CONTRACTUM. The path behind it named the redex `App`
   * as it stood in the PRE-step term; β consumed that `App` and its `Abs`, so the subterm standing at
   * that path in THIS frame's term — the text this span covers — is the contractum the step PRODUCED.
   * A renderer painting it is showing "what just changed", not "what is about to be contracted".
   *
   * BYTES, LIKE EVERY OTHER SPAN ON THIS TYPE — convert through `spans.ts`'s `byteToIndex`/`byteIndexAt`
   * before indexing into a JS string. `lambda-pane.ts`'s frame view is the one place this crosses into a
   * DOM range; see its `#redraw` for where that conversion happens.
   */
  redex_span: Span | null
  owner: Owner
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
