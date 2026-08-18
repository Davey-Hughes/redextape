# 5d-iv — the editable TM pane: a view that does not exist, not the same work again for the other pane

## §1 What is being built, and why it is not a port of 5d-iii

**The last buildable Plan 5 slice before the accessibility pass.** 5d-i split the session model from the
pane multiplexer and neither owned *"make a pane editable"*; 5d-iii was filed to close that gap for the λ
leg and filed this slice, by name and by position, to close it for the TM leg. The roadmap's entry —
*"5d-iv IS THE TM EDITABLE PANE"* — is the contract this spec implements.

**What already exists is the whole machine and none of the surface.** `tmScratch(src)` is exported from
`crates/redextape-wasm/src/lib.rs`, `session::tm_scratch` is complete, `TmScratchStatus` is pinned by an
exhaustive destructuring, and the `TmScratch` handle carries `tmStatus`, `tmProgram`, `stepTm`, `tmState`,
`tapeSlice` and `raiseTmCap` — everything a renderer needs. Nothing under `web/src/` calls any of it. The
only mentions there are three comments recording the absence, in `protocol.ts`, `scratch.ts` and
`transport.ts`.

**And the reason nothing calls it is not laziness.** A `TmScratch` is built from `.tm` TEXT, and no
surface in this app holds any: the TM pane renders five tape rows and a virtualized δ-table *projected
from a compiled program*, never the machine source that would have produced one. **That view is the
slice.** A λ pane already showed λ text, so 5d-iii made a `<pre>` editable; there is no TM equivalent to
make editable.

## §2 The six decisions

1. **A TM scratch's text has two origins: a fork from the source machine, and a blank buffer.** Fork is
   the headline gesture. The blank buffer exists for the round trip `session.rs`'s headered-scratch test
   already calls *"the round trip a user actually performs: emit a file, paste it into a pane"* — the
   `tm_emit` example's only consumer inside the app.
2. **The pane takes 5d-iii's split body**, not a fourth `PaneKind`. Editor region above, today's tape rows
   and δ-table below, one collapse control. `PaneKind` stays `'source' | 'lambda' | 'tm'`.
3. **`MAX_FORK_RULES` bounds the fork, counted in δ rules, and it is a REFUSAL rather than a truncation.**
   §3.1 is the measurement.
4. **One `ScratchBuffers`, with a `leg` per buffer, and ONE shared warm cap across both legs.** §3.3 is why
   the cap cannot be split.
5. **No `TmEditor` class.** `LambdaEditor` is already leg-agnostic; it is renamed and reused. §3.4.
6. **`header: false` is surfaced by the pane, loudly.** A headerless machine runs from blank tapes at
   `MIN_FIELD_WIDTH` (4) and that is explicitly not an error — so it is a fact about what you are
   watching, and nothing else in the app can tell you.

## §3 What verification established before any code was written

### 3.1 THE SIZE WALL IS REAL, IT IS 7.8 MB, AND THE UNIT THAT BOUNDS IT IS DECIDABLE BEFORE ANYTHING IS EMITTED

`cargo run --release --example tm_emit -p redextape-core -- emit '<program>'` over the corpus
`owner_probe.rs` and `frame_cost_probe.rs` share, measured on this machine at this spec's writing:

| program | bytes | lines | states | **δ rules** |
| --- | ---: | ---: | ---: | ---: |
| `sample` | 17,739 | 347 | — | — |
| `list2` | 25,142 | 464 | 146 | **309** |
| `while4` | 109,836 | 1,913 | — | — |
| `sum5` | 226,203 | 3,973 | — | — |
| `list20` | 973,375 | 16,250 | 4,439 | **11,802** |
| `list60` | **7,821,687** | **127,890** | 33,699 | **94,182** |

**THE RULES COLUMN WAS ADDED AFTER TASK 2 MEASURED IT, AND ITS ABSENCE HAD MADE THE NEXT PARAGRAPH
FALSE.** This table first carried bytes and lines only, and the paragraph below read *"`tm-pane.ts`'s own
doc already records `list60` as 127,881 δ rows, which is these 127,890 lines minus the header and state
declarations. The two readings agree."*

**They agree — on a quantity this section is not about.** `list60` is 33,699 states **plus** 94,182 rules,
and 33,699 + 94,182 = **127,881** exactly. So the δ-table's ROW count is states *and* rules, while
`MAX_FORK_RULES` gates on rules alone. `list2` confirms it at the small end: 146 + 309 = **455**, the
figure the roadmap records for that fixture.

**IN THE UNIT THAT ACTUALLY GATES, `list60` IS 94,182 AND NOT 127,881 — 26% SMALLER**, and it was found by
re-counting the emitted files with `grep -c '^  \['` rather than by re-reading the sentence. The three
rows with no count were not re-measured; they are far below any candidate cap and nothing turns on them.

**Bytes per rule is stable at 81–83 across a 300× range** — `list2` 81.4, `list20` 82.5, `list60` 83.0 — so
the rule count bounds the byte count within about three percent, which is tighter than the ten percent this
paragraph claimed while it was dividing by the wrong denominator.

**THE RULE COUNT IS ALREADY ON BOTH SIDES OF THE WIRE.** `TmProgram` is `{states: StateView[], …}` and
each `StateView` carries `rules: RuleView[]`, projected once per compile and cached; it is what
`state-table.ts` virtualizes over. So `Σ states[i].rules.length` is answerable without emitting a byte,
in the worker *and* on the main thread, from an object both already hold.

**AND THE REFUSAL CANNOT BE A TRUNCATION, WHICH IS THE ONE PLACE THIS DIVERGES FROM THE λ PRECEDENT.**
`LAMBDA_BYTE_BUDGET` is 65,536 and truncation is *shown, not hidden* — a truncated term is still a
readable term. **A truncated `.tm` file is not a machine.** It either fails to parse or, worse, parses
into a different machine missing its tail states. So the budget refuses at emission and never trims.

**65,536 IS THEREFORE THE WRONG CONSTANT TO REUSE, AND THE ARITHMETIC SAYS SO RATHER THAN TASTE.** At
64 KB only `sample` and `list2` of the six clear it; `while4` already fails at 110 KB. The headline
gesture would decline on four of six demo programs. The two budgets answer different questions: one
bounds a readout, the other bounds an editable document.

### 3.2 THE SEED RIDES `compiled`, BECAUSE THE λ FORK ALREADY WORKS THAT WAY AND FOR A RECORDED REASON

`transport.ts`'s detach handler seeds a λ fork from `wiring.index.lambdaText` — main-thread-resident,
delivered on the `compiled` reply, no round trip. `linkIndex`'s own doc carries the argument: it rides
`compiled` *"eagerly rather than on first click"* because a lazy fetch *"costs a round trip into a worker
measured starved for 4,679 ms during recording."*

`tmProgram` already rides the same reply for the same family of reason (*"~123 states for `let x = 40;
x + 2`… putting it on every frame would send it 2,870 times"*). `tmText` joins it.

**THE GATE IS WHAT MAKES THAT AFFORDABLE, AND IT IS THE SAME GATE.** Without it, `list60` posts 7.8 MB on
every compile whether or not anyone ever forks. With it, `tmText` is `null` above the cap and the wire
cost is bounded by the same constant that bounds the editor.

### 3.3 THE WARM CAP COUNTS THREADS, SO IT CANNOT BE SPLIT PER LEG

`MAX_WARM_BUFFERS` is 11 and its doc is explicit: **"THE CAP COUNTS THREADS, NOT BUFFER RECORDS."** It was
derived and then verified against eleven probe workers each holding a bare `LambdaScratch`, against a
pre-registered budget whose dominant term is the wasm module baseline of **8,454,144 bytes**, paid once
per thread by 5d-i decision 3 (one worker per session).

**A TM THREAD COSTS THE SAME SEAT AND NO MORE.** The same probe measured a `TmScratch`'s marginal wasm
linear memory at **0** — absorbed by the previous page — against a `LambdaScratch`'s 65,536, so a TM
buffer is at most as expensive as the λ buffer the figure was derived from. And `HISTORY_BYTES` (32 MiB)
is already **per leg**, so a TM buffer's ring is charged the identical allowance a λ buffer's is; the ring
bounds bytes rather than frames, so the differing per-frame cost of a `TmState` against a `LambdaState`
does not reach the cap.

**TWO CAPS OF 11 WOULD THEREFORE DOUBLE THE BOUND 5d-ii-d's PROBE EXISTS TO ESTABLISH**, silently, by
adding a leg. One cap of 11 across both legs is the honest reading, and it is the reading that needs no
new measurement.

### 3.4 `LambdaEditor` IS ALREADY LEG-AGNOSTIC, AND ITS OWN DOC IS THE EVIDENCE

Its config is `{host, initial, debounceMs, onEdit}`. It holds a CodeMirror view, a debounce timer and a
`#seeding` flag. **It has no λ-specific member and no λ-specific extension** — because its doc already
argued its way out of one: *"NO SYNTAX HIGHLIGHTING, AND THAT IS NOT AN OVERSIGHT… `analyze` is the SOURCE
language's parser, not λ's… a stale colouring on a buffer being typed into is worse than none."*

That argument transfers to `.tm` text unchanged, so the class transfers unchanged. **Only the name is
λ-specific**, and a second copy of it under another name would be the duplication with no differing line.

### 3.5 `Session` DOES NOT RETAIN ITS `TmHeader`, AND WITHOUT ONE A FORK WATCHES THE WRONG MACHINE

`build_tm_leg` takes `&TmHeader`, uses it, and drops it; `Session`'s fields hold the projected program,
the cursor, the map, the final tapes, the encoding kind and the step total, and no header.

**`print_tm(machine)` IS NOT A SUBSTITUTE FOR `print_tm_with(machine, header)`.** The header is what
carries `encoding`, `width`, `slots`, `result` and the literal initial tapes — so a headerless print
reparses to a machine that runs *from blank tapes at `MIN_FIELD_WIDTH`* rather than from the program's
actual input. That is decision 6's state, and it is correct for a hand-written file and wrong for a fork.

**THE FIX GOES INSIDE THE `Ok` TUPLE, WHICH IS THAT FIELD'S OWN STATED HOUSE RULE.** `Session.tm` is
`Result<(TmProgram, TmCursor<Rc<Machine>>), TmDecline>` and its doc records at length why the pairing
exists: *"THE PAIRING IS WHAT MAKES A CURSOR WITHOUT ITS PROGRAM UNREPRESENTABLE"*, and the looser shape
it replaced forced a fabricated, permanently uncovered user-facing status for a state no program could
produce. The header exists exactly when that `Result` is `Ok`, so it belongs in the tuple:
`Result<(TmProgram, TmCursor<Rc<Machine>>, TmHeader), TmDecline>`. Cost is O(tapes × width), not
O(states).

### 3.6 THE CORRECTNESS ARGUMENT FOR THE FORK IS ALREADY IN THE TREE AND ALREADY GREEN

`session.rs`'s `a_headered_scratch_matches_the_session_path_except_for_the_source_node` prints a compiled
machine with `print_tm_with`, reparses it through `tm_scratch`, and drives the scratch and the live
`Session` **in lockstep for 50 steps**, asserting by struct-update pattern that the scratch loses
`source_node` and loses nothing else — with an `owned > 0` guard so the comparison cannot pass by both
sides being `None`. It also asserts `st.header` is true and the width is the auto-fit's 64 rather than
`MIN_FIELD_WIDTH`.

**That is this slice's central claim, tested, before this slice adds a line.** What is missing is only a
caller.

## §4 The design

### 4.1 THE SPLIT BODY

```
┌─ tm [detached]              [⌃] ─┐
│ tapes 5                          │  ScratchEditor, editable, .tm text
│ start pc0                        │
│ state pc0:                       │
│   [# * * * *] -> write [...]     │
├──────────────────────────────────┤
│ REG   #_1__#____#____#           │  today's tape rows, unchanged
│ HEAP  #____#____#                │
│ δ-table (virtualized)            │  today's state table, unchanged
│ [↺][◀][▶][⏵]  pc3 · width 4      │
└──────────────────────────────────┘
```

An **attached** TM pane is unchanged from today: tapes, table, status line, and a `✎ fork` control.

**THE COLLAPSE IS A CLASS ON THE PANE, NOT A SECOND RENDERING MODE** — `pane-chrome.ts`'s
`collapseButton`, the same idiom 5d-iii used, so the table renderer below is untouched and never learns
it has more room. **The editor region is mounted and unmounted, not hidden**, for `detachedBadge`'s
recorded reason: `hidden` leaves a live CodeMirror in the DOM, and §5 asks for a test that reattaching
*removes* it.

**`EDITOR_DEBOUNCE_MS` MOVES RATHER THAN BECOMING A THIRD COPY.** It is 300 in `lambda-pane.ts`, already
duplicated from `main.ts`'s `DEBOUNCE_MS` with a stated argument for the duplication. A third copy is
where that argument stops paying; it moves to a shared module and both panes import it.

### 4.2 THE GATE LIVES IN TYPESCRIPT, IN ONE PLACE, AND RUST STAYS TOTAL

`Session::tm_text` wraps `print_tm_with` and answers `Option<String>` — `None` exactly when the TM leg
declined, which is the same condition `tm_program` already answers `None` on and reads off the same
`Result`. **It carries no size condition of its own**: asked, it prints, however large the machine is.
The size decision is the worker's, immediately after it builds the program it is already building:

```ts
// protocol.ts — where the coverage gate can see it, and where protocol.test.ts drives it
export const MAX_FORK_RULES = /* §4.2's measured figure */
export function ruleCount(p: TmProgram): number {
  return p.states.reduce((n, s) => n + s.rules.length, 0)
}
export function forkable(p: TmProgram | null): boolean {
  return p !== null && ruleCount(p) <= MAX_FORK_RULES
}

// session-worker.ts — the wasm call and nothing else
const program = session.tmProgram()
const tmText = forkable(program) ? session.tmText() : null
```

**THE PREDICATE IS IN `protocol.ts` AND NOT IN THE WORKER, FOR THE REASON `scratch.ts` GIVES FOR ITSELF.**
`vite.config.ts` excludes `session-worker.ts` from the coverage include set, so *"logic placed there moves
none of the four numbers"*; the worker therefore holds the wasm call and the branch, and the arithmetic
that decides the branch lives where a test can drive it without a thread. It is also the same function the
main thread calls to word the refusal, so the decision and the message cannot disagree about the count.

**ONE CONSTANT, IN ONE LANGUAGE, READ BY BOTH SIDES OF THE APP.** `MAX_FORK_RULES` lives in
`protocol.ts`: the worker reads it to decide, and the main thread reads it to word the refusal against the
count it computes from the same `tmProgram`. A gate in Rust would need the constant exported across the
boundary to word that message, which is two homes for one threshold — the two-places-to-be-wrong shape
`sessions.ts`'s `LegState` doc refuses.

**AND IT MEANS RUST NEVER BUILDS A STRING TYPESCRIPT THROWS AWAY.** The check runs before `tmText()` is
called at all, so `list60` costs a reduce over 94,182 rules (not 127,881 — that is the δ-table's ROW
count, states plus rules; §3.1 has the correction) and not a 7.8 MB allocation.

`MAX_FORK_RULES`' value is pre-registered by the plan and fixed by measurement — CodeMirror's cost at N
rules, the `postMessage` of the emitted string, and `tmScratch(src)`'s parse time. `list20`'s ~11,802
must clear it and `list60`'s 94,182 must not; where between them it lands is the plan's to establish, and
the figure ships with the readings that set it — SUPERSEDED BY THE FIX ROUND'S OWN BRACKET (roadmap:
"PLAN 5d-iv CLOSES"). The shipped cap, 50,000, sits inside a direct 9,218-rule bracket rather than at
this paragraph's own two-point interpolation: `list43` (49,591 rules) clears at 167 ms and `list47`
(58,809 rules) still clears, at 248 ms — both measured, not extrapolated — while `list50` (66,237 rules)
breaches at 271 ms.

### 4.3 `tmText === null` IS THE ONLY FACT BEHIND THE REFUSAL

`compiled` gains one field:

```ts
| { kind: 'compiled'; …; tmProgram: TmProgram | null; tmText: string | null; … }
```

The fork control is offered exactly when `tmText !== null`. **There is no `canFork` boolean**, because a
second encoding of one fact is how a control comes to be offered for a fork that cannot happen —
`detachButton`'s rule, *"offer the fork control exactly when a fork would work"*, stated as a data
dependency rather than as a convention.

Above the cap the control is present and disabled, and it names the count: *"94,182 rules — too large to
open in an editor."* (94,182, not 127,881 — the same correction as above; the shipped message reads the
count off `ruleCount`, never off the δ-table's row total.) The count is loud because the alternative is a
control that does nothing for a reason the user cannot see.

### 4.4 THE `tm-scratch` REQUEST, AND THE TWO FIELDS IT DOES NOT HAVE

```ts
| { kind: 'tm-scratch'; gen: number; src: string }
```

**NO `step`.** `lambda-scratch` carries one because a λ fork replays the source term to the frame the pane
was showing. A machine has no step-*k* term: its `.tm` text is the machine, and the scratch starts from
its header's initial configuration. A `step` here would be a field with no reader on either side.

**NO `encoding`**, for `lambda-scratch`'s own recorded reason one layer along: an encoding says how a
value is decoded, decoding is type-directed, and a `TmScratch` has no `ty` — `tmValue`, `sourceSpan` and
`linkIndex` are absent from the type, proved by method resolution in `tests/browser.rs`.

Unparseable text is **not** an error at this boundary. `tmScratch` answers `{diagnostics, scratch: null}`,
which is the existing `no-session` reply — reused exactly as `lambda-scratch` reuses it, and for the same
stated reason: *"a second `no-scratch` variant would be two names for one state."*

**THE SUCCESS REPLY IS A NEW ARM, NOT `scratch-compiled` WIDENED, AND THAT IS THE SAME ARGUMENT POINTED
THE OTHER WAY.** `scratch-compiled` carries `{lambda: LambdaStatus, text: string | null}`. A TM scratch's
reply carries neither field and needs one `scratch-compiled` does not have:

```ts
| { kind: 'tm-scratch-compiled'; gen: number; tm: TmScratchStatus; tmProgram: TmProgram }
```

`TmScratchStatus` is a different type from `LambdaStatus` — five fields, no `total_steps` — so reuse would
mean a union inside the arm and a switch in every consumer to open it. And `tmProgram` is **not
nullable here**, unlike on `compiled`: `session.rs` records that *"there is no absent-leg case: a
`TmScratch` exists only for text that parsed to a machine"*, so the scratch's own δ-table always has a
program to render. `no-session` already covers the text that did not parse.

**There is no `text` echo.** λ needs one because the worker computes the term at step *k* and the main
thread has never seen it. For TM the main thread sent the text, so echoing it back would return 1 MB the
sender already holds.

### 4.5 ONE `ScratchBuffers`, ONE ID SPACE, ONE COUNTER

A buffer gains `leg: Leg`. It selects the worker request kind and it is the fact `#buffers`' doc records
as missing: *"`detached` is a property of a session and cannot distinguish a λ buffer from a future
`TmScratch`; nothing else in an entry records provenance."* This is that field.

`fork`, `warm`, `cool`, `retire`, `recompile`, `warmCount`, `snapshot`, `restore` and the cap are
**unchanged in shape** — every one of them is already leg-agnostic, and the leg reaches them only as a
field they carry through.

**THE VARIATION IS CONCENTRATED IN `#spawn`, AND IT IS THREE THINGS RATHER THAN ONE.** An earlier draft of
this section said "only the request kind differs, and it differs at one line", which reading `#spawn`
falsifies. **Two things branch**: it builds `legs: { lambda: { hist, status, done, timer } }`, where a TM
buffer needs `legs: { tm }` with its own `History<TmState>`; and it calls `client.scratch(gen, src, step)`,
where a TM buffer needs `client.tmScratch(gen, src)` with no step.

**A third thing is a false comment rather than a branch, and it is corrected rather than left.** `#spawn`
seeds `tmProgram: null` under *"NO MACHINE, EVER — `SessionEntry.tmProgram` is retained from a `compiled`
reply, and a λ buffer's worker answers `scratch-compiled` instead."* The **value** stays right for a TM
buffer — that field is written later, by `replies.ts`, from the reply — but the reason given for it is
true only of λ. Same class as the sentence it replaces here.

**ONE ID SPACE AND ONE `#minted` COUNTER ACROSS BOTH LEGS.** `buffers-store.ts`'s `mintedIndex` parses
`/^scratch-(\d+)$/` and a second prefix would break it; more importantly, one counter is what extends *"a
retired buffer's name is not reissued"* — and its cross-reload widening — to both legs for free. **The leg
shows in the LABEL, not in the id**, so `BufferRow` can distinguish two buffers on the axis a user is
choosing between while the persistence format keeps one namespace.

`PersistedBuffer` gains `leg`, and `BUFFERS_VERSION` goes 1 → 2. A version mismatch already drops the
payload and returns `null`, so the upgrade path is the designed one and needs no migration.

### 4.6 CUSTODY WIDENS; IT DOES NOT SPLIT

`EditorCustody` is typed against `LambdaPane` and `LambdaEditor`. It widens to the shape both panes
implement — `setEditor`, `takeEditor`, `receiveEditor` — and the editor type becomes the renamed
`ScratchEditor`.

**ONE CUSTODY INSTANCE, NOT ONE PER LEG.** It is keyed by *session*, and a session has exactly one leg, so
one pair of maps covers both without ambiguity. Two instances would put one fact in two containers, which
is the exact split the module's own doc says it was extracted to end: *"a `Map` any of `main()`'s lines
can iterate is a `Map` any of them can iterate over the wrong domain."*

### 4.7 THE BLANK BUFFER IS A SECOND GESTURE, BECAUSE IT IS A SECOND INTENTION

*Fork* means "detach this pane onto its own copy of the machine it is showing", and above the cap that is
not available. *New TM buffer* means "give me somewhere to paste a `.tm` file", and it is available
always. Folding the second into the first — a fork that silently yields an empty buffer above the cap —
would be a failure dressed as a success, and the pane would then have to explain that it did something
other than what was asked.

The control goes in `buffer-list.ts`'s menu, which is where buffers are already managed. It mints a warm
buffer with empty text, subject to `MAX_WARM_BUFFERS` like any other.

**AND PUTTING IT THERE FORCES THE BUTTON TO STOP HIDING ITSELF, WHICH IS A FIX RATHER THAN A COST.**
`main.ts`'s `refreshBuffers` sets `buffersButton.hidden = live === 0`, so on a page with no buffers the
menu is unreachable — **which is exactly the state a user is in when they want somewhere to paste a `.tm`
file.** The menu is no longer empty at zero, so the hide rule goes and the label reads `buffers ▾` rather
than `buffers 0 ▾` there.

**The focus-restoration branch beside it goes with it**, and that is the point. `refreshBuffers` carries
`if (live === 0 && document.activeElement === buffersButton) restoreLayoutButton.focus()` — a line that
exists solely because retiring the last buffer hides the control the click landed on. That is **item 1 of
the standing accessibility list**, *"a control that hides itself on click strands the keyboard"*, and
deleting the hide rule retires this instance of it rather than moving the workaround around. §6 records
that the list gets shorter here even though the pass itself is still deferred.

### 4.8 WHAT THE PANE SAYS THAT THE λ PANE DOES NOT

**`header: false` is surfaced.** `parse_tm_full` answers `Option<TmHeader>` and explicitly does not treat
`None` as an error; the machine then runs from blank tapes at `MIN_FIELD_WIDTH`. That is a fact about what
the user is watching that nothing else in the app can tell them, and it is 5d-i decision 6 reaching a
renderer for the first time. The status line says so in words, not by a colour — the accessibility list's
item 7.

**There is no `total_steps`, and it costs nothing.** `TmScratchStatus` has exactly five fields —
`available`, `reason`, `width`, `run`, `header` — pinned by an exhaustive destructuring so a sixth fails
to compile with `E0027`. Its only consumer in the whole app is `results.ts`, and a scratch has no results
readout at all: no `ty`, no `tmValue`, so `TmLeg.value` is `null`, which is the shape `LambdaScratch`
already takes. **The TM pane's own status line never read the field** — it reads `${state} · width ${w}`
— so the pane needs no accommodation for its absence.

### 4.9 MODULE SPLIT

| file | change |
| --- | --- |
| `crates/redextape-wasm/src/session.rs` | `TmHeader` into the `Ok` tuple of `Session.tm`; `tm_text() -> Option<String>` |
| `crates/redextape-wasm/src/lib.rs` | `tmText` on the `Session` handle. `TmScratch` and `tmScratch` are already complete |
| `web/src/types.ts` | `TmScratchStatus` — the five fields, mirroring the pinned Rust struct |
| `web/src/protocol.ts` | `MAX_FORK_RULES`, `ruleCount`, `forkable`; `tmText` on `compiled`; the `tm-scratch` request and `tm-scratch-compiled` reply |
| `web/src/session-worker.ts` | one request arm calling `tmScratch(src)`, and the gate around `tmText()` — **the wasm calls and nothing else**, since `vite.config.ts` excludes this file from the coverage include set for a measured instrumentation reason |
| `web/src/scratch.ts` | `leg` on `BufferState`, selecting the request kind at one line. Every other method unchanged in shape |
| `web/src/buffers-store.ts` | `leg` on `PersistedBuffer`, validated; `BUFFERS_VERSION` 1 → 2 |
| `web/src/lambda-editor.ts` → `web/src/scratch-editor.ts` | rename only — §3.4 |
| `web/src/editor-custody.ts` | widen from `LambdaPane`/`LambdaEditor` to the `EditablePane`/`ScratchEditor` shapes. One instance, not two — §4.6 |
| `web/src/tm-pane.ts` | the split body, the collapse control, the fork control, `setEditor`/`takeEditor`/`receiveEditor`, the `header: false` line |
| `web/src/buffer-list.ts` | the "new TM buffer" item |
| `web/src/main.ts` | `refreshBuffers` loses the hide rule and the focus-restoration branch — §4.7 |
| *new* `web/src/editor-timing.ts` (or nearest existing shared home) | `EDITOR_DEBOUNCE_MS`, so the 300 is not written a third time — §4.1 |

**`tm-pane.ts` IS THE FILE TO WATCH FOR SIZE.** It is ~23 KB today doing `(frame, controls) -> DOM` for
five tape rows and a virtualized table. `lambda-pane.ts` reached 46 KB taking on the editor region, and
its own doc records the split that kept it from being worse: the editor is *"its own module for the reason
`scratch.ts` is"* — a document surface, a debounce timer and a diagnostics channel behind one name is
three concerns. Reusing `ScratchEditor` whole is what keeps that pressure off this file; if the pane still
grows past its neighbours, the tape-row and table rendering is the half to lift out, not the editor.

## §5 Testing

**The rule that decides which tier a test goes in** is 5d-i's, restated by this plan: *"the browser tier
needs Chrome and is skippable; the trap this task's plan flags as its biggest should not depend on a tier
that can be skipped."*

**Native, `crates/redextape-wasm/src/session.rs`:**
- `tm_text` round-trips: print a compiled `Session`, reparse through `tm_scratch`, drive both in lockstep —
  the existing headered-scratch test extended to start from `Session::tm_text` rather than from a
  hand-assembled `print_tm_with` call, so the *shipped* path is the tested one.
- The header survives being moved into the `Ok` tuple: a declined TM leg still declines, and an available
  one still reports the auto-fit width rather than `MIN_FIELD_WIDTH`.

**Node, `web/tests/node/`:**
- `scratch.test.ts` — **two legs, one cap**: forking λ and TM buffers up to `MAX_WARM_BUFFERS` refuses on
  the eleventh *whichever mix* reached it. Driven over a real `SessionRegistry` and `SessionPool` with
  fake ports, because **pool size is the axis and it is not reachable from the DOM**.
- `scratch.test.ts` — a TM buffer's `leg` selects the `tm-scratch` request and a λ buffer's selects
  `lambda-scratch`, asserted on the fake port's traffic.
- `buffers-store.test.ts` — a v1 payload is dropped; a v2 payload round-trips its `leg`; a buffer with an
  unknown `leg` is rejected by `validBuffer` rather than restored.
- `protocol.test.ts` — the `MAX_FORK_RULES` predicate against a `TmProgram` at, one below, and one above
  the cap.

**Browser, `web/tests/browser/`:**
- Fork a TM pane, edit a rule, watch the tapes take the edited transition — the headline capability, end
  to end.
- The fork control is present and disabled with its rule count on an over-cap program, and `tmText` is
  absent from that compile's reply.
- A pasted headerless machine reports `header: false` in words and runs from blank tapes at width 4.
- Reattaching a forked TM pane **removes** the editor from the DOM rather than hiding it.
- Two TM panes on two TM buffers render two different machines — the multiplexer property, which is what
  the binding model was chosen for.
- **The buffers menu is reachable with zero buffers**, and the "new TM buffer" item inside it mints one —
  the §4.7 hole, asserted rather than assumed, since it is invisible to every test that forks first.
- Retiring the last buffer leaves focus on the buffers button rather than moving it, because the button no
  longer disappears — the §4.7 retirement, pinned so a future re-hide is caught.

**Coverage.** `web/`'s four gate figures must not fall below where 5d-ii-d closed (95.57 / 89.88 / 98.51 /
98.08). `session-worker.ts` is excluded from the include set for a measured instrumentation reason, which
is why the worker holds only the wasm call and the gate, the minting and the rebinding live in modules the
gate can see.

## §6 What this does not do

- **NO ACCESSIBILITY PASS. THIS SLICE ADDS TWO ENTRIES TO THE STANDING LIST AND RETIRES ONE INSTANCE FROM
  IT, WHICH IS NOT THE SAME AS DISCHARGING ANY OF IT.** The two additions are a second collapse control
  and a second text input region; **no colour may carry state in either** — the list's item 7. The
  retirement is §4.7's: deleting `buffersButton`'s hide-at-zero rule removes one instance of the list's
  item 1, *"a control that hides itself on click strands the keyboard"* — a side effect of needing the
  menu reachable at zero, recorded rather than claimed as progress against the pass. This is the last
  slice the pass is gated behind; after it, the controls have settled.
- **No `parse_asm`.** A scratch reads TM text, not asm. Still unclaimed and still priced out of v1.
- **No attached-pane editing.** Detach-on-fork-then-edit, as 5d-iii established for the λ leg.
- **No temporal synchronisation.** §6.3's reference-clock stepping stays deferred to v1.5 on its own
  recorded obstruction.
- **No user-facing memory config and no new knob.** A TM buffer's ring is `HISTORY_BYTES` per leg, like
  every other.
- **No `.tm` syntax highlighting**, for §3.4's transferred argument. `print_tm_mapped` and
  `print_tm_with_mapped` do produce a `Classified` for TM text and are not exported to wasm — noted here
  so the next reader knows the capability exists rather than rediscovering it, but a colouring computed
  from a *printed* machine is stale the instant the user types, which is the case that argument already
  answers.
- **The per-frame layout write on `pointermove`** filed by 5d-ii-d stays open. This slice does not touch
  that path.
