# Plan 7, part 6a — examples, first load and share links — design

Part 6a of [Plan 7](2026-09-17-frontend-overhaul-design.md). It gives the header an examples menu, saves the program
across reloads, opens a first visit on a real example, and adds share links that carry the program, its encoding, the
workspace and where each leg stands. Part 6's other half, base16 palette import, is 6b, a lane of its own beside this
one (§3, row 1).

It answers the two questions the umbrella's §6 left for this part. **How many steps does each example take in the
browser?** §2.7 has the table, measured through the real session worker under both encodings: under the default
encoding four legs' first recordings fill their history before the run ends, and one TM leg is declined. **How big is a
typical link?** 418 to 583 characters of fragment for the seven examples, with the default workspace and every leg at
the end of its first recording (§5.1). It also **amends two of the umbrella's premises**. §5's examples test, "checks λ
and TM agree on its value within budget", cannot hold for `fact(4)` or `fact(12)`, whose λ legs fill their history
before a value, and §4.6 replaces it with a declared outcome per leg (row 12). §2 row 12's "each view's step
position" is a position per leg, because the views of one leg walk one history (§2.3, row 7).

Code facts below were read at `18f8225` (#112, part 5c's squash merge). §11 gives the command behind every figure.

## §1 Scope, and the two PRs

| PR | Contains | Touches |
|---|---|---|
| **6a-i** | the seven examples and their manifest; `examples ▾`; picking an example, with undo; `redextape.program`; the first-load example, `sum_to(5)`; the examples test (§4.6); the controls gate widened to inputs, text areas and open dialogs (§6) | `web/` only |
| **6a-ii** | the link format, its encoder and its validating decoder; `share` and its popover; opening a link at start-up and on `hashchange`, with undo; positions, their automatic continue and its cap, and their clamp; the frozen v1 link | `web/` only |

6a-i lands first and 6a-ii builds on it. Both change `main.ts`'s start-up path — 6a-i replaces `SAMPLE` with the stored
program or the example, and 6a-ii puts a link ahead of both — which is why they run in sequence in this lane. Neither
touches Rust, so the wasm build, the bindings and the Rust gates are unaffected.

## §2 What exists

### §2.1 Every load starts at `SAMPLE`, and the encoding is not kept

`const SAMPLE = 'let x = 40; x + 2'` (`web/src/main.ts:89`) is the editor's document (`:1904`), the language server's
first text (`:2061`) and the start-up compile (`:2071`), on every load. Nothing stores the program. The encoding picker
is filled from `encodings()` (`:461`) and nothing sets its value, so every load compiles under its first entry, `unary`
(`crates/redextape-core/src/tm/header.rs:206`). A compile is posted 300 ms after the last keystroke, from `compile.ts`'s
timer (`web/src/compile.ts:132`), and an encoding change schedules one (`:137`).

The stores that exist — `redextape.layout` for the workspace (`web/src/layout.ts:379`), `redextape.buffers` for the
copies and their bindings (`web/src/buffers-store.ts:24`), and the appearance, style, palette and editor preferences —
each guard their `localStorage` access, and each falls back silently on a value it refuses.

### §2.2 The workspace is validated, and it carries no bindings

`serializeWorkspace` (`web/src/workspace.ts:157`) writes `{ version: 2, tree, switches, speed, focused, panels,
inspector, display, tmDisplay }`. `parseWorkspace` (`:251`) holds every field to the tree, returns `null` for anything
malformed, and still reads `version: 1` (`:262`). **A view's binding to a copy is not in it.** Bindings live in
`redextape.buffers` beside the copies they name (`buffers-store.ts`'s `PersistedBuffers`), and `main.ts` seeds them
into the panes at start-up (`main.ts:1169`). So a workspace alone opens every view on the program, and a stored binding
names a leaf id — `pane-3` — that another workspace's tree may also use.

*Reset preset* already rebuilds every view on the program: `resetViews` (`web/src/pane-host.ts:1001`) drops each entry
that shows a copy and builds it again on the program, and the copies stay in the copies menu (`main.ts:1398`).

### §2.3 A position is a leg's, shared by every view of that leg

Each session holds one `LegState` per leg, whose `hist` is a `History` ring (`web/src/sessions.ts:34`), and a view
reaches it only through `SessionRegistry.legOf(binding)` (`:447`), keyed by session and leg. Two views of the program's
λ leg therefore walk one ring: stepping either moves both. The program's three rings are built with `HISTORY_BYTES`
each (`main.ts:636`, `:642`, `:648`), 33,554,432 bytes (`web/src/protocol.ts:104`). A ring numbers its frames from
`oldestStep`, which is non-zero once it has dropped any (`web/src/history.ts`), and every frame carries its own `step`.

### §2.4 How the legs record, and what the ring keeps

- `onRun` posts `compiled`, then records λ, asm and TM in turn, each to its end or its allowance, and posts `result`
  after all three (`web/src/session-worker.ts:615`–`617`). Frames arrive in chunks of `RECORD_CHUNK`, 256
  (`protocol.ts:176`).
- A leg's allowance is `HISTORY_BYTES` (`session-worker.ts:533`). `recordLeg` checks it before each step
  (`web/src/record-loop.ts:115`), so a recording that stops on it has passed it by up to one frame. The ring's budget is
  the same number, so the ring then drops its oldest frame: step 0 (§9, finding 1).
- *Continue* — `keep recording` after `budget`, `continue — raise the step cap` after `capped`
  (`web/src/controls.ts:121`) — and `▶` at the frontier (`web/src/transport.ts:243`) post `extend` for the leg, gated by
  `canRecordFurther` (`controls.ts:96`). `onExtend` sets the allowance to what was recorded plus `HISTORY_BYTES`
  (`session-worker.ts:839`), raises a capped cursor's cap by `EXTEND_STEPS`, 100,000 (`protocol.ts:258`), records, and
  posts a `result` of its own. If it arrives while `onRun` is still recording a later leg, the two loops run side by
  side: each yields between chunks, and the recording flag is per leg (`record-loop.ts`).
- **Each continue records one ring's worth, so the ring then holds what that continue recorded, less its first frame.**
  `fact(4)`'s λ leg, measured (§A.2): 1..1,386 after the first recording; 1,388..2,768, 2,770..4,144, 4,146..5,514 and
  5,516..6,880 after four continues that stopped at `budget`; 6,037..7,398 after the fifth, where the run ends.
- `History.push` moves the head only while it follows the frontier (`history.ts:67`); dropping a frame moves the head
  with it (`:81`); `seek` stops following unless it lands on the newest frame (`:85`).
- The step line adds `(oldest kept: step N)` once a ring has dropped frames (`controls.ts:126`). Playback walks recorded
  frames and never asks the worker for more (`web/src/player.ts`).

### §2.5 The header's menus and the undo notice

The header holds `Explorer ▾` (the workspace menu), `+ view`, `copies ▾`, the encoding picker, the appearance toggle and
`settings` (`web/index.html`). Each menu is a native popover wired by `wireMenu` (`web/src/app-header.ts:16`), which
keeps `aria-expanded` true to the popover and autofocuses its first `button:not([disabled]), select` on open (`:24`).
`web/tests/browser/harness.ts`'s `SHELL` copies that markup for the browser tier, and
`web/tests/node/harness.test.ts:59` holds the two equal.

A notice lasts `NOTICE_MS`, 8,000 ms (`web/src/notice.ts:20`), or until the next notice replaces it, action and all.
Deleting a copy offers `undo` this way (`main.ts:1581`), and that undo warms the copy and moves its views back with
`paneHost.moveBack` (`main.ts:1421`). The line has one resting state, *copies are not being saved*, which the copies
writer sets on a failed write and clears on a successful one (`main.ts:904`, `:925`).

### §2.6 The controls gate walks buttons and selects

`controls-gate.test.ts` walks `button, select` (`web/tests/browser/controls-gate.test.ts:115`) — so the settings menu's
`#format-on-blur` checkbox is not walked today — and skips anything under `[hidden]` or in a closed popover
(`:116`–`118`). It opens a hand-written list of four header menus, `#workspace`, `#new-view`, `#buffers` and `#settings`
(`:213`).

### §2.7 What the examples do in the browser

Each example was run through the real `session-worker.ts` in vitest's browser project, one fresh worker per run, under
both encodings (§A.1). A figure is the last step each leg's first recording posted. *History full* is the readout's
words for `budget` (`web/src/readout.ts:56`). A TM or asm leg whose recording fills its history still has a value,
because `compile` runs those two legs to their end.

| Example | λ reductions | asm instructions | TM transitions, unary | TM transitions, binary | Value |
|---|---|---|---|---|---|
| `let x = 40; x + 2` | 7 | 5 | 2,870 | 405 | 42 |
| a closure | 9 | 30 | 73,958, history full (run: 79,307) | 13,294 | 42 |
| `is_even(6)` | 654 | 79 | 23,940 | 14,964 | true |
| `fact(4)` | 1,386, history full | 69 | 79,047 | 30,846 | 24 |
| `map` and `fold` over `[3, 1, 2]` | 555 | 260 | 78,458, history full (run: 266,863) | 69,008, history full (run: 91,785) | 9 |
| `sum_to(5)` | 951 | 84 | 40,261 | 12,976 | 15 |
| `fact(12)` | 1,406, history full | 181 | declined: "a value does not fit the encoding at any width up to the ceiling" | 75,850, history full (run: 481,964) | 479001600 |

λ and asm are the same under both encodings. Every run not marked otherwise ended. The first row agrees with
`worker.test.ts`, which pins λ at step 7 and TM at 2,870 (`web/tests/browser/worker.test.ts:53`, `:55`), and §A.2's
`fact(3)` agrees with the umbrella's 1,319 reductions and 18,574 transitions.

**A λ frame is about 24 KB, so a λ leg's history holds about 1,380 steps.** `fact(3)` ends at step 1,319 having
recorded 32,025,795 bytes, 95% of the budget, 24,262 a frame; `fact(4)` fills it at 1,386 (§9, finding 3). Continued,
`fact(4)` ends at step 7,398 after five continues of 75 to 179 ms each; `fact(12)` is still running at step 18,535
after twelve, of 370 to 555 ms each (§A.2).

**The CLI agrees on every value it gives, and gives no step counts.** `redextape run` under `reference`, `lambda` and
`tm`, and the emitted asm and unary and binary TM files run back, print 42, 42, true, 24, 9, 15 and 479001600. They
differ from the browser in three places, each for a reason:

- `run --backend lambda` on `fact(12)` had not finished after 600 s. The CLI keeps no history, so nothing stops it
  before `MAX_REDUCTION_STEPS`, 5,000,000 (`crates/redextape-core/src/lambda/reduce.rs:43`).
- `run --backend tm` on `fact(12)` exits 1, "a value exceeded the widest tape field this encoding has" — the unary
  refusal the browser shows as the TM leg's reason — while `emit --lang tm --encoding binary` writes a machine that runs
  to 479001600.
- `emit --lang asm` refuses the closure and `map`/`fold`, which the session's asm leg runs (§9, finding 2).

## §3 Decisions

Made by the user on 2026-09-29. Rows 1 to 10 were decided before §2.7 was measured. **Rows 3 and 12 were revised after
it.** Row 3 first read `fact(4)`, and row 12's test first read "λ, asm and TM agree on the value within budget, with
`fact(12)` asserted as stopping on budget". `fact(4)`'s λ leg fills its history at step 1,386 on first load, so it has
no value to show or to agree on; and `fact(12)` stops on its step budget on no leg — λ fills its history at 1,406, unary
TM is declined and asm ends at 181 (§2.7). Rows 11 to 15 were decided on those measurements. **Rows 16 and 17 were
decided when the user approved this spec**, each replacing a call its first version (`3ac7dd3`) had made.

| # | Topic | Decision | Declined |
|---|---|---|---|
| 1 | Delivery of part 6 | Two lanes in parallel: 6a (examples, first load, share links) and 6b (base16 import) | one part 6 PR; two PRs in sequence across the whole part |
| 2 | The program | Saved: its text and encoding under a new key, `redextape.program`, versioned and validated as the other stores are. The first-load example shows only when nothing valid is stored | the example on every load, with the program kept only through links |
| 3 | First-load example | **`sum_to(5)`**, in Explorer: every leg ends under the default encoding (§2.7). *Revised after §2.7* | `fact(4)`, the first choice, showing "history is full"; `fact(3)`, which ends at 95% of the history and leaves no margin; `is_even(6)`; `map`/`fold` over `[3, 1, 2]`; keeping `let x = 40; x + 2` |
| 4 | Examples menu | Its own header button, `examples ▾`, after `copies ▾`: a native popover built with `wireMenu`, each item a title and a one-line description | a section in the workspace menu; a section in settings |
| 5 | Picking an example, opening a link | Replaces the program at once, with the notice's undo. A link also replaces the workspace, and undo restores both. Once a link opens, the `#s=` fragment is cleared with `history.replaceState`, so a reload keeps later edits | confirming first if the program was edited; replacing silently |
| 6 | Copies in links | None, as the umbrella's payload says; a view bound to a copy opens on the program. Its notice is row 14's | λ copies only; all copies, behind the size warning — a TM or asm copy's text runs to megabytes, under `MAX_SCRATCH_TM_BYTES` 6,100,000 and `MAX_SCRATCH_ASM_BYTES` 5,200,000 (`crates/redextape-wasm/src/session.rs:1855`, `:1509`) |
| 7 | Positions | Per program leg — λ, asm, TM — since the views of one leg share its `History` (§2.3). Each view on the program shows its leg's step, which settles the umbrella's "each view's step position" | — |
| 8 | Sharing | A `share` header button opens a popover: the link in a read-only field, already selected, and a copy button using the clipboard API where the page is a secure context, the field being the fallback. It warns above 2,000 characters, which many chat and mail clients cut | a menu item copying straight to the clipboard, with a notice; a live URL that always holds the current link |
| 9 | Format | `#s=` + base64url(deflate-raw(JSON `{ version: 1, program, encoding, workspace, positions }`)), through the browser's `CompressionStream('deflate-raw')` and `DecompressionStream`, with no new dependency. `workspace` is `serializeWorkspace`'s output, validated on open by `parseWorkspace` | — |
| 10 | Delivery of 6a | Two PRs in sequence: 6a-i (examples, the menu, `redextape.program`, the first-load example), then 6a-ii (share links) | — |
| 11 | `fact(12)` | Stays, relabelled as the example where each leg stops differently: λ fills its history, unary TM cannot fit the value (binary can, until its own history fills), and asm ends at 479001600 | dropping the slot; relabelling it "fills its history" only |
| 12 | The examples test | Holds a declared outcome per leg: the manifest states each leg's first-recording stop under the default encoding — ended with a value, history full, or declined — and the test holds every one; the legs that end must agree on the value. Amends umbrella §5 (§4.6). *Revised after §2.7* | continuing until every leg ends; λ, asm and TM agreeing within budget, as first set out |
| 13 | A position past the opener's first recording | Continues automatically until the recording reaches it, then stops there; clamps, with a notice, only if the run ends first (§5.4). Bounded by row 16 | clamping with a notice, leaving *continue* to the user |
| 14 | The copies notice | At share time. The workspace carries no bindings (§2.2), so the share popover says, when any view shows a copy, that copies are not included and those views will open on the program. No payload field is added. On open, the opener's stored bindings are dropped, as `resetViews` does for *reset preset*, so leaf ids cannot collide | a field in the payload naming the views that showed copies; a notice on the opener's side, which cannot know |
| 15 | The controls gate | Widens to walk `input`, `textarea` and open dialogs beside `button, select`, bringing `#format-on-blur` under it. 6b needs the same and does it too: whichever PR lands second rebases onto the other's version | — |
| 16 | The automatic continue's bound | At most ten continues per leg per open. After the tenth, the leg stops at its furthest recorded step, and one notice says the link's step is further on and which step is shown; it carries the open's `undo` forward (§5.5), and *continue* stays one click away on the step controls. A hand-edited link with a huge position on a program that never ends would otherwise keep a tab busy indefinitely (§5.4) | no cap, a pending position being stopped only by a gesture, as this spec's first version had it |
| 17 | Reporting a failed program write | Only once the program has changed from what was loaded: typed, a picked example, or an opened link. A visitor on blocked storage who only looks at the first-load example sees no resting line, mirroring the copies writer's guard that reports only when there are copies to lose (§4.3). *Refined 2026-09-29, §4.3: only while the program differs from what a reload would restore* | reporting the first failed write, even on an untouched example, as this spec's first version had it |

## §4 6a-i — examples and the stored program

### §4.1 The examples and their manifest

Seven files in `web/src/examples/`, each written as `redextape fmt` leaves it (the texts are §A.1's `EXAMPLES`), and
imported with `?raw` as `colour.ts` imports its queries (`web/src/colour.ts:8`), so a missing file fails the build.
`examples.ts` holds the manifest in menu order. Per example: an id, a title, a one-line description, the text, the
value, and the declared outcome of each leg's first recording under the default encoding (row 12).

| File | Title | λ | asm | TM | Value |
|---|---|---|---|---|---|
| `arithmetic.rxt` | `let x = 40; x + 2` | ended | ended | ended | 42 |
| `closure.rxt` | a closure | ended | ended | history full | 42 |
| `is-even.rxt` | `is_even(6)` | ended | ended | ended | true |
| `fact.rxt` | `fact(4)` | history full | ended | ended | 24 |
| `map-fold.rxt` | `map` and `fold` | ended | ended | history full | 9 |
| `sum-to.rxt` | `sum_to(5)` | ended | ended | ended | 15 |
| `fact-12.rxt` | `fact(12)` | history full | ended | declined | 479001600 |

`is_even(6)` and `sum_to(5)` are new to the repository. `is_even` is `FIRST_ORDER_DEMOS`' mutual-recursion pair
(`crates/redextape-core/tests/three_way_oracle.rs`) called at 6. `sum_to` adds `n` down to 1 in a `while` loop, where
the corpus's `count_down` adds 1 each turn. The closure is `let n = 2; let add_n = |x| x + n; add_n(40)`, which captures
`n`.

A description says what the example shows and, where a leg stops early, says that, because it is what the user will
see: `fact(4)`'s says λ fills its history before its value; `fact(12)`'s names all three stops (row 11). The plan words
them, and §4.6's test holds the outcomes they describe. `FIRST_LOAD`, beside the manifest, names `sum-to` (row 3).

### §4.2 The menu

`examples ▾` sits after `copies ▾` in `index.html` and in `SHELL`: `<button id="examples" aria-haspopup="menu"
aria-controls="examples-menu" aria-expanded="false">examples <span aria-hidden="true">▾</span></button>` and a
`popover` beside it, wired by `wireMenu`, whose `onOpen` builds one button per manifest entry. An item is the title over
the description, two spans, named by `aria-label` `${title} ${description}` as the view menu's two-line items are
(`web/src/view-header.ts:407`): built from the content, the name would join the spans with a space only while they are
not `display: inline`.

### §4.3 `redextape.program`

`program-store.ts`: `PROGRAM_STORAGE_KEY = 'redextape.program'`, `PROGRAM_VERSION = 1`, `serializeProgram` writing
`{ version: 1, text, encoding }`, and `parseProgram(raw, encodings)` returning `null` for a missing key, malformed JSON,
another version, a `text` that is not a string, or an `encoding` not in `encodings`. The encodings are a parameter, so
the parser is node-testable without wasm. Access is guarded as every store's is, because `localStorage` throws in some
privacy modes.

- **Read** once, at start-up (§4.4). A `null` is silent, as a refused buffers read is: it cannot be told from a first
  visit.
- **Written** where a compile is posted — `compile.ts`'s timer (`:132`) — with the text it posts and `picker.value`. An
  encoding change, a picked example and an opened link all schedule a compile, so there is one write site and one write
  per typing pause. A keystroke in the last 300 ms before a tab closes is not saved, as a copy's is not.
- **A failed write is reported while the program differs from what a reload would restore** (row 17): the last program
  a write stored, or the one loaded while none has been. Typing, a picked example or an opened link makes it differ,
  and editing it back makes it the same again. A program a reload would not give back is work not yet saved; the
  first-load example, or a stored program only looked at, is not. While the two are the same a failed write is silent,
  as the copies writer is silent while there are no copies to lose (`writeBuffersStorage`'s `hasBuffers`,
  `main.ts:925`), so a visitor on blocked storage who only looks at the first-load example sees no resting line. Once
  reported, it goes through the notice line's resting state as a failed copies write does (§2.5). The one resting
  sentence names whichever of the two is failing — the program, the copies, or both — and why: the storage is full,
  or it is blocked, where the browser throws a `SecurityError` rather than a quota error. Each writer's success takes
  back only its own half. Today's copies sentence, which `buffers-quota.test.ts` and `buffers-quota-restored.test.ts`
  pin, is unchanged while only the copies fail for want of space.
  *Amended 2026-09-29, the user's decisions after Task 4's review: this read "once the program has changed from what
  was loaded", reporting it from the first change for the rest of the page load, and the sentence said "full" for
  blocked storage too.*
- The encoding is kept across reloads for the first time (§2.1).
- Two tabs write the key last-one-wins, as they already write `redextape.layout`.

### §4.4 First load, and the start-up order

`main.ts` replaces `SAMPLE` at its three sites (§2.1) with one start-up program, chosen after `await init()`, since
validating an encoding needs `encodings()`: the stored program if `parseProgram` accepts it, otherwise `FIRST_LOAD`'s
text under `unary`, the first encoding. The picker's value is set from it before the first `compile.schedule`. The
workspace path is unchanged: a stored workspace is restored as today, and a first visit gets `defaultWorkspace()`,
which is Explorer. An upgrading user, who has a stored workspace and no stored program, sees `sum_to(5)` in their own
workspace, once.

**The browser tier keeps its starting program.** 85 browser test files mount the app, each on a fresh storage shim
(`web/tests/browser/setup.ts:55`), so each would now start on `sum_to(5)`: a longer first compile, and a different
program in the 17 of them that contain no `insert:` (§11). The shim therefore starts every file with
`redextape.program` holding `let x = 40; x + 2` under `unary`, and the first-load test removes it before it mounts.

### §4.5 Picking an example

A pick closes the menu, sets the picker to `unary`, and replaces the editor's whole document with the example's text in
one dispatch; the editor's update listener then clears the link state and schedules the compile, as for any edit. The
notice says `opened the example sum_to(5)` and offers `undo`, which restores the text and the encoding the pick
replaced and so recompiles. The workspace is untouched. The `undo` is withdrawn at the next edit that changes the
program, and by the next pick, since it puts back the whole document and would throw that edit away; and at the next
encoding chosen in the picker, which it would take back. Used, it says `put back the program` once the focus has moved:
to the source editor, or to `examples ▾` where no view shows the source. An `undo` the focus is on that goes unused, run
out or drawn over by a notice with no action of its own, gives the focus to `examples ▾`, its action's `fallback`.
*Amended 2026-09-29, the user's decision after Task 5's review: the `undo` was offered for all of `NOTICE_MS`.*
*Amended 2026-09-30, after the whole-branch review: an encoding chosen did not withdraw the `undo`, a used `undo` said
nothing, and where the focus goes was not written here.*

The pick sets the encoding because the manifest's outcomes and descriptions are the default encoding's (row 12):
`fact(12)` under `binary` would contradict its own description.

### §4.6 The examples test — amending umbrella §5

Umbrella §5: "A test compiles every example and checks λ and TM agree on its value within budget, so an example cannot
rot unnoticed." Under the app's own history budget it cannot hold for two of the seven: `fact(4)` and `fact(12)` fill
λ's history before a value, and `fact(12)`'s unary TM is declined besides. Two more reach their TM value only through
`compile`'s own run, since their unary TM recordings fill their history too: the closure and `map`/`fold` (§2.7).
Continuing every leg to its end would hold what no user sees on picking an example, and `fact(12)`'s λ had not ended
after twelve continues. So the test holds the manifest's declared outcomes (row 12). That keeps the umbrella's
property, that an example cannot rot unnoticed. It holds each leg's declared stop and the value, not a description's
words, which are kept in step with the outcomes by hand.
*Amended 2026-09-29, the user's decision after Task 1's review: this also claimed that an example's description cannot
drift from what it does, which the test does not hold.*

`examples.test.ts` is a browser test, since node tests run no wasm. Per example it posts one `run` under `unary` to a
real `session-worker.ts`, as `worker.test.ts`'s `askAll` does, until `result`, and holds for each leg:

- the declared stop: *declined* is `compiled`'s status unavailable; *ended* and *history full* are the last frames
  reply's `done`, `ended` and `budget`;
- an ended leg's value equals the manifest's, so the legs that end agree;
- a TM or asm leg whose recording fills its history carries `compile`'s own run's value, and that equals the
  manifest's too (the closure's unary TM 42, `map`/`fold`'s 9, §2.7). A λ leg that fills its history reads `Unfinished`
  and has nothing to hold.

The margins are narrow in places: the closure's unary TM records 73,958 of 79,307 steps before its history fills. A
change in a TM frame's size can flip it to *ended*; the test then fails, and the manifest's outcome is changed, and
the example's description with it, by hand. That is the test working.

## §5 6a-ii — share links

### §5.1 The format

```
#s= base64url, unpadded ( deflate-raw ( UTF-8 ( JSON {
  version: 1,
  program: string,      // the source editor's text
  encoding: string,     // picker.value, one of encodings()
  workspace: string,    // serializeWorkspace's output, verbatim
  positions: { lambda?: number, asm?: number, tm?: number }
} ) ) )
```

It sits in the fragment, so it is never sent to a server. `workspace` is the string `serializeWorkspace` returns and
`persistWorkspace` stores, so opening hands it to `parseWorkspace` unchanged, and a link's workspace is validated
exactly as a stored one is. Embedding the parsed object instead would save 26 to 30 characters a link (§11) and give
the reader a second path.

A position is the leg's `hist.currentStep` on the program session, for each leg with frames; a leg with none is left
out. Positions describe the frames on screen, so they are taken only while the program session is not awaiting a run
(`SessionClient.awaitingRun`): a link made while the editor's text is still compiling carries none.

**Sizes.** With the default workspace and every leg at the end of its first recording, under Chrome's
`CompressionStream` (§A.1), the fragment is 418 characters for `let x = 40; x + 2`, 445 for the closure, 502 for
`is_even(6)`, 474 for `fact(4)`, 583 for `map`/`fold`, 501 for `sum_to(5)` and 470 for `fact(12)`; the probe wrote
`tm: 0` for `fact(12)`'s declined TM leg, which the format leaves out. The API takes no level, and node's `zlib` at
levels 6 and 9 and node's own `CompressionStream` produce different bytes from Chrome's for the same payload, from 8
characters fewer to 2 more (§A.3), so no test may pin an encoder's bytes. Every program to hand — the seven examples
and the 46 of `FIRST_ORDER_DEMOS`, formatted, joined into one program of 4,823 bytes — makes a 1,638-character
fragment under node's `zlib` at level 6 with the workspace as an object: the 2,000-character warning is reached above
4.8 KB of source.

**The frozen v1 link pins `parseWorkspace`'s reader for good.** The test's link embeds a `version: 2` workspace and
must open for as long as the format does, so `parseWorkspace` must go on reading version 2, as it reads version 1 today
(`workspace.ts:262`). A later workspace version migrates version 2; it cannot refuse it.

### §5.2 Sharing

`share` sits after `examples ▾`: a button named `share`, without `▾`, as `settings` has none, opening a popover wired by
`wireMenu`. On each open, as the workspace menu rebuilds on each open, the popover is built again; nothing keeps a link
current (row 8).

- **The link** is the payload of §5.1 after `location.origin + location.pathname`. `CompressionStream` is asynchronous,
  so the field is filled when the encode resolves.
- **The field** is `<label>link <input type="text" readonly></label>`, and it takes the focus with its text selected.
  `wireMenu` autofocuses only buttons and selects, so the popover sets `autofocus` on the field and selects its text on
  `toggle`, after the popover shows: `beforetoggle` runs while it is still hidden, where `.select()` does nothing, as
  `buffer-list.ts` records for `.focus()`.
- **`copy link`** calls `navigator.clipboard.writeText`. On a page that is not a secure context `navigator.clipboard`
  does not exist, so the button is removed (umbrella §4 rule 4: it can never apply there) and the selected field is the
  way; a page served over plain `http` from a LAN address is not a secure context. The button is disabled, with its
  reason as its tooltip, until the field holds the link. Success says `link copied`; a refused write says the link is
  selected in the field.
- **Above 2,000 characters of URL**, a line says how long the link is and that some chat and mail apps cut links past
  2,000 characters (row 8).
- **When any view shows a copy**, a line says copies are not included and names, by title, the views that will open on
  the program, reading `link-wiring.ts`'s `detachedPanes` as the copies status note does (part 5's amendment 42;
  row 14).

Both lines are `aria-describedby` on the field.

### §5.3 Opening a link

**At start-up** `main.ts` reads `location.hash` after `await init()` and before the workspace restore (`main.ts:984`);
a link takes precedence over both stores. **On an open page**, a `hashchange` listener takes a pasted link the same way.
Decoding strips `#s=`, turns base64url into bytes, inflates them through `DecompressionStream('deflate-raw')` — read
incrementally and refused past a byte cap the plan measures and fixes, so a crafted link cannot inflate without bound —
and parses the UTF-8 as JSON. Then:

- `version` 1, `program` a string, `encoding` in `encodings()`, `workspace` accepted by `parseWorkspace`, and
  `positions` an object whose keys are legs and whose values are safe integers of 0 or more: the link opens whole.
- Anything else, with `program` a string: the program alone opens — its text, under its encoding if that is valid and
  the current one otherwise — with a notice saying what was left out (§7).
- No readable `program`: nothing changes (§7).

Opening whole sets the picker and replaces the editor's document, and the compile follows as in §4.5. It replaces `tree`
and `ws` with the link's workspace and rebuilds the views through `resetViews`, so every view is on the program; the
opener's copies stay listed, and their stored bindings are dropped (row 14). At start-up the bindings are not seeded at
all (`main.ts:1169`), so no copy is warmed. The positions are held as pending (§5.4). `history.replaceState` then
removes the fragment (row 5) — the program and the workspace reach storage by their ordinary writes — and the notice
`opened a shared link` offers `undo` (§5.5).

### §5.4 Positions

**Held, then applied as frames arrive.** The opener keeps one pending position per leg, tagged with the program
session's generation for the link's compile. On each frames reply of that generation for a leg with a pending position
`P`, once `hist.newestStep >= P`, it calls `hist.seek(P - hist.oldestStep)` and the position is spent. That can happen
mid-recording: `seek` stops following, so the rest of the recording does not move the view, and a frame the ring drops
later moves the head with it (§2.4). Every view of the leg shows it (row 7). A position for a declined leg is dropped
silently; the leg's view already says why it is absent.

**The legs record in order, so their positions apply in order.** `onRun` records λ, then asm, then TM (§2.4): a λ
position can apply while asm and TM have no frames yet, and a TM position waits for both of their first recordings.

**Past the first recording, it continues** (row 13). When a leg's recording stops short of `P`:

- **After `capped` or `budget`** (`canRecordFurther`), the opener posts that leg's `extend` — the request *continue*
  posts — and repeats until the ring reaches `P`, at most ten times for that leg in that open (row 16). A capped run's
  cap is raised as `continue — raise the step cap` raises it, since a sharer standing past a cap raised it. **Not
  before the run's `result`, and one leg at a time, λ then asm then TM.** `onExtend` runs beside `onRun`'s later legs
  (§2.4), so an `extend` posted the moment λ's first recording stopped would interleave its chunks with TM's first
  recording and post a `result` before the run's own. Waiting keeps one recording loop at a time and the `result`
  replies in order.
- **After any other end** — `ended`, `depth-refused`, `stack-full`, `heap-full`, `memory-full` — the run ended short of
  `P`. The leg seeks to its last frame, and one notice says the link's step is past this run's end and which step is
  shown.
- **After the tenth continue** short of `P`, the leg stops at its furthest recorded step, and one notice says the link's
  step is further on and which step is shown (row 16). *Continue* on the step controls records further, as it does
  after any recording that fills its history. `fact(12)`'s λ at step 17,000 is one: its tenth continue's window ends at
  15,695, and only an eleventh, whose window is 15,697..17,114, would reach it (§A.2).

While a position is pending, the leg's step line says so, for example `step 1,386 of 1,386 — going to step 3,000 from
the link`; the plan words it. The pending position is dropped by any gesture on that leg's step controls; by a
recompile, whether a keystroke, an encoding change or an example; by another link; by undo; and by the tenth continue.
The last is what stops a hand-edited link whose position lies past a run that never ends, which would otherwise keep a
tab busy indefinitely (row 16).

**What the ring's dropped steps mean for a position** (§2.4, §9 finding 1):

- A continue records one ring's worth, and the ring then holds what that continue recorded, less its first frame. So a
  position is kept by the continue that reaches it, unless it is that continue's first step — `fact(4)`'s λ steps
  1,387, 2,769, 4,145 and 5,515 — where the seek lands on the oldest kept step, one later. The sharer's own ring
  dropped the same step, so only a link made mid-recording, or edited by hand, names one.
- For the same reason a leg whose first recording fills its history has no step 0, and a position of 0 lands on step 1.
- Once a continue passes them, the steps before its window are gone: the opener cannot step back to where the sharer's
  history began, as the sharer could not after their own continues. The step line's `(oldest kept: step N)` says so.
- A λ continue took 75 to 555 ms, off the main thread (§2.7). `fact(4)`'s λ at step 3,000 needs two; `fact(12)`'s
  first ten took 4,381 ms together, so the cap holds an open's continuing on that leg to about that (§A.2).

The opener's run is the sharer's — the same program, encoding and build — so the frames, their sizes and the ring's
windows match. A link opened on a different build may land its positions elsewhere, and they continue and clamp as
above.

### §5.5 Undo

`opened a shared link` offers `undo` for `NOTICE_MS`. It restores the program's text and encoding, the tree and the
workspace, and each binding the open dropped, warming the copy as the delete's undo does and moving its views back with
`moveBack` (§2.5); a copy the cap refuses stays paused, and its view stays on the program. It drops every pending
position. It does not restore the fragment.

**A notice about the same open carries its undo forward.** A new notice replaces the old one, action and all (§2.5),
and a clamp (§5.4) arrives hundreds of milliseconds after the open, so a clamp or program-alone notice made while the
open's undo is live offers that same `undo`. So does the notice the tenth continue makes (row 16).

*Noted 2026-09-30, after 6a-i's whole-branch review: a pick's `undo` was offered for all of `NOTICE_MS` too, until the
user's decision withdrew it at the next edit (§4.5), since it puts back the whole document. This `undo` puts back the
whole document and more, so 6a-ii's plan has the same question to answer for it.*

## §6 Accessibility, and the controls gate

Every new control follows umbrella §4's rules.

- **Names (rule 1).** `examples` and `share` are named by their text; `▾` is `aria-hidden`. An example is named
  `${title} ${description}` by `aria-label` (§4.2). The field is named by its label, `link`; `copy link` by its text.
- **One glyph, one meaning (rule 2).** `▾` on `examples` discloses its menu.
- **Keyboard (rule 5).** Both popovers open from their buttons and put the focus inside — on the first example, on the
  field — and Escape closes them, the native popover returning the focus to what held it before.
- **Removed or disabled (rule 4).** `copy link` is removed outside a secure context, and disabled with its reason while
  the link is being built.
- **Announced (rule 5).** A pick, an open, a clamp, a copy and a refused copy are notices, in the one live region. The
  popover's two lines are `aria-describedby` on the field. Nothing is announced as a pending position advances; the step
  line carries it, as it carries every step.

**The gate** (row 15):

- `controls()` walks `button, select, input, textarea`, leaves out `input[type=hidden]`, and admits a control inside a
  `<dialog>` only while the dialog is open, as it admits one in a popover only while that is open. `selectLabel`
  becomes the label rule for every form control: the wrapping `<label>`'s text without the control. `#format-on-blur`,
  `<label><input type="checkbox"> format on blur</label>`, is walked for the first time.
- The header menus are read off the page rather than listed: every `header.bar button[aria-controls]` is opened in turn,
  and the case asserts that `#examples` and `#share` are among them, so the loop cannot pass by walking none. The gate's
  `viewLeaves` records the reason: "a list of the views there were is a list that misses the next one".
- The gate's `beforeAll` already puts a λ copy on the page, so the share popover it opens carries the copies line.
- 6b widens the gate too (row 15). Whichever PR lands second rebases onto the other's version, and the same holds for
  the header markup in `index.html` and `SHELL`, which both lanes change.
  *Amended 2026-09-30, at 6a-i's rebase onto 6b (#119), which landed first: the gate keeps 6b's rule for dialogs, only a
  modal dialog's controls while one is open and none in a closed one, and 6b's name for the label helper,
  `selectLabel`; 6a-i adds the hidden input, `=` and the header menus read off the page.*

## §7 When things fail

Each leaves a working app and at most one notice; none blocks editing or compiling (umbrella §7).

- **Nothing valid is stored.** `sum_to(5)`, silently (§4.4).
- **The program cannot be saved.** Silent while the program is what a reload would restore; otherwise the resting line,
  naming the program and whether the storage is full or blocked (§4.3, row 17).
- **A link cannot be read** — bad base64url, a failed or over-cap inflate, malformed JSON, or no string `program`.
  Nothing changes, and the notice says `this link could not be read — nothing was changed`. The fragment is cleared
  anyway, so a reload does not say it again.
- **A link from an unknown version, or with anything else invalid.** The program alone, with one notice naming what was
  left out — the workspace and positions, or the encoding — and `undo`.
- **A position past the end of its run.** Clamped to the last step, with one notice (§5.4). A position past the first
  recording is not a failure: it continues.
- **A position more than ten continues past its leg's first recording.** The leg stops at its furthest recorded step,
  with one notice that carries the open's `undo`; *continue* records further (§5.4, row 16).
- **A position for a declined leg.** Dropped, silently.
- **A link whose program does not compile.** It opens, with diagnostics in the editor as for typed text; its positions
  are dropped when the compile answers `no-session`.
- **The clipboard refuses a write.** A notice, with the field still selected. Outside a secure context there is no copy
  button.
- **A link over 2,000 characters** is not a failure: the popover warns.

## §8 Testing

| Where | What |
|---|---|
| node | `program-store.ts`: the round trip and every refusal. The link codec: an encode → decode round trip over generated payloads (umbrella §8.4), and each refusal of §5.3. The frozen v1 link: a fragment committed as a string, which must decode to its payload and whose workspace must parse — decoding is pinned, never an encoder's bytes (§5.1). The manifest: every entry's file imported, ids unique, `FIRST_LOAD` naming an entry, an outcome for every leg. `CompressionStream` and `DecompressionStream` are node globals, and node decodes Chrome's links (§A.3) |
| browser | §4.6's examples test. First load with no program stored, with one stored, and with an invalid one. The menu by real pointer clicks and by keys; a pick and its undo, text and encoding. The share popover: the field focused and selected, copy under a granted clipboard permission and under a refused one, the copies line with a view on a copy, the warning over 2,000. Opening at start-up and by `hashchange`: the fragment cleared, the workspace replaced, bindings dropped, and undo restoring the program, the workspace and a copy's view. Positions: `fact(4)`'s λ at 3,000 reached after two continues; `sum_to(5)`'s λ at 5,000 clamped to 951 with a notice; `fact(4)`'s λ at 1,387 landing on 1,388; `fact(12)`'s λ at 17,000 stopping at 15,695 after ten continues, with its notice and the open's `undo`; a step gesture stopping a pending continue. A program write refused by storage, in one file that arms the refusal before `main()` runs as `buffers-quota-empty.test.ts` does: no resting line after the first-load example's writes, then the line naming the program once an edit's write is refused. The widened controls gate |
| by hand | the three presets, light and dark, at 1280×800 and at a phone's width, with each popover open |

Each new test gets sabotages aimed at each property it claims, among them: a manifest declaring the closure's unary TM
*ended*; a decoder that ignores `version`; positions applied on `compiled` rather than on frames; an automatic continue
that never posts; the continue cap removed; the program writer's changed-guard removed; and the gate's selector put
back to `button, select` with the share popover open.

Before each PR, beyond `check-all`: the 90% llvm-cov floor, `check-slow.sh`, the hygiene scans (`scripts/check-*.sh`),
and building and running the Docker image, which no PR job builds.

## §9 Out of scope

- **Base16 import** — 6b (row 1).
- **Copies in links** (row 6), and the positions of views on copies.
- **Declared outcomes under `binary`.** The test holds the default encoding; §2.7 records `binary`'s figures.
- **A gate holding the example files to `redextape fmt`'s output.** No hook formats `.rxt` files today.
- **Short links, or any storage on a server.** A link lives in its fragment.
- **Keeping two tabs' programs apart** (§4.3).
- Synchronized stepping across views (umbrella §10).

**Found while measuring for this spec, and filed here.** None is this lane's to fix; each changes behaviour outside it.

1. **A recording that fills its history drops its first frame, step 0 included.** The worker's allowance and the ring's
   budget are both `HISTORY_BYTES` (`session-worker.ts:533`, `main.ts:636`), and `recordLeg` checks the allowance
   before each step (`record-loop.ts:115`), so a recording passes it by up to one frame and the ring evicts its oldest
   frame to get back under. `fact(4)`'s first λ recording is 33,574,086 bytes, 19,654 over 33,554,432, and its ring
   holds steps 1..1,386; each continue then drops its own first step, 1,387, 2,769, 4,145 and 5,515 (§2.4, §A.2).
   *Restart* on such a leg lands on step 1, and the step line reports the loss as eviction.
2. **`redextape emit --lang asm` does not defunctionalize.** It calls `lower_asm` directly
   (`crates/redextape-cli/src/emit.rs:218`), so it refuses the closure ("unbound `n`") and `map`/`fold` ("call of
   unknown function `f`") with exit 2, while the session's asm leg lowers through `tm::lower_program` and runs them, in
   30 and 260 instructions (§2.7).
3. **A λ frame is about 24 KB, so a λ leg's history holds about 1,380 steps.** `fact(2)` records 24,228 bytes a frame
   and `fact(3)` 24,262; `fact(4)`'s λ fills its history at step 1,386 and `fact(12)`'s at 1,406 (§A.2). Row 3's first
   choice, `fact(4)`, fell to this. What the 24 KB is made of is not measured here.

## §10 Delivery

Each PR gets its own plan, built and gated in a scratch worktree before it is handed out, as part 5's were, and its own
roadmap entry. 6a-i lands first and 6a-ii on it (§1). 6b runs beside both; where the lanes meet — the controls gate and
the header markup in `index.html` and `SHELL` — whichever lands second rebases onto the other (row 15). 6a-ii's plan
measures and fixes §5.3's inflate cap.

## §11 Figures, and what produced them

§A.1 and §A.2 were each placed in `web/tests/browser/` of a worktree at `18f8225` with the setup the lanes use
(`pnpm install --frozen-lockfile`, `pnpm run build:wasm`, `pnpm run build:lsp-wasm`, `pnpm run build:bindings`), run
once on 2026-09-29, and deleted. Each ran as `cd web && flock <browser lock> systemd-run --user --wait --collect --pipe
-p MemoryMax=16G -p MemorySwapMax=0 --setenv=PATH=… --working-directory="$PWD" pnpm exec vitest run --project browser
tests/browser/<file>`. The CLI is `target/release/redextape`, built by `cargo build -p redextape-cli --release` at
`18f8225`.

| Value | What | Produced by |
|---|---|---|
| §2.7's table: 7, 5, 2,870, 405; 9, 30, 73,958 of 79,307, 13,294; 654, 79, 23,940, 14,964; 1,386, 69, 79,047, 30,846; 555, 260, 78,458 of 266,863, 69,008 of 91,785; 951, 84, 40,261, 12,976; 1,406, 181, declined, 75,850 of 481,964 | each example's last recorded step per leg and encoding, how each first recording ended, and the TM or asm run's length where a recording filled its history | §A.1's `RUN` rows: `steps`, `done`, `total` and `avail` |
| 42, 42, true, 24, 9, 15, 479001600 | the examples' values in the browser | §A.1's `RUN` rows' `value` |
| "a value does not fit the encoding at any width up to the ceiling" | `fact(12)`'s unary TM reason | §A.1's `fact12 \| unary` row's `reason` |
| 418, 445, 502, 474, 583, 501, 470 | fragment characters per example, workspace as `serializeWorkspace`'s string, Chrome's `CompressionStream` | §A.1's `LINK` rows' `fragment-if-string` |
| 390, 415, 475, 445, 557, 471, 441; 26 to 30 | the same with the workspace as a parsed object; the difference | §A.1's `LINK` rows' `fragment`; subtraction |
| 391, 417, 467, 442, 551, 465, 438; 8 fewer to 2 more | fragment lengths from node's `zlib` at levels 6 and 9 and from node's `CompressionStream`, on the same payloads — the three give these lengths, and no fragment identical to Chrome's; the spread against Chrome's 390, 415, 475, 445, 557, 471, 441 | `node crosscheck.mjs` and `node nodecs.mjs` (§A.3), node 26.10.0 |
| 4,823 bytes, 1,638 characters | the 53 programs joined, and their fragment | `node crosscheck.mjs`'s last line (§A.3), over §A.4's `demos-fmt.json` and §A.1's texts |
| 1..1,386; 1,388..2,768, 2,770..4,144, 4,146..5,514, 5,516..6,880; 6,037..7,398 | `fact(4)`'s λ ring after its first recording and each continue | §A.2's `FIRST` and `CONT` rows for `fact(4)` |
| 18,535 after twelve continues | `fact(12)`'s λ | §A.2's `CONT12` row |
| 14,273..15,695; 15,697..17,114; 17,000 | `fact(12)`'s λ ring after its tenth and eleventh continues; the position the cap test uses, inside the eleventh | §A.2's `CONT10` and `CONT11` rows; 17,000 chosen between them |
| 4,381 ms | `fact(12)`'s first ten λ continues together | §A.2's `CONT1` to `CONT10` rows' `ms`: 555 + 370 + 478 + 383 + 447 + 378 + 531 + 398 + 454 + 387 |
| 75 to 179 ms; 370 to 555 ms | a λ continue's time, `fact(4)` and `fact(12)` | §A.2's `CONT` rows' `ms`, one run |
| 32,025,795 bytes, 95%, 24,262 a frame; 24,228 a frame | `fact(3)`'s first λ recording, its share of the budget and its bytes a frame; `fact(2)`'s bytes a frame | §A.2's `FIRST` rows' `bytes` and `per-frame`; 32,025,795 ÷ 33,554,432 |
| 33,574,086 bytes, 19,654 over | `fact(4)`'s first λ recording | §A.2's `FIRST` row for `fact(4)`; 33,574,086 − 33,554,432 |
| 1,319 and 18,574 | `fact(3)`'s λ reductions and TM transitions | §A.2's `FIRST` row for `fact(3)`; umbrella §11 |
| 33,554,432 | `HISTORY_BYTES` | `web/src/protocol.ts:104`, 32 × 1024 × 1024 |
| 256; 100,000 | `RECORD_CHUNK`; `EXTEND_STEPS` | `protocol.ts:176`, `:258` |
| 5,000,000 | `MAX_REDUCTION_STEPS` | `crates/redextape-core/src/lambda/reduce.rs:43` |
| 6,100,000; 5,200,000 | `MAX_SCRATCH_TM_BYTES`; `MAX_SCRATCH_ASM_BYTES` | `crates/redextape-wasm/src/session.rs:1855`, `:1509` |
| 8,000 ms | `NOTICE_MS` | `web/src/notice.ts:20` |
| 2,000 characters | the share popover's warning | set by the user (row 8), not measured |
| 7 and 2,870 | the λ step and TM total `worker.test.ts` pins for `let x = 40; x + 2` | `web/tests/browser/worker.test.ts:53`, `:55` |
| 42, 42, true, 24, 9, 15, 479001600, and §2.7's three CLI differences | the CLI's values | `redextape --no-config run --backend {reference,lambda,tm} <file>`; `emit <file> --lang asm -o <f>.asm` then `run <f>.asm`; `emit <file> --lang tm --encoding {unary,binary} -o <f>.tm` then `run <f>.tm`; each file being §A.1's text; the λ run of `fact(12)` under `timeout 600`, exit 124 |
| 85; 17 | browser test files that mount the app; of them, those containing no `insert:` | `grep -l "src/main'" web/tests/browser/*.test.ts \| wc -l`; `grep -L 'insert:' $(grep -l "src/main'" web/tests/browser/*.test.ts) \| wc -l` |
| 46 | `FIRST_ORDER_DEMOS`' programs | `python3 extract_demos.py` (§A.4) |

## §A Probe sources

Four files, each run as §11 says. **None re-implements what it measures**: §A.1 and §A.2 post the app's own `run` and
`extend` requests to the app's own `session-worker.ts`, and §A.2 pushes the frames into the app's own `History` with
the app's own sizers, so the rings it reports are the rings a view walks.

### §A.1 `examples-probe.test.ts` — steps, stops, values and link sizes

Its `EXAMPLES` are the seven example texts, each as `redextape --no-config fmt` wrote it.

```ts
import { expect, it } from 'vitest'
import type { RecordEnd, RunReply } from '../../src/protocol'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'

/**
 * Design-stage probe for Plan 7 part 6a: per example and encoding, what the real session worker records on each
 * leg, and the size of a link carrying it. Not committed.
 */

const EXAMPLES: Record<string, string> = {
  arithmetic: 'let x = 40;\nx + 2\n',
  closure: 'let n = 2;\nlet add_n = |x| x + n;\nadd_n(40)\n',
  is_even:
    'fn is_even(n) {\n    if n == 0 {\n        true\n    } else {\n        is_odd(n - 1)\n    }\n}\nfn is_odd(n) {\n    if n == 0 {\n        false\n    } else {\n        is_even(n - 1)\n    }\n}\nis_even(6)\n',
  fact: 'fn fact(n) {\n    if n == 0 {\n        1\n    } else {\n        n * fact(n - 1)\n    }\n}\nfact(4)\n',
  map_fold:
    'fn map(xs, f) {\n    if is_empty(xs) {\n        nil\n    } else {\n        cons(f(head(xs)), map(tail(xs), f))\n    }\n}\nfn fold(xs, acc, f) {\n    if is_empty(xs) {\n        acc\n    } else {\n        fold(tail(xs), f(acc, head(xs)), f)\n    }\n}\nfn add(a, b) {\n    a + b\n}\nfn add1(x) {\n    x + 1\n}\nfold([3, 1, 2].map(add1), 0, add)\n',
  sum_to:
    'fn sum_to(n) {\n    let mut acc = 0;\n    while n > 0 {\n        acc = acc + n;\n        n = n - 1;\n    }\n    acc\n}\nsum_to(5)\n',
  fact12: 'fn fact(n) {\n    if n == 0 {\n        1\n    } else {\n        n * fact(n - 1)\n    }\n}\nfact(12)\n',
}

type LegTally = { frames: number; first: number | null; last: number | null; done: RecordEnd | null }

/** Post one `run` to a fresh worker and tally every reply until its `result` (or `no-session`). */
function record(src: string, encoding: string, timeoutMs = 600_000) {
  const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
  const legs: Record<'lambda' | 'asm' | 'tm', LegTally> = {
    lambda: { frames: 0, first: null, last: null, done: null },
    asm: { frames: 0, first: null, last: null, done: null },
    tm: { frames: 0, first: null, last: null, done: null },
  }
  const order: string[] = []
  return new Promise<{ legs: typeof legs; compiled: RunReply | null; result: RunReply; order: string[] }>(
    (resolve, reject) => {
      let compiled: RunReply | null = null
      const timer = setTimeout(() => {
        worker.terminate()
        reject(new Error('timed out'))
      }, timeoutMs)
      worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
        const r = e.data
        if (r.kind === 'compiled') compiled = r
        if (r.kind === 'lambda-frames' || r.kind === 'asm-frames' || r.kind === 'tm-frames') {
          const leg = r.kind === 'lambda-frames' ? 'lambda' : r.kind === 'asm-frames' ? 'asm' : 'tm'
          if (order.at(-1) !== leg) order.push(leg)
          const t = legs[leg]
          for (const f of r.frames) {
            const step = Number((f as { step: number | string }).step)
            if (t.first === null) t.first = step
            t.last = step
            t.frames += 1
          }
          t.done = r.done
        }
        if (r.kind === 'result' || r.kind === 'no-session' || r.kind === 'worker-error') {
          clearTimeout(timer)
          worker.terminate()
          resolve({ legs, compiled, result: r, order })
        }
      })
      worker.postMessage({ kind: 'run', gen: 1, src, encoding })
    },
  )
}

async function deflateRaw(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

const valueText = (v: unknown): string => JSON.stringify(v)

it('records every example on every leg, under unary and binary, and sizes its link', async () => {
  const rows: string[] = []
  const links: Record<string, { payload: string; fragment: string }> = {}
  const workspace = JSON.parse(serializeWorkspace(defaultWorkspace())) as unknown
  for (const [name, src] of Object.entries(EXAMPLES)) {
    for (const encoding of ['unary', 'binary']) {
      const t0 = performance.now()
      const { legs, compiled, result, order } = await record(src, encoding)
      const ms = (performance.now() - t0).toFixed(0)
      const c = compiled as Extract<RunReply, { kind: 'compiled' }> | null
      const r = result as Extract<RunReply, { kind: 'result' }>
      rows.push(
        [
          'RUN',
          name,
          encoding,
          `order=${order.join('>')}`,
          `λ avail=${c?.lambda.available} reason=${JSON.stringify(c?.lambda.reason)} frames=${legs.lambda.frames} steps=${legs.lambda.first}..${legs.lambda.last} done=${legs.lambda.done} run=${r.lambda?.status.run} value=${valueText(r.lambda?.value)}`,
          `asm avail=${c?.asm.available} reason=${JSON.stringify(c?.asm.reason)} total=${c?.asm.total_steps} frames=${legs.asm.frames} steps=${legs.asm.first}..${legs.asm.last} done=${legs.asm.done} run=${r.asm?.status.run} cap=${r.asm?.status.cap} value=${valueText(r.asm?.value)}`,
          `tm avail=${c?.tm.available} reason=${JSON.stringify(c?.tm.reason)} width=${c?.tm.width} total=${c?.tm.total_steps} frames=${legs.tm.frames} steps=${legs.tm.first}..${legs.tm.last} done=${legs.tm.done} run=${r.tm?.status.run} value=${valueText(r.tm?.value)}`,
          `ms=${ms}`,
        ].join(' | '),
      )
      if (encoding === 'unary') {
        const positions = { lambda: legs.lambda.last ?? 0, asm: legs.asm.last ?? 0, tm: legs.tm.last ?? 0 }
        const payload = JSON.stringify({ version: 1, program: src, encoding, workspace, positions })
        const bytes = await deflateRaw(payload)
        const fragment = `#s=${base64url(bytes)}`
        links[name] = { payload, fragment }
        // The workspace as `serializeWorkspace`'s string rather than its parsed object, for comparison.
        const asString = JSON.stringify({
          version: 1,
          program: src,
          encoding,
          workspace: serializeWorkspace(defaultWorkspace()),
          positions,
        })
        const stringFragment = `#s=${base64url(await deflateRaw(asString))}`
        rows.push(
          `LINK | ${name} | src=${new TextEncoder().encode(src).length} | json=${payload.length} | deflated=${bytes.length} | fragment=${fragment.length} | positions=${JSON.stringify(positions)} | json-if-string=${asString.length} | fragment-if-string=${stringFragment.length}`,
        )
      }
    }
  }
  console.log(`\n${rows.join('\n')}\n`)
  console.log(`LINKS-JSON ${JSON.stringify(links)}`)
  expect(rows.length).toBeGreaterThan(0)
}, 3_600_000)
```

### §A.2 `examples-probe-2.test.ts` — the λ ring through continues

```ts
import { expect, it } from 'vitest'
import { History } from '../../src/history'
import type { RecordEnd, RunReply } from '../../src/protocol'
import { asmFrameBytes, HISTORY_BYTES, lambdaFrameBytes, tmFrameBytes } from '../../src/protocol'
import type { AsmState, LambdaState, TmState } from '../../src/types'

/**
 * Design-stage probe for Plan 7 part 6a, second pass: each program's frames pushed into the app's own `History` rings
 * with the app's own sizers, and the λ leg continued (`extend`) until it ends or `MAX_CONTINUES` runs out. Not
 * committed.
 */

const FACT = (n: number) =>
  `fn fact(n) {\n    if n == 0 {\n        1\n    } else {\n        n * fact(n - 1)\n    }\n}\nfact(${n})\n`
const PROGRAMS: [string, string][] = [
  ['fact(2)', FACT(2)],
  ['fact(3)', FACT(3)],
  ['fact(4)', FACT(4)],
  ['fact(12)', FACT(12)],
]
const MAX_CONTINUES = 12

it('continues the λ leg of each fact(n) and reports the rings', async () => {
  const rows: string[] = []
  for (const [name, src] of PROGRAMS) {
    const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
    const rings = {
      lambda: new History<LambdaState>(HISTORY_BYTES),
      asm: new History<AsmState>(HISTORY_BYTES),
      tm: new History<TmState>(HISTORY_BYTES),
    }
    const done: Record<string, RecordEnd | null> = { lambda: null, asm: null, tm: null }
    let bytesLambda = 0
    let resolveResult: ((r: Extract<RunReply, { kind: 'result' }>) => void) | null = null
    worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
      const r = e.data
      if (r.kind === 'lambda-frames') {
        for (const f of r.frames) {
          const b = lambdaFrameBytes(f)
          bytesLambda += b
          rings.lambda.push(f, b)
        }
        done.lambda = r.done
      } else if (r.kind === 'asm-frames') {
        for (const f of r.frames) rings.asm.push(f, asmFrameBytes(f))
        done.asm = r.done
      } else if (r.kind === 'tm-frames') {
        for (const f of r.frames) rings.tm.push(f, tmFrameBytes(f))
        done.tm = r.done
      } else if (r.kind === 'result') resolveResult?.(r)
    })
    const nextResult = () =>
      new Promise<Extract<RunReply, { kind: 'result' }>>((res, rej) => {
        const t = setTimeout(() => rej(new Error(`${name}: no result in time`)), 600_000)
        resolveResult = (r) => {
          clearTimeout(t)
          res(r)
        }
      })
    const ring = (h: History<unknown>) => `ring ${h.oldestStep}..${h.newestStep} (${h.length} frames)`
    let pending = nextResult()
    const t0 = performance.now()
    worker.postMessage({ kind: 'run', gen: 1, src, encoding: 'unary' })
    let r = await pending
    rows.push(
      `FIRST | ${name} | λ ${ring(rings.lambda)} done=${done.lambda} bytes=${bytesLambda} per-frame=${(bytesLambda / rings.lambda.length).toFixed(0)} value=${JSON.stringify(r.lambda.value)} | asm ${ring(rings.asm)} done=${done.asm} | tm ${ring(rings.tm)} done=${done.tm} | ms=${(performance.now() - t0).toFixed(0)}`,
    )
    let continues = 0
    while (done.lambda === 'budget' && continues < MAX_CONTINUES) {
      pending = nextResult()
      const t1 = performance.now()
      worker.postMessage({ kind: 'extend', gen: 1, leg: 'lambda' })
      r = await pending
      continues += 1
      rows.push(
        `CONT${continues} | ${name} | λ ${ring(rings.lambda)} done=${done.lambda} value=${JSON.stringify(r.lambda.value)} | ms=${(performance.now() - t1).toFixed(0)}`,
      )
    }
    worker.terminate()
  }
  console.log(`\n${rows.join('\n')}\n`)
  expect(rows.length).toBeGreaterThan(0)
}, 3_600_000)
```

### §A.3 `crosscheck.mjs` and `nodecs.mjs` — node's encoders against Chrome's

Both read `links.json`, the `LINKS-JSON` line of §A.1's output; `crosscheck.mjs` also reads §A.4's `demos-fmt.json` and
`examples.json`, which maps each §A.1 name to its text.

```js
import zlib from 'node:zlib'
import fs from 'node:fs'
const links = JSON.parse(fs.readFileSync('links.json', 'utf8'))
for (const [name, { payload, fragment }] of Object.entries(links)) {
  const out = [name, 'browser', fragment.length]
  for (const level of [6, 9]) {
    const f = '#s=' + zlib.deflateRawSync(Buffer.from(payload), { level }).toString('base64url')
    out.push(`zlib${level}`, f.length, f === fragment ? 'identical' : 'differs')
  }
  console.log(out.join(' '))
}
// Largest program under 2,000 characters: prefixes of the formatted corpus, whole programs at a time,
// with the fact(4) link's workspace, encoding and positions.
const base = JSON.parse(links['fact'].payload)
const demos = JSON.parse(fs.readFileSync('demos-fmt.json', 'utf8'))
const examples = JSON.parse(fs.readFileSync('examples.json', 'utf8'))
const corpus = [...Object.values(examples), ...demos]
let text = ''
let best = null
for (const [i, p] of corpus.entries()) {
  const next = text + (text === '' ? '' : '\n') + p
  const payload = JSON.stringify({ ...base, program: next })
  const f = '#s=' + zlib.deflateRawSync(Buffer.from(payload), { level: 6 }).toString('base64url')
  if (f.length > 2000) { console.log('first over', i, Buffer.byteLength(next), f.length); break }
  text = next; best = { programs: i + 1, bytes: Buffer.byteLength(next), lines: next.split('\n').length, fragment: f.length }
}
console.log('largest under 2000', JSON.stringify(best), 'corpus programs', corpus.length, 'corpus bytes', Buffer.byteLength(corpus.join('\n')))
```

```js
import fs from 'node:fs'
const links = JSON.parse(fs.readFileSync('links.json', 'utf8'))
const deflate = async (t) => new Uint8Array(await new Response(new Blob([new TextEncoder().encode(t)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
const inflate = async (b) => new TextDecoder().decode(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
for (const [name, { payload, fragment }] of Object.entries(links)) {
  const bytes = Buffer.from(fragment.slice(3), 'base64url')
  const back = await inflate(bytes)
  const mine = '#s=' + Buffer.from(await deflate(payload)).toString('base64url')
  console.log(name, 'browser-fragment-inflates-in-node', back === payload, 'node-cs-fragment', mine.length, mine === fragment ? 'identical-to-chrome' : 'differs')
}
```

### §A.4 `extract_demos.py` and `fmt_demos.py` — the corpus, formatted

```python
import re, json, sys
src = open('/home/davey/temp/redextape-part6a/crates/redextape-core/tests/three_way_oracle.rs').read()
block = src[src.index('const FIRST_ORDER_DEMOS'):]
block = block[:block.index('\n];')]
# drop comment lines
lines = [l for l in block.split('\n')[1:] if not l.strip().startswith('//')]
body = '\n'.join(lines)
out = []
i = 0
while True:
    j = body.find('"', i)
    if j < 0: break
    k = j + 1; s = ''
    while body[k] != '"':
        if body[k] == '\\':
            n = body[k+1]
            if n == '\n':
                k += 2
                while body[k] in ' \t\n': k += 1
                continue
            s += {'n': '\n', '"': '"', '\\': '\\', 't': '\t'}[n]; k += 2; continue
        s += body[k]; k += 1
    out.append(s); i = k + 1
json.dump(out, open('demos.json', 'w'), indent=0)
print(len(out))
```

```python
import json, subprocess
R = '/home/davey/temp/redextape-part6a/target/release/redextape'
demos = json.load(open('demos.json'))
out = []
for d in demos:
    p = subprocess.run([R, '--no-config', 'fmt', '-'], input=d, capture_output=True, text=True)
    assert p.returncode == 0, (d, p.stderr)
    out.append(p.stdout)
json.dump(out, open('demos-fmt.json', 'w'))
print(len(out), sum(len(o.encode()) for o in out))
```
