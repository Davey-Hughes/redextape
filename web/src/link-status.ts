import { LINKED, LINKED_LEGS, type LinkedLeg } from './linked-legs'

/**
 * Why a pane is not showing a link, in words.
 *
 * SIX ABSENCES, AND THEY ARE WORDED DIFFERENTLY ON PURPOSE. Four of them mean "the λ pane shows no
 * link" and collapsing them into one message would tell a user nothing about whether to scrub, to
 * shrink the program, or to stop using a mutable capture. The TM absence is the common case, not an
 * edge to shrug off: across the demo corpus, 50–82% of clickable constructs carry a TM block, so
 * a substantial remainder — the transparent `let`/`seq` binders, the `Lambda`s, and the
 * statically-resolved callee `Var`s that `sourcemap.rs`'s module doc names — do not, and reporting
 * that absence has to be built as a first-class path rather than an edge case.
 *
 * `'absent'` IS OUTSIDE THAT COUNT, AND IT SAYS NOTHING DELIBERATELY. The four above are reasons a λ
 * pane on screen shows no link; `'absent'` is the layout tree's own addition and means there is no λ
 * pane on screen to say anything about. Its own doc has the argument.
 *
 * THREE MEMBERS SAY NOTHING, EACH FOR ITS OWN REASON: `'shown'` has no absence to explain, `'waiting'`
 * is a moment rather than a state, and `'absent'` has no pane to explain one about. `LAMBDA_TEXT` below
 * is where each member's words are.
 */
export type LambdaLinkState =
  /** Shown: a node of the term on screen carries this construct. */
  | 'shown'
  /**
   * No node of the term at this step carries it (Plan 7 part 4 spec §5.4). At step 0 every construct the map
   * places has a node; a later step keeps only the ones an `App` still carries as its owner, since
   * reduction rewrites the rest away.
   */
  | 'none-here'
  /** The term at this step is past the tree's node budget, so the view shows its flat text and marks nothing. */
  | 'too-large'
  /**
   * This step's tree has not come back yet, whether the view shows no tree meanwhile or another step's —
   * a moment, not a state to explain.
   */
  | 'waiting'
  /** The λ backend declined this PROGRAM, so no construct has a λ link. */
  | 'declined'
  /**
   * THERE IS NO λ PANE ON SCREEN AT ALL — not an absence of a link, an absence of the surface every
   * other member describes. `closeLeaf` refuses only the last leaf in the tree, so closing a page's one
   * λ pane is an ordinary gesture, and a fresh page opens with none (`layout.ts`'s `defaultLayout`). And
   * in Stage, whenever the view it shows is not a λ view: the others are off the page, and a view off
   * the page drew no tree this frame (`draw.ts`'s `createDraw`).
   *
   * IT RENDERS AS NOTHING: every λ clause explains why a term on screen does not show the link, and with no pane
   * there is no term on screen for any of them to be about. `'declined'` is the member that could be argued to
   * survive — it is a property of the program's lowering rather than of a pane — and `draw.ts` answers `'absent'`
   * before it asks about the lowering, so the line never reads as an explanation of an empty pane that is not there.
   */
  | 'absent'

export type LinkStatus =
  | { state: 'none' }
  | { state: 'stale' }
  /**
   * An rxm instruction with no owner was clicked (Plan 7 part 5 spec §6.6, amendment 11): one `defunc` minted, which
   * no construct of the program wrote. Nothing is pinned, and unlike `none` the line says why — the click did
   * something, and a line left blank would read as a click that missed. A TM state with no owner still clears the pin
   * silently, which amendment 11 keeps.
   */
  | { state: 'ownerless' }
  | {
      state: 'linked'
      lambda: LambdaLinkState
      /**
       * Each linked leg's two answers about the pinned construct: `emits`, whether the leg's rows of its `Link` are not
       * empty, and `here`, whether the leg's running focus is on it. `LINKED`'s entries say why `here` is worth a word.
       */
      legs: Readonly<Record<LinkedLeg, { emits: boolean; here: boolean }>>
    }

const LAMBDA_TEXT: Record<LambdaLinkState, string> = {
  shown: '',
  'none-here': 'this construct has no node in the λ term at this step',
  'too-large': 'the λ term at this step is too large to lay out',
  waiting: '',
  declined: 'this program has no λ lowering, so no construct has a λ link',
  absent: '',
}

/**
 * The `link-status` line's text. Empty means the line is blank, not that the line is absent.
 */
export function linkStatus(s: LinkStatus): string {
  // REFUSALS ARE NOT SAID HERE (Plan 7 part 2 spec §11): they are notices (`notice.ts`), shown and said in
  // the one live region, and this line carries the link sentence only.
  if (s.state === 'none') return ''
  if (s.state === 'stale') return 'linking resumes when this compiles'
  if (s.state === 'ownerless') return 'this instruction has no source construct'
  const parts: string[] = []
  // REPORTED FIRST, AHEAD OF ANY ABSENCE BELOW — coincidence is live, present-tense news ("the run just reached what
  // you pinned"), not a reason something is missing, and it is the state 5c exists to surface.
  for (const leg of LINKED_LEGS) {
    if (s.legs[leg].here) parts.push(LINKED[leg].here)
  }
  // ONE ABSENCE CLAUSE FOR THE TWO LOWERINGS, NOT TWO SIDE BY SIDE. A construct the rxm lowering bills nothing to —
  // a transparent `let`, a `Lambda` — bills nothing to the machine built from it either, so two clauses would say
  // one fact twice on the constructs that are most often clicked.
  // A LEG WHOSE `emits` IS `null` IS NAMED IN NO ABSENCE CLAUSE: `LINKED`'s CLIF entry says why.
  const nouns = LINKED_LEGS.flatMap((leg) => {
    const noun = LINKED[leg].emits
    return noun !== null && !s.legs[leg].emits ? [noun] : []
  })
  if (nouns.length > 0) parts.push(`this construct emits no ${nouns.join(' or ')}`)
  const lambda = LAMBDA_TEXT[s.lambda]
  if (lambda !== '') parts.push(lambda)
  return parts.join(' · ')
}
