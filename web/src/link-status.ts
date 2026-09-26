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
   * No node of the term at this step carries it (Plan 7 part 4a). At step 0 every construct the map
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
   * other member describes. Reachable since the layout tree: `closeLeaf` refuses only the last leaf in
   * the tree, so closing the one λ pane a fresh page ships is an ordinary gesture. And in Stage, whenever
   * the view it shows is not a λ view: the others are off the page, and a view off the page drew no tree
   * this frame (`draw.ts`'s `createDraw`).
   *
   * IT RENDERS AS NOTHING, and that is the same uniform-suppression rule `linkStatus` already applies
   * to a DETACHED λ pane rather than a new exception: every λ clause explains why a term on screen
   * does not show the link, and with no pane there is no term on screen for any of them to be about.
   * `'declined'` is the member that could be argued to survive — it is a property of the program's
   * lowering rather than of a pane — and it is suppressed here for the reason `linkStatus`'s own note
   * gives for suppressing it under detachment: splitting the rule would put "is there a λ pane" in two
   * places, and the sentence would still be read as an explanation of an empty pane that is not there.
   *
   * NOT SPELLED AS `detached`. A pane that does not exist is not a pane that is outside the source
   * correspondence — `DetachedPanes` is read off a BINDING, and there is no binding to read.
   */
  | 'absent'

/**
 * WHICH PANES ARE OUTSIDE THE CORRESPONDENCE — a record, not a boolean, because they detach
 * independently. Design §4.3: editing a source-derived λ view seeds a `LambdaScratch` and rebinds
 * THAT pane; the source session keeps running and the TM pane stays bound to it. So "λ detached, TM
 * still linked" is the ordinary state, not a corner, and a single flag could not name it.
 *
 * TWO REQUIRED BOOLEANS RATHER THAN A LIST OR A THREE-WAY TAG (`'lambda' | 'tm' | 'both'`). A caller
 * holds two bindings and reads one boolean off each; a tag would make every caller encode the cross
 * product, and a `Pane[]` would admit duplicates and an order that means nothing. The cost is that
 * "nothing detached" is spellable twice — this record all-false, or `LinkStatus.detached` absent —
 * and `linkStatus` collapses the two deliberately (see its own note).
 *
 * NOT A `Set` OR A MAP KEYED BY PANE ID, EITHER, and that is a 5d-i/5d-ii boundary rather than an
 * oversight: 5d-i's pane set is fixed at three slots (§1), so the panes that can detach are known at
 * compile time and a fixed record is checkable where a keyed collection is not. 5d-ii's multiplexer
 * is what makes the pane set open, and it can widen this then.
 */
export type DetachedPanes = {
  /** The λ pane is bound to a `LambdaScratch`, which has no `SourceMap` and so no `sourceSpan`/`linkIndex` (§3.3). */
  lambda: boolean
  /** The TM pane is bound to a `TmScratch`, whose every `TmState` carries `source_node: null` (§3.1). */
  tm: boolean
}

export type LinkStatus = {
  /**
   * A FIELD ON EVERY ARM, NOT A FOURTH ARM, and the choice is forced rather than stylistic.
   *
   * The `state` discriminant answers "what did the user pin, and did it resolve" — the pin is the
   * subject of all three of `none`/`stale`/`linked`. Detachment answers a different question about a
   * different object: which PANES are bound to a scratch session. Both are true at once, so an arm
   * would have to choose, and it would choose wrong in the case §4.3 makes ordinary — a detached λ
   * pane with a live TM link would report `{state:'detached'}` and throw away the narration for the
   * pane that is still inside the correspondence.
   *
   * It is also not ONE arm. A pane can be detached with nothing pinned, with a stale index, or with a
   * live link — three states this union already distinguishes — so the arm version is three arms, and
   * `linkStatus` would carry two parallel switches over the same three cases.
   *
   * NOT `'stale'` AND NOT `'none'`, which is the trap this field exists to avoid. `'stale'` promises
   * "linking resumes when this compiles", and for a detached pane a recompile does something else
   * entirely (§4.3: it TERMINATES the scratch's worker and rebinds the pane back); `'none'` says
   * nothing is pinned, which is silent, and §4.5's whole obligation is that detachment must not be.
   *
   * OPTIONAL, AND THAT IS A COMPATIBILITY REQUIREMENT RATHER THAN A CONVENIENCE. It was written while
   * the one place in the app that builds a `LinkStatus` could not fill it in — no pane had a binding to
   * report (§3.2b: `main()`'s local scope was the state, and the session registry landed separately) —
   * so absent means "both attached" and adopting this was one added property against call sites that
   * kept compiling unchanged. **THAT BUILDER IS `link-wiring.ts`'s `drawLink` NOW, AND IT DOES FILL
   * THIS IN**, on all three arms, from `detachedPanes()`; the optionality is what the other producers
   * of this type — this file's own tests among them — still spend. Under `exactOptionalPropertyTypes`
   * an optional property is added by spread, never assigned `undefined`, which is the idiom `drawLink`
   * uses for it.
   */
  detached?: DetachedPanes
} & (
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
)

const LAMBDA_TEXT: Record<LambdaLinkState, string> = {
  shown: '',
  'none-here': 'this construct has no node in the λ term at this step',
  'too-large': 'the λ term at this step is too large to lay out',
  waiting: '',
  declined: 'this program has no λ lowering, so no construct has a λ link',
  absent: '',
}

const ATTACHED: DetachedPanes = { lambda: false, tm: false }

/**
 * The detachment clause, or `''` when both panes are inside the correspondence.
 *
 * ONE CLAUSE FOR BOTH VIEWS, NOT THE SAME SENTENCE TWICE. "not linked to the program" is one fact about
 * one correspondence; emitting it either side of a `·` would read as two unrelated failures, and the
 * line is already carrying up to three other parts.
 *
 * "shows a copy" IS SAID IN THE SAME BREATH AS WHAT IT MEANS, deliberately. `copy · not linked` in the
 * view's header is the glanceable half, with the view's own title beside it to say which view. This
 * line is the authoritative narration (§4.5), and a reader who has never made a copy cannot derive
 * "not linked to the program" from the word (Plan 7 part 2 spec §12's vocabulary).
 */
function detachedText(d: DetachedPanes): string {
  if (d.lambda && d.tm) return 'λ and TM views show copies — not linked to the program'
  if (d.lambda) return 'λ view shows a copy — not linked to the program'
  if (d.tm) return 'TM view shows a copy — not linked to the program'
  return ''
}

/**
 * The `link-status` line's text. Empty means the line is blank, not that the line is absent.
 *
 * NO LONGER AN EARLY RETURN PER ARM, and the restructure is what detachment costs: a detached pane is
 * a fact about panes, independent of what is pinned, so it has to be reachable from `none` and
 * `stale` too — `{state:'none'}` with a detached λ pane is the case where this line goes from blank
 * to speaking, which is exactly §4.5's obligation.
 *
 * DETACHMENT LEADS, ahead of the coincidence that used to lead. Ordered most-global first — the rule
 * `draw.ts`'s `createDraw` follows for the λ state (no view, then a declined program, then the view's own
 * answer) — because "this pane is not part
 * of the correspondence" scopes every clause after it: those are about the panes still inside.
 *
 * A DETACHED PANE'S OWN CLAUSES ARE SUPPRESSED, NOT MERELY PRECEDED. §4.5's standard is the one that
 * deleted `node_to_lambda`: a thing that provably cannot work should not be presented as though it
 * might. A detached λ pane is showing a scratch term, so "this construct has no node in the λ term
 * at this step" describes a term that is not on screen; a detached TM pane renders
 * states whose `source_node` is `null` by construction (§3.1), so neither the coincidence nor the
 * emits-no-states absence is a claim about anything the user is looking at.
 *
 * SUPPRESSION IS UNIFORM ACROSS `LambdaLinkState` RATHER THAN TRIAGED PER MEMBER. `'declined'` is the
 * one that could be argued to survive — it is a property of the program's lowering, not of the pane —
 * but splitting the rule would put "is the λ pane detached" in two places, and the clause is still
 * being read as an explanation of an empty λ pane that is not empty for that reason.
 *
 * `s.detached` ABSENT AND ALL-FALSE ARE THE SAME OUTPUT, which is the redundancy `DetachedPanes`'
 * doc admits. Collapsed here, in the one function that reads the field, so no caller has to know
 * which encoding it holds.
 */
export function linkStatus(s: LinkStatus): string {
  const detached = s.detached ?? ATTACHED
  const parts: string[] = []
  // REFUSALS ARE NOT SAID HERE ANY MORE. This line carried a fork-failure report ahead of everything
  // else until Plan 7 part 2 (spec §11): refusals are notices now (`notice.ts`), shown under the header
  // and said in the one live region, and this line carries the link sentence only.
  const detachment = detachedText(detached)
  if (detachment !== '') parts.push(detachment)
  if (s.state === 'stale') {
    // STILL TRUE OF A DETACHED PANE, AND THE ARGUMENT FOR IT CHANGED WITH 5d-ii-c DECISION 2. It ran:
    // §4.3 says a recompile from source terminates the scratch's worker and rebinds its panes back, so
    // the sentence is a promise the detached case keeps because the compile is the same event that
    // reattaches the pane. A compile ends no buffer now, so it reattaches nothing — and the promise
    // holds for the plainer reason that linking is a fact about the SOURCE program's index: it resumes
    // when this compiles, for whichever pane is showing that session then, and a detached pane is one
    // rebind away from being one.
    parts.push('linking resumes when this compiles')
  } else if (s.state === 'linked') {
    if (!detached.tm) {
      // REPORTED FIRST OF THE PIN'S OWN PARTS, AHEAD OF EITHER ABSENCE BELOW — coincidence is live,
      // present-tense news ("the run just reached what you pinned"), not a reason something is
      // missing, and it is the state 5c exists to surface.
      if (s.focus) parts.push('the machine is here right now')
      if (!s.tm) parts.push('this construct emits no machine states')
    }
    if (!detached.lambda) {
      const lambda = LAMBDA_TEXT[s.lambda]
      if (lambda !== '') parts.push(lambda)
    }
  }
  return parts.join(' · ')
}
