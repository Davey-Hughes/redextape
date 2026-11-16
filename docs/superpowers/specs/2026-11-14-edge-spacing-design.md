# Edge spacing — short design

## Intent

Davey, 2026-11-14: "make sure we don't have text or buttons touching the edges", naming the TM program pane's `×`
and the `source` title. Text and controls flush with a pane's or the window's edge read as clipped. In the same
PR, the settings checkbox `format on blur` gets a label a reader understands: he did not know what "blur" meant.

## What a measurement found

A sweep of `main` at `e65b164` (Playwright, 1600×1000 and 390×844, dark and light, every view, menu, dialog and
static page; text measured with `Range` rects, controls with their boxes; a side's container is the nearest
ancestor that draws that side, or an app region) found every gap of 0 px inside the app in one place: a `.pane`
has no padding and nothing inside it adds inline padding, so `.view-header` (the title button, `⋯`, `×`),
`.view-steps .controls` (the step buttons, `select.speed`, the step count) and the status lines (`.tm-status`,
`.tm-value`, `.rxm-value`) start at the pane's edges, which are the window's at its left and right. The step and
pane buttons also meet the header bar's bottom rule. The menus, the base16 dialog and the static pages as they
load have no contact. Dark and light measure the same. Elsewhere:

- `.panel-header` has `padding: 0 var(--space-2)`, so its buttons (maximise, `program`/`local`, `arcs`/`chips`,
  `icicle`/`minimap`) sit 1.8 px from its top and bottom rules.
- At 390 px, `licences.html` with every `details` open scrolls 25 px sideways: three long URLs in `.page .meta a`
  do not wrap, where `.page details pre` and `.page td code` have `overflow-wrap: anywhere`.
- Not flush, despite how they look: the RULES rows' text is 11–27 px in (only their highlight band is full
  width), and the editor's line numbers are 5–14 px in (only the gutter box starts at 0).

The sweep's table, scripts and screenshots are in `~/temp/redextape-edge-record/` (a dated observation, not
part of the tree).

## Approaches

- **A. Pad the whole pane**, `.pane { padding: var(--space-1) var(--space-2) }`. One rule, but it insets what
  is meant to run edge to edge: the editors, their gutters, the rows' highlight bands, the TM tape.
- **B. Pad the pane's own rows (picked by Davey).** The title row, the step controls and the status lines get
  `var(--space-2)` inline and `var(--space-1)` above; full-bleed content stays full-bleed. Its risk, a new row
  added later without the padding, is held by the test below.

## Decisions

Davey's (2026-11-14): approach B, and with it:

1. **Pane rows:** `.view-header`, `.view-steps .controls` and the status lines (`.tm-status`, `.tm-value`,
   `.rxm-value`, and any sibling row the sweep's states show flush) get `padding-inline: var(--space-2)` and a
   top gap of `var(--space-1)` from the pane's top edge. 8 px matches `.panel-header`'s inline padding, so a
   pane's title lines up with its panels' headers.
2. **Panel headers:** enough block padding that their buttons sit at least 4 px from the header's rules; the
   headers grow by about 4 px.
3. **`licences.html`:** `.page .meta` (or its links) wraps long URLs the way `.page details pre` does, so the page
   does not scroll sideways at 390 px.
4. **The label:** `format on blur` becomes **format when leaving the editor** (`web/index.html`), and
   `help.html`'s "format-on-blur choices" says the same. The storage key `redextape.formatOnBlur` and the code's
   names stay.
5. **A guard:** a browser test that fails when any text run or control in the main states sits within 4 px of
   its pane's or the window's edge, at 1600×1000 and at a width below the 30rem breakpoint, with the panes open
   in all four views. It measures text with `Range` rects, as the sweep did, and excludes, by name, what is meant
   to be full-bleed or deliberately tight (below).

## Non-goals

- The TM tape cells (glyphs 1.7 px from the cell borders, deliberately dense).
- `help.html`'s `kbd` chips (their text box touches the chip border, but the glyphs read clearly).
- The editor gutter starting at the window's left edge; its numbers are already 5 px or more in.
- Any change to colours, the palettes or the layout beyond these paddings.

## Left to the builder

The exact selectors behind "any sibling row the sweep's states show flush"; how the test enumerates states and
names its exclusions; whether the step controls' wrap at 390 px needs `row-gap`; screenshots before and after
for the PR.

## After it merges

The README screenshots are retaken (Material Darker for the README, Material Lighter for the portfolio's
snapshot), so they show the new spacing.
