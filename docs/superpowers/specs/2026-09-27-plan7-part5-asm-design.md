# Plan 7, part 5 — asm: a stepping VM, a third leg, and the asm view — design

Part 5 of [Plan 7](2026-09-17-frontend-overhaul-design.md). It gives the core a stepping asm interpreter,
makes asm the web app's third execution leg beside λ and TM, adds an asm view with a listing and three state
panels, and lets a user edit a copy of the asm — which is the first time the asm language support part 3
built reaches anyone.

It answers the two questions the umbrella's §6 left for this part. **Do asm instructions carry source nodes
for linking?** Yes, already: `lower_asm_mapped` returns one `NodeId` per instruction, and the TM
`SourceMap` composes it and then drops it (§2.2). **Does "edit a copy" extend to asm?** Yes, by the user's
decision (§3). It also **amends one of the umbrella's premises**: §8.3's oracle, "stepping to the end
matches `run_asm`", is circular under §5's own contract that `run_asm` becomes a loop over the stepper, and
§4.4 replaces it with a check against the TM that was measured before this spec was written.

Code facts below were read at `a4e7c6f` (#107, part 4b's squash merge). §12 gives the command behind every
figure.

**Amended 2026-09-27, while writing 5a's plan, from its prototype and before any task.** 1 corrects a
claim the approved text made; 2 measures what it left unmeasured; 3 records a cost it did not state; 4
records where the code went:

1. **`tail` copies the tag stored with the cell's tail; it does not make a list.** §4.3's table put `tail`
   beside `cons` and `nil`, while its own rule — a tag says how the word was made, and a hand-written value
   used as a pointer stays a value — and its own heap cells, which store the tail's tag, say otherwise.
   Built, `tail` copies as `head` does. For a compiled program the two readings agree, since a cell's tail is
   always a list; they part only for a hand-written cell with a value in its tail, which is the case the
   rule exists for (§4.3).
2. **The sequences are measured equal.** §4.4 measured the entry COUNT and left the SEQUENCE for 5a. The
   prototype's oracle finds the asm cursor's instruction sequence equal to the TM's `pc{i}` entries on all
   100 runs: the 46 corpus programs and the 4 latent traps, each under unary and binary (§4.4, §12).
3. **`run_asm` is slower on the cursor.** §4.2 said its signature and results are unchanged, which holds;
   its speed does not. On the 100,000-turn loop it measured 3.9 ms before and 6.2 ms after, on
   `sum(1000)` 0.059 ms and 0.119 ms, on `upto(200)` 0.013 ms and 0.028 ms — the cursor's per-step checks and
   the tags. That is the price of one implementation of the instruction set (§4.2, §12).
4. **The cursor is `trace/asm_cursor.rs`, re-exported from `trace`** as `ZipperCursor` is, and its item is
   its own `AsmStep`, not a `StepEvent` variant: `StepEvent`'s consumers end their loops on a variant they
   do not recognise, which §4.1 left to the plan to weigh (§4.1).

**Amended 2026-09-27 again, from 5a's whole-branch review.** 5 corrects a claim the approved text made:

5. **§4.4's oracles do not hold the display-state rule; a property test does.** §4.3 said the first check
   holds tags and written bits to display state. Every oracle runs compiled programs, which never use a word
   against its tag or read a local nothing wrote, so a gate that faulted on either — `head`, `tail`,
   `box_get` or `box_set` refusing an operand of the wrong tag, or `mov`, `jz`, `bin` or `cons` refusing an
   unwritten local — passed the whole workspace when the review planted it. 5a's
   `a_run_ends_the_same_whatever_its_tags_and_written_bits_say` runs random hand-built programs twice, the
   second with every tag and written bit overwritten before each step, and requires the same end; both of
   those gates, and each single-instruction one tried, fail it (§4.3).

## §1 Scope, and the three PRs

| PR | Contains | Touches |
|---|---|---|
| **5a** | `AsmCursor`; `run_asm` as a loop over it; display tags and written bits; the `SourceMap` and `LinkIndex` keeping each instruction's owner; the three checks of §4.4 | Rust only, `redextape-core` |
| **5b** | a refactor with no behaviour change that turns every two-way λ/TM branch into an exhaustive one; the wasm asm leg; protocol, worker and session support for a third leg; the asm view with its listing, registers, call stack and heap panels; linking; the readout's third segment; the new default tree | `redextape-wasm`, `web/` |
| **5c** | asm copies: *edit a copy*, `asmScratch`, the asm editor with part 3's language support, stored copies at `BUFFERS_VERSION` 3, *new asm copy* | `redextape-wasm`, `web/` |

5a lands first and alone; 5b builds on it; 5c builds on 5b. The umbrella's §3 note that part 5's core half
can run beside `web/` work still holds for 5a.

## §2 What exists

### §2.1 The interpreter runs to completion and cannot step

`run_asm(prog, caps) -> AsmRun` (`crates/redextape-core/src/tm/asm.rs:544`) is one fetch-decode-execute loop
over a private `Vm` (`asm.rs:459`): `locals`, `args`, `rr`, a `heap` of cons cells, `boxes`, a call `stack`
of `Frame { ret_pc, saved_locals }`, `pc`, `steps`, `caps`, and a running count of saved words. It returns
`Ran(AsmOutcome { result, heap })`, `HitCap` or `Fault(String)`. `DEFAULT_CAPS` is 5,000,000 steps, 100,000
frames, 5,000,000 heap cells and 64,000,000 saved words (`asm.rs:429`). Nothing can observe the machine
between two instructions.

Registers hold untyped `u64` words. `Core` carries no types and `lower_asm` reads none, so at run time a
list pointer `3`, the number `3` and a box handle `3` are the same word.

`run_asm` has one production caller, the CLI's `run_asm_artifact`; the rest are tests and
`redextape-native`'s oracles. `redextape-wasm` does not call it: the web app runs no asm today.

### §2.2 Every instruction already knows its construct

`lower_asm_mapped` (`crates/redextape-core/src/tm/lower_asm.rs:151`) returns `(Program, Vec<NodeId>)`, where
`origins[i]` is the `Core` node whose lowering emitted `code[i]`; jumps, prologues and frame setup bill their
enclosing construct, and the final `halt` bills the root. The map is deliberately kept off `Program` so
`Program`'s equality and the goldens do not see it.

`SourceMap`'s `tm_half` (`crates/redextape-core/src/sourcemap.rs:185`) composes it with `lower_tm_mapped`'s
state-to-instruction map, skips the ids `defunc` minted, keeps `tm_name_to_instr`, `tm_listing` and
`tm_labels`, and discards `origins`. After a compile nothing holds instruction → construct. 4b's
`TmProgram.listing`/`labels` and `StateView.instr` are the only asm the web app sees, drawn by the TM
view's program level.

### §2.3 The web app knows exactly two legs

`Leg = 'lambda' | 'tm'` (`web/src/protocol.ts:260`) and `PaneKind = 'source' | 'lambda' | 'tm'`
(`web/src/panes.ts:16`). An inventory by reading at `a4e7c6f` found **14 two-way branches on the leg**, most of
which treat every leg that is not λ as TM, and none of which the compiler can flag when a third leg
arrives — among them
`session-worker.ts:779` (`onExtend`), `scratch.ts:869` and `:1048` (`tmScratch` in the else),
`view-header.ts:28` (`legLabel`), `pane-host.ts:1030` (the else builds a `TmPane`), and `draw.ts:362`
(`isLambda ? … : tmCopySegments`) — plus hand-written two-leg lists such as `LEGS`
(`web/src/sessions.ts:214`), `PANE_KINDS` (`web/src/layout.ts:382`) and the readout's
`[leg('λ'), leg('TM')]`. The inventory is not a gate; §5.1 makes the compiler the gate.

What is already generic over the leg and needs no change: `History`, `player.ts`, `controls.ts`,
`PaneSlot<K>`, and the step bar's binding.

### §2.4 asm language support is served and unconsumed

`redextape-lsp` serves asm diagnostics, format, hover (part 3c), outline and navigation, and `colour.ts` loads
the asm grammar — but `LANGUAGE_OF_PANE` has no asm key and no editor mounts asm (`lsp-protocol.ts:84`: "has
no editor until part 5"). Part 3's spec §5.1 chose this shape so that part 5 inherits a proven language.

### §2.5 asm runs are short

Measured over the three-way oracle's `FIRST_ORDER_DEMOS` (46 programs) and four larger programs (§12):

| Program | Instructions | Steps | Max call depth | Heap cells | Locals | Args |
|---|---|---|---|---|---|---|
| `fact(3)` | 21 | 55 | 4 | 0 | 9 | 1 |
| `fact(12)` | 21 | 181 | 13 | 0 | 9 | 1 |
| `sum(1000)` | 21 | 14,013 | 1,001 | 0 | 9 | 1 |
| `upto(200)` | 21 | 2,813 | 201 | 200 | 9 | 1 |
| a `while` loop, 100,000 turns | 19 | 1,400,009 | 0 | 0 | 13 | 0 |
| corpus maximum | 107 | 260 | 7 | 11 | 23 | 3 |

`fact(3)` is 1,319 λ reductions and 18,574 TM transitions (umbrella §11) against 55 asm steps. "Heap cells"
is the larger of cons cells and boxes, since both are bounded by one cap; "locals" and "args" are one more
than the highest register index the program names.

One behaviour matters for the view: **`call` does not clear the locals.** The callee runs on the caller's
register values until it overwrites them, so inside `fact(0)` the registers `r4`–`r8` still hold `fact(1)`'s
values (hand-traced from the emitted listing, §12).

## §3 Decisions

Made by the user on 2026-09-27, each from a set of options with mockups drawn from `fact(3)`'s listing.

| # | Topic | Decision | Declined |
|---|---|---|---|
| 1 | asm copies | *Edit a copy* extends to asm, in part 5 | a read-only listing; copies later as their own part |
| 2 | Delivery | Three PRs: core, view, copies | four, with the refactor alone; two, with view and copies together |
| 3 | Panels | Registers, call stack and heap, each a collapsible panel | registers and call stack; registers only |
| 4 | Default tree | asm beside TM: source \| λ above asm \| TM | three across the top above TM; asm not in the default |
| 5 | Recording | One windowed frame per step into the existing `History` ring | small frames with state served on demand; delta frames with shared logs |
| 6 | Running line in a copy's editor | Out of part 5, recorded as a leftover | — |

Decision 4 changes what "reset preset" and a first load build. Stored layouts stay valid and keep their
arrangement; asm reaches them through `+ view`, split and the title menus.

## §4 5a — the core

### §4.1 `AsmCursor`

A stepper in the `trace` module beside `TmCursor` and `LambdaCursor`, in its own file,
`trace/asm_cursor.rs` (amendment 4). It **owns the `Vm`
that `run_asm` holds today — moved, not copied**, so the semantics exist once. It iterates, one item per
executed instruction, naming the instruction it executed; whether that item is a new `StepEvent` variant or
its own type is the plan's call, since a variant touches every match on `StepEvent`. It exposes:

- `pc`, `rr`, `locals`, `args`, the call stack, the heap, the boxes, `steps_taken`;
- `wrote()`, the register the last instruction wrote, if any;
- `status()`: running, halted, faulted with the fault's text, or capped **naming which cap** (steps, stack,
  heap or memory) — §8 needs to know whether raising the step cap can help;
- `raise_cap(extra_steps)`, additive, like `TmCursor::raise_cap`.

### §4.2 `run_asm` becomes a loop over the cursor

Its signature, its `AsmRun` results, its caps and its up-front `MAX_REGISTERS` guard are unchanged, so the
CLI, `redextape-native` and every oracle keep calling it as they do. Every existing test and golden must
pass unchanged; that is 5a's first gate. It runs slower — 6.2 ms against 3.9 ms on 1,400,009 steps
(amendment 3).

### §4.3 Display tags and written bits

Each word the cursor holds carries a tag — *value*, *list* or *box* — set by the instruction that creates it
and copied by everything that moves it:

| Creates | Tag |
|---|---|
| `li`, arithmetic, comparisons, `isempty` | value |
| `cons`, `nil` | list (`nil` is the list word 0) |
| `box` | box |
| `mov`; `head` and `tail`, which return the tag stored with that half of the cell; `box_get`, which returns the box's stored tag | the source's tag (amendment 1) |

Heap cells store their head's and tail's tags, boxes their content's tag, and a call frame its saved
locals' tags. For a compiled program this is exact by construction: every word originates at one creating
instruction and every other instruction copies. A hand-written copy can use a *value* as a pointer; the tag
then says *value*, which is true of how the word was made.

Each local also carries a **written bit**: set when the local is written, cleared for every local on `call`
(the callee starts with none written), and restored with the saved locals on `ret`. It drives the view's
"left over from caller" mark (§6.3).

Tags and bits are display state. `run_asm`'s results cannot depend on them. §4.4's oracles run compiled
programs and cannot see a violation; a property test over hand-built programs holds the rule (amendment 5).

### §4.4 The checks — amending umbrella §8.3

§8.3's oracle compares stepping to the end against `run_asm`. Once `run_asm` is the cursor's loop, both sides
run the same code and the check cannot fail. It is replaced by three:

1. **The independent oracles keep passing with `run_asm` on the cursor**: `asm_oracle.rs` (reference ==
   `run_asm` + decode), `tm_oracle.rs` (`run_asm` == TM, both encodings) and `redextape-native`'s
   `native_oracle.rs`. These already hold asm's results against implementations that share no code with it.
2. **The cursor's instruction sequence equals the TM's.** `lower_tm` builds one entry state `pc{i}` per
   instruction, meaning "about to execute instruction `i`". Simulating the machine and recording a `pc{i}`
   each time the machine enters one from a different state yields the sequence of instructions executed,
   by a second implementation. **Measured before this spec (§12): the number of such entries equals the asm
   step count on all 92 runs** — the 46 corpus programs under unary and binary. **And measured in 5a's
   prototype: the sequences are equal on all 100 runs** of those programs and the 4 latent traps
   (amendment 2). The entry rule is "a different state from the step before", not "every step in
   `pc{i}`", because unary's gadgets loop on their own entry states (69 such self-loop rules in one corpus
   machine; binary has none). That rule would merge an instruction that jumps to itself, which only a
   program that never halts contains.
3. **At halt, `rr`'s tag agrees with the program's result type**: *list* for `List<T>`, *value* for `Nat`,
   `Bool` and `Unit`, over the corpus.

Each gets sabotages in the plan that show it can fail: a cursor that mis-steps a `jz`, a `call` that pushes
the wrong return address, a `mov` that drops its tag.

### §4.5 The maps keep each instruction's owner

`SourceMap` gains `asm_owner: Vec<Option<NodeId>>` — `origins` with `defunc`'s minted ids mapped to `None`,
the rule `tm_half` already applies — and `node_to_asm: BTreeMap<NodeId, Vec<usize>>`, its inverse.
`LinkIndex` gains an asm column beside `tm_owner`. The asm leg needs the lowered `Program` itself as well as
its maps; the plan decides whether it comes from `tm_half`'s lowering or a shared one, since the program is
lowered more than once per compile today.

## §5 5b — the third leg

### §5.1 First, a refactor that changes no behaviour

Task 1 of 5b turns each of §2.3's two-way branches into a `switch (leg)` ending in an exhaustive `never`
check, or a `Record<Leg, …>` table, and rebuilds the hand-written two-leg lists from `LEGS`. No test changes.
Then adding `'asm'` to `Leg` and `PaneKind` makes `tsc` name every site still to handle. The plan records
the sibling search — the grep and its output over `web/src` and `web/tests` for `'lambda'`, `'tm'`, `λ` and
`TM` literals — so the inventory in §2.3 is re-derived rather than trusted.

### §5.2 wasm

`Session` gains `asm: Result<AsmLeg, LowerError>`. asm is absent only when lowering fails; where TM declines
a program as too large or overflowing, asm still runs. Methods, named as the λ and TM ones are:
`asmStatus`, `stepAsm`, `asmState(window)`, `raiseAsmCap`, `asmValue`, and `asmProgram`.

- `compile` runs the asm leg to its end, as it already runs TM, so `asmStatus` carries the total step count
  and the step bar can say "step 23 / 55".
- `asmProgram` is a generated wire type carrying the listing (one `print_instr` line per instruction), the
  labels, and each instruction's owner. The TM view keeps its own `TmProgram.listing`; the two are the same
  text from one printer.
- `asmValue` decodes `rr` by the program's result type (`decode_asm_ty`).

### §5.3 The frame

`AsmState`, one per step, bounded by construction:

| Field | Bound |
|---|---|
| `step`, `pc`, `rr` and its tag | — |
| `locals` with tags and written bits | the first 64 |
| `args` with tags | the first 16 |
| `wrote` | — |
| `depth`, and the top call frames, each its return `pc` and saved locals with tags | 8 frames |
| `heap_len`, and the newest cells plus every cell a *list* register points at | 16 newest |
| `box_len`, and boxes | 16 |
| `source_node`, the current instruction's owner | — |

Every corpus program fits whole (§2.5); a deep or list-heavy run shows a window. The bounds are starting
values: 5b's plan measures `asmFrameBytes` over the corpus and the §2.5 programs and fixes them. A frame's
callee is not carried — the instruction before its return `pc` is the `call` naming it.

**A word travels as a decimal string.** Saturating `mul` reaches `u64::MAX`, which a JS number cannot hold
exactly; one form for every word keeps every reader free of a branch. The `ts_bindings` gate's rule that a
`u64` never becomes `bigint` is met by the string.

### §5.4 Protocol and worker

- `Leg = 'lambda' | 'tm' | 'asm'`; `PaneKind` gains `'asm'`.
- `compiled` gains `asm` (its status) and `asmProgram`; `result` gains an asm leg; a new `asm-frames` reply;
  `extend{ leg: 'asm' }`.
- The worker's `recordAsm` has `recordTm`'s shape. `onRun` records λ, then asm, then TM: asm is the
  cheapest leg per step, and TM's recording can run to the 32 MiB budget before a later leg starts.

### §5.5 Around the edges

- **Readout.** A third segment, *asm*: its steps as "N instructions" and its value.
- **Vocabulary.** A step is an *instruction*, as TM's is a *transition* and λ's a *reduction* (umbrella §4).
- **Layout.** `PANE_KINDS` gains `asm`. `defaultLayout()` becomes source | λ above asm | TM (§3, row 4).
  `LAYOUT_VERSION` stays 1: every stored layout is still valid.
- **Language.** `LANGUAGE_OF_PANE` gains `asm → redextape_asm`, used by 5c's editor.
- **Link.** A pin's origin gains `'asm'`.

## §6 5b — the asm view

### §6.1 Layout

The header follows umbrella §4: `asm · program ▾` (the title is the selector) · status · step controls
(when the switch puts them in the view) · panel toggles · `⋯` · `✕`. The `⋯` menu holds split right,
split down and, from 5c, *edit a copy*.

The body is a flex column whose open panels share the height, 4b's mechanism: **listing** two shares,
**registers** and **call stack** side by side in one share (stacking when the view is narrow), **heap** one
share. Each body keeps at least five rows. Each panel's open state is saved per view, as the TM view's are.

### §6.2 Listing

A `role="grid"` like 4b's rule table, and virtualized through `visibleWindow`, because a copy can be long:
one tab stop, an active row named by `aria-activedescendant`, and the arrows, PgUp/PgDn and Home/End moving
it past the drawn window. Label rows sit above the instruction they name, as `print_asm` writes them;
instruction rows read `pc5  jz  r1, else2`. The instruction about to run is `.is-next` and says "runs next"
as generated content — the not-colour cue 4b gave TM's "fires next". A *follow current instruction* header
action re-attaches following, with 4b's `Follow` and its resize-clamp handling; a user scroll or a key that
scrolls detaches it. Row containers take no focus on `mousedown` (4b amendment 18), so a real click lands.

### §6.3 Registers

`pc`, `rr`, `a0…` and `r0…` as name and value. By tag, a word reads as decimal (*value*), `#3` or `nil`
(*list*), or `box #2` (*box*). The register `wrote` names is marked *changed*. A local whose written bit is
clear is dimmed and marked `·`, with a one-line legend, "left over from caller"; each mark also carries an
`aria-description`, so none is colour alone.

### §6.4 Call stack

"call stack · 4 frames", top first. Each frame reads the function it called, `→ pc14` and its saved locals.
Past 8, "+N more".

### §6.5 Heap

"heap · N cells · M boxes", newest first: `#57  57 → #56  ← r5`. The back-reference lists the *list*
registers whose word is that cell, so it is exact for a compiled program. Past the window, "+N older".

### §6.6 Linking

Node-based, the mechanism TM uses:

- Clicking or pressing Enter on an instruction row pins its owner. The source editor, the λ view, every TM
  view and every asm view mark the construct; an asm view marks every instruction billed to it.
- A click in the source or a TM view marks the owned instructions in each asm view and scrolls to them.
- An instruction with no owner — one `defunc` minted — links to nothing, and the link status says so.
- **The running focus follows TM's precedent.** `AsmState.source_node` feeds the asm view's own marks and the
  link-status line's coincidence with the pin. The source editor's focus mark stays λ's, as Plan 5c's
  dual-focus design settled; making it follow the focused view is out of scope (§10).

### §6.7 Accessibility

Nothing is announced per step, as for TM (part 4's §9.3). Every visual mark has a text or ARIA equivalent.
The controls gate (umbrella §8.1) walks the asm view in every preset; its `viewLeaves()` gains the asm leaf.

## §7 5c — asm copies

- **Making one.** *Edit a copy* in the asm view's `⋯` menu copies the whole program with its `result`
  header, as `print_asm_with` writes it; its tooltip says "the whole program", beside λ's "the term at this
  step" and TM's "the whole machine". `compiled` carries the text as `asmText` under a byte cap that 5c's
  plan measures, the role `MAX_FORK_RULES` plays for TM.
- **Running one.** `asmScratch(src)` runs `parse_asm_full` under a byte cap mirroring `MAX_SCRATCH_TM_BYTES`
  and returns an `AsmScratch` with the asm leg's methods. Its listing comes from the parsed program; no
  instruction has an owner, so a copy links to nothing, as a TM copy does.
- **Its value.** Decoded by the header's `result` type when there is one; without it, the raw `rr` word,
  marked as having no result type.
- **The worker.** `onAsmScratch` and an `asm-scratch-compiled` reply; frames are 5b's `asm-frames`.
- **Stored copies.** `PersistedBuffer.leg` gains `asm`; `BUFFERS_VERSION` goes from 2 to 3, and a v2 store
  migrates unchanged.
- **The copies menu** gains *new asm copy*, as TM has a blank copy.
- **The editor.** A copy mounts a `ScratchEditor` in `redextape_asm`, so diagnostics, format, hover, outline,
  definition, references and colour arrive from part 3 unchanged.

## §8 When things fail

Each leaves a working app and at most one notice; none blocks editing or compiling (umbrella §7).

- **Lowering fails.** The asm leg is absent and the view says why, as TM's decline does.
- **A fault** (`head` of an empty list). The run ends as `ended` with a fault value — "faulted at pc12: head of
  empty list" — the end state umbrella §7 assigns.
- **The step cap.** `capped`; *record further* raises it, as for λ and TM.
- **The stack, heap or memory cap.** `capped`, naming the cap. Raising steps cannot help, so *record further*
  is disabled with that reason (umbrella §4, rule 4).
- **The history budget.** `budget`, as for λ and TM.
- **A copy that does not parse.** Diagnostics in its editor and no session, as for TM.

## §9 Testing

| Where | What |
|---|---|
| Rust (5a) | §4.4's three checks; the tag table of §4.3 row by row; written bits across `call` and `ret`; `status()` naming each cap; each with sabotages |
| wasm | `tests/browser.rs` cases for every asm method and the declined leg; the `ts_bindings` gate over the new types |
| node | frame windows; word formatting by tag; `asm` in layout validation; the buffers v2 → v3 migration; `LANGUAGE_OF_PANE`'s keys |
| browser | the listing by real pointer clicks as well as keys (4b's lesson); follow and detach; linking in both directions; the readout's third segment; the controls gate; the asm editor's diagnostics, format, hover and outline (umbrella §8.5) |
| by hand | the three presets, light and dark, at 1280×800, including the new default tree |

Before each PR, beyond `check-all`: the 90% llvm-cov floor, `check-slow.sh`, the six hygiene scans, and
building and running the Docker image, which no PR job builds.

## §10 Out of scope

- **The running instruction's line in a copy's editor** (§3, row 6). `parse_asm_nav` computes each line's
  span only for diagnostics and pushes instructions with no position, so this needs core work first.
- **The source editor's focus mark following the focused view** (§6.6).
- **Linking asm to TM by instruction** rather than by construct. 4b's `StateView.instr` would allow it; it is
  a second link mechanism.
- **Register types from the compiler.** §4.3's tags answer what the view needs at run time; a typed register
  file would need types threaded through `lower_asm`.
- Synchronized stepping across views (umbrella §10).

## §11 Delivery

Each PR gets its own plan, built and gated in a scratch worktree before it is handed out, as 4a's and 4b's
were, and its own roadmap entry. 5a's plan measures §4.4's sequence equality before any task is written
around it.

## §12 Figures, and what produced them

| Value | What | Produced by |
|---|---|---|
| 21, 4, 55, 4, 9, 1 | `fact(3)`'s instructions, labels, steps, call depth, locals and args | `asmprobe` (§A) with `'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'` |
| 181 and 13 | `fact(12)`'s steps and depth | `asmprobe` with `… fact(12)` |
| 14,013 and 1,001 | `sum(1000)`'s steps and depth | `asmprobe` with `fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(1000)` |
| 2,813, 201 and 200 | `upto(200)`'s steps, depth and heap cells | `asmprobe` with `fn upto(n) { if n == 0 { nil } else { cons(n, upto(n - 1)) } } upto(200)` |
| 1,400,009 | steps of a 100,000-turn `while` loop | `asmprobe` with `let mut n = 100000; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc` |
| 107, 260, 7, 11, 23, 3 | the corpus maxima of §2.5 | `asmprobe` with no arguments, over `FIRST_ORDER_DEMOS` copied from `tests/three_way_oracle.rs` at `a4e7c6f` |
| 92 of 92 | runs whose `pc{i}` entry count equals the asm step count | `tmtrace` (§A) with no arguments |
| 69, and 0 | the most self-loop rules on `pc{i}` states in one unary corpus machine (program 26), and in any binary one | `tmtrace`'s `pc_selfloops` column, its maximum over the `u` rows and every `b` row |
| 1,319 and 18,574 | `fact(3)`'s λ reductions and TM transitions | umbrella §11 |
| 100 of 100 | runs whose asm instruction sequence equals the TM's `pc{i}` entries (amendment 2) | 5a's `asm_steps_are_the_instructions_the_tm_enters`, in its prototype |
| 3.9, 6.2; 0.059, 0.119; 0.013, 0.028 ms | `run_asm` before and after the cursor on the loop, `sum(1000)` and `upto(200)` (amendment 3), at 5a's plan's final state | 5a's plan, its appendix's `asmbench`: the median of 15 runs, two rounds each, alternated with `main` |
| r4–r8 left over in `fact(0)` | §2.5's `call` behaviour | hand-traced from `redextape --no-config emit fact.rxt --lang asm` against `run_asm`'s `Call` arm |
| 14 | two-way branches on the leg | a read of `web/src` at `a4e7c6f`, each of the 14 then re-read at its line with `sed` |

Both probes are built with `CARGO_TARGET_DIR` under the repo's `target/` and run under
`systemd-run --user --scope -p MemoryMax=4G` (8G for `tmtrace`).

## §A Probe sources

A scratch crate depending on `redextape-core` by path; `src/corpus.rs` is `FIRST_ORDER_DEMOS` copied from
`tests/three_way_oracle.rs`. **`asmprobe` re-implements no part of the VM**: every run-time figure is the
least cap under which `run_asm` still returns `Ran`, found by bisection, so it measures `run_asm` itself.

`src/main.rs` (`asmprobe`):

```rust
//! Design-stage probe for Plan 7 part 5: per program, the asm run's shape, measured through
//! `run_asm`'s public caps by bisection so nothing here re-implements the VM.
mod corpus;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::asm::{AsmRun, Caps, DEFAULT_CAPS, Instr, Program, Reg, run_asm};
use redextape_core::tm::{LowerError, defunc, lower_asm};

fn program(src: &str) -> Option<Program> {
    let (p, ds) = parse(src);
    if !ds.is_empty() { return None; }
    let core = desugar(&p?);
    match lower_asm(&core) {
        Ok(p) => Some(p),
        Err(LowerError::Unsupported { .. }) => lower_asm(&defunc(&core).ok()?).ok(),
        Err(_) => None,
    }
}

fn ran(p: &Program, c: Caps) -> bool { matches!(run_asm(p, c), AsmRun::Ran(_)) }

/// Smallest v in [1, hi] with ok(v), given ok is monotone and ok(hi).
fn least(hi: u64, ok: impl Fn(u64) -> bool) -> u64 {
    let (mut lo, mut hi) = (0u64, hi); // ok(lo) false-or-untested, ok(hi) true
    while hi - lo > 1 { let m = lo + (hi - lo) / 2; if ok(m) { hi = m } else { lo = m } }
    hi
}

fn regs(i: &Instr) -> Vec<Reg> {
    use Instr::*;
    match i {
        Li(a, _) | Jz(a, _) | Nil(a) => vec![*a],
        Mov(a, b) | Head(a, b) | Tail(a, b) | IsEmpty(a, b) | Box(a, b) | BoxGet(a, b) | BoxSet(a, b) => vec![*a, *b],
        Bin(_, a, b, c) | Cons(a, b, c) => vec![*a, *b, *c],
        Jmp(_) | Call(_) | Ret | Halt => vec![],
    }
}

fn main() {
    println!("idx\tinstrs\tlabels\tsteps\tdepth\theap\tsavedw\tlocs\targs\tsrc");
    let extra: Vec<String> = std::env::args().skip(1).collect();
    let list: Vec<&str> = if extra.is_empty() { corpus::FIRST_ORDER_DEMOS.to_vec() } else { extra.iter().map(String::as_str).collect() };
    for (k, src) in list.iter().enumerate() {
        let Some(p) = program(src) else { println!("{k}\t-\t-\t-\t-\t-\t-\t-\t-\t{src:.60}"); continue };
        if !ran(&p, DEFAULT_CAPS) { println!("{k}\tno-run\t{src:.60}"); continue; }
        let steps = least(DEFAULT_CAPS.steps, |v| ran(&p, Caps { steps: v, ..DEFAULT_CAPS }));
        // `stack` cap: `stack.len() >= cap` refuses a call, so the least passing cap is the max depth
        // reached; 0 passes when no call is made, which `least` over [1,..] reports as 1.
        let depth = if ran(&p, Caps { stack: 0, ..DEFAULT_CAPS }) { 0 } else { least(DEFAULT_CAPS.stack, |v| ran(&p, Caps { stack: v, ..DEFAULT_CAPS })) };
        let heap = if ran(&p, Caps { heap: 0, ..DEFAULT_CAPS }) { 0 } else { least(DEFAULT_CAPS.heap, |v| ran(&p, Caps { heap: v, ..DEFAULT_CAPS })) };
        let mem = if ran(&p, Caps { mem: 0, ..DEFAULT_CAPS }) { 0 } else { least(DEFAULT_CAPS.mem, |v| ran(&p, Caps { mem: v, ..DEFAULT_CAPS })) };
        let (mut locs, mut args) = (0u32, 0u32);
        for r in p.code.iter().flat_map(regs) {
            match r { Reg::Loc(n) => locs = locs.max(n + 1), Reg::Arg(n) => args = args.max(n + 1), Reg::Rr => {} }
        }
        let one = src.replace('\n', " ");
        println!("{k}\t{}\t{}\t{steps}\t{depth}\t{heap}\t{mem}\t{locs}\t{args}\t{one:.70}", p.code.len(), p.labels.len());
    }
}
```

`src/bin/tmtrace.rs` (`tmtrace`):

```rust
//! Design-stage probe: does the TM run enter instruction entry states `pc{i}` exactly once per asm step?
#[path = "../corpus.rs"] mod corpus;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::trace::{StepEvent, TmCursor};
use redextape_core::tm::asm::{AsmRun, Caps, DEFAULT_CAPS, run_asm, Program};
use redextape_core::tm::{EncodingKind, LowerError, TM_DEFAULT_CAPS, TmRun, defunc, lower_asm, run_tm_described};
use redextape_core::typeck::result_type;

fn least(hi: u64, ok: impl Fn(u64) -> bool) -> u64 {
    let (mut lo, mut hi) = (0u64, hi);
    while hi - lo > 1 { let m = lo + (hi - lo) / 2; if ok(m) { hi = m } else { lo = m } }
    hi
}

fn main() {
    let extra: Vec<String> = std::env::args().skip(1).collect();
    let list: Vec<&str> = if extra.is_empty() { corpus::FIRST_ORDER_DEMOS.to_vec() } else { extra.iter().map(String::as_str).collect() };
    let (mut agree, mut differ, mut skipped) = (0, 0, 0);
    println!("idx\tasm\ttm_entries\tpc_selfloops\ttm_steps\tsrc");
    for (k, src) in list.iter().enumerate() {
        let (p, _) = parse(src);
        let prog_ast = p.unwrap();
        let ty = result_type(&prog_ast).unwrap();
        let core = desugar(&prog_ast);
        let prog: Program = match lower_asm(&core) { Ok(p) => p, Err(LowerError::Unsupported { .. }) => lower_asm(&defunc(&core).unwrap()).unwrap(), Err(e) => panic!("{e:?}") };
        let ran = |c: Caps| matches!(run_asm(&prog, c), AsmRun::Ran(_));
        let asm_steps = least(DEFAULT_CAPS.steps, |v| ran(Caps { steps: v, ..DEFAULT_CAPS }));
        for kind in [EncodingKind::Unary, EncodingKind::Binary] {
            let Ok(d) = run_tm_described(&core, kind, ty.clone(), TM_DEFAULT_CAPS) else { skipped += 1; continue };
            if !matches!(d.run, TmRun::Ran { .. }) { skipped += 1; continue; }
            let m = &d.machine;
            let is_pc = |s: u32| { let n = &m.states[s as usize].name; n.starts_with("pc") && n[2..].chars().all(|c| c.is_ascii_digit()) && n.len() > 2 };
            let selfloops: usize = m.states.iter().enumerate().filter(|(i, _)| is_pc(*i as u32)).map(|(i, st)| st.rules.iter().filter(|r| r.next as usize == i).count()).sum();
            let init = d.header.init(m.tapes);
            let mut cur = TmCursor::new(m, &init, TM_DEFAULT_CAPS);
            let mut prev: Option<u32> = None;
            let (mut entries, mut steps) = (0u64, 0u64);
            while let Some(StepEvent::Delta { state, .. }) = cur.next() {
                steps += 1;
                if is_pc(state) && prev != Some(state) { entries += 1; }
                prev = Some(state);
            }
            if entries == asm_steps { agree += 1 } else { differ += 1 }
            let one = src.replace('\n', " ");
            println!("{k}{}\t{asm_steps}\t{entries}\t{selfloops}\t{steps}\t{one:.60}", if matches!(kind, EncodingKind::Unary) { "u" } else { "b" });
        }
    }
    println!("agree={agree} differ={differ} skipped={skipped}");
}
```
