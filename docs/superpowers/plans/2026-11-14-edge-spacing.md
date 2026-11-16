# Edge spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No text run or control sits within 4 px of its pane's or the window's edge, panel-header buttons
clear their rules by 4 px, `licences.html` stops scrolling sideways at 390 px, and `format on blur` is
labelled `format when leaving the editor`, with a browser test holding the first of these.

**Architecture:** Approach B of the spec: a pane keeps no padding of its own; its own rows (the view header,
which holds the title, the step controls and the actions, and the status lines) get `var(--space-2)` inline and
the header `var(--space-1)` above, so full-bleed content stays full-bleed. A new browser test measures every text
run (`Range` rects) and control (border box) against its pane's edges and the window's, in four states.

**Tech Stack:** CSS, TypeScript, vitest (node and browser projects), Biome.

**Spec:** `docs/superpowers/specs/2026-11-14-edge-spacing-design.md`

## Global Constraints

- Values: inline padding `var(--space-2)` (8 px), top gap `var(--space-1)` (4 px); the threshold is 4 px.
- Full-bleed stays full-bleed: `#editor` and its gutter, `.term`, `.tapes`, panels' header bands and row highlight bands.
- No colour, palette or layout change beyond these paddings and the licences wrap.
- `redextape.formatOnBlur`, the id `#format-on-blur` and every code name stay; only text a user reads changes.
- Comments say why (the invariant, what breaks); no history, no measurements, no `file:line` in tracked source.
- Commands run from `web/`. Browser files run one at a time: `pnpm vitest run --project browser tests/browser/<file>.test.ts`;
  another project's vitest on port 63315 makes this hang, so wait for the port. Long runs go into a log (`>|`), read the summary.
- Sabotage: save a copy of the file to the scratchpad, edit, run, restore from the copy, `cmp` it. Not in a checkout a
  dev server is serving.
- Never `--no-verify`. Commit messages are one sentence saying what changed, as on `main`.

## Review Focus

1. A copy's value lines once they hold a value (`.tm-value`, `.rxm-value`) are padded like `.tm-status` — Task 1, state 4.
2. A header wrapped onto several rows at 390 px keeps 8 px at both ends of every row — Task 1, states 2-3, with a
   precondition that at least one header wraps.
3. A half-width view whose header fits one row today still fits after losing 16 px (`⋯ ✕` stay on the title's row,
   the comment above `.view-header .view-title-heading`) — Task 1 Step 5, the header layout tests unchanged.
4. A panel's toggle keeps its click height, and panel headers with and without action buttons stay one height — Task 2.
5. Terminal's wider monospace at 390 px keeps every gap — Task 1, state 3.

---

### Task 1: The guard, and the pane rows padded

**Files:**
- Create: `web/tests/browser/edge-spacing.test.ts`
- Modify: `web/src/style.css` (`.view-header` at 716-722; `.tm-status, .tm-value, .rxm-value` at 998-1005)

**Interfaces:**
- Produces, inside the test file, for Task 2: `type Side = 'left' | 'right' | 'top' | 'bottom'`;
  `type Item = { kind: 'text' | 'control'; el: Element; box: { left: number; right: number; top: number; bottom: number }; label: string; cut: Record<Side, boolean> }`;
  `function itemsIn(root: Element): Item[]`; `function gap(item: Item, ref: Element | 'window', side: Side): number` (rounded to 0.1 px,
  measured to `ref`'s inner border edge, or the document's scroll size for `'window'`).

- [ ] **Step 1: Write the guard.** The sweep's `~/temp/redextape-edge-record/measure-inpage.js` is the reference for
  `itemsIn` (text nodes as a trimmed `Range`, the union of its client rects; controls as `button, select, input, textarea,
  summary` and the `role=` list there; skip what is hidden, `.visually-hidden`, `.cm-announced`; mark a side `cut` when an
  overflow ancestor clips it). Unlike the sweep, the reference edges are only the item's nearest `.pane` (left, right, top)
  and the window (all four sides). A pane's bottom is excluded by name, with the reason: a pane scrolls, so where a row
  lands against its bottom is a matter of height and scroll. `it` per state, each failing with a list of
  `pane kind · path · side · gap`:
  1. `mountAt(1600, 1000)` (setup stores the four-view workspace, so all four kinds are open);
  2. `mountAt(390, 844)`;
  3. state 2 after `chooseOption('#style', 'terminal')`;
  4. 1600×1000 with a TM copy and an rxm copy showing a value (open them as `copy-edit-leaving.test.ts:230` and
     `rxm-copy.test.ts:172` do).

  Preconditions, asserted before the gaps: four `.pane` with `data-kind` `source`, `lambda`, `tm`, `rxm`; at least 3 items
  per pane; at 390 `innerWidth < 30 * rem()` and at least one `.view-header` taller than twice its title's line; the measured
  items include the `source` title text, every `.view-close`, and the `.tm-status` text; in state 4, `.tm-value` and
  `.rxm-value` start with `value:`.
- [ ] **Step 2: Run it and see it fail.** `pnpm vitest run --project browser tests/browser/edge-spacing.test.ts` → states
  1-4 FAIL, naming the title buttons, `.view-more`, `.view-close`, the step controls, `select.speed`, `.step` and `.tm-status`
  at 0 px (state 4 adds the value lines). Anything flagged that is not inside `.view-header` or a status line: STOP and report
  it (path, side, gap); do not pad or exclude it yourself.
- [ ] **Step 3: Pad the rows.** `.view-header`: `padding-inline: var(--space-2)`, `padding-block-start: var(--space-1)`.
  The status lines' rule: `padding-inline: var(--space-2)`. The step controls sit inside `.view-header`, so they need no rule
  of their own unless the guard says otherwise. One comment above each rule saying why (the pane has none, so its rows carry
  the gap; 8 px lines a pane's title up with its panels' headers).
- [ ] **Step 4: Run the guard** → PASS, all four states.
- [ ] **Step 5: Run the header layout tests unchanged:** `copy-header.test.ts`, `view-toggles-narrow.test.ts`,
  `terminal-header-gap.test.ts`, `tm-view-narrow.test.ts` → PASS. A failure here is a STOP-and-report, not a test edit.
- [ ] **Step 6: Sabotage.** Remove `padding-inline` from the status lines' rule → the guard FAILS naming `.tm-status` (states
  1-3) and the value lines (state 4). Remove `padding-block-start` from `.view-header` → it FAILS on `top`. Restore, `cmp`.
- [ ] **Step 7: Gate.** `pnpm exec biome ci --error-on-warnings`, `pnpm run typecheck`, `pnpm test:browser` into a log → its
  summary shows no failures (a size pinned by an existing test that moved by the new padding: STOP and report it).
- [ ] **Step 8: Commit** — `A pane's title row, step controls and status lines sit 8 px in from its sides and the header 4 px below its top, and a browser test holds every text run and control 4 px from its pane's and the window's edges`.

### Task 2: Panel-header buttons clear their rules

**Files:**
- Modify: `web/src/style.css` (`.panel-header` at 1423-1431; `.panel-toggle` at 1432-1444 if the route needs it)
- Test: `web/tests/browser/edge-spacing.test.ts`

**Interfaces:**
- Consumes: `itemsIn`, `gap` (Task 1).

- [ ] **Step 1: Write the test** `it('keeps panel-header buttons and text 4 px from the header rules')` at 1600×1000: for every
  visible `.panel-header`, every text item and every control that draws a border (`.panel-maximise`, `.diagram-mode`,
  `.map-mode`, …) has `gap(item, header, 'top' | 'bottom') >= 4`; every `.panel-toggle` is at least as tall as its
  `.panel-name`'s line plus `2 * space('--space-1')` (today's click height); every visible `.panel-header` has the same
  height. Precondition: at least one header holds a bordered button and at least one holds none.
- [ ] **Step 2: Run it and see it fail** → the bordered buttons at 1.8 px.
- [ ] **Step 3: Implement.** Block padding on `.panel-header` that leaves the toggle driving the header's height, so the
  bordered buttons (`min-height: calc(1lh + 0.2em + 2px)`, 3.6 px shorter than the toggle) land at 4 px or more; the header
  grows by about 4 px. Pick the value from a measurement, not by arithmetic alone, and give it a why comment.
- [ ] **Step 4: Run** the file → PASS; record the RULES header's height before and after for the roadmap.
- [ ] **Step 5: Sabotage** the padding back to `0 var(--space-2)` → the new test FAILS on the buttons; restore, `cmp`.
- [ ] **Step 6: Gate** as Task 1 Step 7.
- [ ] **Step 7: Commit** — `Panel headers give their buttons 4 px above and below, the toggle keeping its click height and every header one height`.

### Task 3: The licences page wraps, and the label says what it does

**Files:**
- Create: `web/tests/browser/licences-narrow.test.ts`
- Modify: `web/src/pages.css` (`.page .meta` at 106-108)
- Modify: `web/index.html:61`, `web/tests/browser/harness.ts:80` (SHELL's copy of it), `web/help.html:56`
- Test: `web/tests/browser/controls-gate.test.ts` (387, comment 382), `web/tests/node/pages.test.ts`

- [ ] **Step 1: Write the licences test.** Import `../../src/pages.css` (`style.css` is global via `setup.ts`); take the
  body from `/licences.html` (fetch and `DOMParser`; if the server will not serve it, copy the body's markup without its
  script and say so in the report), then call `initPage()` and `renderLicences()` as the page's script does. At
  `page.viewport(390, 844)`, open every `details`: `document.documentElement.scrollWidth <= clientWidth`, and every
  `.page .meta a` ends inside its `.page`.
- [ ] **Step 2: Run it and see it fail** → about 25 px of sideways scroll.
- [ ] **Step 3: Wrap.** `overflow-wrap: anywhere` on `.page .meta`, as `.page details pre` does. Run → PASS.
- [ ] **Step 4: Commit** — `The licences page wraps long package links, so it no longer scrolls sideways at a phone's width`.
- [ ] **Step 5: Update the label tests.** `controls-gate.test.ts:387` expects `format when leaving the editor` (its comment
  at 382 to match); in `tests/node/pages.test.ts` add `it('names the format choice as the settings menu does')`: `help.html`
  contains `format when leaving the editor` and no `blur`. Run both → FAIL.
- [ ] **Step 6: Change the text.** `index.html:61` and `harness.ts:80`: `format when leaving the editor`. `help.html:56`:
  `<strong>settings</strong> holds the style, palette, appearance and keymap choices, and whether to format when leaving
  the editor.` Then `rg -i blur *.html src --glob '!*.test.ts'` and check every hit is a code name or a comment,
  never text a user reads; report each hit you judged. Run both tests → PASS.
- [ ] **Step 7: Commit** — `The settings checkbox format on blur reads format when leaving the editor, and the help page says the same`.

### Task 4: Measure the result, and the roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (append after the last `####` entry)

- [ ] **Step 1: Re-run the sweep** (`~/temp/redextape-edge-record/edge.mjs`, as `edge.log` records it, against a dev server
  of this branch) into `~/temp/redextape-edge-record/after/`, and take the after screenshots with `shots.mjs` beside the
  `worst-*.png` before ones. Expected: no category A row inside the app, no category B row on a panel header, no licences row.
- [ ] **Step 2: The whole gate** from the repo root: `scripts/check-all.sh --no-llvm` into a log → passes.
- [ ] **Step 3: Write the entry** in the existing shape: heading `#### EDGE SPACING: … (2026-11-14, branch \`fix/edge-spacing\`,
  \`SHA..SHA\`, N commits, plus this entry)`; Davey's decisions from the spec; `##### WHAT THIS DID NOT CLOSE` (the README
  screenshot retake, #168; the non-goals: tape cells, `help.html`'s `kbd` chips); `##### VERIFICATION` with the before and
  after sweep counts, the RULES header heights, and each figure's command.
- [ ] **Step 4: Commit** — `The roadmap records edge spacing`.
