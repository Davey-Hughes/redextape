# `defunc` BOTH — functions both called by name and used as a value — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a top-level `fn` be both called by name and used as a value, so a whole program class — most importantly *every recursive function used as a value* — moves from "λ-only" into full `reference == λ == TM == native` agreement.

**Architecture:** Two edits to `defunc`. (1) The `(true, true)` partition arm stops returning `Unsupported` and instead pushes the function into **both** `kept` and `value_funcs`, so it is simultaneously a named subroutine and a tagged dispatcher arm. (2) That function's dispatcher arm becomes a **forwarder** — one `Apply` of the kept function to the dispatcher's `$a_i` slots — rather than a second copy of the body, which is what keeps `no_output_node_id_is_duplicated` true. `rewrite_apply` and `rewrite_value_name` need **no change**: both already test the kept/tag sets in the order that makes a BOTH function do the right thing on each path.

**Tech Stack:** Rust edition 2024, `redextape-core` (`src/tm/defunc.rs`), `redextape-native` for the fourth oracle leg. No new dependencies. No public signature changes.

## Global Constraints

- Rust edition 2024, `max_width = 120`, `use_small_heuristics = "Max"` (`rustfmt.toml`).
- CI gates that must stay green: `cargo fmt --all --check`; `cargo clippy --workspace --all-targets -- -D warnings`; `cargo llvm-cov --workspace --all-targets --fail-under-lines 80`.
- **No panics on any input.** `defunc` must stay TOTAL — degrade an internal-invariant violation to `Unsupported`, never `expect`/`unwrap`/index-panic.
- **Never miscompile > always accept.** A case that cannot be compiled correctly must be `Unsupported`, not silently wrong.
- No public signature changes: `defunc`/`defunc_mapped` keep their shapes. The only difference is that inputs which returned `Err(LowerError::Unsupported)` now return `Ok`.

---

## Findings from a spike on `4275bd5` — read this before Task 1

A throwaway spike applied the two edits and ran the probes below. It has been reverted; these are its results, and **two of them correct the design spec**.

**1. The spec's §3 capture question is already answered: a top-level `fn` cannot capture at all.** The spec says "A top-level `fn` **can** capture: `let n = 5; fn f(x){ x + n } map(xs, f)` closes over `n`", and asks the implementation to verify the dispatcher's scope. It does not need to. **Guard 2** (the `function \`{}\` references an outer let binding` check in `defunc_mapped`'s step 2) rejects *any* peeled `fn` whose body's free variables intersect the prelude `let` names, and it runs at step 2 — before the step-3 partition. Measured: that exact program returns `Unsupported { what: "function `f` references an outer let binding" }`, and the `rejects(…, "references an outer let binding")` lines in `unsupported_boundary` already pin it. So **the forwarder never needs to bind captures from the env**, and §3's "bind from env if not" branch is dead code that must not be written. Task 4 pins this so it breaks loudly if guard 2 is ever relaxed.

**2. A new boundary the spec does not mention: a cycle in the emitted BINDER graph (kept `fn`s and `$applyN` dispatchers) that returns to a BOTH function's own dispatcher is still `Unsupported`, however it gets there.** The forwarder gives `$applyN` an out-edge to the BOTH function. `topo_order` sees any resulting cycle back through `$applyN` and rejects with the **pre-existing** `cyclic higher-order call graph` rule (`visit`'s on-stack cycle check in `topo_order`, already exercised by `unsupported_boundary`'s other cyclic-call-graph cases). This slice does not introduce that rule and does not lift it. Minimal witness — the cycle closes DIRECTLY, through the function's own body applying a value at its own arity:

```
fn inc(x) { x + 1 } fn t(g) { g(3) } fn ap(h, y) { h(y) } t(inc) + ap(t, inc)
```

Dispatch at a *different* arity is fine, which is why the `map` case works — **but "different arity" is not sufficient for safety on its own**: a later review (closing this branch) found that the cycle can also leave through one dispatcher and re-enter through ANOTHER, of a different arity, reachable through other kept `fn`s along the way — e.g. `fn add(a, b) { a + b } fn inc(x) { x + 1 } fn f(g) { g(1, 2) } fn h(p, q) { p(q) } fn ap1(k, x) { k(x) } fn ap2(k, a, b) { k(a, b) } f(add) + h(inc, 5) + ap1(f, add) + ap2(h, inc, 5)` (reference/λ = 18; TM/asm/native `Unsupported { "cyclic higher-order call graph through \`f\`" }`): `f` is BOTH at arity 1, its body `g(1, 2)` applies at arity **2** not 1, and it calls no kept `fn` by name at all — yet `f`'s body still reaches `$apply2`, one of whose arms is `h` (also BOTH, at arity 2), and `h`'s body `p(q)` applies at arity 1, reaching `$apply1` — the same dispatcher `f` is itself an arm of. `$apply1 -> f -> $apply2 -> h -> $apply1` closes on `f`'s own dispatcher without matching the direct shape above (a function applying a value at ITS OWN arity) OR a kept `fn` calling another kept `fn` by name — it closes through a THIRD path, a dispatcher of one arity handing off to a dispatcher of another. `topo_order`'s cycle check already catches this correctly (it walks the real graph, not two named shapes), so nothing needed fixing except this document's claim to be exhaustive. Measured with the spike applied:

| program | before | after |
|---|---|---|
| `fn sub(a,b){a-b} fn ap2(g,a,b){g(a,b)} sub(9,4) + ap2(sub,10,3)` | BOTH rejected | **Ok, 12, meaning preserved** |
| `fn sum(n){...} fn ap(g,x){g(x)} ap(sum,4) + sum(2)` (recursive) | BOTH rejected | **Ok, 13, meaning preserved** |
| `map` value-used at arity 2, dispatching at arity 1 | BOTH rejected | **Ok, 8, meaning preserved** |
| `fn t(g){g(3)}` value-used at arity 1, dispatching at arity 1 | BOTH rejected | `cyclic higher-order call graph through \`t\`` |

**Scope consequence, stated plainly:** the spec's motivating line "passing `map` or `fold` itself to another function" **does work** (different arity), but the general claim "every recursive function used as a value" has this one exception (any cycle back to a BOTH function's own dispatcher, not just the two shapes above). Lifting it would mean emitting the dispatcher and the BOTH function as one `LetRecGroup` — a genuinely larger change to `topo_order`'s unit model, and explicitly **not** in this slice.

**3. Exactly one existing test breaks:** `tm::defunc::tests::unsupported_boundary` (the `rejects(..., "both called by name and used as a value")` line). Everything else passes — **325 passed, 1 failed** — including `no_output_node_id_is_duplicated`, which is the evidence that forwarding does not duplicate ids.

**4. `rewrite_apply` and `rewrite_value_name` need no change.** `rewrite_apply` (`defunc.rs:870-883`) tests `is_static = kept.contains(name) || is_builtin_fn(name)` **before** the `is_local || is_value_fn` dispatch branch, so a BOTH function's by-name calls — including its own recursive self-call — take the direct path. `rewrite_value_name` (`defunc.rs:761-772`) tests `tags` **before** `kept`, so a BOTH function in a value position yields `cons(tag, nil)`. Both orderings are load-bearing; Task 2 pins the first one.

---

### Task 1: The transform — partition arm and forwarding arm

**Files:**
- Modify: `crates/redextape-core/src/tm/defunc.rs:324-338` (step 3's comment + the `(true, true)` arm)
- Modify: `crates/redextape-core/src/tm/defunc.rs:389-396` (step 5c, the arm builder)
- Modify: `crates/redextape-core/src/tm/defunc.rs:126-144` (the `Emitted` doc comment's invariant argument)
- Modify: `crates/redextape-core/src/tm/defunc.rs` (`unsupported_boundary`: remove the now-obsolete `rejects(..., "both called by name and used as a value")` line)
- Test: `crates/redextape-core/src/tm/defunc.rs` (the `mod tests` at the bottom)

**Interfaces:**
- Consumes: `kept: Vec<&Func>`, `value_funcs: Vec<&Func>`, `kept_names: BTreeSet<String>` (built at `defunc.rs:349`, in scope at step 5c), `ArmData { params, captures, body }`, and the module helpers `var(&mut SynthGen, &str) -> Core` and `apply(&mut SynthGen, Core, Vec<Core>) -> Core`.
- Produces: `defunc`/`defunc_mapped` return `Ok` for BOTH programs. A BOTH function `f` of arity N appears in the output as one `LetRec { name: "f", .. }` plus one `$applyN` arm whose body is `Apply(Var("f"), [Var("$a1"), .., Var("$aN")])` with `ArmData.params` **empty**.

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `crates/redextape-core/src/tm/defunc.rs`. The fixture is **non-commutative at arity 2** on purpose: a forwarder that emitted `f($a2, $a1)` would be a silent miscompile producing a plausible number, and a commutative `add` fixture could never catch it. `sub(9,4) + ap2(sub,10,3)` is `5 + 7 = 12`; with the arguments swapped the dispatched call becomes `sub(3,10)`, which is `0` under monus, giving `5`.

```rust
    /// A `fn` both CALLED BY NAME and USED AS A VALUE. Non-commutative at arity 2 (`sub`, not `add`):
    /// a forwarder that swapped `$a1`/`$a2` computes a plausible wrong answer, so a commutative
    /// fixture would pass while the pass was broken. 5 + 7 = 12; swapped, 5 + 0 = 5.
    #[test]
    fn both_called_by_name_and_used_as_a_value() {
        defunc_preserves_and_lowers("fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)");
    }
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cargo test -p redextape-core --lib both_called_by_name_and_used_as_a_value`
Expected: FAIL — `defunc succeeds` panics with `Unsupported { what: "`sub` is both called by name and used as a value" }`.

- [ ] **Step 3: Change the partition arm**

In `defunc_mapped` step 3, replace the `(true, true)` arm and the comment above the loop.

```rust
    // KEPT = called by name (stays a named subroutine). VALUE = used as a value (tagged, reachable
    // through a dispatcher). BOTH is both at once: a named subroutine that ALSO has a dispatcher arm,
    // and the arm FORWARDS to the subroutine rather than duplicating its body (see step 5c and
    // `Emitted`'s doc comment). Neither is dead (dropped).
    let mut kept: Vec<&Func> = Vec::new();
    let mut value_funcs: Vec<&Func> = Vec::new();
    for f in &funcs {
        let vu = value_used.contains(&f.name);
        let nc = name_called.contains(&f.name);
        match (vu, nc) {
            (true, true) => {
                kept.push(f);
                value_funcs.push(f);
            }
            (true, false) => value_funcs.push(f),
            (false, true) => kept.push(f),
            (false, false) => {} // dead: drop it
        }
    }
```

- [ ] **Step 4: Make the arm a forwarder for BOTH functions**

In `defunc_mapped` step 5c, replace the arm-building loop.

```rust
    // 5c. Value functions: rewrite each body into a dispatcher arm. A named value fn never captures
    // (guard 2 rejected any that references a let), so its arm carries no captures.
    //
    // A BOTH function is the exception: it is ALSO `kept`, so its body is already emitted once as a
    // named subroutine (5b). Its arm FORWARDS to that subroutine — `f($a1, .., $aN)`, with NO param
    // bindings (an empty `ArmData.params` makes `dispatcher` emit none, so `$a_i` reaches the call
    // directly). Forwarding rather than duplicating is what keeps every input id labelling exactly ONE
    // output node; see `Emitted`'s doc comment. It costs one extra frame on the DISPATCHED path only —
    // the by-name path stays a direct call — and no existing program regresses, because programs in
    // this class were rejected outright before.
    let mut arms: BTreeMap<String, ArmData> = BTreeMap::new();
    for f in &value_funcs {
        if kept_names.contains(&f.name) {
            let callee = var(rw.g, &f.name);
            let args = (1..=f.params.len()).map(|i| var(rw.g, &format!("$a{i}"))).collect();
            let body = apply(rw.g, callee, args);
            arms.insert(f.name.clone(), ArmData { params: Vec::new(), captures: Vec::new(), body });
            continue;
        }
        let locals: BTreeSet<String> = f.params.iter().cloned().collect();
        let body = rw.rewrite(f.body, &locals)?;
        arms.insert(f.name.clone(), ArmData { params: f.params.clone(), captures: Vec::new(), body });
    }
```

- [ ] **Step 5: Rewrite the `Emitted` invariant doc comment**

`Emitted`'s doc comment currently names the BOTH rejection as the load-bearing reason no output id is duplicated, and instructs "Whoever relaxes (3) must re-id one of the two copies." That instruction is now wrong — this slice relaxes (3) and re-ids nothing, because it never makes a copy. Replace items 3 and the sentence after the list:

```rust
///   3. A function both called-by-name AND used-as-a-value is emitted ONCE, as a kept `fn`, and its
///      dispatcher arm FORWARDS to it (`f($a1..$aN)`) rather than inlining a second copy of the body.
///      This was previously guaranteed instead by rejecting the case outright; forwarding is what
///      replaced that rejection without weakening the invariant. Duplicating the body — the obvious
///      alternative, which buys one fewer frame on the dispatched path — would put every id inside it
///      on two nodes, silently doubling the cost billed to the user's arithmetic, so a future change
///      that prefers duplication MUST re-id one of the copies.
///
/// `no_output_node_id_is_duplicated` fails loudly if any of the three stops holding.
```

- [ ] **Step 6: Remove the obsolete rejection assertion**

In `unsupported_boundary`, delete these two lines — the class is now supported, and Task 4 adds the assertion for the boundary that replaces it:

```rust
        // A fn both called-by-name AND used-as-a-value (`f` here): Task 1's "BOTH" rejection.
        rejects("fn f(x) { x + 1 } fn ap(g, x) { g(x) } f(1) + ap(f, 2)", "both called by name and used as a value");
```

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `cargo test -p redextape-core --lib tm::defunc`
Expected: PASS, including `both_called_by_name_and_used_as_a_value`, `unsupported_boundary`, and `no_output_node_id_is_duplicated`.

- [ ] **Step 8: Sabotage-verify the argument order**

This codebase has repeatedly shipped guards that passed while the thing they named was broken. Prove this one can fail. Temporarily reverse the forwarder's arguments in step 5c:

```rust
            let args = (1..=f.params.len()).rev().map(|i| var(rw.g, &format!("$a{i}"))).collect();
```

Run: `cargo test -p redextape-core --lib both_called_by_name_and_used_as_a_value`
Expected: FAIL — `defunc changed the meaning of: ...` with `Nat(5)` against the reference's `Nat(12)`.
Then revert the sabotage and re-run to confirm PASS.

- [ ] **Step 9: Full gate**

Run: `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: clippy exit 0 with no warnings; all tests pass.

- [ ] **Step 10: Commit**

```bash
git add crates/redextape-core/src/tm/defunc.rs
git commit -m "feat(tm): defunc accepts a fn both called by name and used as a value

The dispatcher arm forwards to the kept subroutine rather than inlining a
second copy of the body, so every input id still labels exactly one output
node and no_output_node_id_is_duplicated keeps holding."
```

---

### Task 2: Pin that the by-name call stays direct

**Files:**
- Test: `crates/redextape-core/src/tm/defunc.rs` (the `mod tests` at the bottom)

**Interfaces:**
- Consumes: `defunc(&Core) -> Result<Core, LowerError>`, the module-level `push_children<'a>(&'a Core, &mut Vec<&'a Core>)` (usable from `mod tests` via `use super::*`), `dispatcher_name(arity: usize) -> String`.
- Produces: a `count_calls_to(core: &Core, callee: &str) -> usize` test helper, reusable by later tasks.

**Why this needs its own test:** if a future refactor routes the by-name call through the dispatcher, every result stays *correct* and only gets slower. Nothing in the oracle can see it. The devirtualization pass this slice unblocks is precisely about not paying for dispatch, so an undetected regression here would quietly erase the reason the slice exists.

- [ ] **Step 1: Write the failing test**

```rust
    /// Every `Apply` in `core` whose callee is `Var(callee)`, by the same iterative walk the rest of
    /// this module uses (a big list literal desugars to a spine deep enough to overflow a recursive one).
    fn count_calls_to(core: &Core, callee: &str) -> usize {
        let mut n = 0;
        let mut stack = vec![core];
        while let Some(node) = stack.pop() {
            if let Core::Apply(_, f, _) = node
                && let Core::Var(_, name) = f.as_ref()
                && name == callee
            {
                n += 1;
            }
            push_children(node, &mut stack);
        }
        n
    }

    /// A BOTH function's by-name call must stay a DIRECT call, not go through the dispatcher.
    /// `rewrite_apply` tests `is_static` before its dispatch branch, which is what makes this hold —
    /// and if a refactor ever swaps that order every answer stays correct and only gets slower, which
    /// no oracle leg can see. Hence a structural assertion.
    ///
    /// In this program the ONLY value-application is `g(a, b)` inside `ap2`, so exactly one `$apply2`
    /// call site may exist. Routing `sub(9, 4)` through dispatch would make it two.
    #[test]
    fn a_both_functions_by_name_call_stays_direct() {
        let src = "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)";
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "{ds:?}");
        let core = desugar(&prog.unwrap());
        let d = defunc(&core).expect("defunc succeeds");
        assert_eq!(
            count_calls_to(&d, &dispatcher_name(2)),
            1,
            "exactly one $apply2 site (`g(a, b)` in `ap2`); the by-name `sub(9, 4)` must not dispatch"
        );
        // Two direct calls to `sub`: the user's `sub(9, 4)` and the dispatcher arm's forwarder.
        assert_eq!(count_calls_to(&d, "sub"), 2, "the by-name call plus the forwarding arm");
    }
```

- [ ] **Step 2: Run it to verify it passes on Task 1's implementation**

Run: `cargo test -p redextape-core --lib a_both_functions_by_name_call_stays_direct`
Expected: PASS. (This test pins existing behaviour rather than driving new code — Step 3 is what proves it is not vacuous.)

- [ ] **Step 3: Sabotage-verify — prove the test can fail**

Temporarily reorder `rewrite_apply` (`defunc.rs:874-883`) so the dispatch branch is tested first:

```rust
            if is_local || is_value_fn {
                let clos = self.rewrite_value_name(callee.id(), name, locals)?;
                return self.build_dispatch(id, clos, args, locals);
            }
            if !is_local && is_static {
                let new_args = args.iter().map(|a| self.rewrite(a, locals)).collect::<Result<Vec<_>, _>>()?;
                return Ok(Core::Apply(id, Box::new(Core::Var(callee.id(), name.clone())), new_args));
            }
```

Run: `cargo test -p redextape-core --lib a_both_functions_by_name_call_stays_direct`
Expected: FAIL — `assertion left == right failed: left: 2, right: 1`.
Then revert the sabotage and re-run to confirm PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/src/tm/defunc.rs
git commit -m "test(tm): pin that a BOTH function's by-name call does not dispatch"
```

---

### Task 3: Oracle agreement — the slice's actual payoff

**Files:**
- Modify: `crates/redextape-core/tests/three_way_oracle.rs:79-156` (`FIRST_ORDER_DEMOS`)
- Modify: `crates/redextape-native/tests/native_oracle.rs:128-189` (its own mirror of `FIRST_ORDER_DEMOS`)

**Interfaces:**
- Consumes: `assert_three_way(src)` (`three_way_oracle.rs:22`) and `assert_four_way(src)` (`native_oracle.rs:58`), both driven by iterating `FIRST_ORDER_DEMOS`.
- Produces: three BOTH programs covered by `three_way_oracle_on_the_first_order_suite`, `four_way_oracle_on_the_first_order_suite`, and `native_matches_asm_interp_on_the_first_order_suite`.

**Note:** `native_oracle.rs` keeps its **own copy** of the list (it is a separate test binary in a different crate), so each demo is added in **two** places. This also grows the step-survey corpus from 32 programs to 35 — Task 6 refreshes the numbers that depend on it.

- [ ] **Step 1: Add the three demos to `three_way_oracle.rs`**

Append inside `FIRST_ORDER_DEMOS`, before the closing `];`:

```rust
    // A fn both CALLED BY NAME and USED AS A VALUE. Previously `Unsupported` on TM and native while
    // the reference and λ accepted it — an oracle asymmetry this class now closes.
    // Non-commutative at arity 2, so a forwarder with swapped arguments cannot pass: 5 + 7 = 12.
    "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)",
    // RECURSIVE and value-used — the case the restriction actually blocked, and the reason the class
    // is large: `analyze` counts a self-call as `name_called`, so every recursive fn used as a value
    // was BOTH. 10 + 3 = 13.
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } fn ap(g, x) { g(x) } ap(sum, 4) + sum(2)",
    // `map` itself passed as a value while ALSO being called by name. Its body dispatches at arity 1
    // and it is value-used at arity 2, so the two dispatchers are distinct and the call graph is
    // acyclic. 2 + 6 = 8.
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
     fn add1(x) { x + 1 }\n\
     fn ap2(g, a, b) { g(a, b) }\n\
     head(map([1, 2], add1)) + head(ap2(map, [5, 6], add1))",
```

- [ ] **Step 2: Add the identical three demos to `native_oracle.rs`**

Append the same three entries inside `native_oracle.rs`'s `FIRST_ORDER_DEMOS`, before its closing `];`. Keep the comments — the two lists are mirrors and a reader of either should see why these programs are here.

- [ ] **Step 3: Run the three-way oracle**

Run: `cargo test -p redextape-core --test three_way_oracle three_way_oracle_on_the_first_order_suite`
Expected: PASS — `reference == λ == TM` on all three new programs.

- [ ] **Step 4: Run the four-way oracle**

Run: `cargo test -p redextape-native --test native_oracle`
Expected: PASS — `reference == λ == TM == native`, plus `native == asm-interp`, on all three.

- [ ] **Step 5: Sabotage-verify — prove all three demos exercise the new path**

A demo that would have passed before Task 1 proves nothing. Temporarily restore the old partition arm in `defunc.rs` step 3:

```rust
            (true, true) => {
                return Err(unsupported(f.body, format!("`{}` is both called by name and used as a value", f.name)));
            }
```

Run: `cargo test -p redextape-core --test three_way_oracle three_way_oracle_on_the_first_order_suite`
Expected: FAIL, and the panic message must name **each** of the three new programs across successive runs (the suite stops at the first mismatch, so re-run after commenting out each failing demo, or read the `tm=LowerError(Unsupported { what: "... is both called by name and used as a value" })` for the one it reports and repeat). All three must be reachable this way; a demo that still passes with the old arm restored is not testing this slice and must be replaced.
Then revert the sabotage and re-run both suites to confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/tests/three_way_oracle.rs crates/redextape-native/tests/native_oracle.rs
git commit -m "test: four-way agreement on fns both called by name and used as a value"
```

---

### Task 4: The boundary — what is still `Unsupported`, and why the forwarder needs no captures

**Files:**
- Modify: `crates/redextape-core/src/tm/defunc.rs` (`unsupported_boundary`, and `rewrite_value_name`'s kept-guard comment at `defunc.rs:768-772`)
- Modify: `docs/superpowers/specs/2026-07-25-defunc-both-called-and-value-used-design.md` (§3)

**Interfaces:**
- Consumes: the `rejects(src, needle)` helper local to `unsupported_boundary`.
- Produces: no code interface — this task pins two facts that the rest of the slice silently depends on.

- [ ] **Step 1: Write the two boundary assertions**

Add inside `unsupported_boundary`, where the deleted BOTH line used to be:

```rust
        // The BOTH class's ONE remaining exception. A BOTH function's arm forwards to it, giving
        // `$applyN` an edge to `f`; if `f`'s body applies a value at the SAME arity N, that closes
        // `$applyN -> t -> $applyN`. This is the PRE-EXISTING cycle rule (see the two cases below),
        // not a new restriction — and dispatching at a DIFFERENT arity is fine, which is why the
        // `map`-passed-as-a-value demo works. Lifting it means emitting the dispatcher and the BOTH
        // function as one `LetRecGroup`, which is a change to `topo_order`'s unit model.
        rejects(
            "fn inc(x) { x + 1 } fn t(g) { g(3) } fn ap(h, y) { h(y) } t(inc) + ap(t, inc)",
            "cyclic higher-order call graph",
        );

        // WHY THE FORWARDING ARM NEVER BINDS CAPTURES. A dispatcher arm that forwards lets the callee
        // resolve its own free names LEXICALLY, ignoring the closure env — which is correct only if a
        // top-level `fn` cannot capture. It cannot: guard 2 rejects any peeled `fn` whose body reads a
        // prelude `let`, and it runs BEFORE the step-3 partition, so the BOTH variant is rejected for
        // the same reason the value-only variant at the top of this test is. If guard 2 is ever
        // relaxed, this line fails and the forwarder must start binding captures from the env.
        rejects(
            "let n = 5; fn f(x) { x + n } fn ap(g, x) { g(x) } f(1) + ap(f, 1)",
            "references an outer let binding",
        );
```

- [ ] **Step 2: Run the test**

Run: `cargo test -p redextape-core --lib unsupported_boundary`
Expected: PASS.

- [ ] **Step 3: Sabotage-verify the capture pin**

Temporarily neuter guard 2 (the `function \`{}\` references an outer let binding` check, in `defunc_mapped`'s step 2) by making its rejection unreachable:

```rust
        if false && fv.intersection(&let_names).next().is_some() {
```

Run: `cargo test -p redextape-core --lib unsupported_boundary`
Expected: FAIL — the `references an outer let binding` assertion no longer holds, proving the pin is live rather than decorative. (It will fail on the pre-existing value-only line too; both are the same guard.)
Then revert the sabotage and re-run to confirm PASS.

- [ ] **Step 4: Correct the stale comment in `rewrite_value_name`**

`defunc.rs:768-772` says a kept function "should never reach a value position (that would make it value-used)". That is now true only of a kept-ONLY function; a BOTH function reaches this code and is handled two lines earlier by the `tags` check. Replace the comment:

```rust
        if self.kept.contains(name) {
            // A kept function in a value position. A BOTH function never reaches here — it is also
            // tagged, and the `tags` check above fires first, yielding `cons(tag, nil)`. So this is a
            // kept-ONLY function, which by definition is not value-used; reaching it means the
            // classification and the rewrite disagree. Guard rather than build a tagless closure.
            return Err(LowerError::Unsupported { node: id, what: format!("`{name}` used as a value") });
        }
```

- [ ] **Step 5: Correct §3 of the design spec**

The spec asks the implementation to verify whether the dispatcher is in scope of a captured binding. Replace §3's body with the verified answer — that the question does not arise — and keep the reasoning, since it is why the forwarder is safe:

```markdown
## 3. The capture question — verified: a top-level `fn` cannot capture

A forwarding arm calls `f` and lets `f` resolve its captures **lexically**, ignoring the closure's env.
That is correct only if `f` has no captures to resolve. **It cannot have any.** Guard 2 (the
`function \`{}\` references an outer let binding` check, in `defunc_mapped`'s step 2) rejects any
peeled `fn` whose body's free variables intersect the prelude `let` names, and it runs at step 2 —
before the step-3 partition — so `let n = 5; fn f(x){ x + n } …` is `Unsupported` whether `f` is
value-used, name-called, or both.

This design's original text claimed the opposite and asked the implementation to verify it. Measured
on `4275bd5`: that program returns `Unsupported { what: "function `f` references an outer let
binding" }`, and the `rejects(…, "references an outer let binding")` lines in `unsupported_boundary`
already pinned it. So the arm binds **no** captures, and the "bind from env if not" branch must not be
written. `unsupported_boundary` pins the BOTH variant, so relaxing guard 2 without revisiting the
forwarder fails loudly.
```

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/tm/defunc.rs docs/superpowers/specs/2026-07-25-defunc-both-called-and-value-used-design.md
git commit -m "test(tm): pin the BOTH class's boundary, and correct the spec's capture premise

A BOTH fn whose body dispatches at its OWN arity still closes a cycle
through its dispatcher. And a top-level fn cannot capture at all: guard 2
rejects it before the partition, so the forwarding arm binds nothing."
```

---

### Task 5: Attribution — the forwarder's frame bills to `ClosureScaffold`

**Files:**
- Test: `crates/redextape-core/src/tm/attribute.rs` (its `mod tests`)

**Interfaces:**
- Consumes: `attribute(src) -> Result<Attribution, LowerError>` (`attribute.rs:221`), `Attribution { histogram: BTreeMap<StepBucket, u64>, total, capped }`, `StepBucket::{Node, ClosureScaffold, MachineScaffold}` (`attribute.rs:31-57`).
- Produces: no code interface.

**Why:** the survey's whole discipline is *bucket by what a pass could do about it*. The forwarder's frame exists only because arguments arrive through a dispatcher, and known-callee devirtualization is exactly what would remove it — so it must land in `ClosureScaffold`, not be charged to the user's arithmetic. It does so because the forwarder takes fresh ids from `SynthGen`, which is a property of Task 1's implementation rather than an accident, and this test is what makes that falsifiable.

- [ ] **Step 1: Write the test**

```rust
    /// A BOTH function's dispatcher arm is a FORWARDER, and its frame is defunctionalization
    /// scaffolding: it exists only because the dispatched path routes arguments through `$a_i` slots,
    /// and known-callee devirtualization is precisely the pass that removes it. So its steps must land
    /// in `ClosureScaffold` — while the function's own body still bills to the user's constructs.
    #[test]
    fn a_both_functions_forwarding_arm_bills_to_closure_scaffold() {
        let src = "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)";
        let a = attribute(src).expect("attributes");
        assert!(!a.capped, "the fixture must run to completion");

        let closure: u64 =
            a.histogram.iter().filter(|(b, _)| matches!(b, StepBucket::ClosureScaffold(_))).map(|(_, n)| *n).sum();
        assert!(closure > 0, "the dispatcher and its forwarding arm are scaffolding, so this cannot be zero");

        // The user's own `a - b` still bills to a `Node` bucket: the forwarder does not swallow the
        // body it forwards to. `sub`'s body is emitted ONCE, as a kept fn, with its source ids intact.
        let user: u64 =
            a.histogram.iter().filter(|(b, _)| matches!(b, StepBucket::Node(_))).map(|(_, n)| *n).sum();
        assert!(user > 0, "the kept body keeps its source ids and bills to the user");
        assert_eq!(a.histogram.values().sum::<u64>(), a.total, "every step lands in exactly one bucket");
    }
```

- [ ] **Step 2: Run it**

Run: `cargo test -p redextape-core --lib a_both_functions_forwarding_arm_bills_to_closure_scaffold`
Expected: PASS.

- [ ] **Step 3: Sabotage-verify — prove the bucket assertion is live**

Temporarily make the forwarder reuse the source function's `Lambda` id instead of minting fresh ones, in Task 1's step-5c branch:

```rust
            let callee = Core::Var(f.lambda_id, f.name.clone());
            let args = (1..=f.params.len()).map(|i| var(rw.g, &format!("$a{i}"))).collect();
            let body = Core::Apply(f.lambda_id, Box::new(callee), args);
```

Run: `cargo test -p redextape-core --lib`
Expected: FAIL — `no_output_node_id_is_duplicated` fails, because `f.lambda_id` now labels both the kept function's `Lambda` and the forwarder. This is the invariant `Emitted`'s doc comment describes, demonstrated rather than asserted.
Then revert the sabotage and re-run to confirm PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/src/tm/attribute.rs
git commit -m "test(tm): a BOTH function's forwarding frame bills to ClosureScaffold"
```

---

### Task 6: Close the loop on the numbers this slice moves

**Files:**
- Modify: `crates/redextape-core/examples/step_survey.rs` (its `FIRST_ORDER_DEMOS` copy and that copy's doc comment)
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (the ranked-pass-set block, ~lines 184-199)

**Interfaces:**
- Consumes: `cargo run --release --example step_survey -p redextape-core`.
- Produces: a survey whose corpus matches the oracle suite it claims to copy, and a roadmap whose transcribed figures match a live run of it.

**Why — corrected after Task 3's review, which measured the original premise false.** This task was planned as "Task 3 grew the list the survey reads." **The survey does not read that list.** `crates/redextape-core/examples/step_survey.rs` keeps its own **hand-copied** `FIRST_ORDER_DEMOS` — an example is a separate binary crate and cannot `use` an integration test's module, so the strings are duplicated by hand, as its module doc explains. Its copy's doc comment claims "Verbatim copy of `tests/three_way_oracle.rs::FIRST_ORDER_DEMOS`", and measured on `077d19d` that claim is **10 entries stale**: the survey has 28, the oracle 38. Seven of those ten went stale during the earlier mutual-recursion slice; three are this slice's. (`LAMBDA_LIMITATION_DEMOS` is in sync at 4 and needs nothing.)

So re-running the survey without syncing first prints byte-identical output, and transcribing that into the roadmap would record unchanged numbers as if they had been refreshed. Sync first, then measure.

**Scope note:** this task therefore also picks up the seven demos the *previous* slice left behind. That is deliberate — the doc comment asserts a verbatim copy, and a partial sync leaves it asserting something false, which is the same defect class this whole slice's reviews keep finding.

- [ ] **Step 1: Sync the survey's corpus with the oracle's**

Make `step_survey.rs`'s `FIRST_ORDER_DEMOS` a genuine verbatim copy of `crates/redextape-core/tests/three_way_oracle.rs`'s, including the comments attached to individual demos. Verify the two are identical afterwards — compare the extracted string literals, do not eyeball them:

```bash
for f in crates/redextape-core/examples/step_survey.rs crates/redextape-core/tests/three_way_oracle.rs; do
  awk '/^const FIRST_ORDER_DEMOS/,/^\];/' "$f" | grep -c '^    "'
done
```
Expected: the same count from both files.

- [ ] **Step 2: Re-run the survey and record the shift**

Run: `cargo run --release --example step_survey -p redextape-core`
Record, **before and after** the sync: the corpus program count, the total step count, and the four headline per-pass shares (devirtualization, `Ret` frame-restore, inlining, arithmetic). The before-figures are the ones the roadmap currently carries: 32 programs, 3,261,660 steps, 27.5% / 24.8% / 8.2% / 6.1%.

If the sync changes the *ranking* rather than only the magnitudes, say so explicitly in the commit message — that is a material finding about the pass ordering the roadmap recommends, not a cosmetic refresh.

- [ ] **Step 3: Update the roadmap's transcribed figures**

Replace the `Corpus: 32 oracle programs, 3,261,660 TM steps, shares step-weighted.` line and every per-pass share that moved, with the values from Step 2. Also correct the sentence "Re-derive any number below with `cargo run --release --example step_survey -p redextape-core` — the survey is the source of truth": it stays true, but add that the survey's corpus is a hand-maintained copy of the oracle suite and can drift from it, since that is exactly what happened here.

- [ ] **Step 4: Update the #1 entry's prerequisite note**

The ranked-pass-set entry for devirtualization ends with a `**Prerequisite:**` sentence pointing at this spec. Replace it with:

```markdown
     **Prerequisite (DONE):** `defunc` used to *reject* functions both called by name and used as a
     value — the entire "direct call to a value-used function" case. Shipped 2026-07-25; see
     `docs/superpowers/plans/2026-07-25-defunc-both-called-and-value-used.md`. One exception remains:
     a cycle in the emitted binder graph (kept `fn`s and `$applyN` dispatchers) that returns to a BOTH
     function's own dispatcher is still `Unsupported` — reachable directly, through other kept `fn`s, or
     (the non-obvious path) through dispatchers of OTHER arities, e.g. `$apply1 -> f -> $apply2 -> h ->
     $apply1` when `f` and `h` are each BOTH at a different arity (see `defunc.rs`'s module doc for the
     worked counterexample). A dispatcher/callee `LetRecGroup` would lift it.
```

- [ ] **Step 5: Verify the whole gate one last time**

Run: `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: all three green. The survey is an example, not a test, so also confirm it still runs to completion and reports `No corpus program or probe hit the step cap: confirmed` — a newly-synced demo that caps would silently change what the aggregate describes.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/examples/step_survey.rs docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "docs(roadmap): resync the survey corpus with the oracle suite, and refresh the ranked shares"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| §1 the transform (`(true,true)` arm) | Task 1 steps 3-4 |
| §2 forwarding not duplicating | Task 1 step 4, invariant doc at step 5 |
| §3 the capture question | Task 4 steps 1, 3, 5 — **verified false; spec corrected** |
| §4.1 argument order, non-commutative, arity ≥ 2 | Task 1 steps 1, 8 |
| §4.2 the by-name call stays direct | Task 2 |
| §4.3 recursive + value-used works | Task 3 step 1 (demo 2) |
| §4.4 oracle agreement extends | Task 3 |
| §4.5 attribution | Task 5 |
| §4.6 each verified by sabotage | Task 1 step 8, Task 2 step 3, Task 4 step 3, Task 5 step 3 |
| §5 risk: downstream assumes a tagged fn was dissolved | Task 1 step 5 (`Emitted` doc), Task 4 step 4 (`rewrite_value_name`) |
| §5 risk: existing tests assert the `Unsupported` | Task 1 step 6 — exactly one, measured |
| §5 risk: extra frame measured not argued | Task 5, Task 6 step 1 |
