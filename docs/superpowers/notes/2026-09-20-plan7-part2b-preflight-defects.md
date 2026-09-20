# Plan 7, part 2b — pre-flight defect log

Every disagreement between [the plan](../plans/2026-09-20-plan7-part2b-presets-and-switches.md) and a
build of it, one entry per defect, in task order. The build ran in a worktree at
`~/temp/redextape-preflight-2b` on branch `preflight-2b`, based on
`plan7-part2b-presets-and-switches` at `0522e31`, with `CARGO_TARGET_DIR` under `$XDG_CACHE_HOME` —
neither in `/tmp`, which is a 31 GiB tmpfs here.

Each entry is classified:

- **B — blocks a step as written.** The step cannot be followed; something is missing or will not compile.
- **W — produces a wrong result or a red gate.** The step runs and the outcome is not what the plan says.
- **G — needed a guess.** The plan underdetermines the step; the build chose, and the choice is recorded.
- **D — design problem.** The plan's shape is wrong, not only its text.

**The plan below is NOT rewritten against this log.** The branch carries the corrected code; the plan
stands as what was planned, and this is the record of where planning and building disagreed.

---

## Task 1 — The focus hand-off, as one rule

Steps 1–6 ran as written. `focus-handoff.test.ts` is 8 cases, green; `typecheck` exit 0; `biome ci
--error-on-warnings` clean over the three files; the three existing focus-related browser files
(`controls-gate`, `focus`, `menu-focus`) stayed green at 21 tests. The whole browser tier is **404 tests
in 65 files**, all passing with Task 1 applied.

### 1.1 (W, pre-identified) — `nearest`'s dead index

The plan's `nearest` carried `const at = [...].indexOf(going as HTMLElement)` and a `void at` to silence
the unused binding. `compareDocumentPosition` is the whole ordering mechanism and the index is never
read. **The plan's own note says to delete both lines**, so this is the plan confirming itself rather
than a surprise — recorded because the note asked for confirmation. Both lines deleted. The doc comment
gained a paragraph saying why there is no index: `going` need not itself be one of the controls the walk
enumerates, because at two of the four call sites it is a whole slot.

### 1.2 (W) — Sabotage 3's prediction names the wrong test

The plan: *"In `nearest`, return `[...after, ...before]` without the `.reverse()`. Expect
`focus-handoff.test.ts`'s "reads forward from the departing control, then backward" red on
`toEqual(['d', 'f', 'a'])`."*

**It reddens "reads backward alone when the departing control is last" instead**, on
`expected [ 'a', 'b', 'd' ] to deeply equal [ 'd', 'b', 'a' ]`. One case red, not the named one.

The reason is arithmetic the plan did not do: in `nearest(box, b)` the `before` list holds exactly one
element (`a`), and reversing a one-element array changes nothing. Only the case whose departing control
is LAST has a `before` list long enough for the reversal to be observable.

**This is the interesting half.** The prediction being wrong is a plan defect; what it exposes is that
the first ordering case does not test the backward ordering at all — it tests that `before` is appended
after `after`, which is a different claim. Both cases are kept, and the plan's sabotage row is corrected
to name the second.

### 1.3 (W) — Sabotages 1 and 2 redden more cases than predicted

- **S1** (`handOff` returns `true` without calling `next.focus()`): the plan predicts one case. **Three
  go red** — "moves the focus off a departing control", "counts a focus INSIDE the departing control as
  being on it", and "takes several departing controls at once". Every case that asserts where the focus
  landed, which is what it should be.
- **S2** (`usable` drops its `:disabled` clause): the plan predicts two. **Four go red** — both `nearest`
  ordering cases join the two named, because the disabled `c` re-enters the candidate list.

Neither changes a conclusion; both are recorded because a sabotage row that under-predicts is a row
whose author had a narrower model of the test than the test has.

### 1.4 (W, and the one that matters) — Sabotage 4's "expect nothing red" is FALSE

The plan: *"In `step-controls.ts`, pass `[speed, forward, play, back, restart]`. Expect nothing red —
**record that**. No existing test drives a `continue` button away while it holds the focus with
`forward` live."*

**Two tests do exactly that**, and both go red:

```
FAIL tests/browser/extend-focus-probe.test.ts > focus when a frontier control is withdrawn >
     hands focus to a working neighbour when a programmatic dispatch withdraws the focused continue button
FAIL tests/browser/step-controls.test.ts > the step controls >
     moves focus to a neighbour when the continue button it sits on goes away
```

Whole browser tier under the sabotage: **2 failed, 402 passed**.

**The claim was a claim about the search, not about the tier**, and the search was never run — the plan
asserted an absence from memory of having read `controls-gate`, `focus` and `menu-focus`, which are three
files out of sixty-five. The corrected sabotage row reads: *expect
`extend-focus-probe.test.ts`'s "hands focus to a working neighbour…" and `step-controls.test.ts`'s "moves
focus to a neighbour when the continue button it sits on goes away" red.*

**And the consequence is larger than one row.** Had the plan been executed as written, an implementer
would have found two reds where the plan promised none, and the plan's instruction was to *record the
absence* — so the recorded lesson would have been a false one, about a call site that is in fact covered
twice. Every other "expect nothing red" row in this plan (Task 3 row 2, Task 4 row 5, Task 5 row 6, Task
6 row 4) is therefore to be treated as **unverified until the sabotage is actually run against the whole
tier**, not against the files the plan happened to name.

### 1.5 (G) — the test fixture's `innerHTML`

`focus-handoff.test.ts` builds its fixture with `document.body.innerHTML = \`…\``, a literal template with
no interpolation. This is the tier's existing idiom — every browser file assigns `document.body.innerHTML
= SHELL` — and a session hook flags the property by name regardless of the value. Kept, as written.

---

## Task 2 — The workspace menu

Green at the end: `tsc --noEmit` exit 0, `biome ci --error-on-warnings` clean over 172 files, node **521
tests in 37 files**, browser **410 tests in 66 files** (up from 404 in 65 — `workspace-switches.test.ts`
is 6 cases).

### 2.1 (B) — `fillWorkspaceMenu` as a hoisted `function` does not typecheck

The plan writes it as `function fillWorkspaceMenu(): void {…}` and argues for the declaration explicitly:
*"A FUNCTION DECLARATION, NOT A `const`: `applySwitches` above names it and `wireMenu` below is handed
it, and hoisting is what lets the three read in the order they are understood in."*

**The hoisting is exactly what breaks it:**

```
src/main.ts(1033,7): error TS2345: Argument of type 'HTMLElement | null' is not assignable to
  parameter of type 'HTMLElement'.
```

`workspaceMenu` is a `querySelector` result narrowed to non-null by the shell guard at the top of
`main()`. TypeScript keeps that narrowing inside a closure CREATED after the guard — which is why the
sibling `applySwitches`, a `const` arrow that calls `workspaceMenu.matches(':popover-open')`, compiles
without complaint — and drops it inside a function DECLARATION, which is hoisted above the guard.

**Corrected:** `fillWorkspaceMenu` is a `const` arrow, declared BEFORE `applySwitches` and `setSwitches`.
It references `setSwitches` from inside its own body, which is initialised later and is never called
before then. The plan's ordering argument survives inverted: the reading order is
`paintWorkspaceButton` → `fillWorkspaceMenu` → `applySwitches` → `setSwitches` → `wireMenu`.

### 2.2 (W, pre-identified) — the `workspaceItems` fallback, and one consequence the plan missed

The plan's rebuild-fallback was `handOff(document.body, nearest(menu, menu))`, which its own note flags as
wrong: `nearest(menu, menu)` excludes every descendant of `menu`, so the candidate list is empty, and the
departing control is already detached so `handOff` cannot find the focus on it.

**The consequence the note did not carry: the corrected form uses neither function**, so the plan's
instruction to add `import { handOff, nearest } from './focus-handoff'` to `app-header.ts` leaves two
unused imports, which `biome ci --error-on-warnings` rejects. `app-header.ts` imports nothing from
`focus-handoff.ts`.

The fallback is `menu.querySelector<HTMLElement>('button:not([disabled])')?.focus()`, and the doc comment
now says why `nearest` is not the answer here: this rebuild replaces every item, so there is no
"remaining control" near the departing one — every candidate `nearest` could name was detached by the same
`replaceChildren`. The first item is the honest answer, and it is the one `wireMenu` already autofocuses.

### 2.3 (W) — the plan's import line is rejected by Biome

Planned: `import { type Preset, PRESETS, presetOf, type Switches } from './workspace'`.
Biome's `assist/source/organizeImports`: *"Sort the imported names."*
Accepted: `import { PRESETS, type Preset, presetOf, type Switches } from './workspace'` — value
specifiers sort before same-named type ones, and `PRESETS` sorts before `Preset`.

### 2.4 (W) — the plan's test snippet is reformatted

The `computeAccessibleName(item(menu, '[data-switch="steps"][data-value="bar"]'))` assertion is written
across three lines in the plan and Biome joins it onto one (it fits the print width). Any snippet in this
plan is a draft for the formatter, not a fixture.

### 2.5 (W) — the plan quotes `app-header.test.ts`'s comment block at the wrong indent

The plan's replacement text for the *reset preset* case indents the stale comment and its assertion by
six spaces; the file has four. A literal search-and-replace finds nothing.

### 2.6 (W) — every sabotage prediction under-predicts, again

Each was run against the **whole** browser tier, per 1.4's rule.

| row | predicted | actual |
| --- | --- | --- |
| S1 `aria-hidden` dropped | 2 cases | `app-header.test.ts`'s "names the workspace after its preset" **and every one of `controls-gate.test.ts`'s 13 cases** — `#workspace` is on the page in all of them, so `straySymbol` fires everywhere |
| S2 reset appended unconditionally | 1 case | 2 — it also reddens "keeps the focus on the switch that was picked", whose second half stands on the item |
| S3 focus restore dropped | 1 case | 1, as predicted |
| S4 `persistWorkspace` skipped | 2 cases | 3 — "is custom when the switches match no preset" joins them, because its `stored().switches` read is the same assertion |

**S1's shape is the one worth keeping.** A control on the page in every state reddens every gate case, so
its sabotage says nothing about WHICH case covers it. The `app-header.test.ts` line is the one that names
the button; the gate's thirteen are one fact reported thirteen times.

---

## Task 3 — The bottom step bar, and its target

Green at the end: `tsc --noEmit` exit 0, `biome ci --error-on-warnings` clean over 175 files, node **526
tests in 38 files**, browser **417 tests in 67 files**.

### 3.1 (B) — widening `PaneView` breaks two node test files the plan does not list

Adding `setStepsShown` to `PaneView` is a required member, and two files build fake panes against that
type:

```
tests/node/panes.test.ts(22,3): error TS2322: … Property 'setStepsShown' is missing …
tests/node/sessions.test.ts(113,9): error TS2741: Property 'setStepsShown' is missing …
```

Neither appears in Task 3's **Files** list. Both gained a one-line stub. **The class this belongs to is
"widening a structural type the test tier implements"**, and the plan's file list should be derived from
`grep -rl 'PaneView' web/` rather than from the source files the task is about.

### 3.2 (B) — the `legControlState` import instruction assumes a shape `main.ts` does not have

The plan says to add `legControlState` to `main.ts`'s import from `./sessions`. That import is a single
line, `import { SessionRegistry } from './sessions'` — not the multi-line block the neighbouring
`./workspace` import is, which is what the instruction was written against. A line-oriented edit against
the multi-line shape silently does nothing and the failure surfaces much later, as an unrelated-looking
`tsc` error.

### 3.3 (W) — "steps the view it names" clicks a control that does not move

The plan's case clicks `one step forward` and asserts the readout changed. The compiled fixture
(`let x = 40; x + 2`) sits **at** its recorded frontier, where `▶` means "record one more" and the step
text does not change: `AssertionError: expected 'step 7 of 7' not to be 'step 7 of 7'`. The gesture is
`one step back`, which is unambiguous from the frontier and is still evidence that the bar drives the
view its title names.

### 3.4 (D) — the focus case is UNREACHABLE by the gesture the plan describes

The plan's case: focus a view's `▶`, flip the `steps` switch to `bar`, assert the focus did not fall to
`<body>` and is still inside that view. **It fails**, and not because the hand-off is broken:

> `expect(document.querySelector('[data-leaf="lambda-0"]')?.contains(document.activeElement)).toBe(true)`
> — `AssertionError: expected false to be true`

**The only way to move the `steps` switch is through the workspace menu, and opening a menu is itself a
focus-bearing interaction somewhere else.** By the time the slot is removed, the focus is on the menu item
the user just clicked — never on the control being withdrawn. The plan's precondition can never hold.

**The tier already records this exact argument about this exact rule.**
`tests/browser/extend-focus-probe.test.ts` is two halves — *"HALF ONE — IS THE MECHANISM REAL?"* and
*"HALF TWO — CAN A USER GESTURE REACH IT? Every gesture that opens the window is itself a focus-bearing
interaction somewhere else"* — written for the continue button, and it answers no. The plan asserted the
opposite for the sibling call site without checking the file that had already settled it.

**Rewritten in that file's two halves.** Half one removes the `.view-steps` slot directly under a focused
`▶` and asserts the focus lands on `<body>`, which is the hazard. Half two performs the real switch
gesture and asserts the focus is on neither `<body>` nor the emptied view — with the slot's absence
asserted first, so the case cannot pass by the removal never having happened.

**Consequence for the code:** the `handOff` in `ViewHeader.setStepsShown` stays as defence against a
future caller that moves the switch without a menu — a share link (part 6), a keyboard shortcut — and its
sabotage does not fire. Recorded below, not adjusted until something went red.

### 3.5 (W) — a second `stepControls` instance breaks a page-wide count

`tests/browser/workspace-restore.test.ts`'s "shows the restored speed in every view that steps" sweeps
`.controls select.speed` across the whole document and expects two:

```
AssertionError: expected [ '250', '250', '250' ] to deeply equal [ '250', '250' ]
```

The third is the bar's own speed select, present even while the bar is `hidden`. The file is not in Task
3's list. **Tightened, not loosened**: the selector is now `.view-steps .controls select.speed`, which is
what the case's own name says, and the bar's copy is asserted on its own line — one global speed means
the bar shows it too (spec §8). The sibling case "changes the speed in every view at once" gained the same
positive assertion.

### 3.6 (G) — `viewTitle` is split across two tasks for no reason

Task 3 builds the title resolution inline inside `barTargetNow`; Task 5 then says *"Extract the title
resolution Task 3 built inside `barTargetNow`"*. Built as the named `viewTitle` in Task 3 directly. The
extraction step in Task 5 becomes "nothing to do".

### 3.7 — sabotage results, each run against BOTH whole tiers

| row | predicted | actual |
| --- | --- | --- |
| S1 `barTarget` drops the `last` clause | 2 cases | 2, as predicted — the node case and the browser case, one per tier |
| S2 `lastSteppable` written before the entry guard | **nothing red** | **nothing red** — 526 and 417, both green. The first "expect nothing red" prediction in this plan that holds. No test closes a view while the bar drives it, which is the one gesture that reaches an id with no entry |
| S3 `setStepsShown` drops the `handOff` | 1 case | **nothing red** — 417 green. See 3.4: the gesture cannot reach the hazard, so no test can hold this line. The plan predicted a red it had already been shown could not happen |
| S4 `draw` passes `true` | 1 case | 2 — "leaves the focus on the gesture that flipped the switch" joins it, because its `viewControls(…)` precondition assertion is the thing that goes red first |

**S4's second red is the precondition assertion doing its job.** That case asserts the slot is gone
*before* it asserts where the focus is; with the slot never removed it fails on the precondition rather
than passing vacuously — which is what 3.4's rewrite added it for.

---

## Task 4 — The inspector

Green at the end: `tsc --noEmit` exit 0, `biome ci --error-on-warnings` clean over 175 files, node **533
tests in 38 files**, browser **424 tests in 69 files**.

### 4.1 (B) — `Workspace` gains a required field, and two literals stop compiling

`src/main.ts`'s `ws` initialiser and `tests/node/workspace.test.ts`'s round-trip literal (TS2741 at both).
`main.ts` is in the plan's file list; the node test is listed only as "Modify tests", with no note that
**every** `Workspace` literal in it has to gain the field. A one-line note ("the type is not optional, so
`typecheck` names each one") would have been worth more than the file name.

### 4.2 (D) — the plan's copy-row builder is wrong, and the tier already held the counterexample

The plan's `splitCopy` takes the strip's joined line and splits it back on ` · `:

> *"BUILT FROM THE SEGMENT RATHER THAN BESIDE IT, SO THE TWO READOUTS CANNOT DISAGREE ABOUT A COPY."*

**A TM copy's reduced-file sentence contains a ` · ` of its own.** `tests/node/readout.test.ts` has
carried the counterexample since part 2a:

```
'TM copy 1 · 241,666 transitions · value: 2 · reduced: single-tape · 241,666 steps'
```

Five ` · `-separated pieces for **four** facts — the split cuts the reduced-file sentence in half and the
inspector shows `reduced: single-tape` and `241,666 steps` as two rows.

**Replaced by a shared parts list, which keeps the plan's goal and drops its mechanism.**
`lambdaCopyParts`/`tmCopyParts` build the facts; `lambdaCopySegments`/`tmCopySegments` join them for the
strip; `copyRows` maps them for the inspector. One list, two renderings, and nothing parses a separator it
also emits. A node case asserts the joined line has five pieces for those three rows, so the shortcut
cannot be reintroduced without a red.

### 4.3 (G) — the inspector row type collides with `results.ts`

The plan names it `Row`. `results.ts` already exports `Row` (`{ leg, label, value, note? }`), and
`readout.ts` imports from it. Renamed `InspectorRow`.

### 4.4 (B) — `tests/browser/strip.test.ts` calls `show` directly, at four sites

Changing `show`'s second parameter from an array to the `Lines` thunk pair breaks all four (TS2739 ×4).
The file is not in Task 4's list. Given a local `strip(segments)` helper, so the cases stay about the
strip and `rows` is never called in them.

### 4.5 (B) — the plan's CSS anchor puts the inspector block ~700 lines too early

The plan: *"append, after the `.results .segment` rule (Biome's `noDescendingSpecificity`)"*. The block
narrows three rules, not one — `.results .segment`, **`.panel`** and **`.link-status`** — and the latter
two are at lines 1015 and 1231 while `.results .segment` is at ~305:

```
src/style.css:1017:1 lint/style/noDescendingSpecificity  .panel        (0,1,0) after (0,2,0)
src/style.css:1233:1 lint/style/noDescendingSpecificity  .link-status  (0,1,0) after (0,2,0)
```

**The anchor is not "after the rule you were thinking of" but "after the LAST rule you narrow."** The
block sits at the end of the file, and its comment says so.

### 4.6 (W) — the plan's snippet asserts a label the builder does not produce

`expect(rows.map((r) => r.label)).toContain('normal form')`. Program rows are labelled
`` `${row.leg} ${row.label}` ``, so the label is `λ normal form`.

### 4.7 (W) — the `setMode` reset is dead, and its sabotage is how that was found

Sabotage 4 removes `rendered = ''` from `setMode` and the plan predicts
`inspector.test.ts`'s "shows the normal form" red. **Nothing reddened — 422 green.**

The reason is the other half of the same design: the rendered key is PREFIXED per mode (`s\x02…` /
`i\x02…`), so the two key spaces are disjoint and a mode change always produces a key the last render did
not write. The reset can never be the thing that causes a repaint. **Two mechanisms for one fact, and the
sabotage is what showed which one was load-bearing.** The reset is deleted and the absence documented, so
the next reader does not add it back.

### 4.8 (D, and the one that matters) — a sabotage that reddened the parser and not the app

Sabotage 1 makes a missing `inspector` invalidate the whole envelope — which is exactly the regression
§3's exception exists to prevent, since every workspace written by part 2a has no such field. It reddened
**one node test** and left **all 422 browser tests green**.

**Because nothing in the tier boots on a 2a-shaped envelope.** `workspace-restore.test.ts` seeds through
`serializeWorkspace`, which is *this* build's — so it always writes the field. `layout-restore.test.ts`
seeds a version **1** layout, which takes the migration branch. The version-2-without-`inspector` shape —
the only shape a real upgrading user has — was seeded by nothing.

**A sabotage that reddens only the unit and not the app is a claim about the tier's coverage**, so the
hole is closed rather than recorded: `tests/browser/workspace-upgrade.test.ts` seeds the exact bytes part
2a emitted (a two-leaf tree, speed 250, no `inspector`) and boots the app on them. Re-running the sabotage
against it:

```
FAIL tests/browser/workspace-upgrade.test.ts > keeps the tree it was stored with, rather than resetting
AssertionError: expected [ 'source', 'lambda-0', 'tm-0' ] to deeply equal [ 'source', 'lambda-0' ]
```

The default three-leaf tree, in place of the user's two — which is the harm, stated as a test rather than
as a paragraph.

### 4.9 — sabotage results, each run against BOTH whole tiers

| row | predicted | actual |
| --- | --- | --- |
| S1 missing `inspector` invalidates | node + `layout-restore.test.ts` | node only; browser 422 green. See 4.8 — a new file now reddens too |
| S2 `#results` never leaves the strip | 1 case | 1, as predicted |
| S3 `programRows` drops the normal form | 2 cases | 2, as predicted — one per tier |
| S4 `setMode` skips the reset | 1 case | **nothing red.** See 4.7 — the line was dead |
| S5 `main` back to `column` | **nothing red** | **nothing red** — no test measures the inspector's position, only its containment. The visual check by hand (§14 item 8) is what covers it, and Task 7 must actually do it |

---

## Task 5 — Stage

Green at the end: `tsc --noEmit` exit 0, `biome ci --error-on-warnings` clean over 178 files, node **533
tests in 38 files**, browser **432 tests in 70 files**.

### 5.1 (B) — the early `return` the plan puts inside `applyLayout`'s `finally` is unsafe, and undoes that `finally`'s purpose

The plan's Step 4 renders the stage and then `return`s, inside the `finally` block. Biome:

```
src/pane-host.ts:1068:9 lint/correctness/noUnsafeFinally  × Unsafe usage of 'return'.
```

**And the lint is the small half.** That `try`/`finally` exists, by its own long comment, so that an
exception escaping `custody.reconcile()` still leaves the function after the DOM, storage and draw have
been reconciled — *"the exception still leaves this function, still reaches `window`'s `error` event, and
is still what the tests assert on."* A `return` in a `finally` **discards** that exception. The plan's
step would have silently undone the behaviour the paragraph directly above it argues for.

Restructured as `if`/`else`, with the shared `persist()` and `draw()` after both branches.

### 5.2 (B) — `layout-view.ts` does not import `leaves`

`renderStage` is built on `leaves(tree)` and the file imported only `Dir`, `LayoutNode` and
`MIN_PANE_FRACTION`. Four cascading `TS2304`/`TS7006` errors.

### 5.3 (B) — `viewTitle` is used before it is declared

`createPaneHost` is called ~200 lines above `viewTitle`'s declaration, so passing the reference is
`TS2448`/`TS2454`. Passed as `(id) => viewTitle(id)`, which is the same late binding `draw: () => draw()`
in the same object already uses.

### 5.4 (B) — `applySwitches` never calls `applyLayout`, so the `views` switch reaches nothing

The plan's Step 7 adds `paneHost.applyLayout()` to `applySwitches`; without it the switch persists and
renames the button and **nothing on screen changes**, because `applyLayout` is what chooses the renderer.
Four of six Stage cases failed with `expected [] to deeply equal ['source','lambda-0','tm-0']` — an empty
tab list, which reads like a broken `renderStage` and is not.

**Worth noting for the class:** `applySwitches` is the one function all three switches hang off, and each
task adds a line to it. A task that forgets its line fails in a way that points at its own new module.

### 5.5 (W) — `[data-leaf="tm-0"]` matches the TAB, not the host

A Stage tab carries `data-leaf` too, so the selector every other test file uses to find a view's host
finds a tab instead — and the tab is connected, so `expect(host.isConnected).toBe(false)` passes while
naming the wrong element. **A detached host is not reachable by `document.querySelector` at all**, so the
reference has to be taken while the view is still in tiles.

### 5.6 (D) — the plan's playback probe CANNOT FAIL, and the spec's claim is not observable

The plan's case: play the visible view, assert the hidden one's markup did not change. It passes. **With
the skip removed from `draw.ts`, it still passes** — 430 green, sabotage S3.

`draw()` does repaint a disconnected pane every frame without the guard, and the markup comes out
byte-identical: the TM leg is not the one playing, its frame does not change, and the pane's own
rendered-key guards make the repaint a no-op. **`innerHTML` measures OUTPUT; §5's claim is about COST.**
A cost claim belongs in the `REDEXTAPE_PROBE` tier beside `frame-cost.test.ts`.

**And a settle-wait was needed before any of that could even be measured.** A host taken off the page
rewrites its δ-table once, on the following frame — `state-table.ts` virtualises against a measured
`clientHeight`, which is 0 while detached. A baseline captured at the moment of detachment differs from
the next read whether or not anything painted. The first settle helper written for it *also* failed, in
the other direction: `until` evaluates its predicate before its first sleep, so "this read equals the
last" succeeded immediately, before the rewrite had happened at all. It now requires ten consecutive
equal reads.

**Replaced** by a case that drives a recompile and asserts the guarantee a user can feel: the view that
comes back on a tab selection is current.

### 5.7 (D) — the `draw()` skip is not the whole story: `replies.ts` paints hidden panes

Written as a test, the claim "a hidden view is not painted through a recompile" **fails**: `replies.ts`
paints panes directly when a reply lands, and that path has no connection check. So §5's "hidden views
cost nothing" is true of the per-frame pass and **false of replies** — a hidden view still pays for every
compile.

Left as it is and recorded, because narrowing it is a design decision, not a defect fix: skipping
disconnected panes in `replies.ts` too would leave a hidden view stale until its tab's `draw()`, which is
exactly what §5 says is acceptable ("selecting a tab calls `draw()` once so the shown view is current") —
but it is a change to a path this task does not own. **For the branch review.**

### 5.8 (D, the headline) — §11's fourth rule cannot be reached by ANY of part 2b's three gestures

Sabotage S5 removes the `handOff` from `viewMenu`'s `sync` — the instance **the spec names by hand** —
and nothing reddens. Same as Task 3's S3, and same as the `handOff` in `ViewHeader.setStepsShown`.

**One reason covers all three.** Every one of part 2b's new instances is triggered by a switch in the
workspace menu, and opening a menu is itself a focus-bearing interaction somewhere else. At the instant
the control is removed, the focus is on the menu item the user just clicked — never on the control being
withdrawn. `extend-focus-probe.test.ts` reached this conclusion for the continue button before part 2b
was planned; the plan asserted the opposite for all three siblings without consulting it.

**What this means, stated rather than left to be noticed:**

1. **The rule is right and `focus-handoff.ts` earns its place** — at the `continue` site, which is
   triggered by a worker reply rather than a menu, and which `extend-focus-probe.test.ts` and
   `step-controls.test.ts` both hold.
2. **The three new call sites are defence against a trigger that does not exist yet** — a share link
   (part 6) or a keyboard shortcut (part 3) that moves a switch without a menu. They stay, each with a
   comment saying so, so the next reader does not delete them as dead or "fix" a test to cover them.
3. **Spec §11's fourth bullet names an instance that cannot occur** — "the split items when Stage is
   chosen". Worth correcting there, as §9's inspector sentence was.

Each of the three cases is now written in `extend-focus-probe.test.ts`'s two halves: one that shows the
hazard is real by removing the control programmatically, and one that performs the real gesture and
asserts where the focus actually lands, with the removal asserted first so it cannot pass vacuously.

### 5.9 — sabotage results, each run against the whole browser tier

| row | predicted | actual |
| --- | --- | --- |
| S1 `renderStage` appends every host | 2 cases | 3 |
| S2 arrow keys also select | 1 case | 1, as predicted |
| S3 `draw` stops skipping disconnected panes | 1 case | **nothing red.** See 5.6 — the claim is not observable through `innerHTML` |
| S4 `canSplit` loses the `!stage()` clause | 1 case | 1, as predicted |
| S5 `viewMenu` drops the `handOff` | 1 case | **nothing red.** See 5.8 |

---

## Task 6 — Every control, in every preset and in custom

`controls-gate.test.ts` goes from **13 cases to 30**. Browser tier: **449 tests in 70 files**, green.

### 6.1 (B) — the per-view `it.each` table cannot be per-state

The plan keeps the per-view cases as an `it.each` over leaf selectors. **A `describe.each`'s table is
evaluated at collection time, before any `beforeAll` has run**, so a table built from `viewLeaves(tiled)`
reads the page as it was at import. The per-view walk is a single `it` with the loop inside it, where the
state has already been entered.

### 6.2 (W) — the plan's first sabotage cannot be written

The plan: *"In `step-bar.ts`, remove the speed select's `aria-label`. Expect the gate red in Debugger,
Stage and custom … and green in Explorer."* **`step-bar.ts` builds no control of its own** — it composes
a `stepControls` instance, and the select belongs to `step-controls.ts`, which every view also uses. There
is no bar-only control to sabotage.

Run anyway, against `step-controls.ts`: **nothing reddened, in any state.** The select carries
`title = 'playback speed'` as well as the `aria-label`, and `computeAccessibleName` falls back to `title`
— so removing one of two name sources leaves the name intact. The gate is right to stay green; the
sabotage was aimed at a property the control does not have.

**Sabotage 2 is what actually demonstrates the task.** Emptying a Stage tab's text reddens **six cases in
Stage and every case in custom, and nothing in Explorer or Debugger** — a control that exists only in the
states 2a never walked, caught only because the gate now walks them.

### 6.3 — sabotage results

| row | predicted | actual |
| --- | --- | --- |
| S1 speed select loses its `aria-label` | red in 3 states, green in Explorer | **nothing red anywhere.** See 6.2 — `title` is still a name source, and `step-bar.ts` has no control of its own to aim at |
| S2 a Stage tab has no text | red in Stage and custom | red in Stage and custom, **and nowhere else** — 6 cases and up. The task's actual proof |
| S3 `workspaceItems` drops the tooltip | red in every state | red in all four, on `#workspace` in each |
| S4 reset appended unconditionally | **nothing red** | **nothing red** — as predicted. The gate walks names and reachability, not whether a control ought to be there; that absence is `workspace-switches.test.ts`'s to hold, and the division between the two files is deliberate |

---

## Task 7 — Verification

`build:app` exit 0. `biome ci --error-on-warnings` clean. `tsc --noEmit` exit 0. All six hygiene gates
pass (`check-text-bytes`, `check-citations`, `check-attributions`, `check-colours`, `check-doc-figures`,
`check-shared-docs`). **No Rust file is touched by this branch** — `git diff --stat … -- crates/
Cargo.toml Cargo.lock` is empty — so every Rust leg is main's.

### 7.1 (W) — the coverage gate passes and `step-bar.ts` is still barely exercised

The global floors were met on the first run (statements 96.38 / branches 90.62 / functions 97.49 /
lines 98.55, against 95 / 89 / 97 / 97). Per file:

```
step-bar.ts  | 76.31 stmts | 88.88 branch | 42.85 funcs | 86.2 lines
```

**42.85% of its functions.** Each of the bar's five handlers is a separate closure, and the browser test
clicked exactly one of them (`one step back`). A bar whose `↺` or `⏵` drove the wrong view, or nothing,
would have shipped under a green gate — which is what a global floor over 3,481 statements cannot see.

Closed: a case that clicks every button on the bar and asserts what each one moves, including that the
play button becomes *pause* and back. `step-bar.ts` is now **92.1 / 88.88 / 85.71 / 96.55**; the one
uncovered line is the `extend` handler, which needs a spent-step-budget fixture and is the same one-line
delegation as the other four. Globals after: **96.55 / 90.62 / 98.43 / 98.65**.

### 7.2 (W, environmental) — `PATH="/usr/sbin:$PATH"` breaks `check-all.sh`

The plan's global constraints require that prefix for browser runs, because Chrome is off-PATH in
`/usr/sbin`. **`/usr/sbin` also holds a `tree-sitter`**, which reports 0.28.0 against the repo's pinned
0.25.10, so `check-all.sh` refuses at its first line with an error that names grammars and nothing about
`PATH`. Run it without the prefix, or with `TREE_SITTER=<repo>/.tools/tree-sitter`. **Worth a line in the
plan's constraints**, beside the prefix that causes it.

---

## Summary

**36 defects in the plan text**: **11 block a step as written**, **16 produce a wrong result or a red
gate**, **3 needed a guess**, and **6 are design problems**.

Final state, re-measured on `plan7-part2b-presets-and-switches` after the pre-flight's commits were
adopted: node **533 tests in 38 files**, browser **450 tests in 70 files**, coverage
96.55 / 90.62 / 98.43 / 98.65, `build:app` exit 0, `check-all.sh` exit 0 ("all configs green — base, LLVM
and browser"), every hygiene gate green.

**The figures above were wrong in this file's first draft, and the reason is worth the line.** It claimed
451 browser tests and 34 files at +2,671/−148 — numbers taken before the commit that added the step bar's
own case and this summary, and therefore stale the moment the commit that carried them landed. A count of
a branch, written inside that branch, re-stales itself on every further commit. Re-measured against
`0522e31..HEAD`, which is the plan and the spec correction through to here.

### The five worth knowing without reading the rest

1. **§11's fourth focus rule cannot be reached by any of part 2b's three gestures** (5.8, and 3.4). All
   three are triggered by a switch in the workspace menu, and opening a menu is itself a focus-bearing
   interaction somewhere else — so at the instant the control is removed, the focus is on the menu item
   the user just clicked. `extend-focus-probe.test.ts` had already reached this conclusion for the
   continue button before part 2b was planned. The rule and `focus-handoff.ts` are still right; the three
   new call sites are defence against a trigger that does not exist yet, and **spec §11 names an instance
   that cannot occur**.
2. **A sabotage row that predicts "nothing red" was wrong the first time it was checked** (1.4), and the
   claim was about the search rather than about the tier — three files out of sixty-five had been read.
   Every later "expect nothing red" row was run against the whole tier because of it.
3. **The plan's copy-row builder parses a separator it also emits** (4.2). A TM copy's reduced-file
   sentence contains a ` · `, so splitting the strip's line back apart cuts one fact into two rows — and
   the tier had carried the counterexample since part 2a.
4. **An early `return` inside `applyLayout`'s `finally` would have silently discarded the exception that
   `finally` exists to let escape** (5.1). Biome names it `noUnsafeFinally`; the comment directly above
   the plan's own step names the behaviour it would have undone.
5. **A sabotage reddened the parser and left the whole app green** (4.8), because nothing in the browser
   tier boots on the envelope shape part 2a actually wrote. The harm — an upgrading user's layout
   resetting — now has a test that fails under that sabotage.

### What the plan got right, since a defect log is not a verdict

The task decomposition held: seven tasks, each independently testable, each committed through the
pre-commit hook without reordering. `focus-handoff.ts` landing first was correct even though two of its
three new call sites turned out unreachable — the module is the right shape and the `continue` site is
real. The three switches' three consumers were genuinely independent. Every interface the plan declared
in a task's **Interfaces** block was the interface that got built, with one rename (`Row` →
`InspectorRow`) and one addition (`lambdaCopyParts`/`tmCopyParts`).

### Rows to change in the plan before it is handed to an implementer

- Task 1 S3 names the wrong test; Task 1 S4 predicts green and is red.
- Task 2 Step 5's `function fillWorkspaceMenu` must be a `const` arrow.
- Task 3's **Files** must list `tests/node/panes.test.ts`, `tests/node/sessions.test.ts` and
  `tests/browser/workspace-restore.test.ts`; Task 4's must list `tests/browser/strip.test.ts`.
- Task 4's CSS anchor must be "the end of the file", not "after `.results .segment`".
- Task 5 Step 4 must be `if`/`else`, not an early `return`.
- Every task that adds a line to `applySwitches` should say so in one place, since Task 5's omission of
  its line is what made the whole `views` switch inert.
