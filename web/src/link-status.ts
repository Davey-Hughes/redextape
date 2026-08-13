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
 * `'absent'` IS OUTSIDE THAT COUNT AND IS DELIBERATELY THE ONE THAT SAYS NOTHING. The four above are
 * reasons a λ pane on screen shows no link; `'absent'` is the layout tree's own addition and means
 * there is no λ pane on screen to say anything about. Its own doc has the argument.
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
  /**
   * THERE IS NO λ PANE ON SCREEN AT ALL — not an absence of a link, an absence of the surface every
   * other member describes. Reachable since the layout tree: `closeLeaf` refuses only the last leaf in
   * the tree, so closing the one λ pane a fresh page ships is an ordinary gesture.
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
   * OPTIONAL, AND THAT IS A COMPATIBILITY REQUIREMENT RATHER THAN A CONVENIENCE. `main.ts:307-322` is
   * the only place in the app that builds a `LinkStatus`, and it cannot fill this in yet — no pane has
   * a binding to report (§3.2b: `main()`'s local scope is the state, and the session registry lands
   * separately). Absent therefore means "both attached", so today's call sites keep compiling
   * unchanged and adopting this is one added property. Under `exactOptionalPropertyTypes` that
   * property is added by spread, never assigned `undefined` — `main.ts:426-443`'s idiom.
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
) & {
    /**
     * A fork that just failed and put the pane back on the source session, or absent — CRITICAL
     * finding, plan 5d-iii's ninth task, and `#link-status`'s THIRD live-updating job.
     *
     * WHY THIS LINE AND NOT THE PANE'S OWN EDITOR. `onScratchReply`'s `no-session` arm can be answering
     * a `detach` whose build never succeeded even once — `LambdaScratchpad.noSessionReply` retires that
     * phantom scratchpad synchronously, which is what makes the pane's fork control reappear at all
     * (design §4.1a). Retiring is also what makes `LambdaPane.setDiagnostics` unusable for the answer:
     * `scratch-compiled` never fired for a build that never succeeded, so no editor was ever mounted,
     * and `setDiagnostics` (`this.#editor?.setDiagnostics(ds)`) is a silent no-op against `#editor ===
     * null`. This field is the surface that survives the rebind the retirement just performed — the
     * same argument `detached` above makes for why detachment belongs on this line and not only on the
     * pane's own badge, one step further: there is no pane-local surface left to put it on at all.
     *
     * A TOP-LEVEL FIELD, LIKE `detached`, NOT A FOURTH `state` ARM — same reasoning as `LinkStatus`'s
     * own doc gives for `detached`: this answers a different question (what did a recent FORK ATTEMPT
     * do) from the one `state` answers (what is currently pinned), and the two are independent — a
     * fork can fail with nothing pinned, with a stale index, or with a live link, so folding it into
     * `state` would be the three-way duplication that field's doc already refuses once.
     *
     * LEADS, AHEAD OF `detached` — the one exception to "most-global first" `linkStatus`'s own doc
     * states for `detached`'s position, and deliberately so. By the time this renders, `detached.lambda`
     * already reads `false` (the retirement that produced this value ran before `draw()`), so there is
     * no scoping conflict to get backwards; what earns this the front of the line is that it is the
     * most RECENT thing that happened, not the most global fact currently true.
     *
     * CLEARED BY THE CALLER, NOT BY THIS FUNCTION — `linkStatus` is a pure read of whatever `main.ts`
     * passes in on the current tick, same as every other field here; deciding how long a stale fork
     * failure stays on screen is `main.ts`'s own lifecycle question (a new fork attempt or a source
     * keystroke retires the message), and answering it here would make this function stateful, which
     * the whole rest of the file goes out of its way not to be.
     */
    forkFailed?: string
  }

const LAMBDA_TEXT: Record<LambdaLinkState, string> = {
  shown: '',
  truncated: 'the λ term is truncated before this construct',
  unmapped: 'this construct has no recorded position in the λ term',
  'not-step-0': 'the λ link is only defined at step 0 — restart the λ pane to see it',
  declined: 'this program has no λ lowering, so no construct has a λ link',
  absent: '',
}

const ATTACHED: DetachedPanes = { lambda: false, tm: false }

/**
 * The detachment clause, or `''` when both panes are inside the correspondence.
 *
 * ONE CLAUSE FOR BOTH PANES, NOT THE SAME SENTENCE TWICE. "not linked to source" is one fact about
 * one correspondence; emitting it either side of a `·` would read as two unrelated failures, and the
 * line is already carrying up to three other parts.
 *
 * "detached" IS SAID IN THE SAME BREATH AS WHAT IT MEANS, deliberately. `[detached]` alone is the
 * badge's job — glanceable, in the pane, with the pane's own title beside it to say which pane. This
 * line is the authoritative narration (§4.5), and a reader who has never seen a scratch session
 * cannot derive "not linked to source" from the word.
 */
function detachedText(d: DetachedPanes): string {
  if (d.lambda && d.tm) return 'λ and TM panes detached — not linked to source'
  if (d.lambda) return 'λ pane detached — not linked to source'
  if (d.tm) return 'TM pane detached — not linked to source'
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
 * `main.ts`'s `lambdaLinkState` states for its own three-way choice — because "this pane is not part
 * of the correspondence" scopes every clause after it: those are about the panes still inside.
 *
 * A DETACHED PANE'S OWN CLAUSES ARE SUPPRESSED, NOT MERELY PRECEDED. §4.5's standard is the one that
 * deleted `node_to_lambda`: a thing that provably cannot work should not be presented as though it
 * might. A detached λ pane is showing a scratch term, so "the λ term is truncated before this
 * construct" describes a truncation in a term that is not on screen; a detached TM pane renders
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
  // FIRST — see `forkFailed`'s own doc for why this is the one field that leads ahead of detachment
  // rather than after it.
  if (s.forkFailed !== undefined) parts.push(`fork failed — ${s.forkFailed}`)
  const detachment = detachedText(detached)
  if (detachment !== '') parts.push(detachment)
  if (s.state === 'stale') {
    // STILL TRUE OF A DETACHED PANE, and not by accident: §4.3 says a recompile from source terminates
    // the scratch's worker and rebinds its panes back, so "linking resumes when this compiles" is a
    // promise the detached case keeps too — it is the same event that reattaches the pane.
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
