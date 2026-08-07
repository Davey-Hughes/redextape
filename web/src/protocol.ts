import type { Decoded, Diagnostic, LambdaState, LambdaStatus, Span, TmStatus } from './types'

/// How many β-steps the worker takes between yields.
///
/// `session.rs`'s own doc picks this figure: 5,000,000 steps at 50,000 per chunk is ~100 crossings
/// instead of five million, and one macrotask per chunk is what lets a superseded run be abandoned.
export const CHUNK_STEPS = 50_000

/// The λ printer's byte budget. Truncation is shown, not hidden — see `results.ts`.
export const LAMBDA_BYTE_BUDGET = 65_536

export type RunRequest = { kind: 'run'; gen: number; src: string; encoding: string }

/// `declinedSpan` IS RESOLVED IN THE WORKER, not on the main thread, because `sourceSpan` is a
/// `Session` method and the handle never leaves that thread. `LambdaStatus.node` alone would be
/// useless to a renderer that cannot ask what source range it names.
export type LambdaLeg = {
  status: LambdaStatus
  state: LambdaState | null
  value: Decoded | null
  declinedSpan: Span | null
}
export type TmLeg = { status: TmStatus; value: Decoded | null }

export type RunReply =
  /// The program did not analyze, so there is no session at all.
  | { kind: 'no-session'; gen: number; diagnostics: Diagnostic[] }
  /// A session existed and both legs were interrogated.
  | { kind: 'result'; gen: number; lambda: LambdaLeg; tm: TmLeg }
