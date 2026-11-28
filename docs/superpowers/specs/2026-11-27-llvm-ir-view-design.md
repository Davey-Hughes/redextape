# LLVM IR view — design

2026-11-27. The fourth piece of the IR views groundwork's §9
(`docs/superpowers/specs/2026-10-27-ir-views-groundwork-design.md`, line 444): the LLVM IR view. Its first pull request,
#209 (branch `llvm-ir-text`), wrote the module the LLVM backend builds as LLVM prints it, without LLVM, and built
`pkg-llvm/` to hand it to a page line by line, each line with its rxm pc. This design is the second pull request's: the
view. Written against `llvm-ir-text` at `b08753d`, which sits on `main` at `7033883`, and, for the files the view will
touch, `main` at `adb5d5e` (#207). §3's Q1 to Q5 were answered on 2026-11-27.

## §1 Intent, goals, anti-goals

**Why.** The native backends build the rxm program into Cranelift's IR, which the clif view shows and steps, and into
LLVM's, which nothing on the site shows. The groundwork's §9 asks for an LLVM IR view; the user's choices for #209 make
it two pull requests, the module as built only and never `.opt.ll`, and a first view that is a listing following the
pc. The site ships no LLVM, so the view lists the writer's text, which CI holds to LLVM's own print.

**Goals.**

- G1. A sixth view, kind `llvm`, off by default and on key `6`, listing the module the LLVM backend builds from the
  program before LLVM's passes, as `pkg-llvm/`'s `llvmIr` writes it, line for line.
- G2. The view follows the rxm leg of its session: it marks the lines of the rxm instruction about to run, keeps that
  instruction's `i<pc>` block in view, and draws the rxm leg's step bar, so its steps are rxm's.
- G3. `pkg-llvm/` is fetched on intent, as `pkg-clif/` is: when the pointer rests on the `llvm` toggle, it is pressed or
  focused, or a stored workspace or a link shows an `llvm` view. Nothing of it is fetched by loading the page or by
  opening, stepping or linking any other view.
- G4. Links both ways at the rxm pc: a line with a pc links its rxm instruction, as a clif row does; a pin made
  elsewhere marks the lines of the pcs it covers.
- G5. The view's words: the toggle reads `llvm`, its gloss says what the module is, and the help page says so too and
  links the writer's source.

**Non-goals.** Stepping LLVM IR (§9's stepper, later), and values, a call stack or a heap beside the listing. The
optimised module. A technical page (later). LLVM's machine code. Copies of the module. Colouring the text, which would
need an LLVM grammar.

**Anti-goals.** It fails even if it works if:

- Loading the page, or opening, stepping or linking any view but `llvm`, fetches `pkg-llvm/`.
- `pkg/` grows, or anything of the writer enters it.
- A line the view shows differs from the line `llvmIr` gave: the view never rewrites the text.
- The rxm leg's recording, stepping or share link position changes for a session that no `llvm` view shows, or the λ,
  TM, rxm or clif views change but to mark the one instruction an `llvm` row pins.

## §2 What exists

Measured on `b08753d` unless a line says otherwise.

- **The package.** `llvmIr(clifInput())` answers an `LlvmListing`, `{ functions, lines }`: each line `{ text, pc }`,
  `pc` an rxm pc or `null`; each function `{ name, label, first_line }`, `first_line` its `define` line. A program the
  writer refuses throws `decline_reason`'s sentence, a string (`crates/redextape-llvm-wasm/src/lib.rs`), as
  `fn llvm(n) { n + 1 }` does at `b08753d`; on llvm-prefix-names it writes a module, so 2b's view test draws its refusal
  from a stubbed answer (§8), and its worker test uses `fn llvm` only while #209's writer refuses it. #209's entry
  measures its wasm at 59,596 B gzip -9 with binaryen's `wasm-opt`; built here without `wasm-opt`, which this sandbox
  cannot download, it is 71,014 B, beside `pkg/`'s 343,473 B built the same way (324,340 B with `wasm-opt` at `6c5c677`,
  the last the roadmap records). Bundled into `pkg/`, it would add about a fifth to every first load.
- **The text.** The examples' modules as built run from 77 lines (arithmetic) to 889 (map-fold), 112 columns at the
  widest, with one to five `define`s. `llvmIr`'s text is, line for line, the build for O0 to O3 that each example's
  `.ll` snapshot holds first; the file holds the Os and Oz builds after it, each function marked with an `optsize`
  attribute group, so the files run from 242 lines to 2,709, and the optimised modules are the `.opt.ll` files. A pc
  owns 2 to 12 lines, 4 in the middle. **A pc's lines can stand in two places**: its `i<pc>` block, and the `cont` block
  a guard of its instruction opens, which the writer puts after its function's `exit`; 0 to 20 pcs per example are split
  so. A line with no pc is the module's header, a declaration or an intrinsic's attribute comment, a `define`, a
  `prologue` or `exit` block, a closing `}`, the `attributes` line or a blank line.
- **The run.** Each example's rxm run ends in 5 (arithmetic) to 260 (map-fold) steps. Every pc an example's run stands
  on has lines, and every instruction about to run has an `i<pc>` block (§5's node test).
- **Kinds and legs** (`main` at `adb5d5e`). `PaneKind` is `'source' | Leg` (`web/src/panes.ts:15`), and its doc says a
  kind that is not a leg extends it. Five tables are keyed by `PaneKind` (`layout.ts:67-73`, `:83-89`, `:99-105`,
  `:111-117`, `app-header.ts:329-337`), and 41 lines by `Leg` (`Record<Leg, …>` or `[K in Leg]`). `PaneEntry<K extends
  Leg>` (`panes.ts:52`) and `Binding<K extends Leg>` (`sessions.ts:176`) assume a view is a leg.
- **One step per leg.** A view of a leg draws the leg's `LegState`, whose `History` holds the step, so every view of one
  `(session, leg)` shows the same step; a share link keeps one position per leg (`share-link.ts:52`).
- **Recording.** On `main` a build records λ, rxm and TM whatever is shown, and clif only while a clif view is shown
  (`record-loop.ts`'s `recordBuild`). Under the hidden-recording design (`2026-11-03-hidden-recording-design.md`, Q-a),
  which the hidden-recording-b branch builds and which no public branch holds yet, ⏵ plays past the step cap only while
  some view shows the leg: the page's `head` message says `shown`, and a leg no view shows stops at the cap.
- **What the view is built from.** `ListingPanel` (`listing-panel.ts`) lists items and labels, marks the item about to
  run (*runs next*), the items a pin names (`setLink`) and the running focus (`setFocus`). On `main` since
  listing-follows-end (#214) merged as `9e7c493`, it draws a step with `show(next, step, { follow, last? })`
  (`listing-panel.ts:119-129` there), the block it follows named apart from the row it marks, and the rxm and clif
  listings follow the instruction the run stopped on at the end (`rxm-pane.ts:177-179`, `clif-pane.ts:402-406`); that
  `show` is the one 2b calls (§4, *Following the run*). The clif view's machine code panel is the model for the rest:
  `mcRows` and `mcNotice` (`mc-view.ts`), the answer store (`machine-code.ts`), `watchIntent` (`clif-intent.ts`) and
  `clifLoader` (`clif-loader.ts`).

## §3 Decisions

Carried, not reopened: two pull requests; the module as built, never `.opt.ll`; a first view that is a listing following
the pc; stepping and a technical page later (#209's choices, and the groundwork's §9).

Answered by the user on 2026-11-27, `1a 2a 3a 4a 5b`:

- **Q1. Where it shows.** (a) **A sixth view, kind `llvm`, off by default, on key `6`.** (b) A panel in the rxm view.
  *Answer: (a).* The groundwork's §9 and #209 name a view. Both need the same fetch and worker request; the view adds an
  entry to each table keyed by `PaneKind` and a way past `PaneEntry` and `Binding` (§3.1).
- **Q2. What it follows.** (a) **The rxm leg of its session**: the lines of `RxmState`'s instruction are marked, the
  view draws rxm's step bar and shares rxm's step, and it counts as showing rxm, so ⏵ plays past the cap with only an
  `llvm` view open. (b) It follows the rxm views and has no step bar. *Answer: (a).*
- **Q3. Panels.** (a) **The listing alone**: no values, stack, heap or result row. (b) The listing and rxm's registers.
  *Answer: (a).*
- **Q4. Fetch.** (a) **Its own package, fetched on intent**, as clif and machine code are. (b) Bundled into `pkg/`.
  *Answer: (a).*
- **Q5. Words.** (a) The toggle reads `LLVM`. (b) **The toggle reads `llvm`, lowercase, as `clif` does.** Both: the
  gloss is *the module the LLVM backend builds, before LLVM's passes, for x86-64 Linux, written by redextape and held in
  CI to LLVM's own print*, and the help page links `ll_text.rs`. *Answer: (b).*

The split (the sixth question put for this design): PR 2a, this design, its plan and the pure `llvm-view.ts` with its
node test, written in a sandbox with no browser; PR 2b, the rest of §6, on a machine with a browser once
hidden-recording-b and move-a-view have merged; listing-follows-end (#214), the third it waited for, merged as
`9e7c493`.

### §3.1 Approaches considered

| | Approach | Why not / why |
|---|---|---|
| 1 | `llvm` a `PaneKind` that is not a `Leg`, whose view binds the rxm leg | **Chosen**: what the `PaneKind` doc already provides for. The tables keyed by `PaneKind` gain an entry, and so do the few keyed by `Leg` that answer for the view a click, a pane or a title comes from (§6 *The pane*, *Links*, §9); recording, history, the worker's legs and share link positions take nothing |
| 2 | `llvm` a fifth `Leg` | Rejected: it has no frames, cursor, recording or position of its own, so 41 lines keyed by `Leg` and the worker's record loop would each take an entry with nothing in it |
| 3 | A panel in the rxm view | Rejected by Q1 |
| 4 | Bundle the writer into `pkg/` | Rejected by Q4: about a fifth more on every first load, for a view off by default |

## §4 What the user sees

```
llvm                                                   ⋯  ✕
 i12:                                              ; preds = %i11
   %r6.v = load i64, ptr %r6, align 8
   store i64 %r6.v, ptr %a0, align 8
   br label %i13

▶i13:                                              ; preds = %i12      runs next
   %guard = call i64 @rt_enter(ptr %0)
   %trip = icmp ne i64 %guard, 0
   br i1 %trip, label %exit, label %cont

 i14:                                              ; preds = %cont
 ↺ ◀ ▶ ⏭ ⏵   step 36 of 69
```

- **The toggle.** `llvm`, after `clif` in the header's order and the grid's, on key `6`, off by default. Its tooltip's
  second line is the gloss (Q5). It is left out of the layout cycle's combinations as `clif` is
  (`arrangements.ts:95-96`).
- **The listing.** Every line as `llvmIr` gave it. A function's `define` heads it, drawn as a label, dimmed and bold as
  the clif view's function row is; every other line is a row, and a row with no pc is one nothing marks.
- **Following the run.** While the run can move, the first row of the instruction about to run (`RxmState.next`), its
  `i<pc>` label, reads *runs next*, and every row of that pc is marked current, its `cont` rows after `exit` too.
  Following keeps the `i<pc>` block in view, not the span to the `cont` block, which can be the whole function. Once the
  run has ended (`next` is `null`), no row is marked current and none reads *runs next*, and following keeps the
  `i<pc>` block of `RxmState.pc`, the instruction the run stopped on, in view. `main`'s rxm listing does the same since
  #214 (`rxm-pane.ts:177-179`), following `next ?? pc` with nothing marked, by the user's ruling that the end is only
  scrolled into view, which #214 wrote into the return-value design's non-goals
  (`2026-11-23-return-value-highlight-design.md`). A `pc` with no row follows nothing, as the rxm listing does when a
  fault leaves `pc` past the end of the code. A faulted run whose last frame keeps its `next` (#214's *What this did not
  close*) marks that instruction as running next, as the rxm view does there: the view draws the rxm leg's frames as
  they come.
- **The step bar** is the rxm leg's: the same step as every rxm view of the session, and the same buttons. The view
  counts as showing the rxm leg (Q2).
- **Links.** A click on a row with a pc links that rxm instruction, as a clif row does, and the rxm view marks that one
  instruction, not its construct's. A pin made elsewhere marks the rows of the pcs it covers: an rxm or clif pin's pc,
  and a construct's instructions otherwise. A click on a row with no pc links nothing.
- **With no rows.** The view says, in order: nothing while the rxm leg cannot run (its step bar says why);
  `Loading llvm…` until the package is in; `Writing llvm…` until the module comes; `llvm could not be loaded.` and
  `Retry` after a failed load, the button named `Retry loading llvm` for a reader and in its tooltip;
  `No llvm for this program: ` and the writer's reason for a refusal; and
  `llvm could not be written: the package stopped with an error.` for a trap. A module or a refusal already received is
  shown first.
- **Workspaces and links.** A stored workspace and a share link carry an `llvm` view as a leaf of its kind; it adds no
  position, since rxm's serves it.
- **Help.** The views paragraph names `llvm` with the gloss's words and links the writer's source,
  `crates/redextape-native/src/ll_text.rs`, on the repository's GitHub page; the keys table gains `6`.

## §5 The pure view (PR 2a)

`web/src/llvm-view.ts`, pure as `mc-view.ts` is, and `web/tests/node/llvm-view.test.ts`.

- **`llvmRows(ir)`** gives `ListingPanel.setSource`'s `{ listing, labels }`: each line an item, but each function's
  `define`, found by its `first_line` and not by its text, which is a label named by its line's index, before the item
  after it. Beside it: `lineOf`, each item's line; `pcOf(ordinal)`, an item's pc, `null` for a line with none or no such
  item, which is what a click links; `ordinalsOfPc(pc)`, a pc's items in listing order, `cont` items too, which the run
  and a pin mark; and `followOf(pc)`, the first item of the pc and the last of the items that follow it unbroken, its
  `i<pc>` block, which is what following keeps in view.
- **`LlvmAnswer`** is the module, the writer's refusal, or a trap, as `McAnswer` is.
- **`llvmNotice(load, answer, reason)`** and **`LLVM_COPY`** give §4's words in §4's order. `load` is a `ClifLoad`.
- **`types.ts`** re-exports `LlvmFunction`, `LlvmLine` and `LlvmListing`, and its header names the LLVM IR shapes among
  those that cross another package's boundary.

The node test runs a module written in the test, with a split pc and a `define` line no function names, and then every
example's module as `pkg-llvm/` writes it from `pkg/`'s `clifInput()`: the items and labels laid out reproduce the text,
and every line that starts `define ` is a function's `first_line`; each pc of the rxm program has
its items and an `i<pc>` block that `followOf` keeps whole; and each example's rxm run, stepped to its end through
`pkg/`, stands only on pcs with lines.

## §6 Web (PR 2b)

Line numbers are `main`'s at `9e7c493`; hidden-recording-b and move-a-view move many of them.

- **The kind.** `PaneKind` gains `'llvm'` (`panes.ts:15`); `KIND_ORDER`, `HEADER_ORDER`, `KIND_WORD` (`llvm`) and
  `DEFAULT_LEAF` (`layout.ts:67-117`), and `KIND_GLOSS` (`app-header.ts:329-337`) gain an entry; stored layouts validate
  against `KIND_ORDER` (`layout.ts:627`); `CYCLE` leaves it out (`arrangements.ts:95-96`); the view keys reach `6`.
- **The pane.** An `LlvmPane` built from `MachineViewChrome` and one `ListingPanel` with a label hook, drawing
  `RxmState` frames of the rxm leg; at the run's end it follows `RxmState.pc`'s block with no row marked (§4, *Following
  the run*), through `ListingPanel.show`. `PaneEntry` and `Binding` take a kind whose leg is another's (§9); `LegPane`
  and `PANE_BUILD` (`pane-host.ts:116`, `:298`) gain its class and builder, and `SEED` (`:276`) an entry that gives the
  pane the answer its session's store holds, or `null`: the `rebind` arm re-seeds a view picked onto another session
  through it (`:647-656`), and a pane told nothing would keep the previous session's module. Its title reads
  `llvm · program`; its title's menu offers an `llvm` pair for each session with an rxm leg and marks the view's own
  pair current, not the rxm one (§9). It has no display settings, so `LegDisplay` (`workspace.ts:113`) takes nothing.
- **Links.** `Pin.origin` and `InstrLeg` admit `'llvm'` (`link.ts:186`, `:189`), so `linkInstr` takes it as an origin.
  `LINKED` (`linked-legs.ts:39-119`) gains an `llvm` entry whose rows are the pin's pc for an rxm, clif or llvm pin and
  the construct's instructions otherwise; `LINKED.rxm.rows` takes an `llvm` pin's pc as it takes a clif pin's, and
  `LINKED.clif.rows` as it takes an rxm or clif pin's. `draw.ts:181-182` finds a pane's `LINKED` entry by its binding's
  leg, which for an `llvm` pane is `rxm` and would hand it out as an `RxmPane`; it finds it by the pane's kind instead.
  The status line walks `LINKED_LEGS` for its clauses (`link-status.ts:95-103`): the `llvm` entry's `emits` is `null`,
  as clif's is, since a construct has llvm lines exactly when it has rxm instructions, and its `here` clause is the
  builder's (§9).
- **The worker.** `llvm-load` and `llvm` requests and replies beside `mc-load` and `mc` (`protocol.ts:541`, `:547`,
  `:777`, `:783-791`); a `clifLoader` for `pkg-llvm/` with a literal `import()` (`session-worker.ts:151-162`, which the
  licence scan reads); `SessionClient` methods beside `machineCode` (`session-client.ts:157-166`); an answer store as
  `MachineCode` is, one answer per generation. While `clifInput()` is `null` an `llvm` request answers neither a module
  nor a refusal, since the rxm leg's reason, which its step bar shows, says why there is none; it never posts that
  reason as the writer's refusal, as `answerMc` posts it for machine code (`session-worker.ts:218-222`), because
  `llvmNotice` shows a refusal over the leg's reason.
- **Intent.** `watchIntent` on the `llvm` toggle, in the header and moved into the workspace menu (`main.ts:1510`).
- **Shown.** An `llvm` view counts as showing the rxm leg wherever hidden-recording-b asks whether a view shows it.
- **Words.** `help.html:49-63` and its keys table (`:124`); `help.html:54`'s "not … LLVM output" stays true of rxm,
  and the sentence naming what shows the row a run stopped on (`:61-62`) names the `llvm` listing too.

## §7 Order

1. PR 2a: this design, the plan, `llvm-view.ts` and its node test, on `llvm-ir-text` until #209 merged,
   then on `main`, at `860571d` and, once #214 merged, `9e7c493`.
2. PR 2b: §6, after hidden-recording-b and move-a-view merge, from the plan's tasks 4 on.

## §8 Verification

- **2a.** The node test over the written module and every example, each new test seen to fail with its code broken
  (the plan's Task 2 lists the sabotages); `tsc`; Biome; the comment guard.
- **2b.** Node: `arrangements.test.ts` and `app-header.test.ts` for the kind, `pages.test.ts` for the help page, layout
  validation and share links with an `llvm` leaf. Browser, modelled on the `clif-*`, `mc-*` and `view-title` tests: the
  view's title, its title's menu and a pick onto another session; no fetch on load or on another view; fetch on rest,
  press and focus; a failed load and Retry; a refusal, from a stubbed answer, since `fn llvm` writes a module once
  llvm-prefix-names lands; links both ways; following the run, `cont` rows marked, and its end in view with no row
  marked; a stored layout and a share link with the view; key `6`. The 12 browser tests and the harness that name
  `data-shows`, `KIND_ORDER` or `HEADER_ORDER` are each read for a sixth kind. Then Firefox.

## §9 Left to the builder

- How `PaneEntry` and `Binding` carry a kind whose frames are another leg's: a `leg` beside `kind`, or a map from kind
  to leg, provided `of('rxm')` never hands an `llvm` view out where an `RxmPane` is expected.
- How the pane's seed, its pick and its title take a kind whose leg is another's (line numbers `main`'s at `9e7c493`).
  `SEED` (`pane-host.ts:276`) is called with `entry.kind` (`:290-292`), and its one cast claims the pane is the class of
  the leg its kind names. The `rebind` arm (`:647-663`) takes a pick as one within the view when `choice.leg` is the
  binding's leg, and otherwise rebuilds the view as `choice.leg`'s kind (`:659`); a pick between an rxm and an `llvm`
  view of one session is between two kinds of one leg, so the arm compares kinds, and a pick of `llvm · …` builds an
  `llvm` view. The title's menu lists `PaneOption`s, `{ leg, id, label }` (`sessions.ts:182`), built by `pairs()`
  walking `LEGS` (`sessions.ts:418-424`); `pairLabel` names each `${LEG_NAME[o.leg]} · ${o.label}`
  (`view-header.ts:26-28`), `bindingKey` keys it by leg (`:124`), the current pair is the one whose `leg` is the
  binding's (`:125`, `:155`), and the `⋯` menu's *another view of this* splits off `{ kind: mine.leg }` (`:485-496`).
  All of it is typed by `Leg`, so while `PaneOption` keeps its `leg`, `tsc` says nothing, and an `llvm` view is titled
  `rxm · program`, marks the rxm pair current, offers no `llvm` pair and splits off an rxm view.
- How the link tables keyed by a leg take `llvm`, which is not one (line numbers `main`'s at `9e7c493`). `LinkedLeg`,
  `Exclude<Leg, 'lambda'>` (`linked-legs.ts:13`), keys `LINKED` (`:40`), `LINKED_LEGS` (`:121`), `perLinkedLeg`'s
  tables (`:124`) and the status line's `legs` (`link-status.ts:71`), so it widens past `Leg` to take `'llvm'`.
  `LINKED`'s `focusNode(frame: LegFrame[K], …)` (`linked-legs.ts:45`) needs a frame type for `llvm`, which
  `LegFrame` (`protocol.ts:290`) keys by leg and so lacks: the `llvm` entry's frame is `RxmState`, read as
  `LINKED.rxm.focusNode` reads it (`linked-legs.ts:56`). `LINKED`'s `pane(p: PaneEntry<Leg>)` (`linked-legs.ts:42`)
  takes whatever `PaneEntry` becomes, and `isLinkedLeg(leg: Leg)` (`linked-legs.ts:128`), which `draw.ts` asks of a
  binding's leg (`draw.ts:182`, `:192`, `:222`), takes a kind once `draw.ts` finds a pane's entry by its kind (§6
  *Links*). `tsc` names each of these once `LINKED` gains the entry.
- Whether the answer store is `MachineCode` widened or one of its own.
- Class names and the `ListingPanel` hooks the pane passes.
- The words of the `llvm` entry's `here` clause on the status line.

## §10 Designer's calls

Settled by the designer, not by the user; open to the user's correction:

- A `define` is a label, and every other line, blank lines too, is a row (§4, *The listing*).
- Following keeps the `i<pc>` block in view, not the span to its `cont` block (§4, *Following the run*).
- An answer already received is shown before the rxm leg's reason (§4, *With no rows*), as the clif listing's is.
- The view's own words use its toggle's word, `llvm`: `Loading llvm…`, `No llvm for this program: …`, as the clif view's
  say `clif`, and its Retry is named `Retry loading llvm`, for a reader and in its tooltip (§4, *With no rows*).
- `llvm` is left out of the layout cycle's combinations, as `clif` is.
- An `llvm` view's title reads `llvm · program`, and its title's menu offers an `llvm` pair for each session with an rxm
  leg, the view's own marked current (§6, *The pane*).
- The view lands in two PRs: 2a, the pure `llvm-view.ts` and its node test, and 2b, the rest of §6, once
  hidden-recording-b and move-a-view have merged (§3).
