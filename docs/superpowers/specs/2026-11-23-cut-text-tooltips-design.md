# Cut text reads whole in a tooltip — design

**Date:** 2026-11-23. **Lane:** the return-value highlight, PR 1 of 3. **Status:** approved by the user on 2026-11-23.
**Base:** `main` at `798fa38`. **Survey:** `~/temp/redextape-return-value-record/survey-b.md` §1 (read-only, every fact
cited there).

## Intent

On 2026-11-21 the user asked for the program's result to be highlighted in every view at the end of a run, and added:
"we also need to be able to see the entire return value even when it's long. right now a long return value in clif for
example gets truncated and does ...". Asked how a long value should become readable, they chose (2026-11-23) **both**:
every cut value reads whole in a tooltip (this PR), and the run's result shows whole at the end as part of the highlight
(PR 2). The lane's order, proposed to the user and not objected to: PR 1 tooltips, PR 2 the highlight with the result
shown whole, PR 3 list results (their heap cells lit, and a new example whose result is a list).

## Today

The stylesheet cuts text with `text-overflow: ellipsis` in eleven rules. Five already give the whole text another way (a
`title`) or cut by design, and a sixth, `.buffer-row-term`, gives a `title` only where its copy has a term
(`buffer-list.ts:175-178`; survey-b §1's row 4 misses the row with none). These texts have no way to read the cut text
(survey-b §1, rows 5, 6, 9, 10, 11, and that row with no term):

| Rule (`web/src/style.css` at `798fa38`) | What it cuts |
|---|---|
| `.state-cell, .rxm-cell, .clif-cell` (:1834-1840) | a cell of the TM rule table, the rxm listing, the clif listing |
| `.program-text` (:2588-2592) | an instruction's text on a TM state-diagram program row |
| `.machine-panel .panel-name, .machine-panel .panel-note` (:3109-3114) | a machine panel header's name (its count already has a `title`) |
| `.rxm-register dd` (:3185-3190) | one clif value or rxm register word, with clif's register suffix (`span.value-regs`) |
| `.rxm-frame, .rxm-cell-line` (:3209-3214) | one call-stack frame and one heap line, in both views |
| `.buffer-row-term` (:1540-1547), its row with no term (`.is-absent`) | the sentence `no term yet` on a copy's row in the header's copies list |

A long value is cut in the clif values and rxm registers, as fact(12)'s `479001600` is in the clif view (*Intent*).

## Goals

- **G1.** Every text in the table above shows its whole text in a tooltip while the pointer rests on it, in the clif,
  rxm and TM views, on any copy's view and in the header's copies list.
- **G2.** A tooltip shows only on a text that is cut at that moment. A text that fits gets none.
- **G3.** Whether a text is cut is decided when the pointer arrives on it; nothing is measured while the run steps.
- **G4.** The tooltip is the browser's own (the `title` attribute), as on the readout strip's segments
  (`web/src/readout.ts:423`).
- **G5.** A tooltip never shows text other than the element's current text: not a recycled row's old text, not a value
  from a step before.

## Non-goals

- No styled popup, and no tooltip on keyboard focus: the values are not tab stops, and making them so is a larger change.
  A screen reader already reads the whole text (the cut is CSS only). Touch screens get nothing; the user accepted that
  trade-off with their choice.
- No change to widths, wrapping, layout, or what is cut.
- The highlight, the result shown whole at the end, and list results are PRs 2 and 3.
- `.program-count-word` (style.css:2655-2661) stays cut without a tooltip: only the unit word "states" is cut there, by
  design, and its number never is.
- Elements that carry a `title` today keep it unchanged.

## Approaches

- **For the lane** (put to the user 2026-11-23): A, a tooltip on every cut value; B, the result's cell grows at the end
  to show the whole value; C, both. **The user picked C.** This PR is A; B is in PR 2.
- **For the tooltip** (the controller's call, in the design the user approved):
  - *The browser's `title`, set when the pointer arrives, only where the text is cut* — **picked**: it matches the
    readout, costs nothing while stepping, and puts no tooltip on the listing rows that fit, which a pointer crosses
    constantly.
  - *`title` set on every render* — rejected: a tooltip on every row the pointer rests on, cut or not, and a write per
    row per step.
  - *A styled popup that also opens on keyboard focus* — rejected: every value would become a tab stop.

## Decided

- By the user (2026-11-23): option C; the design as written here ("yes").
- The controller's calls, stated in the design message the user approved: the scope is the whole class of cut text with
  no tooltip (listing cells, state-diagram text, panel names), not only values; the cut is decided when the pointer
  arrives.
- By the user (2026-11-23, after the plan was written): a resize under a still pointer is decided again only at the
  pointer's next arrival on a text, as G3 reads, so a text a resize makes whole keeps its tooltip, and one it cuts gets
  none, until then; and a copy's row with no term (`no term yet`) gets the tooltip like any other cut text, so it is in
  *Today*'s table.

## Left to the builder

- Where the code lives: one delegated listener per container or a shared helper each pane calls; and the cut test
  (for example `scrollWidth > clientWidth`).
- A cut element that holds child spans (clif's `.value-regs` suffix): the tooltip is the element's whole visible text.
- How G5 holds where rows are recycled (`VirtualGrid`) or rewritten each step while the pointer rests on one.
- Both engines: the tests run in Chromium and Firefox, and a `title` set on pointer arrival must show in both.

## As built

- **`VirtualGrid` rebuilds its rows; it does not recycle them.** It builds every row and cell anew at each draw, as the
  machine panels build their bodies anew at each `show` and the copies list its rows each time it rebuilds them, and a
  panel's name is written once. So no watched text is rewritten in place, a title leaves with its element, and G5 rests
  on that, not on anything the watcher does. The plan's C4 and C7, in `web/tests/browser/cut-text.test.ts`, read every
  title straight after a step and after a scroll, before the next frame, and fail when the values panel or `VirtualGrid`
  is made to rewrite a text in place (the plan's S6 and S7).
- **G3's "nothing is measured while the run steps" holds with the pointer resting off every watched text** (the plan's
  C8, which spies on an element's scroll, client and offset widths and on an element's or a Range's rects). The watcher
  measures at every arrival the browser reports, and both engines report one at each step on a value the step
  draws anew under a still pointer, whether or not its text changed, as a probe of both machine views built by hand
  found (`~/temp/redextape-return-value-record/pr1/impl/06-probe-arrival-chromium.log` and `-firefox.log`). So with the
  pointer resting on a watched text, a run measures that one text at each step.
- **A text is cut where the ellipsis is drawn**, read at the arrival: its text runs past the end of its content box,
  read by a Range over it to a fraction of a pixel, or its line runs past its box by a whole pixel
  (`scrollWidth > clientWidth`), which counts generated content a Range cannot see. The plan's
  `scrollWidth > clientWidth` alone reads whole pixels, and the review of the whole branch found it missing a text cut
  by up to about a pixel in both engines, not half a pixel as the plan said. The scroll width stays for an accept state,
  whose ` · accept` is generated content: where its ellipsis draws over the end of the name, the Range reads the name
  whole. Held against the pixels each engine draws, the Range missed no cut in either engine, and in Chromium it also
  titles a text past its box by less than 0.02 px, which Chromium draws whole (the roadmap entry's figures).
- **A tooltip reads as its text is drawn**: the element's `textContent`, with a space where one of its elements meets
  another part with none between them, since the stylesheet sets such parts apart. An rxm listing row reads
  `pc0 jmp skip1`, not the plan's `textContent` as it is, `pc0jmp skip1`; so would a clif row whose instruction
  Cranelift prints at its bare indent, in the exact layout, though neither fact's nor fact(12)'s listing has one, so a
  test builds one. Generated content is in no tooltip, a mark's words or an accept state's ` · accept`, so where only
  the ` · accept` is cut, the tooltip repeats a name drawn whole.
