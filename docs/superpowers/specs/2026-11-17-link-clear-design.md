# Clearing a link by clicking empty space — short design

## Intent

Davey, 2026-11-17, trying the state diagram's drag: "we should also make it so if you click outside it deselects that
code section". Asked where such a click should clear the highlight, he
chose "Empty space, any view", put to him as: a click on empty space in any view clears it (the diagram's background,
blank rows of the rules list, the tapes panel, the λ and rxm views), and Escape clears it too, for the keyboard.

## The approved design (2026-11-17, Davey's "ok")

1. A click on anything in a view that does not link clears the highlight: the tapes, the diagram's background, blank
   space beside a λ line, rows that link nothing.
2. A press that moves more than 4 px is a drag and clears nothing.
3. Escape clears it while the focus is in a view, but not in the code editors (their Escape stays theirs) and not
   while a menu or dialog is open.
4. A click on empty space in a view showing a copy clears the program's highlight too.
5. A click in the source editor works as before: a click on a spot with no construct already clears.

The controller's calls, shown to Davey inside that design: (1)'s blank space beside a λ line and rows that link
nothing count as empty space, (4), and (3)'s rule for the editors.

## The implementer's calls (2026-11-17)

- **A click clears unless it linked or landed on a control.** Whether a row links depends on the row (a label or
  sub-step row, an rxm instruction `defunc` minted, any row of a copy) and only the view's own click handler knows. So
  `LinkWiring` counts its link gestures (`gestures`), and the clear's listener, on `#views` and after every view's own
  handler, does nothing when the count moved during the click. That also keeps the line an rxm instruction with no
  owner writes ("this instruction has no source construct"), which a clear after it would erase.
- **Controls keep the pin**: buttons, links, form fields, separators, anything with a widget role, popovers, an
  editor, a view's or panel's header, the λ term map (a click there navigates), and the λ view's fold and open
  toggles.
- **The source view is left out whole**, by (5): its header is chrome and the rest is its editor.
- **A row of a copy clears**, by (1) and (4): it links nothing.
- **The clear scrolls nothing**, by Davey's ruling below: a rule table or rxm listing a link scrolled keeps the hold
  that scroll took, and follows the run again at its next step.
- **It is silent.** The status line empties and the live region is given the empty line, as for a source click on no
  construct.
- **Escape with the focus on the page's body counts as in a view**: a click on text that takes no focus, such as the
  tapes, leaves the focus there.
- **No guard for a scroll bar.** Chromium sends no click for a press on a classic scroll bar (a probe in the
  `browser-scrollbars` project, 2026-11-17); Firefox under Playwright draws overlay bars of no width, so what a press
  on one sends there was not measured by that probe. Review 1 measured it in headed Firefox under Xvfb, with classic
  and overlay bars: no click reached the views.
- **One threshold.** `DRAG_THRESHOLD` (4 px) is the state diagram's pan threshold too, so a press that pans never
  clears.

## Mechanism

`web/src/link-clear.ts`: one `pointerdown` (capture) and two `click` listeners (capture, to read the gesture count;
bubble, to clear) on `#views`, and one `keydown` on the document for Escape. A press is followed by the furthest the pointer got from where it
was pressed, so a drag out and back is still a drag. A click is classified by its
`composedPath()`, fixed at dispatch, because a grid's click can redraw the rows under it before the event reaches
`#views`. Escape's rule is a pure function, `escapeClears`, over the press and where the focus is.

`LinkWiring.unpin()` is the user's clear: nothing pinned, everything that draws the link redrawn with no scroll, and
linking left on.
`clearLink()` is the edit's clear, which turns linking off until the next compile, and is not used for this. `unpin`
does nothing when nothing is pinned, so an empty click costs no frame.

## After review 1 (2026-11-17 (2))

Davey tried the branch ("clear highlight seems good") and ruled on two of review 1's findings:

- **"Stay put"**, asked whether the rule table and the rxm listing should scroll back to the running state's row when
  a click clears the highlight: "The lists stay where they are when the highlight clears; they pick up following the
  running state again on the next step. Nothing moves on the click itself." Before this, the clear dropped the link's
  scroll hold, and the next draw sent each list back to the run's row (measured in review 1: 174 rows in one example).
- **"Keep the highlight"** (SUPERSEDED by (5): no double-click), asked whether a double-click on the diagram's
  background should both reset the zoom and clear the highlight: "A double-click only resets the zoom; the highlight
  the first click cleared comes back." The controller applied it to any double-click whose first click cleared (a word selected on the tapes) and to a
  Shift-click, which extends a selection.

The controller's calls: a press with a menu or popover open clears nothing, the click only closing the menu, as
Escape there does; a copy's diagram node and runtime box are no longer kept, so the gesture count decides for them as
for rows (a copy's link nothing, so a click on one clears).

The implementer's calls:

- **Stay put is `unpin` drawing with no scroll**: the rows unmark and every scroll hold stays, as an edit's clear
  leaves them. A view off the page whose link row was still waiting for a draw keeps that row too, as after an edit's
  clear, and scrolls to it when it is next shown (by reading `VirtualGrid.scrollToRow`, not measured).
- **The double-click puts the pin back on its second click; it does not hold the first click's clear back.**
  SUPERSEDED by "No blink on a double-click" below. A clear
  held for as long as a double-click can take (the platform's setting, which a page cannot read) would slow every
  clear, so the first click clears at once and the highlight blinks off until the second click, then returns.
  `unpin` returns what puts the pin back, which does so only while nothing has pinned, cleared, edited or compiled
  since, and is no link gesture; its redraw says the status line again where the clear had changed it, as a link
  gesture does. The second click's `mousedown` would be earlier, but the local level stops its press's
  `mousedown` (a press there may pan), and a redraw there takes the node under the pointer away before the browser
  selects its word.
- **The selection is kept across that redraw** (SUPERSEDED with the restore, below). The restore redraws the views,
  which draw the same frame again in new nodes, so the word a double-click selected would go with the old ones. The
  selection's two ends are recorded as child indices under `#views` and put back on the new nodes.
- **A later click of a run that cleared (or, since (3) below, put its clear off) clears nothing** (SUPERSEDED by (5):
  the first clears at once, and a later one finds nothing pinned), and a click with Shift held clears nothing. A run that did not clear (a drag, then a click soon after at the same spot, which the
  browser counts as a second click) clears on its next click.
- **The Escape listener returns at once for any other key**, every key press in the editors reaching it.

## No blink on a double-click (2026-11-17 (3))

SUPERSEDED by (5): the clear is at once everywhere, and the local level's double-click reset is gone.

Davey tried the double-click that took the highlight off at its first click and put it back at its second:
"the blink bothers me, it shouldn't do that".

The controller's call: where a double-click means something of its own (the local diagram's background, which resets
the zoom; text the user can select by double-clicking, such as the tapes), a click on empty space clears the link only
once the double-click window has passed with no second click, and a second click in that window calls the clear off,
so the highlight never goes off. Everywhere else a click clears at once, as before. The undo on the second click goes.

The implementer's calls:

- **The window is 500 ms, `SECOND_CLICK_MS`** (SUPERSEDED: by (4) a 250 ms wait, by (5) none), the figure `notice.ts` already uses for the same interval: a page
  cannot read the platform's double-click time, and 500 ms is the interval most systems default to. It runs from the
  first click, at the release, and the platform counts its own from the first press, so a second press the platform
  counts comes inside the window whenever its setting is 500 ms or less. With a longer setting, a second click later
  than 500 ms finds the highlight cleared and leaves it so: no blink, but no highlight kept either.
- **Where a double-click means something, `doubleClickMeans`**: the local level off its nodes (its `dblclick` resets
  the zoom), and an element holding text of its own that is not a control's and not `user-select: none` (a
  double-click there selects a word): a tape's cell or label, a register, a row of a copy's rule table. The element is
  the click's target, the one the browser's own hit test found, so blank space beside text, which the hit test gives
  to the line or panel holding it, clears at once: the blank beside a λ line, the room below the rxm listing's or the
  λ term's last row, the diagram's program level, and a copy's diagram node, a control. The character under the
  pointer (`caretPositionFromPoint` and the character's box) was considered and not taken: it leaves out a tape cell's
  padding, where a double-click selects the word all the same.
- **A press holds the waiting clear, and its click decides.** A press can be held past the window, and a clear falling
  due under a double-click's second press would take the highlight off just as the undo did. So a press on `#views`
  stops the timer, and the click it ends calls the clear off if it is a double-click's second (`detail` 2) or lets it
  run at once, after the click's own handlers, if not. A release whose click misses `#views` lets it run in the task
  after. The press's `mousedown` would carry the count earlier, but the local level prevents its `pointerdown`'s
  default, and with it the `mousedown`.
- **A link made while the clear waits stands**: the clear runs only if the gesture count is the one its click read.
- **A Shift-click in the window calls the clear off too**, as a second click does. Run at the Shift-click, the
  waiting clear's redraw would rebuild the tape cells under the selection the Shift-click had just extended from the
  first click's caret, and take it away; called off, the selection stays and so does the highlight, as "a Shift-click
  still clears nothing" (addendum (3)) asks.
- **Nothing to keep across a redraw**: with no clear or restore between the two clicks, the word the second selects
  stays, and `keepingSelection` went with the undo. `LinkWiring.unpin` returns nothing again.

## A quarter-second wait (2026-11-17 (4))

SUPERSEDED by (5): no wait.

Davey tried (3): "half a second is way too slow, how does something like youtube handle double clicking to full screen
the video". Told that YouTube acts on the first click and lets the second undo it (the blink he had already turned
down), and offered a clear at once with a double-click clearing too, a shorter wait, or those spots never clearing, he
chose **"Shorter wait"**: keep the highlight through a double-click, but wait about a quarter of a second instead of
half; a quick double-click keeps the highlight, and a slow one clears it on its first click, without a blink.

The controller's call: the wait is 250 ms, a constant of its own in `link-clear.ts`, and `notice.ts`'s
`SECOND_CLICK_MS` keeps its 500 ms for its own job, a notice's catch of a second click. Everything else from (3)
stays: where the clear waits, the hold at a press, the call-off on a second click or a Shift-click, the spots that
clear at once.

The implementer's calls:

- **`CLEAR_WAIT_MS = 250`** (SUPERSEDED by (5): gone). A double-click whose second press comes after it, which the system may still count as
  one (`detail` 2), finds the highlight cleared by its first click's wait. The first click of the run cleared, so the
  second clears nothing more and draws nothing back: the highlight goes once.
- **The tests time a waiting clear from 245 ms to under 450 ms after its click.** A timer never runs early, so the
  lower bound holds on any machine; the upper bound leaves 200 ms for a loaded machine's late frame, and a 500 ms wait
  fails it.

## No double-click; *local* pressed again resets, centred (2026-11-17 (5))

Davey tried (4): "ok I don't like it, I think I wuld rather drop the double click, and we can actually make pressing
"local" after it's already highlighted reset the view", and: "one more thing for the state diagram local view, when
it's "reset" it would be nice if it was centered and not right aligned".

The controller's calls: a click on empty space clears at once everywhere again; the local level's background
double-click reset goes; the tapes' double-click word selection is the browser's own and stays, its first click
clearing the link, which then stays off; pressing *local* (spec §8's *program | local*) while the local level shows
puts it back at full size where a first draw places it, by keyboard too, and clears no link, a control not being empty
space; pressing *program* while it shows does what it did; and the centring rides in this branch, being the same reset.

The implementer's calls:

- **The wait goes whole**: `CLEAR_WAIT_MS`, `doubleClickMeans`, the waiting clear, its hold at a press and its
  call-off. A Shift-click still clears nothing, its redraw taking away the selection the click extends.
- **So does "a later click of a run that cleared clears nothing"**: the first click clears at once, a later one finds
  nothing pinned, and `unpin` does nothing then.
- **The level's other reset stays**: the `0` key with the focus in it, beside `+`, `=` and `-`.
- **What *local* says**: while the local level shows, its `title` and `aria-description` read "press again to reset
  the view", a `hint` on a `radioGroup` choice, said while the choice can be made (a disabled one's reason still
  takes its place). *program* says nothing new.
- **A press of *local* reads what shows before it picks**: one that brings the level in from the program level keeps
  its zoom; only a press while it shows puts it back at full size. (Its place is not kept: a change of level centres
  the current state again, as `setLevel` did before this branch; measured after review 2, below.)
- **Why the reset sat to the right, and the fix.** Measured in both engines with a probe of the level's box and of
  the boxes of what it draws: the reset left the level exactly where a first draw does, in every case tried (panels
  300, 520 and 1000 px wide; zoomed in or out and panned first). In a panel wider than the level, `layoutLocal` spreads
  the spare width over every gap, the empty ones past the outermost columns that hold a state too, so the drawing's box
  is the panel's width but what it draws can sit to one side of it: around a state with nothing two columns before
  it, in a 1000 px panel, the box held 150 px of nothing on its left in Chromium and 148 in Firefox, and 8 px on its
  right, and the placing, which centred the box, showed the drawing 71 px right of the panel's middle in Chromium and
  70 in Firefox (measured before the rebase, on `0230e6b`, at `74bfdab`, in `r5/probe3-*.log`; `r6/sha-map.txt`
  maps the SHA). `LocalLayout.inked` names the part of the
  drawing anything is drawn in, with the margin round it that the drawing has above it, and `#place` centres that: a
  first draw, a step to a new state, a resize and the reset alike. The layout's spread is unchanged.
- **The first draw is tested through a resize**: a level not moved since it was placed is placed again by the same
  `#place` a first draw uses, and a resize to a wider panel is the case that spreads the outer gaps.

Davey tried (5): "yes looks good".

## After review 2 (2026-11-17 (7))

Review 2 (at `523bfd4`) found 0 Critical, 1 Important and 6 Minor. The controller's calls, with their reasons:

- **One Escape does one thing, the innermost first** (I1). Escape in a TM view's **width** box with a width typed
  there put the typed width back and cleared the link too. The box now prevents the Escape it uses, and the clear
  already passes over a prevented Escape, as it does an editor's; with nothing typed to put back the box uses no
  Escape, and it clears the link as anywhere else in the view. Of review 2's two fixes, this one and not "the focus in
  any text field counts as an editor's", because the box's Escape is only the box's while it has something to undo.
- **The pan's reach follows what is drawn** (M3), here rather than in a follow-up, being the same blank room the
  centring met in (5): `.local-content`, whose room round it is the reach, is now the part of the drawing anything is
  drawn in (`LocalLayout.inked`) at the zoom, with the drawing set in it at that part's offset and clipped to it. A
  drag then ends where a corner of what is drawn reaches the panel's middle, so some of it always stays in the panel.
- **Tests for what held untested**: the width box, its label, its arrows and typing in it keep the link (M1); a press
  of *local* from the program level keeps the local level's zoom (M2); a pin made outside the rxm listing leaves the
  listing and the rule table where it scrolled them when it clears (M6).
- **M2 asked for the zoom and the pan; the pan is not kept.** Zoomed to 1.5 and moved off the middle, then *program*
  and *local* pressed: the zoom came back at 1.5 and the current state centred again (57 px off the middle across
  before, 0 after, in Chromium; 59.1 and 0 in Firefox), because `setLevel` forgets the place on any change of level.
  This branch did not change that, and the test holds the zoom alone. The controller's ruling at the finish
  (2026-11-17 (8)): that is right and stays, as on `main`, because a change of level shows the level afresh.
- **The help page** (M5) gains a row for Escape clearing the link, and its local level's row names `+`, `=`, `-`,
  `0` and the second press of *local*.

The implementer's calls:

- **The box is the inked part, not a margin less the blank.** Review 2 suggested the margin less the blank on each
  side. A negative margin does not take the drawing's own box out of the scroll's range on the far side, so a level
  with blank past its last column would still be lost there; a box that is the inked part, clipped, has no such side,
  and `#zoomAt` keeps its arithmetic, a point of the drawing staying its distance from the box's corner at the zoom.
- **The clip is safe for what is drawn**: `inked` holds every node, line and label with `PAD` (8 px) round it, more
  than a node's focus ring (2 px at 1 px out).
- **M6 uses a program of its own**, `fact(3)`'s, for its describe alone: the sample's rxm listing is 5 rows and never
  scrolls, so a pin could not move it.
