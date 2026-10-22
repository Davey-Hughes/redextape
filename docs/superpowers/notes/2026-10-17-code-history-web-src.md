# Code history moved out of comments

Text moved verbatim out of code comments when they were trimmed to their why. Each entry names the file and the line of code the comment sat above.

## `web/scripts/licences.ts`, above `export const TOOLCHAIN: readonly { name: string; spdx: string; url: string; dir: string; c`

found by name in the unstripped `.wasm` wasm-pack builds first

## `web/src/app-header.ts`, above `export function toggleSentence(kind: PaneKind, count: number, state: 'shown' | 'hidden' | `

Written for one view, it said *hide the TM view* of a press that hid two, and *the TM view is the only one shown* with two TM views on screen and no other: a first load, `+ view` and *TM · program*, then the source view's `✕` (measured 2026-10-12).

## `web/src/app-header.ts`, above `export function viewToggles(`

They were built here, which is after the wasm has loaded, so they arrived in a header already painted. Measured at 1280 px in each style (2026-10-12): `+ view`, `copies`, `examples` and `encoding` each moved right by the group's width, 147.5 px in Paper, 149.1 in Terminal and 154.0 in Instrument, and in Terminal the header went from one row to two, 46 px to 91.

Measured with the attribute (2026-10-12): the λ toggle focused, then the keys that hide the source, asm and TM views, and `document.activeElement` was `<body>` as the third key returned.

## `web/src/app-header.ts`, above `export const NARROW_WINDOW_REM = 40`

With the rule at 30rem, or the query at 38rem, every test passed before those two.

## `web/src/appearance.ts`, above `export const STORAGE_KEY = 'redextape.appearance'`

observed in practice, with an unrelated app's preferences sitting alongside ours in the same origin.

## `web/src/base16-adjust.ts`, above `function nearestLightness(from: Oklch, ok: (hex: string) => boolean, scan: () => readonly `

`NIGHT`'s warning on black beside a `#aaaaaa` panel meets 3:1 on both only for lightness 0.4650 to 0.4655, and the walk lands on 0.4731 and 0.4631.

## `web/src/buffer-list.ts`, above `const handleTemperature = (id: SessionId, warm: boolean): void => {`

A delete used to dodge this by calling `menu.hidePopover()` first, so the popover's own hide algorithm handed focus back to the invoker when focus was inside it (`main.ts`'s `refreshBuffers` doc has that mechanism spelled out); spec §11 wants the next ROW instead, so `handleDelete` now stays open and places focus itself, exactly as this does.

## `web/src/buffer-list.ts`, above `return { id: row.id, el, retire, temperature }`

It was `items[0]?.querySelector('button')` — a value that could be missing in two different ways (no row, or a row with no button), needing `first !== null && first !== undefined` to narrow, where the second way cannot happen because this function builds the retire button three lines up.

## `web/src/buffer-list.ts`, above `const said = `${LEG_NAME[row.leg]} ${row.label}``

The word used to read `running` here, next to a halted copy's own `value: 42` that its run's own line already states — read by hand as the machine still executing when it was not (`asm copy 1 · not shown · running` at step 55 of 55).

## `web/src/colour.ts`, above `#resume = (): void => {`

The alternative measured was a task that runs ahead of other work: it landed the tree as soon as a parse in one go does, and through the parse no timer ran for 221 to 250 ms and no worker's reply was taken in for 206 to 232 ms, in three runs.

## `web/src/colour.ts`, above `export function colourPluginClass(opts: ColourOptions, now: () => number = () => performan`

with a key every 100 ms into 1,534,779 units whose parse was pending, the end of the text was coloured after 0 of 30 keys, and about 200 ms after the last.

after one character typed that measured 3.0 to 4.3 ms at 1,518,470 units and 13.4 to 15.1 ms at 6,072,644 (2026-10-06).

**THIS BRANCH PUT THOSE TWO IN SLICES AT FIRST, AND ITS REVIEW MEASURED WHY NOT TO**: the tree is gone while the slices run, and a screen past the first went plain, for 14 of 15 frames at 1,534,779 units on an idle page, where the parse in one go held the update for 164.4 ms with the screen coloured throughout.

## `web/src/colour.ts`, above `onCeiling: (id: LanguageId) => void`

**REQUIRED, AND IT WAS OPTIONAL UNTIL THE WHOLE-BRANCH REVIEW.** Declared, invoked as `opts.onCeiling?.(…)` and passed by NO caller, which meant a document over the ceiling went uncoloured in silence — the designed notice did not exist. Worse, the ceiling test still executed that line, so v8 recorded it covered while an optional call on `undefined` did nothing.

## `web/src/colour.ts`, above `export const FIRST_SCREEN_UNITS = 32_000`

A copy's editor mounts showing its first lines, and without this they stood plain until the whole parse landed, 757 to 969 ms after the click in three runs. With it they are coloured 190 to 255 ms after the click, where the parse in one go coloured them at 377 to 431 ms, in five runs of each taken in turn (2026-10-06). The first 6,048 units of the 1,518,470-unit machine, 130 lines, parsed in 0.70 ms, and gave the captures the whole tree gives over those units.

Of that machine, the first 20,064 units parsed in 2.20 ms and the first 64,040 in 6.80 ms.

31,995 units of one mnemonic repeated took 14.5 ms as asm, and of one bracket repeated 9.6 ms as TM and 9.8 ms as λ.

in 6 of 6 programs and λ terms cut so, the marks were the whole tree's.

## `web/src/colour.ts`, above `export const PARSE_SLICE_MS = 8`

**AN EDITOR'S FIRST PARSE RUNS IN SLICES OF THIS LENGTH, AND IT RAN IN ONE TASK UNTIL THE COPY OF A 7,353-STATE MACHINE HELD THE PAGE FOR IT.** That machine's text is 1,518,470 units: 7,353 states and 18,499 rules, a line each. Measured in Chromium on 2026-10-06, the machine copied while its program's run and then the copy's both record, five runs on each side taken in turn: in one go the parse took 194 to 208 ms, and from the editor's mount the page ran no timer for 232 to 249 ms and drew no frame for 216 to 232 ms; in slices no gap between two timers or two frames reached 100 ms, the parser's calls took 179 to 188 ms in all and the longest 8.1 to 9.0 ms, and the tree landed 720 to 860 ms after the click.

The update that carries a first slice measured 8.3 to 12.0 ms in five editors, the slice and the rest of the update, and 22.6 ms in the first editor a page mounted;

so one comment line of 3,000,000 units parsed in 57.2 ms without a callback.

16,095 times over that machine's text

That machine's two trees were compared node for node, 787,756 nodes, and were the same. On text with a mistake every 61 to 1,499 units a resumed parse recovered differently from a parse in one go, in each of the four grammars, and differently again with where its slices ended; with one mistake in a text of 0.55 to 1.5 million units, 0 of 8 sliced parses differed, in each of six cases.

## `web/src/colour.ts`, above `export function colourSpans(`

**2 × CODE UNITS, NOT UTF-8 BYTES — measured, because the two coincide on ASCII and that is the reading a 2× on an ASCII document invites.** `λab λcd` is 7 code units and 9 UTF-8 bytes, and its second `λ` starts at unit 4, byte 5. `endIndex: 8` — past that byte — still returns only the first capture; `endIndex: 14` (2 × 7) returns both.

(measured: `{startIndex: 0, endIndex: 0}` returns all 6 captures above, and `{startIndex: 10, endIndex: 0}` returns the 3 past unit 5)

**THE SORT IS NOT WHAT FIXES THAT, AND DELETING IT REDDENS NOTHING TODAY — MEASURED, AND SAID HERE RATHER THAN LEFT FOR SOMEONE TO REDISCOVER.**

## `web/src/colour.ts`, above `function editFor(`

which measured 8.1 ms at 103,028 units.

## `web/src/colour.ts`, above `export const COLOUR_CEILING_UNITS = 6_100_000`

a parse of a whole text of 6,072,644 units measured 614 to 673 ms, in slices 676 and 688 ms, and a reparse after one character typed 13.4 to 15.1 ms, in one go inside the keystroke's update (2026-10-06).

## `web/src/colour.ts`, above `/** The `TokenClass` names as they cross the wasm boundary, paired with their capture name`

**INDICES HERE ARE UTF-16 CODE UNITS, NOT BYTES, AND THAT IS MEASURED.** Parsing `(λx. λy. x)` — 11 UTF-16 units, 13 UTF-8 bytes — gives a root `endIndex` of 11.

Measured in Chromium on a 103,028-unit TM: a full reparse is 8.1 ms and an incremental one is 0.4 ms, so reparsing on every scroll would cost twenty times what it buys. **BOTH GROW WITH THE DOCUMENT**: at 1,518,470 units a parse of the whole text measured 154 to 179 ms and a reparse after one character 3.0 to 4.3 ms (2026-10-06).

The same document yields 32,591 captures whole and 293 for one viewport, and a 229,181-unit TM yields 82,464 against 897.

**THOSE TWO VIEWPORT FIGURES READ 88 AND 420 UNTIL THE DOUBLING ABOVE WAS FOUND**, because every probe behind them passed a code-unit count to an option that wanted twice one. They were corrected by re-measuring, not by scaling: the whole-document counts beside them pass no range at all and reproduce exactly, which is what pins the error to the range option rather than to the grammars.

## `web/src/compile.ts`, above `const client = sessions.entryOf(sourceSession).client`

**A SOURCE KEYSTROKE ENDS NO BUFFER, AND THIS IS WHERE THE CALL THAT ENDED ONE WAS DELETED —
5d-ii-c decision 2, design §4.3.** `schedule` used to call `scratchpad.retire(...)` on this line,
synchronously at dispatch: it terminated the buffer's worker and rebound every pane bound to it
back to `sourceSession`, so the pane came home on the keystroke that invalidated the buffer's
provenance rather than `DEBOUNCE_MS` plus a compile later. §4.3's table is the whole change —
"recompile from source: ended it -> **survives**" — and a scratch buffer is now an independent λ
session the user edits, which nothing but an explicit retire ends.

**IT WAS ALSO THE APP'S POISON RECOVERY, AND THE HEADER LIST HAS INHERITED THAT ROLE — design
§3.4 and §4.4.** 5d-i §4.3 made this call the recovery path on purpose ("the same mechanism as
poison recovery"), so a wedged buffer died on the next keystroke without the user ever learning it
was wedged. Removing it removed a safety mechanism, and **this paragraph read "until the header
list is mounted beside `reset layout` there is no way to reclaim a poisoned buffer at all"** while
`buffer-list.ts` was written, tested and imported by nobody. `main.ts` builds it now, beside
the workspace menu, and its delete is the escape — reachable whether or not a pane still shows the
buffer, which is why §4.4 put it in the header rather than in pane chrome. Recorded here rather
than only in a plan, because this file is where a reader asks what a recompile does to a buffer.

THREE MORE THINGS WENT WITH THE CALL, and all three existed only to serve it. The
`scratchpad.list().at(-1)` placeholder that picked WHICH buffer a keystroke ended — deliberately
visible in a caller that could not justify the choice, rather than hidden as a rule inside a
collection that has ids for everything else. The `reconcileEditors()` that had to leave no
`ScratchEditor` behind, mounted or in custody, for the session the retire killed. And the `draw()`
beside it, which repainted the panes the rebind had just moved. That particular call is gone, but
this path repaints regardless: `client.supersede()` below notifies the pool's `onSupersede`
callback, which is `() => draw()`, so a claimed generation reaches the panes synchronously on
every dispatch — this branch's control withdrawal included. The repaint just no longer comes from
a rebind; the source's own frames still arrive through `replies.ts` and drive their own.

## `web/src/compile.ts`, above `export function createCompile(deps: {`

**`links` LEFT WITH THE LAST REFUSAL CLEAR — Plan 7 part 2 spec §11.** `schedule` cleared
`link-wiring.ts`'s old fork-failure report on every keystroke; refusals are notices now, which time
out on their own, and nothing else here ever read the link state.

**FOUR DEPENDENCIES LEFT WITH THE RETIRE, AND THIS PARAGRAPH IS WHERE THEY USED TO BE ARGUED FOR.**
`scratchpad: ScratchBuffers`, `panes: PaneCollection`, `draw: () => void` and `reconcileEditors:
() => void` were all here to serve ONE branch — the retire a source keystroke used to perform — and
5d-ii-c decision 2 deletes it; `schedule`'s own comment has that argument and the gap it opens.
Nothing else in this file ever read them, because a compile is a `supersede` and a `request` against
the source session's own client and nothing more. What stood here justified handing `retire`
`panes.all().map((p) => p.slot)` rather than the literal `[lambdaSlot, tmSlot]` (T7) — **and the
sibling call this pointed at, "`replies.ts` makes the identical conversion for the sibling call in
`noSessionReply`", is gone too**: the next task took the retire out of that arm as well, so neither
file passes slots to anything any more. `replies.ts`'s own `no-session` arm records what went with it.

`tmPane` WAS PART OF THE SPECIFIED SIGNATURE AND IS NOT HERE, and no pane of any leg is here now. `schedule`
never read it — the only pane this file ever touched was `setEditor(null)` on the branch where a
scratchpad retired, and that branch is gone; the TM leg never had a scratchpad to reflect and nothing
in this file's moved body ever mentioned a TM pane. Grepping the moved code for it turns up nothing.

**THE EDITOR SWEEP AND THE FINDING BEHIND IT ARE RECORDED WHERE THE SWEEP STILL HAPPENS, NOT HERE.**
This file took `reconcileEditors: () => void` — and, before that, a narrow `editorHome: () =>
LambdaPane | undefined` thunk it called `setEditor(null)` through — because a retire must leave no
`ScratchEditor` behind for a session that no longer exists, including one in CUSTODY
(`editor-custody.ts`'s `heldEditors`, where a closed pane's editor waits) which the narrow thunk could
not reach at all. Both spellings went with the retire. The account of that IMPORTANT finding, and of
the third round's correction to it — the sweep visited the sessions `editorOwner` named, so a custody
entry with no CLAIM against it stayed invisible until `heldEditors` became its own domain — lives in
`editor-custody.ts`'s `reconcileEditors`. **THIS SENTENCE ALSO NAMED "`replies.ts`'s call site, which
is the app's remaining retire path", AND THAT PATH IS GONE TOO**: the task after this one removed that
arm's retire and its `reconcileEditors` dependency with it. The sweep is called from `applyLayout`, on
every layout gesture, and from `main.ts`'s header-list retire handler, which is the one place in
`src/` that ends a buffer (design §4.2/§4.4). (Written without the arity it opened with — "the sweep
has two callers now" — for the reason this slice has now applied twice elsewhere: a count is the part
of a sentence that rots first, and naming both callers says strictly more.)

## `web/src/controls.ts`, above `export function canRecordFurther(done: RecordEnd | null, awaitingRun: boolean): boolean {`

Established by READING the code, not by
running anything: the sabotage aimed at this gate reddens nothing, which is how the reachability
question came to be asked at all.

## `web/src/copy-editor.ts`, above `#refreshDetach(): void {`

**`!this.#detached` GATES PRESENCE, AND ITS ABSENCE WAS THE WHOLE BUG.** `setForkAvailable` alone cannot express
"this view's OWN session just became the thing it would fork" — that fact arrives through `setDetached`, driven
every frame by `PaneSlot.render` regardless of which session the view is bound to, which is exactly why it is the
one call `LambdaPane`'s own `#refreshDetach` checks first. Left out (as it shipped), the TM view's control kept
whatever rules and text the SOURCE session last reported, forever, on a view that had since rebound onto its own
new copy — the button stayed present and enabled, and a second click reached `transport.ts`'s fork handler with
no text (a copy's own `tmProgram.tmText` is always `null`, `replies.ts`'s `tm-scratch-compiled` arm builds it that
way) and threw. The rule this enforces: A VIEW ALREADY SHOWING A COPY HAS NOTHING LEFT TO COPY.

**`this.#forkText !== null || !this.#resultDecodable || this.#count > 0` IS WHETHER THE CONTROL SHOWS AT ALL —
widened from a bare `count > 0`, Minor fix in the same round; widened again this round to add
`!this.#resultDecodable` (below).**

**`#resultDecodable` IS CHECKED BEFORE `#count` CAN MAKE THE CONTROL ABSENT — fixed this round; it used to be
the other way around, and that was the bug.** The absence check used to be `#forkText === null && #count === 0`
on its own, on the assumption that a `null` text with a zero count could only be a declined leg (no `TmProgram`
at all, where `#count` defaults to `0` — `replies.ts`'s `storeAndSetProgram`). It cannot be assumed: `#count` is
`ruleCount(program)` (`protocol.ts`), a real machine's own rule count, and this file's `#resultDecodable` doc
already said a function-valued program sits well within `MAX_FORK_RULES` — nothing about being function-valued
keeps ITS machine's rule count from being zero too. Measured against every small function-valued program tried
(`|x| x`, `|x| x + 1`, a let-bound function, a two-argument curry): each compiles to a real, non-zero machine
today (135 or 204 δ rules) — but that is this compiler's current lowering, not a guarantee `#refreshDetach` may
lean on, and the umbrella's §4 rule does not have an exception for "not reachable yet". A zero-rule
function-valued program hit the identical `null`/`0` shape a declined leg does and the control vanished instead
of disabling with its reason — the wrong one of the umbrella's two outcomes for a control that could apply but
cannot right now. Checking `!#resultDecodable` first decides the function-valued case by the fact that actually
distinguishes it (the result type), before the absence check — which knows nothing about result types — ever
runs.

## `web/src/copy-editor.ts`, above `setDetached(detached: boolean): void {`

**AN EDITOR CANNOT OUTLIVE `#detached` — Important finding, review of the TM view's editor.**
`LambdaPane.setDetached`'s own doc records the same line and the defect that made it necessary: driving the app in
a browser, picking `source` in a forked view's selector dropped the `[detached]` badge and repainted the body from
the newly-bound leg, but left a live `contenteditable` editor mounted on the copy the view had just left.

## `web/src/copy-editor.ts`, above `takeEditor(): ScratchEditor | null {`

**NO `onUnmount`, WHERE A TAKE USED TO CALL IT — the TM view's status clear.** A take stood for the view leaving
the copy, and the view stopped describing a copy it no longer showed. It stands for nothing of the kind now: a
view leaving its copy destroys its editor through `pane-host.ts`, which then tells the view what the session it
moves onto holds, and a view that gives its editor to another view of the copy through *move the editor here*
(custody's `reconcileEditors`) still shows the copy — clearing its status there blanked the value line of a view
still showing the copy's run.

## `web/src/diagnostics.ts`, above `export function lspLintRanges(ds: LspDiagnostic[], doc: Text): LintRange[] {`

**THE ZERO-WIDTH CASE IS STILL THE COMMON ONE, AND THE WIDENING SURVIVES THE MOVE OFF BYTES.**
A zero-width range is not an edge case: driven against the real server, ten of fifteen broken
programs produce at least one. `let x = ` reports `0:8-0:8` twice. CodeMirror renders nothing at
all for `from === to`, so the marker would silently not appear on some of the most likely broken
programs there are. That is a property of CodeMirror rather than of the offsets, which is why
the byte arithmetic this replaced could go and this could not.

## `web/src/draw.ts`, above `const onProgram = (e: { readonly slot: { readonly binding: { readonly session: SessionId }`

"THE" λ, ASM AND TM PANES, RESOLVED THROUGH THE COLLECTION RATHER THAN CLOSED OVER — AND ANY MAY
BE ABSENT. This block used to destructure `of(leg)[0]` and throw when it came back `undefined`,
on the strength of "`main.ts` always registers one pane of each leg before `draw` can be called".
That was true while panes were two consts and false from the moment `applyLayout` began deriving
them from the layout tree: `closeLeaf` refuses only the last leaf in the TREE, so `leaves() > 1`
offered `close` on the single λ pane a fresh page then shipped, and clicking it left this throwing on
every subsequent frame. Worse, `applyLayout` persists the new tree BEFORE calling `draw()`, so
the λ-less arrangement was already committed to `localStorage` and the dead app came back on
reload — only `reset preset` escaped it. `PaneCollection.active` is now the one place that
answers this question, and it answers `undefined` when the leg is empty; see its own doc for why
all four consumers were once holding the same expired invariant privately, and for how it now
picks among several panes on the same leg — the pane the user focused most recently, falling back
to insertion order (5d-ii-b).

**EACH LEG'S RUNNING FOCUS IS THE PROGRAM'S, SO IT IS READ OFF A VIEW OF THE PROGRAM — `onProgram`.** It
resolves against the program's link index and marks the program's rows, and a copy's frames own no construct
of the program's. Read off whichever view was focused last, it went blank the moment that view showed a copy:
the program's own view lost its marks, in Stage even while it was the view shown and being stepped.

## `web/src/draw.ts`, above `export function createDraw(deps: {`

`panes: PaneCollection` REPLACES `lambdaSlot`/`tmSlot`/`lambdaPane`/`tmPane` (T7). No longer "still
two panes, still the same two hosts" as of T12 (5d-ii-a): `pane-host.ts`'s `applyLayout` derives which
panes exist from the layout tree, so a leg can now hold any number of panes — only the route to them
(through the collection rather than a fixed pair of consts) stayed the same.

## `web/src/editor-custody.ts`, above `if (p.slot.binding.session !== session) continue`

**THE PANE'S OWN BINDING IS THE PREDICATE THAT SAYS WHOSE EDITOR IT COULD BE HOLDING, AND
WITHOUT IT THIS LOOP HANDED ONE BUFFER'S EDITOR TO ANOTHER BUFFER'S HOME** — Important
finding, review of tasks 1+2 as a unit. A `LambdaPane` does not record which session's editor
it has, so this loop asked EVERY λ pane and gave whatever came back to `home`; that was
equivalent to what the sweep means ("S's editor lives on `home(S)`") only while the app could
hold one scratch editor at a time. 5d-i's singleton produced that by accident rather than by
design — a second fork REBOUND to the existing scratch, so `claim` overwrote one entry instead
of adding a second and no second `scratch-compiled` fired — and a fork that mints its own
buffer (5d-ii-c decision 1) makes two mounted editors ordinary. Five gestures reach it: fork,
split, rebind the new pane to source, fork it, then any layout gesture at all.

## `web/src/editor-custody.ts`, above `if (!sessions.has(session)) {`

**A CLAIM FOR A SESSION THAT NO LONGER EXISTS IS DROPPED HERE, AND WITHOUT THIS LINE ONE
BUFFER'S RETIREMENT DESTROYED ANOTHER BUFFER'S LIVE EDITOR.** Nothing else ever erases an entry
for a retired session: `dropClaimsOn` is keyed by LEAF and only fires for a leaf arriving
without a pane, so a claim whose pane simply stayed put outlives the session it names forever.
Without this line `editorHomeFor` answers `undefined` for the dead session, and the loop below
then takes the editor off EVERY λ pane and destroys it — including one a later fork has
legitimately mounted for a different buffer, since a fork mints a fresh id per call (5d-ii-c
decision 1) rather than re-registering one key.

## `web/src/editor-custody.ts`, above `const reconcileEditors = (): void => {`

**THE `heldEditors` ENTRY IS DROPPED AFTER A SUCCESSFUL MOUNT, NEVER BEFORE — the leak half of the
third round's finding.** `heldEditors.delete(session)` used to run on the line ABOVE
`home.receiveEditor(waiting)`, so the throw that (2) exists to raise dropped the app's LAST
reference to a live `EditorView` — with its own pending debounce — before the call that would have
given it a new home. An invariant violation left the editor unrecoverable, which is the one outcome
a guard must not have; deleting after the mount leaves the entry exactly where the next
`reconcileEditors` can find it again.

## `web/src/editor-custody.ts`, above `return entry.pane as unknown as EditablePane`

**THE CAST GOES THROUGH `unknown`, WHERE IT USED TO READ `as LambdaPane` DIRECTLY — T7's
widening.** `LambdaPane` was a subtype of `entry.pane`'s own type, `PaneView<LambdaState>`, so TS
accepted that narrowing on its own; `EditablePane` shares no member with `PaneView<LegFrame[Leg]>`
at all, so the same narrowing needs the `unknown` step to say "trust this" rather than "this is
safely narrower". What has to be trusted is unchanged: THE ENTRY IS CHECKED FOR ITS SESSION AND
NOT ITS KIND — SOUND, BUT ON TWO FACTS THAT ARE WORTH WRITING DOWN NOW THAT A PANE CAN CHANGE LEG.
A `LeafId` naming a `LambdaPane` when the claim was recorded can name a `TmPane` afterwards
(`pane-host.ts`'s `paneEvents.rebind`, cross-leg arm), and this cast would then hand `receiveEditor`
a pane that does not implement it.

(2) USED TO CATCH IT ANYWAY, WHILE ONLY A λ SCRATCH COULD EVER BE CLAIMED — no longer the whole
story since a TM copy got an editor of its own: `pane-host.ts`'s `claiming` wraps `detachMachine`
(and `detachAsm`) to claim a TM or asm copy's session the same way it wraps `detach` for a λ one's,
so a key in `editorOwner` can now name a machine-legged scratch. `SessionRegistry.pairs()` DOES
offer a TM pair for that session — the machine fork's own copy — so a `<select>` CAN produce a TM
slot bound to exactly the session a claim names, and a pane under a claimed id that has become a
`TmPane` is no longer guaranteed to be bound to some OTHER session the way it was while every
claimed session was λ-only.

(1) IS THEREFORE THE FACT THIS CAST ACTUALLY RESTS ON NOW, NOT "EITHER FACT ALONE" — this
paragraph used to end "(1) is the one that holds if a TM-legged scratch ever exists." It has.

## `web/src/editor-custody.ts`, above `export type EditorCustody = {`

WHERE EVERY SCRATCH `ScratchEditor` IS AND WHERE IT BELONGS — the cluster `main.ts` held as two `Map`s
and two closures visible to a thousand lines.

`editorOwner` and `heldEditors` (inside the factory below) are one fact in two containers: which pane
each session's editor is claimed by, and where an editor waits while no pane holds it. **NEITHER MAP
LEAVES THIS MODULE, AND THAT IS THE WHOLE POINT OF THE EXTRACTION RATHER THAN A HOUSEKEEPING
PREFERENCE.** Every one of the three review rounds recorded in the doc comments below was a question
about WHICH DOMAIN A LOOP RAN OVER — a custody entry outliving its session, a re-minted leaf id
inheriting a claim, and a sweep whose loop could not reach what `reset preset` had orphaned — and a
`Map` any of `main()`'s lines can iterate is a `Map` any of them can iterate over the wrong domain.
The five members below are the entire surface those call sites actually used: two writes, one erase,
one read, and the sweep.

## `web/src/editor-keymap.ts`, above `export const keymapSlot = (mode: KeymapMode): Extension => keymapCompartment.of(keymapExte`

**WHAT THAT COSTS, MEASURED IN CHROMIUM RATHER THAN REASONED ABOUT, BECAUSE THE FIRST GUESS AT IT
WAS WRONG.** The obvious candidate was `Escape`, which `defaultKeymap` binds to `simplifySelection`
— and it cannot show the difference either way: with an empty selection that command declines and
passes the key on, and with a selection it collapses it, which vim's own `update` hook reads as a
selection change and leaves visual mode for. The keys that DO show it are the ones `defaultKeymap`
binds to an EDIT. With the slot below the first `keymap.of(...)`, caret at offset 1 of `abc\ndef`:
`Enter` produced `a\nbc\ndef` and `Backspace` produced `bc\ndef` — a normal-mode motion typing into
the document — against an unchanged document and a moved cursor with the slot above. A spy binding
placed first in the list confirms the mechanism directly: it sees `Escape` and vim never does.

## `web/src/editor-prefs.ts`, above `export function parseKeymapMode(value: string): KeymapMode {`

**IT SAID "THE SAME FALLBACK `readKeymap` APPLIES, REUSED" WHILE THE TWO SHARED NO CODE.** `readKeymap`
spelled `=== 'vim'` out, which is the drift `KEYMAP_MODES` exists to prevent — harmless with two modes
and wrong the moment there is a third, since a stored `'emacs'` would fall back here and be accepted
there. Now the sentence is true because there is one narrowing.

## `web/src/highlight.ts`, above `/** The source range a backend's refusal names, or `null` to clear it. */`

THE THREE MARKS, AND THE `highlighting` FIELD THAT USED TO SIT ABOVE THEM IS GONE.

It was a `StateField` fed a `setSpans` effect carrying `classify_source`'s byte-offset spans, pushed
from `main.ts`'s update listener in the same frame as every keystroke. Plan 7 part 3b replaced it
with `colour.ts`'s `treeSitterColour` — a `ViewPlugin` over a committed tree-sitter grammar, which
needs no effect because it reads the same `ViewUpdate` the editor already hands it, and which serves
the λ, asm and TM copies as well as this one. One mechanism across four languages, at the cost of the
synchrony: a grammar arrives over a fetch, so the first frame after a mount is uncoloured.

## `web/src/history.ts`, above `#evict(): void {`

A ring that held only the budget dropped the first frames of the very
recording that filled it — two of the 75,025 a TM leg recorded (`HISTORY_BYTES`'s doc) — so a run that opens on
step 0 would have opened on step 2.

## `web/src/history.ts`, above `export class History<T> {`

THE BUDGET IS BYTES, NOT FRAMES, and that is measured rather than tasteful. `frame_cost_probe`
found a λ frame ranging from ~5 KB to 781 KB across nine programs, so "keep 1,000 frames" is a
memory policy spanning three orders of magnitude depending on what the user typed.

It used to
`shift` both arrays. V8 trims a small array in place, but on one as large as a full TM history a
`shift` moves every element: a node bench (2026-10-05) put a push and a `shift` at 0.08 to 0.30 µs with
1,000 to 10,000 kept and at 1.76 to 46.95 µs from 16,000 up. One *keep recording* on `map and fold`
pushes 22,777 frames onto its full TM ring, from step 69,008 to the halt at 91,785, and at
`CPUQuota=25%` CPU profiles of the page put 7,397.5 and 9,347.7 ms of that press's 10,899 and
13,467 ms in `#evict` (2026-10-05, at `53ecbfa`). The page handled the worker's chunks back
to back and ran no timer for up to 12.2 s. Since, in three interleaved runs at 25 %, no two of the
press's polls came more than 601 ms apart, where they had come 7,604 to 8,288 ms apart.

## `web/src/lambda-body.ts`, above `if (resized) this.#follow.onResize(this.el.scrollTop)`

a body following at 602 px came back
to a Stage tab at 162, the redex's place, and its `scroll` read as the user's.

## `web/src/lambda-body.ts`, above `if (this.el.clientHeight !== this.#drawnHeight) this.#follow.onResize(this.el.scrollTop)`

measured in the built app, a window grown from
600 to 1000 px tall clamped a body following a redex at its term's end from 400 to 160, and the clamp read as
the user's scroll detached it.

## `web/src/lambda-layout.ts`, above `export function codeLines(t: Tree, o: LayoutOptions): Line[] {`

a walk that recursed once per open level overflowed the call stack on `2990 + 0` one step from its end, a legal program.

## `web/src/lambda-pane.ts`, above `setDetached(detached: boolean): void {`

**AN EDITOR CANNOT OUTLIVE `#detached`, AND THIS IS WHERE THAT IS ENFORCED — IMPORTANT finding, whole-branch review before merge.** `setEditor` used to be reachable from exactly two places in `main.ts` (the scratch's first build, and recompile-from-source's retire), and this method — the one `PaneSlot.render` actually calls every frame — was not one of them. So the THIRD way a pane stops being detached, the binding selector, unmounted nothing: picking `source` in a forked λ pane's selector dropped the `[detached]` badge and repainted `#text` from the newly-bound leg, but left `#editor` mounted on the scratch it had just left — a text input whose keystrokes reached a session no longer on screen, which is exactly `pane-chrome.ts`'s "a control that provably cannot work should not be presented as though it might" turned inside out (the control LOOKED live and quietly wasn't). Rather than add a third external call site `main.ts` would have to remember at every future exit — the fix the review rejected — the invariant lives here instead: an editor can only be showing while its pane is detached, so the one setter that reports `#detached` is the one place that tears it down, and no future way of leaving `#detached` needs its own reminder.

**ONE DID: A VIEW THAT IS NOT ON THE PAGE.** `PaneSlot.render` calls this every frame for a view that is drawn, and `draw()` passes over a Stage tab that is not selected and a view a switch parked. One that a pause or a delete moved onto the program was told nothing, and went on holding the editor of a copy it no longer showed. `pane-host.ts`'s `reseedingSlots` calls this as it moves such a view (the view layouts spec §5.5).

## `web/src/lambda-pane.ts`, above `this.#editor = editor`

**THE EDITS STAY WITH THE COPY, AND NOTHING HERE TOUCHES THEM.** A claimed editor once went on reporting through the pane that built it, whose handler read that pane's binding when an edit fired — so the instant that pane was rebound elsewhere, keystrokes in the moved editor recompiled whatever IT was showing, found by driving the app. This line re-pointed the editor's handler at this pane, which fixed that and left typing still pending when THIS pane moved on going to the copy it moved to. The editor's sink is now bound to its copy when it is built (`PaneEvents.editSink`), and this pane shows that same copy, so there is nothing to re-point.

## `web/src/lambda-pane.ts`, above `receiveEditor(editor: ScratchEditor, collapsed = false): void {`

**IT THROWS ON A PANE THAT ALREADY HOLDS ONE, AND THE UNCONDITIONAL OVERWRITE IT REPLACES IS HALF OF AN IMPORTANT FINDING (re-review of the whole-branch review's own custody fix).** Assigning `#editor` over a live value dropped the only reference to the previous view WITHOUT removing its node: the pane went on rendering two `.cm-editor`s stacked in one host, `#editor` named whichever arrived last, and the other was unreachable for `setEditor`, `takeEditor` and `destroy` alike — design §4.3's "two uncoordinated CodeMirror instances over one buffer", reached by the very mechanism §4.3 introduces to make it impossible. `editor-custody.ts`'s `reconcileEditors` is what must never ask for that; this is the check that the invariant is a fact rather than an argument.

**`collapsed` SEEDS THIS MOUNT TOO, AND UNTIL THIS FIX IT DID NOT — Important finding, review of 5d-ii-d T9.** This is the OTHER mount — the one custody's own sweep and custody passes use (`editor-custody.ts`'s `reconcileEditors`), not the one a fresh build takes — and it was seeded nowhere: the host's class was written unconditionally and `#collapse.update(true)` ran with `initial` defaulting to `false`, so a collapsed buffer claimed onto another pane, or re-claimed out of custody after its holder closed, remounted EXPANDED. Nothing in either sweep pass calls `on.collapse`, so `redextape.buffers` went on reading the buffer as collapsed while the screen showed otherwise, and the next reload silently collapsed what the user had just expanded by moving it. `editor-custody.ts`'s two `receiveEditor` call sites now read the buffer's own flag through the `collapsedOf` reader threaded into `createEditorCustody` for exactly this call, the same way `replies.ts`'s `scratch-compiled` arm already does for `setEditor`.

## `web/src/lambda-pane.ts`, above `editor.dom.remove()`

**THE NODE LEAVES TOO, AND FOR TWO CALLERS IT NEVER USED TO HAVE TO — found by driving the app in a browser, which is the only thing that could have found it.** This method dropped the reference and stripped the host's class and left `editor.dom` parented where it was, because both original callers made that invisible: `applyLayout`'s drop loop takes the whole host out of the document with the pane, and `reconcileEditors`' sweep hands the view straight to `receiveEditor`, whose `append` RELOCATES the node. The `rebind` handover in `pane-host.ts` is the first caller where the pane SURVIVES and nothing re-parents — and without this line the view stayed mounted, visible and `contenteditable`, in a pane now bound to a different buffer, with only the `.term-editor` class gone. Measured in Chromium: 458x44 px, showing the OLD buffer's term, accepting keystrokes.

## `web/src/lambda-pane.ts`, above `#unlaid: Tree | null = null`

A layout that overflowed on a deep term left it in `#treeFor`; `render` redraws before `renderTree` can replace it, so every later frame threw inside `draw()` and the view never drew another tree, even after a recompile.

## `web/src/lambda-pane.ts`, above `export class LambdaPane implements EditablePane {`

`frame_cost_probe` measured a history frame's budget at 512 bytes, two orders below the readout's

## `web/src/lambda-tree.ts`, above `key(i: number): string {`

walking to the root for each cost the path's depth per node, which on a path thousands deep was most of a layout's time.

## `web/src/layout-view.ts`, above `export function retitleStage(root: HTMLElement, title: (id: LeafId) => string): void {`

so the tab went on naming what the view used to show until another tab was selected — on every leg.

## `web/src/layout-view.ts`, above `const focusAt = (i: number): void => {`

**A ROVING `tabindex` HAS TO ROVE, WHICH THIS DID NOT.** The tabs were built with `tabIndex = selected ? 0 : -1` and nothing updated it, so arrowing to a tab left the strip's single tab stop on the tab that was still SELECTED. `Tab` out and `Shift+Tab` back then returned to a different tab than the one the user had arrowed to — exactly the condition the pattern exists to prevent.

## `web/src/layout-view.ts`, above `export function syncSizes(root: HTMLElement, tree: LayoutNode): void {`

Measured before this function existed: a drag moved exactly one `pointermove`'s worth and then stopped. Design §1 carries the transcript.

## `web/src/layout-view.ts`, above `const focused = root.contains(document.activeElement) ? document.activeElement : null`

THE DIVIDER A KEYBOARD USER IS FOCUSED ON DOES NOT SURVIVE `replaceChildren()` — UNLIKE A HOST, IT IS REBUILT FROM SCRATCH EVERY CALL. A RESIZE FRAME NO LONGER REBUILDS ANYTHING — `syncSizes` writes the new fractions onto the elements that are already there, precisely so the FRAMES of a gesture do not destroy the control performing them. WHAT STILL REBUILDS IS EVERY GESTURE'S COMMIT, AND THAT INCLUDES AN ORDINARY RESIZE, NOT ONLY A STRUCTURAL CHANGE. `handlers.commit` (`pane-host.ts`'s `applyLayout`) calls `renderLayout` unconditionally from its `finally` block on every call it makes — a drag's `pointerup`, a keyboard gesture's `keyup`/`blur`, a split, a close, `reset preset`, a restore all reach it the same way — so a resize still rebuilds the whole tree once, at the moment the gesture ends; it merely does so once per GESTURE now instead of once per FRAME. This rescue is what keeps a keyboard user's place across every one of those rebuilds, resize's own commit included, and it used to be what kept the arrow keys working at all — without it the FIRST arrow-key press moved the divider, destroyed the element focus was sitting on, and dropped focus to `<body>`, so the second press did nothing. A single FRAME no longer has that failure mode, but the `keyup` COMMIT still does: the divider the user was holding down is destroyed and rebuilt exactly like a structural change would destroy it, and this rescue is what a `keyup` finds waiting to restore focus onto its replacement.

## `web/src/layout.ts`, above `export function addRefusal(`

It was held only along the axis the add divides — the controller's brief said so, and that was the error — so a split down of a view already under 160 px wide made a second view as narrow, unrefused: a view dragged to 152.16 px, split down, gave two of 152.16 × 172.375 (the re-review's probe, 2026-10-04).

## `web/src/layout.ts`, above `export function leafExtents(root: LayoutNode, area: Extent, gap: number): Map<LeafId, Exte`

Measured at 1280×800 with no notice up, `#views` is 1280×725.5 px and each default view 634×356.75, which is what this answers for that area.

(the review's probe, within 0.012 px in nested layouts)

## `web/src/layout.ts`, above `export const MIN_VIEW_PX = 160`

`+ view` pressed in a row at 1280 wide took the newest view to 0 px, each press a half of the last, and no floor on a fraction of a split refuses a half.

## `web/src/layout.ts`, above `export const MAX_TREE_LEAVES = 64`

**A LINK BROUGHT TREES THE STORE NEVER HAD.** A link of 2,034 characters held 400 λ views, which took 4.4 s to open and were stored, so every later load built them again.

## `web/src/layout.ts`, above `const MAX_TREE_DEPTH = 64`

Unbounded, the recursion threw `RangeError` at 6,000 splits deep, on a link of 25,011 characters.

## `web/src/layout.ts`, above `export function resize(root: LayoutNode, path: number[], index: number, delta: number): La`

In a row of 11 to 19 the clamp took the first neighbour to the floor whichever way the divider was dragged, shares of 0.1 and 0.0818 in a row of 11, and then moved neither again. In a row of 20 that left the second a share of nothing, and in one of 21 less than nothing, 0.1 and −0.0048: each a tree `parseTree` refuses, so the next load threw the workspace away.

## `web/src/layout.ts`, above `export function insertBeside(root: LayoutNode, id: LeafId, dir: Dir, newId: LeafId, kind: `

**IT TAKES AN EQUAL SHARE OF THE ROW, WHERE IT USED TO HALVE THE VIEW** (the user's decision, 2026-10-04). It wrapped the view in a new split at `[0.5, 0.5]` as a split does, and a new view takes the focus, so each press halved the view the last one made: at 1280×800 the newest λ view measured 311, 149.5, 68.8, 28.4, 8.2 and then 0 px, and each press nested the tree one split deeper.

## `web/src/layout.ts`, above `export function defaultLayout(shape: Shape): LayoutNode {`

While it defaulted to `wide`, *reset preset* with its measurement dropped built a row in a tall window and every test passed.

## `web/src/layout.ts`, above `export function defaultArrangement(kinds: readonly PaneKind[], shape: Shape): LayoutNode {`

It was a column of rows, whose one horizontal divider moved both sides together, and whose third view lay across the whole width.

## `web/src/layout.ts`, above `export const MIN_PANE_FRACTION = 0.1`

MEASURED 2026-08-18 (`pnpm test:probe:floor`, `tests/browser/pane-floor.test.ts`), not merely chosen — 5d-iv T6. The first pass of that task drove only the source/λ (row, WIDTH) divider and read `clipped` off the wrong element; both gaps were found by the probe's own author and fixed the same day, so the table below is the RE-MEASURED reading, not the original one. The probe mounts the real app at three imposed window SIZES (width and height both — a height floor read against an unconstrained container height is the same fiction an unmeasured width would be) and drags BOTH dividers hard past the floor: source/λ (row split) for width, and the row-of-source-and-λ / TM (column split, root) for height. `resize`'s clamp lands each drag exactly on 0.1.

| window | source | λ (unforked) | tm, full width | tm, at its OWN (height) floor |
| --- | --- | --- | --- | --- |
| 900x600   | 89px, overflow 2.28x  | 799px, overflow n/a  | 900px, overflow 1.00x  | 59px, overflow 11.46x |
| 1200x800  | 119px, overflow 1.71x | 1069px, overflow n/a | 1200px, overflow 1.00x | 79px, overflow 8.56x  |
| 1920x1080 | 191px, overflow 1.06x | 1717px, overflow n/a | 1920px, overflow 1.00x | 107px, overflow 6.32x |

`overflow` IS A RATIO (inner content extent ÷ box extent), not the boolean the first pass printed. That boolean read the `[data-leaf]` PANE element's own `scrollWidth`/`clientWidth`, which never differs no matter how hard the pane is squeezed — CodeMirror's `.cm-scroller` and TM's `.cells` absorb all the real overflow one level in, so the boolean was `false` at every width regardless, which is worse than not measuring: a reader would take it as reassurance it never earned. The ratio measures the scroller that actually overflows. `source`'s three figures agree on ~203px of content (`let x = 40; x + 2`, `.cm-scroller`'s `white-space: pre`) squeezed into a shrinking box — the "about four characters, scroll for the rest" state this doc predicted before anything was measured, confirmed rather than contradicted. `tm, full width` is not a floor reading (only the height drag touches TM) — its 1.00x is just "not squeezed," included for contrast with the last column.

0.1 STANDS FOR WIDTH. `source`'s editor keeps mounting and running at the floor at all three widths — nothing destroyed or hidden, only scrolled. λ's DEFAULT view is `.term`, a plain element with `white-space: pre-wrap` — not a `ScratchEditor` at all, so it wraps instead of overflowing horizontally and `overflow=n/a` above is a real absence of a `.cm-scroller`, not a probe gap. λ only gains `source`'s editor machinery, and by extension `source`'s measured floor behaviour, once forked into a scratch buffer — a state this reading still does not exercise directly, so that half remains inference by symmetry rather than a direct measurement.

0.1 DID NOT STAND FOR TM's HEIGHT WHEN THIS WAS MEASURED, AND THAT WAS A FINDING, NOT A FIX. At every size TM's own content was 6-11x taller than the box the drag left it — the `[data-leaf="tm-0"]` pane's `overflow: auto` genuinely fired here (unlike the width case above), because `.state-table`'s cap was then `max-height: 40vh`, relative to the BROWSER'S viewport, not to this pane. A divider drag does not resize the browser window, so shrinking TM's allocated share of the split does nothing to that cap — the δ-table (open by default, since `createPanel`'s `open` option defaults to `true`) stays whatever size the WINDOW allows regardless of how little SPACE the pane itself was just given. This is a shape mismatch between two different boxes a CSS unit was written against, not a wrong constant — no fraction near 0.1 closes it, since the content driving the overflow does not shrink as the fraction does. Per design §9 this module does not become the place a pixel fix would live even if one were made; this is flagged as a design question (does `.state-table`'s cap want to track the PANE rather than the viewport?) rather than acted on here.

**PLAN 7 PART 4's SPEC §9.1 ANSWERED IT: THE TABLE TRACKS THE VIEW.** A TM view's open panels now share its height through flex, each down to a floor, so a drag shrinks the table with the pane until the floors are reached, and the view scrolls only below them. The 6-11x figures above predate that and were not re-measured.

## `web/src/link-status.ts`, above `function detachedText(d: DetachedPanes): string {`

**THE NAMES COME IN `LEGS`' ORDER AND ARE SAID WITH `LEG_NAME`**, where the three sentences were once written out, one per combination of two legs — a third leg would have been in none of them. The words for one leg and for two are the ones those sentences said: `λ view shows a copy`, `λ and TM views show copies`.

## `web/src/link-status.ts`, above `export type DetachedPanes = Record<Leg, { readonly views: number; readonly copies: readonl`

**EVERY VIEW, WHERE THIS WAS ONE BOOLEAN PER LEG READ OFF THE VIEW FOCUSED LAST.** With an asm view on the program and a second on a copy, the line named the asm copy only while the copy's view was the one focused last, and "asm view" did not say which of the two it meant.

## `web/src/link-wiring.ts`, above `const detachedPanes = (): DetachedPanes =>`

**EVERY VIEW OF EVERY LEG, WHERE THIS READ ONE VIEW PER LEG.** It asked each leg's active view — the one focused last — so an asm copy on screen went unnamed while a view of the program beside it had been focused more recently, and a leg's views could not be told apart in the sentence.

## `web/src/link.ts`, above `linkFor(node: number): Link {`

Measured, the TM leg is absent for 18-50% of clickable nodes, so reporting the absence is the common path and the caller must say so rather than show nothing.

## `web/src/link.ts`, above `export class LinkIndex {`

— 5a-ii timed a 4,679 ms gap —

## `web/src/link.ts`, above `function innermost(start: Uint32Array, end: Uint32Array, byteOffset: number): number {`

— 403 on the most adversarial program measured —

## `web/src/link.ts`, above `export type LinkIndexWire = {`

`list60` is 552 KB as arrays of objects against ~220 KB this way, and `prog200` is 1.9 MB against ~689 KB

## `web/src/link.ts`, above `import type { Leg } from './protocol'`

M2 VERDICT, decided against a threshold the design fixed BEFORE any number existed: if the median `Within` span exceeded 60% of program length on MORE THAN ONE corpus program, `Within` would render as a status line rather than a highlight (see `reduce.rs`'s `Owner` doc for what `Within` claims). Task 8 measured it with `crates/redextape-core/examples/owner_probe.rs` — full M1/M2 tables in the `PLAN 5c CLOSES` entry of `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, which carries the whole nine-program table. Only `sum5` crossed it: median 65.0% (every one of its 402 `Within` steps resolved to the SAME span — `Core::LetRec` re-tags the identical `If` body on each of the recursion's five unrollings, not a whole-program fallback). The next-highest median across the other eight programs was 29.4% — nowhere close. One program crossing is not "more than one", so the gate did not trip: `WITHIN` RENDERS AS A HIGHLIGHT, same as `Exact`, just visibly weaker — see `main.ts`'s `draw()` for the wiring and `style.css`'s `.is-focus-within` for the weaker treatment.

## `web/src/lsp-client.ts`, above `export class LspClient {`

This repository has already paid for the alternative: a prior slice shipped twenty-three timeout ceilings that could never fire, and `tests/node/browser-timeout-invariants.test.ts` exists because of it.

## `web/src/lsp-nav.ts`, above `key: 'F2',`

F2, and the choice was measured on both halves it has. Nothing in the app, CodeMirror or vim swallows it — a probe pressed F1/F2/F4/F8/F9 through `userEvent` and all five reached the editor.

Measured by pressing F2 once and then hovering: neither closes, for the rest of the page's life.

## `web/src/lsp-nav.ts`, above `export function navKeymap(deps: {`

a scan of `defaultKeymap` and `historyKeymap` — 74 bindings — found no F-key among them

## `web/src/lsp-nav.ts`, above `/** What a navigation needs from the app: where the caret is, and how to say what happened`

**AN EARLIER DRAFT ROUTED JUMPS BY URI THROUGH THE CLIENT, SO THAT A TARGET IN ANOTHER VIEW COULD BE REVEALED THERE — AND THAT PATH WAS UNREACHABLE.** The umbrella's §5.4 says "including jumps across views", which reads as a cross-document jump and is not one the server can produce. The routing, and the notice for a target no view was showing, were a guard for a case that cannot arise — the shape this repository has paid for before as timeout ceilings that could never fire. If the server ever gains a workspace-wide index, this is the file that grows the routing back.

## `web/src/lsp-worker.ts`, above `import init, { LspServer } from '../../pkg-lsp/redextape_lsp_wasm.js'`

The design measured what it costs: 0.15 ms for a source document, 14.58 ms for an 814 KB TM, and 135.2 ms just past the 6,100,000-unit ceiling.

That it is genuinely exercised is not inferred from the test passing — removing either `lspClient.changeDocument` or `lspClient.openDocument` reddens all four of that file's tests.

## `web/src/protocol.ts`, above `export const VALUE_CHUNK = 500_000`

**THE READINGS ARE ONE RUN OF THAT COMMAND AT THE COMMIT THAT ADDED THE PROBE'S RUN STAMP** (`web/tests/browser/provided-context.d.ts`), on an AMD Ryzen 9 9950X3D, starting at a load average of 1.32, in the probe's release build in the browser test tier's headless Chromium. That build skips `MAX_SCRATCH_TM_BYTES`' size check, which runs once before a parse and never inside a chunk. Twelve reduced files whose recorded runs took 1,242,325 to 185,898,088 steps ran out in chunks of this size at 63.9 to 72.4 million steps a second.

## `web/src/protocol.ts`, above `export const REDEX_SPAN_BYTES = 40`

a run retaining `redex_span` alongside `step`/`text`/`cut` against one retaining only those three costs 35.1 bytes per NON-NULL span — the 264 of `while4`'s 471 frames that carry one.

## `web/src/protocol.ts`, above `export const SPAN_BYTES = 80`

Two runs step the same program (`while4`, ~470 β-steps, 132,882 spans total) identically at `FRAME_BYTES`: run A pushes every full `LambdaState` into a kept-alive array, run B pushes the same frames with `spans` dropped. `(meanA - meanB) / totalSpans`, over three alternating A/B pairs after one discarded warm-up pair, lands at 74.08289058462897 — that value TO THE BYTE across browser restarts

THE OLD JSON ESTIMATE WAS ~76, AND IT WAS CLOSER THAN THE ARGUMENT AGAINST IT. That argument is still true as far as it goes: `TokenClass` is one of only 14 string values and V8 interns repeated string literals, so 132,882 entries share a handful of string objects instead of paying for one each, where JSON re-writes the literal in full every time. The sharing is real; it is just smaller than the structural cost of the pair around it — a two-element array with its backing store, wrapping a two-field `Span` object.

## `web/src/protocol.ts`, above `export const DROP_HISTORY_ON_UNFOCUS = false`

**IT IS MET. 1.8160189425298086**, measured 2026-08-11 by `tests/browser/session-memory.test.ts` in real Chromium under `vite.config.ts`'s browser `launchOptions` flags, driving three real `session-worker.ts` threads through a real `SessionPool` into real `History` rings. Mean resident heap over three alternating rounds after one discarded warm-up pair: **92,435,664.67 bytes** for one session at two legs against **167,864,918** for three sessions at four. Round-by-round, one session / three sessions: 92,414,610 / 167,854,526, then 92,441,666 / 167,875,654, then 92,450,718 / 167,864,574.

**RE-MEASURED 2026-10-07, WHEN A TM FRAME'S TAPES BEGAN TO CROSS AS ONE STRING EACH, AND STILL MET.** The same file, two runs on each side taken in turn: mean resident heap 93,080,893.67 and 93,085,205.67 bytes for one session against 168,507,487 and 168,514,131 for three before the change, ratios 1.8103337899122949 and 1.8103213050142515; after it 53,797,982.33 and 53,802,203.67 against 89,918,997.67 and 89,904,097.67, ratios 1.6714195173626927 and 1.6710114370718063. Baseline-free, the ratio read 1.9998919540045792 and 1.999850460283213 before and 1.9990624867469862 and 1.9985581174246312 after. **AND AGAIN WHEN A λ FRAME'S SPANS BEGAN TO CROSS AS ONE BYTE STRING, STILL MET**, every reading after two forced collections (`HISTORY_BYTES`'s λ row says why): two runs on `406676e`, before the change, taken in turn with two after it, and three more after it. Mean resident heap 53,789,385 and 53,793,529 bytes for one session against 89,915,586.33 and 89,907,095.67 for three before, ratios 1.6716232456149727 and 1.6713366335691915; after it 48,235,642.67 to 48,241,576.33 against 78,791,848 to 78,799,288.33, ratios 1.633412027325337 to 1.6335864044580173. Baseline-free, 1.9997134462760306 and 1.9993872469182312 before and 1.9994881568813339 to 1.9997022744737865 after (2026-10-07). Every other figure in this doc is the 2026-08-11 measurement's.

Stripping the harness page's ~17.0 MB baseline leaves what the session machinery itself adds — 75,421,530.67 bytes against 150,836,014.67, a ratio of **1.99990656956171**. Four legs is twice two legs to five significant figures, which is design §4.4's "128 MB: 2x today, not 3x" confirmed in retained bytes instead of in budget bytes. **THE BASELINE-FREE READING HAS NO SIGN AT THIS PRECISION** and that is stated rather than smoothed: four runs of this probe read 2.000012445644004, 1.999953682804821, 1.9999763640919819 and 1.99990656956171 — one of them above 2 — straddling it by under a kilobyte in 150 MB while the round-to-round spread of the single-session figure alone is ~7,700 bytes.

One worker holding a `Session` for the probe fixture is 11,993,088 bytes; three workers holding that `Session`, a `LambdaScratch` (65,536) and a `TmScratch` (0, absorbed by the previous page) are 28,966,912 — a ratio of **2.4153005464480874**. Added to the heap figures: 1.884843254120645 against the resident reading the threshold names, and **2.0568976838107504** against the baseline-free one, which is a miss.

## `web/src/protocol.ts`, above `export const HISTORY_BYTES = 32 * 1024 * 1024`

**λ leg since a frame's spans cross as one byte string — 0.19451407924488462**: 1,233,805.33 bytes against the same 6,343,013 for the same 253 frames, in five runs of the same file, two of them taken in turn with two on `406676e`, before that change, which read 6,798,725.33 and 1.0718447736640826 (2026-10-07). Every reading in those runs follows two forced collections, where the rows above follow one: a `Uint8Array` that has become garbage is still counted after one (`session-memory.test.ts`'s `round`).

twice the places, and 2.2 times the bytes at the peak. Measured in node for 69,008 frames kept (2026-10-05), the two arrays held 1,208 to 2,708 KB through the evictions, against 1,208 to 1,216 KB when `History` shifted them

## `web/src/protocol.ts`, above `export const FRAME_BYTES = 512`

MEASURED, and the measurement moved it two orders of magnitude below the readout's budget (`frame_cost_probe`, 2026-08-07). Dropping from 65,536 to 512 made rendering 10-31x faster and frames ~22x smaller — `while4` went 59.67 -> 5.77 us/step and 229,528 -> 10,123 bytes/frame; `list60` went 230.91 -> 7.40 us and 252,084 -> 11,464.

## `web/src/scratch.ts`, above `export const MAX_WARM_BUFFERS = 8`

`buffer-affordability.test.ts`'s TM case prices one of `map-fold` under `binary`, the costliest of the shipped examples' 13 TM copies (that case's doc names the costliest three), at a marginal of 58,535,454.67 and 58,537,982.67 bytes in two runs: its wasm 25,362,432, and on the page its ring with the machine, status and value the page keeps on the copy's session entry, 33,188,960 and 33,181,304 bytes at n = 1. Reading (a)'s intercept on that probe page, 40,993,517 and 40,993,537 bytes, derives 8; eight copies came to 485.70 MiB with it and nine to 541.53 MiB, against 512, in both runs.

Copies of the other kinds cost less there, in one run each, counting their worker and ring only, where the TM copy's figure also counts what the page keeps: a λ copy of a shipped example 17,241,868 bytes at the most of the fork steps tried (`fact-12` forked at step 200; from step 250 the fork is refused, too large to print), an asm copy 9,454,688 at most, each over 41 MB less.

A λ copy grows each time its recording is continued: `fact-12`'s, stepped 200,000 times, held 69,206,016 bytes of wasm, 75.75 MB in all, in one run. And a copy a user writes can be larger than any shipped one: an asm copy's worker reached 168.4 MiB under `COPY_CAPS` (`asm-copy-memory.test.ts`).

## `web/src/session-worker.ts`, above `const yieldToEventLoop = (): Promise<void> =>`

This branch's own `map`-fixture browser test reaches the TM history budget at 75,025 frames, `75,025 / 256 ≈ 293` yields — MEASURED, not estimated from that count alone: `app.test.ts`'s "records further once the TM leg spends its history budget" (real Chromium, four runs each) averaged **~2,814 ms with `setTimeout`, ~2,097 ms with `MessageChannel`** below — about 25% faster, materially less than a naive "4 ms × 293 yields ≈ 1.17 s" estimate would suggest, because most of that budget is real step/render work interleaved with the clamped yields, not idle time alone.

## `web/src/style.css`, above `.controls .play,`

`⏭` joining the strip took 43px from the title's row, and at 1280px in Explorer the TM view's strip at `step 12,976 of 12,976` needed 430.2px of the 424.1 the row had: it wrapped, and a playing run's panels would drop a row once its count gained a digit. With the two icon buttons at 29px it needs 418.2.

## `web/src/style.css`, above `/* **AT A PHONE'S WIDTH THE INSPECTOR STACKS UNDER THE VIEWS** (the user's decisions, 2026-10-05), at the header's own`

which closed is its header and open at 390 by 1600 was 35.1% of `main`

15rem is 240px. **WITH THE DEFAULT PROGRAM** `main` is 267.63px at 320 by 568 with the preset's notice up, 27.63px over the minimum, so that page is as it was. **NOT WITH EVERY PROGRAM**: the `fact` example's step line makes the step bar 135.38px tall at 320px wide, where the default program's is 62.38px, and at 320 by 568 with a notice up `main` is then at the minimum and the page 613px tall, so it scrolls 45px; with the notice gone `main` is 242.63px and the page does not scroll. The user saw those figures and kept 240px. A 200px minimum was weighed and not taken: it shows less on a short page, and measured afterwards it scrolls that page as well, by 5px, `main` having 194.63px there with a notice up. Measured at 320px wide with `main` at 240px: open, the inspector is 96px and the views 144px, so in Debugger each tile is 66px tall and the source view shows a line of its content under its header, while λ's, asm's and TM's headers, on two rows, leave 12.22px and no whole line; on the Stage the shown view has 71px under its header. Closed, the views have 212px, and Debugger's four show 3, 1, 1 and 1 lines. With no minimum, at 320 by 320 with the notice gone, a closed inspector was cut to 27.05px and its header ran into the step bar.

## `web/src/style.css`, above `@container state-diagram (width < 14rem) {`

it was set above the widest level then measured at a phone's width, 201px (Explorer at 414px), and below the narrowest then measured in a desktop's layout, 239px (Debugger at 1280px with the TM view split right). A re-review then measured desktop layouts under it, TM views of 173 to 219px in narrower splits and beside views added with `+ view`, whose rows `53ecbfa` drew 0 to 43px wide.

## `web/vite.config.ts`, above `exclude: ['src/session-worker.ts', 'src/lsp-worker.ts'],`

MEASURED 2026-08-09, NOT ASSUMED: v8 coverage collects through CDP against the page and did not attach to this module's dedicated-worker context — it reported 0% while `tests/browser/worker.test.ts` spawns the real module as a Worker and drives it end to end (asserting the λ leg reaches `Ended` at step 7 with both legs decoded), so the module IS genuinely exercised. This is an instrumentation gap, not a testing gap, and conflating the two is what the exclusion is documented to prevent. Confirmed by removing this entry: the row REAPPEARS at 0% and the statement denominator RISES 918 -> 1072, exactly session-worker.ts's 154 statements.
