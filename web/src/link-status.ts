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
  | {
      state: 'linked'
      tm: boolean
      lambda: LambdaLinkState
      /**
       * Whether the TM leg's running focus — the construct its CURRENT δ-step belongs to,
       * `TmState.source_node` — names this SAME pinned construct right now (`link.ts`'s
       * `isCoincident`). "The moment the app exists to show" (design §4.3), and worth a word here
       * because THE δ-TABLE HAS NO VISUAL SIGNAL FOR IT AT ALL. `.state-row.is-focus` landing on an
       * already-`.is-linked` row does not blend with it and does not combine into a third class the
       * way the source pane's `.is-focus-coincident` does: both rules set `background` at equal
       * specificity, `.is-focus` is declared second in `style.css`, and `.is-linked` sets no other
       * property — so the focus wash REPLACES the pin's outright and a pinned-and-focused row is
       * pixel-identical to a focused-only one. `TmPane.setFocus` never scrolls either, so the row can
       * be off-screen entirely. THIS LINE IS THEREFORE THE WHOLE COINCIDENCE SIGNAL ON THE TM LEG, not
       * a caption on a highlight the user can already see — which is more weight than a status line
       * usually carries, and the reason to think twice before dropping it.
       *
       * `#link-status` IS A PLAIN `<div>` THAT ANNOUNCES NOTHING TO A SCREEN READER. This is its
       * SECOND live-updating job (the pin's own answer above was its first) — both are deferred to
       * this project's accessibility pass rather than fixed here; see the roadmap's deferred-a11y list.
       */
      focus: boolean
    }

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
  // REPORTED FIRST, AHEAD OF EITHER ABSENCE BELOW — coincidence is live, present-tense news ("the run
  // just reached what you pinned"), not a reason something is missing, and it is the state this whole
  // slice exists to surface.
  if (s.focus) parts.push('the machine is here right now')
  if (!s.tm) parts.push('this construct emits no machine states')
  const lambda = LAMBDA_TEXT[s.lambda]
  if (lambda !== '') parts.push(lambda)
  return parts.join(' · ')
}
