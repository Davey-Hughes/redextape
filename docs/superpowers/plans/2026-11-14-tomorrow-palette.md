# Tomorrow palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in `tomorrow` palette (Tomorrow Night Eighties dark, Tomorrow light), credit it, and
make it the palette a visitor with nothing stored gets, while Instrument stays the default style.

**Architecture:** A palette is data in `web/src/palettes.ts`; `web/src/skin.ts` turns a stored choice into a
palette. Today an absent or unreadable choice reads as `'match'` (the style's own palette); after Task 3 it
reads as a new `DEFAULT_PALETTE`. The `style.css` fallback block, which paints a first visit before any
script runs, follows the default palette.

**Tech Stack:** TypeScript, Vite, vitest (node and browser projects), Biome.

**Spec:** `docs/superpowers/specs/2026-11-14-tomorrow-palette-design.md`

## Global Constraints

- Colour values: exactly the spec's Colours table, both halves, no others.
- Id `tomorrow`, menu label `Tomorrow`; menu order `match style`, Tomorrow, Paper, Terminal, Instrument.
- `DEFAULT_STYLE` stays `'instrument'`; every page's `data-style="instrument"` stays.
- A stored choice always wins, `match` included; only an absent or unreadable choice gets the default.
- A custom palette's un-imported half still falls back to `PALETTES[style]` (spec, Left to the builder).
- Colour literals only in `web/src/palettes.ts` and the `style.css` fallback block (`scripts/check-colours.sh`).
- Credit: Tomorrow Theme, MIT, "Copyright (C) 2011 Chris Kempson", colours adapted.
- Commands run from `web/` unless stated; browser runs one file at a time:
  `pnpm vitest run --project browser tests/browser/<file>.test.ts` (another project's vitest on port
  63315 makes this hang; wait for the port to free).

## Review Focus

1. A visitor who stored `match` keeps the style's palette (Instrument for the default style) — Task 3, `skin.test.ts`.
2. A visitor who stored `instrument`, `paper` or `terminal` keeps it — Task 3, `skin.test.ts`.
3. With nothing stored, changing the style keeps Tomorrow's colours (only `match` follows the style) — Task 3, `skin-switcher.test.ts`.
4. Removing the last imported custom half lands on Tomorrow, and stores `tomorrow` — Task 3, `base16-remove.test.ts`.
5. A first paint with empty storage is Tomorrow in both halves, from the fallback block alone — Task 3, `palettes.test.ts` and `base16-prepaint.test.ts`.

---

### Task 1: The `tomorrow` palette, selectable

**Files:**
- Modify: `web/src/palettes.ts` (`PALETTE_IDS` at 50; a `tomorrow` entry in `PALETTES`, placed before `paper` at 63)
- Modify: `web/src/skin.ts` (`PALETTE_CHOICE_LABELS` at 46-52)
- Test: `web/tests/node/palettes.test.ts`, `web/tests/browser/skin-switcher.test.ts`, `web/tests/browser/custom-palette-load.test.ts`, `web/tests/browser/base16-remove.test.ts`

**Interfaces:**
- Produces: `PALETTE_IDS = ['tomorrow', 'paper', 'terminal', 'instrument'] as const`; `PALETTES.tomorrow: Palette` with `id: 'tomorrow'`, `name: 'Tomorrow'`; `PALETTE_CHOICE_LABELS.tomorrow === 'Tomorrow'`.

- [ ] **Step 1: Update the menu tests to the new list.** In `skin-switcher.test.ts` "offers every style and every palette by name" (line 40) expect `['match style', 'Tomorrow', 'Paper', 'Terminal', 'Instrument']`; in `custom-palette-load.test.ts` "lists custom after the built-in choices…" (33-39) expect `['match style', 'Tomorrow', 'Paper', 'Terminal', 'Instrument', 'custom — dark: Night']`; in `base16-remove.test.ts` the option list at 198 gains `'Tomorrow'` after `'match style'` and `options()).toHaveLength(4)` at 349 becomes 5.
- [ ] **Step 2: Add a node test** in `palettes.test.ts`: `it('carries Tomorrow from the spec, first among the built-ins')` asserting `PALETTE_IDS[0] === 'tomorrow'`, `PALETTES.tomorrow.name === 'Tomorrow'`, `PALETTES.tomorrow.dark.bg === '#262626'`, `PALETTES.tomorrow.dark['bg-raised'] === '#2d2d2d'`, `PALETTES.tomorrow.light['tok-nat'] === '#a85507'` (three spot values; the existing contrast and binder loops over `PALETTE_IDS` hold the rest).
- [ ] **Step 3: Run and see them fail.** `pnpm exec vitest run --project node tests/node/palettes.test.ts` → the new test fails (no `tomorrow`); the three browser files each fail on the label list.
- [ ] **Step 4: Add the palette.** `PALETTE_IDS` as in Interfaces; the `tomorrow` entry with the spec table's 19 tokens per half, in `COLOUR_TOKENS` order, with a doc comment naming the source (Tomorrow Night Eighties / Tomorrow by Chris Kempson, MIT) and why some light-half values differ from upstream (darkened, same hue, to meet `CONTRAST_FLOORS`; the spec's table lists which). Add `tomorrow: 'Tomorrow'` to `PALETTE_CHOICE_LABELS`.
- [ ] **Step 5: Run.** `pnpm exec vitest run --project node tests/node/palettes.test.ts tests/node/skin.test.ts` → PASS, including "meets every contrast floor in every variant" and "keeps tok-binder apart from every other token" for `tomorrow`. Then each of the three browser files → PASS. `pnpm run typecheck` → no errors.
- [ ] **Step 6: Commit** — `A Tomorrow palette, Tomorrow Night Eighties dark and Tomorrow light with its light half darkened to the contrast floors, joins the palette menu first among the built-ins`.

### Task 2: The licences page credits Tomorrow

**Files:**
- Create: `web/scripts/palette-licences/tomorrow/LICENSE.md` — the upstream file verbatim, from `https://raw.githubusercontent.com/chriskempson/tomorrow-theme/master/LICENSE.md` (check it contains `Copyright (C) 2011` and Chris Kempson's name).
- Modify: `web/scripts/licences.ts` (`Group` at 47; a `PALETTES`-like list beside `TOOLCHAIN` at 74-108; its emitter beside `toolchain()` at 320-328; `ORDER` at 330)
- Modify: `web/src/licences-page.ts` (`Group` at 13; `GROUPS` at 30-35)
- Regenerate: `web/src/third-party-licences.json`
- Test: `web/tests/browser/pages.test.ts` (the per-group members check near 61)

**Interfaces:**
- Produces: a new group `'palette'`, headed **Colour schemes** on the page, holding one work: name `Tomorrow Theme (colours adapted for the Tomorrow palette)`, spdx `MIT`, url `https://github.com/chriskempson/tomorrow-theme`, version `''`, licence text from the file above. Placed last in `ORDER`.

- [ ] **Step 1: Extend the pages test** so the licences page's `palette` section lists exactly that one name, in the style of the existing per-group assertions.
- [ ] **Step 2: Run it and see it fail.** `pnpm vitest run --project browser tests/browser/pages.test.ts` → FAIL (no such section).
- [ ] **Step 3: Implement.** Mirror `TOOLCHAIN`'s shape (`{ name; spdx; url; dir }`) for a one-entry list read from `web/scripts/palette-licences/<dir>/`, emit it as group `'palette'`, add the group to both `Group` types, to `GROUPS` with heading `Colour schemes`, and to `ORDER` last. Regenerate: `node scripts/licences.ts`.
- [ ] **Step 4: Run.** The pages test → PASS; `pnpm exec vitest run --project node tests/node/licenses.test.ts tests/node/licences-scan.test.ts` → PASS; from the repo root `scripts/check-licences.sh --self-test && scripts/check-licences.sh` → both pass.
- [ ] **Step 5: Commit** — `The licences page credits the Tomorrow Theme, MIT, under a new Colour schemes heading, as the source the Tomorrow palette's colours are adapted from`.

### Task 3: Tomorrow becomes the default palette

**Files:**
- Modify: `web/src/skin.ts` (new `DEFAULT_PALETTE` beside `DEFAULT_STYLE` at 28; `readPaletteChoice` 83-86; doc comments 8-10 and 79-80)
- Modify: `web/src/main.ts:582` (the `'match'` used when the last imported half goes)
- Modify: `web/src/style.css` (fallback block 46-66; header comment at 7)
- Modify: `web/src/palettes.ts` (doc comment at 10-11 naming Instrument as the fallback)
- Test: `web/tests/node/skin.test.ts`, `web/tests/node/palettes.test.ts`, `web/tests/browser/skin-switcher.test.ts`, `web/tests/browser/base16-remove.test.ts`, `web/tests/browser/base16-prepaint.test.ts`

**Interfaces:**
- Consumes: `PALETTES.tomorrow` (Task 1).
- Produces: `export const DEFAULT_PALETTE: PaletteId = 'tomorrow'` in `skin.ts`; `readPaletteChoice(raw, custom)` returns `DEFAULT_PALETTE` where it returned `'match'` (absent, unreadable, or `'custom'` with no stored half).

- [ ] **Step 1: Update the node tests.** `skin.test.ts`: line 48's loop expects `DEFAULT_PALETTE`; line 86 expects `DEFAULT_PALETTE`; add `it('keeps a stored choice over the default')` asserting `readPaletteChoice(id, null) === id` for `'match'` and every id in `PALETTE_IDS`, and `resolvePalette('instrument', 'match', null) === PALETTES.instrument` (Review Focus 1-2). `palettes.test.ts` 86-97: rename to `'holds the default palette as its fallback, token for token'` and compare against `PALETTES[DEFAULT_PALETTE]`, both halves (Review Focus 5).
- [ ] **Step 2: Update the browser tests.** `skin-switcher.test.ts` 31-35: rename to `'mounts as Instrument with the Tomorrow palette, with nothing stored'`, expect `palette.value === 'tomorrow'` and `token('bg') === pair('tomorrow', 'bg')`; add `'keeps Tomorrow when the style changes with nothing stored'`: select style `terminal` and expect `token('bg') === pair('tomorrow', 'bg')` (Review Focus 3). `base16-remove.test.ts`: 194's title becomes `'…and a custom choice becomes the default palette'`; 199-201 expect `'tomorrow'`, stored `PALETTE_KEY` `'tomorrow'` and `PALETTES.tomorrow.dark.bg`; revisit the `'match'` at 216, 229-236 and 350 — each that means "the default" becomes `'tomorrow'`, each that means a stored `match` stays (Review Focus 4). `base16-prepaint.test.ts` 32-34: the fallback equals `PALETTES.tomorrow.dark.bg`.
- [ ] **Step 3: Run and see them fail.** The two node files and three browser files → FAIL on the default.
- [ ] **Step 4: Implement.** Add `DEFAULT_PALETTE`; `readPaletteChoice` returns it on both fallback paths; `main.ts:582` uses it; rewrite the `style.css` fallback block's 19 lines with Tomorrow's light/dark pairs from the spec table (same `--x: light-dark(#light, #dark);` shape and token order); update the four doc comments to say the fallback and first-visit palette is the default palette, Tomorrow, and that `match` follows the style.
- [ ] **Step 5: Run.** The two node files and five browser files from Steps 1-2 → PASS. Then the whole web gate: `pnpm exec biome ci --error-on-warnings`, `pnpm run typecheck`, `pnpm test:node`, `pnpm test:browser` (into a log; read the summary), and from the repo root `scripts/check-colours.sh`.
- [ ] **Step 6: Commit** — `Tomorrow becomes the palette a visitor with nothing stored gets, and the style sheet's first-paint fallback, while Instrument stays the default style and a stored choice, match included, still wins`.

### Task 4: Roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (append an entry in the existing shape)

- [ ] **Step 1: Write the entry** — heading `#### Tomorrow palette as the default (2026-11-14, branch \`feat/tomorrow-palette\`, \`SHA..SHA\`, N commits, plus this entry)`, the user's decisions from the spec, `##### WHAT THIS DID NOT CLOSE` (the one-time cached-palette flash; the view-switcher button style; the README screenshot retake in #168), and `##### VERIFICATION` ending with "Every count this entry quotes, with what produces it", each row's command run before committing.
- [ ] **Step 2: Commit** — `The roadmap records the Tomorrow palette as the default palette`.
