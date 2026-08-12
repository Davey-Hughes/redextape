# 5d-iii — The Editable λ Scratchpad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a detached λ pane editable — a CodeMirror box over the frame renderer, seeded with the term you forked at full fidelity, recompiling the scratch as you type.

**Architecture:** The fork gains a step. A new Rust free function `lambda_scratch_at(src, step, budget)` replays a scratch to step k, prints it at 64 KiB, and builds **the** scratch from that string — so the editor's text, the scratch's step 0, and the term on screen are one object. `PaneEvents.detach` changes from `(text)` to `(step)` because the pane no longer owns the seed. The pane grows a second body region, mounted only when detached.

**Tech Stack:** Rust + wasm-bindgen (`crates/redextape-wasm`), TypeScript + CodeMirror 6 + Vite + Vitest (`web/`), Biome.

**Design:** [`../specs/2026-08-11-plan5d-iii-editable-lambda-design.md`](../specs/2026-08-11-plan5d-iii-editable-lambda-design.md)

## Global Constraints

- **Pre-commit runs `cargo fmt`, `cargo clippy -D warnings`, `biome ci` and `web typecheck` on every commit.** A commit that does not compile clean cannot land. **Never `--no-verify`.** If a task's commit split turns out to be infeasible because an intermediate state cannot pass clippy, collapse the commits and say so in the task report.
- **`clippy::pedantic` is on with no global `allow`.** New Rust needs `#[must_use]`, `# Errors` doc sections on `Result`-returning public functions, and `u64::from` rather than `as`.
- **Doc-comment convention:** `///` in Rust, `/** */` in TypeScript. `web/` must not use `///` — it is inert there.
- **No colour may carry state** in anything this slice adds. The accessibility list's item 7 and its two aggravations are why. Controls are added and removed, never disabled, and never colour-coded.
- **`pkg/` is a gitignored build artifact** and may hold whatever WASM was last built. No test may depend on its contents being current. Rebuild with `scripts/check-all.sh` or `wasm-pack` before running browser tests.
- **Coverage thresholds:** 92 statements / 85 branches / 93 functions / 94 lines. Baseline at HEAD is 94.85 / 89.88 / 96.92 / 97.01. `vite.config.ts` excludes `session-worker.ts` from the include set — logic placed there moves none of the four numbers.
- **DOM TESTS GO IN `web/tests/browser/`, NEVER IN `web/tests/node/`.** Found by T6 before it wrote a line, and it invalidates three of this plan's task briefs as originally written. The `node` project is `environment: 'node'` with no `setupFiles` and no `jsdom`/`happy-dom` anywhere in the dependency tree — `document` is `undefined` there. `vite.config.ts` states the split deliberately: *"Five modules (`main`, `tm-pane`, `lambda-pane`, `pane-chrome`, `session-worker`) are DOM and worker wiring the `node` project cannot execute at all"*, and the coverage merge spans both projects precisely so those still count. `tests/browser/detached-badge.test.ts` and `tests/browser/binding-selector.test.ts` already test `pane-chrome.ts` widgets this way — follow them for fixture idiom. **This does not violate the mutation/tier rule below:** that rule says pin a fact natively *where it can be*, and a DOM mount cannot be.
- **Mutation discipline (5d-i's hardest-won rule):** every mutation this plan proposes predicts a **COUNT** of failing tests, not just a name, and the count is verified by running it. Record the real number beside the prediction whether or not they match.
- **Baseline to beat:** `cargo nextest run --workspace` 895 passed / 8 skipped · web 257 node / 90 browser / 347 merged · 22 wasm browser tests.

---

## File Structure

| file | responsibility | task |
| --- | --- | --- |
| `crates/redextape-wasm/src/session.rs` | `ForkedAt` + `lambda_scratch_at` — the replay, the print, the second parse | T1 |
| `crates/redextape-wasm/src/lib.rs` | `lambdaScratchAt` wasm export | T2 |
| `crates/redextape-wasm/tests/browser.rs` | the export is reachable and its shape is pinned | T2 |
| `web/src/protocol.ts` | `step` on the request, `text` on the reply | T3 |
| `web/src/session-worker.ts` | call the new export instead of `lambdaScratch` | T3 |
| `web/src/scratch.ts` | `detach(slot, src, step)`, `recompile(src)` — the scratch's whole lifetime | T4 |
| `web/src/pane-chrome.ts` | `detach` signature + amended comment; `collapseButton` | T5 |
| `web/src/lambda-editor.ts` | **new** — the CM6 instance, the debounce, push-diagnostics | T6 |
| `web/src/lambda-pane.ts` | mount/unmount the editor region; the split body | T7 |
| `web/src/style.css` | the split body's two regions and the collapsed state | T7 |
| `web/src/main.ts` | supply step-0 text, seed the editor from the reply | T8 |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | the 5d-iii entry **and** the TM slice's own entry | T9 |

### A finding that corrects the design's §4.5, recorded before T1 rather than discovered inside it

**The replay did NOT have to go in Rust, and the design implied it did.** `LambdaScratchHandle` in
`session-worker.ts:95-101` already exposes `stepLambda()`, `lambdaState(budget)` and `free()`, so the
whole of §4.1 is expressible in ~8 lines of TypeScript in the worker with no new wasm export.

**It goes in Rust anyway, for a reason the design's own §5 states.** The browser tier needs Chrome and
is skippable; 5d-i recorded that fabricating `total_steps: Some(0)` left the native suite **894/894
green** and was caught only there. §5's rule is *"where a fact can be pinned natively or in node
instead, it must be"*. A TS replay in `session-worker.ts` is testable **only** in the browser tier —
that file is also excluded from the coverage include set — whereas `lambda_scratch_at` is testable in
`cargo nextest`, the tier that always runs.

The secondary reason is `scratch.ts:66-69`'s rule, restated in design §4.5: the worker holds the wasm
call and nothing else. A two-handle replay loop in the worker is logic, and it would sit in the one
file no gate measures.

---

## Task 1: `lambda_scratch_at` — the replay, natively tested

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs` (beside `lambda_scratch`, ~line 857)
- Test: `crates/redextape-wasm/src/session.rs` (the `#[cfg(test)] mod tests` at the bottom)

**Interfaces:**
- Consumes: `lambda_scratch(src) -> Scratched<LambdaScratch>` (`session.rs:857`), `LambdaScratch::step_lambda(&mut self) -> bool`, `LambdaScratch::lambda_state(&self, byte_budget: usize) -> LambdaState`, `Diagnostic::error(span, message)`, `Span`.
- Produces: `pub struct ForkedAt { diagnostics: Vec<Diagnostic>, scratch: Option<LambdaScratch>, text: Option<String> }` and `pub fn lambda_scratch_at(src: &str, step: u32, byte_budget: usize) -> ForkedAt`. T2 wraps both.

- [ ] **Step 1: Write the failing tests**

Add to `session.rs`'s test module:

```rust
#[test]
fn lambda_scratch_at_step_zero_round_trips() {
    // The identity case, and the free test of the whole path design §4.1 names: the replay is a
    // no-op, so both `lambda_scratch` calls must produce the same term from the same text.
    let out = lambda_scratch_at("(\\x. x) (\\y. y)", 0, 65_536);
    assert!(out.diagnostics.is_empty());
    assert!(out.scratch.is_some());
    assert_eq!(out.text.as_deref(), Some("(\\x. x) (\\y. y)"));
}

#[test]
fn lambda_scratch_at_replays_to_the_requested_step() {
    // One β-step of `(\x. x) (\y. y)` is `\y. y`, and the scratch that comes back must be at ITS
    // step 0 holding that term — not at step 1 of the original.
    let out = lambda_scratch_at("(\\x. x) (\\y. y)", 1, 65_536);
    assert_eq!(out.text.as_deref(), Some("\\y. y"));
    let scratch = out.scratch.expect("a scratch for a term that parsed");
    assert_eq!(scratch.lambda_state(65_536).step, 0, "the fork's step 0 is the term forked");
}

#[test]
fn lambda_scratch_at_clamps_a_step_past_the_end() {
    // `step` is what a pane was showing, and a history can outlive nothing — but asking for step
    // 500 of a 1-step reduction must answer the normal form rather than panic or spin.
    let out = lambda_scratch_at("(\\x. x) (\\y. y)", 500, 65_536);
    assert_eq!(out.text.as_deref(), Some("\\y. y"));
}

#[test]
fn lambda_scratch_at_refuses_unparseable_text() {
    let out = lambda_scratch_at("(\\x.", 0, 65_536);
    assert!(out.scratch.is_none());
    assert!(out.text.is_none(), "no string built a scratch, so there is no string to report");
    assert!(!out.diagnostics.is_empty());
}

#[test]
fn lambda_scratch_at_refuses_a_term_over_budget() {
    // Design §4.1's moved refusal: a term that does not fit the print budget yields a CUT, and a
    // cut is a prefix that will not parse (or worse, parses to a different term). A tiny budget
    // reproduces at 8 bytes what 64 KiB does for a genuinely enormous term.
    let out = lambda_scratch_at("(\\xxxxxxxx. xxxxxxxx) (\\yyyyyyyy. yyyyyyyy)", 0, 8);
    assert!(out.scratch.is_none(), "a cut term must not seed a scratch");
    assert!(out.text.is_none());
    assert_eq!(out.diagnostics.len(), 1);
    assert!(out.diagnostics[0].message.contains("too large to fork"));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cargo nextest run -p redextape-wasm lambda_scratch_at
```

Expected: FAIL — `cannot find function 'lambda_scratch_at' in this scope` (5 tests).

- [ ] **Step 3: Implement `ForkedAt` and `lambda_scratch_at`**

Add to `session.rs` immediately after `lambda_scratch`:

```rust
/// A λ scratchpad forked from step `step` of `src`, **and the text that built it**.
///
/// A THIRD FIELD RATHER THAN `Scratched<LambdaScratch>`, because the caller needs the string. Design
/// §4.1: the editor is seeded from the same text that created the scratch rather than from a second
/// print that could disagree with it, and a `Scratched` has no room to say what that was.
///
/// **`text` IS `None` FOR EXACTLY THE CASES `scratch` IS**, which is one fact rather than two: no
/// scratch was built, so there is no string that built one. A non-null text beside a null scratch
/// would be a fourth state for a renderer to switch on — the redundancy `protocol.ts`'s
/// `scratch-compiled` doc already refused for a `no-scratch` variant.
pub struct ForkedAt {
    pub diagnostics: Vec<Diagnostic>,
    pub scratch: Option<LambdaScratch>,
    pub text: Option<String>,
}

/// Fork a λ scratchpad from **step `step`** of `src`, printing the forked term at `byte_budget`.
///
/// **TWO REDUCTIONS IN ONE CALL, AND THE SECOND PARSE IS THE POINT RATHER THAN THE PRICE** (design
/// §4.1). `lambda_scratch` builds from λ TEXT, so for the fork's step 0 to BE the term that was on
/// screen, that term's text has to exist. It does not: history frames print at 512 bytes and the
/// full-fidelity print exists only at step 0, in the `compiled` reply. Re-deriving it here and then
/// building the scratch from the derived string is what makes the editor's contents, the scratch's
/// step 0, and the term the user was looking at one object instead of three that agree until they do
/// not — and it puts the whole path through `lambda/syntax.rs`'s round-trip guarantee.
///
/// **`step` IS CLAMPED BY THE REDUCTION, NOT VALIDATED.** `step_lambda` answers `false` at the normal
/// form, so a step past the end lands on the normal form. A history's step count and a fresh
/// reduction's cannot disagree today, but a caller is a pane and a pane is not a proof.
///
/// **A CUT REFUSES THE FORK, AND THAT IS §4.1's MOVED REFUSAL RATHER THAN A NEW ONE.** `detachButton`
/// already declines a truncated 512-byte frame because a `Bytes` cut is a prefix that will not parse
/// and a `Depth` cut is not even a prefix. At `byte_budget` the same hazard is 128x further out, not
/// gone, so the same refusal applies with a message a pane can show.
#[must_use]
pub fn lambda_scratch_at(src: &str, step: u32, byte_budget: usize) -> ForkedAt {
    let Scratched { diagnostics, scratch } = lambda_scratch(src);
    let Some(mut tmp) = scratch else {
        return ForkedAt { diagnostics, scratch: None, text: None };
    };
    for _ in 0..step {
        if !tmp.step_lambda() {
            break;
        }
    }
    let state = tmp.lambda_state(byte_budget);
    if state.cut.is_some() {
        // A ZERO-WIDTH SPAN AT THE ORIGIN, because this diagnostic is about the TERM and not about a
        // location in the text the user typed — there is no offset in `src` that names "the result of
        // reducing this 40,000 times is too big to print".
        return ForkedAt {
            diagnostics: vec![Diagnostic::error(
                Span { start: 0, end: 0 },
                "the term at this step is too large to fork — scrub to an earlier step",
            )],
            scratch: None,
            text: None,
        };
    }
    let Scratched { diagnostics, scratch } = lambda_scratch(&state.text);
    // `text` FOLLOWS `scratch`, never independently. The second parse can still fail — a printed term
    // that does not re-parse would be a round-trip bug in `lambda/syntax.rs` rather than a user error,
    // and reporting a text that built nothing would hide it behind a seeded editor.
    let text = scratch.is_some().then_some(state.text);
    ForkedAt { diagnostics, scratch, text }
}
```

If `Span` and `Diagnostic` are not already in scope in `session.rs`, add them to the existing `use` from `redextape_core`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cargo nextest run -p redextape-wasm lambda_scratch_at
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Run the mutation, and record the COUNT**

Break the clamp — change `if !tmp.step_lambda() { break; }` to `let _ = tmp.step_lambda();`.

**Prediction: 1 failure** (`lambda_scratch_at_clamps_a_step_past_the_end`). Run it, record the real number in the task report, and restore the line.

```bash
cargo nextest run -p redextape-wasm lambda_scratch_at
```

- [ ] **Step 6: Verify the whole crate and commit**

```bash
cargo nextest run --workspace
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-wasm/src/session.rs
git commit -m "T1: the fork is two reductions, and the refusal moved 128x out rather than away"
```

Expected: 900 passed / 8 skipped (baseline 895 + 5), clippy clean.

---

## Task 2: The `lambdaScratchAt` wasm export

**Files:**
- Modify: `crates/redextape-wasm/src/lib.rs` (beside `lambdaScratch`, ~line 91)
- Test: `crates/redextape-wasm/tests/browser.rs`

**Interfaces:**
- Consumes: `session::lambda_scratch_at` and `session::ForkedAt` from T1.
- Produces: `lambdaScratchAt(src: string, step: number, byteBudget: number) -> { diagnostics: Diagnostic[], scratch: LambdaScratch | null, text: string | null }`. T3 calls it.

**FIRST, DELETE T1's BRIDGE.** T1 left two `#[cfg_attr(not(test), allow(dead_code))]` attributes in `session.rs` — one on `ForkedAt`, one on `lambda_scratch_at` — each commented "Delete this attribute when T2 lands." They exist because neither item had a production caller until this task, and `clippy -D warnings` fails a `--all-targets` build on `never constructed` / `never used`. **This task is what gives them a caller, so both attributes and both comments must be removed in this task's commit.** If clippy then passes, the bridge is discharged; if it does not, the export is not actually reaching them and that is a real finding.

- [ ] **Step 1: Write the failing browser test**

Add to `crates/redextape-wasm/tests/browser.rs`:

```rust
#[wasm_bindgen_test]
fn lambda_scratch_at_returns_a_handle_and_the_text_that_built_it() {
    let out = lambda_scratch_at("(\\x. x) (\\y. y)", 1, 65_536).expect("marshals");
    let text = js_sys::Reflect::get(&out, &JsValue::from_str("text")).expect("text field");
    // `λ`, NOT `\`. `lambda/syntax.rs`'s binder spelling is asymmetric on purpose — the parser
    // accepts both, the printer emits only `λ` — and `text` is always a reparsed PRINT, never the
    // caller's `src`. T1 found three of its five tests wrong this way before this note existed.
    assert_eq!(text.as_string().as_deref(), Some("λy. y"));
    let scratch = js_sys::Reflect::get(&out, &JsValue::from_str("scratch")).expect("scratch field");
    assert!(!scratch.is_null(), "a term that parsed must yield a handle");
}

#[wasm_bindgen_test]
fn lambda_scratch_at_nulls_both_fields_when_the_text_does_not_parse() {
    let out = lambda_scratch_at("(\\x.", 0, 65_536).expect("marshals");
    for field in ["scratch", "text"] {
        let v = js_sys::Reflect::get(&out, &JsValue::from_str(field)).expect("field");
        assert!(v.is_null(), "{field} must be null when no scratch was built");
    }
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
scripts/check-all.sh
```

Expected: FAIL — `cannot find function 'lambda_scratch_at'`. (If Chrome is not on PATH, it is at `/usr/sbin`; see the WASM browser testing note.)

- [ ] **Step 3: Implement the export**

Add to `lib.rs` after `lambda_scratch`:

```rust
/// `lambdaScratchAt(src, step, byteBudget)` -> `{ diagnostics, scratch: LambdaScratch | null, text: string | null }`.
///
/// Design §4.1's fork. Assembled by hand for the reason `compile` and `lambdaScratch` give: a handle
/// and plain data cross two different ways.
///
/// **`scratch` AND `text` ARE NULL TOGETHER OR NEITHER.** See `session::ForkedAt` — they are one fact,
/// and `protocol.ts` types the pair as nullable for the same reason.
///
/// # Errors
///
/// Returns `Err` only if `to_value` cannot marshal the diagnostics, or if a `Reflect::set` on the
/// freshly created object fails; neither is expected for this crate's own types. Text that does not
/// parse, and a term too large to print, are NOT errors — both arrive as diagnostics beside nulls.
#[wasm_bindgen(js_name = lambdaScratchAt)]
pub fn lambda_scratch_at(src: &str, step: u32, byte_budget: usize) -> Result<JsValue, JsValue> {
    let made = session::lambda_scratch_at(src, step, byte_budget);

    let out = js_sys::Object::new();
    let diagnostics = to_value(&made.diagnostics)?;
    js_sys::Reflect::set(&out, &JsValue::from_str("diagnostics"), &diagnostics)?;
    let handle = match made.scratch {
        Some(s) => JsValue::from(LambdaScratch(s)),
        None => JsValue::NULL,
    };
    js_sys::Reflect::set(&out, &JsValue::from_str("scratch"), &handle)?;
    let text = match made.text {
        Some(t) => JsValue::from_str(&t),
        None => JsValue::NULL,
    };
    js_sys::Reflect::set(&out, &JsValue::from_str("text"), &text)?;
    Ok(out.into())
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
scripts/check-all.sh
```

Expected: all configs green — base, LLVM and browser. 24 wasm browser tests (was 22).

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-wasm/src/lib.rs crates/redextape-wasm/tests/browser.rs
git commit -m "T2: lambdaScratchAt at the boundary, with scratch and text nulled together"
```

---

## Task 3: The wire — `step` out, `text` back

**Files:**
- Modify: `web/src/protocol.ts:286` (request), `:333` (reply)
- Modify: `web/src/session-worker.ts:95-101` (handle type), `:513-544` (`onLambdaScratch`)
- Modify: `web/src/session-client.ts:80` (`scratch`)
- Test: `web/tests/node/protocol.test.ts` if it exists, else `web/tests/node/session-pool.test.ts`

**Interfaces:**
- Consumes: `lambdaScratchAt` from T2.
- Produces: `{ kind: 'lambda-scratch'; gen: number; src: string; step: number }`, `{ kind: 'scratch-compiled'; gen: number; lambda: LambdaStatus; text: string | null }`, and `SessionClient.scratch(gen: number, src: string, step: number): void`. T4 calls `scratch`; T8 reads `text`.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/node/session-pool.test.ts`:

```ts
it('carries the fork step on the wire', () => {
  const posted: unknown[] = []
  const port = { postMessage: (m: unknown) => posted.push(m), onmessage: null } as unknown as MessagePort
  const client = new SessionClient(port)
  client.scratch(client.supersede(), '\\y. y', 7)
  expect(posted).toEqual([{ kind: 'lambda-scratch', gen: 1, src: '\\y. y', step: 7 }])
})
```

Match the fixture idiom already in that file — if it builds ports via a helper, use the helper rather than the literal above.

- [ ] **Step 2: Run to verify it fails**

```bash
cd web && npx vitest run --project node tests/node/session-pool.test.ts
```

Expected: FAIL — `Expected 2 arguments, but got 3` at typecheck, or a mismatch on the missing `step` field.

- [ ] **Step 3: Widen the request, the reply and the client**

In `protocol.ts`, change line 286 and 333:

```ts
  | { kind: 'lambda-scratch'; gen: number; src: string; step: number }
```

```ts
  | { kind: 'scratch-compiled'; gen: number; lambda: LambdaStatus; text: string | null }
```

Add to the `lambda-scratch` variant's existing doc block:

```
 * **`step` IS WHICH FRAME THE PANE WAS SHOWING, AND THE WORKER REPLAYS TO IT** (design §4.1). It is
 * not an offset into `src`: `src` is the SOURCE session's step-0 term at `LAMBDA_BYTE_BUDGET`, and
 * `step` says how far to reduce it before forking. An edit posts `step: 0`, because the text in the
 * box IS the term — which is why editing needs no message of its own.
```

Add to the `scratch-compiled` variant's doc:

```
 * **`text` IS THE STRING THAT BUILT THE SCRATCH, AND IT IS NULL EXACTLY WHEN THERE IS NO SCRATCH.**
 * The editor is seeded from it rather than from a second print that could disagree. Unparseable text
 * and a term over budget both arrive as `null` here beside diagnostics on the shared `diagnostics`
 * reply — see `session::ForkedAt`.
```

In `session-client.ts`, change `scratch`:

```ts
  scratch(gen: number, src: string, step: number): void {
    if (gen !== this.#gen) return
    this.#port.postMessage({ kind: 'lambda-scratch', gen, src, step })
  }
```

In `session-worker.ts`, add `lambdaScratchAt` to the import from `../../pkg/redextape_wasm.js`, add the result type beside `ScratchResult`:

```ts
type ForkedAtResult = { diagnostics: Diagnostic[]; scratch: LambdaScratchHandle | null; text: string | null }
```

and change `onLambdaScratch`'s body from the `lambdaScratch(req.src)` line onward:

```ts
  const { diagnostics, scratch, text } = lambdaScratchAt(req.src, req.step, LAMBDA_BYTE_BUDGET) as ForkedAtResult
  if (scratch === null) {
    ctx.postMessage({ kind: 'no-session', gen: req.gen, diagnostics })
    return
  }
  if (latest !== req.gen) {
    scratch.free()
    return
  }
  live = { gen: req.gen, kind: 'lambda-scratch', session: scratch }

  ctx.postMessage({ kind: 'scratch-compiled', gen: req.gen, lambda: scratch.lambdaStatus(), text })
  await recordLambda(req.gen, true)
```

Amend `onLambdaScratch`'s doc — the paragraph beginning "DIAGNOSTICS ARE DROPPED ON THE SUCCESS PATH" is still true, and add:

```
 * **THE REPLAY HAPPENS INSIDE `lambdaScratchAt`, NOT HERE, AND THAT IS DELIBERATE.** Every method the
 * loop needs is on `LambdaScratchHandle`, so ~8 lines of TypeScript here would have worked and needed
 * no new export. It is in Rust because this file is excluded from the coverage include set and is
 * reachable only from the browser tier, which needs Chrome and is skippable — and 5d-i recorded a
 * fabricated status that left the native suite 894/894 green and was caught only there. The rule this
 * file already states is that it holds the wasm call and not the logic.
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd web && npx vitest run --project node
```

Expected: PASS. Existing callers of `client.scratch` will not typecheck yet — T4 fixes `scratch.ts`. If the node project fails to typecheck for that reason, complete T4's Step 3 before re-running, and **collapse T3 and T4 into one commit**, noting it in the report (the pre-commit gate makes the split infeasible).

- [ ] **Step 5: Commit**

```bash
git add web/src/protocol.ts web/src/session-worker.ts web/src/session-client.ts web/tests/node/session-pool.test.ts
git commit -m "T3: step out, text back, and the replay put where a non-skippable tier can see it"
```

---

## Task 4: `LambdaScratchpad` owns the whole lifetime

**Files:**
- Modify: `web/src/scratch.ts:132-164` (`detach`), and add `recompile`
- Test: `web/tests/node/scratch.test.ts`

**Interfaces:**
- Consumes: `SessionClient.scratch(gen, src, step)` from T3.
- Produces: `detach(slot: Detachable, src: string, step: number): void` and `recompile(src: string): boolean`. T7/T8 call both.

- [ ] **Step 1: Write the failing tests**

Add to `web/tests/node/scratch.test.ts`, following the file's existing fixture helpers:

```ts
it('posts the step it was forked at', () => {
  const { pad, posted, slot } = fixture()
  pad.detach(slot, '(\\x. x) (\\y. y)', 7)
  expect(posted).toContainEqual(expect.objectContaining({ kind: 'lambda-scratch', step: 7 }))
})

it('keeps ONE scratch across two forks at two different steps', () => {
  const { pad, pool, slot, other } = fixture()
  pad.detach(slot, '(\\x. x) (\\y. y)', 3)
  pad.detach(other, '(\\x. x) (\\y. y)', 9)
  // The singleton is asserted on POOL SIZE, per the plan T8 rule scratch.ts's doc records: rendering
  // looks right either way.
  expect(pool.size).toBe(2) // the source session plus exactly one scratch
})

it('recompiles the existing scratch and does not create a second', () => {
  const { pad, pool, posted, slot } = fixture()
  pad.detach(slot, '(\\x. x) (\\y. y)', 0)
  const before = pool.size
  expect(pad.recompile('\\z. z')).toBe(true)
  expect(pool.size).toBe(before)
  expect(posted).toContainEqual(expect.objectContaining({ kind: 'lambda-scratch', src: '\\z. z', step: 0 }))
})

it('answers false when there is no scratch to recompile', () => {
  const { pad } = fixture()
  expect(pad.recompile('\\z. z')).toBe(false)
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd web && npx vitest run --project node tests/node/scratch.test.ts
```

Expected: FAIL — `Expected 2 arguments, but got 3` on `detach`, and `pad.recompile is not a function`.

- [ ] **Step 3: Widen `detach` and add `recompile`**

In `scratch.ts`, change the signature and the one posting line:

```ts
  detach(slot: Detachable, src: string, step: number): void {
    if (!this.#reg.has(this.#id)) {
      const client = this.#pool.bind(this.#id, this.#onReply)
      this.#reg.add({
        /* unchanged */
      })
      client.scratch(client.supersede(), src, step)
    }
    slot.rebind(this.#id)
  }
```

Amend `detach`'s doc — the paragraph beginning "THE SEED IS THE CALLER'S TEXT AND THIS FUNCTION DOES NOT GO LOOKING FOR IT" is now wrong and must be replaced rather than left standing:

```
 * **THE SEED IS THE SOURCE'S STEP-0 TEXT PLUS A STEP, AND THIS FUNCTION STILL DOES NOT GO LOOKING FOR
 * EITHER.** It was "that pane's current text" when the pane's own 512-byte frame was the seed; design
 * §4.1 replaced that because most non-trivial terms truncate there. The caller now supplies the
 * source session's step-0 term (from the `compiled` reply, at `LAMBDA_BYTE_BUDGET`) and the step the
 * pane was showing, and the worker re-derives the term between them. What survives unchanged is the
 * rule: this function is handed its inputs rather than resolving them, so the seed and the screen
 * cannot disagree without something reporting it.
```

Add `recompile` after `detach`:

```ts
  /**
   * Rebuild the scratchpad from `src` — design §4.3's edit path. Answers whether there was one.
   *
   * **IT IS `detach` WITH `step: 0` AND NO CREATION, WHICH IS WHY THERE IS NO SECOND MESSAGE.** The
   * text in the editor IS the term, so there is nothing to replay to; `lambda-scratch` already means
   * "build a scratch from this text at this step" and 0 is its identity value. A `scratch-edit`
   * variant would be a second name for one request.
   *
   * **IT DOES NOT REBIND AND DOES NOT TOUCH THE REGISTRY.** The pane is already on this session and
   * stays on it; what changes is the term behind the leg. `resetLegs` is NOT called here either — the
   * worker's reply drives the leg through the same path a first fork does, and clearing the ring
   * ahead of it would blank the pane for the round trip rather than at the end of it.
   *
   * ANSWERS A BOOLEAN FOR `retire`'s REASON, INVERTED: `retire` returns one because most recompiles
   * happen with no scratchpad, and this returns one because an editor cannot exist without a
   * scratchpad — so `false` is a caller bug rather than the common case, and a caller that ignores it
   * has a pane bound to nothing.
   */
  recompile(src: string): boolean {
    if (!this.#reg.has(this.#id)) return false
    const client = this.#reg.entryOf(this.#id).client
    client.scratch(client.supersede(), src, 0)
    return true
  }
```

- [ ] **Step 4: Run to verify they pass**

```bash
cd web && npx vitest run --project node tests/node/scratch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the mutation, and record the COUNT**

Make `recompile` create rather than reuse — change its guard to `if (this.#reg.has(this.#id)) { /* fall through to bind */ }` so it binds a second client.

**Prediction: 1 failure** (`recompiles the existing scratch and does not create a second`, on `pool.size`). Run it, record the real number, restore.

- [ ] **Step 6: Commit**

```bash
cd .. && git add web/src/scratch.ts web/tests/node/scratch.test.ts
git commit -m "T4: the scratchpad owns create, recompile and retire, and detach stops owning the seed"
```

---

## Task 5: `PaneEvents.detach` becomes a step, and the collapse control

**Files:**
- Modify: `web/src/pane-chrome.ts:24-36` (the `detach` member and its doc), `:144-164` (`detachButton`); add `collapseButton`
- Modify: `web/src/lambda-pane.ts:75-85` (the detach wiring)
- Test: `web/tests/browser/pane-chrome-collapse.test.ts` (create) — **browser, not node**; see Global Constraints

**Interfaces:**
- Consumes: nothing new.
- Produces: `detach?: (step: number) => void` on `PaneEvents`; `collapseButton(parent: HTMLElement, onToggle: (collapsed: boolean) => void): { update(available: boolean): void }`. T7 uses both.

- [ ] **Step 1: Write the failing test**

Create `web/tests/browser/pane-chrome-collapse.test.ts` (read `tests/browser/detached-badge.test.ts` first and match its fixture idiom):

```ts
import { describe, expect, it, vi } from 'vitest'
import { collapseButton } from '../../src/pane-chrome'

describe('collapseButton', () => {
  it('is added and removed, never disabled', () => {
    const host = document.createElement('div')
    const c = collapseButton(host, () => {})
    expect(host.querySelector('button')).toBeNull()
    c.update(true)
    expect(host.querySelector('button')).not.toBeNull()
    c.update(false)
    expect(host.querySelector('button')).toBeNull()
  })

  it('reports the state it is toggling TO, and relabels itself', () => {
    const host = document.createElement('div')
    const onToggle = vi.fn()
    const c = collapseButton(host, onToggle)
    c.update(true)
    const button = host.querySelector('button')
    if (button === null) throw new Error('the control was not added')
    const first = button.getAttribute('aria-label')
    button.click()
    expect(onToggle).toHaveBeenCalledWith(true)
    expect(button.getAttribute('aria-label')).not.toBe(first)
    button.click()
    expect(onToggle).toHaveBeenLastCalledWith(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd web && npx vitest run --project browser tests/browser/pane-chrome-collapse.test.ts
```

Expected: FAIL — `collapseButton is not exported`.

- [ ] **Step 3: Change `detach`'s type, amend its doc, add `collapseButton`**

In `pane-chrome.ts`, replace the `detach` member and the doc paragraph at lines 32-36:

```ts
  /**
   * Fork this pane's term into the λ scratchpad — design §4.3, at the step the pane is showing.
   *
   * OPTIONAL, LIKE THE TWO BELOW AND UNLIKE `rebind`, and the test is the one those two already
   * apply: a pane has this handler when it has the affordance the handler reports. The TM pane has no
   * term to fork; see §6.1 of 5d-iii's design for the slice that changes that.
   *
   * **IT CARRIES A STEP, NOT TEXT, AND THAT REVERSES WHAT THIS COMMENT USED TO SAY.** The rule was
   * "THE TEXT IS THE PANE'S, NOT A LOOKUP", and it was right for a seed that WAS the rendered frame.
   * Design §4.1 replaced that seed: the inputs are now the SOURCE session's step-0 term — which lives
   * in the `compiled` reply that `main.ts` holds, not in any pane — and the step, which `History`
   * owns. So the pane reports the one fact it owns and `main.ts` resolves the rest.
   *
   * **THE HALF OF THE OLD RULE THAT SURVIVES IS THE IMPORTANT HALF:** the pane does not go looking for
   * a term. What changed is which fact is the small one.
   *
   * **A PANE SHOWING A LINK WINDOW MUST STILL DECLINE TO FORK, AND THAT IS NOW A RULE RATHER THAN A
   * CONSEQUENCE.** It used to hold for free — the pane passed its own body text, and `LambdaPane`'s
   * handler chose the frame's text over the window's for the reason recorded there. A step carries no
   * such distinction, so `LambdaPane.#refreshDetach` has to check it and a test has to pin it.
   */
  detach?: (step: number) => void
```

Add `collapseButton` after `detachButton`:

```ts
/**
 * The editor-collapse control on a detached λ pane — design §4.2.
 *
 * IT TOGGLES A CLASS AND NOTHING ELSE. The frame renderer below never learns it has more room, so
 * there is no second body state for `#redraw` and `renderLink` to disagree about — one code path, and
 * the collapse is presentation.
 *
 * ADDED AND REMOVED, NEVER DISABLED — this file's stated idiom. It is absent on an attached pane
 * because there is no editor to collapse, which is the same "a control that provably cannot work
 * should not be offered" standard `detachButton` and `bindingSelect` both apply.
 *
 * THE LABEL NAMES THE CURRENT STATE, WHICH IS PR #20's `aria-label` TREATMENT and the mitigation the
 * accessibility list's item 2 asks for on the δ-table toggle. Nothing here carries state in colour:
 * the glyph changes and the accessible name changes with it.
 */
export function collapseButton(
  parent: HTMLElement,
  onToggle: (collapsed: boolean) => void,
): { update(available: boolean): void } {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'collapse'
  let collapsed = false
  const relabel = () => {
    el.textContent = collapsed ? '⌄' : '⌃'
    el.setAttribute('aria-label', collapsed ? 'show the term editor' : 'hide the term editor')
    el.title = collapsed ? 'show the term editor' : 'hide the term editor'
  }
  relabel()
  el.addEventListener('click', () => {
    collapsed = !collapsed
    relabel()
    onToggle(collapsed)
  })
  // The same no-op guard every control in this file states, for the same reason: this runs on every
  // recorded frame during playback.
  let on = false
  return {
    update(available: boolean) {
      if (available === on) return
      on = available
      if (available) parent.append(el)
      else el.remove()
    },
  }
}
```

In `lambda-pane.ts`, change the detach wiring at line 84 and replace the comment above it:

```ts
    const detach = on.detach
    if (detach !== undefined) {
      // THE FRAME'S STEP, NOT THE WINDOW'S. `#refreshDetach` refuses the fork outright while a link
      // window is showing (see there); this line supplies the step of the frame this leg is actually
      // at, which is what design §4.1's replay reduces to.
      this.#detach = detachButton(this.#strip.el, () => detach(this.#frame?.step ?? 0))
    }
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd web && npx vitest run --project browser tests/browser/pane-chrome-collapse.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
cd .. && git add web/src/pane-chrome.ts web/src/lambda-pane.ts web/tests/browser/pane-chrome-collapse.test.ts
git commit -m "T5: detach carries a step, and the comment that said otherwise is amended not left"
```

---

## Task 6: `lambda-editor.ts` — the CodeMirror instance

**Files:**
- Create: `web/src/lambda-editor.ts`
- Test: `web/tests/browser/lambda-editor.test.ts` — **browser, not node**; see Global Constraints

**Interfaces:**
- Consumes: `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/lint`; `Diagnostic` from `./types`; **`lintRanges(ds: Diagnostic[], text: string): LintRange[]`** from `./diagnostics` (verified — there is no `toCmDiagnostics`).
- Produces:
```ts
export type LambdaEditorConfig = { host: HTMLElement; initial: string; debounceMs: number; onEdit: (src: string) => void }
export class LambdaEditor {
  constructor(config: LambdaEditorConfig)
  setText(text: string): void
  setDiagnostics(ds: Diagnostic[]): void
  destroy(): void
}
```
T7 constructs and destroys it.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/browser/lambda-editor.test.ts` (read `tests/browser/detached-badge.test.ts` first and match its fixture idiom):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LambdaEditor } from '../../src/lambda-editor'

describe('LambdaEditor', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const make = (onEdit = vi.fn()) => {
    const host = document.createElement('div')
    document.body.append(host)
    return { host, onEdit, ed: new LambdaEditor({ host, initial: '\\x. x', debounceMs: 300, onEdit }) }
  }

  it('seeds the buffer with the term it was given', () => {
    const { host } = make()
    expect(host.textContent).toContain('\\x. x')
  })

  it('coalesces a burst of keystrokes into ONE recompile', () => {
    const { ed, onEdit } = make()
    ed.setText('\\a. a')
    ed.setText('\\ab. ab')
    ed.setText('\\abc. abc')
    vi.advanceTimersByTime(300)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith('\\abc. abc')
  })

  it('does not fire before the debounce elapses', () => {
    const { ed, onEdit } = make()
    ed.setText('\\a. a')
    vi.advanceTimersByTime(299)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('cancels a pending recompile on destroy, so a retired scratch gets no message', () => {
    const { ed, onEdit, host } = make()
    ed.setText('\\a. a')
    ed.destroy()
    vi.advanceTimersByTime(1000)
    expect(onEdit).not.toHaveBeenCalled()
    expect(host.childElementCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd web && npx vitest run --project browser tests/browser/lambda-editor.test.ts
```

Expected: FAIL — cannot resolve `../../src/lambda-editor`.

- [ ] **Step 3: Implement**

Create `web/src/lambda-editor.ts`:

```ts
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint'
import { lintGutter, setDiagnostics as setCmDiagnostics } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { lintRanges } from './diagnostics'
import type { Diagnostic } from './types'

/**
 * What a λ term editor needs: where to mount, what to start with, how long to wait, and where edits
 * go.
 */
export type LambdaEditorConfig = {
  host: HTMLElement
  initial: string
  /** `main.ts`'s `DEBOUNCE_MS`, passed in rather than imported — see the class doc. */
  debounceMs: number
  onEdit: (src: string) => void
}

/**
 * **THE λ TERM EDITOR — design §4.2's upper region and §4.3's recompile trigger.**
 *
 * A CodeMirror 6 instance over a scratch session's term. It is the surface 5d-i's §6 said had no
 * home: `LambdaScratchpad` gave a scratch a life of its own, and this is the thing that can change
 * its text.
 *
 * **ITS OWN MODULE FOR THE REASON `scratch.ts` IS.** `lambda-pane.ts` is 289 lines and its whole job
 * is `(frame, controls) -> DOM`; a document surface, a debounce timer and a diagnostics channel mixed
 * into it would put it past 450 and put three concerns behind one name. It is also where the coverage
 * gate can see it, which `session-worker.ts` is not.
 *
 * **NO SYNTAX HIGHLIGHTING, AND THAT IS NOT AN OVERSIGHT.** The pane's `<pre>` colours tokens from
 * `spans`, which the worker computes per frame from a term it holds. An editor's buffer is text the
 * user is halfway through typing — there is no frame for it and `analyze` is the SOURCE language's
 * parser, not λ's. Colouring it would need a λ `linter`-shaped path this slice does not have, and a
 * stale colouring on a buffer being typed into is worse than none.
 *
 * **`debounceMs` IS INJECTED RATHER THAN IMPORTED FROM `main.ts`.** It is `DEBOUNCE_MS` (300), the
 * source pane's own constant, because it is the same gesture at the same speed — but importing from
 * `main.ts` would make a module that mounts the app a dependency of one of its widgets, and the test
 * above needs to drive it without one.
 */
export class LambdaEditor {
  #view: EditorView
  #timer: ReturnType<typeof setTimeout> | null = null
  #ms: number
  #onEdit: (src: string) => void
  /**
   * Set while `setText` is applying a transaction the USER did not cause, so the update listener can
   * tell a seed from a keystroke.
   *
   * **WITHOUT IT, SEEDING THE EDITOR WOULD SCHEDULE A RECOMPILE OF WHAT THE WORKER JUST SENT** — an
   * echo per fork, and a permanent loop if the round trip ever re-seeded. `docChanged` cannot tell
   * the two apart; only the caller can.
   */
  #seeding = false

  constructor(config: LambdaEditorConfig) {
    this.#ms = config.debounceMs
    this.#onEdit = config.onEdit
    this.#view = new EditorView({
      parent: config.host,
      state: EditorState.create({
        doc: config.initial,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          lintGutter(),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || this.#seeding) return
            this.#schedule()
          }),
        ],
      }),
    })
  }

  #schedule(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.#onEdit(this.#view.state.doc.toString())
    }, this.#ms)
  }

  /**
   * Replace the buffer without treating it as an edit — the fork's seed, and nothing else.
   *
   * A NO-OP WHEN THE TEXT ALREADY MATCHES, because a re-seed would move the user's cursor to the end
   * of a document they are working in.
   */
  setText(text: string): void {
    if (this.#view.state.doc.toString() === text) return
    this.#seeding = true
    try {
      this.#view.dispatch({ changes: { from: 0, to: this.#view.state.doc.length, insert: text } })
    } finally {
      this.#seeding = false
    }
  }

  /**
   * Show `ds` in the gutter — design §4.4's push, as against the source pane's pull.
   *
   * `setDiagnostics` AND NOT A `linter` EXTENSION. `lint.ts`'s linter calls `analyze` synchronously
   * because the source pane's diagnostics are computable on the main thread; a scratch's arrive from
   * a worker reply, and a pull-based linter has nothing to pull.
   */
  setDiagnostics(ds: Diagnostic[]): void {
    const doc = this.#view.state.doc.toString()
    // The same two-step `lint.ts` uses — `lintRanges` clamps and converts byte offsets to UTF-16
    // indices, then the shape is widened to `@codemirror/lint`'s. One conversion implementation, not
    // two: `λ` is 2 bytes and 1 UTF-16 code unit, so this is not optional on a λ buffer.
    const cm = lintRanges(ds, doc).map(
      (r): CmDiagnostic => ({ from: r.from, to: r.to, severity: r.severity, message: r.message }),
    )
    this.#view.dispatch(setCmDiagnostics(this.#view.state, cm))
  }

  /**
   * Tear down the instance and **cancel any pending recompile**.
   *
   * THE CANCEL IS THE POINT. A retirement (§4.3's recompile-from-source) destroys this while a
   * debounce may be in flight; firing it afterwards would post a `lambda-scratch` to a session the
   * pool has already unbound. `SessionClient.scratch` guards on generation, so the message would be
   * dropped rather than misdelivered — but a message sent to be dropped is a race left in on purpose.
   */
  destroy(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
    this.#view.destroy()
  }
}
```

The `lintRanges` → `CmDiagnostic` map above is copied from `lint.ts:25-27` deliberately. **Do not factor the two into a shared helper in this task** — they differ in where the diagnostics come from (pull vs push) and a premature merge would put a `linter` extension's concerns in a module that has none.

- [ ] **Step 4: Run to verify they pass**

```bash
cd web && npx vitest run --project browser tests/browser/lambda-editor.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Run the mutation, and record the COUNT**

Delete the `#seeding` guard — change the listener to `if (!u.docChanged) return`.

**Prediction: 0 failures from the tests above**, because none of them calls `setText` on a *fresh* editor and then checks for an absent recompile — `coalesces a burst` calls it three times and expects one fire, which the mutation still satisfies. **If the prediction holds, that is a missing test, not a passing mutation:** add one that seeds and asserts `onEdit` was never called, then re-run. Record both numbers.

- [ ] **Step 6: Commit**

```bash
cd .. && git add web/src/lambda-editor.ts web/tests/browser/lambda-editor.test.ts
git commit -m "T6: the term editor, its debounce, and the seed that must not echo"
```

---

## Task 7: The split body

**Files:**
- Modify: `web/src/lambda-pane.ts` (constructor, `setDetached`, `#refreshDetach`, add `#editor`)
- Modify: `web/src/style.css` (after `.term`, ~line 292)
- Test: `web/tests/browser/lambda-pane-editor.test.ts` (create) — **browser, not node**; see Global Constraints

**Interfaces:**
- Consumes: `LambdaEditor` (T6), `collapseButton` (T5).
- Produces: `LambdaPane.setEditor(text: string | null): void` — mounts the editor region with `text`, or unmounts it with `null`. `LambdaPane.setDiagnostics(ds: Diagnostic[]): void`. T8 calls both. `PaneEvents` gains `editScratch?: (src: string) => void`.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/browser/lambda-pane-editor.test.ts` (read `tests/browser/detached-badge.test.ts` first and match its fixture idiom):

```ts
import { describe, expect, it, vi } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'

const events = () => ({
  back: vi.fn(), forward: vi.fn(), play: vi.fn(), restart: vi.fn(), extend: vi.fn(),
  rebind: vi.fn(), detach: vi.fn(), editScratch: vi.fn(),
})

describe('LambdaPane editor region', () => {
  it('has no editor region until one is set', () => {
    const host = document.createElement('div')
    new LambdaPane(host, events())
    expect(host.querySelector('.term-editor')).toBeNull()
  })

  it('mounts the editor when set and REMOVES it when cleared, never hides it', () => {
    const host = document.createElement('div')
    const pane = new LambdaPane(host, events())
    pane.setEditor('\\x. x')
    expect(host.querySelector('.term-editor')).not.toBeNull()
    pane.setEditor(null)
    // Removed, not hidden — the same standard detachedBadge states, and what makes "the editor is
    // gone" have one answer.
    expect(host.querySelector('.term-editor')).toBeNull()
  })

  it('offers no fork while a link window is showing', () => {
    // The guard that used to hold for free, before detach carried a step (T5).
    const host = document.createElement('div')
    const pane = new LambdaPane(host, events())
    pane.render({ text: '\\x. x', spans: [], cut: null, step: 0, redex_span: null }, {
      canRestart: true, canBack: false, canForward: true, canPlay: true, stepText: '0', continueLabel: null,
    })
    expect(host.querySelector('button.detach')).not.toBeNull()
    pane.renderLink({
      text: '\\x. x', spans: [], target: { start: 0, end: 1 },
      origin: 0, clippedHead: false, clippedTail: false,
    })
    expect(host.querySelector('button.detach')).toBeNull()
  })
})
```

**Match the real `LambdaState`, `ControlState` and `LambdaWindow` shapes** — read `types.ts`, `controls.ts` and `lambda-window.ts` and fix the literals above to whatever those actually declare. A test that compiles against an invented shape pins nothing.

Two already known to be wrong in the literals above: **`LambdaState.spans` is `Classified`, not an array literal's inferred type** (`types.ts:85`), and `LambdaState.step` is `number` (`types.ts:87`) — the field T5's `detach` handler reads, so it is confirmed to exist. Build the fixture with a helper typed as `LambdaState` so the compiler reports the rest rather than leaving them to be noticed.

- [ ] **Step 2: Run to verify they fail**

```bash
cd web && npx vitest run --project browser tests/browser/lambda-pane-editor.test.ts
```

Expected: FAIL — `pane.setEditor is not a function`, and the link-window case fails because `#refreshDetach` does not check `#link`.

- [ ] **Step 3: Implement**

In `lambda-pane.ts`: add `editScratch?: (src: string) => void` to `PaneEvents` in `pane-chrome.ts` with a doc naming §4.3; add fields and methods to `LambdaPane`.

```ts
  #editorHost: HTMLElement
  #editor: LambdaEditor | null = null
  #collapse: ReturnType<typeof collapseButton>
  #onEdit: ((src: string) => void) | undefined
```

In the constructor, before `host.replaceChildren(...)`:

```ts
    // THE HOST IS IN THE DOM FROM CONSTRUCTION AND CARRIES NO CLASS UNTIL AN EDITOR IS MOUNTED.
    // A stable parent is what lets `setEditor` mount and unmount without touching the pane's child
    // order; the class is what `.term-editor` selects, so an empty host matches nothing and "is there
    // an editor" has one answer in the DOM as well as in the field.
    this.#editorHost = document.createElement('div')
    this.#onEdit = on.editScratch
    this.#collapse = collapseButton(this.#strip.el, (collapsed) => {
      this.#editorHost.classList.toggle('is-collapsed', collapsed)
    })
```

and change the mount line so the editor host sits between the title and the term:

```ts
    host.replaceChildren(title, this.#editorHost, this.#text, this.#strip.el)
```

`setEditor` below is what sets `className = 'term-editor'` and clears it again — the constructor never does.

Add the two methods:

```ts
  /**
   * Mount an editor over this pane's term seeded with `text`, or unmount it with `null` — design
   * §4.2's upper region.
   *
   * MOUNTED AND UNMOUNTED, NEVER HIDDEN, for `detachedBadge`'s reason taken one step further: a hidden
   * CodeMirror instance is a live instance with a live debounce, and §5 asks for a test that
   * reattaching a pane REMOVES the editor. Removal is what makes that question have one answer.
   *
   * A RE-SEED WITH THE SAME TEXT IS A NO-OP INSIDE `LambdaEditor.setText`, so this is safe on the
   * per-frame path even though only `main.ts`'s fork and retire calls actually move it.
   */
  setEditor(text: string | null): void {
    if (text === null) {
      this.#editor?.destroy()
      this.#editor = null
      this.#editorHost.className = ''
      this.#collapse.update(false)
      return
    }
    const onEdit = this.#onEdit
    if (this.#editor === null) {
      this.#editorHost.className = 'term-editor'
      this.#editor = new LambdaEditor({
        host: this.#editorHost,
        initial: text,
        debounceMs: EDITOR_DEBOUNCE_MS,
        onEdit: (src) => onEdit?.(src),
      })
      this.#collapse.update(true)
      return
    }
    this.#editor.setText(text)
  }

  /** Diagnostics for the editor's own buffer — design §4.4. A no-op with no editor mounted. */
  setDiagnostics(ds: Diagnostic[]): void {
    this.#editor?.setDiagnostics(ds)
  }
```

Declare `const EDITOR_DEBOUNCE_MS = 300` at the top of `lambda-pane.ts` with a doc noting it is `main.ts`'s `DEBOUNCE_MS` and why it is not imported (same argument `LambdaEditor` records).

Change `#refreshDetach` to add the link-window arm:

```ts
  /**
   * ... (existing doc, plus:)
   *
   * **AND IT REFUSES WHILE A LINK WINDOW IS SHOWING, WHICH IS NEW AND IS A RULE RATHER THAN A
   * CONSEQUENCE.** The window's body is a slice of the SOURCE COMPILE's step-0 term in a different
   * coordinate system; forking used to be safe here because the handler passed `#frame`'s text rather
   * than the window's, and design §4.1 replaced that text with a step. A step says nothing about
   * which of the pane's two bodies is on screen, so the refusal has to be stated.
   */
  #refreshDetach(): void {
    const frame = this.#frame
    this.#detach?.update(!this.#detached && this.#link === null && frame !== null && frame.cut === null)
  }
```

and call `this.#refreshDetach()` at the end of `renderLink` — including on the early-return path's opposite, i.e. after `this.#link = win`.

In `style.css`, after the `.term` rules:

```css
/* Design §4.2's upper region. Bounded so the frame renderer below keeps its 6lh in a half-width
   12rem cell; the editor scrolls rather than pushing the term off the pane. */
.term-editor {
  max-height: 8lh;
  overflow: auto;
  border-bottom: 1px solid var(--rule);
  margin-bottom: 0.5rem;
}

/* Collapsed is ABSENT, not faded: no colour carries this state (design §6.2), and the control's
   accessible name says which way it is. */
.term-editor.is-collapsed {
  display: none;
}
```

Use whatever the stylesheet's real rule/border custom property is named — check the existing `.pane` rules rather than assuming `--rule`.

- [ ] **Step 4: Run to verify they pass**

```bash
cd web && npx vitest run --project browser tests/browser/lambda-pane-editor.test.ts && npx vitest run
```

Expected: PASS.

- [ ] **Step 5: Run the mutation, and record the COUNT**

Change `setEditor(null)` to hide rather than unmount — replace the `className = ''` line with `this.#editorHost.hidden = true`.

**Prediction: 1 failure** (`mounts the editor when set and REMOVES it`). Run it, record the real number, restore.

- [ ] **Step 6: Commit**

```bash
cd .. && git add web/src/lambda-pane.ts web/src/pane-chrome.ts web/src/style.css web/tests/browser/lambda-pane-editor.test.ts
git commit -m "T7: the split body, and the link-window refusal restated as a rule"
```

---

## Task 8: Wiring — the app can fork, type, and see it run

**Files:**
- Modify: `web/src/main.ts` (the λ pane's events, the `scratch-compiled` arm, `draw()`)
- Test: `web/tests/browser/scratch-fork.test.ts` (extend), `web/tests/browser/scratch-edit.test.ts` (create)

**Interfaces:**
- Consumes: everything from T1–T7.
- Produces: a working app. Nothing downstream.

- [ ] **Step 1: Write the failing browser tests**

Extend `web/tests/browser/scratch-fork.test.ts` with the case that was impossible before:

```ts
it('forks a TRUNCATED frame and seeds the editor with the whole term', async () => {
  // The capability this slice exists for. Before T1 the fork was refused outright whenever the
  // 512-byte frame cut, which lambda-pane.ts records as "most non-trivial terms".
  await loadProgram(page, LARGE_TERM_PROGRAM)
  await scrubTo(page, 3)
  await expect(page.locator('#lambda .truncated')).toBeVisible()
  await page.locator('#lambda button.detach').click()
  const editor = page.locator('#lambda .term-editor')
  await expect(editor).toBeVisible()
  await expect(editor).not.toContainText('…')
})
```

Create `web/tests/browser/scratch-edit.test.ts`:

```ts
it('editing the scratch changes its frames and leaves the source running', async () => {
  await loadProgram(page, SAMPLE_PROGRAM)
  await page.locator('#lambda button.detach').click()
  const sourceStepsBefore = await tmStepText(page)
  await page.locator('#lambda .term-editor .cm-content').fill('(\\a. a a) (\\b. b)')
  await expect(page.locator('#lambda .term')).toContainText('\\b. b')
  // The whole reason three sessions exist rather than one mutable one.
  expect(await tmStepText(page)).not.toBe(sourceStepsBefore)
})

it('an unparseable edit shows a diagnostic and keeps the last good frames', async () => {
  await loadProgram(page, SAMPLE_PROGRAM)
  await page.locator('#lambda button.detach').click()
  const before = await page.locator('#lambda .term').textContent()
  await page.locator('#lambda .term-editor .cm-content').fill('(\\a.')
  await expect(page.locator('#lambda .cm-lint-marker-error')).toBeVisible()
  expect(await page.locator('#lambda .term').textContent()).toBe(before)
})

it('recompiling from source removes the editor', async () => {
  await loadProgram(page, SAMPLE_PROGRAM)
  await page.locator('#lambda button.detach').click()
  await expect(page.locator('#lambda .term-editor')).toBeVisible()
  await page.locator('#editor .cm-content').fill('let y = 1; y + 1')
  await expect(page.locator('#lambda .term-editor')).toHaveCount(0)
})
```

**Use the file's real helpers** — read `scratch-fork.test.ts` first and reuse its `loadProgram`/page fixture rather than inventing `scrubTo` and `tmStepText` if equivalents exist. Add `LARGE_TERM_PROGRAM` as a program whose λ frames genuinely cut at 512 bytes; verify it does before relying on it.

- [ ] **Step 2: Run to verify they fail**

```bash
cd web && npx vitest run --project browser tests/browser/scratch-edit.test.ts
```

Expected: FAIL — no `.term-editor` in the DOM.

- [ ] **Step 3: Wire `main.ts`**

Three changes.

**(a) The λ pane's events.** `detach` now takes a step and must supply the source's step-0 text. That text is the `compiled` reply's `lambda.state.text` for the SOURCE session — find where `main.ts` stores the compiled λ state (it already holds it for `lambdaText`/`linkIndex`) and reuse that value; do not re-derive it.

```ts
      detach: (step) => {
        // The SOURCE session's step-0 term at LAMBDA_BYTE_BUDGET, which is what the worker replays
        // (design §4.1). `lambdaText` is that string already — the link window is built from it.
        if (lambdaText === null) return
        scratchpad.detach(lambdaSlot, lambdaText, step)
        draw()
      },
      editScratch: (src) => {
        if (scratchpad.recompile(src)) draw()
      },
```

**(b) The `scratch-compiled` arm** seeds the editor:

```ts
      case 'scratch-compiled': {
        /* ...existing leg/status handling... */
        // THE EDITOR IS SEEDED FROM THE REPLY'S OWN TEXT, not from the frame that arrives next
        // (design §4.1). `text` is the string that built this scratch, so the box and the session
        // cannot disagree. Null here means no scratch was built, and the `diagnostics` reply carries
        // the reason.
        if (reply.text !== null) lambdaPane.setEditor(reply.text)
        break
      }
```

**(c) The `diagnostics` and `no-session` arms** route a *scratch* session's diagnostics to the editor rather than to the source editor's linter. Check which session the reply's generation belongs to before routing; if `main.ts` has no such discrimination today, add it here rather than in the pane.

```ts
        if (isScratchGen(reply.gen)) lambdaPane.setDiagnostics(reply.diagnostics)
        else setSourceDiagnostics(reply.diagnostics)
```

**(d) Retirement clears the editor.** `retire` already runs from `schedule` on the keystroke that recompiles from source and answers a boolean; on `true`, add:

```ts
      if (scratchpad.retire(SOURCE_ID, slots)) {
        lambdaPane.setEditor(null)
        draw()
      }
```

- [ ] **Step 4: Run to verify they pass**

```bash
cd web && npx vitest run --project browser && npx vitest run
```

Expected: PASS. Browser count 94+ (was 90).

- [ ] **Step 5: Full verification**

```bash
cd .. && scripts/check-all.sh
cargo nextest run --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd web && npm run build && npx vitest run --coverage
```

Expected: all configs green; coverage at or above 92 / 85 / 93 / 94. **If coverage dropped below any threshold, add the missing tests before committing** — do not lower a threshold.

- [ ] **Step 6: Commit**

```bash
cd .. && git add web/src/main.ts web/tests/browser/
git commit -m "T8: fork a truncated frame, type into it, and watch the source keep running"
```

---

## Task 9: Two roadmap entries

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Write the 5d-iii closing entry**

Append after the `PLAN 5d-i CLOSES` entry, in the house style — what shipped, what the plan got wrong with the predictions left beside the outcomes, the mutation counts (predicted vs actual, from T1/T4/T6/T7), verification numbers, and what this slice could not establish.

**It must record, at minimum:**
- The design said Rust; the File Structure section found TypeScript would have worked and refused it on §5's skippable-tier grounds. Record which reason turned out to matter.
- `PaneEvents.detach`'s reversal, found in spec self-review rather than in execution.
- The link-window refusal that stopped being free.
- Every mutation's **predicted vs actual** failure count.

- [ ] **Step 2: File the TM editable pane as a NAMED slice**

Add an entry to the Plan 5 section giving the TM half a name and a position in the sequence — **this is the point of the whole slice's scope decision** and must not be a loose paragraph. It must state that `tmScratch` is exported/typed/tested with no caller, that a caller needs a TM *source view* that does not exist, and that `protocol.ts` has no `tm-scratch` variant.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "roadmap: 5d-iii closes, and the TM editable pane gets a name before it can fall in a gap"
```

---

## Self-Review

**Spec coverage:** §4.1 → T1/T2/T3. §4.1a → T5. §4.2 → T5 (`collapseButton`), T7 (split body, style). §4.3 → T4 (`recompile`), T6 (debounce), T8 (wiring). §4.4 → T6 (`setDiagnostics`), T8 (routing). §4.5 → the File Structure table, with its correction recorded. §5 → tests in every task plus the mutation steps. §6.1 → T9 Step 2. §6.2 → Global Constraints (no colour, a11y not discharged).

**Type consistency:** `lambda_scratch_at(src, step, byte_budget)` (T1) → `lambdaScratchAt(src, step, byteBudget)` (T2) → called with `LAMBDA_BYTE_BUDGET` (T3). `ForkedAt { diagnostics, scratch, text }` (T1) → `ForkedAtResult` (T3) → `reply.text` (T8). `detach?: (step: number)` (T5) → `detach(slot, src, step)` (T4) → `detach: (step) =>` (T8). `setEditor(text | null)` (T7) → called in T8's `scratch-compiled` and retire arms.

**Known soft spots, flagged rather than hidden:** T3's commit may have to collapse into T4's (the pre-commit gate); T6's converter import name and T7's CSS custom property are both marked "check the real name"; T8's `lambdaText` and diagnostic-routing variables are named from the design rather than read out of `main.ts`, so the implementer must reconcile them against the file.
