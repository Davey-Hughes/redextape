/**
 * Why a pane is not showing a link, in words.
 *
 * SIX ABSENCES, AND THEY ARE WORDED DIFFERENTLY ON PURPOSE. Four of them mean "the λ pane shows no
 * link" and collapsing them into one message would tell a user nothing about whether to scrub, to
 * shrink the program, or to stop using a mutable capture. The TM absence is the common case, not an
 * edge to shrug off: measured across the demo corpus, 50–82% of clickable constructs carry a TM
 * block, so a substantial remainder — the transparent `let`/`seq` binders, the `Lambda`s, and the
 * statically-resolved callee `Var`s that `sourcemap.rs`'s module doc names — do not, and reporting
 * that absence has to be built as a first-class path rather than an edge case.
 */
export type LambdaLinkState =
  /** Shown: the play head is at step 0, the term reaches this construct, and the backend lowered it. */
  | 'shown'
  /** The λ text stopped before reaching this construct — either the byte budget or the depth cap fired first. */
  | 'truncated'
  /**
   * The construct has no recorded λ position at all — DIFFERENT FROM `'truncated'`, which is a
   * definite frontier (a byte or depth cut the walk actually hit) this is not. `LinkIndex.lambdaCut`
   * is what tells the two apart; before this variant existed, an absent span was ASSUMED to mean
   * truncation regardless of that flag, which reported a frontier that was not there whenever the
   * true cause was something else (e.g. `LinkIndex.lambda_nodes` dropped the containing subterm for a
   * reason other than the cut).
   */
  | 'unmapped'
  /** The λ leg's play head has moved off step 0, where the path coordinates stop meaning anything. */
  | 'not-step-0'
  /** The λ backend declined this PROGRAM, so no construct has a λ link. */
  | 'declined'

export type LinkStatus =
  | { state: 'none' }
  | { state: 'stale' }
  | { state: 'linked'; tm: boolean; lambda: LambdaLinkState }

const LAMBDA_TEXT: Record<LambdaLinkState, string> = {
  shown: '',
  truncated: 'the λ term is truncated before this construct',
  unmapped: 'this construct has no recorded position in the λ term',
  'not-step-0': 'the λ link is only defined at step 0 — restart the λ pane to see it',
  declined: 'this program has no λ lowering, so no construct has a λ link',
}

/** The `link-status` line's text. Empty means the line is blank, not that the line is absent. */
export function linkStatus(s: LinkStatus): string {
  if (s.state === 'none') return ''
  if (s.state === 'stale') return 'linking resumes when this compiles'
  const parts: string[] = []
  if (!s.tm) parts.push('this construct emits no machine states')
  const lambda = LAMBDA_TEXT[s.lambda]
  if (lambda !== '') parts.push(lambda)
  return parts.join(' · ')
}
