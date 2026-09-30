# Plan 7 part 6b — base16 import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user paste a published base16 colour scheme into a dialog from the settings menu, see how it measures against the contrast floors the built-in palettes meet, and apply it — as it is, or with each failing colour's lightness moved until it passes — as a `custom` palette beside Paper, Terminal and Instrument, a half per variant, each removable with an undo; [Plan 7 part 6b](../specs/2026-09-29-plan7-part6b-base16-import-design.md), the umbrella's §2 row 4.

**Architecture:** The floor table and the `tok-binder` rule move out of `palettes.test.ts` into `contrast.ts`, so the built-ins and an import are held to one set of rules. `base16.ts` reads a scheme's YAML line by line without a YAML library, finds its variant, maps its sixteen colours onto the nineteen tokens and checks the result; `base16-adjust.ts` moves each failing foreground's OKLCH lightness, its hue kept and no surface touched, just far enough. `custom-palette.ts` stores the imported palette as a light half and a dark half, and `skin.ts` resolves a `custom` choice by writing each stored half over the style's own palette. `base16-dialog.ts` is a native modal `<dialog>` the settings menu opens; `main.ts` wires it into its style-and-palette block, whose `applyChosenSkin` already refreshes the pre-paint cache, so `index.html`'s script paints an import on the next load unchanged.

**Tech Stack:** TypeScript (vanilla DOM), Vitest (node and browser projects, Playwright Chromium), `dom-accessibility-api` in the controls gate. No Rust, and no build output the app imports.

## Global Constraints

- The spec is `docs/superpowers/specs/2026-09-29-plan7-part6b-base16-import-design.md`, its 13 decisions in §3. Where this plan and the spec disagree, stop and ask.
- **YAML only**, read without a YAML library, in both published layouts; a bare `#rrggbb` is a colour; a `variant:` other than `light` or `dark` is treated as absent (§3 rows 2 and 12, §4).
- **The variant**: `variant:` wins, compared in lowercase; otherwise the scheme is dark when base00's relative luminance is below base05's (§3 row 3, §4.4).
- **One floor table**: `CONTRAST_FLOORS` and `binderClashes` live in `contrast.ts`; `palettes.test.ts` and the import check the same two (§3 row 7, §5.2). The floors never loosen for an import.
- **`apply adjusted`** moves each failing foreground's lightness in OKLCH, its hue kept; no surface — `bg`, `bg-raised`, `bg-chrome`, `rule` — ever moves (§6).
- **One custom slot** under `redextape.palette.custom`, `version: 1`, a half per variant; `tokens` stored, never recomputed from `colours`; an import replaces its half and keeps the other; the last half removed removes the key (§3 rows 4, 9 and 13, §7.1).
- **Every stored or cached colour is lowercase `#rrggbb`** (§4.1, §6.1, §7.1). `index.html`'s pre-paint script does not change (§9).
- **Fixtures are schemes written for the tests.** No third-party scheme file, and no licence, enters the repo (§3 row 8, §13).
- **The umbrella's §4 rules bind every control**: a control that cannot act now is disabled, with its reason as its `aria-description` and in a visible hint (§8.3).
- **No colour literal outside the palette's fallback block in `web/src/style.css`** (the colour gate): a swatch's colour is set from data, as `applySkin` sets a token (§8.4).
- **Stay in the regions §11 names**: `main.ts`'s style-and-palette block; one `<button>` at the end of `#settings-menu`; one `style.css` block after `.visually-hidden`. 6a edits the header's mount points and markup beside them, and the `header-select-styling` branch the header selects' rules and a `:root` block.
- **The controls gate's widening is shared with 6a** (§10): whichever PR lands second rebases its gate change onto the other's.
- Doc comments are `/** */`. No `file:line` citations in tracked source (the pre-commit hook rejects them); they are normal in `docs/`. A possessive citation (`` `x.ts`'s `sym` ``) must name the file that declares the symbol. No plan task numbers in shipped code. No AI attribution anywhere.
- The pre-commit hook runs `biome ci --error-on-warnings`, `pnpm run typecheck` and the hygiene scans on every commit, **over the working tree, not only what is staged**: a file left unstaged beside a commit can fail it. Never `--no-verify`.
- **Run one browser suite at a time.** Two started together on one machine have hung, both idle, until killed. Where other lanes share the machine, prefix every browser run below with the lock they share (`flock <lock> …`).
- **A sabotage run can write files of its own**: a failing browser test writes a screenshot under `web/tests/browser/__screenshots__/` (gitignored). After every sabotage, `git status` must show only what the task changed.

## How to use the code in this plan

**The code below is the prototype's, verbatim, and it was rebuilt from this document's own blocks before the plan was committed** (see Pre-flight status). Every change is a patch:

- Save the block to a file **outside the repository** (the session scratchpad) and run `git apply <that file>` from the repository root. A patch that does not apply means the tree has drifted from the state this plan was built against — this plan's own commit plus the tasks before it. Stop and report; do not hand-merge.
- Each task's **tests' half** goes in first, so the red step can be observed; then its **source half**. A new file appears in its patch whole (`new file mode`).
- Each patch is fenced with four backticks and tagged `apply=tests` or `apply=source` with its task number, the form the replay took them from this document by.

**Set a fresh worktree up once**, from `web/`: `pnpm install --frozen-lockfile` (a real install: where `web/node_modules` is a symlink to another checkout's, no web font loads and every text-geometry result differs), then `pnpm run build:wasm && pnpm run build:lsp-wasm`. Nothing here changes the Rust, so the packages built once serve every task; `pnpm run typecheck` and the browser tests need both.

## Pre-flight status

**Every task was built, gated and sabotaged before this plan was written**, in a scratch worktree off `6febe46`, the spec's head: branch `plan7-part6b-proto`, whose seven commits, `8bf4994` to `946f631`, are this plan's seven tasks and stay for comparison. It was then rebuilt task by task from this document's own code blocks on a fresh worktree at `6febe46`, as an executor would. Each task's tests' half was applied and its red steps run as written, then its source half; the tree was staged and compared with the prototype's; its green steps were run as written and it was committed through the pre-commit hook; and every sabotage in its table was run, one at a time, restored after each. Every *Expected* block below is what that run printed, and every *Fails* column is what that sabotage failed there.

| Task | Tree against the prototype | Red step | Green steps and hook | Sabotages fired |
|---|---|---|---|---|
| 1 | IDENTICAL | 6 tests failed | passed | 6 of 6 |
| 2 | IDENTICAL | 1 file failed to load | passed | 12 of 12 |
| 3 | IDENTICAL | 1 file failed to load | passed | 10 of 10 |
| 4 | IDENTICAL | 8 tests failed | passed | 14 of 14 |
| 5 | IDENTICAL | 7 tests failed and 1 file failed to load; 1 file failed to load | passed | 11 of 11 |
| 6 | IDENTICAL | 1 test failed; 13 tests failed, 1 skipped | passed | 15 of 15 |
| 7 | IDENTICAL | 10 tests failed | passed | 12 of 12 |

**80 sabotages were run, one at a time; 80 fired on the test they were aimed at.** Each task lists its own.

**What replaying this plan found, before it was committed:**

1. **Nothing to correct.** Every task's tests' half and source half applied as the blocks give them; every staged tree was the prototype's, `docs/` aside; every red step failed and every green step passed as printed below; every commit passed the hook; and every sabotage failed the test it is aimed at — 80 of 80, one at a time, each file restored byte for byte and `git status` clean after it.
2. **Task 6's red browser run counts one test skipped**: `base16-prepaint.test.ts`'s one case, whose `beforeAll` drives an import through the dialog and fails before the dialog exists (`Cannot read properties of null (reading 'querySelector')`). Run alone in that state, the file reads `Tests  1 skipped (1)`.
3. **The whole suite with coverage was OOM-killed at its 16G cap** with its default workers, in the replay as in the prototype, and passed with `--maxWorkers=4` under the same cap, peaking at 14.9G (Task 8, step 1).

**What the prototype found, all answered in the code below:**

1. **The prototype's reader, mapping and adjustment give the spec's probe's result exactly.** Run over the three published sets the spec measured (§2.6, §6.5) beside `adjust.mts`, the spec's own probe, the prototype's `adjustVariant` returned the probe's tokens, token for token, for every file that needed adjusting: 297 of 297 in `schemes/base16`, 181 of 181 in `schemes/base24`, 222 of 222 in the legacy set. Its `readScheme` read all 812 files, and its variant rule agreed with 352 of 352 stated variants in `base16` and 208 of 209 in `base24`, `unikitty` the one, as §2.6 has it. (`compare.mts` and `read-all.mts`, run with the spec's two clones; the scratch scripts are not tracked.)
2. **§13's sabotage "its predicate evaluated before rounding" cannot be written.** `ok` takes a `#rrggbb` string and `contrast.ts` reads nothing else, so no unrounded colour can reach it: the defect is unrepresentable in this code. Task 3's sabotage 1 is aimed at the property the spec's sabotage protects — the value stored is a value that passed — by storing the bisection's failing end, and it fails four tests.
3. **§13's sabotage "the adjustment allowed to move a surface" has no one-line form either.** No surface is a foreground in `CONTRAST_FLOORS`, so none is ever walked, and taking the surfaces out of the walk's ordering changes nothing. Task 3's sabotage 2 moves one the likeliest way a later change would — where no lightness passes, the token's panel takes the page's colour — and the `NEON` fixture's surface check fails.
4. **The walk's "already meets its floors" shortcut changes no result.** Without it, a passing token walks one step, bisects back to within 2⁻¹⁶ of a step of its own lightness and rounds to its own hex. It is a shortcut, and no sabotage is aimed at it.
5. **A `close` handler focusing `#settings` changed nothing a test could see, and is not in the code.** The platform already does it: a real click on the menu's item puts the focus in the settings popover, `main.ts` hides the popover, which hands the focus back to its invoker, `#settings`, and closing a modal dialog restores whatever held the focus before `showModal`. Its sabotage failed nothing; the tests that find the focus on `#settings` after `cancel`, Esc, `apply` and `remove` stand.
6. **`text.focus()` on open shows only once the `now` line exists.** Until Task 7 the text area is the dialog's first focusable, which `showModal` focuses anyway; after it, the `remove` buttons come first, and Task 7's sabotage 9 fails.
7. **The gate's `selectLabel` removing `input` and `textarea` from its copy of a label cannot be told from not removing them**, by any control the app has: the dialog sets its text area's value, not its text, and a checkbox has none. It stays, as §10 asks, and no sabotage is aimed at it.
8. **§11's table leaves out three files the change needs.** `web/tests/browser/harness.ts`: `SHELL` must carry the new menu item, or `harness.test.ts`'s case holding it to `index.html` fails (6a changes the same markup). `web/src/notice.ts`: its `dismiss` doc said nothing outside the module calls it, and the apply that ends a removal's `undo` (§8.5) is that caller. `web/tests/node/contrast.test.ts`: the moved rules' planted-defect cases, since every built-in passes both rules and a rule no palette fails is one nothing checks.
9. **Three test files §13 does not list.** `custom-palette-load.test.ts`: Task 5 changes what `main.ts` reads at start-up, and a stored custom palette drawn from the first frame is its red and green. `base16-remove.test.ts` holds §13's `remove` and `undo` cases, which it puts in `base16-import.test.ts`: they need a store seeded with an adjusted half, and the import file's last case leaves its page and its store apart (a write storage refused). The fixture module, `base16-fixtures.ts`, is shared by both tiers.
10. **`binderClashes` returns `{ token, apart }`, not the test's sentences**; `palettes.test.ts` writes its message from them, unchanged, and the check writes its own.
11. **The check's ratios are cut, not rounded, to two places**, so a ratio just under its floor never prints as the floor — 4.497 reads `4.49:1`, not `4.50:1`. **A group's floor is the highest it fails**: one scheme-colour pair is one pair of colours, so its ratio is one number, and its tokens can carry floors of 4.5 and 3. **`colours’` takes the typographic apostrophe** the app's other copy uses; the spec writes `'`.
12. **The dialog at 1280×800 in the three styles, light and dark,** with a failing scheme checked and both panels open: the `now` line, the swatches and the grouped details read as the spec's examples do, and the dialog scrolls within the viewport. Screenshots in the scratchpad, not tracked.

**Verified fixtures**, each measured by running it — every figure below is one a test in this plan asserts:

| Fixture | Where | Measured |
|---|---|---|
| `NIGHT` | Tasks 2–7 | dark; every floor and the binder rule pass as it is |
| `DAY` | Tasks 2, 5–7 | light, by luminance with no `variant:`; every floor and the binder rule pass |
| `EMBER` | Tasks 3, 4, 6, 7 | dark, detected; 17 of 35 checks below, worst 3.31:1, in 8 scheme-colour groups; `apply adjusted` moves 8 tokens, 4 colours, and every check then passes; `on-accent` does not move, and `focus-ring` keeps base05 where `fg` leaves it |
| `TWINS` | Tasks 3, 4 | `NIGHT` with its binder 16 from its operators; the adjustment moves the binder the shorter way, to `#70c0b0` |
| `NEON` | Tasks 3–5 | base01 a bright green: 20 of 35 below; 12 tokens no lightness fixes; `focus-ring` and `warn` move; 16 checks still fail |
| `STUCK` | Task 4 | black and white under one grey: every floor passes, the binder is 0 from 8 other colours, and no lightness sets it apart |

## File structure

**Created**

| File | Task | Responsibility |
|---|---|---|
| `web/src/base16.ts` | 2, 4 | the reader, the variant, the mapping; the check and its words |
| `web/src/base16-adjust.ts` | 3 | OKLCH, and `apply adjusted`'s adjustment |
| `web/src/custom-palette.ts` | 5 | the stored `custom` palette: its shape, its validation, an import and a remove |
| `web/src/base16-dialog.ts` | 6, 7 | the import dialog |
| `web/tests/node/base16-fixtures.ts` | 2–5, 7 | schemes written for the tests, and stored halves built from them |
| `web/tests/node/base16.test.ts`, `base16-adjust.test.ts`, `custom-palette.test.ts` | 2, 3, 4, 5 | the reader, the adjustment, the check, the store |
| `web/tests/browser/custom-palette-load.test.ts`, `base16-import.test.ts`, `base16-prepaint.test.ts`, `base16-remove.test.ts` | 5, 6, 7 | a stored palette at start-up; the dialog; first paint; remove and undo |

**Modified**

| File | Task | What changes |
|---|---|---|
| `web/src/contrast.ts` | 1 | gains `CONTRAST_FLOORS`, `BINDER_APART` and `binderClashes` |
| `web/tests/node/palettes.test.ts`, `contrast.test.ts` | 1 | the built-ins read the moved rules; a planted defect in each |
| `web/src/palettes.ts` | 5 | `Palette.id` widens to `PaletteId \| 'custom'` |
| `web/src/skin.ts` | 5 | `custom` as a choice: its label, `readPaletteChoice`, `resolvePalette`, `applySkin` |
| `web/src/main.ts` | 5, 6, 7 | the style-and-palette block only: the store read at start-up, the palette select rebuilt, the dialog wired, remove and undo |
| `web/tests/node/skin.test.ts`, `prepaint.test.ts` | 5 | `custom` read, resolved and applied; the pre-paint script on a custom palette |
| `web/index.html`, `web/tests/browser/harness.ts` | 6 | one `<button>` at the end of `#settings-menu`, in the page and in `SHELL` |
| `web/src/style.css` | 6, 7 | one block after `.visually-hidden` |
| `web/tests/browser/controls-gate.test.ts` | 6, 7 | §10's widening, and the dialog walked |
| `web/src/notice.ts` | 7 | `dismiss`'s doc: its one caller outside |

---

### Task 1: The contrast floors and the binder rule move into `contrast.ts`, so an import can be held to them

**Files:**
- Modify: `web/src/contrast.ts` (`CONTRAST_FLOORS`, `BINDER_APART`, `BinderClash`, `binderClashes`)
- Modify (tests): `web/tests/node/palettes.test.ts` — imports both; its two cases keep their names and failure messages
- Test: `web/tests/node/contrast.test.ts`

**Interfaces:**
- Produces `contrast.ts`'s `CONTRAST_FLOORS: readonly (readonly [ColourToken, ColourToken, number])[]`, the 35 `[foreground, background, floor]` pairs `palettes.test.ts` built, unchanged; `BINDER_APART = 24`; `type BinderClash = { readonly token: ColourToken; readonly apart: number }`; and `binderClashes(v: Variant): BinderClash[]`, every token `tok-binder` is within 24 of in its most distant channel. Tasks 3 and 4 hold an import to both.

**ONE FLOOR TABLE** (spec §3 row 7, §5.2). The table and the rule move as they are, with their comments, so an import is checked against exactly what the built-ins meet. `binderClashes` returns data rather than the test's sentences, and `palettes.test.ts` writes its own failure message from it, word for word as before.

**EVERY BUILT-IN PASSES BOTH RULES, SO `contrast.test.ts` PLANTS A DEFECT IN EACH**: a dim text drawn in the page colour must fail its three floors, a binder drawn in the text colour must clash with the three tokens that share it, and 23 apart must clash where 24 does not. A rule no palette can fail is a rule nothing checks.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=1
diff --git a/web/tests/node/contrast.test.ts b/web/tests/node/contrast.test.ts
index c75f30f..dc38850 100644
--- a/web/tests/node/contrast.test.ts
+++ b/web/tests/node/contrast.test.ts
@@ -1,5 +1,6 @@
 import { describe, expect, it } from 'vitest'
-import { contrastRatio, relativeLuminance } from '../../src/contrast'
+import { binderClashes, CONTRAST_FLOORS, contrastRatio, relativeLuminance } from '../../src/contrast'
+import { PALETTES } from '../../src/palettes'
 
 describe('contrast', () => {
   it('gives the WCAG endpoints', () => {
@@ -25,3 +26,40 @@ describe('contrast', () => {
     }
   })
 })
+
+/**
+ * The floors and the binder rule, which `palettes.test.ts` holds the built-ins to and an import is checked against
+ * (Plan 7 part 6b spec §5.2). Every built-in passes both, so these plant a defect in one and assert it is found: a
+ * rule no palette can fail is a rule nothing checks.
+ */
+describe('the floors and the binder rule', () => {
+  it('holds 35 pairs, none twice', () => {
+    expect(CONTRAST_FLOORS.length).toBe(35)
+    expect(new Set(CONTRAST_FLOORS.map(([fg, bg]) => `${fg} on ${bg}`)).size).toBe(35)
+  })
+
+  it('finds a dim text drawn in the page colour, on every surface it sits on', () => {
+    const v = { ...PALETTES.paper.light, 'fg-dim': PALETTES.paper.light.bg }
+    const failing = CONTRAST_FLOORS.filter(([fg, bg, floor]) => contrastRatio(v[fg], v[bg]) < floor)
+    expect(failing.map(([fg, bg]) => `${fg} on ${bg}`)).toEqual([
+      'fg-dim on bg',
+      'fg-dim on bg-raised',
+      'fg-dim on bg-chrome',
+    ])
+  })
+
+  it('names each token a binder drawn in the text colour sits on, and how far apart they are', () => {
+    const v = { ...PALETTES.paper.light, 'tok-binder': PALETTES.paper.light['tok-ident'] }
+    expect(binderClashes(v)).toEqual([
+      { token: 'fg', apart: 0 },
+      { token: 'focus-ring', apart: 0 },
+      { token: 'tok-ident', apart: 0 },
+    ])
+  })
+
+  it('holds a binder 24 away in one channel to be apart, and 23 away to be too close', () => {
+    const v = { ...PALETTES.paper.light, 'tok-ident': '#221f1b', fg: '#221f1b', 'focus-ring': '#221f1b' }
+    expect(binderClashes({ ...v, 'tok-binder': '#3a1f1b' })).toEqual([])
+    expect(binderClashes({ ...v, 'tok-binder': '#391f1b' }).map((c) => c.apart)).toEqual([23, 23, 23])
+  })
+})
diff --git a/web/tests/node/palettes.test.ts b/web/tests/node/palettes.test.ts
index c8a47f0..c764f83 100644
--- a/web/tests/node/palettes.test.ts
+++ b/web/tests/node/palettes.test.ts
@@ -1,10 +1,9 @@
 import { readFileSync } from 'node:fs'
 import { fileURLToPath } from 'node:url'
 import { describe, expect, it } from 'vitest'
-import { contrastRatio } from '../../src/contrast'
+import { binderClashes, CONTRAST_FLOORS, contrastRatio } from '../../src/contrast'
 import {
   COLOUR_TOKENS,
-  type ColourToken,
   PALETTE_CSS_PATTERN,
   PALETTE_IDS,
   PALETTES,
@@ -17,32 +16,6 @@ const VARIANTS: [string, Variant][] = PALETTE_IDS.flatMap((id): [string, Variant
   [`${id} dark`, PALETTES[id].dark],
 ])
 
-/** Every pair a floor applies to, as `[foreground, background, floor]` — spec §12, test 1. */
-const FLOORS: [ColourToken, ColourToken, number][] = [
-  ...(['fg', 'fg-dim', ...COLOUR_TOKENS.filter((t) => t.startsWith('tok-'))] as ColourToken[]).flatMap(
-    (t): [ColourToken, ColourToken, number][] => [
-      [t, 'bg', 4.5],
-      [t, 'bg-raised', 4.5],
-    ],
-  ),
-  ['fg', 'bg-chrome', 4.5],
-  ['fg-dim', 'bg-chrome', 4.5],
-  ...(['focus-ring', 'warn'] as ColourToken[]).flatMap((t): [ColourToken, ColourToken, number][] => [
-    [t, 'bg', 3],
-    [t, 'bg-raised', 3],
-    [t, 'bg-chrome', 3],
-  ]),
-  // `--accent` and `--error` also colour text on `--bg` and `--bg-raised`, so there they meet the text
-  // floor, tighter than the 3:1 Plan 7 part 1 first set for both on every surface. Neither is text on
-  // chrome.
-  ...(['accent', 'error'] as ColourToken[]).flatMap((t): [ColourToken, ColourToken, number][] => [
-    [t, 'bg', 4.5],
-    [t, 'bg-raised', 4.5],
-    [t, 'bg-chrome', 3],
-  ]),
-  ['on-accent', 'accent', 4.5],
-]
-
 describe('palettes', () => {
   it('has one palette per id, each carrying its own id', () => {
     for (const id of PALETTE_IDS) expect(PALETTES[id].id).toBe(id)
@@ -57,7 +30,7 @@ describe('palettes', () => {
   it('meets every contrast floor in every variant', () => {
     const failures: string[] = []
     for (const [name, v] of VARIANTS) {
-      for (const [fg, bg, floor] of FLOORS) {
+      for (const [fg, bg, floor] of CONTRAST_FLOORS) {
         const r = contrastRatio(v[fg], v[bg])
         if (r < floor) failures.push(`${name}: ${fg} on ${bg} is ${r.toFixed(2)}, floor ${floor}`)
       }
@@ -65,27 +38,13 @@ describe('palettes', () => {
     expect(failures).toEqual([])
   })
 
-  // `tok-binder` exists ONLY to be a different colour from the two other classes a λ editor can show,
-  // so a value that drifted back onto a neighbour would leave the token in place and the defect intact.
-  //
-  // NOT A PERCEPTUAL GATE, AND NOT PRETENDING TO BE ONE. Whether two colours read apart is a judgement
-  // made by eye, against a rendered editor; 24 in some channel is far below what the eye needs and far
-  // above what `tok-punct` against `tok-neutral` scores in any variant. What it catches is the failure
-  // that put this token here — a class drawing a neighbour's exact value — not a poor choice of hue.
-  //
-  // SCOPED TO `tok-binder` rather than run over every pair, because two pairs are deliberately equal or
-  // all but: `tok-nat` and `tok-bool` are one colour on purpose, and `tok-punct` sits on `tok-neutral`
-  // in the dark variants. Widening this to all pairs is a palette change, not a test change.
+  // The rule and why it is scoped to `tok-binder` are `contrast.ts`'s `binderClashes`, which an import is held to
+  // as well.
   it('keeps tok-binder apart from every other token', () => {
-    const channels = (hex: string): number[] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
     const failures: string[] = []
     for (const [name, v] of VARIANTS) {
-      const binder = channels(v['tok-binder'])
-      for (const t of COLOUR_TOKENS) {
-        if (t === 'tok-binder') continue
-        const other = channels(v[t])
-        const apart = Math.max(...binder.map((c, i) => Math.abs(c - (other[i] ?? 0))))
-        if (apart < 24) failures.push(`${name}: tok-binder ${v['tok-binder']} is ${apart} from ${t} ${v[t]}`)
+      for (const { token, apart } of binderClashes(v)) {
+        failures.push(`${name}: tok-binder ${v['tok-binder']} is ${apart} from ${token} ${v[token]}`)
       }
     }
     expect(failures).toEqual([])
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/contrast.test.ts tests/node/palettes.test.ts`

Expected: exit 1, printing:

```text
Test Files  2 failed (2)
Tests  6 failed | 11 passed (17)
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=1
diff --git a/web/src/contrast.ts b/web/src/contrast.ts
index 25c0cbe..f966da2 100644
--- a/web/src/contrast.ts
+++ b/web/src/contrast.ts
@@ -1,7 +1,9 @@
+import { COLOUR_TOKENS, type ColourToken, type Variant } from './palettes'
+
 /**
- * WCAG 2 relative luminance and contrast ratio, for holding palettes to their contrast floors — the
- * built-ins in `palettes.test.ts` now, and an imported base16 palette before it is applied in Plan 7
- * part 6.
+ * WCAG 2 relative luminance and contrast ratio, and the floors a palette is held to — the built-ins in
+ * `palettes.test.ts`, and an imported base16 scheme before it is applied (Plan 7 part 6b). The two are held
+ * to one table and one binder rule, so an import is checked against exactly what the built-ins meet.
  *
  * ONLY `#rrggbb`, deliberately. Every palette value is written that way (`palettes.test.ts` asserts it),
  * and a parser that also took shorthand, alpha or names would be code whose only callers are tests.
@@ -22,3 +24,68 @@ export function contrastRatio(a: string, b: string): number {
   const lb = relativeLuminance(b)
   return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
 }
+
+/**
+ * Every pair a floor applies to, as `[foreground, background, floor]` — Plan 7 part 1 spec §12, test 1.
+ *
+ * 4.5 and 3 are WCAG 2's AA thresholds for text (1.4.3) and for non-text marks (1.4.11).
+ */
+export const CONTRAST_FLOORS: readonly (readonly [ColourToken, ColourToken, number])[] = [
+  ...(['fg', 'fg-dim', ...COLOUR_TOKENS.filter((t) => t.startsWith('tok-'))] as ColourToken[]).flatMap(
+    (t): [ColourToken, ColourToken, number][] => [
+      [t, 'bg', 4.5],
+      [t, 'bg-raised', 4.5],
+    ],
+  ),
+  ['fg', 'bg-chrome', 4.5],
+  ['fg-dim', 'bg-chrome', 4.5],
+  ...(['focus-ring', 'warn'] as ColourToken[]).flatMap((t): [ColourToken, ColourToken, number][] => [
+    [t, 'bg', 3],
+    [t, 'bg-raised', 3],
+    [t, 'bg-chrome', 3],
+  ]),
+  // `--accent` and `--error` also colour text on `--bg` and `--bg-raised`, so there they meet the text
+  // floor, tighter than the 3:1 Plan 7 part 1 first set for both on every surface. Neither is text on
+  // chrome.
+  ...(['accent', 'error'] as ColourToken[]).flatMap((t): [ColourToken, ColourToken, number][] => [
+    [t, 'bg', 4.5],
+    [t, 'bg-raised', 4.5],
+    [t, 'bg-chrome', 3],
+  ]),
+  ['on-accent', 'accent', 4.5],
+]
+
+/** How far apart, in some channel, `tok-binder` must sit from every other token. */
+export const BINDER_APART = 24
+
+/** A token `tok-binder` sits too close to, and how far apart the two are in their most distant channel. */
+export type BinderClash = { readonly token: ColourToken; readonly apart: number }
+
+/**
+ * Every token `tok-binder` is within `BINDER_APART` of, in its most distant channel — empty when it stands apart
+ * from all of them.
+ *
+ * `tok-binder` exists ONLY to be a different colour from the two other classes a λ editor can show, so a value
+ * that drifted back onto a neighbour would leave the token in place and the defect intact.
+ *
+ * NOT A PERCEPTUAL GATE, AND NOT PRETENDING TO BE ONE. Whether two colours read apart is a judgement made by eye,
+ * against a rendered editor; 24 in some channel is far below what the eye needs and far above what `tok-punct`
+ * against `tok-neutral` scores in any built-in variant. What it catches is the failure that put this token here —
+ * a class drawing a neighbour's exact value — not a poor choice of hue.
+ *
+ * SCOPED TO `tok-binder` rather than run over every pair, because two pairs are deliberately equal or all but:
+ * `tok-nat` and `tok-bool` are one colour on purpose, and `tok-punct` sits on `tok-neutral` in the dark variants.
+ * Widening this to all pairs is a palette change, not a rule change.
+ */
+export function binderClashes(v: Variant): BinderClash[] {
+  const channels = (hex: string): number[] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
+  const binder = channels(v['tok-binder'])
+  const clashes: BinderClash[] = []
+  for (const t of COLOUR_TOKENS) {
+    if (t === 'tok-binder') continue
+    const other = channels(v[t])
+    const apart = Math.max(...binder.map((c, i) => Math.abs(c - (other[i] ?? 0))))
+    if (apart < BINDER_APART) clashes.push({ token: t, apart })
+  }
+  return clashes
+}
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  53 passed (53)
Tests  768 passed (768)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command; after each, `git status` shows only this task's changes). In the replay, 6 of 6 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | a floor tightened in the moved table, which the built-ins then fail — `src/contrast.ts`: `['on-accent', 'accent', 4.5],` → `['on-accent', 'accent', 21],` | `cd web && pnpm exec vitest run --project node tests/node/contrast.test.ts tests/node/palettes.test.ts` | `tests/node/contrast.test.ts > the floors and the binder rule > finds a dim text drawn in the page colour, on every surface it sits on`, `tests/node/palettes.test.ts > palettes > meets every contrast floor in every variant` |
| 2 | a text floor loosened to nothing — `src/contrast.ts`: `[t, 'bg', 4.5], ⏎ [t, 'bg-raised', 4.5],` → `[t, 'bg', 1], ⏎ [t, 'bg-raised', 4.5],` | `cd web && pnpm exec vitest run --project node tests/node/contrast.test.ts tests/node/palettes.test.ts` | `tests/node/contrast.test.ts > the floors and the binder rule > finds a dim text drawn in the page colour, on every surface it sits on` |
| 3 | a pair dropped from the table — `src/contrast.ts`: `['fg-dim', 'bg-chrome', 4.5],` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/contrast.test.ts tests/node/palettes.test.ts` | `tests/node/contrast.test.ts > the floors and the binder rule > finds a dim text drawn in the page colour, on every surface it sits on`, `tests/node/contrast.test.ts > the floors and the binder rule > holds 35 pairs, none twice` |
| 4 | the binder rule finds no clash — `src/contrast.ts`: `export const BINDER_APART = 24` → `export const BINDER_APART = 0` | `cd web && pnpm exec vitest run --project node tests/node/contrast.test.ts tests/node/palettes.test.ts` | `tests/node/contrast.test.ts > the floors and the binder rule > holds a binder 24 away in one channel to be apart, and 23 away to be too close`, `tests/node/contrast.test.ts > the floors and the binder rule > names each token a binder drawn in the text colour sits on, and how far apart they are` |
| 5 | the binder rule holds tok-binder against itself — `src/contrast.ts`: `if (t === 'tok-binder') continue` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/contrast.test.ts tests/node/palettes.test.ts` | `tests/node/contrast.test.ts > the floors and the binder rule > holds a binder 24 away in one channel to be apart, and 23 away to be too close`, `tests/node/contrast.test.ts > the floors and the binder rule > names each token a binder drawn in the text colour sits on, and how far apart they are`, `tests/node/palettes.test.ts > palettes > keeps tok-binder apart from every other token` |
| 6 | the binder rule one short: 23 apart passes — `src/contrast.ts`: `if (apart < BINDER_APART) clashes.push({ token: t, apart })` → `if (apart < BINDER_APART - 1) clashes.push({ token: t, apart })` | `cd web && pnpm exec vitest run --project node tests/node/contrast.test.ts tests/node/palettes.test.ts` | `tests/node/contrast.test.ts > the floors and the binder rule > holds a binder 24 away in one channel to be apart, and 23 away to be too close` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
The contrast floors and the binder rule move into `contrast.ts`, so an import can be held to them

`CONTRAST_FLOORS`, the 35 pairs `palettes.test.ts` built for itself, and
`binderClashes`, its `tok-binder` rule as a function, move beside the
contrast ratio they are measured with (Plan 7 part 6b spec §5.2). The
built-ins' two cases keep their names and failure messages and read the
moved rules; `contrast.test.ts` plants a defect in each, since every
built-in passes both and a rule no palette fails is one nothing checks.
````

---

### Task 2: A base16 scheme is read from either published layout, its variant found, and its colours mapped onto the tokens

**Files:**
- Create: `web/src/base16.ts` (`BASE16_KEYS`, `Base16Key`, `SchemeVariant`, `Scheme`, `SchemeReading`, `readScheme`, `detectVariant`, `BASE16_MAPPING`, `mapScheme`)
- Create (tests): `web/tests/node/base16-fixtures.ts` (`NIGHT`, `DAY`, `currentLayout`, `legacyLayout`, `keyed`)
- Test: `web/tests/node/base16.test.ts`

**Interfaces:**
- Produces `readScheme(text: string): SchemeReading`, which is `{ ok: true; scheme: Scheme }` or `{ ok: false; errors: readonly string[] }`; `Scheme` is `{ name: string /* '' for none */; colours: Readonly<Record<Base16Key, string>> /* lowercase #rrggbb */; variant: 'light' | 'dark'; variantFrom: 'file' | 'detected'; base24: boolean }`. Also `detectVariant(colours): SchemeVariant`, `BASE16_MAPPING: Readonly<Record<ColourToken, Base16Key>>` and `mapScheme(colours): Variant`. Tasks 3 to 7 read schemes through these.

**A LINE READER FOR THE SHAPE BOTH PUBLISHED LAYOUTS SHARE** (spec §4.1): a line counts only as `key: value`. `base00`–`base0F`, the last digit in either case, are read at any indentation, so the legacy layout's top-level keys and the current one's under `palette:` both read; any of `base10`–`base17` marks the scheme base24. `name`, or else `scheme`, and `variant` are read at no indentation only. A value is double-quoted with `\"` and `\\` unescaped, single-quoted with `''` read as `'`, or bare up to the first `#` after whitespace; a colour is six hex digits with or without `#`, stored lowercase with `#`, and a bare `#rrggbb` is a colour, where YAML reads a comment (§3 row 12).

**EVERY ERROR IS COLLECTED, EACH NAMING ITS KEY** (§4.2): `base0C is missing`, `base03 is not a colour: "#12345"`, `base05 is given twice` — and text with no colour line at all, whether empty, TOML, JSON or a flow mapping, says one thing: `no base16 colours found`. An anchor or an alias reads as a value that is not a colour (§4.3).

**THE VARIANT** (§4.4): `variant:` in lowercase wins when it is `light` or `dark`; otherwise the scheme is dark when base00 is darker than base05. **THE MAPPING** (§5.1) is the spec's table, all 19 tokens.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=2
diff --git a/web/tests/node/base16-fixtures.ts b/web/tests/node/base16-fixtures.ts
new file mode 100644
index 0000000..6e5126c
--- /dev/null
+++ b/web/tests/node/base16-fixtures.ts
@@ -0,0 +1,75 @@
+/**
+ * base16 schemes written for these tests (Plan 7 part 6b spec §13): no published scheme, and no licence, enters the
+ * repo. Each is its sixteen colours, base00 first; `currentLayout` and `legacyLayout` write one out as the YAML the
+ * two published layouts use. What each one measures is asserted where it is used, not here.
+ */
+
+/** Passes every floor and the binder rule, as it is. Dark. */
+export const NIGHT = [
+  '#1f1d2b',
+  '#2b2838',
+  '#3a3649',
+  '#5b5670',
+  '#9a94b0',
+  '#c8c3d8',
+  '#e0dcea',
+  '#f2f0f7',
+  '#e8707a',
+  '#e0a070',
+  '#e8c878',
+  '#90d090',
+  '#70c8c8',
+  '#80a8e8',
+  '#c898e0',
+  '#d0a080',
+] as const
+
+/** Passes every floor and the binder rule, as it is. Light. */
+export const DAY = [
+  '#f6f4ee',
+  '#ebe7de',
+  '#ddd7ca',
+  '#a8a090',
+  '#5e584c',
+  '#2e2a24',
+  '#1e1b17',
+  '#12100d',
+  '#b02a30',
+  '#9a4a10',
+  '#7a5a00',
+  '#2e6e2e',
+  '#1a6a70',
+  '#2a5aa0',
+  '#8a3a90',
+  '#7a4a30',
+] as const
+
+const KEYS = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '0A', '0B', '0C', '0D', '0E', '0F']
+
+/** A scheme in the current layout: `system`, `name`, `variant` if given, and each colour quoted, with `#`, under `palette:`. */
+export function currentLayout(name: string, colours: readonly string[], variant?: string): string {
+  return [
+    'system: "base16"',
+    `name: "${name}"`,
+    'author: "redextape tests"',
+    ...(variant === undefined ? [] : [`variant: "${variant}"`]),
+    'palette:',
+    ...KEYS.map((k, i) => `  base${k}: "${colours[i]}"`),
+    '',
+  ].join('\n')
+}
+
+/** A scheme in the legacy layout: `scheme`, `author`, and each colour at the top level as bare hex, quoted. */
+export function legacyLayout(name: string, colours: readonly string[]): string {
+  return [
+    `scheme: "${name}"`,
+    'author: "redextape tests"',
+    ...KEYS.map((k, i) => `base${k}: "${(colours[i] ?? '').slice(1)}"`),
+    '',
+  ].join('\n')
+}
+
+/** `colours` as the record `readScheme` returns, keyed `base00`–`base0F`. */
+export function keyed(colours: readonly string[]): Record<string, string> {
+  return Object.fromEntries(KEYS.map((k, i) => [`base${k}`, colours[i] ?? '']))
+}
diff --git a/web/tests/node/base16.test.ts b/web/tests/node/base16.test.ts
new file mode 100644
index 0000000..0c089a8
--- /dev/null
+++ b/web/tests/node/base16.test.ts
@@ -0,0 +1,178 @@
+import { describe, expect, it } from 'vitest'
+import { BASE16_MAPPING, detectVariant, mapScheme, readScheme, type Scheme } from '../../src/base16'
+import { COLOUR_TOKENS } from '../../src/palettes'
+import { currentLayout, DAY, keyed, legacyLayout, NIGHT } from './base16-fixtures'
+
+/** The scheme `text` reads as, or a failure naming its errors. */
+function read(text: string): Scheme {
+  const r = readScheme(text)
+  if (!r.ok) throw new Error(`did not read: ${r.errors.join('; ')}`)
+  return r.scheme
+}
+
+/** The errors `text` reads as, or a failure if it reads. */
+function errors(text: string): readonly string[] {
+  const r = readScheme(text)
+  if (r.ok) throw new Error('read, where it should not have')
+  return r.errors
+}
+
+/** `NIGHT` in the legacy layout with line `base${key}` replaced by `line`, or removed for `null`. */
+const withLine = (key: string, line: string | null): string =>
+  legacyLayout('Night', NIGHT)
+    .split('\n')
+    .flatMap((l) => (l.startsWith(`base${key}:`) ? (line === null ? [] : [line]) : [l]))
+    .join('\n')
+
+describe('readScheme — the two published layouts (Plan 7 part 6b spec §4.1)', () => {
+  it('reads the current layout: name, variant, and the colours under palette:', () => {
+    const s = read(currentLayout('Night', NIGHT, 'dark'))
+    expect(s).toEqual({ name: 'Night', colours: keyed(NIGHT), variant: 'dark', variantFrom: 'file', base24: false })
+  })
+
+  it('reads the legacy layout: scheme, and the colours at the top level as bare hex', () => {
+    const s = read(legacyLayout('Day', DAY))
+    expect(s).toEqual({ name: 'Day', colours: keyed(DAY), variant: 'light', variantFrom: 'detected', base24: false })
+  })
+
+  it('reads a colour with or without #, in double, single or no quotes, in either case, as lowercase #rrggbb', () => {
+    const text = [
+      'palette:',
+      '  base00: "#1F1D2B"',
+      "  base01: '2b2838'",
+      '  base02: #3A3649',
+      '  base03: 5b5670',
+      ...NIGHT.slice(4).map((c, i) => `  base0${(i + 4).toString(16).toUpperCase()}: "${c}"`),
+    ].join('\n')
+    expect(read(text).colours).toEqual(keyed(NIGHT))
+  })
+
+  it('reads a bare #rrggbb as that colour, where YAML reads a comment', () => {
+    expect(read(withLine('00', 'base00: #1f1d2b')).colours.base00).toBe('#1f1d2b')
+  })
+
+  it('reads the last digit of a key in either case', () => {
+    expect(read(withLine('0F', 'base0f: "d0a080"')).colours.base0F).toBe('#d0a080')
+  })
+
+  it('skips full-line, tab-led and trailing comments', () => {
+    const text = [
+      '# Night, for the tests',
+      '\t# base00: "ffffff" — a comment, not a colour',
+      withLine('00', 'base00: "1f1d2b" # the page').replace('base01: "2b2838"', 'base01: 2b2838 # panels'),
+    ].join('\n')
+    const s = read(text)
+    expect(s.colours.base00).toBe('#1f1d2b')
+    expect(s.colours.base01).toBe('#2b2838')
+  })
+
+  it('reads name over scheme, and unescapes a quoted one', () => {
+    expect(read(`name: "Say \\"when\\" \\\\ now"\n${legacyLayout('Night', NIGHT)}`).name).toBe('Say "when" \\ now')
+    expect(read(`name: 'It''s night'\n${legacyLayout('Night', NIGHT)}`).name).toBe("It's night")
+    expect(read(legacyLayout('Night', NIGHT).replace('scheme: "Night"', 'author: "x"')).name).toBe('')
+  })
+
+  it('reads name and variant at the top level only', () => {
+    const text = `${currentLayout('Night', NIGHT)}  name: "nested"\n  variant: "light"\n`
+    const s = read(text)
+    expect(s.name).toBe('Night')
+    expect(s.variantFrom).toBe('detected')
+  })
+
+  it('marks a scheme base24 when it carries base10–base17, and reads its first sixteen as base16', () => {
+    const extra = ['10', '11', '12', '13', '14', '15', '16', '17'].map((k) => `  base${k}: "#000000"`)
+    const s = read(`${currentLayout('Night', NIGHT, 'dark')}${extra.join('\n')}\n`)
+    expect(s.base24).toBe(true)
+    expect(s.colours).toEqual(keyed(NIGHT))
+  })
+})
+
+describe('readScheme — errors, each naming its key (spec §4.2)', () => {
+  it('names every missing key', () => {
+    expect(errors(withLine('03', null).replace(/base0C:.*\n/, ''))).toEqual(['base03 is missing', 'base0C is missing'])
+  })
+
+  it('names every value that is not a colour, quoting it', () => {
+    expect(errors(withLine('03', 'base03: "#12345"').replace('base07: "f2f0f7"', 'base07: white'))).toEqual([
+      'base03 is not a colour: "#12345"',
+      'base07 is not a colour: "white"',
+    ])
+  })
+
+  it('names a key given twice, whatever the case of its last digit', () => {
+    expect(errors(`${legacyLayout('Night', NIGHT)}base05: "c8c3d8"\nbase0f: "d0a080"\n`)).toEqual([
+      'base05 is given twice',
+      'base0F is given twice',
+    ])
+  })
+
+  it('reads an anchor or an alias as a value that is not a colour', () => {
+    expect(errors(withLine('05', 'base05: *fg'))).toEqual(['base05 is not a colour: "*fg"'])
+    expect(errors(withLine('05', 'base05: &fg "c8c3d8"'))).toEqual(['base05 is not a colour: "&fg \\"c8c3d8\\""'])
+  })
+
+  it('says one thing of text with no base16 colour in it: empty, TOML, JSON or a flow mapping', () => {
+    const toml = 'name = "Night"\n[palette]\nbase00 = "#1f1d2b"\nbase01 = "#2b2838"\n'
+    const json = JSON.stringify({ name: 'Night', palette: keyed(NIGHT) }, null, 2)
+    const flow = `name: Night\npalette: {base00: "1f1d2b", base01: "2b2838"}\n`
+    for (const text of ['', toml, json, flow]) expect(errors(text)).toEqual(['no base16 colours found'])
+  })
+})
+
+describe('the variant (spec §4.4)', () => {
+  it('is dark when base00 is darker than base05, and light otherwise', () => {
+    expect(detectVariant(keyed(NIGHT) as Scheme['colours'])).toBe('dark')
+    expect(detectVariant(keyed(DAY) as Scheme['colours'])).toBe('light')
+    expect(read(legacyLayout('Night', NIGHT)).variant).toBe('dark')
+  })
+
+  it('is what the file says when that is light or dark, in any case, over what the colours say', () => {
+    const s = read(currentLayout('Night', NIGHT, 'Light'))
+    expect(s.variant).toBe('light')
+    expect(s.variantFrom).toBe('file')
+  })
+
+  it('is detected when the file says anything else', () => {
+    const s = read(currentLayout('Day', DAY, 'dim'))
+    expect(s.variant).toBe('light')
+    expect(s.variantFrom).toBe('detected')
+  })
+})
+
+describe('the mapping (spec §5.1)', () => {
+  it('gives every token the scheme colour the table names', () => {
+    expect(BASE16_MAPPING).toEqual({
+      bg: 'base00',
+      'on-accent': 'base00',
+      'bg-raised': 'base01',
+      'bg-chrome': 'base01',
+      rule: 'base02',
+      'fg-dim': 'base04',
+      'tok-neutral': 'base04',
+      'tok-punct': 'base04',
+      fg: 'base05',
+      'tok-ident': 'base05',
+      'focus-ring': 'base05',
+      error: 'base08',
+      'tok-nat': 'base09',
+      'tok-bool': 'base09',
+      warn: 'base0A',
+      'tok-binder': 'base0B',
+      'tok-operator': 'base0C',
+      accent: 'base0E',
+      'tok-keyword': 'base0E',
+    })
+  })
+
+  it('maps a scheme onto every token', () => {
+    const v = mapScheme(read(legacyLayout('Night', NIGHT)).colours)
+    expect(Object.keys(v).sort()).toEqual([...COLOUR_TOKENS].sort())
+    expect([v.bg, v['bg-raised'], v.fg, v.error, v['tok-binder']]).toEqual([
+      '#1f1d2b',
+      '#2b2838',
+      '#c8c3d8',
+      '#e8707a',
+      '#90d090',
+    ])
+  })
+})
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  no tests
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=2
diff --git a/web/src/base16.ts b/web/src/base16.ts
new file mode 100644
index 0000000..df5b285
--- /dev/null
+++ b/web/src/base16.ts
@@ -0,0 +1,197 @@
+import { relativeLuminance } from './contrast'
+import { COLOUR_TOKENS, type ColourToken, type Variant } from './palettes'
+
+/**
+ * A published base16 colour scheme, read from the YAML its authors publish (Plan 7 part 6b spec §4), and mapped
+ * onto the palette's tokens (§5.1).
+ *
+ * **NO YAML LIBRARY, AND THE READER SAYS WHAT IT READS.** tinted-theming's styling guide and builder spec define two
+ * layouts: the legacy one, with `scheme` and `base00`–`base0F` at the top level, and the current one, with `name`,
+ * `variant` and the colours under `palette:`. Both are flat `key: value` lines, and the reader is a line reader for
+ * that shape: every `base00`–`base0F` line at any indentation, and `name`, `scheme` and `variant` at none. What it
+ * does not read — flow mappings, anchors and aliases, several documents, quoted keys, a block scalar as a colour —
+ * none of the published files the spec surveyed uses for a colour, and each reads as an error rather than as a
+ * wrong colour.
+ */
+
+/** The sixteen colours of a base16 scheme, in the styling guide's order. */
+export const BASE16_KEYS = [
+  'base00',
+  'base01',
+  'base02',
+  'base03',
+  'base04',
+  'base05',
+  'base06',
+  'base07',
+  'base08',
+  'base09',
+  'base0A',
+  'base0B',
+  'base0C',
+  'base0D',
+  'base0E',
+  'base0F',
+] as const
+
+export type Base16Key = (typeof BASE16_KEYS)[number]
+
+/** Which half of a palette a scheme fills: its own appearance. */
+export type SchemeVariant = 'light' | 'dark'
+
+export type Scheme = {
+  /** `''` when the scheme names none; shown as `untitled`. */
+  readonly name: string
+  /** Each of the sixteen as lowercase `#rrggbb`, the one form `contrast.ts` and the pre-paint cache accept. */
+  readonly colours: Readonly<Record<Base16Key, string>>
+  readonly variant: SchemeVariant
+  /** Whether `variant:` said so, or the colours' luminance did (spec §4.4). */
+  readonly variantFrom: 'file' | 'detected'
+  /** Whether it carried any of base24's `base10`–`base17`, which are read past and not used. */
+  readonly base24: boolean
+}
+
+export type SchemeReading =
+  | { readonly ok: true; readonly scheme: Scheme }
+  | { readonly ok: false; readonly errors: readonly string[] }
+
+/**
+ * A YAML scalar's text: double-quoted with `\"` and `\\` unescaped, single-quoted with `''` read as `'`, or bare, up
+ * to the first `#` that follows whitespace. Anything after a closing quote is ignored.
+ */
+function scalar(rest: string): string {
+  const s = rest.trimStart()
+  if (s.startsWith('"')) {
+    let out = ''
+    for (let i = 1; i < s.length; i++) {
+      const c = s[i]
+      if (c === '\\' && (s[i + 1] === '"' || s[i + 1] === '\\')) {
+        out += s[++i]
+        continue
+      }
+      if (c === '"') return out
+      out += c
+    }
+    return out
+  }
+  if (s.startsWith("'")) {
+    let out = ''
+    for (let i = 1; i < s.length; i++) {
+      if (s[i] === "'" && s[i + 1] === "'") {
+        out += "'"
+        i++
+        continue
+      }
+      if (s[i] === "'") return out
+      out += s[i]
+    }
+    return out
+  }
+  const cut = /\s#/.exec(s)
+  return (cut === null ? s : s.slice(0, cut.index)).trim()
+}
+
+/**
+ * Read a scheme, or say everything that is wrong with the text, each error naming its key.
+ *
+ * **A BARE `#rrggbb` IS A COLOUR HERE, WHERE YAML READS AN EMPTY VALUE AND A COMMENT** (spec §3 row 12): no one
+ * writing `base00: #1d2021` means a comment, and none of the published files writes one, so the difference never
+ * changes how a published scheme reads.
+ */
+export function readScheme(text: string): SchemeReading {
+  const raw = new Map<Base16Key, string>()
+  const errors: string[] = []
+  const top = new Map<string, string>()
+  let base24 = false
+  for (const line of text.split(/\r?\n/)) {
+    const m = /^([ \t]*)([A-Za-z0-9_]+)[ \t]*:(.*)$/.exec(line)
+    if (m === null) continue
+    const indent = m[1] ?? ''
+    const key = m[2] ?? ''
+    const rest = m[3] ?? ''
+    const colour = /^base0([0-9a-fA-F])$/.exec(key)
+    if (colour !== null) {
+      const k = `base0${(colour[1] ?? '').toUpperCase()}` as Base16Key
+      if (raw.has(k)) errors.push(`${k} is given twice`)
+      else raw.set(k, scalar(rest))
+      continue
+    }
+    if (/^base1[0-7]$/.test(key)) {
+      base24 = true
+      continue
+    }
+    if (indent === '' && (key === 'name' || key === 'scheme' || key === 'variant') && !top.has(key)) {
+      top.set(key, scalar(rest))
+    }
+  }
+  if (raw.size === 0) return { ok: false, errors: ['no base16 colours found'] }
+  const colours: Partial<Record<Base16Key, string>> = {}
+  for (const k of BASE16_KEYS) {
+    const value = raw.get(k)
+    if (value === undefined) {
+      errors.push(`${k} is missing`)
+      continue
+    }
+    const hex = /^#?([0-9a-fA-F]{6})$/.exec(value)
+    if (hex === null) errors.push(`${k} is not a colour: ${JSON.stringify(value)}`)
+    else colours[k] = `#${(hex[1] ?? '').toLowerCase()}`
+  }
+  if (errors.length > 0) return { ok: false, errors }
+  const full = colours as Record<Base16Key, string>
+  const stated = top.get('variant')?.toLowerCase()
+  const fromFile = stated === 'light' || stated === 'dark'
+  return {
+    ok: true,
+    scheme: {
+      name: top.get('name') ?? top.get('scheme') ?? '',
+      colours: full,
+      variant: fromFile ? stated : detectVariant(full),
+      variantFrom: fromFile ? 'file' : 'detected',
+      base24,
+    },
+  }
+}
+
+/**
+ * The half a scheme fills when its file does not say: dark when its default background, base00, is darker than its
+ * default foreground, base05, by relative luminance (spec §4.4). It agrees with every stated variant the spec
+ * measured but one, whose base00 is a bright pink under `variant: light`.
+ */
+export function detectVariant(colours: Readonly<Record<Base16Key, string>>): SchemeVariant {
+  return relativeLuminance(colours.base00) < relativeLuminance(colours.base05) ? 'dark' : 'light'
+}
+
+/**
+ * Which scheme colour each token takes (spec §5.1). It mirrors how the built-ins reuse colours — `tok-ident` and
+ * `focus-ring` are `fg`, `tok-neutral` is `fg-dim`, `accent` is `tok-keyword`, `tok-nat` is `tok-bool` — and follows
+ * the styling guide's roles: base00 the default background, base01 the lighter one status bars use, base02 the
+ * selection, base04 and base05 the dark and default foregrounds, base08 red, base09 orange for numbers and booleans,
+ * base0A yellow, base0B green, base0C cyan, base0E magenta for keywords. base03, base06, base07, base0D and base0F
+ * are not used.
+ */
+export const BASE16_MAPPING: Readonly<Record<ColourToken, Base16Key>> = {
+  bg: 'base00',
+  'on-accent': 'base00',
+  'bg-raised': 'base01',
+  'bg-chrome': 'base01',
+  rule: 'base02',
+  'fg-dim': 'base04',
+  'tok-neutral': 'base04',
+  'tok-punct': 'base04',
+  fg: 'base05',
+  'tok-ident': 'base05',
+  'focus-ring': 'base05',
+  error: 'base08',
+  'tok-nat': 'base09',
+  'tok-bool': 'base09',
+  warn: 'base0A',
+  'tok-binder': 'base0B',
+  'tok-operator': 'base0C',
+  accent: 'base0E',
+  'tok-keyword': 'base0E',
+}
+
+/** A scheme's colours as a palette variant, every token from `BASE16_MAPPING`. */
+export function mapScheme(colours: Readonly<Record<Base16Key, string>>): Variant {
+  return Object.fromEntries(COLOUR_TOKENS.map((t) => [t, colours[BASE16_MAPPING[t]]])) as Record<ColourToken, string>
+}
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  54 passed (54)
Tests  787 passed (787)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command; after each, `git status` shows only this task's changes). In the replay, 12 of 12 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | the reader's `#` strip removed — `src/base16.ts`: `const hex = /^#?([0-9a-fA-F]{6})$/.exec(value)` → `const hex = /^([0-9a-fA-F]{6})$/.exec(value)` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > readScheme — the two published layouts (Plan 7 part 6b spec §4.1) > marks a scheme base24 when it carries base10–base17, and reads its first sixteen as base16`, `tests/node/base16.test.ts > readScheme — the two published layouts (Plan 7 part 6b spec §4.1) > reads a bare #rrggbb as that colour, where YAML reads a comment`, `tests/node/base16.test.ts > readScheme — the two published layouts (Plan 7 part 6b spec §4.1) > reads a colour with or without #, in double, single or no quotes, in either case, as lowercase #rrggbb`, `tests/node/base16.test.ts > readScheme — the two published layouts (Plan 7 part 6b spec §4.1) > reads name and variant at the top level only`, `tests/node/base16.test.ts > readScheme — the two published layouts (Plan 7 part 6b spec §4.1) > reads the current layout: name, variant, and the colours under palette:`, `tests/node/base16.test.ts > the variant (spec §4.4) > is detected when the file says anything else`, `tests/node/base16.test.ts > the variant (spec §4.4) > is what the file says when that is light or dark, in any case, over what the colours say` |
| 2 | the variant rule inverted — `src/base16.ts`: `return relativeLuminance(colours.base00) < relativeLuminance(colours.base05) ? 'dark' : 'light'` → `return relativeLuminance(colours.base00) > relativeLuminance(colours.base05) ? 'dark' : 'light'` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > readScheme — the two published layouts (Plan 7 part 6b spec §4.1) > reads the legacy layout: scheme, and the colours at the top level as bare hex`, `tests/node/base16.test.ts > the variant (spec §4.4) > is dark when base00 is darker than base05, and light otherwise`, `tests/node/base16.test.ts > the variant (spec §4.4) > is detected when the file says anything else` |
| 3 | two mapping rows swapped, `error` and `warn` — `src/base16.ts`: `error: 'base08', ⏎ 'tok-nat': 'base09', ⏎ 'tok-bool': 'base09', ⏎ warn: 'base0A',` → `error: 'base0A', ⏎ 'tok-nat': 'base09', ⏎ 'tok-bool': 'base09', ⏎ warn: 'base08',` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the mapping (spec §5.1) > gives every token the scheme colour the table names`, `tests/node/base16.test.ts > the mapping (spec §5.1) > maps a scheme onto every token` |
| 4 | a name or variant read at any indentation — `src/base16.ts`: `if (indent === '' && (key === 'name'` → `if ((key === 'name'` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > readScheme — the two published layouts (Plan 7 part 6b spec §4.1) > reads name and variant at the top level only` |
| 5 | a double-quoted value not unescaped — `src/base16.ts`: `if (c === '\\' && (s[i + 1] === '"' \|\| s[i + 1] === '\\')) {` → `if (c === '') {` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > readScheme — the two published layouts (Plan 7 part 6b spec §4.1) > reads name over scheme, and unescapes a quoted one` |
| 6 | a single-quoted `''` not read as `'` — `src/base16.ts`: `if (s[i] === "'" && s[i + 1] === "'") {` → `if (s[i] === '') {` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > readScheme — the two published layouts (Plan 7 part 6b spec §4.1) > reads name over scheme, and unescapes a quoted one` |
| 7 | a bare value's trailing comment not cut — `src/base16.ts`: `const cut = /\s#/.exec(s)` → `const cut = /\s#$^/.exec(s)` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > readScheme — the two published layouts (Plan 7 part 6b spec §4.1) > skips full-line, tab-led and trailing comments` |
| 8 | a key given twice read over the first, not named — `src/base16.ts`: `` if (raw.has(k)) errors.push(`${k} is given twice`) ⏎ else raw.set(k, scalar(rest)) `` → `raw.set(k, scalar(rest))` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > readScheme — errors, each naming its key (spec §4.2) > names a key given twice, whatever the case of its last digit` |
| 9 | a key's last digit kept in its own case — `src/base16.ts`: `(colour[1] ?? '').toUpperCase()` → `(colour[1] ?? '')` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > readScheme — errors, each naming its key (spec §4.2) > names a key given twice, whatever the case of its last digit`, `tests/node/base16.test.ts > readScheme — the two published layouts (Plan 7 part 6b spec §4.1) > reads the last digit of a key in either case` |
| 10 | base24's keys not marked — `src/base16.ts`: `base24 = true` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > readScheme — the two published layouts (Plan 7 part 6b spec §4.1) > marks a scheme base24 when it carries base10–base17, and reads its first sixteen as base16` |
| 11 | text with no colour key reads as sixteen missing keys — `src/base16.ts`: `if (raw.size === 0) return { ok: false, errors: ['no base16 colours found'] }` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > readScheme — errors, each naming its key (spec §4.2) > says one thing of text with no base16 colour in it: empty, TOML, JSON or a flow mapping` |
| 12 | `variant:` never read — `src/base16.ts`: `const fromFile = stated === 'light' \|\| stated === 'dark'` → `const fromFile = false` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > readScheme — the two published layouts (Plan 7 part 6b spec §4.1) > reads the current layout: name, variant, and the colours under palette:`, `tests/node/base16.test.ts > the variant (spec §4.4) > is what the file says when that is light or dark, in any case, over what the colours say` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
A base16 scheme is read from either published layout, its variant found, and its colours mapped onto the tokens

`base16.ts`'s `readScheme` reads the YAML tinted-theming publishes
without a YAML library (Plan 7 part 6b spec §4): every `base00`–`base0F`
line at any indentation, and `name`, `scheme` and `variant` at none,
so the legacy layout and the current one's `palette:` both read. A
value may be quoted either way or bare, with or without `#`, in either
case, and a bare `#rrggbb` is a colour. Every error names its key, and
text with no colour line — TOML, JSON, a flow mapping, nothing — says
"no base16 colours found". `variant:` wins when it is light or dark;
otherwise base00 darker than base05 is dark. `BASE16_MAPPING` gives
all 19 tokens a scheme colour (§5.1). The fixtures are schemes written
for the tests.
````

---

### Task 3: `apply adjusted`'s adjustment: each failing foreground moves in OKLCH lightness, its hue kept, just far enough

**Files:**
- Create: `web/src/base16-adjust.ts` (`Oklch`, `hexToOklch`, `oklchToHex`, `Moved`, `Unfixed`, `Adjustment`, `adjustVariant`)
- Modify (tests): `web/tests/node/base16-fixtures.ts` (`EMBER`, `NEON`, `TWINS`)
- Test: `web/tests/node/base16-adjust.test.ts`

**Interfaces:**
- Consumes Task 1's `CONTRAST_FLOORS`, `binderClashes` and `contrastRatio`; its tests, Task 2's `mapScheme`.
- Produces `adjustVariant(imported: Variant): Adjustment`, where `Adjustment` is `{ tokens: Variant; moved: readonly { token: ColourToken; from: string; to: string }[]; unfixed: readonly { token: ColourToken; rule: 'floors' | 'binder' }[] }`; `hexToOklch(hex: string): Oklch` and `oklchToHex(c: Oklch): string`, where `Oklch` is `{ L: number; C: number; h: number /* radians */ }`. Task 4's check runs it.

**THE FLOORS DO NOT CHANGE; THE SCHEME DOES, BY AS LITTLE AS IT CAN** (spec §6). Lightness moves in OKLCH, by Björn Ottosson's published matrices, so a step is a similar visible step whatever the hue and the hue angle holds the perceived hue (§6.1). A colour outside sRGB loses chroma by bisection, at its lightness and hue, and is rounded to `#rrggbb`.

**THE WALK** (§6.2): from the token's own lightness, in each direction, steps of 0.01 until one passes or lightness runs out, then 16 halvings between that step and the one before, keeping the passing end; the nearer direction wins. **`ok` IS ASKED OF THE ROUNDED `#rrggbb`**, so the value stored is the value that passed. **THE ORDER** (§6.3): every foreground whose floors are against surfaces, then `on-accent` against the accent the first pass ended with, then `tok-binder` if it clashes, until it meets its floors and stands 24 from every other token's final value. **A TOKEN NO LIGHTNESS FIXES** keeps its imported value and is named, and the rest are still adjusted (§6.4).

**NO SURFACE MOVES** because no surface is ever a floor's foreground, so none is walked. See Pre-flight, "What the prototype found" 2 and 3, for the two §13 sabotages this task could not write as the spec words them, and what its table aims at instead.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=3
diff --git a/web/tests/node/base16-adjust.test.ts b/web/tests/node/base16-adjust.test.ts
new file mode 100644
index 0000000..24e9960
--- /dev/null
+++ b/web/tests/node/base16-adjust.test.ts
@@ -0,0 +1,157 @@
+import { describe, expect, it } from 'vitest'
+import { mapScheme, type Scheme } from '../../src/base16'
+import { adjustVariant, hexToOklch, oklchToHex } from '../../src/base16-adjust'
+import { binderClashes, CONTRAST_FLOORS, contrastRatio } from '../../src/contrast'
+import type { ColourToken, Variant } from '../../src/palettes'
+import { EMBER, keyed, NEON, NIGHT, TWINS } from './base16-fixtures'
+
+/**
+ * `apply adjusted` (Plan 7 part 6b spec §6), on schemes written for the tests: `EMBER` fails 17 floors and every one
+ * can be fixed, `TWINS` passes every floor with its binder too close to its operators, and `NEON`'s base01 is a
+ * bright green no text colour meets 4.5 on beside a dark base00.
+ */
+
+const mapped = (colours: readonly string[]): Variant => mapScheme(keyed(colours) as Scheme['colours'])
+
+/** Every floor `v` fails, as `fg on bg`. */
+const failing = (v: Variant): string[] =>
+  CONTRAST_FLOORS.filter(([fg, bg, floor]) => contrastRatio(v[fg], v[bg]) < floor).map(([fg, bg]) => `${fg} on ${bg}`)
+
+/** Whether `hex`, as token `t` in `v`, meets every floor `t` has and, for `tok-binder`, stands apart. */
+const holds = (v: Variant, t: ColourToken, hex: string): boolean =>
+  CONTRAST_FLOORS.every(([fg, bg, floor]) => fg !== t || contrastRatio(hex, v[bg]) >= floor) &&
+  (t !== 'tok-binder' || binderClashes({ ...v, [t]: hex }).length === 0)
+
+const SURFACES = ['bg', 'bg-raised', 'bg-chrome', 'rule'] as const
+
+const degrees = (radians: number): number => {
+  const d = Math.abs((radians * 180) / Math.PI) % 360
+  return d > 180 ? 360 - d : d
+}
+
+describe('OKLCH (spec §6.1)', () => {
+  // CSS Color 4's own worked value for sRGB red, `oklch(62.8% 0.2577 29.23)`, rather than one this module computed.
+  it('gives the published value for sRGB red', () => {
+    const red = hexToOklch('#ff0000')
+    expect(red.L).toBeCloseTo(0.628, 3)
+    expect(red.C).toBeCloseTo(0.2577, 3)
+    expect(degrees(red.h)).toBeCloseTo(29.23, 1)
+  })
+
+  it('gives back every fixture colour it is given', () => {
+    for (const hex of [...NIGHT, ...EMBER, ...NEON]) expect(oklchToHex(hexToOklch(hex))).toBe(hex)
+  })
+
+  it('brings a colour outside sRGB inside by reducing its chroma, its lightness and hue kept', () => {
+    const wanted = { L: 0.9, C: 0.3, h: hexToOklch('#ff0000').h }
+    const got = hexToOklch(oklchToHex(wanted))
+    expect(got.C).toBeLessThan(0.1)
+    expect(got.L).toBeCloseTo(0.9, 2)
+    expect(degrees(got.h - wanted.h)).toBeLessThan(4)
+  })
+})
+
+describe('adjustVariant (spec §6.2–§6.4)', () => {
+  it('meets every floor and the binder rule, on the values it would store', () => {
+    expect(failing(mapped(EMBER)).length).toBe(17)
+    for (const colours of [EMBER, TWINS]) {
+      const { tokens } = adjustVariant(mapped(colours))
+      expect(failing(tokens)).toEqual([])
+      expect(binderClashes(tokens)).toEqual([])
+    }
+  })
+
+  it('moves no surface', () => {
+    for (const colours of [EMBER, TWINS, NEON]) {
+      const v = mapped(colours)
+      const { tokens } = adjustVariant(v)
+      for (const s of SURFACES) expect(tokens[s], s).toBe(v[s])
+    }
+  })
+
+  it("keeps each moved colour's hue within 4° of its own", () => {
+    let seen = 0
+    for (const colours of [EMBER, TWINS, NEON]) {
+      for (const m of adjustVariant(mapped(colours)).moved) {
+        const [from, to] = [hexToOklch(m.from), hexToOklch(m.to)]
+        // A near-grey's hue is noise: 0.03 of chroma is where the spec's measurement drew the line.
+        if (from.C < 0.03 || to.C < 0.03) continue
+        seen++
+        expect(degrees(to.h - from.h), `${m.token} ${m.from} → ${m.to}`).toBeLessThan(4)
+      }
+    }
+    expect(seen).toBeGreaterThan(8)
+  })
+
+  it('moves each colour just enough: a lightness 0.005 nearer its own fails', () => {
+    for (const colours of [EMBER, TWINS]) {
+      const v = mapped(colours)
+      const { tokens, moved } = adjustVariant(v)
+      expect(moved.length).toBeGreaterThan(0)
+      for (const m of moved) {
+        const from = hexToOklch(m.from)
+        const L = hexToOklch(m.to).L
+        const nearer = oklchToHex({ ...from, L: L - Math.sign(L - from.L) * 0.005 })
+        expect(holds(tokens, m.token, m.to), `${m.token} at ${m.to}`).toBe(true)
+        expect(holds(tokens, m.token, nearer), `${m.token} at ${nearer}, nearer ${m.from}`).toBe(false)
+      }
+    }
+  })
+
+  it('moves each token alone, so tokens from one scheme colour can end apart', () => {
+    const { tokens, moved } = adjustVariant(mapped(EMBER))
+    expect(moved.map((m) => m.token)).toEqual([
+      'fg',
+      'fg-dim',
+      'accent',
+      'error',
+      'tok-neutral',
+      'tok-keyword',
+      'tok-ident',
+      'tok-punct',
+    ])
+    // `focus-ring` shares base05 with `fg`, and its 3:1 floors already held.
+    expect(tokens['focus-ring']).toBe(EMBER[5])
+    expect(tokens.fg).not.toBe(EMBER[5])
+  })
+
+  it('checks on-accent against the accent the first pass ended with, so it need not move', () => {
+    const v = mapped(EMBER)
+    expect(contrastRatio(v['on-accent'], v.accent)).toBeLessThan(4.5)
+    const { tokens } = adjustVariant(v)
+    expect(tokens['on-accent']).toBe(v['on-accent'])
+    expect(contrastRatio(tokens['on-accent'], tokens.accent)).toBeGreaterThanOrEqual(4.5)
+  })
+
+  it('moves a binder that sits too close the shorter way, until it stands apart', () => {
+    const v = mapped(TWINS)
+    expect(binderClashes(v)).toEqual([{ token: 'tok-operator', apart: 16 }])
+    expect(adjustVariant(v).moved).toEqual([{ token: 'tok-binder', from: '#78c8b8', to: '#70c0b0' }])
+  })
+
+  it('keeps each token no lightness can fix at its own value, adjusts the rest, and names what is left', () => {
+    const v = mapped(NEON)
+    const { tokens, moved, unfixed } = adjustVariant(v)
+    expect(unfixed.map((u) => `${u.token} ${u.rule}`)).toEqual([
+      'fg floors',
+      'fg-dim floors',
+      'accent floors',
+      'error floors',
+      'tok-neutral floors',
+      'tok-keyword floors',
+      'tok-ident floors',
+      'tok-nat floors',
+      'tok-bool floors',
+      'tok-operator floors',
+      'tok-punct floors',
+      'tok-binder floors',
+    ])
+    for (const u of unfixed) expect(tokens[u.token], u.token).toBe(v[u.token])
+    expect(moved.map((m) => m.token)).toEqual(['focus-ring', 'warn'])
+    expect(failing(tokens).filter((f) => f.startsWith('focus-ring') || f.startsWith('warn'))).toEqual([])
+  })
+
+  it('moves nothing in a scheme that passes', () => {
+    expect(adjustVariant(mapped(NIGHT))).toEqual({ tokens: mapped(NIGHT), moved: [], unfixed: [] })
+  })
+})
diff --git a/web/tests/node/base16-fixtures.ts b/web/tests/node/base16-fixtures.ts
index 6e5126c..0361c8f 100644
--- a/web/tests/node/base16-fixtures.ts
+++ b/web/tests/node/base16-fixtures.ts
@@ -44,6 +44,49 @@ export const DAY = [
   '#7a4a30',
 ] as const
 
+/** Fails 17 of the 35 floors, on base00 and base01, and every one is fixed by moving four colours' lightness. Dark. */
+export const EMBER = [
+  '#1c1a22',
+  '#2c2833',
+  '#3a3544',
+  '#57506a',
+  '#7e7590',
+  '#8a829a',
+  '#d8d0e2',
+  '#f0ecf4',
+  '#c06070',
+  '#d09a70',
+  '#d8b870',
+  '#88c088',
+  '#70c0c0',
+  '#80a0e0',
+  '#9070a0',
+  '#c09070',
+] as const
+
+/** Its base01 is a bright green rather than a second background, so no text colour meets 4.5 on it and on base00. */
+export const NEON = [
+  '#121216',
+  '#88e040',
+  '#3a3a44',
+  '#5a5a66',
+  '#c0c0cc',
+  '#e0e0ea',
+  '#f0f0f6',
+  '#ffffff',
+  '#f07080',
+  '#f0a070',
+  '#f0d070',
+  '#90e090',
+  '#70e0e0',
+  '#80b0f0',
+  '#d0a0f0',
+  '#d0a080',
+] as const
+
+/** `NIGHT` with its binder, base0B, 16 from its operators, base0C, in the blue channel. */
+export const TWINS = NIGHT.map((c, i) => (i === 11 ? '#78c8b8' : c))
+
 const KEYS = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '0A', '0B', '0C', '0D', '0E', '0F']
 
 /** A scheme in the current layout: `system`, `name`, `variant` if given, and each colour quoted, with `#`, under `palette:`. */
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/base16-adjust.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  no tests
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=3
diff --git a/web/src/base16-adjust.ts b/web/src/base16-adjust.ts
new file mode 100644
index 0000000..d56f89e
--- /dev/null
+++ b/web/src/base16-adjust.ts
@@ -0,0 +1,171 @@
+import { binderClashes, CONTRAST_FLOORS, contrastRatio } from './contrast'
+import { COLOUR_TOKENS, type ColourToken, type Variant } from './palettes'
+
+/**
+ * `apply adjusted` (Plan 7 part 6b spec §6): THE FLOORS DO NOT CHANGE; THE SCHEME DOES, BY AS LITTLE AS IT CAN. Each
+ * foreground token that fails a floor has its lightness moved, its hue kept, until it meets every floor it has; then
+ * `tok-binder` moves the same way if it sits too close to another token. No surface moves — `bg`, `bg-raised`,
+ * `bg-chrome` and `rule` are never a floor's foreground, so none is ever walked.
+ *
+ * **LIGHTNESS MOVES IN OKLCH**, Björn Ottosson's OKLab in lightness, chroma and hue, by his published matrices. Its
+ * `L` is perceptual, so a step of `L` is a similar visible step whatever the hue, which HSL's lightness is not; and
+ * holding its hue angle holds the perceived hue, where CIELab's drifts toward purple in blue. CSS Color 4 gamut-maps
+ * in it for the same reasons.
+ */
+
+/** A colour in OKLCH: lightness from 0 to 1, chroma, and hue in radians. */
+export type Oklch = { readonly L: number; readonly C: number; readonly h: number }
+
+const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
+const fromLinear = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
+
+/** A `#rrggbb` colour in OKLCH. */
+export function hexToOklch(hex: string): Oklch {
+  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255))
+  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
+  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
+  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
+  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
+  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
+  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
+  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) }
+}
+
+/** Linear sRGB, unclamped: a channel outside 0 to 1 is a colour sRGB cannot show. */
+function linearOf({ L, C, h }: Oklch): [number, number, number] {
+  const A = C * Math.cos(h)
+  const B = C * Math.sin(h)
+  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
+  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
+  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
+  return [
+    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
+    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
+    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
+  ]
+}
+
+const inGamut = (rgb: readonly number[]): boolean => rgb.every((c) => c >= -1e-6 && c <= 1 + 1e-6)
+
+/**
+ * The `#rrggbb` nearest `c`: where `c` is outside sRGB, its chroma is reduced by bisection, at the same lightness
+ * and hue, to the largest that is inside, and the result is rounded to eight bits a channel.
+ */
+export function oklchToHex(c: Oklch): string {
+  let rgb = linearOf(c)
+  if (!inGamut(rgb)) {
+    let lo = 0
+    let hi = c.C
+    for (let i = 0; i < 24; i++) {
+      const mid = (lo + hi) / 2
+      if (inGamut(linearOf({ ...c, C: mid }))) lo = mid
+      else hi = mid
+    }
+    rgb = linearOf({ ...c, C: lo })
+  }
+  const byte = (v: number): string =>
+    Math.round(fromLinear(Math.min(1, Math.max(0, v))) * 255)
+      .toString(16)
+      .padStart(2, '0')
+  return `#${rgb.map(byte).join('')}`
+}
+
+/** How far the walk moves lightness at a time, and how many halvings then find the edge. */
+const STEP = 0.01
+const BISECTIONS = 16
+
+/**
+ * The colour nearest `from` in lightness, its hue kept, for which `ok` holds — or `null` when no lightness does
+ * (spec §6.2).
+ *
+ * **`ok` IS ASKED OF THE ROUNDED `#rrggbb`**, so the value returned is the value that passed. From `from`'s own `L`,
+ * in each direction, it walks in steps of `STEP` until one passes or `L` reaches 0 or 1, then bisects between that
+ * step and the one before, keeping the passing end; the direction with the smaller change wins. THE WALK COMES FIRST
+ * because `ok` is not monotone from the token's own value when its surfaces sit on both sides of it — contrast with
+ * one rises as contrast with the other falls — and the first region where it holds is the nearest.
+ */
+function nearestLightness(from: Oklch, ok: (hex: string) => boolean): string | null {
+  let best: { readonly hex: string; readonly dL: number } | null = null
+  for (const dir of [1, -1]) {
+    const room = dir > 0 ? 1 - from.L : from.L
+    const at = (d: number): string => oklchToHex({ ...from, L: from.L + dir * d })
+    let prev = 0
+    for (let k = 1; ; k++) {
+      const d = Math.min(k * STEP, room)
+      if (ok(at(d))) {
+        let lo = prev
+        let hi = d
+        for (let i = 0; i < BISECTIONS; i++) {
+          const mid = (lo + hi) / 2
+          if (ok(at(mid))) hi = mid
+          else lo = mid
+        }
+        if (best === null || hi < best.dL) best = { hex: at(hi), dL: hi }
+        break
+      }
+      prev = d
+      if (d >= room) break
+    }
+  }
+  return best?.hex ?? null
+}
+
+/** A token the adjustment moved: its imported value and the value applied. */
+export type Moved = { readonly token: ColourToken; readonly from: string; readonly to: string }
+
+/** A token no lightness could fix: it keeps its imported value, and still fails its floors or the binder rule. */
+export type Unfixed = { readonly token: ColourToken; readonly rule: 'floors' | 'binder' }
+
+export type Adjustment = {
+  /** Every token as `apply adjusted` applies it. */
+  readonly tokens: Variant
+  readonly moved: readonly Moved[]
+  readonly unfixed: readonly Unfixed[]
+}
+
+/** The surfaces a foreground sits on. No floor has one as its foreground, so none is walked. */
+const SURFACES: readonly ColourToken[] = ['bg', 'bg-raised', 'bg-chrome', 'rule']
+
+const floorsOf = (t: ColourToken) => CONTRAST_FLOORS.filter(([fg]) => fg === t)
+
+/**
+ * Adjust a mapped scheme (spec §6.3).
+ *
+ * - **A token meets all its floors at once**: `ok` is their conjunction.
+ * - **Tokens move independently**, even when they share a scheme colour, so `fg` and `focus-ring`, both base05, can
+ *   end different.
+ * - **The order**: first every foreground whose floors are against surfaces only; then `on-accent`, whose floor is
+ *   against `accent`, checked against the `accent` the first pass ended with.
+ * - **`tok-binder` last**: if it clashes, the same walk runs on it with `ok` = its floors hold and it stands apart
+ *   from every other token's final value.
+ * - **When no lightness passes**, the token keeps its imported value, every other token is still adjusted, and the
+ *   result names it (spec §6.4).
+ */
+export function adjustVariant(imported: Variant): Adjustment {
+  const v: Record<ColourToken, string> = { ...imported }
+  const unfixed: Unfixed[] = []
+  const meets = (t: ColourToken, hex: string): boolean =>
+    floorsOf(t).every(([, bg, floor]) => contrastRatio(hex, v[bg]) >= floor)
+  const onSurfaces = (t: ColourToken): boolean => floorsOf(t).every(([, bg]) => SURFACES.includes(bg))
+  const walked = COLOUR_TOKENS.filter((t) => floorsOf(t).length > 0)
+  for (const t of [...walked.filter(onSurfaces), ...walked.filter((t) => !onSurfaces(t))]) {
+    if (meets(t, v[t])) continue
+    const hex = nearestLightness(hexToOklch(v[t]), (candidate) => meets(t, candidate))
+    if (hex === null) unfixed.push({ token: t, rule: 'floors' })
+    else v[t] = hex
+  }
+  if (binderClashes(v).length > 0) {
+    const hex = nearestLightness(
+      hexToOklch(v['tok-binder']),
+      (candidate) => meets('tok-binder', candidate) && binderClashes({ ...v, 'tok-binder': candidate }).length === 0,
+    )
+    if (hex === null) unfixed.push({ token: 'tok-binder', rule: 'binder' })
+    else v['tok-binder'] = hex
+  }
+  const moved = COLOUR_TOKENS.filter((t) => v[t] !== imported[t]).map((t) => ({
+    token: t,
+    from: imported[t],
+    to: v[t],
+  }))
+  return { tokens: v, moved, unfixed }
+}
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  55 passed (55)
Tests  799 passed (799)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command; after each, `git status` shows only this task's changes). In the replay, 10 of 10 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | the predicate's pass not what is stored: the bisection's failing end kept (for the spec's "evaluated before rounding", see Pre-flight) — `src/base16-adjust.ts`: `if (best === null \|\| hi < best.dL) best = { hex: at(hi), dL: hi }` → `if (best === null \|\| hi < best.dL) best = { hex: at(lo), dL: hi }` | `cd web && pnpm exec vitest run --project node tests/node/base16-adjust.test.ts` | `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > keeps each token no lightness can fix at its own value, adjusts the rest, and names what is left`, `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > meets every floor and the binder rule, on the values it would store`, `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > moves a binder that sits too close the shorter way, until it stands apart`, `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > moves each colour just enough: a lightness 0.005 nearer its own fails` |
| 2 | the adjustment allowed to move a surface: where no lightness passes, the token's panel takes the page's colour — `src/base16-adjust.ts`: `if (hex === null) unfixed.push({ token: t, rule: 'floors' }) ⏎ else v[t] = hex` → `if (hex === null) { ⏎ unfixed.push({ token: t, rule: 'floors' }) ⏎ v['bg-raised'] = v.bg ⏎ } else v[t] = hex` | `cd web && pnpm exec vitest run --project node tests/node/base16-adjust.test.ts` | `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > keeps each token no lightness can fix at its own value, adjusts the rest, and names what is left`, `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > moves no surface` |
| 3 | the hue not kept: every step turned 0.1 rad — `src/base16-adjust.ts`: `const at = (d: number): string => oklchToHex({ ...from, L: from.L + dir * d })` → `const at = (d: number): string => oklchToHex({ ...from, h: from.h + 0.1, L: from.L + dir * d })` | `cd web && pnpm exec vitest run --project node tests/node/base16-adjust.test.ts` | `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > keeps each moved colour's hue within 4° of its own`, `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > moves a binder that sits too close the shorter way, until it stands apart`, `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > moves each colour just enough: a lightness 0.005 nearer its own fails` |
| 4 | not just enough: no bisection, the whole step kept — `src/base16-adjust.ts`: `const BISECTIONS = 16` → `const BISECTIONS = 0` | `cd web && pnpm exec vitest run --project node tests/node/base16-adjust.test.ts` | `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > moves a binder that sits too close the shorter way, until it stands apart`, `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > moves each colour just enough: a lightness 0.005 nearer its own fails` |
| 5 | the longer way wins — `src/base16-adjust.ts`: `if (best === null \|\| hi < best.dL) best` → `if (best === null \|\| hi > best.dL) best` | `cd web && pnpm exec vitest run --project node tests/node/base16-adjust.test.ts` | `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > moves a binder that sits too close the shorter way, until it stands apart` |
| 6 | `on-accent` walked before `accent` — `src/base16-adjust.ts`: `for (const t of [...walked.filter(onSurfaces), ...walked.filter((t) => !onSurfaces(t))]) {` → `for (const t of [...walked.filter((t) => !onSurfaces(t)), ...walked.filter(onSurfaces)]) {` | `cd web && pnpm exec vitest run --project node tests/node/base16-adjust.test.ts` | `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > checks on-accent against the accent the first pass ended with, so it need not move`, `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > moves each colour just enough: a lightness 0.005 nearer its own fails`, `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > moves each token alone, so tokens from one scheme colour can end apart` |
| 7 | `tok-binder` never walked apart — `src/base16-adjust.ts`: `if (binderClashes(v).length > 0) {` → `if (binderClashes(v).length > 99) {` | `cd web && pnpm exec vitest run --project node tests/node/base16-adjust.test.ts` | `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > meets every floor and the binder rule, on the values it would store`, `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > moves a binder that sits too close the shorter way, until it stands apart`, `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > moves each colour just enough: a lightness 0.005 nearer its own fails` |
| 8 | a token no lightness fixes left unnamed — `src/base16-adjust.ts`: `if (hex === null) unfixed.push({ token: t, rule: 'floors' })` → `if (hex === null) continue` | `cd web && pnpm exec vitest run --project node tests/node/base16-adjust.test.ts` | `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > keeps each token no lightness can fix at its own value, adjusts the rest, and names what is left` |
| 9 | a colour outside sRGB clamped, not chroma-reduced — `src/base16-adjust.ts`: `if (!inGamut(rgb)) {` → `if (!inGamut(rgb) && false) {` | `cd web && pnpm exec vitest run --project node tests/node/base16-adjust.test.ts` | `tests/node/base16-adjust.test.ts > OKLCH (spec §6.1) > brings a colour outside sRGB inside by reducing its chroma, its lightness and hue kept` |
| 10 | OKLab's lightness row altered — `src/base16-adjust.ts`: `const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s` → `const L = 0.2 * l + 0.793617785 * m - 0.0040720468 * s` | `cd web && pnpm exec vitest run --project node tests/node/base16-adjust.test.ts` | `tests/node/base16-adjust.test.ts > OKLCH (spec §6.1) > brings a colour outside sRGB inside by reducing its chroma, its lightness and hue kept`, `tests/node/base16-adjust.test.ts > OKLCH (spec §6.1) > gives back every fixture colour it is given`, `tests/node/base16-adjust.test.ts > OKLCH (spec §6.1) > gives the published value for sRGB red`, `tests/node/base16-adjust.test.ts > adjustVariant (spec §6.2–§6.4) > moves each colour just enough: a lightness 0.005 nearer its own fails` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
`apply adjusted`'s adjustment: each failing foreground moves in OKLCH lightness, its hue kept, just far enough

`base16-adjust.ts` (Plan 7 part 6b spec §6) moves every foreground token
that fails a floor by the smallest change of OKLCH lightness that meets
all its floors, asking the rounded `#rrggbb` so the value stored is the
value that passed: a walk in steps of 0.01 each way, then 16 halvings,
the nearer direction winning. `on-accent` is checked against the accent
the first pass ended with, and `tok-binder` last, until it stands apart
from every other token. A colour outside sRGB loses chroma, not
lightness or hue. No surface is ever a floor's foreground, so none
moves; a token no lightness can fix keeps its value and is named.
````

---

### Task 4: The check: a scheme's failures in one line, grouped by scheme colour in words, and what `apply adjusted` would do

**Files:**
- Modify: `web/src/base16.ts` (`FloorFailure`, `SchemeCheck`, `checkScheme`, `passes`, `schemeName`, `summaryLines`, `adjustLine`, `failureLines`, `MovedColour`, `movedColours`, `movedLine`)
- Modify (tests): `web/tests/node/base16-fixtures.ts` (`STUCK`)
- Test: `web/tests/node/base16.test.ts` (its `the check` cases)

**Interfaces:**
- Consumes Task 1's floors and binder rule, Task 2's reader and mapping, Task 3's `adjustVariant`.
- Produces `checkScheme(scheme: Scheme): SchemeCheck` — `{ scheme; tokens: Variant /* as mapped */; failures: readonly FloorFailure[]; clashes: readonly BinderClash[]; adjustment: Adjustment; remaining: readonly FloorFailure[]; remainingClashes: readonly BinderClash[] }`; `passes(check): boolean`; `schemeName(name): string` (`untitled` for `''`); `summaryLines(check): string[]`; `adjustLine(check): string | null` (`null` when it passes); `failureLines(check): string[]`; `movedColours(colours, tokens: Partial<Record<ColourToken, string>>): MovedColour[]` and `movedLine(m): string`. Task 5's select label uses `schemeName`; Task 6's dialog shows the rest; Task 7 reads `movedColours` off a stored half.

**THE SUMMARY IS ONE LINE** (spec §3 row 5 as revised, §5.3): `Ember · dark, detected: 17 of 35 contrast checks below WCAG AA, worst 3.31:1`, or `… every contrast check passes`, with `; binders too close to 1 other colour` for a clash and a second line for base24. **WHAT `apply adjusted` DOES** is one more: how many colours it moves — the lines the details list under *changes* — and whether every check then passes, or what still fails and where no lightness passes.

**THE FAILURES ARE GROUPED BY SCHEME COLOUR PAIR**, in words, the furthest below its floor first: `base08 on base01: error text on panels — 3.53:1, needs 4.5`. One pair of scheme colours is one pair of colours, so a group has one ratio, and its floor is the highest it fails. A ratio is cut, not rounded, to two places, so one just under its floor never prints as the floor. **A CHANGED COLOUR IS ONE LINE PER SCHEME COLOUR AND VALUE** — `base08 #c06070 → #d57382, as error text` — read off the scheme's colours and the tokens applied, so a stored half can show it too.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=4
diff --git a/web/tests/node/base16-fixtures.ts b/web/tests/node/base16-fixtures.ts
index 0361c8f..d2ebce4 100644
--- a/web/tests/node/base16-fixtures.ts
+++ b/web/tests/node/base16-fixtures.ts
@@ -87,6 +87,12 @@ export const NEON = [
 /** `NIGHT` with its binder, base0B, 16 from its operators, base0C, in the blue channel. */
 export const TWINS = NIGHT.map((c, i) => (i === 11 ? '#78c8b8' : c))
 
+/**
+ * Black and white under every foreground's one grey, `#767676`: the only text colours meeting 4.5 on both sit within
+ * a hair of it, so its binder, drawn in the same grey, can be moved nowhere that is both legible and apart.
+ */
+export const STUCK = ['#000000', '#ffffff', ...Array.from({ length: 14 }, () => '#767676')]
+
 const KEYS = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '0A', '0B', '0C', '0D', '0E', '0F']
 
 /** A scheme in the current layout: `system`, `name`, `variant` if given, and each colour quoted, with `#`, under `palette:`. */
diff --git a/web/tests/node/base16.test.ts b/web/tests/node/base16.test.ts
index 0c089a8..b121bd1 100644
--- a/web/tests/node/base16.test.ts
+++ b/web/tests/node/base16.test.ts
@@ -1,7 +1,20 @@
 import { describe, expect, it } from 'vitest'
-import { BASE16_MAPPING, detectVariant, mapScheme, readScheme, type Scheme } from '../../src/base16'
+import {
+  adjustLine,
+  BASE16_MAPPING,
+  checkScheme,
+  detectVariant,
+  failureLines,
+  mapScheme,
+  movedColours,
+  movedLine,
+  passes,
+  readScheme,
+  type Scheme,
+  summaryLines,
+} from '../../src/base16'
 import { COLOUR_TOKENS } from '../../src/palettes'
-import { currentLayout, DAY, keyed, legacyLayout, NIGHT } from './base16-fixtures'
+import { currentLayout, DAY, EMBER, keyed, legacyLayout, NEON, NIGHT, STUCK, TWINS } from './base16-fixtures'
 
 /** The scheme `text` reads as, or a failure naming its errors. */
 function read(text: string): Scheme {
@@ -176,3 +189,90 @@ describe('the mapping (spec §5.1)', () => {
     ])
   })
 })
+
+describe('the check (spec §5.3)', () => {
+  const check = (text: string) => checkScheme(read(text))
+
+  it('says a scheme that passes passes, and offers nothing to adjust', () => {
+    const c = check(currentLayout('Night', NIGHT, 'dark'))
+    expect(passes(c)).toBe(true)
+    expect(summaryLines(c)).toEqual(['Night · dark, from the file: every contrast check passes'])
+    expect(adjustLine(c)).toBeNull()
+    expect(failureLines(c)).toEqual([])
+  })
+
+  it('counts the checks a scheme fails and gives the worst, in one line', () => {
+    const c = check(legacyLayout('Ember', EMBER))
+    expect(passes(c)).toBe(false)
+    expect(summaryLines(c)).toEqual(['Ember · dark, detected: 17 of 35 contrast checks below WCAG AA, worst 3.31:1'])
+  })
+
+  it('lists the failures grouped by scheme colour pair, in words, the furthest below its floor first', () => {
+    expect(failureLines(check(legacyLayout('Ember', EMBER)))).toEqual([
+      'base04 on base01: dim text, plain code and punctuation on panels and headers — 3.31:1, needs 4.5',
+      'base0E on base01: accents and keywords on panels — 3.43:1, needs 4.5',
+      'base08 on base01: error text on panels — 3.53:1, needs 4.5',
+      'base05 on base01: text and names on panels and headers — 3.93:1, needs 4.5',
+      'base04 on base00: dim text, plain code and punctuation on the page — 3.96:1, needs 4.5',
+      'base0E on base00: accents and keywords on the page — 4.10:1, needs 4.5',
+      'base00 on base0E: text on accents — 4.10:1, needs 4.5',
+      'base08 on base00: error text on the page — 4.21:1, needs 4.5',
+    ])
+  })
+
+  it('says what apply adjusted does, one line per colour it moves', () => {
+    const c = check(legacyLayout('Ember', EMBER))
+    expect(adjustLine(c)).toBe('apply adjusted moves 4 colours’ lightness, and every check then passes')
+    expect(movedColours(c.scheme.colours, c.adjustment.tokens).map(movedLine)).toEqual([
+      'base04 #7e7590 → #958ca7, as dim text, plain code and punctuation',
+      'base05 #8a829a → #958ca5, as text and names',
+      'base08 #c06070 → #d57382, as error text',
+      'base0E #9070a0 → #a584b5, as accents and keywords',
+    ])
+  })
+
+  it('says what still fails, and where, when no lightness passes', () => {
+    const c = check(currentLayout('Neon', NEON, 'dark'))
+    // accents fail 4.5 on panels and 3 on headers, one pair of colours: the line gives the floor it misses by most.
+    expect(failureLines(c)).toContain(
+      'base0E on base01: accents and keywords on panels and headers — 1.28:1, needs 4.5',
+    )
+    expect(adjustLine(c)).toBe(
+      'apply adjusted moves 2 colours’ lightness; 16 checks still fail, where no lightness passes on both base00 and base01',
+    )
+  })
+
+  it('names a binder too close to another colour, and says so when no lightness sets it apart', () => {
+    const twins = check(currentLayout('Twins', TWINS, 'dark'))
+    expect(summaryLines(twins)).toEqual([
+      'Twins · dark, from the file: every contrast check passes; binders too close to 1 other colour',
+    ])
+    expect(failureLines(twins)).toEqual(['base0B beside base0C: binders too close to operators — 16 apart, needs 24'])
+    expect(adjustLine(twins)).toBe('apply adjusted moves 1 colour’s lightness, and every check then passes')
+    const stuck = check(legacyLayout('', STUCK))
+    expect(summaryLines(stuck)).toEqual([
+      'untitled · dark, detected: every contrast check passes; binders too close to 8 other colours',
+    ])
+    expect(adjustLine(stuck)).toBe(
+      'apply adjusted moves no colour’s lightness; binders stay too close to 8 other colours, where no lightness sets them apart',
+    )
+  })
+
+  it('notes that a base24 scheme’s eight extra colours are not used', () => {
+    const extra = ['10', '11', '12', '13', '14', '15', '16', '17'].map((k) => `  base${k}: "#000000"`)
+    expect(summaryLines(check(`${currentLayout('Night', NIGHT, 'dark')}${extra.join('\n')}\n`))).toEqual([
+      'Night · dark, from the file: every contrast check passes',
+      'base24: its eight extra colours, base10–base17, are not used',
+    ])
+  })
+
+  it('reads what changed off a scheme’s own colours and the tokens applied, a token left out included', () => {
+    const colours = keyed(EMBER) as Scheme['colours']
+    const { tokens } = checkScheme(read(legacyLayout('Ember', EMBER))).adjustment
+    const { fg, error, 'focus-ring': ring } = tokens
+    expect(movedColours(colours, { fg, error, 'focus-ring': ring }).map(movedLine)).toEqual([
+      'base05 #8a829a → #958ca5, as text',
+      'base08 #c06070 → #d57382, as error text',
+    ])
+  })
+})
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  8 failed | 19 passed (27)
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=4
diff --git a/web/src/base16.ts b/web/src/base16.ts
index df5b285..a248ff1 100644
--- a/web/src/base16.ts
+++ b/web/src/base16.ts
@@ -1,4 +1,12 @@
-import { relativeLuminance } from './contrast'
+import { type Adjustment, adjustVariant } from './base16-adjust'
+import {
+  BINDER_APART,
+  type BinderClash,
+  binderClashes,
+  CONTRAST_FLOORS,
+  contrastRatio,
+  relativeLuminance,
+} from './contrast'
 import { COLOUR_TOKENS, type ColourToken, type Variant } from './palettes'
 
 /**
@@ -195,3 +203,218 @@ export const BASE16_MAPPING: Readonly<Record<ColourToken, Base16Key>> = {
 export function mapScheme(colours: Readonly<Record<Base16Key, string>>): Variant {
   return Object.fromEntries(COLOUR_TOKENS.map((t) => [t, colours[BASE16_MAPPING[t]]])) as Record<ColourToken, string>
 }
+
+/** A floor a mapped scheme misses: the pair, the floor, and the ratio it reaches. */
+export type FloorFailure = {
+  readonly fg: ColourToken
+  readonly bg: ColourToken
+  readonly floor: number
+  readonly ratio: number
+}
+
+/** A scheme held to the floors and the binder rule, as it is and as `apply adjusted` would leave it (spec §5.3). */
+export type SchemeCheck = {
+  readonly scheme: Scheme
+  /** The scheme mapped as it is: what `apply` applies. */
+  readonly tokens: Variant
+  readonly failures: readonly FloorFailure[]
+  readonly clashes: readonly BinderClash[]
+  /** What `apply adjusted` applies, and what it moved or could not fix. */
+  readonly adjustment: Adjustment
+  /** What still fails after the adjustment. */
+  readonly remaining: readonly FloorFailure[]
+  readonly remainingClashes: readonly BinderClash[]
+}
+
+function floorFailures(v: Variant): FloorFailure[] {
+  return CONTRAST_FLOORS.map(([fg, bg, floor]) => ({ fg, bg, floor, ratio: contrastRatio(v[fg], v[bg]) })).filter(
+    (f) => f.ratio < f.floor,
+  )
+}
+
+/**
+ * Map a scheme, hold it to the floors and the binder rule `contrast.ts` holds the built-ins to, and adjust it, so the
+ * dialog can say both what the scheme fails and what `apply adjusted` would do about it.
+ */
+export function checkScheme(scheme: Scheme): SchemeCheck {
+  const tokens = mapScheme(scheme.colours)
+  const adjustment = adjustVariant(tokens)
+  return {
+    scheme,
+    tokens,
+    failures: floorFailures(tokens),
+    clashes: binderClashes(tokens),
+    adjustment,
+    remaining: floorFailures(adjustment.tokens),
+    remainingClashes: binderClashes(adjustment.tokens),
+  }
+}
+
+/** Whether the scheme meets every floor and the binder rule as it is, which leaves `apply adjusted` nothing to do. */
+export function passes(check: SchemeCheck): boolean {
+  return check.failures.length === 0 && check.clashes.length === 0
+}
+
+/** A scheme's name as the app shows it: `untitled` when it names none. */
+export function schemeName(name: string): string {
+  return name === '' ? 'untitled' : name
+}
+
+/**
+ * Each token in words (spec §5.3): what it colours as a foreground, and, for the four a foreground sits on, what that
+ * surface is. `accent` is both, and reads the same either way.
+ */
+const WORDS: Readonly<Record<ColourToken, string>> = {
+  bg: 'the page',
+  'bg-raised': 'panels',
+  'bg-chrome': 'headers',
+  rule: 'rules',
+  fg: 'text',
+  'fg-dim': 'dim text',
+  accent: 'accents',
+  'on-accent': 'text on accents',
+  'focus-ring': 'the focus ring',
+  error: 'error text',
+  warn: 'warnings',
+  'tok-neutral': 'plain code',
+  'tok-keyword': 'keywords',
+  'tok-ident': 'names',
+  'tok-nat': 'numbers',
+  'tok-bool': 'booleans',
+  'tok-operator': 'operators',
+  'tok-punct': 'punctuation',
+  'tok-binder': 'binders',
+}
+
+/** `a`, `a and b`, `a, b and c`, each once, in the order given. */
+function list(items: readonly string[]): string {
+  const once = [...new Set(items)]
+  return once.length < 2 ? (once[0] ?? '') : `${once.slice(0, -1).join(', ')} and ${once.at(-1)}`
+}
+
+/** `n` and its noun, singular for one. */
+const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`
+
+/** A ratio as the check prints it: cut, not rounded, to two places, so a ratio below its floor never prints as it. */
+const ratio = (r: number): string => (Math.floor(r * 100) / 100).toFixed(2)
+
+/** How many scheme colours, other than the binder's own, the clashing tokens take. */
+const clashColours = (clashes: readonly BinderClash[]): number =>
+  new Set(clashes.map((c) => BASE16_MAPPING[c.token])).size
+
+/**
+ * The summary (spec §5.3, 1): the scheme's name, its variant and how it was found, and how it measures — `Ember ·
+ * dark, detected: 17 of 35 contrast checks below WCAG AA, worst 3.31:1`. A base24 scheme adds a second line.
+ */
+export function summaryLines(check: SchemeCheck): string[] {
+  const { scheme, failures, clashes } = check
+  const head = `${schemeName(scheme.name)} · ${scheme.variant}, ${scheme.variantFrom === 'file' ? 'from the file' : 'detected'}`
+  const floors =
+    failures.length === 0
+      ? 'every contrast check passes'
+      : `${failures.length} of ${CONTRAST_FLOORS.length} contrast checks below WCAG AA, worst ${ratio(Math.min(...failures.map((f) => f.ratio)))}:1`
+  const binder = clashes.length === 0 ? '' : `; binders too close to ${count(clashColours(clashes), 'other colour')}`
+  const lines = [`${head}: ${floors}${binder}`]
+  if (scheme.base24) lines.push('base24: its eight extra colours, base10–base17, are not used')
+  return lines
+}
+
+/** Where a token's floors sit, as scheme colours: `on base01`, `on both base00 and base01`. */
+function surfacesOf(t: ColourToken): string {
+  const keys = [...new Set(CONTRAST_FLOORS.filter(([fg]) => fg === t).map(([, bg]) => BASE16_MAPPING[bg]))]
+  return keys.length === 2 ? `on both ${keys[0]} and ${keys[1]}` : `on ${list(keys)}`
+}
+
+/**
+ * What `apply adjusted` does, in one line (spec §5.3, 2), or `null` when the scheme passes and it has nothing to do.
+ * Its count is the number of lines `movedColours` gives, the `changes` the details list.
+ */
+export function adjustLine(check: SchemeCheck): string | null {
+  if (passes(check)) return null
+  const n = movedColours(check.scheme.colours, check.adjustment.tokens).length
+  const moves = `apply adjusted moves ${n === 0 ? 'no colour’s' : n === 1 ? '1 colour’s' : `${n} colours’`} lightness`
+  const { remaining, remainingClashes, adjustment } = check
+  if (remaining.length === 0 && remainingClashes.length === 0) return `${moves}, and every check then passes`
+  const left: string[] = []
+  if (remaining.length > 0) {
+    const where = new Set(adjustment.unfixed.filter((u) => u.rule === 'floors').map((u) => surfacesOf(u.token)))
+    left.push(
+      `${count(remaining.length, 'check')} still fail${remaining.length === 1 ? 's' : ''}, where no lightness passes ${[...where].join(' or ')}`,
+    )
+  }
+  if (remainingClashes.length > 0) {
+    left.push(
+      `binders stay too close to ${count(clashColours(remainingClashes), 'other colour')}, where no lightness sets them apart`,
+    )
+  }
+  return `${moves}; ${left.join('; ')}`
+}
+
+/**
+ * What the scheme fails, grouped by scheme colour pair (spec §5.3, 3) — `base08 on base01: error text on panels and
+ * headers — 3.53:1, needs 4.5` — the pair furthest below its floor first; then each colour the binder sits too close
+ * to. The tokens of one pair are one pair of colours, so a group has one ratio, and its floor is the highest it fails.
+ */
+export function failureLines(check: SchemeCheck): string[] {
+  const groups = new Map<string, FloorFailure[]>()
+  for (const f of check.failures) {
+    const pair = `${BASE16_MAPPING[f.fg]} on ${BASE16_MAPPING[f.bg]}`
+    groups.set(pair, [...(groups.get(pair) ?? []), f])
+  }
+  const floors = [...groups]
+    .map(([pair, fs]) => {
+      const floor = Math.max(...fs.map((f) => f.floor))
+      const r = fs[0]?.ratio ?? 0
+      const on = list(fs.map((f) => WORDS[f.bg]))
+      const said = list(COLOUR_TOKENS.filter((t) => fs.some((f) => f.fg === t)).map((t) => WORDS[t]))
+      const what = said.endsWith(` on ${on}`) ? said : `${said} on ${on}`
+      return { line: `${pair}: ${what} — ${ratio(r)}:1, needs ${floor}`, below: r / floor }
+    })
+    .sort((a, b) => a.below - b.below)
+    .map((g) => g.line)
+  const binders = BASE16_KEYS.flatMap((key) => {
+    const near = check.clashes.filter((c) => BASE16_MAPPING[c.token] === key)
+    if (near.length === 0) return []
+    const words = list(near.map((c) => WORDS[c.token]))
+    const apart = Math.min(...near.map((c) => c.apart))
+    return [
+      `${BASE16_MAPPING['tok-binder']} beside ${key}: binders too close to ${words} — ${apart} apart, needs ${BINDER_APART}`,
+    ]
+  })
+  return [...floors, ...binders]
+}
+
+/** One scheme colour the adjustment moved, to one value, and the tokens that took it. */
+export type MovedColour = {
+  readonly key: Base16Key
+  readonly from: string
+  readonly to: string
+  readonly tokens: readonly ColourToken[]
+}
+
+/**
+ * What an adjustment changed, read off a scheme's own colours and the tokens applied (spec §8.4): one entry per
+ * scheme colour and value it moved to, so tokens that share a colour and ended equal are one line, and tokens that
+ * share one and ended apart are two. A token `tokens` lacks, or holds unmoved, is not a change.
+ */
+export function movedColours(
+  colours: Readonly<Record<Base16Key, string>>,
+  tokens: Readonly<Partial<Record<ColourToken, string>>>,
+): MovedColour[] {
+  const moved: MovedColour[] = []
+  for (const key of BASE16_KEYS) {
+    const to = new Map<string, ColourToken[]>()
+    for (const t of COLOUR_TOKENS) {
+      const value = tokens[t]
+      if (BASE16_MAPPING[t] !== key || value === undefined || value === colours[key]) continue
+      to.set(value, [...(to.get(value) ?? []), t])
+    }
+    for (const [value, ts] of to) moved.push({ key, from: colours[key], to: value, tokens: ts })
+  }
+  return moved
+}
+
+/** A moved colour as the details and the `changes` panel list it: `base08 #bf616a → #f59199, as error text`. */
+export function movedLine(m: MovedColour): string {
+  return `${m.key} ${m.from} → ${m.to}, as ${list(m.tokens.map((t) => WORDS[t]))}`
+}
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  55 passed (55)
Tests  807 passed (807)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command; after each, `git status` shows only this task's changes). In the replay, 14 of 14 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | a surface named by its token, not in words — `src/base16.ts`: `'bg-raised': 'panels',` → `'bg-raised': 'bg-raised',` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the check (spec §5.3) > lists the failures grouped by scheme colour pair, in words, the furthest below its floor first`, `tests/node/base16.test.ts > the check (spec §5.3) > says what still fails, and where, when no lightness passes` |
| 2 | failures grouped by token pair, not scheme colour pair — `src/base16.ts`: `` const pair = `${BASE16_MAPPING[f.fg]} on ${BASE16_MAPPING[f.bg]}` `` → `` const pair = `${f.fg} on ${f.bg}` `` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the check (spec §5.3) > lists the failures grouped by scheme colour pair, in words, the furthest below its floor first`, `tests/node/base16.test.ts > the check (spec §5.3) > says what still fails, and where, when no lightness passes` |
| 3 | groups left in floor order, not furthest below first — `src/base16.ts`: `.sort((a, b) => a.below - b.below)` → `.sort(() => 0)` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the check (spec §5.3) > lists the failures grouped by scheme colour pair, in words, the furthest below its floor first` |
| 4 | a group's floor the lowest it fails — `src/base16.ts`: `const floor = Math.max(...fs.map((f) => f.floor))` → `const floor = Math.min(...fs.map((f) => f.floor))` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the check (spec §5.3) > says what still fails, and where, when no lightness passes` |
| 5 | a ratio rounded, not cut — `src/base16.ts`: `const ratio = (r: number): string => (Math.floor(r * 100) / 100).toFixed(2)` → `const ratio = (r: number): string => r.toFixed(2)` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the check (spec §5.3) > lists the failures grouped by scheme colour pair, in words, the furthest below its floor first` |
| 6 | the summary's worst the highest ratio — `src/base16.ts`: `worst ${ratio(Math.min(...failures.map((f) => f.ratio)))}:1` → `worst ${ratio(Math.max(...failures.map((f) => f.ratio)))}:1` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the check (spec §5.3) > counts the checks a scheme fails and gives the worst, in one line` |
| 7 | a binder clash left out of the summary — `src/base16.ts`: `const binder = clashes.length === 0 ? '' :` → `const binder = clashes.length >= 0 ? '' :` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the check (spec §5.3) > names a binder too close to another colour, and says so when no lightness sets it apart` |
| 8 | the adjust line counting tokens, not colours — `src/base16.ts`: `const n = movedColours(check.scheme.colours, check.adjustment.tokens).length` → `const n = check.adjustment.moved.length` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the check (spec §5.3) > says what apply adjusted does, one line per colour it moves` |
| 9 | "on both" dropped from where no lightness passes — `src/base16.ts`: `` return keys.length === 2 ? `on both ${keys[0]} and ${keys[1]}` : `on ${list(keys)}` `` → `` return `on ${list(keys)}` `` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the check (spec §5.3) > says what still fails, and where, when no lightness passes` |
| 10 | one changed line per token, not per colour and value — `src/base16.ts`: `to.set(value, [...(to.get(value) ?? []), t])` → `to.set(t, [t])` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the check (spec §5.3) > reads what changed off a scheme’s own colours and the tokens applied, a token left out included`, `tests/node/base16.test.ts > the check (spec §5.3) > says what apply adjusted does, one line per colour it moves` |
| 11 | a token the tokens leave out read as a change — `src/base16.ts`: `if (BASE16_MAPPING[t] !== key \|\| value === undefined \|\| value === colours[key]) continue` → `if (BASE16_MAPPING[t] !== key \|\| value === colours[key]) continue` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the check (spec §5.3) > reads what changed off a scheme’s own colours and the tokens applied, a token left out included` |
| 12 | base24's line dropped — `src/base16.ts`: `if (scheme.base24) lines.push(` → `if (false) lines.push(` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the check (spec §5.3) > notes that a base24 scheme’s eight extra colours are not used` |
| 13 | `on-accent`'s words said twice — `src/base16.ts`: `` const what = said.endsWith(` on ${on}`) ? said : `${said} on ${on}` `` → `` const what = `${said} on ${on}` `` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the check (spec §5.3) > lists the failures grouped by scheme colour pair, in words, the furthest below its floor first` |
| 14 | a binder clash no lightness fixes read as fixed — `src/base16.ts`: `` if (remaining.length === 0 && remainingClashes.length === 0) return `${moves}, and every check then passes` `` → `` if (remaining.length === 0) return `${moves}, and every check then passes` `` | `cd web && pnpm exec vitest run --project node tests/node/base16.test.ts` | `tests/node/base16.test.ts > the check (spec §5.3) > names a binder too close to another colour, and says so when no lightness sets it apart` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
The check: a scheme's failures in one line, grouped by scheme colour in words, and what `apply adjusted` would do

`checkScheme` maps a scheme, holds it to `contrast.ts`'s floors and
binder rule, and runs the adjustment, so the dialog can say both what
fails and what `apply adjusted` would change (Plan 7 part 6b spec §5.3).
`summaryLines` is one line — how many of the 35 checks fall below WCAG
AA and the worst ratio, or that every one passes, and a binder clash —
with a second for base24. `adjustLine` counts the colours the
adjustment moves and says whether every check then passes, or what
still fails and where no lightness can. `failureLines` groups the
failures by scheme colour pair, each in words with its ratio and the
floor it misses by most, the furthest below first; `movedColours`
reads what changed off a scheme's colours and the tokens applied, so a
stored half can show it too.
````

---

### Task 5: An imported palette is stored under `redextape.palette.custom`, a half per variant, and `custom` is a palette choice

**Files:**
- Create: `web/src/custom-palette.ts` (`CUSTOM_PALETTE_KEY`, `CUSTOM_PALETTE_VERSION`, `CustomHalf`, `CustomPalette`, `parseCustomPalette`, `serializeCustomPalette`, `withHalf`, `withoutHalf`)
- Modify: `web/src/skin.ts` (`PaletteChoice`, `PALETTE_CHOICE_LABELS`, `customPaletteLabel`, `readPaletteChoice`, `resolvePalette`, `applySkin`), `web/src/palettes.ts` (`Palette.id`), `web/src/main.ts` (the style-and-palette block: the store read at start-up, and `listPalettes`)
- Modify (tests): `web/tests/node/base16-fixtures.ts` (`storedHalf`), `web/tests/node/skin.test.ts`, `web/tests/node/prepaint.test.ts`
- Test: `web/tests/node/custom-palette.test.ts`, `web/tests/browser/custom-palette-load.test.ts`

**Interfaces:**
- Consumes Task 2's `BASE16_KEYS`, `Base16Key`, `SchemeVariant`; Task 4's `schemeName`.
- Produces `CUSTOM_PALETTE_KEY = 'redextape.palette.custom'`; `CustomHalf = { name: string; colours: Readonly<Record<Base16Key, string>>; tokens: Readonly<Partial<Record<ColourToken, string>>>; adjusted: boolean }`; `CustomPalette = { light?: CustomHalf; dark?: CustomHalf }`, never neither; `parseCustomPalette(raw: string | null): CustomPalette | null`; `serializeCustomPalette(p): string`; `withHalf(p: CustomPalette | null, variant, half): CustomPalette`; `withoutHalf(p, variant): CustomPalette | null`. `skin.ts`'s `PaletteChoice` gains `'custom'`, and `readPaletteChoice(raw, custom)`, `resolvePalette(style, choice, custom)` and `applySkin(root, style, choice, custom)` each take the stored palette, `CustomPalette | null`; `customPaletteLabel(custom): string`. In `main.ts`, `custom` and `listPalettes()`, which Tasks 6 and 7 use.

**THE STORE** (spec §7.1) holds a scheme's own sixteen colours beside the tokens applied, and `tokens` is never recomputed, so a later change to the mapping or the adjustment never repaints what someone applied. It is read as `buffers-store.ts`'s `parseBuffers` reads: refused whole, without a notice, for anything unusable — and a colour or a token that is not lowercase `#rrggbb` is unusable, since every token reaches the pre-paint cache. A token name it does not know is dropped; a half lacking a token is kept, and the token falls back to the style's own.

**`custom` AS A CHOICE** (§7.2) is read only while a half is stored, and as `match` otherwise. Each half is the style's own variant with that half's tokens written over it, and a half not imported is the style's own, so it follows a style change. The palette select lists `custom` after the four built-in choices, under its halves' names, while a half is stored.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=5
diff --git a/web/tests/browser/custom-palette-load.test.ts b/web/tests/browser/custom-palette-load.test.ts
new file mode 100644
index 0000000..29ea942
--- /dev/null
+++ b/web/tests/browser/custom-palette-load.test.ts
@@ -0,0 +1,67 @@
+import { beforeAll, describe, expect, it } from 'vitest'
+import { STORAGE_KEY } from '../../src/appearance'
+import { CUSTOM_PALETTE_KEY, serializeCustomPalette } from '../../src/custom-palette'
+import { PALETTES } from '../../src/palettes'
+import { PALETTE_CSS_KEY, PALETTE_KEY } from '../../src/skin'
+import { NIGHT, storedHalf } from '../node/base16-fixtures'
+import { SHELL } from './harness'
+
+/**
+ * **A STORED CUSTOM PALETTE IS THE PAGE'S FROM THE START** (Plan 7 part 6b spec §7.2): what an import leaves in
+ * storage — a dark half and the `custom` choice — seeded before `main()` mounts, as `buffer-restore.test.ts` seeds
+ * its copies. One mount for the file, for that file's reason.
+ */
+
+/** `#rrggbb` as `getComputedStyle` writes a colour. */
+const rgb = (hex: string): string => `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
+
+const body = () => getComputedStyle(document.body)
+
+function choose(id: string, value: string): void {
+  const select = document.querySelector<HTMLSelectElement>(id) as HTMLSelectElement
+  select.value = value
+  select.dispatchEvent(new Event('change'))
+}
+
+beforeAll(async () => {
+  localStorage.setItem(CUSTOM_PALETTE_KEY, serializeCustomPalette({ dark: storedHalf('Night', NIGHT) }))
+  localStorage.setItem(PALETTE_KEY, 'custom')
+  localStorage.setItem(STORAGE_KEY, 'dark')
+  document.body.innerHTML = SHELL
+  await (await import('../../src/main')).ready
+})
+
+describe('a stored custom palette, at start-up', () => {
+  it('draws the page in the stored half', () => {
+    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
+    expect(body().backgroundColor).toBe(rgb(NIGHT[0]))
+    expect(body().color).toBe(rgb(NIGHT[5]))
+  })
+
+  it('lists custom after the built-in choices, under its half’s name, and chosen', () => {
+    const select = document.querySelector<HTMLSelectElement>('#palette') as HTMLSelectElement
+    expect([...select.options].map((o) => o.textContent)).toEqual([
+      'match style',
+      'Paper',
+      'Terminal',
+      'Instrument',
+      'custom — dark: Night',
+    ])
+    expect(select.value).toBe('custom')
+  })
+
+  it('caches what it applied, for the next load’s first paint', () => {
+    expect(localStorage.getItem(PALETTE_CSS_KEY)).toContain(
+      `--bg: light-dark(${PALETTES.instrument.light.bg}, ${NIGHT[0]});`,
+    )
+  })
+
+  it('draws the half not imported in the style’s own palette, and follows a style change', () => {
+    choose('#appearance-choice', 'light')
+    expect(body().backgroundColor).toBe(rgb(PALETTES.instrument.light.bg))
+    choose('#style', 'paper')
+    expect(body().backgroundColor).toBe(rgb(PALETTES.paper.light.bg))
+    choose('#appearance-choice', 'dark')
+    expect(body().backgroundColor).toBe(rgb(NIGHT[0]))
+  })
+})
diff --git a/web/tests/node/base16-fixtures.ts b/web/tests/node/base16-fixtures.ts
index d2ebce4..cd786c0 100644
--- a/web/tests/node/base16-fixtures.ts
+++ b/web/tests/node/base16-fixtures.ts
@@ -1,3 +1,6 @@
+import { mapScheme, type Scheme } from '../../src/base16'
+import type { CustomHalf } from '../../src/custom-palette'
+
 /**
  * base16 schemes written for these tests (Plan 7 part 6b spec §13): no published scheme, and no licence, enters the
  * repo. Each is its sixteen colours, base00 first; `currentLayout` and `legacyLayout` write one out as the YAML the
@@ -122,3 +125,9 @@ export function legacyLayout(name: string, colours: readonly string[]): string {
 export function keyed(colours: readonly string[]): Record<string, string> {
   return Object.fromEntries(KEYS.map((k, i) => [`base${k}`, colours[i] ?? '']))
 }
+
+/** A stored half, as `apply` writes one: the scheme's own colours, mapped, not adjusted. */
+export function storedHalf(name: string, colours: readonly string[]): CustomHalf {
+  const own = keyed(colours) as Scheme['colours']
+  return { name, colours: own, tokens: mapScheme(own), adjusted: false }
+}
diff --git a/web/tests/node/custom-palette.test.ts b/web/tests/node/custom-palette.test.ts
new file mode 100644
index 0000000..b225683
--- /dev/null
+++ b/web/tests/node/custom-palette.test.ts
@@ -0,0 +1,81 @@
+import { describe, expect, it } from 'vitest'
+import {
+  CUSTOM_PALETTE_VERSION,
+  parseCustomPalette,
+  serializeCustomPalette,
+  withHalf,
+  withoutHalf,
+} from '../../src/custom-palette'
+import { DAY, NIGHT, storedHalf } from './base16-fixtures'
+
+const NIGHT_HALF = storedHalf('Night', NIGHT)
+const DAY_HALF = storedHalf('Day', DAY)
+
+/** The stored JSON for `{ light: DAY_HALF, dark: NIGHT_HALF }`, with `edit` applied to its parsed form first. */
+function stored(edit: (json: Record<string, unknown>) => void = () => {}): string {
+  const json = JSON.parse(serializeCustomPalette({ light: DAY_HALF, dark: NIGHT_HALF })) as Record<string, unknown>
+  edit(json)
+  return JSON.stringify(json)
+}
+
+const darkHalf = (json: Record<string, unknown>) => json.dark as Record<string, unknown>
+
+describe('the custom palette store (Plan 7 part 6b spec §7.1)', () => {
+  it('reads back what it wrote, both halves and one', () => {
+    expect(parseCustomPalette(stored())).toEqual({ light: DAY_HALF, dark: NIGHT_HALF })
+    expect(parseCustomPalette(serializeCustomPalette({ dark: NIGHT_HALF }))).toEqual({ dark: NIGHT_HALF })
+    expect(JSON.parse(stored()).version).toBe(CUSTOM_PALETTE_VERSION)
+  })
+
+  it('reads nothing stored, and a store with no half, as nothing imported', () => {
+    expect(parseCustomPalette(null)).toBeNull()
+    expect(parseCustomPalette(JSON.stringify({ version: CUSTOM_PALETTE_VERSION }))).toBeNull()
+  })
+
+  it.each([
+    ['text that is not JSON', () => '{"version": 1, "dark":'],
+    ['a value that is not an object', () => '"dark"'],
+    ['another version', () => stored((j) => (j.version = 2))],
+    ['a half that is not an object', () => stored((j) => (j.light = 'Day'))],
+    ['a half that is null', () => stored((j) => (j.light = null))],
+    ['a name that is not a string', () => stored((j) => (darkHalf(j).name = 7))],
+    [
+      'colours without one of the sixteen',
+      () => stored((j) => delete (darkHalf(j).colours as Record<string, string>).base0C),
+    ],
+    [
+      'a colour that is not lowercase #rrggbb',
+      () => stored((j) => ((darkHalf(j).colours as Record<string, string>).base05 = '#C8C3D8')),
+    ],
+    ['an adjusted that is not a boolean', () => stored((j) => (darkHalf(j).adjusted = 'yes'))],
+    ['tokens that are not an object', () => stored((j) => (darkHalf(j).tokens = null))],
+    [
+      'a token that is not lowercase #rrggbb',
+      () => stored((j) => ((darkHalf(j).tokens as Record<string, string>).fg = 'white')),
+    ],
+  ])('refuses the whole store for %s', (_, raw) => {
+    expect(parseCustomPalette(raw())).toBeNull()
+  })
+
+  it('keeps a half that lacks a token, and drops a token name it does not know', () => {
+    const raw = stored((j) => {
+      const tokens = darkHalf(j).tokens as Record<string, string>
+      delete tokens['tok-binder']
+      tokens['tok-retired'] = 'not even a colour'
+    })
+    const { 'tok-binder': _, ...rest } = NIGHT_HALF.tokens
+    expect(parseCustomPalette(raw)?.dark?.tokens).toEqual(rest)
+  })
+
+  it('replaces one half on an import and keeps the other', () => {
+    const next = storedHalf('Next', NIGHT)
+    expect(withHalf({ light: DAY_HALF, dark: NIGHT_HALF }, 'dark', next)).toEqual({ light: DAY_HALF, dark: next })
+    expect(withHalf(null, 'light', DAY_HALF)).toEqual({ light: DAY_HALF })
+  })
+
+  it('removes either half and keeps the other, and removing the last leaves nothing to store', () => {
+    expect(withoutHalf({ light: DAY_HALF, dark: NIGHT_HALF }, 'light')).toEqual({ dark: NIGHT_HALF })
+    expect(withoutHalf({ light: DAY_HALF, dark: NIGHT_HALF }, 'dark')).toEqual({ light: DAY_HALF })
+    expect(withoutHalf({ dark: NIGHT_HALF }, 'dark')).toBeNull()
+  })
+})
diff --git a/web/tests/node/prepaint.test.ts b/web/tests/node/prepaint.test.ts
index cbe692f..9ccf4b8 100644
--- a/web/tests/node/prepaint.test.ts
+++ b/web/tests/node/prepaint.test.ts
@@ -2,7 +2,8 @@ import { readFileSync } from 'node:fs'
 import { fileURLToPath } from 'node:url'
 import { describe, expect, it } from 'vitest'
 import { PALETTE_CSS_PATTERN, PALETTES, paletteDeclarations } from '../../src/palettes'
-import { PALETTE_CSS_KEY, STYLE_IDS, STYLE_KEY } from '../../src/skin'
+import { PALETTE_CSS_KEY, resolvePalette, STYLE_IDS, STYLE_KEY } from '../../src/skin'
+import { DAY, NEON, storedHalf } from './base16-fixtures'
 
 const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')
 // The one classic script in the page — the module script has a `type`.
@@ -43,6 +44,16 @@ describe('the pre-paint script', () => {
     expect(attrs.get('style')).toBe(css)
   })
 
+  // The cache holds resolved declarations whatever produced them (Plan 7 part 6b spec §9), so an imported palette
+  // reaches first paint through the same key and the same pattern, the script unchanged.
+  it('applies a cached custom palette as it applies a built-in one', () => {
+    const css = paletteDeclarations(
+      resolvePalette('paper', 'custom', { light: storedHalf('Day', DAY), dark: storedHalf('Neon', NEON) }),
+    )
+    expect(PALETTE_CSS_PATTERN.test(css)).toBe(true)
+    expect(run({ [PALETTE_CSS_KEY]: css }).get('style')).toBe(css)
+  })
+
   it('still applies a stored appearance', () => {
     expect(run({ 'redextape.appearance': 'dark' }).get('data-theme')).toBe('dark')
   })
diff --git a/web/tests/node/skin.test.ts b/web/tests/node/skin.test.ts
index a12fefc..707f501 100644
--- a/web/tests/node/skin.test.ts
+++ b/web/tests/node/skin.test.ts
@@ -2,6 +2,7 @@ import { describe, expect, it } from 'vitest'
 import { COLOUR_TOKENS, PALETTES, paletteDeclarations } from '../../src/palettes'
 import {
   applySkin,
+  customPaletteLabel,
   DEFAULT_STYLE,
   PALETTE_CHOICE_LABELS,
   PALETTE_CHOICES,
@@ -12,6 +13,7 @@ import {
   STYLE_IDS,
   STYLE_LABELS,
 } from '../../src/skin'
+import { DAY, NIGHT, storedHalf } from './base16-fixtures'
 
 function fakeRoot(): SkinRoot & { attrs: Map<string, string>; props: Map<string, string> } {
   const attrs = new Map<string, string>()
@@ -42,13 +44,13 @@ describe('skin', () => {
   })
 
   it('reads a stored palette choice, and anything else as match', () => {
-    for (const c of PALETTE_CHOICES) expect(readPaletteChoice(c)).toBe(c)
-    for (const bad of [null, '', 'Paper', 'system']) expect(readPaletteChoice(bad)).toBe('match')
+    for (const c of PALETTE_CHOICES) expect(readPaletteChoice(c, null)).toBe(c)
+    for (const bad of [null, '', 'Paper', 'system', 'Custom']) expect(readPaletteChoice(bad, null)).toBe('match')
   })
 
   it('resolves match to the style’s own palette, and a named palette to itself', () => {
-    expect(resolvePalette('paper', 'match')).toBe(PALETTES.paper)
-    expect(resolvePalette('paper', 'terminal')).toBe(PALETTES.terminal)
+    expect(resolvePalette('paper', 'match', null)).toBe(PALETTES.paper)
+    expect(resolvePalette('paper', 'terminal', null)).toBe(PALETTES.terminal)
   })
 
   it('labels every style and every choice', () => {
@@ -58,7 +60,7 @@ describe('skin', () => {
 
   it('writes the style attribute and every token, and returns the declarations to cache', () => {
     const root = fakeRoot()
-    const cached = applySkin(root, 'paper', 'terminal')
+    const cached = applySkin(root, 'paper', 'terminal', null)
     expect(root.attrs.get('data-style')).toBe('paper')
     for (const t of COLOUR_TOKENS) {
       expect(root.props.get(`--${t}`)).toBe(`light-dark(${PALETTES.terminal.light[t]}, ${PALETTES.terminal.dark[t]})`)
@@ -66,3 +68,49 @@ describe('skin', () => {
     expect(cached).toBe(paletteDeclarations(PALETTES.terminal))
   })
 })
+
+/** The imported palette as a choice (Plan 7 part 6b spec §7.2). */
+describe('skin — custom', () => {
+  const night = storedHalf('Night', NIGHT)
+  const day = { ...storedHalf('Day', DAY), adjusted: true }
+
+  it('reads custom only while a half is stored, and match otherwise', () => {
+    expect(readPaletteChoice('custom', { dark: night })).toBe('custom')
+    expect(readPaletteChoice('custom', null)).toBe('match')
+  })
+
+  it('writes each stored half over the style’s own variant, and keeps the style’s own for a half not stored', () => {
+    const p = resolvePalette('terminal', 'custom', { dark: night })
+    expect(p.id).toBe('custom')
+    expect(p.dark).toEqual(night.tokens)
+    expect(p.light).toEqual(PALETTES.terminal.light)
+    // A STYLE CHANGE MOVES THE HALF THAT FALLS BACK, and only that half.
+    const q = resolvePalette('paper', 'custom', { dark: night })
+    expect(q.dark).toEqual(night.tokens)
+    expect(q.light).toEqual(PALETTES.paper.light)
+  })
+
+  it('falls back token by token where a stored half lacks one', () => {
+    const { fg: _, ...lacking } = night.tokens
+    const p = resolvePalette('instrument', 'custom', { dark: { ...night, tokens: lacking } })
+    expect(p.dark.fg).toBe(PALETTES.instrument.dark.fg)
+    expect(p.dark.bg).toBe(NIGHT[0])
+  })
+
+  it('draws the style’s own palette for custom with nothing stored', () => {
+    const p = resolvePalette('paper', 'custom', null)
+    expect([p.light, p.dark]).toEqual([PALETTES.paper.light, PALETTES.paper.dark])
+  })
+
+  it('applies a custom palette and returns its declarations to cache', () => {
+    const root = fakeRoot()
+    const cached = applySkin(root, 'instrument', 'custom', { light: day, dark: night })
+    expect(root.props.get('--bg')).toBe(`light-dark(${DAY[0]}, ${NIGHT[0]})`)
+    expect(cached).toBe(paletteDeclarations(resolvePalette('instrument', 'custom', { light: day, dark: night })))
+  })
+
+  it('names each half in the select, and says which were adjusted', () => {
+    expect(customPaletteLabel({ light: day, dark: night })).toBe('custom — light: Day (adjusted) · dark: Night')
+    expect(customPaletteLabel({ dark: { ...night, name: '' } })).toBe('custom — dark: untitled')
+  })
+})
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/custom-palette.test.ts tests/node/skin.test.ts tests/node/prepaint.test.ts`

Expected: exit 1, printing:

```text
Test Files  3 failed (3)
Tests  7 failed | 12 passed (19)
```

Run: `cd web && pnpm exec vitest run --project browser tests/browser/custom-palette-load.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  no tests
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=5
diff --git a/web/src/custom-palette.ts b/web/src/custom-palette.ts
new file mode 100644
index 0000000..cbf1b5c
--- /dev/null
+++ b/web/src/custom-palette.ts
@@ -0,0 +1,110 @@
+import { BASE16_KEYS, type Base16Key, type SchemeVariant } from './base16'
+import { COLOUR_TOKENS, type ColourToken } from './palettes'
+
+/**
+ * The one imported palette, `custom` (Plan 7 part 6b spec §7.1): a half per variant, each the scheme it came from
+ * and the tokens it applies.
+ *
+ * **`tokens` IS STORED, NOT RECOMPUTED FROM `colours`**, so a later change to the mapping or the adjustment never
+ * repaints a palette someone has already applied. `colours` is kept beside it so the dialog can show what an
+ * adjustment changed.
+ */
+
+/** The `localStorage` key, namespaced for the reason `appearance.ts`'s `STORAGE_KEY` gives. */
+export const CUSTOM_PALETTE_KEY = 'redextape.palette.custom'
+
+/** Bumped when the stored shape changes. A mismatch reads as nothing imported rather than migrating. */
+export const CUSTOM_PALETTE_VERSION = 1
+
+/** One variant's import. */
+export type CustomHalf = {
+  /** `''` when the scheme names none; shown as `untitled`. */
+  readonly name: string
+  /** The scheme's own sixteen, as read. */
+  readonly colours: Readonly<Record<Base16Key, string>>
+  /** What is applied. A token missing here falls back to the style's own palette. */
+  readonly tokens: Readonly<Partial<Record<ColourToken, string>>>
+  /** Whether `apply adjusted` wrote `tokens`. */
+  readonly adjusted: boolean
+}
+
+/**
+ * The imported palette: a light half, a dark half, or both. **NEVER NEITHER** — a store with no half left is removed,
+ * and reads as `null`, so an empty store and no store are one state.
+ */
+export type CustomPalette = { readonly light?: CustomHalf; readonly dark?: CustomHalf }
+
+/**
+ * The one form a stored colour may take: every token reaches `index.html`'s pre-paint cache, whose pattern
+ * (`palettes.ts`'s `PALETTE_CSS_PATTERN`) admits nothing else.
+ */
+const HEX = /^#[0-9a-f]{6}$/
+
+function readHalf(node: unknown): CustomHalf | null {
+  if (typeof node !== 'object' || node === null || Array.isArray(node)) return null
+  const n = node as Record<string, unknown>
+  if (typeof n.name !== 'string' || typeof n.adjusted !== 'boolean') return null
+  if (typeof n.colours !== 'object' || n.colours === null || typeof n.tokens !== 'object' || n.tokens === null) {
+    return null
+  }
+  const stored = n.colours as Record<string, unknown>
+  const colours: Partial<Record<Base16Key, string>> = {}
+  for (const k of BASE16_KEYS) {
+    const value = stored[k]
+    if (typeof value !== 'string' || !HEX.test(value)) return null
+    colours[k] = value
+  }
+  const tokens: Partial<Record<ColourToken, string>> = {}
+  for (const [t, value] of Object.entries(n.tokens)) {
+    // A NAME `COLOUR_TOKENS` DOES NOT HOLD IS DROPPED, not refused: nothing reads it, and a token a later version
+    // retires would otherwise refuse every palette stored before it.
+    const token = COLOUR_TOKENS.find((c) => c === t)
+    if (token === undefined) continue
+    if (typeof value !== 'string' || !HEX.test(value)) return null
+    tokens[token] = value
+  }
+  return { name: n.name, colours: colours as Record<Base16Key, string>, tokens, adjusted: n.adjusted }
+}
+
+/**
+ * The stored palette, or `null` for nothing usable — refused whole, as `buffers-store.ts`'s `parseBuffers` refuses,
+ * without a notice, since a failed read cannot be told from a first visit: not JSON, another `version`, a half that is
+ * not an object, a `name` that is not a string, `colours` without one of the sixteen or holding anything but lowercase
+ * `#rrggbb`, an `adjusted` that is not a boolean, or a token holding anything but lowercase `#rrggbb`.
+ */
+export function parseCustomPalette(raw: string | null): CustomPalette | null {
+  if (raw === null) return null
+  let parsed: unknown
+  try {
+    parsed = JSON.parse(raw)
+  } catch {
+    return null
+  }
+  if (typeof parsed !== 'object' || parsed === null) return null
+  const envelope = parsed as Record<string, unknown>
+  if (envelope.version !== CUSTOM_PALETTE_VERSION) return null
+  let palette: CustomPalette = {}
+  for (const variant of ['light', 'dark'] as const) {
+    if (!(variant in envelope)) continue
+    const half = readHalf(envelope[variant])
+    if (half === null) return null
+    palette = { ...palette, [variant]: half }
+  }
+  return palette.light === undefined && palette.dark === undefined ? null : palette
+}
+
+export function serializeCustomPalette(palette: CustomPalette): string {
+  return JSON.stringify({ version: CUSTOM_PALETTE_VERSION, ...palette })
+}
+
+/** An import: `half` replaces `variant`'s half, and the other half is kept. */
+export function withHalf(palette: CustomPalette | null, variant: SchemeVariant, half: CustomHalf): CustomPalette {
+  return { ...palette, [variant]: half }
+}
+
+/** A remove: `variant`'s half goes and the other is kept — or `null` when it was the last, and the key goes too. */
+export function withoutHalf(palette: CustomPalette, variant: SchemeVariant): CustomPalette | null {
+  const other = variant === 'light' ? 'dark' : 'light'
+  const kept = palette[other]
+  return kept === undefined ? null : { [other]: kept }
+}
diff --git a/web/src/main.ts b/web/src/main.ts
index 0edebd1..09cde36 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -18,6 +18,7 @@ import { bufferList } from './buffer-list'
 import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from './buffers-store'
 import { type CaptureTable, classMapFrom, createGrammarRegistry, treeSitterColour } from './colour'
 import { createCompile } from './compile'
+import { CUSTOM_PALETTE_KEY, parseCustomPalette } from './custom-palette'
 import { lspLintRanges } from './diagnostics'
 import { createDraw } from './draw'
 import { createEditorCustody } from './editor-custody'
@@ -52,6 +53,7 @@ import { type SessionId, SessionPool } from './session-client'
 import { legControlState, type SessionLegs, SessionRegistry } from './sessions'
 import {
   applySkin,
+  customPaletteLabel,
   PALETTE_CHOICE_LABELS,
   PALETTE_CHOICES,
   PALETTE_CSS_KEY,
@@ -369,14 +371,23 @@ async function main(): Promise<EditorView> {
     }
   }
   for (const id of STYLE_IDS) styleSelect.append(new Option(STYLE_LABELS[id], id))
-  for (const id of PALETTE_CHOICES) paletteSelect.append(new Option(PALETTE_CHOICE_LABELS[id], id))
   let style = readStyle(readSkinStorage(STYLE_KEY))
-  let paletteChoice = readPaletteChoice(readSkinStorage(PALETTE_KEY))
+  /** The imported palette (Plan 7 part 6b spec §7), or `null` when nothing is imported. */
+  const custom = parseCustomPalette(readSkinStorage(CUSTOM_PALETTE_KEY))
+  let paletteChoice = readPaletteChoice(readSkinStorage(PALETTE_KEY), custom)
+  // `custom` IS LISTED WHILE THE STORE HOLDS A HALF, after the built-in choices, under its halves' names (spec §7.2).
+  const listPalettes = (): void => {
+    paletteSelect.replaceChildren(
+      ...PALETTE_CHOICES.map((id) => new Option(PALETTE_CHOICE_LABELS[id], id)),
+      ...(custom === null ? [] : [new Option(customPaletteLabel(custom), 'custom')]),
+    )
+    paletteSelect.value = paletteChoice
+  }
   styleSelect.value = style
-  paletteSelect.value = paletteChoice
+  listPalettes()
   // Every apply refreshes the pre-paint cache, so the next load's first frame is this one.
   const applyChosenSkin = (): void => {
-    writeSkinStorage(PALETTE_CSS_KEY, applySkin(document.documentElement, style, paletteChoice))
+    writeSkinStorage(PALETTE_CSS_KEY, applySkin(document.documentElement, style, paletteChoice, custom))
   }
   applyChosenSkin()
   styleSelect.addEventListener('change', () => {
@@ -385,7 +396,7 @@ async function main(): Promise<EditorView> {
     applyChosenSkin()
   })
   paletteSelect.addEventListener('change', () => {
-    paletteChoice = readPaletteChoice(paletteSelect.value)
+    paletteChoice = readPaletteChoice(paletteSelect.value, custom)
     writeSkinStorage(PALETTE_KEY, paletteChoice)
     applyChosenSkin()
   })
diff --git a/web/src/palettes.ts b/web/src/palettes.ts
index 3b1da33..f4012fd 100644
--- a/web/src/palettes.ts
+++ b/web/src/palettes.ts
@@ -52,8 +52,9 @@ export const PALETTE_IDS = ['paper', 'terminal', 'instrument'] as const
 
 export type PaletteId = (typeof PALETTE_IDS)[number]
 
+/** A built-in palette, or the imported one (`skin.ts`'s `resolvePalette`), which is `custom`. */
 export type Palette = {
-  readonly id: PaletteId
+  readonly id: PaletteId | 'custom'
   readonly name: string
   readonly light: Variant
   readonly dark: Variant
diff --git a/web/src/skin.ts b/web/src/skin.ts
index 5298e05..6e3128e 100644
--- a/web/src/skin.ts
+++ b/web/src/skin.ts
@@ -1,3 +1,5 @@
+import { schemeName } from './base16'
+import type { CustomPalette } from './custom-palette'
 import { COLOUR_TOKENS, PALETTE_IDS, PALETTES, type Palette, type PaletteId, paletteDeclarations } from './palettes'
 
 /**
@@ -13,8 +15,13 @@ export const STYLE_IDS = ['paper', 'terminal', 'instrument'] as const
 
 export type StyleId = (typeof STYLE_IDS)[number]
 
-export type PaletteChoice = 'match' | PaletteId
+/**
+ * `custom` is the imported palette (Plan 7 part 6b spec §7.2), a choice only while one is stored: it is not in
+ * `PALETTE_CHOICES`, and the palette select lists it after them when `custom-palette.ts`'s store holds a half.
+ */
+export type PaletteChoice = 'match' | PaletteId | 'custom'
 
+/** The choices every page offers, in the select's order. */
 export const PALETTE_CHOICES: readonly PaletteChoice[] = ['match', ...PALETTE_IDS]
 
 /** The first-visit style — the umbrella design's first-load decision. */
@@ -41,6 +48,19 @@ export const PALETTE_CHOICE_LABELS: Readonly<Record<PaletteChoice, string>> = {
   paper: 'Paper',
   terminal: 'Terminal',
   instrument: 'Instrument',
+  custom: 'custom',
+}
+
+/**
+ * The palette select's words for the imported palette, a name per half — `custom — light: Day · dark: Ember
+ * (adjusted)`, or `custom — dark: Ember` with one.
+ */
+export function customPaletteLabel(custom: CustomPalette): string {
+  const halves = (['light', 'dark'] as const).flatMap((variant) => {
+    const half = custom[variant]
+    return half === undefined ? [] : [`${variant}: ${schemeName(half.name)}${half.adjusted ? ' (adjusted)' : ''}`]
+  })
+  return `${PALETTE_CHOICE_LABELS.custom} — ${halves.join(' · ')}`
 }
 
 function isStyle(raw: string | null): raw is StyleId {
@@ -56,13 +76,28 @@ export function readStyle(raw: string | null): StyleId {
   return isStyle(raw) ? raw : DEFAULT_STYLE
 }
 
-/** A stored palette choice, or `match` for anything that is not one. */
-export function readPaletteChoice(raw: string | null): PaletteChoice {
+/**
+ * A stored palette choice, or `match` for anything that is not one — and for `custom` when nothing is imported, so a
+ * store cleared or refused under a stored `custom` shows the style's own palette, with the select agreeing.
+ */
+export function readPaletteChoice(raw: string | null, custom: CustomPalette | null): PaletteChoice {
+  if (raw === 'custom') return custom === null ? 'match' : 'custom'
   return isPaletteChoice(raw) ? raw : 'match'
 }
 
-export function resolvePalette(style: StyleId, choice: PaletteChoice): Palette {
-  return PALETTES[choice === 'match' ? style : choice]
+/**
+ * The palette a choice draws. For `custom`, each half is the style's own variant with that half's tokens written over
+ * it, and a half not imported is the style's own (umbrella §7) — so it follows a style change.
+ */
+export function resolvePalette(style: StyleId, choice: PaletteChoice, custom: CustomPalette | null): Palette {
+  if (choice !== 'custom') return PALETTES[choice === 'match' ? style : choice]
+  const own = PALETTES[style]
+  return {
+    id: 'custom',
+    name: PALETTE_CHOICE_LABELS.custom,
+    light: { ...own.light, ...custom?.light?.tokens },
+    dark: { ...own.dark, ...custom?.dark?.tokens },
+  }
 }
 
 /** The slice of `<html>` that `applySkin` writes to, so node tests can hand it a fake. */
@@ -77,8 +112,8 @@ export type SkinRoot = {
  *
  * Returns the palette's declarations, for the caller to cache under `PALETTE_CSS_KEY`.
  */
-export function applySkin(root: SkinRoot, style: StyleId, choice: PaletteChoice): string {
-  const palette = resolvePalette(style, choice)
+export function applySkin(root: SkinRoot, style: StyleId, choice: PaletteChoice, custom: CustomPalette | null): string {
+  const palette = resolvePalette(style, choice, custom)
   root.setAttribute('data-style', style)
   for (const t of COLOUR_TOKENS) {
     root.style.setProperty(`--${t}`, `light-dark(${palette.light[t]}, ${palette.dark[t]})`)
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  56 passed (56)
Tests  830 passed (830)
```

Run: `cd web && pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
Test Files  122 passed (122)
Tests  799 passed (799)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command; after each, `git status` shows only this task's changes). In the replay, 11 of 11 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | a token's value not checked — `src/custom-palette.ts`: `if (typeof value !== 'string' \|\| !HEX.test(value)) return null ⏎ tokens[token] = value` → `tokens[token] = value as string` | `cd web && pnpm exec vitest run --project node tests/node/custom-palette.test.ts tests/node/skin.test.ts tests/node/prepaint.test.ts` | `tests/node/custom-palette.test.ts > the custom palette store (Plan 7 part 6b spec §7.1) > refuses the whole store for a token that is not lowercase #rrggbb` |
| 2 | a scheme colour allowed in upper case — `src/custom-palette.ts`: `if (typeof value !== 'string' \|\| !HEX.test(value)) return null ⏎ colours[k] = value` → `if (typeof value !== 'string') return null ⏎ colours[k] = value` | `cd web && pnpm exec vitest run --project node tests/node/custom-palette.test.ts tests/node/skin.test.ts tests/node/prepaint.test.ts` | `tests/node/custom-palette.test.ts > the custom palette store (Plan 7 part 6b spec §7.1) > refuses the whole store for a colour that is not lowercase #rrggbb` |
| 3 | the version not checked — `src/custom-palette.ts`: `if (envelope.version !== CUSTOM_PALETTE_VERSION) return null` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/custom-palette.test.ts tests/node/skin.test.ts tests/node/prepaint.test.ts` | `tests/node/custom-palette.test.ts > the custom palette store (Plan 7 part 6b spec §7.1) > refuses the whole store for another version` |
| 4 | an unknown token name kept, not dropped — `src/custom-palette.ts`: `const token = COLOUR_TOKENS.find((c) => c === t) ⏎ if (token === undefined) continue` → `const token = t as ColourToken` | `cd web && pnpm exec vitest run --project node tests/node/custom-palette.test.ts tests/node/skin.test.ts tests/node/prepaint.test.ts` | `tests/node/custom-palette.test.ts > the custom palette store (Plan 7 part 6b spec §7.1) > keeps a half that lacks a token, and drops a token name it does not know` |
| 5 | removing the last half leaves an empty store, not none — `src/custom-palette.ts`: `return kept === undefined ? null : { [other]: kept }` → `return kept === undefined ? {} : { [other]: kept }` | `cd web && pnpm exec vitest run --project node tests/node/custom-palette.test.ts tests/node/skin.test.ts tests/node/prepaint.test.ts` | `tests/node/custom-palette.test.ts > the custom palette store (Plan 7 part 6b spec §7.1) > removes either half and keeps the other, and removing the last leaves nothing to store` |
| 6 | `custom` read with nothing stored — `src/skin.ts`: `if (raw === 'custom') return custom === null ? 'match' : 'custom'` → `if (raw === 'custom') return 'custom'` | `cd web && pnpm exec vitest run --project node tests/node/custom-palette.test.ts tests/node/skin.test.ts tests/node/prepaint.test.ts` | `tests/node/skin.test.ts > skin — custom > reads custom only while a half is stored, and match otherwise` |
| 7 | a half not stored drawn from Instrument, not the style — `src/skin.ts`: `light: { ...own.light, ...custom?.light?.tokens },` → `light: { ...PALETTES.instrument.light, ...custom?.light?.tokens },` | `cd web && pnpm exec vitest run --project node tests/node/custom-palette.test.ts tests/node/skin.test.ts tests/node/prepaint.test.ts` | `tests/node/skin.test.ts > skin — custom > draws the style’s own palette for custom with nothing stored`, `tests/node/skin.test.ts > skin — custom > writes each stored half over the style’s own variant, and keeps the style’s own for a half not stored` |
| 8 | the adjusted mark left off the select's label — `src/skin.ts`: `${half.adjusted ? ' (adjusted)' : ''}` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/custom-palette.test.ts tests/node/skin.test.ts tests/node/prepaint.test.ts` | `tests/node/skin.test.ts > skin — custom > names each half in the select, and says which were adjusted` |
| 9 | `custom` not listed at start-up — `src/main.ts`: `...(custom === null ? [] : [new Option(customPaletteLabel(custom), 'custom')]),` → `...(custom === null ? [] : []),` | `cd web && pnpm exec vitest run --project browser tests/browser/custom-palette-load.test.ts` | `tests/browser/custom-palette-load.test.ts > a stored custom palette, at start-up > lists custom after the built-in choices, under its half’s name, and chosen` |
| 10 | the page not drawn in the stored palette — `src/main.ts`: `applySkin(document.documentElement, style, paletteChoice, custom)` → `applySkin(document.documentElement, style, paletteChoice, null)` | `cd web && pnpm exec vitest run --project browser tests/browser/custom-palette-load.test.ts` | `tests/browser/custom-palette-load.test.ts > a stored custom palette, at start-up > caches what it applied, for the next load’s first paint`, `tests/browser/custom-palette-load.test.ts > a stored custom palette, at start-up > draws the half not imported in the style’s own palette, and follows a style change`, `tests/browser/custom-palette-load.test.ts > a stored custom palette, at start-up > draws the page in the stored half` |
| 11 | the stored `custom` choice read as if nothing were stored — `src/main.ts`: `let paletteChoice = readPaletteChoice(readSkinStorage(PALETTE_KEY), custom)` → `let paletteChoice = readPaletteChoice(readSkinStorage(PALETTE_KEY), null)` | `cd web && pnpm exec vitest run --project browser tests/browser/custom-palette-load.test.ts` | `tests/browser/custom-palette-load.test.ts > a stored custom palette, at start-up > caches what it applied, for the next load’s first paint`, `tests/browser/custom-palette-load.test.ts > a stored custom palette, at start-up > draws the half not imported in the style’s own palette, and follows a style change`, `tests/browser/custom-palette-load.test.ts > a stored custom palette, at start-up > draws the page in the stored half`, `tests/browser/custom-palette-load.test.ts > a stored custom palette, at start-up > lists custom after the built-in choices, under its half’s name, and chosen` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
An imported palette is stored under `redextape.palette.custom`, a half per variant, and `custom` is a palette choice

`custom-palette.ts` stores one imported palette as a light half, a dark
half or both, each the scheme's own sixteen colours, the tokens applied
and whether they were adjusted (Plan 7 part 6b spec §7.1). It is read
as `buffers-store.ts` reads its store: refused whole, silently, for
anything unusable, since every token reaches the pre-paint cache; a
token name it does not know is dropped, and a store with no half left
is no store. `PaletteChoice` gains `custom`, read only while a half is
stored (§7.2): each half is the style's own variant with its tokens
written over it, and a half not imported is the style's own, so it
follows a style change. `main.ts` reads the store at start-up and
lists `custom` after the built-in choices under its halves' names.
````

---

### Task 6: `import base16…` in the settings menu opens a modal dialog: a scheme checked, then applied as it is or adjusted

**Files:**
- Create: `web/src/base16-dialog.ts` (`Base16DialogDeps`, `Base16Dialog`, `createBase16Dialog`)
- Modify: `web/src/main.ts` (the style-and-palette block: `writeCustom`, the dialog, `#import-base16`), `web/index.html` (one `<button>` at the end of `#settings-menu`), `web/src/style.css` (one block after `.visually-hidden`)
- Modify (tests): `web/tests/browser/harness.ts` (`SHELL`'s copy of the button), `web/tests/browser/controls-gate.test.ts` (spec §10)
- Test: `web/tests/browser/base16-import.test.ts`, `web/tests/browser/base16-prepaint.test.ts`

**Interfaces:**
- Consumes Task 4's check and Task 5's store and `listPalettes`.
- Produces `createBase16Dialog(deps: { shown(): SchemeVariant; apply(variant: SchemeVariant, half: CustomHalf): void }): { el: HTMLDialogElement; open(): void }`. Task 7 adds `stored` and `remove` to `deps`.

**ONE NATIVE `<dialog>`, MODAL** (spec §8): `import base16…`, the settings menu's last item, hides the menu and calls `showModal()`, and everything outside is inert. The textarea takes the focus; `check` shows the reader's errors, or the summary, the adjustment's line, a line when the scheme fills the half the page is not showing — the appearance is not changed — and a `details` panel, `panel.ts`'s, closed, holding the grouped failures and each changed colour with a swatch of each value. `apply` and `apply adjusted` store the half, choose `custom`, apply it through `applyChosenSkin` and close; `cancel` and Esc close with nothing changed. Either apply that cannot act says why, as its `aria-description` and in a visible line. The focus returns to `#settings` by the platform's own rules (Pre-flight, "What the prototype found" 5).

**FIRST PAINT NEEDS NOTHING NEW** (§9): `applyChosenSkin` already writes the resolved declarations to the cache `index.html`'s script reads, and every value in them is lowercase `#rrggbb`. `base16-prepaint.test.ts` runs that script itself, through `?raw`, after an import. **A FAILED WRITE IS NOT SILENT** (§7.1): the palette applies for this load, and a notice says so.

**THE CONTROLS GATE WIDENS** (§10): it walks `input` and `textarea` beside `button` and `select`, skips a control in a closed dialog as it skips one in a closed popover, and, while a modal is open, walks only the modal's controls. `selectLabel` becomes the label rule for every form control. The dialog is walked in Explorer alone, open and empty and after a failing scheme's check with its details open; `#format-on-blur` is walked for the first time. 6a widens the gate too, and whichever PR lands second rebases onto the other's.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=6
diff --git a/web/tests/browser/base16-import.test.ts b/web/tests/browser/base16-import.test.ts
new file mode 100644
index 0000000..537b966
--- /dev/null
+++ b/web/tests/browser/base16-import.test.ts
@@ -0,0 +1,190 @@
+import { computeAccessibleName } from 'dom-accessibility-api'
+import { beforeAll, describe, expect, it } from 'vitest'
+import { page, userEvent } from 'vitest/browser'
+import { STORAGE_KEY } from '../../src/appearance'
+import { checkScheme, readScheme } from '../../src/base16'
+import { CUSTOM_PALETTE_KEY } from '../../src/custom-palette'
+import { currentLayout, DAY, EMBER, legacyLayout, NIGHT } from '../node/base16-fixtures'
+import { SHELL, until } from './harness'
+
+/**
+ * THE BASE16 IMPORT, THROUGH ITS DIALOG (Plan 7 part 6b spec §8): opened from the settings menu, a scheme pasted,
+ * checked and applied — as it is and adjusted — or cancelled. The page is dark throughout, seeded before the mount,
+ * so a dark scheme is the half on screen and a light one is not. ONE MOUNT FOR THE FILE, and the cases run in order:
+ * each applies onto what the one before left.
+ */
+
+/** `#rrggbb` as `getComputedStyle` writes a colour. */
+const rgb = (hex: string): string => `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
+
+const dialog = () => document.querySelector<HTMLDialogElement>('dialog.base16-dialog') as HTMLDialogElement
+const inDialog = <T extends HTMLElement>(selector: string): T => dialog().querySelector<T>(selector) as T
+const text = () => inDialog<HTMLTextAreaElement>('textarea')
+const applyButton = () => inDialog<HTMLButtonElement>('button.base16-apply')
+const adjustedButton = () => inDialog<HTMLButtonElement>('button.base16-apply-adjusted')
+const said = (selector: string) => [...dialog().querySelectorAll(selector)].map((el) => el.textContent)
+const palette = () => document.querySelector<HTMLSelectElement>('#palette') as HTMLSelectElement
+const stored = () => localStorage.getItem(CUSTOM_PALETTE_KEY)
+const body = () => getComputedStyle(document.body)
+
+/** Open the dialog from the settings menu, by real clicks, and paste `scheme` into it. */
+async function openWith(scheme: string): Promise<void> {
+  await userEvent.click(document.querySelector('#settings') as HTMLElement)
+  await userEvent.click(document.querySelector('#import-base16') as HTMLElement)
+  expect(dialog().open).toBe(true)
+  await userEvent.fill(text(), scheme)
+}
+
+beforeAll(async () => {
+  await page.viewport(1280, 800)
+  localStorage.setItem(STORAGE_KEY, 'dark')
+  document.body.innerHTML = SHELL
+  await (await import('../../src/main')).ready
+})
+
+describe('the base16 import dialog', () => {
+  it('is on no surface while closed', () => {
+    expect(dialog().open).toBe(false)
+    expect(getComputedStyle(dialog()).display).toBe('none')
+    expect(dialog().getBoundingClientRect().height).toBe(0)
+  })
+
+  it('opens from the settings menu by a real click, modal, named by its heading, with the text focused', async () => {
+    await userEvent.click(document.querySelector('#settings') as HTMLElement)
+    await userEvent.click(document.querySelector('#import-base16') as HTMLElement)
+    expect(dialog().matches(':modal')).toBe(true)
+    expect(document.querySelector('#settings-menu')?.matches(':popover-open')).toBe(false)
+    expect(computeAccessibleName(dialog())).toBe('import a base16 scheme')
+    expect(document.activeElement).toBe(text())
+    expect(text().spellcheck).toBe(false)
+  })
+
+  it('offers neither apply before a check, and says why', () => {
+    for (const b of [applyButton(), adjustedButton()]) {
+      expect(b.disabled).toBe(true)
+      expect(b.getAttribute('aria-description')).toBe('check the scheme first')
+    }
+    expect(inDialog('.base16-why').textContent).toBe('check the scheme first')
+  })
+
+  it('lists what it cannot read, by key, and offers nothing to apply', async () => {
+    await userEvent.fill(text(), legacyLayout('Night', NIGHT).replace(/base0C:.*\n/, 'base0C: cyan\n'))
+    await userEvent.click(inDialog('button.base16-check'))
+    expect(said('.base16-errors li')).toEqual(['base0C is not a colour: "cyan"'])
+    expect(applyButton().getAttribute('aria-description')).toBe('the scheme could not be read')
+    expect(inDialog('.base16-why').textContent).toBe('the scheme could not be read')
+  })
+
+  it('forgets a check when the text is edited', async () => {
+    await userEvent.fill(text(), currentLayout('Night', NIGHT, 'dark'))
+    await userEvent.click(inDialog('button.base16-check'))
+    expect(applyButton().disabled).toBe(false)
+    await userEvent.type(text(), ' ')
+    expect(said('.base16-result p')).toEqual([])
+    expect(applyButton().getAttribute('aria-description')).toBe('check the scheme first')
+    await userEvent.keyboard('{Escape}')
+  })
+
+  it('applies a passing scheme: the page is drawn in it, and the palette select names it', async () => {
+    await openWith(currentLayout('Night', NIGHT, 'dark'))
+    await userEvent.click(inDialog('button.base16-check'))
+    expect(said('.base16-result p')).toEqual(['Night · dark, from the file: every contrast check passes'])
+    expect(adjustedButton().getAttribute('aria-description')).toBe('nothing to adjust — every check passes')
+    expect(dialog().querySelector('.panel')).toBeNull()
+    await userEvent.click(applyButton())
+    expect(dialog().open).toBe(false)
+    expect(document.activeElement).toBe(document.querySelector('#settings'))
+    expect(body().backgroundColor).toBe(rgb(NIGHT[0]))
+    expect(palette().value).toBe('custom')
+    expect(palette().selectedOptions[0]?.textContent).toBe('custom — dark: Night')
+    expect(JSON.parse(stored() ?? '{}').dark.adjusted).toBe(false)
+  })
+
+  it("shows a failing scheme's summary, and its failures grouped by scheme colour behind details", async () => {
+    await openWith(legacyLayout('Ember', EMBER))
+    await userEvent.click(inDialog('button.base16-check'))
+    expect(said('.base16-result > p')).toEqual([
+      'Ember · dark, detected: 17 of 35 contrast checks below WCAG AA, worst 3.31:1',
+      'apply adjusted moves 4 colours’ lightness, and every check then passes',
+    ])
+    const toggle = inDialog<HTMLButtonElement>('.panel[data-panel="base16-details"] button.panel-toggle')
+    expect(toggle.getAttribute('aria-expanded')).toBe('false')
+    expect(inDialog('.base16-details-body').hidden).toBe(true)
+    await userEvent.click(toggle)
+    expect(inDialog('.base16-details-body').hidden).toBe(false)
+    expect(said('.base16-failures li')).toHaveLength(8)
+    expect(said('.base16-failures li')[0]).toBe(
+      'base04 on base01: dim text, plain code and punctuation on panels and headers — 3.31:1, needs 4.5',
+    )
+    expect(said('.base16-changes li')).toHaveLength(4)
+    // EACH CHANGE CARRIES A SWATCH OF EACH VALUE, DRAWN IN IT, and hidden from the name: the hex text says it.
+    const swatches = [...dialog().querySelectorAll<HTMLElement>('.base16-changes li:first-child .base16-swatch')]
+    expect(swatches.map((s) => getComputedStyle(s).backgroundColor)).toEqual([rgb(EMBER[4]), rgb('#958ca7')])
+    expect(swatches.every((s) => s.getAttribute('aria-hidden') === 'true')).toBe(true)
+    expect(swatches[0]?.getBoundingClientRect().width).toBeGreaterThan(0)
+  })
+
+  it('applies it adjusted: the text is drawn in the adjusted colour, and the select says so', async () => {
+    const reading = readScheme(legacyLayout('Ember', EMBER))
+    if (!reading.ok) throw new Error('the fixture does not read')
+    const fg = checkScheme(reading.scheme).adjustment.tokens.fg
+    expect(fg).not.toBe(EMBER[5])
+    await userEvent.click(adjustedButton())
+    expect(body().color).toBe(rgb(fg))
+    expect(body().backgroundColor).toBe(rgb(EMBER[0]))
+    expect(palette().selectedOptions[0]?.textContent).toBe('custom — dark: Ember (adjusted)')
+    expect(JSON.parse(stored() ?? '{}').dark.adjusted).toBe(true)
+  })
+
+  it('changes nothing on cancel or Esc, and gives the focus back to settings', async () => {
+    const before = stored()
+    await openWith(legacyLayout('Day', DAY))
+    await userEvent.click(inDialog('button.base16-check'))
+    await userEvent.click(inDialog('button.base16-cancel'))
+    expect(dialog().open).toBe(false)
+    expect(document.activeElement).toBe(document.querySelector('#settings'))
+    await openWith(legacyLayout('Day', DAY))
+    await userEvent.click(inDialog('button.base16-check'))
+    await userEvent.keyboard('{Escape}')
+    expect(dialog().open).toBe(false)
+    expect(document.activeElement).toBe(document.querySelector('#settings'))
+    expect(stored()).toBe(before)
+    expect(body().backgroundColor).toBe(rgb(EMBER[0]))
+  })
+
+  it('says when it fills the half the page is not showing, and leaves the appearance as it is', async () => {
+    await openWith(legacyLayout('Day', DAY))
+    await userEvent.click(inDialog('button.base16-check'))
+    expect(said('.base16-elsewhere')).toEqual([
+      'fills the light palette; the page is dark now, so it shows when the appearance is light',
+    ])
+    await userEvent.click(applyButton())
+    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
+    expect(body().backgroundColor).toBe(rgb(EMBER[0]))
+    expect(palette().selectedOptions[0]?.textContent).toBe('custom — light: Day · dark: Ember (adjusted)')
+  })
+
+  it('applies a palette storage refuses for this page load, and says it will not survive a reload', async () => {
+    const setItem = localStorage.setItem
+    localStorage.setItem = (key: string, value: string) => {
+      if (key === CUSTOM_PALETTE_KEY) throw new DOMException('full', 'QuotaExceededError')
+      setItem.call(localStorage, key, value)
+    }
+    try {
+      const before = stored()
+      await openWith(currentLayout('Night', NIGHT, 'dark'))
+      await userEvent.click(inDialog('button.base16-check'))
+      await userEvent.click(applyButton())
+      await until(
+        () =>
+          document.querySelector('#notice .notice-text')?.textContent ===
+          'the imported palette could not be saved; it applies until the page is reloaded',
+        'the notice',
+      )
+      expect(body().backgroundColor).toBe(rgb(NIGHT[0]))
+      expect(stored()).toBe(before)
+    } finally {
+      localStorage.setItem = setItem
+    }
+  })
+})
diff --git a/web/tests/browser/base16-prepaint.test.ts b/web/tests/browser/base16-prepaint.test.ts
new file mode 100644
index 0000000..7c0815a
--- /dev/null
+++ b/web/tests/browser/base16-prepaint.test.ts
@@ -0,0 +1,45 @@
+import { beforeAll, describe, expect, it } from 'vitest'
+import { userEvent } from 'vitest/browser'
+import html from '../../index.html?raw'
+import { STORAGE_KEY } from '../../src/appearance'
+import { PALETTES } from '../../src/palettes'
+import { currentLayout, NIGHT } from '../node/base16-fixtures'
+import { SHELL } from './harness'
+
+/**
+ * **AN IMPORTED PALETTE IS THE NEXT LOAD'S FIRST FRAME** (Plan 7 part 6b spec §9), with `index.html`'s pre-paint
+ * script unchanged: `apply` writes the resolved palette's declarations to the cache that script reads. Here the
+ * import is made through the dialog, the palette `main.ts` wrote onto `<html>` is taken off, and the script itself —
+ * the page's own, through `?raw` — is run in this page, as a load runs it before any module.
+ */
+
+/** `#rrggbb` as `getComputedStyle` writes a colour. */
+const rgb = (hex: string): string => `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
+
+/** The one classic script in the page: the module script has a `type`. */
+const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
+
+beforeAll(async () => {
+  localStorage.setItem(STORAGE_KEY, 'dark')
+  document.body.innerHTML = SHELL
+  await (await import('../../src/main')).ready
+  await userEvent.click(document.querySelector('#settings') as HTMLElement)
+  await userEvent.click(document.querySelector('#import-base16') as HTMLElement)
+  const dialog = document.querySelector('dialog.base16-dialog') as HTMLDialogElement
+  await userEvent.fill(dialog.querySelector('textarea') as HTMLElement, currentLayout('Night', NIGHT, 'dark'))
+  await userEvent.click(dialog.querySelector('button.base16-check') as HTMLElement)
+  await userEvent.click(dialog.querySelector('button.base16-apply') as HTMLElement)
+})
+
+describe('an imported palette, at first paint', () => {
+  it('is drawn by the pre-paint script alone, from the cache the import wrote', () => {
+    expect(getComputedStyle(document.body).backgroundColor).toBe(rgb(NIGHT[0]))
+    // THE BEFORE STATE, SO THE SCRIPT IS WHAT PUTS IT BACK: with the inline palette gone, the page falls to
+    // `style.css`'s fallback, Instrument.
+    document.documentElement.removeAttribute('style')
+    expect(getComputedStyle(document.body).backgroundColor).toBe(rgb(PALETTES.instrument.dark.bg))
+    expect(script).not.toBe('')
+    new Function(script)()
+    expect(getComputedStyle(document.body).backgroundColor).toBe(rgb(NIGHT[0]))
+  })
+})
diff --git a/web/tests/browser/controls-gate.test.ts b/web/tests/browser/controls-gate.test.ts
index 4323405..f458a19 100644
--- a/web/tests/browser/controls-gate.test.ts
+++ b/web/tests/browser/controls-gate.test.ts
@@ -1,11 +1,13 @@
 import type { EditorView } from '@codemirror/view'
 import { computeAccessibleName } from 'dom-accessibility-api'
 import { afterAll, beforeAll, describe, expect, it } from 'vitest'
+import { EMBER, legacyLayout } from '../node/base16-fixtures'
 import { SHELL, until } from './harness'
 
 /**
  * **EVERY CONTROL, AS A CLASS** — umbrella §8.1, Plan 7 part 2 spec §14. Rather than one test per control,
- * this walks every button and select the page holds, with every menu opened in turn, and asserts three things
+ * this walks every button, select, input and text area the page holds, with every menu and dialog opened in turn,
+ * and asserts three things
  * of each: it has an accessible name that is not a bare glyph (rule 1), the name matches its visible label or
  * its tooltip (rule 1), and it is reachable by keyboard (rule 5). A control added later that breaks a rule
  * fails here without anyone having to remember to test it.
@@ -33,8 +35,9 @@ function nameOf(el: HTMLElement): string {
  * inside one is not a label the name has to match.
  */
 /**
- * What a sighted user reads beside a `<select>`: the text of the `<label>` wrapping it, if any, with the
- * select's own options left out.
+ * What a sighted user reads beside a form control — a `<select>`, an `<input>` or a `<textarea>`: the text of the
+ * `<label>` wrapping it, if any, with the control itself left out (Plan 7 part 6b spec §10). A select's options
+ * and a text area's text are the control's value, not its label.
  *
  * **WITHOUT THIS THE CHECK WAS A TAUTOLOGY.** It read the select's accessible NAME as its visible label
  * too, so `expect([visible, title]).toContain(name)` compared a value with itself and an `aria-label`
@@ -60,7 +63,7 @@ function selectLabel(el: HTMLElement): string {
   const label = el.closest('label')
   if (label === null) return el.title.trim()
   const copy = label.cloneNode(true) as HTMLElement
-  for (const control of copy.querySelectorAll('select, [aria-hidden="true"]')) control.remove()
+  for (const control of copy.querySelectorAll('select, input, textarea, [aria-hidden="true"]')) control.remove()
   return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
 }
 
@@ -104,6 +107,10 @@ const straySymbol = (s: string) => /[\p{So}\p{Sm}]/u.test(s.replaceAll('+', ''))
 /**
  * Every control a user can meet right now.
  *
+ * **WHILE A MODAL DIALOG IS OPEN, ONLY WHAT IS INSIDE IT** (Plan 7 part 6b spec §10). The platform makes everything
+ * outside a modal inert, so every control there would fail the focus check below for that reason alone; and a
+ * control inside a CLOSED dialog is as unreachable as one inside a closed popover.
+ *
  * **`closest('[hidden]')`, NOT `el.hidden` — the difference is a whole panel.** A collapsed or unmounted
  * panel hides its own element (`pane-chrome.ts`'s `textPanel` hides the panel until an editor is
  * mounted), and its toggle inside it reads `hidden === false` while being unreachable and unseen. The
@@ -112,8 +119,10 @@ const straySymbol = (s: string) => /[\p{So}\p{Sm}]/u.test(s.replaceAll('+', ''))
  * reachability check below mean what it says.
  */
 function controls(): HTMLElement[] {
-  return [...document.querySelectorAll<HTMLElement>('button, select')].filter((el) => {
+  const scope: ParentNode = document.querySelector('dialog:modal') ?? document
+  return [...scope.querySelectorAll<HTMLElement>('button, select, input, textarea')].filter((el) => {
     if (el.closest('[hidden]') !== null) return false
+    if (el.closest('dialog:not([open])') !== null) return false
     const popover = el.closest<HTMLElement>('[popover]')
     return popover === null || popover.matches(':popover-open')
   })
@@ -126,7 +135,7 @@ function check(where: string): void {
     expect(name, id).not.toBe('')
     expect(isGlyph(name), `${id} is a bare glyph`).toBe(false)
     expect(straySymbol(name), `${id} carries a symbol a reader would have to name aloud`).toBe(false)
-    const visible = el.tagName === 'SELECT' ? selectLabel(el) : visibleLabel(el)
+    const visible = el.matches('select, input, textarea') ? selectLabel(el) : visibleLabel(el)
     if (visible !== '' && !isGlyph(visible))
       expect([visible, el.title.trim()], `${id}: name ≠ label or tooltip`).toContain(name)
     else expect(el.title.trim(), `${id}: a glyph-only control's tooltip must be its name`).toBe(name)
@@ -320,3 +329,56 @@ describe('every control in Explorer, with the copies menu in each of its states'
     if (menu?.matches(':popover-open')) menu.hidePopover()
   })
 })
+
+/**
+ * **THE IMPORT DIALOG, IN EXPLORER ALONE**, for the copies menu's reason above: it is a modal no workspace switch
+ * touches (Plan 7 part 6b spec §10). It is walked open and empty, where both applies are disabled with a reason, and
+ * after a failing scheme's check with its details open, where `apply adjusted` can act. While it is open the walk is
+ * the dialog's alone, and this asserts that rather than trusting it.
+ */
+describe('every control in Explorer, in the settings menu and the import dialog', () => {
+  const dialog = () => document.querySelector<HTMLDialogElement>('dialog.base16-dialog') as HTMLDialogElement
+  const open = () => {
+    document.querySelector<HTMLButtonElement>('#settings')?.click()
+    document.querySelector<HTMLButtonElement>('#import-base16')?.click()
+    expect(dialog().matches(':modal'), 'the import dialog did not open').toBe(true)
+  }
+
+  // THE CHECKBOX THE GATE NEVER WALKED BEFORE IT TOOK INPUTS: `format on blur`, named by the label around it.
+  it("walks the settings menu's checkbox", () => {
+    document.querySelector<HTMLButtonElement>('#settings')?.click()
+    const box = document.querySelector<HTMLInputElement>('#format-on-blur') as HTMLInputElement
+    expect(controls()).toContain(box)
+    expect(nameOf(box)).toBe('format on blur')
+    check('#settings, its checkbox')
+    document.querySelector<HTMLElement>('#settings-menu')?.hidePopover()
+  })
+
+  it('open and empty, where neither apply can act', () => {
+    open()
+    const walked = controls()
+    expect(walked.map(nameOf)).toEqual(['base16 scheme (YAML)', 'check', 'apply', 'apply adjusted', 'cancel'])
+    check('the import dialog, empty')
+    dialog().close()
+  })
+
+  it("after a failing scheme's check, with its details open", () => {
+    open()
+    const text = dialog().querySelector('textarea') as HTMLTextAreaElement
+    text.value = legacyLayout('Ember', EMBER)
+    text.dispatchEvent(new Event('input'))
+    dialog().querySelector<HTMLButtonElement>('button.base16-check')?.click()
+    dialog().querySelector<HTMLButtonElement>('.panel[data-panel="base16-details"] button.panel-toggle')?.click()
+    expect(controls().map(nameOf)).toEqual([
+      'base16 scheme (YAML)',
+      'check',
+      'details',
+      'apply',
+      'apply adjusted',
+      'cancel',
+    ])
+    expect(dialog().querySelector<HTMLButtonElement>('button.base16-apply-adjusted')?.disabled).toBe(false)
+    check('the import dialog, checked')
+    dialog().close()
+  })
+})
diff --git a/web/tests/browser/harness.ts b/web/tests/browser/harness.ts
index a72e871..e205abd 100644
--- a/web/tests/browser/harness.ts
+++ b/web/tests/browser/harness.ts
@@ -46,6 +46,7 @@ export const SHELL = `
       <label class="skin">appearance <select id="appearance-choice"></select></label>
       <label class="skin">keymap <select id="keymap"></select></label>
         <label class="skin"><input type="checkbox" id="format-on-blur" /> format on blur</label>
+        <button type="button" id="import-base16">import base16…</button>
     </div>
   </header>
   <div id="notice" class="notice" hidden></div>
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/harness.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  1 failed | 6 passed (7)
```

Run: `cd web && pnpm exec vitest run --project browser tests/browser/base16-import.test.ts tests/browser/base16-prepaint.test.ts tests/browser/controls-gate.test.ts`

Expected: exit 1, printing:

```text
Test Files  3 failed (3)
Tests  13 failed | 31 passed | 1 skipped (45)
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=6
diff --git a/web/index.html b/web/index.html
index 6ea9bef..75cc1af 100644
--- a/web/index.html
+++ b/web/index.html
@@ -60,6 +60,7 @@
         <label class="skin">appearance <select id="appearance-choice"></select></label>
         <label class="skin">keymap <select id="keymap"></select></label>
         <label class="skin"><input type="checkbox" id="format-on-blur" /> format on blur</label>
+        <button type="button" id="import-base16">import base16…</button>
       </div>
     </header>
     <div id="notice" class="notice" hidden></div>
diff --git a/web/src/base16-dialog.ts b/web/src/base16-dialog.ts
new file mode 100644
index 0000000..6c2aee3
--- /dev/null
+++ b/web/src/base16-dialog.ts
@@ -0,0 +1,194 @@
+import {
+  adjustLine,
+  checkScheme,
+  failureLines,
+  type MovedColour,
+  movedColours,
+  movedLine,
+  passes,
+  readScheme,
+  type SchemeCheck,
+  type SchemeVariant,
+  summaryLines,
+} from './base16'
+import type { CustomHalf } from './custom-palette'
+import { createPanel } from './panel'
+
+/**
+ * THE BASE16 IMPORT DIALOG (Plan 7 part 6b spec §8): a native modal `<dialog>` the settings menu's `import base16…`
+ * opens. A scheme is pasted, checked — its name, its variant and how it measures against the floors the built-ins
+ * meet — and applied as it is or adjusted, into the half of the `custom` palette its variant names.
+ *
+ * **MODAL, SO EVERYTHING OUTSIDE IT IS INERT WHILE IT IS OPEN**, the header's menus and the notice line included.
+ *
+ * **A CLOSE GIVES THE FOCUS TO `#settings` BY THE PLATFORM'S OWN RULES, AND NOTHING HERE MOVES IT.** The item that
+ * opens the dialog sits in the settings popover, which `main.ts` hides first; hiding a popover that holds the focus
+ * hands it back to the popover's invoker, `#settings`, and closing a modal dialog restores whatever held the focus
+ * before `showModal`. A `close` handler focusing `#settings` was written first and changed nothing a test could see.
+ *
+ * **A CONTROL THAT CANNOT ACT SAYS WHY** (umbrella §4 rule 4), as *edit a copy* does: the reason as its
+ * `aria-description` and in a visible line under the actions.
+ */
+
+export type Base16DialogDeps = {
+  /** The half the page shows now: `light` or `dark`, whatever the appearance setting resolves to. */
+  readonly shown: () => SchemeVariant
+  /** Store `half` as `variant`'s half of the `custom` palette, choose `custom`, and apply it. */
+  readonly apply: (variant: SchemeVariant, half: CustomHalf) => void
+}
+
+export type Base16Dialog = {
+  readonly el: HTMLDialogElement
+  /** Open it, modal, with an empty scheme and nothing checked. */
+  open(): void
+}
+
+const CHECK_FIRST = 'check the scheme first'
+const UNREADABLE = 'the scheme could not be read'
+const NOTHING_TO_ADJUST = 'nothing to adjust — every check passes'
+
+function element<K extends keyof HTMLElementTagNameMap>(
+  tag: K,
+  className: string,
+  text = '',
+): HTMLElementTagNameMap[K] {
+  const el = document.createElement(tag)
+  el.className = className
+  el.textContent = text
+  return el
+}
+
+function button(className: string, text: string): HTMLButtonElement {
+  const b = element('button', className, text)
+  b.type = 'button'
+  return b
+}
+
+/** A swatch of `hex`, drawn from the data the way `skin.ts`'s `applySkin` sets a token, and hidden: the hex text says it. */
+function swatch(hex: string): HTMLElement {
+  const s = element('span', 'base16-swatch')
+  s.setAttribute('aria-hidden', 'true')
+  s.style.backgroundColor = hex
+  return s
+}
+
+/** One changed colour as a list item: a swatch of each value, then `base08 #bf616a → #f59199, as error text`. */
+function changeItem(m: MovedColour): HTMLLIElement {
+  const li = element('li', 'base16-change')
+  li.append(swatch(m.from), swatch(m.to), document.createTextNode(movedLine(m)))
+  return li
+}
+
+export function createBase16Dialog(deps: Base16DialogDeps): Base16Dialog {
+  const dialog = element('dialog', 'base16-dialog')
+  const heading = element('h2', 'base16-heading', 'import a base16 scheme')
+  heading.id = 'base16-heading'
+  dialog.setAttribute('aria-labelledby', heading.id)
+
+  const field = element('label', 'base16-field', 'base16 scheme (YAML)')
+  const text = element('textarea', 'base16-text')
+  text.spellcheck = false
+  text.rows = 12
+  field.append(text)
+
+  const check = button('base16-check', 'check')
+  const result = element('div', 'base16-result')
+  const apply = button('base16-apply', 'apply')
+  const adjusted = button('base16-apply-adjusted', 'apply adjusted')
+  const cancel = button('base16-cancel', 'cancel')
+  const actions = element('div', 'base16-actions')
+  actions.append(apply, adjusted, cancel)
+  const why = element('p', 'base16-why')
+  dialog.append(heading, field, check, result, actions, why)
+
+  /** The check the applies act on: `null` before one, after an edit, and when the text did not read. */
+  let checked: SchemeCheck | null = null
+
+  const able = (b: HTMLButtonElement, reason: string | null): void => {
+    b.disabled = reason !== null
+    if (reason === null) b.removeAttribute('aria-description')
+    else b.setAttribute('aria-description', reason)
+  }
+  /** Each apply's reason, or `null` where it can act; the visible line says each reason once. */
+  const allow = (plain: string | null, adjust: string | null): void => {
+    able(apply, plain)
+    able(adjusted, adjust)
+    const reasons = [...new Set([plain, adjust].filter((r) => r !== null))]
+    why.textContent = reasons.join(' · ')
+    why.hidden = reasons.length === 0
+  }
+
+  const reset = (): void => {
+    checked = null
+    result.replaceChildren()
+    allow(CHECK_FIRST, CHECK_FIRST)
+  }
+
+  const show = (): void => {
+    const reading = readScheme(text.value)
+    if (!reading.ok) {
+      checked = null
+      const errors = element('ul', 'base16-errors')
+      errors.append(...reading.errors.map((e) => element('li', '', e)))
+      result.replaceChildren(errors)
+      allow(UNREADABLE, UNREADABLE)
+      return
+    }
+    const c = checkScheme(reading.scheme)
+    checked = c
+    const lines = summaryLines(c).map((l) => element('p', 'base16-summary', l))
+    const adjusting = adjustLine(c)
+    if (adjusting !== null) lines.push(element('p', 'base16-adjusts', adjusting))
+    const now = deps.shown()
+    const { variant } = reading.scheme
+    if (variant !== now) {
+      lines.push(
+        element(
+          'p',
+          'base16-elsewhere',
+          `fills the ${variant} palette; the page is ${now} now, so it shows when the appearance is ${variant}`,
+        ),
+      )
+    }
+    result.replaceChildren(...lines)
+    if (!passes(c)) {
+      const body = element('div', 'base16-details-body')
+      const failures = element('ul', 'base16-failures')
+      failures.append(...failureLines(c).map((l) => element('li', '', l)))
+      const changes = element('ul', 'base16-changes')
+      changes.append(...movedColours(c.scheme.colours, c.adjustment.tokens).map(changeItem))
+      body.append(failures, element('p', 'base16-changes-label', 'changes'), changes)
+      result.append(createPanel({ name: 'base16-details', label: 'details', body, open: false }).el)
+    }
+    allow(null, passes(c) ? NOTHING_TO_ADJUST : null)
+  }
+
+  const commit = (adjust: boolean): void => {
+    if (checked === null) return
+    const { scheme, tokens, adjustment } = checked
+    deps.apply(scheme.variant, {
+      name: scheme.name,
+      colours: scheme.colours,
+      tokens: adjust ? adjustment.tokens : tokens,
+      adjusted: adjust,
+    })
+    dialog.close()
+  }
+
+  check.addEventListener('click', show)
+  text.addEventListener('input', reset)
+  apply.addEventListener('click', () => commit(false))
+  adjusted.addEventListener('click', () => commit(true))
+  cancel.addEventListener('click', () => dialog.close())
+  reset()
+
+  return {
+    el: dialog,
+    open() {
+      text.value = ''
+      reset()
+      dialog.showModal()
+      text.focus()
+    },
+  }
+}
diff --git a/web/src/main.ts b/web/src/main.ts
index 09cde36..29b57fb 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -14,11 +14,18 @@ import {
 } from './appearance'
 import type { AsmPane } from './asm-pane'
 import { showBanner } from './banner'
+import { createBase16Dialog } from './base16-dialog'
 import { bufferList } from './buffer-list'
 import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from './buffers-store'
 import { type CaptureTable, classMapFrom, createGrammarRegistry, treeSitterColour } from './colour'
 import { createCompile } from './compile'
-import { CUSTOM_PALETTE_KEY, parseCustomPalette } from './custom-palette'
+import {
+  CUSTOM_PALETTE_KEY,
+  type CustomPalette,
+  parseCustomPalette,
+  serializeCustomPalette,
+  withHalf,
+} from './custom-palette'
 import { lspLintRanges } from './diagnostics'
 import { createDraw } from './draw'
 import { createEditorCustody } from './editor-custody'
@@ -373,7 +380,7 @@ async function main(): Promise<EditorView> {
   for (const id of STYLE_IDS) styleSelect.append(new Option(STYLE_LABELS[id], id))
   let style = readStyle(readSkinStorage(STYLE_KEY))
   /** The imported palette (Plan 7 part 6b spec §7), or `null` when nothing is imported. */
-  const custom = parseCustomPalette(readSkinStorage(CUSTOM_PALETTE_KEY))
+  let custom = parseCustomPalette(readSkinStorage(CUSTOM_PALETTE_KEY))
   let paletteChoice = readPaletteChoice(readSkinStorage(PALETTE_KEY), custom)
   // `custom` IS LISTED WHILE THE STORE HOLDS A HALF, after the built-in choices, under its halves' names (spec §7.2).
   const listPalettes = (): void => {
@@ -400,6 +407,42 @@ async function main(): Promise<EditorView> {
     writeSkinStorage(PALETTE_KEY, paletteChoice)
     applyChosenSkin()
   })
+  /**
+   * The imported palette's write, which says whether it held. **NOT SILENT, UNLIKE THE CHOICES'** (spec §7.1): a
+   * failed write here loses a scheme the user pasted in, so the caller says so.
+   */
+  const writeCustom = (next: CustomPalette): boolean => {
+    try {
+      localStorage.setItem(CUSTOM_PALETTE_KEY, serializeCustomPalette(next))
+      return true
+    } catch {
+      return false
+    }
+  }
+
+  // THE BASE16 IMPORT (Plan 7 part 6b spec §8): the settings menu's last item opens a modal dialog, appended to
+  // `<body>` here, closed. Queried here rather than with the mount points above, which the header's own buttons share.
+  const importButton = document.querySelector<HTMLButtonElement>('#import-base16')
+  if (importButton === null) throw new Error('the page is missing a mount point')
+  const base16 = createBase16Dialog({
+    shown: () =>
+      appearance === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : appearance,
+    apply: (variant, half) => {
+      custom = withHalf(custom, variant, half)
+      paletteChoice = 'custom'
+      writeSkinStorage(PALETTE_KEY, paletteChoice)
+      if (!writeCustom(custom)) {
+        notices.notify('the imported palette could not be saved; it applies until the page is reloaded')
+      }
+      listPalettes()
+      applyChosenSkin()
+    },
+  })
+  document.body.append(base16.el)
+  importButton.addEventListener('click', () => {
+    settingsMenu.hidePopover()
+    base16.open()
+  })
 
   // THE ONE PLACE THE APP CAN FAIL TO START. `init()` fetches the wasm; a worker constructed against
   // a missing module fails the same way. PR 3c had no surface for either and the failure was a blank
diff --git a/web/src/style.css b/web/src/style.css
index 7a97dc3..64b263b 100644
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -1601,6 +1601,103 @@ main {
   border: 0;
 }
 
+/* THE BASE16 IMPORT DIALOG (Plan 7 part 6b spec §8), a native modal `<dialog>` appended to `<body>`. Its `display`
+   is set on `[open]` alone, for `.header-menu.settings`' reason: a closed dialog is hidden by a user-agent rule, and
+   any author `display` on the bare class beats it. EVERY COLOUR IS A TOKEN — the backdrop is the page's own colour
+   mixed with `transparent`, and a swatch's colour is set from the data, as `applySkin` sets a token. */
+.base16-dialog {
+  width: min(46rem, calc(100vw - 2 * var(--space-3)));
+  max-height: calc(100vh - 2 * var(--space-3));
+  overflow: auto;
+  padding: var(--space-3);
+  border: 1px solid var(--rule);
+  border-radius: var(--radius);
+  background: var(--bg-raised);
+  color: var(--fg);
+}
+.base16-dialog[open] {
+  display: grid;
+  gap: var(--space-2);
+}
+.base16-dialog::backdrop {
+  background: color-mix(in oklab, var(--bg) 70%, transparent);
+}
+.base16-heading {
+  margin: 0;
+  font-size: var(--step-1);
+  font-weight: 600;
+}
+.base16-field {
+  display: grid;
+  gap: var(--space-1);
+  color: var(--fg-dim);
+}
+.base16-text {
+  font: var(--step--1) / 1.4 var(--font-mono);
+  padding: var(--space-2);
+  border: 1px solid var(--rule);
+  border-radius: var(--radius);
+  background: var(--bg);
+  color: var(--fg);
+  resize: vertical;
+}
+.base16-check,
+.base16-actions button {
+  justify-self: start;
+  font: inherit;
+  padding: 0.15em 0.6em;
+  border: 1px solid var(--fg-dim);
+  border-radius: var(--radius);
+  background: transparent;
+  color: inherit;
+  cursor: pointer;
+}
+.base16-check:disabled,
+.base16-actions button:disabled {
+  opacity: 0.55;
+  cursor: default;
+}
+.base16-actions {
+  display: flex;
+  flex-wrap: wrap;
+  gap: var(--space-2);
+}
+.base16-result p,
+.base16-why {
+  margin: 0;
+}
+.base16-why,
+.base16-elsewhere {
+  color: var(--fg-dim);
+  font-size: var(--step--1);
+}
+.base16-errors {
+  margin: 0;
+  color: var(--error);
+}
+.base16-details-body ul {
+  margin: var(--space-1) 0;
+  padding-inline-start: var(--space-3);
+  font-size: var(--step--1);
+}
+.base16-changes {
+  list-style: none;
+}
+.base16-changes-label {
+  color: var(--fg-dim);
+  font-size: var(--step--2);
+  text-transform: var(--label-transform);
+  letter-spacing: var(--label-tracking);
+}
+.base16-swatch {
+  display: inline-block;
+  width: 0.9em;
+  height: 0.9em;
+  margin-inline-end: 0.3em;
+  border: 1px solid var(--rule);
+  vertical-align: -0.1em;
+}
+
 /* THE INSPECTOR (spec §9): a fixed-width right-hand column, collapsible to its header, scrolling its own
    rows. `panel.ts` builds the header; this decides the column. NOTHING HERE IS A NEW COLOUR. */
 .inspector {
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  56 passed (56)
Tests  830 passed (830)
```

Run: `cd web && pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
Test Files  124 passed (124)
Tests  814 passed (814)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command; after each, `git status` shows only this task's changes). In the replay, 15 of 15 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | the gate's modal scoping removed — `tests/browser/controls-gate.test.ts`: `const scope: ParentNode = document.querySelector('dialog:modal') ?? document` → `const scope: ParentNode = document` | `cd web && pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > after a failing scheme's check, with its details open`, `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > open and empty, where neither apply can act` |
| 2 | the gate walks a closed dialog's controls — `tests/browser/controls-gate.test.ts`: `if (el.closest('dialog:not([open])') !== null) return false` → (deleted) | `cd web && pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > every control in 'Debugger' > on the page as it stands`, `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with #buffers open`, `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with #new-view open`, `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with #settings open`, `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with #workspace open`, `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with a split submenu open, where splits apply`, `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with every view's title and ⋯ menu open`, `tests/browser/controls-gate.test.ts > every control in 'Explorer' > on the page as it stands`, `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with #buffers open`, `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with #new-view open`, `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with #settings open`, `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with #workspace open`, `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with a split submenu open, where splits apply`, `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with every view's title and ⋯ menu open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > on the page as it stands`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with #buffers open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with #new-view open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with #settings open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with #workspace open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with a split submenu open, where splits apply`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with every view's title and ⋯ menu open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > on the page as it stands`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with #buffers open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with #new-view open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with #settings open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with #workspace open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with a split submenu open, where splits apply`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with every view's title and ⋯ menu open`, `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > walks the settings menu's checkbox`, `tests/browser/controls-gate.test.ts > every control in Explorer, with the copies menu in each of its states > on the page as it stands, with a notice offering undo`, `tests/browser/controls-gate.test.ts > every control in Explorer, with the copies menu in each of its states > with a paused copy in the copies menu` |
| 3 | the gate walks buttons and selects only — `tests/browser/controls-gate.test.ts`: `scope.querySelectorAll<HTMLElement>('button, select, input, textarea')` → `scope.querySelectorAll<HTMLElement>('button, select')` | `cd web && pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > after a failing scheme's check, with its details open`, `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > open and empty, where neither apply can act`, `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > walks the settings menu's checkbox` |
| 4 | a form control's label read as a button's — `tests/browser/controls-gate.test.ts`: `const visible = el.matches('select, input, textarea') ? selectLabel(el) : visibleLabel(el)` → `const visible = el.tagName === 'SELECT' ? selectLabel(el) : visibleLabel(el)` | `cd web && pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with #settings open`, `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with #settings open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with #settings open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with #settings open`, `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > after a failing scheme's check, with its details open`, `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > open and empty, where neither apply can act`, `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > walks the settings menu's checkbox` |
| 5 | apply does not choose `custom` — `src/main.ts`: `custom = withHalf(custom, variant, half) ⏎ paletteChoice = 'custom'` → `custom = withHalf(custom, variant, half)` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-import.test.ts` | `tests/browser/base16-import.test.ts > the base16 import dialog > applies a palette storage refuses for this page load, and says it will not survive a reload`, `tests/browser/base16-import.test.ts > the base16 import dialog > applies a passing scheme: the page is drawn in it, and the palette select names it`, `tests/browser/base16-import.test.ts > the base16 import dialog > applies it adjusted: the text is drawn in the adjusted colour, and the select says so`, `tests/browser/base16-import.test.ts > the base16 import dialog > changes nothing on cancel or Esc, and gives the focus back to settings`, `tests/browser/base16-import.test.ts > the base16 import dialog > says when it fills the half the page is not showing, and leaves the appearance as it is` |
| 6 | apply adjusted stores the tokens unadjusted — `src/base16-dialog.ts`: `tokens: adjust ? adjustment.tokens : tokens,` → `tokens,` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-import.test.ts` | `tests/browser/base16-import.test.ts > the base16 import dialog > applies it adjusted: the text is drawn in the adjusted colour, and the select says so` |
| 7 | apply adjusted offered for a scheme that passes — `src/base16-dialog.ts`: `allow(null, passes(c) ? NOTHING_TO_ADJUST : null)` → `allow(null, null)` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-import.test.ts` | `tests/browser/base16-import.test.ts > the base16 import dialog > applies a passing scheme: the page is drawn in it, and the palette select names it`, `tests/browser/base16-import.test.ts > the base16 import dialog > applies it adjusted: the text is drawn in the adjusted colour, and the select says so`, `tests/browser/base16-import.test.ts > the base16 import dialog > changes nothing on cancel or Esc, and gives the focus back to settings`, `tests/browser/base16-import.test.ts > the base16 import dialog > says when it fills the half the page is not showing, and leaves the appearance as it is`, `tests/browser/base16-import.test.ts > the base16 import dialog > shows a failing scheme's summary, and its failures grouped by scheme colour behind details` |
| 8 | an edit does not forget the check — `src/base16-dialog.ts`: `text.addEventListener('input', reset)` → (deleted) | `cd web && pnpm exec vitest run --project browser tests/browser/base16-import.test.ts` | `tests/browser/base16-import.test.ts > the base16 import dialog > applies a palette storage refuses for this page load, and says it will not survive a reload`, `tests/browser/base16-import.test.ts > the base16 import dialog > applies a passing scheme: the page is drawn in it, and the palette select names it`, `tests/browser/base16-import.test.ts > the base16 import dialog > applies it adjusted: the text is drawn in the adjusted colour, and the select says so`, `tests/browser/base16-import.test.ts > the base16 import dialog > changes nothing on cancel or Esc, and gives the focus back to settings`, `tests/browser/base16-import.test.ts > the base16 import dialog > forgets a check when the text is edited`, `tests/browser/base16-import.test.ts > the base16 import dialog > says when it fills the half the page is not showing, and leaves the appearance as it is`, `tests/browser/base16-import.test.ts > the base16 import dialog > shows a failing scheme's summary, and its failures grouped by scheme colour behind details` |
| 9 | the other-appearance line never shown — `src/base16-dialog.ts`: `if (variant !== now) {` → `if (variant !== now && false) {` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-import.test.ts` | `tests/browser/base16-import.test.ts > the base16 import dialog > applies a palette storage refuses for this page load, and says it will not survive a reload`, `tests/browser/base16-import.test.ts > the base16 import dialog > says when it fills the half the page is not showing, and leaves the appearance as it is` |
| 10 | a failed write says nothing — `src/main.ts`: `notices.notify('the imported palette could not be saved; it applies until the page is reloaded')` → `void 0` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-import.test.ts` | `tests/browser/base16-import.test.ts > the base16 import dialog > applies a palette storage refuses for this page load, and says it will not survive a reload` |
| 11 | the dialog painted while closed — `src/style.css`: `.base16-dialog[open] { ⏎ display: grid;` → `.base16-dialog { ⏎ display: grid;` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-import.test.ts` | `tests/browser/base16-import.test.ts > the base16 import dialog > is on no surface while closed` |
| 12 | the details panel open by default — `src/base16-dialog.ts`: `result.append(createPanel({ name: 'base16-details', label: 'details', body, open: false }).el)` → `result.append(createPanel({ name: 'base16-details', label: 'details', body, open: true }).el)` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-import.test.ts` | `tests/browser/base16-import.test.ts > the base16 import dialog > shows a failing scheme's summary, and its failures grouped by scheme colour behind details` |
| 13 | a swatch not drawn in its colour — `src/base16-dialog.ts`: `s.style.backgroundColor = hex` → (deleted) | `cd web && pnpm exec vitest run --project browser tests/browser/base16-import.test.ts` | `tests/browser/base16-import.test.ts > the base16 import dialog > shows a failing scheme's summary, and its failures grouped by scheme colour behind details` |
| 14 | apply repaints without refreshing the pre-paint cache — `src/main.ts`: `listPalettes() ⏎ applyChosenSkin() ⏎ }, ⏎ })` → `listPalettes() ⏎ applySkin(document.documentElement, style, paletteChoice, custom) ⏎ }, ⏎ })` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-prepaint.test.ts` | `tests/browser/base16-prepaint.test.ts > an imported palette, at first paint > is drawn by the pre-paint script alone, from the cache the import wrote` |
| 15 | apply does not relist the palettes — `src/main.ts`: `listPalettes() ⏎ applyChosenSkin() ⏎ }, ⏎ })` → `applyChosenSkin() ⏎ }, ⏎ })` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-import.test.ts` | `tests/browser/base16-import.test.ts > the base16 import dialog > applies a passing scheme: the page is drawn in it, and the palette select names it`, `tests/browser/base16-import.test.ts > the base16 import dialog > applies it adjusted: the text is drawn in the adjusted colour, and the select says so`, `tests/browser/base16-import.test.ts > the base16 import dialog > says when it fills the half the page is not showing, and leaves the appearance as it is` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
`import base16…` in the settings menu opens a modal dialog: a scheme checked, then applied as it is or adjusted

`base16-dialog.ts` builds one native `<dialog>` (Plan 7 part 6b spec
§8). A pasted scheme is checked: its errors by key, or its summary,
what `apply adjusted` would do, a line when it fills the half the page
is not showing, and its failures grouped by scheme colour behind a
closed `details` panel, each changed colour with a swatch of each value.
`apply` and `apply adjusted` store the half, choose `custom` and apply
it through `applyChosenSkin`, which refreshes the pre-paint cache, so
the next load's first frame is the import with `index.html`'s script
unchanged (§9); a failed write says the palette lasts until a reload.
Either apply that cannot act says why. The controls gate walks inputs
and text areas, skips a closed dialog, and walks only an open modal's
controls, where everything outside it is inert (§10).
````

---

### Task 7: The import dialog shows what is stored, each half with a `remove`, and a removal offers `undo`

**Files:**
- Modify: `web/src/base16-dialog.ts` (the `now` line), `web/src/main.ts` (the style-and-palette block: `writeCustom` removes the key for `null`; `remove`, its `undo`, and an apply ending the offer), `web/src/notice.ts` (`dismiss`'s doc), `web/src/style.css` (the same block)
- Modify (tests): `web/tests/node/base16-fixtures.ts` (`adjustedHalf`), `web/tests/browser/controls-gate.test.ts` (the dialog with both halves stored)
- Test: `web/tests/browser/base16-remove.test.ts`

**Interfaces:**
- Consumes Task 4's `movedColours`, Task 5's `withoutHalf`, Task 6's dialog.
- Produces `Base16DialogDeps`' `stored(): CustomPalette | null` and `remove(variant: SchemeVariant): void`.

**THE `now` LINE** (spec §8.2), when a half is stored: `now: light — Day · dark — Ember, adjusted`, a `remove` beside each half, and, for an adjusted half, a closed `changes` panel listing the colours it moved, read off its stored colours and tokens. A `remove`'s text is `remove`; its name and tooltip say which half it acts on — `remove the dark palette, Ember` — which is what the controls gate accepts for a label that alone does not say what it acts on.

**A REMOVE** (§8.5) deletes that half and keeps the other. With the other left, the choice stays `custom` and the removed half falls back to the style's own; with none left the key goes, and a `custom` choice becomes `match` while any other stays. `applyChosenSkin` runs either way. The dialog closes, because the notice line is outside the modal and inert while it is open, and the notice offers `undo`: `dark palette Ember removed`. `undo` puts the half back exactly as it was stored and the choice as it was. **The offer ends at the next change to the store**: a second remove's notice replaces it, and an apply dismisses it — `notice.ts`'s `dismiss`, whose doc said nothing outside the module called it. A removal storage refuses lasts this load, and its notice says the palette comes back on reload and still offers `undo`.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=7
diff --git a/web/tests/browser/base16-remove.test.ts b/web/tests/browser/base16-remove.test.ts
new file mode 100644
index 0000000..da8d986
--- /dev/null
+++ b/web/tests/browser/base16-remove.test.ts
@@ -0,0 +1,171 @@
+import { beforeAll, describe, expect, it } from 'vitest'
+import { userEvent } from 'vitest/browser'
+import { STORAGE_KEY } from '../../src/appearance'
+import { CUSTOM_PALETTE_KEY, serializeCustomPalette } from '../../src/custom-palette'
+import { PALETTES } from '../../src/palettes'
+import { PALETTE_KEY } from '../../src/skin'
+import { adjustedHalf, currentLayout, DAY, EMBER, NIGHT, storedHalf } from '../node/base16-fixtures'
+import { SHELL, until } from './harness'
+
+/**
+ * A STORED HALF, SHOWN AND REMOVED, WITH ITS UNDO (Plan 7 part 6b spec §8.2, §8.5). The page is dark and holds a
+ * light half, `Day`, and an adjusted dark half, `Ember`, chosen as `custom` — what two imports leave, seeded before
+ * the mount. ONE MOUNT FOR THE FILE, and the cases run in order, each on what the one before left.
+ */
+
+/** `#rrggbb` as `getComputedStyle` writes a colour. */
+const rgb = (hex: string): string => `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
+
+const SEEDED = serializeCustomPalette({ light: storedHalf('Day', DAY), dark: adjustedHalf('Ember', EMBER, 'dark') })
+
+const dialog = () => document.querySelector<HTMLDialogElement>('dialog.base16-dialog') as HTMLDialogElement
+const removeButtons = () => [...dialog().querySelectorAll<HTMLButtonElement>('button.base16-remove')]
+const palette = () => document.querySelector<HTMLSelectElement>('#palette') as HTMLSelectElement
+const options = () => [...palette().options].map((o) => o.textContent)
+const notice = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
+const undo = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
+const stored = () => localStorage.getItem(CUSTOM_PALETTE_KEY)
+const bg = () => getComputedStyle(document.body).backgroundColor
+
+async function open(): Promise<void> {
+  await userEvent.click(document.querySelector('#settings') as HTMLElement)
+  await userEvent.click(document.querySelector('#import-base16') as HTMLElement)
+  expect(dialog().open).toBe(true)
+}
+
+/** Open the dialog and click the remove named `name`. */
+async function remove(name: string): Promise<void> {
+  await open()
+  const button = removeButtons().find((b) => b.getAttribute('aria-label') === name)
+  if (button === undefined)
+    throw new Error(
+      `no ${name} among ${removeButtons()
+        .map((b) => b.title)
+        .join(', ')}`,
+    )
+  await userEvent.click(button)
+}
+
+beforeAll(async () => {
+  localStorage.setItem(CUSTOM_PALETTE_KEY, SEEDED)
+  localStorage.setItem(PALETTE_KEY, 'custom')
+  localStorage.setItem(STORAGE_KEY, 'dark')
+  document.body.innerHTML = SHELL
+  await (await import('../../src/main')).ready
+})
+
+describe('a stored half, in the import dialog', () => {
+  it('is named in the now line, with a remove beside it naming its half, and the text still takes the focus', async () => {
+    await open()
+    expect(dialog().querySelector('.base16-now-line')?.textContent).toBe(
+      'now: light — Day remove · dark — Ember, adjusted remove',
+    )
+    expect(removeButtons().map((b) => [b.textContent, b.getAttribute('aria-label'), b.title])).toEqual([
+      ['remove', 'remove the light palette, Day', 'remove the light palette, Day'],
+      ['remove', 'remove the dark palette, Ember', 'remove the dark palette, Ember'],
+    ])
+    expect(document.activeElement).toBe(dialog().querySelector('textarea'))
+  })
+
+  it('lists the colours an adjusted half moved, read from what is stored, behind changes', async () => {
+    const toggle = dialog().querySelector<HTMLElement>('.panel[data-panel="base16-now-changes"] button.panel-toggle')
+    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
+    await userEvent.click(toggle as HTMLElement)
+    expect([...dialog().querySelectorAll('.base16-now-changes li')].map((li) => li.textContent)).toEqual([
+      'base04 #7e7590 → #958ca7, as dim text, plain code and punctuation',
+      'base05 #8a829a → #958ca5, as text and names',
+      'base08 #c06070 → #d57382, as error text',
+      'base0E #9070a0 → #a584b5, as accents and keywords',
+    ])
+    await userEvent.keyboard('{Escape}')
+  })
+})
+
+describe('removing a half', () => {
+  it('deletes it and keeps the other: the choice stays custom, and the page falls back where it was', async () => {
+    expect(bg()).toBe(rgb(EMBER[0]))
+    await remove('remove the dark palette, Ember')
+    expect(dialog().open).toBe(false)
+    expect(document.activeElement).toBe(document.querySelector('#settings'))
+    expect(JSON.parse(stored() ?? '{}')).toEqual({ version: 1, light: storedHalf('Day', DAY) })
+    expect(palette().value).toBe('custom')
+    expect(palette().selectedOptions[0]?.textContent).toBe('custom — light: Day')
+    expect(bg()).toBe(rgb(PALETTES.instrument.dark.bg))
+    expect(notice()).toBe('dark palette Ember removed')
+  })
+
+  it('is undone exactly: the half as it was stored, adjusted included', async () => {
+    await userEvent.click(undo() as HTMLElement)
+    expect(stored()).toBe(SEEDED)
+    expect(palette().selectedOptions[0]?.textContent).toBe('custom — light: Day · dark: Ember (adjusted)')
+    expect(bg()).toBe(rgb(EMBER[0]))
+  })
+
+  it('removes the key with the last half, and a custom choice becomes match', async () => {
+    await remove('remove the light palette, Day')
+    await remove('remove the dark palette, Ember')
+    expect(stored()).toBeNull()
+    expect(options()).toEqual(['match style', 'Paper', 'Terminal', 'Instrument'])
+    expect(palette().value).toBe('match')
+    expect(localStorage.getItem(PALETTE_KEY)).toBe('match')
+    expect(bg()).toBe(rgb(PALETTES.instrument.dark.bg))
+    await open()
+    expect(dialog().querySelector<HTMLElement>('.base16-now')?.hidden).toBe(true)
+    await userEvent.keyboard('{Escape}')
+  })
+
+  it('puts back a custom choice the last half’s removal made match, on undo', async () => {
+    await userEvent.click(undo() as HTMLElement)
+    expect(palette().value).toBe('custom')
+    expect(palette().selectedOptions[0]?.textContent).toBe('custom — dark: Ember (adjusted)')
+    expect(bg()).toBe(rgb(EMBER[0]))
+  })
+
+  it('ends its undo at the next import', async () => {
+    await remove('remove the dark palette, Ember')
+    expect(undo()).not.toBeNull()
+    await open()
+    await userEvent.fill(dialog().querySelector('textarea') as HTMLElement, currentLayout('Night', NIGHT, 'dark'))
+    await userEvent.click(dialog().querySelector('button.base16-check') as HTMLElement)
+    await userEvent.click(dialog().querySelector('button.base16-apply') as HTMLElement)
+    expect(undo()).toBeNull()
+    expect(palette().selectedOptions[0]?.textContent).toBe('custom — dark: Night')
+  })
+
+  it('leaves a choice that was not custom as it was, when the last half goes', async () => {
+    palette().value = 'terminal'
+    palette().dispatchEvent(new Event('change'))
+    await remove('remove the dark palette, Night')
+    expect(stored()).toBeNull()
+    expect(palette().value).toBe('terminal')
+    expect(bg()).toBe(rgb(PALETTES.terminal.dark.bg))
+  })
+
+  it('takes effect for this load when storage refuses it, says it comes back on reload, and still offers undo', async () => {
+    await userEvent.click(undo() as HTMLElement)
+    const before = stored()
+    const setItem = localStorage.setItem
+    const removeItem = localStorage.removeItem
+    localStorage.setItem = (key: string, value: string) => {
+      if (key === CUSTOM_PALETTE_KEY) throw new DOMException('full', 'QuotaExceededError')
+      setItem.call(localStorage, key, value)
+    }
+    localStorage.removeItem = (key: string) => {
+      if (key === CUSTOM_PALETTE_KEY) throw new DOMException('refused', 'SecurityError')
+      removeItem.call(localStorage, key)
+    }
+    try {
+      await remove('remove the dark palette, Night')
+      await until(
+        () => notice() === 'the removal could not be saved; the palette comes back when the page is reloaded',
+        'the notice',
+      )
+      expect(undo()).not.toBeNull()
+      expect(stored()).toBe(before)
+      expect(options()).toHaveLength(4)
+    } finally {
+      localStorage.setItem = setItem
+      localStorage.removeItem = removeItem
+    }
+  })
+})
diff --git a/web/tests/browser/controls-gate.test.ts b/web/tests/browser/controls-gate.test.ts
index f458a19..c372311 100644
--- a/web/tests/browser/controls-gate.test.ts
+++ b/web/tests/browser/controls-gate.test.ts
@@ -1,7 +1,7 @@
 import type { EditorView } from '@codemirror/view'
 import { computeAccessibleName } from 'dom-accessibility-api'
 import { afterAll, beforeAll, describe, expect, it } from 'vitest'
-import { EMBER, legacyLayout } from '../node/base16-fixtures'
+import { currentLayout, DAY, EMBER, legacyLayout, NIGHT } from '../node/base16-fixtures'
 import { SHELL, until } from './harness'
 
 /**
@@ -332,9 +332,10 @@ describe('every control in Explorer, with the copies menu in each of its states'
 
 /**
  * **THE IMPORT DIALOG, IN EXPLORER ALONE**, for the copies menu's reason above: it is a modal no workspace switch
- * touches (Plan 7 part 6b spec §10). It is walked open and empty, where both applies are disabled with a reason, and
- * after a failing scheme's check with its details open, where `apply adjusted` can act. While it is open the walk is
- * the dialog's alone, and this asserts that rather than trusting it.
+ * touches (Plan 7 part 6b spec §10). It is walked open and empty, where both applies are disabled with a reason;
+ * after a failing scheme's check with its details open, where `apply adjusted` can act; and with both halves stored,
+ * where each `remove` in the now line is named by its half. While it is open the walk is the dialog's alone, and this
+ * asserts that rather than trusting it.
  */
 describe('every control in Explorer, in the settings menu and the import dialog', () => {
   const dialog = () => document.querySelector<HTMLDialogElement>('dialog.base16-dialog') as HTMLDialogElement
@@ -343,6 +344,12 @@ describe('every control in Explorer, in the settings menu and the import dialog'
     document.querySelector<HTMLButtonElement>('#import-base16')?.click()
     expect(dialog().matches(':modal'), 'the import dialog did not open').toBe(true)
   }
+  const paste = (scheme: string) => {
+    const text = dialog().querySelector('textarea') as HTMLTextAreaElement
+    text.value = scheme
+    text.dispatchEvent(new Event('input'))
+    dialog().querySelector<HTMLButtonElement>('button.base16-check')?.click()
+  }
 
   // THE CHECKBOX THE GATE NEVER WALKED BEFORE IT TOOK INPUTS: `format on blur`, named by the label around it.
   it("walks the settings menu's checkbox", () => {
@@ -364,10 +371,7 @@ describe('every control in Explorer, in the settings menu and the import dialog'
 
   it("after a failing scheme's check, with its details open", () => {
     open()
-    const text = dialog().querySelector('textarea') as HTMLTextAreaElement
-    text.value = legacyLayout('Ember', EMBER)
-    text.dispatchEvent(new Event('input'))
-    dialog().querySelector<HTMLButtonElement>('button.base16-check')?.click()
+    paste(legacyLayout('Ember', EMBER))
     dialog().querySelector<HTMLButtonElement>('.panel[data-panel="base16-details"] button.panel-toggle')?.click()
     expect(controls().map(nameOf)).toEqual([
       'base16 scheme (YAML)',
@@ -381,4 +385,24 @@ describe('every control in Explorer, in the settings menu and the import dialog'
     check('the import dialog, checked')
     dialog().close()
   })
+
+  it('with both halves stored, each remove named by its half', () => {
+    for (const scheme of [legacyLayout('Day', DAY), currentLayout('Night', NIGHT, 'dark')]) {
+      open()
+      paste(scheme)
+      dialog().querySelector<HTMLButtonElement>('button.base16-apply')?.click()
+    }
+    open()
+    expect(controls().map(nameOf)).toEqual([
+      'remove the light palette, Day',
+      'remove the dark palette, Night',
+      'base16 scheme (YAML)',
+      'check',
+      'apply',
+      'apply adjusted',
+      'cancel',
+    ])
+    check('the import dialog, with both halves stored')
+    dialog().close()
+  })
 })
diff --git a/web/tests/node/base16-fixtures.ts b/web/tests/node/base16-fixtures.ts
index cd786c0..af807aa 100644
--- a/web/tests/node/base16-fixtures.ts
+++ b/web/tests/node/base16-fixtures.ts
@@ -1,4 +1,4 @@
-import { mapScheme, type Scheme } from '../../src/base16'
+import { checkScheme, mapScheme, type Scheme } from '../../src/base16'
 import type { CustomHalf } from '../../src/custom-palette'
 
 /**
@@ -131,3 +131,10 @@ export function storedHalf(name: string, colours: readonly string[]): CustomHalf
   const own = keyed(colours) as Scheme['colours']
   return { name, colours: own, tokens: mapScheme(own), adjusted: false }
 }
+
+/** A stored half, as `apply adjusted` writes one: the scheme's own colours, and the tokens the adjustment gives. */
+export function adjustedHalf(name: string, colours: readonly string[], variant: 'light' | 'dark'): CustomHalf {
+  const own = keyed(colours) as Scheme['colours']
+  const check = checkScheme({ name, colours: own, variant, variantFrom: 'file', base24: false })
+  return { name, colours: own, tokens: check.adjustment.tokens, adjusted: true }
+}
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/base16-remove.test.ts tests/browser/controls-gate.test.ts`

Expected: exit 1, printing:

```text
Test Files  2 failed (2)
Tests  10 failed | 33 passed (43)
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=7
diff --git a/web/src/base16-dialog.ts b/web/src/base16-dialog.ts
index 6c2aee3..f34ee1d 100644
--- a/web/src/base16-dialog.ts
+++ b/web/src/base16-dialog.ts
@@ -9,9 +9,10 @@ import {
   readScheme,
   type SchemeCheck,
   type SchemeVariant,
+  schemeName,
   summaryLines,
 } from './base16'
-import type { CustomHalf } from './custom-palette'
+import type { CustomHalf, CustomPalette } from './custom-palette'
 import { createPanel } from './panel'
 
 /**
@@ -31,15 +32,19 @@ import { createPanel } from './panel'
  */
 
 export type Base16DialogDeps = {
+  /** The imported palette as stored now, for the `now` line, or `null` for none. */
+  readonly stored: () => CustomPalette | null
   /** The half the page shows now: `light` or `dark`, whatever the appearance setting resolves to. */
   readonly shown: () => SchemeVariant
   /** Store `half` as `variant`'s half of the `custom` palette, choose `custom`, and apply it. */
   readonly apply: (variant: SchemeVariant, half: CustomHalf) => void
+  /** Delete `variant`'s stored half, and offer to undo it. */
+  readonly remove: (variant: SchemeVariant) => void
 }
 
 export type Base16Dialog = {
   readonly el: HTMLDialogElement
-  /** Open it, modal, with an empty scheme and nothing checked. */
+  /** Open it, modal, with what is stored now, an empty scheme and nothing checked. */
   open(): void
 }
 
@@ -91,6 +96,7 @@ export function createBase16Dialog(deps: Base16DialogDeps): Base16Dialog {
   text.rows = 12
   field.append(text)
 
+  const now = element('div', 'base16-now')
   const check = button('base16-check', 'check')
   const result = element('div', 'base16-result')
   const apply = button('base16-apply', 'apply')
@@ -99,7 +105,7 @@ export function createBase16Dialog(deps: Base16DialogDeps): Base16Dialog {
   const actions = element('div', 'base16-actions')
   actions.append(apply, adjusted, cancel)
   const why = element('p', 'base16-why')
-  dialog.append(heading, field, check, result, actions, why)
+  dialog.append(heading, now, field, check, result, actions, why)
 
   /** The check the applies act on: `null` before one, after an edit, and when the text did not read. */
   let checked: SchemeCheck | null = null
@@ -139,14 +145,14 @@ export function createBase16Dialog(deps: Base16DialogDeps): Base16Dialog {
     const lines = summaryLines(c).map((l) => element('p', 'base16-summary', l))
     const adjusting = adjustLine(c)
     if (adjusting !== null) lines.push(element('p', 'base16-adjusts', adjusting))
-    const now = deps.shown()
+    const shown = deps.shown()
     const { variant } = reading.scheme
-    if (variant !== now) {
+    if (variant !== shown) {
       lines.push(
         element(
           'p',
           'base16-elsewhere',
-          `fills the ${variant} palette; the page is ${now} now, so it shows when the appearance is ${variant}`,
+          `fills the ${variant} palette; the page is ${shown} now, so it shows when the appearance is ${variant}`,
         ),
       )
     }
@@ -163,6 +169,48 @@ export function createBase16Dialog(deps: Base16DialogDeps): Base16Dialog {
     allow(null, passes(c) ? NOTHING_TO_ADJUST : null)
   }
 
+  /**
+   * **NOW**, when a half is stored (spec §8.2): each half's name, a `remove` beside it, and a `changes` panel for
+   * the colours an adjusted half moved, read off its stored colours and tokens. A remove closes the dialog: its
+   * *undo* is on the notice line, outside the modal and inert while it is open.
+   */
+  const showStored = (): void => {
+    const stored = deps.stored()
+    now.hidden = stored === null
+    if (stored === null) {
+      now.replaceChildren()
+      return
+    }
+    const line = element('p', 'base16-now-line', 'now: ')
+    const changes = element('div', 'base16-now-changes')
+    for (const variant of ['light', 'dark'] as const) {
+      const half = stored[variant]
+      if (half === undefined) continue
+      if (line.childNodes.length > 1) line.append(' · ')
+      const name = schemeName(half.name)
+      line.append(`${variant} — ${name}${half.adjusted ? ', adjusted' : ''} `)
+      // THE LABEL ALONE DOES NOT SAY WHICH HALF IT ACTS ON, SO THE NAME DOES, AND THE TOOLTIP CARRIES IT: the controls
+      // gate holds a name to the visible label or the tooltip.
+      const remove = button('base16-remove', 'remove')
+      remove.title = `remove the ${variant} palette, ${name}`
+      remove.setAttribute('aria-label', remove.title)
+      remove.addEventListener('click', () => {
+        dialog.close()
+        deps.remove(variant)
+      })
+      line.append(remove)
+      if (half.adjusted) {
+        const list = element('ul', 'base16-changes')
+        list.append(...movedColours(half.colours, half.tokens).map(changeItem))
+        changes.append(element('p', 'base16-changes-label', `${variant} — ${name}`), list)
+      }
+    }
+    now.replaceChildren(line)
+    if (changes.childNodes.length > 0) {
+      now.append(createPanel({ name: 'base16-now-changes', label: 'changes', body: changes, open: false }).el)
+    }
+  }
+
   const commit = (adjust: boolean): void => {
     if (checked === null) return
     const { scheme, tokens, adjustment } = checked
@@ -185,6 +233,7 @@ export function createBase16Dialog(deps: Base16DialogDeps): Base16Dialog {
   return {
     el: dialog,
     open() {
+      showStored()
       text.value = ''
       reset()
       dialog.showModal()
diff --git a/web/src/main.ts b/web/src/main.ts
index 29b57fb..c996a01 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -14,6 +14,7 @@ import {
 } from './appearance'
 import type { AsmPane } from './asm-pane'
 import { showBanner } from './banner'
+import { schemeName } from './base16'
 import { createBase16Dialog } from './base16-dialog'
 import { bufferList } from './buffer-list'
 import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from './buffers-store'
@@ -25,6 +26,7 @@ import {
   parseCustomPalette,
   serializeCustomPalette,
   withHalf,
+  withoutHalf,
 } from './custom-palette'
 import { lspLintRanges } from './diagnostics'
 import { createDraw } from './draw'
@@ -408,26 +410,33 @@ async function main(): Promise<EditorView> {
     applyChosenSkin()
   })
   /**
-   * The imported palette's write, which says whether it held. **NOT SILENT, UNLIKE THE CHOICES'** (spec §7.1): a
-   * failed write here loses a scheme the user pasted in, so the caller says so.
+   * The imported palette's write, which says whether it held — and `null`, the last half removed, removes the key, so
+   * an empty store and no store are one state. **NOT SILENT, UNLIKE THE CHOICES'** (spec §7.1): a failed write here
+   * loses a scheme the user pasted in, or brings back one the user deleted, so the caller says so.
    */
-  const writeCustom = (next: CustomPalette): boolean => {
+  const writeCustom = (next: CustomPalette | null): boolean => {
     try {
-      localStorage.setItem(CUSTOM_PALETTE_KEY, serializeCustomPalette(next))
+      if (next === null) localStorage.removeItem(CUSTOM_PALETTE_KEY)
+      else localStorage.setItem(CUSTOM_PALETTE_KEY, serializeCustomPalette(next))
       return true
     } catch {
       return false
     }
   }
+  /** Whether the notice line may be offering to undo a removal; an apply ends that offer (spec §8.5). */
+  let undoOffered = false
 
   // THE BASE16 IMPORT (Plan 7 part 6b spec §8): the settings menu's last item opens a modal dialog, appended to
   // `<body>` here, closed. Queried here rather than with the mount points above, which the header's own buttons share.
   const importButton = document.querySelector<HTMLButtonElement>('#import-base16')
   if (importButton === null) throw new Error('the page is missing a mount point')
   const base16 = createBase16Dialog({
+    stored: () => custom,
     shown: () =>
       appearance === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : appearance,
     apply: (variant, half) => {
+      if (undoOffered) notices.dismiss()
+      undoOffered = false
       custom = withHalf(custom, variant, half)
       paletteChoice = 'custom'
       writeSkinStorage(PALETTE_KEY, paletteChoice)
@@ -437,6 +446,44 @@ async function main(): Promise<EditorView> {
       listPalettes()
       applyChosenSkin()
     },
+    /**
+     * A REMOVE (spec §8.5): the half goes, and the choice with it only when it was `custom` and no half is left;
+     * the page and the pre-paint cache follow at once. The notice's *undo* puts the half back exactly as it was
+     * stored, and the choice as it was, until the next change to the store ends the offer.
+     */
+    remove: (variant) => {
+      const half = custom?.[variant]
+      if (custom === null || half === undefined) return
+      const before = paletteChoice
+      custom = withoutHalf(custom, variant)
+      if (custom === null && paletteChoice === 'custom') {
+        paletteChoice = 'match'
+        writeSkinStorage(PALETTE_KEY, paletteChoice)
+      }
+      const saved = writeCustom(custom)
+      listPalettes()
+      applyChosenSkin()
+      undoOffered = true
+      notices.notify(
+        saved
+          ? `${variant} palette ${schemeName(half.name)} removed`
+          : 'the removal could not be saved; the palette comes back when the page is reloaded',
+        {
+          action: {
+            label: 'undo',
+            run: () => {
+              undoOffered = false
+              custom = withHalf(custom, variant, half)
+              paletteChoice = before
+              writeSkinStorage(PALETTE_KEY, paletteChoice)
+              writeCustom(custom)
+              listPalettes()
+              applyChosenSkin()
+            },
+          },
+        },
+      )
+    },
   })
   document.body.append(base16.el)
   importButton.addEventListener('click', () => {
diff --git a/web/src/notice.ts b/web/src/notice.ts
index c5015bf..55556ab 100644
--- a/web/src/notice.ts
+++ b/web/src/notice.ts
@@ -27,13 +27,11 @@ export type Notices = {
   /**
    * End the notice that is up now and put `rest` back under it.
    *
-   * **ON THE SHAPE, BUT NOTHING OUTSIDE THIS MODULE CALLS IT — said here rather than left to be
-   * discovered.** `createNotices` reaches its own `dismiss` twice: the `NOTICE_MS` timer, and an action
-   * button, which must tear the notice down before running the action (a second undo would throw).
-   * Neither of those needs the member. It is on the type so that "end this one early" has a name a
-   * caller can find, instead of `rest(null)`, which clears the RESTING condition and is a different
-   * thing entirely. No other module in `src/` and no test drives it — which is worth one line, so the
-   * next reader does not go hunting for the caller.
+   * `createNotices` reaches its own `dismiss` twice: the `NOTICE_MS` timer, and an action button, which must tear
+   * the notice down before running the action (a second undo would throw). Its one caller outside is `main.ts`'s
+   * base16 import, whose apply ends the *undo* a palette removal offered, so an undo never writes an old half over a
+   * newer import (Plan 7 part 6b spec §8.5). It is "end this one early", not `rest(null)`, which clears the RESTING
+   * condition and is a different thing entirely.
    */
   dismiss(): void
   /**
diff --git a/web/src/style.css b/web/src/style.css
index 64b263b..14acaaf 100644
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -1642,6 +1642,7 @@ main {
   resize: vertical;
 }
 .base16-check,
+.base16-remove,
 .base16-actions button {
   justify-self: start;
   font: inherit;
@@ -1662,6 +1663,7 @@ main {
   flex-wrap: wrap;
   gap: var(--space-2);
 }
+.base16-now p,
 .base16-result p,
 .base16-why {
   margin: 0;
@@ -1675,6 +1677,7 @@ main {
   margin: 0;
   color: var(--error);
 }
+.base16-now-changes ul,
 .base16-details-body ul {
   margin: var(--space-1) 0;
   padding-inline-start: var(--space-3);
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  56 passed (56)
Tests  830 passed (830)
```

Run: `cd web && pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
Test Files  125 passed (125)
Tests  824 passed (824)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command; after each, `git status` shows only this task's changes). In the replay, 12 of 12 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | `remove` leaving the key when the store is empty — `src/main.ts`: `if (next === null) localStorage.removeItem(CUSTOM_PALETTE_KEY)` → `if (next === null) localStorage.setItem(CUSTOM_PALETTE_KEY, serializeCustomPalette({}))` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-remove.test.ts` | `tests/browser/base16-remove.test.ts > removing a half > leaves a choice that was not custom as it was, when the last half goes`, `tests/browser/base16-remove.test.ts > removing a half > removes the key with the last half, and a custom choice becomes match` |
| 2 | `undo` not restoring `adjusted` — `src/main.ts`: `custom = withHalf(custom, variant, half)` → `custom = withHalf(custom, variant, { ...half, adjusted: false })` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-remove.test.ts` | `tests/browser/base16-remove.test.ts > removing a half > is undone exactly: the half as it was stored, adjusted included`, `tests/browser/base16-remove.test.ts > removing a half > puts back a custom choice the last half’s removal made match, on undo` |
| 3 | `undo` not restoring the choice — `src/main.ts`: `paletteChoice = before` → (deleted) | `cd web && pnpm exec vitest run --project browser tests/browser/base16-remove.test.ts` | `tests/browser/base16-remove.test.ts > removing a half > puts back a custom choice the last half’s removal made match, on undo` |
| 4 | a `custom` choice left when the last half goes — `src/main.ts`: `if (custom === null && paletteChoice === 'custom') {` → `if (custom === null && paletteChoice === 'never') {` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-remove.test.ts` | `tests/browser/base16-remove.test.ts > removing a half > removes the key with the last half, and a custom choice becomes match` |
| 5 | a choice that was not `custom` made `match` — `src/main.ts`: `if (custom === null && paletteChoice === 'custom') {` → `if (custom === null) {` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-remove.test.ts` | `tests/browser/base16-remove.test.ts > removing a half > leaves a choice that was not custom as it was, when the last half goes` |
| 6 | `remove` leaving the dialog open — `src/base16-dialog.ts`: `remove.addEventListener('click', () => { ⏎ dialog.close()` → `remove.addEventListener('click', () => {` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-remove.test.ts` | `tests/browser/base16-remove.test.ts > removing a half > deletes it and keeps the other: the choice stays custom, and the page falls back where it was`, `tests/browser/base16-remove.test.ts > removing a half > ends its undo at the next import`, `tests/browser/base16-remove.test.ts > removing a half > is undone exactly: the half as it was stored, adjusted included`, `tests/browser/base16-remove.test.ts > removing a half > leaves a choice that was not custom as it was, when the last half goes`, `tests/browser/base16-remove.test.ts > removing a half > puts back a custom choice the last half’s removal made match, on undo`, `tests/browser/base16-remove.test.ts > removing a half > removes the key with the last half, and a custom choice becomes match`, `tests/browser/base16-remove.test.ts > removing a half > takes effect for this load when storage refuses it, says it comes back on reload, and still offers undo` |
| 7 | an apply leaving the undo on offer — `src/main.ts`: `if (undoOffered) notices.dismiss()` → (deleted) | `cd web && pnpm exec vitest run --project browser tests/browser/base16-remove.test.ts` | `tests/browser/base16-remove.test.ts > removing a half > ends its undo at the next import` |
| 8 | a refused removal said as a removal — `src/main.ts`: `` saved ⏎ ? `${variant} palette ${schemeName(half.name)} removed` ⏎ : 'the removal could not be saved; the palette comes back when the page is reloaded', `` → `` `${variant} palette ${schemeName(half.name)} removed`, `` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-remove.test.ts` | `tests/browser/base16-remove.test.ts > removing a half > takes effect for this load when storage refuses it, says it comes back on reload, and still offers undo` |
| 9 | the focus left on the first `remove`, not the text — `src/base16-dialog.ts`: `dialog.showModal() ⏎ text.focus()` → `dialog.showModal()` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-remove.test.ts` | `tests/browser/base16-remove.test.ts > a stored half, in the import dialog > is named in the now line, with a remove beside it naming its half, and the text still takes the focus` |
| 10 | `remove` named by its label alone — `src/base16-dialog.ts`: `remove.setAttribute('aria-label', remove.title)` → (deleted) | `cd web && pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > with both halves stored, each remove named by its half` |
| 11 | the `changes` panel left out for an adjusted half — `src/base16-dialog.ts`: `if (half.adjusted) { ⏎ const list` → `if (half.adjusted && false) { ⏎ const list` | `cd web && pnpm exec vitest run --project browser tests/browser/base16-remove.test.ts` | `tests/browser/base16-remove.test.ts > a stored half, in the import dialog > lists the colours an adjusted half moved, read from what is stored, behind changes`, `tests/browser/base16-remove.test.ts > removing a half > deletes it and keeps the other: the choice stays custom, and the page falls back where it was`, `tests/browser/base16-remove.test.ts > removing a half > ends its undo at the next import`, `tests/browser/base16-remove.test.ts > removing a half > is undone exactly: the half as it was stored, adjusted included`, `tests/browser/base16-remove.test.ts > removing a half > leaves a choice that was not custom as it was, when the last half goes`, `tests/browser/base16-remove.test.ts > removing a half > puts back a custom choice the last half’s removal made match, on undo`, `tests/browser/base16-remove.test.ts > removing a half > removes the key with the last half, and a custom choice becomes match`, `tests/browser/base16-remove.test.ts > removing a half > takes effect for this load when storage refuses it, says it comes back on reload, and still offers undo` |
| 12 | the now line hidden — `src/base16-dialog.ts`: `now.hidden = stored === null` → `now.hidden = true` | `cd web && pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > with both halves stored, each remove named by its half` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
The import dialog shows what is stored, each half with a `remove`, and a removal offers `undo`

When the store holds a half, the dialog's now line names each one,
with a `remove` beside it whose name says which half it acts on, and a
`changes` panel lists the colours an adjusted half moved, read off its
stored colours and tokens (Plan 7 part 6b spec §8.2, §8.5). A remove
deletes that half and keeps the other; the last one takes the key with
it, and a `custom` choice becomes `match` while any other stays. The
page and the pre-paint cache follow at once, the dialog closes, and
the notice offers `undo`, which puts the half back exactly as it was
stored and the choice as it was — until the next import ends the
offer. A removal storage refuses lasts this load, and says so.
````

---

### Task 8: Verification, the check by hand, and the roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` — the entry for this PR, appended at the end

**Nothing here changes code.** The web gates CI runs, a look at the dialog in the three styles, and the entry.

- [ ] **Step 1: Run every web gate**, one after another, and record each command's exit code and its counts:
  - `cd web && pnpm exec biome ci --error-on-warnings`;
  - `cd web && pnpm run typecheck`;
  - the whole suite with its coverage floors, under a 16G cap with no swap: `cd web && systemd-run --user --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 --setenv=PATH="$PATH" --setenv=HOME="$HOME" --setenv=CARGO_HOME="$CARGO_HOME" --setenv=RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.local/share/rustup}" --working-directory="$PWD" pnpm run test:coverage`, whose floors are statements 95, branches 89, functions 97, lines 97. **The run peaks near its 16G cap on this machine**, on `main` too: if it is OOM-killed, run it again with `--maxWorkers=4` under the same cap, and report both runs;
  - `cd web && pnpm run build:app`;
  - from the repository root, each hygiene scan with `--self-test` and then alone: `scripts/check-{text-bytes,citations,attributions,doc-figures,shared-docs,lua,colours}.sh`.

  Expected: every one exits 0. **The replay's run of this step:**

  - `biome ci --error-on-warnings`: exit 0. `pnpm run typecheck`: exit 0.
  - `test:coverage` under the 16G cap: **OOM-killed** (`Finished with result: oom-kill`, peak 16G), then with `--maxWorkers=4` under the same cap: exit 0, printing

    ```text
    Test Files  181 passed (181)
    Tests  1654 passed (1654)
    All files          |   97.07 |    90.72 |   98.21 |   98.48 |
    ```

    — statements, branches, functions and lines, over floors of 95, 89, 97 and 97 — at a peak of 14.9G.
  - `pnpm run build:app`: exit 0.
  - The seven hygiene scans, each `--self-test` and then alone: fourteen runs, each exit 0.

  **Not run, and why.** This change touches no Rust and adds no build output the web app imports, so the Rust gates (`scripts/check-all.sh`'s cargo legs, `cargo llvm-cov`), `scripts/check-slow.sh` and the Docker image build are unaffected by it, and none of them is run here.

- [ ] **Step 2: Look at the dialog, by hand**, from `cd web && pnpm run dev`, at 1280×800, in each style (Paper, Terminal, Instrument), light and dark: open `import base16…` from the settings menu; paste `EMBER`, below, `check`, open `details`, `apply adjusted`; open the dialog again and look at the `now` line and its `changes` panel; paste `DAY`, `check`, and read the other-appearance line; `remove` a half and `undo` it from the notice; and choose each built-in palette and back to `custom` from the palette select. Record what was looked at and anything that reads wrong; a finding goes to the whole-branch review, not into this task.

  `EMBER` and `DAY` as `base16-fixtures.ts`'s `legacyLayout` writes them:

````yaml
scheme: "Ember"
author: "redextape tests"
base00: "1c1a22"
base01: "2c2833"
base02: "3a3544"
base03: "57506a"
base04: "7e7590"
base05: "8a829a"
base06: "d8d0e2"
base07: "f0ecf4"
base08: "c06070"
base09: "d09a70"
base0A: "d8b870"
base0B: "88c088"
base0C: "70c0c0"
base0D: "80a0e0"
base0E: "9070a0"
base0F: "c09070"
````

````yaml
scheme: "Day"
author: "redextape tests"
base00: "f6f4ee"
base01: "ebe7de"
base02: "ddd7ca"
base03: "a8a090"
base04: "5e584c"
base05: "2e2a24"
base06: "1e1b17"
base07: "12100d"
base08: "b02a30"
base09: "9a4a10"
base0A: "7a5a00"
base0B: "2e6e2e"
base0C: "1a6a70"
base0D: "2a5aa0"
base0E: "8a3a90"
base0F: "7a4a30"
````

- [ ] **Step 3: Write the roadmap entry.** Read the last two entries first and match their shape. Its heading is `#### PLAN 7 PART 6b, BASE16 IMPORT: … (2026-09-29, branch \`plan7-part6b-base16-import\`, \`18f8225..<last code commit>\`, N commits, plus this entry)` — the range excludes the entry's own commit, which "plus this entry" covers. Then `##### ` sections in the entry's own voice: what the part built; that the plan was built and replayed before it was handed out, with this plan's Pre-flight figures; what executing it found; what the reviews found; `##### WHAT THIS DID NOT CLOSE`; and `##### VERIFICATION`, ending with a table headed **Every count this entry quotes, with what produces it**, one row per figure: the value, a label, and the command that produces it. **Run every one of those commands before committing the entry.** Name values, not relationships. What it did not close includes, at least: the check's result is not written to the app's live region, which sits outside the modal and is inert while it is open, and the spec does not say how the result is announced; an `undo` whose store write fails is silent (§7.1 names an import's and a removal's failed writes, not an undo's); an apply after a removal ends whatever notice is on the line then, which after the removal's eight seconds may be another's; the three files §11's table left out (Pre-flight, "What the prototype found" 8); and the gate's widening, which 6a repeats and the second PR to land rebases.

- [ ] **Step 4: Commit the entry**, as the last commit before the PR opens:

````text
Roadmap: Plan 7 part 6b — base16 import
````
