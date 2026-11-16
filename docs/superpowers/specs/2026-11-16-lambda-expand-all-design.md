# λ expand all — short design

## Intent

Davey, 2026-11-06: an "expand all" control for the λ view. A subterm over `AUTO_FOLD_NODES` (200) starts folded
unless the next redex is inside it ([Plan 7 part 4 §5.2](2026-09-23-plan7-part4-views-design.md)), and the only
bulk action on folds is "reset folds", which puts that policy back.

## Decisions

Davey's (2026-11-16):

1. It lives in the λ view's `⋯` display menu, next to "reset folds". No new header button.
2. It is a **mode**, not a one-time action: everything opens and stays open as the run steps, including the
   subterms a step creates. A click on a node still folds that node. "reset folds" turns the mode off.

The controller's calls, kept:

3. Under the mode a chip (a Church numeral or boolean) stays closed: its value is the readable form. A click still
   opens one.
4. The item is a toggle, built on the menu's own pattern; choosing it again turns the mode off, the same as
   "reset folds".
5. The mode survives a jump, a rebuild after an edit (`setBuild`) and a rebind (`setBindings`); the
   by-hand overrides still clear where they clear today. It is not saved to the workspace or a share link.

## Design

**`Folds` holds the mode** (`web/src/lambda-folds.ts`). Its default for a node becomes: under the mode, open
unless it is a chip; otherwise `autoOpen` as now. The overrides map sits on top of either default, so a click
folds one node under the mode exactly as it opens one without it, and `advance` needs no change: a step drops the
overrides under its contractum, and what the step built takes the default, which under the mode is open.

`reset` turns the mode off and clears the overrides. A new method clears the overrides alone, and `setBuild` and
`setBindings` call it instead of `reset`, so the mode outlives a new term while the paths that named the old one go.

My calls, each with its reason:

- **Turning the mode on clears the overrides.** "Everything opens" would not hold if a node folded by hand
  before the choice stayed folded after it. Turning it off clears them too, because the brief makes that the same
  as "reset folds".
- **The item is a `button` with `role="checkbox"` and `aria-checked`, not a `menuitemcheckbox`.** The popover is
  not a `role="menu"` and none of its items is a menu item; `DisplayMenu`'s doc records why a menu item outside a
  menu is not valid ARIA, and the display settings are `radio`s with `aria-checked` for that reason. A checkbox is
  the radio's two-state sibling and is valid anywhere.
- **It is drawn checked with the checked choice's cue**: heavier, with the `--accent` bar at its leading edge,
  so "in force" looks the same everywhere in the menu and does not rely on colour.
- **Choosing it leaves the menu open**, as a display setting's choice does (the menu's doc: a setting is picked
  and then looked at). "reset folds" stays an action that closes the menu.
- **It sits directly before "reset folds"**, so the two fold items are together and the reset stays last.
- **A new view made by a split starts with the mode off**, as it starts with no overrides: folds are per view.

## Cost check

Expanding everything grows the layout's line array, and the layout asks `Folds.isOpen` about every node it lays
out. Over ~100 ms on either clock below is Davey's call (a cap or a fallback), not the implementer's. None is.

`pnpm test:probe:lambda-expand-all` (`web/tests/browser/lambda-expand-all-cost.test.ts`), run 2026-11-16 at
`6c3e1b1` plus the path skip below, Chromium under vitest, a λ view 900 px wide, 7 repeats each. The term
map is closed (`LambdaPane`'s `map` option is off by default), so its redraw is not in these figures. The review's
logged run of the probe with the map open has every figure under the bar, its worst 53.3 ms.
*Turn on* is the item's click through the redraw to a forced layout, each on a new `Tree` with no path cached, so
each is a first turn-on on the step in view. *Step* is a `renderTree` of the term from the step before, through a
forced layout, with a new `Tree` each time. Figures are median / max.

| term | nodes | turn on | step off | step on |
|---|---|---|---|---|
| sum-to, step 460 | 17,831 | 5.2 / 6.9 ms | 2.7 / 3.5 ms | 4.3 / 5.1 ms |
| synthetic, seeded random | 19,999 | 5.3 / 8.2 ms | 1.1 / 2.2 ms | 4.8 / 5.9 ms |
| synthetic, `f x … x` spine | 19,999 | 1.9 / 2.4 ms | 1.9 / 2.7 ms | 1.3 / 1.4 ms |
| synthetic, `a (a (… z))` chain | 19,999 | 2.9 / 3.2 ms | 0.5 / 0.7 ms | 2.3 / 2.6 ms |

sum-to's step 460 is the largest term any example's recorded history holds that the view draws as a tree; the
probe steps each example's session the way the worker records it. fact-12's largest drawn is 15,601 nodes. Larger
terms exist (sum-to reaches 104,416 nodes and fact-12 54,810) but are over `LAMBDA_TREE_NODES`, refused, and shown
as text, so the mode never lays them out. The chain is the worst shape measured: every node is its own line and
none is open under the policy, so the mode takes it from 2 lines to 10,000.

**`isOpen` builds no path while there is no override** (found in review). An override is keyed by path, and a
path is as long as its node is deep; each step's `Tree` is new, with no path cached, and under the mode the layout
asks about every node, so looking up a path for each cost the sum of their depths, every step. With no override
there is nothing to look up. With one fold by hand, `isOpen` looks up the path of every node the layout asks about,
as it did before. The same probe, twice before (on `6c3e1b1`'s tree, before it was committed) and twice after, on
the chain, median / max:

| chain | turn on | step on |
|---|---|---|
| before, run 1 | 15.2 / 25.9 ms | 35.1 / 43.6 ms |
| before, run 2 | 14.3 / 25.7 ms | 15.8 / 24.1 ms |
| after, run 1 | 2.9 / 3.2 ms | 2.3 / 2.6 ms |
| after, run 2 | 2.9 / 3.5 ms | 2.5 / 2.8 ms |

On the other three terms the turn-on and step-on medians moved by 1.6 ms or less, but for sum-to's turn-on in
the second runs, 10.3 → 5.7 ms. The table above is the first run after.

## Tasks

1. `Folds`: the mode, `reset` turning it off, the overrides-only clear; node tests first (`tests/node/lambda-folds.test.ts`).
2. `DisplayMenu.expandAll` and the checkbox item in `viewMenu`; the λ pane wires it and calls the overrides-only
   clear from `setBuild` and `setBindings`; the checked cue in `style.css`. Browser test driving the real menu with
   `userEvent`, and the Tab order in `lambda-display.test.ts` gains the new item.
3. The cost probe, and its numbers here.
4. Gates: biome, typecheck, node tests, the full browser project; screenshots light and dark.
