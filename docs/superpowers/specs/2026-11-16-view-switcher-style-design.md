# View switcher style — short design

## Intent

Davey, 2026-11-14 and 2026-11-16: the header's `views` toggles (`source`, `rxm`, `λ`, `TM`) should look like the
bordered buttons in his palette mockups, because in today's joined strip the pressed state is hard to see. Approved
2026-11-16 as written under "The user's decisions".

## The user's decisions

- **Four separate buttons**, a small gap between them from a `--space-*` token, every corner rounded at 3px (or
  `--radius` if that is 3px). No joined edges and no negative margin.
- **Off** (`aria-pressed="false"`): a solid 1px `--rule` border, `--fg-dim` text, no background.
- **On** (`aria-pressed="true"`): an `--accent` border, a 2px accent underline drawn inside
  (`box-shadow: inset 0 -2px 0 var(--accent)`) and `--fg` text: the cue of the panel radios
  (`.map-mode/.diagram-mode[aria-checked="true"]`) but at normal weight, so the bar does not change width when a
  view is toggled.
- **Unchanged**: the focus ring, the narrow-window behaviour (hidden at 40rem and below), and the last pressed
  toggle that cannot be turned off (`aria-disabled`, default cursor).
- **Only the toggle-specific rules change** in `web/src/style.css`: `.views-shown`, `.view-toggle` and their states
  and media rule. The base rule every header button shares, and `web/index.html`, stay as they are.
- **The toggles' inline padding is `0.2em`**, down from `0.3em` (2026-11-16, after the first build, `f480ae5`, was
  reported and before review): as first built, the header took two rows at 1280px in the default style's Debugger
  preset (below). The controller put three options to Davey: this padding, which it recommended, accepting the second
  row, or 2px gaps. He chose the padding.

## The controller's calls (2026-11-16)

The first two were made after the first build, `f480ae5`, was reported and before review; the third after review.

- **The corners take `--radius`**, as the header's other buttons do (2px in Instrument, 5px in Paper, 3px in
  Terminal), and not the decision's 3px, so the toggles match the buttons beside them in every style. The toggle rule
  sets no radius of its own; the shared rule's applies.
- **The rule that draws the focused toggle over its neighbours (`position: relative; z-index: 1`) stays, and a test
  holds it** (below). The gap is in rem and the ring in px, so at a root font size under 16px the ring overlaps the
  neighbour's edge, and without the rule the toggle after the focused one paints over that part of the ring.
- **In forced colours one that is not pressed is dashed, and a pressed one solid in `Highlight`**, inside
  `@media (forced-colors: active)` only, as the step buttons' waiting state has a forced-colours rule of its own.
  Forced colours put a system colour in place of each of the page's and draw no box shadow, so the accent edge, the
  dim text and the underline all go and the four toggles looked alike there; a border's style survives, and so does a
  system colour the page names. This is `main`'s solid/dashed cue, brought back for that mode alone; the look
  everywhere else is the one the user ruled.

## My calls

- **The on state has no background.** Today's `--bg-raised` fill goes. The mockup had none and neither do the panel
  radios it is matched to; the underline is the cue that is not colour (umbrella §4 rule 5), and the border colour
  adds to it. In forced colours, which draw no shadow, the border's style is that cue instead (above).
- **The gap is `--space-1`**, the smallest spacing token (4px at a 16px root). It is as far as the focus ring reaches
  outside a button (2px offset, 2px wide), so a ring meets its neighbour's edge and does not cross it.
- **The pressed toggle's own `position: relative` goes**: it only served the joined strip.
- **Contrast needs no new floor.** `contrast.ts` already holds `accent` on `bg-chrome` (the header's surface) at 3:1,
  WCAG 1.4.11's floor for a non-text mark, for every built-in palette in light and dark (`palettes.test.ts`).
  `--rule` is the faint edge it is everywhere else; an off toggle is found by its word.

## What it costs the header

The toggles grow by three gaps and the 3px their overlap saved, and lose 0.1em of inline padding on each of eight
sides: 3.0px wider in all in each style (149.6 to 152.6px in Instrument, 146.0 to 149.0 in Paper, 149.1 to 152.1 in
Terminal). The header's spare width with the widest workspace label (`Debugger`) and the appearance button at its
default, `system`, which is wider than `light` in every style:

| Style, window | `f6666e9` | With the gap and `0.3em` padding | As built, `0.2em` padding |
|---|---|---|---|
| Instrument, 1280px | 11.9px | −3.1px: two rows | 8.9px |
| Paper, 1280px | 25.2px | 10.2px | 22.2px |
| Terminal at its half gap, 1280px | 25.9px | 10.9px | 22.9px |
| Terminal at its full gap, 1361px | 18.9px | 3.9px | 15.9px |

The as-built column was measured. The `f6666e9` column adds to it the 3.0px the toggles grew by, and the middle one
takes from the `f6666e9` column the 15.0px they grow by with the gaps at `0.3em` padding. Terminal draws in the
machine's monospace, so its figures are this machine's. Measured with Playwright scripts against `vite` (the sum of
the header's drawn items, a column gap between each and its padding, against its width; the spacer counted at zero),
kept in the lane's record and not in the tree.

## Tests

`first-load-views.test.ts` asserts the new look: every side of every toggle solid, in `--accent` where pressed and
`--rule` where not; the inset accent underline on a pressed toggle and none on one that is not; a gap greater than
zero between neighbours; and, under forced colours emulated through CDP (Chromium only, as the step buttons' case
is), a pressed toggle solid in the resolved `Highlight` and one that is not dashed in the edge forced colours give a
header button. Without the media rule all four read solid in that edge. `view-toggle-focus-ring.test.ts` holds all
four corner radii equal to the resolved `--radius`, in every style: choosing a style moves the focus to `settings`
and stores the style, and the first-load file is the page a visitor gets, which its last case now checks (no element
has the focus).
`view-toggles-first-paint.test.ts` already holds a pressed toggle to the width of one that is not, which is what
keeps the weight normal, and `inspector-phone.test.ts` holds the header to one row at 1280px in the Debugger preset.

`view-toggle-focus-ring.test.ts` reads each ring at a 16px root, where the gap is as wide as the ring's reach and the
ring only meets its neighbour, and in a last case at a 12px root, where the gap is 3px and the next toggle's edge
falls on the ring's outer pixel. That case reads both of the ring's pixel columns on each side with a neighbour, and
fails without the rule. The ring's top is read on its pixel row nearest the button, as its bottom is: with Paper's
5px radius on a toggle as narrow as `λ`, the middle half of the outer row reached into the ring's curve, and on the
inner row the curve stays inside the ring further along the side. Every side keeps the middle half and the floor of
more than 5 pixels sampled; a bar drawn over the ring's top in Paper fails it (`λ`'s top 0 of 7).
