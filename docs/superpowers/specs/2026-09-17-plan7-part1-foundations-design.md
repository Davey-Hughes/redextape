# Plan 7, part 1 — Foundations: style × palette, panels, icons, focus — design

Part 1 of [Plan 7](2026-09-17-frontend-overhaul-design.md). It builds what every later part draws with:
the theming contract, the six built-in palette variants, the three styles and their fonts, the panel
primitive, the icon registry, focus rings, and a non-colour cue for every state the app marks. It answers
the one question the umbrella's §6 left for this part — Instrument's fonts — in §5.

Code facts below were read at `b0f83a9` (the design branch; its code is `7d1ee20`'s). §13 gives the
command behind each figure.

## §1 Scope

**In:** the token contract (§3); `palettes.ts` and the three palettes, six variants (§4); the three
styles and the two self-hosted fonts (§5); a minimal style and palette switcher (§6); the colour gate
(§7); `panel.ts`, with the TM rule table and the two editor collapses moved onto it (§8); `icons.ts`
(§9); focus rings (§10); a shape for every marked state (§11); tests (§12).

**Out, and where it goes:** the settings menu and moving the switcher into it (part 2); adopting icons
for the step controls and view chrome (part 2); persisting panel state per view, which needs part 2's
workspace state; announcing state to a screen reader (part 2's live region); base16 import (part 6);
token classes beyond the fourteen that exist (part 3); any redesign of the λ or TM views (part 4).

## §2 What exists

- `web/src/style.css`'s `:root` block defines 25 custom properties: 13 colours written as `light-dark()`
  pairs, two colours derived from `--tok-nat` (`--link-bg` mixes it with `transparent`; `--link-edge` is
  it), and 10 font, scale and radius values. One more, `--focus-coincident-hue`, is derived inside the
  coincident-focus rule by mixing two of those colours. **There are no colour literals outside the `:root`
  block, and none in any `web/src/*.ts` file.** The stylesheet reads its tokens through 131 `var(--…)`
  uses.
- Appearance is `data-theme` on `<html>` (`light`, `dark`, or absent for system), which sets
  `color-scheme`; every `light-dark()` follows it. An inline script in `index.html` applies the stored
  appearance before first paint. `appearance.ts` owns the logic.
- The editors have no CodeMirror theme extension; they are styled by `.cm-*` rules in `style.css`, so
  they already follow the tokens.
- `theme.test.ts` asserts the stylesheet has a rule for every `TokenClass`.
- The marked states and their shapes today:

  | State | Selector | Shape today |
  |---|---|---|
  | TM's current state row | `.state-row.is-current` | background only |
  | the rule that just fired | `.state-row.is-firing` | background + 1px outline |
  | tape head | `.cell.head` | visible border + weight 600 |
  | a row linked from a click | `.state-row.is-linked` | background only |
  | a row in the running focus | `.state-row.is-focus` | wash + solid bottom edge |
  | a linked source span | `.cm-editor .linked` | wash + solid bottom edge |
  | a linked λ span | `.term .is-linked` | wash + solid bottom edge |
  | the λ contractum | `.term .is-redex` | wash + solid bottom edge |
  | running focus, exact | `.cm-editor .is-focus-exact` | wash + solid bottom edge |
  | running focus, within | `.cm-editor .is-focus-within` | lighter wash, no edge |
  | running focus, coincident | `.cm-editor .is-focus-coincident` | stronger wash + solid bottom edge, a third hue |

  Six of the eleven share one shape and differ only by hue, which is the roadmap's accessibility items 4
  and 7.
- Five browser test files reach the controls this part replaces, through the `.table-toggle` and
  `.collapse` classes or the collapse's accessible names, in 15 places: `app.test.ts` (6),
  `lambda-pane-editor.test.ts` (4), `editor-custody.test.ts` (3), `buffer-restore.test.ts` (1),
  `tm-pane-editor.test.ts` (1). The "bring the term editor to this pane" button is selected by its
  accessible name in five files, `editor-custody.test.ts` among them; part 1 keeps that name (§8), so
  those selections do not change.

## §3 The token contract

**Colour tokens are the palette; everything else is the style.** Every colour `style.css` uses is read
from a palette token, directly or through `color-mix()` of palette tokens with each other or with
`transparent`. No rule names a colour.

**Existing token names are kept.** The 13 palette colours — `--bg`, `--bg-raised`, `--fg`, `--fg-dim`,
`--rule`, `--accent` and the seven `--tok-*` hues — keep their names, so the 131 existing uses do not
move. The three derived values (`--link-bg`, `--link-edge`, `--focus-coincident-hue`) stay derived in
`style.css` rather than becoming palette entries: a palette author sets the hues, and the marks built
from them follow. Part 1 adds the tokens its own work needs — at least `--bg-chrome`
(header and view-header surfaces), `--on-accent`, `--focus-ring`, `--error` and `--warn` — and the
plan's first task derives the final list by auditing every colour-bearing declaration in `style.css`.
The `ColourToken` type in `palettes.ts` is that list; nothing else is.

**Style tokens** — set per style, never per palette: `--font-ui`, `--font-mono`, `--radius`, the
`--space-*` and `--step-*` scales (names kept), `--label-transform`, `--label-tracking`.

## §4 Palettes as data

```ts
type ColourToken = 'bg' | 'bg-raised' | 'bg-chrome' | 'fg' | 'fg-dim' | /* … the §3 audit's list */
type Variant = Readonly<Record<ColourToken, string>>
type Palette = { readonly id: PaletteId; readonly name: string; readonly light: Variant; readonly dark: Variant }
```

- **Three palettes, six variants:** `paper`, `terminal`, `instrument`, each with a light and a dark
  variant. Starting values are the ones the brainstorm's mockups used; the contrast test (§12) decides
  the final ones.
- **Applying one** writes every token onto `document.documentElement` as `--<token>: light-dark(<light>,
  <dark>)`. The appearance mechanism is untouched: `data-theme` still sets `color-scheme`, and every token
  follows it.
- **The choice** is a style (`paper` | `terminal` | `instrument`) and a palette (`match` — the style's
  own — or a palette id). Stored under `redextape.style` and `redextape.palette`. Every read is guarded the
  way `appearance.ts` guards its own, and an unknown stored value reads as the default.
- **No flash.** Whenever the palette changes, `main.ts` caches the resolved declarations under
  `redextape.palette.css`. The inline pre-paint script applies the stored style and that cached text
  before first paint, beside the appearance it already applies. It stays tiny and self-contained, for the
  reason its own comment gives.
- **The fallback is Instrument.** `index.html`'s `<html>` carries `data-style="instrument"`, and
  `style.css`'s `:root` block holds Instrument's palette, so a first visit with nothing stored is
  Instrument — the umbrella's first-load decision.

## §5 Styles and fonts

| Style | UI font | Code font | Radius | Labels |
|---|---|---|---|---|
| Paper | system sans | system mono | 5px | as written |
| Terminal | system mono | system mono | 3px | as written |
| Instrument | **Inter** | **Hack** | 2px | uppercase, 0.04em tracking |

**Hack, not IBM Plex Mono.** The brainstorm's mockups named Plex; measured on its web font files, Plex has
none of λ, δ, β or →, so every λ would fall back to another face and break the column grid the λ and TM
views depend on. Of the nine monospace faces measured, Hack's regular face covers the most of what the
app draws:

| Face (package, version) | λ δ β | → | ▸ | ◀ | U+0304 bar |
|---|---|---|---|---|---|
| Hack (`hack-font` 3.3.0) | ✓ | ✓ | ✓ | ✓ | ✗ |
| Commit Mono (`@fontsource/commit-mono` 5.3.0) | ✓ | ✓ | ✗ | ✓ | ✗ |
| JetBrains Mono, Fira Code, Fira Mono, Source Code Pro, Noto Sans Mono (`@fontsource/*` 5.3.0) | ✓ | ✗ | ✗ | ✗ | ✓ |
| IBM Plex Mono, Red Hat Mono (`@fontsource/*` 5.3.0) | ✗ | ✗ | ✗ | ✗ | ✓ |

The combining bar does not decide anything: part 4 draws a Church numeral's bar with CSS, not with
U+0304. **Inter** (`@fontsource/inter` 5.3.0) has λ δ β but neither → nor any control glyph, which is
one of the reasons controls become SVG icons (§9).

- **Files:** Hack regular and bold (`hack-font`'s `build/web/fonts/`, not its Latin-only `-subset` files);
  Inter 400 and 600 in the Latin, Latin-ext and Greek subsets. Vite bundles them into `/assets/` with
  hashed names, which `deploy/nginx.conf` already serves as immutable.
- **Download only when used.** The `@font-face` rules are always declared; a browser fetches a face only
  when something renders in it, so Paper and Terminal fetch nothing.
- **Preload** the two files a first Instrument paint needs (Hack regular, Inter Latin 400), with
  `font-display: swap`.
- **Licences ship with the site.** Hack is MIT plus the Bitstream Vera licence; Inter is OFL 1.1. Both
  licence texts go into the built output.
- **Versions are checked live when the plan is written**, and the newest release is taken — the figures
  here are from `pnpm view` on 2026-09-17.

## §6 The switcher, for now

Two labelled selects beside the `◐` button in today's header: `style` (Paper, Terminal, Instrument) and
`palette` (match style, Paper, Terminal, Instrument). Each is a native `<select>` inside a `<label>`, as
the encoding picker is, so its visible label is its accessible name. Part 2 moves both into the settings
menu.

## §7 The colour gate

`scripts/check-colours.sh`, following its siblings: `--self-test` then the scan, `git ls-files` rather
than staged paths, and the same wiring — an `always_run` pre-commit hook and a pair of steps in CI's
hygiene job.

- **It fails on** a colour literal in `web/src/style.css` outside the fallback block — delimited by
  marker comments — or in any tracked `web/src/**/*.ts` other than `palettes.ts`. Comments are stripped
  before matching.
- **A colour literal is** a hex colour (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) or a colour function
  (`rgb`, `rgba`, `hsl`, `hsla`, `hwb`, `lab`, `lch`, `oklab`, `oklch`, `color`). `transparent`,
  `currentColor` and `inherit` are keywords, not literals.
- **What it does not see, stated so it is a decision:** CSS named colours (`red`, `white`, …). Matching
  them needs a value-position parser to avoid hits like `white-space`, and none are in the tree today.
  The self-test asserts this blind spot, so it is visible rather than accidental.
- **Day one:** the tree already has no literal outside the block (§2), so the gate lands green and
  enforces an invariant that already holds.

## §8 `panel.ts`

A named, collapsible region.

- **Shape:** a header holding a disclosure `<button>` (the disclosure icon and the panel's name, with
  `aria-expanded` and `aria-controls`) and optional actions, and a body region labelled by that button.
- **Behaviour:** the button toggles the body; `setOpen` and `isOpen` let the owning view drive and read
  it. The owning view holds the open state, as today's controls do; persistence per view arrives with
  part 2's workspace state.
- **Moved onto it in this part:**
  - the TM view's `hide δ` / `show δ` becomes a **rules** panel, with `follow current rule` as a header
    action;
  - the λ copy's "term editor" `⌃/⌄` and the TM copy's "machine source" `⌃/⌄` become one **text**
    panel — one name for what the inventory found was one control with two nouns.
- **"Bring the editor to this pane"** keeps its behaviour and its accessible name, and loses the `⌄`
  glyph it shared with the collapse: it gets its own icon (§9). Renaming it is part 2's, with the rest of
  the vocabulary. That is §4 rule 2 of the umbrella, applied to the one collision
  this part's own change would otherwise leave.
- **Accessibility items closed:** 2 (the δ toggle relabels itself unannounced — a disclosure button's
  state is `aria-expanded`, not its label) and 15 (the second collapse control).

## §9 `icons.ts`

- A registry of inline SVGs keyed by **meaning**, not shape: `disclose`, `move-editor-here`, and in later
  parts the step controls, `close`, `menu`.
- Each renders at `1em`, `aria-hidden="true"`, `focusable="false"`, drawn in `currentColor`, so it
  follows the palette and the text around it.
- A button that holds only an icon carries an `aria-label` naming the action, which is the umbrella's
  §4 rule 1. Part 1's tests assert it for the controls this part touches; part 2's class-level test
  generalises it.
- The art is either drawn in the tree or taken from a permissively licensed set and inlined; nothing is
  fetched at runtime. The plan picks, and records the licence if a set is used.

## §10 Focus rings

One global rule: `:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }`. No
rule suppresses it; the one existing `:focus-visible` rule (`.layout-divider`) is reconciled with it
rather than left as a second style. Every palette variant gives `--focus-ring` at least 3:1 contrast
against `--bg`, `--bg-raised` and `--bg-chrome` (§12). Closes accessibility item 5.

## §11 Every marked state gets a shape

Two independent channels, so states that can coincide still read apart:

- **Rows** (δ table) mark position with the left edge and the outline.
- **Spans** (source, λ) mark *what you pinned* with a box and *where the machine is* with the underline's
  style.

| State | Today | After part 1 |
|---|---|---|
| current state row | background | background + **solid left bar** |
| firing rule | background + outline | unchanged |
| head cell | border + weight | unchanged |
| linked row | background | background + **dashed left bar** |
| row in running focus | wash + bottom edge | unchanged |
| linked source / λ span | wash + solid bottom edge | wash + **1px box**, no underline |
| λ contractum (`is-redex`) | wash + solid bottom edge | unchanged — the only underline in the λ view |
| running focus, exact | wash + solid bottom edge | wash + **solid** underline |
| running focus, within | lighter wash | lighter wash + **dotted** underline |
| running focus, coincident | stronger wash + edge, third hue | stronger wash + **double** underline, third hue |

Moving the linked mark from an underline to a box is what separates it from the exact running focus,
which today differs from it by hue alone. A pinned construct the machine is currently working on — the
case the app exists to show — reads as a box around a double underline: two cues, neither of them only a
colour.

This is the visual half of items 4 and 7. The other half, a non-visual equivalent, needs announcements,
which are part 2's.

## §12 Tests

1. **Contrast, node.** For every palette variant: `--fg` and every `--tok-*` hue against `--bg` and
   `--bg-raised` at 4.5:1; `--fg-dim` against the same at 4.5:1; `--focus-ring` and `--accent` against
   `--bg`, `--bg-raised` and `--bg-chrome` at 3:1; `--on-accent` against `--accent` at 4.5:1. Computed
   with the WCAG 2 relative-luminance formula over the literal values in `palettes.ts`.
2. **Completeness.** The `Variant` type makes a missing token a compile error. A node test also checks
   every token `style.css` reads is one `palettes.ts` defines, so a rule cannot read a token no palette
   sets.
3. **The gate.** `check-colours.sh --self-test`: each literal form is caught; the fallback block,
   `palettes.ts` and comments are not; named colours are not, and the test says so.
4. **Switching, browser.** Choosing a style sets `data-style`; choosing a palette changes a token's
   computed value; "match style" follows the style; the choice survives a reload.
5. **No flash, browser.** With a style and palette stored, the document has both applied before
   `main.ts` runs.
6. **Panels, browser.** The disclosure is a button reachable by keyboard; Enter and Space toggle it;
   `aria-expanded` tracks the body; the rules panel and the text panel keep the behaviours of the
   controls they replace, and the five test files in §2 are updated to the new controls rather than
   loosened.
7. **Focus, browser.** Tabbing to a control shows an outline whose style is not `none`.
8. **Fonts, browser.** With Instrument active, `document.fonts` reports Hack and Inter loaded, and a
   rendered `λ` resolves to Hack.
9. **Deploy.** A local `docker build` and a run of the image confirm the font files are served from
   `/assets/` with a font content type. CI's `docker` job never runs on a pull request, so nothing else
   would catch a broken image before merge.

Every existing test stays green; tests that pin replaced labels change in the same commit as the control.

## §13 Figures, and what produced them

| Value | What | Produced by |
|---|---|---|
| 25, and 26 | custom properties defined in `style.css`'s `:root` block, and in the whole file | `awk '/^:root \{/,/^\}/' web/src/style.css \| grep -oE -- '^\s*--[a-z0-9-]+:' \| sort -u \| wc -l`, and `grep -oE -- '--[a-z0-9-]+:' web/src/style.css \| sort -u \| wc -l` |
| 13, 2 and 10 | `light-dark()` colours, derived colours, and non-colour properties among the 25 | `awk '/^:root \{/,/^\}/' web/src/style.css \| grep -E '^\s*--'`, read by value: `light-dark(…)` for `bg`, `bg-raised`, `fg`, `fg-dim`, `rule`, `accent` and seven `tok-*`; `color-mix`/`var` for `link-bg`, `link-edge`; two fonts, four `step-*`, three `space-*`, `radius` |
| 131 | `var(--…)` uses in `style.css` (on 124 lines) | `grep -oE 'var\(--' web/src/style.css \| wc -l` |
| 0 | colour literals outside `:root` in `style.css`, and in `web/src/*.ts` | `awk` over `style.css` skipping the `:root` block, and a `grep` over `web/src/*.ts` skipping comment lines, both for hex colours and colour functions |
| five, 15 | test files, and non-comment lines, reaching the replaced controls | `grep -rnE "\.collapse\b\|table-toggle\|(show\|hide) the (term editor\|machine source)" web/tests`, comment lines dropped, counted per file |
| five | test files selecting the claim button by its accessible name | the same search for `bring the term editor to this pane` |
| coverage table in §5 | glyphs present in each face | fontTools' `getBestCmap()` over every 400-weight `.woff2` in each package, all subsets merged |
| 3.3.0, 5.3.0 | package versions | `pnpm view <package> version`, 2026-09-17 |
