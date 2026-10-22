# Code history moved out of comments

Text moved verbatim out of code comments when they were trimmed to their why. Each entry names the file and the line of code the comment sat above.

## `web/tests/browser/active-pane.test.ts`, above `it('the status line names the λ copy by its title whichever of the two λ views has the foc`

It read the λ leg's active view, so with the view of the program focused it said nothing of the copy on screen, and with the copy's focused it said "λ view", which does not say which of the two. Focusing the program's view is the expectation the old reading failed.

## `web/tests/browser/active-pane.test.ts`, above `/** `link-status.ts`'s `detachedText` for a λ view on a copy named by `title`, beside anot`

They used to follow focus: `PaneCollection.active`, the pane the user last focused on the leg, answered for both, through the `focusin` listener `pane-host.ts`'s `hostFor` wires on each host's creation. The check by hand found what that cost on the machine legs: a copy's view focused last took the program's running focus off the program's own view, and the status line named a copy only while its view had been focused last.

## `web/tests/browser/affordability-worker.ts`, above `const frames: LambdaState[] = []`

The old probe pushed a `fixtureFrame` (`spans: []`, `redex_span: null`, `owner: 'None'`, ~88 bytes) into the ring on the main thread instead of using what this worker was already building and discarding right here.

never the ~381,000 the fixture needed at its ~88 bytes/frame.

## `web/tests/browser/app-header.test.ts`, above `it('keeps every closed popover off the page', () => {`

written `.header-menu.settings { display: grid }`, the settings menu painted over the header and the source view from first load, open or shut.

## `web/tests/browser/app.test.ts`, above `it('keeps the scroll range honest across a compile with the table hidden', async () => {`

`#drawTable` writes `scrollTop` BEFORE it writes the spacer height, and a `scrollTop` write CLAMPS to the current scroll height. So a spacer left at the previous program's size silently truncates the reopen write: coming from `let x = 40; x + 2` (8,112px) into `map_fold` (620,448px), a request for 161,786 was clamped to 7,755 — the current row not on screen, and then the echo arriving against an unclamped expectation detached the table with no user gesture at all. From a program that declined the TM leg the spacer is 0px, the write clamps to 0, and no scroll event fires at all: parked at row 0, still nominally following, no reattach offered.

## `web/tests/browser/app.test.ts`, above `it('takes the reattach control away with the table it belongs to', async () => {`

`#reattach.hidden` is maintained inside `#drawTable`, which the toggle called only when REOPENING — so hiding a detached table left a live "follow" button with nothing under it, offering to reposition something not on screen.

and the closed-table term written for it could never fire, because `#drawTable`, where it is evaluated, did not run on the way down.

## `web/tests/browser/app.test.ts`, above `it('ignores a scroll that arrives while the table is hidden', async () => {`

Reproduced 5/5 in Chromium by stepping, hiding, then showing.

A version of this test that stepped and hid and waited two animation frames passed against the bug —

## `web/tests/browser/app.test.ts`, above `expect(table().clientHeight).toBeLessThan(window.innerHeight)`

Two others used to sit here and both were drained by the `until` above: once the spacer is pinned to `BIG_SPACER`, asserting it exceeds 100,000 is a tautology, and `clientHeight * 10 < spacer` only restates `clientHeight < 62,044`, which this line already beats by a wide margin.

## `web/tests/browser/app.test.ts`, above `it('a source-originated link scrolls the table into view even while it is still following `

`TmPane.setLink` wrote `scrollTop` and then called `#drawTable`, which — while `#follow.following` (the default state on every fresh compile; see `setProgram`'s `#follow.attach()`) — computed its OWN target from the machine's CURRENT frame and overwrote the link's write in the same synchronous turn, so a source-originated link scroll never moved the table at all while following.

## `web/tests/browser/app.test.ts`, above `it('clears all three panes on an edit, not only the source echo, and says linking will res`

so the source echo went stale correctly. But the listener never told the OTHER two panes: the λ window and the δ-table's `.is-linked` rows stayed painted from the PREVIOUS index until the next `compiled` reply landed, up to `DEBOUNCE_MS` plus a compile — seconds on a larger program — all while the status line already said "linking resumes when this compiles".

## `web/tests/browser/app.test.ts`, above `it('records further once the TM leg spends its history budget, and the step count advances`

which a worker-only probe measured this fixture reaching at 75,025 TM frames (~129,300 δ-steps known total from `compile`, only 58% of them recorded) in ~1.9s, with `[continue]` recording the remaining 54,276 frames to `'ended'` in ~1.3s more — see `task-12-report.md`'s "Fix pass" section for the raw numbers.

## `web/tests/browser/app.test.ts`, above `// THE `'too-large'` λ LINK STATE IS NOT COVERED END TO END HERE. The attempt at its predecessor, `'truncated'`,`

THE `'too-large'` λ LINK STATE IS NOT COVERED END TO END HERE, AND NEITHER WAS `'truncated'`, THE STATE IT REPLACED (Plan 7 part 4a) — TRIED, AND SKIPPED, on the one program shape that reaches either. `let x = 20000; x + 1` was the candidate (this language lowers naturals to unary Church numerals, so one literal is O(n) bytes of printed λ text): verified directly against `LinkIndex::build` (`redextape-core`) and against `redextape-wasm`'s own `Session`, natively, that this exact program compiles, prints (truncated at 12,064 of 65,536 bytes), takes its one depth-refused "step", and link-resolves the cut "20000" literal — all in low single-digit milliseconds, with the TM leg overflowing just as fast. NATIVELY THIS IS CHEAP. Under the real wasm32 build in a real browser it is not merely slow: dispatching this program crashes the worker's session — `Error: attempted to take ownership of Rust value while it was borrowed`, thrown from `Session.free()`/`dropLive()` in `session-worker.ts` — and the app never recovers (`#results` stays on the previous program's stale text). Reproduced with a fresh mount, and again after letting the prior compile settle fully first, so it is not the ordinary supersession race `dropLive`'s own doc already accounts for.

## `web/tests/browser/app.test.ts`, above `expect(stepText('lambda')).toBe('not compiled')`

`sessions.ts`'s `resetLegs` used to leave `reason: ''` here, so the control strip's step readout (`controls.ts`'s `controlState`, written onto the `.step` span `pane-chrome.ts` builds) was blank too, not merely the term/tape area above it.

## `web/tests/browser/app.test.ts`, above `it('marks the contractum the step produced, and nothing at step 0', async () => {`

THE FIXTURE WAS CHOSEN FOR LAYER 5b's WORST BUG, a byte span sliced as UTF-16: three `λ` precede this redex's span, so the two readings disagree.

## `web/tests/browser/app.test.ts`, above `it('recovers from a worker-error without killing the editor', async () => {`

`main.ts` used to answer it with `showBanner(root, ...)`, which is `root.replaceChildren(bannerEl)` — deleting the editor, both panes, and `#results` in one call, after which nothing on the page could ever dispatch again.

## `web/tests/browser/app.test.ts`, above `// THROUGH `settled`, FOR ITS THREE WAITS.`

this compile's one wait for the word took 7,705 ms at `CPUQuota=15%`.

## `web/tests/browser/app.test.ts`, above `it('renders the λ pane’s first binder span as exactly "λ", not "λ" plus its name', async (`

Written for a critical finding on the flat frame — `LambdaState.spans` are BYTE offsets, `λ` is 2 bytes but 1 UTF-16 code unit, and slicing `frame.text` by byte offset drew this span as `"λf"` —

## `web/tests/browser/app.test.ts`, above `it('colours keywords once the grammar lands, and reports all three legs', async () => {`

**THE SYNCHRONY WAS REAL, AND IT WAS GIVEN UP DELIBERATELY.** This test was named `highlights keywords synchronously` and asserted `.tok-keyword` in the same dispatch as the document, which held: `classifySource` ran on the main thread inside the update listener, so the colour landed in the keystroke's own frame. Plan 7 part 3b replaced it with `colour.ts`'s tree-sitter `ViewPlugin`, whose grammar arrives over a fetch — one mechanism serving four languages instead of one Rust function serving one, at the cost of the first frame after a mount. A test named for synchrony that awaits is a test whose name lies, so the name went with the contract.

## `web/tests/browser/app.test.ts`, above `async function settled(v: EditorView, src: string): Promise<void> {`

Until PR 5b the bump happened 300 ms later, inside `request`, and a stale `result` landing in the gap resolved this against the OLD program — two flakes on 5a-ii traced to exactly that.

and as one wait it took 7,583 to 8,601 ms at `CPUQuota=25%` (2026-10-05), against `until`'s 10 s; as two, the second took up to 7,400 ms.

## `web/tests/browser/asm-app.test.ts`, above `const UPTO = 'fn upto(n) { if n == 0 { nil } else { cons(n, upto(n - 1)) } } upto(600)'`

— measured against `asmFrameBytes` by stepping the same lowering in node.

## `web/tests/browser/asm-copy-cost.test.ts`, above `type Copy = { asmStatus(): AsmStatus; asmProgram(): AsmProgram; asmValue(): Decoded; free(`

Amendment 36 priced only the loop; amendment 45 found `both` heavier in every run measured and moved the rule to whichever run turns out heaviest, rather than naming one in advance.

## `web/tests/browser/asm-copy-restore.test.ts`, above `it('brings back a copy that does not build in its editor, with the label that names nothin`

and the editor used to come only from a build that landed — the view read `building…` with no editor and no way to get one.

## `web/tests/browser/asm-copy.test.ts`, above `await userEvent.click(tm.querySelectorAll<HTMLElement>('.state-row')[3] as HTMLElement)`

measured on `main`, where a click on it in the copy pinned `40` in the source through the program's index.

## `web/tests/browser/bindings-stored.test.ts`, above `const FOUR = ['source', 'lambda-0', 'asm-0', 'tm-0']`

The bindings were written at a fork, a pick in a title, a pause and a delete, and not when a view was closed, added, or built again. So a `✕` on a view of a copy left its leaf bound in storage, the view its toggle built there next was on the program, and a reload put that view on the closed view's copy: measured on `5ff63af` by seeding a second page with what the first had stored, which opened reading `λ · copy 1`. `pane-host.ts`'s `applyLayout` writes the bindings now, each time it has built or dropped views.

## `web/tests/browser/buffer-affordability.test.ts`, above `async function tmRound(n: number, collect: () => void, src: string): Promise<TmPoint> {`

A `map-fold` machine under `binary` held that way read 4,485,864 and 4,483,346.67 bytes a copy in the whole-branch review's probe (2026-10-07), which the first cut of this case left out and so derived 9 where the page affords 8.

and holding them read 279,644 and 279,412 bytes a copy more.

## `web/tests/browser/buffer-affordability.test.ts`, above `it('measures what a warm TM copy costs, and the cap a page of them affords', { timeout: 60`

**THE COSTLIEST COPY IS A TM COPY NOW, AND THE CASE ABOVE PRICES ONLY λ COPIES** (2026-10-07).

One copy of each example under each encoding, 13 with a machine (`fact-12` has none under `unary`), priced one at a time through `tmRound` in one run (2026-10-07): `map-fold` under `binary` 54,334,652 bytes, its wasm 25,362,432 and its ring 28,972,220; under `unary` 52,794,396; `fact-12` under `binary` 51,585,008; every other copy 42,067,500 or less. Those were priced before this case held the page's copy of each machine. Through this case's `tmRound`, which holds it, the whole-branch review's run read `map-fold` under `binary` at 58,545,848 bytes, under `unary` 56,119,708, and `fact-12` under `binary` 55,037,816, the same order (2026-10-07). Its copy records 69,009 frames, 69,008 steps,

## `web/tests/browser/buffer-affordability.test.ts`, above `console.log('warm-up (n=1), discarded:', JSON.stringify(await round(1, collect)))`

This is also why the missing warm-up showed up as `n=1`'s per-ring reading running slightly ABOVE `n=4`'s in the pre-fix report: the first fill in a run pays a cost later fills don't, and `n=1` used to be the very first fill.

## `web/tests/browser/buffer-affordability.test.ts`, above `const TM_LEG_RETENTION_RATIO = 0.8744705880483015`

**IT WAS 2.045480413555839 UNTIL THEN**, and reading (b)'s derived cap was 8 on it. With this one the probe printed a source TM ring at exhaustion of 29,342,363.88 bytes and a derived cap (b) of 9, in one run (2026-10-07); reading (a), which counts no source ring, printed 11 as before.

## `web/tests/browser/buffer-affordability.test.ts`, above `const LAMBDA_LEG_RETENTION_RATIO = 0.19451407924488462`

**IT WAS 1.071921708710566 UNTIL THEN.** In two runs on this one, taken in turn with two on `406676e`, before that change, the probe printed a λ ring at exhaustion of 7,898,504 bytes, where it printed 35,939,896 and 35,953,988; a marginal of 16,420,493.33 and 16,421,534.67 bytes a buffer, where it printed 44,458,449.33 and 44,465,050.67; and derived caps of 30 for reading (a) and 28 for reading (b), where it derived 11 and 9 (2026-10-07). Its own n=1 ring read 0.2354 of its charge, 21.016% from this constant, where before the two read 1.0710 to 1.0715 and 1.0719; the intercept uses the probe's own reading, not this. These figures price λ copies only; the TM case below prices the copy that sets `MAX_WARM_BUFFERS`.

## `web/tests/browser/buffer-affordability.test.ts`, above `const MAIN_THREAD_WASM_MODULE_BASELINE_BYTES = SOURCE_WASM_MODULE_BASELINE_BYTES`

THE FIFTH INTERCEPT COMPONENT — CRITICAL 1, FIX ROUND 2.

that file's own `init()` call moved ITS page baseline by only ~0.6 MB (16.41 MB -> 17.0 MB) against this module's 8.06 MiB

## `web/tests/browser/buffer-affordability.test.ts`, above `const APP_PAGE_BASELINE_FLOOR_BYTES = 17_825_792`

**DOES NOT COVER THE MAIN-THREAD WASM MODULE — CORRECTED, CRITICAL 1, FIX ROUND 2.** This doc used to list "the main-thread wasm module" as part of what this figure covers; it does not, and could not:

its own `init()` raised THAT file's page baseline by ~0.6 MB (16.41 MB -> 17.0 MB) against the SAME module's 8,454,144-byte (8.06 MiB) linear-memory baseline

## `web/tests/browser/buffer-affordability.test.ts`, above `const ringRetained = builtRings.map((r) => r.length)`

**THE STATEMENT STAYS AND WHAT IT CHECKS CHANGED, BECAUSE THE OLD CHECK COULD NOT FAIL — whole-branch review before merge, finding 3d.** It read `if (builtRings.length !== n) throw …("round filled … of … rings")`, which is structural:

and the throw named a state this code cannot be in.

## `web/tests/browser/buffer-affordability.test.ts`, above `async function round(`

A first version of this fix called `runWorkers` first, then took "before" and built the rings from the frames it got back. That measured almost nothing:

the observed symptom was a ~90 KB delta for a ring that should cost tens of megabytes.

**THE TASK BOUNDARY AND DOUBLE COLLECTION LIVE HERE FOR THE SAME REASON THEY DID ON THE OLD `ringBytesFor`** — Important 3.

without one, that file's own experiment read a delta of −75,368,894.

`held` IS READ HERE, WHERE THE FIRST CUT POSTED IT AND NEVER READ IT BACK — Minor. It folds into the same per-worker structural check `steps` gets in the sweep below:

## `web/tests/browser/buffer-affordability.test.ts`, above `function buildRings(framesByWorker: LambdaState[][]): { rings: History<LambdaState>[]; cha`

**CRITICAL 1's FIX LIVES HERE ON THE BUILDING SIDE.**

rather than the fixture's ~381,000 featherweight frames landing at ~0.93x the byte budget they were charged against.

Fix round 1 computed `charged` only to gate the 90%-exhaustion throw below and then discarded it; nothing anywhere counted the frames going into a ring.

and would previously have shown up nowhere.

## `web/tests/browser/buffer-affordability.test.ts`, above `const BUDGET_BYTES = 512 * 1024 * 1024`

**FIX ROUND 1 — TWO ERRORS THAT BOTH INFLATED THE FIRST DERIVATION (13), FIXED HERE:**

1. **CRITICAL 1 — the ring is now filled from REAL frames.** The first cut pushed a `fixtureFrame` (`spans: []`, `owner: 'None'`, ~88 bytes) into the ring instead of using the frames `affordability-worker.ts` was already building and discarding while stepping the divergent term. The worker now posts those frames back (capped at `HISTORY_BYTES` charged, so this stays ~3,200 frames per worker — `protocol.ts`'s `HISTORY_BYTES` doc's own figure for a real λ ring — never the ~381,000 the fixture needed), and `buildRings` pushes those instead of a synthetic stand-in. 2. **CRITICAL 2 — the intercept is no longer zero.** The first cut modelled a page with zero buffers as costing nothing (`first.total`, the n=1 reading, doubled as both the marginal-cost anchor AND the fixed cost). A real page at the cap also carries a DOM/CodeMirror/main-thread-wasm baseline and a source session with its own module, arena and two rings — none of which any buffer's cost ever included. The intercept below is measured and printed as four SEPARATE components, and two derived caps are printed from it — see "THE TWO READINGS" below for what each includes and why this file does not pick between them.

Important-severity fixes carried in the same pass: a sanity bound on the ring reading itself (a zero ring delta at every `n` used to pass); `steps` is now logged and asserted non-zero (a term that stopped reducing at step 0 used to pass silently); the forced-collection discipline `session-memory.test.ts`'s `round` established — a task boundary before the double collection that gates the "before" reading (that file's own `round` never puts one before its second, "after" collection either), one discarded warm-up round — is now explicit here instead of borrowed by accident from call order; and the worker's message handler is now exception-safe (see `affordability-worker.ts`'s own header).

**FIX ROUND 2 — THE RING HALF WAS CONFIRMED VALID; THESE FIX THE INTERCEPT AND MAKE THE MEASUREMENT SELF-EVIDENT:**

1. **CRITICAL 1 — a fifth intercept component: the main thread's OWN wasm module.** Fix round 1's "four separate components" counted the source worker's module (`sourceFixedCost`) and each buffer's module (inside `marginal`), but never the main thread's — `main.ts` calls its own `await init()` and uses `captureClasses`/`encodings`/`tokenClasses` from it, a full module instance at the same 8,454,144-byte baseline as every other thread's, and `heapNow()` cannot see it: `usedJSHeapSize` is JS/DOM heap, not wasm linear memory, and `session-memory.test.ts`'s three-sessions test proves the gap directly (its own `init()` moved that file's page baseline by ~0.6 MB against this module's 8.06 MiB). `MAIN_THREAD_WASM_MODULE_BASELINE_BYTES` below is that fifth component, and `APP_PAGE_BASELINE_FLOOR_BYTES`'s doc no longer claims the page baseline covers it. 2. **IMPORTANT 2 — both derived caps are now printed as explicit upper bounds, not measured ceilings.** `APP_PAGE_BASELINE_FLOOR_BYTES` is a FLOOR by its own name and `session-memory.test.ts`'s own words ("the shipped app's baseline... is larger still") — a floor on one intercept component can only make the true intercept larger and the true safe cap smaller, never the reverse, so a cap derived from it is an upper bound on what the page can actually afford. 3. **IMPORTANT 3 — per-ring `charged` bytes and frame count are now printed and frame count is bounded.** Fix round 1 computed `charged` only to gate the 90%-exhaustion guard and never counted frames at all, so a regression back to featherweight fixture frames (fix round 1's own Critical 1) would still charge to budget, still pass every existing assertion, and show up only as an unwatched ~4 MB shift in `rings`. Both are now printed per round and frame count is bounded well below the fixture's ~381,000 and well above a real ring's ~3,200, closing that regression without encoding the threshold. This also makes the λ retention ratio (fix round 1's report cross-check against `protocol.ts`'s recorded figure) printable directly from this file's own output.

Minor fixes carried in the same pass (reasoning lives at each site): `sourceLambdaRingAtExhaustion` now uses this probe's own n=1 at-exhaustion reading instead of extrapolating `protocol.ts`'s ratio (measured at 19% fill) up to 100% — the two are printed together as a cross-check; the alternating- rounds comment's stated reason was wrong and is rewritten below; `setTimeout(0)` is now `setTimeout(100)` to match `session-memory.test.ts`'s own figure; a `messageerror` listener now catches a main-thread deserialization failure the same way `error` catches a load failure; `held`'s per-worker `expect` is dropped to a comment because it cannot fail by construction; and the marginal's exclusion of a per-buffer `Worker` handle and its client is now stated (~11,395 bytes/buffer — `protocol.ts`'s `DROP_HISTORY_ON_UNFOCUS` doc's own figure, and ONLY that: that doc's own words are "the `Worker` handle and its client and nothing else", not the play timer or the pane-state entry a prior revision of this comment also named. Only the play state lives in `main.ts`'s session registry (`sessions.ts`'s `LegState.playing`, a timer until Plan 7 part 2), per `session-client.ts`'s `SessionPool` doc's own distinction between what the pool tracks and what the registry does; the pane-state entry does not — it lives in `panes.ts`'s `PaneCollection` instead, not in a `SessionEntry` (`sessions.ts`'s `SessionEntry` fields are `id`, `label`, `detached`, `client`, `legs`, `tmProgram` — no pane), and that same `SessionPool` doc says nothing about it. Neither figure is quantified here or anywhere else in this repo.

Fix round 2's sweep was `[1, 2, 4]`,

whole-branch review before merge, finding 5.

This repo's history records a λ probe taking 60 GiB of RAM and all of swap.

## `web/tests/browser/buffer-cool-warm.test.ts`, above `await until(() => editorHost() !== null, 'the warmed buffer to mount an editor onto its ne`

chosen for exactly the reason this comment used to give locally:

Measured: with `pane-host.ts`'s `mountScratchEditor` reverted, this line is what fails.

## `web/tests/browser/buffer-cool-warm.test.ts`, above `/** `scratch-edit.test.ts`'s program, for its reason: it truncates at neither budget, so ``

**THE COOL → WARM → BIND ROUND TRIP, AND THE DEFECT IT USED TO END IN**

**WHAT THIS FILE EXISTS FOR: A WARMED BUFFER USED TO COME BACK UNEDITABLE, FOREVER** — whole-branch review before merge.

`warm` posts a build that lands with no pane claiming a leaf, so `replies.ts`'s `scratch-compiled` arm resolved `editorHome(session)` to `undefined` and mounted nothing. Binding a pane back through the selector re-posted no build and claimed no leaf, and "bring the term editor to this pane" is correctly withheld when `custody.hasEditor` is false — there was no editor to bring. The buffer's frames rendered and its text could never be reached again, which made `cool` — "the non-destructive escape from the cap", its own doc — destructive of editability. `pane-host.ts`'s `mountScratchEditor` is the fix and this file is what fails without it.

## `web/tests/browser/buffer-list.test.ts`, above `describe('bufferList: where the list opens', () => {`

WHERE THE LIST LANDS — geometry, because the split picker got exactly this wrong one slice ago in a way no behavioural test could see, and this control is built on the same two CSS declarations.

## `web/tests/browser/buffer-list.test.ts`, above `const temperature = (action: 'resume' | 'pause', name: string): HTMLButtonElement | null =`

now that the control carries one (5d-ii-d review, Finding 3: it shipped with none, so a screen-reader user at eight buffers heard an indistinguishable column of `warm`/`cool` buttons). Found by text-and-position is exactly what that gap made invisible —

## `web/tests/browser/buffer-list.test.ts`, above `describe('bufferList: temperature', () => {`

and the reason this file's crash-site history matters here: `main.ts`'s row builder used to call `legOf` unconditionally, an id `SessionRegistry.entryOf` throws for once a buffer is cold.

## `web/tests/browser/buffer-list.test.ts`, above `it('gives each list its own id and points its own button at it', () => {`

which had a paragraph and no assertion.** Deleting the counter AND the attribute failed nothing, so both were argued for and neither was pinned.

## `web/tests/browser/buffer-list.test.ts`, above `it('shows each copy’s own term, so two rows can be told apart', () => {`

A `label` is `scratch N` from a counter and a `paneCount` is the same on every row at the cap — so before `BufferRow.term` the list rendered eight identical rows under a refusal instructing the user to choose one of them. Found by opening the list on a real page; this is that page's assertion.

— whole-branch review before merge, finding 3c.** This paragraph read "ASSERTED AS DISTINCT STRINGS RATHER THAN AGAINST A LITERAL LIST, because what the field buys is DIFFERENCE. A test reading `toEqual([...])` passes just as well on a renderer that prints the same term three times" — and the line it was written above was a `toEqual([...])`, of three literals that are pairwise distinct. So the claim was false of the very assertion it sat on, and the `expect(new Set(termText()).size).toBe(THREE.length)` it justified was dead: a renderer printing one term three times fails the `toEqual` first, and nothing that passes the `toEqual` can fail the count. The list literal is kept and the count is dropped, because the literal says everything the count did

## `web/tests/browser/buffer-list.test.ts`, above `const THREE: readonly BufferRow[] = [`

**THE THREE TERMS DIFFER, AND THE THIRD IS `null`, WHICH IS THE OTHER AXIS THIS FIXTURE NOW CARRIES.** `BufferRow.term` exists because eight rows on a real page read `scratch N — orphan` and nothing else;

## `web/tests/browser/buffer-restore.test.ts`, above `it('restores both buffers and warms only the one a pane names', async () => {`

Before this slice's T4 gave the row builder its `warm` branch, a cold buffer reached an unguarded `sessions.legOf(...)` and threw out of a `beforetoggle` handler

## `web/tests/browser/buffer-restore.test.ts`, above `const SEEDED = serializeBuffers({`

AND IT IS HERE BECAUSE IT KILLED THE PAGE.**

Seeded without `main.ts`'s leaf-kind guard, `applyLayout` built a `PaneSlot('tm', 'scratch-1')` and the first `draw()` threw `session scratch-1 has no tm leg` out of `main()` itself: every test in this file reported as a SKIP under one failed suite, which is what a whole page dying looks like from here.

**IT WAS REACHABLE WITHOUT A HAND-EDITED KEY, UNTIL `pane-host.ts`'s `applyLayout` STORED THE BINDINGS**: bind a λ pane to a buffer, switch that pane to TM through the picker (which stored the TREE and not the buffers), and reload before anything else wrote the buffers key. `bindings-stored.test.ts` holds that pick to writing them now.

**`scratch-2` CARRIES `collapsed: true` — 5d-ii-d T9, design §4.7's fixture.**

## `web/tests/browser/buffers-quota-restored.test.ts`, above `* **A PAGE THAT RESTORED BUFFERS FROM STORAGE, HITTING A FULL STORE ON ITS VERY FIRST WRITE, DEGRADES`

**THE REGRESSION TEST FOR THE CRITICAL THIS SLICE'S OWN SELF-REVIEW FOUND AND DID NOT FIX ON FIRST PASS** — a page that restored buffers from storage, hitting a full store on its very first write, used to die at start-up rather than degrade. `main.ts`'s `refreshBuffers()` start-up call reached `persistBuffers()` reached `writeBuffersStorage()`'s `catch`, which called `reportStorageFailure()` — and `reportStorageFailure` reads `linkWiring`/`draw`, both still `undefined` at that point in `main()`. The result was a bare `TypeError` thrown out of `main()` itself, not caught anywhere, which is strictly worse than the silent failure this whole task exists to improve on.

**THE FIX MOVED THE START-UP `refreshBuffers()` CALL PAST WHERE `linkWiring` AND `draw` ARE ASSIGNED** (see that call site's own comment in `main.ts`, and the comment left at the old position). This file is what proves it: mount a page that restores a buffer, refuse the buffers write from before the mount even begins, and assert `main()` still returns a working page — the SAME assertion the crash would have failed,

## `web/tests/browser/app.test.ts`, above `it('reports the absence when a construct emits no instructions or machine states', async (`

Measured across the corpus, 18-50% of clickable constructs emit no machine states at all (`link-status.ts`'s module doc) — the transparent `let`/`seq` binders, the `Lambda`s, and statically-resolved callee `Var`s.

## `web/tests/browser/collect.ts`, above `const MOST_PAGES_ALIVE = 8`

Measured 2026-10-13 at each of 1,260 file starts: five whole runs of `pnpm run test:coverage` in twelve tabs, and one in three tabs under a CPU quota of one and a half cores, with this file's collection.

with the restart above taken out, a whole run in twelve tabs failed 104 browser files here.

## `web/tests/browser/collect.ts`, above `const gc = (`

A tab runs its files one after another, and the renderers' memory fell by more than a third only once their tabs went idle at the end of the run.

Measured 2026-10-13 on eight files in one tab: pages alive at each file's start 0, 1, 2 … 7, the heap 15.5 MiB to 83.6, the room 124 to 112. CI's slower runner runs three files at once, about seventy to a tab, and `main` at #142's merge failed twice there on `WebAssembly.instantiate(): Out of memory`; the whole suite in two tabs under `--coverage` failed 54 files of 210 here, that message among their errors. The faster runner runs eleven at once, about nineteen to a tab, and never got that far.

Without it the report fell from 97.59 / 92.19 / 98.39 / 98.92, by as much as the run made it: to 96.01 / 89.00 / 98.39 / 97.45 in one run, which the coverage floors passed, and to 94.95 / 86.84 / 98.39 / 96.64 in another, which they failed. A last-resort collection clears the compilation cache (`Heap::CollectAllAvailableGarbage`), and with it every run gave the report a stock run gives, file by file.

## `web/tests/browser/colour-ceiling.test.ts`, above `/** One comment line, 100 UTF-16 units including its newline. */`

The notice half of that row did not exist until this file: `ColourOptions.onCeiling` was declared in `colour.ts` and invoked in `#rebuild`, and NEITHER of `main.ts`'s two `treeSitterColour` calls passed one, so a document past the ceiling went silently uncoloured. `tests/node/colour.test.ts` drove the ceiling and passed no sink either, which is why the gap survived a green suite: an optional call on `undefined` is a line v8 records as covered and a behaviour that never happens.

## `web/tests/browser/colour-slices-fork.test.ts`, above `describe('the copy of a machine too long to parse in one slice', () => {`

As one case this took 7,396 to 9,093 ms in three runs alone at `CPUQuota=25%` (2026-10-06), against Vitest's 15 s for a case: the program's compile to the fork control, the copy's build to its editor, and the grammar's arrival to the first parse. In the three runs after the split, at the same quota, the two cases took 4,300 to 4,903 ms and 2,805 to 5,100 ms; a fourth read 5,303 and 2,302.

## `web/tests/browser/colour-slices-fork.test.ts`, above `/** `tm-scratch-fork.test.ts`'s `BIG`: a λ leg of 555 steps and a machine of 7,353 states `

and the colourer parsed all of it inside the update that first needed a tree: 194 to 208 ms in this tier's Chromium with the program and then the copy recording, and from the mount the page ran no timer for 232 to 249 ms and drew no frame for 216 to 232 ms, in five runs (2026-10-06). `colour.ts`'s `PARSE_SLICE_MS` has what replaced that, and `tests/node/colour.test.ts` holds it.

## `web/tests/browser/colour-slices.test.ts`, above `type Call = { units: number; sliced: boolean; finished: boolean }`

A parse of 1,518,470 units in one go measured 154 to 179 ms in this tier's Chromium (2026-10-06), 8,500 to 9,900 units a millisecond.

## `web/tests/browser/controls-gate.test.ts`, above `function controls(): HTMLElement[] {`

The first version of this filter asked the button, passed it, and then passed it again on a `tabIndex` that reads 0 inside a hidden subtree;

## `web/tests/browser/copy-edit-leaving.test.ts`, above `vi.mock('../../src/editor-debounce', () => ({ EDITOR_DEBOUNCE_MS: 3000 }))`

Measured 2026-10-02 under `CPUQuota=25%`, 4 of 20 gaps were over 300 ms and the longest was 1,012 ms; the CI run that failed here measured 309.8 ms. A press sent straight to the browser, with the pointer already on its target, still left 2 of 20 over, so it is the window that is widened and not the gap that is narrowed.

## `web/tests/browser/divider-drag-focus.test.ts`, above `// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported bel`

the focus went to `<body>` with them: measured before `resized` (2026-10-12), with the caret in the source editor and the divider beside it dragged 80 px, `document.activeElement` was `<body>` at once and two frames on, and a key typed next went nowhere.

the second case has the caret out of sight, where a give-back that brought it into sight moved the view from 500 px to 80, while the source view's own box was what scrolled a long program.

## `web/tests/browser/divider-drag-format-on-blur.test.ts`, above `recordFormats()`

measured before the drag was held to it (2026-10-12), a λ copy's editor lost its caret to a drag as the machine copy's did.

## `web/tests/browser/editor-custody.test.ts`, above `it('sends the pre-format text a format in flight is carrying, before the format answers', `

At `bec75f0` this reached nothing while a format was in flight: `format()` had already cleared the editor's own timer, and the pending edit lived only inside its async closure until the server answered, so the record this call is meant to update stayed stale and undo restored text missing the keystrokes typed before *format*, silently.

## `web/tests/browser/editor-custody.test.ts`, above `describe('receiveEditor: where a moved editor sends its edits', () => {`

A `ScratchEditor` is constructed by the pane that FORKS (`LambdaPane.setEditor`'s mount branch), closing over THAT pane's `editScratch`. `receiveEditor` relocates `editor.dom` — which is all the editor-moves rule ever moved — and left the callback pointing at the pane that built it. That is invisible while both panes are on the same buffer, which is the only state the suite ever reached, and becomes a corruption the moment the ORIGINATING pane is rebound: the edit handler it had then resolved `slot.binding.session` at EDIT time, so keystrokes in the moved editor recompiled whatever the first pane was showing by then. The fix that followed re-pointed the handler at the pane holding the editor, which left the same gap one move later; an editor's edits are bound to its copy when it is built now (`transport.ts`'s `editSink`), and the test below holds that.

## `web/tests/browser/editor-custody.test.ts`, above `describe('hasEditor: the third input to the claim control', () => {`

`LambdaPane.#refreshClaim` gated the control on `#detached && #editor === null` and read that pair as "this session has an editor, mounted elsewhere". It was only ever an approximation, and it held because the one way to reach a detached pane whose session had NO editor anywhere — a fork whose build failed — used to end the buffer inside the same reply, putting `#detached` back to `false`. 5d-ii-c decision 2 deleted that retire: nothing ends a buffer implicitly, so the pane stays stranded, both conjuncts stay true forever, and the click records a claim `reconcileEditors` can find no editor for.

## `web/tests/browser/focus-scroll.test.ts`, above `it('is kept when a view key is pressed from the source editor, at 120 px and at the top', `

While the source view's own box was what scrolled, the editor was taller than its view: at 120 px a bare `focus()` put the view at 0, and at 0 `scrollIntoView` on the editor's box put it at 59, the editor's top brought to the view's.

## `web/tests/browser/frame-cost.test.ts`, above `expect(bytesPerSpan).toBeGreaterThanOrEqual(SPAN_WIRE_BYTES / 2)`

Arm A keeping no spans read 0.56 a span, and so did one collection in place of `settle`'s two (2026-10-07). Half, not all: the spans measure 12.56, so at 12 the margin was 0.56 a span, 74 KB over this file's 132,882 spans, and at 6 it is 6.56, 871 KB.

## `web/tests/browser/frame-cost.test.ts`, above `// ONE DISCARDED PAIR FIRST, and it is not superstition: the first pair pays one-time costs the`

and it reads 1.5 bytes/span high because of them (75.66 against 74.08, 74.12, 74.08, 74.08 for the four rounds after it — measured 2026-08-10).

## `web/tests/browser/frame-cost.test.ts`, above `const settle = (): void => {`

**TWO COLLECTIONS, NOT ONE, AROUND EVERY λ READING, SINCE A FRAME'S SPANS ARE A `Uint8Array`.** A typed array that has become garbage is still counted after one forced collection and gone after a second (measured 2026-10-07: 36,000,000 bytes of dropped arrays read +36,002,008 after one `gc()` and +2,008 after two). Arm B drops every frame's spans, so with one collection its reading kept them and the differential read 0.56 bytes a span where the spans hold 12.

## `web/tests/browser/frame-cost.test.ts`, above `// THE READINGS ARE TAKEN AFTER A FULL COLLECTION, AND THAT IS WHAT MAKES THEM A SIZE RATHER THAN A`

A "nothing collected in either window" model predicts a small, one-directional effect: arm B allocates everything arm A does and then the slim frames on top, so the differential would be -(arm B's slim frames) ≈ -13,607 B / 132,882 spans ≈ -0.1 bytes/span. Observed failures ran 40-55x that magnitude and did not agree on sign. Three runs read -3.955, -4.192 and -5.746 bytes/span (500-760 KB of asymmetry) — negative, as the naive model predicts, but far too large for it. A fourth run, paired correctly, does not even agree on sign: 2026-08-10 under `--js-flags=--min-semi-space-size=64` recorded A = [11,339,541, 11,030,920, 11,032,092] and B = [11,058,932, 11,045,332, -25,166,368] (a large collection landing inside arm B's third window) — mean(A) - mean(B) over those matched triples is +91.4 bytes/span, not negative. The same build measured 51.9, 74.6 and 91.4 bytes/span purely by varying V8's GC flags. None of this is "nothing collected" — it is PARTIAL collection landing asymmetrically between the two windows, a regime the model above does not bound and that carries no guaranteed sign. Collecting first removes the variable: every reading below is retained heap, and the figure reproduces TO THE BYTE across browser restarts (9,857,539 for arm A, twice, in the calibration run).

## `web/tests/browser/frame-cost.test.ts`, above `type SlimFrame = { step: number; text: string; cut: Cut | null }`

NOT ONLY `spans` DIFFERS, AND THE OVER-ATTRIBUTION IS MEASURED RATHER THAN WAVED AT. `redex_span` and `owner` are dropped here too, so the differential charges them to spans as well. Measured 2026-08-10 against a third arm that keeps them and drops only `spans`: 74.08 bytes/span with them dropped against 73.63 with them kept — 0.45 bytes, 0.6% of the figure, on a constant that is then rounded up. Dropping them is what keeps this arm a plain object literal with no `LambdaState` shape behind it; paying 0.6% for that is the trade. (That measurement predates `LambdaState.redex` leaving the wire and so also charged the redex path to spans; removing a term the slim arm never had can only have moved the figure DOWN, which is the safe direction for a constant that is rounded up.)

## `web/tests/browser/harness.ts`, above `export async function showFourViews(): Promise<void> {`

a probe read the views area's and the rule table's observed sizes,
the toggles' `hidden`, the rule table's rows and the term's lines as `resetToFourViews` returned, two frames later
and 200 ms after that, and the three readings agreed in 40 rounds of 40, and in 40 of 40 at `CPUQuota=50%`
(2026-10-12).

## `web/tests/browser/harness.ts`, above `export async function historyFills(): Promise<void> {`

As one wait it took 7,504 and 8,590 ms at `CPUQuota=25%` (2026-10-05), against `until`'s 10 s; as two, the
second took up to 6,900 ms.

## `web/tests/browser/harness.ts`, above `export function walkInParts(walk: Walk, shares: readonly number[]): (() => Promise<void>)[`

As one hook, the
1,732 clicks from step 0 into `cmpeq` that three files make ran past Vitest's 30 s on the slower CI runner, in two of
the three files in one run (2026-10-06); the same runner had passed both 48 minutes before, the files at 60 s and
31 s.

## `web/tests/browser/inspector-phone.test.ts`, above `* **`main` IS AT LEAST 15REM TALL, AND BELOW THAT THE PAGE SCROLLS** — the user's decision of 2026-10-05, for pages`

measured at 320 px wide
with `main` at 240 px, Debugger's four
views show 1, 0, 0 and 0 whole lines with the inspector open, the three with headers on two rows having 12.22 px
under them, and 3, 1, 1 and 1 with it closed. With no minimum, `main` was what the page left over, so at 320×320
with the notice gone the cap cut a closed inspector to 27.05 px and its header ran into the step bar; with the
notice up an open one was 7.84 px.

## `web/tests/browser/inspector-phone.test.ts`, above `type Preset = 'debugger' | 'stage' | 'explorer'`

Side by
side, the inspector kept 288 px at every width, so at 390 px in Debugger `#views` was 102 px and each default view 45
px wide, and on the Stage the tab strip was 102 px.

## `web/tests/browser/lambda-deep.ts`, above `export function deepTermSteppedBack(layout: 'code' | 'outline'): void {`

This file compiled `2990 + 0` until the full suite failed with "redextape hit a problem and
recovered: Maximum call stack size exceeded", before the view drew anything, in 1 of 3 runs; alone it passed.
With the browser forced to optimised wasm (`--js-flags=--no-liftoff`) that failure comes every time, and
`N + 0` held at 2,520 and overflowed from 2,540 up, the same in two runs.

## `web/tests/browser/link-hold.test.ts`, above `async function recompilesOffPage(edit: () => void): Promise<void> {`

As one
wait this took 5,111 to 6,387 ms at `CPUQuota=25%` and 9,296 and 10,009 ms at 15 % (2026-10-05 and 06), against
`until`'s 10 s.

## `web/tests/browser/scratch-fork.test.ts`, above `describe('the fork control forks a truncated frame, through the app', () => {`

`WHILE4` IS THE FIXTURE, AND IT WAS MEASURED TO TRUNCATE BEFORE BEING TRUSTED TO — which `2026-08-11-plan5d-iii-editable-lambda.md` asked for in as many words ("verify it does before relying on it"), rather than being this file's own initiative: a probe run against this exact string during this task's development (`compile(WHILE4, 'unary')`, then `lambdaState(FRAME_BYTES)` and `lambdaState(LAMBDA_BYTE_BUDGET)` at each step) found `cut === 'Bytes'` at the 512-byte budget on EVERY one of steps 0 through 9, while the 65,536-byte budget stayed `cut === null` throughout (777-2,095 bytes printed, nowhere near that budget) — truncated at the frame's own print, whole at the readout's, exactly the pairing this test needs.

## `web/tests/browser/session-memory.test.ts`, above `const deltaRatio = deltaThree / deltaOne`

The baselines this probe actually meets differ by a factor of five: ~17 MB on a developer machine against ~62 MB on CI runner `450440e2`, which put main's own reading at 1.5505 against a bound of 1.5 — clearing it by three hundredths. Run 441 then read 1.3281 and failed the build on a branch that had not touched this file, which is exactly the "browser update moved a heap reading two percent" retirement this file's header forbids.

Across the three CI runs that produced the figures above, `deltaOne` read 75,438,868, 75,438,868 and 75,439,880 bytes — constant to within a kilobyte while the resident readings moved by 23 MB.

## `web/tests/browser/session-memory.test.ts`, above `// COLLECTED UNTIL THE HEAP STOPS FALLING. These rounds put tens of thousands of frames into old`

**MEASURED, IN CI RUN 441 ON `450440e2`.** Both arms' baselines rose by the same ~22.9 MB against the run before it on the same runner: arm A's `resident` rose with its `base` (the residue survived both readings) while arm B's did not (it was collected between them), which is uncollected garbage by its own signature rather than anything the app allocated. It dropped the resident ratio from 1.5494 to 1.3281.

## `web/tests/browser/state-diagram-local.test.ts`, above `for (const part of intoCmpeq(tmPane)) beforeAll(part)`

with the walk at its end, the mount's one hook took 14.9 s of its 30 under half a CPU here, and 32.7 s under a quarter.

## `web/tests/browser/state-diagram.test.ts`, above `describe('once the run is inside sub', () => {`

which as the middle of one case's body took 9.9 s of its 15 under half a CPU here, and 11.1 s on CI on the day the walk into `cmpeq` timed out there (2026-10-06).

## `web/tests/browser/step-bar-narrow.test.ts`, above `* Pick the line's example, and wait for its line on the bar and then for the run's result, so nothing on the page`

Measured on 2026-10-01 under a 25% CPU quota, in a run that timed the two separately, `fact(4)`'s line was final 3.1s after the pick's clicks and its result came 10.2s after them, past the 10s `until` gives one wait.

## `web/tests/browser/tm-buffer-restore.test.ts`, above `await until(`

MEASURED by bisecting the window against this test: 150 ms fails, 300 ms passes, so the shipped 500 ms carried a margin of only about 2-3x

## `web/tests/browser/tm-fork-cost.test.ts`, above `* THE TM-FORK-COST PROBE. 5d-iv design §3.1, §4.2.`

The readings that set `MAX_FORK_RULES` were taken on the branch merged as `ec6900b`, while the parse inside `tmScratch` still found a duplicate state name by comparing it with every earlier one, as it had since `50e6126` and no longer does.

## `web/tests/browser/tm-pane-follows-session.test.ts`, above `async function visitNewBuffer(session: string): Promise<void> {`

As one wait that took 7,100 to 10,384 ms in six runs of this file on `53ecbfa` at `CPUQuota=25%`, timing out once, at 10,384 ms under a load average of 35.62. As two, the build and then the value, the value's still held the whole recording and timed out at 10,094 ms under a load of 33.74.

## `web/tests/browser/tm-reduced-buffer.test.ts`, above `async function recordsHalf(`

As one wait the fixture's took 7,792 to 10,207 ms in six runs of this file on `53ecbfa` at `CPUQuota=25%`, timing out once, at 10,207 ms under a load average of 30.17. As two, the build and then the value, the value's still held the whole recording and timed out at 10,001 ms under a load of 21.41, and a spinner's one wait took 7,589 ms under a load of 30.15.

## `web/tests/browser/tm-scratch-fork.test.ts`, above `const atFork = sourceTmReplies`

As one wait this took 7,802 to 10,208 ms in six runs of this file at `CPUQuota=25%` (2026-10-05 and 06), failing once, at 10,104 ms under a load average of 17.79.

## `web/tests/browser/tm-scratch-fork.test.ts`, above `const forkEditorMounted = (pane: HTMLElement): boolean => pane.querySelector('.cm-editor')`

Measured, not assumed: over five runs the first post-click change and the editor's own mount were the same event, at 169/199/211/217/243 ms. So the window had nothing left to reset it and was racing the round-trip directly, at a margin of about 2x on this machine.

## `web/tests/browser/tm-view-narrow.test.ts`, above `* **A WIDER LEVEL, IN A DESKTOP'S LAYOUT, DOES NOT SCROLL, AND ITS ROWS AND COLUMN SIT SID`

The figures are a throwaway probe's on `53ecbfa`'s stylesheet (2026-10-05).

## `web/tests/browser/tm-view-narrow.test.ts`, above `* **AT 1280PX THE TM VIEW'S PANELS ARE WHERE THE FIGURES BELOW PUT THEM**: each box of the`

**AT 1280PX THE TM VIEW'S PANELS ARE WHERE `53ecbfa` DREW THEM**: each box of the rule table's panel and the state diagram's — the header, the toggle, the name, the actions, each radio group and choice, the body, the program level, its grid, its runtime column and each of the column's boxes — at its left, top, width and height against the view's top-left corner, to 0.5px, as a throwaway probe measured them on `53ecbfa` (2026-10-05).

**BUT FOR THE MAXIMISE BUTTON EACH HEADER GAINED** (the view layouts spec §11.3), 24.78px wide at the right end of its actions with the 8px gap before it: the diagram's actions and the radio groups in them are 32.78px further left than `53ecbfa` drew them and the box of the actions that much wider, and the rules' header has a box of actions where it had none (measured on the panel-resizing prototype, 2026-10-12). No panel, header, toggle, name or body moved: the boundary between the two panels is as tall as the gap it took the place of.

## `web/tests/browser/tm-view-narrow.test.ts`, above `let view: EditorView`

The view scrolled sideways: at 390px its `scrollWidth` was 209 against a `clientWidth` of 189, because the diagram panel's header never wrapped, so its actions (*program | local* and *arcs | chips*) ran to x = 409.92, and at 320px the runtime column (`.program-side`, 11rem) ran to x = 342 as well. Every panel header squeezed what it held instead: the panel's name on two lines, each choice of a radio group on a line of its own, `follow current state` on three. And the column took the rows' room: they were 13px wide at 390px and 0px at 320px.

## `web/tests/browser/two-lambda-panes.test.ts`, above `it('keeps a held editor whose claim was dropped when its view’s id was minted again reacha`

what was measured in the running app before the fix is three separate failures from one cause: E1 survived; the sixth step threw `a λ pane was handed a second editor while still holding one` out of `reconcileEditors` -> `applyLayout` -> the click handler, so `renderLayout`, `writeLayoutStorage` and `draw` never ran (the model gained a leaf, the DOM did not, and storage kept the old tree); and E1 LEAKED permanently, because `heldEditors.delete` ran before the `receiveEditor` that threw.

## `web/tests/browser/view-strip-narrow.test.ts`, above `* Pick the line's example, and wait for its line in the λ view and then for the run's result, so nothing on the`

Here, under a 25% CPU quota, three runs on 2026-10-04 put the two together at 5,413, 6,117 and 7,001ms, the last 70% of one wait's 10s

## `web/tests/browser/view-toggles-first-paint.test.ts`, above `const tenth = (n: number): number => Math.round(n * 10) / 10`

**NOT THE HEADER'S HEIGHT AT 390 px**, which this compared before the app was up and after, in Instrument, where the two agree: `main.ts` fills `encoding` and `#appearance` there as at any width, and the header is 136 px in each style in the markup alone and, with the app up, 136 in Paper and Instrument and 181 in Terminal (measured 2026-10-12).

this was one case under a case's cap, and took 6.2 s of it at `CPUQuota=25%` (2026-10-12).

## `web/tests/node/arrangements.test.ts`, above `describe('enter, over generated sequences of switches and edits', () => {`

Counted over the 12 seeds from two views (2026-10-12): 647 gestures made of the 720 drawn, between 95 and 128 of each; 9,226 switches away and back; 1,306 closes and toggles; 75 switches that gave a leaf a new id; and 571 states with an id under two kinds. Over the 12 from `CROWDED`: 53 switches and 32 adds refused.
