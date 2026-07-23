# Plan 3b-1 — Closures / Higher-Order via Core→Core Defunctionalization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Tasks 1, 2, 4 author a real compiler transform — **the reference-equivalence test is the contract; author and iterate the transform until `reference(P) == reference(defunc(P))` and `defunc(P)` lowers first-order.** Tasks 3, 5 are wiring + oracle/tests.
>
> **Design spec:** `docs/superpowers/specs/2026-07-23-plan3b-closures-design.md` (read it first — the approach, the 3b-1/3b-2 split, the `Unsupported` boundary).

**Goal:** Make the TM run first-class functions via a **Core→Core defunctionalization pass** (`tm/defunc.rs`), so the higher-order `map`/`fold` demos and immutable-capturing lambdas become genuinely three-way (`reference == λ == TM`). Plan 3b-1 covers **closed** function-values and **immutable** capture; mutable capture (boxing, two-way) is Plan 3b-2.

**Architecture:** `defunc(&Core) -> Result<Core, LowerError>` rewrites higher-order Core into **first-order** Core the existing `lower_asm`/`lower_tm`/`decode` handle unchanged. `run_tm` runs `defunc` as its first step; the reference and λ backends still consume the original Core, so the oracle validates `reference(P) == λ(P) == TM(defunc(P))`. A lambda/fn used as a *value* becomes a closure `cons(tag, env)`; `apply(f, args)` on a value becomes a call to a generated per-arity `applyN` dispatcher (`let tag = head(clos); let env = tail(clos); if tag == 0 {…} else if …`) whose arms **inline the lambda bodies** (so the dispatchers stay closed) and unpack captures from `env`. Functions are emitted in **dependency order** (callees outer) since neither the reference nor `lower_asm` supports mutual recursion.

**Tech Stack:** Rust; `crate::core::{Core, NodeId, NodeGen, BinOp}`, `crate::desugar`, `crate::tm::{lower_asm, run_tm}`, `crate::run` (the reference), the three-way oracle.

## Global Constraints

Copied from the design spec + the code facts established while planning. Every task's requirements implicitly include this section.

- **Semantics-exact or `Unsupported`, never a silent miscompile.** Everything `defunc` accepts must satisfy `reference(P) == reference(defunc(P))` (a direct unit check) and the three-way oracle. Anything it can't handle exactly → `LowerError::Unsupported { node, what }` (excluded from the oracle, exactly like the existing first-order boundary). This is the Plan-3-Part-1 discipline (the capturing-lambda rejection that prevented a silent wrong answer).
- **The output of `defunc` is FIRST-ORDER Core:** no `Lambda` survives in a value position; every `Apply` callee is a `Var` naming a function (a generated `applyN`, a kept named fn, or a builtin). So `lower_asm` handles it unchanged (after Task 3 narrows its rejection to match).
- **Closures are `cons(tag, env)` on the HEAP** — reuse the existing cons/head/tail/nil machinery; NO new representation. `tag` is a small `Nat` (`< FIELD_WIDTH`); `env` is a cons list of captured values (empty = `nil` for a closed fn). A closure is never a *final decoded result* (the reference `Value::Closure` has no structural equality and is never a demo's answer), so `decode` needs no change.
- **Dependency-order emission.** Neither the reference (`LetRec` captures its env at definition) nor `lower_asm` (`lower_function` binds only the current fn) supports mutual recursion, and the language has none. So `defunc` emits functions as nested `LetRec`s with **callees outer of callers**; a **cyclic** higher-order call graph (a lambda body that applies a value whose dispatch reaches back to it) is `Unsupported` — the language can't express it anyway. Self-recursion (a fn calling itself by name, e.g. `map`) is fine (`LetRec` binds the name before its body).
- **3b-1 rejects mutable capture** (`LowerError::Unsupported`), matching the λ backend (which already rejects mut-in-closure). Immutable capture is captured **by value** — exact for immutables. Also `Unsupported`: partial application / arity mismatch on a closure call, a builtin used as a bare value, a self-referential anonymous recursive closure.
- **Synthetic NodeIds:** `defunc` mints new Core nodes; thread a `NodeGen` seeded past the input's max id (or a sentinel). The oracle is id-agnostic; source-maps for defunc'd code are a Plan-4 concern.
- **Bounds:** values/tags/list-lengths/env-sizes stay `< FIELD_WIDTH` (64); higher-order over a list is step-heavy (each element = an `applyN` dispatch + a frame), so demo lists stay short (≤ 3) under `TM_DEFAULT_CAPS`. The `MAX_LOWER_DEPTH`/`MAX_SLOTS`/`MAX_FRAME_LOC`/`MAX_EVAL_DEPTH` guards stay intact.

---

## File Structure

- **Create** `crates/redextape-core/src/tm/defunc.rs` — the pass + its unit tests (Tasks 1, 2, 4, 5).
- **Modify** `crates/redextape-core/src/tm.rs` — add `pub mod defunc;` + re-export `defunc`; run it inside `run_tm` (Task 3).
- **Modify** `crates/redextape-core/src/tm/lower_asm.rs` — narrow the first-order rejection so it doesn't reject what `defunc` now handles, while still rejecting genuinely-unsupported input `defunc` passes through (Task 3).
- **Modify** `crates/redextape-core/tests/three_way_oracle.rs` — move `map`/`fold` from `assert_lambda_only` to `assert_three_way`; add capturing + `Unsupported` demos (Tasks 3, 4, 5).

---

## Design reference (read before Task 1)

**What `defunc` receives** (post-desugar): a program is a nested `LetRec` chain (`fn name(params){body}` → `LetRec{name, Lambda(params,body), rest}`) ending in a tail expression. `[1,2,3]` → `Apply(Var("cons"), …)` spine; `xs.map(f)` → `Apply(Var("map"), [xs, f])`; `f(a)` → `Apply(Var("f"), [a])`; `|p| e` → `Lambda([p], e)`.

**"Used as a value"** = a `Var`/`Lambda` occurrence that is NOT the immediate callee of an `Apply` (mirrors `lower_asm::reject_fn_value`'s walk). In `map`'s body, `f(head(xs))` uses `f` as an *apply callee that is a value* (a param, not a static fn) → that apply is dispatched; `map(tail(xs), f)` uses `f` as a *value argument* → `f` there becomes a closure reference (it already is one — a param holding a closure — so it stays `Var("f")`).

**The transform, per the demos:**
- A named fn or lambda used as a value gets a **tag** (per arity). `add1` (arity 1) → tag `A1_0`; `add` (arity 2) → tag `A2_0`; a lambda `|x| x+n` (arity 1) → tag `A1_1`.
- Each value-use site emits the closure: `Var("add1")`-as-value → `cons(A1_0, nil)`; `|x| x+n` → `cons(A1_1, cons(<value of n>, nil))`.
- Each apply-of-a-value `Apply(Var("f"), args)` where `f` is a value (a param/local, not a static fn) → `Apply(Var("applyN"), [Var("f"), args…])`, `N = args.len()`.
- Generate `applyN(clos, a1..aN)` for each arity `N` used, dispatching on `head(clos)`:
  ```
  fn applyN(clos, a1, …, aN) {
    let tag = head(clos);
    let env = tail(clos);
    if tag == <A_N_0> { <arm for lambda 0> } else if tag == <A_N_1> { … } else { <fault: apply a bogus op to diverge/fault> }
  }
  ```
  An arm for a lambda `|p1..pN| body` capturing `[c1..cm]`: `let c1 = head(env); let c2 = head(tail(env)); …; let p1 = a1; …; let pN = aN; <body>`. (For a closed fn the env part is empty.)
- **Emit order (nested `LetRec`s, outermost first):** the `applyN` dispatchers and any kept named fns, topologically sorted so a fn appears **outer of** (before) every fn it calls; then the rewritten main expression innermost. A value-only fn (never directly called) is **dropped** as a binding — its body lives only in a dispatcher arm. A cyclic dependency → `Unsupported`.

**Fault arm:** the dispatcher's final `else` is unreachable for well-typed programs; make it *fault* (e.g. `head(nil)` — which already faults/diverges on all backends) so a bad tag never silently returns a value.

---

## Task 1: `defunc` — a single closed function-value + one dispatcher

The minimal end-to-end transform: one closed fn passed as a value, one `applyN`. Target the program the current suite rejects.

**Files:** Create `crates/redextape-core/src/tm/defunc.rs`; add `pub mod defunc;` to `tm.rs`.

**Interface produced:** `pub fn defunc(core: &Core) -> Result<Core, crate::tm::lower_asm::LowerError>` — rewrites higher-order Core to first-order Core, or `Unsupported`.

- [ ] **Step 1: Write the failing test (the contract)**

In `defunc.rs`'s `#[cfg(test)] mod tests`:
```rust
use super::*;
use crate::desugar::desugar;
use crate::parser::parse;

/// Reference-equivalence: `defunc` preserves meaning. Parse+desugar `src`, run the reference on the
/// ORIGINAL and on `defunc(original)`, and require the same value. Also require `defunc`'s output to
/// lower first-order (lower_asm accepts it) — the whole point.
fn defunc_preserves_and_lowers(src: &str) {
    use crate::tm::lower_asm::lower_asm;
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let reference = crate::run(src).expect("reference runs");
    let d = defunc(&core).expect("defunc succeeds");
    // 1. meaning preserved: the reference evaluates defunc(core) to the same value.
    let via_defunc = crate::interp::eval(&d).expect("defunc'd core runs on the reference");
    assert_eq!(via_defunc, reference, "defunc changed the meaning of: {src}");
    // 2. defunc(core) is first-order: lower_asm accepts it (no fn-as-value left).
    lower_asm(&d).unwrap_or_else(|e| panic!("defunc(core) must lower first-order for {src}: {e:?}"));
}

#[test]
fn one_closed_function_value_through_a_dispatcher() {
    // Currently `function_as_a_value_is_unsupported`: apply2 takes a function argument.
    defunc_preserves_and_lowers("fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)");
}
```
> `crate::interp::eval(&Core)` is the reference evaluator (see `interp.rs`); it takes a `&Core` and returns `Result<Value, RuntimeError>`. Confirm the exact path (`crate::interp::eval` is `pub`); if the public entry is `crate::run(&str)`, add a thin `pub` `eval`-on-`Core` helper or use the existing `interp::eval`.

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib tm::defunc::tests::one_closed_function_value_through_a_dispatcher`
Expected: FAIL — `defunc` undefined.

- [ ] **Step 3: Implement `defunc` for the closed single-value case**

Author `defunc.rs` per the Design reference, scoped to: closed fns/lambdas used as values (no capture yet), per-arity tags, `applyN` generation (inline the body as the arm, bind params to `a_i`), rewrite value-uses → `cons(tag, nil)` and value-applies → `applyN`, emit in dependency order (drop value-only fns, hoist dispatchers outer), fault `else`. Reject (Unsupported) anything beyond this case for now (a capture, a mutable, a builtin-as-value, a cycle). Use a `NodeGen` seeded past the input max id for synthetic nodes.

Iterate until the test passes; hand-trace the transformed Core (print it in a scratch test if helpful).

- [ ] **Step 4: Run to verify it passes** — `cargo test -p redextape-core --lib tm::defunc` → PASS.

- [ ] **Step 5: fmt/clippy/commit**
```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/defunc.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): defunc pass — a closed function-value dispatched through applyN"
```

---

## Task 2: Generalize to the `map`/`fold` demos

Multiple tags per arity, recursive higher-order fns (`map`/`fold` self-recurse and call `applyN`), list arguments, and multiple applied values in one program.

**Files:** Modify `crates/redextape-core/src/tm/defunc.rs`.

- [ ] **Step 1: Add the failing tests**
```rust
#[test]
fn map_over_a_list_defuncs_and_agrees() {
    defunc_preserves_and_lowers(
        "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
         fn add1(x) { x + 1 }\n\
         [3, 1, 2].map(add1)",
    );
}

#[test]
fn map_and_fold_with_two_arities_agree() {
    defunc_preserves_and_lowers(
        "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
         fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
         fn add(a, b) { a + b }\n\
         fn add1(x) { x + 1 }\n\
         fold([3, 1, 2].map(add1), 0, add)",
    );
}
```

- [ ] **Step 2: Run to verify they fail** (the single-value transform doesn't yet handle recursion/multiple tags/arities): `cargo test -p redextape-core --lib tm::defunc::tests::map_over_a_list_defuncs_and_agrees` → FAIL.

- [ ] **Step 3: Generalize the transform**

Extend `defunc`: multiple value-used fns → multiple tags (grouped by arity); an `applyN` per arity with one arm per tag; a **called-by-name** fn (like `map`/`fold`) keeps its `LetRec` binding (it self-recurses and calls `applyN`), while a **value-only** fn (`add1`/`add`) is dropped-and-inlined; the dependency-order sort places each `applyN` outer of its callers (`map` calls `apply1` → `apply1` outer of `map`) and inner of its arms' dependencies. A value-used fn's body rewrite (its own `f(...)` applies, if higher-order) recurses. Confirm the emit order is a valid topological order and detect a cycle → `Unsupported`.

- [ ] **Step 4: Run to verify they pass** — `cargo test -p redextape-core --lib tm::defunc` → PASS (both new + Task 1).

- [ ] **Step 5: fmt/clippy/commit**
```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/defunc.rs
git commit -m "feat(tm): defunc handles map/fold — multiple tags/arities, recursive higher-order fns"
```

---

## Task 3: Wire into `run_tm`, narrow `lower_asm`, three-way oracle

Run `defunc` in the TM path; narrow `lower_asm`'s rejection; move `map`/`fold` to `assert_three_way`.

**Files:** `tm.rs`, `tm/lower_asm.rs`, `tests/three_way_oracle.rs`.

- [ ] **Step 1: Add the failing oracle change**

In `tests/three_way_oracle.rs`, MOVE the `map`/`fold` demo from `HIGHER_ORDER_DEMOS` (asserted λ-only) into `FIRST_ORDER_DEMOS` (asserted three-way via `assert_three_way`). Add `"fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)"` and `"[3, 1, 2].map(add1)"` (with the `fn map` prelude) to `FIRST_ORDER_DEMOS`.

- [ ] **Step 2: Run to verify it fails** — `cargo test -p redextape-core --test three_way_oracle` → FAIL (`run_tm` still `LowerError`s on the higher-order demos, since it doesn't yet call `defunc`).

- [ ] **Step 3: Wire `defunc` + narrow `lower_asm`**

- In `tm.rs`: `run_tm` runs `defunc(core)` first: `let core = match defunc(core) { Ok(c) => c, Err(e) => return TmRun::LowerError(e) };` then proceeds with `lower_asm(&core)` as today. Re-export `pub use defunc::defunc;`.
- In `tm/lower_asm.rs`: `defunc` output is first-order, so `lower_asm` should accept it. It already does (first-order Core lowers). The existing rejections (`reject_fn_value`, the Lambda/higher-order-Apply arms) now only fire on input `defunc` *passed through* as genuinely-unsupported (they shouldn't fire on `defunc`'s output). Verify no rejection wrongly fires on defunc'd Core; adjust only if a false rejection is found (e.g. `defunc`'s generated `applyN` bodies must not trip `reject_fn_value`). Do NOT loosen a rejection that guards a real unsupported case.
- **Localization:** the intermediate `asm-interp == TM` oracle already runs `lower_asm` on the non-defunc'd Core in `assert_asm_interp_matches_tm`; update THAT helper to also defunc first (so both legs compile the same Core), OR confirm it already routes through `run_tm`. Keep the two oracles consistent.

- [ ] **Step 4: Run to verify it passes** — `cargo test -p redextape-core --test three_way_oracle` → PASS (map/fold three-way). Run the full `cargo test -p redextape-core`.

- [ ] **Step 5: fmt/clippy/commit**
```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm.rs crates/redextape-core/src/tm/lower_asm.rs crates/redextape-core/tests/three_way_oracle.rs
git commit -m "feat(tm): run defunc in run_tm — map/fold are now three-way (reference == lambda == TM)"
```

---

## Task 4: Immutable environment capture

Handle a lambda that captures immutable free variables (`|x| x + n`): build the env at closure-creation, unpack it in the dispatcher arm. Reject mutable capture.

**Files:** `crates/redextape-core/src/tm/defunc.rs`, `tests/three_way_oracle.rs`.

- [ ] **Step 1: Add the failing tests**
```rust
// in defunc.rs tests:
#[test]
fn a_capturing_lambda_defuncs_by_value() {
    defunc_preserves_and_lowers("let n = 5; fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } [1, 2, 3].map(|x| x + n)");
}

#[test]
fn capturing_a_mutable_is_unsupported() {
    use crate::tm::lower_asm::LowerError;
    let (prog, ds) = parse("let mut m = 0; fn ap(f) { f(1) } ap(|x| x + m)");
    assert!(ds.is_empty(), "{ds:?}");
    let core = desugar(&prog.unwrap());
    assert!(matches!(defunc(&core), Err(LowerError::Unsupported { .. })), "mutable capture must be Unsupported in 3b-1");
}
```
> Add the capturing demo to `FIRST_ORDER_DEMOS` in `tests/three_way_oracle.rs` (three-way). If the reference/λ reject the `let mut … |x| x+m` shape at a stage before `defunc`, adjust the negative test to whatever stage rejects it — the contract is "not a wrong answer".

- [ ] **Step 2: Run to verify they fail** — the capturing lambda's free `n` currently isn't captured → `defunc` either errors or miscompiles → FAIL.

- [ ] **Step 3: Implement capture**

Extend the free-variable analysis: for a lambda used as a value, compute captured free vars (referenced in the body, not params, not globals/named-fns). For each **immutable** capture, the closure is `cons(tag, <env list of the captured VALUES>)` built at the creation site (evaluate each captured var there); the dispatcher arm prefixes `let c_i = <head/tail chain into env>;` before the (param-bound) body. A **mutable** capture → `Unsupported` (check the binding's `mutable` flag / that the name resolves to a `let mut`; if defunc can't tell mutability from Core alone, thread the info or conservatively treat any capture whose name is assigned anywhere in scope as mutable → Unsupported). Immutable-by-value is exact.

- [ ] **Step 4: Run to verify they pass** — `cargo test -p redextape-core --lib tm::defunc` + `--test three_way_oracle` → PASS.

- [ ] **Step 5: fmt/clippy/commit**
```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/defunc.rs crates/redextape-core/tests/three_way_oracle.rs
git commit -m "feat(tm): defunc captures immutable free variables (by value); rejects mutable capture"
```

---

## Task 5: `Unsupported` boundary tests + golden

Nail the rejection boundary (never a wrong answer) and snapshot the higher-order step cost.

**Files:** `crates/redextape-core/src/tm/defunc.rs` (tests), `crates/redextape-core/src/tm/lower_tm.rs` (a step-count golden).

- [ ] **Step 1: Add boundary + golden tests**
```rust
// defunc.rs tests — each must be Unsupported (rejected), never a wrong answer:
#[test]
fn unsupported_boundary() {
    use crate::tm::lower_asm::LowerError;
    fn rejects(src: &str) {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "{src}: {ds:?}");
        let core = desugar(&prog.unwrap());
        assert!(matches!(defunc(&core), Err(LowerError::Unsupported { .. })), "must be Unsupported: {src}");
    }
    rejects("fn ap(f, x) { f(x) } ap(cons, 1)");           // builtin as a value (arity-2 cons as a 1-value? see note)
    // add cases as the transform's real boundaries emerge: partial application, a cyclic higher-order
    // call graph, a self-referential anonymous recursive closure. Keep each a genuine Unsupported.
}
```
> Only assert what `defunc` actually rejects — discover the real boundaries during Tasks 1–4 and pin them here. Do NOT assert a rejection for a case `defunc` correctly handles.

Add a step-count golden (in `lower_tm.rs` tests, mirroring `tm_step_count_goldens`) for a defunc'd higher-order demo, e.g. `"[1, 2].map(|x| x + 1)"` (with `fn map`), CAPTURING the real count.

- [ ] **Step 2: Run** — capture the golden count; `cargo test -p redextape-core --lib tm::defunc tm::lower_tm` → PASS.

- [ ] **Step 3: fmt/clippy + full suite** — `cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings && cargo test -p redextape-core` → all green.

- [ ] **Step 4: Commit**
```bash
git add crates/redextape-core/src/tm/defunc.rs crates/redextape-core/src/tm/lower_tm.rs
git commit -m "test(tm): defunc Unsupported-boundary cases + a higher-order step-count golden"
```

---

## Deferred to Plan 3b-2 (do NOT attempt here)

- **Mutable-capture via boxing (TWO-WAY):** a fixed-width mutable heap-box primitive on the TM (`box`/`box_get`/`box_set` asm ops + one δ-gadget for in-place overwrite), and `defunc` boxing captured mutables (so the closure and the outer `n = v` share a cell — matching the reference's by-reference semantics). Those programs are `reference == TM` (λ rejects mut-in-closure → `assert_tm_only`).
- **A higher-order proptest shape** and richer capturing demos, if the curated demos prove insufficient.

## Self-Review (completed while writing)

- **Spec coverage (3b-1):** the Core→Core defunc pass (spec §"defunc pass") ✓; closed function-values → three-way `map`/`fold` (Tasks 1–3) ✓; immutable capture by value → three-way (Task 4) ✓; mutable capture rejected `Unsupported` (Task 4) ✓; the `Unsupported` boundary + a golden (Task 5) ✓. Mutable-capture boxing is 3b-2.
- **Placeholder scan:** the transform is authored against a concrete reference-equivalence contract (the hard algorithmic tasks give the algorithm + the exact test, opus-authored — like the δ-gadget tasks in Plan 3); the wiring/oracle/boundary tasks are concrete. The two capture-points (the Task-5 golden; the exact `Unsupported` cases) are marked CAPTURE/discover-during-implementation, not vague placeholders.
- **Type/interface consistency:** `defunc(&Core) -> Result<Core, LowerError>` (reusing `lower_asm::LowerError`), consumed by `run_tm` before `lower_asm(&Core) -> Result<Program, LowerError>`; `interp::eval(&Core) -> Result<Value, RuntimeError>` for the reference-equivalence check; closures as `cons`/`head`/`tail` reuse the existing list machinery; dependency-order `LetRec` nesting matches how `lower_asm`/the reference resolve names (callees outer). The oracle helpers (`assert_three_way`, `assert_lambda_only`) already exist; Task 3 only moves demos between the buckets.
