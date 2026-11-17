# State diagram tidy — short design

Every SHA below is a commit's SHA before the rebase onto `7085aa2`: what was run, measured, reviewed or tried
on it was measured before the rebase, on `486df8d`, and `rebase2/sha-map.txt` in the lane's record,
`~/temp/redextape-state-diagram-tidy-record/`, maps each to its SHA after it.

## Intent

Davey, 2026-11-06: "fix the visuals for the state diagram", with a screenshot of the TM view's state diagram at the
`local` level. It reproduces with the `is_even(6)` example under the binary encoding at step 276, state
`bpf31.l2.r1.rw0`, in an 844×324 panel. Five boxes sit in one row at the top. Four of them read `bpf31.l2.r1…`
because the CSS ellipsis cuts the end of the name, and the end is the part that differs (`…r1.rw2`, `…r1.home`).
Each self-loop's arc runs through its own label (`REG:0 L, REG:1 L`). The short edges between boxes are crowded with
labels, and the rest of the panel is empty.

## Decisions

Davey's (2026-11-16), all four, at the `local` level only (the program level's *arcs* and *chips* are out of scope):

1. **Identical names:** cut the middle of a name, not its end, so the part that differs shows. Boxes are sized to
   their measured names, up to a cap. The full name stays available.
2. **Loops strike labels:** each self-loop's label sits clear of its loop.
3. **Crowded edge labels:** one rule per line instead of a `, `-joined line, and the gap between columns widens to
   fit the longest label.
4. **Empty space below:** a diagram shorter than its panel is centred vertically, and it still scrolls when it is
   taller. A change of the panel's height centres it again.

Davey's (2026-11-16, after the width measurement under *The width* below), **stack tapes and fall back**:

5. **One tape per line:** a rule that touches several tapes is written a tape a line (`REG:0 R` over `WORK:0/0 R`),
   so a gap needs only its widest tape's line.
6. **Fall back to one rule each way:** a level still wider than its panel at two rules each way is drawn at one
   (±1 state), decided against the panel's actual width and decided again when that changes. A reader can tell a
   fallen-back level shows fewer states, with little visual noise: existing chrome or a title rather than a new
   glyph or a drawn mark. *Replaced on 2026-11-17 by decision 10, Davey's.*

The controller's rulings on review 1 (2026-11-16), each applied below where it lands:

- **The scroll bar loop (I1):** the level must not lay itself out again every frame as a classic vertical scroll bar
  comes and goes; `scrollbar-gutter: stable`, or a better fix, with a test under real scroll bars.
- **Labels of different edges (I2):** visibly apart, with more space between two edges' labels than between one
  edge's own rules.
- **The rest (M1-M7):** labels kept inside the drawing; no label on another edge's line; text measured again when a
  web font loads and when the style or palette changes; names whose cuts clash lengthened only until they differ,
  still capped where possible; a fallback that hides no state says nothing of a narrow panel (*gone with decision
  10*); no history in comments.
- **Assistive technology:** a fallen-back level's group name carries the reason too. Whether to add anything a
  sighted reader sees was left to Davey: decision 8. *Gone with decision 10.*

Davey's (2026-11-16, after review 1's fixes, on `is_even(6)` at step 11,827 in the 844 px panel, where four `*`
labels of a fan into `bdt35.n0` stood in one column and so did the three of a fan out of `bdt35.q1.e0`):

7. **Fan labels by their own lines:** each sloping edge's label sits beside its own line, so a reader can tell
   which line each belongs to. The measure is my reading of it: a label's nearest edge, by distance from its box to
   each edge's drawn path, is its own. The placement is my call (below). Edges along a row may keep their place.

Davey's (2026-11-16, after review 1's fixes, on the cue for a fallen-back level and on the scroll bar's room):

8. **A tooltip is the only cue** that a level fell back: the level's `title` (under *Telling a reader it fell back*
   below) is enough, and nothing is drawn. *Replaced with decision 6 by decision 10: no level falls back, so
   there is nothing to tell.*

9. **Keep the scroll bar's room** (option A): `.local-level` keeps `scrollbar-gutter: stable`, chosen over laying the
   level out at the panel's full width (option B as the controller put it to Davey, in the record dir's
   `controller-question-scroll-room.txt`), the alternative under *The fallback's width* below. The controller
   recommended A. *Overtaken on 2026-11-17 by decision 11: the level draws no scroll bar, so there is no bar's room
   to keep, and the level is laid out at its full width (under* Like a map *below).*

Davey's (2026-11-17, after trying the branch), **crop and drag**, which replaces decision 6 and with it decision 8.
He found it "looks decent", but "I can't freely drag the diagram around, which it feels like you should be able to",
and "making the panel narrower just alters the diagram by combining states which doesn't really seem exactly right".
Offered crop and drag, shrink to fit with drag and zoom, or the fallback kept with drag added, he chose crop and drag
with these four points, which he saw and accepted:

10. **Crop and drag.** (1) Never drop to one rule: a narrow panel cuts off the edges of the diagram without changing
    what is in it. (2) Drag the background to move the diagram in any direction, the cursor an open hand and a closed
    one as over the panel divider; a click on a state still jumps to it, because a drag only starts once the pointer
    has moved a few pixels; touch keeps its normal scrolling. (3) Stepping to a new state centres the diagram on it;
    while the run stays on the same state, the dragged position stays put. (4) The program level is unchanged.

The controller's, 2026-11-17, with decision 10: a drag starts past about 4 px; it pans `scrollLeft` and `scrollTop`
with pointer capture, from a press on the background or on a node; mouse only (`pointerType === 'mouse'`), so a pen
and a finger keep native scrolling; the open hand only while the level is larger than its panel on either axis, the
default pointer when there is nothing to pan, no grip marks, and `data-dragging` as `.panel-boundary` has it; a press
that panned neither links nor moves the roving focus, and selects no text; and `scrollbar-gutter` and the
`browser-scrollbars` test stay unless a test shows the loop cannot occur. *The open hand's condition and
`scrollbar-gutter` are replaced by decision 11.*

Davey's (2026-11-17, after trying `d1e14a6`): "am I supposed to drag the state diagram? I can't move it around at
all". As built, a level its panel fits ignored presses, and at an ordinary width most levels fit; his first ask had
been "I can't freely drag the diagram around, which it feels like you should be able to".

11. **Always draggable, like a map:** a drag always moves the diagram, the controller's answer to his words above.
    After trying it at `5c17348`, he said "dragging works".

The controller's design for decision 11, 2026-11-17: (1) a drag on the local level moves it both ways whether or not
it is larger than its panel, with the open hand over the whole level and the closed one while it moves; (2) it cannot
be lost: it moves until any point of it reaches the panel's middle and no further, by keeping `.local-level` a scroll
container with half the panel's width and height of room on every side of the drawing and its scroll bars hidden;
(3) a new current state centres it, and so does a resize, a font load or a skin change with no drag since the last
centring (review 4's I1), while after a drag a redraw around the same state keeps the user's offset, held to (2);
(4) a click and a drag as before, and a pen and a finger scroll natively, which the room now gives a level that fits
too; (5) review 4's five Minor findings fixed, M1 as no ring for a focus a pointer gives and M2 as a click on the
level's background taking the focus into the level with no ring (all five under *Like a map* below).

Davey's (2026-11-17), asked about the wheel after review 5 found that in Firefox the wheel over a level moved the
diagram and no longer scrolled the TM view: "I think scrolling over the diagram should actually zoom it if possible".

12. **The wheel zooms the diagram.**

The controller's design for decision 12, 2026-11-17: (1) the wheel over the local level zooms the drawing about the
pointer, so the point under the pointer stays where it is; Ctrl and the wheel, and a trackpad's pinch, which browsers
send as that, do the same, and the browser's own page zoom does not happen over the diagram; a wheel notch zooms by
about ×1.1, scaled by the event's delta so a trackpad is smooth; the wheel over the diagram no longer scrolls the TM
view, and elsewhere scrolls it as before; (2) the range runs from the scale at which the whole level fits its panel,
or 50% if that is smaller, never below 5%, up to 300%, and the drawing is scaled, not a bitmap of it; (3) the zoom stays
as the run steps and as the panel resizes, and a new current state is centred at it; a double-click on the
background goes back to 100% and centres; with the diagram focused, `+` (and `=`) zoom in, `-` out and `0` goes back,
about the panel's middle; no zoom indicator; (4) a drag works at any zoom, with its clamp in zoomed terms; (5) phones
unchanged, recorded as not closed; (6) review 5's fixes: I1, nothing re-placed during a drag, a state that came
during it centred by the first draw after the release; M1, `tabIndex = -1` on the level; M3, the font-listener test
collects in Firefox and the label tests measure a loop's stroke; M4, a backward edge's label inside the drawing; M5,
the PR draft.

## My calls

- **The cut.** A name that fits the cap is shown whole. Otherwise its first dotted segment is kept, then `…`, then
  as many whole trailing segments as fit: `bpf31.l2.r1.rw2` becomes `bpf31…r1.rw2`. The compiler builds names from
  the outside in (`bpf31` is the gadget, `rw2` the step within it), so the first segment says where a state belongs
  and the last ones say which state it is. A name whose `first…last` still does not fit is cut by characters,
  keeping two thirds of what fits from its end. If two different names on the level would still show the same text,
  each of them is cut again with a character more room, and again, until they read differently (more trailing
  segments, then more characters), and only a pair that differs where no cut keeps it is shown whole: a reader
  telling states apart is the point of the fix, and the cap still holds for every name that does not clash (the
  controller's ruling on M4). `bcons103.lh.r1.home` and `…r2.home` show as `bcons103…r1.home` and `…r2.home`, not
  whole.
- **The cap: 14 characters of the node's font** (the width of fourteen `0`s, so it follows the font a style
  chooses). Across the seven examples the median name is 13 to 15 characters, and at 14 the screenshot's level
  (`bpf31…r1.rw2` three times, `bpf31…r1.home`, `bpf31…r2.home`) is 756 px wide in the browser, which fits the
  844 px panel. A smaller cap does not narrow it: at 12, `bpf31…r1.home` and `bpf31…r2.home` would both cut to
  `bpf31…home`, and both would be shown whole.
- **Measuring: canvas `measureText`** in the font the node computes (family, size and the current node's weight,
  600, for every node, so a node that becomes current still fits). It does not lay out the page, which a hidden
  span would, once per candidate cut. The label font's ascent and descent come from the same call, and they are what
  an SVG `<text>` box spans, so label boxes are known before anything is drawn. A monospaced fallback need not share
  Hack's advance (Cascadia Code's is 1200/2048 em against Hack's 1233), so the level is measured again when a web
  font finishes loading (`document.fonts`' `loadingdone`) and when the style or palette is picked (`data-style` and
  `style` on `<html>`), and laid out again only if a few sample texts measure differently (the controller's ruling
  on M3). The CSS end-ellipsis stays as a safety net.
- **The width.** Each column is as wide as its widest box or self-loop label, and each gap as wide as the widest
  label of an edge leaving the column before it, plus a margin on each side. That natural width replaces the fixed
  750 px floor: below it the level scrolls sideways, and above it the spare width is shared evenly by the gaps, so
  the level still spans its panel as `floor(width / 5)` made it do. One width for every column and gap would keep
  the grid regular and the current state exactly in the middle, but measured over all 24,428 levels of the seven
  examples (every state, binary, Hack's widths) it makes the median level 854 px wide and 52% of levels wider than
  the 844 px panel; sized to their contents the median is 805 px and 37.5% are wider. No layout that fits its
  labels stays under the old 750 px: multi-tape rules such as `REG:0 R WORK:0/0 R` are about 108 px each. That
  37.5% is what decisions 5 and 6 answer.
- **Where a stacked rule ends.** A tape a line makes `REG:0 R`, `WORK:0/0 R`, `REG:1 R`, `WORK:1/1 R` four lines
  for two rules, so in a label where any rule takes more than one line, every rule is set 4 px below the one
  before it, a little over a third of a line. A blank of that size groups the lines into rules with no glyph; a
  label whose rules are a line each keeps the even spacing it had, since there a line is a rule.
- **Historical: the fallback.** The next four entries (*The fallback's width*, the two *Measured* entries after it
  and *Telling a reader it fell back*) describe the branch before decision 10, and so do the fallback counts in
  later entries (7.8% of levels at 844 px and the like). What still holds of them is under *Crop and drag* below.
- **The fallback's width, and the scroll bar's room.** The level's height depends on the width it is laid out
  for, through both the reach and where labels sit on sloping lines, so that width must not be one a vertical
  scroll bar takes or gives back: a level that overflowed at one width and fitted at a scroll bar's width less
  would gain the bar, lay out narrower, lose it, and lay out wider, every frame (review 1's I1, 60 layouts a second
  at `is_even(6)` step 11,827). `.local-level` has `scrollbar-gutter: stable`, option A, which the controller
  recommended and Davey chose (decision 9), so a classic scroll bar's room is kept whether the bar shows or not, and
  the level decides between two rules and one, and spreads, over that one width (`clientWidth`). Its resize observer
  watches the border box, which a scroll bar inside it does not change, so a bar that a layout brings is not
  reported as a resize in the frame that laid it out. A level still wider than its panel at one rule scrolls
  sideways, as before.
  The cost is the room itself, where scroll bars take width (Chrome on Linux and Windows by default; macOS and
  phones overlay theirs): an 844 px panel lays its level out over 829 px, so more levels fall back (below). The
  alternative I weighed and did not build: lay the rows and labels out at the natural width and only move them
  sideways to spread, so the height cannot depend on the spread, and decide against the width with the bar's room
  included. It keeps the 15 px, but a spread line can then pass through a label laid out for the narrower one, and
  a level whose two rules need between 829 and 844 px would scroll sideways while its vertical bar shows.
- **Measured on the final code** (`5ae93be`), over the same 24,428 levels with the same Hack widths
  (`node --experimental-strip-types final.mts 844` in the lane's record dir, against `local-level.ts` and a copy
  of `local-layout.ts`): with tapes stacked, 8.8% of levels are wider than an 844 px panel at two rules each way
  (median 790 px, 95th percentile 856 px, widest 953 px; at most 8 lines in one label). Those 2,146 levels fall
  back, hiding 2.01 states on average (median 2, at most 4), and none of them is wider than 844 px at one rule.
  The screenshot's level has no rule that touches two tapes, so it keeps two rules each way and its layout.
- **Measured again after review 1's fixes** (`local-layout.ts` at `f85349c`; `node --experimental-strip-types
  final2.mts 844`, and `829`, in the record dir's `fix1/`, Hack's widths, every state of the seven examples under
  binary, 24,428 levels). Spread over 844 px, as with an overlay scroll bar: 1,911 levels (7.8%) fall back, each
  hiding states (2.02 on average, at most 4); none falls back hiding nothing; none is wider than its panel. Spread
  over 829 px, an 844 px panel less a classic scroll bar's kept room: 4,576 (18.7%) fall back, none wider. In both,
  0 levels have two edges' labels closer than `LABEL_GAP` (review 1 counted 819, 3.4%, under 3 px apart), 0 have
  another edge's line through a label, self-loop arcs not counted (449, 1.8%), and 0 have a label outside the
  drawing. Names lengthened past the cap to tell clashing cuts apart appear in 506 levels (2.1%), where review 1
  showed them whole.
- **Telling a reader it fell back.** The level's group, whose `aria-label` already said `states within 2 rules`,
  says `states within 1 rule each way: the panel is too narrow for 2`, which a screen reader says as focus enters
  it (the controller's call), and the level's own box takes the same `title`, which a pointer anywhere on the
  level's empty space shows. Nothing is drawn (decision 8), so a level that fits looks exactly as it did; the three
  columns in place of five are the visible difference, and the title is the explanation for a reader who wonders. A
  level at two rules has no title, so hovering an ordinary level shows nothing new. Nor does a level that falls back
  with nothing two rules away, which only drops two empty columns: it shows every state two rules away, so it says
  what a level at two rules says (the controller's ruling on M6).
- **Placing labels.** A self-loop keeps today's arc, out of the box's right edge and into its top, and its label,
  set as decisions 3 and 5 say, sits above the arc's peak, right-aligned to the box and kept inside its column.
  A backward edge (or one along a column) still curves under the boxes, its label under the curve's lowest point;
  backward edges from one row whose spans overlap take successively deeper lanes, narrowest nearest, so neither
  curves nor labels share a lane, and its centre is kept inside the drawing, so an edge along an outer column cannot
  hang its label past the drawing's edge (M1). An edge along a row keeps its label centred in the gap after its
  source's column, over its line. Each row's height is what its loops, labels and lanes need.
- **A sloping edge's label by its own line** (decision 7, my design). Forward edges out of one node all leave from
  one point, and those into one node all arrive at one, so by a shared end a label is as near the other lines as its
  own. A sloping edge's label therefore goes by the end where its line is apart from the others: by its source
  unless other forward edges leave from there too, then by its target unless others arrive there too, and by its
  middle where both ends are shared. By an end it is set in from it by `LABEL_MARGIN` (left-aligned by the source,
  right-aligned by the target), `LINE_CLEAR` from the line under its whole width, on the side the line turns away
  from (under a line that rises from its source, over one that falls; by the target, the reverse), so the line runs
  off from the label rather than through it. A row is made tall enough above or below its boxes for the labels set
  by its lines' ends, as it already was for the labels over its lines along it, and a gap is widened for the labels
  set in it (by a target, the gap before the target's column).
- **Every label takes the cheapest place that is clear and nearest its own line.** Each label has places, best
  first: a sloping edge's best is the one by its end described above, the other side of its line there costs
  `OTHER_SIDE` (8 px), and
  the other end, the middle and the two quarter points cost `FAR_PLACE` (16 px) more (an edge along a row: over
  its middle, under it, then the rest); a self-loop's and a backward edge's best is today's, and a backward edge
  may also go under either end of its curve's bottom. From each place a label may move away from its line in 2 px
  steps up to `SEARCH` (24 px), each pixel a pixel of cost. A place is taken only if it is clear of the nodes, the
  self-loops' arcs, the other edges' lines, the labels already placed (by `LABEL_GAP`) and the drawing's sides, and
  if every other edge's line is at least `NEARER` (1 px) further from it than its own line is, measured from the
  label's box and again from its middle: from the box alone, a label in the angle between two lines from one point
  touches its own line at a corner while it lies along the other. A pixel is the least that holds the nearest line
  when the page measures text a fraction differently from the canvas; more fails good places, such as a label over
  its line beside a self-loop that reaches 4 px from its corner. A label with no such place takes the clear place
  where it is least behind, and with no clear place within `SEARCH`, it moves from its best until it is clear, as
  before. Labels are placed self-loops first (tied to their node), then those over lines along rows (the most of any
  level, in the places their rows were made tall for), then backward edges', then sloping edges', whose best places
  no other label takes. Two edges along one row whose columns overlap are drawn on one line (an edge across a column
  runs straight through it), so for those two neither is nearer; such a tie is allowed, and counted below. The cost
  of the search (`node --experimental-strip-types t.mts ll-before.ts ll-final.ts` in `fix2/`, five layouts each,
  Hack's widths): the `overflow` level of `fact-12`, whose labels move in 2 px steps across thousands of pixels as
  they did at `6b5c999`, 334 ms a layout against 246 ms; a fan of fourteen edges into one node (state `pc20`'s level
  in `fact-12`) 29 ms against 3.5 ms.
- **Measured** (`node --experimental-strip-types final3.mts ll-X.ts 844`, and `829`, in the record dir's `fix2/`,
  Hack's widths, every state of the seven examples under binary, 24,428 levels, 152,242 labels at 844 px and 144,990
  at 829 px): labels whose nearest edge is not their own at 844 px, at `6b5c999`: 1,810 (1.19%), in 1,016 levels
  (4.16%), 1,489 of the 1,952 labels of sloping edges among them; after: 275 (0.18%), in 136 levels (0.56%), 175 of
  them on sloping edges. 103 of the 275 are in three of the seven levels of the states named `overflow` (one per
  example), where up to 65 edges converge (in `fact-12`'s, `fin/overflow-measure-844.log`) and cross every gap, in
  `fact-12`'s from rows thousands of pixels apart. The rest are of four
  kinds, all where lines cross a gap too narrow or rows too close for any place: wide fans of steep lines (fourteen
  into one node), three-way fans whose rows are 32 px apart (`bmul17`'s `need`), an edge along a column drawn
  through a box (its self-loop's label, 70 as at `6b5c999`), and lines whose both ends are shared. 296 labels tie,
  all on edges drawn over one another along a row. Labels of edges along rows not over their line's middle: 0.09%
  (0.19% at `6b5c999`). Everything else is as before: 7.8% of levels fall back at 844 px, none is wider than its
  panel, and none has a label within `LABEL_GAP` of another, another edge's line (self-loop arcs not counted) or a
  node through a label, or a label outside the drawing.
- **More places for the labels review 2 found nearer another line** (my calls, on review 2's I1 and I2; the
  controller's brief asked for 0 such labels in the examples' levels outside `overflow`, not counting a label whose
  text is the same as its nearest line's). Four shapes had no place that qualified, and each now has one:
  - *A line along a row between two from its source that rise and fall to other rows* (`bmul17`'s `need`, review 2's
    I1): those two lines cross every place by its source and middle, on both sides. Its label goes over it by its
    target, `HUG` (4 px) from the target's box rather than `LABEL_MARGIN`, which keeps labels clear of a self-loop
    reaching past a source's box (no loop reaches past a box's left side). Its row is set far enough under the
    rising line's row that the rising line has left the label's band by then, `NEARER` and a pixel further from the
    label than its own line, from its box and from its middle; past `MOST_APART` (96 px here; 120 px since *The fan
    labels the old sweep never saw*, below) the label falls back. At
    844 px (`draw.mts` in `fix4/`) `fact(12)`'s level in `bmul17.s31.up31` is 131 px tall instead of 130, and
    `fact`'s in `bmul17.s7.up7`, whose whole names leave a 72 px gap, 159 instead of 122: the rise needed grows fast
    as the gap narrows, and widening the gap instead would make those levels wider than their panel. Every line along a row also has the places up against its target on either
    side, which `sum_to`'s `bsub15.rp.neg` takes at 829 px, away from its source's loop.
  - *A self-loop under a line up its column* (`hs.dc.n` in `closure` and `map-fold`, review 2's I2): a backward edge
    rises at either end from under its lowest row to its end's box, through the place over the arc of each node of
    that column below. The label may move right along its arc as far as its column reaches, and the column is made
    wide enough for it to sit `ASIDE` (5 px) right of the line, more than it stands over its own arc. No loop label in
    the examples is now more than 28 px from its arc, `overflow` included.
  - *A line climbing a row between others* (`bmul17.pN.c1 → c0`, `bsub`/`bcmp` `d1 → d0`, and the steep pair out of
    `bmul17…need` when it is current): places beside the line, either side, level with its middle and an eighth of
    its length either way, costing `SIDE_PLACE` (48 px), so they are taken only where every place over and under it
    is crossed or nearer another line.
  - The last resort (move from the best place until clear) is unchanged here, and review 3 replaced it (below). It
    is no longer reached by any loop label in the examples. Bounding it was the review's other suggestion; I did
    not, as nothing reaches it to test against.
- **Measured** (`node --experimental-strip-types mis5.mts ll-X.ts 844`, and `829`, in the record dir's `fix4/`,
  Hack's widths, the same 24,428 levels): labels nearer another edge's line whose text differs from that line's,
  outside the seven `overflow` levels, at `3592f88`: 131 at 844 px (52 in the `need` fans, 48 `hs.dc.n` loops, 22
  `bmul17.pN.c1 → c0`, 9 `bsub`/`bcmp` `d1 → d0`) and 165 at 829 px; after: 0 at both. All labels nearer another
  line: 275 to 155 at 844 px, 114 of them in `overflow`. `mis3.mts` at 844 px: 7.82% of levels fall back as before,
  heights p50 75 and p95 130 as before, and none has a label within `LABEL_GAP` of another, another edge's line
  (self-loop arcs not counted) or a node through a label, or a label outside the drawing.
- **The cost of the search** (my calls on review 2's M1). Each edge's line is cut into points once, not once per
  place, and a level weighs at most `WEIGHED_PLACES` (2,000) places for its labels, after which the rest go straight
  to the last resort: a few dozen edges weigh a few hundred, and `overflow`'s 229 edges, almost none of whose labels
  has a place nearer its own line, would otherwise take most of a second. No layout cache, which the review did not
  need. `node --experimental-strip-types dist.mts 844 ./ll-head.ts ./ll-e.ts` in `fix4/` (each level best of 3,
  interleaved, load average around 18): `3592f88` p50 0.33 ms, p99 0.97, max 307 (fact-12 `overflow`); after p50
  0.28, p99 0.92, max 173. The same four levels take over 16.7 ms before and after: fact-12's `overflow` (307 to
  173 ms), fact's `overflow` (26 to 37), fact-12's `bdt25.n0` (27 to 36) and `pc20` (25 to 20).
- **The last resort, the cap and the width's rounding** (my calls on review 3's I1, M1 and M2; measured with Hack's
  widths over the same 24,428 levels, scripts in the record dir's `fix5/`, each run there as
  `node --experimental-strip-types <script> <args>`).
  - *One pass, not a step at a time* (I1). Moving a label until it is clear walked 2 px at a time and checked every
    box at each step: review 3's 30-way fan (`patho.mts 30`) took 2.0 to 5.8 s a layout. `firstClear` finds the
    same step in one pass: each box across the label's way blocks one run of steps, found with `meets` itself, and
    the runs sorted by their start are walked to the first gap. Alone it changes nothing drawn
    (`same.mts ll-head.ts ll-i1.ts 844`, and `829`: 0 of 24,428 levels differ; the fan's layouts hash the same) and
    the fan takes 57 to 114 ms (`fix5/patho-i1.log`).
  - *The cap* (M1). A label's best place is now weighed over `SEARCH` however many places the level has weighed, and
    only the rest count against `WEIGHED_PLACES`, as the controller asked. Measured, that leaves `fact(12)`'s `pc20`
    and `bdt25.n0` as they were: their labels have no clear place within `SEARCH` of their best, and with no cap at
    all `pc20` still sent six of them 420.7 to 617.5 px down past the fan. So the last resort changed too: every
    place, not only the best, moves the way its search moves it (sideways beside a climbing line, up or down
    elsewhere) until it is clear, and the label takes the one that moved least and is inside the drawing, the cheaper
    place on a tie. The farthest `*` label from its own line (`own.mts ll-X.ts 844 fact-12.rxt:pc20
    fact-12.rxt:bdt25.n0`, and `829`): `pc20` 617.5 to 44.3 px at 844 and 619.0 to 42.5 at 829; `bdt25.n0` 1,003.7 to
    26.1 and 1,003.3 to 26.1. `fact(12)`'s `overflow`: 6,025 to 41.7 px, and 7,421 to 6,522 px tall. The fan's layout
    costs more, 204 to 244 ms (`fix5/patho-fix5.log`), a pass for each of a label's places, and it still draws 110k
    to 155k px tall: its labels have nowhere clear near any place, and hiding a label rather than moving it far stays
    Davey's question, as review 3 put it. Sabotaged to count the best place again (the accounting alone), the node
    tests still pass: with the new last resort, it moves one label in the examples (`map-fold`'s `overflow`, 4 px).
    Without the new last resort the fan test fails.
  - *Rounding the width* (M2). A self-loop's room past a line up its column left ten `hs.dc.r.home` levels 829.3 px
    wide, which `Math.ceil` made 830, so at 829 px they fell back. The width is now the nearest whole pixel, and up
    to half a pixel comes off the gaps, each of which keeps `LABEL_MARGIN` either side of its widest label.
    `fbdiff.mts ll-head.ts ll-fix5b.ts 829`: those ten now keep two rules and none newly falls back; against
    `3592f88` no level's reach differs at 829 or 844 px. Fallback at 829 px 4,586 (18.77%) to 4,576 (18.73%); at
    844 px 1,911 (7.82%) as before.
  - *Measured on review 3's fixes* (`mis5.mts ./ll-fix5b.ts 844`, `mis3.mts ./ll-fix5b.ts 844`, and both at `829`):
    labels nearer another line whose text differs, outside `overflow`, 0 at both widths; all labels nearer another
    line 155 to 144 at 844 px and 147 to 143 at 829; loop labels over 28 px from their arc 0; no label within
    `LABEL_GAP` of another, no other edge's line (self-loop arcs not counted) or node through a label, none outside
    the drawing and no level wider than its panel, at both widths; heights p50 75 and p95 130, the tallest 6,522 px
    (7,421 before, at 844 px).
- **One pair of font and style listeners for the page** (review 2's M3): a module flag, not the set of diagrams being
  empty, says they are in place, so a diagram made after every other was collected adds no second pair.
- **Centring in CSS.** The nodes and edges sit in one box that is a flex item with `margin-block: auto` in the
  scrolling level. Auto margins centre it while it is shorter than the level and fall to zero when it is taller, so
  it scrolls from its top, and any height change centres it again with no observer.
- **The full name** is the node's `title`, as today, and its `aria-label`, so a reader that is read the node hears
  the name it heard before rather than the cut.

- **Crop and drag** (decision 10; my calls, 2026-11-17, each with its reason). Decision 11 replaced three of them:
  the scroll bar's room, a level that fits leaving presses alone, and the centring that kept a raw scroll through a
  redraw (*Like a map* below).
  - *The fallback goes with all it brought*: `fitLocal`, `FALLBACK_REACH`, `localLevel`'s reach parameter and
    `Local`'s `reach`, and the reason in the group's name and the level's `title`. The group is named
    `states within 2 rules` at all widths, as on `main`. A level wider than its panel is laid out at its own width
    and scrolls; one narrower still spreads over its panel.
  - *The scroll bar's room is kept.* The spread still sets where labels sit on sloping lines, and so the rows'
    heights: the `browser-scrollbars` fixture's level stands 324.3 px tall spread over 319 px, 322.4 px over 324 px
    and 309.2 px over 358 px (the record dir's `pan/scrollbars-2.log`), so a bar's width can still change the height.
    The scroll-bar test's scan now starts at the level's own width instead of around the fallback's threshold; its
    test of the fallback against the bar is gone.
  - *A press on a level that can pan has its default prevented*, which stops its `mousedown`: no text selected and
    no focus moved by a press that may become a pan. A click then focuses its node itself, as the `mousedown` did.
    A level that fits leaves presses alone, so there a press is the plain click it was.
  - *The moves and the release are heard on the document* while a press is down: before the threshold nothing is
    captured, and a move that leaves the level in one step would otherwise not pan.
  - *The pointer is captured when the drag passes the threshold, not at the press.* Captured, the release's click goes
    to the level rather than to the node under the pointer, which a pan keeps under it, so a pan links nothing with
    no flag to swallow its click; captured from the press, a plain click would not reach its node either.
  - *A node keeps its own pointer at rest*, since a click on it links; the background shows the open hand, and while
    a drag lasts the level and its nodes show the closed one.
  - *Centring.* The current node's box is read against the level's (`getBoundingClientRect`) and the scroll moved by
    the difference both ways, which the browser clamps; once per new state, not per frame. The level is also centred
    when it is shown afresh: switched to from the program level, a recompile, drawn again after its panel was closed,
    or a machine emptied and run again, since a dragged position belongs to a view the user left. A layout around
    the same state gives the focus back to its node without scrolling, so the focus does not undo a kept scroll.
  - *The keyboard* still scrolls a node an arrow moves the focus to into view; a test holds it.
  - *Not tested: text selection.* The nodes' layer lies over the labels, so a press never lands on a label's text;
    the press's prevented default is tested through the focus it no longer moves.

- **Like a map** (decision 11, on the controller's design; my calls, 2026-11-17, each with its reason).
  - *The room is CSS.* `.local-content`'s margins are `50cqh 50cqw` of `.local-level`, which is a size container
    (`container-type: size`). The room follows the panel's size with no script, and the scroll's range stays the
    drawing's own width and height, so a resize leaves the drawing where it was against the panel's middle until it
    is placed again. A size container's content cannot size it, which the level never needed: its panel sizes it.
  - *A centring keeps the clamp it had.* The current node goes to the panel's middle only as far as the drawing
    still covers the panel, and a drawing smaller than its panel is centred whole, as before decision 11. Centring
    on the node alone would shift a level its panel fits off to one side whenever its current state is not at its
    middle (the spread fills the width, and the columns either side of the current state seldom match), and cut off
    what used to show. The room is for the user's drag; a test holds the screenshot's level whole at 844 px.
  - *Moved by the user means scrolled since the last centring.* The level keeps the scroll its last centring left,
    and a scroll anywhere else is the user's: a drag, the wheel, a finger, or a focused node brought into view. A
    redraw around the same state then keeps the current node's offset from the panel's middle (review 4's
    suggestion), which the browser holds to the scroll's range; with no such scroll it centres again. A change of
    height alone places the level too, so a level nobody moved stays centred.
  - *No scroll bar, and no `scrollbar-gutter`.* `scrollbar-width: none` and `::-webkit-scrollbar`. Under classic
    scroll bars (`browser-scrollbars`) the level's `offsetWidth` equals its `clientWidth`, and its `offsetHeight`
    its `clientHeight`, where it is larger than its panel both ways (a new test; it fails with the two rules
    removed). Put back beside `scrollbar-width: none`, `scrollbar-gutter: stable` keeps no room: the three
    scroll-bar tests pass with it (the record dir's `map/sab/e1-gutter-back.log`), so it went. With the bars shown
    again and no gutter, only the no-bar test fails and the loop test passes (`map/sab/s6-bars.log`): the border-box
    observer alone stops the loop. The loop test stays and passes; its last check, that the level fits the panel the
    scan chose, is dropped: that held because the bar's room was kept, and the level now spreads over the panel's
    whole width and stands 2 px taller than that panel (325 px in 323), which it overflows with no bar and no
    second layout.
  - *The open hand over every drawn level*: `data-pans` is set by each layout and cleared when the level empties; a
    node keeps its `pointer`. I read "the cursor is `grab` over the whole level" as at any size, not over the nodes
    too: a click on a node links, which is what its pointer says.
  - *Review 4's M1*, the controller's fix (decision 11's (5)): a click focuses its node with `focusVisible: false`,
    so a click draws no ring wherever the keyboard was last used; a key on a focused node calls `focus()` on the
    element that has it, which changes nothing, so the keyboard keeps its ring.
  - *M2*, the controller's fix (decision 11's (5)), whose target is my call: a press that did not pan and was not on
    a node, released, focuses the level's tab stop (the node holding the roving `tabindex`, or `.local-nodes` with
    none) with no ring and no scroll, as the press's own focus would have reached the level. The tab stop rather
    than the group, since the arrows move from a node and do nothing from the group. A press that panned still
    moves no focus.
  - *M4*: the gaps past the outermost columns that hold a state are taken in first, in a panel too narrow for the
    level with them, and spread over as before in one wider, so a level at an ordinary width is laid out as before
    and its current state's column stays where it stood. Laying out only the occupied columns would also have moved
    a start state with nothing before it to the left edge at every width.
  - *M5*: an emptied level zeroes its drawing's size and its SVG's, and clears `data-pans`, so a press on it does
    nothing and its pointer is the default. The SVG's size was found by the new test: its old width alone kept a
    scroll range of half a panel.
  - *`state-diagram-local-layout.test.ts` joins `CAPTURE_FILES`*, since its drag of the screenshot's level takes a
    pointer capture; in Firefox it now runs in `firefox-capture`.

- **The wheel zooms** (decision 12, on the controller's design; my calls, 2026-11-17, each with its reason).
  - *A transform, not a layout at another size, CSS `zoom` or a `viewBox`.* `.local-drawing` holds the edges and the
    nodes at the size they were laid out at and is scaled from its top left corner (`transform: scale(z)`), and
    `.local-content`, the box the room is around, takes the scaled size. The scroll's range is then the drawing as
    shown, so decision 11's clamp holds at any zoom with no code of its own. A layout at the zoomed size would not
    be a zoom: the spread, the cuts and the label places all follow the size, so the drawing would rearrange rather
    than grow, and the point under the pointer could not stay. CSS `zoom` sets text at a scaled font size, which is
    not in proportion to the box it was cut for, so a cut name could outgrow its box and show the ellipsis; a
    transform scales boxes, lines and text as one. A `viewBox` reaches only the SVG, and the nodes are HTML buttons.
    Neither engine is told the transform will change (`will-change`), so each draws the drawing afresh at its
    scale. Text and lines are sharp in the screenshots at 200%, which are Chromium's; Firefox and 300% were not shot.
  - *The rate.* A notch is 100 px of a delta in pixels, 3 lines or a page, and zooms by 1.1 to the power of the
    notches, so a trackpad's small deltas zoom smoothly; a key press is a notch. The delta is `deltaY`, or `deltaX`
    where that is all there is (Shift and the wheel), read before `deltaMode`, for which Firefox then reports pixels.
    A pinch comes as Ctrl and the wheel and zooms at the same rate; how far a real pinch or notch zooms was not
    measured, as no trackpad or mouse was tried. Review 6 (M5) worked out a figure: by Chromium's convention a pinch
    that scales the fingers' spread by `s` arrives as Ctrl and the wheel with `deltaY = −100·ln(s)`, and a page is
    expected to zoom by `exp(−deltaY/100)` (Chromium review 250923004, and its PDF viewer's `gesture_detector.ts`), so
    the level zooms by `s^0.095`: a pinch that doubles the spread zooms it ×1.07. That is computed, not measured on
    a trackpad. The rate is left as it is, as the user judged the zoom by feel ("yes zoom works well"). If a pinch
    proves slow, a rate of its own for Ctrl would make Ctrl and a mouse's wheel jump instead (×2.7 for a 100 px
    Chromium notch); that is the user's choice to make, and an open item.
  - *An end already passed.* The floor is worked out at each zoom from the panel and the laid-out size, so a step to
    a smaller level or a resize can leave the zoom below it, or a smaller panel can raise it. The zoom is kept then
    (the zoom stays), and a gesture moves it no further past the end and does not pull it back in one jump: a notch
    in from below the floor zooms by a notch.
  - *`0` is the double-click's reset*: 100% and the current state centred, as a new state is. `+`, `=` and `-` zoom
    about the panel's middle; with Ctrl, Alt or Meta held they are left to the browser.
  - *A zoom is the user's move*, as a drag is: it scrolls the level, so a resize after it keeps the current state's
    place in the panel (decision 11's rule, unchanged), and a pan under way when the wheel zooms goes on from where
    the zoom left the level.
  - *At the drag's reach, the reach wins* (review 6's M6). The point under the pointer stays where it is while the
    zoomed drawing can be scrolled to keep it there. Where it cannot, because that would take a corner of the
    drawing past the panel's middle (decision 11's clamp), the browser holds the scroll to its range and the point
    moves: a zoom out with the drawing's corner already at the middle, or a zoom in over the empty room beyond it.
  - *An emptied level leaves the wheel alone*: with nothing drawn there is nothing to zoom, and the TM view scrolls.
  - *Review 5's I1*, its option (a): while a mouse press is on the level, before the threshold or panning, a draw that
    would lay the level out or place it waits, and a step that stays in its state still paints. The release draws
    what waited a frame later, after the release's click: a layout at the release would replace the node a click is
    on, and the click would link nothing. A state that came during the press is new, so it is centred; a resize alone
    keeps the place the drag left.
  - *M1*, the controller's fix (decision 12's (6)): `tabIndex = -1` on `.local-level` takes it out of Firefox's tab
    order and keeps it focusable from a script; the level's one stop is still its roving node, and a node's focus
    still scrolls it into view.
  - *M3*: the font-listener test collects through the `requestGC` command in Firefox, as `collect.ts` does, rather
    than skipping there. The label tests measure a self-loop as its geometry (`getBBox()`) and half its stroke's
    width either side, through `getScreenCTM()`: what a reader sees, in both engines.
  - *M4*: the drawing is never narrower than its widest backward label and `PAD` either side, which `hang` needs to
    keep the label inside it.
  - *A `mouse` command for every browser project* (`vite.config.ts`): Playwright's own mouse, which holds a press in
    either engine, where CDP is Chromium's alone. The zoom's tests that press use it, so they run in Firefox too.

- **Review 6's fixes.** The controller's calls, 2026-11-17, after the user's "yes zoom works well": M1, `0` during a
  drag adjusting the drag's start as `#zoomAt` does; M2, the scroll kept as a float of the level's own; M3, a press
  whose release never comes ended at `lostpointercapture`, `pointercancel` and the window's `blur`; M4, a
  double-click resetting only if neither of its presses moved past the drag's threshold. Mine, each with its reason:
  dropping a wider rule for M1, starting from the asked scroll only within a pixel of it, the end at a move with no
  button held, `#panned` keeping two presses, and the `mouse` command's click count.
  - *M1, `0` during a drag moves the drag's start with the level*, as a zoom already did: `#unzoom` and `#zoomAt`
    share `#rebase`, which adds the scroll each made to the press's, so the next move goes on from where they left
    the level rather than undoing them in one jump. A wider rule, that a move finding the scroll changed by anything
    goes on from it, was tried and dropped: with it, three drag tests failed in both engines, their drags (vitest's
    `userEvent.dragAndDrop`) ending about 330 px from where they should; why was not looked into. An arrow key's
    focus and Home, End, Page Up and Page Down under a held drag are still undone by the next move: an open item.
  - *M2, the zoom goes on from the scroll it asked for.* Both engines round a scroll: on the old code the new test,
    60 wheel events of −4 px over one point, moved that point 11.4 px across in Chromium and 5.8 px down in Firefox.
    `#zoomAt` keeps the scroll it asked for, and the next zoom starts from it while the level is within a pixel of it
    (a rounding, not a move or the range's end). Applying a frame's summed delta in one zoom, the review's other way,
    would still round once a frame. In Chromium the panel itself moved 4.75 px up the page during the
    test's run of events, which neither the zoom nor the test's scrolls account for and which was not looked into;
    the test measures the point from the panel.
  - *M3, a press whose release does not come ends*: at a move with no left button held (a release in another
    window), at `lostpointercapture` (the browser took the capture back) and at the window's `blur` (the release goes
    to the window that took the focus), as well as at `pointercancel` as before. Each ends it as a release does,
    except that it focuses nothing: a waiting draw runs, and the level stops following. The blur test sends the
    window's `blur` event itself: moving the focus out of the test's frame for real would take the later cases'
    keys with it. The lost capture is tested in Chromium alone: Firefox fired no `lostpointercapture` for a capture
    the page released while the button was held, within 2 s of the release or by a frame after the next move. The
    move with no button is tested in Chromium alone, through CDP, as Playwright's mouse cannot move without the
    button it holds.
  - *M4, a double-click with a drag in it does not reset.* The level keeps whether each of the last two presses
    panned, and a `dblclick` after either is left alone. The test gives the presses the system's click counts
    through the `mouse` command, which now takes one, as Playwright does not count clicks itself.
  - *M6 and M7* are this document's and the PR description's words: the reach winning at the edge (above), what the
    screenshots show, and which tests failed first where.
- **The fan labels the old sweep never saw.** The controller's ruling, 2026-11-17, on the user's decision "fan labels:
  fix in this PR" (a fan's label by its own line); the way is my call. The label sweep run again on the final layout
  (`sweep/` in the record dir, at `ca21e4e`) found review 2's I1 back in ten `fact(12)` levels, `bmul17.s0.up31` to
  `bmul17.s9.up31`: `WORK:1 R` of `need → wr1` 2.5 px from the line of `need → wr0` and 32.0 px from its own. Their
  names are as long as the cap shows whole, so each level is 847 px wide, wider than either panel, and the gap that
  holds the label is no wider than its labels need, 68.25 px (`need`'s lines from x 664.75 to 733,
  `fan/fc4-dump.log`). Setting the row apart there takes a 99 px rise, past the 96 px `MOST_APART` then was, so the
  label took the clear place nearest being its own line's. Until the crop and drag, each of these levels fell back to
  one rule, and no sweep laid them out at two.
  - *`MOST_APART` is five node heights, 120 px.* A moving rule `<tape>:1 R` was measured for `REG`, `WORK`, `STACK`,
    `HEAP` and `BOX`, in a gap its width and two `LABEL_MARGIN` wide: it needs a rise of 91 px for `REG:1 R` and
    `BOX:1 R`, 100 for `WORK:1 R` and `HEAP:1 R`, 109 for `STACK:1 R` (`fan/rise.mts`, which runs `leastRise`'s test
    on its own, `fan/rise.log`). A rule that writes, such as `STACK:0/1 R`, was not measured. Widening the gap
    instead, which the fans entry above declined, would make levels already wider than their panel wider still; by
    `leastRise`'s test, `WORK:1 R` in a gap 0.75 px wider, 69 px, needs a 94 px rise (`fan/rise.log`'s last run),
    under the 96 px `MOST_APART` then was.
  - *Measured* on `51d3a73`'s `local-layout.ts` (`sweep/`'s `mis3h.mts`, `mis5h.mts` and `levels.mts`, run by
    `fan/sweep-a5.sh ll-fix.ts fix`, logs `fan/fix-mis3h-*`, `fix-mis5h-*` and `fix-levels-*.log`, exit 0 each;
    against `ca21e4e`'s, `fan/alldiff.mts` and `fan/relmoved.mts`, logs `fan/fix-alldiff-*.log` and
    `fan/fix-relmoved-*.log`). Labels nearer another edge's
    line: 154 in 15 levels to 144 in 5 at 844 px, and 153 to 143 at 829 px; with text that differs from that line's,
    outside `overflow`, 10 to 0 at both (0 is asked of the levels outside `overflow` only, by the controller's ruling,
    2026-11-17). The 103 (102 at 829 px) in `overflow` levels and the 41 outside them with the same text (`pc20` 21,
    `bdt25.n0` 20) are as before. Only the ten levels lay out differently, at either width: 123.3 px tall to 184.0,
    847 px wide as before. In them 30 labels move against their source node, the ten `WORK:1 R` and
    `WORK:0 L` into `need` and `WORK:0 R` out of it; the other 40 move with
    their rows. At both widths no two edges' labels are closer than `LABEL_GAP`, no other edge's line or node is
    through a label, and no label is outside the drawing, as before; 1,911 levels at 844 px and 4,576 at 829 are
    wider than their panel, the widest 902 px, and heights are p50 75 and p95 130, as before.
  - *Tests.* A node fixture of the level with `fact(12)`'s names at 829 and 844 px, and the same fan, its tape named
    `REG`, `WORK`, `STACK`, `HEAP` or `BOX`, at its narrowest gaps (a panel of no width); a browser file,
    `state-diagram-local-fan-row.test.ts`, with `fact(12)` in `bmul17.s9.up31` laid out over 829 px. On `ca21e4e`'s layout the fixture failed at both widths,
    `WORK:1 R` 2.5 px from `need → wr0` and 32.0 from its own, and the tapes' case for `WORK`, `STACK` and `HEAP`
    (`fan/node-red.log`, which holds vitest's output alone); the browser file failed in Chromium, 2.0 px against 32.0,
    and in Firefox, 1.8 against 34.0 (`fan/red-chromium.log`, `red-firefox.log`). The browser file lays the level out
    over 829 px, not 844: over 844 Chromium's widths make it 844 px wide, so it fits its panel (the file's first
    run, `fan/browser-green-chromium.log`), while over 829 it is wider in both engines. One sabotage, the place up
    against a row line's target set in by `LABEL_MARGIN` rather than `HUG`, failed both node tests and the browser
    file in both engines (`fan/sab-*.log`).

## Tasks

1. `local-level.ts`: an edge carries its rules' labels as a list (`labels`), each once; `#said` joins them with
   `, ` as before. Node test updated.
2. `local-layout.ts` (new, pure): the cut, the distinct-names rule, and the layout (columns, gaps, rows, loops,
   lanes, label placement, nudging). Node tests: the cut, distinct names, and no label box meeting a node, a loop
   or another label on synthetic levels with loops, multi-rule edges, rows and backward edges.
3. `state-diagram.ts` and `style.css`: measure, build the nodes and edges from the layout, labels as `<tspan>`
   lines, the centring box. Browser tests on the screenshot's state: distinct shown names, no text overflow, no
   label collisions, equal margins, re-centring after a height change, scrolling when taller. Pinned width
   assertions updated to the natural width.
4. Sabotage each new property once; biome, typecheck, node tests and the browser project; after screenshots.
5. Decisions 5 and 6. `local-level.ts`: a rule's label is a list of its tapes' parts, and the level takes its
   reach. `local-layout.ts`: a gap, a column and a row size to the lines of a stacked label, rules set apart; a
   pure `fitLocal` lays out at two rules and falls back to one. `state-diagram.ts`: lays out with `fitLocal` at
   each state change and width change, and sets the `aria-label` and `title`. Node tests: the parts, the reach, the
   stack's lines and rule gaps, the gap sized to the widest part, the fallback both ways. Browser tests: a two-tape
   copy's stacked label; the screenshot's level falls back in a narrow panel and returns in a wide one; at the
   screenshot's 844 px panel it keeps two rules and does not scroll sideways. Measure the share of levels wider than
   844 px and the share that fall back, on the final code.
6. Review 1's findings, the controller's rulings above. `local-layout.ts`: `LABEL_GAP`, other edges' lines as
   obstacles, backward labels inside the drawing, clashing cuts lengthened, `fitLocal`'s `hidden` count and one
   width. `state-diagram.ts`: the group's name with the reason, nothing said where nothing is hidden, the border-box
   observer, measuring again on font loads and skin changes. `style.css`: `scrollbar-gutter`. A `browser-scrollbars`
   project, Chromium without `--hide-scrollbars`, for the scroll bar test. Node property tests at both reaches and
   three widths on three fixtures; browser tests for each.
7. Decision 7. `local-layout.ts`: the end a sloping edge's label goes by and the side, the rows' room for those
   labels, places for every label and the search for one clear and nearest its own line. Node test: on `FANS` (the
   level at step 11,827) and `CLIP`, every label's nearest line is its own, at both reaches. Browser test
   (`state-diagram-local-fans.test.ts`): the same on the real level, measured on what the browser draws.
8. Review 2's findings. `local-layout.ts`: a fan's row set apart and its flat label up against the target, places
   up against the target for every line along a row, a self-loop's label moved right along its arc and its column
   widened past a line up it, places beside a climbing line, each line's points worked out once, and
   `WEIGHED_PLACES`. `state-diagram.ts`: the listeners' flag. Node tests: four of review 2's levels (and `fact`'s
   whole-name fan) in the nearest-line property, and a self-loop's label just above its own arc under a line up its
   column. Browser tests: the scroll-bar file fails on any `ResizeObserver loop` error and checks that the width the
   level is laid out for is the same overflowing as fitting; a new file checks the listeners are added once after
   every diagram is collected.
9. Review 3's findings. `local-layout.ts`: `firstClear`, the best place weighed outside `WEIGHED_PLACES`, the last
   resort over every place, the width rounded. Node tests: `firstClear` against a step-at-a-time walk on 200 seeded
   cases and its reads of a thousand boxes; `pc20`'s fan, past the cap, every label within two node heights of its
   own line and laid out the same twice; `btl11.hs.dc.r.home` keeping two rules at 829 px in Hack's widths.
10. Decision 10. `local-level.ts`, `local-layout.ts`: the reach parameter and `fitLocal` removed. `state-diagram.ts`:
    the level laid out at two rules each way at every width, the cue removed, `#panLocal`, the open hand's
    `data-pans`, and centring on a new state. `style.css`: the hands. Browser tests: the screenshot's level keeps its
    five states in a 600 px panel and scrolls, and a click there links; `state-diagram-local-pan.test.ts` (in
    `CAPTURE_FILES`): a drag pans by its distance and is clamped, a drag from a node neither links nor moves the tab
    stop or the focus while a click reaches its node, the hands, an arrow scrolls its node into view, and a step
    centres the new state while a redraw around it keeps the scroll. The fallback's node and browser tests removed.
11. Decision 11 and review 4. `style.css`: the room around the drawing (`50cqh 50cqw` in a size container), no
    scroll bar and no `scrollbar-gutter`, the open hand over every drawn level. `state-diagram.ts`: a drag at any
    size, `#place` (a centring with its clamp, or the user's offset kept), a resize placing the level again, a
    background click focusing the tab stop, no ring on a clicked node, an emptied level with no size. `local-layout.ts`:
    the empty outer columns' gaps taken in first. Tests, each seen failing first: in the pan file, a drag stopped
    where a corner reaches the middle, no ring on a clicked node, a background click taking the focus from the
    editor, the open hand over a level that fits, the wheel moving one, a resize with no drag centring again, and a
    resize after a drag keeping the state's place in the panel; the screenshot's level moved by a drag at 844 px; no
    scroll bar under `browser-scrollbars`; an emptied level with nothing to scroll; and the empty outer columns'
    gaps, as a node test. The screenshot's level shown whole at 844 px, which held before the change too, now holds
    the centring's clamp.
12. Decision 12 and review 5. `state-diagram.ts`: the zoom (the wheel and Ctrl with it about the pointer, the range,
    the double-click and the keys), the drawing scaled in `.local-drawing` inside `.local-content` at the scaled
    size, nothing laid out or placed during a press, and `tabIndex = -1` on the level. `local-layout.ts`: the drawing
    as wide as its widest backward label. `vite.config.ts`: the `mouse` command. Tests, each seen failing first in
    Chromium and in Firefox unless said otherwise: in the pan file, the wheel zooming about the point under the pointer, the range's ends,
    Ctrl and the wheel zooming the level and not the page, the wheel over the level leaving the TM view and the
    wheel off it scrolling the view, the double-click and `0` going back to 100% centred, `+`, `=` and `-` about the
    middle, the drag's stop at half and twice the size, the zoom kept through a step and a resize, a step during a
    drag moving nothing under the pointer, and Tab from the header reaching the level's node, which failed in
    Firefox alone (Chromium never made a stop of the level, and the tab stop put back fired in Firefox alone); a
    backward label inside the drawing, as a node test, which runs in neither browser. The label tests and the
    font-listener test pass in Firefox.
13. Review 6. `state-diagram.ts`: `#rebase` for `#zoomAt` and `#unzoom`, the zoom's own scroll kept as asked
    (`#zoomedTo`), a press ended by a move with no button, `lostpointercapture` or the window's `blur`, and a
    double-click after a drag ignored (`#panned`). `vite.config.ts` and `tests/browser/engine.ts`: the `mouse` command
    takes a click count. Tests in the pan file, each seen failing first: the point under the pointer through 60 small
    wheel events and a drag going on from where `0` left the level, in Chromium and Firefox; a press ended by the
    window's blur in both, and by a lost capture in Chromium; a press ended by a move with no button, in Chromium; and
    a double-click either of whose presses was a drag leaving the zoom, with a double-click of two clicks still
    resetting it, in both.
