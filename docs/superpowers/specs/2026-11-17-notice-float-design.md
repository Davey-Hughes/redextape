# Notice float — short design

## Intent

Davey, 2026-11-17: "also the message that shows up for 'opened the example...' all these sort of banner messages
which shift the page should be removed. I don't want anything like this that shifts the page unexpectedly".

The notice line (Plan 7 part 2 spec §11) sat in the page's flow under the header. A notice showing pushed everything
below the header down a line, and its end pulled it back; the resting sentence (*… not being saved*) did the same
when it came and went.

## The user's decision

Asked how the notices should stop shifting the page, with three options (float them; remove them, losing the four
undo buttons; a fixed empty line under the header), Davey chose **float them**, described to him as: "The message
floats over the bottom corner of the window, so nothing moves. The words and the undo buttons stay; it fades after
8 s as now." The preview he saw drew it at the bottom-right, over the workspace. "Fades" there meant "goes away": no
animation is asked for.

## The controller's calls

- **Where, in the first build:** the window's bottom inline-end corner, 16 px from the bottom and inline-end edges, and
  at a phone's width the window less a 16 px gutter each side. Superseded by the user's decisions below.
- **The resting sentence floats in the same place** while its condition lasts.
- **Everything else stays:** the words, at most one action button, `NOTICE_MS`, a new notice replacing the old, the
  live region and the focus fallbacks.
- **Look:** the app's floating surfaces (menus, popovers) set the border, radius, background and shadow, by their
  tokens; no new glyphs or marks. Above the panes, below modal dialogs.

## The user's decisions, 2026-11-17 (second round)

The first build covered the step bar's controls at 320 and 390 px and the strip's right end at 1280 px, and five
browser tests went red in `step-bar-narrow.test.ts` and `focus-press.test.ts`. Asked where the notice should float,
Davey chose **"Above bottom bars"**, described to him as: "It floats just above the step bar and results strip, never
over a control in them. It covers a corner of the bottom-right view for 8 s, but clicks on its words go through to
what's underneath. Only 'undo' takes a click." The placement was superseded by the third round; the click-through
words stay.

He also chose to leave the sweep's list to a separate, measured follow-up PR: it is kept below, under *Not closed
here*, and this lane changes nothing on it.

## The controller's calls after review 1, 2026-11-17

- **The resting sentence gets its own `hide`.** It can last a whole session (site storage blocked), where the user was
  told a notice lasts 8 s; `hide` takes it off until the condition changes, so it never stays against the user's wish.
  A notice drawn over it still shows as before.
- **Review 1's minor findings are fixed as it suggested**, where they still apply after the third round: the stale
  "under the header" in `link-status.ts`, the part 2 spec's pointer, a measurement kept in a test comment, and a
  page taller than the window tested, with "inside the window" read from the document element's `clientWidth` and
  `clientHeight`. The third copy of `NARROW_WINDOW` went with the rule that held it.
- Holding the lift while the undo is pressed (review 1's first finding) was ruled and then made moot by the third round:
  the notice no longer follows the bars.

## The user's decision, 2026-11-17 (third round)

Davey saw the notice above the bars and said: "I think maybe it should show up at the top of the screen. like top
right. I'd still like it to be an overlay so it doesn't move anything, but if it can try to find an empty spot to the
left of "share" or any button in that set then it would be ideal. if it needs to draw over on small screens it can".

**The controller's measurements** (Firefox, the lane's dev server at `1010ab1`, Explorer, the header's empty run
between the left group's last control, the encoding select, and `share`): 55 px at 1280 wide, 215 at 1440, 375 at
1600, 695 at 1920, 1335 at 2560. Notice widths on one line: "opened the example fact(4)" with its undo 266 px; the
longest example's title with its undo 455; "link copied" 101; "view added — TM · program" 208; "opened a shared
link's program — its workspace and step positions were left out" with its undo 593.

**The controller's calls:**

- **The notice stays at the top when it does not fit the run** (narrow windows, long messages, phones where the header
  wraps): it keeps its inline end and grows towards the inline start, over the header's controls there, rather than
  dropping over the views. It is no wider than the window less a 16 px gutter; words that still do not fit wrap, and a
  wrapped notice grows down over whatever lies below it.
- **Where `share` begins a row of its own, the notice follows the empty run itself** (the header's `.bar-spacer`), not
  `share`: its inline end is the run's, on the run's row. The implementer measured (Chromium, the dev server at
  `1010ab1`, each style and Explorer, Debugger and Stage, widths 300-1400 px in 2 px steps; Firefox agreed at the
  bands' edges) that `share` is first on its row, with no room before it, at about 850-965 px in every style and preset
  (Instrument: Explorer 880-954, Debugger 892-964) and at 354-402 px on the Stage (Instrument 360-374, Paper 354-372,
  Terminal 388-402); everywhere else at least 168 px lies before it. In those bands the run ends the row above
  `share`'s, at the header's inline end, so the notice sits at the window's top inline-end gutter on that row, over
  its last controls. The reason: the user asked for "an empty spot to the left of share or any button in that set"
  and allowed drawing over on small screens. No threshold: wherever `share` shares the run's row, the run's end is the
  header's gap before `share`, the place the third round names.

## The implementer's calls

- **Placed from the run, measured by a script.** `floatInRun` in `notice.ts` watches the header and every control in
  it with a `ResizeObserver`, and sets two properties on the notice: `--notice-end`, how far the run's end lies from
  the window's inline end, and `--notice-row`, the middle of the run's row. Every way the run can move changes the
  size of the header or of a control in it: a window resized, a preset whose name is longer, a row wrapped, the
  fonts arriving. The observer runs after layout and before paint, so the notice follows in the same frame.
- **The gap before `share` is the header's own column gap** (16 px; 8 px at 30rem and narrower, and in the Terminal
  style up to 85rem), because that is where the run ends: the notice reads as one more item in the header's row.
- **Fixed to the window, measured as the page lies scrolled to its top.** On a page taller than the window (Debugger
  with `fact` at 1280×800), scrolled down, the notice stays in sight at the window's top rather than leaving with the
  header.
- **Its first line is centred on the run's row**, whatever follows: the box is anchored at its top and inline end. The
  first line is the action's height (its line and its 1 px border); the words carry a 1 px block padding so a notice
  with no action has the same first line.
- **The action sits at the end of the notice's FIRST line**, as the old line had it. Plan 7 part 6a spec §5.5's rule is
  that no length of the words moves a kept button; anchored at its top and inline end, the box grows towards the
  inline start and down as the words lengthen, so that corner stays still. `stays where it was however long the words
  are` in `tests/browser/notice.test.ts` holds it.
- **No 32rem cap and no phone-width rule.** The notice is as wide as its words, up to the window less where it ends
  and the gutter; the earlier cap and the `NARROW_WINDOW` span (and its unheld copy of that width) are gone.
- **The words pass the pointer through: `pointer-events: none` on the notice, `auto` on `.notice-action`**, kept from
  the second round. Over the header that matters more: a click on the words reaches the control under them.
- **`position: fixed`, `z-index: 10`.** Fixed takes the notice out of the flow, so nothing moves. `z-index: 10` is the
  view keys' hint's, the app's other page-level float; the header sets none, so the notice paints over its controls.
  Every menu, popover and modal dialog is in the top layer, which paints over any `z-index`, so an open header menu
  covers the notice where they meet: the menu is what the user just opened.
- **Drawn as the menus are:** `1px solid var(--rule)`, `background: var(--bg)`, `color: var(--fg)`, no radius and no
  shadow, as `.header-menu`, `.view-menu` and `.buffer-list` have.
- **`hide` is the resting sentence's action, on the notice's one action button.** The sentence stays off until `rest`
  is given a different sentence: the same sentence again, even after the condition cleared and came back, stays off,
  because a write refused by size can clear and return as the user types. An undo holding the focus that ends onto
  the resting sentence, pressed or expired, hands it to its own fallback, not to `hide` (review 2's I1, below); `hide`
  itself, naming no fallback, leaves the focus on the line's fallback, the copies button.

## The user's verdict on the third round's build, 2026-11-17

Davey tried the top placement as built at `6d43f88` and, before the fourth round, said: "banners looks good" (the
controller's record of when).

## The user's decision, 2026-11-17 (fourth round)

Review 2 found that at 1280 px, where the header's run is about 20 px wide, the example's notice covered `examples ▾`
and the encoding select for its 8 s, and its undo lay over the select's arrow: a real press at the arrow ran the undo
and put the program back, in Chromium and Firefox. Asked "When the message doesn't fit the gap, where should it go?",
with three options, "Over the right buttons" (the one recommended to him), "Keep over the left" ("As now: it covers
examples and encoding for 8 s; a click on encoding's arrow in that time hits undo.") and "Under the header" ("It drops
just below the header, over the top of the views; at 1280 'undo' lands on the TM view's ↺ ◀ ▶ buttons, so pressing
play right after an example could hit undo."), Davey chose **"Over the right buttons"**, described to him as: "It
moves to the header's right end and covers share / system / about / settings for 8 s; 'undo' sits over 'settings',
which you're unlikely to click right after opening an example. In a wide window it still sits in the empty gap." It
replaces the third round's call that a notice wider than the run keeps the run's end.

So a notice that fits the run ends where the run does, as before; one that does not ends at the header's inline end
(the window's 16 px gutter), on the run's row, which is `share`'s row, or the run's own row in the bands where `share`
begins a row, and grows towards the inline start over `settings`, `about`, the appearance button and `share`, and
further only when it is wider still. The resting sentence follows the same rule.

## The controller's calls after review 2, 2026-11-17

- **I1: the focus and a second press.** With the resting sentence up, an undo's press, like its expiry, sends the focus
  to the undo's own fallback (`main.ts`'s palette removal promises the settings button, an example's names
  `examples ▾`), not to `hide`; and `hide` ignores the second click of a double-click, so a double-click on an undo
  cannot hide the warning.
- **M1: Tab reaches the notice's action where it is drawn**: before `share` when it is in the run.
- **M2-M4 as review 2 suggested:** the two comments that said the opposite of the code now hold again with I1's fix; an
  action-less notice is held on the run's row in a test; the Terminal gap above.

## The implementer's calls after review 2

- **"Fits" is the notice's width against the run's**: no wider than the run, it covers nothing and leaves at least the
  header's gap on either side. Either place leaves the notice at least the run's width before it wraps, so its width as
  drawn answers the question wherever it is, with no second layout.
- **The place is decided for new words and when the header changes, and kept when the same words' element is
  rewritten.** `paint` keeps the button for the same action offered again (Plan 7 part 6a spec §5.5) so a press held
  across a link clamp's redraw still clicks it; a notice that moved from the run to the header's end because the
  redraw's words were longer would take the button from under the pointer. Such a redraw that no longer fits the run
  grows over the controls before the run until the next notice or a change of the header. The words are watched with
  a `MutationObserver`; the line is not observed for size, since placing it can change its width and a size observer
  that changes what it observes loops.
- **The header's inline end is read from the header**: its box's end less its own inline padding, `--space-3`.
- **The notice is a child of the header, and Tab reaches its action where it is drawn.** Where it ends at the run's
  end (in the run, or in the bands, where the run ends its row at the header's end), it sits just after the run, so
  Tab reaches its action after the encoding select and before `share`. Where it lies over the controls after the run,
  its action over `settings`, `floatInRun` moves it to the header's end, after `settings`: Tab reaches its action
  after `settings`, as it is drawn, and a palette removed from the settings menu, which leaves the focus on
  `settings`, has its undo one Tab away, as `base16-remove.test.ts` holds. The element moves only when the place is
  decided again (new words, or the header changed), never under a kept button, and a focused action takes the focus
  back after the move. Fixed, it takes no flex slot and no gap; `header-menus-narrow.test.ts` counts the header's
  rows without it. `style.css`'s about-menu comment loses its reason about `settings` being last for the notice.
- **`hide` ignores a click whose `detail` is above 1**, the second click of a double-click; a key press is a click of
  `detail` 0 and still acts. Other actions are left as they were: an undo's double-click runs it once already, since
  its button goes with its notice.

## The controller's calls after the fourth round's build, 2026-11-17

- **A notice too wide for the run ends on the row of the header's last control, `settings`, wherever that row is.**
  At 414×896, vitest's default window, `share` ends its header row and `settings` sits a row below; ended at the
  header's inline end on the run's row, the example's undo lay over `share`, and a press on `share` within 8 s of an
  open ran the undo (`share-through-open.test.ts`, unchanged, failed on it in Chromium and Firefox). The user chose the
  overflow so that "'undo' sits over 'settings'": on `settings`'s row, at the header's end, the action lies over
  `settings` or over the empty end of that row, and over no other control. In the bands where `share` begins a row,
  this replaces the third round's call for a notice wider than the run: it ends on `settings`'s row, the one below the
  run, not at the run's end above. The old place there was no better: in the bands the run is narrower than `share`
  and its gap, so the example's undo at its end lay over the encoding select at 900 px in Explorer, and on the Stage
  at 365 px the notice covered `examples ▾` (`notice-float.test.ts`'s band cases, run against the old place, in both
  engines).
- **A notice drawn in place of one whose action was just pressed takes clicks on its words for 500 ms, then lets them
  through as usual.** A real double-click on the example's undo at 1280 px ran the undo, and its second click passed
  through the undo's own notice (*put back the program*) to `settings`, whose menu opened. The 500 ms swallows a
  double-click's second click; after it the words pass clicks through again.

## The implementer's calls after the fourth round's build

- **The header's last control is its last child that is neither the notice nor a menu**: the menus are popovers, out
  of the header's flow. `floatInRun` reads that control's row for `--notice-row` when the notice ends at the header's
  end, and the run's row otherwise. The header and every control in it are already observed for size, so the notice
  follows `settings`'s row as the header wraps.
- **At the header's end the action is reached by Tab after `settings`, always**: on `settings`'s row at its end, the
  notice is after `settings` in the reading order, the bands included (where before it sat at the run's end above
  `share` and was reached before `share`).
- **What catches is whatever the line draws while a press of its action is handled**: the action's notice is ended
  and the action run in one task, so a resting sentence put back by the press and the notice the action says catch
  alike, each until `SECOND_CLICK_MS` (500 ms, the double-click interval most systems default to) after the last of
  them was drawn. A line the press left empty catches nothing; `hide` still ignores a second click, for the palette
  undo that says nothing over a resting sentence. While it catches, a press on the words is held from moving the focus
  or selecting the words (`mousedown`'s default prevented), so the focus stays where the action put it.

## Moved into this lane: the link sentence's line

The controller's ruling, 2026-11-17: the one item of the sweep's list that then moved the notice is fixed here. The
notice followed the strip in the second round, and a strip that grew mid-run moved it, and an undo under a held press
with it (`share-open-clamps.test.ts`'s held press failed on it). The third round's notice no longer follows the strip,
and the fix stays: a strip that grows mid-run takes its height from the workspace above it, a real shift. Measured in a browser test at 390×844 and 1280×800 with the
link sentence on its own strip row: an empty `#link-status` is its `min-height`, 1.2em, 13.25 px, and a sentence
(*linking resumes when this compiles*, written by an edit and taken away when the run ends) drew one line at the
inherited `--leading`, 16.5625 px, so the strip grew 3.3125 px for the run. `.strip .link-status` now sets
`line-height: 1.2`, the `min-height`'s own measure, so the empty line and the written one are the same height; at
rest, empty, the strip is the height it was. `notice-float.test.ts` holds the strip at one height across a run in
each preset at both sizes. The rest of the sweep stays below.

## Not closed here

**The sweep.** Every other element the app shows or hides in the page's flow on its own, with its trigger. None is the
notice line's kind (a passing page-level message laid over the flow), so none is changed here; the user's decision
above sends them to a separate, measured follow-up PR. The list is a reading of the code at `486df8d`, not a
measurement, except the readout's strip: `notice-float.test.ts` first compared boxes mid-run and saw the strip grow
3.3 px under a run of `fact(4)` and `main` shrink by as much.

| element | trigger | what it moves |
|---|---|---|
| `#results > .banner` (worker error) | a worker call throws after start | the readout's foot grows, `main` shrinks |
| `#views > .banner` (app did not start) | wasm `init` or the worker fails to load | replaces every view; fatal |
| `#link-status` sentence | a source click pins, an edit makes linking stale, a view shows a copy | one line's height, empty or written (moved into this lane, above); wraps to a second strip row when it does not fit beside the readout |
| `#results` segments | every compile, step and run | the strip's wrapping row changes height during a run, and `main` with it |
| `.controls .extend`, `.controls .step` | a run stops at its budget or cap; every step | can add a row to the step bar or a view's header |
| `.tm-status`, `.tm-value`, `.rxm-value` | a compile (empty, then filled); a copy's value | the tapes, listings and diagram below them |
| `.term-reattach`, `.table-reattach`, `.diagram-reattach` | a scroll away from the run; a link to an off-screen construct (λ) | can wrap a view's header |

**Found on the way, measured, not changed** (a Playwright probe of the boxes on the lane's dev server):

- **`footer.strip` is drawn while `hidden`.** `.strip` sets `display: flex` and has no `[hidden]` rule, so when the
  readout moves to the inspector (debugger, stage) the strip stays on the page, empty, 9 px tall, at 1280×800,
  390×844, 375×800 and 320×568.
- **An open inspector can lengthen the page at a desktop's width.** In debugger at 1280×800 with `fact` open, the
  inspector's readout makes `<main>` 7,394 px tall and the page 7,487 px, where its rule says the rows scroll and the
  column does not. Read against this lane's diff, which changes no rule of the page's layout, it is on `main` too; it
  was not run on `main`.

Opened or toggled by the user, and left as they are: `#step-bar`, `#inspector` and `footer.strip` (presets and
switches, and a link's open, which applies its workspace), a view's steps, a copy's text panel, panel bodies, stage
tabs, and the copies count in the header.
