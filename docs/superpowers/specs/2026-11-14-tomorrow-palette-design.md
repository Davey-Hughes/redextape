# Tomorrow palette, as the default — short design

**Amended 2026-11-14, at `c4ddaa1`: the palette is Material, not Tomorrow.** The first amendment below
supersedes this design's scheme, its name and id, its Colours table and its credit; the rest stands.
**Amended again the same day, at `59864b8`:** a Grayscale palette joins the built-ins, not as the
default, and one credit covers both palettes' source. **Amended a third time, at `8b4976a`:** `match
style` leaves the menu, and a custom palette's half not imported is Material's.

## Intent

Instrument's teal accent and blue-grey surfaces are not a good default. The site gets a classic grey
palette: Chris Kempson's **Tomorrow Night Eighties** for the dark half and **Tomorrow** for the light
half, as one built-in palette named **Tomorrow**. It becomes what a visitor who has never chosen a
palette sees. The site still follows the system's light or dark setting, so a dark-mode visitor gets
the grey dark half and a light-mode visitor the matching light half.

## Goals

- A fourth built-in palette, `tomorrow`, with both halves, passing all 35 contrast floors and the
  binder-separation check that hold every built-in palette.
- A visitor with no stored palette choice gets Tomorrow. The default **style** stays Instrument, so
  fonts and shape do not change.
- Paper, Terminal and Instrument stay, unchanged, and anyone's stored choice stays as it is.
- The licences page credits the Tomorrow theme under its MIT licence and says the colours are adapted.

## Non-goals

- The bordered view-switcher buttons from the mockups (a separate change, later).
- Any change to styles, to the appearance default (`system`), or to the base16 import.
- Avoiding the one-time flash described under Decisions.

## Anti-goals

- Changing a choice someone made. A stored `redextape.palette` value, including `match`, wins.
- Presenting adjusted colours as unmodified Tomorrow.
- A fourth style that differs from Instrument only in colour.

## Constraints

- `scripts/check-colours.sh` allows colour literals only in `web/src/palettes.ts` and the one
  fallback block in `web/src/style.css`.
- `web/src/prepaint.ts` keeps literal copies of keys and ids, held equal to `skin.ts` and
  `palettes.ts` by `tests/node/prepaint.test.ts`.
- Tests pin today's default and menu: `tests/node/skin.test.ts`, `tests/node/palettes.test.ts`
  (the fallback block equals Instrument), and the menu labels in `tests/browser/skin-switcher.test.ts`,
  `base16-remove.test.ts` and `custom-palette-load.test.ts`.

## Approaches

Which scheme (decided by Davey after mockups): an original "Charcoal" sketch, and several published schemes
mapped onto the app's slots (VS Code's Dark/Light Modern, Tomorrow Night / Tomorrow, Tomorrow Night
Eighties / Tomorrow, Material Darker / Lighter, Darcula / IntelliJ Light, Base16 Default). VS Code's was
declined; **Tomorrow Night Eighties / Tomorrow** was picked.

How it becomes the default:

1. **A default palette of its own (picked).** With nothing stored, the palette choice reads as
   `tomorrow` instead of `match`; `match style` stays in the menu. Style stays shape and palette stays
   colour. Costs: the menu's starting value changes, and tests that assume Instrument colours on a
   first visit change.
2. **A fourth style, `tomorrow`, made the default style.** `match` keeps working unchanged, but the style
   menu gains a near-copy of Instrument and every page's hard-coded `data-style` changes. Rejected.

## Decisions

Davey's: Tomorrow Night Eighties / Tomorrow; it follows the system setting; its own light half (the
published Tomorrow light theme, adapted), not Instrument's; approach 1.

My calls, open to correction:

- **Name and id:** "Tomorrow", `tomorrow`. Menu order: `match style`, Tomorrow, Paper, Terminal,
  Instrument, so the default sits at the top.
- **One PR:** the palette lands selectable first; making it the default is the last code commit.
- **One-time flash, accepted:** a returning visitor's first page after the change paints Instrument
  from the cached `redextape.palette.css` until `main.ts` refreshes it. The static pages keep the old
  cache until the app is next opened. No cache versioning.
- **Fallback block:** `style.css`'s fallback becomes Tomorrow's values, since it stands for the
  default palette; its test pins it to the default palette rather than to Instrument by name.
- **Colours.** Published values are from the theme's `vim/colors/Tomorrow-Night-Eighties.vim` and
  `vim/colors/Tomorrow.vim`; licence MIT, "Copyright (C) 2011 Chris Kempson". Mapping, with the only
  changes being one derived dark surface and light colours darkened (same hue) until they pass:

| slot | dark | source | light | source |
|---|---|---|---|---|
| bg | `#262626` | derived, one step below background | `#efefef` | line |
| bg-raised | `#2d2d2d` | background | `#ffffff` | background |
| bg-chrome | `#262626` | derived | `#efefef` | window |
| rule | `#515151` | selection | `#d6d6d6` | selection |
| fg | `#cccccc` | foreground | `#4d4d4c` | foreground |
| fg-dim | `#999999` | comment | `#6a6c68` | comment `#8e908c`, darkened |
| accent | `#6699cc` | blue | `#406da8` | blue `#4271ae`, darkened |
| on-accent | `#2d2d2d` | background | `#ffffff` | background |
| focus-ring | `#cccccc` | foreground | `#4d4d4c` | foreground |
| error | `#f2777a` | red | `#c82829` | red |
| warn | `#ffcc66` | yellow | `#a98400` | yellow `#eab700`, darkened |
| tok-keyword | `#cc99cc` | purple | `#8959a8` | purple |
| tok-ident | `#cccccc` | foreground | `#4d4d4c` | foreground |
| tok-nat, tok-bool | `#f99157` | orange | `#a85507` | orange `#f5871f`, darkened |
| tok-operator | `#66cccc` | aqua | `#30767b` | aqua `#3e999f`, darkened |
| tok-neutral, tok-punct | `#999999` | comment | `#6a6c68` | comment, darkened |
| tok-binder | `#99cc99` | green | `#5e7500` | green `#718c00`, darkened |

  Measured with a script over `web/src/contrast.ts`'s 35 pairs: dark 0 below floor, light 0 below floor
  after the darkening (19 below as published). `tok-binder` takes the theme's otherwise unused green
  because its red is `error`, and `contrast.ts`'s `binderClashes` holds `tok-binder` apart from every
  other token, `error` included; with green, `binderClashes` finds no clash in either half. The builder
  re-runs this through the app's own test, `palettes.test.ts`'s *keeps tok-binder apart from every other
  token*, which is authoritative.

## Left to the builder

- Where the default palette lives (e.g. a `DEFAULT_PALETTE` beside `DEFAULT_STYLE` in `skin.ts`), and
  every reader of the old `match` fallback: `readPaletteChoice`, `resolvePalette`, `PREPAINT`.
- Whether a custom palette's un-imported half should fall back to the default palette rather than the
  style's (today: the style's). Keep today's behaviour unless a test shows it reads wrong.
- The licences page entry, following how `web/licences.html` and `scripts/licences.ts` list bundled
  works; the help page sentence on settings if it names a default.
- Test updates named under Constraints, and the roadmap entry.
- After this merges, the README screenshot (held in PR #168) shows the old default; retake it.

## Amendment, 2026-11-14: Material replaces Tomorrow

Made at `c4ddaa1`, with the Tomorrow palette built and its PR (#170) open, not merged.

**Davey's decision.** He tried Tomorrow's dark half live and did not like it. He was shown nine dark
schemes as screenshots of the real app, each mapped onto the app's slots by the roles under *Mapping*
below: the base16 schemes `tomorrow-night`, `default-dark`, `grayscale-dark`, `material-darker`,
`darcula`, `gruvbox-dark-medium`, `monokai`, `onedark` and `twilight`. He then tried Material Darker
with Material Lighter live and kept it: the palette is **Material**.

**What this supersedes.** The scheme (*Intent*, *Approaches*' choice of scheme, the scheme in
*Decisions*' first line), the name and id, the Colours table and the measurement paragraph under it,
and the credit (*Goals*' last bullet). Wherever the sections above say Tomorrow or `tomorrow` for this
palette, read Material and `material`. Every other decision stands: a default palette of its own, not a
style (approach 1); following the system setting; its own light half; first among the built-ins in the
menu; one PR; the accepted one-time flash; the fallback block standing for the default palette; and
*Left to the builder*.

**Name and id:** "Material", `material`. Menu order: `match style`, Material, Paper, Terminal,
Instrument.

**Source.** The base16 schemes *Material Darker* (dark) and *Material Lighter* (light) by Nate
Peterson: `base16/material-darker.yaml` and `base16/material-lighter.yaml` in
`https://github.com/tinted-theming/schemes`, branch `spec-0.11`; MIT, "Copyright (c) 2022 Tinted
Theming". They port Mattia Astorino's Material Theme.

**Mapping.** The slot roles are the Tomorrow table's, in base16 names: bg base00, bg-raised base01,
bg-chrome base00, rule base02, fg base05, fg-dim base03, accent base0D, on-accent base00, focus-ring
base05, error base08, warn base0A, tok-keyword base0E, tok-ident base05, tok-nat and tok-bool base09,
tok-operator base0C, tok-neutral and tok-punct base03, tok-binder base0B (green, as in Tomorrow, since
red is `error`). Then the app's own `adjustVariant` (`web/src/base16-adjust.ts`, what a base16
import's `apply adjusted` runs) moved each foreground that failed a floor in OKLCH lightness, keeping
its hue, until it met every floor; it never moves a surface.

- **Dark:** `adjustVariant` moved base03 `#4a4a4a` (fg-dim, tok-neutral, tok-punct) to `#979797`, and
  nothing else.
- **Light:** the port's base05 is `#80cbc4`, the Material Theme's teal selection colour, which as text
  reads teal. Before `adjustVariant` ran, base05 was replaced with `#546e7a`, Material Lighter's own
  text colour, and base03 with `#90a4ae`, its comment colour. `adjustVariant` then moved 13 tokens,
  each marked *moved* below. `rule` was set after it, to `#ccd7da`, the port's base03, rather than
  base02's teal `#cceae7`; no contrast floor names `rule`.

| slot | dark | source | light | source |
|---|---|---|---|---|
| bg | `#212121` | base00 | `#fafafa` | base00 |
| bg-raised | `#303030` | base01 | `#e7eaec` | base01 |
| bg-chrome | `#212121` | base00 | `#fafafa` | base00 |
| rule | `#353535` | base02 | `#ccd7da` | base03 as published, not base02 `#cceae7` |
| fg | `#eeffff` | base05 | `#546d79` | text colour `#546e7a` as base05, moved |
| fg-dim | `#979797` | base03 `#4a4a4a`, moved | `#5a6c76` | comment colour `#90a4ae` as base03, moved |
| accent | `#82aaff` | base0D | `#4b6a9f` | base0D `#6182b8`, moved |
| on-accent | `#212121` | base00 | `#fafafa` | base00 |
| focus-ring | `#eeffff` | base05 | `#546e7a` | text colour as base05 |
| error | `#f07178` | base08 | `#cd1a49` | base08 `#ff5370`, moved |
| warn | `#ffcb6b` | base0A | `#b37b00` | base0A `#ffb62c`, moved |
| tok-keyword | `#c792ea` | base0E | `#7442f5` | base0E `#7c4dff`, moved |
| tok-ident | `#eeffff` | base05 | `#546d79` | text colour as base05, moved |
| tok-nat, tok-bool | `#f78c6c` | base09 | `#c03a0d` | base09 `#f76d47`, moved |
| tok-operator | `#89ddff` | base0C | `#00757c` | base0C `#39adb5`, moved |
| tok-neutral, tok-punct | `#979797` | base03 `#4a4a4a`, moved | `#5a6c76` | comment colour as base03, moved |
| tok-binder | `#c3e88d` | base0B | `#527407` | base0B `#91b859`, moved |

`palettes.test.ts`'s *meets every contrast floor in every variant* and *keeps tok-binder apart from
every other token* hold these values, as they held Tomorrow's.

**Credit.** The licences page's Colour schemes entry becomes "Material schemes for base16 (colours
adapted for the Material palette)", MIT, linked to `https://github.com/tinted-theming/schemes` with no
version; its text is that repository's `LICENSE`, byte for byte. The Tomorrow Theme entry and its
licence text go.

## Amendment, 2026-11-14: a Grayscale palette as well, not the default

Made at `59864b8`, after Material was built.

**Davey's decision**, after choosing Material: "can we actually also add the greyscale one as an
option? (not default)". He had seen Grayscale Dark among the nine previews above, mapped by the same
roles and then `adjustVariant`.

**Name and id:** "Grayscale", `grayscale`, a fifth built-in palette, last among them. Menu order:
`match style`, Material, Paper, Terminal, Instrument, Grayscale, superseding the Material amendment's
menu order. Material stays the default.

**Source.** The base16 schemes *Grayscale Dark* and *Grayscale Light* by Alexandre Gavioli:
`base16/grayscale-dark.yaml` and `base16/grayscale-light.yaml` in the same repository, branch and
licence as Material's.

**Mapping.** Material's slot roles, with no hand changes; `adjustVariant` moved 8 dark tokens and 11
light ones, each marked *moved* below. In the light half six of the eight syntax tokens land on
`#656565`; in the dark half four land within a step of `#8c8c8c` and numbers and booleans on
`#999999`. So this palette tells its tokens apart by brightness, not hue: text, dim text, (dark only)
numbers and booleans, and the binder; and `accent` and `error` share a grey in both halves. That is the
scheme's nature; the binder check still finds no clash in either half.

| slot | dark | source | light | source |
|---|---|---|---|---|
| bg | `#101010` | base00 | `#f7f7f7` | base00 |
| bg-raised | `#252525` | base01 | `#e3e3e3` | base01 |
| bg-chrome | `#101010` | base00 | `#f7f7f7` | base00 |
| rule | `#464646` | base02 | `#b9b9b9` | base02 |
| fg | `#b9b9b9` | base05 | `#464646` | base05 |
| fg-dim | `#8c8b8b` | base03 `#525252`, moved | `#656565` | base03 `#ababab`, moved |
| accent | `#8c8c8c` | base0D `#686868`, moved | `#656565` | base0D `#686868`, moved |
| on-accent | `#101010` | base00 | `#f7f7f7` | base00 |
| focus-ring | `#b9b9b9` | base05 | `#464646` | base05 |
| error | `#8c8c8c` | base08 `#7c7c7c`, moved | `#656565` | base08 `#7c7c7c`, moved |
| warn | `#a0a0a0` | base0A | `#818181` | base0A `#a0a0a0`, moved |
| tok-keyword | `#8c8c8b` | base0E `#747474`, moved | `#656565` | base0E `#747474`, moved |
| tok-ident | `#b9b9b9` | base05 | `#464646` | base05 |
| tok-nat, tok-bool | `#999999` | base09 | `#656565` | base09 `#999999`, moved |
| tok-operator | `#8c8c8b` | base0C `#868686`, moved | `#656565` | base0C `#868686`, moved |
| tok-neutral, tok-punct | `#8c8b8b` | base03 `#525252`, moved | `#656565` | base03 `#ababab`, moved |
| tok-binder | `#d1d1d1` | base0B `#8e8e8e`, moved | `#2e2e2e` | base0B `#8e8e8e`, moved |

**Credit, superseding the Material amendment's.** Material and Grayscale come from one repository
under one licence, so the licences page has one Colour schemes entry for it, named as Tinted Theming's
base16 schemes with the two palettes that adapt them, MIT, linked to
`https://github.com/tinted-theming/schemes` with no version; its text,
`web/scripts/palette-licences/tinted-theming/LICENSE.md`, is that repository's `LICENSE`, byte for
byte.

## Amendment, 2026-11-14: `match style` removed

Made at `8b4976a`, with PR #170 open, not merged.

**Davey's decision:** "I think 'match style' is kinda confusing and we should probably remove it.
people can just choose a style and palette that they like." His answers to the three questions it
raised:

1. **In #170**, not in a follow-up PR.
2. **A stored `match` resets to Material.** It reads as nothing stored, so the palette is
   `DEFAULT_PALETTE`; there is no migration to the style's own palette.
3. **A custom palette's half not imported comes from the default palette, Material**, not from the
   style's own, and so does a token an imported half lacks. A custom palette no longer follows a style
   change, and importing one half no longer moves the other off Material.

The menu is then Material, Paper, Terminal, Instrument, Grayscale, and `custom` after them once a
base16 scheme is imported. The style and the palette are independent: a style change never changes the
colours.

**What this supersedes.** `match style` staying in the menu (*Approaches*, approach 1); the
*Anti-goals*' "including `match`", since a stored `match` no longer wins; every earlier menu order,
*Decisions*', the Material amendment's and the Grayscale amendment's; and the custom-half fallback,
*Left to the builder*'s "keep today's behaviour" for a custom palette's un-imported half, with the
ruling after the whole-branch review that kept it on this branch. Every other decision stands,
Material as the default included.
