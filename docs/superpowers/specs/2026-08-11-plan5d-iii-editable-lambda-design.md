# 5d-iii — the editable λ scratchpad: the slice 5d-i's own split forgot to assign

## §1 What is being built, and why it is a third slice rather than part of either neighbour

5d-iii makes a **detached λ pane editable**. A fork already produces a scratch session that runs
independently, binds to a pane and badges itself (5d-i, PR #34); what nobody can yet do is change its
text. This slice is the text box, the recompile behind it, and the fork mechanism that has to change
to make either honest.

**IT EXISTS BECAUSE 5d-i's §1 SPLIT LEFT IT UNOWNED, AND THAT IS RECORDED RATHER THAN TIDIED AWAY.**
The roadmap's Plan 5 entry promises *"5d makes the λ and TM panes editable with detach-on-edit."*
5d-i's §1 split 5d into the session model (5d-i) and the pane multiplexer (5d-ii). Neither owns making
a pane editable, so the capability fell between them and surfaced only when 5d-i's T8 reached for
§4.3's trigger and found no surface to trigger on. 5d-i's own §6 filed the gap and said it *"needs a
home before 5d closes"*. This is that home.

**5d-ii IS STILL THE MULTIPLEXER AND IS UNAFFECTED.** Add/remove panes, layout and persistence remain
5d-ii's, and the accessibility pass remains gated on 5d-ii — see §6. This slice changes what is inside
one pane, not how many panes there are.

**λ ONLY. THE TM HALF IS A NAMED SLICE, FILED AT THE SAME TIME AS THIS ONE SHIPS.** See §6.1. Filing
it is a requirement of this slice rather than a courtesy, for the reason this slice exists at all: the
last unnamed capability fell between two slices and nobody noticed for a whole PR.

## §2 The five decisions

Restated in one line each, so a plan need not read two documents:

1. **λ now; the TM editable pane is its own named slice**, filed in the roadmap as part of this work
   rather than left as a gap (§6.1).
2. **A detached λ pane has a split body**: a CodeMirror editor above, the frame renderer below, with a
   control that collapses the editor away. Both visible by default, because seeing a term and what it
   reduces to at once is what a scratchpad is for.
3. **The seed is the term at the step you forked from, re-derived at full fidelity** — not the
   512-byte frame on screen, and not step 0.
4. **The editor exists only on a detached pane.** `✎ fork` stays the trigger. This is a deliberate
   deviation from the roadmap's "detach-on-edit" wording; §3.2 is the reason.
5. **Editing recompiles the scratch**, on the same 300 ms debounce the source pane uses, over the
   `lambda-scratch` message exactly as it already exists.

## §3 What verification established before any code was written

### 3.1 THE FORK IS UNAVAILABLE FOR MOST NON-TRIVIAL TERMS TODAY, AND THAT IS THE REAL LIMITATION

`LambdaPane.#refreshDetach` (`web/src/lambda-pane.ts:175-178`) offers the fork only when
`frame.cut === null`. `detachButton`'s doc states the correctness reason and it is right: a `Bytes`
cut is a prefix that will not parse, and a `Depth` cut is not even a prefix, so seeding from either
would answer `no-session` with a diagnostic **or worse, parse into a different term**.

What makes this the limitation rather than a corner case is the budget it is measured against.
`lambda-pane.ts:21-26` records it in as many words:

> `frame_cost_probe` measured a history frame's budget at 512 bytes, two orders below the readout's,
> so most non-trivial terms **WILL** truncate here.

So the control §4.3 of 5d-i calls its trigger is dark exactly when a user most wants a scratchpad.
**An editor inherited from that rule would ship the gesture without the capability a second time**,
which is the shape of gap this slice exists to close.

### 3.2 THE FULL TERM AT STEP k IS NOT STORED ANYWHERE, SO IT MUST BE RE-DERIVED EITHER WAY

Two budgets, and only one of them is retained per step:

| path | budget | where |
| --- | --- | --- |
| history frames | `FRAME_BYTES` = 512 | `session-worker.ts:273`, `:293` |
| the readout / link window | `LAMBDA_BYTE_BUDGET` = 65,536 | `session-worker.ts:404`, `:451` |

The full-fidelity print exists **only in the `compiled` reply — step 0 only**. Nothing requests it
mid-run, and the worker's live session cannot supply it retroactively: **history is a main-thread
replay and the worker is already at the end of the run.** By the time a user scrubs back to step 7 and
clicks, the worker's `Session` is at step 40 and stepping is not reversible.

**This is what makes decision 3 cheap rather than extravagant.** A "give me the full text at step k"
message would have to replay from 0 to k inside the worker anyway. Doing that replay *inside the
scratch being created* costs the same reduction and saves the print/parse round trip that a
text-fetch design would add on top.

**IT IS ALSO WHY DECISION 4 GOES THE WAY IT DOES.** An editable region on an *attached* pane would
have to hold the current term at all times, so the replay would move from click time to **every scrub
tick** — at 4–7 µs/step, a scrub to step 50,000 is ~0.2–0.35 s of replay per tick. The cost is
mitigable with caching and debounce, but the trade is a one-off cost turned into a per-frame one, in
exchange for matching a wording. The wording loses, loudly, here in §2 and again in §6.

### 3.3 EVERY MACHINE THIS SLICE NEEDS ON THE WIRE ALREADY EXISTS, EXCEPT ONE FIELD

Verified at HEAD rather than assumed:

- `{ kind: 'lambda-scratch'; gen; src }` — `protocol.ts:286`. Carries the seed today.
- `{ kind: 'scratch-compiled'; gen; lambda }` — `protocol.ts:333`. The one-leg reply.
- Diagnostics for unparseable scratch text **share the existing `diagnostics` reply**, and
  `protocol.ts:310-314` records the reuse and its reason: `lambdaScratch(src)` answers
  `{ diagnostics, scratch: null }`, and a `no-scratch` variant "would be two names for one state".
- `LambdaScratchpad.detach` / `.retire` — `scratch.ts:132`, `:196`. The singleton and the retirement
  order, both already tested.
- `SessionClient.scratch(gen, src)` — `session-client.ts:80`, supersede-then-post.
- Four CodeMirror `StateField`s for decorations — `highlight.ts`.

**The one addition is a `step` field on the request.** §4.1.

### 3.4 A DETACHED PANE ALREADY DECLINES TO PARTICIPATE IN LINKING, SO THE EDITOR INHERITS NOTHING

`DetachedPanes` (`link-status.ts:48`) and its narration (`:134-137`) already handle a detached λ pane,
and `session.rs` puts `linkIndex` and `sourceSpan` off the scratch types entirely (5d-i §3.3). So
there is no link machinery for the editor region to interfere with, and the `data-at` click handler in
the frames region below stays exactly as written — dead on a scratch, which is already true today.

## §4 The design

### 4.1 THE FORK BECOMES TWO REDUCTIONS IN ONE MESSAGE

`lambdaScratch(src)` builds a scratch from λ **text**. For the scratch's step 0 to *be* the term that
was forked — which is what `pane-chrome.ts:111` means by "fork the term I am looking at" — the text of
that term has to exist. §3.2 establishes it does not. So the worker derives it:

```
tmp     = lambda_scratch(src)             // src = the source's step-0 text, already at 64 KiB
tmp.step_lambda() × step                  // replay to the term that was on screen
text    = tmp.lambda_state(64K).text      // full fidelity — NOT the 512-byte frame
scratch = lambda_scratch(text)            // THE scratch: its step 0 is that term
```

The request gains one field and the reply gains one:

```
{ kind: 'lambda-scratch'; gen: number; src: string; step: number }
{ kind: 'scratch-compiled'; gen: number; lambda: LambdaStatus; text: string | null }
```

`text` travels back so `main.ts` can seed the editor **from the same string that created the scratch**,
rather than from a second print that could disagree with it.

**`text` IS NULLABLE FOR EXACTLY THE CASES THE SCRATCH IS**, and the two are the same fact rather than
two: no scratch was built, so there is no string that built one. Unparseable text and a term over
budget both land here. A non-null `text` beside a null scratch would be a fourth thing for a renderer
to switch on, which is the redundancy `protocol.ts:310-314` already refused for `no-scratch`.

**THE DOUBLE PARSE IS THE POINT, NOT THE PRICE.** The second `lambda_scratch(text)` is what makes the
editor's contents, the scratch's step 0, and the term the user was looking at one object instead of
three that agree by construction until they do not. It also puts the whole path through
`lambda/syntax.rs`'s round-trip guarantee, which is the guarantee the rest of this codebase already
leans on.

#### 4.1a THE SEED STOPS BEING THE PANE'S OWN TEXT, WHICH REVERSES A DECISION DOCUMENTED IN THE TREE

**Found in spec self-review, and recorded rather than absorbed** — 5d-i's decision 6 set the precedent
for amending a contradicted comment instead of leaving two places asserting opposite things.

`PaneEvents.detach` is `(text: string) => void` today, and `pane-chrome.ts:32-34` states the rule:

> THE TEXT IS THE PANE'S, NOT A LOOKUP. §4.3 seeds the scratchpad with "that pane's current text", and
> the pane is what has it.

That rule was correct for a seed that *was* the rendered frame. It cannot survive §4.1, because the
inputs are now the **source's step-0 text** — which lives in the `compiled` reply that `main.ts` holds,
not in the pane — and the **step**, which the pane also does not own (`History` does). So:

```
detach?: (step: number) => void      // was: (text: string) => void
```

The pane reports **which step it is showing**; `main.ts` supplies the step-0 text from the compiled
reply and calls `scratch.detach(slot, src, step)`. `pane-chrome.ts`'s comment must be amended in the
same commit that changes the signature.

**IT IS STILL NOT A LOOKUP, WHICH IS THE HALF OF THE OLD RULE THAT SURVIVES.** The pane does not go
looking for a term; it reports a fact it owns and the caller resolves it. What changed is which fact is
the small one.

**THE LINK-VIEW HAZARD SURVIVES INTACT AND MUST BE RE-CHECKED, NOT ASSUMED.** `lambda-pane.ts:77-83`
refuses to fork from the link window because its text is a slice of a *different* program's print in a
different coordinate system. Under the new signature the pane passes a step rather than that text, so
the old guard no longer applies by construction — **the pane must still decline to fork while a link
window is showing**, because the step it would report is its own leg's while the body on screen is not.

**`step == 0` IS A FREE TEST OF THE ENTIRE PATH.** The replay is a no-op and the two `lambda_scratch`
calls must produce the same term from the same text, so the round trip is exercised by the most
ordinary fork a user can perform.

**A TERM CAN STILL BE TOO LARGE TO FORK, AND THE REFUSAL MOVED RATHER THAN VANISHED.** If the term at
step k does not fit in 64 KiB, `text` is a cut and the second `lambda_scratch` gets a prefix. That is
§3.1's failure at 128× the budget, not its elimination. The worker answers `scratch: null` with a
diagnostic saying so, and the pane keeps offering `✎` — the user can scrub to a smaller step and fork
there, which is a real remedy rather than a dead control. §4.5's standard is satisfied because the
control *can* work; it is this particular step that cannot.

### 4.2 THE SPLIT BODY, AND WHAT COLLAPSES

A detached λ pane's body is two regions:

```
┌─ lambda [detached]     [⌃] ──┐
│ (\x. x x) (\y. y)            │  CodeMirror, editable, full term
├──────────────────────────────┤
│ \y. y                        │  today's <pre> frame renderer, unchanged
│ [↺][◀][▶][⏵] 3/7             │
└──────────────────────────────┘
```

An **attached** pane is unchanged from today: one `<pre>`, the `✎ fork` control, no editor region.

**THE COLLAPSE IS A CLASS ON THE PANE, NOT A SECOND RENDERING MODE.** `collapseButton` in
`pane-chrome.ts` follows that file's stated added-and-removed idiom and toggles a class; the frame
renderer below is untouched and never learns it has more room. One code path, so there is no second
body state for `renderLink` and `#redraw` to disagree about.

**THE STATE IS NOT PERSISTED.** It lives in `LambdaPane` for the pane's lifetime. A scratch is retired
by the next recompile-from-source, so a persisted collapse preference would outlive every session it
described.

**THE EDITOR REGION IS MOUNTED AND UNMOUNTED, NOT HIDDEN** — the same reason `detachedBadge` gives at
`pane-chrome.ts:66-71`: `hidden` leaves the CodeMirror instance in the DOM and alive, and §5 asks for a
test that reattaching a pane *removes* the editor. Removal is what makes that question have one answer.

### 4.3 EDITING RECOMPILES THE SCRATCH, OVER THE MESSAGE THAT ALREADY EXISTS

An `EditorView.updateListener` on `docChanged` schedules a recompile at `DEBOUNCE_MS` (300 ms) — the
source pane's own constant, because it is the same gesture at the same speed. The recompile is:

```
client.scratch(client.supersede(), editorText)   // step: 0
```

**THAT IS THE `lambda-scratch` MESSAGE UNCHANGED.** An edit is a fork from step 0 of the text in the
box, which is exactly what the request already means with the field §4.1 adds set to its identity
value. Supersede-then-post, the pattern `main.ts`'s `schedule` and `scratch.ts:158-161` both use and
for the stated reason: a claim after a post is a message the client drops.

**RECOMPILE-FROM-SOURCE STILL RETIRES THE SCRATCH AND TAKES THE EDITOR WITH IT.** §4.3 of 5d-i is
explicit that this is the same mechanism as poison recovery, and it terminates the worker. The text in
the box is lost. **Said plainly rather than mitigated**: a confirmation prompt would be a second policy
about a session's lifetime, in a slice whose neighbour just established the first one.

### 4.4 DIAGNOSTICS ARE PUSHED, NOT PULLED

The source editor's `linter` (`lint.ts`) is pull-based — it calls `analyze` synchronously. A scratch's
diagnostics arrive from a worker reply, so the editor region uses `@codemirror/lint`'s `setDiagnostics`
transaction rather than a `linter` extension. `lintGutter` is shared.

**IT IS THE EXISTING `diagnostics` REPLY, NOT A NEW ONE**, per `protocol.ts:310-314`'s recorded reuse.
An edit that does not parse leaves the frames region showing the last good run and puts the diagnostics
in the gutter — the source pane's behaviour, and the only one that does not blank a user's output while
they are mid-identifier.

### 4.5 MODULE SPLIT

| file | change |
| --- | --- |
| `web/src/lambda-editor.ts` | **new** — the CodeMirror instance, the debounce, push-diagnostics |
| `web/src/lambda-pane.ts` | the editor region, mounted only when `#detached` |
| `web/src/pane-chrome.ts` | `collapseButton` |
| `web/src/protocol.ts` | `step` on the request, `text` on the reply |
| `web/src/session-worker.ts` | §4.1's replay |
| `web/src/scratch.ts` | `detach(slot, src, step)`; a `recompile(src)` for the edit path |
| `crates/redextape-wasm/src/session.rs` | the step-k-then-print path and its refusal |

**`lambda-editor.ts` IS ITS OWN MODULE FOR THE REASON `scratch.ts` IS.** `lambda-pane.ts` is 289 lines;
a CodeMirror instance, a debounce timer and a diagnostics channel would put it past 450 and mix a
document surface into a file whose whole job is `(frame, controls) -> DOM`.

**THE WORKER GETS THE REPLAY AND NOTHING ELSE, WHICH IS `scratch.ts:66-69`'s RULE APPLIED AGAIN.**
`vite.config.ts` excludes `session-worker.ts` from the coverage include set for a measured
instrumentation reason, so logic placed there moves none of the four numbers. §4.1's replay belongs
there anyway — it is the wasm call sequence, which is exactly what that rule says the worker should
hold. The **policy** around it (when to fork, at which step, what to do with a null `text`) stays in
`scratch.ts` and `lambda-editor.ts`, where the gate can see it.

**`recompile(src)` GOES ON `LambdaScratchpad` RATHER THAN BEING A DIRECT `client.scratch` FROM THE
EDITOR.** The editor would have to reach the pool and the registry to find its own client, which is the
coupling `scratch.ts`'s doc removed from `main()`. One type owns the scratch session's lifetime:
create, recompile, retire.

## §5 Testing

**Node** — `lambda-editor.test.ts`: the debounce coalesces, a change posts exactly one recompile, the
collapse toggles the class and mounts/unmounts the instance. `scratch.test.ts` extended: a fork at
step k posts `step: k`, and the singleton still holds across two forks at two different steps. A null
`text` beside a null scratch leaves no editor mounted (§4.1's nullability, both arms).

**The link-window refusal is a test in its own right (§4.1a).** A pane showing a link window must
offer no fork — under the new signature nothing about the step it would report is wrong, so this is
guarded by a rule rather than by construction, and a rule with no test is the gap `#refreshDetach`
used to close for free.

**Browser** — `scratch-fork.test.ts` extended: fork at a step whose frame is **truncated**, and assert
the editor holds an untruncated term while the source's step count keeps advancing. New: edit the
scratch, assert the frames region below changes and the source's does not. New: reattach and assert the
editor region is **removed** from the DOM, not hidden (§4.2).

**Rust** — `session.rs`: the step-k-then-print path, and the >64 KiB refusal answering `scratch: null`
with a diagnostic.

**MUTATION DISCIPLINE, CARRIED FORWARD FROM 5d-i's HARDEST-WON RULE:** every mutation this slice
proposes must predict a **COUNT** of failing tests, not just a name, and the count is verified by
running it. 5d-i's T4 predicted "an existing history/playback test fails" and got 30 of 76; its T5
predicted a failure mode that PR #25 had already made unreachable. Neither would have been found by
reading.

**THE TIER THAT CATCHES THIS IS THE SKIPPABLE ONE, AND THAT IS A KNOWN HAZARD.** 5d-i recorded that
fabricating `total_steps: Some(0)` left the native suite 894/894 green and was caught only by the
browser tier, which needs Chrome. Every claim in this slice about what is *on screen* has the same
property. Where a fact can be pinned natively or in node instead, it must be.

## §6 What this does not do

### 6.1 THE TM EDITABLE PANE IS A NAMED SLICE, AND NAMING IT IS PART OF THIS WORK

**Filed as a roadmap entry at the same time this slice ships, not left as a gap.** `tmScratch(src)` is
exported, typed and tested (`crates/redextape-wasm/src/lib.rs:131`); `session::tm_scratch` is complete;
`TmScratchStatus` is pinned by an exhaustive destructuring pattern. **What is missing is a caller**, and
a caller needs a surface holding `.tm` text, which this app does not have: the TM pane renders tapes and
a δ-table projected from a compiled program, never the machine source that would have produced one.

So the TM half is not "the same work again for the other pane". It is **a new view that does not exist**,
plus a `tm-scratch` request (`protocol.ts` ships `lambda-scratch` and no `tm-scratch`), plus a
`TmScratchpad`, plus rendering a status shape that is deliberately *not* interchangeable with `TmStatus`
— no `total_steps`, and a `header` boolean carrying decision 6's blank-tapes-at-`MIN_FIELD_WIDTH` state.

Until it lands, §4.3 of 5d-i's two-singleton claim stays half-instantiable, and that stays true in
writing rather than being quietly true.

### 6.2 The rest

- **NO ATTACHED-PANE EDITING.** Decision 4; §3.2 is the measurement. The roadmap's "detach-on-edit"
  becomes detach-on-fork-then-edit, and the deviation is recorded here rather than discovered later.
- **No pane add/remove, no layout, no persistence.** Still 5d-ii.
- **No accessibility pass, and this slice ADDS to the standing list rather than discharging any of
  it.** Two additions: the collapse control, and a text input region. Both are gated on 5d-ii per the
  roadmap's deferral. **No colour may carry state in either** — the list's item 7 and its two
  aggravations are why. CodeMirror's own editor is a strict improvement on a `<pre>` for assistive
  tech, which is a side effect and not a discharge.
- **No temporal synchronisation.** Still deferred to v1.5 on §6.3's own obstruction.
- **No `parse_asm`.** A scratch reads TM text, not asm. Still unclaimed and still priced out of v1.
- **No user-facing memory config**, and no new knob. A scratch's history ring is `HISTORY_BYTES` per
  5d-i §4.4's one knob. **Note for the plan: an edit recompiles, and a recompile resets that leg's
  ring** — so an editing session does not accumulate history across edits, and nothing here changes
  the 1.816× resident figure 5d-i measured.
