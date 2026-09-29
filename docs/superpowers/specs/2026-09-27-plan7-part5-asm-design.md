# Plan 7, part 5 — asm: a stepping VM, a third leg, and the asm view — design

Part 5 of [Plan 7](2026-09-17-frontend-overhaul-design.md). It gives the core a stepping asm interpreter,
makes asm the web app's third execution leg beside λ and TM, adds an asm view with a listing and three state
panels, and lets a user edit a copy of the asm — which is the first time the asm language support part 3
built reaches anyone.

It answers the two questions the umbrella's §6 left for this part. **Do asm instructions carry source nodes
for linking?** Yes, already: `lower_asm_mapped` returns one `NodeId` per instruction, and the TM
`SourceMap` composes it and then drops it (§2.2). **Does "edit a copy" extend to asm?** Yes, by the user's
decision (§3). It also **amends one of the umbrella's premises**: §8.3's oracle, "stepping to the end
matches `run_asm`", is circular under §5's own contract that `run_asm` becomes a loop over the stepper, and
§4.4 replaces it with a check against the TM that was measured before this spec was written.

Code facts below were read at `a4e7c6f` (#107, part 4b's squash merge). §12 gives the command behind every
figure.

**Amended 2026-09-27, while writing 5a's plan, from its prototype and before any task.** 1 corrects a
claim the approved text made; 2 measures what it left unmeasured; 3 records a cost it did not state; 4
records where the code went:

1. **`tail` copies the tag stored with the cell's tail; it does not make a list.** §4.3's table put `tail`
   beside `cons` and `nil`, while its own rule — a tag says how the word was made, and a hand-written value
   used as a pointer stays a value — and its own heap cells, which store the tail's tag, say otherwise.
   Built, `tail` copies as `head` does. For a compiled program the two readings agree, since a cell's tail is
   always a list; they part only for a hand-written cell with a value in its tail, which is the case the
   rule exists for (§4.3).
2. **The sequences are measured equal.** §4.4 measured the entry COUNT and left the SEQUENCE for 5a. The
   prototype's oracle finds the asm cursor's instruction sequence equal to the TM's `pc{i}` entries on all
   100 runs: the 46 corpus programs and the 4 latent traps, each under unary and binary (§4.4, §12).
3. **`run_asm` is slower on the cursor.** §4.2 said its signature and results are unchanged, which holds;
   its speed does not. On the 100,000-turn loop it measured 3.9 ms before and 6.2 ms after, on
   `sum(1000)` 0.059 ms and 0.119 ms, on `upto(200)` 0.013 ms and 0.028 ms — the cursor's per-step checks and
   the tags. That is the price of one implementation of the instruction set (§4.2, §12).
4. **The cursor is `trace/asm_cursor.rs`, re-exported from `trace`** as `ZipperCursor` is, and its item is
   its own `AsmStep`, not a `StepEvent` variant: `StepEvent`'s consumers end their loops on a variant they
   do not recognise, which §4.1 left to the plan to weigh (§4.1).

**Amended 2026-09-27 again, from 5a's whole-branch review.** 5 corrects a claim the approved text made:

5. **§4.4's oracles do not hold the display-state rule; a property test does.** §4.3 said the first check
   holds tags and written bits to display state. Every oracle runs compiled programs, which never use a word
   against its tag or read a local nothing wrote, so a gate that faulted on either — `head`, `tail`,
   `box_get` or `box_set` refusing an operand of the wrong tag, or `mov`, `jz`, `bin` or `cons` refusing an
   unwritten local — passed the whole workspace when the review planted it. 5a's
   `a_run_ends_the_same_whatever_its_tags_and_written_bits_say` runs random hand-built programs twice, the
   second with every tag and written bit overwritten before each step, and requires the same end; both of
   those gates, and each single-instruction one tried, fail it (§4.3).

**Amended 2026-09-27 for 5b, from reading the code at `899c8b2`, before its plan.** 6 and 7 are the user's
decisions; 8 to 13 correct or settle what the approved text left open:

6. **5b touches core's view model.** §1 said 5b touches only `redextape-wasm` and `web/`. Every per-step type
   that crosses to JavaScript — `LambdaState`, `TmState`, `TmProgram` — is declared in `redextape-core`'s
   `viewmodel.rs` with its serde and ts derives, and so is the builder that windows a cursor, `TmState::window`.
   `AsmState`, its builder `AsmState::window` and `AsmProgram` go there too, and `WordTag` and `AsmCap` take the
   canonical ts derive, so the `ts_bindings` gates cover them. The window's bounds are the builder's parameters,
   set in `web/src/protocol.ts` as `TM_RADIUS` is: the view model's rule is that core never picks a number.
   Decided by the user over mirroring the types in the wasm crate (§1, §5.3).
7. **The listing's grid is a module the TM rule table shares.** The virtualized roving row — the drawn window,
   the active row, the keys, a click that takes no focus on `mousedown` (4b amendment 18), following and its
   resize clamp — is written out three times: in `TmPane`'s rule table, in `StateDiagram` and in `LambdaBody`.
   5b extracts it from the rule table with no change in behaviour, and the asm listing is its second user. The
   state diagram and the λ body move onto it in a PR of their own after 5b. Decided by the user over a fourth
   copy, and over moving all four in 5b (§6.2, §10).
8. **The leg inventory is re-derived, and it is larger than §2.3's 14.** A search at `899c8b2` finds two-way
   branches §2.3 does not name — in `scratch.ts`, `buffer-list.ts`, `main.ts` and `pane-host.ts`'s drop pass —
   and hand-written two-leg shapes: `resetLegs`, `resultRows`, the pin's origin, `link-status.ts`'s per-leg
   clauses and the worker's per-leg resets. The plan records the search and its output. The refactor also
   covers **three dispatches the compiler cannot check**: `replies.ts`'s two switches on a reply's kind and the
   worker's chain on a request's kind have no exhaustive end, so an `asm-frames` reply nothing handled would be
   dropped with `tsc` green. A pin's origin becomes `'source' | Leg` (§5.1, §5.5).
9. **Panel toggles and *follow current instruction* sit in each panel's own header, not the view's.**
   `panel.ts` gives every panel its own disclosure and header actions, and the TM view keeps *follow current
   rule* in its rules panel's header; §6.1 and §6.2 put both in the view's header. The asm view does as the TM
   view does (§6.1, §6.2).
10. **A stack, heap or memory cap ends the recording as λ's depth refusal does: no continue, and the step line
    names the cap.** §8 said *record further* is disabled with its reason. `controls.ts` already decides the
    case where continuing provably cannot help, `depth-refused`, by offering no continue rather than a disabled
    one, and says why beside the list. Each hard cap is a `RecordEnd` of its own, so the sentences that name it
    are exhaustive switches (§5.4, §8).
11. **An instruction with no owner says so in the link status**, in a sentence of its own. A TM state with no
    owner clears the pin and leaves the status blank — `transport.ts`'s `linkState` passes `nodeForState`'s
    `null` to `setLinkTo` — and that stays as it is (§6.6).
12. **The default tree is (source | λ) above (asm | TM)**: §3's row 4, "asm beside TM", written as a tree. λ
    stays the first view leaf, so a first load still focuses it — `workspace.ts`'s `defaultFocus` takes the
    first leaf that is not the source (§5.5).
13. **The step total and the value come from `compile`'s own run.** `run_asm` returns no step count, so
    `compile` drives an `AsmCursor` to its end and keeps its outcome for `asmValue`; the recorded leg is a
    fresh cursor, as TM's is. A program that never halts spends the whole step cap there, which 5b's plan
    measures in wasm. The session lowers the program for its cursor, a third lowering per compile, and
    `sourcemap.rs`'s `asm_owner_covers_the_program_lower_program_returns` holds that `asm_owner` indexes the
    program `tm::lower_program` returns. **§5.3's decimal-string word is required, not only tidy**:
    `serde-wasm-bindgen` 0.6.5, which the wasm crate serializes through, answers a `u64` above
    `Number.MAX_SAFE_INTEGER` with an error rather than a rounded number, so a saturated word would fail the
    whole call (§5.2, §5.3).

**Amended 2026-09-27 again, from 5b's prototype, before any task.** 14 and 15 correct what the approved text said;
16 and 17 measure what amendment 13 and §5.3 left to the plan; 18 to 20 settle what the text did not say:

14. **An instruction's owner travels in the link index, not in `AsmProgram`.** §5.2 said `asmProgram` carries each
    instruction's owner. The TM view's links resolve through the link index's `tmOwner`, and the asm view's do
    through its `asmOwner`, beside it, so `AsmProgram` carries the listing and the labels and nothing else. A copy
    (§7) has no link index, as it has no owners.
15. **A fault reads "head of empty list at pc12".** §8 wrote "faulted at pc12: head of empty list", but every reader
    of a fault value already says it is one — the readout prints `fault: ` before it — so the spec's words would read
    "fault: faulted at pc12: …". The value carries what faulted and where.
16. **`compile`'s asm run costs about 7 ns an instruction in the browser**, measured on the release build against the
    same build without the asm leg, the median of seven: `fact(3)` 1.9 ms both ways; the 100,000-turn loop
    5.0 → 14.8 ms; the program that never halts 14.2 → 48.8 ms, which is its whole 5,000,000-step cap. It runs in the
    session's worker, where it delays that compile's first frame and nothing else (amendment 13).
17. **A word costs 48.23 bytes of retained heap and is charged 52**, measured by heap differential over every frame
    of `upto(200)`: 2,814 frames and 247,091 words. The window's starting bounds stay — 64 locals, 16 arguments,
    8 frames, 16 cells and 16 boxes — since every corpus program fits whole, and `upto(200)`, the heaviest program of
    §2.5, retains about 4.3 KB a frame and fits its whole run in the ring (§5.3).
18. **At depth 0 an unwritten local reads "not written yet", not "left over from caller".** A local the bank grew
    past holds 0 and was never written; there is no caller for it to be left over from (§6.3).
19. **The link status says three new things** (§6.6): "this instruction has no source construct" for a click on an
    instruction `defunc` minted (amendment 11's sentence); "the asm run is here right now" when the asm leg's running
    focus meets the pin, beside TM's "the machine is here right now"; and one clause, "this construct emits no
    instructions or machine states", for a construct neither lowering bills anything to, where two clauses would say
    one fact twice on the constructs most often clicked.
20. **A copy's leg is λ or TM until part 5c.** Every place a copy's leg is held takes `CopyLeg`, which leaves asm
    out, so no copy switch has an asm arm to write, and 5c's widening makes `tsc` name each one (§7).

**Amended 2026-09-27 a third time, from looking at 5b's prototype by hand.** 21 fixes a bug on `main` that the asm
listing would have inherited:

21. **A link's scroll holds a following grid until the run moves** (§6.2, §6.6). Plan 5's click-linking design let
    a link's scroll win the one draw that wrote it. The write's own `scroll` event redraws the grid a frame later,
    and that draw, still following, scrolled back to the run's row: on `main`, a construct linked from the source
    moved the TM rule table to its block and back within two milliseconds, whenever the table was following. The
    asm listing shares the grid (amendment 7), so §6.6's scroll would have done the same. The scroll now holds
    until the view shows another frame — the run moving. The hold is keyed on the frame, not on the row following
    keeps in view: the TM rule table follows the current state's own row, and a step that loops in its state — the
    ordinary case in a compiled machine — does not move that row, so a hold keyed on the row never released there.
    Following takes over when the run moves, on re-attach, on a new program, or when the link is replaced by a pin
    with nothing in this view; following's own flag is still untouched. Only a pin made in the source or in another
    leg's view scrolls a view or releases its hold: one made in a view of the same leg only paints.
    A view that cannot show its grid when the pin is made — off the page, which in Stage is every view but the one
    linked from, or with the grid's panel closed — scrolls to the pin the next time it draws the grid on the page
    with the panel open, and holds from the frame it shows then; a pin with nothing in this view, made while it
    cannot show its grid, lets that draw follow instead. That includes a view that missed the last compile, which
    is given the program and the pin when it is next shown. The λ body answers the same trap by detaching
    following on a pin's scroll, and the PR that moves it onto the grid chooses between the two.

**Amended 2026-09-28 for 5c, from reading the code at `e29df3c`, before its plan.** 22 and 25 are the user's
decisions; 23, 24 and 26 correct or settle what §7 said; 27 to 30 settle what it left open:

22. **A copy flags a label that names nothing or is defined twice, and refuses to run it.** asm's parser accepts
    both on purpose — a jump to an undefined label parses clean, and a duplicate label resolves to its first
    definition — so the language server shows nothing, and the run faults only when that jump executes.
    `redextape run` refuses the same file up front through `Program::validate`. 5c adds a function to core that
    reads `parse_asm_nav`'s `NameIndex` and returns an error diagnostic at every reference that resolves to no
    label and at every definition after a label's first; `parse_asm_full`'s own contract is unchanged, and the
    parser's tests that hold it stay. `redextape-lsp`'s asm diagnostics become the parser's plus these, so Neovim
    gains them too, and `asmScratch` refuses text that carries any, so a copy's editor always shows why it did not
    build. A register at or over `MAX_REGISTERS` (1,000,000) has no span of its own to mark: it keeps the cursor's
    behaviour, a fault at step 0 that the view shows as the run's end. `validate`'s other two checks, a label past
    the end and a name the printer cannot write, cannot come from parsed text. Decided by the user over running
    such text with the cursor's lazy faults, and over a refusal shown only in the view's status (§1, §7).
23. **`BUFFERS_VERSION` stays 2.** §7 raised it to 3 with a v2 store migrating unchanged, but a raise buys
    nothing. An older tab refuses a store holding an asm copy either way, on the version or on `validBuffer`'s
    leg check, and a v2 store is already valid under the widened leg. There is no buffer migration to extend:
    a version mismatch falls back to no copies. §5.5 kept `LAYOUT_VERSION` at 1 on the same reasoning.
    `validBuffer`'s leg check, two literals today, is derived from the copy legs, so the next leg cannot be
    refused by it silently (§7).
24. **One byte cap serves both directions.** `MAX_SCRATCH_ASM_BYTES` in the wasm crate bounds the text
    `asmScratch` parses and the `asmText` that `compiled` carries; `asmText` is `null` over it, and *edit a copy*
    is then disabled with a reason that names the size, as the TM view's does with its rule count for the same
    kind of refusal (a function-valued program's TM text is a different reason, naming no size at all).
    It is measured as `MAX_SCRATCH_TM_BYTES` was: the text's structured clone to the worker, the parse, the label check of
    amendment 22, the listing's projection and its clone back, priced together against the 250 ms an initiated
    gesture may take, on a release build with the check switched off. §7 gave `asmText` a cap in the role
    `MAX_FORK_RULES` plays; asm text has no second unit to count, so one constant does (§7).
25. **A copy's caps are measured against its worker's memory.** Under `DEFAULT_CAPS` a hand-written copy can
    save 64,000,000 words of locals before the memory cap stops it — a register near `MAX_REGISTERS` makes every
    `call` save a million words, so 64 nested calls reach it — and a saved local is ten bytes (its word, its tag
    and its written bit), so 640,000,000 bytes. Each warm copy runs in a worker of its own (`SessionPool.bind`
    spawns one per session, up to `MAX_WARM_BUFFERS`, 11), and a wasm memory only grows. 5c's plan measures a
    copy worker's peak memory at `DEFAULT_CAPS`' worst hand-written cases, the memory cap's and the heap cap's,
    and lowers `mem` and `heap` for copies until that peak stays under **256 MiB**, a budget the user set. The
    step line names whichever cap ends a run, through 5b's `RecordEnd` values (amendment 10). The program's own
    session keeps `DEFAULT_CAPS`, and the roadmap entry records what the measurement says about it (§7, §8).
26. **A copy's value is computed when it builds.** `asmScratch` runs the program to its end, as `compile` does
    (amendment 13), so its status carries the step total and its build reply carries the value; there is no
    streaming value reply of the kind a TM copy needs. The status is `AsmStatus` itself, not a copy's own type:
    `TmScratchStatus` exists because a TM copy has no true value for some of `TmStatus`'s fields, and every field
    of `AsmStatus` is true of a copy — `available` always, `total_steps` from its own run. The value decodes by
    the header's `result` type, and without a header it is the raw `rr` word marked as having no result type,
    as §7 said. After a raised step cap it decodes as the session's does (§7).
27. **A copy's failed build is judged by its own leg.** `ScratchBuffers.noSessionReply` tells a copy's first
    build from a later edit by whether the λ leg has recorded a frame, and it reads `legs.lambda` for every copy.
    A TM copy has no λ leg, so every unparseable edit to a TM copy that had built is reported as a failed build,
    in a notice, where a λ copy's edit shows its diagnostics in the editor alone; the method's own doc records
    this, measured in Chrome, and leaves it. An asm copy would inherit it, so 5c reads the copy's own leg and
    fixes the TM copy with it (§7).
28. **The asm view holds a copy's editor as the TM view does.** The text panel comes first — the editor, in
    `redextape_asm` — then the copy's status and value, the listing, registers beside the call stack, the heap,
    and the outline panel. The `⋯` menu gains *format* while the view holds an editor, and *edit a copy* on a
    view of the program: ready, disabled with amendment 24's reason, or absent when the asm leg is declined or the
    view is on a copy. An editor is destroyed with its view, as a TM copy's is, not held as a λ copy's. A row in a
    copy links nothing and says nothing: the link index describes the program, not a copy (§7), and amendment 19's
    "this instruction has no source construct" is about an instruction `defunc` minted in the program. The TM
    view calls its link handler on a click whatever its session, and that handler resolves the state through the
    program's index; 5c's plan checks by a real click what a TM copy's state links, and if it reaches the
    program's index, guards both views the same way. A blank copy, from *new asm copy*,
    is an empty program, which parses; its run is the cursor's own, a fault at step 0 that reads "ran past end of
    program at pc0" (§6.6, §7).
29. **A step count of one reads in the singular, for every leg.** 5b's asm copy readout would read "1 instructions",
    and so would the program's asm row, λ's "1 reductions" and TM's "1 transitions": the result rows in
    `results.ts` and the copy readouts write each leg's step count as `${n} <plural>`. 5c moves the asm copy
    readout into `readout.ts` beside λ's and TM's, and makes those step counts agree with their number. The asm
    view's panels already do, for arguments and locals (§5.5).
30. **5c touches core and the language server.** §1 said wasm and `web/`. Amendment 22's function is in
    `redextape-core`, beside the parser whose index it reads, and `redextape-lsp` calls it (§1).

**Amended 2026-09-28 again, from 5c's prototype, before its plan.** 31 corrects what amendment 22 said; 32 and 33 are
bugs on `main` the prototype found and fixed, each on both legs; 34 to 37 settle what the text left open:

31. **A label name the printer cannot write back is marked too.** Amendment 22 said `validate`'s check of a name the
    printer cannot write cannot come from parsed text. It can: the parser reads `jmp\ttarget:` and `x,y:` as labels
    with a tab and a comma in their names, as `asm_roundtrip.rs` already pinned. `asm_label_diagnostics` marks such a
    definition, "a label name cannot contain whitespace, `:` or `,`", and a copy refuses it; only a label past the end
    of the code cannot come from text. A property test holds the marks' count to `validate`'s complaints but a
    register's, over random files (§7).
32. **A row in a TM copy linked the program's constructs, on `main`.** Amendment 28 left the plan to check by a real
    click, and the check found it: a click on a TM copy's `wl1s2` row pinned `40` in the source, and on its `pc1` row
    `x`, through the program's link index, which numbers the program's states, not the copy's. The TM view's and the asm
    view's row handlers both return for a copy now, so a copy's rows link nothing and say nothing (§6.6).
33. **A TM view moved off its copy and back had no editor, on `main`.** The same-leg rebind held the editor it left for
    a claim control only λ views offer, and a view arriving at a copy mounts nothing while an editor is held for it, so
    a TM view taken from its copy to the program and back showed the copy with no way to edit it. A TM or asm view
    destroys the editor it leaves now, as the drop pass already destroyed a closed one's, and the view that comes back
    mounts a fresh editor from the copy's text (§7).
34. **A `[continue]` on an asm copy posts `asm-value`.** A copy gets no `result`, so a raise that carries its cursor
    past its build's step cap posts the value its cursor reached on its own (§7's worker line).
35. **A copy's view has a value line and no status line.** Amendment 28 said the copy's status and value. The value
    reads by the TM copy's value-line rule — a value as `value: 6`, any other ending as itself, `fault: head of empty
    list at pc1` — and without a header as its raw word, `42 (no result type)`; the status a line would say is already
    the title's `copy · not linked` and the step line's end (§7).
36. **The bounds, as measured** (amendments 24 and 25). `MAX_SCRATCH_ASM_BYTES` is 5,400,000, the largest generated
    file under the 250 ms, with a loop to the step cap added, in both of two runs: one put 5,600,025 bytes under at
    247.3 ms and 5,800,050 bytes over at 255.4 ms, the other 5,400,000 bytes under at 242.5 ms and 5,600,025 bytes over
    at 250.8 ms; the loop took about 31 ms. It is the run the cost probe adds: the memory probe built its
    heap-then-locals case under `COPY_CAPS` in 40.3 ms, one build in a fresh worker. `COPY_CAPS` is `DEFAULT_CAPS`
    with 2,000,000 heap cells and 12,000,000 saved words: under `DEFAULT_CAPS` a million-word locals bank saved by every
    `call` grew a copy's worker to 629.8 MiB, and under `COPY_CAPS` the worst measured, a heap filled to its cap and
    then saved locals to theirs, 168.4 MiB. Both probes are committed, outside the default test set, and run from
    `web`'s `test:probe:asm-copy` on a build with the `probe-asm-copy` feature. **SUPERSEDED BY AMENDMENT 45'S
    FIGURE** — 5,200,000, once a later run found `both` itself, not the loop, the heaviest run a copy can make,
    and priced it in (§12).
37. **`CopyLeg` is deleted, not widened.** Widened to asm it would be all of `Leg` under a second name; its sites take
    `Leg`, and `tsc` named the four switches over a copy's leg that needed an asm arm (amendment 20).

**Amended 2026-09-28 a fourth time, from executing 5c's plan and its two fix waves.** 38 is the user's decision
that a copy's rows mark nothing for a pin, and 39 the sibling bug the same fix found in the same code; 40
corrects what the whole-branch review found missing, that a copy's view can hold no editor; 41 is the user's
decision that a pending edit reaches the copy it was typed for; 42 is the user's decision closing the final
wave's four remaining UI findings; 43 and 44 are the user's decisions that a free type variable is grounded to
`Nat` and that a function-valued program's TM file is refused up front, both bugs on `main` the final wave found:

38. **A view showing a copy marks none of its rows for a pin, on either leg and by either route a pin takes.**
    Amendment 32 stopped a copy's own row handlers from answering a click; the review that read it end to end
    found the complement missing "in the inbound direction," `link-wiring.ts`'s own phrase for it: `setLinkTo`'s
    fan-out marks every TM and asm view by the program's state and instruction indices, and `draw.ts`'s
    re-applied pin for a view seeded when it is shown (`tmSeeded`/`asmSeeded`) does the same for a view that
    arrives at a copy off the page — neither asked whether a view's session is detached, so a program pin
    painted a copy's rows by whatever the copy happens to have at that index. Found while fixing it, in the same
    code: the two lines that hand the program's running focus to every machine view (`tmPane.setFocus`/
    `asmPane.setFocus`, resolved to the program's indices) did the same. All three now read the view's session's
    own `detached` fact — `link-wiring.ts` inline, `draw.ts` once per view as `unlinked` — and mark nothing for a
    detached session: a copy has no relationship to the program it forked from, so an index read against it
    names whatever the copy has there, not what the program does (§6.6).
39. **Each leg's running focus is read off the most recently focused view of that leg that shows the program.**
    `PaneCollection.active(leg)` answered "the pane the user focused last on this leg," full stop — that
    history is the session's, live whether or not the pane is drawn — so a copy's view focused last was still
    the source of the leg's running focus, reading the copy's own state as the program's and blanking the
    program's marks in every other view of the leg, even one of the program still on the page. `draw.ts` now
    asks `panes.active(leg, onProgram)` for each of the three running focuses, `onProgram` admitting only a
    view whose session is not detached, and the λ link clause's own view the same way. §6.6's "the running
    focus follows TM's precedent" is unchanged in what it reads; only which view is asked for it narrows (§6.6).
40. **A TM or asm view showing a copy whose editor is mounted nowhere mounts one; a view whose copy's editor is
    already held elsewhere offers *move the editor here*, as the λ view's does.** Amendment 33 fixed a view
    moved off its copy and back showing no editor; the whole-branch review found the wider gap: a reload of a
    copy whose stored text does not build (diagnostics in its editor, §8), a cross-leg pick onto a copy, a
    split or `+ view` onto one, and closing the view holding the editor while a split shows the same copy all
    left a view on a copy with no editor and no way to get one. `pane-host.ts`'s TM and asm creation arms now
    call `mountScratchEditor`, as λ's already did; `mountOnViewOf` mounts on the first remaining view of a copy
    once the drop pass or the same-leg arm takes its editor away; `moveBack` mounts on the view it restores.
    Where a live editor for the copy already exists in another view, the two views share it instead — one
    editor per copy, moved rather than rebuilt, cursor, undo and pending typing kept — through the same *move
    the editor here* claim λ views already offer, now on a TM or asm view too (§6.1, §7).
41. **A pending edit reaches the copy it was typed for, on every route.** `PaneEvents.editScratch` resolved the
    target session from the view's CURRENT binding when the debounce fired, so a same-leg pick within the
    debounce put copy A's typing into copy B; a TM or asm view's `destroy()` cancelled a pending edit outright,
    which a cross-leg pick, `reset preset` and the custody sweep all reach. `editSink` is now bound once, when
    a view builds an editor, to the copy it shows then, and never re-pointed — an editor is one copy's for its
    life, as its LSP document already was; `ScratchEditor.destroy()` sends the pending edit before it tears
    down rather than cancelling it; and `flush()` also discharges an edit a format in flight is still carrying
    (`#formatPending`), so the delete and pause handlers, which flush the editor before reading the copy's
    record for undo or its stored text, no longer lose the keystroke a format raced (§7).
42. **`reset preset` puts every view back on the program, the status note names every view that shows a copy, a
    Stage tab's label follows its view's title, and a machine copy's row in the copies menu says what its
    readout says of its run.** `reset preset` rebuilt the tree without checking whether a surviving entry
    showed a copy, so a view could still show one while the notice said the default views were back;
    `pane-host.ts`'s `resetViews` now drops such an entry in its first pass — the same editor handover a close
    gets — and builds it again on the program in its second. The status note that names a detached leg now
    names every view showing a copy, by title where a leg has more than one (`asm · copy 1 view shows a copy —
    not linked to the program`; `λ, asm · copy 10 and TM views show copies — not linked to the program`),
    reading `link-wiring.ts`'s `detachedPanes` over every view of every leg rather than the one view `theSlot`
    used to pick. A Stage tab kept the label it was created with; `layout-view.ts`'s `retitleStage` now writes
    every `.stage-tab`'s title each frame. A machine copy's row in the copies menu read `no term yet` or
    omitted its own status; `readout.ts`'s `asmCopyRow`/`tmCopyRow` now join the same facts the view's own
    status and value lines use, without the name — `5 instructions · value: 42`, `1 instruction · fault: head
    of empty list at pc1` (§7).
43. **A free type variable in a result header is written as `Nat`, in asm and TM headers alike, in the session
    and the CLI.** `[]`'s type, `List<Var>`, printed as `List<t1>` — a header line neither `AsmHeader::for_type`
    nor a `.tm` file's reader accepts — so an asm copy of `[]` got no header at all (its value read `0 (no
    result type)` where the program's own read `[]`) and, on `main` too, a TM copy of `[]` or `[[]]` never
    built. `ty::ground` grounds every `Ty::Var` to `Ty::Nat`, under `List` and inside `Fun` too, on the
    reasoning that a closed value holds nothing of a free variable's type and `Nat` is a choice any value type
    satisfies; `AsmHeader::for_type` and `describe_at` (the one place a program's type becomes a `TmHeader`)
    both ground before naming a header's type, so `emit --lang asm`, `emit --lang tm` and the session's own
    `asmScratch`/`tmScratch` text agree (§7).
44. **A function-valued program has no TM file: `emit --lang tm` refuses it up front, the session offers no TM
    text, and the TM view's *edit a copy* is disabled with that reason, as asm already gives no header for a
    function type.** `describe_at` handed a function's grounded type straight to `TmHeader::new`, so
    `redextape emit --lang tm` of `|x| x + 1` wrote a `result (Nat) -> Nat` line `run`'s own parser refuses,
    and the session's `tm_text()` printed the identical text — on `main` too, *edit a copy* on such a
    program's TM view made a copy that could never build. `ty::is_decodable` is `AsmHeader::for_type`'s own
    round-trip check (`parse_ty(&show(&ground(ty))).is_some()`) pulled out as the one predicate a header
    writer asks, and `ty::is_decodable_ground` its form for a type already grounded, which `emit_tm` and
    `Session::tm_text` ask, since each grounds the type once itself; `emit_tm` asks it before any lowering
    and refuses with a message naming the grounded type, at the exit code every other unemittable program
    uses, and `Session::tm_text` answers `None` for the same case,
    beside a declined leg. `Session::tm_result_decodable` crosses the wasm boundary unconditionally, like
    `asmText`, so `CopyEditor` disables *edit a copy* with this reason rather than the size reason amendment
    24 already sets apart from it; the TM leg itself still builds and runs a function-valued program exactly
    as before — only the emitted file's or a fork's text is refused, not the machine (§7, §8).

**Amended 2026-09-28 a fifth time, from the final fix wave's ceiling correction.** 45 is the human's decision to
lower the asm copy ceiling and have its cost probe price every run the memory probe knows, not the loop alone:

45. **The ceiling is 5,200,000, and the cost probe prices every run the memory probe knows, priced apart, adding
    the heaviest to every size's total** (supersedes amendment 36's figure). Amendment 36's bracket was not
    stable under its own method: re-running `test:probe:asm-copy` three times on a quiet machine found
    `asm-copy-memory.test.ts`'s `both` — a heap filled to `COPY_CAPS`' cap, then locals saved — heavier than the
    loop in every run (medians 38.4, 36.1 and 38.8 ms against the loop's 32.1, 30.7 and 32.9), and with `both`
    added 5,400,000 was over the 250 ms budget in two of the three runs (254.3, 256.7 ms) where 5,200,038
    stayed under in all three (241.5, 243.9, 245.5 ms). The human decided: lower `MAX_SCRATCH_ASM_BYTES` to
    5,200,000, and have `asm-copy-cost.test.ts` price every run `asm-copy-memory.test.ts` knows — its `CASES`
    and `both`, at `COPY_CAPS`' heap cap — beside the loop, each its own `RUN` row, adding whichever comes out
    heaviest to every size's total, so the rule and the measurement can never again name different runs.
    `asm-copy-corpus.ts` now holds `CASES` and `both` for both probes to import, rather than each keeping its
    own copy in step by hand. This fix wave's own run agrees: `both` 39.0 ms against the loop's 31.6 — heaviest
    again — with 5,200,038 bytes under budget at 245.4 ms and 5,300,019, the next size up, over it at 250.2 ms
    (§7, §12).

**Amended 2026-09-28 a sixth time, from the final fix wave's third round.** 46 is the human's decision that the
copies menu names a copy's worker only when it is paused:

46. **A copy's row in the copies menu says nothing of a live copy's worker, and keeps `paused` for one that
    has none.** Plan 7 part 2's design §10 gave the row "*running* or *paused*", opposite whether the copy
    holds a worker; beside a halted copy's own `value: 42` — its run's own line already saying what became of
    it — `running` read as the machine still executing, seen by hand at `asm copy 1 · not shown · running`,
    step 55 of 55. `buffer-list.ts`'s `bufferRow` now appends the word only when the row is cold; a live row's
    name line ends at its view count. The rule is the menu's, not a leg's: a λ, TM or asm copy's row all drop
    the word alike. Part 2's §10 is not rewritten; this amendment is its correction of record (part 2's §10).

## §1 Scope, and the three PRs

| PR | Contains | Touches |
|---|---|---|
| **5a** | `AsmCursor`; `run_asm` as a loop over it; display tags and written bits; the `SourceMap` and `LinkIndex` keeping each instruction's owner; the three checks of §4.4 | Rust only, `redextape-core` |
| **5b** | a refactor with no behaviour change that turns every two-way λ/TM branch into an exhaustive one; a grid module extracted from the TM rule table (amendment 7); the asm view model; the wasm asm leg; protocol, worker and session support for a third leg; the asm view with its listing, registers, call stack and heap panels; linking; the readout's third segment; the new default tree | `redextape-core`'s view model (amendment 6), `redextape-wasm`, `web/` |
| **5c** | asm copies: *edit a copy*, `asmScratch`, the asm editor with part 3's language support, stored copies (`BUFFERS_VERSION` stays 2, amendment 23), *new asm copy*; diagnostics for a label that names nothing or is defined twice (amendment 22) | `redextape-core`'s asm syntax and `redextape-lsp` (amendment 30), `redextape-wasm`, `web/` |

5a lands first and alone; 5b builds on it; 5c builds on 5b. The umbrella's §3 note that part 5's core half
can run beside `web/` work still holds for 5a.

## §2 What exists

### §2.1 The interpreter runs to completion and cannot step

`run_asm(prog, caps) -> AsmRun` (`crates/redextape-core/src/tm/asm.rs:544`) is one fetch-decode-execute loop
over a private `Vm` (`asm.rs:459`): `locals`, `args`, `rr`, a `heap` of cons cells, `boxes`, a call `stack`
of `Frame { ret_pc, saved_locals }`, `pc`, `steps`, `caps`, and a running count of saved words. It returns
`Ran(AsmOutcome { result, heap })`, `HitCap` or `Fault(String)`. `DEFAULT_CAPS` is 5,000,000 steps, 100,000
frames, 5,000,000 heap cells and 64,000,000 saved words (`asm.rs:429`). Nothing can observe the machine
between two instructions.

Registers hold untyped `u64` words. `Core` carries no types and `lower_asm` reads none, so at run time a
list pointer `3`, the number `3` and a box handle `3` are the same word.

`run_asm` has one production caller, the CLI's `run_asm_artifact`; the rest are tests and
`redextape-native`'s oracles. `redextape-wasm` does not call it: the web app runs no asm today.

### §2.2 Every instruction already knows its construct

`lower_asm_mapped` (`crates/redextape-core/src/tm/lower_asm.rs:151`) returns `(Program, Vec<NodeId>)`, where
`origins[i]` is the `Core` node whose lowering emitted `code[i]`; jumps, prologues and frame setup bill their
enclosing construct, and the final `halt` bills the root. The map is deliberately kept off `Program` so
`Program`'s equality and the goldens do not see it.

`SourceMap`'s `tm_half` (`crates/redextape-core/src/sourcemap.rs:185`) composes it with `lower_tm_mapped`'s
state-to-instruction map, skips the ids `defunc` minted, keeps `tm_name_to_instr`, `tm_listing` and
`tm_labels`, and discards `origins`. After a compile nothing holds instruction → construct. 4b's
`TmProgram.listing`/`labels` and `StateView.instr` are the only asm the web app sees, drawn by the TM
view's program level.

### §2.3 The web app knows exactly two legs

`Leg = 'lambda' | 'tm'` (`web/src/protocol.ts:260`) and `PaneKind = 'source' | 'lambda' | 'tm'`
(`web/src/panes.ts:16`). An inventory by reading at `a4e7c6f` found **14 two-way branches on the leg**, most of
which treat every leg that is not λ as TM, and none of which the compiler can flag when a third leg
arrives (re-derived for 5b and larger, amendment 8) — among them
`session-worker.ts:779` (`onExtend`), `scratch.ts:869` and `:1048` (`tmScratch` in the else),
`view-header.ts:28` (`legLabel`), `pane-host.ts:1030` (the else builds a `TmPane`), and `draw.ts:362`
(`isLambda ? … : tmCopySegments`) — plus hand-written two-leg lists such as `LEGS`
(`web/src/sessions.ts:214`), `PANE_KINDS` (`web/src/layout.ts:382`) and the readout's
`[leg('λ'), leg('TM')]`. The inventory is not a gate; §5.1 makes the compiler the gate.

What is already generic over the leg and needs no change: `History`, `player.ts`, `controls.ts`,
`PaneSlot<K>`, and the step bar's binding.

### §2.4 asm language support is served and unconsumed

`redextape-lsp` serves asm diagnostics, format, hover (part 3c), outline and navigation, and `colour.ts` loads
the asm grammar — but `LANGUAGE_OF_PANE` has no asm key and no editor mounts asm (`lsp-protocol.ts:84`: "has
no editor until part 5"). Part 3's spec §5.1 chose this shape so that part 5 inherits a proven language.

### §2.5 asm runs are short

Measured over the three-way oracle's `FIRST_ORDER_DEMOS` (46 programs) and four larger programs (§12):

| Program | Instructions | Steps | Max call depth | Heap cells | Locals | Args |
|---|---|---|---|---|---|---|
| `fact(3)` | 21 | 55 | 4 | 0 | 9 | 1 |
| `fact(12)` | 21 | 181 | 13 | 0 | 9 | 1 |
| `sum(1000)` | 21 | 14,013 | 1,001 | 0 | 9 | 1 |
| `upto(200)` | 21 | 2,813 | 201 | 200 | 9 | 1 |
| a `while` loop, 100,000 turns | 19 | 1,400,009 | 0 | 0 | 13 | 0 |
| corpus maximum | 107 | 260 | 7 | 11 | 23 | 3 |

`fact(3)` is 1,319 λ reductions and 18,574 TM transitions (umbrella §11) against 55 asm steps. "Heap cells"
is the larger of cons cells and boxes, since both are bounded by one cap; "locals" and "args" are one more
than the highest register index the program names.

One behaviour matters for the view: **`call` does not clear the locals.** The callee runs on the caller's
register values until it overwrites them, so inside `fact(0)` the registers `r4`–`r8` still hold `fact(1)`'s
values (hand-traced from the emitted listing, §12).

## §3 Decisions

Made by the user on 2026-09-27, each from a set of options with mockups drawn from `fact(3)`'s listing.

| # | Topic | Decision | Declined |
|---|---|---|---|
| 1 | asm copies | *Edit a copy* extends to asm, in part 5 | a read-only listing; copies later as their own part |
| 2 | Delivery | Three PRs: core, view, copies | four, with the refactor alone; two, with view and copies together |
| 3 | Panels | Registers, call stack and heap, each a collapsible panel | registers and call stack; registers only |
| 4 | Default tree | asm beside TM: source \| λ above asm \| TM | three across the top above TM; asm not in the default |
| 5 | Recording | One windowed frame per step into the existing `History` ring | small frames with state served on demand; delta frames with shared logs |
| 6 | Running line in a copy's editor | Out of part 5, recorded as a leftover | — |

Decision 4 changes what "reset preset" and a first load build. Stored layouts stay valid and keep their
arrangement; asm reaches them through `+ view`, split and the title menus.

## §4 5a — the core

### §4.1 `AsmCursor`

A stepper in the `trace` module beside `TmCursor` and `LambdaCursor`, in its own file,
`trace/asm_cursor.rs` (amendment 4). It **owns the `Vm`
that `run_asm` holds today — moved, not copied**, so the semantics exist once. It iterates, one item per
executed instruction, naming the instruction it executed; whether that item is a new `StepEvent` variant or
its own type is the plan's call, since a variant touches every match on `StepEvent`. It exposes:

- `pc`, `rr`, `locals`, `args`, the call stack, the heap, the boxes, `steps_taken`;
- `wrote()`, the register the last instruction wrote, if any;
- `status()`: running, halted, faulted with the fault's text, or capped **naming which cap** (steps, stack,
  heap or memory) — §8 needs to know whether raising the step cap can help;
- `raise_cap(extra_steps)`, additive, like `TmCursor::raise_cap`.

### §4.2 `run_asm` becomes a loop over the cursor

Its signature, its `AsmRun` results, its caps and its up-front `MAX_REGISTERS` guard are unchanged, so the
CLI, `redextape-native` and every oracle keep calling it as they do. Every existing test and golden must
pass unchanged; that is 5a's first gate. It runs slower — 6.2 ms against 3.9 ms on 1,400,009 steps
(amendment 3).

### §4.3 Display tags and written bits

Each word the cursor holds carries a tag — *value*, *list* or *box* — set by the instruction that creates it
and copied by everything that moves it:

| Creates | Tag |
|---|---|
| `li`, arithmetic, comparisons, `isempty` | value |
| `cons`, `nil` | list (`nil` is the list word 0) |
| `box` | box |
| `mov`; `head` and `tail`, which return the tag stored with that half of the cell; `box_get`, which returns the box's stored tag | the source's tag (amendment 1) |

Heap cells store their head's and tail's tags, boxes their content's tag, and a call frame its saved
locals' tags. For a compiled program this is exact by construction: every word originates at one creating
instruction and every other instruction copies. A hand-written copy can use a *value* as a pointer; the tag
then says *value*, which is true of how the word was made.

Each local also carries a **written bit**: set when the local is written, cleared for every local on `call`
(the callee starts with none written), and restored with the saved locals on `ret`. It drives the view's
"left over from caller" mark (§6.3).

Tags and bits are display state. `run_asm`'s results cannot depend on them. §4.4's oracles run compiled
programs and cannot see a violation; a property test over hand-built programs holds the rule (amendment 5).

### §4.4 The checks — amending umbrella §8.3

§8.3's oracle compares stepping to the end against `run_asm`. Once `run_asm` is the cursor's loop, both sides
run the same code and the check cannot fail. It is replaced by three:

1. **The independent oracles keep passing with `run_asm` on the cursor**: `asm_oracle.rs` (reference ==
   `run_asm` + decode), `tm_oracle.rs` (`run_asm` == TM, both encodings) and `redextape-native`'s
   `native_oracle.rs`. These already hold asm's results against implementations that share no code with it.
2. **The cursor's instruction sequence equals the TM's.** `lower_tm` builds one entry state `pc{i}` per
   instruction, meaning "about to execute instruction `i`". Simulating the machine and recording a `pc{i}`
   each time the machine enters one from a different state yields the sequence of instructions executed,
   by a second implementation. **Measured before this spec (§12): the number of such entries equals the asm
   step count on all 92 runs** — the 46 corpus programs under unary and binary. **And measured in 5a's
   prototype: the sequences are equal on all 100 runs** of those programs and the 4 latent traps
   (amendment 2). The entry rule is "a different state from the step before", not "every step in
   `pc{i}`", because unary's gadgets loop on their own entry states (69 such self-loop rules in one corpus
   machine; binary has none). That rule would merge an instruction that jumps to itself, which only a
   program that never halts contains.
3. **At halt, `rr`'s tag agrees with the program's result type**: *list* for `List<T>`, *value* for `Nat`,
   `Bool` and `Unit`, over the corpus.

Each gets sabotages in the plan that show it can fail: a cursor that mis-steps a `jz`, a `call` that pushes
the wrong return address, a `mov` that drops its tag.

### §4.5 The maps keep each instruction's owner

`SourceMap` gains `asm_owner: Vec<Option<NodeId>>` — `origins` with `defunc`'s minted ids mapped to `None`,
the rule `tm_half` already applies — and `node_to_asm: BTreeMap<NodeId, Vec<usize>>`, its inverse.
`LinkIndex` gains an asm column beside `tm_owner`. The asm leg needs the lowered `Program` itself as well as
its maps; the plan decides whether it comes from `tm_half`'s lowering or a shared one, since the program is
lowered more than once per compile today.

## §5 5b — the third leg

### §5.1 First, a refactor that changes no behaviour

Task 1 of 5b turns each of §2.3's two-way branches into a `switch (leg)` ending in an exhaustive `never`
check, or a `Record<Leg, …>` table, and rebuilds the hand-written two-leg lists from `LEGS`. No test changes.
It also gives `replies.ts`'s two switches and the worker's request dispatch an exhaustive end (amendment 8).
Then adding `'asm'` to `Leg` and `PaneKind` makes `tsc` name every site still to handle. The plan records
the sibling search — the grep and its output over `web/src` and `web/tests` for `'lambda'`, `'tm'`, `λ` and
`TM` literals — so the inventory in §2.3 is re-derived rather than trusted.

### §5.2 wasm

`Session` gains `asm: Result<AsmLeg, LowerError>`. asm is absent only when lowering fails; where TM declines
a program as too large or overflowing, asm still runs. Methods, named as the λ and TM ones are:
`asmStatus`, `stepAsm`, `asmState(window)`, `raiseAsmCap`, `asmValue`, and `asmProgram`.

- `compile` runs the asm leg to its end, as it already runs TM, so `asmStatus` carries the total step count
  and the step bar can say "step 23 / 55". That run's outcome is what `asmValue` decodes until the recorded
  cursor passes it, and the recorded cursor is a fresh one (amendment 13).
- `asmProgram` is a generated wire type carrying the listing (one `print_instr` line per instruction) and the
  labels; each instruction's owner travels in the link index as `asmOwner` (amendment 14). The TM view keeps its
  own `TmProgram.listing`; the two are the same text from one printer.
- `asmValue` decodes `rr` by the program's result type (`decode_asm_ty`).

### §5.3 The frame

`AsmState`, one per step, bounded by construction. It is declared in core's `viewmodel.rs` and built by
`AsmState::window` from the cursor, with the bounds below as its parameters (amendment 6):

| Field | Bound |
|---|---|
| `step`, `pc`, `rr` and its tag | — |
| `locals` with tags and written bits | the first 64 |
| `args` with tags | the first 16 |
| `wrote` | — |
| `depth`, and the top call frames, each its return `pc` and saved locals with tags | 8 frames |
| `heap_len`, and the newest cells plus every cell a *list* register points at | 16 newest |
| `box_len`, and boxes | 16 |
| `source_node`, the current instruction's owner | — |

Every corpus program fits whole (§2.5); a deep or list-heavy run shows a window. The bounds are starting
values: 5b's plan measures `asmFrameBytes` over the corpus and the §2.5 programs and fixes them — it keeps them
(amendment 17). A frame's
callee is not carried — the instruction before its return `pc` is the `call` naming it.

**A word travels as a decimal string.** Saturating `mul` reaches `u64::MAX`, which a JS number cannot hold
exactly, and which the wasm crate's serializer refuses outright (amendment 13); one form for every word keeps
every reader free of a branch. The `ts_bindings` gate's rule that a
`u64` never becomes `bigint` is met by the string.

### §5.4 Protocol and worker

- `Leg = 'lambda' | 'tm' | 'asm'`; `PaneKind` gains `'asm'`.
- `compiled` gains `asm` (its status) and `asmProgram`; `result` gains an asm leg; a new `asm-frames` reply;
  `extend{ leg: 'asm' }`. `RecordEnd` gains one value per hard cap (amendment 10).
- The worker's `recordAsm` has `recordTm`'s shape. `onRun` records λ, then asm, then TM: asm is the
  cheapest leg per step, and TM's recording can run to the 32 MiB budget before a later leg starts.

### §5.5 Around the edges

- **Readout.** A third segment, *asm*: its steps as "N instructions" and its value.
- **Vocabulary.** A step is an *instruction*, as TM's is a *transition* and λ's a *reduction* (umbrella §4).
- **Layout.** `PANE_KINDS` gains `asm`. `defaultLayout()` becomes (source | λ) above (asm | TM) (§3, row 4;
  amendment 12).
  `LAYOUT_VERSION` stays 1: every stored layout is still valid.
- **Language.** `LANGUAGE_OF_PANE` gains `asm → redextape_asm`, used by 5c's editor.
- **Link.** A pin's origin becomes `'source' | Leg`, so it gains `'asm'` (amendment 8).

## §6 5b — the asm view

### §6.1 Layout

The header follows umbrella §4: `asm · program ▾` (the title is the selector) · status · step controls
(when the switch puts them in the view) · `⋯` · `✕`. Each panel's toggle and actions sit in its own header,
as the TM view's do (amendment 9). The `⋯` menu holds split right, split down and, from 5c, *edit a copy*; a
view of a copy whose editor another view already holds offers *move the editor here* too, the λ view's own
control, now on a machine view as well (amendment 40).

The body is a flex column whose open panels share the height, 4b's mechanism: **listing** two shares,
**registers** and **call stack** side by side in one share (stacking when the view is narrow), **heap** one
share. Each body keeps at least five rows. Each panel's open state is saved per view, as the TM view's are.

### §6.2 Listing

A `role="grid"` built on the grid module extracted from 4b's rule table (amendment 7), and virtualized,
because a copy can be long:
one tab stop, an active row named by `aria-activedescendant`, and the arrows, PgUp/PgDn and Home/End moving
it past the drawn window. Label rows sit above the instruction they name, as `print_asm` writes them;
instruction rows read `pc5  jz  r1, else2`. The instruction about to run is `.is-next` and says "runs next"
as generated content — the not-colour cue 4b gave TM's "fires next". A *follow current instruction* action
in the listing panel's header (amendment 9) re-attaches following, with 4b's `Follow` and its resize-clamp handling; a user scroll or a key that
scrolls detaches it. Row containers take no focus on `mousedown` (4b amendment 18), so a real click lands.

### §6.3 Registers

`pc`, `rr`, `a0…` and `r0…` as name and value. By tag, a word reads as decimal (*value*), `#3` or `nil`
(*list*), or `box #2` (*box*). The register `wrote` names is marked *changed*. A local whose written bit is
clear is dimmed and marked `·`, with a one-line legend, "left over from caller" — "not written yet" at depth 0
(amendment 18); each mark also carries an `aria-description`, so none is colour alone.

### §6.4 Call stack

"call stack · 4 frames", top first. Each frame reads the function it called, `→ pc14` and its saved locals.
Past 8, "+N more".

### §6.5 Heap

"heap · N cells · M boxes", newest first: `#57  57 → #56  ← r5`. The back-reference lists the *list*
registers whose word is that cell, so it is exact for a compiled program. Past the window, "+N older".

### §6.6 Linking

Node-based, the mechanism TM uses:

- Clicking or pressing Enter on an instruction row pins its owner. The source editor, the λ view, every TM
  view and every asm view mark the construct; an asm view marks every instruction billed to it.
- A click in the source or a TM view marks the owned instructions in each asm view and scrolls to them; the scroll
  holds until the run moves (amendment 21).
- An instruction with no owner — one `defunc` minted — links to nothing, and the link status says so in a
  sentence of its own (amendments 11 and 19).
- **The running focus follows TM's precedent.** `AsmState.source_node` feeds the asm view's own marks and the
  link-status line's coincidence with the pin. The source editor's focus mark stays λ's, as Plan 5c's
  dual-focus design settled; making it follow the focused view is out of scope (§10).

### §6.7 Accessibility

Nothing is announced per step, as for TM (part 4's §9.3). Every visual mark has a text or ARIA equivalent.
The controls gate (umbrella §8.1) walks the asm view in every preset; its `viewLeaves()` gains the asm leaf.

## §7 5c — asm copies

- **Making one.** *Edit a copy* in the asm view's `⋯` menu copies the whole program with its `result`
  header, as `print_asm_with` writes it; its tooltip says "the whole program", beside λ's "the term at this
  step" and TM's "the whole machine". `compiled` carries the text as `asmText` under `MAX_SCRATCH_ASM_BYTES`,
  the one byte cap that also bounds `asmScratch` (amendment 24; its current figure, 5,200,000, is amendment
  45's, which supersedes amendment 36's).
- **Running one.** `asmScratch(src)` runs `parse_asm_full` under that cap, refuses text carrying amendment 22's
  label diagnostics, runs the program to its end (amendment 26), and returns an `AsmScratch` with the asm leg's
  methods, under caps measured against its worker's memory (amendment 25). Its listing comes from the parsed
  program; no instruction has an owner, so a copy links to nothing (amendment 28).
- **Its value.** Decoded by the header's `result` type when there is one; without it, the raw `rr` word,
  marked as having no result type. It arrives with the build (amendment 26).
- **The worker.** `onAsmScratch` and an `asm-scratch-compiled` reply; frames are 5b's `asm-frames`. A failed
  build is judged by the copy's own leg (amendment 27).
- **Stored copies.** `PersistedBuffer.leg` gains `asm`: 5b's `CopyLeg` is deleted, not widened, and a copy's leg is
  any `Leg` (amendment 37, which replaces amendment 20's widening); `BUFFERS_VERSION` stays 2, since every v2 store is
  still valid now that a copy's leg may be asm (amendment 23).
- **The copies menu** gains *new asm copy*, as TM has a blank copy.
- **The editor.** A copy mounts a `ScratchEditor` in `redextape_asm`, so diagnostics, format, hover, outline,
  definition, references and colour arrive from part 3 unchanged, with amendment 22's label diagnostics added.
  The view holds it as the TM view holds a TM copy's (amendment 28). A view of the copy with no editor mounted
  anywhere mounts one, and a view whose copy's editor another view already holds offers *move the editor here*
  instead — one editor per copy (amendment 40).

## §8 When things fail

Each leaves a working app and at most one notice; none blocks editing or compiling (umbrella §7).

- **Lowering fails.** The asm leg is absent and the view says why, as TM's decline does.
- **A fault** (`head` of an empty list). The run ends as `ended` with a fault value — "head of empty list at pc12"
  (amendment 15) — the end state umbrella §7 assigns.
- **The step cap.** `capped`; *record further* raises it, as for λ and TM.
- **The stack, heap or memory cap.** Raising steps cannot help, so no continue is offered, as for λ's depth
  refusal, and the step line names the cap (amendment 10).
- **The history budget.** `budget`, as for λ and TM.
- **A copy that does not parse**, or names a label that is not there or defines one twice (amendment 22).
  Diagnostics in its editor and no session, as for TM.

## §9 Testing

| Where | What |
|---|---|
| Rust (5a) | §4.4's three checks; the tag table of §4.3 row by row; written bits across `call` and `ret`; `status()` naming each cap; each with sabotages |
| wasm | `tests/browser.rs` cases for every asm method and the declined leg; the `ts_bindings` gate over the new types |
| node | frame windows; word formatting by tag; `asm` in layout validation; a v2 store holding an asm copy (amendment 23); `LANGUAGE_OF_PANE`'s keys |
| browser | the listing by real pointer clicks as well as keys (4b's lesson); follow and detach; linking in both directions; the readout's third segment; the controls gate; the asm editor's diagnostics, format, hover and outline (umbrella §8.5) |
| by hand | the three presets, light and dark, at 1280×800, including the new default tree |

Before each PR, beyond `check-all`: the 90% llvm-cov floor, `check-slow.sh`, the six hygiene scans, and
building and running the Docker image, which no PR job builds.

## §10 Out of scope

- **The running instruction's line in a copy's editor** (§3, row 6). `parse_asm_nav` computes each line's
  span only for diagnostics and pushes instructions with no position, so this needs core work first.
- **The source editor's focus mark following the focused view** (§6.6).
- **Linking asm to TM by instruction** rather than by construct. 4b's `StateView.instr` would allow it; it is
  a second link mechanism.
- **Register types from the compiler.** §4.3's tags answer what the view needs at run time; a typed register
  file would need types threaded through `lower_asm`.
- Synchronized stepping across views (umbrella §10).
- **The state diagram and the λ body on 5b's grid module** (amendment 7): a PR of its own after 5b. The λ body
  has neither the `ResizeObserver` nor the `mousedown` guard the other two grids carry, and that PR decides
  each on its own evidence.

## §11 Delivery

Each PR gets its own plan, built and gated in a scratch worktree before it is handed out, as 4a's and 4b's
were, and its own roadmap entry. 5a's plan measures §4.4's sequence equality before any task is written
around it.

## §12 Figures, and what produced them

| Value | What | Produced by |
|---|---|---|
| 21, 4, 55, 4, 9, 1 | `fact(3)`'s instructions, labels, steps, call depth, locals and args | `asmprobe` (§A) with `'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'` |
| 181 and 13 | `fact(12)`'s steps and depth | `asmprobe` with `… fact(12)` |
| 14,013 and 1,001 | `sum(1000)`'s steps and depth | `asmprobe` with `fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(1000)` |
| 2,813, 201 and 200 | `upto(200)`'s steps, depth and heap cells | `asmprobe` with `fn upto(n) { if n == 0 { nil } else { cons(n, upto(n - 1)) } } upto(200)` |
| 1,400,009 | steps of a 100,000-turn `while` loop | `asmprobe` with `let mut n = 100000; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc` |
| 107, 260, 7, 11, 23, 3 | the corpus maxima of §2.5 | `asmprobe` with no arguments, over `FIRST_ORDER_DEMOS` copied from `tests/three_way_oracle.rs` at `a4e7c6f` |
| 92 of 92 | runs whose `pc{i}` entry count equals the asm step count | `tmtrace` (§A) with no arguments |
| 69, and 0 | the most self-loop rules on `pc{i}` states in one unary corpus machine (program 26), and in any binary one | `tmtrace`'s `pc_selfloops` column, its maximum over the `u` rows and every `b` row |
| 1,319 and 18,574 | `fact(3)`'s λ reductions and TM transitions | umbrella §11 |
| 100 of 100 | runs whose asm instruction sequence equals the TM's `pc{i}` entries (amendment 2) | 5a's `asm_steps_are_the_instructions_the_tm_enters`, in its prototype |
| 3.9, 6.2; 0.059, 0.119; 0.013, 0.028 ms | `run_asm` before and after the cursor on the loop, `sum(1000)` and `upto(200)` (amendment 3), at 5a's plan's final state | 5a's plan, its appendix's `asmbench`: the median of 15 runs, two rounds each, alternated with `main` |
| r4–r8 left over in `fact(0)` | §2.5's `call` behaviour | hand-traced from `redextape --no-config emit fact.rxt --lang asm` against `run_asm`'s `Call` arm |
| 14 | two-way branches on the leg | a read of `web/src` at `a4e7c6f`, each of the 14 then re-read at its line with `sed` |
| 1,000,000 | `MAX_REGISTERS` (amendment 22) | `crates/redextape-core/src/tm/asm.rs`'s `const MAX_REGISTERS`, at `e29df3c` |
| 64,000,000 words; ten bytes; 640,000,000 bytes; 64 calls | the memory cap; a saved local's size; their product; the nested calls a million-word bank needs to reach it (amendment 25) | `DEFAULT_CAPS.mem` in `tm/asm.rs`; `trace/asm_cursor.rs`'s `Frame`, which saves a `u64`, a one-byte `WordTag` and a `bool` per local (5a's roadmap entry measured the size); arithmetic |
| 11 | warm copies, each in its own worker (amendment 25) | `web/src/scratch.ts`'s `MAX_WARM_BUFFERS` and `session-client.ts`'s `SessionPool.bind`, at `e29df3c` |
| 256 MiB | a copy worker's peak memory budget (amendment 25) | set by the user, not measured |
| 250 ms | the budget an initiated gesture may take (amendment 24) | `MAX_SCRATCH_TM_BYTES`' doc in `crates/redextape-wasm/src/session.rs` |
| 5,200,038 bytes under budget in all four runs (241.5, 243.9, 245.5 and 245.4 ms); 5,400,000 bytes over it in two of the three runs that priced it (254.3, 256.7 ms), and 5,300,019 over it in the fourth (250.2 ms); `both`, at `COPY_CAPS`' heap cap, the heaviest run known in every run, at medians 38.4, 36.1, 38.8 and 39.0 ms against the loop's 32.1, 30.7, 32.9 and 31.6; the ceiling, 5,200,000 | each of four runs' largest file under the budget and smallest over it, with the heaviest run the memory probe knows — `both`, not the loop alone — added; that run; the ceiling (amendment 45, supersedes amendment 36's figure) | `cd web && pnpm run test:probe:asm-copy`, `asm-copy-cost.test.ts`'s `SIZE`, `RUN` and `BRACKET` rows, three times in the controller's ceiling measurement and once in the final fix wave |
| 40.3 ms | the memory probe's build of a copy that fills the heap to `COPY_CAPS`' cap and then saves locals, one build in a fresh worker (amendment 36) | the same command, `asm-copy-memory.test.ts`'s `MEM COPY_CAPS both` row's `build_ms`, as 5c's plan records it in its Task 6's Step 4 |
| 629.8 MiB; 168.4 MiB | a copy's worker filling `DEFAULT_CAPS`' saved frames; the worst under `COPY_CAPS` (amendment 36) | the same command, `asm-copy-memory.test.ts`'s `MEM` rows, in 5c's prototype |

Both probes are built with `CARGO_TARGET_DIR` under the repo's `target/` and run under
`systemd-run --user --scope -p MemoryMax=4G` (8G for `tmtrace`).

## §A Probe sources

A scratch crate depending on `redextape-core` by path; `src/corpus.rs` is `FIRST_ORDER_DEMOS` copied from
`tests/three_way_oracle.rs`. **`asmprobe` re-implements no part of the VM**: every run-time figure is the
least cap under which `run_asm` still returns `Ran`, found by bisection, so it measures `run_asm` itself.

`src/main.rs` (`asmprobe`):

```rust
//! Design-stage probe for Plan 7 part 5: per program, the asm run's shape, measured through
//! `run_asm`'s public caps by bisection so nothing here re-implements the VM.
mod corpus;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::asm::{AsmRun, Caps, DEFAULT_CAPS, Instr, Program, Reg, run_asm};
use redextape_core::tm::{LowerError, defunc, lower_asm};

fn program(src: &str) -> Option<Program> {
    let (p, ds) = parse(src);
    if !ds.is_empty() { return None; }
    let core = desugar(&p?);
    match lower_asm(&core) {
        Ok(p) => Some(p),
        Err(LowerError::Unsupported { .. }) => lower_asm(&defunc(&core).ok()?).ok(),
        Err(_) => None,
    }
}

fn ran(p: &Program, c: Caps) -> bool { matches!(run_asm(p, c), AsmRun::Ran(_)) }

/// Smallest v in [1, hi] with ok(v), given ok is monotone and ok(hi).
fn least(hi: u64, ok: impl Fn(u64) -> bool) -> u64 {
    let (mut lo, mut hi) = (0u64, hi); // ok(lo) false-or-untested, ok(hi) true
    while hi - lo > 1 { let m = lo + (hi - lo) / 2; if ok(m) { hi = m } else { lo = m } }
    hi
}

fn regs(i: &Instr) -> Vec<Reg> {
    use Instr::*;
    match i {
        Li(a, _) | Jz(a, _) | Nil(a) => vec![*a],
        Mov(a, b) | Head(a, b) | Tail(a, b) | IsEmpty(a, b) | Box(a, b) | BoxGet(a, b) | BoxSet(a, b) => vec![*a, *b],
        Bin(_, a, b, c) | Cons(a, b, c) => vec![*a, *b, *c],
        Jmp(_) | Call(_) | Ret | Halt => vec![],
    }
}

fn main() {
    println!("idx\tinstrs\tlabels\tsteps\tdepth\theap\tsavedw\tlocs\targs\tsrc");
    let extra: Vec<String> = std::env::args().skip(1).collect();
    let list: Vec<&str> = if extra.is_empty() { corpus::FIRST_ORDER_DEMOS.to_vec() } else { extra.iter().map(String::as_str).collect() };
    for (k, src) in list.iter().enumerate() {
        let Some(p) = program(src) else { println!("{k}\t-\t-\t-\t-\t-\t-\t-\t-\t{src:.60}"); continue };
        if !ran(&p, DEFAULT_CAPS) { println!("{k}\tno-run\t{src:.60}"); continue; }
        let steps = least(DEFAULT_CAPS.steps, |v| ran(&p, Caps { steps: v, ..DEFAULT_CAPS }));
        // `stack` cap: `stack.len() >= cap` refuses a call, so the least passing cap is the max depth
        // reached; 0 passes when no call is made, which `least` over [1,..] reports as 1.
        let depth = if ran(&p, Caps { stack: 0, ..DEFAULT_CAPS }) { 0 } else { least(DEFAULT_CAPS.stack, |v| ran(&p, Caps { stack: v, ..DEFAULT_CAPS })) };
        let heap = if ran(&p, Caps { heap: 0, ..DEFAULT_CAPS }) { 0 } else { least(DEFAULT_CAPS.heap, |v| ran(&p, Caps { heap: v, ..DEFAULT_CAPS })) };
        let mem = if ran(&p, Caps { mem: 0, ..DEFAULT_CAPS }) { 0 } else { least(DEFAULT_CAPS.mem, |v| ran(&p, Caps { mem: v, ..DEFAULT_CAPS })) };
        let (mut locs, mut args) = (0u32, 0u32);
        for r in p.code.iter().flat_map(regs) {
            match r { Reg::Loc(n) => locs = locs.max(n + 1), Reg::Arg(n) => args = args.max(n + 1), Reg::Rr => {} }
        }
        let one = src.replace('\n', " ");
        println!("{k}\t{}\t{}\t{steps}\t{depth}\t{heap}\t{mem}\t{locs}\t{args}\t{one:.70}", p.code.len(), p.labels.len());
    }
}
```

`src/bin/tmtrace.rs` (`tmtrace`):

```rust
//! Design-stage probe: does the TM run enter instruction entry states `pc{i}` exactly once per asm step?
#[path = "../corpus.rs"] mod corpus;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::trace::{StepEvent, TmCursor};
use redextape_core::tm::asm::{AsmRun, Caps, DEFAULT_CAPS, run_asm, Program};
use redextape_core::tm::{EncodingKind, LowerError, TM_DEFAULT_CAPS, TmRun, defunc, lower_asm, run_tm_described};
use redextape_core::typeck::result_type;

fn least(hi: u64, ok: impl Fn(u64) -> bool) -> u64 {
    let (mut lo, mut hi) = (0u64, hi);
    while hi - lo > 1 { let m = lo + (hi - lo) / 2; if ok(m) { hi = m } else { lo = m } }
    hi
}

fn main() {
    let extra: Vec<String> = std::env::args().skip(1).collect();
    let list: Vec<&str> = if extra.is_empty() { corpus::FIRST_ORDER_DEMOS.to_vec() } else { extra.iter().map(String::as_str).collect() };
    let (mut agree, mut differ, mut skipped) = (0, 0, 0);
    println!("idx\tasm\ttm_entries\tpc_selfloops\ttm_steps\tsrc");
    for (k, src) in list.iter().enumerate() {
        let (p, _) = parse(src);
        let prog_ast = p.unwrap();
        let ty = result_type(&prog_ast).unwrap();
        let core = desugar(&prog_ast);
        let prog: Program = match lower_asm(&core) { Ok(p) => p, Err(LowerError::Unsupported { .. }) => lower_asm(&defunc(&core).unwrap()).unwrap(), Err(e) => panic!("{e:?}") };
        let ran = |c: Caps| matches!(run_asm(&prog, c), AsmRun::Ran(_));
        let asm_steps = least(DEFAULT_CAPS.steps, |v| ran(Caps { steps: v, ..DEFAULT_CAPS }));
        for kind in [EncodingKind::Unary, EncodingKind::Binary] {
            let Ok(d) = run_tm_described(&core, kind, ty.clone(), TM_DEFAULT_CAPS) else { skipped += 1; continue };
            if !matches!(d.run, TmRun::Ran { .. }) { skipped += 1; continue; }
            let m = &d.machine;
            let is_pc = |s: u32| { let n = &m.states[s as usize].name; n.starts_with("pc") && n[2..].chars().all(|c| c.is_ascii_digit()) && n.len() > 2 };
            let selfloops: usize = m.states.iter().enumerate().filter(|(i, _)| is_pc(*i as u32)).map(|(i, st)| st.rules.iter().filter(|r| r.next as usize == i).count()).sum();
            let init = d.header.init(m.tapes);
            let mut cur = TmCursor::new(m, &init, TM_DEFAULT_CAPS);
            let mut prev: Option<u32> = None;
            let (mut entries, mut steps) = (0u64, 0u64);
            while let Some(StepEvent::Delta { state, .. }) = cur.next() {
                steps += 1;
                if is_pc(state) && prev != Some(state) { entries += 1; }
                prev = Some(state);
            }
            if entries == asm_steps { agree += 1 } else { differ += 1 }
            let one = src.replace('\n', " ");
            println!("{k}{}\t{asm_steps}\t{entries}\t{selfloops}\t{steps}\t{one:.60}", if matches!(kind, EncodingKind::Unary) { "u" } else { "b" });
        }
    }
    println!("agree={agree} differ={differ} skipped={skipped}");
}
```
