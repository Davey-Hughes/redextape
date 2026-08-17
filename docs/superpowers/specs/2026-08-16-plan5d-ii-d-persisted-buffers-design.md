# 5d-ii-d — persisted buffers and the measured cap: a buffer survives the page, and a cap starts counting the thing it was always about

## §1 What is being built, and the two halves it deliberately keeps together

The slice 5d-ii-c filed at itself (§6.1, roadmap:6884-6899):

> **5d-ii-d — persisted buffers and the measured cap.** Persistence of buffer text and the pane→buffer
> bindings, extending the layout format 5d-ii-a's §4.4 defines; the worker-affordability probe; and the
> measured cap that replaces §4.5's provisional eight. Position: after this slice, before 5d-iv.

**THE FILING READS AS TWO SUBSYSTEMS AND THEY ARE KEPT IN ONE SLICE, WHICH IS THE OPPOSITE OF WHAT
5d-ii-c DID TO ITS OWN FILING.** That slice split persistence and measurement apart on the grounds that
"neither of those needs the other's code", and for a slice shipping N buffers that was right. It stops
being right here, and the reason is the restore policy §2 decision 2 takes: a reload that warms N
buffers spawns N threads *at once*, so the affordability question changes from a fork-time cost a user
arrives at one click at a time into a **load-time cost the page pays before the user has done
anything**. Measuring the cap against a workload this slice is simultaneously inventing is the only way
the number describes the app that ships.

They are still two subsystems, and §4 keeps them apart in the code: `buffers-store.ts` does not know a
probe exists, and the probe imports nothing this slice adds to `src/`.

## §2 The decisions

1. **Two storage keys, and the bindings live with the buffers.** `redextape.layout` stays at
   `version: 1` and stays small; a new `redextape.buffers` carries text, labels, the mint counter and
   the pane→buffer bindings. §3.1 is the measurement that forces the split; §4.1 is the format.
2. **Warm bound, cold orphans.** A restored buffer a restored pane names gets a worker; a restored
   buffer nobody is showing comes back as text with no session at all. §4.2.
3. **A cold buffer is a new state, and it falsifies a stated invariant at a site that would crash.**
   §3.2 — this is the finding that outranks the feature in this document.
4. **The cap counts live workers, not buffers.** Cold records are bounded by storage quota instead, and
   the constant is renamed so no reader can carry the old meaning across. §4.4.
5. **`cool` — a buffer may be put to sleep without being retired.** Otherwise the cap's only escape is
   an explicit retire, which destroys work, and decision 2 of 5d-ii-c exists to prevent exactly that.
   §4.5. Auto-cooling an orphan was considered and declined, with a reason.
6. **The threshold is an absolute page budget, pre-registered before any number exists**, and the cap
   is derived from it and then re-measured at the derived count. §4.6.
7. **The collapse state is persisted per buffer**, which answers `pane-chrome.ts:314-316`'s question
   rather than inheriting it a third time. §4.7.
8. **The buffers writer reports a failed write where the layout writer swallows one.** A lost layout is
   a preference; a lost buffer is work. §4.8.

## §3 What verification established before any code was written

Every citation below was read out of the tree at `560d465`, not remembered.

### 3.1 THE LAYOUT IS WRITTEN ON EVERY POINTERMOVE, WHICH DECIDES THE KEY SPLIT BEFORE TASTE DOES

`layout-view.ts:150` binds `pointermove` and calls `onResize` from it. That callback is
`main.ts`'s `setTree(resize(...)); applyLayout()`, and `applyLayout` ends in
`writeLayoutStorage(serializeLayout(getTree()))` (`pane-host.ts:741`). **So dragging a divider
serialises the whole persisted payload and writes it synchronously at pointer rate**, roughly sixty
times a second for as long as the drag lasts.

That is tolerable for a tree of a dozen nodes and it is not tolerable for buffer text. A fork's seed is
the source's step-0 term printed at `LAMBDA_BYTE_BUDGET` (`protocol.ts:10`), which is 65,536 bytes, so
a page at the cap can hold a few hundred kilobytes of text. Putting it behind the same key means every
frame of every drag re-stringifies and re-writes all of it.

**THE ONE-KEY DESIGN IS THEREFORE NOT AVAILABLE WITHOUT FIRST MOVING THE LAYOUT WRITE OFF THE DRAG
PATH**, and that is a change to a path this slice otherwise does not touch. Two keys keeps the layout
write exactly as cheap as it is today and needs no such change. **The per-frame write is still a
defect** and it is filed rather than fixed (§6.2), because two keys make it cost nothing that this
slice is responsible for.

### 3.2 A COLD BUFFER FALSIFIES `main.ts:638`'s INVARIANT AT A SITE THAT WOULD THROW, NOT AT A COMMENT

The buffer list's row builder justifies calling `legOf` without a guard like this
(`main.ts:637-640`):

> `legOf` CANNOT THROW HERE, AND THE REASON IS THE GOVERNING RULE RATHER THAN AN ASSUMPTION: a buffer
> is in `#buffers` and in the registry together or in neither, because `#reg.remove` and
> `#buffers.delete` appear exactly once in `src/` and both are inside `retire`. Every id `list()`
> returns is therefore registered at the moment this runs.

**DECISION 2 MAKES THAT FALSE BY CONSTRUCTION.** A cold buffer is in `#buffers` and in neither
container behind `legOf`, and `SessionRegistry.entryOf` throws on an unknown id deliberately
(`sessions.ts:250-254`: a binding naming a session the registry does not hold *"is a wiring bug, not a
state the UI has an honest rendering for"*). So the first time a user opens the buffer list on a page
that restored an orphan, the row builder throws — from a `beforetoggle` handler, which is a click.

This is the finding that shapes §4.2's work. The invariant is not merely restated in prose: the row
builder needs a temperature branch, and the reasoning that made the guard unnecessary has to be
replaced with the reasoning that makes the branch correct.

### 3.3 `pendingBinding` ALREADY ASKS THE QUESTION A RESTORE NEEDS ANSWERED

`pane-host.ts:215` holds `pendingBinding: Map<LeafId, SessionId>`, and its doc says it answers *"what
session does a leaf with no pane yet start on"*. It is written by a split (`:362`) and by a cross-leg
pick (`:416-422`), and read exactly once, in `applyLayout`'s creation pass:

```ts
const session = pendingBinding.get(l.id) ?? SOURCE_SESSION   // pane-host.ts:683
```

**A RESTORED BINDING IS THE SAME QUESTION ONE PAGE LOAD EARLIER**, so restore seeds this map before the
first `applyLayout()` and adds no second mechanism. The `?? SOURCE_SESSION` fallback is also already
the correct behaviour for every way a binding can fail to resolve — a leaf the tree no longer holds, a
buffer that failed validation, a buffer the cap would not let warm — so none of those needs repair
code.

### 3.4 `ScratchBuffers` HOLDS NO TEXT, AND THE TEXT IT WOULD NEED IS NOT THE TEXT IT IS GIVEN

`fork(slot, src, step)` (`scratch.ts:315`) posts `src` and the step to the worker and keeps neither.
Nothing else in the class holds text: `#buffers` is `Map<SessionId, BufferInfo>` (`:194`) and
`BufferInfo` is `{id, label}` (`:36`).

**AND `src` IS THE WRONG STRING ANYWAY.** It is the *source session's* step-0 term; the worker
re-derives the buffer's term at `step` from it, and the term that comes back is what the editor is
seeded with — `protocol.ts:352` types `scratch-compiled` as carrying `text: string | null`, and
`replies.ts:285` is the arm that mounts it. So the text of record for a fresh fork is only known one
round trip after the fork, and for an edited buffer it is whatever `recompile` was last handed.

Two writers, both already existing call sites, which is what makes §4.3's single owner cheap.

### 3.5 THE WASM HALF CANNOT BE MEASURED THE WAY THE EXISTING PROBE MEASURES IT

`session-memory.test.ts:445-467` records the constraint in full: `usedJSHeapSize` is one V8 isolate's
figure, a worker has its own isolate and its own linear memory, and
`performance.measureUserAgentSpecificMemory` is `undefined` because `crossOriginIsolated` is `false`
under Vitest's server. That probe's answer was to read **one main-thread module instance**
(`:471`, `out.memory.buffer.byteLength`) and reason about threads arithmetically — which is why
5d-ii-c's `MAX_BUFFERS` doc has to spend a paragraph explaining that its one datum "bounds nothing"
about eight buffers.

**A CAP CANNOT BE DERIVED FROM THAT ARITHMETIC, BECAUSE THE ARITHMETIC IS THE THING IN QUESTION.**
§4.6's probe therefore measures N real threads. The precedent for how already exists in the tree:
`tests/browser/depth-cap-worker.ts` is a test-only worker that imports `pkg/` directly, so a probe
worker adds nothing to the production protocol.

### 3.6 THE HEAP HARNESS AND ITS FLAGS ARE REUSABLE AS THEY STAND

`vite.config.ts:290` already passes `--enable-precise-memory-info` and `--js-flags=--expose-gc`, and
`session-memory.test.ts`'s `requireHeapHarness` throws `BLOCKED:` rather than skipping when either is
missing — because without the first flag every delta reads exactly 0 and a probe that silently reads
zeros is worse than no probe. Nothing in §4.6 re-derives any of that.

## §4 The design

### 4.1 THE FORMAT, AND WHAT VALIDATION MEANS HERE

New `buffers-store.ts`, mirroring `layout.ts`'s `serialize`/`parse` split and its rule that validation
checks **invariants and not only shape** — `localStorage` is user-editable, so a payload that parses
and then violates an invariant crashes inside the app, which is strictly worse than falling back.

```
redextape.buffers = {
  version:  1,
  minted:   number,                              // ScratchBuffers.#minted
  buffers:  [{ id, label, text, collapsed }],    // oldest first, as list() answers
  bindings: { [leafId]: sessionId },
}
```

Rejections, each something a person could plausibly type: a wrong or missing `version`; a non-array
`buffers`; a duplicate `id`; a `minted` lower than the highest index its own ids claim (which would let
the next fork mint a name a live buffer already holds — the collision `#minted`'s doc at `scratch.ts:204`
exists to prevent); a non-string `text`; a `bindings` value naming no buffer in the same payload.

**THERE IS NO PER-BUFFER TEXT CAP, AND THE ABSENCE IS A DECISION.** One was drafted and cut: the quota
is already the real bound, it is the bound the browser actually enforces, and §4.8 is already the
report for hitting it. A second number would have to justify itself against a user who legitimately
typed a term longer than whatever it was — and the seed's own ceiling (`LAMBDA_BYTE_BUDGET`) is not
that number, because a user can type past it. Duplicate `id`s and a stale `minted` are rejected because
they make the app produce a wrong state; a long term does not.

**BINDINGS RIDE WITH THE BUFFERS RATHER THAN WITH THE TREE, AND THAT IS WHAT REMOVES THE CROSS-KEY
REPAIR.** A binding is meaningless without the buffer it names, so co-locating them makes "the buffers
key is absent or garbage" degrade to *no bindings at all* — which is today's behaviour exactly, every
pane on the source session, reached without a line of reconciliation. The other direction needs nothing
either: a binding naming a leaf the restored tree does not hold is simply never read, because §3.3's
consumer iterates the tree's leaves.

`redextape.layout` is untouched, still `version: 1`. **Nothing in this slice bumps it**, which is worth
saying because the filing said "extending the layout format": the extension turned out to belong
beside the buffers, and §3.1 is why.

### 4.2 COLD BUFFERS, AND THE TWO SITES THAT LEARN ABOUT THEM

| | warm | cold |
| --- | --- | --- |
| `ScratchBuffers.#buffers` | ✅ | ✅ |
| `SessionRegistry` / `SessionPool` | ✅ | ❌ |
| counts against the cap | ✅ | ❌ |
| has a term, a ring, a play head | ✅ | ❌ — text only |

`fork` splits into **mint** + **`warm(id)`**; `warm` is `fork`'s existing tail (bind a client, add the
registry entry, `client.scratch(gen, text, 0)`) with nothing minted. `cool(id)` is its inverse:
terminate the worker, drop the registry entry, keep the record. `retire(id)` gains a temperature branch
because a cold buffer has no entry to remove.

**`BufferInfo` GAINS `warm: boolean` AND DOES NOT GAIN `text`.** The list is a menu (its own doc,
`scratch.ts:26-35`), and temperature is what a row must show to offer the right control; the text is
this class's private state and no surface outside it renders one.

**ONE SITE LEARNS ABOUT COLD BUFFERS, AND §3.2 IS WHY IT IS NOT OPTIONAL: `main.ts`'s row builder.**
`legOf` is called only for a warm buffer; a cold row shows its label and its temperature, and offers
`warm` where a warm row offers `cool`. The `legOf`-cannot-throw paragraph is replaced by the branch's
own reasoning.

**THE BINDING SELECTOR IS DELIBERATELY NOT THE SECOND SITE, AND THIS PARAGRAPH IS A CORRECTION.** An
earlier draft had picking a cold buffer warm it before the rebind, which reads as the obvious
convenience and is not available at an acceptable price: the selector's options come from
`SessionRegistry.options(leg)` (`sessions.ts:383`), which answers *"a session appears in
`options('lambda')` exactly when it has a leg of that kind"* — and a cold buffer is deliberately not a
session at all. Teaching the registry to offer things it does not hold is the boundary violation the
whole cold/warm split exists to avoid.

**SO TEMPERATURE HAS EXACTLY ONE SURFACE, WHICH IS ALSO THE RIGHT ONE.** The buffer list already owns
reclamation — it is where retire lives, and §4.4 of 5d-ii-c put it there precisely because *"a wedged
buffer has to be reachable whether or not a pane is still showing it"*, which is the identical argument
for a sleeping one. Warm a cold buffer from its row; it becomes a session; it then appears in every
selector on the page by the rule that already exists. `sessions.ts` is untouched by this slice.

### 4.3 THE TEXT OF RECORD HAS ONE OWNER AND TWO WRITERS

`ScratchBuffers` holds the text per buffer. `setText(id, text)` is called from exactly the two places
§3.4 identifies: `replies.ts`'s `scratch-compiled` arm (the worker's authoritative term after a
fork or a rebuild) and `recompile` (the text the user typed).

**THERE IS A THIRD WRITER OF THE FIELD AND IT IS `fork` ITSELF — a correction, whole-branch review before
merge.** "Two writers" is true of `setText`; it is not true of `BufferState.text`, which `fork` seeds
with `src` — the SOURCE session's step-0 term, which §3.4 above calls "the wrong string anyway" — at the
moment the record is created. That seed is DURABLE before the worker answers: `transport.ts`'s `detach`
calls `onBuffersChanged` on its success path, which reaches `refreshBuffers` and therefore
`persistBuffers`, synchronously in the same click. So a fork whose build never succeeds persists the
source's step-0 term forever, and a reload warms it *successfully* at step 0 — a failed fork silently
becomes a working buffer holding a different term.

**IT IS DOCUMENTED RATHER THAN DEFERRED, AND THE REASON IS THAT DEFERRING IS NOT A FIX.** Moving the
fork's persist to the `scratch-compiled` arm narrows the window and removes nothing: the record carries
the seed either way, and four other sites persist the whole collection (a recorded term, a rebind, a
collapse, and `main()`'s write-back), so any later gesture writes the same bytes. Removing the
consequence means not seeding `text` with `src` at all, and the honest alternative — an empty seed —
restores a failed fork as an EMPTY buffer, trading a wrong term for lost work. That is a design change,
not a repair, and it is not made here. `ScratchBuffers.fork`'s own doc carries the same account.

**NOT READ OFF THE `LambdaEditor` AT WRITE TIME.** The editor is a CodeMirror instance whose lifetime
`editor-custody.ts` owns and whose `reconcile` retires orphans; a buffer whose editor has been retired
would have no text to persist, and a buffer that never had one — a fork whose build failed — never had
an editor at all. Persistence would then be reading a fact from the surface least able to answer it.

A persist write is scheduled at `setText`, `fork`, `retire`, `cool`, `warm` and any rebind — every
event that changes what the payload would say, and no others. The text writes are already behind the
editor's 300 ms debounce, so no separate debounce is introduced.

### 4.4 THE CAP COUNTS WORKERS, AND THE CONSTANT IS RENAMED SO IT CANNOT BE MISREAD

`MAX_BUFFERS` → **`MAX_WARM_BUFFERS`**. The rename is the point: every reader of the old name believed
it bounded buffers, and after decision 4 it bounds threads. A number that changed meaning under an
unchanged name is the kind of thing this repo has already had to correct in prose twice.

`BufferCapReached` is unchanged in kind and its message changes to name both escapes — retire, or cool.
It is still raised by refusing, **never** by evicting: decision 2 of 5d-ii-c is that nothing ends a
buffer implicitly, and an eviction is exactly that under another name.

`fork` refuses at the cap as it does today. `warm` refuses on the same test, which is what makes the
restore path safe without a special case: step 4 of §4.9 warms until the cap binds, and the panes that
lose fall back through §3.3's `?? SOURCE_SESSION`. Their buffers stay cold, stay listed, and
`#link-status` reports it — the same surface, and the same `fork failed — ` sibling wording, that
already carries a refused fork.

**THAT STATE IS REACHABLE ONLY BY A CAP THAT DROPPED BETWEEN RELEASES**, since a page cannot have
persisted more warm buffers than the cap it ran under allowed. It is handled by the general rule rather
than by a migration, which is the cheaper of the two and the one that cannot rot.

Tests that exercise the cap import the constant rather than spelling a number, so they follow it.
`tests/browser/two-lambda-panes.test.ts` needs it to be **at least two** (it forks twice inside single
tests) — recorded here because it is the one constraint the measurement is not free to violate.

### 4.5 `cool`, AND WHY AN ORPHAN IS NOT COOLED AUTOMATICALLY

With the cap counting workers, a user who hits it has exactly two things they can do. Without `cool`,
the only one is **retire**, which ends a buffer and its text — so a cap that never destroys work by
eviction would destroy it by leaving no other exit. `cool` is the non-destructive escape, and it is
what makes decision 4 honest rather than merely differently-worded.

**COOLING REBINDS ITS PANES TO THE SOURCE SESSION, EXACTLY AS RETIRING DOES, AND THE INVARIANT THAT
BUYS IS WHAT MAKES §4.2's WHOLE SPLIT SAFE: A COLD BUFFER HAS NO PANES BOUND TO IT.** Added 2026-08-16,
during implementation, after the plan's first draft said the opposite — *"a pane bound to a cooled
buffer keeps naming it, which is what makes warming it again put the pane back in front of its own
term"*. That is unimplementable, and `retire`'s own doc had already written down why: *"`legOf` and
`entryOf` throw for a session the registry does not hold, and `draw()` resolves through both, so a slot
still pointing at a removed entry is an exception on the next frame rather than a blank pane."* A cool
removes the registry entry, so a pane left naming the cooled buffer strands its slot — `draw()` throws
on the next frame, and typing into that pane's editor reaches `recompile`, which throws through the
same `entryOf`.

**IT IS WORTH RECORDING THAT THE INVARIANT IS WHAT THE REST OF THIS DESIGN WAS ALREADY ASSUMING.**
§4.2's restore policy makes orphans exactly the buffers that come back cold; this makes the runtime
agree with the reload. And §3.2's crash — the row builder's unguarded `legOf` — is the only place a
cold buffer still has to be branched on, because with no panes there is no other path that reaches one.
The cost is the convenience the deleted sentence promised: warming does not by itself put a pane back
in front of its term. Warm from the header list, then bind a pane through the selector, which is the
flow §4.2 settled when it made the list temperature's one surface.

**AND THAT FLOW ENDED IN A BUFFER THAT COULD NEVER BE EDITED AGAIN, WHICH IS THE WHOLE-BRANCH REVIEW'S
FINDING AND IS FIXED RATHER THAN FILED.** The rebind this paragraph prescribes destroys the editor
(`draw()` → `LambdaPane.setDetached(false)`'s teardown), and nothing rebuilt one: `warm`'s build lands
with no pane claiming a leaf, so `replies.ts`'s `scratch-compiled` arm — the only mount site there was —
resolved `editorHome` to `undefined`; and the later bind through the selector re-posted no build and
claimed no leaf. The buffer's frames rendered and its text was unreachable, permanently, which made
`cool` destructive of editability while being called "the non-destructive escape". **A λ pane that comes
to be bound to a warm buffer holding no editor now builds one from that buffer's text of record**
(`pane-host.ts`'s `mountScratchEditor`, gated on `EditorCustody.hasEditor` so it can never race the
"bring the term editor to this pane" control, and seeded from `ScratchBuffers.editorSeed` so the text and
the §4.7 collapse flag arrive together). It seeds directly rather than re-posting a build, because a
re-post would supersede the buffer's generation and discard the ring and the play head on an ordinary
rebind — the very cost this section weighs when it declines to auto-cool an orphan.

**THE FIX IS THE λ HALF OF A REPAIR THE TM LEG ALREADY HAD.** `pane-host.ts`'s creation pass seeds a
freshly built `TmPane` from `tmProgramOf` for exactly this reason — "the reply that would have told this
pane has already been and gone" — and `scratch-compiled` is the λ reply with the identical property. So
the mount call sits in the creation pass as well as in the rebind, and the creation pass also runs it on
a split onto an existing buffer, a cross-leg pick back to λ, and `reset layout` — but `hasEditor` gates it
to a no-op on those three, because the buffer's editor already exists there, mounted on a sibling pane or
waiting in `heldEditors`, and reached through the claim control. What the creation-pass call actually
repairs is narrower: a restored layout whose buffer the warming loop above `applyLayout()` has already
warmed is the one route that reaches this line holding a warm buffer with no editor anywhere.

**AUTO-COOLING AN ORPHAN WAS CONSIDERED AND DECLINED.** It is tempting because it would make the
runtime rule identical to the restore rule — bound is warm, orphan is cold, one sentence covering both.
It is declined because warming rebuilds from text at step 0: the ring and the play head do not survive.
Closing a pane is a cheap, frequent gesture today (5d-ii-c made it explicitly non-destructive), and
auto-cooling would make it silently discard a run the user may have spent minutes on. **A close stays
cheap; sleeping a buffer stays a thing a user asks for.**

### 4.6 THE PROBE, AND THE THRESHOLD PRE-REGISTERED BEFORE ANY NUMBER EXISTS

> **THE THRESHOLD: a page at the cap, with every warm buffer holding a real term and its ring driven to
> exhaustion, must sit at or below 512 MiB — main-thread resident heap plus summed per-thread wasm
> linear memory. The cap is the largest count that satisfies it. The threshold does not move.**

**WHY 512 MiB, ARGUED ON ITS OWN TERMS.** This is a tool a user runs beside other tabs, and half a
gigabyte is where one tab starts competing with the rest of a session on an 8 GB machine. It is not
chosen to land near eight — and the figures already in evidence say it will not land far from it:
`protocol.ts`'s `DROP_HISTORY_ON_UNFOCUS` records a wasm module baseline of 8,454,144 bytes paid once
per thread, a λ ring retaining 1.0719× the 32 MiB it is charged, and a single source session at
92,435,664.67 bytes resident. **That is exactly the property #30 filed against this repo for lacking:
this threshold can move the cap in either direction, and a probe that cannot fail is not a gate.**

**FULL RINGS IS DELIBERATELY CONSERVATIVE AND IS SAID RATHER THAN ASSUMED.** Almost no buffer spends
its ring — the same file's fixture ends its λ leg naturally at 253 frames and ~6.3 MB against a 32 MiB
budget. Budgeting the worst case means the cap holds for the user who does the worst thing, and the
report says what the realistic case costs alongside it.

**THE MEASUREMENT, IN TWO HALVES BECAUSE §3.5 SAYS ONE READING CANNOT SEE BOTH:**

| half | how |
| --- | --- |
| rings, main thread | `session-memory.test.ts`'s harness unchanged — forced collection, one discarded warm-up, alternating rounds |
| wasm, per thread | N probe workers, each reporting its own `memory.buffer.byteLength`, summed |

The probe worker is a new test-only file on `depth-cap-worker.ts`'s precedent (§3.5), so no message kind
is added to `protocol.ts` for a measurement's benefit — the fabricated-state shape `session.rs:257-273`
prices.

Measure at N = 1, 2, 4; derive the marginal per-buffer cost; solve for the largest N inside the budget;
**then re-measure at that N**. The last step is what keeps the cap a measurement instead of an
extrapolation, and it is where a non-linearity would show up if there is one.

**THE PROBE IS A MEASUREMENT, NOT A GATE**, and its assertions follow `session-memory.test.ts`'s stated
rule exactly: loose bounds that catch a *broken* measurement — a zero delta, a run that recorded
nothing, a reading in the wrong units — and never the threshold itself. A probe that fails the build
the first time a browser update moves a heap reading two percent is retired within a week, which is the
fate #28 records for a threshold quietly relaxed. The console output is the deliverable; the number it
chose is written where the constant lives.

### 4.7 COLLAPSE STATE, PER BUFFER — THE INHERITED QUESTION, ANSWERED

`pane-chrome.ts:314-316` declines to persist the collapse flag because *"a scratch is retired and
replaced, not resumed, so there is no session for a remembered collapse to describe"*. 5d-ii-c
falsified the premise and passed the question on; this slice answers it.

**PER BUFFER, IN `redextape.buffers`.** The flag describes *this term's editor being hidden*, so it
rides with the buffer and follows it as custody moves the editor between panes. Per-pane was considered
and rejected on a concrete failure: an editor moves, so a collapse remembered against a leaf would
describe whichever buffer happened to land there next — which is the same class of error a reviewer
already caught on this control once, when a remounted editor came back reading "show the term editor"
over an editor that was already showing.

A cold buffer carries the flag unused; it takes effect when the buffer warms and mounts an editor.

**AND "MOUNTS AN EDITOR" HELD ONLY ON THE RESTORE PATH UNTIL THE WHOLE-BRANCH REVIEW, WHICH IS RECORDED
HERE BECAUSE THIS SENTENCE IS WHAT IT FALSIFIED.** A buffer warmed from the header list mounted no editor
at all (§4.5's correction has the full account), so the flag had nothing to take effect on. Both mount
sites read it now, and they read it through one accessor — `ScratchBuffers.editorSeed` answers the text
and the flag together, so a second mount site cannot pair them differently from the first.

### 4.8 THE QUOTA WRITE REPORTS, WHERE THE LAYOUT WRITE SWALLOWS

`main.ts:512-519`'s layout writer catches and does nothing, deliberately: *"the layout still works for
the rest of this page load, it just will not survive a reload"*. **That trade does not transfer.** A
layout is a preference and a buffer is work, and a user who is told nothing will find out at the next
reload, by absence.

So the buffers writer catches, and reports **once per page load** on `#link-status` — not per write,
which on the editor's debounce would repeat every 300 ms of typing. Reads stay silent and fall back, as
`parseLayout` does, because a failed read is indistinguishable from a first visit.

**"ONCE PER PAGE LOAD" IS AN UPPER BOUND AND CAN BE ZERO SECONDS ON SCREEN, which the whole-branch
review before merge found and this paragraph now says rather than leaving to be discovered.**
`#link-status` is one line shared by every writer of `forkFailed`, and two of them clear this report
without the user having asked for anything: `compile.ts`'s `schedule` calls `setForkFailed(null)`
unconditionally, so the first keystroke in the source editor wipes it — and the once-per-load flag stays
set, so nothing can put it back; and on a restored page the §4.9 warming loop writes the cap refusal into
the same field after the start-up write may already have reported. Both are recorded at
`storageFailureReported`'s own doc. Not repaired: a second surface for this is a banner, and `banner.ts`
is the wasm-load and worker-spawn failure surface by its own definition, so widening it is a decision
rather than a fix.

### 4.9 THE RESTORE ORDER

1. Read and parse `redextape.buffers`; on failure, proceed with nothing restored.
2. Seed `#minted`; insert every restored buffer as **cold**.
3. Seed `pendingBinding` from `bindings`.
4. `applyLayout()` — the creation pass builds panes; a λ pane whose pending binding names a cold buffer
   warms it, subject to §4.4's cap.
5. Anything the cap refused stays cold and listed; its pane is on the source session by §3.3's
   fallback, and `#link-status` says so.

Steps 2 and 3 run in `main()` beside the existing layout restore, before the first `applyLayout()` —
the same position, and for the same reason, as `seedLeafCounter` (`main.ts:528`): it is the one moment
ids the app did not mint itself can enter.

## §5 Testing

| tier | file | what it establishes |
| --- | --- | --- |
| node | `buffers-store.test.ts` *(new)* | every §4.1 rejection, each fed as a payload a person could type; round-trip of a valid one |
| node | `scratch.test.ts` *(extend)* | mint/warm/cool/retire over a real registry and pool with fake ports; retiring a cold buffer; warming past the cap refused with `BufferCapReached` |
| browser | `buffer-restore.test.ts` *(new)* | fork two, reload: both return, the bound one warm and showing its term, the orphan cold and listed; the buffer list opens without throwing (§3.2) |
| browser | `buffer-affordability.test.ts` *(new)* | the probe — N probe workers plus the heap harness |

**THE HEADLINE IS THE THIRD ROW AND ITS SECOND CLAUSE.** "The buffer list opens without throwing" is
the assertion §3.2's finding earns, and it is the one that would have caught the crash by walking the
app rather than by reading the code.

The probe follows the branch rule 5d-ii-b and 5d-ii-c both recorded: only one lane runs the browser
tier at a time, and the caveat that an unrelated vitest process on the same machine is outside that
rule's reach applies here more than anywhere, because this file measures memory.

## §6 What this does not do

### 6.1 THE SOURCE PROGRAM IS STILL NOT PERSISTED, AND BUFFER PERSISTENCE IS COHERENT WITHOUT IT

Carried unchanged from 5d-ii-c §6.1, because it reads wrong at first. A reload still yields `SAMPLE`. A
restored buffer beside a source pane showing `SAMPLE` is **not** missing its origin: a `LambdaScratch`
has no `SourceMap` and cannot participate in the sync anchor at all, which is what *detached* means
(5d-i §4.5). The fork has no relationship to the program it came from.

### 6.2 THE PER-FRAME LAYOUT WRITE IS FILED, NOT FIXED

§3.1's measurement stands on its own: `layout-view.ts:150` → `pane-host.ts:741` writes `localStorage`
synchronously at pointer rate for the length of a divider drag. Two keys keep the payload small enough
that this slice does not make it worse, which is why it is out of scope — and it is a real defect, so
it goes on the record here rather than into a task. The fix is a commit-on-`pointerup` or a debounce,
and it belongs to whoever next touches that path.

### 6.3 ACCESSIBILITY GAINS ITEMS, AS EVERY SLICE SINCE 5b HAS

Still deferred to one pass, still gated on 5d-iv's controls settling. Two additions, written here
because the preamble to that list records what happens when a slice declares an item and never writes
it down:

- **Temperature is a state carried in the row's text and its control only.** A cold row and a warm row
  differ by which button they offer, and nothing announces that a buffer changed temperature — which
  it does silently, underneath an open list, whenever the cap refuses a warm.
- **`cool` is a control that changes what other panes show.** Cooling a buffer with panes bound to it
  rebinds them, exactly as retire does, and item 10 already records that retire announces neither.

### 6.4 THE REST

- **No `TmScratch`** — unchanged, still no producer, still 5d-iv's. The TM half of the pair list stays
  untestable here for 5d-ii-c §3.5's reason.
- **No history persistence, and it is not a gap.** A ring is up to 32 MiB per leg and `localStorage` is
  a few megabytes per origin; a restored buffer starts at step 0 with its text, which is what
  `recompile` already means — the text *is* the term.
- **Nothing measures whether anyone works in a multi-buffer layout.** Unchanged from 5d-ii-a, 5d-ii-b
  and 5d-ii-c, and it is still the honest headline: this slice adds bytes, a format and a number, and
  none of them is evidence that two scratch terms side by side is a thing anyone wants.
