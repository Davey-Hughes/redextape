# Remove `+ view` — design

**Date:** 2026-11-23. **Status:** approved by the user on 2026-11-23; G2's name and *Decided*'s last two items are
the user's, after the plan was written (2026-11-23). **Base:** `main` at `b32af3d`.
**Survey:** `~/temp/redextape-remove-plus-view-record/survey.md` (read-only, every fact cited there).

## Intent

On 2026-11-21 the user said of the app header's `+ view`: "I'm also not sure if we need the + view button, I know it
provides functionality to keep adding duplicate views but this feels unnecessary", and then "yes + view should be
removed". The aim is a header with fewer controls, giving up duplicate views.

## Today

`+ view` (`web/index.html:29-30`; menu filled by `addViewItems`, `web/src/app-header.ts:38-66`) lists every view
kind on the program and on each warm copy, plus `source` while no view shows it, and adds the pick beside the focused
view, each view in the row taking an equal share (`insertBeside`, `web/src/layout.ts:272-293`). No key opens it.

In a wide window the view toggles, the view keys and a view's split do everything else it does. What only `+ view`
does: a second view of a kind on the **Stage** (split is off there, `web/src/draw.ts:277-281`), a copy's view as an extra
Stage tab, the equal-share add, and adding beside the source view (the source view has no split).

In a window **40rem wide or narrower** (`NARROW_WINDOW`) the toggles are hidden (`web/src/main.ts:1836-1851`), and the
view-layouts spec and `help.html:49-51` name `+ view` as one of the ways left to choose views there. Without it, a
pointer-only user with only the source view left, or on the Stage, could bring views back only with *reset preset*. The
view-layouts spec left open (`docs/superpowers/specs/2026-10-11-view-layouts-design.md` §16.3 item 1) whether the
toggles at that width are hidden or moved into the workspace menu.

## Goals

- **G1.** `+ view` is gone: the button and its menu, and the code that exists only for it (survey §2): `addViewItems`,
  `PaneHost.addView`, the `'view'` member of `AddRefused.gesture` and its notice, `insertBeside`, `insert`'s
  equal-share branch, its CSS, and the comments that describe it. Code it shares with splits and the other menus stays.
- **G2.** In a window 40rem wide or narrower, the view toggles show in the workspace menu (`#workspace-menu`) as a group
  named "show" instead of being hidden. They act exactly as the header's toggles do: the same press, the same pressed
  state, the same intent load of the clif package on the clif toggle. In a wider window the toggles stay in the header
  and the workspace menu does not show them. The menu's `tiles`/`stage` row keeps its name, "views". The group's name
  is its one `aria-label`, so it is "show" in the header as well.
- **G3.** A toggle that holds the focus when the window narrows hands the focus to the workspace menu's button
  (`#workspace`); today it goes to `+ view`.
- **G4.** Share links, stored workspaces and remembered arrangements that hold duplicate views load as they do today.
- **G5.** `help.html` and the view-layouts spec (§6.1, and §16.3 item 1 marked answered by the user on 2026-11-23)
  describe what changed; the roadmap entry says what was removed and what it cost.

## Non-goals

- No change to splits (they still halve, are still off on the Stage and on the source view), the view keys, the toggles
  in a wide window, a view's title menu, or `copies ▾`.
- No replacement for a duplicate view on the Stage, a copy as an extra Stage tab, or adding beside the source view. On
  the Stage a copy is shown by switching a tab's title to it. The equal-share add goes with `+ view` (the user's
  2026-10-04 decision on it existed only for `+ view`).
- The toggles do not move into the workspace menu in a wide window.

## Approaches

Put to the user on 2026-11-23 for the narrow-window gap: **A**, accept it (reset preset is the way back on a phone);
**B**, the toggles move into the workspace menu at 40rem or narrower. **The user picked B.**

## Decided

- By the user: remove `+ view` (2026-11-21); B (2026-11-23); the design as written here (2026-11-23, "yes").
- The controller's calls, stated in the design message the user approved: on the Stage, losing duplicates and a copy as
  an extra tab is acceptable; the focus hand-off goes to `#workspace`.
- By the user after the plan was written (2026-11-23): the toggles' group in the workspace menu is named "show", not
  "views", so that it does not share a name with the `tiles`/`stage` row, which keeps "views" (G2).
- The plan's calls, confirmed by the user on 2026-11-23: a press on a toggle in the workspace menu leaves the menu
  open, as a pick of a preset or a switch does; a Stage test that needs a second view of a kind, or a copy's view as a
  second tab, builds it with a split in tiles and then switches to the Stage.

## Left to the builder

- How the toggles reach the menu: one set of buttons moved between the header and the menu as the width crosses 40rem,
  or a second set kept in step. Either way there is one source of truth for the pressed state, and the clif intent load
  fires from wherever the clif toggle is. A re-parent of a focused element needs care: the tests' Chromium fires `blur`
  before the element is disconnected, and Firefox fires no `blur` on removal (the step-focus guard).
- Moving each test that uses `+ view` to a split or a toggle, or deleting it where it tests only `+ view` (survey §3:
  50 cases in 24 browser files press it, 11 more set up with it in a `beforeAll`, 26 name `#new-view` without
  pressing it, 19 node cases test `insertBeside`).
