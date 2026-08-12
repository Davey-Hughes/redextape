# 5d-i — the session model: three sessions, three types, three workers, and a detachment that has to be loud

Brainstorm of record: the roadmap's *"5d SPLITS IN TWO, AND ITS SESSION MODEL IS DECIDED AHEAD OF ITS
SLICE"* entry (2026-08-10). **Its six decisions are adopted here unchanged.** This document does three
things the brainstorm did not: it re-verifies every anchor the decisions rest on against the tree at
HEAD, it records the three facts that verification added, and it takes the design down to the type and
function level so a plan can be written against it.

**Nothing here is built yet.** One decision — §4.5 — is deliberately left open for the human, and it is
named as open rather than resolved by default.

## §1 What is being built, and what 5d-ii is not

5d-i is the **session model**: today's three fixed pane slots each gain a *binding* to a
`(session, leg)` pair, and two new session kinds exist for a pane to bind to. The pane set does not
change shape — still three slots, still the same chrome.

5d-ii is the **pane multiplexer**: add/remove panes, layout, persistence. Split for the reason 5a was
split — two independent subsystems in one spec means the layout engine has to be settled before a single
session-from-λ-text exists, and it does not.

**The accessibility pass deferred under Plan 5 is gated on 5d-ii, not on this slice.** 5d-i adds one
control per pane (the binding selector) and one status affordance (§4.5). The roadmap's deferral argues
a11y should wait until the controls settle; the controls settle after 5d-ii.

## §2 The brainstorm's six decisions, and the anchors re-verified at HEAD

Restated in one line each, because a plan should not have to read two documents:

1. **A pane binds to a `(session, leg)` pair**, not to a fixed leg. Source session offers source/λ/TM; a
   λ scratchpad offers only λ. Two panes can show two different λ sessions side by side.
2. **Three types at the wasm boundary, not one with `Option` fields.** `Session` unchanged, plus
   `LambdaScratch` and `TmScratch`. Methods that need a `ty` or a `SourceMap` **do not exist** on the
   scratch types rather than being available-and-declining.
3. **One worker per session.** `session-worker.ts` keeps its one-live-session invariant untouched; the
   pool goes in `session-client.ts`.
4. **`HISTORY_BYTES` is already per leg**, so three sessions is four legs — 2× today's memory, not 3×.
   One knob plus one boolean, default chosen by a probe, no user-facing config.
5. **Detach is a fork, and scratchpads are singletons.** Recompile-from-source terminates the scratch's
   worker — deliberately the same mechanism as poison recovery.
6. **A headerless hand-written machine runs from blank tapes at `MIN_FIELD_WIDTH`, and the pane says so.**

### 2.1 The anchors, and the two that moved

Every line reference the brainstorm cites, checked against HEAD (`b9aef5a`):

| brainstorm cited | at HEAD | status |
| --- | --- | --- |
| `main.ts:146`, `:152` — two independent `History` objects | `main.ts:146`, `:152` | **holds, unchanged** |
| `events(leg, which)` at `main.ts:350` | defined `main.ts:404`, called `:453`, `:454` | **holds, moved** |
| `protocol.ts:33` — `HISTORY_BYTES` "per leg" | `protocol.ts:39` | **holds, moved by 6** |
| `session-worker.ts:97` — `{lambda, tm}` allowance | `session-worker.ts:97` | **holds, exact** |
| `session.rs:252-270` — the pairing argument | `session.rs:257-273` | **holds, moved** |

**Both drifts are PR #31's**, which reflowed doc comments across `session.rs` and `protocol.ts`. No
decision depended on a line number, so nothing changes — but the check is the point. The brainstorm was
recorded a day before two branches landed on exactly these files.

## §3 What verification added, and the brainstorm did not have

### 3.1 `TmState::window` NEEDS THE `SourceMap`, AND A `TmScratch` HAS NONE

The load-bearing finding, and it contradicts nothing in the brainstorm — it *specifies* decision 2 at a
place the brainstorm did not look.

`viewmodel.rs:465` is `pub fn window<M: Borrow<Machine>>(c: &TmCursor<M>, map: &SourceMap, radius: usize)
-> TmState`, and `session.rs:621` calls it as `TmState::window(c, &self.map, radius)`. **`tm_state` is
the method a TM pane renders from on every frame.** A `TmScratch` by decision 2 carries no `SourceMap`,
so as written it cannot call it.

The dependency is **one field**. `viewmodel.rs:478` is the only use:

```rust
let source_node = entry.and_then(|s| map.tm_owner(&s.name));
```

`source_node` is the sync-anchor leg — the Core node this TM state came from — and **a scratch
definitionally has none**. So the right value for a scratch is not "unavailable", it is `None`, which is
already a value this field takes: `tm_owner` has no fallback to a nearby state and returns `None` for
scaffolding today.

**This is decision 2's own question one layer down, and the answer differs.** At the wasm boundary the
brainstorm chose distinct types over one type with `Option` fields, because `session.rs:257-273` records
what the looser shape cost: a fabricated, permanently uncovered user-facing status for a state no
program could produce. Inside `viewmodel` that argument does not transfer — `source_node` is *already*
`Option<NodeId>`, no new state becomes spellable, and there is no status to fabricate. Two
`TmState`-producing constructors would instead duplicate the window/heads/rule computation, which is the
part with logic in it.

**Design: `window` takes `Option<&SourceMap>`.** `Session::tm_state` passes `Some(&self.map)`;
`TmScratch::tm_state` passes `None`; `source_node` becomes `None` on exactly the path where it has no
meaning.

**The blast radius is 13 call sites, and 12 of them are tests.** One production
(`session.rs:621`), one wasm-crate test (`session.rs:1482`), one example
(`examples/frame_cost_probe.rs:293`), and **ten in
`crates/redextape-core/tests/viewmodel_contract.rs`** (`:136`, `:179`, `:202`, `:206`, `:247`, `:304`,
`:318`, `:482`, `:573`, `:588`). All twelve become `Some(&map)`, mechanically. The ratio is worth
stating because it is the argument against the alternative: a second constructor would leave these
twelve untouched and is therefore the cheaper diff — and it would also duplicate the
window/heads/rule computation, which is where the logic is. **Cheap diff, wrong factoring.**

**The counter-case is worth stating because it is the stronger-looking one.** `Option<&SourceMap>` is a
parameter that is sometimes meaningless, which is the shape decision 2 rejected. It is admitted here
because the *output* field is already optional and independently reachable — a `Session` on a program
whose lowering recorded nothing gets `source_node: None` today. The `Option` adds no state to the type;
at the wasm boundary it would have.

### 3.2 THE PROTOCOL NEEDS NO SESSION ID, BECAUSE THE PORT IS THE ID

`RunRequest`/`RunReply` carry a `gen` and no session identifier. With one worker per session (decision
3) **the port a message arrives on already identifies the session**, so routing needs no protocol field.

This falls out of `SessionClient`'s existing shape rather than being designed: `session-client.ts:15-16`
is `#gen = 0` and `#port`, both private, both per instance. **A pool is `Map<SessionId, SessionClient>`
and the generation counter stays per client, which is exactly right** — generations are per session and
always were; there was only ever one session to be per.

Consequence for the plan: **`protocol.ts` changes only if something else forces it.** The pooling work
is confined to `session-client.ts` and the wiring in `main.ts`.

### 3.2b THERE IS NO TOP-LEVEL STATE OBJECT — `main()`'s LOCAL SCOPE IS THE STATE

The finding most likely to be underestimated when pricing this slice, and the brainstorm did not have it.

`main.ts` holds no state container. `lam` (`main.ts:145`) and `tm` (`:151`) are two `const`s in `main()`'s
body, alongside `index`, `linkable`, `link`, `view`, `worker`, `client`, `lambdaPane`, `tmPane` and the
debounce `timer` (`:166-168`, `:446-454`, `:545`). `LegState<T>` (`:64-69`) is
`{ hist, status, done, timer }` — **one leg's bookkeeping, with no session identity in it**, because
there has only ever been one session for it to belong to.

`draw()` (`:170-266`) is the single re-render entrypoint and it closes over those locals directly.

**So "a pane binds to a `(session, leg)` pair" is not a field addition — there is nothing to add a field
to.** 5d-i has to introduce the container that decision 1 presupposes: a session registry keyed by
`SessionId`, each entry owning its own `LegState`s and its own `SessionClient`, with `draw()` reading
through a pane's binding rather than through a closed-over `const`.

**This is a real refactor of `main.ts` and it must be its own task**, sequenced before the pool and
before any pane work. Folding it into "add the pool" is how a plan under-prices a slice — and this
plan's own record (four of five sketches failing contact with the real code, three slices running) says
the failure is normal rather than exceptional.

**Neither pane knows what it is bound to.** `LambdaPane` and `TmPane` both take `(host, on: PaneEvents)`
and nothing else; they are `(frame, controls) -> DOM` renderers. The binding selector and the §4.5 badge
both need a pane to have an identity it currently does not have.

### 3.3 The method split, measured rather than assumed

Which `Session` methods can exist on a scratch, by what they actually read — not by what their names
suggest. Checked by tracing each `lib.rs` export to its `session.rs` body:

**`Session` has NINE fields, not the five this section first assumed** (`session.rs:238-300`): `core`,
`ty`, `lambda`, `initial_lambda`, `tm`, `map`, **`final_tapes`**, **`kind`**, **`total_steps`**. The
last three are what turn one row of this table from "transplants unchanged" into "does not transplant",
so the audit is over all nine and all 19 `pub fn`.

| reads | methods | on `LambdaScratch` | on `TmScratch` |
| --- | --- | --- | --- |
| nothing but the λ cursor | `lambdaStatus`, `stepLambda`, `lambdaState`, `lambdaAst`, `raiseLambdaCap`, `runLambda` | **yes, unchanged** | no |
| nothing but the TM cursor/program | `tmProgram`, `stepTm`, `tapeSlice`, `raiseTmCap` | no | **yes, unchanged** |
| `self.map` | `tmState` (`session.rs:621`), `sourceSpan` (`:734`) | no | **`tmState` only, via §3.1** |
| `self.map` **and** `self.initial_lambda` | `linkIndex` (`:748`) | no | no |
| `self.ty` | `lambdaValue` (`:548`) | no | no |
| `self.ty` **+ `final_tapes` + `kind`** | `tmValue` (`:672`) | no | no |
| **`self.total_steps`** | **`tmStatus` (`:568`)** | no | **NOT unchanged — see below** |
| `self.core` | `evaluate` (`:708`), `evaluateWithBudget` (`:726`) | no | no |

**The `ty` rows are decision 2 stated precisely.** Decoding is type-directed, so `lambdaValue`/`tmValue`
are not merely unavailable on a scratch — there is nothing to decode *against*.

**`sourceSpan` and `linkIndex` exist on neither scratch**, which is §4.5's whole problem: a scratch
cannot participate in the sync anchor at all. `linkIndex` needs `initial_lambda` as well as `map`
(both read in the one statement at `:748`), which is the second, independent reason it cannot move —
and it is consistent with §4.1 dropping that field.

**`tmStatus` is the one method that looked transplantable and is not.** It reports `self.total_steps`,
which a `TmScratch` has no equivalent of: `total_steps` comes from `run_tm_described`, and a scratch is
never described-run — it is stepped. **`TmScratch::tmStatus` therefore needs its own shape**, reporting
what a stepped machine can actually answer (available, halted, capped) and not a total it cannot know.
Sizing this as "reuse `tmStatus`" would be wrong.

**Confirmed transplantable unchanged: ten methods** — six λ, four TM.

### 3.4 DECISION 6 CONTRADICTS AN EXPLICIT REFUSAL ALREADY IN THE TREE

The brainstorm's decision 6 — *"a headerless hand-written machine runs from blank tapes at
`MIN_FIELD_WIDTH`, and the pane says so"* — is implementable, but it is **not** an application of
existing behaviour. It reverses it.

`examples/tm_emit.rs:172-181` is the one place in the tree that branches on a missing header, and it
**declines**:

> A `.tm` file without one records δ and the start state but not an initial configuration, so it
> genuinely cannot be run without the caller supplying `init` by hand.

Mechanically the pieces are all there. `TmProgram::of(&machine, width)` (`viewmodel.rs:412`) needs only
a width, not a header. `MIN_FIELD_WIDTH = 4` exists (`tm/build.rs:54`). Blank tapes are what
`TmHeader::init` (`tm/header.rs:211`) produces anyway when no `tape` directives are given. But
`build_tm_leg` (`session.rs:317-327`) takes `&TmHeader` by required reference and is private, so
**nothing is reused — a headerless path is new code**, and it is the first place in this codebase to
invent a default width and a default init for a machine that did not specify either.

**This is a decision to take deliberately, and decision 6 takes it**: the caller supplying `init` by
hand is exactly what a scratchpad *is*, and `tm_emit.rs` is a batch tool with no user to supply
anything. The two are not in conflict about the facts, only about who is present. **But the plan must
update `tm_emit.rs`'s comment** rather than leave two places in the tree asserting opposite things about
the same condition — that is the failure mode #32's entry records for `lower_tm`'s "cannot drift" doc.

**The pane saying so is load-bearing, not decoration.** A machine running from invented tapes at an
invented width is showing the user something the file did not specify.

## §4 The design

### 4.1 Three types at the wasm boundary

```
Session       — unchanged. ty + core + map + initial_lambda + lambda leg + tm leg.
LambdaScratch — a LambdaCursor. Nothing else.
TmScratch     — TmProgram + TmCursor + Option<TmHeader>. No ty, no map, no core.
```

Constructors are free functions beside `compile`, because a scratch is built from text with no
compilation step. **Both parsers already exist and return the shape needed:**

- `redextape_core::lambda::parse_lambda(src) -> (Option<LambdaTerm>, Vec<Diagnostic>)`
  (`lambda/syntax.rs:50`, re-exported at `lambda.rs:15`). The cursor is then
  `LambdaCursor::new(&term, cap)` — the same call `compile_with_caps` makes at `session.rs:386`.
- `redextape_core::tm::parse_tm_full(src) -> (Option<Machine>, Option<TmHeader>, Vec<Diagnostic>)`
  (`tm/syntax.rs:299`).

Both return diagnostics alongside the value, so both constructors follow `compile`'s hand-built
`js_sys::Object` pattern (`lib.rs:51-65`) rather than a single `to_value` — a handle and plain data
cross the boundary two different ways and cannot go through one serde call.

**The wasm wrapper pattern is a newtype and transplants exactly.** `pub struct Session(session::Session)`
(`lib.rs:30`) with one thin delegating method each, through `err()` (`:161`) and `to_value()` (`:173`).
`LambdaScratch` and `TmScratch` are structurally identical: newtype, own `#[wasm_bindgen] impl`, same
three method shapes.

**`LambdaScratch` does NOT carry `initial_lambda`, and checking why is what corrected this section.**
The field's doc (`session.rs:251-256`) says it is kept "so `link_index` can print step 0 after the
cursor has moved", and `link_index` is its **only** consumer — `session.rs:748` is the one read in the
file. Since §3.3 puts `linkIndex` off both scratch types, the field would be retained for nobody.
`lambdaState` prints from the cursor, not from it.

So decision 2's wording — *"`LambdaScratch` (a `LambdaCursor`, nothing else)"* — is exact, and a first
draft of this section that added `initial_lambda` "for the same `Rc`-bump reason as `Session`" was
carrying a field with no reader on a type whose whole point is that it cannot link.

**`TmScratch` holds `Option<TmHeader>` and that `None` is not an error** — `parse_tm_full` already
returns `Option<TmHeader>` and explicitly does not treat absence as failure. Decision 6 is what `None`
means at the pane: blank tapes at `MIN_FIELD_WIDTH`, and the pane says so.

### 4.2 One worker per session, and the pool in `session-client.ts`

`session-worker.ts` is **untouched**. Its one-live-session invariant is what makes decision 3 safe, and
changing it is the thing this design most wants to avoid.

The pool is a `SessionPool` in `session-client.ts` holding `Map<SessionId, SessionClient>`, spawning a
worker on first bind and `terminate`-ing on unbind. **The argument is damage containment, not
tidiness**, and it rests on two findings the print-depth-cap slice already paid for:

- a stack overflow leaves a wasm-bindgen borrow taken and **poisons the session permanently**;
- a worker's print-stack ceiling **drops after its first deep print and stays down** — the measured
  bracket is [1400, 1497), which is why `MAX_PRINT_DEPTH` is 1,000.

One worker holding three sessions shares both damages across all three. Separate workers keep each
local, and `terminate` + respawn resets both — which is also the mechanism decision 5 reuses for
recompile-from-source, so there is one recovery path and not two.

### 4.3 Detach is a fork, and scratchpads are singletons

Editing a source-derived λ view creates the `LambdaScratch` seeded with **that pane's current text** and
rebinds *that pane* to it. **The source session is untouched and keeps running** — that is the entire
reason three sessions exist rather than one mutable one.

A second edit to another source-derived λ view **rebinds to the existing scratch** rather than making a
second one. Singleton per leg kind: at most one `LambdaScratch` and at most one `TmScratch`.

Recompile-from-source **terminates the scratch's worker** and rebinds its panes back to the source
session. Same mechanism as poison recovery, per §4.2.

### 4.4 Memory: one knob, one boolean, and a probe for the default

`HISTORY_BYTES` is `32 * 1024 * 1024` at `protocol.ts:39` and is **per leg** — `session-worker.ts:97`
keeps `{lambda: HISTORY_BYTES, tm: HISTORY_BYTES}`. So today's single session already holds 64 MB, and
three sessions is **four legs = 128 MB: 2× today, not 3×** (a `LambdaScratch` has one leg, a `TmScratch`
has one leg).

Policy is **one knob** (bytes per leg) and **one boolean** (drop-history-on-unfocus). The boolean's
default is **chosen by a probe, not argued**, reusing `frame-cost.test.ts`'s
`--enable-precise-memory-info` harness.

**No user-facing config.** Three modes would triple the wording of *"recording stopped, history is full
at step N"* for a switch nobody has evidence anyone wants. If a measurement later shows the policies
produce experiences worth choosing between, that is when a control is justified.

### 4.5 DETACHMENT HAS TO BE LOUD — decided 2026-08-11: the status line names it, and the chrome carries a badge

The brainstorm's obligation, restated because it is the thing most likely to be built weakly:

> A scratch session has no `SourceMap` and therefore cannot participate in the sync anchor at all — that
> is what detached *means*. So 5d-i creates the first way to sit in front of three panes that do not
> correspond to one another, and if detachment is subtle the demonstration degrades without saying so.

§3.3 makes this concrete: `linkIndex` and `sourceSpan` **do not exist** on either scratch type, and
§3.1 makes `source_node` `None` for every state a `TmScratch` renders. **Every linking affordance 5b and
5c built goes dead in a detached pane**, and the app currently has no vocabulary for "this pane is not
part of the correspondence".

This is the same standard that deleted `node_to_lambda` rather than let it answer a sometimes-wrong
node, and item 1 of the accessibility list: **a thing that provably cannot work should not be presented
as though it might.**

**DECIDED 2026-08-11: both surfaces, and neither of them colour.**

1. **`link-status.ts` names it.** The line that already narrates the correspondence states which panes
   are outside it — *"λ pane detached — not linked to source"*. This puts the fact where a user already
   looks for linking information.
2. **`pane-chrome.ts` carries a `[detached]` badge**, so a pane is self-describing when the status line
   is off-screen or the user is looking straight at the pane.

Both are **additive to surfaces that already exist**, and the pairing is the point: the status line is
the authoritative narration and the badge is the glanceable one. Either alone has a known hole — a badge
is easy not to notice, and a status line is not where someone editing a pane is looking.

**Whole-pane visual treatment was considered and rejected.** It is the loudest option, but the
accessibility list's standing complaint is that hue is already the sole discriminator for five states
(items 7 and its two aggravations), and a sixth would be added by the slice whose own §6 says it must
not add one. A non-colour carrier — hatching, a border weight — remains available to 5d-ii if the badge
plus line measures as insufficient once there is something to look at.

**Scope consequence, which is why this had to be decided before the plan:** `pane-chrome.ts` and
`link-status.ts` are both in scope. `style.css` gains a badge rule that must not be colour-only.

**The concrete surfaces, verified:**

- **The badge goes on the pane's own `<h2>`.** Both panes build their title in their constructor —
  `LambdaPane` at `lambda-pane.ts:26-56`, and `TmPane` creates its `<h2>` at **`tm-pane.ts:56-57`**
  (`:134-142` is the later `host.replaceChildren(...)` call, which an earlier draft of this line cited
  by mistake). So there is an element to append to and no shared chrome owner to route through. It
  needs a setter analogous to `renderLink`, because a pane has no binding identity today (§3.2b).
- **`tm-pane.ts` ALREADY USES "detached" FOR SOMETHING ELSE, and the collision is accepted rather than
  unnoticed.** `Follow` / `#reattach` / the comments at `:85` and `:108-116` call the δ-table
  *detached* when the user has scrolled it away from the current row — a widget-local scroll fact,
  undone by a button inches away. §4.5's detached means *bound to a scratch session*, undone only by a
  recompile. They combine freely.
  **Kept anyway, on three grounds:** detach is the project's canonical word for the session concept
  (the brainstorm's decision 5 is *"Detach is a fork"*); the δ-table's *user-facing* word is `follow`,
  not detached, so nothing collides on screen — `turing machine [detached]` in the heading against a
  `follow` button by the table; and the badge must agree with the status line's decided wording, which
  says *"λ pane detached"*. The collision is therefore confined to code vocabulary, and is documented
  at `TmPane.setDetached` so a later reader does not unify the two.
- **`link-status.ts` is a pure function over a discriminated union**, which is why this is cheap:
  `linkStatus(s: LinkStatus): string` (`:68-80`) joins parts with `' · '`, and `LinkStatus` (`:31-57`)
  is `{state:'none'} | {state:'stale'} | {state:'linked', …}`. Detachment is a new arm or an added
  field, and **`link-status.test.ts` lives in `tests/node/`** — pure logic, no browser, so §5's
  both-surfaces test splits: the sentence is a node test, the badge is a browser test.

**The a11y hole is inherited, not introduced, and is recorded rather than fixed here.** `#link-status`
announces nothing to a screen reader (accessibility item 6, aggravated by 5c). Adding a third fact to
a silent live region does not make it worse in kind, and fixing it belongs to the deferred pass. **The
badge is the mitigation in the interim** — it is real text in the pane's own chrome, so it is reachable
by a screen reader on the element a user is actually focused on, which the status line is not.

## §5 Testing

- **`window(Option<&SourceMap>)`** — a discriminating test, not a smoke test: same cursor, same radius,
  `Some(map)` yields the real `source_node` and `None` yields `None` **with every other field byte-
  identical**. Reverting to two constructors must fail it.
- **The type split is a compile-time test.** `lambdaValue` on a `LambdaScratch` must not compile. Pinned
  in a `trybuild`-style case or, failing that, asserted against the generated `.d.ts` — the point is
  that absence is checked, not documented.
- **Pool isolation, which is decision 3's whole claim.** Poison one session's worker with a deep print
  and assert the other two still step. A single-worker implementation passes every other test here and
  fails this one.
- **Singleton rebinding.** Two source-derived λ panes edited in turn produce **one** `LambdaScratch`;
  assert on pool size, not on rendering.
- **Recompile-from-source terminates.** Assert the worker is gone, not merely that panes rebound —
  otherwise the leak passes.
- **Headerless machine.** A `TmScratch` from header-free text runs from blank tapes at
  `MIN_FIELD_WIDTH`, and the pane's "no header" affordance is asserted present.
- **Detachment is asserted on both surfaces, and asserted absent when attached.** A test that only
  checks the badge appears would pass an implementation that never removes it. Badge present when set,
  **gone when unset**; sentence present when detached, **gone when attached**.
  **The joint case — bind a pane to a scratch, see both, rebind, see neither — CANNOT be written in
  this slice and is owed by the task that wires `main.ts`.** It needs a binding to flip, and per §3.2b
  none exists: there is no session registry, so there is nothing in the app to drive. Each surface is
  asserted at its own level instead (node for the sentence, browser for the badge, both with their
  attached counterparts). Recorded here rather than left for someone to discover the gap, because a
  deferred test is exactly what this project's log says silently never happens.
- **A detached pane's own clauses are suppressed, not merely preceded.** A detached λ pane is showing a
  scratch term, so *"the λ term is truncated before this construct"* would describe a truncation in a
  term that is not on screen; a detached TM pane's states carry `source_node: null` by construction
  (§3.1), so neither the coincidence nor the emits-no-states absence is a claim about anything visible.
  This follows §4.5's own standard — the one that deleted `node_to_lambda` — rather than adding to it.
  **`'stale'` is the exception and survives detachment**, because *"linking resumes when this compiles"*
  stays true: per §4.3 a recompile is the same event that terminates the scratch and reattaches the pane.
- **The badge is not colour-only.** Assert the badge's accessible text, not its class or its computed
  colour — an implementation satisfying §4.5 by adding a sixth hue must fail this.
- **The memory probe is a measurement, not an assertion.** It produces the number that picks the
  boolean's default; it does not gate the build.

**Pre-registered, before any number exists:** three sessions at four legs must sit **at or below 2× the
single-session resident figure** the same harness measures today. Above that, the drop-history-on-unfocus
default flips to on rather than the threshold moving.

## §6 What this does not do

- **NO EDITABLE PANES — AND THIS SPEC'S SPLIT FORGOT TO ASSIGN THEM (found 2026-08-11, executing T8).**
  The roadmap's Plan 5 entry says *"5d makes the λ and TM panes editable with detach-on-edit"*, and §1
  above splits 5d into the session model (5d-i) and the pane multiplexer (5d-ii). **Neither owns making
  a pane editable**, so the capability fell between them.
  It surfaced as §4.3's trigger having no surface: *"editing a source-derived λ view"* presumes an
  editable λ view, and the pane body is a `<pre>` of decorated tokens carrying 5b/5c's `data-at`
  offsets. §1 also says the pane set "does not change shape" and budgets one control per pane, so T8
  could not build the editor without exceeding this spec. **The gesture shipped as a `✎ fork` button —
  the same event, and a scratchpad that cannot be typed into.**
  So 5d-i delivers **the fork, not the edit**: a scratch session exists, runs independently, is bound
  to a pane, badges itself, and is retired by a recompile. What no one can yet do is change its text.
  **That is a third slice, and it needs a home before 5d closes** — it is CodeMirror instances for the
  derived panes, which is nearer 5d-ii's layout work than 5d-i's session work but is not the
  multiplexer either.
- **`TmScratch` has no producer, so §4.3's two-singleton claim is half-instantiable.** Nothing in the
  app holds `.tm` text to fork from — the TM pane renders tapes and a δ-table, not a source. The type
  and its wasm exports are complete and tested (T3); `protocol.ts` ships `lambda-scratch` and no
  `tm-scratch`. The producer arrives with the editable panes above.
- **No pane add/remove, no layout, no persistence.** That is 5d-ii.
- **No temporal synchronisation.** §6.3's reference-clock stepping stays deferred to v1.5 on its own
  obstruction: normal-order λ reduction can visit constructs in a different order than strict
  evaluation, so "fast-forward λ to construct X" is not always well-defined. After 5c the panes report;
  they do not march in lockstep, and 5d-i does not change that.
- **No accessibility pass.** Gated on 5d-ii per §1. 5d-i must not add a colour-only state — see §4.5
  candidate 2 — but it does not discharge the standing list.
- **No `parse_asm`.** A `TmScratch` reads TM text, not asm. Round-tripping asm remains unclaimed and
  priced out of v1 (Plan 6's survey).
- **No user-facing memory config.** §4.4.
