# Firefox PR 2: tab contention — design

The user's request (2026-11-03): run the web browser tier and the wasm boundary in Firefox in CI, with every Firefox
failure fixed first and CI switched on last, in five pull requests, one at a time: (1) a local Firefox project, merged
as #162 (`1b2f0cb`); (2) tab contention; (3) engine-difference test fixes; (4) the caret bug; (5) CI switch-on. This
document covers PR 2.

Code facts were read at `ec4f11a` (#163), which `origin/main` was when fetched on 2026-11-04. The measurements were
made at `1b2f0cb` in `~/temp/redextape-firefox-contention`, with Playwright 1.64.1 (Firefox `firefox-1555`) and
Vitest 4.1.12, and `ec4f11a` changes none of the files they turn on: `git diff --stat 1b2f0cb ec4f11a --
web/vite.config.ts web/package.json web/tests/browser/engine.ts web/tests/browser/collect.ts
web/tests/browser/setup.ts web/tests/browser/until.ts web/src/separator.ts
web/tests/node/browser-timeout-invariants.test.ts README.md` is empty. What `ec4f11a` adds that bears on PR 2 is in
§3.7.

`R` below is `~/temp/redextape-firefox-ci-record`. **M1** is `$R/pr2/measure-report.md` (2026-11-03) and **M2** is
`$R/pr2/measure-2.md` (2026-11-04). Their probe files are `$R/pr2/probes-2.patch`, which supersedes `probes.patch`
(the same three files, the config extended, and five more); their logs are in `$R/logs/pr2/` and their scripts in
`$R/scripts/pr2/`. **T2** is the plan's Task 2 write-up, `$R/tasks/pr2/t2-parked-copy-editor-mount.md`, and **M3**
is `$R/pr2/measure-3.md` (both 2026-11-04), with logs `$R/logs/pr2/t2-*` and `m3-*`. A figure marked "(this
spec)" was computed for this design from those logs, with the method beside it. "Focus-kind" means a first error
that matches `$R/scripts/pr2/diag.py`'s `FOCUS` pattern.

## §1 Intent, goals, anti-goals

**Why.** At Firefox's default tab count, 12 on this machine, one shared Firefox failed 51 and 47 tests beyond what
fails in one tab (M1), and one tab takes 1,194 s. While a neighbour tab can fail a test, PRs 3 and 4 cannot tell a
Firefox failure from contention. Cause 2, a test frame without the focus, fails tests even in one tab.

**Goals.**

- G1. No failure from tab contention: every failure of a full `pnpm test:firefox` run lies in the one-tab set (§6.2),
  with the rest at its 6 tabs (§4.1) and at 3.
- G2. The split stays true without a re-measurement: a file outside the capture list that takes a pointer capture
  fails, and the guard is shown to fire.
- G3. D's premises are held by checks: one Firefox per project by a test (§4.4), and no two capture-project files at
  the same time by a check in each of them (§4.10).
- G4. A programmatic `focus()` lands in a test frame that lacks the focus. The focus-kind failures of M2's one-tab
  focus run go to 0, but for any that §4.6 finds to be an engine difference, which PR 3 fixes: the five M2's probe
  cleared by the frame-focus step, the rest by §4.6's investigation.
- G5. Wall time and memory within §6.3's targets, with the rest at 6 tabs and at 3.
- G6. Chromium and the coverage gate as they are today.

**Anti-goals.**

- A1. No CI change. PR 5 switches Firefox on.
- A2. No tolerance, engine-difference or caret fix (PRs 3 and 4). A focus failure §4.6 finds to be an engine
  difference is recorded in PR 2 with its evidence and fixed in PR 3 (§2, decision 3).
- A3. No change to `web/src`.
- A4. No vitest internals: documented config, the documented command context and Playwright's public API. Internals
  are why approach A was not chosen.
- A5. No Chromium test changes what it runs, and Chromium pages install none of PR 2's new code: `firefox-input.ts`
  sets up its wrappers, hooks and command calls in Firefox alone (§4.1).

## §2 The user's rulings

From the Log of `$R/progress.md`.

- **Approach B for the lane** (2026-11-03): every Firefox failure fixed before CI runs Firefox, with no
  expected-to-fail marks and no advisory job, in five PRs. This is PR 2.
- **PR 2's approach is D** (2026-11-04): two Firefox projects with separate browsers. The 7 capture files,
  default-views-gestures, divider-drag-focus, divider-drag-format-on-blur, panel-boundaries, panel-regions,
  panel-sizes-stored and view-keys, run one at a time (`browser.fileParallelism: false`) in their own Firefox, at the
  same time as the rest at the default tab count. A guard fails when a file outside the 7 takes a real pointer
  capture. Not chosen: A, one Firefox per tab through vitest internals; B, one tab. Decision 1 below makes the
  capture files 8, and R6 below puts the rest at 6 tabs.
- **Cause 2 is in PR 2** (2026-11-04): the test frame is focused (`window.focus()`) before a case's first
  programmatic `focus()`, which cleared 5 of 9 in M2's probe, and PR 2 works out the other 4. Decision 4 below widens
  the step to every such `focus()`.
- **PR 1's decision 8** (2026-11-03; PR 1's roadmap entry, THE USER'S DECISIONS): in a file whose cases run in order
  by design, each on what the one before left, the alone check re-runs a case together with the cases before it.
  §6.2's alone rule applies it.
- **This spec's six decisions** (2026-11-04, the user's answers to §10 at `08ec2b4`; §10 lists them one line each):
  1. "Add it": `step-focus-recording.test.ts` joins the capture list as the 8th capture file, beside D's 7. §6.2's
     instrument run confirms it (§4.2).
  2. "Add a permanent check": a check fails when two capture-project files run at the same time (§4.10, S8). The
     deprecated `browser.fileParallelism: false` stays, and the check is what keeps it honest at a vitest bump.
  3. "PR 3": an engine difference in focus that §4.6 finds is recorded in PR 2 with its evidence and fixed in PR 3
     (§4.6).
  4. "Yes, every one": the frame-focus step acts on every `focus()` made while the frame lacks the focus, not only a
     case's first (§4.5). Its sabotage still shows it firing (S3, S9).
  5. "Blocks PR 2": a failure outside the one-tab set that passes alone blocks PR 2 until its cause is found (§6.2).
     At the spec's review (2026-11-04) the user ruled "Blocks now" on parked-copy-editor-mount's failure in
     `d-split-2`, at `1b2f0cb`: it blocks PR 2 until its cause is found, whether or not a run at PR 2's head repeats
     it. On the plan's pre-flight (2026-11-04) the user ruled "Yes, every run": the rule covers a failure outside R
     that passes alone in any run made during PR 2, the plan's mid-branch runs included, not only the head's, and each
     such failure is put through a cause-finding before the PR opens (§6.2). Since R6 (below), Task 2's
     alone-passing failures take cause 3 as their cause (§6.2). On the Firefox coverage check (§6.1, 2026-11-04),
     "Yes, they block too": its failures outside R take the rule as any run's; and "Explained, don't block": fix
     round A's four rows, from direct `--project` coverage calls (three in the rest at Vitest's 12 tabs, cause 3;
     two-browsers without the `firefox` project, failing by design), do not block, and the check runs through
     `test:firefox`. On view-keys' failures in the caret class's shape (§4.9), the caret at offset 0 and not where it
     was, "The shape, until PR 4": such a failure is in R until PR 4, and a view-keys failure of any other shape
     still counts (§6.2). It replaced "Explained; add it to R by name", given for the held-key case alone ("a key held
     down > lets a key held since before the prefix repeat …"), which failed so in two full runs at the head.
  6. "Accept": the C5 and C6 targets are at most 300 s and 8 GiB at the default tab count, and at most 450 s and
     4.5 GiB at 3 (§6.3). Since R6 (below), the first pair is read with the rest at 6 tabs.
- **R6: one Firefox, 6 tabs** (2026-11-04, after the plan's Task 2 stopped on cause 3, §3.8, on M3's figures): the
  rest stays in one Firefox, at 6 tabs (§4.1); the capture project is unchanged, its files one at a time in their own
  Firefox. In M3, R6 had 0 timeouts and 1 other failure outside R over 2 runs, that one in the capture project, in
  214 s and 5.27 GiB on average, inside C5 and C6. Not chosen: S3, the rest over three Firefoxes of 4 tabs, 0 outside
  R in 136 s but 8.80 GiB, over C6; S4, four of 3, 9.13 GiB; and keeping D at the default count with ruling 5 lifted
  for the class. For ruling 5 it means: Task 2's failures outside R that passed alone, 32 distinct cases
  (`$R/tasks/pr2/outside-r.md`), take cause 3 as their class cause; §6.3's runs at the head, under R6, test it, and a
  case of the 32 that fails again in them gets a cause-finding of its own (§6.2).

## §3 What was measured

### §3.1 Cause 1: one mouse for every page of a Firefox

- **The driver** (M1 Q2, read from `firefox-1555`'s Juggler): Playwright opens every page as a top-level window of one
  browser process, and `Page.dispatchMouseEvent` synthesises each event in that process with
  `DEFAULT_MOUSE_POINTER_ID`. Every page's mouse is pointer 0 of one process. Key events do not activate a window.
- **The one capture site.** At `ec4f11a`, `grep -rn setPointerCapture web/src` finds only `separator.ts`'s
  `pointerDrag`, which calls it synchronously in its `pointerdown` listener, after `preventDefault`. Its users are
  `layout-view.ts`'s `.layout-divider` and `panel-stack.ts`'s `.panel-boundary`, and the `.panel-header` of a region
  that resizes (M2, D's file list, step 1).
- **The decoy probe** (M1, `focus-probe.test.ts`'s drag case, the `PROBE drag` lines of `probe-focus-3.log`). A real
  press on a 12 px handle, a decoy page in another context of the same browser clicking its own counting button during
  the press, then a move of 80 px in 5 steps and a release:

  | press on the handle | decoy click during the press | moves the handle heard (of 6) | pointerups heard | decoy's click counted |
  |---|---|---|---|---|
  | with `setPointerCapture` | no | 6 | 1 | - |
  | with `setPointerCapture` | yes | 2 | 2 | 0 |
  | without capture | yes | 1 | 1 | 1 |

  While one page holds the capture, another page's click goes to it: its capture ends early and the decoy loses the
  click. Without a capture each page gets its own input.
- **At scale** (M1 Q1), beyond the one-tab set, one shared Firefox: 51 and 47 at 12 tabs (presses that did not act 24
  and 21, drags 10 and 9), 11 at 4, 17 at 3, 10 at 2. Lost `beforeAll` clicks: view-keys-format-on-blur's (`default-2`,
  2 more skipped) and panel-boundaries' hovers (`tabs4-1`, 24 more). One Firefox per tab (E1) left 5 beyond, with 1
  drag and no lost press.
- **Not window focus and not CPU** (M1): after a decoy window takes the activation, the test page still reports
  `document.hasFocus()` true (`focusmanager.testmode` is on in Playwright's Firefox), and E1 lost cause 1's failures at
  a higher load (to 159.9) with more processes (84 against 18).
- **Synthetic presses hold no capture.** M2 (step 4): 19 synthetic `setPointerCapture` calls, 0 held (divider-drag 9,
  panel-boundaries 6, panel-regions 2, engine 1, layout-view 1). PR 1's Task 3 fix round, in one shared Firefox: 36
  synthetic presses held none, 2,400 synthetic captures were no-ops and 0 of 60 decoy clicks were lost (`$R/progress.md`).

### §3.2 D, measured (M2)

- **Two projects, two Firefoxes** (`d-probe-3.log`). A capturing handle in project `firefox-cap`, with the decoy in a
  page of its own project's browser or of the other project's:

  | capture | decoy's browser | moves heard (of 6) | pointerups heard | decoy's click counted | decoy alone counts |
  |---|---|---|---|---|---|
  | yes | same project | 2 | 2 | 0 | 1 |
  | yes | other project | 6 | 1 | 1 | 1 |
  | no | other project | 1 | 1 | 1 | 1 |

  The same-project rows, the precondition, held twice. The `register` lines read `sameBrowserObject: false`,
  `distinctBrowsers: 2` and `jugglerChildren: 2`. No vitest document promises one provider per project; in 4.1.12
  `getBrowserProvider` runs per project (M2).
- **What concurrency needs.** The capture project limited by `browser.fileParallelism: false` ran beside the rest. With
  `maxWorkers: 1` it ran after the rest finished (`d-probe-2`), and two projects with different `maxWorkers` in one
  `sequence.groupOrder` group are refused at startup ("Provide unique 'sequence.groupOrder'"). Each project needs its
  own `instances` array: a shared one stops startup with `project name "firefox (firefox)" was already defined`
  (`d-probe-1`).
- **The runs.** Beyond means outside `tabs1-1`'s failures (`beyond.py`); wall time runs from the lock to the exit;
  memory is the scope's `memory.current` peak.

  | approach | run | tabs | beyond | wall s | memory GiB |
  |---|---|---|---|---|---|
  | D | `d-split-1`, `d-split-2` | 12 + 1 | 2, 2 | 177, 214 | 7.40, 7.45 |
  | D | `d-split-tabs3-1` | 3 + 1 | 1 | 379 | 3.78 |
  | one shared Firefox | `default-1`, `default-2` (M1) | 12 | 51, 47 | 296, 212 | 5.89 (`default-1`) |
  | one shared Firefox | `tabs3-1` (M1) | 3 | 17 | 426 | 3.12 |
  | A, one Firefox per tab | `e1-persession-2`, `e1-tabs3-1` | 12, 3 | 7, 7 | 135, 438 | 10.85, 4.14 |
  | B, one tab | `tabs1-1` (M1) | 1 | 0 | 1,194 | unmeasured |

  In D the capture project had 1 file in flight in all three runs, over 72, 92 and 73 s, and the rest had 12, 12 and 3,
  over 174, 211 and 378 s (`peaks.py`). The 1-minute load ran from 54.85 to 71.11 across D's runs.
- **What D left.** No drag-kind failure beyond one tab in any D run. Each D run skipped 19, the floor at `1b2f0cb`
  (`numPendingTests` in each JSON, this spec), so no `beforeAll` was lost. Beyond `tabs1-1`: the view-keys caret test in
  every run (§3.5), view-keys-focus's "leaves the focus alone when the window is narrowed with the f…" ("precondition:
  the toggles are shown", `d-split-1`) and parked-copy-editor-mount's "… has an editor when it comes back"
  (`locator.click: Timeout 680ms`, `d-split-2`). The first two also fail in `focusobs-1` and `focusfix-2`, one tab.
  Against the union of the three one-tab runs, `tabs1-1`, `focusobs-1` and `focusfix-2` (122 tests by file and name),
  D's beyond is 0, 1 and 0, the 1 being parked-copy-editor-mount's (this spec: a set difference of the runs'
  `-failures.tsv` on file and test), which blocks PR 2 until its cause is found (§2, decision 5; §6.2). None of the three is one of T3's 37 (`$R/logs/pr1/t4-t3-table.md`, by title).

### §3.3 The capture list (M2, `$R/pr2/capfiles.txt`)

1. A grep of `tests/browser` for `userEvent.dragAndDrop`, the harness's `drag` and real clicks on a separator or a
   resizing header found 6 files: all of the 7 but view-keys.
2. **The deciding instrument**, `capture-diag.ts`, wrapped the test frame's `Element.prototype.setPointerCapture` and
   recorded each call's `window.event.isTrusted` and whether `hasPointerCapture` held straight after. Over the whole
   tier in A's mode (`capdiag-e1-1`), where no press is lost to contention first, 7 files took a real capture that
   held: default-views-gestures 4, divider-drag-focus 7, divider-drag-format-on-blur 2, panel-boundaries 12,
   panel-regions 3, panel-sizes-stored 7 and view-keys 1. View-keys' "lets a pointer press at the hint through to what
   is under it" clicks a `.layout-divider` under the hint, which the grep could not see.
3. In one shared Firefox (`capdiag-default-2`, a line per file) each file's total equals the sum of its tests', so no
   capture is taken in a `beforeAll` or `afterAll`. There divider-drag-format-on-blur took none: its precondition
   clicks failed under contention, which is why step 2 ran in A's mode.

### §3.4 Cause 2: a frame without the focus ignores `focus()`

- **The mechanism** (M1, `focus-probe.test.ts`, its `PROBE focus() inactive` line): with the focus in the top
  document, `button.focus()` in the test frame leaves the button unfocused and fires no `focus` event. `window.focus()`
  or a real click gives the frame the focus, after which `EditorView.focus()` takes.
- **Every file starts that way** (M1): the probe's `PROBE start` reads `hasFocus` false and `topHasFocus` true, and
  all 96 files of `diag-default-1` started so. That is the base's "`document.hasFocus()` false at the start of all 212
  files" from PR 1's list: the frame's start state, not contention.
- **Vitest already does this for keys.** `@vitest/browser-playwright` 4.1.12's `keyboard` command evaluates
  `focusIframe` in the frame before it types, and `focusIframe` calls `window.focus()` when the frame's
  `document.activeElement` is missing, in another document, or `<body>` (its `dist/index.js`). A case whose first
  focus is a key press is focused by vitest; one whose first focus is `focus()` is not.
- **M2's fix probe**, 16 files in one tab (`chain-m2c.sh`'s `FILES`: view-keys, view-keys-focus, storage-blocked,
  vim-keymap, lsp-hover, about-menu, state-diagram-no-machine, lambda-display, focus, live-views-bound-switch, notice,
  view-toggles, lambda-follow, focus-handoff, tm-pointer, four-views-fixture). `focus-fix.ts` calls `window.focus()`
  before a case's first `focus()` when `document.hasFocus()` is false; `focus-observe.ts` is the same file without
  that call.

  | run | failed / passed / skipped | focus-kind (M2's count) | focus-kind (this spec) |
  |---|---|---|---|
  | `focusobs-1`, without the step | 36 / 127 / 3 | 9 | 10 |
  | `focusfix-2`, with the step | 27 / 136 / 3 | 3 | 4 |

  The step cleared view-keys' "arms on the prefix from the source editor, …", view-keys-focus's "stays on the toggle
  the keys leave as the only one pressed, …", lsp-hover's, state-diagram-no-machine's and vim-keymap's. It fired in 12
  tests and all 12 passed, and `focusfix-2`'s failures are a subset of `focusobs-1`'s by test (this spec).
- **A count correction (this spec).** The `FOCUS` pattern over each run's `-failures.tsv` gives 10 and 4.
  M2's join of its `FFFIX` lines left out live-views-bound-switch's "is refused where it would make 65 of 63, …"
  ("left the focus on `<body>`"), which is focus-kind in both runs. Both counts rest on about-menu's first error,
  which `FOCUS` matches as `<body>` (`focusobs-1`) and not as `<a …>` (`focusfix-2`), and each shape occurs in runs
  with and without a step (fix round A: `<a …>` in `t6-s3-16` and `m3-s3-1`, no step, and `<body>` in `t6-16`, the
  step's); with about-menu's case kept apart they are 9 and 4 (`p16-step`'s and `t6-16`'s 4 as well). So the step
  reached 5 of 9, and four fail on, with about-menu's beside them:

  | test | first error, with the step | step fired | focused at its start | failed in |
  |---|---|---|---|---|
  | about-menu, "opens on a click, says so, and focuses its first link" | its last assertion, the focus back on its button after Escape: on the first link in `focusfix-2`, on `<body>` in `focusobs-1`, each shape with and without a step across the record | no | no | both focus runs only |
  | lambda-display, "is one tab stop per group, …" | "the menu opens on the checked choice": `<body>` | no | no | base run 1, base one-tab re-run, `tabs1-1`, `e1-persession-2`, both focus runs |
  | live-views-bound-switch, "is refused where it would make 65 of 63, …" | "left the focus on `<body>`" | no | no | `tabs1-1`, `d-split-tabs3-1`, `e1-persession-2`, both focus runs |
  | view-keys-focus, "goes to + view when the window is narrowed past 40rem, …" | "the focus is not on + view in the narrow window, at once": `<body>` | no | yes | every run checked: both base runs and its one-tab re-run, `tabs1-1`, `default-1`, `default-2`, the three D runs, `e1-persession-2`, both focus runs |
  | view-toggles, "hides a kind on a press: …" | "the press cost the toggle its focus": `<body>` | no | no | base one-tab re-run, `e1-persession-2`, both focus runs |

  "Step fired" and "focused at its start" are the `FFFIX` columns of `focusobs-1.log` and `focusfix-2.log`, alike in
  both. "Failed in" greps for the title in the `-failures.tsv` of the three base runs, `tabs1-1`, `default-1`,
  `default-2`, the three D runs, `e1-persession-2` and the two focus runs (this spec); a run of that set not named
  passed it.
- **What is known of the five, and what is not.** The step did not fire in any of them: their first programmatic
  `focus()` found the frame focused, or they made none, since `focus-fix.ts` looks at the first call only (PR 2's step
  looks at every call, §4.5). about-menu's failing assertion follows no `focus()` call at all: the popover's hiding
  hands the focus back (`wireMenu` sets `autofocus` and calls no `focus()`), so no step on `focus()` acts on it. Four
  failed in the 16-file run and in at most one of D's three full runs, which points at what the file before them in the
  tab left (unmeasured). What takes their focus is unmeasured (M2). lambda-display's file is in the base's cluster C
  focus-semantics (`$R/scripts/cluster.py` assigns it by file), which PR 1's entry gives to PR 3; view-keys-focus's
  message matches the base's cluster E page-focus. live-views-bound-switch and view-toggles are chained files (M1 Q5).
- **A cross-file leak** (`$R/progress.md`, from step-focus's rebase report,
  `~/temp/redextape-step-focus-record/reviews/rebase-report.md` §2, its cause 3). After extend-focus-probe in one
  Firefox tab, step-focus-recording's "⏭ at a `budget` stop hands the focus to ▶, …" fails 3 of 3 ("where the focus
  settles after ⏭ at the budget stop: expected 'BODY' to be 'one step forward'"); it passes 2 of 2 alone and at default
  tabs. extend-focus-probe's first case calls `extend.focus()` and fails on main with the focus left on `<body>`, the
  shape of cause 2. The step's effect on the pair is unmeasured. The same report's cause 2: step-controls' "still hands
  the focus on when nothing in the strip is live" fails in one tab after app.test.ts.
- **The whole tier in one tab** (`tabs1-1`, without the step): 17 focus-kind failures in 16 files (this spec):
  add-view-floor, extend-focus-probe, follow-kept, lambda-copy-typed-text, lambda-display, layout-view,
  live-views-bound-switch, lsp-hover, notice, state-diagram-no-machine, step-controls, storage-blocked, view-header,
  view-keys, view-keys-focus and view-keys-popovers. The step was measured on M2's 16 files only.

### §3.5 The view-keys caret test

view-keys' "a key held down > acts once with Ctrl held through a held ], and its repeats are not the editor's" fails
on "the caret is not where it was: expected +0 to be 14" in base run 1 and in every D run. It failed in both base runs
and in the base's one-tab re-run (`$R/logs/firefox-full-failures.tsv`, `firefox-full2-failures.tsv`,
`firefox-rerun-1tab-failures.tsv`), and in 13 of the 14 runs of M1 and M2 checked, all but `tabs1-1` (this spec: a
count of the title in each run's `-failures.tsv`). In D, view-keys runs in its own Firefox one file at a time, and the
test failed 3 of 3. In one tab of one shared Firefox it failed in `focusobs-1` and `focusfix-2` and passed in
`tabs1-1`. `cluster.py` puts it in "B caret" by its first error: the 25-test cluster that PR 1's entry calls PR 4's
cluster 2. In `focusobs-1`, 16 view-keys tests, this one among them, fail on that same first error (this spec).

### §3.6 PR 1's other items, measured

- **The no-wait popover asserts** (M1 Q6): header-menus-narrow's `openAt` failed 3 times in `default-1` and 0 times in
  `default-2`, at 4, 3, 2 and 1 tabs and in E1; share-popover failed in no run but E2. In D, header-menus-narrow failed
  the same 9 tests as in `tabs1-1`, on the gutter and one-line messages (checked for `d-split-1`; 9 in each D run), and
  share-popover failed none (this spec).
- **panel-boundaries' "skip a closed region, and are drawn beside it again once it is open"**: no failure in
  `tabs1-1`, `default-1`, `default-2` or the three D runs (this spec).
- **The chained files** (M1 Q5, by their docs): base16-remove, base16-import, four-views-fixture, parked-view-state,
  readout-history-full, readout-history-held, live-views-bound, live-views-bound-switch, one-id-two-kinds-stored,
  view-toggles-two-of-a-kind, view-toggles (seven of its cases) and share-open-hashchange (said by share-open-latest's
  doc).

### §3.7 What `ec4f11a` adds

- **A file that captures.** `step-focus-recording.test.ts` (new in #163) drags `#views .layout-divider` with
  `userEvent.dragAndDrop` in "⏭ waiting through a divider's drag keeps the focus and waits on; …": a real press on a
  separator. The grep of §3.3's step 1, re-run at `ec4f11a` (`grep -l "userEvent.dragAndDrop\|[^a-zA-Z.]drag(" *.test.ts`
  in `web/tests/browser`), finds M2's 6 and this file. The runtime instrument has not run at `ec4f11a`; §6.2's base
  run confirms the file (§2, decision 1).
- **Two more gates.** At `ec4f11a`, `web/tests/browser` holds 19 `chromiumOnly` calls against 17 at `1b2f0cb`, both in
  step-controls, so Firefox's skip floor becomes 21 if each skips one test (§6.2 measures it).
- **The base's counts are not measured here.** `web/tests/browser` has 221 `.test.ts` files at `ec4f11a` against 220,
  7 of them probes; §6.2's base run records the files and tests.

### §3.8 Cause 3: one Firefox parent carries every tab's real input, on about half a core under load (T2, M3)

- **The case.** parked-copy-editor-mount's "… has an editor when it comes back" makes 10 real clicks (7
  `clickToggle`, `#new-view`, its item, the view's ✕) in one 15,000 ms body. In `d-split-2` its 8th click failed with
  `locator.click: Timeout 680ms`: `@vitest/browser` 4.1.12's `processTimeoutOptions` gives a locator command the
  case's remaining time less 100 ms, so 14,220 ms of the 15,000 had gone. T2 reproduced it in `t2-timed-d-4` ("Test
  timed out in 15000ms", 16,700 ms); D's other runs there took it 1,452 to 13,521 ms, and alone 916 to 3,064 ms.
- **Where the time went** (T2's timed copy, `t2-timed-*`): the real clicks, 93-97% of the body under D, a median of
  577-1,010 ms each against 74 ms alone, none standing out. The page drew 21-68 frames during each click over 400 ms
  (3-7 alone), so its own work ran; and the file before it in its tab differed in every run.
- **The thread.** Every real click is synthesised in the browser's one parent process (§3.1). In the rest's 12-tab
  Firefox that process's main thread was runnable 88-98% of the case's slow windows and ran 39-60% of them, at loads
  of 58 to 70 on 32 CPUs (`/proc/<pid>/task/<pid>/schedstat`, `t2-timed-d-2` to `-4`). Half a CPU for the whole tree,
  alone (`CPUQuota=50%`), took the case 3,006-3,481 ms, so CPU alone does not explain D's lengths.
- **Not cause 1 or 2:** every click acted, late, and the case failed on its timeout, not on an assertion; no
  `focus()` failed. One Firefox per tab (A) took it 1,090-4,952 ms, at loads up to 159.89.
- **The class** (`$R/tasks/pr2/outside-r.md`). T2's seven D runs failed 49 tests outside R besides it, 32 distinct
  cases in 15 files: 26 timeouts (`Test timed out in 15000ms`, a `locator.click: Timeout` with little of the bound
  left, an `until` that ran out) and 23 assertions; 17, 12 and 6 in `t2-d-*`, at loads of 68 to 80 at the lock. Each
  case passed alone, state-diagram's "keeps a runtime box's focus while the run moves, …" as its whole file (under
  `-t` the hooks of the describe before it, which leave the machine where the case starts, do not run).
- **The options** (M3: two runs each, interleaved, at loads of 43 to 65 at the lock, lower than T2's), the capture
  project as in D in each:

  | rest | outside R, timeouts / others | wall s | peak GiB | parked-copy-editor-mount ms |
  |---|---|---|---|---|
  | D, one Firefox, 12 tabs | 6 / 2, 0 / 2 | 252, 214 | 8.09, 7.32 | 1,344, 1,522 |
  | S3, three Firefoxes of 4 | 0 / 0, 0 / 0 | 134, 138 | 9.06, 8.54 | 1,295, 995 |
  | S4, four of 3 | 0 / 0, 0 / 0 | 147, 139 | 9.19, 9.08 | 4,176, 3,776 |
  | R6, one Firefox, 6 tabs | 0 / 1, 0 / 0 | 229, 198 | 5.30, 5.25 | 6,422, 4,702 |

  R6's one, in `m3-r6-1`, is view-keys' "a key held down > lets a key held since before the prefix repeat into the
  editor, and stays armed", in the capture project; it passed alone (`m3-r6-1-alone-1`, `outside-r.md`). Over
  whole runs the busiest Firefox parent's main thread ran 36% and waited 20% in D's rest (`m3-d-1`), 24% and 19% in
  S3's busiest (`m3-s3-1`; `schedsample.sh`).
- **Unmeasured:** R6's parent thread share; R6 at T2's loads; why the case ran longer under R6 and S4 than under D
  and S3 in M3. §6.3's runs at the head test R6 (§2, R6).

## §4 Design

### §4.1 Two Firefox projects

- **Where.** `web/vite.config.ts`'s `FIREFOX` branch, which at `ec4f11a` adds one project,
  `browserProject('firefox', 'firefox', playwright(), { requestGC })`, adds two, both built by `browserProject`:
  - `firefox`, the rest: `include` adds `tests/firefox/**/*.test.ts` (§4.4), `exclude` adds the capture list, and
    its tab count is 6 (§2, R6), from `test:firefox`'s environment (below).
  - `firefox-capture`: `include` is the capture list, and `browser.fileParallelism` is `false`.
- **Measured constraints, each met by the shape.** Each call passes its own `playwright()`, and `browserProject` builds
  `instances: [{ browser }]` afresh on each call (M2's constraint 4). Neither sets `sequence.groupOrder`, so both are in
  the default group and run at the same time (constraint 2). The capture project sets `browser.fileParallelism`, not
  `maxWorkers` and not the top-level `fileParallelism` (constraint 3): Vitest 4.1.12's own declaration of the top-level
  option says `false` "will override `maxWorkers` option to `1`", the setting under which `d-probe-2` ran the project
  after the rest.
- **A deprecated option.** The same declarations mark `browser.fileParallelism` `@deprecated` ("use top-level
  `fileParallelism` instead"). It is the option the user ruled and the one measured, and it stays (§2, decision 2).
  §4.10's check fails the run when the option stops holding the capture project to one file at a time, at a vitest
  bump or after any other change, so no re-check by hand is needed.
- **`browserProject`'s signature** gains a fifth parameter, an options object of the shape
  `{ include?: string[]; exclude?: string[]; fileParallelism?: boolean; pointerCaptureRefused?: boolean }`. Its
  `exclude` adds to the shared one; its `include`, when given, replaces the shared one, since an `include` that added
  could not confine `firefox-capture` to the list: the rest passes the shared glob and `tests/firefox/**/*.test.ts`,
  and the capture project the list (the plan's probes, `$R/logs/pr2-plan-probes/`). The `commands` parameter's type widens from `Record<string, BrowserCommand<[]>>` to take commands
  with arguments. `browser`, Chromium's, passes no options and is built as today.
- **Names and the script.** `firefox-capture` prints as `firefox-capture (firefox)`. A `--project` filter matches a
  name exactly, so `--project browser` selects Chromium alone, as PR 1's P4 measured beside `browser-firefox`.
  `test:firefox` becomes `REDEXTAPE_FIREFOX=1 VITEST_MAX_WORKERS=${VITEST_MAX_WORKERS:-6} vitest run --project
  firefox --project firefox-capture`: the form M2's runs used (`run2.sh` names `--project firefox`, and the D runs
  added `--project firefox-cap`), with the rest's tab count (below). With `REDEXTAPE_FIREFOX` unset, either filter
  fails with "No projects matched".
- **The rest's 6 tabs (R6), from the script's environment.** Vitest 4.1.12 reads `VITEST_MAX_WORKERS` into every
  project's `maxWorkers` (`resolveConfig$1`), so both Firefox projects get one value and share the default group
  (§3.2: two values in one group are refused at startup). `firefox` opens that many tabs; `firefox-capture` opens one
  whatever the value, since `getThreadsCount` gives a project whose `browser.fileParallelism` is false 1. A
  `VITEST_MAX_WORKERS` given to the script wins over the 6, which the alone rule's one-tab runs and §6.3's run at 3
  need. `test:browser` does not change, so Chromium keeps its count. A `maxWorkers: 6` on the two projects also
  gives the rest 6 (`r6a-filtered`), and would hold for a direct `vitest` call, but it is a larger change, and an
  unfiltered run with `REDEXTAPE_FIREFOX` set then refuses to start: "Projects "browser (chromium)" and "firefox
  (firefox)" have different 'maxWorkers' but same 'sequence.groupOrder'" (`r6a-unfiltered`). Probed at `d08803e` with
  an untracked config of the two projects and the script line in place (`$R/tasks/pr2/r6-update.md`,
  `$R/logs/pr2-r6/`), on 16 rest files and 3 capture files, each project's peak in flight from the JSON's file times:
  HEAD's script, the rest 12 and the capture project 1, side by side (`r6-base-12`); the planned line, 6 and 1 side
  by side (`r6-default`); with `VITEST_MAX_WORKERS=3`, 3 and 1 (`r6-tabs3`); with `1`, 1 and 1, still side by side,
  so a full run in one tab has a page in each Firefox (`r6-tabs1`); Chromium's `test:browser` on the 16 files, 12
  (`r6-chromium`).
- **Setup files.** Every browser project's list becomes `collect.ts`, then the new `firefox-input.ts` (§4.3, §4.5,
  §4.10), then `setup.ts`. `firefox-input.ts` installs nothing in Chromium, no wrapper, hook or command call (it reads
  `CHROMIUM`, as `collect.ts` does), so the projects keep one list, PR 1's reason for `browserProject` (PR 1 spec
  §3.1), and Chromium pages install none of it. Second, not last: it wraps its prototypes before any module of `src`
  is evaluated, and `setup.ts` imports `src`. It imports nothing of `src`, since a module's imports are evaluated
  before its body, so an import of `src` here would evaluate `src` before the wrapping.
- **`provide`.** A new key, `pointerCaptureRefused: boolean`, true in `firefox` alone, declared in
  `tests/browser/provided-context.d.ts`'s `ProvidedContext` beside `coverageOn`.
- **Commands.** Both Firefox projects register `requestGC`, as today, §4.4's two commands and §4.10's one, typed in
  `engine.ts`'s `BrowserCommands` block beside `requestGC`.

### §4.2 The capture list

- **One list, in the config.** `CAPTURE_FILES`, paths relative to `web/`, kept beside `PROBE_FILES` (the precedent
  for a file list in the config): the 8 capture files, D's 7 and `step-focus-recording.test.ts` (§3.7), which the
  user added (§2, decision 1) and §6.2's instrument run confirms; and `tests/firefox/two-browsers.test.ts` (§4.4),
  which takes a real capture itself. Its doc says what puts a file on it, a pointer capture that holds taken through
  real input (in the 8, a press on a separator), and that the guard fails a file that should be on it.
- **Not a marker in each test file.** Vitest assigns files to projects by `include` and `exclude` globs, resolved in
  node before any file is read, so a marker would need the config to read every test file's text at startup to build
  those globs. The guard fails a missing entry in either form, so a marker would add no check.
- **Kept true in both directions:**
  - A file that captures and is not listed: the guard fails it (§4.3).
  - A listed path that no longer exists: a new node test reads the list and fails on each path that is not a file.
    A renamed file then runs in the rest, where the guard fails it if it captures.
  - A listed file that no longer captures: not checked (§8). It costs only that it runs one at a time in the capture
    project, whose 7 files in M2 spanned 72 to 92 s against the rest's 174 to 378 s, so it does not lengthen the run
    until the capture project's span passes the rest's.

### §4.3 The capture guard

- **Where.** `tests/browser/firefox-input.ts`, active in Firefox only. It wraps the frame's
  `Element.prototype.setPointerCapture`. After the original call returns, if `this.hasPointerCapture(pointerId)` is
  true it records the capture for the current case, with `window.event?.isTrusted` and the element's tag and first
  class, as `capture-diag.ts` did.
- **What fails.** Where `inject('pointerCaptureRefused')` is true, an `afterEach` throws when the case recorded a
  capture, naming the file, the element and the remedy (add the file to `CAPTURE_FILES`), so that the case fails. An
  `afterAll` does the same for a capture taken in a file's hooks, which fails the file. In `firefox-capture` the guard
  records and does not fail.
- **The condition is a capture that holds,** whatever its `isTrusted` (§8). A capture that holds is what takes the
  other tabs' input (§3.1). Every real press on a separator held its capture and no synthetic one did, in both
  measurements (§3.1), so on today's tier "holds" and "real" pick the same captures. Keyed on "holds", the guard does
  not depend on `window.event` being set at the call, and it also fails a synthetic capture that came to hold.
- **What it exports, for its self-test:** the current case's records, and the function that builds the failure
  message from records and a file name, which the `afterEach` calls. The records live on the frame's `window`, and
  only the module's first instance in a page wraps and registers: a test file's import of the module evaluates an
  instance of its own beside the setup file's, which in the plan's probe registered the span hooks twice
  (`pA2-span.log`).
- **Not blind.** (1) Every Firefox run: `two-browsers.test.ts`'s case asserts that the guard recorded its own real
  press's capture as held and trusted, and that the message function names the file and that record's element (§4.4).
  (2) S1 (§6.5): view-keys taken off the list makes the rest project's `afterEach` fail its hint case, which also
  shows the guard's own file name. (3) S2: a wrapper that reads `hasPointerCapture` before the original call fails the
  self-test. (4) S10: a file of the rest whose `beforeAll` takes a real capture fails at the guard's `afterAll`.
- **A known limit.** Under Vitest's `'stack'` hook order a file's own `afterEach` and `afterAll` run before the
  setup file's, and one that throws ends the list, so the guard's arm for that case or file does not run and its
  message is lost. The case or file fails on its own error regardless, so no capture passes unseen in a green run.
- **Three Vitest defaults it relies on,** named in the code: `sequence.hooks: 'stack'`, so its `after*` hooks run
  after the file's own; a page per file (`isolate`), since only a page's first instance installs them; and cases one
  at a time, since a page keeps one case's records. Nothing in `web/tests` or the config sets `concurrent`.

### §4.4 The two-browsers invariant

- **A directory for the Firefox projects alone,** `web/tests/firefox/`. Both Firefox projects include it and
  `browser` does not, so Chromium's `include` stays `tests/browser/**/*.test.ts`, and no gate for "Firefox only" is
  needed. `tsconfig.json`'s and Biome's scopes already cover `tests/`.
- **`tests/firefox/two-browsers.test.ts`,** on the capture list, is M2's decoy probe (`cross-cap.test.ts` with
  `cross-rest.test.ts`) made a test:
  - **Registration.** `firefox-input.ts` calls a command, `registerBrowser`, once per file in both Firefox projects.
    In the config's node process it stores `ctx.page.context().browser()` under `ctx.project.name`, which Vitest
    gives as `firefox (firefox)` and `firefox-capture (firefox)`, so the rest's browser is the one registered under
    the name that is not the caller's.
  - **The press.** A command of the shape `decoyDuringCapture(selector: string, browserOf: 'own' | 'rest') →
    { decoyClicks: number; decoyAlone: number }`, after M2's `pr2Drag2`: through `ctx.page.mouse`, a press at the
    middle of `selector` in the test frame, a click on a counting button in a page of a new context of the named
    project's browser, a move of 80 px in 5 steps, the release, and then the decoy alone. It closes the decoy's context.
  - **The case**, on a 12 px handle whose `pointerdown` captures: the guard recorded a held, trusted capture (§4.3);
    with the decoy in its own browser, `decoyClicks` is 0 and `decoyAlone` 1, the precondition that the instrument
    sees a theft; with the decoy in the rest's browser, `decoyClicks` is 1 and the handle heard all 6 moves, as in §3.2's table; and the
    two projects' registered browsers are distinct objects.
  - **Waits.** In a full run both projects' first files start together (`d-probe-3`: both at 00:24:33), so the case
    waits with `until`, at its default, for the `firefox` project's entry, the one not its own. Run alone, it fails on that precondition,
    with a message to name a file of the rest project too. The probe's 300 ms sleeps go: the decoy counts are read in
    node after Playwright's click resolves, and the handle's count once `until` has seen its release.
- **What it holds.** The premise of the split, which vitest does not document. It does not hold that the projects run
  at the same time, which §6.3's C4 measures, nor that the capture project runs one file at a time, which §4.10's
  check holds.

### §4.5 The frame-focus step

- **What.** In `firefox-input.ts`, active in both Firefox projects, M2's `focus-fix.ts` without its log line and
  without its arming: it wraps the frame's `HTMLElement.prototype.focus` and `SVGElement.prototype.focus`, and each
  call made while `document.hasFocus()` is false calls `window.focus()` first. Then the original runs. It keeps no
  state per case, so a file's hooks and a case's later calls are covered as its first is.
- **A setup file, not the harness.** A programmatic `focus()` is often the app's own (`EditorView.focus()`, a view's
  focus handoff), which no harness call precedes, so only a wrapper in the page sees every one. The wrapper must be
  in place before `src` evaluates (§4.1).
- **Firefox only**, so Chromium runs as today (A5). It acts on every `focus()` made while the frame lacks the focus,
  not only a case's first, as ruled (§2, decision 4), and on no other call; the module's one other move of the
  focus is §4.6's setup call, at the file's start. A key press made while the frame's
  `activeElement` is its body is already focused by vitest's `keyboard` (§3.4); one made after the frame lost the
  focus from an element is not, since the frame keeps that `activeElement`.
- **Its self-test,** `tests/firefox/frame-focus.test.ts`, in the rest, two cases, after a first that holds §4.6's
  setup call (`document.hasFocus()` true at the file's start, S11). The first of the two moves the focus to the
  top document through an element of the top document, whose `focus` is the top realm's and is not wrapped, and
  asserts the precondition, `document.hasFocus()` false. It then calls `focus()` on a button of the frame and asserts
  that the button is `document.activeElement` and that `document.hasFocus()` is true. The second gives the frame the
  focus (`window.focus()`) and calls `focus()` on a button, a first call that needs no step, then moves the focus to
  the top document as the first case does, asserts the same precondition, and calls `focus()` on a second button,
  with the same two assertions: the later call that decision 4 adds. Each removes the elements it made, the one in
  the top document among them: the tab's later files share that document, while each file runs in a frame of its own
  (Vitest's orchestrator removes the iframes before it builds the next), so the frame's focus needs no restoring. M1's
  probe measured the half without the step (§3.4's mechanism).
- **Shown to fire** by S3 and S9 (§6.5).

### §4.6 The focus failures M2's step did not reach

- **Scope.** The five of §3.4's table (the ruling's "other 4", and live-views-bound-switch's case, which M2's count
  left out); every focus-kind failure of §6.4's full one-tab run at the head; and the extend-focus-probe leak.
- **The instrument**, untracked, in the record, after `focus-observe.ts`: per case, every programmatic `focus()`
  (not only the first), whether the frame had the focus before and after it, whether the step fired on it, and what
  `document.activeElement` became; `focusin` and `focusout` on the frame's document; and the file that ran before in
  the tab, which `collect.ts`'s `__redextapeFiles` list on `window.top` names. **Its precondition first**, as
  `focus-probe.test.ts`'s instrument case: a move of the focus to the top document must read `document.hasFocus()`
  false and be heard as a `focusout`. M1 found the frame window's `blur` counter blind, so the instrument counts no
  `blur`.
- **Runs.** M2's 16-file run in one tab with the step, twice; each of the five alone in one tab, the whole file for
  the chained ones (live-views-bound-switch, view-toggles); and each after the file that ran before it in a failing
  run. For the leak, extend-focus-probe and then step-focus-recording in one tab of one project, with the step, under
  an untracked probe config: under §4.2's list, step-focus-recording runs in the other project, so the pair no longer
  shares a tab, but the mechanism remains for files that do.
- **The questions, in order:** (a) does a later `focus()` in the case find the frame without the focus, which the
  step now meets (§4.5), and does the case then pass; (b) does the file before leave the focus outside the frame;
  (c) is it an engine difference in focus.
- **The outcome.** A cause that is the frame's focus is fixed in PR 2. An engine difference in focus is recorded in
  PR 2, in the roadmap entry with its evidence, and fixed in PR 3 (§2, decision 3). A product bug goes to the user
  with its evidence, since PR 2 changes nothing in `web/src` (A3).
- **Its fix, the setup call** (the plan's Task 9, `66ff467`). `firefox-input.ts` calls `window.focus()` once, when
  the module is evaluated, in both Firefox projects, from the page's first instance only, before `setup.ts` imports
  `src`. After a file whose frame ended focused, the first focus a real click or a popover's `autofocus` moves into
  the next frame reaches its window and no element, and §4.5's step cannot meet it, since no `focus()` is called.
  `frame-focus.test.ts`'s first case holds the call (S11): without it the frame reaches the file's first case
  unfocused. That case runs in `firefox` alone, the file not being on the capture list, and it holds the call, not
  its sufficiency for the click and `autofocus` focus after a focused file, which F1 to F3 hold. The step stays (§2,
  decision 4): the focus can leave the frame mid-file, and a `focus()` is then ignored again.

### §4.7 PR 1's "For PR 2" list, placed

| PR 1's item | placed | why |
|---|---|---|
| Firefox's tab count or file parallelism | PR 2, §4.1 | the rulings, D and R6 (the rest at 6 tabs) |
| T3's 37 cases | PR 2, §6.3 C7 | in D's runs none failed beyond one tab (§3.2) |
| The one-tab split | PR 2, §6.2 | it becomes the one-tab set, taken again at `ec4f11a` |
| Run 1's two lost `beforeAll` clicks | PR 2, §6.3 C3 | cause 1 (M1 Q3); D's runs skipped the floor |
| The base's 16 drags and 27 contention tests | PR 2, §6.3 C1 and C2 | D: no drag-kind failure beyond one tab |
| `document.hasFocus()` false at every file's start | PR 2, §4.6's setup call | the frame's start state (§3.4); the frame is given the focus at each file's start, which `frame-focus.test.ts`'s first case holds |
| The two `view.hasFocus` waits, storage-blocked and view-keys-focus | PR 2, §4.6 | both fail in one tab; storage-blocked passed in both 16-file runs and failed in `tabs1-1` and `d-split-2` |
| Memory at the slower runner's 3 tabs | PR 2, §6.3 C6 | D at 3 + 1: 3.78 GiB |
| Whether real Firefox input is dependable | answered here, for U2 | it is in a browser where no other page holds a capture (§3.1, §3.2). U2's held presses over `page.mouse` hold a capture across commands, so a file that uses them belongs on the capture list, and the guard fails it until it is |
| T3's alone rule in a chained file | PR 2, §6.2 | decision 8 |
| The popover asserts with no wait | left as they are | every measured failure came under one shared Firefox, 3 in `default-1`, or in E2, and none in D (§3.6). If one fails in §6.3's runs it takes the alone rule, and the plan probes whether the menu opened late before changing the assert |
| Focus failures in one tab | PR 2, §4.5 and §4.6 | cause 2; an engine difference among them is recorded in PR 2 and fixed in PR 3 |
| panel-boundaries' "skip a closed region, …" | closed by D | its file is on the list, and no run of §3.6 failed it |
| The timeout invariant's scope | PR 2, §4.8 | PR 1 placed it with PR 2, which works on the waits |
| The `extend-focus-probe` leak | PR 2, §4.6 | a second victim of cause 2's class at one tab |

### §4.8 The timeout invariant's scope

`tests/node/browser-timeout-invariants.test.ts`'s `testFilesUnder` collects `.test.ts` files only, so nothing but
reading holds the 9 other modules under `tests/browser/` that call `until` to its default: build-reply-fixture,
editor-view-fixture, engine, format-on-leave-fixture, harness, lambda-deep, lambda-text, share-open-hashchange-fixture
and user-event-fixture (`grep -rl` at `ec4f11a`, `until.ts` aside). PR 2 widens the scan to every `.ts` module under
`tests/browser/` and `tests/firefox/`. S5 shows the widening is what catches a numeric timeout there.

### §4.9 The view-keys caret test is PR 4's

The caret class, not contention (§3.5): it is in the base's cluster B by its first error, failed in each base run and
the base's one-tab re-run, failed in D where view-keys has a Firefox to itself, and passed in one run of 14. It is in
the one-tab set (§6.2), so PR 2's checks do not count it.

### §4.10 The one-at-a-time check

The user's decision 2 (§2): a permanent check that fails if two capture-project files ever run at the same time, so
that `browser.fileParallelism: false` is held by a check, not by a re-measurement at each vitest bump.

- **What it observes.** Each capture-project file's span, from before its first hook to after its last. In
  `firefox-input.ts`, where `inject('pointerCaptureRefused')` is false in Firefox, that is in `firefox-capture`, an
  `aroundAll` calls a command, `captureFileSpan('begin')`, runs the file, and calls `captureFileSpan('end')` in a
  `finally`. A setup file's `aroundAll` is the outermost of the file's: it begins before the file's own `beforeAll`
  and ends after its own `afterAll`, whatever those threw.
- **Not an `afterAll`.** Under Vitest's `'stack'` order a file's own top-level `afterAll` runs before a setup file's,
  and one that throws or times out ends the list (Vitest 4.1.12's `callSuiteHook` stops at the first throw). An
  `afterAll` there would leave the file in the set, and every later capture-project file would fail "began while"
  for an overlap that never happened. The plan's fix-round probe (`$R/logs/pr2-planfix/`), six capture files in a
  fixed order: with the `afterAll`, the files whose own `afterAll` threw or timed out never sent `'end'`, and each of
  the 5 files after the first of them failed "began while" (`pf-afterall`); with the `aroundAll`, every span began and
  ended, the three files whose own hooks failed failed on their own errors, and the three after them passed
  (`pf-around`).
- **The store.** In the config's node process, beside `registerBrowser`'s store, the command keeps the set of
  capture-project files in flight, each named by the command context's `testPath` (`string | undefined` in Vitest
  4.1.12's `BrowserCommandContext`): `'begin'` adds the calling file and replies with the set, and `'end'` removes it.
  The rest does not call it, since its files run together by design.
- **What fails.** The `aroundAll` throws before it runs the file when the reply names a file other than its own, with
  a message naming both files and the option that should keep them apart, so that the file fails, its cases are
  skipped, and `pnpm test:firefox` exits non-zero; its `finally` still sends `'end'`. Of two files that overlap, the
  later to begin finds the earlier in the set, so every overlap fails a file.
- **Its precondition.** The reply must name the calling file. A reply without it, from an undefined `testPath` or a
  store that records nothing, fails the file too, so the check cannot pass by seeing nothing.
- **Every capture file, not a test file of its own.** One test file would see only the overlaps of its own span; the
  `aroundAll` of every capture-project file sees each overlap at the later file's start.
- **What it does not hold.** That the two projects run at the same time, which C4 measures (§6.3).
- **Shown to fire** by S8 (§6.5): `firefox-capture`'s `browser.fileParallelism` set to `true`.

## §5 What PR 2 changes

- `web/vite.config.ts`: `CAPTURE_FILES`, `browserProject`'s options, the two Firefox projects, the `provide` key, the
  setup list, §4.4's commands and §4.10's (§4.1, §4.2, §4.10).
- `web/package.json`: `test:firefox` names both Firefox projects and gives the rest 6 tabs unless
  `VITEST_MAX_WORKERS` is set (§4.1).
- New: `web/tests/browser/firefox-input.ts` (§4.3, §4.5, §4.10), `web/tests/firefox/two-browsers.test.ts` (§4.4) and
  `web/tests/firefox/frame-focus.test.ts` (§4.5, §4.6).
- `web/tests/browser/provided-context.d.ts` and `engine.ts`'s `BrowserCommands` block: the new key and commands.
- `web/tests/node/`: the list's check (§4.2), and `browser-timeout-invariants.test.ts`'s scope (§4.8).
- What §4.6 fixes, in `web/tests` alone (A3): the setup call in `firefox-input.ts`.
- `README.md`'s Checks section: `pnpm test:firefox` runs two Firefox projects, the rest at 6 tabs, why the capture
  list exists and why the rest's count is 6, and what to do when the guard fails a file.
- A roadmap entry in `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` before the PR opens, every figure with
  its command, holding each engine difference in focus that §4.6 finds, with its evidence, for PR 3, and the cause of
  each failure outside R that passed alone, parked-copy-editor-mount's in `d-split-2` among them (cause 3, §3.8, and
  R6), and §6.3's figures for Task 2's 32 cases (§6.2).
- Comments obey the comment guard (`node scripts/check-comments.mjs`): a reason, no history, no measurement, no block
  over 8 lines, `collect.ts`'s doc block not grown.

## §6 What PR 2 proves

Every Firefox run goes through the record's run script under the conditions of `$R/scripts/pr2/run2.sh`: both locks,
the heavy one outside, a 16 GiB scope with no swap, `--reporter=verbose --reporter=json`, the 1-minute load at the lock
and the exit, and with `SAMPLE=1` the memory samples. Runs are read with `analyse2.py`, `beyond.py`, `peaks.py` and
`diag.py`.

### §6.1 Chromium and the coverage gate, as they are today

- `pnpm run test:browser`: the files and tests of §6.2's base, all passed, `numPendingTests` 0, no `Errors` line.
- `pnpm run test:coverage` at `ec4f11a` and at the head: exit 0, the same four figures, and no `thresholds` line in
  `git diff ec4f11a -- web/vite.config.ts`.
- `pnpm test` prints only the `|node|` and `|browser (chromium)|` tags.
- With `REDEXTAPE_FIREFOX` unset, `--project firefox` and `--project firefox-capture` each fail with "No projects
  matched"; with it set, `pnpm run test:coverage` stops at startup on coverage-v8's error, and `pnpm test:firefox
  --coverage`, both projects with the rest at 6, exits 1 on coverage-v8's error in each file, its tests running and
  the JSON report written (the plan's fix round B, `frb-coverage`: 432 errors over 216 files). Under `--coverage` a
  file loses its last results: of the 1,598 tests, 111 have no result (`pending`) in `frb-coverage`, and 219 and 251
  in the plan's Task 10 (`t10-coverage`, `t10-coverage-2`), frame-focus's three among them in both. So this check
  does not hold F4, which §6.4 judges on §6.3's full runs, and its C1 sees only the cases with a result. Its failures
  outside R still take §6.2's rule and block (§2, decision 5, "Yes, they block too").
- `git diff --stat ec4f11a -- .forgejo` is empty; under `scripts` only `comment-budget.json` may differ.

### §6.2 The base and the one-tab set

- **The base, at `ec4f11a`, before PR 2's first commit:** one full Firefox run in one tab
  (`VITEST_MAX_WORKERS=1 pnpm test:firefox`, one project at the base) and two at the default tab count, recording
  files, tests, failures, skips (21 expected, §3.7), wall time and memory; and the capture instrument of §3.3's step 2
  over the tier in A's mode, under the untracked probe config, to confirm §4.2's 8 capture files (§2, decision 1):
  each takes a real capture that holds, step-focus-recording among them, and no other file does. A difference either
  way goes to the user before PR 2's first commit.
- **The one-tab set, R:** the failures of `tabs1-1`, of `focusobs-1` and of that base run, by file and test name. The
  first two give 122 tests (this spec; `focusfix-2`'s failures are a subset of `focusobs-1`'s, so it adds none). A
  file that fails as a whole, on an error outside every case (its import, its own hooks, a top-level throw), has no
  test row, so R holds such files by file: in those three runs, share-open-deep's `InternalError: too much
  recursion` alone, PR 1's "fixture depth" for PR 3 (the plan's fix round, `$R/logs/pr2-planfix/targets-new.out`).
  **R also holds, until PR 4, a view-keys failure by its shape:** a failure in `view-keys.test.ts` whose first error
  shows the caret at offset 0, not where it was: keys typed there, the editor's text read as the typed keys followed
  by the text before them, where that text with the keys at the caret was expected (`expected 'xxxlet x = 40;\nx + 2'
  to be 'let x = 40;\nx xxx+ 2'`), or the caret read there ("the caret is not where it was: expected +0 to be 14"). A
  vim deletion at offset 0 is not that shape. It is the caret class's shape (§3.5, §4.9), PR 4's. Two cases none of
  the three runs holds failed with keys typed at offset 0, each passing alone: "a key held down > lets a key held
  since before the prefix repeat into the editor, and stays armed" and "ends on a key it does not know, …". The user
  ruled the shape in R until PR 4 (2026-11-04, "The shape, until PR 4"), so C1 does not count such a failure; a
  view-keys failure of any other shape counts. That the shape takes in the caret read is the controller's reading of
  the ruling as the record words it, "that caret-at-offset-0 shape"; over the 362 runs of `$R/logs/pr2` and
  `$R/logs/pr2-r6` it moves no failure, since every view-keys caret read there is a case the three runs hold
  (`$R/logs/pr2-t11/allruns-compare.log`). `targets.py`'s `R_BY_SHAPE` holds the rule beside `$RSET`, with that
  reason.
- **The alone rule,** PR 1's T3 with decision 8, for a failure outside R, a test or a whole file, in any run made
  during PR 2 (§2, decision 5, "Yes, every run"): the plan's mid-branch runs as well as the head's. It is run alone
  in one tab at the commit it was seen at (`VITEST_MAX_WORKERS=1 pnpm test:firefox <file>`, with `-t` for the case).
  In a chained file (§3.6), and for a whole-file failure, the whole file is run, so a case runs with the cases before
  it. If it fails alone, it is PR 2's regression and blocks the PR. If it passes alone, it blocks the PR too, until a
  cause-finding like parked-copy-editor-mount's names its cause; the cause, with its evidence and the failure's first
  error, goes in the roadmap entry and to the user before the PR opens. Two kinds of run are outside the rule: the
  base's, at `ec4f11a` in one shared Firefox, whose failures outside R are cause 1's (M1) and are what D removes; and
  a sabotage's (§6.5), whose failures are made on purpose.
- **Task 2's failures outside R that passed alone** (32 distinct cases in `$R/tasks/pr2/outside-r.md`, from T2's D
  runs at the default tab count): their class cause is cause 3 (§3.8), which R6 answers (§2), so they get no
  cause-finding each. §6.3's runs at the head, under R6, test it: a case of the 32 that fails in one of them is a
  failure outside R of that run, and its cause-finding is its own, as the rule above says. Every other failure on the
  record takes the rule above as it stands.
- **parked-copy-editor-mount's failure in `d-split-2`** ("… has an editor when it comes back", `locator.click:
  Timeout 680ms`, at `1b2f0cb`, §3.2) blocked PR 2 until its cause was found, as ruled ("Blocks now", §2, decision 5).
  T2 found it, cause 3 (§3.8), and the user answered it with R6 (§2). It goes in the roadmap entry with its evidence,
  as the alone rule's causes do.

### §6.3 Cause 1, the targets

Two full runs as `pnpm test:firefox` makes them, the rest at 6 tabs (6 + 1), and one at `VITEST_MAX_WORKERS=3`
(3 + 1), at the head:

- **C1.** Failures outside R, tests and whole files alike: 0 in each run. D at `1b2f0cb`, against the one-tab union:
  0, 1 and 0 (§3.2). A failure outside R blocks the PR whether it fails or passes alone (§6.2), in these runs and in
  any other run made during PR 2 (§2, decision 5, "Yes, every run"). M3's R6 at `d08803e`: 1 and 0, the 1 in the
  capture project. These runs are also R6's test of cause 3 for Task 2's 32 cases (§6.2).
- **C2.** Drag-kind failures outside R (`beyond.py`'s kinds): 0.
- **C3.** Skipped: the base's floor in each run, so no `beforeAll` lost a click.
- **C4.** The projects run together, in `targets.py`'s exit status: `firefox-capture` with 1 file in flight and its
  span, its start and its end, inside the rest's, and the rest with 6 files in flight (3 in the run at 3).
- **C5.** Wall time, the lock to the exit, as accepted (§2, decision 6) and read for R6: at most 300 s with the rest
  at 6 (R6 in M3: 229 and 198; D at 12 + 1 in M2: 177 and 214) and 450 s at 3 (D: 379; one shared Firefox: 426). A
  run that misses it with a 1-minute load above 80 at its start is repeated before it counts.
- **C6.** Memory, the scope's peak, as accepted (§2, decision 6) and read for R6: at most 8 GiB with the rest at 6
  (R6 in M3: 5.30 and 5.25; D at 12 + 1 in M2: 7.40 and 7.45; A: 10.85) and 4.5 GiB at 3 (D: 3.78; A: 4.14).
- **C7.** Each of T3's 37 cases passes or is in R.
- **C8.** No failure in the rest carries the guard's message in any of its errors: the list is complete at the head.
- **C9.** No capture-project file fails §4.10's check, in any of its errors: the capture project ran one file at a
  time.

### §6.4 Cause 2, the targets

- **F1.** M2's 16-file run in one tab at the head: 0 focus-kind failures, about-menu's case read by name, since
  `FOCUS` matches only its `<body>` shape (§3.4: 9 without M2's step and 4 with it, about-menu's case apart),
  but for each that §4.6 records as an engine difference for PR 3, named with its evidence (§2, decision 3).
- **F2.** A full run in one tab at the head: each focus-kind failure listed with §4.6's finding, and none that §4.6
  finds to be the frame's focus.
- **F3.** §4.6's leak run: step-focus-recording's "⏭ at a `budget` stop hands the focus to ▶, …" passes 3 of 3 after
  extend-focus-probe, in a run whose log shows that order.
- **F4.** Every case of `frame-focus.test.ts` and `two-browsers.test.ts` passes in every Firefox run of §6.3, the
  first of `frame-focus.test.ts` holding §4.6's setup call.

### §6.5 Sabotages

Each runs in the scratch worktree `$S`, never the served checkout: the file is saved to `$R/sab/` first, restored from
that copy after, and checked with `cmp` against the copy and against `git -C $S show HEAD:<path>`. The outcome named
is the expected one; a sabotage that does not fire as named is a finding, reported before the PR opens.

- **S1, the guard fails a case.** view-keys is taken off `CAPTURE_FILES`. `pnpm test:firefox
  tests/browser/view-keys.test.ts` runs it in `firefox`, where "lets a pointer press at the hint through to what is
  under it" fails with the guard's message.
- **S2, a blind recorder.** The wrapper reads `hasPointerCapture` before calling the original. `two-browsers.test.ts`
  fails at its assertion that the guard recorded the capture, and S1's command then passes the hint case.
- **S3, the step.** `window.focus()` is removed from the step. Both of `frame-focus.test.ts`'s step cases fail at their
  `activeElement` assertions, and M2's 16-file run in one tab fails three of the five tests M2's step cleared (§3.4),
  the three that failed in every 16-file run without a step that ran them: view-keys-focus's "stays on the toggle the
  keys leave as the only one pressed, …" (4 of 4), lsp-hover's "opens on F2, closes on the next caret move, and leaves
  pointer hover working" (4 of 4) and state-diagram-no-machine's "hands the focus to the local level itself when a
  compile empties i…" (3 of 3). The other two, view-keys' "arms on the prefix from the source editor, …" and
  vim-keymap's "mounts in vim because storage said so, …", also passed without a step in other one-tab runs
  (`focusfix-base-1` and `focusfiles-1tab-cpu100`; `tabs1-1`), so S3's run records them either way. **Since §4.6's
  fix, the setup file's `window.focus()` at each file's start, the 16-file half no longer fires** (the plan's Task 9,
  `t9-s3-16`: with the step removed the three pass, C1 0): the frame has the focus before a file's first `focus()`.
  S3 is then `frame-focus.test.ts`'s two step cases, which move the focus to the top document themselves, and S9
  holds the step's reach past a case's first call. The file's first case, the setup call's, passes under S3 and S9
  (the plan's fix round B, `frb-s3`, `frb-s9`).
- **S4, one browser seen as two.** `decoyDuringCapture`'s `'rest'` takes the case's own browser. `two-browsers.test.ts`
  fails where the rest's decoy should count 1 and counts 0.
- **S5, the timeout scope.** `engine.ts`'s `until` call passes a numeric timeout. The widened invariant fails and names
  `engine.ts`; with the scan as at `ec4f11a`, the same edit passes.
- **S6, the registration.** `firefox-input.ts` skips `registerBrowser`. `two-browsers.test.ts` fails on its
  precondition that the rest's browser registered.
- **S7, the list's check.** A listed path is misspelt. The node test fails and names it.
- **S8, the one-at-a-time check.** `firefox-capture`'s `browser.fileParallelism` is set to `true`. A full
  `pnpm test:firefox` run, the rest at 6 tabs, exits non-zero, and capture-project files fail with §4.10's
  message, each naming another capture-project file in flight.
- **S9, the step past the first call.** The step acts on a case's first `focus()` only, as M2's `focus-fix.ts` did:
  armed when the module loads and in a `beforeEach`, disarmed by its first call. `frame-focus.test.ts`'s later-call case
  fails at its `activeElement` assertion, and its other two cases pass.
- **S10, the guard's hook arm.** No tracked file changes: an untracked file of the rest, in `tests/firefox/`, whose
  `beforeAll` appends a capturing handle and presses it through `decoyDuringCapture`, with a case that asserts the
  handle got the capture. The case passes, and the file fails at the guard's `afterAll` with its message (the plan's
  fix-round probe, `pf-hookcap`).
- **S11, the setup call.** `firefox-input.ts`'s `window.focus()` at the file's start is removed. `frame-focus.test.ts`'s
  first case fails at "the frame has the focus at the file's start" and its other two pass: alone in one tab, beside a
  file of the rest at the script's count, and in a full `pnpm test:firefox` run (the plan's fix round B,
  `frb-sa-ff-1tab`, `frb-sa-ff-pair`, `frb-sa-full`; in the full run that case is the run's only failure outside R).

### §6.6 The rest of the `web` job, locally

`pnpm exec biome ci --error-on-warnings`, `pnpm run typecheck`, `pnpm run build:app`, `../scripts/check-licences.sh`,
`node scripts/check-comments.mjs`, and the pre-commit hooks on every commit, never `--no-verify`.

## §7 Not in PR 2

- **PR 3, engine differences and tolerances:** PR 1's list for PR 3, including the menus' gutter (header-menus-narrow's
  9, §3.6), and each engine difference in focus that §4.6 finds, recorded in PR 2 with its evidence (§2, decision 3).
  §4.6 found two (the plan's Task 8, `$R/tasks/pr2/t8-focus.md`), each still failing with §4.6's fix in place (the
  plan's Task 9, `t9-16` and `t9-leak-1` to `-3`):
  - view-keys-focus's "goes to + view when the window is narrowed past 40rem, …": the `(max-width: 40rem)` media
    rule hides the views toggles, and Firefox blurs the focused toggle before it dispatches the media query's
    `change` event, on which `main.ts`'s `placeToggles` calls `handOff`, which then finds `<body>`; Chromium's order
    lets it see the toggle focused (`FFTRACE` in `t8-alone-view-keys-focus-none`: `focusout button.view-toggle
    rel=null`, then `media-change matches=1 … active=body`). It fails in every Firefox run of Task 8, alone
    included, and would be user-visible in Firefox if a top-level window's resize orders the two as the test
    frame's does (unmeasured): a narrowing with the focus on a toggle would leave it on `<body>`. Its fix is in
    `web/src` (A3).
  - extend-focus-probe's "hiding the focused continue button, or disabling a focused button, strands focus on
    body": Firefox keeps a just-hidden focused element as `activeElement` until a later style update, where Chromium
    answers `<body>` at once (`expected <button …(2)> to be <body>` right after `extend.hidden = true`, whose
    `focusout` comes later; all 7 of Task 8's leak runs). The file probes the engine; no app path is shown wrong.
- **PR 4, the caret bug:** cluster B, the view-keys caret test included (§4.9).
- **PR 5, CI:** PR 1's list for PR 5, and from this PR: the `web` job runs both Firefox projects; memory and wall time
  on the runners (D at 3 + 1 tabs measured here only, 3.78 GiB and 379 s; the rest at 6 on a runner, unmeasured);
  and Firefox as root, unmeasured. No re-check of `browser.fileParallelism` at a vitest bump is left to it: §4.10's
  check runs in every Firefox run.
- **U2's follow-up, after PR 5:** a file that holds a press across `page.mouse` commands joins the capture list.

## §8 Designer's calls

Open to the user's correction:

- The names `firefox-capture`, `CAPTURE_FILES`, `pointerCaptureRefused`, `tests/browser/firefox-input.ts` and
  `tests/firefox/`.
- The guard fails a capture that holds, real or synthetic, and records `isTrusted` for its message (§4.3).
- One setup file in every browser project's list, its body active in Firefox alone (§4.1).
- A list in the config, not a marker; no check that a listed file still captures (§4.2).
- `two-browsers.test.ts` is on the capture list, which then holds 9 files: the 8 capture files and it (§4.2).
- live-views-bound-switch's case is in §4.6's scope as one of the ruling's "other 4", whose count M2's join made one
  short (§3.4).
- The popover asserts stay as they are (§4.7).
- §4.10's check fails the later of two overlapping files from each capture-project file's `aroundAll`, rather than
  from a test file of its own, and keys on the command context's `testPath`.
- R6's 6 tabs set in `test:firefox`'s environment, `${VITEST_MAX_WORKERS:-6}`, rather than as a `maxWorkers` in the
  config (§4.1).

## §9 Left to the plan

- Where `CAPTURE_FILES` lives so that the config and the node test both import it.
- The polling form of §4.4's wait for the rest's registration: `until` takes a synchronous predicate (`until.ts`).
- The guard's and the self-tests' messages, within §4.3 and §4.4.
- Whether Biome and `tsc` accept the deprecated `browser.fileParallelism` without a warning, checked on the plan's
  pre-flight.
- The order of the tasks, one dispatch per task, with §6.2's base runs first.
- The `web/tests` comment budget, if the guard asks for a new one.
- §4.10's reply shape and message; that its span covers a file's own hooks under vitest's hook order; and that its
  `'end'` call runs when a file's own hooks fail, so that one failed file does not fail every later one.

## §10 The user's rulings (2026-11-04)

The answers to the six decisions this section asked at `08ec2b4`, also in §2 and written where each is specified:

1. The capture list at `ec4f11a`, "Add it": `step-focus-recording.test.ts` joins, 8 capture files (§4.2, §6.2).
2. The deprecated `browser.fileParallelism`, "Add a permanent check": it stays, held by §4.10's check (S8, C9).
3. An engine difference in focus found by §4.6, "PR 3": recorded in PR 2 with its evidence, fixed in PR 3 (§4.6, §7).
4. The step past a case's first `focus()`, "Yes, every one": each `focus()` while the frame lacks the focus (§4.5, S9).
5. A failure outside R that passes alone, "Blocks PR 2": until its cause is found (§6.2, C1). At the spec's review,
   "Blocks now": parked-copy-editor-mount's `d-split-2` failure blocks PR 2 until its cause is found, whether or not a
   head run repeats it (§6.2). On the plan's pre-flight, "Yes, every run": any run made during PR 2, the plan's
   mid-branch runs included (§6.2). On the Firefox coverage check, "Yes, they block too", and for fix round A's four
   rows, from direct `--project` calls, "Explained, don't block" (§6.1). For view-keys' failures in the caret class's
   shape (§4.9), the caret at offset 0, "The shape, until PR 4": in R until PR 4, a view-keys failure of any other
   shape still counting (§6.2). It replaced "Explained; add it to R by name", on the held-key case alone.
6. The C5 and C6 targets, "Accept": at most 300 s and 8 GiB at the default tab count, 450 s and 4.5 GiB at 3 (§6.3).
   Since R6, the first pair is read with the rest at 6 tabs.

After the plan's Task 2 stopped on cause 3 (§3.8), on M3's figures: **"R6: one Firefox, 6 tabs"**. The rest stays in
one Firefox at 6 tabs, set in `test:firefox`'s environment (§4.1); the capture project is unchanged. Task 2's 32
alone-passing cases take cause 3 as their cause, tested by §6.3's runs at the head, where a case that fails again gets
its own cause-finding (§6.2). Not chosen: S3, three Firefoxes for the rest (8.80 GiB, over C6); keeping D and lifting
ruling 5 for the class.
