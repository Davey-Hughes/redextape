# TM field width control — short design

Every SHA below of a commit on this branch is its SHA before the rebase onto `538b211`: what was run, measured,
reviewed or tried on it was measured before the rebase, on `486df8d`, and `rebase2/sha-map.txt` in the lane's
record, `~/temp/redextape-tm-width-record/`, maps each to its SHA after it.

## Intent

Davey, 2026-11-16: a live control in the web app that sets the bit width of the numbers in the TM program, changed
while viewing and re-running the program as an edit would. It is for teaching: a narrow width makes a TM run small
enough to follow by eye, and lets a class watch a value run out of bits.

## How width works today (`main` at `1d40a4e`)

- The width is not fixed; it auto-fits. `search_width` (`crates/redextape-core/src/tm.rs:295`) tries 4, 8, 16, 32
  and 64 (`MIN_FIELD_WIDTH`, `MAX_FIELD_WIDTH` in `tm/build.rs:54,72`) and widens only when a run ends in
  `TmRun::Overflow`. A width is in cells: binary holds `v < 2^width`, unary `v < width`.
- Core can already pin a width, but only from `Core`: `run_tm_described_at` (`tm.rs`) checks `4..=64` first and
  then builds through the private `describe_at`, the one place a `DescribedRun` is built. The wasm session holds an
  already-lowered `Program`, and the only entry point taking one, `run_tm_described_program`, searches.
- `Session::compile` (`crates/redextape-wasm/src/session.rs:533`) always auto-fits. The `SourceMap` is built at the
  width the run used (`session.rs:587-591`). An `Ok` run ending in `Overflow` becomes `TmDecline::Overflow` and the
  leg is dropped; `tm_status` then says "a value does not fit the encoding at any width up to the ceiling".
- `tm_value` reads `final_tapes` (set by `compile` for `Ran`), then falls back to the cursor's tapes once the cursor
  has halted. On `main` it never asks which state the cursor halted in; on `tm-return-tag` it answers a fault when
  the cursor halted in the guard (`tm::is_overflow_guard`), worded by `overflowed_at(width)`.
- The web: `createCompile().schedule` (`web/src/compile.ts`) posts `{kind:'run', gen, src, encoding}` and stores
  the program (`persist`); the worker's `onRun` calls wasm `compile(src, encoding)`. The `#encoding` select is
  filled from the wasm export `encodings()`, and its `change` listener recompiles. Encoding is stored in
  `StoredProgram` (`program-store.ts`) and in share links (`share-link.ts`), and picking an example resets it to
  `EXAMPLE_ENCODING` (`main.ts`, `openExample`).

## Decisions

Davey's (2026-11-16):

1. A **width** select: `auto` (the default, today's behaviour) and every width from 4 to 64. **Where it goes was
   ruled again** after Task 3 first built it beside **encoding** and the top bar wrapped to a second row at 1280px
   (7 px of slack in Debugger; the select needs 134): it goes in the header of the TM view's **rules** panel, as
   `width [auto ▾]`, where panel headers already hold controls (the state diagram's `program | local`). Each TM view
   gets one, and every one shows and sets the **one program-wide width**, as the encoding is program-wide: a change
   in one view updates the others' selects and recompiles once. (Where it goes was ruled a third time on 2026-11-17:
   decision 24.)
2. A pinned width runs at exactly that width.
3. A pinned run that overflows **keeps its TM**: it can be stepped right up to its halt in `overflow`, and the TM's
   status says it overflowed at width N, with a pointer to a wider width or auto.

Davey's (2026-11-16), on a bug this lane's probe found: a binary return tag that does not fit the width was
written truncated, so a program with 17 or more call sites could return to the wrong call site and give a wrong
value at width 4. That fix lands first as its own PR (branch `tm-return-tag`): a tag that does not fit goes to the
overflow guard, as `write_literal` does for a literal. Davey also put this lane's second finding (below) in that
PR: a TM that halts in `overflow` never reports a value, through one predicate, `tm::is_overflow_guard`, and its
fault names the width. **The `tm-width` branch is stacked on `tm-return-tag`** (the controller's call, 2026-11-16,
so this lane builds on the fix rather than beside it), and its tests may depend on the fix (Task 5 of the plan
does). Nothing of the fix is copied into this branch, and this lane adds no second overflow check: it reuses
`tm::is_overflow_guard` and the fix's wording function. `tm-return-tag` merged into `main` as `486df8d` (#179), and
this branch was rebased onto it, and then onto `538b211`.

The controller's calls, kept:

4. `auto` behaves exactly as today, including its decline when a value overflows at 64.
5. The floor stays 4; widths below 4 are out of scope. (Superseded by decision 31: the floor is 1.)
6. Width is stored and shared the way encoding is; a payload without it reads as auto.
7. Picking an example resets the width to auto, as it resets the encoding: the example manifest's per-leg outcomes
   hold under auto only. (Picking an example does reset the encoding today, to `EXAMPLE_ENCODING`.)
8. TM copies (`.tm` buffers) keep their own header width and are unaffected.

The controller's calls on the rules-panel placement (2026-11-16):

- The options are `auto`, then the integers `fieldWidths()` lists; anything else reads as auto (the Tasks 1-2
  review's M4, decision 15).
- The select is reachable by keyboard and has a visible label, the word `width`.
- It stays usable while the rules panel is closed, if a closed panel still shows its header's actions. It does: a
  closed panel hides only its body (`panel.ts`), so the header, the select with it, stays on screen and in the Tab
  order (`field-width.test.ts` closes the table and chooses from the keyboard).

Mine, with the reason for each:

9. **The width list comes from wasm**, a new export `fieldWidths()` answering `MIN_FIELD_WIDTH..=MAX_FIELD_WIDTH`,
   as `encodings()` does for the encoding select. A TypeScript `4..64` would be a second copy of core's constants
   that nothing checks. (Until decision 31: it answers `PINNED_FIELD_WIDTHS`, 1 to 64.)
10. **The wasm `compile` export takes a third argument, `width: number | null`** (`null` = auto). A width outside
    `fieldWidths()` throws, as an unknown encoding does. One export rather than a second one: the export's own body
    size is guarded (`web/tests/node/wasm-compile-export.test.ts`), and a second export would be a second body
    `wasm-opt` could inline the defunctionaliser into.
11. **A kept overflow answers its value at once.** `tm_value` returns `Decoded::Fault` from the moment `compile`
    returns, as a finished run's value is known at once, not only after the cursor reaches the halt. `results.ts`
    reads `Unfinished` as "stopped at a cap", so a kept overflow that answered `Unfinished` would be described as
    capped. The fault's message is the status Davey asked for, from the fix's one wording function,
    `overflowed_at(width, from)`, whose `FieldFrom` gains a third case, `Pinned`, beside the fix's `Fit` and
    `Header`. Every message opens with the fix's `tm::OVERFLOWING_NUMBER`, "a number the machine stores (a value, an
    address or a call's return tag)", so a call's return tag that outgrows a pinned width is named too. Pinned:
    `… outgrew the 4-cell tape field chosen for this run; try a wider width, or auto`. Auto-fitted, the fix's own
    words: `… outgrew the 4-cell tape field this run was fitted to; it needs a field wider than 4 cells`. At 64 each
    names its field and then the fix's `…, the widest there is; this is the encoding's limit`: no wider width
    exists, and auto would decline the same machine at 64. The wording parallels the fix's so the cases read as one
    voice. The pointer is "try", not a promise, by the controller's ruling after the Tasks 1-2 review: some programs
    fit no width (unary `fact(12)` overflows at every width from 4 to 64, and auto declines it), so "a wider width,
    or auto" names what to try, not a remedy.
    The results panel shows it as `fault: …` on the TM's value row, and the readout strip shows it beside
    `width 4`. The TM pane's own line already names the state the cursor is in, so at the halt it reads
    `overflow · width 4`.
12. **`tm_value` never decodes the tapes of a run that halted in `overflow`**, whichever way the run got there.
    The fix covers the cursor path (a raised cap carried the cursor into the guard) with `tm::is_overflow_guard`;
    this lane adds the `compile` path, a kept pinned overflow (decision 11), and nothing else. The session keeps
    where its width came from (`width_from: FieldFrom`, `Pinned` or `Fit`), because the cursor path can be reached at
    a pinned width too (a pinned run capped before it overflows, then continued), and its fault must use the pinned
    words.
13. **`tm_status` is unchanged.** A kept overflow is an available leg: `available: true`, `width: Some(N)`, the
    cursor's `run`, and `total_steps` from the run `compile` performed, which is the length up to the halt. The
    decline wording "at any width up to the ceiling" stays, since only auto can decline on overflow now. No wire
    type changes; only `Decoded`'s doc table names the pinned case among `tm_value`'s faults.

Proposed in my plan and ruled by the controller in its Task 1 dispatch, with the reason for each. Within decision
15, the integer check and the dropped TM position are the controller's later rulings, and `listedWidth` is mine:

14. **No version bump** in `program-store.ts` or `share-link.ts`. The field is optional (`width` absent = auto),
    and it is written only when pinned, so an auto program stores and shares byte for byte as today. This follows
    the precedent in `workspace.ts`, where `tmDisplay` and `arrangements` were added to a stored version as
    fields absent in older payloads. `buffers-store.ts` bumped to 2 because its new field was required. An older
    build reading a pinned payload ignores `width` and runs auto, which was the only behaviour it had.
    **The cost, which the controller accepted as the trade-off after the Tasks 3-4 review:** a tab still on an older
    deployment opens a pinned link whole, at auto, and applies its TM position, a step of the pinned run, to the auto
    run, which is a different run. That is the mismatch decision 16 gives links the width to prevent, so it is listed
    under the roadmap entry's *what this did not close*. Writing pinned links alone at a new version would avoid it,
    while auto links stayed byte-identical.
15. **A width that is not one of `fieldWidths()` reads as auto**, in storage and in links, rather than refusing the
    payload as an unknown encoding does. Refusing a stored program loses its text; demoting a link to program-only
    drops its workspace. Auto is what every payload written before this change means. **A whole link whose width
    this build does not list opens without its TM position** (the controller's ruling after the branch review): that
    position is a step of the run at the width the link names, and the auto run is another run (decision 16). Its
    program, workspace and other positions still open; the cost is a TM view at step 0 for a hand-edited link or one
    from a build that lists other widths. A link with no `width` keeps its TM position, since it names the auto run.
    The web side checks this itself, as an integer that `fieldWidths()` lists, before it posts (the controller's
    ruling on the Tasks 1-2 review's M4): wasm-bindgen's glue converts the export's `u32` with `>>> 0`, so `16.7`,
    `2**32 + 16` and the string `"8"` reach the export's range check as 16, 16 and 8. The check is one function,
    `field-width.ts`'s `listedWidth(v, widths)`: the list's own number that `===` `v`, else `null`. The select's own
    choice goes through it too, as `Number` of the option's value (`auto` is `NaN`). `===` against a list of
    integers is the integer check and the membership check at once, so there is no separate `Number.isInteger` (it
    could not fail a value the lookup passes). `parseProgram` and `decodeLink` take the list as a third parameter, as
    they take the encodings, so neither needs wasm and their node tests none.

Mine, with the reason for each (continued):

16. **Share links carry the width because of their positions.** A link's TM position is a step of one run, and the
    same program at another width is another run with other steps.
17. **The select is `<label class="field-width">width <select>`**, built by `field-width.ts`'s `fieldWidthControl`
    and placed in the rules panel's header actions after the re-attach, as the state diagram's choices come after its
    own re-attach; the maximise button stays last. It has no id: there is one per TM view. "width" alone is too
    common a word to use as a class. The word is dim, as the panel's toggle is; the select wears a panel action's
    chrome (`.panel-actions button`'s font, border and radius) at the maximise button's height, in the page's text
    colour. Its name is the visible word; its `aria-description`, "tape field width in cells for the program’s TM,
    shared by every TM view" (decision 33 ends it "; empty for auto"), says what the word leaves to the eye: what
    it sets, its unit, and that two TM views'
    selects are one setting. The options stay the bare numbers a sighted user reads, since the description names
    their unit once. (Superseded: it was first `#field-width` after the encoding label, in `.encoding select`'s
    styling. Its place and chrome here are superseded by decision 24.)
18. **The status wording for a pinned `TooLarge` is unchanged** ("the machine this program needs is too large to
    build"). A state-ceiling refusal could be helped by a narrower width, but the three pre-checked refusals
    (slots, frame bank, multiplies) cannot, and telling them apart needs plumbing this feature does not otherwise
    need.
19. **A TM view showing a copy has no width select.** A copy runs at the width its own header records
    (decision 8), so the program's width cannot apply to it, and the app's rule for a control that cannot apply in a
    view is to remove it, not disable it (*edit a copy* is removed from a view already showing a copy). The view
    hides the label in `TmPane.setDetached`, which `PaneSlot.render` calls every frame, so a view rebound onto the
    program shows it again.
20. **The width is `main.ts` state, handed to every view as the speed is.** `let fieldWidth: number | null` in
    `main.ts`; `PaneEvents.fieldWidth` (`{ widths, current(), choose() }`, through `createTransport`'s deps, as
    `speed`/`setSpeed` are) gives each TM view the list, the value and where a choice goes. Each view brings its
    select to `current()` in `render`, by assignment, which fires no `change`: only the view the user chose in
    reports the choice, so a choice recompiles once however many views show it. `chooseFieldWidth` records the
    width, ends a pick's and a link's notice, and schedules the compile; that compile's `supersede` draws every view,
    so the other selects change at once, not when the run lands. A select in each view rather than one element moved
    between views: views are built and dropped by the layout, and the speed select is the app's model for one value
    shown in many views.

Proposed by me in Task 4 and accepted by the controller, with the reason for each:

21. **The types say what the format says (Task 4).** What is read always carries the width: `StoredProgram` and both
    kinds of `OpenedLink` have `width: number | null`. What is written may leave it out: `serializeProgram`'s argument
    and `SharePayload` take `width?: number | null`, and a width left out writes what `null` writes, nothing. A
    payload without a width means auto, so a writer with no width to say writes auto, and the 22 test files that
    store or encode a program for other reasons pass none. `main.ts`'s three writers (the store,
    `sharePayload`, the replaced program an undo keeps) always pass `fieldWidth`; the browser tests and their
    sabotages hold each one.
22. **A link's width is always its own, never storage's (Task 4).** A link without a width opens at auto, not at the
    stored program's width, since its positions are steps of the auto run (decision 16). A link that opens its
    program alone carries its width too, read by the same rule: alone, it has no positions, but the width is still
    how the program it shares ran.

Davey's, after the branch review, with the controller's extension of it; how the mark is carried is mine:

23. **The results strip marks a pinned width** (Davey's decision, 2026-11-16): the TM segment ends `width 4 (pinned)`
    where auto's fit stays `width 4`. The inspector's TM width row reads `4 cells (pinned)`: that is the controller's
    extension of Davey's decision, in its dispatch. The width select lives in a TM view, so with TM switched off, or
    every TM view showing a copy, the strip is all the page says of the width, and a pinned run's overflow fault
    ("try a wider width, or auto") points at a control that is not on screen; the mark says the width was chosen,
    and the stored width keeps it across reloads. The mark comes from the `result` reply's `pinned` (my call), which
    the worker sets from whether the `run` request carried a width, not from `main.ts`'s current width: the result on
    screen while a newly chosen width compiles is the previous compile's, and must be marked as that compile ran. At
    1280 a pinned overflow's fault is long enough for the strip's ellipsis to cut the mark with the rest of the
    segment's tail (left open: the roadmap entry lists it).

Davey's, after trying the branch; where on the bar is the controller's call; how it is built and drawn is mine:

24. **The width select is in the TM view's header, right after the title selector** (Davey's decision, 2026-11-17:
    "I think the width should be on the same bar as TM - program not in the rules section"). It replaces decision
    1's rules panel header, which was chosen because the app's top bar had no room; this is the view's own header,
    the bar holding the title selector, the step strip, `⋯` and `✕`. Right after the title selector is the
    controller's call. The rest of decision 17 holds: the label and its word, its description, one per TM view, and
    none on a copy's view (decision 19). Mine: the label is a child of the header between the heading and the step
    slot, not inside the `<h2>`, whose text is the view's name; `setStepsShown` puts the slot back before the actions,
    so the select keeps its place either way the `steps` switch goes. The word is dim at the step line's size and the
    select wears the speed select's chrome at its size (`--step--2`), the header's other select. At 1280px in
    Explorer the header now wraps to a second row at every step count; before the move it wrapped only from a
    five-digit count on. How the header lays out is left to Davey; decision 25 is his answer.

Davey's, from three layouts measured and shown to him; two calls on it are the controller's, the rest mine:

25. **The TM view's step count leaves its header bar for the status line under it** (Davey's decision, 2026-11-17,
    option B of three, put to him as: "The step count leaves the bar and joins the line under it ('pc0 · step 233 of
    30,846 · width 8'). The bar stays one row at every step count; today it wraps at 5 digits. On a phone, long state
    names get cut with … to keep that line to one row. Only TM changes; λ and rxm headers keep their step count on
    the bar."). It settles decision 24's wrap: the bar holds the title, the width select, the step buttons, the speed
    select and `⋯ ✕`, and at 1280px in Explorer it is one row at every step count in Instrument, Paper and Terminal,
    with 56.84, 26.94 and 24.63px to spare (the bar's content width less each shown box's max-content width and the
    gaps between them).
    The controller's: the step text sits between the state and the width, and its endings (` — history is full`,
    ` — spent its step budget` and the rest) travel with it; the name is cut at its end, its whole name in a tooltip.
    A middle cut would keep the part of a name that differs, but its helper was then on the unmerged state-diagram
    branch (since merged as #182).
    Mine, each for its reason:
    - **Scoped by construction, not by a `data-kind` selector.** `stepControls` hands out its readout (`step`) and
      `TmPane` alone moves it onto `.tm-status`; the rules hang on `.tm-line`, `.tm-state` and `.tm-part`, which only
      `TmPane` builds. The λ, rxm and step-bar strips never see the change.
    - **The readout is the same element**, class `step`, written by the same `update`. It had no role, live region
      or label before, and has none now; what read it as `.view-steps .step` in the TM view reads `.tm-status .step`.
    - **Before the first frame the line holds the readout alone**, as the strip did: `not run`, `not compiled`, or why
      the leg is unavailable. **At the `steps` switch's `bar` the line drops it**, as the header drops its strip, so
      the one step bar is still the only place it shows.
    - **Only the name gives way.** The row is an inline flex box no wider than the line; the name's flex basis is 0,
      so it never pushes the step or the width to another row, and it grows into what they leave up to its own width,
      never under `1ch`, the ellipsis. The step and the width are never cut: where the two alone outgrow the line (a
      TM view narrower than about 250px, as in Explorer's two columns at 320 and 390px, or a long ending at 320px),
      the width takes another row, and the readout wraps inside itself only where it alone outgrows the line. The
      headerless and reduced sentences follow the row as text, beside it while they fit.
    - **The step text takes the status line's size and colour** (`--step--1`, dim), not the strip's `--step--2`.
26. **In every TM view, a copy's too, the status line sits directly under the header bar** (the controller's call,
    2026-11-17, following Davey's decision 25). Decision 25 as built kept the body's order, a copy's text panel first,
    so in a copy's view the line, and the step count on it, sat under the copy's text: 237px under the bar at 1280
    with the panel open. Davey chose option B as "the step count leaves the bar and joins the line under it", and a
    line a whole editor below the step buttons is not under the bar, so `TmPane` now puts `.tm-status` first in its
    body, above the text panel; the program's view, which has no text panel, does not change. The rxm view, whose
    step count stays on its bar, keeps its text panel first.
    Mine, for its reason: **the 16px between the line and the text panel stay.** The line keeps the 8px under itself
    that it keeps above the value line, and the text panel the 8px it keeps above itself; the view is a flex column,
    where the two margins add rather than collapse. Kept, every box under the text panel stays where it was: in a
    copy's view at 1280, light, the line moves from 270 to 41px below the view's top (8px under the bar, as in the
    program's view), the text panel from 49 to 76.5px, and the value line, the tapes, the rules, the diagram and the
    outline keep 297.5, 325, 486.5, 647.5 and 808.5px (`node c/copy.mjs light c/shots before|after` in
    `~/temp/redextape-tm-width-record/`, logs `c/before.log` and `c/after.log`). Closing the gap to 8px would raise
    all of them by 8px.

Davey's, after trying `bfae654`; how it is built is mine:

27. **The width select sits at the bar's end, right before `⋯`** (Davey's decision, 2026-11-17: "I think width
    should be on the right side next to the ... button"). It replaces decision 24's place right after the title
    selector; the rest of decisions 24 and 25 holds: one select per TM view, none on a copy's, and at 1280px in
    Explorer the bar one row at every step count in Instrument, Paper and Terminal, now with 60.84, 30.94 and
    28.63px to spare, measured as in decision 25 (`node b/probe.mjs r5-1280` in `~/temp/redextape-tm-width-record/`,
    log `r5/bar-1280.log`). The Tab order follows the bar: the title, the step buttons, the speed select, the width
    select, `⋯`, `✕`.
    Mine, each for its reason:
    - **The select is the first of the view's own actions** (`ViewHeader.actions`), where `LambdaPane` puts its
      re-attach: the header's slot for a view's own actions, before `⋯` and `✕` (the umbrella's order). So it keeps
      the actions' `var(--space-1)` before `⋯`, the gap `⋯` keeps before `✕`, and `setStepsShown`, which puts the
      strip back before the actions, needs no change. Taking the strip out from under the focus (`handOff`) now
      hands it to the select, the next control after the strip, where it went to `⋯`.
    - **The actions wrap, on the right, where they do not fit one row.** In Explorer's two columns at 320px the TM
      view is 154px wide, and unwrapped the select with `⋯ ✕` ran past its edge: the header's content was 163px wide
      in Chromium and 170px in Firefox (`view-strip-narrow.test.ts`, logs `r5/s2-actions-nowrap-*.log` in the
      record). Wrapped, the select takes a row above `⋯ ✕`, both at the right, rows `var(--space-1)` apart, as a panel
      header's actions wrap. The rule is `.view-actions`', so it is every view's, but the λ and rxm views' actions fit
      one row at every width the tests measure. At 375px the select shares `⋯ ✕`'s row
      (`r5/shots/*-375-cols-*.png`).

The controller's, applying Davey's rule that nothing moves the page on its own; how it is built is mine:

28. **The step text takes the room it needs at the run's newest step** (the controller's call, 2026-11-17, on
    review-hb's I1). In Explorer's two columns on a phone the TM view is 181.5px wide at 375px and 189px at 390px,
    and under decision 25 the status line gained rows while `sum_to(5)` played, as its count gained digits: 39px tall
    at step 0, 58.5px from step 100 and 78px from step 1,000 at 375px, the tapes pushed 39px down mid-run
    (`$R/rv-hb/phone.log`). Now the line's rows are settled by the run's total: at 375 and 390px it is 78px tall from
    step 0 to the halt at 12,976, the tapes 214.3px below the view's top throughout, and at 320px in the same
    columns (154px) 78px throughout, as before (`node r5/phone.mjs <w> <h> all` in `~/temp/redextape-tm-width-record/`,
    log `r5/phone.log`). Where the total itself grows, while a run is still recording or after it is continued past
    its cap, the line may gain a row then; the controller accepts that. This amends decision 25's "the readout wraps
    inside itself only where it alone outgrows the line": the step part now wraps where the readout at the newest
    step would.
    Mine, each for its reason:
    - **Measured by drawing, not set in `ch`.** `TmPane` gives the step part the readout at the newest step
      (`ControlState.stepTextAtNewest`, from `controlState`'s one readout) in `data-reserve`, and `style.css` draws it
      unseen in the same grid cell as the shown readout, so the cell is as wide and as tall as the larger. A
      `min-inline-size` in `ch` would hold the part's width but not its rows: where the part is narrower than the
      readout and wraps, `step 0 of 12,976` and `step 1,000 of 12,976` break into different numbers of rows. The
      unseen copy has the same words with a current step at least as long, so it wraps to at least as many rows.
    - **Generated content, hidden**, so the copy is in neither the line's text nor the accessibility tree.
    - **What it costs on screen:** while the count has fewer digits than the total, blank room follows the step text
      before ` · width`, one character for each digit or comma the count lacks (five at step 0 of 12,976). At a phone's
      width in those columns the line is as tall at step 0 as at the end of the run.

Davey's, from three controls shown to him; three calls on it are the controller's, the rest mine:

29. **A number box instead of the select** (Davey's decision, 2026-11-17, after trying `7b61933`: "width looks good",
    and a better control than a long list for auto and 4 to 64. Of three shown he chose "Number box", described as:
    "A small box: type a width or step it with ↑/↓ or the box's arrows, from 4 to 64. Empty means auto, and shows
    'auto' in grey. A width applies on Enter or when you leave the box, not on each keystroke."). It is
    `<label class="field-width">width <input type="number" min="4" max="64" step="1" placeholder="auto">`, where
    decision 27 put the select, with its name and description. (Until decision 31: from 1 to 64. Until decision 33:
    a text field that is a spin button.) The rest holds: one box per TM view, each following
    the program's width; none on a copy's view; storage, links and examples as with the select. At 1280px in Explorer
    the bar is one row at every step count in Instrument, Paper and Terminal, with 61.94, 32.13 and 29.81px to spare
    (`node b/probe.mjs r6-1280` in `~/temp/redextape-tm-width-record/`, log `r6/bar-1280.log`).
    The controller's:
    - **A step applies after a pause**: a step of the box's arrows or of ↑/↓ applies 400ms after the last one
      (`STEP_PAUSE_MS`), so stepping 8 to 12 runs once. Escape puts the box back to the program's width.
    - **An entry that is not a listed width is not applied**: on Enter or on leaving, `3`, `65`, `7.5` or text that is
      not a number puts the box back to the program's width, with no notice. Cleared, it is auto. (Until decision
      31: `3` is a width, and `0` is put back.)
    - **From auto, the first step starts at the width auto fitted**: auto at 8, ↑ gives 9, where a browser steps an
      empty box to its `min`. (Until decision 32: ↑ from auto gives 1, and ↓ keeps auto.)
    Mine, each for its reason (the browsers' behaviour from `r6/events.mjs` and `r6/spin.mjs`, logs `r6/events.log`
    and `r6/spin.log`):
    - **It applies on Enter's `keydown` and on `focusout`, not on `change`**, which both browsers fire at each step of
      ↑/↓ and of the arrows, so it would apply every step.
    - **↑/↓ are the box's own**, their default prevented: both browsers step an empty box to 4 whichever key, so the
      fitted start needs the key. A step of the box's arrows from empty is moved from 4 to the fitted width ± 1 by the
      half of the box the press began in. An `input` during a press on the box is a step, since both browsers fire it
      between `pointerdown` and `pointerup`; any other `input` is typing. (Until decision 30: the arrows are the box's
      own and step as ↑/↓ do.)
    - **The wheel**: over the focused box Chromium steps it, Firefox scrolls the page. The box prevents the wheel's
      default while it has the focus, so in Chromium the page does not scroll under the pointer then. (Until decision
      33: a text field is not stepped by the wheel, and the box no longer holds it.)
    - **An entry survives the run's frames**: `sync`, which every render calls, leaves the box alone while it holds an
      entry not yet applied; the select had nothing to lose.
    - **The empty box's `aria-valuetext` is `auto`**. Firefox hands it on, and a screen reader there hears auto as it
      heard the select's option. Chromium hands on no native input's `aria-valuetext`, so there the empty box was a
      spin button with no value text and a value of 0, heard as blank (`review-box.md`'s I1; decision 33's
      measurements), until decision 33 ended its description "; empty for auto".
    - **Letters in Chromium**: Chromium refuses every letter but `e` in a number box, so `abc` typed over a width
      leaves the box empty, which applies as auto; `ten` leaves `e`, not a number, which puts the width back. Firefox
      takes any text, and text that is not a number puts the width back. (Until decision 30: letters put the width
      back in both.)
    - **Its size**: the font's `normal` line, the line Chrome holds a select to, so the box is as tall as the speed
      select in Firefox and 2px shorter in Chromium, which sets a select 2px taller than a box of the same line,
      padding and border (`r6/box2.log`, Instrument: 19.40 and 19.40, 18.38 and 20.38). Wide enough for four
      characters, `auto`, beside the arrows, which Firefox draws always and Chromium under the pointer and neither
      lets the page size: 19px for them, where at 16px Firefox cut `auto` (`r6/box.log`). (Until decision 30: the
      box and the speed select as tall in both engines, and 1.1em for the box's own arrows.)
    - **Its colours**: its text `--fg` and its `auto` `--fg-dim` at full opacity, both held to 4.5:1 on every surface
      by `palettes.test.ts`; nothing holds the browser's placeholder grey, which Firefox fades further. The arrows are
      the browser's, drawn in a grey the page cannot set. Their darkest pixel against the arrows' own face, at 1280px
      in each style: Chromium 3.32:1 light and 5.28:1 dark; Firefox 2.63:1 light, under the 3:1 a mark is held to,
      and 4.44:1 dark (`node r6/arrows.mjs`, log `r6/arrows2.log`). Firefox's light arrows were left to Davey, who
      chose the box's own (decision 30).
      In forced colours (Chromium) its text is the speed select's colour, its `auto` `GrayText`, and its focus ring
      the app's.
30. **The box draws its own arrows** (Davey's decision, 2026-11-17, after trying `f921888` in Firefox: "the arrows look
    bad, they go outside the box. they do work but we should probably draw our own"). The browser's spin buttons are
    hidden in both engines (until decision 33, a text field having none), and the box draws an up half over a down
    half in a column inside its border at its end,
    the box's full height split in two. The controller's:
    - **Each half steps as ↑/↓ do**: the same 400ms pause before the run, and from auto the same start at the width
      auto fitted (until decision 32's plain order). They are not Tab stops, the box being the spin button that keeps ↑/↓; a press on them keeps the
      focus in the box; nothing draws outside it; hover and pressed as the header's other buttons; 3:1 or more against
      the box in every style, light and dark, and visible in forced colours.
    - **The box as tall as the speed select in both engines; letters put the width back in both**, a box whose entry
      is text a number cannot hold being put back, not read as empty; **an entry survives a playing run's frames**
      (it did already: no change was needed, and a test now holds it); **the bar stays one row at 1280.**
    Mine, each for its reason (`r7/` in `~/temp/redextape-tm-width-record/`):
    - **Chevrons from `icons.ts`** (`step-up`, `step-down`), stroked in `currentColor` as every icon is, at a stroke of
      3 on the 16 grid where the others take 1.5 or 2: drawn at half the box's height, 8 to 10px, a thinner line
      would draw as a grey smear. In `--fg-dim`, the box's border colour: 5.24:1 light and 5.51:1 dark against the
      bar in each style, the same in both engines (`field-width.test.ts`'s contrast case, its figures printed by a
      line taken out before the commit, `r7/green1-chromium.log` and `r7/green1-firefox.log`). In forced colours they
      are `CanvasText`.
    - **No hover or pressed look of their own**: `⋯` changes nothing on hover or press but its pointer, in both engines
      (`node r7/shoot.mjs`, log `r7/shoot.log`), so the arrows take that pointer and nothing else. (Until decision
      31: the arrows show the plain arrow pointer.)
    - **A press is `mousedown` with its default prevented, the focus put in the box, and a step**: a press that let the
      focus leave would apply the entry at once (`focusout`), and one on a box without the focus puts it there, as the
      browser's arrows did. A held press steps once, where the browser's repeated.
    - **The speed select on a bar with a width box takes the box's height**, `block-size: calc(1lh + 0.2em + 2px)` on
      both on the font's `normal` line: Chromium sets a select 2px taller than a box of the same line, padding and
      border, and giving the box that extra in Chromium alone would take a test of the engine in CSS. So the select is
      held to the box: in Firefox neither moves, and in Chromium a TM view's speed select is 2px shorter than it was,
      its bar no shorter (33px, `node b/probe.mjs r7-1280`). Held on every bar, the select made the app's step bar 2px
      shorter in Chromium's phone layouts (`inspector-phone.test.ts`, log `r7/browser-full.log`), so the rule is the
      TM bar's alone, `.view-header:has(.field-width)`. Box and select (`node r7/box.mjs`, log `r7/box.log`):
      Instrument 18.39 and 18.39 in Chromium, 19.40 and 19.40 in Firefox; Paper and Terminal 21.39 and 21.39 in
      Chromium, 21.40 and 21.40 in Firefox.
    - **Chromium's dropped letters**: Chromium fires `beforeinput` for a character it then refuses, and over a
      selection an `input` that leaves the box empty (`node r7/probe.mjs`, log `r7/probe.log`). A `beforeinput`
      inserting anything but digits, `.`, `e`, `E`, `+` or `-` marks the entry as not a number until a deletion, and
      Enter or leaving then puts the width back, as Firefox's `validity.badInput` does. (Until decision 33: the box
      is a text field, which shows every character typed, and each entry is judged on its text.)
    - **The column is 1.1em**, about 13px, where 19px was left for the browser's arrows, so the box is 6px narrower
      and the bar at 1280 in Explorer has 67.73, 37.94 and 35.63px to spare in Instrument, Paper and Terminal, one row
      at every step count (`node b/probe.mjs r7-1280`, log `r7/bar-1280.log`).
31. **A plain pointer on the arrows, and widths down to 1** (Davey's decisions, 2026-11-17, after trying `b149c7a`:
    "the arrows for TM width are better. can we make it use a regular pointer instead of the hand pointer? can we also
    make it go down to "auto" after 1 or 2? whatever makes sense (even though 1 and 2 will overflow most programs,
    it's good for demo)"). The arrows show the default arrow pointer, not the hand. The controller's terms: find what
    held the floor at 4 and run every example at 1, 2 and 3 first; lower the floor to the lowest width that is sound
    with validation changes only, and stop if the core needs more; ↓ (key or arrow) at the floor gives auto; a typed
    width below the floor is put back; from auto ↑/↓ step from the fitted width (decision 29; until decision 32).
    - **What held the floor at 4 was validation and nothing else.** Decision 5 was a scope call. In the code it was the
      pinned entry points' range check (`in_field_range` in `tm.rs`, `MIN_FIELD_WIDTH..=MAX_FIELD_WIDTH`), which
      wasm's `FIELD_WIDTHS` copied, and with it `fieldWidths()` and the box's `min`; and, outside this lane, the CLI's
      `--field-width` and `emit.field-width` checks. `MIN_FIELD_WIDTH` is the auto-fit search's first rung and the
      width of a headerless machine, not a limit of the encodings: `run_tm_at`, which takes any width, already ran
      widths 0 to 3 under test (`tm_width_equivalence.rs`, `every_field_width_reaches_a_defined_outcome` and the two
      `degenerate_widths_refuse_rather_than_miscompute` tests), and the `.tm` header reader already took `width 1`.
    - **The runs at 1, 2 and 3**, through `run_tm_described_program_at`, the path the app runs, with the range check
      opened for the probe (a probe test since replaced by the committed one; logs `r8/probe1.log` and
      `r8/probe2.log`, command `cargo nextest run -p redextape-core --test tm_width_equivalence --no-capture`): of the
      42 runs of the seven examples, in both encodings at each width, 41 halt in `overflow` and one answers,
      `is-even` under binary at 3, `true`, the reference. No wrong value, no cap, no refusal, no panic. Thirteen
      small programs reaching the heap, closures and return tags answer correctly or overflow at every width in both
      encodings; `0` and `nil` answer even at 1 under unary.
    Mine, each for its reason:
    - **The floor is 1**, sound by validation alone. Not 0: a field of no cells holds no unary value at all, is the
      empty `##` the decoders treat as degenerate, and the header reader refused `width 0` already.
    - **One named range in core, `PINNED_FIELD_WIDTHS` (`1..=MAX_FIELD_WIDTH`)**, checked by the pinned entry points
      and by the `.tm` header reader, and taken by wasm's `FIELD_WIDTHS`: a pinned run prints its width in its header
      and a TM copy reads it back, so the two ranges must not drift apart. `MIN_FIELD_WIDTH` stays 4, so auto, its
      ladder and the headerless machine are unchanged (decision 4).
    - **The CLI keeps 4 to 64** for `--field-width` and `emit.field-width`: the CLI is a non-goal of this lane, and
      its checks read `MIN_FIELD_WIDTH`. Widening them is a change to each check and its refusal test, left open.
    - **↓ past the floor is auto, and that auto is the rung below 1 until it applies**: ↓ there keeps auto and ↑ goes
      back to 1. Left to the empty box's rule, a step would start from `fitted`, still the pinned width the program
      runs at, and ↓↓↓ from 2 would go 1, auto, 1. Once auto applies, ↑/↓ step from the width auto fitted (decision
      29). Only ↓ gives auto: ↑ from a typed number below the floor gives the floor. (Until decision 32: every auto
      is the rung below 1.)
    - **Tests**: `every_example_pinned_below_the_search_gives_its_answer_or_overflows` in `tm_width_equivalence.rs`
      runs every web example (read from `web/src/examples`, so a new one is covered) and the thirteen programs at
      every pinnable width under 4 in both encodings, and asks each width and encoding for at least one answer and
      one overflow; the pinned bounds tests in `tm.rs` take 1, and one of them pins the range by value. `field-width.test.ts` takes
      the floor and a pin at 1, the ↓ steps to auto by key and by arrow, and the plain pointer, in Chromium and
      Firefox; `0` replaces `3` as the typed width put back, and wasm's boundary test (`tests/browser.rs`) admits 1 and
      refuses 0.

32. **Auto is the bottom of one plain order** (Davey's decision, 2026-11-17, after trying `036a198`: "it's confusing
    that after you go to auto it jumps back to up to 9 or 7 depending on what you press. it should just go up to 1 in
    this case"). The box steps through auto, 1, 2, ..., 64, by key and by arrow: ↑ from auto gives 1 whatever width
    auto fitted, ↓ at auto keeps auto, ↓ from 1 gives auto, and ↑ at 64 keeps 64. It replaces the controller's start
    at the fitted width (decision 29, which decision 30's arrows followed) and decision 31's auto that was the rung
    below 1 only until it applied.
    Mine, each for its reason:
    - **What no longer has a reader is gone**: `fieldWidthControl`'s `fitted` argument, the closure `TmPane` passed
      for it, and the `under` flag, every auto now being the rung below 1. `TmProgram`'s `width` stays, which the
      status line reads.
    - **↑/↓ stay the box's own**: both browsers step an empty box to its `min` whichever key (decision 29), which at
      auto would make ↓ give 1.
    - **Text that is no number steps as auto does**, ↑ to 1 and ↓ to auto, and is replaced, where it stepped from the
      fitted width before. No test covers it. ↑ from a typed number under 1 still gives 1: only ↓ passes the floor.
    - **Tests**: `field-width.test.ts`'s two tests that stepped from the fitted width now ask, by key, that ↓ at auto
      keeps auto, ↑ from it gives 1 with auto at 8 and ↓ from 1 gives auto, nothing running; and, by arrow, that the
      down half at auto keeps auto and the up half gives 1 and then 2, which runs at 2; in Chromium and Firefox
      (`REDEXTAPE_FIREFOX=1 VITEST_MAX_WORKERS=2 pnpm exec vitest run --project browser --project firefox
      tests/browser/field-width.test.ts` in `web/`). Both failed on `036a198`'s code at ↓ from auto, which gave 7
      (`r9/red-both.log`); a sabotage starting ↑ from auto at 8 failed them and decision 31's ↓-to-auto test at
      "expected '9' to be '1'", in both engines (`r9/sab-up-from-auto-both.log`). ↓ from 1 to auto is decision 31's
      and passed before as well.

33. **The box is a text field that is a spin button** (the controller's calls, 2026-11-17, on `review-box.md`'s I1, I2
    and M1, after Davey's "tm width looks good" on `ec2348e`). It is `<input type="text" inputmode="numeric"
    role="spinbutton" aria-valuemin="1" aria-valuemax="64">`, with `aria-valuenow` while its text is a listed width,
    and `aria-valuetext` `auto` while it is empty, else its text. Nothing drawn changes, the box's arrows being its
    own already (decision 30), and every behaviour of decisions 29 to 32 holds. The controller's:
    - **A text field, not a number input**, so an entry is judged on the text the box shows (I2: one refused
      character made later entries refuse, so `16` typed over `1x` put 9 back) and no browser step leaves the plain
      order (M1: Ctrl+↓ at auto pinned 1, in both engines).
    - **Its description ends "; empty for auto"**, and its name stays `width`: Chromium hands on no `aria-valuetext`
      from any native input, text or number, so the text field alone left its empty box a spin button with no value
      text. Measured over AT-SPI, Chrome stable with `--force-renderer-accessibility` and Playwright's Firefox under
      Xvfb in their own D-Bus session (`xvfb-run -a dbus-run-session -- ./run.sh atspi-variants.mjs` in
      `r10/probe/` of `~/temp/redextape-tm-width-record/`, log `r10/probe/atspi-variants.log`): in Chromium neither a
      text spin button nor a number input with `aria-valuetext="auto"` has a `valuetext`, and a `<div
      role="spinbutton">` has `auto`. In the app (the review's `rv9/a11y.mjs` by the same runner, log
      `r10/probe/a11y-app.log`): in both engines the name is `width` and the description ends "; empty for auto" at
      auto, during a step, at 13 and with `abc` typed; at auto Firefox's `valuetext` is `auto` and Chromium has none;
      at 13 both say 13.
    Mine, each for its reason:
    - **A number is digits, with a fraction if any**, the text trimmed: a listed width applies (`05` is 5), and
      `1e1`, `+3` or `0x10` is text that is no number and is put back, where the number input took `1e1` as 10, and
      Chromium `+3` as 3. Steps from a number keep decision 32's order (from 65 ↑ and ↓ give 64; from 7.5, 8 and 7).
    - **`autocomplete` off and `spellcheck` false**: a text field may offer past entries or underline a word, which a
      number input never did.
    - **Ctrl, Alt and Meta with ↑/↓ are left to the browser**, which steps no text field, so they do nothing.
    - **The wheel guard and the spin-button CSS are gone**: a text field has neither a wheel step nor spin buttons.
    - **Tests** (`field-width.test.ts`, in Chromium and Firefox: `REDEXTAPE_FIREFOX=1 VITEST_MAX_WORKERS=2 pnpm exec
      vitest run --project browser --project firefox tests/browser/field-width.test.ts` in `web/`): Chromium's own
      accessibility node, read by CDP, has the box's role and name, a description ending "; empty for auto" and at 13
      a value text of 13 (Chromium only); `16` typed over `1x` runs at 16; ↑ and ↓ with Ctrl, Alt and Meta leave auto
      as it is and nothing runs on leaving; `1a3` joins the entries put back; the placement case asks for the text
      field, its role, `inputmode`, `aria-valuemin`/`max` and no `aria-valuenow` at auto. On `ec2348e`'s code each
      failed (`r10/red.log`: the node's value text `''`, at Enter no compile at 16, Ctrl+↓ gave 1; `r10/red-final.log`
      for the description and attributes). Sabotages, each restored and compared: the description without "; empty
      for auto" failed the CDP case and the Tab-stop case's description, in both engines where it runs
      (`r10/sab-s1.log`); a flag kept from a non-digit typed until the entry is shown again failed the `1x` case in
      both (`r10/sab-s2.log`); the modifier guard taken out failed the Ctrl/Alt/Meta case in both, and
      the case after it, whose entry of 1 started no compile, the sabotaged Ctrl+↑ having pinned 1 already
      (`r10/sab-s3.log`).

## How the pinned path threads through

- **Core:** `run_tm_described_program_at(prog, kind, result, caps, width)`: the `4..=64` check, `sized`, then
  `describe_at` at `width`. `run_tm_described_at` keeps its check-before-lowering order and then delegates to it,
  so there is still one build site.
- **wasm session:** `Session::compile_at(src, kind, width: Option<usize>)`; `compile(src, kind)` is
  `compile_at(src, kind, None)`, kept for the session's tests only (`#[cfg(test)]`), since the export now calls
  `compile_at` and an unused function fails clippy. `compile_with_caps` gains the width after `kind`.
  When pinned, `Ok(d)` with `TmRun::Overflow` is kept as `HitCap` is and records that the run overflowed. One
  match decides which runs are kept; the map is built at the kept run's `header.width` (any kept run, the kept
  overflow included), and the leg is built once from it with `build_tm_leg`.
- **Recording the overflow:** `final_tapes: Option<Vec<Tape>>` becomes `run_end: RunEnd`, one field saying how
  `compile`'s run ended: `Halted(tapes)`, `Overflowed` (a kept pinned overflow, tapes not kept) or `NoHalt` (capped,
  or no leg). One field rather than a second boolean beside `final_tapes`, since two fields for one fact can
  disagree. `width_from` beside it is a different fact (how the width was asked for) and only picks the words.
- **wasm export:** `compile(src, encoding, width)` and `fieldWidths()`. The bounds are one constant,
  `session::FIELD_WIDTHS` (`MIN_FIELD_WIDTH..=MAX_FIELD_WIDTH`), which the export checks a width against and
  `fieldWidths()` lists.
- **Worker and protocol:** the `run` request gains an optional `width` (a number, absent for auto), and
  `SessionClient.request` a fourth parameter defaulting to auto. An auto request is the message posted today, so
  the node tests that compare posted messages stand unchanged. `onRun` passes `req.width ?? null` to `compile`, and
  keeps whether the request carried a width beside the live session; every `result` it posts for that session says so
  as `pinned` (decision 23).
- **UI:** `createCompile` takes `width: () => fieldWidth` beside the encoding select, posts both, and `persist`
  stores both. A TM view's width select calls `PaneEvents.fieldWidth.choose`, which is `main.ts`'s
  `chooseFieldWidth` (decision 20): it recompiles, dismisses an example pick's notice and withdraws a link's offer,
  as the encoding select's `change` does.

## A second finding: a capped run raised into `overflow` decodes its truncated tapes

On `main` at `1d40a4e`, an auto-fitted run that hits a cap before it overflows is kept as a capped leg at the
narrow width (only the guard triggers a wider retry). If the cap is then raised, the cursor can run on into the
overflow guard. `tm_value`'s cursor fallback decodes those tapes. Measured with a temporary test in
`session.rs`, at a 10-step cap: `let a = 9; let b = 9; a + b` under binary fits width 4, is capped, then is
raised and halts in `overflow`, and `tm_value` answered `Value "0"` (the right value is 18). Davey put the fix in
the `tm-return-tag` PR (its design's addendum, which also shows it reachable at the product caps). This lane's
part is decision 12's pinned half.

## Non-goals

- A width of 0, or an entry that is not a listed width (decision 29 puts it back).
- Any change to auto: its ladder, its retry rule, its decline.
- The CLI (`emit --field-width` already pins, at 4 to 64; decision 31).
- Showing the fitted width inside the box's `auto`; the status line under the bar says it.

## Left to the builder

The exact name of the field that records how `compile`'s run ended. With the width box in each TM view's header bar, the app's top bar and `web/index.html` are
untouched (`inspector-phone.test.ts` passes unchanged); the `view-switcher-style` lane's restyle can still meet
this branch in `web/src/style.css`.
