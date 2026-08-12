# Plan 5d-i — the session model

Design: [`../specs/2026-08-11-plan5d-i-session-model-design.md`](../specs/2026-08-11-plan5d-i-session-model-design.md).
Brainstorm of record: the roadmap's *"5d SPLITS IN TWO"* entry (2026-08-10).

Nine tasks. The Rust half (T1–T3) and the TypeScript half (T4–T7) are **independent up to T8**, which is
the first task that needs both. They can be worked in parallel by different agents, **but not by two
agents sharing a toolchain** — see Global Constraints.

## Global Constraints

- **Design doc is authoritative on *why*.** Every decision's forcing constraint lives there; code
  comments cite it by section. Do not re-derive a decision in a comment — cite it.
- **DO NOT TRUST THIS PLAN'S SKETCHES. VERIFY AGAINST THE REAL SOURCE.** This is the only mechanism
  that has ever lowered this project's plan-defect rate: #32 shipped thirteen plan defects and none in
  the codebase, #30 four of five sketches wrong, #28 four of five, 5c two of five. Every code block
  below is a sketch. If it disagrees with the tree, the tree is right — stop and say so.
- **`panic`, `expect`, `unwrap`, `todo`, `unimplemented` are DENIED in library code.** Allowed inside
  `#[test]` fns and bare `#[cfg(test)]` modules only; `tests/` and `examples/` targets carry a
  file-level `#![allow(...)]`.
- **`clippy::pedantic` is on with nothing allowed globally** (PR #31). New public items need
  `#[must_use]` where they return a value and `# Errors` sections where they return `Result`.
- **The pre-commit hook runs `cargo fmt` + `cargo clippy -D warnings` + biome + `tsc --noEmit`.** A
  commit that does not compile cleanly cannot be made. **Never `--no-verify`.** If a task's commit split
  turns out infeasible, collapse the commits and say so.
- **Comment style is this repo's and it is heavy**: explain *why*, name the alternative rejected, cite
  measurements and line references. `///` in Rust, `/** */` in TypeScript — `///` is inert in TS.
- **`exactOptionalPropertyTypes` is on.** Optional properties are added by spread; see `main.ts:404-444`.
- **TOOLCHAIN EXCLUSIVITY FOR PARALLEL AGENTS.** Two agents must not run `cargo` concurrently in this
  worktree, and two must not run vitest concurrently — vitest's `-- <name>` filter does not scope
  *files*, so a second run re-runs everything and the two fight. One cargo agent, one vitest agent.
- **Verify before claiming.** Run the command, read the output, then report. Local gate:
  `scripts/check-all.sh --no-llvm --no-browser` for Rust, `pnpm run typecheck && pnpm run test:node`
  for web.
- **The browser tiers need Chrome, which is at `/usr/sbin` and off PATH.** `wasm-pack test --headless
  --chrome` and vitest's `browser` project both look unavailable when they are not. If a browser tier
  genuinely cannot run, say so explicitly — never report it as passing.

---

### T1 — `TmState::window` takes `Option<&SourceMap>`

Spec §3.1. **Pure refactor, no behaviour change on the `Session` path.** Do this first: T3 depends on it
and nothing depends on T3 being late.

`crates/redextape-core/src/viewmodel.rs:465`:

```rust
pub fn window<M: Borrow<Machine>>(c: &TmCursor<M>, map: Option<&SourceMap>, radius: usize) -> TmState
```

`:478` becomes `let source_node = map.and_then(|m| entry.and_then(|s| m.tm_owner(&s.name)));` — check the
real binding order against the source, the sketch may have `entry` and `map` the wrong way round.

**13 call sites, 12 of them tests.** `session.rs:621` (production) and `session.rs:1482`,
`examples/frame_cost_probe.rs:293`, and `tests/viewmodel_contract.rs` at `:136`, `:179`, `:202`, `:206`,
`:247`, `:304`, `:318`, `:482`, `:573`, `:588`. All become `Some(&map)`.

**The doc comment must carry §3.1's argument**, because the shape looks like the one decision 2
rejected: `Option<&SourceMap>` is admissible here and not at the wasm boundary because `source_node` is
*already* `Option<NodeId>` and independently reachable — a `Session` whose lowering recorded nothing
gets `None` today — so the parameter adds no state to the type. Name the rejected alternative (a second
`window_unmapped` constructor) and why: it duplicates the window/heads/rule computation, which is the
part with logic in it.

**Test.** One discriminating test in `viewmodel_contract.rs`: same cursor, same radius, `Some(map)`
yields the real `source_node`, `None` yields `None`, **and every other field is equal between the two**.
Assert the whole struct, not just `source_node`.

**Mutation:** make the `None` arm return the mapped `source_node` anyway (drop the `map.and_then`).
**Expected failure:** the new test's `None` case fails on `source_node`, and nothing else fails —
which is also what proves the other twelve call sites were untouched in behaviour.

---

### T2 — `LambdaScratch`

Spec §4.1, §3.3. Independent of T1 and T3.

**Inner type in `session.rs`: a `LambdaCursor` and nothing else.** Not `initial_lambda` — its only
consumer is `link_index` (`:748`), which does not exist on a scratch, so the field would be retained for
nobody. §4.1 records that a first draft got this wrong; do not re-add it.

Constructor from text via `redextape_core::lambda::parse_lambda(src) -> (Option<LambdaTerm>,
Vec<Diagnostic>)` (`lambda/syntax.rs:50`), then `LambdaCursor::new(&term, cap)` — the same call
`compile_with_caps` makes at `:386`. **Check what cap that call actually passes** before copying a
constant into this one.

**Six methods transplant unchanged** (§3.3): `lambdaStatus`, `stepLambda`, `lambdaState`, `lambdaAst`,
`raiseLambdaCap`, `runLambda`. **`lambdaValue` must NOT exist** — it reads `self.ty` (`:548`) and there
is nothing to decode against.

wasm wrapper: newtype `pub struct LambdaScratch(session::LambdaScratch)` per `lib.rs:30`'s pattern, own
`#[wasm_bindgen] impl`, delegating through `err()` (`:161`) and `to_value()` (`:173`). The free
constructor follows `compile`'s hand-built `js_sys::Object` assembly (`:51-65`) because a handle and
diagnostics cross the boundary two different ways.

**Test.** Native, beside `Session`'s in `session.rs`'s `#[cfg(test)] mod tests` (from `:752`). Plus a
browser-tier test in `crates/redextape-wasm/tests/browser.rs` going through `js_sys::Reflect` like every
test in that file — the tier exists to prove the *glue*, not to re-run native tests.

**The absence of `lambdaValue` is itself a test**, and it is a compile-time one. Assert it against the
generated `.d.ts`, or with a `trybuild`-style case. A comment saying "we did not add it" is not a test.

**Mutation:** add `lambdaValue` to the wrapper, delegating to a hardcoded `Decoded`. **Expected
failure:** the absence test fails. If it passes, the absence was documented and not checked.

---

### T3 — `TmScratch`, and the headerless machine

Spec §4.1, §3.4. **Depends on T1.** The largest Rust task and the one with a real decision in it.

Inner type: `TmProgram` + `TmCursor<Rc<Machine>>` + `Option<TmHeader>`. Constructor via
`parse_tm_full` (`tm/syntax.rs:299`).

**Four methods transplant unchanged**: `tmProgram`, `stepTm`, `tapeSlice`, `raiseTmCap`. **`tmState`
works only because of T1**, passing `None`. **`tmValue` must NOT exist** — `ty` + `final_tapes` + `kind`.

**`tmStatus` DOES NOT TRANSPLANT and this is the trap in this task.** It reports `self.total_steps`
(`:568`), which comes from `run_tm_described`; a scratch is *stepped*, never described-run, so it has no
such total. Write `TmScratch::tm_status` its own shape reporting what a stepped machine can answer —
available, halted, capped — and **not a total it cannot know**. Do not fabricate a `total_steps: 0`;
`session.rs:257-273` records at length what fabricating a status for an unreachable state cost last
time.

**The headerless path is new code, not reuse.** `build_tm_leg` (`:317-327`) takes `&TmHeader` by
required reference and is private. With `Some(header)`: `width = header.width`,
`init = header.init(machine.tapes)`. With `None`: `width = tm::MIN_FIELD_WIDTH` (`tm/build.rs:54`),
`init` = blank tapes, which is what `TmHeader::init` (`tm/header.rs:211`) yields anyway with no `tape`
directives. `TmProgram::of(&machine, width)` (`viewmodel.rs:412`) needs only the width.

**Also update `examples/tm_emit.rs:172-181`.** It is the one place in the tree that branches on a missing
header and it declines, on the stated grounds that such a file *"genuinely cannot be run without the
caller supplying `init` by hand."* That stays true for a batch tool with no user — but after this task
the tree has a second answer, and two places asserting opposite things about one condition is exactly
what #32's entry records for `lower_tm`'s "cannot drift" doc. **Amend the comment to name the scratch
path and why it differs (a scratchpad IS the caller supplying init by hand). Do not change tm_emit's
behaviour.**

**Test.** A headerless machine builds, steps, and reports blank tapes at `MIN_FIELD_WIDTH`. A machine
*with* a header is byte-identical to what the `Session` path produces for the same text — that is the
test that catches a headerless default leaking into the mapped path.

**Mutation:** use `MAX_FIELD_WIDTH` for the headerless default instead of `MIN_FIELD_WIDTH`.
**Expected failure:** the blank-tape width assertion fails with a concrete width, not a shape error.

---

### T4 — the session container in `main.ts`

Spec §3.2b. **Pure TypeScript, no behaviour change, no new feature.** Sequenced before T5 and T7 because
both presuppose it. **This is the task most likely to be under-priced** — the spec says so and this plan
repeats it.

There is no state object today. `lam` (`main.ts:145`) and `tm` (`:151`) are `const`s in `main()`'s body
alongside `index`, `linkable`, `link`, `view`, `worker`, `client`, both panes and the debounce `timer`.
`LegState<T>` (`:64-69`) is `{ hist, status, done, timer }` with **no session identity in it**.

Introduce the registry decision 1 presupposes: an entry per session owning its own `LegState`s and its
own `SessionClient`, keyed by a `SessionId`. `draw()` (`:170-266`) reads through a pane's binding rather
than through a closed-over `const`.

**Do this as a pure refactor with the behaviour frozen.** One session in the registry, every existing
test green, no new capability. **A refactor that lands together with the feature it enables cannot be
reviewed** — and this one touches the single re-render entrypoint.

**Test.** The existing suite is the test. `pnpm run test:node` and `pnpm run test:browser` must be green
with **no test file edited**. If a test needs changing to pass, the refactor changed behaviour — stop and
report which test and why, rather than editing it.

**Mutation:** point two registry entries at one `LegState`. **Expected failure:** an existing
history/playback test fails, because two panes now share a play head. If nothing fails, the registry is
not actually being read through and the refactor is cosmetic.

> **CORRECTION, from executing this task (2026-08-11, commit `18976ed`).** Three defects, all found by
> doing it rather than reading it.
>
> **The mutation as specified is not executable.** *"Point two registry entries at one `LegState`"*
> needs two entries, and this same task mandates one session in the registry. The only executable
> reading is the two **leg slots** of the one entry — which the stated expected failure confirms was
> the intent. The sentence asked for something the task forbids.
>
> **The blast radius was understated by 30×. Thirty of 76 browser tests failed, not one.** Aliasing
> puts both legs into one `History`, so the λ pane receives `TmState` frames and `spans.ts:26`'s
> `byteToIndex` throws `TypeError: text is not iterable` before most assertions run. The canonical
> failure was the predicted one — `expected 'step 2,878 of 2,878' to contain 'step 7'` — but anyone
> looking for a single clean failure would conclude they had mutated the wrong thing. **A mutation's
> expected failure needs a COUNT, not just a name.** Applied to T5 below, where it mattered again.
>
> **`play`'s signature had to change and this task did not anticipate it.** `<T>(leg: LegState<T>)`
> stops compiling once the caller passes `SessionLegs[K]` — `T` is not inferable from an indexed
> access over a type variable (TS2345). Now `(leg: AnyLeg)`, which is what it always meant. The one
> place "pure refactor" touched a signature for a reason that is not the registry.
>
> **Carried to T7:** because `Binding` carries the leg in its type, aliasing two legs cannot be
> written without `as unknown as LegState<TmState>`. **The cast the mutation needs is itself the
> evidence the types hold.** A selector letting a pane point at any `(session, leg)` must re-derive
> that property or knowingly lose it.
>
> **§3.2b is half-discharged by design.** The entry owns its `SessionClient`, but `main()` still owns
> the `worker` local and its `error` listener, because spawning is T5's. Every spec line reference
> checked at HEAD held with no drift.

---

### T5 — `SessionPool` in `session-client.ts`

Spec §3.2, §4.2. **Depends on T4.**

**`protocol.ts` does not change.** With one worker per session the port *is* the session id, so
`RunRequest`/`RunReply` need no routing field. `SessionClient`'s `#gen` (`:15`) stays per client, which
is what it always should have been — generations are per session and there was only ever one session to
be per. **If you find yourself adding a session id to the protocol, stop: something else is wrong.**

`SessionPool` holds `Map<SessionId, SessionClient>`, spawns a worker on first bind, `terminate`s on
unbind. **`session-worker.ts` is not edited.** Its one-live-session invariant is what makes this safe.

**The argument is damage containment**, and the comment must say so with the two findings the
print-depth-cap slice paid for: a stack overflow leaves a wasm-bindgen borrow taken and poisons the
session permanently, and a worker's print-stack ceiling drops after its first deep print and stays down
(measured bracket [1400, 1497), which is why `MAX_PRINT_DEPTH` is 1,000). One worker holding three
sessions shares both damages.

**Test.** In `web/tests/node/` beside `session-client.test.ts`, which is pure-logic and browser-free —
`ClientPort` (`:9-12`) is a structural interface precisely so this is testable without a thread.

**Pool isolation is decision 3's whole claim and needs a browser test**: poison one session's worker
with a deep print and assert the other two still step. **A single-worker implementation passes every
other test in this task and fails only this one.**

**Mutation:** back the pool with one shared worker. **Expected failure:** only the isolation test fails.

> **CORRECTION, from executing this task (2026-08-11, commit `d1bc8c1`). Two claims in this task are
> false, and both were caught by running it.**
>
> **THE POISON THIS TASK NAMES IS NO LONGER REACHABLE.** "Poison one session's worker with a deep
> print" describes a real hazard — `depth-cap.test.ts`'s second case is the 2026-08-09 repro where an
> aborted print left wasm-bindgen's reentrancy borrow taken — but **PR #25's `MAX_PRINT_DEPTH` closed
> it**, capping every print a session makes, so a deep term reports a `Depth` cut instead of aborting.
> Measured before believing it: a real worker driven at N = 1,500 / 2,000 / 2,900 answered
> `compiled / lambda-frames / result` with the λ leg `Ended` at step 7 every time, and the same worker
> then ran a fresh program correctly. Three depths, three workers, no poison, no degradation.
> `session-worker.ts`'s `dropLive` already says so outright: *"there is no longer an honest way to make
> `free()` throw through normal input."* **A test written around that mechanism would assert nothing.**
> The isolation test drives what IS reachable instead: co-tenancy is unsurvivable because
> `session-worker.ts` frees its one live session at the top of every `run`, and the cure must be local
> because terminating a shared thread takes the source session with the scratchpad.
>
> **"Only the isolation test fails" is wrong, and wrong in the reassuring direction.** The shared-worker
> mutation failed **6 node tests as well as the 2 browser ones**. This task's own framing — that the
> claim rests on a browser tier needing Chrome — does not hold: the non-skippable tier already
> discriminates it. The browser test is still not redundant, because the node tests drive a fake port
> and prove bookkeeping, where only three real wasm workers can show co-tenancy corrupting an *answer*
> rather than a map. **But T3's lesson was a trap guarded only by a skippable tier; this is the inverse,
> and both were found the same way — by running the mutation and counting.**

---

### T6 — the detached affordances

Spec §4.5. **Independent of everything else in this plan** — it takes a boolean and renders. Already in
flight as a separate work item; recorded here so the plan is complete.

`link-status.ts` states detachment; `pane-chrome.ts` / the panes' own `<h2>` carry a `[detached]` badge;
`style.css` gains a rule that is **not colour-only**.

**Test.** Sentence in `tests/node/link-status.test.ts` (pure logic); badge in `tests/browser/`. Both
asserted **absent when attached** — a test that only checks the affordance appears passes an
implementation that never clears it. Badge asserted by **accessible text, not class or computed
colour**: an implementation satisfying §4.5 with a sixth hue must fail.

**Mutation:** never clear the badge on rebind. **Expected failure:** the absent-when-attached case.

---

### T7 — the binding selector

**Depends on T4 and T5.** Each of the three pane slots gains a selector over `(session, leg)` pairs. The
source session offers source/λ/TM; a `LambdaScratch` offers only λ; a `TmScratch` only TM. The renderer
follows the leg, so two panes can show two different λ sessions side by side — which is what the binding
model was chosen for and therefore what the test must exercise.

Neither pane knows what it is bound to today (§3.2b): both take `(host, PaneEvents)` and are
`(frame, controls) -> DOM` renderers.

**Test.** Two panes bound to two different λ sessions render two different terms **simultaneously**.
Anything weaker passes on a single-session implementation.

**Mutation:** resolve every binding to the source session. **Expected failure:** the two-λ-panes test,
showing identical terms.

---

### T8 — detach is a fork

Spec §4.3. **Depends on T2, T3, T5, T7.** The first task needing both halves.

Editing a source-derived λ view creates the `LambdaScratch` seeded with **that pane's current text** and
rebinds *that pane*. **The source session is untouched and keeps running** — that is the whole reason
three sessions exist. A second edit to another source-derived λ view **rebinds to the existing scratch**;
scratchpads are singletons, at most one per leg kind.

Recompile-from-source **terminates the scratch's worker** and rebinds its panes back — deliberately the
same mechanism as poison recovery (T5), so there is one recovery path and not two.

**Test.**
- Singleton: two source-derived λ panes edited in turn produce **one** `LambdaScratch`. Assert on **pool
  size**, not on rendering — rendering looks right either way.
- Source keeps running: assert the source session's step count **advances across a detach**.
- Recompile **terminates**: assert the worker is gone, not merely that panes rebound. Otherwise the leak
  passes.

**Mutation:** make detach mutate the source session in place instead of forking. **Expected failure:**
the source-keeps-running assertion, with a frozen step count.

> **CORRECTION, from executing this task (2026-08-11). Five findings; the first is a gap in the
> DESIGN rather than in this task, and it changes what T8 could ship.**
>
> **§4.3's TRIGGER HAS NO SURFACE TO HAPPEN ON, AND §1 FORBIDS BUILDING ONE.** "Editing a
> source-derived λ view" presumes a λ view that can be edited. There is none: the λ pane's body is a
> `<pre>` of span-decorated tokens carrying 5b/5c's `data-at` link offsets and `.is-redex` marks — a
> rendering of a recorded frame, not a document. Making it a text surface changes the pane's SHAPE,
> and design §1 says the pane set "does not change shape" in this slice, puts the multiplexer in
> 5d-ii, and budgets 5d-i exactly "one control per pane (the binding selector) and one status
> affordance". **So the gesture is a `✎ fork` button** in the λ pane's control strip, which means the
> same event — fork the term I am looking at — and **the scratchpad cannot be typed into.** It runs
> the term the pane was showing, independently, with the source still going, which is every claim
> §4.3 makes about the FORK and none of what a user would eventually do with one. A term box belongs
> with the pane shape that can hold it.
>
> **THE SEED CAN BE TRUNCATED, AND NEITHER DOCUMENT MENTIONS IT.** A history frame prints at
> `FRAME_BYTES` (512), two orders below the readout's budget, so most non-trivial terms truncate —
> and `lambda/syntax.rs`'s round-trip guarantee is about a WHOLE printed term. A `Bytes` cut is a
> prefix that will not parse; a `Depth` cut is not even a prefix. Seeding from one answers
> `no-session` with a parse diagnostic, or worse parses into a different term. The fork control is
> therefore absent for a cut frame, on §4.5's standard.
>
> **T5's PREDICTED EXTENSION POINT DID NOT BIND, AND T8 IS THE TASK IT NAMED.** `SessionPool`'s spawn
> factory takes no `SessionId` on the recorded grounds that "the task that lands [the scratch types]
> will need a session's KIND to pick its worker module". It did not: a λ scratchpad runs the SAME
> `session-worker.ts`, because that module's job is "hold one wasm handle and answer about it" and
> both kinds of handle are that. The kind is a fact about the first MESSAGE (`lambda-scratch` against
> `run`), not about the thread. Refusing a parameter without its evidence held up; the reason given
> for why it would later be needed did not.
>
> **`TmScratch` HAS NO PRODUCER AND CANNOT GET ONE IN THIS SLICE**, so "at most one `LambdaScratch`
> and at most one `TmScratch`" is only half-instantiable. T3 built the type and `tmScratch(src)` is
> exported, but a `TmScratch` is built from `.tm` TEXT and no surface in this app holds any — the TM
> pane renders a δ-table projected from a compiled program. `protocol.ts` therefore has a
> `lambda-scratch` request and no `tm-scratch` one: a variant nothing could send is the
> fabricated-state shape `session.rs:257-273` prices.
>
> **THE MUTATION: 13 FAILURES — 9 node, 4 browser — AND THE PREDICTED ASSERTION IS NOT THE ONE THAT
> REPORTS.** Nothing outside the three new files moved (334 passed). The source-keeps-running test
> failed at the `spawned.length === 2` guard placed ABOVE the step-count wait, which is
> `pool-isolation.test.ts`'s idiom ("kept above the behavioural assertions so a failure says 'there
> is one worker'") working exactly as intended and hiding the predicted symptom. The prediction was
> checked rather than assumed: with that guard disabled, the failure is `timed out waiting for the
> source TM leg to pass step 0` — **frozen at 0, precisely as this task says.** So the plan named the
> right mechanism, and a reader looking for it in the failure output would not have found it. T4's
> lesson stated once more from the other side: a count is what tells you whether you mutated the
> thing you meant to, and the named assertion is not reliably the one that fires.

---

### T9 — the memory probe

Spec §4.4. **Depends on T5.** A measurement, not a gate.

`HISTORY_BYTES` (`protocol.ts:39`) is per leg — `session-worker.ts:97` keeps
`{lambda: HISTORY_BYTES, tm: HISTORY_BYTES}` — so one session is already 64 MB and three sessions is
**four legs = 128 MB, 2× today and not 3×** (each scratch has one leg). Confirm that arithmetic against
the tree before trusting it.

Reuse `frame-cost.test.ts`'s harness: `--enable-precise-memory-info` + `--js-flags=--expose-gc`
(`vite.config.ts:150`), guard-fail loudly if either is unavailable, **collect before every reading on
both sides of the window**, retain allocations in outer scope, one discarded warm-up round then
alternating measured rounds, log every raw number, assert only loose bounds.

**Pre-registered, before any number exists: three sessions at four legs must sit at or below 2× the
single-session resident figure the same harness measures today.** Above that, the
drop-history-on-unfocus default flips to **on** — **the threshold does not move.** #28's entry is the
reason this sentence is here: a threshold quietly retired the first time it binds was never a threshold.

**No user-facing config.** One knob (bytes per leg), one boolean (drop-history-on-unfocus), default
chosen by this probe.

---

## Final verification

- `scripts/check-all.sh --no-llvm --no-browser` green.
- `cargo nextest run --workspace` green; note the pass/skip counts against #32's 883/8.
- `scripts/check-all.sh --browser-only` green, or an explicit statement that Chrome could not be found
  and the tier did not run.
- From `web/`: `pnpm run build:wasm` **then** `pnpm run typecheck`, `pnpm run test:node`,
  `pnpm run test:browser`, `pnpm run test:coverage`.
- **`build:wasm` before any web test, and `test:coverage` rather than `test`, for any slice touching
  `crates/`.** `pkg/` is a gitignored build artifact, so a local web suite tests whatever WASM was last
  built — PR #28 had every local run green against code that no longer existed, and only CI caught it.
- Coverage thresholds are lines 94 / functions 93 / branches 85 / statements 92. `session-worker.ts` is
  excluded from the include set for a documented instrumentation reason, so **new logic placed there
  will not move the gate** — which is a reason not to put logic there.
