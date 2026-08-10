# Print-depth cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the λ printer's depth guard fire before V8's call stack does, by giving it a cap measured on the worker thread the app prints on, and make a truncated print say which limit cut it.

**Architecture:** The printer's three depth checks currently read `lambda::reduce::MAX_TERM_DEPTH` (3,000) — the *reducer's* constant, borrowed. They become a `depth_cap` parameter threaded from `session.rs`, which owns the measured number (1,500). Separately, the walk's `hit: bool` becomes `cut: Option<Cut>` so a consumer can tell a byte cut from a depth cut, because only the byte cut produces malformed text that fails to reparse.

**Tech Stack:** Rust (workspace crates `redextape-core`, `redextape-wasm`), wasm-bindgen + serde-wasm-bindgen, TypeScript + Vitest (node and browser/playwright projects), pnpm.

Design: [`../specs/2026-08-09-print-depth-cap-design.md`](../specs/2026-08-09-print-depth-cap-design.md).

## Global Constraints

- **The pre-commit gate runs `cargo clippy --workspace --all-targets -- -D warnings` on any commit touching `*.rs`.** Every commit must leave the whole workspace — including tests and examples — compiling warning-free. This is what forces Tasks 1 and 3 to update every call site in the same commit as the signature they change. Never use `--no-verify`.
- **`biome ci --error-on-warnings` runs on any commit touching `web/**`**, and `pnpm run typecheck` with it. A commit that changes the Rust wire without updating `web/` leaves the tree broken even though the Rust-only hooks pass — so the wire change and its TypeScript consumers ship together (Task 3).
- **`MAX_PRINT_DEPTH = 1_500`** — exact value, `u32`, declared in `crates/redextape-wasm/src/session.rs`.
- **Wire spelling is PascalCase**: `null | 'Bytes' | 'Depth'`, matching `RunStatus`'s existing `'Ended'` / `'DepthRefused'`.
- **`MAX_TERM_DEPTH` is not modified.** After this work it bounds only the reducer.
- Commit messages: no attribution trailers.

---

### Task 1: Thread `depth_cap` through the printer, behaviour unchanged

A pure refactor. Every caller passes `MAX_TERM_DEPTH`, so every existing test must still pass unmodified — that is the proof this task changed nothing.

**Files:**
- Modify: `crates/redextape-core/src/lambda/syntax.rs:242-304` (signatures), `:324-335` (struct), `:351-447` (the three checks)
- Modify: `crates/redextape-core/src/viewmodel.rs:191-196`, `:440-455`
- Modify: `crates/redextape-wasm/src/session.rs:453-456`, `:689-692`
- Modify: `crates/redextape-core/tests/viewmodel_contract.rs:52,55,61,463,626,655,671,683`
- Modify: `crates/redextape-core/examples/frame_cost_probe.rs:252`
- Modify: `crates/redextape-core/examples/link_index_probe.rs:167`

**Interfaces:**
- Produces: `print_lambda_capped(&LambdaTerm, usize, u32) -> (String, Classified, bool)`; `print_lambda_linked(&LambdaTerm, usize, u32, &BTreeMap<NodeId, Path>) -> (String, Classified, bool, Vec<(Span, NodeId)>)`; `LambdaState::render(&LambdaCursor, usize, u32)`; `LinkIndex::build(Option<&LambdaTerm>, Option<&TmProgram>, &SourceMap, usize, u32)`.

- [ ] **Step 1: Write the failing test**

Add to the `mod tests` block in `crates/redextape-core/src/lambda/syntax.rs`, beside `capped_printing_stops_at_the_budget_and_says_so`:

```rust
/// The depth bound is the CALLER'S, not `MAX_TERM_DEPTH`. Driving it at 3 rather than at 3,000 is
/// the whole reason it became a parameter: the branch is reachable without building a term deep
/// enough to be a hazard in its own right.
#[test]
fn the_depth_cap_is_the_callers_number() {
    use crate::desugar::desugar;
    use crate::lambda::lower::lower;
    use crate::parser::parse;

    let (program, ds) = parse("10");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let t = lower(&desugar(&program.expect("parsed"))).expect("a numeral lowers");

    let (_, _, uncapped) = print_lambda_capped(&t, usize::MAX, MAX_TERM_DEPTH);
    assert!(!uncapped, "an unreachable budget and an unreachable depth must not report truncation");

    let (shallow, _, capped) = print_lambda_capped(&t, usize::MAX, 3);
    assert!(capped, "a depth cap of 3 must fire on a term deeper than 3");
    assert!(!shallow.is_empty(), "the walk still writes what it reached before bailing");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p redextape-core --lib lambda::syntax::tests::the_depth_cap_is_the_callers_number`
Expected: FAIL to compile — `print_lambda_capped` takes 2 arguments, 3 supplied.

- [ ] **Step 3: Add the parameter to the two budgeted printers**

In `crates/redextape-core/src/lambda/syntax.rs`, replace the two signatures and the `Printer` construction:

```rust
pub fn print_lambda_capped(
    t: &LambdaTerm,
    byte_budget: usize,
    depth_cap: u32,
) -> (String, crate::analysis::Classified, bool) {
    let want: BTreeMap<NodeId, Path> = BTreeMap::new();
    let (text, spans, hit, _) = print_lambda_linked(t, byte_budget, depth_cap, &want);
    (text, spans, hit)
}

pub fn print_lambda_mapped(t: &LambdaTerm) -> (String, crate::analysis::Classified) {
    let (text, spans, _) = print_lambda_capped(t, usize::MAX, MAX_TERM_DEPTH);
    (text, spans)
}

pub fn print_lambda_linked(
    t: &LambdaTerm,
    byte_budget: usize,
    depth_cap: u32,
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
        depth_cap,
        hit: false,
        path: Path::new(),
        want: &by_path,
        nodes: Vec::new(),
    };
    p.node(t, 0, Role::Term);
    (p.out, p.spans, p.hit, p.nodes)
}
```

Add the field to the struct (after `budget`):

```rust
    budget: usize,
    /// The deepest `Abs`/`App` level this walk may reach. **The caller's number, not
    /// `MAX_TERM_DEPTH`** — that constant bounds the REDUCER's recursion against a native stack, and
    /// a printer running on a browser engine's call stack needs a different, smaller one. See
    /// `redextape_wasm::session::MAX_PRINT_DEPTH`.
    depth_cap: u32,
```

Replace `MAX_TERM_DEPTH` with `self.depth_cap` in all three checks — `node` (`:352`), `write` (`:377`), `parens` (`:429`):

```rust
        if self.out.len() >= self.budget || depth > self.depth_cap {
```

- [ ] **Step 4: Update the two core builders**

`crates/redextape-core/src/viewmodel.rs`:

```rust
impl LambdaState {
    /// Render the term the cursor currently holds, bounded by `byte_budget` and `depth_cap`.
    pub fn render(c: &LambdaCursor, byte_budget: usize, depth_cap: u32) -> LambdaState {
        let (text, spans, truncated) = print_lambda_capped(c.term(), byte_budget, depth_cap);
        LambdaState { text, spans, truncated, step: c.steps_taken() }
    }
```

and in `LinkIndex::build`, add the parameter after `byte_budget` and pass it through:

```rust
    pub fn build(
        term: Option<&LambdaTerm>,
        program: Option<&TmProgram>,
        map: &SourceMap,
        byte_budget: usize,
        depth_cap: u32,
    ) -> LinkIndex {
        let (lambda_text, lambda_spans, lambda_truncated, lambda_nodes) = match term {
            None => (String::new(), Vec::new(), false, Vec::new()),
            Some(t) => print_lambda_linked(t, byte_budget, depth_cap, &map.node_to_lambda),
        };
```

Extend that method's existing `byte_budget IS A PARAMETER` doc paragraph:

```rust
    /// `byte_budget` AND `depth_cap` ARE PARAMETERS because this file picks no numbers — see the
    /// module header. The web app passes `LAMBDA_BYTE_BUDGET`; the wasm boundary passes
    /// `MAX_PRINT_DEPTH`, which is a fact about an engine call stack rather than renderer policy.
```

- [ ] **Step 5: Update every remaining call site**

`crates/redextape-wasm/src/session.rs` — pass `reduce::MAX_TERM_DEPTH` for now; Task 2 replaces it:

```rust
    pub fn lambda_state(&self, byte_budget: usize) -> Result<LambdaState, SessionError> {
        let c = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
        Ok(LambdaState::render(c, byte_budget, lambda::MAX_TERM_DEPTH))
    }
```

```rust
    pub fn link_index(&self, byte_budget: usize) -> LinkIndex {
        let program = self.tm.as_ref().ok().map(|(p, _)| p);
        LinkIndex::build(self.initial_lambda.as_ref(), program, &self.map, byte_budget, lambda::MAX_TERM_DEPTH)
    }
```

If `MAX_TERM_DEPTH` is not already re-exported from `lambda`, use `redextape_core::lambda::reduce::MAX_TERM_DEPTH` and add the import.

`crates/redextape-core/tests/viewmodel_contract.rs` — add `, MAX_TERM_DEPTH` (importing `redextape_core::lambda::reduce::MAX_TERM_DEPTH`) as the last argument at lines 52, 55, 61, 463 (`LambdaState::render`) and 626, 655, 671, 683 (`LinkIndex::build`). Example, line 52:

```rust
    let generous = LambdaState::render(&cursor, usize::MAX, MAX_TERM_DEPTH);
```

`crates/redextape-core/examples/frame_cost_probe.rs:252`:

```rust
        let st = LambdaState::render(c, byte_budget, redextape_core::lambda::reduce::MAX_TERM_DEPTH);
```

`crates/redextape-core/examples/link_index_probe.rs:167`:

```rust
    let index = LinkIndex::build(
        term.as_ref(),
        tm_program.as_ref(),
        &map,
        WEB_BYTE_BUDGET,
        redextape_core::lambda::reduce::MAX_TERM_DEPTH,
    );
```

- [ ] **Step 6: Run the full Rust suite to verify nothing changed**

Run: `cargo test --workspace`
Expected: PASS, including every pre-existing test unmodified. Any behavioural test failure here means the refactor was not neutral — stop and find it rather than editing the test.

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add crates/
git commit -m "refactor: the printer's depth bound becomes the caller's parameter

MAX_TERM_DEPTH is the reducer's constant, calibrated against a native 8 MiB
stack, and the printer was borrowing it. Threading it as a parameter is what
lets the wasm boundary pass a number measured on a browser engine's call stack
instead. Every caller passes MAX_TERM_DEPTH here, so behaviour is unchanged and
every existing test passes unmodified — which is the proof."
```

---

### Task 2: The fix — `MAX_PRINT_DEPTH = 1_500`, owned by the wasm boundary

One constant and two call sites. Small on purpose: this is the commit that changes behaviour, and it should be reviewable on its own.

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs` (new constant near the top; the two call sites from Task 1)

**Interfaces:**
- Consumes: `LambdaState::render(_, _, u32)` and `LinkIndex::build(_, _, _, _, u32)` from Task 1.
- Produces: `redextape_wasm::session::MAX_PRINT_DEPTH: u32`.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-wasm/src/session.rs`'s `mod tests`:

```rust
/// A literal past the print cap must yield a BOUNDED print rather than an unbounded walk. Natively
/// there is stack enough for either, so this pins the cap's arithmetic, not its safety — the
/// browser tests in Task 5 are what pin the safety.
#[test]
fn a_literal_past_the_print_cap_prints_bounded() {
    let src = format!("let x = {}; x + 1", MAX_PRINT_DEPTH + 200);
    let c = Session::compile(&src, EncodingKind::Unary);
    let s = c.session.expect("a large literal still compiles");
    let st = s.lambda_state(65_536).expect("λ leg present");
    assert!(st.truncated, "a term deeper than MAX_PRINT_DEPTH must report truncation");

    let shallow = Session::compile("let x = 40; x + 1", EncodingKind::Unary).session.expect("compiles");
    let ok = shallow.lambda_state(65_536).expect("λ leg present");
    assert!(!ok.truncated, "a shallow term must still print whole");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p redextape-wasm a_literal_past_the_print_cap_prints_bounded`
Expected: FAIL — `MAX_PRINT_DEPTH` not found in this scope.

- [ ] **Step 3: Declare the constant**

In `crates/redextape-wasm/src/session.rs`, beside the other module-level items:

```rust
/// The deepest term either big-budget print may walk.
///
/// **1,500, WHICH IS 22% BELOW A MEASURED CEILING OF 1,930.** That ceiling is the term depth at which
/// a Web Worker's V8 call stack dies mid-print — measured 2026-08-09 under playwright/chromium
/// against the release wasm, 3/3 passes with zero spread. The margin is sized against a real
/// observation rather than taste: Chrome and Chromium differ by ~5% on the page thread (2,690 vs
/// 2,833), so the cap must absorb engine-to-engine variation it has not seen.
///
/// **IT IS NOT `MAX_TERM_DEPTH`, AND THE DIFFERENCE IS THE BUG THIS FIXES.** That constant is 3,000
/// and bounds the REDUCER against a native 8 MiB stack. The printer borrowed it, and 3,000 sits above
/// every browser ceiling measured — so the guard could not fire, and past 3,000 it fires at 3,000
/// frames, which is already past the cliff. There is no input size at which the old arrangement saved
/// the module.
///
/// **IT DOES NOT LIVE BESIDE `LAMBDA_BYTE_BUDGET` in `web/src/protocol.ts`, deliberately.** A byte
/// budget is renderer taste — how much text a pane will hold — and getting it wrong makes a pane
/// ugly. This is a fact about an engine call stack no module can size, and getting it wrong poisons
/// the wasm module. A number a UI author can adjust without a browser measurement is a number that
/// drifts back over the cliff.
///
/// **NO `cfg`.** This crate builds `rlib` as well as `cdylib` so `session.rs` compiles natively for
/// tests, so this is the wasm boundary's policy on whichever target the test runs — and the native
/// tests then exercise the same number the browser does.
pub const MAX_PRINT_DEPTH: u32 = 1_500;
```

- [ ] **Step 4: Use it at both call sites**

Replace `lambda::MAX_TERM_DEPTH` with `MAX_PRINT_DEPTH` in `lambda_state` and `link_index`. Drop the now-unused `MAX_TERM_DEPTH` import if clippy flags it.

- [ ] **Step 5: Run the tests**

Run: `cargo test -p redextape-wasm`
Expected: PASS, including the new test.

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-wasm/src/session.rs
git commit -m "fix: cap the printer at 1,500, measured on the worker stack

Typing 'let x = 2690; x + 1' destroyed the session unrecoverably: the printer
walked to the term's own depth, V8's call stack gave out mid-walk, and the
wasm-bindgen borrow guard was left taken, so every later call on that session
threw 'already borrowed' forever.

1,500 is 22% below a measured worker-thread ceiling of 1,930 (playwright/
chromium, release wasm, 3/3 passes, zero spread). Every ceiling previously on
record was measured on a page thread, which is 47% more generous and not where
the app prints."
```

---

### Task 3: `Cut` — say which limit fired, and update the wire and its consumers together

The gate forces this into one commit: the Rust wire and its TypeScript readers must change together or the tree is broken between commits.

**Files:**
- Modify: `crates/redextape-core/src/lambda/syntax.rs` (new `Cut`, `Printer.cut`, the checks)
- Modify: `crates/redextape-core/src/lambda.rs:15` (re-export `Cut`)
- Modify: `crates/redextape-core/src/viewmodel.rs:56-63`, `:403-428`, `:191-196`, `:440-455`
- Modify: `crates/redextape-wasm/src/lib.rs:288`
- Modify: `crates/redextape-core/tests/viewmodel_contract.rs:53,56,641,658`
- Modify: `crates/redextape-core/examples/link_index_probe.rs:187`, `frame_cost_probe.rs:255`
- Modify: `web/src/types.ts:68`, `web/src/link.ts:11-13,71-83`, `web/src/main.ts:232-243`, `web/src/results.ts:44-46`, `web/src/lambda-pane.ts:142-147`
- Test: `crates/redextape-core/src/lambda/syntax.rs` (`mod tests`), `web/tests/node/results.test.ts`

**Interfaces:**
- Produces: `redextape_core::lambda::Cut { Bytes, Depth }`; `LambdaState.cut: Option<Cut>`; `LinkIndex.lambda_cut: Option<Cut>`; wire `cut` and `lambdaCut` as `null | 'Bytes' | 'Depth'`.

- [ ] **Step 1: Write the failing tests**

In `crates/redextape-core/src/lambda/syntax.rs`'s `mod tests`:

```rust
/// The two producers of a cut are different kinds of object, so a caller must be able to tell them
/// apart. Only the BYTE cut is reliably malformed (`parens` re-checks bytes before its closing paren
/// and does not re-check depth); a DEPTH cut can come out well-formed and reparse into a different,
/// shorter term. `trace.rs`'s `depth_capped` draws exactly this distinction for `HitCap`.
#[test]
fn a_cut_names_the_limit_that_fired() {
    use crate::desugar::desugar;
    use crate::lambda::lower::lower;
    use crate::parser::parse;

    let (program, ds) = parse("10");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let t = lower(&desugar(&program.expect("parsed"))).expect("a numeral lowers");

    let (_, _, none) = print_lambda_capped(&t, usize::MAX, MAX_TERM_DEPTH);
    assert_eq!(none, None, "a walk that ran to completion was not cut");

    let (_, _, by_depth) = print_lambda_capped(&t, usize::MAX, 3);
    assert_eq!(by_depth, Some(Cut::Depth), "an unreachable byte budget leaves depth as the only cause");

    let (_, _, by_bytes) = print_lambda_capped(&t, 8, MAX_TERM_DEPTH);
    assert_eq!(by_bytes, Some(Cut::Bytes), "an unreachable depth cap leaves bytes as the only cause");
}

/// FIRST CAUSE WINS, which is only observable when both limits are reachable in one print. The walk
/// continues at siblings after a bail, so without the rule the reported cause would be whichever
/// subtree bailed LAST. `bail` tests bytes before depth at every site, so bytes is the answer.
#[test]
fn when_both_limits_fire_the_byte_cause_is_the_one_reported() {
    use crate::desugar::desugar;
    use crate::lambda::lower::lower;
    use crate::parser::parse;

    let (program, ds) = parse("10");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let t = lower(&desugar(&program.expect("parsed"))).expect("a numeral lowers");

    // Both reachable: 8 bytes is hit almost immediately, and depth 3 would be too.
    let (_, _, both) = print_lambda_capped(&t, 8, 3);
    assert_eq!(both, Some(Cut::Bytes), "bytes is tested before depth at every bail site");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p redextape-core --lib lambda::syntax::tests::a_cut_names_the_limit_that_fired`
Expected: FAIL to compile — `Cut` not found.

- [ ] **Step 3: Add `Cut` and rework the printer's bail**

In `crates/redextape-core/src/lambda/syntax.rs`, above `Printer`:

```rust
/// Why a bounded print stopped early. `None` means it ran to completion.
///
/// **THE TWO ARE NOT INTERCHANGEABLE, WHICH IS WHY THIS IS NOT A BOOL.** Only the byte re-check gates
/// a `parens` frame's closing paren, so a `Bytes` cut is reliably malformed — an unclosed paren — and
/// fails to reparse loudly. On a `Depth` cut every enclosing `parens` frame closes its `)` as the
/// stack unwinds, so the text can come out WELL-FORMED: valid λ text that reparses into a different,
/// shorter term than the one printed. That is the more dangerous of the two, and a caller that cannot
/// tell them apart cannot defend against it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Cut {
    Bytes,
    Depth,
}
```

Replace `hit: bool` with `cut: Option<Cut>` in the struct, and add two helpers plus the reworked checks to `impl Printer<'_>`:

```rust
    /// FIRST CAUSE WINS — see `when_both_limits_fire_the_first_cause_is_reported`.
    fn set_cut(&mut self, c: Cut) {
        if self.cut.is_none() {
            self.cut = Some(c);
        }
    }

    /// The one bail site's condition, in one place so the three walkers cannot drift apart. Bytes is
    /// tested first, which is what makes `Bytes` the answer when both would fire.
    fn bail(&mut self, depth: u32) -> bool {
        if self.out.len() >= self.budget {
            self.set_cut(Cut::Bytes);
            return true;
        }
        if depth > self.depth_cap {
            self.set_cut(Cut::Depth);
            return true;
        }
        false
    }
```

In `node`, `write` and `parens`, replace the guard with `if self.bail(depth) { return; }`. In `node`, replace `if self.hit { return; }` with `if self.cut.is_some() { return; }`. In `write`'s `App` arm (`:416`) and `parens`'s closing-paren re-check (`:442`), replace `self.hit = true;` with `self.set_cut(Cut::Bytes);` — both are byte-only re-checks and stay byte-only; the existing comments explaining why depth is not re-checked remain correct and stay.

Change the two return types from `bool` to `Option<Cut>` and return `p.cut`. Re-export from `crates/redextape-core/src/lambda.rs:15`:

```rust
pub use syntax::{Cut, parse_lambda, print_lambda, print_lambda_capped, print_lambda_linked, print_lambda_mapped};
```

- [ ] **Step 4: Rename the two view-model fields**

`crates/redextape-core/src/viewmodel.rs` — `LambdaState.truncated: bool` becomes `cut: Option<Cut>`, `LinkIndex.lambda_truncated: bool` becomes `lambda_cut: Option<Cut>`, and the `None` arm of `LinkIndex::build`'s match yields `None` instead of `false`. Update `render` and `build` to bind and store the new value. Add to `LinkIndex.lambda_cut`:

```rust
    /// Which limit cut `lambda_text`, or `None`. **Renamed from `lambda_truncated` rather than
    /// retyped**: leaving the name would let `if (index.lambdaTruncated)` keep compiling while
    /// silently meaning something new.
    pub lambda_cut: Option<Cut>,
```

- [ ] **Step 5: Update the hand-built wire object**

`crates/redextape-wasm/src/lib.rs:288`, replacing the `lambdaTruncated` line:

```rust
        set(
            "lambdaCut",
            &match index.lambda_cut {
                None => JsValue::NULL,
                Some(redextape_core::lambda::Cut::Bytes) => JsValue::from_str("Bytes"),
                Some(redextape_core::lambda::Cut::Depth) => JsValue::from_str("Depth"),
            },
        )?;
```

`LambdaState` crosses via `to_value` (serde-wasm-bindgen), so its `cut` field needs no hand-written mapping — `Option<Cut>` serializes as `null` / `"Bytes"` / `"Depth"` already.

- [ ] **Step 6: Update the Rust readers**

`crates/redextape-core/tests/viewmodel_contract.rs`: line 53 `assert!(generous.cut.is_none());`; line 56 `assert!(tight.cut.is_some(), ...)`; line 641 `assert!(index.lambda_cut.is_none(), "the sample must print whole at 65,536 bytes");`; line 658 `assert!(index.lambda_cut.is_none());`.

`crates/redextape-core/examples/link_index_probe.rs:187`: `truncated: index.lambda_cut.is_some(),`.
`crates/redextape-core/examples/frame_cost_probe.rs:255`: `if st.cut.is_some() && truncated_at.is_none() {`.

- [ ] **Step 7: Update the TypeScript consumers**

`web/src/types.ts:68`:

```ts
export type Cut = 'Bytes' | 'Depth'
export type LambdaState = { text: string; spans: Classified; cut: Cut | null; step: number }
```

`web/src/link.ts` — `lambdaTruncated: boolean` becomes `lambdaCut: Cut | null` in both `LinkIndexWire` (`:13`) and the class (`:72`), and the constructor assignment at `:83` becomes `this.lambdaCut = wire.lambdaCut`.

`web/src/main.ts:242`:

```ts
    return index.lambdaCut !== null ? 'truncated' : 'unmapped'
```

`web/src/results.ts:46`, replacing the single line and correcting the comment two lines above it — the "prefix, not a lie about its shape" claim is true for a byte cut and false for a depth cut:

```ts
    // The text is SHOWN as well as marked. A BYTE cut is a prefix of the real term, so showing it is
    // honest. A DEPTH cut is not — `parens` closes every open paren as the stack unwinds, so the text
    // can be well-formed λ that reparses into a DIFFERENT, shorter term — which is why the two say
    // different things rather than sharing one word.
    if (l.state.cut === 'Bytes') row.note = '… truncated at 64 KiB'
    if (l.state.cut === 'Depth') row.note = '… too deep to show in full'
```

`web/src/lambda-pane.ts:142-147`:

```ts
    if (frame.cut !== null) {
      const more = document.createElement('span')
      more.className = 'truncated'
      more.textContent = frame.cut === 'Depth' ? ' … too deep' : ' … truncated'
      out.push(more)
    }
```

- [ ] **Step 8: Update and extend the web test**

In `web/tests/node/results.test.ts`, `okState` (line 6) currently reads `truncated: false` — change it to `cut: null`. The existing `describe('resultRows — truncation')` block asserts the old single message and **must be replaced**, not merely added to; leaving it would keep asserting a message the byte case still produces while the depth case goes uncovered:

```ts
describe('resultRows — a cut names its cause', () => {
  it('shows the text AND says it was cut, rather than choosing one', () => {
    const rows = resultRows({ ...lambdaOk, state: { ...okState, cut: 'Bytes' } }, tmOk)
    const row = find(rows, 'λ', 'normal form')
    expect(row?.value).toBe('λf. λx. f (f x)')
    expect(row?.note).toBe('… truncated at 64 KiB')
  })

  // The depth case is not a prefix of the real term — `parens` closes every open paren as the stack
  // unwinds, so the text can be well-formed λ that reparses into a DIFFERENT, shorter term. Saying
  // "truncated at 64 KiB" about a 6 KB term would be false twice over.
  it('names depth separately, because that text is not a prefix', () => {
    const rows = resultRows({ ...lambdaOk, state: { ...okState, cut: 'Depth' } }, tmOk)
    expect(find(rows, 'λ', 'normal form')?.note).toBe('… too deep to show in full')
  })

  it('says nothing when the walk ran to completion', () => {
    expect(find(resultRows(lambdaOk, tmOk), 'λ', 'normal form')?.note).toBeUndefined()
  })
})
```

- [ ] **Step 9: Run everything**

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS, clean.

Run: `cd web && pnpm run build:wasm && pnpm run typecheck && pnpm exec biome ci --error-on-warnings && pnpm run test:node`
Expected: PASS. `build:wasm` is required before `typecheck` because `pkg/` is not checked in.

- [ ] **Step 10: Commit**

```bash
git add crates/ web/
git commit -m "feat: a truncated print names the limit that cut it

truncated: bool stood for two producers that are not the same object. Only the
byte re-check gates a parens frame's closing paren, so a byte cut is reliably
malformed and fails to reparse loudly; on a depth cut every enclosing frame
closes its paren as the stack unwinds, so the text can come out WELL-FORMED and
reparse into a different, shorter term. results.ts asserted the output was 'a
prefix of the real one rather than a lie about its shape' — true for one cause,
false for the other, and the depth branch was unreachable in a browser until
the previous commit made it fire.

trace.rs already draws this distinction one layer over: depth_capped separates
HitCap's two producers, which is why RunStatus::DepthRefused exists beside
Capped. This applies the same rule to the flag that had not needed it yet.

Rust and TypeScript move together because the wire changes: a commit that
lands one without the other passes its own hooks and leaves the app broken."
```

---

### Task 4: Browser tests — the tripwire and the original repro, on a worker thread

**Files:**
- Create: `web/tests/browser/depth-cap.test.ts`
- Create: `web/tests/browser/depth-cap-worker.ts`
- Modify: `crates/redextape-wasm/tests/browser.rs` (append the page-thread case)

**Interfaces:**
- Consumes: `MAX_PRINT_DEPTH` (1,500) from Task 2; `lambdaCut` from Task 3.

- [ ] **Step 1: Write the worker harness**

Create `web/tests/browser/depth-cap-worker.ts`:

```ts
// A worker that does ONLY the print. Driving the real session-worker cannot measure this: for a
// large unary literal its TM leg dominates and every case times out before the print is reached.
import init, { compile } from '../../../pkg/redextape_wasm.js'

type Session = { linkIndex(b: number): { lambdaCut: string | null }; free(): void }

let ready: Promise<unknown> | null = null

self.addEventListener('message', async (e: MessageEvent<{ n: number; budget: number }>) => {
  const { n, budget } = e.data
  if (!ready) ready = init()
  await ready
  const { session } = compile(`let x = ${n}; x + 1`, 'unary') as { session: Session | null }
  if (!session) {
    ;(self as unknown as Worker).postMessage({ outcome: 'no-session' })
    return
  }
  let msg: { outcome: string; cut?: string | null; second?: string } = { outcome: 'ok' }
  try {
    msg = { outcome: 'ok', cut: session.linkIndex(budget).lambdaCut }
    // A call AFTER the one under test: if the first aborted mid-flight, wasm-bindgen's reentrancy
    // borrow is still held and this throws "already borrowed" forever.
    session.linkIndex(budget)
    msg.second = 'ok'
  } catch (err) {
    msg = { outcome: err instanceof Error ? err.message : String(err) }
  }
  try {
    session.free()
  } catch {
    /* poisoned */
  }
  ;(self as unknown as Worker).postMessage(msg)
})
```

- [ ] **Step 2: Write the failing test**

Create `web/tests/browser/depth-cap.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

// Mirrors `redextape_wasm::session::MAX_PRINT_DEPTH`. `let x = N; x + 1` has term depth N + 3.
const MAX_PRINT_DEPTH = 1_500

type Reply = { outcome: string; cut?: string | null; second?: string }

/**
 * ON A WORKER THREAD, AND THAT IS THE WHOLE POINT. A worker's V8 call stack died mid-print at term
 * depth 1,930 where the page thread reached 2,833 — 47% more generous — and the app prints in a
 * worker (`session-worker.ts` calls `lambdaState` and `linkIndex` on every compile). A page-thread
 * test passes at any cap below 2,833 and proves nothing about the stack the app lives on.
 */
function print(n: number, timeoutMs = 60_000): Promise<Reply> {
  const w = new Worker(new URL('./depth-cap-worker.ts', import.meta.url), { type: 'module' })
  return new Promise<Reply>((resolve) => {
    const done = (r: Reply) => {
      clearTimeout(timer)
      w.terminate()
      resolve(r)
    }
    const timer = setTimeout(() => done({ outcome: `TIMEOUT after ${timeoutMs}ms` }), timeoutMs)
    w.addEventListener('message', (e: MessageEvent<Reply>) => done(e.data))
    w.addEventListener('error', (e) => done({ outcome: `error event: ${e.message ?? 'unknown'}` }))
    w.postMessage({ n, budget: 65_536 })
  })
}

describe('the print-depth cap', () => {
  it('walks a term AT the cap without exhausting the worker stack', { timeout: 120_000 }, async () => {
    // THE TRIPWIRE. It fails if a future engine's call stack drops to meet the cap, which is the one
    // risk a cap calibrated on one browser cannot design away. Same role as browser.rs's
    // `a_deep_but_legal_program_needs_the_raised_shadow_stack`, one stack up.
    const r = await print(MAX_PRINT_DEPTH - 3)
    expect(r.outcome).toBe('ok')
  })

  it('reports a depth cut instead of destroying the session', { timeout: 120_000 }, async () => {
    // The original repro from the 2026-08-09 investigation: this exact program destroyed the session
    // unrecoverably, and every later call threw "attempted to take ownership of Rust value while it
    // was borrowed" because the abort left wasm-bindgen's guard taken.
    const r = await print(2690)
    expect(r.outcome).toBe('ok')
    expect(r.cut).toBe('Depth')
    expect(r.second).toBe('ok')
  })
})
```

- [ ] **Step 3: Run to verify the tests are meaningful**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/depth-cap.test.ts`
Expected: PASS with the cap in place. To confirm the second test would have caught the bug, temporarily set `MAX_PRINT_DEPTH` to `3_000` in `session.rs`, rebuild with `pnpm run build:wasm`, and re-run: it must FAIL with a stack-overflow message. **Restore 1,500 and rebuild before continuing.**

- [ ] **Step 4: Add the page-thread case**

Append to `crates/redextape-wasm/tests/browser.rs`:

This file drives the **generated JS glue** through `JsValue` reflection rather than Rust structs — that is its stated purpose ("tests in a browser and never touch the generated glue" is what it exists to avoid). Use its existing `compile` / `call` / `get` helpers exactly as the surrounding tests do:

```rust
/// n=2,900 rather than the investigation's 2,690, because THIS test runs on the page thread, whose
/// ceiling is term depth 2,833. At 2,690 it would pass with or without the cap and pin nothing; at
/// 2,900 the uncapped walk exhausts the page stack, so the assertion bites where the test actually
/// runs. The worker-thread cases live in `web/tests/browser/depth-cap.test.ts` — `wasm_bindgen_test`
/// runs on the page, and `run_in_dedicated_worker` would re-home every test in this file to buy two.
#[wasm_bindgen_test]
fn a_term_past_the_print_cap_is_bounded_rather_than_fatal() {
    let (_, session) = compile("let x = 2900; x + 1");
    assert!(!session.is_null(), "a large literal still compiles");

    let index = call(&session, "linkIndex", &[JsValue::from_f64(65_536.0)]);
    assert_eq!(
        get(&index, "lambdaCut").as_string().as_deref(),
        Some("Depth"),
        "a term deeper than MAX_PRINT_DEPTH must report a depth cut, not walk to its own depth"
    );

    // A call AFTER the one under test. If the first had aborted mid-flight, wasm-bindgen's
    // reentrancy borrow would still be held and this would throw "already borrowed" forever.
    let again = call(&session, "linkIndex", &[JsValue::from_f64(65_536.0)]);
    assert!(!again.is_null(), "the session survives its own bounded print");
}
```

- [ ] **Step 5: Run both browser tiers**

Run: `PATH=$PATH:/usr/sbin wasm-pack test --headless --chrome crates/redextape-wasm`
Expected: PASS. (Chrome lives in `/usr/sbin` and is off the default PATH.)

Run: `cd web && pnpm run test:browser`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/tests/browser/ crates/redextape-wasm/tests/browser.rs
git commit -m "test: pin the print cap on both stacks, and the repro that started it

The tripwire runs on a WORKER thread because that is where the app prints and
where the ceiling is 1,930; a page-thread test passes at any cap below 2,833
and proves nothing. It fails if a future engine's stack drops to meet the cap.

The second case is the original repro — 'let x = 2690; x + 1' — asserting a
depth cut AND that a following call on the same session still succeeds, which
is what proves wasm-bindgen's reentrancy borrow was not left taken.

browser.rs gets the same assertion at n=2,900, above the page thread's own
ceiling, so the regression is pinned on both stacks rather than the cheaper one."
```

---

### Task 5: Close 5b's third open item

The λ-link `truncated` branch had no end-to-end test and could not get one: it needed a term over the byte budget, which needed a literal that crashed the module. A depth cut reaches the same branch without one.

**Files:**
- Modify: `web/tests/browser/app.test.ts` (or the file already covering `lambdaLinkState`; find it with `rg -l lambdaLinkState web/tests`)

- [ ] **Step 1: Write the test**

```ts
it('reports a construct past the cut as truncated rather than unmapped', async () => {
  // 5b's third open item, unblocked. It needed a λ term past LAMBDA_BYTE_BUDGET, which needed a
  // literal past ~2,690 — and that crashed the wasm module outright, so the branch was untestable by
  // construction rather than by choice. With MAX_PRINT_DEPTH in place the same branch is reached by
  // a DEPTH cut, from a program that no longer kills the session.
  const app = await mount('let x = 1800; x + 1')
  await app.clickSource(/x/)
  expect(app.linkStatus()).toBe('the λ term is truncated before this construct')
})
```

Adapt the helper names to the file's existing harness rather than inventing new ones.

- [ ] **Step 2: Run it**

Run: `cd web && pnpm run test:browser`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/tests/browser/
git commit -m "test: close 5b's untestable branch, unblocked by the depth cap

lambdaLinkState's 'truncated' branch needed a term over the 64 KiB budget,
which needed a literal past ~2,690, which crashed the module — not deferred by
choice. A depth cut reaches the branch from a program that survives."
```

---

### Task 6: Correct the four documentation claims the measurement falsified

**Files:**
- Modify: `crates/redextape-core/src/lambda/reduce.rs:44-50`
- Modify: `crates/redextape-core/src/lambda/syntax.rs` (`print_lambda_capped`'s doc, the paragraphs at `:216-241`)
- Modify: `.cargo/config.toml` (closing paragraph of the wasm32 block)

- [ ] **Step 1: Correct `reduce.rs`**

Replace the sentence *"Effective only when the running thread's stack is large enough (WASM shadow-stack sizing is a Plan 4 follow-up)."*:

```rust
/// Effective only when the running thread's stack is large enough. **THE WASM SHADOW STACK IS NOT
/// THE RELEVANT STACK, and `-zstack-size` cannot help** — on that target the printer exhausted V8's
/// own engine call stack, which no module can size, at term depth 1,930 in a Web Worker (measured
/// 2026-08-09). This constant no longer bounds the printer for that reason; see
/// `redextape_wasm::session::MAX_PRINT_DEPTH`. What remains here is the REDUCER's bound, which is
/// what it was written for.
pub const MAX_TERM_DEPTH: u32 = 3_000;
```

- [ ] **Step 2: Correct `syntax.rs`'s doc**

In `print_lambda_capped`'s doc, the paragraph beginning *"THE BUDGET ALONE DOES NOT BOUND RECURSION"* currently ends by naming `lambda::reduce::MAX_TERM_DEPTH` as the bound. Replace that clause with the caller's parameter, and extend the reparse warning:

```rust
/// past the caller's `depth_cap`, the walk stops and records `Cut::Depth` the same way the budget
/// records `Cut::Bytes`. The cap is the CALLER'S because the stack it must fit is a property of the
/// engine, not of the term: `MAX_TERM_DEPTH` (3,000) was calibrated on a native 8 MiB stack, and a
/// Web Worker's V8 call stack dies at term depth 1,930.
```

and, in the TRUNCATED-OUTPUT-IS-NOT-SAFE-TO-REPARSE paragraph, replace *"a caller cannot tell from the bool alone which limit fired"* with a pointer to `Cut`, since a caller now can.

- [ ] **Step 3: Correct `.cargo/config.toml`**

Replace *"The measurement recorded in the roadmap is what says whether it was enough."*:

```
# This controls the SHADOW stack in linear memory, NOT the engine's own wasm call-depth limit, which
# a module cannot set. IT WAS NOT ENOUGH, and the measurement now exists: the printer exhausted V8's
# engine call stack at term depth 2,833 on a page thread and 1,930 in a Web Worker (2026-08-09,
# playwright/chromium, release wasm). Raising this number cannot move either figure. The printer is
# bounded by `redextape_wasm::session::MAX_PRINT_DEPTH` instead.
```

- [ ] **Step 4: Verify and commit**

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS, clean.

```bash
git add crates/ .cargo/config.toml
git commit -m "docs: the shadow stack was the wrong suspect, and three files said so

reduce.rs called this a sizing problem — 'WASM shadow-stack sizing is a Plan 4
follow-up' — which implies -zstack-size would fix it. It would not: the
exhausted resource is V8's own engine call stack, which no module can size.
Anyone following that note to its obvious remedy spends the effort and still
crashes. .cargo/config.toml already said the two stacks were different and
deferred to 'the measurement recorded in the roadmap'; that measurement now
exists and is 1,930 on a worker."
```

---

### Task 7: Roadmap

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Add the slice entry**

Add a `####` entry in the same voice as its neighbours, carrying: the three-row measurement table from the design's §0; that the guard fired too late by construction (n=3,001/4,000/6,000 all overflow); that the byte budget had 5.9x headroom at the cliff and structurally could not protect; that reduction is not co-exposed and why (λ lowering refuses the shapes that would grow deep enough); and that the investigation's recommended 2,000 sat *above* the ceiling that applies.

- [ ] **Step 2: Resolve the open entries**

- The 2026-08-09 entry *"A large integer literal kills the wasm module…"* (`:1394`) gains its resolution and the correction to its own recommended number.
- 5b's open item 3 (`:3898-3901`) closes, pointing at Task 5's test.
- 5b's open item 1 (`client.extend()`'s silent no-op) moves to the accessibility list, which is where its fix belongs.

- [ ] **Step 3: Fold in the coverage observation**

Into the new entry — it exists only in `.superpowers/sdd/progress.md`, which `git clean -fdx` destroys:

```markdown
**CARRIED OUT OF SCRATCH, because a finding that survives only there is one nobody acts on.** All 8
uncovered web functions live in 3 files — **function** coverage `banner.ts` 75%, `lambda-pane.ts`
83.33%, `main.ts` 82.35%; every other file is 100%. (Not `banner.ts`'s 64.28% on a different metric,
which is by design: `showBanner` is split from `bannerText` so the wording is node-testable and the
DOM write is not.) `functions` is the tightest of the four floors — three new untested entries trip
it, against 10 for branches and 14 for statements — so those three files are the only sources of
headroom, and `main.ts` is app wiring. This is what a future PR will hit when `functions` trips.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "roadmap: the print cap lands, and the ceiling nobody had measured

Every figure previously on record was taken on a page thread; the app prints in
a worker, whose stack is 31.9% smaller. Also carries the web-coverage
observation out of scratch, which git clean -fdx would otherwise destroy."
```

---

### Task 8: Full gate, then open the PR

- [ ] **Step 1: Run everything**

```bash
scripts/check-all.sh --no-llvm
cd web && pnpm run build && pnpm run test:coverage
PATH=$PATH:/usr/sbin wasm-pack test --headless --chrome crates/redextape-wasm
```

Expected: all green. `test:coverage` must clear the floors (`lines 94, functions 93, branches 85, statements 92`) — Task 3 adds branches to `results.ts` and `lambda-pane.ts`, both of which are in the three files carrying every uncovered function, so watch `functions` in particular.

- [ ] **Step 2: Confirm the wasm size delta**

Run: `ls -l pkg/redextape_wasm_bg.wasm`
Record the delta against `main` in the PR body; the project reports this on every slice that touches the boundary.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin print-depth-cap
```

Open the PR against `main` with the measurement table in the body. **Do not merge** — Davey merges his own PRs.

---

## Self-review

**Spec coverage.** §0 measurements → Task 7 (roadmap) and the doc comments in Tasks 2/6. §1 scope → nothing here raises `MAX_TERM_DEPTH` or rewrites the printer iteratively. §2.1 the number → Task 2. §2.2 shape and ownership → Tasks 1 and 2. §3.1–3.4 the cause, precedence, wire → Task 3. §4 consumers → Task 3 Step 7. §5 tests 1–4 → Tasks 1 and 3; tests 5, 6 → Task 4; test 6b → Task 4 Step 4; test 7 → Task 3 Step 8; test 8 → Task 5. §6 docs → Task 6. §7 roadmap and the coverage fold-in → Task 7. §8 risks → carried into the `MAX_PRINT_DEPTH` doc comment and the roadmap entry.

**Naming consistency.** `MAX_PRINT_DEPTH`, `Cut::{Bytes, Depth}`, `LambdaState.cut`, `LinkIndex.lambda_cut`, wire `cut` / `lambdaCut`, TS `Cut = 'Bytes' | 'Depth'` — used identically in Tasks 1–7.

**Two collapses, both forced by the gate, both stated where they happen.** Task 1 updates nine call sites in one commit because `clippy --all-targets -D warnings` will not accept a half-changed signature. Task 3 ships Rust and TypeScript together because the Rust-only hooks would pass on a commit that leaves the app reading a field that no longer exists.
