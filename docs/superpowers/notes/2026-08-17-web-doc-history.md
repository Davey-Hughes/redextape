# web doc history

Retracted claims and measurement transcripts moved out of `web/src/` by the
`web-doc-history` slice, so the call site keeps the live argument and this note
keeps the record. Nothing here was deleted from the tree; it was moved.

**Organised file → symbol.** A code site that lost material carries a pointer
naming its symbol; find that symbol below.

**Why not the roadmap:** the roadmap's entries answer *"what did slice N do"*.
This answers *"why does this symbol say what it says"* — a different question,
asked by someone looking at code who does not know which slice touched it.

**What counts as a repair.** Moving a paragraph out sometimes leaves a dangling
reference in the prose that stays behind — a pronoun whose antecedent went, a
tense word ("now", "used to", "still") whose referent went, a count that named
the list that just left. Entries below that lost material this way say so
categorically rather than listing which words moved: an earlier pass enumerated
every repair instead, and its count came out wrong four times over — 10 → 11 →
14 → 17 — each round confident it was complete, because a sweep finds one
repair per paragraph and misses a second one sitting beside it. The blockquote
in each entry is the pre-move original, elided only where the elided text
stayed at the call site, which is what a reader wanting a specific repair would
have to diff against regardless of whether the enumeration existed.

---

## How to read this note

**Why this moved and that stayed** — the classification rule is §4.1 of
`docs/superpowers/specs/2026-08-17-web-doc-history-design.md`. Live argument
stays; a claim about what the doc, the code or the design USED TO say or do
moves; raw evidence — run figures, byte counts, per-round readings — moves and
the conclusion drawn from it stays. A paragraph that resists the test stays
where it is, deliberately: the rule is biased so that ambiguity resolves toward
*stay*. A reader wondering why a particular sentence is in this file rather
than at its call site should start there.

**Where slice ids resolve.** `5d-ii-c`, `T9`, `design §4.2` and the rest name
slices, their tasks and their design documents.
`docs/superpowers/plans/2026-07-19-redextape-roadmap.md` is where they are
defined: it carries a closing entry per slice and names each slice's own spec
and plan.

**"ABOVE" AND "BELOW" INSIDE A BLOCKQUOTE MEAN THE SOURCE FILE, NOT THIS
NOTE.** Every quoted passage was written to be read at its call site, where
"the paragraph above", "the cap below" and "two lines below `view`'s
construction" pointed at neighbouring code. Many quoted lines carry such a
word and none was rewritten, because rewriting one would stop it matching the
file it came out of. Resolve them against the file named by the enclosing `##`
heading — and against that file AS IT STOOD when the passage was written, since
what the passage was pointing at is often the thing that has since changed.
Prose OUTSIDE a blockquote is this note's own and means this note.

## Index

Entries in file order, as they appear below.

- **`web/src/scratch.ts`** — `BufferState` · `MAX_WARM_BUFFERS` ·
  `MAX_WARM_BUFFERS` — transcript · `BufferCapReached` · `ScratchBuffersConfig`
  · `ScratchBuffers` · `#buffers` · `fork` · `cool` · `editorSeed` ·
  `#refuseAtCap` · `list` · `recompile` · `retire` · `noSessionReply`
- **`web/src/editor-custody.ts`** — `editorOwner` · `heldEditors` ·
  `reconcileEditors` · `hasEditor`
- **`web/src/pane-host.ts`** — `PaneHost` · `createPaneHost` ·
  `mountScratchEditor` · `pendingBinding` · `hostFor` · `paneEvents` · `split` ·
  `rebind` · `focusPane` · `applyLayout`
- **`web/src/main.ts`** — `leafCounter` · `sessions` · `LAMBDA_SCRATCH` — the
  constant this file no longer declares · `pool` · `scratchpad` · `sessions.add`
  · `buffers` — the row builder's `term` · `compile` · `replies` ·
  `refreshBuffers` — the start-up call's position
- **`web/src/buffer-list.ts`** — `BufferRow.term`

---

## `web/src/scratch.ts`

### `BufferState`

**What the doc claimed.** Of the `collapsed` field:

> It read: *"HAS NO WRITER AND NO READER IN `src/` YET, AND ARRIVES HERE ANYWAY... `fork` seeds it
> `false`; 5d-ii-d's ninth task gives it the collapse control that writes it and the row that reads
> it."* This is that task.

**What falsified it.** The ninth task landed. `transport.ts`'s `collapse` handler — reached from
`pane-chrome.ts`'s `collapseButton` — became the writer, and `replies.ts`'s `scratch-compiled` arm
became the reader, through `LambdaPane.setEditor`'s second parameter. The call site keeps the current
statement of both.

**Slice.** 5d-ii-d T9.

### `MAX_WARM_BUFFERS`

**What the doc claimed.**

> **THIS USED TO BE A CHOICE, NOT A MEASUREMENT, AND SAID SO AT LENGTH.** The doc here read *"EIGHT IS
> A CHOICE, NOT A MEASUREMENT, and is recorded as such"* — design §4.5, borrowing `layout.ts`'s
> `MIN_PANE_FRACTION` honesty idiom — and walked through the arithmetic behind eight (ten legs' worth
> of ring budget against a page that had never forked; nine threads' worth of wasm baseline) before
> closing on *"A LATER SLICE REPLACES IT WITH A MEASURED CAP"*, design §6.1's promise, filed as
> 5d-ii-d. **This is that slice, and the number moved UP: 8 → 11.** The old arithmetic is retired along
> with the number it argued for — no page-baseline term in it, no thread accounting past nine, and no
> measurement behind either bound; what replaces it below is a real probe against a real, pre-registered
> budget.

**What falsified it.** 5d-ii-d measured the budget instead of arguing it. The old arithmetic had no
page-baseline term, no thread accounting past nine, and no measurement behind either bound. The
pre-registered 512 MiB threshold, the two readings of it, and the reason to believe 11 all stay at the
call site — they are what a reader deciding whether to change the constant needs in front of them.

**Slice.** 5d-ii-d T7/T8.

### `MAX_WARM_BUFFERS` — transcript

The n = 11 direct-verification runs behind the call site's *"all three **fit**, at ≈503.6 MiB with
≈8.4 MiB of headroom"*, exactly as they read there:

>   * Run 1: measured total 489,753,148 bytes; intercept (a) + measured = 528,026,172 bytes
>     (503.56 MiB) — **fits**, ≈8.44 MiB of headroom.
>   * Run 2: measured total 489,754,604 bytes; intercept (a) + measured = 528,027,628 bytes
>     (503.57 MiB) — **fits**, ≈8.43 MiB of headroom.
>   * Run 3: measured total 489,753,148 bytes; intercept (a) + measured = 528,026,172 bytes
>     (503.56 MiB) — **fits**, ≈8.44 MiB of headroom.

**The conclusion these support stays at the call site.** So does the intercept-(a) reading they are
added to, the 512 MiB threshold they are measured against, and the "VERIFIED AT n = 11 DIRECTLY, NOT
ONLY EXTRAPOLATED" argument for why the sweep grew a fourth point at all.

Measured by `tests/browser/buffer-affordability.test.ts`. **Slice.** 5d-ii-d T8.

### `BufferCapReached`

**What the doc claimed.**

> This sentence used to be rendered verbatim after a `fork failed — ` `link-status.ts` glued on for
> every caller; that was false the day `warm`'s own refusal (a cold buffer's owner asking for its seat
> back, whether from the header list's warm control or from a restore) started reaching the same field,
> since neither of those is a fork.

**What falsified it.** `warm` grew its own refusal at the same cap and reached the same `#link-status`
field over restore and header-list paths, neither of which is a fork. The prefix moved to the CALLER;
`#refuseAtCap`'s doc carries the current argument, and the call site keeps the statement that this
class carries no fixed prefix of its own.

**Slice.** 5d-ii-d, review round 2, finding 3.

### `ScratchBuffersConfig`

**What the doc claimed.**

> It read: *"THE ID AND THE LABEL ARE PASSED IN, NOT DECLARED HERE, because `SessionEntry.label`'s doc
> puts the app's session names in `main.ts` 'here and nowhere else' — a module that named its own
> session would be the second place a name could be wrong"*. That held while there was one buffer with
> one fixed name, which `main.ts` could write down before the session existed.

**What falsified it.** A fork mints a name per call, so the name is a function of the counter that
mints the id; the two cannot be written in different places without being able to disagree. What that
sentence was protecting — a session's name is decided where the session is CREATED, never in
`sessions.ts` — survives unchanged at the call site. The surviving prose was repaired where it
referenced the moved text; the pre-move original is quoted above in full.

**Slice.** 5d-ii-c decision 1.

### `ScratchBuffers`

**What the doc claimed.**

> **A FORK MAKES A BUFFER, WHERE 5d-i's DECISION 5 MADE AT MOST ONE.** This class was
> `LambdaScratchpad` and held one fixed id: a second fork rebound the second pane to the scratch the
> first one built, so two panes shared one term and the second pane's seed was discarded. 5d-ii-c
> decision 1 removes that — the `has` branch that implemented it is gone from `fork`, and what
> replaces it is a map keyed by the ids this class mints. **A buffer also stops dying by accident**
> (decision 2), but that is a change to the CALLERS, and the tasks are split so that "what is a
> buffer" and "what ends one" are reviewable apart.

**What falsified it.** Nothing — the paragraph is accurate. It is a record of what the class stopped
being, and of how two tasks were split for review; neither is a fact about the class as it now stands.
The class doc's opening paragraphs already say a fork makes its own buffer and leaves the source
running.

**Slice.** 5d-ii-c decisions 1 and 2.

### `#buffers`

**What the doc claimed.** Two records, both since closed — the first quoted in two parts:

> `main.ts`'s row builder used to justify an unguarded `legOf` with "a buffer is in `#buffers` and in
> the registry together or in neither".

> **5d-ii-d T4 CLOSED THAT HAZARD, WHERE THIS PARAGRAPH USED TO RECORD IT AS OPEN.** It read:
> *"THAT CALL SITE DOES NOT BRANCH ON `warm` YET... wiring the guard is a later task's work."*

> **AND THE HAZARD THIS GUARDS AGAINST STOPPED BEING MERELY THEORETICAL IN THE SAME TASK.** This
> paragraph used to record that "nothing outside `retire` calls `cool` yet", which was the reason the
> throw above had never actually fired despite being reachable by construction. T4 gave the header
> list's temperature control its own call to `cool` (`main.ts`'s `onTemperature` handler), so a
> buffer now goes cold on a gesture with no retire anywhere in it — the row builder's `warm` branch is
> what makes that safe, not this map's record-keeping.

**What falsified it.** Cold buffers falsified the together-or-in-neither invariant; T4 then wired both
the `warm` guard in the row builder and the temperature control that calls `cool` outside `retire`. The
call site keeps the current statement of both: the row builder reads `legOf` only when `b.warm`, and
the temperature control's `cool` is why that guard is load-bearing rather than defensive.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-d T4.

### `fork`

**What the doc claimed.** The records, in the order they stood in the doc.

> **THERE IS NO `has` BRANCH, AND ITS ABSENCE IS THE WHOLE OF DECISION 1.** This method used to open
> with `if (!this.#reg.has(this.#id))` and its doc called that "THE SINGLETON... AND BOTH CONTAINERS
> ANSWER IT AT ONCE": a second fork rebound to the EXISTING scratch rather than making another, so
> nothing here spawned a second worker or overwrote the first seed. Every line of that is now
> false — a fork that happens spawns, seeds, and names its own buffer. (That sentence read "a fork
> ALWAYS spawns, always seeds, and always names its own buffer", and the cap below is what took the
> word back: there is a state in which a fork does none of the three. It is not the branch this
> paragraph is about — the singleton's branch chose between two things a fork could mean, and this one
> chooses between doing all of it and doing none of it.)

> **THE TWO THROWS THAT BRANCH EXISTED FOR ARE STILL THERE, AND NO LONGER NAME THIS CALL SITE.**
> `SessionRegistry.add` and `SessionPool.bind` both refuse an id they already hold, and both of their
> docs used to justify that by pointing here — *"§4.3's singleton rebinding is served by asking `has`
> first, which is one branch at the call site against a leak here that nothing would report"*. There
> is no rebinding for a branch to serve: `#minted` only ever goes up, so the id below is one neither
> container has seen. Both throws stay as guards over their own invariants (a replaced entry strands
> a running `setInterval`; a replaced client misdelivers frames), and both docs now say so on their
> own account rather than on this one's.

> **THE ONE CONDITIONAL IS A REFUSAL, WHICH IS WHERE THE OLD "REBINDING IS UNCONDITIONAL AND CREATION
> IS NOT" PARAGRAPH ENDS UP.** Its point was that a pane already bound to the scratchpad rebinding to
> it is a harmless no-op, and that branching to avoid it would be a SECOND place the singleton rule was
> written down. There is no rule left to write down twice; what survives is the shape it was
> protecting, and the cap below does not spend it. **This paragraph opened "NOTHING HERE IS
> CONDITIONAL" and ended "there is no state in which a fork means something else"**, which the cap
> makes false as written and true as intended: every call that returns does the same things in the same
> order, and the added branch decides whether this method runs at all rather than what a fork means
> when it does. A second outcome that returned an id would be the thing the sentence was guarding
> against; a throw is not one, because no caller can mistake it for a fork.

> …and until this review the two threw the same `BufferCapReached` from two
> separate call sites — including a hundred-character message repeated verbatim, which is exactly the
> kind of duplication that drifts (Minor 1: `main.ts` quoted the message before the drift and stayed
> stale after it, without either duplicate updating the other's copy).

And the refusal message's own enumeration, which shipped and was then removed:

> It read `all 8 scratch buffers are live (scratch 1, scratch 2, scratch 3,
> scratch 4, scratch 5, scratch 6, scratch 7, scratch 8); retire one from…`, on the argument that
> "the buffers it lists are exactly the rows design §4.2's header list offers a retire on, so the
> sentence and the gesture name the same things". Both halves of that hold and neither helps: the
> names are `scratch 1` through `scratch 8` BY CONSTRUCTION — a counter's output, carrying nothing
> that distinguishes one buffer from another — so the enumeration is sixty characters of noise
> standing between the diagnosis and the only actionable clause in the sentence, on a one-line dim
> status readout with no wrap. The user has to read past every name to reach the instruction, and the
> names tell them nothing they could act on when they get there.

The paragraph that replaced it stays at the call site.

**What falsified it.** 5d-ii-c decision 1 deleted the singleton, so the `has` branch, the two docs that
pointed at it, and the "nothing here is conditional" claim all lost their subject at once. The cap
added the one branch, and the two duplicated throws were extracted into `#refuseAtCap`. The
enumeration was removed after the line was read on a real page. Every current consequence stays at the
call site: the two throws' own invariants, the argument that a refusal does not make a fork mean two
things, the refusal's placement first in the body, and the reason the message names the control rather
than the buffers.

The surviving prose was repaired where it referenced the moved text; the pre-move original is
quoted above, elided only where the elided text stayed at the call site.

**Slice.** 5d-ii-c decision 1; 5d-ii-d review round 2, Minor 1.

### `cool`

**What the doc claimed.** Of the rebind that takes the editor down:

> …and nothing built another:
> `warm`'s build lands with no pane claiming a leaf, so `replies.ts`'s `scratch-compiled` arm resolves
> `editorHome` to `undefined`, and a later bind re-posted no build and claimed no leaf either. The
> buffer's frames rendered and its text was unreachable, permanently.

**What falsified it.** `pane-host.ts`'s `mountScratchEditor`, seeding from `editorSeed`. The call site
keeps what this method still does — the editor comes down here — and the fact that it is the ARRIVING
side that builds a new one, with `tests/browser/buffer-cool-warm.test.ts` as the test that fails
without it.

The surviving prose was repaired where it referenced the moved text; the pre-move original is
quoted above, elided only where the elided text stayed at the call site.

**Slice.** 5d-ii-d, whole-branch review before merge.

### `editorSeed`

**What the doc claimed.**

> Before this, a `cool` followed by a `warm` produced exactly that state on every path: `cool` rebinds
> every pane away (its own invariant), so the editor is destroyed by `setDetached(false)`'s teardown;
> `warm` posts a build that lands with no pane claiming a leaf, so `editorHome` answers `undefined`
> and nothing mounts; and binding a pane afterwards mounted nothing either. The buffer's frames
> rendered and its text could never be edited again — which made `cool`, "the non-destructive escape
> from the cap" (see its own doc), destructive of editability.

**What falsified it.** This method, and `mountScratchEditor` calling it. The call site keeps the same
mechanism stated as the reason the method exists rather than as the bug it closed — a `cool` followed
by a `warm` is still the path that reaches the unseeded state, and without a seed to mount from `cool`
would still be destructive of editability. The surviving prose was repaired where it referenced the
moved text; the pre-move original is quoted above in full.

**Slice.** 5d-ii-d, whole-branch review before merge.

### `#refuseAtCap`

**What the doc claimed.**

> This doc used
> to claim this method's message "reads as a sentence after `fork failed — `, which is the only way
> it is ever shown" — true while `link-status.ts` supplied that prefix for every caller of
> `setForkFailed`, and false the moment `warm`'s refusal started reaching the same field over the
> same restore/header-list paths that are not forks…

**What falsified it.** `warm`'s refusal reaching `#link-status` over restore and header-list paths. The
call site keeps the live half of the same sentence — a renderer that cannot tell its callers apart has
no honest way to prefix only some of them — along with what each caller passes and why the body has to
read correctly with nothing in front of it.

**Slice.** 5d-ii-d, review round 2, finding 3.

### `list`

**What the doc claimed.**

> The
> paragraph here read "NO `id` OR `live` ACCESSOR, AND THE ABSENCE IS DELIBERATE. Both were written
> and both had exactly one caller: a test... a getter here would be a third spelling of a fact two
> containers already hold". That argument was correct and it was about a SINGLETON: `reg.has(id)`
> and `pool.has(id)` answered "does the scratchpad exist" because the id was a constant the caller
> already had. […] The refusal stands as written for the accessor it refused.

**What falsified it.** Nothing — the refusal was correct for the accessor it refused, and this is a
different accessor. What survives at the call site is the reason it is a different one: neither
container records which of its keys are buffers, or in what order they were forked.

**Slice.** 5d-ii-c decision 1.

### `recompile`

**What the doc claimed.** Two quoted retractions:

> `retire` and `noSessionReply` below arrived here one task later and are
> keyed the same way now; this method's doc used to say they were "deliberately NOT keyed yet", which
> is the sentence that task deleted.

> (`retire`'s half of that sentence read "because most
> recompiles happen with no buffer at all" while a source keystroke called it on every keystroke;
> decision 2 deleted that caller, and `retire`'s own doc records what is left.)

**What falsified it.** `retire` and `noSessionReply` were keyed the task after this one, and decision 2
deleted the source-keystroke caller that made "most recompiles happen with no buffer at all" true. The
call site keeps the current fact — all three are keyed the same way — and the live half of the boolean
argument.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-c decision 2.

### `retire`

**What the doc claimed.** Five records, the fifth quoted in two parts because live text stayed at the
call site between them:

> **IT TAKES THE BUFFER IT ENDS, AND THE PARAGRAPH HERE USED TO EXPLAIN WHY IT COULD NOT.** That
> paragraph read: *"WHICH BUFFER, WHEN THE SIGNATURE NAMES NONE — TRANSITIONAL... It means the
> buffer forked most recently, which is the singleton's exact behaviour in every state a caller
> reaches with one fork, and a placeholder in every other."* Every word of it is now spent. The
> newest-buffer reading is gone from this class entirely — the `#newest()` helper that held it is
> deleted — and with it the state it warned about, where a second fork followed by a recompile left
> the older buffer running with nothing pointing at it. **What the two tasks bought by splitting is
> still worth stating**: this one changes only the KEY, and the two callers below go on firing at
> exactly the moments they fired before, so a review of the trigger (Task 3 for recompile, Task 4 for
> poison) reads a diff that changes nothing else.

> …AND THE SENTENCE ABOVE USED TO END "…EXCEPT `noSessionReply`'s PHANTOM-FORK
> PATH". That was the second of decision 2's two deletions and it closed the table in design §4.3…
> **The window where the app could create buffers and end
> none was TOTAL for three tasks** — deliberately, so that "what ends a buffer" was reviewable as one
> change rather than as a residue of two — and §4.2's header list closed it.

> This method used to rebind panes, reset legs, and forget the registry and pool entries
> itself, in that order, with the full reasoning — "PANES, LEGS, REGISTRY, POOL" — stated at this
> point in the doc. Review (5d-ii-d, Finding 0) gave `cool` the identical panes-home rebind this
> method always did: cooling a buffer used to leave its panes pointing at it, which review found was
> the wrong trade (`cool`'s own doc has the argument in full), and the fix left the two methods doing
> the same four steps under two names.

> **IT RETURNS A BOOLEAN BECAUSE ITS CALLER RAN ON EVERY KEYSTROKE, AND THAT CALLER IS THE ONE
> DECISION 2 DELETED.** `compile.ts`'s `schedule` fired this per keystroke while the post itself was
> debounced, and a repaint per keystroke is the waste the editor's update listener explicitly
> declines to pay — so "did anything move" told it which single keystroke had retired a buffer. There
> is no caller in `src/` to read the answer today (the sentence here named `noSessionReply` below as
> the one that discarded it, and that call is gone too). **THIS PARAGRAPH SAID §4.4's RETIRE CONTROL
> WOULD BE "THE READER IT IS KEPT FOR"; THAT CONTROL IS WIRED NOW, AND IT DISCARDS THE ANSWER.** The
> reason offered — "a list rebuilt around a row that ended nothing would be reporting a gesture that
> did not happen" — describes a list that KEEPS its rows.

> It read: *"THE MEMBERSHIP CHECK IS ALSO WHAT KEEPS A STALE
> NAME FROM THROWING — `entryOf` below raises for an id the registry does not hold…"*

> (That was justified by "most recompiles happen when
> no buffer exists at all" while a source keystroke was the caller; the stale-name case is what
> remains, and it was always the sharper one.)

**What falsified it.** In order: the key landed and `#newest()` was deleted; decision 2 removed the
`noSessionReply` retire, closing design §4.3's table, and §4.2's header list closed the create-but-never-end
window; review Finding 0 gave `cool` the panes-home rebind, which left `retire` as `cool` plus a
delete and moved the panes/legs/registry/pool order argument into `cool`; decision 2 deleted the
per-keystroke caller that read the boolean; and `entryOf` moved inside `cool`, behind `cool`'s own
`state === undefined` guard, so the membership check's job moved from stopping a throw to stopping a
wrong `true`. All five current consequences stay at the call site.

The surviving prose was repaired where it referenced the moved text; the pre-move original is
quoted above, elided only where the elided text stayed at the call site.

**Slice.** 5d-ii-c decision 2; 5d-ii-d review, Finding 0.

### `noSessionReply`

**What the doc claimed.** The records, in the order they stood in the doc.

> **THIS LINE ENDED "…AND 5d-i DESIGN §4.1a's REMEDY MADE REAL RATHER THAN MERELY PROMISED", AND
> 5d-ii-c DECISION 2 TOOK THAT BACK.** §4.1a's remedy is "the pane keeps offering ✎ — the user can
> scrub to a smaller step and fork there", and it was the RETIRE below that delivered it, by putting
> the pane back on a session it was not stuck on. Reporting the reason is what survives; the way out
> moves to §4.4's header list, and the paragraph two below is where that debt is recorded.

> Its doc said "UNKEYED FOR THE SAME REASON `retire` IS, AND IT READS THE SAME BUFFER `retire`
> WOULD" — the most recently forked one. That reading was not merely imprecise, it was backwards for
> the case this method exists to serve: a fork that fails to build is answered by a `no-session` for
> a buffer with NO frame, and any buffer forked after it has one, so the newest reading looked at a
> healthy buffer, returned `null`, and left the pane stranded on the phantom — the CRITICAL finding
> this method was written to close, reopened by a second fork.

> **AND THE NEXT TASK TOOK THE RETIRE AWAY, WHICH THE PARAGRAPH ABOVE PROMISED IN THESE WORDS**:
> *"WHAT DOES NOT MOVE IS WHEN THIS FIRES: Task 4 is where this arm stops retiring at all (decision 2:
> a buffer that failed to build is still a buffer), and doing that here would fold the key and the
> trigger back into one diff."* The key landed in one task and the trigger in the next…

> **WHAT THE RETIRE WAS ALSO DOING, SAID PLAINLY RATHER THAN LEFT TO BE MISSED.** It terminated the
> phantom's worker, forgot the buffer, and rebound the pane back to `home` — and that rebind is what
> made `SessionEntry.detached` read `false` for that pane again, so `LambdaPane.#refreshDetach`
> offered `✎ fork` once more, which is 5d-i §4.1a's promised remedy actually happening. […]
> **THAT LIST IS WIRED, AND THIS SENTENCE USED TO
> END "…until that list is wired there is no way to reclaim one at all".** […]
> `tests/browser/scratch-fork.test.ts` asserts exactly that sequence, on the line that
> used to assert the dead end.

> …AND ITS ARGUMENT CHANGED
> SHAPE WITH THE SINGLETON. It used to run: `detach` posts a build only when the scratch does not
> already exist, so a session with no frame yet can only be mid-`detach`'s first and only build. The
> premise is gone — every fork posts a build — but the conclusion holds for a simpler reason…

> **THAT SENTENCE OPENED "RETIRES AND RETURNS"**, and the clause it lost is the whole
> of this task: `retire` did the job (panes home, legs reset, registry and pool forgotten) and no
> longer runs…

And the race the `warm` check was once said to guard against:

> It went on to say that a reply "can therefore land here for a buffer that
> was cooled between the post and the answer", and that the `warm` check below was "the STATED
> GUARANTEE, NOT BELT-AND-BRACES OVER ONE", on the grounds that `Worker.terminate()`'s discarding of
> queued messages was an assumption this codebase nowhere writes down.

**What falsified it.** 5d-ii-c decision 2 removed the retire from this arm, which took the §4.1a
remedy with it until §4.2's header list restored it from the header rather than from the stuck pane.
The reply's own session became the key, replacing the newest-buffer reading that had reopened the
CRITICAL finding. Every fork posting a build removed the singleton premise the discriminator's argument
rested on, though the conclusion survives for a simpler reason. And the cooled-buffer race was
corrected outright: the HTML specification's *terminate a worker* algorithm empties the parent-side
port message queue, and `cool` calls `#pool.unbind(id)` synchronously, so no such reply can be
dispatched — the call site now states the check as belt-and-braces kept on its own terms.

The surviving prose was repaired where it referenced the moved text; the pre-move original is
quoted above, elided only where the elided text stayed at the call site.

**Slice.** 5d-ii-c decision 2; 5d-ii-d review round 2, finding 1; whole-branch review before merge,
finding 8.

---

## `web/src/editor-custody.ts`

### `editorOwner`

**What the doc claimed.**

> **SET IN THREE PLACES, WHERE THIS USED TO READ "TWO PLACES ONLY" — 5d-ii-d T9 ADDED THE THIRD.**
> `paneEvents`'s wrapped `detach` (the first mount, at the moment a fork succeeds) and its
> `showEditor` (every later move) are the two gesture-driven writers this used to name in full;
> `main.ts`'s restore sequence is the third, claiming a leaf whose session came back bound from
> `redextape.buffers` — see that call's own doc for why it runs AFTER the first `applyLayout()`
> rather than beside `seedBinding`, which is what keeps it "a pane that already existed" like the
> other two rather than the stale-on-arrival claim `dropClaimsOn` below exists to catch. Nothing else
> ever writes this map — a rebind away from the scratch leaves the entry stale on purpose, per the
> paragraph above.

**What falsified it.** 5d-ii-d T9's restore sequence. The doc had enumerated the two gesture-driven
writers as the whole set — "SET IN TWO PLACES ONLY" — and `main.ts`'s restore claims a leaf whose
session came back bound from `redextape.buffers`, which is a third. The call site keeps the current
enumeration of all three, and the reason the restore claim runs AFTER the first `applyLayout()` rather
than beside `seedBinding`.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-d T9.

### `heldEditors`

**What the doc claimed.** Four records, in the order they stood in the doc.

> **IMPORTANT FINDING, WHOLE-BRANCH REVIEW BEFORE MERGE: WITHOUT THIS, CLOSING THE HOLDER STRANDED
> THE EDITOR AND THE CONTROL TO RETRIEVE IT STAYED OFFERED.** `applyLayout` drops a closed pane from
> `panes` before anything asks it for its editor, and `reconcileEditors` only ever iterates
> `panes.of('lambda')` — so the `LambdaEditor` was left mounted in a host no longer in the tree, with
> nothing holding a reference that could reach it. Meanwhile the surviving pane, still bound to the
> scratch and still holding no editor, kept offering "bring the term editor to this pane"
> (`LambdaPane.#refreshClaim`'s `#detached && #editor === null`), and clicking it did nothing —
> forever. **That is the exact failure this slice's own standard names first: a control that provably
> cannot work must not be offered.** Rather than withdraw the control, the editor is taken into
> custody so the control works — which is what design §4.3 promises in as many words: "the next pane
> to ask for the editor re-mounts the same view with its text, cursor and undo intact".

> **THE PREMISE THIS USED TO ARGUE FROM IS FALSE, AND THE CORRECTED ONE POINTS THE SAME WAY — Minor
> finding, re-review of this fix.** It read "the closed leaf's id is never reused (`nextLeafId` only
> counts up), so keying by it would be keying by something nothing can ask for again". `nextLeafId`
> does only count up, but it is not the only source of ids: `defaultLayout()` writes `source`,
> `lambda-0` and `tm-0` down as literals and `reset layout` re-mints all three, so a closed `lambda-0`
> comes back — and `parseLayout` can restore any id a stored tree holds. A leaf id is therefore a
> WEAKER key than a session, not merely a differently-shaped one: it can be inherited by a pane that
> has nothing to do with the one that claimed the editor. `applyLayout`'s pane-creation loop drops
> exactly that inheritance for `editorOwner` (which IS keyed by leaf) where it happens.

> …and BOTH ENDINGS ARE REACHED BY THE SAME
> FUNCTION, which they were not when this sentence was first written: retiring used to happen on a
> path that never reconciled, so the second ending never arrived. **The second ending went briefly
> unreachable for a different reason and is reachable again** — 5d-ii-c decision 2 left nothing in
> `src/` calling `ScratchBuffers.retire` at all, which did not weaken the arrangement so much as leave
> it idle, and §4.2's header list supplied the trigger: `main.ts`'s retire handler calls `retire` and
> then `reconcile`, in that order. See `reconcileEditors`' own doc.

> **AND "THE SAME FUNCTION" WAS NOT ENOUGH ON ITS OWN — IMPORTANT FINDING, THIRD REVIEW ROUND.** That
> function ran both its passes inside one loop over `editorOwner.keys()`, so it could only reach an
> entry HERE for a session that also held a claim — and the Minor fix beside this one (`applyLayout`'s
> pane-creation loop, which drops a claim recorded against an arriving leaf id) deletes exactly that
> claim while the entry stays. The two endings then both went missing for the same entry: no home was
> ever found for it, and its session's retirement swept nothing. `reconcileEditors` now iterates THIS
> MAP for its custody pass rather than the claim map, which is what makes the sentence above a fact
> about the code rather than about the common case.

**What falsified it.** In order: this map itself closed the stranded-editor defect, so the call site
keeps the same mechanism stated as the reason the map exists rather than as the bug it closed, and as a
counterfactual rather than as a state the app is in — without this map a closed holder WOULD leave
`applyLayout` and `reconcileEditors` with nothing that could reach the editor, and the claim control
would go on being offered and go on doing nothing.
`defaultLayout()`'s literal ids and `reset layout`'s re-mint falsified "the closed leaf's id is never
reused", and the corrected premise — a leaf id is the weaker key because it can be inherited — is what
stays. 5d-ii-c decision 2 left nothing in `src/` calling `ScratchBuffers.retire`, and design §4.2's
header list then supplied the trigger, so the second ending's brief unreachability is spent. And the
third review round split `reconcileEditors`' two passes over two domains, which is the current fact the
call site keeps.

The surviving prose was repaired where it referenced the moved text; the pre-move original is
quoted above, elided only where the elided text stayed at the call site.

**Slice.** 5d-ii-d, whole-branch review before merge; re-review of that fix, Minor; third review round,
Important; 5d-ii-c decision 2.

### `reconcileEditors`

**What the doc claimed.** Ten records from the function's doc, then three from the comments on its own
loop. In the order they stood.

> The two carried the same label
> until a review pointed out that a screen-reader user heard one name for both.

> Both passes used to live inside
> ONE loop over `editorOwner.keys()`, which made this function's opening sentence — then, as now, a
> claim about EVERY editor — false of any held editor whose session held no claim. That is not a
> hypothetical state: the Minor fix in the same commit as the custody one has `applyLayout`'s
> pane-creation loop DROP the claim recorded against an arriving leaf id, and `reset layout` re-mints
> `defaultLayout()`'s literal ids, so dropping it is exactly what `reset layout` does after a close.
> **Six clicks, and both fixes are individually correct**: fork `lambda-0`, close it, `reset layout`
> (drops the claim, leaves the entry), type in the SOURCE editor (retires the scratch — and the sweep
> this retire calls could not see the entry, so the editor over the terminated worker survived), fork
> again on the fresh `lambda-0` (a second, live editor, mounted legitimately), then split any pane.
> The custody pass then handed the live pane the dead editor and `receiveEditor` threw. What caught
> it was concatenating the two tests those two fixes shipped with — neither sequence reaches it alone;
> `tests/browser/two-lambda-panes.test.ts`'s concatenation test is the result. **THOSE SIX CLICKS NO
> LONGER REPRODUCE IT, AND THE FIX THEY ARGUE FOR IS UNCHANGED**: 5d-ii-c decision 2 makes the fourth
> of them — typing in the source editor — retire nothing, so the sequence stops one step short of the
> destroy branch. See (1) below for where the retire went.

> **WHICH LINE PERFORMS THAT DESTRUCTION MOVED, AND THE OUTCOME DID NOT.** It read "an editor TAKEN
> OFF a pane… is destroyed", meaning the `held.destroy()` below; a rebound-away pane no longer names
> the session, so the binding predicate on the loop skips it now. `LambdaPane.setDetached`'s own
> teardown is what tears that editor down — it fires from `PaneSlot.render` on the very next `draw()`,
> which is the same tick, and `scratch-rebind-editor.test.ts` is the test that pins it. The branch
> below still answers the case it was written for: a pane that IS on the session while the session
> holds no home for it, which is what a claim pointing at a closed leaf leaves behind.

The scratch→scratch leak, which this doc recorded first as live and then as closed — **the record of
that correction is what moves; the current statement of what closes the leak stays at the call site**:

> **AND THAT HANDOVER USED TO COVER ONLY THE REBIND TO SOURCE — A SCRATCH→SCRATCH REBIND LEAKED THE
> EDITOR. THIS WAS A LIVE DEFECT (Important finding, review of the deferred-a11y item 11 fix; filed on
> the roadmap's 5d-ii-c entry) AND IT IS NOW CLOSED, AT THE REBIND SITE RATHER THAN IN THIS FUNCTION.**
> `setDetached` still tears down only on `!detached`, and both sides of a scratch→scratch rebind are
> still detached, so it still never fires — that half of the mechanism has not changed. What changed is
> upstream: `pane-host.ts`'s same-leg `rebind` arm now calls `takeEditor()` on the outgoing pane and
> `custody.hold(leaving, held)` BEFORE `base.rebind` moves the binding, so the editor is off the pane
> and sitting in `heldEditors` by the time this sweep could ever reach it. `scratch-rebind-editor.test.ts`
> — the test named above as pinning this — now drives the rebind both ways, not only back to SOURCE, so
> the gap that was never under a test now is. **THE BINDING PREDICATE ON THE SWEEP'S LOOP BELOW IS
> THEREFORE BELT-AND-BRACES, NOT THE FIX**: with the upstream handover in place there is normally
> nothing left mounted on a rebound-away pane for it to skip, but it still stands as a second line of
> defence against any future writer of `slot.rebind` that forgets to hand the editor over first. Closed
> at the rebind site rather than folded into the a11y fix it had nothing to do with.

> Splitting the two passes apart (above) STRENGTHENED
> that ordering rather than weakening it: every sweep now runs before any custody mount, where before
> only the sweep for the same session did.

> **WHAT THAT ORDER DOES AND DOES NOT BUY, CORRECTED — IMPORTANT FINDING, RE-REVIEW OF THIS FIX.**
> This paragraph used to assert that "the two can never both fire for one session (there is one editor
> per session, so if a pane holds it, custody does not)". **That was false across a retire, and the
> six-step sequence in `tests/browser/two-lambda-panes.test.ts` is the falsification.** The λ scratch's
> session id is a CONSTANT that the next fork re-registers, so a custody entry keyed by it survived
> its session's death — the retire path called `draw()` and never `applyLayout()`, so the
> `!sessions.has(session)` branch below never ran — and a later fork then mounted a SECOND editor for
> the same id on the pane the stale entry named. Both did fire, `receiveEditor` overwrote a live
> `#editor`, and design §4.3's structurally impossible state was on screen: two `.cm-editor`s in one
> pane, the pane pointing at the one over the terminated worker and the live one orphaned in the DOM.

> **WHAT IS TRUE NOW IS A CONJUNCTION OF THREE THINGS, AND THE ORDER OF THE TWO PASSES IS ONLY THE
> WEAKEST OF THEM.** (1) EVERY RETIRE SWEEPS EVERY HELD EDITOR: a retire calls this function, AND its
> custody pass iterates `heldEditors` itself, so no custody entry can outlive the incarnation of the
> session it is keyed by. **THAT CLAUSE USED TO NAME TWO CALLERS — "`replies.ts`'s phantom-fork
> `no-session`, and until 5d-ii-c decision 2 `compile.ts`'s recompile-from-source beside it" — AND IT
> NAMES ONE NOW.** Decision 2 deleted the second of those two as well, leaving nothing in `src/`
> retiring at all; design §4.4's header list is what supplies the retire today, and the obligation is
> discharged in that list's own handler (`main.ts`), which calls `ScratchBuffers.retire` and then this
> function. **The branch was unreachable in between and is unchanged**, and the gesture that drives it
> is the list's retire control. **The second half of that sentence is the third round's correction and it is
> not a detail**: while both passes shared one loop over `editorOwner.keys()`, "every retire sweeps"
> described a function whose body could not see an entry no claim named, and one existed after every
> `reset layout`. (2) `receiveEditor` THROWS rather than overwriting, so if the two ever do both fire,
> the app says so at the moment of the mistake instead of silently orphaning a live view — and the
> throw now costs the caller its gesture and nothing more (see `applyLayout`'s `try`/`finally`).
> (3) The order below then means that even a case satisfying both — a session with an editor mounted
> on a pane AND an entry in custody — hands the sweep's editor over first, so custody's throw names
> the sweep as the arrival that got there first. WITHIN one page-load incarnation the old sentence is
> still true and still worth keeping for that reason: there is one editor per session, so if a pane
> holds it, custody does not.

> **TWO THINGS THE SWEEP DID NOT SAY UNTIL BUFFERS WENT PLURAL, BOTH ON THE LOOP BELOW AND BOTH WITH
> THEIR OWN COMMENTS THERE.** Its outer walk skips a claim whose SESSION the registry no longer holds,
> and its inner walk skips a pane whose own BINDING names a different session. Neither was a
> distinction 5d-i could draw: with one fixed scratch id there was one claim at a time and one editor
> at a time, so "every claim" and "the live one", "every λ pane" and "the panes that could be holding
> this session's editor", were the same sets. A fork that mints its own buffer (5d-ii-c decision 1)
> separates both pairs, and each was a live defect on the day it did — a retired buffer's claim
> destroying a live buffer's editor, and one buffer's editor being handed to another buffer's home
> where `receiveEditor` throws.

> (it rebinds no
> others — the sentence here said "every pane", which was the singleton's arithmetic rather than
> `retire`'s rule)

> **NO CALLER IN `src/` REACHED THIS BRANCH FOR THREE TASKS, AND THE DEBT THAT LEFT IS PAID HERE.**
> It is guarded by `!sessions.has(session)`, and only `retire` removes a session — 5d-ii-c decision 2
> deleted both of the app's implicit retires (`compile.ts`'s recompile-from-source, then `replies.ts`'s
> phantom-fork `no-session`), and design §4.4's header list then supplied the explicit one. **The
> regression guard was lost rather than moved in between**, which `tests/browser/two-lambda-panes.test.ts`
> recorded from the layout side. `tests/browser/editor-custody.test.ts` is what pays it back, and it
> does so by constructing THIS factory rather than a stand-in: the test that appeared to drive this arm
> before was counting a STUBBED `reconcileEditors` and measured its call site, never the destroy. It
> covers this branch and the two beside it — the claim drop above and the `held.destroy()` in the
> sweep — because all three went dark for the same reason and only one of them had a paragraph.
> (This paragraph's parenthesis used to add that the narrow `editorHome` thunk `compile.ts` held was a
> no-op on every path that reached it — a fact about a file that has held no retire branch since
> decision 2.)

And from the comments on the loop itself:

> That was harmless while `main()` had ONE scratch id — the next fork re-registered the same key,
> so the stale entry and the live one were the same entry — and it stopped being harmless the
> moment a fork minted a fresh id per call (5d-ii-c decision 1): `editorHomeFor` answers
> `undefined` for the dead session, and the loop below then takes the editor off EVERY λ pane and
> destroys it, including the one a later fork had just legitimately mounted for a different
> buffer. Measured as two λ panes both reading `[detached]` with no `.term-editor` between them.

> It said the rebinding happened "before the retire site calls this
> ('either retire site' until 5d-ii-c decision 2 deleted `compile.ts`'s)" — an enumeration left
> over from the two implicit retires, kept alive past the deletion of both, and contradicting the
> two paragraphs this slice added above.

> **THAT IS TRUE OF THE REBIND TO SOURCE AND WAS FALSE OF A SCRATCH→SCRATCH ONE, WHERE THIS
> `continue` USED TO BE THE LINE THAT LET THE EDITOR LEAK.** `setDetached` still does not fire its
> teardown when both bindings are detached, so this skip still means nothing HERE takes the
> editor down — but by the time this loop runs there is normally nothing left for it to skip:
> `pane-host.ts`'s same-leg `rebind` arm now takes the outgoing editor into custody before
> `base.rebind` changes the binding this predicate reads. Recorded in full, with what closed it,
> in this function's own doc above — fixed on a later commit of the branch that found it.

**What falsified it.** In order: `pane-chrome.ts`'s `claimEditorButton` took an `aria-label`
("bring the term editor to this pane") that deliberately does not reuse `collapseButton`'s
("show"/"hide the term editor") — only one control took a distinct label; `collapseButton`'s was never
renamed. The collision a review once heard is spent because the two controls no longer share a label,
not because both were renamed. The third review round split the two passes over two domains, which
retired both the one-loop record and the six-click repro — and 5d-ii-c decision 2 then made the
repro's fourth step retire nothing, so it no
longer reaches the state at all. `LambdaPane.setDetached`'s own teardown, not `held.destroy()`, is what
takes a rebound-away editor down, so the "TAKEN OFF a pane" wording named the wrong line.
`pane-host.ts`'s same-leg `rebind` arm — which calls `takeEditor()` and `custody.hold` before
`base.rebind` moves the binding — closed the scratch→scratch leak, so the doc's record of it as a live
defect, and of the correction that followed, is history; **the call site keeps the statement that the
leak cannot happen and what closes it**, along with the argument that the loop's binding predicate is
belt-and-braces rather than the fix. The constant λ scratch id that let a custody entry outlive its
session is gone with 5d-ii-c decision 1's per-fork ids, so the collision paragraph's whole mechanism is
retired; the three-part conjunction it was corrected into stays. Decision 2 deleted both implicit
retires and design §4.4's header list supplied the explicit one, which spends the two-callers
enumeration, the unreachable window, and the three tasks the destroy branch went dark for.
`tests/browser/editor-custody.test.ts` covering the branch stays; the account of the stubbed test that
appeared to cover it does not. And `retire`'s rule — it rebinds the panes on that buffer and no others —
stays as a rule, without the singleton's arithmetic it replaced.

The surviving prose was repaired where it referenced the moved text; the pre-move original is
quoted above, elided only where the elided text stayed at the call site.

**Slice.** 5d-ii-c decisions 1 and 2; 5d-ii-d third review round, Important; re-review of that fix,
Important; review of the deferred-a11y item 11 fix, Important; whole-branch review before merge.

### `hasEditor`

**What the doc claimed.**

> **AN EDITOR MOUNTED ON A PANE WHOSE BINDING HAS MOVED AWAY IS NOT COUNTED, AND THIS PARAGRAPH USED
> TO JUSTIFY THAT WITH A CLAIM THAT IS FALSE — Important finding, review of this fix.** It read that
> such an editor "is an ORPHAN by this file's own definition — `reconcileEditors` takes it down on
> the next sweep". The sweep does no such thing: its inner loop opens with `if (p.slot.binding.session
> !== session) continue`, which skips exactly the rebound-away pane, and `LambdaPane.setDetached`
> tears down only on `!detached`, which a scratch→scratch rebind never reaches because both bindings
> are detached. **THAT USED TO LEAVE THE EDITOR MOUNTED INDEFINITELY — a live defect — but the rebind
> itself no longer leaves one there to find**: `pane-host.ts`'s same-leg `rebind` arm now takes the
> outgoing editor into custody before the binding moves, so a pane whose binding has moved away is, in
> the ordinary case, holding nothing by the time anyone asks. See the standing note at the top of
> `reconcileEditors` for the full history and what closed it.

**What falsified it.** The orphan claim was false when it was written — the sweep skips exactly the
rebound-away pane — and the mounted-indefinitely consequence stopped being live when `pane-host.ts`'s
same-leg `rebind` arm started taking the outgoing editor into custody before the binding moves. Both
current facts stay at the call site: why the sweep does not take such an editor down, and what upstream
keeps one from being left there. The heading keeps its hook, so the paragraph below it that argues "for
a reason that does not depend on the false claim" still resolves.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-d, review of the deferred-a11y item 11 fix, Important; review of the deferred-a11y
item 11 fix's own re-review.

---

## `web/src/pane-host.ts`

### `PaneHost`

**What the doc claimed.** Two records.

> (`compile.ts` was a fourth until 5d-ii-c decision 2
> deleted the retire it held; a compile touches no pane at all now.)

> THREE MEMBERS, WHICH IS WHAT `main.ts` ACTUALLY CALLS — and the shorter list is a decision rather
> than an oversight. The extraction first exported five, adding `hostFor` and `paneEvents`; no caller
> outside this module ever reached either, because both are used only from inside `applyLayout`.

**What falsified it.** 5d-ii-c decision 2 deleted the retire `compile.ts` held, which took that file out
of the list of things handed an empty `PaneCollection` — a list the call site states as it now stands.
And the extraction's own review cut the exported surface before the slice landed, so what it first
exported is a fact about a draft rather than about the module. The live half of both stays: which
modules read the collection live, and that `hostFor` and `paneEvents` are unexported because no caller
outside this module reaches them — with the mirror-of-`deps` argument for why that is a decision, and
the statement that both remain in scope as closures.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-b, review of the extraction; 5d-ii-c decision 2.

### `createPaneHost`

**What the doc claimed.** Five records from the `deps` doc, in the order they stood, then one from the
destructure comment below it.

> (Named rather than positioned as "the last six", which is what
> this said until `tmProgramOf` was added below them. That one is not one of them: it answers a
> question this module asks on its own account rather than restoring a reference `main()`'s scope used
> to supply for free, and its own doc carries the argument for its shape.)

> `sourceSession` is
> `main()`'s one remaining session-id constant — `lambdaScratch` stood beside it until 5d-ii-c decision
> 1 made a fork mint its own buffer id, and a session named where it is created is not a constant any
> scope can hand over;

> **NOT
> BECAUSE NOTHING HERE WOULD READ ONE — `tmProgramOf` below is precisely a read a registry would serve,
> and this sentence used to rest on the counterfactual that no read existed at all.**

> The paragraph above used to open "Nothing in this module
> asks a question about a session — a slot carries the binding, `custody` answers the editor questions,
> and `sessions.has` is `editor-custody.ts`'s call", which stopped being true the moment a newly built
> `TmPane` had to be seeded with the machine its session already compiled. What did NOT change is the
> conclusion: the dependency is a function from a `SessionId` to that one retained value, so the body
> still cannot ask anything else.

> (Phrased as "this module" rather than as a count of MEMBERS, deliberately: this sentence said "the
> five members below" until the exported surface became three, and a doc that restates an arity has to
> be re-read every time the arity moves.

And from the comment on the renaming destructure:

> `LAMBDA_SCRATCH` used to arrive the same way and is
> gone with the singleton it named (5d-ii-c decision 1): a buffer's id is minted per fork, so there
> is no scratch-session constant for this module to be handed.

**What falsified it.** `tmProgramOf` arriving below the moved-body dependencies falsified both the "last
six" positional phrasing and the claim that nothing here asks a question about a session; the exported
surface shrinking falsified the "five members below" count. 5d-ii-c decision 1 made a fork mint its own
buffer id, which removed `lambdaScratch` from `main()` and `LAMBDA_SCRATCH` from this destructure. Every
current consequence stays at the call site: which five names the moved bodies reached for and why they
are listed separately, that `tmProgramOf` is not one of them, why a `SessionRegistry` is refused even
though a read exists that one would serve, the shape that keeps the body unable to ask anything else,
and the rule against restating an arity in a doc.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-b, self-review of the extraction; 5d-ii-c decision 1.

### `mountScratchEditor`

**What the doc claimed.** Of the defect the function closes:

> **THE DEFECT THIS CLOSES: A `cool` FOLLOWED BY A `warm` PRODUCED A BUFFER THAT COULD NEVER BE EDITED
> AGAIN — whole-branch review before merge, and the project owner ruled it fixed rather than filed.**
> `ScratchBuffers.cool` rebinds every pane away from the buffer it sleeps (that is the invariant the
> whole cold/warm split rests on), so `PaneSlot.render` -> `LambdaPane.setDetached(false)` tears the
> editor down; `warm` then spawns and posts a build that lands with NO pane claiming a leaf, so
> `replies.ts`'s `scratch-compiled` arm resolves `editorHome(session)` to `undefined` and mounts
> nothing. Binding a pane back through the selector afterwards re-posted no build and claimed no leaf,
> and "bring the term editor to this pane" is correctly withheld because `custody.hasEditor` is false —
> there genuinely was no editor to bring. Frames rendered; the text was unreachable, permanently.

**What falsified it.** This function, and the two call sites that reach it. The call site keeps the same
mechanism stated as the reason the function exists rather than as the bug it closed — without it a
`cool` followed by a `warm` still leaves a buffer whose frames render and whose text cannot be reached,
by exactly the route above. What moves is the record that it was found in review and ruled fixed rather
than filed. **Everything the brief for this pass named as live stays**: why `custody.hasEditor` is the
right gate and is complementary to the claim control by construction, why the text of record is seeded
rather than a build re-posted (with the `recompile` alternative that was weighed and declined), why the
claim is recorded before the mount and both happen on a pane that already exists, and why it cannot
mount twice.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-d, whole-branch review before merge.

### `pendingBinding`

**What the doc claimed.**

> **A SPLIT CARRIES THE SESSION THAT WAS PICKED, WHICH IS A CORRECTION TO WHAT THIS PARAGRAPH USED TO
> SAY.** It read "A SPLIT INHERITS THE SESSION OF THE PANE IT CAME FROM", true while a split had one
> possible outcome; the control is a menu of `(leg, session)` pairs now, so `split` below writes
> `choice.session` and the inherited case is the entry labelled `(same)` rather than the only entry
> there is.

**What falsified it.** The split control became a menu of `(leg, session)` pairs, so a split has more
than one possible outcome and `split` writes the session that was picked. The heading keeps its hook and
the current fact stays: what `split` writes, and that the inherited case is the `(same)` entry rather
than the only entry there is.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-b.

### `hostFor`

**What the doc claimed.** In the comment on the `focusin` listener, of how often `hostFor` is called:

> (This said "twice per call, in fact" of every
> leaf, which the creation pass's own `if (panes.get(l.id) !== undefined) continue` contradicts;
> harmless, since the early return above makes any number of calls register one listener, but it
> misdescribed the pattern.)

**What falsified it.** The creation pass's own early `continue`: a leaf that already has a pane is
reached once per gesture, not twice. The corrected count stays at the call site, along with the reason
the listener is wired on the creation branch rather than below the early return.

**Slice.** 5d-ii-b.

### `paneEvents`

**What the doc claimed.** In the comment on the wrapped `detach`:

> It read
> `if (slot.binding.session === LAMBDA_SCRATCH) custody.claim(LAMBDA_SCRATCH, id)` against
> `main()`'s one scratch-id constant.

**What falsified it.** 5d-ii-c decision 1 mints a buffer id per fork, so there is no scratch-session
constant left to compare against. The call site keeps the heading's hook and the live argument: why
comparing the binding before against after is what that comparison was really asking, and why the check
is made at all rather than assumed.

**Slice.** 5d-ii-c decision 1.

### `split`

**What the doc claimed.** Two records.

> **IT ENDS IN `focusPane` TOO NOW, AND THIS PARAGRAPH USED TO ARGUE THE OPPOSITE — IMPORTANT
> FINDING, REVIEW OF THE COMMIT THAT ADDED THE PICKER.** It read: a split leaves every control it was
> performed with in the DOM (`layoutControls` builds its buttons once and `renderLayout` MOVES hosts
> rather than rebuilding them), so there is no DESTROYED control to answer for, which is the
> condition `focusPane`'s doc states for its other callers; the `<body>` focus a split leaves behind
> — `renderLayout`'s `replaceChildren()` detaches the subtree the clicked button is in and the
> browser blurs it on the way out, then re-appends the same element unfocused — predates the picker
> and was the accessibility list's item 1 owed a rescue of its own.
>
> Surviving the gesture is not the same as answering it, and the distinction is the whole finding.

And of what the source pane's host used to hold:

> (It held
> `#link-status` too until deferred-a11y item 12; that element is app chrome outside every host now
> — `main.ts` records the argument at the `append`, and the rule this paragraph is about is exactly
> what took the status line out of the document when the source pane closed.)

**What falsified it.** The review of the commit that added the picker: a split's controls surviving in
the DOM is not the same as the gesture being answered, so the argument for leaving focus where it fell
was retracted and the handler gained its `focusPane` call. The finding itself, its attribution, and the
distinction it turns on all stay at the call site, along with the fact the retracted argument rested
on — that a split's own controls survive it. Deferred-a11y item 12 took `#link-status` out of the source
host, which leaves the host holding what the paragraph's live argument is actually about: the editor and
the close control.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-b, review of the commit that added the picker, Important; 5d-ii-c, deferred-a11y item
12.

### `rebind`

**What the doc claimed.** Of the test that pins the same-leg handover:

> `tests/browser/scratch-rebind-editor.test.ts` drives both rebinds now; it
> drove only the second, and two doc comments cited it as proof this state was impossible.

**What falsified it.** The test grew the scratch→scratch direction with the handover it pins, and the
two doc comments that cited it for a claim it did not support were rewritten where they stood
(`editor-custody.ts`'s own entries above carry that record). The call site keeps what the test drives
today, and the whole argument the handover rests on: why `setDetached` never fires for a scratch→scratch
rebind, why the sweep skips the pane, why decision 1 made the gesture reachable, and why the handover is
before `base.rebind` where `detach`'s wrapper acts after.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-c decision 1.

### `focusPane`

**What the doc claimed.**

> (This doc has been narrowed twice by its
> own wording — first "after a close", then "after a gesture that destroyed the control it was clicked
> with" — and the second was already too narrow for `split`, whose controls survive; see that handler's
> own doc for why surviving the gesture is not the same as answering it.

**What falsified it.** `split` became a caller whose controls survive the gesture, which the second
wording excluded. The opening sentence already states the current scope — every caller names a different
leaf, for the same reason — and it stays, as does the rule against counting the callers.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-b, review of the commit that added the picker.

### `applyLayout`

**What the doc claimed.** One record from the function's doc, and one from the comment on
`host.dataset.kind`.

> The reason this used to give for the clearing being
> merely belt-and-braces was "ids are minted once by `nextLeafId` and never reused within a page's
> life", AND THAT IS FALSE: `reset layout` re-mints `defaultLayout()`'s three literal ids, so an id
> genuinely can arrive here having been used before (`heldEditors` has the correction in full). What
> still makes a stale entry unreachable is timing rather than uniqueness — all three writers
> (`splitRow`, `splitColumn`, and `rebind`'s cross-leg arm) write the entry and call `applyLayout` in
> the next statement, so every entry is consumed by the pass that follows the write.

> (Stated without a count, deliberately — this
> said "three browser test files" and was four by the time the kind change shipped its own; the
> module doc above makes the same argument about restating an arity.)

**What falsified it.** `reset layout` re-minting `defaultLayout()`'s three literal ids, which makes id
reuse ordinary rather than impossible; and the kind change shipping a fourth browser test that selects
on `data-kind`. Both corrections stay as the current claim: the clearing is belt-and-braces because
every entry is consumed by the pass that follows the write, not because ids are unique, and the
attribute's justification is stated without a count.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-b; 5d-ii-d, re-review of the whole-branch custody fix, Minor.

---

## `web/src/main.ts`

### `leafCounter`

**What the doc claimed.** Of what reasoning only about `defaultLayout()` costs:

> **REASONING ONLY ABOUT `defaultLayout()` IS EXACTLY THE BLIND SPOT THIS COMMENT USED TO HAVE**, and
> it cost the first split after every reload: `main()` restores a tree from `localStorage` when there
> is one, that tree can already contain `lambda-1` from a split in an earlier page load, and
> `splitLeaf`'s collision guard then refuses the id `nextLeafId` mints — an uncaught throw out of the
> click handler, no new pane, and nothing on screen to say why. (A SECOND click worked, because the
> refused attempt had still incremented this. That is the shape of the bug, not a mitigation.)

**What falsified it.** `seedLeafCounter`, which is called on the tree `main()` actually starts with. The
comment no longer has the blind spot, so the account of it having had one — and the second click that
appeared to work — is a fact about the comment rather than about the counter. The call site keeps the
same mechanism stated as the reason `seedLeafCounter` exists rather than as the bug it closed: a restored
tree can already contain `pane-1`, and `splitLeaf`'s collision guard then refuses the id `nextLeafId`
mints. The quoted paragraph says `lambda-1` and the call site said so too until the whole-branch review
before merge; `nextLeafId` mints `` `pane-${leafCounter++}` ``, so a restored `lambda-1` advances the
counter through `seedLeafCounter` but is not an id this app can mint twice. `pane-1` is.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-a.

### `sessions`

**What the doc claimed.** Three records, in the order they stood in the doc — the first stated in full,
the second and third each retracting part of it.

> IT IS A `SessionRegistry` FROM `sessions.ts` NOW, NOT A `Map` DECLARED HERE, and the move is what
> this task's test costs rather than a tidy-up. T7's claim is that two panes bound to two different
> λ sessions show two different terms at the same time, and nothing in this slice can put a second
> session in this registry: a `LambdaScratch` needs a worker message `session-worker.ts` does not
> have, and creating one on edit is §4.3, which is T8. A registry that is a module is a registry a
> test can put two sessions in. `SessionRegistry`'s own doc carries the argument in full.

> **T8 HAS LANDED AND THE APP CAN NOW HOLD TWO, WHICH RETIRES THE SECOND HALF OF THE PARAGRAPH
> ABOVE BUT NOT THE FIRST.** The λ pane's fork control registers a second entry (`scratchpad`
> below, `scratch.ts`), so the selector this app draws is no longer hypothetical. The reason the
> registry is a module survives it: how many sessions a fork produces must be asserted on POOL SIZE,
> which is not reachable from the DOM, and this app has ONE λ pane — so "two panes on two λ
> sessions" still cannot be performed here, whatever the registry can hold.

> **T12 (5d-ii-a) RETIRES THE LAST CLAUSE TOO.** `applyLayout` (`pane-host.ts`) can now put a second
> `'lambda'`-kind pane on screen from a layout split, and the binding selector already lets either
> one point at a different registered session — so "two panes on two λ sessions" is mechanically
> reachable through the UI, not only through `tests/node/sessions.test.ts`'s hand-built panes. What
> survives is the reason the registry is a module: HOW MANY SESSIONS A FORK PRODUCES is still
> asserted on pool size, which no DOM query reaches regardless of how many panes exist to watch it.

**What falsified it.** 5d-i's T8 gave the λ pane a fork control that registers a second entry, which
retired "nothing in this slice can put a second session in this registry"; 5d-ii-a's T12 gave
`applyLayout` a second `'lambda'`-kind pane, which retired "this app has ONE λ pane" and made two panes
on two λ sessions reachable through the UI rather than only through `tests/node/sessions.test.ts`. What
each round said survives is the same thing, and it is what stays at the call site: the registry is a
module because how many sessions a fork produces is asserted on POOL SIZE, which no DOM query reaches —
with `SessionRegistry`'s own doc carrying the argument in full, and 5d-ii-c decision 1's change to the
number that assertion expects.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-i T7/T8; 5d-ii-a T12.

### `LAMBDA_SCRATCH` — the constant this file no longer declares

**What the doc claimed.** Of the λ scratch id and label, in the `//` block that stands where they used to
be declared:

> **THE λ SCRATCH ID AND LABEL USED TO BE DECLARED HERE, AND THEY ARE NOT ANY MORE.** They read
> `const LAMBDA_SCRATCH: SessionId = 'lambda-scratch'` / `'λ scratchpad'`, named in this file for the
> reason `SessionEntry.label`'s doc gave: `main.ts` names the app's sessions and `sessions.ts` never
> does. 5d-ii-c decision 1 makes a fork mint a buffer per call, so there is no fixed name for this
> file to write down before the session exists — `ScratchBuffers.fork` mints id and label together,
> and `SessionEntry.label`'s doc now draws the line where it was always really drawn: a session is
> named where it is CREATED, never in the registry that holds it.

And of why that block is a `//` block:

> A `//` BLOCK RATHER THAN `/** */`, WHICH IS THE WHOLE OF WHY THIS PARAGRAPH WAS REWRITTEN: it
> documents a declaration that is GONE, and a doc comment with nothing under it is read as documenting
> whatever comes next — here `let draw`, which it says nothing about. Two consecutive `/** */` blocks
> before one symbol is the shape that made it noticeable.

**What falsified it.** 5d-ii-c decision 1 makes a fork mint a buffer per call, so there is no fixed name
for this file to write down before the session exists — which took the two constants and, with them, the
reason they were spelled out here. The rewrite that turned the block from `/** */` into `//` is a fact
about the comment rather than about the code, and the shape that made it noticeable is spent. The call
site keeps every current consequence: that this file declares neither, that `ScratchBuffers.fork` mints id
and label together, that a session is named where it is CREATED, that the label is still what the binding
selector puts in front of a user, and that this is a `//` block because it documents a declaration that is
gone.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-c decision 1.

### `pool`

**What the doc claimed.** Of the local that used to hold the source session's worker:

> THE `worker` LOCAL IS GONE, AND IT WAS THE LAST PIECE OF A SESSION LIVING OUTSIDE ITS ENTRY. The
> task before this one gave an entry its own legs and its own client but left `main()` holding a
> `Worker` handle and its `error` listener beside them, because spawning is this task's. A
> session's thread is now created where its client is and dies where its client does.

**What falsified it.** Nothing — the paragraph is accurate. It is a record of what `main()` stopped
holding and of how two 5d-i tasks divided the work between them, neither of which is a fact about the pool
as it now stands. The conclusion stays at the call site: a session's thread is created where its client is
and dies where its client does.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-i.

### `scratchpad`

**What the doc claimed.** Of the reply callback this call site passes:

> IT NAMES THE BUFFER THE REPLY CAME FROM, WHICH IS WHAT THIS LINE USED TO HARD-CODE. It read
> `replies.onScratchReply(LAMBDA_SCRATCH, reply)`, correct while one id was the only one a buffer
> could have; `ScratchBuffers` curries each buffer's own id in at `pool.bind`, so the name arrives
> with the reply and this file no longer has one to supply.

**What falsified it.** 5d-ii-c decision 1: a fork mints a buffer per call, so one id stopped being the
only one a buffer could have and the hard-coded name went with it. The heading keeps its hook and the
current fact stays — `ScratchBuffers` curries each buffer's own id in at `pool.bind`, so the name arrives
with the reply and this file no longer has one to supply.

**Slice.** 5d-ii-c decision 1.

### `sessions.add`

**What the doc claimed.** Two records.

> **THIS SENTENCE ENDED "and retired by the next recompile"** until that decision deleted
> the first of the two implicit retires (`compile.ts` records what went with it); it then read "today
> that is `replies.ts`'s phantom-fork `no-session` and nothing else" until the second went too
> (`replies.ts`'s own `no-session` arm records that one); and it then said the app could create
> buffers and end none, which was the deliberate window §4.2's list closes — so that "what ends a
> buffer" landed as one reviewable change rather than as a residue of two, and knowingly, since §4.4
> makes that list the poison recovery as well as the ordinary way out.

And of what the binding selector used to be said to do:

> **THE SELECTOR IS ON SCREEN FROM THE FIRST PAINT, AND THAT REVERSES WHAT THIS COMMENT USED TO
> SAY** — it read "the selector has one option to offer until someone forks — which is why
> `bindingSelect` renders nothing on a fresh page and appears the moment there are two." That was
> true of a control listing SESSIONS.

**What falsified it.** 5d-ii-c decision 2 deleted `compile.ts`'s recompile-from-source retire and then
`replies.ts`'s phantom-fork `no-session` retire, and design §4.2's header list closed the create-but-never-end
window the two deletions opened between them — so each of the three readings of that sentence is spent and
the current one is what stays: a buffer ends only where `ScratchBuffers.retire` is called, which is the
header list's retire handler and nothing else in `src/`. And 5d-ii-b replaced `bindingSelect` with
`paneSelect`, which lists `(leg, session)` PAIRS rather than sessions, so the source entry contributes two
pairs on its own; the call site keeps the current claim that the selector is on screen from the first
paint and the reason it is.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-c decision 2; 5d-ii-b; 5d-ii-d design §4.2.

### `buffers` — the row builder's `term`

**What the doc claimed.** Of why `legOf` could be asked unbranched:

> It read: *"`legOf` CANNOT THROW HERE, AND THE REASON IS THE GOVERNING RULE
> RATHER THAN AN ASSUMPTION: a buffer is in `#buffers` and in the registry together or in
> neither, because `#reg.remove` and `#buffers.delete` appear exactly once in `src/` and both
> are inside `retire`."* 5d-ii-d design §4.2 makes that false by construction — a cold buffer is
> in `#buffers` and in neither container — and `SessionRegistry.entryOf` throws for an id it
> does not hold (`sessions.ts`'s `entryOf`, deliberately: a binding naming a session the
> registry does not hold "is a wiring bug, not a state the UI has an honest rendering for").

**What falsified it.** Cold buffers. Design §4.2 puts a buffer in `#buffers` and in neither container, so
the together-or-in-neither rule the unbranched call rested on is false by construction — the same
retraction `scratch.ts`'s `#buffers` entry above records from the other side. The call site keeps every
current consequence: that `legOf` is asked only for a warm buffer, that `SessionRegistry.entryOf` throws
for an id it does not hold and why that is deliberate, what the unbranched version cost on the first open
of a list on a page that restored an orphan, and why the branch is on `warm` rather than on a `try`.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-d T4, design §4.2.

### `compile`

**What the doc claimed.** Of two sentences in its own doc, and of the commit that falsified them:

> **BOTH SENTENCES ABOVE WERE FALSIFIED BY THE COMMIT THAT WIRED THAT HANDLER, WHICH IS WHY THE
> CORRECTION IS ITSELF RECORDED.** They read "what has not yet replaced it" and "`applyLayout`, the one
> caller left" — while the same commit was editing `compile.ts` to say the sweep had gained a second
> caller, and adding that caller ninety-odd lines above this paragraph. A file can contradict itself
> across two of its own paragraphs in one diff, and this is the instance that proves it: the sweep for
> stale citations ran over every file that named the missing retire and missed the file that supplied
> it.

**What falsified it.** Nothing — the paragraph is accurate. It is the record of a correction to two
sentences that already stand corrected in the doc above it, and of how a stale-citation sweep missed the
file it was run from; neither is a fact about what this call site passes. The corrected sentences stay
where they are: a recompile ends no buffer, this call site shrank with the signature, and the custody
argument lives at `editor-custody.ts`'s `reconcileEditors` and at its callers — `applyLayout`, and the
buffer list's retire handler above it in this file.

**Slice.** 5d-ii-c decision 2; 5d-ii-d, the commit that wired the header list's retire handler.

### `replies`

**What the doc claimed.** Of the `editorHome` dependency, which used to be bound to one session:

> **IT TAKES THE REPLY'S OWN SESSION, WHERE IT USED TO BE BOUND TO ONE.** This read `() =>
> custody.homeFor(LAMBDA_SCRATCH)` and argued that `onScratchReply` "is only ever invoked with
> `LAMBDA_SCRATCH`", so binding it here saved threading a `SessionId` through every call site in
> `replies.ts`. 5d-ii-c decision 1 removes the constant that sentence rested on; both call sites
> over there already hold the session the reply named, so the parameter costs nothing it was
> avoiding.

**What falsified it.** 5d-ii-c decision 1 removed `LAMBDA_SCRATCH`, so the argument that binding the
dependency to it saved threading a `SessionId` lost its subject. The heading keeps its hook and the live
half stays: both call sites in `replies.ts` already hold the session the reply named, so the parameter
costs nothing — and this file keeps it where `compile.ts` takes nothing of the kind, because `replies.ts`
has two uses that are not retires.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-c decision 1.

### `refreshBuffers` — the start-up call's position

**What the doc claimed.** The two of the three rejected positions that produced a `TypeError`, quoted from
the authoritative account at the call site.

> **POSITION 1 — RIGHT AFTER `refreshBuffers`'S OWN DEFINITION, WHERE THIS CALL USED TO LIVE. THE
> ORIGINAL CRITICAL.** `linkWiring`, `draw` and `view` are all still `undefined` there (three `let`s,
> none assigned until further down `main()`), and `refreshBuffers()` reaches `persistBuffers()`
> reaches `writeBuffersStorage()`, whose `catch` calls `reportStorageFailure()` when `hasBuffers` is
> true — which calls `linkWiring.setForkFailed(...)` and then `draw()`, and `draw()`'s own body
> unconditionally dereferences `view()` too (`draw.ts`: both branches of its one `if` call
> `view().dispatch(...)`). A FRESH page's first write is provably `hasBuffers === false`
> (`writeBuffersStorage`'s own doc), so calling this at position 1 was safe for every browser test in
> this suite, all of which mount onto empty storage — but a page that RESTORED buffers
> (`scratchpad.restore(...)` above already ran) has real buffers in the payload at this exact call,
> and a write failure there called `linkWiring.setForkFailed(...)` on an `undefined` `linkWiring`: a
> bare `TypeError`, uncaught by `writeBuffersStorage`'s own `catch` (the throw happens INSIDE that
> catch's body), propagating out of `main()` and killing the whole page — for exactly the user this
> feature exists to protect.

> **POSITION 2 — RIGHT AFTER `draw = createDraw(...)`, WHERE `linkWiring` AND `draw` ARE BOTH REAL.
> STILL NOT FAR ENOUGH.** `draw()`'s own body (`draw.ts`) calls `view().dispatch(...)`
> unconditionally, on both branches of its one `if` — there is no path through `draw()` that avoids
> dereferencing `view()` — and `view` is not assigned until the `EditorView` construction a little
> further down `main()`. Calling `reportStorageFailure()` — and therefore `draw()` — from a write
> that failed at position 2 would trade one `TypeError` (on `linkWiring`, the original Critical) for
> another (on `view`, inside `draw()`). Measured, not reasoned: this is exactly the failure a first
> attempt at this fix produced, caught by `tests/browser/buffers-quota-restored.test.ts` before it
> ever reached review.

**One correction inside those two blockquotes, left in the quotes because they are quotations.** Both say
"both branches of its one `if`" of `draw.ts`. `draw.ts` has TWO `if` statements — a single-statement one
inside the render loop, which does not touch `view()`, and the focus `if`/`else` near the end of `draw()`,
which is the one meant. Both branches of that `if`/`else` do call `view().dispatch(...)`, so the claim the
two positions rest on — no path through `draw()` avoids dereferencing `view()` — holds exactly as stated.
Only the arity is wrong, and it was wrong in `main.ts` before this slice moved the paragraphs.

**What falsified it.** Nothing — both accounts are accurate, and that is why only these two moved. They
are the record of where the call used to sit and of what a first attempt at moving it cost; neither is a
fact about where it sits now. Everything a reader needs in order not to reorder `main()` and reintroduce
the start-up crash stays at the call site, in full: the statement of the order that holds and why
(`linkWiring`/`draw`/`view` are all real, assigned values by that line, so `reportStorageFailure` can
safely call `setForkFailed` and `draw()`, and `draw()` can safely call `view().dispatch(...)`), the
argument that the move changed WHEN the write happens and not WHAT it writes, the `panes` consequence the
move did change, and the "WHAT WOULD BREAK THIS" list that names every edit that would undo it.

**POSITION 3 STAYED, DELIBERATELY, AND IT IS THE ONE THAT PRODUCED NO `TypeError`.** Its body is NOT the
file's only statement of the mechanism the surviving order depends on — `storageFailureReported`'s own doc
(search this file for "ONCE PER PAGE LOAD") already states the general rule, that `compile.ts`'s `schedule`
calls `setForkFailed(null)` UNCONDITIONALLY on every invocation and the source editor's own
`updateListener` schedules on every keystroke, but that statement is about a USER KEYSTROKE and never
touches the start-up compile. What position 3's body is the file's only statement of is the mechanism's
APPLICATION to the app's own `compile.schedule(SAMPLE)` — nothing else in the file connects the two — so
"ordering this call after `compile.schedule(SAMPLE)`" and the `compile.schedule(SAMPLE)` clause of "WHAT
WOULD BREAK THIS" both resolve to an argument only that paragraph makes. Moving it would have taken the
reason the order holds with it.

Three passages pointed at the positions by number rather than restating them (5d-ii-d review round 2,
Minor B reduced four copies of the argument to one), and each was repaired to name this entry where it
named a position that moved. Their pre-move text, in the order they stand in the file:

> **NOT CALLED HERE ANY MORE, AND THAT WAS A CRITICAL.** This used to be the very next line, and
> `linkWiring`/`draw`/`view` are all still `undefined` at this point in `main()` — a restored page's
> first buffers write, refused, threw a bare `TypeError` out of `main()` and killed the page. The
> call is still made, unconditionally, on every page load; it has just moved past all three
> assignments and past the app's own initial `compile.schedule(SAMPLE)`. See that call site's own
> comment (search this file for "AUTHORITATIVE ACCOUNT OF WHY") for the full argument, including why
> two OTHER positions between here and there were tried and rejected first.

> NOT the refreshBuffers() start-up call's home either, though linkWiring/draw are real by here:
> `view` still is not. See the call site's own comment (search this file for "AUTHORITATIVE ACCOUNT
> OF WHY") for the full argument — this position is that comment's "POSITION 2".

> Three positions were tried or considered
> before this one and each was wrong for a different reason (below).

The first of the three keeps its own account of position 1 at the site it warns about — it is the
site-local statement that the call must not go back there, and 5d-ii-d review round 2, Minor B had already
reduced it to that. Only its closing cross-reference changed.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-d — design §4.8's storage-failure report and the Critical its first position produced;
review round 2, Minor B.

---

## `web/src/buffer-list.ts`

### `BufferRow.term`

**What the doc claimed.** Of what the list read before this field existed:

> **EIGHT ROWS READ `scratch 1 — orphan` THROUGH `scratch 8 — orphan` AND NOTHING ELSE.** Found by
> opening the list on a real page at the cap: every row was a counter's output and a pane count, and
> at the cap every pane count is the same too.

And the two cross-references that counted those rows. One from the `term` element's own doc inside
`bufferRow`, in the same file:

> The buffer's term, under its name — see `BufferRow.term` for why a row without it is eight rows the
> user cannot tell apart.

The other from `main.ts`'s row builder, where the `term` property is joined — a pointer across a file
boundary, and the one the pass missed, because the sweep that found the sibling ran per file:

> **THE ROW'S ONE DISTINGUISHING FACT, JOINED HERE FOR `paneCount`'s REASON** — see `BufferRow.term`
> for what the list looked like without it (eight rows reading `scratch N — orphan`, under a refusal
> telling the user to pick one).

**What falsified it.** 5d-ii-d T8 raised the cap from 8 to 11, so eight is no longer the number of rows
a full list draws and `scratch 8` is no longer the last name `#minted` can reach — the observation is a
reading taken on a page the app cannot produce any more, and where it was taken is a fact about how the
field came to exist rather than about the field. Everything the observation argues stays at the call
site, stated as the reason the field is there rather than as the state it was found in: a row without a
term is a counter's output and a pane count, at the cap every pane count is the same too, the one
gesture the list exists for is *choose a buffer and end it* and a user reaching it under a refusal has
just been told they must choose, `label` is `scratch N` BY CONSTRUCTION so no amount of naming fixes it,
and the distinguishing fact is what the buffer HOLDS.

The surviving prose was repaired where it referenced the moved text; the pre-move original is quoted
above in full.

**Slice.** 5d-ii-c design §4.2, where the field and the observation were written; the count retired by
5d-ii-d T8.
