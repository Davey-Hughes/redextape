# A panel's title drags its boundary — design

2026-11-22, on branch `panels-row`. A short design, from Davey's try of the branch: "if you grab onto the spot in these
places with words, like > values, > callstack, you can't drag. can we make these spots draggable too?"

## Intent

A panel's header is a handle for the boundary above it (`panel-stack.ts`'s module doc), but a press on one of the
header's controls is that control's (`panel-stack.ts`, the handle's press filter: `closest('button, select, input,
a')`). The panel's title, "› values", is its open-and-close toggle, a button, so a press there never drags: only the
header's empty space does, and the title is most of what a pointer finds.

## Goals

- **G1.** A pointer press on a panel's toggle that moves more than a few pixels before it is released drags the
  boundary above the panel, as a press on the header's empty space does; the toggle's click is then not acted on.
- **G2.** A press on the toggle released without that movement is a click, as today: the panel opens or closes.
- **G3.** The open hand (`grab`, `grabbing` while dragging) shows over the toggle wherever a press there would drag.
- In every panel header that is a handle, in every view, not only the CLIF and rxm views'.

## Non-goals and anti-goals

- The header's other controls (maximise, choices, links) stay their own: a press on them never drags.
- A double click on the toggle stays two clicks of the toggle (open, close); the reset by double click stays the
  header's empty space's and the boundary's.
- The keyboard and touch are unchanged: a finger's press on a header is left alone (a header is what a narrow view
  offers to scroll by), and the toggle keeps its focus and Enter/Space.
- **Anti-goal: a click that opens or closes a panel never moves a boundary**, and a drag never opens or closes one.

## Approaches

1. **A press on the toggle becomes a drag past a few pixels of movement, a click otherwise.** Picked by Davey.
2. Only the chevron is the toggle and the words become part of the bar: turned down, it shrinks what a click finds.
3. A long press to drag: turned down, slow, and unlike every other handle in the app.

## Left to the builder

- The movement threshold (a few CSS pixels, the same in both directions), and how the click after a drag is
  swallowed so that no other click is.
- Where the toggle is identified (the panel's own toggle element, not any button in the header).

## As built

The plan is `docs/superpowers/plans/2026-11-22-panel-title-drag.md`, and the build is `c1172f7`, `ff329c9` and
`d0e3df0`. Where it differs from the text above:

- **The threshold is read on either axis**, where *Left to the builder* says the same in both directions: a press on the
  toggle becomes a drag once the pointer is more than 4px from where it was pressed, up, down or sideways, and the
  boundary moves by the vertical part alone, so a press slid sideways along the title is a drag that moves nothing,
  never a click. Read up and down alone, a press slid along the title and let go on it would open or close the panel,
  against the anti-goal.
- **A double click on the toggle is two clicks of the toggle only where closing the panel leaves its title under the
  pointer.** Where the close moves the title, the second click is whatever is then under the pointer, as before this
  change (`~/temp/redextape-panels-row-record/impl3/preflight.md`, F6).
- **Nothing swallows the click after a drag**, where *Left to the builder* asks how it is swallowed. In Chromium and in
  Firefox alike the click a drag's release makes goes to the header, which holds the capture, not to the toggle, so none
  was built; and a drag begun on the title leaves no selection
  (`~/temp/redextape-panels-row-record/impl3/01-probe-chromium.log`, `01-probe-firefox.log`). WebKit is not measured.
