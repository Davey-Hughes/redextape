# Plan 5b — static click-linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click a source construct and see its λ subterm and its TM state block light up — and click either of those back to the source.

**Architecture:** One `linkIndex(byteBudget)` wasm export, built once per compile, ships the step-0 λ text plus three columnar typed-array legs (source spans, λ spans, dense state→node owners). All resolution — smallest-containing-interval search, both directions — happens synchronously in `web/src/link.ts`, so a click costs zero worker messages. The λ link is step-0 only; every other case reports its absence rather than showing a wrong highlight.

**Tech Stack:** Rust (`redextape-core`, `redextape-wasm` via `wasm-bindgen`), TypeScript + CodeMirror 6 + Vite, Vitest (node + browser tiers), Biome.

**Design:** [`../specs/2026-08-08-plan5b-click-linking-design.md`](../specs/2026-08-08-plan5b-click-linking-design.md).
**Branch:** `plan5b-click-linking` (already created; the design doc is its first commit).

## Global Constraints

- **Never `--no-verify`.** The pre-commit hook runs `cargo fmt`, `cargo clippy -D warnings`, `biome ci`, and `web typecheck`. Every commit in this plan must pass all four. If a task's commit cannot pass, collapse it into the next one and say so — do not skip the hook.
- **No library path may panic.** `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented` are all `warn` in `[workspace.lints.clippy]` and denied by CI. Test code is exempt inside `#[test]` / `#[cfg(test)]`; `tests/` and `examples/` targets carry a file-level `#![allow(...)]`.
- **`clippy::too_many_arguments` denies at 8 parameters.** This is load-bearing in Task 3.
- **No panic may cross the wasm boundary.** Every `#[wasm_bindgen]` export returns `Result<_, JsValue>`.
- **Spans are BYTE offsets, JavaScript strings are UTF-16.** Convert through `spans.ts`'s `byteToIndex` / `byteIndexAt`. `λ` is 2 bytes and 1 UTF-16 unit, so this fires on every term with a binder — never treat `span.start` as a JS index.
- **Budgets are parameters, never constants, in `viewmodel.rs`.** That file's header rule: "CORE NEVER PICKS A NUMBER."
- **The map says nothing where the lowering said nothing.** No fallback to a nearby node, a nearby state, or a clamped span. Absent, never wrong.
- **Doc-comment convention:** `///` in Rust, `/** */` in TypeScript.
- **Rust line width is 120** (`rustfmt.toml`). Run `cargo fmt` before every commit.
- **Commit messages carry no attribution.** No `Co-Authored-By`, no `Generated with`.

## Task Map

| # | Task | Layer |
| --- | --- | --- |
| 1 | Fix `settled()` — bump the generation at dispatch | web |
| 2 | `tokenClasses()`, and pin `TOKEN_CLASSES` against it | Rust + web |
| 3 | `print_lambda_linked` — the recording printer | Rust |
| 4 | `LinkIndex` and its builder | Rust |
| 5 | `link_index_probe.rs` — the permanent measurement | Rust |
| 6 | `Session::link_index` and the `linkIndex` export | Rust (wasm) |
| 7 | `link.ts` — the index and four resolvers | web |
| 8 | Worker and protocol wiring | web |
| 9 | Source pane — click, keyboard, decoration, status | web |
| 10 | State table — row click and `is-linked` | web |
| 11 | λ pane — the window view, and λ→source | web |
| 12 | Browser tier | web |

---

### Task 1: Fix `settled()` — bump the generation at dispatch

`schedule` sets `results.dataset.state = 'running'` synchronously but defers `client.request` by `DEBOUNCE_MS = 300`, and `request` is the only thing that increments `SessionClient.#gen`. For at least 300 ms after a dispatch — and for **seconds** while a recording starves the timer — the previous generation's replies are still current, and its `result` sets the state back to `'idle'`. `settled` samples in that window and resolves against the **old** program.

The fix moves the bump to dispatch. `supersede()` returns the new generation; `request(gen, ...)` posts only if that generation is still current, so a second `schedule` during the debounce cancels the first rather than posting twice.

**Files:**
- Modify: `web/src/session-client.ts:32-35`
- Modify: `web/src/main.ts:303-308`
- Modify: `web/tests/browser/app.test.ts:37-47` (the doc comment, which is currently false)
- Test: `web/tests/node/session-client.test.ts`

**Interfaces:**
- Produces: `SessionClient.supersede(): number` — bumps and returns the new generation. `SessionClient.request(gen: number, src: string, encoding: string): void` — posts only when `gen` is still current. `request`'s signature CHANGES; `extend(leg)` is unchanged.

- [ ] **Step 1: Write the failing test**

Create `web/tests/node/session-client.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import type { ClientPort } from '../../src/session-client'
import { SessionClient } from '../../src/session-client'
import type { RunReply, RunRequest } from '../../src/protocol'

function port(): ClientPort & { sent: RunRequest[]; deliver: (r: RunReply) => void } {
  const sent: RunRequest[] = []
  let handler: ((e: { data: RunReply }) => void) | null = null
  return {
    sent,
    postMessage: (m: RunRequest) => sent.push(m),
    addEventListener: (_t: 'message', h: (e: { data: RunReply }) => void) => {
      handler = h
    },
    deliver: (r: RunReply) => handler?.({ data: r }),
  }
}

const compiled = (gen: number): RunReply => ({
  kind: 'compiled',
  gen,
  lambda: { available: true, reason: '', node: null, run: 'Running' },
  tm: { available: true, reason: '', width: null, run: 'Running', total_steps: null },
  declinedSpan: null,
  tmProgram: null,
  tapeNames: [],
})

describe('SessionClient generation', () => {
  it('drops the previous generation as soon as supersede is called, before request posts', () => {
    const p = port()
    const seen: number[] = []
    const c = new SessionClient(p, (r) => seen.push(r.gen))

    const g1 = c.supersede()
    c.request(g1, 'a', 'binary')
    p.deliver(compiled(g1))
    expect(seen).toEqual([g1])

    // A new dispatch. The OLD generation's reply is now stale even though `request` has not run yet —
    // this is the whole defect: the debounce used to leave a 300 ms window where it was still current.
    c.supersede()
    p.deliver(compiled(g1))
    expect(seen).toEqual([g1])
  })

  it('a request whose generation was superseded during the debounce never posts', () => {
    const p = port()
    const c = new SessionClient(p, () => {})

    const g1 = c.supersede()
    const g2 = c.supersede()
    c.request(g1, 'stale', 'binary')
    expect(p.sent).toEqual([])

    c.request(g2, 'fresh', 'binary')
    expect(p.sent).toEqual([{ kind: 'run', gen: g2, src: 'fresh', encoding: 'binary' }])
  })

  it('extend addresses the current generation and does not advance it', () => {
    const p = port()
    const c = new SessionClient(p, () => {})
    const g = c.supersede()
    c.request(g, 'a', 'binary')
    c.extend('lambda')
    expect(p.sent[1]).toEqual({ kind: 'extend', gen: g, leg: 'lambda' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm exec vitest run tests/session-client.test.ts`
Expected: FAIL — `c.supersede is not a function`.

- [ ] **Step 3: Change `SessionClient`**

Replace `web/src/session-client.ts:32-35` (the `request` method) with:

```typescript
  /**
   * Claim the next generation, and return it. CALLED AT DISPATCH, NOT AT POST — that separation is
   * the whole point of this method existing.
   *
   * `main.ts` debounces by `DEBOUNCE_MS` before posting, and `#gen` is the filter that drops replies
   * from a superseded run. While the bump lived in `request`, the previous generation stayed current
   * for the entire debounce — and far longer in practice, because a `setTimeout` competes with the
   * worker's frame recording and can be starved for seconds. A stale `result` arriving in that window
   * set the UI back to `'idle'` for a program the user had already replaced. Measured on PR 5a-ii:
   * dispatch at 2 ms, the PREVIOUS generation's `result` at 4,679 ms, the new program's `compiled` at
   * 4,710 ms. Bumping here closes the window at the instant of dispatch instead.
   */
  supersede(): number {
    this.#gen += 1
    return this.#gen
  }

  /**
   * Post the run for `gen`, or do nothing if a later `supersede` has already replaced it.
   *
   * TAKING THE GENERATION RATHER THAN CLAIMING ONE is what makes the debounce self-cancelling: two
   * keystrokes 100 ms apart claim two generations and schedule two timers, and the first timer's post
   * is dropped here rather than racing the second onto the worker.
   */
  request(gen: number, src: string, encoding: string): void {
    if (gen !== this.#gen) return
    this.#port.postMessage({ kind: 'run', gen, src, encoding })
  }
```

- [ ] **Step 4: Change `main.ts`'s `schedule`**

Replace `web/src/main.ts:303-308` with:

```typescript
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (src: string) => {
    clearTimeout(timer)
    results.dataset.state = 'running'
    // SUPERSEDE NOW, POST LATER. The generation is claimed synchronously so the previous run's
    // replies stop being current at the instant of dispatch; `request` drops the post if another
    // keystroke claimed a newer one during the debounce. See `SessionClient.supersede`.
    const gen = client.supersede()
    timer = setTimeout(() => client.request(gen, src, picker.value), DEBOUNCE_MS)
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && pnpm exec vitest run tests/session-client.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Correct `settled()`'s doc comment**

Replace `web/tests/browser/app.test.ts:37-43` (the doc block above `settled`) with:

```typescript
/**
 * `retype`, but waits for the run it triggers to finish before returning.
 *
 * THE INVARIANT IS NOW TRUE, AND IT WAS NOT BEFORE. `results.dataset.state` flips to `'idle'` only
 * from `onReply`'s `'no-session'` and `'result'` arms, and `onReply` only runs for the CURRENT
 * generation. `schedule` claims that generation synchronously inside the same `dispatch` this
 * function makes (`SessionClient.supersede`), so every reply belonging to a previous program is
 * already filtered by the time this starts polling. Until PR 5b the bump happened 300 ms later,
 * inside `request`, and a stale `result` landing in the gap resolved this against the OLD program —
 * two flakes on 5a-ii traced to exactly that.
 */
```

- [ ] **Step 7: Run the whole web suite**

Run: `cd web && pnpm test`
Expected: PASS. The browser tier's ~20 `settled` callers must all still pass.

- [ ] **Step 8: Commit**

```bash
git add web/src/session-client.ts web/src/main.ts web/tests/node/session-client.test.ts web/tests/browser/app.test.ts
git commit -m "web: bump the generation at dispatch, so settled() means what its doc says"
```

---

### Task 2: `tokenClasses()`, and pin `TOKEN_CLASSES` against it

Task 8 ships `TokenClass` across the boundary as a **numeric discriminant** in a `Uint8Array`, where today it crosses as a serde variant name. `types.ts:12-23` already documents the hand-copy risk in `TOKEN_CLASSES`; a discriminant makes the failure mode worse, because a reordered enum mis-colours silently instead of producing an unrecognised string. 5a-i raised this as §11.6 and deferred it; 5a-ii recorded it "unchanged" and deferred it again.

**Files:**
- Modify: `crates/redextape-core/src/analysis.rs` (after the `TokenClass` enum, ~line 46)
- Modify: `crates/redextape-wasm/src/lib.rs` (beside `encodings()`, ~line 77)
- Modify: `web/src/types.ts:25-42`
- Test: `crates/redextape-core/src/analysis.rs` (`#[cfg(test)]`), `web/tests/browser/app.test.ts`

**Interfaces:**
- Produces: `redextape_core::analysis::token_class_names() -> &'static [&'static str]`, in declaration order, index == discriminant. Wasm export `tokenClasses(): string[]`.

- [ ] **Step 1: Write the failing Rust test**

Append to `crates/redextape-core/src/analysis.rs`'s existing `#[cfg(test)] mod tests` (create the module at the end of the file if it has none):

```rust
    #[test]
    fn token_class_names_is_indexed_by_discriminant() {
        // EVERY VARIANT, and the index is the discriminant. `lambda_spans` crosses the wasm boundary
        // as a `Uint8Array` of these indices, so a name at the wrong index mis-colours silently.
        let names = token_class_names();
        assert_eq!(names.len(), 14);
        assert_eq!(names[TokenClass::Ident as usize], "Ident");
        assert_eq!(names[TokenClass::Binder as usize], "Binder");
        assert_eq!(names[TokenClass::Move as usize], "Move");
        assert_eq!(names[13], "Move", "Move is the last variant; a new one must be appended, not inserted");
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --lib token_class_names_is_indexed_by_discriminant`
Expected: FAIL — `cannot find function 'token_class_names' in this scope`.

- [ ] **Step 3: Add `token_class_names`**

Insert into `crates/redextape-core/src/analysis.rs` immediately after the `TokenClass` enum's closing brace (before `pub type Classified`):

```rust
/// Every `TokenClass` variant's name, in declaration order, so `names[c as usize] == name of c`.
///
/// EXPORTED SO THE TYPESCRIPT COPY CAN BE CHECKED RATHER THAN TRUSTED. `web/src/types.ts` holds the
/// same list by hand, and until now nothing could verify it — the residual risk its own doc names is
/// a variant added here and not mirrored there. That risk changes shape in Plan 5b: `LinkIndex` ships
/// classes as a `Uint8Array` of discriminants, so a REORDERING (not just an addition) would silently
/// mis-colour every span past the moved variant instead of producing an unrecognised string.
///
/// The list is written out rather than derived from a macro because the enum is written out too;
/// a macro pairing the two would be a third thing to keep in step. The test below is what makes the
/// pairing mechanical: it asserts the index of a variant at each end and in the middle, and pins the
/// count, so an insertion anywhere fails rather than shifting the tail by one.
pub fn token_class_names() -> &'static [&'static str] {
    &[
        "Ident",
        "Nat",
        "Bool",
        "Keyword",
        "Operator",
        "Punct",
        "Comment",
        "Binder",
        "Mnemonic",
        "Register",
        "Label",
        "StateName",
        "TapeSymbol",
        "Move",
    ]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p redextape-core --lib token_class_names_is_indexed_by_discriminant`
Expected: PASS.

- [ ] **Step 5: Add the wasm export**

Insert into `crates/redextape-wasm/src/lib.rs` immediately after the `encodings()` function:

```rust
/// `tokenClasses()` -> every `TokenClass` variant's name, in declaration order.
///
/// THE INDEX IS THE DISCRIMINANT, which is the whole reason this exists. `linkIndex` ships span
/// classes as a `Uint8Array` of discriminants rather than as 48,332 interned strings, and a
/// TypeScript array that disagreed about the order would mis-colour every span past the disagreement
/// with nothing failing. `types.ts` asserts its own `TOKEN_CLASSES` against this at startup.
///
/// Same argument as `encodings()` one layer over: a list of names in another language is a second
/// authoritative registry that not even the compiler is watching.
#[wasm_bindgen(js_name = tokenClasses)]
pub fn token_classes() -> Result<JsValue, JsValue> {
    to_value(&redextape_core::analysis::token_class_names())
}
```

- [ ] **Step 6: Pin `TOKEN_CLASSES` in TypeScript**

In `web/src/types.ts`, replace the paragraph beginning "It still cannot verify itself against the RUST enum" (lines 19-23) with:

```typescript
 * IT IS NOW CHECKED AGAINST THE RUST ENUM, which it was not through 5a. `tokenClasses()` returns the
 * same names in the same declaration order, and `assertTokenClasses` below fails loudly at startup if
 * the two disagree. That matters more from Plan 5b on than it did before: `LinkIndex` ships span
 * classes as a `Uint8Array` of DISCRIMINANTS, so a reordering here mis-colours silently rather than
 * producing an unrecognised string.
```

Then append to `web/src/types.ts`:

```typescript
/**
 * Fail loudly if the hand-written `TOKEN_CLASSES` has drifted from the Rust enum.
 *
 * AT STARTUP, NOT IN A TEST ONLY. A test can be skipped, a CI job can be scoped out, and the failure
 * this guards is silent mis-colouring rather than a crash. Called once from `main.ts` after `init()`.
 */
export function assertTokenClasses(fromWasm: string[]): void {
  const ours = TOKEN_CLASSES.join(',')
  const theirs = fromWasm.join(',')
  if (ours !== theirs) {
    throw new Error(`TOKEN_CLASSES has drifted from the Rust enum:\n  ts:   ${ours}\n  rust: ${theirs}`)
  }
}
```

- [ ] **Step 7: Call it from `main.ts`**

In `web/src/main.ts`, extend the wasm import on line 5 and add the assertion after the `init()` try/catch (after line 125):

```typescript
import init, { analyze, classifySource, encodings, tokenClasses } from '../../pkg/redextape_wasm.js'
```

```typescript
  // Checked once, here, immediately after the module is live. See `assertTokenClasses`.
  assertTokenClasses(tokenClasses() as string[])
```

Add `assertTokenClasses` to the existing `./types` import on line 19 — note it is a VALUE, not a type, so it needs its own import statement beside the `import type`:

```typescript
import { assertTokenClasses } from './types'
```

- [ ] **Step 8: Rebuild wasm and run the suites**

Run: `cd web && pnpm run build:wasm`
Then: `cargo test -p redextape-core --lib` and `cd web && pnpm test`
Expected: PASS.

> If the wasm build script has a different name, read `web/package.json`'s `scripts` and use the one that regenerates `pkg/`. Every later task that touches Rust needs this same rebuild before the web tiers see it.

- [ ] **Step 9: Commit**

```bash
git add crates/redextape-core/src/analysis.rs crates/redextape-wasm/src/lib.rs web/src/types.ts web/src/main.ts
git commit -m "core: tokenClasses(), so the TypeScript copy is checked rather than trusted"
```

---

### Task 3: `print_lambda_linked` — the recording printer

The printer must record, for each path the caller asks about, the byte span of the subterm printed at that path. `write_term`/`write_app_fn`/`write_atom`/`parenthesized` already carry **seven** parameters; recording needs two more and `clippy::too_many_arguments` denies at eight. So the six always-threaded parameters collapse into a receiver.

**Files:**
- Modify: `crates/redextape-core/src/lambda/syntax.rs:239-390` (the four walker functions and `print_lambda_capped`)
- Modify: `crates/redextape-core/src/lambda.rs:15` (re-export)
- Test: `crates/redextape-core/src/lambda/syntax.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `crate::lambda::term::{Dir, Path}`, `crate::core::NodeId`, `crate::span::Span`, `crate::analysis::{Classified, push_span, TokenClass}`.
- Produces: `pub fn print_lambda_linked(t: &LambdaTerm, byte_budget: usize, want: &BTreeMap<NodeId, Path>) -> (String, Classified, bool, Vec<(Span, NodeId)>)`. Re-exported from `crate::lambda`. Also adds `PartialOrd, Ord` to `Dir`'s derive list.

**Two corrections made during execution, both before any test was written:**

1. **`Dir` must derive `PartialOrd, Ord`.** It derives only `Clone, Copy, Debug, PartialEq, Eq`, so `Path = Vec<Dir>` is not `Ord` and the `BTreeMap<&Path, NodeId>` below does not compile. A `HashMap` fails one derive over — `Dir` derives no `Hash` either. Nothing depends on the *ordering* of paths, only on equality-based lookup, so a derive is safe; add a `///` note saying why, so nobody deletes it as unused.
2. **Every fixture must be closed, and the reprint oracle only holds for closed subterms.** `parse_atom` rejects a free identifier outright ("Everything the backend produces is closed", pinned by `free_variable_is_a_diagnostic`), so `f (g h)` panics in `parse_ok`. And `Var(i)` is resolved against the binders ambient where it is *printed*, so re-rooting a subterm that references an outer binder changes what it denotes — the body of `\x. x` prints `x` in context and `?0` extracted. See the design's §9.1a/§9.1b.

- [ ] **Step 1: Write the failing tests**

Append to `crates/redextape-core/src/lambda/syntax.rs`'s `#[cfg(test)] mod tests`:

```rust
    use std::collections::BTreeMap;

    use crate::lambda::term::{Dir, Path};

    /// Every path in `t`, paired with a synthetic `NodeId`, so a test can ask for the whole tree at
    /// once. Ids are assigned in walk order and mean nothing beyond being distinct.
    fn all_paths(t: &LambdaTerm) -> BTreeMap<u32, Path> {
        fn walk(t: &LambdaTerm, at: &mut Path, out: &mut Vec<Path>) {
            out.push(at.clone());
            match t.node() {
                Node::Var(_) => {}
                Node::Abs(_, body) => {
                    at.push(Dir::AbsBody);
                    walk(body, at, out);
                    at.pop();
                }
                Node::App(f, a) => {
                    at.push(Dir::AppL);
                    walk(f, at, out);
                    at.pop();
                    at.push(Dir::AppR);
                    walk(a, at, out);
                    at.pop();
                }
            }
        }
        let mut paths = Vec::new();
        walk(t, &mut Path::new(), &mut paths);
        paths.into_iter().enumerate().map(|(i, p)| (i as u32, p)).collect()
    }

    /// The subterm at `path`, or `None` if the path leaves the term.
    fn at_path<'a>(t: &'a LambdaTerm, path: &[Dir]) -> Option<&'a LambdaTerm> {
        let mut cur = t;
        for d in path {
            cur = match (d, cur.node()) {
                (Dir::AbsBody, Node::Abs(_, body)) => body,
                (Dir::AppL, Node::App(f, _)) => f,
                (Dir::AppR, Node::App(_, a)) => a,
                _ => return None,
            };
        }
        Some(cur)
    }

    #[test]
    fn an_empty_want_is_byte_identical_to_the_capped_printer() {
        // ONE WALKER, NOT TWO — the same property `an_unreachable_budget_is_identical_to_the_uncapped
        // _printer` pins one layer out. `print_lambda_capped` now delegates here, so a divergence
        // would mean the recording path had quietly become a second printer.
        for src in ["\\x. x", "\\z. (\\f. \\x. f (f x)) (\\y. y) z", "\\a. \\b. a b (a b)"] {
            let t = parse_ok(src);
            let want: BTreeMap<u32, Path> = BTreeMap::new();
            for budget in [4, 16, 64, usize::MAX] {
                let (a, sa, ha) = print_lambda_capped(&t, budget);
                let (b, sb, hb, nodes) = print_lambda_linked(&t, budget, &want);
                assert_eq!(a, b, "{src:?} at budget {budget}");
                assert_eq!(sa, sb, "{src:?} spans at budget {budget}");
                assert_eq!(ha, hb, "{src:?} truncated at budget {budget}");
                assert!(nodes.is_empty(), "an empty want records nothing");
            }
        }
    }

    #[test]
    fn a_closed_subterms_recorded_span_is_exactly_its_own_printing() {
        // THE REPRINT ORACLE, AND WHY IT IS RESTRICTED TO CLOSED SUBTERMS. `Var(i)` is a de Bruijn
        // index resolved against the binders ambient where it is PRINTED, so re-rooting a subterm that
        // references an outer binder changes what it means: the body of `\x. x` prints `x` in context
        // and `?0` standalone, `?0` being this printer's deliberate marker for an index with no binder.
        // Comparing those would be testing de Bruijn semantics, not span recording. `maxfree() == 0` is
        // exactly the condition under which extraction is meaning-preserving.
        //
        // THE FIXTURES ARE CHOSEN SO THE RESTRICTION IS NOT A GUTTING. An application of closed terms
        // has closed subterms at the root, at both `App` arms, and at their arms in turn — which is
        // precisely the structure a swapped `AppL`/`AppR` push would corrupt. `checked` pins the count
        // so a future fixture edit cannot quietly reduce this to the trivial root case.
        let mut checked = 0;
        for (src, expect_closed) in
            [("\\x. x", 1), ("(\\x. x) (\\y. y y)", 3), ("(\\f. \\x. f (f x)) (\\y. y) (\\z. z)", 5)]
        {
            let t = parse_ok(src);
            let want = all_paths(&t);
            let (text, _, truncated, nodes) = print_lambda_linked(&t, usize::MAX, &want);
            assert!(!truncated, "{src:?} must print whole at an unreachable budget");
            assert_eq!(nodes.len(), want.len(), "{src:?}: every path recorded when nothing truncates");

            let mut closed_here = 0;
            for (span, id) in &nodes {
                let path = want.get(id).expect("recorded id must be one we asked for");
                let sub = at_path(&t, path).expect("recorded path must resolve");
                if sub.maxfree() != 0 {
                    continue;
                }
                // CLOSED IS NECESSARY, NOT SUFFICIENT, and the second reason is nothing to do with de
                // Bruijn. A subterm's ROLE in its parent decides its parentheses — `AppFn` wraps an
                // `Abs`, `Atom` wraps anything but a `Var`, `Term` (the root, and every `AbsBody`
                // slot) wraps nothing — and `print_lambda_mapped` always prints at `Term`, so it never
                // adds positional parens. That is the same "a recorded span includes the node's own
                // parentheses" contract `a_recorded_span_includes_the_nodes_own_parentheses` pins.
                //
                // THE ROLE IS PREDICTED, NOT TOLERATED. Accepting "the reprint, or the reprint in
                // parens" would pass a node that should be wrapped and is not, and one that should not
                // be and is — the exact `Role` dispatch this oracle exists to cover. The last step of
                // the path and the subterm's own kind determine the answer, so this stays an equality.
                let (base, _) = print_lambda_mapped(sub);
                let wrapped = match path.last() {
                    None | Some(Dir::AbsBody) => false,
                    Some(Dir::AppL) => matches!(sub.node(), Node::Abs(..)),
                    Some(Dir::AppR) => !matches!(sub.node(), Node::Var(_)),
                };
                let expected = if wrapped { format!("({base})") } else { base };
                assert_eq!(&text[span.start..span.end], expected, "{src:?}: path {path:?}");
                closed_here += 1;
            }
            assert_eq!(closed_here, expect_closed, "{src:?}: closed-subterm count changed");
            checked += closed_here;
        }
        assert_eq!(checked, 9, "the oracle must not go vacuous");
    }

    #[test]
    fn an_applications_arms_are_recorded_in_the_order_they_print() {
        // THE ORACLE FOR EVERY OTHER SUBTERM, and the one that actually catches a swapped arm. It needs
        // no reprinting, so it is unaffected by de Bruijn context: the function position is written
        // before the argument, so `AppL`'s span must end at or before `AppR`'s begins, and both must
        // sit strictly inside the parent's. Pushing `AppR` where `AppL` belongs makes the left child's
        // span come back under the right child's path, and this inverts.
        let mut arms = 0;
        for src in ["\\z. (\\f. \\x. f (f x)) (\\y. y) z", "\\a. \\b. a b (a b)", "\\f. \\g. \\h. f (g h) (\\q. q q)"] {
            let t = parse_ok(src);
            let want = all_paths(&t);
            let (_, _, _, nodes) = print_lambda_linked(&t, usize::MAX, &want);
            let by_path: BTreeMap<&Path, Span> =
                nodes.iter().map(|(s, id)| (want.get(id).expect("known id"), *s)).collect();
            for (path, parent) in &by_path {
                let mut l = (*path).clone();
                l.push(Dir::AppL);
                let mut r = (*path).clone();
                r.push(Dir::AppR);
                let (Some(ls), Some(rs)) = (by_path.get(&l), by_path.get(&r)) else { continue };
                assert!(ls.end <= rs.start, "{src:?}: {path:?} arms out of order — {ls:?} then {rs:?}");
                assert!(parent.start <= ls.start && rs.end <= parent.end, "{src:?}: {path:?} arms escape parent");
                arms += 1;
            }
        }
        assert!(arms >= 6, "only {arms} applications checked — the fixtures stopped exercising this");
    }

    #[test]
    fn an_ancestors_span_contains_its_descendants() {
        let t = parse_ok("\\z. (\\f. \\x. f (f x)) (\\y. y) z");
        let want = all_paths(&t);
        let (_, _, _, nodes) = print_lambda_linked(&t, usize::MAX, &want);
        let by_id: BTreeMap<u32, Span> = nodes.iter().map(|(s, id)| (*id, *s)).collect();
        for (outer, outer_path) in &want {
            for (inner, inner_path) in &want {
                if outer == inner || !inner_path.starts_with(outer_path) {
                    continue;
                }
                let (o, i) = match (by_id.get(outer), by_id.get(inner)) {
                    (Some(o), Some(i)) => (o, i),
                    _ => continue,
                };
                assert!(
                    o.start <= i.start && i.end <= o.end,
                    "path {outer_path:?} {o:?} must contain {inner_path:?} {i:?}"
                );
            }
        }
    }

    #[test]
    fn a_recorded_span_includes_the_nodes_own_parentheses() {
        // `\\y. y` in argument position is printed `(\\y. y)`, and the highlight must cover the
        // parens: lighting `\\y. y` alone names a subterm that is not the one at that path.
        let t = parse_ok("\\f. f (\\y. y)");
        let mut want: BTreeMap<u32, Path> = BTreeMap::new();
        want.insert(7, vec![Dir::AbsBody, Dir::AppR]);
        let (text, _, _, nodes) = print_lambda_linked(&t, usize::MAX, &want);
        assert_eq!(text, "\u{3bb}f. f (\u{3bb}y. y)");
        let (span, id) = nodes.first().copied().expect("the argument must be recorded");
        assert_eq!(id, 7);
        assert_eq!(&text[span.start..span.end], "(\u{3bb}y. y)");
    }

    #[test]
    fn a_node_past_the_cut_records_nothing_rather_than_a_clamped_span() {
        // ABSENT, NEVER WRONG. A span clamped to the truncation point would claim the subterm ends
        // there, which is a different and false statement from "this subterm is not shown".
        let t = parse_ok("\\f. \\g. \\h. f (g h) (\\q. q q)");
        let want = all_paths(&t);
        let (text, _, truncated, nodes) = print_lambda_linked(&t, 4, &want);
        assert!(truncated, "budget 4 must truncate this term");
        for (span, _) in &nodes {
            assert!(span.end <= text.len(), "a recorded span must lie inside the text that was produced");
        }
        assert!(nodes.len() < want.len(), "a truncated print cannot have recorded every path");
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -p redextape-core --lib lambda::syntax`
Expected: FAIL — `cannot find function 'print_lambda_linked' in this scope`.

- [ ] **Step 3: Replace the four walker functions with a `Printer`**

In `crates/redextape-core/src/lambda/syntax.rs`, extend the imports near line 36:

```rust
use std::collections::BTreeMap;

use crate::analysis::push_span;
use crate::core::NodeId;
use crate::lambda::term::{Dir, Path};
use crate::span::Span;
```

(Keep whatever of these the file already imports; do not duplicate.)

Then replace `print_lambda_capped`'s **body** and everything from `fn write_term` through the end of `fn parenthesized` with:

```rust
pub fn print_lambda_capped(t: &LambdaTerm, byte_budget: usize) -> (String, crate::analysis::Classified, bool) {
    let want: BTreeMap<NodeId, Path> = BTreeMap::new();
    let (text, spans, hit, _) = print_lambda_linked(t, byte_budget, &want);
    (text, spans, hit)
}

/// `print_lambda_capped`, plus the byte span of every subterm the caller named by path.
///
/// WHAT THIS IS FOR. `SourceMap::node_to_lambda` locates a Core node's subterm as a `Path`, and
/// highlighting it in printed text needs a byte `Span`. Nothing correlated the two until this
/// function; `viewmodel.rs`'s no-`redex` doc is where that gap was priced. Plan 5b's click-linking is
/// the consumer.
///
/// `want` IS KEYED BY `NodeId` AND INVERTED HERE, rather than taken pre-inverted, so a caller cannot
/// get the inversion wrong. Two nodes may name the same path — a transparent wrapper lowers to the
/// subterm it wraps — and the inversion keeps the FIRST by node id, which is the same rule
/// `sourcemap::lambda_half` applies when two paths name one node.
///
/// **A NODE PAST THE TRUNCATION CUT RECORDS NOTHING**, rather than a span clamped to where the walk
/// stopped. A clamped span would say "this subterm ends here", which is false; absence says "this
/// subterm is not shown", which is true. The same rule holds for a node whose walk was interrupted by
/// the DEPTH bail partway through a descendant: its own span would be incomplete, so it is not
/// recorded either.
///
/// **A RECORDED SPAN INCLUDES THE NODE'S OWN PARENTHESES.** `parens` writes `(` before delegating, and
/// the entry mark is taken outside it. Lighting `f x` but not the parens around it names a different
/// subterm than the one at that path.
///
/// Cost is one walk, the walk that was already happening. `want` is `SourceMap::node_to_lambda`, which
/// the demo corpus measures at 5-403 entries.
pub fn print_lambda_linked(
    t: &LambdaTerm,
    byte_budget: usize,
    want: &BTreeMap<NodeId, Path>,
) -> (String, crate::analysis::Classified, bool, Vec<(Span, NodeId)>) {
    let mut by_path: BTreeMap<&Path, NodeId> = BTreeMap::new();
    for (id, path) in want {
        by_path.entry(path).or_insert(*id);
    }
    let mut p = Printer {
        names: Vec::new(),
        out: String::new(),
        spans: Vec::new(),
        budget: byte_budget,
        hit: false,
        path: Path::new(),
        want: &by_path,
        nodes: Vec::new(),
    };
    p.node(t, 0, Role::Term);
    (p.out, p.spans, p.hit, p.nodes)
}

/// Where a node sits in its parent, which is what decides whether it needs parentheses.
#[derive(Clone, Copy)]
enum Role {
    /// The root, an `Abs` body, or the inside of a paren pair: never parenthesized by its position.
    Term,
    /// The function position of an application: an abstraction there needs parens.
    AppFn,
    /// An argument: abstractions and applications need parens.
    Atom,
}

/// The printer's state, threaded as one receiver rather than as seven parameters.
///
/// A STRUCT BECAUSE THE PARAMETER LIST RAN OUT, and the shape is otherwise unchanged. The four walker
/// functions already carried seven arguments each; recording spans needs two more (the current path,
/// and somewhere to put the results) and `clippy::too_many_arguments` denies at eight. Every field
/// here was already threaded through every call, unchanged or mutated in place, so collapsing them
/// costs nothing but the receiver.
struct Printer<'a> {
    names: Vec<String>,
    out: String,
    spans: crate::analysis::Classified,
    budget: usize,
    hit: bool,
    /// The path from the root to the node being written. Pushed and popped at exactly the three
    /// points `Dir` names, and at no others — the dispatch hops in `node` are the SAME node.
    path: Path,
    want: &'a BTreeMap<&'a Path, NodeId>,
    nodes: Vec<(Span, NodeId)>,
}

// `depth` counts `Abs`/`App` levels from the root (0 there), one native call apart from the true
// recursion depth only by the fixed dispatch hops below — `node` and `parens` pass it through
// UNCHANGED when they delegate on the SAME node (a different method, not a deeper term), and only
// `write`'s `Abs` and `App` arms increment it, matching exactly the unit `LambdaTerm::depth` counts.
// Checked at the top of `node`, `write` and `parens`, right next to the budget check, so a term whose
// recursion the budget cannot bound (see the left-nested-spine paragraph on `print_lambda_capped`'s
// doc) still stops well short of a native stack overflow.
impl Printer<'_> {
    /// Write `t` in `role`, recording its span if the caller asked for this path.
    ///
    /// THE ONE RECORDING SITE. Every node reaches the printer through exactly one call here, so the
    /// span recorded covers everything written for that subterm — including any parentheses `role`
    /// causes. `parens` delegates to `write` rather than back to `node`, which is what stops a
    /// parenthesized node being recorded twice, the second time without its parens.
    fn node(&mut self, t: &LambdaTerm, depth: u32, role: Role) {
        if self.out.len() >= self.budget || depth > MAX_TERM_DEPTH {
            self.hit = true;
            return;
        }
        let start = self.out.len();
        match role {
            Role::Term => self.write(t, depth),
            Role::AppFn => match t.node() {
                Node::Abs(..) => self.parens(t, depth),
                _ => self.write(t, depth),
            },
            Role::Atom => match t.node() {
                Node::Var(_) => self.write(t, depth),
                _ => self.parens(t, depth),
            },
        }
        if self.hit {
            return;
        }
        if let Some(&id) = self.want.get(&self.path) {
            self.nodes.push((Span::new(start, self.out.len()), id));
        }
    }

    fn write(&mut self, t: &LambdaTerm, depth: u32) {
        if self.out.len() >= self.budget || depth > MAX_TERM_DEPTH {
            self.hit = true;
            return;
        }
        use crate::analysis::TokenClass as C;
        match t.node() {
            Node::Var(i) => {
                let idx = self.names.len().checked_sub(1 + *i as usize);
                let name = idx.and_then(|k| self.names.get(k)).cloned().unwrap_or_else(|| format!("?{i}"));
                push_span(&mut self.out, &mut self.spans, &name, C::Ident);
            }
            Node::Abs(hint, body) => {
                let name = fresh(hint, &self.names);
                push_span(&mut self.out, &mut self.spans, "\u{3bb}", C::Binder);
                push_span(&mut self.out, &mut self.spans, &name, C::Binder);
                // The binder's `.` is punctuation, classified like the `(` and `)` in `parens` and
                // like the TM printer's `:`/`,`/`->`. The space after it is whitespace and stays
                // outside the span: §6 asks for coverage of everything EXCEPT whitespace.
                push_span(&mut self.out, &mut self.spans, ".", C::Punct);
                self.out.push(' ');
                self.names.push(name);
                self.path.push(Dir::AbsBody);
                self.node(body, depth + 1, Role::Term);
                self.path.pop();
                self.names.pop();
            }
            Node::App(f, a) => {
                self.path.push(Dir::AppL);
                self.node(f, depth + 1, Role::AppFn);
                self.path.pop();
                // Re-checked for the same reason `parens` re-checks before its closing paren, and this
                // is the LEFT-nested mirror of that case. `lower.rs`'s `Core::Apply` builds
                // `term = app(term, la)` in a loop, so `f(a, b, c)` is `App(App(App(f,a),b),c)`;
                // without this check every enclosing frame pushes its separator as the stack unwinds,
                // and the overshoot the doc comment bounds at one binder prefix becomes one space PER
                // ARGUMENT. Depth is deliberately NOT re-checked here: `f` and `a` are both visited at
                // `depth + 1`, so a bail exactly at that depth fires identically for both, and the
                // effect is one stray space at the frontier bail site rather than a correctness gap —
                // `hit` is already set by whichever call bailed.
                if self.out.len() >= self.budget {
                    self.hit = true;
                    return;
                }
                self.out.push(' ');
                self.path.push(Dir::AppR);
                self.node(a, depth + 1, Role::Atom);
                self.path.pop();
            }
        }
    }

    fn parens(&mut self, t: &LambdaTerm, depth: u32) {
        if self.out.len() >= self.budget || depth > MAX_TERM_DEPTH {
            self.hit = true;
            return;
        }
        use crate::analysis::TokenClass as C;
        push_span(&mut self.out, &mut self.spans, "(", C::Punct);
        self.write(t, depth);
        // Re-checked, not assumed: without this, a budget that fired partway through `write` above
        // would still be followed by an unconditional `)`, and every enclosing `parens` frame on the
        // call stack would do the same as it unwound — turning "one binder prefix of overshoot" into
        // one closing paren PER NESTING LEVEL for a right-nested term (exactly the application chains
        // a Church numeral or a cons chain builds). This is what keeps the bound the doc comment
        // states actually true.
        if self.out.len() >= self.budget {
            self.hit = true;
            return;
        }
        push_span(&mut self.out, &mut self.spans, ")", C::Punct);
    }
}
```

> **Do not delete `fn fresh`** — it is unchanged and still used, but it now takes `&self.names` at its one call site.

- [ ] **Step 4: Re-export from the module**

In `crates/redextape-core/src/lambda.rs:15`, extend the `syntax` re-export:

```rust
pub use syntax::{parse_lambda, print_lambda, print_lambda_capped, print_lambda_linked, print_lambda_mapped};
```

- [ ] **Step 5: Run the tests**

Run: `cargo test -p redextape-core --lib lambda::syntax`
Expected: PASS, including every pre-existing printer test — the round-trip property, the budget tests, and `an_unreachable_budget_is_identical_to_the_uncapped_printer`.

- [ ] **Step 6: Run the whole core suite and clippy**

Run: `cargo test -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings && cargo fmt --check`
Expected: PASS. `too_many_arguments` must not fire.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/lambda/syntax.rs crates/redextape-core/src/lambda.rs
git commit -m "lambda: the printer records where a path lands, so a subterm can be highlighted"
```

---

### Task 4: `LinkIndex` and its builder

**The one thing that is easy to get wrong here:** `node_to_tm`'s `StateId`s and `TmProgram.states`'s indices come from **two different lowerings at two different widths**. `SourceMap::build_from_program` lowers at `MIN_FIELD_WIDTH` to record ownership; `run_tm_described` re-lowers and auto-fits its own width. Only the state **names** are guaranteed to agree — which is exactly why `TmState::window` resolves through `map.tm_owner(&name)`. Flattening `node_to_tm` into an array keyed by the run's `StateId` would mis-attribute most states in silence.

**Files:**
- Modify: `crates/redextape-core/src/viewmodel.rs` (append the type and builder)
- Test: `crates/redextape-core/tests/viewmodel_contract.rs`

**Interfaces:**
- Consumes: `print_lambda_linked` (Task 3), `SourceMap`, `TmProgram`.
- Produces:
```rust
pub struct LinkIndex {
    pub lambda_text: String,
    pub lambda_spans: Vec<(Span, TokenClass)>,
    pub lambda_truncated: bool,
    pub lambda_nodes: Vec<(Span, NodeId)>,
    pub source_nodes: Vec<(Span, NodeId)>,
    pub tm_owner: Vec<i32>,
}
impl LinkIndex {
    pub fn build(term: Option<&LambdaTerm>, program: Option<&TmProgram>, map: &SourceMap, byte_budget: usize) -> LinkIndex;
}
```

- [ ] **Step 1: Write the failing test**

Append to `crates/redextape-core/tests/viewmodel_contract.rs`:

```rust
#[test]
fn link_index_resolves_tm_owners_by_name_at_the_width_the_run_fitted() {
    // THE TRAP THIS PINS. `SourceMap::build_from_program` lowers at `MIN_FIELD_WIDTH` purely to record
    // ownership; `run_tm_described` re-lowers and auto-fits a possibly different width. `node_to_tm`'s
    // StateIds therefore index a DIFFERENT machine from `TmProgram.states`. Only names agree, so
    // `tm_owner` must be built by name — the same resolution `TmState::window` performs per step.
    let src = "let x = 40; x + 2";
    let (program, diags) = redextape_core::parser::parse(src);
    let program = program.expect("the sample must parse");
    assert!(diags.is_empty(), "diagnostics: {diags:?}");
    let ty = redextape_core::typeck::result_type(&program).expect("the sample must type");
    let kind = redextape_core::tm::EncodingKind::Binary;
    let enc = kind.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, map) = SourceMap::build_from_program(&program, &*enc);

    let described = redextape_core::tm::run_tm_described(&core, kind, ty, redextape_core::tm::TM_DEFAULT_CAPS)
        .expect("the sample must lower");
    let width = described.header.width;
    let machine = std::rc::Rc::new(described.machine);
    let tm_program = TmProgram::of(&machine, width);

    let term = redextape_core::lambda::lower(&core).expect("the sample must lower to lambda");
    let index = LinkIndex::build(Some(&term), Some(&tm_program), &map, 65_536);

    assert_eq!(index.tm_owner.len(), tm_program.states.len(), "one slot per state, dense");
    let mut owned = 0;
    for (s, state) in tm_program.states.iter().enumerate() {
        let expected = map.tm_owner(&state.name).map_or(-1, |n| n as i32);
        assert_eq!(index.tm_owner[s], expected, "state {s} ({})", state.name);
        if expected >= 0 {
            owned += 1;
        }
    }
    assert!(owned > 0, "the sample must have at least one owned state, or this test proves nothing");

    // The lambda leg. The sample's every source-mapped node carries a path, and the term prints well
    // inside the budget, so every one of them must have a span.
    assert!(!index.lambda_truncated, "the sample must print whole at 65,536 bytes");
    assert_eq!(index.lambda_nodes.len(), map.node_to_lambda.len());
    assert_eq!(index.source_nodes.len(), map.node_to_source.len());
    for (span, id) in &index.source_nodes {
        assert_eq!(map.source_span(*id), Some(*span));
    }
}

#[test]
fn link_index_is_total_over_a_declined_leg() {
    // Both halves are optional and neither absence may abort. A `None` term gives empty lambda legs;
    // a `None` program gives an empty `tm_owner`. `SourceMap::build` already behaves this way over a
    // backend that declines, and the index must not be the place that stops being total.
    let map = SourceMap::default();
    let index = LinkIndex::build(None, None, &map, 65_536);
    assert_eq!(index.lambda_text, "");
    assert!(index.lambda_spans.is_empty());
    assert!(!index.lambda_truncated);
    assert!(index.lambda_nodes.is_empty());
    assert!(index.source_nodes.is_empty());
    assert!(index.tm_owner.is_empty());
}
```

Add whatever imports the file lacks at its top: `use redextape_core::sourcemap::SourceMap;`, `use redextape_core::viewmodel::{LinkIndex, TmProgram};`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --test viewmodel_contract link_index`
Expected: FAIL — `cannot find type 'LinkIndex'`.

- [ ] **Step 3: Add `LinkIndex` to `viewmodel.rs`**

Append to `crates/redextape-core/src/viewmodel.rs`:

```rust
/// Everything a renderer needs to link one construct across three panes, built ONCE PER COMPILE.
///
/// NOT A FRAME, AND THE DIFFERENCE IS THE WHOLE DESIGN. `LambdaState` is recorded per step at
/// `FRAME_BYTES`; this is built once, at the readout's budget, for the INITIAL term only. That is
/// what makes it affordable where `LambdaState::ast` was not: a per-step tree cost 850 MB against a
/// 32 MB ring, and this costs one extra print per compile over a walk that was already happening.
///
/// **IT IS STEP-0 ONLY, AND THAT IS NOT A SHORTCUT.** `SourceMap::node_to_lambda` records paths
/// root-relative into the initial lowered term; normal-order reduction contracts root redexes, so at
/// step N > 1 a path indexes a structurally different tree. `LambdaState` had a `source_node` on that
/// mistake and lost it — see this module's header. A consumer must not use `lambda_nodes` against any
/// term but the one `lambda_text` holds.
///
/// **ONE STRUCT RATHER THAN THREE ACCESSORS**, because all three legs must come from ONE compile. Three
/// would be three chances to hold one program's source index beside another program's lambda index;
/// the `NodeId`s would resolve, most of them to the wrong construct, and nothing would notice. That is
/// the failure `SourceMap` is shaped to remove by offering no `with_source` setter, applied at the
/// boundary instead of inside the map.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct LinkIndex {
    /// The INITIAL term, printed at the caller's budget.
    pub lambda_text: String,
    pub lambda_spans: Vec<(Span, TokenClass)>,
    pub lambda_truncated: bool,
    /// A node's span in `lambda_text`. ABSENT for a node whose subterm fell past the cut, never a
    /// span clamped to it — see `print_lambda_linked`.
    pub lambda_nodes: Vec<(Span, NodeId)>,
    /// A node's span in the SOURCE text. Empty unless the map was built by `build_from_program`.
    pub source_nodes: Vec<(Span, NodeId)>,
    /// `tm_owner[state_id]` is the Core node that produced that state, or `-1`.
    ///
    /// **BUILT BY NAME, NOT BY FLATTENING `node_to_tm`.** `SourceMap::build_from_program` lowers at
    /// `MIN_FIELD_WIDTH` only to record ownership, and `run_tm_described` re-lowers with its own
    /// auto-fitted width — so `node_to_tm`'s `StateId`s index a different machine from the one
    /// `TmProgram.states` indexes. The invariant that survives the width change is that `lower_tm`
    /// derives state NAMES from the instruction stream, so the two lowerings agree on names. This is
    /// the same resolution `TmState::window` performs per step, hoisted to once per compile.
    ///
    /// `-1` RATHER THAN `Option<NodeId>` because this crosses to JavaScript as an `Int32Array`, and a
    /// dense typed array is the difference between 143 KB and 26,484 objects for `list60`. `NodeId` is
    /// a `u32`, so `-1` cannot collide with a real node.
    pub tm_owner: Vec<i32>,
}

impl LinkIndex {
    /// Build all three legs from one compile.
    ///
    /// TOTAL OVER BOTH ABSENCES. A `None` term (the lambda backend declined this program) gives empty
    /// lambda legs rather than failing, and a `None` program (the TM backend declined) gives an empty
    /// `tm_owner`. `SourceMap::build` is already total over exactly these refusals, and the index must
    /// not be the layer that stops being.
    ///
    /// `byte_budget` IS A PARAMETER because this file picks no numbers — see the module header. The
    /// web app passes `LAMBDA_BYTE_BUDGET`.
    pub fn build(
        term: Option<&LambdaTerm>,
        program: Option<&TmProgram>,
        map: &SourceMap,
        byte_budget: usize,
    ) -> LinkIndex {
        let (lambda_text, lambda_spans, lambda_truncated, lambda_nodes) = match term {
            None => (String::new(), Vec::new(), false, Vec::new()),
            Some(t) => print_lambda_linked(t, byte_budget, &map.node_to_lambda),
        };
        let source_nodes = map.node_to_source.iter().map(|(id, span)| (*span, *id)).collect();
        let tm_owner = program
            .map(|p| p.states.iter().map(|s| map.tm_owner(&s.name).map_or(-1, |n| n as i32)).collect())
            .unwrap_or_default();
        LinkIndex { lambda_text, lambda_spans, lambda_truncated, lambda_nodes, source_nodes, tm_owner }
    }
}
```

Extend the file's imports at line 19 to include `print_lambda_linked`:

```rust
use crate::lambda::{LambdaTerm, print_lambda_capped, print_lambda_linked};
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p redextape-core --test viewmodel_contract link_index`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run clippy and fmt**

Run: `cargo clippy -p redextape-core --all-targets -- -D warnings && cargo fmt --check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/viewmodel.rs crates/redextape-core/tests/viewmodel_contract.rs
git commit -m "viewmodel: LinkIndex — three legs from one compile, and tm_owner keyed by name"
```

---

### Task 5: `link_index_probe.rs` — the permanent measurement

Every number in the design came from a throwaway probe, and a throwaway probe's numbers rot silently. This makes the three tables re-runnable, following `frame_cost_probe.rs`.

**Files:**
- Create: `crates/redextape-core/examples/link_index_probe.rs`

**Interfaces:**
- Consumes: `LinkIndex::build` (Task 4).
- Produces: nothing importable — a `cargo run --example` target.

- [ ] **Step 1: Write the probe**

Create `crates/redextape-core/examples/link_index_probe.rs`:

```rust
//! **What does `linkIndex()` weigh, and how many clicks land?** The measurements Plan 5b's design
//! §2.1-§2.3 is built on, made re-runnable.
//!
//! # HOW TO RUN THIS
//!
//! ```text
//! systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0 -- \
//!   cargo run --release -p redextape-core --features serde --example link_index_probe
//! ```
//!
//! The cgroup cap follows `frame_cost_probe`'s convention. **This probe reduces nothing** — it holds
//! no cursor and never calls `reduce_trace` — so it is far cheaper than that one, but the cap costs
//! nothing and an OOM here would still be a result rather than something to work around.
//!
//! # THE QUESTIONS
//!
//! 1. **How large is the step-0 term?** 5b's lambda link is step-0 only, so the text it highlights
//!    against is `print(lower(core))` — bounded by the PROGRAM, not by any reduction. If that prints
//!    whole at a sane budget, windowing around a clicked construct is a JS string slice rather than
//!    new printer machinery. `while40`, which defeated 5a-ii's tree bound, is irrelevant here: it
//!    explodes at step N, not step 0.
//! 2. **How many clicks land?** A click resolves to the innermost node whose source span contains it.
//!    That node needs a lambda path for the lambda highlight and a TM block for the table highlight.
//!    The share carrying each is what decides whether the feature feels alive or dead.
//! 3. **What does the index weigh on the wire?** Naive (an array of objects) against columnar (typed
//!    arrays), which is the decision design §4.1 records.
//!
//! # WHAT THE NUMBERS ARE NOT
//!
//! `naive_b` is JSON and is a PROXY for the JS heap cost, the same caveat `frame_cost_probe` states
//! about its own `json_b`. `columnar_b` is exact, because a typed array's byte length is its byte
//! length.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io::Write;
use std::rc::Rc;

use redextape_core::lambda;
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::{self, EncodingKind, TmRun};
use redextape_core::viewmodel::{LinkIndex, TmProgram};
use redextape_core::{parser, typeck};

/// `LAMBDA_BYTE_BUDGET` from `web/src/protocol.ts:9` — the budget the app passes `linkIndex`.
const WEB_BYTE_BUDGET: usize = 65_536;

/// Programs, spread deliberately. The first seven are `frame_cost_probe`'s own calibration rows; the
/// last two exist to falsify, and they attack a DIFFERENT bound from that probe's. The standing lesson
/// is that a corpus chosen to be representative cannot break a bound, and 5a-ii proved it twice in one
/// day.
fn programs() -> Vec<(String, String)> {
    let list20 = format!("[{}]", (1..=20).map(|n| n.to_string()).collect::<Vec<_>>().join(", "));
    let list60 = format!("[{}]", (1..=60).map(|n| n.to_string()).collect::<Vec<_>>().join(", "));
    let mut v: Vec<(String, String)> = [
        ("sample", "let x = 40; x + 2"),
        ("list2", "[1, 2]"),
        ("while4", "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc"),
        ("sum5", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"),
        (
            "countdown4",
            "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
        ),
        (
            "map_fold",
            "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
             fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
             fn add(a, b) { a + b }\n\
             fn add1(x) { x + 1 }\n\
             fold([3, 1, 2].map(add1), 0, add)",
        ),
        ("num200", "let x = 200; x + 1"),
    ]
    .iter()
    .map(|(n, s)| ((*n).to_string(), (*s).to_string()))
    .collect();
    v.push(("list20".to_string(), list20));
    v.push(("list60".to_string(), list60));
    v.push((
        "while40".to_string(),
        "let mut n = 40; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc".to_string(),
    ));
    // --- picked to defeat THIS bound, not to represent the corpus -------------------------------
    // The step-0 term is proportional to PROGRAM size, so the way to attack it is a big program.
    let lets = (1..=200).map(|n| format!("let y{n} = {n};")).collect::<Vec<_>>().join(" ");
    v.push(("prog200".to_string(), format!("let x = 900; {lets} x")));
    // And the OTHER axis, which is the genuinely unbounded one: this language lowers naturals to UNARY
    // Church numerals, so ONE literal is O(n) bytes of lambda text regardless of program length.
    v.push(("num2000".to_string(), "let x = 2000; x + 1".to_string()));
    v
}

struct Row {
    name: String,
    src_b: usize,
    step0_b: usize,
    truncated: bool,
    lam_spans: usize,
    states: usize,
    src_nodes: usize,
    lam_nodes: usize,
    owned_states: usize,
    naive_b: usize,
    columnar_b: usize,
}

fn build(name: &str, src: &str) -> Option<Row> {
    let (program, _) = parser::parse(src);
    let program = program?;
    if typeck::typecheck(&program).iter().any(|d| d.severity == redextape_core::Severity::Error) {
        return None;
    }
    let ty = typeck::result_type(&program).ok()?;
    let kind = EncodingKind::Binary;
    let enc = kind.at(tm::MIN_FIELD_WIDTH);
    let (core, map) = SourceMap::build_from_program(&program, &*enc);

    let tm_program = match tm::run_tm_described(&core, kind, ty, tm::TM_DEFAULT_CAPS) {
        Ok(d) => match d.run {
            TmRun::Ran { .. } | TmRun::HitCap => {
                let width = d.header.width;
                Some(TmProgram::of(&Rc::new(d.machine), width))
            }
            _ => None,
        },
        Err(_) => None,
    };
    let term = lambda::lower(&core).ok();
    let index = LinkIndex::build(term.as_ref(), tm_program.as_ref(), &map, WEB_BYTE_BUDGET);

    // Columnar, exactly as `linkIndex` ships it: text + 3 span/id arrays x 2 legs + one owner array.
    let columnar_b = index.lambda_text.len()
        + index.lambda_spans.len() * 9
        + index.lambda_nodes.len() * 12
        + index.source_nodes.len() * 12
        + index.tm_owner.len() * 4;

    Some(Row {
        name: name.to_string(),
        src_b: src.len(),
        step0_b: index.lambda_text.len(),
        truncated: index.lambda_truncated,
        lam_spans: index.lambda_spans.len(),
        states: index.tm_owner.len(),
        src_nodes: index.source_nodes.len(),
        lam_nodes: index.lambda_nodes.len(),
        owned_states: index.tm_owner.iter().filter(|o| **o >= 0).count(),
        naive_b: naive_len(&index),
        columnar_b,
    })
}

#[cfg(feature = "serde")]
fn naive_len(index: &LinkIndex) -> usize {
    serde_json::to_vec(index).map(|b| b.len()).unwrap_or(0)
}

#[cfg(not(feature = "serde"))]
fn naive_len(_index: &LinkIndex) -> usize {
    0
}

fn main() {
    println!("Plan 5b link index. `naive_b` is JSON and reads 0 without --features serde.\n");
    println!(
        "{:<12} {:>7} {:>9} {:>5} {:>9} {:>8} {:>8} {:>8} {:>8} {:>10} {:>10}",
        "program", "src_b", "step0_b", "cut", "lam_spans", "states", "src_n", "lam_n", "owned", "naive_b", "colmn_b"
    );
    println!("{}", "-".repeat(112));
    let _ = std::io::stdout().flush();
    for (name, src) in programs() {
        match build(&name, &src) {
            None => println!("{name:<12} did not compile"),
            Some(r) => println!(
                "{:<12} {:>7} {:>9} {:>5} {:>9} {:>8} {:>8} {:>8} {:>8} {:>10} {:>10}",
                r.name,
                r.src_b,
                r.step0_b,
                if r.truncated { "yes" } else { "no" },
                r.lam_spans,
                r.states,
                r.src_nodes,
                r.lam_nodes,
                r.owned_states,
                r.naive_b,
                r.columnar_b,
            ),
        }
        let _ = std::io::stdout().flush();
    }
}
```

- [ ] **Step 2: Run it**

Run:
```bash
systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0 -- \
  cargo run --release -p redextape-core --features serde --example link_index_probe
```

Expected: a table. **Sanity-check against the design's §2 before continuing** — `list60`'s `step0_b` should be ~9,851 and `prog200`'s should hit the 65,536 cut with `cut = yes`. A large disagreement means Task 3 or Task 4 is wrong, not that the design's numbers were.

- [ ] **Step 3: Commit**

```bash
git add crates/redextape-core/examples/link_index_probe.rs
git commit -m "probe: link_index_probe — the three tables 5b's design was built on, re-runnable"
```

---

### Task 6: `Session::link_index` and the `linkIndex` export

The `LambdaCursor` has already moved by the time anything asks for the index — recording starts the instant a compile lands — so the `Session` must retain the **initial** term. `LambdaTerm` is `Rc`-backed and persistent, so this is one `Rc` bump.

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs` (the `Session` struct, `compile_with_caps`, and a new method)
- Modify: `crates/redextape-wasm/src/lib.rs` (the export)
- Test: `crates/redextape-wasm/tests/browser.rs`

**Interfaces:**
- Consumes: `LinkIndex::build` (Task 4).
- Produces: `Session::link_index(&self, byte_budget: usize) -> LinkIndex` (Rust) and `session.linkIndex(byteBudget)` returning an object with the columnar fields listed in Task 7.

- [ ] **Step 1: Retain the initial term**

In `crates/redextape-wasm/src/session.rs`, add a field to `pub struct Session` after `lambda`:

```rust
    /// The INITIAL lowered term, kept so `link_index` can print step 0 after the cursor has moved.
    ///
    /// ONE `Rc` BUMP, NOT A COPY. `LambdaTerm` is `Rc`-backed and persistent, so retaining the root
    /// costs a refcount. The alternative is re-lowering inside `link_index`, which would do the whole
    /// lowering again on a path the worker calls immediately after compile — and would risk answering
    /// from a lowering that is not the one the cursor is walking.
    ///
    /// `None` exactly when `lambda` is `Err`: a backend that declined produced no term.
    pub(crate) initial_lambda: Option<LambdaTerm>,
```

Add `use redextape_core::lambda::LambdaTerm;` to the file's imports if absent.

In `compile_with_caps`, where the λ leg is built, capture the term before it is consumed by the cursor. Find the existing construction (it mirrors `frame_cost_probe`'s `match lambda::lower(&core)`) and replace it with:

```rust
        let (lambda, initial_lambda) = match redextape_core::lambda::lower(&core) {
            Ok(t) => (Ok(LambdaCursor::new(&t, redextape_core::lambda::MAX_REDUCTION_STEPS)), Some(t)),
            Err(e) => (Err(e), None),
        };
```

and add `initial_lambda` to the `Session { .. }` literal.

> Read the surrounding code before editing — the existing arm may already name the cursor's cap differently. Keep whatever cap it passes; the only change is capturing `t`.

- [ ] **Step 2: Add `Session::link_index`**

Append to `impl Session` in `crates/redextape-wasm/src/session.rs`:

```rust
    /// Everything a renderer needs to link one construct across three panes, for THIS compile.
    ///
    /// BUILT ON DEMAND RATHER THAN CACHED, and called once per compile by the worker. Caching it
    /// would pay the print for every program including the ones nobody clicks into, and the caller
    /// already knows how often it wants one.
    ///
    /// INFALLIBLE. Both halves are optional and `LinkIndex::build` is total over either absence, so a
    /// declined leg yields an empty leg rather than an error — the same shape `SourceMap::build`
    /// already has. There is nothing here for a caller to handle.
    pub fn link_index(&self, byte_budget: usize) -> LinkIndex {
        let program = self.tm.as_ref().ok().map(|(p, _)| p);
        LinkIndex::build(self.initial_lambda.as_ref(), program, &self.map, byte_budget)
    }
```

Add `LinkIndex` to the `redextape_core::viewmodel::{..}` import.

- [ ] **Step 3: Add the wasm export**

In `crates/redextape-wasm/src/lib.rs`, inside `impl Session`, after `source_span`:

```rust
    /// `linkIndex(byteBudget)` -> the columnar link index for this compile.
    ///
    /// COLUMNAR, BUILT BY HAND, NOT THROUGH SERDE. `serde_wasm_bindgen` would produce arrays of
    /// objects, and the measurement says no: `list60`'s index is 552 KB that way against ~220 KB as
    /// typed arrays, and `prog200`'s is 1.9 MB against ~689 KB. The app recompiles on every 300 ms
    /// typing pause, so this crosses often. Typed arrays are also transferable, which a structured
    /// clone of 48,332 objects is not.
    ///
    /// This is 5a-ii's row-index trade — one `Int32Array` rather than 127,881 row objects — applied
    /// to all three legs at once.
    #[wasm_bindgen(js_name = linkIndex)]
    pub fn link_index(&self, byte_budget: usize) -> Result<JsValue, JsValue> {
        let index = self.0.link_index(byte_budget);

        let n_spans = index.lambda_spans.len();
        let span_start = js_sys::Uint32Array::new_with_length(n_spans as u32);
        let span_end = js_sys::Uint32Array::new_with_length(n_spans as u32);
        let span_class = js_sys::Uint8Array::new_with_length(n_spans as u32);
        for (i, (span, class)) in index.lambda_spans.iter().enumerate() {
            let i = i as u32;
            span_start.set_index(i, span.start as u32);
            span_end.set_index(i, span.end as u32);
            span_class.set_index(i, *class as u8);
        }

        let pairs = |v: &[(redextape_core::span::Span, u32)]| {
            let start = js_sys::Uint32Array::new_with_length(v.len() as u32);
            let end = js_sys::Uint32Array::new_with_length(v.len() as u32);
            let id = js_sys::Uint32Array::new_with_length(v.len() as u32);
            for (i, (span, node)) in v.iter().enumerate() {
                let i = i as u32;
                start.set_index(i, span.start as u32);
                end.set_index(i, span.end as u32);
                id.set_index(i, *node);
            }
            (start, end, id)
        };
        let (lam_start, lam_end, lam_id) = pairs(&index.lambda_nodes);
        let (src_start, src_end, src_id) = pairs(&index.source_nodes);

        let owner = js_sys::Int32Array::new_with_length(index.tm_owner.len() as u32);
        for (i, o) in index.tm_owner.iter().enumerate() {
            owner.set_index(i as u32, *o);
        }

        let out = js_sys::Object::new();
        let set = |k: &str, v: &JsValue| js_sys::Reflect::set(&out, &JsValue::from_str(k), v);
        set("lambdaText", &JsValue::from_str(&index.lambda_text))?;
        set("lambdaTruncated", &JsValue::from_bool(index.lambda_truncated))?;
        set("lambdaSpanStart", &span_start)?;
        set("lambdaSpanEnd", &span_end)?;
        set("lambdaSpanClass", &span_class)?;
        set("lambdaNodeStart", &lam_start)?;
        set("lambdaNodeEnd", &lam_end)?;
        set("lambdaNodeId", &lam_id)?;
        set("sourceNodeStart", &src_start)?;
        set("sourceNodeEnd", &src_end)?;
        set("sourceNodeId", &src_id)?;
        set("tmOwner", &owner)?;
        Ok(out.into())
    }
```

- [ ] **Step 4: Write the boundary test**

Append to `crates/redextape-wasm/tests/browser.rs`, following that file's existing idiom for reading a shape out of a real browser:

```rust
#[wasm_bindgen_test]
fn link_index_crosses_as_typed_arrays() {
    let compiled = compile("let x = 40; x + 2", "binary").expect("the sample must compile");
    let session = session_of(&compiled).expect("the sample must produce a session");
    let index = session.link_index(65_536).expect("link_index must not throw");

    let get = |k: &str| js_sys::Reflect::get(&index, &JsValue::from_str(k)).expect("field must exist");

    // A string, a bool, and ten typed arrays. If any leg came back as a plain Array, serde crept in.
    assert!(get("lambdaText").as_string().is_some_and(|s| !s.is_empty()));
    assert_eq!(get("lambdaTruncated").as_bool(), Some(false));
    for k in ["lambdaSpanStart", "lambdaSpanEnd", "lambdaNodeStart", "lambdaNodeEnd", "lambdaNodeId",
              "sourceNodeStart", "sourceNodeEnd", "sourceNodeId"] {
        assert!(get(k).is_instance_of::<js_sys::Uint32Array>(), "{k} must be a Uint32Array");
    }
    assert!(get("lambdaSpanClass").is_instance_of::<js_sys::Uint8Array>());
    assert!(get("tmOwner").is_instance_of::<js_sys::Int32Array>());

    // The three legs must be internally consistent: equal lengths per leg, and at least one owned
    // state, or the sample proves nothing about the TM leg.
    let len = |k: &str| js_sys::Reflect::get(&get(k), &JsValue::from_str("length")).ok().and_then(|v| v.as_f64()).unwrap_or(-1.0);
    assert_eq!(len("lambdaNodeStart"), len("lambdaNodeId"));
    assert_eq!(len("sourceNodeStart"), len("sourceNodeId"));
    assert!(len("sourceNodeStart") > 0.0);
    assert!(len("tmOwner") > 0.0);
}
```

> Read `crates/redextape-wasm/tests/browser.rs` first and reuse its existing `compile` / `session_of` helpers rather than inventing names. If they are spelled differently, use the file's spelling.

- [ ] **Step 5: Run the wasm browser test**

Run: `wasm-pack test --headless --chrome crates/redextape-wasm`
Expected: PASS.

> Chrome lives in `/usr/sbin` and is off `PATH`, so this can look unavailable when it is not. If `wasm-pack` reports no browser, prepend `PATH=$PATH:/usr/sbin`. `chromedriver` self-installs.

- [ ] **Step 6: Rebuild `pkg/` and commit**

Run the wasm build (see Task 2 Step 8), then:

```bash
git add crates/redextape-wasm/src/session.rs crates/redextape-wasm/src/lib.rs crates/redextape-wasm/tests/browser.rs
git commit -m "wasm: linkIndex(byteBudget) — three legs, columnar, one call per compile"
```

---

### Task 7: `link.ts` — the index and four resolvers

Pure functions over the index, no DOM. This is where the design's decision 8 lands: a click costs zero worker messages.

**Files:**
- Create: `web/src/link.ts`
- Test: `web/tests/node/link.test.ts`

**Interfaces:**
- Consumes: the wire shape from Task 6.
- Produces:
```typescript
export type LinkIndexWire = { /* the twelve fields from Task 6 */ }
export type Link = { source: Span | null; lambda: Span | null; states: number[] }
export class LinkIndex {
  constructor(wire: LinkIndexWire)
  readonly lambdaText: string
  readonly lambdaTruncated: boolean
  readonly lambdaSpans: Classified
  nodeAtSource(byteOffset: number): number | null
  nodeAtLambda(byteOffset: number): number | null
  nodeForState(stateId: number): number | null
  linkFor(node: number): Link
}
```

- [ ] **Step 1: Write the failing tests**

Create `web/tests/node/link.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { LinkIndex, type LinkIndexWire } from '../../src/link'

/**
 * A hand-built index. Source spans are deliberately NESTED — `[0,17)` contains `[4,5)` and `[12,17)` —
 * because "innermost wins" is the rule under test and disjoint spans would not exercise it.
 */
function wire(over: Partial<LinkIndexWire> = {}): LinkIndexWire {
  return {
    lambdaText: '(λx. x) y',
    lambdaTruncated: false,
    lambdaSpanStart: new Uint32Array([0, 1, 3, 5, 7, 9]),
    lambdaSpanEnd: new Uint32Array([1, 3, 4, 6, 8, 10]),
    lambdaSpanClass: new Uint8Array([5, 7, 7, 0, 5, 0]),
    lambdaNodeStart: new Uint32Array([0, 1, 6]),
    lambdaNodeEnd: new Uint32Array([10, 8, 7]),
    lambdaNodeId: new Uint32Array([100, 101, 102]),
    sourceNodeStart: new Uint32Array([0, 4, 12]),
    sourceNodeEnd: new Uint32Array([17, 5, 17]),
    sourceNodeId: new Uint32Array([100, 101, 102]),
    tmOwner: new Int32Array([-1, 100, 101, 100, -1]),
    ...over,
  }
}

describe('LinkIndex.nodeAtSource', () => {
  it('the innermost containing span wins, never an ancestor', () => {
    const ix = new LinkIndex(wire())
    expect(ix.nodeAtSource(4)).toBe(101)
    expect(ix.nodeAtSource(13)).toBe(102)
    // Inside the outermost only.
    expect(ix.nodeAtSource(2)).toBe(100)
  })

  it('a span is half-open: start is inside, end is not', () => {
    const ix = new LinkIndex(wire())
    expect(ix.nodeAtSource(12)).toBe(102)
    // `[4,5)` ends at 5, so offset 5 falls back to the enclosing `[0,17)`.
    expect(ix.nodeAtSource(5)).toBe(100)
    // 17 is past every span's end.
    expect(ix.nodeAtSource(17)).toBeNull()
  })

  it('an offset in no span, a negative offset, and an empty index all answer null', () => {
    const ix = new LinkIndex(wire())
    expect(ix.nodeAtSource(999)).toBeNull()
    expect(ix.nodeAtSource(-1)).toBeNull()
    const empty = new LinkIndex(
      wire({ sourceNodeStart: new Uint32Array(), sourceNodeEnd: new Uint32Array(), sourceNodeId: new Uint32Array() }),
    )
    expect(empty.nodeAtSource(0)).toBeNull()
  })
})

describe('LinkIndex.nodeAtLambda', () => {
  it('the innermost containing span wins', () => {
    const ix = new LinkIndex(wire())
    expect(ix.nodeAtLambda(6)).toBe(102)
    expect(ix.nodeAtLambda(2)).toBe(101)
    expect(ix.nodeAtLambda(9)).toBe(100)
  })
})

describe('LinkIndex.nodeForState', () => {
  it('resolves an owner and reports -1 as null', () => {
    const ix = new LinkIndex(wire())
    expect(ix.nodeForState(1)).toBe(100)
    expect(ix.nodeForState(2)).toBe(101)
    expect(ix.nodeForState(0)).toBeNull()
  })

  it('a state id outside the array is null, never a wrap or a throw', () => {
    const ix = new LinkIndex(wire())
    expect(ix.nodeForState(5)).toBeNull()
    expect(ix.nodeForState(-1)).toBeNull()
  })
})

describe('LinkIndex.linkFor', () => {
  it('gathers all three legs, and states are ascending', () => {
    const ix = new LinkIndex(wire())
    expect(ix.linkFor(100)).toEqual({
      source: { start: 0, end: 17 },
      lambda: { start: 0, end: 10 },
      states: [1, 3],
    })
  })

  it('reports each leg absent independently', () => {
    const ix = new LinkIndex(wire())
    // 102 owns no state.
    expect(ix.linkFor(102).states).toEqual([])
    expect(ix.linkFor(102).source).toEqual({ start: 12, end: 17 })
    // A node nobody has heard of.
    expect(ix.linkFor(999)).toEqual({ source: null, lambda: null, states: [] })
  })

  it('a node whose lambda subterm fell past the cut has a source span and no lambda span', () => {
    const ix = new LinkIndex(
      wire({
        lambdaTruncated: true,
        lambdaNodeStart: new Uint32Array([0]),
        lambdaNodeEnd: new Uint32Array([10]),
        lambdaNodeId: new Uint32Array([100]),
      }),
    )
    expect(ix.linkFor(101).lambda).toBeNull()
    expect(ix.linkFor(101).source).toEqual({ start: 4, end: 5 })
  })
})

describe('LinkIndex.lambdaSpans', () => {
  it('rehydrates class discriminants into TokenClass names', () => {
    const ix = new LinkIndex(wire())
    expect(ix.lambdaSpans[0]).toEqual([{ start: 0, end: 1 }, 'Punct'])
    expect(ix.lambdaSpans[1]).toEqual([{ start: 1, end: 3 }, 'Binder'])
    expect(ix.lambdaSpans[3]).toEqual([{ start: 5, end: 6 }, 'Ident'])
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && pnpm exec vitest run tests/link.test.ts`
Expected: FAIL — cannot resolve `../src/link`.

- [ ] **Step 3: Write `link.ts`**

Create `web/src/link.ts`:

```typescript
import { TOKEN_CLASSES } from './types'
import type { Classified, Span, TokenClass } from './types'

/**
 * `linkIndex(byteBudget)`'s wire shape: one string, one boolean, and ten typed arrays.
 *
 * COLUMNAR BECAUSE THE OBJECT FORM DOES NOT FIT. `list60` is 552 KB as arrays of objects against
 * ~220 KB this way, and `prog200` is 1.9 MB against ~689 KB — and the app rebuilds this on every
 * 300 ms typing pause. See `lib.rs`'s `linkIndex` and design §4.1.
 */
export type LinkIndexWire = {
  lambdaText: string
  lambdaTruncated: boolean
  lambdaSpanStart: Uint32Array
  lambdaSpanEnd: Uint32Array
  lambdaSpanClass: Uint8Array
  lambdaNodeStart: Uint32Array
  lambdaNodeEnd: Uint32Array
  lambdaNodeId: Uint32Array
  sourceNodeStart: Uint32Array
  sourceNodeEnd: Uint32Array
  sourceNodeId: Uint32Array
  tmOwner: Int32Array
}

/** Where one Core node shows up in each pane. Any leg may be absent, and each for its own reason. */
export type Link = { source: Span | null; lambda: Span | null; states: number[] }

/**
 * The smallest span containing `byteOffset`, as an index into the three parallel arrays, or `-1`.
 *
 * A LINEAR SCAN, DELIBERATELY, and the contrast with `state-table.ts` is the point. That file binary-
 * searches because it faces 127,881 rows; this faces at most a few hundred intervals — 403 on the
 * most adversarial program measured — and they are NESTED rather than disjoint, which makes a correct
 * binary search subtler than the scan while buying nothing measurable.
 *
 * Half-open, matching `Span`: `start` is inside and `end` is not. Ties on width cannot happen for
 * distinct nodes at distinct paths, and if two spans are identical the FIRST wins, matching the
 * "keep the first" rule `sourcemap::lambda_half` and `print_lambda_linked` both already apply.
 */
function innermost(start: Uint32Array, end: Uint32Array, byteOffset: number): number {
  if (byteOffset < 0) return -1
  let best = -1
  let bestWidth = Number.POSITIVE_INFINITY
  for (let i = 0; i < start.length; i += 1) {
    const s = start[i] as number
    const e = end[i] as number
    if (byteOffset < s || byteOffset >= e) continue
    const width = e - s
    if (width < bestWidth) {
      best = i
      bestWidth = width
    }
  }
  return best
}

/**
 * One compile's link index, and the four questions a click asks of it.
 *
 * EVERYTHING HERE IS SYNCHRONOUS AND ALLOCATION-LIGHT, which is the reason the index is shipped whole
 * rather than queried across the worker. The worker is measurably starved for seconds while recording
 * frames — 5a-ii timed a 4,679 ms gap — and recording begins the instant a compile lands, which is
 * exactly when a user reads the result and clicks.
 *
 * IT IS STEP-0 ONLY on the lambda leg. `lambdaNode*` indexes `lambdaText`, which is the INITIAL term;
 * reduction rewrites the tree those coordinates describe. A caller must gate the lambda highlight on
 * the lambda leg's play head being at step 0 — see `viewmodel.rs`'s `LinkIndex` doc.
 */
export class LinkIndex {
  readonly lambdaText: string
  readonly lambdaTruncated: boolean
  readonly lambdaSpans: Classified

  #w: LinkIndexWire
  /** `node -> its ascending state ids`, derived on first ask and cached. */
  #states = new Map<number, number[]>()

  constructor(wire: LinkIndexWire) {
    this.#w = wire
    this.lambdaText = wire.lambdaText
    this.lambdaTruncated = wire.lambdaTruncated
    const spans: Classified = []
    for (let i = 0; i < wire.lambdaSpanStart.length; i += 1) {
      // A discriminant out of range would be a Rust/TypeScript drift, which `assertTokenClasses`
      // fails at startup — so this cannot be reached in a running app. Falling back to `Ident` rather
      // than throwing keeps a renderer alive if it ever is: an unstyled span beats a blank pane.
      const cls = (TOKEN_CLASSES[wire.lambdaSpanClass[i] as number] ?? 'Ident') as TokenClass
      spans.push([{ start: wire.lambdaSpanStart[i] as number, end: wire.lambdaSpanEnd[i] as number }, cls])
    }
    this.lambdaSpans = spans
  }

  /** The innermost source construct containing `byteOffset`, or `null`. No outward walk — see `linkFor`. */
  nodeAtSource(byteOffset: number): number | null {
    const i = innermost(this.#w.sourceNodeStart, this.#w.sourceNodeEnd, byteOffset)
    return i < 0 ? null : (this.#w.sourceNodeId[i] as number)
  }

  /** The innermost lambda subterm containing `byteOffset` in `lambdaText`, or `null`. */
  nodeAtLambda(byteOffset: number): number | null {
    const i = innermost(this.#w.lambdaNodeStart, this.#w.lambdaNodeEnd, byteOffset)
    return i < 0 ? null : (this.#w.lambdaNodeId[i] as number)
  }

  /** The Core node that produced state `stateId`, or `null` for scaffolding and out-of-range ids. */
  nodeForState(stateId: number): number | null {
    if (stateId < 0 || stateId >= this.#w.tmOwner.length) return null
    const owner = this.#w.tmOwner[stateId] as number
    return owner < 0 ? null : owner
  }

  /**
   * Where `node` shows up in each pane.
   *
   * NO OUTWARD WALK WHEN A LEG IS ABSENT. `sourcemap.rs` refuses to fall back to a surrounding block
   * and so does this: the walk from a transparent `let` goes Let -> Seq -> root, so "nearest enclosing
   * linkable node" would frequently mean highlighting the whole program. Measured, the TM leg is
   * absent for 18-50% of clickable nodes, so reporting the absence is the common path and the caller
   * must say so rather than show nothing.
   */
  linkFor(node: number): Link {
    return { source: this.#spanOf('source', node), lambda: this.#spanOf('lambda', node), states: this.#statesOf(node) }
  }

  #spanOf(leg: 'source' | 'lambda', node: number): Span | null {
    const ids = leg === 'source' ? this.#w.sourceNodeId : this.#w.lambdaNodeId
    const start = leg === 'source' ? this.#w.sourceNodeStart : this.#w.lambdaNodeStart
    const end = leg === 'source' ? this.#w.sourceNodeEnd : this.#w.lambdaNodeEnd
    for (let i = 0; i < ids.length; i += 1) {
      if (ids[i] === node) return { start: start[i] as number, end: end[i] as number }
    }
    return null
  }

  /**
   * DERIVED, NOT SHIPPED. Shipping node -> states alongside state -> node would be a second
   * representation of one association with nothing checking the two came from one lowering — the
   * object `sourcemap.rs`'s module doc refuses to create, reintroduced at the boundary.
   */
  #statesOf(node: number): number[] {
    const cached = this.#states.get(node)
    if (cached !== undefined) return cached
    const out: number[] = []
    for (let s = 0; s < this.#w.tmOwner.length; s += 1) {
      if (this.#w.tmOwner[s] === node) out.push(s)
    }
    this.#states.set(node, out)
    return out
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && pnpm exec vitest run tests/link.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `cd web && pnpm run typecheck && pnpm exec biome ci --error-on-warnings`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/link.ts web/tests/node/link.test.ts
git commit -m "web: link.ts — one index, four resolvers, and a click that costs no messages"
```

---

### Task 8: Worker and protocol wiring

The index rides the existing `compiled` reply. Typed arrays are **transferable**, so they move zero-copy.

**Files:**
- Modify: `web/src/protocol.ts:145-153` (the `compiled` variant) and the `Session` structural type in `web/src/session-worker.ts:44-58`
- Modify: `web/src/session-worker.ts:340-353` (the `compiled` post)
- Modify: `web/src/main.ts` (`onReply`'s `compiled` arm)

**Interfaces:**
- Consumes: `linkIndex(byteBudget)` (Task 6), `LinkIndexWire` (Task 7).
- Produces: `RunReply`'s `compiled` variant gains `linkIndex: LinkIndexWire | null`.

- [ ] **Step 1: Extend the protocol**

In `web/src/protocol.ts`, add to the `compiled` variant (after `tapeNames`):

```typescript
      /**
       * The link index for this compile, or `null` when `compile` produced no session.
       *
       * RIDES `compiled` RATHER THAN GETTING ITS OWN MESSAGE, and eagerly rather than on first click.
       * A separate lazy fetch would spare every compile the user never clicks into — but it costs a
       * round trip into a worker measured starved for 4,679 ms during recording, and recording starts
       * the instant this message is posted. See design §4.1.
       *
       * The ten typed arrays inside are TRANSFERRED, not cloned; see the worker's `postMessage`.
       */
      linkIndex: LinkIndexWire | null
```

and extend the import on line 1:

```typescript
import type { LinkIndexWire } from './link'
```

- [ ] **Step 2: Extend the worker's `Session` type and post the index**

In `web/src/session-worker.ts`, add to the structural `Session` type (after `sourceSpan`):

```typescript
  linkIndex(byteBudget: number): LinkIndexWire
```

and add `import type { LinkIndexWire } from './link'` to its imports.

Replace the `compiled` post at `web/src/session-worker.ts:340-353` with:

```typescript
  const lambda = session.lambdaStatus()
  const tm = session.tmStatus()
  const index = session.linkIndex(LAMBDA_BYTE_BUDGET)
  ctx.postMessage(
    {
      kind: 'compiled',
      gen: req.gen,
      lambda,
      tm,
      declinedSpan: declinedSourceSpan(session, lambda),
      // GUARDED: `tmProgram` throws `TmAbsent` for a declined leg, and a thrown error inside this
      // async handler rejects it with nothing catching — no reply, and a caller that waits forever.
      // That is exactly the shape of the defect PR 3c's browser tier caught in `drive`.
      tmProgram: tm.available ? session.tmProgram() : null,
      tapeNames: tapeNames() as string[],
      linkIndex: index,
    },
    // TRANSFERRED, NOT CLONED. `prog200`'s index is ~689 KB and the app rebuilds one on every 300 ms
    // typing pause; a structured clone would copy all of it. The buffers are dead on this side the
    // moment they are posted, which is correct — `index` is built fresh per compile and never re-read
    // here. `lambdaText` is a string and is cloned as usual; strings are not transferable.
    [
      index.lambdaSpanStart.buffer,
      index.lambdaSpanEnd.buffer,
      index.lambdaSpanClass.buffer,
      index.lambdaNodeStart.buffer,
      index.lambdaNodeEnd.buffer,
      index.lambdaNodeId.buffer,
      index.sourceNodeStart.buffer,
      index.sourceNodeEnd.buffer,
      index.sourceNodeId.buffer,
      index.tmOwner.buffer,
    ],
  )
```

> `ctx.postMessage` may be typed as taking one argument. If TypeScript rejects the second, widen the local alias — `const post = ctx.postMessage.bind(ctx) as (m: RunReply, transfer?: Transferable[]) => void` — rather than dropping the transfer list.

- [ ] **Step 3: Hold the index on the main thread**

In `web/src/main.ts`, add the import:

```typescript
import { LinkIndex } from './link'
```

Declare the state beside `lam` and `tm` (after line 147):

```typescript
  /**
   * The current compile's link index, and the construct the user has linked.
   *
   * `linkable` IS NOT `index !== null`. An index is from the last compile, so the first keystroke
   * after it shifts every source span it holds; linking is disabled from that keystroke until the
   * next `compiled` lands. Resolving against a stale index is the silently-wrong answer this whole
   * slice refuses elsewhere.
   */
  let index: LinkIndex | null = null
  let linkable = false
  let link: { node: number; origin: 'source' | 'lambda' | 'tm' } | null = null
```

In `onReply`'s `compiled` arm, install it:

```typescript
      case 'compiled':
        resetLegs(reply.lambda, reply.tm)
        tmPane.setProgram(reply.tmProgram, reply.tapeNames)
        index = reply.linkIndex === null ? null : new LinkIndex(reply.linkIndex)
        linkable = index !== null
        link = null
        view.dispatch({ effects: setDecline.of(reply.declinedSpan) })
        draw()
        return
```

In the `no-session` and `worker-error` arms, add the same three lines that clear it:

```typescript
        index = null
        linkable = false
        link = null
```

- [ ] **Step 4: Typecheck**

Run: `cd web && pnpm run typecheck && pnpm exec biome ci --error-on-warnings`
Expected: clean. Nothing reads `link` yet; that is Task 9.

- [ ] **Step 5: Run the suites**

Run: `cd web && pnpm test`
Expected: PASS, unchanged behaviour.

- [ ] **Step 6: Commit**

```bash
git add web/src/protocol.ts web/src/session-worker.ts web/src/main.ts
git commit -m "web: ship the link index with compiled, transferred rather than cloned"
```

---

### Task 9: Source pane — click, keyboard, decoration, status

**Files:**
- Modify: `web/src/highlight.ts` (append a third `StateField`)
- Create: `web/src/link-status.ts`
- Modify: `web/src/main.ts` (the editor's extensions, the dispatch, the status host)
- Modify: `web/index.html` (the status mount point)
- Modify: `web/src/style.css`
- Test: `web/tests/node/link-status.test.ts`

**Interfaces:**
- Consumes: `LinkIndex` (Task 7), the `link` / `linkable` state (Task 8).
- Produces: `setLink: StateEffect<Span | null>` and `linkMark: StateField` from `highlight.ts`; `linkStatus(...): string` from `link-status.ts`; `resolveLink(offset)` wired in `main.ts`.

- [ ] **Step 1: Write the failing status test**

Create `web/tests/node/link-status.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { linkStatus } from '../../src/link-status'

describe('linkStatus', () => {
  it('says nothing when nothing is linked', () => {
    expect(linkStatus({ state: 'none' })).toBe('')
  })

  it('names the one absence that is the common case', () => {
    expect(linkStatus({ state: 'linked', tm: false, lambda: 'shown' })).toBe(
      'this construct emits no machine states',
    )
  })

  it('distinguishes the three reasons the lambda pane shows no link', () => {
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'truncated' })).toBe(
      'the λ term is truncated before this construct',
    )
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'not-step-0' })).toBe(
      'the λ link is only defined at step 0 — restart the λ pane to see it',
    )
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'declined' })).toBe(
      'this program has no λ lowering, so no construct has a λ link',
    )
  })

  it('says nothing extra when both legs resolved', () => {
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'shown' })).toBe('')
  })

  it('reports both absences together rather than picking one', () => {
    expect(linkStatus({ state: 'linked', tm: false, lambda: 'declined' })).toBe(
      'this construct emits no machine states · this program has no λ lowering, so no construct has a λ link',
    )
  })

  it('explains a stale index rather than resolving against it', () => {
    expect(linkStatus({ state: 'stale' })).toBe('linking resumes when this compiles')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm exec vitest run tests/link-status.test.ts`
Expected: FAIL — cannot resolve `../src/link-status`.

- [ ] **Step 3: Write `link-status.ts`**

Create `web/src/link-status.ts`:

```typescript
/**
 * Why a pane is not showing a link, in words.
 *
 * FIVE ABSENCES, AND THEY ARE WORDED DIFFERENTLY ON PURPOSE. Three of them mean "the λ pane shows no
 * link" and collapsing them into one message would tell a user nothing about whether to scrub, to
 * shrink the program, or to stop using a mutable capture. The TM absence is the common case, not an
 * edge: measured across the demo corpus, 18-50% of clickable constructs emit no machine states, which
 * is the transparent `let`/`seq` binders, the `Lambda`s, and the statically-resolved callee `Var`s
 * that `sourcemap.rs`'s module doc names.
 */
export type LambdaLinkState =
  /** Shown: the play head is at step 0, the term reaches this construct, and the backend lowered it. */
  | 'shown'
  /** The λ text hit its byte budget before reaching this construct. */
  | 'truncated'
  /** The λ leg's play head has moved off step 0, where the path coordinates stop meaning anything. */
  | 'not-step-0'
  /** The λ backend declined this PROGRAM, so no construct has a λ link. */
  | 'declined'

export type LinkStatus =
  | { state: 'none' }
  | { state: 'stale' }
  | { state: 'linked'; tm: boolean; lambda: LambdaLinkState }

const LAMBDA_TEXT: Record<LambdaLinkState, string> = {
  shown: '',
  truncated: 'the λ term is truncated before this construct',
  'not-step-0': 'the λ link is only defined at step 0 — restart the λ pane to see it',
  declined: 'this program has no λ lowering, so no construct has a λ link',
}

/** The `link-status` line's text. Empty means the line is blank, not that the line is absent. */
export function linkStatus(s: LinkStatus): string {
  if (s.state === 'none') return ''
  if (s.state === 'stale') return 'linking resumes when this compiles'
  const parts: string[] = []
  if (!s.tm) parts.push('this construct emits no machine states')
  const lambda = LAMBDA_TEXT[s.lambda]
  if (lambda !== '') parts.push(lambda)
  return parts.join(' · ')
}
```

- [ ] **Step 4: Run the test**

Run: `cd web && pnpm exec vitest run tests/link-status.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the source decoration**

Append to `web/src/highlight.ts`:

```typescript
/** The source range a link resolved to, or `null` to clear it. */
export const setLink = StateEffect.define<Span | null>()

/**
 * The construct a click linked, echoed in the source pane.
 *
 * THE ECHO IS WHAT MAKES THE RESOLUTION POLICY LEGIBLE. A click resolves to the innermost node whose
 * span contains it and never walks outward, so the user has to be able to see whether they hit the
 * `x` or the statement containing it. Without this mark the other two panes would light up for a
 * construct the user cannot identify.
 *
 * A THIRD FIELD RATHER THAN A BRANCH IN `declineMark`, for the reason that field states about
 * `highlighting`: these change on different clocks. A decline changes when a compile comes back; a
 * link changes on a click.
 */
export const linkMark = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setLink)) continue
      const span = e.value
      if (!span) return Decoration.none
      // Byte offsets, converted before clamping — the same contract as `setDecline` above, and the
      // same reason: the map's last entry is the document's UTF-16 length, so clamping into the map
      // already clamps into the document.
      const map = byteToIndex(tr.state.doc.toString())
      const from = byteIndexAt(map, span.start)
      const to = byteIndexAt(map, span.end)
      if (from >= to) return Decoration.none
      return Decoration.set([Decoration.mark({ class: 'linked' }).range(from, to)])
    }
    // A DOCUMENT CHANGE CLEARS THE LINK RATHER THAN MAPPING IT. `declineMark` maps, because a decline
    // is still true about the text it named until the next compile contradicts it. A link is a claim
    // about the OTHER two panes, and those are showing the previous compile's term and table — so a
    // mapped link would keep pointing at a highlight that no longer corresponds to anything.
    return tr.docChanged ? Decoration.none : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})
```

- [ ] **Step 6: Add the status mount point**

In `web/index.html`, immediately after the `#editor` element, add:

```html
      <div id="link-status" class="link-status"></div>
```

- [ ] **Step 7: Wire the click, the keyboard command, and the dispatch in `main.ts`**

Add the mount lookup beside the others (line 67-76):

```typescript
  const linkStatusHost = document.querySelector<HTMLElement>('#link-status')
```
and add `|| !linkStatusHost` to the guard's condition.

Add the imports:

```typescript
import { declineMark, highlighting, linkMark, setDecline, setLink, setSpans } from './highlight'
import { linkStatus, type LambdaLinkState } from './link-status'
```

Add the resolver and the renderer after the `draw` function (after line 178):

```typescript
  /**
   * Which λ state the link is in — the three-way distinction `link-status.ts` exists to keep apart.
   *
   * ORDERED MOST-GLOBAL FIRST. A declined backend makes the other two questions meaningless, and a
   * play head off step 0 makes truncation irrelevant, so asking in this order never reports a
   * narrower reason than the true one.
   */
  const lambdaLinkState = (node: number): LambdaLinkState => {
    if (index === null || index.lambdaText === '') return 'declined'
    if (lam.hist.currentStep !== 0) return 'not-step-0'
    return index.linkFor(node).lambda === null ? 'truncated' : 'shown'
  }

  const drawLink = () => {
    if (!linkable) {
      linkStatusHost.textContent = linkStatus({ state: 'stale' })
      return
    }
    if (link === null || index === null) {
      linkStatusHost.textContent = linkStatus({ state: 'none' })
      return
    }
    const l = index.linkFor(link.node)
    linkStatusHost.textContent = linkStatus({
      state: 'linked',
      tm: l.states.length > 0,
      lambda: lambdaLinkState(link.node),
    })
  }

  /**
   * Resolve a link and paint all three panes.
   *
   * `origin` DRIVES SCROLLING ONLY. A scroll-into-view triggered by the pane the user is already
   * looking at moves the thing under their cursor, so the table scrolls for a source click and not
   * for its own.
   */
  const setLinkTo = (node: number | null, origin: 'source' | 'lambda' | 'tm') => {
    link = node === null ? null : { node, origin }
    const span = node === null || index === null ? null : index.linkFor(node).source
    view.dispatch({ effects: setLink.of(span) })
    drawLink()
    draw()
  }

  /** Link at a byte offset into the source document, or clear if nothing contains it. */
  const linkAtSourceOffset = (byteOffset: number) => {
    if (!linkable || index === null) return
    setLinkTo(index.nodeAtSource(byteOffset), 'source')
  }
```

Add the editor extensions inside `EditorState.create`'s `extensions` array, after `declineMark`:

```typescript
        linkMark,
        // AN EXPLICIT CLICK, NOT A CARET MOVE. Clicking an editor already means "place the caret", and
        // linking on every arrow key would fire constantly while navigating — and, worse, would have
        // to be airtight about the stale-index rule on every keystroke rather than only on clicks.
        // `mouseup` rather than `mousedown`, so a drag that selects text does not also link.
        EditorView.domEventHandlers({
          mouseup: (event, v) => {
            const pos = v.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos === null) return false
            // CodeMirror positions are UTF-16 indices; the index speaks bytes. `Buffer` is not
            // available in a browser, so the conversion goes through the same `TextEncoder` the
            // byte/UTF-16 split already forces everywhere else in this app.
            linkAtSourceOffset(new TextEncoder().encode(v.state.doc.sliceString(0, pos)).length)
            return false
          },
        }),
        // The keyboard route to the same thing. `Mod-'` is unbound in `defaultKeymap` and in
        // `historyKeymap`; verify that before changing it. Reachability without a mouse is the whole
        // point — the roadmap defers the rest of accessibility to one pass at the end of Plan 5, but a
        // mouse-only primary interaction would have to be retrofitted by that pass rather than
        // adjusted.
        keymap.of([
          {
            key: "Mod-'",
            run: (v) => {
              const pos = v.state.selection.main.head
              linkAtSourceOffset(new TextEncoder().encode(v.state.doc.sliceString(0, pos)).length)
              return true
            },
          },
        ]),
```

In the `updateListener`, clear the link on a document change (inside the existing `if (!u.docChanged) return` block, after `setSpans`):

```typescript
          // STALE FROM THIS KEYSTROKE UNTIL THE NEXT COMPILE. `linkMark` clears its own decoration on
          // `docChanged`; this clears the state behind it and the status line.
          linkable = false
          link = null
          drawLink()
```

Call `drawLink()` beside the initial `draw()` at the bottom of `main` (line 341), and add `drawLink()` to `onReply`'s `compiled`, `no-session` and `worker-error` arms after their `draw()` calls.

- [ ] **Step 8: Style it**

Append to `web/src/style.css`:

```css
/* The construct a click linked, echoed in the source pane. Distinct from `.decline`, which is a
   backend refusal, and from the token colours, which say what a thing IS rather than what is selected. */
.cm-editor .linked {
  background: var(--link-bg);
  box-shadow: inset 0 -2px 0 var(--link-edge);
}

.link-status {
  min-height: 1.2em;
  padding: 0.2em 0.4em;
  font-size: 0.85em;
  color: var(--muted);
}
```

Add `--link-bg` and `--link-edge` to **both** the light and dark blocks of the palette in `style.css`. Read the existing custom properties first and pick values consistent with them — PR 5a-ii lost time to two properties (`--mono`, `--accent-soft`) that were referenced and never defined.

- [ ] **Step 9: Run everything**

Run: `cd web && pnpm test && pnpm run typecheck && pnpm exec biome ci --error-on-warnings`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add web/src/highlight.ts web/src/link-status.ts web/src/main.ts web/src/style.css web/index.html web/tests/node/link-status.test.ts
git commit -m "web: click a source construct, and the pane says which one it resolved to"
```

---

### Task 10: State table — row click and `is-linked`

**Files:**
- Modify: `web/src/state-table.ts` (a second highlight function)
- Modify: `web/src/tm-pane.ts` (row click, `is-linked`, scroll-on-origin)
- Modify: `web/src/main.ts` (wire the pane's new event)
- Modify: `web/src/style.css`
- Test: `web/tests/node/state-table.test.ts`

**Interfaces:**
- Consumes: `LinkIndex.nodeForState`, `LinkIndex.linkFor` (Task 7); `setLinkTo` (Task 9).
- Produces: `linkedRows(index, states): Set<number>` in `state-table.ts`; `TmPane.setLink(states: number[], scrollTo: boolean)`; `PaneEvents` gains `linkState?: (stateId: number) => void`.

- [ ] **Step 1: Write the failing test**

Append to `web/tests/node/state-table.test.ts`, which ALREADY EXISTS — read it first and reuse its imports and fixtures rather than redeclaring them:

```typescript
import { describe, expect, it } from 'vitest'
import { linkedRows, StateIndex } from '../../src/state-table'
import type { TmProgram } from '../../src/types'

const program: TmProgram = {
  states: [
    { name: 'a', accept: false, rules: [{ read: [null], write: [null], moves: ['R'], next: 1 }] },
    { name: 'b', accept: false, rules: [] },
    { name: 'c', accept: true, rules: [{ read: [null], write: [null], moves: ['S'], next: 2 }] },
  ],
  alphabet: ['0', '1'],
  tapes: 1,
  width: 4,
  start: 0,
}

describe('linkedRows', () => {
  it('covers each linked state HEADER and every one of its rule rows', () => {
    // Rows: 0 = a, 1 = a's rule, 2 = b, 3 = c, 4 = c's rule.
    const ix = new StateIndex(program)
    expect([...linkedRows(ix, [0])].sort((x, y) => x - y)).toEqual([0, 1])
    expect([...linkedRows(ix, [1])].sort((x, y) => x - y)).toEqual([2])
    expect([...linkedRows(ix, [0, 2])].sort((x, y) => x - y)).toEqual([0, 1, 3, 4])
  })

  it('is empty for no states, and ignores a state id past the end', () => {
    const ix = new StateIndex(program)
    expect(linkedRows(ix, []).size).toBe(0)
    expect(linkedRows(ix, [99]).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm exec vitest run tests/state-table.test.ts`
Expected: FAIL — `linkedRows` is not exported.

- [ ] **Step 3: Add `linkedRows`**

Append to `web/src/state-table.ts`:

```typescript
/**
 * Every row a link highlights: each linked state's header row and all of its rule rows.
 *
 * A SET RATHER THAN A RANGE, because a node's state block is not contiguous — `node_to_tm` collects
 * whichever states a lowering emitted for one construct, and a lowering interleaves constructs. The
 * set is built once per link, not per draw: `list60` is 35,715 states, so a per-row scan over the
 * block would be O(visible x block) on every scroll.
 *
 * A STATE ID PAST THE END CONTRIBUTES NOTHING rather than a clamped row. `StateIndex.rowOfState`
 * clamps to 0, which would silently light the first state — the same no-fallback rule `tm_owner`
 * follows one layer in.
 */
export function linkedRows(index: StateIndex, states: number[]): Set<number> {
  const out = new Set<number>()
  for (const s of states) {
    const start = index.rowOfState(s)
    const header = index.row(start)
    if (header === null || header.kind !== 'state' || header.id !== s) continue
    out.add(start)
    for (let i = start + 1; ; i += 1) {
      const row = index.row(i)
      if (row === null || row.kind !== 'rule' || row.stateId !== s) break
      out.add(i)
    }
  }
  return out
}
```

- [ ] **Step 4: Run the test**

Run: `cd web && pnpm exec vitest run tests/state-table.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the pane**

In `web/src/tm-pane.ts`:

Add the field beside `#follow`:

```typescript
  #linked: Set<number> = new Set()
```

Import `linkedRows` from `./state-table`.

Add the method after `setProgram`:

```typescript
  /**
   * Highlight a link's state block, optionally scrolling to it.
   *
   * `scrollTo` IS FALSE WHEN THE CLICK CAME FROM THIS TABLE. Scrolling a list the user just clicked
   * in moves the row out from under their cursor; the caller knows where the gesture came from and
   * this does not have to guess.
   *
   * THE SCROLL DOES NOT TOUCH `Follow`. Following is about the machine's current state, and a link is
   * about a construct — reusing `Follow` here would make a link click silently reattach a table the
   * user had deliberately detached, or detach one they had not.
   */
  setLink(states: number[], scrollTo: boolean): void {
    this.#linked = this.#index === null ? new Set() : linkedRows(this.#index, states)
    if (scrollTo && this.#index !== null && this.#open) {
      const first = [...this.#linked].sort((a, b) => a - b)[0]
      if (first !== undefined) {
        const centred = first * ROW_HEIGHT - Math.floor(this.#tableHost.clientHeight / 2)
        const max = Math.max(0, this.#index.rowCount * ROW_HEIGHT - this.#tableHost.clientHeight)
        const top = Math.max(0, Math.min(centred, max))
        // Recorded so `Follow` does not read the echo of this write as the user taking control — the
        // same reason `setProgram` records one before its own write.
        this.#follow.onProgrammaticScroll(top)
        this.#tableHost.scrollTop = top
      }
    }
    this.#drawTable()
  }
```

In `setProgram`, clear it — a new compile invalidates every state id:

```typescript
    this.#linked = new Set()
```

In `#drawTable`'s row loop, after the `is-firing` line:

```typescript
      if (this.#linked.has(i)) el.classList.add('is-linked')
```

Add the row click, in the constructor after the `#tableHost` scroll listener:

```typescript
    // CLICK A ROW, LIGHT ITS SOURCE. The table is 127,881 rows for `list60` and nothing in it says
    // what any row is FOR; this is the answer to that. Delegated from the container rather than bound
    // per row, because rows are recreated on every draw.
    this.#rows.addEventListener('click', (event) => {
      if (this.#index === null) return
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const el = target.closest('.state-row')
      if (!(el instanceof HTMLElement)) return
      const i = [...this.#rows.children].indexOf(el)
      if (i < 0) return
      const row = this.#index.row(this.#firstDrawn + i)
      if (row === null) return
      on.linkState?.(row.kind === 'state' ? row.id : row.stateId)
    })
```

Add `#firstDrawn` as a field initialised to `0`, and set it in `#drawTable` right after `visibleWindow` is computed:

```typescript
    this.#firstDrawn = w.firstIndex
```

> The rows array is virtualized and `translateY`-offset, so a child's DOM index is `firstIndex + i`, not the row number. Getting this wrong silently links the wrong construct — verify it in Task 12's browser test rather than by eye.

In `web/src/pane-chrome.ts`, add to `PaneEvents`:

```typescript
  /** A state row was clicked. Absent on panes that have no table. */
  linkState?: (stateId: number) => void
```

- [ ] **Step 6: Wire `main.ts`**

In `events(...)`, add `linkState` for the TM leg only. Replace the `events` helper's return with an object that includes it, then in `setLinkTo` push the state block to the pane:

```typescript
  const events = <T>(leg: LegState<T>, which: Leg) => ({
    // ...existing back / forward / play / restart / extend, unchanged...
    linkState:
      which === 'tm'
        ? (stateId: number) => {
            if (!linkable || index === null) return
            setLinkTo(index.nodeForState(stateId), 'tm')
          }
        : undefined,
  })
```

and extend `setLinkTo`:

```typescript
  const setLinkTo = (node: number | null, origin: 'source' | 'lambda' | 'tm') => {
    link = node === null ? null : { node, origin }
    const l = node === null || index === null ? null : index.linkFor(node)
    view.dispatch({ effects: setLink.of(l?.source ?? null) })
    tmPane.setLink(l?.states ?? [], origin !== 'tm')
    drawLink()
    draw()
  }
```

- [ ] **Step 7: Style it**

Append to `web/src/style.css`:

```css
/* A linked state block. Layered UNDER `.is-current` and `.is-firing`, which are about the run rather
   than about the selection — a row can legitimately be both. */
.state-row.is-linked {
  background: var(--link-bg);
}

.state-row {
  cursor: pointer;
}
```

- [ ] **Step 8: Run everything**

Run: `cd web && pnpm test && pnpm run typecheck && pnpm exec biome ci --error-on-warnings`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/state-table.ts web/src/tm-pane.ts web/src/pane-chrome.ts web/src/main.ts web/src/style.css web/tests/node/state-table.test.ts
git commit -m "web: the delta table answers what a row is for, in both directions"
```

---

### Task 11: λ pane — the window view, and λ→source

**Files:**
- Create: `web/src/lambda-window.ts`
- Modify: `web/src/spans.ts` (append `indexToByte`)
- Modify: `web/src/lambda-pane.ts`
- Modify: `web/src/pane-chrome.ts` (`PaneEvents.linkLambda`)
- Modify: `web/src/main.ts`
- Modify: `web/src/style.css`
- Test: `web/tests/node/lambda-window.test.ts`, `web/tests/node/spans.test.ts`, `web/tests/browser/app.test.ts`

**Interfaces:**
- Consumes: `LinkIndex.lambdaText`, `.lambdaSpans`, `.nodeAtLambda` (Task 7); `setLinkTo` (Task 9).
- Produces: `LINK_CONTEXT`; `lambdaWindow(text, spans, target, context): LambdaWindow` where `LambdaWindow = { text, spans, target, origin, clippedHead, clippedTail }`; `indexToByte(text): Uint32Array`; `LambdaPane.renderLink(win: LambdaWindow | null)`; `PaneEvents.linkLambda?(byteOffset)`.

**This task closes the third link direction.** Source→both is Task 9, TM row→source is Task 10, and λ token→source is here — it needs `origin`, `indexToByte` and a `data-at` per token, which is why it lands with the window rather than with the resolver.

- [ ] **Step 1: Write the failing test**

Create `web/tests/node/lambda-window.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { lambdaWindow } from '../../src/lambda-window'
import type { Classified } from '../../src/types'

// `0123456789abcdefghij` — 20 bytes, one span per 5.
const TEXT = '0123456789abcdefghij'
const SPANS: Classified = [
  [{ start: 0, end: 5 }, 'Ident'],
  [{ start: 5, end: 10 }, 'Nat'],
  [{ start: 10, end: 15 }, 'Ident'],
  [{ start: 15, end: 20 }, 'Nat'],
]

describe('lambdaWindow', () => {
  it('shows the whole text when the context covers it', () => {
    const w = lambdaWindow(TEXT, SPANS, { start: 5, end: 10 }, 100)
    expect(w.text).toBe(TEXT)
    expect(w.target).toEqual({ start: 5, end: 10 })
    expect(w.clippedHead).toBe(false)
    expect(w.clippedTail).toBe(false)
  })

  it('clips both sides and reports it, with the target rebased into window coordinates', () => {
    const w = lambdaWindow(TEXT, SPANS, { start: 10, end: 15 }, 2)
    // Context 2 wants [8,17); both edges snap OUTWARD to token boundaries, giving [5,20).
    expect(w.text).toBe('56789abcdefghij')
    expect(w.target).toEqual({ start: 5, end: 10 })
    expect(w.origin).toBe(5)
    expect(w.clippedHead).toBe(true)
    expect(w.clippedTail).toBe(false)
  })

  it('origin is what lets a click inside the window resolve against the whole-text index', () => {
    const w = lambdaWindow(TEXT, SPANS, { start: 10, end: 15 }, 2)
    // A token at window byte 7 is whole-text byte 12 — which is what `nodeAtLambda` must be asked.
    expect(w.origin + 7).toBe(12)
    expect(lambdaWindow(TEXT, SPANS, { start: 5, end: 10 }, 100).origin).toBe(0)
  })

  it('never hides the start of the target — it clips the TAIL when the target is huge', () => {
    // The target is the whole text and the context is tiny. The window must still begin at the
    // target's start; a window that opened in the middle of the clicked construct would lie about
    // what was clicked.
    const w = lambdaWindow(TEXT, SPANS, { start: 0, end: 20 }, 0)
    expect(w.target.start).toBe(0)
    expect(w.text.startsWith('0')).toBe(true)
  })

  it('rebases every overlapping span into window coordinates and drops the rest', () => {
    const w = lambdaWindow(TEXT, SPANS, { start: 10, end: 15 }, 2)
    expect(w.spans).toEqual([
      [{ start: 0, end: 5 }, 'Nat'],
      [{ start: 5, end: 10 }, 'Ident'],
      [{ start: 10, end: 15 }, 'Nat'],
    ])
  })

  it('an empty text yields an empty window rather than throwing', () => {
    const w = lambdaWindow('', [], { start: 0, end: 0 }, 10)
    expect(w.text).toBe('')
    expect(w.spans).toEqual([])
    expect(w.clippedHead).toBe(false)
    expect(w.clippedTail).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm exec vitest run tests/lambda-window.test.ts`
Expected: FAIL — cannot resolve `../src/lambda-window`.

- [ ] **Step 3: Write `lambda-window.ts`**

Create `web/src/lambda-window.ts`:

```typescript
import type { Classified, Span } from './types'

/**
 * Characters of context on each side of a linked construct.
 *
 * A LEGIBILITY NUMBER, NOT A COST ONE, and the difference is why this carries no measurement.
 * `FRAME_BYTES` and the tape radius were measured because they buy speed or memory; this buys only
 * readability, and the corpus it has to read well on runs from a 107-byte term to a 65,536-byte one.
 * Eye-checked at both ends rather than probed.
 */
export const LINK_CONTEXT = 240

export type LambdaWindow = {
  text: string
  spans: Classified
  /** The target's span, rebased into `text`'s coordinates. */
  target: Span
  /**
   * `text`'s byte offset in the FULL `lambdaText`, so a click inside the window can be resolved
   * against the index — which speaks whole-text coordinates and knows nothing about this slice.
   */
  origin: number
  clippedHead: boolean
  clippedTail: boolean
}

/**
 * A readable slice of the step-0 λ term around a linked construct.
 *
 * THE WINDOW ALWAYS BEGINS AT THE TARGET'S START (minus context) AND CLIPS THE TAIL. A target subterm
 * can be most of the term — the root node's span is the whole thing — and a window that opened in the
 * middle of the clicked construct would lie about what was clicked. Clipping the far end is the only
 * direction that cannot mislead.
 *
 * EDGES SNAP OUTWARD TO TOKEN BOUNDARIES, so no name is cut in half. Snapping outward rather than
 * inward means the window can exceed `context` by up to one token on each side, which is the right
 * trade: a fragment of an identifier reads as a different identifier.
 *
 * OFFSETS ARE BYTES throughout, matching `Span` everywhere else. The caller converts to UTF-16 when
 * it renders, through `spans.ts` — this function does no slicing of its own that could split a
 * character, because both edges land on token boundaries and the printer never emits a token that
 * starts mid-character.
 */
export function lambdaWindow(text: string, spans: Classified, target: Span, context: number): LambdaWindow {
  if (text === '') {
    return { text: '', spans: [], target: { start: 0, end: 0 }, origin: 0, clippedHead: false, clippedTail: false }
  }
  const wantStart = Math.max(0, target.start - context)
  const wantEnd = Math.min(text.length, Math.max(target.start, target.end) + context)

  let start = wantStart
  let end = wantEnd
  for (const [s] of spans) {
    if (s.start < wantStart && s.end > wantStart) start = Math.min(start, s.start)
    if (s.start < wantEnd && s.end > wantEnd) end = Math.max(end, s.end)
  }
  start = Math.max(0, Math.min(start, target.start))
  end = Math.min(text.length, Math.max(end, Math.min(target.end, start + 1)))

  const out: Classified = []
  for (const [s, cls] of spans) {
    if (s.end <= start || s.start >= end) continue
    out.push([{ start: Math.max(s.start, start) - start, end: Math.min(s.end, end) - start }, cls])
  }
  return {
    text: text.slice(start, end),
    spans: out,
    target: { start: target.start - start, end: Math.min(target.end, end) - start },
    origin: start,
    clippedHead: start > 0,
    clippedTail: end < text.length,
  }
}
```

- [ ] **Step 4: Run the test**

Run: `cd web && pnpm exec vitest run tests/lambda-window.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5a: Add the inverse offset map**

Append to `web/src/spans.ts`:

```typescript
/**
 * The inverse of `byteToIndex`: `map[i]` is the BYTE offset at UTF-16 index `i`, for every `i` in
 * `0..=text.length`.
 *
 * NEEDED BY THE λ→SOURCE DIRECTION AND NOTHING ELSE SO FAR. A click gives a DOM position, which is a
 * UTF-16 index; `LinkIndex.nodeAtLambda` speaks bytes, like every `Span` in this app. Encoding a
 * prefix per lookup would be O(n²) over a window that can be tens of kilobytes, so the map is built
 * once and read many times — the same trade `byteToIndex` already makes in the other direction.
 */
export function indexToByte(text: string): Uint32Array {
  const map: number[] = []
  let byte = 0
  for (const ch of text) {
    const codePoint = ch.codePointAt(0) ?? 0
    const byteLen = codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4
    // `ch.length` is 1 for a BMP character and 2 for a surrogate pair. Both units of the pair map to
    // the character's own starting byte, matching `byteToIndex`'s treatment of a mid-character byte.
    for (let i = 0; i < ch.length; i += 1) map.push(byte)
    byte += byteLen
  }
  map.push(byte)
  return new Uint32Array(map)
}
```

Append to `web/tests/node/spans.test.ts`, which ALREADY EXISTS — read it first and extend its import line rather than adding a second one:

```typescript
import { describe, expect, it } from 'vitest'
import { byteToIndex, indexToByte } from '../../src/spans'

describe('indexToByte', () => {
  it('round-trips with byteToIndex on a term with binders', () => {
    // `λ` is 2 bytes and 1 UTF-16 unit, which is the case that makes this non-trivial.
    const text = '(λx. λy. x y) z'
    const fwd = byteToIndex(text)
    const back = indexToByte(text)
    for (let i = 0; i <= text.length; i += 1) {
      expect(fwd[back[i] as number]).toBe(i)
    }
    expect(back[back.length - 1]).toBe(new TextEncoder().encode(text).length)
  })

  it('maps both units of a surrogate pair to the character start', () => {
    const text = 'a\u{1F600}b'
    const back = indexToByte(text)
    expect([...back]).toEqual([0, 1, 1, 5, 6])
  })
})
```

Run: `cd web && pnpm exec vitest run tests/spans.test.ts`
Expected: PASS.

- [ ] **Step 5: Render it in the λ pane**

In `web/src/lambda-pane.ts`, add a field and a method, and gate `render` on it:

```typescript
  #link: LambdaWindow | null = null

  /**
   * Show a window onto the step-0 term around a linked construct, or `null` to go back to the frame.
   *
   * THE LINK VIEW REPLACES THE FRAME VIEW RATHER THAN OVERLAYING IT, because they are two different
   * texts: a frame is printed at `FRAME_BYTES` (512) and this at `LAMBDA_BYTE_BUDGET` (65,536). A
   * highlight computed against one and drawn on the other would land on arbitrary characters.
   */
  renderLink(win: LambdaWindow | null): void {
    this.#link = win
    this.#redraw()
  }
```

Refactor `render`'s body into `#redraw()`, keeping the current frame in a `#frame` field, and have `#redraw` branch:

```typescript
  #redraw(): void {
    if (this.#link !== null) {
      const w = this.#link
      const ranges = decorationRanges(w.spans, w.text)
      const map = byteToIndex(w.text)
      // The INVERSE map, built once per render rather than per token. Encoding `text.slice(0, i)` per
      // token would be O(n^2) over a window that can be tens of kilobytes.
      const back = indexToByte(w.text)
      const targetFrom = byteIndexAt(map, w.target.start)
      const targetTo = byteIndexAt(map, w.target.end)
      const out: Node[] = []
      if (w.clippedHead) out.push(ellipsis())
      let at = 0
      for (const r of ranges) {
        if (r.from < at) continue
        if (r.from > at) out.push(document.createTextNode(w.text.slice(at, r.from)))
        const el = document.createElement('span')
        // FLAT, NOT NESTED. Every token inside the target range also carries `is-linked`; a wrapper
        // element would have to handle spans straddling the target's edges, and there is no need —
        // the edges are token boundaries by construction (see `lambdaWindow`).
        el.className = r.from >= targetFrom && r.to <= targetTo ? `${r.className} is-linked` : r.className
        // THE THIRD DIRECTION'S ONLY REQUIREMENT. `nodeAtLambda` speaks BYTE offsets into the full
        // `lambdaText`, and a click gives a DOM element — so each token carries the byte offset it
        // began at, in whole-text coordinates. Computed here rather than derived from the DOM at click
        // time, because the window is a slice and the offsets are not the ones on screen.
        el.dataset.at = String(w.origin + (back[r.from] ?? 0))
        el.textContent = w.text.slice(r.from, r.to)
        out.push(el)
        at = r.to
      }
      if (at < w.text.length) out.push(document.createTextNode(w.text.slice(at)))
      if (w.clippedTail) out.push(ellipsis())
      this.#text.replaceChildren(...out)
      return
    }
    // ...the existing frame-rendering body, unchanged...
  }
```

with a module-level helper:

```typescript
function ellipsis(): HTMLElement {
  const el = document.createElement('span')
  el.className = 'truncated'
  el.textContent = ' … '
  return el
}
```

Add the imports: `byteIndexAt`, `byteToIndex`, `indexToByte` from `./spans`, and `type LambdaWindow` from `./lambda-window`.

- [ ] **Step 5b: The third direction — click the λ window, light the source**

In `web/src/lambda-pane.ts`'s constructor, after `host.replaceChildren(...)`:

```typescript
    // λ TEXT -> SOURCE, the third direction. Delegated from the `<pre>` rather than bound per token,
    // because tokens are recreated on every draw. `data-at` carries the token's byte offset in the
    // FULL `lambdaText` (see `#redraw`), so the handler needs no knowledge of the window's slice.
    //
    // ONLY THE WINDOW IS CLICKABLE. A frame view has no `data-at` on anything — its text is printed at
    // `FRAME_BYTES` from a term the index's coordinates do not describe — so a click there finds no
    // attribute and does nothing, which is the correct answer rather than a guard.
    this.#text.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const at = target.dataset.at
      if (at === undefined) return
      const byteOffset = Number.parseInt(at, 10)
      if (Number.isNaN(byteOffset)) return
      on.linkLambda?.(byteOffset)
    })
```

In `web/src/pane-chrome.ts`, add to `PaneEvents`:

```typescript
  /** A token in the λ link window was clicked, at this byte offset into the full `lambdaText`. */
  linkLambda?: (byteOffset: number) => void
```

- [ ] **Step 6: Wire `main.ts`**

Extend `setLinkTo` to drive the λ pane, and clear it when the play head moves:

```typescript
  /**
   * The λ pane's link view, or `null` when there is nothing to show.
   *
   * GATED ON `lam.hist.currentStep === 0`, and ONLY on the λ leg's own head. `main.ts` holds two
   * independent histories with two heads; the TM leg runs at wildly different step counts (the `map`
   * demo is 344,999 δ-steps against a few hundred β-steps), so gating on a shared condition would make
   * the λ link vanish almost immediately for reasons that have nothing to do with λ.
   */
  const lambdaLinkWindow = (): LambdaWindow | null => {
    if (link === null || index === null || !linkable) return null
    if (lam.hist.currentStep !== 0) return null
    const span = index.linkFor(link.node).lambda
    if (span === null) return null
    return lambdaWindow(index.lambdaText, index.lambdaSpans, span, LINK_CONTEXT)
  }
```

Call `lambdaPane.renderLink(lambdaLinkWindow())` at the end of `draw()` — **not** in `setLinkTo` alone, because scrubbing the λ history must withdraw the window without a click.

Add `linkLambda` to the `events` helper, for the λ leg only, beside Task 10's `linkState`:

```typescript
    linkLambda:
      which === 'lambda'
        ? (byteOffset: number) => {
            if (!linkable || index === null) return
            setLinkTo(index.nodeAtLambda(byteOffset), 'lambda')
          }
        : undefined,
```

- [ ] **Step 6b: Test the third direction**

Append to `web/tests/browser/app.test.ts`:

```typescript
  it('clicking a token in the lambda window lights its source construct', async () => {
    await settled(view, 'let x = 40; x + 2')
    linkAt(view, 12)
    await until(() => document.querySelector('.term [data-at]') !== null)

    const first = linkedSource()
    // Pick a token that is NOT the current target, so the assertion is that the click moved the link
    // rather than that it left it alone.
    const tokens = [...document.querySelectorAll<HTMLElement>('.term [data-at]')].filter(
      (el) => !el.classList.contains('is-linked'),
    )
    expect(tokens.length, 'the window must show more than the target alone').toBeGreaterThan(0)
    tokens[0]?.click()
    await until(() => linkedSource() !== first)

    expect(linkedSource()).not.toBe('')
    expect(view.state.doc.toString()).toContain(linkedSource())
  })
```

- [ ] **Step 7: Style it**

Append to `web/src/style.css`:

```css
/* The linked subterm inside the λ window. Layered over the token colour rather than replacing it —
   the class is added alongside `.tok-*`, so the text keeps its syntax colour and gains a ground. */
.term .is-linked {
  background: var(--link-bg);
  box-shadow: inset 0 -2px 0 var(--link-edge);
}
```

- [ ] **Step 8: Run everything**

Run: `cd web && pnpm test && pnpm run typecheck && pnpm exec biome ci --error-on-warnings`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/lambda-window.ts web/src/lambda-pane.ts web/src/pane-chrome.ts web/src/spans.ts web/src/main.ts web/src/style.css web/tests/node/lambda-window.test.ts web/tests/node/spans.test.ts web/tests/browser/app.test.ts
git commit -m "web: the lambda pane opens a window on the construct you clicked, and answers back"
```

---

### Task 12: Browser tier

Written **after** Task 1, against a fixed `settled()`.

**Files:**
- Modify: `web/tests/browser/app.test.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the browser tests**

Append to `web/tests/browser/app.test.ts`, inside the existing `describe`:

```typescript
  const linkStatusText = () => document.querySelector<HTMLElement>('#link-status')?.textContent ?? ''
  const linkedSource = () => document.querySelector('.cm-editor .linked')?.textContent ?? ''
  const linkedRowCount = () => document.querySelectorAll('.state-row.is-linked').length

  /** Link at a byte offset by driving the keyboard route, which needs no coordinates. */
  function linkAt(v: EditorView, index: number): void {
    v.dispatch({ selection: { anchor: index } })
    const el = v.contentDOM
    el.dispatchEvent(new KeyboardEvent('keydown', { key: "'", ctrlKey: true, bubbles: true }))
  }

  /**
   * Yield to the event loop once.
   *
   * NOT `until(() => true)`, WHICH WAITS FOR NOTHING. `until` evaluates its predicate before its first
   * sleep, so a predicate that is already true returns synchronously — an `await` on it is a no-op
   * that reads like a wait. Every place below that needs the DOM to settle after a synchronous click
   * uses this, and every place that needs a specific condition uses `until` with that condition.
   */
  const tick = () => new Promise((r) => setTimeout(r, 0))

  it('links a source construct to its lambda span and its state block', async () => {
    await settled(view, 'let x = 40; x + 2')
    linkAt(view, 12)
    await until(() => linkedSource() !== '')

    // The source echo is what makes the resolution legible: the innermost construct containing
    // offset 12 wins, with no outward walk.
    expect(linkedSource().length).toBeGreaterThan(0)
    expect(view.state.doc.toString()).toContain(linkedSource())

    // The lambda pane shows a window with the target marked, because the play head is at step 0.
    await until(() => document.querySelector('.term .is-linked') !== null)
    expect(document.querySelector('.term .is-linked')?.textContent ?? '').not.toBe('')
  })

  it('clicking a state row lights the source construct that produced it', async () => {
    await settled(view, 'let x = 40; x + 2')
    await until(() => document.querySelectorAll('.state-row').length > 0)

    // FIND A ROW WHOSE STATE HAS AN OWNER, because most do not — measured, 50-82% of clickable
    // constructs own states but a large majority of STATES are scaffolding with no owner at all. A
    // test that clicked one arbitrary row would fail for the wrong reason most of the time.
    const rows = [...document.querySelectorAll<HTMLElement>('.state-row')]
    expect(rows.length, 'the table must be rendered before this can prove anything').toBeGreaterThan(0)
    let lit = ''
    let clicked = 0
    for (const row of rows) {
      row.click()
      await tick()
      clicked += 1
      lit = linkedSource()
      if (lit !== '') break
    }
    expect(lit, `no state row among ${clicked} resolved to a source construct`).not.toBe('')
    // The echo must be real source text, not a stale mark from the earlier link in this file.
    expect(view.state.doc.toString()).toContain(lit)
    // And the block it lit must be the block of the row that resolved — not left over from a
    // previous click in the loop, which would pass the assertion above just as well.
    expect(linkedRowCount()).toBeGreaterThan(0)
  })

  it('reports the absence when a construct emits no machine states', async () => {
    await settled(view, 'let x = 40; x + 2')
    // Offset 0 is the `let` keyword — a transparent binder, which `lower_asm` emits no instruction
    // for. Measured across the corpus, 18-50% of clickable constructs are in this class, so this is
    // the common path rather than an edge case.
    linkAt(view, 0)
    await until(() => linkStatusText() !== '')
    expect(linkStatusText()).toContain('no machine states')
    expect(linkedRowCount()).toBe(0)
  })

  it('withdraws the lambda link when the play head leaves step 0, and keeps the source echo', async () => {
    await settled(view, 'let x = 40; x + 2')
    linkAt(view, 12)
    await until(() => document.querySelector('.term .is-linked') !== null)

    // Step the lambda leg forward once.
    const forward = document.querySelector<HTMLButtonElement>('#lambda .step-forward')
    expect(forward, 'the lambda pane must have a forward control').not.toBeNull()
    forward?.click()
    await until(() => document.querySelector('.term .is-linked') === null)

    expect(linkStatusText()).toContain('step 0')
    // The source echo survives: only the lambda leg's coordinates went stale.
    expect(linkedSource()).not.toBe('')
  })

  it('clears the link on an edit and says linking will resume', async () => {
    await settled(view, 'let x = 40; x + 2')
    linkAt(view, 12)
    await until(() => linkedSource() !== '')

    view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } })
    expect(linkedSource()).toBe('')
    expect(linkStatusText()).toContain('resumes')
  })

  it('a linked row is the row it claims to be, through the virtualized offset', async () => {
    // THE BUG THIS EXISTS FOR: rows are recreated per draw and `translateY`-offset, so a child's DOM
    // index is `firstIndex + i`, not the row number. Off by the scroll offset, the table lights a
    // plausible-looking block belonging to a different construct.
    await settled(view, 'let x = 40; x + 2')
    const table = document.querySelector<HTMLElement>('.state-table')
    expect(table).not.toBeNull()
    if (!table) return
    table.scrollTop = table.scrollHeight / 2
    await tick()

    const rows = [...document.querySelectorAll<HTMLElement>('.state-row.is-state')]
    const target = rows[Math.floor(rows.length / 2)]
    expect(target).toBeDefined()
    if (!target) return
    const name = target.textContent ?? ''
    target.click()
    await until(() => linkedRowCount() > 0)

    // The header row that lit must be the one clicked, by name.
    const litHeader = document.querySelector<HTMLElement>('.state-row.is-linked.is-state')
    expect(litHeader?.textContent).toBe(name)
  })
```

> Read the control-strip markup in `pane-chrome.ts` before running this — `#lambda .step-forward` is a guess at the forward button's selector. Use whatever class it actually has, and if the strip has no stable hook, add one rather than selecting by position.

- [ ] **Step 2: Run the browser tier**

Run: `cd web && pnpm run test:browser`
Expected: PASS. Investigate any flake rather than re-running — Task 1 exists so a flake here is a real defect.

- [ ] **Step 3: Eye-check the window at both ends of the corpus**

Run the app (`cd web && pnpm run dev`) and check `LINK_CONTEXT` by eye on two programs, per the design's open risk 1:

1. `let x = 40; x + 2` — the whole term is 238 bytes, so the window should show essentially all of it.
2. `let x = 900; let y1 = 1; ... let y200 = 200; x` — the term truncates at 65,536 bytes, so the window is a keyhole. Confirm the target is legible and the `…` markers are visible on both sides.

Adjust `LINK_CONTEXT` if either reads badly, and record the reason in its doc comment.

- [ ] **Step 4: Run the full suite, both languages**

Run:
```bash
cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check
cd web && pnpm test && pnpm run typecheck && pnpm run build && pnpm exec biome ci --error-on-warnings
```
Expected: PASS. `pnpm run build` green activates the CI `web` job.

> The `docker` job never runs on a PR, so if anything in this slice touched the Dockerfile (it should not have), build the image locally before merging.

- [ ] **Step 5: Commit**

```bash
git add web/tests/browser/app.test.ts web/src/lambda-window.ts
git commit -m "web: the browser tier for click-linking, including the virtualized-offset trap"
```

---

## Closing the slice

- [ ] **Update the roadmap.** Add a `#### PLAN 5b CLOSES` entry to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, following 5a-i's and 5a-ii's shape: what was measured, what was falsified, what each task found. In particular record:
  - the `tm_owner`-by-name correction, caught while writing the plan and never shipped as a bug;
  - the final `LINK_CONTEXT` and why eye-check rather than probe;
  - whether Task 1's eager generation bump held, since the roadmap's entry at line 1326 predicts it "wants its own measurement";
  - `tokenClasses()` closing §11.6, and the `TOKEN_CLASSES` drift risk with it.
- [ ] **Add to the accessibility list.** The roadmap's deferred-a11y section (line 1288) gets two new instances: `link-status` is a live region that announces nothing, and `.state-row.is-linked` / `.linked` / `.term .is-linked` are colour-plus-underline with no non-visual equivalent. `Mod-'` is the one thing this slice added that the pass will not have to retrofit.
- [ ] **Open the PR** against `main`. Branch protection means PRs are the only route.

---

## Self-Review Notes

**Spec coverage.** Design decisions 1-14 all land: 1 (step-0 only) in Tasks 9/11; 2 (innermost, no walk) in Task 7's `innermost`; 3 (bidirectional) in Tasks 9, 10 and 11 — source→both, TM row→source, and λ token→source, each with a browser test; 4-5 (window, no printer machinery) in Task 11; 6 (click + keyboard, edit clears) in Task 9; 7 (one export) in Task 6; 8-10 (JS resolution, columnar, eager) in Tasks 6-8; 11 (`LAMBDA_BYTE_BUDGET`) in Task 8; 12 (`settled()` first) is Task 1; 13 (`tokenClasses()`) is Task 2; 14 (one PR) is the branch.

**The gap this review found, and closed.** The first draft built and tested `nodeAtLambda` in Task 7 and then never wired a click handler to it — the λ→source direction would have shipped as a tested, unused resolver, which is two thirds of a decision the design took explicitly. Closing it needed three things the draft did not have: `LambdaWindow.origin` (the window is a slice, and the index speaks whole-text coordinates), `spans.ts`'s `indexToByte` (a click gives a UTF-16 index, and every `Span` in this app is bytes), and a `data-at` per token. All three are now Task 11 steps 5a, 5b and 6b.

**Type consistency.** `setLinkTo(node, origin)` is defined in Task 9 and called from Tasks 9, 10 and 11 with the same signature. `PaneEvents` gains `linkState` (Task 10) and `linkLambda` (Task 11), both optional, both wired for exactly one leg. `LinkIndexWire`'s twelve fields are named identically in `lib.rs` (Task 6), `link.ts` (Task 7) and `protocol.ts` (Task 8). `LinkIndex` is the name of both the Rust struct and the TypeScript class — deliberate, they are the same thing on two sides of a boundary, and they never appear in one file.

**Placeholder scan.** No `TBD`, no "add appropriate error handling", no "similar to Task N". Three steps ask the implementer to *read before editing* rather than giving exact line content — Task 6 step 1 (the λ leg's existing construction in `compile_with_caps`), Task 9 step 8 (the palette's existing custom properties), and Task 12 step 1 (the control strip's selector). Each says why, and each is a case where a guessed literal would be worse than a stated instruction: 5a-ii lost time to exactly two invented CSS properties.
