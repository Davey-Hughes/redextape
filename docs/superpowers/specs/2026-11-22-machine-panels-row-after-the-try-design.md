# Machine panels row: three changes after Davey's try — design

2026-11-22, on branch `panels-row`, after the build of [the machine panels row design](2026-11-21-machine-panels-row-design.md)
(its §11 says what was built). A short design: three small changes, each from Davey's try of the branch in Firefox.

## Intent

- "in cases where the things like the call stack are small, I can't make it shorter so it wastes space": in a narrow
  view the values (registers in rxm) and the call stack split their region's height evenly, with no boundary between
  them, so a call stack of one frame keeps half the room.
- "I think we can make the gap between them a bit smaller": panels in a row stand 1rem (16px) apart.
- "can we also make the text that's next to the full size box for each of these center aligned?": a panel's count
  sits high beside its maximise button. `.panel-actions` (`style.css`) lays its items out with flexbox's default
  `stretch`, so the count's box is as tall as the actions and its text sits at the top of it.

## Goals

- **G1.** In narrow, a boundary between the first panel and the call stack, dragged as every other boundary is: by
  the call stack's header with a pointer, by the boundary with the keyboard. Where it is set is stored with the view's
  other shares (workspaces and links) and kept across arrangement switches.
- **G2.** Panels in a row stand `var(--space-2)` (8px) apart, the spacing panels already have above and below them.
- **G3.** A panel header's count is centred top to bottom on the header's buttons, in every panel header that shows
  one, not only the CLIF and rxm views', so headers match across views.

## Non-goals and anti-goals

- Medium and wide change only by G2: there the call stack's spare room sits beside the first panel, not under it.
- No panel sizes itself to its content.
- **Anti-goal: nothing moves on a step.** A call stack that fitted its frames would jump at every push and pop; that
  is why approach 2 below was turned down.
- **Anti-goal: a workspace or link written before this shows the heights it shows today.** With nothing stored for
  the new boundary, the first panel and the call stack split evenly, as today. This holds where the five-row floors
  did not bind: at short heights both bodies now open smaller, on their share where that clears a floor of two rows, as
  in a view 650px tall or more in rxm and 700px or more in CLIF, and on that floor below it, while the listing and the
  heap take the room, the listing alone where the heap too is on its floor, as in a CLIF view 600px tall (Davey's
  choice, 2026-11-22). Measured in narrow with nothing stored, the listing, the first panel, the call stack and the
  heap, in px, before and after the two-row floor: in a view 900px tall, rxm 387.3, 123, 123 and 193.7 to 413.5, 103.4,
  103.4 and 206.8, CLIF 346.7, 123, 123 and 173.3 to 383, 95.8, 95.8 and 191.5; in a view 700px tall, near what a 692 by
  896px window gives the CLIF view, rxm 254, 123, 123 and 127 to 313.5, 78.4, 78.4 and 156.8, CLIF 197, 123, 123 and 123
  to 283, 70.8, 70.8 and 141.5.
- **Anti-goal: no count cut that is whole today.** G2 moves the thresholds, and at each threshold every column is the
  width it is today.

## Approaches (for G1)

1. **A boundary between the first panel and the call stack, in narrow only.** Picked by Davey: it works as every
   other boundary does, it is set once, and nothing moves on a step.
2. The call stack fits its frames up to a cap, the first panel takes the rest. No drag, but the panels jump whenever
   a frame is pushed or popped.
3. Both: fit by default, a drag overrides. Approach 2's jumps until the first drag.

## The behaviour

- **Narrow**: four regions, the listing, the first panel, the call stack and the heap, with a boundary between each
  two. The call stack's header is the handle of the boundary above it. Its accessible name follows today's scheme:
  "resize values and call stack" in CLIF, "resize registers and call stack" in rxm.
- **Floors in narrow** (Davey's choice, 2026-11-22): the first panel's body and the call stack's keep a floor of two
  rows, where every other machine body, and these two in medium and wide, keeps five. On floors of five rows, in a
  window 692 by 896px, both sat on theirs, 123px each, and the new boundary could not move.
- **Stored shares.** The split between the first panel and the call stack is stored under a name of its own and
  applies in narrow only. A switch to medium or wide gives the row the height the two had together, so the listing
  and the heap keep theirs; a switch back to narrow puts the split back. The listing's and the heap's shares carry
  across switches as the first design's §5.3 says.
- **Closed and maximised** as the first design's §5.2: a closed call stack is its header's height, a maximised panel
  takes the spare height and the others are drawn closed.
- **Focus across a switch.** A focused boundary between the first panel and the call stack that a switch takes off
  the page hands the focus to the call stack's toggle, as the first design's §6.6 hands a removed boundary's focus
  to the heap's toggle.
- **G2's thresholds** (the decision reads the row's gap, so they follow the stylesheet): rxm wide from 880px, medium
  from 584px (were 896 and 592); CLIF wide from 606px, medium from 362px (were 622 and 370). The app's views at a
  1280px window (634px inside) stay CLIF wide and rxm medium, and at 1024px (506px) CLIF medium and rxm narrow.
- **G3, measured**: the drawn text's middle (a `Range`'s box) within half a pixel of the maximise button's middle,
  in Chromium and Firefox, in each view that has a panel count.

## Constraints

- Each change test first, with a sabotage that fires; tests assert geometry, not text; presses are real input.
- The cases and fixtures that name today's thresholds move to the new ones.
- Firefox as the plan's gate has it: `AFFECTED-FF` fails only the three base `panel-boundaries` drag cases.
- By hand in Firefox: a drag of the new boundary in each view, then a switch to medium and back.
- At the end, the first design's §11 and the branch's roadmap entry are brought up to these commits.

## Left to the builder

- How the split is made: the heap's pattern (a region of its own, `hidden` outside the arrangement that uses it, the
  panel moved into it, `machine-row.ts`) is the obvious one.
- The stored share's name, and the keyboard's step, as the other boundaries have it.

## As built

The first design's §11 says where the build of these changes, the 4 commits `af779e2..4a8bd6d`, the review's fixes
`a9b75ad..a01463c` and the floor of two rows, `05eaa28`, leaves that design's sections. Where it differs from this one:

- **By hand in Firefox** was a script, Playwright's Firefox 157.0 with the mouse and the keys on the built app, at
  1600px tall for the new boundary (`~/temp/redextape-panels-row-record/impl2/hand/drive.mjs`), and at `ba09cb8` at
  896px tall too (`~/temp/redextape-panels-row-record/impl2/hand-8/drive.mjs`).
- **G1 in a short window.** In a window 692 by 896px, with nothing stored, the new boundary moves 5.6px from one floor
  of two rows to the other in CLIF and 6.7px in rxm (the pass by hand at `ba09cb8`); the two have more room only once a
  boundary beside them gives it, the listing's above or the heap's below.
