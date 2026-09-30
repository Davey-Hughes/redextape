# Plan 7, part 6b — base16 import — design

Part 6b of [Plan 7](2026-09-17-frontend-overhaul-design.md). A user pastes a published base16 colour scheme into a
dialog, sees how it measures against the contrast floors the built-in palettes meet, and applies it — as it is, or
with each failing colour's lightness moved until it passes — as a `custom` palette beside Paper, Terminal and
Instrument. It is the umbrella's §2 row 4, "base16 paste-in import with a contrast warning", and the base16 half of
its §6 part 6 paragraph; 6a, running beside it, takes the examples, the first-load example and share links.

It settles what the umbrella left to this part: the token mapping (§5.1) and the contrast warning (§5.3, §6). **It
also records a revision the user made to that warning after it was measured.** Under the approved mapping and
floors, 286 of the 352 schemes the tinted-theming project publishes fail at least one floor (§2.6), so a warning
that listed every failing pair would have been on screen for four imports in five. §3 records both versions.

Code facts below were read at `18f8225` (#112, part 5c's squash merge). Scheme figures come from
`tinted-theming/schemes` at `50f6e3b` (2026-09-23) and the archived `tinted-theming/base16-schemes` at `2b6f2d0`,
cloned into a scratch directory for measurement only; no scheme file enters the repo. §16 gives the command behind
every figure.

**Amended 2026-09-29, after the gap-fix task.** Executing the plan added a task the plan did not have: the per-task
reviews' findings, fixed before verification in the 19 commits from `393ed23` to `e58f4c4`. Where it changed what
this text says, the section ends with a dated note: §6.2, §6.4, §6.5, §7.1, §8.2, §8.3, §8.5, §9, §11, §12 and §16.
The text above each note is the design as approved. Two notes are dated after the whole-branch review, §8.3's and
§11's; its fixes are the eight commits from `aee66e9` to `79ace38`.

## §1 Scope

**In:** a reader for base16 YAML that uses no YAML library (§4); the mapping from a scheme's 16 colours to the 19
palette tokens, and a check against one floor table that moves out of the test into `src` (§5); the `apply
adjusted` action and the lightness adjustment behind it (§6); one stored `custom` palette with a half per variant,
each removable with an undo, and a `custom` palette choice (§7, §8.5); an `import base16…` button in the settings menu that opens a native `<dialog>`
(§8); first paint (§9); the controls gate widened to `input`, `textarea` and open dialogs (§10).

**One PR**, in parallel with 6a (§3 row 1). §11 names the regions each touches.

**Out:** §14.

## §2 What exists

### §2.1 Palettes are data, and the cache admits only `#rrggbb`

- `COLOUR_TOKENS` (`web/src/palettes.ts:25`) lists 19 tokens, and `Variant` is a `Record` over them, so a
  built-in palette missing one is a compile error. `Palette` (`:55`) carries `id: PaletteId`, which is `'paper' |
  'terminal' | 'instrument'`.
- `paletteDeclarations` (`:209`) writes a palette as one `--<token>: light-dark(<light>, <dark>);` per token.
  `PALETTE_CSS_PATTERN` (`:224`) accepts only declarations whose two values are lowercase `#rrggbb`.
  `index.html`'s pre-paint script carries the same pattern as a literal, and `prepaint.test.ts` holds the two
  equal.
- `contrast.ts` has `relativeLuminance` (`:9`) and `contrastRatio` (`:20`), WCAG 2's formulas, over lowercase
  `#rrggbb` only. Its doc names "an imported base16 palette before it is applied in Plan 7 part 6" as a caller to
  come.

### §2.2 The floors live in a test

`web/tests/node/palettes.test.ts:21` builds `FLOORS`, 35 `[foreground, background, floor]` pairs:

- `fg`, `fg-dim` and every `tok-*` on `bg` and `bg-raised` at 4.5, and `fg` and `fg-dim` on `bg-chrome` at 4.5;
- `focus-ring` and `warn` on `bg`, `bg-raised` and `bg-chrome` at 3;
- `accent` and `error` on `bg` and `bg-raised` at 4.5, and on `bg-chrome` at 3;
- `on-accent` on `accent` at 4.5.

4.5 and 3 are WCAG 2's AA thresholds for text (1.4.3) and for non-text marks (1.4.11). The case at `:79` holds
`tok-binder` at least 24 away, in some channel, from every other token of its variant. Nothing in `src` can call
either rule today.

### §2.3 The choice and its application

- `PaletteChoice` (`web/src/skin.ts:16`) is `'match' | PaletteId`. `PALETTE_CHOICES` (`:18`) lists the four, and
  `PALETTE_CHOICE_LABELS` (`:39`) is a `Record` over them. `readPaletteChoice` (`:60`) reads anything unknown as
  `match`. `resolvePalette` (`:64`) and `applySkin` (`:80`) take a style and a choice and nothing else.
- `main.ts:354–391` fills the style and palette selects from those lists, reads the stored choice through a
  guarded reader, and defines `applyChosenSkin`, which applies the palette and writes its declarations under
  `redextape.palette.css` (`PALETTE_CSS_KEY`, `skin.ts:31`). It runs at start-up, on a style change and on a
  palette change. A failed write there is silent (`main.ts:364`).
- `skin-switcher.test.ts:38` pins the palette select's options as `match style`, `Paper`, `Terminal`,
  `Instrument`.

### §2.4 The pre-paint script reads three keys

`index.html:17–38` reads `redextape.appearance`, `redextape.style` and `redextape.palette.css`, and writes the
cached text onto `<html>`'s `style` attribute only when it matches the pattern. It never reads
`redextape.palette`: the cache holds resolved declarations, whatever produced them.

### §2.5 The settings menu and the controls gate

- The settings menu (`index.html:57–63`) is a popover holding four labelled selects and one labelled checkbox,
  `#format-on-blur`; `wireMenu` (`web/src/app-header.ts:16`) wires it. The app has no `<dialog>` and no
  `<textarea>` today.
- The controls gate's `controls()` (`web/tests/browser/controls-gate.test.ts:114`) walks `button, select`,
  skipping anything under `[hidden]` and anything in a closed popover. It does not walk `#format-on-blur`, which is
  an `input`. A closed `<dialog>` is neither `[hidden]` nor a popover, so its buttons would be walked and would
  fail the gate's focus check. While a modal dialog is open, everything outside it is inert, and every control
  there would fail the same check.

### §2.6 Published schemes, measured

The tinted-theming styling guide (version 0.4.2) and its builder spec define two layouts:

- **legacy:** top-level `scheme` (the builder spec's name for it; the styling guide's own example writes `name`),
  `author`, an optional `description`, and `base00`–`base0F` as top-level keys holding bare hex;
- **current:** `system`, `name`, an optional `slug`, `author`, an optional `description`, `variant`, and a nested
  `palette:` whose values "MAY be preceded by a `#`".

base24 is the same format with eight more colours, `base10`–`base17`; its `base00`–`base0F` keep base16's roles.

| Set | Files | Read by §4's rules | `variant:` stated | Luminance rule agrees |
|---|---|---|---|---|
| `schemes/base16` | 352 | 352 | 352 | 352 |
| `schemes/base24` | 209 | 209 | 209 | 208 (`unikitty` states light; its base00 is `#ff7ad3`) |
| legacy `base16-schemes` | 251 | 251 | 0 | 251, against the current file of the same name |

**Against the floors, under §5.1's mapping, before any adjustment.** A group is a pair of scheme colours (§5.3):

| Scheme | Variant, stated → detected | Checks below | Groups | Worst |
|---|---|---|---|---|
| gruvbox-dark-hard | dark → dark | 3 | 2 | base08 on base01, 3.37 (floor 4.5) |
| nord | dark → dark | 12 | 7 | base08 on base01, 2.46 (4.5) |
| solarized-dark | dark → dark | 19 | 10 | base08 on base01, 2.81 (4.5) |
| solarized-light | light → light | 28 | 16 | base0C on base01, 2.58 (4.5) |
| dracula | dark → dark | 0 | 0 | — |
| catppuccin-mocha | dark → dark | 7 | 2 | base04 on base00, 2.46 (4.5) |
| catppuccin-latte | light → light | 21 | 12 | base04 on base01, 1.78 (4.5) |
| default-dark (legacy layout) | none → dark | 3 | 2 | base08 on base01, 2.59 (4.5) |

None of the eight fails the binder rule. Over all 352 current schemes:

- **286 fail at least one floor, 29 fail the binder rule, and 55 pass everything.**
- The median failing scheme's worst pair reaches 0.58 of its floor. 177 have a 4.5 pair below 3:1. 25 fail by
  10% of a floor or less.
- The pairs failed most often: `error` on `bg-raised` (219 schemes), `accent` and `tok-keyword` on `bg-raised`
  (181), `fg-dim`, `tok-neutral` and `tok-punct` on `bg-raised` (175).
- `bg-raised` is base01, which a dark scheme makes lighter than base00. With `bg-raised` and `bg-chrome` on base00
  instead, 240 would still fail, so the choice of base01 accounts for 46 of the 286.
- `tok-binder` (base0B) comes within 24 of base0C in 14 schemes, of base09 in 12 and of base0A in 11.
- In the legacy set, 219 of 251 fail a floor.

### §2.7 `bg-raised` and `bg-chrome` may be equal

§5.1 gives both base01. Nothing depends on their differing:

- `var(--bg-chrome)` paints three rules: `.bar` (`web/src/style.css:153`), `.panel-header` (`:1174`) and
  `.stage-tabs` (`:1541`). Each also draws a `--rule` border on the edge it shares with the surface beside it. A
  `.panel-header` inside the inspector (`bg-raised`, `:1606`) is where the two meet, and its `border-block`
  separates them.
- No `.ts` file reads either name but `palettes.ts` and `palettes.test.ts`'s floors, and no browser test asserts
  the background of a chrome or raised surface.
- The built-ins already hold the two close: the contrast between `bg-raised` and `bg-chrome` runs from 1.008
  (Instrument dark) to 1.179 (Paper light).

## §3 Decisions

Made by the user on 2026-09-29. Rows 9 to 12 and row 5's revision followed §2.6's measurement; row 13 was added
when the spec was approved.

| # | Topic | Decision | Declined |
|---|---|---|---|
| 1 | Delivery | Part 6 is two lanes in parallel: 6a (examples, first load, share links) and 6b (this). 6b is one PR | — |
| 2 | Format | **YAML only.** Published schemes are YAML under tinted-theming's spec, an outside project's standard, so the import reads what is published. The reader uses no YAML library and reads both layouts (§4) | one reader for YAML and TOML; TOML only |
| 3 | Variant | **Detected.** `variant:` wins when present; otherwise the scheme is dark when base00 is darker than base05 by relative luminance. An import fills that half of the custom palette and replaces what was there; the other half falls back to the current style's own palette (umbrella §7) | picking the slot at import; deriving the other variant by inverting lightness |
| 4 | Slots | **One custom slot**, stored under `redextape.palette.custom`, versioned and validated like the other stores. `PaletteChoice` gains `'custom'`, listed once something has been imported | a named list of imports |
| 5 | UI | An `import base16…` button in the settings menu opens a native `<dialog>`: a textarea, then `check`, which shows the scheme's name, its variant and the contrast result, then the actions. The user may apply a scheme that fails (umbrella §7). **Revised, see below:** the result is one summary line with the failures folded away and grouped by scheme colour, and the actions are `apply`, `apply adjusted` (§6) and `cancel` | the full per-pair list; loosening the floors for imports |
| 6 | Mapping | As drafted (§5.1), mirroring how the built-ins reuse colours | — |
| 7 | One floor table | The floor table and the `tok-binder` rule move into `src`, so the test and the import check the same floors | — |
| 8 | Tests | Node tests for the reader, variant detection, mapping and store; browser tests for the dialog, the warning, the applied `--bg`, and a reload applying the custom palette before first paint; the controls gate covering the new controls. Fixtures are schemes written for the tests, so no third-party scheme file or licence enters the repo | — |
| 9 | Names | **A name per half:** the store is `{light?, dark?}`, each half `{name, colours, …}`, and settings reads e.g. `custom — light: Catppuccin Latte · dark: Catppuccin Mocha` | one name, the last import's |
| 10 | base24 | **Accepted.** Its base00–base0F keep base16's roles and map the same way; the check notes that its eight extra colours are not used | refusing base24 |
| 11 | Controls gate | **Widens** to walk `input`, `textarea` and open dialogs as well as `button, select`, so the existing `#format-on-blur` checkbox comes under it. A modal's pass is scoped to the modal. 6a needs the same widening; whichever PR lands second rebases onto the other's version | — |
| 12 | Two readings | A `variant:` other than `light` or `dark` is treated as absent. A bare `#rrggbb` value is read as a colour, where YAML reads it as a comment — on purpose | — |
| 13 | Removing | **`remove` per half**, beside each stored half in the dialog's `now` line, with the notice's `undo` as deleting a copy has (§8.5) | out of scope; a half replaced only by the next import of that kind |

**Row 5 was revised after it was measured.** As first approved, the check listed every failing pair with its ratio.
Against the 352 published schemes (§2.6) that list would have been shown for 286 of them, the median failing
scheme's worst pair at 0.58 of its floor, and Solarized Light's list 28 lines long. The user kept the floors and the
right to apply a failing scheme, and changed what the check shows and offers: a summary line, the failures grouped
by scheme colour behind a disclosure, and `apply adjusted`, which §6.5 measures on the same 352.

## §4 The reader

`web/src/base16.ts`'s `readScheme(text)` returns a scheme — its 16 colours as lowercase `#rrggbb`, its name, its
variant and how it was found, and whether it is base24 — or the list of what is wrong with the text.

### §4.1 Rules

It reads line by line. A line counts only when it is `key: value`: optional leading spaces or tabs, a key of
letters, digits and `_`, then a colon.

- **Colour keys at any indentation.** `base00`–`base0F`, the last digit in either case, are read wherever they
  sit, so the legacy layout's top-level keys and the current layout's keys under `palette:` both read. Any of
  `base10`–`base17` marks the scheme base24 and is otherwise ignored.
- **Name and variant at the top level only.** `name`, or else the legacy `scheme`, and `variant`, each read only at
  no indentation, so nothing nested can supply one. A scheme with neither name is called `untitled`.
- **A value** is double-quoted (`\"` and `\\` unescaped), single-quoted (`''` read as `'`), or bare: the text up to
  the first `#` that follows whitespace, trimmed. Anything after a closing quote is ignored. A line whose first
  non-space character is `#` is a comment and never matches.
- **A colour value** is six hex digits, with or without a leading `#`, in either case. It is stored as `#` and the
  digits in lowercase, the one form `PALETTE_CSS_PATTERN` and `contrast.ts` accept.
- **A bare `#rrggbb`** (`base00: #1d2021`) is read as that colour (§3 row 12). YAML reads it as an empty value and a
  comment; no one writing a colour there means a comment. 0 of the 812 published files in §2.6's three sets write
  one, so the difference never changes how a published scheme reads.

### §4.2 Errors

Every error is collected and shown, each naming its key:

- no colour key at all: **"no base16 colours found"** — the one message for empty text, for TOML (`base00 =
  "#1d2021"` has no `key:` line), for JSON (its keys are quoted) and for a flow mapping;
- `base0C is missing`;
- `base03 is not a colour: "#12345"`;
- `base05 is given twice`.

### §4.3 What it does not read, and why that is enough

Flow mappings (`palette: {base00: …}`) read as "no base16 colours found". Anchors and aliases (`&fg`, `*fg`) read
as "is not a colour". Several documents in one text read as every key "given twice". Quoted keys (`"base00":`) are
not read. A block scalar as a colour's value is not read.

Of the 812 published files, 0 use a flow mapping, an anchor or alias, a document marker or a quoted key. 1 uses a
block scalar, for its `description`, which the reader skips. 6 carry a tab, each inside a comment the reader never
reads.

### §4.4 The variant

`variant:`, compared in lowercase, wins when it is `light` or `dark`. Anything else, or none, is detected: **dark
when base00's relative luminance is below base05's, light otherwise.** The result says which it was — `dark, from
the file` or `dark, detected`. §2.6 measures the rule against every stated variant.

## §5 The mapping and the check

### §5.1 The mapping

It mirrors how the built-ins reuse colours (`palettes.ts`): `tok-ident` and `focus-ring` are `fg`, `tok-neutral` is
`fg-dim`, `accent` is `tok-keyword`, and `tok-nat` is `tok-bool`. It maps all 19 tokens, so an import never lacks
one.

| Scheme colour | Its role in base16's styling guide | Tokens |
|---|---|---|
| base00 | default background | `bg`, `on-accent` |
| base01 | lighter background (status bars) | `bg-raised`, `bg-chrome` |
| base02 | selection background | `rule` |
| base04 | dark foreground (status bars) | `fg-dim`, `tok-neutral`, `tok-punct` |
| base05 | default foreground | `fg`, `tok-ident`, `focus-ring` |
| base08 | red | `error` |
| base09 | orange: integers, booleans, constants | `tok-nat`, `tok-bool` |
| base0A | yellow | `warn` |
| base0B | green | `tok-binder` |
| base0C | cyan | `tok-operator` |
| base0E | magenta: keywords | `accent`, `tok-keyword` |

base03, base06, base07, base0D and base0F are not used.

### §5.2 One floor table

`FLOORS` moves from `palettes.test.ts` to `contrast.ts` as `CONTRAST_FLOORS`, unchanged: its 35 pairs and its
comment. The binder rule moves beside it as `binderClashes(variant)`, which returns each token `tok-binder` is
within 24 of, in the test's own words. `palettes.test.ts` imports both, and its two cases keep their names and
failure messages, so a failing built-in reads as it does today. The import's check calls the same two functions.

### §5.3 The check

`checkScheme(scheme)` maps the scheme, holds it to the floors and the binder rule, and runs §6's adjustment, so the
result can say what `apply adjusted` would do. The dialog shows three things.

1. **The summary**, one line: `Nord · dark, from the file: 12 of 35 contrast checks below WCAG AA, worst 2.46:1`. A
   scheme that passes reads `… every contrast check passes`. A binder clash adds `; binders too close to 2 other
   colours`. A base24 scheme adds a second line: `base24: its eight extra colours, base10–base17, are not used`.
2. **What `apply adjusted` does**, one line: `apply adjusted moves 3 colours' lightness, and every check then
   passes` — or, where it cannot fix everything, brogrammer's `… 26 checks still fail, where no lightness passes on
   both base00 and base01`. The count is the number of lines the details list under "changes".
3. **A `details` panel**, closed by default and built by `panel.ts`, the umbrella's one disclosure mechanism (§5).
   It lists the failures **grouped by scheme colour pair**, each group naming its tokens in words, its worst ratio
   and that pair's floor: `base08 on base01: error text on panels and headers — 2.46:1, needs 4.5`. Then, under
   "changes", one line per colour the adjustment moves: `base08 #bf616a → #f59199, as error text`. Nord's 12
   failing checks are 7 groups; Solarized Light's 28 are 16.

The words: `fg` text, `fg-dim` dim text, `tok-neutral` plain code, `tok-punct` punctuation, `tok-ident` names,
`tok-keyword` keywords, `tok-nat` numbers, `tok-bool` booleans, `tok-operator` operators, `tok-binder` binders,
`accent` accents, `on-accent` text on accents, `error` error text, `warn` warnings, `focus-ring` the focus ring. As
surfaces: `bg` the page, `bg-raised` panels, `bg-chrome` headers, `accent` accents.

## §6 `apply adjusted`

The floors do not change; the scheme does, by as little as it can. **Each foreground token that fails a floor has
its lightness moved, with its hue kept, until it meets every floor it has. No surface changes: `bg`, `bg-raised`,
`bg-chrome` and `rule` stay the scheme's own.** Then `tok-binder` moves the same way if it clashes. The code is
`web/src/base16-adjust.ts`.

### §6.1 In OKLCH

Lightness moves in **OKLCH**, OKLab's lightness, chroma and hue, converted to and from sRGB by Björn Ottosson's
published OKLab matrices, written into the module.

- Its `L` is perceptual lightness, so a step of `L` is a similar visible step whatever the hue. HSL's lightness is
  not: equal HSL steps move a blue's luminance far less than a yellow's, and a "just enough" measured in it would
  mean different amounts for different colours.
- Holding its hue angle holds the perceived hue. OKLab was built to remove CIELab's bend in blue, where a colour
  held at one CIELCh hue drifts toward purple as its lightness changes.
- CSS Color 4 gamut-maps in OKLCH for the same reasons.

**Gamut.** A lighter or darker colour at the same chroma can fall outside sRGB. When it does, chroma is reduced by
bisection, at the new lightness and the same hue, to the largest that is inside, and the result is rounded to
`#rrggbb`. Over the 352 schemes, 457 of the 1,870 tokens the adjustment moves need their chroma reduced. The
largest hue drift that reduction and the rounding cause together is 3.27°, measured in OKLCH (§6.5).

### §6.2 Just enough

For one token, `ok(hex)` is "every floor this token has holds for `hex`", evaluated on the rounded `#rrggbb`, so
the value stored is the value that passed. From the token's own `L`, in each direction:

1. walk in steps of 0.01 until a step passes `ok`, or `L` reaches 0 or 1;
2. bisect 16 times between that step and the one before it, keeping the passing end.

The direction with the smaller change wins. The walk comes before the bisection because `ok` is not monotone from
the token's own value when its surfaces sit on both sides of it: contrast with one rises as contrast with the other
falls. The first region where `ok` holds is the nearest one.

**Amended 2026-09-29, after the gap-fix task** (`00e9947`, `81c2774`). **The walk can step over a region where `ok`
holds that is narrower than one step**, and the token was then called unfixable: `NIGHT` on base00 `#000000` and
base01 `#aaaaaa` has `warn` meeting 3:1 on all three surfaces only for `L` 0.4650 to 0.4655, and the walk lands on
0.4731 and 0.4631. So where the walk and its bisection find nothing in either direction, a fine scan asks `ok` of the
colour every `L = i / 10,000` rounds to, `i` from 0 to 10,000, at the token's own hue and chroma, nearest first, and
takes the first that passes. The walk stays the fast path. **Before either, a check of luminance alone:** contrast is
a matter of two luminances, so where no luminance meets every floor a token has against colours that hold still
while it walks — the surfaces, and for `on-accent` the `accent` the first pass ended with — neither the walk nor the
scan runs, and the token is unfixable. The check asks only 0 and each floor's `f(y + 0.05) − 0.05`, where a passing
range can begin, with a margin that leans toward yes. It changes no result: the gap-fix task found the adjustment of
all 812 files identical with it and without it. It takes the scan off the common unfixable case, and the CPU for
§6.5's 352 back to what it was before the scan (§6.5's note).

### §6.3 Several floors, and the order

- **A token meets all its floors at once**: `ok` is their conjunction. `fg` meets 4.5 on `bg`, `bg-raised` and
  `bg-chrome`. `focus-ring`, from the same base05, meets 3 on those, so the two can end different.
- **Tokens move independently**, even when they share a scheme colour. `fg-dim`, `tok-neutral` and `tok-punct`, all
  base04, end equal under this mapping, because `bg-chrome` = `bg-raised` makes their floors the same.
- **The order.** First every foreground whose floors are against surfaces only. Then `on-accent`, whose floor is
  against `accent`, checked against the `accent` the first step ended with. `on-accent` is base00, the page's own
  colour, and an `accent` that meets 4.5 on `bg` meets it on `on-accent` too, so in a scheme the adjustment fixes,
  `on-accent` never moves.
- **`tok-binder` last.** If `binderClashes` names anything, the same walk runs on `tok-binder` with `ok` = "its
  floors hold, and it is 24 from every other token's final value".

### §6.4 When no lightness passes

The token keeps its imported value, every other token is still adjusted, and the result's second line names what
still fails and why. In the 352 schemes this happens in 6:

- **5** — brogrammer, jellybeans, shades-of-purple, tango and zenbones — use base01 for a mid or bright colour
  (brogrammer `#f81118`, tango `#8ae234`) rather than a second background. No text colour meets 4.5 against both it
  and a dark base00: for `fg`, the best any lightness reaches is 0.62 (tango) to 0.92 (brogrammer) of the floor.
- **1** — digital-rain — ends with its foregrounds pushed near white to pass on its mid-green base01, which leaves no
  lightness at which `tok-binder` meets its floors and stands 24 from all of them.

**Amended 2026-09-29, after the gap-fix task** (`5934fc7`, `7d615b1`). **An unfixable token keeps the value its walk
began from.** For every token the floors cannot fix, that is its imported value. For `tok-binder`, when the floors
moved it and the binder rule then could not set it apart, it is the value that meets its floors, and the binder is
named for the binder rule alone. A binder the floors cannot fix and that still clashes is named twice, for its floors
and then for the binder rule; both are true, and the result's line says both. The six schemes above are unchanged.

### §6.5 Measured

| | `schemes/base16` | `schemes/base24` | legacy |
|---|---|---|---|
| Files | 352 | 209 | 251 |
| Pass as imported | 55 | 28 | 29 |
| **Pass after `apply adjusted`** | **346** | 195 | 243 |
| Cannot be fixed | 6 | 14 | 8 |
| Tokens moved | 1,870 | 1,055 | 1,451 |
| Median lightness change | 0.083 | 0.088 | 0.084 |
| Largest change, in a scheme that ends clean | 0.475 | 0.426 | 0.463 |

Lightness is OKLCH `L`, from 0 to 1. The largest change in `schemes/base16` over every token, 0.552, is tango's
`on-accent`, in one of the six. The largest in a scheme that ends clean is boo-shnickle-light's `tok-binder`,
`#e7ff99` → `#576700`, a pale yellow-green on a near-white page. The probe adjusts all 352 in 0.36 s of CPU, Node's
start-up included.

**Nord** (dark). 5 tokens move, 3 colours, all lighter, and every check then passes:

| Tokens | Imported → adjusted | ΔL | Floors, before → after |
|---|---|---|---|
| `accent`, `tok-keyword` | base0E `#b48ead` → `#c8a2c1` | +0.064 | on `bg` 4.41 → 5.59, on `bg-raised` 3.55 → 4.50 |
| `error` | base08 `#bf616a` → `#f59199` | +0.157 | on `bg` 3.05 → 5.59, on `bg-raised` 2.46 → 4.50 |
| `tok-nat`, `tok-bool` | base09 `#d08770` → `#e69c84` | +0.066 | on `bg` 4.39 → 5.62, on `bg-raised` 3.54 → 4.53 |

**Solarized Light.** 13 tokens move, 8 colours, all darker, and every check then passes. The worst floor of each:

| Tokens | Imported → adjusted | ΔL | Worst floor, before → after |
|---|---|---|---|
| `fg`, `tok-ident` | base05 `#586e75` → `#576c73` | −0.005 | on `bg-raised` 4.39 → 4.51 |
| `fg-dim`, `tok-neutral`, `tok-punct` | base04 `#657b83` → `#576c74` | −0.050 | on `bg-raised` 3.64 → 4.51 |
| `accent`, `tok-keyword` | base0E `#6c71c4` → `#5d60b2` | −0.055 | on `bg-raised` 3.57 → 4.53 |
| `error` | base08 `#dc322f` → `#cd1e21` | −0.042 | on `bg-raised` 3.77 → 4.51 |
| `warn` | base0A `#b58900` → `#a87f00`, chroma reduced | −0.034 | on `bg-raised` 2.62 → 3.01 (floor 3) |
| `tok-nat`, `tok-bool` | base09 `#cb4b16` → `#bb3e00`, chroma reduced | −0.042 | on `bg-raised` 3.76 → 4.51 |
| `tok-operator` | base0C `#2aa198` → `#00756e`, chroma reduced | −0.136 | on `bg-raised` 2.58 → 4.55 |
| `tok-binder` | base0B `#859900` → `#606f00`, chroma reduced | −0.132 | on `bg-raised` 2.62 → 4.54 |

**Amended 2026-09-29, after the gap-fix task** (`00e9947`, `81c2774`). **The fine scan (§6.2's note) fixes three more
base24 schemes**, `builtin-light`, `clrs` and `terminal-basic`. Each has text greys that pass 4.5 on both its
surfaces only in a band narrower than 0.01 of `L` around `#767676`, and each one's `fg` becomes `#767676`. So the
`schemes/base24` column reads **198** passing after `apply adjusted`, **11** that cannot be fixed, and **1,066** tokens
moved. The counts in the `schemes/base16` and legacy columns are unchanged, as are the colours in Nord's and
Solarized Light's tables. Measured by
the app's own `adjustVariant` rather than §A's copy of it, over the same clones: medians 0.084, 0.090 and 0.085; the
largest change in a scheme that ends clean 0.477, 0.427 and 0.464; and tango's `on-accent` 0.554. That probe measures
the change between the rounded hexes, where §A's measured the step it asked for, so the two differ by about 0.001.
**The CPU for the 352 is 0.39 to 0.42 s** over three runs at `e58f4c4`, Node's start-up included. The gap-fix task's
own runs of the same probe gave 0.38 to 0.43 s for the adjustment as it was before the scan, and 0.58 to 0.64 s for
§A's probe, where 0.36 s is quoted above: compare figures within one run, not with that one.

### §6.6 What the store records

An adjusted half is stored with `adjusted: true`, the scheme's own 16 colours and the tokens as applied (§7.1), so
what the adjustment changed is always the difference between the two and never has to be derived again.

## §7 The store and the choice

### §7.1 `redextape.palette.custom`

`web/src/custom-palette.ts`:

```ts
type CustomHalf = {
  readonly name: string // '' when the scheme names none; shown as `untitled`
  readonly colours: Readonly<Record<Base16Key, string>> // the scheme's own 16, as read
  readonly tokens: Readonly<Partial<Record<ColourToken, string>>> // what is applied
  readonly adjusted: boolean // true when `apply adjusted` wrote `tokens`
}
type CustomPalette = { readonly light?: CustomHalf; readonly dark?: CustomHalf }
// Stored as JSON: { version: 1, light?, dark? }
```

- **`tokens` is stored, not recomputed from `colours`,** so a later change to the mapping or the adjustment never
  repaints a palette someone has already applied. `colours` is kept beside it so the dialog can show what an
  adjustment changed (§8.4).
- **Validated as `parseBuffers` validates** (`web/src/buffers-store.ts:123`): `null` for anything unusable, without
  a notice, since a failed read cannot be told from a first visit. The store is refused whole when it is not JSON;
  its `version` is not 1; a half is not an object; a `name` is not a string; `colours` lacks one of the 16 keys or
  holds a value that is not lowercase `#rrggbb`; `adjusted` is not a boolean; or a token's value is not lowercase
  `#rrggbb`. That last is required because every token reaches the pre-paint cache, whose pattern admits nothing
  else.
- **A half's `tokens` may lack a token**, as one stored before a token joins `COLOUR_TOKENS` would. That token falls
  back to the style's own palette, umbrella §7's rule. A token name not in `COLOUR_TOKENS` is dropped.
- **An import replaces its half and keeps the other. A `remove` deletes one half and keeps the other; when it
  deletes the last, the key itself is removed** (§8.5), so an empty store and no store are one state.
- **A failed write** leaves the change in force for this page load, and a notice says so. For an import: `the
  imported palette could not be saved; it applies until the page is reloaded`. For a remove: `the removal could not
  be saved; the palette comes back when the page is reloaded`. The style and palette choices' failed writes are
  silent (§2.3); these lose work the user pasted in, or bring back work the user deleted.

**Amended 2026-09-29, after the gap-fix task** (`f9034de`, `4f730b1`, `b150683`, `c3d438c`).

- **A `tokens` that is not an object refuses the store whole**, an array included: `typeof` alone had read an array
  as a half with no tokens. `CustomPalette`'s type requires a half in each of its arms, so `{}` is not one.
- **The store is written first, and the palette choice only when that write held.** An apply, a remove and an undo
  each write the imported palette, then the choice, then the cache. A choice saved over a refused write made the
  reload read what the store had lost: `custom` over a built-in choice with an older import behind it, or `match`
  over a half still stored.
- **The pre-paint cache is always what a reload reads** (§9's note), so a refused write lasts this load and no
  longer, whatever the user does next in it.
- **An undo's failed write has a notice too**: `the undo could not be saved; the palette goes again when the page is
  reloaded`. It is said only when the removal's own write held. Over a refused removal the store never lost the
  half, and a reload already shows what the undo put back.

### §7.2 `'custom'` as a choice

- `PaletteChoice` becomes `'match' | PaletteId | 'custom'`. `Palette.id` widens to `PaletteId | 'custom'`, since a
  resolved custom palette is a `Palette` for `paletteDeclarations` and `applySkin` to take.
- `PALETTE_CHOICE_LABELS` gains `custom: 'custom'`. The option's text is built from the store: `custom — light:
  Catppuccin Latte · dark: Catppuccin Mocha`; with one half, `custom — dark: Nord`; an adjusted half reads `dark:
  Nord (adjusted)`.
- **Listed while the store holds a half.** The palette select is `PALETTE_CHOICES`, plus `custom` when the store
  holds a half, rebuilt whenever an apply, a remove or an undo changes that. With nothing imported, the list is the
  four `skin-switcher.test.ts:38` pins, and that test stands.
- `readPaletteChoice(raw, custom)` reads `'custom'` only when `custom` holds a half, and as `match` otherwise, so a
  store that was cleared or refused under a stored `custom` choice shows the style's own palette, with the select
  agreeing.
- `resolvePalette(style, choice, custom)`, for `'custom'`: each half is the style's own variant with that half's
  `tokens` written over it, and a missing half is the style's own. `applySkin` takes the same third argument.
  Because a style change runs `applyChosenSkin`, the half that falls back follows the style.

## §8 The dialog

`web/src/base16-dialog.ts` builds one `<dialog class="base16-dialog">`, appended to `<body>` at start-up, closed.

### §8.1 Opening

`import base16…` is the last item in the settings menu, after `format on blur`. A click hides the menu and calls
`showModal()`; everything outside the dialog is then inert. Focus goes to the textarea. The dialog's accessible
name is its heading, `import a base16 scheme`.

### §8.2 Its contents, in order

- the heading;
- **now**, when the store holds a half: `now: light — Catppuccin Latte · dark — Nord, adjusted`, with a `remove`
  button beside each stored half (§8.5), and, when a half is adjusted, a `changes` panel listing its moved colours as
  §5.3's details do, read from the stored `colours` and `tokens`;
- the textarea, labelled `base16 scheme (YAML)`, with `spellcheck` off;
- `check`;
- the result: the reader's errors, or §5.3's summary, its adjustment line and its `details` panel. When the half it
  fills is not the one the page shows now, a line says so — `fills the light palette; the page is dark now, so it
  shows when the appearance is light` — and the appearance is not changed;
- `apply`, `apply adjusted`, `cancel`.

**Amended 2026-09-29, after the gap-fix task** (`54dee1f`, `fb84cba`).

- **The dialog has a live region of its own**, a visually hidden `role="status"` after the result. The modal makes
  the app's one live region inert while it is open, so a screen reader heard nothing when `check` finished. The
  dialog's says the summary's first line, or the reader's errors joined by `; `; a second check says it again, and an
  edit clears it.
- **The other-appearance line says what the page will show**, because an apply still chooses `custom` (§12's note),
  which changes the half on screen. With no half stored for the page's appearance: `fills the light palette; the
  page is dark now, so its palette is the style’s own until you import a dark scheme`. With one: `…, so its palette
  is the dark import, Ember, until the appearance is light`. The user's decision was to keep the switch and say so.

### §8.3 The actions

- **`check`** reads the textarea and shows the result. Editing the text afterwards clears it.
- **`apply`** stores the scheme as mapped, with `adjusted: false`, into the half its variant names; sets the palette
  choice to `custom`; applies it through `applyChosenSkin`, which also refreshes the pre-paint cache; and closes the
  dialog.
- **`apply adjusted`** does the same with §6's tokens and `adjusted: true`.
- **`cancel`**, and `Esc` through the dialog's own `cancel` event, close it with nothing changed.

A control that cannot act says why, as *edit a copy* does (`web/src/view-header.ts:612`): the reason in a visible
hint beside it and as its `aria-description`, umbrella §4 rule 4.

- `apply` and `apply adjusted` before a check, or after the text changes: `check the scheme first`.
- Both after a check that found errors: `the scheme could not be read`.
- `apply adjusted` when every check passes: `nothing to adjust — every check passes`.

Closing moves focus to `#settings`. The item that opened the dialog sits in a closed popover, and focus left there
would be stranded, the umbrella §9 list's item 1.

**Amended 2026-09-29, after the gap-fix task** (`b150683`, `787069c`). **An apply closes the dialog first**, then
stores, chooses and applies, as a remove does, so a refused write's notice reaches the app's live region after the
modal has stopped making it inert. **The dialog's own `close` handler gives the focus to `#settings`**, on every
close. The platform only seemed to: a popover hidden while it holds the focus, and a modal dialog closed, each hand
the focus back to whatever held it before they opened. That is `#settings` where a click focuses a button, as in
Chromium, and not in WebKit or in Firefox on macOS.

**Amended 2026-09-29, after the whole-branch review** (`f51906b`). **A fourth reason**, for `apply adjusted` after a
check whose every failing colour is one no lightness fixes, as in the published `papercolor-light`:
`nothing to adjust — no lightness fixes what fails`. There it moved nothing, yet stored the half as adjusted over the
tokens `apply` stores. `apply` still acts.

### §8.4 Seeing what changed

The `details` panel before applying and the `changes` panel after it are the two places. Both list each moved colour
as `base08 #bf616a → #f59199, as error text`, with a swatch of each value, drawn by setting `style.backgroundColor`
from the data. That is how `applySkin` sets tokens: a value from data, not a literal in the source, which is what
the colour gate (`scripts/check-colours.sh`) holds to the palette. The swatches are `aria-hidden`; the hex text
carries the fact.

### §8.5 Removing a half

Each stored half in the `now` line has a `remove` button. Its visible text is `remove`; its `title` and accessible
name name its half, `remove the dark palette, Nord` (`untitled` for an unnamed one), which is the tooltip the
controls gate accepts for a control whose label alone does not say what it acts on (§10).

- **It deletes that half** from `redextape.palette.custom`.
  - **When the other half remains,** the choice stays `custom`, and the removed half falls back to the style's own
    palette, umbrella §7's rule. The select's `custom` option is relabelled (§7.2).
  - **When no half remains,** the key is removed, a choice of `custom` becomes `match`, and the select drops its
    `custom` option. A choice that was not `custom` is left as it was.
  - **Either way `applyChosenSkin` runs**, so the page and the pre-paint cache follow at once (§9).
- **It closes the dialog.** The notice line is outside the dialog, and a modal makes it inert, so an `undo` offered
  while the dialog stayed open could not be reached before its `NOTICE_MS` (8 s, `web/src/notice.ts:20`) ran out.
  Focus goes to `#settings`, as every close does (§8.3).
- **It offers `undo`** in the notice, `dark palette Nord removed`, as deleting a copy does (`main.ts:1581`). `undo`
  puts back the half exactly as it was stored — `name`, `colours`, `tokens` and `adjusted` — and the palette choice
  as it was before the remove, then runs `applyChosenSkin` and rebuilds the select.
- **The offer ends at the next change to the store.** A second remove's notice replaces it, as a new notice always
  does (`notice.ts`'s own rule), and an apply dismisses it, so an `undo` never writes an old half over a newer import.

**Amended 2026-09-29, after the gap-fix task** (`4f730b1`, `200cea8`, `3d7f0f3`, `a69705f`).

- **`undo` puts the choice back only if no palette has been picked from the select since the removal**, counted by
  the gesture rather than compared by value. A choice the user made while the offer stood is theirs, even one that
  lands back on the removal's own result.
- **The focus goes to `#settings`** when the `undo` runs, expires or is drawn over while it holds the focus, not to
  the copies button the notice line falls back to for a copy's `undo`: a notice's action can name its own fallback.
- **An apply ends only the removal's own notice.** `notify` returns a handle whose `dismiss` acts only while that
  notice is still the one on the line. After the eight seconds, or once another gesture's notice has replaced it, an
  apply leaves the line alone.
- **A refused `undo` is said** (§7.1's note).

## §9 First paint

**The cache is all that is needed, and `index.html`'s script does not change.** On the load after an import:

1. `apply` ran `applyChosenSkin`, which wrote the resolved custom palette's declarations under
   `redextape.palette.css` (§2.3). Every value in them is lowercase `#rrggbb`: the reader writes no other form (§4.1),
   the adjustment rounds to it (§6.1), and the store refuses any other (§7.1). So the text matches
   `PALETTE_CSS_PATTERN`. All 812 published files, mapped, give declarations that match it.
2. `index.html`'s script reads that key and writes it onto `<html>` before first paint. It never reads
   `redextape.palette` or `redextape.palette.custom`.
3. `main.ts` then reads the choice and the store, resolves the same palette, applies it, and rewrites the same
   cache.

A style change, and a store refused at step 3, both go through `applyChosenSkin` and rewrite the cache, so the next
first paint is what this load ended on. `prepaint.test.ts`'s cases for its keys and its pattern stand as they are.

**Amended 2026-09-29, after the gap-fix task** (`c3d438c`). **The cache is written from what storage holds, not from
what this load draws.** `applyChosenSkin` draws the page from memory, and writes the cache from the style, the choice
and the imported palette read from storage as step 3 reads them, so the next first paint is what the next load goes
on to draw. The two differ only where storage refused a write: to the imported palette, which is said (§7.1), or,
silently, to the style or the choice (§2.3).

## §10 The controls gate

`controls()` (`web/tests/browser/controls-gate.test.ts:114`) changes in three ways:

- it walks `button, select, input, textarea`, so `#format-on-blur` and the dialog's textarea come under it;
- it skips a control inside a closed `<dialog>`, as it skips one in a closed popover;
- while a modal `<dialog>` is open (`dialog:modal`), it walks only the controls inside it. Everything else is inert
  by the platform's rule and would fail the focus check for that reason alone.

`selectLabel` (`:59`), which reads a select's wrapping `<label>` without the control, applies to every labelled
`input` and `textarea` too, and removes those from its copy of the label as it removes the `select`; a textarea's
text is its value, not its label.

The dialog is walked once, in Explorer, as the copies menu's states are (`:290`), for the same reason: no workspace
switch touches it. It is walked with both halves stored, so the `now` line's two `remove` buttons are walked by
their names, once open and empty, where both applies are disabled with a reason, and once after a failing fixture's
check with `details` open, where `apply adjusted` is enabled. The `undo` a remove offers is a notice action, which
the copies case already walks (`:290`).

**6a needs the same widening** for its share popover's read-only field. Whichever of 6a and 6b lands second rebases
its gate change onto the other's version rather than writing a second one.

## §11 Where 6b touches, beside 6a

| File | Region |
|---|---|
| `web/src/base16.ts`, `base16-adjust.ts`, `custom-palette.ts`, `base16-dialog.ts` | new |
| `web/src/contrast.ts` | gains `CONTRAST_FLOORS` and `binderClashes` |
| `web/src/palettes.ts` | `Palette.id` only |
| `web/src/skin.ts` | the choice, its labels, `readPaletteChoice`, `resolvePalette`, `applySkin` |
| `web/src/main.ts` | the style-and-palette block (`:354–391`) only. The import button is queried there, not in the shared mount-point list (`:165–235`) that 6a's header buttons join |
| `web/index.html` | one `<button>` at the end of `#settings-menu` (`:57–63`). The pre-paint script is untouched |
| `web/src/style.css` | one new block after `.visually-hidden` (`:1592`), away from the header rules 6a edits, with colours from tokens only: `::backdrop` mixes `--bg` with `transparent` |
| `web/tests/node/palettes.test.ts` | imports the floors and the binder rule |
| `web/tests/browser/controls-gate.test.ts` | §10, shared with 6a |

**Amended 2026-09-29, after the gap-fix task.** The table leaves out files 6b touches. One is new:
`web/src/base16-check.ts`, the check and its words, split out of `base16.ts` so that it reads, detects and maps
(`393ed23`). Six existed before 6b:

- `web/src/notice.ts`: `notify` returns a handle, and an action can name its own focus fallback (§8.5's note);
- `web/tests/browser/harness.ts`: its `SHELL` copies `index.html`'s header, the new menu item included, which 6a
  changes too; and it holds the reload and palette-pick helpers the import's tests share;
- the tests `web/tests/node/contrast.test.ts`, `prepaint.test.ts` and `skin.test.ts`, and
  `web/tests/browser/notice.test.ts`.

`main.ts` also changes two regions outside its style-and-palette block. **Its imports**, where 6a's sit too: four new,
from `base16`, `base16-dialog`, `custom-palette` and `palettes`, and two widened, `notice`'s by `Notice` and `skin`'s
by `customPaletteLabel`, `PaletteChoice` and `resolvePalette`. **And one comment**, the notice line's, which now says
a palette's `undo` names its own fallback. The plan's Pre-flight status named `harness.ts`, `notice.ts` and
`contrast.test.ts` as missing from this table before any task ran.

**Amended 2026-09-29, after the whole-branch review.** **`notice.ts` is shared with 6a**, and in two places this
branch changed. `notify`'s return: 6a's branch returns a function that withdraws its notice, where 6b's returns a
`Notice`, `{ dismiss() }`; both mean "end it, but only while it is still the one on the line", and `notice.ts`'s
`Notice` states that contract. And `NoticeAction`'s `fallback`, where a notice's action names the focus it hands on.
The controller's decision: 6b lands first and keeps `{ dismiss() }`, and 6a adapts both when it rebases onto 6b.
The paragraph above on `main.ts` named only the comment until that review; it now names the imports too, which a
rebase of 6a meets first.

## §12 When things fail

Each leaves a working app and at most one notice (umbrella §7).

- **The text does not read.** Its errors, each naming its key; nothing can be applied.
- **The scheme fails its floors.** The summary says how many and how badly; both applies remain.
- **`apply adjusted` cannot meet a floor.** That token keeps its imported value, the rest are adjusted, and the
  result says what still fails (§6.4).
- **Storage throws or is full on apply.** The palette applies for this load, with a notice (§7.1).
- **Storage throws on remove.** The half is gone for this load and comes back on reload, with a notice that says so
  and still offers `undo` (§7.1, §8.5).
- **The stored custom palette is unusable** — corrupt, or another version. It reads as nothing imported, without a
  notice, and a stored `custom` choice reads as `match` (§7.2).
- **A stored half lacks tokens.** They fall back to the style's own palette (umbrella §7).
- **The imported half is not the one on screen.** Nothing visibly changes, and the result said so before `apply`
  (§8.2).

**Amended 2026-09-29, after the gap-fix task** (`f9034de`, `4f730b1`, `fb84cba`).

- **The imported half is not the one on screen: the page can change.** The apply still chooses `custom`, so the half
  on screen becomes the one stored for it, or, with none, the style's own, whatever palette was chosen before. The
  result's line says which before `apply` (§8.2's note). Nothing visibly changes only where the palette on screen was
  already that one: `match`, or `custom` itself.
- **Storage throws or is full on apply**: the palette choice is not saved either, and the reload shows what was there
  before the apply (§7.1's note).
- **Storage throws on `undo`**: the half is back for this load and gone again on reload, with a notice that says so.
  Where the removal's own write was refused too, the store never lost the half, and nothing is said.

## §13 Testing

Fixtures are schemes written for the tests, so no third-party scheme file, and no licence, enters the repo.

| Where | What |
|---|---|
| node, `base16.test.ts` | the legacy and current layouts; `#` and bare; double, single and no quotes; upper- and lower-case hex; full-line, trailing and tab-led comments; a bare `#rrggbb`; `name` over `scheme`; `variant` light, dark, another value and absent; each missing key named; each malformed value named; a key given twice; TOML, JSON, a flow mapping, an alias and empty text each giving §4.2's message; base24 read, with its note |
| node, variant and mapping | detection on a dark and a light fixture, and on one whose `variant:` contradicts its luminance, where the file wins; every token mapped as §5.1's table says |
| node, `base16-adjust.test.ts` | an adjusted fixture meets every floor and the binder rule on its stored hex; no surface moves; each moved token's hue within 4° of its original; a lightness 0.005 closer to the original fails a floor; a fixture whose base01 is a bright colour keeps the unfixable token's value and reports what remains |
| node, `custom-palette.test.ts` | round trip; each refusal in §7.1; a half missing a token falling back token by token; an unknown token dropped; an absent half resolving to the style's own; removing each half, the other kept; removing the last half deleting the key |
| node, existing | `palettes.test.ts` over the moved floors, with its cases' names and messages unchanged; `skin.test.ts` for `custom` read, resolved and applied; `prepaint.test.ts` running the script on a custom palette's declarations |
| browser, `base16-import.test.ts` | opening from the settings menu by a real click; a passing fixture applied, then `getComputedStyle(document.body).backgroundColor` equal to its base00 under the matching appearance, and the select naming it; a failing fixture's summary and grouped details; `apply adjusted`, then `<body>`'s computed `color` equal to the adjusted `fg`; `cancel` and `Esc` changing nothing and returning focus to `#settings`; the other-appearance line; `remove` then `undo`, the stored JSON after `undo` equal to what it was before `remove`, `adjusted` included; removing the last half, and the select losing `custom` and reading `match` |
| browser, `base16-prepaint.test.ts` | after an import, `<html>`'s `style` attribute removed and the script taken from `index.html` through `?raw` run in the page: base00 is `<body>`'s background before `main.ts` runs again |
| browser, the controls gate | §10 |
| by hand | the dialog in the three styles, light and dark, at 1280×800 |

The plan sabotages each new or changed test, aiming each sabotage at one property: the reader's `#` strip removed;
the variant rule inverted; two mapping rows swapped; the adjustment allowed to move a surface; its predicate
evaluated before rounding; the gate's modal scoping removed; `remove` leaving the key when the store is empty; `undo`
not restoring `adjusted`.

## §14 Out of scope

- A per-token colour editor (umbrella §2 row 4).
- A named list of imports (§3 row 4).
- TOML, and the YAML forms §4.3 names. Loading a scheme from a file or a URL: paste only.
- base24's eight extra colours, and tinted-theming's other systems (`tinted8`).
- Adjusting a surface. A scheme whose base01 is not a background (§6.4) keeps failing where it fails.
- Exporting a palette.

## §15 Delivery

One PR. Its plan is built and gated in a scratch worktree before it is handed out, as part 5's were, and it gets
its own roadmap entry. Its change to the controls gate is coordinated with 6a's (§10).

## §16 Figures, and what produced them

The probes (§A) ran under Node v26.10.0, which runs TypeScript by stripping its types, in a scratch directory holding
the two clones; `W` is this worktree at `18f8225`. Each probe imports `web/src/contrast.ts` and `web/src/palettes.ts`
as they are, and lifts `FLOORS` and the binder case out of `palettes.test.ts` as text and runs them, so none
restates a rule it measures. `probe-detail.mts` checks that the lifted rules can fail: the six built-in variants
give 0 failures, and a planted defect gives 3 floor and 3 binder failures.

| Value | What | Produced by |
|---|---|---|
| `50f6e3b` (2026-09-23), `2b6f2d0` | the two clones | `git -C tinted-schemes log -1 --format='%h %cs'`, and the same for `legacy-schemes` |
| 352, 209, 251; 812 | files in `base16`, `base24` and the legacy set; their sum | `ls tinted-schemes/base16 \| wc -l`, `ls tinted-schemes/base24 \| wc -l`, `ls legacy-schemes/*.yaml \| wc -l` |
| 19 | colour tokens | `sed -n '/^export const COLOUR_TOKENS/,/as const/p' web/src/palettes.ts \| grep -c "^  '"` |
| 35 | floor pairs | the last line of `node probe.mts $W <any scheme>` |
| 352 read, 352 agree; 286, 29, 55; 219, 181, 175 | §2.6's `base16` row; schemes failing a floor, the binder rule, nothing; schemes failing each most-failed pair | `node probe.mts $W --summary tinted-schemes/base16/*.y*ml` |
| 209 read, 208 agree, `unikitty` | §2.6's `base24` row | `node probe.mts $W --summary tinted-schemes/base24/*.y*ml` |
| 251 read; 219 | the legacy set; its schemes failing a floor | `node probe.mts $W --summary legacy-schemes/*.yaml` |
| §2.6's eight-scheme table; Nord's 7 groups, Solarized Light's 16 | per scheme | `node probe.mts $W` over `tinted-schemes/base16/{gruvbox-dark-hard,nord,solarized-dark,solarized-light,dracula,catppuccin-mocha,catppuccin-latte}.yaml legacy-schemes/default-dark.yaml` |
| 0.58; 177; 25; 240 (so 46); 14, 12, 11; 251 of 251 | median worst ratio over floor; schemes with a 4.5 pair below 3:1; schemes failing only by ≤ 10%; failing with raised and chrome on base00; binder collisions by colour; legacy variants against their namesakes | `node probe-detail.mts $W tinted-schemes/base16 legacy-schemes` |
| 1.008 to 1.179 | contrast between `bg-raised` and `bg-chrome` in the six built-ins | the `built-ins` lines of `node probe.mts $W <any scheme>` |
| three rules; two `.ts` files | `var(--bg-chrome)` uses; `.ts` files naming either token | `grep -n 'var(--bg-chrome)' web/src/style.css`; `grep -rlE 'bg-chrome\|bg-raised' web/tests web/src --include='*.ts'` |
| none | a `<dialog>` or `<textarea>` in the app | `grep -rnE 'showModal\|<dialog\|textarea\|HTMLDialogElement' web/src web/index.html` (exit 1) |
| 0 flow, 0 anchor or alias, 0 document marker, 0 quoted key, 0 bare `#`; 1 block scalar; 6 with tabs, each inside a comment | §4.1 and §4.3's survey of the 812 | for each set, `grep -l` counted over its files for `{`, `:\s*[&*]`, `^(---\|\.\.\.)`, `^\s*["']base`, `^\s*base0[0-9A-Fa-f]:\s*#`, `:\s*[\|>][-+]?\s*(#.*)?$` and `-P '\t'` |
| 346 of 352; 6; 1,870; 457; 0.083; 0.475; 0.552; 3.27° | §6.5's `base16` column, the chroma reductions and the hue drift | `node adjust.mts $W tinted-schemes/base16/*.y*ml` |
| 195 of 209, 14; 243 of 251, 8 | §6.5's other two columns | `node adjust.mts $W tinted-schemes/base24/*.y*ml`; `node adjust.mts $W legacy-schemes/*.yaml` |
| 0.62 to 0.92 | the best fraction of `fg`'s floor any lightness reaches in §6.4's five | the same `base16` run's `cannot fix` lines |
| Nord's and Solarized Light's tables | §6.5 | `node adjust.mts $W --show tinted-schemes/base16/nord.yaml tinted-schemes/base16/solarized-light.yaml` |
| 0.36 s | CPU for the 352, Node's start-up included | `time node adjust.mts $W tinted-schemes/base16/*.y*ml` |
| 4.5, 3 | WCAG 2 AA's text and non-text contrast thresholds | WCAG 2.1 success criteria 1.4.3 and 1.4.11 |
| 0.4.2 | the styling guide's version | `styling.md` in `tinted-theming/home`, fetched 2026-09-29 |

**Amended 2026-09-29, after the gap-fix task.** The rows for §6.5's other two columns and its CPU are superseded by
§6.5's note, whose figures come from `adjust7b.mts`: `adjust.mts` with the adjustment, the floors and the binder rule
imported from `web/src` rather than written into it, beside a `hook.mjs` that lets Node resolve the app's
extensionless imports. Neither is tracked. With `W` this worktree at `e58f4c4`:

| Value | What | Produced by |
|---|---|---|
| 346 of 352, 6; 1,870; 0.084; 0.477; 0.554; 3.27° | the `base16` column, its tokens moved, median and largest changes, and hue drift | `node --import ./hook.mjs adjust7b.mts $W/web/src tinted-schemes/base16/*.y*ml` |
| 198 of 209, 11; 1,066; 0.090; 0.427 | the `base24` column | the same over `tinted-schemes/base24/*.y*ml` |
| 243 of 251, 8; 1,451; 0.085; 0.464 | the legacy column | the same over `legacy-schemes/*.yaml` |
| `builtin-light`, `clrs`, `terminal-basic`; `#767676` | the base24 schemes the fine scan fixes; their `fg` | the same with `--show` over those three files |
| 0.39 to 0.42 s | CPU for the 352, user and system, three runs | zsh's `time` around the `base16` command |

## §A Probe sources

Three scripts in the scratch directory. `probe.mts` holds the reader as §4 describes it and maps and checks each
file. `probe-detail.mts` measures how badly the failures fail, and checks the lifted rules can fail at all.
`adjust.mts` is §6's adjustment. Each lifts the floor table and the binder case out of `palettes.test.ts` as text,
strips their types with `node:module`'s `stripTypeScriptTypes`, and runs them.

`probe.mts`:

```ts
// Design-stage probe for Plan 7 part 6b: read published base16 schemes with the reader rules the spec
// proposes, map them onto the palette tokens, and hold them to the floors and the tok-binder rule that
// `web/tests/node/palettes.test.ts` applies today. The floor table and the binder check are lifted out
// of that test file as text and run as they are, so nothing here restates them.
//
//   node probe.mts <worktree> <file.yaml>...        one row per file
//   node probe.mts <worktree> --summary <files>...  totals only
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { basename } from 'node:path'

const [worktree, ...rest] = process.argv.slice(2)
const summary = rest[0] === '--summary'
const files = summary ? rest.slice(1) : rest
const web = `${worktree}/web`
const { contrastRatio, relativeLuminance } = await import(`${web}/src/contrast.ts`)
const { COLOUR_TOKENS, PALETTE_CSS_PATTERN, PALETTES, PALETTE_IDS } = await import(`${web}/src/palettes.ts`)

// ---- the floor table and the binder rule, as `palettes.test.ts` has them today ----
const testSrc = readFileSync(`${web}/tests/node/palettes.test.ts`, 'utf8')
const floorsSrc = /const FLOORS[\s\S]*?\n\]\n/.exec(testSrc)?.[0]
if (!floorsSrc) throw new Error('no FLOORS table in palettes.test.ts')
const FLOORS: [string, string, number][] = new Function(
  'COLOUR_TOKENS',
  `${stripTypeScriptTypes(floorsSrc)}; return FLOORS`,
)(COLOUR_TOKENS)
const binderSrc = /it\('keeps tok-binder apart from every other token', \(\) => \{\n([\s\S]*?)\n {2}\}\)\n/.exec(testSrc)?.[1]
if (!binderSrc) throw new Error('no tok-binder case in palettes.test.ts')
const binderCheck = new Function('VARIANTS', 'COLOUR_TOKENS', 'expect', stripTypeScriptTypes(binderSrc))
function binderFailures(name: string, v: Record<string, string>): string[] {
  let got: string[] = []
  binderCheck([[name, v]], COLOUR_TOKENS, (x: string[]) => ({ toEqual: () => { got = x } }))
  return got
}

// ---- the reader, as the spec proposes it ----
const KEYS = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '0A', '0B', '0C', '0D', '0E', '0F'].map((k) => `base${k}`)
type Read = { ok: true; name: string | null; variant: string | null; colours: Record<string, string> } | { ok: false; errors: string[] }

function scalar(rest: string): string {
  const s = rest.trimStart()
  if (s.startsWith('"')) {
    let out = ''
    for (let i = 1; i < s.length; i++) {
      const c = s[i]
      if (c === '\\' && i + 1 < s.length) { out += s[++i]; continue }
      if (c === '"') return out
      out += c
    }
    return out
  }
  if (s.startsWith("'")) {
    let out = ''
    for (let i = 1; i < s.length; i++) {
      if (s[i] === "'" && s[i + 1] === "'") { out += "'"; i++; continue }
      if (s[i] === "'") return out
      out += s[i]
    }
    return out
  }
  const cut = /\s#/.exec(s)
  return (cut === null ? s : s.slice(0, cut.index)).trim()
}

function readScheme(text: string): Read {
  const colours: Record<string, string> = {}
  const raw: Record<string, string> = {}
  const errors: string[] = []
  const meta: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^([ \t]*)([A-Za-z0-9_]+)[ \t]*:(.*)$/.exec(line)
    if (m === null) continue
    const [, indent, key, rest] = m
    const base = /^base0([0-9a-fA-F])$/.exec(key)
    if (base !== null) {
      const k = `base0${base[1].toUpperCase()}`
      if (k in raw) { errors.push(`${k} is given twice`); continue }
      raw[k] = scalar(rest)
      continue
    }
    if (indent === '' && (key === 'name' || key === 'scheme' || key === 'variant') && !(key in meta)) meta[key] = scalar(rest)
  }
  if (Object.keys(raw).length === 0) return { ok: false, errors: ['no base16 colours found'] }
  for (const k of KEYS) {
    if (!(k in raw)) { errors.push(`${k} is missing`); continue }
    const hex = /^#?([0-9a-fA-F]{6})$/.exec(raw[k])
    if (hex === null) errors.push(`${k} is not a colour: ${JSON.stringify(raw[k])}`)
    else colours[k] = `#${hex[1].toLowerCase()}`
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, name: meta.name ?? meta.scheme ?? null, variant: meta.variant ?? null, colours }
}

function detectVariant(r: Extract<Read, { ok: true }>): 'light' | 'dark' {
  const v = r.variant?.toLowerCase()
  if (v === 'light' || v === 'dark') return v
  return byLuminance(r.colours)
}
const byLuminance = (c: Record<string, string>): 'light' | 'dark' =>
  relativeLuminance(c.base00) < relativeLuminance(c.base05) ? 'dark' : 'light'

// ---- the mapping, decision 6 ----
const MAPPING: Record<string, string> = {
  bg: 'base00', 'on-accent': 'base00',
  'bg-raised': 'base01', 'bg-chrome': 'base01',
  rule: 'base02',
  'fg-dim': 'base04', 'tok-neutral': 'base04', 'tok-punct': 'base04',
  fg: 'base05', 'tok-ident': 'base05', 'focus-ring': 'base05',
  error: 'base08',
  'tok-nat': 'base09', 'tok-bool': 'base09',
  warn: 'base0A',
  'tok-binder': 'base0B',
  'tok-operator': 'base0C',
  accent: 'base0E', 'tok-keyword': 'base0E',
}
if (JSON.stringify(Object.keys(MAPPING).sort()) !== JSON.stringify([...COLOUR_TOKENS].sort())) throw new Error('mapping does not cover COLOUR_TOKENS exactly')
const variantOf = (c: Record<string, string>): Record<string, string> =>
  Object.fromEntries(COLOUR_TOKENS.map((t: string) => [t, c[MAPPING[t]]]))

function floorFailures(v: Record<string, string>): { pair: string; bases: string; ratio: number; floor: number }[] {
  const out = []
  for (const [fg, bg, floor] of FLOORS) {
    const ratio = contrastRatio(v[fg], v[bg])
    if (ratio < floor) out.push({ pair: `${fg} on ${bg}`, bases: `${MAPPING[fg]} on ${MAPPING[bg]}`, ratio, floor })
  }
  return out
}

// ---- run ----
let parsed = 0, failedParse = 0, stated = 0, agree = 0, withFloorFail = 0, withBinderFail = 0, noFail = 0
const basePairFails = new Map<string, number>()
const tokenPairFails = new Map<string, number>()
const mismatches: string[] = []
if (!summary) console.log('file\tparse\tname\tstated\tdetected(lum)\tfloor failures (token pairs, in groups by scheme colour pair: worst ratio and its floor)\tbinder failures')
for (const f of files) {
  const r = readScheme(readFileSync(f, 'utf8'))
  if (!r.ok) {
    failedParse++
    console.log(`${basename(f)}\tFAIL\t${r.errors.join('; ')}`)
    continue
  }
  parsed++
  const lum = byLuminance(r.colours)
  const variant = detectVariant(r)
  if (r.variant !== null) { stated++; if (r.variant.toLowerCase() === lum) agree++; else mismatches.push(`${basename(f)} stated ${r.variant}, luminance says ${lum} (base00 ${r.colours.base00} L=${relativeLuminance(r.colours.base00).toFixed(3)}, base05 ${r.colours.base05} L=${relativeLuminance(r.colours.base05).toFixed(3)})`) }
  const v = variantOf(r.colours)
  const cached = COLOUR_TOKENS.map((t: string) => `--${t}: light-dark(${v[t]}, ${v[t]});`).join(' ')
  if (!PALETTE_CSS_PATTERN.test(cached)) throw new Error(`${f}: mapped declarations fail PALETTE_CSS_PATTERN`)
  const fails = floorFailures(v)
  const binder = binderFailures(basename(f), v)
  if (fails.length > 0) withFloorFail++
  if (binder.length > 0) withBinderFail++
  if (fails.length === 0 && binder.length === 0) noFail++
  // Grouped by scheme colour pair, as the check shows them: the worst ratio in each group, and its floor.
  const byBase = new Map<string, { ratio: number; floor: number }>()
  for (const x of fails) {
    const g = byBase.get(x.bases)
    if (g === undefined || x.ratio < g.ratio) byBase.set(x.bases, { ratio: x.ratio, floor: x.floor })
    tokenPairFails.set(x.pair, (tokenPairFails.get(x.pair) ?? 0) + 1)
  }
  for (const k of new Set(fails.map((x) => x.bases))) basePairFails.set(k, (basePairFails.get(k) ?? 0) + 1)
  if (!summary) {
    console.log([basename(f), 'ok', r.name, r.variant ?? '-', `${variant} (${lum})`, `${fails.length} in ${byBase.size} groups; ${[...byBase].map(([k, g]) => `${k} ${g.ratio.toFixed(2)} (floor ${g.floor})`).join(', ') || '-'}`, binder.length === 0 ? '-' : binder.map((b) => b.replace(/^[^:]*: /, '')).join('; ')].join('\t'))
  }
}
console.log(`\nfiles ${files.length}; parsed ${parsed}; refused ${failedParse}`)
console.log(`variant stated in ${stated}; luminance agrees in ${agree}`)
for (const m of mismatches) console.log(`  MISMATCH ${m}`)
console.log(`schemes failing >=1 floor: ${withFloorFail}; failing the binder rule: ${withBinderFail}; failing nothing: ${noFail}`)
console.log('schemes failing each base pair:')
for (const [k, n] of [...basePairFails].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${k}`)
if (summary) {
  console.log('schemes failing each token pair:')
  for (const [k, n] of [...tokenPairFails].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${k}`)
}

// ---- the built-ins: how far apart bg-raised and bg-chrome already are ----
if (!summary) {
  console.log('\nbuilt-ins: bg-raised vs bg-chrome contrast')
  for (const id of PALETTE_IDS) for (const half of ['light', 'dark'] as const) {
    const p = PALETTES[id][half]
    console.log(`  ${id} ${half}\t${p['bg-raised']} ${p['bg-chrome']}\t${contrastRatio(p['bg-raised'], p['bg-chrome']).toFixed(3)}`)
  }
  console.log(`FLOORS has ${FLOORS.length} pairs`)
}
```

`probe-detail.mts`:

```ts
// Follow-up to probe.mts: how badly the failing schemes fail, which surface drives it, what tok-binder
// collides with, the legacy files' detected variant against the modern file of the same name, and two
// self-checks that the lifted floor table and binder rule can fail at all.
//
//   node probe-detail.mts <worktree> <modern dir> <legacy dir>
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const [worktree, modernDir, legacyDir] = process.argv.slice(2)
const web = `${worktree}/web`
const { contrastRatio, relativeLuminance } = await import(`${web}/src/contrast.ts`)
const { COLOUR_TOKENS, PALETTES, PALETTE_IDS } = await import(`${web}/src/palettes.ts`)
const testSrc = readFileSync(`${web}/tests/node/palettes.test.ts`, 'utf8')
const FLOORS: [string, string, number][] = new Function(
  'COLOUR_TOKENS',
  `${stripTypeScriptTypes(/const FLOORS[\s\S]*?\n\]\n/.exec(testSrc)?.[0] ?? '')}; return FLOORS`,
)(COLOUR_TOKENS)
const binderCheck = new Function(
  'VARIANTS',
  'COLOUR_TOKENS',
  'expect',
  stripTypeScriptTypes(/it\('keeps tok-binder apart from every other token', \(\) => \{\n([\s\S]*?)\n {2}\}\)\n/.exec(testSrc)?.[1] ?? ''),
)
const binderFailures = (v: Record<string, string>): string[] => {
  let got: string[] = []
  binderCheck([['x', v]], COLOUR_TOKENS, (x: string[]) => ({ toEqual: () => { got = x } }))
  return got
}

// Only the colour pairs are needed here; every file parsed under probe.mts's reader, so a regex will do.
const colours = (text: string): Record<string, string> => {
  const c: Record<string, string> = {}
  for (const m of text.matchAll(/^\s*(base0[0-9A-F])\s*:\s*["']?#?([0-9a-fA-F]{6})/gm)) c[m[1]] = `#${m[2].toLowerCase()}`
  return c
}
const MAPPING: Record<string, string> = {
  bg: 'base00', 'on-accent': 'base00', 'bg-raised': 'base01', 'bg-chrome': 'base01', rule: 'base02',
  'fg-dim': 'base04', 'tok-neutral': 'base04', 'tok-punct': 'base04', fg: 'base05', 'tok-ident': 'base05',
  'focus-ring': 'base05', error: 'base08', 'tok-nat': 'base09', 'tok-bool': 'base09', warn: 'base0A',
  'tok-binder': 'base0B', 'tok-operator': 'base0C', accent: 'base0E', 'tok-keyword': 'base0E',
}
const variantOf = (c: Record<string, string>, map = MAPPING) =>
  Object.fromEntries(COLOUR_TOKENS.map((t: string) => [t, c[map[t]]])) as Record<string, string>
const fails = (v: Record<string, string>) =>
  FLOORS.filter(([f, b, floor]) => contrastRatio(v[f], v[b]) < floor).map(([f, b, floor]) => ({ f, b, floor, r: contrastRatio(v[f], v[b]) }))

// ---- self-checks: the lifted rules pass the built-ins and fail a planted defect ----
let builtinFails = 0
for (const id of PALETTE_IDS) for (const h of ['light', 'dark']) builtinFails += fails(PALETTES[id][h]).length + binderFailures(PALETTES[id][h]).length
const planted = { ...PALETTES.paper.light, 'tok-binder': PALETTES.paper.light['tok-ident'], 'fg-dim': PALETTES.paper.light.bg }
console.log(`self-check: built-in failures ${builtinFails}; planted defect gives ${fails(planted).length} floor and ${binderFailures(planted).length} binder failures`)

const files = readdirSync(modernDir).filter((f) => /\.ya?ml$/.test(f))
const worst: number[] = []
let onBase00Only = 0, onBase01Only = 0, onBoth = 0, textBelow3 = 0, allWithin10pc = 0, altFail = 0
const binderWith = new Map<string, number>()
const binderRows: string[] = []
for (const f of files) {
  const c = colours(readFileSync(`${modernDir}/${f}`, 'utf8'))
  const v = variantOf(c)
  const fl = fails(v)
  if (fl.length > 0) {
    worst.push(Math.min(...fl.map((x) => x.r / x.floor)))
    const b00 = fl.some((x) => MAPPING[x.b] === 'base00' || MAPPING[x.f] === 'base00')
    const b01 = fl.some((x) => MAPPING[x.b] === 'base01')
    if (b00 && b01) onBoth++
    else if (b01) onBase01Only++
    else onBase00Only++
    if (fl.some((x) => x.floor === 4.5 && x.r < 3)) textBelow3++
    if (fl.every((x) => x.r >= 0.9 * x.floor)) allWithin10pc++
  }
  // Information only, not a proposal: the same floors with bg-raised and bg-chrome on base00.
  if (fails(variantOf(c, { ...MAPPING, 'bg-raised': 'base00', 'bg-chrome': 'base00' })).length > 0) altFail++
  const bf = binderFailures(v)
  if (bf.length > 0) {
    const toks = bf.map((s) => / from ([a-z-]+) /.exec(s)?.[1] ?? '?')
    for (const t of new Set(toks.map((t) => MAPPING[t]))) binderWith.set(t, (binderWith.get(t) ?? 0) + 1)
    binderRows.push(`${f}: base0B ${c.base0B} within 24 of ${[...new Set(toks.map((t) => `${MAPPING[t]} ${c[MAPPING[t]]}`))].join(', ')}`)
  }
}
worst.sort((a, b) => a - b)
const q = (p: number) => worst[Math.floor(p * (worst.length - 1))].toFixed(2)
console.log(`modern files ${files.length}; failing a floor ${worst.length}`)
console.log(`worst ratio / floor per failing scheme: min ${q(0)}, quartile ${q(0.25)}, median ${q(0.5)}, quartile ${q(0.75)}, max ${q(1)}`)
console.log(`failing schemes whose every failure is within 10% of its floor: ${allWithin10pc}`)
console.log(`failing schemes with a 4.5 text pair below 3: ${textBelow3}`)
console.log(`failures only on base01 surfaces ${onBase01Only}; only on base00 ${onBase00Only}; on both ${onBoth}`)
console.log(`(information) schemes failing a floor with bg-raised and bg-chrome on base00: ${altFail}`)
console.log(`binder failures ${binderRows.length}; by the base colour it collides with: ${[...binderWith].map(([k, n]) => `${k} ${n}`).join(', ')}`)
for (const r of binderRows) console.log(`  ${r}`)

// ---- legacy files: luminance against the modern file of the same name ----
let same = 0, agree = 0
const differ: string[] = []
for (const f of readdirSync(legacyDir).filter((f) => f.endsWith('.yaml'))) {
  const modern = `${modernDir}/${f}`
  if (!existsSync(modern)) continue
  same++
  const c = colours(readFileSync(`${legacyDir}/${f}`, 'utf8'))
  const lum = relativeLuminance(c.base00) < relativeLuminance(c.base05) ? 'dark' : 'light'
  const stated = /^variant:\s*"?([a-z]+)"?/m.exec(readFileSync(modern, 'utf8'))?.[1]
  if (lum === stated) agree++
  else differ.push(`${f}: legacy luminance ${lum}, modern file says ${stated}`)
}
console.log(`legacy files with a modern namesake ${same}; detected variant agrees with its variant: ${agree}`)
for (const d of differ) console.log(`  ${d}`)
```

`adjust.mts`:

```ts
// Design-stage probe for Plan 7 part 6b's `apply adjusted`: move each failing foreground token's OKLCH
// lightness, hue kept and no surface touched, by the smallest amount that meets every floor it has, then
// move `tok-binder` the same way until it is 24 from every other token. Floors and the binder rule are
// lifted as text from `web/tests/node/palettes.test.ts`, as `probe.mts` does.
//
//   node adjust.mts <worktree> <file.yaml>...            totals
//   node adjust.mts <worktree> --show <file.yaml>...     plus every changed token, per file
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { basename } from 'node:path'

const [worktree, ...args] = process.argv.slice(2)
const show = args[0] === '--show'
const files = show ? args.slice(1) : args
const web = `${worktree}/web`
const { contrastRatio } = await import(`${web}/src/contrast.ts`)
const { COLOUR_TOKENS } = await import(`${web}/src/palettes.ts`)
const testSrc = readFileSync(`${web}/tests/node/palettes.test.ts`, 'utf8')
const FLOORS: [string, string, number][] = new Function(
  'COLOUR_TOKENS',
  `${stripTypeScriptTypes(/const FLOORS[\s\S]*?\n\]\n/.exec(testSrc)?.[0] ?? '')}; return FLOORS`,
)(COLOUR_TOKENS)
const binderCheck = new Function(
  'VARIANTS',
  'COLOUR_TOKENS',
  'expect',
  stripTypeScriptTypes(/it\('keeps tok-binder apart from every other token', \(\) => \{\n([\s\S]*?)\n {2}\}\)\n/.exec(testSrc)?.[1] ?? ''),
)
const binderFailures = (v: Record<string, string>): string[] => {
  let got: string[] = []
  binderCheck([['x', v]], COLOUR_TOKENS, (x: string[]) => ({ toEqual: () => { got = x } }))
  return got
}
const MAPPING: Record<string, string> = {
  bg: 'base00', 'on-accent': 'base00', 'bg-raised': 'base01', 'bg-chrome': 'base01', rule: 'base02',
  'fg-dim': 'base04', 'tok-neutral': 'base04', 'tok-punct': 'base04', fg: 'base05', 'tok-ident': 'base05',
  'focus-ring': 'base05', error: 'base08', 'tok-nat': 'base09', 'tok-bool': 'base09', warn: 'base0A',
  'tok-binder': 'base0B', 'tok-operator': 'base0C', accent: 'base0E', 'tok-keyword': 'base0E',
}
const colours = (text: string): Record<string, string> => {
  const c: Record<string, string> = {}
  for (const m of text.matchAll(/^\s*(base0[0-9A-F])\s*:\s*["']?#?([0-9a-fA-F]{6})/gm)) c[m[1]] = `#${m[2].toLowerCase()}`
  return c
}

// ---- OKLCH, after Björn Ottosson's OKLab reference ----
type Lch = { L: number; C: number; h: number }
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
function hexToLch(hex: string): Lch {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) }
}
function lchToLinear({ L, C, h }: Lch): number[] {
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}
const inGamut = (rgb: number[]) => rgb.every((c) => c >= -1e-6 && c <= 1 + 1e-6)
/** The colour at lightness L, the hue kept, chroma reduced by bisection only as far as sRGB needs. */
function lchToHex(c: Lch): { hex: string; clipped: boolean } {
  let rgb = lchToLinear(c)
  let clipped = false
  if (!inGamut(rgb)) {
    clipped = true
    let lo = 0
    let hi = c.C
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(lchToLinear({ ...c, C: mid }))) lo = mid
      else hi = mid
    }
    rgb = lchToLinear({ ...c, C: lo })
  }
  const hex = `#${rgb.map((v) => Math.round(fromLinear(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, '0')).join('')}`
  return { hex, clipped }
}

// ---- the adjustment ----
const STEP = 0.01
/** Smallest |ΔL| at which `ok` holds, walking both directions in STEP and bisecting the step that first passes. */
function nearestLightness(orig: Lch, ok: (hex: string) => boolean): { hex: string; dL: number; clipped: boolean } | null {
  let best: { hex: string; dL: number; clipped: boolean } | null = null
  for (const dir of [1, -1]) {
    let prev = 0
    for (let k = 1; ; k++) {
      const d = Math.min(k * STEP, dir > 0 ? 1 - orig.L : orig.L)
      const at = (dd: number) => lchToHex({ ...orig, L: orig.L + dir * dd })
      if (ok(at(d).hex)) {
        let lo = prev
        let hi = d
        for (let i = 0; i < 16; i++) {
          const mid = (lo + hi) / 2
          if (ok(at(mid).hex)) hi = mid
          else lo = mid
        }
        const r = at(hi)
        if (best === null || hi < Math.abs(best.dL)) best = { hex: r.hex, dL: dir * hi, clipped: r.clipped }
        break
      }
      prev = d
      if (d >= (dir > 0 ? 1 - orig.L : orig.L)) break
    }
  }
  return best
}

const SURFACES = new Set(['bg', 'bg-raised', 'bg-chrome', 'rule'])
const floorsOf = (t: string) => FLOORS.filter(([f]) => f === t)
const meets = (v: Record<string, string>, t: string, hex: string) =>
  floorsOf(t).every(([, b, floor]) => contrastRatio(hex, v[b]) >= floor)

type Change = { token: string; from: string; to: string; dL: number; clipped: boolean; why: string }
function adjust(v0: Record<string, string>): { v: Record<string, string>; changes: Change[]; unfixed: string[] } {
  const v = { ...v0 }
  const changes: Change[] = []
  const unfixed: string[] = []
  // Foregrounds against surfaces first, then the one foreground whose floor is against another foreground
  // (`on-accent` on `accent`), so every floor is met against the value its other side ends with.
  const againstSurfaces = COLOUR_TOKENS.filter((t: string) => !SURFACES.has(t) && floorsOf(t).every(([, b]) => SURFACES.has(b)))
  const rest = COLOUR_TOKENS.filter((t: string) => !SURFACES.has(t) && !againstSurfaces.includes(t))
  for (const t of [...againstSurfaces, ...rest]) {
    if (floorsOf(t).length === 0 || meets(v, t, v[t])) continue
    const r = nearestLightness(hexToLch(v[t]), (hex) => meets(v, t, hex))
    if (r === null) {
      const o = hexToLch(v[t])
      let bestFrac = 0
      for (let i = 0; i <= 1000; i++) {
        const hex = lchToHex({ ...o, L: i / 1000 }).hex
        bestFrac = Math.max(bestFrac, Math.min(...floorsOf(t).map(([, b, fl]) => contrastRatio(hex, v[b]) / fl)))
      }
      unfixed.push(`${t} floors (best over all lightness ${bestFrac.toFixed(2)} of floor)`)
      continue
    }
    changes.push({ token: t, from: v[t], to: r.hex, dL: r.dL, clipped: r.clipped, why: 'floor' })
    v[t] = r.hex
  }
  if (binderFailures(v).length > 0) {
    const t = 'tok-binder'
    const r = nearestLightness(hexToLch(v[t]), (hex) => meets(v, t, hex) && binderFailures({ ...v, [t]: hex }).length === 0)
    if (r === null) unfixed.push('tok-binder distinctness')
    else {
      const prior = changes.find((c) => c.token === t)
      const from = prior?.from ?? v[t]
      const total = hexToLch(r.hex).L - hexToLch(from).L
      if (prior) changes.splice(changes.indexOf(prior), 1)
      changes.push({ token: t, from, to: r.hex, dL: total, clipped: r.clipped, why: prior ? 'floor+binder' : 'binder' })
      v[t] = r.hex
    }
  }
  return { v, changes, unfixed }
}

// ---- run ----
let clean = 0, alreadyClean = 0, needed = 0
const dLs: number[] = []
let clippedCount = 0
let maxHueDrift = 0
let maxHueDriftAt = ''
const unfixable: string[] = []
const cleanDLs: number[] = []
const perToken = new Map<string, number>()
let largest = { dL: 0, at: '' }
for (const f of files) {
  const c = colours(readFileSync(f, 'utf8'))
  const v0 = Object.fromEntries(COLOUR_TOKENS.map((t: string) => [t, c[MAPPING[t]]])) as Record<string, string>
  const before = FLOORS.filter(([a, b, fl]) => contrastRatio(v0[a], v0[b]) < fl).length
  const binderBefore = binderFailures(v0).length
  if (before === 0 && binderBefore === 0) { alreadyClean++; clean++; continue }
  needed++
  const { v, changes, unfixed } = adjust(v0)
  const after = FLOORS.filter(([a, b, fl]) => contrastRatio(v[a], v[b]) < fl)
  const binderAfter = binderFailures(v)
  for (const s of ['bg', 'bg-raised', 'bg-chrome', 'rule']) if (v[s] !== v0[s]) throw new Error(`${f}: surface ${s} changed`)
  if (after.length === 0 && binderAfter.length === 0) clean++
  else unfixable.push(`${basename(f)}: ${after.map(([a, b]) => `${a} on ${b}`).join(', ')} ${binderAfter.join('; ')} ${unfixed.join(', ')}`)
  const cleanAfter = after.length === 0 && binderAfter.length === 0
  for (const ch of changes) {
    perToken.set(ch.token, (perToken.get(ch.token) ?? 0) + 1)
    if (cleanAfter) cleanDLs.push(Math.abs(ch.dL))
    dLs.push(Math.abs(ch.dL))
    if (Math.abs(ch.dL) > largest.dL) largest = { dL: Math.abs(ch.dL), at: `${basename(f)} ${ch.token} ${ch.from} -> ${ch.to}` }
    if (ch.clipped) clippedCount++
    const a = hexToLch(ch.from)
    const b = hexToLch(ch.to)
    if (a.C >= 0.03 && b.C >= 0.03) {
      let dh = Math.abs(((a.h - b.h) * 180) / Math.PI) % 360
      if (dh > 180) dh = 360 - dh
      if (dh > maxHueDrift) { maxHueDrift = dh; maxHueDriftAt = `${basename(f)} ${ch.token} ${ch.from} -> ${ch.to}` }
    }
  }
  if (show) {
    console.log(`\n${basename(f)}: ${before} of ${FLOORS.length} checks below, binder ${binderBefore}; after: ${after.length}, binder ${binderAfter.length}`)
    for (const ch of changes) {
      const pairs = floorsOf(ch.token).map(([, b, fl]) => `${b} ${contrastRatio(ch.from, v0[b]).toFixed(2)}->${contrastRatio(ch.to, v[b]).toFixed(2)} (${fl})`).join(', ')
      console.log(`  ${ch.token.padEnd(12)} ${ch.from} -> ${ch.to}  dL ${ch.dL >= 0 ? '+' : ''}${ch.dL.toFixed(3)}${ch.clipped ? ' chroma-clipped' : ''}  ${ch.why}  ${pairs}`)
    }
  }
}
dLs.sort((a, b) => a - b)
const q = (p: number) => (dLs.length === 0 ? 'n/a' : dLs[Math.floor(p * (dLs.length - 1))].toFixed(3))
console.log(`\nfiles ${files.length}; clean already ${alreadyClean}; needed adjusting ${needed}; clean after adjusting ${clean}`)
console.log(`tokens changed ${dLs.length}; |dL| median ${q(0.5)}, quartile ${q(0.75)}, largest ${q(1)} (${largest.at})`)
console.log(`changed tokens whose chroma sRGB forced down ${clippedCount}; largest hue drift from rounding and clipping ${maxHueDrift.toFixed(2)} deg (${maxHueDriftAt})`)
cleanDLs.sort((a, b) => a - b)
const cq = (p: number) => cleanDLs[Math.floor(p * (cleanDLs.length - 1))]?.toFixed(3)
console.log(`over the schemes that come out clean: tokens changed ${cleanDLs.length}; |dL| median ${cq(0.5)}, largest ${cq(1)}`)
console.log(`changes per token: ${[...perToken].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`)
console.log(`schemes it cannot fix: ${unfixable.length}`)
for (const u of unfixable) console.log(`  ${u}`)
```
