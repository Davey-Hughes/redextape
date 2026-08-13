# 5d-ii-c — N scratch buffers: a fork stops being a singleton, and a scratch stops dying by accident

## §1 What is being built, and what was split off it

The last of the three slices 5d-ii-a's §1 splits 5d-ii into. Its filing (roadmap:5967-5971):

> **5d-ii-c — N scratch buffers.** Relaxing 5d-i decision 5's singleton rule to one scratch per fork,
> with scratches as *buffers* that outlive the panes bound to them and are retired by an explicit
> control rather than by closing a pane. It owns the measured session cap and the worker-affordability
> probe 5d-i left open.

**THAT FILING BUNDLES A LIFETIME CHANGE, A UI SURFACE, A STORAGE-FORMAT CHANGE AND A MEASUREMENT, AND
THE LAST TWO ARE SPLIT OUT.** 5d-ii-b ran to thirteen tasks carrying four things; this carried seven
before a line was written. The seam is real rather than convenient: N buffers and their lifetime is a
model-and-chrome change, while persistence is a storage-format change and the cap is a measurement, and
neither of those needs the other's code.

- **5d-ii-c (this slice)** — N buffers, the lifetime that makes them buffers, the header list that
  retires them, and a provisional cap.
- **5d-ii-d (filed by this slice, §6.1)** — persistence of buffer text and bindings, the
  worker-affordability probe, and the measured cap that replaces the provisional one.

## §2 The decisions

1. **A fork always creates a new buffer.** 5d-i decision 5's singleton is one branch; it goes. §3.1.
2. **A buffer survives a recompile from source.** Only an explicit retire ends one. This supersedes
   5d-i decision 5's second half, and moves poison recovery onto the retire control. §3.4, §4.4.
3. **Retire lives in a header-bar buffer list**, because a buffer can outlive every pane bound to it
   and pane chrome cannot reach an orphan. §4.2.
4. **Retiring a buffer rebinds its panes to the source session** — what `retire` already does, made
   plural rather than changed. §4.3.
5. **The cap is provisional and labelled as a choice, not a measurement.** §4.5.
6. **Nothing is persisted.** 5d-ii-d. §6.1.
7. **The TM half of the pair list is NOT re-tested here**, because this slice cannot make it grow.
   §3.5 — this corrects a filing rather than declining an obligation.

## §3 What verification established before any code was written

### 3.1 THE SINGLETON IS ONE BRANCH, AND REMOVING IT FALSIFIES THREE DOCS RATHER THAN ONE

`scratch.ts:136` is the whole rule: `if (!this.#reg.has(this.#id))`. Its doc says so in as many words —
*"THE SINGLETON IS THE `has` BRANCH, AND BOTH CONTAINERS ANSWER IT AT ONCE"*.

**THE COST IS NOT THE BRANCH, IT IS WHAT ARGUES FOR IT.** That same paragraph justifies the branch by
citing two other modules:

> `SessionRegistry.add` and `SessionPool.bind` both THROW on an id they already hold, and both of their
> docs name this call site as the reason: *"§4.3's singleton rebinding is served by asking `has` first,
> which is one branch at the call site against a leak here that nothing would report"*.

So three files carry one argument. Once a fork mints a fresh id every time, those throws become
unreachable **from this path** — they remain correct as guards, but the reason both docs give for
existing stops being true. All three are rewritten in place rather than deleted. 5d-ii-b was billed
four times for citation drift and once for a doc corrected into a different false claim; this is the
same hazard arriving with advance notice.

### 3.2 THE SELECTOR NEEDS NO WORK, AND THAT IS 5d-ii-b's PAYOFF ARRIVING

`SessionRegistry.pairs()` (`sessions.ts:426`) already enumerates every session holding a λ leg, built
from `options`' own source of truth — which keys an entry's `legs` record actually has. `paneSelect`
already groups by leg, keys its rebuild, and removes itself below two pairs.

**N BUFFERS THEREFORE APPEAR IN EVERY PANE'S SELECTOR WITH ZERO NEW CODE.** The pair list was built for
exactly this and has never carried more than one λ scratch. That is worth stating because it is the
first evidence that 5d-ii-b's central decision paid: the axis widened without the control changing.

### 3.3 `retire` ALREADY DOES THE RIGHT THING, KEYED BY THE WRONG NOUN

`retire(home, slots)` terminates the worker and rebinds `slots` back to `home`. Decision 4 is that
signature taking a buffer id instead of assuming the singleton. The behaviour a user sees on retire is
unchanged from today's recompile-terminates path; what changes is what triggers it.

### 3.4 THE RECOMPILE PATH IS A SAFETY MECHANISM, NOT ONLY A LIFETIME RULE

5d-i §4.3: *"Recompile-from-source **terminates the scratch's worker** and rebinds its panes back to the
source session. Same mechanism as poison recovery, per §4.2."*

**DECISION 2 REMOVES A SAFETY MECHANISM, AND SAYING SO IS THE POINT OF THIS SUBSECTION.** Today a
wedged scratch dies on the next compile without the user knowing it was wedged. With buffers surviving
a recompile, nothing reclaims a poisoned worker on its own. That is why the retire control cannot be
deferred to 5d-ii-d alongside the cap: it is not only how a user tidies up, it is the only remaining
escape from a wedged buffer. §4.4.

### 3.5 THIS SLICE CANNOT DISCHARGE THE TM OBLIGATION 5d-ii-b FILED AT IT

5d-ii-b's closing entry (roadmap:6277-6281) says:

> **Whether the TM half of the pair list works at more than one entry.** 5d-i decision 5's singleton
> scratch rule still holds, so `options('tm')` returns exactly the source session today… **5d-ii-c is
> the slice that first makes this false**, and it inherits the obligation to re-test it.

**THAT IS WRONG, AND IT IS WRONG IN A WAY WORTH CORRECTING RATHER THAN QUIETLY SATISFYING.** This slice
relaxes the **λ** scratch singleton. `TmScratch` still has no producer — 5d-i's own §6 records it, and
5d-iv is the slice that lands one — so `options('tm')` still returns exactly the source session and the
TM group still holds one item after this slice ships.

What this slice CAN do is make the λ group grow past one scratch, which exercises grouping, ordering
and the self-removal threshold against a group that is no longer a singleton. The TM-side obligation is
re-filed to **5d-iv** in §6.1.

### 3.6 A CITATION THIS SLICE INHERITED HAD ALREADY ROTTED

**Three sites cited `pane-chrome.ts:234` for the collapse-state argument — 5d-ii-a's design twice
(§3.5 and §6.1) and 5d-ii-b's design once (§6.1).** The file grew in 5d-ii-b, which moved that text to
`:305-307`, and it grew again inside this slice, which moves it to **`pane-chrome.ts:314-316`** —
verified at this slice's close, where it reads:

> Design §4.2 is explicit that this cannot be read as a feature: *"THE STATE IS NOT PERSISTED… a
> persisted collapse preference would outlive every session it described"* — a scratch is retired and
> replaced, not resumed, so there is no session for a remembered collapse to describe.

Found by checking a citation before writing it into this document rather than after. The premise is
falsified by this slice — buffers are resumed by definition — but the question moves to 5d-ii-d for
§6.1's reason, and **all three stale citations are corrected as part of this slice** rather than
carried a fourth time.

**THIS PARAGRAPH ITSELF SHIPPED WRONG ONCE, WHICH IS THE ARGUMENT FOR THE HABIT RATHER THAN AGAINST
IT.** As first committed it claimed the two sites were 5d-ii-a's design and roadmap:6308. The roadmap
names `pane-chrome.ts` with no line number and was never stale; the site it missed was 5d-ii-b's own
design. A grep for the exact string found both errors in the same second the fix was verified — which
is the whole case for grepping the claim instead of reasoning about it.

**AND THE CORRECTION ROTTED AGAIN BEFORE THE SLICE ENDED, WHICH IS THE MORE USEFUL FINDING.** Written
above as `:305-307`, verified against the tree at `1868c34` when this section was drafted, and stale by
nine lines at this slice's close: this slice's own commits (`7043f0f`, `3697c60`, `d37c22a`) grew
`pane-chrome.ts` above that paragraph and moved it to `:314-316`. All five sites carrying `:305-307` —
these two, 5d-ii-a's design twice and 5d-ii-b's design once — were re-corrected during Task 9's closing
sweep. **A line-numbered citation into a file the citing slice itself edits cannot survive that slice**,
and no amount of verifying it at drafting time changes that; the only citations here that have never
gone stale are the ones that name a symbol instead of a line.

## §4 The design

### 4.1 `LambdaScratchpad` BECOMES `ScratchBuffers` — THE SAME RESPONSIBILITIES, PLURAL

```ts
fork(slot: Detachable, src: string, step: number): SessionId   // always creates
retire(id: SessionId, home: SessionId, slots: readonly Detachable[]): boolean
list(): readonly BufferInfo[]                                   // { id, label }
```

**`BufferInfo` CARRIES NO `paneCount`, AND THIS ANNOTATION SAID IT DID.** Corrected in the final
whole-branch review, against the shipped `scratch.ts` — the count is on `BufferRow`, the header list's
own row type, and is computed in `main.ts` from `panes.ofSession('lambda', id).length`. The two types
are deliberately separate: the plan's Self-Review says in as many words *"do not merge them, or
`scratch.ts` gains a `PaneCollection` dependency it has no other reason to hold"*, and `BufferRow`'s and
`ScratchBuffers.list`'s own doc comments each argue the same split. This line was the only place in the
tree stating the opposite, which is the shape of a design annotation that is never compiled against
anything.

**`fork` RETURNS THE ID IT MINTED, WHERE `detach` RETURNED NOTHING.** The caller needs it to record the
pane's new binding, and returning it is what keeps the id's minting in one place rather than having the
caller guess the next name.

Ids and labels are minted together (`scratch-1` / `"scratch 1"`), because `PaneOption.label` comes
straight from `SessionEntry.label` — so the selector reads `λ · scratch 2` with no change to
`paneSelect` (§3.2).

**NO `has`-STYLE BRANCH SURVIVES ANYWHERE IN `fork`.** The rebinding-is-unconditional rule
(`scratch.ts:131-133`) survives untouched and now covers the only conditional left.

### 4.2 THE HEADER LIST, REUSING THE PICKER'S IDIOM RATHER THAN INVENTING ONE

`[buffers 3 ▾]` beside `reset layout`. It is a `popover` anchored to its own button, exactly as
5d-ii-b's split picker is: native `<button>` semantics inside, `aria-haspopup="menu"`, `aria-expanded`
maintained on **both** edges of the toggle, focus moved in on open, and the list built on
`beforetoggle` rather than per frame.

Each row carries the buffer's label, its pane count or `— orphan`, and a retire control.

**NO CONFIRMATION DIALOG, AND THE ROW'S INFORMATION IS THE SAFEGUARD INSTEAD.** Retiring destroys work,
so this is the decision most worth arguing with. Against a dialog: the gesture is already two
deliberate acts — open the list, aim at one row — and a modal would be the first in this app, which
means new focus-trap semantics in a slice whose accessibility budget is already spent on the list
itself. For the safeguard: the row names how many panes are bound, so retiring a buffer with live panes
looks different from reclaiming an orphan **before** the click rather than after it.

### 4.3 WHAT ENDS A BUFFER — THE TABLE IS THE SLICE

| | before this slice | after |
| --- | --- | --- |
| explicit retire | did not exist | **ends it** |
| closing its last pane | ended it | **survives, listed as `orphan`** |
| recompile from source | ended it | **survives** |
| worker error / poison | ended it | **survives; retire is the escape** (§4.4) |
| page reload | ended it | ends it — until 5d-ii-d |

Retiring rebinds every pane bound to that buffer to the source session (§3.3). **A pane is never left
showing a session that no longer exists**, which is the fabricated state `SessionRegistry.entryOf`
throws on and which this codebase refuses to render.

### 4.4 POISON RECOVERY CHANGES HANDS

Decision 2 removes the recompile reset (§3.4). The retire control inherits it, and the list is what
makes that usable: a wedged buffer is visible in the list whether or not a pane still shows it, so the
escape does not depend on the user still having a pane bound to the thing that broke.

**THIS IS WHY §4.2's SURFACE IS IN THIS SLICE AND NOT 5d-ii-d.** Shipping N buffers with no retire
control would remove a safety mechanism and provide nothing in its place.

### 4.5 THE PROVISIONAL CAP, LABELLED THE WAY `MIN_PANE_FRACTION` LABELS ITSELF

`layout.ts:30` sets the idiom: *"0.1 IS A CHOICE, NOT A MEASUREMENT, and is recorded as such."* The cap
gets the same treatment and the same honesty.

**EIGHT BUFFERS, CHOSEN AND NOT MEASURED.** `HISTORY_BYTES` is 32 MB per leg (`protocol.ts`), the
source session holds two legs and each buffer holds one, so eight buffers is ten legs ≈ 320 MB. That is
conservative rather than correct: nothing here measured where the trade actually turns, and 5d-i's
recorded figure — three workers' wasm memory at 2.4153× one worker's, 28,966,912 bytes against
11,993,088 — is the only datum in evidence.

**CORRECTED AFTER THE IMPLEMENTING TASK, AND THE SENTENCE ABOVE IS WHAT WAS WRONG.** It read *"three
threads at 2.4153× one thread's wasm baseline"*, and `protocol.ts`'s own measurement (see
`DROP_HISTORY_ON_UNFOCUS`) says both figures are per-worker **totals**: the first worker held the
probe's whole `Session` and the other two held a `LambdaScratch` of 65,536 bytes and nothing at all, so
`11,993,088 + 8,454,144 + 65,536 + 8,454,144` is the measured 28,966,912 exactly. A ratio under 3× is
therefore a fact about what those two workers were holding, not about anything threads share — against
the bare 8,454,144-byte module baseline the same three totals are 3.43×. The point the sentence was
making survives and is sharper for it: a buffer a user makes holds a term and a ring, which the probe's
second and third workers did not, so this datum bounds nothing about eight of them. The wording was
copied verbatim into `scratch.ts`'s `MAX_BUFFERS` doc and is corrected in both places.

At the cap a fork is **refused with a diagnostic naming the list**, never by evicting a buffer:
decision 2's whole content is that nothing ends a buffer implicitly, and an eviction would be exactly
that wearing a different name.

**THE REFUSAL HAS TWO CLAUSES AND THE SECOND ONE NAMES A SURFACE.** *Refused* is
`ScratchBuffers.fork`'s `BufferCapReached`; *with a diagnostic* is `transport.ts`'s detach handler
catching it and writing the message to `link-wiring.ts`'s `forkFailed`, which `link-status.ts` renders
on `#link-status` as `fork failed — …`. That is the field `replies.ts` already uses for the sibling
refusal — a fork whose build fails — so the two ways a fork can be refused report through one surface.
A throw with no catch reaches the console and nothing else: there is no `window` error handler in
`src/`.

## §5 Testing

**Node tier.** `fork` mints distinct ids across calls and adds a session and a pool entry per call;
`retire` removes one buffer and leaves its siblings running; `retire` rebinds the slots it was handed
and returns whether there was anything to retire; the cap refuses a fork and the refusal names the
count. The singleton's removal is pinned by asserting **pool size grows per fork**, which is the same
axis 5d-i's plan required the singleton be asserted on — the assertion inverts rather than disappears.

**Browser tier — the headline is two λ panes on two DIFFERENT scratch buffers, side by side.** The
direct successor to 5d-ii-a's "two λ sessions" test and 5d-i's node-tier claim, and the first time the
pair list carries more than one λ scratch (§3.2). Then: a recompile leaves both buffers alive and both
panes bound where they were; closing a pane leaves its buffer listed as `orphan`; retiring an orphan
from the list removes it from every pane's selector.

**Every assertion is written against what the user sees rather than against a count the fixture
controls.** Six vacuous assertions were caught across 5d-ii-b — one of which passed because a session's
label made a substring check always true — so a test that names a buffer must assert on the buffer's
own rendered text, not on the presence of a control.

## §6 What this does not do

### 6.1 5d-ii-d, NAMED WITH A POSITION

Filed as a requirement of this slice, for the reason 5d-iv exists at all: the last unnamed capability
fell between two slices for a whole PR.

- **5d-ii-d — persisted buffers and the measured cap.** Persistence of buffer text and the pane→buffer
  bindings, extending the layout format 5d-ii-a's §4.4 defines; the worker-affordability probe; and the
  measured cap that replaces §4.5's provisional eight. Position: after this slice, before 5d-iv.
- **It also inherits `pane-chrome.ts:314-316`'s collapse-state question** (§3.6), whose premise this
  slice falsifies but whose answer needs persistence to mean anything: a remembered collapse is only
  worth storing once the session it describes can come back.
- **Buffer persistence is coherent without source-program persistence**, and that is worth recording
  because it looks wrong at first. Nothing persists the source program today, so a reload yields
  `SAMPLE`. A buffer restored beside a source pane showing `SAMPLE` is not missing its origin — a
  `LambdaScratch` has no `SourceMap` and cannot participate in the sync anchor at all, which is what
  detached MEANS (5d-i §4.5). The fork has no relationship to the program it came from.

### 6.2 THE TM PAIR-LIST OBLIGATION MOVES TO 5d-iv

Re-filed from roadmap:6277-6281 for §3.5's reason: this slice cannot make `options('tm')` return more
than one entry, because `TmScratch` still has no producer. **5d-iv lands that producer and therefore
inherits the obligation to re-test the TM half of the pair list at more than one entry.**

### 6.3 The rest

- **No persistence of anything**, so 5d-ii-a §3.3's "a stored binding has exactly one value that could
  ever resolve" still holds and the layout format is untouched.
- **No accessibility pass.** Still deferred, still gated on 5d-iv. The header list adds one item to the
  standing list — it announces nothing when a buffer is retired underneath it — and takes the same
  exception the picker took: it ships keyboard-operable, because a mouse-only reclamation control is
  inoperability rather than unannounced semantics.
- **No change to the source session.** It is not a buffer, it cannot be retired, and it does not appear
  in the list.
- **No second TM leg, no `TmScratch`.** 5d-iv.
